import { QRCodeSVG } from "qrcode.react";
import Seo from "@/components/Seo";

/**
 * One-page printable leave-behind for in-person visits: billtap.app/flyer,
 * then Print. The worked example is labelled as an example with its inputs
 * shown — the same arithmetic as TurnCalculator on /restaurants, not a
 * BillTap measurement (see src/csp.test.mjs).
 */
const URL = "https://billtap.app/restaurants?utm_source=flyer&utm_campaign=in_person";
const EX = { tables: 20, turn: 75, saved: 5, hours: 3, check: 120, nights: 12 };
const extra = ((EX.hours * 60) / (EX.turn - EX.saved) - (EX.hours * 60) / EX.turn) * EX.tables;
const night = Math.round(extra * EX.check);
const month = night * EX.nights;
const $ = (n) => "$" + n.toLocaleString("en-US");

export default function Flyer() {
  return (
    <main style={{ background: "#fff", color: "#111", minHeight: "100vh" }}>
      <Seo path="/flyer" title="BillTap Flyer" description="Printable BillTap one-pager for restaurant owners." noindex />
      <style>{`@page{size:letter;margin:0.5in}@media print{.noprint{display:none}}`}</style>
      <div className="noprint" style={{ textAlign: "center", padding: 12, background: "#f4f4f5" }}>
        <button onClick={() => window.print()} style={{ padding: "8px 18px", borderRadius: 999, background: "#111", color: "#fff", fontWeight: 600 }}>
          Print this flyer
        </button>
      </div>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-.02em" }}>BillTap <span style={{ color: "#b7791f" }}>for restaurants</span></p>
        <h1 style={{ fontSize: 38, lineHeight: 1.05, fontWeight: 800, marginTop: 16 }}>
          Turn tables faster.<br />Hear unhappy guests first.<br />Get more Google reviews.
        </h1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24 }}>
          {[
            ["Faster check-out", "Guests scan the table tent, split and pay on their phones the moment they're ready. The table frees up sooner."],
            ["Hear it before they leave", "A low rating texts you with the table number while the guest is still there."],
            ["More Google reviews", "Every guest gets one tap to your listing — happy or not. No review gating."],
            ["Your guest list", "Emails collected every night, plus a monthly report in your inbox."],
          ].map(([h, t]) => (
            <div key={h}><p style={{ fontWeight: 700, fontSize: 16 }}>{h}</p><p style={{ fontSize: 14, color: "#444", marginTop: 4, lineHeight: 1.45 }}>{t}</p></div>
          ))}
        </div>

        <div style={{ marginTop: 28, border: "2px solid #111", borderRadius: 14, padding: 18 }}>
          <p style={{ fontWeight: 700 }}>The table-turn math (example — plug in your own at billtap.app/restaurants)</p>
          <p style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
            {EX.tables} tables · {EX.turn}-minute turns · {EX.saved} minutes saved at check-out (your estimate) ·
            {" "}{EX.hours} busy hours with a wait · {$(EX.check)} average check · {EX.nights} busy nights a month
          </p>
          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 14, textAlign: "center" }}>
            <div><p style={{ fontSize: 26, fontWeight: 800 }}>{extra.toFixed(1)}</p><p style={{ fontSize: 12, color: "#555" }}>extra tables a night</p></div>
            <div><p style={{ fontSize: 26, fontWeight: 800 }}>{$(night)}</p><p style={{ fontSize: 12, color: "#555" }}>a busy night</p></div>
            <div><p style={{ fontSize: 26, fontWeight: 800 }}>{$(month)}</p><p style={{ fontSize: 12, color: "#555" }}>a month, vs. $149</p></div>
          </div>
          <p style={{ fontSize: 11, color: "#777", marginTop: 10 }}>Only hours with guests waiting count. Your room will differ — run your own numbers.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 28 }}>
          <QRCodeSVG value={URL} size={120} />
          <div>
            <p style={{ fontWeight: 800, fontSize: 20 }}>14-day free trial · $149/month after</p>
            <p style={{ fontSize: 14, color: "#444", marginTop: 4 }}>No card. No POS change. Table tents included. Cancel anytime.</p>
            <p style={{ fontSize: 14, marginTop: 6, fontWeight: 600 }}>billtap.app/restaurants · (702) 844-0938</p>
          </div>
        </div>
      </div>
    </main>
  );
}
