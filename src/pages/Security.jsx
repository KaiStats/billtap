import Seo from "@/components/Seo";
import { Link } from "react-router-dom";

/**
 * /security
 *
 * Every claim on this page is one this codebase can back up, because a security
 * page is a representation made to customers. A restaurant owner reads it and
 * decides to trust us with their table's data; if a claim here is not true and
 * something goes wrong later, this page is the first exhibit — the FTC's data
 * security cases are brought under the deceptive-practices statute, and the
 * deception is nearly always a statement on a page like this one rather than
 * the breach itself.
 *
 * So: no certifications we do not hold, no penetration tests we have not
 * commissioned, no encryption guarantee we cannot demonstrate. The "Where we
 * are honest about the gaps" section stays until each line in it is closed.
 * Anyone evaluating a vendor seriously trusts that section more than the rest
 * of the page, and anyone who does not is not the customer to win this way.
 *
 * Before adding a claim here, ask what you would show someone who asked to see
 * the evidence. If the answer is a file in this repo, add it. If the answer is
 * "our provider probably does", it goes in the gaps section instead.
 */

const Section = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-xl font-bold text-slate-900">{title}</h2>
    {children}
  </section>
);

const Fact = ({ children }) => (
  <li className="flex gap-3">
    <span aria-hidden="true" className="text-emerald-600 font-bold shrink-0">✓</span>
    <span>{children}</span>
  </li>
);

const Gap = ({ children }) => (
  <li className="flex gap-3">
    <span aria-hidden="true" className="text-amber-600 font-bold shrink-0">○</span>
    <span>{children}</span>
  </li>
);

const SECURITY_EMAIL = "security@billtap.app";

const Security = () => (
  <div className="min-h-screen bg-white px-5 py-16">
    <Seo
      path="/security"
      title="Security | BillTap"
      description="How BillTap protects restaurant and diner data: payment isolation, access control, signed QR codes, testing, incident response, and how to report a vulnerability."
    />

    <div className="max-w-3xl mx-auto space-y-10 text-slate-700 leading-relaxed">
      <header className="space-y-3">
        <h1 className="text-3xl font-black text-slate-900">Security</h1>
        <p className="text-slate-600">
          BillTap sits between a restaurant and its guests at the moment money changes hands. This
          page describes what we actually do to protect that, in enough detail to be checked.
        </p>
        <p className="text-sm text-slate-500">Last reviewed: 2 August 2026</p>
      </header>

      <Section title="Payment data never reaches us">
        <ul className="space-y-2">
          <Fact>
            <strong>We never see a card number.</strong> Restaurant subscriptions are taken through
            Stripe Checkout, which is hosted by Stripe. Card details are entered on Stripe&apos;s
            page and are never transmitted to, processed by, or stored on our servers.
          </Fact>
          <Fact>
            <strong>We never hold guests&apos; money.</strong> Diners reimburse the person who paid
            the bill directly, through Venmo, Cash App or Zelle. Funds move between those two people
            and their payment app. BillTap is never a party to the transfer and never takes custody
            of anyone&apos;s money.
          </Fact>
          <Fact>
            No bank account numbers, routing numbers or card details of any kind are stored in our
            database, because none are ever collected.
          </Fact>
        </ul>
      </Section>

      <Section title="What one diner can see about another">
        <p>
          Everyone at a table shares one bill, so this is the part we designed hardest.
        </p>
        <ul className="space-y-2">
          <Fact>
            <strong>Amounts are scoped on the server, not hidden in the browser.</strong> When a
            diner&apos;s phone asks for the bill, the response contains their own share and does not
            contain anyone else&apos;s. It is not filtered out on the way to the screen — it is
            never sent.
          </Fact>
          <Fact>
            <strong>Only the host can confirm a payment.</strong> Confirming that money arrived
            requires a secret issued once, when the split is created. We store only its SHA-256
            hash, and the secret itself never leaves the device that created the split.
          </Fact>
          <Fact>
            A diner can mark themselves as having sent payment. They cannot mark anyone else, and
            they cannot mark themselves as confirmed — only the person the money went to can do that.
          </Fact>
          <Fact>
            Names and who has settled are visible to the table, because the table needs them.
            Nothing else is.
          </Fact>
        </ul>
      </Section>

      <Section title="The QR code on the table">
        <ul className="space-y-2">
          <Fact>
            Each code carries a token signed with HMAC-SHA256. Altering the session it points at, or
            extending its expiry, invalidates the signature and the code is refused.
          </Fact>
          <Fact>
            Tokens expire after 30 minutes and the host screen mints a fresh one before that, so a
            photographed code stops working shortly after the meal.
          </Fact>
        </ul>
      </Section>

      <Section title="Access control">
        <ul className="space-y-2">
          <Fact>
            Every record carries row-level security rules enforced by our data layer, not by our
            application code. A request for a record the caller is not entitled to returns nothing.
          </Fact>
          <Fact>
            Every action that moves money or changes what someone owes is authorised on the server
            against stored data. Prices, totals and amounts sent by a browser are ignored.
          </Fact>
          <Fact>
            Restaurant operators see only their own restaurant&apos;s ratings and guest contacts.
          </Fact>
        </ul>
      </Section>

      <Section title="What gets recorded">
        <p>
          Actions that move money or expose people are written to an append-only log. The test for
          what belongs there is narrow: if it went wrong, would two people disagree about what
          happened? Everything else is left out, because a record of everything is a log, not a
          trail.
        </p>
        <ul className="space-y-2">
          <Fact>
            <strong>Payments.</strong> A diner saying they sent money, and the host confirming it
            arrived, are separate entries with separate amounts and times. That distinction is the
            entire content of a payment dispute.
          </Fact>
          <Fact>
            <strong>Changes to a split</strong> after people have started claiming, including what
            the setting was before.
          </Fact>
          <Fact>
            <strong>Host access.</strong> Reading a whole table&apos;s bill, and every rejected
            attempt to do so with a wrong host key.
          </Fact>
          <Fact>
            <strong>Guest data leaving.</strong> Every time a restaurant&apos;s guest contact list
            is read, with the number of rows.
          </Fact>
          <Fact>
            <strong>Secrets are not in it.</strong> The host key is stored only as a truncated
            one-way fingerprint — enough to tell two hosts apart, useless for confirming a payment.
            Addresses are fingerprinted the same way. Fields are allow-listed rather than redacted,
            so a field nobody approved is dropped instead of stored.
          </Fact>
          <Fact>
            <strong>It cannot be edited.</strong> Update and delete are revoked on the table for
            every role, including the one our own server uses, and a database trigger refuses them
            as well. Corrections are new rows. An audit trail that can be rewritten is a document,
            not evidence.
          </Fact>
          <Fact>
            <strong>It cannot break a payment.</strong> Writing the record happens after the
            response and its failure is swallowed. A trail that can fail the action it observes
            would do so at the busiest table on the busiest night.
          </Fact>
        </ul>
      </Section>

      <Section title="When something goes wrong">
        <p>
          Every failure carries a short request id, shown on screen and written into our logs and
          the audit trail. Quoting it in a support email takes us straight to the exact request.
        </p>
        <ul className="space-y-2">
          <Fact>
            Messages about something you can fix say what is wrong. Messages about a fault on our
            side say only that, plus the id — an internal error message can name a database column
            or another customer&apos;s data, so it is replaced rather than trimmed.
          </Fact>
        </ul>
      </Section>

      <Section title="The application and its infrastructure">
        <ul className="space-y-2">
          <Fact>
            All traffic is served over HTTPS by Cloudflare. Data in transit is encrypted with TLS.
          </Fact>
          <Fact>
            Responses carry a Content Security Policy, <code>X-Frame-Options: DENY</code>,{" "}
            <code>X-Content-Type-Options: nosniff</code>, a Referrer Policy and a Permissions Policy
            that denies camera, microphone and geolocation access.
          </Fact>
          <Fact>
            Every endpoint that accepts an unauthenticated caller is rate limited, as are sign-in,
            registration and password reset.
          </Fact>
          <Fact>
            <strong>Development and production are separate systems.</strong> They use separate
            databases and separate credentials, and the application refuses to start if a
            non-production deployment is pointed at production data. Test email and SMS are never
            delivered to real people.
          </Fact>
          <Fact>
            Secrets are held in Cloudflare&apos;s encrypted secret storage, per environment. They are
            not in the source repository.
          </Fact>
        </ul>
      </Section>

      <Section title="How the code is tested">
        <ul className="space-y-2">
          <Fact>
            327 automated tests run on every change, covering the money arithmetic to the cent, the
            authorisation rules, and the guest journey end to end in a real browser.
          </Fact>
          <Fact>
            <strong>The tests are themselves tested.</strong> We deliberately introduce faults —
            removing an authorisation check, letting a diner see another&apos;s balance, breaking the
            tax split — and require the suite to fail. A test that cannot fail proves nothing, and
            several of ours were rewritten when they did not catch the fault they existed for.
          </Fact>
          <Fact>
            Changes are reviewed against a written checklist covering correctness, authorisation,
            data exposure and accessibility before release.
          </Fact>
        </ul>
      </Section>

      <Section title="Incident response">
        <p>
          We maintain a written incident runbook covering detection, triage, mitigation, recovery and
          a post-incident report. It has specific procedures for receipt-scanning outages, payment
          provider outages and data loss, including how and when affected restaurants are contacted.
        </p>
        <p>
          If an incident affects your data, we will contact you at the email on your account with
          what happened, what was affected and what we are doing about it — and we will do it while
          we still only partly understand it, rather than waiting until the story is tidy.
        </p>
      </Section>

      <Section title="Reporting a vulnerability">
        <p>
          If you have found a security issue in BillTap, we want to hear about it. Please do not
          post it publicly before contacting us.
        </p>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-3">
          <p className="font-semibold text-slate-900">
            Email <a className="text-emerald-700 underline" href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>
          </p>
          <p className="text-sm">
            Machine-readable contact details are published at{" "}
            <a className="text-emerald-700 underline" href="/.well-known/security.txt">
              /.well-known/security.txt
            </a>{" "}
            per RFC 9116.
          </p>
        </div>

        <h3 className="font-semibold text-slate-900 pt-2">What to include</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>What the issue is and roughly how severe you think it is.</li>
          <li>The steps to reproduce it, and the URL or endpoint involved.</li>
          <li>What an attacker could actually do with it.</li>
          <li>How you would like to be credited, if at all.</li>
        </ul>

        <h3 className="font-semibold text-slate-900 pt-2">What we will do</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Acknowledge your report within <strong>3 business days</strong>.</li>
          <li>Give you an assessment and an expected timeline within <strong>10 business days</strong>.</li>
          <li>Tell you when it is fixed, and credit you publicly if you would like that.</li>
        </ul>

        <h3 className="font-semibold text-slate-900 pt-2">Safe harbour</h3>
        <p>
          If you make a good-faith effort to follow this policy, we will not pursue legal action
          against you, and we will say so to anyone who asks. Good faith means: only touch accounts
          and data you own or have been given permission to test, stop as soon as you have confirmed
          a vulnerability, do not run denial-of-service tests or spam, do not access, modify or
          retain anyone else&apos;s data, and give us reasonable time to fix the issue before
          publishing.
        </p>
        <p>
          We do not currently run a paid bug bounty. We will credit you, and we will answer you like
          a person.
        </p>
      </Section>

      <Section title="Where we are honest about the gaps">
        <p>
          Most security pages list only strengths. These are the things we have not done yet. They
          are here so that a claim above can be relied on — a page that hides its gaps makes its
          other statements worth less, not more.
        </p>
        <ul className="space-y-2">
          <Gap>
            <strong>We have not had a third-party penetration test.</strong> Our review is internal
            and automated. Any vendor questionnaire asking whether we have been pen tested should be
            answered no.
          </Gap>
          <Gap>
            <strong>We hold no security certification.</strong> No SOC 2, no ISO 27001, no PCI
            attestation. PCI scope is reduced by never handling card data, but reduced is not
            certified.
          </Gap>
          <Gap>
            <strong>Encryption at rest is our providers&apos;, not ours to promise.</strong> Data is
            stored with Cloudflare, Base44 and Stripe. We do not add a separate encryption layer of
            our own, so we do not claim one.
          </Gap>
          <Gap>
            <strong>The audit trail is not customer-facing yet.</strong> Sensitive actions are
            recorded (see above), but there is no screen where an operator can read their own trail.
            Answering a question from it today means us running a query.
          </Gap>
        </ul>
        <p className="text-sm text-slate-500">
          When one of these closes, it moves up the page and the date at the top changes.
        </p>
      </Section>

      <footer className="pt-4 border-t border-slate-200 text-sm text-slate-500 space-x-4">
        <Link className="underline" to="/privacy">Privacy Policy</Link>
        <Link className="underline" to="/terms">Terms of Service</Link>
        <Link className="underline" to="/">Home</Link>
      </footer>
    </div>
  </div>
);

export default Security;
