import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage } from "@/components/legal/legal-page";
import { LEGAL_UPDATED } from "@/lib/legal";
import { RAMP_SCOPES, RAMP_SCOPE_USES } from "@/lib/ramp/client";

export const metadata: Metadata = {
  title: "JobFlex · Ramp integration guide",
  description: "Connect Ramp to JobFlex: every card swipe, receipt and vendor bill on the right job. Setup, everyday use, and answers to common questions.",
  alternates: { canonical: "/integrations/ramp" },
};

// THE RAMP GUIDE FOR CONTRACTORS (2026-11-01) — the setup guide and FAQ Ramp asks partners to publish. Every step and
// message here is the product's own (panes/ramp-connection, ramp-cards-section, financials ramp-card-spend, lib/ramp);
// change this page when those change. The guide for Ramp's own support team is /integrations/ramp/support.
export default function RampGuidePage() {
  return (
    <LegalPage title="Ramp × JobFlex" kicker="JobFlex / Integrations / Ramp" summary="Every Ramp card swipe, receipt and vendor bill on the right job. How to connect, how it works day to day, and what to do when something looks wrong." updated={LEGAL_UPDATED.rampGuide}>
      <h2 id="what">1. What it does</h2>
      <ul>
        <li><strong>Card spend on jobs.</strong> JobFlex adds a &ldquo;JobFlex job&rdquo; field to your Ramp with your open jobs as
          its choices. When a tech swipes and picks the job, the purchase lands on that job&apos;s expenses in JobFlex, with
          the receipt and the cardholder&apos;s name.</li>
        <li><strong>A text when the job is missing.</strong> If a swipe comes in with no job, the tech gets a text from your
          company&apos;s line asking which job. Their reply books it.</li>
        <li><strong>Splits and refunds.</strong> One receipt for two jobs becomes one expense per job. Refunds come back as
          negative lines, and an amount that changes when a charge clears is corrected on the job.</li>
        <li><strong>Vendor bills.</strong> Create a bill in Ramp from JobFlex, coded to the job with the invoice attached.
          When Ramp pays it, the payment is on the job.</li>
        <li><strong>Crew cards.</strong> Give a crew member a Ramp card with a monthly limit, and freeze or unfreeze cards,
          without leaving JobFlex.</li>
      </ul>
      <p>Your accounting export stays on Ramp&apos;s side, so nothing is entered twice.</p>

      <h2 id="before">2. Before you start</h2>
      <ul>
        <li>A Ramp business account, and you are an <strong>admin</strong> in it.
          No Ramp yet? <a href="https://ramp.com" rel="noopener">Open an account at ramp.com</a>.</li>
        <li>You are an <strong>owner or manager</strong> in your JobFlex workspace.</li>
        <li>For texts to techs: each crew member&apos;s mobile number in JobFlex, and the same email or mobile number on
          their Ramp profile, so JobFlex can tell who swiped.</li>
        <li>For vendor bills: a bank account set up under Bill Pay in Ramp.</li>
      </ul>

      <h2 id="connect">3. Connect Ramp</h2>
      <ol>
        <li>In JobFlex, open <strong>Settings → Integrations / Payments → Ramp cards</strong>.</li>
        <li>Click <strong>Connect Ramp</strong>.</li>
        <li>Sign in to Ramp if asked. Pick the business entity to connect, review what JobFlex will be allowed to do,
          and click <strong>Allow</strong>.</li>
        <li>You are back in JobFlex and the card says <strong>Connected</strong>, with your Ramp business&apos;s name.</li>
      </ol>
      <p>
        Right away, JobFlex adds the &ldquo;JobFlex job&rdquo; field to your Ramp and brings in the last 30 days of card
        spend. From then on it reads new swipes the moment Ramp sends them, with a check every hour as a safety net.
        <strong> Sync now</strong> reads them right away.
      </p>
      <p>
        If your Ramp is already connected to an accounting system such as QuickBooks, Ramp shows a yellow warning about
        <code>accounting:write</code>. JobFlex uses it only for the &ldquo;JobFlex job&rdquo; field and its options; it does
        not change your accounting provider or its sync.
      </p>

      <h2 id="daily">4. Day to day</h2>
      <h3 id="swipes">Swipes and receipts</h3>
      <p>
        The tech buys with their Ramp card and picks the job in Ramp (and adds the receipt photo). The purchase appears on
        that job&apos;s expenses, approved, and your activity trail reads like &ldquo;Ramp card: $212.40 at Home Depot on
        Smith roof — Mike&rdquo;. Choose <strong>Stock / warehouse</strong> for materials that are not for a job yet.
      </p>
      <h3 id="texts">When the job is missing</h3>
      <p>The tech gets a text like:</p>
      <p><code>Your Company: $212.40 at Home Depot on the Ramp card — which job? Reply 1 Smith roof · 2 Lopez deck · S stock. Or the job&apos;s name.</code></p>
      <p>
        They reply with the number, <strong>S</strong> for stock, the job&apos;s name, or <strong>none</strong> to leave it
        for the office. Up to six jobs are listed. Until it is answered, the swipe waits in <strong>Financials → Expenses →
        Card spend · Ramp</strong>, where the office can use <strong>Pick a job…</strong> or <strong>Split…</strong>.
      </p>
      <h3 id="bills">Vendor bills</h3>
      <ol>
        <li>Go to <strong>Financials → Expenses → Vendor bills · Ramp → Pay a vendor bill</strong>.</li>
        <li>Pick the vendor, or <strong>New vendor…</strong> with their name and email (Ramp asks them for bank details).</li>
        <li>Enter the invoice number, amount, dates, the job (or Stock / warehouse, or the company), and attach the invoice.
          Ramp accepts invoices as PDF, up to 10 MB.</li>
      </ol>
      <p>
        By default the bill goes to Ramp&apos;s inbox and someone approves it there before anything is paid. With the switch
        <strong> Bills from JobFlex are approved — Ramp pays them</strong>, it goes in approved and Ramp pays it on the due
        date. <strong>Where it stands</strong> shows each bill&apos;s status, and <strong>Open in Ramp</strong> takes you to it.
      </p>
      <h3 id="cards">Crew cards</h3>
      <p>
        On the Ramp cards page, <strong>Give a card</strong>: pick the person (or someone else, with their email), set a
        monthly limit from $50 to $100,000 and an optional per-purchase limit, and the shipping address. Ramp invites them
        by email if they are not in your Ramp yet, creates a &ldquo;JobFlex · name&rdquo; limit, and ships a physical card.
        Freeze or unfreeze any card from the same list.
      </p>
      <h3 id="switches">Switches</h3>
      <ul>
        <li><strong>Ramp asks the job on every swipe</strong> (on when you connect): makes the JobFlex job field required
          in Ramp, so the tech picks it in Ramp&apos;s own prompt.</li>
        <li><strong>Text the tech when a swipe has no job:</strong> sends the text above from your company&apos;s line.</li>
        <li><strong>Bills from JobFlex are approved — Ramp pays them:</strong> off sends bills to Ramp&apos;s inbox for
          approval; on sends them approved.</li>
      </ul>

      <h2 id="disconnect">5. Disconnect</h2>
      <p>
        On the Ramp cards page, click <strong>Disconnect</strong>. JobFlex removes its webhook from your Ramp, revokes its
        access, and deletes the stored connection. Expenses already on jobs stay; new swipes stop arriving. You can also
        remove JobFlex from your integration settings in Ramp.
      </p>

      <h2 id="permissions">6. What JobFlex is allowed to do</h2>
      <p>JobFlex asks Ramp for these permissions only. It never sees full card numbers.</p>
      <table>
        <thead><tr><th>Permission</th><th>What JobFlex uses it for</th></tr></thead>
        <tbody>
          {RAMP_SCOPES.map((s) => <tr key={s}><td><code>{s}</code></td><td>{RAMP_SCOPE_USES[s]}</td></tr>)}
        </tbody>
      </table>

      <h2 id="faq">7. Questions and fixes</h2>
      <h3>Ramp says &ldquo;An admin must connect this app&rdquo;</h3>
      <p>Only a Ramp admin can connect JobFlex. Ask your Ramp admin to click Connect Ramp, or to make you an admin.</p>
      <h3>&ldquo;Ramp was not connected&rdquo;</h3>
      <ul>
        <li><em>Access was declined:</em> Cancel was clicked on Ramp&apos;s screen. Nothing changed; click Connect Ramp again.</li>
        <li><em>The sign-in took too long or was opened from another tab:</em> start again from the Ramp cards page, in the same tab.</li>
        <li><em>Ramp did not complete the authorization:</em> try again in a minute. If it keeps failing, write to us.</li>
      </ul>
      <h3>The card says &ldquo;Live updates waiting for Ramp to verify&rdquo;</h3>
      <p>Ramp has not confirmed JobFlex&apos;s live-update link yet. Swipes still arrive with the hourly check, and Sync now reads them right away.</p>
      <h3>The card says &ldquo;Ramp needs attention&rdquo;</h3>
      <p>Usually Ramp stopped renewing JobFlex&apos;s access (for example, it was removed in Ramp). Click Disconnect, then Connect Ramp again.</p>
      <h3>A swipe is missing</h3>
      <p>Click Sync now. On first connect JobFlex reads the last 30 days; older swipes are not imported.</p>
      <h3>The tech did not get a text</h3>
      <p>Check that the text switch is on, that the crew member has a mobile number in JobFlex, and that their Ramp profile has the same email or mobile number.</p>
      <h3>&ldquo;Ramp has no bill-pay bank account on this business yet&rdquo;</h3>
      <p>Add a bank account under Bill Pay in Ramp, or turn off the approved-bills switch so bills go to Ramp&apos;s inbox.</p>
      <h3>Does this change my QuickBooks or other accounting sync?</h3>
      <p>No. JobFlex only adds and maintains the &ldquo;JobFlex job&rdquo; field. Your accounting export stays on Ramp&apos;s side.</p>

      <h2 id="help">8. Help</h2>
      <p>
        Write to <LegalContact /> with your company name and what you see on the Ramp cards page. How we protect your data:{" "}
        <Link href="/security">Security</Link>.
      </p>
    </LegalPage>
  );
}
