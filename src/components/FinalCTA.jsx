const FinalCTA = () => {
  return (
    <section className="final-cta">
      <style>{`
        .final-cta {
          padding: 120px 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .final-cta::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E");
          opacity: 0.3;
        }

        .cta-content {
          position: relative;
          z-index: 1;
          max-width: 800px;
          margin: 0 auto;
        }

        .cta-title {
          font-size: 56px;
          font-weight: 900;
          color: white;
          margin-bottom: 24px;
          line-height: 1.2;
        }

        .cta-subtitle {
          font-size: 24px;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 48px;
        }

        .cta-button {
          background: white;
          color: #667eea;
          padding: 24px 64px;
          border-radius: 16px;
          font-size: 22px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        }

        .cta-button:hover {
          transform: translateY(-4px);
          box-shadow: 0 15px 50px rgba(0, 0, 0, 0.3);
        }

        .cta-note {
          margin-top: 24px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 16px;
        }

        @media (max-width: 768px) {
          .cta-title {
            font-size: 36px;
          }

          .cta-subtitle {
            font-size: 20px;
          }

          .cta-button {
            width: 100%;
            max-width: 320px;
          }
        }
      `}</style>

      <div className="cta-content">
        <h2 className="cta-title">
          Never argue about bills again
        </h2>
        <p className="cta-subtitle">
          Join 12,000+ people splitting bills the smart way
        </p>
        <button className="cta-button" onClick={() => window.location.href = '/NewReceipt'}>
          Start Splitting for Free
        </button>
        <p className="cta-note">
          ✓ No credit card required  •  ✓ Works on any device  •  ✓ Free forever
        </p>
      </div>
    </section>
  );
};

export default FinalCTA;