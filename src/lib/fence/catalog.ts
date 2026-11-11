// The fence catalog — every fence family the estimator, the takeoff, the
// pricing and the 3D view understand. Pure data + lookups, no imports.
//
// Ported 2026-09-18 from the owner's FenceScan app (lib/fence/catalog.ts):
// the same fence types, build specs, spacings, rail counts, picket pitches
// and national starting rates, so both apps price a fence the same way.
// One type is JobFlex's own: composite privacy, which the page already
// offered as a material.
//
// Geometry model used across the page:
//  - a fence LAYOUT is a set of runs (polylines) with corners where a run
//    bends, ends where it stops, and gates placed on runs;
//  - POSTS: line posts every `postSpacingFt`, plus one at every corner,
//    end, and both sides of every gate;
//  - wood fences are stick-built (rails + pickets); vinyl/aluminum/steel/
//    composite come as prefab PANELS per section; chain link is mesh +
//    framework; split and ranch rail are rails alone.

export type FenceCategory = "wood" | "vinyl" | "chain-link" | "aluminum" | "steel" | "split-rail" | "composite";

export type FenceTypeId =
  | "cedar-privacy"
  | "pt-pine-privacy"
  | "board-on-board"
  | "shadowbox"
  | "wood-picket"
  | "horizontal-modern"
  | "vinyl-privacy"
  | "vinyl-picket"
  | "composite-privacy"
  | "chain-link-galv"
  | "chain-link-black"
  | "aluminum-ornamental"
  | "steel-ornamental"
  | "split-rail-2"
  | "ranch-rail-3";

/** What the map and the 3D scene render a type as — JobFlex's five looks. */
export type RenderFamily = "cedar" | "vinyl" | "chain-link" | "aluminum" | "composite";

/**
 * Post / rail / infill stock as it is actually bought and set in the
 * field. This is what keeps the 3D view honest and the BOM wording right:
 * chain link gets round galvanized pipe with loop caps carrying a top
 * rail, vinyl gets routed 5×5 PVC posts with a cap standing proud of the
 * panel, split rail gets a mortised cedar post tamped into gravel — and
 * none of them borrow another system's hardware.
 */
export type BuildSpec = {
  /** A LINE post, in the contractor's own words. */
  postMaterial: string;
  /** Line-post face width / outside diameter in INCHES, actual — a
   *  "4×4" is 3.5", a residential chain-link line post is 1.625" OD. */
  postWidthIn: number;
  /** Corner / end / gate posts: heavier stock on nearly every system. */
  terminalWidthIn: number;
  postProfile: "square" | "round";
  /** Loop caps carry a chain-link top rail; split rail is capped with nothing. */
  postCap: "flat" | "pyramid" | "gothic" | "dome" | "loop" | "none";
  /** How far the post top stands above the infill top, inches. */
  postProudIn: number;
  /** Concrete footing, or tamped earth + gravel (split rail)? */
  setInConcrete: boolean;
  railMaterial: string;
  infillMaterial: string;
  /** Center-to-center pitch of pickets / boards / bars, inches. Omitted for mesh. */
  infillPitchIn?: number;
  /** Chain-link diamond size, inches. */
  meshDiamondIn?: number;
};

export type FenceType = {
  id: FenceTypeId;
  label: string;
  category: FenceCategory;
  /** What the surfaces render it as. */
  family: RenderFamily;
  /** The swatch on the type's row. */
  color: string;
  /** How this fence is actually built — see BuildSpec. */
  spec: BuildSpec;
  /** Short blurb shown in the picker and the proposal. */
  blurb: string;
  /** Offered heights in feet (gates follow the fence height). */
  heightsFt: number[];
  defaultHeightFt: number;
  /** Center-to-center line-post spacing. */
  postSpacingFt: number;
  /** Stick-built (rails + pickets) vs prefab panels vs chain-link mesh vs rails alone. */
  build: "stick" | "panel" | "mesh" | "rail";
  /** Horizontal rails per section by height (stick / rail builds). */
  railsPerSection: (heightFt: number) => number;
  /** Picket face width + gap, inches (stick builds; gap 0 = privacy). */
  picketWidthIn?: number;
  picketGapIn?: number;
  /** Material cost per linear foot at defaultHeightFt (posts, rails,
   *  pickets/panels/mesh, hardware averaged in). Height scales it. */
  materialPerLf: number;
  /** Install labor per linear foot on flat ground. */
  laborPerLf: number;
  /** Single walk gate (4 ft) installed price; wider gates derive from it. */
  gateSingle: number;
  /** Can it be stained / sealed? (wood only) */
  stainable: boolean;
};

const rails2Under5 = (h: number) => (h <= 4 ? 2 : h <= 6 ? 3 : 4);

export const FENCE_TYPES: FenceType[] = [
  {
    id: "cedar-privacy",
    label: "Cedar privacy",
    category: "wood",
    family: "cedar",
    color: "#b88420",
    blurb: "Western red cedar, solid 6' privacy — the neighborhood standard.",
    heightsFt: [4, 5, 6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: 0,
    materialPerLf: 22,
    laborPerLf: 14,
    gateSingle: 385,
    stainable: true,
    spec: {
      // Even on a cedar fence the POSTS are pressure-treated pine: cedar in
      // ground contact is the first thing to rot out.
      postMaterial: "4×4 pressure-treated pine post (cedar on request)",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5, // 4×6 at gates and corners
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×6 western red cedar pickets",
      infillPitchIn: 5.5,
    },
  },
  {
    id: "pt-pine-privacy",
    label: "Pressure-treated privacy",
    category: "wood",
    family: "cedar",
    color: "#c9a25a",
    blurb: "Budget-friendly treated pine privacy, paint or stain ready.",
    heightsFt: [4, 6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: 0,
    materialPerLf: 16,
    laborPerLf: 13,
    gateSingle: 325,
    stainable: true,
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 pressure-treated rails",
      infillMaterial: "1×6 pressure-treated pine pickets",
      infillPitchIn: 5.5,
    },
  },
  {
    id: "board-on-board",
    label: "Board-on-board",
    category: "wood",
    family: "cedar",
    color: "#a8731f",
    blurb: "Overlapped pickets — full privacy with no gaps as wood dries.",
    heightsFt: [6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: -1.25, // overlap
    materialPerLf: 28,
    laborPerLf: 16,
    gateSingle: 445,
    stainable: true,
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×6 cedar pickets, 1¼″ lapped over the under-course",
      infillPitchIn: 4.25, // 5.5" board less the 1.25" lap
    },
  },
  {
    id: "shadowbox",
    label: "Shadowbox",
    category: "wood",
    family: "cedar",
    color: "#b58b3a",
    blurb: "Alternating pickets both sides — good-neighbor, airflow friendly.",
    heightsFt: [6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: 2.5, // per face; both faces interleave
    materialPerLf: 26,
    laborPerLf: 15,
    gateSingle: 425,
    stainable: true,
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×6 cedar pickets, alternating faces",
      infillPitchIn: 8, // per face: 5.5" board + 2.5" gap
    },
  },
  {
    id: "wood-picket",
    label: "Classic wood picket",
    category: "wood",
    family: "cedar",
    color: "#d2b070",
    blurb: "3–4' spaced pickets for curb appeal and pets.",
    heightsFt: [3, 4],
    defaultHeightFt: 4,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: () => 2,
    picketWidthIn: 3.5,
    picketGapIn: 2.5,
    materialPerLf: 14,
    laborPerLf: 11,
    gateSingle: 285,
    stainable: true,
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 3.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×4 cedar pickets, dog-eared",
      infillPitchIn: 6, // 3.5" picket + 2.5" gap
    },
  },
  {
    id: "horizontal-modern",
    label: "Horizontal modern",
    category: "wood",
    family: "cedar",
    color: "#8f6a2e",
    blurb: "Clean horizontal cedar slats — the modern architectural look.",
    heightsFt: [4, 6],
    defaultHeightFt: 6,
    postSpacingFt: 6, // tighter to keep long boards straight
    build: "stick",
    railsPerSection: () => 0, // boards ARE the horizontal members
    picketWidthIn: 5.5,
    picketGapIn: 0.75,
    materialPerLf: 34,
    laborPerLf: 19,
    gateSingle: 545,
    stainable: true,
    spec: {
      // Horizontal boards load the posts harder and show every bow, so this
      // build steps up to 6×6 and tightens the bays to 6'.
      postMaterial: "6×6 pressure-treated post",
      postWidthIn: 5.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 0, // slats run flush to the post top — the modern look
      setInConcrete: true,
      railMaterial: "none — the slats span post to post",
      infillMaterial: "1×6 cedar slats, ¾″ reveal",
      infillPitchIn: 6.25, // 5.5" board + 0.75" gap, stacked vertically
    },
  },
  {
    id: "vinyl-privacy",
    label: "Vinyl privacy",
    category: "vinyl",
    family: "vinyl",
    color: "#e8e6e0",
    blurb: "Zero-maintenance PVC panels — never paint again.",
    heightsFt: [4, 6],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 30,
    laborPerLf: 13,
    gateSingle: 465,
    stainable: false,
    spec: {
      // Vinyl runs on VINYL posts — 5×5 hollow PVC, routed so the rails slide
      // through the post rather than hanging off brackets. Gate and corner
      // posts get an aluminum stiffener inside.
      postMaterial: "5×5 vinyl post, routed, aluminum-stiffened at gates",
      postWidthIn: 5,
      terminalWidthIn: 5,
      postProfile: "square",
      postCap: "pyramid", // New England cap
      postProudIn: 3, // cap stands proud of the panel — the vinyl tell
      setInConcrete: true,
      railMaterial: "vinyl rails, aluminum-reinforced bottom rail",
      infillMaterial: "tongue-and-groove vinyl privacy boards",
      infillPitchIn: 6,
    },
  },
  {
    id: "vinyl-picket",
    label: "Vinyl picket",
    category: "vinyl",
    family: "vinyl",
    color: "#f2f1ec",
    blurb: "The white-picket look in maintenance-free PVC.",
    heightsFt: [3, 4],
    defaultHeightFt: 4,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 24,
    laborPerLf: 11,
    gateSingle: 395,
    stainable: false,
    spec: {
      postMaterial: "4×4 vinyl post, routed",
      postWidthIn: 4,
      terminalWidthIn: 4,
      postProfile: "square",
      postCap: "gothic",
      postProudIn: 3,
      setInConcrete: true,
      railMaterial: "routed vinyl rails",
      infillMaterial: "vinyl pickets, gothic top",
      infillPitchIn: 6, // 3" picket + 3" gap
    },
  },
  {
    id: "composite-privacy",
    label: "Composite privacy",
    category: "composite",
    family: "composite",
    color: "#7c5a3a",
    blurb: "Wood-look composite boards on aluminum rails — no rot, no staining.",
    heightsFt: [6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 34,
    laborPerLf: 14,
    gateSingle: 585,
    stainable: false,
    spec: {
      // Composite systems sleeve a treated 4×4 in a 5×5 composite post, and
      // the boards drop into aluminum bottom / composite top rails.
      postMaterial: "5×5 composite-sleeved post over a treated core",
      postWidthIn: 5,
      terminalWidthIn: 5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 3,
      setInConcrete: true,
      railMaterial: "aluminum bottom rail + composite top rail",
      infillMaterial: "interlocking composite privacy boards",
      infillPitchIn: 6,
    },
  },
  {
    id: "chain-link-galv",
    label: "Chain link (galvanized)",
    category: "chain-link",
    family: "chain-link",
    color: "#94a3b8",
    blurb: "The workhorse — decades of service at the lowest cost per foot.",
    heightsFt: [4, 5, 6, 8],
    defaultHeightFt: 4,
    postSpacingFt: 10,
    build: "mesh",
    railsPerSection: () => 1, // top rail
    materialPerLf: 9,
    laborPerLf: 8,
    gateSingle: 265,
    stainable: false,
    spec: {
      // Wire fence rides on METAL: round galvanized steel pipe, never wood or
      // vinyl. Line posts are visibly thinner than the terminals that take the
      // fabric tension.
      postMaterial: "1⅝″ OD galvanized steel pipe (2⅜″ terminals)",
      postWidthIn: 1.625,
      terminalWidthIn: 2.375,
      postProfile: "round",
      postCap: "loop", // the top rail threads through the line-post caps
      postProudIn: 0, // line posts die into the top rail
      setInConcrete: true,
      railMaterial: "1⅜″ OD galvanized top rail + 7-ga bottom tension wire",
      infillMaterial: "11-ga galvanized steel fabric, 2″ diamond mesh",
      meshDiamondIn: 2,
    },
  },
  {
    id: "chain-link-black",
    label: "Chain link (black vinyl)",
    category: "chain-link",
    family: "chain-link",
    color: "#3f4650",
    blurb: "Black vinyl-coated mesh that disappears into the landscape.",
    heightsFt: [4, 5, 6],
    defaultHeightFt: 4,
    postSpacingFt: 10,
    build: "mesh",
    railsPerSection: () => 1,
    materialPerLf: 12,
    laborPerLf: 8.5,
    gateSingle: 295,
    stainable: false,
    spec: {
      postMaterial: "1⅝″ OD black polymer-coated steel pipe (2⅜″ terminals)",
      postWidthIn: 1.625,
      terminalWidthIn: 2.375,
      postProfile: "round",
      postCap: "loop",
      postProudIn: 0,
      setInConcrete: true,
      railMaterial: "1⅜″ OD black top rail + bottom tension wire",
      infillMaterial: "9-ga black polymer-coated fabric, 2″ diamond mesh",
      meshDiamondIn: 2,
    },
  },
  {
    id: "aluminum-ornamental",
    label: "Aluminum ornamental",
    category: "aluminum",
    family: "aluminum",
    color: "#475569",
    blurb: "Wrought-iron look, no rust — pools, front yards, HOAs.",
    heightsFt: [4, 5, 6],
    defaultHeightFt: 4,
    postSpacingFt: 6,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 32,
    laborPerLf: 12,
    gateSingle: 495,
    stainable: false,
    spec: {
      postMaterial: "2″ powder-coated aluminum post",
      postWidthIn: 2,
      terminalWidthIn: 2.5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "1″ aluminum channel rails",
      infillMaterial: "¾″ square aluminum pickets",
      // Pool code wants under 4" clear between pickets — 3⅞" clear on a ¾"
      // picket lands at 4.6" on center.
      infillPitchIn: 4.6,
    },
  },
  {
    id: "steel-ornamental",
    label: "Steel ornamental",
    category: "steel",
    family: "aluminum",
    color: "#2c3036",
    blurb: "Heavy-gauge security and estate fencing.",
    heightsFt: [4, 5, 6, 8],
    defaultHeightFt: 5,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 42,
    laborPerLf: 15,
    gateSingle: 645,
    stainable: false,
    spec: {
      postMaterial: "2½″ galvanized + powder-coated steel post",
      postWidthIn: 2.5,
      terminalWidthIn: 3,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "1¼″ steel channel rails",
      infillMaterial: "1″ square steel pickets",
      infillPitchIn: 4.75,
    },
  },
  {
    id: "split-rail-2",
    label: "Split rail (2-rail)",
    category: "split-rail",
    family: "cedar",
    color: "#9b8557",
    blurb: "Rustic property-line marking for acreage.",
    heightsFt: [3],
    defaultHeightFt: 3,
    postSpacingFt: 10,
    build: "rail",
    railsPerSection: () => 2,
    materialPerLf: 11,
    laborPerLf: 7,
    gateSingle: 315,
    stainable: true,
    spec: {
      // Split rail is the one system that does NOT get concrete: the posts
      // are mortised, dropped in and tamped with gravel so the rails can be
      // re-seated as the ground moves.
      postMaterial: "mortised cedar post, tamped gravel backfill",
      postWidthIn: 5,
      terminalWidthIn: 5,
      postProfile: "round",
      postCap: "none",
      postProudIn: 8, // the post stands well above the top rail
      setInConcrete: false,
      railMaterial: "split cedar rails, tapered into the post mortises",
      infillMaterial: "open — 2 rails, no infill",
    },
  },
  {
    id: "ranch-rail-3",
    label: "Ranch rail (3-rail)",
    category: "split-rail",
    family: "cedar",
    color: "#a89468",
    blurb: "Board ranch fencing for horses and farms.",
    heightsFt: [4, 5],
    defaultHeightFt: 4,
    postSpacingFt: 8,
    build: "rail",
    railsPerSection: () => 3,
    materialPerLf: 15,
    laborPerLf: 9,
    gateSingle: 365,
    stainable: true,
    spec: {
      postMaterial: "4×4 pressure-treated post",
      postWidthIn: 3.5,
      terminalWidthIn: 3.5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 6,
      setInConcrete: true,
      // Ranch rail is face-nailed board, not mortised split rail.
      railMaterial: "1×6 ranch boards, face-nailed to the posts",
      infillMaterial: "open — 3 boards, no infill",
    },
  },
];

export const FENCE_TYPE_BY_ID: Record<FenceTypeId, FenceType> = Object.fromEntries(FENCE_TYPES.map((t) => [t.id, t])) as Record<FenceTypeId, FenceType>;

export const DEFAULT_FENCE_TYPE: FenceTypeId = "cedar-privacy";

export function isFenceTypeId(id: string | null | undefined): id is FenceTypeId {
  return !!id && Object.prototype.hasOwnProperty.call(FENCE_TYPE_BY_ID, id);
}

export function fenceType(id: FenceTypeId | string): FenceType {
  return (isFenceTypeId(id) ? FENCE_TYPE_BY_ID[id] : null) ?? FENCE_TYPE_BY_ID[DEFAULT_FENCE_TYPE];
}

/** The category's plain name, for headings in the picker. */
export const CATEGORY_LABEL: Record<FenceCategory, string> = {
  wood: "Wood",
  vinyl: "Vinyl",
  composite: "Composite",
  "chain-link": "Chain link",
  aluminum: "Aluminum",
  steel: "Steel",
  "split-rail": "Rail",
};

/**
 * Height multiplier on per-LF material/labor: catalog prices are at the
 * default height; taller sections use more board-feet roughly linearly.
 * A height the type does not offer prices at the type's default — callers
 * that want the NEAREST offered height use nearestHeight first.
 */
export function heightFactor(t: FenceType, heightFt: number): number {
  const h = t.heightsFt.includes(heightFt) ? heightFt : t.defaultHeightFt;
  return Math.max(0.6, h / t.defaultHeightFt);
}

/**
 * The height a type builds at for a requested height: the request when the
 * type offers it, else the nearest height it DOES come in (ties break low).
 * A 6' cedar job's chain-link stretch is a 6' stretch, not the catalog
 * default; an 8' request on a type that tops out at 6' builds at 6' and
 * the label says so.
 */
export function nearestHeight(t: FenceType, heightFt: number): number {
  let best = t.defaultHeightFt;
  let bestD = Infinity;
  for (const h of t.heightsFt) {
    const d = Math.abs(h - heightFt);
    if (d < bestD || (d === bestD && h < best)) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/**
 * Does the cedar board grade (#2 & better / #1 tight-knot / clear) mean anything for this type? Only where the
 * boards ARE cedar. Pressure-treated pine is graded otherwise, and a "clear" PT fence came out as "· clear cedar"
 * at ×1.6 with "Clear 1×6 pressure-treated pine pickets" on the list (2026-11-10).
 */
export function takesCedarGrade(t: FenceType): boolean {
  return t.category === "wood" && /cedar/i.test(t.spec.infillMaterial);
}

export type Terrain = "flat" | "sloped" | "steep" | "rocky";

/** Labor multiplier by ground difficulty (digging + racking sections). */
export const TERRAIN_FACTOR: Record<Terrain, number> = {
  flat: 1,
  sloped: 1.18,
  steep: 1.4,
  rocky: 1.55,
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  flat: "Flat yard",
  sloped: "Gentle slope",
  steep: "Steep slope",
  rocky: "Rocky / hard dig",
};

export const TERRAINS: Terrain[] = ["flat", "sloped", "steep", "rocky"];

/**
 * Post-spacing override rules: stick builds cap at 8' — that is what a 2×4
 * rail spans — and mesh runs to 12'. Panel systems come in fixed sections,
 * and rail builds (split / ranch) are fixed by the rail stock itself: a 10'
 * mortised split rail cannot be built at 4' o.c.
 */
export function spacingCapFt(t: FenceType): number {
  return t.build === "stick" ? 8 : 12;
}

export function effectiveSpacingFt(t: FenceType, override: number | null | undefined): number {
  return (t.build === "stick" || t.build === "mesh") && Number.isFinite(override) && (override as number) >= 4 && (override as number) <= spacingCapFt(t)
    ? (override as number)
    : t.postSpacingFt;
}

/** The spacings a type can be built at, standard first; null = not adjustable. */
export function spacingOptions(t: FenceType): number[] | null {
  if (t.build === "panel" || t.build === "rail") return null;
  return t.build === "stick" ? [4, 6, 8] : [4, 6, 8, 10, 12];
}
