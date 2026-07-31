import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ALLOWED_ORIGINS = [
  'https://billtap.app',
  'https://www.billtap.app',
];

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function secureJson(data, status = 200, origin = null) {
  const headers = { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const headers = { ...NO_CACHE_HEADERS };
    if (ALLOWED_ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }
    return new Response(null, { status: 204, headers });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    const { title, image_url, items, tax, tip, split_mode, total_amount: customTotal, restaurant_slug } = await req.json();

    // Require authentication unless guest is creating a split from a table-tent QR (restaurant_slug)
    if (!user && !restaurant_slug) {
      return secureJson({ error: 'Unauthorized' }, 401, origin);
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      return secureJson({ error: 'title is required' }, 400, origin);
    }

    const validModes = ['itemized', 'even', 'custom'];
    const mode = split_mode || 'itemized';
    if (!validModes.includes(mode)) {
      return secureJson({ error: 'Invalid split mode' }, 400, origin);
    }

    if (mode === 'itemized' && (!Array.isArray(items) || items.length === 0)) {
      return secureJson({ error: 'items are required for itemized split' }, 400, origin);
    }

    // Validate total for even/custom
    if ((mode === 'even' || mode === 'custom') && customTotal !== undefined) {
      if (typeof customTotal !== 'number' || isNaN(customTotal) || customTotal <= 0 || customTotal > 10000) {
        return secureJson({ error: 'total_amount must be a positive number under $10,000' }, 400, origin);
      }
    }

    // Validate items
    for (const item of (items || [])) {
      if (!item.name || typeof item.name !== 'string') {
        return secureJson({ error: 'Each item must have a name' }, 400, origin);
      }
      if (typeof item.price !== 'number' || isNaN(item.price) || item.price < 0) {
        return secureJson({ error: `Invalid price for item: ${item.name}` }, 400, origin);
      }
      if (item.price > 10000) {
        return secureJson({ error: `Item price too high: ${item.name}` }, 400, origin);
      }
      const qty = item.quantity || 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
        return secureJson({ error: `Invalid quantity for item: ${item.name}` }, 400, origin);
      }
    }

    const taxVal = parseFloat(tax) || 0;
    const tipVal = parseFloat(tip) || 0;
    if (taxVal < 0 || tipVal < 0) {
      return secureJson({ error: 'tax and tip must be non-negative' }, 400, origin);
    }
    if (taxVal > 5000 || tipVal > 5000) {
      return secureJson({ error: 'tax or tip value is unreasonably large' }, 400, origin);
    }

    // Rate limit, by whichever identity this caller actually has.
    //
    // checkSessionRateLimit starts with `if (!user) return 401`, and a 401 body
    // carries no `allowed` key — so for an anonymous guest the check below was
    // always true and every table-tent split died on "Rate limit exceeded".
    // That is the guest half of the product, so the limiter cannot simply be
    // asked about a user who does not exist.
    //
    // Guests are still limited, just per restaurant instead of per account.
    // Skipping the limit entirely would leave an unauthenticated endpoint that
    // mints Session rows without bound.
    if (user) {
      const rateLimitRes = await base44.functions.invoke('checkSessionRateLimit', {});
      if (!rateLimitRes.data?.allowed) {
        return secureJson({ error: rateLimitRes.data?.message || 'Rate limit exceeded' }, 429, origin);
      }
    }

    let total;
    let processedItems = items || [];

    if (mode === 'itemized') {
      const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
      total = subtotal + taxVal + tipVal;
    } else {
      total = customTotal || (items || []).reduce((s, item) => s + (item.price * (item.quantity || 1)), 0) + taxVal + tipVal;
      processedItems = items || [];
    }

    if (total > 10000) {
      return secureJson({ error: 'Bill total cannot exceed $10,000' }, 400, origin);
    }

    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);

    // Derive the restaurant: either from slug (guest scanning table-tent QR) or from
    // authenticated owner (host creating their own split). Do NOT accept restaurant_id
    // from the client — that would allow attribution of ratings to arbitrary restaurants.
    let restaurantId = null;
    try {
      if (restaurant_slug) {
        // Guest scanned a table-tent QR. asServiceRole because Restaurant.read
        // is owner-scoped — a request-scoped filter here runs as nobody and
        // returns nothing, which would silently drop restaurant_id and with it
        // the rating capture the restaurant is paying for.
        const bySlug = await base44.asServiceRole.entities.Restaurant.filter({ slug: restaurant_slug });
        if (bySlug?.length) restaurantId = bySlug[0].id;
      } else if (user) {
        // Authenticated host: use their owned restaurant.
        const owned = await base44.asServiceRole.entities.Restaurant.filter({ owner_id: user.id });
        if (owned?.length) restaurantId = owned[0].id;
      }
    } catch (e) {
      console.error('createSession: restaurant lookup failed', e.message);
    }

    // Per-restaurant hourly cap for anonymous callers, standing in for the
    // per-account limit above. Generous enough for a full dining room turning
    // over, bounded enough that the endpoint is not a free row factory.
    if (!user && restaurantId) {
      const since = Date.now() - 60 * 60 * 1000;
      try {
        const recent = await base44.asServiceRole.entities.Session.filter({ restaurant_id: restaurantId });
        const inWindow = (recent || []).filter((s) => {
          const t = new Date(s.created_date).getTime();
          return !Number.isNaN(t) && t >= since;
        });
        if (inWindow.length >= 100) {
          return secureJson({ error: 'This restaurant has too many splits in progress. Try again shortly.' }, 429, origin);
        }
      } catch (e) {
        // A failed count must not block a paying restaurant's diners.
        console.error('createSession: guest rate-limit check failed', e.message);
      }
    }

    // Service role for the guest, request-scoped for a signed-in host.
    //
    // Session.jsonc requires created_by_id == {{user.id}} on create, so the
    // request-scoped client cannot write this row for someone with no account —
    // the second, independent reason the table-tent split failed even once the
    // rate limiter was out of the way. The host path stays request-scoped so
    // created_by_id is stamped with the real owner and the session shows up in
    // their dashboard.
    const writer = user ? base44.entities : base44.asServiceRole.entities;

    const session = await writer.Session.create({
      title: title.trim().slice(0, 100),
      image_url: image_url || null,
      split_mode: mode,
      total_amount: Math.round(total * 100) / 100,
      tax: Math.round(taxVal * 100) / 100,
      tip: Math.round(tipVal * 100) / 100,
      items: processedItems,
      participants: [],
      status: 'waiting',
      expires_at: expiresAt,
      ...(restaurantId ? { restaurant_id: restaurantId } : {}),
    });

    return secureJson({ session }, 200, origin);
  } catch (error) {
    console.error('createSession error:', error.message);
    return secureJson({ error: 'Internal server error' }, 500, origin);
  }
});