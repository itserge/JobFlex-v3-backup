// "SWITCH TO JOBFLEX" (2026-11-16, CRM migration plan part 3 — the owner: public pages + in the app). /switch and
// /switch/<program>: for a contractor on Housecall Pro, Jobber, ServiceTitan, Workiz, JobNimbus, QuickBooks or a
// spreadsheet — what comes over, what does not, the two ways to move (yourself: that program's export steps, checked
// against its own help center; or "Do it for me": free, within 2 business days), and the questions people ask. No
// prices and no claims about the other programs — only what JobFlex does. Server components; the one client piece
// remembers the program for the Welcome page (./moving-cookie).
//
// Every fact here is the product's own: lib/import/sources (steps), lib/import/requests (the promise), the import page
// and its handbook entry. Change this page when those change.

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { REGISTER } from "@/components/v3/landing-e/routes";
import { PROMISE } from "@/lib/import/requests";
import { SWITCH_SOURCES, type SourceInfo } from "@/lib/import/sources";
import { MovingCookie } from "./moving-cookie";
import s from "./switch.module.css";

/** "Housecall Pro" — or, for the spreadsheet page, words that read in a sentence. */
export const programName = (src: SourceInfo) => (src.id === "OTHER" ? "a spreadsheet or another program" : src.label);
const programShort = (src: SourceInfo) => (src.id === "OTHER" ? "your old program" : src.label);

export function SwitchChrome({ children }: { children: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.bar}>
        <div className={s.barIn}>
          <Link href="/" className={s.brand} aria-label="JobFlex home">
            <Image src="/jobflex-mark.png" alt="" width={36} height={36} className={s.mark} priority />
            <span>JobFlex</span>
          </Link>
          <nav className={s.nav} aria-label="JobFlex">
            <Link href="/pricing">Pricing</Link>
            <Link href="/auth/login">Sign in</Link>
            <Link href={REGISTER} className={s.cta}>
              Start free trial
            </Link>
          </nav>
        </div>
      </header>
      <main className={s.main}>{children}</main>
      <footer className={s.foot}>
        <div className={s.footIn}>
          <nav className={s.footNav} aria-label="More">
            <Link href="/switch">Switch to JobFlex</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/security">Security</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
          <p className={s.fine}>
            {SWITCH_SOURCES.filter((x) => x.id !== "OTHER").map((x) => x.label).join(", ")} are trademarks of their owners. JobFlex is not affiliated with them; their names are used only to say where your files come from.
          </p>
        </div>
      </footer>
    </div>
  );
}

const COMES_OVER: Array<[string, string]> = [
  ["Every client", "Names, phones, emails, addresses, tags and notes. A client you already have in JobFlex is joined, not doubled."],
  ["Unpaid invoices", "What each client still owes, with the due date, on their page and in your money owed."],
  ["Upcoming jobs", "On your JobFlex calendar at the right time, in your own time zone."],
  ["Job history", "Past jobs, invoices and estimates on each client's page, and what they've paid you counted in their lifetime value."],
  ["“Do not contact”", "A client who asked not to be contacted is marked, and isn't emailed."],
];

function faq(src: SourceInfo | null): Array<[string, string]> {
  const p = src ? programShort(src) : "your old program";
  return [
    ["Is anything sent to my clients?", "No. Bringing clients in never sends a text, an email, a reminder or a review request. Texts from JobFlex still need each client's own consent."],
    ["Can I undo it?", "Yes. Every import has an Undo that takes back what it brought. Anything you've worked on since — a proposal, a job, a payment — stays."],
    [`Do you need my ${p} password?`, `No, never. You export the files from ${p} yourself, and send them to us only from inside JobFlex.`],
    ["What does it cost?", "Nothing. Bringing your clients over is free — yourself or with “Do it for me”, on every plan and during your free trial. Your plan's client limit applies."],
    ["What happens to the files I send you?", "They stay private, and they're deleted from our storage as soon as your clients are in."],
    ["Can I bring the same file twice?", "Yes. Records already in JobFlex are left as they are; only what's new comes in. Handy when you export the rest of your jobs later."],
  ];
}

function FaqBlock({ src }: { src: SourceInfo | null }) {
  const items = faq(src);
  return (
    <section className={s.section} aria-labelledby="faq">
      <h2 id="faq" className={s.h2}>
        Questions people ask
      </h2>
      <dl className={s.faq}>
        {items.map(([q, a]) => (
          <div key={q}>
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        ))}
      </dl>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }).replace(/</g, "\\u003c") }} />
    </section>
  );
}

function Ctas({ src }: { src: SourceInfo | null }) {
  return (
    <div className={s.ctas}>
      <Link href={REGISTER} className={s.btnPrimary} data-switch-cta="">
        Start free trial
      </Link>
      <Link href={`/dashboard/clients/import${src?.slug ? `?from=${src.slug}` : ""}`} className={s.btn}>
        Already on JobFlex? Bring your clients
      </Link>
    </div>
  );
}

export function SwitchProgramPage({ src }: { src: SourceInfo }) {
  const name = programName(src);
  const short = programShort(src);
  return (
    <SwitchChrome>
      <MovingCookie source={src.id} />
      <section className={s.hero}>
        <p className={s.kicker}>Switch to JobFlex</p>
        <h1 className={s.h1}>Moving from {name}? Bring everything with you.</h1>
        <p className={s.lead}>
          Your clients, their unpaid invoices, your upcoming jobs and your job history come over from the files {short} exports — yourself in about 10 minutes, or send them to us and we do it for you, free, {PROMISE}.
        </p>
        <Ctas src={src} />
      </section>

      <section className={s.section} aria-labelledby="comes">
        <h2 id="comes" className={s.h2}>
          What comes over
        </h2>
        <ul className={s.grid}>
          {COMES_OVER.map(([t, d]) => (
            <li key={t} className={s.card}>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ul>
        <p className={s.note}>
          <b>What doesn&apos;t:</b> photos, text messages and call recordings aren&apos;t in {src.id === "OTHER" ? "most programs'" : `${src.label}'s`} export files. Keep your {short} account until you&apos;ve saved what you need.
        </p>
      </section>

      <section className={s.section} aria-labelledby="ways">
        <h2 id="ways" className={s.h2}>
          Two ways to move
        </h2>
        <div className={s.ways}>
          <div className={s.way}>
            <p className={s.wayTag}>Yourself · about 10 minutes</p>
            <h3 className={s.h3}>Get your files out of {src.id === "OTHER" ? "your program" : src.label}</h3>
            <ol className={s.steps}>
              {src.steps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
            <p className={s.small}>Bring: {src.files}</p>
            <p className={s.small}>
              Then in JobFlex: <b>Clients → Bring your clients → {src.id === "OTHER" ? "A spreadsheet or another program" : src.label}</b> → drop the files. You see exactly what comes in before anything is saved, and every import can be undone.
            </p>
            {src.checked && src.checked !== "yes" ? <p className={s.small}>Menus as {src.label}&apos;s own help center described them in November 2026. If yours look different, send us what you have — we&apos;ll do it for you.</p> : null}
          </div>
          <div className={`${s.way} ${s.wayAlt}`}>
            <p className={s.wayTag}>Do it for me · free</p>
            <h3 className={s.h3}>Send us the files — we bring your clients in</h3>
            <ol className={s.steps}>
              <li>Start your free trial (or sign in).</li>
              <li>
                <b>Clients → Bring your clients → Do it for me</b>, and send the files {short} gave you — any of them, an old Excel or a Numbers file too.
              </li>
              <li>Our team brings them in {PROMISE} and emails you. Check them, and undo it if anything looks wrong.</li>
            </ol>
            <p className={s.small}>Free on every plan, during your trial too. We never ask for your {short} password.</p>
          </div>
        </div>
        <Ctas src={src} />
      </section>

      <FaqBlock src={src} />

      <section className={s.section} aria-labelledby="others">
        <h2 id="others" className={s.h2}>
          Coming from somewhere else?
        </h2>
        <ul className={s.chips}>
          {SWITCH_SOURCES.filter((x) => x.id !== src.id).map((x) => (
            <li key={x.id}>
              <Link href={`/switch/${x.slug}`}>{x.id === "OTHER" ? "A spreadsheet or another program" : x.label}</Link>
            </li>
          ))}
        </ul>
      </section>
    </SwitchChrome>
  );
}

export function SwitchIndexPage() {
  return (
    <SwitchChrome>
      <section className={s.hero}>
        <p className={s.kicker}>Switch to JobFlex</p>
        <h1 className={s.h1}>Bring your clients from the program you use now.</h1>
        <p className={s.lead}>
          Clients, unpaid invoices, upcoming jobs and job history come over from the files your program exports — yourself in about 10 minutes, or send them to us and we do it for you, free, {PROMISE}. Nothing is sent to your clients, and every import can be undone.
        </p>
        <Ctas src={null} />
      </section>
      <section className={s.section} aria-labelledby="from">
        <h2 id="from" className={s.h2}>
          Where are you moving from?
        </h2>
        <ul className={s.tiles}>
          {SWITCH_SOURCES.map((x) => (
            <li key={x.id}>
              <Link href={`/switch/${x.slug}`} className={s.tile} data-switch-tile={x.slug ?? ""}>
                <b>{x.id === "OTHER" ? "A spreadsheet or another program" : x.label}</b>
                <span>How to move →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className={s.section} aria-labelledby="comes">
        <h2 id="comes" className={s.h2}>
          What comes over
        </h2>
        <ul className={s.grid}>
          {COMES_OVER.map(([t, d]) => (
            <li key={t} className={s.card}>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </section>
      <FaqBlock src={null} />
    </SwitchChrome>
  );
}
