/**
 * The number that makes somebody tell a friend.
 *
 * It is also a claim about money made to a diner who has just paid, so the
 * cases worth pinning are the ones where an eager version would overstate it
 * or where a careless one would insult somebody for ordering a steak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evenShare, fairnessFor, tableFairness, MIN_NOTABLE } from './lib/fairness.js';

test('an even share is the bill divided by the people at the table', () => {
  assert.equal(evenShare(186, 6), 31);
  assert.equal(evenShare(100, 3), 33.33);
  assert.equal(evenShare(50, 0), 0, 'no table, no share');
  assert.equal(evenShare(0, 4), 0);
});

test('the diner who did not drink is told what they were spared', () => {
  // The whole point. $186 across six people is $31 each; she ordered $18.
  const fair = fairnessFor({ totalAmount: 186, people: 6, myShare: 18 });
  assert.equal(fair.even, 31);
  assert.equal(fair.actual, 18);
  assert.equal(fair.saved, 13);
  assert.equal(fair.notable, true);
});

test('the diner who ordered more is not told they lost', () => {
  /**
   * The sign is reported honestly — a caller can see it — but the point of
   * the test is that this case is distinguishable, so the copy can say "you
   * paid for what you ordered" rather than inventing a grievance. They did
   * not overpay; an even split is what would have had somebody else
   * subsidise them.
   */
  const fair = fairnessFor({ totalAmount: 186, people: 6, myShare: 44 });
  assert.equal(fair.saved, -13);
  assert.equal(fair.notable, false, 'nothing to celebrate, and nothing to complain about');
});

test('a rounding-noise difference is not dressed up as a saving', () => {
  const noise = fairnessFor({ totalAmount: 120, people: 4, myShare: 29.8 });
  assert.equal(noise.saved, 0.2);
  assert.equal(noise.notable, false, `under $${MIN_NOTABLE} is not worth a line on screen`);
});

test('even and custom splits make no such claim', () => {
  // An even split compared against itself is always zero. A custom split is
  // the host's arrangement, and "what an even split would have cost" is not
  // something this app is entitled to say about it.
  assert.equal(fairnessFor({ totalAmount: 186, people: 6, myShare: 18, splitMode: 'even' }), null);
  assert.equal(fairnessFor({ totalAmount: 186, people: 6, myShare: 18, splitMode: 'custom' }), null);
});

test('a table of one has nothing to compare against', () => {
  // Dining alone: the even split and the itemized split are the same bill,
  // and "you saved $0" is a strange thing to tell somebody.
  assert.equal(fairnessFor({ totalAmount: 40, people: 1, myShare: 40 }), null);
});

test('missing or nonsense numbers produce no claim rather than a wrong one', () => {
  for (const input of [
    { totalAmount: 0, people: 4, myShare: 10 },
    { totalAmount: 100, people: 4, myShare: undefined },
    { totalAmount: null, people: 4, myShare: 10 },
    { totalAmount: 'abc', people: 4, myShare: 10 },
    {},
  ]) {
    assert.equal(fairnessFor(input), null, JSON.stringify(input));
  }
});

// ── The table's version, for the host's shareable card ──────────────────────

test('the table stat counts the money that reached the right people once', () => {
  /**
   * Not the sum of every absolute difference, which double-counts: a dollar
   * one diner did not pay is a dollar another one did. Counting both ends
   * would let a $186 dinner claim it moved $300.
   */
  const participants = [
    { amount_owed: 18 },  // spared 13
    { amount_owed: 22 },  // spared 9
    { amount_owed: 44 },  // ordered more
    { amount_owed: 31 },  // exactly even
    { amount_owed: 25 },  // spared 6
    { amount_owed: 46 },  // ordered more
  ];
  const table = tableFairness({ totalAmount: 186, participants });

  assert.equal(table.moved, 28, '13 + 9 + 6');
  assert.equal(table.biggest, 13);
  assert.equal(table.spared, 3);
  assert.equal(table.people, 6);
  assert.ok(table.moved < 186, 'a table can never move more than the bill');
});

test('a table where everyone ordered the same makes no claim', () => {
  // Six people, six identical orders. An even split would have been correct,
  // and saying otherwise would be inventing a benefit.
  const participants = Array.from({ length: 6 }, () => ({ amount_owed: 31 }));
  assert.equal(tableFairness({ totalAmount: 186, participants }), null);
});

test('the table stat ignores rows with no amount rather than counting them as zero', () => {
  // A diner who joined and has not claimed anything yet owes nothing, and
  // treating that as "spared the whole even share" would inflate the number
  // every time somebody was still deciding.
  const participants = [
    { amount_owed: 18 },
    { amount_owed: null },
    { amount_owed: undefined },
  ];
  const table = tableFairness({ totalAmount: 90, participants });
  assert.equal(table.spared, 1, 'only the diner with a real number counts');
  assert.equal(table.moved, 12, '30 even, 18 paid');
});

test('the table stat is itemized-only too', () => {
  const participants = [{ amount_owed: 10 }, { amount_owed: 50 }];
  assert.equal(tableFairness({ totalAmount: 60, participants, splitMode: 'even' }), null);
  assert.equal(tableFairness({ totalAmount: 60, participants, splitMode: 'custom' }), null);
});
