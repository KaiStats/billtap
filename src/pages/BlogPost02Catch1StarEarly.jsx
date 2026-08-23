import Seo from "@/components/Seo";
import { postSchema } from "@/lib/posts";
import { Link } from "react-router";

// Same accent the /restaurants page uses. Kept local rather than imported:
// GOLD is a page-level const over there, not an exported module.
const GOLD = "#f0b429";

const LEAD = { color: "rgba(245,245,244,.80)", fontSize: "1.125rem", lineHeight: 1.7, marginBottom: "1.5rem" };
const P = { color: "rgba(245,245,244,.68)", lineHeight: 1.75, marginBottom: "1rem" };
const H2 = { color: "#f5f5f4", fontSize: "1.6rem", fontWeight: 600, marginTop: "2.5rem", marginBottom: ".75rem" };
const H3 = { color: "#f5f5f4", fontSize: "1.1rem", fontWeight: 600, marginTop: "1.75rem", marginBottom: ".5rem" };

export default function BlogPost02Catch1StarEarly() {
  return (
    <main className="min-h-screen" style={{ background: "#070b16" }}>
      <Seo
        path="/blog/catch-1-star-early"
        title="Catch a 1-Star Review Before It Gets Posted | BillTap"
        description="A low rating alerts you while the guest is still at the table, so a manager can fix it in person instead of replying to it on Google a week later."
        type="article"
        schema={postSchema("catch-1-star-early", "A low rating alerts you while the guest is still at the table, so a manager can fix it in person instead of replying to it on Google a week later.")}
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <Link to="/blog" className="text-sm hover:underline" style={{ color: GOLD }}>
          ← All posts
        </Link>

        <h1 className="font-display mt-6 mb-8" style={{ color: "#f5f5f4", fontSize: "2.5rem", lineHeight: 1.15 }}>
          Catch a 1-Star Review Before It Gets Posted
        </h1>

      <p style={LEAD}>
        The expensive part of a bad review isn't the star rating. It's the silence in front
        of it — the guest who left unhappy, said nothing, and posted four days later, when
        the only move left is a public apology to a stranger.
      </p>

      <h2 style={H2}>How the alert works</h2>
      <p style={P}>
        Guests split the check from a QR code and rate the visit as they pay. Anything below
        five stars sends you an alert immediately — usually while they're still gathering
        their coats. You get a couple of minutes to decide whether to walk over.
      </p>

      <h2 style={H2}>Why those two minutes matter</h2>

      <h3 style={H3}>The problem is still fixable</h3>
      <p style={P}>
        A three-star night is almost always something specific: a long wait, a cold plate,
        a wrong order. In person, that's a comped round and a real apology, and the guest
        leaves as someone who'll come back. Once they're in the parking lot, it's a review.
      </p>

      <h3 style={H3}>It turns complaints into data</h3>
      <p style={P}>
        Patterns show up fast. Ratings dip on Thursdays. One section rates lower than the
        rest. That's a staffing decision or a table-layout decision you couldn't see before,
        because unhappy guests mostly just don't come back and never tell you why.
      </p>

      <h3 style={H3}>Nothing is being hidden</h3>
      <p style={P}>
        Every guest gets the same Google link, whatever they rated. You're not filtering
        reviews — you're just finding out first, and doing something about it before the
        guest decides what to write.
      </p>

      <h2 style={H2}>The real advantage</h2>
      <p style={P}>
        Most restaurants learn about a bad night from Google, days late, with no recourse but
        a reply. Catching it at the table isn't reputation management. It's just service,
        delivered in time to count.
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
