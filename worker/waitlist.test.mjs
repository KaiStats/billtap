/**
 * The two forms a promotion drives traffic to.
 *
 * Both capture somebody who wants to hear from us, and until this layer both
 * could lose that person silently:
 *
 *  - The landing page's waitlist wrote through the Base44 SDK, and had been
 *    reporting an error to every visitor since the SDK was removed. The home
 *    page's consumer call to action did not work at all.
 *  - /api/restaurant-lead sent an email and stored nothing, so a mail outage
 *    turned a restaurant that filled in the form into no record anywhere. Its
 *    own header said as much: "this is the lead in its entirety".
 *
 * restaurant_leads and waitlist have existed since migration 0001 and neither
 * had ever been written to. These assert the ordering that fixes it — store
 * first, notify second, and only call it a failure when both fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as waitlist } from './routes/waitlist.js';
import { onRequestPost as restaurantLead } from './routes/restaurant-lead.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  ENVIRONMENT: 'production',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  POSTMARK_SERVER_TOKEN: 'pm-token',
  LEAD_NOTIFY_TO: 'alerts@billtap.app',
  LEAD_NOTIFY_FROM: 'noreply@billtap.app',
};

const req = (body) =>
  new Request('https://billtap.app/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * Intercepts both outbound calls the routes make and records them separately,
 * so a test can fail one without touching the other. `rows` is what reached
 * PostgREST; `mail` is what reached the provider.
 */
function stub({ dbFails = false, mailFails = false } = {}) {
  const rows = [];
  const mail = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('stub.supabase.co')) {
      if (dbFails) return new Response('{"message":"nope"}', { status: 500 });
      const sent = init.body ? JSON.parse(init.body) : null;
      rows.push({ href, sent });
      return new Response(JSON.stringify([Array.isArray(sent) ? sent[0] : sent]), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes('postmarkapp.com') || href.includes('resend.com')) {
      if (mailFails) return new Response('{"Message":"sender not verified"}', { status: 422 });
      mail.push({ href, body: init.body });
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch to ${href}`);
  };
  return { rows, mail, restore: () => { globalThis.fetch = original; } };
}

// ── The waitlist, which had no endpoint at all ──────────────────────────────

test('a sign-up is stored and announced', async () => {
  const s = stub();
  try {
    const res = await waitlist({ request: req({ email: 'Diner@Example.com', source: 'landing' }), env: ENV });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.stored, true, 'the row is the capture; without it there is nothing to promote to');

    assert.equal(s.rows.length, 1);
    assert.match(s.rows[0].href, /\/rest\/v1\/waitlist/);
    // Lower-cased on the way in, so the same person signing up twice is
    // recognisable later rather than being two subscribers.
    assert.equal(s.rows[0].sent.email, 'diner@example.com');
    assert.equal(s.rows[0].sent.source, 'landing');
    assert.equal(s.mail.length, 1);
  } finally { s.restore(); }
});

test('the row is written before the email is sent', async () => {
  // The ordering is the entire point of the route. If the send goes first, a
  // provider outage takes the address with it.
  const order = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    order.push(href.includes('stub.supabase.co') ? 'row' : 'mail');
    return new Response('[{}]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await waitlist({ request: req({ email: 'a@b.co' }), env: ENV });
    assert.deepEqual(order, ['row', 'mail']);
  } finally { globalThis.fetch = original; }
});

test('a mail outage does not lose the address', async () => {
  const s = stub({ mailFails: true });
  try {
    const res = await waitlist({ request: req({ email: 'a@b.co' }), env: ENV });
    assert.equal(res.status, 200, 'the row landed, so the visitor is genuinely on the list');
    assert.equal((await res.json()).stored, true);
    assert.equal(s.rows.length, 1);
  } finally { s.restore(); }
});

test('a database outage still lets the alert through', async () => {
  const s = stub({ dbFails: true });
  try {
    const res = await waitlist({ request: req({ email: 'a@b.co' }), env: ENV });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stored, false, 'and says so, rather than claiming a row it does not have');
    assert.equal(s.mail.length, 1);
  } finally { s.restore(); }
});

test('losing both is the only failure the visitor is told about', async () => {
  const s = stub({ dbFails: true, mailFails: true });
  try {
    const res = await waitlist({ request: req({ email: 'a@b.co' }), env: ENV });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    // The reason is a fixed identifier from lib/email.js. A provider's own
    // rejection can name a sender domain.
    assert.doesNotMatch(JSON.stringify(body), /sender not verified/);
  } finally { s.restore(); }
});

test('a malformed address is refused before anything is written', async () => {
  const s = stub();
  try {
    const res = await waitlist({ request: req({ email: 'not-an-email' }), env: ENV });
    assert.equal(res.status, 400);
    assert.equal(s.rows.length, 0);
    assert.equal(s.mail.length, 0);
  } finally { s.restore(); }
});

test('the honeypot is accepted and discarded, not rejected', async () => {
  // A 400 would tell a bot which field to leave blank next time.
  const s = stub();
  try {
    const res = await waitlist({
      request: req({ email: 'a@b.co', company_website: 'http://spam.example' }), env: ENV,
    });
    assert.equal(res.status, 200);
    assert.equal(s.rows.length, 0, 'nothing stored');
    assert.equal(s.mail.length, 0, 'and nothing sent');
  } finally { s.restore(); }
});

test('an oversized body is refused before it is parsed', async () => {
  const s = stub();
  try {
    const res = await waitlist({
      request: new Request('https://billtap.app/api/waitlist', {
        method: 'POST', body: 'x'.repeat(5000),
      }),
      env: ENV,
    });
    assert.equal(res.status, 413);
  } finally { s.restore(); }
});

test('malformed JSON is a 400, not a crash', async () => {
  const res = await waitlist({
    request: new Request('https://billtap.app/api/waitlist', { method: 'POST', body: '{oops' }),
    env: ENV,
  });
  assert.equal(res.status, 400);
});

test('with no database bound it still captures by email alone', async () => {
  // The state every environment is in before the bindings are set. Degrading to
  // notify-only beats refusing sign-ups.
  const s = stub();
  try {
    const res = await waitlist({
      request: req({ email: 'a@b.co' }),
      env: { ...ENV, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stored, false);
    assert.equal(s.mail.length, 1);
  } finally { s.restore(); }
});

// ── The restaurant lead, which used to be an email and nothing else ─────────

const leadReq = (body) =>
  new Request('https://billtap.app/api/restaurant-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const LEAD = { restaurant_name: "Joe's", contact_name: 'Joe', email: 'joe@example.com', phone: '702', locations: '2' };

test('a lead is stored, not only emailed', async () => {
  const s = stub();
  try {
    const res = await restaurantLead({ request: leadReq(LEAD), env: ENV });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stored, true);
    assert.equal(s.rows.length, 1);
    assert.match(s.rows[0].href, /\/rest\/v1\/restaurant_leads/);
    assert.equal(s.rows[0].sent.restaurant_name, "Joe's");
    assert.equal(s.rows[0].sent.email, 'joe@example.com');
  } finally { s.restore(); }
});

test('a mail outage no longer asks a restaurant to fill the form in again', async () => {
  /**
   * This used to be a 502. That was right while the email was the only record —
   * showing a confirmation for an alert that went nowhere is the failure the
   * 502 was added to fix. With the row stored it inverts: the details are
   * already safe, and "please try again" produces duplicate leads and a worse
   * impression than the outage did.
   */
  const s = stub({ mailFails: true });
  try {
    const res = await restaurantLead({ request: leadReq(LEAD), env: ENV });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stored, true);
    assert.equal(body.notified, false, 'and it is honest about the alert not landing');
  } finally { s.restore(); }
});

test('a lead that could be neither stored nor sent is still a 502', async () => {
  const s = stub({ dbFails: true, mailFails: true });
  try {
    const res = await restaurantLead({ request: leadReq(LEAD), env: ENV });
    assert.equal(res.status, 502);
  } finally { s.restore(); }
});

test('neither route lets an upstream message reach the caller', async () => {
  // Both talk to a mail provider and a database, and both of those name hosts,
  // senders and columns in their errors.
  for (const [route, request] of [[waitlist, req({ email: 'a@b.co' })], [restaurantLead, leadReq(LEAD)]]) {
    const s = stub({ dbFails: true, mailFails: true });
    try {
      const res = await route({ request, env: ENV });
      const text = await res.text();
      assert.doesNotMatch(text, /supabase\.co|postmarkapp|sender not verified|service-key/);
    } finally { s.restore(); }
  }
});
