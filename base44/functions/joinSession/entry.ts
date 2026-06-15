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

    const { session_id, participant_id, name, items, participants } = await req.json();

    if (!session_id || typeof session_id !== 'string') {
      return secureJson({ error: 'session_id is required' }, 400, origin);
    }
    if (!participant_id || typeof participant_id !== 'string') {
      return secureJson({ error: 'participant_id is required' }, 400, origin);
    }

    // Sanitize participant_id — must look like our generated IDs, reject injections
    if (!/^p_\d+_[a-z0-9]+$/.test(participant_id)) {
      return secureJson({ error: 'Invalid participant_id format' }, 400, origin);
    }

    const cleanName = (name || '').trim().slice(0, 50);
    if (cleanName.length > 0 && cleanName.length < 2) {
      return secureJson({ error: 'Name must be at least 2 characters' }, 400, origin);
    }

    const sessions = await base44.asServiceRole.entities.Session.filter({ id: session_id });
    const session = sessions[0];

    if (!session) return secureJson({ error: 'Session not found' }, 404, origin);

    if (session.expires_at && session.expires_at < Date.now()) {
      return secureJson({ error: 'Session has expired' }, 410, origin);
    }

    const currentParticipants = session.participants || [];

    // Enforce participant cap (max 50)
    if (!currentParticipants.find(p => p.participant_id === participant_id) && currentParticipants.length >= 50) {
      return secureJson({ error: 'Session is full (max 50 participants)' }, 400, origin);
    }

    const alreadyIn = currentParticipants.find(p => p.participant_id === participant_id);
    const splitMode = session.split_mode || 'itemized';
    const totalAmount = session.total_amount || 0;

    let updatedParticipants;
    let amountOwed = 0;

    if (splitMode === 'even') {
      const newCount = alreadyIn ? currentParticipants.length : currentParticipants.length + 1;
      amountOwed = newCount > 0 ? Math.round((totalAmount / newCount) * 100) / 100 : 0;
    } else if (splitMode === 'custom') {
      amountOwed = 0;
    }

    if (!alreadyIn) {
      updatedParticipants = [
        ...currentParticipants,
        {
          participant_id,
          name: cleanName || 'Anonymous',
          amount_owed: amountOwed,
          payment_status: 'unpaid',
        }
      ];
      if (splitMode === 'even') {
        updatedParticipants = updatedParticipants.map(p => ({ ...p, amount_owed: amountOwed }));
      }
    } else if (cleanName && alreadyIn.name !== cleanName) {
      updatedParticipants = currentParticipants.map(p =>
        p.participant_id === participant_id ? { ...p, name: cleanName } : p
      );
    } else {
      // Return session data scoped to this participant only
      return secureJson({ session: scopeSessionForParticipant(session, participant_id) }, 200, origin);
    }

    const newStatus = session.status === 'waiting' ? 'claiming' : session.status;
    let updatePayload = { participants: updatedParticipants, status: newStatus };

    if (splitMode === 'itemized' && Array.isArray(items)) {
      // Validate item ownership — participant can only claim unclaimed items or their own
      for (const item of items) {
        const original = (session.items || []).find(i => i.id === item.id);
        if (!original) continue;
        const originalClaimed = original.claimed_by || [];
        const newClaimed = item.claimed_by || [];
        const stolenByOther = originalClaimed.some(id => id !== participant_id) &&
          newClaimed.includes(participant_id) &&
          !originalClaimed.includes(participant_id);
        if (stolenByOther) {
          return secureJson({ error: `Item "${item.name}" is already claimed` }, 409, origin);
        }
      }
      updatePayload.items = items;
      if (Array.isArray(participants)) updatePayload.participants = participants;
    }

    const updated = await base44.asServiceRole.entities.Session.update(session_id, updatePayload);

    return secureJson({ session: scopeSessionForParticipant(updated, participant_id) }, 200, origin);
  } catch (error) {
    console.error('joinSession error:', error.message);
    return secureJson({ error: 'Internal server error' }, 500, origin);
  }
});

// Scope session data: guests only see their own amounts + public session info
// They do NOT see other participants' amounts, payment methods, or host data
function scopeSessionForParticipant(session, participantId) {
  const participants = (session.participants || []).map(p => ({
    participant_id: p.participant_id,
    name: p.name,
    payment_status: p.payment_status,
    // Only include amount_owed for the requesting participant
    ...(p.participant_id === participantId ? { amount_owed: p.amount_owed } : {}),
  }));

  return {
    id: session.id,
    title: session.title,
    split_mode: session.split_mode,
    total_amount: session.total_amount,
    tax: session.tax,
    tip: session.tip,
    items: session.items,
    status: session.status,
    expires_at: session.expires_at,
    host_payment_info: session.host_payment_info,
    participants,
    // Never expose: created_by_id, image_url (large blob), custom_split_config (host-only)
  };
}