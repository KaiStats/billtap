const steps = [
  {
    number: '1',
    icon: '📸',
    title: 'Snap the receipt',
    description: 'Take a photo of your bill. AI reads every item in 3 seconds.',
  },
  {
    number: '2',
    icon: '👆',
    title: 'Everyone taps their items',
    description: 'Share a QR code. Each person claims what they ordered in real-time.',
  },
  {
    number: '3',
    icon: '💳',
    title: 'Pay your exact share',
    description: 'Tax and tip split proportionally. Pay with Apple Pay or card. Done.',
  },
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="py-20 lg:py-28 bg-white px-5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-900 mb-4">How BillTap Works</h2>
          <p className="text-lg sm:text-xl text-slate-500">Three steps. 30 seconds. Done.</p>
        </div>

        <div className="flex flex-col gap-16 lg:gap-24">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-8 lg:gap-16 items-center`}
            >
              {/* Content */}
              <div className="flex-1 flex flex-col gap-4">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0"
                  style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}
                >
                  {step.number}
                </div>
                <div className="text-5xl">{step.icon}</div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-900">{step.title}</h3>
                <p className="text-lg text-slate-500 leading-relaxed">{step.description}</p>
              </div>

              {/* Image placeholder */}
              <div className="flex-1 w-full">
                <div
                  className="w-full rounded-3xl flex items-center justify-center text-slate-400 text-lg font-medium"
                  style={{ aspectRatio: '3/4', background: '#f8fafc', boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}
                >
                  Screenshot {step.number}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;