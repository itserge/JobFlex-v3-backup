import "server-only";
// SHARED BY THE OPERATOR'S ESTIMATORS (2026-11-05): the fence, the roof, HVAC and the lawn by voice each look a
// site up, price it with the company's own book and file a DRAFT — one copy here of what they share: who the
// estimate is for (and their address on file, when none was said), the plan's caps cleared before a build is
// promised, a site remembered for an hour under the person, the draft a change replaces, and the words a build
// lands with — the price as the proposal has it, the facts, the link, and the offer to send it.
import { db } from "@/lib/db";
import type { AssistantActor } from "@/lib/assistant/actor";
import { proposalScope } from "@/lib/assistant/actor";
import { money } from "@/lib/assistant/shared";
import type { Offer } from "@/lib/assistant/tools";
import { checkPlanLimit } from "@/lib/limitsEngine";
import type { LimitKey } from "@/lib/planLimits";
import { appBaseUrl } from "@/lib/appUrl";

export type Who = { name: string | null; email: string | null; address: string | null };

const place = (...parts: Array<string | null | undefined>) => {
  const p = parts.map((s) => (s ?? "").trim()).filter(Boolean);
  return p.length ? p.join(", ") : null;
};

/** The client or lead the estimate is for — one of this company's, with their address on file — else a sentence. */
export async function whoFor(actor: AssistantActor, clientId: string | null, leadId: string | null): Promise<{ ok: true; who: Who } | { ok: false; say: string }> {
  const org = actor.organizationId;
  if (clientId) {
    const c = await db.client.findFirst({ where: { id: clientId, organizationId: org, deletedAt: null }, select: { name: true, email: true, address: true, city: true, state: true, zip: true } });
    if (!c) return { ok: false, say: "I couldn't find that client." };
    return { ok: true, who: { name: c.name, email: c.email, address: place(c.address, c.city, [c.state, c.zip].filter(Boolean).join(" ")) } };
  }
  if (leadId) {
    const l = await db.lead.findFirst({ where: { id: leadId, organizationId: org }, select: { name: true, email: true, address: true, city: true, state: true, zip: true } });
    if (!l) return { ok: false, say: "I couldn't find that lead." };
    return { ok: true, who: { name: l.name, email: l.email, address: place(l.address, l.city, [l.state, l.zip].filter(Boolean).join(" ")) } };
  }
  return { ok: true, who: { name: null, email: null, address: null } };
}

const METER_WORDS: Partial<Record<LimitKey, string>> = { estimatorUses: "estimator", hvacEstimates: "HVAC estimate", roofMeasurements: "roof measurement" };

/** The plan's caps a build must clear before it is promised: proposals, then the meters the trade spends. */
export async function buildCaps(actor: AssistantActor, meters: LimitKey[]): Promise<string | null> {
  const quota = await checkPlanLimit(actor.organizationId, "proposalsCreated", 1, { actorId: actor.userId });
  if (!quota.allowed) return "Your plan's proposal limit is reached. A bigger plan raises it (Settings → Billing).";
  for (const key of meters) {
    const q = await checkPlanLimit(actor.organizationId, key, 1, { actorId: actor.userId });
    if (!q.allowed) return `Your plan's ${METER_WORDS[key] ?? key} limit is reached for this cycle (Settings → Billing).`;
  }
  return null;
}

/** The draft a change replaces: one this person may see; a sentence when it isn't there. */
export async function replaceable(actor: AssistantActor, proposalId: string, what: string): Promise<string | null> {
  const old = await db.proposal.findFirst({ where: { id: proposalId, organizationId: actor.organizationId, ...proposalScope(actor) }, select: { id: true } });
  return old ? null : `I couldn't find the ${what} estimate to change.`;
}

/** The draft a change replaces goes to the archive — only one the Operator made, and only while it is a draft. */
export async function archiveReplaced(actor: AssistantActor, proposalId: string): Promise<boolean> {
  const mine = await db.assistantAction.findFirst({ where: { organizationId: actor.organizationId, userId: actor.userId, status: "DONE", resultJson: { contains: proposalId } }, select: { id: true } });
  if (!mine) return false;
  const r = await db.proposal.updateMany({ where: { id: proposalId, organizationId: actor.organizationId, status: "DRAFT", sentAt: null }, data: { status: "ARCHIVED" } }).catch(() => ({ count: 0 }));
  return r.count === 1;
}

/** The build a change replaces, as it was asked (its stored payload), so what isn't said again is kept. */
export async function priorBuild<T extends object>(actor: AssistantActor, proposalId: string, tool: string): Promise<T | null> {
  const rows = await db.assistantAction.findMany({
    where: { organizationId: actor.organizationId, userId: actor.userId, tool, status: "DONE", resultJson: { contains: proposalId } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { argsJson: true, resultJson: true },
  });
  for (const r of rows) {
    try {
      if ((JSON.parse(r.resultJson ?? "{}") as { result?: { proposalId?: unknown } }).result?.proposalId === proposalId) return JSON.parse(r.argsJson) as T;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** A change over the earlier build: a field said again wins; null (not said) keeps what was built. */
export function overPrior<T extends object>(prior: T | null, said: T): T {
  if (!prior) return said;
  const out: Record<string, unknown> = { ...(prior as Record<string, unknown>) };
  for (const [k, v] of Object.entries(said)) if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  return out as T;
}

// ── a site remembered for an hour, under the person ───────────────────────────

const SITE_TTL_MS = 60 * 60_000;
const siteKey = (actor: AssistantActor, kind: string) => `assistant:${kind}site:${actor.organizationId}:${actor.userId}`;

export async function rememberSite<T>(actor: AssistantActor, kind: "fence" | "lawn", site: T): Promise<void> {
  const key = siteKey(actor, kind);
  const cursor = JSON.stringify({ at: Date.now(), site });
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } }).catch(() => null);
}

export async function rememberedSite<T>(actor: AssistantActor, kind: "fence" | "lawn"): Promise<T | null> {
  const row = await db.syncState.findUnique({ where: { key: siteKey(actor, kind) }, select: { cursor: true } }).catch(() => null);
  if (!row?.cursor) return null;
  try {
    const v = JSON.parse(row.cursor) as { at?: number; site?: T };
    return v.site && typeof v.at === "number" && Date.now() - v.at < SITE_TTL_MS ? v.site : null;
  } catch {
    return null;
  }
}

// ── what a build lands with ────────────────────────────────────────────────────

/** The price as the proposal has it, the facts, the link — and the offer to send it when the client has an email,
 *  else the ask for one. */
export async function landed(actor: AssistantActor, proposalId: string, opts: { facts: string; archived?: boolean; notes?: string[] }): Promise<{ say: string; result: { proposalId: string }; offer?: Offer }> {
  const p = await db.proposal.findFirst({
    where: { id: proposalId, organizationId: actor.organizationId },
    select: { title: true, subtotal: true, taxTotal: true, discountTotal: true, total: true, currency: true, client: { select: { name: true, email: true, deletedAt: true } } },
  });
  if (!p) throw new Error("Not found");
  const client = p.client && !p.client.deletedAt ? p.client : null;
  const tax = p.taxTotal > 0.005 ? ` (${money(p.subtotal - (p.discountTotal ?? 0), p.currency)} + ${money(p.taxTotal, p.currency)} tax)` : "";
  const head = `Built "${p.title}"${client ? ` for ${client.name}` : ""}: ${money(p.total, p.currency)}${tax}.`;
  const notes = opts.notes?.length ? ` ${opts.notes.join(" ")}` : "";
  const say = `${head} ${opts.facts}.${notes}${opts.archived ? " The earlier draft is archived." : ""} Open it: ${await appBaseUrl()}/dashboard/proposals/${proposalId}`;
  if (client?.email) return { say, result: { proposalId }, offer: { tool: "send_proposal", args: { proposalId, email: null, clientName: null } } };
  const first = client?.name?.split(/\s+/)[0];
  return { say: `${say} ${first ? `Tell me ${first}'s email and I'll send it.` : "Who's it for? Tell me their name and email and I'll send it."}`, result: { proposalId } };
}
