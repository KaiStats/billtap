-- An append-only record of the actions that move money or expose people.
--
-- Written by worker/lib/audit.js. Read the header there for what belongs in it
-- and what must never be put in it; this file enforces the half that a database
-- can enforce.
--
-- ── Why append-only is a constraint and not a convention ────────────────────
--
-- The value of this table is entirely in nobody being able to change it. A
-- payment dispute is settled by a row that says the host confirmed $23.40 at
-- 8:42pm — and that settles nothing if the host, or the app, or anyone holding
-- the service role key, could have written it afterwards or quietly removed it.
--
-- So update and delete are revoked from every role. The service role bypasses
-- row level security but it does not bypass a missing grant, which is why the
-- protection is written this way round rather than as a policy.

create table if not exists audit_log (
  id                      bigserial primary key,
  action                  text not null,
  at                      timestamptz not null default now(),

  -- Ties a row to the exact failure a caller saw and to the Worker log line.
  -- See worker/lib/errors.js — the caller is shown this id, so someone can
  -- report "it said error, request 4f2a91" and be found in one query.
  request_id              text,

  session_id              text,
  restaurant_id           text,

  -- Three identities, kept apart on purpose.
  --
  -- actor_user_id was verified against the auth provider. actor_host_key_fp was
  -- checked against the hash stored on the session — the host key itself is
  -- never stored here, since a table that exists to be read later must not
  -- contain the secret that authorises confirming payments.
  -- actor_participant_claim is whatever the browser sent. It is a claim. A
  -- column that blurred the three would make the whole table evidence of
  -- nothing.
  actor_user_id           uuid,
  actor_host_key_fp       text,
  actor_participant_claim text,

  -- Truncated SHA-256, not the address. Answers "same source as before"
  -- without accumulating a record of who ate where.
  source_ip_fp            text,
  user_agent              text,

  outcome                 text not null default 'ok'
                          check (outcome in ('ok', 'denied', 'failed')),

  -- Allow-listed scalars only — see safeDetail() in worker/lib/audit.js.
  -- Amounts live here, because "confirmed $23.40 for p_17…" is the entire
  -- content of a payment dispute.
  detail                  jsonb not null default '{}'::jsonb
);

-- The three questions this table gets asked, in the order it gets asked them.
create index if not exists audit_log_session_idx    on audit_log (session_id, at desc);
create index if not exists audit_log_restaurant_idx on audit_log (restaurant_id, at desc);
create index if not exists audit_log_action_idx     on audit_log (action, at desc);
-- "What else happened on the request that failed?"
create index if not exists audit_log_request_idx    on audit_log (request_id) where request_id is not null;

alter table audit_log enable row level security;

-- No policies, so no browser reads this, ever. Under the anon key that is
-- already true of every table here; stated explicitly because this one holds
-- the shape of every dispute the app has ever had.

-- ── Append-only, enforced ───────────────────────────────────────────────────
--
-- Insert only. Revoked from every role including the ones the Worker uses, so a
-- future code path cannot quietly acquire the ability to rewrite history — and
-- neither can anyone who obtains the service role key.
--
-- Corrections are new rows. That is not a workaround, it is the correct shape:
-- an audit trail that can be edited is a document, and a document is not
-- evidence.

revoke update, delete, truncate on audit_log from anon, authenticated, service_role;
grant insert, select on audit_log to service_role;
grant usage, select on sequence audit_log_id_seq to service_role;

-- A trigger as well as the grant. Belt and braces, because the grant can be
-- undone by any later migration that says `grant all`, and this cannot be
-- undone by accident.
create or replace function audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_is_append_only();
