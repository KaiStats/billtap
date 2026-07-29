import { useState, useEffect } from "react";
import { Star, Loader2, Check, ExternalLink } from "lucide-react";
import { base44 } from "@/api/base44Client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shown once a guest marks their share paid.
 *
 * This is the whole restaurant product in one screen: a happy guest gets routed
 * to Google while they are still at the table, an unhappy one is intercepted
 * into private feedback that pages the operator instead of becoming a public
 * review, and either way the email lands on the restaurant's list.
 *
 * Renders nothing unless the session belongs to a restaurant.
 */
export default function RatingCapture({ restaurantId, sessionId, onDismiss }) {
  const [restaurant, setRestaurant] = useState(null);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [ratingId, setRatingId] = useState(null);
  const [phase, setPhase] = useState("rate"); // rate | happy | unhappy | done
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await base44.entities.Restaurant.filter({ id: restaurantId });
        if (alive) setRestaurant(rows?.[0] || null);
      } catch {
        if (alive) setRestaurant(null);
      }
    })();
    return () => { alive = false; };
  }, [restaurantId]);

  if (!restaurant) return null;

  const threshold = restaurant.rating_threshold ?? 3;

  /** Record the star count immediately — before we know if they'll finish. */
  const pickStars = async (value) => {
    if (busy) return;
    setStars(value);
    setBusy(true);
    const happy = value > threshold;

    try {
      const row = await base44.entities.GuestRating.create({
        restaurant_id: restaurantId,
        session_id: sessionId,
        stars: value,
        routed_to_google: happy,
        created_at: Date.now(),
      });
      setRatingId(row?.id || null);
    } catch {
      /* Never block the guest on our bookkeeping. */
    }

    setBusy(false);
    setPhase(happy ? "happy" : "unhappy");

    if (typeof window.gtag === "function") {
      window.gtag("event", "guest_rating", { stars: value, restaurant: restaurant.name });
    }
  };

  const saveEmail = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) return;
    try {
      const existing = await base44.entities.GuestContact.filter({
        restaurant_id: restaurantId,
        email: clean,
      });
      if (existing?.length) {
        await base44.entities.GuestContact.update(existing[0].id, {
          visits: (existing[0].visits || 1) + 1,
          last_seen: Date.now(),
        });
      } else {
        await base44.entities.GuestContact.create({
          restaurant_id: restaurantId,
          email: clean,
          opted_in: true,
          visits: 1,
          first_seen: Date.now(),
          last_seen: Date.now(),
        });
      }
      if (ratingId) {
        await base44.entities.GuestRating.update(ratingId, { guest_email: clean });
      }
    } catch {
      /* Best effort. */
    }
  };

  const goToGoogle = async () => {
    setBusy(true);
    await saveEmail();
    setBusy(false);
    if (restaurant.google_review_url) {
      window.open(restaurant.google_review_url, "_blank", "noopener,noreferrer");
    }
    setPhase("done");
  };

  const sendPrivate = async () => {
    setBusy(true);
    await saveEmail();

    try {
      if (ratingId && comment.trim()) {
        await base44.entities.GuestRating.update(ratingId, { comment: comment.trim() });
      }
      // Page the operator. The rating is already stored, so a failure here
      // costs the alert, not the record. The server looks up the rating to fetch
      // the restaurant's alert contact, preventing spam.
      await fetch("/api/rating-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating_id: ratingId }),
      });
    } catch {
      /* Best effort. */
    }

    setBusy(false);
    setPhase("done");
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

        {phase === "happy" && (
          <>
            <div className="flex justify-center gap-1 mb-5" aria-hidden="true">
              {Array.from({ length: stars }).map((_, i) => (
                <Star key={i} className="w-6 h-6" style={{ color: "#f0b429", fill: "#f0b429" }} />
              ))}
            </div>
            <h2 className="text-xl font-black text-white text-center">
              That means a lot.
            </h2>
            <p className="mt-2.5 text-sm text-center leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
              Would you put that on Google? It takes about fifteen seconds and it's
              the single biggest thing you can do for a place like ours.
            </p>

            <input
              type="email" inputMode="email" autoComplete="email"
              placeholder="Email for deals (optional)"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-6 w-full rounded-xl px-4 py-3 text-white text-sm"
              style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)" }}
            />

            <button
              onClick={goToGoogle}
              disabled={busy || !restaurant.google_review_url}
              className="mt-4 w-full h-13 py-4 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#f0b429", color: "#1a1200" }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              Review us on Google
            </button>
            <button onClick={onDismiss} className="mt-3 w-full text-sm py-2" style={{ color: "rgba(255,255,255,.4)" }}>
              Maybe later
            </button>
          </>
        )}

        {phase === "unhappy" && (
          <>
            <h2 className="text-xl font-black text-white text-center">
              We'd rather hear it from you.
            </h2>
            <p className="mt-2.5 text-sm text-center leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
              This goes straight to the manager — not online. Tell us what went wrong
              and someone will actually read it.
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
            <button onClick={onDismiss} className="mt-3 w-full text-sm py-2" style={{ color: "rgba(255,255,255,.4)" }}>
              No thanks
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
