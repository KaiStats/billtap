const Footer = () => {
  return (
    <footer className="footer">
      <style>{`
        .footer {
          background: #0f172a;
          color: white;
          padding: 60px 20px 40px;
        }

        .footer-content {
          max-width: 1200px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 60px;
          margin-bottom: 40px;
        }

        .footer-brand {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .footer-logo {
          font-size: 32px;
          font-weight: 900;
        }

        .footer-tagline {
          color: #94a3b8;
          font-size: 16px;
        }

        .footer-column h4 {
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 16px;
          color: #cbd5e1;
        }

        .footer-links {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .footer-link {
          color: #94a3b8;
          text-decoration: none;
          font-size: 15px;
          transition: color 0.2s;
        }

        .footer-link:hover {
          color: white;
        }

        .footer-bottom {
          max-width: 1200px;
          margin: 0 auto;
          padding-top: 40px;
          border-top: 1px solid #334155;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #64748b;
          font-size: 14px;
        }

        .social-links {
          display: flex;
          gap: 20px;
        }

        .social-link {
          color: #94a3b8;
          font-size: 24px;
          transition: color 0.2s;
        }

        .social-link:hover {
          color: white;
        }

        @media (max-width: 968px) {
          .footer-content {
            grid-template-columns: 1fr;
            gap: 40px;
          }

          .footer-bottom {
            flex-direction: column;
            gap: 20px;
            text-align: center;
          }
        }
      `}</style>

      <div className="footer-content">
        <div className="footer-brand">
          <div className="footer-logo">⚡ BillTap</div>
          <p className="footer-tagline">
            Split bills in 30 seconds. Every time.
          </p>
        </div>

        <div className="footer-column">
          <h4>Product</h4>
          <div className="footer-links">
            <a href="/features" className="footer-link">Features</a>
            <a href="/pricing" className="footer-link">Pricing</a>
            <a href="/how-it-works" className="footer-link">How It Works</a>
            <a href="/download" className="footer-link">Download</a>
          </div>
        </div>

        <div className="footer-column">
          <h4>Company</h4>
          <div className="footer-links">
            <a href="/about" className="footer-link">About</a>
            <a href="/blog" className="footer-link">Blog</a>
            <a href="/careers" className="footer-link">Careers</a>
            <a href="/contact" className="footer-link">Contact</a>
          </div>
        </div>

        <div className="footer-column">
          <h4>Legal</h4>
          <div className="footer-links">
            <a href="/privacy" className="footer-link">Privacy</a>
            <a href="/terms" className="footer-link">Terms</a>
            <a href="/security" className="footer-link">Security</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div>© 2026 BillTap. All rights reserved.</div>
        <div className="social-links">
          <a href="https://twitter.com/billtap" className="social-link" aria-label="Twitter">𝕏</a>
          <a href="https://instagram.com/billtap" className="social-link" aria-label="Instagram">📷</a>
          <a href="https://tiktok.com/@billtap" className="social-link" aria-label="TikTok">🎵</a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;