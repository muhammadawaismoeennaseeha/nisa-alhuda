-- ============================================================
-- Migration 043: Admin Manual Lock/Unlock Override
-- ============================================================
-- Adds a `lock_override` column to profiles so admins can
-- manually force-lock or force-unlock a student's portal
-- access, overriding the automatic payment-block logic.
--
-- Values:
--   NULL  → auto mode (payment-block logic decides)
--   TRUE  → force-locked regardless of payment status
--   FALSE → force-unlocked regardless of payment status
--
-- Also adds `lock_override_note` (optional admin note) and
-- `lock_override_at` (timestamp of last override change).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lock_override         BOOLEAN   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lock_override_note    TEXT      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lock_override_at      TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lock_override_by      UUID      REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT NULL;

-- Index for quick lookup of all manually-locked users (admin dashboard).
CREATE INDEX IF NOT EXISTS idx_profiles_lock_override
  ON public.profiles(lock_override)
  WHERE lock_override IS NOT NULL;

-- Admins can read/write lock_override on any profile.
-- Students cannot read their own lock_override (no need to expose it).
-- Existing RLS on profiles already allows admins to update any row.
-- No new policies needed — admin already has full UPDATE on profiles.
