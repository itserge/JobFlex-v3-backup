import "server-only";
// THE CAPABILITY REGISTRY (2026-11-06, the owner's spec §14): the one authoritative list of what the AI Operator
// can do, read from the tools' own cards (lib/assistant/tools) — never a hand-kept list. From it come:
//   · the model's tool list for a turn (modelTools): every live tool — not deprecated, not switched off, its outside
//     services configured — so a feature that shipped is in use the moment it deploys, and one that was retired or
//     switched off is never chosen for new work (what was already planned still runs; lib/assistant/engine);
//   · the prompt's "what you can do" (capabilityPrompt): each tool's own `when` line under its group — a new tool
//     needs no line written in the prompt by hand;
//   · the machine-readable definitions (capabilityRegistry) the admin console and the readiness check read: id,
//     version, purpose, objects, effect, how it runs, the permission and page, dependencies and their state, the
//     JSON schema the model gets, the samples the selection test uses.
// The kill switch is a SyncState row (`assistant:disabled`, a JSON list of tool names) the admin console writes, plus
// ASSISTANT_DISABLED_TOOLS in the environment — no deploy needed to switch a tool off.
import { zodFunction } from "openai/helpers/zod";
import type { z } from "zod";
import { db } from "@/lib/db";
import { TOOLS, TOOL_GROUPS, type AnyTool, type BusinessObject, type ToolDependency, type ToolEffect, type ToolGroup } from "@/lib/assistant/tools";
import type { Capability } from "@/lib/assistant/roles";
import { PAGE_OF } from "@/lib/assistant/actor";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { isMapsEnabled } from "@/lib/maps";
import { isSolarEnabled } from "@/lib/solar";
import { isRegridEnabled } from "@/lib/parcel";
import { isReportAllEnabled } from "@/lib/reportall";
import { isEagleViewEnabled } from "@/lib/eagleview";

export const DISABLED_KEY = "assistant:disabled";
const DISABLED_TTL_MS = 30_000;

export type CapabilityStatus = "live" | "off" | "missing a service" | "deprecated";

export interface CapabilityDef {
  id: string;
  version: number;
  since: string;
  label: string;
  purpose: string;
  when: string;
  group: ToolGroup;
  objects: readonly BusinessObject[];
  effect: ToolEffect;
  kind: "read" | "write";
  /** How it runs: at once (a read), after the person's yes, after the yes and their PIN, when it is due, or as a draft made without a yes. */
  runs: "at once" | "after a yes" | "after a yes and the PIN" | "when due" | "as a draft, at once" | "as a draft, in the background";
  permission: Capability;
  page: "calendar" | "workers" | null;
  deps: readonly ToolDependency[];
  missing: readonly ToolDependency[];
  disabled: boolean;
  deprecated: string | null;
  status: CapabilityStatus;
  /** The JSON schema the model is given for the arguments (strict function calling). */
  params: unknown;
  samples: ReadonlyArray<{ say: string; args: unknown }>;
  steps: readonly string[] | null;
}

/** Whether an outside service is configured on this deployment (Twilio's switch reads its settings, so it is async). */
export async function depOn(d: ToolDependency): Promise<boolean> {
  switch (d) {
    case "openai":
      return isOpenAIEnabled();
    case "twilio":
      return isTwilioEnabled();
    case "maps":
      return isMapsEnabled();
    case "solar":
      return isSolarEnabled();
    case "parcels":
      return isRegridEnabled() || isReportAllEnabled();
    case "eagleview":
      return isEagleViewEnabled();
  }
}

const ALL_DEPS: readonly ToolDependency[] = ["openai", "twilio", "maps", "solar", "parcels", "eagleview"];

/** Every service's state at once, asked once per call. */
export async function depStates(): Promise<Record<ToolDependency, boolean>> {
  const states = await Promise.all(ALL_DEPS.map(async (d) => [d, await depOn(d)] as const));
  return Object.fromEntries(states) as Record<ToolDependency, boolean>;
}

export const DEP_WORDS: Record<ToolDependency, string> = {
  openai: "the AI service (OPENAI_API_KEY)",
  twilio: "texting (Twilio)",
  maps: "Google Maps (GOOGLE_MAPS_API_KEY)",
  solar: "Google's aerial roof data (the Maps key with Solar on)",
  parcels: "a parcel provider (Regrid or ReportAll)",
  eagleview: "EagleView",
};

// ── the kill switch ───────────────────────────────────────────────────────────

let disabledCache: { at: number; names: Set<string> } | null = null;

function envDisabled(): string[] {
  return (process.env.ASSISTANT_DISABLED_TOOLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The tools switched off — by the admin console (SyncState) or the environment — read at most every 30 s. */
export async function disabledTools(): Promise<Set<string>> {
  if (disabledCache && Date.now() - disabledCache.at < DISABLED_TTL_MS) return disabledCache.names;
  const names = new Set<string>(envDisabled());
  try {
    const row = await db.syncState.findUnique({ where: { key: DISABLED_KEY }, select: { cursor: true } });
    const list = row?.cursor ? (JSON.parse(row.cursor) as unknown) : [];
    if (Array.isArray(list)) for (const n of list) if (typeof n === "string") names.add(n);
  } catch {
    /* the table may be missing on a bare stand; the environment's list stands */
  }
  disabledCache = { at: Date.now(), names };
  return names;
}

/** Switch a tool off or back on without a deploy (the admin console). A tool the environment switched off stays off. */
export async function setToolDisabled(name: string, off: boolean): Promise<Set<string>> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No such tool: ${name}`);
  const row = await db.syncState.findUnique({ where: { key: DISABLED_KEY }, select: { cursor: true } }).catch(() => null);
  const current = new Set<string>();
  try {
    const list = row?.cursor ? (JSON.parse(row.cursor) as unknown) : [];
    if (Array.isArray(list)) for (const n of list) if (typeof n === "string") current.add(n);
  } catch {
    /* start clean */
  }
  if (off) current.add(name);
  else current.delete(name);
  const cursor = JSON.stringify([...current].sort());
  await db.syncState.upsert({ where: { key: DISABLED_KEY }, create: { key: DISABLED_KEY, cursor }, update: { cursor } });
  disabledCache = null;
  return disabledTools();
}

/** Whether this tool may be chosen for new work right now. */
export async function toolOff(name: string): Promise<boolean> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return true;
  if (tool.card.deprecated) return true;
  const on = await depStates();
  if ((tool.card.deps ?? []).some((d) => !on[d])) return true;
  return (await disabledTools()).has(name);
}

/** The tools the model is shown this turn: live ones only. */
export async function modelTools(): Promise<AnyTool[]> {
  const [off, on] = await Promise.all([disabledTools(), depStates()]);
  return TOOLS.filter((t) => !t.card.deprecated && !off.has(t.name) && !(t.card.deps ?? []).some((d) => !on[d]));
}

// ── the definitions ───────────────────────────────────────────────────────────

function runsOf(t: AnyTool): CapabilityDef["runs"] {
  if (t.kind === "read") return "at once";
  if (t.instant === "now") return "as a draft, at once";
  if (t.instant === "background") return "as a draft, in the background";
  if (t.scheduled) return "when due";
  return t.card.effect === "money" ? "after a yes and the PIN" : "after a yes";
}

/** The JSON schema the model gets for a tool's arguments — OpenAI's own strict rendering of the zod object. */
export function paramsSchema(t: AnyTool): unknown {
  const f = zodFunction({ name: t.name, description: t.description, parameters: t.params as unknown as z.ZodObject<z.ZodRawShape> });
  return (f as unknown as { function: { parameters: unknown } }).function.parameters;
}

export async function capabilityRegistry(): Promise<CapabilityDef[]> {
  const [off, on] = await Promise.all([disabledTools(), depStates()]);
  return TOOLS.map((t) => {
    const deps = t.card.deps ?? [];
    const missing = deps.filter((d) => !on[d]);
    const disabled = off.has(t.name);
    const status: CapabilityStatus = t.card.deprecated ? "deprecated" : disabled ? "off" : missing.length ? "missing a service" : "live";
    return {
      id: t.name,
      version: t.card.version,
      since: t.card.since,
      label: t.card.label,
      purpose: t.card.purpose,
      when: t.card.when,
      group: t.card.group,
      objects: t.card.objects,
      effect: t.card.effect,
      kind: t.kind,
      runs: runsOf(t),
      permission: t.need,
      page: PAGE_OF[t.need] ?? null,
      deps,
      missing,
      disabled,
      deprecated: t.card.deprecated ?? null,
      status,
      params: paramsSchema(t),
      samples: t.card.samples,
      steps: t.card.steps ?? null,
    };
  });
}

// ── the prompt ────────────────────────────────────────────────────────────────

const GROUP_HEAD: Record<ToolGroup, string> = {
  lookups: "LOOK THINGS UP",
  people: "PEOPLE",
  visits: "VISITS",
  schedule: "THE SCHEDULE",
  crew: "THE CREW",
  proposals: "PROPOSALS",
  money: "MONEY",
  reminders: "REMINDERS",
  estimates: "ESTIMATES",
  projects: "PROJECTS",
};

/** What holds across a group's tools — the rules a single tool's line can't carry. Per group, never per tool. */
const GROUP_GUIDE: Partial<Record<ToolGroup, readonly string[]>> = {
  lookups: ["Look things up before you answer; names, ids, dates, counts and money come only from these."],
  people: ["Find first; never add a person twice."],
  visits: ["A visit is an appointment with a client or a lead; a job is the crew's work (schedule_job)."],
  money: ["Invoices, financing links and payments recorded to subs ask the person for their PIN with the yes."],
  estimates: [
    "A build saves a DRAFT proposal; nothing goes to the client until they say yes to sending it. 'Send it' means send_proposal for the newest one built.",
    "A build needs the size. A deck: width and depth. Other jobs: the quantities that set the price and the main material. If that is missing, ask ONE short question for all of it — the estimator fills in the rest. When they name a client or a lead, find them first and pass the id; if nobody matches, build without one.",
    "Don't repeat a build's price, lines or link — the person already has them.",
  ],
  projects: [
    "A project is a remodel run as stages (Footings, Framing, Decking…) with tasks inside each; find it by its name, client or number (find, kind project).",
    "Subcontractors (subs) work on a project's stages: requests for quotes, quotes, signed contracts and their invoices live on the project. Pass the sub's name as the person said it; the tools match it.",
  ],
};

/** The prompt's "what you can do": each live tool's own line under its group, in the groups' order. */
export function capabilityPrompt(tools: readonly AnyTool[]): string {
  const lines: string[] = ["WHAT YOU CAN DO (each line: the tool — when to use it)"];
  for (const g of TOOL_GROUPS) {
    const mine = tools.filter((t) => t.card.group === g);
    if (!mine.length) continue;
    lines.push(GROUP_HEAD[g]);
    for (const guide of GROUP_GUIDE[g] ?? []) lines.push(`- ${guide}`);
    for (const t of mine) lines.push(`- ${t.name}: ${t.card.when}`);
  }
  return lines.join("\n");
}
