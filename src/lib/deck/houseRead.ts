// THE HOUSE READ OFF A PHOTO (2026-10-23). Pure. Owner: "when I upload the picture of the back wall … get from that
// picture the approximate shape already, and even windows and where the doors is, and if there is any jogs, and apply
// it to the 3D shaper … if it's a two-story, one-story, if it's a roof shape … even the color of the house … the client
// will just give the back wall picture where the deck will be, and we just upload it". The contractor can upload it too.
//
// The vision model reads the picture (actions/deckEstimator readHousePhoto) and answers with the wall read the smart fit
// already knows (lib/deck/photoFit WallRead — the base, the eave, the storeys, the steps, the back door, the windows)
// and what a HOUSE needs besides: every door in the wall and its kind, the roof's shape, what the wall is clad in, a
// guess at the colours. Only the house's own wall (owner, the same day: "read just a shape of that back wall and don't
// show existing deck or porch roofs, just shape and windows") — a porch roof, its posts, an old deck, a slab are told
// to the model as things to look past, never a step or an edge of the wall. Two looks (HOUSE_ZOOM_NOTE): the whole
// picture to find the wall, then the wall cut out and enlarged so every window reads at its size; both on a faint
// grid of tenths the studio draws, so the fractions are read off it rather than guessed. The arithmetic that turns it
// into the 3D house is lib/deck/houseFromPhoto; the colours are measured off the picture's own pixels in the browser,
// the model's guess only standing in when that fails.

import { z } from "zod";
import { JOG_DEFAULT_FT, parseWallRead, autoRectify, applyHomography, type RectifyPlan, type Pt, type WallRead } from "./photoFit";
import type { PartRoof } from "./house";

/** Straighten the wall while retaining complete opening boxes at its edges.
 * Axis-aligned boxes on an angled photo can extend above the sloping eave.
 * Pad the output instead of cropping those frames or abandoning perspective correction. */
export function rectifyHouseRead(read: HouseRead, w: number, h: number): RectifyPlan | null {
  const plan = autoRectify(read, w, h);
  if (!plan) return null;
  const boxes = [...read.windows.map((win) => ({ ...win, top: win.head, bottom: win.sill })), ...read.doors];
  const points = boxes.flatMap((b) => [b.x0, b.x1].flatMap((x) => [b.top, b.bottom].map((y) => applyHomography(plan.H, { x: x * w, y: y * h }))));
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const left = Math.floor(Math.min(0, ...points.map((p) => p.x - 2)));
  const top = Math.floor(Math.min(0, ...points.map((p) => p.y - 2)));
  const right = Math.ceil(Math.max(plan.w, ...points.map((p) => p.x + 2)));
  const bottom = Math.ceil(Math.max(plan.h, ...points.map((p) => p.y + 2)));
  // A large disagreement means the four wall corners need review first.
  if (right - left > plan.w * 1.25 || bottom - top > plan.h * 1.25) return null;
  const H = [...plan.H];
  for (let i = 0; i < 3; i++) { H[i] -= left * H[6 + i]; H[3 + i] -= top * H[6 + i]; }
  return { ...plan, H, w: right - left, h: bottom - top };
}

export type ReadDoorKind = "slider" | "hinged" | "french" | "garage";
export type ReadRoofKind = "hip" | "gable-side" | "gable-end" | "shed" | "flat";
export type ReadMaterial = "lap" | "brick" | "stucco" | "board-batten" | "stone" | "shingle";

/**
 * A stretch of the wall with a height or a roof of its own (2026-11-13, owner: "use the same roof as the picture"):
 * one storey where the house is two, under a lean-to, a hip, a gable or a flat roof lower than the main one; `wing`
 * when no taller wall of the house stands behind or above it. Kept as a stretch of the PICTURE (fractions of its
 * width), not as "part number n": the wall's steps are moved, added and taken away in the review, and a part takes
 * the stretch that covers most of it (sectionHeights).
 */
export interface ReadHeight {
  x0: number;
  x1: number;
  storeys: 1 | 2 | null;
  roof: PartRoof | null;
  wing: boolean;
}

/** What the model reads off the photo for the house, validated. Every coordinate a fraction of the picture it read. */
export interface HouseRead extends WallRead {
  /** Every door in that wall, left to right (the one onto the deck included — `door` keeps the back door itself). */
  doors: Array<{ x0: number; x1: number; bottom: number; top: number; kind: ReadDoorKind }>;
  roof: { kind: ReadRoofKind | null; /** rise in inches per foot of run, when it can be judged */ pitch: number | null };
  material: ReadMaterial | null;
  /** The model's guess at the colours, #rrggbb — the browser's measure of the pixels comes first. */
  colours: { siding: string | null; roof: string | null; trim: string | null };
  /** The house's own silhouette in the picture (2026-10-26) — its roof and its walls down to the ground, nothing
   *  standing in front of it: what the pixel passes may read as the house, the depth map's mask. Absent on an older
   *  read, or one the model gave none for. */
  outline?: Pt[];
  /** The stretches of the wall that have a height or a roof of their own; absent when every part stands under the main roof. */
  heights?: ReadHeight[];
}

const MAX_WINDOWS = 30;
const MAX_DOORS = 6;
const HEX = /^#[0-9a-f]{6}$/i;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const frac = (v: unknown, d: number) => clamp(num(v, d), -0.5, 1.5);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const span = (v: unknown, minW: number): { x0: number; x1: number } | null => {
  const o = obj(v);
  if (typeof o.x0 !== "number" || typeof o.x1 !== "number" || !Number.isFinite(o.x0) || !Number.isFinite(o.x1)) return null;
  const x0 = frac(Math.min(o.x0, o.x1), 0);
  const x1 = frac(Math.max(o.x0, o.x1), 0);
  return x1 - x0 >= minW ? { x0: r3(x0), x1: r3(x1) } : null;
};
/** A box with a top and a bottom (a door, a window), the two put the right way up. */
const box = (v: unknown, minW: number, minH: number, bottomKey: string, topKey: string): { x0: number; x1: number; bottom: number; top: number } | null => {
  const s = span(v, minW);
  const o = obj(v);
  const b = o[bottomKey];
  const t = o[topKey];
  if (!s || typeof b !== "number" || typeof t !== "number" || !Number.isFinite(b) || !Number.isFinite(t)) return null;
  const bottom = r3(frac(Math.max(b, t), 0));
  const top = r3(frac(Math.min(b, t), 0));
  return bottom - top >= minH ? { ...s, bottom, top } : null;
};
const hex = (v: unknown): string | null => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

const DOOR_KINDS: ReadonlySet<string> = new Set(["slider", "hinged", "french", "garage"]);
const ROOF_KINDS: ReadonlySet<string> = new Set(["hip", "gable-side", "gable-end", "shed", "flat"]);
/** What a model says the wall is clad in, in the words it may use. */
const MATERIAL_WORDS: ReadonlyArray<[RegExp, ReadMaterial]> = [
  [/brick/i, "brick"],
  [/stucco|plaster|render|eifs/i, "stucco"],
  [/board.?(and|&|n).?batten|batten/i, "board-batten"],
  [/stone|rock/i, "stone"],
  [/shingle|shake|cedar shake/i, "shingle"],
  [/lap|vinyl|clapboard|fiber.?cement|hardie|wood siding|siding|horizontal/i, "lap"],
];

const PART_ROOF_WORDS: Record<string, PartRoof> = { "lean-to": "shed", shed: "shed", hip: "hip", gable: "gable", flat: "flat" };
/** A section's (or a saved stretch's) own height and roof, as the model or the saved read gives them. */
function heightOf(o: Record<string, unknown>): { storeys: 1 | 2 | null; roof: PartRoof | null; wing: boolean } {
  return {
    storeys: o.storeys === 1 || o.storeys === 2 ? o.storeys : null,
    roof: typeof o.roof === "string" ? (PART_ROOF_WORDS[o.roof] ?? null) : null,
    wing: o.wing === true,
  };
}

/** The model's JSON, checked field by field; null when there is no usable wall in it. */
export function parseHouseRead(raw: unknown): HouseRead | null {
  const r = obj(raw);
  // The wall's sections (2026-10-23) say its steps better than a list of steps does — the model has to say where each
  // plane is and why: the steps are taken from where one section meets the next, the model's own steps only without.
  const sections = (Array.isArray(r.sections) ? r.sections : [])
    .map((x) => {
      const o = obj(x);
      const sp = span(x, 0.01);
      return sp && typeof o.outFt === "number" && Number.isFinite(o.outFt) ? { ...sp, outFt: clamp(o.outFt, -20, 20), ...heightOf(o) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.x0 - b.x0);
  const fromSections =
    sections.length >= 1
      ? sections.slice(1).flatMap((sec, i) => {
          const prev = sections[i];
          const d = sec.outFt - prev.outFt;
          if (Math.abs(d) < 0.5) return [];
          return [{ x: r3((prev.x1 + sec.x0) / 2), dir: d > 0 ? "toward" : "away", depthFt: Math.round(Math.abs(d) * 2) / 2 }];
        })
      : null;
  // The wall's own read — with room for more windows than the smart fit kept (a house has more than twelve).
  const wall = parseWallRead({ ...r, windows: [], ...(fromSections ? { jogs: fromSections } : {}) });
  if (!wall) return null;
  const windows = (Array.isArray(r.windows) ? r.windows : [])
    .map((w) => {
      const b = box(w, 0.006, 0.012, "sill", "head");
      return b ? { x0: b.x0, x1: b.x1, sill: b.bottom, head: b.top } : null;
    })
    .filter((w): w is NonNullable<typeof w> => !!w)
    .sort((a, b) => a.x0 - b.x0 || a.head - b.head)
    .slice(0, MAX_WINDOWS);
  const doors = (Array.isArray(r.doors) ? r.doors : [])
    .map((d) => {
      const b = box(d, 0.012, 0.04, "bottom", "top");
      if (!b) return null;
      const k = obj(d).kind;
      const kind: ReadDoorKind = typeof k === "string" && DOOR_KINDS.has(k) ? (k as ReadDoorKind) : "hinged";
      return { ...b, kind };
    })
    .filter((d): d is NonNullable<typeof d> => !!d)
    .sort((a, b) => a.x0 - b.x0)
    .slice(0, MAX_DOORS);
  // The back door is one of the doors: a model that named it only as `door` gets it in the list too.
  if (wall.door && !doors.some((d) => Math.abs((d.x0 + d.x1) / 2 - (wall.door!.x0 + wall.door!.x1) / 2) < 0.02)) {
    const w = (wall.door.x1 - wall.door.x0) / Math.max(0.001, wall.door.bottom - wall.door.top);
    doors.push({ ...wall.door, kind: w > 0.75 ? "slider" : "hinged" });
    doors.sort((a, b) => a.x0 - b.x0);
  }
  // And no window where a door stands (a model that called a sliding door both).
  const clearOfDoors = windows.filter((w) => !doors.some((d) => Math.min(w.x1, d.x1) - Math.max(w.x0, d.x0) > 0.6 * (w.x1 - w.x0) && Math.min(w.sill, d.bottom) - Math.max(w.head, d.top) > 0.6 * (w.sill - w.head)));
  const roofRaw = obj(r.roof);
  const roofKind = typeof roofRaw.kind === "string" && ROOF_KINDS.has(roofRaw.kind) ? (roofRaw.kind as ReadRoofKind) : typeof r.roof === "string" && ROOF_KINDS.has(r.roof) ? (r.roof as ReadRoofKind) : null;
  const pitch = typeof roofRaw.pitch === "number" && Number.isFinite(roofRaw.pitch) && roofRaw.pitch > 0 ? Math.round(clamp(roofRaw.pitch, 1, 18) * 2) / 2 : null;
  const matWord = typeof r.material === "string" ? r.material : "";
  const material = MATERIAL_WORDS.find(([re]) => re.test(matWord))?.[1] ?? null;
  const c = obj(r.colours ?? r.colors);
  // The house's silhouette (2026-10-26): a polygon of at least three points, at most 32, kept only when given.
  const outline = (Array.isArray(r.outline) ? r.outline : [])
    .map((p) => {
      const o = obj(p);
      return typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: r3(frac(o.x, 0)), y: r3(frac(o.y, 0)) } : null;
    })
    .filter((p): p is Pt => !!p)
    .slice(0, 32);
  // The stretches with a height or a roof of their own: from the sections that said so (a one-storey section of a
  // two-storey house, a section under its own roof), or as a saved read kept them.
  const saved = (Array.isArray(r.heights) ? r.heights : []).map((x) => { const sp = span(x, 0.01); return sp ? { ...sp, ...heightOf(obj(x)) } : null; }).filter((x): x is ReadHeight => !!x);
  const told = sections.filter((x) => (x.storeys === 1 && wall.storeys !== 1) || x.roof !== null || x.wing).map((x) => ({ x0: r3(x.x0), x1: r3(x.x1), storeys: x.storeys, roof: x.roof, wing: x.wing }));
  const heights = (saved.length ? saved : told).filter((x) => x.storeys !== null || x.roof !== null || x.wing).slice(0, 6);
  return {
    ...wall,
    windows: clearOfDoors,
    doors,
    roof: { kind: roofKind, pitch },
    material,
    colours: { siding: hex(c.siding), roof: hex(c.roof), trim: hex(c.trim) },
    ...(outline.length >= 3 ? { outline } : {}),
    ...(heights.length ? { heights } : {}),
  };
}

/** A house read kept in a design: checked again on the way back in; an older read without the house's fields still loads. */
export function normalizeHouseRead(raw: unknown): HouseRead | null {
  return raw && typeof raw === "object" ? parseHouseRead(raw) : null;
}

/** The read carried into another picture (a crop, or the straightened picture): the wall's lines by `wallMap`, the house's own boxes the same way. */
export function mapHouseRead(read: HouseRead, wallMap: (r: WallRead) => WallRead, pt: (p: { x: number; y: number }) => { x: number; y: number }): HouseRead {
  const wall = wallMap(read);
  const boxOf = (b: { x0: number; x1: number; bottom: number; top: number }) => {
    const cx = (b.x0 + b.x1) / 2;
    const bl = pt({ x: b.x0, y: b.bottom });
    const br = pt({ x: b.x1, y: b.bottom });
    const bc = pt({ x: cx, y: b.bottom });
    const tc = pt({ x: cx, y: b.top });
    return { x0: r3(Math.min(bl.x, br.x)), x1: r3(Math.max(bl.x, br.x)), bottom: r3(bc.y), top: r3(Math.min(tc.y, bc.y - 0.001)) };
  };
  return {
    ...wall,
    doors: read.doors.map((d) => ({ ...boxOf(d), kind: d.kind })),
    roof: read.roof,
    material: read.material,
    colours: read.colours,
    ...(read.outline
      ? {
          outline: read.outline.map((p) => {
            const q = pt(p);
            return { x: r3(q.x), y: r3(q.y) };
          }),
        }
      : {}),
  };
}

/** The prompt the house read runs on — the wall's JSON (as the smart fit reads it) and the house's own fields. */
export const HOUSE_READ_PROMPT = `You read one photo of the back (or side) of a house, taken from the yard, for a deck builder who will rebuild that house's wall as a simple 3D model. Read ONLY the house itself — its wall, its windows, its doors, its roof. Answer with ONE JSON object and nothing else.
COORDINATES: every coordinate is a FRACTION of the whole picture: x from 0 at the left edge to 1 at the right edge, y from 0 at the top edge to 1 at the bottom edge. The picture carries a faint grid with a line every 0.1, labelled along the edges — read each position off that grid (to the nearest 0.005), do not guess.
{
  "base": {"left": {"x","y"}, "right": {"x","y"}},   // the house wall's bottom edge where the WALL meets the ground (or would meet it behind a patio, steps or a deck), at the house's left corner and at its right corner — the whole back face of the house, across every step in it.
  "eave": {"left": {"x","y"}, "right": {"x","y"}} | null,   // the top of that wall above each corner: the underside of the MAIN roof's eave (on a two-storey house, the eave over the upper floor).
  "storeys": 1 | 2 | null,   // storeys of wall between the base and that eave (count the rows of windows).
  "sections": [{"x0", "x1", "outFt": number, "why": string}],   // FIRST work out the wall's sections, left to right from its left corner to its right corner: a section is a stretch of the house's wall whose face is one flat plane. "outFt" is how far that section's face stands IN FRONT of the main wall (the main wall — the widest stretch — is 0; a bump-out or a bay is +2 to +4; a part set back is negative). "why" is the evidence you see for that section's plane: its own corner boards at both its ends, its own eave or roof edge in front of the main eave, a shadow down the wall at its side, its siding meeting the next section at a corner. A porch roof, a patio roof or an awning in front of the wall does NOT make a section: the wall under it and behind it is the main wall unless its OWN face steps. A lower roof over only the GROUND storey of part of a two-storey wall, with that part's upper-storey windows above it, is a porch roof or a lean-to — that stretch is NOT a bump-out unless its upper storey stands forward too (its own corner boards up both storeys, its own hip or gable in the main roof). One section when the wall is one flat face.
  "jogs": [{"x", "y", "dir": "toward" | "away", "depthFt": number}],   // the same steps as places: where one section meets the next (x, y on the base), "toward" when the section to the RIGHT is nearer the camera, "away" when it is farther, depthFt the difference. [] when one section.
  "door": {"x0", "x1", "bottom", "top"} | null,   // the back door onto the yard: its left and right edges, its threshold and the top of its frame. Null when you cannot see one.
  "doors": [{"x0", "x1", "bottom", "top", "kind": "slider" | "hinged" | "french"}],   // EVERY door in the wall, the back door included. [] when none.
  "windows": [{"x0", "x1", "sill", "head"}],   // EVERY window in the wall, both storeys: the outside edges of its frame left and right, its sill (bottom) and its head (top). Windows side by side are one entry PER window — count them. Not the doors.
  "patio": {"x0", "x1"} | null,   // a concrete patio or slab at the wall's base: its ends along the wall (only to know where a deck would go).
  "roof": {"kind": "hip" | "gable-side" | "gable-end" | "shed" | "flat", "pitch": number | null},   // the MAIN roof of the house: hip (slopes on every side), gable-side (the ridge runs along this wall, triangles at the sides), gable-end (a triangle of wall faces the camera), shed, flat; pitch in inches of rise per foot when you can judge it (a usual house is 4 to 8).
  "material": "lap" | "brick" | "stucco" | "board-batten" | "stone" | "shingle",   // what most of the wall is clad in (lap = horizontal siding, vinyl or fiber cement).
  "colours": {"siding": "#rrggbb", "roof": "#rrggbb", "trim": "#rrggbb"},   // your best guess at the real colours as in plain daylight (not the sunset, not the shadow).
  "bars": {"top", "bottom"},   // black bands or a phone's status bar at the top and the bottom, as fractions of the height; 0 when none.
  "confidence": 0..1,   // how sure you are of the corners, the steps and the windows.
  "note": string | null   // one short sentence a deck builder should know (a meter or a dryer vent on the wall, the ground sloping), else null.
}
LOOK PAST, NEVER READ AS THE WALL: a porch roof or a covered patio's roof standing out in front of the wall, its posts and beams, an awning, a pergola, an old deck and its railing, stairs, a slab, a fence, a hedge, trees, a neighbour's house, a car. None of them is a step in the wall, an edge of the wall or its eave: a porch roof's low edge is not the eave; its post is not a corner. Read the house wall behind them.
Rules: a standard exterior door is about 80 inches tall and a usual window about 3 to 4 ft wide — use them to judge sizes; never invent a door, a window or a step you cannot see.`;

/** Said with the second look, on the wall cut out of the picture and enlarged. */
export const HOUSE_ZOOM_NOTE = "This picture is the house's wall cut out of a wider photo and enlarged: the wall fills most of it. Read it the same way — the fractions are of THIS picture.";

/* ------------------------------------------------------------------ */
/*  The read fixed by hand on the review (2026-10-23)                   */
/* ------------------------------------------------------------------ */

/** A handle on the review picture: the wall's base and eave ends, a step, a door (its foot or its top), a window (its middle). */
export type HouseMark = "base-left" | "base-right" | "eave-left" | "eave-right" | `jog-${number}` | `door-${number}` | `door-top-${number}` | `win-${number}` | `${"win" | "door"}-${"nw" | "ne" | "sw" | "se"}-${number}`;

/** Edit one photo box without re-sorting it or changing the other openings. */
export function editReadOpening(read: HouseRead, kind: "win" | "door", i: number, patch: Partial<{ x0: number; x1: number; top: number; bottom: number; kind: ReadDoorKind }>): HouseRead {
  const original = kind === "win" ? read.windows[i] : read.doors[i];
  if (!original) return read;
  const b = kind === "win" ? { ...read.windows[i], top: read.windows[i].head, bottom: read.windows[i].sill } : read.doors[i];
  const x0 = r3(clamp(num(patch.x0, b.x0), 0, Math.min(0.994, num(patch.x1, b.x1) - 0.006)));
  const x1 = r3(clamp(num(patch.x1, b.x1), x0 + 0.006, 1));
  const top = r3(clamp(num(patch.top, b.top), 0, Math.min(0.988, num(patch.bottom, b.bottom) - 0.012)));
  const bottom = r3(clamp(num(patch.bottom, b.bottom), top + 0.012, 1));
  if (kind === "win") return { ...read, windows: read.windows.map((w, k) => k === i ? { x0, x1, head: top, sill: bottom } : w) };
  const d = read.doors[i];
  const moved = { ...d, x0, x1, top, bottom, kind: patch.kind ?? d.kind };
  return { ...read, doors: read.doors.map((v, k) => k === i ? moved : v), door: sameDoor(read.door, d) ? (moved.kind === "garage" ? null : { x0, x1, top, bottom }) : read.door };
}

const inside = (p: { x: number; y: number }) => ({ x: r3(clamp(p.x, 0, 1)), y: r3(clamp(p.y, 0, 1)) });
const baseAt = (read: WallRead, x: number) => {
  const { left, right } = read.base;
  const t = right.x - left.x < 1e-6 ? 0 : clamp((x - left.x) / (right.x - left.x), 0, 1);
  return left.y + (right.y - left.y) * t;
};

/** A house read to start from when the picture could not be read: the wall across the lower middle, nothing on it — marked by hand. */
export function blankHouseRead(): HouseRead {
  return {
    base: { left: { x: 0.1, y: 0.78 }, right: { x: 0.9, y: 0.78 } },
    eave: { left: { x: 0.1, y: 0.42 }, right: { x: 0.9, y: 0.42 } },
    storeys: 1,
    jogs: [],
    door: null,
    windows: [],
    patio: null,
    scaleLine: null,
    bars: { top: 0, bottom: 0 },
    confidence: 1,
    note: null,
    doors: [],
    roof: { kind: null, pitch: null },
    material: null,
    colours: { siding: null, roof: null, trim: null },
  };
}

/** One handle moved to `p` (fractions of the picture); everything else stands. A door moves on its foot, a window by its middle. */
export function moveHouseMark(read: HouseRead, mark: HouseMark, p: { x: number; y: number }): HouseRead {
  const q = inside(p);
  const corner = /^(win|door)-(nw|ne|sw|se)-(\d+)$/.exec(mark);
  if (corner) return editReadOpening(read, corner[1] as "win" | "door", Number(corner[3]), {
    [corner[2].endsWith("w") ? "x0" : "x1"]: q.x,
    [corner[2].startsWith("n") ? "top" : "bottom"]: q.y,
  });
  if (mark === "base-left") return { ...read, base: { ...read.base, left: { x: Math.min(q.x, read.base.right.x - 0.05), y: q.y } } };
  if (mark === "base-right") return { ...read, base: { ...read.base, right: { x: Math.max(q.x, read.base.left.x + 0.05), y: q.y } } };
  if (mark === "eave-left" || mark === "eave-right") {
    const e = read.eave ?? { left: { x: read.base.left.x, y: read.base.left.y - 0.3 }, right: { x: read.base.right.x, y: read.base.right.y - 0.3 } };
    const side = mark === "eave-left" ? "left" : "right";
    const y = Math.min(q.y, read.base[side].y - 0.04);
    return { ...read, eave: { ...e, [side]: { x: q.x, y: r3(y) } } };
  }
  let m = /^jog-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    if (!read.jogs[i]) return read;
    const x = r3(clamp(q.x, read.base.left.x + 0.02, read.base.right.x - 0.02));
    return { ...read, jogs: read.jogs.map((j, k) => (k === i ? { ...j, x, y: r3(baseAt(read, x)) } : j)).sort((a, b) => a.x - b.x) };
  }
  m = /^door-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    const d = read.doors[i];
    if (!d) return read;
    const half = (d.x1 - d.x0) / 2;
    const h = d.bottom - d.top;
    const cx = clamp(q.x, half, 1 - half);
    const bottom = clamp(q.y, h + 0.02, 1);
    const moved = { ...d, x0: r3(cx - half), x1: r3(cx + half), bottom: r3(bottom), top: r3(bottom - h) };
    return { ...read, doors: read.doors.map((x, k) => (k === i ? moved : x)), door: sameDoor(read.door, d) ? { x0: moved.x0, x1: moved.x1, bottom: moved.bottom, top: moved.top } : read.door };
  }
  m = /^door-top-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    const d = read.doors[i];
    if (!d) return read;
    const moved = { ...d, top: r3(Math.min(q.y, d.bottom - 0.03)) };
    return { ...read, doors: read.doors.map((x, k) => (k === i ? moved : x)), door: sameDoor(read.door, d) ? { x0: moved.x0, x1: moved.x1, bottom: moved.bottom, top: moved.top } : read.door };
  }
  m = /^win-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    const w = read.windows[i];
    if (!w) return read;
    const hw = (w.x1 - w.x0) / 2;
    const hh = (w.sill - w.head) / 2;
    const cx = clamp(q.x, hw, 1 - hw);
    const cy = clamp(q.y, hh, 1 - hh);
    return { ...read, windows: read.windows.map((x, k) => (k === i ? { x0: r3(cx - hw), x1: r3(cx + hw), head: r3(cy - hh), sill: r3(cy + hh) } : x)) };
  }
  return read;
}

const sameDoor = (a: WallRead["door"], b: { x0: number; x1: number }) => !!a && Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) < 0.005;

/** The size of a foot on the picture, for things put on by hand: the read's own scale (a door, the storeys), else a guess. */
function footOf(read: HouseRead, photoW: number, photoH: number): { fx: number; fy: number } {
  const d = read.doors[0] ?? read.door;
  let pxPerFt = 0;
  if (d) pxPerFt = ((d.bottom - d.top) * photoH) / (80 / 12);
  else if (read.eave) pxPerFt = (((read.base.left.y - read.eave.left.y + read.base.right.y - read.eave.right.y) / 2) * photoH) / (9 * (read.storeys ?? 1));
  if (!(pxPerFt > 0)) pxPerFt = photoH / 30;
  return { fx: pxPerFt / photoW, fy: pxPerFt / photoH };
}

/** A window put in the middle of the wall's first storey, 3 × 4 ft at the picture's scale. */
export function addReadWindow(read: HouseRead, photoW: number, photoH: number): HouseRead {
  if (read.windows.length >= MAX_WINDOWS) return read;
  const { fx, fy } = footOf(read, photoW, photoH);
  const cx = (read.base.left.x + read.base.right.x) / 2;
  const sill = baseAt(read, cx) - 3 * fy;
  return { ...read, windows: [...read.windows, { x0: r3(cx - 1.5 * fx), x1: r3(cx + 1.5 * fx), head: r3(sill - 4 * fy), sill: r3(sill) }] };
}
export const removeReadWindow = (read: HouseRead, i: number): HouseRead => ({ ...read, windows: read.windows.filter((_, k) => k !== i) });

/** A door put on the wall's base at its middle — a 6-ft slider, 80 in. tall at the picture's scale — and made the back door. */
export function addReadDoor(read: HouseRead, photoW: number, photoH: number): HouseRead {
  if (read.doors.length >= MAX_DOORS) return read;
  const { fx, fy } = footOf(read, photoW, photoH);
  const cx = (read.base.left.x + read.base.right.x) / 2;
  const bottom = baseAt(read, cx) - 0.5 * fy;
  const d = { x0: r3(cx - 3 * fx), x1: r3(cx + 3 * fx), bottom: r3(bottom), top: r3(Math.max(0.02, bottom - (80 / 12) * fy)), kind: "slider" as const };
  return { ...read, doors: [...read.doors, d].sort((a, b) => a.x0 - b.x0), door: { x0: d.x0, x1: d.x1, bottom: d.bottom, top: d.top } };
}
export function removeReadDoor(read: HouseRead, i: number): HouseRead {
  const d = read.doors[i];
  if (!d) return read;
  return { ...read, doors: read.doors.filter((_, k) => k !== i), door: sameDoor(read.door, d) ? null : read.door };
}

/** A step put in the wall at its middle, the part to its right 2 ft nearer. */
export function addReadJog(read: HouseRead): HouseRead {
  if (read.jogs.length >= 4) return read;
  // In the middle of the widest part of the wall — a second step splits a part, never lands on the first. It divides the
  // part and changes nothing yet (depth 0): the contractor drags it to the corner, then taps the part that comes out.
  const parts = readSections(read);
  const at = parts.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 + 1e-9 ? b : a), parts[0] ?? { x0: read.base.left.x, x1: read.base.right.x, outFt: 0 });
  const x = r3((at.x0 + at.x1) / 2);
  return { ...read, jogs: [...read.jogs, { x, y: r3(baseAt(read, x)), dir: "toward" as const, depthFt: 0 }].sort((a, b) => a.x - b.x) };
}
/* ── The wall as its parts (2026-10-23 evening — owner: "it should make the shape of the back wall … make it simple
   to convert that 3D shaper into the wall shape from the picture") ── */

/** A stretch of the wall between its corners and its steps, and how far its face stands out of the main wall (the
 *  widest stretch, 0): + comes out toward the yard, − is set back. */
export type ReadSection = { x0: number; x1: number; outFt: number };

/** The wall's parts, left to right, from its corners and its steps. */
export function readSections(read: HouseRead): ReadSection[] {
  const left = Math.min(read.base.left.x, read.base.right.x);
  const right = Math.max(read.base.left.x, read.base.right.x);
  const jogs = read.jogs.filter((j) => j.x > left && j.x < right).sort((a, b) => a.x - b.x);
  const xs = [left, ...jogs.map((j) => j.x), right];
  let out = 0;
  const raw: ReadSection[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    raw.push({ x0: xs[i], x1: xs[i + 1], outFt: out });
    const j = jogs[i];
    if (j) out += (j.dir === "toward" ? 1 : -1) * (j.depthFt ?? JOG_DEFAULT_FT);
  }
  // The main wall is the widest stretch (the one nearer 0 on a tie): the rest are counted from it.
  const main = raw[mainSection(raw)]?.outFt ?? 0;
  return raw.map((x) => ({ ...x, outFt: Math.round((x.outFt - main) * 2) / 2 }));
}

/** Which part is the main wall — the widest (the one nearer the house line on a tie). The others are set out or back
 *  from it; it is the reference, so it is not itself set out or back. */
export function mainSection(sections: ReadSection[]): number {
  let best = 0;
  for (let i = 1; i < sections.length; i++) {
    const w = sections[i].x1 - sections[i].x0;
    const bw = sections[best].x1 - sections[best].x0;
    if (w > bw + 1e-9 || (Math.abs(w - bw) < 1e-9 && Math.abs(sections[i].outFt) < Math.abs(sections[best].outFt))) best = i;
  }
  return best;
}

/** One part of the wall set out (+) or back (−) of the main wall — the steps on either side follow. A step left with no
 *  difference stays as a divider (depth 0, built as nothing) — so a part set level and set out again keeps its corners. */
export function setSectionOut(read: HouseRead, i: number, outFt: number): HouseRead {
  const secs = readSections(read);
  if (!secs[i]) return read;
  const outs = secs.map((x) => x.outFt);
  outs[i] = Math.round(clamp(outFt, -8, 8) * 2) / 2;
  const left = Math.min(read.base.left.x, read.base.right.x);
  const right = Math.max(read.base.left.x, read.base.right.x);
  const jogs = read.jogs
    .filter((j) => j.x > left && j.x < right)
    .sort((a, b) => a.x - b.x)
    .map((j, k) => {
      const d = outs[k + 1] - outs[k];
      return { ...j, dir: d < 0 ? ("away" as const) : ("toward" as const), depthFt: Math.abs(d) < 0.25 ? 0 : Math.round(Math.abs(d) * 2) / 2 };
    });
  return { ...read, jogs };
}

/**
 * Each part's own height and roof, where it has them: the stretch that covers most of the part (half of it or more).
 * Null for a part that stands under the main roof like the rest.
 */
export function sectionHeights(read: HouseRead): Array<ReadHeight | null> {
  return readSections(read).map((sec) => {
    let best: ReadHeight | null = null, most = 0;
    for (const h of read.heights ?? []) {
      const over = Math.min(sec.x1, h.x1) - Math.max(sec.x0, h.x0);
      if (over > most) { most = over; best = h; }
    }
    return best && most >= 0.5 * (sec.x1 - sec.x0) ? best : null;
  });
}
/** One part given a height and a roof of its own — or, with null, put back under the main roof. */
export function setSectionHeight(read: HouseRead, i: number, to: { storeys: 1 | 2 | null; roof: PartRoof | null; wing: boolean } | null): HouseRead {
  const sec = readSections(read)[i];
  if (!sec) return read;
  // what the other stretches keep of themselves outside this part
  const rest = (read.heights ?? []).flatMap((h): ReadHeight[] => {
    const out: ReadHeight[] = [];
    if (h.x0 < sec.x0 - 0.005) out.push({ ...h, x1: Math.min(h.x1, sec.x0) });
    if (h.x1 > sec.x1 + 0.005) out.push({ ...h, x0: Math.max(h.x0, sec.x1) });
    return out.filter((x) => x.x1 - x.x0 > 0.01);
  });
  const heights = (to && (to.storeys !== null || to.roof !== null || to.wing) ? [...rest, { x0: r3(sec.x0), x1: r3(sec.x1), ...to }] : rest).sort((a, b) => a.x0 - b.x0);
  const bare: HouseRead = { ...read };
  delete bare.heights;
  return heights.length ? { ...bare, heights } : bare;
}

export const removeReadJog = (read: HouseRead, i: number): HouseRead => ({ ...read, jogs: read.jogs.filter((_, k) => k !== i) });
export const flipReadJog = (read: HouseRead, i: number): HouseRead => ({ ...read, jogs: read.jogs.map((j, k) => (k === i ? { ...j, dir: j.dir === "toward" ? ("away" as const) : ("toward" as const) } : j)) });

/* ------------------------------------------------------------------ */
/*  The second look: the wall cut out and enlarged (2026-10-23)          */
/* ------------------------------------------------------------------ */

/** A cut of a picture, as fractions of it. */
export interface ReadCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where to cut the wall out for the second look: around its corners, its eave and every window and door the first look
 * found, with a margin (the roof's edge above the eave kept in), and the cut made a little wider than tall at least so
 * it enlarges well. Null when the wall already fills most of the picture — a second look would see nothing bigger.
 */
export function wallCrop(read: HouseRead): ReadCrop | null {
  const xs = [read.base.left.x, read.base.right.x, ...read.windows.flatMap((w) => [w.x0, w.x1]), ...read.doors.flatMap((d) => [d.x0, d.x1])];
  const ys = [read.base.left.y, read.base.right.y, ...(read.eave ? [read.eave.left.y, read.eave.right.y] : []), ...read.windows.map((w) => w.head), ...read.doors.map((d) => d.top)];
  const span = Math.max(...xs) - Math.min(...xs);
  const x0 = clamp(Math.min(...xs) - Math.max(0.03, span * 0.05), 0, 1);
  const x1 = clamp(Math.max(...xs) + Math.max(0.03, span * 0.05), 0, 1);
  const tall = Math.max(...ys) - Math.min(...ys);
  const y0 = clamp(Math.min(...ys) - Math.max(0.04, tall * 0.18), 0, 1);
  const y1 = clamp(Math.max(...ys) + Math.max(0.03, tall * 0.06), 0, 1);
  if (x1 - x0 <= 0.05 || y1 - y0 <= 0.05) return null;
  if ((x1 - x0) * (y1 - y0) > 0.72) return null;
  return { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0) };
}

/** A read made on a cut, said in the whole picture's fractions. */
export function readFromCrop(read: HouseRead, crop: ReadCrop): HouseRead {
  const X = (x: number) => r3(crop.x + x * crop.w);
  const Y = (y: number) => r3(crop.y + y * crop.h);
  const P = (p: { x: number; y: number }) => ({ x: X(p.x), y: Y(p.y) });
  return {
    ...read,
    base: { left: P(read.base.left), right: P(read.base.right) },
    eave: read.eave ? { left: P(read.eave.left), right: P(read.eave.right) } : null,
    jogs: read.jogs.map((j) => ({ ...j, x: X(j.x), y: Y(j.y) })),
    door: read.door ? { x0: X(read.door.x0), x1: X(read.door.x1), bottom: Y(read.door.bottom), top: Y(read.door.top) } : null,
    doors: read.doors.map((d) => ({ ...d, x0: X(d.x0), x1: X(d.x1), bottom: Y(d.bottom), top: Y(d.top) })),
    windows: read.windows.map((w) => ({ x0: X(w.x0), x1: X(w.x1), sill: Y(w.sill), head: Y(w.head) })),
    patio: read.patio ? { x0: X(read.patio.x0), x1: X(read.patio.x1) } : null,
    scaleLine: read.scaleLine ? { ...read.scaleLine, a: P(read.scaleLine.a), b: P(read.scaleLine.b) } : null,
    bars: { top: 0, bottom: 0 },
    ...(read.outline ? { outline: read.outline.map(P) } : {}),
  };
}

/**
 * The two looks as one read: the wall's corners, its windows and doors from the close look (each one bigger there);
 * its sections — the steps — the roof, the cladding and the colours from the whole picture (read by the stronger
 * model, the roof and the wall's ends in view). The close look is not trusted when it lost the wall — fewer than half
 * the first look's windows, or a wall less than half as wide.
 */
export function mergeLooks(wide: HouseRead, close: HouseRead | null): HouseRead {
  if (!close) return wide;
  const wideSpan = wide.base.right.x - wide.base.left.x;
  const closeSpan = close.base.right.x - close.base.left.x;
  if (closeSpan < wideSpan * 0.5 || close.windows.length < wide.windows.length * 0.5) return wide;
  const overlap = (a: { x0: number; x1: number; top: number; bottom: number }, b: { x0: number; x1: number; top: number; bottom: number }) => {
    const intersection = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return intersection / Math.max(1e-9, Math.min((a.x1 - a.x0) * (a.bottom - a.top), (b.x1 - b.x0) * (b.bottom - b.top)));
  };
  const box = (w: HouseRead["windows"][number]) => ({ ...w, top: w.head, bottom: w.sill });
  // A closer crop must not silently erase a separate upper/lower window or a
  // door outside its crop. Keep unmatched detections from the whole image.
  const windows = [...close.windows, ...wide.windows.filter((w) => !close.windows.some((c) => overlap(box(w), box(c)) > 0.5) && !close.doors.some((d) => overlap(box(w), d) > 0.5))];
  const doors = [...close.doors.map((d) => {
    const original = wide.doors.find((w) => w.kind === d.kind && overlap(w, d) > 0.7);
    // Do not substitute a visible lite/upper half for an already detected full door.
    return original && d.bottom - d.top < 0.75 * (original.bottom - original.top) ? original : d;
  }), ...wide.doors.filter((d) => !close.doors.some((c) => overlap(d, c) > 0.5))];
  const main = close.door ?? wide.door;
  return {
    ...close,
    windows,
    doors,
    door: main ? doors.find((d) => d.kind !== "garage" && overlap(main, d) > 0.5) ?? main : null,
    // The close look sees the wall cut out: its eave line can be missing (the roof mostly out of the cut), and then the
    // wide look's eave stands — the picture's own pass needs one to find the eave's shadow near.
    eave: close.eave ?? wide.eave,
    jogs: wide.jogs,
    ...(wide.heights ? { heights: wide.heights } : {}),
    storeys: wide.storeys ?? close.storeys,
    roof: wide.roof.kind ? wide.roof : close.roof,
    material: wide.material ?? close.material,
    colours: { siding: wide.colours.siding ?? close.colours.siding, roof: wide.colours.roof ?? close.colours.roof, trim: wide.colours.trim ?? close.colours.trim },
    patio: close.patio ?? wide.patio,
    confidence: Math.min(1, Math.max(close.confidence, wide.confidence)),
    note: close.note ?? wide.note,
    // The silhouette from the whole picture: the close look's is cut at the cut's edges.
    ...(wide.outline ? { outline: wide.outline } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  The read held to a schema, in the picture's own pixels (2026-10-26)   */
/* ------------------------------------------------------------------ */
//
// The read moved to a GPT-6 model through the Responses API (lib/sdk/openaiVision runVisionStructured): the model is
// held to this schema — every field present, every enum one of its values — and answers in the picture's PIXELS, which
// is how it localizes best (absolute pixel boxes; a fraction or a 0–1000 grid cost it a good part of its accuracy in
// published tests), so the grid of tenths the studio drew over the picture is gone. Two things the old read never
// asked: WHAT the picture shows (`subject` — a room, a car or a plan drawing is refused before anything is built, owner
// 2026-10-25: "first we gotta make sure it's the house"), and the house's own silhouette (`outline` — "and we can copy
// only the house": the pixel passes and the depth map read inside it and nothing else). `fromStructured` turns the
// answer into the fractions the rest of the pipeline reads (parseHouseRead checks it like any other read).

const PX = z.object({ x: z.number(), y: z.number() });
const SPAN = z.object({ x0: z.number(), x1: z.number() });

export const SUBJECT_KINDS = ["house-exterior", "house-interior", "other-building", "not-a-building", "unclear"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export const LOOK_PAST_KINDS = ["porch-roof", "awning", "old-deck", "stairs", "slab", "fence", "hedge", "tree", "vehicle", "neighbour", "other"] as const;

/** What the model says the picture is, before anything is read off it. */
export interface HouseSubject {
  kind: SubjectKind;
  confidence: number;
  reason: string;
}
/** A thing standing in front of the wall the model was told to look past, and where it is (fractions of the picture). */
export interface HouseLookPast {
  kind: (typeof LOOK_PAST_KINDS)[number];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const houseReadSchema = z.object({
  subject: z.object({ kind: z.enum(SUBJECT_KINDS), confidence: z.number(), reason: z.string() }),
  /** The picture's size as the model understood it — a check that it answered in pixels. */
  image: z.object({ w: z.number(), h: z.number() }),
  outline: z.array(PX).nullable(),
  base: z.object({ left: PX, right: PX }).nullable(),
  eave: z.object({ left: PX, right: PX }).nullable(),
  storeys: z.number().nullable(),
  sections: z.array(z.object({ x0: z.number(), x1: z.number(), outFt: z.number(), storeys: z.number().nullable(), roof: z.enum(["main", "lean-to", "hip", "gable", "flat"]).nullable(), wing: z.boolean(), why: z.string() })),
  doors: z.array(z.object({ x0: z.number(), x1: z.number(), bottom: z.number(), top: z.number(), kind: z.enum(["slider", "hinged", "french", "garage"]), ontoYard: z.boolean() })),
  windows: z.array(z.object({ x0: z.number(), x1: z.number(), sill: z.number(), head: z.number() })),
  patio: SPAN.nullable(),
  roof: z.object({ kind: z.enum(["hip", "gable-side", "gable-end", "shed", "flat"]).nullable(), pitch: z.number().nullable() }),
  material: z.enum(["lap", "brick", "stucco", "board-batten", "stone", "shingle"]).nullable(),
  colours: z.object({ siding: z.string().nullable(), roof: z.string().nullable(), trim: z.string().nullable() }),
  lookPast: z.array(z.object({ kind: z.enum(LOOK_PAST_KINDS), x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })),
  bars: z.object({ top: z.number(), bottom: z.number() }),
  confidence: z.number(),
  note: z.string().nullable(),
});
export type HouseReadStructured = z.infer<typeof houseReadSchema>;

/** The prompt the structured read runs on: the same wall, the same rules the owner's photos taught, in pixels. */
export const HOUSE_READ_PROMPT_PX = `You read one photo for a deck builder who will rebuild the house's wall as a simple 3D model. FIRST say what the photo shows (subject). THEN, if it is the outside of a house, read ONLY the house itself — its wall, its windows, its doors, its roof — and answer in the schema. If it is not, fill the rest with nulls and empty lists.
COORDINATES: every coordinate is in PIXELS of the picture exactly as you were given it — x from 0 at the left edge to the picture's width at the right, y from 0 at the top edge to its height at the bottom; the size is stated in the message, repeat it in "image". Measure each position on the picture; do not guess from proportions. In a box x0 is the left edge and x1 the right (x0 < x1); a window's head is its top and its sill its bottom; a door's top and its bottom (threshold) likewise.
SUBJECT: "house-exterior" when the picture shows the outside wall(s) of a house (a townhouse, a duplex, a garage attached to a house count) seen from the yard, the side or the street — a wall a deck could meet. "house-interior" for a room. "other-building" for a shop, a barn, a shed, a block of flats seen from afar. "not-a-building" for anything else — a person, a car, a plan drawing, a screenshot, a yard with no wall in it. "unclear" when you cannot tell. Confidence 0–1 and one short reason.
OUTLINE: the house's own silhouette, a polygon of 6 to 20 points going round clockwise — along the roof's ridge and its edges, down the walls' corners to the ground and back: the HOUSE, not the trees in front of it, not a fence, not a neighbour's house, not an old deck, a porch roof or a car standing in front of the wall (the outline runs behind them, along the house). Where the house runs off the picture's edge, follow the edge. Null when there is no house.
THE WALL: "base" is the house wall's bottom edge where the WALL meets the ground (or would meet it behind a patio, steps or a deck), at the house's left corner and at its right corner — the whole face of the house across every step in it. "eave" is the top of that wall above each corner: the underside of the MAIN roof's eave (on a two-storey house, the eave over the upper floor); null when hidden. "storeys": 1 or 2 storeys of wall between the base and that eave (count the rows of windows), null when unsure.
SECTIONS: FIRST work out the wall's sections, left to right from its left corner to its right corner: a section is a stretch of the house's wall whose face is one flat plane. "outFt" is how far that section's face stands IN FRONT of the main wall (the main wall — the widest stretch — is 0; a bump-out or a bay is +2 to +4; a part set back is negative). "why" is the evidence you see for that section's plane: its own corner boards at both its ends, its own eave or roof edge in front of the main eave, a shadow down the wall at its side, its siding meeting the next section at a corner. "storeys" is how many storeys of WALL that section's OWN face has (1 or 2), and "roof" is what covers it: "main" when its wall runs up to the house's main roof; "lean-to" (one slope leaning against the taller wall behind it), "hip", "gable" or "flat" when it stands under a LOWER roof of its own. "wing" is true when that section is ALL the house there is at that spot — a one-storey wing beside the two-storey block, nothing but sky above its roof — and false when the house's taller wall stands behind or above it (the upper-storey windows show over the low roof). WHERE A LOWER ROOF SHOWS over only the GROUND storey of part of a two-storey wall, tell three things apart. (1) A ROOM under it: a wall face under the low roof — its own siding, windows or a door — standing FORWARD of the wall above it, with its own corner at its end and no open space beneath the roof. That IS a section: storeys 1, outFt as far as the room's face stands forward of the wall above (usually 4 to 12), roof "lean-to" (or hip, gable, flat as seen), wing false. (2) An OPEN porch or patio cover: posts or brackets hold it, the house wall shows behind it under the roof, a person could walk under it. That is NOT a section — the wall behind it is — and the cover goes in "lookPast". (3) A shallow roof band or skirt on the wall itself, the wall above and below it in one plane: NOT a section either. A porch roof, a patio roof or an awning in front of the wall never makes a section by itself. A two-storey stretch that stands forward (its own corner boards up both storeys, its own hip or gable in the main roof) is a section of storeys 2, roof "main" unless it carries a roof of its own. One section when the wall is one flat face of one height.
DOORS: EVERY door in the wall, left to right, with its kind (slider, hinged, french, garage); "ontoYard" true for the one door a deck would meet — the back door, the slider onto the yard — and false for every other (at most one true). A garage door IS a door here, kind "garage", never ontoYard: box the whole panel, its bottom where it meets the driveway. Box every door whole, threshold to head, even where a railing, a step or a plant hides part of it. For an elevated entry, follow the door DOWN BEHIND the railing to the landing floor. The TOP RAIL across the door is NOT its threshold. A single hinged entry is usually about 80 inches tall and 32–36 inches wide: a nearly square box around its visible upper half is incomplete. Infer the hidden lower frame cautiously from the landing and the frame sides; state that occlusion in note. Do not use the decorative glass inset as the door box. Keep the separate window ABOVE that door as its own window.
WINDOWS: EVERY window in the wall, both storeys: the outside edges of its frame left and right, its sill and its head. A window unit of several sashes or panes in ONE frame — a picture window with sliders beside it, a triple, a bay's front — is ONE window: box the whole frame, outside edge to outside edge. Windows with siding between them are separate entries — count them. Not the doors, not a garage door's panels.
PATIO: a concrete patio or slab at the wall's base, its ends along the wall (only to know where a deck would go); null when none.
ROOF: the MAIN roof of the house — hip (slopes on every side), gable-side (the ridge runs along this wall, triangles at the sides), gable-end (a triangle of wall faces the camera), shed, flat; pitch in inches of rise per foot when you can judge it (a usual house is 4 to 8), else null. A lower roof over one part of the wall is said in that part's section, not here.
MATERIAL: what most of the wall is clad in (lap = horizontal siding, vinyl or fiber cement). COLOURS: your best guess at the real colours as "#rrggbb" in plain daylight (not the sunset, not the shadow), null when you cannot say.
LOOK PAST, NEVER READ AS THE WALL: a porch roof or a covered patio's roof standing out in front of the wall, its posts and beams, an awning, a pergola, an old deck and its railing, stairs, a slab, a fence, a hedge, trees, a neighbour's house, a car. None of them is a step in the wall, an edge of the wall or its eave: a porch roof's low edge is not the eave; its post is not a corner. Read the house wall behind them — and list each such thing in "lookPast" with the box it covers, so the builder can keep it out of the picture.
BARS: black bands or a phone's status bar at the top and the bottom of the picture, in pixels of height; 0 when none. CONFIDENCE: how sure you are of the corners, the steps and the windows. NOTE: one short sentence a deck builder should know (a meter or a dryer vent on the wall, the ground sloping), else null.
Rules: a standard exterior door is about 80 inches tall and a usual window about 3 to 4 ft wide — use them to judge sizes; never invent a door, a window or a step you cannot see.`;

/** Said with the second look, on the wall cut out of the picture and enlarged. */
export const HOUSE_ZOOM_NOTE_PX = "This picture is the house's wall cut out of a wider photo and enlarged: the wall fills most of it and the roof may be cut off at the top. It IS the outside of a house (subject house-exterior) unless it plainly is not. Read it the same way — the pixels are of THIS picture; the outline may follow the picture's edges where the house runs off them.";

/**
 * The structured answer as the read every other module knows — fractions of the picture — ready for parseHouseRead.
 * The model answers in pixels of the `w` × `h` picture; one that answered in fractions anyway (no coordinate past 1.5)
 * is read as such. The back door (`ontoYard`) becomes `door`; the steps are left to the sections.
 */
export function fromStructured(s: HouseReadStructured, w: number, h: number): Record<string, unknown> {
  const seen: number[] = [];
  if (s.base) seen.push(s.base.left.x, s.base.left.y, s.base.right.x, s.base.right.y);
  for (const win of s.windows) seen.push(win.x0, win.x1, win.sill, win.head);
  for (const d of s.doors) seen.push(d.x0, d.x1, d.bottom, d.top);
  const px = seen.some((v) => Number.isFinite(v) && v > 1.5);
  const X = (x: number) => (px ? x / Math.max(1, w) : x);
  const Y = (y: number) => (px ? y / Math.max(1, h) : y);
  const P = (p: { x: number; y: number }) => ({ x: X(p.x), y: Y(p.y) });
  const back = s.doors.find((d) => d.ontoYard) ?? null;
  return {
    base: s.base ? { left: P(s.base.left), right: P(s.base.right) } : null,
    eave: s.eave ? { left: P(s.eave.left), right: P(s.eave.right) } : null,
    storeys: s.storeys,
    sections: s.sections.map((x) => ({ x0: X(x.x0), x1: X(x.x1), outFt: x.outFt, storeys: x.storeys, roof: x.roof, wing: x.wing, why: x.why })),
    door: back ? { x0: X(back.x0), x1: X(back.x1), bottom: Y(back.bottom), top: Y(back.top) } : null,
    doors: s.doors.map((d) => ({ x0: X(d.x0), x1: X(d.x1), bottom: Y(d.bottom), top: Y(d.top), kind: d.kind })),
    windows: s.windows.map((x) => ({ x0: X(x.x0), x1: X(x.x1), sill: Y(x.sill), head: Y(x.head) })),
    patio: s.patio ? { x0: X(s.patio.x0), x1: X(s.patio.x1) } : null,
    roof: s.roof,
    material: s.material,
    colours: s.colours,
    bars: { top: Y(s.bars.top), bottom: Y(s.bars.bottom) },
    confidence: s.confidence,
    note: s.note,
    outline: s.outline ? s.outline.map(P) : null,
  };
}

/** What the model said to look past, in fractions of the picture (the same pixel-or-fraction reading as the rest). */
export function lookPastOf(s: HouseReadStructured, w: number, h: number): HouseLookPast[] {
  const px = s.lookPast.some((b) => b.x1 > 1.5 || b.y1 > 1.5) || s.windows.some((x) => x.x1 > 1.5) || (s.base ? s.base.right.x > 1.5 : false);
  const X = (x: number) => clamp(px ? x / Math.max(1, w) : x, 0, 1);
  const Y = (y: number) => clamp(px ? y / Math.max(1, h) : y, 0, 1);
  return s.lookPast
    .map((b) => ({ kind: b.kind, x0: r3(X(Math.min(b.x0, b.x1))), x1: r3(X(Math.max(b.x0, b.x1))), y0: r3(Y(Math.min(b.y0, b.y1))), y1: r3(Y(Math.max(b.y0, b.y1))) }))
    .filter((b) => b.x1 - b.x0 > 0.01 && b.y1 - b.y0 > 0.01)
    .slice(0, 12);
}
