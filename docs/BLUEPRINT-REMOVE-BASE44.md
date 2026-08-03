# Blueprint: finish removing Base44

For whoever picks this up next — Cursor, or a person. This is the last stage.
Everything before it is done and deployed.

Read this whole file before writing anything. The dangerous parts of this
codebase are dangerous in ways that are not obvious from reading a single file,
and each one below has already caused a real failure.

---

## Where things stand

| | Status |
|---|---|
| Receipt parsing | **Done.** Worker → Gemini directly. Base44 not involved. |
| Database | **Ready.** `worker/lib/db.js`, schema applied, switched by one binding. |
| Data migration | **Blocked on an export.** See `docs/CUTOVER.md` step 3. |
| Errors, audit trail | **Done and deployed.** |
| **Auth** | **Not started. This document.** |
| **File upload** | **Not started. One call.** |
| Operator ↔ restaurant relink | **Written, not run.** `0003_claim_restaurant_on_signup.sql` |

412 tests pass. Keep it that way — `npm test` before every commit.

---

## The invariants

Break any of these and the failure is silent, in production, involving money.

**1. Session ids are live in the world.** They are in `/claim?id=` links open on
phones right now, and QR tokens are HMAC-signed over the session id, so changing
one silently invalidates a printed table tent that a restaurant paid to have
made. Ids are `text`, not `uuid`, for exactly this reason. Never regenerate one.

**2. The diner experience has no accounts and must never gain one.** A guest
scanning a table tent has no identity. `auth.uid()` is null for them and always
will be. Any change that makes signing in a precondition for splitting a bill
has destroyed the product. This is the single most important line in this file.

**3. The host key is the only thing that makes a table-tent split ownable.**
That row has no `created_by_id`. Whoever holds the 24-byte secret is the host;
only its SHA-256 is stored. It is what authorises confirming a payment. It must
never be logged, never returned twice, and never written into `audit_log` as
anything but a truncated fingerprint.

**4. The nine functions in `worker/routes/functions.js` are mutation-tested
money code.** The claim merge, the proportional tax split, the frozen settled
amounts. Do not refactor them as part of an auth change. If a diff touches both
`Login.jsx` and `joinSession`, it is two changes and should be two commits.

**5. `DATA_BACKEND` unset means Base44.** Deliberately. An unset variable is
silent, and an app pointed at an empty database reads as "no customers" rather
than "wrong database".

---

## Stage 3 — Auth

### Why magic links, and not a like-for-like port

The current flow is email + password, plus Google OAuth, plus an OTP on
register. Porting all of that to Supabase is more code than replacing it.

- **There are a few dozen operators.** Not thousands. The scale that justifies a
  password system is not present.
- **No passwords means no password reset.** Which is not a hypothetical saving:
  the reset flow is broken *right now*, the owner is locked out of his own app
  as this is being written, and `/forgot-password` did not exist as a route
  until three commits ago.
- **No passwords means no credential stuffing, no hash migration, no rotation
  policy, no "was that password reused" incident.** Most of the auth attack
  surface simply stops existing.
- **Google OAuth stays.** It is one line in Supabase and several operators
  already use it.

If the decision is overturned and passwords are kept, everything below still
applies except the specific method calls.

### What Supabase needs, in its dashboard

**Authentication → Providers**

- Enable **Email**, with **"Confirm email"** on.
- Turn **"Enable email provider password"** OFF. That is what makes it magic
  links rather than passwords.
- Enable **Google**. Client id and secret come from the existing Google Cloud
  OAuth app — reuse it, and add Supabase's callback URL to its authorised
  redirect URIs.

**Authentication → URL Configuration**

- Site URL: `https://billtap.app`
- Redirect URLs, all four:
  - `https://billtap.app/**`
  - `https://www.billtap.app/**`
  - the staging `workers.dev` URL, with `/**`
  - `http://localhost:5173/**`

A redirect URL that is not on this list fails at the moment somebody clicks the
link in their email, which is the worst possible time to discover it.

**Authentication → Email Templates**

Rewrite the magic link template. The default says "Follow this link to log in"
with no branding, which reads as phishing to somebody who was expecting BillTap.
Say what it is, say who it is from, and say it expires.

**Authentication → Rate limits**

Lower the magic link limit. The endpoint sends an email to any address it is
given; the Worker already rate-limits its own routes (`worker/lib/rate-limit.js`)
but sign-in goes to Supabase directly and is not behind that.

### The code

Install: `npm install @supabase/supabase-js`

**New file — `src/lib/supabase.js`**

```js
import { createClient } from '@supabase/supabase-js';

// The anon key is public and belongs in the bundle — that is what it is for.
// The service role key must never appear in any file under src/. Anything
// prefixed VITE_ ships to every browser that loads the page.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.example` and to
`scripts/check-env.mjs`, which must fail a production build when either is
missing — for the same reason it already fails on a missing app id.

**Rewrite — `src/lib/AuthContext.jsx`**

Keep the exported shape exactly. Six files consume it and none of them should
change:

```js
{ user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings,
  authError, appPublicSettings, logout, navigateToLogin, checkAppState }
```

- `supabase.auth.getSession()` on mount, then `onAuthStateChange` for updates.
  Return the unsubscribe from the effect — a leaked listener fires against an
  unmounted tree on every token refresh.
- `logout` → `supabase.auth.signOut()`, then navigate to `/`.
- **`isLoadingAuth` must start `true` and only go false once resolved.** If it
  starts false, `ProtectedRoute` sees `isAuthenticated: false` on first paint and
  bounces a signed-in operator to the login screen before the session loads.

**Rewrite — `src/pages/Login.jsx`**

- Email field → `supabase.auth.signInWithOtp({ email })`.
- On success show "Check your email" **without revealing whether the account
  exists.** The current page already gets this right; keep it.
- Google → `supabase.auth.signInWithOAuth({ provider: 'google' })`.

**Rewrite — `src/pages/Register.jsx`**

With magic links there is no separate register. `signInWithOtp` creates the user
if they do not exist. Keep the route — it is linked from the marketing pages —
and make it the same form with different copy.

**Delete — `src/pages/ForgotPassword.jsx`, `src/pages/ResetPassword.jsx`**

Remove from `src/App.jsx` and from `SPA_ROUTES` in `worker/index.js`. Keep
`/forgot-password` as a **redirect to `/login`**, not a 404: the link is in
Base44's old emails and in browser history, and people will arrive on it.

**Worker — `worker/routes/functions.js`**

One line:

```js
- import { serviceRole, asCaller, currentUser, dataMisconfiguration } from '../lib/data.js';
```

No change. `currentUser` in `db.js` already verifies a Supabase JWT against
`/auth/v1/user`, and `data.js` routes to it when `DATA_BACKEND=supabase`. The
Worker side of auth is done. Do not re-verify JWTs by hand; the round trip is
correct, and a locally verified token that has been revoked still looks valid.

**`src/api/base44Client.js`**

Leave `functions.invoke` alone. It points at `/api/fn/<name>` and that stays.
Remove only `credentials: 'same-origin'` once cookies are no longer the auth
mechanism, and instead attach the Supabase access token as a bearer:

```js
const { data: { session } } = await supabase.auth.getSession();
if (session) headers.Authorization = `Bearer ${session.access_token}`;
```

**Do not send that header for guest calls.** `joinSession`, `markMePaid` and
`getSplitStatus` are called by people with no account, and adding an
`Authorization` header they do not have is how a guest path acquires an auth
requirement — see invariant 2.

### Getting existing operators in

Do not migrate password hashes. With a few dozen operators:

1. Get their emails from `restaurants.alert_email` in Supabase.
2. Send each a magic link. They click it; the account is created on first use.
3. The ownership link rebuilds itself. Run
   `supabase/migrations/0003_claim_restaurant_on_signup.sql` **before** sending
   any invites — it installs a trigger on `auth.users` that claims a migrated
   restaurant whose `alert_email` matches, and backfills anyone who already has
   an account.

   A one-time UPDATE would have been enough for the operators who sign in that
   week and wrong for everyone else: somebody who first signs in a month later
   gets an empty dashboard and no indication why.

   Read the header of that file before running it. It claims a restaurant on
   the strength of an email address, which is the same trust model magic links
   already have — but it should be a decision, not a surprise.

Afterwards, check who is still unclaimed:

```sql
select name, alert_email, owner_id is not null as claimed
from restaurants order by claimed, name;
```

A `false` row usually means `alert_email` differs from the address they signed
in with. Worth finding before they report an empty dashboard as a bug.

### Acceptance

Not "it compiles". Each of these has to be walked by hand:

- [ ] A guest scans a table tent, joins, claims, and pays **without ever seeing
      a sign-in screen.** If this fails, stop and revert.
- [ ] An operator signs in by magic link and sees their own restaurant.
- [ ] An operator signs in with Google and lands on the same account.
- [ ] A signed-in operator refreshing `/restaurant-dashboard` is not bounced to
      login on first paint.
- [ ] Signing out actually ends the session — reload and confirm.
- [ ] `/forgot-password` redirects rather than 404s.
- [ ] The host key still confirms a payment on a table-tent split with no
      account involved anywhere.
- [ ] `npm test` — 412 pass.
- [ ] `audit_log` shows `split.created` and `payment.confirmed` for the walk.

---

## Stage 4 — File upload

`src/pages/NewReceipt.jsx:140` — `base44.integrations.Core.UploadFile`. The only
remaining Base44 integration call.

Two options; **R2 is the better one**, because there is already a Cloudflare
account, a Worker, and (after `docs/CUTOVER.md` step 8) a bucket. It also avoids
a second storage vendor's egress bill for images that are read once.

Add `POST /api/upload` to the Worker: accept the image, put it in R2 under a
random key, return the URL. It must reuse the existing size and MIME checks from
`worker/routes/scan-receipt.js` rather than growing its own — those already
refuse a non-image and an oversized file before any money is spent.

Then delete `src/api/base44Client.js`, `worker/lib/base44.js`,
`worker/routes/base44-proxy.js`, and the `base44/` directory. Base44 is gone.

---

## Things that will bite

1. **Do not create a top-level `functions/` directory.** Base44's repo sync
   claims that path. It once moved every Cloudflare handler into
   `base44/functions/<name>/entry.ts` on its own, breaking every import.
2. **Base44 may still commit to `main`** until the app is disconnected. Do not
   be surprised by a commit nobody wrote.
3. **`expires_at` is epoch milliseconds, not a timestamp.** `bigint` on purpose.
4. **`created_date` and `created_at` both exist.** Base44 used both
   inconsistently. Check which one a query means.
5. **`items` and `participants` are `jsonb` and the claim merge reads and writes
   the whole array.** Normalising them into child tables is a rewrite of the
   money code wearing a migration's clothes. Not now.
6. **The `patchSession` retry loop can go away eventually.** Base44 had no
   compare-and-swap so it writes, reads back, and retries if trampled. Postgres
   does that atomically. Worth doing — after the migration is proven, not during.
7. **Anything prefixed `VITE_` is public.** The service role key belongs only in
   `wrangler secret put`.

---

## What "done" looks like

`grep -ri base44 src/ worker/` returns nothing but historical comments. The
`base44` dependency is out of `package.json`. `worker/lib/data.js` and its
`base44` branch are deleted, and `db.js` is imported directly again.

Do that last step only after Supabase has carried real traffic long enough that
a problem would have surfaced. The rollback is worth more than the tidiness.
