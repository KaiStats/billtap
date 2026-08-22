-- A restaurant we deliberately keep off the billing clock, not one we forgot to put on it.
--
-- ── The hole this closes ────────────────────────────────────────────────────
--
-- shared/entitlement.js fails open on a trial row with no `trial_ends_at`:
-- that is the right call for a genuine gap in our own data entry, but it made
-- "this trial is deliberately open-ended" and "nobody ever wrote a date" the
-- same row, indistinguishable from each other and from an accident. Migration
-- 0011 closed the accident — every trial row now gets a real fourteen-day
-- date, including Mariposa's — which is correct and also means she is now on
-- the same clock as every paying restaurant, with nobody having decided that.
--
-- She is the first pilot and the live sales demo. Her alert going silent
-- because a trial clock ran out under her is not a business decision anybody
-- made; it is this column's absence wearing a NULL-shaped disguise.
--
-- ── Why a column and not another NULL ───────────────────────────────────────
--
-- Pricing is $149/mo for everybody, nobody grandfathered. This is not a
-- pricing exception — `plan` and `trial_ends_at` are untouched, and if she
-- ever pays, the active-subscription path applies exactly as it does to
-- anyone else. This flag only says the trial/subscription clock is not the
-- thing deciding whether her demo works, because that was never meant to be
-- an accident of data entry.
--
-- shared/entitlement.js reads it before the trial/plan checks, the same
-- position the `demo` arm reads from and for the same reason: there is no
-- billing question here for those checks to answer. Unlike `demo`, it never
-- expires and nothing in worker/routes/retention.js touches it — a demo page
-- is stood up for a stranger and torn down after the call; this is our own
-- restaurant, kept on purpose, for as long as it is useful as a live demo.
--
-- Not settable through saveMyRestaurant: worker/routes/functions.js's
-- restaurantPatch() is an allow-list that does not mention this column, the
-- same way it already excludes plan, trial_ends_at and the Stripe ids.

alter table restaurants add column if not exists reference_account boolean not null default false;

-- Mariposa, specifically — the one row this migration is for. Matched by slug
-- rather than by id so this reads correctly wherever it runs; the slug is
-- unique and is what the printed cards and the sales pitch both point at.
update restaurants
set reference_account = true
where slug = 'mariposa';
