import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Monthly performance report — the flyer's "know exactly how your restaurant is
 * performing, no dashboards, no homework".
 *
 * Schedule this in Base44 for the 1st of each month. It reports the month that
 * just ended.
 *
 * This function does NOT send mail. It aggregates the numbers — which is the
 * one thing that needs data access — and hands them to Cloudflare, which sends
 * through Postmark from alerts@billtap.app. No email originates here.
 *
 * Requires REPORT_WEBHOOK_URL and REPORT_WEBHOOK_SECRET.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const webhookUrl = Deno.env.get('REPORT_WEBHOOK_URL');
    const webhookSecret = Deno.env.get('REPORT_WEBHOOK_SECRET');
    if (!webhookUrl || !webhookSecret) {
      return new Response(
        JSON.stringify({ error: 'REPORT_WEBHOOK_URL and REPORT_WEBHOOK_SECRET are required' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Window: the calendar month that just ended.
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const label = new Date(start).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });

    // Service role: a scheduled run has no signed-in user, so user-scoped
    // reads would come back empty.
    const svc = base44.asServiceRole.entities;

    const restaurants = await svc.Restaurant.list();
    const inWindow = (t?: number) => typeof t === 'number' && t >= start && t < end;

    const reports = [];
    for (const r of restaurants || []) {
      if (!r.alert_email) continue;

      const [allRatings, allContacts] = await Promise.all([
        svc.GuestRating.filter({ restaurant_id: r.id }),
        svc.GuestContact.filter({ restaurant_id: r.id }),
      ]);

      const ratings = (allRatings || []).filter((x) => inWindow(x.created_at));
      const newContacts = (allContacts || []).filter((x) => inWindow(x.first_seen));
      const n = ratings.length;

      reports.push({
        restaurant_name: r.name,
        to: r.alert_email,
        label,
        average: n ? Number((ratings.reduce((s, x) => s + (x.stars || 0), 0) / n).toFixed(1)) : null,
        ratings: n,
        routed: ratings.filter((x) => x.routed_to_google).length,
        caught: ratings.filter((x) => !x.routed_to_google).length,
        new_contacts: newContacts.length,
        list_size: (allContacts || []).length,
      });
    }

    if (reports.length === 0) {
      return new Response(JSON.stringify({ ok: true, window: label, sent: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Secret': webhookSecret },
      body: JSON.stringify({ window: label, reports }),
    });

    const detail = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('monthlyRestaurantReport: delivery webhook failed', res.status, JSON.stringify(detail));
      return new Response(JSON.stringify({ error: 'Delivery webhook failed', status: res.status }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, window: label, ...detail }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('monthlyRestaurantReport error:', error.message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
