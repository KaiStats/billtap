import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Camera, Users } from "lucide-react";
import { invoke } from "@/api/functions";

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

        <p className="mt-7 text-xs" style={{ color: "rgba(255,255,255,.35)" }}>
          Powered by BillTap
        </p>
      </div>
    </div>
  );
}
