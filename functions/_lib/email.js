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
 * Send one email.
 *
 * Postmark is used when POSTMARK_SERVER_TOKEN is set — that is the account that
 * owns billtap.app, so mail can come from alerts@billtap.app rather than a
 * second brand. Resend is the fallback for environments that only have that.
 *
 * Returns {ok:true} or {ok:false, reason} — it never throws, because every
 * caller has already persisted the thing that matters and must not fail the
 * user's request over a notification.
 */
export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  const postmarkToken = env.POSTMARK_SERVER_TOKEN;
  const resendKey = env.RESEND_API_KEY;

  if (!postmarkToken && !resendKey) {
    console.error('email: neither POSTMARK_SERVER_TOKEN nor RESEND_API_KEY is configured');
    return { ok: false, reason: 'email_not_configured' };
  }

  const from = env.LEAD_NOTIFY_FROM || 'BillTap <alerts@billtap.app>';

  const request = postmarkToken
    ? {
        url: 'https://api.postmarkapp.com/email',
        init: {
          method: 'POST',
          headers: {
            'X-Postmark-Server-Token': postmarkToken,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            From: from,
            To: to,
            Subject: subject,
            HtmlBody: html,
            TextBody: text,
            ...(replyTo ? { ReplyTo: replyTo } : {}),
            MessageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound',
          }),
        },
        name: 'Postmark',
      }
    : {
        url: 'https://api.resend.com/emails',
        init: {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [to],
            ...(replyTo ? { reply_to: replyTo } : {}),
            subject,
            html,
            text,
          }),
        },
        name: 'Resend',
      };

  try {
    const res = await fetch(request.url, request.init);
    if (!res.ok) {
      console.error(`email: ${request.name} rejected the send`, res.status, await res.text());
      return { ok: false, reason: 'email_send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error(`email: ${request.name} request threw`, err?.message);
    return { ok: false, reason: 'email_send_failed' };
  }
}

/**
 * Send one SMS through Twilio.
 *
 * Dormant unless TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER
 * are all set — an operator with no phone on file, or an account with no Twilio
 * credentials, simply gets email only. Like sendEmail, it never throws.
 */
export async function sendSms(env, { to, body }) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) return { ok: false, reason: 'sms_not_configured' };
  if (!to) return { ok: false, reason: 'no_recipient' };

  // E.164 or Twilio rejects it. Assume US when the caller stored 10 digits.
  const digits = String(to).replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+')
    ? digits
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith('1')
        ? `+${digits}`
        : null;
  if (!e164) return { ok: false, reason: 'bad_phone_number' };

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: e164, From: from, Body: body.slice(0, 320) }),
    });
    if (!res.ok) {
      console.error('sms: Twilio rejected the send', res.status, await res.text());
      return { ok: false, reason: 'sms_send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('sms: Twilio request threw', err?.message);
    return { ok: false, reason: 'sms_send_failed' };
  }
}
