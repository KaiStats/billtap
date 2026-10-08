/**
 * Financial Intelligence, second half: the plans that pay for it, the trial
 * that lets an owner try it, deleting files, the 90-day file retention, the
 * several-documents merge, Excel conversion and the monthly email section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as createCheckout } from './routes/create-checkout.js';
import { onRequestPost as verifyCheckout } from './routes/verify-checkout.js';
import { HANDLERS } from './routes/functions.js';
import { purgeFinanceOriginals, FINANCE_FILE_RETENTION_DAYS } from './routes/finance.js';
import { financeSection } from './routes/monthly-report.js';
import { serviceRole } from './lib/data.js';
import { mergeDrafts, tierById, TIERS } from '../shared/finance.js';
import { sheetsToCsv } from '../src/lib/excelToCsv.js';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_ID: 'price_149',
  STRIPE_FINANCE_PRICE_ID: 'price_249',
  STRIPE_PLATFORM_PRICE_ID: 'price_349',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};

/** Auth, Stripe, storage and PostgREST, recording every write. */
function stub({ user = 'user_1', tables = {}, stripeSession = null } = {}) {
  const original = globalThis.fetch;
  const writes = [];
  const stripe = [];
  const storageDeletes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    if (u.pathname === '/auth/v1/user') {
      return user ? new Response(JSON.stringify({ id: user }), { status: 200 }) : new Response('{}', { status: 401 });
    }
    if (u.hostname === 'api.stripe.com') {
      if (method === 'POST') {
        stripe.push(new URLSearchParams(String(init.body)));
        return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
      }
      return new Response(JSON.stringify(stripeSession || {}), { status: 200 });
    }
    if (u.pathname.startsWith('/storage/v1/object/')) {
      if (method === 'DELETE') storageDeletes.push(u.pathname);
      return new Response('{}', { status: 200 });
    }
    const from = u.pathname.replace('/rest/v1/', '');
    if (method === 'PATCH' || method === 'POST') {
      const data = JSON.parse(init.body || '{}');
      writes.push({ table: from, method, id: u.searchParams.get('id')?.slice(3), data });
      return new Response(JSON.stringify([{ id: 'new', ...data }]), { status: 200 });
    }
    const rows = (tables[from] || []).filter((row) => {
      for (const [key, value] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false;
        if (value.startsWith('lt.') && !(Number(row[key]) < Number(value.slice(3)))) return false;
        if (value === 'not.is.null' && row[key] == null) return false;
      }
      return true;
    });
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { writes, stripe, storageDeletes, restore: () => { globalThis.fetch = original; } };
}

const post = (path, body) => new Request(`https://billtap.app${path}`, {
  method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const TRIAL_ENDS = Date.now() + 10 * 24 * 60 * 60 * 1000;

// ── Plans ───────────────────────────────────────────────────────────────────

test('the three plans are $149, $249 and $349 and unlock the right modules', () => {
  assert.deepEqual(TIERS.map((t) => [t.id, t.price]), [['guest_recovery', 149], ['finance', 249], ['platform', 349]]);
  assert.deepEqual(tierById('platform').modules, ['guest_recovery', 'finance']);
  assert.equal(tierById('nonsense'), null);
});

test('checkout uses the chosen plan\'s price and stamps the tier on the subscription', async () => {
  const s = stub({ user: 'user_1', tables: { restaurants: [{ id: 'r1', owner_id: 'user_1' }] } });
  try {
    const res = await createCheckout({ env: ENV, request: post('/api/create-checkout', { restaurant_id: 'r1', tier: 'platform' }) });
    assert.equal(res.status, 200);
    const [params] = s.stripe;
    assert.equal(params.get('line_items[0][price]'), 'price_349');
    assert.equal(params.get('subscription_data[metadata][tier]'), 'platform');
  } finally { s.restore(); }
});

test('checkout without a tier is the original $149 plan', async () => {
  const s = stub({ user: 'user_1', tables: { restaurants: [{ id: 'r1', owner_id: 'user_1' }] } });
  try {
    await createCheckout({ env: ENV, request: post('/api/create-checkout', { restaurant_id: 'r1' }) });
    assert.equal(s.stripe[0].get('line_items[0][price]'), 'price_149');
  } finally { s.restore(); }
});

test('an unknown plan, or one with no Stripe price yet, is refused before Stripe', async () => {
  const s = stub({ user: 'user_1', tables: { restaurants: [{ id: 'r1', owner_id: 'user_1' }] } });
  try {
    assert.equal((await createCheckout({ env: ENV, request: post('/api/create-checkout', { restaurant_id: 'r1', tier: 'gold' }) })).status, 400);
    const noPrice = { ...ENV, STRIPE_FINANCE_PRICE_ID: '' };
    assert.equal((await createCheckout({ env: noPrice, request: post('/api/create-checkout', { restaurant_id: 'r1', tier: 'finance' }) })).status, 503);
    assert.equal(s.stripe.length, 0);
  } finally { s.restore(); }
});

test('a paid platform checkout switches both modules on', async () => {
  const s = stub({
    user: 'user_1',
    tables: { restaurants: [{ id: 'r1', owner_id: 'user_1' }] },
    stripeSession: {
      payment_status: 'paid', status: 'complete', client_reference_id: 'r1',
      subscription: { id: 'sub_1', status: 'active', metadata: { tier: 'platform' }, items: { data: [] } },
    },
  });
  try {
    const res = await verifyCheckout({ env: ENV, request: post('/api/verify-checkout', { session_id: 'cs_1' }) });
    assert.equal(res.status, 200);
    const patch = s.writes.find((w) => w.table === 'restaurants');
    assert.deepEqual(patch.data.modules, ['guest_recovery', 'finance']);
  } finally { s.restore(); }
});

// ── Trial ───────────────────────────────────────────────────────────────────

test('a restaurant on its trial can switch Finance on', async () => {
  const s = stub({ tables: { restaurants: [{ id: 'r1', owner_id: 'user_1', plan: 'trial', trial_ends_at: TRIAL_ENDS }] } });
  try {
    const res = await HANDLERS.startFinanceTrial({ env: ENV, request: post('/api/fn/startFinanceTrial', {}), body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(s.writes[0].data.modules, ['guest_recovery', 'finance']);
  } finally { s.restore(); }
});

test('a paying $149 restaurant has to upgrade instead', async () => {
  const s = stub({ tables: { restaurants: [{ id: 'r1', owner_id: 'user_1', plan: 'active', current_period_end: TRIAL_ENDS }] } });
  try {
    const res = await HANDLERS.startFinanceTrial({ env: ENV, request: post('/api/fn/startFinanceTrial', {}), body: {} });
    assert.equal(res.status, 402);
    assert.equal((await res.json()).code, 'upgrade_needed');
    assert.equal(s.writes.length, 0);
  } finally { s.restore(); }
});

test('a lapsed restaurant cannot read its finances', async () => {
  const s = stub({ tables: { restaurants: [{ id: 'r1', owner_id: 'user_1', plan: 'cancelled', modules: ['finance'] }] } });
  try {
    const res = await HANDLERS.getFinanceData({ env: ENV, request: post('/api/fn/getFinanceData', {}), body: {} });
    assert.equal(res.status, 402);
  } finally { s.restore(); }
});

// ── Deleting and retention ──────────────────────────────────────────────────

const FINANCE_ON = { id: 'r1', owner_id: 'user_1', plan: 'trial', trial_ends_at: TRIAL_ENDS, modules: ['guest_recovery', 'finance'] };

test('an owner can delete their own file, and only their own', async () => {
  const s = stub({
    tables: {
      restaurants: [FINANCE_ON],
      financial_uploads: [
        { id: 'u1', restaurant_id: 'r1', storage_key: 'r1/a.pdf', status: 'extracted' },
        { id: 'u2', restaurant_id: 'r2', storage_key: 'r2/b.pdf', status: 'extracted' },
      ],
    },
  });
  try {
    const call = (id) => HANDLERS.removeFinancialUpload({ env: ENV, request: post('/api/fn/removeFinancialUpload', {}), body: { upload_id: id } });
    assert.equal((await call('u2')).status, 404);
    assert.equal(s.storageDeletes.length, 0);
    assert.equal((await call('u1')).status, 200);
    assert.deepEqual(s.storageDeletes, ['/storage/v1/object/finance-uploads/r1/a.pdf']);
    const patch = s.writes.find((w) => w.id === 'u1');
    assert.equal(patch.data.storage_key, null);
    assert.equal(patch.data.status, 'discarded');
  } finally { s.restore(); }
});

test('original files older than 90 days are deleted; newer ones stay', async () => {
  const now = Date.now();
  const old = now - (FINANCE_FILE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
  const s = stub({
    tables: {
      financial_uploads: [
        { id: 'old', restaurant_id: 'r1', storage_key: 'r1/old.pdf', created_at: old },
        { id: 'new', restaurant_id: 'r1', storage_key: 'r1/new.pdf', created_at: now },
        { id: 'gone', restaurant_id: 'r1', storage_key: null, created_at: old },
      ],
    },
  });
  try {
    const out = await purgeFinanceOriginals(ENV, serviceRole(ENV), { now });
    assert.deepEqual(out, { considered: 1, deleted: 1, failed: 0 });
    assert.deepEqual(s.storageDeletes, ['/storage/v1/object/finance-uploads/r1/old.pdf']);
  } finally { s.restore(); }
});

// ── Several documents, Excel, email ─────────────────────────────────────────

const draft = (kind, file_name, figures, period_month = '2026-09-01') => ({
  kind, file_name,
  extracted: { period_month, confidence: 'high', notes: '', covers: null, figures: { revenue: null, food_cost: null, beverage_cost: null, labor_cost: null, occupancy_cost: null, marketing_cost: null, other_operating: null, net_income: null, ...figures } },
});

test('several documents merge, with payroll trusted for labor and the P&L for the rest', () => {
  const m = mergeDrafts([
    draft('pnl', 'pnl.pdf', { revenue: 100000, labor_cost: 30000, food_cost: 28000 }),
    draft('payroll', 'payroll.csv', { labor_cost: 33500 }),
    draft('bank', 'august.pdf', { revenue: 1 }, '2026-08-01'),
  ]);
  assert.equal(m.period_month, '2026-09-01');
  assert.equal(m.figures.labor_cost, 33500);
  assert.equal(m.sources.labor_cost, 'payroll.csv');
  assert.equal(m.figures.revenue, 100000);
  assert.equal(m.figures.food_cost, 28000);
  assert.deepEqual(m.other_months, ['august.pdf']);
});

test('an Excel workbook becomes CSV with every sheet labelled', () => {
  const csv = sheetsToCsv([
    { sheet: 'Summary', data: [['Month', new Date('2026-09-01T00:00:00Z')], ['Revenue', 100000, null]] },
    { sheet: 'Empty', data: [[null, null]] },
    { sheet: 'Detail', data: [['Item, with comma', 'say "hi"']] },
  ]);
  assert.equal(csv, '# Sheet: Summary\nMonth,2026-09-01\nRevenue,100000\n\n# Sheet: Detail\n"Item, with comma","say ""hi"""');
});

test('the monthly email shows the latest month and only that month\'s insights', () => {
  const section = financeSection(
    { month: '2026-09-01', revenue: '100000', food_cost: '28000', beverage_cost: '2000', labor_cost: '33000', net_income: '9000' },
    { month: '2026-09-01', insights: [{ title: 'Labor up', body: 'Labor rose.', fact_keys: ['labor_pct'] }] },
  );
  assert.equal(section.month_label, 'September 2026');
  assert.deepEqual(section.rows[2], ['Labor', '33.0%']);
  assert.equal(section.insights.length, 1);
  assert.equal(financeSection({ month: '2026-09-01', revenue: 1 }, { month: '2026-08-01', insights: [{ title: 'x', body: 'y' }] }).insights.length, 0);
  assert.equal(financeSection(null, null), null);
});

// ── Review fixes ────────────────────────────────────────────────────────────

import { kpis, combinedFacts, insightIsCurrent } from '../shared/finance.js';

test('a missing beverage cost leaves prime cost unknown instead of reading low', () => {
  const k = kpis({ revenue: 100000, food_cost: 25000, beverage_cost: null, labor_cost: 30000 });
  assert.equal(k.cogs_pct, null);
  assert.equal(k.prime_cost_pct, null);
  assert.equal(kpis({ revenue: 100000, food_cost: 25000, beverage_cost: 0, labor_cost: 30000 }).prime_cost_pct, 0.55);
});

test('month-over-month facts only compare consecutive months', () => {
  const gap = combinedFacts({
    snapshots: [{ month: '2026-06-01', revenue: 90000, labor_cost: 27000 }, { month: '2026-09-01', revenue: 100000, labor_cost: 33000 }],
    ratings: [],
  });
  assert.equal(gap.previous_month, null);
  assert.ok(!gap.facts.some((f) => f.key.endsWith('_change')));
  const jan = combinedFacts({
    snapshots: [{ month: '2025-12-01', revenue: 90000 }, { month: '2026-01-01', revenue: 100000 }],
    ratings: [],
  });
  assert.equal(jan.previous_month, '2025-12-01');
});

test('insights go stale when their month or the month before is re-confirmed', () => {
  const insight = { month: '2026-09-01', created_at: 1000 };
  assert.equal(insightIsCurrent(insight, [{ month: '2026-09-01', confirmed_at: 900 }]), true);
  assert.equal(insightIsCurrent(insight, [{ month: '2026-09-01', confirmed_at: 1100 }]), false);
  assert.equal(insightIsCurrent(insight, [{ month: '2026-08-01', confirmed_at: 1100 }]), false);
  assert.equal(insightIsCurrent(insight, [{ month: '2026-07-01', confirmed_at: 1100 }]), true);
  assert.equal(insightIsCurrent(null, []), false);
});
