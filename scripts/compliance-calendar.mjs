#!/usr/bin/env node
/**
 * Sales tax remittance calendar, generated from actual registrations.
 *
 * ── Why this is not a fifty-state table ─────────────────────────────────────
 *
 * Because a fifty-state table would be fiction. Three things decide when a
 * return is due, and only the third is a property of the state:
 *
 *   1. Whether you are registered there. You file where you hold a permit, not
 *      where you have nexus. Crossing a threshold creates an obligation to
 *      register; it does not create a deadline. The gap between those two is
 *      where penalties accrue, and a calendar that lists deadlines for states
 *      you have never registered in hides exactly that gap.
 *
 *   2. The filing frequency, which is not yours to pick. Each state assigns it
 *      at registration from expected volume and revises it as volume changes.
 *      The same state files monthly for one business and annually for another.
 *
 *   3. The due day, which is a property of the state — most commonly the 20th
 *      of the month following the period, with several states on the last day,
 *      the 15th, the 23rd or the 25th.
 *
 * So this reads compliance/registrations.json, which starts empty, and emits
 * nothing until it is filled in from the registration letters. An empty
 * calendar is the honest output for a business with no registrations.
 *
 * Weekends and federal holidays roll forward to the next business day, which is
 * the common rule. State holidays are not modelled — if a due date lands on one
 * the state observes and you do not, the return is still due.
 *
 * Usage:
 *   node scripts/compliance-calendar.mjs                  # next 12 months
 *   node scripts/compliance-calendar.mjs --months 24
 *   node scripts/compliance-calendar.mjs --ics out.ics    # importable calendar
 *   node scripts/compliance-calendar.mjs --from 2026-01-01
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRATIONS = resolve(HERE, '../compliance/registrations.json');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : fallback;
};

/** Periods per year, and the months a period closes in. */
const FREQUENCIES = {
  monthly: { closes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], label: 'monthly' },
  quarterly: { closes: [3, 6, 9, 12], label: 'quarterly' },
  semiannual: { closes: [6, 12], label: 'semi-annual' },
  annual: { closes: [12], label: 'annual' },
};

// ── Dates ───────────────────────────────────────────────────────────────────

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const iso = (date) => date.toISOString().slice(0, 10);
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Nth weekday of a month, e.g. the third Monday in January. */
function nthWeekday(year, month, weekday, n) {
  const first = utc(year, month, 1).getUTCDay();
  return utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** Last weekday of a month, for Memorial Day. */
function lastWeekday(year, month, weekday) {
  const last = lastDayOf(year, month);
  const day = utc(year, month, last).getUTCDay();
  return utc(year, month, last - ((day - weekday + 7) % 7));
}

/**
 * US federal holidays, which is what the "next business day" rule turns on.
 * A holiday falling at a weekend is observed on the adjacent weekday.
 */
function federalHolidays(year) {
  const fixed = [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]].map(([m, d]) => utc(year, m, d));
  const observed = fixed.map((date) => {
    const day = date.getUTCDay();
    if (day === 0) return new Date(date.getTime() + 86400000);
    if (day === 6) return new Date(date.getTime() - 86400000);
    return date;
  });
  return new Set([
    ...observed,
    nthWeekday(year, 1, 1, 3),    // MLK Day
    nthWeekday(year, 2, 1, 3),    // Presidents' Day
    lastWeekday(year, 5, 1),      // Memorial Day
    nthWeekday(year, 9, 1, 1),    // Labor Day
    nthWeekday(year, 10, 1, 2),   // Columbus Day
    nthWeekday(year, 11, 4, 4),   // Thanksgiving
  ].map(iso));
}

const holidayCache = new Map();
function isBusinessDay(date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const year = date.getUTCFullYear();
  if (!holidayCache.has(year)) holidayCache.set(year, federalHolidays(year));
  return !holidayCache.get(year).has(iso(date));
}

/** Rolls forward off weekends and federal holidays. */
function nextBusinessDay(date) {
  let out = date;
  let guard = 0;
  while (!isBusinessDay(out) && guard++ < 14) out = new Date(out.getTime() + 86400000);
  return out;
}

// ── The schedule ────────────────────────────────────────────────────────────

/**
 * Every filing due between `from` and `months` out, for one registration.
 *
 * A period closing in December is due in January of the following year, which
 * is the off-by-one worth being careful about: the return names the period, the
 * deadline belongs to the next month.
 */
export function schedule(registration, from, months) {
  const freq = FREQUENCIES[registration.frequency];
  if (!freq) throw new Error(`${registration.state}: unknown frequency "${registration.frequency}"`);

  const rows = [];
  const end = new Date(from.getTime());
  end.setUTCMonth(end.getUTCMonth() + months);

  // The window is on DUE DATES, not on periods — "what do I have to file in the
  // next twelve months" is the question a calendar answers.
  //
  // Which means starting the sweep BEFORE `from`. A period that closed last
  // month is due this month: run this on the 1st of September and the August
  // return, due on the 20th, is the most urgent thing you have. Beginning the
  // loop at `from`'s own month skipped it silently, and a filing calendar that
  // omits the imminent filing is worse than no calendar at all.
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 13, 1));
  for (let i = 0; i <= months + 26; i++) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const month = cursor.getUTCMonth() + 1;
    if (!freq.closes.includes(month)) continue;

    const periodEnd = utc(cursor.getUTCFullYear(), month, lastDayOf(cursor.getUTCFullYear(), month));

    // Due in the month AFTER the period closes.
    const dueMonthCursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const dueYear = dueMonthCursor.getUTCFullYear();
    const dueMonth = dueMonthCursor.getUTCMonth() + 1;

    // "last" means the last day of the month, which is not the same number
    // every month and is the other off-by-one worth being careful about.
    const day = registration.due_day === 'last'
      ? lastDayOf(dueYear, dueMonth)
      : Math.min(Number(registration.due_day), lastDayOf(dueYear, dueMonth));

    const statutory = utc(dueYear, dueMonth, day);
    const due = nextBusinessDay(statutory);

    if (due < from || due > end) continue;
    if (registration.first_period_end && iso(periodEnd) < registration.first_period_end) continue;

    rows.push({
      state: registration.state,
      frequency: freq.label,
      period_end: iso(periodEnd),
      statutory_due: iso(statutory),
      due: iso(due),
      rolled: iso(due) !== iso(statutory),
    });
  }
  return rows;
}

// ── Output ──────────────────────────────────────────────────────────────────

function toIcs(rows, name) {
  const stamp = '20260101T000000Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BillTap//Sales Tax//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${name}`,
  ];
  for (const row of rows) {
    const compact = row.due.replace(/-/g, '');
    const next = iso(new Date(utc(...row.due.split('-').map(Number)).getTime() + 86400000)).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:billtap-${row.state}-${row.period_end}@billtap.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${row.state} sales tax return due (${row.frequency})`,
      `DESCRIPTION:Period ending ${row.period_end}.${row.rolled ? ` Statutory date ${row.statutory_due} rolled to the next business day.` : ''}`,
      'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', 'DESCRIPTION:Sales tax return due in a week', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function main() {
  const config = JSON.parse(await readFile(REGISTRATIONS, 'utf8'));
  const registered = config.registered || [];

  const months = Number(flag('months', 12));
  const from = flag('from') ? utc(...String(flag('from')).split('-').map(Number)) : new Date();

  if (!registered.length) {
    console.log('\nCOMPLIANCE CALENDAR\n');
    console.log('  No registrations on file, so there is nothing to file.\n');
    console.log('  This is the honest output, not a gap in the tool. You file where you');
    console.log('  hold a permit — not where you have nexus. Crossing a threshold creates');
    console.log('  an obligation to REGISTER; the deadlines start after that.\n');
    console.log('  Run `node scripts/nexus-report.mjs --stripe` to see which states you');
    console.log('  are approaching, then add each permit to compliance/registrations.json');
    console.log('  with the frequency and due day from the registration letter.\n');
    return;
  }

  const rows = registered.flatMap((r) => schedule(r, from, months)).sort((a, b) => a.due.localeCompare(b.due));

  console.log('\nCOMPLIANCE CALENDAR');
  console.log(`  ${registered.length} registration(s) · ${rows.length} filings in the next ${months} months\n`);
  console.log('  due          state  frequency     period ending');
  console.log('  ──────────   ─────  ───────────   ─────────────');
  for (const row of rows) {
    console.log(
      `  ${row.due}   ${row.state.padEnd(5)}  ${row.frequency.padEnd(11)}   ${row.period_end}` +
      (row.rolled ? `   (statutory ${row.statutory_due}, rolled)` : ''),
    );
  }

  const out = flag('ics');
  if (out) {
    await writeFile(resolve(process.cwd(), out), toIcs(rows, 'BillTap sales tax'), 'utf8');
    console.log(`\n  Wrote ${out} — import it, and each filing reminds you a week ahead.`);
  }

  console.log('\n  Not tax advice. Due days come from your registration letters, not from here.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
