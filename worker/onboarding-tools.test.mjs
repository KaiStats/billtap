/**
 * The setup-call tools: "Send test alert" and the lead acknowledgement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';
import { onRequestPost as leadPost } from './routes/restaurant-lead.js';

const ENV = {
  ENVIRONMENT: 'production',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  POSTMARK_SERVER_TOKEN: 'pm',
};

function stub({ user = 'user_1', restaurant = {}, postmarkStatus = 200 } = {}) {
  const original = globalThis.fetch;
  const mail = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname.includes('postmarkapp.com')) {
      mail.push(JSON.parse(init.body));
      return new Response('{}', { status: postmarkStatus });
    }
    if (u.pathname.includes('/auth/v1/user')) {
      return user ? new Response(JSON.stringify({ id: user })) : new Response('{}', { status: 401 });
    }
    if (u.pathname.endsWith('/restaurants')) {
      return new Response(JSON.stringify([{ id: 'r1', owner_id: 'user_1', name: 'Test Kitchen', ...restaurant }]));
    }
    return new Response(JSON.stringify([{ id: 'x' }]));
  };
  return { mail, restore: () => { globalThis.fetch = original; } };
}

const req = (path = '/api/fn/sendTestAlert', body) => new Request(`https://billtap.app${path}`, {
  method: 'POST',
  headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('a test alert goes only to the alert email on the owner\'s own row', async () => {
  const s = stub({ restaurant: { alert_email: 'gm@kitchen.co' } });
  try {
    const res = await HANDLERS.sendTestAlert({ env: ENV, request: req(), body: { to: 'attacker@evil.co' } });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.email.to, 'gm@kitchen.co');
    assert.deepEqual(s.mail.map((m) => m.To), ['gm@kitchen.co']);
    assert.match(s.mail[0].Subject, /Test alert/);
    assert.equal(data.sms.reason, 'no_alert_phone');
  } finally { s.restore(); }
});

test('a provider refusal comes back as a reason the dashboard can show', async () => {
  const s = stub({ restaurant: { alert_email: 'gm@kitchen.co' }, postmarkStatus: 422 });
  try {
    const data = await (await HANDLERS.sendTestAlert({ env: ENV, request: req() })).json();
    assert.equal(data.ok, false);
    assert.equal(data.email.reason, 'email_send_failed');
  } finally { s.restore(); }
});

test('signed out is refused, and no contacts saved sends nothing', async () => {
  const out = stub({ user: null });
  try {
    assert.equal((await HANDLERS.sendTestAlert({ env: ENV, request: req() })).status, 401);
  } finally { out.restore(); }
  const s = stub({ restaurant: {} });
  try {
    const data = await (await HANDLERS.sendTestAlert({ env: ENV, request: req() })).json();
    assert.equal(data.email.reason, 'no_alert_email');
    assert.equal(s.mail.length, 0);
  } finally { s.restore(); }
});

test('a new lead gets an instant acknowledgement from hello@billtap.app', async () => {
  const s = stub();
  try {
    const res = await leadPost({
      request: req('/api/restaurant-lead', { restaurant_name: 'Taco Spot', email: 'Owner@Taco.co', contact_name: 'Ana' }),
      env: { ...ENV, LEAD_NOTIFY_TO: 'hello@billtap.app' },
    });
    assert.equal(res.status, 200);
    const ack = s.mail.find((m) => m.To === 'owner@taco.co');
    assert.ok(ack, 'the prospect was not acknowledged');
    assert.match(ack.From, /hello@billtap\.app/);
    assert.equal(ack.ReplyTo, 'hello@billtap.app');
    assert.ok(s.mail.some((m) => m.To === 'hello@billtap.app'), 'the operator still hears about the lead');
  } finally { s.restore(); }
});
