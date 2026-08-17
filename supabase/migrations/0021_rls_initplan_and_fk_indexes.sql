-- Two things Supabase's performance linter is right about, and twelve it is not.
--
-- ── auth.uid() per row, instead of once ─────────────────────────────────────
--
-- Both read policies call auth.uid() bare, so Postgres treats it as volatile
-- and re-evaluates it for every candidate row rather than once for the query.
-- Wrapping it in a scalar subquery makes it an InitPlan: evaluated a single
-- time and reused.
--
-- It costs nothing today — an operator has one restaurant and one profile — and
-- it is the kind of thing that only becomes visible as a slow dashboard on the
-- day there is enough data to notice, by which point nobody connects the two.
-- The rewrite is mechanical and the semantics are identical.
--
-- Dropped and recreated rather than altered, for the reason 0001 documents:
-- Postgres has no `create policy if not exists`, so every policy in this repo
-- drops first and this one must too or the file cannot be re-run.

drop policy if exists "owners read their own restaurant" on restaurants;
create policy "owners read their own restaurant"
  on restaurants for select
  using ((select auth.uid()) = owner_id);

drop policy if exists "people read their own profile" on profiles;
create policy "people read their own profile"
  on profiles for select
  using ((select auth.uid()) = id);

-- ── Foreign keys nothing was indexing ───────────────────────────────────────
--
-- Both point at auth.users. Without a covering index every delete of a user
-- makes Postgres scan the whole child table to check the constraint — which is
-- exactly what /api/delete-account now does, deliberately and on request. It is
-- a sequential scan per deletion today and a slow one later, and the index is
-- cheap on tables this size.

create index if not exists receipts_created_by_idx on receipts (created_by_id);
create index if not exists restaurants_created_by_idx on restaurants (created_by_id);

-- ── What is deliberately NOT done ───────────────────────────────────────────
--
-- The linter also reports twelve "unused" indexes and suggests dropping them.
-- Every one is read by something that has not run yet on this database, not by
-- nothing:
--
--   restaurants_demo_expiry        the nightly sweep in worker/routes/retention.js
--   profiles_stripe_subscription   webhook lookups — the first one landed today
--   profiles_stripe_customer       ditto, and create-pro-checkout's reuse check
--   audit_log_session_idx          how a payment dispute is actually researched
--   error_log_*                    the error log reader, opened when something breaks
--   sessions_status_idx            the retention and reconcile passes
--
-- "Never been used" on a database this young means "the job it exists for has
-- not been needed yet", and dropping an index because a nightly task has not
-- fired is how the nightly task becomes a table scan. They stay.
