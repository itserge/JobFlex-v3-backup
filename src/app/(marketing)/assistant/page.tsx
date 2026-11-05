import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage } from "@/components/legal/legal-page";
import { LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "JobFlex Assistant · Text or talk to run your business",
  description: "How JobFlex subscribers text and talk to the JobFlex Assistant: how a phone is linked, what the texts are, how often they come, and how to stop them.",
  alternates: { canonical: "/assistant" },
};

// THE JOBFLEX ASSISTANT, IN PUBLIC (2026-11-04) — the page the toll-free verification's opt-in links to, and the
// one the contact card points at. Every step and message here is the product's own (components/v3/assistant/
// assistant-settings, lib/assistant/sms SMS_WORDS, lib/assistant/phone); change this page when those change.
export default function AssistantPage() {
  return (
    <LegalPage
      title="JobFlex Assistant"
      kicker="JobFlex / Assistant"
      summary="Run your JobFlex business by talking or texting. How a contractor links their phone, what the Assistant texts, how often, and how to stop it."
      updated={LEGAL_UPDATED.assistant}
    >
      <h2 id="what">1. What it is</h2>
      <p>
        The JobFlex Assistant is part of JobFlex, the software contractors use to run their business. A JobFlex subscriber asks it about their
        day or tells it what to do — send a proposal, put a job on the calendar, text their crew, remind a client to pay — in the app, by text
        message, or by phone. It reads every change back and does nothing until the subscriber answers YES.
      </p>
      <p>The Assistant texts only JobFlex subscribers who linked their own phone to it. It never texts their clients or anyone else, and it sends no marketing.</p>

      <h2 id="optin">2. How a phone is linked (opt-in)</h2>
      <ol>
        <li>
          The subscriber signs in to JobFlex and opens <strong>Settings → Assistant</strong>, then taps <strong>Link my phone</strong>.
        </li>
        <li>JobFlex shows a six-digit code and the Assistant&apos;s number, with these words under the code:</li>
      </ol>
      <blockquote>
        By texting the code you agree to get texts from the JobFlex Assistant about your JobFlex account and answers to what you ask. How many
        depends on you. Msg &amp; data rates may apply. Reply STOP to stop, HELP for help. Terms · Privacy · How it works
      </blockquote>
      <ol start={3}>
        <li>The subscriber texts the code from their own phone to the Assistant&apos;s number. Texting the code is their consent; the code works once, for 15 minutes.</li>
        <li>The Assistant answers once to confirm:</li>
      </ol>
      <blockquote>
        JobFlex Assistant: this phone is now linked to Dmitriy at Summit Ridge Roofing. Text me what you need — &ldquo;what&apos;s on
        tomorrow?&rdquo;, &ldquo;send the Smith proposal&rdquo;. I read every change back first. Save me to your contacts: (link) Msg &amp; data
        rates may apply. Reply HELP for help, STOP to stop.
      </blockquote>
      <p>A phone that never texted a code gets no texts, except one reply explaining how to link if it texts the number.</p>

      <h2 id="messages">3. The texts</h2>
      <p>Every text is an answer to something the subscriber asked, or the result of a change they approved. Examples:</p>
      <ul>
        <li>&ldquo;Fri, Nov 6: Johnson roof 8 AM to 12 PM (Mike Diaz); Lee fence 9 AM to 2 PM.&rdquo;</li>
        <li>&ldquo;Send &lsquo;Smith roof replacement&rsquo; ($16,164) to John Smith at john@example.com. Reply YES to do it, or NO.&rdquo;</li>
        <li>&ldquo;OK — doing it in 2 minutes. Reply UNDO to stop it.&rdquo;</li>
        <li>&ldquo;Sent &lsquo;Smith roof replacement&rsquo; to John Smith. I&apos;ll tell you when they open it.&rdquo;</li>
      </ul>
      <p>
        <strong>How often:</strong> it depends on the subscriber — usually one reply for each text they send. Message and data rates may apply.
      </p>

      <h2 id="stop">4. Stopping, pausing, help</h2>
      <ul>
        <li>
          Reply <strong>STOP</strong> (or CANCEL, END, QUIT, UNSUBSCRIBE) to stop all texts from the Assistant&apos;s number. Reply{" "}
          <strong>START</strong> to turn them back on.
        </li>
        <li>
          Reply <strong>HELP</strong> for help, or write to <a href="mailto:support@jobflex.app">support@jobflex.app</a>.
        </li>
        <li>
          In JobFlex, <strong>Settings → Assistant</strong> pauses texts or unlinks the phone at any time.
        </li>
      </ul>
      <p>
        To decline a single change, reply <strong>NO</strong> — CANCEL stops all texts from the number.
      </p>

      <h2 id="privacy">5. Your information</h2>
      <p>
        The linked phone number is used only to recognise the subscriber when they text or call the Assistant. It is not sold or shared for
        marketing. See the <Link href="/privacy">Privacy policy</Link> and the <Link href="/terms">Terms</Link>.
      </p>

      <h2 id="contact">6. Contact</h2>
      <LegalContact />
    </LegalPage>
  );
}
