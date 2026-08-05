-- Every failure the Worker produced, kept long enough to be useful.
--
-- Written by worker/lib/error-log.js. Read the header there for what is put in
-- a row and — more importantly — what is kept out of one.
--
-- ── Why this table exists when two other places already have the data ───────
--
-- Cloudflare Workers Logs has every one of these lines and keeps them for
-- days. Sentry has the 5xx and keeps them for months, but only the 5xx, only
-- when a DSN is bound, and only as much request context as is safe to send a
-- third party.
--
-- Neither can answer "every 4xx on /api/fn/joinSession last Tuesday evening",
-- which is the question a restaurant's report actually turns into, and neither
-- retains for the ninety days the operations policy calls for. This does, in
-- the database the app already runs on, queryable with SQL.
--
-- ── Why this one is NOT append-only, when audit_log is ──────────────────────
--
-- audit_log is evidence: a payment dispute is settled by a row nobody could
-- have edited, so update and delete are revoked from every role and enforced by
-- a trigger. This is diagnostics. It has a retention period, which means
-- something has to be able to delete from it, and pretending otherwise would
-- either break the retention job or produce a table that grows forever.
--
-- The two are deliberately different tables for that reason. Putting
-- diagnostics in audit_log would have forced a delete grant onto the evidence.

create table if not exists error_log (
  id            bigserial primary key,

  -- Filter axis 1. Indexed descending because every question about this table
  -- starts with "recently".
  at            timestamptz not null default now(),

  -- The six characters the caller was shown. See worker/lib/errors.js: someone
  -- reports "it said error, request 4f2a91" and this is what makes that one
  -- query rather than a conversation.
  request_id    text,

  -- Filter axis 2. The route, not the full URL — a URL carries query strings,
  -- and a query string on this app carries session ids.
  route         text not null,
  method        text,

  -- Filter axis 3.
  severity      text not null default 'error'
                check (severity in ('warn', 'error', 'fatal')),

  status        integer,
  code          text,

  -- The sentence, after redaction. Never the raw upstream message.
  message       text,

  -- The private half of the two-layer split. This is the whole reason the
  -- table is service-role-only and has no RLS policy: the stack is what makes
  -- a report actionable and is exactly what must never reach a browser.
  stack         text,

  -- Which browser session was in front of it. Not a user id — most traffic here
  -- is anonymous diners — and not an address. See worker/lib/error-log.js.
  session_ref   text,

  -- The request input, ALLOW-LISTED, never the raw body.
  --
  -- The literal ask was to capture request input. On this app a request body is
  -- a receipt: people's names, what they ordered, what they owe. Copying it
  -- here would rebuild, in a ninety-day table, precisely the data
  -- worker/routes/retention.js exists to remove from sessions at thirty. So
  -- what lands here is the shape of the input — which fields were present,
  -- their types and sizes, and the scalars on a fixed allow-list — which is
  -- what a diagnosis needs and none of what it does not.
  input         jsonb not null default '{}'::jsonb,

  environment   text
);

-- The three filters the spec names, each as a leading column so an index can
-- serve it, each paired with `at desc` because every one of them is asked
-- about a time range.
create index if not exists error_log_at_idx       on error_log (at desc);
create index if not exists error_log_route_idx    on error_log (route, at desc);
create index if not exists error_log_severity_idx on error_log (severity, at desc);
-- "What else happened on the request the caller reported?"
create index if not exists error_log_request_idx  on error_log (request_id) where request_id is not null;

alter table error_log enable row level security;

-- No policies at all, which under RLS means no role reaches a row through
-- PostgREST except one that bypasses RLS. Stated rather than assumed, because
-- this table holds the stack traces the public error handler exists to hide.

revoke all on error_log from anon, authenticated;
grant insert, select, delete on error_log to service_role;
grant usage, select on sequence error_log_id_seq to service_role;

-- ── Retention ──────────────────────────────────────────────────────────────
--
-- Ninety days is the floor the policy sets, so ninety days is what this keeps.
-- Called by worker/routes/retention.js on the 09:30 cron, which is also where
-- session redaction runs.
--
-- security definer with a pinned search_path, matching the pattern the rest of
-- this schema uses: the function runs as its owner, and `set search_path` stops
-- a caller-controlled path resolving `error_log` to something else.
create or replace function prune_error_log(older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  -- A floor, not a setting. Passing 7 here to "clean up" would quietly put the
  -- app out of policy, so the function refuses rather than obeys.
  if older_than_days < 90 then
    raise exception 'error_log retention is 90 days minimum; got %', older_than_days;
  end if;

  delete from error_log where at < now() - make_interval(days => older_than_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function prune_error_log(integer) from public, anon, authenticated;
grant execute on function prune_error_log(integer) to service_role;
