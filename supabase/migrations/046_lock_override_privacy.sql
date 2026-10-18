-- ============================================================
-- Migration 046: Keep the admin lock override off the public wire
-- ============================================================
-- Migration 043 added `lock_override`, `lock_override_note`,
-- `lock_override_at` and `lock_override_by` to `profiles` with the comment
-- "Students cannot read their own lock_override (no need to expose it)".
-- That was never true. The profiles SELECT policy from migration 001 is
-- `USING (true)`, and RLS is row-level — it cannot hide a column. Anyone
-- holding the publishable anon key could read every sister's lock status
-- AND the admin's free-text reason for it:
--
--   curl "$URL/rest/v1/profiles?select=full_name,lock_override_note" \
--        -H "apikey: $ANON_KEY"
--
-- Column privileges are the only lever that works here. Note that a
-- column-level REVOKE cannot subtract from a table-level grant, so we
-- revoke SELECT wholesale and grant back the columns that really are
-- public (names and avatars are shown on the catalog, so they must stay
-- readable by `anon`).
--
-- ⚠ MAINTENANCE: because the grant is now column-scoped, any future
--   `ALTER TABLE profiles ADD COLUMN` is invisible to anon/authenticated
--   until it is added to the GRANT below. Decide per column whether it
--   belongs there — that choice is now explicit, which is the point.

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  full_name,
  avatar_url,
  role,
  roles,
  phone,
  is_suspended,
  must_change_password,
  created_at,
  updated_at
) ON public.profiles TO anon, authenticated;

-- The one thing a student legitimately needs from the override: whether
-- SHE is locked, and the note to show her on the locked screen. Exposed
-- through a definer function so the columns stay unreadable in general.
-- Used by the dashboard layout's payment-block gate.
CREATE OR REPLACE FUNCTION public.my_lock_state()
RETURNS TABLE (lock_override BOOLEAN, lock_override_note TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.lock_override, p.lock_override_note
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.my_lock_state() IS
  'The calling user''s own admin lock override and note. The underlying profiles columns are not SELECT-able by anon/authenticated (migration 046); admin tooling reads them through the service-role client.';

GRANT EXECUTE ON FUNCTION public.my_lock_state() TO authenticated;
