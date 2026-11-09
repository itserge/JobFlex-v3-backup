// THE WORKSPACES' NUMBERS (2026-11-09, lib/projectSpaces): what the Projects chooser's three cards and each workspace's
// road show, from the project book the page already read. Pure, so the desk page, the phone and the checks agree.

import { ROADS, SPACE_IDS, roadStepOf, spaceOf, type SpaceId } from "@/lib/projectSpaces";
import { projectFlags, type Project } from "./projects-data";

/** A list flag that means the project is at risk, not just waiting on someone. */
const RISK = new Set(["over", "loss", "problem", "late", "late-delivery", "selection-late"]);
const isRisk = (f: { kind: string; text: string }) => RISK.has(f.kind) || (f.kind === "inspection" && /failed/i.test(f.text));

export const spaceOfRow = (p: Project): SpaceId => p.space ?? spaceOf(p.kind);
const working = (p: Project) => p.status === "ACTIVE" || p.status === "ON_HOLD";

export type SpaceSummary = {
  id: SpaceId;
  active: number;
  needsYou: number;
  atRisk: number;
  done: number;
  /** The worst row: the project and its first flag. */
  worst: { id: string; name: string; text: string; risk: boolean } | null;
};

export function spaceSummaries(rows: readonly Project[]): Record<SpaceId, SpaceSummary> {
  const out = Object.fromEntries(SPACE_IDS.map((id) => [id, { id, active: 0, needsYou: 0, atRisk: 0, done: 0, worst: null }])) as Record<SpaceId, SpaceSummary>;
  for (const p of rows) {
    const s = out[spaceOfRow(p)];
    if (p.status === "COMPLETED") {
      s.done++;
      continue;
    }
    if (!working(p)) continue;
    s.active++;
    const flags = projectFlags(p);
    if (!flags.length) continue;
    s.needsYou++;
    const risk = flags.some(isRisk);
    if (risk) s.atRisk++;
    if (!s.worst || (risk && !s.worst.risk)) s.worst = { id: p.id, name: p.name, text: flags[0].text, risk };
  }
  return out;
}

/** Across every workspace: the projects that need someone today, at-risk first, one line each. */
export function needsToday(rows: readonly Project[], max = 6): Array<{ id: string; name: string; space: SpaceId; text: string; more: number; risk: boolean }> {
  return rows
    .filter(working)
    .map((p) => ({ p, flags: projectFlags(p) }))
    .filter((x) => x.flags.length)
    .map((x) => ({ id: x.p.id, name: x.p.name, space: spaceOfRow(x.p), text: x.flags[0].text, more: x.flags.length - 1, risk: x.flags.some(isRisk) }))
    .sort((a, b) => Number(b.risk) - Number(a.risk))
    .slice(0, max);
}

export type RoadPin = { id: string; name: string; risk: boolean; done: number | null };

/** The workspace's road with every working project pinned on the step it is on. */
export function roadPins(space: SpaceId, rows: readonly Project[]): Array<{ key: string; name: string; pins: RoadPin[] }> {
  const road = ROADS[space];
  const steps = road.map((s) => ({ key: s.key, name: s.name, pins: [] as RoadPin[] }));
  for (const p of rows) {
    if (spaceOfRow(p) !== space || !working(p)) continue;
    const allDone = (p.stageCount ?? 0) > 0 && !p.stageNow;
    const i = roadStepOf(space, { name: p.stageNow ?? null, allDone });
    steps[i].pins.push({ id: p.id, name: p.name, risk: projectFlags(p).some(isRisk), done: p.done ?? null });
  }
  for (const s of steps) s.pins.sort((a, b) => Number(b.risk) - Number(a.risk));
  return steps;
}
