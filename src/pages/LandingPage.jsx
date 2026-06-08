import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { QrCode, Receipt, CreditCard, Smartphone, Users, Zap, ArrowRight, ChevronRight, Star, Check, Camera } from "lucide-react";

function useScrollReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.12 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}

function Reveal({ children, className = "", delay = 0 }) {
  const [ref, visible] = useScrollReveal();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [dot, setDot] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setDot((d) => !d), 1500);
    return () => clearInterval(t);
  }, []);

  const handleCTA = () => navigate("/NewReceipt");

  return (
    <div className="min-h-screen bg-[#09090b] text-white">

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5">
        <span className="text-xl font-black tracking-tight">
          <span className="text-violet-400">Bill</span><span className="text-white">Tap</span>
        </span>
        <button
          onClick={handleCTA}
          className="text-sm font-bold px-4 py-2 rounded-lg bg-violet-500 text-white hover:bg-violet-400 transition-all duration-200 hover:scale-105 active:scale-95"
        >
          Try Free
        </button>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-500/10 blur-[100px] animate-pulse pointer-events-none" />
        <div className="absolute top-1/3 right-1/4 w-[250px] h-[250px] rounded-full bg-violet-400/5 blur-[70px] animate-pulse pointer-events-none" style={{ animationDelay: "0.8s" }} />
        <div className="absolute bottom-1/3 left-1/4 w-[200px] h-[200px] rounded-full bg-fuchsia-500/5 blur-[60px] animate-pulse pointer-events-none" style={{ animationDelay: "1.5s" }} />

        <div className="relative z-10 mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-gray-400">
          <span className={`w-2 h-2 rounded-full bg-violet-400 transition-opacity duration-700 ${dot ? "opacity-100" : "opacity-30"}`} />
          Your group is never doing bill math again
        </div>

        <h1 className="relative z-10 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-none mb-6 max-w-4xl">
          One Scan Kills the{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-br from-violet-400 via-fuchsia-300 to-violet-500 animate-pulse">
            Awkward Bill.
          </span>
        </h1>

        <p className="relative z-10 text-lg sm:text-xl text-gray-400 max-w-lg mb-10 leading-relaxed">
          Scan the receipt. Share a QR. Everyone pays exactly what they ordered — in seconds. No math, no drama, no "just Venmo me."
        </p>

        <button
          onClick={handleCTA}
          className="relative z-10 group inline-flex items-center gap-3 px-8 py-5 text-lg font-black rounded-2xl bg-violet-500 text-white hover:bg-violet-400 transition-all duration-200 hover:scale-105 hover:shadow-2xl active:scale-95"
        >
          Try BillTap Free
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200" />
        </button>
        <p className="relative z-10 mt-4 text-sm text-gray-600">No account needed. Works at any restaurant.</p>

        <div className="relative z-10 mt-16 flex items-center justify-center gap-3 flex-wrap">
          {["Pizza — $14", "Salad — $11", "Draft Beer — $16", "Appetizers — $18"].map((item, i) => (
            <div key={i} className="px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-gray-400 font-mono">
              {item}
            </div>
          ))}
          <div className="px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-500/30 text-sm text-violet-300 font-bold">
            QR Generated
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24 px-6 max-w-5xl mx-auto">
        <Reveal>
          <p className="text-center text-violet-400 text-sm font-bold uppercase tracking-widest mb-3">How It Works</p>
          <h2 className="text-center text-3xl sm:text-4xl font-black mb-3 tracking-tight">Three taps and you're out.</h2>
          <p className="text-center text-gray-500 mb-16 text-lg">Seriously, that's it.</p>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              num: "01",
              icon: <Camera className="w-6 h-6" />,
              title: "Scan the Receipt",
              desc: "Point your camera at any restaurant bill. BillTap reads every line item automatically.",
            },
            {
              num: "02",
              icon: <QrCode className="w-6 h-6" />,
              title: "Share the QR",
              desc: "One tap creates a shareable link. Your group sees the itemized bill on their phone — no app download required.",
            },
            {
              num: "03",
              icon: <CreditCard className="w-6 h-6" />,
              title: "Everyone Pays Their Share",
              desc: "Each person taps what they ordered and pays instantly. Done. Go home.",
            },
          ].map((step, i) => (
            <Reveal key={i} delay={i * 150}>
              <div className="relative p-6 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-violet-500/30 transition-all duration-300 h-full group">
                <div className="text-5xl font-black text-white/[0.04] mb-4 leading-none">{step.num}</div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400 group-hover:bg-violet-500/20 transition-colors duration-300">{step.icon}</div>
                  <h3 className="font-bold text-white text-lg">{step.title}</h3>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section className="py-24 px-6 bg-white/[0.015] border-y border-white/5">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <p className="text-center text-violet-400 text-sm font-bold uppercase tracking-widest mb-3">Features</p>
            <h2 className="text-center text-3xl sm:text-4xl font-black mb-16 tracking-tight">Built for the actual dinner table</h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: <Receipt className="w-5 h-5" />, title: "Instant Receipt Reading", desc: "Scan any receipt — BillTap pulls out every line item without you typing a thing." },
              { icon: <QrCode className="w-5 h-5" />, title: "No-Download Sharing", desc: "Your friends open a link in their browser. No app install, no account, no friction." },
              { icon: <Check className="w-5 h-5" />, title: "Pay Exactly What You Ordered", desc: "No rounding, no guessing, no 'I only had a salad' debates at the table." },
              { icon: <Users className="w-5 h-5" />, title: "Any Group Size", desc: "Two people or twelve — everyone gets their own itemized view and pays their share." },
              { icon: <Zap className="w-5 h-5" />, title: "Split the Tip", desc: "Tip splits proportionally or evenly — your call, added in one tap." },
              { icon: <Smartphone className="w-5 h-5" />, title: "Any Restaurant, Any Receipt", desc: "No restaurant integration needed. If there's a paper bill, BillTap handles it." },
            ].map((feat, i) => (
              <Reveal key={i} delay={i * 70}>
                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-violet-500/25 hover:bg-violet-500/[0.03] transition-all duration-300 h-full">
                  <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400 w-fit mb-4">{feat.icon}</div>
                  <h3 className="font-bold text-white mb-2">{feat.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{feat.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIAL */}
      <section className="py-24 px-6 max-w-2xl mx-auto text-center">
        <Reveal>
          <div className="p-10 rounded-3xl bg-white/[0.03] border border-white/10">
            <div className="flex justify-center gap-1 mb-6">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-violet-400 text-violet-400" />
              ))}
            </div>
            <blockquote className="text-2xl sm:text-3xl font-bold leading-snug text-white mb-8">
              "We went from 15 minutes of 'wait who had the pasta?' to scanning and leaving. Genuinely magic."
            </blockquote>
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 font-black text-sm">JT</div>
              <div className="text-left">
                <p className="font-semibold text-white text-sm">Jamie T.</p>
                <p className="text-gray-500 text-xs">Dinner group organizer, early access</p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* FINAL CTA */}
      <section className="py-24 px-6 text-center relative overflow-hidden">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-violet-500/10 blur-[120px] animate-pulse pointer-events-none" />
        <Reveal>
          <div className="relative z-10 max-w-2xl mx-auto">
            <p className="text-violet-400 text-sm font-bold uppercase tracking-widest mb-4">Free — Works Tonight</p>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight mb-6 leading-tight">
              The check is coming.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
                Be ready this time.
              </span>
            </h2>
            <p className="text-gray-400 text-lg mb-10">
              Scan, split, and be out the door before anyone touches a calculator.
            </p>
            <button
              onClick={handleCTA}
              className="group inline-flex items-center gap-3 px-10 py-5 text-xl font-black rounded-2xl bg-violet-500 text-white hover:bg-violet-400 transition-all duration-200 hover:scale-105 hover:shadow-2xl active:scale-95"
            >
              Try BillTap Free
              <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform duration-200" />
            </button>
            <p className="mt-4 text-sm text-gray-600">No credit card. No setup. Works at dinner tonight.</p>
          </div>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-black tracking-tight">
            <span className="text-violet-400">Bill</span><span className="text-white">Tap</span>
          </span>
          <div className="flex items-center gap-6 text-sm text-gray-600">
            <a href="/privacy" className="hover:text-gray-400 transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-gray-400 transition-colors">Terms</a>
          </div>
          <p className="text-xs text-gray-700">© 2026 BillTap</p>
        </div>
      </footer>

    </div>
  );
}