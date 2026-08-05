/**
 * Which splits this device has been part of.
 *
 * The landing page promises "Bill History — every split, always on record", and
 * for the person this product is built for that was false. A guest host has no
 * account, so /dashboard — which lists sessions through Base44's own rules —
 * bounced them to the landing page. The splits themselves were on the server
 * the whole time; what was missing was any record of which ones were theirs.
 * Close the tab and the bill was gone.
 *
 * So the index lives here, on the device: an id and enough of a summary to draw
 * a list instantly, plus the fact of whether this phone hosted the split or
 * merely ate at it. The authoritative data stays on the server and is re-read
 * when a row is opened; this is a pointer list, not a cache of the truth.
 *
 * It is honest about its limits. Clearing browser data loses the index, and the
 * landing copy now says "on this phone" rather than implying a vault. Making it
 * survive a lost device means asking a diner for an email in the ninety seconds
 * they are trying to pay for dinner, which is a worse product.
 *
 * Entries are pruned at 30 days because that is when Session.expires_at fires
 * on the server — a list that offers to open bills which no longer exist is
 * worse than a shorter list.
 */

const KEY = 'billtap-split-history';
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unavailable storage is an empty history, never a crash on a
    // screen someone opened to look at their bills.
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* Private mode or a full quota. The split still works. */
  }
}

/** Newest first, with anything the server has already dropped removed. */
export function listSplits() {
  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = read().filter((e) => e && e.id && (e.created_at || 0) > cutoff);
  return fresh.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

/**
 * Records a split, or refreshes what is known about one already recorded.
 *
 * `role` is only ever upgraded: joining a split you hosted must not demote you
 * to a guest in your own history, which would send you to the diner's screen
 * instead of the one with the confirm buttons.
 */
/**
 * @param {object} entry
 * @param {string} entry.id                 the only required field
 * @param {string} [entry.title]
 * @param {number} [entry.total]
 * @param {string} [entry.status]
 * @param {string} [entry.role]             'host' or 'guest'
 * @param {number} [entry.participants]
 * @param {boolean} [entry.paid]
 */
export function rememberSplit({ id, title, total, status, role, participants, paid }) {
  if (!id) return;
  const entries = read();
  const existing = entries.find((e) => e.id === id);

  const patch = {
    id,
    ...(title !== undefined ? { title } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(participants !== undefined ? { participants } : {}),
    ...(paid !== undefined ? { paid } : {}),
  };

  if (existing) {
    Object.assign(existing, patch);
    if (role === 'host') existing.role = 'host';
    write(entries);
    return;
  }

  write([{ created_at: Date.now(), role: role || 'guest', ...patch }, ...entries]);
}

/** Drops one split from the list. */
export function forgetSplit(id) {
  write(read().filter((e) => e.id !== id));
}

/** Everything, for the "clear my history" case. */
export function clearSplitHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
