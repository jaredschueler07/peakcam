-- ─────────────────────────────────────────────────────────────
-- Migration 021 — close two Supabase security-advisor findings
--
-- Both verified read-only against project owsxnogvufankayfwczl on
-- 2026-09-19 (advisor snapshot 2026-09-18).
--
-- 1. public.rls_auto_enable() — SECURITY DEFINER, owned by postgres,
--    with EXECUTE granted to anon and authenticated, which makes it
--    callable unauthenticated over /rest/v1/rpc/rls_auto_enable
--    (advisor: anon_security_definer_function_executable,
--    authenticated_security_definer_function_executable). It is a
--    maintenance helper; nothing in the app calls it. Revoking EXECUTE
--    is enough — PUBLIC never held it, only the two Supabase roles.
--
-- 2. public.drop_in_immutable_morning() — trigger guard from 017 whose
--    whole body is `raise exception 'Morning conditions are immutable'`.
--    It has no search_path set (advisor:
--    function_search_path_mutable). Its body resolves no objects, so
--    pinning search_path to '' cannot break it.
--
-- ROLLBACK:
--   grant execute on function public.rls_auto_enable() to anon, authenticated;
--   alter function public.drop_in_immutable_morning() reset search_path;
-- ─────────────────────────────────────────────────────────────

revoke execute on function public.rls_auto_enable() from anon, authenticated;

alter function public.drop_in_immutable_morning() set search_path = '';
