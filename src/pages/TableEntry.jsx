import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { Loader2, Camera, Users, Star } from "lucide-react";
import { invoke } from "@/api/functions";
import Seo from "@/components/Seo";
import RatingCapture from "@/components/RatingCapture";

const GOLD = "#f0b429";

/**
 * /r/:slug — what the printed table tent points at.
 * /r/:slug/rate — what the sticker on the cup, the bag or the number tent
 * points at, in a room that took the money before the food.
 *
 * Restaurant-branded entry to the split flow. The restaurant is remembered for
 * the rest of the visit so the post-payment rating screen knows whose Google
 * listing to route a happy guest to.
 *
 * ── The room this screen was written for, and the one it was not ───────────
 *
 * Everything in this product hangs off one bill, presented at the end, by a
 * server. That is a real restaurant and it is not most of them. Counter
 * service, coffee, fast casual, bakeries, delis, taquerias, food trucks,
 * breweries, pickup windows: the guest pays before they eat, carries their own
 * food, and leaves without anybody ever asking how it was.
 *
 * Those rooms cannot use the trigger this app is built on, and not because of
 * a missing feature. At a table, "you have paid" and "you have finished" are
 * the same moment, so hanging the rating off payment is free and correct. At a
 * counter they are opposite ends of the visit — payment happens before the
 * first bite — so the same trigger asks a guest to rate a meal they have not
 * eaten yet. Wiring the split flow into a taqueria would produce ratings of
 * the queue.
 *
 * So the trigger moves. It stops being an event the app can observe and
 * becomes the guest's own scan of a code placed where finishing happens: the
 * number tent on their table, the cup, the bag, the receipt footer, the
 * sticker over the bus tub by the door. That is what `rateFirst` renders — the
 * question itself, five stars, first thing, no bill anywhere near it.
 *
 * ── Why the same screen and the same component ────────────────────────────
 *
 * Because the alert is the product. A second rating flow written for counters
 * would drift from this one, and the half that drifts is always the half
 * nobody is watching: the page to the manager. Both entrances create the same
 * `rating_only` session and open the same `RatingCapture`, which means a
 * one-star guest at a coffee counter reaches the operator's phone by exactly
 * the code path a one-star guest at table nine does.
 *
 * @param {{ rateFirst?: boolean }} props `rateFirst` when the path asked for
 *   it — /r/:slug/rate. A restaurant set to counter service gets the same
 *   screen from a bare scan; see `ratingFirst` below.
 */
export default function TableEntry({ rateFirst = false }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | missing | error
  // The rating session, once one exists. Every guest can open one — see below.
  const [ratingSession, setRatingSession] = useState(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  /**
   * The star tapped on this page, before there was a session to record it on.
   *
   * Only the rating-first screen sets it. The guest answers the question the
   * moment they land, and the session has to exist before the answer can be
   * stored — so the number waits here across that round trip and is handed to
   * RatingCapture, which submits it as though it had been tapped there.
   * Asking again on the next screen would be the same question twice.
   */
  const [pickedStars, setPickedStars] = useState(0);

  /**
   * Jump straight to the rating, skipping the split.
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
   * ── And now every guest gets it, not only prospects ───────────────────────
   *
   * This button used to render only when restaurant.demo was true, under a
   * comment saying a real restaurant's guests rate after paying rather than
   * from the table tent. That was the single biggest limit on the paid
   * product: the alert and the Google handoff open at the end of Claim.jsx,
   * so they only ever fired for a table that photographed a bill, built a
   * split and marked it paid.
   *
   * Every other table — a solo diner, a business lunch on one card, a couple
   * where one person pays, anyone who just wants to leave — never reached the
   * thing the restaurant is paying $149 a month for. And the tent reads
   * "Split the check at ...", so a guest with nothing to split had no reason
   * to scan it at all.
   *
   * The argument for giving prospects the shortcut is the argument for giving
   * it to everyone: two minutes of receipt-photographing is "longer than the
   * attention this page gets" whether the person holding the phone is being
   * sold to or is waiting on their card to come back.
   *
   * A real visit carries no check, so no total is invented for it. The alert
   * already handles that — worker/routes/rating-alert.js sends the total only
   * when it is above zero — so the manager gets "somebody rated you two stars"
   * without a fabricated $62.40 attached to it. The demo keeps its plausible
   * number, because there the number is the point.
   *
   * ── Two callers now, and `stars` is the only difference ───────────────────
   *
   * The tent button calls this with nothing and the rating screen opens on its
   * own star row, as it always has. The pay-first screen calls it with the
   * star the guest already tapped, which is then handed to RatingCapture so
   * they are not asked the same question twice. Everything between — the
   * session, the threshold, the page to the manager, the Google handoff — is
   * one path either way.
   */
  async function startRating(stars = 0) {
    if (ratingBusy) return;
    setRatingBusy(true);
    setPickedStars(stars);
    try {
      const res = await invoke("createSession", {
        title: restaurant.demo
          ? `${restaurant.name} — demo table`
          : `${restaurant.name} — rating`,
        restaurant_slug: slug,
        split_mode: "even",
        // Marked so a visit with no bill is never counted as one. See
        // migration 0024.
        ...(restaurant.demo
          ? { total_amount: 62.4 }
          : { kind: "rating_only", total_amount: 0 }),
      });
      const id = res?.data?.session?.id;
      if (id) setRatingSession(id);
      // A 200 with no session id is not a session. Clearing the star puts the
      // row back to untouched rather than leaving a guest looking at four
      // gold stars that recorded nothing.
      else setPickedStars(0);
    } catch {
      // The button stays; tapping again retries. An error banner over a guest
      // who was trying to do the restaurant a favour is worse than a second tap.
      setPickedStars(0);
    } finally {
      setRatingBusy(false);
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
          {/*
            The path is known even when the slug is not, and the two rooms have
            different staff. "Ask your server" is a dead end in a place that
            has none, said to somebody standing at a counter holding a coffee.
          */}
          <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
            {rateFirst
              ? "Mention it at the counter — they'll want to know."
              : "Ask your server to split the check the usual way."}
          </p>
          <button onClick={() => navigate("/")} className="mt-7 px-6 py-3 rounded-2xl font-bold"
            style={{ background: "rgba(255,255,255,.08)", color: "#fff" }}>
            About BillTap
          </button>
        </div>
      </div>
    );
  }

  /**
   * Whether this scan opens on the question instead of on the check.
   *
   * Two ways in, and they are not the same claim.
   *
   * The path is the explicit one and wins outright: /r/<slug>/rate is printed
   * on an object — a cup, a bag, a number tent, a receipt footer — and what is
   * printed cannot be changed later from a settings screen. Every restaurant
   * has it, including a table-service dining room that wants the rating
   * sticker on its takeout bags, because no single flag on the row describes
   * both halves of a building with a counter and a dining room.
   *
   * `service_style` is the default for a bare scan of /r/<slug>, and it exists
   * because a counter-service place has no table tent to reprint: their guests
   * arrive at this page from a code that was never about splitting anything,
   * and leading them with "Start the split" reads as "this is not for you".
   * Migration 0026 has the rest of the argument.
   */
  const ratingFirst = rateFirst || restaurant.service_style === "counter";

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
      {/*
        ── And a real restaurant's page had no tags at all ────────────────────

        The note above ends "there is no reason to hide it", and then the only
        <Seo> on this screen was the demo's. So a paying restaurant's page
        rendered with the SPA shell's title, no description, no canonical and
        no share image.

        That is not an abstract ranking problem, it is a live one every time a
        guest sends the link: `billtap.app/r/<slug>` pasted into a text, a
        group chat or a Facebook post unfurled as a bare URL with no name and
        no picture. The restaurant is paying $149 a month for a link that
        looks broken when it travels.

        ── The schema is deliberately thin ───────────────────────────────────

        `Restaurant` with a name and a url, and nothing else. This app knows
        the name, the slug and — when they have set one — their Google review
        link. It does not know their address, their hours, their price range
        or their cuisine, and a LocalBusiness entity asserting any of those
        from an empty column would be inventing facts about somebody's
        business.

        `sameAs` is the one genuinely valuable line: it ties this page to the
        restaurant's real Google entity rather than leaving a same-named
        stranger floating on our domain. It is only emitted when they have
        actually set a review link, and only when they are entitled to it —
        getPublicRestaurant withholds that field otherwise, so an unpaid
        account cannot leak one either.

        ── noindex is computed server-side, not inferred here ────────────────

        It covers demo rows and reference accounts both, and the second is the
        one that mattered. A reference account is a real business that has not
        agreed to be published — `reference_account` only means "off the
        billing clock" — and it slips past every demo protection precisely
        because `demo` is false. getPublicRestaurant sends the answer as a
        computed boolean so this page never has to know which kind of row it
        is looking at.

        `restaurant.demo` stays as the fallback for a cached response minted
        before the field existed. When the answer is unknown the safe
        direction is not to index.
      */}
      {/*
        ── Two entrances, two descriptions, one canonical page ──────────────

        `path` is the path actually being viewed, so the rating link a guest
        texts a friend unfurls as itself rather than as a page about splitting
        a check they were never shown. The title follows: "Split the check at
        Blue Bottle" is wrong twice over on a card printed for a coffee bar —
        wrong about what the screen does, and wrong about what the business is.
      */}
      <Seo
        path={ratingFirst ? `/r/${slug}/rate` : `/r/${slug}`}
        title={ratingFirst
          ? `${restaurant.name} — How was it? | BillTap`
          : `${restaurant.name} — Split the check | BillTap`}
        description={ratingFirst
          ? `Tell ${restaurant.name} how your visit went. One tap, no app and no account — and if something was wrong, the manager hears about it while you are still there.`
          : `Split the check at ${restaurant.name}. Everyone scans, claims what they ordered, and pays their exact share — no app and no account.`}
        noindex={restaurant.noindex ?? !!restaurant.demo}
        schema={(restaurant.noindex ?? restaurant.demo) ? null : [{
          "@context": "https://schema.org",
          "@type": "Restaurant",
          name: restaurant.name,
          // The page being described, so `url` and the canonical above cannot
          // disagree about which of the two entrances this is.
          url: `https://billtap.app${ratingFirst ? `/r/${slug}/rate` : `/r/${slug}`}`,
          ...(restaurant.google_review_url
            ? { sameAs: [restaurant.google_review_url] }
            : {}),
        }]}
      />
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-6"
          style={{ background: GOLD }}>
          <span className="font-black text-2xl" style={{ color: "#1a1200" }}>B</span>
        </div>

        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: GOLD }}>You&apos;re at</p>
        <h1 className="mt-2 text-3xl font-black">{restaurant.name}</h1>

        {ratingFirst ? (
          /*
            ── The pay-first screen ─────────────────────────────────────────

            No button in front of the question. The guest is standing up,
            holding a cup or a bag, and every tap between the scan and the
            first star is a share of them that never gets there — which is the
            same argument the demo shortcut has always made, made for a room
            where it is not a shortcut but the only path there is.

            A tap here creates the rating_only session (no bill, no invented
            total) and hands the star straight to RatingCapture, so the guest
            answers once. From there it is the ordinary machinery: at or below
            the operator's threshold they are asked what went wrong and the
            manager is paged while they are still in the building, and every
            guest reaches the same Google handoff.

            That page is worth more here than at a table, not less. A dining
            room has a server who comes back to ask how everything is; a
            counter has nobody, so an unhappy guest walks out silently and the
            first the operator hears of it is a review that is already public.
          */
          <>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
              How was it? One tap — no app, no account.
            </p>

            <div className="mt-8 flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => startRating(n)}
                  disabled={ratingBusy}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  className="p-2 transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
                >
                  <Star
                    className="w-10 h-10"
                    style={{
                      color: pickedStars >= n ? GOLD : "rgba(255,255,255,.22)",
                      fill: pickedStars >= n ? GOLD : "transparent",
                    }}
                  />
                </button>
              ))}
            </div>

            {ratingBusy ? (
              <div className="mt-5 flex items-center justify-center gap-2 text-sm" style={{ color: "rgba(255,255,255,.5)" }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                One moment
              </div>
            ) : null}

            {/*
              Kept, and kept small. Somebody at a counter did pay already — but
              one of them paid for four people, and chasing three friends for
              money afterwards is the same problem this app was built for,
              arriving at a different point in the meal. It is nobody's first
              reason for scanning a cup, so it does not get to be the first
              thing on the screen.
            */}
            <button
              onClick={() => navigate("/new-receipt")}
              className="mt-8 w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
              style={{ background: "rgba(255,255,255,.07)", color: "#fff" }}
            >
              <Camera className="w-4 h-4" />
              Split a receipt with friends
            </button>
          </>
        ) : (
          /*
            "Split the check at" told a guest with nothing to split that this
            card was not for them, which is most tables. Both things the tent
            can do are named now, in the order they are most often wanted.
          */
          <>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,.6)" }}>
              Split the check, or just tell them how it went. No app to download.
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

            {/*
              Shown to every guest, not only on a demo page. The reasoning is in
              startRating above: this is the one tap that reaches the alert and the
              Google review link, and gating it behind a completed bill split meant
              most tables never reached either.
            */}
            <button
              onClick={() => startRating()}
              disabled={ratingBusy}
              className="mt-3 w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "transparent", color: GOLD, border: `1px solid ${GOLD}` }}
            >
              {ratingBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
              Rate your visit
            </button>
          </>
        )}

        {ratingSession ? (
          <RatingCapture
            restaurantId={restaurant.id}
            sessionId={ratingSession}
            /*
              Zero from the tent button, which opens on the star row as it
              always has. A number only ever comes from the screen above, where
              the guest has already answered.
            */
            initialStars={pickedStars}
            onDismiss={() => { setRatingSession(null); setPickedStars(0); }}
          />
        ) : null}

        <p className="mt-7 text-xs" style={{ color: "rgba(255,255,255,.35)" }}>
          Powered by BillTap
        </p>
      </div>
    </div>
  );
}
