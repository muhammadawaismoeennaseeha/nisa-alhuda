-- ============================================================
-- Migration 038: Course assistants (TA ↔ course assignment)
-- ============================================================
-- A many-to-many join between a Teaching Assistant (a profile holding the
-- `ta` role) and the offerings (courses) they help with. One TA can assist
-- several courses; one course can have several TAs. Admins assign; the
-- assignment is what scopes a TA to "only their courses" everywhere else.
--
-- This migration also adds `assists_offering(uuid)` — a SECURITY DEFINER
-- helper that later teaching-data policies (migration 039+) use to let an
-- assigned TA act on a course's lessons, subjects, quizzes and gradebook,
-- exactly as that course's instructor can. Nothing financial ever keys off
-- this table.

CREATE TABLE IF NOT EXISTS public.course_assistants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  UUID NOT NULL REFERENCES public.offerings(id) ON DELETE CASCADE,
  assistant_id UUID NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  assigned_by  UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offering_id, assistant_id)
);

CREATE INDEX IF NOT EXISTS course_assistants_assistant_idx
  ON public.course_assistants (assistant_id);
CREATE INDEX IF NOT EXISTS course_assistants_offering_idx
  ON public.course_assistants (offering_id);

ALTER TABLE public.course_assistants ENABLE ROW LEVEL SECURITY;

-- Does the current auth user assist the given offering? SECURITY DEFINER so
-- it can be called from other tables' policies without needing a direct
-- SELECT grant on course_assistants.
CREATE OR REPLACE FUNCTION public.assists_offering(target_offering UUID)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_assistants
    WHERE offering_id = target_offering
      AND assistant_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.assists_offering(UUID) IS
  'True if the current auth user is assigned as a TA on the given offering. Use in RLS to grant an assigned TA the same course-scoped teaching rights as that course''s instructor.';

-- Admins manage assignments fully.
CREATE POLICY course_assistants_admin_all ON public.course_assistants
  FOR ALL
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

-- Read access: an admin, the course's own instructor, or the TA themselves
-- may see an assignment row. (Writes stay admin-only via the policy above.)
CREATE POLICY course_assistants_read ON public.course_assistants
  FOR SELECT
  USING (
    has_role('admin')
    OR assistant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.offerings o
      WHERE o.id = course_assistants.offering_id
        AND o.instructor_id = auth.uid()
    )
  );
