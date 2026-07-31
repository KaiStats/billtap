/**
 * POST /api/rating-alert
 *
 * Pages the operator the moment a guest leaves a low rating, while that guest
 * is still in the building. Lookup the rating by ID to validate ownership and
 * fetch the restaurant's contact info server-side, preventing spam.
 *
 * Requires: rating_id (UUID of the GuestRating record)
 * Bindings: BASE44_APP_ID, BASE44_MASTER_KEY (for service-role lookups),
 *           POSTMARK_SERVER_TOKEN or RESEND_API_KEY, TWILIO_* for SMS.
 */
import { json, clean, esc, EMAIL_RE, sendEmail, sendSms } from '../lib/email.js';

const MAX_BODY_BYTES = 512;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const ratingId = body.rating_id;
  if (!ratingId || typeof ratingId !== 'string') {
    return json({ error: 'rating_id is required' }, 400);
  }

  try {
    // Fetch rating as service role — this also validates it exists
    const { VITE_BASE44_APP_ID: appId, BASE44_MASTER_KEY } = env;
    if (!appId || !BASE44_MASTER_KEY) {
      console.error('Missing BASE44 credentials for rating lookup');
      return json({ error: 'Service misconfigured' }, 500);
    }

    // Call Base44 API with service-role auth to fetch the rating
    const ratingResp = await fetch(
      `https://api.base44.com/v0/apps/${appId}/entities/GuestRating/${ratingId}`,
      {
        headers: {
          'Authorization': `Bearer ${BASE44_MASTER_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!ratingResp.ok) {
      if (ratingResp.status === 404) return json({ error: 'Rating not found' }, 404);
      console.error(`Rating fetch failed: ${ratingResp.status}`);
      return json({ error: 'Service error' }, 500);
    }

    const { data: rating } = await ratingResp.json();
    if (!rating || !rating.restaurant_id) {
      return json({ error: 'Invalid rating' }, 400);
    }

    // Fetch restaurant to get contact info
    const restaurantResp = await fetch(
      `https://api.base44.com/v0/apps/${appId}/entities/Restaurant/${rating.restaurant_id}`,
      {
        headers: {
          'Authorization': `Bearer ${BASE44_MASTER_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!restaurantResp.ok) {
      console.error(`Restaurant fetch failed: ${restaurantResp.status}`);
      return json({ error: 'Restaurant not found' }, 404);
    }

    const { data: restaurant } = await restaurantResp.json();
    if (!restaurant || !restaurant.alert_email) {
      return json({ error: 'Restaurant has no alert contact' }, 400);
    }

    const stars = Math.round(rating.stars);
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      return json({ error: 'Invalid rating stars' }, 400);
    }

    const restaurantName = clean(restaurant.name, 120) || 'Your restaurant';
    const comment = clean(rating.comment, 1500);
    const guestEmail = clean(rating.guest_email || '', 200).toLowerCase();
    const alertPhone = clean(restaurant.alert_phone || '', 40);

    const when = new Date().toLocaleString('en-US', {
      timeZone: env.RESTAURANT_TZ || 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
        <div style="background:#111827;border-radius:12px;padding:20px;margin-bottom:18px">
          <p style="margin:0 0 6px;color:#f0b429;font-size:12px;letter-spacing:.12em;text-transform:uppercase">
            Unhappy guest — still on site
          </p>
          <p style="margin:0;color:#fff;font-size:26px;font-weight:700">
            ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}
            <span style="font-size:15px;font-weight:400;color:#9ca3af"> &nbsp;${stars} of 5</span>
          </p>
        </div>
        <p style="margin:0 0 4px;font-size:14px"><strong>${esc(restaurantName)}</strong> · ${esc(when)}</p>
        ${comment
          ? `<blockquote style="margin:14px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #f0b429;font-size:14px;line-height:1.55">${esc(comment)}</blockquote>`
          : `<p style="margin:14px 0;color:#888;font-size:14px">No comment left.</p>`}
        ${guestEmail
          ? `<p style="margin:14px 0 0;font-size:14px">Guest: <a href="mailto:${encodeURIComponent(guestEmail)}" style="color:#00a67a">${esc(guestEmail)}</a> — reaching out now is usually what saves it.</p>`
          : `<p style="margin:14px 0 0;color:#888;font-size:14px">Guest left no email.</p>`}
      </div>`;

    const text = [
      `${stars}/5 — ${restaurantName} (${when})`,
      comment ? `\n"${comment}"` : '\nNo comment left.',
      guestEmail ? `\nGuest: ${guestEmail}` : '\nNo guest email.',
    ].join('');

    const smsBody = [
      `${stars}★ at ${restaurantName}`,
      comment ? `"${comment.slice(0, 140)}"` : 'No comment.',
      guestEmail ? `Reply: ${guestEmail}` : 'No guest email.',
    ].join(' — ');

    // Email and SMS in parallel
    const [emailResult, smsResult] = await Promise.all([
      sendEmail(env, {
        to: restaurant.alert_email,
        subject: `⚠︎ ${stars}-star rating at ${restaurantName}`,
        html,
        text,
        replyTo: EMAIL_RE.test(guestEmail) ? guestEmail : undefined,
      }),
      alertPhone ? sendSms(env, { to: alertPhone, body: smsBody }) : { ok: false },
    ]);

    return json({
      ok: true,
      notified: emailResult.ok,
      texted: smsResult.ok,
      ...(emailResult.ok ? {} : { reason: emailResult.reason }),
      ...(smsResult.ok ? {} : { sms_reason: smsResult.reason }),
    });
  } catch (error) {
    console.error('rating-alert error:', error.message);
    return json({ error: 'Internal server error' }, 500);
  }
}
