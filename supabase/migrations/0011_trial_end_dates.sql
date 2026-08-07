-- Give every restaurant a trial that actually ends.
--
-- ── The hole ────────────────────────────────────────────────────────────────
--
-- `trial_ends_at` is written in exactly one place: saveMyRestaurant, when a
-- restaurant is created through the product. A row typed into the SQL editor
-- gets none — the column is nullable with no default — and until now nothing
-- read the value anyway, so nobody noticed.
--
-- worker/lib/entitlement.js reads it now, and it fails open: a trial with no
-- end date is treated as running. That is the right way for the code to fail,
-- because refusing service over a gap in our own data entry would take away
-- something a restaurant may well be paying for. But "fails open" is a
-- description of a hole, not a plan. Left alone, every hand-created restaurant
-- is free forever, which is exactly the state Mariposa was in.
--
-- Two changes, and they close it from both ends.
--
-- ── Existing rows ───────────────────────────────────────────────────────────
--
-- Fourteen days from now, not fourteen days from created_date.
--
-- Dating from creation would have every affected row expire the moment this
-- migration lands — Mariposa's was created during the Supabase cutover, days
-- ago. That is a service cut delivered with no notice, to restaurants whose
-- only mistake was being set up by hand, and the first they would know is a
-- guest tapping a dead Google button.
--
-- Fourteen days from today is the same trial everyone else gets, starting when
-- the trial first meant anything. It is also roughly when the product became
-- real for them: the settings pane that lets an operator set their own review
-- link only started working today.

update restaurants
set trial_ends_at = (extract(epoch from now()) * 1000)::bigint + 14 * 86400000
where trial_ends_at is null
  and plan = 'trial';

-- A subscribed row with no trial date needs nothing: entitlement reads `plan`
-- and `current_period_end` for those, never the trial. Deliberately untouched
-- rather than backfilled with a date that would mean nothing.

-- ── New rows ────────────────────────────────────────────────────────────────
--
-- The column default is what stops this recurring. saveMyRestaurant sets the
-- value explicitly and is unaffected; this is for the next row somebody types
-- into the SQL editor at midnight, which is how the last one got here.

alter table restaurants
  alter column trial_ends_at set default ((extract(epoch from now()) * 1000)::bigint + 14 * 86400000);

-- ── Who is now on a clock ───────────────────────────────────────────────────
--
--   select name, slug, plan,
--          to_timestamp(trial_ends_at / 1000) at time zone 'America/Los_Angeles' as trial_ends,
--          to_timestamp(current_period_end / 1000) at time zone 'America/Los_Angeles' as period_ends
--   from restaurants
--   order by trial_ends_at nulls first;
--
-- A row still showing NULL after this ran is a subscribed one, which is
-- correct. A trial row showing NULL means the update above did not run.
