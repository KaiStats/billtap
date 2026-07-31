# BillTap Incident Runbook

> **Owner:** On-call engineer  
> **Last updated:** June 2026  
> **Escalation:** hello@billtap.app  

---

## How to Use This Runbook

1. Identify the incident type below.  
2. Follow steps in order. Do not skip steps.  
3. Communicate status every 30 min to stakeholders.  
4. Complete the **Post-Incident** section after recovery.

---

## Incident 1 — AI API Outage (Receipt Parsing Fails)

**Symptoms:** Users cannot upload receipts; `validateReceiptParse` returns errors; "parsing failed" shown in UI.

**Impact:** New sessions cannot be created. Existing sessions unaffected.

### Detection
- User reports or monitoring alert on `validateReceiptParse` error rate > 10% over 5 min.
- Check Base44 function logs → Dashboard → Code → `validateReceiptParse`.

### Triage (< 5 min)
1. Open Base44 function logs and confirm error type (timeout vs. auth vs. rate-limit).
2. Check AI provider status page (status.openai.com or equivalent).
3. Confirm it is the provider, not a bad API key: test a direct curl with the key from Secrets.

### Mitigation
| Cause | Action |
|---|---|
| Provider outage | Display "Receipt scanning is temporarily unavailable — please enter items manually." Enable manual-entry fallback in UI (see `NewReceipt.jsx` manual mode). |
| Expired / rotated API key | Rotate key in Base44 Dashboard → Settings → Environment Variables. Redeploy. |
| Rate limit hit | Add exponential backoff in `validateReceiptParse`. Throttle new session creation via `checkSessionRateLimit`. |
| Provider-side model error | Pin to a stable model version in function code. |

### Recovery
1. Confirm provider reports resolution.
2. Run a test receipt parse end-to-end.
3. Re-enable automatic parsing if it was disabled.
4. Check for any sessions stuck in `waiting` status — notify affected hosts.

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
- Confirm via Base44 entity explorer (Dashboard → Data) that records are missing.
- Check if it is a display bug first (filter reset, auth issue) before declaring data loss.

### Immediate Actions (First 15 min)
1. **Stop writes** — if loss is ongoing, temporarily disable session creation by returning a maintenance error in `checkSessionRateLimit`.
2. **Do not run any delete/cleanup jobs** — pause `cleanupExpiredSessions` automation immediately (Base44 Dashboard → Automations → toggle off).
3. **Contact Base44 support** at support@base44.com with: app ID, entity names, approximate time of loss, and a description.
### ⚠️ There is no restorable backup. Do not spend incident time looking for one.

`nightlyBackup` does not produce a recoverable artefact today:

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

**The real position: Base44 holds the only copy of production data.** If data is
lost, recovery depends entirely on Base44 support and whatever retention they
keep. Escalate to them immediately (step 3) rather than delaying that call to
hunt for a local snapshot.

**To make this section real**, `nightlyBackup` needs three things: durable
upload wired up (Cloudflare R2 is already in the stack, so a bucket plus
`BACKUP_S3_*` secrets), pagination past the 200-record cap, and the remaining
six entities — `Restaurant`, `GuestRating`, `GuestContact`, `RestaurantLead`,
`Waitlist`, `User`. Until all three are done, leave this warning where it is.

### Data Loss Triage Matrix
| Scope | Likely Cause | Owner |
|---|---|---|
| All entities empty | Platform-level incident | Base44 support |
| One entity empty | Accidental bulk delete / RLS misconfiguration | Engineering |
| Specific user's data gone | RLS rule change / account delete | Engineering |
| Partial records missing | Cleanup job ran too aggressively | Engineering — check `cleanupExpiredSessions` logs |

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
| Base44 Dashboard | app.base44.com |
| Function Logs | Dashboard → Code → [function name] |
| Automations | Dashboard → Automations |
| Environment Variables / Secrets | Dashboard → Settings → Environment Variables |
| Base44 Support | support@base44.com |
| Privacy / Deletion requests | privacy@billtap.app |
| Security issues | security@billtap.app |