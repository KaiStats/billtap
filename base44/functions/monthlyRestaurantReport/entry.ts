import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Monthly performance report — the flyer's "know exactly how your restaurant is
 * performing, no dashboards, no homework".
 *
 * Schedule this in Base44 for the 1st of each month. It reports the month that
 * just ended for every restaurant with an alert_email.
 *
 * Requires RESEND_API_KEY and, optionally, REPORT_FROM (must be a
 * Resend-verified sender).
 */

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function sendEmail(apiKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 });
    }
    const from = Deno.env.get('REPORT_FROM') || 'BillTap <alerts@grandeza.io>';

    // Window: the calendar month that just ended.
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const label = new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const restaurants = await base44.entities.Restaurant.list();
    let sent = 0;
    const failures: string[] = [];

    for (const r of restaurants || []) {
      if (!r.alert_email) continue;

      const [allRatings, allContacts] = await Promise.all([
        base44.entities.GuestRating.filter({ restaurant_id: r.id }),
        base44.entities.GuestContact.filter({ restaurant_id: r.id }),
      ]);

      const inWindow = (t: number | undefined) => typeof t === 'number' && t >= start && t < end;
      const ratings = (allRatings || []).filter((x) => inWindow(x.created_at));
      const newContacts = (allContacts || []).filter((x) => inWindow(x.first_seen));

      const n = ratings.length;
      const avg = n ? ratings.reduce((s, x) => s + (x.stars || 0), 0) / n : 0;
      const routed = ratings.filter((x) => x.routed_to_google).length;
      const caught = ratings.filter((x) => !x.routed_to_google).length;

      const rows: [string, string][] = [
        ['Average rating', n ? `${avg.toFixed(1)} / 5` : 'No ratings yet'],
        ['Ratings collected', String(n)],
        ['Sent to Google', String(routed)],
        ['Caught before going public', String(caught)],
        ['New guest emails', String(newContacts.length)],
        ['Total list size', String((allContacts || []).length)],
      ];

      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:540px">
          <div style="background:#111827;border-radius:12px;padding:22px;margin-bottom:20px">
            <p style="margin:0 0 6px;color:#f0b429;font-size:12px;letter-spacing:.12em;text-transform:uppercase">${esc(label)}</p>
            <p style="margin:0;color:#fff;font-size:22px;font-weight:700">${esc(r.name)}</p>
          </div>
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
            ${rows.map(([k, v]) => `
              <tr>
                <td style="padding:11px 12px 11px 0;color:#666;border-bottom:1px solid #eee">${esc(k)}</td>
                <td style="padding:11px 0;font-weight:700;text-align:right;border-bottom:1px solid #eee">${esc(v)}</td>
              </tr>`).join('')}
          </table>
          <p style="margin:22px 0 0;color:#888;font-size:12px;line-height:1.6">
            ${caught > 0
              ? `${caught} unhappy guest${caught === 1 ? '' : 's'} reached you privately instead of Google this month.`
              : 'No low ratings this month.'}
          </p>
        </div>`;

      try {
        await sendEmail(apiKey, from, r.alert_email, `${r.name} — ${label} report`, html);
        sent++;
      } catch (e) {
        console.error(`monthlyRestaurantReport: ${r.name} failed`, e.message);
        failures.push(r.name);
      }
    }

    return new Response(JSON.stringify({ ok: true, window: label, sent, failures }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('monthlyRestaurantReport error:', error.message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
});
