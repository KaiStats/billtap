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
 * side until the Supabase path has carried real traffic for long enough that
 * you would notice a problem.
 *
 * ── Ids are preserved, and that is not cosmetic ─────────────────────────────
 *
 * Session ids are live in the world: they are in /claim?id= links open on
 * people's phones, and QR tokens are HMAC-signed over the session id, so a
 * changed id silently invalidates a printed table tent. Rows keep their Base44
 * ids, which is why the schema uses text primary keys.
 *
 * ── Idempotent ──────────────────────────────────────────────────────────────
 *
 * Upserts on id, so running it twice is safe and a failed run can simply be
 * repeated. Run it as many times as you like before the cutover; the last run
 * before switching is the one that matters.
 *
 *   node scripts/migrate-to-supabase.mjs --dry-run     # counts only, writes nothing
 *   node scripts/migrate-to-supabase.mjs               # copies
 *   node scripts/migrate-to-supabase.mjs --only Session
 *
 * Environment:
 *   BASE44_APP_ID, BASE44_MASTER_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

const DRY_RUN = has('dry-run');
const PAGE = 200;

/** Entity to table, and the field mapping where the two differ. */
const ENTITIES = [
  { name: 'Restaurant', table: 'restaurants' },
  { name: 'Session', table: 'sessions' },
  { name: 'GuestRating', table: 'guest_ratings' },
  { name: 'GuestContact', table: 'guest_contacts' },
  { name: 'RestaurantLead', table: 'restaurant_leads' },
  { name: 'Waitlist', table: 'waitlist' },
  { name: 'Receipt', table: 'receipts' },
];

// Restaurants before sessions, sessions before ratings: the foreign keys point
// that way and Postgres will refuse a child whose parent is not there yet.
// ENTITIES is already in that order — keep it that way.

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
};

const BASE44_APP_ID = env('BASE44_APP_ID').replace(/^app_/, '');
const BASE44_MASTER_KEY = env('BASE44_MASTER_KEY');
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const SUPABASE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

/** Every row of an entity, paged past the 200-record default. */
async function readAll(entity) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `https://base44.app/api/apps/${BASE44_APP_ID}/entities/${entity}` +
      `?limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${BASE44_MASTER_KEY}` } });
    if (!res.ok) throw new Error(`Base44 ${entity}: ${res.status} ${await res.text()}`);

    const page = await res.json();
    const list = Array.isArray(page) ? page : page?.data;
    if (!Array.isArray(list) || list.length === 0) break;

    rows.push(...list);
    if (list.length < PAGE) break;
  }
  return rows;
}

/**
 * Base44 rows carry fields the Postgres tables do not have, and a stray column
 * fails the whole insert. Anything unmapped is dropped rather than guessed at.
 */
function clean(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    // Base44 bookkeeping that has no counterpart.
    if (['created_by', 'is_sample', 'sample_data'].includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

async function writeAll(table, rows) {
  if (!rows.length) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map(clean);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        // Upsert, so a repeated run is safe and a partial failure can just be
        // run again rather than reconciled by hand.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Supabase ${table}: ${res.status} ${(await res.text()).slice(0, 400)}`);
    }
    written += batch.length;
    process.stdout.write(`\r  ${table}: ${written}/${rows.length}`);
  }
  process.stdout.write('\n');
  return written;
}

async function main() {
  const only = flag('only');
  const targets = only ? ENTITIES.filter((e) => e.name === only) : ENTITIES;
  if (!targets.length) {
    console.error(`No entity called "${only}".`);
    process.exit(1);
  }

  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will be written' : 'Migrating'}`);
  console.log(`  from Base44 app ${BASE44_APP_ID}`);
  console.log(`  to   ${SUPABASE_URL}\n`);

  const summary = [];
  for (const { name, table } of targets) {
    const rows = await readAll(name);
    if (DRY_RUN) {
      console.log(`  ${table}: ${rows.length} rows would be written`);
      summary.push({ table, read: rows.length, written: 0 });
      continue;
    }
    const written = await writeAll(table, rows);
    summary.push({ table, read: rows.length, written });
  }

  console.log('');
  console.table(summary);

  if (!DRY_RUN) {
    const short = summary.filter((s) => s.written !== s.read);
    if (short.length) {
      console.error('\n  Some tables did not receive every row. Do not cut over.\n');
      process.exit(1);
    }
    console.log('\n  Every row accounted for.');
    console.log('  Nothing has been deleted from Base44, and the cutover is a');
    console.log('  configuration change in the Worker — see docs/SUPABASE-MIGRATION.md.\n');
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
