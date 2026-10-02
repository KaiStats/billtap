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
 *   ANTHROPIC_API_KEY  optional. Turns on the Claude backup below.
 *   CLAUDE_MODEL    optional, default claude-sonnet-5-5.
 *
 * ── The backup reader ───────────────────────────────────────────────────────
 *
 * Gemini stays first: it is fast and cheap. Claude reads the same photo when
 * Gemini could not — busy (429), an error, a stall, unusable output — or when
 * Gemini's numbers do not add up (validateReceiptParse, the same check the
 * review screen runs). If both read it and only Gemini's failed the check,
 * Claude's is used; if both fail the check, Gemini's comes back as before and
 * the review screen asks the diner to look it over. Without the key, nothing
 * here changes.
 */

import { json } from '../lib/email.js';
import { validateReceiptParse } from '../../shared/receipt-math.js';

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

/**
 * How long one attempt at the model gets, in milliseconds.
 *
 * Measured, not guessed. Eight scans against the live model — six rendered
 * receipts plus a 344 KB phone-camera JPEG — put every success between 1.6 and
 * 6.7 seconds, with image size making no visible difference. The one failure
 * did not answer slowly; it sat there until it hit the deadline.
 *
 * Nine seconds is a third again beyond the slowest success, so a real answer is
 * never cut off, and it is short enough that two of them cost less than the
 * single twenty-second attempt this replaces. A diner watching a spinner is the
 * thing being spent here, and the budget should be set by what a good answer
 * actually costs rather than by how long we are willing to hope.
 */
const ATTEMPT_MS = 9000;

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

  const body = JSON.stringify({
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
  });

  /** One attempt, with its own deadline. */
  const attempt = async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ATTEMPT_MS);
    try {
      return await fetch(url, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
      });
    } finally {
      // Always, including the throwing path. A stray timer in a Worker keeps
      // the isolate from being reclaimed, which turns a slow dependency into
      // an expensive app.
      clearTimeout(timer);
    }
  };

  try {
    let res;
    try {
      res = await attempt();
    } catch (first) {
      /**
       * One retry, and only for a stall.
       *
       * ── Why two short attempts rather than one long one ────────────────
       *
       * Measured against the live model on eight scans, including a
       * phone-camera-sized JPEG: every success came back between 1.6 and 6.7
       * seconds, and the one failure sat until it hit the deadline exactly.
       * So the failures are not slow answers, they are stalls — and raising
       * the budget would only make a diner wait longer for the same nothing.
       *
       * Two attempts at ATTEMPT_MS is a worse case of 18 seconds against the
       * 20 this replaces, so nobody waits longer than they used to, and a
       * stalled first call now gets a second roll of the dice instead of
       * costing the table their receipt.
       *
       * ── Only on abort ──────────────────────────────────────────────────
       *
       * A 429 means the quota is gone and asking again spends money to be
       * told so twice. A safety block is deterministic and will block again.
       * Neither reaches here: both come back as responses and are handled
       * below. This catch is the network path only.
       */
      if (first?.name !== 'AbortError') throw first;
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        job: 'scan-receipt',
        event: 'retry_after_stall',
        attempt_ms: ATTEMPT_MS,
      }));
      res = await attempt();
    }

    const payload = await res.json();
    if (!res.ok) {
      console.error('scan-receipt: model rejected', res.status, JSON.stringify(payload).slice(0, 300));
      // Out of quota is not a bad photo. Saying "could not read that receipt"
      // sends the diner to retake a picture that was fine. Still a 5xx, so the
      // review screen keeps offering the even split that needs no model.
      if (res.status === 429) {
        return await backupOr(env, contentType, buffer, json({
          error: 'Scanning is busy right now. Try again in a minute, or split evenly instead.',
          code: 'busy',
        }, 503));
      }
      return await backupOr(env, contentType, buffer,
        json({ error: 'Could not read that receipt.', code: 'model_error' }, 502));
    }

    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      // A safety block or a truncated response both land here.
      console.error('scan-receipt: no text in response', JSON.stringify(payload).slice(0, 300));
      return await backupOr(env, contentType, buffer,
        json({ error: 'Could not read that receipt.', code: 'empty_response' }, 502));
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('scan-receipt: response was not JSON', text.slice(0, 200));
      return await backupOr(env, contentType, buffer,
        json({ error: 'Could not read that receipt.', code: 'bad_json' }, 502));
    }

    return await withBackup(env, contentType, buffer, normalise(parsed));
  } catch (error) {
    // Reached only when the retry stalled too, or the network failed outright.
    const aborted = error?.name === 'AbortError';
    console.error(`scan-receipt: ${aborted ? 'timed out twice' : 'threw'}`, error?.message);
    return await backupOr(env, contentType, buffer, json(
      { error: 'Could not read that receipt.', code: aborted ? 'timeout' : 'network' },
      504,
    ));
  }
}

/** Normalised here so the client gets the same shape whichever model read it. */
function normalise(parsed) {
  const ticket = ticketFrom(parsed.ticket);
  return {
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
  };
}

// ── Claude backup ───────────────────────────────────────────────────────────

/** Image types Claude reads. HEIC is not one, so a HEIC photo has no backup. */
const CLAUDE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Long enough for a careful read, short enough that a diner is not left waiting. */
const CLAUDE_MS = 15000;

const CLAUDE_PROMPT = `${PROMPT}

Reply with only a JSON object, no other text, in exactly this shape:
{"title": string, "items": [{"name": string, "price": number, "quantity": number}], `
  + '"tax": number, "tip": number, "total": number, '
  + '"ticket": {"table": string, "server": string, "number": string}}';

/** The first {...} in a reply, parsed, or null. */
export function jsonFrom(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const canBackup = (env, contentType) => Boolean(env.ANTHROPIC_API_KEY) && CLAUDE_TYPES.has(contentType);

/**
 * One read by Claude. Returns the normalised receipt, or null — never throws,
 * because it only ever runs when something else already went wrong and its own
 * failure must not replace the original answer with a worse one.
 */
export async function readWithClaude(env, contentType, buffer) {
  // Plain fetch, like Gemini and Postmark above. The Anthropic SDK bundles
  // Node-only modules (fs, child_process) that this Worker cannot load without
  // turning on nodejs_compat for every route — too wide a change for a backup.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLAUDE_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
        max_tokens: 8000,
        // Reading printed numbers needs care, not long deliberation.
        output_config: { effort: 'low' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: contentType, data: base64(buffer) } },
            { type: 'text', text: CLAUDE_PROMPT },
          ],
        }],
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`scan-receipt: claude rejected ${res.status}`, JSON.stringify(payload?.error || {}).slice(0, 200));
      return null;
    }
    if (payload?.stop_reason === 'refusal' || payload?.stop_reason === 'max_tokens') {
      console.error(`scan-receipt: claude stopped (${payload.stop_reason})`);
      return null;
    }
    const text = (payload?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = jsonFrom(text);
    if (!parsed) {
      console.error('scan-receipt: claude reply was not JSON', text.slice(0, 200));
      return null;
    }
    return normalise(parsed);
  } catch (error) {
    console.error(`scan-receipt: claude ${error?.name === 'AbortError' ? 'timed out' : 'threw'}`, error?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Gemini failed outright: try Claude, else return Gemini's own error. */
async function backupOr(env, contentType, buffer, failure) {
  if (!canBackup(env, contentType)) return failure;
  const result = await readWithClaude(env, contentType, buffer);
  if (!result) return failure;
  console.log(JSON.stringify({ job: 'scan-receipt', event: 'claude_backup', reason: 'gemini_failed' }));
  return json(result);
}

/** Gemini read it: keep it unless its numbers do not add up and Claude's do. */
async function withBackup(env, contentType, buffer, result) {
  if (validateReceiptParse(result).valid || !canBackup(env, contentType)) return json(result);
  const second = await readWithClaude(env, contentType, buffer);
  if (second && validateReceiptParse(second).valid) {
    console.log(JSON.stringify({ job: 'scan-receipt', event: 'claude_backup', reason: 'gemini_mismatch' }));
    return json(second);
  }
  return json(result);
}
