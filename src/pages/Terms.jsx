import Seo from "@/components/Seo";
import { Link } from "react-router";

const Section = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-xl font-bold text-foreground">{title}</h2>
    {children}
  </section>
);

const CONTACT_EMAIL = "hello@billtap.app";

const Terms = () => (
  <div className="min-h-screen bg-background px-5 py-16">
    <Seo
      path="/terms"
      title="Terms of Service | BillTap"
      description="Who operates BillTap, how the free and paid plans work, what happens if you cancel, and what we do and don't promise about the product."
    />
    <div className="max-w-2xl mx-auto">
      <a href="/" className="text-primary text-sm font-medium mb-8 block hover:underline">← Back to BillTap</a>
      <h1 className="text-4xl font-black text-foreground mb-2">Terms of Service</h1>
      <p className="text-muted-foreground text-sm mb-10">Last updated: August 31, 2026</p>

      <div className="space-y-10 text-muted-foreground leading-relaxed text-[15px]">

        <Section title="1. Who we are">
          <p>
            BillTap is a solo project, operated by Kai Cogmon (&ldquo;we&rdquo;, &ldquo;us&rdquo;). It is not
            operated by a registered corporation or LLC — we are telling you that plainly rather than putting
            &ldquo;Inc.&rdquo; after a name that has not been incorporated. These terms are a contract between
            you and Kai Cogmon, doing business as BillTap.
          </p>
        </Section>

        <Section title="2. Acceptance of terms">
          <p>
            By using BillTap — as a guest claiming a bill, or as a restaurant creating an account — you agree
            to these terms. If you do not agree, please do not use the service. We may update these terms; the
            date above will change when we do, and continued use after a change means you accept the new terms.
          </p>
        </Section>

        <Section title="3. The service">
          <p>BillTap is a bill-splitting tool with two sides:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Guests</strong> scan a QR code on a table, claim what they ordered, and pay the person
              who covered the bill directly through Venmo, Cash App or Zelle. No account is required. An
              optional Pro plan ($3.99/month, 14-day free trial) adds a running tab across meals and raises
              the group size limit from 10 to 50 people.
            </li>
            <li>
              <strong>Restaurants</strong> create an account to get a printed QR code for their tables and a
              dashboard of guest ratings and contacts, for $149/month after a 14-day free trial.
            </li>
          </ul>
          <p className="mt-2">
            BillTap never takes custody of anyone&apos;s money. It calculates who owes what and gets them to
            the right payment link — the transfer itself happens directly between the two people.
          </p>
        </Section>

        <Section title="4. Accounts">
          <p>
            Restaurant accounts require an email and a password, and you are responsible for keeping your
            login secret and for anything done from your account. Guests never need an account to claim items
            or pay their share.
          </p>
        </Section>

        <Section title="5. Payments, trials & cancellation">
          <ul className="list-disc pl-5 space-y-2">
            <li>Payment processing is handled entirely by Stripe. We never see or store your card details.</li>
            <li>
              Both paid plans start with a 14-day free trial, once per person. No card is charged until the
              trial ends, and no card is required to try the free tier.
            </li>
            <li>
              There is no contract and no cancellation fee. Cancel any time by emailing{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>
              {" "}or by deleting your account from your profile settings.
            </li>
            <li>
              Cancelling stops billing immediately — we don&apos;t continue charging you and then cut off
              access later. Because of that, we don&apos;t issue refunds for the unused portion of a period
              you already paid for. If you think you were charged in error, email us and we will look at it.
            </li>
          </ul>
        </Section>

        <Section title="6. Receipt scanning is AI-assisted, not guaranteed">
          <p>
            Line items and totals are read off a photographed receipt by an AI model. It is generally
            accurate but it is not perfect — it can misread a smudged total, a handwritten tip, or an unusual
            receipt layout. Whoever creates a split can review and correct what was read before sharing it,
            and everyone claiming items can see exactly what they are agreeing to pay before they pay it.
            BillTap is a tool to make that math faster, not a guarantee that a number on screen matches what
            the restaurant actually charged.
          </p>
        </Section>

        <Section title="7. Acceptable use">
          <p>You agree to use BillTap only for lawful purposes, and not to:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Create a split for a bill you don&apos;t intend to collect or pay honestly.</li>
            <li>Try to access another guest&apos;s share, another restaurant&apos;s dashboard, or a host key that isn&apos;t yours.</li>
            <li>Interfere with the service — scraping, rate-limit evasion, or attempting to disrupt it for other users.</li>
            <li>Use a restaurant&apos;s QR code or guest contact list for anything other than running that restaurant&apos;s splits and its own outreach.</li>
          </ul>
          <p className="mt-2">
            We can suspend or terminate an account that violates this section. If you find a security
            weakness rather than exploit it, see our <Link to="/security" className="text-primary hover:underline">Security page</Link>{" "}
            — we would much rather hear from you.
          </p>
        </Section>

        <Section title="8. Intellectual property">
          <p>
            The BillTap name, design and code are ours. You&apos;re welcome to link to us or write about the
            product; you may not copy the app, its design, or its content to build a competing product.
            Nothing here restricts your own bill data — the split totals, item names, and amounts from your
            own sessions are yours to export or screenshot freely.
          </p>
        </Section>

        <Section title="9. If something goes wrong">
          <p>
            BillTap is provided &ldquo;as is.&rdquo; We work to keep it accurate and available (see our{" "}
            <Link to="/security" className="text-primary hover:underline">Security page</Link> for the
            specifics of how), but we don&apos;t promise it will be error-free or uninterrupted, and we are
            not a party to — or responsible for — the actual transfer of money between a guest and whoever
            they&apos;re paying back. To the extent the law allows it, our liability to you for any claim
            related to BillTap is limited to the amount you paid us in the three months before the claim,
            and we are not liable for indirect or consequential damages like a missed reservation or a
            friendship strained by a bill dispute.
          </p>
          <p className="mt-2">
            None of this limits liability where the law doesn&apos;t allow it to be limited — for example,
            for our own fraud or for something that can&apos;t be waived under consumer-protection law where
            you live.
          </p>
        </Section>

        <Section title="10. Governing law">
          <p>
            These terms are governed by the laws of the State of Nevada, without regard to its conflict-of-law
            rules. If a dispute can&apos;t be resolved informally, it will be handled in the state or federal
            courts located in Nevada.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about these terms, or about a specific charge or account? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
            For privacy requests, see our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
            For a security report, see our <Link to="/security" className="text-primary hover:underline">Security page</Link>.
          </p>
        </Section>

      </div>
    </div>
  </div>
);

export default Terms;
