const features = [
  { icon: '⚡', title: 'Lightning Fast', description: '30 seconds from photo to payment. Faster than pulling out Venmo.' },
  { icon: '🎯', title: 'Perfectly Fair', description: 'Proportional tax and tip. Pay exactly what you ordered. No rounding errors.' },
  { icon: '🔒', title: '100% Secure', description: 'Powered by Stripe. Your card info is encrypted and never stored.' },
  { icon: '👥', title: 'Works for Groups', description: '2-50 people. No app download needed for guests. Just scan and pay.' },
  { icon: '🚫', title: 'No IOUs', description: 'Everyone pays at the table. 100% settlement rate. No chasing people later.' },
  { icon: '🧠', title: 'AI-Powered', description: 'Reads any receipt in 3 seconds. Even handwritten ones.' },
];

const Features = () => {
  return (
    <section id="features" className="py-20 lg:py-28 px-5" style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-900 mb-4">Why BillTap?</h2>
          <p className="text-lg sm:text-xl text-slate-500">Built for the way people actually split bills</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="bg-white p-8 sm:p-10 rounded-2xl text-center transition-all duration-300 border-2 border-transparent hover:-translate-y-2 hover:border-[#667eea] cursor-default"
              style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
            >
              <div className="text-5xl mb-5">{feature.icon}</div>
              <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">{feature.title}</h3>
              <p className="text-base text-slate-500 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;