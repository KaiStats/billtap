/**
 * POST /api/restaurant-lead
 *
 * Cloudflare Pages Function. Sends the "new restaurant lead" alert email.
 *
 * The lead row itself is written from the browser (see src/pages/Restaurants.jsx),
 * the same way the existing Waitlist capture works. This endpoint is the
 * notification half only, because the Resend API key must never reach the client.
 *
 * Required binding:
 *   RESEND_API_KEY   Resend API key with send permission
 *
 * Optional bindings (defaults shown):
 *   LEAD_NOTIFY_TO    alerts@billtap.app
 *   LEAD_NOTIFY_FROM  BillTap Leads <leads@grandeza.io>
 *
 * LEAD_NOTIFY_FROM must be on a domain verified in Resend. As of this commit
 * only grandeza.io is verified, so that is the default sender. Once billtap.app
 * is verified, set LEAD_NOTIFY_FROM to an address on it and nothing else changes.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 4096;

/** Trim, collapse whitespace, and cap length. Returns '' for non-strings. */
const clean = (value, max) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/** Escape for interpolation into the HTML email body. */
const esc = (s) =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Honeypot: real operators never fill a hidden field. Accept silently so bots
  // do not learn they were caught, but send nothing.
  if (clean(body.company_website, 200)) return json({ ok: true });

  const restaurantName = clean(body.restaurant_name, 120);
  const contactName = clean(body.contact_name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 40);
  const locations = clean(body.locations, 20);
  const source = clean(body.source, 60) || 'restaurants_page';

  if (!restaurantName) return json({ error: 'Restaurant name is required' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400);

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    // The lead is already saved client-side; surface the misconfiguration
    // without failing the visitor's submission.
    console.error('restaurant-lead: RESEND_API_KEY is not configured');
    return json({ ok: true, notified: false, reason: 'email_not_configured' });
  }

  const to = env.LEAD_NOTIFY_TO || 'alerts@billtap.app';
  const from = env.LEAD_NOTIFY_FROM || 'BillTap Leads <leads@grandeza.io>';

  const rows = [
    ['Restaurant', restaurantName],
    ['Contact', contactName || '—'],
    ['Email', email],
    ['Phone', phone || '—'],
    ['Locations', locations || '—'],
    ['Source', source],
  ];

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px;font-size:18px">New restaurant lead</h2>
      <p style="margin:0 0 16px;color:#666;font-size:13px">${esc(restaurantName)} requested a BillTap pilot.</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows.map(([label, value]) => `
          <tr>
            <td style="padding:8px 12px 8px 0;color:#888;white-space:nowrap;vertical-align:top">${esc(label)}</td>
            <td style="padding:8px 0;font-weight:600">${esc(value)}</td>
          </tr>`).join('')}
      </table>
      <p style="margin:20px 0 0;font-size:13px">
        <a href="mailto:${encodeURIComponent(email)}" style="color:#00a67a">Reply to ${esc(restaurantName)}</a>
      </p>
    </div>`;

  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `New restaurant lead — ${restaurantName}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('restaurant-lead: Resend rejected the send', res.status, detail);
      return json({ ok: true, notified: false, reason: 'email_send_failed' });
    }
  } catch (err) {
    console.error('restaurant-lead: Resend request threw', err?.message);
    return json({ ok: true, notified: false, reason: 'email_send_failed' });
  }

  return json({ ok: true, notified: true });
}
