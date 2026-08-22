-- What a session is for: splitting a bill, or only leaving a rating.
--
-- ── Why a second kind exists at all ─────────────────────────────────────────
--
-- The paid half of this product — the low-rating alert and the Google review
-- handoff — only ever fired for a guest who completed a bill split. That is
-- the order in src/pages/Claim.jsx: claim items, mark paid, and only then does
-- RatingCapture open.
--
-- So a restaurant paying $149 a month captured reviews from the minority of
-- tables that split a check. A solo diner, a business lunch on one card, a
-- couple where one person pays, anyone who just wants to leave — none of them
-- ever reached the thing being sold, and the table tent said "Split the check"
-- so they had no reason to scan it.
--
-- src/pages/TableEntry.jsx already had the one-tap rating button and rendered
-- it only when `restaurant.demo` was true, with a comment saying a real
-- restaurant's guests rate after paying. The reasoning given for showing it to
-- prospects — that walking the full split path is "two minutes... longer than
-- the attention this page gets" — is exactly as true for a diner who wants to
-- go home. The button is now shown to everyone; this column is what keeps the
-- resulting rows honest.
--
-- ── Why the session is kept rather than skipped ─────────────────────────────
--
-- A rating-only visit has no bill, so it is tempting to record the rating with
-- no session at all. The session is what makes the rating safe: submitGuestRating
-- reads restaurant_id off the stored session and never from the caller, so the
-- endpoint cannot be pointed at a restaurant by whoever is calling it. Creating
-- a session keeps that property intact, and keeps the two existing limits —
-- the per-address rate limit on createSession, and one rating per session —
-- doing the work they already do.
--
-- ── Why a column and not a convention ───────────────────────────────────────
--
-- The same argument migration 0013 makes for `demo`. A rating-only row is not
-- a bill: it has no items, no participants and a zero total, and anything that
-- counts sessions, averages check sizes or reports on splits would quietly
-- include it and be wrong. Inferring it from "total_amount = 0 and items = []"
-- would work until the first abandoned real split looked identical.
--
-- Defaulted to 'split' so every existing row keeps meaning what it meant.

alter table sessions add column if not exists kind text not null default 'split';

-- Checked, not merely defaulted. The Worker validates this too, but the column
-- is the thing that outlives any one deploy, and a typo'd kind that nothing
-- rejects is a row no query will ever find again.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_kind_check'
  ) then
    alter table sessions
      add constraint sessions_kind_check check (kind in ('split', 'rating_only'));
  end if;
end $$;

-- Partial, for the same reason 0013 indexes demo expiry that way: rating-only
-- rows are a small minority and the only queries that ask about them are the
-- ones that already restrict to them. Indexing the 'split' rows would pay for
-- the whole table to answer a question about a slice of it.
create index if not exists sessions_rating_only on sessions (restaurant_id)
  where kind = 'rating_only';
