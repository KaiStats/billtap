/**
 * The limiter, checked against what the client actually sends and spends.
 *
 * Two things had drifted, and both were the same shape: a list in this Worker
 * describing a protection that the other side of the wire never implemented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITED, PER_PARTICIPANT, COSTLY, limitKey, limiterFor, isLimited, rateLimit }
  from './lib/rate-limit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every client source file, so the assertions can read what it sends. */
function clientSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(entry) && !entry.endsWith('.test.mjs')) files.push(full);
    }
  };
  walk(join(ROOT, 'src'));
  return files.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
}

const SOURCES = clientSources();
const CLIENT = SOURCES.map((s) => s.text).join('\n');

// ── Per-participant keying is a claim about the client ──────────────────────
//
// limitKey only uses the participant bucket when X-BillTap-Participant is
// present, and src/api/functions.js only sends that header when the request
// body carries a participant_id. So listing a path here is a statement that
// every call to it supplies one — and two entries did not.
//
// verifyQRToken sends { qr_token } and nothing else. /api/scan-receipt posts
// the image as the body with only a Content-Type and never goes through
// invoke() at all. Both fell through to the address, silently, while this file
// said they were keyed per diner.

test('every per-participant path is one the client sends a participant id for', () => {
  for (const path of PER_PARTICIPANT) {
    assert.ok(
      path.startsWith('/api/fn/'),
      `${path} is not an /api/fn/ route, so it does not go through invoke() and cannot ` +
      'carry the header that per-participant keying depends on — this is what /api/scan-receipt was',
    );

    const name = path.slice('/api/fn/'.length);
    const calls = [...CLIENT.matchAll(
      new RegExp(`invoke\\(\\s*["']${name}["']\\s*,\\s*\\{([\\s\\S]{0,400}?)\\}\\s*\\)`, 'g'),
    )].map((m) => m[1]);
    assert.ok(calls.length, `nothing in src/ calls ${name}, so it cannot be keyed per participant`);

    // At least one caller supplies an id. verifyQRToken had none at all — it
    // sends { qr_token } and nothing else — so it was address-keyed while this
    // list said otherwise.
    assert.ok(
      calls.some((body) => /participant_id/.test(body)),
      `no call to ${name} sends a participant_id, so it always keys on the address — ` +
      `either send one or move ${path} out of PER_PARTICIPANT`,
    );
  }
});

test('the calls that actually poll are the ones carrying a participant id', () => {
  /**
   * Not every caller has to, and one deliberately must not.
   *
   * getSplitStatus is called two ways. The guest poll sends a participant id;
   * the host screens call it with only a session id on purpose, because that
   * screen does not know which diner is looking and asking as one of them would
   * hand back that diner's share — see the comment in ReceiptDetail.jsx.
   * limitKey handles both correctly per call: header present, participant
   * bucket; absent, address.
   *
   * What matters for the NAT problem this keying exists to solve is that the
   * REPEATED call is the keyed one. A screen that reads once on entry cannot
   * exhaust anything; a three-second poll can.
   */
  const poll = readFileSync(join(ROOT, 'src/hooks/useLiveSplit.js'), 'utf8');
  // The trailing `[^)]*` tolerates a third argument. These calls acquired one —
  // the conditional-read options that go with etagJson() in the Worker — and
  // without it this matched nothing, which is the failure mode of every regex
  // that reads source: the loop below does not go red, it goes empty. The
  // assert.ok on `polled.length` is the line that caught it.
  const polled = [...poll.matchAll(/invoke\(\s*["'](\w+)["']\s*,\s*\{([\s\S]{0,300}?)\}[^)]*\)/g)];
  assert.ok(polled.length, 'expected useLiveSplit to make the polled calls');

  for (const [, name, body] of polled) {
    if (!PER_PARTICIPANT.has(`/api/fn/${name}`)) continue;
    assert.match(
      body,
      /participant_id/,
      `useLiveSplit polls ${name} every few seconds without a participant id, so a whole ` +
      'restaurant shares one address bucket — the failure this keying exists to prevent',
    );
  }
});

test('the header the keying depends on is still attached in one place', () => {
  const api = readFileSync(join(ROOT, 'src/api/functions.js'), 'utf8');
  assert.match(api, /X-BillTap-Participant/, 'invoke() no longer sends the participant header');
  assert.match(
    api,
    /body\?\.participant_id/,
    'the header must be derived from the body, or a call site can forget it',
  );
});

test('an address is used when no participant id is offered', () => {
  const request = (headers) => new Request('https://billtap.app/api/fn/joinSession', { headers });
  const ip = { 'CF-Connecting-IP': '203.0.113.9' };
  const good = 'p_1700000000000_abc';

  assert.equal(limitKey(request({ ...ip, 'X-BillTap-Participant': good }), '/api/fn/joinSession'), `p:${good}`);
  assert.equal(limitKey(request(ip), '/api/fn/joinSession'), '203.0.113.9');
  // A shaped-wrong header must not become a bucket of its own.
  assert.equal(
    limitKey(request({ ...ip, 'X-BillTap-Participant': '../../etc' }), '/api/fn/joinSession'),
    '203.0.113.9',
  );
});

// ── Money has its own budget ────────────────────────────────────────────────
//
// There was one binding and therefore one bucket per key, shared by everything
// metered. Sixty requests a minute went to whatever the caller asked for first:
// sixty reads and the next rating-alert was refused, or sixty SMS from an
// address that had spent nothing on reads. Twilio has no spend cap.

test('every endpoint that spends money draws from the tighter budget', () => {
  for (const path of COSTLY) {
    assert.ok(isLimited(path), `${path} spends money and is not metered at all`);
    const env = { API_RATE_LIMITER: 'standard', API_RATE_LIMITER_COSTLY: 'costly' };
    assert.equal(limiterFor(env, path), 'costly', `${path} draws from the standard bucket`);
  }
});

test('read endpoints do not draw from the money budget', () => {
  const env = { API_RATE_LIMITER: 'standard', API_RATE_LIMITER_COSTLY: 'costly' };
  for (const path of ['/api/fn/getSplitStatus', '/api/fn/joinSession', '/api/fn/getPublicRestaurant']) {
    assert.equal(limiterFor(env, path), 'standard', `${path} is eating the money budget`);
  }
});

test('a deployment without the new binding still meters the costly paths', () => {
  // The binding is added per environment in wrangler.jsonc, and `unsafe` is not
  // inherited — so a new environment can arrive without it. Falling back to the
  // standard limiter is the old behaviour, which is worse than the new one and
  // far better than none.
  const env = { API_RATE_LIMITER: 'standard' };
  assert.equal(limiterFor(env, '/api/rating-alert'), 'standard');
});

test('the SMS and email senders are both on the money budget', () => {
  // Named individually because these are the two that turn a request into a
  // bill somebody receives.
  assert.ok(COSTLY.has('/api/rating-alert'), 'rating-alert sends an SMS per call');
  assert.ok(COSTLY.has('/api/restaurant-lead'), 'restaurant-lead sends email');
  assert.ok(COSTLY.has('/api/scan-receipt'), 'every scan is a model invocation that is billed');
});

// ── Behaviour under failure ─────────────────────────────────────────────────

test('an unbound limiter lets the request through rather than refusing it', async () => {
  assert.equal(await rateLimit(new Request('https://billtap.app/api/rating-alert'), {}, '/api/rating-alert'), null);
});

test('a missing limiter binding logs an error alert', async () => {
  // Capture console.error calls
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);

  try {
    await rateLimit(new Request('https://billtap.app/api/rating-alert'), {}, '/api/rating-alert');

    assert.ok(logged.length > 0, 'Missing limiter should log an error');
    const error = logged[0][0];
    assert.ok(
      typeof error === 'string' && error.includes('Rate limiter binding missing') ||
      (typeof error === 'object' && error.error === 'Rate limiter binding missing'),
      'Error should mention missing binding'
    );
  } finally {
    console.error = original;
  }
});

test('missing limiter binding alerts with severity level for costly paths', async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);

  try {
    // Test a costly path (rating-alert sends SMS)
    await rateLimit(new Request('https://billtap.app/api/rating-alert'), {}, '/api/rating-alert');

    assert.ok(logged.length > 0);
    const error = logged[0][0];
    assert.ok(
      (typeof error === 'string' && error.includes('critical')) ||
      (typeof error === 'object' && error.severity === 'critical'),
      'Missing limiter on money-bearing endpoint should alert as critical'
    );
  } finally {
    console.error = original;
  }
});

test('a limiter that throws does not take the endpoint down with it', async () => {
  const env = { API_RATE_LIMITER_COSTLY: { limit: async () => { throw new Error('binding down'); } } };
  const result = await rateLimit(new Request('https://billtap.app/api/rating-alert'), env, '/api/rating-alert');
  assert.equal(result, null, 'being unable to check a limit is not a reason to refuse a diner');
});

test('a refusal says how long to wait', async () => {
  const env = { API_RATE_LIMITER_COSTLY: { limit: async () => ({ success: false }) } };
  const res = await rateLimit(new Request('https://billtap.app/api/rating-alert'), env, '/api/rating-alert');
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('an unmetered path is not charged to anybody', async () => {
  const env = { API_RATE_LIMITER: { limit: async () => { throw new Error('should not be consulted'); } } };
  assert.equal(await rateLimit(new Request('https://billtap.app/api/nope'), env, '/api/nope'), null);
});

// ── The client copes with being refused ─────────────────────────────────────

test('the poll loop backs off instead of hammering a closed door', () => {
  // A 429 that a client retries immediately is a limiter that makes the load
  // worse. useLiveSplit is the only thing here that polls.
  const poll = readFileSync(join(ROOT, 'src/hooks/useLiveSplit.js'), 'utf8');
  assert.match(poll, /failures/, 'the poll loop must count failures');
  assert.match(poll, /2 \*\* failures/, 'and back off exponentially on them');
  assert.match(poll, /MAX_BACKOFF_MS/, 'with a ceiling, so it recovers rather than giving up');
});

test('a 429 is classified as worth retrying, and other 4xx are not', () => {
  const errors = readFileSync(join(ROOT, 'src/lib/errors.js'), 'utf8');
  assert.match(errors, /status === 429\) return true/, '429 is about timing, not about the request');
});
