/**
 * Demo provisioning: who may stand up a page in a stranger's name, and what
 * that page is allowed to be.
 *
 * Three properties carry the weight here, and none of them is obvious from
 * reading the handler:
 *
 *   **It fails closed.** Every other gate in this app resolves an ambiguity by
 *   serving — shared/entitlement.js argues that at length and is right about
 *   it. This one does not, because the thing on the other side is not a month
 *   of margin, it is a live public page carrying a business's name that nobody
 *   asked us for. An absent allowlist denies everybody, including the person
 *   who wrote it.
 *
 *   **The slug is not the name.** `/r/herb-and-rye` is a URL an owner could
 *   type on a hunch and reasonably read as us having launched something on his
 *   behalf. The demo must not be findable from the name it displays.
 *
 *   **Nothing on the row touches a third party.** No Google link, and the
 *   alert address is the operator's own. A demo that reached a real guest must
 *   not solicit a review on a business's listing or email a business that has
 *   never heard of us.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS, demoName, demoOperators, isDemoOperator } from './routes/functions.js';
import { ACTIONS } from './lib/audit.js';
import { LIMITED, COSTLY, isLimited } from './lib/rate-limit.js';
import { sweepExpiredDemos } from './routes/retention.js';
import { serviceRole } from './lib/db.js';

// ── Harness ─────────────────────────────────────────────────────────────────

const KAI = 'user_kai';
const OPERATOR_EMAIL = 'kai@billtap.app';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  PUBLIC_BASE_URL: 'https://billtap.app',
  DEMO_OPERATOR_EMAILS: `someone@else.example, ${OPERATOR_EMAIL.toUpperCase()}`,
};

/**
 * The same in-memory PostgREST worker/restaurant-settings.test.mjs uses, plus
 * the `lt` operator the demo sweep needs.
 *
 * An unrecognised operator throws rather than being skipped, for the reason
 * that file gives: a stub which widens a query it cannot parse lets a test pass
 * while the filter it is exercising does nothing at all.
 */
function stub({ restaurants = [], user = { id: KAI, email: OPERATOR_EMAIL } } = {}) {
  const original = globalThis.fetch;
  const tables = { restaurants: structuredClone(restaurants), guest_ratings: [], guest_contacts: [] };
  let minted = 0;

  const matches = (row, params) => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const raw = String(value);
      const [op, ...rest] = raw.split('.');
      const operand = rest.join('.');
      if (op === 'eq') {
        if (String(row[key] ?? '') !== operand) return false;
      } else if (op === 'is') {
        const isNull = row[key] === null || row[key] === undefined;
        if (operand === 'null' ? !isNull : isNull) return false;
      } else if (op === 'lt') {
        // Null compares to nothing in Postgres: `null < 5` is null, not true,
        // so the row does not match. `Number(null)` is 0, which would have made
        // this stub answer the opposite of the database and quietly turned a
        // demo with no expiry into one this job deletes.
        if (row[key] === null || row[key] === undefined) return false;
        if (!(Number(row[key]) < Number(operand))) return false;
      } else {
        throw new Error(`stub does not implement PostgREST operator "${op}" (${key}=${raw})`);
      }
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
      const row = { id: `r_${minted}`, created_date: '2026-08-15T00:00:00Z', ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (method === 'PATCH') {
      const hit = rows.filter((row) => matches(row, u.searchParams));
      for (const row of hit) Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    if (method === 'DELETE') {
      const hit = rows.filter((row) => matches(row, u.searchParams));
      tables[from] = rows.filter((row) => !hit.includes(row));
      return new Response(JSON.stringify(hit), { status: 200 });
    }

    let out = rows.filter((row) => matches(row, u.searchParams));
    const limit = Number(u.searchParams.get('limit'));
    if (limit) out = out.slice(0, limit);
    return new Response(JSON.stringify(out), { status: 200 });
  };

  return { tables, restore: () => { globalThis.fetch = original; } };
}

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

const request = (signedIn = true) =>
  new Request('https://billtap.app/api/fn/createDemoRestaurant', {
    method: 'POST',
    headers: signedIn ? { Authorization: 'Bearer operator-token' } : {},
  });

/** Calls the handler, collecting the audit entries it emits. */
async function create(body, { env = ENV, signedIn = true, audited = [] } = {}) {
  const res = await HANDLERS.createDemoRestaurant({
    env,
    request: request(signedIn),
    body,
    audit: async (entry) => { audited.push(entry); },
  });
  return { res, json: await res.clone().json(), audited };
}

// ── Who is allowed to publish a page in somebody else's name ────────────────

test('an unauthenticated request creates nothing', async () => {
  await withStub({ user: null }, async ({ tables }) => {
    const { res } = await create({ name: 'Herb and Rye' }, { signedIn: false });
    assert.equal(res.status, 401);
    assert.equal(tables.restaurants.length, 0, 'and nothing was written on the way to refusing');
  });
});

test('a signed-in user who is not on the allowlist is refused', async () => {
  // Signing up is free and takes a minute. If a session were the whole control,
  // anyone with one could publish a page carrying any business's name.
  const stranger = { id: 'user_stranger', email: 'someone@gmail.example' };
  await withStub({ user: stranger }, async ({ tables }) => {
    const { res } = await create({ name: 'Herb and Rye' });
    assert.equal(res.status, 403);
    assert.equal(tables.restaurants.length, 0);
  });
});

test('an absent DEMO_OPERATOR_EMAILS denies everyone, including Kai', async () => {
  // The one place in this codebase that fails closed, and the assertion that
  // says so out loud. A deploy that forgot the secret costs an evening of
  // demos; the other direction costs somebody else's name.
  for (const value of [undefined, '', '   ', ',,']) {
    const env = { ...ENV, DEMO_OPERATOR_EMAILS: value };
    await withStub({}, async ({ tables }) => {
      const { res } = await create({ name: 'Herb and Rye' }, { env });
      assert.equal(res.status, 403, `DEMO_OPERATOR_EMAILS=${JSON.stringify(value)} must deny`);
      assert.equal(tables.restaurants.length, 0);
    });
  }
});

test('the allowlist is matched case-insensitively and ignores spacing', () => {
  // The value is typed into a secret by hand; the session email is whatever the
  // operator typed at sign-in. Neither side is normalised for the other.
  assert.deepEqual([...demoOperators({ DEMO_OPERATOR_EMAILS: ' A@b.C , d@e.f ' })], ['a@b.c', 'd@e.f']);
  assert.equal(isDemoOperator(ENV, { email: 'KAI@BillTap.App' }), true);
  assert.equal(isDemoOperator(ENV, { email: 'kai@billtap.app.evil.example' }), false);
  assert.equal(isDemoOperator(ENV, {}), false, 'a session with no address is nobody');
});

test('the endpoint is metered, and from the costly budget', () => {
  // The allowlist is the control; this is the bound on what a stolen operator
  // session can produce in a minute. In the costly namespace because this is
  // the only endpoint in the app that publishes something addressed outward.
  assert.ok(isLimited('/api/fn/createDemoRestaurant'));
  assert.ok(LIMITED.has('/api/fn/createDemoRestaurant'));
  assert.ok(COSTLY.has('/api/fn/createDemoRestaurant'));
});

// ── What gets written ───────────────────────────────────────────────────────

test('the created row is a demo on its own 24-hour clock', async () => {
  await withStub({}, async ({ tables }) => {
    const before = Date.now();
    const { res, json } = await create({ name: '  Herb and Rye  ' });
    const after = Date.now();

    assert.equal(res.status, 200);
    const row = tables.restaurants[0];

    assert.equal(row.name, 'Herb and Rye', 'trimmed');
    assert.equal(row.demo, true);
    assert.ok(
      row.demo_expires_at >= before + 24 * 3600000 && row.demo_expires_at <= after + 24 * 3600000,
      `demo_expires_at was ${row.demo_expires_at}, not ~24h out`,
    );
    // Not also on a fourteen-day trial. The demo arm in entitlement.js answers
    // first regardless, so this is the row telling the truth rather than the
    // thing that makes it work.
    assert.equal(row.trial_ends_at, null);
    assert.equal(row.plan, 'trial');

    assert.equal(json.name, 'Herb and Rye');
    assert.equal(json.url, `https://billtap.app/r/${row.slug}`);
    assert.equal(json.expires_at, row.demo_expires_at);
  });
});

test('the Google review link is null, and stays null', async () => {
  // Since 0012 the handoff is shown to every guest regardless of rating. On a
  // demo for a business we do not represent, a real passer-by tapping it means
  // we solicited a review on that business's listing without their knowledge.
  await withStub({}, async ({ tables }) => {
    await create({
      name: 'Herb and Rye',
      // Sent by a caller, and ignored: this endpoint takes a name and nothing
      // else, so there is no door for this to arrive through.
      google_review_url: 'https://g.page/r/CX0/review',
    });
    assert.equal(tables.restaurants[0].google_review_url, null);
  });
});

test('the alert address is the operator, never the prospect', async () => {
  // If a demo ever catches a real guest, the page has to land on the person who
  // created it — not on a restaurant that never signed up and would read the
  // email as spam from a domain it does not recognise.
  await withStub({}, async ({ tables }) => {
    await create({ name: 'Herb and Rye', alert_email: 'gm@herbandrye.example' });
    assert.equal(tables.restaurants[0].alert_email, OPERATOR_EMAIL);
    assert.equal(tables.restaurants[0].alert_phone, null, 'and nothing that spends money');
    assert.equal(tables.restaurants[0].owner_id, KAI);
  });
});

test('creating one is audited, with the name that went on the page', async () => {
  await withStub({}, async ({ tables }) => {
    const { audited } = await create({ name: 'Herb and Rye' });
    const entry = audited.find((e) => e.action === ACTIONS.DEMO_CREATED);
    assert.ok(entry, 'a page published in a business name needs a row that outlives it');
    assert.equal(entry.actorUserId, KAI);
    assert.equal(entry.detail.name, 'Herb and Rye');
    assert.equal(entry.detail.slug, tables.restaurants[0].slug);
  });
});

// ── The slug ────────────────────────────────────────────────────────────────

test('the slug is not derivable from the name', async () => {
  await withStub({}, async ({ tables }) => {
    await create({ name: 'Herb and Rye' });
    const { slug } = tables.restaurants[0];

    assert.ok(!slug.includes('herb'), `${slug} leaks the name`);
    assert.ok(!slug.includes('rye'), `${slug} leaks the name`);
    // Two cosmetic initials, a hyphen, and six characters of entropy.
    assert.match(slug, /^[a-z0-9]{1,2}-[0-9bcdfghjkmnpqrstvwxyz]{6}$/);
    // No vowels and no `l` in the random half: this gets read aloud down a
    // phone and typed by hand when the QR does not scan.
    assert.ok(!/[aeioul]/.test(slug.split('-')[1]), `${slug} can be misheard or misread`);
  });
});

test('the same name twice produces two different slugs', async () => {
  await withStub({}, async ({ tables }) => {
    await create({ name: 'Herb and Rye' });
    await create({ name: 'Herb and Rye' });
    assert.equal(tables.restaurants.length, 2);
    assert.notEqual(tables.restaurants[0].slug, tables.restaurants[1].slug);
  });
});

test('a slug collision retries rather than throwing', async () => {
  // Thirty to the sixth means this does not happen. It is checked because the
  // loser of a collision would be a real restaurant whose printed table tents
  // start resolving to a demo — the failure reserveSlug() exists to prevent,
  // and worse here because the demo is deleted tonight.
  await withStub({}, async (s) => {
    // The prefix comes from the name and the tail is random, so the candidate
    // is only predictable once both halves are pinned. Take the prefix from a
    // demo made the ordinary way rather than hard-coding it — a hard-coded
    // guess that stopped matching would leave this test passing while
    // exercising nothing, which is the failure mode of every collision test.
    const { json: first } = await create({ name: 'Herb and Rye' });
    const prefix = first.slug.split('-')[0];

    // An all-zero draw maps to the first character of the alphabet, six times.
    const collides = `${prefix}-000000`;
    s.tables.restaurants.push({ id: 'r_real', name: 'Real Place', slug: collides, owner_id: 'someone' });

    const realRandom = crypto.getRandomValues.bind(crypto);
    let draws = 0;
    // First draw is fixed and collides; every draw after it is real.
    crypto.getRandomValues = (array) => {
      draws += 1;
      return draws === 1 ? array.fill(0) : realRandom(array);
    };
    try {
      const { res, json } = await create({ name: 'Herb and Rye' });
      assert.equal(res.status, 200, 'a taken slug is retried past, not thrown on');
      assert.equal(json.slug.split('-')[0], prefix);
      assert.notEqual(json.slug, collides);
      assert.ok(draws >= 2, `only ${draws} draw(s) — the collision was never hit`);
    } finally {
      crypto.getRandomValues = realRandom;
    }

    // And the real restaurant still holds the slug its table tents point at.
    assert.equal(s.tables.restaurants.find((r) => r.slug === collides).name, 'Real Place');
  });
});

// ── The name ────────────────────────────────────────────────────────────────

test('an empty, oversized or unprintable name is refused', async () => {
  assert.ok(demoName('').error);
  assert.ok(demoName('   ').error);
  assert.ok(demoName(undefined).error);
  assert.ok(demoName('x'.repeat(121)).error);
  // Refused rather than stripped. This string is shown back to the operator to
  // confirm he typed the right thing, so a name that silently becomes a
  // different name is the one bug he cannot catch by looking at the screen.
  assert.ok(demoName(`Herb${String.fromCharCode(0)}and Rye`).error);
  assert.equal(demoName('  Herb and Rye  ').name, 'Herb and Rye');
  assert.equal(demoName('北京烤鸭').name, '北京烤鸭', 'a name with no ascii is still a name');

  await withStub({}, async ({ tables }) => {
    const { res } = await create({ name: '   ' });
    assert.equal(res.status, 400);
    assert.equal(tables.restaurants.length, 0);
  });
});

test('a name with no ascii still gets a usable slug', async () => {
  await withStub({}, async ({ tables }) => {
    const { res } = await create({ name: '北京烤鸭' });
    assert.equal(res.status, 200);
    // `d` for demo rather than a leading hyphen, which is not a slug.
    assert.match(tables.restaurants[0].slug, /^d-[0-9bcdfghjkmnpqrstvwxyz]{6}$/);
  });
});

// ── Demos stay out of the operator's own numbers ────────────────────────────

test("a demo is never mistaken for the operator's own restaurant", async () => {
  // The quiet failure, and it belongs to the person selling. Demo rows carry
  // his owner_id and his address, so without the filter in
  // findOrAdoptRestaurant his dashboard between calls shows a prospect's name
  // and a prospect's ratings averaged into his own.
  const demo = {
    id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    owner_id: KAI, alert_email: OPERATOR_EMAIL,
    demo: true, demo_expires_at: Date.now() + 3600000,
    created_date: '2026-08-01T00:00:00Z',
  };
  const real = {
    id: 'r_real', name: 'Mariposa', slug: 'mariposa',
    owner_id: KAI, alert_email: OPERATOR_EMAIL, plan: 'active',
    created_date: '2026-08-09T00:00:00Z',
  };

  // The demo is the older row, so an unfiltered `order: created_date` lookup
  // would return it first — which is exactly how this would have shipped.
  await withStub({ restaurants: [demo, real] }, async () => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(), audit: async () => {},
    });
    const out = await res.json();
    assert.equal(out.restaurant.slug, 'mariposa');
  });
});

test('an operator with only demos is shown no restaurant at all', async () => {
  // Not the demo, and not a claim on one. He has no restaurant; saying so is
  // what stops the settings form editing a page due to be deleted tonight.
  const demo = {
    id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    owner_id: KAI, alert_email: OPERATOR_EMAIL,
    demo: true, demo_expires_at: Date.now() + 3600000,
  };
  await withStub({ restaurants: [demo] }, async () => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(), audit: async () => {},
    });
    assert.equal((await res.json()).restaurant, null);
  });
});

test('an unclaimed demo row is never adopted', async () => {
  // It carries the operator's own alert_email by design, so it is the row most
  // likely to match the email claim — and adopting one hands somebody a
  // restaurant in a stranger's name that is deleted the same night.
  const orphanDemo = {
    id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    owner_id: null, alert_email: OPERATOR_EMAIL,
    demo: true, demo_expires_at: Date.now() + 3600000,
  };
  await withStub({ restaurants: [orphanDemo] }, async ({ tables }) => {
    const res = await HANDLERS.getMyRestaurantSummary({
      env: ENV, request: request(), audit: async () => {},
    });
    assert.equal((await res.json()).restaurant, null);
    assert.equal(tables.restaurants[0].owner_id, null, 'and it was not claimed on the way past');
  });
});

test("an operator's own split is not filed against one of his demos", async () => {
  // createSession attributes a slug-less split to the caller's restaurant, and
  // that read carries no `order` — so PostgREST is free to hand back a demo he
  // made that afternoon. His own meal would be filed against a prospect's page
  // and deleted with it tonight.
  const demo = {
    id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    owner_id: KAI, demo: true, demo_expires_at: Date.now() + 3600000,
  };
  const real = { id: 'r_real', name: 'Mariposa', slug: 'mariposa', owner_id: KAI, demo: false };

  await withStub({ restaurants: [demo, real] }, async ({ tables }) => {
    const res = await HANDLERS.createSession({
      env: ENV,
      request: request(),
      body: { title: 'Dinner', total_amount: 40, items: [], participants: [] },
      audit: async () => {},
    });
    assert.equal(res.status, 200);
    assert.equal(tables.sessions.at(-1).restaurant_id, 'r_real');
  });
});

test('a guest arriving from a demo QR still gets a split on the demo', async () => {
  // The other branch, deliberately untouched: a split started from a demo table
  // page belongs to the demo. That is the thing being sold.
  const demo = {
    id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    demo: true, demo_expires_at: Date.now() + 3600000,
  };
  await withStub({ restaurants: [demo], user: null }, async ({ tables }) => {
    const res = await HANDLERS.createSession({
      env: ENV,
      request: request(false),
      body: { title: 'Dinner', total_amount: 40, items: [], participants: [], restaurant_slug: 'hr-a7f3kq' },
      audit: async () => {},
    });
    assert.equal(res.status, 200);
    assert.equal(tables.sessions.at(-1).restaurant_id, 'r_demo');
  });
});

test('demos never appear in the public restaurant list', async () => {
  // A list of restaurant names, answered to anyone who asks. A demo's name is a
  // business that has not agreed to appear on a list of BillTap's restaurants.
  const demo = { id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq', demo: true };
  const real = { id: 'r_real', name: 'Mariposa', slug: 'mariposa', demo: false };
  await withStub({ restaurants: [demo, real] }, async () => {
    const res = await HANDLERS.listRestaurants({ env: ENV });
    const out = await res.json();
    assert.deepEqual(out.restaurants.map((r) => r.name), ['Mariposa']);
  });
});

// ── The list the operator works from ────────────────────────────────────────

test('his live demos come back soonest-to-expire, and expired ones do not', async () => {
  const now = Date.now();
  const rows = [
    { id: 'a', name: 'Late', slug: 'l-aaaaaa', owner_id: KAI, demo: true, demo_expires_at: now + 20 * 3600000 },
    { id: 'b', name: 'Soon', slug: 's-bbbbbb', owner_id: KAI, demo: true, demo_expires_at: now + 2 * 3600000 },
    // Expired at lunchtime. The cleanup job is nightly, so it is still in the
    // table — and it must stop being offered now rather than at 09:30 tomorrow.
    { id: 'c', name: 'Gone', slug: 'g-cccccc', owner_id: KAI, demo: true, demo_expires_at: now - 3600000 },
    { id: 'd', name: 'Mariposa', slug: 'mariposa', owner_id: KAI, demo: false },
    { id: 'e', name: 'Someone Else', slug: 'x-eeeeee', owner_id: 'user_other', demo: true, demo_expires_at: now + 3600000 },
  ];
  await withStub({ restaurants: rows }, async () => {
    const res = await HANDLERS.listMyDemoRestaurants({ env: ENV, request: request() });
    const out = await res.json();
    assert.deepEqual(out.demos.map((d) => d.name), ['Soon', 'Late']);
    assert.equal(out.demos[0].url, 'https://billtap.app/r/s-bbbbbb');
  });
});

test('the list is behind the same allowlist as the create', async () => {
  const stranger = { id: 'user_stranger', email: 'someone@gmail.example' };
  await withStub({ user: stranger }, async () => {
    const res = await HANDLERS.listMyDemoRestaurants({ env: ENV, request: request() });
    assert.equal(res.status, 403);
  });
  await withStub({ user: null }, async () => {
    const res = await HANDLERS.listMyDemoRestaurants({ env: ENV, request: request(false) });
    assert.equal(res.status, 401);
  });
});

// ── What a guest's phone is told ────────────────────────────────────────────

test('the guest page knows it is a demo, so it can refuse to be indexed', async () => {
  const demo = {
    id: 'r_demo', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    demo: true, demo_expires_at: Date.now() + 3600000, rating_threshold: 3,
    // As createDemoRestaurant writes it, and the assertion below is that being
    // entitled — which a demo is — does not turn the Google handoff back on.
    google_review_url: null,
  };
  await withStub({ restaurants: [demo] }, async () => {
    const res = await HANDLERS.getPublicRestaurant({
      env: ENV,
      request: new Request('https://billtap.app/api/fn/getPublicRestaurant', { method: 'POST' }),
      body: { slug: 'hr-a7f3kq' },
    });
    const out = await res.json();
    assert.equal(out.restaurant.demo, true);
    assert.equal(out.restaurant.name, 'Herb and Rye', 'and it is otherwise an ordinary table page');
    assert.equal(out.restaurant.google_review_url, null);
  });
});

// ── Taking the page back down ───────────────────────────────────────────────
//
// A hard delete, which is the opposite of everything else in retention.js. The
// argument that protects a real restaurant's data — it is theirs, it cannot be
// recovered once refused — points the other way here: this data belongs to
// nobody, it is stars a salesman tapped himself, and keeping it pollutes
// exactly the numbers the product is sold on.

const NOW = Date.UTC(2026, 7, 15, 12);

/** A demo, its ratings and its contacts — the three things that must all go. */
const withChildren = (id, expiresAt) => ({
  restaurant: { id, name: `Demo ${id}`, slug: `d-${id}`, demo: true, demo_expires_at: expiresAt },
  rating: { id: `gr_${id}`, restaurant_id: id, stars: 2 },
  contact: { id: `gc_${id}`, restaurant_id: id, email: 'nobody@example.com' },
});

function seed(s, entries) {
  for (const { restaurant, rating, contact } of entries) {
    s.tables.restaurants.push(restaurant);
    s.tables.guest_ratings.push(rating);
    s.tables.guest_contacts.push(contact);
  }
}

test('an expired demo is deleted, along with its ratings and contacts', async () => {
  await withStub({}, async (s) => {
    seed(s, [withChildren('expired', NOW - 3600000)]);
    const summary = await sweepExpiredDemos(ENV, serviceRole(ENV), { now: NOW });

    assert.equal(summary.deleted, 1);
    assert.equal(summary.ratings_deleted, 1);
    assert.equal(summary.contacts_deleted, 1);
    assert.equal(s.tables.restaurants.length, 0);
    assert.equal(s.tables.guest_ratings.length, 0, 'or the average slowly fills with his own taps');
    assert.equal(s.tables.guest_contacts.length, 0);
  });
});

test('a demo still inside its window is left alone', async () => {
  await withStub({}, async (s) => {
    seed(s, [withChildren('live', NOW + 6 * 3600000)]);
    const summary = await sweepExpiredDemos(ENV, serviceRole(ENV), { now: NOW });

    assert.equal(summary.considered, 0);
    assert.equal(s.tables.restaurants.length, 1, 'a prospect may still be holding this one');
    assert.equal(s.tables.guest_ratings.length, 1);
  });
});

test('a real restaurant is never touched, expired demos beside it or not', async () => {
  // The failure this job could produce is not recoverable, so the predicate
  // that decides what is disposable has to be exact.
  await withStub({}, async (s) => {
    seed(s, [withChildren('expired', NOW - 3600000)]);
    s.tables.restaurants.push({ id: 'r_real', name: 'Mariposa', slug: 'mariposa', demo: false, plan: 'active' });
    s.tables.guest_ratings.push({ id: 'gr_real', restaurant_id: 'r_real', stars: 5 });

    await sweepExpiredDemos(ENV, serviceRole(ENV), { now: NOW });

    assert.deepEqual(s.tables.restaurants.map((r) => r.id), ['r_real']);
    assert.deepEqual(s.tables.guest_ratings.map((r) => r.id), ['gr_real']);
  });
});

test('a demo with no expiry is not swept', async () => {
  // Served by entitlement.js and therefore not something to delete on a
  // guess. `demo_expires_at < now` is null-safe in Postgres — null compares to
  // nothing — and this asserts the job depends on that rather than on luck.
  await withStub({}, async (s) => {
    seed(s, [withChildren('nulled', null)]);
    const summary = await sweepExpiredDemos(ENV, serviceRole(ENV), { now: NOW });
    assert.equal(summary.deleted, 0);
    assert.equal(s.tables.restaurants.length, 1);
  });
});

test('one demo that will not delete does not stop the rest', async () => {
  await withStub({}, async (s) => {
    seed(s, [withChildren('bad', NOW - 7200000), withChildren('good', NOW - 3600000)]);

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url);
      if (init.method === 'DELETE' && u.pathname.endsWith('/guest_ratings') && u.search.includes('bad')) {
        return new Response('locked', { status: 409 });
      }
      return realFetch(url, init);
    };
    try {
      const summary = await sweepExpiredDemos(ENV, serviceRole(ENV), { now: NOW });
      assert.equal(summary.failed, 1);
      assert.equal(summary.deleted, 1, 'the other one still came down');
    } finally {
      globalThis.fetch = realFetch;
    }

    // The failed one is left whole and still expired, so tomorrow tries again.
    // A restaurant row left behind is the recoverable direction; children left
    // behind with no row to find them by is not.
    assert.deepEqual(s.tables.restaurants.map((r) => r.id), ['bad']);
    assert.deepEqual(s.tables.guest_ratings.map((r) => r.id), ['gr_bad']);
  });
});

test('a real restaurant is not flagged as a demo', async () => {
  const real = { id: 'r_real', name: 'Mariposa', slug: 'mariposa', plan: 'active', current_period_end: Date.now() + 20 * 86400000 };
  await withStub({ restaurants: [real] }, async () => {
    const res = await HANDLERS.getPublicRestaurant({
      env: ENV,
      request: new Request('https://billtap.app/api/fn/getPublicRestaurant', { method: 'POST' }),
      body: { slug: 'mariposa' },
    });
    assert.equal((await res.json()).restaurant.demo, false);
  });
});

// ── The ticket details a scan read off the receipt ──────────────────────────
//
// createSession is unauthenticated by design, so the body is whatever anyone
// chose to send. The scan already clamped these; that is not a reason for this
// to trust them. See ticketColumns in worker/routes/functions.js.

test('a scanned table, server and check number are stored on the split', async () => {
  await withStub({ user: null }, async (s) => {
    s.tables.restaurants.push({ id: 'r_real', name: 'Mariposa', slug: 'mariposa', demo: false });
    const res = await HANDLERS.createSession({
      env: ENV,
      request: request(false),
      body: {
        title: 'Dinner', total_amount: 40, items: [], participants: [],
        restaurant_slug: 'mariposa',
        ticket: { table: '14', server: 'Marco', number: '4471' },
      },
      audit: async () => {},
    });
    assert.equal(res.status, 200);
    const row = s.tables.sessions.at(-1);
    assert.equal(row.ticket_table, '14');
    assert.equal(row.ticket_server, 'Marco');
    assert.equal(row.ticket_number, '4471');
  });
});

test('a caller-supplied essay is clamped, not stored whole', async () => {
  // The body is anonymous and unbounded. Re-clamped here rather than trusted
  // from the scan, because only one of those two is written while somebody is
  // thinking about a hostile caller.
  await withStub({ user: null }, async (s) => {
    const res = await HANDLERS.createSession({
      env: ENV,
      request: request(false),
      body: {
        title: 'Dinner', total_amount: 40, items: [], participants: [],
        ticket: { table: 'x'.repeat(500), server: 'y'.repeat(500) },
      },
      audit: async () => {},
    });
    assert.equal(res.status, 200);
    const row = s.tables.sessions.at(-1);
    assert.equal(row.ticket_table.length, 16);
    assert.equal(row.ticket_server.length, 40);
  });
});

test('a split with no receipt writes no ticket columns at all', async () => {
  // Every "Skip setup" even split, and every scan that read no table. Null is
  // the meaningful value — it is what the alert falls back on — so writing
  // empty strings would make "could not read one" look like "it is blank".
  await withStub({ user: null }, async (s) => {
    await HANDLERS.createSession({
      env: ENV,
      request: request(false),
      body: { title: 'Quick Split', total_amount: 40, items: [], participants: [] },
      audit: async () => {},
    });
    const row = s.tables.sessions.at(-1);
    assert.equal(row.ticket_table, undefined);
    assert.equal(row.ticket_server, undefined);
    assert.equal(row.ticket_number, undefined);
  });
});

test('a junk ticket in the body is ignored rather than stored or refused', async () => {
  // A browser sending nonsense should not be able to write nonsense, and should
  // not fail either — the diner did nothing wrong and their split must go
  // through.
  for (const ticket of ['TABLE 14', 42, [], { table: 42 }, { table: '   ' }]) {
    // eslint-disable-next-line no-await-in-loop
    await withStub({ user: null }, async (s) => {
      const res = await HANDLERS.createSession({
        env: ENV,
        request: request(false),
        body: { title: 'Dinner', total_amount: 40, items: [], participants: [], ticket },
        audit: async () => {},
      });
      assert.equal(res.status, 200, `${JSON.stringify(ticket)} must not fail the split`);
      assert.equal(s.tables.sessions.at(-1).ticket_table, undefined);
    });
  }
});
