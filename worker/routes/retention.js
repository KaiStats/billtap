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
import { deleteObject, storageKeyFromUrl, listObjects, publicObjectUrl } from '../lib/db.js';
import { mayRunScheduledWork, environmentName } from '../lib/environment.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

/** The bucket in supabase/migrations/0004_receipts_storage.sql. */
const BUCKET = 'receipts';

/**
 * What this app actually mints: a uuid, a dot, an extension.
 *
 * Both minting paths produce it — receiptObjectKey in src/lib/uploadReceipt.js
 * and createReceiptUpload in worker/routes/functions.js, which constrains the
 * extension to an allow-list. Neither can emit a quote, a comma or a paren,
 * which is the property the batched membership query below depends on.
 *
 * Anything in the bucket that does not match this was not created by this app.
 * Until migration 0007 removes the anonymous insert policy, that is a thing a
 * stranger can arrange.
 */
const MINTED_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;

/**
 * How many unrecognised keys get an individual query per run.
 *
 * In normal operation this is zero. The cap exists so that somebody uploading
 * ten thousand oddly-named objects cannot make the sweep spend the whole
 * invocation's subrequest budget looking at them.
 */
const UNMINTED_PER_RUN = 25;

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
 * Receipt images that belong to no split at all.
 *
 * ── Why the session sweep cannot find these ────────────────────────────────
 *
 * NewReceipt starts the upload the moment the photo is chosen, so it has the
 * whole review screen to finish rather than making the diner wait. If the split
 * is then never created — the diner backs out, the scan is wrong, the tab is
 * closed — the object stays in the bucket with no row anywhere referencing it.
 * There is no foreign key from storage to sessions, so redacting sessions walks
 * straight past it, however long it sits there.
 *
 * The only way to find one is from the other end: walk the bucket and ask the
 * database whether anything claims each key. That is what this does.
 *
 * ── The age gate is the whole safety of it ─────────────────────────────────
 *
 * An object uploaded ninety seconds ago has no session referencing it either —
 * because the diner is still on the review screen deciding. Deleting on
 * "unreferenced" alone would race the product and delete the photograph out
 * from under somebody mid-split.
 *
 * So an object is only a candidate once it is older than the retention window.
 * By then it is either orphaned or it belonged to a session that has itself
 * been redacted and had its image deleted already, and either way nothing that
 * is still in use can be caught by it.
 */
export async function sweepOrphans(env, svc, { limit = 200 } = {}) {
  const summary = { scanned: 0, candidates: 0, orphans_deleted: 0, failed: 0 };
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // Oldest first, so a page of recent uploads never crowds out the ones that
  // are actually due.
  const objects = await listObjects(env, BUCKET, { limit });
  summary.scanned = objects.length;

  const candidates = [];
  for (const object of objects) {
    const key = object?.name;
    if (!key) continue;
    const created = Date.parse(object.created_at || '');
    // An object we cannot date is one we cannot prove is old. Skipping costs it
    // a night; guessing costs somebody their receipt.
    if (!Number.isFinite(created)) continue;
    // Listed oldest first, so the first one inside the window ends the page.
    if (created > cutoffMs) break;
    candidates.push({ key, url: publicObjectUrl(env, BUCKET, key) });
  }
  summary.candidates = candidates.length;
  if (!candidates.length) return summary;

  /**
   * Which of these a session still claims.
   *
   * Ask the database rather than inferring. A session that still points at a
   * key is one whose own redaction has not run or did not finish, and deleting
   * its image first would leave a split showing a broken thumbnail rather than
   * no thumbnail.
   *
   * It has to be every session, not just the overdue ones: image_url is set at
   * creation and updated_date moves forward, so a split created forty days ago
   * and touched yesterday still displays a forty-day-old object. Checking only
   * old rows would delete the receipt out from under it.
   *
   * ── Why the keys are sorted before they are asked about ───────────────────
   *
   * This built one `image_url=in.("url1","url2",...)` by interpolating every
   * candidate's URL, and a candidate's URL contains the storage object's key.
   * Migration 0004's insert policy is `with check (bucket_id = 'receipts')` —
   * nothing constrains the key — so until 0007 is applied anyone can upload an
   * object called whatever they like.
   *
   * An object named `x")--` closes the quoted list early. Everything after it
   * stops being part of the list PostgREST parses, comes back absent from the
   * "still claimed" answer, and is deleted. Demonstrated end to end: a live
   * split, still open, lost the receipt image it was displaying, because
   * somebody had uploaded a file with a punctuation mark in its name.
   *
   * So membership is only ever asked in list form about keys this app minted —
   * a uuid and an extension, which cannot contain a quote, a comma or a paren.
   * Anything else is asked about with a plain `eq.`, where the value is a
   * single scalar that URLSearchParams percent-encodes whole and PostgREST
   * never parses for structure.
   */
  const minted = candidates.filter((c) => MINTED_KEY.test(c.key));
  const unminted = candidates.filter((c) => !MINTED_KEY.test(c.key));
  summary.unminted = unminted.length;

  const stillReferenced = new Set();

  if (minted.length) {
    const quoted = minted.map((c) => `"${c.url}"`).join(',');
    const claimed = await svc.entity('Session').filter(
      { image_url: { in: `(${quoted})` } },
      { select: 'image_url' },
    );
    for (const row of claimed) stillReferenced.add(row.image_url);
  }

  /**
   * The rest, one at a time.
   *
   * A key this app did not mint should not exist, and in normal operation none
   * do — so the cost of a query each is nothing, and the cap is only there so
   * that somebody uploading ten thousand of them cannot spend the invocation's
   * whole subrequest budget on the sweep.
   *
   * They are still checked rather than assumed orphaned. The reasoning that
   * they cannot be referenced — image_url is always built from a minted key —
   * is almost certainly true, and "almost certainly" is not the standard for
   * deleting a restaurant's receipt.
   */
  for (const candidate of unminted.slice(0, UNMINTED_PER_RUN)) {
    const rows = await svc.entity('Session').filter(
      { image_url: candidate.url },
      { select: 'image_url', limit: 1 },
    );
    if (rows.length) stillReferenced.add(candidate.url);
  }
  const checked = new Set([
    ...minted.map((c) => c.url),
    ...unminted.slice(0, UNMINTED_PER_RUN).map((c) => c.url),
  ]);

  for (const candidate of candidates) {
    // Never delete something this run did not get an answer about.
    if (!checked.has(candidate.url)) continue;
    if (stillReferenced.has(candidate.url)) continue;
    try {
      await deleteObject(env, BUCKET, candidate.key);
      summary.orphans_deleted += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(JSON.stringify({
        job: 'retention', step: 'orphan', key: candidate.key, message: error?.message,
      }));
    }
  }

  return summary;
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

  /**
   * Then the images no session ever claimed.
   *
   * After the session pass, not before: a split redacted a moment ago has just
   * had its image_url cleared, and sweeping first would ask the database about
   * keys the pass above is in the middle of releasing. Running second means
   * those objects are already gone, deleted by the session that owned them.
   *
   * Isolated in its own catch. The sweep walks a bucket listing and the pass
   * above rewrites guest names; a storage listing that fails must not be able
   * to report the redaction as unsuccessful when it was not.
   */
  try {
    summary.orphans = await sweepOrphans(env, svc);
  } catch (error) {
    summary.orphans = { error: error?.message || String(error) };
  }

  /**
   * And finally the error log, which has its own, longer clock.
   *
   * Ninety days rather than the thirty above, and the difference is not an
   * oversight: a session row holds what people ate and owed, so the sooner it
   * is redacted the better, while an error row holds a stack trace and a route
   * and is only useful in proportion to how far back it goes. The floor is
   * enforced in the database — prune_error_log raises rather than obeys if it
   * is ever called with less — so a well-meaning "clean this up" cannot quietly
   * put the app out of policy.
   *
   * Isolated, like the sweep above and for the same reason: this is the least
   * important thing the nightly job does and it must not be able to report the
   * redaction as failed.
   */
  try {
    summary.error_log_pruned = await pruneErrorLog(env);
  } catch (error) {
    summary.error_log_pruned = { error: error?.message || String(error) };
  }

  return summary;
}

/** Days of error log kept. The database refuses anything lower. */
export const ERROR_LOG_RETENTION_DAYS = 90;

/**
 * Calls the security-definer function rather than issuing a delete.
 *
 * A `delete` through PostgREST needs a filter, and a filter built here is a
 * filter that can be got wrong — the orphan sweep above already produced one
 * injection this way. The function takes an integer, checks it against the
 * policy floor, and owns the predicate itself.
 */
export async function pruneErrorLog(env) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'not_configured' };

  const res = await fetchWithTimeout(
    `${env.SUPABASE_URL}/rest/v1/rpc/prune_error_log`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ older_than_days: ERROR_LOG_RETENTION_DAYS }),
    },
    TIMEOUTS.database,
  );

  // Migration 0008 unapplied is the ordinary state of a fresh database, and it
  // is not a reason to fail the night's redaction.
  if (!res.ok) return { skipped: 'unavailable', status: res.status };
  return { removed: await res.json() };
}
