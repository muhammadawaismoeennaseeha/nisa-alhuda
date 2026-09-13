-- ============================================================
-- Migration 040: lock down the email-lookup helpers
-- ============================================================
-- 032 created get_profile_by_email() and email_exists() as SECURITY
-- DEFINER functions that read auth.users + public.profiles. Postgres
-- grants EXECUTE on new functions to PUBLIC by default, so the anon
-- (and authenticated) Supabase roles could call them directly:
--
--   * email_exists('x@y.com')        -> account-enumeration oracle
--   * get_profile_by_email('x@y.com')-> leaks a member's id + full_name
--
-- Every legitimate caller uses the service_role admin client
-- (createAdminClient) server-side: the public enrolment check and the
-- admin credentials/offerings actions. anon/authenticated never need
-- these, so we drop the default grant and hand EXECUTE to service_role
-- only. email_exists currently has no caller at all; it is kept (not
-- dropped) but likewise closed to anon.
--
-- Pure grant/hardening change: no signature or body change, so the
-- service_role RPC calls are unaffected and no redeploy is required.
-- REVOKE/GRANT/ALTER ... SET are idempotent -- safe to re-run.

-- 1. Remove the default PUBLIC EXECUTE grant, and any direct grants to
--    the client-facing roles.
REVOKE EXECUTE ON FUNCTION public.get_profile_by_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_profile_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_by_email(text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.email_exists(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_exists(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_exists(text) FROM authenticated;

-- 2. Grant EXECUTE to the only role that legitimately calls them.
GRANT EXECUTE ON FUNCTION public.get_profile_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO service_role;

-- 3. Defense-in-depth for SECURITY DEFINER: pin an empty search_path so
--    object resolution can't be hijacked. Both bodies already fully
--    schema-qualify auth.users / public.profiles, so '' is safe.
ALTER FUNCTION public.get_profile_by_email(text) SET search_path = '';
ALTER FUNCTION public.email_exists(text) SET search_path = '';
