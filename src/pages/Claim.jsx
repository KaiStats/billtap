import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as Sentry from "@sentry/react";
import { invoke } from "@/api/functions";
import { Check, Loader2, ExternalLink, Copy, Smartphone, Search, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router";
import { useMutationOptimistic } from "@/hooks/useMutationOptimistic";
import { trackDeviceAction } from "@/lib/deviceAnalytics";
import { isHostOf } from "@/lib/hostKey";
import { useLiveSplit } from "@/hooks/useLiveSplit";
import { rememberSplit } from "@/lib/splitHistory";
import RatingCapture from "@/components/RatingCapture";
import { sessionPath } from '@/lib/sessionLinks';
import { paymentNote } from '@/lib/paymentNote';
import { fairnessFor } from '@/lib/fairness';
import { shareCardLines, drawShareCard, shareCardImage } from '@/lib/shareCard';
import { logClientError } from "@/lib/clientLog";

// Haptic feedback helper
const haptic = (pattern) => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};

function calcMyShare(items, myId, tax, tip) {
  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  let mySubtotal = 0;
  items.forEach(item => {
    const claimed = item.claimed_by || [];
    if (claimed.includes(myId)) {
      mySubtotal += (item.price * (item.quantity || 1)) / claimed.length;
    }
  });
  if (subtotal === 0) return mySubtotal;
  const ratio = mySubtotal / subtotal;
  return mySubtotal + (tax || 0) * ratio + (tip || 0) * ratio;
}

function calcEvenShare(totalAmount, participantCount) {
  if (participantCount === 0) return 0;
  return Math.round((totalAmount / participantCount) * 100) / 100;
}

export default function Claim() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const qrToken = params.get("token");
  const legacyId = params.get("id");
  const [sessionId, setSessionId] = useState(legacyId);
  const [tokenVerified, setTokenVerified] = useState(!qrToken);
  const [tokenError, setTokenError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [session, setSession] = useState(null);
  const [myId] = useState(() => {
    let id = localStorage.getItem("billtap_participant_id") || localStorage.getItem("divvy_participant_id");
    if (!id) { id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
    localStorage.setItem("billtap_participant_id", id);
    return id;
  });
  const [myName, setMyName] = useState(() => localStorage.getItem("billtap_participant_name") || localStorage.getItem("divvy_participant_name") || "");
  const [nameInput, setNameInput] = useState(() => localStorage.getItem("billtap_participant_name") || localStorage.getItem("divvy_participant_name") || "");
  const [loading, setLoading] = useState(true);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [zelleModalOpen, setZelleModalOpen] = useState(false);
  const [nameGateInput, setNameGateInput] = useState("");
  const [showNameGate, setShowNameGate] = useState(false);
  /**
   * They closed it, so stop asking.
   *
   * The gate is a full-screen opaque panel with no other control on it, so
   * without this the only way off it is to type a name — on a screen somebody
   * may well have opened just to see what the bill came to. Kept out of
   * localStorage on purpose: it is about this glance at this split, not a
   * standing refusal, and the header field is still there when they decide
   * they do want in.
   */
  const [nameGateDismissed, setNameGateDismissed] = useState(false);
  /** The item a guest reached for before we knew who they were. */
  const [pendingClaim, setPendingClaim] = useState(null);
  /**
   * The split was full when this guest tried to get in.
   *
   * Its own state rather than loadError: the split loaded fine and there is
   * nothing to retry. Retrying is what the other two error screens offer, and
   * offering it here would send an eleventh diner round a loop that cannot
   * succeed until somebody else acts.
   */
  const [partyFull, setPartyFull] = useState(null);
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    if (!qrToken) return;
    invoke("verifyQRToken", { qr_token: qrToken }).then(res => {
      if (res.data?.valid) {
        Sentry.addBreadcrumb({ category: 'qr', message: 'QR code scanned by participant', level: 'info' });
        setSessionId(res.data.session_id);
        setTokenVerified(true);
      } else {
        const err = new Error(res.data?.error || "Invalid or expired QR code");
        Sentry.captureException(err, { tags: { feature: 'qr_verify' } });
        setTokenError(res.data?.error || "Invalid or expired QR code");
      }
    }).catch(err => {
      // Without this the promise rejected into nothing: tokenVerified stayed
      // false, so fetchSession returned early and never cleared loading, and
      // the guest sat on a spinner for as long as they were willing to. On a
      // restaurant's wifi that is the single most likely failure at the table.
      Sentry.captureException(err, { tags: { feature: 'qr_verify' } });
      setTokenError("Couldn't check this code. Check your connection and try again.");
    });
  }, [qrToken]);

  /**
   * The first read of the split, through the same function the live poll uses.
   *
   * This was a direct entity read, which handed the browser the raw row: every
   * other diner's amount_owed, and the host key hash with it. getSplitStatus
   * returns the scoped view instead — names, who has settled, your own share —
   * so the opening read and every refresh afterwards now agree about what a
   * diner is allowed to see, rather than the first one being more generous.
   */
  const fetchSession = useCallback(async () => {
    if (!sessionId || !tokenVerified) return;
    try {
      const res = await invoke("getSplitStatus", { session_id: sessionId, participant_id: myId });
      const found = res.data?.session;
      if (found) {
        setSession(found);
        const existing = (found.participants || []).find(p => p.participant_id === myId);
        if (existing && existing.name) setMyName(existing.name);
      } else {
        setLoadError("This split couldn't be found. It may have expired.");
      }
    } catch (err) {
      // A split that is gone is not a connection problem, and telling someone
      // to check their wifi when the bill has expired sends them to look in the
      // wrong place. The entity read used to answer an empty list for this; the
      // function answers 404.
      if (err?.status === 404) {
        setLoadError("This split couldn't be found. It may have expired.");
        return;
      }
      Sentry.captureException(err, { tags: { feature: 'claim_fetch' } });
      setLoadError("Couldn't load this split. Check your connection and try again.");
    } finally {
      // In a finally: setLoading(false) used to be the last statement of the
      // happy path, so any throw above it left the spinner up permanently.
      setLoading(false);
    }
  }, [sessionId, myId, tokenVerified]);

  useEffect(() => {
    if (!sessionId) return;
    // This session's name first, then whatever name this person used last time.
    //
    // Only the per-session key was read, so a regular retyped their name on
    // every visit. At a table of six that is six people typing before anyone
    // can claim anything — most of the thirty seconds the product is sold on.
    // handleNameGateSubmit has always written the global key; nothing read it.
    //
    // divvy_ is the pre-rename key, checked so someone who used the app before
    // the rename is not asked again either.
    const stored =
      localStorage.getItem(`billtap-guest-name-${sessionId}`) ||
      localStorage.getItem("billtap_participant_name") ||
      localStorage.getItem("divvy_participant_name");

    if (stored && stored.trim().length >= 2) {
      const name = stored.trim();
      setMyName(name);
      setNameInput(name);
      // Pin it to this session as well, so renaming here later changes only
      // this split rather than the name they carry everywhere.
      localStorage.setItem(`billtap-guest-name-${sessionId}`, name);
    }
    /**
     * No name gate on arrival, deliberately.
     *
     * This used to open the moment the page loaded: a guest scanned the QR
     * expecting to see the check and got "What's your name?" on an otherwise
     * empty screen, before they knew what they were joining or what they owed.
     * A cold ask, at the one moment they had least reason to answer it.
     *
     * They see the bill first now, and the ask moves to the moment they claim
     * something -- by which point they have picked their steak and the
     * question answers itself. See toggleClaim.
     */
  }, [sessionId]);

  useEffect(() => { if (tokenVerified) fetchSession(); }, [fetchSession, tokenVerified]);

  /**
   * On an even or custom split there is nothing to tap, so the ask has to come
   * on arrival after all.
   *
   * ── The hole this closes ────────────────────────────────────────────────
   *
   * Moving the name question from page load to the moment somebody claims an
   * item was right for an itemized bill and stranded everyone on the other two
   * modes: toggleClaim is only reachable from the item list, and that list is
   * rendered `splitMode === "itemized"` only. A guest on an even split was
   * therefore never asked, never joined, and never appeared in
   * session.participants — so they were shown the whole bill as their share
   * instead of their fraction of it, the host never saw them, and marking
   * themselves paid answered 404 'Participant not found in session'.
   *
   * Waits for the session because split_mode lives on it; before it loads there
   * is no way to know which kind of bill this is. Itemized keeps the better
   * behaviour — bill first, name at the moment they reach for their steak.
   */
  useEffect(() => {
    if (!session || myName || showNameGate || nameGateDismissed) return;
    if ((session.split_mode || 'itemized') === 'itemized') return;
    setShowNameGate(true);
  }, [session, myName, showNameGate, nameGateDismissed]);

  /**
   * Finish the tap that asked the question.
   *
   * A guest reaches for their steak, is asked who they are, and answers. Doing
   * nothing with the item they tapped would make the name feel like a toll
   * rather than part of claiming it — they would have to find the steak again.
   *
   * Waits for the server to confirm the join, not merely for the name to be
   * set, and that distinction is the whole correctness of this effect.
   *
   * ── The race it removes ─────────────────────────────────────────────────
   *
   * handleNameGateSubmit calls setMyName and only then awaits ensureJoined.
   * React flushes the state update first, so gating on `myName` ran this effect
   * while the very first joinSession was still in flight — and toggleClaim
   * issues its own join. Two requests for one brand-new participant, neither
   * holding a participant_key yet, so the server minted a key on both. The
   * first won the compare-and-swap and its hash was stored; the second lost,
   * retried, kept the stored hash — but still answered with its own key, and
   * being the later response it was the one the browser wrote to localStorage.
   *
   * From then on the device held a key the server had never seen. Every call as
   * that diner failed isParticipant: taps rolled back with a toast, and
   * "I've Sent Payment" 403'd forever with nothing on screen explaining why.
   *
   * Membership in session.participants can only appear after ensureJoined's
   * response has been written into state, so this condition cannot be true
   * while a join is still open. It also fails closed: if the join was refused —
   * a full party, a dead connection — the pending tap simply never fires,
   * rather than firing a claim on behalf of somebody who is not in the split.
   *
   * Cleared before claiming so a re-render cannot fire it twice.
   */
  useEffect(() => {
    if (!pendingClaim || !session) return;
    const joined = (session.participants || []).some(p => p.participant_id === myId);
    if (!joined) return;
    const itemId = pendingClaim;
    setPendingClaim(null);
    toggleClaim(itemId);
    // toggleClaim is redefined every render and depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClaim, session, myId]);

  /**
   * Live, at last.
   *
   * This was a Session.subscribe() that could never fire for a guest — the
   * socket is anonymous and Session's read rule does not match them — so the
   * ticks beside everyone's name only ever showed what was true when the page
   * loaded. It also wrote event.data straight into state, which is the raw row:
   * every other diner's amount_owed, and the host key hash along with it.
   */
  useLiveSplit(sessionId, {
    participantId: myId,
    onUpdate: (fresh) => {
      setSession(fresh);
      // Every diner keeps their own record of a bill they ate at, not only the
      // person who photographed it. Written from the live read so the summary
      // on the history screen is the last thing that was actually true.
      rememberSplit({
        id: fresh.id,
        title: fresh.title,
        total: fresh.total_amount,
        status: fresh.status,
        participants: (fresh.participants || []).length,
        paid: (fresh.participants || []).filter((p) => p.payment_status === "paid").length,
        role: isHostOf(sessionId) ? "host" : "guest",
      });
    },
    enabled: Boolean(sessionId) && tokenVerified,
  });

  const ensureJoined = async (name) => {
    try {
      const res = await invoke("joinSession", {
        session_id: sessionId,
        participant_id: myId,
        name: name || "Anonymous",
      });
      if (res.data?.session) setSession(res.data.session);
    } catch (err) {
      /**
       * Caught, because this used to throw into nothing.
       *
       * ensureJoined is awaited from the name gate with no catch anywhere
       * above it, so a refusal surfaced as an unhandled rejection: the gate
       * closed, the guest was never added, and the screen sat there looking
       * like it had worked. That was true of every failure this call can
       * produce, and the party limit added a new one that a guest will
       * actually hit.
       */
      const code = /** @type {any} */ (err)?.data?.code;
      if (code === "party_limit" || code === "session_full") {
        setPartyFull(/** @type {any} */ (err)?.data?.error || "This split is full.");
        return;
      }
      logClientError("join a split", err, { feature: "claim_join" });
      setLoadError(/** @type {any} */ (err)?.message || "Could not join this split.");
    }
  };

  const handleNameGateSubmit = async () => {
    const name = nameGateInput.trim();
    if (name.length < 2) return;
    localStorage.setItem(`billtap-guest-name-${sessionId}`, name);
    localStorage.setItem("billtap_participant_name", name);
    setMyName(name);
    setNameInput(name);
    setShowNameGate(false);
    await ensureJoined(name);
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'guest_joined', { session_id: sessionId });
    }
  };

  const handleNameBlur = async () => {
    const name = nameInput.trim();
    if (name !== myName) {
      localStorage.setItem("billtap_participant_name", name);
      setMyName(name);
      await ensureJoined(name);
    }
  };

  const claimMutation = useMutationOptimistic(
    async ({ optimisticItems, optimisticParticipants }) => {
      const res = await invoke("joinSession", {
        session_id: sessionId,
        participant_id: myId,
        name: nameInput.trim() || myName || "Anonymous",
        items: optimisticItems,
        participants: optimisticParticipants,
      });
      return res.data?.session;
    },
    {
      onOptimisticState: () => session,
      onRollback: (snapshot) => setSession(snapshot),
      onSuccess: (updated) => setSession(updated),
    }
  );

  /**
   * "Somebody else grabbed that one."
   *
   * Not an error — it is the expected outcome of six people claiming from the
   * same list at the same time, which is the product working. It was an
   * alert(), which froze the phone of the person who lost the race and made a
   * normal event feel like a fault. A transient line instead, polite rather
   * than assertive, so a screen reader finishes announcing the item before
   * mentioning it.
   */
  const [taken, setTaken] = useState(null);
  const takenTimer = useRef(null);

  const announceTaken = (message) => {
    setTaken(message);
    clearTimeout(takenTimer.current);
    takenTimer.current = setTimeout(() => setTaken(null), 4000);
  };

  // Without this a pending timer fires on an unmounted component when somebody
  // navigates away mid-claim.
  useEffect(() => () => clearTimeout(takenTimer.current), []);

  const toggleClaim = async (itemId) => {
    if (!session) return;
    /**
     * The name, asked here rather than at the door.
     *
     * The item they tapped is remembered and claimed for them as soon as they
     * give it, so answering the question is not a detour -- they land back on
     * exactly the thing they reached for.
     */
    if (!myName) {
      setPendingClaim(itemId);
      setShowNameGate(true);
      return;
    }
    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    const currentlyClaimed = item.claimed_by || [];
    const isMine = currentlyClaimed.includes(myId);
    if (isMine) {
      haptic([30]);
      const optimisticItems = session.items.map(i => i.id !== itemId ? i : { ...i, claimed_by: currentlyClaimed.filter(id => id !== myId) });
      const optimisticParticipants = (session.participants || []).map(p => ({ ...p, amount_owed: Math.round(calcMyShare(optimisticItems, p.participant_id, session.tax, session.tip) * 100) / 100 }));
      claimMutation.mutate({ optimisticItems, optimisticParticipants });
      return;
    }
    /**
     * The one item that cannot be joined, caught before the round trip.
     *
     * The button for this is already disabled, so reaching here means somebody
     * settled in the moment between the last render and this tap. Answering it
     * on the phone keeps the `item_settled` refusal in
     * worker/routes/functions.js as the backstop it should be rather than the
     * thing the diner actually meets.
     */
    if (currentlyClaimed.length > 0) {
      const settledClaimer = (session.participants || []).find(
        p => currentlyClaimed.includes(p.participant_id) && p.payment_status === "paid",
      );
      if (settledClaimer) {
        announceTaken(`${settledClaimer.name || "Someone"} already paid for that one.`);
        return;
      }
    }

    /**
     * Joining an item somebody else already tapped splits it, rather than
     * bouncing off it.
     *
     * This used to announce "someone just grabbed that one" and return, so the
     * shared plate went entirely onto whoever was quickest. The `÷N` badge and
     * the "You: $x" line further down the file were written for this and could
     * never appear.
     *
     * The array is appended to, not replaced: replacing it would drop the
     * existing claimers on the floor optimistically and then snap back when
     * the server answered with them still attached.
     */
    haptic([50]);
    const optimisticItems = session.items.map(i => i.id !== itemId ? i : { ...i, claimed_by: [...currentlyClaimed, myId] });
    const optimisticParticipants = (session.participants || []).map(p => ({ ...p, amount_owed: Math.round(calcMyShare(optimisticItems, p.participant_id, session.tax, session.tip) * 100) / 100 }));
    claimMutation.mutate({ optimisticItems, optimisticParticipants });
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'item_claimed', { item_name: item.name, amount: item.price });
    }
  };

  const expandItem = async (itemId) => {
    if (!session) return;
    const item = session.items.find(i => i.id === itemId);
    if (!item || !item.quantity || item.quantity <= 1) return;
    haptic([50]);
    const expandedItems = [];
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({
        ...item,
        id: `${item.id}-${i}`,
        quantity: 1,
        claimed_by: [],
      });
    }
    const optimisticItems = session.items
      .filter(i => i.id !== itemId)
      .concat(expandedItems);
    const optimisticParticipants = (session.participants || []).map(p => ({ ...p, amount_owed: Math.round(calcMyShare(optimisticItems, p.participant_id, session.tax, session.tip) * 100) / 100 }));
    claimMutation.mutate({ optimisticItems, optimisticParticipants });
  };

  const claimAll = () => {
    if (!session) return;
    haptic([50, 30, 100]);
    const optimisticItems = session.items.map(i => {
      const claimed = i.claimed_by || [];
      // Only claim unclaimed items
      if (claimed.length === 0) return { ...i, claimed_by: [myId] };
      return i;
    });
    const optimisticParticipants = (session.participants || []).map(p => ({ ...p, amount_owed: Math.round(calcMyShare(optimisticItems, p.participant_id, session.tax, session.tip) * 100) / 100 }));
    claimMutation.mutate({ optimisticItems, optimisticParticipants });
    setItemSearch("");
  };

  const paidMutation = useMutationOptimistic(
    async () => {
      const res = await invoke("markMePaid", {
        session_id: sessionId,
        participant_id: myId,
      });
      return res.data?.session;
    },
    { onOptimisticState: () => session, onRollback: (s) => setSession(s), onSuccess: (u) => setSession(u) }
  );

  const markMePaid = () => {
    haptic([100]);
    trackDeviceAction('payment_completed');
    paidMutation.mutate();
    setShowPaymentModal(false);
    // Restaurant sessions only: catch the guest while they're still at the table.
    if (session.restaurant_id) setShowRating(true);
  };

  /** The line the host reads in their feed. See src/lib/paymentNote.js. */
  const myPaymentNote = () => paymentNote(myName, session?.title);

  const handlePaymentClick = () => {
    const hostInfo = session.host_payment_info;
    if (!hostInfo) { setShowPaymentModal(true); return; }

    const amount = myShare.toFixed(2);
    const note = encodeURIComponent(myPaymentNote());

    Sentry.addBreadcrumb({ category: 'payment', message: `Payment handoff: ${hostInfo.method}`, level: 'info' });
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'payment_initiated', { amount: myShare, method: hostInfo.method });
    }

    if (hostInfo.method === "venmo") {
      const handle = hostInfo.handle.replace(/^@/, '');
      const deepLink = `venmo://paycharge?txn=pay&recipients=@${handle}&amount=${amount}&note=${note}`;
      const webFallback = `https://venmo.com/u/${handle}?txn=pay&amount=${amount}&note=${note}`;
      window.location.href = deepLink;
      setTimeout(() => window.open(webFallback, '_blank'), 2000);
      return;
    }

    if (hostInfo.method === "cashapp") {
      const handle = hostInfo.handle.replace(/^\$/, '');
      const deepLink = `cashapp://cash.app/$${handle}/${amount}`;
      const webFallback = `https://cash.app/$${handle}`;
      window.location.href = deepLink;
      setTimeout(() => window.open(webFallback, '_blank'), 2000);
      return;
    }

    if (hostInfo.method === "zelle") {
      setZelleModalOpen(true);
      return;
    }

    setShowPaymentModal(true);
  };

  // Derived state — must be above all early returns (Rules of Hooks).
  //
  // These two are memoised on the array identity rather than written as plain
  // `|| []` fallbacks: every `useMemo` below depends on them, and a fresh `[]`
  // on each render would invalidate all of them on every render, which is the
  // opposite of what those memos are for.
  const items = useMemo(() => session?.items || [], [session?.items]);
  const participants = useMemo(() => session?.participants || [], [session?.participants]);
  const splitMode = session?.split_mode || "itemized";
  const isExpired = session?.expires_at && session.expires_at < Date.now();

  const claimedCount = useMemo(
    () => items.filter(i => (i.claimed_by || []).length > 0).length,
    [items]
  );

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return items;
    const q = itemSearch.toLowerCase();
    return items.filter(i => i.name?.toLowerCase().includes(q));
  }, [items, itemSearch]);

  const unclaimedCount = useMemo(
    () => items.filter(i => (i.claimed_by || []).length === 0).length,
    [items]
  );

  const myMyClaimed = useMemo(
    () => splitMode === "itemized" ? items.filter(i => (i.claimed_by || []).includes(myId)) : [],
    [items, myId, splitMode]
  );

  const myShare = useMemo(() => {
    if (!session) return 0;
    if (splitMode === "even") return calcEvenShare(session.total_amount || 0, participants.length);
    if (splitMode === "custom") return participants.find(p => p.participant_id === myId)?.amount_owed || 0;
    return calcMyShare(items, myId, session.tax, session.tip);
  }, [session, splitMode, participants, items, myId]);

  /**
   * What "just split it evenly" would have cost this diner.
   *
   * The emotional core of the product, and until now the app delivered it
   * silently: a total, with no sign that anything had been avoided. Somebody
   * who did not drink pays $18 on a bill where six ways would have taken $31
   * off them, and nothing on the screen said so.
   *
   * Null for even and custom splits, and for a difference small enough to be
   * rounding noise. See src/lib/fairness.js — including why a diner who
   * ordered more than the average is never told they lost.
   */
  const fairness = useMemo(
    () => fairnessFor({
      totalAmount: session?.total_amount,
      people: participants.length,
      myShare,
      splitMode,
    }),
    [session, participants.length, myShare, splitMode],
  );

  /**
   * The diner's own saving, as a picture.
   *
   * Falls all the way back to the clipboard rather than doing nothing — see
   * shareCardImage. A tap that appears to have no effect is the worst
   * available outcome for a button somebody pressed on purpose.
   */
  const shareMySaving = async () => {
    if (!fairness) return;
    const lines = shareCardLines({
      title: session?.title,
      people: participants.length,
      total: session?.total_amount,
      fairness,
    });
    const blob = await drawShareCard(lines);
    const result = await shareCardImage({
      blob,
      text: `Split dinner with BillTap — I paid $${fairness.actual.toFixed(2)} instead of $${fairness.even.toFixed(2)}.`,
    });
    if (result === "copied") announceTaken("Copied — paste it anywhere.");
  };

  const meParticipant = participants.find(p => p.participant_id === myId);
  const payStatus = meParticipant?.payment_status;
  // markMePaid writes "pending_verification", never "paid" — only the host
  // confirming does that. Checking for "paid" alone meant the guest tapped
  // "I've Sent Payment", nothing changed, and the button stayed live and
  // re-opened Venmo prefilled with the same amount. Someone pays twice.
  // SessionHost already treats both as settled; this now matches it.
  const paymentSent = payStatus === "paid" || payStatus === "pending_verification";
  const alreadyPaid = paymentSent;
  const awaitingHost = payStatus === "pending_verification";

  if (tokenError) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-center px-6">
      <div>
        <p className="text-lg font-semibold">QR code expired or invalid</p>
        <p className="text-sm mt-1">{tokenError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-3 rounded-2xl font-bold bg-brand text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );

  if (partyFull) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-center px-6">
      <div>
        <p className="text-lg font-semibold text-foreground">This split is full</p>
        <p className="text-sm mt-2 max-w-xs">{partyFull}</p>
        {/* No retry. Nothing this guest can do makes room -- the person who
            started the split has to upgrade or start a second one -- and a
            button that fails every time is worse than no button. */}
      </div>
    </div>
  );

  if (loadError) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-center px-6">
      <div>
        <p className="text-lg font-semibold">Couldn't load this split</p>
        <p className="text-sm mt-1">{loadError}</p>
        <button
          onClick={() => { setLoadError(null); setLoading(true); fetchSession(); }}
          className="mt-6 px-6 py-3 rounded-2xl font-bold bg-brand text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );

  if (!sessionId && !qrToken) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-center px-6">
      <div><p className="text-lg font-semibold">No session found</p><p className="text-sm mt-1">Please scan the QR code again.</p></div>
    </div>
  );

  if (!tokenVerified) return (
    <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="w-8 h-8 animate-spin text-brand" aria-label="Verifying QR code" />
      <span className="sr-only">Verifying QR code</span>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite" aria-busy="true">
      <Loader2 className="w-8 h-8 animate-spin text-brand" aria-label="Loading session" />
      <span className="sr-only">Loading your split session</span>
    </div>
  );

  if (!session) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Session not found.</div>;
  if (isExpired) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-center px-6">
      <div><p className="text-lg font-semibold">This session has expired</p><p className="text-sm mt-1">Sessions are active for 30 days.</p></div>
    </div>
  );

  const getName = (pid) => {
    if (pid === myId) return "You";
    const p = participants.find(x => x.participant_id === pid);
    return p ? p.name : "Someone";
  };

  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: "calc(8rem + env(safe-area-inset-bottom))" }}>
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-10 px-4 py-3"
        style={{ background: 'linear-gradient(165deg, #070b16 0%, #0d1728 100%)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="max-w-lg mx-auto space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-black text-white text-base">{session.title}</h1>
              <p className="text-xs text-white/50">
                {splitMode === "itemized" ? "Tap what you ordered 👆" : splitMode === "even" ? "Split equally among guests" : "Custom split"}
              </p>
            </div>
            {splitMode === "itemized" && (
              <div className="text-right">
                <div className="text-xs text-white/40">{claimedCount}/{items.length} claimed</div>
                <div role="progressbar" aria-valuenow={claimedCount} aria-valuemin={0} aria-valuemax={items.length} aria-label="Items claimed" className="w-24 bg-white/10 rounded-full h-1.5 mt-1">
                  <div className="h-1.5 rounded-full transition-all" style={{ width: `${items.length > 0 ? (claimedCount / items.length) * 100 : 0}%`, background: 'linear-gradient(90deg, #00c896, #2ee6b0)' }} />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="participant-name" className="text-xs text-white/40 shrink-0">Your name:</label>
            <input
              id="participant-name"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={e => e.key === "Enter" && /** @type {HTMLElement} */ (e.target).blur()}
              placeholder="optional"
              autoComplete="nickname"
              aria-label="Your name (optional)"
              className="flex-1 h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              style={{ minHeight: "44px", fontSize: "16px" }}
            />
          </div>
        </div>
      </div>

      {/* Items - Only for itemized mode */}
      {splitMode === "itemized" && (
        <div className="max-w-lg mx-auto px-4 py-4 space-y-2">
          {/*
            Reserved space is deliberate: appearing and disappearing text that
            reflows the list would move the next item out from under a thumb
            that is already on its way down.
          */}
          <div className="min-h-[1.5rem]" role="status" aria-live="polite">
            {taken && (
              <p className="text-sm font-medium text-amber-300">{taken}</p>
            )}
          </div>

          {/* Search + Claim All toolbar */}
          <div className="flex gap-2 items-center pb-1">
            {items.length >= 8 && (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" aria-hidden="true" />
                <input
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  placeholder="Search items…"
                  aria-label="Search items"
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                  style={{ fontSize: "16px" }}
                />
              </div>
            )}
            {unclaimedCount > 0 && (
              <button
                onClick={claimAll}
                aria-label="Claim all unclaimed items"
                className="flex items-center gap-1.5 px-3 h-10 rounded-xl text-xs font-bold text-white whitespace-nowrap shrink-0 transition-all active:scale-95"
                style={{ background: 'rgba(0,200,150,0.2)', border: '1px solid rgba(0,200,150,0.35)' }}
              >
                <CheckCheck className="w-4 h-4" aria-hidden="true" />
                Claim All
              </button>
            )}
          </div>

          {filteredItems.map(item => {
            const claimed = item.claimed_by || [];
            const isMine = claimed.includes(myId);
            const itemTotal = item.price * (item.quantity || 1);
            const myCost = isMine ? itemTotal / claimed.length : 0;
            /**
             * What tapping this would cost — one more way than it is split now.
             *
             * Shown before the tap, not after. "Share — $6.00" answers the
             * question the diner actually has when reaching for a plate two
             * other people are already on.
             */
            const costIfJoined = itemTotal / (claimed.length + 1);
            const sharedByOthers = claimed.length > 0 && !isMine;
            /**
             * The only unjoinable item: one whose claimer has already settled.
             *
             * Their amount is frozen server-side, so it cannot be recomputed
             * to make room — joining would have the table collect more than
             * the plate cost. Matches the `item_settled` refusal in
             * worker/routes/functions.js.
             */
            const lockedBySettled = sharedByOthers && claimed.some(
              pid => (participants || []).find(p => p.participant_id === pid)?.payment_status === "paid",
            );
            const claimerInitial = claimed.length > 0 ? ((participants || []).find(p => p.participant_id === claimed[0])?.name?.[0] || "?") : "";

            return (
              <button
                key={item.id}
                onClick={() => !lockedBySettled && toggleClaim(item.id)}
                aria-label={
                  isMine
                    ? `Remove yourself from ${item.name}`
                    : lockedBySettled
                    ? `${item.name} is already paid for`
                    : sharedByOthers
                    ? `Share ${item.name}, ${(claimed.length + 1)} ways, $${costIfJoined.toFixed(2)} each`
                    : `Claim ${item.name}`
                }
                aria-pressed={isMine}
                disabled={lockedBySettled}
                className={`w-full text-left p-4 rounded-2xl transition-[transform,border-color,background-color] duration-200 ease-out-expo enabled:active:scale-[0.98] ${
                  isMine
                    ? "border-2 border-primary shadow-glow"
                    : lockedBySettled
                    ? "opacity-50 cursor-not-allowed border-2 border-transparent"
                    : "border-2 border-transparent hover:border-primary/30 hover:-translate-y-0.5"
                }`}
                style={
                  isMine
                    ? { background: 'rgba(0,200,150,0.15)' }
                    : lockedBySettled
                    ? { background: 'rgba(255,255,255,0.02)', border: '2px solid transparent' }
                    : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isMine ? "bg-primary border-primary" : sharedByOthers ? "bg-white/10 border-white/20" : "border-white/20"
                    }`}>
                      {isMine && <Check className="animate-pop w-3.5 h-3.5 text-primary-foreground" aria-hidden="true" />}
                      {sharedByOthers && <span className="text-xs font-bold text-white/50">{claimerInitial}</span>}
                    </div>
                    <div>
                      <div className={`font-semibold text-sm ${isMine ? "text-white" : lockedBySettled ? "text-white/30 line-through" : "text-foreground"}`}>
                        {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                      </div>
                      {claimed.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {claimed.map(pid => (
                            <span key={pid} className={`text-xs px-1.5 py-0.5 rounded-full ${pid === myId ? "bg-brand/20 text-brand-muted-foreground" : "bg-white/5 text-white/40"}`}>
                              👤 {getName(pid)}
                            </span>
                          ))}
                          {claimed.length > 1 && <span className="text-xs text-white/30">÷{claimed.length}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2 flex flex-col items-end gap-1">
                    <div className={`mono font-bold text-sm tabular-nums ${lockedBySettled ? "text-white/30" : "text-foreground"}`}>${itemTotal.toFixed(2)}</div>
                    {isMine && claimed.length > 1 && <div className="mono text-xs text-primary font-semibold tabular-nums">You: ${myCost.toFixed(2)}</div>}
                    {/* The offer, before the tap: what this costs if you join. */}
                    {sharedByOthers && !lockedBySettled && (
                      <div className="mono text-xs text-primary font-semibold tabular-nums">Share: ${costIfJoined.toFixed(2)}</div>
                    )}
                    {lockedBySettled && <div className="text-xs text-white/30 font-semibold">Paid</div>}
                    {item.quantity > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          expandItem(item.id);
                        }}
                        className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors py-1"
                        aria-label={`Expand ${item.name} into ${item.quantity} individual items`}
                      >
                        Expand ↓
                      </button>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Add Item Section — HOSTS ONLY */}
          {!qrToken && (
            <div className="pt-2 border-t border-white/10">
              <button
                onClick={() => {/* TODO: open add-item modal or navigate to edit */}}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-white/20 text-white/50 hover:border-brand hover:text-brand transition-all font-semibold text-sm"
                aria-label="Add a new item to the bill"
              >
                + Add Item
              </button>
            </div>
          )}

          {/* Guest-only notice */}
          {qrToken && (
            <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs space-y-1">
              <p className="font-semibold">🔒 Guest Mode</p>
              <p>You're claiming items from this bill. Only the host can add or edit items.</p>
            </div>
          )}

          {/* Participants */}
          {(participants || []).length > 1 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground font-medium mb-2">In this split:</p>
              <div className="flex gap-2 flex-wrap">
                {participants.map(p => (
                  <div key={p.participant_id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${p.participant_id === myId ? "bg-brand/20 text-brand-muted-foreground border border-brand/30" : "bg-white/5 text-white/50 border border-white/10"}`}>
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] bg-current opacity-60">{(p.name || "?")[0].toUpperCase()}</div>
                    {p.participant_id === myId ? "You" : p.name}
                    {/* Two different facts, so two different marks. One tick
                        used to mean either, which left the table unable to tell
                        who the host had actually confirmed from who had merely
                        tapped the button — and the hourglass is exactly the
                        state that still needs checking. */}
                    {p.payment_status === "paid" && <span title="Confirmed by the host"> ✓</span>}
                    {p.payment_status === "pending_verification" && <span title="Sent — waiting for the host to confirm"> ⏳</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Even/Custom Split Info */}
      {splitMode !== "itemized" && (
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="text-5xl mb-4">{splitMode === "even" ? "⚖️" : "📊"}</div>
            <h2 className="text-xl font-bold text-white mb-2">
              {splitMode === "even" ? "Even Split" : "Custom Split"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {splitMode === "even" 
                ? `The total bill of $${(session.total_amount || 0).toFixed(2)} is split equally among ${participants.length} participant${participants.length !== 1 ? "s" : ""}.`
                : "Your share has been set by the host."
              }
            </p>
            <div className="mt-6 p-4 rounded-xl" style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.3)' }}>
              <p className="text-xs text-white/50 mb-1">Your share</p>
              <p className="mono text-4xl font-semibold tabular-nums text-primary">${myShare.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Name Gate Modal */}
      {showNameGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'linear-gradient(165deg, #070b16 0%, #0d1728 100%)' }}>
          <div className="w-full max-w-sm space-y-6 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl text-primary-foreground bg-primary shadow-glow">
                BT
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white">What's your name?</h1>
              <p className="text-sm text-white/50">The host wants to know who's paying for what 👀</p>
            </div>
            <input
              autoFocus
              value={nameGateInput}
              onChange={e => setNameGateInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && nameGateInput.trim().length >= 2 && handleNameGateSubmit()}
              placeholder="First name is fine"
              autoComplete="given-name"
              className="w-full h-14 rounded-2xl border border-white/10 bg-white/5 px-4 text-center text-lg text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              style={{ fontSize: "16px" }}
            />
            <button
              onClick={handleNameGateSubmit}
              disabled={nameGateInput.trim().length < 2}
              className="press w-full h-14 rounded-2xl font-bold bg-primary text-primary-foreground text-lg shadow-glow transition hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
            >
              Join the Split →
            </button>
            <button
              onClick={() => { setShowNameGate(false); setNameGateDismissed(true); setPendingClaim(null); }}
              className="w-full text-sm text-white/40 underline underline-offset-4 hover:text-white/70"
            >
              Just looking at the bill
            </button>
          </div>
        </div>
      )}

      {/* Zelle Modal */}
      {zelleModalOpen && session.host_payment_info && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setZelleModalOpen(false)}>
          <Card className="w-full max-w-sm rounded-2xl" onClick={e => e.stopPropagation()}>
            <CardHeader className="pb-3"><CardTitle className="text-lg">Send via Zelle</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-1">Send to:</p>
                <p className="text-lg font-bold text-foreground">{session.host_payment_info.handle}</p>
                <p className="mono text-3xl font-semibold tabular-nums text-primary mt-2">${myShare.toFixed(2)}</p>
              </div>

              {/*
                The memo, because Zelle is typed by hand.
                Venmo and Cash App get the note attached to the deep link; here
                the diner is entering everything themselves, so the one line
                that tells the host which payment this is has to be visible and
                copyable rather than assumed.
              */}
              <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-xs text-muted-foreground mb-1">Put this in the memo so your host knows it&apos;s you:</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground truncate flex-1">{myPaymentNote()}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Copy the payment memo"
                    onClick={() => navigator.clipboard.writeText(myPaymentNote())}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(session.host_payment_info.handle)} className="flex-1">
                  <Copy className="w-4 h-4 mr-2" /> Copy
                </Button>
                <Button onClick={() => { setZelleModalOpen(false); markMePaid(); }} className="flex-1 bg-brand hover:bg-brand/90">I've Sent Payment</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowPaymentModal(false)}>
          <Card className="w-full max-w-sm rounded-2xl" onClick={e => e.stopPropagation()}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2"><Smartphone className="w-5 h-5" /> Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">You owe</p>
                <p className="mono text-3xl font-semibold tabular-nums text-primary">${myShare.toFixed(2)}</p>
              </div>
              {session.host_payment_info ? (
                <>
                  <p className="text-xs text-muted-foreground text-center">
                    Send to <strong className="text-foreground">{session.host_payment_info.handle}</strong> via {session.host_payment_info.method === "venmo" ? "Venmo" : session.host_payment_info.method === "cashapp" ? "Cash App" : "Zelle"}
                  </p>
                  <Button onClick={markMePaid} className="w-full bg-brand hover:bg-brand/90 font-bold rounded-xl h-12">✓ I've Sent Payment</Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground text-center">Ask the host how they want to be paid</p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => navigator.clipboard.writeText(`I owe $${myShare.toFixed(2)} for ${session.title}`)} className="flex-1">
                      <Copy className="w-4 h-4 mr-2" /> Copy Total
                    </Button>
                    <Button onClick={markMePaid} className="flex-1 bg-brand hover:bg-brand/90">Mark as Sent</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sticky Bottom Bar */}
      <div
        role="region"
        aria-label="Your bill summary"
        className="fixed bottom-0 left-0 right-0 shadow-2xl p-4"
        style={{ background: 'rgba(15,12,41,0.95)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.1)', paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-lg mx-auto space-y-3">
          {splitMode === "itemized" ? (
            myMyClaimed.length > 0 ? (
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-white text-sm">You owe</div>
                  <div className="text-xs text-white/50">{myMyClaimed.length} item{myMyClaimed.length !== 1 ? "s" : ""} + tax &amp; tip</div>
                  {/*
                    The comparison, right beside the number it is about.
                    "You owe $18" is a utility. "$18 — $13 less than an even
                    split would have taken" is the thing somebody repeats to
                    a friend, and it is one subtraction away from data the
                    session already holds.
                  */}
                  {fairness?.notable && (
                    <div className="text-xs font-semibold mt-1" style={{ color: "#00c896" }}>
                      ${fairness.saved.toFixed(2)} less than splitting evenly
                    </div>
                  )}
                </div>
                <div className="mono text-3xl font-semibold tabular-nums text-primary">${myShare.toFixed(2)}</div>
              </div>
            ) : (
              <p className="text-center text-white/40 text-sm">Tap items above to claim them</p>
            )
          ) : (
            <div className="flex justify-between items-center">
              <div>
                <div className="font-bold text-white text-sm">You owe</div>
                <div className="text-xs text-white/50">
                  {splitMode === "even" ? `${participants.length} way split` : "Custom amount"}
                </div>
              </div>
              <div className="mono text-3xl font-semibold tabular-nums text-primary">${myShare.toFixed(2)}</div>
            </div>
          )}
          {session.host_payment_info && (splitMode === "itemized" ? myMyClaimed.length > 0 : true) && !alreadyPaid ? (
            <button
              onClick={handlePaymentClick}
              disabled={splitMode === "itemized" && myMyClaimed.length === 0}
              aria-label={`Pay $${myShare.toFixed(2)} via ${session.host_payment_info.method}`}
              className="press w-full h-14 bg-primary text-primary-foreground font-bold rounded-2xl flex items-center justify-center gap-2 shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              Pay <span className="mono tabular-nums">${myShare.toFixed(2)}</span> <ExternalLink className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={markMePaid}
              // Disabled once sent, whatever the split mode. Previously the
              // guard only applied to itemized, so on an even or custom split
              // the button stayed tappable after payment and fired markMePaid
              // again.
              disabled={paymentSent || (splitMode === "itemized" && myMyClaimed.length === 0)}
              aria-label={awaitingHost ? "Payment sent, waiting for the host to confirm" : paymentSent ? "Payment confirmed by the host" : `Pay $${myShare.toFixed(2)}`}
              className={`press w-full h-14 font-bold rounded-2xl flex items-center justify-center gap-2 transition disabled:opacity-100 ${paymentSent ? "bg-success text-white shadow-none" : "bg-primary text-primary-foreground shadow-glow hover:brightness-110"}`}
            >
              {/* "Marked as Paid" was the same words for both states. A diner
                  who had merely tapped the button and one whose host had
                  actually confirmed the transfer read the identical screen. */}
              {awaitingHost ? "✓ Sent — waiting for host" : paymentSent ? "✓ Confirmed by host" : `Pay $${myShare.toFixed(2)}`}
            </button>
          )}

          {/*
            The two seconds after paying, which is the only moment this is
            worth saying.

            They have just watched the app take $13 off what six-ways would
            have cost them. That is the sentence people repeat, and it has
            never been offered to them in a form they could send. The share
            hands over a picture rather than a paragraph — see
            src/lib/shareCard.js.

            Deliberately not an install prompt. PWAInstallPrompt already asks
            on a *second* visit, on the reasoning that a diner mid-meal should
            not be interrupted, and that reasoning is right. This is a line and
            a link, not a takeover.
          */}
          {paymentSent && fairness?.notable && (
            <div className="rounded-2xl p-4" style={{ background: "rgba(0,200,150,0.08)", border: "1px solid rgba(0,200,150,0.25)" }}>
              <div className="text-sm font-bold" style={{ color: "#00c896" }}>
                You paid ${fairness.actual.toFixed(2)} instead of ${fairness.even.toFixed(2)}
              </div>
              <div className="text-xs mt-0.5 text-white/50">
                An even split would have cost you ${fairness.saved.toFixed(2)} more.
              </div>
              <button
                onClick={shareMySaving}
                className="mt-3 w-full h-11 rounded-xl font-bold text-sm bg-primary text-primary-foreground active:scale-[0.99] transition"
              >
                Share this
              </button>
              <button
                onClick={() => navigate("/new-receipt")}
                className="mt-2 w-full h-10 rounded-xl font-semibold text-xs text-white/50"
              >
                Next time, you start it →
              </button>
            </div>
          )}

          {/* The person who made this split is at the table eating too, so they
              land here like everyone else. This is their way to the screen that
              lists who has paid — without it a table-tent host, who has no
              account and so never sees /session-host, had no route to it at
              all. */}
          {isHostOf(sessionId) && (
            <button
              onClick={() => navigate(sessionPath('/receipt-detail', sessionId))}
              className="w-full h-12 rounded-2xl font-semibold text-sm bg-white/[0.06] border border-white/12 text-foreground active:scale-[0.99] transition-all"
            >
              Who&apos;s paid? →
            </button>
          )}
        </div>
      </div>
      {showRating && session?.restaurant_id && (
        <RatingCapture
          restaurantId={session.restaurant_id}
          sessionId={sessionId}
          onDismiss={() => setShowRating(false)}
        />
      )}
    </div>
  );
}