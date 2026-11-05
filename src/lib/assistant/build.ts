import "server-only";
// BUILD A JOB BY VOICE OR BY TEXT (slice 3, 2026-11-05). Owner: "build the deck 12×12 with roof … and send to
// client … for any estimator contractor can do it by speech to phone". Each builder is the dashboard's own:
//   · build_deck / change_deck — the Deck Studio: the words become the studio's own voice commands
//     (lib/deck/voice hear()), the deck is settled to the code tables and priced in the shop's rate book, and it is
//     filed with its 3D as the studio files it (lib/deck/proposalWrite);
//   · build_estimate / change_estimate — Smart Proposal for every other job (roof, fence, HVAC, siding, a kitchen…):
//     the run the Smart Proposal page makes (lib/estimate/smartRun), in the company's own method and price book,
//     filed by its convert (lib/estimate/convertCore).
// A build makes a DRAFT — nothing reaches the client — so it runs without a YES (lib/assistant/tools `instant`).
// The reply is built here from the saved proposal — the price, what is in it, the link — and SENDING it is offered
// as an ordinary read-back (send_proposal), so one YES sends it. "Change it" builds the changed job as a new draft;
// the draft it replaces is archived when the Assistant made it and it was never sent.
import { z } from "zod";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { isPageLocked } from "@/lib/customPageAccess";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { noteRequestOrg, takeTrialCap } from "@/lib/trialMeter";
import { filingFromIds, type FilingContext } from "@/lib/filingContext";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { deckStudioAccess } from "@/lib/deck/access";
import { deckAddonShortWords } from "@/lib/deckAddon";
import { defaultDeckDesign, normalizeDeckDesign, structureWords, type DeckDesign } from "@/lib/deck/design";
import { applyDeckPatch } from "@/lib/deck/checks";
import { settleDesign } from "@/lib/deck/settle";
import { deckNotes, deckScope, priceDeck } from "@/lib/deck/pricing";
import { deckScene } from "@/lib/deck/scene";
import { siteFromAddress } from "@/lib/deck/site";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import { resolveMarket } from "@/lib/fence/market";
import { freshVoiceState, hear, type VoiceState } from "@/lib/deck/voice/assistant";
import { DECK_PLAN_EVENT, deckConvertSchema } from "@/lib/deck/convertSchema";
import { ownDeckPhoto, writeDeckProposal } from "@/lib/deck/proposalWrite";
import { runSmartEstimate } from "@/lib/estimate/smartRun";
import { convertEstimateAs, convertInput, saveEstimateAs } from "@/lib/estimate/convertCore";
import { proposalScope, type AssistantActor } from "@/lib/assistant/actor";
import { dayWords, money } from "@/lib/assistant/shared";
import type { Offer, WriteTool } from "@/lib/assistant/tools";

const ID = z.string().min(1).max(64);

/** The tools that file a proposal of their own — the prompt's "lately" list and "change it" read them. */
export const BUILD_TOOLS = ["build_deck", "change_deck", "build_estimate", "change_estimate"] as const;

// ── shared ───────────────────────────────────────────────────────────────────

/** The proposal in the office, as the contractor opens it from a text. */
async function officeLink(proposalId: string): Promise<string> {
  return `${(await appBaseUrl()).replace(/\/$/, "")}/dashboard/proposals/${proposalId}`;
}

const place = (...parts: Array<string | null | undefined>) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(", ") || null;

interface Who {
  name: string | null;
  address: string | null;
}

/** The client or the lead the job is for — theirs, in this company — or a plain refusal. */
async function whoFor(actor: AssistantActor, clientId: string | null, leadId: string | null): Promise<{ ok: true; who: Who } | { ok: false; say: string }> {
  const org = actor.organizationId;
  if (clientId) {
    const c = await db.client.findFirst({ where: { id: clientId, organizationId: org, deletedAt: null }, select: { name: true, address: true, city: true } });
    if (!c) return { ok: false, say: "I couldn't find that client." };
    return { ok: true, who: { name: c.name, address: place(c.address, c.city) } };
  }
  if (leadId) {
    const l = await db.lead.findFirst({ where: { id: leadId, organizationId: org }, select: { name: true, address: true, city: true, state: true, zip: true } });
    if (!l) return { ok: false, say: "I couldn't find that lead." };
    return { ok: true, who: { name: l.name, address: place(l.address, l.city, [l.state, l.zip].filter(Boolean).join(" ")) } };
  }
  return { ok: true, who: { name: null, address: null } };
}

async function proposalCap(actor: AssistantActor): Promise<string | null> {
  const cap = await checkPlanLimit(actor.organizationId, "proposalsCreated", 1, { actorId: actor.userId });
  return cap.allowed ? null : "Your plan's proposals for this month are used up. A bigger plan raises the number (Settings → Billing).";
}

/** The saved draft, said back: the price as filed, then how to send it. */
async function builtWords(actor: AssistantActor, proposalId: string, opts: { facts: string | null; notes: string[]; was?: number | null; archived?: boolean }): Promise<{ say: string; offer?: Offer }> {
  const p = await db.proposal.findFirst({
    where: { id: proposalId, organizationId: actor.organizationId },
    select: { id: true, title: true, subtotal: true, taxTotal: true, discountTotal: true, total: true, currency: true, client: { select: { name: true, email: true, deletedAt: true } } },
  });
  if (!p) throw new Error("Not found");
  const client = p.client && !p.client.deletedAt ? p.client : null;
  const tax = p.taxTotal > 0.005 ? ` (${money(p.subtotal - (p.discountTotal ?? 0), p.currency)} + ${money(p.taxTotal, p.currency)} tax)` : "";
  const was = opts.was != null ? ` — was ${money(opts.was, p.currency)}` : "";
  const head = `${opts.was != null ? "Changed" : "Built"} "${p.title}"${client ? ` for ${client.name}` : ""}: ${money(p.total, p.currency)}${tax}${was}.`;
  const facts = opts.facts ? ` ${opts.facts}.` : "";
  const notes = opts.notes.length ? ` ${opts.notes.join(" ")}` : "";
  const archived = opts.archived ? " The earlier draft is archived." : "";
  const link = ` Open it: ${await officeLink(p.id)}`;
  const say = `${head}${facts}${notes}${archived}${link}`;
  if (client?.email) return { say, offer: { tool: "send_proposal", args: { proposalId: p.id, email: null, clientName: null } } };
  const first = client?.name.split(/\s+/)[0];
  return { say: `${say} ${first ? `Tell me ${first}'s email and I'll send it.` : "Who's it for? Tell me their name and email and I'll send it."}` };
}

/** The draft a change replaces goes to the archive — only one the Assistant made, and only while it is a draft. */
async function archiveReplaced(actor: AssistantActor, proposalId: string): Promise<boolean> {
  const mine = await builtByAssistant(actor, proposalId);
  if (!mine) return false;
  const r = await db.proposal.updateMany({ where: { id: proposalId, organizationId: actor.organizationId, status: "DRAFT", sentAt: null }, data: { status: "ARCHIVED" } });
  return r.count === 1;
}

/** The build that made this proposal, when the Assistant made it (its stored payload), else null. */
async function builtByAssistant(actor: AssistantActor, proposalId: string): Promise<{ tool: string; argsJson: string } | null> {
  const rows = await db.assistantAction.findMany({
    where: { organizationId: actor.organizationId, tool: { in: [...BUILD_TOOLS] }, status: "DONE", resultJson: { contains: proposalId } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { tool: true, argsJson: true, resultJson: true },
  });
  const hit = rows.find((r) => {
    try {
      return (JSON.parse(r.resultJson ?? "{}") as { result?: { proposalId?: unknown } }).result?.proposalId === proposalId;
    } catch {
      return false;
    }
  });
  return hit ? { tool: hit.tool, argsJson: hit.argsJson } : null;
}

/** The estimates this person built lately, newest first — what "send it" and "change it" mean (the prompt shows it). */
export async function recentBuilds(actor: AssistantActor, now: Date): Promise<string[]> {
  const rows = await db.assistantAction.findMany({
    where: { organizationId: actor.organizationId, userId: actor.userId, tool: { in: [...BUILD_TOOLS] }, status: "DONE", createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { resultJson: true, createdAt: true },
  });
  const ids = rows
    .map((r) => {
      try {
        const v = (JSON.parse(r.resultJson ?? "{}") as { result?: { proposalId?: unknown } }).result?.proposalId;
        return typeof v === "string" ? v : null;
      } catch {
        return null;
      }
    })
    .filter((x): x is string => Boolean(x));
  if (!ids.length) return [];
  const ps = await db.proposal.findMany({
    where: { id: { in: ids }, organizationId: actor.organizationId, ...proposalScope(actor) },
    select: { id: true, title: true, trade: true, status: true, total: true, currency: true, createdAt: true, client: { select: { name: true, email: true } } },
  });
  const byId = new Map(ps.map((p) => [p.id, p]));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.status !== "ARCHIVED")
    .map((p) => `proposalId=${p.id} · "${p.title}" · ${p.trade === "deck" ? "deck (change it with change_deck)" : "estimate (change it with change_estimate)"} · ${p.client ? `for ${p.client.name}${p.client.email ? "" : " (no email on file)"}` : "no client yet"} · ${money(p.total, p.currency)} · ${p.status} · built ${dayWords(p.createdAt, actor.timezone)}`);
}

// ── the deck ─────────────────────────────────────────────────────────────────

type DeckArgs = {
  clientId: string | null;
  leadId: string | null;
  address: string | null;
  widthFt: number;
  depthFt: number;
  heightFt: number | null;
  cover: "none" | "roof" | "pergola" | "gazebo";
  boards: string | null;
  rail: string | null;
  stairs: boolean | null;
  more: string | null;
};

const deckArgs = z.object({
  clientId: ID.nullable().describe("the client's id from find, or null"),
  leadId: ID.nullable().describe("the lead's id from find when the job is for a lead, or null"),
  address: z.string().max(300).nullable().describe("the job's address when they said one; null = the client's or lead's own"),
  widthFt: z.number().min(4).max(80).describe("feet along the house (the first number of '12 by 16')"),
  depthFt: z.number().min(4).max(60).describe("feet out from the house (the second number)"),
  heightFt: z.number().min(0.5).max(20).nullable().describe("how high off the ground, ft; null = not said"),
  cover: z.enum(["none", "roof", "pergola", "gazebo"]).describe("roof = a roof over the deck (a covered deck); pergola = open slats; gazebo; none"),
  boards: z.string().max(60).nullable().describe("decking if said: composite, cedar, pressure-treated, Trex, PVC, ipe…"),
  rail: z.string().max(60).nullable().describe("railing if said: aluminum, cable, composite, glass, wood, or none"),
  stairs: z.boolean().nullable().describe("true when they asked for stairs"),
  more: z.string().max(400).nullable().describe("anything else they said about the deck, in their words: 'stairs on the left', 'a ceiling fan', 'lights', 'a hot tub'"),
}) as unknown as z.ZodType<DeckArgs>;

const num = (x: number) => String(Math.round(x * 2) / 2);

/** The person's deck as the studio's own voice commands, one clause at a time (hear() reads one sentence). */
function deckPhrases(a: DeckArgs): string[] {
  const out = [`${num(a.widthFt)} by ${num(a.depthFt)}`];
  if (a.heightFt != null) out.push(`${num(a.heightFt)} feet high`);
  if (a.cover === "roof") out.push("with a roof");
  else if (a.cover === "pergola") out.push("add a pergola");
  else if (a.cover === "gazebo") out.push("make it a gazebo");
  if (a.boards?.trim()) out.push(`${a.boards.trim()} boards`);
  if (a.rail?.trim()) out.push(/^(none|no)\b/i.test(a.rail.trim()) ? "no railing" : `${a.rail.trim()} railing`);
  if (a.stairs) out.push("add stairs");
  if (a.more?.trim()) out.push(a.more.trim());
  return out;
}

interface DeckEnv {
  rates: Awaited<ReturnType<typeof readDeckRateBook>>;
  market: ReturnType<typeof resolveMarket>;
}

async function deckEnv(organizationId: string, address: string | null, state: string | null): Promise<DeckEnv> {
  return { rates: await readDeckRateBook(organizationId), market: resolveMarket({ address, state }) };
}

/** The clauses run through the studio's ears; what it could not do is said back, never guessed past. */
function listen(design: DeckDesign, phrases: string[], env: DeckEnv): { design: DeckDesign; notes: string[]; changed: boolean; last: string } {
  let d = design;
  let st: VoiceState = freshVoiceState();
  const notes: string[] = [];
  let changed = false;
  let last = "";
  for (const phrase of phrases) {
    const r = hear(phrase, d, st, env);
    last = r.say;
    if (r.design) {
      d = r.design;
      changed = true;
    }
    st = { ...r.state, pending: null };
    const custom = r.pending && "price" in r.pending ? (r.pending as { price?: { item?: string } }).price?.item : null;
    if (custom) notes.push(`I couldn't price "${custom}" — add it in the proposal.`);
    else if (r.unknown.length) notes.push(`I didn't catch "${r.unknown.join(", ")}".`);
  }
  return { design: d, notes, changed, last };
}

/** A railing where the code wants a guard (over 30 in. up), when the person named none — what the studio asks next. */
function withGuard(design: DeckDesign, env: DeckEnv): DeckDesign {
  if (design.heightIn <= 30 || design.rail.type !== "none") return design;
  return hear("composite railing", design, freshVoiceState(), env).design ?? design;
}

/** The designed deck → priced, its 3D frozen, filed as a draft. */
async function fileDeck(actor: AssistantActor, design: DeckDesign, address: string | null, env: DeckEnv, filing: FilingContext | null): Promise<{ id: string; facts: string }> {
  const settled = settleDesign(design, { rates: env.rates, market: env.market }).design;
  const pkg = priceDeck(settled, { rates: env.rates, market: env.market });
  const scene = deckScene(pkg.structure);
  const words = structureWords(settled);
  const parsed = deckConvertSchema.safeParse({
    title: `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, 200),
    scope: deckScope(pkg, address).join("\n").slice(0, 6000),
    assumptions: deckNotes(pkg).slice(0, 20).map((n) => n.slice(0, 600)),
    lines: pkg.lines.map((l) => ({ name: l.name.slice(0, 200), description: l.description?.slice(0, 400), quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })),
    address,
    plan: { design: settled, scene },
  });
  if (!parsed.success) throw new Error("The deck couldn't be priced as described. Try the size again, like '12 by 16'.");
  const id = await writeDeckProposal({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role }, parsed.data, filing);
  return { id, facts: scene.facts };
}

async function deckGate(actor: AssistantActor): Promise<string | null> {
  const level = await deckStudioAccess({ id: actor.userId }, actor.organizationId);
  if (level === "none") return "Deck Studio isn't open on your account yet, so I can't build decks. I can price it as a general estimate instead — say \"estimate it\".";
  if (level === "preview") return `Deck proposals are part of Deck Studio — add it from the Deck estimator (${deckAddonShortWords()}). Or say "estimate it" and I'll price it as a general estimate.`;
  return null;
}

const buildDeck: WriteTool<DeckArgs, DeckArgs> = {
  kind: "write",
  instant: "now",
  name: "build_deck",
  need: "estimates.build",
  description:
    "Design and price a deck, a covered deck (a roof over it), a pergola or a gazebo with the Deck Studio, and save it as a DRAFT proposal (nothing goes to the client). Needs the size. Find the client or lead first when they name one. The person then gets the price, the link, and an offer to send it.",
  params: deckArgs,
  payload: deckArgs,
  async plan({ actor }, a) {
    const closed = (await deckGate(actor)) ?? (await proposalCap(actor));
    if (closed) return { ok: false, say: closed };
    const w = await whoFor(actor, a.clientId, a.leadId);
    if (!w.ok) return w;
    const what = a.cover === "roof" ? "covered deck" : a.cover === "none" ? "deck" : a.cover;
    return { ok: true, payload: a, readback: `On it — drawing and pricing the ${num(a.widthFt)} × ${num(a.depthFt)} ft ${what}${w.who.name ? ` for ${w.who.name}` : ""} in your Deck Studio.` };
  },
  async execute({ actor }, a) {
    const w = await whoFor(actor, a.clientId, a.leadId);
    if (!w.ok) throw new Error(w.say);
    const org = await db.organization.findUnique({ where: { id: actor.organizationId }, select: { address: true } });
    const address = a.address?.trim() || w.who.address;
    const state = stateFromAddress(address) ?? stateFromAddress(org?.address ?? null);
    const env = await deckEnv(actor.organizationId, address, state);
    const site = siteFromAddress(address, state);
    const base = defaultDeckDesign({ state });
    const onSite = applyDeckPatch(base, { loadPsf: site.deckLoad, frostIn: site.frostIn, site: { ...base.site, groundSnowPsf: site.groundSnowPsf, termite: site.termite } } as Parameters<typeof applyDeckPatch>[1]);
    const heard = listen(onSite, deckPhrases(a), env);
    const design = a.rail?.trim() ? heard.design : withGuard(heard.design, env);
    const filing = await filingFromIds(actor.organizationId, { clientId: a.clientId, leadId: a.leadId });
    const made = await fileDeck(actor, design, address, env, filing);
    const out = await builtWords(actor, made.id, { facts: made.facts, notes: heard.notes });
    return { ...out, result: { proposalId: made.id, trade: "deck" } };
  },
};

type ChangeArgs = { proposalId: string; change: string };
const changeArgs = z.object({
  proposalId: ID.describe("the estimate to change (from the 'built lately' list, or find)"),
  change: z.string().min(2).max(400).describe("the change in their words: 'make it 14 wide', 'cedar boards', 'add a ceiling fan', 'no stairs'"),
}) as unknown as z.ZodType<ChangeArgs>;

/** A deck proposal of this company that this person may see, with the deck it carries. */
async function deckOf(actor: AssistantActor, proposalId: string) {
  const p = await db.proposal.findFirst({
    where: { id: proposalId, organizationId: actor.organizationId, ...proposalScope(actor) },
    select: { id: true, title: true, total: true, status: true, address: true, clientId: true, projectId: true },
  });
  if (!p) return null;
  const ev = await db.activityEvent.findFirst({ where: { proposalId: p.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
  let raw: Record<string, unknown> | null = null;
  try {
    raw = ev?.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : null;
  } catch {
    raw = null;
  }
  if (!raw?.design) return { p, design: null };
  const design = normalizeDeckDesign(raw.design);
  if (design.photo && !ownDeckPhoto(design.photo.url, actor.organizationId)) design.photo = null;
  return { p, design, address: p.address ?? (typeof raw.address === "string" ? raw.address : null) };
}

const changeDeck: WriteTool<ChangeArgs, ChangeArgs> = {
  kind: "write",
  instant: "now",
  name: "change_deck",
  need: "estimates.build",
  description:
    "Change a deck estimate (one made with build_deck or the Deck Studio): the size, the height, the boards, the railing, stairs, a roof, a fan… Saves the changed deck as a new DRAFT with the new price and link.",
  params: changeArgs,
  payload: changeArgs,
  async plan({ actor }, a) {
    const closed = (await deckGate(actor)) ?? (await proposalCap(actor));
    if (closed) return { ok: false, say: closed };
    const d = await deckOf(actor, a.proposalId);
    if (!d) return { ok: false, say: "I couldn't find that estimate." };
    if (!d.design) return { ok: false, say: `"${d.p.title}" wasn't made in the Deck Studio, so I can't change it as a deck. Say "change the estimate" instead.` };
    return { ok: true, payload: a, readback: `On it — changing "${d.p.title}": ${a.change.trim()}.` };
  },
  async execute({ actor }, a) {
    const d = await deckOf(actor, a.proposalId);
    if (!d?.design) throw new Error("Not found");
    const state = stateFromAddress(d.address ?? null);
    const env = await deckEnv(actor.organizationId, d.address ?? null, state);
    const heard = listen(d.design, [a.change], env);
    if (!heard.changed) return { say: heard.notes.join(" ") || heard.last || "I couldn't make that change. Say it another way, or open it in the Deck Studio." };
    const filing = await filingFromIds(actor.organizationId, { clientId: d.p.clientId, projectId: d.p.projectId });
    const made = await fileDeck(actor, heard.design, d.address ?? null, env, filing);
    const archived = await archiveReplaced(actor, d.p.id);
    const out = await builtWords(actor, made.id, { facts: made.facts, notes: heard.notes, was: d.p.total, archived });
    return { ...out, result: { proposalId: made.id, trade: "deck", replaces: d.p.id } };
  },
};

// ── any other job: Smart Proposal ────────────────────────────────────────────

type BriefArgs = { projectType: string; description: string; clientId: string | null; leadId: string | null; address: string | null };

const briefArgs = z.object({
  projectType: z.string().min(2).max(80).describe("the kind of job: 'Roof replacement', 'Fence', 'Kitchen remodel', 'Interior painting'…"),
  description: z.string().min(8).max(2000).describe("the whole job in their words, with every size, quantity, material and detail they gave"),
  clientId: ID.nullable().describe("the client's id from find, or null"),
  leadId: ID.nullable().describe("the lead's id from find when the job is for a lead, or null"),
  address: z.string().max(300).nullable().describe("the job's address or city when said; null = the client's or lead's own"),
}) as unknown as z.ZodType<BriefArgs>;

/** Smart Proposal's own doors (actions/advancedEstimator generateAdvancedEstimate), asked of this person. */
async function smartGate(actor: AssistantActor): Promise<string | null> {
  const org = actor.organizationId;
  if (await isPageLocked(org, ["smart-proposal", "video-estimator"])) return "Your plan doesn't include Smart Proposal, so I can't price that by text.";
  try {
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    requireFeatureOrThrow(await getOrgPlanById(org), "advanced_estimator");
  } catch (err) {
    return err instanceof Error ? err.message : "Your plan doesn't include the AI estimator.";
  }
  if (!isOpenAIEnabled()) return "Pricing needs the estimator's AI service, which isn't set up here.";
  const uses = await checkPlanLimit(org, "estimatorUses", 1, { actorId: actor.userId });
  if (!uses.allowed) return "Your plan's AI estimates for this month are used up. A bigger plan raises the number (Settings → Billing).";
  return proposalCap(actor);
}

function onIt(actor: AssistantActor, what: string, who: string | null): string {
  const back = actor.channel === "sms" ? "I'll text you" : actor.channel === "voice" ? "I'll tell you" : "You'll see";
  return `On it — pricing the ${what.toLowerCase()}${who ? ` for ${who}` : ""} with your Smart Proposal prices. ${back} the price and the link in about a minute.`;
}

/** The brief → Smart Proposal's run → kept as the company's estimate → a draft proposal. */
async function fileSmart(actor: AssistantActor, b: BriefArgs, filing: FilingContext | null): Promise<{ id: string; facts: string; notes: string[] }> {
  const org = actor.organizationId;
  try {
    await enforceRateLimit(`ai:${org}`, 60, HOUR, "AI runs");
  } catch {
    throw new Error("That's a lot of AI estimates for one hour — try again a little later.");
  }
  const trial = await takeTrialCap(org, "aiCalls");
  if (!trial.ok) throw new Error(trial.failure.error || "Your trial's AI estimates are used up.");
  await noteRequestOrg(org).catch(() => undefined);
  const w = await whoFor(actor, b.clientId, b.leadId);
  const location = b.address?.trim() || (w.ok ? w.who.address : null) || undefined;
  const run = await runSmartEstimate(org, { projectType: b.projectType, description: b.description, location }, null, trial.refund);
  if (!run.ok) throw new Error(run.error);
  if (run.disabled) throw new Error("Pricing needs the estimator's AI service, which isn't set up here.");
  // A suggestion counts in no total until it is added (Smart Proposal's own save), so it never reaches the proposal.
  const keep = (l: { flag?: string }) => l.flag !== "suggested";
  const data = { ...run.data, materials: run.data.materials.filter(keep), labor: run.data.labor.filter(keep) };
  if (!data.materials.length && !data.labor.length) throw new Error("The estimate came back empty. Tell me a little more about the job and I'll try again.");
  await saveEstimateAs({ organizationId: org, userId: actor.userId }, { projectType: b.projectType, location: location ?? null, data });
  const input = convertInput.parse({
    projectType: b.projectType,
    source: "smart",
    title: data.title,
    scope: data.scope,
    materials: data.materials,
    labor: data.labor,
    assumptions: data.assumptions,
    location: location ?? null,
    discount: data.discount ?? undefined,
    ...(data.pricing ? { pricing: data.pricing } : {}),
  });
  const { id } = await convertEstimateAs({ organizationId: org, userId: actor.userId, role: actor.role }, input, filing);
  const suggested = run.data.materials.length + run.data.labor.length - data.materials.length - data.labor.length;
  const notes = suggested > 0 ? [`${suggested} suggested line${suggested === 1 ? "" : "s"} you didn't ask for ${suggested === 1 ? "is" : "are"} left out.`] : [];
  // What is in it, as the proposal reads: its lines, the first few by name.
  const lines = await db.lineItem.findMany({ where: { proposalId: id }, orderBy: { position: "asc" }, select: { name: true } });
  const short = (name: string) => (name.length <= 48 ? name : name.slice(0, 48).replace(/[\s,;:(–—-]+\S*$/, "")).replace(/[\s.,;:]+$/, "");
  const named = lines.slice(0, 3).map((l) => short(l.name));
  const more = lines.length - named.length;
  const facts = `${lines.length} line${lines.length === 1 ? "" : "s"}: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  return { id, facts, notes };
}

const buildEstimate: WriteTool<BriefArgs, BriefArgs> = {
  kind: "write",
  instant: "background",
  name: "build_estimate",
  need: "estimates.build",
  description:
    "Price any job except a deck — a roof, a fence, HVAC, siding, windows, a kitchen or bath, painting, concrete, flooring, anything — with Smart Proposal (the company's own prices), and save it as a DRAFT proposal (nothing goes to the client). Takes about a minute. Find the client or lead first when they name one.",
  params: briefArgs,
  payload: briefArgs,
  async plan({ actor }, b) {
    const closed = await smartGate(actor);
    if (closed) return { ok: false, say: closed };
    const w = await whoFor(actor, b.clientId, b.leadId);
    if (!w.ok) return w;
    return { ok: true, payload: b, readback: onIt(actor, b.projectType, w.who.name) };
  },
  async execute({ actor }, b) {
    const filing = await filingFromIds(actor.organizationId, { clientId: b.clientId, leadId: b.leadId });
    const made = await fileSmart(actor, b, filing);
    const out = await builtWords(actor, made.id, { facts: made.facts, notes: made.notes });
    return { ...out, result: { proposalId: made.id, trade: "estimate" } };
  },
};

type ChangedBrief = BriefArgs & { replaces: string; was: number };
const changedBrief = z.object({
  projectType: z.string(),
  description: z.string(),
  clientId: z.string().nullable(),
  leadId: z.string().nullable(),
  address: z.string().nullable(),
  replaces: z.string(),
  was: z.number(),
}) as unknown as z.ZodType<ChangedBrief>;

const changeEstimate: WriteTool<ChangeArgs, ChangedBrief> = {
  kind: "write",
  instant: "background",
  name: "change_estimate",
  need: "estimates.build",
  description:
    "Change an estimate that isn't a deck (a roof, a fence, a kitchen…): prices the job again with the change, as a new DRAFT with the new price and link. Takes about a minute.",
  params: changeArgs,
  payload: changedBrief,
  async plan({ actor }, a) {
    const closed = await smartGate(actor);
    if (closed) return { ok: false, say: closed };
    const p = await db.proposal.findFirst({
      where: { id: a.proposalId, organizationId: actor.organizationId, ...proposalScope(actor) },
      select: { id: true, title: true, total: true, scopeOfWork: true, address: true, clientId: true, client: { select: { name: true } } },
    });
    if (!p) return { ok: false, say: "I couldn't find that estimate." };
    // The brief it was priced from, when the Assistant priced it; else the proposal's own title and scope.
    const built = await builtByAssistant(actor, p.id);
    let brief: BriefArgs | null = null;
    try {
      const v = built ? (JSON.parse(built.argsJson) as Partial<BriefArgs>) : null;
      if (v && typeof v.description === "string" && typeof v.projectType === "string") brief = { projectType: v.projectType, description: v.description, clientId: v.clientId ?? null, leadId: v.leadId ?? null, address: v.address ?? null };
    } catch {
      brief = null;
    }
    brief ??= { projectType: p.title, description: [p.title, p.scopeOfWork].filter(Boolean).join("\n"), clientId: p.clientId, leadId: null, address: p.address };
    const payload: ChangedBrief = { ...brief, description: `${brief.description}\nChange: ${a.change.trim()}`.slice(0, 2000), replaces: p.id, was: p.total };
    return { ok: true, payload, readback: onIt(actor, `${p.title} with the change`, p.client?.name ?? null) };
  },
  async execute({ actor }, b) {
    const filing = await filingFromIds(actor.organizationId, { clientId: b.clientId, leadId: b.leadId });
    const made = await fileSmart(actor, b, filing);
    const archived = await archiveReplaced(actor, b.replaces);
    const out = await builtWords(actor, made.id, { facts: made.facts, notes: made.notes, was: b.was, archived });
    return { ...out, result: { proposalId: made.id, trade: "estimate", replaces: b.replaces } };
  },
};

export const BUILDERS = [buildDeck, changeDeck, buildEstimate, changeEstimate] as const;
