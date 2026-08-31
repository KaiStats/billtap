import Seo from "@/components/Seo";
import { Link } from "react-router";

const Section = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-xl font-bold text-foreground">{title}</h2>
    {children}
  </section>
);

const Does = ({ children }) => (
  <li className="flex gap-3">
    <span aria-hidden="true" className="text-emerald-600 font-bold shrink-0">✓</span>
    <span>{children}</span>
  </li>
);

const DoesNot = ({ children }) => (
  <li className="flex gap-3">
    <span aria-hidden="true" className="text-amber-600 font-bold shrink-0">✕</span>
    <span>{children}</span>
  </li>
);

const Promises = () => (
  <div className="min-h-screen bg-background px-5 py-16">
    <Seo
      path="/promises"
      title="Promises | BillTap"
      description="What BillTap actually does, and what it deliberately doesn't — money custody, receipt accuracy, POS integration, and where the product stops."
    />
    <div className="max-w-2xl mx-auto">
      <a href="/" className="text-primary text-sm font-medium mb-8 block hover:underline">← Back to BillTap</a>
      <h1 className="text-4xl font-black text-foreground mb-2">Promises</h1>
      <p className="text-muted-foreground text-sm mb-2">Last updated: August 31, 2026</p>
      <p className="text-muted-foreground text-sm mb-10">
        A one-page answer to &ldquo;what does this actually do?&rdquo; — written to be checked, not to sell.
        Where we&apos;re not sure, we say so rather than round up.
      </p>

      <div className="space-y-10 text-muted-foreground leading-relaxed text-[15px]">

        <Section title="What BillTap is">
          <p>
            A way to split a restaurant bill from a QR code on the table. A guest scans it, claims what they
            ordered, and sends their share to whoever paid — through Venmo, Cash App or Zelle. A restaurant
            gets a printed table code, a dashboard of guest ratings, and a route from a happy guest to their
            Google listing. That is the whole product. It is not a payments company, a restaurant management
            platform, or a POS.
          </p>
        </Section>

        <Section title="What it does">
          <ul className="space-y-2">
            <Does>Splits a bill three ways — evenly, by item, or a custom amount per person — with tax and tip prorated automatically.</Does>
            <Does>Reads a photographed receipt with AI to fill in line items and totals, so nobody has to type them in by hand.</Does>
            <Does>Lets a guest claim exactly what they ordered and see only their own share — not anyone else&apos;s.</Does>
            <Does>Works without an account for guests. Scan, claim, pay.</Does>
            <Does>Gets each person to a direct payment link for the app they already use — Venmo, Cash App or Zelle.</Does>
            <Does>Gives a restaurant a printed QR code, a live dashboard of who&apos;s paid, and a guest-rating flow that routes a happy guest to leave a Google review and flags an unhappy one to staff before they leave.</Does>
            <Does>Sits beside a restaurant&apos;s existing POS. Nothing to install, nothing to integrate.</Does>
            <Does>Lets you cancel any time, with no contract and no cancellation fee — see our <Link to="/terms" className="text-primary hover:underline">Terms</Link>.</Does>
          </ul>
        </Section>

        <Section title="What it doesn't do">
          <ul className="space-y-2">
            <DoesNot>
              <strong>Never holds anyone&apos;s money.</strong> BillTap calculates who owes what and hands
              them a payment link; the transfer happens directly between the two people, on Venmo, Cash App
              or Zelle. We are never a party to it, and we cannot reverse, hold, or guarantee it.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t chase anyone who doesn&apos;t pay.</strong> If a guest claims an item and
              never sends the money, BillTap shows that clearly on the host&apos;s screen. It does not send
              collection notices, charge a card on file, or take any action beyond showing who&apos;s settled
              and who isn&apos;t.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t guarantee the receipt reading is perfect.</strong> The AI parser is
              generally accurate but can misread a smudged total, a handwritten tip, or an unusual layout.
              Whoever creates the split can review and correct it before it&apos;s shared, and everyone
              claiming an item sees the exact number before they agree to pay it — but nobody at BillTap
              checks it against the restaurant&apos;s system, because we don&apos;t have access to one.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t integrate with a POS.</strong> There is no cash register plugin, no receipt
              printer hook, and no live feed from a restaurant&apos;s point-of-sale system. A guest photographs
              the paper or screen bill they were already handed; that photo is the entire integration.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t replace a restaurant&apos;s POS or take payment on a restaurant&apos;s
              behalf.</strong> A restaurant is still paid by its normal means, at the table, the way it
              already was. BillTap runs alongside that for splitting the bill among a group afterward.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t promise uninterrupted service.</strong> We test heavily (see{" "}
              <Link to="/security" className="text-primary hover:underline">Security</Link>) and we care when
              something breaks, but there is no uptime guarantee or service-level agreement — see{" "}
              <Link to="/terms" className="text-primary hover:underline">Terms</Link> for what that means
              legally.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t have a fixed roadmap.</strong> This is a solo-built product. Features ship
              from what people actually run into, not from a published plan — so we won&apos;t promise a
              specific feature by a specific date.
            </DoesNot>
            <DoesNot>
              <strong>Doesn&apos;t sell your data, and doesn&apos;t use it for advertising.</strong> The
              specifics — what&apos;s collected, how long it&apos;s kept, and how to delete it — are in the{" "}
              <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
            </DoesNot>
          </ul>
        </Section>

        <Section title="If a claim here turns out to be wrong">
          <p>
            Tell us. This page is meant to be a true description of the product, not marketing copy — if
            something here doesn&apos;t match what you experienced, email{" "}
            <a href="mailto:hello@billtap.app" className="text-primary hover:underline">hello@billtap.app</a>{" "}
            and we&apos;ll either fix the product or fix the page, whichever one is wrong.
          </p>
        </Section>

        <footer className="pt-4 border-t border-border text-sm space-x-4">
          <Link className="hover:underline text-primary" to="/terms">Terms of Service</Link>
          <Link className="hover:underline text-primary" to="/privacy">Privacy Policy</Link>
          <Link className="hover:underline text-primary" to="/security">Security</Link>
        </footer>

      </div>
    </div>
  </div>
);

export default Promises;
