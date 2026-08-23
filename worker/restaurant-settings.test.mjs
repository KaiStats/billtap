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

import {
  HANDLERS, restaurantPatch, slugify, isGoogleReviewUrl,
  ratingThreshold, DEFAULT_RATING_THRESHOLD,
} from './routes/functions.js';
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

  /**
   * An unrecognised operator throws rather than being skipped.
   *
   * The version of this that ignored anything it did not understand answered a
   * query it could not parse with every row in the table — so a test could pass
   * while the filter it was exercising did nothing at all. A stub that quietly
   * widens a query is worse than no stub, and this is the one place a widened
   * query would look like a working adoption.
   */
  const matches = (row, params) => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const raw = String(value);
      const [op, ...rest] = raw.split('.');
      const operand = rest.join('.');
      if (op === 'eq') {
        if (String(row[key]) !== operand) return false;
      } else if (op === 'is') {
        const isNull = row[key] === null || row[key] === undefined;
        if (operand === 'null' ? !isNull : isNull) return false;
      } else {
        throw new Error(`stub does not implement PostgREST operator "${op}" (${key}=${raw})`);
      }
    }
    return true;
  };

  const sorted = (rows, spec) => {
    if (!spec) return rows;
    const [column, direction] = String(spec).split('.');
    const sign = direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = a[column] ?? '';
      const y = b[column] ?? '';
      if (x === y) return 0;
      return x < y ? -sign : sign;
    });
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

    let out = sorted(rows.filter((row) => matches(row, u.searchParams)), u.searchParams.get('order'));
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
const TEST_KITCHEN = () => ({
  id: 'r_test_kitchen',
  name: 'Test Kitchen',
  slug: 'test-kitchen',
  owner_id: OWNER,
  alert_email: 'gm@test-kitchen.example',
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
  const victim = { ...TEST_KITCHEN(), id: 'r_victim', slug: 'victim', owner_id: OTHER };
  await withStub({ restaurants: [victim] }, async ({ tables }) => {
    const { res, json } = await save({
      id: 'r_victim',
      restaurant_id: 'r_victim',
      name: 'Taken Over',
      google_review_url: 'https://g.page/r/attacker/review',
    });

    assert.equal(res.status, 200);
    const untouched = tables.restaurants.find((r) => r.id === 'r_victim');
    assert.equal(untouched.name, 'Test Kitchen');
    assert.equal(untouched.google_review_url, null, "another owner's review link cannot be repointed");
    assert.equal(json.restaurant.id, 'r_1', 'the caller got their own new row');
    assert.equal(tables.restaurants.find((r) => r.id === 'r_1').owner_id, OWNER);
  });
});

// ── Rows made by hand, waiting for their operator ───────────────────────────
//
// A restaurant typed into the SQL editor has no owner_id, and migration 0003
// cannot give it one: that trigger matches only rows carrying a
// legacy_owner_id, and it fires only on INSERT into auth.users, so it does
// nothing for a hand-made row and nothing for an operator who already has an
// account. Test Kitchen is both.
//
// The failure that produces is silent and expensive: the operator is shown the
// create form, makes a second restaurant on a suffixed slug, and every table
// tent already printed goes on pointing at the row he no longer owns.

/** TEST_KITCHEN before anyone has signed in for it — the hand-made shape. */
const UNCLAIMED = () => ({
  ...TEST_KITCHEN(),
  owner_id: null,
  legacy_owner_id: null,
  alert_email: 'owner@example.com',
});

test('an unclaimed row is adopted, not duplicated, on the first save', async () => {
  await withStub({ restaurants: [UNCLAIMED()] }, async ({ tables }) => {
    const { res, json, audited } = await save({ name: 'Test Kitchen' });

    assert.equal(res.status, 200);
    assert.equal(tables.restaurants.length, 1, 'a second restaurant is the whole bug');
    assert.equal(tables.restaurants[0].owner_id, OWNER);
    assert.equal(json.restaurant.slug, 'test-kitchen', 'and the printed table tents still resolve');

    assert.equal(audited[0].action, ACTIONS.RESTAURANT_CLAIMED);
    assert.equal(audited[0].actorUserId, OWNER);
    assert.deepEqual(safeDetail(audited[0].detail), { slug: 'test-kitchen' });
  });
});

test('the dashboard read adopts too, so the create form is never offered', async () => {
  // The read is where an operator actually meets this. Adopting only on save
  // would still show them a create form first, which is the screen that talks
  // them into the duplicate.
  await withStub({ restaurants: [UNCLAIMED()] }, async ({ tables }) => {
    const res = await HANDLERS.getRestaurantDashboardData({
      env: ENV,
      request: request(),
      audit: async () => {},
    });
    const out = await res.json();

    assert.equal(out.restaurant.slug, 'test-kitchen');
    assert.equal(tables.restaurants[0].owner_id, OWNER);
  });
});

test('a restaurant that already has an owner is never adopted', async () => {
  // Same alert_email, different owner. The gate is owner_id being null, and
  // every row this endpoint creates sets it — so a live restaurant cannot be
  // taken from its operator by signing in with an address it happens to alert.
  const theirs = { ...TEST_KITCHEN(), owner_id: OTHER, alert_email: 'owner@example.com' };
  await withStub({ restaurants: [theirs] }, async ({ tables }) => {
    const { json } = await save({ name: 'Mine Now' });

    assert.equal(tables.restaurants.find((r) => r.id === 'r_test_kitchen').owner_id, OTHER);
    assert.equal(json.restaurant.id, 'r_1', 'the caller got a new row of their own instead');
    assert.equal(tables.restaurants.length, 2);
  });
});

test('an unclaimed row alerting a different address is not adopted', async () => {
  const someone_else = { ...UNCLAIMED(), alert_email: 'gm@somewhere-else.example' };
  await withStub({ restaurants: [someone_else] }, async ({ tables }) => {
    const { json, audited } = await save({ name: 'Harrys' });

    assert.equal(tables.restaurants.find((r) => r.id === 'r_test_kitchen').owner_id, null);
    assert.equal(json.restaurant.slug, 'harrys');
    assert.equal(audited[0].action, ACTIONS.RESTAURANT_CREATED, 'nothing was claimed');
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
    assert.equal(row.rating_threshold, 3, 'the default the whole product agrees on');

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
  assert.equal(slugify('Test Kitchen'), 'test-kitchen');
  assert.equal(slugify('Fish & Chips'), 'fish-chips');
  assert.equal(slugify('Café Rouge'), 'cafe-rouge');
  assert.equal(slugify('  --Joe--  '), 'joe');
});

test('a slug already in use gets a suffix rather than a collision', async () => {
  // Two restaurants sharing a slug means one of them has table tents pointing
  // at the other's listing.
  const taken = { ...TEST_KITCHEN(), id: 'r_taken', slug: 'test-kitchen', owner_id: OTHER };
  await withStub({ restaurants: [taken] }, async ({ tables }) => {
    const { json } = await save({ name: 'Test Kitchen' });
    assert.equal(json.restaurant.slug, 'test-kitchen-2');
    assert.equal(tables.restaurants.filter((r) => r.slug === 'test-kitchen').length, 1);
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
  await withStub({ restaurants: [TEST_KITCHEN()] }, async ({ tables }) => {
    const { json } = await save({ name: 'Test Kitchen Cantina' });
    assert.equal(json.restaurant.name, 'Test Kitchen Cantina');
    assert.equal(json.restaurant.slug, 'test-kitchen');
    assert.equal(tables.restaurants[0].slug, 'test-kitchen');
    assert.equal(tables.restaurants.length, 1, 'a rename patches, it does not create a second row');
  });
});

test('the server-owned fields are ignored when sent, not refused', async () => {
  // Refusing would break a browser that echoes back the row it was given. The
  // guarantee is that none of them land.
  await withStub({ restaurants: [TEST_KITCHEN()] }, async ({ tables }) => {
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
    assert.equal(row.slug, 'test-kitchen');
    assert.equal(row.owner_id, OWNER);
    assert.equal(row.trial_ends_at, 1735689600000);
    assert.equal(row.stripe_customer_id, 'cus_live_123');
    assert.equal(row.stripe_subscription_id, 'sub_live_123');
  });
});

test('a threshold outside one to four is refused, and four is stored', async () => {
  await withStub({ restaurants: [TEST_KITCHEN()] }, async ({ tables }) => {
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

    // The ones a host-only allow-list let through. Each of these is on a
    // Google domain and goes wherever the person who typed it chose, which is
    // the entire thing this function claims to prevent.
    'https://www.google.com/url?q=https://evil.example/steal',
    'https://google.com/url?q=https://evil.example',
    'https://www.google.com/amp/s/evil.example',
    'https://goo.gl/AbCdEf',
    'https://www.google.com/search?q=anything',
    // google.zip and google.top are three letters, which the old TLD pattern
    // took for a country code.
    'https://google.zip/maps/place/x',
    'https://google.top/maps',
    // The admin console is not a place to send a guest.
    'https://business.google.com/reviews',
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

  await withStub({ restaurants: [TEST_KITCHEN()] }, async ({ tables }) => {
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
  const withUrl = { ...TEST_KITCHEN(), google_review_url: 'https://g.page/r/old/review' };
  await withStub({ restaurants: [withUrl] }, async ({ tables }) => {
    const { res } = await save({ google_review_url: '   ' });
    assert.equal(res.status, 200);
    assert.equal(tables.restaurants[0].google_review_url, null);
  });
});

// ── The read half ───────────────────────────────────────────────────────────

test('the dashboard read returns the row the settings form populates from', async () => {
  await withStub({ restaurants: [TEST_KITCHEN()] }, async () => {
    const res = await HANDLERS.getRestaurantDashboardData({
      env: ENV,
      request: request(),
      audit: async () => {},
    });
    const out = await res.json();

    assert.equal(out.restaurant.name, 'Test Kitchen');
    assert.equal(out.restaurant.slug, 'test-kitchen');
    assert.equal(out.restaurant.alert_email, 'gm@test-kitchen.example');
    assert.equal(out.restaurant.rating_threshold, 3);
    assert.equal(out.restaurant_id, 'r_test_kitchen', 'and the old field is still there');

    // Allow-list, not a spread.
    assert.deepEqual(Object.keys(out.restaurant).sort(), [
      'alert_email', 'alert_phone', 'current_period_end',
      'google_baseline_at', 'google_rating', 'google_rating_start',
      'google_review_count', 'google_review_count_start', 'google_review_url', 'google_reviews_at',
      'id', 'name', 'plan', 'rating_threshold', 'reference_account', 'slug', 'trial_ends_at',
    ]);
  });
});

// ── The threshold, read the same way everywhere ─────────────────────────────

test('one reading of rating_threshold, so the call sites cannot disagree', async () => {
  // The column is `numeric`. ownerView coerced it and the guest-facing read
  // tested Number.isFinite on the raw value — false for the string "3" — so the
  // same row could be a three on the settings screen and a four to the code
  // deciding who gets paged. An operator who never hears about a complaint the
  // app showed the guest making is that gap.
  assert.equal(ratingThreshold('3'), 3, 'a numeric handed back as a string is still a three');
  assert.equal(ratingThreshold(3), 3);
  assert.equal(ratingThreshold('4.0'), 4);

  // Absent is the default.
  for (const empty of [null, undefined, '']) {
    assert.equal(ratingThreshold(empty), DEFAULT_RATING_THRESHOLD);
  }

  // Unparseable is the default too, never NaN: `stars <= NaN` is false for
  // every rating, which pages nobody about anything and looks like a quiet
  // night.
  //
  // The two that matter most are `[]` and `' '`, because `Number()` makes both
  // of them 0 rather than NaN — and zero is the worst value this can hold. The
  // alert fires on `stars <= threshold`, so a zero means a one-star guest walks
  // out with the manager never hearing about it. Coercing without checking the
  // type first is how a threshold ends up there.
  for (const junk of ['four', {}, [], ' ', true, NaN, Infinity, () => 3]) {
    assert.equal(ratingThreshold(junk), DEFAULT_RATING_THRESHOLD, `${String(junk)}`);
  }
});

test('the guest-facing read sends the same number the operator set', async () => {
  // getPublicRestaurant feeds RatingCapture, which decides from it whether to
  // ask what went wrong and page the manager. It is the second reading of the
  // column and the one a guest actually meets.
  const stringy = { ...TEST_KITCHEN(), owner_id: OTHER, rating_threshold: '3' };
  await withStub({ restaurants: [stringy] }, async () => {
    const res = await HANDLERS.getPublicRestaurant({
      env: ENV,
      request: request(false),
      body: { slug: 'test-kitchen' },
      audit: async () => {},
    });
    const out = await res.json();
    assert.equal(out.restaurant.rating_threshold, 3);
  });
});

// ── The slug for a name that has no ascii in it ─────────────────────────────

test('a name that slugifies to nothing does not take the bare /r/restaurant', async () => {
  // 北京烤鸭 reduces to an empty string. The old fallback handed the first such
  // operator `restaurant` — a slug that reads like a placeholder nobody filled
  // in, claimed first-come — and the next one `restaurant-2`.
  assert.equal(slugify('北京烤鸭'), '');
  await withStub({}, async ({ tables }) => {
    const { json } = await save({ name: '北京烤鸭' });
    assert.match(json.restaurant.slug, /^restaurant-[0-9a-f]{6}$/);
    assert.notEqual(json.restaurant.slug, 'restaurant');
    assert.equal(tables.restaurants[0].name, '北京烤鸭', 'the name itself is untouched');
  });
});

test('an empty slug base never produces a leading hyphen', async () => {
  // The numbered branch is `${base.slice(0, 37)}-${n}`, which for an empty base
  // is `-2`. A slug starting with a hyphen is a URL nobody would type twice.
  await withStub({}, async () => {
    const { json } = await save({ name: '!!!' });
    assert.ok(!json.restaurant.slug.startsWith('-'), json.restaurant.slug);
    assert.match(json.restaurant.slug, /^restaurant-[0-9a-f]{6}$/);
  });
});

// ── The way back to the dashboard ───────────────────────────────────────────
//
// /restaurant-dashboard was reachable only by typing the URL: BottomNav hides
// itself on that path, nothing links to it, and the only thing that ever sent
// anyone was Stripe's success_url, once, on the day they paid.

test('an operator gets the two fields a link needs, and nothing else', async () => {
  await withStub({ restaurants: [TEST_KITCHEN()] }, async () => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(), audit: async () => {},
    });
    const out = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(out.restaurant, { slug: 'test-kitchen', name: 'Test Kitchen' });
    // Emphatically not the row. This is asked to decide whether to draw a link,
    // on a screen that displays none of it.
    assert.deepEqual(Object.keys(out.restaurant).sort(), ['name', 'slug']);
  });
});

test('a signed-in diner with no restaurant gets null, not an error', async () => {
  await withStub({}, async () => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(), audit: async () => {},
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).restaurant, null);
  });
});

test('an anonymous caller gets null rather than a 401', async () => {
  // Otherwise every signed-out diner opening this screen logs an auth failure.
  await withStub({ user: null }, async () => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(false), audit: async () => {},
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).restaurant, null);
  });
});

test('the summary never writes a guests.exported row', async () => {
  // The reason this is not getRestaurantDashboardData. That endpoint audits
  // every call as a guest-list export — correct there, and on a profile page
  // load it would bury the real exports under navigation noise, destroying the
  // only signal "did anyone export our guest list" has.
  const audited = [];
  await withStub({ restaurants: [TEST_KITCHEN()] }, async () => {
    await HANDLERS.getMyRestaurantSummary({
      env: ENV,
      request: request(),
      audit: async (entry) => { audited.push(entry); },
    });
  });
  assert.deepEqual(audited.filter((a) => a.action === ACTIONS.GUESTS_EXPORTED), []);
});

test('the summary adopts, so the link reaches the operator who cannot find the screen', async () => {
  // The unclaimed row is exactly the case with no other way in: no owner_id, so
  // no link, so no visit to the dashboard whose read would have claimed it.
  await withStub({ restaurants: [UNCLAIMED()] }, async ({ tables }) => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(), audit: async () => {},
    });
    assert.equal((await res.json()).restaurant.slug, 'test-kitchen');
    assert.equal(tables.restaurants[0].owner_id, OWNER);
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

// ── The review lift ─────────────────────────────────────────────────────────
//
// The number a GM decides renewal on: "my reviews were 89 when I signed up,
// what are they now". The baseline is what makes that answerable, so what
// these mostly pin is that nothing can move it after it is set.

test('the first Google reading becomes the baseline', async () => {
  await withStub({ restaurants: [TEST_KITCHEN()] }, async ({ tables }) => {
    const { res } = await save({ google_review_count: 89, google_rating: 4.1 });
    assert.equal(res.status, 200);

    const row = tables.restaurants[0];
    assert.equal(row.google_review_count, 89);
    assert.equal(row.google_review_count_start, 89, 'the starting point is captured from the first reading');
    assert.equal(row.google_rating_start, 4.1);
    assert.ok(row.google_baseline_at, 'and dated');
    assert.ok(row.google_reviews_at, 'as is the reading itself');
  });
});

test('a later reading moves the current figure and never the baseline', async () => {
  /**
   * The failure this exists for would not look like a bug.
   *
   * If a second save re-baselined to today's number, the lift would silently
   * reset to zero every time an operator updated their count — so the panel
   * would read "0 new reviews" forever, and it would look like the product
   * not working rather than like a defect.
   */
  const withBaseline = {
    ...TEST_KITCHEN(),
    google_review_count: 89, google_review_count_start: 89,
    google_rating: 4.1, google_rating_start: 4.1,
    google_baseline_at: 1000,
  };
  await withStub({ restaurants: [withBaseline] }, async ({ tables }) => {
    await save({ google_review_count: 134, google_rating: 4.4 });

    const row = tables.restaurants[0];
    assert.equal(row.google_review_count, 134, 'today moves');
    assert.equal(row.google_review_count_start, 89, 'August does not');
    assert.equal(row.google_rating_start, 4.1);
    assert.equal(row.google_baseline_at, 1000, 'and the baseline keeps its own date');
  });
});

test('a caller cannot write the baseline directly', async () => {
  // Otherwise the lift is whatever the client says it is, and the one number
  // this product asks an operator to trust is the one it cannot vouch for.
  const withBaseline = {
    ...TEST_KITCHEN(),
    google_review_count: 134, google_review_count_start: 89, google_rating_start: 4.1,
  };
  await withStub({ restaurants: [withBaseline] }, async ({ tables }) => {
    await save({
      google_review_count: 134,
      google_review_count_start: 0,
      google_rating_start: 0,
      google_baseline_at: 1,
    });

    const row = tables.restaurants[0];
    assert.equal(row.google_review_count_start, 89, 'ignored, not applied');
    assert.equal(row.google_rating_start, 4.1);
  });
});

test('an implausible Google reading is refused rather than stored', async () => {
  // Typed by hand. A rating of 45 would render as a lift no restaurant has had.
  await withStub({ restaurants: [TEST_KITCHEN()] }, async ({ tables }) => {
    for (const body of [
      { google_rating: 45 },
      { google_rating: -1 },
      { google_review_count: -5 },
      { google_review_count: 3.5 },
    ]) {
      const { res } = await save(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(tables.restaurants[0].google_rating, undefined, 'nothing was written');
  });
});
