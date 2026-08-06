/**
 * The settings write path: saveMyRestaurant, and the read half beside it.
 *
 * This endpoint is the only way a restaurant gets a google_review_url, and
 * RatingCapture disables the Google handoff without one — so the product a
 * restaurant is paying $149 a month for does not function until this works.
 * It is also the only place an operator sets the address their low-rating
 * alerts go to.
 *
 * Two properties carry most of the weight here and neither is obvious from
 * reading the handler:
 *
 *   **Ownership cannot be addressed.** There is no id parameter. Every
 *   assertion below that sends one is checking that it was ignored, not
 *   rejected — a browser echoing back the row it was given must not fail, and
 *   must not be able to reach anyone else's restaurant either.
 *
 *   **The slug does not follow the name.** `/r/<slug>` is printed on table
 *   tents. A slug that moved on a rename would 404 every card already sitting
 *   on a table, and nobody would find out until a guest gave up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS, restaurantPatch, slugify, isGoogleReviewUrl } from './routes/functions.js';
import { ACTIONS, safeDetail } from './lib/audit.js';

// ── Harness ─────────────────────────────────────────────────────────────────

const OWNER = 'user_owner';
const OTHER = 'user_someone_else';
const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
};

/**
 * An in-memory Supabase, answering the PostgREST shape worker/lib/db.js speaks.
 *
 * `user` is who /auth/v1/user says the bearer belongs to; null means nobody is
 * signed in, which is how a test says "anonymous" without inventing a token.
 */
function stub({ restaurants = [], user = { id: OWNER, email: 'owner@example.com' } } = {}) {
  const original = globalThis.fetch;
  const tables = { restaurants: structuredClone(restaurants), guest_ratings: [], guest_contacts: [] };
  let minted = 0;

  const matches = (row, params) => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      if (String(value).startsWith('eq.') && String(row[key]) !== String(value).slice(3)) return false;
    }
    return true;
  };

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';

    if (u.pathname.includes('/auth/v1/user')) {
      return user
        ? new Response(JSON.stringify(user), { status: 200 })
        : new Response(JSON.stringify({ error: 'bad jwt' }), { status: 401 });
    }

    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = tables[from] || (tables[from] = []);

    if (method === 'POST') {
      minted += 1;
      const row = { id: `r_${minted}`, created_date: '2026-01-01T00:00:00Z', ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (method === 'PATCH') {
      const hit = rows.filter((row) => matches(row, u.searchParams));
      for (const row of hit) Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(hit), { status: 200 });
    }

    let out = rows.filter((row) => matches(row, u.searchParams));
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset')) || 0;
    if (limit) out = out.slice(offset, offset + limit);
    return new Response(JSON.stringify(out), { status: 200 });
  };

  return { tables, restore: () => { globalThis.fetch = original; } };
}

const request = (signedIn = true) =>
  new Request('https://billtap.app/api/fn/saveMyRestaurant', {
    method: 'POST',
    headers: signedIn ? { Authorization: 'Bearer operator-token' } : {},
  });

/** Runs `fn` against a stubbed database and always restores global fetch. */
async function withStub(opts, fn) {
  const s = stub(opts);
  try {
    return await fn(s);
  } finally {
    s.restore();
  }
}

/** Calls the handler, collecting the audit entries it emits. */
async function save(body, { signedIn = true, audited = [] } = {}) {
  const res = await HANDLERS.saveMyRestaurant({
    env: ENV,
    request: request(signedIn),
    body,
    audit: async (entry) => { audited.push(entry); },
  });
  return { res, json: await res.clone().json(), audited };
}

/** An existing restaurant belonging to OWNER. */
const MARIPOSA = () => ({
  id: 'r_mariposa',
  name: 'Mariposa',
  slug: 'mariposa',
  owner_id: OWNER,
  alert_email: 'gm@mariposa.example',
  alert_phone: null,
  google_review_url: null,
  rating_threshold: 3,
  plan: 'active',
  trial_ends_at: 1735689600000,
  stripe_customer_id: 'cus_live_123',
  stripe_subscription_id: 'sub_live_123',
  legacy_owner_id: 'base44_user_9',
});

// ── Who is allowed to write ─────────────────────────────────────────────────

test('an anonymous caller cannot write a restaurant', async () => {
  await withStub({ user: null }, async ({ tables }) => {
    const { res } = await save({ name: 'Ghost Kitchen' }, { signedIn: false });
    assert.equal(res.status, 401);
    assert.equal(tables.restaurants.length, 0, 'and nothing was created on the way to refusing');
  });
});

test('an id in the body reaches nobody — ownership comes from the session', async () => {
  // The whole shape of this endpoint. There is no id parameter, so the worst a
  // caller can do by sending one is have it ignored: OTHER's row is untouched
  // and the write lands on a new row owned by the caller.
  const victim = { ...MARIPOSA(), id: 'r_victim', slug: 'victim', owner_id: OTHER };
  await withStub({ restaurants: [victim] }, async ({ tables }) => {
    const { res, json } = await save({
      id: 'r_victim',
      restaurant_id: 'r_victim',
      name: 'Taken Over',
      google_review_url: 'https://g.page/r/attacker/review',
    });

    assert.equal(res.status, 200);
    const untouched = tables.restaurants.find((r) => r.id === 'r_victim');
    assert.equal(untouched.name, 'Mariposa');
    assert.equal(untouched.google_review_url, null, "another owner's review link cannot be repointed");
    assert.equal(json.restaurant.id, 'r_1', 'the caller got their own new row');
    assert.equal(tables.restaurants.find((r) => r.id === 'r_1').owner_id, OWNER);
  });
});

// ── Create ──────────────────────────────────────────────────────────────────

test('a first save creates the row, on trial, owned by the caller', async () => {
  await withStub({}, async ({ tables }) => {
    const { res, json, audited } = await save({ name: "Harry's Diner", alert_email: 'gm@harrys.example' });

    assert.equal(res.status, 200);
    const row = tables.restaurants[0];
    assert.equal(row.owner_id, OWNER);
    assert.equal(row.plan, 'trial');
    assert.ok(row.trial_ends_at > Date.now(), 'a trial that has already ended is not a trial');
    assert.equal(row.alert_email, 'gm@harrys.example');
    assert.equal(row.rating_threshold, 4, 'the default the whole product agrees on');

    assert.equal(audited[0].action, ACTIONS.RESTAURANT_CREATED);
    assert.equal(audited[0].actorUserId, OWNER);
    // The allow-list in audit.js fails closed, so this is really asserting that
    // `slug` and `fields` were added to it — without that the row is empty and
    // records that something happened without saying what.
    assert.deepEqual(safeDetail(audited[0].detail), { slug: 'harrys-diner', fields: 'name,alert_email' });

    // Not in the response, ever.
    for (const secret of ['owner_id', 'stripe_customer_id', 'stripe_subscription_id', 'legacy_owner_id']) {
      assert.equal(json.restaurant[secret], undefined, `${secret} must not reach the browser`);
    }
  });
});

test("an apostrophe drops out of a slug rather than becoming a hyphen", async () => {
  // This string is printed on a table tent and read aloud down a phone.
  assert.equal(slugify("Harry's"), 'harrys');
  assert.equal(slugify('Mariposa'), 'mariposa');
  assert.equal(slugify('Fish & Chips'), 'fish-chips');
  assert.equal(slugify('Café Rouge'), 'cafe-rouge');
  assert.equal(slugify('  --Joe--  '), 'joe');
});

test('a slug already in use gets a suffix rather than a collision', async () => {
  // Two restaurants sharing a slug means one of them has table tents pointing
  // at the other's listing.
  const taken = { ...MARIPOSA(), id: 'r_taken', slug: 'mariposa', owner_id: OTHER };
  await withStub({ restaurants: [taken] }, async ({ tables }) => {
    const { json } = await save({ name: 'Mariposa' });
    assert.equal(json.restaurant.slug, 'mariposa-2');
    assert.equal(tables.restaurants.filter((r) => r.slug === 'mariposa').length, 1);
  });
});

test('a create with no name is refused, and writes nothing', async () => {
  await withStub({}, async ({ tables }) => {
    const { res } = await save({ alert_email: 'gm@example.com' });
    assert.equal(res.status, 400);
    assert.equal(tables.restaurants.length, 0);
  });
});

test("a create with no alert email falls back to the address they signed in with", async () => {
  // Also what migration 0003 matches a migrated restaurant on, so an empty one
  // costs the claim as well as the alerts.
  await withStub({}, async ({ tables }) => {
    await save({ name: 'Quiet Place' });
    assert.equal(tables.restaurants[0].alert_email, 'owner@example.com');
  });
});

// ── Update ──────────────────────────────────────────────────────────────────

test('renaming a restaurant does not move its slug', async () => {
  // The one that would be discovered by a guest, at a table, holding a card
  // that 404s. Printed table tents encode /r/<slug>.
  await withStub({ restaurants: [MARIPOSA()] }, async ({ tables }) => {
    const { json } = await save({ name: 'Mariposa Cantina' });
    assert.equal(json.restaurant.name, 'Mariposa Cantina');
    assert.equal(json.restaurant.slug, 'mariposa');
    assert.equal(tables.restaurants[0].slug, 'mariposa');
    assert.equal(tables.restaurants.length, 1, 'a rename patches, it does not create a second row');
  });
});

test('the server-owned fields are ignored when sent, not refused', async () => {
  // Refusing would break a browser that echoes back the row it was given. The
  // guarantee is that none of them land.
  await withStub({ restaurants: [MARIPOSA()] }, async ({ tables }) => {
    const { res } = await save({
      alert_phone: '(702) 555-0134',
      slug: 'somewhere-else',
      owner_id: OTHER,
      plan: 'active',
      trial_ends_at: 4102444800000,
      stripe_customer_id: 'cus_attacker',
      stripe_subscription_id: 'sub_attacker',
      current_period_end: 4102444800000,
    });

    assert.equal(res.status, 200);
    const row = tables.restaurants[0];
    assert.equal(row.alert_phone, '(702) 555-0134', 'the field they were allowed to set did land');
    assert.equal(row.slug, 'mariposa');
    assert.equal(row.owner_id, OWNER);
    assert.equal(row.trial_ends_at, 1735689600000);
    assert.equal(row.stripe_customer_id, 'cus_live_123');
    assert.equal(row.stripe_subscription_id, 'sub_live_123');
  });
});

test('a threshold outside one to four is refused, and four is stored', async () => {
  await withStub({ restaurants: [MARIPOSA()] }, async ({ tables }) => {
    for (const bad of [0, 5, -1, 3.5, 'four', {}]) {
      const { res } = await save({ rating_threshold: bad });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(tables.restaurants[0].rating_threshold, 3, 'and none of them landed');

    const { res, json, audited } = await save({ rating_threshold: 4 });
    assert.equal(res.status, 200);
    assert.equal(json.restaurant.rating_threshold, 4);
    assert.equal(audited[0].action, ACTIONS.RESTAURANT_UPDATED);
    // Which columns moved, never what they moved to.
    assert.deepEqual(safeDetail(audited[0].detail), { fields: 'rating_threshold' });
  });
});

// ── The review link ─────────────────────────────────────────────────────────

test('a review link that is not Google over https is refused', async () => {
  // RatingCapture calls window.open on this value from a guest's phone, off a
  // table QR. Unrestricted it is a redirect handed to strangers under the
  // restaurant's name — reachable by an operator, or by anyone who claimed a
  // restaurant through the email trigger in migration 0003.
  const refused = [
    'https://evil.example/review',
    'http://g.page/r/abc/review',
    'javascript:alert(1)',
    'https://google.com.evil.example/review',
    'https://google.com@evil.example/review',
    'https://notgoogle.com/review',
    'https://evil.example/?u=https://g.page/r/abc/review',
    'data:text/html,<script>alert(1)</script>',
  ];
  for (const url of refused) assert.equal(isGoogleReviewUrl(url), false, `${url} must be refused`);

  const allowed = [
    'https://g.page/r/CX0ABCdefGHI/review',
    'https://maps.app.goo.gl/abcdef',
    'https://search.google.com/local/writereview?placeid=Ch123',
    'https://www.google.com/maps/place/?q=place_id:Ch123',
    'https://www.google.co.uk/maps/place/?q=place_id:Ch123',
  ];
  for (const url of allowed) assert.equal(isGoogleReviewUrl(url), true, `${url} must be accepted`);

  await withStub({ restaurants: [MARIPOSA()] }, async ({ tables }) => {
    const { res } = await save({ google_review_url: 'https://evil.example/review' });
    assert.equal(res.status, 400);
    assert.equal(tables.restaurants[0].google_review_url, null, 'nothing was written on the way to refusing');

    const ok = await save({ google_review_url: 'https://g.page/r/CX0ABCdefGHI/review' });
    assert.equal(ok.res.status, 200);
    assert.equal(tables.restaurants[0].google_review_url, 'https://g.page/r/CX0ABCdefGHI/review');
  });
});

test('an empty review link clears it rather than failing validation', async () => {
  // "Take that link down" is a legitimate thing to want: it puts the Google
  // handoff back to disabled instead of pointing it somewhere stale.
  const withUrl = { ...MARIPOSA(), google_review_url: 'https://g.page/r/old/review' };
  await withStub({ restaurants: [withUrl] }, async ({ tables }) => {
    const { res } = await save({ google_review_url: '   ' });
    assert.equal(res.status, 200);
    assert.equal(tables.restaurants[0].google_review_url, null);
  });
});

// ── The read half ───────────────────────────────────────────────────────────

test('the dashboard read returns the row the settings form populates from', async () => {
  await withStub({ restaurants: [MARIPOSA()] }, async () => {
    const res = await HANDLERS.getRestaurantDashboardData({
      env: ENV,
      request: request(),
      audit: async () => {},
    });
    const out = await res.json();

    assert.equal(out.restaurant.name, 'Mariposa');
    assert.equal(out.restaurant.slug, 'mariposa');
    assert.equal(out.restaurant.alert_email, 'gm@mariposa.example');
    assert.equal(out.restaurant.rating_threshold, 3);
    assert.equal(out.restaurant_id, 'r_mariposa', 'and the old field is still there');

    // Allow-list, not a spread.
    assert.deepEqual(Object.keys(out.restaurant).sort(), [
      'alert_email', 'alert_phone', 'current_period_end', 'google_review_url',
      'id', 'name', 'plan', 'rating_threshold', 'slug', 'trial_ends_at',
    ]);
  });
});

// ── The validator, directly ─────────────────────────────────────────────────

test('one validator covers create and update, so the two cannot drift', async () => {
  // A name is the only difference between the two calls: required on create,
  // optional on update. Everything else is checked identically, which is the
  // property worth pinning — two validators drift, and the field that ends up
  // unchecked is whichever was added last.
  assert.ok('error' in restaurantPatch({}, { creating: true }));
  assert.deepEqual(restaurantPatch({}, { creating: false }), { patch: {}, fields: [] });

  for (const creating of [true, false]) {
    const body = { name: 'Somewhere', google_review_url: 'https://evil.example/x' };
    assert.ok('error' in restaurantPatch(body, { creating }), 'a bad review link fails either way');
    assert.ok('error' in restaurantPatch({ ...body, google_review_url: '', alert_email: 'not-an-email' }, { creating }));
    assert.ok('error' in restaurantPatch({ ...body, google_review_url: '', rating_threshold: 9 }, { creating }));
  }

  // `fields` is the audit detail, so it lists what was actually touched.
  const { patch, fields } = restaurantPatch({ alert_phone: '+1 702 555 0134', plan: 'active' }, {});
  assert.deepEqual(fields, ['alert_phone']);
  assert.equal(patch.plan, undefined);
});
