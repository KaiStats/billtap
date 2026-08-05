# BillTap Incident Runbook

> **Owner:** On-call engineer  
> **Last updated:** June 2026  
> **Escalation:** hello@billtap.app  

---

## Before any incident: the two things that make one tractable

**Every failure carries a request id.** Six hex characters, shown to the caller,
set as `X-Request-Id` on the response, and written into the structured Worker
log line and the audit row. If someone reports a problem, the first question is
"was there an id on the screen" — with one, the exact request is a single
filter:

```
# Cloudflare dashboard → Workers → Logs, or:
npx wrangler tail --format json | grep <request_id>
```

Errors log as JSON with `request_id`, `route`, `code` and `status` as fields, so
filter on them rather than grepping prose. A 4xx logs at `level: warn` and a 5xx
at `level: error` — a spike in the first is usually a client bug or somebody
probing; a spike in the second is ours.

**Know how long that lookup stays possible.** Cloudflare Workers Logs retention
is measured in days. A restaurant emailing on Tuesday about Saturday evening is
the normal support request, not an unusual one, and for a while the id on their
screen led to a line that no longer existed — while the browser's half of the
same incident sat in Sentry for months.

`worker/lib/report.js` now sends every 5xx onward to Sentry with `request_id`,
`route` and `code` as **searchable tags**, so the six characters work there too
and for as long as the Sentry project keeps them. It carries no request body, no
headers and no address: this runs while a split is failing, so the body is a
bill with people's names on it, and an error reporter must not become a second
copy of what `worker/routes/retention.js` exists to remove.

It is off until a DSN is bound. To turn it on, add `SENTRY_DSN` to the `vars`
block of **each** environment in `wrangler.jsonc` — `vars` do not inherit, so
setting it once leaves staging and development silent. Use a different Sentry
project per environment. Until then the behaviour is exactly what it was:
Cloudflare logs only.

**Browser stack traces need one more thing to be readable.** The build generates
hidden sourcemaps and uploads them only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`
and `SENTRY_PROJECT` are set; without them no maps are produced and every trace
in Sentry stays minified, which is what it had always been. Set the three and
deploy. The release name is computed once in `vite.config.js` and used both by
the uploader and by the client, because a mismatch between those two is the
usual reason a project looks correctly configured and still resolves nothing.

**Sensitive actions are in an append-only trail.** `audit_log`, written by
`worker/lib/audit.js`. It answers who confirmed a payment for how much and when,
who changed a split after people started claiming, every rejected host key, and
every read of a restaurant's guest list. See the query list at the end of
`docs/SUPABASE-MIGRATION.md`.

Three things to know before you rely on it during an incident:

- **It is append-only and enforced.** You cannot correct a row. Corrections are
  new rows. Do not spend incident time trying.
- **It does not contain the host key**, only a fingerprint. You can tell that
  two actions came from the same host; you cannot recover the key to act as one.
- **It fails silently by design.** A missing row does not mean the action did
  not happen — the write is fire-and-forget so that it can never fail a payment
  confirmation. Treat absence as weak evidence and presence as strong.

## What is still not set up

Written here rather than left implicit, because the gap between "the code
supports this" and "somebody is watching" is where availability actually lives.

- **Nothing polls the health check.** `GET /api/health` exists and answers 200
  or 503, but no uptime service is pointed at it, so an outage is still detected
  by a restaurant emailing. Point any monitor at
  `https://billtap.app/api/health` on a 60-second interval and alert on a
  non-200. Do **not** point it at `?deep=1` — that costs a database query per
  poll and becomes its own load.
- **No alert fires on a failed cron.** The nightly backup marks its invocation
  failed and now also reports to Sentry, but only if `SENTRY_DSN` is bound. A
  backup that has been failing for three weeks and one that ran last night look
  identical until somebody looks.
- **The backup bucket does not exist yet.** See Incident 3. Until
  `billtap-backups` is created and the `r2_buckets` block uncommented, the
  nightly job throws every night on purpose.
- **`main` is unprotected**, so CI is advisory. See the bottom of
  `.github/workflows/ci.yml`.
- **Point-in-time recovery is unconfirmed.** Supabase dashboard → Database →
  Backups. Check it now; the answer changes what Incident 3 can promise.

---

## How to Use This Runbook

1. Identify the incident type below.  
2. Follow steps in order. Do not skip steps.  
3. Communicate status every 30 min to stakeholders.  
4. Complete the **Post-Incident** section after recovery.

---

## Incident 0 — The site is down, or a deploy broke it

**This is the first thing to try and it was not written down anywhere.**

Deploys are a person running `npm run deploy`. Cloudflare keeps every previous
version of the Worker, so undoing a bad one takes seconds and needs no build,
no git operation and no working local checkout:

```bash
npm run versions          # wrangler versions list — most recent first
npm run rollback          # to the previous version, with a confirmation prompt
npx wrangler rollback <version-id>   # to a specific one
```

Roll back first and diagnose afterwards. The version that was serving ten
minutes ago is known to work, and the alternative — reading logs while a
restaurant's dinner service cannot split bills — is how a five-minute incident
becomes an hour.

**What a rollback does not undo:** a database migration. `supabase/migrations/`
is applied separately and the Worker rolls back without it, so a version that
predates a migration may be running against a schema it does not expect. Check
which migrations went out with the deploy before rolling back across one.

**Static assets go with it.** The Worker and the assets in `dist/` deploy and
roll back as one version, so a rollback also restores the previous bundle —
which is why a diner mid-split gets a working page rather than an HTML shell
asking for chunks that no longer exist.

---

## Incident 1 — Receipt Scanning Fails (model provider outage)

**Symptoms:** "Couldn't read that receipt" on the review screen; `/api/scan-receipt`
returning 502 or timing out.

**Impact:** Itemized splits cannot be started from a photo. **Even splits still
work and need no model at all** — see Mitigation. Existing splits are unaffected;
nothing in a live session touches the provider.

> This section used to describe Base44 function logs, a `validateReceiptParse`
> AI call, `status.openai.com`, and a "manual mode" in `NewReceipt.jsx`. None of
> those are real. The provider is Gemini, reached from
> `worker/routes/scan-receipt.js`; `validateReceiptParse` is arithmetic in
> `shared/receipt-math.js` and calls nothing; and the fallback that does exist
> is the even split, which no version of this page had ever mentioned. Read the
> commands below rather than remembering the old ones.

### Detection
- `GET https://billtap.app/api/health` — 200 means the edge is serving.
  `?deep=1` also checks the database. Neither covers the model provider; a
  scanning outage shows up as 502s on `/api/scan-receipt`, not here.
- Cloudflare dashboard → Workers → Logs, or:

```bash
npx wrangler tail --format json | grep scan-receipt
```

- Sentry, if `SENTRY_DSN` is bound: filter `route:api/scan-receipt`.

### Triage (< 5 min)
1. Read the logged `code` and `status`. A 502 with `retry: true` is upstream;
   a 401/403 from the provider is the key.
2. Check the provider's status page for Gemini / Google AI.
3. Confirm it is the provider and not the key — the key is a Worker secret:

```bash
npx wrangler secret list          # names only; values are not readable back
npx wrangler secret put GEMINI_API_KEY
```

### Mitigation
| Cause | Action |
|---|---|
| Provider outage | Nothing to deploy. The even split already works: on a failed scan the error notice offers **"Split evenly instead"**, which opens the panel on the same screen. Tell restaurants that scanning is down and splitting evenly is not. |
| Expired / rotated key | `npx wrangler secret put GEMINI_API_KEY`, then `npm run deploy`. |
| Rate limit hit | `/api/scan-receipt` is already on the tighter limiter budget (10/min per address — `COSTLY` in `worker/lib/rate-limit.js`). Raising it means raising the provider's quota first. |
| Provider-side model error | `GEMINI_MODEL` is a var, not a hard-coded string, precisely so a bad model release can be pinned without a code change. |

### Recovery
1. Confirm the provider reports resolution.
2. Scan one real receipt end to end.
3. Check for splits left in `waiting` — they are ordinary rows, nothing needs
   unsticking.

### Post-Incident
- [ ] Write incident report (date, duration, root cause, fix).
- [ ] Add monitoring alert if not already present.
- [ ] Update this runbook with any new findings.

---

## Incident 2 — Payment Provider Outage (Venmo / Cash App / Zelle)

**Symptoms:** Users report they cannot complete payment; deep links fail; payment confirmation not updating.

**Impact:** Guests cannot mark payments as sent. Financial settlement delayed.

> **Note:** BillTap does not process payments directly. We generate deep links to third-party apps. We do not hold funds.

### Detection
- User reports payments failing.
- Check provider status pages: venmo.com/status, cash.app/status.
- Confirm BillTap session data is intact (payment_status still `unpaid` is expected if payment not completed).

### Triage (< 5 min)
1. Confirm it is the payment app, not a BillTap bug.
2. Verify deep link format is still valid (provider APIs occasionally change URL schemes).
3. Check if any recent code changes touched `Claim.jsx` payment flow.

### Mitigation
| Cause | Action |
|---|---|
| Provider outage | Post status update to users: "Venmo/CashApp is currently experiencing issues. Your bill data is saved — complete payment when service resumes." |
| Broken deep link format | Patch the URL scheme in `Claim.jsx` and redeploy. Test on iOS and Android. |
| Zelle (bank-side issue) | Advise users to use Zelle's native app directly and mark payment manually. |

### Recovery
1. Confirm provider service restored.
2. Test a full payment deep-link flow on a real device.
3. If payments were delayed, remind hosts to verify and manually mark payments settled.

### Post-Incident
- [ ] Consider adding a "manual mark as paid" button as permanent fallback for hosts.
- [ ] Write incident report.

---

## Incident 3 — Mass Data Loss

**Symptoms:** Sessions missing from Dashboard; database returns empty results; entity records inaccessible.

**Impact:** Hosts lose session records, participant data, and payment history. Severe.

### Detection
- User reports: "my sessions are gone."
- Confirm in the Supabase dashboard → Table Editor, or:

```bash
curl -s "$SUPABASE_URL/rest/v1/sessions?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

- Check it is not a display bug first — a filter reset, an auth issue, or RLS
  denying a read that the row survives perfectly well behind. `?deep=1` on
  `/api/health` distinguishes "database unreachable" from "database says no".

### Immediate Actions (First 15 min)
1. **Stop the scheduled deletes.** `worker/routes/retention.js` runs at 09:30
   UTC and removes guest names and claim lists from splits over 30 days old, and
   sweeps orphaned receipt images. During suspected data loss it is the one job
   in the system that deletes on purpose. Comment the `"30 9 * * *"` entry out of
   `triggers.crons` in `wrangler.jsonc` and `npm run deploy` — or, faster,
   disable the cron trigger in the Cloudflare dashboard.
2. **Stop writes if loss is ongoing.** There is no maintenance flag; the blunt
   instrument is to roll the Worker back to a version predating the suspected
   cause (Incident 0), which takes seconds.
3. **Escalate to Supabase** with the project ref, the table names, and the
   approximate time. Point-in-time recovery is a paid-plan feature — confirm
   whether this project has it **before** you need it, not during.
### ⚠️ There is no restorable backup. Do not spend incident time looking for one.

The Base44 `nightlyBackup` this section was written about never produced a
recoverable artefact (its replacement is described further down):

- It writes to `/tmp` inside an ephemeral Deno isolate. That filesystem is gone
  the moment the invocation ends, so nothing is readable afterwards — not hours
  later, not minutes later.
- The upload to external storage is still commented out.
- It covers 2 of 8 entities (`Session`, `Receipt`), each capped at the SDK's
  200-record `list()` default, so even the in-memory snapshot is partial.

This section used to describe locating that file and re-importing from it. That
procedure could never have worked. The danger was not the missing backup so much
as the confident instructions for restoring from it, which read as reassurance
during exactly the incident where someone needs the truth quickly.

**The real position: Supabase holds the only copy of production data.** That
sentence named Base44 until this layer, which was true when it was written and
stopped being true at the cutover — the kind of stale fact that is read once,
believed, and sends the first fifteen minutes of an incident to the wrong
vendor.

So: recovery depends entirely on Supabase, and on whether this project has
point-in-time recovery. **Find that out now, not during an incident** —
Supabase dashboard → Database → Backups. Without it, the daily automated backup
is the floor and the recovery point is up to twenty-four hours. Escalate to
Supabase immediately rather than delaying the call to hunt for a local
snapshot.

**The code is now written and waiting on one command.** The job moved to
`worker/routes/nightly-backup.js`, on a Cloudflare cron at 09:00 UTC.
It had to leave Base44, which blocks backend functions on this plan, so a
nightly job there would never have run. It covers all eight entities, pages past the
200-record cap, writes to R2, and reads each object back to confirm it landed.

It writes one object per entity under a dated prefix, plus a manifest:

```
billtap-backup-2026-08-05/manifest.json   <- read this first
billtap-backup-2026-08-05/Session.json
billtap-backup-2026-08-05/AuditLog.json
...
```

The manifest carries `complete: true|false` and names any entity that failed.
**A run with `complete: false` marks the cron invocation failed** — a backup
missing tables must not report success, because the object is there, its size
is plausible, its timestamp is last night, and nobody finds out until they are
restoring.

Separate objects rather than one snapshot because a Worker isolate has 128 MB
and this job used to hold every row of every table in memory twice over. The
same change added a read budget (it stops before Cloudflare's 1,000-subrequest
limit does), a per-entity size ceiling, and an error rather than silence when a
table has grown past what paging will walk. All three were previously silent,
and all three would have been reached first by `AuditLog`.

It does nothing until a bucket exists:

```bash
npx wrangler r2 bucket create billtap-backups
```

then uncomment the `r2_buckets` block in `wrangler.jsonc` and deploy. Until
then the cron fires, throws `BACKUP_BUCKET is not bound`, and the invocation is
marked failed — on purpose. The failure being designed against is a backup that
reports success and stores nothing, so an unconfigured one has to be loud.

**Delete this whole warning once the bucket is live and you have confirmed a
prefix for today's date exists with `complete: true` in its manifest**, and
replace it with the restore procedure — read the manifest, fetch each entity
object it lists, then re-import per entity as service role. Do not write that
procedure before you have restored from it once.

### Data Loss Triage Matrix
| Scope | Likely Cause | Owner |
|---|---|---|
| All tables empty | Platform-level incident | Supabase support |
| One table empty | Accidental bulk delete / RLS misconfiguration | Engineering |
| Specific user's data gone | RLS rule change / account delete | Engineering |
| Guest names blank on old splits | **Not loss.** 30-day retention redaction, working as designed — see `worker/routes/retention.js` | Nobody |
| Partial records missing | Retention pass ran too aggressively | Engineering — filter Worker logs for `job: "retention"` |

### Communications
- Notify affected hosts via email within 1 hour of confirmed loss.
- Do not speculate on cause until confirmed.
- Provide ETA for recovery within 2 hours.

### Post-Incident
- [ ] Root cause analysis.
- [ ] Verify backup restore was complete and accurate.
- [ ] Review and tighten RLS rules.
- [ ] Add record-count anomaly alert (alert if entity count drops > 20% in 1 hour).
- [ ] Write incident report.

---

## General Post-Incident Template

```
## Incident Report — [DATE]

**Incident type:** [AI outage / Payment outage / Data loss / Other]
**Start time:** 
**End time:** 
**Duration:** 
**Severity:** [P0 / P1 / P2]

**Summary:**
One paragraph. What happened, what was affected, how it was resolved.

**Root cause:**

**Timeline:**
- HH:MM — [Event]
- HH:MM — [Event]

**Impact:**
- Users affected:
- Sessions affected:
- Data lost (if any):

**Fix:**

**Prevention:**
- [ ] Action item 1
- [ ] Action item 2
```

---

## Quick Reference

| Resource | Link |
|---|---|
| Health check | `https://billtap.app/api/health` (add `?deep=1` for the database) |
| Roll back a bad deploy | `npm run versions`, then `npm run rollback` — see Incident 0 |
| Worker logs | Cloudflare dashboard → Workers → billtap → Logs, or `npx wrangler tail --format json` |
| Errors, searchable by request id | Sentry, tag `request_id` — needs `SENTRY_DSN` bound; see the top of this file |
| Cron schedules | `triggers.crons` in `wrangler.jsonc` — 09:00 backup, 09:30 retention |
| Secrets | `npx wrangler secret list` / `npx wrangler secret put <NAME>` |
| Database | Supabase dashboard → project `skrqxxhoxbrvlviqrhjt` |
| Cloudflare status | cloudflarestatus.com |
| Supabase status | status.supabase.com |
| Privacy / Deletion requests | privacy@billtap.app |
| Security issues | security@billtap.app |