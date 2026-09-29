import { QRCodeSVG } from "qrcode.react";
import {
  Bell, Star, Users, Coffee, Smartphone, ThumbsUp, Clock, Check, X,
  Phone, Mail, ArrowRight, Beef, UtensilsCrossed, Fish, Flame, Beer, Tv,
  Sandwich, Croissant, QrCode, Receipt, ShoppingBag, CupSoda, Hash,
} from "lucide-react";
import Seo from "@/components/Seo";

/**
 * One-page printable leave-behind for in-person visits: billtap.app/flyer,
 * then Print. Laid out 900px wide and zoomed to 80% for print, which fits
 * US Letter inside half-inch margins (720 × 960 CSS px). 900 × 0.8 is exactly
 * 720: a larger zoom makes the sheet wider than the page and clips it.
 *
 * Every claim here has to be true of the product today:
 * - $149 and the 14-day, no-card trial are create-pro-checkout.js.
 * - A low rating emails the owner, and texts them too when SMS is set up
 *   (rating-alert.js), so the copy says "email or text", never just one.
 * - Every guest gets the Google link whatever they rate. Offering it only to
 *   happy guests is review gating, which Google prohibits.
 * No competitor prices: nothing here can back one up.
 */
const URL = "https://billtap.app/restaurants?utm_source=flyer&utm_campaign=in_person";

const GOLD = "#e0a01b";
const GOLD_DARK = "#b7791f";
const INK = "#111";

const FEATURES = [
  { icon: Bell, color: "#dc2626", title: "Catch bad nights before they go public",
    body: "A guest rates you low? An email or text alert hits right away, so you can fix it first." },
  { icon: Star, color: GOLD, title: "More 5-star Google reviews",
    body: "Every guest gets a one-tap link to your Google review page, whatever they rate." },
  { icon: Users, color: "#15803d", title: "Build a customer list every night",
    body: "Guests opt in after they rate. Names and emails become your list, even at a counter." },
  { icon: Coffee, color: "#1e3a8a", title: "Works at the counter, too",
    body: "Guests pay first? The code goes on the cup, bag or receipt and opens on five stars." },
];

const STRIP = [
  { icon: Smartphone, title: "No app to download", body: "Just scan and go. No account." },
  { icon: ThumbsUp, title: "One-tap Google review", body: "Every guest gets the link." },
  { icon: Clock, title: "Setup in minutes", body: "No new POS. We do the heavy lifting." },
];

const WITHOUT = ["Missed reviews", "Lost customer emails", "Surprise 1-star reviews", "Nobody asks at the counter"];
const WITH = ["More 5-star reviews", "Your own customer list", "Instant bad-experience alerts", "Every guest gets asked"];

const TABLE_STEPS = ["Guests scan the QR on the table. No app.", "They split the check and pay their share.", "They tap a star rating on the way out."];
const COUNTER_STEPS = ["Guests order and pay at your register, as today.", "After eating, they scan the code on the cup, bag or card.", "Five stars come up. One tap and done."];

const SIT_DOWN = [
  [Beef, "Steakhouses"], [UtensilsCrossed, "Mexican"], [Fish, "Sushi"], [Flame, "BBQ"],
  [Beer, "Breweries"], [Tv, "Sports bars"], [Users, "Family dining"],
];
const COUNTERS = [[Coffee, "Coffee shops"], [Sandwich, "Fast casual"], [Croissant, "Bakeries & delis"]];
// Where the code goes. Every one of these is a place the copy above already names.
const SCAN_SPOTS = [[QrCode, "Table tent"], [Receipt, "Receipt"], [CupSoda, "Cup"], [ShoppingBag, "Bag"], [Hash, "Number card"]];

const card = { border: "1px solid #e7e2d6", borderRadius: 12, background: "#fff" };

function Steps({ label, sub, steps }) {
  return (
    <div style={{ marginTop: 6 }}>
      <p style={{ fontSize: 12, fontWeight: 800, color: GOLD_DARK, letterSpacing: ".06em" }}>
        {label} <span style={{ fontWeight: 400, color: "#777", letterSpacing: 0 }}>{sub}</span>
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 6 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ display: "flex", gap: 6 }}>
            <span style={{ flex: "none", width: 20, height: 20, borderRadius: 999, background: GOLD, color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>{i + 1}</span>
            <p style={{ fontSize: 12, lineHeight: 1.3 }}>{s}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Flyer() {
  return (
    <main style={{ background: "#fff", color: INK, minHeight: "100vh" }}>
      <Seo path="/flyer" title="BillTap Flyer" description="Printable BillTap one-pager for restaurant owners." noindex />
      <style>{`@page{size:letter;margin:0.5in}@media print{.noprint{display:none}.sheet{zoom:0.8}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`}</style>
      <div className="noprint" style={{ textAlign: "center", padding: 12, background: "#f4f4f5" }}>
        <button onClick={() => window.print()} style={{ padding: "8px 18px", borderRadius: 999, background: INK, color: "#fff", fontWeight: 600 }}>
          Print this flyer
        </button>
      </div>

      <div className="sheet" style={{ width: 900, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
        {/* Header */}
        <header style={{ background: INK, color: "#fff", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "12px 12px 0 0" }}>
          <div>
            <p style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-.03em", lineHeight: 1 }}>Bill<span style={{ color: GOLD }}>Tap</span></p>
            <p style={{ fontSize: 10, letterSpacing: ".35em", color: GOLD, marginTop: 4 }}>FOR RESTAURANTS</p>
          </div>
          <div style={{ textAlign: "right", fontSize: 13 }}>
            <p>Sit-down tables or pay-first counters.</p>
            <p style={{ color: GOLD, fontWeight: 800 }}>You get the reviews and the list.</p>
            <p style={{ fontWeight: 800, marginTop: 2 }}>billtap.app</p>
          </div>
        </header>

        {/* Headline */}
        <section style={{ textAlign: "center", padding: "12px 24px 4px" }}>
          <h1 style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.05, letterSpacing: "-.02em" }}>
            More 5-Star Reviews. More Regulars.<br /><span style={{ color: GOLD_DARK }}>Every Check.</span>
          </h1>
          <p style={{ fontSize: 14, color: "#333", marginTop: 8, lineHeight: 1.4 }}>
            The easiest way to get more Google reviews, build your customer list, and{" "}
            <b>hear about an unhappy guest right away</b>, before it goes public.
          </p>
        </section>

        {/* Four features */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: "8px 24px" }}>
          {FEATURES.map(({ icon: Icon, color, title, body }) => (
            <div key={title} style={{ ...card, padding: 10, textAlign: "center" }}>
              <span style={{ display: "inline-grid", placeItems: "center", width: 34, height: 34, borderRadius: 999, background: color, color: "#fff" }}><Icon size={20} /></span>
              <p style={{ fontSize: 12.5, fontWeight: 800, color, textTransform: "uppercase", marginTop: 8, lineHeight: 1.2 }}>{title}</p>
              <p style={{ fontSize: 12.5, color: "#333", marginTop: 6, lineHeight: 1.4 }}>{body}</p>
            </div>
          ))}
        </section>

        {/* Three essentials, big enough to read on paper */}
        <section style={{ margin: "4px 24px", border: `2px solid ${GOLD}`, borderRadius: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: "8px 6px" }}>
          {STRIP.map(({ icon: Icon, title, body }, i) => (
            <div key={title} style={{ display: "flex", gap: 8, padding: "0 12px", borderLeft: i ? "1px solid #eee" : "none" }}>
              <Icon size={20} color={GOLD_DARK} style={{ flex: "none", marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 14, fontWeight: 800 }}>{title}</p>
                <p style={{ fontSize: 12.5, color: "#555" }}>{body}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Lower grid */}
        <section style={{ display: "grid", gridTemplateColumns: "210px 1fr 205px", gap: 10, padding: "8px 24px" }}>
          <div style={{ background: INK, color: "#fff", borderRadius: 12, padding: 14 }}>
            <p style={{ color: GOLD, fontWeight: 900, fontSize: 16 }}>PERFECT FOR</p>
            <p style={{ fontSize: 10, letterSpacing: ".2em", color: "#aaa", marginTop: 8 }}>SIT-DOWN</p>
            <p style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>Guests split and pay at the table, then rate.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 4 }}>
              {SIT_DOWN.map(([Icon, t]) => (
                <p key={t} style={{ fontSize: 12, marginTop: 5, display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}><Icon size={12} color={GOLD} style={{ flex: "none" }} />{t}</p>
              ))}
            </div>
            <p style={{ fontSize: 10, letterSpacing: ".2em", color: "#aaa", marginTop: 12 }}>PAY-FIRST COUNTERS</p>
            <p style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>Guests pay as usual, then scan to rate.</p>
            {COUNTERS.map(([Icon, t]) => (
              <p key={t} style={{ fontSize: 13, marginTop: 5, display: "flex", gap: 7, alignItems: "center" }}><Icon size={14} color={GOLD} />{t}</p>
            ))}
            <p style={{ fontSize: 10, letterSpacing: ".2em", color: "#aaa", marginTop: 12 }}>WHERE GUESTS SCAN</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
              {SCAN_SPOTS.map(([Icon, t]) => (
                <span key={t} style={{ fontSize: 11, border: "1px solid #444", borderRadius: 999, padding: "2px 7px", display: "flex", gap: 4, alignItems: "center" }}><Icon size={11} color={GOLD} />{t}</span>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: "#ccc", marginTop: 12, borderTop: "1px solid #333", paddingTop: 8, lineHeight: 1.35 }}>
              <b style={{ color: GOLD }}>One rule at a counter:</b> ask after the last bite, never at the register.
            </p>
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateRows: "auto 1fr" }}>
            <div style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>
              <div style={{ background: "#fdf1f1", padding: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#dc2626" }}>WITHOUT BILLTAP</p>
                {WITHOUT.map((t) => <p key={t} style={{ fontSize: 12.5, fontWeight: 600, marginTop: 5, display: "flex", gap: 4 }}><X size={14} color="#dc2626" style={{ flex: "none", marginTop: 1 }} />{t}</p>)}
              </div>
              <div style={{ background: "#eff8f1", padding: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#15803d" }}>WITH BILLTAP</p>
                {WITH.map((t) => <p key={t} style={{ fontSize: 12.5, fontWeight: 600, marginTop: 5, display: "flex", gap: 4 }}><Check size={14} color="#15803d" style={{ flex: "none", marginTop: 1 }} />{t}</p>)}
              </div>
            </div>
            <div style={{ ...card, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <p style={{ fontSize: 14, fontWeight: 900, textAlign: "center" }}>HOW IT WORKS</p>
              <div>
                  <Steps label="AT A TABLE" sub="sit-down" steps={TABLE_STEPS} />
              <Steps label="AT A COUNTER" sub="pay-first" steps={COUNTER_STEPS} />
                </div>
              <p style={{ fontSize: 12, textAlign: "center", marginTop: 8, borderTop: "1px dashed #ddd", paddingTop: 6 }}>
                <b style={{ color: GOLD_DARK }}>Either way:</b> every guest gets your Google review link, and a low rating reaches you instantly.
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateRows: "auto 1fr" }}>
            <div style={{ background: INK, color: "#fff", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <p style={{ color: GOLD, fontWeight: 800, fontSize: 12 }}>ONE SIMPLE PLAN</p>
              <p style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>$149<span style={{ fontSize: 15, color: GOLD }}>/month</span></p>
              {["14-day free trial", "No card to start", "Cancel anytime"].map((t) => (
                <p key={t} style={{ fontSize: 13, fontWeight: 700, marginTop: 4, display: "flex", gap: 6, justifyContent: "center" }}><Check size={15} color={GOLD} />{t}</p>
              ))}
            </div>
            <div style={{ background: GOLD, borderRadius: 12, padding: 12, textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
              <p style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.15 }}>SEE BILLTAP WORKING IN YOUR RESTAURANT</p>
              <p style={{ background: INK, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "4px 8px", marginTop: 6 }}>LIVE DEMO IN UNDER 2 MINUTES</p>
              <div style={{ background: "#fff", borderRadius: 10, padding: 8, marginTop: 8, display: "inline-block" }}>
                <QRCodeSVG value={URL} size={110} />
                <p style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4 }}>billtap.app/restaurants</p>
              </div>
              <p style={{ fontSize: 13, fontWeight: 900, marginTop: 6, display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>SCAN TO SEE IT LIVE <ArrowRight size={14} /></p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ background: INK, color: "#fff", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "0 0 12px 12px", marginTop: 4 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" }}>More Reviews. More Customers. More Revenue.</p>
            <p style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 12 }}>
              {["No new POS", "No hardware", "Tables & counters"].map((t) => <span key={t} style={{ display: "flex", gap: 3, alignItems: "center" }}><Check size={13} color={GOLD} />{t}</span>)}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: GOLD, fontSize: 11, fontWeight: 800 }}>QUESTIONS? LET'S TALK.</p>
            <p style={{ fontSize: 14, fontWeight: 800, marginTop: 2, display: "flex", gap: 12, whiteSpace: "nowrap" }}>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Phone size={14} color={GOLD} />(702) 844-0938</span>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Mail size={14} color={GOLD} />alerts@billtap.app</span>
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
