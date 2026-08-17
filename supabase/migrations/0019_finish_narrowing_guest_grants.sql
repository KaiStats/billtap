-- Finish the job 0014 started.
--
-- ── What 0014 did, and what it missed ───────────────────────────────────────
--
-- 0014 revoked every write privilege from anon and authenticated on three
-- tables: restaurants, guest_ratings, guest_contacts. Its reasoning is worth
-- re-reading because it applies, word for word, to five more that were left
-- carrying the full set:
--
--   "the grant is the thing that will still be there on the day somebody turns
--    an inert DELETE grant into a live one, in a single statement, with no
--    second thought"
--
--   "The defence-in-depth argument is the whole argument. This is the layer
--    that does not depend on the policy list being right."
--
-- What was actually still granted to anon and authenticated, found by running
-- 0014's own verification query against production:
--
--   sessions          DELETE, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER
--   receipts          DELETE, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER
--   restaurant_leads  DELETE, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER
--   waitlist          DELETE, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER
--   audit_log         INSERT, REFERENCES, TRIGGER
--
-- sessions and receipts are the bill data itself — every split, every line item,
-- every amount somebody owes. audit_log is the append-only record a payment
-- dispute is settled from, and anon held INSERT on it, which is the privilege
-- you would need to write false evidence into it.
--
-- ── Why RLS is not already enough ───────────────────────────────────────────
--
-- It very nearly is, and that is the trap. Every one of these tables has RLS
-- enabled with no policies, so DELETE, INSERT, UPDATE and SELECT are all denied
-- by default and the grants above are inert today.
--
-- Two things make them worth removing anyway. TRUNCATE is not subject to row
-- level security at all — it is a table-level operation, so no policy anywhere
-- can deny it, and the only thing standing between the anon role and an empty
-- sessions table is that PostgREST happens not to expose it. And the day
-- somebody adds `for all using (true)` to fix a read — the exact mistake 0014
-- names — every one of these becomes live at once, on the tables where it costs
-- the most.
--
-- ── What is deliberately kept ───────────────────────────────────────────────
--
-- SELECT, for the same reason 0014 kept it: RLS denies it regardless, removing
-- it buys nothing, and it would have to be undone the first time a client-facing
-- read is added.
--
-- service_role is untouched. It is what the Worker acts as, it bypasses RLS by
-- design, and every write in this app goes through it — verified before writing
-- this: there is not one `.from(` call anywhere in src/, so the browser never
-- reaches a table directly.

revoke insert, update, delete, truncate, references, trigger
  on table public.sessions, public.receipts, public.restaurant_leads,
           public.waitlist, public.audit_log
  from anon, authenticated;

-- ── Functions the API should not expose ─────────────────────────────────────
--
-- Supabase's linter flags five of these as callable by anon over
-- /rest/v1/rpc/. Four are trigger or event-trigger functions, which Postgres
-- refuses to invoke directly whatever the grant says, so the practical exposure
-- was billtap_id() alone — a random id generator, harmless to call and still
-- no business being a public endpoint.
--
-- Revoked rather than argued about: none of the five is meant to be called by a
-- client, a trigger fires without consulting the calling role's EXECUTE
-- privilege, and service_role keeps its grant regardless. The advisor goes
-- quiet, which matters because an advisor with known-acceptable warnings in it
-- is one nobody reads.

revoke execute on function public.claim_restaurants_for_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.billtap_id() from anon, authenticated;
revoke execute on function public.touch_updated_date() from anon, authenticated;
revoke execute on function public.audit_log_is_append_only() from anon, authenticated;

-- ── A fixed search_path on the three that lacked one ────────────────────────
--
-- Not SECURITY DEFINER, so this is hygiene rather than an escalation fix: a
-- mutable search_path lets whoever calls the function decide which `now()` or
-- `gen_random_bytes()` it resolves to. Pinning it to pg_catalog and public
-- removes the question. The two SECURITY DEFINER functions already set theirs.

alter function public.touch_updated_date() set search_path = pg_catalog, public;
alter function public.audit_log_is_append_only() set search_path = pg_catalog, public;
alter function public.billtap_id() set search_path = pg_catalog, public;

-- ── Confirming it took ──────────────────────────────────────────────────────
--
-- Expect SELECT and nothing else for the two guest roles across every table,
-- and the unchanged full set for service_role:
--
--   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and grantee in ('anon','authenticated','service_role')
--   group by table_name, grantee
--   order by table_name, grantee;
