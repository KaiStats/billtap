/**
 * sendEmail's retry and provider-fallback behaviour.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The low-rating alert is fired best-effort from a guest's browser, and for a
 * long time nothing anywhere retried it: the client fired one fetch and never
 * read the answer, and sendEmail made one attempt against one provider. Any
 * transient failure — a Postmark deploy, a timeout, a dropped connection —
 * lost the alert silently. The demo shown to restaurant GMs is exactly that
 * email arriving while they hold the phone, so "sometimes it doesn't arrive"
 * was the product not working at the moment of sale.
 *
 * These tests pin the healing behaviour: a retryable failure is retried, a
 * second configured provider is a fallback rather than dead config, and a
 * permanent rejection is not retried against the same provider (every retry
 * would burn the timeout budget to learn the same thing) but does move on to
 * the next.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sendEmail } from './lib/email.js';

// Production-shaped, so mayContactRealPeople lets the send proceed and the
// suppression path (tested in environment.test.mjs) stays out of the way.
const BASE = {
  ENVIRONMENT: 'production',
  BASE44_APP_ID: 'app1',
  PRODUCTION_APP_ID: 'app1',
};

const MESSAGE = { to: 'owner@example.com', subject: 'x', html: '<p>x</p>', text: 'x' };

/**
 * Fetch stubbed per provider: `plan.postmark` / `plan.resend` are arrays of
 * status codes (or 'throw') consumed one per attempt, so a test scripts the
 * exact sequence of answers each provider gives.
 */
async function withProviders(plan, run) {
  const calls = { postmark: 0, resend: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).includes('postmarkapp.com') ? 'postmark' : 'resend';
    const script = plan[name] || [];
    const step = script[Math.min(calls[name], script.length - 1)] ?? 200;
    calls[name] += 1;
    if (step === 'throw') throw new TypeError('network dropped');
    return new Response('{}', { status: step });
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('a 5xx from the provider is retried, and the retry can succeed', async () => {
  await withProviders({ postmark: [500, 200] }, async (calls) => {
    const out = await sendEmail({ ...BASE, POSTMARK_SERVER_TOKEN: 'pm' }, MESSAGE);
    assert.equal(out.ok, true);
    assert.equal(calls.postmark, 2, 'one failure, one retry');
  });
});

test('a network error is retried like a 5xx', async () => {
  await withProviders({ postmark: ['throw', 200] }, async (calls) => {
    const out = await sendEmail({ ...BASE, POSTMARK_SERVER_TOKEN: 'pm' }, MESSAGE);
    assert.equal(out.ok, true);
    assert.equal(calls.postmark, 2);
  });
});

test('when Postmark stays down, a configured Resend key is a fallback, not dead config', async () => {
  await withProviders({ postmark: [500, 500], resend: [200] }, async (calls) => {
    const out = await sendEmail(
      { ...BASE, POSTMARK_SERVER_TOKEN: 'pm', RESEND_API_KEY: 'rk' },
      MESSAGE,
    );
    assert.equal(out.ok, true);
    assert.equal(calls.postmark, 2, 'both Postmark attempts spent first');
    assert.equal(calls.resend, 1, 'then the fallback delivered');
  });
});

test('a permanent rejection is not retried against the same provider, but the next one is still tried', async () => {
  // 422 is Postmark saying the payload or sender is wrong; asking again with
  // the identical payload cannot change its mind. Resend has its own rules and
  // its own opinion, so it still gets asked.
  await withProviders({ postmark: [422], resend: [200] }, async (calls) => {
    const out = await sendEmail(
      { ...BASE, POSTMARK_SERVER_TOKEN: 'pm', RESEND_API_KEY: 'rk' },
      MESSAGE,
    );
    assert.equal(out.ok, true);
    assert.equal(calls.postmark, 1, 'a 422 answers the same every time');
    assert.equal(calls.resend, 1);
  });
});

test('when every provider fails, the caller hears about it honestly', async () => {
  await withProviders({ postmark: [500, 500], resend: [500, 500] }, async (calls) => {
    const out = await sendEmail(
      { ...BASE, POSTMARK_SERVER_TOKEN: 'pm', RESEND_API_KEY: 'rk' },
      MESSAGE,
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'email_send_failed');
    assert.equal(calls.postmark, 2);
    assert.equal(calls.resend, 2);
  });
});

test('a first-attempt success is exactly one request — retries cost nothing when nothing fails', async () => {
  await withProviders({ postmark: [200] }, async (calls) => {
    const out = await sendEmail({ ...BASE, POSTMARK_SERVER_TOKEN: 'pm' }, MESSAGE);
    assert.equal(out.ok, true);
    assert.equal(calls.postmark, 1);
    assert.equal(calls.resend, 0);
  });
});

test('no provider configured is still a distinct, non-retryable answer', async () => {
  await withProviders({}, async (calls) => {
    const out = await sendEmail({ ...BASE }, MESSAGE);
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'email_not_configured');
    assert.equal(calls.postmark + calls.resend, 0);
  });
});
