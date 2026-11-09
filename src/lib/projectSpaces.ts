// THE PROJECT WORKSPACES (owner, 2026-11-09: "when you click the button projects, it should show cards for new home
// builders, for remodelers, or just a job project. And you select and it should look like a different platform
// specially made for it. Because in a short future we will separate remodelers and new home builders as different
// subscriptions"). Three workspaces over the one project book: each is a view of the projects of its kind, with its
// own name, colour, picture and road — never a second app, never a second copy of the data. Pure: the pages, the
// phone, the project page and the checks read one definition.
//
// ACCESS: `spaceOpen` is the one place a workspace is opened or closed. It answers yes for every company today
// (nothing is sold separately yet). When the owner prices them, it follows the Deck Studio add-on (lib/deckAddon,
// lib/editions): a second line on the same subscription, a preview without it, the whole workspace in the trial.

import { kindOf, parseAnswers, type ProjectKind } from "@/lib/projectKind";
import { JOB_TEMPLATE_KEYS } from "@/lib/projectStages/shared";

export const SPACE_IDS = ["build", "remodel", "jobs"] as const;
export type SpaceId = (typeof SPACE_IDS)[number];

export interface Space {
  id: SpaceId;
  /** The kind a project made in this workspace is. */
  kind: ProjectKind;
  /** "New Home Builder" — the card's and the header's name. */
  name: string;
  /** "JobFlex Build" — the workspace's own brand line. */
  brand: string;
  /** "builds" — what its projects are called, plural and one. */
  plural: string;
  one: string;
  /** One line on the chooser's card. */
  tagline: string;
  /** What the workspace adds, three short items on the card. */
  adds: readonly string[];
  /** The empty workspace's line. */
  empty: string;
  /** Its colour (a hex the CSS reads as --space). Chosen to never mean good or bad: teal, violet, the JobFlex blue. */
  color: string;
  /** A light wash of it for bands. */
  wash: string;
}

export const SPACES: Record<SpaceId, Space> = {
  build: {
    id: "build",
    kind: "NEW_BUILD",
    name: "New Home Builder",
    brand: "JobFlex Build",
    plural: "builds",
    one: "build",
    tagline: "From the lot to the keys.",
    adds: ["Lot, permits and utilities", "Phases with inspections", "Lender draws"],
    empty: "No builds yet. Start one with the lot and the answers you know; the phases are laid out for you.",
    color: "#0e6b67",
    wash: "rgba(14, 107, 103, 0.08)",
  },
  remodel: {
    id: "remodel",
    kind: "REMODEL",
    name: "Remodeler",
    brand: "JobFlex Remodel",
    plural: "remodels",
    one: "remodel",
    tagline: "The house stands, and the family often lives in it.",
    adds: ["Client picks and allowances", "Change orders", "Living-in-place tasks"],
    empty: "No remodels yet. Start one from a kitchen, bath, addition or whole-house template.",
    color: "#5a3fa8",
    wash: "rgba(90, 63, 168, 0.08)",
  },
  jobs: {
    id: "jobs",
    kind: "JOB",
    name: "Job Projects",
    brand: "JobFlex Jobs",
    plural: "job projects",
    one: "job project",
    tagline: "One trade, bigger than a visit: a deck, a roof, a fence, a new system.",
    adds: ["Stages from the trade's template", "Materials and crew", "Payment when it's done"],
    empty: "No job projects yet. A sold deck, roof or fence proposal becomes one by itself, or start one here.",
    color: "#1854a0",
    wash: "rgba(24, 84, 160, 0.08)",
  },
};

export const isSpaceId = (v: unknown): v is SpaceId => typeof v === "string" && (SPACE_IDS as readonly string[]).includes(v);
export const parseSpace = (v: unknown): SpaceId | null => (isSpaceId(v) ? v : null);

/** The workspace a project lives in: its kind — and a remodel made from a trade's template (a deck, before job
 *  projects were their own kind) lives with the job projects. */
export function spaceOf(kind: unknown, answersJson?: string | null): SpaceId {
  const k = kindOf(kind);
  if (k === "NEW_BUILD") return "build";
  if (k === "JOB") return "jobs";
  const tpl = answersJson ? parseAnswers(answersJson).template : undefined;
  return tpl && JOB_TEMPLATE_KEYS.has(tpl) ? "jobs" : "remodel";
}

export const spaceHref = (id: SpaceId) => `/dashboard/projects?space=${id}`;

/** Whether the company may work in the workspace. Every workspace is open to everyone until the owner sells them
 *  separately; this is the one place that changes then. */
export function spaceOpen(id: SpaceId): boolean {
  return id in SPACES;
}

// ── the road ─────────────────────────────────────────────────────────────────
// Each workspace's work, in the order it happens, as the picture at the top of the workspace draws it: every
// project pinned on the step its current stage belongs to. A stage is placed by its words; one no step's words
// match goes on the step after the last one done.

export type RoadStep = { key: string; name: string; words: RegExp };

export const ROADS: Record<SpaceId, readonly RoadStep[]> = {
  build: [
    { key: "lot", name: "Lot & permits", words: /lot|land|survey|permit|design|plan|soft cost|clear|site|excavat|utilit/i },
    { key: "foundation", name: "Foundation", words: /foundation|footing|slab|basement|stem wall|backfill|waterproof/i },
    { key: "framing", name: "Framing", words: /fram|truss|sheathing|wall/i },
    { key: "dryin", name: "Dry-in", words: /dry.?in|roof|window|door|wrap|siding|exterior/i },
    { key: "rough", name: "Rough-ins", words: /rough|plumb|electric|hvac|mechanical|insulat/i },
    { key: "finish", name: "Finishes", words: /drywall|paint|trim|cabinet|counter|tile|floor|finish|fixture|appliance/i },
    { key: "keys", name: "Keys", words: /final|keys|walk.?through|occupancy|punch|close/i },
  ],
  remodel: [
    { key: "plan", name: "Plan & picks", words: /design|plan|permit|select|pick|order|material/i },
    { key: "demo", name: "Demo", words: /demo|tear|protect|prep/i },
    { key: "rough", name: "Rough-in", words: /rough|fram|plumb|electric|hvac|structur/i },
    { key: "close", name: "Close up", words: /insulat|drywall|close|tape|mud/i },
    { key: "finish", name: "Finish", words: /paint|trim|cabinet|counter|tile|floor|finish|fixture|install/i },
    { key: "done", name: "Punch & sign-off", words: /final|punch|walk.?through|sign.?off|clean/i },
  ],
  jobs: [
    { key: "ready", name: "Ready", words: /material|order|permit|confirm|design|811|prep/i },
    { key: "work", name: "The work", words: /footing|post|fram|tear|dry.?in|shingle|deck|rail|panel|gate|install|equipment|lay|set/i },
    { key: "final", name: "Final", words: /final|inspect|clean|walk|punch/i },
    { key: "paid", name: "Paid", words: /payment|paid|invoice|collect/i },
  ],
};

/** The road step a project is on: its current stage's, by its words; with every stage done, the last step; with
 *  none, the first. `doneSteps`: how many steps lie wholly behind it. */
export function roadStepOf(space: SpaceId, stage: { name: string | null; allDone: boolean } | null): number {
  const road = ROADS[space];
  if (!stage || (!stage.name && !stage.allDone)) return 0;
  if (stage.allDone) return road.length - 1;
  const i = road.findIndex((s) => s.words.test(stage.name ?? ""));
  return i >= 0 ? i : 0;
}
