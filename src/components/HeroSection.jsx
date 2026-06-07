import React, { useEffect, useState } from 'react';



const HeroSection = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''));
  }, []);

  return (
    <section
      aria-label="Hero — BillTap bill splitting app"
      className="relative min-h-screen flex flex-col items-center justify-center px-5 py-20 overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' }}
    >
      {/* Animated blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{ position:'absolute', top:'-10%', left:'-15%', width:'60vw', height:'60vw', maxWidth:700, maxHeight:700, borderRadius:'50%', background:'radial-gradient(circle, rgba(102,126,234,0.35) 0%, transparent 70%)', filter:'blur(60px)', animation:'pulse 8s ease-in-out infinite' }} />
        <div style={{ position:'absolute', bottom:'-10%', right:'-15%', width:'55vw', height:'55vw', maxWidth:650, maxHeight:650, borderRadius:'50%', background:'radial-gradient(circle, rgba(245,87,108,0.28) 0%, transparent 70%)', filter:'blur(60px)', animation:'pulse 10s ease-in-out infinite 2s' }} />
        <div style={{ position:'absolute', top:'40%', left:'50%', transform:'translateX(-50%)', width:'40vw', height:'40vw', maxWidth:500, maxHeight:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(79,209,197,0.2) 0%, transparent 70%)', filter:'blur(50px)', animation:'pulse 12s ease-in-out infinite 4s' }} />
      </div>

      <style>{`@keyframes pulse { 0%,100%{transform:scale(1) translateY(0)} 50%{transform:scale(1.08) translateY(-20px)} }`}</style>

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center">

        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-sm font-semibold rounded-full px-4 py-2 mb-8">
          <span>⚡</span> The fastest way to split a bill
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white mb-5 tracking-tight leading-none">
          Split Bills,<br />
          <span style={{ background: 'linear-gradient(90deg, #f5576c, #f093fb, #667eea)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
            Instantly
          </span>
        </h1>

        <p className="text-xl sm:text-2xl text-white/75 mb-10 font-normal max-w-xl mx-auto">
          Snap a receipt. Share a QR. Everyone pays their exact share. Done.
        </p>

        {/* CTA */}
        <div className="flex flex-col items-center gap-5 mb-16">
          <button
            className="text-white font-black text-xl px-12 py-5 rounded-2xl w-full max-w-xs border-0 cursor-pointer transition-all duration-200 shadow-2xl hover:-translate-y-1 active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white"
            style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
            onClick={() => window.location.href = '/NewReceipt'}
            aria-label="Open BillTap now"
          >
            Open BillTap Now →
          </button>
          <button
            className="text-white/60 text-sm hover:text-white/90 transition-colors bg-transparent border-0 cursor-pointer mt-1 min-h-[48px] px-4"
            onClick={() => document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="See how BillTap works"
          >
            See how it works ↓
          </button>
        </div>

        {/* Mock app UI */}
        <div className="w-full max-w-md mx-auto rounded-3xl overflow-hidden mb-14 shadow-2xl"
          style={{ background:'rgba(255,255,255,0.07)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,0.15)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <div className="w-3 h-3 rounded-full bg-red-400/70" />
            <div className="w-3 h-3 rounded-full bg-yellow-400/70" />
            <div className="w-3 h-3 rounded-full bg-green-400/70" />
            <span className="text-white/40 text-xs ml-2 font-mono">BillTap · Live Session</span>
          </div>
          <div className="p-5 text-left space-y-3">
            {[['🍕 Margherita Pizza', '$18.00'], ['🍺 Craft Beer x2', '$16.00'], ['🥗 Caesar Salad', '$12.00'], ['🍰 Tiramisu', '$9.00']].map(([name, price]) => (
              <div key={name} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                <span className="text-white/90 text-sm font-medium">{name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-white/50 text-sm">{price}</span>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{background:'linear-gradient(135deg,#667eea,#764ba2)'}}>✓</span>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-white/10">
              <span className="text-white/50 text-sm">Your share</span>
              <span className="text-white font-black text-lg" style={{color:'#4fffb0'}}>$27.50</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <dl className="flex flex-wrap justify-center gap-10 sm:gap-16">
          {[
            { number: '🤖', label: 'AI Receipt Scanning' },
            { number: '🔴', label: 'Live Multiplayer Sync' },
            { number: '📱', label: 'No App Download Needed' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="sr-only">{stat.label}</dt>
              <dd className="text-4xl sm:text-5xl font-black text-white mb-1 leading-none">{stat.number}</dd>
              <span className="text-sm text-white/50 font-medium uppercase tracking-widest">{stat.label}</span>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};

export default HeroSection;