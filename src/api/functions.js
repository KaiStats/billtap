/**
 * Call one of the app's own functions, at /api/fn/<name>.
 *
 * These used to be Base44 backend functions, reached through the SDK. Base44
 * blocks backend functions on this app's plan — every invoke came back with
 * "Functions are blocked - app owner lacks backend functions capability" — so
 * createSession, joinSession, verifyQRToken, generateQRSignature, markMePaid,
 * confirmPayment and the rest all failed, which is to say nothing the product
 * does actually worked. The marketing pages looked fine throughout because they
 * are prerendered and touch no API, which is exactly why it went unnoticed.
 *
 * The implementations live in worker/routes/functions.js. This used to be a
 * monkey-patch over the SDK's functions.invoke; the SDK is gone and this is the
 * whole of what was left of it.
 *
 * The return shape is deliberately unchanged: resolves to { data } and throws
 * on failure. Callers destructure res.data and several depend on the rejection
 * to reach their catch.
 */

// Relative rather than through the @ alias, so this module can be loaded by
// the tests without a bundler resolving paths for them.
import { accessToken } from '../lib/supabase.js';
import { getParticipantKey, rememberParticipantKey } from '../lib/participantKey.js';

export async function invoke(name, body = {}) {
  /**
   * The diner's own secret, attached here rather than at each call site.
   *
   * participant_id used to be the whole of the proof that a caller was a
   * particular diner, and every poll response publishes every participant's id
   * to the table — so one diner could read another's share, mark them as having
   * paid, or release their claims. worker/routes/functions.js now wants a key
   * alongside the id.
   *
   * Done in one place on purpose. Threading it through Claim.jsx, useLiveSplit,
   * Dashboard and the rest would mean six chances to forget it, and forgetting
   * it degrades quietly — the caller becomes a bystander rather than failing.
   */
  if (body?.session_id && body?.participant_id && body.participant_key === undefined) {
    const key = getParticipantKey(body.session_id, body.participant_id);
    if (key) body = { ...body, participant_key: key };
  }
  // Which rate-limit bucket this counts against, for the endpoints a whole
  // table hits at once. Not an identity claim — the Worker never trusts it for
  // anything else — but without it six diners on one restaurant wifi are a
  // single IP and a single bucket, and the limiter's first act in production
  // would be to 429 a paying customer's table. See worker/lib/rate-limit.js.
  const participant = body?.participant_id;
  const headers = { 'Content-Type': 'application/json' };
  if (typeof participant === 'string' && participant) {
    headers['X-BillTap-Participant'] = participant;
  }

  // The operator's Supabase session, when there is one.
  //
  // Sent on every call rather than a chosen list, because the Worker decides
  // what an identity is worth: currentUser() returning null is the ordinary
  // case and every handler already treats it as such. A signed-in operator who
  // also splits a bill as a diner is a real person, and withholding their token
  // on those calls would mean their own splits never appear in their dashboard.
  //
  // What must never happen is the reverse — a guest path that *requires* one.
  // Nothing here fails when the token is absent, and worker/api.test.mjs holds
  // that line for joinSession, markMePaid and getSplitStatus.
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/fn/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const error = new Error(data?.error || `Function ${name} failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  // joinSession hands the key back exactly once, the way createSession hands
  // back the host key. Kept here so no call site has to know it exists; missing
  // it would leave the diner unable to prove they are themselves on the very
  // next call.
  if (data?.participant_key && body?.session_id && body?.participant_id) {
    rememberParticipantKey(body.session_id, body.participant_id, data.participant_key);
  }

  return { data };
}
