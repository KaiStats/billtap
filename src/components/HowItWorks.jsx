const HowItWorks = () => {
  const steps = [
    {
      number: "1",
      icon: "📸",
      title: "Snap the receipt",
      description: "Take a photo of your bill. AI reads every item in 3 seconds.",
    },
    {
      number: "2",
      icon: "👆",
      title: "Everyone taps their items",
      description: "Share a QR code. Each person claims what they ordered in real-time.",
    },
    {
      number: "3",
      icon: "💳",
      title: "Pay your exact share",
      description: "Tax and tip split proportionally. Pay with Apple Pay or card. Done.",
    }
  ];

  return (
    <section id="how-it-works" className="how-it-works">
      <style>{`
        .how-it-works {
          padding: 100px 20px;
          background: white;
        }

        .section-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .section-header {
          text-align: center;
          margin-bottom: 80px;
        }

        .section-title {
          font-size: 48px;
          font-weight: 900;
          color: #1e293b;
          margin-bottom: 16px;
        }

        .section-subtitle {
          font-size: 20px;
          color: #64748b;
        }

        .steps {
          display: grid;
          grid-template-columns: 1fr;
          gap: 80px;
        }

        .step {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 60px;
          align-items: center;
        }

        .step:nth-child(even) {
          direction: rtl;
        }

        .step:nth-child(even) > * {
          direction: ltr;
        }

        .step-content {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .step-number {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 700;
        }

        .step-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }

        .step-title {
          font-size: 32px;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 12px;
        }

        .step-description {
          font-size: 18px;
          color: #64748b;
          line-height: 1.7;
        }

        .step-image {
          width: 100%;
          height: auto;
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
          background: #f8fafc;
          aspect-ratio: 3/4;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
          font-size: 18px;
        }

        @media (max-width: 968px) {
          .step {
            grid-template-columns: 1fr;
          }

          .step:nth-child(even) {
            direction: ltr;
          }

          .section-title {
            font-size: 36px;
          }

          .step-title {
            font-size: 24px;
          }
        }
      `}</style>

      <div className="section-container">
        <div className="section-header">
          <h2 className="section-title">How BillTap Works</h2>
          <p className="section-subtitle">Three steps. 30 seconds. Done.</p>
        </div>

        <div className="steps">
          {steps.map((step, index) => (
            <div key={index} className="step">
              <div className="step-content">
                <div className="step-number">{step.number}</div>
                <div className="step-icon">{step.icon}</div>
                <h3 className="step-title">{step.title}</h3>
                <p className="step-description">{step.description}</p>
              </div>
              <div className="step-image">
                Screenshot {step.number}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;