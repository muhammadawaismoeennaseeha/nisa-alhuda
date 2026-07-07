-- 031: Per-subject external quiz link.
--
-- Adds `quiz_url` to `subjects` so admins can point each subject at an
-- external quiz (Google Form / Typeform / etc.). Rendered on the student
-- subject card as a persistent "Take Quiz" button, alongside the "Join
-- Live" recurring class button.
--
-- Nullable — a subject without a quiz simply doesn't render the button.

ALTER TABLE subjects
    ADD COLUMN IF NOT EXISTS quiz_url TEXT;

COMMENT ON COLUMN subjects.quiz_url IS
  'External quiz link (Google Form, etc.). NULL = no quiz available. Rendered as a "Take Quiz" button on the student subject card.';
