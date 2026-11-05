// WHAT THE CALENDAR SHOWS (owner, 2026-11-04: "if the calendar is too busy with all kinds of appointments and
// installs, that way I would separate it" — the SmartSpace lanes, and "above the calendar you can mark the projects").
// One set of rules for the desktop grid (calendar-behavior) and the handheld build (mobile-calendar-v2):
//
//   Projects     — job visits whose job belongs to a project;
//   Installs     — every other job visit;
//   Appointments — estimate visits;
//   All          — everything, blocked time and the AI desk's hours included.
//
// Picked projects narrow the grid to those projects' jobs. The lane and the picks stick per browser — a convenience,
// so every read and write may fail quietly and the calendar opens on All.
export type Lane = "all" | "projects" | "appointments" | "installs";
export const LANES: Array<[Lane, string]> = [
  ["all", "All"],
  ["projects", "Projects"],
  ["appointments", "Appointments"],
  ["installs", "Installs"],
];

const LANE_KEY = "jf-cal-lane";
const PROJ_KEY = "jf-cal-projects";

export function readPick(): { lane: Lane; projects: string[] } {
  try {
    const l = window.localStorage.getItem(LANE_KEY);
    const p: unknown = JSON.parse(window.localStorage.getItem(PROJ_KEY) || "[]");
    return {
      lane: LANES.some(([k]) => k === l) ? (l as Lane) : "all",
      projects: Array.isArray(p) ? p.filter((x): x is string => typeof x === "string").slice(0, 40) : [],
    };
  } catch {
    return { lane: "all", projects: [] };
  }
}

export function savePick(lane: Lane, projects: string[]): void {
  try {
    window.localStorage.setItem(LANE_KEY, lane);
    window.localStorage.setItem(PROJ_KEY, JSON.stringify(projects));
  } catch {
    /* private mode — the pick lasts until the page closes */
  }
}

/** Does the event belong to the lane and the picked projects? */
export function shownBy(e: { kind: string; projectId?: string | null }, lane: Lane, projects: readonly string[]): boolean {
  if (lane === "projects" && !(e.kind === "job" && e.projectId)) return false;
  if (lane === "installs" && !(e.kind === "job" && !e.projectId)) return false;
  if (lane === "appointments" && e.kind !== "appointment") return false;
  if (projects.length && (!e.projectId || !projects.includes(e.projectId))) return false;
  return true;
}
