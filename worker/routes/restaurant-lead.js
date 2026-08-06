/**
 * POST /api/restaurant-lead
 *
 * Sends the "new restaurant lead" alert.
 *
 * This used to be the notification half of a pair: the browser wrote a
 * RestaurantLead row and then called here so somebody found out about it. The
 * row went to Base44, nothing writes one now, and so this is the lead in its
 * entirety. src/pages/Restaurants.jsx checks the status it returns rather than
 * firing and forgetting, because a failure here is now a restaurant that filled
 * in the form and never heard back.
 *
 * Bindings: POSTMARK_SERVER_TOKEN or RESEND_API_KEY (one required),
 * LEAD_NOTIFY_TO (default alerts@billtap.app), LEAD_NOTIFY_FROM (must be a
 * sender the chosen provider has verified).
 */
import { json, clean, esc, EMAIL_RE, sendEmail } from '../lib/email.js';
import { serviceRole, backendName } from '../lib/data.js';

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

  /**
   * The lead is stored before it is announced.
   *
   * The header above says this endpoint "is the lead in its entirety", which
   * made the mail provider a single point of failure for a business record: a
   * restaurant fills in the form, Postmark is down, they get a 502 asking them
   * to try again, and nothing anywhere has their details. restaurant_leads has
   * existed since migration 0001 and nothing has ever written a row to it.
   */
  let stored = false;
  if (backendName(env) === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await serviceRole(env).entity('RestaurantLead').create({
        restaurant_name: restaurantName,
        contact_name: contactName || null,
        email,
        phone: phone || null,
        locations: locations || null,
        source,
        created_at: Date.now(),
      });
      stored = true;
    } catch (error) {
      console.error(`restaurant-lead: could not store lead — ${error?.message}`);
    }
  }

  const result = await sendEmail(env, {
    to: env.LEAD_NOTIFY_TO || 'alerts@billtap.app',
    subject: `New restaurant lead — ${restaurantName}`,
    html,
    text,
    replyTo: email,
  });

  /**
   * A lead that was not delivered is not a lead.
   *
   * This returned 200 with `notified: false` and a reason in the body. The
   * header at the top of this file says the browser "checks the status it
   * returns rather than firing and forgetting, because a failure here is now a
   * restaurant that filled in the form and never heard back" — and
   * src/pages/Restaurants.jsx checks `res.ok` and nothing else. So with the
   * mail provider down, or with neither API key bound, the operator was shown
   * a confirmation, the alert went nowhere, and the one thing this endpoint
   * exists to do had silently not happened.
   *
   * 502 makes the failure reach the client's own error branch, which already
   * offers to try again. Deliberate non-delivery stays 200: outside production
   * the send is suppressed on purpose (see mayContactRealPeople), and a staging
   * form that reports a gateway error every time is a false alarm somebody
   * learns to ignore.
   */
  const delivered = result.ok || result.reason === 'suppressed_outside_production';

  /**
   * Now a total loss rather than an undelivered email. The 502 was right while
   * the email was the only record; with the row stored, "try again" sends a
   * restaurant back to a form whose contents are already safe.
   */
  if (!stored && !delivered) {
    return json(
      {
        ok: false,
        error: 'We could not pass that on right now. Please try again, or email hello@billtap.app.',
        // The reason is a fixed identifier from lib/email.js, not an upstream
        // message — a provider's rejection can name a sender domain.
        reason: result.reason,
      },
      502,
    );
  }

  return json({ ok: true, stored, notified: result.ok, ...(result.ok ? {} : { reason: result.reason }) });
}
