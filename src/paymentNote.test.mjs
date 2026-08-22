/**
 * The note the host reads when a payment lands.
 *
 * Every diner used to send the identical string "BillTap Split", so a host
 * with four incoming payments matched them by amount alone — and two people
 * owing the same amount, which is what happens when a couple orders the same
 * thing, could not be told apart at all.
 *
 * These pin the two things that make it useful: it names the sender, and it
 * survives being put in a URL. The second is where this would fail silently —
 * an apostrophe or an emoji in somebody's name is ordinary, and a note that
 * breaks the Venmo link is worse than the constant it replaced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paymentNote, NOTE_MAX } from './lib/paymentNote.js';

test('the note names who is paying', () => {
  const note = paymentNote('Alice', 'Dinner at Joe\'s');
  assert.match(note, /Alice/, 'the whole point: the host can tell who this is');
  assert.match(note, /BillTap/, 'and where it came from');
});

test('two diners on the same bill produce different notes', () => {
  // The failure this replaces. Same split, same amount, previously the same
  // note — so the host confirmed one of them and guessed which.
  const alice = paymentNote('Alice', 'Dinner');
  const bob = paymentNote('Bob', 'Dinner');
  assert.notEqual(alice, bob);
});

test('a name with an apostrophe or an emoji survives being put in a URL', () => {
  // Ordinary names. If encoding mangles these the Venmo handoff breaks for the
  // diner, which is worse than an ambiguous note.
  for (const name of ["O'Brien", 'José', 'Anna 🎉', 'D\'Angelo Jr.']) {
    const note = paymentNote(name, 'Dinner');
    const url = `https://venmo.com/u/host?note=${encodeURIComponent(note)}`;
    // Round-trips: what the host receives is what we composed.
    const parsed = new URL(url).searchParams.get('note');
    assert.equal(parsed, note, `${name} did not survive the round trip`);
  }
});

test('a missing name or title degrades rather than printing undefined', () => {
  // The diner has not passed the name gate yet, or the split came off a bare
  // receipt with no title. "BillTap · undefined" in somebody's bank feed is
  // the kind of detail that makes a product look unfinished.
  for (const note of [
    paymentNote(undefined, undefined),
    paymentNote(null, null),
    paymentNote('', ''),
    paymentNote('   ', '  '),
  ]) {
    assert.equal(note, 'BillTap');
    assert.ok(!/undefined|null/.test(note));
  }

  assert.equal(paymentNote('Alice', ''), 'BillTap · Alice');
  assert.equal(paymentNote('', 'Dinner'), 'BillTap · Dinner');
});

test('a pasted newline cannot break the line in the host feed', () => {
  const note = paymentNote('Alice\nSmith', 'Dinner\r\nat Joe\'s');
  assert.ok(!/[\r\n]/.test(note), 'collapsed to single spaces');
  assert.match(note, /Alice Smith/);
});

test('a very long title cannot push the name out of the note', () => {
  // Truncation has to keep the interesting half. The name is what the host is
  // matching on, so it comes before the title and inside the cap.
  const note = paymentNote('Alice', 'x'.repeat(500));
  assert.ok(note.length <= NOTE_MAX, `note was ${note.length} chars`);
  assert.match(note, /Alice/, 'the sender survives the trim');
});

test('the note is a label, never a claim that money moved', () => {
  // Guards the boundary this sits on. Only the host confirming settles a
  // diner — see confirmPayment in worker/routes/functions.js — so nothing
  // here may read as proof of payment.
  const note = paymentNote('Alice', 'Dinner');
  assert.ok(!/paid|confirmed|settled|received/i.test(note));
});
