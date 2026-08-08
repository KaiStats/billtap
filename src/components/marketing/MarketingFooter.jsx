import { Link } from "react-router-dom";
import Logo from "./Logo";
import { mkt } from "./tokens";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "How It Works", href: "/#how-it-works" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Security", to: "/security" },
      { label: "Blog", to: "/blog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "billtap.app", href: "https://billtap.app" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", to: "/terms" },
      { label: "Privacy", to: "/privacy" },
      { label: "Security", to: "/security" },
    ],
  },
];

function FooterLink({ label, href, to }) {
  const className = "text-sm transition-colors hover:text-emerald-400";
  if (to) {
    return <Link to={to} className={className} style={{ color: mkt.muted }}>{label}</Link>;
  }
  return <a href={href} className={className} style={{ color: mkt.muted }}>{label}</a>;
}

/**
 * One footer, reused everywhere. Previously only Landing had one — About,
 * Blog, Security, Terms and Privacy each dead-ended with nothing below the
 * content, so the legal pages in particular had no link back to Terms,
 * Privacy or Security from one another.
 */
export default function MarketingFooter() {
  return (
    <footer className="py-12 md:py-16 border-t" style={{ borderColor: mkt.border, background: mkt.bg }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8 mb-10">
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4 w-fit">
              <Logo size={32} />
              <span className="font-heading font-bold text-xl" style={{ color: mkt.accent }}>BillTap</span>
            </Link>
            <p className="text-sm max-w-xs leading-relaxed" style={{ color: mkt.muted }}>
              The fastest way to split a bill. No math. No drama. No chasing anyone.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="font-heading font-bold text-xs mb-4 uppercase tracking-wider" style={{ color: mkt.text }}>
                {col.heading}
              </h4>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}><FooterLink {...l} /></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t" style={{ borderColor: mkt.border }}>
          <p className="text-sm text-center md:text-left" style={{ color: mkt.dim }}>
            © 2026 BillTap. Built in public by Kai Cogmon.
          </p>
        </div>
      </div>
    </footer>
  );
}
