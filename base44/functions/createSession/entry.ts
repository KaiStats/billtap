import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, image_url, items, tax, tip, split_mode, total_amount: customTotal } = await req.json();

  // Validate inputs
  if (!title) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }

  // For even/custom modes, total_amount can be provided directly
  const validModes = ['itemized', 'even', 'custom'];
  const mode = split_mode || 'itemized';
  if (!validModes.includes(mode)) {
    return Response.json({ error: 'Invalid split mode' }, { status: 400 });
  }

  // Itemized mode requires items array
  if (mode === 'itemized' && (!Array.isArray(items) || items.length === 0)) {
    return Response.json({ error: 'items are required for itemized split' }, { status: 400 });
  }

  // Validate items
  for (const item of items) {
    if (!item.name || typeof item.price !== 'number' || item.price < 0) {
      return Response.json({ error: `Invalid item: ${JSON.stringify(item)}` }, { status: 400 });
    }
    if (item.price > 10000) {
      return Response.json({ error: `Item price too high: ${item.name}` }, { status: 400 });
    }
  }

  if ((tax || 0) < 0 || (tip || 0) < 0) {
    return Response.json({ error: 'tax and tip must be non-negative' }, { status: 400 });
  }

  // Check rate limit
  const rateLimitRes = await base44.functions.invoke('checkSessionRateLimit', {});
  if (!rateLimitRes.allowed) {
    return Response.json({ error: rateLimitRes.message || 'Rate limit exceeded' }, { status: 429 });
  }

  // Compute total server-side
  let total;
  let processedItems = items || [];

  if (mode === 'itemized') {
    const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
    total = subtotal + (tax || 0) + (tip || 0);
  } else {
    // even or custom mode - use provided total or calculate from items
    total = customTotal || (items || []).reduce((s, item) => s + (item.price * (item.quantity || 1)), 0) + (tax || 0) + (tip || 0);
    // For even/custom, items are optional metadata
    processedItems = items || [];
  }

  // Set expiry server-side (30 days)
  const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);

  const session = await base44.entities.Session.create({
    title: title.trim().slice(0, 100),
    image_url: image_url || null,
    split_mode: mode,
    total_amount: Math.round(total * 100) / 100,
    tax: Math.round((tax || 0) * 100) / 100,
    tip: Math.round((tip || 0) * 100) / 100,
    items: processedItems,
    participants: [],
    status: 'waiting',
    expires_at: expiresAt,
  });

  return Response.json({ session });
});