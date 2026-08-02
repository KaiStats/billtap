# Moving off Base44 onto Supabase

## Where this stands

Stage 1 is **done and shipped**: the receipt parse goes straight from the Worker
to the model, so Base44 is off the critical path of the scan
(`worker/routes/scan-receipt.js`, commit `333a34c`).

Stage 2 is **built and untested against a real project**, because it needs
credentials this environment does not have:

- `supabase/migrations/0001_initial_schema.sql` — the schema, with RLS on
- `worker/lib/db.js` — the data layer, 24 tests
- `scripts/migrate-to-supabase.mjs` — the copy, idempotent and non-destructive

Stage 3, auth, is **not started**. Deliberately — see below.

---

## What Base44 still does, after stage 1

| | Calls | Replacement |
| --- | --- | --- |
| Database | ~12 | Supabase Postgres, via `worker/lib/db.js` |
| Auth | ~8 | Supabase Auth |
| File storage | 1 | Supabase Storage |
| LLM | 0 | done |

---

## The one architectural decision worth arguing about

**The browser does not talk to Postgres. The Worker does.**

Supabase's usual shape is browser → PostgREST with RLS deciding everything. That
is wrong for this app, for one reason: **the people who use it have no
accounts.** A diner scanning a table tent has no Supabase identity, so
`auth.uid()` is null and no policy can scope them. The things that actually
guard the money here are the host key and the participant id, and neither is
something Postgres can check.

So the split is:

- **Auth in the browser.** `supabase-js` handles sign-in, sign-up, OAuth,
  password reset. That is what it is for and it is where the value is.
- **Data through the Worker,** with the service role key, exactly as now. Every
  write already authorises against stored data, and that code is mutation-tested.
- **RLS on and default-deny,** as defence in depth rather than the primary
  control. Under Base44, RLS was the only thing between a caller and the data.
  Here it is the backstop. The schema enables it on every table with almost no
  policies, so a mistake fails closed.

The prize is that `worker/routes/functions.js` — the claim merge, the
proportional tax split, the host-key check, the participant scope — **does not
change at all.** `db.js` presents the same `entity(name).{filter, list, create,
update}` interface `base44.js` did. The migration for those nine functions is
one import line.

---

## Doing it

### 1. Create the project

Two of them: production and staging. `worker/lib/environment.js` refuses to
serve if a non-production deployment carries production's credentials, and that
guard is worth keeping honest.

```
supabase db push          # or paste 0001_initial_schema.sql into the SQL editor
```

### 2. Secrets

```
npx wrangler secret put SUPABASE_URL --env production
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
npx wrangler secret put SUPABASE_ANON_KEY --env production
```

The service role key bypasses RLS entirely. It belongs in the Worker and
**nowhere near the browser bundle** — anything prefixed `VITE_` is public.

### 3. Copy the data

```
node scripts/migrate-to-supabase.mjs --dry-run
node scripts/migrate-to-supabase.mjs
```

Idempotent, so run it as often as you like. It deletes nothing from Base44. It
preserves ids, which matters more than it sounds: session ids are in
`/claim?id=` links open on people's phones right now, and QR tokens are
HMAC-signed over the session id, so a changed id silently invalidates a printed
table tent.

### 4. Switch the Worker

In `worker/routes/functions.js`, `worker/routes/nightly-backup.js` and
`worker/routes/rating-alert.js`:

```js
- import { serviceRole, asCaller, currentUser } from '../lib/base44.js';
+ import { serviceRole, asCaller, currentUser } from '../lib/db.js';
```

Then `npm test`. All 277 pass or something is wrong with `db.js`, not with the
functions — that is the entire point of matching the interface.

Deploy to staging first and walk the flow by hand: scan, share, claim, pay,
confirm. Then production.

### 5. Auth, last and carefully

Not because it is hard to write, but because it is the one thing that can lock
out paying restaurants, and there is no hurry — nothing about the current auth
is on fire.

The scope is smaller than it looks: **the entire diner experience needs no
accounts.** Only restaurant operators sign in, and there are a few dozen of
them. That means:

- `supabase-js` in the browser, replacing `base44.auth.*` in `Login.jsx`,
  `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx` and `AuthContext`.
- `currentUser()` in `db.js` already verifies a Supabase JWT — done.
- Existing operators need an account on the new project. With a few dozen, a
  password reset email each is simpler and safer than migrating hashes.
- **Consider magic links only.** No passwords means no password reset, no
  credential stuffing, and most of the attack surface simply does not exist. For
  this number of users the trade is obviously worth it.

Then move file storage (one call, `UploadFile`) to Supabase Storage or R2, and
Base44 is gone.

---

## Things that will bite

1. **Base44 syncs this repo from `main`.** Until it is fully disconnected it may
   still push changes into `base44/`. Do not be surprised by a commit you did
   not write.
2. **Do not create a top-level `functions/` directory.** Base44's sync claims
   that path.
3. **`created_date` vs `created_at`.** Base44 used both inconsistently; the
   schema keeps both columns for that reason. Check which one a query means.
4. **`expires_at` is epoch milliseconds, not a timestamp.** The Worker compares
   it against `Date.now()`. It is `bigint` in the schema on purpose.
5. **`items` and `participants` are `jsonb`.** The claim merge reads and writes
   the whole array. Do not normalise them into child tables during this
   migration — that is a rewrite of the money code wearing a migration's
   clothes.
6. **The lost-update retry in `patchSession` can go away eventually.** Base44
   had no compare-and-swap, so it writes, reads back, and retries if its change
   was trampled. Postgres can do that atomically in one statement. Worth doing —
   *after* the migration is proven, not during.

---

## What would make me stop

- The migration script reports fewer rows written than read. Do not cut over.
- `npm test` fails after the import swap. The interface is not faithful; fix
  `db.js` rather than the functions.
- Staging cannot complete a full scan → share → claim → pay → confirm by hand.
