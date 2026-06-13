import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const { session_id, participant_id, name, items, participants } = await req.json();

  if (!session_id || !participant_id) {
    return Response.json({ error: 'session_id and participant_id are required' }, { status: 400 });
  }

  // Validate name
  const cleanName = (name || '').trim().slice(0, 50);
  if (cleanName.length > 0 && cleanName.length < 2) {
    return Response.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
  }

  // Fetch current session via service role (guest has no auth token)
  const sessions = await base44.asServiceRole.entities.Session.filter({ id: session_id });
  const session = sessions[0];

  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

  // Check expiry
  if (session.expires_at && session.expires_at < Date.now()) {
    return Response.json({ error: 'Session has expired' }, { status: 410 });
  }

  const currentParticipants = session.participants || [];
  const alreadyIn = currentParticipants.find(p => p.participant_id === participant_id);

  let updatedParticipants;

  if (!alreadyIn) {
    // Add participant
    updatedParticipants = [
      ...currentParticipants,
      { participant_id, name: cleanName || 'Anonymous', amount_owed: 0, payment_status: 'unpaid' }
    ];
  } else if (cleanName && alreadyIn.name !== cleanName) {
    // Update name only
    updatedParticipants = currentParticipants.map(p =>
      p.participant_id === participant_id ? { ...p, name: cleanName } : p
    );
  } else {
    // Nothing to change
    return Response.json({ session });
  }

  const newStatus = session.status === 'waiting' ? 'claiming' : session.status;

  // If items/participants snapshot provided (claim update), validate and apply
  let updatePayload = { participants: updatedParticipants, status: newStatus };

  if (Array.isArray(items)) {
    // Validate item ownership — participant can only claim unclaimed items or their own
    for (const item of items) {
      const original = (session.items || []).find(i => i.id === item.id);
      if (!original) continue;
      const originalClaimed = original.claimed_by || [];
      const newClaimed = item.claimed_by || [];
      // Reject if someone else's item is being taken
      const stolenByOther = originalClaimed.some(id => id !== participant_id) && newClaimed.includes(participant_id) && !originalClaimed.includes(participant_id);
      if (stolenByOther) {
        return Response.json({ error: `Item "${item.name}" is already claimed` }, { status: 409 });
      }
    }
    updatePayload.items = items;
    if (Array.isArray(participants)) updatePayload.participants = participants;
  }

  const updated = await base44.asServiceRole.entities.Session.update(session_id, updatePayload);

  return Response.json({ session: updated });
});