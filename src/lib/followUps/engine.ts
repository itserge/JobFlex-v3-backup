// Follow-up scheduling + dispatch engine. Plain server module — NOT a
// "use server" file. These used to be exported from src/actions/followUps.ts,
// which made them public POST endpoints: anyone holding a proposal id could
// enqueue follow-up email/SMS to that org's client and fire the dispatcher
// without the cron secret. Only server code (proposal status changes, the
// cron route, the CRM "send now" action) may call these.
//
// THE FOLLOW-UP AGENT (Smart CRM part 4, 2026-11-10): a queued row is no longer a bare timer. When its time comes
// the engine gathers what is known about the client (did they write back, is a person already talking to them, do
// we still owe them something) and lib/followUps/agent `decide` says: close it unsent, wait, hand it to a person
// (ASK: a prepared draft · SUGGEST: a reminder), or send it — with the standard words or ones written for this
// client (lib/followUps/writer). A person pressing Send is never second-guessed beyond the proposal's status.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { companyOptOut, withOptOut } from "@/lib/email/optOutFooter";
import { companyOptedOut } from "@/lib/winback/optout";
import { renderEmail } from "@/lib/email/renderEmail";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { sendText } from "@/lib/sms/send";
import {
  delayLabel,
  encodeDispatch,
  followUpEmailDoc,
  followUpPlainWords,
  followUpSmsText,
  parseChannel,
  parseDispatch,
  type FollowUpChannel,
  type FollowUpContext,
} from "@/lib/followUps/copy";
import { decide, draftParagraphs, parseMode, parseWords, stillCurrent, textWithLink, type AgentFacts } from "@/lib/followUps/agent";
import { samePhone } from "@/lib/clientTimeline/shared";
import { trialBlocksText } from "@/lib/trialMeter";
import { ProposalStatus } from "@/lib/prismaEnums";

/** Appended to the note of a queued row that was closed without sending, so
 *  the row says why it never went. */
export const SKIPPED_MARK = " · skipped: ";

/** AI-written follow-ups per hourly run: the rest wait an hour, so the run always ends in time. */
const AI_PER_RUN = 15;

// Called from sendProposal / updateProposalStatus when a status changes — schedules any matching rule.
export async function scheduleFollowUpsFor(proposalId: string, newStatus: string) {
  const proposal = await db.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { scheduled: 0 };

  const rules = await db.followUpRule.findMany({
    where: {
      organizationId: proposal.organizationId,
      triggerStatus: newStatus,
      enabled: true,
    },
  });

  // A re-send restarts the clock: what the last send queued under the same
  // status is closed, or every re-send would add one more set of reminders.
  if (rules.length) {
    const queued = await db.followUp.findMany({
      where: { proposalId: proposal.id, completedAt: null },
      select: { id: true, templateId: true, note: true },
    });
    for (const q of queued) {
      if ((parseDispatch(q.templateId).trigger ?? ProposalStatus.SENT) !== newStatus) continue;
      await db.followUp.update({
        where: { id: q.id },
        data: { completedAt: new Date(), note: `${q.note ?? ""}${SKIPPED_MARK}re-${newStatus.toLowerCase()}` },
      });
    }
  }

  let scheduled = 0;
  for (const r of rules) {
    const runAt = new Date(Date.now() + r.delayMinutes * 60 * 1000);
    await db.followUp.create({
      data: {
        organizationId: proposal.organizationId,
        proposalId: proposal.id,
        runAt,
        note: `${r.name} · ${r.triggerStatus} + ${r.delayMinutes}m`,
        // The queued row has to survive the rule being edited or deleted before
        // it fires, so it carries its own copy of what to send and how.
        // `templateId` is a free-form String? with no foreign key — see
        // src/lib/followUps/copy.ts.
        templateId: encodeDispatch(parseChannel(r.template), r.triggerStatus),
        // …and of who sends it and whose words (lib/followUps/agent).
        mode: parseMode(r.mode),
        words: parseWords(r.words),
      },
    });
    scheduled++;
  }
  return { scheduled };
}

// Cron: every follow-up whose time has come is decided; every draft waiting for a person is looked at again.
export async function runDueFollowUps(now = new Date()): Promise<{ processed: number; delivered: number; ready: number; stopped: number; waiting: number }> {
  const due = await db.followUp.findMany({
    where: { completedAt: null, state: { not: "READY" }, runAt: { lte: now } },
    orderBy: { runAt: "asc" },
    take: 50,
    select: { id: true },
  });
  const tally = { processed: due.length, delivered: 0, ready: 0, stopped: 0, waiting: 0 };
  const budget = { ai: AI_PER_RUN };
  for (const fu of due) {
    const r = await workOne(fu.id, now, budget).catch((err) => {
      console.warn("[follow-ups] one failed:", fu.id, err instanceof Error ? err.message : err);
      return "error" as const;
    });
    if (r === "sent") tally.delivered++;
    else if (r === "ready") tally.ready++;
    else if (r === "stopped") tally.stopped++;
    else if (r === "wait") tally.waiting++;
  }
  // Drafts in a person's hands: closed when the client answered meanwhile, or when nobody acted for a week.
  const ready = await db.followUp.findMany({ where: { completedAt: null, state: "READY" }, orderBy: { readyAt: "asc" }, take: 100, select: { id: true } });
  for (const fu of ready) {
    const r = await workOne(fu.id, now, budget).catch(() => "error" as const);
    if (r === "stopped") tally.stopped++;
  }
  return tally;
}

/** `scheduleFollowUpsFor` writes the delay into the note as "… + 2880m", which
 *  is the only record of how long the rule waited once the row is queued. The
 *  prose says it out loud ("we sent this over 2 days ago"), so it is read back
 *  here rather than guessed. A row from before this change, or a hand-made one,
 *  just gets the neutral fallback. */
function delayFromNote(note: string | null): string {
  const m = note ? /\+\s*(\d+)m\b/.exec(note) : null;
  return m ? delayLabel(Number(m[1])) : "a few days";
}

async function loadRow(id: string) {
  const fu = await db.followUp.findUnique({ where: { id } });
  if (!fu || fu.completedAt) return null;
  const proposal = fu.proposalId
    ? await db.proposal.findUnique({
        where: { id: fu.proposalId },
        include: {
          client: true,
          organization: { select: { id: true, name: true, address: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, logoUrl: true, phone: true, timezone: true } },
        },
      })
    : null;
  return { fu, proposal };
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadRow>>>;
type LoadedProposal = NonNullable<Loaded["proposal"]>;

async function contextOf(fu: Loaded["fu"], proposal: LoadedProposal): Promise<FollowUpContext> {
  const appUrl = await appBaseUrl();
  return {
    orgName: proposal.organization.name,
    orgLogoUrl: proposal.organization.logoUrl,
    orgId: proposal.organizationId,
    orgPhone: proposal.organization.phone,
    clientName: proposal.client?.name ?? "there",
    title: proposal.title,
    total: proposal.total,
    validUntil: proposal.validUntil,
    href: `${appUrl}/portal/q/${proposal.publicId}`,
    delayLabel: delayFromNote(fu.note),
  };
}

/** What the agent needs to know about the client before it decides. */
async function gatherFacts(fu: Loaded["fu"], proposal: LoadedProposal, now: Date): Promise<AgentFacts> {
  const org = proposal.organizationId;
  const { trigger } = parseDispatch(fu.templateId);
  // "They wrote back" is counted from the moment the follow-up is about: the send — or, for a decline, the decline.
  const since = (trigger === ProposalStatus.DECLINED ? proposal.declinedAt : null) ?? proposal.sentAt ?? null;
  const client = proposal.client;
  const base: AgentFacts = {
    now,
    tz: proposal.organization.timezone || "America/New_York",
    trigger: trigger ?? ProposalStatus.SENT,
    proposalStatus: proposal.status,
    mode: parseMode(fu.mode),
    state: fu.state === "READY" ? "READY" : "QUEUED",
    readyAt: fu.readyAt,
    since,
    lastInboundAt: null,
    dealLost: false,
    lastHandWrittenAt: null,
    lastFollowUpAt: null,
    ourPromise: null,
  };
  const deal = await db.dealState.findUnique({ where: { key: `proposal:${proposal.id}` }, select: { stage: true, stageAt: true, organizationId: true } }).catch(() => null);
  // A hand move to Lost counts until the proposal is sent again (a later real event wins, as on the board).
  base.dealLost = Boolean(deal && deal.organizationId === org && deal.stage === "LOST" && (!since || !deal.stageAt || deal.stageAt.getTime() >= since.getTime()));
  if (!client) return base;

  const from = since ?? new Date(now.getTime() - 30 * 86_400_000);
  const recent = new Date(now.getTime() - 3 * 86_400_000);
  const hasPhone = Boolean(client.phone && client.phone.replace(/\D/g, "").length >= 7);
  const [thread, texts, calls, siblings, promise] = await Promise.all([
    db.clientThread.findFirst({ where: { organizationId: org, clientId: client.id }, select: { id: true } }),
    hasPhone
      ? db.smsMessage.findMany({
          where: { organizationId: org, createdAt: { gte: from < recent ? from : recent } },
          select: { direction: true, to: true, from: true, kind: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 400,
        })
      : Promise.resolve([]),
    hasPhone
      ? db.aiPhoneCall.findMany({ where: { organizationId: org, direction: "INBOUND", startedAt: { gte: from } }, select: { fromNumber: true, startedAt: true }, orderBy: { startedAt: "desc" }, take: 100 })
      : Promise.resolve([]),
    db.proposal.findMany({ where: { organizationId: org, clientId: client.id }, select: { id: true }, take: 50 }),
    db.clientPromise.findFirst({ where: { organizationId: org, clientId: client.id, status: "OPEN", direction: "OURS" }, orderBy: { createdAt: "asc" }, select: { text: true, dueAt: true, createdAt: true } }),
  ]);
  const [lastIn, lastOut] = thread
    ? await Promise.all([
        db.clientMessage.findFirst({ where: { threadId: thread.id, direction: "IN" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        db.clientMessage.findFirst({ where: { threadId: thread.id, direction: "OUT", channel: { not: "NOTE" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ])
    : [null, null];
  const newest = (...ds: Array<Date | null | undefined>): Date | null => ds.reduce<Date | null>((best, d) => (d && (!best || d.getTime() > best.getTime()) ? d : best), null);

  const textIn = texts.find((t) => t.direction === "IN" && samePhone(t.from, client.phone));
  const callIn = calls.find((c) => samePhone(c.fromNumber, client.phone));
  // A text a person typed (the inbox reply, the client page's Message dialog) — never one a rule sent.
  const textByHand = texts.find((t) => t.direction === "OUT" && (t.kind === "reply" || t.kind === "client-message") && !["SKIPPED", "FAILED", "UNDELIVERED"].includes(t.status) && samePhone(t.to, client.phone));
  base.lastInboundAt = newest(lastIn?.createdAt, textIn?.createdAt, callIn?.startedAt);
  base.lastHandWrittenAt = newest(lastOut?.createdAt, textByHand?.createdAt);
  base.ourPromise = promise;

  const other = await db.followUp.findFirst({
    where: { organizationId: org, proposalId: { in: siblings.map((s) => s.id) }, id: { not: fu.id }, completedAt: { not: null, gte: new Date(now.getTime() - 2 * 86_400_000) }, NOT: { note: { contains: SKIPPED_MARK.trim() } } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  base.lastFollowUpAt = other?.completedAt ?? null;
  return base;
}

/** Which channel can really carry it right now: a text falls back to email when texting can't go. */
async function channelFor(channel: FollowUpChannel, proposal: LoadedProposal): Promise<FollowUpChannel | null> {
  // TEXT falls back to email when the number was removed after the rule was
  // written — a follow-up that goes nowhere is worse than one that arrives on
  // the other channel.
  // The card-less trial sends no texts (lib/trialMeter): a TEXT follow-up
  // goes by email instead, the same fallback as a removed number.
  const canText = channel === "TEXT" && (await isTwilioEnabled()) && Boolean(proposal.client?.phone) && !(await trialBlocksText(proposal.organizationId, "follow-up"));
  if (canText) return "TEXT";
  return proposal.client?.email ? "EMAIL" : null;
}

/** The words for one follow-up: written for this client when asked for and possible, else the standard ones. */
async function wordsFor(fu: Loaded["fu"], proposal: LoadedProposal, ctx: FollowUpContext, channel: FollowUpChannel, trigger: string, budget: { ai: number } | null): Promise<{ by: "ai" | "rules"; subject: string | null; body: string }> {
  if (parseWords(fu.words) === "AI" && (!budget || budget.ai > 0)) {
    if (budget) budget.ai -= 1;
    const { writeFollowUp } = await import("@/lib/followUps/writer");
    const earlier = await db.followUp.count({ where: { proposalId: proposal.id, id: { not: fu.id }, completedAt: { not: null }, NOT: { note: { contains: SKIPPED_MARK.trim() } } } });
    const w = await writeFollowUp({
      organizationId: proposal.organizationId,
      clientId: proposal.clientId,
      channel,
      trigger,
      ctx,
      proposal: { status: proposal.status, viewCount: proposal.viewCount, sentAt: proposal.sentAt },
      earlier,
    }).catch(() => null);
    if (w) return { by: "ai", subject: w.subject, body: w.body };
  }
  if (channel === "TEXT") return { by: "rules", subject: null, body: followUpSmsText(trigger, ctx) };
  const plain = followUpPlainWords(trigger, ctx);
  return { by: "rules", subject: plain.subject, body: plain.body };
}

/** Send it. `own` = words that are not the standard ones (AI's, or a person's edit). */
async function send(fu: Loaded["fu"], proposal: LoadedProposal, ctx: FollowUpContext, own: { by: string; subject: string | null; body: string } | null, byUserId: string | null): Promise<void> {
  const { channel, trigger } = parseDispatch(fu.templateId);
  const trig = trigger ?? "SENT";
  /** What actually left the building, for the activity log. */
  let outcome: { kind: "EMAIL" | "TEXT"; to: string } | null = null;
  /** Why no email went, when the client asked for none (lib/winback/optout, lib/mailBlock). */
  let unsubscribed: string | null = null;
  const via = await channelFor((fu.draftChannel === "TEXT" || fu.draftChannel === "EMAIL" ? fu.draftChannel : channel) as FollowUpChannel, proposal);

  if (via === "TEXT" && proposal.client?.phone) {
    // From the company's own number to a client who said yes; a text that
    // cannot leave falls back to the email below (lib/sms/send, 2026-10-02).
    const body = own ? textWithLink(own.body, trig, ctx.href) : followUpSmsText(trig, ctx);
    const res = await sendText({ organizationId: proposal.organizationId, to: proposal.client.phone, body, kind: "follow-up" });
    if (res.ok && res.status !== "SKIPPED") outcome = { kind: "TEXT", to: proposal.client.phone };
  }
  if (!outcome && proposal.client?.email && (await companyOptedOut(proposal.organizationId, proposal.client.email))) unsubscribed = proposal.client.email;
  if (!outcome && !unsubscribed && proposal.client?.email) {
    // Words written as a text that have to go by email after all: the link is the button's, not the prose's.
    const prose = own ? draftParagraphs(own.body.split(ctx.href).join("").trim()) : [];
    // The way out and the company's postal address at the foot, the one-click headers above (lib/email/optOutFooter).
    const foot = companyOptOut(await appBaseUrl(), { id: proposal.organizationId, name: proposal.organization.name, address: proposal.organization.address }, proposal.client.email);
    const { subject: subj, html } = renderEmail(withOptOut(followUpEmailDoc(trig, ctx, own ? { subject: own.subject, prose } : undefined), foot));
    // Sends via the org's connected Gmail when opted in, else Resend/SMTP with
    // the contractor as reply-to.
    const res = await sendOrgEmail(proposal.organization, {
      clientId: proposal.clientId,
      to: proposal.client.email,
      subject: subj,
      html,
      kind: "follow-up",
      headers: foot.headers,
    });
    if (res.blocked) unsubscribed = proposal.client.email;
    else outcome = { kind: "EMAIL", to: proposal.client.email };
  }

  await db.followUp.update({ where: { id: fu.id }, data: { completedAt: new Date(), state: "QUEUED", reason: null, ...(own ? { draftBy: own.by, draftSubject: own.subject, draftBody: own.body } : {}) } });
  const whose = own?.by === "ai" ? " (written for them by AI)" : own?.by === "person" ? " (edited by hand)" : "";
  await db.activityEvent.create({
    data: {
      organizationId: fu.organizationId,
      proposalId: fu.proposalId,
      actorId: byUserId,
      kind: outcome?.kind ?? "EMAIL",
      summary: outcome ? `Follow-up ${outcome.kind === "TEXT" ? "texted" : "emailed"} to ${outcome.to}${whose}` : unsubscribed ? `Follow-up not emailed — ${unsubscribed} asked for no more emails` : "Follow-up closed — no reachable contact",
    },
  });
}

async function closeUnsent(fu: Loaded["fu"], why: string): Promise<void> {
  await db.followUp.update({ where: { id: fu.id }, data: { completedAt: new Date(), state: "QUEUED", reason: null, note: `${fu.note ?? ""}${SKIPPED_MARK}${why}` } });
}

/** Put the words on the row for a person to read (ASK, or "write it for me" on a reminder). */
export async function prepareDraft(id: string, budget: { ai: number } | null = null): Promise<boolean> {
  const row = await loadRow(id);
  if (!row?.proposal) return false;
  const { fu, proposal } = row;
  const { channel, trigger } = parseDispatch(fu.templateId);
  const via = await channelFor(channel, proposal);
  if (!via) return false;
  const ctx = await contextOf(fu, proposal);
  const w = await wordsFor(fu, proposal, ctx, via, trigger ?? "SENT", budget);
  await db.followUp.update({ where: { id }, data: { draftChannel: via, draftBy: w.by, draftSubject: w.subject, draftBody: w.body } });
  return true;
}

type Worked = "sent" | "ready" | "stopped" | "wait" | "keep" | "gone";

/** The hourly run's look at one row. */
async function workOne(id: string, now: Date, budget: { ai: number }): Promise<Worked> {
  const row = await loadRow(id);
  if (!row) return "gone";
  const { fu, proposal } = row;
  // A row with no proposal behind it (hand-made, or the proposal was deleted) has nothing to say: closed.
  if (!proposal) {
    await db.followUp.update({ where: { id }, data: { completedAt: new Date() } });
    return "stopped";
  }
  const facts = await gatherFacts(fu, proposal, now);
  const d = decide(facts);
  if (d.do === "stop") {
    await closeUnsent(fu, d.why);
    return "stopped";
  }
  if (d.do === "keep") return "keep";
  if (d.do === "wait") {
    await db.followUp.update({ where: { id }, data: { runAt: d.until, reason: d.why.slice(0, 200) } });
    return "wait";
  }
  const { channel, trigger } = parseDispatch(fu.templateId);
  const via = await channelFor(channel, proposal);
  if (d.do === "ready") {
    // Nobody to write to and nobody to call: there is nothing for a person to OK.
    if (!via && !proposal.client?.phone) {
      await send(fu, proposal, await contextOf(fu, proposal), null, null);
      return "stopped";
    }
    // Words written for this client cost a model call: past the run's budget the row waits for the next hour.
    if (facts.mode === "ASK" && parseWords(fu.words) === "AI" && budget.ai <= 0) return "keep";
    if (facts.mode === "ASK" && via) {
      const ctx = await contextOf(fu, proposal);
      const w = await wordsFor(fu, proposal, ctx, via, trigger ?? "SENT", budget);
      await db.followUp.update({ where: { id }, data: { state: "READY", readyAt: now, reason: null, draftChannel: via, draftBy: w.by, draftSubject: w.subject, draftBody: w.body } });
    } else {
      await db.followUp.update({ where: { id }, data: { state: "READY", readyAt: now, reason: null } });
    }
    return "ready";
  }
  // send
  if (parseWords(fu.words) === "AI" && budget.ai <= 0) return "keep";
  const ctx = await contextOf(fu, proposal);
  if (!via) {
    await send(fu, proposal, ctx, null, null);
    return "stopped";
  }
  const w = await wordsFor(fu, proposal, ctx, via, trigger ?? "SENT", budget);
  await send({ ...fu, draftChannel: via }, proposal, ctx, w.by === "ai" ? w : null, null);
  return "sent";
}

/**
 * A person said send (the queue's "Send now", the Today tab's Send, the Operator's yes). Only the proposal's status
 * is checked — the client may have accepted, declined or paid since; everything else is the person's call. A draft
 * on the row goes as written; a row with none gets its words now.
 */
export async function dispatchOne(id: string, byUserId: string | null = null): Promise<boolean> {
  const row = await loadRow(id);
  if (!row) return false;
  const { fu, proposal } = row;
  if (!proposal) {
    await db.followUp.update({ where: { id }, data: { completedAt: new Date() } });
    await db.activityEvent.create({ data: { organizationId: fu.organizationId, proposalId: fu.proposalId, actorId: byUserId, kind: "EMAIL", summary: "Follow-up closed — no reachable contact" } });
    return true;
  }
  const { channel, trigger } = parseDispatch(fu.templateId);
  // Checked when it goes, not when it was queued: the client may have
  // accepted, declined or paid since. Closed unsent, so it never fires later.
  if (!stillCurrent(trigger ?? ProposalStatus.SENT, proposal.status)) {
    await closeUnsent(fu, proposal.status);
    return false;
  }
  const ctx = await contextOf(fu, proposal);
  if (fu.draftBody && (fu.draftBy === "ai" || fu.draftBy === "person")) {
    await send(fu, proposal, ctx, { by: fu.draftBy, subject: fu.draftSubject, body: fu.draftBody }, byUserId);
    return true;
  }
  if (fu.draftBody && fu.draftBy === "rules") {
    await send(fu, proposal, ctx, null, byUserId);
    return true;
  }
  const via = await channelFor(channel, proposal);
  if (!via) {
    await send(fu, proposal, ctx, null, byUserId);
    return true;
  }
  const w = await wordsFor(fu, proposal, ctx, via, trigger ?? "SENT", null);
  await send({ ...fu, draftChannel: via }, proposal, ctx, w.by === "ai" ? w : null, byUserId);
  return true;
}
