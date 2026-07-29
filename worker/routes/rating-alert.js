/**
 * POST /api/rating-alert
 *
 * Pages the operator the moment a guest leaves a low rating, while that guest
 * is still in the building. The GuestRating row is already written by the
 * client before this is called, so a failure here costs the alert, not the data.
 *
 * Bindings: POSTMARK_SERVER_TOKEN or RESEND_API_KEY (one required),
 * LEAD_NOTIFY_TO (fallback recipient), LEAD_NOTIFY_FROM (verified sender),
 * TWILIO_* for the SMS half.
 */
import { json, clean, esc, EMAIL_RE, sendEmail, sendSms } from '../lib/email.js';

const MAX_BODY_BYTES = 8192;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const stars = Number(body.stars);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    return json({ error: 'stars must be 1-5' }, 400);
  }

  const restaurantName = clean(body.restaurant_name, 120) || 'Your restaurant';
  const comment = clean(body.comment, 1500);
  const guestEmail = clean(body.guest_email, 200).toLowerCase();

  const candidate = clean(body.alert_email, 200).toLowerCase();
  const to = EMAIL_RE.test(candidate) ? candidate : (env.LEAD_NOTIFY_TO || 'alerts@billtap.app');

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

  // Email and SMS in parallel — the operator's phone buzzing is the point, but
  // neither channel is allowed to hold up the other or fail the request.
  const smsBody = [
    `${stars}★ at ${restaurantName}`,
    comment ? `"${comment.slice(0, 140)}"` : 'No comment.',
    guestEmail ? `Reply: ${guestEmail}` : 'No guest email.',
  ].join(' — ');

  const [emailResult, smsResult] = await Promise.all([
    sendEmail(env, {
      to,
      subject: `⚠︎ ${stars}-star rating at ${restaurantName}`,
      html,
      text,
      replyTo: EMAIL_RE.test(guestEmail) ? guestEmail : undefined,
    }),
    sendSms(env, { to: clean(body.alert_phone, 40), body: smsBody }),
  ]);

  return json({
    ok: true,
    notified: emailResult.ok,
    texted: smsResult.ok,
    ...(emailResult.ok ? {} : { reason: emailResult.reason }),
    ...(smsResult.ok ? {} : { sms_reason: smsResult.reason }),
  });
}
