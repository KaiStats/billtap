/**
 * The line the host reads in their payment feed.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * A constant. Every diner's Venmo handoff carried `note=BillTap Split`, so a
 * host looking at four incoming payments got four identical descriptions and
 * had to match them by amount alone. Two people owing $21.40 — a couple who
 * ordered the same thing, which is not a rare table — were genuinely
 * indistinguishable, and the host had to guess which of them had paid.
 *
 * Guessing there is expensive in one direction: confirm the wrong diner and
 * the person who actually sent money is still shown as owing it, while
 * somebody who sent nothing is marked settled.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * Not verification. Nothing in a note proves a transfer happened — the sender
 * types it and could type anything. It solves matching, which is a different
 * problem, and the host confirming remains the only evidence the money
 * arrived. See confirmPayment in worker/routes/functions.js.
 */

/**
 * Venmo truncates a long note, and a half-eaten name is worse than a short
 * one. Well under the limit so the interesting part — who this is from —
 * survives even when the meal has a long title.
 */
export const NOTE_MAX = 120;

/**
 * @param name  the diner's own name, as they typed it
 * @param title the split's title, e.g. "Dinner at Joe's"
 * @returns a note safe to place in a URL query parameter *before* encoding
 */
export function paymentNote(name, title) {
  // Guarded rather than assumed: `name` is absent until the diner passes the
  // name gate, and a split created from a bare receipt can have no title.
  const parts = ['BillTap', String(name ?? '').trim(), String(title ?? '').trim()]
    .filter(Boolean);

  /**
   * Collapsed, because the note ends up in a URL and then in somebody's
   * banking app. A name pasted with a newline in it would otherwise break the
   * line in the host's feed, or truncate the note at the newline depending on
   * the client.
   */
  return parts.join(' · ').replace(/\s+/g, ' ').slice(0, NOTE_MAX).trim();
}
