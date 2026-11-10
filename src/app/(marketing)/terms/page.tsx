import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage } from "@/components/legal/legal-page";
import { LEGAL_OPERATOR_NAME, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "JobFlex · Terms of service",
  description: "Terms for JobFlex accounts, subscriptions, estimating tools, proposals, and connected email.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  // The trial sentence holds on either path (owner, 2026-10-07): whether the
  // trial takes a card is the plan step's answer (lib/trialPolicyServer
  // signupTrialMode), which the owner can switch at any time — the terms say
  // where to read it instead of following the switch.
  return (
    <LegalPage title="Terms of service" number="02" summary="The agreement for your workspace, subscriptions, business documents, and connected services." updated={LEGAL_UPDATED.terms}>
      <p>
        These terms govern JobFlex, operated by {LEGAL_OPERATOR_NAME}, operating as JobFlex in
        Washington, United States (&ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or otherwise
        agreeing to these terms, you enter this agreement. If acting for a business, you represent that
        you can bind it. Our <Link href="/privacy">Privacy policy</Link> explains information handling.
        Accepting these terms is not consent to every optional tracker or integration.
      </p>
      <h2>1. Eligibility and accounts</h2>
      <p>
        You must be at least 18 and legally able to enter this agreement to create a business account.
        Provide accurate details, protect credentials, and promptly report suspected unauthorized access
        to <LegalContact />. You are responsible for users you authorize and their use of the workspace,
        subject to applicable law. Administrators control access and integrations; removing a member does
        not necessarily remove shared business records.
      </p>
      <h2>2. Subscriptions, trials, and cancellation</h2>
      <p>
        Your plan and checkout specify pricing, billing intervals, features, limits, applicable taxes,
        and any trial. An authorized recurring subscription renews at the disclosed interval until
        canceled. Whether a payment method is required to start the trial is shown at the plan step
        when you sign up. Promotional free trials may last from 1 to 14 days, including offers tested with different signup groups. The exact duration offered to you is shown before enrollment and confirmed at checkout; that duration governs your trial. We do not shorten an existing trial because an offer or experiment changes. Nothing is charged during your free trial. With a payment method on file,
        the price of the plan you chose is first charged when the trial ends, unless you cancel
        beforehand; without one, the trial ends without a charge and the account moves to the free
        plan until a paid plan is chosen.
      </p>
      <p>
        Cancel through the Subscription page in your account or contact <LegalContact /> for help. Cancellation normally
        stops the next renewal and leaves access through the paid period, as shown in the cancellation
        confirmation. Canceling a subscription and deleting an account are separate actions. Save needed
        records before closing your account.
      </p>
      <p>
        JobFlex is a subscription, and charges are non-refundable. You can cancel at any time, and
        cancellation stops the next charge. Your trial, and then each billing period, is your time to
        cancel before the next charge: a charge made because the subscription was not canceled
        beforehand is not refunded, in whole or in part, and unused time is not credited. The only
        exceptions are where the law requires a refund or where we expressly offer one in writing.
        Mandatory cancellation, refund, and renewal-notice rights remain in effect. We will give at
        least 30 days&apos; notice of a subscription price increase before it applies to your next
        renewal and obtain additional agreement where required by law.
      </p>
      <h2>3. Contractor payments and providers</h2>
      <p>
        Payments for contractor work are separate from your JobFlex subscription. The contractor is
        responsible for pricing, taxes, work, refunds, disputes, licenses, and its customer agreement.
        Processors may charge their fees and any platform fee disclosed for the transaction or
        integration. Their terms, verification requirements, and availability apply. JobFlex does not
        guarantee merchant-account approval, payment settlement, or recovery of funds.
      </p>
      <h2>4. Connected Gmail and communications</h2>
      <p>
        Connect only an account you may lawfully use. Google authorization allows JobFlex to send email
        through that account and identify its address; this integration does not request inbox-reading or
        contact-import permissions. The connection serves the organization&apos;s workspace. Authorized
        actions and configured workflows may send proposals, invoices, reminders, follow-ups, review
        requests, and related messages. Review recipients, content, workspace permissions, and automation settings.
      </p>
      <p>
        Supported workflows may fall back to JobFlex&apos;s email provider when Gmail is unavailable,
        disconnected, or a send fails. Delivery, timing, inbox placement, and freedom from duplicate
        messages are not guaranteed. Google or other providers may limit sending or suspend access.
        Disconnect in Settings → Integrations → Gmail to remove the stored connection; separately revoke
        authorization through your Google Account. Previously delivered messages remain with recipients.
      </p>
      <p>
        Do not send spam, impersonate senders, or use unlawfully obtained contact lists. Obtain required
        permissions and provide required identification, notices, and unsubscribe options. Comply with
        applicable email, SMS, telemarketing, privacy, and call-recording laws, including CAN-SPAM and
        applicable telephone-consumer-protection rules. Proposals and follow-ups are not automatically
        exempt from marketing rules. Communications to Canada may also be subject to CASL. Use recording
        features only after required notices and consents; these terms do not obtain consent from recipients.
      </p>
      <p id="sms">
        <strong>Text messages from JobFlex.</strong> When you add your own mobile number in Settings →
        Texting and confirm it with the code we text you, you agree to receive text messages at that
        number: verification codes from JobFlex, and the job alerts you turn on for your account, such
        as a new lead, an accepted proposal, a payment, or your crew on site, sent from your company&apos;s
        own texting number under your company&apos;s name. If your company turns on lead texts on
        the Texting page, JobFlex also texts the company phone when a lead is reserved for it. Message frequency varies
        with your account&apos;s activity. Message and data rates may apply. Reply STOP to cancel at any
        time or HELP for help, or remove your number on the Texting page. Questions: <LegalContact />.
        Carriers are not liable for delayed or undelivered messages. We do not text you marketing. Our{" "}
        <Link href="/privacy#sms">Privacy policy</Link> explains how mobile numbers are handled.
      </p>
      <h2>5. Your content and other people&apos;s data</h2>
      <p>
        You retain your content rights and grant us the limited permission needed to host, process,
        transmit, and display content to provide the service and follow your instructions. You must have
        the rights and lawful basis to upload other people&apos;s information, invite workers, publish
        photos or reviews, and share documents. Provide appropriate notices and permissions, minimize
        personal information, and respond to requests about data you control.
      </p>
      <p>
        Where we process personal information for your business, each party must meet its applicable
        controller, processor, business, or service-provider obligations. These terms do not replace a
        data-processing agreement where one is required. Contact us before processing that requires
        additional contractual safeguards. Do not put passwords, full card details, Social Security
        numbers, or regulated medical information into general project, message, or AI-input fields.
      </p>
      <h2>6. Estimates, automated outputs, and contracts</h2>
      <p>
        Estimates, aerial measurements, parcel boundaries, AI-generated content, suggested prices, tax
        calculations, and schedules are aids for your review. Data may be incomplete or outdated and
        automated outputs can be wrong. <strong>Verify measurements, quantities, site conditions,
        prices, taxes, and requirements before signing contracts, ordering materials, or committing to
        work.</strong> Property imagery and generated boundaries are not legal surveys.
      </p>
      <p>
        JobFlex does not provide engineering, surveying, legal, tax, or other licensed professional
        advice. You are responsible for documents you approve or send, permits and consumer notices,
        and the enforceability of your contracts. Proposal-acceptance tools do not guarantee compliance
        with every jurisdiction&apos;s signature, disclosure, or cancellation requirements.
      </p>
      <h2>7. Homeowner requests and public content</h2>
      <p>
        Contracts for work are between contractors and their customers. JobFlex is not their contractor,
        employer, insurer, or guarantor. Reviews, trade-network posts, and other shared content must be
        lawful, truthful, and respect others&apos; rights. We may remove content or restrict access for
        violations or security reasons, consistent with applicable law. Do not publish information you
        lack permission to make public.
      </p>
      <h2>8. Acceptable use and software rights</h2>
      <p>
        Do not misuse accounts, evade access or plan limits, distribute malware, disrupt the service,
        unlawfully scrape information, infringe rights, or engage in illegal or deceptive conduct. Do not
        resell access without our agreement. You may use JobFlex for its intended business purposes,
        subject to these terms. JobFlex and its licensors retain rights to the software, design, and
        branding; you retain rights to your content.
      </p>
      <h2>9. Availability and termination</h2>
      <p>
        Features depend on your plan, configuration, and external providers. We may update features or
        perform maintenance and do not promise uninterrupted service. We may suspend or terminate access
        for material violations, nonpayment, security threats, or legal requirements. Where practical
        and legally permitted, we will provide notice and an opportunity to address the issue.
        Mandatory rights concerning paid access, changes, and refunds remain in effect.
      </p>
      <p>
        You can stop using JobFlex and close your account. Deletion may be irreversible, affect an
        organization where you are the only member, and leave records independently held by others.
        The Privacy policy explains retention. Terms concerning accrued payments, permissions needed
        for retained records, disclaimers, liability, and disputes survive where necessary to give them effect.
      </p>
      <h2>10. Warranties and liability</h2>
      <p>
        To the extent permitted by law, JobFlex is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo;
        without implied warranties of merchantability, fitness for a particular purpose, or
        non-infringement. We do not warrant estimates or third-party information.
      </p>
      <p>
        To the extent permitted by law, JobFlex and its suppliers are not liable for indirect, incidental,
        special, or consequential damages or lost profits arising from the service. Our aggregate
        liability is limited to the amounts you paid JobFlex for the service during the 12 months before
        the event giving rise to the claim. These limits do not apply to fraud, willful misconduct, or
        liability that law does not allow us to exclude or limit. Nothing waives non-waivable consumer
        or privacy rights.
      </p>
      <h2>11. Governing law and disputes</h2>
      <p>
        Washington law governs, excluding its conflict-of-laws rules, except where mandatory law requires
        otherwise. Subject to non-waivable rights to another forum, disputes may be brought in Washington
        state or federal courts with jurisdiction. Contact <LegalContact /> to try to resolve concerns;
        doing so is not a condition on statutory rights. These terms do not impose mandatory arbitration
        or a class-action waiver. If a provision is unenforceable, the remainder continues to apply.
      </p>
      <h2>12. Changes and contact</h2>
      <p>
        We will notify account holders of material changes by email or in the product at least 14 days
        before they take effect, or longer where required. Urgent security or legally required changes
        may take effect sooner. We will obtain affirmative agreement when law requires; continued use
        does not replace legally required consent. Questions: <LegalContact />.
      </p>
    </LegalPage>
  );
}
