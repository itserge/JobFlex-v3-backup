// THE INVESTORS' PAGE — /investors/<token> (2026-10-06): the live figures the
// owner shares, with no admin around them. Open to anyone holding the link
// while the link is switched on (lib/investors); a stale or switched-off
// link gets a plain "not active" page. Search engines are told to stay out.
//
// WHO IS READING (owner, 2026-10-13): the figures open once the reader says
// who they are — name, company, what they do, an email — and we hear about it
// (lib/investorVisitors); this browser keeps a pass for the link. At the top,
// "We accept VC offers" sends a short offer to us. The door is for everyone
// (owner, 2026-10-14): a signed-in admin goes through it too and sees the page
// as a reader does — their entry marked as a test, told to nobody.
//
// AND WAITS FOR OUR YES (owner, 2026-10-20): with approvals on, a reader who
// introduced themselves waits here (InvestorWaiting) until an admin approves on
// /admin/investors; the page opens on its own then. ?open= carries a word back
// from an open link that could not open (cut short, or not approved).
//
// BESIDE IT (owner, 2026-10-25): the pitch deck (./pitch) and the platform tour (./tour), behind the same door
// (./reader) and reached from the tabs under the greeting.
//
// IN THIS ORDER (owner, 2026-10-25, "organize the investors link: the video on top, below it the pitch deck, at the
// very bottom the statistics; how much money we need on top, more visible"): the raise first, big; the pitch film;
// the deck itself, inline (its own page stays for a full screen); the figures last.
import type { Metadata } from "next";
import { forReaders, investorReport } from "@/lib/investors";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { readInvestorPitch } from "@/lib/investorPitch";
import { buildPitchData } from "@/lib/investorPitchData";
import { INVESTING_KINDS } from "@/lib/investorGate";
import { InvestorReportView } from "@/components/v3/admin-investors/investor-report";
import { InvestorFilm } from "@/components/v3/admin-investors/investor-film";
import { PitchDeck } from "@/components/v3/investor-deck/pitch-deck";
import { VcOfferButton } from "@/components/v3/investor-gate/investor-gate";
import { longDate } from "@/lib/investorModel";
import { InvestorTop, investorReader } from "./reader";
import s from "./investors-public.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Investor figures", robots: { index: false, follow: false } };

export default async function InvestorsPublicPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ open?: string }> }) {
  const { token } = await params;
  const { open: openWord } = await searchParams;
  const door = await investorReader(token, { openWord, countVisit: true });
  if ("door" in door) return door.door;
  // The reader's copy: the page's own figures, nothing that carries the no-card days' money (2026-10-25).
  const [report, plans, pitch] = await Promise.all([investorReport().then(forReaders), getPlanCatalog().catch(() => []), readInvestorPitch()]);
  const data = buildPitchData(token, report, plans, pitch);
  const ask = data.words.ask;
  const visitor = door.visitor;
  const who = { name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone };
  const lead = INVESTING_KINDS.has(visitor.kind);
  return (
    <main className={s.page}>
      <div className={s.frame}>
        <InvestorTop token={token} visitor={visitor} page="figures" />

        {/* The raise, first and big. */}
        <section className={s.raise} data-raise aria-label="The raise">
          <div className={s.raiseKicker}>The raise</div>
          <h1 className={s.raiseTitle}>{ask[0]}</h1>
          {ask.length > 1 ? <ul className={s.raisePoints}>{ask.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
          <div className={s.raiseActs}>
            <VcOfferButton token={token} visitor={who} lead={lead} />
            <span className={s.raiseNote}>Indicative offers are welcome. The founding team, the company structure and the cap table are shared with shortlisted investors after the founders&apos; review.</span>
          </div>
        </section>

        {/* The pitch, as a film. */}
        <InvestorFilm deckHref="#deck" tourHref={`/investors/${token}/tour`} />

        {/* The deck, right here. */}
        <section className={s.block} id="deck" data-deck-inline aria-label="The pitch deck">
          <div className={s.blockHead}>
            <h2 className={s.h2}>The pitch deck</h2>
            <p className={s.blockSub}>Who we are, what JobFlex is worth to a contractor, and how it earns. Arrow keys or a swipe turn it; F or Full screen gives it the whole screen. The traction on it is read live.</p>
          </div>
          <PitchDeck data={data} offer={<VcOfferButton key="offer" token={token} visitor={who} lead={lead} />} />
        </section>

        {/* The figures, last. */}
        <section className={s.block} id="figures" data-figures aria-label="The figures">
          <div className={s.blockHead}>
            <h2 className={s.h2}>Ads, trials and payback</h2>
            <p className={s.blockSub}>Day {report.launch.day.toLocaleString("en-US")} since JobFlex launched on {longDate(report.launch.date)}. {report.figures.since !== report.startDay ? <>Live figures since {longDate(report.figures.since)}, from when every trial needed a card.</> : <>Live figures since {longDate(report.figures.since)}, the day the first campaign went live.</>} Read {new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</p>
            <a className={s.pdf} href={`/api/investors/${token}/pdf`}>Download PDF</a>
          </div>
          <InvestorReportView report={report} shared />
        </section>
      </div>
    </main>
  );
}
