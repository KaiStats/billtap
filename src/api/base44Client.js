import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { accessToken } from '@/lib/supabase';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

/**
 * Point functions.invoke() at the Worker instead of Base44.
 *
 * Base44 blocks backend functions on this app's plan — every invoke came back
 * with "Functions are blocked - app owner lacks backend functions capability".
 * That is not one feature degraded, it is nine: createSession, joinSession,
 * verifyQRToken, generateQRSignature, markMePaid, validateReceiptParse and the
 * three guest-data functions. Creating a split, joining one, scanning a QR and
 * paying all ran through them, so nothing the product does actually worked. The
 * marketing pages looked fine throughout because they are prerendered and touch
 * no API, which is exactly why it went unnoticed.
 *
 * The implementations now live in worker/routes/functions.js and answer at
 * /api/fn/<name>. Overriding the method here rather than rewriting every call
 * site means the ~20 invoke() calls across the app are untouched, and switching
 * back is deleting this block.
 *
 * The SDK resolves to { data } and throws on failure, so this matches both:
 * callers already destructure res.data, and several rely on a rejection to hit
 * their catch.
 *
 * Identity travels as a bearer token now, not a cookie. The Worker verifies it
 * against Supabase — see currentUser() in worker/lib/db.js. The old
 * `credentials: 'same-origin'` existed because the Worker forwarded the
 * caller's Base44 cookie; there is no such cookie any more, and sending
 * credentials to an endpoint that ignores them is a habit worth not keeping.
 */
base44.functions.invoke = async function invokeViaWorker(name, body = {}) {
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

  return { data };
};
