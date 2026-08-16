-- A second stamp, so a low rating can page twice: once now, once with detail.
--
-- ── The guest this was losing ───────────────────────────────────────────────
--
-- The alert only fired when a guest tapped "Send to the manager" after writing
-- something. Tapping one star and walking out paged nobody: the rating was
-- stored, the operator found it on a dashboard days later, and the product's
-- entire promise — reach them while they are still in the building — did not
-- happen.
--
-- That is backwards on exactly the guest it matters most for. Somebody angry
-- enough to type a paragraph is already engaged and half-recoverable. The one
-- who taps one star and leaves without a word is the one who is not coming
-- back, and they were the only one the manager never heard about.
--
-- ── Why a second column instead of clearing the first ───────────────────────
--
-- alerted_at is not a bookkeeping field, it is a spend cap. Its comment in
-- worker/routes/rating-alert.js is explicit: the endpoint takes no credentials,
-- so without a dedupe the same rating_id can be replayed for as long as anyone
-- cares to, and every replay is another email and another SMS on accounts with
-- no ceiling. Clearing or bypassing it on a flag from the caller would hand
-- that back.
--
-- So the cap becomes two rather than one, and the second is not caller-
-- controlled: a follow-up is only sent when the row itself has acquired a
-- comment it did not have when the first went out. No comment, no second
-- email, however many times anyone posts the id.

alter table guest_ratings add column if not exists comment_alerted_at bigint;

-- ── Backfill, or every historical alert can fire a duplicate ───────────────
--
-- Under the old flow the comment was written *before* the single alert went
-- out, so that email already carried it. Those rows land here with alerted_at
-- set, a comment present, and this column empty — which is exactly the shape
-- the new logic reads as "first page sent, detail still owed", and it would
-- send the same paragraph a second time.
--
-- Stamped with alerted_at rather than now(): the detail did go out, and it went
-- out then. A row alerted with no comment is left alone, because if that guest
-- ever adds one they are genuinely owed the follow-up.

update guest_ratings
set comment_alerted_at = alerted_at
where alerted_at is not null
  and comment is not null
  and length(btrim(comment)) > 0
  and comment_alerted_at is null;

-- ── What each stamp means ──────────────────────────────────────────────────
--
--   alerted_at          the manager was paged that a low rating happened
--   comment_alerted_at  the manager was sent what the guest went on to say
--
-- Null on both is a rating nobody has been told about — which after this is
-- either an unentitled restaurant, deliberately, or a job that has not run.
--
-- Existing rows keep alerted_at and get a null here, so a rating that was
-- already alerted before this migration will send exactly one follow-up if its
-- guest ever adds a comment, and otherwise nothing.
