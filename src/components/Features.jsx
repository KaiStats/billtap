const features = [
  { icon: '⚡', color: 'from-yellow-400 to-orange-400', title: 'Lightning Fast', description: '30 seconds from photo to payment. Faster than anyone at the table can open Venmo.' },
  { icon: '🎯', color: 'from-violet-500 to-purple-600', title: 'Perfectly Fair', description: 'Proportional tax and tip. You pay exactly for what you ordered. Zero rounding arguments.' },
  { icon: '🔒', color: 'from-blue-400 to-cyan-400', title: '100% Secure', description: 'Your session data stays private. Guests only see the shared bill — never each other\'s payment details.' },
  { icon: '👥', color: 'from-pink-500 to-rose-400', title: 'Works for Groups', description: '2–50 people. No app download for guests. Just scan the QR and claim items.' },
  { icon: '🚫', color: 'from-emerald-400 to-teal-500', title: 'No IOUs', description: 'Everyone pays at the table. 100% settlement rate. No chasing friends later.' },
  { icon: '🧠', color: 'from-indigo-400 to-violet-500', title: 'AI-Powered', description: 'Reads any receipt in 3 seconds — printed, handwritten, or crumpled. Magic.' },
];

const Features = () => {
  return (
    <section id="features" className="py-24 lg:py-32 px-5" style={{ background: 'linear-gradient(180deg, #0a0a0f 0%, #12101e 100%)' }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <span className="inline-block text-xs font-bold uppercase tracking-widest text-pink-400 mb-4 px-3 py-1 rounded-full border border-pink-400/30 bg-pink-400/5">
            Features
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-4">Why everyone loves BillTap</h2>
          <p className="text-lg text-white/50">Built for the way people actually split bills</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group rounded-2xl p-7 transition-all duration-300 hover:-translate-y-1 cursor-default"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
              onMouseEnter={e => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.15)'}
              onMouseLeave={e => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.07)'}
            >
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center text-xl mb-5 shadow-lg`}>
                {feature.icon}
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;