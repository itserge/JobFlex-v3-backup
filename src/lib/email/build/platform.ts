// Pure (record) → EmailDoc builders for the five platform-facing emails. No
// I/O, so the gallery can render them from fixtures and the senders stay
// thin. Four of five use the PLATFORM lockup and a "JobFlex" footer — this
// is mail from JobFlex itself, never a faked org identity (principle 20).
// buildTestEmail is the one exception: it exists to prove an org's OWN
// lockup renders, so it deliberately uses the contractor lockup.
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { truncate } from "../fit";
import type { OrgBrand } from "./client";
import type { FirstEstimateTrade } from "@/lib/firstEstimate";

const TITLE_MAX = 70;

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };

function orgLockup(org: OrgBrand): Lockup {
  return { kind: "org", name: org.name, logoUrl: org.logoUrl ?? null, orgId: org.id ?? null };
}

function orgFooter(org: OrgBrand) {
  return { name: org.name, contact: org.phone ?? undefined };
}

export interface PasswordResetInput {
  name: string | null;
  href: string;
}

/**
 * One-row box, tone warn — the deadline is the only thing worth boxing. Worded
 * "Link expires / In 1 hour" to match the other link-expiry rows in the fleet
 * (partner invite, worker invite) rather than drifting to its own phrasing.
 */
export function buildPasswordReset(i: PasswordResetInput): EmailDoc {
  const box: BoxRow[] = [{ type: "cond", label: "Link expires", chip: "In 1 hour", tone: "warn" }];
  return {
    subject: "Reset your JobFlex password",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Security" },
    headline: "Reset your password",
    prose: [
      `Hi ${i.name?.split(" ")[0] ?? "there"} — we received a request to reset the password for your JobFlex account.`,
    ],
    box,
    cta: { label: "Set a new password", href: i.href },
    fine: "Didn't ask for this? Ignore the email — your password won't change.",
    footer: PLATFORM_FOOTER,
  };
}

export interface AccountReadyInput {
  name: string | null;
  /** The sign-in address. */
  email: string;
  workspace: string;
  /** The plan's display name, e.g. "Professional". */
  planName: string;
  /** /auth/reset?token=… — the ordinary reset link, minted for 24 hours. */
  href: string;
}

/**
 * A paying subscriber carried over from the old app (2026-10-01): the account
 * exists, the subscription is already attached, and the one thing left is a
 * password. Same link and page as a password reset, with a day instead of an
 * hour — the address was not the one asking.
 */
export function buildAccountReady(i: AccountReadyInput): EmailDoc {
  return {
    subject: "Your JobFlex account is ready — set your password",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Account" },
    headline: "Your account is ready",
    prose: [
      `Hi ${i.name?.trim().split(/\s+/)[0] || "there"} — your JobFlex account is set up, and your ${i.planName} subscription is connected to it. Your billing stays exactly as it is.`,
      "Set a password to sign in.",
    ],
    box: [
      { type: "field", label: "Sign-in email", value: i.email },
      { type: "field", label: "Workspace", value: i.workspace },
      { type: "field", label: "Plan", value: i.planName },
      { type: "cond", label: "Link expires", chip: "In 24 hours", tone: "warn" },
    ],
    cta: { label: "Set your password", href: i.href },
    fine: "The link works once. If it has expired, use “Forgot password” on the sign-in page.",
    footer: PLATFORM_FOOTER,
  };
}

export interface WelcomeFirstEstimateInput {
  name: string;
  /** Absolute link to the trade's estimator (lib/firstEstimate). */
  href: string;
  /** The button's words, e.g. "Measure my first roof". */
  ctaLabel: string;
  /** What the estimator does, in one line, for the prose. */
  trade: FirstEstimateTrade;
  /** "Sep 25, 2026" — the day the card is first charged (the trial's end). */
  firstChargeDate: string;
  trialDays?: number;
  /** A card-less trial: the box and the closing line say there is no card,
   *  and when to add one to keep the workspace. */
  cardless?: boolean;
}

/** landing-e pass A (2026-09-11): the welcome for the test variant. One
 *  button — the trade's first estimate — and the trial's terms in the box:
 *  the assigned trial length, the date of the first charge, cancel from the Subscription page. */
export function buildWelcomeFirstEstimate(i: WelcomeFirstEstimateInput): EmailDoc {
  const first = i.name.trim().split(/\s+/)[0] || "there";
  const job =
    i.trade === "roofing"
      ? "Type an address, and the roof is measured from the aerial: squares, pitch, waste, a priced proposal — two minutes, no ladder."
      : i.trade === "fencing"
        ? "Draw the fence line on the map, pick the style and height, and the footage, posts, gates and price are on a proposal — two minutes, no tape."
        : i.trade === "hvac"
          ? "Type the address, and the house comes back from the records: the load at your design day, the unit that fits, a priced replacement proposal — two minutes."
          : "Type the job the way you'd say it to a customer, and the estimate writes itself: line items, quantities, a priced proposal — two minutes.";
  const box: BoxRow[] = i.cardless
    ? [
        { type: "field", label: "Trial", value: `${i.trialDays ?? 7} days free` },
        { type: "field", label: "Trial ends", value: i.firstChargeDate },
        { type: "cond", label: "Card", chip: "None needed to start", tone: "ok" },
      ]
    : [
        { type: "field", label: "Trial", value: `${i.trialDays ?? 7} days free` },
        { type: "field", label: "First charge", value: i.firstChargeDate },
        { type: "cond", label: "Cancel", chip: "Anytime, from the Subscription page", tone: "ok" },
      ];
  return {
    subject: "Your first estimate in 2 minutes",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Welcome" },
    headline: "Your first estimate in 2 minutes",
    prose: [`Hi ${first} — your shop is set up. The fastest first win is an estimate, so start there.`, job],
    box,
    cta: { label: i.ctaLabel, href: i.href },
    after: [
      i.cardless
        ? `No card needed. If you decide to stay after ${i.firstChargeDate}, you can add one any time from Subscription.`
        : `Your card won't be charged until ${i.firstChargeDate}. Cancel before then from the Subscription page and you pay nothing.`,
    ],
    footer: PLATFORM_FOOTER,
  };
}

/** The homeowner's home dashboard (lib/home/portal), named in every homeowner email. */
const homeLine = (url: string) => `Your home dashboard — every project in one place, no account needed: ${url}`;

export interface RequestReceivedInput {
  name: string;
  projectType: string | null;
  /** The homeowner's status page (/request/[token]); null for legacy rows with no token. */
  statusUrl?: string | null;
  /** /home/[key] — the dashboard every project of theirs lives on. */
  homeUrl?: string | null;
}

/** Solo anchor; the CTA is the homeowner's one link into the system. */
export function buildRequestReceived(i: RequestReceivedInput): EmailDoc {
  return {
    subject: "We got your request — matching you with a pro",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Received" },
    headline: "We're on it",
    prose: [
      `Hi ${i.name.split(" ")[0]} — thanks for telling us about your project${
        i.projectType ? ` (${i.projectType})` : ""
      }. We're matching you with a qualified local contractor now.`,
    ],
    box: [{ type: "anchor", label: "You'll hear back", value: "Within 24h" }],
    ...(i.statusUrl ? { cta: { label: "Track your request", href: i.statusUrl } } : {}),
    ...(i.homeUrl ? { after: [homeLine(i.homeUrl)] } : {}),
    footer: PLATFORM_FOOTER,
  };
}

export interface HomeownerMatchedInput {
  name: string;
  orgName: string;
  phone: string | null;
  /** Pre-formatted by the caller, e.g. "4.8" or "New" for a shop with no reviews yet. */
  rating: string;
  projectType: string | null;
  /** The homeowner's status page (/request/[token]); null for legacy rows with no token. */
  statusUrl?: string | null;
  homeUrl?: string | null;
}

/** Box: Phone and Rating (no call-by promise — nothing enforces one). CTA opens the status page. */
export function buildHomeownerMatched(i: HomeownerMatchedInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Phone", value: i.phone ?? "—" },
    { type: "field", label: "Rating", value: i.rating },
  ];
  return {
    subject: `You're matched — ${i.orgName} will be in touch`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Matched", tone: "ok" },
    headline: "You're matched",
    prose: [
      `Hi ${i.name.split(" ")[0]} — good news: ${i.orgName} has taken on your ${
        i.projectType ?? "project"
      } request and will reach out shortly.`,
    ],
    box,
    ...(i.statusUrl ? { cta: { label: "View your request", href: i.statusUrl } } : {}),
    ...(i.homeUrl ? { after: [homeLine(i.homeUrl)] } : {}),
    fine: i.statusUrl
      ? "If it doesn't work out with this contractor, the request page lets you ask for another one."
      : undefined,
    footer: PLATFORM_FOOTER,
  };
}

// ── "Find me another contractor" (the homeowner's re-route button) ───────────

export interface ShopClientRerouteInput {
  orgName: string;
  homeownerName: string;
  projectType: string | null;
  /** The homeowner's optional reason — shown verbatim when present (owner's rule #4). */
  reason: string | null;
}

/**
 * Honest and unsoftened, to the shop that had the lead: the client asked for
 * another contractor. Does not touch their responsiveness score and says so —
 * the one question every recipient of this email asks.
 */
export function buildShopClientReroute(i: ShopClientRerouteInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Project", value: i.projectType ?? "General" },
    ...(i.reason ? [{ type: "field", label: "Their reason", value: i.reason } as BoxRow] : []),
  ];
  return {
    subject: `${i.homeownerName} asked to be matched with another contractor`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Lead update", tone: "warn" },
    headline: "The client asked for another contractor",
    prose: [
      `${i.homeownerName} has asked us to match their ${
        i.projectType ?? "project"
      } request with a different contractor, so it has been withdrawn from your board. The lead is marked lost in your pipeline for your records.`,
      "This does not affect your standing or your ranking for future leads.",
    ],
    box,
    footer: PLATFORM_FOOTER,
  };
}

export interface HomeownerReroutingInput {
  name: string;
  projectType: string | null;
  statusUrl: string | null;
  homeUrl?: string | null;
}

/** Confirmation to the homeowner right after they pressed the button. */
export function buildHomeownerRerouting(i: HomeownerReroutingInput): EmailDoc {
  return {
    subject: "Got it — finding you another contractor",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Re-matching" },
    headline: "We're finding you another pro",
    prose: [
      `Hi ${i.name.split(" ")[0]} — understood. We've released your ${
        i.projectType ?? "project"
      } request from the previous contractor and are matching you with the next qualified pro in your area.`,
    ],
    box: [{ type: "anchor", label: "You'll hear back", value: "Within 24h" }],
    ...(i.statusUrl ? { cta: { label: "Track your request", href: i.statusUrl } } : {}),
    ...(i.homeUrl ? { after: [homeLine(i.homeUrl)] } : {}),
    footer: PLATFORM_FOOTER,
  };
}

export interface HomeownerManualQueueInput {
  name: string;
  projectType: string | null;
  statusUrl: string | null;
  homeUrl?: string | null;
}

/**
 * The pool ran dry (owner's rule #3): a person takes over, and no timeframe is
 * promised — "we'll be in touch" is the whole commitment.
 */
export function buildHomeownerManualQueue(i: HomeownerManualQueueInput): EmailDoc {
  return {
    // Neutral (owner, 2026-10-03): the homeowner is not told HOW the match is
    // made, only that it is being made.
    subject: "We're finding the right contractor for you",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "In progress" },
    headline: "We're finding the right contractor for you",
    prose: [
      `Hi ${i.name.split(" ")[0]} — we're finding the right local contractor for your ${
        i.projectType ?? "project"
      } request. We'll email you as soon as one takes it on.`,
    ],
    ...(i.statusUrl ? { cta: { label: "Track your request", href: i.statusUrl } } : {}),
    ...(i.homeUrl ? { after: [homeLine(i.homeUrl)] } : {}),
    footer: PLATFORM_FOOTER,
  };
}

// ── The home dashboard (2026-10-03, lib/home/portal) ─────────────────────────

export interface HomeLinkInput {
  name: string;
  homeUrl: string;
  /** How many projects the dashboard holds. */
  projects: number;
}

/** "Lost the link?" — the homeowner typed their email on /home. */
export function buildHomeLink(i: HomeLinkInput): EmailDoc {
  return {
    subject: "Your JobFlex home dashboard",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Your home" },
    headline: "Here's your home dashboard",
    prose: [
      `Hi ${i.name.split(" ")[0]} — this link opens your home dashboard: ${i.projects === 1 ? "your project" : `your ${i.projects} projects`}, the proposals, your contractors and the jobs you're planning. No password; keep the link.`,
    ],
    cta: { label: "Open your home dashboard", href: i.homeUrl },
    fine: "If you didn't ask for this, ignore it — nothing changes.",
    footer: PLATFORM_FOOTER,
  };
}

export interface HomePlanReminderInput {
  name: string;
  title: string;
  /** "November 2026" or "Nov 14, 2026". */
  when: string;
  /** Days until the plan's month; 0 when it has come. */
  daysAway: number;
  /** The second nudge, two weeks after the first; the series ends with it. */
  followUp: boolean;
  notes: string | null;
  /** The intake, prefilled with the plan. */
  submitUrl: string;
  homeUrl: string;
}

/** The time the homeowner chose has come: a nudge to submit the plan. */
export function buildHomePlanReminder(i: HomePlanReminderInput): EmailDoc {
  const first = i.name.split(" ")[0];
  const away = i.daysAway >= 12 ? "about two weeks away" : i.daysAway >= 5 ? "about a week away" : i.daysAway > 0 ? `${i.daysAway} day${i.daysAway === 1 ? "" : "s"} away` : null;
  const lead = i.followUp
    ? `Hi ${first} — still planning this${i.daysAway > 0 ? ` for ${i.when}` : ""}? Submit it in a minute and we'll find you a local contractor — or move it to another month, or take it off your plans. Either way, this is our last nudge about it.`
    : away
      ? `Hi ${first} — ${i.when} is ${away}, and you planned this for it. Ready? Describe it in a minute and we'll find you a local contractor on JobFlex, so they can look before the month starts.`
      : `Hi ${first} — you planned this for ${i.when}. Ready? Describe it in a minute and we'll find you a local contractor on JobFlex.`;
  return {
    subject: i.followUp ? `Still planning your ${truncate(i.title, 50)}?` : `Ready for your ${truncate(i.title, 60)}?`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: i.followUp ? "Your plan · last nudge" : "Your plan" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [lead, ...(i.notes ? [`Your note: “${truncate(i.notes, 240)}”`] : [])],
    cta: { label: "Submit it now", href: i.submitUrl },
    after: [`${i.followUp ? "Move it or remove it" : "Not yet? It stays"} on your home dashboard: ${i.homeUrl}`],
    footer: PLATFORM_FOOTER,
  };
}

export interface PriceRangeEmailInput {
  name: string | null;
  address: string;
  /** "$14,200–$19,800" */
  range: string;
  materialLabel: string;
  /** "about 2,100 sq ft of roof · 6/12 pitch · read from aerial data" */
  basis: string;
  included: string[];
  /** The flow, picked up at "Get quotes" — or the request page when they already asked. */
  quotesUrl: string;
  quotesLabel: string;
  homeUrl: string;
  /** The fine print, by where the number came from (lib/publicEstimate/roof disclaimerFor). */
  fine: string;
}

/** "Your roof range" (2026-10-27): the number they saw, what's in it, and the one next step. */
export function buildPriceRangeEmail(i: PriceRangeEmailInput): EmailDoc {
  const first = i.name ? i.name.split(" ")[0] : null;
  return {
    subject: `Your roof range: ${i.range}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Your roof range" },
    headline: i.range,
    prose: [
      `${first ? `Hi ${first} — here` : "Here"} is the range you priced for ${i.address}: ${i.materialLabel.toLowerCase()}, ${i.basis}.`,
      ...(i.included.length ? [`What's in it: ${i.included.slice(0, 5).join(" ")}`] : []),
    ],
    cta: { label: i.quotesLabel, href: i.quotesUrl },
    after: [`It stays on your home dashboard: ${i.homeUrl}`],
    fine: i.fine,
    footer: PLATFORM_FOOTER,
  };
}

export interface HomePlanSavedInput {
  name: string;
  title: string;
  when: string;
  /** "Oct 18, 2026" — when the reminder lands; null when they chose none. */
  remindOn: string | null;
  notes: string | null;
  homeUrl: string;
}

/** The moment a plan is saved: what was planned, when the reminder comes. */
export function buildHomePlanSaved(i: HomePlanSavedInput): EmailDoc {
  return {
    subject: `Planned: ${truncate(i.title, 50)} — ${i.when}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "On your plans" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [
      `Hi ${i.name.split(" ")[0]} — it's on your home dashboard for ${i.when}.`,
      i.remindOn ? `We'll email you on ${i.remindOn} to get it started — one tap sends it to a local pro on JobFlex. If nothing happens, one more nudge two weeks later, then we leave it to you.` : "No reminder, as you chose — whenever you're ready, one tap on your dashboard sends it to a local pro on JobFlex.",
      ...(i.notes ? [`Your note: “${truncate(i.notes, 240)}”`] : []),
    ],
    cta: { label: "Open your home dashboard", href: i.homeUrl },
    footer: PLATFORM_FOOTER,
  };
}

export interface HomeFilesRequestInput {
  name: string;
  orgName: string;
  project: string;
  note: string | null;
  /** The dashboard, at that project's folder. */
  href: string;
}

/** To the homeowner: the shop asks for pictures (lib/home/files). */
export function buildHomeFilesRequest(i: HomeFilesRequestInput): EmailDoc {
  return {
    subject: `${truncate(i.orgName, 40)} asks for photos of your ${truncate(i.project, 40)}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Photos wanted" },
    headline: `${truncate(i.orgName, 40)} could use some pictures`,
    prose: [
      `Hi ${i.name.split(" ")[0]} — ${i.orgName} would like to see a bit more before they price your ${i.project}.`,
      ...(i.note ? [`They wrote: “${truncate(i.note, 400)}”`] : []),
      "Add them from your home dashboard — a few photos from your phone, or a short video walking through it. They go straight to the contractor's folder for this job.",
    ],
    cta: { label: "Add photos", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface HomeFilesAddedInput {
  homeownerName: string;
  /** "3 photos", "a video". */
  what: string;
  project: string;
  note: string | null;
  leadUrl: string;
}

/** To the shop: the homeowner added files to the job folder. Reply-to is the homeowner. */
export function buildHomeFilesAdded(i: HomeFilesAddedInput): EmailDoc {
  return {
    subject: `${truncate(i.homeownerName, 40)} added ${i.what} — ${truncate(i.project, 50)}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Job folder" },
    headline: `${truncate(i.homeownerName, 40)} added ${i.what}`,
    prose: [
      `About: ${truncate(i.project, 120)}. The files are in the job folder on the lead — open it to look, download, or put a picture on the proposal.`,
      ...(i.note ? [`Their note: “${truncate(i.note, 400)}”`] : []),
    ],
    cta: { label: "Open the job folder", href: i.leadUrl },
    after: ["Reply to this email to answer — it goes straight to them."],
    footer: PLATFORM_FOOTER,
  };
}

export interface HomeownerMessageInput {
  homeownerName: string;
  orgName: string;
  /** The project, as the shop knows it. */
  project: string;
  body: string;
  /** The shop's lead page in JobFlex. */
  leadUrl: string;
}

/** To the shop: what the homeowner wrote from their dashboard. Reply-to is the homeowner. */
export function buildHomeownerMessage(i: HomeownerMessageInput): EmailDoc {
  return {
    subject: `${truncate(i.homeownerName, 40)} sent you a message — ${truncate(i.project, 50)}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Message from your client" },
    headline: `${truncate(i.homeownerName, 40)} wrote`,
    prose: [`“${truncate(i.body, 1500)}”`, `About: ${truncate(i.project, 120)}.`],
    cta: { label: "Open the lead in JobFlex", href: i.leadUrl },
    after: ["Reply to this email to answer — it goes straight to them."],
    footer: PLATFORM_FOOTER,
  };
}

export interface PartnerInviteInput {
  name: string;
  code?: string | null;
  href: string;
}

/** Same shape as buildWorkerInvite — a promo code becomes an extra field row when present. */
export function buildPartnerInvite(i: PartnerInviteInput): EmailDoc {
  const box: BoxRow[] = [];
  if (i.code) box.push({ type: "field", label: "Promo code", value: i.code });
  box.push({ type: "cond", label: "Link expires", chip: "In 7 days" });
  const first = i.name.trim().split(" ")[0] || "there";
  return {
    subject: "Your JobFlex partner account",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner" },
    headline: "You're set up as a partner",
    prose: [
      `Hi ${first} — you've been set up as a JobFlex partner. Share your link, watch your referrals convert, and request payouts from your partner dashboard.`,
    ],
    box,
    cta: { label: "Set your password", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface PartnerPasswordResetInput {
  name: string;
  href: string;
}

/** "Forgot password" for a partner: the user reset's shape with the partner kicker. */
export function buildPartnerPasswordReset(i: PartnerPasswordResetInput): EmailDoc {
  const first = i.name.trim().split(" ")[0] || "there";
  return {
    subject: "Reset your JobFlex partner password",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner" },
    headline: "Reset your password",
    prose: [`Hi ${first} — we received a request to reset the password for your JobFlex partner account.`],
    box: [{ type: "cond", label: "Link expires", chip: "In 1 hour", tone: "warn" }],
    cta: { label: "Set a new password", href: i.href },
    fine: "Didn't ask for this? Ignore the email — your password won't change.",
    footer: PLATFORM_FOOTER,
  };
}

/* ── THE PARTNER'S MONEY, IN THE MAIL (owner, 2026-09-22) ──
 * Four moments a partner should hear about without opening the portal: a
 * payout approved (and when it goes out), sent (and where), declined (and
 * why), and a commission frozen by a customer's dispute or taken back by a
 * lost one. Sent from lib/influencerMail at the points that change the
 * status. The amounts arrive formatted ("$63.20"); the dates as "Sep 23, 2026". */

export interface PartnerPayoutApprovedInput {
  name: string;
  amount: string;
  /** The day of the next payout run. */
  expectedDate: string;
  href: string;
}

export function buildPartnerPayoutApproved(i: PartnerPayoutApprovedInput): EmailDoc {
  const first = i.name.trim().split(" ")[0] || "there";
  return {
    subject: `Your ${i.amount} payout is approved`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner · Payout" },
    headline: "Your payout is approved",
    prose: [
      `Hi ${first} — your payout request was approved. It goes out on the next daily run, to the Stripe account you connected.`,
    ],
    box: [
      { type: "item", name: "Payout", amount: i.amount },
      { type: "cond", label: "Sent on", chip: i.expectedDate },
    ],
    cta: { label: "See your payouts", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface PartnerPayoutSentInput {
  name: string;
  amount: string;
  /** The last four characters of the connected Stripe account's id. */
  accountLast4: string;
  /** The Stripe transfer id, for the partner's own records. */
  reference: string | null;
  href: string;
}

export function buildPartnerPayoutSent(i: PartnerPayoutSentInput): EmailDoc {
  const first = i.name.trim().split(" ")[0] || "there";
  const box: BoxRow[] = [
    { type: "item", name: "Payout", amount: i.amount },
    { type: "field", label: "To", value: `Stripe account ····${i.accountLast4}` },
  ];
  if (i.reference) box.push({ type: "field", label: "Reference", value: i.reference });
  return {
    subject: `Your ${i.amount} payout is on its way`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner · Payout" },
    headline: "Your payout is on its way",
    prose: [
      `Hi ${first} — ${i.amount} has left for your Stripe account. Stripe pays it out to your bank on its own schedule, usually within a couple of business days.`,
    ],
    box,
    cta: { label: "See your payouts", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface PartnerPayoutDeclinedInput {
  name: string;
  amount: string;
  reason: string | null;
  href: string;
}

export function buildPartnerPayoutDeclined(i: PartnerPayoutDeclinedInput): EmailDoc {
  const first = i.name.trim().split(" ")[0] || "there";
  return {
    subject: `Your ${i.amount} payout request was declined`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner · Payout", tone: "warn" },
    headline: "Your payout request was declined",
    prose: [
      `Hi ${first} — your request for ${i.amount} was declined. The money stays in your balance; you can request it again once the reason below is resolved.`,
    ],
    box: [
      { type: "item", name: "Requested", amount: i.amount },
      { type: "field", label: "Reason", value: i.reason?.trim() || "No reason was given — write to your JobFlex contact." },
    ],
    cta: { label: "See your payouts", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface PartnerCommissionHeldInput {
  name: string;
  amount: string;
  openedDate: string;
  href: string;
}

export function buildPartnerCommissionHeld(i: PartnerCommissionHeldInput): EmailDoc {
  const first = i.name.trim().split(" ")[0] || "there";
  return {
    subject: `${i.amount} of your commission is on hold`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner · Commission", tone: "warn" },
    headline: "A commission is on hold",
    prose: [
      `Hi ${first} — a customer disputed a payment with their bank. The commission on that payment is frozen while the dispute is open: it is not clearing and cannot be paid out. If the dispute is won, it goes back to clearing; if it is lost, it is taken back, as a refund would be.`,
    ],
    box: [
      { type: "item", name: "On hold", amount: i.amount },
      { type: "cond", label: "Dispute opened", chip: i.openedDate, tone: "warn" },
    ],
    cta: { label: "See your earnings", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface PartnerChargebackInput {
  name: string;
  amount: string;
  closedDate: string;
  href: string;
}

export function buildPartnerChargeback(i: PartnerChargebackInput): EmailDoc {
  const first = i.name.trim().split(" ")[0] || "there";
  return {
    subject: `${i.amount} of your commission was taken back`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Partner · Commission", tone: "warn" },
    headline: "A commission was taken back",
    prose: [
      `Hi ${first} — a customer's dispute was lost, so the commission on that payment is taken back, the same as a full refund. If it had already been paid out, your balance goes negative and the next commissions pay it back before anything is transferred.`,
    ],
    box: [
      { type: "item", name: "Taken back", amount: i.amount },
      { type: "cond", label: "Dispute lost", chip: i.closedDate, tone: "warn" },
    ],
    cta: { label: "See your earnings", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

export interface TestEmailInput {
  org: OrgBrand;
}

/**
 * Smallest build in the system: lockup, one prose line, footer. No box, no
 * CTA. Uses the CONTRACTOR lockup, not platform — it proves the org's own
 * lockup renders.
 */
export function buildTestEmail(i: TestEmailInput): EmailDoc {
  return {
    subject: "JobFlex test email",
    lockup: orgLockup(i.org),
    headline: "This is a test",
    prose: ["If you're reading this, sending works."],
    footer: orgFooter(i.org),
  };
}
