/**
 * The secret that makes you a particular diner in a split.
 *
 * ── Why this had to exist ───────────────────────────────────────────────────
 *
 * participant_id was doing this job, and it could not: it is minted in the
 * browser, and every poll response lists every participant's id — it has to, so
 * the table can see who has claimed what and who has settled. So the thing that
 * authorised acting as a diner was published to everyone at that diner's table,
 * and to anyone the claim link was forwarded to.
 *
 * Measured against the handlers before this existed, one diner could:
 *
 *   * read any other diner's exact amount_owed and paid_at, by replaying an id
 *     out of the response they had just been given — which made
 *     scopeForParticipant, whose whole purpose is that a diner does not see
 *     what anyone else owes, decoration;
 *   * call markMePaid as somebody else, so the host's screen showed a diner
 *     asserting they had sent money when they had not, and the host stopped
 *     chasing them;
 *   * call joinSession as somebody else — rename them, release their item
 *     claims so they owed nothing and the table came up short, or claim extra
 *     items for them so they owed more than they ate.
 *
 * ── The shape is the host key's, on purpose ─────────────────────────────────
 *
 * joinSession mints it and returns it exactly once; the participant row stores
 * only its SHA-256. src/lib/hostKey.js already establishes this pattern for the
 * host, it is tested, and a second mechanism would be a second thing to get
 * wrong.
 *
 * localStorage rather than sessionStorage, for the same reason: a diner closes
 * the tab, reopens the link, and is still themselves. Losing the key costs the
 * ability to change your own claims on that one split — it never costs anyone
 * money and it cannot be used to take any.
 */

const storageKey = (sessionId, participantId) =>
  `billtap-pkey-${sessionId}-${participantId}`;

/** Remembers the key joinSession returned. Safe to call with nothing. */
export function rememberParticipantKey(sessionId, participantId, key) {
  if (!sessionId || !participantId || !key) return;
  try {
    localStorage.setItem(storageKey(sessionId, participantId), key);
  } catch {
    // Private mode, or storage full. The split still works — this device just
    // loses the ability to prove it is this diner, which degrades to the
    // read-only view rather than breaking the flow.
  }
}

/** The key for this diner on this split, or null. */
export function getParticipantKey(sessionId, participantId) {
  if (!sessionId || !participantId) return null;
  try {
    return localStorage.getItem(storageKey(sessionId, participantId)) || null;
  } catch {
    return null;
  }
}

/** Used when a split is finished with, and by the tests. */
export function forgetParticipantKey(sessionId, participantId) {
  try {
    localStorage.removeItem(storageKey(sessionId, participantId));
  } catch {
    /* nothing to clean up */
  }
}
