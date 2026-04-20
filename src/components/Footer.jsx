const Footer = () => {
  return (
    <footer className="px-5 pt-16 pb-10" style={{ background: '#07070d', borderTop: '1px solid rgba(255,255,255,0.06)' }} aria-label="Site footer">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1 flex flex-col gap-3">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-2xl font-black text-left bg-transparent border-0 cursor-pointer hover:opacity-80 transition-opacity p-0"
              style={{ background: 'linear-gradient(90deg, #667eea, #f5576c)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}
              aria-label="BillTap — back to top"
            >
              ⚡ BillTap
            </button>
            <p className="text-white/35 text-sm leading-relaxed">Split bills in 30 seconds. Every time.</p>
            <a href="mailto:hello@billtap.app" className="text-white/35 hover:text-white/70 text-sm transition-colors no-underline">hello@billtap.app</a>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">Product</h4>
            <div className="flex flex-col gap-3">
              <a href="#how-it-works" onClick={(e) => { e.preventDefault(); document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-white/45 hover:text-white text-sm transition-colors no-underline">How It Works</a>
              <a href="#features" onClick={(e) => { e.preventDefault(); document.querySelector('#features')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-white/45 hover:text-white text-sm transition-colors no-underline">Features</a>
              <a href="/NewReceipt" className="text-white/45 hover:text-white text-sm transition-colors no-underline">Try for Free</a>
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">Company</h4>
            <div className="flex flex-col gap-3">
              <a href="mailto:hello@billtap.app" className="text-white/45 hover:text-white text-sm transition-colors no-underline">Contact</a>
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">Legal</h4>
            <div className="flex flex-col gap-3">
              <a href="/privacy" className="text-white/45 hover:text-white text-sm transition-colors no-underline">Privacy Policy</a>
              <a href="/terms" className="text-white/45 hover:text-white text-sm transition-colors no-underline">Terms of Service</a>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-center" style={{ borderColor:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.2)' }}>
          <div>© 2026 BillTap. All rights reserved.</div>
          <nav aria-label="Social media links" className="flex gap-4">
            {[
              { href:'https://twitter.com/billtap', label:'X (Twitter)', emoji:'𝕏' },
              { href:'https://instagram.com/billtap', label:'Instagram', emoji:'📷' },
              { href:'https://tiktok.com/@billtap', label:'TikTok', emoji:'🎵' },
            ].map(s => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                className="text-white/30 hover:text-white transition-colors no-underline text-xl min-w-[44px] min-h-[44px] flex items-center justify-center rounded"
                aria-label={`BillTap on ${s.label}`}>{s.emoji}</a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
};

export default Footer;