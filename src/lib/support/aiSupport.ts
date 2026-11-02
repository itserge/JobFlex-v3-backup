import "server-only";
import { approveTrialRequest, pendingTrialRequest } from "@/lib/trialExtensionServer";
import { trialExtensionEligible } from "@/lib/trialExtension";
// SUPPORT · THE AI ON A TICKET (2026-10-15) — the server half of
// lib/support/aiReply: what the model is told about the customer, the call,
// the sends, the copies to the support inbox, and the fix decisions.
//
// WHEN IT RUNS
//   · a new ticket — actions/support submitSupportTicket hands it over with
//     after(), so the customer's "Send" returns at once;
//   · the customer's next message in the conversation (2026-10-17) — the same
//     after(), from actions/support postSupportReply and the inbound email
//     route — while no person leads the ticket (aiState aiMayAnswer: nobody
//     on the team has written, it wasn't handed over, it hasn't said its share);
//   · the safety net — /api/cron/support-ai every 10 minutes answers a new
//     ticket, or a customer's last message, the AI never read (the request
//     that filed it ended first);
//   · an admin's "Ask AI" on any ticket — always a draft, never a send.
//
// WHAT IT SENDS IS A MESSAGE in the ticket's conversation (from "ai", signed
// "JobFlex support", lib/supportThread), emailed to the customer like any of ours.
//
// ITS OWN OPENAI CLIENT. The shared one (lib/sdk/openai) bills each call to
// the request's organization through lib/trialMeter, and a new ticket's
// answer runs inside the CUSTOMER's request — their trial AI budget would pay
// for our support. Answering tickets is the platform's cost, so this client is
// not metered (lib/support/unmeteredOpenAI, shared with SmartHelp). Same key,
// same model (resolveOpenAIModel), same sampling rule.
//
// NOTHING HERE CHANGES AN ACCOUNT. It reads the customer's facts, writes a
// letter, keeps a record (SyncState `supportAi:<ticketId>`, `supportAi:
// settings` — no schema change) and sends email. A fix is a proposal that
// waits for an admin's Approve; "Mark fixed" only tells the customer.
//
// A SMARTHELP HAND-OFF ("Ask a person", 2026-10-30) is marked in the same
// transaction that files it (SyncState `supportOrigin:<ticketId>`), so none
// exists unmarked: every answer the AI writes for it — the first, a
// follow-up, the safety net's — waits for a person to send.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { unmeteredOpenAI } from "@/lib/support/unmeteredOpenAI";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { supportRecipients, supportTicketRef } from "@/lib/notify";
import { postSupportMessage, recipientForTicket, threadOf, threadsFor } from "@/lib/supportThread";
import type { AiKind, ThreadMessage } from "@/lib/supportReply";
import { getOrgLimitUsage } from "@/lib/limitsEngine";
import { recentServerErrors } from "@/lib/posthog";
import {
  DEFAULT_SUPPORT_AI_MODE,
  FIXED_NOTE_RULES,
  deliveryFor,
  failedRecord,
  firstNameOf,
  fixApprovedEmail,
  fixedNoteUserPrompt,
  fixedReplyTemplate,
  holdingReply,
  liveStateOf,
  parseSupportAiRecord,
  stillStuckEmail,
  recordFor,
  supportAiAnswerSchema,
  supportAiMode,
  supportOriginOf,
  supportSystemPrompt,
  supportUserPrompt,
  teamCopyEmail,
  aiMayAnswer,
  extensionOfferFact,
  type LiveState,
  type SupportAiMode,
  type SupportAiOutcome,
  type SupportAiRecord,
  type SupportOrigin,
} from "./aiReply";

const SETTINGS_KEY = "supportAi:settings";
const RECORD_KEY = (ticketId: string) => `supportAi:${ticketId}`;
const ORIGIN_KEY = (ticketId: string) => `supportOrigin:${ticketId}`;
const TEAM_SIGNATURE = "JobFlex support";

// ── The switch and the records ───────────────────────────────────────────────

export async function readSupportAiMode(): Promise<SupportAiMode> {
  const row = await db.syncState.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
  if (!row?.cursor) return DEFAULT_SUPPORT_AI_MODE;
  try {
    return supportAiMode((JSON.parse(row.cursor) as { mode?: unknown }).mode);
  } catch {
    return DEFAULT_SUPPORT_AI_MODE;
  }
}

export async function writeSupportAiMode(mode: SupportAiMode, by: string): Promise<void> {
  const cursor = JSON.stringify({ mode, by, at: new Date().toISOString() });
  await db.syncState.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, cursor }, update: { cursor } });
}

export async function readSupportAi(ticketId: string): Promise<SupportAiRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: RECORD_KEY(ticketId) } }).catch(() => null);
  return parseSupportAiRecord(row?.cursor);
}

/** The records of many tickets in one read, keyed by ticket id. */
export async function supportAiForTickets(ticketIds: string[]): Promise<Record<string, SupportAiRecord>> {
  if (!ticketIds.length) return {};
  const rows = await db.syncState.findMany({ where: { key: { in: ticketIds.map(RECORD_KEY) } } }).catch(() => []);
  const out: Record<string, SupportAiRecord> = {};
  for (const r of rows) {
    const rec = parseSupportAiRecord(r.cursor);
    if (rec) out[r.key.slice("supportAi:".length)] = rec;
  }
  return out;
}

async function writeSupportAi(ticketId: string, rec: SupportAiRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({ where: { key: RECORD_KEY(ticketId) }, create: { key: RECORD_KEY(ticketId), cursor }, update: { cursor } });
}

/** Marks a ticket filed from SmartHelp's "Ask a person": the AI only drafts for it. `tx` is the transaction that
 *  creates the ticket (actions/support), so a hand-off never exists unmarked. `logId`: the SmartHelp question it
 *  carries, or null. */
export async function markSmartHelpTicket(tx: Prisma.TransactionClient, ticketId: string, logId: string | null): Promise<void> {
  const cursor = JSON.stringify({ origin: "smarthelp", logId });
  await tx.syncState.upsert({ where: { key: ORIGIN_KEY(ticketId) }, create: { key: ORIGIN_KEY(ticketId), cursor }, update: { cursor } });
}

/** Where a ticket came from (aiReply supportOriginOf): no row is none. A failed read REJECTS rather than taking a
 *  hand-off for a plain ticket — every caller of answerTicketWithAi catches it, and the safety net tries again. */
async function readSupportOrigin(ticketId: string): Promise<SupportOrigin | undefined> {
  const row = await db.syncState.findUnique({ where: { key: ORIGIN_KEY(ticketId) }, select: { cursor: true } });
  return supportOriginOf(row?.cursor);
}

// ── What the model is told about the customer ───────────────────────────────

const day = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

type TicketRow = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

function loadTicket(ticketId: string) {
  return db.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          billingEmail: true,
          createdAt: true,
          timezone: true,
          tradeTypesJson: true,
          smsFromNumber: true,
          smsClientsOn: true,
          logoUrl: true,
          deletedAt: true,
        },
      },
      user: { select: { id: true, email: true, name: true, emailVerified: true, hashedPassword: true, createdAt: true } },
    },
  });
}

/** Plain sentences about the account — accurate, and nothing the customer couldn't see themselves. */
async function accountFacts(t: TicketRow): Promise<string[]> {
  const org = t.organization;
  const facts: string[] = [];
  const [sub, membership, members, google, proposals, proposals30, clients, others, usage] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId: org.id } }).catch(() => null),
    t.user ? db.membership.findFirst({ where: { organizationId: org.id, userId: t.user.id }, select: { role: true } }).catch(() => null) : null,
    db.membership.findMany({ where: { organizationId: org.id }, select: { role: true } }).catch(() => []),
    t.user ? db.account.count({ where: { userId: t.user.id, provider: "google" } }).catch(() => 0) : 0,
    db.proposal.count({ where: { organizationId: org.id } }).catch(() => null),
    db.proposal.count({ where: { organizationId: org.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }).catch(() => null),
    db.client.count({ where: { organizationId: org.id } }).catch(() => null),
    db.supportTicket
      .findMany({ where: { organizationId: org.id, id: { not: t.id } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, subject: true, status: true, createdAt: true } })
      .catch(() => []),
    getOrgLimitUsage(org.id).catch(() => []),
  ]);

  const who = t.user;
  if (who) {
    facts.push(`They are ${who.name?.trim() || "(no name on file)"}, ${who.email}${membership ? `, role ${membership.role} in the company` : ""}; user since ${day(who.createdAt)}.`);
    facts.push(
      `Signs in with ${[who.hashedPassword ? "email + password" : null, google ? "Google" : null].filter(Boolean).join(" and ") || "an unknown method"}; email ${who.emailVerified ? "verified" : "NOT verified"}.`,
    );
  } else {
    facts.push("Filed without a signed-in user on record; answers go to the account owner or billing email.");
  }
  facts.push(`Company: ${org.name}, on JobFlex since ${day(org.createdAt)}, timezone ${org.timezone}${org.deletedAt ? " — this company account is CLOSED" : ""}.`);
  try {
    const trades = JSON.parse(org.tradeTypesJson ?? "[]") as unknown;
    if (Array.isArray(trades) && trades.length) facts.push(`Trades: ${trades.slice(0, 6).join(", ")}.`);
  } catch {
    /* no trades */
  }
  facts.push(`Team: ${members.length} member${members.length === 1 ? "" : "s"} (${[...new Set(members.map((m) => m.role))].join(", ") || "none"}).`);
  if (sub) {
    const bits = [
      `Plan ${sub.plan}, status ${sub.status}`,
      sub.trialEndsAt ? `trial ${sub.trialEndsAt > new Date() ? "ends" : "ended"} ${day(sub.trialEndsAt)}` : null,
      sub.currentPeriodEnd ? `current period ends ${day(sub.currentPeriodEnd)}` : null,
      sub.canceledAt ? `canceled ${day(sub.canceledAt)}` : null,
      sub.externalSubId ? "has a Stripe subscription" : "no Stripe subscription on file",
    ].filter(Boolean);
    facts.push(`${bits.join("; ")}.`);
  } else {
    facts.push("No subscription row: on the free tier.");
  }
  // Whether the team can add trial days (owner, 2026-10-26: "if you didn't have enough time to explore the platform,
  // we can extend it for another 2 weeks") — the model offers it only when this says AVAILABLE.
  const pending = sub ? await pendingTrialRequest(org.id).catch(() => null) : null;
  facts.push(extensionOfferFact(sub, pending ? { days: pending.requestedDays } : null).fact);
  const limited = usage.filter((u) => u.limit !== null);
  if (limited.length) facts.push(`Usage this period: ${limited.map((u) => `${u.resource} ${u.used}/${u.limit}`).join(", ")}.`);
  if (proposals !== null) facts.push(`Proposals: ${proposals} in total, ${proposals30 ?? 0} in the last 30 days. Clients: ${clients ?? 0}.`);
  facts.push(`Texting: ${org.smsFromNumber ? "has a JobFlex texting number" : "no texting number yet"}; texts to clients ${org.smsClientsOn ? "on" : "off"}. Logo ${org.logoUrl ? "uploaded" : "not uploaded"}.`);
  if (others.length) {
    facts.push(`Their other recent tickets: ${others.map((o) => `${supportTicketRef(o.id)} "${o.subject.slice(0, 60)}" (${o.status}, ${day(o.createdAt)})`).join("; ")}.`);
  }
  return facts;
}

// ── The call ─────────────────────────────────────────────────────────────────

/** Unmetered on purpose — see the header. */
async function askModel(system: string, user: string): Promise<{ model: string; text: string }> {
  const model = await resolveOpenAIModel();
  const completion = await unmeteredOpenAI().chat.completions.create({
    model,
    ...(await samplingOptions(0.3)),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  return { model, text: completion.choices[0]?.message?.content ?? "{}" };
}

// ── Sends ────────────────────────────────────────────────────────────────────

/** The AI writes in the conversation (from "ai", signed by the team) and the
 *  customer is emailed (lib/supportThread). Kept even when the email fails —
 *  the customer reads it in the app; `emailNote` says why it didn't go. */
async function sendToCustomer(t: TicketRow, body: string, kind: AiKind): Promise<{ message: ThreadMessage; emailed: boolean; emailNote?: string }> {
  const r = await postSupportMessage({ ticketId: t.id, from: "ai", body, channel: "app", authorName: TEAM_SIGNATURE, kind });
  if (!r) throw new Error("That ticket is gone.");
  return r;
}

/** One send per address, as notifySupportTicket does — one bad address never silences the rest. */
async function sendToTeam(mail: { subject: string; html: string; text: string }, replyTo: string | null): Promise<boolean> {
  if (!isEmailEnabled()) return false;
  const to = await supportRecipients().catch(() => [] as string[]);
  let sent = 0;
  for (const address of to) {
    try {
      await sendEmail({ to: address, subject: mail.subject, html: mail.html, text: mail.text, replyTo: replyTo ?? undefined, kind: "support" });
      sent += 1;
    } catch (err) {
      console.error(`[support-ai] copy to ${address} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return sent > 0;
}

// ── Answering a ticket ───────────────────────────────────────────────────────

export interface AnswerOptions {
  /** "new": a ticket just filed — answers per the switch. "follow-up": the
   *  customer wrote again in the conversation — the same, while no person leads
   *  it (aiMayAnswer). "admin": Ask AI from admin — a draft, never sent. */
  trigger: "new" | "follow-up" | "admin";
}

export async function answerTicketWithAi(ticketId: string, opts: AnswerOptions): Promise<SupportAiRecord | null> {
  const mode = await readSupportAiMode();
  if (opts.trigger !== "admin" && mode === "off") return null;
  const t = await loadTicket(ticketId);
  if (!t) return null;
  const at = new Date().toISOString();
  const ref = supportTicketRef(t.id);
  const base = await appBaseUrl();
  const link = `${base.replace(/\/$/, "")}/admin/support?ticket=${t.id}`;
  const customerEmail = t.user?.email ?? null;
  const ticketForMail = { ref, subject: t.subject, body: t.body, orgName: t.organization.name, customerEmail };
  const [previous, thread, origin] = await Promise.all([readSupportAi(t.id), threadOf(t.id), readSupportOrigin(t.id)]);
  const automatic = opts.trigger !== "admin";

  // In the conversation the AI keeps out once a person leads it (owner, 2026-10-17).
  if (automatic) {
    const may = aiMayAnswer(thread, previous);
    if (!may.ok) {
      console.info(`[support-ai] ${ref}: not answering — ${may.why}.`);
      return null;
    }
  }

  const fail = async (model: string, reason: string) => {
    const rec = failedRecord(at, model, reason);
    if (previous?.fix) rec.fix = previous.fix;
    if (automatic) rec.copied = await sendToTeam(teamCopyEmail({ ticket: ticketForMail, record: rec, sentBody: null, facts: [], link }), customerEmail);
    await writeSupportAi(t.id, rec);
    return rec;
  };

  if (!isOpenAIEnabled()) return fail("-", "No OpenAI key on this server (OPENAI_API_KEY), so the AI cannot read tickets.");

  const [facts, errors] = await Promise.all([accountFacts(t), recentServerErrors(t.organizationId).catch(() => [] as string[])]);
  let model = "-";
  let answer;
  try {
    const asked = await askModel(
      supportSystemPrompt(),
      supportUserPrompt({
        ticket: { ref, subject: t.subject, body: t.body, category: t.category, priority: t.priority, filedAt: t.createdAt.toISOString() },
        facts,
        thread: thread.map((r) => ({ by: r.by, at: r.at, body: r.body, from: r.from })),
        errors,
        appUrl: base,
      }),
    );
    model = asked.model;
    answer = supportAiAnswerSchema.parse(JSON.parse(asked.text));
  } catch (err) {
    console.error(`[support-ai] ${ref}: reading failed:`, err instanceof Error ? err.message : err);
    return fail(model, `The model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // A person may have written while the model was reading: their word stands, the AI's is a draft.
  const overtaken = automatic && (await threadOf(t.id)).some((m) => m.from === "team");
  const effective: SupportAiMode = !automatic || overtaken ? "draft" : mode;
  // A SmartHelp hand-off is held here on every trigger — the first answer, a follow-up, the safety net's.
  const delivery = deliveryFor(answer, effective, origin);
  let outcome: SupportAiOutcome = effective === "auto" ? "held" : "drafted";
  let reason: string | undefined = overtaken ? "A person on the team answered while the AI was reading." : undefined;
  let sentBody: string | null = null;
  let ackSent = false;

  // What it sends is a message in the conversation (in progress, still UNREAD
  // for the admins — an AI answer is one they should see) and an email to the customer.
  if (delivery.send) {
    try {
      const r = await sendToCustomer(t, answer.reply, "answer");
      outcome = "sent";
      sentBody = answer.reply;
      if (!r.emailed) reason = `It's in the conversation, but not emailed: ${r.emailNote ?? "the email didn't go out."}`;
    } catch (err) {
      reason = `The answer wasn't kept: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (!overtaken) {
    reason = delivery.reason;
  }
  // Held in "answers on its own": the customer still hears from us at once.
  if (outcome === "held" && automatic) {
    try {
      const note = holdingReply(firstNameOf(t.user?.name, customerEmail), t.subject);
      await sendToCustomer(t, note, "ack");
      ackSent = true;
      sentBody = note;
    } catch (err) {
      console.error(`[support-ai] ${ref}: holding note failed:`, err instanceof Error ? err.message : err);
    }
  }

  const rec = recordFor(answer, { at, model, outcome, reason, ackSent });
  // A fix already decided keeps its decision when the AI reads the ticket again.
  if (previous?.fix && previous.fix.status !== "awaiting") rec.fix = previous.fix;
  if (automatic) {
    rec.copied = await sendToTeam(teamCopyEmail({ ticket: ticketForMail, record: rec, sentBody, facts, link }), customerEmail);
  }
  await writeSupportAi(t.id, rec);
  console.info(`[support-ai] ${ref}: ${opts.trigger} · ${rec.outcome} · ${rec.category} · ${rec.confidence}%${rec.fix ? ` · fix ${rec.fix.status}` : ""}${reason ? ` · ${reason}` : ""}`);
  return rec;
}

// ── The customer's Help window ───────────────────────────────────────────────

type Who = { userId: string; organizationId: string };

/** Only the person who filed a ticket reads its live state, and only the words that went to them. */
async function ownTicket(ticketId: string, who: Who) {
  const t = await loadTicket(ticketId);
  return t && t.organizationId === who.organizationId && t.userId === who.userId ? t : null;
}

/** What the Help window shows for a ticket the customer just filed. Null: not theirs. */
export async function liveAnswerFor(ticketId: string, who: Who): Promise<LiveState | null> {
  const t = await ownTicket(ticketId, who);
  if (!t) return null;
  const [rec, thread, mode] = await Promise.all([readSupportAi(t.id), threadOf(t.id), readSupportAiMode()]);
  return liveStateOf(rec, thread, { mode, aiOn: isOpenAIEnabled() });
}

/**
 * "That solved it" — the ticket is resolved. "I still need help" — it goes back
 * to Open and unread for the admins, the customer's note is kept on the AI's
 * record, and the support inbox hears that a person is needed.
 */
export async function recordCustomerVerdict(
  ticketId: string,
  who: Who,
  verdict: "solved" | "needs-person",
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await ownTicket(ticketId, who);
  if (!t) return { ok: false, error: "That ticket isn't one of yours." };
  const rec = await readSupportAi(t.id);
  if (!rec || rec.outcome !== "sent") return { ok: false, error: "There's no answer on this ticket yet." };
  const clean = note?.trim().slice(0, 2000) || undefined;
  rec.customer = { verdict, ...(clean ? { note: clean } : {}), at: new Date().toISOString() };
  await writeSupportAi(t.id, rec);
  if (verdict === "solved") {
    await db.supportTicket.update({ where: { id: t.id }, data: { status: "RESOLVED" } }).catch(() => {});
    return { ok: true };
  }
  // Their note is their next message in the conversation — kept without the
  // usual letter to the team: the "still stuck" one below says it all.
  if (clean) await postSupportMessage({ ticketId: t.id, from: "customer", body: clean, channel: "app", authorUserId: who.userId, notify: false }).catch(() => null);
  await db.supportTicket.update({ where: { id: t.id }, data: { status: "OPEN", adminReadAt: null, lastMessageAt: new Date() } }).catch(() => {});
  const base = await appBaseUrl();
  await sendToTeam(
    stillStuckEmail({
      ticket: { ref: supportTicketRef(t.id), subject: t.subject, body: t.body, orgName: t.organization.name, customerEmail: t.user?.email ?? null },
      answer: rec.reply,
      note: clean,
      link: `${base.replace(/\/$/, "")}/admin/support?ticket=${t.id}`,
    }),
    t.user?.email ?? null,
  );
  return { ok: true };
}

// ── The safety net ───────────────────────────────────────────────────────────

/** A ticket younger than this may still be in its own request's after(). */
const MISSED_AFTER_MS = 5 * 60_000;
/** Older than this, a person has the queue — the AI does not open a stale one. */
const MISSED_BEFORE_MS = 48 * 3600_000;

/**
 * What the AI never got to, between 5 minutes and 2 days old (by the
 * conversation's latest message): a NEW ticket it never read (no record, no
 * messages), and a FOLLOW-UP — the customer's message is the last one and the
 * AI hasn't read the ticket since — while no person leads the conversation
 * (answerTicketWithAi checks aiMayAnswer). A few per run, oldest first; the
 * switch decides as always. Off, or without a key: none.
 */
export async function answerMissedTickets(limit = 4): Promise<{ checked: number; answered: number }> {
  if ((await readSupportAiMode()) === "off" || !isOpenAIEnabled()) return { checked: 0, answered: 0 };
  const now = Date.now();
  const rows = await db.supportTicket.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, lastMessageAt: { lte: new Date(now - MISSED_AFTER_MS), gte: new Date(now - MISSED_BEFORE_MS) } },
    orderBy: { lastMessageAt: "asc" },
    take: 40,
    select: { id: true },
  });
  if (!rows.length) return { checked: 0, answered: 0 };
  const ids = rows.map((r) => r.id);
  const [records, threads] = await Promise.all([supportAiForTickets(ids), threadsFor(ids)]);
  const missed: Array<{ id: string; trigger: "new" | "follow-up" }> = [];
  for (const id of ids) {
    const thread = threads[id] ?? [];
    const last = thread[thread.length - 1];
    if (!thread.length && !records[id]) missed.push({ id, trigger: "new" });
    else if (last?.from === "customer" && (!records[id] || records[id].at < last.at) && aiMayAnswer(thread, records[id] ?? null).ok) missed.push({ id, trigger: "follow-up" });
  }
  let answered = 0;
  for (const { id, trigger } of missed.slice(0, limit)) {
    const rec = await answerTicketWithAi(id, { trigger }).catch((err) => {
      console.error(`[support-ai] safety net: ${supportTicketRef(id)} failed:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (rec) answered += 1;
  }
  return { checked: rows.length, answered };
}

// ── Re-drafting what waits, and the days the team can give ────────────────────

/** Every answer still waiting for a person (drafted or held, the customer not yet answered by one of us) written
 *  again under the current rules (owner, 2026-10-26: "re-answer the existing answers") — drafts, never sent. */
export async function redraftWaitingTickets(limit = 20): Promise<{ waiting: number; redrafted: number }> {
  if (!isOpenAIEnabled()) return { waiting: 0, redrafted: 0 };
  const rows = await db.supportTicket.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { lastMessageAt: "desc" }, take: 100, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { waiting: 0, redrafted: 0 };
  const [records, threads] = await Promise.all([supportAiForTickets(ids), threadsFor(ids)]);
  const waiting = ids.filter((id) => {
    const r = records[id];
    return !!r && (r.outcome === "drafted" || r.outcome === "held") && aiMayAnswer(threads[id] ?? [], r).ok;
  });
  let redrafted = 0;
  for (const id of waiting.slice(0, limit)) {
    const rec = await answerTicketWithAi(id, { trigger: "admin" }).catch((err) => {
      console.error(`[support-ai] re-draft ${supportTicketRef(id)} failed:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (rec && rec.outcome !== "failed") redrafted += 1;
  }
  return { waiting: waiting.length, redrafted };
}

export type GrantResult = { ok: true; until: string | null; localOnly: boolean } | { ok: false; error: string };

/** The days offered on a ticket, given: a trial-extension request filed for the company (or its pending one) and
 *  approved at once — the customer gets the "Your trial is extended until …" email the approval sends. */
export async function grantTrialDaysFromTicket(ticketId: string, days: number, actor: { id: string }): Promise<GrantResult> {
  const t = await db.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, organizationId: true, userId: true, subject: true } });
  if (!t) return { ok: false, error: "That ticket is gone." };
  const sub = await db.subscription.findUnique({ where: { organizationId: t.organizationId } });
  if (!sub || sub.provider === "MANUAL" || !trialExtensionEligible(sub)) return { ok: false, error: "Their trial can't be extended: it isn't running, and it didn't end within the last 14 days." };
  let req = await pendingTrialRequest(t.organizationId).catch(() => null);
  if (!req) {
    try {
      req = await db.trialExtensionRequest.create({
        data: { organizationId: t.organizationId, userId: t.userId, requestedDays: days, note: `Offered from support ticket ${supportTicketRef(t.id)}: "${t.subject.slice(0, 80)}"`, plan: sub.plan, trialStartedAt: null, trialEndsAt: sub.trialEndsAt },
      });
    } catch (err) {
      console.error("[support-ai] extension request failed:", err instanceof Error ? err.message : err);
      return { ok: false, error: "Couldn't file the extension — try it from Trial requests." };
    }
  }
  const res = await approveTrialRequest(req.id, days, actor);
  if (!res.ok) return res;
  return { ok: true, until: res.until ?? null, localOnly: !!res.localOnly };
}

// ── The fix: approve, decline, done ──────────────────────────────────────────

export type FixResult = { ok: true; record: SupportAiRecord; reply?: ThreadMessage } | { ok: false; error: string };

export async function decideFix(
  ticketId: string,
  decision: "approve" | "decline",
  by: { id: string; email: string; name: string | null },
  note?: string,
): Promise<FixResult> {
  const rec = await readSupportAi(ticketId);
  if (!rec?.fix) return { ok: false, error: "This ticket has no fix proposal." };
  if (rec.fix.status === "done") return { ok: false, error: "This fix is already done." };
  const t = await loadTicket(ticketId);
  if (!t) return { ok: false, error: "That ticket is gone." };
  const who = by.name?.trim() || by.email;
  rec.fix = {
    ...rec.fix,
    status: decision === "approve" ? "approved" : "declined",
    decidedBy: who,
    decidedAt: new Date().toISOString(),
    ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}),
  };
  await writeSupportAi(ticketId, rec);
  if (decision === "approve") {
    const base = await appBaseUrl();
    const link = `${base.replace(/\/$/, "")}/admin/support?ticket=${ticketId}`;
    await sendToTeam(
      fixApprovedEmail({ ticket: { ref: supportTicketRef(t.id), subject: t.subject, body: t.body, orgName: t.organization.name }, fix: rec.fix, by: who, link }),
      t.user?.email ?? null,
    );
    // The approved fix lands on the team's board (/admin/tasks) — once.
    try {
      const { createTaskFromTicket } = await import("@/lib/adminTasks/service");
      await createTaskFromTicket(by, ticketId);
    } catch (err) {
      console.warn("[support-ai] no task for the approved fix:", err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, record: rec };
}

/** The fix is live: the customer is told (by the AI's words, or the plain note), and the ticket is resolved. */
export async function markFixDone(ticketId: string, by: { email: string; name: string | null }): Promise<FixResult> {
  const rec = await readSupportAi(ticketId);
  if (!rec?.fix) return { ok: false, error: "This ticket has no fix proposal." };
  if (rec.fix.status !== "approved") return { ok: false, error: rec.fix.status === "done" ? "The customer was already told." : "Approve the fix first." };
  const t = await loadTicket(ticketId);
  if (!t) return { ok: false, error: "That ticket is gone." };
  const to = await recipientForTicket(t);
  if (!to) return { ok: false, error: "This ticket has no address to answer." };
  if (!isEmailEnabled()) return { ok: false, error: "Email isn't set up on this server, so the customer can't be told." };
  const name = firstNameOf(t.user?.name, t.user?.email);
  let body = fixedReplyTemplate(name, t.subject);
  if (isOpenAIEnabled()) {
    try {
      const asked = await askModel(FIXED_NOTE_RULES, fixedNoteUserPrompt({ firstName: name, subject: t.subject, message: t.body, fixTitle: rec.fix.title, note: rec.fix.note }));
      const written = String((JSON.parse(asked.text) as { reply?: unknown }).reply ?? "").trim();
      if (written.length >= 40 && written.length <= 2000) body = written;
    } catch (err) {
      console.warn("[support-ai] fixed note fell back to the template:", err instanceof Error ? err.message : err);
    }
  }
  let reply: ThreadMessage;
  try {
    const r = await sendToCustomer(t, body, "fixed");
    if (!r.emailed) console.warn(`[support-ai] ${supportTicketRef(t.id)}: the fixed note is in the conversation but not emailed — ${r.emailNote ?? ""}`);
    reply = r.message;
  } catch (err) {
    return { ok: false, error: `The customer wasn't told: ${err instanceof Error ? err.message : String(err)}` };
  }
  rec.fix = { ...rec.fix, status: "done", doneBy: by.name?.trim() || by.email, doneAt: new Date().toISOString() };
  await writeSupportAi(ticketId, rec);
  await db.supportTicket.update({ where: { id: ticketId }, data: { status: "RESOLVED" } }).catch(() => {});
  const ref = supportTicketRef(t.id);
  await sendToTeam(
    {
      subject: `[Fixed — customer told] ${ref} · ${rec.fix.title.slice(0, 90)}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111">Marked fixed by ${escapeHtml(rec.fix.doneBy ?? "")}. Sent to ${escapeHtml(to)}:<div style="background:#eef6ef;border-radius:6px;padding:12px 14px;margin-top:8px;line-height:1.5">${escapeHtml(body).replace(/\n/g, "<br>")}</div></div>`,
      text: `Marked fixed by ${rec.fix.doneBy}. Sent to ${to}:\n\n${body}`,
    },
    t.user?.email ?? null,
  );
  return { ok: true, record: rec, reply };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
