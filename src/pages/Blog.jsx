import { Calendar } from "lucide-react";
import Seo from "@/components/Seo";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { mkt } from "@/components/marketing/tokens";
import "@/components/marketing/marketing.css";

export default function Blog() {
  const posts = [
    {
      title: "Why I Built BillTap",
      date: "June 15, 2026",
      excerpt: "The story behind the app and the problem I'm trying to solve.",
      href: "#"
    },
    {
      title: "How QR Codes Make Bill Splitting Frictionless",
      date: "Coming Soon",
      excerpt: "Why guest access without app downloads is the future.",
      href: "#"
    },
    {
      title: "The Math Behind Fair Tip Splitting",
      date: "Coming Soon",
      excerpt: "How we prorate tax and tip across itemized claims.",
      href: "#"
    },
  ];

  return (
    <div className="min-h-screen font-body" style={{ background: mkt.bg, color: mkt.text }}>
      <Seo
        path="/blog"
        title="BillTap Blog — Splitting Bills, Reviews & Restaurants"
        description="Notes on splitting checks, getting more Google reviews, and running a restaurant that guests come back to."
      />

      <MarketingNav />

      <section className="py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-4xl md:text-5xl mb-6" style={{ color: mkt.text }}>BillTap Blog</h1>
          <p className="text-lg md:text-xl leading-relaxed" style={{ color: mkt.muted }}>
            Stories about building in public, split math, and making dinners less awkward.
          </p>
        </div>
      </section>

      <section className="py-16" style={{ background: mkt.bgAlt }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {posts.map((post, i) => (
              <article key={i} className="mkt-card-hover p-6 rounded-2xl border" style={{ background: mkt.card, borderColor: mkt.border }}>
                <div className="flex items-center gap-2 text-xs mb-3" style={{ color: mkt.muted }}>
                  <Calendar className="w-3 h-3" />
                  {post.date}
                </div>
                <h3 className="font-heading font-bold text-xl mb-2" style={{ color: mkt.text }}>{post.title}</h3>
                <p className="text-sm mb-4" style={{ color: mkt.muted }}>{post.excerpt}</p>
                {post.href !== "#" ? (
                  <a href={post.href} className="text-sm font-semibold hover:text-emerald-400 transition-colors" style={{ color: mkt.accent }}>Read More →</a>
                ) : (
                  <span className="text-sm" style={{ color: mkt.dim }}>Coming Soon</span>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: mkt.text }}>Have a Story Idea?</h2>
          <p className="text-lg mb-8" style={{ color: mkt.muted }}>
            This blog is built from user questions. What do you want to learn about bill splitting?
          </p>
          <a href="mailto:hello@billtap.app" className="inline-block px-8 py-4 rounded-xl font-bold text-lg transition-opacity hover:opacity-90 border" style={{ borderColor: mkt.accent, color: mkt.accent }}>
            Send a Topic →
          </a>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
