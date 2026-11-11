// THE CONTRACTOR EMAIL, SERVER SIDE (2026-10-08; the words are in ./compose).
// What the composer is told about one account — read from the database and,
// for the 10% offer, from Stripe — and the send: the offer applied first,
// then the mail from the platform address with replies to the admin who
// wrote it, then a line in the account's history. Every caller is an admin
// action that has checked the admin first (src/actions/adminMail.ts).
import "server-only";
import { db } from "@/lib/db";
import { cardlessTrialState, type CardlessTrialState } from "@/lib/trialState";
import { trialPlanSummary } from "@/lib/cardlessTrial";
import { getPlanBySlug } from "@/lib/planCatalogServer";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { VARIANT_TRADE, resolveLandingVariant } from "@/components/v3/landing-e/landing-variants";
import { OFFER_DAYS, OFFER_MONTHS, OFFER_PCT, ensureWinbackCoupon, grantWinbackOffer, readWinback } from "@/lib/trialWinback";
import { contractorLetter, firstNameOf, type AccountKind, type ContractorProfile, type Draft, type OfferState, type SentMail, type TopicKey, type TradeKey } from "./compose";
import { readOptOut, unsubscribeHeaders, unsubscribeUrl } from "./optout";

const DAY_MS = 86_400_000;
const HISTORY_KEY = (orgId: string) => `adminMail:${orgId}`;
const HISTORY_KEEP = 25;

const TRADE_KEY: Record<string, TradeKey> = { Roofing: "roofing", Fencing: "fencing", HVAC: "hvac" };

/** The trade the mails speak to: an estimator trade the owner picked first,
 *  else the first trade picked, else the trade hero the ad showed, else the
 *  "Other" text. */
function tradeOf(org: { tradeTypesJson: string | null; landingIndustry: string | null; otherTrade: string | null }): { key: TradeKey; name: string; all: string[] } {
  const picked: string[] = parseTradeTypes(org.tradeTypesJson);
  const landing = resolveLandingVariant(org.landingIndustry);
  const fromAd = landing ? VARIANT_TRADE[landing] : null;
  const name = picked.find((t) => TRADE_KEY[t]) ?? picked[0] ?? fromAd ?? org.otherTrade?.trim() ?? "";
  return { key: TRADE_KEY[name] ?? "general", name, all: picked.length ? picked : fromAd ? [fromAd] : [] };
}

const money = (cents: number, per: string) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0 })}${per}`;

interface Account { profile: ContractorProfile; ownerEmail: string | null; subId: string | null }

/** Everything the composer shows for one account, and what the send needs. Null when there is no such account. */
export async function readContractor(orgId: string, now = new Date()): Promise<Account | null> {
  const org = await db.organization.findFirst({
    where: { id: orgId, deletedAt: null },
    select: {
      id: true, name: true, createdAt: true, isInternal: true, tradeTypesJson: true, landingIndustry: true, otherTrade: true,
      memberships: { orderBy: { createdAt: "asc" }, select: { role: true, user: { select: { email: true, name: true } } } },
    },
  });
  if (!org) return null;
  const owner = org.memberships.find((m) => m.role === "OWNER")?.user ?? org.memberships[0]?.user ?? null;
  const [sub, cardless, built, seen, history, optedOut] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId: orgId }, select: { plan: true, status: true, provider: true, externalSubId: true, trialEndsAt: true } }).catch(() => null),
    cardlessTrialState(orgId, now).catch(() => null),
    Promise.all([
      db.client.count({ where: { organizationId: orgId } }).catch(() => 0),
      db.proposal.count({ where: { organizationId: orgId } }).catch(() => 0),
      db.job.count({ where: { organizationId: orgId } }).catch(() => 0),
    ]),
    db.pageView.findFirst({ where: { organizationId: orgId }, orderBy: { at: "desc" }, select: { at: true } }).catch(() => null),
    readHistory(orgId),
    readOptOut(orgId),
  ]);
  const status = (sub?.status ?? "").toUpperCase();
  const account = await accountOf(orgId, status, sub, cardless, now);
  const trade = tradeOf(org);
  const subId = cardless?.record.subId || sub?.externalSubId || null;
  const profile: ContractorProfile = {
    orgId, business: org.name,
    owner: { name: owner?.name ?? null, firstName: firstNameOf(owner?.name), email: owner?.email ?? null },
    trade: { key: trade.key, name: trade.name }, trades: trade.all,
    joinedAt: org.createdAt.toISOString(),
    account,
    built: { clients: built[0], proposals: built[1], jobs: built[2] },
    lastSeenAt: seen?.at.toISOString() ?? null,
    offer: await offerFor(orgId, account.kind, subId, sub?.provider ?? null, !!cardless, now),
    history,
    internal: org.isInternal,
    optedOut,
  };
  return { profile, ownerEmail: owner?.email ?? null, subId };
}

async function accountOf(
  orgId: string,
  status: string,
  sub: { plan: string; trialEndsAt: Date | null } | null,
  cardless: CardlessTrialState | null,
  now: Date,
): Promise<ContractorProfile["account"]> {
  // The plan and its price: the trial's own (lib/cardlessTrial), else the catalogue's for the Subscription row.
  let plan = "the free plan", price = "";
  if (cardless) {
    const s = await trialPlanSummary(orgId, cardless.record).catch(() => null);
    if (s) { plan = s.name; price = s.cents > 0 ? money(s.cents, s.per) : ""; }
  } else if (sub && sub.plan && sub.plan.toUpperCase() !== "FREE") {
    const row = await getPlanBySlug(sub.plan.toLowerCase()).catch(() => null);
    plan = row?.name ?? sub.plan[0] + sub.plan.slice(1).toLowerCase();
    price = row && row.priceCents > 0 ? money(row.priceCents, "/mo") : "";
  }
  const base = { status, plan, price };
  if (cardless?.kind === "trialing" && status !== "ACTIVE") {
    return { ...base, kind: "trialing", daysLeft: cardless.daysLeft, endsAt: cardless.endsAt.toISOString(), hasCard: cardless.hasCard };
  }
  if (cardless?.kind === "ended" && status !== "ACTIVE" && status !== "TRIALING") {
    return { ...base, kind: "trial-ended", endedAt: cardless.endedAt.toISOString() };
  }
  const kinds: Record<string, AccountKind> = { ACTIVE: "paying", TRIALING: "trialing", PAST_DUE: "past-due", UNPAID: "past-due", CANCELED: "canceled", EXPIRED: "canceled", TRIAL_ENDED: "trial-ended", FREE: "free" };
  const kind = kinds[status] ?? "none";
  if (kind === "trialing") {
    // A card-first trial (Stripe Checkout took the card): the card is on file.
    const ends = sub?.trialEndsAt ?? null;
    return { ...base, kind, daysLeft: ends ? Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / DAY_MS)) : 0, endsAt: ends?.toISOString() ?? null, hasCard: true };
  }
  return { ...base, kind };
}

/** How the 10% would reach this customer — or why it cannot. */
async function offerFor(orgId: string, kind: AccountKind, subId: string | null, provider: string | null, cardless: boolean, now: Date): Promise<OfferState> {
  if (kind === "trial-ended") {
    if (!cardless) return { can: false, reason: "Their trial ended before card-less trials — no discount to attach" };
    const rec = await readWinback(orgId).catch(() => null);
    const running = !!rec?.offerUntil && Date.parse(rec.offerUntil) > now.getTime();
    return { can: true, how: "winback", pct: OFFER_PCT, months: OFFER_MONTHS, until: running ? (rec!.offerUntil as string) : new Date(now.getTime() + OFFER_DAYS * DAY_MS).toISOString(), existing: running };
  }
  if (kind === "trialing" || kind === "paying") {
    if (!subId || (!cardless && provider && provider.toUpperCase() !== "STRIPE")) return { can: false, reason: "Their plan is not billed through Stripe" };
    const read = await stripeSubscription(subId);
    if (!read.ok) return { can: false, reason: read.reason };
    const s = read.sub;
    if (s.status === "canceled" || s.status === "incomplete_expired") return { can: false, reason: "Their Stripe subscription is canceled" };
    if (hasDiscount(s)) return { can: false, reason: "Their subscription already has a discount" };
    const yearly = s.items?.data?.[0]?.price?.recurring?.interval === "year";
    return { can: true, how: "subscription", pct: OFFER_PCT, months: OFFER_MONTHS, yearly };
  }
  if (kind === "past-due") return { can: false, reason: "A payment failed — sort that out before an offer" };
  if (kind === "canceled") return { can: false, reason: "No subscription to take it off" };
  return { can: false, reason: "No paid plan to take it off" };
}

type StripeSub = { status: string; discounts?: unknown[] | null; discount?: unknown; items?: { data?: Array<{ price?: { recurring?: { interval?: string } | null } | null }> } };
async function stripeSubscription(subId: string): Promise<{ ok: true; sub: StripeSub } | { ok: false; reason: string }> {
  try {
    const { isStripeEnabled, getStripeClient } = await import("@/lib/sdk/stripe");
    if (!isStripeEnabled()) return { ok: false, reason: "Stripe is not connected here" };
    const { stripe } = await getStripeClient();
    return { ok: true, sub: (await stripe.subscriptions.retrieve(subId)) as unknown as StripeSub };
  } catch {
    return { ok: false, reason: "Couldn't read their subscription from Stripe" };
  }
}
const hasDiscount = (s: StripeSub) => (Array.isArray(s.discounts) && s.discounts.length > 0) || !!s.discount;

/** The offer, made real: the win-back record for an ended trial, the coupon on the subscription otherwise. */
async function applyOffer(acc: Account, now: Date): Promise<string> {
  const o = acc.profile.offer;
  if (!o.can) throw new Error(o.reason);
  if (o.how === "winback") {
    const g = await grantWinbackOffer(acc.profile.orgId, now);
    return `win-back offer until ${g.until}${g.existing ? " (already running)" : ""}`;
  }
  if (!acc.subId) throw new Error("No subscription to apply it to.");
  const read = await stripeSubscription(acc.subId);
  if (!read.ok) throw new Error(read.reason);
  if (hasDiscount(read.sub)) throw new Error("Their subscription already has a discount.");
  const coupon = await ensureWinbackCoupon();
  const { getStripeClient } = await import("@/lib/sdk/stripe");
  const { stripe } = await getStripeClient();
  await stripe.subscriptions.update(acc.subId, { discounts: [{ coupon }] });
  return `coupon ${coupon} on ${acc.subId}`;
}

export async function readHistory(orgId: string): Promise<SentMail[]> {
  const row = await db.syncState.findUnique({ where: { key: HISTORY_KEY(orgId) }, select: { cursor: true } }).catch(() => null);
  try {
    const v = row?.cursor ? (JSON.parse(row.cursor) as { sent?: SentMail[] }) : null;
    return Array.isArray(v?.sent) ? v.sent.filter((x) => x && typeof x.at === "string" && typeof x.subject === "string").slice(0, HISTORY_KEEP) : [];
  } catch {
    return [];
  }
}
async function writeHistory(orgId: string, entry: SentMail): Promise<SentMail[]> {
  const sent = [entry, ...(await readHistory(orgId))].slice(0, HISTORY_KEEP);
  const cursor = JSON.stringify({ sent });
  await db.syncState.upsert({ where: { key: HISTORY_KEY(orgId) }, create: { key: HISTORY_KEY(orgId), cursor }, update: { cursor } });
  return sent;
}

export type SendResult =
  | { ok: true; to: string; sentAt: string; offer: string | null; history: SentMail[] }
  | { ok: false; error: string; offerApplied?: string };

/** Apply the offer (when asked), send, record. The recipient is the account's
 *  owner as the database has it — never an address from the browser. */
export async function sendToContractor(input: {
  orgId: string; topic: TopicKey | "custom"; draft: Draft; offer: boolean;
  admin: { email: string; name: string | null };
}): Promise<SendResult> {
  const now = new Date();
  const acc = await readContractor(input.orgId, now);
  if (!acc) return { ok: false, error: "That account no longer exists." };
  if (!acc.ownerEmail) return { ok: false, error: "This account has no owner email to send to." };
  if (acc.profile.optedOut) return { ok: false, error: "They unsubscribed from our emails — nothing was sent." };
  // The email law asks for a postal address in a letter like this (2026-11-11): none set, none sent.
  if (!postalAddress()) return { ok: false, error: "JobFlex's postal address isn't set (JOBFLEX_POSTAL_ADDRESS) — the email law asks for it at the foot of this letter, so nothing was sent." };
  {
    const { readMailBlock } = await import("@/lib/mailBlock");
    if (await readMailBlock(acc.ownerEmail)) return { ok: false, error: "This address is on the do-not-email list (Platform · Mail · Do not email) — nothing was sent." };
  }
  if (input.offer && !acc.profile.offer.can) return { ok: false, error: `The 10% offer can't be attached: ${acc.profile.offer.reason}.` };

  let offer: string | null = null;
  if (input.offer) {
    try {
      offer = await applyOffer(acc, now);
    } catch (err) {
      return { ok: false, error: `The discount could not be applied, so nothing was sent: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const { appBaseUrl } = await import("@/lib/appUrl");
  const { sendEmail, platformMailbox } = await import("@/lib/sdk/resend");
  const base = await appBaseUrl();
  const sender = senderName(input.admin);
  const unsub = unsubscribeUrl(base, input.orgId, acc.ownerEmail);
  const { subject, html, text } = contractorLetter({ draft: input.draft, p: acc.profile, offer: input.offer, base, sender, unsubscribeUrl: unsub, postal: postalAddress() });
  try {
    // From the sender's own name at the platform address; replies to the admin who wrote it.
    // Replies reach the admin who wrote it and the platform mailbox, where a "stop" is read (lib/supportMail).
    const box = platformMailbox();
    const replyTo = box && box !== input.admin.email.toLowerCase() ? `${input.admin.email}, ${box}` : input.admin.email;
    await sendEmail({ to: acc.ownerEmail, subject, html, text, from: fromLine(sender), replyTo, headers: unsubscribeHeaders(unsub) });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, error: offer ? `The discount was applied, but the email did not go out: ${why}` : `The email did not go out: ${why}`, ...(offer ? { offerApplied: offer } : {}) };
  }
  const history = await writeHistory(input.orgId, { at: now.toISOString(), subject, topic: input.topic, by: input.admin.email, offer: !!offer });
  return { ok: true, to: acc.ownerEmail, sentAt: now.toISOString(), offer, history };
}

/** The platform's postal address for the foot of a letter (US anti-spam law
 *  asks for one in promotional mail): JOBFLEX_POSTAL_ADDRESS, else none. */
export function postalAddress(): string | null {
  return process.env.JOBFLEX_POSTAL_ADDRESS?.trim() || null;
}

/** "Dmitriy at JobFlex <app@jobflex.app>" — a person's name on the From line,
 *  at the platform's own verified address (EMAIL_FROM's). */
export function fromLine(sender: string): string {
  const raw = process.env.EMAIL_FROM ?? process.env.FROM_EMAIL ?? "JobFlex <app@jobflex.app>";
  const address = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
  const display = /jobflex/i.test(sender) ? sender : `${sender} at JobFlex`;
  return `${display.replace(/["<>]/g, "")} <${address}>`;
}

/** "Dmitriy" from the admin's name; the team when there is none. */
export function senderName(admin: { name: string | null; email: string }): string {
  const first = (admin.name ?? "").trim().split(/\s+/)[0];
  return first && !/admin/i.test(first) ? first : "The JobFlex team";
}
