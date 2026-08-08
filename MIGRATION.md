# Migrating BillTap off Base44 (superseded)

**This is the original plan, not what shipped.** The app is on Supabase, not
D1 — see `docs/SUPABASE-MIGRATION.md` and `docs/CUTOVER.md` for the migration
that actually happened. Realtime is `useLiveSplit` polling every few seconds,
not a Durable Object per session; the API is a single Cloudflare Worker
(`worker/routes/*.js`), not Pages Functions. `migrations/0001_init.sql`, the
D1 schema this document describes below, was deleted as orphaned — nothing
in `wrangler.jsonc` ever bound a D1 database, and its schema had already
drifted from what the app's data model became (compare against
`supabase/migrations/0001_initial_schema.sql` for the real one).

Kept for the reasoning that is still accurate — which entities were coupled
to what, and why each staged step was ordered the way it was — not as
instructions to follow. Do not run the commands under "Applying the schema"
below; there is no D1 database to apply them to.

---

Target: Cloudflare end to end — D1 for data, R2 for receipt images, Pages
Functions for the API, Durable Objects for realtime, Claude for receipt parsing.

Staged deliberately. The app stays live on Base44 throughout and each stage is
independently revertible. There is no cutover weekend.

## What is actually coupled

| Surface | Today | Replacement | Notes |
| --- | --- | --- | --- |
| 8 entities | Base44 entities | D1 (`migrations/0001_init.sql`) | Schema written and validated |
| Auth | email/password, OTP, OAuth | Magic link + Google | **Password hashes are not exportable** |
| Realtime | `Session.subscribe` ×4 | Durable Object per session | Drives live paid/unpaid |
| Receipt image upload | `Core.UploadFile` | R2 | |
| Receipt parsing | `Core.InvokeLLM` | Claude API | |
| 13 server functions | Base44 functions | Pages Functions | `stripeWebhook` moves last |

`Session.subscribe` is the least obvious and the most load-bearing: it is what
makes the host's screen update as guests pay. Polling would work but burns
requests on every open table; a Durable Object per split session is the right
shape. `split_sessions.updated_at` exists so a polling fallback stays cheap if
the DO work slips.

## Stages

**0 — Live on Cloudflare Pages, Base44 behind the proxy.** Done in code. See
`RESTAURANTS_PAGE.md`. Nothing below starts until billtap.app resolves and the
smoke test passes.

**1 — Data-access seam.** Introduce `src/lib/data.js` exposing the same shape the
app already calls (`list`, `filter`, `create`, `update`, `subscribe`) and route
all 68 call sites through it. It delegates to Base44 unchanged, so this stage
ships **zero behaviour change** — which is the point: every later stage swaps one
implementation behind the seam instead of editing pages again.

**2 — Auth.** Magic link + Google, `users` / `auth_tokens` / `sessions_auth`.
Existing users sign in with the same email and land in the same account, matched
on `lower(email)`. Run alongside Base44 auth behind a flag; cut over per user on
next login. No password is ever stored, and only token *hashes* are, so a
database leak cannot be replayed into a login.

**3 — Read-only shadow.** Export Base44 rows into D1 keeping their ids, then have
`data.js` read from D1 while continuing to write to both. Compare. Any divergence
is a bug found with zero user impact.

**4 — Writes to D1.** Flip writes per entity, least critical first:
`waitlist` → `restaurant_leads` → `guest_contacts` → `guest_ratings` →
`restaurants` → `receipts` → `split_sessions`. Each is one line in `data.js` and
one revert.

**5 — Realtime.** Durable Object per split session; `subscribe` moves behind the
seam. Ship the `updated_at` polling fallback first so the feature never regresses
while the DO work lands.

**6 — Uploads and parsing.** R2 for images, Claude for line-item extraction.
`validateReceiptParse` already guards the output shape — keep it, it is the only
thing standing between a bad parse and a wrong bill.

**7 — Server functions and teardown.** Port the remaining functions, move
`stripeWebhook` to Cloudflare last (re-point the Stripe endpoint in the same
change), then remove `@base44/sdk`, `base44/`, and the `/api/apps/**` proxy.

## Rules

- **Never delete the Base44 side in the same stage that adds the Cloudflare
  side.** One stage adds, a later stage removes.
- **Ids are preserved on import.** Cross-entity references (`restaurant_id`,
  `session_id`, `created_by_id`) must survive, or ratings detach from restaurants.
- **`Restaurant.slug` becomes unique at the database level.** Today collisions are
  only checked in application code, which races. Deduplicate before importing.
- **`guest_contacts` gains a unique `(restaurant_id, lower(email))`.** The current
  read-then-write visit counter can double-insert under concurrency; the
  constraint makes it an upsert instead. Deduplicate on import.
- **Stripe stays authoritative for billing.** Never infer plan state from local
  data during the migration; `stripeWebhook` remains the source of truth.

## Applying the schema

```bash
npx wrangler d1 create billtap
npx wrangler d1 migrations apply billtap --local    # verify first
npx wrangler d1 migrations apply billtap --remote
```

Then bind it to the Pages project as `DB`.

The schema is validated: all foreign keys resolve, and the case-insensitive email
uniqueness, unique slug, 1–5 star range and split-mode constraints were each
confirmed to reject bad rows.
