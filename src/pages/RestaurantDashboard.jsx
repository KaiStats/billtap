import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Star, Download, Save, Loader2, AlertTriangle, Users, TrendingUp, Link2, CreditCard } from "lucide-react";
import { invoke } from "@/api/functions";
import { planSummary } from "@/lib/plan";
import { reviewLift } from "@/lib/reviewLift";
import { shareCardLines, drawShareCard, shareCardImage } from "@/lib/shareCard";
import { accessToken } from "@/lib/supabase";

const GOLD = "#f0b429";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The slug is minted server-side by saveMyRestaurant and never recomputed here.
// It has to be checked for collisions against every restaurant, which is a read
// this browser is not allowed to do, and it must not follow a rename — the old
// slugify() lived here and turned "Harry's" into harry-s besides.

/** @param {{ label?: any, value?: any, hint?: any, accent?: any, [key: string]: any }} props */
function Stat({ label, value, hint, accent }) {
  return (
    <div className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
      <div className="text-3xl font-black" style={{ color: accent || "#fff" }}>{value}</div>
      <div className="mt-1 text-sm font-semibold text-white">{label}</div>
      {hint && <div className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,.45)" }}>{hint}</div>}
    </div>
  );
}

export default function RestaurantDashboard() {
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // rating_threshold three, matching DEFAULT_RATING_THRESHOLD in
  // worker/routes/functions.js. A form that opens on the wrong number quietly
  // saves it the first time an operator presses Save for any other reason.
  // service_style 'table', matching DEFAULT_SERVICE_STYLE in
  // worker/routes/functions.js and the column default in migration 0026. A
  // form that opens on the wrong one quietly saves it the first time an
  // operator presses Save for any other reason — and this one decides which
  // screen their guests land on.
  const [form, setForm] = useState({ name: "", google_review_url: "", alert_email: "", alert_phone: "", rating_threshold: 3, google_review_count: "", google_rating: "", service_style: "table" });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [billing, setBilling] = useState(null); // null | "starting" | "verifying" | "cancelled" | "failed"
  const handledCheckout = useRef(null);

  /**
   * Everything this screen shows, from one call.
   *
   * getRestaurantDashboardData re-derives ownership from the signed-in user
   * rather than accepting an id — GuestRating and GuestContact as open reads
   * let anyone on the internet enumerate every restaurant's guest list — and it
   * now returns an allow-listed view of the restaurant row alongside them. That
   * row is what the settings form populates from, so the form shows what is
   * actually set instead of blank inputs.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke("getRestaurantDashboardData", {});
      const r = res?.data?.restaurant || null;
      setRestaurant(r);
      if (r) {
        setForm({
          name: r.name || "",
          google_review_url: r.google_review_url || "",
          alert_email: r.alert_email || "",
          alert_phone: r.alert_phone || "",
          rating_threshold: r.rating_threshold ?? 3,
          service_style: r.service_style || "table",
          // Blank rather than 0 when unset: a zero in these boxes reads as a
          // real reading of zero reviews, which is a different claim.
          google_review_count: r.google_review_count ?? "",
          google_rating: r.google_rating ?? "",
        });
      }
      setRatings(res?.data?.ratings || []);
      setContacts(res?.data?.contacts || []);
    } catch {
      setRestaurant(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Returning from Stripe Checkout. The session id is proof of nothing on its
  // own — the endpoint asks Stripe directly before we mark the plan active.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("checkout");
    if (!param || !restaurant) return;

    // Claim the session id synchronously. Verifying calls load(), which changes
    // `restaurant` and re-runs this effect — without this guard that second run
    // starts before the URL param is cleared and verifies the same payment twice.
    if (handledCheckout.current === param) return;
    handledCheckout.current = param;

    const clearParam = () =>
      window.history.replaceState({}, document.title, window.location.pathname);

    if (param === "cancelled") { setBilling("cancelled"); clearParam(); return; }
    // `plan`, not stripe_subscription_id: the dashboard read is allow-listed
    // and the Stripe ids stay on the Worker. This guard was reading undefined
    // and never firing.
    if (!param.startsWith("cs_") || restaurant.plan === "active") { clearParam(); return; }

    let alive = true;
    (async () => {
      setBilling("verifying");
      try {
        /**
         * With the bearer, because both billing routes now check ownership.
         *
         * create-checkout used to take restaurant_id straight from the request
         * body, so anyone could start a checkout naming anyone's restaurant and
         * the paid session would overwrite that row's stripe_subscription_id.
         * Both ends answer "who is this for" from the session now, and without
         * this header the Worker sees an anonymous caller and refuses — which
         * is the right answer to the request and a baffling one to look at.
         */
        const token = await accessToken();
        const res = await fetch("/api/verify-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ session_id: param }),
        });
        const data = await res.json();
        if (!alive) return;

        // The plan is already active by the time this answers. /api/verify-checkout
        // asks Stripe and writes the row itself now — this used to read "paid"
        // and then write plan: "active" from the browser, which meant the client
        // that could write the row did not really have to ask.
        if (data.paid && data.restaurant_id === restaurant.id) {
          setBilling(null);
          await load();
        } else {
          setBilling("failed");
        }
      } catch {
        if (alive) setBilling("failed");
      }
      clearParam();
    })();
    return () => { alive = false; };
  }, [restaurant, load]);

  const startCheckout = async () => {
    setBilling("starting");
    try {
      const token = await accessToken();
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ restaurant_id: restaurant.id, email: restaurant.alert_email }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      // Distinguished, because "that restaurant is not on your account" sends
      // somebody to look somewhere completely different from a Stripe outage.
      setBilling(data.code === "not_yours" || data.code === "unauthorized" ? "not_yours" : "failed");
    } catch {
      setBilling("failed");
    }
  };

  /**
   * The two counts are no longer complements of each other, and should not be.
   *
   * `routed_to_google` used to be written at rating time as `stars > threshold`
   * — a record of which guests the app was willing to let review the place, so
   * every rating fell into exactly one of these buckets. It now records the
   * guest's own tap, which most happy guests will not make, and the low queue
   * comes off the alert threshold instead. A rating can sit in both (a two-star
   * guest who posted anyway) or in neither, and both of those are real.
   */
  const stats = useMemo(() => {
    const n = ratings.length;
    const avg = n ? ratings.reduce((s, r) => s + (r.stars || 0), 0) / n : 0;
    const routed = ratings.filter((r) => r.routed_to_google).length;
    // The same number the guest's screen and the alert both read. Three matches
    // DEFAULT_RATING_THRESHOLD in worker/routes/functions.js.
    const alertAt = restaurant?.rating_threshold ?? 3;
    const low = ratings.filter((r) => (r.stars || 0) <= alertAt);
    return { n, avg, routed, low };
  }, [ratings, restaurant]);

  // One source for the header line and the billing card, so the two cannot say
  // different things about the same row — which is what they did. See
  // src/lib/plan.js for the two ways that went wrong in production.
  const plan = useMemo(() => planSummary(restaurant), [restaurant]);
  // The outcome, not the activity. Null when there is no baseline to compare
  // against — see src/lib/reviewLift.js.
  const lift = useMemo(() => reviewLift(restaurant), [restaurant]);

  /**
   * The results, as something an operator can hand to another operator.
   *
   * Restaurants talk to restaurants, and this panel is the artifact that
   * conversation needs. A GM who can only describe it from memory refers
   * nobody; a GM with a picture on their phone refers the place next door.
   *
   * The card names the restaurant, because a peer's first question is "whose
   * numbers are these" and an anonymous chart answers nothing.
   */
  const shareLift = async () => {
    if (!lift) return;
    const lines = shareCardLines({
      title: restaurant?.name,
      fairness: null,
    });
    lines.headline = `+${lift.countDelta} Google reviews`;
    lines.sub = lift.ratingDelta
      ? `${lift.countStart} → ${lift.countNow} reviews, ${lift.ratingStart?.toFixed(1)} → ${lift.ratingNow?.toFixed(1)} stars.`
      : `${lift.countStart} → ${lift.countNow} reviews since we started using BillTap.`;
    lines.stats = [
      { label: "Before", value: String(lift.countStart) },
      { label: "Now", value: String(lift.countNow) },
      ...(lift.ratingNow !== null ? [{ label: "Stars", value: lift.ratingNow.toFixed(1) }] : []),
    ];

    const blob = await drawShareCard(lines);
    await shareCardImage({
      blob,
      text: `${restaurant?.name || "We"} went from ${lift.countStart} to ${lift.countNow} Google reviews with BillTap.`,
    });
  };
  const { tone: billingTone, heading: billingHeading, detail: billingDetail } = plan;

  /**
   * The message from a rejected write, or a fallback.
   *
   * The Worker's refusals are the useful half here — "that has to be an https
   * link to Google" tells an operator what to type next, and a generic "save
   * failed" does not. invoke() attaches the parsed body as `data`, so this
   * takes the server's sentence when there is one.
   *
   * Deliberately not error.message: on a dropped connection that is "Failed to
   * fetch", which is a browser's words for a problem the operator can do
   * nothing about and reads like the input was rejected.
   */
  const reason = (error, fallback) => {
    const message = /** @type {any} */ (error)?.data?.error;
    return typeof message === "string" && message ? message : fallback;
  };

  /**
   * Both writes go through saveMyRestaurant, and both surface what it says.
   *
   * These used to write Restaurant rows straight from the browser through the
   * Base44 SDK; deleting Base44 took that path with it and for a while these
   * two functions refused instead, which is why the settings pane has been
   * telling operators to send an email.
   *
   * The failure mode being avoided is not an error nobody reads — it is the
   * opposite. An operator who types a new alert email and sees "Saved" stops
   * watching for alerts that will never arrive, so a write that did not land
   * has to say so, in the words the server used.
   */
  const createRestaurant = async () => {
    const name = form.name.trim();
    if (!name) { setFormError("Give the restaurant a name."); return; }
    if (form.alert_email.trim() && !EMAIL_RE.test(form.alert_email.trim())) {
      setFormError("That alert email doesn't look right.");
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      // No id and no slug: the Worker derives ownership from the session and
      // mints the slug itself.
      await invoke("saveMyRestaurant", {
        name,
        alert_email: form.alert_email.trim(),
      });
      await load();
    } catch (error) {
      setFormError(reason(error, "Couldn't create that. Try again in a moment."));
    }
    setCreating(false);
  };

  const save = async () => {
    if (form.alert_email.trim() && !EMAIL_RE.test(form.alert_email.trim())) {
      setFormError("That alert email doesn't look right.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const res = await invoke("saveMyRestaurant", {
        name: form.name.trim(),
        google_review_url: form.google_review_url.trim(),
        alert_email: form.alert_email.trim(),
        alert_phone: form.alert_phone.trim(),
        rating_threshold: Number(form.rating_threshold),
        service_style: form.service_style,
        /**
         * Omitted when blank, never sent as zero.
         *
         * restaurantPatch treats a present key as a reading, and Number("")
         * is 0 — so sending the empty box would record "this restaurant has
         * zero Google reviews", which is a real claim and a false one. Worse,
         * it would become the baseline on the first save and permanently
         * report every existing review as BillTap's doing.
         */
        ...(String(form.google_review_count).trim() !== ""
          ? { google_review_count: Number(form.google_review_count) }
          : {}),
        ...(String(form.google_rating).trim() !== ""
          ? { google_rating: Number(form.google_rating) }
          : {}),
      });
      // Only after the write is acknowledged. "Saved" appearing on an optimistic
      // update is the exact lie this endpoint exists to stop telling.
      setSavedAt(Date.now());
      if (res?.data?.restaurant) setRestaurant(res.data.restaurant);
      await load();
    } catch (error) {
      setSavedAt(null);
      setFormError(reason(error, "Save failed. Try again."));
    }
    setSaving(false);
  };

  const exportCsv = () => {
    const header = "email,name,visits,first_seen,last_seen\n";
    const rows = contacts
      .map((c) => {
        // Quote every field so commas in names can't shift columns.
        const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        return [
          q(c.email),
          q(c.name),
          q(c.visits ?? 1),
          q(c.first_seen ? new Date(c.first_seen).toISOString() : ""),
          q(c.last_seen ? new Date(c.last_seen).toISOString() : ""),
        ].join(",");
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${restaurant.slug}-guests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const field = "w-full rounded-xl px-4 py-3 text-white text-sm";
  const fieldStyle = { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)" };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0e1a" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }

  // ── First run: no restaurant yet ───────────────────────────
  if (!restaurant) {
    return (
      <div className="min-h-screen px-5 py-16" style={{ background: "#0a0e1a", color: "#fff" }}>
        <div className="max-w-md mx-auto">
          <h1 className="text-3xl font-black">Set up your restaurant</h1>
          <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,.6)" }}>
            Two fields now, the rest whenever. Your 14-day trial starts today.
          </p>
          <div className="mt-8 space-y-4">
            <div>
              <label htmlFor="rn" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>Restaurant name</label>
              <input id="rn" className={field} style={fieldStyle} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rosewood Kitchen" />
            </div>
            <div>
              <label htmlFor="ae" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>Where should alerts go?</label>
              <input id="ae" className={field} style={fieldStyle} type="email" value={form.alert_email}
                onChange={(e) => setForm({ ...form, alert_email: e.target.value })} placeholder="you@restaurant.com" />
            </div>
            {formError && <p className="text-sm" style={{ color: "#ff8080" }} role="alert">{formError}</p>}
            <button onClick={createRestaurant} disabled={creating}
              className="w-full py-4 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: GOLD, color: "#1a1200" }}>
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              Start my trial
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tableUrl = `${window.location.origin}/r/${restaurant.slug}`;
  /**
   * The code for a room that never presents a check.
   *
   * Every restaurant gets it, whichever style they are set to. A dining room
   * with a takeout window wants the tent on the tables and this on the bags,
   * and one flag on the row cannot describe both halves of that building —
   * see the note on `ratingFirst` in src/pages/TableEntry.jsx.
   */
  const ratingUrl = `${tableUrl}/rate`;
  const counter = restaurant.service_style === "counter";

  /**
   * The two codes, in the order this room needs them.
   *
   * The placement lines are the whole training, and they are the part an
   * operator gets wrong on their own. At a table the app can watch for the
   * moment a guest is finished, because they mark their share paid. At a
   * counter there is no such moment to observe, so the code has to already be
   * sitting on whatever they are holding when they get there. Put it at the
   * register instead and you collect ratings of the queue.
   */
  const codes = [
    {
      key: "rating",
      url: ratingUrl,
      label: "Rating code",
      where: "Put it where the meal ends: the order-number tent, the cup, the takeout bag, the receipt footer, a sticker by the bins on the way out. It opens straight on the stars — no bill, no app, nothing to type.",
    },
    {
      key: "tent",
      url: tableUrl,
      label: "Table tent code",
      where: "Split the check, join a split, or rate. This is the one printed on the tents.",
    },
  ];
  // An operator should not have to scroll past a card for somebody else's kind
  // of restaurant to reach the one they are about to send to the printer.
  if (!counter) codes.reverse();

  return (
    <div className="min-h-screen px-5 py-10 sm:py-14" style={{ background: "#0a0e1a", color: "#fff" }}>
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-wrap gap-3 items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-black">{restaurant.name}</h1>
            <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,.5)" }}>
              {plan.headline}
            </p>
          </div>
        </header>

        {/* Numbers */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Average rating" accent={GOLD}
            value={stats.n ? stats.avg.toFixed(1) : "—"}
            hint={`${stats.n} rating${stats.n === 1 ? "" : "s"}`} />
          <Stat label="Went to Google" accent="#00c896" value={stats.routed} hint="Tapped through to your listing" />
          <Stat label="Paged you" accent="#ff8080" value={stats.low.length} hint="Heard before they left" />
          <Stat label="Guest emails" accent="#60a5fa" value={contacts.length} hint="Your list" />
        </div>

        {/*
          What actually happened to their listing.

          The four numbers above are activity — how many guests rated, how many
          tapped through. This is the outcome, and it is the one an operator
          decides renewal on. See src/lib/reviewLift.js for why it renders
          nothing at all rather than assuming a baseline.
        */}
        {lift ? (
          <div className="mt-3 p-5 rounded-2xl" style={{ background: "rgba(0,200,150,.07)", border: "1px solid rgba(0,200,150,.2)" }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-white">Your Google listing since BillTap</div>
                <div className="mt-2 flex items-baseline gap-3 flex-wrap">
                  {lift.countDelta !== null && (
                    <span className="text-3xl font-black" style={{ color: lift.countDelta < 0 ? "#ff8080" : "#00c896" }}>
                      {lift.countDelta > 0 ? "+" : ""}{lift.countDelta} review{Math.abs(lift.countDelta) === 1 ? "" : "s"}
                    </span>
                  )}
                  {lift.ratingDelta !== null && lift.ratingDelta !== 0 && (
                    <span className="text-lg font-bold" style={{ color: lift.ratingDelta < 0 ? "#ff8080" : "#00c896" }}>
                      {lift.ratingDelta > 0 ? "+" : ""}{lift.ratingDelta.toFixed(1)} stars
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs" style={{ color: "rgba(255,255,255,.5)" }}>
                  {lift.countDelta !== null && <>{lift.countStart} → {lift.countNow} reviews. </>}
                  {lift.ratingDelta !== null && <>{lift.ratingStart?.toFixed(1)} → {lift.ratingNow?.toFixed(1)} stars. </>}
                </div>
              </div>
              {/* Stale is not hidden. A hand-typed number that nobody has
                  refreshed in a month should say so rather than be presented
                  as though it were live. */}
              {lift.stale && (
                <div className="text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(240,180,41,.15)", color: GOLD }}>
                  {lift.ageDays === null ? "Update your numbers" : `${lift.ageDays} days old — update below`}
                </div>
              )}
            </div>

            {/*
              Operators talk to operators.

              This panel is the artifact one GM shows another, and until now it
              could only be described from memory. Exporting it turns a happy
              restaurant into a referral without anyone from BillTap in the
              room — which is the only B2B channel that scales without more
              door-knocking.

              Only offered once there is something real to show: a stale or
              flat result exported to a peer is worse than no export at all.
            */}
            {lift.countDelta > 0 && !lift.stale && (
              <button
                onClick={shareLift}
                className="mt-4 h-10 px-4 rounded-xl font-semibold text-xs"
                style={{ background: "rgba(0,200,150,.15)", color: "#00c896", border: "1px solid rgba(0,200,150,.3)" }}
              >
                Share these results
              </button>
            )}
          </div>
        ) : null}

        {/* Needs attention */}
        <section className="mt-10">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: "#ff8080" }} /> Needs attention
          </h2>
          {stats.low.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,.45)" }}>
              Nothing yet. Low ratings land here the moment they happen.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {stats.low.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 12).map((r) => (
                <div key={r.id} className="p-4 rounded-xl"
                  style={{ background: "rgba(255,128,128,.06)", border: "1px solid rgba(255,128,128,.2)" }}>
                  <div className="flex items-center gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5"
                        style={{ color: i < r.stars ? GOLD : "rgba(255,255,255,.2)", fill: i < r.stars ? GOLD : "transparent" }} />
                    ))}
                    <span className="text-xs ml-1" style={{ color: "rgba(255,255,255,.45)" }}>
                      {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                  {r.comment && <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,.8)" }}>{r.comment}</p>}
                  {r.guest_email && (
                    <a href={`mailto:${r.guest_email}`} className="mt-2 inline-block text-sm font-semibold" style={{ color: "#00c896" }}>
                      Reply to {r.guest_email}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Guest list */}
        <section className="mt-12">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-4 h-4" style={{ color: "#60a5fa" }} /> Your guest list
            </h2>
            <button onClick={exportCsv} disabled={!contacts.length}
              className="text-sm font-semibold px-4 py-2 rounded-full flex items-center gap-2 disabled:opacity-40"
              style={{ background: "rgba(255,255,255,.07)" }}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
          {contacts.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,.45)" }}>
              Emails collect themselves as guests split checks.
            </p>
          ) : (
            <div className="mt-4 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,.08)" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,.04)" }}>
                      <th className="text-left px-4 py-3 font-semibold">Email</th>
                      <th className="text-left px-4 py-3 font-semibold">Visits</th>
                      <th className="text-left px-4 py-3 font-semibold">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.slice(0, 50).map((c) => (
                      <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                        <td className="px-4 py-3">{c.email}</td>
                        <td className="px-4 py-3">{c.visits ?? 1}</td>
                        <td className="px-4 py-3" style={{ color: "rgba(255,255,255,.55)" }}>
                          {c.last_seen ? new Date(c.last_seen).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {contacts.length > 50 && (
                <p className="px-4 py-3 text-xs" style={{ color: "rgba(255,255,255,.45)" }}>
                  Showing 50 of {contacts.length}. Export for the full list.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Billing */}
        <section className="mt-12">
          <div className="p-6 rounded-2xl flex flex-wrap gap-5 items-center justify-between"
            style={{ background: `${billingTone}12`, border: `1px solid ${billingTone}47` }}>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <CreditCard className="w-4 h-4" style={{ color: billingTone }} />
                {billingHeading}
              </h2>
              <p className="mt-1.5 text-sm" style={{ color: "rgba(255,255,255,.6)" }}>
                {billingDetail}
              </p>
              {billing === "cancelled" && (
                <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
                  Checkout cancelled — nothing was charged.
                </p>
              )}
              {billing === "failed" && (
                <p className="mt-2 text-sm" role="alert" style={{ color: "#ff8080" }}>
                  We couldn't confirm that payment. Nothing was charged twice — call (702) 844-0938.
                </p>
              )}
              {/* Its own message: a signed-out session and a Stripe outage send
                  somebody to look in completely different places. */}
              {billing === "not_yours" && (
                <p className="mt-2 text-sm" role="alert" style={{ color: "#ff8080" }}>
                  You're signed in to a different account than this restaurant belongs to.
                  Sign in as its owner and try again — nothing was charged.
                </p>
              )}
            </div>

            {restaurant.plan !== "active" && restaurant.plan !== "past_due" && (
              <button onClick={startCheckout} disabled={billing === "starting" || billing === "verifying"}
                className="px-6 py-3.5 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: GOLD, color: "#1a1200" }}>
                {(billing === "starting" || billing === "verifying") && <Loader2 className="w-4 h-4 animate-spin" />}
                {billing === "verifying" ? "Confirming" : "Subscribe — $149/mo"}
              </button>
            )}
          </div>
        </section>

        {/* The codes + settings */}
        <section className="mt-12 grid lg:grid-cols-2 gap-6">
          {/*
            ── Two codes, and the order they are printed in matters ─────────

            The tent code opens on the check. The rating code opens on the
            question. Which one an operator needs first is not a preference,
            it is a fact about their room: a place that takes the money before
            the food has no check to present, so a tent that leads with "Start
            the split" is a card their guests are right to ignore.

            Both are always shown. A dining room with a takeout window needs
            the tent on the tables and the rating sticker on the bags, and the
            style setting below only decides which of the two a bare scan of
            /r/<slug> opens on.

            Where each one goes is in `codes` above, and it is the half an
            operator gets wrong on their own.
          */}
          <div className="p-6 rounded-2xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Link2 className="w-4 h-4" style={{ color: GOLD }} /> Your codes
            </h2>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
              {counter
                ? "You take the money first, so the rating code is the one that matters. Print it big."
                : "The tent goes on the tables. The rating code is for anything a guest carries out."}
            </p>

            <div className="mt-5 space-y-5">
              {codes.map(({ key, url, label, where }) => (
                <div key={key} className="flex items-start gap-5">
                  <div className="p-3 rounded-xl bg-white shrink-0">
                    <QRCodeSVG value={url} size={112} level="M" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{label}</p>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "rgba(255,255,255,.5)" }}>{where}</p>
                    <p className="mt-2 text-xs break-all" style={{ color: "rgba(255,255,255,.6)" }}>{url}</p>
                    <button
                      onClick={() => navigator.clipboard?.writeText(url)}
                      className="mt-3 text-sm font-semibold px-4 py-2 rounded-full"
                      style={{ background: "rgba(255,255,255,.08)" }}>
                      Copy link
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-2xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: "#00c896" }} /> Settings
            </h2>
            <div className="mt-5 space-y-4">
              {/*
                The one setting that changes what a guest sees before they have
                done anything.

                Asked as a question about the room rather than as a mode,
                because that is the fact the operator has and "counter service"
                is a phrase they may or may not use about themselves. What it
                controls is stated plainly underneath: the default screen for a
                bare scan, and nothing else. The rating code above works at
                every restaurant either way, which is what keeps this from
                being a switch anybody can lose reviews by getting wrong.
              */}
              <div>
                <label htmlFor="ss" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>
                  How do guests pay?
                </label>
                <select id="ss" className={field} style={fieldStyle} value={form.service_style}
                  onChange={(e) => setForm({ ...form, service_style: e.target.value })}>
                  <option value="table" style={{ background: "#0a0e1a" }}>We bring the check at the end</option>
                  <option value="counter" style={{ background: "#0a0e1a" }}>They pay at the counter first</option>
                </select>
                <p className="mt-1.5 text-xs" style={{ color: "rgba(255,255,255,.4)" }}>
                  Sets which screen a plain scan of your link opens on. Pay-first rooms
                  get the stars straight away — there is no check to split, and asking at
                  the register would be asking about a meal nobody has eaten yet.
                </p>
              </div>

              <div>
                <label htmlFor="g" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>
                  Google review link
                </label>
                <input id="g" className={field} style={fieldStyle} value={form.google_review_url}
                  onChange={(e) => setForm({ ...form, google_review_url: e.target.value })}
                  placeholder="https://g.page/r/.../review" />
                <p className="mt-1.5 text-xs" style={{ color: "rgba(255,255,255,.4)" }}>
                  Happy guests go straight here. Without it, the handoff button stays disabled.
                </p>
              </div>

              {/*
                The two numbers that make the panel at the top mean anything.

                Asked for as "what does your listing say right now" rather than
                as a baseline, because the first reading becomes the baseline
                server-side and an operator should never have to know the word.
                Blank is a legitimate answer and stays blank — the save omits
                an empty box rather than sending it as a zero.
              */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="grc" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>
                    Google reviews today
                  </label>
                  <input id="grc" className={field} style={fieldStyle} type="number" inputMode="numeric"
                    min="0" step="1"
                    value={form.google_review_count}
                    onChange={(e) => setForm({ ...form, google_review_count: e.target.value })}
                    placeholder="89" />
                </div>
                <div>
                  <label htmlFor="grs" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>
                    Star average
                  </label>
                  <input id="grs" className={field} style={fieldStyle} type="number" inputMode="decimal"
                    min="0" max="5" step="0.1"
                    value={form.google_rating}
                    onChange={(e) => setForm({ ...form, google_rating: e.target.value })}
                    placeholder="4.1" />
                </div>
                <p className="col-span-2 -mt-1 text-xs" style={{ color: "rgba(255,255,255,.4)" }}>
                  Open your Google listing and copy what it says. The first time you save these
                  we remember them as your starting point, so the panel above can show what
                  BillTap actually earned you. Update them whenever you like.
                </p>
              </div>

              <div>
                <label htmlFor="a" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>Alert email</label>
                <input id="a" className={field} style={fieldStyle} type="email" value={form.alert_email}
                  onChange={(e) => setForm({ ...form, alert_email: e.target.value })} />
              </div>
              <div>
                <label htmlFor="p" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>
                  Alert phone (text messages)
                </label>
                <input id="p" className={field} style={fieldStyle} type="tel" inputMode="tel"
                  value={form.alert_phone} placeholder="(702) 555-0134"
                  onChange={(e) => setForm({ ...form, alert_phone: e.target.value })} />
                <p className="mt-1.5 text-xs" style={{ color: "rgba(255,255,255,.4)" }}>
                  Leave blank for email only.
                </p>
              </div>
              <div>
                <label htmlFor="t" className="block text-xs mb-2" style={{ color: "rgba(255,255,255,.6)" }}>
                  Alert me at or below
                </label>
                <select id="t" className={field} style={fieldStyle} value={form.rating_threshold}
                  onChange={(e) => setForm({ ...form, rating_threshold: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n} style={{ background: "#0a0e1a" }}>{n} star{n > 1 ? "s" : ""}</option>
                  ))}
                </select>
                {/*
                  Spelled out because this setting used to do a second thing
                  nobody was told about: below it, the guest was never shown the
                  Google link. An operator who set it to 4 to get more alerts
                  was, without knowing, switching off four-star reviews.
                */}
                <p className="mt-1.5 text-xs" style={{ color: "rgba(255,255,255,.4)" }}>
                  Sets when we page you, nothing else. Every guest is shown your
                  Google link either way.
                </p>
              </div>
              {formError && <p className="text-sm" style={{ color: "#ff8080" }} role="alert">{formError}</p>}
              <button onClick={save} disabled={saving}
                className="w-full py-3.5 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: GOLD, color: "#1a1200" }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savedAt && !saving ? "Saved" : "Save settings"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
