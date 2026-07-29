/**
 * POST /api/monthly-report
 *
 * Sends the month-end performance report. The aggregation happens where the data
 * lives; this endpoint owns delivery, so every BillTap email — alerts, leads and
 * reports alike — leaves from Cloudflare via Postmark as alerts@billtap.app.
 *
 * Guarded by a shared secret in X-Report-Secret. Without it anyone who found the
 * URL could send mail from your domain.
 *
 * Bindings: REPORT_WEBHOOK_SECRET (required), plus the usual email bindings.
 */
import { json, esc, EMAIL_RE, sendEmail } from '../_lib/email.js';

const MAX_BODY_BYTES = 262144; // ~250KB — comfortably more than a few hundred restaurants

/** Constant-time-ish compare so a wrong secret can't be guessed by timing. */
function secretMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const row = (k, v) => `
  <tr>
    <td style="padding:11px 12px 11px 0;color:#666;border-bottom:1px solid #eee">${esc(k)}</td>
    <td style="padding:11px 0;font-weight:700;text-align:right;border-bottom:1px solid #eee">${esc(v)}</td>
  </tr>`;

export async function onRequestPost({ request, env }) {
  const expected = env.REPORT_WEBHOOK_SECRET;
  if (!expected) {
    console.error('monthly-report: REPORT_WEBHOOK_SECRET is not configured');
    return json({ error: 'Not configured' }, 503);
  }
  if (!secretMatches(request.headers.get('X-Report-Secret') || '', expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const reports = Array.isArray(body.reports) ? body.reports : [];
  if (reports.length === 0) return json({ ok: true, sent: 0 });

  let sent = 0;
  const failures = [];

  for (const r of reports) {
    if (!EMAIL_RE.test(String(r.to || ''))) {
      failures.push({ restaurant: r.restaurant_name || '(unnamed)', reason: 'bad_recipient' });
      continue;
    }

    const label = r.label || body.window || 'Last month';
    const rows = [
      ['Average rating', r.average != null ? `${r.average} / 5` : 'No ratings yet'],
      ['Ratings collected', r.ratings ?? 0],
      ['Sent to Google', r.routed ?? 0],
      ['Caught before going public', r.caught ?? 0],
      ['New guest emails', r.new_contacts ?? 0],
      ['Total list size', r.list_size ?? 0],
    ];

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:540px">
        <div style="background:#111827;border-radius:12px;padding:22px;margin-bottom:20px">
          <p style="margin:0 0 6px;color:#f0b429;font-size:12px;letter-spacing:.12em;text-transform:uppercase">${esc(label)}</p>
          <p style="margin:0;color:#fff;font-size:22px;font-weight:700">${esc(r.restaurant_name || 'Your restaurant')}</p>
        </div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => row(k, v)).join('')}
        </table>
        <p style="margin:22px 0 0;color:#888;font-size:12px;line-height:1.6">
          ${Number(r.caught) > 0
            ? `${esc(r.caught)} unhappy guest${Number(r.caught) === 1 ? '' : 's'} reached you privately instead of Google this month.`
            : 'No low ratings this month.'}
        </p>
      </div>`;

    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

    const result = await sendEmail(env, {
      to: r.to,
      subject: `${r.restaurant_name || 'Your restaurant'} — ${label} report`,
      html,
      text,
    });

    if (result.ok) sent++;
    else failures.push({ restaurant: r.restaurant_name || '(unnamed)', reason: result.reason });
  }

  return json({ ok: true, sent, failed: failures.length, failures });
}
