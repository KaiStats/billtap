/**
 * POST /api/waitlist
 *
 * The landing page's consumer sign-up. Restores a form that has been broken
 * for every visitor for months.
 *
 * handleWaitlist in src/pages/Landing.jsx wrote a Waitlist row through the
 * Base44 SDK. Operators moved to Supabase, so there was no Base44 session to
 * write with; then the SDK was deleted. The handler was left deliberately
 * reporting an error rather than a false "you're on the list", with a note
 * saying the fix was a POST endpoint shaped like routes/restaurant-lead.js.
 * This is that endpoint.
 *
 * ── The row is the capture; the email is the notification ───────────────────
 *
 * restaurant-lead.js sent an email and nothing else — "the row went to Base44,
 * nothing writes one now, and so this is the lead in its entirety". That makes
 * the mail provider a single point of failure for a business record, and 502s
 * someone whose details were never stored anywhere.
 *
 * This writes the row first and treats delivery as best effort, because the
 * durable thing and the alerting thing have different failure modes and only
 * one of them loses data. An address in the table with no alert is a marketing
 * list somebody reads on Monday. An alert with no row is a person who typed
 * their email into a form that kept nothing.
 *
 * Bindings: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the row. Optionally
 * POSTMARK_SERVER_TOKEN or RESEND_API_KEY and LEAD_NOTIFY_TO for the
 * notification — absent, sign-ups are still captured and nobody is told live.
 */

import { json, clean, esc, EMAIL_RE, sendEmail } from '../lib/email.js';
import { serviceRole, backendName } from '../lib/data.js';

/** Same ceiling restaurant-lead.js uses. An email and a source need no more. */
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

  // Honeypot, matching restaurant-lead.js: real people never fill a hidden
  // field. Accept silently so a bot does not learn it was caught, and store
  // nothing. A 400 here would tell a scraper which field to leave alone next.
  if (clean(body.company_website, 200)) return json({ ok: true });

  const email = clean(body.email, 200).toLowerCase();
  const source = clean(body.source, 60) || 'landing';

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'That email address does not look right.' }, 400);
  }

  /**
   * Stored before anything is sent.
   *
   * If the mail provider is down, or LEAD_NOTIFY_TO was never bound, the
   * address is still captured and the sign-up is still real. That ordering is
   * the whole point of this route existing rather than another notify-only one.
   */
  let stored = false;
  if (backendName(env) === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await serviceRole(env).entity('Waitlist').create({
        email,
        app: 'billtap',
        source,
        created_at: Date.now(),
      });
      stored = true;
    } catch (error) {
      // Not fatal on its own — the notification below may still reach someone.
      // The message is ours, never upstream's.
      console.error(`waitlist: could not store ${email.replace(/^[^@]+/, '***')} — ${error?.message}`);
    }
  }

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px;font-size:18px">New waitlist sign-up</h2>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
        <tr>
          <td style="padding:8px 12px 8px 0;color:#888;white-space:nowrap">Email</td>
          <td style="padding:8px 0;font-weight:600">${esc(email)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;color:#888;white-space:nowrap">Source</td>
          <td style="padding:8px 0;font-weight:600">${esc(source)}</td>
        </tr>
      </table>
    </div>`;

  const result = await sendEmail(env, {
    to: env.LEAD_NOTIFY_TO || 'alerts@billtap.app',
    subject: 'New BillTap waitlist sign-up',
    html,
    text: `Email: ${email}\nSource: ${source}`,
    replyTo: email,
  });

  /**
   * Only a total loss is an error to the visitor.
   *
   * Nothing stored and nothing sent means the address exists solely in a text
   * box about to be cleared, and saying "you're on the list" would be exactly
   * the lie the broken handler was left in place to avoid. Anything else —
   * row written, or alert delivered — means somebody has it.
   *
   * Suppression outside production is not a failure: mayContactRealPeople holds
   * mail back on staging on purpose. Same carve-out as restaurant-lead.js.
   */
  const delivered = result.ok || result.reason === 'suppressed_outside_production';
  if (!stored && !delivered) {
    return json(
      {
        ok: false,
        error: 'We could not add you right now. Please try again in a moment.',
        reason: result.reason,
      },
      502,
    );
  }

  return json({ ok: true, stored });
}
