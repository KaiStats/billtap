/**
 * Shared Resend helper for the Pages Functions.
 *
 * Directories under functions/ whose name starts with "_" are not routed by
 * Cloudflare Pages, so this file is importable without becoming an endpoint.
 */

export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, collapse whitespace, cap length. Returns '' for non-strings. */
export const clean = (value, max) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/** Escape for interpolation into an HTML email body. */
export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Send one email through Resend.
 *
 * Returns {ok:true} or {ok:false, reason} — it never throws, because every
 * caller has already persisted the thing that matters and must not fail the
 * user's request over a notification.
 */
export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('email: RESEND_API_KEY is not configured');
    return { ok: false, reason: 'email_not_configured' };
  }

  const from = env.LEAD_NOTIFY_FROM || 'BillTap <alerts@grandeza.io>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      console.error('email: Resend rejected the send', res.status, await res.text());
      return { ok: false, reason: 'email_send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('email: Resend request threw', err?.message);
    return { ok: false, reason: 'email_send_failed' };
  }
}
