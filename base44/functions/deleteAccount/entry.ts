import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all sessions created by this user
    const createdSessions = await base44.asServiceRole.entities.Session.filter({ created_by: user.email });

    // 2. Delete all sessions created by this user
    await Promise.all(createdSessions.map(session => 
      base44.asServiceRole.entities.Session.delete(session.id)
    ));

    // 3. Remove user from participant lists in remaining sessions
    const allSessions = await base44.asServiceRole.entities.Session.list();
    const sessionsWithUser = allSessions.filter(session =>
      session.participants?.some(p => p.participant_id?.includes(user.email) || p.participant_id?.includes(user.id))
    );

    await Promise.all(sessionsWithUser.map(session => {
      const updatedParticipants = (session.participants || []).filter(p => 
        !p.participant_id?.includes(user.email) && !p.participant_id?.includes(user.id)
      );
      return base44.asServiceRole.entities.Session.update(session.id, {
        participants: updatedParticipants
      });
    }));

    // Note: User account deletion is handled by Base44 platform
    // The user record itself remains (for audit/legal purposes) but the logout
    // effectively removes access. True account deletion would require
    // admin dashboard action or GDPR compliance workflow.

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
      { error: 'Failed to delete account. Please contact support.' },
      { status: 500 }
    );
  }
});