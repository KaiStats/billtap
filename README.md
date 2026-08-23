# BillTap

Split a restaurant bill from a QR code on the table. No app, no account for the
diner: they scan, claim what they ate, and pay their share.

The repository was generated from a Base44 template and this file was never
rewritten, so until now it welcomed you to a Base44 project, sent you to
Base44.com to publish, and listed `VITE_BASE44_APP_ID` as the variable to set.
None of that is how the app runs. Production has been on Supabase since
`DATA_BACKEND` was set to `supabase` in `wrangler.jsonc`.

## What it is made of

| Piece | Where |
| --- | --- |
| Single-page app | `src/`, built by Vite, prerendered by `scripts/prerender.mjs` |
| API and static asset serving | `worker/index.js`, a Cloudflare Worker; `/api/*` runs the Worker first, everything else falls back to the SPA |
| Database | Supabase (Postgres over PostgREST), reached through `worker/lib/db.js` |
| Payments | Stripe Checkout — `$149/mo` for a restaurant, `$3.99/mo` for a diner |

`worker/lib/db.js` keeps the interface the old `base44.js` had, which is why
Base44 is still named throughout the comments. Those comments describe why the
current code is shaped the way it is; they are not instructions to go set a
Base44 app up.

## Running it locally

1. Clone the repository and `cd` into it
2. `npm install`
3. `cp .env.example .env.local` and fill it in — that file is the documentation
   for every variable and why it exists
4. `npm run dev`

The three that a local build actually requires:

```
VITE_ENVIRONMENT=development
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

The anon key is public and belongs in the bundle. The `service_role` key must
never appear in a `VITE_` variable; `scripts/check-env.mjs` fails the build if
the two are confused.

## Checks

```
npm test            # unit, boundaries, browser UI, browser E2E
npm run lint        # eslint, no warnings tolerated
npm run typecheck   # tsc over jsconfig.json
npm run verify:dist # the deploy gate: what is in dist/ is what was meant to ship
```

`npm test` runs `test:unit` (node --test over `worker/`, `src/` and `scripts/`),
`test:boundaries` (vitest), then `test:ui` and `test:e2e`, which drive a real
browser. Those two need Chromium; set `PLAYWRIGHT_CHROMIUM_PATH` if it lives
somewhere Playwright will not find on its own.

## Environments

Development, staging and production each use a **separate database and a
separate set of keys**. This is not a convention — it is enforced, because for a
while it was not true and `wrangler dev` on a laptop wrote live `Session` rows
into real restaurants' bills:

| Guard | Where | What it stops |
| --- | --- | --- |
| `assertEnvironmentIsolated` | `worker/lib/environment.js` | A non-production Worker pointed at the production database, or carrying a live Stripe key. Refuses the request. |
| `mayContactRealPeople` | `worker/lib/email.js` | Staging emailing or texting real restaurant owners. Logged, not sent. |
| `mayRunScheduledWork` | `worker/routes/nightly-backup.js` | A staging snapshot landing in the production bucket looking like a real backup. |
| `check-env` | `scripts/check-env.mjs` | A build with no `VITE_ENVIRONMENT`, or a non-production build pointed at production. Fails before vite runs. |
| Environment badge | `src/components/EnvironmentBadge.jsx` | A person confirming payments on real bills believing they are testing. Renders nothing in production. |

`PRODUCTION_SUPABASE_URL` is committed in `wrangler.jsonc` on purpose: a project
ref is not a secret — it is inside every anon key, and the anon key ships in the
browser bundle — and recording it is what lets the comparison happen at all.

`PRODUCTION_APP_ID` is **not** committed, and two comments in `wrangler.jsonc`
used to say it was. That half of the check has never been able to fire. It only
matters while a deployment is on the Base44 backend, which production is not.

Service-role keys and master keys are secrets, set per environment with
`npx wrangler secret put NAME --env <environment>`.

## Deploying

```
npm run deploy                       # production: build:static, then wrangler deploy
npx wrangler deploy --env staging    # staging, on a workers.dev subdomain
npx wrangler dev --env development   # local
```

`npm run deploy` pins `--env=""` so that a bare deploy cannot be read as
ambiguous: the top level of `wrangler.jsonc` *is* production, and that is where
the routes and the crons live.

**Set `VITE_ENVIRONMENT=production` in the Cloudflare build settings.** Without
it `npm run build:static` stops with a message rather than shipping an
unlabelled bundle.
