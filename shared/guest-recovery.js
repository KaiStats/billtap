/**
 * Guest recovery: what went wrong, and what happened next.
 *
 * One list each, read by the guest's "What went wrong?" screen, the server
 * that stores the answer, the operator dashboard, and the monthly report — so
 * a category the guest can pick is always one the report knows how to count.
 * The database enforces the same values (migration 0027).
 */

/** What the guest says went wrong. Order is the order the guest sees them. */
export const ISSUES = [
  { id: 'slow_service', label: 'Slow service' },
  { id: 'food_quality', label: 'Food quality or temperature' },
  { id: 'order_wrong', label: 'Order wrong or missing' },
  { id: 'staff', label: 'Staff interaction' },
  { id: 'cleanliness', label: 'Cleanliness' },
  { id: 'billing', label: 'Bill or payment' },
  { id: 'other', label: 'Something else' },
];

/**
 * What the manager reports after the alert.
 *
 * 'handling' is the "I'm on it" tap — claimed, not finished. Everything else is
 * an outcome. A rating with no status was never picked up.
 */
export const OUTCOMES = [
  { id: 'recovered', label: 'Recovered' },
  { id: 'partial', label: 'Partly recovered' },
  { id: 'not_recovered', label: 'Not recovered' },
  { id: 'guest_left', label: 'Guest had left' },
  { id: 'follow_up', label: 'Follow-up needed' },
];

export const RECOVERY_STATUSES = ['handling', ...OUTCOMES.map((o) => o.id)];

const ISSUE_IDS = new Set(ISSUES.map((i) => i.id));
const STATUS_IDS = new Set(RECOVERY_STATUSES);

export const isIssue = (v) => typeof v === 'string' && ISSUE_IDS.has(v);
export const isRecoveryStatus = (v) => typeof v === 'string' && STATUS_IDS.has(v);
export const issueLabel = (id) => ISSUES.find((i) => i.id === id)?.label || 'Not given';
export const outcomeLabel = (id) =>
  id === 'handling' ? 'Being handled' : OUTCOMES.find((o) => o.id === id)?.label || 'Not picked up';

/**
 * The recovery numbers for a set of low ratings.
 *
 * `recoveryRate` is recovered (fully) over low ratings that reached an
 * outcome, null when none did — "0%" would claim every guest was lost when the
 * truth is nobody recorded anything. `topIssues` is sorted by count, then by
 * the order of ISSUES so ties read the same way every month.
 */
export function summarizeRecovery(lowRatings) {
  const outcomeIds = new Set(OUTCOMES.map((o) => o.id));
  let recovered = 0, partial = 0, notRecovered = 0, guestLeft = 0, followUp = 0, handling = 0, untouched = 0;
  const issueCounts = new Map();
  for (const r of lowRatings) {
    switch (r.recovery_status) {
      case 'recovered': recovered++; break;
      case 'partial': partial++; break;
      case 'not_recovered': notRecovered++; break;
      case 'guest_left': guestLeft++; break;
      case 'follow_up': followUp++; break;
      case 'handling': handling++; break;
      default: untouched++;
    }
    if (isIssue(r.issue)) issueCounts.set(r.issue, (issueCounts.get(r.issue) || 0) + 1);
  }
  const resolved = lowRatings.filter((r) => outcomeIds.has(r.recovery_status)).length;
  const order = ISSUES.map((i) => i.id);
  const topIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([id, count]) => ({ id, label: issueLabel(id), count }));
  return {
    low: lowRatings.length,
    recovered, partial, notRecovered, guestLeft, followUp, handling, untouched,
    resolved,
    recoveryRate: resolved ? recovered / resolved : null,
    topIssues,
  };
}

// ── When it goes wrong ──────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The service period a local hour falls in. Coarse on purpose: a GM staffs
 * shifts, not hours, and "Friday dinner" is a sentence they can act on.
 */
export function servicePeriod(hour) {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'late night';
}

/** Day of week and hour of an epoch-ms time in an IANA time zone. */
function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const day = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return { day, hour };
}

/**
 * The day-and-shift with the most low ratings, e.g. { label: 'Friday dinner',
 * count: 4 }, or null with fewer than two — one bad night is not a pattern,
 * and naming it as one would send a GM chasing noise.
 */
export function worstPeriod(lowRatings, timeZone = 'America/Los_Angeles') {
  const counts = new Map();
  for (const r of lowRatings) {
    const ms = Number(r.created_at);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    let p;
    try { p = localParts(ms, timeZone); } catch { p = localParts(ms, 'UTC'); }
    if (!DAYS.includes(p.day) || !Number.isFinite(p.hour)) continue;
    const key = `${p.day} ${servicePeriod(p.hour)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  for (const [label, count] of counts) {
    if (count >= 2 && (!best || count > best.count)) best = { label, count };
  }
  return best;
}

// ── Did they come back? ─────────────────────────────────────────────────────

/**
 * Return visits, measured rather than assumed.
 *
 * BillTap can only see a guest twice when they leave the same email twice, so
 * these count what is provable and nothing more:
 *
 *   returning      guests on the list with more than one recorded visit
 *   unhappyReturned  unhappy guests (a low rating with an email) who rated
 *                  again on a later visit — the closest honest proxy for
 *                  "the recovery kept the customer"
 *   unhappyTracked how many unhappy guests left an email at all, so the
 *                  number above is never read without its denominator
 */
/** @param {(r: any) => boolean} [inScope] which unhappy ratings to count */
export function returnVisits(ratings, contacts, threshold = 3, inScope = (_r) => true) {
  const byEmail = new Map();
  for (const r of ratings) {
    const email = typeof r.guest_email === 'string' ? r.guest_email.trim().toLowerCase() : '';
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(Number(r.created_at) || 0);
  }
  let unhappyTracked = 0;
  let unhappyReturned = 0;
  const seen = new Set();
  for (const r of ratings) {
    const email = typeof r.guest_email === 'string' ? r.guest_email.trim().toLowerCase() : '';
    if (!email || Number(r.stars) > threshold || !inScope(r) || seen.has(email)) continue;
    seen.add(email);
    unhappyTracked++;
    const at = Number(r.created_at) || 0;
    if (byEmail.get(email).some((t) => t > at)) unhappyReturned++;
  }
  const returning = contacts.filter((c) => Number(c.visits) > 1).length;
  return { returning, unhappyTracked, unhappyReturned };
}
