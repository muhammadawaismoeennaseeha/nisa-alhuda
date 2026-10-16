-- ============================================================
-- Migration 041: Enhanced Quiz Question Types & Autograding Engine
-- ============================================================
-- Enhances built-in quizzes to support:
--   1. multiple_choice (single choice)
--   2. true_false (True/False radio)
--   3. multi_select (multiple choice checkbox - select all correct)
--   4. ordering (arrange items in correct sequence)
--   5. fill_in_blank (fill in the blank text matching)
--
-- All types are 100% auto-graded by the system upon submission.

-- 1. Add question_type column to quiz_questions
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'multiple_choice';

-- Ensure constraint for supported question types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_type_check'
  ) THEN
    ALTER TABLE public.quiz_questions
      ADD CONSTRAINT quiz_questions_type_check
      CHECK (question_type IN ('multiple_choice', 'true_false', 'multi_select', 'ordering', 'fill_in_blank'));
  END IF;
END $$;

-- 2. Add answer fields to quiz_answers to store non-single-option responses
ALTER TABLE public.quiz_answers
  ADD COLUMN IF NOT EXISTS selected_option_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS text_answer TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ordered_option_ids UUID[] DEFAULT NULL;

-- 3. Update RPC: get_quiz_paper(p_quiz_id UUID)
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
          qq.question_type,
          COALESCE((
            SELECT jsonb_agg(o)
            FROM (
              SELECT qo.id, qo.text, qo.sort_order
              FROM public.quiz_options qo
              WHERE qo.question_id = qq.id
              ORDER BY 
                CASE 
                  WHEN qq.question_type = 'ordering' THEN md5(qo.id::text) -- shuffle ordering options for student paper
                  ELSE qo.sort_order::text
                END
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

-- 4. Update RPC: submit_quiz_attempt(p_quiz_id UUID, p_answers JSONB)
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(p_quiz_id UUID, p_answers JSONB)
RETURNS JSONB AS $$
DECLARE
  v_quiz                 public.quizzes%ROWTYPE;
  v_student              UUID := auth.uid();
  v_attempt_id           UUID;
  v_max                  NUMERIC(7,2) := 0;
  v_score                NUMERIC(7,2) := 0;
  v_pct                  NUMERIC(5,2) := 0;
  r_q                    RECORD;
  v_picked               UUID;
  v_picked_ids           UUID[];
  v_text_ans             TEXT;
  v_ordered_ids          UUID[];
  v_correct              BOOLEAN;
  v_expected_ids         UUID[];
  v_expected_order       UUID[];
  v_expected_texts       TEXT[];
  v_ele                  JSONB;
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

  -- Grade every question on the quiz
  FOR r_q IN
    SELECT id, marks, question_type FROM public.quiz_questions WHERE quiz_id = p_quiz_id ORDER BY sort_order
  LOOP
    v_max := v_max + r_q.marks;
    v_correct := FALSE;
    v_picked := NULL;
    v_picked_ids := NULL;
    v_text_ans := NULL;
    v_ordered_ids := NULL;

    -- Extract answer JSON element for current question
    SELECT a INTO v_ele
    FROM jsonb_array_elements(p_answers) a
    WHERE (a->>'question_id')::UUID = r_q.id
    LIMIT 1;

    IF v_ele IS NOT NULL THEN
      CASE r_q.question_type
        WHEN 'multiple_choice', 'true_false' THEN
          SELECT NULLIF(v_ele->>'option_id','')::UUID INTO v_picked;
          IF v_picked IS NOT NULL THEN
            SELECT qo.is_correct INTO v_correct
            FROM public.quiz_options qo
            WHERE qo.id = v_picked AND qo.question_id = r_q.id;
            v_correct := COALESCE(v_correct, FALSE);
          END IF;

        WHEN 'multi_select' THEN
          SELECT ARRAY(
            SELECT jsonb_array_elements_text(v_ele->'selected_option_ids')::UUID
          ) INTO v_picked_ids;
          IF v_picked_ids IS NOT NULL AND array_length(v_picked_ids, 1) > 0 THEN
            -- Get expected correct option IDs sorted
            SELECT ARRAY(
              SELECT id FROM public.quiz_options
              WHERE question_id = r_q.id AND is_correct = TRUE
              ORDER BY id
            ) INTO v_expected_ids;

            -- Check if picked set matches expected set
            SELECT (
              ARRAY(SELECT unnest(v_picked_ids) ORDER BY 1) = v_expected_ids
            ) INTO v_correct;
            v_correct := COALESCE(v_correct, FALSE);
          END IF;

        WHEN 'fill_in_blank' THEN
          v_text_ans := TRIM(v_ele->>'text_answer');
          IF v_text_ans IS NOT NULL AND v_text_ans <> '' THEN
            -- Match against any correct option text (case insensitive, trimmed)
            SELECT EXISTS (
              SELECT 1 FROM public.quiz_options
              WHERE question_id = r_q.id
                AND is_correct = TRUE
                AND LOWER(TRIM(text)) = LOWER(v_text_ans)
            ) INTO v_correct;
          END IF;

        WHEN 'ordering' THEN
          SELECT ARRAY(
            SELECT jsonb_array_elements_text(v_ele->'ordered_option_ids')::UUID
          ) INTO v_ordered_ids;
          IF v_ordered_ids IS NOT NULL AND array_length(v_ordered_ids, 1) > 0 THEN
            -- Get correct option order by sort_order
            SELECT ARRAY(
              SELECT id FROM public.quiz_options
              WHERE question_id = r_q.id
              ORDER BY sort_order ASC
            ) INTO v_expected_order;

            v_correct := (v_ordered_ids = v_expected_order);
          END IF;

        ELSE
          -- Fallback single option
          SELECT NULLIF(v_ele->>'option_id','')::UUID INTO v_picked;
          IF v_picked IS NOT NULL THEN
            SELECT qo.is_correct INTO v_correct
            FROM public.quiz_options qo
            WHERE qo.id = v_picked AND qo.question_id = r_q.id;
            v_correct := COALESCE(v_correct, FALSE);
          END IF;
      END CASE;
    END IF;

    IF v_correct THEN
      v_score := v_score + r_q.marks;
    END IF;

    INSERT INTO public.quiz_answers (
      attempt_id,
      question_id,
      selected_option_id,
      selected_option_ids,
      text_answer,
      ordered_option_ids,
      is_correct
    ) VALUES (
      v_attempt_id,
      r_q.id,
      v_picked,
      v_picked_ids,
      v_text_ans,
      v_ordered_ids,
      v_correct
    );
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

GRANT EXECUTE ON FUNCTION public.get_quiz_paper(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, JSONB) TO authenticated;
