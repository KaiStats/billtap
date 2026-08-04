/**
 * Links that carry a session id.
 *
 * ── Why this is a module and not a template literal ─────────────────────────
 *
 * Eight places built these by interpolating the id straight into a query
 * string — `/claim?id=${sessionId}` — and a session id is not safe there.
 *
 * The ids Supabase mints come from billtap_id(), which base64-encoded twelve
 * random bytes and replaced the slash. It did not replace the plus, and a plus
 * in a query string is the encoding of a space: every URL parser decodes it as
 * one, including the URLSearchParams call on the other side of these very
 * links. Measured over 10,000 generated ids, 22.5% contained one.
 *
 * So slightly more than one split in five would have produced a QR code the
 * table could not open and a host screen that answered "Session not found"
 * immediately after the split was created — the id going out and the id coming
 * back differing by a single character.
 *
 * Migration 0006 fixes the generator to emit base64url. This fixes the other
 * half, and it is the half that matters for ids that already exist: rows
 * migrated from Base44 carry ids this app did not mint and has no rule about,
 * and encoding is the only thing that makes them safe in a URL regardless.
 *
 * Nothing changes on the reading side. `URLSearchParams.get('id')` decodes, so
 * it accepts both the encoded links written from here and the raw ones already
 * in people's message history.
 */

/**
 * A path with the session id attached, encoded.
 *
 * @param route  e.g. '/claim'
 * @param id     the session id, unencoded
 * @param extra  any further query parameters, encoded the same way
 */
export function sessionPath(route, id, extra = {}) {
  const params = new URLSearchParams({ id: String(id ?? '') });
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return `${route}?${params}`;
}

/** The absolute link that goes in the QR code and the share message. */
export function claimUrl(origin, id) {
  return `${origin}${sessionPath('/claim', id)}`;
}
