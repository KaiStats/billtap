import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

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
 * `credentials: 'same-origin'` matters. The Worker resolves the caller's
 * identity by forwarding their cookie to Base44, so an invoke that drops
 * cookies is an invoke that arrives anonymous — and generateQRSignature and
 * getRestaurantDashboardData would 401 for a signed-in host.
 */
base44.functions.invoke = async function invokeViaWorker(name, body = {}) {
  const res = await fetch(`/api/fn/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
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
