/**
 * An append-only record of the actions that move money or expose people.
 *
 * ── What counts as sensitive here ───────────────────────────────────────────
 *
 * Not everything. A record of every request is a log, and this is not a log —
 * it is the answer to questions asked weeks later by someone who is upset.
 *
 *   "The host says I never paid, and I did."          → payment.confirm
 *   "Someone changed my split after we agreed it."    → split.settings_changed
 *   "Who could see my table's bill?"                  → split.host_access
 *   "Did anyone export our guest list?"               → guests.exported
 *   "Why did our subscription change?"                → billing.*
 *
 * Every one of those is a dispute between two people where the app is the only
 * witness. That is the test for adding an action here: if it went wrong, would
 * somebody's account of what happened be contested?
 *
 * ── What it must never do ───────────────────────────────────────────────────
 *
 * **Never block the thing it is recording.** Writing the audit row must not be
 * able to fail a payment confirmation. A trail that can take down the action it
 * observes is worse than no trail, and it will do so at exactly the busiest
 * moment. So every write is fire-and-forget through waitUntil, and a failure is
 * logged and swallowed. The trade is explicit and it is the right way round:
 * this app collects money at a table, and a lost audit row costs an argument
 * while a failed confirmation costs the meal.
 *
 * **Never store the secrets it is describing.** The host key proves who the
 * host is; writing it into a table that exists to be read later would hand
 * anyone with read access the ability to confirm payments. Only ever a hash
 * prefix, enough to tell two hosts apart and useless for anything else. Same
 * for emails: hashed, so "did this address appear" is answerable and the list
 * itself is not.
 *
 * **Never let the actor be self-declared.** participant_id arrives from the
 * browser and is not proof of anything. Recorded as a claim, labelled as one.
 * The host key and the signed-in user id are the two identities here that were
 * actually verified, and they are marked as such.
 */

import { fetchWithTimeout, TIMEOUTS } from './http.js';

const enc = new TextEncoder();

/** Actions worth being able to answer questions about, months later. */
export const ACTIONS = {
  SPLIT_CREATED: 'split.created',
  SPLIT_SETTINGS_CHANGED: 'split.settings_changed',
  SPLIT_HOST_ACCESS: 'split.host_access',
  SPLIT_CLAIMED: 'split.claimed',
  HOST_KEY_ISSUED: 'host_key.issued',
  HOST_KEY_REJECTED: 'host_key.rejected',
  PAYMENT_SELF_REPORTED: 'payment.self_reported',
  PAYMENT_CONFIRMED: 'payment.confirmed',
  PAYMENT_UNCONFIRMED: 'payment.unconfirmed',
  GUESTS_EXPORTED: 'guests.exported',
  RATING_SUBMITTED: 'rating.submitted',
  BILLING_CHECKOUT: 'billing.checkout_started',
  BILLING_ACTIVATED: 'billing.activated',
  // "Why is our QR pointing somewhere else" and "who changed where our alerts
  // go" are both disputes the operator cannot settle from the row itself: the
  // restaurant table keeps only the current value. These two are the record of
  // who moved it and when. The Google review URL in particular is a redirect
  // this app opens on a stranger's phone, so a change to it is worth a row.
  RESTAURANT_CREATED: 'restaurant.created',
  RESTAURANT_UPDATED: 'restaurant.updated',
  // A row that had no owner acquiring one, by the email match described in
  // supabase/migrations/0003. It is the moment a restaurant's guest list, its
  // review link and its alert address all become one account's to change, and
  // it happens without anyone pressing a button labelled that — so it is the
  // one an "who has access to our data" question ends up asking about.
  RESTAURANT_CLAIMED: 'restaurant.claimed',
  // Deliberately absent: auth.failed. Sign-in is still Base44's and moving to
  // Supabase, so there is no point in this codebase that sees a failed login.
  // Listing it would imply a coverage the code does not have — add it with the
  // auth migration, not before.
};

/**
 * A one-way, truncated fingerprint.
 *
 * Twelve hex characters of SHA-256. Enough to say "the same host as last time"
 * or "this address has appeared before"; not enough to be a lookup table for
 * anything, and irreversible either way. Applied to host keys, emails and IPs —
 * everything here that identifies a person or grants power.
 */
export async function fingerprint(value) {
  if (!value) return null;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value)));
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Values small enough and safe enough to keep alongside an action.
 *
 * An allow-list, not a redaction pass. Redaction fails open — the day someone
 * adds a field called `guest_note` it goes straight into the table, and nobody
 * finds out until it is being read back. This fails closed: a key nobody
 * listed is dropped.
 *
 * Amounts are here on purpose. "The host confirmed $23.40 for participant
 * p_17…" is the entire content of a payment dispute, and without the number the
 * row cannot settle one.
 */
const ALLOWED_DETAIL = new Set([
  'amount', 'previous_amount', 'currency', 'item_count', 'participant_count',
  'split_mode', 'previous_split_mode', 'status', 'previous_status',
  'reason', 'plan', 'previous_plan', 'stars', 'routed_to_google',
  'row_count', 'expired', 'verified_by',
  // The settings write. `slug` is the string printed on the table tents, so a
  // creation row without it cannot answer which restaurant it made; `fields` is
  // which columns a patch touched — the names only, never the values, because
  // alert_email and the review URL are among them.
  //
  // Both are here because this list fails closed. Adding the two actions above
  // without adding these would produce audit rows with an empty detail object:
  // a trail that records that something was changed and refuses to say what.
  'slug', 'fields',
]);

/** @returns {object} only the listed keys, with anything unprintable dropped */
export function safeDetail(detail = {}) {
  const out = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (!ALLOWED_DETAIL.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    out[key] = typeof value === 'string' ? value.slice(0, 120) : value;
  }
  return out;
}

/**
 * Build the row without writing it.
 *
 * Separated from the write so the shaping — which is where a secret would leak
 * — is testable without a database, and so a caller can assert on exactly what
 * would be stored.
 */
export async function auditRow({
  action,
  request,
  requestId: id = null,
  sessionId = null,
  restaurantId = null,
  actorUserId = null,
  actorHostKey = null,
  actorParticipantId = null,
  outcome = 'ok',
  detail = {},
}) {
  const ip = request?.headers?.get('CF-Connecting-IP') || null;

  return {
    action,
    at: new Date().toISOString(),
    request_id: id,
    session_id: sessionId,
    restaurant_id: restaurantId,

    // Three identities, and the difference between them is the point.
    //
    // A signed-in user id was verified against the auth provider. A host key
    // fingerprint was checked against the hash stored on the session. A
    // participant id is whatever the browser sent — it is how the app scopes a
    // diner's view, but it is a claim, and a row that blurred the three would
    // be evidence of nothing.
    actor_user_id: actorUserId,
    actor_host_key_fp: await fingerprint(actorHostKey),
    actor_participant_claim: actorParticipantId,

    // Truncated hash, not the address. Answers "was it the same source" without
    // storing a table of who ate where — which is what an IP column becomes
    // once it is a year old.
    source_ip_fp: await fingerprint(ip),
    user_agent: (request?.headers?.get('User-Agent') || '').slice(0, 200) || null,

    outcome,
    detail: safeDetail(detail),
  };
}

/**
 * Record an action. Never throws, never blocks, never fails the caller.
 *
 * `ctx.waitUntil` when one is available, so the response is not waiting on this
 * write. Without a ctx — a scheduled job, a test — it still awaits, because
 * dropping the row silently would be worse than the millisecond.
 */
export async function audit(env, ctx, entry) {
  try {
    const row = await auditRow(entry);

    // Always emit the line, whether or not the table write lands. Cloudflare's
    // log retention is short and a database is the durable home, but a
    // structured line costs nothing and is the only record that survives the
    // database itself being the thing that broke.
    console.log(JSON.stringify({ audit: true, ...row, detail: JSON.stringify(row.detail) }));

    const write = writeRow(env, row);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  } catch (error) {
    // Swallowed on purpose. See the header: this must not be able to fail the
    // action it is describing.
    console.error(JSON.stringify({ audit_failed: true, action: entry?.action, message: error?.message }));
  }
}

/**
 * The insert itself.
 *
 * Straight to PostgREST rather than through db.js, because db.js throws on a
 * non-2xx and this must not — and because the audit table is the one place that
 * should never accidentally acquire an update or a delete path. Insert is all
 * it can do from here.
 */
async function writeRow(env, row) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  // Not configured yet is not an error: the Supabase migration is not finished,
  // and until it is, the console line above is the trail. Failing here would
  // break every function in the app for the sake of bookkeeping.
  if (!url || !key) return;

  try {
    const res = await fetchWithTimeout(`${String(url).replace(/\/+$/, '')}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    }, TIMEOUTS.audit);
    if (!res.ok) {
      console.error(JSON.stringify({ audit_failed: true, status: res.status, body: (await res.text()).slice(0, 200) }));
    }
  } catch (error) {
    console.error(JSON.stringify({ audit_failed: true, message: error?.message }));
  }
}
