import Seo from "@/components/Seo";
import { Link } from "react-router";

// Same accent the /restaurants page uses. Kept local rather than imported:
// GOLD is a page-level const over there, not an exported module.
const GOLD = "#f0b429";

const LEAD = { color: "rgba(245,245,244,.80)", fontSize: "1.125rem", lineHeight: 1.7, marginBottom: "1.5rem" };
const P = { color: "rgba(245,245,244,.68)", lineHeight: 1.75, marginBottom: "1rem" };
const H2 = { color: "#f5f5f4", fontSize: "1.6rem", fontWeight: 600, marginTop: "2.5rem", marginBottom: ".75rem" };
const H3 = { color: "#f5f5f4", fontSize: "1.1rem", fontWeight: 600, marginTop: "1.75rem", marginBottom: ".5rem" };

export default function BlogPost04CostOfOneLostRegular() {
  return (
    <main className="min-h-screen" style={{ background: "#070b16" }}>
      <Seo
        path="/blog/cost-of-one-lost-regular"
        title="The Math on One Lost Regular | BillTap"
        description="A weekly regular is worth thousands a year. Here's the arithmetic on what one un-caught bad night actually costs."
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <Link to="/blog" className="text-sm hover:underline" style={{ color: GOLD }}>
          ← All posts
        </Link>

        <h1 className="font-display mt-6 mb-8" style={{ color: "#f5f5f4", fontSize: "2.5rem", lineHeight: 1.15 }}>
          The Math on One Lost Regular
        </h1>

      <p style={LEAD}>
        A bad review stings for an afternoon. The regular who quietly stopped coming costs
        you for a year, and most owners never do that arithmetic.
      </p>

      <h2 style={H2}>Run the numbers</h2>
      <p style={P}>
        Take a guest who comes in weekly on a $45 average check. That's roughly $2,300 a
        year in direct revenue before you count the friends they bring, the second round
        they order because they're comfortable, or the coworkers they pick the place for.
        Owners who track it tend to land somewhere north of $4,000 in annual value.
      </p>
      <p style={P}>
        Now give them one bad night — a 45-minute wait on a Tuesday you were short-staffed.
        They don't complain. They leave, they rate you two stars from the sidewalk, and they
        don't come back. You've lost the year of revenue and gained a review that quietly
        talks a few strangers out of walking in.
      </p>

      <h2 style={H2}>What changes when you find out at the table</h2>
      <p style={P}>
        With a real-time alert, that same night is a manager at the table before they stand
        up: "We missed tonight — let me take care of dessert." Ten minutes and the cost of a
        round, against four figures of annual revenue. Most of those guests don't post at
        all; some come back the next week specifically because you noticed.
      </p>

      <h2 style={H2}>Against the price</h2>
      <p style={P}>
        BillTap runs $149/month — about $1,800 a year. One saved regular covers it twice
        over. Two or three makes it one of the cheapest lines on your P&amp;L, and that's
        before counting the five-star reviews the happy tables leave on the way out.
      </p>

      <h2 style={H2}>The pattern underneath</h2>
      <p style={P}>
        Individual saves are the obvious win. The quieter one is the shape of the data: if
        low ratings cluster on a shift, that's a staffing problem you can now see. You can't
        fix what leaves without telling you.
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
