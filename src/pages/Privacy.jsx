const Privacy = () => (
  <div className="min-h-screen bg-white px-5 py-16">
    <div className="max-w-2xl mx-auto">
      <a href="/" className="text-[#667eea] text-sm font-medium mb-8 block hover:underline">← Back to BillTap</a>
      <h1 className="text-4xl font-black text-slate-900 mb-4">Privacy Policy</h1>
      <p className="text-slate-500 text-sm mb-10">Last updated: March 2026</p>
      <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">1. Information We Collect</h2>
          <p>BillTap collects information you provide directly, such as your name, email address, and payment information when you use our service. We also collect receipt images you upload to process your bill splits.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">2. How We Use Your Information</h2>
          <p>We use the information we collect to provide, maintain, and improve BillTap — including processing bill splits, facilitating payments between users, and communicating with you about your account.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">3. Payment Information</h2>
          <p>All payment processing is handled by Stripe. BillTap never stores your full card number. Stripe's privacy policy applies to payment data. See <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#667eea]">stripe.com/privacy</a>.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">4. Data Sharing</h2>
          <p>We do not sell your personal information. We share data only as necessary to operate the service (e.g. Stripe for payments, AI providers for receipt parsing).</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">5. Contact</h2>
          <p>Questions? Email us at <a href="mailto:hello@billtap.app" className="text-[#667eea]">hello@billtap.app</a></p>
        </section>
      </div>
    </div>
  </div>
);

export default Privacy;