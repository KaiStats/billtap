import { Link } from "react-router-dom";
import { QrCode, Zap } from "lucide-react";
import Seo from "@/components/Seo";

export default function Changelog() {
  const versions = [
    {
      version: "1.0.0",
      date: "June 15, 2026",
      title: "Public Launch",
      changes: [
        "AI receipt scanning with Gemini",
        "Three split modes: Even, Itemized, Custom",
        "HMAC-signed QR tokens (25min refresh)",
        "Real-time payment tracking",
        "Guest access without app download",
        "Venmo, Cash App, Zelle integration",
      ]
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0a0e1a", color: "#f2f2f4" }}>
      <Seo
        path="/changelog"
        title="Changelog | BillTap"
        description="Every shipped change to BillTap — new features, fixes and improvements, newest first."
      />
      <style>{`
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
          <h1 className="font-heading font-bold text-4xl md:text-5xl mb-6" style={{ color: "#f2f2f4" }}>Changelog</h1>
          <p className="text-lg md:text-xl leading-relaxed" style={{ color: "#8b90a8" }}>
            Every update, shipped in public. No hidden roadmap.
          </p>
        </div>
      </section>

      {/* Versions */}
      <section className="py-16" style={{ background: "#111827" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-8">
            {versions.map((v, i) => (
              <div key={i} className="p-6 rounded-2xl border" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,150,0.1)" }}>
                    <Zap className="w-5 h-5" style={{ color: "#00c896" }} />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-xl" style={{ color: "#f2f2f4" }}>v{v.version} — {v.title}</h3>
                    <p className="text-xs" style={{ color: "#8b90a8" }}>{v.date}</p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {v.changes.map((change, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm" style={{ color: "#8b90a8" }}>
                      <span className="text-green-400 mt-1">•</span>
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading font-bold text-2xl md:text-3xl mb-6" style={{ color: "#f2f2f4" }}>Feature Request?</h2>
          <p className="text-lg mb-8" style={{ color: "#8b90a8" }}>
            Every changelog entry starts with a user request. What should we build next?
          </p>
          <a href="mailto:hello@billtap.app" className="inline-block px-8 py-4 rounded-xl font-bold text-lg transition-all hover:opacity-90 border" style={{ borderColor: "#00c896", color: "#00c896" }}>
            Suggest a Feature →
          </a>
        </div>
      </section>
    </div>
  );
}