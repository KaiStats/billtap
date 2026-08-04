-- A version counter on sessions, so a write can refuse to land on a row that
-- moved underneath it.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
--
-- Everything about a split — who joined, what they claimed, what each person
-- owes, who has paid — lives in two jsonb columns that are rewritten whole on
-- every mutation. There is no per-participant row to update in isolation, so
-- every handler is a read-modify-write, and two of them running at once means
-- the second write reinstates the first's stale snapshot.
--
-- That is not a hypothetical at a table of six. Everyone joins in the same
-- fifteen seconds at the start of a meal and taps "I've sent it" in the same
-- thirty seconds at the end. Measured against the handlers as written: two
-- concurrent joinSession calls leave one diner erased from the split entirely
-- — absent from participants, their item claims cleared, their $40 of a $60
-- bill uncollected — while their own phone was told the join succeeded.
--
-- worker/routes/functions.js has a patchSession() helper whose header describes
-- detecting exactly this and retrying. It could not: it checked its own write's
-- echo (both backends write with return=representation), and a write's echo
-- always contains that write's own change. The loop never ran.
--
-- ── What this gives it ──────────────────────────────────────────────────────
--
-- A column the Worker can condition on. Every mutation reads `version`, writes
-- `version + 1`, and filters the write on the value it read. Postgres evaluates
-- that filter and the update in one statement, so exactly one of two racing
-- writers matches; the other updates zero rows, is told so by the empty
-- representation, and retries against the winner's version. Both changes
-- survive because the retry re-applies on top rather than underneath.
--
-- Cheap: one bigint, no index needed. The filter rides along on the primary-key
-- lookup that was already happening.
--
-- ── Deploy order ────────────────────────────────────────────────────────────
--
-- This migration must be applied BEFORE the Worker that writes the column.
-- The Worker degrades safely if it is not — worker/lib/db.js catches the
-- undefined-column error, falls back to the unconditional write for the rest of
-- the isolate's life, and logs once — but that fallback is the old behaviour,
-- so do not leave it running on it.
--
-- Safe to apply before the Worker ships: nothing reads or writes the column
-- until then, and the default fills existing rows in place.

alter table sessions
  add column if not exists version bigint not null default 0;

comment on column sessions.version is
  'Optimistic-concurrency counter. Read it, write version+1, and filter the '
  'write on the value you read. Zero rows updated means you lost a race and '
  'must re-read and re-apply. See patchSession in worker/routes/functions.js.';
