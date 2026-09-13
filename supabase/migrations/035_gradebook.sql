-- ═══════════════════════════════════════════════════════════════════════════
-- 035  GRADEBOOK  (Module 4)
--
-- Adds teacher-entered assessments and per-student marks, and unifies them
-- with quiz results (migration 034) into a per-subject grade.
--
--   assessments        one gradable item on a subject that ISN'T a quiz —
--                      an assignment, exam, participation mark, or custom item.
--   assessment_grades  one student's marks on one such assessment.
--
-- Quizzes are NOT copied in here. The gradebook reads quiz_attempts live and
-- blends each quiz's percentage with these manual assessments' percentages —
-- a simple mean of every graded item — so quiz marks always stay in sync with
-- the quiz engine and there is a single source of truth for each kind of item.
--
-- RLS mirrors 034 exactly:
--   • Staff = admin OR instructor (migration 028 makes an instructor
--     content-equivalent to an admin) may manage assessments and marks.
--   • A student may READ the assessments on an offering they're enrolled in,
--     and READ only their OWN marks. A student can never write a grade.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ASSESSMENTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assessments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  UUID NOT NULL REFERENCES public.subjects(id)  ON DELETE CASCADE,
  -- Denormalized from the subject so is_enrolled() can gate a student's read
  -- without a join, exactly like quizzes.offering_id.
  offering_id UUID NOT NULL REFERENCES public.offerings(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'assignment'
                CHECK (type IN ('assignment','exam','participation','custom')),
  max_marks   NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK (max_marks > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessments_subject_idx  ON public.assessments (subject_id);
CREATE INDEX IF NOT EXISTS assessments_offering_idx ON public.assessments (offering_id);

-- ─── ASSESSMENT GRADES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assessment_grades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  -- Marks earned. May exceed max_marks (extra credit is allowed on purpose),
  -- so there is no marks <= max_marks check; only a non-negative floor.
  marks         NUMERIC(7,2) NOT NULL CHECK (marks >= 0),
  feedback      TEXT,
  graded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  graded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One mark per student per assessment; re-entering marks updates in place.
  UNIQUE (assessment_id, student_id)
);
CREATE INDEX IF NOT EXISTS assessment_grades_assessment_idx ON public.assessment_grades (assessment_id);
CREATE INDEX IF NOT EXISTS assessment_grades_student_idx    ON public.assessment_grades (student_id);

-- ─── updated_at triggers (shared fn from earlier migrations) ─
CREATE TRIGGER assessments_updated_at
  BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER assessment_grades_updated_at
  BEFORE UPDATE ON public.assessment_grades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── RLS ───────────────────────────────────────────────────
ALTER TABLE public.assessments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_grades ENABLE ROW LEVEL SECURITY;

-- ASSESSMENTS ----------------------------------------------
-- Staff see all; an enrolled student sees the assessments on their offering
-- (so a student knows what they're being graded on). No secret data here —
-- the marks live in assessment_grades, which is separately gated.
CREATE POLICY assessments_select ON public.assessments FOR SELECT
  USING (
    has_role('admin') OR has_role('instructor')
    OR is_enrolled(offering_id)
  );
CREATE POLICY assessments_staff_insert ON public.assessments FOR INSERT
  WITH CHECK (has_role('admin') OR has_role('instructor'));
CREATE POLICY assessments_staff_update ON public.assessments FOR UPDATE
  USING (has_role('admin') OR has_role('instructor'));
CREATE POLICY assessments_staff_delete ON public.assessments FOR DELETE
  USING (has_role('admin') OR has_role('instructor'));

-- ASSESSMENT GRADES ----------------------------------------
-- A student reads only their OWN marks; staff read every student's marks.
CREATE POLICY assessment_grades_select ON public.assessment_grades FOR SELECT
  USING (
    student_id = auth.uid()
    OR has_role('admin') OR has_role('instructor')
  );
-- STAFF ONLY may enter, change, or remove marks. No student write policy at
-- all, so a student can never forge or edit a grade.
CREATE POLICY assessment_grades_staff_insert ON public.assessment_grades FOR INSERT
  WITH CHECK (has_role('admin') OR has_role('instructor'));
CREATE POLICY assessment_grades_staff_update ON public.assessment_grades FOR UPDATE
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));
CREATE POLICY assessment_grades_staff_delete ON public.assessment_grades FOR DELETE
  USING (has_role('admin') OR has_role('instructor'));

COMMENT ON TABLE public.assessments IS
  'A gradable item on a subject that is not a quiz (assignment/exam/participation/custom). Quizzes stay in the quiz tables; the gradebook blends both at read time.';
COMMENT ON TABLE public.assessment_grades IS
  'One student''s marks on one assessment. Staff-write, student-reads-own; quiz marks are NOT stored here (they come from quiz_attempts).';
