/**
 * The migration, against a stubbed Base44 and a stubbed Supabase.
 *
 * This script is about to be pointed at a live database holding real
 * restaurants' bills, and until now it had never been executed against
 * anything. These are the failures worth finding here rather than at the point
 * of cutover: a page boundary that silently truncates, a foreign key that takes
 * a whole batch down, a short write that reports success.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrate, readAll, writeAll, shape, keyRole, problems, ENTITIES } from './migrate-to-supabase.mjs';

const CONFIG = {
  appId: 'app1',
  masterKey: 'master',
  base44Origin: 'https://base44.app',
  supabaseUrl: 'https://proj.supabase.co',
  supabaseKey: 'service-key',
};

const entityFor = (name) => ENTITIES.find((e) => e.name === name);

/**
 * A stand-in for both ends. `data` maps entity name to its rows; whatever is
 * written lands in `written` so a test can inspect it.
 */
function stubBoth(data = {}, { failTable = null } = {}) {
  const written = {};
  const requests = [];

  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, method: init.method || 'GET' });

    if (parsed.hostname.endsWith('base44.app')) {
      const entity = parsed.pathname.split('/entities/')[1];
      const limit = Number(parsed.searchParams.get('limit'));
      const offset = Number(parsed.searchParams.get('offset'));
      const all = data[entity] || [];
      return new Response(JSON.stringify(all.slice(offset, offset + limit)), { status: 200 });
    }

    const table = parsed.pathname.split('/rest/v1/')[1].split('?')[0];
    if (table === failTable) {
      return new Response('column "nope" does not exist', { status: 400 });
    }
    written[table] = (written[table] || []).concat(JSON.parse(init.body));
    return new Response('', { status: 201 });
  };

  return { fetchImpl, written, requests };
}

// ── Reshaping ───────────────────────────────────────────────────────────────

test('a Base44 owner id is parked, not carried into a uuid column', () => {
  // owner_id is a Supabase auth uuid and Base44's ids are not uuids, and those
  // accounts do not exist in auth.users yet. Sending one fails the foreign key
  // and takes the whole batch of a hundred rows with it.
  const { row } = shape({ id: 'r1', name: 'Joe', slug: 'joes', owner_id: 'base44_user_7' }, entityFor('Restaurant'));
  assert.equal(row.owner_id, undefined);
  assert.equal(row.legacy_owner_id, 'base44_user_7');
});

test('a session keeps its creator for later, in a text column', () => {
  const { row } = shape({ id: 's1', title: 'Dinner', created_by_id: 'base44_user_7' }, entityFor('Session'));
  assert.equal(row.created_by_id, undefined);
  assert.equal(row.legacy_created_by_id, 'base44_user_7');
});

test('a field with no column is dropped and reported, not sent', () => {
  // PostgREST rejects the entire batch for one unknown column, so a stray
  // Base44 bookkeeping field would fail a hundred good rows.
  const { row, dropped } = shape(
    { id: 'r1', name: 'Joe', slug: 'joes', is_sample: true, some_future_field: 1 },
    entityFor('Restaurant'),
  );
  assert.equal(row.is_sample, undefined);
  assert.deepEqual(dropped.sort(), ['is_sample', 'some_future_field']);
});

test('the fields that matter survive reshaping', () => {
  const session = {
    id: 's1', title: 'Olive Garden', split_mode: 'itemized',
    items: [{ id: 'i1', name: 'Steak', price: 20, claimed_by: ['p_1_a'] }],
    participants: [{ participant_id: 'p_1_a', amount_owed: 20, payment_status: 'paid' }],
    tax: 2, tip: 3, total_amount: 25, status: 'claiming',
    host_key_hash: 'abc', expires_at: 1893456000000, restaurant_id: 'r1',
  };
  const { row, dropped } = shape(session, entityFor('Session'));
  assert.deepEqual(dropped, []);
  assert.deepEqual(row.items, session.items, 'the claim state comes across intact');
  assert.deepEqual(row.participants, session.participants);
  assert.equal(row.host_key_hash, 'abc', 'without this nobody can confirm a payment again');
  assert.equal(row.expires_at, 1893456000000);
});

test('an undefined value is omitted rather than sent as null', () => {
  const { row } = shape({ id: 'w1', email: 'a@b.com', source: undefined }, entityFor('Waitlist'));
  assert.ok(!('source' in row));
});

// ── Paging ──────────────────────────────────────────────────────────────────

test('every row comes across, not just the first page', async () => {
  // The failure this guards is the one the old nightly backup had: it captured
  // the most recent 200 rows of each entity and looked entirely plausible.
  const rows = Array.from({ length: 450 }, (_, i) => ({ id: `s${i}`, title: `Split ${i}` }));
  const { fetchImpl } = stubBoth({ Session: rows });
  const out = await readAll('Session', CONFIG, fetchImpl);
  assert.equal(out.length, 450);
  assert.equal(out.at(-1).id, 's449');
});

test('a short page ends the read instead of costing another request', async () => {
  const { fetchImpl, requests } = stubBoth({ Session: [{ id: 's1' }] });
  await readAll('Session', CONFIG, fetchImpl);
  assert.equal(requests.length, 1);
});

test('an empty entity is not an error', async () => {
  const { fetchImpl } = stubBoth({});
  assert.deepEqual(await readAll('Waitlist', CONFIG, fetchImpl), []);
});

test('a Base44 failure stops the run rather than migrating a partial table', async () => {
  const fetchImpl = async () => new Response('server error', { status: 500 });
  await assert.rejects(() => readAll('Session', CONFIG, fetchImpl), /Base44 Session: 500/);
});

// ── Writing ─────────────────────────────────────────────────────────────────

test('rows are upserted, so a repeated run is safe', async () => {
  // Both halves are needed. on_conflict names the column; the Prefer header is
  // what turns the insert into a merge. Without the header a rerun dies on a
  // duplicate key, which means a migration that fails halfway can never simply
  // be run again — exactly when you least want to reconcile by hand.
  const headers = [];
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).hostname.endsWith('base44.app')) return new Response('[]', { status: 200 });
    headers.push({ url: new URL(url), prefer: init.headers.Prefer });
    return new Response('', { status: 201 });
  };
  await writeAll(entityFor('Waitlist'), [{ id: 'w1', email: 'a@b.com' }], CONFIG, fetchImpl);

  assert.equal(headers[0].url.searchParams.get('on_conflict'), 'id');
  assert.match(headers[0].prefer, /resolution=merge-duplicates/);
});

test('a large table is written in batches, all of it', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: `w${i}`, email: `a${i}@b.com` }));
  const { fetchImpl, written } = stubBoth();
  const result = await writeAll(entityFor('Waitlist'), rows, CONFIG, fetchImpl);
  assert.equal(result.written, 250);
  assert.equal(written.waitlist.length, 250);
});

test('a rejected batch throws rather than counting as written', async () => {
  const { fetchImpl } = stubBoth({}, { failTable: 'waitlist' });
  await assert.rejects(
    () => writeAll(entityFor('Waitlist'), [{ id: 'w1', email: 'a@b.com' }], CONFIG, fetchImpl),
    /Supabase waitlist: 400/,
  );
});

// ── The whole run ───────────────────────────────────────────────────────────

test('parents are migrated before their children', async () => {
  // Postgres refuses a session whose restaurant is not there yet, and a rating
  // whose session is not. Order is not cosmetic.
  const tables = ENTITIES.map((e) => e.table);
  assert.ok(tables.indexOf('restaurants') < tables.indexOf('sessions'));
  assert.ok(tables.indexOf('sessions') < tables.indexOf('guest_ratings'));
  assert.ok(tables.indexOf('restaurants') < tables.indexOf('guest_contacts'));
});

test('a dry run reads everything and writes nothing', async () => {
  const { fetchImpl, written, requests } = stubBoth({
    Restaurant: [{ id: 'r1', name: 'Joe', slug: 'joes' }],
    Session: [{ id: 's1', title: 'Dinner' }],
  });
  const summary = await migrate({ config: CONFIG, dryRun: true, fetchImpl });

  assert.deepEqual(written, {}, 'nothing was written');
  assert.ok(!requests.some((r) => r.method === 'POST'));
  assert.equal(summary.find((s) => s.table === 'restaurants').read, 1);
  assert.equal(summary.find((s) => s.table === 'restaurants').written, 0);
});

test('a real run copies every row and reconciles the counts', async () => {
  const { fetchImpl, written } = stubBoth({
    Restaurant: [{ id: 'r1', name: 'Joe', slug: 'joes', owner_id: 'u1' }],
    Session: Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, title: `D${i}` })),
    GuestRating: [{ id: 'g1', restaurant_id: 'r1', stars: 5 }],
  });
  const summary = await migrate({ config: CONFIG, fetchImpl });

  assert.equal(written.restaurants.length, 1);
  assert.equal(written.sessions.length, 3);
  assert.equal(written.guest_ratings.length, 1);
  for (const row of summary) assert.equal(row.written, row.read, `${row.table} is short`);
});

test('--only migrates one entity and leaves the rest alone', async () => {
  const { fetchImpl, written } = stubBoth({
    Restaurant: [{ id: 'r1', name: 'Joe', slug: 'joes' }],
    Session: [{ id: 's1', title: 'Dinner' }],
  });
  await migrate({ config: CONFIG, only: 'Session', fetchImpl });
  assert.ok(written.sessions);
  assert.equal(written.restaurants, undefined);
});

test('an entity name nobody recognises is an error, not a silent no-op', async () => {
  const { fetchImpl } = stubBoth({});
  await assert.rejects(() => migrate({ config: CONFIG, only: 'Nonsense', fetchImpl }), /No entity called/);
});

test('dropped fields are reported per table so nothing vanishes quietly', async () => {
  const { fetchImpl } = stubBoth({
    Restaurant: [{ id: 'r1', name: 'Joe', slug: 'joes', mystery_field: 'x' }],
  });
  const summary = await migrate({ config: CONFIG, only: 'Restaurant', fetchImpl });
  assert.deepEqual(summary[0].dropped, ['mystery_field']);
});

test('the service key never travels to Base44, nor the master key to Supabase', async () => {
  // Two vendors, two credentials. Sending either to the wrong one hands a live
  // key to a third party.
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ host: new URL(url).hostname, auth: init.headers?.Authorization, apikey: init.headers?.apikey });
    if (new URL(url).hostname.endsWith('base44.app')) return new Response('[]', { status: 200 });
    return new Response('', { status: 201 });
  };
  await migrate({ config: CONFIG, only: 'Waitlist', fetchImpl });

  for (const call of seen) {
    if (call.host.endsWith('base44.app')) {
      assert.ok(!JSON.stringify(call).includes('service-key'), 'Supabase key leaked to Base44');
    } else {
      assert.ok(!JSON.stringify(call).includes('master'), 'Base44 key leaked to Supabase');
    }
  }
});

// ── Which key got pasted ────────────────────────────────────────────────────

const jwt = (claims) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

test('the anon key and the service role key are told apart', () => {
  // They are the same length, the same prefix, and sit next to each other on
  // the same dashboard page. The claim inside is the only difference, and it
  // is the difference between every row copying and every row being refused.
  assert.equal(keyRole(jwt({ iss: 'supabase', role: 'anon' })), 'anon');
  assert.equal(keyRole(jwt({ iss: 'supabase', role: 'service_role' })), 'service_role');
});

test('a key that is not a JWT reads as unknown rather than as wrong', () => {
  // Supabase's newer publishable/secret keys are not JWTs. Refusing everything
  // unrecognisable would block a project on the new key format for no reason,
  // so an unreadable key is passed through and left to fail honestly at the
  // first write if it is in fact wrong.
  assert.equal(keyRole('sb_secret_abc123'), null);
  assert.equal(keyRole(''), null);
  assert.equal(keyRole(undefined), null);
  assert.equal(keyRole('not.a.jwt'), null);
});

// ── Believing the run ───────────────────────────────────────────────────────

test('reading nothing from everything is a failure, not an empty database', () => {
  // This is the one that got through. The first live run against an app with
  // real restaurants in it read zero rows from all seven entities and printed
  // "Every row accounted for", because the only rule was written === read and
  // zero equals zero. A migration that cannot tell success from silence is
  // worse than one that fails.
  const summary = ENTITIES.map((e) => ({ table: e.table, read: 0, written: 0, dropped: [] }));
  const found = problems(summary, {});
  assert.equal(found.length, 1);
  assert.match(found[0], /Zero rows read/);
});

test('a dry run that reads nothing is caught too', () => {
  // The dry run is where this is meant to be found — before anything is
  // written and before anyone believes the counts.
  const summary = ENTITIES.map((e) => ({ table: e.table, read: 0, written: 0, dropped: [] }));
  assert.equal(problems(summary, { dryRun: true }).length, 1);
});

test('one empty entity among populated ones is fine', () => {
  const summary = [
    { table: 'restaurants', read: 3, written: 3, dropped: [] },
    { table: 'waitlist', read: 0, written: 0, dropped: [] },
  ];
  assert.deepEqual(problems(summary, {}), []);
});

test('--only on a genuinely empty entity is not treated as a broken read', () => {
  const summary = [{ table: 'waitlist', read: 0, written: 0, dropped: [] }];
  assert.deepEqual(problems(summary, { only: 'Waitlist' }), []);
});

test('a short write still says do not cut over', () => {
  const summary = [{ table: 'sessions', read: 120, written: 100, dropped: [] }];
  const found = problems(summary, {});
  assert.equal(found.length, 1);
  assert.match(found[0], /sessions 100\/120/);
});

test('a dry run is not reported as short, since it writes nothing', () => {
  const summary = [{ table: 'sessions', read: 120, written: 0, dropped: [] }];
  assert.deepEqual(problems(summary, { dryRun: true }), []);
});
