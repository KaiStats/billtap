/**
 * The month-end report generator: the numbers, the window, who gets one, and
 * the cron that runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { previousMonth, buildReport, scheduled } from './routes/monthly-report.js';

test('previousMonth is the whole calendar month before, including across a year', () => {
  const w = previousMonth(new Date(Date.UTC(2026, 9, 1, 10, 15)));
  assert.equal(w.label, 'September 2026');
  assert.equal(w.start, Date.UTC(2026, 8, 1));
  assert.equal(w.end, Date.UTC(2026, 9, 1));
  assert.equal(previousMonth(new Date(Date.UTC(2027, 0, 1))).label, 'December 2026');
});

test('buildReport counts only the month, uses the restaurant threshold, and adds recovery rows', () => {
  const w = previousMonth(new Date(Date.UTC(2026, 9, 1)));
  const inMonth = Date.UTC(2026, 8, 15);
  const before = Date.UTC(2026, 7, 31);
  const ratings = [
    { stars: 5, created_at: inMonth, routed_to_google: true },
    { stars: 2, created_at: inMonth, issue: 'slow_service', recovery_status: 'recovered' },
    { stars: 1, created_at: inMonth, issue: 'slow_service', recovery_status: 'guest_left' },
    { stars: 1, created_at: before, issue: 'billing', recovery_status: 'recovered' },
  ];
  const contacts = [{ first_seen: inMonth }, { first_seen: before }];
  const r = buildReport({ id: 'r1', name: 'Test', alert_email: 'a@b.co', rating_threshold: 3 }, ratings, contacts, w);
  assert.equal(r.label, 'September 2026');
  assert.equal(r.ratings, 3);
  assert.equal(r.average, 2.7);
  assert.equal(r.routed, 1);
  assert.equal(r.caught, 2);
  assert.equal(r.new_contacts, 1);
  assert.equal(r.list_size, 2);
  assert.equal(r.recovered, 1);
  assert.equal(r.resolved, 2);
  assert.deepEqual(r.top_issues, [{ label: 'Slow service', count: 2 }]);
});

test('a quiet month carries no recovery fields, so the short email is unchanged', () => {
  const w = previousMonth(new Date(Date.UTC(2026, 9, 1)));
  const r = buildReport({ id: 'r1', rating_threshold: 3 }, [{ stars: 5, created_at: Date.UTC(2026, 8, 2) }], [], w);
  assert.equal(r.caught, 0);
  assert.equal('recovered' in r, false);
  assert.equal(r.average, 5);
});

test('outside production the job sends nothing and reads nothing', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('[]'); };
  try {
    const res = await scheduled({ ENVIRONMENT: 'staging' });
    assert.equal(res.skipped, 'environment');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('production: paying restaurants with an alert email get one; demo, unpaid and no-email do not', async () => {
  const original = globalThis.fetch;
  const mail = [];
  const future = new Date(Date.now() + 864e5).toISOString();
  const restaurants = [
    { id: 'paid', name: 'Paid', alert_email: 'owner@paid.co', plan_status: 'active', trial_ends_at: future, rating_threshold: 3 },
    { id: 'demo', name: 'Demo', alert_email: 'x@demo.co', demo: true, trial_ends_at: future },
    { id: 'none', name: 'No email', plan_status: 'active', trial_ends_at: future },
  ];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname.includes('postmarkapp.com')) {
      mail.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    }
    const from = u.pathname.replace('/rest/v1/', '');
    const id = u.searchParams.get('id')?.slice(3);
    if (from === 'restaurants') return new Response(JSON.stringify(id ? restaurants.filter((x) => x.id === id) : restaurants));
    return new Response('[]');
  };
  try {
    const res = await scheduled({
      ENVIRONMENT: 'production', DATA_BACKEND: 'supabase',
      SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k',
      POSTMARK_SERVER_TOKEN: 'pm', ALERT_FROM_EMAIL: 'alerts@billtap.app',
    }, new Date(Date.UTC(2026, 9, 1, 10, 15)));
    assert.deepEqual(mail.map((m) => m.To), ['owner@paid.co']);
    assert.match(mail[0].Subject, /September 2026/);
    assert.equal(res.restaurants, 1);
  } finally { globalThis.fetch = original; }
});

test('the monthly cron the Worker dispatches on is one wrangler actually fires', async () => {
  const { MONTHLY_REPORT_CRON } = await import('./index.js');
  const src = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(src.includes(`"${MONTHLY_REPORT_CRON}"`), `${MONTHLY_REPORT_CRON} is not in wrangler.jsonc triggers.crons`);
});

test('the report names the most affected shift once one repeats', async () => {
  const { recoveryRows } = await import('./routes/monthly-report.js');
  const w = previousMonth(new Date(Date.UTC(2026, 9, 1)));
  const fri = Date.UTC(2026, 8, 19, 2, 30); // Friday 7:30pm Los Angeles
  const r = buildReport({ id: 'r1', rating_threshold: 3 },
    [{ stars: 1, created_at: fri }, { stars: 2, created_at: fri + 1800e3 }], [], w, 'America/Los_Angeles');
  assert.deepEqual(r.worst_period, { label: 'Friday dinner', count: 2 });
  assert.deepEqual(recoveryRows(r).at(-1), ['Most affected: Friday dinner', '2 low ratings']);
});

test('came-back counts this month\'s unhappy guests, checked against any later visit', () => {
  const w = previousMonth(new Date(Date.UTC(2026, 9, 1)));
  const sep = Date.UTC(2026, 8, 10);
  const oct = Date.UTC(2026, 9, 5);
  const r = buildReport({ id: 'r1', rating_threshold: 3 }, [
    { stars: 2, guest_email: 'a@x.co', created_at: sep },
    { stars: 5, guest_email: 'a@x.co', created_at: oct }, // came back next month
    { stars: 1, guest_email: 'z@x.co', created_at: oct }, // unhappy, but not this month's
  ], [{ visits: 2 }], w);
  assert.equal(r.unhappy_tracked, 1);
  assert.equal(r.unhappy_returned, 1);
  assert.equal(r.returning, 1);
});
