#!/usr/bin/env node
/**
 * Nexus exposure map: customers by state, against each state's economic nexus
 * threshold.
 *
 * ── Why this could not be run before ────────────────────────────────────────
 *
 * The state was captured nowhere. Not on the Restaurant row, not on the lead,
 * and not in Stripe — Checkout collects only what the card network needs, and
 * billing_address_collection was never set. So the customer list could not be
 * grouped by state at all, and the question had no answer that could be
 * computed from anything. That is fixed forward: create-checkout now requires
 * an address and verify-checkout mirrors it onto the Restaurant row. It is not
 * fixed backward — every subscription created before that shipped has no
 * address, and Stripe cannot invent one.
 *
 * Which is why this reports UNKNOWN as its own line rather than folding it into
 * the total. A customer whose state is unknown is unmeasured exposure, and
 * quietly treating unmeasured as zero is the failure mode worth designing out.
 *
 * ── The number that surprises people ────────────────────────────────────────
 *
 * At $149/month a customer bills twelve times a year and produces $1,788. The
 * $100,000 revenue test therefore takes about 56 customers in one state. A 200
 * transaction test takes about 17. In the sixteen states that still have a
 * transaction test, the count is reached roughly three times sooner than the
 * revenue — the opposite of most people's intuition.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * Not tax advice, and not authoritative. It scores against
 * compliance/nexus-thresholds.json, a hand-maintained file where most rows are
 * marked unverified. Unverified states are listed separately and never scored,
 * so a blank row cannot be read as safety. Registration, taxability of SaaS in
 * a given state, marketplace rules and local home-rule jurisdictions are all
 * outside what this computes.
 *
 * Usage:
 *   node scripts/nexus-report.mjs --stripe            # live, needs STRIPE_SECRET_KEY
 *   node scripts/nexus-report.mjs --input custom.json # a file of {state, revenue_usd, transactions}
 *   node scripts/nexus-report.mjs --price 149 --demo  # worked example, no data needed
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THRESHOLDS = resolve(HERE, '../compliance/nexus-thresholds.json');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

/** Everything above this fraction of a threshold is worth acting on now. */
const WARN_AT = 0.75;
const WATCH_AT = 0.5;

// ── Gathering the customer list ─────────────────────────────────────────────

/**
 * Stripe is the system of record for who is paying.
 *
 * Subscriptions rather than customers, because a cancelled customer stops
 * accruing toward a threshold and an active one keeps going. Addresses come
 * from the expanded customer.
 */
async function fromStripe(key) {
  const rows = [];
  let startingAfter = null;

  for (;;) {
    const params = new URLSearchParams({ limit: '100', status: 'all', 'expand[]': 'data.customer' });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const page = await res.json();
    if (!res.ok) throw new Error(`Stripe: ${page?.error?.message || res.status}`);

    for (const sub of page.data) {
      const customer = typeof sub.customer === 'object' ? sub.customer : null;
      const state = (customer?.address?.state || '').toUpperCase() || null;
      const monthly = (sub.items?.data || [])
        .reduce((sum, item) => sum + ((item.price?.unit_amount || 0) / 100) * (item.quantity || 1), 0);

      // Months billed so far, capped at a rolling twelve — every state measures
      // over a period, and twelve months is the most common.
      const started = sub.start_date ? new Date(sub.start_date * 1000) : new Date();
      const months = Math.min(12, Math.max(0, Math.round((Date.now() - started) / (30.44 * 86400000))));

      rows.push({
        id: sub.id,
        state,
        active: ['active', 'trialing', 'past_due'].includes(sub.status),
        revenue_usd: monthly * months,
        transactions: months,
      });
    }

    if (!page.has_more) break;
    startingAfter = page.data.at(-1).id;
  }
  return rows;
}

/** A worked example, so the shape of the output is inspectable with no data at all. */
function demoRows(price) {
  const plan = [['TX', 9], ['CA', 4], ['NY', 3], ['FL', 21], ['GA', 6], [null, 5]];
  return plan.flatMap(([state, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: `demo_${state || 'unknown'}_${i}`,
      state,
      active: true,
      revenue_usd: price * 12,
      transactions: 12,
    })));
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function scoreState(code, totals, thresholds) {
  const rule = thresholds.states[code];
  if (!rule || rule.status !== 'verified') return { code, ...totals, status: 'unverified' };
  if (rule.test === 'no_sales_tax') return { code, ...totals, status: 'no_sales_tax' };

  const revenueRatio = rule.revenue_usd ? totals.revenue_usd / rule.revenue_usd : 0;
  const txnRatio = rule.transactions ? totals.transactions / rule.transactions : 0;

  // Conjunctive states need both; everywhere else either one triggers, so the
  // nearer of the two is what matters.
  const conjunctive = rule.test === 'revenue_and_transactions';
  const ratio = conjunctive ? Math.min(revenueRatio, txnRatio) : Math.max(revenueRatio, txnRatio);

  return {
    code,
    ...totals,
    status: ratio >= 1 ? 'EXCEEDED' : ratio >= WARN_AT ? 'approaching' : ratio >= WATCH_AT ? 'watch' : 'clear',
    ratio,
    rule,
    driver: !conjunctive && txnRatio > revenueRatio ? 'transactions' : 'revenue',
  };
}

const money = (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// ── Report ──────────────────────────────────────────────────────────────────

async function main() {
  const thresholds = JSON.parse(await readFile(THRESHOLDS, 'utf8'));

  let rows;
  if (has('demo')) {
    rows = demoRows(Number(flag('price', 149)));
  } else if (has('stripe')) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error('STRIPE_SECRET_KEY is not set. Export it, or run with --demo.');
      process.exit(1);
    }
    rows = await fromStripe(key);
  } else if (flag('input')) {
    rows = JSON.parse(await readFile(resolve(process.cwd(), flag('input')), 'utf8'));
  } else {
    console.error('Pass --stripe, --input <file>, or --demo. See the header of this file.');
    process.exit(1);
  }

  const active = rows.filter((r) => r.active !== false);
  const byState = new Map();
  const unknown = { customers: 0, revenue_usd: 0, transactions: 0 };

  for (const row of active) {
    if (!row.state) {
      unknown.customers += 1;
      unknown.revenue_usd += row.revenue_usd || 0;
      unknown.transactions += row.transactions || 0;
      continue;
    }
    const acc = byState.get(row.state) || { customers: 0, revenue_usd: 0, transactions: 0 };
    acc.customers += 1;
    acc.revenue_usd += row.revenue_usd || 0;
    acc.transactions += row.transactions || 0;
    byState.set(row.state, acc);
  }

  const scored = [...byState.entries()]
    .map(([code, totals]) => scoreState(code, totals, thresholds))
    .sort((a, b) => (b.ratio || 0) - (a.ratio || 0));

  console.log('\nNEXUS EXPOSURE MAP');
  console.log(`thresholds verified ${thresholds.verified_on} · ${active.length} active customers\n`);
  console.log('  ST  customers   revenue   txns   threshold            status');
  console.log('  ──  ─────────   ───────   ────   ──────────────────   ──────');

  for (const s of scored) {
    const t = s.rule
      ? `${s.rule.revenue_usd ? money(s.rule.revenue_usd) : '—'}${s.rule.transactions ? ` / ${s.rule.transactions} txn` : ''}`
      : '—';
    const pct = s.ratio != null ? ` ${Math.round(s.ratio * 100)}%` : '';
    const via = s.status === 'EXCEEDED' || s.status === 'approaching' ? ` via ${s.driver}` : '';
    console.log(
      `  ${s.code.padEnd(3)} ${String(s.customers).padStart(8)}   ${money(s.revenue_usd).padStart(8)}   ${String(s.transactions).padStart(4)}   ${t.padEnd(20)} ${s.status}${pct}${via}`,
    );
  }

  if (unknown.customers) {
    console.log(
      `\n  ⚠  ${unknown.customers} customers have NO STATE on file — ${money(unknown.revenue_usd)}, ` +
      `${unknown.transactions} transactions of unmeasured exposure.`,
    );
    console.log('     These predate billing_address_collection in create-checkout.');
    console.log('     Ask them, or pull the address from the card on file in Stripe.');
  }

  const unverified = scored.filter((s) => s.status === 'unverified');
  if (unverified.length) {
    console.log(
      `\n  ⚠  ${unverified.length} states have customers but NO VERIFIED THRESHOLD ` +
      `(${unverified.map((s) => s.code).join(', ')}).`,
    );
    console.log('     Not scored, and not safe. Fill them in from a current source, or');
    console.log('     switch to a service that maintains this: Stripe Tax is one');
    console.log('     integration away given checkout already runs on Stripe.');
  }

  const hot = scored.filter((s) => s.status === 'EXCEEDED' || s.status === 'approaching');
  console.log(hot.length
    ? `\n  ${hot.length} state(s) at or near a threshold. Registration is the next step, not this script.`
    : '\n  No verified state is within 75% of a threshold.');

  console.log('\n  Not tax advice. See the header of compliance/nexus-thresholds.json.\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
