/**
 * The month-end report email.
 *
 * Two properties worth pinning. The referral line is the only ask in the
 * email, so it must actually be there, in both parts, pointing at a tagged
 * /restaurants URL. And the low-rating wording must not drift back into
 * describing review gating ("privately instead of Google") — every guest is
 * shown the Google button, and this email is the one place an owner reads a
 * summary of what the product did for them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost, REFERRAL_URL, lowRatingLine } from './routes/monthly-report.js';

const ENV = {
  ENVIRONMENT: 'production',
  REPORT_WEBHOOK_SECRET: 'shh',
  POSTMARK_SERVER_TOKEN: 'pm',
  ALERT_FROM_EMAIL: 'alerts@billtap.app',
};

async function send(report) {
  const mail = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('postmarkapp.com')) {
      mail.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const request = new Request('https://billtap.app/api/monthly-report', {
      method: 'POST',
      headers: { 'X-Report-Secret': 'shh', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reports: [report] }),
    });
    const res = await onRequestPost({ request, env: ENV });
    return { body: await res.json(), mail };
  } finally {
    globalThis.fetch = original;
  }
}

const REPORT = {
  to: 'owner@example.com', restaurant_name: 'The Test Kitchen', label: 'September',
  average: 4.6, ratings: 212, routed: 64, caught: 3, new_contacts: 88, list_size: 540,
};

test('the report carries the referral line, in the html and the text', async () => {
  const { body, mail } = await send(REPORT);
  assert.equal(body.sent, 1);
  const [m] = mail;
  assert.ok(m.HtmlBody.includes(REFERRAL_URL), 'the html links the tagged /restaurants URL');
  assert.ok(m.TextBody.includes(REFERRAL_URL), 'the plain-text part carries it too');
  assert.match(m.TextBody, /Know an owner who would want this\?/);
});

test('the referral link is tagged so the lead is filed as a referral', () => {
  const u = new URL(REFERRAL_URL);
  assert.equal(u.pathname, '/restaurants');
  assert.equal(u.searchParams.get('utm_campaign'), 'owner_referral');
});

test('the referral line promises no reward the product does not have', async () => {
  const { mail } = await send(REPORT);
  assert.doesNotMatch(mail[0].TextBody, /30 days|free month|credit|discount|\$\d+ off/i);
});

test('low ratings are described as heard first, never as kept off Google', async () => {
  const { mail } = await send(REPORT);
  for (const part of [mail[0].HtmlBody, mail[0].TextBody]) {
    assert.doesNotMatch(part, /instead of Google|before going public|privately/i);
  }
  assert.match(mail[0].TextBody, /Low ratings you heard first: 3/);
});

test('the low-rating line counts correctly, and says so when there were none', () => {
  assert.equal(lowRatingLine(0), 'No low ratings this month.');
  assert.equal(lowRatingLine(undefined), 'No low ratings this month.');
  assert.match(lowRatingLine(1), /^1 unhappy guest reached you/);
  assert.match(lowRatingLine(4), /^4 unhappy guests reached you/);
});
