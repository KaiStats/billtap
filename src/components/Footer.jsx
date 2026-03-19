const Footer = () => {
  return (
    <footer className="bg-slate-950 text-white px-5 pt-16 pb-10" aria-label="Site footer">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1 flex flex-col gap-3">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-3xl font-black text-left bg-transparent border-0 cursor-pointer text-white hover:opacity-80 transition-opacity p-0"
              aria-label="BillTap - back to top"
            >
              ⚡ BillTap
            </button>
            <p className="text-slate-400 text-base leading-relaxed">Split bills in 30 seconds. Every time.</p>
            <a href="mailto:hello@billtap.app" className="text-slate-400 hover:text-white text-sm transition-colors no-underline">hello@billtap.app</a>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Product</h4>
            <div className="flex flex-col gap-3">
              <a href="#how-it-works" onClick={(e) => { e.preventDefault(); document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-slate-400 hover:text-white text-sm transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">How It Works</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); document.querySelector('#features')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-slate-400 hover:text-white text-sm transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Features</a>
              <a href="/NewReceipt" className="text-slate-400 hover:text-white text-sm transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Try for Free</a>
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Company</h4>
            <div className="flex flex-col gap-3">
              <a href="mailto:hello@billtap.app" className="text-slate-400 hover:text-white text-sm transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Contact</a>
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Legal</h4>
            <div className="flex flex-col gap-3">
              <a href="/privacy" className="text-slate-400 hover:text-white text-sm transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Privacy Policy</a>
              <a href="/terms" className="text-slate-400 hover:text-white text-sm transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Terms of Service</a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-slate-500 text-sm text-center">
          <div>© 2026 BillTap. All rights reserved.</div>
          <div className="flex gap-5 text-2xl">
            <a href="https://twitter.com/billtap" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors no-underline" aria-label="Twitter">𝕏</a>
            <a href="https://instagram.com/billtap" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors no-underline" aria-label="Instagram">📷</a>
            <a href="https://tiktok.com/@billtap" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors no-underline" aria-label="TikTok">🎵</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;