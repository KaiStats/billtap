import { useState, useEffect } from "react";
import { Check, QrCode, Camera, Users, DollarSign, History, Shield, Smartphone, CreditCard, Zap, FileText, Lock } from "lucide-react";

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "How It Works", href: "#how-it-works" },
    { label: "Pricing", href: "#pricing" },
    { label: "Security", href: "#security" },
  ];

  const steps = [
    {
      icon: "📸",
      title: "Photo the Bill",
      desc: "Host photographs the receipt. AI reads every item instantly. No typing.",
    },
    {
      icon: "📱",
      title: "Share the QR",
      desc: "A unique QR code appears. Everyone scans it. No app download. No account needed.",
    },
    {
      icon: "✅",
      title: "Claim Your Items",
      desc: "Each person claims what they ordered. Tax and tip split proportionally.",
    },
    {
      icon: "💸",
      title: "Pay in One Tap",
      desc: "Venmo, Cash App, or Zelle. One tap. Host sees paid/unpaid in real time.",
    },
  ];

  const splitModes = [
    {
      border: "border-green-500",
      title: "Even Split",
      desc: "Everyone pays the same. Auto-divides as guests join.",
    },
    {
      border: "border-blue-500",
      title: "Itemized Split",
      desc: "Claim exactly what you ordered. Tax and tip prorated automatically.",
    },
    {
      border: "border-yellow-500",
      title: "Custom Split",
      desc: "Percentage, fixed amounts, or shares. You control who pays what.",
    },
  ];

  const features = [
    { icon: Camera, title: "AI Receipt Scanning", desc: "Photograph the bill. AI reads every item instantly." },
    { icon: Lock, title: "Secure QR Tokens", desc: "HMAC-signed. Refreshes every 25 minutes." },
    { icon: Users, title: "Guest Access", desc: "Scan and join. No download. No account." },
    { icon: Zap, title: "Real-Time Tracking", desc: "See who's paid and who hasn't. Live." },
    { icon: CreditCard, title: "One-Tap Payment", desc: "Venmo, Cash App, or Zelle. Done." },
    { icon: FileText, title: "Bill History", desc: "Every split. Always on record." },
  ];

  const stats = [
    { value: "0", label: "Accounts needed to split a bill" },
    { value: "3", label: "Payment apps supported" },
    { value: "25min", label: "QR token security refresh" },
    { value: "Today", label: "Launched in public" },
  ];

  const trustBadges = [
    { icon: Users, text: "Guest Access — No signup to join" },
    { icon: Lock, text: "HMAC Signed — Cryptographic QR tokens" },
    { icon: Shield, text: "Stripe Ready — PCI-compliant billing" },
    { icon: FileText, text: "Zero Data Sold — Your splits stay private" },
    { icon: Smartphone, text: "Venmo/Cash App/Zelle — US payment stack" },
    { icon: Zap, text: "Built in Public — No hidden roadmap" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0a0e1a", color: "#f2f2f4" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
        
        .font-heading { font-family: 'Space Grotesk', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        
        .shimmer-text {
          background: linear-gradient(90deg, #00c896 0%, #00e8a8 50%, #00c896 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 5s linear infinite;
        }
        
        .concentric-circles {
          background: 
            radial-gradient(circle at center, rgba(0, 200, 150, 0.1) 0%, transparent 50%),
            radial-gradient(circle at center, rgba(0, 200, 150, 0.05) 0%, transparent 70%);
        }
        
        .dot-grid {
          background-image: radial-gradient(circle, rgba(0, 200, 150, 0.15) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        
        .glass-nav {
          background: rgba(17, 24, 39, 0.8);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(45, 55, 72, 0.5);
        }
        
        .card-hover {
          transition: all 0.3s ease;
        }
        
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 40px rgba(0, 200, 150, 0.15);
        }
        
        .qr-pulse {
          animation: pulse-glow 3s ease-in-out infinite;
        }
        
        .floating {
          animation: float 6s ease-in-out infinite;
        }
      `}</style>

      {/* STICKY NAV */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "glass-nav" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center" style={{ background: "#00c896" }}>
                <QrCode className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <span className="font-heading font-bold text-lg md:text-xl" style={{ color: "#00c896" }}>BillTap</span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map(link => (
                <a key={link.label} href={link.href} className="text-sm font-medium transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>
                  {link.label}
                </a>
              ))}
            </div>
            
            <div className="flex items-center gap-3 md:gap-4">
              <button className="text-sm font-medium transition-colors hover:text-green-400 hidden sm:block" style={{ color: "#8b90a8" }}>
                Sign in
              </button>
              <button className="px-4 md:px-6 py-2 md:py-2.5 rounded-lg font-semibold text-sm md:text-base transition-all hover:opacity-90" style={{ background: "#00c896", color: "#0a0e1a" }}>
                Start Free
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative min-h-screen flex items-center pt-20 overflow-hidden concentric-circles dot-grid">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 0%, rgba(10, 14, 26, 0.8) 100%)" }} />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 md:space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border" style={{ borderColor: "#2d3748", background: "rgba(17, 24, 39, 0.5)" }}>
                <div className="w-2 h-2 rounded-full shimmer-text" style={{ background: "#00c896" }} />
                <span className="text-xs md:text-sm font-medium" style={{ color: "#8b90a8" }}>AI-Powered · No Account Needed · US Only</span>
              </div>
              
              <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight">
                <span style={{ color: "#f2f2f4" }}>Scan. Split.</span>
                <br />
                <span className="shimmer-text">Settled.</span>
              </h1>
              
              <p className="text-base md:text-lg lg:text-xl max-w-xl leading-relaxed" style={{ color: "#8b90a8" }}>
                Photograph the bill. Everyone scans the QR. Claim your items. Pay in one tap.
                <br className="hidden md:block" />
                No math. No awkwardness. No chasing anyone.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button className="px-8 py-4 rounded-xl font-semibold text-base md:text-lg transition-all hover:opacity-90 flex items-center justify-center gap-2">
                  <span style={{ background: "#00c896", color: "#0a0e1a" }}>Split a Bill Now →</span>
                </button>
                <button className="px-8 py-4 rounded-xl font-semibold text-base md:text-lg border transition-all hover:border-green-400" style={{ borderColor: "#2d3748", color: "#f2f2f4" }}>
                  See How It Works
                </button>
              </div>
              
              <div className="flex flex-wrap items-center gap-4 pt-4">
                <span className="text-xs md:text-sm font-medium px-3 py-1.5 rounded-full" style={{ background: "rgba(0, 200, 150, 0.1)", color: "#00c896" }}>Launching Today</span>
                <span className="text-xs md:text-sm font-medium px-3 py-1.5 rounded-full" style={{ background: "rgba(139, 144, 168, 0.1)", color: "#8b90a8" }}>Built in Public</span>
                <span className="text-xs md:text-sm font-medium px-3 py-1.5 rounded-full" style={{ background: "rgba(139, 144, 168, 0.1)", color: "#8b90a8" }}>Free to Start</span>
                <span className="text-xs md:text-sm font-medium px-3 py-1.5 rounded-full" style={{ background: "rgba(139, 144, 168, 0.1)", color: "#8b90a8" }}>US Only</span>
              </div>
            </div>
            
            <div className="relative hidden lg:block">
              <div className="relative w-full max-w-md mx-auto floating">
                <div className="absolute inset-0 qr-pulse rounded-3xl" style={{ background: "radial-gradient(circle, rgba(0, 200, 150, 0.3) 0%, transparent 70%)" }} />
                <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-3xl p-8 border shadow-2xl" style={{ borderColor: "#2d3748" }}>
                  <div className="aspect-square rounded-2xl flex items-center justify-center mb-6" style={{ background: "#111827" }}>
                    <QrCode className="w-48 h-48" style={{ color: "#00c896" }} />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="font-heading font-bold text-lg" style={{ color: "#f2f2f4" }}>Scan to Split</p>
                    <p className="text-sm" style={{ color: "#8b90a8" }}>BillTap Session #2847</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-16 md:py-24" style={{ background: "#111827" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>How It Works</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Four steps to split any bill. No math required.</p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {steps.map((step, idx) => (
              <div key={idx} className="card-hover p-6 md:p-8 rounded-2xl border" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <div className="text-4xl md:text-5xl mb-4">{step.icon}</div>
                <h3 className="font-heading font-bold text-lg md:text-xl mb-3" style={{ color: "#f2f2f4" }}>{step.title}</h3>
                <p className="text-sm md:text-base leading-relaxed" style={{ color: "#8b90a8" }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SPLIT MODES */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Three Ways to Split</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Choose the split mode that fits your group.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {splitModes.map((mode, idx) => (
              <div key={idx} className={`card-hover p-8 rounded-2xl border-l-4 ${mode.border}`} style={{ background: "#1e2533", border: "1px solid #2d3748" }}>
                <h3 className="font-heading font-bold text-xl md:text-2xl mb-3" style={{ color: "#f2f2f4" }}>{mode.title}</h3>
                <p className="text-base md:text-lg leading-relaxed" style={{ color: "#8b90a8" }}>{mode.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES GRID */}
      <section id="features" className="py-16 md:py-24" style={{ background: "#111827" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Built for Real Dinners</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Everything you need to split bills without the drama.</p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {features.map((feature, idx) => (
              <div key={idx} className="card-hover p-6 md:p-8 rounded-2xl border" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(0, 200, 150, 0.1)" }}>
                  <feature.icon className="w-6 h-6" style={{ color: "#00c896" }} />
                </div>
                <h3 className="font-heading font-bold text-lg md:text-xl mb-2" style={{ color: "#f2f2f4" }}>{feature.title}</h3>
                <p className="text-sm md:text-base" style={{ color: "#8b90a8" }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Simple Pricing</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Start free. Upgrade when you need more.</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto">
            {/* FREE */}
            <div className="card-hover p-8 rounded-2xl border-2" style={{ background: "#1e2533", borderColor: "#00c896" }}>
              <div className="mb-6">
                <h3 className="font-heading font-bold text-2xl md:text-3xl mb-2" style={{ color: "#f2f2f4" }}>Free</h3>
                <p className="text-lg" style={{ color: "#8b90a8" }}>Unlimited splits · Forever</p>
              </div>
              <div className="mb-6 p-4 rounded-lg" style={{ background: "rgba(0, 200, 150, 0.1)", border: "1px solid rgba(0, 200, 150, 0.3)" }}>
                <p className="text-sm font-semibold" style={{ color: "#00c896" }}>✓ No usage limits — split as many bills as you want</p>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "All 3 split modes (Even, Itemized, Custom)",
                  "AI receipt scanning (first 5 per month)",
                  "QR code generation & sharing",
                  "Real-time settlement tracking",
                  "30-day bill history",
                  "Venmo/Cash App/Zelle integration",
                ].map(feature => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#00c896" }} />
                    <span className="text-sm md:text-base" style={{ color: "#8b90a8" }}>{feature}</span>
                  </li>
                ))}
              </ul>
              <button className="w-full py-4 rounded-xl font-semibold text-base border-2 transition-all hover:border-green-400" style={{ borderColor: "#00c896", color: "#00c896", background: "transparent" }}>
                Start Free — No Credit Card
              </button>
            </div>
            
            {/* PRO */}
            <div className="card-hover p-8 rounded-2xl border-2 relative" style={{ background: "#1e2533", borderColor: "#d4af37" }}>
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#d4af37", color: "#0a0e1a" }}>
                Best Value
              </div>
              <div className="mb-6">
                <h3 className="font-heading font-bold text-2xl md:text-3xl mb-2" style={{ color: "#f2f2f4" }}>Pro</h3>
                <p className="text-lg" style={{ color: "#8b90a8" }}>$3.99/mo or $29/year</p>
              </div>
              <div className="mb-6 p-4 rounded-lg" style={{ background: "rgba(212, 175, 55, 0.1)", border: "1px solid rgba(212, 175, 55, 0.3)" }}>
                <p className="text-sm font-semibold" style={{ color: "#d4af37" }}>For power users & frequent splitters</p>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "Everything in Free, plus:",
                  "Unlimited bill history (keep forever)",
                  "Unlimited AI receipt scanning",
                  "Recurring splits (perfect for roommates)",
                  "CSV export for expense tracking",
                  "Priority email support",
                ].map(feature => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#d4af37" }} />
                    <span className="text-sm md:text-base" style={{ color: "#8b90a8" }}>{feature}</span>
                  </li>
                ))}
              </ul>
              <button className="w-full py-4 rounded-xl font-semibold text-base transition-all hover:opacity-90" style={{ background: "#d4af37", color: "#0a0e1a" }}>
                Start 14-Day Free Trial
              </button>
            </div>
          </div>
          
          <div className="mt-8 p-4 rounded-lg text-center" style={{ background: "rgba(139, 144, 168, 0.1)", border: "1px solid rgba(139, 144, 168, 0.3)" }}>
            <p className="text-sm md:text-base font-medium" style={{ color: "#8b90a8" }}>
              <span className="text-green-400">Free = unlimited splits forever</span> · Pro adds unlimited history & AI scans · Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* TRUST SIGNALS */}
      <section id="security" className="py-16 md:py-24" style={{ background: "#111827" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-8" style={{ color: "#f2f2f4" }}>Trust by Numbers</h2>
              <div className="grid grid-cols-2 gap-4 md:gap-6">
                {stats.map(stat => (
                  <div key={stat.label} className="p-6 rounded-xl border" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                    <div className="font-heading font-bold text-3xl md:text-4xl mb-2 shimmer-text">{stat.value}</div>
                    <div className="text-sm md:text-base" style={{ color: "#8b90a8" }}>{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-heading font-bold text-xl md:text-2xl mb-6" style={{ color: "#f2f2f4" }}>Why You Can Trust BillTap</h3>
              {trustBadges.map(badge => (
                <div key={badge.text} className="flex items-start gap-4 p-4 rounded-xl" style={{ background: "#1e2533" }}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0, 200, 150, 0.1)" }}>
                    <badge.icon className="w-5 h-5" style={{ color: "#00c896" }} />
                  </div>
                  <p className="text-sm md:text-base pt-1" style={{ color: "#8b90a8" }}>{badge.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-6" style={{ color: "#f2f2f4" }}>
            The bill just came.
            <br />
            <span className="shimmer-text">Don't do the math.</span>
          </h2>
          <p className="text-lg md:text-xl mb-8 max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>
            BillTap handles it. Scan, claim, pay. Built for real dinners with real friends. Free to start. No tricks.
          </p>
          <button className="px-8 md:px-12 py-4 md:py-5 rounded-xl font-semibold text-lg md:text-xl transition-all hover:opacity-90" style={{ background: "#00c896", color: "#0a0e1a" }}>
            Split Your First Bill Free →
          </button>
          <p className="mt-6 text-sm" style={{ color: "#8b90a8" }}>No credit card. No account needed. US only.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 md:py-16 border-t" style={{ borderColor: "#2d3748" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#00c896" }}>
                  <QrCode className="w-5 h-5 text-white" />
                </div>
                <span className="font-heading font-bold text-xl" style={{ color: "#00c896" }}>BillTap</span>
              </div>
              <p className="text-base mb-4 max-w-sm" style={{ color: "#8b90a8" }}>
                The fastest way to split a bill. No math. No drama. No chasing anyone.
              </p>
            </div>
            
            <div>
              <h4 className="font-heading font-bold text-sm mb-4 uppercase tracking-wider" style={{ color: "#f2f2f4" }}>Product</h4>
              <ul className="space-y-3">
                {["How It Works", "Pricing", "Security"].map(link => (
                  <li key={link}>
                    <a href="#" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>{link}</a>
                  </li>
                ))}
              </ul>
            </div>
            
            <div>
              <h4 className="font-heading font-bold text-sm mb-4 uppercase tracking-wider" style={{ color: "#f2f2f4" }}>Legal</h4>
              <ul className="space-y-3">
                {["Terms", "Privacy", "Data DPA"].map(link => (
                  <li key={link}>
                    <a href="#" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>{link}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t text-center md:text-left" style={{ borderColor: "#2d3748" }}>
            <p className="text-sm" style={{ color: "#8b90a8" }}>
              © 2026 BillTap. Built in public by Kai Cogmon. billtap.app
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}