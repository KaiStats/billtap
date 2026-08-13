import Seo from "@/components/Seo";
import { Link } from "react-router";

// Same accent the /restaurants page uses. Kept local rather than imported:
// GOLD is a page-level const over there, not an exported module.
const GOLD = "#f0b429";

const LEAD = { color: "rgba(245,245,244,.80)", fontSize: "1.125rem", lineHeight: 1.7, marginBottom: "1.5rem" };
const P = { color: "rgba(245,245,244,.68)", lineHeight: 1.75, marginBottom: "1rem" };
const H2 = { color: "#f5f5f4", fontSize: "1.6rem", fontWeight: 600, marginTop: "2.5rem", marginBottom: ".75rem" };
const H3 = { color: "#f5f5f4", fontSize: "1.1rem", fontWeight: 600, marginTop: "1.75rem", marginBottom: ".5rem" };

export default function BlogPost01PodiumAlternative() {
  return (
    <main className="min-h-screen" style={{ background: "#070b16" }}>
      <Seo
        path="/blog/podium-alternative"
        title="Podium Alternative for Restaurants | BillTap"
        description="Why BillTap beats Podium: no integration, no new hardware, reviews captured at the moment of payment instead of days later."
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <Link to="/blog" className="text-sm hover:underline" style={{ color: GOLD }}>
          ← All posts
        </Link>

        <h1 className="font-display mt-6 mb-8" style={{ color: "#f5f5f4", fontSize: "2.5rem", lineHeight: 1.15 }}>
          Podium Alternative for Restaurants
        </h1>

      <p style={LEAD}>
        If you've looked at Podium, you know the pitch: text-message customer contact,
        review requests, reputation management. The catch is that it's built around SMS,
        not around the moment a guest pays. For a restaurant, that gap is where the
        reviews go to die.
      </p>

      <h2 style={H2}>Where the Podium flow breaks</h2>
      <p style={P}>
        Someone on your staff has to collect a phone number, or read a link out loud.
        The guest opts in. A day or two later a review request arrives, by which point
        they're at work thinking about something else. Even the ones who respond respond
        late — and nothing about that loop tells you a table went badly while the table
        is still sitting there.
      </p>

      <h2 style={H2}>What BillTap does instead</h2>

      <h3 style={H3}>No staff step at all</h3>
      <p style={P}>
        Guests scan a QR code on the table, split the check on their own phones, and rate
        the visit when they're done paying. Nobody has to ask, so it happens at every
        table instead of the tables where a server remembered.
      </p>

      <h3 style={H3}>Feedback while you can still use it</h3>
      <p style={P}>
        A low rating pings you in real time, while the guest is still in the dining room.
        That's a manager walking over with a fix, rather than a defensive reply typed into
        Google a week later.
      </p>

      <h3 style={H3}>Nothing to integrate</h3>
      <p style={P}>
        Podium wants to connect to your POS, and that connection is a project — scheduling,
        testing, a vendor support queue. BillTap doesn't touch your POS. There's nothing to
        connect, so there's nothing to schedule.
      </p>

      <h3 style={H3}>The review flow is honest</h3>
      <p style={P}>
        Every guest gets the same Google review link regardless of what they rated. Nothing
        is gated or hidden by score. The rating just decides whether you also get an alert.
      </p>

      <h2 style={H2}>The short version</h2>
      <p style={P}>
        Podium is a text-marketing tool that also asks for reviews. BillTap works at the
        moment of payment, when the guest is still holding the experience in their head and
        your team can still do something about it.
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
