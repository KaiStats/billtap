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
      /**
       * The server's name goes with the guests' names.
       *
       * A named person, read off the receipt by the scan — see migration 0015.
       * The restaurant's own employee rather than a guest, so the published
       * policy does not name it, but the reason the policy exists applies
       * unchanged: it is useful for the twenty minutes after a bad rating,
       * when a manager is deciding who to talk to, and after that it is a
       * record of who was working when something went wrong, kept for years,
       * serving nobody.
       *
       * ticket_table and ticket_number are deliberately kept. They identify a
       * piece of furniture and a POS record, not a person, and they belong to
       * the host's own account of the bill exactly as the line items do.
       */
      ticket_server: null,
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
 * Demo pages per run.
 *
 * A day's door-knocking is tens of these, not hundreds, and each one costs
 * three deletes plus the read. Bounded like everything else here so a backlog
 * drains over a few nights rather than spending a whole invocation's subrequest
 * budget in one go.
 */
const DEMO_BATCH = 50;

/**
 * Expired demo pages, deleted outright — the rows and everything hanging off
 * them.
 *
 * ── Why this is a hard delete when nothing else here is ────────────────────
 *
 * The rest of this file redacts. The argument for that is at the top: guest
 * data is the restaurant's, it cannot be recovered once refused, and a
 * redacted session still tells its host what their meal cost. Every clause of
 * that reasoning points the other way here.
 *
 * This data belongs to nobody. A demo's ratings are stars the operator tapped
 * himself to make a phone buzz in front of a prospect, on a restaurant that
 * never signed up. There is no host whose record this is, no guest whose
 * privacy is at stake, and nobody who could ever want it back.
 *
 * And keeping it costs something specific: it pollutes exactly the numbers this
 * product is sold on. "Ratings collected", "caught before going public", the
 * average — all of it would slowly fill with a salesman's own taps. A metric
 * that quietly counts its own demos is worse than no metric, because it is
 * still quoted.
 *
 * ── Children first, even though the database would do it ───────────────────
 *
 * Migration 0001 declares guest_ratings.restaurant_id and
 * guest_contacts.restaurant_id `on delete cascade`, so deleting the restaurant
 * alone would take both with it. The cascade is the guarantee; these two calls
 * are not. They exist for the count — `deleted: 12` on its own says nothing
 * about whether a demo's ratings really went, and this is a hard delete, which
 * is the kind of job whose log line has to be worth believing.
 *
 * Doing them first is what makes that ordering safe rather than merely tidy: a
 * child delete that fails leaves the restaurant row behind, still expired, so
 * tomorrow's run tries the whole thing again. The reverse order would leave
 * rows whose only handle was the row that just went.
 *
 * `sessions.restaurant_id` is `on delete set null`, deliberately not touched
 * here. Those are real splits, made on real phones during the demo — a receipt
 * somebody photographed — and they are the diner's, not the demo's. They lose
 * the pointer and are then redacted on the ordinary thirty-day clock like any
 * other split.
 *
 * Failures are recorded and survived, like everything else in this file. One
 * demo whose delete loses a race must not stop the other forty-nine.
 */
export async function sweepExpiredDemos(env, svc, { now = Date.now(), limit = DEMO_BATCH } = {}) {
  const summary = { considered: 0, deleted: 0, skipped: 0, ratings_deleted: 0, contacts_deleted: 0, failed: 0 };

  const due = await svc.entity('Restaurant').filter(
    { demo: true, demo_expires_at: { lt: now } },
    {
      select: 'id,slug,demo_expires_at',
      // Oldest expiry first, so a backlog drains in the order it accrued and
      // the page that has been up longest is the first to come down.
      order: 'demo_expires_at',
      limit,
    },
  );
  summary.considered = due.length;

  for (const demo of due) {
    try {
      summary.ratings_deleted += await deleteChildren(env, 'guest_ratings', demo.id);
      summary.contacts_deleted += await deleteChildren(env, 'guest_contacts', demo.id);
      /**
       * The count Postgres reported, not an assumption that the call worked.
       *
       * deleteRestaurant carries a `demo=eq.true` predicate on purpose, so an
       * id that has stopped being a demo since it was read matches nothing and
       * comes back zero — which is exactly what happens when a prospect signs
       * on the spot and the flag is cleared by hand. Adding 1 regardless
       * reported a hard delete that had not happened, on a row still due, which
       * would then be picked up and re-reported every night thereafter.
       *
       * This function's own header is the standard being met here: `deleted: 12`
       * on its own has to be worth believing. The child counts were already
       * taken from their return values; the row that names the business was the
       * one that was not.
       */
      const removed = await deleteRestaurant(env, demo.id);
      summary.deleted += removed;
      if (!removed) summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(JSON.stringify({
        job: 'retention', step: 'demo', restaurant_id: demo.id, message: error?.message,
      }));
    }
  }

  return summary;
}

/**
 * Straight to PostgREST, because db.js has no delete.
 *
 * That absence is deliberate and worth keeping — see worker/lib/db.js, whose
 * whole interface is the four operations the business functions use. Adding a
 * general `delete()` there to serve one nightly job would put a delete within
 * reach of every handler in functions.js, which is a much larger change than
 * this needs.
 *
 * The filter is two scalars sent as query parameters, which URLSearchParams
 * percent-encodes and PostgREST never parses for structure — the property the
 * orphan sweep above learned the hard way. `Prefer: return=representation` so
 * the count is what the database actually removed rather than what we hoped.
 */
async function deleteWhere(env, table, params) {
  const res = await fetchWithTimeout(
    `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/${table}?${params}`,
    {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=representation',
      },
    },
    TIMEOUTS.database,
  );
  if (!res.ok) throw new Error(`${table} delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

function deleteChildren(env, table, restaurantId) {
  const params = new URLSearchParams();
  params.append('restaurant_id', `eq.${restaurantId}`);
  return deleteWhere(env, table, params);
}

/**
 * The restaurant row, and only if it is still a demo.
 *
 * `demo=eq.true` is on the delete itself rather than trusted from the read
 * above. It is the difference between a bug in this file and a deleted
 * restaurant: the predicate that decides what is disposable is evaluated by
 * Postgres at the moment of the delete, so an id that has somehow stopped being
 * a demo since it was read matches nothing and comes back as zero rows.
 */
function deleteRestaurant(env, restaurantId) {
  const params = new URLSearchParams();
  params.append('id', `eq.${restaurantId}`);
  params.append('demo', 'eq.true');
  return deleteWhere(env, 'restaurants', params);
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
   * Then the demo pages whose day is up.
   *
   * Isolated in its own catch, like the sweep above and for the same reason:
   * this deletes rows nobody owns, and it must not be able to report the guest
   * redaction — which is the thing a published policy promises — as failed.
   *
   * After the session pass rather than before, so a demo's splits have already
   * had their receipt images dealt with by the code that knows how. The rows
   * themselves go here.
   */
  try {
    summary.demos = await sweepExpiredDemos(env, svc);
  } catch (error) {
    summary.demos = { error: error?.message || String(error) };
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
