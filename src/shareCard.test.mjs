/**
 * What the shared picture says.
 *
 * The pixels are not asserted here — they are pixels, and there is no canvas
 * in node. The words are, because a card claiming a saving nobody made is far
 * worse than an ugly one, and this card is going into somebody's feed with a
 * restaurant's name on it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shareCardLines, CARD } from './lib/shareCard.js';

test('the headline is the money that went back where it belonged', () => {
  const lines = shareCardLines({
    title: "Joe's Cantina", people: 6, total: 186, minutes: 4, fairness: { moved: 28 },
  });
  assert.match(lines.headline, /\$28\.00/);
  assert.match(lines.brand, /BillTap/);
  assert.equal(lines.title, "Joe's Cantina");
});

test('a table where nobody was spared makes no claim of a saving', () => {
  // Six identical orders. An even split would have been correct, and saying
  // otherwise is the one lie this card is in a position to tell.
  const lines = shareCardLines({ title: 'Dinner', people: 6, total: 186, fairness: null });
  assert.ok(!/\$/.test(lines.headline), `headline invented a number: ${lines.headline}`);
  assert.match(lines.headline, /own way/i);
});

test('a zero saving is not dressed up as one', () => {
  for (const fairness of [{ moved: 0 }, { saved: 0 }, { moved: null }, {}]) {
    const lines = shareCardLines({ title: 'Dinner', people: 4, total: 80, fairness });
    assert.match(lines.headline, /own way/i, JSON.stringify(fairness));
  }
});

test('one diner’s own saving works as well as the table’s', () => {
  // The guest shares `saved`, the host shares `moved`. Both are the same card.
  const lines = shareCardLines({ title: 'Dinner', people: 6, total: 186, fairness: { saved: 13 } });
  assert.match(lines.headline, /\$13\.00/);
});

test('only the stats that exist are shown', () => {
  const full = shareCardLines({ title: 'D', people: 6, total: 186, minutes: 4, fairness: { moved: 1 } });
  assert.deepEqual(full.stats.map((s) => s.label), ['People', 'Total', 'Settled in']);

  // A split with no timing recorded must not render "Settled in 0 min".
  const noMinutes = shareCardLines({ title: 'D', people: 6, total: 186, fairness: { moved: 1 } });
  assert.deepEqual(noMinutes.stats.map((s) => s.label), ['People', 'Total']);

  const bare = shareCardLines({ title: 'D' });
  assert.deepEqual(bare.stats, []);
});

test('a very long restaurant name cannot run off the card', () => {
  const lines = shareCardLines({ title: 'x'.repeat(200), people: 2, total: 10 });
  assert.ok(lines.title.length <= 40, `title was ${lines.title.length} characters`);
});

test('a missing title degrades to something sayable', () => {
  for (const title of [undefined, null, '']) {
    assert.ok(shareCardLines({ title }).title.length > 0);
  }
});

test('the card is square, because that is what posts', () => {
  assert.equal(CARD.w, CARD.h);
});

test('money is always two decimals, never floating-point noise', () => {
  const lines = shareCardLines({ title: 'D', people: 3, total: 0.1 + 0.2, fairness: { moved: 0.1 + 0.2 } });
  assert.match(lines.headline, /\$0\.30/);
  assert.equal(lines.stats.find((s) => s.label === 'Total')?.value, '$0.30');
});
