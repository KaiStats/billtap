import { Link } from "react-router";
import { Check, ArrowRight, Star, Bell, Mail } from "lucide-react";
import Seo from "@/components/Seo";

/**
 * Landing page for ads aimed at restaurants in their first months.
 *
 * Same honesty rule as /restaurants (src/csp.test.mjs): no performance number
 * BillTap has not measured. "50 reviews" is a goal the owner sets, framed as
 * one. Sign-up happens on /restaurants; the utm tag files the lead's source.
 */
const GOLD = "#f0b429";
const INK = "#0b0b0d";
const SIGNUP = "/restaurants?utm_source=new_restaurants&utm_campaign=new_opening";

const STEPS = [
  { icon: Star, title: "Every guest is asked, from night one", desc: "A table tent (or a code on the cup and bag) gives every guest one tap to your Google listing. No waiting for regulars to remember to review you." },
  { icon: Bell, title: "Opening-week problems reach you first", desc: "A low rating texts you while the guest is still there, so a manager can fix it tonight instead of answering a review next week." },
  { icon: Mail, title: "Your guest list starts on day one", desc: "Guests opt in as they finish. When your first slow week comes, you already have people to invite back." },
];

export default function NewRestaurants() {
  return (
    <main className="min-h-screen" style={{ background: INK, color: "#f5f5f4" }}>
      <Seo
        path="/new-restaurants"
        title="Just Opened? Get Your First Google Reviews Faster | BillTap"
        description="For new restaurants: ask every guest for a Google review from your first night, hear about problems while the guest is still there, and build your guest list from day one. 14-day free trial."
      />

      <div className="max-w-4xl mx-auto px-5 sm:px-8 pt-20 pb-16">
        <Link to="/restaurants" className="text-sm hover:underline" style={{ color: GOLD }}>BillTap for restaurants</Link>

        <p className="mt-10 text-xs uppercase tracking-[.14em] font-semibold" style={{ color: "#30a46c" }}>Just opened?</p>
        <h1 className="mt-3 font-display leading-[1.02]" style={{ fontSize: "clamp(2.4rem, 6vw, 4.2rem)" }}>
          Your first 50 Google reviews decide whether strangers take a chance on you.
        </h1>
        <p className="mt-6 text-lg leading-relaxed font-light max-w-2xl" style={{ color: "rgba(245,245,244,.72)" }}>
          A new place with six reviews loses to the one down the street with six hundred —
          even if your food is better. BillTap asks every guest, every night, from the day
          you open. And when opening week goes sideways, you hear it in the room, not online.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-3">
          <Link to={SIGNUP} className="inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-full"
            style={{ background: GOLD, color: INK }}>
            Start your 14-day free trial <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/restaurants#turns" className="inline-flex items-center justify-center font-semibold px-7 py-4 rounded-full"
            style={{ border: "1px solid rgba(245,245,244,.28)", color: "#f5f5f4" }}>
            Run the table-turn calculator
          </Link>
        </div>
        <p className="mt-3 text-sm" style={{ color: "rgba(245,245,244,.45)" }}>No card. Table tents included. Live in minutes.</p>

        <div className="mt-16 grid md:grid-cols-3 gap-4">
          {STEPS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-6 rounded-2xl" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
              <Icon className="w-5 h-5" style={{ color: GOLD }} aria-hidden="true" />
              <h2 className="mt-4 font-semibold text-lg leading-snug">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.64)" }}>{desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 p-7 rounded-2xl" style={{ background: "rgba(240,180,41,.06)", border: "1px solid rgba(240,180,41,.25)" }}>
          <h2 className="font-display text-2xl">Honest reviews only.</h2>
          <ul className="mt-4 space-y-2.5">
            {[
              "Every guest gets the same Google button, whatever they rated — no review gating",
              "Nothing to integrate: runs beside Toast, Square, Clover or cash",
              "$149/month after the trial. No contract, cancel anytime",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm font-light" style={{ color: "rgba(245,245,244,.85)" }}>
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#30a46c" }} aria-hidden="true" />{t}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 text-center">
          <Link to={SIGNUP} className="inline-flex items-center gap-2 font-semibold px-7 py-4 rounded-full" style={{ background: GOLD, color: INK }}>
            Get set up before your next service <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </main>
  );
}
