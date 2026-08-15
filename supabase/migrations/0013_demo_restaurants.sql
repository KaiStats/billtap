-- Pages we stand up for strangers, and the clock that takes them down again.
--
-- ── What this is for ────────────────────────────────────────────────────────
--
-- The demo that sells this product is the owner tapping two stars on a page
-- carrying his own restaurant's name and watching the alert arrive while he is
-- still holding the phone. Imagining the name does not close; seeing it does.
--
-- Until now that meant typing a `restaurants` row into the SQL editor the night
-- before, which caps a day's selling at the prospects somebody planned for. It
-- also fails in a way nobody sees coming: 0011 gave the column a fourteen-day
-- default, so a row set up three weeks ago takes the two stars, looks entirely
-- alive doing it, and then sends nothing — because shared/entitlement.js has
-- expired the trial. The single moment the whole demo exists to produce is the
-- moment it silently skips.
--
-- ── Why a column and not a convention ───────────────────────────────────────
--
-- A demo row is not a customer. Nobody signed up, nobody was asked, and the
-- name on it belongs to a business that has not agreed to anything. Every rule
-- in this schema that protects a restaurant — the trial clock, the retention
-- promise, the reconcile against Stripe — is written for a row somebody owns,
-- and applying those rules to a page we put up for a stranger gets each one
-- backwards. So the row says what it is, and the code branches on it.
--
-- ── Why it expires on its own ───────────────────────────────────────────────
--
-- The alternative is an accumulating pile of live pages bearing the names of
-- businesses that said no. Twenty-four hours is longer than any sales call and
-- shorter than anyone's memory of one; a demo that outlives the conversation it
-- was made for is not a demo, it is an unauthorised page with our name at the
-- bottom of it.
--
-- Nullable on purpose. A demo with no expiry is served — entitlement.js fails
-- open at every ambiguity and this is one — because a demo that does nothing
-- while a prospect is watching is the failure this build exists to prevent.
-- The cleanup job in worker/routes/retention.js is what makes the clock real;
-- the column is only what it reads.

alter table restaurants add column demo boolean not null default false;

-- Epoch milliseconds as bigint, matching trial_ends_at and current_period_end.
-- 0011 established the representation and shared/entitlement.js depends on it:
-- every clock in that file is `Number(column)` compared against `Date.now()`.
-- A timestamptz here would coerce to NaN, `now < NaN` is false for every value,
-- and every demo would read as expired the moment it was created.
alter table restaurants add column demo_expires_at bigint;

-- Partial, because demo rows are a rounding error next to real ones and the
-- only query that ever asks about this column is the nightly delete, which
-- already restricts to demos. Indexing the nulls would be paying for the whole
-- table to answer a question that is only ever about a handful of rows.
create index restaurants_demo_expiry on restaurants (demo_expires_at) where demo;

-- ── What is deliberately not done here ─────────────────────────────────────
--
-- No backfill, and no attempt to find the hand-made demo rows that predate
-- this. They are indistinguishable in the schema from a real restaurant set up
-- by hand — which is the whole problem this column solves — and guessing at
-- them by name would risk marking a paying restaurant as disposable. The
-- nightly job hard-deletes what this column marks; a mistake there is not
-- recoverable, so it is only ever allowed to act on rows it can prove.
--
-- Which pages are currently up, for whoever wants to ask:
--
--   select name, slug, alert_email,
--          to_timestamp(demo_expires_at / 1000) at time zone 'America/Los_Angeles' as expires
--   from restaurants
--   where demo
--   order by demo_expires_at;
