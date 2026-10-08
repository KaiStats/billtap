/**
 * Financial Intelligence: the arithmetic, shared by the Worker and the
 * dashboard so both show the same number.
 *
 * ── The rule this module exists to keep ─────────────────────────────────────
 *
 * Every number an owner sees is computed here, from rows they confirmed. The
 * model reads documents and writes sentences; it never does the sums. A
 * combined insight is a sentence about a fact from `combinedFacts`, and the
 * fact carries its own value, so a wrong sentence can be checked against it.
 *
 * What BillTap does NOT know, and so nothing here claims: what an individual
 * table spent (BillTap never handles the money, and a rating-only scan has no
 * bill at all), or labor by day of week (snapshots are monthly). Insights
 * like "tables that triggered alerts spent 18% less" need data this product
 * does not collect, and are not computed.
 */
import { summarizeRecovery } from './guest-recovery.js';

export const MODULES = ['guest_recovery', 'finance'];
export const hasModule = (restaurant, id) =>
  Array.isArray(restaurant?.modules) ? restaurant.modules.includes(id) : id === 'guest_recovery';

export const UPLOAD_KINDS = [
  { id: 'pnl', label: 'Profit & loss statement' },
  { id: 'payroll', label: 'Payroll report' },
  { id: 'bank', label: 'Bank statement' },
  { id: 'sales', label: 'POS sales report' },
  { id: 'other', label: 'Something else' },
];
export const isUploadKind = (v) => UPLOAD_KINDS.some((k) => k.id === v);

/** Money fields on a monthly snapshot, in display order. */
export const MONEY_FIELDS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'food_cost', label: 'Food cost' },
  { id: 'beverage_cost', label: 'Beverage cost' },
  { id: 'labor_cost', label: 'Labor cost' },
  { id: 'occupancy_cost', label: 'Rent & occupancy' },
  { id: 'marketing_cost', label: 'Marketing' },
  { id: 'other_operating', label: 'Other operating costs' },
  { id: 'net_income', label: 'Net income' },
];

/** Accepted upload types: what Claude can read as a document or as text. */
export const UPLOAD_MEDIA_TYPES = ['application/pdf', 'text/csv', 'text/plain'];
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/;

/** '2026-09' or '2026-09-01' → '2026-09-01'; anything else → null. */
export function normalizeMonth(value) {
  const m = typeof value === 'string' ? MONTH_RE.exec(value.trim()) : null;
  return m ? `${m[1]}-${m[2]}-01` : null;
}

function money(value, { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { ok: false };
  if (!allowNegative && n < 0) return { ok: false };
  if (Math.abs(n) >= 1e12) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * An owner-confirmed snapshot, checked. Returns { ok, snapshot } or
 * { ok: false, errors: { field: message } }. Unknown fields are dropped.
 */
export function validateSnapshot(input) {
  const errors = {};
  const snapshot = {};
  const month = normalizeMonth(input?.month);
  if (!month) errors.month = 'Pick a month';
  else snapshot.month = month;

  for (const { id, label } of MONEY_FIELDS) {
    const r = money(input?.[id], { allowNegative: id === 'net_income' });
    if (!r.ok) errors[id] = `${label} must be a dollar amount${id === 'net_income' ? '' : ' of zero or more'}`;
    else snapshot[id] = r.value;
  }

  const coversRaw = input?.covers;
  if (coversRaw === null || coversRaw === undefined || coversRaw === '') snapshot.covers = null;
  else {
    const c = Number(coversRaw);
    if (!Number.isInteger(c) || c < 0) errors.covers = 'Covers must be a whole number';
    else snapshot.covers = c;
  }

  if (snapshot.revenue === null && !errors.revenue) errors.revenue = 'Revenue is needed for every ratio';

  const notes = typeof input?.notes === 'string' ? input.notes.trim().slice(0, 2000) : '';
  snapshot.notes = notes || null;

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, snapshot };
}

const ratio = (part, whole) =>
  part === null || part === undefined || !whole ? null : Number(part) / Number(whole);

/** The industry-standard ratios for one month. Null where an input is missing. */
export function kpis(s) {
  const revenue = s?.revenue == null ? null : Number(s.revenue);
  const cogs = s?.food_cost == null && s?.beverage_cost == null
    ? null
    : Number(s?.food_cost || 0) + Number(s?.beverage_cost || 0);
  const labor = s?.labor_cost == null ? null : Number(s.labor_cost);
  return {
    revenue,
    cogs_pct: ratio(cogs, revenue),
    labor_pct: ratio(labor, revenue),
    prime_cost_pct: cogs === null || labor === null ? null : ratio(cogs + labor, revenue),
    net_margin: ratio(s?.net_income, revenue),
    revenue_per_cover: s?.covers ? (revenue === null ? null : revenue / s.covers) : null,
  };
}

/** [start, end) of a month in epoch ms, in the restaurant's time zone. */
export function monthBounds(month, timeZone = 'America/Los_Angeles') {
  const [y, m] = month.split('-').map(Number);
  const offsetAt = (utcMs) => {
    // The zone's offset from UTC at this instant, in ms.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - utcMs;
  };
  const localMidnight = (yy, mm) => {
    const guess = Date.UTC(yy, mm - 1, 1);
    return guess - offsetAt(guess);
  };
  return {
    start: localMidnight(y, m),
    end: m === 12 ? localMidnight(y + 1, 1) : localMidnight(y, m + 1),
  };
}

/** Guest-side numbers for one month, from the ratings the dashboard already loads. */
export function guestMonth(ratings, month, threshold = 3, timeZone) {
  const { start, end } = monthBounds(month, timeZone);
  const inMonth = (ratings || []).filter((r) => r.created_at >= start && r.created_at < end);
  const low = inMonth.filter((r) => r.stars <= threshold);
  const recovery = summarizeRecovery(low);
  return {
    ratings: inMonth.length,
    avg_stars: inMonth.length ? inMonth.reduce((a, r) => a + r.stars, 0) / inMonth.length : null,
    low_ratings: low.length,
    low_rate: inMonth.length ? low.length / inMonth.length : null,
    recovered: recovery.recovered,
    recovery_rate: recovery.recoveryRate,
    untouched_alerts: recovery.untouched,
    google_taps: inMonth.filter((r) => r.routed_to_google).length,
    top_issue: recovery.topIssues[0] || null,
  };
}

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const usd = (v) => (v === null ? 'n/a' : `$${Math.round(v).toLocaleString('en-US')}`);

/**
 * Every fact the combined insight may use, for the latest confirmed month and
 * the month before it. Each fact has a stable key, a label, a raw value and a
 * display string; the model is given exactly this list and must cite keys.
 */
export function combinedFacts({ snapshots, ratings, threshold = 3, timeZone }) {
  const sorted = [...(snapshots || [])].sort((a, b) => (a.month < b.month ? 1 : -1));
  const [cur, prev] = sorted;
  if (!cur) return { month: null, facts: [] };

  const facts = [];
  const add = (key, label, value, display) => facts.push({ key, label, value, display });

  const k = kpis(cur);
  const g = guestMonth(ratings, cur.month, threshold, timeZone);
  add('revenue', 'Revenue this month', k.revenue, usd(k.revenue));
  add('cogs_pct', 'Food + beverage cost as % of revenue', k.cogs_pct, pct(k.cogs_pct));
  add('labor_pct', 'Labor as % of revenue', k.labor_pct, pct(k.labor_pct));
  add('prime_cost_pct', 'Prime cost (food + bev + labor) as % of revenue', k.prime_cost_pct, pct(k.prime_cost_pct));
  add('net_margin', 'Net margin', k.net_margin, pct(k.net_margin));
  if (k.revenue_per_cover !== null) add('revenue_per_cover', 'Revenue per cover', k.revenue_per_cover, usd(k.revenue_per_cover));
  add('guest_ratings', 'Guest ratings collected', g.ratings, String(g.ratings));
  add('avg_stars', 'Average guest rating', g.avg_stars, g.avg_stars === null ? 'n/a' : g.avg_stars.toFixed(2));
  add('low_ratings', `Ratings at or below ${threshold} stars`, g.low_ratings, String(g.low_ratings));
  add('low_rate', 'Share of ratings that were low', g.low_rate, pct(g.low_rate));
  add('recovery_rate', 'Recovery rate (recovered ÷ low ratings with an outcome)', g.recovery_rate, pct(g.recovery_rate));
  add('untouched_alerts', 'Low ratings nobody marked as handled', g.untouched_alerts, String(g.untouched_alerts));
  add('google_taps', 'Guests who tapped through to Google', g.google_taps, String(g.google_taps));
  if (g.top_issue) add('top_issue', 'Most common problem guests picked', g.top_issue.count, `${g.top_issue.label} (${g.top_issue.count})`);

  if (prev) {
    const pk = kpis(prev);
    const pg = guestMonth(ratings, prev.month, threshold, timeZone);
    const delta = (key, label, a, b, fmt) => {
      if (a === null || b === null) return;
      add(key, label, a - b, fmt(a - b));
    };
    const pts = (d) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts`;
    delta('revenue_change', 'Revenue change vs last month', k.revenue, pk.revenue, (d) => `${d >= 0 ? '+' : '-'}${usd(Math.abs(d))}`);
    delta('labor_pct_change', 'Labor % change vs last month', k.labor_pct, pk.labor_pct, pts);
    delta('prime_cost_change', 'Prime cost % change vs last month', k.prime_cost_pct, pk.prime_cost_pct, pts);
    delta('low_rate_change', 'Low-rating share change vs last month', g.low_rate, pg.low_rate, pts);
    delta('recovery_rate_change', 'Recovery rate change vs last month', g.recovery_rate, pg.recovery_rate, pts);
  }

  return { month: cur.month, previous_month: prev?.month || null, facts };
}

/** Insight output is accepted only if every cited key is a real fact. */
export function validateInsights(insights, facts) {
  const keys = new Set((facts || []).map((f) => f.key));
  if (!Array.isArray(insights)) return [];
  return insights
    .filter((i) => i && typeof i.title === 'string' && typeof i.body === 'string'
      && Array.isArray(i.fact_keys) && i.fact_keys.length > 0
      && i.fact_keys.every((key) => keys.has(key)))
    .slice(0, 5)
    .map((i) => ({ title: i.title.slice(0, 120), body: i.body.slice(0, 600), fact_keys: i.fact_keys }));
}
