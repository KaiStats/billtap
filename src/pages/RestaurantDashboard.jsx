import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Star, Download, Save, Loader2, AlertTriangle, Users, TrendingUp, Link2, CreditCard } from "lucide-react";
import { invoke } from "@/api/functions";

const GOLD = "#f0b429";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

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
  const [form, setForm] = useState({ name: "", google_review_url: "", alert_email: "", alert_phone: "", rating_threshold: 3 });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [billing, setBilling] = useState(null); // null | "starting" | "verifying" | "cancelled" | "failed"
  const handledCheckout = useRef(null);

  /**
   * What the Worker can currently tell this screen, which is not all of it.
   *
   * The restaurant row itself used to come from an owner-scoped entity read.
   * getRestaurantDashboardData returns the ratings, the contacts and the
   * restaurant's id — it re-derives ownership from the signed-in user rather
   * than accepting an id here, because GuestRating and GuestContact as open
   * reads let anyone on the internet enumerate every restaurant's guest list —
   * but it does not return the row's own fields.
   *
   * So the settings form below has nothing to populate and nothing to save
   * against, and it says so rather than presenting empty inputs that discard
   * what is typed into them. The gap closes with one endpoint returning the
   * restaurant and one accepting a patch to it; both belong to the data layer
   * and neither belongs in a commit whose job is to delete a vendor.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke("getRestaurantDashboardData", {});
      const id = res?.data?.restaurant_id || null;
      setRestaurant(id ? { id } : null);
      setRatings(res?.data?.ratings || []);
      setContacts(res?.data?.contacts || []);
    } catch {
      setRestaurant(null);
    }
    setLoading(false);
  }, []);

  /** Set when a write has nowhere to go — see load(). */
  const SETTINGS_UNAVAILABLE =
    "Restaurant settings can't be edited from here yet. Email hello@billtap.app and we'll change it for you.";

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
    if (!param.startsWith("cs_") || restaurant.stripe_subscription_id) { clearParam(); return; }

    let alive = true;
    (async () => {
      setBilling("verifying");
      try {
        const res = await fetch("/api/verify-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, email: restaurant.alert_email }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      setBilling("failed");
    } catch {
      setBilling("failed");
    }
  };

  const stats = useMemo(() => {
    const n = ratings.length;
    const avg = n ? ratings.reduce((s, r) => s + (r.stars || 0), 0) / n : 0;
    const routed = ratings.filter((r) => r.routed_to_google).length;
    const low = ratings.filter((r) => !r.routed_to_google);
    return { n, avg, routed, low };
  }, [ratings]);

  const trialDaysLeft = useMemo(() => {
    if (!restaurant?.trial_ends_at) return null;
    return Math.max(0, Math.ceil((restaurant.trial_ends_at - Date.now()) / 86400000));
  }, [restaurant]);

  // Plan states the Stripe webhook can now produce, not just trial/active.
  const [billingTone, billingHeading, billingDetail] = useMemo(() => {
    const renews = restaurant?.current_period_end
      ? `Renews ${new Date(restaurant.current_period_end).toLocaleDateString()}. $149/month.`
      : "$149/month.";
    switch (restaurant?.plan) {
      case "active":
        return ["#30a46c", "Subscription active", renews];
      case "past_due":
        return ["#e5484d", "Payment failed",
          "Stripe couldn't charge your card. Update it from the receipt email, or call (702) 844-0938 — your service is still on for now."];
      case "cancelled":
        return ["#8b8b8b", "Subscription cancelled",
          "Your guests can still split checks, but reviews and alerts have stopped. Resubscribe any time."];
      default:
        return ["#f0b429", "Free trial",
          trialDaysLeft !== null
            ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left, then $149/month. Cancel anytime.`
            : "$149/month when your trial ends. Cancel anytime."];
    }
  }, [restaurant, trialDaysLeft]);

  /**
   * Both writes are refused rather than attempted.
   *
   * They wrote Restaurant rows straight from the browser through the Base44
   * SDK. There is no endpoint on the Worker that creates or patches a
   * restaurant, and inventing one here means deciding who may rename a
   * restaurant, who may repoint its Google review URL, and what happens to the
   * slug printed on its table tents — an ownership question, in the paid part
   * of the product, which is not something to answer on the way past.
   *
   * Refusing in one line beats a form that appears to work: an operator who
   * types a new alert email and sees "Saved" will stop watching for the alerts
   * that never arrive.
   */
  const createRestaurant = async () => {
    setFormError(SETTINGS_UNAVAILABLE);
  };

  const save = async () => {
    setFormError(SETTINGS_UNAVAILABLE);
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

  return (
    <div className="min-h-screen px-5 py-10 sm:py-14" style={{ background: "#0a0e1a", color: "#fff" }}>
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-wrap gap-3 items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-black">{restaurant.name}</h1>
            <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,.5)" }}>
              {restaurant.plan === "trial" && restaurant.trial_ends_at
                ? `Trial ends ${new Date(restaurant.trial_ends_at).toLocaleDateString()}`
                : "Active plan"}
            </p>
          </div>
        </header>

        {/* Numbers */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Average rating" accent={GOLD}
            value={stats.n ? stats.avg.toFixed(1) : "—"}
            hint={`${stats.n} rating${stats.n === 1 ? "" : "s"}`} />
          <Stat label="Sent to Google" accent="#00c896" value={stats.routed} hint="Happy guests routed" />
          <Stat label="Caught early" accent="#ff8080" value={stats.low.length} hint="Never went public" />
          <Stat label="Guest emails" accent="#60a5fa" value={contacts.length} hint="Your list" />
        </div>

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

        {/* Table QR + settings */}
        <section className="mt-12 grid lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Link2 className="w-4 h-4" style={{ color: GOLD }} /> Your table QR
            </h2>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,.55)" }}>
              This is what goes on the table tents.
            </p>
            <div className="mt-5 flex items-center gap-5">
              <div className="p-3 rounded-xl bg-white">
                <QRCodeSVG value={tableUrl} size={132} level="M" />
              </div>
              <div className="min-w-0">
                <p className="text-xs break-all" style={{ color: "rgba(255,255,255,.6)" }}>{tableUrl}</p>
                <button
                  onClick={() => navigator.clipboard?.writeText(tableUrl)}
                  className="mt-3 text-sm font-semibold px-4 py-2 rounded-full"
                  style={{ background: "rgba(255,255,255,.08)" }}>
                  Copy link
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-2xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: "#00c896" }} /> Settings
            </h2>
            <div className="mt-5 space-y-4">
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
