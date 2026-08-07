import { useState, useEffect } from "react";
import { Star, Loader2, Check, ExternalLink } from "lucide-react";
import { invoke } from "@/api/functions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shown once a guest marks their share paid.
 *
 * This is the whole restaurant product in one screen: the operator hears about
 * an unhappy guest while that guest is still in the building, and every guest
 * is offered the restaurant's Google listing on the way out.
 *
 * ── Why every guest, and not just the happy ones ────────────────────────────
 *
 * This used to fork: above the threshold you got the Google button, at or below
 * it you got a private feedback box and no button at all. That is review
 * gating. Two things are wrong with it.
 *
 * It is against the rules of both parties involved. The FTC's consumer review
 * rule treats suppressing solicited negative reviews as a deceptive practice,
 * and Google's policy names the practice and removes what it catches — usually
 * taking the good reviews collected the same way along with it. A restaurant
 * paying for reviews was paying for reviews that could be deleted for how they
 * were gathered.
 *
 * And it was leaving the actual product on the table. Review count and recency
 * carry more weight in local ranking than the last tenth of a star, and the
 * threshold sat where it silenced four-star guests: happy people, mid-meal
 * glow, who would have written something warm and were never asked.
 *
 * So the fork stayed and the gate went. A low rating still routes through the
 * feedback screen first and still pages the operator — that half is untouched,
 * and it is the half the restaurant is paying for. It just no longer ends
 * there. Being asked what went wrong is what a good manager does before handing
 * you the comment card; it is not a reason to take the comment card away.
 *
 * Renders nothing unless the session belongs to a restaurant.
 */
export default /** @param {{ restaurantId?: any, sessionId?: any, onDismiss?: any, [key: string]: any }} props */
function RatingCapture({ restaurantId, sessionId, onDismiss }) {
  const [restaurant, setRestaurant] = useState(null);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [ratingId, setRatingId] = useState(null);
  const [phase, setPhase] = useState("rate"); // rate | feedback | review | done
  const [busy, setBusy] = useState(false);
  // Whether this rating was at or below the operator's alert threshold, kept
  // because the review screen is shown to both kinds of guest and the sentence
  // above the button is the only thing that differs.
  const [flagged, setFlagged] = useState(false);
  // Set once the feedback form is submitted, so the review screen does not ask
  // a second time for an email the guest has already handed over.
  const [sentFeedback, setSentFeedback] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Restaurant.read is owner-scoped now, so this goes through the public
        // projection — which is all this component ever needed anyway: the
        // name, the Google URL and the threshold.
        const res = await invoke("getPublicRestaurant", { id: restaurantId });
        if (alive) setRestaurant(res?.data?.restaurant || null);
      } catch {
        if (alive) setRestaurant(null);
      }
    })();
    return () => { alive = false; };
  }, [restaurantId]);

  if (!restaurant) return null;

  // Three, matching DEFAULT_RATING_THRESHOLD in worker/routes/functions.js.
  //
  // One job now: at or below this, the guest is asked what went wrong and the
  // operator is paged. It does not decide who is shown the Google button —
  // everyone is, on the review screen below. When this number and the server's
  // disagree, an operator is not paged about a complaint this screen showed the
  // guest making, which is why both readings go through ratingThreshold.
  const alertAt = restaurant.rating_threshold ?? 3;

  /** Record the star count immediately — before we know if they'll finish. */
  const pickStars = async (value) => {
    if (busy) return;
    setStars(value);
    setBusy(true);
    const needsManager = value <= alertAt;
    setFlagged(needsManager);

    try {
      // Server-side: it derives restaurant_id from the stored session rather
      // than trusting this component, so a forged rating cannot be attributed
      // to a restaurant the guest was never at.
      const res = await invoke("submitGuestRating", {
        action: "rate",
        session_id: sessionId,
        stars: value,
      });
      setRatingId(res?.data?.rating_id || null);
    } catch {
      /* Never block the guest on our bookkeeping. */
    }

    setBusy(false);
    // The low path takes the extra step first and lands on the same review
    // screen afterwards; the difference is the order, not the destination.
    setPhase(needsManager ? "feedback" : "review");

    if (typeof window.gtag === "function") {
      window.gtag("event", "guest_rating", { stars: value, restaurant: restaurant.name });
    }
  };

  /**
   * Hand the email, and optionally the comment, to the server in one call.
   *
   * This used to be a filter-then-create-or-update against GuestContact
   * straight from the browser, which is why that entity's read and update rules
   * had to be open to everyone. The upsert now happens as service role inside
   * submitGuestRating, so the rules could be closed.
   */
  const saveContact = async (/** @type {{ comment?: any }} */ { comment: text } = {}) => {
    const clean = email.trim().toLowerCase();
    const body = clean && EMAIL_RE.test(clean) ? { email: clean } : {};
    if (text) body.comment = text;
    if (!ratingId || (!body.email && !body.comment)) return;
    try {
      await invoke("submitGuestRating", {
        action: "contact",
        rating_id: ratingId,
        ...body,
      });
    } catch {
      /* Best effort — the rating itself is already stored. */
    }
  };

  /**
   * Marks the rating as having actually reached Google.
   *
   * The server used to write this at rating time from the star count, which
   * recorded permission rather than an event — under the old fork, "sent to
   * Google" on the operator's dashboard counted the guests the app had been
   * willing to let go. Now that every guest is offered the link, the only fact
   * left worth storing is whether they took it, and this tap is the only place
   * that knows.
   */
  const reportRouted = async () => {
    if (!ratingId) return;
    try {
      await invoke("submitGuestRating", { action: "routed", rating_id: ratingId });
    } catch {
      /* Best effort — the rating itself is already stored. */
    }
  };

  /**
   * Opens the restaurant's listing, and records that the guest went.
   *
   * Nothing is awaited before `window.open`. Safari only allows a popup inside
   * the user-gesture that asked for it, and an `await` ends that gesture — so a
   * round trip here would cost some guests the tab entirely. Both requests are
   * fired and left to land; the page stays alive behind the new tab, and the
   * rating row they are updating is already stored either way.
   */
  const goToGoogle = () => {
    // Not again if the feedback screen already sent it. The contact upsert
    // counts visits, and a guest who typed their email into the complaint box
    // and then tapped through would otherwise be recorded as having eaten here
    // twice in one sitting.
    if (!sentFeedback) void saveContact();
    void reportRouted();
    if (restaurant.google_review_url) {
      window.open(restaurant.google_review_url, "_blank", "noopener,noreferrer");
    }
    setPhase("done");
  };

  const sendPrivate = async () => {
    setBusy(true);
    // Email and comment land in one server call, so the comment is stored
    // before the alert fires and the operator's email is never emptier than
    // the record behind it.
    await saveContact({ comment: comment.trim() });

    try {
      // Page the operator. The rating is already stored, so a failure here
      // costs the alert, not the record. The server looks the rating up to find
      // the restaurant's alert contact, which is what stops this being a relay.
      await fetch("/api/rating-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating_id: ratingId }),
      });
    } catch {
      /* Best effort. */
    }

    setBusy(false);
    setSentFeedback(true);
    setPhase("review");
  };

  const wrap = "fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4";
  const sheet =
    "w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl";
  const sheetStyle = { background: "#111827", border: "1px solid rgba(255,255,255,.08)" };

  return (
    <div className={wrap} style={{ background: "rgba(4,8,16,.72)", backdropFilter: "blur(6px)" }}>
      <div className={sheet} style={sheetStyle} role="dialog" aria-modal="true" aria-label="Rate your visit">

        {phase === "rate" && (
          <>
            <h2 className="text-xl font-black text-white text-center">
              How was {restaurant.name}?
            </h2>
            <p className="mt-2 text-sm text-center" style={{ color: "rgba(255,255,255,.55)" }}>
              Takes one tap.
            </p>
            <div className="mt-7 flex justify-center gap-2" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => pickStars(n)}
                  onMouseEnter={() => setHover(n)}
                  disabled={busy}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  className="p-1.5 transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
                >
                  <Star
                    className="w-9 h-9"
                    style={{
                      color: (hover || stars) >= n ? "#f0b429" : "rgba(255,255,255,.22)",
                      fill: (hover || stars) >= n ? "#f0b429" : "transparent",
                    }}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={onDismiss}
              className="mt-7 w-full text-sm py-2"
              style={{ color: "rgba(255,255,255,.4)" }}
            >
              Skip
            </button>
          </>
        )}

        {/*
          The extra step in front of the review screen, not instead of it. The
          copy no longer promises this stays off the internet — it did once, and
          that promise was only keepable by withholding the link on the next
          screen. What it can honestly promise is speed: the manager hears this
          while the guest is still sitting down, which is the whole reason an
          operator pays for it.
        */}
        {phase === "feedback" && (
          <>
            <h2 className="text-xl font-black text-white text-center">
              What went wrong?
            </h2>
            <p className="mt-2.5 text-sm text-center leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
              This reaches the manager right now, while you're still here — so
              they have a chance to put it right tonight.
            </p>

            <textarea
              rows={4} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="What happened?"
              className="mt-5 w-full rounded-xl px-4 py-3 text-white text-sm resize-none"
              style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)" }}
            />
            <input
              type="email" inputMode="email" autoComplete="email"
              placeholder="Email, if you'd like a reply"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-3 w-full rounded-xl px-4 py-3 text-white text-sm"
              style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)" }}
            />

            <button
              onClick={sendPrivate} disabled={busy}
              className="mt-4 w-full py-4 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#00c896", color: "#04231a" }}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Send to the manager
            </button>
            {/*
              Skipping lands on the review screen too. A guest who does not feel
              like typing has not forfeited anything — routing them straight out
              of the flow instead would be the gate again, wearing a different
              button.
            */}
            <button
              onClick={() => setPhase("review")} disabled={busy}
              className="mt-3 w-full text-sm py-2 disabled:opacity-40"
              style={{ color: "rgba(255,255,255,.4)" }}
            >
              Skip
            </button>
          </>
        )}

        {/*
          One screen, every guest, the same button. The sentence above it is the
          only thing that changes — a five-star guest is being asked a favour,
          and a guest who just typed a complaint is being told the link is
          theirs. Neither is given a different amount of friction to get to it.
        */}
        {phase === "review" && (
          <>
            <div className="flex justify-center gap-1 mb-5" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className="w-6 h-6"
                  style={{
                    color: n <= stars ? "#f0b429" : "rgba(255,255,255,.18)",
                    fill: n <= stars ? "#f0b429" : "transparent",
                  }}
                />
              ))}
            </div>
            <h2 className="text-xl font-black text-white text-center">
              {flagged ? "Thanks for telling us." : "That means a lot."}
            </h2>
            <p className="mt-2.5 text-sm text-center leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
              {flagged
                ? "If you want to post about tonight publicly, here's our Google listing — it's the same link every guest gets, and what you write there is yours."
                : "Would you put that on Google? It takes about fifteen seconds and it's the single biggest thing you can do for a place like ours."}
            </p>

            {!sentFeedback && (
              <input
                type="email" inputMode="email" autoComplete="email"
                placeholder="Email for deals (optional)"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-6 w-full rounded-xl px-4 py-3 text-white text-sm"
                style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)" }}
              />
            )}

            <button
              onClick={goToGoogle}
              disabled={!restaurant.google_review_url}
              className="mt-4 w-full h-13 py-4 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#f0b429", color: "#1a1200" }}
            >
              <ExternalLink className="w-4 h-4" />
              Review us on Google
            </button>
            <button onClick={onDismiss} className="mt-3 w-full text-sm py-2" style={{ color: "rgba(255,255,255,.4)" }}>
              {flagged ? "No thanks" : "Maybe later"}
            </button>
          </>
        )}

        {phase === "done" && (
          <div className="py-6 text-center">
            <div
              className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5"
              style={{ background: "rgba(0,200,150,.12)", border: "1px solid rgba(0,200,150,.3)" }}
            >
              <Check className="w-7 h-7" style={{ color: "#00c896" }} />
            </div>
            <h2 className="text-xl font-black text-white">Thank you.</h2>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
              Enjoy the rest of your night.
            </p>
            <button
              onClick={onDismiss}
              className="mt-6 w-full py-3.5 rounded-2xl font-bold"
              style={{ background: "rgba(255,255,255,.07)", color: "#fff" }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
