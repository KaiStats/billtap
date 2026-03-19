import React from 'react';

const HeroSection = () => {
  return (
    <section
      className="relative min-h-screen flex flex-col items-center justify-center px-5 py-16 overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      {/* subtle pattern overlay */}
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E")`
      }} />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-4 tracking-tight">
          ⚡ BillTap
        </h1>

        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-3 leading-snug">
          Split bills in 30 seconds.<br />
          Every. Single. Time.
        </h2>

        <p className="text-lg sm:text-xl text-white/90 mb-10 font-normal">
          No math. No IOUs. No awkward money talk.
        </p>

        <div className="flex flex-col items-center gap-4 mb-14">
          <button
            className="bg-white text-[#667eea] px-12 py-5 rounded-2xl text-xl font-bold border-0 cursor-pointer transition-all duration-300 shadow-2xl hover:-translate-y-1 active:translate-y-0 active:shadow-lg w-full max-w-xs sm:w-auto"
            onClick={() => window.location.href = '/NewReceipt'}
          >
            Try BillTap Free
          </button>
          <button
            className="text-white text-base underline cursor-pointer bg-transparent border-0 px-2 py-2 opacity-90 hover:opacity-100"
            onClick={() => document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
          >
            See how it works ↓
          </button>
        </div>

        {/* Demo placeholder */}
        <div className="w-full max-w-3xl mx-auto rounded-3xl p-2 mb-14"
          style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
          <div
            className="rounded-2xl flex items-center justify-center text-white text-lg"
            style={{ aspectRatio: '16/9', background: 'rgba(0,0,0,0.2)' }}
          >
            📱 30-second demo video goes here
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap justify-center gap-8 sm:gap-12 lg:gap-16">
          {[
            { number: '30s', label: 'Average Split Time' },
            { number: '100%', label: 'Settlement Rate' },
            { number: '12K+', label: 'Bills Split' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-4xl sm:text-5xl font-black text-white mb-2">{stat.number}</div>
              <div className="text-base text-white/80">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HeroSection;