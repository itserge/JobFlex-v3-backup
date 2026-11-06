import "server-only";
// THE AI OPERATOR'S READINESS (2026-11-06, the owner's spec §17): what the admin console shows and the hourly check
// records — every capability's state (live, off, missing a service, deprecated), its runs and failures in the last
// day and week, its last error, the services the registry leans on, and the deployment this registry came with.
// Nothing here is synthesised: the counts are AssistantAction rows, the states are the registry's.
import { db } from "@/lib/db";
import { capabilityRegistry, DEP_WORDS, depStates, type CapabilityDef, type CapabilityStatus } from "@/lib/assistant/registry";
import type { ToolDependency } from "@/lib/assistant/tools";
import { logServerError } from "@/lib/server-events";

export const READINESS_KEY = "assistant:readiness";
const DAY_MS = 86_400_000;

export interface ToolHealth {
  id: string;
  label: string;
  group: CapabilityDef["group"];
  version: number;
  since: string;
  status: CapabilityStatus;
  runs: CapabilityDef["runs"];
  effect: CapabilityDef["effect"];
  permission: string;
  deps: readonly ToolDependency[];
  missing: readonly ToolDependency[];
  disabled: boolean;
  deprecated: string | null;
  done7d: number;
  failed7d: number;
  done24h: number;
  failed24h: number;
  lastRunAt: string | null;
  lastError: { at: string; text: string } | null;
}

export interface OperatorReadiness {
  generatedAt: string;
  deployment: { sha: string | null; env: string | null };
  services: Array<{ dep: ToolDependency; label: string; on: boolean; toolsNeeding: number }>;
  tools: ToolHealth[];
  totals: { live: number; off: number; missing: number; deprecated: number };
  /** What a platform admin should look at: a failing tool, a service a tool needs, a tool switched off by the environment. */
  warnings: string[];
}

const DEPS: readonly ToolDependency[] = ["openai", "twilio", "maps", "solar", "parcels", "eagleview"];

export async function operatorReadiness(now = new Date()): Promise<OperatorReadiness> {
  const [registry, on] = await Promise.all([capabilityRegistry(), depStates()]);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since1 = new Date(now.getTime() - DAY_MS);
  const [week, day, failures, lastRuns] = await Promise.all([
    db.assistantAction.groupBy({ by: ["tool", "status"], where: { createdAt: { gte: since7 } }, _count: { _all: true } }).catch(() => []),
    db.assistantAction.groupBy({ by: ["tool", "status"], where: { createdAt: { gte: since1 } }, _count: { _all: true } }).catch(() => []),
    db.assistantAction.findMany({ where: { status: "FAILED", createdAt: { gte: since7 } }, orderBy: { updatedAt: "desc" }, take: 200, select: { tool: true, error: true, updatedAt: true } }).catch(() => []),
    db.assistantAction.findMany({ where: { status: "DONE" }, orderBy: { updatedAt: "desc" }, distinct: ["tool"], select: { tool: true, updatedAt: true } }).catch(() => []),
  ]);
  const count = (rows: Array<{ tool: string; status: string; _count: { _all: number } }>, tool: string, status: string) => rows.find((r) => r.tool === tool && r.status === status)?._count._all ?? 0;
  const lastErrorOf = new Map<string, { at: string; text: string }>();
  for (const f of failures) if (!lastErrorOf.has(f.tool)) lastErrorOf.set(f.tool, { at: f.updatedAt.toISOString(), text: f.error ?? "" });
  const lastRunOf = new Map(lastRuns.map((r) => [r.tool, r.updatedAt.toISOString()]));
  const warnings: string[] = [];
  const tools: ToolHealth[] = registry.map((c) => {
    const t: ToolHealth = {
      id: c.id,
      label: c.label,
      group: c.group,
      version: c.version,
      since: c.since,
      status: c.status,
      runs: c.runs,
      effect: c.effect,
      permission: c.permission,
      deps: c.deps,
      missing: c.missing,
      disabled: c.disabled,
      deprecated: c.deprecated,
      done7d: count(week, c.id, "DONE"),
      failed7d: count(week, c.id, "FAILED"),
      done24h: count(day, c.id, "DONE"),
      failed24h: count(day, c.id, "FAILED"),
      lastRunAt: lastRunOf.get(c.id) ?? null,
      lastError: lastErrorOf.get(c.id) ?? null,
    };
    const ran24 = t.done24h + t.failed24h;
    if (ran24 >= 3 && t.failed24h * 2 > ran24) warnings.push(`${c.label} (${c.id}) failed ${t.failed24h} of ${ran24} runs in the last day${t.lastError ? ` — last: ${t.lastError.text.slice(0, 120)}` : ""}.`);
    if (c.missing.length) warnings.push(`${c.label} (${c.id}) is off everywhere: ${c.missing.map((d) => DEP_WORDS[d]).join(", ")} not configured.`);
    return t;
  });
  const envOff = (process.env.ASSISTANT_DISABLED_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (envOff.length) warnings.push(`Switched off by the environment (ASSISTANT_DISABLED_TOOLS): ${envOff.join(", ")}.`);
  const services = DEPS.map((dep) => ({ dep, label: DEP_WORDS[dep], on: on[dep], toolsNeeding: registry.filter((c) => c.deps.includes(dep)).length }));
  return {
    generatedAt: now.toISOString(),
    deployment: { sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null, env: process.env.VERCEL_ENV ?? null },
    services,
    tools,
    totals: {
      live: tools.filter((t) => t.status === "live").length,
      off: tools.filter((t) => t.status === "off").length,
      missing: tools.filter((t) => t.status === "missing a service").length,
      deprecated: tools.filter((t) => t.status === "deprecated").length,
    },
    warnings,
  };
}

/** The hourly record (the minute job, lib/assistant/runner): the summary kept in SyncState for the console's "last
 *  check", and each warning sent to the error log so it shows on /admin/health and in the alerts. */
export async function recordReadiness(now = new Date()): Promise<{ warnings: number }> {
  const r = await operatorReadiness(now);
  const summary = { at: r.generatedAt, deployment: r.deployment, totals: r.totals, warnings: r.warnings.slice(0, 20) };
  const cursor = JSON.stringify(summary);
  await db.syncState.upsert({ where: { key: READINESS_KEY }, create: { key: READINESS_KEY, cursor }, update: { cursor } }).catch(() => null);
  for (const w of r.warnings) logServerError("assistant.readiness", new Error(w), { kind: "cron" });
  return { warnings: r.warnings.length };
}

/** The last hourly record, for the console's header. */
export async function lastReadiness(): Promise<{ at: string; totals: OperatorReadiness["totals"]; warnings: string[]; deployment: OperatorReadiness["deployment"] } | null> {
  const row = await db.syncState.findUnique({ where: { key: READINESS_KEY }, select: { cursor: true } }).catch(() => null);
  if (!row?.cursor) return null;
  try {
    return JSON.parse(row.cursor) as { at: string; totals: OperatorReadiness["totals"]; warnings: string[]; deployment: OperatorReadiness["deployment"] };
  } catch {
    return null;
  }
}
