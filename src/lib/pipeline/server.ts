import "server-only";
// THE PIPELINE — THE READS AND THE MOVES (Smart CRM part 3, 2026-11-08). The board is built on every read from
// what already exists, so it can never drift from the records:
//   · a proposal is a card (its stage from its status);
//   · a lead is a card until its person has a proposal made after it — then the lead's source rides on that
//     proposal's card instead (matched by email or phone digits, the way the client timeline matches);
//   · DealState holds only what a person set by hand, and a real event after the hand wins (lib/pipeline/shared).
// Risk and the next step read the client's inbox thread, promises, visits, the proposal's opens, the job and the
// money. The source report counts each lead source from first contact to money collected; cost per job only where
// the company entered what it spends on that source (no ad data is guessed — the owner's spec §9).

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { leadSourceOf } from "@/lib/leads/sources";
import { digits10 } from "@/lib/clientTimeline/shared";
import { isSalesRole } from "@/lib/orgContext";
import { ownProposalsOnly } from "@/lib/assistant/roles";
import { salesCanTouchLead } from "@/lib/leads/salesAccess";
import { buildWord, effectiveStage, isStage, leadStage, nextStepOf, OPEN_STAGES, paidWord, PRICE_WORRY, proposalStage, riskOf, type RiskLevel, type Stage } from "./shared";

const DAY = 86_400_000;
const CLOSED_SHOWN_DAYS = 60;

export interface DealCard {
  key: string;
  kind: "lead" | "proposal";
  id: string;
  name: string;
  title: string;
  value: number | null;
  stage: Stage;
  byHand: boolean;
  source: { key: string; label: string; short: string; tone: string };
  ownerId: string | null;
  ownerName: string | null;
  clientId: string | null;
  href: string;
  lastTouch: Date | null;
  createdAt: Date;
  risk: { level: RiskLevel; reasons: string[] };
  next: string | null;
  expectedClose: Date | null;
  lostReason: string | null;
  build: string | null;
  paid: string | null;
  closedAt: Date | null;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const latest = (...ds: Array<Date | null | undefined>) => ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** `onlyProposalsOf`: a sales rep or estimator sees only their own proposals (requireProposalStaff's rule); leads stay
 *  company-wide, as on the leads page. A lead that became a colleague's proposal leaves the rep's board with it. */
export async function readPipeline(organizationId: string, opts: { now?: Date; tz?: string; onlyProposalsOf?: string | null } = {}): Promise<DealCard[]> {
  const now = opts.now ?? new Date();
  const tz = opts.tz ?? "America/New_York";
  const since = new Date(now.getTime() - 180 * DAY);
  const dayWords = (d: Date) => {
    try {
      return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
    } catch {
      return d.toISOString().slice(0, 16).replace("T", " ");
    }
  };

  const [leads, proposals, hands, members] = await Promise.all([
    db.lead.findMany({
      where: { organizationId, status: { not: "ARCHIVED" }, OR: [{ status: { notIn: ["WON", "LOST"] } }, { updatedAt: { gte: since } }] },
      select: { id: true, name: true, email: true, phone: true, source: true, projectType: true, status: true, contactedAt: true, assignedToId: true, claimedById: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.proposal.findMany({
      where: { organizationId, status: { notIn: ["ARCHIVED"] }, OR: [{ status: { in: ["DRAFT", "SENT", "VIEWED"] } }, { updatedAt: { gte: since } }] },
      select: { id: true, title: true, status: true, total: true, ownerId: true, clientId: true, sentAt: true, viewedAt: true, viewCount: true, acceptedAt: true, declinedAt: true, createdAt: true, updatedAt: true, client: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.dealState.findMany({ where: { organizationId } }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, user: { select: { name: true, email: true } } } }),
  ]);
  const handOf = new Map(hands.map((h) => [h.key, h]));
  const memberName = new Map(members.map((m) => [m.userId, m.user?.name ?? m.user?.email ?? null]));

  // Which client each lead became: by email, else phone digits, among the clients that have proposals.
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const p of proposals) {
    if (!p.client) continue;
    if (p.client.email) byEmail.set(p.client.email.trim().toLowerCase(), p.client.id);
    const d = digits10(p.client.phone);
    if (d.length >= 7) byPhone.set(d, p.client.id);
  }
  const clientOfLead = (l: { email: string | null; phone: string | null }) => {
    const e = l.email?.trim().toLowerCase();
    if (e && byEmail.has(e)) return byEmail.get(e)!;
    const d = digits10(l.phone);
    return d.length >= 7 ? (byPhone.get(d) ?? null) : null;
  };
  const proposalsByClient = new Map<string, typeof proposals>();
  for (const p of proposals) if (p.clientId) proposalsByClient.set(p.clientId, [...(proposalsByClient.get(p.clientId) ?? []), p]);

  // A lead whose person has a proposal made after it is that proposal's origin; the earliest such lead wins.
  const leadOfProposal = new Map<string, (typeof leads)[number]>();
  const absorbed = new Set<string>();
  for (const l of [...leads].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const cid = clientOfLead(l);
    if (!cid) continue;
    const later = (proposalsByClient.get(cid) ?? []).filter((p) => p.createdAt.getTime() >= l.createdAt.getTime() - 2 * DAY);
    if (!later.length) continue;
    absorbed.add(l.id);
    for (const p of later) if (!leadOfProposal.has(p.id)) leadOfProposal.set(p.id, l);
  }

  // What the risk and the next step read.
  const clientIds = [...new Set(proposals.map((p) => p.clientId).filter((x): x is string => !!x))];
  const leadIds = leads.map((l) => l.id);
  const proposalIds = proposals.map((p) => p.id);
  const [threads, promises, visits, jobs, paid] = await Promise.all([
    clientIds.length ? db.clientThread.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: { clientId: true, status: true, urgent: true, lastAt: true, aiReadJson: true } }) : Promise.resolve([]),
    clientIds.length ? db.clientPromise.findMany({ where: { organizationId, clientId: { in: clientIds }, status: "OPEN", direction: "OURS", dueAt: { lt: now } }, select: { clientId: true, text: true }, orderBy: { dueAt: "asc" } }) : Promise.resolve([]),
    db.appointment.findMany({
      where: { organizationId, startsAt: { gte: since }, OR: [{ leadId: { in: leadIds } }, ...(clientIds.length ? [{ clientId: { in: clientIds } }] : [])] },
      select: { leadId: true, clientId: true, startsAt: true, endsAt: true, status: true },
      orderBy: { startsAt: "asc" },
    }),
    proposalIds.length ? db.job.findMany({ where: { organizationId, proposalId: { in: proposalIds } }, select: { proposalId: true, status: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    proposalIds.length ? db.payment.groupBy({ by: ["proposalId"], where: { organizationId, proposalId: { in: proposalIds }, status: "PAID" }, _sum: { amount: true } }) : Promise.resolve([]),
  ]);
  const threadOf = new Map(threads.map((t) => [t.clientId!, t]));
  const promiseOf = new Map<string, { count: number; first: string }>();
  for (const p of promises) {
    const have = promiseOf.get(p.clientId);
    promiseOf.set(p.clientId, { count: (have?.count ?? 0) + 1, first: have?.first ?? p.text });
  }
  const jobOf = new Map<string, string>();
  for (const j of jobs) if (j.proposalId && !jobOf.has(j.proposalId)) jobOf.set(j.proposalId, j.status);
  const paidOf = new Map(paid.map((p) => [p.proposalId!, p._sum.amount ?? 0]));
  const visitFacts = (match: (v: (typeof visits)[number]) => boolean) => {
    const mine = visits.filter(match);
    const live = mine.filter((v) => v.status !== "CANCELED" && v.status !== "NO_SHOW");
    const done = [...live].reverse().find((v) => v.endsAt.getTime() <= now.getTime() || v.status === "COMPLETED") ?? null;
    const upcoming = live.find((v) => v.startsAt.getTime() > now.getTime()) ?? null;
    return { done: done ? done.endsAt : null, upcoming: upcoming ? upcoming.startsAt : null, lastAt: latest(...live.filter((v) => v.startsAt <= now).map((v) => v.startsAt)), moved: mine.length - live.length };
  };
  const threadFacts = (clientId: string | null) => {
    const t = clientId ? threadOf.get(clientId) : undefined;
    let priceWorry = false;
    if (t?.aiReadJson) {
      try {
        const r = JSON.parse(t.aiReadJson) as { money?: string[]; complaints?: string[] };
        priceWorry = [...(r.money ?? []), ...(r.complaints ?? [])].some((x) => PRICE_WORRY.test(x));
      } catch {
        /* an unreadable reading reads as nothing */
      }
    }
    return { awaitingSince: t?.status === "NEEDS_REPLY" ? t.lastAt : null, urgent: !!t?.urgent && t.status !== "CLOSED", lastAt: t?.lastAt ?? null, priceWorry };
  };

  const cards: DealCard[] = [];

  // ── proposals ──
  for (const p of proposals) {
    if (opts.onlyProposalsOf && p.ownerId !== opts.onlyProposalsOf) continue;
    const key = `proposal:${p.id}`;
    const hand = handOf.get(key) ?? null;
    const autoStage = proposalStage(p.status);
    const autoAt = p.acceptedAt ?? p.declinedAt ?? p.viewedAt ?? p.sentAt ?? p.createdAt;
    const { stage, byHand } = effectiveStage({ stage: autoStage, at: autoAt }, hand ? { stage: hand.stage, at: hand.stageAt } : null);
    const lead = leadOfProposal.get(p.id) ?? null;
    const name = p.client?.name ?? lead?.name ?? "No client";
    const vf = visitFacts((v) => (!!p.clientId && v.clientId === p.clientId) || (!!lead && v.leadId === lead.id));
    const tf = threadFacts(p.clientId);
    const pr = p.clientId ? promiseOf.get(p.clientId) : undefined;
    const closedAt = stage === "WON" ? (p.acceptedAt ?? hand?.stageAt ?? p.updatedAt) : stage === "LOST" ? (p.declinedAt ?? hand?.stageAt ?? p.updatedAt) : null;
    if (closedAt && now.getTime() - closedAt.getTime() > CLOSED_SHOWN_DAYS * DAY) continue;
    const share = p.total > 0 ? (paidOf.get(p.id) ?? 0) / p.total : null;
    const lastTouch = latest(p.sentAt, p.viewedAt, tf.lastAt, vf.lastAt, lead?.contactedAt);
    const src = leadSourceOf(lead?.source ?? null);
    cards.push({
      key,
      kind: "proposal",
      id: p.id,
      name,
      title: p.title,
      value: p.total || null,
      stage,
      byHand,
      source: { key: lead ? src.key : "direct", label: lead ? src.label : "Direct / repeat", short: lead ? src.short : "Direct", tone: lead ? src.tone : "#555555" },
      ownerId: hand?.ownerId ?? p.ownerId,
      ownerName: memberName.get(hand?.ownerId ?? p.ownerId ?? "") ?? null,
      clientId: p.clientId,
      href: p.clientId ? `/dashboard/client-detail?client=${p.clientId}` : `/dashboard/proposals/${p.id}`,
      lastTouch,
      createdAt: lead?.createdAt ?? p.createdAt,
      risk: riskOf({ stage, now, lastTouch, awaitingUsSince: tf.awaitingSince, urgent: tf.urgent, overduePromises: pr?.count ?? 0, visitDoneAt: vf.done, estimateSentAt: p.sentAt, reschedules: vf.moved, priceWorry: tf.priceWorry, expectedClose: hand?.expectedClose ?? null }),
      next: nextStepOf({ stage, now, first: first(name), createdAt: p.createdAt, contacted: true, awaitingUs: !!tf.awaitingSince, overduePromise: pr?.first ?? null, upcomingVisit: vf.upcoming, visitDoneAt: vf.done, draft: p.status === "DRAFT", sentAt: p.sentAt, viewCount: p.viewCount, viewedAt: p.viewedAt, paidShare: share, buildStatus: jobOf.get(p.id) ?? null, dayWords }),
      expectedClose: hand?.expectedClose ?? null,
      lostReason: hand?.lostReason ?? null,
      build: stage === "WON" ? buildWord(jobOf.get(p.id) ?? null) : null,
      paid: stage === "WON" ? paidWord(share) : null,
      closedAt,
    });
  }

  // ── leads not yet quoted ──
  for (const l of leads) {
    if (absorbed.has(l.id)) continue;
    const key = `lead:${l.id}`;
    const hand = handOf.get(key) ?? null;
    const vf = visitFacts((v) => v.leadId === l.id);
    const autoStage = leadStage({ status: l.status, contactedAt: l.contactedAt }, vf.upcoming ? { at: vf.upcoming, done: false } : vf.done ? { at: vf.done, done: true } : null);
    const autoAt = latest(l.contactedAt, vf.lastAt, ["WON", "LOST"].includes(l.status) ? l.updatedAt : null) ?? l.createdAt;
    const { stage, byHand } = effectiveStage({ stage: autoStage, at: autoAt }, hand ? { stage: hand.stage, at: hand.stageAt } : null);
    const closedAt = stage === "WON" || stage === "LOST" ? (hand?.stageAt ?? l.updatedAt) : null;
    if (closedAt && now.getTime() - closedAt.getTime() > CLOSED_SHOWN_DAYS * DAY) continue;
    const src = leadSourceOf(l.source);
    const lastTouch = latest(l.contactedAt, vf.lastAt);
    const ownerId = hand?.ownerId ?? l.assignedToId ?? l.claimedById;
    cards.push({
      key,
      kind: "lead",
      id: l.id,
      name: l.name,
      title: l.projectType ?? "New request",
      value: null,
      stage,
      byHand,
      source: { key: src.key, label: src.label, short: src.short, tone: src.tone },
      ownerId,
      ownerName: memberName.get(ownerId ?? "") ?? null,
      clientId: null,
      href: `/dashboard/leads/${l.id}`,
      lastTouch,
      createdAt: l.createdAt,
      risk: riskOf({ stage, now, lastTouch: lastTouch ?? l.createdAt, awaitingUsSince: !l.contactedAt && OPEN_STAGES.includes(stage) && stage === "NEW" ? l.createdAt : null, urgent: false, overduePromises: 0, visitDoneAt: vf.done, estimateSentAt: null, reschedules: vf.moved, priceWorry: false, expectedClose: hand?.expectedClose ?? null }),
      next: nextStepOf({ stage, now, first: first(l.name), createdAt: l.createdAt, contacted: !!l.contactedAt, awaitingUs: false, overduePromise: null, upcomingVisit: vf.upcoming, visitDoneAt: vf.done, draft: false, sentAt: null, viewCount: 0, viewedAt: null, paidShare: null, buildStatus: null, dayWords }),
      expectedClose: hand?.expectedClose ?? null,
      lostReason: hand?.lostReason ?? null,
      build: null,
      paid: null,
      closedAt,
    });
  }

  const order: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return cards.sort((a, b) => order[a.risk.level] - order[b.risk.level] || (b.lastTouch?.getTime() ?? b.createdAt.getTime()) - (a.lastTouch?.getTime() ?? a.createdAt.getTime()));
}

/** Why this person may not work this card — null when they may. Office roles: any card. A sales rep or estimator:
 *  their own proposals only; a sales rep: leads that are theirs or still unclaimed (salesCanTouchLead). */
export async function cardRefusal(organizationId: string, key: string, who: { userId: string; role: string }): Promise<string | null> {
  const [kind, id] = key.split(":");
  if (kind === "proposal") {
    const p = await db.proposal.findFirst({ where: { id, organizationId }, select: { ownerId: true } });
    if (!p) return "That proposal isn't on the board.";
    return ownProposalsOnly(who.role) && p.ownerId !== who.userId ? "That's a colleague's proposal — only its owner or a manager can move it." : null;
  }
  if (kind === "lead") {
    const l = await db.lead.findFirst({ where: { id, organizationId }, select: { assignedToId: true, claimedById: true, status: true } });
    if (!l) return "That lead isn't on the board.";
    return isSalesRole(who.role) && !salesCanTouchLead(l, who.userId) ? "That lead is another rep's — only they or a manager can move it." : null;
  }
  return "Not a card.";
}

/** A person moved a card. A lead's own status follows where it has one (Contacted, Won, Lost), so the leads
 *  board agrees; a proposal is never accepted or declined by a drag — only the card moves. */
export async function moveDeal(organizationId: string, key: string, stage: Stage, userId: string | null, lostReason?: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isStage(stage)) return { ok: false, error: "No such stage." };
  const [kind, id] = key.split(":");
  if (kind === "lead") {
    const lead = await db.lead.findFirst({ where: { id, organizationId }, select: { id: true, name: true, contactedAt: true } });
    if (!lead) return { ok: false, error: "That lead isn't on the board." };
    const status = stage === "CONTACTED" ? "CONTACTED" : stage === "WON" ? "WON" : stage === "LOST" ? "LOST" : stage === "NEW" ? "NEW" : null;
    if (status) await db.lead.update({ where: { id: lead.id }, data: { status, ...(status === "CONTACTED" && !lead.contactedAt ? { contactedAt: new Date() } : {}) } });
  } else if (kind === "proposal") {
    const p = await db.proposal.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!p) return { ok: false, error: "That proposal isn't on the board." };
  } else return { ok: false, error: "Not a card." };
  const now = new Date();
  await db.dealState.upsert({
    where: { key },
    create: { key, organizationId, stage, stageAt: now, movedById: userId, lostReason: stage === "LOST" ? (lostReason?.trim().slice(0, 200) || null) : null },
    update: { stage, stageAt: now, movedById: userId, lostReason: stage === "LOST" ? (lostReason?.trim().slice(0, 200) || null) : null },
  });
  await logActivity({
    organizationId,
    actorId: userId,
    kind: TRAIL_KINDS.CLIENT,
    ...(kind === "lead" ? { leadId: id } : {}),
    summary: `Moved to ${stage.charAt(0) + stage.slice(1).toLowerCase()} on the pipeline${stage === "LOST" && lostReason ? ` — ${lostReason.trim().slice(0, 120)}` : ""}`,
    meta: { key, stage },
  });
  return { ok: true };
}

export async function setDealDetails(organizationId: string, key: string, d: { ownerId?: string | null; expectedClose?: Date | null }): Promise<void> {
  await db.dealState.upsert({
    where: { key },
    create: { key, organizationId, ...(d.ownerId !== undefined ? { ownerId: d.ownerId } : {}), ...(d.expectedClose !== undefined ? { expectedClose: d.expectedClose } : {}) },
    update: { ...(d.ownerId !== undefined ? { ownerId: d.ownerId } : {}), ...(d.expectedClose !== undefined ? { expectedClose: d.expectedClose } : {}) },
  });
}

// ── the source report ────────────────────────────────────────────────────────

const SPEND_KEY = (orgId: string) => `crm:spend:${orgId}`;

/** What the company says it spends a month on each source (typed in on the report; never guessed). */
export async function readSpend(organizationId: string): Promise<Record<string, number>> {
  const row = await db.syncState.findUnique({ where: { key: SPEND_KEY(organizationId) }, select: { cursor: true } });
  try {
    const raw = JSON.parse(row?.cursor ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number" && v >= 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function setSpend(organizationId: string, sourceKey: string, monthly: number | null): Promise<void> {
  const all = await readSpend(organizationId);
  if (monthly === null || !Number.isFinite(monthly) || monthly <= 0) delete all[sourceKey];
  else all[sourceKey] = Math.round(monthly * 100) / 100;
  const cursor = JSON.stringify(all);
  await db.syncState.upsert({ where: { key: SPEND_KEY(organizationId) }, create: { key: SPEND_KEY(organizationId), cursor }, update: { cursor } });
}

export interface SourceRow {
  key: string;
  label: string;
  tone: string;
  leads: number;
  contacted: number;
  visits: number;
  estimates: number;
  won: number;
  wonValue: number;
  collected: number;
  medianReplyMin: number | null;
  monthlySpend: number | null;
  costPerLead: number | null;
  costPerJob: number | null;
}

/** Each source over the period: leads → contacted → visits → estimates sent → won → collected. `now` is the period's
 *  end — the company pulse asks for a week that is over (2026-11-10), so nothing after it is counted. */
export async function readSourceReport(organizationId: string, days: number, now = new Date()): Promise<SourceRow[]> {
  const since = new Date(now.getTime() - days * DAY);
  const [leads, spend] = await Promise.all([
    db.lead.findMany({ where: { organizationId, createdAt: { gte: since, lte: now } }, select: { id: true, email: true, phone: true, source: true, status: true, contactedAt: true, createdAt: true } }),
    readSpend(organizationId),
  ]);
  const ids = leads.map((l) => l.id);
  const emails = [...new Set(leads.map((l) => l.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
  const [visits, clients] = await Promise.all([
    ids.length ? db.appointment.findMany({ where: { organizationId, leadId: { in: ids }, status: { not: "CANCELED" } }, select: { leadId: true } }) : Promise.resolve([]),
    db.client.findMany({ where: { organizationId, deletedAt: null, OR: [...(emails.length ? [{ email: { in: emails } }] : []), { phone: { not: null } }] }, select: { id: true, email: true, phone: true }, take: 3000 }),
  ]);
  const visited = new Set(visits.map((v) => v.leadId));
  const clientEmail = new Map(clients.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c.id]));
  const clientPhone = new Map(clients.filter((c) => digits10(c.phone).length >= 7).map((c) => [digits10(c.phone), c.id]));
  const clientOf = (l: { email: string | null; phone: string | null }) => clientEmail.get(l.email?.trim().toLowerCase() ?? "") ?? clientPhone.get(digits10(l.phone)) ?? null;
  const leadClient = new Map(leads.map((l) => [l.id, clientOf(l)]));
  const cids = [...new Set([...leadClient.values()].filter((x): x is string => !!x))];
  const proposals = cids.length ? await db.proposal.findMany({ where: { organizationId, clientId: { in: cids }, createdAt: { gte: since, lte: now } }, select: { id: true, clientId: true, status: true, total: true, sentAt: true } }) : [];
  const paid = proposals.length ? await db.payment.groupBy({ by: ["proposalId"], where: { organizationId, proposalId: { in: proposals.map((p) => p.id) }, status: "PAID" }, _sum: { amount: true } }) : [];
  const paidOf = new Map(paid.map((p) => [p.proposalId!, p._sum.amount ?? 0]));
  const byClient = new Map<string, typeof proposals>();
  for (const p of proposals) if (p.clientId) byClient.set(p.clientId, [...(byClient.get(p.clientId) ?? []), p]);

  const rows = new Map<string, SourceRow & { replies: number[] }>();
  // Each proposal is credited once, to the person's earliest lead in the period (the board's rule) — a repeat
  // lead from the same person never doubles the won value.
  const credited = new Set<string>();
  for (const l of [...leads].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const src = leadSourceOf(l.source);
    const r = rows.get(src.key) ?? { key: src.key, label: src.label, tone: src.tone, leads: 0, contacted: 0, visits: 0, estimates: 0, won: 0, wonValue: 0, collected: 0, medianReplyMin: null, monthlySpend: spend[src.key] ?? null, costPerLead: null, costPerJob: null, replies: [] };
    r.leads++;
    if (l.contactedAt || !["NEW", "ROUTED"].includes(l.status)) r.contacted++;
    if (l.contactedAt) r.replies.push(Math.max(0, (l.contactedAt.getTime() - l.createdAt.getTime()) / 60_000));
    if (visited.has(l.id)) r.visits++;
    const props = (byClient.get(leadClient.get(l.id) ?? "") ?? []).filter((p) => p.sentAt && !credited.has(p.id));
    for (const p of props) credited.add(p.id);
    if (props.length) r.estimates++;
    const wins = props.filter((p) => ["ACCEPTED", "COMPLETED", "PAID"].includes(p.status));
    if (wins.length || l.status === "WON") r.won++;
    r.wonValue += wins.reduce((a, p) => a + p.total, 0);
    r.collected += wins.reduce((a, p) => a + (paidOf.get(p.id) ?? 0), 0);
    rows.set(src.key, r);
  }
  return [...rows.values()]
    .map(({ replies, ...r }) => {
      const sorted = [...replies].sort((a, b) => a - b);
      const median = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null;
      const periodSpend = r.monthlySpend !== null ? (r.monthlySpend * days) / 30 : null;
      return {
        ...r,
        medianReplyMin: median,
        costPerLead: periodSpend !== null && r.leads ? Math.round(periodSpend / r.leads) : null,
        costPerJob: periodSpend !== null && r.won ? Math.round(periodSpend / r.won) : null,
      };
    })
    .sort((a, b) => b.collected - a.collected || b.won - a.won || b.leads - a.leads);
}
