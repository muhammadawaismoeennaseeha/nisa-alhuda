-- ============================================================
-- Migration 044: Storage policies for answer-sheet uploads
-- ============================================================
-- Migration 042 gave `assignment_submissions` correct table-level RLS but
-- never touched storage. The answer sheets themselves live in the private
-- `resources` bucket, whose only INSERT policy (migration 001) is
-- "Instructors can upload resources" — so every student upload died with
-- `new row violates row-level security policy`. The feature could not work.
--
-- This migration:
--   1. Carves out a `student-submissions/<assignment_id>/<student_id>/…`
--      prefix inside `resources` that students may write to.
--   2. Stops the blanket "any authenticated user can read anything in
--      resources" policy from applying to that prefix — otherwise one
--      sister could read another sister's answer sheet.
--
-- Path contract (see student-assignment-list.tsx):
--   student-submissions/<assignment_id>/<student_id>/<timestamp>-<filename>
--   foldername() →  [1]='student-submissions'  [2]=assignment  [3]=student

-- ── 1. A student may upload only under her own folder ────────────────────
-- The assignment must also be published and she must be enrolled in it —
-- the same three conditions as the assignment_submissions INSERT policy,
-- enforced here too so a stray object can't be parked in the bucket
-- without a matching row.
DROP POLICY IF EXISTS "Students can upload own answer sheets" ON storage.objects;
CREATE POLICY "Students can upload own answer sheets"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'resources'
        AND (storage.foldername(name))[1] = 'student-submissions'
        AND (storage.foldername(name))[3] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.assignment_papers a
            WHERE a.id::text = (storage.foldername(name))[2]
              AND a.is_published
              AND public.is_enrolled(a.offering_id)
        )
    );

-- ── 2. Reading answer sheets: the owner, or teaching staff ───────────────
-- First shrink the blanket read policy so it no longer covers submissions.
-- Course material (lesson resources, question papers) is still readable by
-- any signed-in user, exactly as before.
DROP POLICY IF EXISTS "Authenticated users can view resources" ON storage.objects;
CREATE POLICY "Authenticated users can view resources"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'resources'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] IS DISTINCT FROM 'student-submissions'
    );

DROP POLICY IF EXISTS "Students can view own answer sheets" ON storage.objects;
CREATE POLICY "Students can view own answer sheets"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'resources'
        AND (storage.foldername(name))[1] = 'student-submissions'
        AND (storage.foldername(name))[3] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Staff can view answer sheets" ON storage.objects;
CREATE POLICY "Staff can view answer sheets"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'resources'
        AND (storage.foldername(name))[1] = 'student-submissions'
        AND (
            public.has_role('admin'::user_role)
            OR public.has_role('instructor'::user_role)
            OR public.has_role('ta'::user_role)
        )
    );
