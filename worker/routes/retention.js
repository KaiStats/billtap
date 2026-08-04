/**
 * The retention schedule, actually applied.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * src/pages/Privacy.jsx publishes a table, cites the CCPA above it, and says of
 * three data types that they are handled "automatically":
 *
 *   Guest display names       30 days after session completion → "[removed]"
 *   Item claim associations   30 days after session completion → cleared
 *   Receipt images            30 days after session completion → deleted
 *
 * None of it existed. wrangler.jsonc has one cron and it runs the nightly
 * backup; a search of the Worker, the client and the scripts turns up no delete
 * of any kind, of anything. Guest names, claim lists and photographs of
 * restaurant bills were kept indefinitely while a published policy said they
 * were not — and that policy is the document a restaurant's counsel reads, and
 * the one a regulator would.
 *
 * ── What "completion" means here ────────────────────────────────────────────
 *
 * The policy says "30 days after session completion". A split that is settled
 * completes; a split that is abandoned mid-meal never does, and reading the
 * rule narrowly would keep those forever — which is both the wrong outcome and
 * the harder one to defend, since an abandoned split is the one nobody is
 * coming back for.
 *
 * So the clock is `updated_date`: the last time anything happened to the split.
 * A settled bill stops changing when the host confirms the last payment, an
 * abandoned one stops changing when the table gives up, and thirty days after
 * either is thirty days after it was last of use to anyone.
 *
 * ── What is deliberately kept ───────────────────────────────────────────────
 *
 * Item names and prices, and the totals. The same policy row says so: they are
 * the host's own financial record of a bill they paid, and the guest data is
 * what comes out of them. A redacted session still tells its host what the meal
 * cost and what was on it; it no longer says who anybody was or what they ate.
 *
 * The audit log is not touched. It is append-only by trigger — see migration
 * 0002 — and it is what answers "who confirmed this payment" during a dispute
 * long after the split is gone. It stores participant ids, which are random
 * strings minted in a browser, not names.
 *
 * ── Failure posture ─────────────────────────────────────────────────────────
 *
 * The opposite of the backup's. nightly-backup throws when it cannot do its
 * job, because a backup that reports success and stores nothing is worse than
 * no backup. This one records what it managed and carries on: a single session
 * whose image has already vanished, or whose write loses a race with a diner
 * still poking at a month-old split, must not stop the other ninety-nine from
 * being redacted. Whatever is missed is still due tomorrow — the query is "not
 * yet redacted", so the work is idempotent and self-healing by construction.
 */

import { serviceRole, backendName } from '../lib/data.js';
import { deleteObject, storageKeyFromUrl } from '../lib/db.js';
import { mayRunScheduledWork, environmentName } from '../lib/environment.js';

/** The bucket in supabase/migrations/0004_receipts_storage.sql. */
const BUCKET = 'receipts';

/** What the policy promises, in days. */
export const RETENTION_DAYS = 30;

/** What a guest's display name becomes. The policy names this exact string. */
export const REMOVED = '[removed]';

/**
 * Sessions per run.
 *
 * A Worker invocation has a subrequest budget and this spends up to three per
 * session — the read is one for the batch, then an update and possibly a
 * storage delete each. 100 keeps a run comfortably inside it while clearing far
 * more than a day's worth of splits, so a backlog drains over a few nights
 * rather than needing a one-off script.
 */
const BATCH = 100;

/**
 * One session, redacted.
 *
 * Returns what happened rather than throwing, so the caller can count outcomes
 * and keep going. `image` is reported separately from `row` because a receipt
 * image that could not be deleted is the part of this that matters most — it is
 * the only one of the three that leaves personal data somewhere a URL still
 * reaches.
 */
export async function redactSession(env, svc, session) {
  const result = { id: session.id, image: 'none', row: 'pending' };

  const key = storageKeyFromUrl(session.image_url, BUCKET);
  if (key) {
    try {
      await deleteObject(env, BUCKET, key);
      result.image = 'deleted';
    } catch (error) {
      // Recorded and survived. The row is left un-redacted so tomorrow's run
      // tries the image again — marking it done here is how an undeleted
      // photograph of somebody's bill becomes permanent.
      result.image = 'failed';
      result.error = error?.message;
      return result;
    }
  } else if (session.image_url) {
    // A URL this project did not mint — a Base44 image on a migrated row. There
    // is nothing here that can delete it, and pretending otherwise would file
    // it as handled.
    result.image = 'foreign';
  }

  const participants = (session.participants || []).map((p) => ({
    ...p,
    name: REMOVED,
  }));

  // Claim lists cleared; the line items themselves stay. Which is the whole
  // distinction the policy draws — what was ordered is the host's record, who
  // ordered it is the guest's data.
  const items = (session.items || []).map((item) => ({ ...item, claimed_by: [] }));

  try {
    await svc.entity('Session').update(session.id, {
      participants,
      items,
      // Cleared so nothing links to an object that is no longer there, and so a
      // second run does not try to delete it again.
      image_url: null,
      redacted_at: Date.now(),
    });
    result.row = 'redacted';
  } catch (error) {
    result.row = 'failed';
    result.error = error?.message;
  }

  return result;
}

/**
 * The nightly pass. Called from the Worker's scheduled handler.
 *
 * Returns a summary rather than logging only, so the scheduled handler can put
 * one structured line in the tail and a test can assert on what happened.
 */
export async function scheduled(env) {
  // Same guard the backup uses. A preview deployment pointed at production's
  // database must not start deleting a live restaurant's receipts because
  // somebody pushed a branch.
  if (!mayRunScheduledWork(env)) {
    return { skipped: 'environment', environment: environmentName(env) };
  }

  // Storage lives in Supabase and the deletes above go straight at it. On the
  // Base44 backend the images are somewhere else entirely and the sessions are
  // not these rows, so this would redact nothing and delete nothing while
  // reporting a clean run.
  if (backendName(env) !== 'supabase') {
    return { skipped: 'backend', backend: backendName(env) };
  }

  const svc = serviceRole(env);
  if (!svc.queryOperators) return { skipped: 'query_operators' };

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const due = await svc.entity('Session').filter(
    { updated_date: { lt: cutoff }, redacted_at: { is: 'null' } },
    {
      // Only the columns the redaction rewrites. The rest of a session row is
      // items, totals and payment details, and pulling a hundred of them whole
      // to blank three fields is a nightly transfer nobody needs.
      select: 'id,image_url,participants,items',
      // Oldest first, so a backlog drains in the order it accrued and the
      // longest-overdue guest data is the first to go.
      order: 'updated_date',
      limit: BATCH,
    },
  );

  const summary = {
    considered: due.length,
    redacted: 0,
    images_deleted: 0,
    images_foreign: 0,
    failed: 0,
    batch_full: due.length === BATCH,
  };

  for (const session of due) {
    const outcome = await redactSession(env, svc, session);
    if (outcome.row === 'redacted') summary.redacted += 1;
    else summary.failed += 1;
    if (outcome.image === 'deleted') summary.images_deleted += 1;
    if (outcome.image === 'foreign') summary.images_foreign += 1;
  }

  return summary;
}
