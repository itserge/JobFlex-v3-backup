// WHAT EVERY FIELD IS, SHOWN IN 3D (owner, 2026-10-12: "highlight all fields to show on 3D what it is — make it smart")
// — pure.
//
// A field of the studio, named by its label and where it sits — its step, the stair or fixture card it is in, the lower
// level — lights the parts of the 3D it sets: the joists for "Joists", that one stair for its "Width", the footings for
// "Frost depth", the roof's faces for "Roofing". A tag says what they are now, with the live numbers ("Joists · 2x8 at
// 16 in. on center · 13 of them"). A size is shown as a bar along the edge it sets; a cut corner as the patch cut away.
// Fields with nothing in the 3D (prices, the address) light nothing. The wall fields of the House step have their own
// (lib/deck/house wallHighlight).

import { FIXTURE_LABEL, PATTERN_LABEL, ROOFING_LABEL, ROOF_KIND_LABEL, type DeckDesign } from "./design";
import { bowsLine } from "./curve";
import { SCENE_LAYERS, type DeckScene } from "./scene";
import type { DeckStructure } from "./structure";

/** Which field the contractor is in or over: its label, and where it sits. */
export interface FieldFocus {
  label: string;
  step?: string;
  stair?: string;
  fixture?: string;
  level?: "lower";
}

/** What lights up: the scene's own parts (box and polygon indexes, the footings, the shaped boards), extra boxes in the scene's feet [x0, y0, z0, x1, y1, z1], and a tag. */
export interface FieldLight {
  boxes: number[][];
  boxIdx: number[];
  polyIdx: number[];
  footings: boolean;
  diagonal: boolean;
  tag: { x: number; y: number; z: number; text: string } | null;
}

type Layer = (typeof SCENE_LAYERS)[number];

/** A length as the studio says it: "16 ft", or 16'-6". */
export const feetWords = (inches: number) => {
  const i = Math.round(Math.abs(inches));
  return i % 12 ? `${Math.floor(i / 12)}'-${i % 12}"` : `${i / 12} ft`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];

interface Ctx {
  sc: DeckScene;
  s: DeckStructure;
  d: DeckDesign;
  f: FieldFocus;
}

/** The parts of these layers (and roles), on the main deck, the lower level, or both. */
function partsOf(sc: DeckScene, layers: Layer[], role?: RegExp, level: "main" | "lower" | "any" = "main"): number[] {
  const want = new Set(layers.map((l) => SCENE_LAYERS.indexOf(l)));
  const out: number[] = [];
  sc.boxes.forEach((b, i) => {
    if (!want.has(b[0])) return;
    const r = sc.tags.length === sc.boxes.length && sc.tags[i] >= 0 ? sc.legend[sc.tags[i]]?.role ?? "" : "";
    const lower = r.startsWith("lower level");
    if (level === "main" && lower) return;
    if (level === "lower" && !lower) return;
    if (role && !role.test(lower ? r.slice("lower level ".length) : r)) return;
    out.push(i);
  });
  return out;
}
function facesOf(sc: DeckScene, layers: Layer[]): number[] {
  const want = new Set(layers.map((l) => SCENE_LAYERS.indexOf(l)));
  return sc.polys.map((p, i) => (want.has(p[0]) ? i : -1)).filter((i) => i >= 0);
}

/** A tag over what is lit: above the middle of it. */
function tagOver(c: Ctx, lit: Omit<FieldLight, "tag">, text: string): FieldLight {
  const pts: Array<[number, number, number]> = [];
  for (const i of lit.boxIdx) {
    const b = c.sc.boxes[i];
    pts.push([b[1], b[2], b[3] + b[6] / 2]);
  }
  for (const i of lit.polyIdx) {
    const p = c.sc.polys[i];
    for (let k = 1; k + 2 < p.length; k += 3) pts.push([p[k], p[k + 1], p[k + 2]]);
  }
  for (const b of lit.boxes) pts.push([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5]]);
  if (lit.footings) for (const f of c.sc.footings) pts.push([f[0], f[1], f[6]]);
  if (!pts.length) pts.push([c.sc.widthFt / 2, c.sc.depthFt / 2, c.sc.heightFt]);
  const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const z = Math.max(...pts.map((p) => p[2]));
  return { ...lit, tag: { x, y, z: z + 1.4, text } };
}
const none = (): Omit<FieldLight, "tag"> => ({ boxes: [], boxIdx: [], polyIdx: [], footings: false, diagonal: false });
const light = (c: Ctx, parts: Partial<Omit<FieldLight, "tag">>, text: string): FieldLight => tagOver(c, { ...none(), ...parts }, text);

/** A bar along an edge of the deck at its floor, in the scene's feet. */
const bar = (x0: number, y0: number, x1: number, y1: number, z: number, t = 0.28): number[] => [Math.min(x0, x1) - t / 2, Math.min(y0, y1) - t / 2, z - t / 2, Math.max(x0, x1) + t / 2, Math.max(y0, y1) + t / 2, z + t / 2];

/* ── the rules ─────────────────────────────────────────────────────────── */

type Rule = { when: (f: FieldFocus) => boolean; run: (c: Ctx) => FieldLight | null };
const isStep = (f: FieldFocus, ...ids: string[]) => !!f.step && ids.some((id) => f.step === id);
const named = (f: FieldFocus, ...labels: Array<string | RegExp>) => labels.some((l) => (typeof l === "string" ? f.label === l : l.test(f.label)));

const FRAMING: Layer[] = ["post", "beam", "ledger", "joist", "rim", "blocking", "brace"];

const RULES: Rule[] = [
  /* Stairs and railing — PLAIN, on the owner's word (2026-10-12: "from rails and stairs remove blue colouring on 3D"),
     like the house before them: every field and tick of the step, each stair's card too, lights nothing. First, so the
     ticks matched by their words alone never reach their rules. */
  { when: (f) => isStep(f, "step-stairs"), run: () => null },
  /* The ticks (a checkbox's words are its label) */
  {
    // A double deck (2026-11-13): the lower deck, lit.
    when: (f) => named(f, /^A double deck/),
    run: (c) => (c.s.lower?.place === "under" ? light(c, { boxIdx: partsOf(c.sc, [...FRAMING, "decking", "fascia"], undefined, "lower") }, `The lower deck · ${feetWords(c.d.lower.heightIn)} above the ground, ${feetWords(c.d.lower.dropIn)} under the upper deck`) : light(c, {}, "One deck — no second deck under it yet")),
  },
  {
    when: (f) => named(f, /^A lower level in front/),
    run: (c) => (c.s.lower?.place === "front" ? light(c, { boxIdx: partsOf(c.sc, [...FRAMING, "decking", "fascia"], undefined, "lower") }, `The lower level · ${feetWords(c.d.lower.widthFt * 12)} × ${feetWords(c.d.lower.depthFt * 12)}, ${feetWords(c.d.lower.dropIn)} down`) : light(c, {}, "No lower level yet")),
  },
  {
    when: (f) => named(f, /^Dig to the frost line/),
    run: (c) => light(c, { footings: true }, `${plural(c.sc.footings.length, "footing")} · ${c.d.footing.frostAlways ? "dug to the frost line" : "as shallow as the code allows"}`),
  },
  { when: (f) => named(f, /^Doubled rim/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["rim"]) }, c.d.framing.doubleRim ? "The rim doubled, and the outside joists" : "A single rim") },
  { when: (f) => named(f, /^Joist tape/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["joist"]) }, c.d.framing.joistTape ? "Joist tape on every joist's top" : "No joist tape") },
  { when: (f) => named(f, /^Knee braces at corner posts/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["brace"]) }, c.d.framing.braces ? "Knee braces at the corner posts" : "No knee braces") },
  { when: (f) => named(f, /^Mid-span blocking/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["blocking"]) }, "Blocking between the joists") },
  { when: (f) => named(f, /^Under-deck drainage/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["joist"]) }, "Under-deck drainage, between the joists") },
  { when: (f) => named(f, /^Knee braces at the posts/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["header"], /^roof brace$/) }, "Knee braces at the roof's posts") },
  { when: (f) => named(f, /^Cupola/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["trim"], /^cupola$/) }, "The cupola at the peak") },
  { when: (f) => named(f, /^Fascia on the eaves/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["trim"], /^(fascia eave|subfascia)$/) }, "Fascia on the eaves") },
  { when: (f) => named(f, /^Rake boards/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["trim"], /^fascia rake$/) }, "Rake boards on the gable ends") },
  { when: (f) => named(f, /^Vented soffit/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["trim"]), polyIdx: facesOf(c.sc, ["ceiling"]) }, "The soffit under the overhang") },
  { when: (f) => named(f, /^Gutter guards/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["gutter"]) }, "Gutter guards on the gutters") },
  { when: (f) => named(f, /^A timer or photocell/), run: (c) => light(c, { boxIdx: partsOf(c.sc, ["light"], undefined, "any") }, "The lights, on a timer or a photocell") },
  /* What to build: where a roof or a gazebo stands */
  {
    when: (f) => named(f, "Where it stands", "It stands"),
    run: (c) => {
      const r = c.s.roof;
      if (!r) return null;
      const on = c.d.floor === "deck" ? "on the deck" : c.d.floor === "slab" ? "on a new slab" : c.d.floor === "existing" ? "on the existing slab" : "on its own footings";
      return light(c, { boxIdx: [...partsOf(c.sc, ["roof-post"]), ...partsOf(c.sc, ["header"], /roof ledger/)], polyIdx: facesOf(c.sc, ["slab"]), footings: c.d.floor === "ground" }, `It stands ${on}${c.d.roof.attach === "wall" ? ", hung on the house" : ""} · ${plural(r.posts.length, "post")}`);
    },
  },
  /* The house (its look and its shape) — PLAIN, on the owner's word (2026-10-12: "don't show in blue on 3D when working
     in the shape"). A box over the whole house said nothing the house doesn't, and it hid what was being chosen: the
     storeys, the roof, the siding's colour, the wall's shape, the drawing being dragged. The wall-part boxes still
     light their own part (lib/deck/house wallHighlight). */
  {
    when: (f) => isStep(f, "step-house") && named(f, "Storeys", "Roof", "Siding", "Roof colour", "The wall's shape", /^The back wall and the deck/),
    run: () => null,
  },
  {
    when: (f) => isStep(f, "step-footprint") && named(f, "Outline", "Across the flats", "Across", "Along the house", "Out from the house", "Shift along the house"),
    run: (c) => {
      const r = c.s.roof;
      if (!r) return null;
      const xs = r.posts.map((p) => p.x / 12);
      const ys = r.posts.map((p) => p.y / 12);
      const z = Math.max(...r.posts.map((p) => p.topIn / 12));
      const along = named(c.f, "Along the house", "Across the flats", "Across");
      const out = named(c.f, "Out from the house");
      const boxes = along ? [bar(Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.max(...ys), z)] : out ? [bar(Math.max(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), z)] : [];
      const size = `${feetWords((Math.max(...xs) - Math.min(...xs)) * 12)} × ${feetWords((Math.max(...ys) - Math.min(...ys)) * 12)}`;
      return light(c, { boxes, boxIdx: [...partsOf(c.sc, ["header"]), ...partsOf(c.sc, ["roof-post"])] }, `The ${c.d.structure === "pergola" ? "pergola" : c.d.structure === "gazebo" ? "gazebo" : "roof"}'s footprint · ${size} post to post`);
    },
  },
  /* The lower level */
  {
    when: (f) => f.level === "lower",
    run: (c) => {
      const lw = c.s.lower;
      if (!lw) return null;
      const parts = partsOf(c.sc, [...FRAMING, "decking", "fascia"], undefined, "lower");
      const x0 = lw.offsetXIn / 12;
      const y0 = lw.offsetYIn / 12;
      const W = c.d.lower.widthFt;
      const D = c.d.lower.depthFt;
      const z = lw.frame.surfaceIn / 12;
      const boxes = named(c.f, "Along the house") ? [bar(x0, y0 + D, x0 + W, y0 + D, z)] : named(c.f, "Out from the deck") ? [bar(x0 + W, y0, x0 + W, y0 + D, z)] : [];
      const text = lw.place === "under" ? `The lower deck · ${feetWords(c.d.lower.heightIn)} above the ground, ${feetWords(c.d.lower.dropIn)} under the upper deck` : named(c.f, "Step down") ? `The lower level · ${feetWords(c.d.lower.dropIn)} down` : named(c.f, "Set") ? `The lower level · set at the ${c.d.lower.align === "centre" ? "middle" : c.d.lower.align}` : `The lower level · ${feetWords(W * 12)} × ${feetWords(D * 12)}`;
      return light(c, { boxes, boxIdx: parts }, text);
    },
  },
  /* The deck's shape */
  {
    when: (f) => isStep(f, "step-shape") && named(f, "Along the house", "Out from the house"),
    run: (c) => {
      if (!c.s.frame) return null;
      const W = c.d.shape.widthFt;
      const D = c.d.shape.depthFt;
      const z = c.s.frame.surfaceIn / 12;
      return named(c.f, "Along the house")
        ? light(c, { boxes: [bar(0, D, W, D, z)] }, `${feetWords(W * 12)} along the house`)
        : light(c, { boxes: [bar(W, 0, W, D, z)] }, `${feetWords(D * 12)} out from the house`);
    },
  },
  {
    when: (f) => isStep(f, "step-shape") && named(f, "Corner cut away", "Cut along the house", "Cut out from the house"),
    run: (c) => {
      const sh = c.d.shape;
      if (sh.kind !== "L" || !c.s.frame) return light(c, {}, "A rectangle — no corner cut away");
      const W = sh.widthFt;
      const D = sh.depthFt;
      const nw = sh.notch.widthFt;
      const nd = sh.notch.depthFt;
      const right = sh.notch.corner.endsWith("right");
      const back = sh.notch.corner.startsWith("back");
      const x0 = right ? W - nw : 0;
      const y0 = back ? 0 : D - nd;
      const z = c.s.frame.surfaceIn / 12;
      return light(c, { boxes: [[x0, y0, z - 0.15, x0 + nw, y0 + nd, z + 0.05]] }, `${feetWords(nw * 12)} × ${feetWords(nd * 12)} cut away at the ${sh.notch.corner.replace("-", " ")}`);
    },
  },
  {
    when: (f) => isStep(f, "step-shape") && named(f, "The front edge", "The bow at the middle", "Each corner clipped"),
    run: (c) => {
      const sh = c.d.shape;
      const D = sh.depthFt;
      const front = partsOf(c.sc, ["rim", "fascia"]).filter((i) => c.sc.boxes[i][2] > D - 2.5);
      const fr = sh.kind === "rect" ? sh.front : undefined;
      const text = !fr || fr.kind === "straight" ? "A straight front edge" : fr.kind === "curve" ? (fr.leftFt || fr.rightFt || fr.backFt ? `Curved: ${bowsLine(sh)}` : `The front bowed out ${feetWords(fr.bulgeFt * 12)} at the middle`) : `Each front corner clipped ${feetWords(fr.clipFt * 12)}`;
      return light(c, { boxIdx: front }, text);
    },
  },
  /* Height, house and ground */
  /* The hot-tub spot (2026-10-21): its shell and water, with what is under it. */
  {
    when: (f) => named(f, "Where the tub stands", "Tub, along the house", "Tub, out from the house"),
    run: (c) => {
      if (!c.d.spa.on) return null;
      const tub = partsOf(c.sc, ["spa"], undefined, "any");
      if (!tub.length) return null;
      return light(c, { boxIdx: tub, polyIdx: facesOf(c.sc, ["spa"]) }, `Hot-tub spot · ${feetWords(c.d.spa.widthFt * 12)} × ${feetWords(c.d.spa.depthFt * 12)} · the joists under it doubled`);
    },
  },
  {
    when: (f) => named(f, "Deck height"),
    run: (c) => {
      if (!c.s.frame) return null;
      const W = c.d.shape.widthFt;
      const D = c.d.shape.depthFt;
      const z = c.s.frame.surfaceIn / 12;
      return light(c, { boxes: [[W + 0.6, D + 0.6, 0, W + 0.95, D + 0.95, z]], boxIdx: partsOf(c.sc, ["post"]) }, `The deck's floor ${feetWords(c.d.heightIn)} above the ground`);
    },
  },
  {
    when: (f) => named(f, "How it meets the house", "The house wall there"),
    run: (c) => {
      const ledger = [...partsOf(c.sc, ["ledger"]), ...partsOf(c.sc, ["hardware"], /^(ledger fastener|ledger flashing|hold-down)$/)];
      const words = c.d.placement === "attached" ? `On the house: a ledger, ${plural(c.s.frame?.ledgers.length ?? 1, "run")}` : c.d.placement === "beside" ? "Beside the house, on its own posts" : "Free-standing in the yard";
      return light(c, { boxIdx: ledger.length ? ledger : partsOf(c.sc, ["post"]) }, words);
    },
  },
  {
    when: (f) => named(f, "Frost depth", "Footings stand above grade", "Soil bears", "Footings"),
    run: (c) => {
      const fr = c.s.frame;
      const n = c.sc.footings.length;
      if (!n) return null;
      const depth = fr?.posts[0]?.footing?.depthIn;
      const text = named(c.f, "Soil bears") ? `${plural(n, "footing")} · the soil bears ${c.d.soilPsf} psf` : named(c.f, "Frost depth") ? `${plural(n, "footing")} · ${depth ? `${feetWords(depth)} deep, ` : ""}below the ${c.d.frostIn}-in. frost line` : named(c.f, "Footings stand above grade") ? `${plural(n, "footing")} · tops ${c.d.footing.aboveGradeIn} in. above grade` : `${plural(n, "footing")}${depth ? ` · ${feetWords(depth)} deep` : ""}`;
      return light(c, { footings: true, boxIdx: partsOf(c.sc, ["hardware"], /^post base$/, "any") }, text);
    },
  },
  {
    when: (f) => named(f, "Design load"),
    run: (c) => light(c, { boxIdx: partsOf(c.sc, ["joist", "beam", "post"]) }, `Built for ${c.d.loadPsf} psf on the deck`),
  },
  {
    when: (f) => named(f, "Falls away from the house", "Falls left to right"),
    run: (c) => {
      const g = c.sc.ground;
      const out = g ? Math.round(g.outDropFt * 12) : 0;
      const across = g ? Math.round(g.acrossDropFt * 12) : 0;
      const text = named(c.f, "Falls away from the house") ? (out ? `The ground falls ${out} in. away from the house` : "Level away from the house") : across ? `The ground falls ${across} in. left to right` : "Level left to right";
      return light(c, { footings: true, boxIdx: partsOf(c.sc, ["post"]) }, text);
    },
  },
  /* Frame */
  {
    when: (f) => named(f, "Framing lumber"),
    run: (c) => light(c, { boxIdx: partsOf(c.sc, FRAMING) }, `The framing · ${c.s.frame?.species.short ?? "treated lumber"}`),
  },
  {
    when: (f) => named(f, "Joists", "Joist spacing", "Spans and prices as"),
    run: (c) => {
      const fr = c.s.frame;
      if (!fr) return null;
      const n = fr.joists.filter((j) => !j.sister).length;
      return light(c, { boxIdx: partsOf(c.sc, ["joist"]) }, `Joists · ${fr.joistSize} at ${fr.spacingIn} in. on center · ${n} of them`);
    },
  },
  {
    when: (f) => named(f, "Joists past the beam"),
    run: (c) => light(c, { boxIdx: [...partsOf(c.sc, ["joist"]), ...partsOf(c.sc, ["beam"])] }, `Joists past the beam · ${c.d.framing.overhangFt === "auto" ? "as the table allows" : feetWords(Number(c.d.framing.overhangFt) * 12)}`),
  },
  {
    when: (f) => isStep(f, "Frame") && named(f, "Beams", "Beam made of", "Beam size"),
    run: (c) => {
      const fr = c.s.frame;
      if (!fr) return null;
      return light(c, { boxIdx: [...partsOf(c.sc, ["beam"]), ...partsOf(c.sc, ["hardware"], /^post cap$/)] }, `Beams · ${unique(fr.beams.map((b) => b.spec.size)).join(", ")} · ${fr.beamStyle} · ${plural(fr.beams.length, "beam")}`);
    },
  },
  {
    when: (f) => isStep(f, "Frame") && named(f, "Posts"),
    run: (c) => {
      const fr = c.s.frame;
      if (!fr) return null;
      return light(c, { boxIdx: [...partsOf(c.sc, ["post"]), ...partsOf(c.sc, ["hardware"], /^(post base|post cap)$/)] }, `Posts · ${c.d.framing.post} · ${fr.posts.length} of them`);
    },
  },
  {
    when: (f) => named(f, "Ledger fastened with", "Ties to the house"),
    run: (c) => light(c, { boxIdx: [...partsOf(c.sc, ["ledger"]), ...partsOf(c.sc, ["hardware"], /^(ledger fastener|hold-down)$/)] }, named(c.f, "Ties to the house") ? "The ledger and its hold-downs to the house" : `The ledger · fastened with ${String(c.d.ledger.fastener).replace(/-/g, " ")}`),
  },
  /* Surface */
  {
    when: (f) => named(f, "Picture-frame border"),
    run: (c) => {
      const b = partsOf(c.sc, ["decking"], /^border board$/);
      // Its boards are mitred pieces (2026-11-13), not boxes: lit as the band they lie in, along every edge the border runs.
      const sf = c.s.surface;
      const band = sf && sf.border ? (sf.border * (sf.product.widthIn + sf.product.gapIn)) / 12 : 0;
      const z = c.s.frame ? c.s.frame.surfaceIn / 12 : c.sc.heightFt;
      const bars = sf && band ? sf.borderEdges.map((e) => bar(e.x0 / 12 + (e.inX * band) / 2, e.y0 / 12 + (e.inY * band) / 2, e.x1 / 12 + (e.inX * band) / 2, e.y1 / 12 + (e.inY * band) / 2, z, band)) : [];
      return light(c, { boxIdx: b, boxes: bars, diagonal: false }, c.s.surface?.border ? `Picture-frame border · ${plural(c.s.surface.border, "row")} of boards` : "No picture-frame border");
    },
  },
  {
    when: (f) => isStep(f, "Surface") && named(f, "Fascia"),
    run: (c) => {
      const fa = c.s.surface?.fascia;
      return light(c, { boxIdx: partsOf(c.sc, ["fascia"]) }, fa?.on ? `Fascia · ${Math.round(fa.lf)} ft of open edge` : "No fascia — the rim shows");
    },
  },
  {
    when: (f) => isStep(f, "Surface"),
    run: (c) => {
      const sf = c.s.surface;
      if (!sf) return null;
      return light(c, { boxIdx: partsOf(c.sc, ["decking"]), diagonal: true }, `Deck boards · ${sf.product.label}${sf.pattern !== "straight" ? ` · ${PATTERN_LABEL[sf.pattern as keyof typeof PATTERN_LABEL] ?? sf.pattern}` : ""}`);
    },
  },
  /* The roof */
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Height to the headers"),
    run: (c) => {
      const r = c.s.roof;
      if (!r) return null;
      return light(c, { boxIdx: [...partsOf(c.sc, ["roof-post"]), ...partsOf(c.sc, ["header"], /^header$/)] }, `Headers ${feetWords(c.d.roof.eaveHeightIn)} up`);
    },
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Posts"),
    run: (c) => (c.s.roof ? light(c, { boxIdx: [...partsOf(c.sc, ["roof-post"]), ...partsOf(c.sc, ["hardware"], /^post cap$/)] }, `Roof posts · ${c.d.roof.post} · ${c.s.roof.posts.length} of them`) : null),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, /^Headers/),
    run: (c) => (c.s.roof ? light(c, { boxIdx: partsOf(c.sc, ["header"], /^header$/) }, `Headers · ${unique(c.s.roof.headers.map((h) => h.spec.size)).join(", ")}`) : null),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Overhang past the posts", "Fascia finish"),
    run: (c) => light(c, { boxIdx: [...partsOf(c.sc, ["trim"]), ...partsOf(c.sc, ["gutter"])] }, named(c.f, "Fascia finish") ? `Fascia and soffit · ${c.d.roof.fascia.finish.replace(/-/g, " ")}` : `Eaves ${feetWords(c.d.roof.overhangIn)} past the posts`),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Walls between the posts", "Built like", "On how many sides"),
    run: (c) => light(c, { boxIdx: partsOf(c.sc, ["wall"]), polyIdx: facesOf(c.sc, ["wall", "screen", "glass"]) }, "The walls between the posts"),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Rafters", "Rafter spacing"),
    run: (c) => {
      const r = c.s.roof;
      if (!r) return null;
      const text = r.trusses ? `Trusses · ${r.trusses.count} at ${r.trusses.spacingIn} in. on center` : `Rafters · ${r.rafters.size} at ${r.rafters.spacingIn} in. on center · ${r.rafters.count} of them`;
      return light(c, { boxIdx: partsOf(c.sc, ["rafter"], /^(rafter|jack|fly|truss.*)$/) }, text);
    },
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "At the ridge", /^Cross beams/),
    run: (c) => (c.s.roof ? light(c, { boxIdx: [...partsOf(c.sc, ["ridge"]), ...partsOf(c.sc, ["rafter"], /^tie$/)] }, c.s.roof.ridge ? `At the ridge · ${c.s.roof.ridge.kind === "beam" ? `a ${c.s.roof.ridge.nominal} ridge beam` : c.s.roof.ridge.kind === "board" ? `a ${c.s.roof.ridge.nominal} ridge board` : "trusses"}` : "At the ridge") : null),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Slats", "Slat spacing"),
    run: (c) => light(c, { boxIdx: partsOf(c.sc, ["rafter"], /^slat$/) }, "The slats on top"),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Roofing", "Metal goes on", "Goes on like", "Roof load"),
    run: (c) => light(c, { polyIdx: facesOf(c.sc, ["roofing", "sheathing"]) }, `Roofing · ${ROOFING_LABEL[c.d.roof.roofing] ?? c.d.roof.roofing}`),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Ceiling"),
    run: (c) => light(c, { polyIdx: facesOf(c.sc, ["ceiling"]) }, `Ceiling · ${String(c.d.roof.ceiling).replace(/-/g, " ")}`),
  },
  {
    when: (f) => isStep(f, "step-roof") && named(f, "Gutters", "Hangs like"),
    run: (c) => light(c, { boxIdx: partsOf(c.sc, ["gutter"]) }, `Gutters · ${String(c.d.roof.gutters.kind).replace(/-/g, " ")}`),
  },
  {
    // Posts and openings set by hand (2026-11-13): the builder's own posts light — an opening's two, a post stood by
    // hand — with the door between them; the spacing lights every roof post. (They lit the whole roof, like any field
    // of the step with no part of its own: the two posts just set could not be told from it.)
    when: (f) => isStep(f, "step-roof") && named(f, "Its middle at", "Clear width", "Standing at", "A screen door in it now", "Posts no farther apart than"),
    run: (c) => {
      const r = c.s.roof;
      if (!r) return null;
      const mine = r.posts.filter((p) => p.by);
      const every = named(c.f, "Posts no farther apart than") || !mine.length;
      const posts = partsOf(c.sc, ["roof-post"]).filter((i) => every || mine.some((p) => Math.abs(c.sc.boxes[i][1] * 12 - p.x) < 1 && Math.abs(c.sc.boxes[i][2] * 12 - p.y) < 1));
      const doors = every ? [] : partsOf(c.sc, ["wall"], /^door$/);
      const said = [r.openings.length ? plural(r.openings.length, "opening") : "", r.pins.length ? plural(r.pins.length, "post") : ""].filter(Boolean).join(", ");
      return light(c, { boxIdx: [...posts, ...doors] }, every ? `Roof posts · ${c.d.roof.post} · ${r.posts.length} of them` : `Set by hand · ${said}`);
    },
  },
  {
    when: (f) => isStep(f, "step-roof"),
    run: (c) => {
      const r = c.s.roof;
      if (!r) return null;
      return light(c, { boxIdx: [...partsOf(c.sc, ["rafter"]), ...partsOf(c.sc, ["ridge"])], polyIdx: facesOf(c.sc, ["roofing"]) }, `Roof · ${ROOF_KIND_LABEL[r.kind] ?? r.kind}${c.d.structure === "pergola" ? "" : ` · ${c.d.roof.pitch}:12`}`);
    },
  },
  /* Lights, outlets and heaters */
  {
    when: (f) => isStep(f, "step-electrical") && !!f.fixture,
    run: (c) => {
      const placed = c.s.electrical.fixtures.filter((fx) => fx.designId === c.f.fixture);
      const at = new Set(placed.map((fx) => `${Math.round((fx.x / 12) * 100)}:${Math.round((fx.y / 12) * 100)}:${Math.round((fx.z / 12) * 100)}`));
      const mine = partsOf(c.sc, ["light"], undefined, "any").filter((i) => {
        const b = c.sc.boxes[i];
        return at.has(`${Math.round(b[1] * 100)}:${Math.round(b[2] * 100)}:${Math.round(b[3] * 100)}`);
      });
      const fd = c.d.electrical.fixtures.find((x) => x.id === c.f.fixture);
      if (!fd) return null;
      return light(c, { boxIdx: mine }, `${fd.custom?.name ?? FIXTURE_LABEL[fd.kind]} · ${placed.length} placed${fd.supply === "client" ? " · the client's own" : ""}`);
    },
  },
  {
    when: (f) => isStep(f, "step-electrical") && named(f, "Panel to the structure", "The feed comes from the"),
    run: (c) => light(c, { boxIdx: partsOf(c.sc, ["light"], /^(feed|transformer)$/, "any") }, `The feed from the house's panel · ${c.s.electrical.feedFt} ft`),
  },
];

/** What the field stands for in the 3D, or null when it has nothing there. */
export function fieldLight(sc: DeckScene, s: DeckStructure, f: FieldFocus): FieldLight | null {
  const c: Ctx = { sc, s, d: s.design, f };
  for (const r of RULES) {
    if (!r.when(f)) continue;
    try {
      return r.run(c);
    } catch {
      return null;
    }
  }
  return null;
}
