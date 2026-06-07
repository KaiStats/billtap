const steps = [
  {
    number: '01',
    icon: '📸',
    color: 'from-violet-500 to-purple-600',
    glow: 'rgba(139,92,246,0.3)',
    title: 'Snap the receipt',
    description: 'Take a photo of your bill. Our AI reads every line item automatically — even handwritten ones.',
  },
  {
    number: '02',
    icon: '👆',
    color: 'from-pink-500 to-rose-500',
    glow: 'rgba(236,72,153,0.3)',
    title: 'Everyone taps their items',
    description: 'Share a QR code. Each person opens it on their phone — no app install needed — and taps what they ordered.',
  },
  {
    number: '03',
    icon: '💳',
    color: 'from-emerald-400 to-teal-500',
    glow: 'rgba(52,211,153,0.3)',
    title: 'Pay your exact share',
    description: 'Tax and tip split proportionally to what you ordered. Send your share via Venmo, Cash App, or Zelle. Done.',
  },
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 px-5" style={{ background: '#0a0a0f' }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-20">
          <span className="inline-block text-xs font-bold uppercase tracking-widest text-purple-400 mb-4 px-3 py-1 rounded-full border border-purple-400/30 bg-purple-400/5">
            How it works
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-4">Three steps. 30 seconds.</h2>
          <p className="text-lg text-white/50">The easiest bill split you've ever done.</p>
        </div>

        <div className="flex flex-col gap-6">
          {steps.map((step, index) => (
            <div
              key={index}
              className="relative rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center gap-6"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: `0 0 60px ${step.glow}`,
              }}
            >
              {/* Number */}
              <div className={`shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg`}>
                <span className="text-2xl font-black text-white">{step.icon}</span>
              </div>

              <div className="flex-1">
                <div className={`text-xs font-black uppercase tracking-widest mb-2 bg-gradient-to-r ${step.color} bg-clip-text`} style={{WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>
                  Step {step.number}
                </div>
                <h3 className="text-2xl sm:text-3xl font-black text-white mb-2">{step.title}</h3>
                <p className="text-base text-white/55 leading-relaxed max-w-lg">{step.description}</p>
              </div>

              {/* Big dim number bg */}
              <div className="absolute right-8 top-1/2 -translate-y-1/2 text-8xl font-black text-white/[0.03] select-none pointer-events-none hidden sm:block">
                {step.number}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;