// BRING CLIENTS BACK — the database half (Smart CRM part 6, 2026-11-10). The rules are in ./shared; this reads the
// company's records into the shape those rules count, keeps the saved lists and campaigns, sends a campaign in
// batches and counts what came of it. Every read and write is scoped by organizationId.
import "server-only";
import { db } from "@/lib/db";
import { orgReplyTo } from "@/lib/email/orgSend";
import { threadAddress } from "@/lib/inbox/shared";
import { inboundConfig } from "@/lib/subInbound/config";
import { sendEmail } from "@/lib/sdk/resend";
import { campaignEmail, campaignFrom } from "./email";
import { stopHeaders, stopUrl } from "./optout";
import {
  BATCH,
  CAME_BACK_DAYS,
  MAX_PER_CAMPAIGN,
  MAX_PER_DAY,
  READY_LISTS,
  REST_DAYS,
  asksAboutHouse,
  byWorth,
  campaignText,
  chooseRecipients,
  creditOutcomes,
  emailKey,
  fillWords,
  filterParts,
  filterWords,
  inSendHours,
  SKIP_SHORT,
  matchClient,
  parseFilter,
  skipSummary,
  tidyFilter,
  type AfterEvent,
  type CampaignCounts,
  type CampaignStatus,
  type ClientStats,
  type ListFilter,
  type PlanState,
  type SendContext,
  type SentRow,
  type SkipReason,
} from "./shared";

const DAY = 86_400_000;
const WON = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const LOST = new Set(["DECLINED", "EXPIRED"]);
const OPEN = new Set(["SENT", "VIEWED"]);
const isWon = (p: { status: string; acceptedAt: Date | null }) => !!p.acceptedAt || WON.has(p.status);

// ── every client, as the filter sees them ────────────────────────────────────

/** One pass over the company's records: nine plain reads, joined here. No per-client query, so a book of a few
 *  thousand clients costs the same nine reads as a book of ten. */
export async function readClientStats(organizationId: string, now: Date = new Date()): Promise<ClientStats[]> {
  const [clients, proposals, jobs, payments, threads, inbound, reviews, plans, houses] = await Promise.all([
    db.client.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, city: true, zip: true, createdAt: true, tags: { select: { tag: { select: { label: true } } } } },
    }),
    db.proposal.findMany({
      where: { organizationId, clientId: { not: null } },
      select: { clientId: true, title: true, trade: true, status: true, sentAt: true, acceptedAt: true, createdAt: true },
    }),
    db.job.findMany({
      where: { organizationId, clientId: { not: null }, status: { not: "CANCELED" } },
      select: { clientId: true, proposalId: true, title: true, status: true, kind: true, startsAt: true, endsAt: true, createdAt: true },
    }),
    db.payment.findMany({
      where: { organizationId, clientId: { not: null }, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
      select: { clientId: true, amount: true, refundedAmount: true, paidAt: true },
    }),
    db.clientThread.findMany({ where: { organizationId, clientId: { not: null } }, select: { id: true, clientId: true } }),
    db.clientMessage.groupBy({ by: ["threadId"], where: { organizationId, direction: "IN" }, _max: { createdAt: true } }),
    db.reviewRequest.findMany({ where: { organizationId, clientId: { not: null }, rating: { not: null } }, select: { clientId: true, rating: true } }),
    db.servicePlan.findMany({ where: { organizationId }, select: { clientId: true, status: true, endsAt: true } }),
    db.clientHouse.findMany({ where: { organizationId }, select: { clientId: true, yearBuilt: true, livingSqft: true } }),
  ]);

  const byId = new Map<string, ClientStats>();
  for (const c of clients) {
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
      city: c.city?.trim() || null,
      zip: c.zip?.trim() || null,
      tags: c.tags.map((t) => t.tag.label),
      paid: 0,
      won: 0,
      lost: 0,
      open: 0,
      quotes: 0,
      lastAt: null,
      lastJobAt: null,
      lastJob: null,
      work: "",
      plan: "never",
      rating: null,
      yearBuilt: null,
      sqft: null,
      createdAt: c.createdAt,
    });
  }
  /** Something happened with them at `at`. A day still ahead (a job on next week's calendar) counts as today. */
  const touch = (c: ClientStats, at: Date | null | undefined) => {
    if (!at) return;
    const t = Math.min(at.getTime(), now.getTime());
    if (!c.lastAt || t > c.lastAt.getTime()) c.lastAt = new Date(t);
  };
  const bought = (c: ClientStats, at: Date | null | undefined, title: string) => {
    if (!at || at.getTime() > now.getTime()) return;
    if (!c.lastJobAt || at.getTime() > c.lastJobAt.getTime()) {
      c.lastJobAt = at;
      c.lastJob = title.trim() || c.lastJob;
    }
  };
  const work = new Map<string, string[]>();
  const say = (id: string, ...words: (string | null | undefined)[]) => {
    const list = work.get(id) ?? [];
    for (const w of words) if (w?.trim()) list.push(w.trim().toLowerCase());
    work.set(id, list);
  };

  for (const p of proposals) {
    const c = byId.get(p.clientId!);
    if (!c) continue;
    touch(c, p.createdAt);
    touch(c, p.sentAt);
    touch(c, p.acceptedAt);
    say(c.id, p.title, p.trade);
    if (isWon(p)) {
      c.won += 1;
      c.quotes += 1;
      bought(c, p.acceptedAt ?? p.sentAt ?? p.createdAt, p.title);
    } else if (LOST.has(p.status) || (p.status === "ARCHIVED" && p.sentAt)) {
      c.lost += 1;
      c.quotes += 1;
    } else if (OPEN.has(p.status)) {
      c.open += 1;
      c.quotes += 1;
    }
  }
  for (const j of jobs) {
    const c = byId.get(j.clientId!);
    if (!c) continue;
    touch(c, j.createdAt);
    touch(c, j.startsAt);
    touch(c, j.endsAt);
    say(c.id, j.title);
    if (j.kind !== "WORK") continue;
    if (!j.proposalId) c.won += 1; // work done without a quote behind it is still a job they bought
    if (j.status === "COMPLETED") bought(c, j.endsAt ?? j.startsAt ?? j.createdAt, j.title);
  }
  for (const p of payments) {
    const c = byId.get(p.clientId!);
    if (!c) continue;
    c.paid += Math.max(0, p.amount - (p.refundedAmount ?? 0));
    touch(c, p.paidAt);
  }
  const lastIn = new Map(inbound.map((m) => [m.threadId, m._max.createdAt]));
  for (const t of threads) {
    const c = byId.get(t.clientId!);
    if (c) touch(c, lastIn.get(t.id));
  }
  for (const r of reviews) {
    const c = byId.get(r.clientId!);
    if (c && (c.rating === null || r.rating! > c.rating)) c.rating = r.rating;
  }
  const planOf = new Map<string, PlanState>();
  for (const p of plans) {
    const live = p.status === "ACTIVE" && (!p.endsAt || p.endsAt.getTime() > now.getTime());
    const over = p.status === "EXPIRED" || p.status === "CANCELED" || (p.status === "ACTIVE" && !live);
    const have = planOf.get(p.clientId);
    if (live) planOf.set(p.clientId, "active");
    else if (over && have !== "active") planOf.set(p.clientId, "ended");
  }
  for (const h of houses) {
    const c = byId.get(h.clientId);
    if (!c) continue;
    c.yearBuilt = h.yearBuilt;
    c.sqft = h.livingSqft;
  }
  for (const c of byId.values()) {
    c.paid = Math.round(c.paid * 100) / 100;
    if (c.paid > 0 && c.won === 0) c.won = 1; // money came in: they bought, whatever the paperwork says
    c.work = (work.get(c.id) ?? []).join(" · ");
    c.plan = planOf.get(c.id) ?? "never";
  }
  return [...byId.values()];
}

// ── a list: who is on it, who gets the email ─────────────────────────────────

async function sendContext(organizationId: string, now: Date): Promise<SendContext> {
  const [out, recent] = await Promise.all([
    db.clientEmailOptOut.findMany({ where: { organizationId }, select: { email: true } }),
    db.clientCampaignRecipient.findMany({
      where: { organizationId, status: { in: ["SENT", "SENDING", "QUEUED"] }, createdAt: { gte: new Date(now.getTime() - (REST_DAYS + 3) * DAY) } },
      select: { clientId: true, email: true, sentAt: true, createdAt: true, status: true },
    }),
  ]);
  const lastCampaignAt = new Map<string, Date>();
  const lastInboxAt = new Map<string, Date>();
  const later = (m: Map<string, Date>, k: string, at: Date) => {
    const have = m.get(k);
    if (!have || at.getTime() > have.getTime()) m.set(k, at);
  };
  for (const r of recent) {
    // An email still waiting in another campaign's queue rests the client too, or two campaigns could both reach them.
    const at = r.status === "SENT" ? r.sentAt ?? r.createdAt : now;
    later(lastCampaignAt, r.clientId, at);
    const inbox = emailKey(r.email);
    if (inbox) later(lastInboxAt, inbox, at);
  }
  return { optedOut: new Set(out.map((o) => emailKey(o.email))), lastCampaignAt, lastInboxAt, now };
}

export interface ListPerson {
  id: string;
  name: string;
  email: string | null;
  paid: number;
  lastJob: string | null;
  lastAt: string | null;
  city: string | null;
  /** Why they would not get the email, in a few words; null when they would. */
  out: string | null;
}
export interface ListPreview {
  /** The filter, tidied — what the page keeps. */
  filter: ListFilter;
  words: string;
  /** Everyone the filter matches. */
  total: number;
  /** Who would get an email today, after the left-out people and the per-campaign cap. */
  willSend: number;
  /** "3 have no email on file", … */
  leftOut: string[];
  /** The first of them, best clients first. */
  people: ListPerson[];
  /** The filter asks about the house: how many clients have no house facts yet, so can't be on it. */
  houseUnknown: number | null;
}

const person = (c: ClientStats, out: SkipReason | null = null): ListPerson => ({ id: c.id, name: c.name, email: c.email, paid: c.paid, lastJob: c.lastJob, lastAt: c.lastAt?.toISOString() ?? null, city: c.city, out: out ? SKIP_SHORT[out] : null });

interface Resolved {
  matched: ClientStats[];
  send: ClientStats[];
  skip: { client: ClientStats; reason: SkipReason }[];
  all: ClientStats[];
}

/** The people a filter names today, sorted best first, split into who gets the email and who is left out. */
async function resolve(organizationId: string, filter: ListFilter, now: Date, stats?: ClientStats[]): Promise<Resolved> {
  const [all, ctx] = await Promise.all([stats ? Promise.resolve(stats) : readClientStats(organizationId, now), sendContext(organizationId, now)]);
  const matched = all.filter((c) => matchClient(filter, c, now)).sort(byWorth);
  const { send, skip } = chooseRecipients(matched, ctx);
  const over = send.slice(MAX_PER_CAMPAIGN).map((client) => ({ client, reason: "over" as const }));
  return { matched, send: send.slice(0, MAX_PER_CAMPAIGN), skip: [...skip, ...over], all };
}

export async function previewList(organizationId: string, raw: unknown, now: Date = new Date(), stats?: ClientStats[]): Promise<ListPreview> {
  const filter = tidyFilter(raw);
  const r = await resolve(organizationId, filter, now, stats);
  const why = new Map(r.skip.map((s) => [s.client.id, s.reason]));
  return {
    filter,
    words: filterWords(filter),
    total: r.matched.length,
    willSend: r.send.length,
    leftOut: skipSummary(r.skip),
    people: r.matched.slice(0, 12).map((c) => person(c, why.get(c.id) ?? null)),
    houseUnknown: asksAboutHouse(filter) ? r.all.filter((c) => c.yearBuilt === null && c.sqft === null).length : null,
  };
}

// ── saved lists ──────────────────────────────────────────────────────────────

export async function saveList(organizationId: string, userId: string | null, input: { name: string; filter: unknown; words?: string | null }): Promise<{ id: string }> {
  const filter = tidyFilter(input.filter);
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80) || "My list";
  const have = await db.clientList.findFirst({ where: { organizationId, name }, select: { id: true } });
  if (have) {
    await db.clientList.update({ where: { id: have.id }, data: { filterJson: JSON.stringify(filter), words: input.words?.slice(0, 400) ?? null } });
    return have;
  }
  return db.clientList.create({ data: { organizationId, name, words: input.words?.slice(0, 400) ?? null, filterJson: JSON.stringify(filter), createdById: userId }, select: { id: true } });
}

export async function deleteList(organizationId: string, id: string): Promise<void> {
  await db.clientList.deleteMany({ where: { id, organizationId } });
}

// ── campaigns ────────────────────────────────────────────────────────────────

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface CampaignInput {
  name?: string | null;
  filter: unknown;
  listId?: string | null;
  subject: string;
  body: string;
  writtenBy?: "ai" | "rules" | "person";
}

export async function saveCampaign(organizationId: string, userId: string | null, input: CampaignInput, id?: string | null): Promise<Outcome<{ id: string }>> {
  const text = campaignText.safeParse({ subject: input.subject, body: input.body });
  if (!text.success) return { ok: false, error: text.error.issues[0]?.message ?? "Check the email's words." };
  const filter = tidyFilter(input.filter);
  const data = {
    name: (input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || text.data.subject.slice(0, 80),
    listId: input.listId ?? null,
    filterJson: JSON.stringify(filter),
    audience: filterWords(filter),
    subject: text.data.subject,
    body: text.data.body,
    writtenBy: input.writtenBy ?? "person",
  };
  if (id) {
    const done = await db.clientCampaign.updateMany({ where: { id, organizationId, status: "DRAFT" }, data });
    return done.count ? { ok: true, id } : { ok: false, error: "That campaign has already gone out, so its words can't change." };
  }
  const row = await db.clientCampaign.create({ data: { ...data, organizationId, createdById: userId }, select: { id: true } });
  return { ok: true, id: row.id };
}

export async function deleteCampaign(organizationId: string, id: string): Promise<Outcome> {
  const done = await db.clientCampaign.deleteMany({ where: { id, organizationId, status: "DRAFT" } });
  return done.count ? { ok: true } : { ok: false, error: "Only a draft can be deleted. A campaign that went out stays on record." };
}

/** What a company must have on file before a campaign may leave. */
export async function sendingProblem(organizationId: string): Promise<string | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true } });
  if (!org) return "No such company.";
  if (!org.address?.trim() || org.address.trim().length < 8) return "Add your company's mailing address on the Company page first. The law asks for it at the bottom of every marketing email.";
  return null;
}

export interface StartResult {
  queued: number;
  leftOut: string[];
  /** True when it is outside sending hours: the first emails leave in the morning. */
  waits: boolean;
}

/** Send: the list is counted NOW (not when the draft was written) and the people are written down. The caller
 *  sends the first batch (sendBatch, after its answer has gone back) unless `waits`; the rest go hour by hour
 *  (the follow-ups cron) until the campaign is done. */
export async function startCampaign(organizationId: string, userId: string | null, id: string, now: Date = new Date()): Promise<Outcome<StartResult>> {
  const campaign = await db.clientCampaign.findFirst({ where: { id, organizationId } });
  if (!campaign) return { ok: false, error: "No such campaign." };
  if (campaign.status !== "DRAFT") return { ok: false, error: "That campaign has already been sent." };
  const problem = await sendingProblem(organizationId);
  if (problem) return { ok: false, error: problem };
  const filter = parseFilter(campaign.filterJson);
  const r = await resolve(organizationId, filter, now);
  if (!r.send.length) return { ok: false, error: r.matched.length ? `Nobody on this list can get the email: ${skipSummary(r.skip).join(" · ")}.` : "Nobody is on this list right now." };

  // One winner: two presses of Send, or the page and the Operator at once, start it once.
  const claimed = await db.clientCampaign.updateMany({ where: { id, organizationId, status: "DRAFT" }, data: { status: "SENDING", startedAt: now, startedById: userId, audience: filterWords(filter) } });
  if (!claimed.count) return { ok: false, error: "That campaign has already been sent." };
  const rows = [
    ...r.send.map((c, i) => ({ organizationId, campaignId: id, clientId: c.id, name: c.name, email: emailKey(c.email), lastJob: c.lastJob, status: "QUEUED", reason: null as string | null, createdAt: new Date(now.getTime() + i) })),
    ...r.skip.map((s, i) => ({ organizationId, campaignId: id, clientId: s.client.id, name: s.client.name, email: emailKey(s.client.email) || null, lastJob: s.client.lastJob, status: "SKIPPED", reason: s.reason as string | null, createdAt: new Date(now.getTime() + r.send.length + i) })),
  ];
  for (let i = 0; i < rows.length; i += 200) await db.clientCampaignRecipient.createMany({ data: rows.slice(i, i + 200) });

  const tz = (await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone ?? "America/New_York";
  return { ok: true, queued: r.send.length, leftOut: skipSummary(r.skip), waits: !inSendHours(now, tz) };
}

/** Stop a campaign that is still going out: nobody else gets it. What already left stays on record. */
export async function stopCampaign(organizationId: string, id: string, now: Date = new Date()): Promise<Outcome<{ stopped: number }>> {
  const done = await db.clientCampaign.updateMany({ where: { id, organizationId, status: "SENDING" }, data: { status: "CANCELED", finishedAt: now } });
  if (!done.count) return { ok: false, error: "That campaign isn't sending right now." };
  const left = await db.clientCampaignRecipient.updateMany({ where: { campaignId: id, organizationId, status: "QUEUED" }, data: { status: "SKIPPED", reason: "stopped" } });
  return { ok: true, stopped: left.count };
}

const STUCK_MS = 15 * 60_000;

/** One batch of one campaign. Each email is claimed first (QUEUED → SENDING), so two senders never both send it;
 *  a claim that never finished is closed as "didn't go" — an email is never sent twice to be sure. */
export async function sendBatch(organizationId: string, campaignId: string, base: string, now: Date = new Date(), budgetMs = 40_000): Promise<number> {
  const until = Date.now() + budgetMs;
  const [campaign, org] = await Promise.all([
    db.clientCampaign.findFirst({ where: { id: campaignId, organizationId, status: "SENDING" } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, phone: true, address: true, website: true, gmailSettingsJson: true, billingEmail: true, timezone: true } }),
  ]);
  if (!campaign || !org) return 0;
  // The hours are kept here too, whoever calls: no campaign email leaves at night.
  if (!inSendHours(now, org.timezone ?? "America/New_York")) return 0;
  await db.clientCampaignRecipient.updateMany({
    where: { campaignId, organizationId, status: "SENDING", sentAt: { lt: new Date(now.getTime() - STUCK_MS) } },
    data: { status: "FAILED", reason: "The send didn't finish. It was not tried again, so nobody gets it twice.", sentAt: null },
  });

  const sentToday = await db.clientCampaignRecipient.count({ where: { organizationId, status: "SENT", sentAt: { gte: new Date(now.getTime() - DAY) } } });
  const room = Math.min(BATCH, MAX_PER_DAY - sentToday);
  let sent = 0;
  if (room > 0 && org.address?.trim()) {
    const batch = await db.clientCampaignRecipient.findMany({ where: { campaignId, organizationId, status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: room });
    const [clients, outs, threads] = await Promise.all([
      db.client.findMany({ where: { organizationId, deletedAt: null, id: { in: batch.map((b) => b.clientId) } }, select: { id: true, name: true, email: true, phone: true } }),
      db.clientEmailOptOut.findMany({ where: { organizationId, email: { in: batch.map((b) => b.email ?? "").filter(Boolean) } }, select: { email: true } }),
      db.clientThread.findMany({ where: { organizationId, clientId: { in: batch.map((b) => b.clientId) } }, select: { id: true, clientId: true, replyToken: true } }),
    ]);
    const clientOf = new Map(clients.map((c) => [c.id, c]));
    const out = new Set(outs.map((o) => emailKey(o.email)));
    const threadOf = new Map(threads.map((t) => [t.clientId!, t]));
    const inbound = inboundConfig();
    const ownReply = orgReplyTo(org);

    for (const r of batch) {
      if (Date.now() > until) break; // out of time: the rest stay queued for the next hour
      const claim = await db.clientCampaignRecipient.updateMany({ where: { id: r.id, status: "QUEUED" }, data: { status: "SENDING", sentAt: new Date() } });
      if (!claim.count) continue;
      const client = clientOf.get(r.clientId);
      const to = emailKey(client?.email);
      const skip: SkipReason | null = !client ? "gone" : !to ? "no-email" : out.has(to) ? "opted-out" : null;
      if (skip) {
        await db.clientCampaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", reason: skip, sentAt: null } });
        continue;
      }
      try {
        // A reply lands on the client's thread when the inbox can receive; the thread is made closed, so a campaign
        // of 300 doesn't put 300 new conversations at the top of the inbox — it opens when they write back.
        let thread = threadOf.get(r.clientId) ?? null;
        if (!thread && inbound.enabled && inbound.domain) {
          thread = await db.clientThread.create({ data: { organizationId, clientId: r.clientId, name: client!.name, email: to, phone: client!.phone, status: "CLOSED" }, select: { id: true, clientId: true, replyToken: true } });
        }
        const replyTo = thread && inbound.enabled && inbound.domain ? threadAddress(thread.replyToken, inbound.domain) : ownReply;
        const who = { name: client!.name, company: org.name, lastJob: r.lastJob };
        const subject = fillWords(campaign.subject, who).replace(/\s+/g, " ").trim();
        const words = fillWords(campaign.body, who);
        const stop = stopUrl(base, r.id);
        const mail = campaignEmail({ subject, body: words, company: { id: org.id, name: org.name, phone: org.phone, address: org.address!.trim() }, stopUrl: stop });
        const left = await sendEmail({ to, subject, html: mail.html, text: mail.text, from: campaignFrom(org.name), replyTo, headers: stopHeaders(stop), kind: "campaign", organizationId });
        // "disabled" = no mail provider on this server: nothing left, so it must not read as sent.
        if (left.skipped && left.id === "disabled") throw new Error("Email sending isn't set up, so this one didn't go out.");
        await db.clientCampaignRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), email: to } });
        if (thread) {
          await db.clientMessage
            .create({ data: { organizationId, threadId: thread.id, direction: "OUT", channel: "EMAIL", toAddr: to, subject: subject.slice(0, 500), body: words, sentById: campaign.startedById, status: "SENT" } })
            .catch((err) => console.warn("[winback] thread copy skipped:", err instanceof Error ? err.message : err));
        }
        sent += 1;
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        console.warn(`[winback] campaign ${campaignId} → ${r.clientId} failed:`, why);
        await db.clientCampaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", reason: why.slice(0, 300), sentAt: null } }).catch(() => null);
      }
    }
  }
  const left = await db.clientCampaignRecipient.count({ where: { campaignId, organizationId, status: { in: ["QUEUED", "SENDING"] } } });
  if (!left) await db.clientCampaign.updateMany({ where: { id: campaignId, organizationId, status: "SENDING" }, data: { status: "SENT", finishedAt: new Date() } });
  return sent;
}

/** The hourly pass (the follow-ups cron): every campaign still going out sends its next batch, inside the company's
 *  sending hours. A company whose plan has ended sends nothing; its campaign waits. */
export async function drainCampaigns(base: string, now: Date = new Date()): Promise<{ campaigns: number; sent: number }> {
  const open = await db.clientCampaign.findMany({ where: { status: "SENDING" }, orderBy: { startedAt: "asc" }, take: 60, select: { id: true, organizationId: true } });
  if (!open.length) return { campaigns: 0, sent: 0 };
  const { isPageLocked } = await import("@/lib/customPageAccess");
  const orgs = await db.organization.findMany({ where: { id: { in: [...new Set(open.map((c) => c.organizationId))] } }, select: { id: true, timezone: true } });
  const ready = new Map<string, boolean>();
  for (const o of orgs) ready.set(o.id, inSendHours(now, o.timezone ?? "America/New_York") && !(await isPageLocked(o.id, "smart-crm", { as: null }).catch(() => true)));
  let sent = 0;
  let campaigns = 0;
  const until = Date.now() + 90_000;
  for (const c of open) {
    if (Date.now() > until) break;
    if (!ready.get(c.organizationId)) continue;
    campaigns += 1;
    sent += await sendBatch(c.organizationId, c.id, base, now).catch((err) => {
      console.warn("[winback] drain failed:", err instanceof Error ? err.message : err);
      return 0;
    });
  }
  return { campaigns, sent };
}

// ── what came of it ──────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  audience: string;
  subject: string;
  body: string;
  filter: ListFilter;
  writtenBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: CampaignCounts;
  /** Why people were left out, counted. */
  leftOut: string[];
}

const ZERO: CampaignCounts = { queued: 0, sent: 0, skipped: 0, failed: 0, replied: 0, cameBack: 0, won: 0, wonValue: 0, optedOut: 0 };

export async function readCampaigns(organizationId: string, now: Date = new Date(), take = 20): Promise<CampaignRow[]> {
  const campaigns = await db.clientCampaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take });
  if (!campaigns.length) return [];
  const ids = campaigns.filter((c) => c.status !== "DRAFT").map((c) => c.id);
  const rows = ids.length ? await db.clientCampaignRecipient.findMany({ where: { organizationId, campaignId: { in: ids } }, select: { campaignId: true, clientId: true, status: true, reason: true, sentAt: true, optedOutAt: true } }) : [];
  const counts = new Map<string, CampaignCounts>();
  const skips = new Map<string, { reason: SkipReason }[]>();
  const sent: SentRow[] = [];
  for (const r of rows) {
    const c = counts.get(r.campaignId) ?? { ...ZERO };
    if (r.status === "QUEUED" || r.status === "SENDING") c.queued += 1;
    else if (r.status === "SENT") c.sent += 1;
    else if (r.status === "SKIPPED") c.skipped += 1;
    else if (r.status === "FAILED") c.failed += 1;
    if (r.optedOutAt) c.optedOut += 1;
    counts.set(r.campaignId, c);
    if (r.status === "SKIPPED" && r.reason) skips.set(r.campaignId, [...(skips.get(r.campaignId) ?? []), { reason: r.reason as SkipReason }]);
    if (r.status === "SENT" && r.sentAt) sent.push({ campaignId: r.campaignId, clientId: r.clientId, sentAt: r.sentAt });
  }
  if (sent.length) {
    const since = new Date(Math.min(...sent.map((s) => s.sentAt.getTime())));
    const until = new Date(Math.min(now.getTime(), Math.max(...sent.map((s) => s.sentAt.getTime())) + CAME_BACK_DAYS * DAY));
    const clientIds = [...new Set(sent.map((s) => s.clientId))];
    const [proposals, jobs, threads] = await Promise.all([
      db.proposal.findMany({ where: { organizationId, clientId: { in: clientIds }, createdAt: { gte: since, lte: until } }, select: { clientId: true, createdAt: true, status: true, acceptedAt: true, total: true } }),
      db.job.findMany({ where: { organizationId, clientId: { in: clientIds }, createdAt: { gte: since, lte: until }, status: { not: "CANCELED" }, proposalId: null }, select: { clientId: true, createdAt: true } }),
      db.clientThread.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: { id: true, clientId: true } }),
    ]);
    const threadClient = new Map(threads.map((t) => [t.id, t.clientId!]));
    const replies = threads.length
      ? await db.clientMessage.findMany({ where: { organizationId, threadId: { in: threads.map((t) => t.id) }, direction: "IN", createdAt: { gte: since, lte: until } }, select: { threadId: true, createdAt: true } })
      : [];
    const events: AfterEvent[] = [
      ...proposals.map((p) => ({ clientId: p.clientId!, at: p.createdAt, kind: isWon(p) ? ("won" as const) : ("quote" as const), value: p.total })),
      ...jobs.map((j) => ({ clientId: j.clientId!, at: j.createdAt, kind: "job" as const })),
      ...replies.map((m) => ({ clientId: threadClient.get(m.threadId)!, at: m.createdAt, kind: "reply" as const })),
    ];
    for (const [id, o] of creditOutcomes(sent, events)) {
      const c = counts.get(id) ?? { ...ZERO };
      counts.set(id, { ...c, ...o });
    }
  }
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status as CampaignStatus,
    audience: c.audience,
    subject: c.subject,
    body: c.body,
    filter: parseFilter(c.filterJson),
    writtenBy: c.writtenBy,
    createdAt: c.createdAt.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    finishedAt: c.finishedAt?.toISOString() ?? null,
    counts: counts.get(c.id) ?? { ...ZERO },
    leftOut: skipSummary(skips.get(c.id) ?? []),
  }));
}

// ── the tab ──────────────────────────────────────────────────────────────────

export interface WinBack {
  company: string;
  /** What must be fixed before anything can be sent (no mailing address); null when ready. */
  sendingProblem: string | null;
  /** Is it an hour campaign email leaves in, on the company's clock? Outside it, a new campaign waits for the morning. */
  open: boolean;
  address: string | null;
  replyTo: string | null;
  clients: number;
  withEmail: number;
  optedOut: number;
  ready: { key: string; name: string; why: string; count: number; filter: ListFilter }[];
  saved: { id: string; name: string; words: string; count: number; filter: ListFilter }[];
  campaigns: CampaignRow[];
  house: { withAddress: number; known: number; notFound: number; unchecked: number };
}

export async function readWinBack(organizationId: string, now: Date = new Date()): Promise<WinBack> {
  const [stats, org, lists, campaigns, optedOut, addressed, houses] = await Promise.all([
    readClientStats(organizationId, now),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, address: true, timezone: true, gmailSettingsJson: true, billingEmail: true } }),
    db.clientList.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30 }),
    readCampaigns(organizationId, now),
    db.clientEmailOptOut.count({ where: { organizationId } }),
    db.client.findMany({ where: { organizationId, deletedAt: null, address: { not: null } }, select: { id: true, address: true } }),
    db.clientHouse.findMany({ where: { organizationId }, select: { clientId: true, source: true, yearBuilt: true, livingSqft: true } }),
  ]);
  const count = (f: ListFilter) => stats.filter((c) => matchClient(f, c, now)).length;
  const withAddress = addressed.filter((c) => (c.address ?? "").trim().length >= 5);
  const houseOf = new Map(houses.map((h) => [h.clientId, h]));
  const known = withAddress.filter((c) => {
    const h = houseOf.get(c.id);
    return !!h && (h.yearBuilt !== null || h.livingSqft !== null);
  }).length;
  const notFound = withAddress.filter((c) => {
    const h = houseOf.get(c.id);
    return !!h && h.yearBuilt === null && h.livingSqft === null;
  }).length;
  return {
    company: org?.name ?? "",
    sendingProblem: await sendingProblem(organizationId),
    open: inSendHours(now, org?.timezone ?? "America/New_York"),
    address: org?.address?.trim() || null,
    replyTo: org ? orgReplyTo(org) ?? null : null,
    clients: stats.length,
    withEmail: stats.filter((c) => !!c.email).length,
    optedOut,
    ready: READY_LISTS.map((r) => ({ key: r.key, name: r.name, why: r.why, count: count(r.filter), filter: r.filter })),
    saved: lists.map((l) => {
      const filter = parseFilter(l.filterJson);
      return { id: l.id, name: l.name, words: filterWords(filter), count: count(filter), filter };
    }),
    campaigns,
    house: { withAddress: withAddress.length, known, notFound, unchecked: withAddress.length - known - notFound },
  };
}

/** The chips of a filter, for a caller that only has the words (the Operator's read-back). */
export const chipsOf = (f: ListFilter): string[] => filterParts(f).map((p) => p.text);
