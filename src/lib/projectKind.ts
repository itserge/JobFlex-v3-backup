// WHAT KIND OF PROJECT (2026-11-07, the owner's plan "Projects: Remodel and New construction", part 1): every
// project is a Remodel — the house stands, and the client usually lives in it — or a New build — a lot, then a
// house, from the land to the keys. The kind picks the stage templates a project is offered and the question
// asked when it is made; as the plan ships it picks the inspections that gate a stage, the budget's kinds, the
// finish line and the Operator's words. Pure: the dialogs, the cards, the actions, the Operator and the checks
// read one definition.

import { parseBuildAnswers, type BuildAnswers } from "@/lib/projectPhases/shared";

export const PROJECT_KINDS = ["REMODEL", "NEW_BUILD"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const KIND_LABEL: Record<ProjectKind, string> = { REMODEL: "Remodel", NEW_BUILD: "New construction" };
/** The short tag on a card or a page head. */
export const KIND_TAG: Record<ProjectKind, string> = { REMODEL: "Remodel", NEW_BUILD: "New build" };
/** One line under each choice in the New project dialog. */
export const KIND_HINT: Record<ProjectKind, string> = {
  REMODEL: "The house stands: a kitchen, a bath, an addition, a whole house.",
  NEW_BUILD: "A lot, then a house: land, permits, foundation to the keys.",
};

export const isProjectKind = (v: unknown): v is ProjectKind => typeof v === "string" && (PROJECT_KINDS as readonly string[]).includes(v);
/** A stored value read tolerantly: anything odd is a remodel, which every project made before this is. */
export const kindOf = (v: unknown): ProjectKind => (isProjectKind(v) ? v : "REMODEL");

/** The questions asked when the project is made (Project.answersJson), each optional. */
export type ProjectAnswers = {
  /** A remodel: the client lives there during the work — the first on-site stage gets the living-in-place tasks. */
  occupied?: boolean;
  /** The template the stages came from, remembered for the budget's contingency rate. */
  template?: string;
  /** A new build's start questions (part 4, lib/projectPhases): sewer or septic, water or a well, the foundation,
   *  the stories, a garage, a shop, a lender, power, gas, fiber — the phases are shaped from them. */
  build?: BuildAnswers;
};

export function parseAnswers(json: string | null | undefined): ProjectAnswers {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return {};
    const out: ProjectAnswers = {};
    if (typeof raw.occupied === "boolean") out.occupied = raw.occupied;
    if (typeof raw.template === "string" && raw.template) out.template = raw.template.slice(0, 40);
    if (raw.build && typeof raw.build === "object") {
      const b = parseBuildAnswers(raw.build);
      if (Object.keys(b).length) out.build = b;
    }
    return out;
  } catch {
    return {};
  }
}

/** Nothing answered is stored as nothing. */
export const serializeAnswers = (a: ProjectAnswers): string | null => (Object.keys(a).length ? JSON.stringify(a) : null);

// ── Living in place (a remodel preset) ───────────────────────────────────────
// What a crew does in a house the client lives in, as tasks on the first stage that works on site. Added when the
// project says the house is occupied; the ones a template already has (by their first words) are not added twice.

export const LIVING_IN_PLACE_TASKS: readonly string[] = [
  "Agree the working hours and the days with the client",
  "Protect the floors, the doorways and the furniture",
  "Dust walls and a zip door on the work area",
  "Keep a bathroom and the kitchen sink working, or set up a temporary one",
  "Clean up at the end of every day",
];

const STOP = new Set(["the", "a", "an", "and", "of", "with", "on", "at"]);
const taskKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .slice(0, 2)
    .join(" ");

/** The living-in-place tasks a stage still needs, given the titles it has. */
export function livingInPlaceTasks(existing: readonly string[]): string[] {
  const have = new Set(existing.map(taskKey));
  return LIVING_IN_PLACE_TASKS.filter((t) => !have.has(taskKey(t)));
}

/** The first stage that works in the house — demolition, prep, tear-off, install, site, framing — else the first. */
export function onSiteStageIndex(stageNames: readonly string[]): number {
  const i = stageNames.findIndex((n) => /demolition|\bprep\b|tear|install|\bsite\b|framing|slab|posts|footings/i.test(n));
  return i >= 0 ? i : 0;
}
