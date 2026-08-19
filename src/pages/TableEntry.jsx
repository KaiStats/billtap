import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { Loader2, Camera, Users, Star } from "lucide-react";
import { invoke } from "@/api/functions";
import Seo from "@/components/Seo";
import RatingCapture from "@/components/RatingCapture";

const GOLD = "#f0b429";

/**
 * /r/:slug — what the printed table tent points at.
 *
 * Restaurant-branded entry to the split flow. The restaurant is remembered for
 * the rest of the visit so the post-payment rating screen knows whose Google
 * listing to route a happy guest to.
 */
export default function TableEntry() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | missing | error
  // The demo shortcut's session, once one exists. Demo rows only — see below.
  const [demoSession, setDemoSession] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);

  /**
   * Demo rows only: jump straight to the rating.
   *
   * The demo that closes is the low-rating alert arriving while the prospect
   * holds the phone — and the full path to that moment (photograph a bill,
   * build the split, mark it paid) is two minutes of walking through a product
   * the prospect has not bought yet, standing up, mid-service. Two minutes is
   * longer than the attention this page gets.
   *
   * So a demo page gets one extra button that goes straight there. Under it is
   * the ordinary machinery, nothing new on the server: createSession with an
   * even $62.40 check (a plausible number, so the alert email reads like a real
   * table, and it names the check total the manager would look up in the POS),
   * then the same RatingCapture every diner sees. A second tap makes a second
   * session, so the demo can run twice at one table without a dedupe fight —
   * the rows expire with the demo restaurant tonight either way.
   *
   * Only rendered when restaurant.demo is true: a real restaurant's guests
   * rate after paying, not from the table tent.
   */
  async function startDemoRating() {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      const res = await invoke("createSession", {
        title: `${restaurant.name} — demo table`,
        restaurant_slug: slug,
        split_mode: "even",
        total_amount: 62.4,
      });
      const id = res?.data?.session?.id;
      if (id) setDemoSession(id);
    } catch {
      // The button stays; tapping again retries. An error banner on a sales
      // demo is worse than a second tap.
    } finally {
      setDemoBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Via the function, not the entity. Restaurant.read is owner-scoped now,
        // so a direct filter from an anonymous guest returns nothing — and this
        // returns only the four guest-visible fields rather than the operator's
        // alert email, phone and Stripe state.
        const res = await invoke("getPublicRestaurant", { slug });
        if (!alive) return;
        const found = res?.data?.restaurant;
        if (found) {
          setRestaurant(found);
          sessionStorage.setItem("billtap_restaurant_slug", slug);
          setState("ready");
        } else {
          setState("missing");
        }
      } catch {
        // A dropped request is not a dead slug. Telling a guest sitting at a
        // real table that their code is not active, when the network merely
        // hiccuped, sends them away and they do not come back.
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0e1a" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" style={{ background: "#0a0e1a", color: "#fff" }}>
        <div>
          <h1 className="text-2xl font-black">Couldn't load this table</h1>
          <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
            Check your connection and try again.
          </p>
          <button onClick={() => window.location.reload()} className="mt-7 px-6 py-3 rounded-2xl font-bold"
            style={{ background: GOLD, color: "#0a0e1a" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state === "missing") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" style={{ background: "#0a0e1a", color: "#fff" }}>
        <div>
          <h1 className="text-2xl font-black">This code isn't active</h1>
          <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
            Ask your server to split the check the usual way.
          </p>
          <button onClick={() => navigate("/")} className="mt-7 px-6 py-3 rounded-2xl font-bold"
            style={{ background: "rgba(255,255,255,.08)", color: "#fff" }}>
            About BillTap
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0a0e1a", color: "#fff" }}>
      {/*
        A demo page is never indexed.

        The slug is unguessable and the row is deleted within the day, so a
        crawler finding one is unlikely — but "unlikely" is not the standard
        when what would be indexed is a page carrying a real business's name,
        published by us, for a business that never agreed to it. A search result
        for that name pointing at billtap.app is precisely the claim the random
        slug exists to avoid making, and it would outlive the row by however
        long the index takes to catch up.

        Only demo rows. A real restaurant's table-tent page is theirs and there
        is no reason to hide it.
      */}
      {restaurant.demo ? (
        <Seo
          title={`${restaurant.name} — BillTap`}
          description="Split the check."
          path={`/r/${slug}`}
          noindex
        />
      ) : null}
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-6"
          style={{ background: GOLD }}>
          <span className="font-black text-2xl" style={{ color: "#1a1200" }}>B</span>
        </div>

        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: GOLD }}>Split the check at</p>
        <h1 className="mt-2 text-3xl font-black">{restaurant.name}</h1>
        <p className="mt-4 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
          Everyone pays their exact share in about thirty seconds. No app to download.
        </p>

        <button
          onClick={() => navigate("/new-receipt")}
          className="mt-9 w-full py-4 rounded-2xl font-black flex items-center justify-center gap-2"
          style={{ background: GOLD, color: "#1a1200" }}
        >
          <Camera className="w-4 h-4" />
          Start the split
        </button>

        <button
          onClick={() => navigate("/claim")}
          className="mt-3 w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "rgba(255,255,255,.07)", color: "#fff" }}
        >
          <Users className="w-4 h-4" />
          Join a split already started
        </button>

        {restaurant.demo ? (
          <button
            onClick={startDemoRating}
            disabled={demoBusy}
            className="mt-3 w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "transparent", color: GOLD, border: `1px solid ${GOLD}` }}
          >
            {demoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            Rate your visit
          </button>
        ) : null}

        {demoSession ? (
          <RatingCapture
            restaurantId={restaurant.id}
            sessionId={demoSession}
            onDismiss={() => setDemoSession(null)}
          />
        ) : null}

        <p className="mt-7 text-xs" style={{ color: "rgba(255,255,255,.35)" }}>
          Powered by BillTap
        </p>
      </div>
    </div>
  );
}
