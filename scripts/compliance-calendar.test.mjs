/**
 * The filing calendar's date arithmetic.
 *
 * A calendar that is confidently wrong is worse than no calendar: a missed
 * remittance deadline carries a penalty, and nobody re-derives a date their
 * tool already printed. Two off-by-ones do the damage — a period closing in
 * December is due the following January, and "the last day of the month" is a
 * different number every month — so both are pinned here along with the
 * weekend and federal holiday roll.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { schedule } from './compliance-calendar.mjs';

const from = (s) => new Date(`${s}T00:00:00Z`);
const TX = { state: 'TX', frequency: 'monthly', due_day: 20 };

test('a period is due in the month after it closes', () => {
  // Asked on 2 August, the first thing due is July's return, on the 20th.
  const [first] = schedule(TX, from('2026-08-02'), 2);
  assert.equal(first.period_end, '2026-07-31');
  assert.equal(first.statutory_due, '2026-08-20');
});

test('a December period is due in January of the next year', () => {
  // The year rollover: the return names the period, the deadline belongs to
  // the following month, and getting that wrong makes every December filing
  // twelve months early.
  const rows = schedule(TX, from('2026-12-01'), 3);
  const december = rows.find((r) => r.period_end === '2026-12-31');
  assert.ok(december, 'the December period is scheduled');
  assert.equal(december.statutory_due, '2027-01-20');
});

test('a due date on a weekend rolls to the next business day', () => {
  // 2026-09-20 is a Sunday.
  const [first] = schedule(TX, from('2026-09-01'), 1);
  assert.equal(first.statutory_due, '2026-09-20');
  assert.equal(first.due, '2026-09-21');
  assert.equal(first.rolled, true);
});

test('a due date on a federal holiday rolls too', () => {
  // Christmas Day 2026 is a Friday, so a 25th deadline moves to the Monday.
  const wa = { state: 'WA', frequency: 'monthly', due_day: 25 };
  const rows = schedule(wa, from('2026-12-01'), 2);
  const november = rows.find((r) => r.period_end === '2026-11-30');
  assert.equal(november.statutory_due, '2026-12-25');
  assert.equal(november.due, '2026-12-28');
});

test('a weekday due date is left alone', () => {
  const rows = schedule(TX, from('2026-10-01'), 1);
  assert.equal(rows[0].due, '2026-10-20');
  assert.equal(rows[0].rolled, false);
});

test('"last" resolves to the actual last day of each month', () => {
  const monthly = { state: 'ME', frequency: 'monthly', due_day: 'last' };
  const rows = schedule(monthly, from('2027-01-01'), 4);
  const byPeriod = Object.fromEntries(rows.map((r) => [r.period_end, r.statutory_due]));
  assert.equal(byPeriod['2027-01-31'], '2027-02-28', 'February is not 31 days');
  assert.equal(byPeriod['2027-02-28'], '2027-03-31');
  assert.equal(byPeriod['2027-03-31'], '2027-04-30', 'April is not 31 days');
});

test('a due day past the end of a short month is clamped, not overflowed', () => {
  // Date arithmetic would happily turn February 30th into March 2nd and
  // schedule a filing two days after it was due.
  const late = { state: 'XX', frequency: 'monthly', due_day: 30 };
  const rows = schedule(late, from('2027-01-01'), 3);
  const january = rows.find((r) => r.period_end === '2027-01-31');
  assert.equal(january.statutory_due, '2027-02-28');
});

test('a leap February is handled', () => {
  const monthly = { state: 'XX', frequency: 'monthly', due_day: 'last' };
  const rows = schedule(monthly, from('2028-01-01'), 3);
  const january = rows.find((r) => r.period_end === '2028-01-31');
  assert.equal(january.statutory_due, '2028-02-29');
});

test('quarterly filings close only at the ends of quarters', () => {
  const ny = { state: 'NY', frequency: 'quarterly', due_day: 20, first_period_end: '2026-03-31' };
  // 13 months, because the window is on due dates: the Q4 period ends
  // 2026-12-31 and is not due until 2027-01-20.
  const rows = schedule(ny, from('2026-01-01'), 13);
  assert.deepEqual(
    rows.map((r) => r.period_end),
    ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31'],
  );
});

test('annual filings happen once a year', () => {
  const ma = { state: 'MA', frequency: 'annual', due_day: 'last', first_period_end: '2026-12-31' };
  const rows = schedule(ma, from('2026-01-01'), 14);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period_end, '2026-12-31');
  assert.equal(rows[0].statutory_due, '2027-01-31');
});

test('an annual filer registered last year owes last year return now', () => {
  // Asked in January, the 2025 return is due this month — the single most
  // commonly missed filing there is, and the one the old sweep dropped.
  const ma = { state: 'MA', frequency: 'annual', due_day: 'last' };
  const rows = schedule(ma, from('2026-01-01'), 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period_end, '2025-12-31');
  assert.equal(rows[0].statutory_due, '2026-01-31');
  assert.equal(rows[0].due, '2026-02-02', '31 January 2026 is a Saturday');
});

test('semi-annual filings happen twice', () => {
  const rows = schedule(
    { state: 'XX', frequency: 'semiannual', due_day: 20, first_period_end: '2026-06-30' },
    from('2026-01-01'), 13,
  );
  assert.deepEqual(rows.map((r) => r.period_end), ['2026-06-30', '2026-12-31']);
});

test('periods before the first registered one are not scheduled', () => {
  // Registering in October does not owe a return for August.
  const rows = schedule({ ...TX, first_period_end: '2026-10-31' }, from('2026-08-01'), 6);
  assert.ok(rows.every((r) => r.period_end >= '2026-10-31'));
  assert.ok(!rows.some((r) => r.period_end === '2026-08-31'));
});

test('a period that closed before today is still listed if it is due now', () => {
  // The bug this pins: run on the 1st of September and the August return, due
  // on the 20th, is the most urgent filing there is. Sweeping only from the
  // current month dropped it without a word.
  const rows = schedule(TX, from('2026-09-01'), 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period_end, '2026-08-31');
  assert.equal(rows[0].due, '2026-09-21', 'the 20th is a Sunday');
});

test('the window is measured on due dates, not on periods', () => {
  // The December 2026 period is not due until 2027-01-31, so it does not
  // belong in a twelve-month window that closes on 2027-01-01. Listing it
  // there would have someone filing a month early.
  const ma = { state: 'MA', frequency: 'annual', due_day: 'last', first_period_end: '2026-12-31' };
  assert.deepEqual(schedule(ma, from('2026-01-01'), 12), []);
  assert.equal(schedule(ma, from('2026-01-01'), 14).length, 1);
});

test('nothing is scheduled outside the window asked for', () => {
  const rows = schedule(TX, from('2026-08-02'), 3);
  assert.ok(rows.every((r) => r.due >= '2026-08-02'));
  assert.ok(rows.length <= 4, `expected about three filings, got ${rows.length}`);
});

test('an unrecognised frequency is an error rather than an empty calendar', () => {
  // Silently returning nothing would read as "no filings due".
  assert.throws(
    () => schedule({ state: 'XX', frequency: 'biweekly', due_day: 20 }, from('2026-01-01'), 12),
    /unknown frequency/,
  );
});

test('a due date on Thanksgiving rolls, like any other federal holiday', () => {
  // Thanksgiving 2026 is 26 November. A state whose return is due on the 26th
  // would otherwise be scheduled on a day the payment rails are shut.
  const rows = schedule({ state: 'XX', frequency: 'monthly', due_day: 26 }, from('2026-11-01'), 2);
  const october = rows.find((r) => r.period_end === '2026-10-31');
  assert.equal(october.statutory_due, '2026-11-26');
  assert.equal(october.due, '2026-11-27');
  assert.equal(october.rolled, true);
});

test('every federal holiday the roll depends on is actually known', () => {
  // One missing entry is one filing a year scheduled on a closed day, and it
  // would show up as a late return rather than as a bug in a calendar.
  const monthly = { state: 'XX', frequency: 'monthly', due_day: 1 };
  const rows = schedule(monthly, from('2026-01-01'), 24);
  for (const row of rows) {
    const weekday = new Date(`${row.due}T00:00:00Z`).getUTCDay();
    assert.ok(weekday !== 0 && weekday !== 6, `${row.due} is a weekend`);
  }
});
