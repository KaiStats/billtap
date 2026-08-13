import Seo from "@/components/Seo";
import { Link } from "react-router";

// Same accent the /restaurants page uses. Kept local rather than imported:
// GOLD is a page-level const over there, not an exported module.
const GOLD = "#f0b429";

const LEAD = { color: "rgba(245,245,244,.80)", fontSize: "1.125rem", lineHeight: 1.7, marginBottom: "1.5rem" };
const P = { color: "rgba(245,245,244,.68)", lineHeight: 1.75, marginBottom: "1rem" };
const H2 = { color: "#f5f5f4", fontSize: "1.6rem", fontWeight: 600, marginTop: "2.5rem", marginBottom: ".75rem" };
const H3 = { color: "#f5f5f4", fontSize: "1.1rem", fontWeight: 600, marginTop: "1.75rem", marginBottom: ".5rem" };

export default function BlogPost03QRWithoutPOS() {
  return (
    <main className="min-h-screen" style={{ background: "#070b16" }}>
      <Seo
        path="/blog/qr-without-pos-change"
        title="QR Code Bill Splitting Without Changing Your POS | BillTap"
        description="No integration, no new hardware, no retraining. BillTap runs alongside Toast, Clover, Square, or anything else you already use."
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <Link to="/blog" className="text-sm hover:underline" style={{ color: GOLD }}>
          ← All posts
        </Link>

        <h1 className="font-display mt-6 mb-8" style={{ color: "#f5f5f4", fontSize: "2.5rem", lineHeight: 1.15 }}>
          QR Code Bill Splitting Without Changing Your POS
        </h1>

      <p style={LEAD}>
        The first question every owner asks about new restaurant tech is whether it will
        break the POS. For most tools the honest answer is "maybe, and finding out takes
        three weeks." BillTap never touches it.
      </p>

      <h2 style={H2}>The whole flow</h2>
      <p style={P}>
        A table tent carries a QR code. Guests scan it, see the check, split it among
        themselves, pay, and rate the visit. Your POS never learns any of this happened,
        your servers don't press anything new, and the kitchen's night is identical.
      </p>

      <h2 style={H2}>What "no integration" actually buys you</h2>

      <h3 style={H3}>You start the same day</h3>
      <p style={P}>
        There's no API to connect and no vendor ticket to wait on. You print a code and
        put it on the tables.
      </p>

      <h3 style={H3}>No hardware</h3>
      <p style={P}>
        No tablets, no dongles, no second printer. Guests use the phones in their pockets;
        you use the one already in yours.
      </p>

      <h3 style={H3}>Nothing for staff to learn</h3>
      <p style={P}>
        A server's job doesn't change. The only new step in the building is setting out a
        table tent.
      </p>

      <h3 style={H3}>It can't take the POS down with it</h3>
      <p style={P}>
        An integration that breaks takes payments with it. BillTap runs beside your system
        rather than inside it, so its worst failure mode is that guests pay the way they
        did last year.
      </p>

      <h3 style={H3}>Every POS is compatible</h3>
      <p style={P}>
        Toast, Clover, Square, or a terminal that's been on the counter for a decade — it
        works with all of them precisely because it works with none of them.
      </p>

      <h2 style={H2}>The point</h2>
      <p style={P}>
        Restaurant tech is best when it's invisible. Guests see one screen on their own
        phone. Your team sees nothing. Reviews show up in Google a few minutes later.
      </p>

        <div className="mt-14 pt-8" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <p style={{ color: "rgba(245,245,244,.55)", fontSize: ".875rem" }}>
            BillTap is $149/month after a 14-day free trial. No contract, cancel anytime.{" "}
            <Link to="/restaurants" style={{ color: GOLD }} className="hover:underline">
              See how it works →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
