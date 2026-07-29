/**
 * Proxy /api/apps/** through to Base44.
 *
 * src/api/base44Client.js constructs the SDK with `serverUrl: ''`, so every
 * entity, auth and function call is issued same-origin as /api/apps/<appId>/...
 * That works when Base44 itself serves the app. On Cloudflare Pages there is no
 * such route, so without this every read and write in the app — the consumer
 * bill-splitter included — would 404.
 *
 * Proxying rather than pointing the SDK at https://base44.app keeps the requests
 * same-origin, so nothing depends on Base44's CORS policy for the billtap.app
 * origin, and cookie-based auth keeps working.
 *
 * Scoped deliberately to /api/apps/** — the shape Base44 uses — so it can never
 * shadow this app's own endpoints (/api/restaurant-lead, /api/rating-alert,
 * /api/create-checkout, /api/verify-checkout, /api/monthly-report).
 *
 * Optional binding: BASE44_API_ORIGIN (defaults to https://base44.app).
 */

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
]);

export async function onRequest({ request, env, params }) {
  const origin = (env.BASE44_API_ORIGIN || 'https://base44.app').replace(/\/+$/, '');

  // params.path is the wildcard segments after /api/apps/
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const suffix = segments.map(encodeURIComponent).join('/');
  const incoming = new URL(request.url);
  const target = `${origin}/api/apps/${suffix}${incoming.search}`;

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'host') headers.set(k, v);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      // GET/HEAD must not carry a body, and Workers reject it if they do.
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const outHeaders = new Headers();
    for (const [k, v] of upstream.headers) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders.set(k, v);
    }
    // Responses carry user data — never let an intermediary hold on to them.
    outHeaders.set('Cache-Control', 'no-store');

    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (err) {
    console.error('base44 proxy: upstream request failed', err?.message);
    return new Response(JSON.stringify({ error: 'Upstream unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
