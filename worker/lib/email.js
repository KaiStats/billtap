/**
 * Shared Resend helper for the Pages Functions.
 *
 * Directories under functions/ whose name starts with "_" are not routed by
 * Cloudflare Pages, so this file is importable without becoming an endpoint.
 */

import { mayContactRealPeople, environmentName } from './environment.js';

import { fetchWithTimeout, TIMEOUTS } from './http.js';

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
/**
 * Outside production this logs instead of sending.
 *
 * A staging deploy running the same code sends a real email to a real
 * restaurant owner about a lead that a developer invented. Returning a distinct
 * reason rather than pretending to succeed means a test that asserts delivery
 * still fails honestly. See worker/lib/environment.js.
 */
function suppressed(env, kind, to) {
  if (mayContactRealPeople(env)) return null;
  console.log(`${kind}: suppressed in ${environmentName(env)} — would have gone to ${to}`);
  return { ok: false, reason: 'suppressed_outside_production' };
}

/**
 * How long to hold between a failed attempt and its retry.
 *
 * Long enough that a provider blip (a deploy, a load balancer hiccup) has a
 * different answer the second time; short enough that the whole send path stays
 * well inside one Worker invocation even at the worst case of four attempts.
 */
const EMAIL_RETRY_DELAY_MS = 400;

/**
 * One attempt against one provider.
 *
 * `retryable` says whether trying again could possibly change the answer:
 * a network error or timeout might, a 5xx or 429 might, a 401/422 will not —
 * that is a credential or payload problem and every retry would burn the
 * timeout budget to learn the same thing.
 */
async function attemptSend(request) {
  try {
    const res = await fetchWithTimeout(request.url, request.init, TIMEOUTS.email);
    if (res.ok) return { ok: true };
    console.error(`email: ${request.name} rejected the send`, res.status, await res.text());
    return { ok: false, retryable: res.status >= 500 || res.status === 429, reason: 'email_send_failed' };
  } catch (err) {
    console.error(`email: ${request.name} request threw`, err?.message);
    return { ok: false, retryable: true, reason: 'email_send_failed' };
  }
}

export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  const held = suppressed(env, 'email', to);
  if (held) return held;

  const postmarkToken = env.POSTMARK_SERVER_TOKEN;
  const resendKey = env.RESEND_API_KEY;

  if (!postmarkToken && !resendKey) {
    console.error('email: neither POSTMARK_SERVER_TOKEN nor RESEND_API_KEY is configured');
    return { ok: false, reason: 'email_not_configured' };
  }

  const from = env.LEAD_NOTIFY_FROM || 'BillTap <alerts@billtap.app>';

  /**
   * Every provider this environment can send through, in preference order.
   *
   * This used to be either/or: Postmark when its token existed, Resend only
   * otherwise. So an account with both configured still had a single point of
   * failure, and a Postmark outage lost the low-rating alert — the one email
   * whose whole value is arriving while the guest is still in the building,
   * and which nothing upstream retries because the browser fires it
   * best-effort. Now a configured second provider is a fallback, not dead
   * config.
   */
  const providers = [];
  if (postmarkToken) {
    providers.push({
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
    });
  }
  if (resendKey) {
    providers.push({
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
    });
  }

  /**
   * Two attempts per provider on retryable failures, then the next provider.
   *
   * A retry after a *timeout* can double-send — the first request may have
   * landed after we stopped waiting. Accepted, and deliberately so: every
   * caller here is a notification, and for the one that matters most (the
   * low-rating alert) a duplicate email is a shrug while a missing one is the
   * product not working in front of the person deciding whether to buy it.
   *
   * A non-retryable rejection still moves on to the next provider rather than
   * giving up: a 422 from Postmark (an unverified sender, a payload rule) says
   * nothing about whether Resend will take the same message.
   */
  let last = { ok: false, reason: 'email_send_failed' };
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, EMAIL_RETRY_DELAY_MS));
      const result = await attemptSend(provider);
      if (result.ok) return { ok: true };
      last = result;
      if (!result.retryable) break;
    }
  }
  return { ok: false, reason: last.reason };
}

/**
 * Send one SMS through Twilio.
 *
 * Dormant unless TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER
 * are all set — an operator with no phone on file, or an account with no Twilio
 * credentials, simply gets email only. Like sendEmail, it never throws.
 */
export async function sendSms(env, { to, body }) {
  // Twilio has no spend cap on this account, and a text sent to a real owner at
  // two in the morning about an invented one-star review has no undo.
  const held = suppressed(env, 'sms', to);
  if (held) return held;

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
    const res = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: e164, From: from, Body: body.slice(0, 320) }),
      // Bounded because this spends money on send against an account with no
      // spend cap, and a hang is the thing most likely to be retried.
    }, TIMEOUTS.sms);
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
