// THE FIRST-ESTIMATE TOUR (2026-10-26) — one path per estimator, from the
// sidebar to a created proposal on the Send screen. Read by the tour on the
// client (components/v3/onboarding-tour) and by the server only for the path
// ids and step counts (lib/onboarding/progress, actions/onboarding).
//
// A step is passed when the person has DONE it — the address typed, the roof
// measured, the proposal created — read off the page itself: the same moments
// the estimators report to activation-events, seen from the client. Steps with
// nothing to do (read the numbers, keep the default package) carry `next`, and
// only those are passed by the Next button. Every target is a `data-tour`
// attribute on the real element, on the desk and in the handheld markup; the
// first VISIBLE target in the list is the one lit (the drawer's link, or the
// menu button while the drawer is closed).

export type TourPathId = "roof" | "fence" | "hvac" | "smart" | "deck" | "manual";
export type TourId = "first_estimate" | "next_steps";

export type TourCtx = {
  pathname: string;
  search: string;
  doc: Document;
  /** The person clicked, typed or changed something inside the lit target. */
  interacted: boolean;
};

export type TourStep = {
  /** Analytics key (tour_step {path, step}) — stable, never an index. */
  id: string;
  title: string;
  body: string;
  /** Said instead of `body` when the lit target is the handheld menu button. */
  menuBody?: string;
  /** Said instead of `body` at ≤768px, when the phone's controls differ. */
  handheldBody?: string;
  /** Shown while no target is on the page (a measurement running). */
  waiting?: string;
  /** Where the step lives (a pathname prefix); null = any dashboard page. */
  route: string | null;
  /** data-tour names, first visible wins. */
  targets: string[];
  /** A target taller than the screen is scrolled to its foot (the price card's Convert) instead of its head. */
  align?: "end";
  /** At ≤768px, when the phone's own control is better lit than the desk's card (a sticky price card's button). */
  handheldTargets?: string[];
  done: (ctx: TourCtx) => boolean;
  /** Nothing to listen for — the Next button passes the step. */
  next?: boolean;
  /** A step that only some pages need (the roof's pitch): skipped unless true. */
  when?: (ctx: TourCtx) => boolean;
  /** A `when` step most people do take (the HVAC job): counted in "2 of 5". */
  counted?: boolean;
};

export type TourPath = {
  id: TourPathId;
  /** "Create your first {noun} estimate". */
  noun: string;
  /** Where Start / Continue goes when the step has no route of its own. */
  home: string;
  steps: TourStep[];
};

const q = (doc: Document, name: string) => doc.querySelector<HTMLElement>(`[data-tour="${name}"]`);

/** On the page and drawn: not display:none, not inside a hidden step. */
export function isShown(el: Element | null): el is HTMLElement {
  return !!el && (el as HTMLElement).getClientRects().length > 0 && !el.closest("[hidden], .is-hidden");
}
const shown = (doc: Document, name: string) => {
  for (const el of doc.querySelectorAll(`[data-tour="${name}"]`)) if (isShown(el)) return true;
  return false;
};

/** The estimators all land a new proposal on the builder (`/dashboard/proposals/<id>` redirects there). */
const onProposal = ({ pathname, search }: TourCtx) =>
  (pathname === "/dashboard/manual-blueprint" && /[?&]proposal=/.test(search)) ||
  /^\/dashboard\/proposals\/[^/]+$/.test(pathname);

/** A typed value the person has left (a field still being typed in is not done). */
const typedAndLeft = (doc: Document, field: HTMLInputElement | HTMLTextAreaElement | null | undefined, min: number) =>
  !!field && field.value.trim().length >= min && doc.activeElement !== field;

/** `name` is the sidebar row's own words; "the" goes before an estimator, not before Smart Proposal. */
function navStep(href: string, name: string, why: string, article = "the "): TourStep {
  return {
    id: "open",
    title: `Open ${article}${name}`,
    body: `It sits in the sidebar under Estimating. ${why}`,
    menuBody: `Open the menu, then tap ${name}. ${why}`,
    route: null,
    targets: [`nav:${href}`, "nav-menu"],
    done: ({ pathname }) => pathname === href || pathname.startsWith(href + "/"),
  };
}

const SEND: TourStep = {
  id: "send",
  title: "Your proposal is ready",
  body: "It is saved as a draft. To see it the way your client will, put your own name and email in card 02 (The client) and press Save & send.",
  route: "/dashboard/manual-blueprint",
  targets: ["proposal-send"],
  done: ({ doc }) => !!doc.getElementById("mb-done-h"),
  next: true,
};

const ROOF: TourPath = {
  id: "roof",
  noun: "roof",
  home: "/dashboard/roof-estimator",
  steps: [
    navStep("/dashboard/roof-estimator", "Roof estimator", "Every roof you price starts here."),
    {
      id: "address",
      title: "Type the job's address",
      body: "Start typing and pick the house from the list. The roof is measured from the aerial photo, so check the pin sits on the right roof.",
      route: "/dashboard/roof-estimator",
      targets: ["roof-address"],
      // A picked suggestion draws the pin on the roof (.rf-pin); a typed address counts once the field is left.
      done: ({ doc }) =>
        shown(doc, "roof-measuring") ||
        shown(doc, "roof-hero") ||
        !!q(doc, "roof-intake")?.querySelector(".rf-pin") ||
        typedAndLeft(doc, q(doc, "roof-address")?.querySelector("input"), 6),
    },
    {
      id: "measure",
      title: "Measure the roof",
      body: "Press Measure this roof. JobFlex reads the squares, the pitch and every edge — eaves, rakes, ridges, valleys.",
      waiting: "Measuring the roof from the aerial. It takes from a few seconds to a couple of minutes — stay on this page.",
      route: "/dashboard/roof-estimator",
      targets: ["roof-measure"],
      done: ({ doc }) => shown(doc, "roof-hero"),
    },
    {
      id: "review",
      title: "Check the roof",
      body: "Area, squares and pitch come from the measurement. If a number looks wrong, look at the photo below before you price.",
      route: "/dashboard/roof-estimator",
      targets: ["roof-hero"],
      done: () => false,
      next: true,
    },
    {
      id: "pitch",
      title: "Pick the pitch",
      body: "This roof came back without a pitch. Choose it, and the estimate prices.",
      route: "/dashboard/roof-estimator",
      targets: ["roof-pitch"],
      when: ({ doc }) => shown(doc, "roof-pitch"),
      done: ({ doc }) => !shown(doc, "roof-pitch"),
    },
    {
      id: "package",
      title: "Choose the material and package",
      body: "Pick the roof type, the system and the brand you install. The one picked is a fair start; change what's not yours.",
      route: "/dashboard/roof-estimator",
      targets: ["roof-package"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "convert",
      title: "Check the price, then create the proposal",
      body: "The total follows every change to the package. Press Convert to proposal — it opens as a draft you can still edit.",
      route: "/dashboard/roof-estimator",
      targets: ["roof-price"],
      align: "end",
      done: onProposal,
    },
    SEND,
  ],
};

const FENCE: TourPath = {
  id: "fence",
  noun: "fence",
  home: "/dashboard/fence-estimator",
  steps: [
    navStep("/dashboard/fence-estimator", "Fence estimator", "Every fence you price starts here."),
    {
      id: "address",
      title: "Find the property",
      body: "Type the job's address and press Find. The map opens on the lot with its property lines.",
      route: "/dashboard/fence-estimator",
      targets: ["fence-address"],
      done: ({ doc }) => !!q(doc, "fence-map")?.querySelector(".map-live") || !!q(doc, "fence-runs")?.querySelector("[data-run]"),
    },
    {
      id: "line",
      title: "Draw the fence line",
      body: "Click along the fence on the map and double-click to finish. Or press Put down the fence to lay it on the checked property lines.",
      handheldBody: "Tap the points of the fence on the map, then Finish run. Or tap Fence to lay it on the checked property lines.",
      route: "/dashboard/fence-estimator",
      targets: ["fence-map"],
      done: ({ doc }) => !!q(doc, "fence-runs")?.querySelector("[data-run]") || !!q(doc, "fence-lay")?.classList.contains("is-done"),
    },
    {
      id: "type",
      title: "Pick the fence type",
      body: "Wood, vinyl, chain link, aluminum — pick what you're building. Rates come from the price book and you can change them there.",
      route: "/dashboard/fence-estimator",
      targets: ["fence-type"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "height",
      title: "Set the height",
      body: "Six feet is picked. Change it if the job is taller or shorter — posts, rails and the price follow.",
      route: "/dashboard/fence-estimator",
      targets: ["fence-height"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "convert",
      title: "Check the price, then create the proposal",
      body: "Good, Better and Best are three prices for the same line. Pick one and press Convert to proposal.",
      route: "/dashboard/fence-estimator",
      targets: ["fence-price"],
      handheldTargets: ["fence-convert"],
      align: "end",
      done: onProposal,
    },
    SEND,
  ],
};

const HVAC: TourPath = {
  id: "hvac",
  noun: "HVAC",
  home: "/dashboard/hvac-estimator",
  steps: [
    navStep("/dashboard/hvac-estimator", "HVAC estimator", "Every system you price starts here."),
    {
      id: "job",
      title: "Pick the job",
      body: "A full system replacement is picked. Choose another job if that's not it, then press Continue.",
      route: "/dashboard/hvac-estimator",
      targets: ["hvac-job"],
      when: ({ doc }) => shown(doc, "hvac-job"),
      counted: true,
      done: ({ doc }) => !shown(doc, "hvac-job"),
    },
    {
      id: "house",
      title: "Find the house",
      body: "Type the address and press Look up the house — the parcel, the footprint and the county's design temperatures come in. No record? Enter it by hand.",
      route: "/dashboard/hvac-estimator",
      targets: ["hvac-house"],
      done: ({ doc }) => shown(doc, "hvac-intake") || shown(doc, "hvac-design") || shown(doc, "hvac-estimate"),
    },
    {
      id: "size",
      title: "Check the house size",
      body: "The conditioned square footage sizes the system. Fill anything marked needed, then press Continue to the design.",
      route: "/dashboard/hvac-estimator",
      targets: ["hvac-intake"],
      done: ({ doc }) => shown(doc, "hvac-design") || shown(doc, "hvac-estimate"),
    },
    {
      id: "tiers",
      title: "Good, Better or Best",
      body: "Three units that fit this house, each with its price. Pick one, then press Continue to the estimate.",
      route: "/dashboard/hvac-estimator",
      targets: ["hvac-design"],
      done: ({ doc }) => shown(doc, "hvac-estimate"),
    },
    {
      id: "convert",
      title: "Create the proposal",
      body: "These are the lines your client will see. Press Convert to proposal — it opens as a draft you can still edit.",
      route: "/dashboard/hvac-estimator",
      targets: ["hvac-convert"],
      done: onProposal,
    },
    SEND,
  ],
};

const SMART: TourPath = {
  id: "smart",
  noun: "",
  home: "/dashboard/advanced-ai",
  steps: [
    navStep("/dashboard/advanced-ai", "Smart Proposal", "It writes an estimate for any job you describe.", ""),
    {
      id: "brief",
      title: "Describe the job",
      body: "Write it the way you'd tell the customer — what, how big, which materials. Or tap one of the samples.",
      route: "/dashboard/advanced-ai",
      targets: ["smart-brief"],
      done: ({ doc }) => shown(doc, "smart-lines") || typedAndLeft(doc, q(doc, "smart-brief") as HTMLTextAreaElement | null, 12),
    },
    {
      id: "generate",
      title: "Write the estimate",
      body: "Press Generate estimate. If it asks a question or two, answer them or press Generate anyway.",
      handheldBody: "Press Next, add the address if you have it, then Generate estimate. If it asks a question, answer it or press Generate anyway.",
      waiting: "Writing the estimate — about half a minute.",
      route: "/dashboard/advanced-ai",
      targets: ["smart-generate"],
      done: ({ doc }) => shown(doc, "smart-lines"),
    },
    {
      id: "lines",
      title: "Check the lines",
      body: "Every line has its quantity, material and labor. Change what you'd price differently, remove what's not in the job.",
      route: "/dashboard/advanced-ai",
      targets: ["smart-lines"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "convert",
      title: "Check the price, then create the proposal",
      body: "The total includes your discount and tax. Press Convert to proposal — it opens as a draft you can still edit.",
      handheldBody: "The total includes your margin, discount and tax. Press Save as proposal — it opens as a draft you can still edit.",
      route: "/dashboard/advanced-ai",
      targets: ["smart-price"],
      handheldTargets: ["smart-convert"],
      align: "end",
      done: onProposal,
    },
    SEND,
  ],
};

const DECK: TourPath = {
  id: "deck",
  noun: "deck",
  home: "/dashboard/deck-estimator",
  steps: [
    navStep("/dashboard/deck-estimator", "Deck Studio", "Every deck you price starts here."),
    {
      id: "kind",
      title: "Pick what you're building",
      body: "A deck, a porch, a pergola — or start from a sample. The 3D follows every choice.",
      route: "/dashboard/deck-estimator",
      targets: ["deck-kind"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "size",
      title: "Set the size",
      body: "Along the house and out from it. The framing and the price are worked out from these two numbers.",
      route: "/dashboard/deck-estimator",
      targets: ["deck-size"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "materials",
      title: "Choose the materials",
      body: "Good, Better or Best, and the boards. Your own prices can replace the examples in the package section.",
      route: "/dashboard/deck-estimator",
      targets: ["deck-materials"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "convert",
      title: "Check the price, then create the proposal",
      body: "This is the deck's price before tax. Press Save as proposal — it opens as a draft you can still edit.",
      route: "/dashboard/deck-estimator",
      targets: ["deck-price"],
      done: onProposal,
    },
    SEND,
  ],
};

const MANUAL: TourPath = {
  id: "manual",
  noun: "",
  home: "/dashboard/manual-blueprint",
  steps: [
    {
      id: "job",
      title: "Name the job",
      body: "A title and the address — the client sees both on the first line of the proposal.",
      route: "/dashboard/manual-blueprint",
      targets: ["proposal-card-01"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "lines",
      title: "Add the lines",
      body: "One line per piece of work: quantity, unit and price. The total adds itself up.",
      route: "/dashboard/manual-blueprint",
      targets: ["proposal-card-03"],
      done: ({ interacted }) => interacted,
      next: true,
    },
    {
      id: "save",
      title: "Save the proposal",
      body: "Press Save. It's kept as a draft until you send it.",
      route: "/dashboard/manual-blueprint",
      targets: ["proposal-send"],
      done: (ctx) => /[?&]proposal=/.test(ctx.search),
    },
    SEND,
  ],
};

export const TOUR_PATHS: Record<TourPathId, TourPath> = {
  roof: ROOF,
  fence: FENCE,
  hvac: HVAC,
  smart: SMART,
  deck: DECK,
  manual: MANUAL,
};

export function isTourPathId(v: unknown): v is TourPathId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TOUR_PATHS, v);
}

/** The card's title: "Create your first roof estimate", "…your first estimate". */
export function tourTitle(path: TourPathId): string {
  const noun = TOUR_PATHS[path].noun;
  return `Create your first ${noun ? noun + " " : ""}estimate`;
}

/** The index of the last step — reaching it is the tour's goal (a proposal exists). */
export const finalStep = (path: TourPathId) => TOUR_PATHS[path].steps.length - 1;

/** "0/5": steps a person always takes before the Send screen (the conditional ones not counted). */
export function tourCount(path: TourPathId, step: number): { done: number; total: number } {
  const steps = TOUR_PATHS[path].steps.slice(0, -1);
  const counts = (s: TourStep) => !s.when || !!s.counted;
  const always = steps.filter(counts);
  const done = steps.slice(0, Math.min(step, steps.length)).filter(counts).length;
  return { done, total: always.length };
}

/** THE NEXT STEPS after the first estimate (owner's brief, 2026-10-26): the
 *  frame and the first item; the other two are announced, not built. */
export const NEXT_STEPS = [
  { id: "send", title: "Send it to a client", body: "A proposal works once a client opens it. Send your first one — to yourself, if you want to see it first.", live: true },
  { id: "follow-ups", title: "Turn on follow-ups", body: "CRM → Workflows → Turn on defaults: a reminder goes out when a client hasn't opened or answered.", live: false },
  { id: "payments", title: "Connect payments", body: "Settings → Integrations / Payments: clients pay the deposit from the proposal.", live: false },
] as const;
