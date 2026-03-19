const FinalCTA = () => {
  return (
    <section
      className="relative py-24 lg:py-32 px-5 text-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E")`
      }} />

      <div className="relative z-10 max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white mb-6 leading-tight">
          Never argue about bills again
        </h2>
        <p className="text-xl sm:text-2xl text-white/90 mb-12">
          Join 12,000+ people splitting bills the smart way
        </p>
        <button
          className="bg-white text-[#667eea] px-14 py-6 rounded-2xl text-xl sm:text-2xl font-bold border-0 cursor-pointer transition-all duration-300 shadow-2xl hover:-translate-y-1 active:translate-y-0 active:shadow-lg w-full max-w-xs sm:w-auto focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#764ba2]"
          onClick={() => window.location.href = '/NewReceipt'}
          aria-label="Start Splitting for Free — create your first bill split"
        >
          Start Splitting for Free
        </button>
        <p className="mt-6 text-white/80 text-base">
          ✓ No credit card required &nbsp;•&nbsp; ✓ Works on any device &nbsp;•&nbsp; ✓ Free forever
        </p>
      </div>
    </section>
  );
};

export default FinalCTA;