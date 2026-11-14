// THE HOUSE BUILT FROM ITS PHOTO (2026-10-23). Pure. Owner: "the client will just give the back wall picture where the
// deck will be, and we just upload it, and it just takes the shapes and move it into our 3D shaper … preliminary
// already pre-built the back wall, and then the only thing needed is just to adjust maybe sizing, how deep is it". Only
// the house itself — "read just a shape of that back wall and don't show existing deck or porch roofs, just shape and
// windows" (the same day).
//
// From the read (lib/deck/houseRead, in the picture's own fractions) and the picture's size:
//   · the SCALE — a wall width the contractor typed, else a measure drawn on the picture, else the back door's 80 in.,
//     else the wall's storeys to the eave (the roughest: said so);
//   · the WALL — its width, its steps (in the deck's feet, as the house keeps them), its storeys, its roof, what it is
//     clad in; every part of it as tall as the house under the one roof — the wall's shape, stepped (2026-10-23 evening,
//     owner: "it should make the shape of the back wall"; a lower roof over part of it was a porch roof he'd said to
//     leave out, and a one-storey block under its own roof is what it built);
//   · the DECK on it — centred on the back door, else on a patio at the wall's base, else in the middle; the wall's
//     reach past each end from there;
//   · the WINDOWS and DOORS where they are, their sizes and heights;
//   · the deck's height from the door's threshold (an inch below it), when there is a door;
//   · what was seen, what was guessed, and what to check, in words.
// The same read and the same picture always build the same house, so the QA script can prove it.

import { baseYAt, DOOR_HEIGHT_FT, JOG_DEFAULT_FT, scaleFromRead, type PhotoScale } from "./photoFit";
import { HOUSE_LIMITS, OPENING_LIMITS, isHouseHex, settleOpenings, toInchFt, wallParts, type HouseDesign, type HouseHex, type HouseJog, type HouseMaterial, type HouseOpening, type HousePart, type HousePhoto, type HouseRoof } from "./house";
import type { HouseRead } from "./houseRead";

export interface PhotoHouseInput {
  read: HouseRead;
  /** The picture the read is in, px. */
  photoW: number;
  photoH: number;
  /** The deck's width along the house, ft (the design's shape). */
  deckWidthFt: number;
  /** The house as it is now: what the photo does not say is kept from it. */
  house: HouseDesign;
  /** The wall's width the contractor typed (corner to corner), ft — the truest scale there is. */
  wallWidthFt?: number | null;
  /** The colours measured off the picture's pixels (the browser's), #rrggbb. */
  measured?: { siding: string | null; roof: string | null };
}

export interface PhotoFact {
  id: string;
  /** "Wall", "Windows", … */
  label: string;
  /** What was found, in words. */
  value: string;
  /** True when it is an estimate the contractor should look at. */
  guess: boolean;
  /** A colour to show beside it. */
  swatch?: string;
}

export interface PhotoHouse {
  house: HouseDesign;
  wallFt: number;
  scale: { pxPerFt: number; by: HousePhoto["by"] };
  /** Where the deck's left end stands along the wall from its left corner, ft. */
  deckAtFt: number;
  /** What the deck was centred on. */
  centredOn: "door" | "patio" | "middle";
  /** The deck's floor an inch below the back door's threshold, inches — null without a door. */
  heightIn: number | null;
  facts: PhotoFact[];
  /** What to look at before trusting it. */
  checks: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** "40 ft", "6 ft 8 in.", "3 ft 6 in." */
export function ftIn(ft: number): string {
  const inches = Math.round(ft * 12);
  const f = Math.floor(inches / 12);
  const i = inches % 12;
  if (f === 0) return `${i} in.`;
  return i ? `${f} ft ${i} in.` : `${f} ft`;
}

/** The scale the house is built at: a typed wall width first, then the read's own (a measure, the door, the storeys). */
export function houseScale(read: HouseRead, photoW: number, photoH: number, wallWidthFt?: number | null): { pxPerFt: number; by: HousePhoto["by"] } {
  const basePx = Math.hypot((read.base.right.x - read.base.left.x) * photoW, (read.base.right.y - read.base.left.y) * photoH);
  if (wallWidthFt && wallWidthFt >= 4 && basePx > 8) return { pxPerFt: basePx / wallWidthFt, by: "width" };
  // Any door gives the scale (they are all about 80 in. tall), the tallest in the picture first — never a garage door.
  const tallest = read.doors.filter((d) => d.kind !== "garage").sort((a, b) => b.bottom - b.top - (a.bottom - a.top))[0];
  const candidate = read.door ?? tallest ?? null;
  // A railing can hide half the entry. Treating that half as an 80-inch door
  // doubles every dimension. Cross-check against the wall before using it.
  const wallPx = read.eave ? ((read.base.left.y - read.eave.left.y + read.base.right.y - read.eave.right.y) / 2) * photoH : null;
  const doorPx = candidate ? (candidate.bottom - candidate.top) * photoH : 0;
  const storeyFt = wallPx && doorPx > 0 ? (wallPx / doorPx) * DOOR_HEIGHT_FT / (read.storeys ?? 1) : null;
  const sourceDoor = candidate ? read.doors.find((d) => Math.abs(d.x0 - candidate.x0) < 0.01 && Math.abs(d.x1 - candidate.x1) < 0.01) : null;
  const aspect = candidate && doorPx > 0 ? ((candidate.x1 - candidate.x0) * photoW) / doorPx : 0;
  const usableDoor = (storeyFt === null || (storeyFt >= 6 && storeyFt <= 12.5)) && !(sourceDoor?.kind === "hinged" && aspect > 0.65);
  const s: PhotoScale = scaleFromRead({ ...read, door: usableDoor ? candidate : null }, photoW, photoH);
  return { pxPerFt: s.pxPerFt, by: s.by === "line" ? "line" : s.by === "door" ? "door" : s.by === "eave" ? "eave" : "none" };
}

const ROOF_OF: Record<NonNullable<HouseRead["roof"]["kind"]>, HouseRoof> = { hip: "hip", "gable-side": "gable", "gable-end": "gable-end", shed: "shed", flat: "flat" };
const MATERIAL_OF: Record<NonNullable<HouseRead["material"]>, HouseMaterial> = { lap: "lap", brick: "brick", stucco: "stucco", "board-batten": "board-batten", stone: "stone", shingle: "lap" };
const ROOF_WORDS: Record<NonNullable<HouseRead["roof"]["kind"]>, string> = { hip: "hip roof", "gable-side": "gable roof, the ridge along this wall", "gable-end": "gable roof, its end facing the yard", shed: "shed roof", flat: "flat roof" };
const MATERIAL_WORDS: Record<NonNullable<HouseRead["material"]>, string> = { lap: "lap siding", brick: "brick", stucco: "stucco", "board-batten": "board and batten", stone: "stone", shingle: "shingle siding" };


/** The house the photo shows, with the deck set on its wall. Null when nothing in the picture gives a size. */
export function houseFromPhoto(input: PhotoHouseInput): PhotoHouse | null {
  const { read, photoW, photoH, deckWidthFt: W } = input;
  const scale = houseScale(read, photoW, photoH, input.wallWidthFt);
  if (!(scale.pxPerFt > 0)) return null;
  const k = scale.pxPerFt;
  const x0 = read.base.left.x;
  /** Feet along the wall from its left corner. */
  const along = (x: number) => ((x - x0) * photoW) / k;
  /** Feet above the ground at a point of the picture. */
  const above = (y: number, x: number) => ((baseYAt(read, x) - y) * photoH) / k;
  const wallFt = r2(along(read.base.right.x));
  const checks: string[] = [];
  const facts: PhotoFact[] = [];

  // THE DOORS — the back door is where the deck meets the house.
  const doors = read.doors.map((d) => {
    const cx = (d.x0 + d.x1) / 2;
    const widthFt = ((d.x1 - d.x0) * photoW) / k;
    const heightFt = ((d.bottom - d.top) * photoH) / k;
    // Size is not a door type: a scale error must never turn a painted entry into glass.
    const kind: HouseOpening["kind"] = d.kind === "garage" ? "garage" : d.kind === "slider" ? "slider" : "door";
    return { cx, atFt: along(cx), widthFt, heightFt, sillFt: Math.max(0, above(d.bottom, cx)), kind };
  });
  const within = (a: number, s: { x0: number; x1: number } | null) => !!s && a >= s.x0 - 0.01 && a <= s.x1 + 0.01;
  // The deck never meets a garage door (2026-10-26).
  const walkDoors = doors.filter((d) => d.kind !== "garage");
  const mainDoor = read.door
    ? (walkDoors.find((d) => Math.abs(d.cx - (read.door!.x0 + read.door!.x1) / 2) < 0.02) ?? null)
    : (walkDoors.find((d) => within(d.cx, read.patio)) ?? walkDoors.filter((d) => d.kind === "slider")[0] ?? walkDoors[0] ?? null);

  // WHERE THE DECK GOES along the wall, ft from the wall's left corner.
  const centreOf = (s: { x0: number; x1: number }) => along((s.x0 + s.x1) / 2);
  const [centre, centredOn]: [number, PhotoHouse["centredOn"]] = mainDoor
    ? [mainDoor.atFt, "door"]
    : read.patio
      ? [centreOf(read.patio), "patio"]
      : [wallFt / 2, "middle"];
  const deckAtFt = half(wallFt >= W ? clamp(centre - W / 2, 0, wallFt - W) : (wallFt - W) / 2);
  /** Feet in the deck's frame (from its left end) of a point along the wall. */
  const deckFt = (x: number) => along(x) - deckAtFt;
  const L = HOUSE_LIMITS.extendFt;
  const leftFt = half(clamp(deckAtFt, L.min, L.max));
  const rightFt = half(clamp(wallFt - deckAtFt - W, L.min, L.max));
  if (wallFt < W - 0.5) checks.push(`The deck (${ftIn(W)}) is wider than the wall seen (${ftIn(wallFt)}) — the house is drawn out to the deck's ends.`);

  // THE STEPS in the wall.
  // A divider the contractor left level on the review (depth 0) is no step.
  const jogs: HouseJog[] = read.jogs.filter((j) => j.depthFt === null || j.depthFt >= 0.25).slice(0, HOUSE_LIMITS.jogs).map((j, i) => ({ id: `j${i + 1}`, atFt: half(deckFt(j.x)), dir: j.dir, depthFt: half(clamp(j.depthFt ?? JOG_DEFAULT_FT, HOUSE_LIMITS.depthFt.min, HOUSE_LIMITS.depthFt.max)) }));
  const unsizedSteps = read.jogs.filter((j) => j.depthFt === null).length;

  // STOREYS, the roof, the cladding, the colours.
  const eaveFt = read.eave ? Math.max(above(read.eave.left.y, read.eave.left.x), above(read.eave.right.y, read.eave.right.x)) : null;
  const storeys: 1 | 2 = read.storeys ?? (eaveFt !== null ? (eaveFt >= 14 ? 2 : 1) : input.house.storeys);
  const roof: HouseRoof = read.roof.kind ? ROOF_OF[read.roof.kind] : input.house.roof;
  const material: HouseMaterial = read.material ? MATERIAL_OF[read.material] : (input.house.material ?? "lap");
  const sidingColour = pickColour(input.measured?.siding, read.colours.siding);
  const roofColour = pickColour(input.measured?.roof, read.colours.roof);

  // THE WINDOWS AND DOORS.
  const OL = OPENING_LIMITS;
  const seen: HouseOpening[] = [];
  for (const w of read.windows) {
    const cx = (w.x0 + w.x1) / 2;
    seen.push({ id: `w${seen.length + 1}`, kind: "window", xFt: toInchFt(deckFt(cx)), widthFt: toInchFt(clamp(((w.x1 - w.x0) * photoW) / k, OL.widthFt.min, OL.widthFt.max)), heightFt: toInchFt(clamp(((w.sill - w.head) * photoH) / k, OL.heightFt.min, OL.heightFt.max)), sillFt: toInchFt(clamp(above(w.sill, cx), OL.sillFt.min, OL.sillFt.max)) });
  }
  for (const d of doors) {
    seen.push({ id: `d${seen.length + 1}`, kind: d.kind, xFt: toInchFt(d.atFt - deckAtFt), widthFt: toInchFt(clamp(d.widthFt, OL.widthFt.min, OL.widthFt.max)), heightFt: toInchFt(clamp(d.heightFt, OL.heightFt.min, OL.heightFt.max)), sillFt: toInchFt(clamp(d.sillFt, 0, OL.sillFt.max)) });
  }
  seen.sort((a, b) => a.xFt - b.xFt || a.sillFt - b.sillFt);
  // None of them on another's spot: a window marked inside a door is the door's own glass (2026-11-13).
  const openings = settleOpenings(seen);
  // EACH PART'S OWN HEIGHT AND ROOF (2026-11-13, owner: "use the same roof as the picture"): a part the read saw one
  // storey tall under a lower roof of its own is built that way; every other step of the wall runs the house's full
  // height under the one roof, as before (a porch roof in front of the wall is never a part — the read leaves it out).
  const partEnds = (() => {
    const left = Math.min(read.base.left.x, read.base.right.x), right = Math.max(read.base.left.x, read.base.right.x);
    const kept = read.jogs.filter((j) => j.depthFt === null || j.depthFt >= 0.25).slice(0, HOUSE_LIMITS.jogs).map((j) => j.x);
    return [left, ...kept, right];
  })();
  const parts: Array<HousePart | null> = partEnds.slice(0, -1).map((x0, i) => {
    const x1 = partEnds[i + 1];
    let best: NonNullable<HouseRead["heights"]>[number] | null = null, most = 0;
    for (const h of read.heights ?? []) {
      const over = Math.min(x1, h.x1) - Math.max(x0, h.x0);
      if (over > most) { most = over; best = h; }
    }
    if (!best || most < 0.5 * (x1 - x0)) return null;
    const part: HousePart = {};
    if (storeys === 2 && best.storeys === 1) part.storeys = 1;
    if (best.roof) part.roof = best.roof;
    if (storeys === 2 && best.storeys === 1 && best.wing) part.wing = true;
    return part.storeys || part.roof ? part : null;
  });
  const shapeOfWall = wallParts({ ...input.house, leftFt, rightFt, jogs }, { kind: "rect", widthFt: W, depthFt: 12 });
  const tallBump = storeys === 2 && shapeOfWall.some((p, i) => p.depthFt > 0.4 && parts[i]?.storeys !== 1);
  const where = (i: number) => (parts.length <= 1 ? "the wall" : i === 0 ? "the left part" : i === parts.length - 1 ? "the right part" : parts.length === 3 ? "the middle part" : `part ${i + 1}`);
  const ownWords = parts.flatMap((part, i) => {
    if (!part) return [];
    const roofWord = part.roof ? (part.roof === "shed" ? "a lean-to roof" : `its own ${part.roof} roof`) : "its own roof";
    return part.storeys === 1 ? [`${where(i)} one storey under ${roofWord}${part.wing ? " (a wing)" : ""}`] : part.roof ? [`${where(i)} under ${roofWord}`] : [];
  });

  // THE DECK'S HEIGHT from the back door: an inch under its threshold.
  // A partial door is not a reliable threshold. Keep the current deck height until
  // its full frame is marked at a credible scale instead of raising the deck to a railing.
  const reliableThreshold = mainDoor && scale.by !== "eave" && mainDoor.heightFt >= 5 && mainDoor.heightFt <= 9;
  const thresholdIn = reliableThreshold ? Math.round(mainDoor.sillFt * 12) : null;
  const heightIn = thresholdIn !== null && thresholdIn >= 7 ? thresholdIn - 1 : null;

  const house: HouseDesign = {
    ...input.house,
    storeys,
    roof,
    leftFt,
    rightFt,
    jogs,
    siding: sidingColour ?? input.house.siding,
    roofColour: roofColour ?? input.house.roofColour,
    material,
    bumpOuts: "full",
    parts: parts.some(Boolean) ? parts : null,
    openings,
    // Keep the photo's vertical scale as well as its horizontal scale. A fixed two-storey
    // height used to discard upper windows and push a transom down into the entry door.
    eaveHeightFt: eaveFt !== null && eaveFt > 0 ? toInchFt(eaveFt) : undefined,
  };
  // The pitch the photo shows; else the one already set, when the roof is still the same shape; else the shape's own.
  const pitch = read.roof.pitch && roof !== "flat" ? read.roof.pitch : roof === input.house.roof ? input.house.pitch : undefined;
  if (pitch) house.pitch = pitch;
  else delete house.pitch;

  // IN WORDS — what was seen and what was guessed.
  const scaleWords = scale.by === "width" ? "the wall's width you typed" : scale.by === "line" ? (read.scaleLine?.kind === "storey" ? `one storey of the wall, window head to window head (${ftIn(read.scaleLine.lengthIn)})` : "your measure on the picture") : scale.by === "door" ? `the back door (${ftIn(DOOR_HEIGHT_FT)} tall)` : scale.by === "eave" ? `${storeys === 2 ? "two storeys" : "one storey"} of wall to the eave` : "nothing";
  const rough = scale.by === "eave";
  facts.push({ id: "wall", label: "Wall", value: `≈ ${ftIn(Math.round(wallFt * 2) / 2)} wide · sized by ${scaleWords}`, guess: rough });
  facts.push({ id: "storeys", label: "House", value: `${storeys === 2 ? "Two storeys" : "One storey"} · ${read.roof.kind ? ROOF_WORDS[read.roof.kind] : `${roof} roof (not seen — kept)`}${read.roof.pitch ? ` · about ${read.roof.pitch}/12` : ""}${ownWords.length ? ` · ${ownWords.join(", ")}` : ""}`, guess: !read.storeys || !read.roof.kind });
  facts.push({ id: "steps", label: "Steps", value: jogs.length ? `${plural(jogs.length, "step")} in the wall — ${jogs.map((j) => `${j.dir === "toward" ? "out" : "back"} ${ftIn(j.depthFt)}`).join(", ")}${tallBump ? " · the bump-out is as tall as the house" : ""}` : "A straight wall", guess: unsizedSteps > 0 });
  const winCount = openings.filter((o) => o.kind === "window").length;
  const stoodDoors = openings.filter((o) => o.kind !== "window");
  const doorWords = stoodDoors.length ? stoodDoors.map((d) => `${d.kind === "garage" ? "a garage door" : d.kind === "slider" ? "a sliding door" : "a door"} ${ftIn(Math.round(d.widthFt * 2) / 2)} wide`).join(", ") : "no door seen";
  facts.push({ id: "openings", label: "Openings", value: `${plural(winCount, "window")} · ${doorWords}`, guess: false });
  facts.push({ id: "look", label: "Siding", value: `${MATERIAL_WORDS[read.material ?? "lap"]}${sidingColour ? "" : " · colour kept"}`, guess: !read.material, ...(sidingColour ? { swatch: sidingColour } : {}) });
  if (roofColour) facts.push({ id: "roof-colour", label: "Roof colour", value: "from the picture", guess: false, swatch: roofColour });
  facts.push({ id: "deck", label: "The deck", value: centredOn === "middle" ? "In the middle of the wall" : `Centred on the ${centredOn}`, guess: false });

  if (rough) checks.push("Sized by the storeys, the roughest way — type the wall's width (corner to corner) for a true size.");
  if (rough && read.doors.some((d) => d.kind !== "garage")) checks.push("The door's marked height does not agree with the wall. Include its full frame behind any railing, or enter the measured wall width.");
  if (mainDoor && !reliableThreshold) checks.push("Deck height kept: mark the full door down to its threshold and check the scale before setting the deck floor from it.");
  if (!mainDoor) checks.push(doors.length ? "No door onto the deck seen (a garage door doesn't count) — if there is one, mark it, and the deck's height comes from its threshold." : "No back door seen — if there is one, mark it, and the deck's height comes from its threshold.");
  if (unsizedSteps) checks.push(`${unsizedSteps === 1 ? "The step's depth is" : "The steps' depths are"} a guess (${ftIn(JOG_DEFAULT_FT)}) — set ${unsizedSteps === 1 ? "it" : "them"} in the wall drawing.`);
  if (read.confidence < 0.5) checks.push("The picture was hard to read — look over the lines before building.");
  if (read.note) checks.push(read.note);

  return { house, wallFt, scale, deckAtFt, centredOn, heightIn, facts, checks };
}

/**
 * The house's colour: the picture's own pixels say how light it is, the read's daylight guess says what colour it is —
 * a sunset or a shade casts the pixels orange or blue (a grey house read at dusk measures brown), the model was asked
 * for the colour in plain daylight. Lightness between the two, hue and saturation the guess's; either alone when the
 * other is missing; null when neither.
 */
export function pickColour(measured: string | null | undefined, guess: string | null): HouseHex | null {
  const m = isHouseHex(measured) ? measured.toLowerCase() : null;
  const g = isHouseHex(guess) ? guess.toLowerCase() : null;
  if (m && g) {
    const hm = rgbToHsl(...hexRgb(m));
    const hg = rgbToHsl(...hexRgb(g));
    const [r, gg, b] = hslToRgb(hg[0], hg[1], clamp((hm[2] + hg[2]) / 2, 0.2, 0.92));
    const hx = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
    return `#${hx(r)}${hx(gg)}${hx(b)}` as HouseHex;
  }
  return (m ?? g) as HouseHex | null;
}
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/* ------------------------------------------------------------------ */
/*  The colours off the picture's pixels                                 */
/* ------------------------------------------------------------------ */

/**
 * The colour most of the samples share — the wall's, among its windows, trim and shadows: the darkest and the
 * brightest set aside, the rest counted in coarse bins, the fullest bin and its neighbours averaged. Then brought
 * toward a colour paint comes in: lightness held between 0.28 and 0.9, the colour a sunset or a shadow adds held to
 * 0.35 saturation. `rgb` is r, g, b, r, g, b, … 0–255. Null with too few samples.
 */
export function dominantColour(rgb: ArrayLike<number>, opts: { minSamples?: number; maxSat?: number } = {}): HouseHex | null {
  const n = Math.floor(rgb.length / 3);
  const BIN = 32;
  const counts = new Map<number, number>();
  const kept: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < 22 || luma > 246) continue;
    const key = Math.floor(r / BIN) * 64 + Math.floor(g / BIN) * 8 + Math.floor(b / BIN);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    kept.push(i);
  }
  if (kept.length < (opts.minSamples ?? 24)) return null;
  let best = -1;
  let most = -1;
  for (const [key, c] of counts) if (c > most) [best, most] = [key, c];
  const br = Math.floor(best / 64);
  const bg = Math.floor(best / 8) % 8;
  const bb = best % 8;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let m = 0;
  for (const i of kept) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    if (Math.abs(Math.floor(r / BIN) - br) <= 1 && Math.abs(Math.floor(g / BIN) - bg) <= 1 && Math.abs(Math.floor(b / BIN) - bb) <= 1) {
      sr += r;
      sg += g;
      sb += b;
      m++;
    }
  }
  if (!m) return null;
  return paintable(sr / m, sg / m, sb / m, opts.maxSat ?? 0.35);
}

/** A colour held to what paint looks like on a wall in the 3D: lightness 0.28–0.9, saturation at most `maxSat`. */
export function paintable(r: number, g: number, b: number, maxSat: number): HouseHex {
  const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
  const [r2_, g2, b2] = hslToRgb(h, Math.min(s, maxSat), clamp(l, 0.28, 0.9));
  const hx = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${hx(r2_)}${hx(g2)}${hx(b2)}` as HouseHex;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = (x: number) => {
    let v = x;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return [t(h + 1 / 3), t(h), t(h - 1 / 3)];
}

/**
 * Where to sample the wall's and the roof's colour on the picture, as fractions: the wall between its base and its
 * eave (or a storey's worth above the base), across its span, less every window and door with a margin;
 * the roof a band just above the eave. A point at (x, y) is sampled when `inWall` / `inRoof` say so.
 */
export function colourZones(read: HouseRead, photoW: number, photoH: number): { wall: (x: number, y: number) => boolean; roof: ((x: number, y: number) => boolean) | null; box: { x0: number; x1: number; y0: number; y1: number } } {
  const x0 = read.base.left.x;
  const x1 = read.base.right.x;
  const eaveY = (x: number) => {
    if (!read.eave) return baseYAt(read, x) - 0.25;
    const t = clamp((x - read.eave.left.x) / Math.max(1e-6, read.eave.right.x - read.eave.left.x), 0, 1);
    return read.eave.left.y + (read.eave.right.y - read.eave.left.y) * t;
  };
  const mx = 6 / photoW;
  const my = 6 / photoH;
  const holes = [
    ...read.windows.map((w) => ({ x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill })),
    ...read.doors.map((d) => ({ x0: d.x0, x1: d.x1, top: d.top, bottom: d.bottom })),
  ];
  const inset = (x1 - x0) * 0.03;
  const wall = (x: number, y: number) => {
    if (x < x0 + inset || x > x1 - inset) return false;
    const top = eaveY(x) + 0.02;
    const bottom = baseYAt(read, x) - 0.03;
    if (y < top || y > bottom) return false;
    return !holes.some((h) => x > h.x0 - mx && x < h.x1 + mx && y > h.top - my && y < h.bottom + my);
  };
  const roof = read.eave
    ? (x: number, y: number) => {
        if (x < x0 + inset || x > x1 - inset) return false;
        const e = eaveY(x);
        return y < e - 0.012 && y > e - 0.06;
      }
    : null;
  const top = read.eave ? Math.min(read.eave.left.y, read.eave.right.y) - 0.07 : Math.min(read.base.left.y, read.base.right.y) - 0.3;
  return { wall, roof, box: { x0, x1, y0: clamp(top, 0, 1), y1: clamp(Math.max(read.base.left.y, read.base.right.y), 0, 1) } };
}
