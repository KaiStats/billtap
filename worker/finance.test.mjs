/**
 * Financial Intelligence: the arithmetic, the fact list the model is held to,
 * and the ownership and module gates on the handlers.
 *
 * The gate tests matter most. A restaurant's P&L is the most sensitive thing
 * this app would hold, so every handler must resolve the restaurant from the
 * signed-in user, refuse when the module is off, and never let one owner's
 * upload ids attach to another owner's month.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';
import {
  validateSnapshot, kpis, normalizeMonth, guestMonth, combinedFacts, validateInsights, monthBounds, hasModule,
} from '../shared/finance.js';

// ── Arithmetic ──────────────────────────────────────────────────────────────

test('months normalise to the first of the month, and junk is refused', () => {
  assert.equal(normalizeMonth('2026-09'), '2026-09-01');
  assert.equal(normalizeMonth('2026-09-01'), '2026-09-01');
  assert.equal(normalizeMonth('2026-13'), null);
  assert.equal(normalizeMonth('2026-09-15'), null);
  assert.equal(normalizeMonth(null), null);
});

test('a snapshot accepts dollar strings, rejects negative costs, allows a loss', () => {
  const ok = validateSnapshot({ month: '2026-09', revenue: '$120,000.50', labor_cost: 36000, net_income: -2500 });
  assert.equal(ok.ok, true);
  assert.equal(ok.snapshot.revenue, 120000.5);
  assert.equal(ok.snapshot.net_income, -2500);
  assert.equal(ok.snapshot.food_cost, null);

  const bad = validateSnapshot({ month: '2026-09', revenue: 1000, food_cost: -5, covers: 1.5 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.food_cost);
  assert.ok(bad.errors.covers);

  assert.ok(validateSnapshot({ month: '2026-09' }).errors.revenue, 'revenue is required');
});

test('ratios come out right and stay null when an input is missing', () => {
  const k = kpis({ revenue: '100000', food_cost: '25000', beverage_cost: '5000', labor_cost: '32000', net_income: '8000', covers: 2000 });
  assert.equal(k.cogs_pct, 0.3);
  assert.equal(k.labor_pct, 0.32);
  assert.equal(k.prime_cost_pct, 0.62);
  assert.equal(k.net_margin, 0.08);
  assert.equal(k.revenue_per_cover, 50);

  const thin = kpis({ revenue: 100000 });
  assert.equal(thin.cogs_pct, null);
  assert.equal(thin.labor_pct, null);
  assert.equal(thin.prime_cost_pct, null);
});

test('month bounds follow the restaurant clock, not UTC', () => {
  const { start, end } = monthBounds('2026-09-01', 'America/Los_Angeles');
  assert.equal(new Date(start).toISOString(), '2026-09-01T07:00:00.000Z');
  assert.equal(new Date(end).toISOString(), '2026-10-01T07:00:00.000Z');
});

const at = (iso) => Date.parse(iso);
const RATINGS = [
  { stars: 5, created_at: at('2026-09-05T20:00:00Z'), routed_to_google: true },
  { stars: 2, created_at: at('2026-09-06T20:00:00Z'), recovery_status: 'recovered', issue: 'slow_service' },
  { stars: 1, created_at: at('2026-09-07T20:00:00Z'), recovery_status: 'not_recovered', issue: 'slow_service' },
  { stars: 3, created_at: at('2026-09-08T20:00:00Z') },
  { stars: 4, created_at: at('2026-08-10T20:00:00Z') },
  { stars: 2, created_at: at('2026-08-11T20:00:00Z') },
];

test('guest numbers for a month count only that month', () => {
  const g = guestMonth(RATINGS, '2026-09-01', 3);
  assert.equal(g.ratings, 4);
  assert.equal(g.low_ratings, 3);
  assert.equal(g.recovered, 1);
  assert.equal(g.recovery_rate, 0.5);
  assert.equal(g.untouched_alerts, 1);
  assert.equal(g.google_taps, 1);
  assert.equal(g.top_issue.id, 'slow_service');
});

test('combined facts use the latest month and compare against the one before', () => {
  const { month, previous_month, facts } = combinedFacts({
    snapshots: [
      { month: '2026-08-01', revenue: 90000, food_cost: 27000, beverage_cost: null, labor_cost: 27000 },
      { month: '2026-09-01', revenue: 100000, food_cost: 28000, beverage_cost: 2000, labor_cost: 33000 },
    ],
    ratings: RATINGS,
  });
  assert.equal(month, '2026-09-01');
  assert.equal(previous_month, '2026-08-01');
  const f = Object.fromEntries(facts.map((x) => [x.key, x]));
  assert.equal(f.labor_pct.display, '33.0%');
  assert.equal(f.labor_pct_change.display, '+3.0 pts');
  assert.equal(f.revenue_change.display, '+$10,000');
  assert.equal(f.low_ratings.value, 3);
  assert.ok(!('table_spend' in f), 'no per-table spend: BillTap does not know it');
});

test('no confirmed month means no facts', () => {
  assert.deepEqual(combinedFacts({ snapshots: [], ratings: RATINGS }), { month: null, facts: [] });
});

test('an insight citing a fact that does not exist is dropped', () => {
  const facts = [{ key: 'labor_pct' }, { key: 'low_rate' }];
  const kept = validateInsights([
    { title: 'Labor up', body: 'Labor rose.', fact_keys: ['labor_pct'] },
    { title: 'Invented', body: 'Tables that complained spent 18% less.', fact_keys: ['table_spend'] },
    { title: 'Uncited', body: 'Something.', fact_keys: [] },
  ], facts);
  assert.deepEqual(kept.map((i) => i.title), ['Labor up']);
});

test('restaurants without a modules column have Guest Recovery only', () => {
  assert.equal(hasModule({}, 'guest_recovery'), true);
  assert.equal(hasModule({}, 'finance'), false);
  assert.equal(hasModule({ modules: ['guest_recovery', 'finance'] }, 'finance'), true);
});

// ── Handlers ────────────────────────────────────────────────────────────────

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
};

function stub({ user = 'user_1', modules = ['guest_recovery', 'finance'], uploads = [], snapshots = [] } = {}) {
  const original = globalThis.fetch;
  const writes = [];
  const tables = {
    restaurants: [
      { id: 'r1', owner_id: 'user_1', name: 'Mine', modules },
      { id: 'r2', owner_id: 'user_2', name: 'Theirs', modules: ['guest_recovery', 'finance'] },
    ],
    financial_uploads: uploads,
    monthly_snapshots: snapshots,
    combined_insights: [],
    guest_ratings: [],
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/auth/v1/user')) {
      return user ? new Response(JSON.stringify({ id: user }), { status: 200 }) : new Response('{}', { status: 401 });
    }
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const method = init.method || 'GET';
    if (method === 'POST' || method === 'PATCH') {
      const data = JSON.parse(init.body);
      writes.push({ table: from, method, id: u.searchParams.get('id')?.slice(3), data });
      return new Response(JSON.stringify([{ id: 'new', ...data }]), { status: 201 });
    }
    const rows = (tables[from] || []).filter((row) => {
      for (const [key, value] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (String(value).startsWith('eq.') && String(row[key]) !== String(value).slice(3)) return false;
      }
      return true;
    });
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { writes, restore: () => { globalThis.fetch = original; } };
}

const req = (name) => new Request(`https://billtap.app/api/fn/${name}`, {
  method: 'POST', headers: { Authorization: 'Bearer token' },
});
const call = (name, body = {}, env = ENV) => HANDLERS[name]({ env, request: req(name), body });

test('signed-out callers get 401 from every finance handler', async () => {
  const s = stub({ user: null });
  try {
    for (const name of ['getFinanceData', 'uploadFinancialDocument', 'saveMonthlySnapshot', 'generateCombinedInsights']) {
      assert.equal((await call(name)).status, 401, name);
    }
  } finally { s.restore(); }
});

test('finance is refused when the module is off', async () => {
  const s = stub({ modules: ['guest_recovery'] });
  try {
    const res = await call('getFinanceData');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'module_off');
  } finally { s.restore(); }
});

test('a confirmed month is saved to the caller\'s restaurant only', async () => {
  const s = stub({
    uploads: [
      { id: 'u_mine', restaurant_id: 'r1' },
      { id: 'u_theirs', restaurant_id: 'r2' },
    ],
  });
  try {
    const res = await call('saveMonthlySnapshot', {
      snapshot: { month: '2026-09', revenue: 100000, labor_cost: 30000, restaurant_id: 'r2' },
      upload_ids: ['u_mine', 'u_theirs'],
    });
    assert.equal(res.status, 200);
    const created = s.writes.find((w) => w.table === 'monthly_snapshots');
    assert.equal(created.data.restaurant_id, 'r1');
    assert.deepEqual(created.data.source_upload_ids, ['u_mine']);
    const confirmed = s.writes.filter((w) => w.table === 'financial_uploads').map((w) => w.id);
    assert.deepEqual(confirmed, ['u_mine']);
  } finally { s.restore(); }
});

test('bad figures come back field by field and nothing is written', async () => {
  const s = stub();
  try {
    const res = await call('saveMonthlySnapshot', { snapshot: { month: 'September', revenue: 'lots' } });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.fields.month && body.fields.revenue);
    assert.equal(s.writes.length, 0);
  } finally { s.restore(); }
});

test('uploads refuse unsupported types and say so when Claude is not set up', async () => {
  const s = stub();
  try {
    const wrongType = await call('uploadFinancialDocument', { file_name: 'x.xlsx', media_type: 'application/vnd.ms-excel', kind: 'pnl', base64: 'aGk=' });
    assert.equal(wrongType.status, 400);
    const noKey = await call('uploadFinancialDocument', { file_name: 'pnl.csv', media_type: 'text/csv', kind: 'pnl', base64: 'aGk=' });
    assert.equal(noKey.status, 503);
    assert.equal((await noKey.json()).code, 'not_configured');
    assert.equal(s.writes.length, 0);
  } finally { s.restore(); }
});

test('insights need at least one confirmed month', async () => {
  const s = stub();
  try {
    const res = await call('generateCombinedInsights');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'no_snapshots');
  } finally { s.restore(); }
});

test('an upload is stored privately, read by Claude, and returned as a draft', async () => {
  const s = stub();
  const inner = globalThis.fetch;
  const seen = { storage: null, claude: null };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    if (u.pathname.startsWith('/storage/v1/object/finance-uploads/')) {
      seen.storage = u.pathname;
      return new Response('{}', { status: 200 });
    }
    if (u.hostname === 'api.anthropic.com') {
      seen.claude = JSON.parse(typeof url === 'string' ? init.body : await url.text());
      const draft = {
        period_month: '2026-09', currency: 'USD', covers: null, confidence: 'high', notes: '',
        figures: { revenue: 100000, food_cost: 28000, beverage_cost: null, labor_cost: 33000, occupancy_cost: null, marketing_cost: null, other_operating: null, net_income: 9000 },
      };
      return new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(draft) }],
        stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return inner(url, init);
  };
  try {
    const res = await call('uploadFinancialDocument', {
      file_name: 'sept.csv', media_type: 'text/csv', kind: 'pnl', base64: btoa('Revenue,100000\nLabor,33000'),
    }, { ...ENV, ANTHROPIC_API_KEY: 'test-key' });
    assert.equal(res.status, 200);
    const { upload } = await res.json();
    assert.equal(upload.status, 'extracted');
    assert.equal(upload.extracted.period_month, '2026-09-01');
    assert.equal(upload.extracted.figures.labor_cost, 33000);
    assert.equal(upload.storage_key, undefined, 'the storage key never reaches the browser');
    assert.match(seen.storage, /^\/storage\/v1\/object\/finance-uploads\/r1\//);
    assert.equal(seen.claude.model, 'claude-opus-5-5');
    assert.equal(seen.claude.output_config.format.type, 'json_schema');
    const row = s.writes.find((w) => w.table === 'financial_uploads');
    assert.equal(row.data.restaurant_id, 'r1');
  } finally { globalThis.fetch = inner; s.restore(); }
});
