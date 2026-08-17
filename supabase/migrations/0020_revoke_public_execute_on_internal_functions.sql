-- The half of 0019 that did not take, and why.
--
-- 0019 revoked EXECUTE on five internal functions from anon and authenticated,
-- and the advisor kept reporting two of them as callable by anon anyway. The
-- reason is in the ACL: Postgres grants EXECUTE on every new function to PUBLIC
-- by default, and anon and authenticated are members of PUBLIC. Revoking from
-- the roles individually removes a grant they never had; the one that mattered
-- was sitting on PUBLIC the whole time.
--
--   before:  =X/postgres | postgres=X/postgres | service_role=X/postgres
--                ^ the empty grantee is PUBLIC
--   after:   postgres=X/postgres | service_role=X/postgres
--
-- ── Granting before revoking, deliberately ──────────────────────────────────
--
-- Every legitimate caller is named explicitly first, so nothing is taken away
-- that something still needs. supabase_auth_admin is the one that would
-- otherwise be easy to miss: claim_restaurants_for_new_user is the trigger that
-- fires on INSERT into auth.users, which is what hands a restaurant to its owner
-- the first time they sign in. Breaking it would mean an operator signing in and
-- being shown the create-a-restaurant form for a restaurant they already own —
-- the exact failure that function was written to prevent, reintroduced by a
-- security fix.
--
-- Four of the five are trigger or event-trigger functions, which Postgres
-- refuses to invoke over /rest/v1/rpc/ whatever the grant says, so the practical
-- exposure was billtap_id() alone — a random id generator, harmless to call and
-- still no business being a public endpoint. Revoked rather than argued about,
-- because an advisor with known-acceptable warnings in it is one nobody reads.

grant execute on function public.claim_restaurants_for_new_user() to postgres, service_role, supabase_auth_admin;
grant execute on function public.rls_auto_enable() to postgres, service_role;
grant execute on function public.billtap_id() to postgres, service_role;
grant execute on function public.touch_updated_date() to postgres, service_role;
grant execute on function public.audit_log_is_append_only() to postgres, service_role;

revoke execute on function public.claim_restaurants_for_new_user() from public;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.billtap_id() from public;
revoke execute on function public.touch_updated_date() from public;
revoke execute on function public.audit_log_is_append_only() from public;

-- ── Confirming it took ──────────────────────────────────────────────────────
--
--   select p.proname, array_to_string(p.proacl,' | ') as acl,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('claim_restaurants_for_new_user','rls_auto_enable',
--                       'billtap_id','touch_updated_date','audit_log_is_append_only');
--
-- Expect anon_can false on all five, and no bare `=X/` in any ACL.
