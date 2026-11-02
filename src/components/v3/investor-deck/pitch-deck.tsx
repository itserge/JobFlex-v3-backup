"use client";
// THE PITCH DECK (owner, 2026-10-25: "a smart pitch deck — who we are and what we're doing"; then: "wide open, the
// screen… what we do, how we save time for the contractors, the value… the homeowners' portal — homeowners submit the
// projects and we charge for the leads… evaluate JobFlex as an investor would and show what they'd want to see").
// Built from what JobFlex already says about itself: the product's screens (tour-shots), the live figures the Figures
// page reads (lib/investors — the same numbers, the same words), the homeowner side as it is built — never a Lead
// Center count (owner, 2026-10-25: "don't show any lead center numbers, we are not opened yet") — the plan catalogue's
// prices, the landing page's researched comparison, and outside facts quoted
// with their sources (pitch-facts). The two calculators say they are examples. The owner's own words fill what is
// next and the raise — a slide with no words does not show. The team is never on the link (shared after a preliminary
// offer, 2026-10-25).
import { useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { TOUR_SHOTS, tourSrc } from "./tour-shots";
import { ALL_TRADE_SHOPS, FINANCING, HOURS_FACT, LEAD_PRICES, LEADER, MARKET_FACTS, type PitchSource } from "./pitch-facts";
import { useSlides } from "./use-slides";
import { useFullscreen } from "./use-fullscreen";
import s from "./investor-deck.module.css";

export interface PitchData {
  token: string;
  launch: { day: number; date: string };
  traction: {
    since: string; signups: number; paying: number; payingMrrCents: number; trialsNow: number;
    ratePct: number | null; ratePaid: number; rateEnded: number; rateLowPct: number | null; rateHighPct: number | null;
    collected: { read: boolean; cents: number; invoices: number };
    at: string;
  };
  unit: {
    spendCents: number; won: number; wonMrrCents: number; arrCents: number;
    costPerPayingCents: number | null; costPerSignupCents: number | null; paybackMonths: number | null;
    /** What the cost of a customer and the payback are counted on: the signups whose trial is over (2026-11-02). */
    matured: { through: string | null; spendCents: number; won: number; wonMrrCents: number };
    expectedPayers: number | null; expectedMrrCents: number | null;
  };
  leadPrice: { minCents: number; maxCents: number };
  deskPack: { minutes: number; cents: number };
  plans: Array<{ name: string; priceCents: number; yearlyPriceCents: number | null; trialDays: number; highlight: boolean; features: string[] }>;
  compare: {
    competitors: Array<{ id: string; name: string }>;
    rows: Array<{ id: string; label: string; detail?: string; them: Record<string, { status: string; label?: string; caveat?: string }> }>;
    caveats: Record<string, string>;
  };
  /** The owner's words: the raise and what is next. No team on the link — it is shared after a preliminary offer. */
  words: { ask: string[]; roadmap: string[] };
}

const n = (v: number) => v.toLocaleString("en-US");
const dollars = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");
const money = (cents: number | null) => (cents === null ? "—" : dollars(cents));
const price = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
const compact = (cents: number) => {
  const d = cents / 100;
  if (d >= 1e9) return `$${(d / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (d >= 1e6) return `$${(d / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (d >= 1e4) return `$${Math.round(d / 1e3)}K`;
  return `$${n(Math.round(d))}`;
};
const longDate = (iso: string) => new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const shot = (slug: string) => TOUR_SHOTS.find((x) => x.slug === slug)!;

function Shot({ slug, className, sizes = "(max-width: 860px) 92vw, 46vw" }: { slug: string; className?: string; sizes?: string }) {
  const x = shot(slug);
  return <Image draggable={false} src={tourSrc(x.slug)} alt={x.title} width={x.w} height={x.h} sizes={x.kind === "phone" ? "260px" : sizes} className={`${s.slideImg} ${className ?? ""}`} data-kind={x.kind} style={{ objectPosition: x.focus ?? "top" }} />;
}

function Sources({ list }: { list: PitchSource[] }) {
  const seen = list.filter((x, i) => list.findIndex((y) => y.url === x.url) === i);
  return (
    <p className={s.sources}>
      Sources: {seen.map((x, i) => <span key={x.url}>{i ? " · " : ""}<a href={x.url} target="_blank" rel="noreferrer">{x.label}</a></span>)}
    </p>
  );
}

function cellWords(c: { status: string; label?: string; caveat?: string } | undefined, caveats: Record<string, string>): { text: string; tone: string } {
  if (!c) return { text: "—", tone: "no" };
  if (c.status === "yes") return { text: "✓", tone: "yes" };
  if (c.status === "no") return { text: "—", tone: "no" };
  if (c.status === "paid") return { text: c.label ? `Paid · ${c.label}` : "Paid", tone: "paid" };
  if (c.status === "soon") return { text: "Soon", tone: "paid" };
  return { text: (c.caveat && caveats[c.caveat]) || "Partly", tone: "paid" };
}

/** A slider with its label and value — the calculators' one control. */
function Dial({ id, label, value, min, max, step, show, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className={s.dial} htmlFor={id}>
      <span className={s.dialHead}><span>{label}</span><output htmlFor={id}>{show(value)}</output></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} />
    </label>
  );
}

// The example shop and the example lead month — where the dials start. Examples, said so on the slide.
const SHOP_START = { estimates: 5, perEstimate: 1.5, office: 4, hourly: 75 };
const LEADS_START = { perMonth: 100, priceDollars: 50 };
// The example financing month: financed jobs, their average size, JobFlex's share (the target, 2–3%).
const FIN_START = { jobs: 40, avgDollars: 15_000, sharePct: 2.5 };

type Slide = { id: string; kicker: string; tone?: "blue" | "ink"; body: ReactNode };

export function PitchDeck({ data, offer }: { data: PitchData; offer: ReactNode }) {
  const t = data.traction;
  const u = data.unit;
  const [shop, setShop] = useState(SHOP_START);
  const [leadMonth, setLeadMonth] = useState(LEADS_START);
  const [finMonth, setFinMonth] = useState(FIN_START);
  // The plan the calculators and the market measure against: the one the catalogue marks, else the middle one.
  const plan = data.plans.find((p) => p.highlight) ?? data.plans[Math.floor(data.plans.length / 2)] ?? null;

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];

    out.push({
      id: "cover", kicker: "JobFlex · the contractor's operating system", tone: "blue",
      body: (
        <div className={s.cover}>
          <h1 className={s.coverTitle}>You build.<br />We run the rest.</h1>
          <p className={s.lede}>One app for a trade business, from the first call to the last payment — AI estimates from an address, proposals clients sign and pay on a phone, an AI front desk, the schedule, the crews and the money. And a homeowner portal, built and ready to open, that turns projects into paid leads.</p>
          <div className={s.chips}>
            <span><b>Day {n(data.launch.day)}</b> since launch</span>
            <span><b>{n(t.paying)}</b> paying · {dollars(t.payingMrrCents)}/mo</span>
            <span><b>6</b> estimators, one app</span>
          </div>
          <div className={s.coverFoot}>jobflex.app · launched {longDate(data.launch.date)} · figures read live</div>
        </div>
      ),
    });

    out.push({
      id: "problem", kicker: "The problem",
      body: (
        <div className={s.splitWide}>
          <div>
            <h2 className={s.title}>A trade business is five jobs — and the owner does all of them</h2>
            <ul className={`${s.points} ${s.pointsBig}`}>
              <li><b>Estimates cost the evening.</b> A drive to every property, a ladder, a tape, then the take-off by hand.</li>
              <li><b>The phone rings on the roof.</b> A call nobody answers is a job someone else may get.</li>
              <li><b>Quotes go out blind.</b> A PDF in an email, and no idea whether it was opened.</li>
              <li><b>Five apps that don&apos;t talk.</b> The schedule, the crew, the invoices and the reviews each live somewhere else.</li>
            </ul>
          </div>
          <aside className={s.statStack}>
            <div className={s.stat}><b>{HOURS_FACT.figure}</b><span>{HOURS_FACT.line}</span></div>
            <div className={s.stat}><b>{MARKET_FACTS[3].figure}</b><span>{MARKET_FACTS[3].line}</span></div>
            <Sources list={[HOURS_FACT.source, MARKET_FACTS[3].source]} />
          </aside>
        </div>
      ),
    });

    out.push({
      id: "value", kicker: "The value · time given back",
      body: (
        <div>
          <h2 className={s.title}>Hours back every week — and the jobs that used to slip away</h2>
          <div className={s.beforeAfterWrap}>
            <table className={s.beforeAfter}>
              <thead><tr><th scope="col">The work</th><th scope="col">Without JobFlex</th><th scope="col">With JobFlex</th></tr></thead>
              <tbody>
                {[
                  ["Roof estimate", "Drive out, climb, measure, write it up at night", "From the address at the desk — area, squares, pitch and facets measured from the air"],
                  ["Fence estimate", "Walk the line with a wheel, sketch the gates", "Drawn on the satellite map, priced by the foot, shown in 3D on the lot's slope"],
                  ["HVAC sizing", "A rule of thumb per square foot", "A Manual J-style load from the house's details, the unit sized to it, three options"],
                  ["Deck design", "Drawings, lumber list and permit sheets by hand", "3D design, the state's rules, the lumber list and a permit set from one drawing"],
                  ["The phone", "Rings while the crew is on a roof", "The AI desk answers, asks what the trade needs and books the visit"],
                  ["The proposal", "A PDF by email — opened? nobody knows", "A link the client reads, signs and pays on a phone — and you see when it is opened"],
                  ["Getting paid", "Paper invoices and reminder calls", "A payment schedule on every job: card or bank, reminders, mark paid"],
                  ["The office", "Five apps that don't talk", "CRM, calendar, crews, financials and reviews on one record"],
                ].map(([w, a, b]) => (
                  <tr key={w}><th scope="row">{w}</th><td data-label="Without JobFlex">{a}</td><td data-label="With JobFlex">{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    });

    {
      const weekly = shop.estimates * shop.perEstimate + shop.office;
      const monthHours = Math.round((weekly * 52) / 12);
      const worthCents = monthHours * shop.hourly * 100;
      const times = plan && plan.priceCents > 0 ? worthCents / plan.priceCents : null;
      out.push({
        id: "calculator", kicker: "The value · one shop, your numbers", tone: "ink",
        body: (
          <div className={s.calc}>
            <div className={s.calcIn}>
              <h2 className={s.title}>What it is worth to one shop</h2>
              <Dial id="calc-estimates" label="Estimates a week" value={shop.estimates} min={1} max={30} step={1} show={(v) => String(v)} onChange={(v) => setShop((x) => ({ ...x, estimates: v }))} />
              <Dial id="calc-per-estimate" label="Hours each one saves (drive, measure, write-up)" value={shop.perEstimate} min={0.5} max={6} step={0.5} show={(v) => `${v} h`} onChange={(v) => setShop((x) => ({ ...x, perEstimate: v }))} />
              <Dial id="calc-office" label="Office hours saved a week (calls, scheduling, invoices)" value={shop.office} min={0} max={20} step={1} show={(v) => `${v} h`} onChange={(v) => setShop((x) => ({ ...x, office: v }))} />
              <Dial id="calc-hourly" label="What the owner's hour is worth" value={shop.hourly} min={25} max={200} step={5} show={(v) => `$${v}`} onChange={(v) => setShop((x) => ({ ...x, hourly: v }))} />
            </div>
            <div className={s.calcOut} aria-live="polite">
              <div><b data-calc="hours">{n(monthHours)} h</b><span>back a month</span></div>
              <div><b data-calc="worth">{dollars(worthCents)}</b><span>of the owner&apos;s time, every month</span></div>
              {times !== null && plan ? <div><b data-calc="times">{times >= 10 ? Math.round(times) : times.toFixed(1)}×</b><span>what the {plan.name} plan costs ({price(plan.priceCents)}/mo)</span></div> : null}
              <p className={s.calcNote}>An example shop: every figure is a dial to move, none is a measurement of JobFlex customers. Not counted here: calls the AI desk answers after hours, proposals signed on the spot, homeowner leads.</p>
            </div>
          </div>
        ),
      });
    }

    out.push({
      id: "product", kicker: "The product",
      body: (
        <div>
          <h2 className={s.title}>One app, the whole life of a job</h2>
          <ol className={s.flowShots}>
            {[
              ["ai-desk", "Call", "The AI desk answers, asks what the trade needs and books the visit."],
              ["roof-estimator", "Estimate", "Roof, fence, HVAC, deck and remodel estimates from an address, a map, a sentence or a plan set."],
              ["client-proposal", "Sell", "A proposal link the client reads, signs and pays on a phone; change orders in writing."],
              ["calendar", "Schedule", "The calendar, dispatch by crew, and a crew page with no login."],
              ["financials", "Get paid", "A payment schedule on every job, invoices by card or bank, revenue against expenses."],
              ["reviews", "Grow", "Reviews after the job — and, once the homeowner portal opens, requests that arrive as leads."],
            ].map(([slug, h, p], i) => (
              <li key={slug}>
                <Shot slug={slug} className={s.flowImg} sizes="(max-width: 860px) 92vw, 30vw" />
                <div><i>{String(i + 1).padStart(2, "0")}</i><b>{h}</b><span>{p}</span></div>
              </li>
            ))}
          </ol>
        </div>
      ),
    });

    out.push({
      id: "estimators", kicker: "The product · estimating",
      body: (
        <div>
          <h2 className={s.title}>Estimates from the office, not the driveway</h2>
          <div className={s.tiles}>
            {[
              ["roof-estimator", "Roof", "From an address: area, squares, pitch and facets, measured from the air."],
              ["fence-studio", "Fence", "Drawn on the satellite map, then shown in 3D on the lot's own slope."],
              ["hvac-design", "HVAC", "A Manual J-style load, the unit sized to it, three equipment options."],
              ["deck-roof-3d", "Deck Studio", "3D design, the state's rules, a permit set and the lumber list."],
              ["smart-proposal", "Smart Proposal", "A sentence or a few photos in, priced lines out — any trade."],
              ["blueprint", "Blueprint", "A plan set in; measured and priced from the sheets."],
            ].map(([slug, h, p]) => (
              <figure key={slug} className={s.tile}><Shot slug={slug} className={s.tileImg} sizes="(max-width: 860px) 92vw, 30vw" /><figcaption><b>{h}</b>{p}</figcaption></figure>
            ))}
          </div>
        </div>
      ),
    });

    out.push({
      id: "homeowners", kicker: "The second engine · built, not open yet",
      body: (
        <div className={s.leadSlide}>
          <div>
            <h2 className={s.title}>Homeowners post projects free. Contractors pay for the lead.</h2>
            <ol className={s.market2}>
              <li><i>Homeowner</i><b>Describes the project — free</b><span>Photos, address, a few words. No account; the email link is their own home page with every project, proposal and contractor.</span></li>
              <li><i>JobFlex</i><b>Reads it and picks one shop</b><span>The AI names the trade and the scope; the request goes to one contractor at a time — never to a crowd.</span></li>
              <li><i>Contractor</i><b>Pays on Accept, then sees the contacts</b><span>The offer shows the trade, the town and the scope. Accept on a priced lead charges the card on file; then the contacts open and the lead lands in the CRM.</span></li>
            </ol>
          </div>
          <div className={s.leadShots}>
            <Shot slug="homeowner-portal" className={s.leadDesk} sizes="(max-width: 860px) 92vw, 34vw" />
            <Shot slug="home-dashboard" />
          </div>
          <div className={s.leadReady} data-leads="not-open">
            <b>Built — not open to homeowners yet</b>
            <ul>
              <li>The free portal and the homeowner&apos;s own page</li>
              <li>The AI reads the trade and the scope</li>
              <li>One shop at a time</li>
              <li>Charged to the card on Accept</li>
              <li>The lead lands in the CRM</li>
            </ul>
          </div>
        </div>
      ),
    });

    {
      const leadCents = leadMonth.perMonth * leadMonth.priceDollars * 100;
      out.push({
        id: "model", kicker: "Business model · four ways JobFlex earns",
        body: (
          <div className={s.model}>
            <div className={s.modelCol}>
              <div className={s.modelHead}><i>1</i><b>Subscriptions</b><span>A flat monthly plan, no per-seat fees{plan?.trialDays ? `; a ${plan.trialDays}-day free trial` : ""}.</span></div>
              <div className={s.planRow}>
                {data.plans.map((p) => (
                  <div key={p.name} className={s.planMini} data-highlight={p.highlight}>
                    <span>{p.name}</span><b>{price(p.priceCents)}<small>/mo</small></b>
                  </div>
                ))}
              </div>
              <div className={s.modelHead}><i>2</i><b>AI desk minutes</b><span>Plans include minutes; more come in packs of {n(data.deskPack.minutes)} for {price(data.deskPack.cents)}.</span></div>
              <div className={s.modelHead}><i>3</i><b>Financing share</b><span>Clients pay for the whole project over time through a lending partner; JobFlex earns a share of every financed job — {FINANCING.shareLowPct}–{FINANCING.shareHighPct}%, our target for the partnership. Built; next slide.</span></div>
            </div>
            <div className={s.modelCol}>
              <div className={s.modelHead}><i>4</i><b>Paid homeowner leads</b><span>Built: a lead is charged to the shop&apos;s card on Accept, at the price JobFlex sets for it ({dollars(data.leadPrice.minCents)}–{dollars(data.leadPrice.maxCents)}). Not open to homeowners yet.</span></div>
              <table className={s.leadPrices}>
                <tbody>
                  {LEAD_PRICES.map((x) => <tr key={x.name}><th scope="row">{x.name}</th><td><b>{x.price}</b><span>{x.how}</span></td></tr>)}
                  <tr className={s.leadUs}><th scope="row">JobFlex</th><td><b>Set by JobFlex per lead</b><span>one shop at a time, scoped by AI, free for the homeowner</span></td></tr>
                </tbody>
              </table>
              <div className={s.leadCalc}>
                <Dial id="lead-per-month" label="Leads accepted a month" value={leadMonth.perMonth} min={10} max={2000} step={10} show={(v) => n(v)} onChange={(v) => setLeadMonth((x) => ({ ...x, perMonth: v }))} />
                <Dial id="lead-price" label="Price per lead" value={leadMonth.priceDollars} min={10} max={150} step={5} show={(v) => `$${v}`} onChange={(v) => setLeadMonth((x) => ({ ...x, priceDollars: v }))} />
                <p className={s.leadSum} aria-live="polite"><b data-calc="lead-month">{dollars(leadCents)}</b> a month · <b>{compact(leadCents * 12)}</b> a year <span>— an example to move, not a forecast</span></p>
              </div>
              <Sources list={LEAD_PRICES.map((x) => x.source)} />
            </div>
          </div>
        ),
      });
    }

    {
      // FINANCING (owner, 2026-10-28: "a source of income additional from financing … from 2 to 3% from the financial
      // institution partnership"). Built in the product, switched on with the partner agreement — not signed yet, said so.
      const finCents = finMonth.jobs * finMonth.avgDollars * 100 * (finMonth.sharePct / 100);
      const roof = 2_000_000;
      out.push({
        id: "financing", kicker: "Business model · financing — built, launching with a lending partner",
        body: (
          <div className={s.leadSlide}>
            <div>
              <h2 className={s.title}>Clients pay over time. Contractors are paid in full. JobFlex earns a share.</h2>
              <ol className={s.market2}>
                <li><i>Contractor</i><b>Approved once, inside JobFlex</b><span>Settings → Integrations / Payments → Financing: the application arrives filled in with what JobFlex knows; the lender approves the business once.</span></li>
                <li><i>Client</i><b>&ldquo;Pay over time&rdquo; on the proposal</b><span>On their phone, the amount filled in; checking the rate doesn&apos;t touch their credit score. Jobs from {dollars(FINANCING.jobMinCents)} to {dollars(FINANCING.jobMaxCents)}.</span></li>
                <li><i>JobFlex</i><b>Paid on every financed job</b><span>The contractor is paid in full 1–3 business days after the job; the lender carries the loan — JobFlex never lends. The lender pays its software partners a share: our target is {FINANCING.shareLowPct}–{FINANCING.shareHighPct}% of each financed job.</span></li>
              </ol>
            </div>
            <div className={s.leadCalc}>
              <Dial id="fin-jobs" label="Financed jobs a month" value={finMonth.jobs} min={5} max={2000} step={5} show={(v) => n(v)} onChange={(v) => setFinMonth((x) => ({ ...x, jobs: v }))} />
              <Dial id="fin-avg" label="Average financed job" value={finMonth.avgDollars} min={2000} max={65000} step={1000} show={(v) => `$${n(v)}`} onChange={(v) => setFinMonth((x) => ({ ...x, avgDollars: v }))} />
              <Dial id="fin-share" label="JobFlex share" value={finMonth.sharePct} min={FINANCING.shareLowPct} max={FINANCING.shareHighPct} step={0.25} show={(v) => `${v}%`} onChange={(v) => setFinMonth((x) => ({ ...x, sharePct: v }))} />
              <p className={s.leadSum} aria-live="polite"><b data-calc="fin-month">{dollars(finCents)}</b> a month · <b>{compact(finCents * 12)}</b> a year <span>— an example to move, not a forecast</span></p>
              <p className={s.leadSum}>One {dollars(roof)} roof, financed: <b>{dollars(roof * FINANCING.shareLowPct / 100)}–{dollars(roof * FINANCING.shareHighPct / 100)}</b> to JobFlex.</p>
            </div>
            <div className={s.leadReady} data-financing="built">
              <b>Built — switched on with the partner agreement</b>
              <ul>
                <li>Apply and get approved in Settings</li>
                <li>A switch on every proposal</li>
                <li>Pay over time on the client&apos;s page</li>
                <li>Payouts land as payments</li>
                <li>The AI desk says &ldquo;yes, we finance&rdquo;</li>
                <li>Built for Wisetack, the lender in Jobber and Housecall Pro — agreement not signed yet; the share is our target</li>
              </ul>
            </div>
            <div style={{ gridColumn: "1 / -1" }}><Sources list={FINANCING.sources} /></div>
          </div>
        ),
      });
    }

    {
      const onePct = Math.round(ALL_TRADE_SHOPS * 0.01);
      out.push({
        id: "market", kicker: "The market",
        body: (
          <div>
            <h2 className={s.title}>Millions of small shops — and the leader serves the top</h2>
            <div className={s.marketGrid}>
              {MARKET_FACTS.map((f) => (
                <div key={f.figure} className={s.marketFact}><b>{f.figure}</b><span>{f.line}{f.math ? ` (${f.math})` : ""}</span></div>
              ))}
            </div>
            <div className={s.marketBand}>
              <p><b>{LEADER.name}</b>, the category&apos;s public leader, took in {compact(LEADER.revenueCents)} from {n(LEADER.customers)} customers in fiscal 2025 — about {compact(LEADER.revenueCents / LEADER.customers)} a customer a year. Contractors pay for software; the big shops already have it. The small ones are the open field.</p>
              {plan ? <p className={s.marketMath}>For scale: 1% of {n(ALL_TRADE_SHOPS)} shops is {n(onePct)}; on the {plan.name} plan at {price(plan.priceCents)}/mo that is <b>{compact(onePct * plan.priceCents * 12)} a year</b> — arithmetic, not a forecast.</p> : null}
            </div>
            <Sources list={[...MARKET_FACTS.map((f) => f.source), LEADER.source]} />
          </div>
        ),
      });
    }

    out.push({
      id: "why-now", kicker: "Why now",
      body: (
        <div>
          <h2 className={s.title}>Why this can be built now</h2>
          <ul className={`${s.points} ${s.pointsWide}`}>
            <li><b>AI can read the job.</b> A plan set, a photo, a sentence, a phone call, an address seen from the air — the estimating that meant a drive and an evening now starts at the desk.</li>
            <li><b>The leader serves the top.</b> {n(LEADER.customers)} customers at about {compact(LEADER.revenueCents / LEADER.customers)} a year each; the {MARKET_FACTS[1].figure} one-person shops need the same tools at a small shop&apos;s price.</li>
            <li><b>Leads elsewhere are shared.</b> On the big marketplaces the same request goes to several pros at once; JobFlex offers each one to one shop at a time.</li>
            <li><b>The client already lives on a phone.</b> Proposals signed and paid there, the deck changed by talking to it, the homeowner&apos;s own page for every project.</li>
          </ul>
          <Sources list={[LEADER.source, LEAD_PRICES[0].source]} />
        </div>
      ),
    });

    out.push({
      id: "traction", kicker: `Traction · live · read ${new Date(t.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
      body: (
        <div>
          <h2 className={s.title}>Where it stands today</h2>
          <div className={s.kpis}>
            <div data-kpi="day"><b>Day {n(data.launch.day)}</b><span>since JobFlex launched · {longDate(data.launch.date)}</span></div>
            <div data-kpi="signed-up"><b>{n(t.signups)}</b><span>signed up with a card since {longDate(t.since)}</span></div>
            <div data-kpi="paying"><b>{n(t.paying)}</b><span>paying · {dollars(t.payingMrrCents)}/mo</span></div>
            <div data-kpi="rate"><b>{t.ratePct === null ? "—" : `${t.ratePct}%`}</b><span>{t.ratePct === null ? "trial to paid · no trial has ended yet" : `trial to paid · ${t.ratePaid} of ${t.rateEnded} ended trials${t.rateLowPct !== null && t.rateHighPct !== null ? ` · 90% range ${t.rateLowPct}–${t.rateHighPct}%` : ""}`}</span></div>
            <div data-kpi="trials"><b>{n(t.trialsNow)}</b><span>on trial now</span></div>
            <div data-kpi="collected"><b>{t.collected.read ? dollars(t.collected.cents) : "—"}</b><span>{t.collected.read ? `collected so far · Stripe, ${t.collected.invoices} ${t.collected.invoices === 1 ? "payment" : "payments"}` : "collected · Stripe not read"}</span></div>
          </div>
          <p className={s.note}>The same figures as the Figures page, read live. <Link href={`/investors/${data.token}`}>See them all →</Link></p>
        </div>
      ),
    });

    out.push({
      id: "unit", kicker: "Unit economics · measured, not modeled",
      body: (
        <div>
          <h2 className={s.title}>What a customer costs, and how fast it comes back</h2>
          <div className={s.kpis}>
            <div data-kpi="cost-per-paying"><b>{money(u.costPerPayingCents)}</b><span>{u.matured.through === null ? "ad spend per paying customer · once the first trials are over" : u.matured.won > 0 ? `ad spend per paying customer · ${dollars(u.matured.spendCents)} ÷ ${n(u.matured.won)} · the ads up to ${longDate(u.matured.through)}, whose trials are over` : "ad spend per paying customer · none yet from the trials that are over"}</span></div>
            <div data-kpi="payback"><b>{u.paybackMonths === null ? "—" : `${Math.round(u.paybackMonths * 10) / 10} mo`}</b><span>{u.matured.wonMrrCents > 0 ? `to earn the spend back · at those customers' ${dollars(u.matured.wonMrrCents)} a month` : "to earn the spend back · once a customer pays"}</span></div>
            <div data-kpi="arr"><b>{dollars(u.arrCents)}</b><span>a year, at today&apos;s paying customers</span></div>
            <div data-kpi="per-signup"><b>{money(u.costPerSignupCents)}</b><span>ad spend per sign-up with a card</span></div>
            <div data-kpi="expected"><b>{u.expectedPayers === null ? "—" : `≈${n(Math.round(u.expectedPayers))}`}</b><span>{u.expectedPayers === null ? "of the running trials will pay · once a trial has ended" : `of the running trials will pay at the measured rate${u.expectedMrrCents ? ` · +${dollars(u.expectedMrrCents)}/mo` : ""}`}</span></div>
            <div data-kpi="spend"><b>{dollars(u.spendCents)}</b><span>spent on ads since {longDate(t.since)}</span></div>
          </div>
          <p className={s.note}>Read live from the ad accounts, Stripe and the sign-ups — the Figures page shows the month-by-month curve.</p>
        </div>
      ),
    });

    out.push({
      id: "judge", kicker: "If we were the investor",
      body: (
        <div>
          <h2 className={s.title}>How we would judge JobFlex — the four questions</h2>
          <div className={s.judge}>
            {[
              ["Do trials turn into customers?", t.ratePct === null ? "No trial has ended yet" : `${t.ratePct}% — ${t.ratePaid} of ${t.rateEnded} ended trials`, t.rateLowPct !== null && t.rateHighPct !== null ? `The 90% range is ${t.rateLowPct}–${t.rateHighPct}%; it narrows with every trial that ends.` : "Measured as each trial ends."],
              ["Does the ad money come back?", u.paybackMonths === null ? "Not yet measured" : `${money(u.costPerPayingCents)} a customer, back in ${Math.round(u.paybackMonths * 10) / 10} months`, "Spend ÷ the paying customers the ads brought — counted on the signups whose trial is over — then months of their plan to repay it."],
              ["Is the second engine ready?", "Built — not open yet", "The homeowner portal, the routing to one shop and the charge on Accept all work today; it is not open to homeowners yet."],
              ["Does a shop earn JobFlex more than its plan?", "Two more lines, built", `AI desk minute packs (${price(data.deskPack.cents)} for ${n(data.deskPack.minutes)}), and homeowner leads charged on Accept once the portal opens.`],
            ].map(([q, a, why]) => (
              <div key={q} className={s.judgeRow}><b>{q}</b><strong>{a}</strong><span>{why}</span></div>
            ))}
          </div>
          <p className={s.note}>The trials and the ad payback are read live, the moment this slide opens.</p>
        </div>
      ),
    });

    if (data.compare.rows.length) {
      out.push({
        id: "competition", kicker: "Competition",
        body: (
          <div>
            <h2 className={s.title}>Where JobFlex is different</h2>
            <div className={s.cmpWrap}>
              <table className={s.cmp}>
                <thead><tr><th scope="col">Built in</th><th scope="col" className={s.cmpUs}>JobFlex</th>{data.compare.competitors.map((c) => <th scope="col" key={c.id}>{c.name}</th>)}</tr></thead>
                <tbody>
                  {data.compare.rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.label}</th>
                      <td className={s.cmpUs}>✓</td>
                      {data.compare.competitors.map((c) => { const w = cellWords(r.them[c.id], data.compare.caveats); return <td key={c.id} data-tone={w.tone}>{w.text}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.note}>Each competitor cell was checked against the vendor&apos;s own pricing, features and help pages (Sept–Oct 2026), judged on their cheapest paid plan.</p>
          </div>
        ),
      });
    }

    out.push({
      id: "go-to-market", kicker: "Go to market",
      body: (
        <div className={s.split}>
          <div>
            <h2 className={s.title}>How contractors find JobFlex</h2>
            <ul className={`${s.points} ${s.pointsBig}`}>
              <li><b>Trade-by-trade video ads.</b> Roof, fence, HVAC and deck films on Facebook and Instagram, each landing on its own trade&apos;s page.</li>
              <li><b>Homeowner demand.</b> The homeowner portal is built — requests become leads for contractors on JobFlex. It is not open to homeowners yet.</li>
              <li><b>Outbound by the AI desk itself.</b> It calls contractors&apos; business lines to introduce JobFlex; a mobile number gets an email asking first.</li>
              <li><b>Try before paying.</b> A free trial on every plan; the Figures page measures trial to paid as it happens.</li>
            </ul>
          </div>
          <Shot slug="lead-offer" />
        </div>
      ),
    });

    if (data.words.roadmap.length) {
      out.push({
        id: "roadmap", kicker: "What's next",
        body: (
          <div>
            <h2 className={s.title}>What&apos;s next</h2>
            <ol className={s.roadmap}>{data.words.roadmap.map((l, i) => <li key={i}>{l}</li>)}</ol>
          </div>
        ),
      });
    }
    // No team slide (owner, 2026-10-25: "we don't show the founders and roles on the link — only on request; we review
    // the offers and give the set-up of the company after a preliminary offer"). The ask says so.
    out.push({
      id: "ask", kicker: "The ask", tone: "blue",
      body: (
        <div className={s.cover}>
          <h2 className={s.coverTitle}>{data.words.ask[0] ?? "We're raising"}</h2>
          {data.words.ask.length > 1 ? (
            <ul className={`${s.points} ${s.pointsBig}`}>{data.words.ask.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul>
          ) : (
            <p className={s.lede}>Offers and first conversations are welcome.</p>
          )}
          {/* How the raise runs (owner, 2026-10-25: "very pro, so investors treat it very seriously"): the team and the
              company's set-up follow a reviewed preliminary offer — never on the link. */}
          <ol className={s.process} data-on-request aria-label="How the raise runs">
            <li><b>Indicative offer</b><span>Your terms in a few minutes, from this page.</span></li>
            <li><b>Founders&apos; review</b><span>Every offer is read by the founders; we reply by email.</span></li>
            <li><b>Diligence</b><span>Shortlisted investors receive the founding team, the company structure and the cap table — and a call with the founders.</span></li>
          </ol>
          <div className={s.askActs}>
            {offer}
            <Link className={s.askLink} href={`/investors/${data.token}/tour`}>Take the platform tour →</Link>
            <Link className={s.askLink} href={`/investors/${data.token}`}>The live figures →</Link>
          </div>
        </div>
      ),
    });
    return out;
  }, [data, offer, t, u, plan, shop, leadMonth, finMonth]);

  const { index, move, playing, togglePlay, swipe } = useSlides(slides.length, 9000);
  const slide = slides[index];
  const deck = useRef<HTMLElement>(null);
  const full = useFullscreen(deck);

  return (
    <section className={s.deck} ref={deck} data-deck data-full={full.on || undefined} aria-roledescription="slideshow" aria-label="JobFlex pitch deck">
      <div className={s.slide} key={slide.id} data-slide={slide.id} data-tone={slide.tone} {...swipe} aria-live="polite">
        <div className={s.slideKicker}><span>{slide.kicker}</span><span>{index + 1} / {slides.length}</span></div>
        <div className={s.slideBody}>{slide.body}</div>
      </div>
      <div className={s.deckBar}>
        <button type="button" className={s.ctl} onClick={() => move(index - 1)} disabled={index === 0} aria-label="Previous slide">←</button>
        <div className={s.dots} role="tablist" aria-label="Slides">
          {slides.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === index} aria-label={`${i + 1}: ${x.kicker}`} className={s.dot} onClick={() => move(i)} />
          ))}
        </div>
        <button type="button" className={s.ctl} onClick={togglePlay} aria-pressed={playing} data-deck-play>{playing ? "Pause" : "Play"}</button>
        {full.able ? <button type="button" className={s.ctl} onClick={full.toggle} aria-pressed={full.on} data-deck-full>{full.on ? "Exit full screen" : "Full screen"}</button> : null}
        <button type="button" className={`${s.ctl} ${s.ctlMain}`} onClick={() => move(index + 1)} disabled={index === slides.length - 1} data-deck-next>Next →</button>
      </div>
    </section>
  );
}
