/**
 * The local index of splits, which is what makes a bill history exist at all
 * for someone with no account.
 *
 * Runs against a minimal localStorage stand-in rather than a browser, because
 * the rules worth pinning here are about data — what gets upgraded, what gets
 * pruned, what happens when storage is unavailable — and none of them need a
 * DOM to be wrong.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    __map: map,
  };
}

globalThis.localStorage = fakeStorage();
const { listSplits, rememberSplit, forgetSplit, clearSplitHistory } =
  await import('./lib/splitHistory.js');

beforeEach(() => { globalThis.localStorage = fakeStorage(); });

test('a split is remembered and comes back', () => {
  rememberSplit({ id: 's1', title: 'Olive Garden', total: 118.4, role: 'host' });
  const [entry] = listSplits();
  assert.equal(entry.id, 's1');
  assert.equal(entry.title, 'Olive Garden');
  assert.equal(entry.total, 118.4);
  assert.equal(entry.role, 'host');
});

test('the newest split is at the top', () => {
  rememberSplit({ id: 'old', title: 'A' });
  rememberSplit({ id: 'new', title: 'B' });
  assert.deepEqual(listSplits().map((e) => e.id), ['new', 'old']);
});

test('remembering the same split again updates it rather than duplicating it', () => {
  rememberSplit({ id: 's1', title: 'Untitled', total: 0, participants: 0, paid: 0 });
  rememberSplit({ id: 's1', title: 'Olive Garden', total: 118.4, participants: 3, paid: 2 });
  const all = listSplits();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Olive Garden');
  assert.equal(all[0].paid, 2);
});

test('being a host is never downgraded by later joining as a diner', () => {
  // The host eats at their own table, so Claim records them too. If that
  // overwrote the role they would be sent to the diner's screen from their own
  // history and lose the confirm buttons.
  rememberSplit({ id: 's1', role: 'host' });
  rememberSplit({ id: 's1', role: 'guest' });
  assert.equal(listSplits()[0].role, 'host');
});

test('a split the server has already dropped is not offered', () => {
  // Session.expires_at is 30 days. A list that opens bills which no longer
  // exist is worse than a shorter list.
  const stale = { id: 'old', title: 'Ancient', created_at: Date.now() - 31 * 24 * 60 * 60 * 1000 };
  localStorage.setItem('billtap-split-history', JSON.stringify([stale]));
  assert.deepEqual(listSplits(), []);
});

test('a split from last week is still offered', () => {
  const recent = { id: 'r', title: 'Recent', created_at: Date.now() - 7 * 24 * 60 * 60 * 1000 };
  localStorage.setItem('billtap-split-history', JSON.stringify([recent]));
  assert.equal(listSplits().length, 1);
});

test('the list is capped, so one phone cannot grow it forever', () => {
  for (let i = 0; i < 80; i++) rememberSplit({ id: `s${i}`, title: `Split ${i}` });
  assert.ok(listSplits().length <= 50);
  assert.equal(listSplits()[0].id, 's79', 'the most recent survive');
});

test('a split can be forgotten, and the whole history cleared', () => {
  rememberSplit({ id: 'a' });
  rememberSplit({ id: 'b' });
  forgetSplit('a');
  assert.deepEqual(listSplits().map((e) => e.id), ['b']);
  clearSplitHistory();
  assert.deepEqual(listSplits(), []);
});

test('an entry with no id is ignored rather than stored', () => {
  rememberSplit({ title: 'Nowhere' });
  assert.deepEqual(listSplits(), []);
  // Checked at the storage layer, not just the read. listSplits() filters out
  // an id-less row anyway, so asserting only on its output cannot tell a
  // rejected write from one that quietly consumed a slot in the 50-entry cap.
  const stored = JSON.parse(localStorage.getItem('billtap-split-history') || '[]');
  assert.deepEqual(stored, [], 'nothing should have been written at all');
});

test('corrupt storage reads as an empty history, not a crash', () => {
  localStorage.setItem('billtap-split-history', '{ not json');
  assert.deepEqual(listSplits(), []);
  rememberSplit({ id: 's1', title: 'Recovered' });
  assert.equal(listSplits()[0].title, 'Recovered');
});

test('storage that refuses to write does not take the screen down with it', () => {
  // Private mode, or a full quota.
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.doesNotThrow(() => rememberSplit({ id: 's1', title: 'Dinner' }));
  assert.doesNotThrow(() => clearSplitHistory());
  assert.deepEqual(listSplits(), []);
});
