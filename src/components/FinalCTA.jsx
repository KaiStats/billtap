const FinalCTA = () => {
  return (
    <section
      className="relative py-28 lg:py-36 px-5 text-center overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' }}
    >
      {/* Glow orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div style={{ position:'absolute', top:'10%', left:'10%', width:'40vw', height:'40vw', maxWidth:500, maxHeight:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(245,87,108,0.25) 0%, transparent 70%)', filter:'blur(80px)' }} />
        <div style={{ position:'absolute', bottom:'5%', right:'5%', width:'40vw', height:'40vw', maxWidth:500, maxHeight:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(102,126,234,0.3) 0%, transparent 70%)', filter:'blur(80px)' }} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto">
        <div className="text-6xl mb-6">⚡</div>
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-5 leading-tight">
          Never argue about<br />
          <span style={{ background: 'linear-gradient(90deg, #f5576c, #f093fb, #667eea)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
            bills again
          </span>
        </h2>
        <p className="text-xl text-white/70 mb-10">
          Join 12,000+ people splitting bills the smart way
        </p>
        <button
          className="text-white font-black text-xl px-14 py-6 rounded-2xl border-0 cursor-pointer transition-all duration-200 shadow-2xl hover:-translate-y-1 active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white w-full max-w-xs sm:w-auto"
          style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
          onClick={() => window.location.href = '/NewReceipt'}
          aria-label="Start splitting for free"
        >
          Start Splitting for Free →
        </button>
        <p className="mt-6 text-white/40 text-sm">
          ✓ No credit card &nbsp;•&nbsp; ✓ Any device &nbsp;•&nbsp; ✓ Free forever
        </p>
      </div>
    </section>
  );
};

export default FinalCTA;