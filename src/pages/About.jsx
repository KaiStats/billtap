import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { mkt } from "@/components/marketing/tokens";
import "@/components/marketing/marketing.css";

export default function About() {
  return (
    <div className="min-h-screen font-body" style={{ background: mkt.bg, color: mkt.text }}>
      <Seo
        path="/about"
        title="About BillTap — Why We Built It"
        description="BillTap started with one annoying question at the end of every meal: who owes what? Here's how we set out to answer it in under a minute."
      />

      <MarketingNav />

      <section className="py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-4xl md:text-5xl mb-6" style={{ color: mkt.text }}>About BillTap</h1>
          <p className="text-lg md:text-xl leading-relaxed" style={{ color: mkt.muted }}>
            BillTap was born from a simple frustration: splitting bills should be easy, but it's always awkward.
          </p>
        </div>
      </section>

      <section className="py-16" style={{ background: mkt.bgAlt }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: mkt.text }}>The Story</h2>
          <div className="space-y-4 text-base leading-relaxed" style={{ color: mkt.muted }}>
            <p>
              After yet another dinner where we spent 20 minutes calculating who owes what, downloading yet another app,
              and still forgetting someone's Venmo request, I knew there had to be a better way.
            </p>
            <p>BillTap is built on three principles:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong style={{ color: mkt.text }}>No accounts required</strong> — Guests join by scanning a QR code</li>
              <li><strong style={{ color: mkt.text }}>No math</strong> — AI reads the receipt, splits automatically</li>
              <li><strong style={{ color: mkt.text }}>No awkwardness</strong> — Everyone sees who's paid in real time</li>
            </ul>
            <p>
              This is a solo project, built in public. Every feature comes from real user feedback.
              No roadmap, no promises — just shipping what people actually need.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: mkt.text }}>Try It Free</h2>
          <p className="text-lg mb-8" style={{ color: mkt.muted }}>
            Split your first bill in under 2 minutes. No credit card. No account needed.
          </p>
          <Link to="/new-receipt" className="inline-block px-8 py-4 rounded-xl font-bold text-lg transition-opacity hover:opacity-90" style={{ background: mkt.accent, color: mkt.accentInk }}>
            Split a Bill Now →
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
