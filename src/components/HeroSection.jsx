import React from 'react';

const HeroSection = () => {
  return (
    <section className="hero">
      <style>{`
        .hero {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          position: relative;
          overflow: hidden;
        }

        .hero::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E");
          opacity: 0.4;
        }

        .hero-content {
          max-width: 1200px;
          width: 100%;
          position: relative;
          z-index: 1;
          text-align: center;
        }

        .logo {
          font-size: 48px;
          font-weight: 900;
          color: white;
          margin-bottom: 16px;
          letter-spacing: -1px;
        }

        .tagline {
          font-size: 28px;
          font-weight: 700;
          color: white;
          margin-bottom: 12px;
          line-height: 1.3;
        }

        .subtagline {
          font-size: 20px;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 40px;
          font-weight: 400;
        }

        .cta-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          align-items: center;
          margin-bottom: 60px;
        }

        .cta-primary {
          background: white;
          color: #667eea;
          padding: 20px 48px;
          border-radius: 16px;
          font-size: 20px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
          min-width: 280px;
        }

        .cta-primary:hover {
          transform: translateY(-4px);
          box-shadow: 0 15px 50px rgba(0, 0, 0, 0.3);
        }

        .cta-secondary {
          color: white;
          font-size: 16px;
          text-decoration: underline;
          cursor: pointer;
          background: none;
          border: none;
          padding: 8px;
        }

        .demo-video {
          width: 100%;
          max-width: 800px;
          height: auto;
          border-radius: 24px;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          padding: 8px;
          margin: 0 auto;
        }

        .stats {
          display: flex;
          gap: 48px;
          justify-content: center;
          margin-top: 60px;
          flex-wrap: wrap;
        }

        .stat {
          text-align: center;
        }

        .stat-number {
          font-size: 48px;
          font-weight: 900;
          color: white;
          margin-bottom: 8px;
        }

        .stat-label {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.8);
        }

        @media (max-width: 768px) {
          .logo {
            font-size: 36px;
          }

          .tagline {
            font-size: 24px;
          }

          .subtagline {
            font-size: 18px;
          }

          .cta-primary {
            width: 100%;
            max-width: 320px;
          }

          .stats {
            gap: 32px;
          }

          .stat-number {
            font-size: 36px;
          }
        }
      `}</style>

      <div className="hero-content">
        <h1 className="logo">⚡ BillTap</h1>

        <h2 className="tagline">
          Split bills in 30 seconds.<br />
          Every. Single. Time.
        </h2>

        <p className="subtagline">
          No math. No IOUs. No awkward money talk.
        </p>

        <div className="cta-container">
          <button className="cta-primary" onClick={() => window.location.href = '/NewReceipt'}>
            Try BillTap Free
          </button>
          <button className="cta-secondary" onClick={() => document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>
            See how it works ↓
          </button>
        </div>

        <div className="demo-video">
          <div style={{ 
            aspectRatio: '16/9', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '16px',
            color: 'white',
            fontSize: '18px'
          }}>
            📱 30-second demo video goes here
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="stat-number">30s</div>
            <div className="stat-label">Average Split Time</div>
          </div>
          <div className="stat">
            <div className="stat-number">100%</div>
            <div className="stat-label">Settlement Rate</div>
          </div>
          <div className="stat">
            <div className="stat-number">12K+</div>
            <div className="stat-label">Bills Split</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;