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
 *
 * Environment:
 *   BASE44_APP_ID, BASE44_MASTER_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
export async function migrate({ config, only = null, dryRun = false, fetchImpl = fetch, log = () => {} }) {
  const targets = only ? ENTITIES.filter((e) => e.name === only) : ENTITIES;
  if (!targets.length) throw new Error(`No entity called "${only}"`);

  const summary = [];
  for (const entity of targets) {
    const rows = await readAll(entity.name, config, fetchImpl);
    if (dryRun) {
      summary.push({ table: entity.table, read: rows.length, written: 0, dropped: [] });
      continue;
    }
    const { written, dropped } = await writeAll(entity, rows, config, fetchImpl, log);
    summary.push({ table: entity.table, read: rows.length, written, dropped });
  }
  return summary;
}

// ── Command line ────────────────────────────────────────────────────────────

function readConfig(envSource = process.env) {
  const need = (name) => {
    const value = envSource[name];
    if (!value) {
      console.error(`${name} is not set.`);
      process.exit(1);
    }
    return value;
  };
  return {
    appId: need('BASE44_APP_ID').replace(/^app_/, ''),
    masterKey: need('BASE44_MASTER_KEY'),
    base44Origin: (envSource.BASE44_API_ORIGIN || 'https://base44.app').replace(/\/+$/, ''),
    supabaseUrl: need('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;

  const config = readConfig();

  console.log(`\n${dryRun ? 'DRY RUN — nothing will be written' : 'Migrating'}`);
  console.log(`  from Base44 app ${config.appId}`);
  console.log(`  to   ${config.supabaseUrl}\n`);

  const summary = await migrate({
    config,
    only,
    dryRun,
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

  if (!dryRun) {
    const short = summary.filter((s) => s.written !== s.read);
    if (short.length) {
      console.error(`\n  Short: ${short.map((s) => `${s.table} ${s.written}/${s.read}`).join(', ')}`);
      console.error('  DO NOT CUT OVER.\n');
      process.exit(1);
    }
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
