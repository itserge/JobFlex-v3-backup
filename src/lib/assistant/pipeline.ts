import "server-only";
// THE PIPELINE, FOR THE OPERATOR (Smart CRM part 3, 2026-11-08): "who do I need to call today", "which deals are at
// risk", "how are the Facebook leads doing" — read from the same board and report the Pipeline page draws; and
// "move the Lee deck to negotiation" — move_deal, read back and done on a yes.

import { z } from "zod";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { money } from "@/lib/assistant/shared";
import { cardRefusal, moveDeal, readPipeline, readSourceReport } from "@/lib/pipeline/server";
import { proposalScope } from "@/lib/assistant/actor";
import { STAGES, STAGE_KEYS, type Stage } from "@/lib/pipeline/shared";

const stageLabel = (s: string) => STAGES.find((x) => x.key === s)?.label ?? s;
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const pipeline: ReadTool<{ which: "today" | "risk" | "stage"; stage: Stage | null }> = {
  kind: "read",
  name: "pipeline",
  need: "clients.read",
  card: {
    label: "Pipeline",
    purpose: "The sales pipeline: the deals to work today with their next step, the ones at risk and why, or one stage's cards.",
    when: "'Who do I need to call today', 'which deals are at risk', 'what's in negotiation': pipeline(which, stage). Say each deal's next step and its reason as given.",
    objects: ["lead", "proposal", "client", "money"],
    effect: "read",
    group: "proposals",
    version: 1,
    since: "2026-11-08",
    samples: [
      { say: "who do I need to call today?", args: { which: "today", stage: null } },
      { say: "which deals are at risk?", args: { which: "risk", stage: null } },
    ],
  },
  description:
    "The pipeline board (leads not yet quoted and proposals). which = today (the open deals with the most urgent next step first), risk (medium and high risk deals with the reasons), stage (one stage's cards — NEW, CONTACTED, VISIT, ESTIMATING, SENT, NEGOTIATION, WON, LOST). Each deal comes with its value, source, risk and next step.",
  params: z.object({
    which: z.enum(["today", "risk", "stage"]),
    stage: z.enum(STAGE_KEYS as unknown as [Stage, ...Stage[]]).nullable().describe("the stage for which = stage; else null"),
  }),
  async run({ actor, now }, args) {
    const cards = await readPipeline(actor.organizationId, { now, tz: actor.timezone, onlyProposalsOf: proposalScope(actor).ownerId ?? null });
    const open = cards.filter((c) => c.stage !== "WON" && c.stage !== "LOST");
    const pick =
      args.which === "risk" ? open.filter((c) => c.risk.level !== "LOW") : args.which === "stage" && args.stage ? cards.filter((c) => c.stage === args.stage) : open.filter((c) => c.next).slice(0, 10);
    return {
      openValue: money(open.reduce((a, c) => a + (c.value ?? 0), 0)),
      count: pick.length,
      deals: pick.slice(0, 12).map((c) => `${c.name} — ${c.title}${c.value ? ` (${money(c.value)})` : ""} · ${stageLabel(c.stage)} · ${c.source.short}${c.risk.level !== "LOW" ? ` · ${c.risk.level.toLowerCase()} risk: ${c.risk.reasons.join("; ")}` : ""}${c.next ? ` · next: ${c.next}` : ""}`),
      page: "/dashboard/pipeline",
    };
  },
};

const leadSources: ReadTool<{ days: number }> = {
  kind: "read",
  name: "lead_sources",
  // The company's money by source: the office's (the page shows it to office roles only).
  need: "money.read",
  card: {
    label: "Lead sources",
    purpose: "Which lead sources turn into paid work: leads, contacted, visits, estimates, won, money collected, first-reply time, and cost per job where spend was entered.",
    when: "'How many Facebook leads this month', 'how much came from Facebook leads', 'which source is best': lead_sources(days). Never estimate ad cost — cost per job only where the company entered its spend.",
    objects: ["lead", "money"],
    effect: "read",
    group: "lookups",
    version: 1,
    since: "2026-11-08",
    samples: [{ say: "how did the Facebook leads do this month?", args: { days: 30 } }],
  },
  description:
    "Every lead source over the last N days: leads, contacted, visits, estimates sent, won, won value, money collected, the median minutes to first contact, and — only where the company entered its monthly spend on that source — cost per lead and per won job.",
  params: z.object({ days: z.number().int().min(7).max(365).describe("how many days back, e.g. 30 for this month") }),
  async run({ actor, now }, args) {
    const rows = await readSourceReport(actor.organizationId, args.days, now);
    return {
      days: args.days,
      sources: rows.map((r) => `${r.label}: ${count(r.leads, "lead")}, ${r.contacted} contacted, ${count(r.visits, "visit")}, ${count(r.estimates, "estimate")}, ${r.won} won (${money(r.wonValue)}), ${money(r.collected)} collected${r.medianReplyMin !== null ? `, first reply ~${r.medianReplyMin < 90 ? `${r.medianReplyMin} min` : `${Math.round(r.medianReplyMin / 60)} h`}` : ""}${r.costPerJob !== null ? `, ${money(r.costPerJob)} per won job` : ""}`),
      page: "/dashboard/pipeline?view=sources",
    };
  },
};

const moveArgs = z.object({
  name: z.string().min(1).max(120).describe("the client's or lead's name on the card"),
  stage: z.enum(STAGE_KEYS as unknown as [Stage, ...Stage[]]),
  reason: z.string().max(200).nullable().describe("why it was lost, for LOST; else null"),
});
type MoveArgs = z.infer<typeof moveArgs>;
const movePayload = moveArgs.extend({ key: z.string() });

const moveTool: WriteTool<MoveArgs, z.infer<typeof movePayload>> = {
  kind: "write",
  name: "move_deal",
  need: "clients.write",
  card: {
    label: "Move a deal",
    purpose: "Move a pipeline card to another stage (Negotiation, Lost with a reason…) — read back, done on a yes. A proposal is never signed or declined by a move.",
    when: "'Move the Lee deck to negotiation', 'Hartwell is lost — went with someone cheaper': move_deal(name, stage, reason).",
    objects: ["lead", "proposal"],
    effect: "record",
    group: "proposals",
    version: 1,
    since: "2026-11-08",
    samples: [{ say: "Hartwell is lost, they went with someone cheaper", args: { name: "Hartwell", stage: "LOST", reason: "Went with someone cheaper" } }],
  },
  description: "Move one pipeline card (a lead or a proposal, found by the client's or lead's name) to a stage. For LOST pass the reason. A lead's own status follows for Contacted, Won and Lost; a proposal is never accepted or declined by this.",
  params: moveArgs,
  payload: movePayload,
  async plan({ actor, now }, args) {
    const cards = await readPipeline(actor.organizationId, { now, tz: actor.timezone, onlyProposalsOf: proposalScope(actor).ownerId ?? null });
    const q = args.name.trim().toLowerCase();
    const named = cards.filter((c) => c.name.toLowerCase().includes(q));
    const hits = named.filter((c) => c.stage !== args.stage);
    if (!named.length) return { ok: false, say: `No card for ${args.name} on your pipeline.` };
    if (!hits.length) return { ok: false, say: `${named[0].name} is already in ${stageLabel(args.stage)}.` };
    if (hits.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 3).map((c, i) => `${i + 1}. ${c.name} — ${c.title} (${stageLabel(c.stage)})`).join(" ")}` };
    const c = hits[0];
    const no = await cardRefusal(actor.organizationId, c.key, { userId: actor.userId, role: actor.role });
    if (no) return { ok: false, say: no };
    return { ok: true, payload: { ...args, key: c.key }, readback: `Move ${c.name} — ${c.title} from ${stageLabel(c.stage)} to ${stageLabel(args.stage)}${args.stage === "LOST" && args.reason ? ` (lost: ${args.reason})` : ""}.` };
  },
  async execute({ actor }, p) {
    const no = await cardRefusal(actor.organizationId, p.key, { userId: actor.userId, role: actor.role });
    if (no) return { say: no };
    const r = await moveDeal(actor.organizationId, p.key, p.stage, actor.userId, p.reason);
    return { say: r.ok ? `Moved to ${stageLabel(p.stage)}.` : `Not moved: ${r.error}` };
  },
};

export const PIPELINE_TOOLS = [pipeline, leadSources, moveTool] as const;
