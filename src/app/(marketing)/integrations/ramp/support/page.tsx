import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage } from "@/components/legal/legal-page";
import { LEGAL_SECURITY_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "JobFlex · Ramp support guide",
  description: "For Ramp's support teams: how the JobFlex integration works, how to triage issues, what to collect, and how to escalate.",
  alternates: { canonical: "/integrations/ramp/support" },
  robots: { index: false },
};

// THE RAMP SUPPORT GUIDE (2026-11-01) — for Ramp's own support teams, the internal guide Ramp asks partners for.
// Linked only from the partner application; not in the sitemap. Facts from lib/ramp; the customer guide is /integrations/ramp.
export default function RampSupportGuidePage() {
  return (
    <LegalPage title="Ramp support guide" kicker="JobFlex / Integrations / Ramp / Support" summary="For Ramp's support teams: how the JobFlex integration works, how to triage what a customer reports, what to collect, and how to reach us." updated={LEGAL_UPDATED.rampSupport}>
      <h2 id="overview">1. The integration in brief</h2>
      <p>
        JobFlex is job-management software for home-service and construction contractors. A contractor&apos;s Ramp admin
        connects their Ramp business from JobFlex (OAuth authorization code). JobFlex then puts Ramp card spend, receipts
        and vendor bills onto the contractor&apos;s jobs. The customer-facing guide is{" "}
        <Link href="/integrations/ramp">jobflex.app/integrations/ramp</Link>.
      </p>
      <ul>
        <li>One JobFlex workspace connects to one Ramp business (the entity chosen on Ramp&apos;s consent screen).</li>
        <li>Only a JobFlex owner or manager can connect, disconnect or change settings.</li>
        <li>JobFlex reads transactions from a webhook it registers on connect, plus an hourly sync and a manual
          &ldquo;Sync now&rdquo;. On first connect it reads the last 30 days.</li>
      </ul>

      <h2 id="writes">2. What JobFlex creates or changes in Ramp</h2>
      <table>
        <thead><tr><th>In Ramp</th><th>What JobFlex does</th></tr></thead>
        <tbody>
          <tr><td>Accounting field &ldquo;JobFlex job&rdquo; (external id <code>jobflex_job</code>)</td><td>Created on connect, single choice, splittable. Options are the contractor&apos;s open jobs plus &ldquo;Stock / warehouse (no job)&rdquo;, refreshed on every sync. Required on transactions by default; the contractor can turn that off in JobFlex.</td></tr>
          <tr><td>Transactions</td><td>Sets the JobFlex job coding, writes line-item splits, and writes a memo with the job (for example after the cardholder answers JobFlex&apos;s text).</td></tr>
          <tr><td>Bills and vendors</td><td>Creates bills (a draft for approval by default, or approved with payment details if the contractor chose that), with the invoice PDF and job coding. Creates a vendor when the contractor pays someone new.</td></tr>
          <tr><td>Users, limits and cards</td><td>Invites a crew member, creates a limit named &ldquo;JobFlex · name&rdquo; with the monthly and per-purchase amounts the contractor set, orders a physical card, and freezes or unfreezes cards.</td></tr>
          <tr><td>Webhook subscription</td><td>One per connection, deleted on disconnect.</td></tr>
        </tbody>
      </table>
      <p>JobFlex never changes the customer&apos;s accounting provider or its sync, and never requests full card numbers.</p>

      <h2 id="triage">3. Triage</h2>
      <table>
        <thead><tr><th>The customer reports</th><th>Likely cause and next step</th></tr></thead>
        <tbody>
          <tr><td>&ldquo;An admin must connect this app&rdquo; on Ramp&apos;s screen</td><td>The person connecting is not a Ramp admin. A Ramp admin must connect.</td></tr>
          <tr><td>JobFlex shows &ldquo;Ramp was not connected&rdquo;</td><td>Consent was cancelled, the sign-in took too long or was started in another tab, or the token exchange failed. Retry from JobFlex → Settings → Integrations / Payments → Ramp cards.</td></tr>
          <tr><td>&ldquo;Ramp needs attention&rdquo; in JobFlex</td><td>JobFlex could not renew its token (for example, the app was removed in Ramp). The customer clicks Disconnect, then Connect Ramp.</td></tr>
          <tr><td>&ldquo;Live updates waiting for Ramp to verify&rdquo;</td><td>The webhook has not passed verification. Transactions still arrive hourly and with Sync now. If it persists, send us the business ID.</td></tr>
          <tr><td>A swipe is not on a job in JobFlex</td><td>No JobFlex job was picked. It waits in JobFlex under Financials → Expenses → Card spend · Ramp, and the cardholder may have been texted. Sync now re-reads it.</td></tr>
          <tr><td>The JobFlex job field has old jobs</td><td>Its options are refreshed on every sync; Sync now forces one.</td></tr>
          <tr><td>The JobFlex job field was deleted in Ramp</td><td>JobFlex does not recreate it on its own. The customer clicks Disconnect, then Connect Ramp.</td></tr>
          <tr><td>A bill from JobFlex is a draft in the inbox</td><td>Expected by default: someone approves it in Ramp. The contractor can switch JobFlex to send bills approved.</td></tr>
          <tr><td>&ldquo;No bill-pay bank account&rdquo; when paying a bill</td><td>The entity has no Bill Pay bank account. Add one in Ramp, or send bills for approval instead.</td></tr>
          <tr><td>Accounting warning on the consent screen</td><td>Expected when an accounting provider is connected. JobFlex uses <code>accounting:write</code> only for its own field.</td></tr>
        </tbody>
      </table>

      <h2 id="collect">4. What to collect</h2>
      <ul>
        <li>The Ramp business name and ID, and the entity that was connected.</li>
        <li>The JobFlex company name and the email of the person who connected.</li>
        <li>Transaction, bill or card IDs involved, with the time it happened.</li>
        <li>A screenshot of JobFlex → Settings → Integrations / Payments → Ramp cards. Its status line shows when it was
          connected, the last sync, the JobFlex job field, live updates, and any error.</li>
      </ul>

      <h2 id="escalate">5. Escalate to JobFlex</h2>
      <p>
        Email <LegalContact /> with the details above. For anything security-related, such as suspected unauthorized
        access, email <a href={`mailto:${LEGAL_SECURITY_EMAIL}`}>{LEGAL_SECURITY_EMAIL}</a> directly. How JobFlex
        protects data: <Link href="/security">jobflex.app/security</Link>.
      </p>
    </LegalPage>
  );
}
