/**
 * Choosing a database at runtime.
 *
 * The point of the switch is that the cutover and the rollback are both one
 * `wrangler secret put`, with no build and no deploy. What is worth testing is
 * not that it can select a module — it is the three ways selecting the wrong
 * one could go unnoticed.
 *
 *   An unset binding must mean the database that currently holds the data.
 *   A typo must fail loudly rather than quietly meaning "carry on".
 *   The Supabase path must not still be demanding Base44's credentials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { backendName, dataMisconfiguration, serviceRole, asCaller } from './lib/data.js';

const SUPABASE = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};

// ── Which one, and what happens when nobody said ────────────────────────────

test('unset means Base44, because that is where the data still is', () => {
  // The failure being designed against: an unset variable is silent, and an app
  // pointed at an empty database reads as "no bookings" rather than as "wrong
  // database".
  assert.equal(backendName({}), 'base44');
  assert.equal(backendName({ DATA_BACKEND: '' }), 'base44');
  assert.equal(backendName(undefined), 'base44');
});

test('a value is read case- and whitespace-insensitively', () => {
  // Both of these come from pasting into `wrangler secret put`.
  assert.equal(backendName({ DATA_BACKEND: 'Supabase' }), 'supabase');
  assert.equal(backendName({ DATA_BACKEND: ' supabase\n' }), 'supabase');
});

test('a typo throws instead of quietly meaning "keep the old database"', () => {
  // During the ten minutes somebody is watching to see whether the cutover
  // worked, a silent fallback is the worst possible behaviour: everything looks
  // fine and nothing has changed.
  assert.throws(() => backendName({ DATA_BACKEND: 'supabse' }), /expected "base44" or "supabase"/);
  assert.throws(() => backendName({ DATA_BACKEND: 'postgres' }), /Refusing to guess/);
});

test('the message names the value that was actually supplied', () => {
  // Otherwise the operator reads "expected base44 or supabase", looks at their
  // secret, sees something that looks right, and loses ten minutes to a
  // trailing character.
  assert.throws(() => backendName({ DATA_BACKEND: 'supabse' }), /"supabse"/);
});

// ── Each backend is asked for its own credentials, and only its own ─────────

test('Base44 mode wants a Base44 app id', () => {
  assert.match(dataMisconfiguration({}), /BASE44_APP_ID/);
  assert.equal(dataMisconfiguration({ BASE44_APP_ID: 'abc' }), null);
});

test('Supabase mode does not want a Base44 app id', () => {
  // The bug this replaces: functions.js refused every request without
  // BASE44_APP_ID, which after the cutover would take down a correctly
  // configured deployment for a credential it has no use for.
  assert.equal(dataMisconfiguration(SUPABASE), null);
});

test('Supabase mode says which Supabase binding is missing, not just "misconfigured"', () => {
  assert.match(dataMisconfiguration({ DATA_BACKEND: 'supabase' }), /SUPABASE_URL/);
  assert.match(
    dataMisconfiguration({ DATA_BACKEND: 'supabase', SUPABASE_URL: 'https://p.supabase.co' }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

// ── The switch actually switches ────────────────────────────────────────────

test('the same call reaches a different database depending on one binding', async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(new URL(url).hostname);
    return new Response('[]', { status: 200 });
  };
  try {
    await serviceRole({ BASE44_APP_ID: 'abc', BASE44_MASTER_KEY: 'm' }).entity('Session').filter({ id: 's1' });
    await serviceRole(SUPABASE).entity('Session').filter({ id: 's1' });
  } finally {
    globalThis.fetch = original;
  }

  assert.match(seen[0], /base44/);
  assert.match(seen[1], /supabase/);
});

test('a rollback is the same call with the binding put back', async () => {
  // The whole promise of the file: no build, no deploy, no git, available to
  // somebody who is panicking.
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(new URL(url).hostname);
    return new Response('[]', { status: 200 });
  };
  try {
    const env = { ...SUPABASE, BASE44_APP_ID: 'abc', BASE44_MASTER_KEY: 'm' };
    await serviceRole(env).entity('Session').filter({ id: 's1' });
    await serviceRole({ ...env, DATA_BACKEND: 'base44' }).entity('Session').filter({ id: 's1' });
  } finally {
    globalThis.fetch = original;
  }

  assert.match(seen[0], /supabase/);
  assert.match(seen[1], /base44/);
});

test('asCaller under Supabase sends the anon key, never the service role key', async () => {
  // The bug this codebase already had once. A caller-scoped request carrying
  // the service key means that if Authorization were ever dropped, the request
  // would execute with full database access instead of failing.
  let headers = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    headers = init.headers;
    return new Response('[]', { status: 200 });
  };
  try {
    const request = new Request('https://billtap.app/x', { headers: { authorization: 'Bearer user-jwt' } });
    await asCaller(SUPABASE, request).entity('Session').filter({ id: 's1' });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(headers.apikey, 'anon');
  assert.ok(!JSON.stringify(headers).includes('service'), 'the service role key must not travel on a caller request');
});
