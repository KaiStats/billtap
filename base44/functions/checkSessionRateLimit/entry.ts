import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const recentSessions = await base44.entities.Session.filter({ 
      created_by_id: user.id, 
      created_date: { $gte: oneHourAgo.toString() } 
    });
    
    if (recentSessions.length >= 5) {
      return Response.json({ 
        allowed: false, 
        message: "You've created 5 sessions in the last hour. Please wait before creating more." 
      });
    }

    return Response.json({ allowed: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});