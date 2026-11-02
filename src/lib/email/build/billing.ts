// A FAILED SUBSCRIPTION PAYMENT (owner, 2026-10-07; rewritten 2026-10-16 to lead with the shop, not the money; lib/cardUpdate): the
// first failed charge, and Stripe's last try. Platform emails — JobFlex's own
// lockup — built the way build/trial.ts builds its reminders: pure, no I/O,
// one box, one button (to /dashboard/subscription, where the ribbon's
// "Update card" opens the card form). Receipts for successful payments are
// Stripe's own (Settings → Customer emails), not ours.
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
/** "Oct 25" — a day inside the next week, no year. */
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

export interface PaymentFailedInput {
  name: string | null;
  /** The plan, by its catalog name. */
  planName: string;
  /** What the failed invoice asks for. */
  amountCents: number;
  /** Stripe's next try; null on the last one. */
  nextAttemptAt: Date | null;
  /** Absolute link to /dashboard/subscription. */
  href: string;
  /** True when Stripe has stopped retrying: the account has moved to Free. */
  final: boolean;
  /** What the shop has running on JobFlex (lib/cardUpdate shopOnJobflex) — the email leads with it. Null or all zero:
   *  the plan's own tools stand in. */
  shop?: ShopOnJobflex | null;
  /** The plan's headline tools ("Smart Proposal", "Roof estimator"…): said when the shop has no numbers yet, and on
   *  the last email as what is paused. */
  tools?: string[];
  /** The first charge after a free trial (the shop has never paid): the plan's tools pause at this moment unless the
   *  card goes through first — 3 days after the trial ended (lib/stripeStatus firstChargeFailed). Null: a renewal,
   *  which keeps the paid period. */
  pausesAt?: Date | null;
}

/** The shop's own work, as the payment emails say it. */
export interface ShopOnJobflex {
  /** Proposals sent in the last 30 days, and what they quoted. */
  proposalsSent: number;
  quotedCents: number;
  clients: number;
  /** Jobs scheduled or under way. */
  jobsOpen: number;
  /** Homeowner leads offered in the last 30 days. */
  leadsOffered: number;
}

function money(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** "$18,400" — a quoted total, whole dollars. */
function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}


/** "Smart Proposal, Roof estimator and Fence estimator". */
export function listWords(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The shop's numbers as box rows — only the ones that are more than zero. */
export function shopRows(shop: ShopOnJobflex | null | undefined): BoxRow[] {
  if (!shop) return [];
  const rows: BoxRow[] = [];
  if (shop.proposalsSent > 0)
    rows.push({ type: "field", label: "Proposals sent · 30 days", value: shop.quotedCents > 0 ? `${shop.proposalsSent} · ${dollars(shop.quotedCents)} quoted` : String(shop.proposalsSent) });
  if (shop.clients > 0) rows.push({ type: "field", label: "Clients", value: String(shop.clients) });
  if (shop.jobsOpen > 0) rows.push({ type: "field", label: "Jobs on the schedule", value: String(shop.jobsOpen) });
  if (shop.leadsOffered > 0) rows.push({ type: "field", label: "Homeowner leads · 30 days", value: String(shop.leadsOffered) });
  return rows;
}

/* THE TONE (owner, 2026-10-16: "doesn't look like we're just chasing their money — they need JobFlex more than we
   need their money"). Both letters lead with THEIR shop — the proposals, clients and jobs it has running on JobFlex,
   in its own numbers when it has them — and say plainly that nothing is lost. The card is the small thing that keeps
   that running; the amount is said once, in passing, never as the headline. Honest about what happens next: the
   date of the next try, and on the last letter what is paused and what still works (Free keeps the client portal). */
export function buildPaymentFailed(i: PaymentFailedInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const amount = money(i.amountCents);
  const rows = shopRows(i.shop);
  const tools = (i.tools ?? []).slice(0, 4);
  const hasNumbers = rows.length > 0;
  if (i.final) {
    const box: BoxRow[] = [
      ...(hasNumbers ? rows : [{ type: "field" as const, label: "Plan", value: i.planName }]),
      { type: "cond", label: "Paused for now", chip: tools.length ? `${tools.length} ${i.planName} tool${tools.length === 1 ? "" : "s"}` : i.planName, tone: "warn" },
    ];
    return {
      subject: `Everything you built is safe — ${i.planName} is paused`,
      lockup: PLATFORM_LOCKUP,
      kicker: { text: `${i.planName} paused`, tone: "warn" },
      headline: "Everything you built is still here",
      prose: [
        `Hi ${first} — we tried the card for ${i.planName} a few times and the bank didn't approve it, so we've paused ${i.planName} and your shop is on the Free plan for now.`,
        hasNumbers
          ? "Nothing is deleted, and your clients can still open and sign what you've sent them. Here's your shop, waiting for you:"
          : "Nothing is deleted, and your clients can still open and sign what you've sent them.",
      ],
      box,
      cta: { label: `Turn ${i.planName} back on`, href: i.href },
      after: [
        `It picks up exactly where you left off — same clients, same proposals, same settings.${tools.length ? ` ${listWords(tools)} ${tools.length === 1 ? "comes" : "come"} straight back.` : ""}`,
        "Need something smaller right now? The same page has every plan — pick the one that fits your season.",
        "Questions? Reply to this email and we'll help.",
      ],
      footer: PLATFORM_FOOTER,
    };
  }
  const nextTry = i.nextAttemptAt ? DATE_FMT.format(i.nextAttemptAt) : null;
  const pauseDay = i.pausesAt ? SHORT_DATE.format(i.pausesAt) : null;
  const box: BoxRow[] = [
    ...(hasNumbers ? rows : tools.length ? [{ type: "field" as const, label: `In ${i.planName}`, value: listWords(tools) }] : [{ type: "field" as const, label: "Plan", value: i.planName }]),
    { type: "cond", label: "Your shop", chip: pauseDay ? `Fully open until ${pauseDay}` : "Open — nothing paused", tone: "ok" },
  ];
  return {
    subject: "Your shop is still open — your card just needs a quick look",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Card didn't go through", tone: "warn" },
    headline: "Keep your shop running",
    prose: [
      pauseDay
        ? `Hi ${first} — your free week is over, and your bank didn't approve the first month of ${i.planName} (${amount}). It happens all the time: a new card, a daily limit, a bank being careful.`
        : `Hi ${first} — your bank didn't approve this month's ${i.planName} (${amount}). It happens all the time: a new card, a daily limit, a bank being careful.`,
      hasNumbers
        ? "Nothing is locked and nothing is lost. Here's what your shop has running on JobFlex right now:"
        : "Nothing is locked and nothing is lost — your proposals, clients and tools are right where you left them.",
    ],
    box,
    cta: { label: "Keep my shop running", href: i.href },
    after: [
      nextTry
        ? `Updating the card takes a minute and sorts it at once. If you'd rather, we'll simply try the same card again on ${nextTry}.`
        : "Updating the card takes a minute and sorts it at once.",
      ...(pauseDay
        ? [`Your shop stays fully open until ${pauseDay}. If the card hasn't gone through by then, the ${i.planName} tools pause until it does — nothing is deleted, and your clients can still open what you've sent.`]
        : []),
      "Questions, or want a different plan? Reply to this email and we'll help.",
    ],
    footer: PLATFORM_FOOTER,
  };
}

/* THE SWITCH TO FREE, BOOKED (owner, 2026-10-13; lib/freePlan): sent when
   the owner cancels from Settings → Billing. It says the one date that
   matters, that nothing more is billed and the data stays, and offers the
   way back — "Keep <plan>" opens Settings → Billing, where it is one press.
   The same letter when JobFlex support cancels it (lib/adminCancel,
   2026-11-01): it does not say "you cancelled", and when the plan ended today
   it says so and offers a plan instead of Keep. */
export interface FreeSwitchBookedInput {
  name: string | null;
  planName: string;
  /** The end of the paid cycle (or the trial): the day the plan switches. */
  switchAt: Date | null;
  /** Absolute link to /dashboard/settings?tab=billing. */
  href: string;
  /** Cancelled by JobFlex support, not by the owner. */
  byJobflex?: boolean;
  /** Ended today — already on the Free plan, nothing left to keep. */
  endedNow?: boolean;
}

export function buildFreeSwitchBooked(i: FreeSwitchBookedInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  if (i.endedNow) {
    return {
      subject: "Your plan has switched to Free",
      lockup: PLATFORM_LOCKUP,
      kicker: { text: "Plan cancelled", tone: "warn" },
      headline: "Your account is on the Free plan",
      prose: [
        `Hi ${first} — your ${i.planName} subscription has been cancelled and ended today. You won't be billed again.`,
        "Your account is on the Free plan now. Your proposals, clients and jobs stay where they are. Nothing is refunded for the days you didn't use.",
      ],
      box: [
        { type: "field", label: "Plan", value: i.planName },
        { type: "field", label: "Next charge", value: "None" },
        { type: "cond", label: "Switched to Free", chip: "Today", tone: "warn" },
      ],
      cta: { label: "Choose a plan", href: i.href },
      after: ["Want it back? Choose a plan any time from Settings → Billing. Questions? Reply to this email."],
      footer: PLATFORM_FOOTER,
    };
  }
  const when = i.switchAt ? DATE_FMT.format(i.switchAt) : null;
  const opener = i.byJobflex ? `your ${i.planName} subscription has been cancelled` : `you cancelled ${i.planName}`;
  return {
    subject: when ? `Your plan switches to Free on ${when}` : "Your plan switches to Free at the end of this cycle",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Plan cancelled", tone: "warn" },
    headline: when ? `Your plan switches to Free on ${when}` : "Your plan switches to Free",
    prose: [
      `Hi ${first} — ${opener}. You keep it until ${when ?? "the end of the cycle you've already paid for"}, and you won't be billed again.`,
      "Then your account moves to the Free plan. Your proposals, clients and jobs stay where they are. Nothing is refunded for the days you don't use.",
    ],
    box: [
      { type: "field", label: "Plan", value: i.planName },
      { type: "field", label: "Next charge", value: "None" },
      { type: "cond", label: "Switches to Free", chip: when ?? "End of cycle", tone: "warn" },
    ],
    cta: { label: `Keep ${i.planName}`, href: i.href },
    after: ["Changed your mind? Keep your plan any time before that date from Settings → Billing. Questions? Reply to this email."],
    footer: PLATFORM_FOOTER,
  };
}
