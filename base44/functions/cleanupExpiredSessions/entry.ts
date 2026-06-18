import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Purges PII (guest names, claim data) from sessions that settled >30 days ago.
// Runs on a schedule. Admin-only via automation (no user auth required for scheduled calls).

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow scheduled automation (no user) or admin users only
  let user = null;
  try { user = await base44.auth.me(); } catch (_) { /* scheduled — no session */ }
  if (user && user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Fetch completed sessions (cap at 500 per run — re-run if more)
  const sessions = await base44.asServiceRole.entities.Session.filter({ status: 'completed' }, '-updated_date', 500);

  let purged = 0;
  let skipped = 0;

  for (const session of sessions) {
    // Determine settlement date: use expires_at if set, otherwise fall back to updated_date timestamp
    const settledAt = session.expires_at
      ? session.expires_at - 30 * 24 * 60 * 60 * 1000  // expires_at = created + 30d, so settled ≈ creation
      : new Date(session.updated_date).getTime();

    // Use updated_date as the proxy for "settled at" — purge if updated >30 days ago
    const updatedAt = new Date(session.updated_date).getTime();

    if (updatedAt > thirtyDaysAgo) {
      skipped++;
      continue;
    }

    // Check if already purged
    const alreadyPurged = session.participants?.every(p => !p.name || p.name === '[removed]');
    if (alreadyPurged) {
      skipped++;
      continue;
    }

    // Scrub PII: anonymize participant names, clear claim data from items
    const scrubbedParticipants = (session.participants || []).map(p => ({
      participant_id: '[removed]',
      name: '[removed]',
      amount_owed: p.amount_owed,
      payment_status: p.payment_status,
    }));

    const scrubbedItems = (session.items || []).map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      claimed_by: [], // clear all claim associations
    }));

    await base44.asServiceRole.entities.Session.update(session.id, {
      participants: scrubbedParticipants,
      items: scrubbedItems,
      image_url: null, // remove receipt image (may contain PII)
    });

    purged++;
  }

  console.log(`PII cleanup complete. Purged: ${purged}, Skipped: ${skipped}`);
  return Response.json({ purged, skipped, ran_at: new Date().toISOString() });
});