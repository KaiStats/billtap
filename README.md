**Welcome to your Base44 project** 

**About**

View and Edit  your app on [Base44.com](http://Base44.com) 

This project contains everything you need to run your app locally.

**Edit the code in your local development environment**

Any change pushed to the repo will also be reflected in the Base44 Builder.

**Prerequisites:** 

1. Clone the repository using the project's Git URL 
2. Navigate to the project directory
3. Install dependencies: `npm install`
4. Create an `.env.local` file and set the right environment variables

Copy `.env.example` to `.env.local` and fill it in. That file is the
documentation for every variable and why it exists.

```
VITE_ENVIRONMENT=development
VITE_BASE44_APP_ID=your_dev_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url
```

Run the app: `npm run dev`

## Environments

Development, staging and production each use a **separate Base44 app**, and
therefore a separate database and a separate master key. This is not a
convention — it is enforced, because for a while it was not true and
`wrangler dev` on a laptop wrote live `Session` rows into real restaurants'
bills:

| Guard | Where | What it stops |
| --- | --- | --- |
| `assertEnvironmentIsolated` | `worker/lib/environment.js` | A non-production Worker carrying the production app id, or a live Stripe key. Refuses the request. |
| `mayContactRealPeople` | `worker/lib/email.js` | Staging emailing or texting real restaurant owners. Logged, not sent. |
| `mayRunScheduledWork` | `worker/routes/nightly-backup.js` | A staging snapshot landing in the production bucket looking like a real backup. |
| `check-env` | `scripts/check-env.mjs` | A build with no `VITE_ENVIRONMENT`, or a non-production build pointed at the production app. Fails before vite runs. |
| Environment badge | `src/components/EnvironmentBadge.jsx` | A person confirming payments on real bills believing they are testing. Renders nothing in production. |

`PRODUCTION_APP_ID` is committed in `wrangler.jsonc` on purpose: app ids are not
secrets — the bundle has always shipped one in plain text — and recording it is
what makes the comparison possible. Master keys are secrets and are set per
environment with `npx wrangler secret put NAME --env <environment>`.

Deploying:

```
npm run deploy                       # production
npx wrangler deploy --env staging    # staging, on a workers.dev subdomain
npx wrangler dev --env development   # local
```

**Set `VITE_ENVIRONMENT=production` in the Cloudflare build settings.** Without
it `npm run build:static` stops with a message rather than shipping an
unlabelled bundle.

**Publish your changes**

Open [Base44.com](http://Base44.com) and click on Publish.

**Docs & Support**

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Support: [https://app.base44.com/support](https://app.base44.com/support)
