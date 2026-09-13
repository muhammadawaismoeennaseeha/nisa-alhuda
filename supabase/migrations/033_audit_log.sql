-- ============================================================
-- Migration 033: audit_log — one trail for every sensitive admin action
-- ============================================================
-- Before this, a role change, a payment approval, or an enrollment
-- rejection left no record of WHO did it or WHEN. This table is that
-- record. It is deliberately generic (one row = one action) so future
-- modules (grades, transcripts, payments redesign) can write to the same
-- trail instead of inventing per-feature logs.
--
-- Writes: only ever through the service-role admin client, from server
-- actions that have already passed requireRole(). Because RLS is enabled
-- and there is NO insert policy for authenticated/anon, the app can never
-- forge a row from the browser — the trail is append-only from trusted
-- server code.
--
-- Reads: admins only. This log names people and describes money and role
-- decisions, so instructors/treasurers/students must not see it.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who acted. actor_id can go NULL if the account is later deleted, but
  -- actor_email / actor_name are frozen SNAPSHOTS taken at action time so
  -- the trail stays readable even after the person is gone.
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  actor_name   TEXT,
  -- What happened. `action` is a stable machine key (e.g. "user.roles_updated");
  -- `summary` is the human sentence shown in the UI.
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  summary      TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON public.audit_log (actor_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admins may read the whole trail. No INSERT/UPDATE/DELETE policy exists on
-- purpose: writes come from the service-role client (which bypasses RLS),
-- and nobody — not even an admin — may edit or delete history from the app.
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
