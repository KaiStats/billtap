const Footer = () => {
  return (
    <footer className="bg-slate-950 text-white px-5 pt-16 pb-10">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1 flex flex-col gap-3">
            <div className="text-3xl font-black">⚡ BillTap</div>
            <p className="text-slate-400 text-base leading-relaxed">Split bills in 30 seconds. Every time.</p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Product</h4>
            <div className="flex flex-col gap-3">
              {['Features', 'Pricing', 'How It Works', 'Download'].map((item) => (
                <a key={item} href="#" className="text-slate-400 hover:text-white text-sm transition-colors no-underline">{item}</a>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Company</h4>
            <div className="flex flex-col gap-3">
              {['About', 'Blog', 'Careers', 'Contact'].map((item) => (
                <a key={item} href="#" className="text-slate-400 hover:text-white text-sm transition-colors no-underline">{item}</a>
              ))}
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Legal</h4>
            <div className="flex flex-col gap-3">
              {['Privacy', 'Terms', 'Security'].map((item) => (
                <a key={item} href="#" className="text-slate-400 hover:text-white text-sm transition-colors no-underline">{item}</a>
              ))}
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