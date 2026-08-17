/**
 * Your running tab: every split that has not fully settled, across all your meals.
 *
 * ── What it is, and the line it does not cross ──────────────────────────────
 *
 * splitHistory records, per split, the total, how many people were on it, and
 * how many have paid — see rememberSplit. That is enough to answer the one
 * question the free "Recent Splits" list does not: of everything I have been
 * part of, what is still owed and to whom.
 *
 * It is enough for that and no more. The index does NOT store who owes what, or
 * how much any one person's share was — only the counts. So this reports "2 of 5
 * paid · $84.20 total" honestly and refuses to invent "you are owed $40.12",
 * which the data cannot support. A number the app cannot stand behind is worse
 * than a number it does not show, and this is the tier people pay for.
 *
 * Pure and side-effect-free so it can be tested without a browser: it takes the
 * entries listSplits() returns and gives back the rollup a screen draws.
 */

/**
 * Still settling: not marked complete, and not everyone has paid.
 *
 * A split with no participant count yet — created but not shared — counts as
 * settling too, because "nothing has happened" is exactly the thing a tab is
 * for surfacing. A completed split is done regardless of the counts, since the
 * host is the authority on that and may have settled the last person in cash.
 */
export function isUnsettled(entry) {
  // No id is not a bill. Every real entry has one — rememberSplit refuses to
  // store without it — so this only ever rejects junk, and stops a stray empty
  // object being counted as an outstanding split.
  if (!entry || !entry.id || entry.status === 'completed') return false;
  const people = Number(entry.participants) || 0;
  const paid = Number(entry.paid) || 0;
  return people === 0 ? true : paid < people;
}

/**
 * The tab, from a list of split-history entries (newest-first as listSplits
 * returns them).
 *
 * @param {Array<object>} entries
 * @returns {{ unsettled: Array<object>, count: number, billsTotal: number, asHost: number }}
 *   billsTotal is the sum of the FULL totals of the unsettled bills — "across
 *   these bills", never "owed to you". asHost is how many this phone hosted.
 */
export function computeTab(entries) {
  const list = Array.isArray(entries) ? entries.filter(isUnsettled) : [];
  const billsTotal = list.reduce((sum, e) => sum + (Number(e.total) || 0), 0);
  const asHost = list.filter((e) => e.role === 'host').length;
  return {
    unsettled: list,
    count: list.length,
    // Rounded to cents once, at the end, so a list of 2-decimal totals cannot
    // sum to 84.20000000001 and render as a price nobody typed.
    billsTotal: Math.round(billsTotal * 100) / 100,
    asHost,
  };
}

/** How many people still owe on one split, for the per-row "2 of 5 paid". */
export function stillOwing(entry) {
  const people = Number(entry?.participants) || 0;
  const paid = Number(entry?.paid) || 0;
  return Math.max(0, people - paid);
}
