-- Where a person's plan lives, as opposed to a restaurant's.
--
-- ── What was wrong ──────────────────────────────────────────────────────────
--
-- The homepage has sold two consumer tiers since it was written: Free "up to 10
-- people per session" and Pro "unlimited party size", with copy promising an
-- upgrade prompt when somebody adds an eleventh person.
--
-- None of it existed. joinSession refuses at fifty participants and has no
-- concept of a plan, so every user has had the same limit, that limit has never
-- been ten, and the upgrade prompt was never built. The Free tier understated
-- what it gave away and the Pro tier charged for something everybody already
-- had.
--
-- `restaurants.plan` is not this. That column is what a restaurant is billed on
-- at $149 a month, and it hangs off a restaurant row. A diner splitting dinner
-- with friends owns no restaurant and never will.
--
-- ── Why a table and not user metadata ───────────────────────────────────────
--
-- auth.users.raw_app_meta_data would need no migration, and it is the wrong
-- place: writing it needs the admin API, reading it back inside Postgres is
-- awkward, and a plan is something support will want to look at, change by
-- hand, and join against. This is a row somebody can SELECT.
--
-- ── The default is what makes it safe ───────────────────────────────────────
--
-- 'free', and the row does not have to exist. resolvePartyLimit in
-- worker/routes/functions.js treats a missing profile exactly as it treats a
-- free one, so the gate is correct for every account that signed up before this
-- migration and for every guest host who has no account at all — which is most
-- of them, because splitting a bill without an account is the whole product.

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  -- 'free' or 'pro'. Text rather than an enum so adding a tier is an insert in
  -- somebody's head rather than a migration that locks the table.
  plan         text not null default 'free',
  -- Set when a plan is granted by hand, which is how the first Pro accounts
  -- will happen: there is no consumer checkout yet. Nullable, because 'free'
  -- was never granted by anyone.
  plan_granted_at bigint,
  plan_note    text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

alter table profiles enable row level security;

-- A person may read their own row and nothing else. There is no policy for
-- insert, update or delete on purpose: a plan is granted by the Worker as
-- service_role or by hand in the dashboard, and a client that could write this
-- column could award itself Pro.
create policy "people read their own profile"
  on profiles for select
  using (auth.uid() = id);

-- service_role is what the Worker acts as, and it is the only thing that needs
-- to write here. Matching the posture 0014 set for the guest tables: the client
-- roles get SELECT and nothing more.
revoke insert, update, delete, truncate, references, trigger on table profiles from anon, authenticated;

-- ── Granting Pro, until there is a checkout ────────────────────────────────
--
--   insert into profiles (id, plan, plan_granted_at, plan_note)
--   select id, 'pro', (extract(epoch from now())*1000)::bigint, 'comped — early user'
--   from auth.users where email = 'someone@example.com'
--   on conflict (id) do update
--     set plan = 'pro',
--         plan_granted_at = excluded.plan_granted_at,
--         plan_note = excluded.plan_note,
--         updated_date = now();
