/**
 * What an even split would have cost you, against what you actually paid.
 *
 * ── Why this number exists ──────────────────────────────────────────────────
 *
 * It is the entire emotional payload of this product, and until now nothing
 * ever said it out loud. A diner who did not drink pays $18 on a bill where
 * "just split it six ways" would have taken $31 off them — and the app
 * delivered that quietly, as a total, with no indication that anything had
 * been avoided.
 *
 * "BillTap saved me $13 at dinner" is a sentence people send to friends.
 * "Try BillTap, it's free" is not, and that second one is what the share
 * button has been offering.
 *
 * The comparison was always one subtraction away: calcEvenShare already
 * existed in src/pages/Claim.jsx for even-mode splits, and every itemized
 * session already stores both the table total and what each person owes.
 *
 * ── Why a larger order is not reported as a loss ────────────────────────────
 *
 * Somebody who ordered more than the table average has a negative delta, and
 * rendering that as "you paid $6 more" would be both mean and wrong. They did
 * not overpay: they paid for what they ate. An even split is what would have
 * had somebody else quietly subsidise them.
 *
 * So the delta is always computed and returned honestly — a caller can see the
 * sign — but the copy for that case says what actually happened rather than
 * inventing a grievance. That is different from hiding bad news: there is no
 * defect here being concealed, only a refusal to frame a person's own dinner
 * as a shortfall.
 *
 * ── Where it does not apply ─────────────────────────────────────────────────
 *
 * Even splits, where the comparison is against itself and the answer is always
 * zero, and custom splits, where the host set the numbers by hand and "what an
 * even split would have cost" is not a claim this app is entitled to make
 * about their arrangement.
 */

/** Below this, a "saving" is rounding noise and not worth a line on screen. */
export const MIN_NOTABLE = 0.5;

const round2 = (n) => Math.round(n * 100) / 100;

/** What each person pays when a bill is divided without looking at it. */
export function evenShare(total, people) {
  const n = Number(people) || 0;
  if (n <= 0) return 0;
  return round2((Number(total) || 0) / n);
}

/**
 * One diner's comparison.
 *
 * @param {{ totalAmount?: any, people?: any, myShare?: any, splitMode?: string }} [input]
 * @returns {null | { even: number, actual: number, saved: number, notable: boolean }}
 *   `saved` is positive when the itemized split cost them less than an even
 *   one. null when there is no honest comparison to draw.
 */
export function fairnessFor({ totalAmount, people, myShare, splitMode = 'itemized' } = {}) {
  // Only itemized. See the header: an even split compared against itself is
  // always zero, and a custom split is the host's arrangement, not ours.
  if (splitMode !== 'itemized') return null;

  const n = Number(people) || 0;
  const total = Number(totalAmount);
  const actual = Number(myShare);
  if (n <= 1 || !Number.isFinite(total) || total <= 0 || !Number.isFinite(actual)) return null;

  const even = evenShare(total, n);
  const saved = round2(even - actual);

  return { even, actual, saved, notable: saved >= MIN_NOTABLE };
}

/**
 * The whole table's version, for the host's summary card.
 *
 * `moved` is how much money ended up with the people who actually owed it
 * rather than being averaged across everyone — the sum of what the diners who
 * came in under the even share were spared. It is deliberately not the sum of
 * every absolute difference, which double-counts the same dollars: money one
 * person did not pay is money somebody else did.
 *
 * @param {{ totalAmount?: any, participants?: any[], splitMode?: string }} [input]
 * @returns {null | { moved: number, biggest: number, spared: number, people: number }}
 */
export function tableFairness({ totalAmount, participants = [], splitMode = 'itemized' } = {}) {
  if (splitMode !== 'itemized') return null;

  const rows = Array.isArray(participants) ? participants : [];
  const n = rows.length;
  const total = Number(totalAmount);
  if (n <= 1 || !Number.isFinite(total) || total <= 0) return null;

  const even = evenShare(total, n);

  let moved = 0;
  let biggest = 0;
  let spared = 0;
  for (const p of rows) {
    /**
     * A diner who has not claimed anything yet is skipped, not counted at zero.
     *
     * `Number(null)` is 0 and passes every finite check, so a guard that only
     * asked for a finite number counted somebody still reading the menu as
     * having been spared the entire even share. On a split that is still in
     * progress — which is most of the time this runs — that inflated the
     * table stat on every poll.
     *
     * Requiring a positive amount also skips the genuine "ordered nothing"
     * case, and that is the right way round: a diner eating off someone
     * else's plate is rare, an unclaimed row mid-split is constant, and
     * overstating this number is the failure that matters.
     */
    const raw = p?.amount_owed;
    if (raw === null || raw === undefined || raw === '') continue;
    const owed = Number(raw);
    if (!Number.isFinite(owed) || owed <= 0) continue;
    const saved = even - owed;
    if (saved >= MIN_NOTABLE) {
      moved += saved;
      spared += 1;
      if (saved > biggest) biggest = saved;
    }
  }

  if (spared === 0) return null;
  return { moved: round2(moved), biggest: round2(biggest), spared, people: n };
}
