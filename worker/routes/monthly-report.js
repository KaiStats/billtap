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
import { summarizeRecovery, worstPeriod, returnVisits } from '../../shared/guest-recovery.js';
import { mayRunScheduledWork, environmentName } from '../lib/environment.js';

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
  if (r.worst_period && typeof r.worst_period.label === 'string' && Number(r.worst_period.count) > 0) {
    out.push([`Most affected: ${r.worst_period.label.slice(0, 40)}`, `${Number(r.worst_period.count)} low ratings`]);
  }
  if (Number(r.unhappy_tracked) > 0) {
    out.push(['Unhappy guests who came back', `${Number(r.unhappy_returned) || 0} of ${Number(r.unhappy_tracked)}`]);
  }
  if (Number(r.returning) > 0) out.push(['Returning guests on your list', Number(r.returning)]);
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

  return json(await deliverReports(env, body));
}

/**
 * Sends finished reports. Shared by the webhook above and the monthly cron
 * below, so both apply the same entitlement and demo rules to every email.
 */
export async function deliverReports(env, body) {
  const reports = Array.isArray(body.reports) ? body.reports : [];
  if (reports.length === 0) return { ok: true, sent: 0 };

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
     * Gated on `restaurant_id` when the caller supplies one. The monthly
     * generator below always does; a hand-built webhook payload without an id
     * still sends, since the rule cannot be applied to a restaurant it cannot
     * identify. `skipped` in the response is how anyone finds out it fired.
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
  return { ok: true, sent, failed: failures.length, failures, ...(skipped ? { skipped } : {}) };
}

// ── The generator ───────────────────────────────────────────────────────────
//
// What this endpoint waited for: something that computes each restaurant's
// month and hands it over. It runs from the 1st-of-the-month cron in
// worker/index.js, over the previous calendar month in UTC.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** [start, end) of the calendar month before `now`, in epoch ms, plus its name. */
export function previousMonth(now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { start: startDate.getTime(), end, label: `${MONTHS[startDate.getUTCMonth()]} ${startDate.getUTCFullYear()}` };
}

const inWindow = (ms, { start, end }) => Number.isFinite(Number(ms)) && Number(ms) >= start && Number(ms) < end;

/**
 * One restaurant's report payload from its rows. Pure, so it is tested without
 * a database. The low-rating line uses the restaurant's own alert threshold —
 * the same number that decided whether the manager was paged.
 */
export function buildReport(restaurant, ratings, contacts, window, timeZone = 'America/Los_Angeles') {
  const month = ratings.filter((g) => inWindow(g.created_at, window));
  const threshold = Number(restaurant.rating_threshold ?? 3);
  const low = month.filter((g) => Number(g.stars) <= threshold);
  const recovery = summarizeRecovery(low);
  const avg = month.length ? month.reduce((n, g) => n + Number(g.stars || 0), 0) / month.length : null;
  return {
    restaurant_id: restaurant.id,
    restaurant_name: restaurant.name,
    to: restaurant.alert_email,
    label: window.label,
    average: avg === null ? null : Math.round(avg * 10) / 10,
    ratings: month.length,
    routed: month.filter((g) => g.routed_to_google).length,
    caught: low.length,
    new_contacts: contacts.filter((c) => inWindow(c.first_seen, window)).length,
    list_size: contacts.length,
    // Only once something was caught: a quiet month keeps the short email.
    ...(low.length ? {
      recovered: recovery.recovered,
      resolved: recovery.resolved,
      top_issues: recovery.topIssues.map(({ label, count }) => ({ label, count })),
      ...(worstPeriod(low, timeZone) ? { worst_period: worstPeriod(low, timeZone) } : {}),
    } : {}),
    // This month's unhappy guests, checked against every later visit up to
    // now: a recovery in the last week of the month still gets its chance.
    ...(() => {
      const back = returnVisits(ratings, contacts, threshold, (g) => inWindow(g.created_at, window));
      return {
        returning: back.returning,
        ...(back.unhappyTracked ? { unhappy_tracked: back.unhappyTracked, unhappy_returned: back.unhappyReturned } : {}),
      };
    })(),
  };
}

/** Every page of a restaurant's rows for one entity. */
async function allRows(svc, entity, restaurantId) {
  const rows = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const page = await svc.entity(entity).filter(
      { restaurant_id: restaurantId },
      svc.queryOperators ? { limit: 1000, offset, order: 'created_date' } : undefined,
    );
    rows.push(...page);
    if (!svc.queryOperators || page.length < 1000) break;
  }
  return rows;
}

/**
 * The cron job. Production only, like every scheduled job here: staging must
 * never email a real restaurant. Restaurants with no alert email, unpaid or
 * demo rows are left out — deliverReports re-checks the last two anyway.
 */
export async function scheduled(env, now = new Date()) {
  if (!mayRunScheduledWork(env)) return { skipped: 'environment', environment: environmentName(env) };
  const svc = serviceRole(env);
  const window = previousMonth(now);
  const restaurants = (await svc.entity('Restaurant').filter({}))
    .filter((x) => !x.demo && isEntitled(x) && EMAIL_RE.test(String(x.alert_email || '')));

  const reports = [];
  for (const restaurant of restaurants) {
    const [ratings, contacts] = await Promise.all([
      allRows(svc, 'GuestRating', restaurant.id),
      allRows(svc, 'GuestContact', restaurant.id),
    ]);
    reports.push(buildReport(restaurant, ratings, contacts, window, env.RESTAURANT_TZ || 'America/Los_Angeles'));
  }
  const result = await deliverReports(env, { reports, window: window.label });
  return { job: 'monthly-report', month: window.label, restaurants: reports.length, ...result };
}
