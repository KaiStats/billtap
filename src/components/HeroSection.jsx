import React, { useEffect, useState } from 'react';

const StoreBadges = ({ small }) => (
  <div className={`flex flex-wrap justify-center gap-3 ${small ? '' : 'mt-2'}`}>
    <a href="https://apps.apple.com" target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store"
      className={`flex items-center gap-2 bg-black text-white rounded-2xl font-semibold min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-transform hover:-translate-y-0.5 ${small ? 'px-4 py-2 text-xs' : 'px-5 py-3 text-sm'}`}>
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/></svg>
      <span><span className="block opacity-70 leading-none" style={{fontSize:'10px'}}>Download on the</span><span className="block font-bold leading-tight">App Store</span></span>
    </a>
    <a href="https://play.google.com" target="_blank" rel="noopener noreferrer" aria-label="Get it on Google Play"
      className={`flex items-center gap-2 bg-black text-white rounded-2xl font-semibold min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-transform hover:-translate-y-0.5 ${small ? 'px-4 py-2 text-xs' : 'px-5 py-3 text-sm'}`}>
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0" aria-hidden="true"><path d="M3.18 23.76c.3.17.64.24.99.2l12.52-7.23-2.69-2.69-10.82 9.72zm16.67-10.15L16.9 11.8l-2.98 2.98 2.98 2.97 2.97-1.72c.85-.5.85-1.71-.02-2.22zM2.01 1.05C1.67 1.4 1.5 1.9 1.5 2.54v18.92c0 .64.17 1.14.52 1.49l.08.08 10.6-10.6v-.25L2.09.97l-.08.08zm11.29 10.97L2.19.9l.8-.46 12.52 7.22-2.21 4.46z"/></svg>
      <span><span className="block opacity-70 leading-none" style={{fontSize:'10px'}}>Get it on</span><span className="block font-bold leading-tight">Google Play</span></span>
    </a>
  </div>
);

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
          Split Bills in<br />
          <span style={{ background: 'linear-gradient(90deg, #f5576c, #f093fb, #667eea)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
            30 Seconds
          </span>
        </h1>

        <p className="text-xl sm:text-2xl text-white/75 mb-10 font-normal max-w-xl mx-auto">
          Snap a receipt. Share a QR. Everyone pays their exact share. Done.
        </p>

        {/* CTA */}
        <div className="flex flex-col items-center gap-5 mb-16">
          {isMobile ? (
            <>
              <button
                className="text-white font-black text-xl px-12 py-5 rounded-2xl w-full max-w-xs border-0 cursor-pointer transition-all duration-200 shadow-2xl hover:-translate-y-1 active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white"
                style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
                onClick={() => window.location.href = '/NewReceipt'}
                aria-label="Open BillTap now"
              >
                Open BillTap Now →
              </button>
              <StoreBadges small />
            </>
          ) : (
            <>
              <p className="text-white/80 text-base font-medium">Download on your phone 👇</p>
              <StoreBadges />
            </>
          )}
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
            { number: '30s', label: 'Avg Split Time' },
            { number: '100%', label: 'Settlement Rate' },
            { number: '12K+', label: 'Bills Split' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="sr-only">{stat.label}</dt>
              <dd className="text-4xl sm:text-5xl font-black text-white mb-1">{stat.number}</dd>
              <span className="text-sm text-white/50 font-medium uppercase tracking-widest">{stat.label}</span>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};

export default HeroSection;