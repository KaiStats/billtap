/**
 * A live-database smoke test for the things migrations can break silently.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Migration 0019 pinned billtap_id()'s search_path to `pg_catalog, public` to
 * satisfy a linter. billtap_id() calls gen_random_bytes(), which pgcrypto
 * provides in the `extensions` schema — so the pin made it unresolvable, and
 * every insert relying on the billtap_id() column default (the id on seven
 * tables) failed with 42883 in production. Nothing caught it: the migration
 * tests checked that the grants narrowed and the file was idempotent, but
 * nothing ever asked "does billtap_id() still produce an id?"
 *
 * This does. It exercises the real failure mode — an INSERT that leans on the
 * billtap_id() default — against the actual database, which is the only place a
 * search_path / extension / grant regression shows up. Run it after applying a
 * migration and before trusting the deploy.
 *
 * ── How it is safe to run ───────────────────────────────────────────────────
 *
 * It SKIPS entirely unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in the
 * environment, so `npm run test:unit` on a laptop with no live creds stays green
 * and never touches production by accident. When it does run, it writes one
 * demo restaurant with demo_expires_at in the past — so the retention sweep
 * removes it even if this process dies before its own cleanup — and deletes it
 * itself in a finally.
 *
 * Run against production explicitly:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:db
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL_BASE && KEY);

const rest = (path, init = {}) => fetch(`${String(URL_BASE).replace(/\/+$/, '')}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  },
});

test('billtap_id() default produces an id on a real insert', { skip: LIVE ? false : 'no live DB creds (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)' }, async () => {
  /**
   * The faithful reproduction. A demo restaurant with no id supplied, so the
   * billtap_id() column default has to fire — exactly what createDemoRestaurant
   * does and exactly what broke. A search_path, extension, or grant regression
   * on billtap_id() fails this insert with 42883 or 4xx, not a green run.
   *
   * demo_expires_at is 0 (epoch, long past) so the row is disposable: the
   * retention sweep would remove it on its own, and the finally removes it now.
   */
  const slug = `__smoke_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let createdId = null;
  try {
    const res = await rest('restaurants', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: '__db_smoke__', slug, demo: true, demo_expires_at: 0 }),
    });
    const body = await res.text();
    assert.equal(res.status, 201, `insert relying on the billtap_id() default failed (${res.status}): ${body.slice(0, 300)}`);

    const rows = JSON.parse(body);
    createdId = rows[0]?.id || null;
    assert.ok(createdId, 'the row came back without an id — the default did not fire');
    assert.equal(typeof createdId, 'string');
    assert.ok(createdId.length >= 12, `id looks wrong: "${createdId}"`);
  } finally {
    if (createdId) {
      await rest(`restaurants?id=eq.${encodeURIComponent(createdId)}`, { method: 'DELETE' }).catch(() => {});
    } else {
      // Insert may have half-succeeded on a shape we did not parse; clean by slug too.
      await rest(`restaurants?slug=eq.${encodeURIComponent(slug)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
});

test('the smoke row cleaned itself up', { skip: LIVE ? false : 'no live DB creds' }, async () => {
  // Guards against a leak from the test above: no __db_smoke__ rows should
  // remain. A stray one would mean cleanup is failing and the table is
  // accumulating test rows.
  const res = await rest('restaurants?name=eq.__db_smoke__&select=id');
  const rows = await res.json();
  assert.equal(res.status, 200);
  assert.equal(Array.isArray(rows) ? rows.length : -1, 0, `left ${rows.length} smoke rows behind`);
});
