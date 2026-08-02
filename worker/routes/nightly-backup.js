/**
 * Nightly backup, on a Cloudflare cron.
 *
 * Replaces base44/functions/nightlyBackup, which could not work on two counts.
 * It wrote to /tmp inside an ephemeral Deno isolate — gone the moment the
 * invocation ended, so nothing was ever readable afterwards — and its upload
 * block was commented out. It also ran on Base44, which blocks backend
 * functions on this app's plan, so it had not executed at all in some time.
 *
 * Meanwhile src/RUNBOOK.md told an operator to restore from that file during an
 * incident. A backup that does not exist is a gap; confident instructions for
 * restoring from it are worse, because they are read at the worst possible
 * moment and believed.
 *
 * What changed, beyond the location:
 *
 * - All eight entities, not the two it covered.
 * - Paginated past the SDK's 200-record default, which silently truncated every
 *   entity that had grown past it. A backup that quietly holds the most recent
 *   200 rows is arguably worse than none, because its size looks plausible.
 * - Writes to R2, which is durable and already in the stack.
 * - Fails loudly. If the bucket is not bound, this throws rather than logging
 *   and returning 200, because the failure mode being designed against is
 *   precisely a backup that reports success and stores nothing.
 *
 * Bind a bucket in wrangler.jsonc as BACKUP_BUCKET to turn it on.
 */

import { serviceRole, backendName } from '../lib/data.js';
import { appId } from '../lib/base44.js';
import { mayRunScheduledWork, environmentName } from '../lib/environment.js';

/** Everything worth restoring. Session and Receipt were the original two. */
const ENTITIES = [
  'Session',
  'Receipt',
  'Restaurant',
  'GuestRating',
  'GuestContact',
  'RestaurantLead',
  'Waitlist',
];

/** Base44's list() default. Anything larger has to be walked. */
const PAGE = 200;

/** Stop runaway paging; far above any plausible real count. */
const MAX_PAGES = 200;

/**
 * Every row of one entity, walked page by page.
 *
 * The original called list('-created_date', 200) once and called it a backup.
 */
async function fetchAll(svc, name) {
  const entity = svc.entity(name);
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await entity.list('-created_date', PAGE, page * PAGE);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/**
 * Runs the backup and returns a per-entity summary.
 *
 * Throws when the bucket is missing or a write fails. Callers must not swallow
 * that — a silent backup failure is the whole problem this replaces.
 */
export async function runBackup(env) {
  if (!env.BACKUP_BUCKET) {
    throw new Error(
      'BACKUP_BUCKET is not bound. There is no backup until it is — see wrangler.jsonc.',
    );
  }
  // Whichever database is live is the one worth backing up. Checking Base44's
  // credentials after the cutover would throw every night against a deployment
  // that has no Base44 credentials and does not need any — a backup job failing
  // for a reason that is not about backups.
  if (backendName(env) === 'base44') {
    if (!appId(env) || !env.BASE44_MASTER_KEY) {
      throw new Error('BASE44_APP_ID and BASE44_MASTER_KEY are required to read the data');
    }
  } else if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read the data');
  }

  const svc = serviceRole(env);
  const startedAt = new Date();
  const snapshot = { exported_at: startedAt.toISOString(), entities: {} };
  const summary = {};
  const failed = [];

  for (const name of ENTITIES) {
    try {
      const records = await fetchAll(svc, name);
      snapshot.entities[name] = { count: records.length, records };
      summary[name] = records.length;
    } catch (error) {
      // Record the failure in the snapshot rather than aborting: a backup
      // missing one entity beats no backup at all, but it must not be silent.
      failed.push(name);
      snapshot.entities[name] = { count: 0, records: [], error: String(error?.message) };
      summary[name] = `FAILED: ${error?.message}`;
    }
  }

  const day = startedAt.toISOString().slice(0, 10);
  const key = `billtap-backup-${day}.json`;
  const body = JSON.stringify(snapshot);

  await env.BACKUP_BUCKET.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      exported_at: snapshot.exported_at,
      entities: String(ENTITIES.length),
      failed: failed.join(',') || 'none',
    },
  });

  // Prove it landed. A put() that resolves is not the same as an object that
  // exists, and this is the one job where assuming is how you find out too late.
  const stored = await env.BACKUP_BUCKET.head(key);
  if (!stored) throw new Error(`Wrote ${key} but it is not readable back`);

  return {
    key,
    bytes: stored.size,
    entities: summary,
    failed,
    took_ms: Date.now() - startedAt.getTime(),
  };
}

/**
 * The cron entry point. Logs the summary so `wrangler tail` shows what was
 * captured, and rethrows on failure so the invocation is marked failed rather
 * than quietly succeeding.
 */
export async function scheduled(env) {
  // Production only.
  //
  // The cron is declared at the top level of wrangler.jsonc, so every
  // environment that inherits it would fire this on its own schedule. A staging
  // deployment doing so either snapshots staging data into the production
  // bucket or snapshots production data from a deployment nobody is watching,
  // and both of those are worse than no backup because the object shows up with
  // a plausible size and a recent timestamp.
  if (!mayRunScheduledWork(env)) {
    console.log(`nightly-backup: skipped in the ${environmentName(env)} environment`);
    return;
  }

  try {
    const result = await runBackup(env);
    console.log(`nightly-backup: wrote ${result.key} (${result.bytes} bytes) — ${JSON.stringify(result.entities)}`);
    if (result.failed.length) {
      console.error(`nightly-backup: entities that failed: ${result.failed.join(', ')}`);
    }
  } catch (error) {
    console.error(`nightly-backup FAILED: ${error?.message}`);
    throw error;
  }
}
