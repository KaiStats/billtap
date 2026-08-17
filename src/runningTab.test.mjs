/**
 * The running tab, and the numbers it must never make up.
 *
 * This is the feature consumer Pro is priced on, so the thing worth pinning is
 * not that it lists bills — it is that it reports only what splitHistory
 * actually knows (counts and totals) and never fabricates a per-person "you are
 * owed $X", which the index has no data for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTab, isUnsettled, stillOwing } from './lib/runningTab.js';

test('a completed split is settled, whatever the counts say', () => {
  // The host is the authority on done — they may have taken the last share in
  // cash — so status wins over a stale paid count.
  assert.equal(isUnsettled({ id: 'x', status: 'completed', participants: 5, paid: 2 }), false);
});

test('a split where not everyone has paid is still settling', () => {
  assert.equal(isUnsettled({ id: 'x', status: 'claiming', participants: 5, paid: 2 }), true);
});

test('a split with everyone paid but not marked complete is settled', () => {
  assert.equal(isUnsettled({ id: 'x', status: 'claiming', participants: 4, paid: 4 }), false);
});

test('a brand-new split with no participants yet counts as settling', () => {
  // "nothing has happened yet" is exactly what a tab exists to surface.
  assert.equal(isUnsettled({ id: 'x', status: 'waiting', participants: 0, paid: 0 }), true);
});

test('the tab totals only the bills that are actually outstanding', () => {
  const tab = computeTab([
    { id: 'a', total: 84.20, status: 'claiming', participants: 5, paid: 2, role: 'host' },
    { id: 'b', total: 30.00, status: 'completed', participants: 3, paid: 3, role: 'guest' },
    { id: 'c', total: 15.80, status: 'claiming', participants: 2, paid: 0, role: 'guest' },
  ]);
  assert.equal(tab.count, 2, 'the completed one is not in the tab');
  assert.equal(tab.billsTotal, 100.00, '84.20 + 15.80, the settling bills only');
  assert.equal(tab.asHost, 1);
  assert.deepEqual(tab.unsettled.map((e) => e.id), ['a', 'c']);
});

test('cents sum cleanly, never to a price nobody typed', () => {
  // Floating point: 0.10 + 0.20 is 0.30000000000000004 unrounded.
  const tab = computeTab([
    { id: 'a', total: 0.10, status: 'claiming', participants: 2, paid: 1 },
    { id: 'b', total: 0.20, status: 'claiming', participants: 2, paid: 1 },
  ]);
  assert.equal(tab.billsTotal, 0.30);
});

test('an empty or junk history is an empty tab, not a crash', () => {
  for (const input of [[], null, undefined, [null, {}, { status: 'completed' }]]) {
    const tab = computeTab(input);
    assert.equal(tab.count, 0);
    assert.equal(tab.billsTotal, 0);
  }
});

test('stillOwing reports how many have not paid, never negative', () => {
  assert.equal(stillOwing({ participants: 5, paid: 2 }), 3);
  // A paid count somehow larger than the party is clamped, not shown as -1.
  assert.equal(stillOwing({ participants: 3, paid: 4 }), 0);
  assert.equal(stillOwing({}), 0);
});
