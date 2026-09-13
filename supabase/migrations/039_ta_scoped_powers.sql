-- ============================================================
-- Migration 039: Teaching Assistant — scoped teaching powers
-- ============================================================
-- A TA is a "scoped instructor": on the courses they are assigned to
-- (via course_assistants, migration 038) they can do everything a
-- teacher does to run the class — see the roster, add and edit
-- subjects, lessons and recordings, author quizzes, enter grades —
-- but ONLY on those courses, and NEVER anything financial.
--
-- HOW THIS DIFFERS FROM THE INSTRUCTOR MODEL
-- Instructors are GLOBAL at the RLS layer: migration 028 grants every
-- instructor has_role('instructor') across all offerings/subjects/
-- enrollments, and "my courses" scoping happens only in the app. A TA
-- is scoped at the DATABASE layer instead: every policy below is gated
-- on assists_offering(<offering>), which is true only for the exact
-- offerings that TA is assigned to. So a TA is strictly weaker and
-- strictly safer than an instructor — they cannot even read a course
-- they don't assist.
--
-- DESIGN RULES for everything below
--   * ADDITIVE ONLY. We never DROP or rewrite an existing policy.
--     Postgres OR-combines permissive policies, so these new
--     `*_ta` policies simply grant the TA an extra path in; every
--     instructor/admin/student path is left exactly as it was.
--   * NO DELETE, ANYWHERE. A TA may create and edit, never destroy.
--     This is deliberate: deleting a subject or lesson cascades to
--     its recordings, and losing class recordings is a hard product
--     constraint. Deletes stay with admins/instructors.
--   * NO FINANCIAL SURFACE. No policy here touches monthly_payments,
--     enrollment approval (enrollments UPDATE), or offering creation/
--     deletion. A TA can read their roster; they cannot approve a
--     payment or spin a course up or down.
--   * assists_offering() is SECURITY DEFINER STABLE (migration 038),
--     so these joins are index-friendly and self-contained.

-- ─── OFFERINGS ────────────────────────────────────────────
-- See the course (even while it's a draft) and edit its details.
CREATE POLICY offerings_ta_select ON public.offerings FOR SELECT
    USING (public.assists_offering(id));
CREATE POLICY offerings_ta_update ON public.offerings FOR UPDATE
    USING (public.assists_offering(id))
    WITH CHECK (public.assists_offering(id));

-- ─── SUBJECTS ─────────────────────────────────────────────
-- Read the classes in the course; add new ones; edit existing ones.
CREATE POLICY subjects_ta_select ON public.subjects FOR SELECT
    USING (public.assists_offering(offering_id));
CREATE POLICY subjects_ta_insert ON public.subjects FOR INSERT
    WITH CHECK (public.assists_offering(offering_id));
CREATE POLICY subjects_ta_update ON public.subjects FOR UPDATE
    USING (public.assists_offering(offering_id))
    WITH CHECK (public.assists_offering(offering_id));

-- ─── LESSONS ──────────────────────────────────────────────
-- Read, add, and edit lessons — including recording_url. No delete,
-- so a TA can never remove a recording.
CREATE POLICY lessons_ta_select ON public.lessons FOR SELECT
    USING (public.assists_offering(offering_id));
CREATE POLICY lessons_ta_insert ON public.lessons FOR INSERT
    WITH CHECK (public.assists_offering(offering_id));
CREATE POLICY lessons_ta_update ON public.lessons FOR UPDATE
    USING (public.assists_offering(offering_id))
    WITH CHECK (public.assists_offering(offering_id));

-- ─── RESOURCES ────────────────────────────────────────────
-- Lesson attachments. Scoped through the parent lesson's offering.
CREATE POLICY resources_ta_select ON public.resources FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id = resources.lesson_id
          AND public.assists_offering(l.offering_id)
    ));
CREATE POLICY resources_ta_insert ON public.resources FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id = resources.lesson_id
          AND public.assists_offering(l.offering_id)
    ));

-- ─── ENROLLMENTS (read-only) ──────────────────────────────
-- See who is in the class. NOT update — enrollment approval reviews
-- payment receipts, which is financial and stays with instructor/admin.
CREATE POLICY enrollments_ta_select ON public.enrollments FOR SELECT
    USING (public.assists_offering(offering_id));

-- ─── LESSON PROGRESS (read-only) ──────────────────────────
CREATE POLICY lesson_progress_ta_select ON public.lesson_progress FOR SELECT
    USING (public.assists_offering(offering_id));

-- ─── QUIZZES ──────────────────────────────────────────────
CREATE POLICY quizzes_ta_select ON public.quizzes FOR SELECT
    USING (public.assists_offering(offering_id));
CREATE POLICY quizzes_ta_insert ON public.quizzes FOR INSERT
    WITH CHECK (public.assists_offering(offering_id));
CREATE POLICY quizzes_ta_update ON public.quizzes FOR UPDATE
    USING (public.assists_offering(offering_id))
    WITH CHECK (public.assists_offering(offering_id));

-- ─── QUIZ QUESTIONS ───────────────────────────────────────
CREATE POLICY quiz_questions_ta_select ON public.quiz_questions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_questions.quiz_id
          AND public.assists_offering(q.offering_id)
    ));
CREATE POLICY quiz_questions_ta_insert ON public.quiz_questions FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_questions.quiz_id
          AND public.assists_offering(q.offering_id)
    ));
CREATE POLICY quiz_questions_ta_update ON public.quiz_questions FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_questions.quiz_id
          AND public.assists_offering(q.offering_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_questions.quiz_id
          AND public.assists_offering(q.offering_id)
    ));

-- ─── QUIZ OPTIONS (answer key) ────────────────────────────
-- Scoped through question → quiz → offering.
CREATE POLICY quiz_options_ta_select ON public.quiz_options FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.quiz_questions qq
        JOIN public.quizzes q ON q.id = qq.quiz_id
        WHERE qq.id = quiz_options.question_id
          AND public.assists_offering(q.offering_id)
    ));
CREATE POLICY quiz_options_ta_insert ON public.quiz_options FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.quiz_questions qq
        JOIN public.quizzes q ON q.id = qq.quiz_id
        WHERE qq.id = quiz_options.question_id
          AND public.assists_offering(q.offering_id)
    ));
CREATE POLICY quiz_options_ta_update ON public.quiz_options FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.quiz_questions qq
        JOIN public.quizzes q ON q.id = qq.quiz_id
        WHERE qq.id = quiz_options.question_id
          AND public.assists_offering(q.offering_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.quiz_questions qq
        JOIN public.quizzes q ON q.id = qq.quiz_id
        WHERE qq.id = quiz_options.question_id
          AND public.assists_offering(q.offering_id)
    ));

-- ─── QUIZ ATTEMPTS / ANSWERS (read-only) ──────────────────
-- See how students did. Attempts are written by a SECURITY DEFINER
-- function, never directly, so read is all a TA needs.
CREATE POLICY quiz_attempts_ta_select ON public.quiz_attempts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_attempts.quiz_id
          AND public.assists_offering(q.offering_id)
    ));
CREATE POLICY quiz_answers_ta_select ON public.quiz_answers FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.quiz_attempts qa
        JOIN public.quizzes q ON q.id = qa.quiz_id
        WHERE qa.id = quiz_answers.attempt_id
          AND public.assists_offering(q.offering_id)
    ));

-- ─── ASSESSMENTS (gradebook) ──────────────────────────────
CREATE POLICY assessments_ta_select ON public.assessments FOR SELECT
    USING (public.assists_offering(offering_id));
CREATE POLICY assessments_ta_insert ON public.assessments FOR INSERT
    WITH CHECK (public.assists_offering(offering_id));
CREATE POLICY assessments_ta_update ON public.assessments FOR UPDATE
    USING (public.assists_offering(offering_id))
    WITH CHECK (public.assists_offering(offering_id));

-- ─── ASSESSMENT GRADES ────────────────────────────────────
-- Enter and correct marks; scoped through the parent assessment.
CREATE POLICY assessment_grades_ta_select ON public.assessment_grades FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = assessment_grades.assessment_id
          AND public.assists_offering(a.offering_id)
    ));
CREATE POLICY assessment_grades_ta_insert ON public.assessment_grades FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = assessment_grades.assessment_id
          AND public.assists_offering(a.offering_id)
    ));
CREATE POLICY assessment_grades_ta_update ON public.assessment_grades FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = assessment_grades.assessment_id
          AND public.assists_offering(a.offering_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = assessment_grades.assessment_id
          AND public.assists_offering(a.offering_id)
    ));
