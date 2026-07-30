import Seo from "@/components/Seo";
const Section = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-xl font-bold text-slate-900">{title}</h2>
    {children}
  </section>
);

const RETENTION_ROWS = [
  ["Guest display names", "30 days after session completion", 'Replaced with "[removed]" automatically'],
  ["Item claim associations", "30 days after session completion", "Claim lists cleared; item names/prices kept for host records"],
  ["Receipt images", "30 days after session completion", "Deleted from storage automatically"],
  ["Session totals & amounts", "Indefinitely (host's financial records)", "Retained in anonymized form"],
  ["Host account data (email, name)", "Until account deletion is requested", "Deleted upon verified request"],
  ["Analytics data", "90 days (rolling)", "Automatically purged"],
];

const COLLECTION_ROWS = [
  ["Identifiers", "Name, email address", "Yes — from hosts who create an account"],
  ["Guest / Session Data", "Self-entered display name used to claim items", "Yes — from guests (no account required)"],
  ["Receipt Images", "Photos of restaurant bills uploaded for AI parsing", "Yes — temporarily, see retention below"],
  ["Usage Data", "Pages visited, session interactions, device type", "Yes — via analytics (anonymized)"],
  ["Payment Information", "Card numbers, bank details", "No — payments handled directly by Venmo / Cash App / Zelle"],
];

const TableHead = ({ cols }) => (
  <thead className="bg-slate-50 text-slate-600 font-semibold">
    <tr>
      {cols.map((c) => (
        <th key={c} className="text-left px-4 py-3 border-b border-slate-200">{c}</th>
      ))}
    </tr>
  </thead>
);

const Privacy = () => (
  <div className="min-h-screen bg-white px-5 py-16">
    <Seo
      path="/privacy"
      title="Privacy Policy | BillTap"
      description="What BillTap collects, how long it is kept, and how it is deleted. Includes the full data retention schedule."
    />
    <div className="max-w-2xl mx-auto">
      <a href="/" className="text-violet-600 text-sm font-medium mb-8 block hover:underline">← Back to BillTap</a>
      <h1 className="text-4xl font-black text-slate-900 mb-2">Privacy Policy</h1>
      <p className="text-slate-500 text-sm mb-2">Last updated: June 9, 2026</p>
      <p className="text-slate-500 text-sm mb-10">
        This policy applies to BillTap (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and describes how we collect, use, retain, and delete personal information in compliance with the California Consumer Privacy Act (CCPA) and other applicable privacy laws.
      </p>

      <div className="space-y-10 text-slate-700 leading-relaxed text-[15px]">

        <Section title="1. Information We Collect">
          <p>We collect the following categories of personal information:</p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <TableHead cols={["Category", "Examples", "Collected?"]} />
              <tbody className="divide-y divide-slate-100">
                {COLLECTION_ROWS.map(([cat, ex, col]) => (
                  <tr key={cat}>
                    <td className="px-4 py-3 font-medium text-slate-800">{cat}</td>
                    <td className="px-4 py-3 text-slate-500">{ex}</td>
                    <td className="px-4 py-3">{col}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Providing the service</strong> — processing receipt images, creating bill-split sessions, and enabling guests to claim items.</li>
            <li><strong>AI receipt parsing</strong> — uploaded receipt images are sent to an AI provider solely to extract line-item data. They are not used to train models.</li>
            <li><strong>Analytics</strong> — anonymized usage data helps us understand how the app is used and improve features.</li>
            <li><strong>Security</strong> — rate-limiting and abuse prevention.</li>
            <li><strong>Legal compliance</strong> — retaining records we are required to keep by law.</li>
          </ul>
          <p className="mt-2">We do <strong>not</strong> use your data for advertising, profiling, or any purpose beyond operating BillTap.</p>
        </Section>

        <Section title="3. Data Retention">
          <p>We apply the following retention schedule:</p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <TableHead cols={["Data Type", "Retention Period", "What Happens After"]} />
              <tbody className="divide-y divide-slate-100">
                {RETENTION_ROWS.map(([type, period, after]) => (
                  <tr key={type}>
                    <td className="px-4 py-3 font-medium text-slate-800">{type}</td>
                    <td className="px-4 py-3 text-slate-500">{period}</td>
                    <td className="px-4 py-3">{after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-500">Automated cleanup runs nightly. The 30-day clock starts when a session reaches <em>completed</em> status.</p>
        </Section>

        <Section title="4. Your Privacy Rights (CCPA)">
          <p>If you are a California resident, you have the following rights under the CCPA:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li><strong>Right to Know</strong> — You may request disclosure of the categories and specific pieces of personal information we have collected about you.</li>
            <li><strong>Right to Delete</strong> — You may request deletion of personal information we hold about you, subject to legal exceptions.</li>
            <li><strong>Right to Correct</strong> — You may request correction of inaccurate personal information.</li>
            <li><strong>Right to Opt-Out of Sale</strong> — We do <strong>not</strong> sell personal information. No opt-out is required.</li>
            <li><strong>Right to Non-Discrimination</strong> — Exercising any of these rights will not result in denial of service.</li>
          </ul>
          <p className="mt-3">
            To exercise any right, email{" "}
            <a href="mailto:privacy@billtap.app" className="text-violet-600 hover:underline">privacy@billtap.app</a>
            {" "}with the subject line <em>&ldquo;Privacy Request&rdquo;</em>. We will respond within <strong>45 days</strong> as required by the CCPA.
          </p>
        </Section>

        <Section title="5. Account & Data Deletion">
          <p>Registered hosts can delete their account and all associated data at any time from the app&apos;s profile settings. Upon deletion:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Your account and email are permanently removed.</li>
            <li>All sessions you created are deleted.</li>
            <li>Deletion is irreversible.</li>
          </ul>
          <p className="mt-2">
            You may also email{" "}
            <a href="mailto:privacy@billtap.app" className="text-violet-600 hover:underline">privacy@billtap.app</a>
            {" "}to request deletion if you cannot access your account.
          </p>
        </Section>

        <Section title="6. Data Sharing & Third Parties">
          <p>We share data only as strictly necessary to operate BillTap:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li><strong>AI provider</strong> — receipt images are sent for parsing only. Images are not stored or used for training by the provider.</li>
            <li><strong>Analytics</strong> — anonymized usage data (no PII) is sent to Google Analytics.</li>
            <li><strong>Hosting infrastructure</strong> — data is stored on servers located in the United States.</li>
          </ul>
          <p className="mt-2">We do <strong>not</strong> sell, rent, or trade personal information with any third party for commercial purposes.</p>
        </Section>

        <Section title="7. Children's Privacy">
          <p>BillTap is not directed to children under 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, contact us and we will delete it promptly.</p>
        </Section>

        <Section title="8. Security">
          <p>
            We use industry-standard security measures including encrypted connections (HTTPS/TLS), access controls, and automated data minimization. No system is 100% secure — if you believe your data has been compromised, contact us immediately at{" "}
            <a href="mailto:security@billtap.app" className="text-violet-600 hover:underline">security@billtap.app</a>.
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>We may update this policy to reflect changes in our practices or legal requirements. We will post the revised policy with an updated date at the top. Continued use of BillTap after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="10. Contact Us">
          <p>For any privacy questions or to exercise your rights:</p>
          <div className="mt-3 p-4 bg-slate-50 rounded-xl text-sm space-y-1">
            <p><strong>BillTap</strong></p>
            <p>Email: <a href="mailto:privacy@billtap.app" className="text-violet-600 hover:underline">privacy@billtap.app</a></p>
            <p>Response time: within 45 days of verified request</p>
          </div>
        </Section>

      </div>
    </div>
  </div>
);

export default Privacy;