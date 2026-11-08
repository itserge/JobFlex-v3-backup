import "server-only";
// DRAWS FOR THE AI OPERATOR (2026-11-07, part 6 of the plan "Projects: Remodel and New construction") — "What's funded
// on the Lee house?", "request draw three on the Lee house", "the bank funded draw two". One read and two writes, each
// a thin call into what the Payments card runs (lib/projectDraws): the Operator never decides a draw is ready itself.

import { z } from "zod";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { projectNamed } from "@/lib/assistant/projects";
import { ensureLenderShare } from "@/lib/projectClient/server";
import { drawsOf, fundDraw, requestDraw, takeSnapshot } from "@/lib/projectDraws/server";
import { dollars, drawWords, type DrawRead } from "@/lib/projectDraws/shared";

const ID = z.string().min(1).max(64);

/** The draw the person named: "draw three", "3", "the dry-in draw", "the final". */
function drawNamed(draws: readonly DrawRead[], words: string): DrawRead | null {
  const q = words.toLowerCase().trim();
  const WORDS: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, seven: 7 };
  const m = /(\d+)/.exec(q);
  const n = m ? Number(m[1]) : (Object.entries(WORDS).find(([w]) => new RegExp(`\\b${w}\\b`).test(q))?.[1] ?? null);
  if (n != null) return draws.find((d) => d.number === n) ?? null;
  if (/\bfinal\b|\blast\b/.test(q)) return draws[draws.length - 1] ?? null;
  if (/\bnext\b/.test(q)) return draws.find((d) => d.state !== "FUNDED") ?? null;
  const terms = q.split(/[^a-z]+/).filter((w) => w.length > 2 && !["the", "draw"].includes(w));
  let best: { d: DrawRead; score: number } | null = null;
  for (const d of draws) {
    const name = d.name.toLowerCase();
    const score = terms.reduce((s, t) => s + (name.includes(t) ? t.length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { d, score };
  }
  return best?.d ?? null;
}

// ── read ─────────────────────────────────────────────────────────────────────

const drawsTool: ReadTool<{ projectId: string }> = {
  kind: "read",
  name: "draws",
  need: "projects.read",
  card: {
    label: "Draws",
    purpose: "A new build's lender draws: each draw's dollars and where it stands — planned, ready to request, requested, funded — what is funded and held back, and which comes next.",
    when: "'What's funded on the Lee house?', 'which draw is next', 'how much has the bank released': draws with the project id (find it first). A remodel has no draws.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "what's funded on the Lee house?", args: { projectId: "proj_1" } }],
  },
  description:
    "A new build's draws (lib/projectDraws): the schedule — number, name, the phase whose close releases it, dollars — and where each stands: planned, ready to request (its phase closed and every inspection passed), waits on an inspection, requested on a day, funded on a day with the retainage held; the totals funded, requested and held; the next draw. Give the project id (find it first). Use for: what's funded, which draw is next, how much is held back. A remodel has no draws.",
  params: z.object({ projectId: ID }),
  async run({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { error: "I couldn't find that project." };
    const r = await drawsOf(actor.organizationId, p.one.id);
    if (!r.draws.length) return { project: p.one.name, note: r.lender ? `${p.one.name} has no draws laid out yet — Lay out the draws on the Payments card puts the usual five on the ${r.basis.from === "contract" ? "contract" : "cost budget"}.` : `${p.one.name} has no lender's draws — it is paid as a remodel is, in progress payments (project_status has the money).` };
    return {
      project: p.one.name,
      funded: dollars(r.funded),
      requested: dollars(r.requested),
      held: dollars(r.held),
      total: dollars(r.total),
      next: r.next ? `Draw ${r.next.number}, ${r.next.name} — ${dollars(r.next.amount)} — ${drawWords(r.next)}` : "Every draw is funded.",
      draws: r.draws.map((d) => ({ number: d.number, name: d.name, amount: dollars(d.amount), after: d.phase?.name ?? null, words: drawWords(d) })),
      lenderPage: r.lenderPage,
    };
  },
};

// ── request ──────────────────────────────────────────────────────────────────

type ReqArgs = { projectId: string; draw: string };
type ReqPayload = { drawId: string; words: string };

const requestDrawTool: WriteTool<ReqArgs, ReqPayload> = {
  kind: "write",
  name: "request_draw",
  need: "projects.write",
  card: {
    label: "Request a draw",
    purpose: "Ask the lender for a draw on a new build: the draw is marked requested with the bundle the lender gets — the inspections passed, the photos on file, how far along the house is, what was spent.",
    when: "'Request draw three on the Lee house', 'ask the bank for the dry-in draw', 'request the next draw': request_draw with the project id (find it first) and the draw as said (a number, its name, 'next', 'final'). Refused while the draw's phase is open or an inspection on it has not passed.",
    objects: ["project", "money"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "request draw three on the Lee house", args: { projectId: "proj_1", draw: "three" } }],
  },
  description:
    "Request a lender's draw on a new build: the project id (find it first) and the draw as said — 'three', 'the dry-in draw', 'next', 'final'. A draw is ready once the phase it follows is closed and every inspection on it has passed; otherwise the answer says what it waits on. The request takes the lender's bundle now (phases and % done, inspections and results, photos, spent and committed) and is read back for a yes. Use for: request draw three, ask the bank for the dry-in draw.",
  params: z.object({ projectId: ID, draw: z.string().min(1).max(80) }),
  payload: z.object({ drawId: ID, words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    const r = await drawsOf(actor.organizationId, p.one.id);
    if (!r.draws.length) return { ok: false, say: `${p.one.name} has no draws laid out — Lay out the draws on the Payments card first.` };
    const d = drawNamed(r.draws, args.draw);
    if (!d) return { ok: false, say: `Which draw? ${p.one.name} has: ${r.draws.map((x) => `${x.number} ${x.name} (${drawWords(x)})`).join("; ")}.` };
    if (d.state === "FUNDED") return { ok: false, say: `Draw ${d.number}, ${d.name}, is funded already.` };
    if (d.state === "REQUESTED") return { ok: false, say: `Draw ${d.number}, ${d.name}, was requested${d.requestedAt ? ` on ${d.requestedAt.slice(0, 10)}` : ""} — mark it funded when the money lands.` };
    if (!d.ready) return { ok: false, say: `Not yet — draw ${d.number}, ${d.name}, ${drawWords(d)}.` };
    const snap = await takeSnapshot(actor.organizationId, p.one.id, { number: d.number, name: d.name, amount: d.amount });
    const words = `Request draw ${d.number}, ${d.name} — ${dollars(d.amount)} (${dollars(d.payout.released)} after the ${d.retainagePct}% retainage) — on ${p.one.name}`;
    return { ok: true, payload: { drawId: d.id, words }, readback: `${words}? The lender gets: ${snap.words}` };
  },
  async execute({ actor }, payload) {
    const r = await requestDraw(actor.organizationId, payload.drawId, actor.userId);
    return { say: `Done — ${payload.words.replace(/^Request /, "requested ")}. The bundle is on the draw: ${r.snapshot.words}`, result: { drawId: payload.drawId, number: r.number } };
  },
};

// ── funded ───────────────────────────────────────────────────────────────────

type FundArgs = { projectId: string; draw: string; amount: number | null };
type FundPayload = { drawId: string; amount: number | null; words: string };

const fundDrawTool: WriteTool<FundArgs, FundPayload> = {
  kind: "write",
  name: "fund_draw",
  need: "projects.write",
  card: {
    label: "Draw funded",
    purpose: "Record that the lender funded a draw, with what landed.",
    when: "'The bank funded draw two', 'draw three came in, $108,000', 'the dry-in draw is funded': fund_draw with the project id (find it first), the draw as said and the amount when they name one (null = what the schedule says after the retainage).",
    objects: ["project", "money"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "the bank funded draw two on the Lee house", args: { projectId: "proj_1", draw: "two", amount: null } }],
  },
  description: "Record a lender's draw as funded on a new build: the project id (find it first), the draw as said, and the amount that landed or null for the schedule's figure after the retainage. Read back for a yes. Use for: the bank funded draw two, draw three came in.",
  params: z.object({ projectId: ID, draw: z.string().min(1).max(80), amount: z.number().min(0).max(100_000_000).nullable() }),
  payload: z.object({ drawId: ID, amount: z.number().nullable(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    const r = await drawsOf(actor.organizationId, p.one.id);
    const d = drawNamed(r.draws, args.draw);
    if (!d) return { ok: false, say: r.draws.length ? `Which draw? ${p.one.name} has: ${r.draws.map((x) => `${x.number} ${x.name} (${drawWords(x)})`).join("; ")}.` : `${p.one.name} has no draws laid out.` };
    if (d.state === "FUNDED") return { ok: false, say: `Draw ${d.number}, ${d.name}, is funded already.` };
    const amount = args.amount ?? d.payout.released;
    const words = `Mark draw ${d.number}, ${d.name}, funded — ${dollars(amount)}${d.isFinal && d.payout.releasedRetainage ? ` with the ${dollars(d.payout.releasedRetainage)} retainage released` : d.payout.held ? ` (${dollars(d.payout.held)} held back)` : ""} — on ${p.one.name}`;
    return { ok: true, payload: { drawId: d.id, amount: args.amount, words }, readback: `${words}?${d.state === "PLANNED" ? " It was not requested yet; it goes straight to funded." : ""}` };
  },
  async execute({ actor }, payload) {
    const r = await fundDraw(actor.organizationId, payload.drawId, payload.amount, actor.userId);
    const read = await drawsOf(actor.organizationId, r.projectId);
    return { say: `Done — ${payload.words.replace(/^Mark /, "marked ")}. ${dollars(read.funded)} funded in all${read.held ? `, ${dollars(read.held)} held` : ""}; ${read.next ? `next: draw ${read.next.number}, ${read.next.name} — ${drawWords(read.next)}` : "every draw is funded"}.`, result: r };
  },
};

// ── the lender's page (part 7, 2026-11-08) ───────────────────────────────────

type LinkArgs = { projectId: string };
type LinkPayload = { projectId: string; name: string };

const lenderLinkTool: WriteTool<LinkArgs, LinkPayload> = {
  kind: "write",
  name: "lender_link",
  need: "projects.write",
  card: {
    label: "The lender's page",
    purpose: "Make the lender's read-only page for a new build and give its link: the house's progress, the phases and what closes each, the draws with their bundles, the inspections and the photos the office chose.",
    when: "'The lender's link for the Lee house', 'make the bank's page', 'where do I send the lender': lender_link with the project id (find it first). Once made, the same link is read back at once.",
    objects: ["project", "money"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-08",
    samples: [{ say: "the lender's link for the Lee house", args: { projectId: "proj_1" } }],
  },
  description:
    "The lender's page for a new build (lib/projectClient ensureLenderShare): a read-only link (/l/<token>) with the house's progress, the phases and what closes each, the draws with the bundle taken at each request, the inspections and the photos chosen for the client — never the budget, the margin or a note. Give the project id (find it first). When the link exists it is read back at once; otherwise making it is read back for a yes. Use for: the lender's link, the bank's page, where to send the lender.",
  params: z.object({ projectId: ID }),
  payload: z.object({ projectId: ID, name: z.string() }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    const r = await drawsOf(actor.organizationId, p.one.id);
    if (!r.lender && !r.draws.length) return { ok: false, say: `${p.one.name} has no lender (the start questions) — the lender's page is for a build paid in draws.` };
    if (r.lenderPage) return { ok: false, say: `The lender's page for ${p.one.name}: ${r.lenderPage} — read-only. Send it to the lender yourself; no lender contact is stored.` };
    return { ok: true, payload: { projectId: p.one.id, name: p.one.name }, readback: `Make the lender's page for ${p.one.name} — a read-only link with the house's progress, the draws and their bundles, the inspections and the photos?` };
  },
  async execute({ actor }, payload) {
    const r = await ensureLenderShare(actor.organizationId, payload.projectId, actor.userId);
    return { say: `Done — the lender's page for ${payload.name}: ${r.href}. Send it to the lender yourself; no lender contact is stored.`, result: { projectId: payload.projectId, href: r.href } };
  },
};

export const DRAW_TOOLS = [drawsTool, requestDrawTool, fundDrawTool, lenderLinkTool] as const;
