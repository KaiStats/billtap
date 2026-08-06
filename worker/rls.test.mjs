/**
 * Row level security, checked against the migrations rather than trusted.
 *
 * The posture is stated in 0001: RLS on everywhere, no policies, so the anon
 * key the browser holds reads nothing and writes nothing, and authorisation
 * lives in the Worker where it is tested. That is a good posture and it is only
 * as good as its weakest table — one `create table` without the matching
 * `enable row level security` and that table is readable by anyone holding the
 * anon key, which ships in the browser bundle by design.
 *
 * Nothing checked it. These do, statically, against every migration file, so a
 * table added in six months fails here rather than in somebody's Burp log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(join(MIGRATIONS, f), 'utf8') }));

const all = sql.map((s) => s.text).join('\n');

/** Statements only. Comments in these files are long and full of the words below. */
const code = all
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

test('every table has row level security enabled', () => {
  const tables = [...code.matchAll(/create table if not exists\s+([a-z_]+)/gi)].map((m) => m[1]);
  assert.ok(tables.length >= 8, `expected the schema's tables, found ${tables.length}`);

  const protectedTables = new Set(
    [...code.matchAll(/alter table\s+([a-z_]+)\s+enable row level security/gi)].map((m) => m[1]),
  );

  for (const table of tables) {
    assert.ok(
      protectedTables.has(table),
      `"${table}" has no "alter table ${table} enable row level security" — with RLS off, ` +
      'the anon key that ships in the browser bundle can read every row in it',
    );
  }
});

test('the set of permissive policies is the set somebody decided on', () => {
  // Not a style rule. Every policy here is a hole punched in a default-deny
  // wall, deliberately, with a paragraph next to it explaining why. A new one
  // arriving without that conversation is the thing this catches.
  const policies = [...code.matchAll(/create policy\s+"([^"]+)"/gi)].map((m) => m[1]).sort();

  assert.deepEqual(
    policies,
    [
      // 0004: a guest photographing a bill has no account, so the insert must
      // grant anon. Migration 0007 removes this in favour of signed upload
      // URLs; when that is applied, this entry goes with it.
      'receipt images are insertable by anyone',
      // 0001: an operator reading their own restaurant row, and nothing else.
      'owners read their own restaurant',
    ].sort(),
    'a row level security policy was added or removed — if that was intended, update this list ' +
    'and say in the migration why the exception is worth making',
  );
});

test('no migration hands anon or authenticated a blanket grant', () => {
  // RLS is only a control while the role's table privileges are what Supabase
  // set up. A `grant all ... to anon` in a later migration would not disable
  // RLS, but combined with one careless policy it is how a default-deny schema
  // stops being one.
  for (const { file, text } of sql) {
    const statements = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(
      statements,
      /grant\s+all\s+(privileges\s+)?on\s+all\s+tables/i,
      `${file} contains a blanket grant`,
    );
    const grants = [...statements.matchAll(/grant\s+([a-z, ]+?)\s+on\s+(\S+)\s+to\s+([a-z_, ]+)/gi)];
    for (const [, privileges, object, roles] of grants) {
      if (!/anon|authenticated/i.test(roles)) continue;
      assert.fail(
        `${file} grants "${privileges.trim()}" on ${object} to ${roles.trim()} — ` +
        'the browser roles are meant to reach this database through the Worker only',
      );
    }
  }
});

test('the audit log cannot be rewritten, by anyone', () => {
  // It is the record a payment dispute is settled from. If the service role can
  // update it, then so can anything that gets hold of the service key, and a
  // trail that can be edited is not a trail.
  const audit = sql.find((s) => s.file.includes('audit_log'));
  assert.ok(audit, 'expected an audit_log migration');

  assert.match(
    audit.text,
    /revoke\s+update,\s*delete,\s*truncate\s+on\s+audit_log\s+from\s+anon,\s*authenticated,\s*service_role/i,
    'audit_log must revoke update/delete/truncate from every role including service_role',
  );
  assert.match(
    audit.text,
    /create trigger\s+audit_log_no_update\s+before update or delete on audit_log/i,
    'and enforce it at the row level too, in case a grant is ever restored',
  );
});

test('the security definer trigger pins its search_path', () => {
  // A security definer function runs as its owner. With a caller-controlled
  // search_path, "update restaurants" can be made to mean a table the caller
  // created — which is a privilege escalation with a well-known shape.
  const claim = sql.find((s) => s.file.includes('claim_restaurant'));
  assert.ok(claim, 'expected the claim-on-signup migration');

  const definers = [...claim.text.matchAll(/security definer/gi)];
  assert.ok(definers.length > 0, 'expected a security definer function');
  assert.match(
    claim.text,
    /set search_path\s*=\s*public,\s*pg_temp/i,
    'a security definer function must pin search_path',
  );
});

/**
 * ── The gap that let a live outage through ──────────────────────────────────
 *
 * Everything above checks the schema. Nothing checked the Worker against it,
 * and the two disagreed in production: createSession wrote through asCaller for
 * a signed-in operator, sessions has RLS on with no policies, and PostgREST
 * answered 42501. A guest could split a bill and the owner could not.
 *
 * It survived the whole audit because the unit tests stub the data layer. A
 * stub has no policies, so `asCaller` and `serviceRole` behave identically in
 * every test in this repo and differ only against a real database — which is
 * the one place none of them run.
 *
 * These tie the two halves together statically. Same trick as the rest of this
 * file: read the migrations, read the code, and refuse to let them drift.
 */

/** Base44 entity names to tables — mirrors TABLES in worker/lib/db.js. */
const ENTITY_TABLE = {
  Session: 'sessions',
  Restaurant: 'restaurants',
  GuestRating: 'guest_ratings',
  GuestContact: 'guest_contacts',
  RestaurantLead: 'restaurant_leads',
  Waitlist: 'waitlist',
  Receipt: 'receipts',
};

/** Tables with RLS on and no policy naming them: the anon key gets nothing. */
function defaultDenyTables() {
  const rls = new Set(
    [...code.matchAll(/alter table\s+([a-z_]+)\s+enable row level security/gi)].map((m) => m[1]),
  );
  const withPolicy = new Set(
    [...code.matchAll(/create policy\s+"[^"]+"\s*\n?\s*on\s+([a-z_]+)/gi)].map((m) => m[1]),
  );
  return new Set([...rls].filter((t) => !withPolicy.has(t)));
}

test('sessions is default-deny, so the rule below is not vacuous', () => {
  // The control. If a policy is ever added to sessions this fails, and whoever
  // added it has to decide what that means for the assertions underneath.
  assert.ok(
    defaultDenyTables().has('sessions'),
    'sessions is no longer default-deny — the caller-scoped rules below need revisiting',
  );
});

test('nothing reaches a default-deny table through the caller credentials', () => {
  /**
   * Every asCaller() must be chained straight onto an entity whose table has a
   * policy. Anything else is an offence.
   *
   * The first version of this only matched `asCaller(...).entity('X')` and so
   * would have missed the bug it was written for, which read
   *
   *   const writer = user ? asCaller(env, request) : svc;
   *   ...
   *   await writer.entity('Session').create(...)
   *
   * — the call and the table separated by twenty lines. Following a variable
   * across a function is not something a regex should be trusted with, so this
   * does not try. An unchained asCaller is an unprovable one, and the rule is
   * that it has to be provable at the call site.
   */
  const denied = defaultDenyTables();
  const root = dirname(fileURLToPath(import.meta.url));
  // Route handlers and the dispatcher — where a credential is chosen. Not
  // worker/lib, which is where asCaller and its two backends are implemented;
  // those files name it because they define it.
  const workerFiles = [...walkJs(join(root, 'routes')), join(root, 'index.js')];
  const offences = [];

  for (const file of workerFiles) {
    if (/\.test\.mjs$|\.boundary\.test\.js$/.test(file)) continue;
    const where = file.split('/worker/')[1];
    const text = stripComments(readFileSync(file, 'utf8'));

    for (const m of text.matchAll(/asCaller\s*\(/g)) {
      const rest = text.slice(m.index);
      const chained = /^asCaller\s*\([^)]*\)\s*\.entity\(\s*['"](\w+)['"]/.exec(rest);
      if (!chained) {
        offences.push(`${where}: asCaller() not chained to an entity — cannot prove which table`);
        continue;
      }
      const table = ENTITY_TABLE[chained[1]];
      if (!table) {
        offences.push(`${where}: asCaller().entity('${chained[1]}') is not a known entity`);
      } else if (denied.has(table)) {
        offences.push(`${where}: asCaller().entity('${chained[1]}') → ${table} is default-deny`);
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    'a caller-scoped request against a table with RLS on and no policy reads nothing and ' +
    'writes nothing — it does not fail loudly, it returns an empty array or a 42501:\n  ' +
    `${offences.join('\n  ')}`,
  );
});

test('the entity-to-table map here matches the one the data layer uses', () => {
  // Otherwise the rule above silently stops covering an entity the day one is
  // renamed — a test that passes because it checks nothing.
  const db = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lib', 'db.js'), 'utf8');
  for (const [entity, table] of Object.entries(ENTITY_TABLE)) {
    assert.match(
      db,
      new RegExp(`${entity}:\\s*'${table}'`),
      `worker/lib/db.js no longer maps ${entity} to ${table}`,
    );
  }
});

test('a signed-in owner is stamped on the split they create', () => {
  // created_by_id used to arrive because Base44 filled it in from the caller's
  // token. Nothing does that now, so it is written explicitly — and if it stops
  // being written, the operator dashboard empties and isHost() loses its
  // fallback, both silently.
  const fns = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'routes', 'functions.js'), 'utf8',
  );
  assert.match(
    fns,
    /created_by_id:\s*user\?\.id\s*\|\|\s*null/,
    'createSession must stamp created_by_id from the verified user',
  );
});

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
