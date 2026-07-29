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
    const { session_id, participant_id } = await req.json();

    if (!session_id || typeof session_id !== 'string') {
      return secureJson({ error: 'session_id is required' }, 400, origin);
    }
    if (!participant_id || typeof participant_id !== 'string') {
      return secureJson({ error: 'participant_id is required' }, 400, origin);
    }

    // Sanitize participant_id
    if (!/^p_\d+_[a-z0-9]+$/.test(participant_id)) {
      return secureJson({ error: 'Invalid participant_id format' }, 400, origin);
    }

    // Fetch session as service role to bypass RLS
    const sessions = await base44.asServiceRole.entities.Session.filter({ id: session_id });
    const session = sessions[0];

    if (!session) return secureJson({ error: 'Session not found' }, 404, origin);

    // Verify participant exists and belongs to this session
    const participant = (session.participants || []).find(p => p.participant_id === participant_id);
    if (!participant) return secureJson({ error: 'Participant not found in session' }, 404, origin);

    // Update participant payment status to pending_verification
    const updatedParticipants = (session.participants || []).map(p =>
      p.participant_id === participant_id
        ? { ...p, payment_status: 'pending_verification' }
        : p
    );

    // Check if all participants are paid
    const allPaid = updatedParticipants.every(p => p.payment_status === 'paid');
    const newStatus = allPaid ? 'completed' : session.status;

    // Update session as service role
    const updated = await base44.asServiceRole.entities.Session.update(session_id, {
      participants: updatedParticipants,
      status: newStatus,
    });

    // Return updated session with restaurant_id if present
    const response = {
      id: updated.id,
      title: updated.title,
      split_mode: updated.split_mode,
      total_amount: updated.total_amount,
      tax: updated.tax,
      tip: updated.tip,
      items: updated.items,
      status: updated.status,
      expires_at: updated.expires_at,
      host_payment_info: updated.host_payment_info,
      participants: (updated.participants || []).map(p => ({
        participant_id: p.participant_id,
        name: p.name,
        payment_status: p.payment_status,
        ...(p.participant_id === participant_id ? { amount_owed: p.amount_owed } : {}),
      })),
      ...(updated.restaurant_id ? { restaurant_id: updated.restaurant_id } : {}),
    };

    return secureJson({ session: response }, 200, origin);
  } catch (error) {
    console.error('markMePaid error:', error.message);
    return secureJson({ error: 'Internal server error' }, 500, origin);
  }
});
