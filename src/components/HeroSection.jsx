import React, { useEffect, useState } from 'react';

const HeroSection = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(ua));
  }, []);

  return (
    <section
      aria-label="Hero — BillTap bill splitting app"
      className="relative min-h-screen flex flex-col items-center justify-center px-5 py-16 overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      {/* subtle pattern overlay */}
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E")`
      }} />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-4 tracking-tight">
          <span aria-hidden="true">⚡</span> BillTap
        </h1>

        <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-3 leading-snug">
          Split bills in 30 seconds.<br />
          Every. Single. Time.
        </p>

        <p className="text-lg sm:text-xl text-white/90 mb-10 font-normal">
          No math. No IOUs. No awkward money talk.
        </p>

        <div className="flex flex-col items-center gap-4 mb-14">
          {isMobile ? (
            /* Mobile: "Open App" CTA + store badges below */
            <>
              <button
                className="bg-white text-[#667eea] px-12 py-5 rounded-2xl text-xl font-bold border-0 cursor-pointer transition-all duration-300 shadow-2xl hover:-translate-y-1 active:translate-y-0 active:shadow-lg w-full max-w-xs focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#667eea]"
                onClick={() => window.location.href = '/NewReceipt'}
                aria-label="Open BillTap now"
              >
                Open BillTap Now →
              </button>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                <a href="https://apps.apple.com" target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store" className="flex items-center gap-2 bg-black/70 text-white px-4 py-2 rounded-xl text-xs font-semibold min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/></svg>
                  <span><span className="block opacity-75 leading-none">Download on the</span><span className="block font-bold leading-tight text-sm">App Store</span></span>
                </a>
                <a href="https://play.google.com" target="_blank" rel="noopener noreferrer" aria-label="Get it on Google Play" className="flex items-center gap-2 bg-black/70 text-white px-4 py-2 rounded-xl text-xs font-semibold min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0" aria-hidden="true"><path d="M3.18 23.76c.3.17.64.24.99.2l12.52-7.23-2.69-2.69-10.82 9.72zm16.67-10.15L16.9 11.8l-2.98 2.98 2.98 2.97 2.97-1.72c.85-.5.85-1.71-.02-2.22zM2.01 1.05C1.67 1.4 1.5 1.9 1.5 2.54v18.92c0 .64.17 1.14.52 1.49l.08.08 10.6-10.6v-.25L2.09.97l-.08.08zm11.29 10.97L2.19.9l.8-.46 12.52 7.22-2.21 4.46z"/></svg>
                  <span><span className="block opacity-75 leading-none">Get it on</span><span className="block font-bold leading-tight text-sm">Google Play</span></span>
                </a>
              </div>
            </>
          ) : (
            /* Desktop: App Store + Google Play badges */
            <>
              <p className="text-white/90 text-lg font-semibold mb-1">
                Download BillTap for iPhone &amp; Android
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <a
                  href="https://apps.apple.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Download on the App Store (opens in new tab)"
                  className="flex items-center gap-3 bg-black text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-gray-900 transition-colors shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white min-h-[44px]"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white shrink-0" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/></svg>
                  <span><span className="block text-xs opacity-75 leading-none">Download on the</span><span className="block text-base font-bold leading-tight">App Store</span></span>
                </a>
                <a
                  href="https://play.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Get it on Google Play (opens in new tab)"
                  className="flex items-center gap-3 bg-black text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-gray-900 transition-colors shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white min-h-[44px]"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white shrink-0" aria-hidden="true"><path d="M3.18 23.76c.3.17.64.24.99.2l12.52-7.23-2.69-2.69-10.82 9.72zm16.67-10.15L16.9 11.8l-2.98 2.98 2.98 2.97 2.97-1.72c.85-.5.85-1.71-.02-2.22zM2.01 1.05C1.67 1.4 1.5 1.9 1.5 2.54v18.92c0 .64.17 1.14.52 1.49l.08.08 10.6-10.6v-.25L2.09.97l-.08.08zm11.29 10.97L2.19.9l.8-.46 12.52 7.22-2.21 4.46z"/></svg>
                  <span><span className="block text-xs opacity-75 leading-none">Get it on</span><span className="block text-base font-bold leading-tight">Google Play</span></span>
                </a>
              </div>
            </>
          )}
          <button
            className="text-white text-base underline cursor-pointer bg-transparent border-0 px-4 py-3 min-h-[44px] opacity-90 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-lg"
            onClick={() => document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="See how BillTap works — scroll to steps section"
          >
            See how it works ↓
          </button>
        </div>

        {/* Demo placeholder */}
        <div className="w-full max-w-3xl mx-auto rounded-3xl p-2 mb-14"
          style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
          <div
            role="img"
            aria-label="BillTap app demo: showing a receipt being scanned and split between friends"
            className="rounded-2xl flex flex-col items-center justify-center text-white gap-3"
            style={{ aspectRatio: '16/9', background: 'rgba(0,0,0,0.2)' }}
          >
            <span className="text-5xl">📱</span>
            <span className="text-lg font-medium opacity-80">App demo coming soon</span>
          </div>
        </div>

        {/* Stats */}
        <dl className="flex flex-wrap justify-center gap-8 sm:gap-12 lg:gap-16">
          {[
            { number: '30s', label: 'Average Split Time' },
            { number: '100%', label: 'Settlement Rate' },
            { number: '12K+', label: 'Bills Split' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="sr-only">{stat.label}</dt>
              <dd className="text-4xl sm:text-5xl font-black text-white mb-2" aria-label={`${stat.number} — ${stat.label}`}>
                {stat.number}
              </dd>
              <span className="text-base text-white/80" aria-hidden="true">{stat.label}</span>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};

export default HeroSection;