const Terms = () => (
  <div className="min-h-screen bg-white px-5 py-16">
    <div className="max-w-2xl mx-auto">
      <a href="/LandingPage" className="text-[#667eea] text-sm font-medium mb-8 block hover:underline">← Back to BillTap</a>
      <h1 className="text-4xl font-black text-slate-900 mb-4">Terms of Service</h1>
      <p className="text-slate-500 text-sm mb-10">Last updated: March 2026</p>
      <div className="space-y-8 text-slate-700 leading-relaxed">
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">1. Acceptance of Terms</h2>
          <p>By using BillTap, you agree to these Terms of Service. If you do not agree, please do not use the service.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">2. Use of Service</h2>
          <p>BillTap is a bill-splitting tool. You agree to use it only for lawful purposes and not to misuse or attempt to exploit the platform.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">3. Payments</h2>
          <p>Payment processing is provided by Stripe. All transactions are final once processed. For disputes, contact us at <a href="mailto:hello@billtap.app" className="text-[#667eea]">hello@billtap.app</a>.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">4. Intellectual Property</h2>
          <p>BillTap and its content are owned by BillTap Inc. You may not copy, modify, or distribute our content without permission.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">5. Limitation of Liability</h2>
          <p>BillTap is provided "as is." We are not liable for any indirect, incidental, or consequential damages arising from your use of the service.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">6. Contact</h2>
          <p>Questions? Email us at <a href="mailto:hello@billtap.app" className="text-[#667eea]">hello@billtap.app</a></p>
        </section>
      </div>
    </div>
  </div>
);

export default Terms;