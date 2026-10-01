/**
 * Guest recovery: the manager's "I'm handling it" and outcome, the guest's
 * issue pick, the summary math, and the report rows.
 *
 * The ownership tests are the ones that matter most. A rating id is not a
 * secret — it travels in the alert email — so the server must decide which
 * restaurant the caller owns, and refuse another restaurant's ratings in the
 * same words it uses for ones that do not exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';
import { recoveryRows } from './routes/monthly-report.js';
import { summarizeRecovery, isIssue, isRecoveryStatus } from '../shared/guest-recovery.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
};

function stub({ user = 'user_1', ratings = [] } = {}) {
  const original = globalThis.fetch;
  const patches = [];
  const tables = {
    restaurants: [{ id: 'r1', owner_id: 'user_1' }, { id: 'r2', owner_id: 'user_2' }],
    guest_ratings: ratings,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/auth/v1/user')) {
      return user
        ? new Response(JSON.stringify({ id: user }), { status: 200 })
        : new Response('{}', { status: 401 });
    }
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = (tables[from] || []).filter((row) => {
      for (const [key, value] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (String(value).startsWith('eq.') && String(row[key]) !== String(value).slice(3)) return false;
      }
      return true;
    });
    if ((init.method || 'GET') === 'PATCH') {
      const data = JSON.parse(init.body);
      patches.push({ table: from, id: u.searchParams.get('id')?.slice(3), data });
      return new Response(JSON.stringify(rows.map((r) => ({ ...r, ...data }))), { status: 200 });
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { patches, restore: () => { globalThis.fetch = original; } };
}

const req = () => new Request('https://billtap.app/api/fn/updateGuestRecovery', {
  method: 'POST', headers: { Authorization: 'Bearer token' },
});
const call = (body) => HANDLERS.updateGuestRecovery({ env: ENV, request: req(), body });

test('an owner can claim a low rating, and the claim time is kept', async () => {
  const s = stub({ ratings: [{ id: 'g1', restaurant_id: 'r1', stars: 2 }] });
  try {
    const res = await call({ rating_id: 'g1', status: 'handling' });
    assert.equal(res.status, 200);
    const [p] = s.patches;
    assert.equal(p.id, 'g1');
    assert.equal(p.data.recovery_status, 'handling');
    assert.ok(p.data.recovery_claimed_at > 0);
  } finally { s.restore(); }
});

test('recording an outcome does not overwrite when it was picked up', async () => {
  const s = stub({ ratings: [{ id: 'g1', restaurant_id: 'r1', stars: 2, recovery_claimed_at: 123 }] });
  try {
    const res = await call({ rating_id: 'g1', status: 'recovered' });
    assert.equal(res.status, 200);
    assert.equal(s.patches[0].data.recovery_status, 'recovered');
    assert.equal(s.patches[0].data.recovery_claimed_at, undefined);
    assert.equal((await res.json()).recovery_claimed_at, 123);
  } finally { s.restore(); }
});

test("another restaurant's rating answers exactly like a missing one, and is not written", async () => {
  const s = stub({ ratings: [{ id: 'g9', restaurant_id: 'r2', stars: 1 }] });
  try {
    const theirs = await call({ rating_id: 'g9', status: 'recovered' });
    const missing = await call({ rating_id: 'nope', status: 'recovered' });
    assert.equal(theirs.status, 404);
    assert.deepEqual(await theirs.json(), await missing.json());
    assert.equal(s.patches.length, 0);
  } finally { s.restore(); }
});

test('signed out, unknown status and missing id are refused without a write', async () => {
  const out = stub({ user: null, ratings: [{ id: 'g1', restaurant_id: 'r1' }] });
  try {
    assert.equal((await call({ rating_id: 'g1', status: 'recovered' })).status, 401);
  } finally { out.restore(); }
  const s = stub({ ratings: [{ id: 'g1', restaurant_id: 'r1' }] });
  try {
    assert.equal((await call({ rating_id: 'g1', status: 'fixed-ish' })).status, 400);
    assert.equal((await call({ status: 'recovered' })).status, 400);
    assert.equal(s.patches.length, 0);
  } finally { s.restore(); }
});

test("the guest's issue pick is stored, and an unknown one is dropped without losing the comment", async () => {
  const s = stub({ ratings: [{ id: 'g1', restaurant_id: 'r1', stars: 2 }] });
  try {
    await HANDLERS.submitGuestRating({ env: ENV, body: { action: 'contact', rating_id: 'g1', comment: 'cold', issue: 'food_quality' } });
    await HANDLERS.submitGuestRating({ env: ENV, body: { action: 'contact', rating_id: 'g1', comment: 'slow', issue: 'made_up' } });
    const writes = s.patches.filter((p) => p.table === 'guest_ratings');
    assert.equal(writes[0].data.issue, 'food_quality');
    assert.equal(writes[1].data.issue, undefined);
    assert.equal(writes[1].data.comment, 'slow');
  } finally { s.restore(); }
});

test('summarizeRecovery: rate counts only resolved ratings, and is null when none are', () => {
  assert.equal(summarizeRecovery([{ recovery_status: 'handling' }, {}]).recoveryRate, null);
  const s = summarizeRecovery([
    { recovery_status: 'recovered', issue: 'slow_service' },
    { recovery_status: 'recovered', issue: 'slow_service' },
    { recovery_status: 'guest_left', issue: 'food_quality' },
    { recovery_status: 'handling', issue: 'food_quality' },
    { issue: 'slow_service' },
  ]);
  assert.equal(s.low, 5);
  assert.equal(s.resolved, 3);
  assert.equal(s.recoveryRate, 2 / 3);
  assert.deepEqual(s.topIssues.map((i) => [i.id, i.count]), [['slow_service', 3], ['food_quality', 2]]);
});

test('the shared lists match what migration 0027 allows', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/migrations/0027_guest_recovery.sql', import.meta.url), 'utf8');
  const { ISSUES, RECOVERY_STATUSES } = await import('../shared/guest-recovery.js');
  for (const i of ISSUES) assert.ok(sql.includes(`'${i.id}'`), `${i.id} missing from the issue check`);
  for (const st of RECOVERY_STATUSES) assert.ok(sql.includes(`'${st}'`), `${st} missing from the status check`);
  assert.ok(isIssue('billing') && !isIssue('nope'));
  assert.ok(isRecoveryStatus('follow_up') && !isRecoveryStatus(''));
});

test('report rows: absent fields add nothing, and the rate needs something resolved', () => {
  assert.deepEqual(recoveryRows({}), []);
  assert.deepEqual(recoveryRows({ recovered: 0, resolved: 0 }), [['Recovered before they left', 0]]);
  const rows = recoveryRows({ recovered: 14, resolved: 18, top_issues: [{ label: 'Slow service', count: 8 }, { label: 'x', count: 0 }] });
  assert.deepEqual(rows, [
    ['Recovered before they left', 14],
    ['Recovery rate', '78%'],
    ['Top problem: Slow service', 8],
  ]);
});

test('before migration 0027 is applied, the comment is still saved without the issue', async () => {
  const s = stub({ ratings: [{ id: 'g1', restaurant_id: 'r1', stars: 2 }] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PATCH' && JSON.parse(init.body).issue) {
      return new Response(JSON.stringify({ message: "column \"issue\" does not exist" }), { status: 400 });
    }
    return inner(url, init);
  };
  try {
    const res = await HANDLERS.submitGuestRating({ env: ENV, body: { action: 'contact', rating_id: 'g1', comment: 'cold', issue: 'food_quality' } });
    assert.equal(res.status, 200);
    const saved = s.patches.filter((p) => p.table === 'guest_ratings');
    assert.deepEqual(saved.map((p) => p.data), [{ comment: 'cold' }]);
  } finally { s.restore(); }
});
