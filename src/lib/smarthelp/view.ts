// Pure view logic for the SmartHelp panel: guide card order and per-step gating.
// Client-safe: must not import @/lib/orgContext (auth/db). Uses the pure route gates instead.
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { isCustomBlockedPath } from "@/lib/customPlan";
import { pathOf } from "./pages";
import type { Guide, GuideCard, HelpContext, HelpStep, StepView } from "./types";

/** Same one-line rule as roleMayOpen (lib/orgContext): no gate for the role -> allowed. */
function roleMayOpen(role: string | null, route: string): boolean {
  const gate = role ? ROLE_ROUTE_GATES[role] : undefined;
  return !gate || isPathAllowed(gate, route);
}

/** Setup guides still to do, then setup guides with no state, then done ones; "how" guides after. */
export function guideCards(guides: Guide[], ctx: HelpContext): GuideCard[] {
  const shown = guides.filter((g) => !g.feature || ctx.features[g.feature]);
  const card = (g: Guide, state: GuideCard["state"]): GuideCard => ({
    id: g.id,
    title: g.title,
    group: g.group,
    icon: g.icon,
    state,
  });
  const setup = shown.filter((g) => g.group === "setup");
  const todo = setup.filter((g) => g.needs && !ctx.setup[g.needs]).map((g) => card(g, "todo"));
  const none = setup.filter((g) => !g.needs).map((g) => card(g, "none"));
  const done = setup.filter((g) => g.needs && ctx.setup[g.needs]).map((g) => card(g, "done"));
  const how = shown.filter((g) => g.group === "how").map((g) => card(g, "none"));
  return [...todo, ...none, ...done, ...how];
}

/** A step with `blocked` set when the viewer's role or plan cannot open its page. Needs only those two. */
export function stepView(step: HelpStep, ctx: Pick<HelpContext, "role" | "lockedHrefs">): StepView {
  if (!step.open) return { ...step };
  const route = pathOf(step.open);
  if (!roleMayOpen(ctx.role, route)) return { ...step, blocked: "role" };
  if (isCustomBlockedPath(ctx.lockedHrefs, route)) return { ...step, blocked: "plan" };
  return { ...step };
}
