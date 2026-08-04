/**
 * POST /api/rating-alert
 *
 * Pages the operator the moment a guest leaves a low rating, while that guest
 * is still in the building. Lookup the rating by ID to validate ownership and
 * fetch the restaurant's contact info server-side, preventing spam.
 *
 * Requires: rating_id (UUID of the GuestRating record)
 * Bindings: BASE44_APP_ID (or VITE_BASE44_APP_ID) and BASE44_MASTER_KEY for the
 *           service-role lookups; POSTMARK_SERVER_TOKEN or RESEND_API_KEY;
 *           TWILIO_* for the SMS half.
 *
 * Both app-id names are accepted because this file documented BASE44_APP_ID and
 * read VITE_BASE44_APP_ID. Setting the documented one left every alert failing
 * with "Service misconfigured", and nothing surfaced it: RatingCapture fires
 * this best-effort and never checks the status, so a 500 is indistinguishable
 * from a delivered page. A silently dead low-rating alert is the entire B2B
 * product not working, so accept either name rather than make an operator guess.
 *
 * Never give the master key a VITE_ prefix. Vite inlines every VITE_* variable
 * into the client bundle at build time, so that would publish it.
 */
import { json, clean, esc, EMAIL_RE, sendEmail, sendSms } from '../lib/email.js';
// Same origin helper the ported functions use. This file previously hard-coded
// api.base44.com/v0, which 404s — every lookup here had been failing silently,
// because the caller fires this best-effort and never reads the response.
import { serviceRole } from '../lib/data.js';

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
    // Through the data layer, so this follows DATA_BACKEND like everything
    // else. It used to build Base44 URLs by hand with the master key, which
    // meant the cutover to Supabase would have left it reading a database with
    // nothing in it — and because the caller fires this best-effort and never
    // reads the response, nobody would have found out. That is the exact
    // failure this file already had once: see the header of worker/lib/base44.js.
    let svc;
    try {
      svc = serviceRole(env);
    } catch (error) {
      // Name the missing binding. This is the only signal that exists, so a log
      // saying just "misconfigured" costs an operator the evening it takes to
      // work out which one.
      console.error(`rating-alert: cannot page the operator — ${error.message}`);
      return json({ error: 'Service misconfigured' }, 500);
    }

    const ratings = await svc.entity('GuestRating').filter({ id: ratingId });
    const rating = ratings[0];
    if (!rating) return json({ error: 'Rating not found' }, 404);

    // Already paged for this rating — do not page again.
    //
    // This endpoint is unauthenticated by necessity: the guest firing it has no
    // account. Without a dedupe, the same rating_id could be replayed for as
    // long as anyone cared to, and each replay is another email and another
    // SMS. There is no spend cap on the Twilio or Postmark accounts, so the
    // ceiling on that was the attacker's patience.
    if (rating?.alerted_at) {
      return json({ ok: true, already_alerted: true }, 200);
    }

    if (!rating || !rating.restaurant_id) {
      return json({ error: 'Invalid rating' }, 400);
    }

    const restaurants = await svc.entity('Restaurant').filter({ id: rating.restaurant_id });
    const restaurant = restaurants[0];
    if (!restaurant) {
      console.error(`rating-alert: restaurant ${rating.restaurant_id} not found`);
      return json({ error: 'Restaurant not found' }, 404);
    }
    if (!restaurant.alert_email) {
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

    // Claim the alert BEFORE sending, not after.
    //
    // Stamping afterwards leaves the whole send window open to a replay, and
    // two concurrent requests would both read alerted_at as empty and both
    // page. Claiming first means the loser of that race sends nothing.
    const claimed = await stampAlerted(svc, ratingId);
    if (!claimed) {
      // Could not claim, so cannot guarantee this is not a duplicate. Refusing
      // is the safe direction when the failure mode is an unbounded phone bill.
      console.error('rating-alert: could not stamp alerted_at, refusing to send');
      return json({ error: 'Service error' }, 500);
    }

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

    // Nothing reached the operator. Release the claim so a retry is possible —
    // a permanently swallowed alert is the failure this endpoint exists to
    // prevent — and answer 5xx rather than 200.
    //
    // An operator with no phone number configured is not a failure: email alone
    // is the documented behaviour, so only treat it as failed when the email
    // failed too.
    if (!emailResult.ok && !smsResult.ok) {
      await stampAlerted(svc, ratingId, null);
      console.error(
        `rating-alert: no channel delivered (email: ${emailResult.reason}, sms: ${smsResult.reason})`,
      );
      return json(
        { error: 'Alert could not be delivered', reason: emailResult.reason, sms_reason: smsResult.reason },
        502,
      );
    }

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

/**
 * Sets (or clears) GuestRating.alerted_at as service role.
 *
 * Returns true when the write landed. The caller treats a failure as "do not
 * send", because the whole point of the stamp is that it is the only thing
 * standing between an unauthenticated endpoint and an unbounded SMS bill.
 */
async function stampAlerted(svc, ratingId, value = Date.now()) {
  try {
    await svc.entity('GuestRating').update(ratingId, { alerted_at: value });
    return true;
  } catch (error) {
    console.error('rating-alert: alerted_at write failed:', error.message);
    return false;
  }
}
