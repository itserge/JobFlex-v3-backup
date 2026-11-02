import "server-only";
// THE PITCH DECK'S DATA (2026-10-25): every number on the deck is the Figures page's own reading (the readers' copy),
// the prices the live plan catalogue, the comparison the landing page's researched table, the raise and what is next
// the owner's words. Built here once, for the deck on the investor link's page and for the deck's own page (./pitch).
import type { InvestorReport } from "@/lib/investors";
import { customerCostStory } from "@/lib/investorModel";
import type { InvestorPitch } from "@/lib/investorPitch";
import { askLines, splitLines } from "@/lib/investorPitchShared";
import { MAX_LEAD_PRICE_CENTS, MIN_LEAD_PRICE_CENTS } from "@/lib/leadCenter/purchase";
import { DESK_PACK } from "@/lib/aiDesk/shared";
import { storedTrialOffer } from "@/lib/trialOffer";
import { CAVEAT_LABEL, COMPARE_COMPETITORS, COMPARE_ROWS } from "@/components/v3/landing-e/landing-compare";
import type { PitchData } from "@/components/v3/investor-deck/pitch-deck";

type Plan = { active: boolean; isFree: boolean; order: number; name: string; priceCents: number; yearlyPriceCents: number | null; trialDays: number; highlight: boolean; features: string[] };

export function buildPitchData(token: string, report: InvestorReport, plans: readonly Plan[], pitch: InvestorPitch): PitchData {
  const f = report.figures;
  return {
    token,
    launch: { day: report.launch.day, date: report.launch.date },
    traction: {
      since: f.since, signups: f.signups, paying: f.paying.count, payingMrrCents: report.recurring?.mrrCents ?? f.paying.mrrCents, trialsNow: f.trials.count,
      ratePct: f.rate.pct, ratePaid: f.rate.paid, rateEnded: f.rate.ended, rateLowPct: f.rate.lowPct, rateHighPct: f.rate.highPct,
      collected: { read: report.collected.read, cents: report.collected.cents, invoices: report.collected.invoices },
      at: report.at,
    },
    unit: {
      spendCents: f.spend.totalCents, won: f.paying.won, wonMrrCents: f.paying.wonMrrCents, arrCents: report.recurring ? report.recurring.mrrCents * 12 : f.paying.arrCents,
      costPerPayingCents: f.unit.costPerPayingCents, costPerSignupCents: f.unit.costPerSignupCents, paybackMonths: f.unit.paybackMonths, matured: f.unit.matured,
      expectedPayers: f.expected.payers, expectedMrrCents: f.expected.mrrCents,
      cost: f.cost, costWords: customerCostStory(f), today: f.today,
    },
    recurring: report.recurring,
    leadPrice: { minCents: MIN_LEAD_PRICE_CENTS, maxCents: MAX_LEAD_PRICE_CENTS },
    deskPack: { minutes: DESK_PACK.minutes, cents: DESK_PACK.cents },
    plans: plans
      .filter((p) => p.active && !p.isFree)
      .sort((a, b) => a.order - b.order)
      // The trial is the sign-up's offer for every plan (lib/trialOffer), never the unused PricingPlan.trialDays.
      .map((p) => ({ name: p.name, priceCents: p.priceCents, yearlyPriceCents: p.yearlyPriceCents, trialDays: storedTrialOffer().days, highlight: p.highlight, features: p.features })),
    compare: {
      competitors: COMPARE_COMPETITORS,
      rows: COMPARE_ROWS.map((r) => ({ id: r.id, label: r.label, detail: r.detail, them: r.them })),
      caveats: CAVEAT_LABEL,
    },
    // No team: it is shared after a preliminary offer, never sent with the page (2026-10-25).
    // The raise: the saved words, else the owner's draft — the same lines the link shows at its top.
    words: { ask: askLines(pitch.ask), roadmap: splitLines(pitch.roadmap) },
  };
}
