/**
 * The secret that makes you the host of a split.
 *
 * createSession mints it and returns it exactly once; the session stores only
 * its SHA-256. Presenting it is what authorises confirming that a payment
 * arrived, and reading the whole table's amounts.
 *
 * Why it exists at all: a split created from a restaurant's table tent has no
 * created_by_id, because the person who made it has no account — that is the
 * product's whole premise. Base44's rules on Session key off created_by_id, so
 * for those splits they match nobody, and the host could neither read the
 * participant list nor confirm a payment. The screen that lists who has paid
 * was empty for exactly the person it exists for.
 *
 * What replaced: src/pages/ReceiptDetail.jsx decided who was host from a
 * `?host=1` query parameter kept in localStorage. Any diner could append it.
 *
 * localStorage rather than sessionStorage: the host closes the tab, reopens it
 * from their history an hour later, and is still the host. Losing the key costs
 * you the host controls on that one split — it never costs anyone money, and it
 * cannot be used to take money.
 */

const key = (sessionId) => `billtap-hostkey-${sessionId}`;

/** Remembers the key returned by createSession. Safe to call with nothing. */
export function rememberHostKey(sessionId, hostKey) {
  if (!sessionId || !hostKey) return;
  try {
    localStorage.setItem(key(sessionId), hostKey);
  } catch {
    // Private mode, or storage full. The split still works; this device just
    // will not have the host controls, which is a degraded screen rather than
    // a broken flow.
  }
}

/** The key for this split, or null. */
export function getHostKey(sessionId) {
  if (!sessionId) return null;
  try {
    return localStorage.getItem(key(sessionId)) || null;
  } catch {
    return null;
  }
}

/** Whether this device holds the host secret for this split. */
export function isHostOf(sessionId) {
  return Boolean(getHostKey(sessionId));
}

/** Used when a split is finished with, and by the tests. */
export function forgetHostKey(sessionId) {
  try {
    localStorage.removeItem(key(sessionId));
  } catch {
    /* nothing to clean up */
  }
}
