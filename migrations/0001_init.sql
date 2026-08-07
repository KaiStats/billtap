-- BillTap on Cloudflare D1 — initial schema.
--
-- Mirrors the Base44 entities so the migration can run entity-by-entity behind
-- a shared data layer rather than as one cutover.
--
-- Conventions:
--   * ids are text (uuid) — Base44 ids are strings, so exported rows keep theirs
--     and cross-entity references survive the import unchanged.
--   * timestamps are INTEGER unix milliseconds, matching what the app already
--     writes (Date.now()).
--   * array/object fields are TEXT holding JSON. SQLite has no array type, and
--     these are always read whole, never queried into.
--
-- Apply:  npx wrangler d1 migrations apply billtap --remote

-- ─── Users ────────────────────────────────────────────────────────────────
-- Passwords are deliberately absent. Base44 will not export password hashes,
-- and the chosen auth is magic link + Google, so this table never stores one.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  google_sub    TEXT,              -- Google's stable subject id, set on first Google sign-in
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
-- Case-insensitive: a magic link to Alex@x.com must find alex@x.com.
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));
CREATE UNIQUE INDEX users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;

-- Single-use, short-lived magic-link tokens. Only the hash is stored, so a
-- database leak cannot be replayed into a login.
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

CREATE TABLE sessions_auth (
  id         TEXT PRIMARY KEY,     -- opaque session id, sent as an httpOnly cookie
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_auth_user_idx ON sessions_auth (user_id);
CREATE INDEX sessions_auth_expires_idx ON sessions_auth (expires_at);

-- ─── Bill splitting ───────────────────────────────────────────────────────
CREATE TABLE receipts (
  id            TEXT PRIMARY KEY,
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  image_url     TEXT,
  total_amount  REAL,
  tax           REAL,
  tip           REAL,
  status        TEXT,
  items         TEXT NOT NULL DEFAULT '[]',   -- JSON
  participants  TEXT NOT NULL DEFAULT '[]',   -- JSON
  created_at    INTEGER NOT NULL
);
CREATE INDEX receipts_creator_idx ON receipts (created_by_id, created_at DESC);

CREATE TABLE split_sessions (
  id                  TEXT PRIMARY KEY,
  created_by_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  receipt_id          TEXT REFERENCES receipts(id) ON DELETE SET NULL,
  restaurant_id       TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  split_mode          TEXT NOT NULL DEFAULT 'itemized'
                        CHECK (split_mode IN ('itemized','even','custom')),
  items               TEXT NOT NULL DEFAULT '[]',   -- JSON
  participants        TEXT NOT NULL DEFAULT '[]',   -- JSON
  custom_split_config TEXT,                         -- JSON
  host_payment_info   TEXT,                         -- JSON
  image_url           TEXT,
  tax                 REAL DEFAULT 0,
  tip                 REAL DEFAULT 0,
  total_amount        REAL,
  status              TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting','claiming','completed')),
  expires_at          INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL   -- drives realtime; see MIGRATION.md
);
CREATE INDEX split_sessions_creator_idx ON split_sessions (created_by_id, created_at DESC);
CREATE INDEX split_sessions_restaurant_idx ON split_sessions (restaurant_id);
-- cleanupExpiredSessions scans by expiry.
CREATE INDEX split_sessions_expires_idx ON split_sessions (expires_at);

-- ─── Restaurant product ───────────────────────────────────────────────────
CREATE TABLE restaurants (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  name                   TEXT NOT NULL,
  slug                   TEXT NOT NULL,
  google_review_url      TEXT,
  alert_email            TEXT,
  alert_phone            TEXT,
  rating_threshold       INTEGER NOT NULL DEFAULT 3,   -- page the operator at or below
  plan                   TEXT NOT NULL DEFAULT 'trial'
                           CHECK (plan IN ('trial','active','past_due','cancelled')),
  trial_ends_at          INTEGER,
  stripe_subscription_id TEXT,
  current_period_end     INTEGER,
  created_at             INTEGER NOT NULL
);
-- The table-tent QR resolves /r/<slug>, so slugs must be unique, not just
-- collision-checked in application code as they are today.
CREATE UNIQUE INDEX restaurants_slug_idx ON restaurants (slug);
CREATE INDEX restaurants_owner_idx ON restaurants (owner_id);
CREATE INDEX restaurants_subscription_idx ON restaurants (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE guest_ratings (
  id               TEXT PRIMARY KEY,
  restaurant_id    TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  session_id       TEXT REFERENCES split_sessions(id) ON DELETE SET NULL,
  stars            INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment          TEXT,
  guest_email      TEXT,
  routed_to_google INTEGER NOT NULL DEFAULT 0,   -- SQLite has no boolean
  alerted_at       INTEGER,
  created_at       INTEGER NOT NULL
);
-- Dashboard and the monthly report both read a restaurant's ratings by date.
CREATE INDEX guest_ratings_restaurant_idx ON guest_ratings (restaurant_id, created_at DESC);

CREATE TABLE guest_contacts (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT,
  visits        INTEGER NOT NULL DEFAULT 1,
  opted_in      INTEGER NOT NULL DEFAULT 1,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
-- Repeat-visit counting looks up (restaurant, email) on every split; uniqueness
-- makes the "increment or insert" race-safe, which the current code is not.
CREATE UNIQUE INDEX guest_contacts_restaurant_email_idx
  ON guest_contacts (restaurant_id, lower(email));

CREATE TABLE restaurant_leads (
  id              TEXT PRIMARY KEY,
  restaurant_name TEXT NOT NULL,
  contact_name    TEXT,
  email           TEXT NOT NULL,
  phone           TEXT,
  locations       TEXT,
  plan_interest   TEXT DEFAULT 'trial',
  source          TEXT DEFAULT 'restaurants_page',
  notified_at     INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX restaurant_leads_created_idx ON restaurant_leads (created_at DESC);

CREATE TABLE waitlist (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  app        TEXT NOT NULL DEFAULT 'billtap',
  source     TEXT NOT NULL DEFAULT 'landing_page',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX waitlist_email_idx ON waitlist (lower(email), app);
