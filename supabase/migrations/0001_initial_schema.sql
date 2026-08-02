-- BillTap on Supabase — initial schema.
--
-- Replaces the Base44 entity store. The shape is deliberately close to what
-- Base44 held, because worker/lib/db.js presents the same interface the nine
-- business functions in worker/routes/functions.js already use — and those are
-- the mutation-tested money paths. Rewriting them to speak SQL would be
-- rewriting the most dangerous code in the app for no benefit on day one.
--
-- ── Why the ids are text, not uuid ──────────────────────────────────────────
--
-- Session ids are live in the world. They are in /claim?id= links people have
-- open on their phones right now, and the QR tokens are HMAC-signed over the
-- session id, so a changed id silently invalidates a printed code. Migrated
-- rows keep their Base44 ids verbatim; new rows get a generated one.
--
-- ── Why RLS is on but the Worker bypasses it ────────────────────────────────
--
-- Under Base44, RLS was the only thing standing between a caller and the data,
-- and it was load-bearing. Here it is not: every write already goes through the
-- Worker, which authorises against stored data — the host key for payment
-- confirmation, the participant scope for what a diner may see. That code is
-- tested and it stays.
--
-- RLS is therefore defence in depth rather than the primary control, and the
-- policies are written default-deny so that a mistake fails closed. The anon
-- key can read nothing. If a browser is ever pointed straight at a table, it
-- gets nothing until a policy is written on purpose.

create extension if not exists "pgcrypto";

-- A short, url-safe id for new rows. Matches the shape Base44 produced closely
-- enough that nothing downstream has to care which system minted it.
create or replace function billtap_id() returns text
language sql volatile as $$
  select replace(encode(gen_random_bytes(12), 'base64'), '/', '_');
$$;

-- ── Restaurants ─────────────────────────────────────────────────────────────

create table if not exists restaurants (
  id                      text primary key default billtap_id(),
  name                    text not null,
  slug                    text not null unique,
  owner_id                uuid references auth.users(id) on delete set null,
  -- The Base44 user id this row belonged to before the migration.
  --
  -- owner_id is a Supabase auth uuid and Base44's ids are not uuids, so they
  -- cannot be carried across — and the accounts do not exist in auth.users
  -- until operators sign up on the new project anyway. Every insert carrying a
  -- Base44 owner id would fail the foreign key.
  --
  -- So the data migration parks the old id here and leaves owner_id null. When
  -- auth moves (stage 3), match on email and set owner_id from this. Until
  -- then a migrated restaurant has no Supabase owner, which is correct: nobody
  -- has an account yet.
  legacy_owner_id         text,
  google_review_url       text,
  alert_email             text,
  alert_phone             text,
  rating_threshold        numeric not null default 3,
  plan                    text not null default 'trial',
  trial_ends_at           bigint,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      bigint,
  -- For sales tax nexus. Captured by Stripe Checkout; see scripts/nexus-report.mjs.
  billing_address         jsonb,
  created_at              bigint,
  created_by_id           uuid references auth.users(id) on delete set null,
  created_date            timestamptz not null default now(),
  updated_date            timestamptz not null default now()
);

create index if not exists restaurants_slug_idx on restaurants (slug);
create index if not exists restaurants_owner_idx on restaurants (owner_id);
-- Used once, by the stage 3 backfill that rebuilds owner_id from these.
create index if not exists restaurants_legacy_owner_idx on restaurants (legacy_owner_id);

-- ── Sessions: one split bill ────────────────────────────────────────────────

create table if not exists sessions (
  id                  text primary key default billtap_id(),
  title               text not null,
  receipt_id          text,
  split_mode          text not null default 'itemized'
                      check (split_mode in ('itemized', 'even', 'custom')),
  -- Line items with their claims. jsonb rather than a child table because every
  -- read and write touches the whole array at once, and the claim merge in
  -- joinSession is written against exactly that shape.
  items               jsonb not null default '[]'::jsonb,
  participants        jsonb not null default '[]'::jsonb,
  tax                 numeric not null default 0,
  tip                 numeric not null default 0,
  total_amount        numeric not null default 0,
  image_url           text,
  status              text not null default 'waiting'
                      check (status in ('waiting', 'claiming', 'completed')),
  -- SHA-256 of the secret handed to whoever created the split. Presenting the
  -- secret is what proves you are the host, and it is the only way a
  -- table-tent split has a host at all — that row has no owner.
  host_key_hash       text,
  host_payment_info   jsonb,
  custom_split_config jsonb,
  -- Epoch milliseconds, because the Worker compares it against Date.now().
  expires_at          bigint,
  restaurant_id       text references restaurants(id) on delete set null,
  created_by_id       uuid references auth.users(id) on delete set null,
  -- See legacy_owner_id on restaurants. Same reason, same plan.
  legacy_created_by_id text,
  created_date        timestamptz not null default now(),
  updated_date        timestamptz not null default now()
);

create index if not exists sessions_restaurant_idx on sessions (restaurant_id);
create index if not exists sessions_created_by_idx on sessions (created_by_id);
create index if not exists sessions_status_idx on sessions (status);
-- createSession counts a restaurant's recent guest splits to rate-limit them.
create index if not exists sessions_restaurant_recent_idx
  on sessions (restaurant_id, created_date desc);

-- ── Guest feedback ──────────────────────────────────────────────────────────

create table if not exists guest_ratings (
  id               text primary key default billtap_id(),
  restaurant_id    text not null references restaurants(id) on delete cascade,
  session_id       text references sessions(id) on delete set null,
  stars            integer not null check (stars between 1 and 5),
  routed_to_google boolean not null default false,
  comment          text,
  guest_email      text,
  alerted_at       bigint,
  created_at       bigint,
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now()
);

-- One rating per session: the endpoint is otherwise an unbounded row factory
-- and every extra row is another alert that can be fired at an operator. This
-- was enforced only in application code before; the database can hold it.
create unique index if not exists guest_ratings_one_per_session
  on guest_ratings (session_id) where session_id is not null;
create index if not exists guest_ratings_restaurant_idx on guest_ratings (restaurant_id);

create table if not exists guest_contacts (
  id            text primary key default billtap_id(),
  restaurant_id text not null references restaurants(id) on delete cascade,
  email         text not null,
  opted_in      boolean not null default true,
  visits        integer not null default 1,
  first_seen    bigint,
  last_seen     bigint,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- submitGuestRating looks a contact up by restaurant and email to increment
-- their visit count rather than duplicating them.
create unique index if not exists guest_contacts_unique
  on guest_contacts (restaurant_id, lower(email));

-- ── Sales and marketing ─────────────────────────────────────────────────────

create table if not exists restaurant_leads (
  id              text primary key default billtap_id(),
  restaurant_name text not null,
  contact_name    text,
  email           text not null,
  phone           text,
  locations       text,
  plan_interest   text default 'pilot',
  source          text default 'restaurants_page',
  notified_at     bigint,
  created_at      bigint,
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now()
);

create table if not exists waitlist (
  id           text primary key default billtap_id(),
  email        text not null,
  app          text default 'billtap',
  source       text,
  created_at   bigint,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create unique index if not exists waitlist_email_idx on waitlist (lower(email));

create table if not exists receipts (
  id           text primary key default billtap_id(),
  session_id   text references sessions(id) on delete cascade,
  image_url    text,
  parsed       jsonb,
  created_by_id uuid references auth.users(id) on delete set null,
  legacy_created_by_id text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

-- ── updated_date, without asking every caller to remember ───────────────────

create or replace function touch_updated_date() returns trigger
language plpgsql as $$
begin
  new.updated_date = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'restaurants', 'sessions', 'guest_ratings', 'guest_contacts',
    'restaurant_leads', 'waitlist', 'receipts'
  ] loop
    execute format(
      'drop trigger if exists %I on %I; create trigger %I before update on %I
       for each row execute function touch_updated_date();',
      t || '_touch', t, t || '_touch', t
    );
  end loop;
end $$;

-- ── Row level security ──────────────────────────────────────────────────────
--
-- Enabled on every table with NO policies, which in Postgres means nobody
-- reads and nobody writes. The service role key used by the Worker bypasses
-- RLS by design; the anon key the browser holds gets nothing.
--
-- That is the intended posture. Authorisation lives in the Worker, against
-- stored data, and is tested — the host key for confirming a payment, the
-- participant scope for what one diner may see of another. Adding permissive
-- policies here would create a second, weaker way in.
--
-- Add a policy only when a browser genuinely needs to read a table directly,
-- and write it for the narrowest case that works.

alter table restaurants      enable row level security;
alter table sessions         enable row level security;
alter table guest_ratings    enable row level security;
alter table guest_contacts   enable row level security;
alter table restaurant_leads enable row level security;
alter table waitlist         enable row level security;
alter table receipts         enable row level security;

-- The one exception, and it is narrow: a signed-in operator reading their own
-- restaurant row. Everything a guest sees still comes through the Worker's
-- getPublicRestaurant, which returns four fields and withholds the alert email,
-- the phone number and the Stripe ids.
create policy "owners read their own restaurant"
  on restaurants for select
  using (auth.uid() = owner_id);
