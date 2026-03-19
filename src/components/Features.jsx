const Features = () => {
  const features = [
    {
      icon: "⚡",
      title: "Lightning Fast",
      description: "30 seconds from photo to payment. Faster than pulling out Venmo."
    },
    {
      icon: "🎯",
      title: "Perfectly Fair",
      description: "Proportional tax and tip. Pay exactly what you ordered. No rounding errors."
    },
    {
      icon: "🔒",
      title: "100% Secure",
      description: "Powered by Stripe. Your card info is encrypted and never stored."
    },
    {
      icon: "👥",
      title: "Works for Groups",
      description: "2-50 people. No app download needed for guests. Just scan and pay."
    },
    {
      icon: "🚫",
      title: "No IOUs",
      description: "Everyone pays at the table. 100% settlement rate. No chasing people later."
    },
    {
      icon: "🧠",
      title: "AI-Powered",
      description: "Reads any receipt in 3 seconds. Even handwritten ones."
    }
  ];

  return (
    <section className="features">
      <style>{`
        .features {
          padding: 100px 20px;
          background: #f8fafc;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 40px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .feature-card {
          background: white;
          padding: 40px;
          border-radius: 20px;
          text-align: center;
          transition: all 0.3s;
          border: 2px solid transparent;
        }

        .feature-card:hover {
          transform: translateY(-8px);
          border-color: #667eea;
          box-shadow: 0 20px 60px rgba(102, 126, 234, 0.15);
        }

        .feature-icon {
          font-size: 56px;
          margin-bottom: 20px;
        }

        .feature-title {
          font-size: 24px;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 12px;
        }

        .feature-description {
          font-size: 16px;
          color: #64748b;
          line-height: 1.6;
        }
      `}</style>

      <div className="section-container">
        <div className="section-header">
          <h2 className="section-title">Why BillTap?</h2>
          <p className="section-subtitle">Built for the way people actually split bills</p>
        </div>

        <div className="features-grid">
          {features.map((feature, index) => (
            <div key={index} className="feature-card">
              <div className="feature-icon">{feature.icon}</div>
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;