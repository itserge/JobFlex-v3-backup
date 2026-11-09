// THE PIPELINE — THE PURE RULES (Smart CRM part 3, 2026-11-08; the plan doc and the owner's spec §8 Pipeline,
// §15 Next best action, §16 Deal risk). A card is a lead not yet quoted, or a proposal. Its stage comes from what
// actually happened (the lead's status, a visit, the proposal's status) — never from hopeful words — unless a
// person dragged it later than that event. Risk is plain, explained rules (no predictions until there is history);
// every card carries one next step with its evidence. Proved by qa/tests/logic/pipeline.check.ts.

export const STAGES = [
  { key: "NEW", label: "New lead", short: "New" },
  { key: "CONTACTED", label: "Contacted", short: "Contacted" },
  { key: "VISIT", label: "Visit booked", short: "Visit" },
  { key: "ESTIMATING", label: "Estimate in progress", short: "Estimating" },
  { key: "SENT", label: "Estimate sent", short: "Sent" },
  { key: "NEGOTIATION", label: "Negotiation", short: "Negotiation" },
  { key: "WON", label: "Won", short: "Won" },
  { key: "LOST", label: "Lost", short: "Lost" },
] as const;
export type Stage = (typeof STAGES)[number]["key"];
export const STAGE_KEYS = STAGES.map((s) => s.key) as readonly Stage[];
export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGE_KEYS as readonly string[]).includes(v);
export const OPEN_STAGES: readonly Stage[] = ["NEW", "CONTACTED", "VISIT", "ESTIMATING", "SENT", "NEGOTIATION"];

const DAY = 86_400_000;

/** A lead with no proposal yet: its status, then whether a visit is on the books. */
export function leadStage(lead: { status: string; contactedAt: Date | null }, visit: { at: Date; done: boolean } | null): Stage {
  const s = lead.status.toUpperCase();
  if (s === "WON") return "WON";
  if (s === "LOST" || s === "ARCHIVED") return "LOST";
  if (s === "QUOTED") return "ESTIMATING";
  if (visit) return visit.done ? "ESTIMATING" : "VISIT";
  if (s === "CONTACTED" || lead.contactedAt) return "CONTACTED";
  return "NEW";
}

/** A proposal: its status says it all. */
export function proposalStage(status: string): Stage {
  switch (status.toUpperCase()) {
    case "ACCEPTED":
    case "COMPLETED":
    case "PAID":
      return "WON";
    case "DECLINED":
    case "EXPIRED":
      return "LOST";
    case "SENT":
    case "VIEWED":
      return "SENT";
    default:
      return "ESTIMATING";
  }
}

/** The stage the card shows: a person's move stands until something real happens after it. */
export function effectiveStage(auto: { stage: Stage; at: Date | null }, hand: { stage: string | null; at: Date | null } | null): { stage: Stage; byHand: boolean } {
  if (!hand?.stage || !isStage(hand.stage) || !hand.at) return { stage: auto.stage, byHand: false };
  if (auto.at && auto.at.getTime() > hand.at.getTime()) return { stage: auto.stage, byHand: false };
  return { stage: hand.stage, byHand: hand.stage !== auto.stage };
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RiskInput {
  stage: Stage;
  now: Date;
  /** The last time either side said or did anything on this deal. */
  lastTouch: Date | null;
  /** The thread needs our answer since… (null when it doesn't). */
  awaitingUsSince: Date | null;
  /** The thread is flagged urgent (a complaint, a problem). */
  urgent: boolean;
  /** Promises we made to this client that are past due. */
  overduePromises: number;
  /** A visit happened and no estimate went out since. */
  visitDoneAt: Date | null;
  estimateSentAt: Date | null;
  /** Visits canceled or no-showed on this deal. */
  reschedules: number;
  /** The AI read money worries in their latest message ("too expensive", "over budget"). */
  priceWorry: boolean;
  expectedClose: Date | null;
}

export function riskOf(r: RiskInput): { level: RiskLevel; reasons: string[] } {
  if (r.stage === "WON" || r.stage === "LOST") return { level: "LOW", reasons: [] };
  const high: string[] = [];
  const med: string[] = [];
  const days = (d: Date) => Math.floor((r.now.getTime() - d.getTime()) / DAY);
  if (r.urgent) high.push("An unresolved complaint or problem in their messages");
  if (r.overduePromises > 0) high.push(r.overduePromises === 1 ? "A promise to them is overdue" : `${r.overduePromises} promises to them are overdue`);
  if (r.awaitingUsSince && days(r.awaitingUsSince) >= 1) (days(r.awaitingUsSince) >= 3 ? high : med).push(`They've waited ${days(r.awaitingUsSince)} day${days(r.awaitingUsSince) === 1 ? "" : "s"} for our answer`);
  if (r.lastTouch) {
    const d = days(r.lastTouch);
    if (d >= 14) high.push(`No contact in ${d} days`);
    else if (d >= 7) med.push(`No contact in ${d} days`);
  }
  if (r.visitDoneAt && (!r.estimateSentAt || r.estimateSentAt < r.visitDoneAt)) {
    const d = days(r.visitDoneAt);
    if (d >= 7) high.push(`Visit was ${d} days ago and no estimate went out`);
    else if (d >= 3) med.push(`Visit was ${d} days ago and no estimate went out`);
  }
  if (r.reschedules >= 2) med.push(`Visit moved or missed ${r.reschedules} times`);
  if (r.priceWorry) med.push("They raised the price");
  if (r.expectedClose && r.expectedClose.getTime() < r.now.getTime()) med.push("Past its expected close date");
  if (high.length) return { level: "HIGH", reasons: [...high, ...med] };
  if (med.length) return { level: "MEDIUM", reasons: med };
  return { level: "LOW", reasons: [] };
}

export interface NextInput {
  stage: Stage;
  now: Date;
  first: string;
  createdAt: Date;
  contacted: boolean;
  awaitingUs: boolean;
  overduePromise: string | null;
  upcomingVisit: Date | null;
  visitDoneAt: Date | null;
  draft: boolean;
  sentAt: Date | null;
  viewCount: number;
  viewedAt: Date | null;
  paidShare: number | null;
  buildStatus: string | null;
  dayWords: (d: Date) => string;
}

/** One next step with the evidence for it — never a generic "follow up". */
export function nextStepOf(n: NextInput): string | null {
  const ago = (d: Date) => {
    const h = Math.round((n.now.getTime() - d.getTime()) / 3_600_000);
    return h < 24 ? `${Math.max(1, h)} h ago` : `${Math.round(h / 24)} days ago`;
  };
  if (n.overduePromise) return `Keep your promise: ${n.overduePromise}`;
  if (n.awaitingUs) return `Answer ${n.first} — their message is waiting`;
  switch (n.stage) {
    case "NEW":
      return `Call ${n.first} — came in ${ago(n.createdAt)}${n.contacted ? "" : ", no contact yet"}`;
    case "CONTACTED":
      return `Book a visit with ${n.first}`;
    case "VISIT":
      return n.upcomingVisit ? `Visit ${n.dayWords(n.upcomingVisit)}` : `Book the visit with ${n.first}`;
    case "ESTIMATING":
      if (n.draft) return "Finish and send the estimate";
      return n.visitDoneAt ? `Build the estimate — visit was ${n.dayWords(n.visitDoneAt)}` : "Build the estimate";
    case "SENT":
      if (!n.viewCount && n.sentAt && n.now.getTime() - n.sentAt.getTime() > 2 * DAY) return `Check ${n.first} got it — not opened since ${n.dayWords(n.sentAt)}`;
      if (n.viewCount >= 2) return `Follow up — opened ${n.viewCount}×${n.viewedAt ? `, last ${n.dayWords(n.viewedAt)}` : ""}, not signed`;
      return n.viewCount ? `Follow up — they opened it ${n.viewedAt ? n.dayWords(n.viewedAt) : ""}`.trim() : "Waiting for them to open it";
    case "NEGOTIATION":
      return `Settle the open points with ${n.first}`;
    case "WON":
      if (n.paidShare !== null && n.paidShare <= 0) return "Collect the deposit";
      if (n.buildStatus === "COMPLETED" && n.paidShare !== null && n.paidShare < 1) return "Collect the final payment";
      if (!n.buildStatus) return "Schedule the job";
      return null;
    default:
      return null;
  }
}

/** Won card stamps: selling, building and getting paid are three different things. */
export function buildWord(status: string | null): string | null {
  if (!status) return "Not scheduled";
  const s = status.toUpperCase();
  return s === "COMPLETED" ? "Built" : s === "IN_PROGRESS" || s === "ACTIVE" ? "In progress" : s === "SCHEDULED" ? "Scheduled" : s === "ON_HOLD" ? "On hold" : s === "CANCELED" ? "Canceled" : status.toLowerCase();
}
export function paidWord(share: number | null): string | null {
  if (share === null) return null;
  if (share >= 0.995) return "Paid";
  if (share <= 0) return "Unpaid";
  return `Paid ${Math.round(share * 100)}%`;
}

/** Words that mean a money worry in the reading engine's money/complaint lines. */
export const PRICE_WORRY = /\b(expensive|too much|over (?:our |my |the )?budget|cheaper|price is high|can'?t afford|lower (?:the )?price|discount)\b/i;
