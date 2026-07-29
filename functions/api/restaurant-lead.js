/**
 * POST /api/restaurant-lead
 *
 * Sends the "new restaurant lead" alert. The lead row itself is written from the
 * browser (see src/pages/Restaurants.jsx) the same way the Waitlist capture
 * works; this endpoint is the notification half only, because the Resend API key
 * must never reach the client.
 *
 * Bindings: RESEND_API_KEY (required), LEAD_NOTIFY_TO (default
 * alerts@billtap.app), LEAD_NOTIFY_FROM (must be a Resend-verified sender).
 */
import { json, clean, esc, EMAIL_RE, sendEmail } from '../_lib/email.js';

const MAX_BODY_BYTES = 4096;

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

  const result = await sendEmail(env, {
    to: env.LEAD_NOTIFY_TO || 'alerts@billtap.app',
    subject: `New restaurant lead — ${restaurantName}`,
    html,
    text,
    replyTo: email,
  });

  return json({ ok: true, notified: result.ok, ...(result.ok ? {} : { reason: result.reason }) });
}
