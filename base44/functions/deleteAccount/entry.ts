import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all sessions created by this user (correct field: created_by_id)
    const createdSessions = await base44.asServiceRole.entities.Session.filter({ created_by_id: user.id });

    // 2. Delete all sessions created by this user
    await Promise.all(createdSessions.map(session =>
      base44.asServiceRole.entities.Session.delete(session.id)
    ));

    // 3. Remove user from participant lists in remaining sessions
    //    Filter sessions where this user is a participant (by participant_id pattern)
    const allSessions = await base44.asServiceRole.entities.Session.list('-created_date', 200);
    const sessionsWithUser = allSessions.filter(session =>
      session.participants?.some(p => p.participant_id === user.id)
    );

    await Promise.all(sessionsWithUser.map(session => {
      const updatedParticipants = (session.participants || []).filter(p =>
        p.participant_id !== user.id
      );
      return base44.asServiceRole.entities.Session.update(session.id, {
        participants: updatedParticipants
      });
    }));

    return Response.json({
      success: true,
      message: 'Account deletion initiated. You have been logged out.',
      deleted: {
        sessionsCreated: createdSessions.length,
        sessionsUpdated: sessionsWithUser.length
      }
    });

  } catch (error) {
    console.error('Delete account error:', error);
    return Response.json(
      { error: 'Failed to delete account. Please try again or contact support.' },
      { status: 500 }
    );
  }
});