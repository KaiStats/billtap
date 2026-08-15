/**
 * POST /api/scan-receipt — read a photographed receipt, without Base44.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * The scan was two sequential round trips with Base44 in the middle of both:
 *
 *     phone → Worker → base44.app → their storage          wait for a URL
 *     phone → Worker → base44.app → their gateway → Gemini  wait for the parse
 *
 * The image crossed the wire twice — once up to their storage, then again when
 * their gateway fetched it back out to hand to the model — and the second call
 * could not start until the first returned a URL. Neither hop was ours, so the
 * latency was not ours to fix. Backend functions are blocked on this app's
 * Base44 plan, which is why every other piece of business logic already lives
 * in this Worker; the model call was the last thing still going through them on
 * the critical path.
 *
 * Now it is one hop, with the image inline:
 *
 *     phone → Worker → Gemini
 *
 * Storing the image is a separate concern and no longer blocks anything. The
 * browser starts that upload when the photo is chosen and nothing waits on it
 * until a split is actually created, by which point it finished minutes ago.
 *
 * ── Falling back ────────────────────────────────────────────────────────────
 *
 * With no GEMINI_API_KEY this answers 503 and `code: 'not_configured'`, and the
 * client quietly goes back to Base44's InvokeLLM. That is deliberate: it makes
 * this deployable before the key exists, and it means a bad key or a provider
 * outage degrades to the old path rather than to a broken scan. Remove the
 * fallback once the direct path has been in production long enough to trust.
 *
 * Bindings:
 *   GEMINI_API_KEY  required for this route to do anything
 *   GEMINI_MODEL    optional. Model names change; do not hard-code a guess in
 *                   a deploy you cannot edit. Check the provider's current
 *                   list and set this.
 */

import { json } from '../lib/email.js';

/** Matches what the review screen already expects back. */
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          quantity: { type: 'number' },
        },
        required: ['name', 'price'],
      },
    },
    tax: { type: 'number' },
    tip: { type: 'number' },
    total: { type: 'number' },
    /**
     * What the POS printed across the top of the ticket.
     *
     * Not required, and every field inside it nullable, because most of this is
     * absent on a lot of receipts and a model asked for a required field will
     * invent one. An invented table number is worse than no table number: it
     * sends a manager to apologise to the wrong people while the guest who was
     * actually unhappy finishes their coffee and leaves.
     *
     * Strings, not numbers. "14" is a table and so are "A7", "BAR 3" and
     * "PATIO-2"; every room numbers its floor differently and parsing to an
     * integer fails on exactly the ones that need this most.
     */
    ticket: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        server: { type: 'string' },
        number: { type: 'string' },
      },
    },
  },
  required: ['title', 'items', 'tax', 'tip', 'total'],
};

const PROMPT =
  'Read this restaurant receipt. Extract every line item with its price and quantity, ' +
  'plus tax, tip and total.\n' +
  '- title: the restaurant or store name if visible, otherwise "Receipt".\n' +
  '- price: the price of ONE unit, not the line total.\n' +
  '- quantity: default 1 when the receipt does not say.\n' +
  '- tax, tip, total: 0 when not printed. Do not infer or calculate them.\n' +
  '- ticket.table: the table or seat identifier printed on the receipt, exactly as '
  + 'printed — "14", "A7", "BAR 3". Omit it entirely if the receipt does not show one.\n' +
  '- ticket.server: the server or cashier name printed on the receipt. Omit if absent.\n' +
  '- ticket.number: the check, ticket or order number. Omit if absent.\n' +
  'Return only what is printed. A missing number is 0, never a guess. Omit any '
  + 'ticket field the receipt does not show rather than guessing it — a wrong table '
  + 'number sends a manager to the wrong table.';

/**
 * One printed ticket field, or null.
 *
 * Short caps, and they are the point rather than tidiness. A table is "14" or
 * "PATIO-2"; a server is a first name. Anything longer than these is the model
 * having read a sentence off the receipt and handed it back as a table number,
 * and that sentence would land in an operator's inbox under the heading that
 * tells them where to walk.
 *
 * Control characters are stripped rather than rejected: unlike a restaurant
 * name typed by an operator, nobody is watching this get read back, so there is
 * no one for a refusal to inform — and dropping the whole scan because a model
 * emitted a stray byte would cost the diner their receipt.
 */
function ticketField(value, max) {
  if (typeof value !== 'string') return null;
  // no-control-regex is exactly backwards here: matching control characters
  // is the whole job, because this string is rendered into an email.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/** The three of them, or null when the receipt printed none. */
export function ticketFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const table = ticketField(raw.table, 16);
  const server = ticketField(raw.server, 40);
  const number = ticketField(raw.number, 24);
  if (!table && !server && !number) return null;
  return {
    ...(table ? { table } : {}),
    ...(server ? { server } : {}),
    ...(number ? { number } : {}),
  };
}

/** A compressed receipt is a few hundred KB. Well past that is not a receipt. */
const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

/** Chunked, because a 500 KB image spread over one apply() call blows the stack. */
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    // Not an error worth alarming anyone about — it is the state of a
    // deployment that has not been given a key yet.
    return json({ error: 'Direct scanning is not configured.', code: 'not_configured' }, 503);
  }

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!ALLOWED_TYPES.has(contentType)) {
    return json({ error: 'Send a JPEG, PNG, WebP or HEIC image.', code: 'bad_type' }, 415);
  }

  // Refuse on the declared length before reading anything. The check below is
  // the one that counts — Content-Length is the client's claim, and a chunked
  // upload carries none — but without this the Worker buffers the entire body
  // into a 128 MB isolate and only then decides it was too big. That is a free
  // way to spend the memory of an endpoint that takes no credentials.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return json({ error: 'That image is too large.', code: 'too_large' }, 413);
  }

  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) return json({ error: 'No image received.', code: 'empty' }, 400);
  if (buffer.byteLength > MAX_BYTES) {
    return json({ error: 'That image is too large.', code: 'too_large' }, 413);
  }

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  // A scan that hangs is worse than one that fails: the diner is watching a
  // spinner and the table is waiting. Give up and let the client fall back.
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: abort.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType: contentType, data: base64(buffer) } },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RECEIPT_SCHEMA,
          // A receipt parse is a few hundred tokens. Unbounded lets a bad
          // response run long while somebody watches a spinner.
          maxOutputTokens: 2048,
          // Reading printed numbers is not a creative task.
          temperature: 0,
        },
      }),
    });

    const payload = await res.json();
    if (!res.ok) {
      console.error('scan-receipt: model rejected', res.status, JSON.stringify(payload).slice(0, 300));
      return json({ error: 'Could not read that receipt.', code: 'model_error' }, 502);
    }

    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      // A safety block or a truncated response both land here.
      console.error('scan-receipt: no text in response', JSON.stringify(payload).slice(0, 300));
      return json({ error: 'Could not read that receipt.', code: 'empty_response' }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('scan-receipt: response was not JSON', text.slice(0, 200));
      return json({ error: 'Could not read that receipt.', code: 'bad_json' }, 502);
    }

    const ticket = ticketFrom(parsed.ticket);

    // Normalised here so the client gets the same shape whichever path ran.
    return json({
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Receipt',
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              name: String(item.name || '').slice(0, 120),
              price: Number(item.price) || 0,
              quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
            }))
        : [],
      tax: Number(parsed.tax) || 0,
      tip: Number(parsed.tip) || 0,
      total: Number(parsed.total) || 0,
      // Clamped here as well as in createSession. This is model output — the
      // least trustworthy string in the product — and it ends up rendered into
      // an email, so it is bounded at both ends rather than at whichever one
      // somebody remembers. `ticket` is omitted entirely when nothing was
      // printed, so a caller can test for it rather than for three empties.
      ...(ticket ? { ticket } : {}),
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    console.error(`scan-receipt: ${aborted ? 'timed out' : 'threw'}`, error?.message);
    return json(
      { error: 'Could not read that receipt.', code: aborted ? 'timeout' : 'network' },
      504,
    );
  } finally {
    clearTimeout(timeout);
  }
}
