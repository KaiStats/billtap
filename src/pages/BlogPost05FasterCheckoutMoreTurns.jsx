import Seo from "@/components/Seo";
import { postSchema } from "@/lib/posts";
import { Link } from "react-router";

const GOLD = "#f0b429";

const LEAD = { color: "rgba(245,245,244,.80)", fontSize: "1.125rem", lineHeight: 1.7, marginBottom: "1.5rem" };
const P = { color: "rgba(245,245,244,.68)", lineHeight: 1.75, marginBottom: "1rem" };
const H2 = { color: "#f5f5f4", fontSize: "1.6rem", fontWeight: 600, marginTop: "2.5rem", marginBottom: ".75rem" };

const DESC = "The slowest part of a table is often the end. Here's where check-out time goes, and the arithmetic on what getting it back is worth on a busy night.";

export default function BlogPost05FasterCheckoutMoreTurns() {
  return (
    <main className="min-h-screen" style={{ background: "#070b16" }}>
      <Seo
        path="/blog/faster-checkout-more-turns"
        title="How Faster Check-Out Turns More Tables | BillTap"
        description={DESC}
        type="article"
        schema={postSchema("faster-checkout-more-turns", DESC)}
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <Link to="/blog" className="inline-flex items-center text-sm hover:underline" style={{ color: GOLD }}>
          ← All posts
        </Link>

        <h1 className="font-display mt-6 mb-8" style={{ color: "#f5f5f4", fontSize: "2.5rem", lineHeight: 1.15 }}>
          How Faster Check-Out Turns More Tables
        </h1>

      <p style={LEAD}>
        Owners spend real money shaving minutes off ticket times in the kitchen. The minutes
        at the end of the meal — after the last plate is cleared — usually get no attention
        at all.
      </p>

      <h2 style={H2}>Where the end of the meal goes</h2>
      <p style={P}>
        Watch a table after dessert. They try to catch the server&apos;s eye. The server is
        in the weeds on another section. The check arrives. Six people work out who had the
        extra drink. Cards go into the folder, the folder goes to the terminal, the folder
        comes back, everyone signs. None of those steps is long. Together they are the part
        of the visit where the guest has stopped spending and the table still isn&apos;t free.
      </p>

      <h2 style={H2}>Why it only matters on some nights</h2>
      <p style={P}>
        A freed-up table is only worth money if someone is waiting for it. On a quiet Tuesday,
        a table that clears ten minutes sooner just sits empty ten minutes longer. On a Friday
        with a forty-minute quote at the host stand, those same minutes are the difference
        between seating one more party and watching them walk to the place next door.
      </p>

      <h2 style={H2}>Run it on your own room</h2>
      <p style={P}>
        Take your own numbers: how many tables, how long a table takes now, how many hours a
        night you have a wait, and your average check per table. Guess how many minutes you
        lose at check-out. Divide your busy hours by your table time, then by your table time
        minus those minutes — the difference, times your tables, is the extra parties you
        could seat. Multiply by your average check.
      </p>
      <p style={P}>
        We built that arithmetic into a{" "}
        <Link to="/restaurants#turns" style={{ color: GOLD }} className="hover:underline">calculator</Link>{" "}
        so you don&apos;t have to do it on a napkin. It uses your numbers, not ours — we
        haven&apos;t timed your room, and anyone who quotes you a turn-time figure without
        timing it is guessing.
      </p>

      <h2 style={H2}>What actually shortens it</h2>
      <p style={P}>
        The waiting is the problem, so remove the waiting. When guests can scan a code, split
        the check on their own phones and settle up the moment they&apos;re ready, nobody has
        to flag the server, nobody does math on six cards at the table, and the server is back
        on the floor instead of at the terminal. That&apos;s what BillTap does — and on the
        way out, every guest gets asked how it went, so you also hear about the bad night
        before it turns into a review.
      </p>

      <h2 style={H2}>The quiet bonus</h2>
      <p style={P}>
        Guests who leave on their own schedule leave happier. Nobody likes the ten minutes of
        holding a card in the air. Ending the meal well is part of the meal.
      </p>

        <div className="mt-14 pt-8" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <p style={{ color: "rgba(245,245,244,.55)", fontSize: ".875rem" }}>
            BillTap is $149/month after a 14-day free trial. No contract, cancel anytime.{" "}
            <Link to="/restaurants#turns" style={{ color: GOLD }} className="hover:underline">
              Run the calculator →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
