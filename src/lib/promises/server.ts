import "server-only";
// THE PROMISE TRACKER — THE DATABASE HALF (Smart CRM part 4, 2026-11-10). The rules are ./shared.
//   catchPromises     — a person wrote to a client: what did they commit to? (one model call, only when the
//                       message reads like a commitment; the fake model answers the PROMISE READ prompt)
//   sweepPromises     — hourly (the follow-ups cron): close what later events prove was kept, remind the owners
//   readPromiseTracker — the Today tab's five lists, the Operator's and the briefing's
//   addPromise / settlePromise — by hand (the client's page, the Today tab, the Operator)
// A promise never sends anything to a client. Reminders go to our own people only.

import { after } from "next/server";
import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { takeTrialCap } from "@/lib/trialMeter";
import { clip, samePhone } from "@/lib/clientTimeline/shared";
import { formatUSD } from "@/lib/email/build/client";
import { rateLimitShared } from "@/lib/rateLimit";
import {
  dayKey,
  dueInstant,
  evidenceFor,
  guessKind,
  mayPromise,
  parseCaught,
  parseKind,
  reminderDue,
  reminderWords,
  trackerOf,
  type EvidenceEvent,
  type PromiseKind,
  type PromiseTracker,
  type TrackedPromise,
} from "./shared";
import { isPageLocked, lapsedOrgIds } from "@/lib/customPageAccess";

const OFFICE_ROLES = ["OWNER", "ADMIN", "MANAGER"];

// ── catching ─────────────────────────────────────────────────────────────────

export interface CatchInput {
  organizationId: string;
  clientId: string | null;
  /** Who wrote the message — the promise is theirs to keep. */
  userId: string | null;
  body: string;
  channel: "EMAIL" | "SMS";
  /** The ClientMessage / SmsMessage id the promise points back at. */
  sourceId?: string | null;
  now?: Date;
}

/** Read one message a person wrote to a client for promises of ours. Returns how many were written down. */
export async function catchPromises(input: CatchInput): Promise<number> {
  if (!input.clientId || !mayPromise(input.body) || !isOpenAIEnabled()) return 0;
  // The promise tracker is Smart CRM (part 4) — on the Free plan the message is sent, not read (owner, 2026-11-09).
  if (await isPageLocked(input.organizationId, "smart-crm")) return 0;
  const trial = await takeTrialCap(input.organizationId, "aiCalls");
  if (!trial.ok) return 0;
  const now = input.now ?? new Date();
  const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { timezone: true } });
  const tz = org?.timezone || "America/New_York";
  const today = dayKey(now, tz);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);

  const system = [
    "PROMISE READ. A contractor's office just sent this message to a client. List what the SENDER commits to do for the client. Answer JSON only:",
    '{"promises": [{"text": string, "due": "YYYY-MM-DD"|null, "kind": "PROPOSAL"|"INVOICE"|"CALL"|"SCHEDULE"|"INFO"|"OTHER"}]}',
    "Rules:",
    "- Only a real commitment to do something later ('I'll send the revised quote Friday', 'we'll call you tomorrow'). Not an offer ('let me know if…'), not what the client should do, not something already done ('I sent it').",
    "- text: the commitment in a few plain words, starting with the verb: 'Send the revised quote'. No names, no pleasantries.",
    "- due: the calendar day, only when the message pins it (Friday, tomorrow, by the 15th). Work it out from TODAY. No day said = null.",
    "- kind: PROPOSAL (a quote, estimate, pricing) · INVOICE · CALL · SCHEDULE (book or confirm a visit or start) · INFO (find out, check, send photos or papers) · OTHER.",
    "- At most 3. Nothing to list = an empty array.",
  ].join("\n");
  const user = [`TODAY: ${today} (${weekday})`, `MESSAGE:\n${clip(input.body, 3000)}`].join("\n\n");

  let caught: ReturnType<typeof parseCaught> = [];
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    caught = parseCaught(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), today);
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    console.warn("[promises] not read:", err instanceof Error ? err.message : err);
    return 0;
  }
  if (!caught.length) return 0;

  const open = await db.clientPromise.findMany({ where: { organizationId: input.organizationId, clientId: input.clientId, status: "OPEN", direction: "OURS" }, select: { text: true } });
  const have = new Set(open.map((p) => p.text.trim().toLowerCase()));
  let n = 0;
  for (const c of caught) {
    if (have.has(c.text.toLowerCase())) continue;
    have.add(c.text.toLowerCase());
    await db.clientPromise.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        direction: "OURS",
        text: c.text,
        kind: c.kind,
        dueAt: c.due ? dueInstant(c.due) : null,
        ownerId: input.userId,
        sourceKind: input.channel,
        sourceId: input.sourceId ?? null,
        sourceAt: now,
      },
    });
    n += 1;
  }
  return n;
}

/** The same, after the response — the person who pressed Send never waits for the read. Outside a request (the
 *  logic checks, a cron) there is no "after": it just runs. */
export function catchPromisesLater(input: CatchInput): void {
  const run = () => catchPromises(input).then(() => undefined, (err) => console.warn("[promises] catch failed:", err instanceof Error ? err.message : err));
  try {
    after(run);
  } catch {
    void run();
  }
}

// ── by hand ──────────────────────────────────────────────────────────────────

export async function addPromise(input: { organizationId: string; clientId: string; text: string; direction: "OURS" | "THEIRS"; dueAt: Date | null; userId: string | null; kind?: PromiseKind | null; sourceKind?: string }): Promise<{ id: string }> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 240);
  const row = await db.clientPromise.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      direction: input.direction,
      text,
      kind: input.kind ?? guessKind(text, input.direction),
      dueAt: input.dueAt,
      ownerId: input.direction === "OURS" ? input.userId : null,
      sourceKind: input.sourceKind ?? "PERSON",
      sourceAt: new Date(),
    },
    select: { id: true },
  });
  return row;
}

export async function settlePromise(organizationId: string, promiseId: string, outcome: "KEPT" | "CANCELED"): Promise<boolean> {
  const r = await db.clientPromise.updateMany({
    where: { id: promiseId, organizationId, status: "OPEN" },
    data: { status: outcome, keptAt: outcome === "KEPT" ? new Date() : null },
  });
  return r.count > 0;
}

/** A new day for an open promise ("tell them the new day"): the reminders start over. */
export async function movePromise(organizationId: string, promiseId: string, dueAt: Date | null): Promise<boolean> {
  const r = await db.clientPromise.updateMany({ where: { id: promiseId, organizationId, status: "OPEN" }, data: { dueAt, remindedAt: null } });
  return r.count > 0;
}

// ── the lists ────────────────────────────────────────────────────────────────

export interface TrackerViewer {
  userId: string;
  /** SALES / ESTIMATOR: their own promises, and the clients' promises on their own proposals. */
  ownOnly: boolean;
}

const KEPT_SHOWN_MS = 7 * 86_400_000;

export async function readPromiseTracker(organizationId: string, viewer: TrackerViewer, now = new Date()): Promise<PromiseTracker & { tz: string }> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = org?.timezone || "America/New_York";
  let mine: string[] | null = null;
  if (viewer.ownOnly) {
    const own = await db.proposal.findMany({ where: { organizationId, ownerId: viewer.userId, clientId: { not: null } }, select: { clientId: true }, distinct: ["clientId"], take: 500 });
    mine = own.map((p) => p.clientId).filter((x): x is string => Boolean(x));
  }
  const scope = viewer.ownOnly ? { OR: [{ direction: "OURS", ownerId: viewer.userId }, { direction: "THEIRS", clientId: { in: mine ?? [] } }] } : {};
  const rows = await db.clientPromise.findMany({
    where: {
      organizationId,
      client: { deletedAt: null },
      AND: [scope, { OR: [{ status: "OPEN" }, { status: "KEPT", keptAt: { gte: new Date(now.getTime() - KEPT_SHOWN_MS) } }] }],
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    include: { client: { select: { name: true } }, owner: { select: { name: true, email: true } } },
  });
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const threads = clientIds.length ? await db.clientThread.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: { id: true, clientId: true } }) : [];
  const threadOf = new Map(threads.map((t) => [t.clientId, t.id]));
  const tracked: TrackedPromise[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    client: r.client.name,
    direction: r.direction === "THEIRS" ? "THEIRS" : "OURS",
    text: r.text,
    kind: parseKind(r.kind),
    ownerId: r.ownerId,
    owner: r.owner ? (r.owner.name ?? "").trim() || (r.owner.email ?? "").split("@")[0] || null : null,
    dueAt: r.dueAt ? r.dueAt.getTime() : null,
    status: r.status,
    keptAt: r.keptAt ? r.keptAt.getTime() : null,
    evidence: r.evidence,
    createdAt: r.createdAt.getTime(),
    threadId: threadOf.get(r.clientId) ?? null,
    sourceKind: r.sourceKind,
  }));
  const t = trackerOf(tracked, now, tz);
  return { ...t, kept: t.kept.slice(0, 8), tz };
}

// ── the hourly sweep ─────────────────────────────────────────────────────────

/** Everything that happened with one client since `from` that can prove a promise was kept. */
async function evidenceEvents(organizationId: string, client: { id: string; phone: string | null }, from: Date, kinds: Set<PromiseKind>): Promise<EvidenceEvent[]> {
  const out: EvidenceEvent[] = [];
  const wantsProposals = kinds.has("PROPOSAL") || kinds.has("SIGN") || kinds.has("DECIDE") || kinds.has("INVOICE") || kinds.has("PAY");
  const proposals = wantsProposals ? await db.proposal.findMany({ where: { organizationId, clientId: client.id }, select: { id: true, title: true, sentAt: true, acceptedAt: true }, take: 100 }) : [];
  for (const p of proposals) {
    if (p.sentAt && p.sentAt >= from) out.push({ kind: "PROPOSAL_SENT", at: p.sentAt.getTime(), label: `Proposal sent — ${clip(p.title, 60)}` });
    if (p.acceptedAt && p.acceptedAt >= from) out.push({ kind: "SIGNED", at: p.acceptedAt.getTime(), label: `Signed — ${clip(p.title, 60)}` });
  }
  const proposalIds = proposals.map((p) => p.id);
  if (kinds.has("INVOICE")) {
    const invoices = await db.invoice.findMany({ where: { organizationId, createdAt: { gte: from }, OR: [{ clientId: client.id }, ...(proposalIds.length ? [{ proposalId: { in: proposalIds } }] : [])] }, select: { number: true, createdAt: true }, take: 20 });
    for (const i of invoices) out.push({ kind: "INVOICE_MADE", at: i.createdAt.getTime(), label: `Invoice ${i.number} made` });
  }
  if (kinds.has("PAY")) {
    const payments = await db.payment.findMany({
      where: { organizationId, status: { in: ["PAID", "PARTIAL"] }, paidAt: { gte: from }, OR: [{ clientId: client.id }, ...(proposalIds.length ? [{ proposalId: { in: proposalIds } }] : [])] },
      select: { amount: true, paidAt: true },
      take: 20,
    });
    for (const p of payments) if (p.paidAt) out.push({ kind: "PAYMENT", at: p.paidAt.getTime(), label: `They paid ${formatUSD(p.amount)}` });
  }
  if (kinds.has("SCHEDULE")) {
    const [jobs, visits] = await Promise.all([
      db.job.findMany({ where: { organizationId, clientId: client.id, createdAt: { gte: from } }, select: { title: true, createdAt: true }, take: 20 }),
      db.appointment.findMany({ where: { organizationId, clientId: client.id, createdAt: { gte: from }, status: { not: "CANCELED" } }, select: { title: true, createdAt: true }, take: 20 }),
    ]);
    for (const j of jobs) out.push({ kind: "JOB_BOOKED", at: j.createdAt.getTime(), label: `Job booked — ${clip(j.title, 60)}` });
    for (const v of visits) out.push({ kind: "JOB_BOOKED", at: v.createdAt.getTime(), label: `Visit booked — ${clip(v.title, 60)}` });
  }
  const hasPhone = Boolean(client.phone && client.phone.replace(/\D/g, "").length >= 7);
  if (kinds.has("CALL") && hasPhone) {
    const calls = await db.aiPhoneCall.findMany({ where: { organizationId, direction: "OUTBOUND", startedAt: { gte: from } }, select: { toNumber: true, startedAt: true }, orderBy: { startedAt: "asc" }, take: 200 });
    for (const c of calls) if (samePhone(c.toNumber, client.phone)) out.push({ kind: "CALL_OUT", at: c.startedAt.getTime(), label: "Called them" });
  }
  if (kinds.has("DECIDE")) {
    const thread = await db.clientThread.findFirst({ where: { organizationId, clientId: client.id }, select: { id: true } });
    const [msg, texts, calls] = await Promise.all([
      thread ? db.clientMessage.findFirst({ where: { threadId: thread.id, direction: "IN", createdAt: { gte: from } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }) : Promise.resolve(null),
      hasPhone ? db.smsMessage.findMany({ where: { organizationId, direction: "IN", createdAt: { gte: from } }, select: { from: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 300 }) : Promise.resolve([]),
      hasPhone ? db.aiPhoneCall.findMany({ where: { organizationId, direction: "INBOUND", startedAt: { gte: from } }, select: { fromNumber: true, startedAt: true }, orderBy: { startedAt: "asc" }, take: 100 }) : Promise.resolve([]),
    ]);
    if (msg) out.push({ kind: "INBOUND", at: msg.createdAt.getTime(), label: "They wrote back" });
    for (const t of texts) if (samePhone(t.from, client.phone)) out.push({ kind: "INBOUND", at: t.createdAt.getTime(), label: "They texted back" });
    for (const c of calls) if (samePhone(c.fromNumber, client.phone)) out.push({ kind: "INBOUND", at: c.startedAt.getTime(), label: "They called" });
  }
  return out;
}

const PER_HOUR = 12;

/** One line in the person's Operator, and a text to their linked phone by day — unless they switched promise
 *  reminders off (Settings → AI Operator). The same manners as lib/assistant/alerts. */
async function remind(organizationId: string, userId: string, text: string, now: Date, tz: string): Promise<boolean> {
  const { readPrefs } = await import("@/lib/assistant/prefs");
  const prefs = await readPrefs(organizationId, userId);
  if (!prefs.alerts.promises) return false;
  const limit = await rateLimitShared(`assistant:alert:${userId}`, PER_HOUR, 3_600_000).catch(() => ({ ok: false }));
  if (!limit.ok) return false;
  await db.assistantMessage.create({ data: { organizationId, userId, channel: "app", direction: "OUT", body: text.slice(0, 4000) } });
  const { quietHours } = await import("@/lib/assistant/shared");
  if (quietHours(now, tz)) return true;
  const [{ linkOf }, { sendAssistantText }] = await Promise.all([import("@/lib/assistant/phone"), import("@/lib/assistant/sms")]);
  const link = await linkOf(organizationId, userId).catch(() => null);
  if (link?.active) await sendAssistantText(link.phone, text, "jobflex-assistant-alert").catch(() => false);
  return true;
}

/**
 * The hourly look at every open promise: closed when a later event proves it was kept, and its owner reminded the
 * morning it is due and once more — with the office — when it is late.
 */
export async function sweepPromises(now = new Date()): Promise<{ checked: number; kept: number; reminded: number }> {
  const open = await db.clientPromise.findMany({
    // A company on the Free plan: its promises are left alone — no proof read, no reminder (owner, 2026-11-09).
    where: { status: "OPEN", organization: { deletedAt: null }, client: { deletedAt: null }, organizationId: { notIn: await lapsedOrgIds() } },
    orderBy: { createdAt: "desc" },
    take: 400,
    include: { client: { select: { id: true, name: true, phone: true } }, owner: { select: { id: true, name: true, email: true } }, organization: { select: { timezone: true } } },
  });
  const tally = { checked: open.length, kept: 0, reminded: 0 };
  const byClient = new Map<string, typeof open>();
  for (const p of open) byClient.set(p.clientId, [...(byClient.get(p.clientId) ?? []), p]);
  const stillOpen: typeof open = [];

  for (const list of byClient.values()) {
    const first = list[0];
    const tz = first.organization.timezone || "America/New_York";
    const kinds = new Set(list.map((p) => parseKind(p.kind)));
    const provable = [...kinds].some((k) => k !== "INFO" && k !== "OTHER");
    const from = new Date(Math.min(...list.map((p) => (p.sourceAt ?? p.createdAt).getTime())));
    const events = provable ? await evidenceEvents(first.organizationId, first.client, from, kinds).catch(() => []) : [];
    for (const p of list) {
      const proof = evidenceFor({ kind: parseKind(p.kind), direction: p.direction === "THEIRS" ? "THEIRS" : "OURS", since: (p.sourceAt ?? p.createdAt).getTime() }, events, tz);
      if (proof) {
        const r = await db.clientPromise.updateMany({ where: { id: p.id, status: "OPEN" }, data: { status: "KEPT", keptAt: new Date(proof.at), evidence: proof.words } });
        tally.kept += r.count;
      } else {
        stillOpen.push(p);
      }
    }
  }

  const office = new Map<string, string[]>();
  const officeOf = async (organizationId: string): Promise<string[]> => {
    const had = office.get(organizationId);
    if (had) return had;
    const rows = await db.membership.findMany({ where: { organizationId, role: { in: OFFICE_ROLES } }, select: { userId: true } });
    const ids = rows.map((r) => r.userId);
    office.set(organizationId, ids);
    return ids;
  };
  for (const p of stillOpen) {
    const tz = p.organization.timezone || "America/New_York";
    const step = reminderDue(p, now, tz);
    if (!step || !p.dueAt) continue;
    // Claimed first, so two overlapping runs never remind twice.
    const claim = await db.clientPromise.updateMany({ where: { id: p.id, status: "OPEN", remindedAt: p.remindedAt }, data: { remindedAt: now } });
    if (!claim.count) continue;
    const ownerName = p.owner ? (p.owner.name ?? "").trim() || (p.owner.email ?? "").split("@")[0] || null : null;
    const facts = { client: p.client.name, text: p.text, dueAt: p.dueAt, owner: ownerName };
    const people = new Set<string>();
    if (p.ownerId) people.add(p.ownerId);
    // Nobody's promise, or a late one: the office hears too.
    if (!p.ownerId || step === "late") for (const id of await officeOf(p.organizationId)) people.add(id);
    for (const userId of people) {
      const sent = await remind(p.organizationId, userId, reminderWords(step, facts, userId === p.ownerId, now, tz), now, tz).catch(() => false);
      if (sent) tally.reminded += 1;
    }
  }
  return tally;
}
