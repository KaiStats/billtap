/**
 * The retention job, and the promises it is keeping.
 *
 * src/pages/Privacy.jsx publishes a table saying guest names, claim lists and
 * receipt images are handled automatically 30 days after a session completes.
 * Before worker/routes/retention.js nothing did any of it — one cron, running
 * the backup, and no delete of any kind anywhere in the repo. These assert the
 * three rows of that table individually, because they are three separate
 * promises and a job that keeps two of them is still a policy that is wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scheduled, redactSession, sweepOrphans, REMOVED, RETENTION_DAYS } from './routes/retention.js';
import { serviceRole, storageKeyFromUrl } from './lib/db.js';

const SUPABASE = 'https://stub.supabase.co';

const env = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ENVIRONMENT: 'production',
};

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/**
 * A stub that speaks both APIs this job touches — PostgREST for the rows and
 * the storage endpoint for the images — and records the deletes, since a
 * receipt image that was never actually deleted is the failure worth catching.
 */
function stub(sessions, { storageFails = false, objects = [] } = {}) {
  const store = { sessions: sessions.map((s) => structuredClone(s)) };
  const deleted = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);

    // The bucket listing the orphan sweep walks. Oldest first, as the real API
    // is asked to.
    if (u.pathname === '/storage/v1/object/list/receipts') {
      assert.equal(init.method, 'POST');
      const { limit = 100 } = JSON.parse(init.body || '{}');
      const sorted = [...objects].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return new Response(JSON.stringify(sorted.slice(0, limit)), { status: 200 });
    }

    if (u.pathname.startsWith('/storage/v1/object/')) {
      assert.equal(init.method, 'DELETE');
      if (storageFails) return new Response('nope', { status: 500 });
      deleted.push(decodeURIComponent(u.pathname.replace('/storage/v1/object/receipts/', '')));
      return new Response('{}', { status: 200 });
    }

    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = store[from] || [];

    if (init.method === 'PATCH') {
      const id = u.searchParams.get('id')?.slice(3);
      const row = rows.find((r) => r.id === id);
      if (!row) return new Response('[]', { status: 200 });
      Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify([structuredClone(row)]), { status: 200 });
    }

    // Reads: honour lt / is.null / order / limit, which is what the job relies on.
    let found = rows.filter((row) => {
      for (const [key, value] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        const [op, ...rest] = String(value).split('.');
        const operand = rest.join('.');
        if (op === 'lt' && !(row[key] < operand)) return false;
        if (op === 'is' && operand === 'null' && row[key] != null) return false;
        if (op === 'eq' && String(row[key]) !== operand) return false;
        if (op === 'gte' && !(row[key] >= operand)) return false;
        if (op === 'in') {
          // in.("a","b") — the form the orphan sweep asks a whole page with.
          const members = operand.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
          if (!members.includes(String(row[key]))) return false;
        }
      }
      return true;
    });
    const orderSpec = u.searchParams.get('order');
    if (orderSpec) {
      const [column] = orderSpec.split('.');
      found = [...found].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
    }
    const limit = Number(u.searchParams.get('limit'));
    if (limit) found = found.slice(0, limit);
    return new Response(JSON.stringify(found.map((r) => structuredClone(r))), { status: 200 });
  };

  return { store, deleted, restore: () => { globalThis.fetch = original; } };
}

const overdue = {
  id: 'old1',
  updated_date: daysAgo(RETENTION_DAYS + 5),
  redacted_at: null,
  image_url: `${SUPABASE}/storage/v1/object/public/receipts/abc-123.jpg`,
  participants: [
    { participant_id: 'p_1_a', name: 'Priya', amount_owed: 20, payment_status: 'paid' },
    { participant_id: 'p_2_b', name: 'Marcus', amount_owed: 10, payment_status: 'paid' },
  ],
  items: [
    { id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: ['p_1_a'] },
    { id: 'i2', name: 'Salad', price: 10, quantity: 1, claimed_by: ['p_2_b'] },
  ],
};

const recent = {
  ...structuredClone(overdue),
  id: 'new1',
  updated_date: daysAgo(3),
};

test('a session past the retention window loses the three things the policy names', async () => {
  const { store, deleted, restore } = stub([overdue]);
  try {
    const summary = await scheduled(env);
    const row = store.sessions[0];

    assert.deepEqual(
      row.participants.map((p) => p.name),
      [REMOVED, REMOVED],
      'guest display names replaced, exactly as the policy words it',
    );
    assert.deepEqual(
      row.items.map((i) => i.claimed_by),
      [[], []],
      'item claim associations cleared',
    );
    assert.deepEqual(deleted, ['abc-123.jpg'], 'the receipt image is gone from storage');
    assert.equal(row.image_url, null, 'and nothing still links to it');

    assert.equal(summary.redacted, 1);
    assert.equal(summary.images_deleted, 1);
  } finally {
    restore();
  }
});

test('what the host paid for survives, because that is their own record', async () => {
  const { store, restore } = stub([overdue]);
  try {
    await scheduled(env);
    const row = store.sessions[0];
    assert.deepEqual(
      row.items.map((i) => [i.name, i.price]),
      [['Steak', 20], ['Salad', 10]],
      'item names and prices kept — the policy says so on the same row',
    );
    assert.deepEqual(
      row.participants.map((p) => p.amount_owed),
      [20, 10],
      'and the amounts, which are the financial record',
    );
  } finally {
    restore();
  }
});

test('a session inside the window is not touched', async () => {
  const { store, deleted, restore } = stub([recent]);
  try {
    const summary = await scheduled(env);
    assert.equal(summary.considered, 0, 'not even read');
    assert.deepEqual(deleted, [], 'no image deleted');
    assert.equal(store.sessions[0].participants[0].name, 'Priya');
    assert.equal(store.sessions[0].redacted_at, null);
  } finally {
    restore();
  }
});

test('a session already redacted is not processed twice', async () => {
  const done = { ...structuredClone(overdue), id: 'done1', redacted_at: Date.now(), image_url: null };
  const { deleted, restore } = stub([done]);
  try {
    const summary = await scheduled(env);
    assert.equal(summary.considered, 0);
    assert.deepEqual(deleted, []);
  } finally {
    restore();
  }
});

test('an image that will not delete leaves the row for tomorrow rather than filing it as done', async () => {
  const { store, restore } = stub([overdue], { storageFails: true });
  try {
    const summary = await scheduled(env);
    const row = store.sessions[0];

    // The important half: the row is NOT marked redacted, so the next run tries
    // the image again. Marking it done here is how a photograph of somebody's
    // bill stays reachable forever.
    assert.equal(row.redacted_at, null, 'still due');
    assert.equal(row.participants[0].name, 'Priya', 'and not half-redacted');
    assert.equal(summary.failed, 1);
    assert.equal(summary.redacted, 0);
  } finally {
    restore();
  }
});

test('one session failing does not stop the rest of the batch', async () => {
  const a = { ...structuredClone(overdue), id: 'a', image_url: 'https://base44.example/old/img.jpg' };
  const b = { ...structuredClone(overdue), id: 'b', image_url: null };
  const { store, restore } = stub([a, b]);
  try {
    const summary = await scheduled(env);
    assert.equal(summary.redacted, 2, 'both handled');
    assert.equal(summary.images_foreign, 1, "the Base44 URL is reported, not silently counted as deleted");
    for (const row of store.sessions) {
      assert.equal(row.participants[0].name, REMOVED);
    }
  } finally {
    restore();
  }
});

test('it refuses to run against a backend whose storage it cannot reach', async () => {
  const { restore } = stub([overdue]);
  try {
    const summary = await scheduled({ ...env, DATA_BACKEND: 'base44', BASE44_APP_ID: 'x', BASE44_MASTER_KEY: 'y' });
    assert.equal(summary.skipped, 'backend', 'a clean run that deleted nothing would be a lie');
  } finally {
    restore();
  }
});

// ── The URL each image key is derived from ──────────────────────────────────

test('a storage key is only taken from a URL into our own bucket', () => {
  assert.equal(
    storageKeyFromUrl(`${SUPABASE}/storage/v1/object/public/receipts/abc-123.jpg`, 'receipts'),
    'abc-123.jpg',
  );
  assert.equal(storageKeyFromUrl('https://base44.example/files/x.jpg', 'receipts'), null);
  assert.equal(storageKeyFromUrl('', 'receipts'), null);
  assert.equal(storageKeyFromUrl(null, 'receipts'), null);
  // A query string on a public URL is cache-busting, not part of the key.
  assert.equal(
    storageKeyFromUrl(`${SUPABASE}/storage/v1/object/public/receipts/k.png?v=2`, 'receipts'),
    'k.png',
  );
});

test('redactSession reports rather than throws, so a batch can survive a row', async () => {
  const { restore } = stub([overdue], { storageFails: true });
  try {
    const outcome = await redactSession(env, serviceRole(env), overdue);
    assert.equal(outcome.image, 'failed');
    assert.equal(outcome.row, 'pending');
    assert.ok(outcome.error, 'and says why');
  } finally {
    restore();
  }
});

// ── Orphaned images ─────────────────────────────────────────────────────────
//
// NewReceipt starts the upload the moment the photo is chosen, so it has the
// whole review screen to finish rather than making the diner wait. If the split
// is then never created — backed out, bad scan, tab closed — the object sits in
// the bucket with no row referencing it. There is no foreign key from storage
// to sessions, so the session pass walks straight past it forever.
//
// The first version of this audit flagged that as unfixable from the row side
// and left it. It is fixable from the other side: walk the bucket and ask the
// database whether anything claims each key.

const objectAged = (name, days) => ({ name, created_at: daysAgo(days) });

test('an image no session ever claimed is deleted', async () => {
  const { deleted, restore } = stub([], {
    objects: [objectAged('orphan-1.jpg', RETENTION_DAYS + 10)],
  });
  try {
    const summary = await scheduled(env);
    assert.deepEqual(deleted, ['orphan-1.jpg']);
    assert.equal(summary.orphans.orphans_deleted, 1);
  } finally {
    restore();
  }
});

test('an image a live split still displays is left alone', async () => {
  // The case that matters most. image_url is set at creation and updated_date
  // moves forward, so a split created forty days ago and touched yesterday
  // still shows a forty-day-old object. Deleting on age alone would take the
  // receipt out from under a bill somebody is still looking at.
  const live = {
    ...structuredClone(overdue),
    id: 'live',
    updated_date: daysAgo(1),
    image_url: `${SUPABASE}/storage/v1/object/public/receipts/still-in-use.jpg`,
  };
  const { deleted, restore } = stub([live], {
    objects: [objectAged('still-in-use.jpg', RETENTION_DAYS + 10)],
  });
  try {
    const summary = await scheduled(env);
    assert.deepEqual(deleted, [], 'the live split keeps its receipt');
    assert.equal(summary.orphans.candidates, 1, 'it was considered');
    assert.equal(summary.orphans.orphans_deleted, 0, 'and spared');
  } finally {
    restore();
  }
});

test('a freshly uploaded image is never a candidate', async () => {
  // Ninety seconds old and unreferenced is not an orphan — it is a diner still
  // on the review screen. Deleting on "unreferenced" alone races the product.
  const { deleted, restore } = stub([], {
    objects: [objectAged('just-uploaded.jpg', 0)],
  });
  try {
    const summary = await scheduled(env);
    assert.deepEqual(deleted, []);
    assert.equal(summary.orphans.candidates, 0);
  } finally {
    restore();
  }
});

test('the sweep stops at the first object inside the window', async () => {
  // Listed oldest first, so one recent object ends the page rather than costing
  // a query for every file in a large bucket.
  const { deleted, restore } = stub([], {
    objects: [
      objectAged('old-a.jpg', RETENTION_DAYS + 20),
      objectAged('old-b.jpg', RETENTION_DAYS + 10),
      objectAged('recent.jpg', 2),
    ],
  });
  try {
    const summary = await scheduled(env);
    assert.deepEqual(deleted.sort(), ['old-a.jpg', 'old-b.jpg']);
    assert.equal(summary.orphans.candidates, 2);
  } finally {
    restore();
  }
});

test('an undateable object is skipped rather than guessed at', async () => {
  const { deleted, restore } = stub([], {
    objects: [{ name: 'no-timestamp.jpg', created_at: null }],
  });
  try {
    const summary = await scheduled(env);
    assert.deepEqual(deleted, [], 'an object we cannot prove is old waits a night');
    assert.equal(summary.orphans.candidates, 0);
  } finally {
    restore();
  }
});

test('a failing bucket listing does not report the session pass as failed', async () => {
  // Separate catch on purpose. A storage listing that breaks must not be able
  // to make a successful redaction look unsuccessful.
  const original = globalThis.fetch;
  const { store, restore } = stub([overdue], { objects: [] });
  const wrapped = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/storage/v1/object/list/receipts') {
      return new Response('boom', { status: 500 });
    }
    return wrapped(url, init);
  };
  try {
    const summary = await scheduled(env);
    assert.equal(summary.redacted, 1, 'the session pass still succeeded');
    assert.equal(store.sessions[0].participants[0].name, REMOVED);
    assert.ok(summary.orphans.error, 'and the sweep reported its own failure');
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test('sweepOrphans can be driven on its own', async () => {
  const { deleted, restore } = stub([], { objects: [objectAged('x.jpg', RETENTION_DAYS + 1)] });
  try {
    const summary = await sweepOrphans(env, serviceRole(env));
    assert.equal(summary.scanned, 1);
    assert.equal(summary.orphans_deleted, 1);
    assert.deepEqual(deleted, ['x.jpg']);
  } finally {
    restore();
  }
});

// ── An object key is attacker-controlled input ──────────────────────────────
//
// Migration 0004's insert policy is `with check (bucket_id = 'receipts')` —
// nothing constrains the key — so until 0007 is applied, anyone can upload an
// object named whatever they like. The sweep then interpolated every candidate
// key into one `image_url=in.("...","...")`.
//
// A key of `x")--` closes that list early. Every candidate after it stops being
// part of the list PostgREST parses, so it comes back absent from the "still
// claimed" answer and is deleted — including receipts a live split is currently
// displaying. Reproduced end to end before this was fixed.

/** A PostgREST-shaped reader that parses in.(...) the way PostgREST does. */
function injectionStub(sessions, objects) {
  const deleted = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/storage/v1/object/list/receipts') {
      return new Response(JSON.stringify(objects), { status: 200 });
    }
    if (u.pathname.startsWith('/storage/v1/object/')) {
      deleted.push(decodeURIComponent(u.pathname.replace('/storage/v1/object/receipts/', '')));
      return new Response('{}', { status: 200 });
    }

    const raw = u.searchParams.get('image_url') || '';
    let members = [];
    if (raw.startsWith('in.')) {
      const inner = raw.slice(3);
      const close = inner.indexOf(')');            // the list ends at the first ')'
      const body = inner.slice(1, close === -1 ? undefined : close);
      members = body.split(',').map((v) => v.replace(/^"|"$/g, ''));
    } else if (raw.startsWith('eq.')) {
      members = [raw.slice(3)];                    // a scalar, never parsed for structure
    }
    const rows = sessions.filter((s) => members.includes(s.image_url));
    return new Response(JSON.stringify(rows.map((s) => ({ image_url: s.image_url }))), { status: 200 });
  };

  return { deleted, restore: () => { globalThis.fetch = original; } };
}

const objectUrl = (key) => `${SUPABASE}/storage/v1/object/public/receipts/${key}`;
const LIVE_KEY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg';

test('a crafted object name cannot get a live split\'s receipt deleted', async () => {
  const live = { id: 'live', image_url: objectUrl(LIVE_KEY), updated_date: daysAgo(1) };
  const { deleted, restore } = injectionStub([live], [
    // Listed oldest first, so the crafted name lands ahead of the real receipt.
    { name: 'x")--', created_at: daysAgo(RETENTION_DAYS + 50) },
    { name: LIVE_KEY, created_at: daysAgo(RETENTION_DAYS + 10) },
  ]);
  try {
    const summary = await sweepOrphans(env, serviceRole(env));
    assert.ok(
      !deleted.includes(LIVE_KEY),
      'the receipt a live split is displaying was deleted by a neighbouring object\'s name',
    );
    assert.ok(deleted.includes('x")--'), 'and the planted object is still cleaned up');
    assert.equal(summary.unminted, 1, 'the odd key is counted, so abuse is visible');
  } finally {
    restore();
  }
});

test('only keys this app minted are asked about in list form', async () => {
  // The property the batched query depends on: a uuid and an extension cannot
  // contain a quote, a comma or a paren.
  const queries = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/storage/v1/object/list/receipts') {
      return new Response(JSON.stringify([
        { name: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff.png', created_at: daysAgo(RETENTION_DAYS + 5) },
        { name: 'not,a"uuid).txt', created_at: daysAgo(RETENTION_DAYS + 5) },
      ]), { status: 200 });
    }
    if (u.pathname.startsWith('/storage/v1/object/')) return new Response('{}', { status: 200 });
    queries.push(decodeURIComponent(u.searchParams.get('image_url') || ''));
    return new Response('[]', { status: 200 });
  };
  try {
    await sweepOrphans(env, serviceRole(env));
    const listQueries = queries.filter((q) => q.startsWith('in.'));
    assert.equal(listQueries.length, 1, 'one batched query');

    // The whole list, structurally: quoted members separated by commas, and no
    // member containing a quote, comma or paren of its own. That is the
    // property the batching depends on, so it is the property to assert.
    assert.match(
      listQueries[0].slice(3),
      /^\("[^",)]+"(,"[^",)]+")*\)$/,
      `a list query contained a structural character from a key: ${listQueries[0]}`,
    );
    assert.ok(!listQueries[0].includes('not,a"uuid'), 'the odd key stayed out of the list');
    assert.ok(
      queries.some((q) => q.startsWith('eq.') && q.includes('not,a"uuid')),
      'and was asked about as a scalar instead, which is never parsed for structure',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('nothing is deleted without an answer about it', async () => {
  // The cap on unrecognised keys bounds the subrequest spend. It must not turn
  // into "unchecked, therefore delete".
  const many = Array.from({ length: 40 }, (_, i) => ({
    name: `weird-${i}!`,
    created_at: daysAgo(RETENTION_DAYS + 5),
  }));
  const { deleted, restore } = injectionStub([], many);
  try {
    const summary = await sweepOrphans(env, serviceRole(env));
    assert.equal(summary.unminted, 40, 'all of them counted');
    assert.ok(deleted.length <= 25, `deleted ${deleted.length} — more than were checked`);
  } finally {
    restore();
  }
});
