#!/usr/bin/env node
/**
 * Copies live data out of Base44 and into Supabase.
 *
 * Read this before running it.
 *
 * ── It does not delete anything ─────────────────────────────────────────────
 *
 * Base44 keeps every row. This only reads from it. The cutover is a
 * configuration change in the Worker, not a point of no return here, and the
 * way back is to flip that configuration. Do not delete anything on the Base44
 * side until the Supabase path has carried real traffic long enough that you
 * would have noticed a problem.
 *
 * ── Ids are preserved, and that is not cosmetic ─────────────────────────────
 *
 * Session ids are live in the world: they are in /claim?id= links open on
 * people's phones, and QR tokens are HMAC-signed over the session id, so a
 * changed id silently invalidates a printed table tent. Rows keep their Base44
 * ids, which is why the schema uses text primary keys.
 *
 * ── User ids do not come across, on purpose ─────────────────────────────────
 *
 * owner_id and created_by_id are Supabase auth uuids. Base44's user ids are not
 * uuids, and those accounts do not exist in auth.users until operators sign up
 * on the new project — so every row carrying one would fail the foreign key and
 * take its whole batch down. The old id is parked in legacy_owner_id /
 * legacy_created_by_id and the link is rebuilt when auth moves. A migrated
 * restaurant having no Supabase owner is correct: nobody has an account yet.
 *
 * ── Idempotent ──────────────────────────────────────────────────────────────
 *
 * Upserts on id, so running it twice is safe and a failed run can simply be
 * repeated. Run it as often as you like before the cutover; the last run before
 * switching is the one that counts.
 *
 *   node scripts/migrate-to-supabase.mjs --dry-run     # counts only, writes nothing
 *   node scripts/migrate-to-supabase.mjs               # copies
 *   node scripts/migrate-to-supabase.mjs --only Session
 *   node scripts/migrate-to-supabase.mjs --from-file base44-export.json
 *
 * Environment:
 *   BASE44_APP_ID, BASE44_MASTER_KEY   (not needed with --from-file)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ── --from-file, and why it is the path that works ──────────────────────────
 *
 * Base44's server API returns 200 and an empty array for every entity on this
 * app, with the master key, with two other credential forms, and with no
 * credential at all. The key is being ignored, so those zeros describe nothing.
 *
 * Reverse-engineering a vendor's server auth on the way out of that vendor is
 * not work worth doing. scripts/export-from-browser.js dumps the same entities
 * from the browser, where the app's own token works, and --from-file reads that
 * dump. Everything after the read is identical.
 */

const PAGE = 200;
const BATCH = 100;

/**
 * Entity, table, and the columns that table actually has.
 *
 * The allow-list is not defensive tidiness. PostgREST rejects an insert
 * containing a column that does not exist, and it rejects the WHOLE BATCH — so
 * one stray Base44 bookkeeping field on one row fails a hundred rows with it.
 * Anything not listed here is dropped and reported, rather than sent and hoped
 * for.
 *
 * Ordered parent-first: restaurants before sessions, sessions before ratings.
 * The foreign keys point that way and Postgres will refuse a child whose parent
 * is not there yet. Keep this order.
 */
export const ENTITIES = [
  {
    name: 'Restaurant',
    table: 'restaurants',
    columns: [
      'id', 'name', 'slug', 'google_review_url', 'alert_email', 'alert_phone',
      'rating_threshold', 'plan', 'trial_ends_at', 'stripe_customer_id',
      'stripe_subscription_id', 'current_period_end', 'billing_address',
      'created_at', 'created_date', 'legacy_owner_id',
    ],
    // Base44 field -> Postgres column.
    rename: { owner_id: 'legacy_owner_id' },
  },
  {
    name: 'Session',
    table: 'sessions',
    columns: [
      'id', 'title', 'receipt_id', 'split_mode', 'items', 'participants', 'tax',
      'tip', 'total_amount', 'image_url', 'status', 'host_key_hash',
      'host_payment_info', 'custom_split_config', 'expires_at', 'restaurant_id',
      'created_date', 'legacy_created_by_id',
    ],
    rename: { created_by_id: 'legacy_created_by_id' },
  },
  {
    name: 'GuestRating',
    table: 'guest_ratings',
    columns: [
      'id', 'restaurant_id', 'session_id', 'stars', 'routed_to_google',
      'comment', 'guest_email', 'alerted_at', 'created_at', 'created_date',
    ],
  },
  {
    name: 'GuestContact',
    table: 'guest_contacts',
    columns: [
      'id', 'restaurant_id', 'email', 'opted_in', 'visits', 'first_seen',
      'last_seen', 'created_date',
    ],
  },
  {
    name: 'RestaurantLead',
    table: 'restaurant_leads',
    columns: [
      'id', 'restaurant_name', 'contact_name', 'email', 'phone', 'locations',
      'plan_interest', 'source', 'notified_at', 'created_at', 'created_date',
    ],
  },
  {
    name: 'Waitlist',
    table: 'waitlist',
    columns: ['id', 'email', 'app', 'source', 'created_at', 'created_date'],
  },
  {
    name: 'Receipt',
    table: 'receipts',
    columns: ['id', 'session_id', 'image_url', 'parsed', 'created_date', 'legacy_created_by_id'],
    rename: { created_by_id: 'legacy_created_by_id' },
  },
];

/**
 * One Base44 row, reshaped for its table.
 *
 * @returns {{ row: object, dropped: string[] }}
 */
export function shape(row, entity) {
  const allowed = new Set(entity.columns);
  const rename = entity.rename || {};
  const out = {};
  const dropped = [];

  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    const column = rename[key] || key;
    if (!allowed.has(column)) {
      dropped.push(key);
      continue;
    }
    out[column] = value;
  }
  return { row: out, dropped };
}

/** Every row of an entity, paged past the 200-record default. */
export async function readAll(entity, config, fetchImpl = fetch) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${config.base44Origin}/api/apps/${config.appId}/entities/${entity}` +
      `?limit=${PAGE}&offset=${offset}`;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.masterKey}` },
    });
    if (!res.ok) throw new Error(`Base44 ${entity}: ${res.status} ${await res.text()}`);

    const page = await res.json();
    const list = Array.isArray(page) ? page : page?.data;
    if (!Array.isArray(list) || list.length === 0) break;

    rows.push(...list);
    // A short page is the last page. Without this the loop only stops when the
    // server returns nothing, which is one wasted request per entity at best
    // and an infinite loop against an API that ignores offset at worst.
    if (list.length < PAGE) break;
  }
  return rows;
}

export async function writeAll(entity, rows, config, fetchImpl = fetch, log = () => {}) {
  if (!rows.length) return { written: 0, dropped: [] };

  const droppedFields = new Set();
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((row) => {
      const { row: shaped, dropped } = shape(row, entity);
      dropped.forEach((f) => droppedFields.add(f));
      return shaped;
    });

    const res = await fetchImpl(`${config.supabaseUrl}/rest/v1/${entity.table}?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        // Upsert, so a repeated run is safe and a partial failure can be run
        // again rather than reconciled by hand.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Supabase ${entity.table}: ${res.status} ${(await res.text()).slice(0, 400)}`);
    }
    written += batch.length;
    log(`  ${entity.table}: ${written}/${rows.length}`);
  }

  return { written, dropped: [...droppedFields] };
}

/**
 * The whole migration.
 *
 * Returns a row-by-row account rather than printing one, so a test can assert
 * on it and a caller can decide what to do about a short write.
 */
export async function migrate({
  config,
  only = null,
  dryRun = false,
  fetchImpl = fetch,
  log = () => {},
  source = null,
}) {
  const targets = only ? ENTITIES.filter((e) => e.name === only) : ENTITIES;
  if (!targets.length) throw new Error(`No entity called "${only}"`);

  // Where the rows come from. Base44's server API by default; a file when the
  // server API cannot be made to answer — see fromFile below. The rest of the
  // migration does not care which, and neither should it: reshaping, batching,
  // upserting and the short-write check are the same either way.
  const read = source || ((name) => readAll(name, config, fetchImpl));

  const summary = [];
  for (const entity of targets) {
    const rows = await read(entity.name);
    if (dryRun) {
      summary.push({ table: entity.table, read: rows.length, written: 0, dropped: [] });
      continue;
    }
    const { written, dropped } = await writeAll(entity, rows, config, fetchImpl, log);
    summary.push({ table: entity.table, read: rows.length, written, dropped });
  }
  return summary;
}

/**
 * Rows out of an export file rather than out of Base44.
 *
 * The server API returns 200 and an empty array for every entity on this app,
 * with any credential and with none, so the master key is being ignored. The
 * browser is not: it holds a token Base44 accepts and reads these same entities
 * on every page load. scripts/export-from-browser.js dumps them from there.
 *
 * This is the better shape anyway. It makes the export a file you can look at
 * before it is written anywhere, and it means the last dependency on Base44
 * being reachable at all disappears at the moment of the migration rather than
 * lingering in it.
 *
 * @param contents parsed base44-export.json — { EntityName: [rows] }
 * @returns {(name: string) => Promise<object[]>}
 */
export function fromFile(contents) {
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) {
    throw new Error('Export file should be an object of { EntityName: [rows] }');
  }
  const unknown = Object.keys(contents).filter((k) => !ENTITIES.some((e) => e.name === k));
  if (unknown.length) {
    throw new Error(
      `Export file has entities this migration does not know: ${unknown.join(', ')}. ` +
      'Add them to ENTITIES with their columns, or the rows will be silently skipped.',
    );
  }
  return async (name) => {
    const rows = contents[name];
    // An entity missing from the file is not an error — the export may predate
    // an entity, or have been taken with --only. It is zero rows, and the
    // all-zero check still applies across the whole run.
    if (rows === undefined) return [];
    if (!Array.isArray(rows)) throw new Error(`Export file: ${name} is not an array`);
    return rows;
  };
}

/**
 * Everything about this run that means "do not cut over", in plain sentences.
 *
 * Separate from the printing because the judgement is the part worth testing.
 * The first live run against real data printed "Every row accounted for" after
 * reading nothing at all, and no test caught it — because the only rule was
 * "written must equal read", and zero equals zero.
 *
 * @returns {string[]} empty when the run can be believed
 */
export function problems(summary, { only = null, dryRun = false } = {}) {
  const found = [];

  // Reading nothing from every entity is not an empty database. It is a read
  // that failed without saying so: readAll throws on a non-2xx, so a rejected
  // credential would already have stopped the run. What is left is a credential
  // Base44 accepts without recognising as the app, a response envelope this
  // code does not unwrap, or entity names that do not exist under those names.
  //
  // Not applied to --only, where one genuinely empty entity is ordinary.
  if (!only && summary.length && summary.every((s) => s.read === 0)) {
    found.push(
      'Zero rows read from every entity. Treat that as a broken read, not an ' +
      'empty database. Base44\'s server API answers 200 and empty to any ' +
      'credential and to none, so export from the browser instead — see ' +
      'scripts/export-from-browser.js — and rerun with --from-file.',
    );
  }

  // A dry run writes nothing, so a short write is not a finding there.
  if (!dryRun) {
    const short = summary.filter((s) => s.written !== s.read);
    if (short.length) {
      found.push(`Short: ${short.map((s) => `${s.table} ${s.written}/${s.read}`).join(', ')}`);
    }
  }

  return found;
}

/**
 * The role a Supabase key carries, read out of the JWT it already is.
 *
 * Both keys a project hands you are JWTs and they look identical at a glance —
 * same prefix, same length, same page of the dashboard. The only difference
 * that matters is one claim, and copying the wrong one is the single easiest
 * mistake to make here.
 *
 * It matters because the schema enables row level security on every table with
 * almost no policies. The anon key is therefore refused by every write, and
 * PostgREST reports that as a 401 mentioning nothing about which key you sent —
 * so the failure reads as a broken script rather than a wrong paste.
 *
 * No signature check: this is not authenticating anything, it is reading a
 * label off a credential the operator already holds, to tell them they grabbed
 * the wrong one.
 *
 * @returns {string|null} the role claim, or null if this is not a readable JWT
 */
export function keyRole(key) {
  const payload = String(key || '').split('.')[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

// ── Command line ────────────────────────────────────────────────────────────

function readConfig(envSource = process.env, { needsBase44 = true } = {}) {
  const need = (name) => {
    const value = envSource[name];
    if (!value) {
      console.error(`${name} is not set.`);
      process.exit(1);
    }
    return value;
  };
  const supabaseKey = need('SUPABASE_SERVICE_ROLE_KEY');
  const role = keyRole(supabaseKey);
  if (role && role !== 'service_role') {
    console.error(`\nSUPABASE_SERVICE_ROLE_KEY is a "${role}" key, not a service_role key.`);
    console.error('Every write would be refused by row level security, and PostgREST would');
    console.error('report that as a 401 that says nothing about the key.');
    console.error('\nSupabase dashboard → Project Settings → API keys → service_role. It is');
    console.error('hidden behind a Reveal button, which is why the anon key is the one that');
    console.error('gets copied.\n');
    process.exit(1);
  }

  // --from-file never contacts Base44, so demanding its credentials would be
  // asking for a key to a door nobody is opening — and the whole point of that
  // flag is that those credentials do not work.
  return {
    appId: (needsBase44 ? need('BASE44_APP_ID') : envSource.BASE44_APP_ID || '').replace(/^app_/, ''),
    masterKey: needsBase44 ? need('BASE44_MASTER_KEY') : null,
    base44Origin: (envSource.BASE44_API_ORIGIN || 'https://base44.app').replace(/\/+$/, ''),
    supabaseUrl: need('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseKey,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;
  const fileIndex = argv.indexOf('--from-file');
  const filePath = fileIndex >= 0 ? argv[fileIndex + 1] : null;
  if (fileIndex >= 0 && !filePath) {
    console.error('--from-file needs a path to base44-export.json');
    process.exit(1);
  }

  const config = readConfig(process.env, { needsBase44: !filePath });

  let source = null;
  if (filePath) {
    const { readFile } = await import('node:fs/promises');
    source = fromFile(JSON.parse(await readFile(filePath, 'utf8')));
  }

  console.log(`\n${dryRun ? 'DRY RUN — nothing will be written' : 'Migrating'}`);
  console.log(`  from ${filePath ? filePath : `Base44 app ${config.appId}`}`);
  console.log(`  to   ${config.supabaseUrl}\n`);

  const summary = await migrate({
    config,
    only,
    dryRun,
    source,
    log: (line) => process.stdout.write(`\r${line}`),
  });

  console.log('\n');
  console.table(summary.map(({ table, read, written }) => ({ table, read, written })));

  const dropped = summary.filter((s) => s.dropped?.length);
  if (dropped.length) {
    console.log('\n  Fields present in Base44 with no column here, dropped:');
    for (const s of dropped) console.log(`    ${s.table}: ${s.dropped.join(', ')}`);
    console.log('  Check that none of those matter before cutting over.');
  }

  const failures = problems(summary, { only, dryRun });
  if (failures.length) {
    for (const line of failures) console.error(`\n  ${line}`);
    console.error('\n  DO NOT CUT OVER.\n');
    process.exit(1);
  }

  if (!dryRun) {
    console.log('\n  Every row accounted for.');
    console.log('  Nothing has been deleted from Base44. The cutover is a configuration');
    console.log('  change in the Worker — see docs/SUPABASE-MIGRATION.md.\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}
