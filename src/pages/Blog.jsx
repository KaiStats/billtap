import { Link } from "react-router";
import { QrCode, Calendar } from "lucide-react";
import Seo from "@/components/Seo";

export default function Blog() {
  // Ordered by who they're for: the two an owner comparing tools searches for
  // first, then the two that answer the objection and the "is it worth it".
  // href drives the <a> below — anything still "#" renders as plain text, which
  // is why the placeholders that used to sit here were unclickable.
  const posts = [
    {
      title: "Podium Alternative for Restaurants",
      date: "August 2026",
      excerpt: "Podium asks for reviews by text, days later. BillTap asks at the table, while a manager can still fix the night.",
      href: "/blog/podium-alternative"
    },
    {
      title: "QR Code Bill Splitting Without Changing Your POS",
      date: "August 2026",
      excerpt: "No integration, no new hardware, nothing for servers to learn. It runs beside Toast or Clover, not inside them.",
      href: "/blog/qr-without-pos-change"
    },
    {
      title: "Catch a 1-Star Review Before It Gets Posted",
      date: "August 2026",
      excerpt: "A low rating pings you while the guest is still in the dining room \u2014 two minutes to make it right in person.",
      href: "/blog/catch-1-star-early"
    },
    {
      title: "The Math on One Lost Regular",
      date: "August 2026",
      excerpt: "A weekly regular is worth four figures a year. Here's what one un-caught bad night actually costs you.",
      href: "/blog/cost-of-one-lost-regular"
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#070b16", color: "#f2f2f4" }}>
      <Seo
        path="/blog"
        title="BillTap Blog — Splitting Bills, Reviews & Restaurants"
        description="Notes on splitting checks, getting more Google reviews, and running a restaurant that guests come back to."
      />
      <style>{`
        .font-heading { font-family: 'Inter Tight', 'Inter', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Nav */}
      <nav className="border-b" style={{ borderColor: "#232d3f" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#00c896" }}>
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <span className="font-heading font-bold text-lg" style={{ color: "#00c896" }}>BillTap</span>
          </div>
          <Link to="/" className="text-sm font-medium hover:text-primary transition-colors" style={{ color: "#8390ae" }}>
            ← Back to Home
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-4xl md:text-5xl mb-6" style={{ color: "#f2f2f4" }}>BillTap Blog</h1>
          <p className="text-lg md:text-xl leading-relaxed" style={{ color: "#8390ae" }}>
            Stories about building in public, split math, and making dinners less awkward.
          </p>
        </div>
      </section>

      {/* Posts */}
      <section className="py-16" style={{ background: "#0c1220" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {posts.map((post, i) => (
              <article key={i} className="p-6 rounded-2xl border hover:border-green-400/50 transition-colors" style={{ background: "#1e2533", borderColor: "#232d3f" }}>
                <div className="flex items-center gap-2 text-xs mb-3" style={{ color: "#8390ae" }}>
                  <Calendar className="w-3 h-3" />
                  {post.date}
                </div>
                <h3 className="font-heading font-bold text-xl mb-2" style={{ color: "#f2f2f4" }}>{post.title}</h3>
                <p className="text-sm mb-4" style={{ color: "#8390ae" }}>{post.excerpt}</p>
                {post.href !== "#" ? (
                  <a href={post.href} className="text-sm font-semibold hover:text-primary transition-colors" style={{ color: "#00c896" }}>Read More →</a>
                ) : (
                  <span className="text-sm" style={{ color: "#4a5068" }}>Coming Soon</span>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: "#f2f2f4" }}>Have a Story Idea?</h2>
          <p className="text-lg mb-8" style={{ color: "#8390ae" }}>
            This blog is built from user questions. What do you want to learn about bill splitting?
          </p>
          <a href="mailto:hello@billtap.app" className="inline-block px-8 py-4 rounded-xl font-bold text-lg transition-all hover:opacity-90 border" style={{ borderColor: "#00c896", color: "#00c896" }}>
            Send a Topic →
          </a>
        </div>
      </section>
    </div>
  );
}