import { Link } from "react-router-dom";
import { QrCode } from "lucide-react";

export default function About() {
  return (
    <div className="min-h-screen" style={{ background: "#0a0e1a", color: "#f2f2f4" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
        .font-heading { font-family: 'Space Grotesk', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Nav */}
      <nav className="border-b" style={{ borderColor: "#2d3748" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#00c896" }}>
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <span className="font-heading font-bold text-lg" style={{ color: "#00c896" }}>BillTap</span>
          </div>
          <Link to="/" className="text-sm font-medium hover:text-green-400 transition-colors" style={{ color: "#8b90a8" }}>
            ← Back to Home
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-4xl md:text-5xl mb-6" style={{ color: "#f2f2f4" }}>About BillTap</h1>
          <p className="text-lg md:text-xl leading-relaxed" style={{ color: "#8b90a8" }}>
            BillTap was born from a simple frustration: splitting bills should be easy, but it's always awkward.
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="py-16" style={{ background: "#111827" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: "#f2f2f4" }}>The Story</h2>
          <div className="space-y-4 text-base leading-relaxed" style={{ color: "#8b90a8" }}>
            <p>
              After yet another dinner where we spent 20 minutes calculating who owes what, downloading yet another app, 
              and still forgetting someone's Venmo request, I knew there had to be a better way.
            </p>
            <p>
              BillTap is built on three principles:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>No accounts required</strong> — Guests join by scanning a QR code</li>
              <li><strong>No math</strong> — AI reads the receipt, splits automatically</li>
              <li><strong>No awkwardness</strong> — Everyone sees who's paid in real time</li>
            </ul>
            <p>
              This is a solo project, built in public. Every feature comes from real user feedback. 
              No roadmap, no promises — just shipping what people actually need.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: "#f2f2f4" }}>Try It Free</h2>
          <p className="text-lg mb-8" style={{ color: "#8b90a8" }}>
            Split your first bill in under 2 minutes. No credit card. No account needed.
          </p>
          <Link to="/NewReceipt" className="inline-block px-8 py-4 rounded-xl font-bold text-lg transition-all hover:opacity-90" style={{ background: "#00c896", color: "#0a0e1a" }}>
            Split a Bill Now →
          </Link>
        </div>
      </section>
    </div>
  );
}