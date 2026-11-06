import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage } from "@/components/legal/legal-page";
import { LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "JobFlex AI Operator · Text or talk to run your business",
  description: "How JobFlex subscribers text and talk to the JobFlex AI Operator: how a phone is linked, what the texts are, how often they come, and how to stop them.",
  alternates: { canonical: "/assistant" },
};

// THE JOBFLEX ASSISTANT, IN PUBLIC (2026-11-04) — the page the toll-free verification's opt-in links to, and the
// one the contact card points at. Every step and message here is the product's own (components/v3/assistant/
// assistant-settings, lib/assistant/sms SMS_WORDS, lib/assistant/phone); change this page when those change.
export default function AssistantPage() {
  return (
    <LegalPage
      title="JobFlex AI Operator"
      kicker="JobFlex / AI Operator"
      summary="Run your JobFlex business by talking or texting. How a contractor links their phone, what the AI Operator texts, how often, and how to stop it."
      updated={LEGAL_UPDATED.assistant}
    >
      <h2 id="what">1. What it is</h2>
      <p>
        The JobFlex AI Operator is part of JobFlex, the software contractors use to run their business. A JobFlex subscriber asks it about their
        day or tells it what to do — price a job, send a proposal, add a client, book a visit, put a job on the calendar, text their crew, invoice a client, remind a client to pay, set a reminder — in the
        app, by text message, or by phone. Pricing a job only makes a draft proposal in the subscriber&apos;s own account, with a link for them to
        look at. Anything that reaches someone else — sending a proposal, a crew text, a payment reminder — and any change to the calendar is
        read back first, and nothing happens until the subscriber answers YES. An invoice or a financing link also asks for the subscriber&apos;s own 4-digit PIN with the YES.
      </p>
      <p>The AI Operator texts only JobFlex subscribers who linked their own phone to it. It never texts their clients or anyone else, and it sends no marketing.</p>

      <h2 id="optin">2. How a phone is linked (opt-in)</h2>
      <ol>
        <li>
          The subscriber signs in to JobFlex and opens <strong>Settings → AI Operator</strong>, then taps <strong>Link my phone</strong>.
        </li>
        <li>JobFlex shows a six-digit code and the AI Operator&apos;s number, with these words under the code:</li>
      </ol>
      <blockquote>
        By texting the code you agree to get texts from the JobFlex AI Operator about your JobFlex account and answers to what you ask. How many
        depends on you. Msg &amp; data rates may apply. Reply STOP to stop, HELP for help. Terms · Privacy · How it works
      </blockquote>
      <ol start={3}>
        <li>The subscriber texts the code from their own phone to the AI Operator&apos;s number. Texting the code is their consent; the code works once, for 15 minutes.</li>
        <li>The AI Operator answers once to confirm:</li>
      </ol>
      <blockquote>
        JobFlex AI Operator: this phone is now linked to Dmitriy at Summit Ridge Roofing. Text me what you need — &ldquo;what&apos;s on
        tomorrow?&rdquo;, &ldquo;build a 12 by 12 deck with a roof for Sarah&rdquo;, &ldquo;send the Smith proposal&rdquo;. I read every change back first. Save me to your contacts: (link) Msg &amp; data
        rates may apply. Reply HELP for help, STOP to stop.
      </blockquote>
      <p>A phone that never texted a code gets no texts, except one reply explaining how to link if it texts the number.</p>

      <h2 id="messages">3. The texts</h2>
      <p>Every text is an answer to something the subscriber asked, or the result of a change they approved. Examples:</p>
      <ul>
        <li>&ldquo;Fri, Nov 6: Johnson roof 8 AM to 12 PM (Mike Diaz); Lee fence 9 AM to 2 PM.&rdquo;</li>
        <li>
          &ldquo;Built &lsquo;12 ft × 12 ft covered deck&rsquo; for Sarah Lee: $16,068. Open it: (link) Send &lsquo;12 ft × 12 ft covered
          deck&rsquo; ($16,068) to Sarah Lee at sarah@example.com. Reply YES to do it, or NO.&rdquo;
        </li>
        <li>&ldquo;Send &lsquo;Smith roof replacement&rsquo; ($16,164) to John Smith at john@example.com. Reply YES to do it, or NO.&rdquo;</li>
        <li>&ldquo;OK — doing it in 2 minutes. Reply UNDO to stop it.&rdquo;</li>
        <li>&ldquo;Invoice Sarah Lee $8,400 for the payment on &lsquo;Lee fence&rsquo; — by card or bank, their choice, by email. Reply YES and your PIN (like YES 1234), or NO.&rdquo;</li>
        <li>&ldquo;OK — I&apos;ll remind you Fri, Nov 6 at 9:00 AM: call the inspector.&rdquo;</li>
        <li>&ldquo;Sent &lsquo;Smith roof replacement&rsquo; to John Smith. Ask me any time whether they&apos;ve opened it.&rdquo;</li>
      </ul>
      <p>
        <strong>How often:</strong> it depends on the subscriber — usually one reply for each text they send. Message and data rates may apply.
      </p>

      <h2 id="stop">4. Stopping, pausing, help</h2>
      <ul>
        <li>
          Reply <strong>STOP</strong> (or CANCEL, END, QUIT, UNSUBSCRIBE) to stop all texts from the AI Operator&apos;s number. Reply{" "}
          <strong>START</strong> to turn them back on.
        </li>
        <li>
          Reply <strong>HELP</strong> for help, or write to <a href="mailto:support@jobflex.app">support@jobflex.app</a>.
        </li>
        <li>
          In JobFlex, <strong>Settings → AI Operator</strong> pauses texts or unlinks the phone at any time.
        </li>
      </ul>
      <p>
        To decline a single change, reply <strong>NO</strong> — CANCEL stops all texts from the number.
      </p>

      <h2 id="privacy">5. Your information</h2>
      <p>
        The linked phone number is used only to recognise the subscriber when they text or call the AI Operator. It is not sold or shared for
        marketing. See the <Link href="/privacy">Privacy policy</Link> and the <Link href="/terms">Terms</Link>.
      </p>

      <h2 id="contact">6. Contact</h2>
      <LegalContact />
    </LegalPage>
  );
}
