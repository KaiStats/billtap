-- Two unrelated things that both live in the schema: ids that survive a URL,
-- and the column the retention job needs to do what the privacy policy says.

-- ── billtap_id() produced ids that break in a query string ──────────────────
--
-- The old definition:
--
--   select replace(encode(gen_random_bytes(12), 'base64'), '/', '_');
--
-- base64's alphabet is A–Z a–z 0–9 + /. That replaced the slash and left the
-- plus, and a plus in a query string is not a plus — it is the encoding of a
-- space, and every URL parser in existence decodes it as one.
--
-- Session ids travel in query strings. src/pages/SessionHost.jsx builds
--   `${origin}/claim?id=${sessionId}`
-- for the QR code and for the SMS and email share, and NewReceipt navigates to
-- /session-host?id=<id> the moment a split is created. All of it interpolated
-- raw, no encodeURIComponent.
--
-- 12 random bytes is 16 base64 characters, so the chance of at least one plus
-- is 1 - (63/64)^16 — measured over 10,000 generated ids at 22.5%. Slightly
-- more than one split in five would have produced a session whose id came back
-- from the URL with a space in it: getSessionAsHost answering "Session not
-- found" on the host's own screen, immediately after they created the bill, and
-- a QR code on the table that nobody at it can open.
--
-- This is latent rather than live — DATA_BACKEND is unset, so ids are still
-- Base44's and this function has not minted the ones in circulation. It would
-- have become live on the first cutover, which is exactly the wrong moment to
-- find one bill in five unreachable.
--
-- translate() rather than two replaces: same statement, both characters, and it
-- cannot be half-applied by someone editing it later.
--
-- Only new rows are affected. Existing ids are untouched on purpose — they are
-- in printed QR codes and in links on people's phones, and the HMAC in
-- generateQRSignature is computed over the id, so changing one invalidates a
-- code that is sitting on a table. The client-side encodeURIComponent that
-- lands with this migration is what protects the ids that already exist.

create or replace function billtap_id() returns text
language sql volatile as $$
  select translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_');
$$;

comment on function billtap_id() is
  'base64url, not base64. A plus decodes as a space in a query string and these '
  'ids travel in /claim?id= links and QR codes. See migration 0006.';

-- ── Retention ───────────────────────────────────────────────────────────────
--
-- src/pages/Privacy.jsx publishes a retention schedule, cites CCPA, and says of
-- three separate data types that they are handled "automatically":
--
--   Guest display names        30 days after session completion  → "[removed]"
--   Item claim associations    30 days after session completion  → cleared
--   Receipt images             30 days after session completion  → deleted
--
-- Nothing implemented any of it. There is one cron in wrangler.jsonc and it
-- runs the nightly backup; a search of the Worker, the client and the scripts
-- finds no delete of any kind. Guest names, claim lists and receipt photographs
-- were kept indefinitely while a published policy said they were not.
--
-- worker/routes/retention.js is what does it now. This column is how it knows
-- which sessions it has already handled — without it the job either rescans
-- everything forever or redacts the same rows nightly, and the second one
-- quietly rewrites `updated_date` and moves the goalposts for every other rule.

alter table sessions
  add column if not exists redacted_at bigint;

comment on column sessions.redacted_at is
  'Epoch ms when the retention job removed guest names, claim lists and the '
  'receipt image. Null means still within the retention window.';

-- The retention scan: oldest un-redacted sessions first. Partial, so it indexes
-- only the rows the job can still act on and shrinks as the job catches up —
-- the redacted ones leave the index rather than accumulating in it.
create index if not exists sessions_retention_idx
  on sessions (updated_date)
  where redacted_at is null;

-- ── A foreign key that had no index ─────────────────────────────────────────
--
-- receipts.session_id references sessions(id) on delete cascade. Postgres does
-- not index a foreign key for you, and without one every delete of a session
-- sequentially scans receipts to find the children. Nothing deleted sessions
-- before, so it never showed; the retention job above is the first thing that
-- will, and a nightly job that table-scans is how a maintenance task turns into
-- an outage at 3am.

create index if not exists receipts_session_idx on receipts (session_id);
