/**
 * The operator dashboard's reads, which grow with the restaurant.
 *
 * They were two `select=*` queries with no limit. The obvious fix is a limit,
 * and it is the wrong one: RestaurantDashboard.jsx averages the ratings it is
 * given, shows contacts.length as "Guest emails", and its CSV button exports
 * exactly the array it received. A limit would silently make the average wrong,
 * the count wrong, and an operator's export of their own guest list short —
 * without saying so anywhere.
 *
 * So these assert the property that matters: everything comes back, and if a
 * ceiling is ever reached the response admits it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';

const OWNER = 'user_1';
const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  /**
   * Present because the endpoint under test needs an identity, and identity
   * needs this.
   *
   * It was absent, and the fetch stub below answers every URL — including
   * /auth/v1/user — so the dashboard resolved an owner anyway and these four
   * tests passed against a configuration that answers 401 in production.
   * currentUser() now refuses early and says which binding is missing rather
   * than spending a round trip it knows will fail, which is what surfaced it.
   *
   * The value is nonsense on purpose, like the service key above: the stub
   * never checks it. What matters is that the shape of the environment these
   * tests run in is a shape the app actually works in.
   */
  SUPABASE_ANON_KEY: 'anon-key',
};

function stub({ ratings = [], contacts = [] }) {
  const original = globalThis.fetch;
  const pageSizes = [];
  const tables = {
    restaurants: [{ id: 'r1', owner_id: OWNER }],
    guest_ratings: ratings,
    guest_contacts: contacts,
  };

  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: OWNER }), { status: 200 });
    }
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    let rows = (tables[from] || []).filter((row) => {
      for (const [key, value] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (String(value).startsWith('eq.') && String(row[key]) !== String(value).slice(3)) return false;
      }
      return true;
    });
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset')) || 0;
    if (limit) {
      pageSizes.push({ limit, offset });
      rows = rows.slice(offset, offset + limit);
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };

  return { pageSizes, restore: () => { globalThis.fetch = original; } };
}

const request = () => new Request('https://billtap.app/api/fn/getRestaurantDashboardData', {
  method: 'POST',
  headers: { Authorization: 'Bearer token' },
});

const rowsOf = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`, restaurant_id: 'r1', created_date: String(i).padStart(6, '0'), ...extra,
  }));

test('a list longer than one page comes back whole', async () => {
  // 2,500 contacts is three pages. If paging drops a page the export is short
  // and nothing says so — which is the failure this replaces, not the slowness.
  const { restore } = stub({ contacts: rowsOf(2500, 'c'), ratings: rowsOf(1200, 'g', { stars: 4 }) });
  try {
    const res = await HANDLERS.getRestaurantDashboardData({ env: ENV, request: request() });
    const out = await res.json();
    assert.equal(out.contacts.length, 2500, 'every contact, so the CSV export is complete');
    assert.equal(out.ratings.length, 1200, 'every rating, so the average is the real one');
    assert.equal(out.truncated, undefined, 'and nothing claims otherwise');
  } finally {
    restore();
  }
});

test('no single query asks for an unbounded number of rows', async () => {
  const { pageSizes, restore } = stub({ contacts: rowsOf(2500, 'c') });
  try {
    await HANDLERS.getRestaurantDashboardData({ env: ENV, request: request() });
    assert.ok(pageSizes.length > 0, 'the reads are paged');
    for (const page of pageSizes) {
      assert.ok(page.limit <= 1000, `a page asked for ${page.limit} rows`);
    }
  } finally {
    restore();
  }
});

test('rows are not duplicated or reordered across page boundaries', async () => {
  const { restore } = stub({ contacts: rowsOf(2500, 'c') });
  try {
    const out = await (await HANDLERS.getRestaurantDashboardData({ env: ENV, request: request() })).json();
    const ids = out.contacts.map((c) => c.id);
    assert.equal(new Set(ids).size, 2500, 'no duplicates from a paging overlap');
    assert.deepEqual(ids.slice(0, 3), ['c0', 'c1', 'c2'], 'and a stable order');
  } finally {
    restore();
  }
});

test('the audit row counts what was actually returned', async () => {
  const { restore } = stub({ contacts: rowsOf(1500, 'c') });
  const recorded = [];
  try {
    const res = await HANDLERS.getRestaurantDashboardData({
      env: ENV,
      request: request(),
      audit: async (entry) => { recorded.push(entry); },
    });
    const out = await res.json();
    assert.equal(recorded[0].detail.row_count, 1500);
    assert.equal(recorded[0].detail.row_count, out.contacts.length);
  } finally {
    restore();
  }
});
