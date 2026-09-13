-- ============================================================
-- Migration 034: built-in quiz / assessment engine
-- ============================================================
-- Until now a "quiz" was just an external link on a subject
-- (subjects.quiz_url, migration 031) — the marks lived in some other
-- tool and never came back into the LMS. This migration adds a real,
-- auto-graded multiple-choice engine whose attempt scores become the
-- single source of marks the gradebook (a later module) aggregates.
--
-- The external quiz_url is left exactly as-is — this engine sits
-- alongside it, nothing is dropped or migrated.
--
-- Shape (mirrors Naseeha's engine, trimmed to what auto-grades cleanly):
--   quizzes → quiz_questions → quiz_options
--   quiz_attempts (one per student per quiz) → quiz_answers
-- Supported question kind: single-correct multiple choice. True/False is
-- just a two-option MCQ. Multi-select and written answers are deliberately
-- out of scope for this first cut (they need manual marking, which the
-- gradebook isn't ready to hold yet).
--
-- SECURITY MODEL — the reason for the RPCs below:
--   RLS is row-level, not column-level. If a student could SELECT a
--   quiz_options row to see the option text, they'd also read
--   is_correct — the answer key. So quiz_options stays STAFF-ONLY, and
--   students reach a quiz through two SECURITY DEFINER functions that
--   never expose is_correct:
--     * get_quiz_paper()      — returns the paper (options WITHOUT the key)
--     * submit_quiz_attempt()  — grades server-side and stores the result
--   Authorship + grading logic live in the database, so the answer key
--   can never travel to the browser.

-- ─── TABLES ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quizzes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id         UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  -- Denormalised from the subject so the student-enrollment RLS check can
  -- be a plain is_enrolled(offering_id) without a join. Set at create time;
  -- a subject never moves between offerings.
  offering_id        UUID NOT NULL REFERENCES public.offerings(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  instructions       TEXT,
  time_limit_minutes INTEGER,
  is_published       BOOLEAN NOT NULL DEFAULT false,
  created_by         UUID REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quizzes_subject_idx ON public.quizzes (subject_id);
CREATE INDEX IF NOT EXISTS quizzes_offering_idx ON public.quizzes (offering_id);

CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id    UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  marks      NUMERIC(5,2) NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON public.quiz_questions (quiz_id);

CREATE TABLE IF NOT EXISTS public.quiz_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quiz_options_question_idx ON public.quiz_options (question_id);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score       NUMERIC(7,2) NOT NULL DEFAULT 0,   -- marks earned
  max_score   NUMERIC(7,2) NOT NULL DEFAULT 0,   -- marks available at submit time
  percentage  NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One sitting per student per quiz. A retake would overwrite marks the
  -- gradebook may already have read, so it's blocked at the DB.
  UNIQUE (quiz_id, student_id)
);
CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_idx ON public.quiz_attempts (quiz_id);
CREATE INDEX IF NOT EXISTS quiz_attempts_student_idx ON public.quiz_attempts (student_id);

CREATE TABLE IF NOT EXISTS public.quiz_answers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id        UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  selected_option_id UUID REFERENCES public.quiz_options(id) ON DELETE SET NULL,
  is_correct         BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS quiz_answers_attempt_idx ON public.quiz_answers (attempt_id);

CREATE TRIGGER quizzes_updated_at
  BEFORE UPDATE ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── RLS ───────────────────────────────────────────────────
ALTER TABLE public.quizzes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_options   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answers   ENABLE ROW LEVEL SECURITY;

-- QUIZZES ---------------------------------------------------
-- Staff (admin OR instructor, per migration 028's model) see all quizzes;
-- an enrolled student sees only PUBLISHED quizzes on offerings they're in.
CREATE POLICY quizzes_select ON public.quizzes FOR SELECT
  USING (
    has_role('admin') OR has_role('instructor')
    OR (is_published AND is_enrolled(offering_id))
  );
CREATE POLICY quizzes_staff_insert ON public.quizzes FOR INSERT
  WITH CHECK (has_role('admin') OR has_role('instructor'));
CREATE POLICY quizzes_staff_update ON public.quizzes FOR UPDATE
  USING (has_role('admin') OR has_role('instructor'));
CREATE POLICY quizzes_staff_delete ON public.quizzes FOR DELETE
  USING (has_role('admin') OR has_role('instructor'));

-- QUESTIONS -------------------------------------------------
-- Question TEXT and marks aren't secret; the answer key is (that lives in
-- options). Students may read questions for a published quiz they're in.
CREATE POLICY quiz_questions_select ON public.quiz_questions FOR SELECT
  USING (
    has_role('admin') OR has_role('instructor')
    OR EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = quiz_questions.quiz_id
        AND q.is_published
        AND is_enrolled(q.offering_id)
    )
  );
CREATE POLICY quiz_questions_staff_write ON public.quiz_questions FOR ALL
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));

-- OPTIONS — STAFF ONLY. Never selectable by students (would leak is_correct).
-- Students receive options, minus the key, through get_quiz_paper().
CREATE POLICY quiz_options_staff_all ON public.quiz_options FOR ALL
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));

-- ATTEMPTS --------------------------------------------------
-- A student reads their OWN attempt; staff read every attempt (to see marks).
-- Rows are created by submit_quiz_attempt() (SECURITY DEFINER), so there is
-- no student INSERT policy — a student cannot forge or overwrite a score.
CREATE POLICY quiz_attempts_select ON public.quiz_attempts FOR SELECT
  USING (
    student_id = auth.uid()
    OR has_role('admin') OR has_role('instructor')
  );

-- ANSWERS ---------------------------------------------------
CREATE POLICY quiz_answers_select ON public.quiz_answers FOR SELECT
  USING (
    has_role('admin') OR has_role('instructor')
    OR EXISTS (
      SELECT 1 FROM public.quiz_attempts a
      WHERE a.id = quiz_answers.attempt_id
        AND a.student_id = auth.uid()
    )
  );

-- ─── RPC: get_quiz_paper ───────────────────────────────────
-- Returns the paper for a student to sit: quiz meta + questions + options,
-- with is_correct STRIPPED. SECURITY DEFINER so it can read options the
-- student's own RLS forbids, but it hand-checks: quiz published + student
-- enrolled + not already attempted. Staff may always fetch (to preview).
CREATE OR REPLACE FUNCTION public.get_quiz_paper(p_quiz_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_quiz   public.quizzes%ROWTYPE;
  v_staff  BOOLEAN := has_role('admin') OR has_role('instructor');
  v_result JSONB;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF v_quiz.id IS NULL THEN
    RAISE EXCEPTION 'Quiz not found';
  END IF;

  IF NOT v_staff THEN
    IF NOT v_quiz.is_published THEN
      RAISE EXCEPTION 'Quiz is not available';
    END IF;
    IF NOT is_enrolled(v_quiz.offering_id) THEN
      RAISE EXCEPTION 'Not enrolled in this course';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'id', v_quiz.id,
    'title', v_quiz.title,
    'instructions', v_quiz.instructions,
    'time_limit_minutes', v_quiz.time_limit_minutes,
    'already_attempted', EXISTS (
      SELECT 1 FROM public.quiz_attempts
      WHERE quiz_id = v_quiz.id AND student_id = auth.uid()
    ),
    'questions', COALESCE((
      SELECT jsonb_agg(q ORDER BY q.sort_order)
      FROM (
        SELECT
          qq.id,
          qq.text,
          qq.marks,
          qq.sort_order,
          COALESCE((
            SELECT jsonb_agg(o ORDER BY o.sort_order)
            FROM (
              SELECT qo.id, qo.text, qo.sort_order
              FROM public.quiz_options qo
              WHERE qo.question_id = qq.id
            ) o
          ), '[]'::jsonb) AS options
        FROM public.quiz_questions qq
        WHERE qq.quiz_id = v_quiz.id
      ) q
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RPC: submit_quiz_attempt ──────────────────────────────
-- Grades a student's answers server-side (where is_correct is readable),
-- writes one attempt + its answers, and returns the score. Enforces:
-- published + enrolled + not-already-attempted. p_answers is a jsonb array
-- of { question_id, option_id }. option_id may be null (skipped question).
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(p_quiz_id UUID, p_answers JSONB)
RETURNS JSONB AS $$
DECLARE
  v_quiz       public.quizzes%ROWTYPE;
  v_student    UUID := auth.uid();
  v_attempt_id UUID;
  v_max        NUMERIC(7,2) := 0;
  v_score      NUMERIC(7,2) := 0;
  v_pct        NUMERIC(5,2) := 0;
  r_q          RECORD;
  v_picked     UUID;
  v_correct    BOOLEAN;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF v_quiz.id IS NULL THEN
    RAISE EXCEPTION 'Quiz not found';
  END IF;
  IF NOT v_quiz.is_published THEN
    RAISE EXCEPTION 'Quiz is not available';
  END IF;
  IF NOT is_enrolled(v_quiz.offering_id) THEN
    RAISE EXCEPTION 'Not enrolled in this course';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = p_quiz_id AND student_id = v_student) THEN
    RAISE EXCEPTION 'You have already taken this quiz';
  END IF;

  INSERT INTO public.quiz_attempts (quiz_id, student_id, score, max_score, percentage)
  VALUES (p_quiz_id, v_student, 0, 0, 0)
  RETURNING id INTO v_attempt_id;

  -- Grade every question on the quiz (a skipped question scores 0 and is
  -- still recorded, so the paper and the answer sheet always line up).
  FOR r_q IN
    SELECT id, marks FROM public.quiz_questions WHERE quiz_id = p_quiz_id
  LOOP
    v_max := v_max + r_q.marks;

    -- What the student picked for this question (null if unanswered).
    SELECT NULLIF(a->>'option_id','')::UUID INTO v_picked
    FROM jsonb_array_elements(p_answers) a
    WHERE (a->>'question_id')::UUID = r_q.id
    LIMIT 1;

    -- Is the picked option a real, correct option OF THIS question?
    v_correct := FALSE;
    IF v_picked IS NOT NULL THEN
      SELECT qo.is_correct INTO v_correct
      FROM public.quiz_options qo
      WHERE qo.id = v_picked AND qo.question_id = r_q.id;
      v_correct := COALESCE(v_correct, FALSE);
    END IF;

    IF v_correct THEN
      v_score := v_score + r_q.marks;
    END IF;

    INSERT INTO public.quiz_answers (attempt_id, question_id, selected_option_id, is_correct)
    VALUES (v_attempt_id, r_q.id, v_picked, v_correct);
  END LOOP;

  IF v_max > 0 THEN
    v_pct := ROUND((v_score / v_max) * 100, 2);
  END IF;

  UPDATE public.quiz_attempts
  SET score = v_score, max_score = v_max, percentage = v_pct
  WHERE id = v_attempt_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'score', v_score,
    'max_score', v_max,
    'percentage', v_pct
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Let signed-in users call the RPCs; the functions themselves enforce
-- enrollment / publication / staff rules.
GRANT EXECUTE ON FUNCTION public.get_quiz_paper(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, JSONB) TO authenticated;
