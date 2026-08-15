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

/**
 * Everything worth restoring. Session and Receipt were the original two.
 *
 * AuditLog was missing, and the header above claimed eight entities while this
 * listed seven — which is how it went unnoticed. It is the append-only record
 * of who confirmed which payment, it is the thing a payment dispute is settled
 * from, and it was the one table in the database with no copy of it anywhere.
 *
 * It matters more now than it did. worker/routes/retention.js removes guest
 * names and claim lists from a split thirty days on, so for anything older than
 * that the audit log is not a second record of what happened — it is the only
 * one. Backing up the sessions and not the log would mean restoring a month-old
 * bill with no way left to say who paid it.
 */
export const ENTITIES = [
  'Session',
  'Receipt',
  'Restaurant',
  'GuestRating',
  'GuestContact',
  'RestaurantLead',
  'Waitlist',
  'AuditLog',
  /**
   * Who is on which consumer plan — see migration 0016.
   *
   * Small and easy to overlook, and the one table here whose loss is silently
   * expensive: a restored database without it puts every Pro account back on
   * free, and nobody finds out until an eleventh person cannot join a split
   * somebody has already paid for. There is no consumer checkout yet either,
   * so these rows are granted by hand and there is no Stripe record to rebuild
   * them from.
   */
  'Profile',
];

/**
 * How to page each entity.
 *
 * Everything here carries created_date except audit_log, which timestamps its
 * rows in `at` — so ordering it by created_date asks Postgres for a column that
 * does not exist and fails the entity outright. A backup that drops a table
 * because of a column name is exactly the quiet kind of failure this file was
 * rewritten to stop.
 */
const SORT_COLUMN = { AuditLog: '-at' };

/** Base44's list() default. Anything larger has to be walked. */
const PAGE = 200;

/**
 * ── The three ceilings this job runs into, and what happens at each ─────────
 *
 * It paged past the 200-record default and stopped truncating, which was the
 * bug it was written to fix. What it did not have was any idea how big the
 * database could get before the *platform* stopped it, and all three limits it
 * runs into were silent.
 *
 * 1. Subrequests. A Worker invocation gets 1,000 outbound requests, shared by
 *    everything in the run. Eight entities at up to 200 pages each is 1,600
 *    reads — so past roughly a thousand pages Cloudflare starts refusing, the
 *    per-entity catch below records "FAILED", and the run carries on and writes
 *    an object anyway. READ_BUDGET stops first, and throws.
 *
 * 2. Memory. An isolate has 128 MB, and every row of every entity was held in
 *    one object and then serialised into one string beside it — peak usage is
 *    roughly twice the whole database. The entities are written as separate
 *    objects now, so the peak is the largest single entity rather than the sum,
 *    and ENTITY_MAX_BYTES throws before the isolate is killed. An OOM kills the
 *    invocation with no message and no object; an error says which entity.
 *
 * 3. Row count. MAX_PAGES simply ended the loop, so a table past 40,000 rows
 *    was quietly backed up as its most recent 40,000 — the exact failure this
 *    file's own header says it was rewritten to prevent, reintroduced one level
 *    down. Hitting it is now an error.
 *
 * AuditLog is the entity that reaches all three first, and until this layer it
 * was being fed twenty rows a minute per open host screen by a poll loop. See
 * firstInWindow() in worker/lib/rate-limit.js.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 *
 * Stream each page into R2 as it arrives, which is what would make memory
 * independent of table size altogether rather than merely bounded by the
 * largest table. That is the right next step and it is not taken here, because
 * it cannot be verified in this repo — there is no R2 binding to test against
 * (the bucket does not exist yet; see the RUNBOOK) and this is the one job
 * whose failure mode is discovered during an incident. A verified 8x
 * improvement with loud limits beats an unverified rewrite of the disaster
 * recovery path.
 */
const MAX_PAGES = 200;

/** Leaves headroom under Cloudflare's 1,000 for the R2 writes and the reads back. */
const READ_BUDGET = 800;

/** ~40 MB serialised, well under the isolate's 128 MB, per entity. */
const ENTITY_MAX_BYTES = 40 * 1024 * 1024;

/** Counts reads across the whole run, not per entity. */
function readBudget(limit = READ_BUDGET) {
  let spent = 0;
  return {
    spend() {
      spent += 1;
      if (spent > limit) {
        throw new Error(
          `read budget of ${limit} exhausted — a Worker invocation gets 1,000 subrequests ` +
          'and the remaining entities would have been recorded as failures against a ' +
          'backup that still reported success. Split this job across more crons.',
        );
      }
    },
    get spent() { return spent; },
  };
}

/**
 * Every row of one entity, walked page by page.
 *
 * The original called list('-created_date', 200) once and called it a backup.
 * Everything that can stop it short now throws rather than returning what it
 * managed to get, because a short backup is indistinguishable from a complete
 * one once it is an object in a bucket with a plausible size.
 */
async function fetchAll(svc, name, budget) {
  const entity = svc.entity(name);
  const sort = SORT_COLUMN[name] || '-created_date';
  const all = [];
  let page = 0;
  for (; page < MAX_PAGES; page += 1) {
    budget.spend();
    const rows = await entity.list(sort, PAGE, page * PAGE);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  if (page >= MAX_PAGES) {
    throw new Error(
      `${name} has more than ${MAX_PAGES * PAGE} rows — paging stopped at the cap, which ` +
      'would have stored the most recent rows as if they were all of them',
    );
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
  const exportedAt = startedAt.toISOString();
  const day = exportedAt.slice(0, 10);
  const prefix = `billtap-backup-${day}`;
  const budget = readBudget();
  const summary = {};
  const failed = [];
  const objects = [];
  let bytes = 0;

  /**
   * One object per entity, written and released before the next one is read.
   *
   * It used to build a single `snapshot` holding every row of all eight
   * entities and then JSON.stringify it alongside — peak memory around twice
   * the whole database, in an isolate with 128 MB. Writing them separately
   * makes the peak the largest single entity instead of the sum, which is the
   * difference between "AuditLog is big" and "AuditLog plus everything else is
   * big".
   */
  for (const name of ENTITIES) {
    const key = `${prefix}/${name}.json`;
    try {
      const records = await fetchAll(svc, name, budget);
      const body = JSON.stringify({ exported_at: exportedAt, entity: name, count: records.length, records });

      if (body.length > ENTITY_MAX_BYTES) {
        throw new Error(
          `${name} serialises to ${body.length} bytes, over the ${ENTITY_MAX_BYTES} ceiling — ` +
          'an isolate that runs out of memory is killed with no error and no object',
        );
      }

      await env.BACKUP_BUCKET.put(key, body, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { exported_at: exportedAt, entity: name, count: String(records.length) },
      });

      // Prove it landed. A put() that resolves is not the same as an object
      // that exists, and this is the one job where assuming is how you find out
      // too late.
      const stored = await env.BACKUP_BUCKET.head(key);
      if (!stored) throw new Error(`Wrote ${key} but it is not readable back`);

      objects.push(key);
      bytes += stored.size;
      summary[name] = records.length;
    } catch (error) {
      // Recorded rather than thrown here so the remaining entities are still
      // attempted — a backup missing one table beats no backup at all. The run
      // as a whole still fails at the end; see below.
      failed.push(name);
      summary[name] = `FAILED: ${error?.message}`;
    }
  }

  /**
   * The manifest, written last, listing what actually landed.
   *
   * A restore reads this first. Written even when entities failed, and naming
   * them, because the thing that must never happen is a directory of objects
   * that looks complete.
   */
  const manifestKey = `${prefix}/manifest.json`;
  await env.BACKUP_BUCKET.put(
    manifestKey,
    JSON.stringify({ exported_at: exportedAt, entities: summary, objects, failed, complete: failed.length === 0 }),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { exported_at: exportedAt, complete: String(failed.length === 0) },
    },
  );

  return {
    key: manifestKey,
    objects,
    bytes,
    entities: summary,
    failed,
    reads: budget.spent,
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
    console.log(
      `nightly-backup: wrote ${result.objects.length} objects (${result.bytes} bytes, ` +
      `${result.reads} reads) — ${JSON.stringify(result.entities)}`,
    );

    /**
     * A partial backup is a failed backup.
     *
     * This used to console.error the failed entities and return normally, so
     * the invocation was marked successful. That is the shape of failure this
     * whole file exists to prevent, one level up from where it was being
     * guarded: the object is there, its size is plausible, its timestamp is
     * last night, and six of the eight tables are missing from it. Nobody finds
     * out until they are restoring.
     */
    if (result.failed.length) {
      throw new Error(
        `entities that failed: ${result.failed.join(', ')} — ` +
        `see ${result.key} for what did land`,
      );
    }
  } catch (error) {
    console.error(`nightly-backup FAILED: ${error?.message}`);
    throw error;
  }
}
