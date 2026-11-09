import "server-only";
// CONTRACTORS FOR THE AI OPERATOR (2026-11-07, part 2 of the plan "Projects: Remodel and New construction") — "Ask
// the framers for a quote on the Lee house framing", "any quotes back on the framing?", "award the framing to Ridge
// Framing", "who do we have for plumbing?". Two writes read back for a yes and two reads, each a thin call into what
// the project's Contractors card runs (lib/projectSubs): the Operator never prices anything itself.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { projectNamed, stageNamed } from "@/lib/assistant/projects";
import { stagesOf } from "@/lib/projectStages/server";
import { askQuotes, awardQuote, contractorsOf, subsOf } from "@/lib/projectSubs/server";
import { QUOTE_LABEL, dollars, replyByDefault, scopeFor, tradeForStage } from "@/lib/projectSubs/shared";
import { dayOf } from "@/lib/assistant/shared";

const ID = z.string().min(1).max(64);

/** The contractors a word points at: a trade ("framers", "plumbing"), a name, a company — the company's list. Shared
 *  with the part 6 tools (./subs). */
export async function contractorsNamed(organizationId: string, words: { contractors: string | null; trade: string | null; stageTrade: string | null }) {
  const all = await contractorsOf(organizationId);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (words.contractors?.trim()) {
    const names = words.contractors.split(/,| and /i).map(norm).filter(Boolean);
    const hit = all.filter((c) => names.some((n) => norm(c.name).includes(n) || (c.company ? norm(c.company).includes(n) : false)));
    return { list: hit, how: "by name" as const };
  }
  const trade = (words.trade ?? "").trim();
  if (trade) {
    const t = norm(trade).replace(/s$/, "").replace(/^(the )/, "");
    const TRADE_WORDS: Record<string, string> = { framer: "Carpentry", carpenter: "Carpentry", plumber: "Plumbing", electrician: "Electrical", roofer: "Roofing", painter: "Painting", tiler: "Tile", drywaller: "Drywall", excavator: "Concrete", concrete: "Concrete", hvac: "HVAC", sider: "Siding", landscaper: "Landscaping", fencer: "Fencing", decker: "Decking" };
    const canon = TRADE_WORDS[t] ?? t;
    const hit = all.filter((c) => c.trade && (norm(c.trade) === norm(canon) || norm(c.trade).includes(t) || t.includes(norm(c.trade))));
    return { list: hit, how: `for ${canon}` as const };
  }
  if (words.stageTrade) {
    const hit = all.filter((c) => c.trade === words.stageTrade);
    return { list: hit, how: `for ${words.stageTrade}` as const };
  }
  return { list: [], how: "" as const };
}

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ── ask ──────────────────────────────────────────────────────────────────────

type AskArgs = { projectId: string; stage: string | null; trade: string | null; contractors: string | null };
type AskPayload = { projectId: string; stageId: string | null; contractorIds: string[]; scope: string; dueBy: string; words: string };

const askQuotesTool: WriteTool<AskArgs, AskPayload> = {
  kind: "write",
  name: "ask_quotes",
  need: "projects.write",
  card: {
    label: "Ask for quotes",
    purpose: "Ask one or several of the company's contractors for a quote on a stage's work; each gets a text or an email with their own link.",
    when: "'Ask the framers for a quote on the Lee house framing', 'get three plumbing quotes for the Smith remodel', 'ask Ridge Framing to quote the addition': ask_quotes with the project id (find it first), the stage's words, and either a trade ('framers', 'plumbing') or the contractors' names. The scope is the stage's own; the reply-by day is five work days out.",
    objects: ["project", "money"],
    effect: "message",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "ask the framers for a quote on the Lee house framing", args: { projectId: "proj_1", stage: "framing", trade: "framers", contractors: null } }],
  },
  description:
    "Ask the company's contractors for a quote on one stage of a project: the project id (find it first), the stage's words ('framing', 'rough-ins'), and who to ask — a trade word ('framers', 'plumbing': everyone of that trade on the list) or names ('Ridge Framing and Lee Carpentry'). Each contractor gets a text or an email with their own page to price it; the quotes land on the project's Contractors card. Read back for a yes.",
  params: z.object({ projectId: ID, stage: z.string().max(80).nullable(), trade: z.string().max(60).nullable(), contractors: z.string().max(200).nullable() }),
  payload: z.object({ projectId: ID, stageId: ID.nullable(), contractorIds: z.array(ID).min(1), scope: z.string(), dueBy: z.string(), words: z.string() }),
  async plan({ actor, now }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    const { stages } = await stagesOf(p.one.id);
    if (!stages.length) return { ok: false, say: `${p.one.name} has no stages yet — add them on the project page first.` };
    const stage = args.stage ? stageNamed(stages, args.stage) : null;
    if (args.stage && !stage) return { ok: false, say: `Which stage? ${p.one.name} has: ${stages.map((s) => s.name).join(", ")}.` };
    const stageTrade = stage ? tradeForStage(stage.name) : null;
    const who = await contractorsNamed(actor.organizationId, { contractors: args.contractors, trade: args.trade, stageTrade });
    if (!who.list.length) {
      const all = await contractorsOf(actor.organizationId);
      return { ok: false, say: all.length ? `Nobody ${who.how || "like that"} is on your contractor list${all.length ? ` (you have ${andList(all.slice(0, 5).map((c) => `${c.name}${c.trade ? ` · ${c.trade}` : ""}`))})` : ""}. Add them on the project page, under Contractors.` : "Your contractor list is empty — add contractors on a project page, under Contractors, and I'll ask them." };
    }
    const reachable = who.list.filter((c) => c.phone || c.email);
    if (!reachable.length) return { ok: false, say: `${andList(who.list.map((c) => c.name))} ${who.list.length === 1 ? "has" : "have"} no phone or email on file — add one on the Contractors card, or copy their link from there.` };
    const scope = stage ? scopeFor(stage.name, stage.tasks.map((t) => t.title)) : p.one.name;
    const dueBy = replyByDefault(dayOf(now, actor.timezone));
    const words = `Ask ${andList(reachable.map((c) => c.name))} for a quote on ${stage ? stage.name : "the project"} (${p.one.name})`;
    return {
      ok: true,
      payload: { projectId: p.one.id, stageId: stage?.id ?? null, contractorIds: reachable.map((c) => c.id), scope, dueBy, words },
      readback: `${words}, reply by ${new Date(`${dueBy}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}?${who.list.length > reachable.length ? ` (${andList(who.list.filter((c) => !c.phone && !c.email).map((c) => c.name))} skipped — no phone or email.)` : ""}`,
    };
  },
  async execute({ actor }, payload) {
    const r = await askQuotes(actor.organizationId, actor.userId, { projectId: payload.projectId, stageId: payload.stageId, contractorIds: payload.contractorIds, scope: payload.scope, dueBy: payload.dueBy });
    const how = (a: (typeof r.asked)[number]) => (a.text === "sent" && a.email === "sent" ? "text and email" : a.text === "sent" ? "text" : a.email === "sent" ? "email" : "nothing went out");
    return { say: `${payload.words}: ${andList(r.asked.map((a) => `${a.contractor} (${how(a)})`))}. The quotes land on the project's Contractors card.`, result: { quoteIds: r.asked.map((a) => a.quoteId) } };
  },
};

// ── read ─────────────────────────────────────────────────────────────────────

const quotesTool: ReadTool<{ projectId: string; stage: string | null }> = {
  kind: "read",
  name: "quotes",
  need: "projects.read",
  card: {
    label: "Quotes",
    purpose: "A project's contractor quotes: who was asked, who quoted what, the lowest, the ones over the budget line, what is awarded, invoiced or paid.",
    when: "'Any quotes back on the framing?', 'who quoted the Lee house plumbing', 'is the drywall awarded': quotes with the project id (find it first) and the stage's words or null for every stage.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "any quotes back on the framing?", args: { projectId: "proj_1", stage: "framing" } }],
  },
  description: "A project's contractor quotes — asked, quoted (with the amount, the lowest marked, over the budget line flagged), awarded, declined, invoiced or paid — for one stage or all. Use for: any quotes back, who quoted what, is it awarded, did the invoice come.",
  params: z.object({ projectId: ID, stage: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { error: "I couldn't find that project." };
    const r = await subsOf(actor.organizationId, p.one.id);
    const q = args.stage ? r.quotes.filter((x) => x.stageName && (x.stageName.toLowerCase().includes(args.stage!.toLowerCase()) || args.stage!.toLowerCase().split(/\s+/).some((w) => w.length > 3 && x.stageName!.toLowerCase().includes(w)))) : r.quotes;
    return {
      project: p.one.name,
      stage: args.stage,
      subsBudget: r.subsBudget != null ? dollars(r.subsBudget) : null,
      quotes: q.map((x) => ({
        contractor: x.contractorName,
        trade: x.contractorTrade,
        stage: x.stageName,
        status: x.status,
        statusWords: QUOTE_LABEL[x.status as keyof typeof QUOTE_LABEL] ?? x.status,
        amount: x.amount,
        best: x.best,
        overBudgetBy: x.overBy,
        budgetLine: x.line,
        overdue: x.overdue,
        replyBy: x.dueBy,
        note: x.note,
        invoice: x.invoiceAmount,
        link: x.link,
      })),
      note: q.length ? "best = the lowest price in, or the awarded one; overBudgetBy = how far over the stage's share of the Subcontractors budget." : `No quotes${args.stage ? ` for ${args.stage}` : ""} on ${p.one.name} yet.`,
    };
  },
};

const contractorsTool: ReadTool<{ trade: string | null }> = {
  kind: "read",
  name: "contractors",
  need: "projects.read",
  card: {
    label: "Contractors",
    purpose: "The company's list of contractors, by trade, with how to reach them.",
    when: "'Who do we have for plumbing', 'which framers do we use', 'list our contractors': contractors with a trade word or null for everyone.",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "who do we have for plumbing?", args: { trade: "plumbing" } }],
  },
  description: "The company's contractors (subs) — name, company, trade, phone, email — for one trade or all. Use for: who do we have for X, which framers do we use, our contractor list.",
  params: z.object({ trade: z.string().max(60).nullable() }),
  async run({ actor }, args) {
    const who = args.trade ? await contractorsNamed(actor.organizationId, { contractors: null, trade: args.trade, stageTrade: null }) : { list: await contractorsOf(actor.organizationId), how: "" };
    return { contractors: who.list.map((c) => ({ id: c.id, name: c.name, company: c.company, trade: c.trade, phone: c.phone, email: c.email, insuranceUntil: c.insuranceUntil })), note: who.list.length ? null : `Nobody${args.trade ? ` for ${args.trade}` : ""} on the list yet — contractors are added on a project page, under Contractors.` };
  },
};

// ── award ────────────────────────────────────────────────────────────────────

type AwardArgs = { projectId: string; contractor: string; stage: string | null };
type AwardPayload = { quoteId: string; words: string };

const awardQuoteTool: WriteTool<AwardArgs, AwardPayload> = {
  kind: "write",
  name: "award_quote",
  need: "projects.write",
  card: {
    label: "Award a quote",
    purpose: "Go with a contractor's quote for a stage: they are told and asked for the invoice when the work is done, the others asked for that stage are told too.",
    when: "'Award the framing to Ridge Framing', 'go with Lee Carpentry on the addition', 'take the lowest plumbing quote': award_quote with the project id, the contractor's name (or 'lowest') and the stage's words.",
    objects: ["project", "money"],
    effect: "message",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "award the framing to Ridge Framing", args: { projectId: "proj_1", contractor: "Ridge Framing", stage: "framing" } }],
  },
  description: "Award a stage's work to the contractor whose quote came in: the project id (find it first), the contractor's name ('lowest' for the lowest quote in) and the stage's words. They are told and the others asked for that stage are declined. Read back for a yes.",
  params: z.object({ projectId: ID, contractor: z.string().min(1).max(120), stage: z.string().max(80).nullable() }),
  payload: z.object({ quoteId: ID, words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    const r = await subsOf(actor.organizationId, p.one.id);
    let pool = r.quotes.filter((q) => q.status === "QUOTED");
    if (args.stage) {
      const w = args.stage.toLowerCase();
      pool = pool.filter((q) => q.stageName && (q.stageName.toLowerCase().includes(w) || w.split(/\s+/).some((x) => x.length > 3 && q.stageName!.toLowerCase().includes(x))));
    }
    if (!pool.length) return { ok: false, say: `No quote is in${args.stage ? ` for ${args.stage}` : ""} on ${p.one.name} to award.` };
    const want = args.contractor.toLowerCase().trim();
    const pick = /^(the )?lowest$/.test(want) ? pool.reduce((b, q) => ((q.amount ?? Infinity) < (b.amount ?? Infinity) ? q : b)) : pool.find((q) => q.contractorName.toLowerCase().includes(want) || want.includes(q.contractorName.toLowerCase()));
    if (!pick) return { ok: false, say: `${args.contractor} has no quote in${args.stage ? ` for ${args.stage}` : ""}. In: ${pool.map((q) => `${q.contractorName}${q.amount != null ? ` ${dollars(q.amount)}` : ""}`).join(", ")}.` };
    // Everyone else still asked or quoted for that stage is declined and told.
    const others = r.quotes.filter((q) => q.id !== pick.id && q.stageId === pick.stageId && (q.status === "ASKED" || q.status === "QUOTED"));
    const words = `Award ${pick.stageName ?? "the work"} on ${p.one.name} to ${pick.contractorName}${pick.amount != null ? ` (${dollars(pick.amount)}${pick.over && pick.overBy != null ? `, ${dollars(pick.overBy)} over the budget line` : ""})` : ""}`;
    return { ok: true, payload: { quoteId: pick.id, words }, readback: `${words}${others.length ? `; ${andList(others.map((q) => q.contractorName))} ${others.length === 1 ? "is" : "are"} told it went another way` : ""}?` };
  },
  async execute({ actor }, payload) {
    await awardQuote(actor.organizationId, payload.quoteId, actor.userId);
    const q = await db.projectSubQuote.findUnique({ where: { id: payload.quoteId }, select: { contractor: { select: { name: true } } } });
    return { say: `${payload.words} — done. ${q?.contractor.name ?? "They"} will send the invoice through their link when the work is done.`, result: { quoteId: payload.quoteId } };
  },
};

export const CONTRACTOR_TOOLS = [askQuotesTool, quotesTool, contractorsTool, awardQuoteTool] as const;
