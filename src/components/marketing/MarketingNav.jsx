import { Link } from "react-router-dom";
import Logo from "./Logo";
import { mkt } from "./tokens";

const LINKS = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Security", href: "/security" },
];

/**
 * One nav, reused on every public page, so a visitor who lands on /security or
 * /about from a search result gets the same way back in as everyone else —
 * previously only the Landing page had real navigation; About/Blog had a bare
 * "back to home" link and Security/Terms/Privacy had no nav at all.
 *
 * `fixed`/`scrolled` are owned by Landing.jsx, which is the one page with a
 * full-bleed hero behind the nav and needs it to overlay on scroll=0 and turn
 * solid past it. Every other page renders this as a normal static header.
 */
export default function MarketingNav({ fixed = false, scrolled = false }) {
  const positionClass = fixed ? "fixed top-0 left-0 right-0 z-50" : "relative";
  const chrome = fixed
    ? {
        background: scrolled ? "rgba(10,14,26,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
        borderBottom: scrolled ? `1px solid ${mkt.border}` : "1px solid transparent",
        transition: "background 0.3s ease, border-color 0.3s ease",
      }
    : { background: mkt.bg, borderBottom: `1px solid ${mkt.border}` };

  return (
    <nav className={positionClass} style={chrome}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-20">
          <Link to="/" className="flex items-center gap-2">
            <Logo size={32} />
            <span className="font-heading font-bold text-lg" style={{ color: mkt.accent }}>BillTap</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="text-sm font-medium transition-colors hover:text-emerald-400"
                style={{ color: mkt.muted }}
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm font-medium transition-colors hover:text-emerald-400 hidden sm:block"
              style={{ color: mkt.muted }}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="px-4 py-2 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ background: mkt.accent, color: mkt.accentInk }}
            >
              Start Free
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
