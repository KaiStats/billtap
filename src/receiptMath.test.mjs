/**
 * The receipt arithmetic that used to cost a network round trip.
 *
 * Shared between the browser and /api/fn/validateReceiptParse, so these run
 * against the one implementation both use — the point of moving it to
 * shared/receipt-math.js was that two copies would drift and the diner would
 * see one answer while the server believed another.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateReceiptParse, parseConfidence } from '../shared/receipt-math.js';

test('a receipt whose numbers agree is valid', () => {
  const out = validateReceiptParse({
    items: [{ name: 'A', price: 10 }, { name: 'B', price: 5 }], tax: 1.2, tip: 3, total: 19.2,
  });
  assert.equal(out.valid, true);
  assert.deepEqual(out.warnings, []);
  assert.equal(out.item_sum, 15);
  assert.equal(out.calculated_total, 19.2);
});

test('quantity counts toward the item sum', () => {
  const out = validateReceiptParse({ items: [{ name: 'Tea', price: 3.25, quantity: 3 }] });
  assert.equal(out.item_sum, 9.75);
});

test('cents do not drift into floating point', () => {
  const out = validateReceiptParse({ items: [{ name: 'A', price: 0.1 }, { name: 'B', price: 0.2 }] });
  assert.equal(out.item_sum, 0.3);
});

test('a total that disagrees by more than a nickel is flagged', () => {
  const out = validateReceiptParse({ items: [{ name: 'A', price: 10 }], total: 25 });
  assert.equal(out.valid, false);
  assert.match(out.warnings[0], /\$10\.00.*\$25\.00/);
});

test('a rounding-sized difference is not flagged', () => {
  assert.equal(validateReceiptParse({ items: [{ name: 'A', price: 10 }], total: 10.04 }).valid, true);
});

test('a non-array items field is an error, not a crash', () => {
  assert.equal(validateReceiptParse({ items: 'nope' }).error, 'Invalid items array');
  assert.equal(validateReceiptParse({}).error, 'Invalid items array');
});

test('warnings are capped so a garbage scan cannot flood the screen', () => {
  const items = Array.from({ length: 20 }, () => ({ name: '', price: -1 }));
  assert.equal(validateReceiptParse({ items }).warnings.length, 5);
});

// ── The confidence the review screen acts on ────────────────────────────────

test('a clean parse is high confidence, so the editor stays shut', () => {
  const result = validateReceiptParse({ items: [{ name: 'A', price: 10 }], total: 10 });
  assert.equal(parseConfidence(result).confidence, 'high');
});

test('numbers that do not reconcile are low confidence', () => {
  // Low is what opens the editor by itself, so it is reserved for a receipt
  // that genuinely does not add up — being wrong here asks someone to check
  // nineteen fields that were already right.
  const result = validateReceiptParse({ items: [{ name: 'A', price: 10 }], total: 40 });
  const confidence = parseConfidence(result);
  assert.equal(confidence.confidence, 'low');
  assert.equal(confidence.issues.sumMismatch, true);
  assert.equal(confidence.issues.calculatedTotal, '10.00');
});

test('an unreadable price is low confidence too', () => {
  const result = validateReceiptParse({ items: [{ name: 'A', price: 'abc' }] });
  assert.equal(parseConfidence(result).confidence, 'low');
});

test('a nameless item is worth a look but does not force the editor open', () => {
  const result = validateReceiptParse({ items: [{ name: '  ', price: 10 }], total: 10 });
  const confidence = parseConfidence(result);
  assert.equal(confidence.confidence, 'medium');
  assert.equal(confidence.issues.sumMismatch, undefined);
});

test('an invalid input yields no confidence rather than a false one', () => {
  assert.equal(parseConfidence(validateReceiptParse({ items: null })), null);
  assert.equal(parseConfidence(null), null);
});
