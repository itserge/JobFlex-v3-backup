// WHO CAME BACK (owner, 2026-10-28: "check if anybody started paying after the trial expired with no card, or
// cancelled during the trial and came back and decided to pay").
//
// Two records say so. A card-less trial that ended with no card (lib/trialState, SyncState cardlessTrial:<org>)
// gets `restartedAt` the day a card restarts the plan (lib/cardlessTrial, the trial-restart checkout) — that is
// "paid after the trial ran out", to the day. A cancellation booked from the Subscription page is a CancellationFeedback
// row; when that company's subscription is active again, it came back — the day is not recorded (the subscription
// row is overwritten), so the next invoice date is shown instead. A cancel made outside the app (Stripe's own
// dashboard) leaves no row here; the win-back mails (lib/trialWinback) say whether the 10% offer went out before
// the restart. Pure: the read (lib/cameBackRead) fetches, this shapes; qa/tests/logic/came-back.check.ts proves it.

export interface CameBackOrg {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  plan: string;
  status: string;
  trialEndsAt: number | null;
  currentPeriodEnd: number | null;
}
export interface CameBackCardless {
  orgId: string;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  cardAt: number | null;
  restartedAt: number | null;
  test: boolean;
}
export interface CameBackCancel {
  id: string;
  orgId: string;
  createdAt: number;
  periodEnd: number | null;
}
export interface CameBackWinback {
  orgId: string;
  /** Mails that went out (a stage skipped for a later one is not a mail). */
  mails: number;
  offerSentAt: number | null;
}
export interface CameBackInput {
  now: number;
  orgs: CameBackOrg[];
  cardless: CameBackCardless[];
  cancels: CameBackCancel[];
  winbacks: CameBackWinback[];
}

export type NowWord = "paying" | "trial" | "failing" | "gone";
/** What the subscription row says today. */
export function nowOf(status: string): NowWord {
  switch ((status || "").trim().toUpperCase()) {
    case "ACTIVE": return "paying";
    case "TRIALING": return "trial";
    case "PAST_DUE": case "UNPAID": return "failing";
    default: return "gone";
  }
}
export const NOW_WORDS: Record<NowWord, string> = { paying: "Paying now", trial: "On a trial again", failing: "Paying, payment failing", gone: "Still gone" };
/** A company that pays again, in any of its forms. */
export const isBack = (w: NowWord) => w !== "gone";

export interface RestartedRow {
  orgId: string;
  name: string;
  email: string;
  planNow: string;
  now: NowWord;
  trialEnded: number | null;
  paidOn: number;
  /** Days between the trial's end and the restart. */
  daysAfter: number | null;
  mailsBefore: number;
  /** The 10% offer had gone out before they restarted. */
  afterOffer: boolean;
}
export interface CancelledRow {
  id: string;
  orgId: string;
  name: string;
  email: string;
  planNow: string;
  now: NowWord;
  cancelledOn: number;
  /** The cancel fell inside a trial (the subscription's or the card-less record's end was still ahead). */
  duringTrial: boolean;
  nextInvoice: number | null;
}
export interface CameBack {
  restarted: RestartedRow[];
  cancelledBack: CancelledRow[];
  /** Every cancellation row's state today, by its id — for the column on the cancellations table. */
  nowByCancel: Record<string, { now: NowWord; duringTrial: boolean }>;
  counts: {
    /** Companies that came back, each counted once however it left. */
    back: number;
    restarted: number;
    afterOffer: number;
    cancelledBack: number;
    cancelledDuringTrialBack: number;
    /** Card-less trials that ended with no card, in all — the base the restarts are a share of. */
    cardlessEnded: number;
    cancels: number;
  };
}

const DAY = 86_400_000;

export function shapeCameBack(input: CameBackInput): CameBack {
  const orgs = new Map(input.orgs.map((o) => [o.id, o]));
  const cardlessByOrg = new Map(input.cardless.map((c) => [c.orgId, c]));
  const winbackByOrg = new Map(input.winbacks.map((w) => [w.orgId, w]));

  const restarted: RestartedRow[] = input.cardless
    .filter((c) => c.restartedAt !== null && !c.test && orgs.has(c.orgId))
    .map((c) => {
      const o = orgs.get(c.orgId) as CameBackOrg;
      const w = winbackByOrg.get(c.orgId);
      const paidOn = c.restartedAt as number;
      const ended = c.endedAt ?? c.endsAt;
      return {
        orgId: o.id,
        name: o.name,
        email: o.email,
        planNow: o.plan,
        now: nowOf(o.status),
        trialEnded: ended,
        paidOn,
        daysAfter: ended !== null ? Math.max(0, Math.round((paidOn - ended) / DAY)) : null,
        mailsBefore: w ? w.mails : 0,
        afterOffer: !!w?.offerSentAt && w.offerSentAt <= paidOn,
      };
    })
    .sort((a, b) => b.paidOn - a.paidOn);

  const nowByCancel: CameBack["nowByCancel"] = {};
  const cancelledBack: CancelledRow[] = [];
  for (const c of input.cancels) {
    const o = orgs.get(c.orgId);
    if (!o) continue;
    const card = cardlessByOrg.get(c.orgId);
    const trialEnd = card?.endsAt ?? o.trialEndsAt;
    // The cancel fell inside a trial when a trial's end was still ahead of it (a company put on a new trial since
    // reads the same way — the row holds only the latest trial), or the period it cancelled was the trial itself.
    const duringTrial = (trialEnd !== null && trialEnd !== undefined && c.createdAt <= trialEnd) || (c.periodEnd !== null && o.trialEndsAt !== null && Math.abs(c.periodEnd - o.trialEndsAt) < DAY);
    const now = nowOf(o.status);
    nowByCancel[c.id] = { now, duringTrial };
    if (isBack(now)) cancelledBack.push({ id: c.id, orgId: o.id, name: o.name, email: o.email, planNow: o.plan, now, cancelledOn: c.createdAt, duringTrial, nextInvoice: o.currentPeriodEnd });
  }
  cancelledBack.sort((a, b) => b.cancelledOn - a.cancelledOn);

  const backIds = new Set([...restarted.filter((r) => isBack(r.now)).map((r) => r.orgId), ...cancelledBack.map((r) => r.orgId)]);
  return {
    restarted,
    cancelledBack,
    nowByCancel,
    counts: {
      back: backIds.size,
      restarted: restarted.length,
      afterOffer: restarted.filter((r) => r.afterOffer).length,
      cancelledBack: cancelledBack.length,
      cancelledDuringTrialBack: cancelledBack.filter((r) => r.duringTrial).length,
      cardlessEnded: input.cardless.filter((c) => !c.test && orgs.has(c.orgId) && (c.endedAt !== null || c.restartedAt !== null)).length,
      cancels: input.cancels.length,
    },
  };
}
