/**
 * POST /api/monthly-report
 *
 * Sends the month-end performance report. The aggregation happens where the data
 * lives; this endpoint owns delivery, so every BillTap email — alerts, leads and
 * reports alike — leaves from Cloudflare via Postmark as alerts@billtap.app.
 *
 * Guarded by a shared secret in X-Report-Secret. Without it anyone who found the
 * URL could send mail from your domain.
 *
 * Bindings: REPORT_WEBHOOK_SECRET (required), plus the usual email bindings.
 */
import { json, esc, EMAIL_RE, sendEmail } from '../lib/email.js';
import { serviceRole } from '../lib/data.js';
import { isEntitled } from '../../shared/entitlement.js';

const MAX_BODY_BYTES = 262144; // ~250KB — comfortably more than a few hundred restaurants

/** Constant-time-ish compare so a wrong secret can't be guessed by timing. */
function secretMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const row = (k, v) => `
  <tr>
    <td style="padding:11px 12px 11px 0;color:#666;border-bottom:1px solid #eee">${esc(k)}</td>
    <td style="padding:11px 0;font-weight:700;text-align:right;border-bottom:1px solid #eee">${esc(v)}</td>
  </tr>`;

/**
 * The one line in this email that asks for anything.
 *
 * Owners talk to other owners, and this is the email they already open. The
 * link is tagged so /restaurants can file the lead as a referral rather than
 * as a cold visit. It promises nothing beyond the ordinary trial, because no
 * referral reward exists — offering one here would be a claim the product
 * cannot honour.
 */
export const REFERRAL_URL =
  'https://billtap.app/restaurants?utm_source=monthly_report&utm_medium=email&utm_campaign=owner_referral';
const REFERRAL_TEXT = 'Know an owner who would want this? Forward this email — they can try BillTap free for 14 days';

/**
 * What the footer says about low ratings.
 *
 * It used to read "reached you privately instead of Google", and the row above
 * it was "Caught before going public". Both described review gating — the
 * practice this product removed on purpose (RESTAURANTS_PAGE.md, "The threshold
 * does not hide the link"). Every guest is shown the Google button, the unhappy
 * ones included. What a low rating buys the operator is hearing about it first,
 * while the guest is still there, and that is what this says.
 */
export function lowRatingLine(caught) {
  const n = Number(caught);
  if (!(n > 0)) return 'No low ratings this month.';
  return `${n} unhappy guest${n === 1 ? '' : 's'} reached you the moment they rated, while there was still time to make it right.`;
}

/**
 * The guest recovery block, when the caller supplies it.
 *
 * Optional fields, so a payload built before recovery tracking existed sends
 * exactly the email it always did. `recovered` and `resolved` are counts of low
 * ratings (fully recovered, and given any outcome); the rate is only shown
 * when something was resolved — "0%" would claim every guest was lost when
 * the truth is nobody marked anything. `top_issues` is [{ label, count }],
 * the labels from shared/guest-recovery.js.
 */
export function recoveryRows(r) {
  const out = [];
  const recovered = Number(r.recovered);
  const resolved = Number(r.resolved);
  if (Number.isFinite(recovered) && r.recovered != null) out.push(['Recovered before they left', recovered]);
  if (resolved > 0 && Number.isFinite(recovered)) {
    out.push(['Recovery rate', `${Math.round((recovered / resolved) * 100)}%`]);
  }
  const issues = Array.isArray(r.top_issues) ? r.top_issues : [];
  issues
    .filter((i) => i && typeof i.label === 'string' && Number(i.count) > 0)
    .slice(0, 5)
    .forEach((i, n) => out.push([`${n === 0 ? 'Top problem' : `Problem #${n + 1}`}: ${i.label.slice(0, 60)}`, Number(i.count)]));
  return out;
}

export async function onRequestPost({ request, env }) {
  const expected = env.REPORT_WEBHOOK_SECRET;
  if (!expected) {
    console.error('monthly-report: REPORT_WEBHOOK_SECRET is not configured');
    return json({ error: 'Not configured' }, 503);
  }
  if (!secretMatches(request.headers.get('X-Report-Secret') || '', expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const reports = Array.isArray(body.reports) ? body.reports : [];
  if (reports.length === 0) return json({ ok: true, sent: 0 });

  let sent = 0;
  let skipped = 0;
  const failures = [];

  for (const r of reports) {
    if (!EMAIL_RE.test(String(r.to || ''))) {
      failures.push({ restaurant: r.restaurant_name || '(unnamed)', reason: 'bad_recipient' });
      continue;
    }

    /**
     * The monthly report is one of the three things $149 buys, so an unpaid
     * restaurant does not get one.
     *
     * Gated on `restaurant_id` when the caller supplies one. This endpoint is
     * a mailer — it is handed finished reports rather than building them — and
     * the generator that will call it does not exist yet. So the check is here
     * waiting for it, and a payload without an id still sends: refusing those
     * would break the only way this endpoint is currently exercised, to
     * enforce a rule against a restaurant it cannot even identify.
     *
     * When the generator is written it should pass restaurant_id, and this
     * becomes real. `skipped` in the response is how anyone finds out it did.
     */
    if (r.restaurant_id) {
      // Not `rows`: the report's own table rows are declared below and shadowing
      // them here reads like a bug even though the block scopes save it.
      const owner = await serviceRole(env).entity('Restaurant').filter({ id: String(r.restaurant_id) });
      if (owner[0] && !isEntitled(owner[0])) {
        skipped += 1;
        continue;
      }
      /**
       * A demo row is entitled — that is the whole point of the demo arm in
       * shared/entitlement.js — so the check above waves it straight through,
       * and this is the one place where "entitled" and "should receive this"
       * come apart.
       *
       * A month-end performance report for a demo is a summary of ratings the
       * operator tapped himself, on a restaurant that never signed up, sent to
       * the operator's own inbox. It reports nothing, and if the address on the
       * row were ever the prospect's it would be a report about a business's
       * guests to a business that has not heard of us.
       */
      if (owner[0]?.demo) {
        skipped += 1;
        continue;
      }
    }

    const label = r.label || body.window || 'Last month';
    const rows = [
      ['Average rating', r.average != null ? `${r.average} / 5` : 'No ratings yet'],
      ['Ratings collected', r.ratings ?? 0],
      ['Sent to Google', r.routed ?? 0],
      ['Low ratings you heard first', r.caught ?? 0],
      ...recoveryRows(r),
      ['New guest emails', r.new_contacts ?? 0],
      ['Total list size', r.list_size ?? 0],
    ];

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:540px">
        <div style="background:#111827;border-radius:12px;padding:22px;margin-bottom:20px">
          <p style="margin:0 0 6px;color:#f0b429;font-size:12px;letter-spacing:.12em;text-transform:uppercase">${esc(label)}</p>
          <p style="margin:0;color:#fff;font-size:22px;font-weight:700">${esc(r.restaurant_name || 'Your restaurant')}</p>
        </div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => row(k, v)).join('')}
        </table>
        <p style="margin:22px 0 0;color:#888;font-size:12px;line-height:1.6">
          ${esc(lowRatingLine(r.caught))}
        </p>
        <p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #eee;color:#555;font-size:13px;line-height:1.6">
          ${esc(REFERRAL_TEXT)} at
          <a href="${REFERRAL_URL}" style="color:#b7791f">billtap.app/restaurants</a>.
        </p>
      </div>`;

    const text = [
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      lowRatingLine(r.caught),
      '',
      `${REFERRAL_TEXT}: ${REFERRAL_URL}`,
    ].join('\n');

    const result = await sendEmail(env, {
      to: r.to,
      subject: `${r.restaurant_name || 'Your restaurant'} — ${label} report`,
      html,
      text,
    });

    if (result.ok) sent++;
    else failures.push({ restaurant: r.restaurant_name || '(unnamed)', reason: result.reason });
  }

  // `skipped` only when something was: an ordinary response is unchanged.
  return json({ ok: true, sent, failed: failures.length, failures, ...(skipped ? { skipped } : {}) });
}
