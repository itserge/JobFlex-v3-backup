// SKIRTING UNDER THE DECK (2026-11-14; lib/deck/skirt) — the first of the luxury options the owner asked for ("more
// options to build luxury"). Framed lattice, or the deck's own boards laid level, hung under the rim along every open
// edge down to a hand above the ground: not on the house, not where wide steps run, not under a stair's top, not where
// a lower level meets the deck; cut round a post that stands at the deck's edge and lifted over its pier; in bays of
// 8 ft at most that step down with a sloping site; left off where the frame is less than a foot above the ground.
// Drawn, counted (panels or boards, the treated frame), priced on a line of its own, said in the checks and the scope,
// asked for by voice. A deck without it is exactly as it was.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-skirt.check.ts
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, shapeOutline, shapeWithFront, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckChecks, applyDeckPatch } from "../../../src/lib/deck/checks";
import { patchDesign } from "../../../src/lib/deck/edit";
import { setDeckPast } from "../../../src/lib/deck/house";
import { deckScope, priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { permitPages } from "../../../src/lib/deck/permit";
import { AUTO_FIX } from "../../../src/lib/deck/settle";
import { POST_ACTUAL_IN } from "../../../src/lib/deck/codeTables";
import { SKIRT_BAY_MAX_IN, SKIRT_CLEAR_IN, SKIRT_GROUND_CLEAR_IN, SKIRT_MIN_IN, SKIRT_THICK_IN, skirtBoardRows, type SkirtPanel } from "../../../src/lib/deck/skirt";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (over: Record<string, unknown> = {}, skirt: "lattice" | "boards" | null = "lattice"): DeckDesign =>
  normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 48, ...over, extras: { ...d0.extras, ...(skirt ? { skirt } : {}) } });
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
const lfOf = (ps: readonly SkirtPanel[]) => ps.reduce((a, p) => a + p.lengthIn, 0) / 12;
/** A bay as a thin rectangle in plan: its four corners. */
const planOf = (p: SkirtPanel) => {
  const a = SKIRT_CLEAR_IN;
  const b = SKIRT_CLEAR_IN + SKIRT_THICK_IN;
  return [
    { x: p.x0 + p.outX * a, y: p.y0 + p.outY * a },
    { x: p.x1 + p.outX * a, y: p.y1 + p.outY * a },
    { x: p.x1 + p.outX * b, y: p.y1 + p.outY * b },
    { x: p.x0 + p.outX * b, y: p.y0 + p.outY * b },
  ];
};
/** Do two convex quads overlap by more than a hair (separating axes)? */
const overlap = (A: Array<{ x: number; y: number }>, B: Array<{ x: number; y: number }>, eps = 0.01) => {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const len = Math.hypot(nx, ny) || 1;
      const pa = A.map((v) => (v.x * nx + v.y * ny) / len);
      const pb = B.map((v) => (v.x * nx + v.y * ny) / len);
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
  }
  return true;
};
const inRing = (ring: Array<{ x: number; y: number }>, x: number, y: number) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const noCrossing = (ps: readonly SkirtPanel[]) => {
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (ps[i].bottomIn < ps[j].topIn && ps[j].bottomIn < ps[i].topIn && overlap(planOf(ps[i]), planOf(ps[j]))) return `${i} and ${j}`;
  return "";
};

/* ── 1. The design ───────────────────────────────────────────────────── */
check("a new deck has no skirting", d0.extras.skirt === undefined && buildStructure(mk({}, null)).skirt === null);
check("lattice and boards are read back; anything else is not", mk({}, "lattice").extras.skirt === "lattice" && mk({}, "boards").extras.skirt === "boards" && normalizeDeckDesign({ ...d0, extras: { ...d0.extras, skirt: "brick" } }).extras.skirt === undefined && normalizeDeckDesign({ ...d0, extras: { ...d0.extras, skirt: "none" } }).extras.skirt === undefined);

/* ── 2. A plain deck on the house ────────────────────────────────────── */
const plain = buildStructure(mk());
const sk = plain.skirt!;
const f = plain.frame!;
check("a 16 × 12 deck 4 ft up: skirted on its three open edges, about 40 ft", !!sk && near(sk.lf, 40, 0.3) && sk.panels.every((p) => !(near(p.y0, 0, 0.5) && near(p.y1, 0, 0.5))), sk ? `${sk.lf} ft` : "none");
check("it hangs from the underside of the joists to 2 in. above the ground", sk.panels.every((p) => near(p.topIn, f.joistBottomIn) && near(p.bottomIn, SKIRT_GROUND_CLEAR_IN)) && sk.heightIn === Math.round(f.joistBottomIn - SKIRT_GROUND_CLEAR_IN));
check("in bays of 8 ft at most", sk.panels.every((p) => p.lengthIn <= SKIRT_BAY_MAX_IN + 0.01 && p.lengthIn > 6) && sk.panels.length === 7, `${sk.panels.length} bays`);
check("its square feet are its bays'", near(sk.sqFt, sk.panels.reduce((a, p) => a + (p.lengthIn * (p.topIn - p.bottomIn)) / 144, 0), 0.06));
check("the runs close the outside corners and never cross", noCrossing(sk.panels) === "" && sk.panels.some((p) => p.lengthIn * 2 > 144.5), noCrossing(sk.panels));
check("a frame is counted behind it: two rails and the uprights", sk.frameLf > 2 * sk.lf && sk.boardLf === 0, `${sk.frameLf} ft`);
const boards = buildStructure(mk({}, "boards")).skirt!;
check("a board skirt: the same bays, its boards by the foot (rows × length)", boards.panels.length === sk.panels.length && near(boards.boardLf, boards.panels.reduce((a, p) => a + skirtBoardRows(p.topIn - p.bottomIn) * p.lengthIn, 0) / 12, 0.06) && boards.frameLf > sk.frameLf, `${boards.boardLf} ft`);

/* ── 3. Where it does not go ─────────────────────────────────────────── */
const free = buildStructure(mk({ placement: "detached" })).skirt!;
check("a deck that stands free is skirted on all four edges", near(free.lf, 56, 0.4) && free.panels.some((p) => near(p.y0, 0, 0.9) && near(p.y1, 0, 0.9)), `${free.lf} ft`);
const stairD = mk({ stairs: [defaultStair("s1", "front", 8)] });
const withStair = buildStructure(stairD).skirt!;
const stairLo = 8 * 12 - 24;
const stairHi = 8 * 12 + 24;
check("left open under a stair's top, a hand either side of it", withStair.panels.filter((p) => near(p.y0, 144, 0.9) && near(p.y1, 144, 0.9)).every((p) => Math.max(p.x0, p.x1) <= stairLo - 0.99 || Math.min(p.x0, p.x1) >= stairHi + 0.99) && near(withStair.lf, sk.lf - 50 / 12, 0.2), `${withStair.lf} ft`);
const sideStair = buildStructure(mk({ stairs: [defaultStair("s1", "left", 6)] })).skirt!;
check("…and under a stair that leaves by the side", sideStair.panels.filter((p) => near(p.x0, 0, 0.9) && near(p.x1, 0, 0.9)).every((p) => Math.max(p.y0, p.y1) <= 72 - 24 - 0.99 || Math.min(p.y0, p.y1) >= 72 + 24 + 0.99) && sideStair.lf < sk.lf - 3.9);
const wideFront = buildStructure(mk({ heightIn: 40, rail: { ...d0.rail, type: "aluminum" }, stairs: [{ ...defaultStair("s1", "front", 8), wrap: true, wrapSides: 1 }] }));
check("wide steps along the front close it themselves: the skirt is on the two ends only", !!wideFront.skirt && wideFront.stairs[0].kind === "box" && wideFront.skirt.panels.every((p) => !(near(p.y0, 144, 0.9) && near(p.y1, 144, 0.9))) && near(wideFront.skirt.lf, 24, 0.3), `${wideFront.skirt?.lf} ft`);
const wideAll = buildStructure(mk({ heightIn: 40, rail: { ...d0.rail, type: "aluminum" }, stairs: [{ ...defaultStair("s1", "front", 8), wrap: true, wrapSides: 3 }] }));
check("wide steps round the front and both ends: nothing left to skirt, and the checks say so with the way out", wideAll.skirt === null && deckChecks(wideAll).some((c) => c.id === "deck-skirt-none" && c.level === "warn" && !!c.fix));
const lowD = mk({ heightIn: 16 });
const low = buildStructure(lowD);
const lowCheck = deckChecks(low).find((c) => c.id === "deck-skirt-none");
check("a deck too near the ground has none (under a foot of room), said with the fix", low.skirt === null && !!lowCheck?.fix && applyDeckPatch(lowD, lowCheck.fix.patch).extras.skirt === undefined && !deckChecks(buildStructure(applyDeckPatch(lowD, lowCheck.fix.patch))).some((c) => c.id.startsWith("deck-skirt")));
check("…and nothing of it in the price", !priceDeck(lowD).lines.some((l) => l.id === "deck-skirt") && near(priceDeck(lowD).subtotal, priceDeck(mk({ heightIn: 16 }, null)).subtotal, 0.001));

/* ── 4. Posts at the deck's edge ─────────────────────────────────────── */
const flushS = buildStructure(mk({ framing: { ...d0.framing, beamStyle: "flush" } }));
const fl = flushS.skirt!;
const edgePosts = flushS.frame!.posts.filter((p) => p.y + (POST_ACTUAL_IN[p.size]?.[0] ?? 5.5) / 2 > 144);
check("flush beams: the posts stand at the front edge, past the rim's face", edgePosts.length >= 2 && flushS.frame!.beamStyle === "flush");
check("the skirt is cut round each of them", fl.roundPosts === edgePosts.length && edgePosts.every((q) => fl.panels.filter((p) => near(p.y0, 144, 0.9) && near(p.y1, 144, 0.9)).every((p) => Math.max(p.x0, p.x1) <= q.x - 2.75 || Math.min(p.x0, p.x1) >= q.x + 2.75)), `${fl.roundPosts} of ${edgePosts.length}`);
check("…and rides over their piers", fl.panels.filter((p) => near(p.y0, 144, 0.9) && near(p.y1, 144, 0.9)).every((p) => p.bottomIn >= edgePosts[0].footing.topIn + edgePosts[0].footing.groundIn + 0.49) && fl.panels.filter((p) => near(p.x0, 0, 0.9) && near(p.x1, 0, 0.9)).every((p) => near(p.bottomIn, SKIRT_GROUND_CLEAR_IN)));
check("its top is under the flush beam where that hangs lower than the joists", fl.panels.every((p) => p.topIn <= Math.min(flushS.frame!.joistBottomIn, ...flushS.frame!.beams.map((b) => b.bottomIn)) + 0.01));
check("a beam under the joists, set back: no post in the way, no cut", sk.roundPosts === 0);

/* ── 5. A sloping site ───────────────────────────────────────────────── */
const hill = buildStructure(mk({ heightIn: 30, site: { ...d0.site, slope: { outDropIn: 36, acrossDropIn: 0 } } }));
const hs = hill.skirt!;
const sidesOf = (ps: readonly SkirtPanel[]) => ps.filter((p) => near(p.x0, p.x1, 0.9));
check("ground falling away from the house: the side bays step down with it", !!hs && new Set(sidesOf(hs.panels).map((p) => Math.round(p.bottomIn))).size >= 2 && hs.heightIn > Math.round(hill.frame!.joistBottomIn - SKIRT_GROUND_CLEAR_IN) + 20, hs ? `${hs.heightIn} in.` : "none");
check("no bay digs into the ground: 2 in. clear at its highest point", hs.panels.every((p) => [0, 0.25, 0.5, 0.75, 1].every((t) => p.bottomIn >= hill.groundAt(p.x0 + (p.x1 - p.x0) * t, p.y0 + (p.y1 - p.y0) * t) + SKIRT_GROUND_CLEAR_IN - 0.01)));
const rise = buildStructure(mk({ heightIn: 30, site: { ...d0.site, slope: { outDropIn: -14, acrossDropIn: 0 } } }));
const rs = rise.skirt;
check("ground rising toward the yard: left off where the frame comes within a foot of it, and said", !!rs && rs.lowFt > 0 && rs.panels.every((p) => p.topIn - p.bottomIn >= SKIRT_MIN_IN - 0.01) && /Left off \d+ ft/.test(deckChecks(rise).find((c) => c.id === "deck-skirt")?.text ?? ""), rs ? `${rs.lowFt} ft left off` : "none");

/* ── 6. Two levels ───────────────────────────────────────────────────── */
const twoD = mk({ heightIn: 60, lower: { ...d0.lower, on: true, place: "front", widthFt: 12, depthFt: 8, dropIn: 21, align: "centre" } });
const two = buildStructure(twoD);
const ts = two.skirt!;
const up = ts.panels.filter((p) => p.level === "upper");
const lo = ts.panels.filter((p) => p.level === "lower");
check("a lower level in front: the main deck's front is left open where the lower level meets it", up.filter((p) => near(p.y0, 144, 0.9) && near(p.y1, 144, 0.9)).every((p) => Math.max(p.x0, p.x1) <= 24 - 0.99 || Math.min(p.x0, p.x1) >= 168 + 0.99) && up.length > 0);
check("…and the lower level is skirted on its own three open edges, from under its own frame", lo.length >= 3 && lo.every((p) => near(p.topIn, two.lower!.frame.joistBottomIn) && Math.min(p.y0, p.y1) >= 143.9) && near(lfOf(lo), 8 + 12 + 8, 0.3) && noCrossing(ts.panels) === "", `${lfOf(lo).toFixed(1)} ft`);
// (Found by the random run.) A lower level in front of corners cut at an angle: its skirt starts where the cut ends.
const clipLow = buildStructure(mk({ shape: { kind: "rect", widthFt: 14, depthFt: 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 2 } }, heightIn: 96, lower: { ...d0.lower, on: true, place: "front", widthFt: 10, depthFt: 8, dropIn: 14, align: "centre" } }));
check("…in front of corners cut at an angle: the two levels' skirts meet without crossing", !!clipLow.skirt && clipLow.skirt.panels.some((p) => p.level === "lower") && clipLow.skirt.panels.some((p) => p.level === "upper" && Math.abs(Math.abs(p.outX) - Math.SQRT1_2) < 0.01) && noCrossing(clipLow.skirt.panels) === "", noCrossing(clipLow.skirt?.panels ?? []));
// …and a post of one level standing where the other level's skirt starts: cut round it all the same.
const flushLow = buildStructure(mk({ shape: { kind: "rect", widthFt: 26, depthFt: 20 }, placement: "beside", heightIn: 40, framing: { ...d0.framing, beamStyle: "flush" }, lower: { ...d0.lower, on: true, place: "front", widthFt: 26, depthFt: 6, dropIn: 14, align: "left" } }));
const postBoxes = [flushLow.frame!.posts.map((q) => ({ x: q.x, y: q.y, h: Math.max(...(POST_ACTUAL_IN[q.size] ?? [5.5, 5.5])) / 2 })), flushLow.lower!.frame.posts.map((q) => ({ x: q.x + flushLow.lower!.offsetXIn, y: q.y + flushLow.lower!.offsetYIn, h: Math.max(...(POST_ACTUAL_IN[q.size] ?? [5.5, 5.5])) / 2 }))].flat();
check("no bay of either level runs through a post of the other", !!flushLow.skirt && flushLow.skirt.panels.every((p) => !postBoxes.some((q) => overlap(planOf(p), [{ x: q.x - q.h, y: q.y - q.h }, { x: q.x + q.h, y: q.y - q.h }, { x: q.x + q.h, y: q.y + q.h }, { x: q.x - q.h, y: q.y + q.h }]))));
const dbl = buildStructure(mk({ heightIn: 156, lower: { ...d0.lower, on: true, place: "under", heightIn: 36 } }));
check("a double deck: the skirt hangs under the LOWER floor", dbl.lower?.place === "under" && !!dbl.skirt && dbl.skirt.panels.every((p) => near(p.topIn, dbl.lower!.frame.joistBottomIn)) && dbl.skirt.heightIn < 36, dbl.skirt ? `${dbl.skirt.heightIn} in.` : "none");

/* ── 7. Any shape ────────────────────────────────────────────────────── */
const ell = buildStructure(mk({ shape: { kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } } }));
check("an L: every open edge, the inside corner too, and no two runs cross", !!ell.skirt && near(ell.skirt.lf, 14 + 20 + 14, 0.5) && noCrossing(ell.skirt.panels) === "", `${ell.skirt?.lf} ft ${noCrossing(ell.skirt?.panels ?? [])}`);
const bayD = patchDesign(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 12 } }), { shape: shapeWithFront(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 12 } }).shape, [{ widthFt: 6, yFt: 10 }, { widthFt: 12, yFt: 14, clipLeftFt: 3, clipRightFt: 3 }, { widthFt: 6, yFt: 10 }]) });
const bay = buildStructure(bayD);
check("a bay with corners cut at an angle: the skirt follows the cuts", !!bay.skirt && bay.skirt.panels.some((p) => Math.abs(Math.abs(p.outX) - Math.SQRT1_2) < 0.01) && noCrossing(bay.skirt.panels) === "", noCrossing(bay.skirt?.panels ?? []));
const ring = shapeOutline(bayD.shape);
check("every bay hangs outside the deck's outline, on its edge", bay.skirt!.panels.every((p) => !inRing(ring, (p.x0 + p.x1) / 2 + p.outX * 0.4, (p.y0 + p.y1) / 2 + p.outY * 0.4) && inRing(ring, (p.x0 + p.x1) / 2 - p.outX * 0.4, (p.y0 + p.y1) / 2 - p.outY * 0.4)));
const baseP = mk({ shape: { kind: "rect", widthFt: 20, depthFt: 12 } });
const pastSet = setDeckPast(baseP.house, baseP.shape, "right", 6, 0, { minWidthFt: 6, maxWidthFt: 60 });
const pastS = buildStructure(normalizeDeckDesign({ ...baseP, house: pastSet.house, shape: pastSet.shape }));
check("a deck past the house's corner: the open back edge there is skirted too", !!pastS.skirt && pastS.skirt.panels.some((p) => near(p.y0, 0, 0.9) && near(p.y1, 0, 0.9)) && noCrossing(pastS.skirt.panels) === "");

/* ── 8. The 3D ───────────────────────────────────────────────────────── */
const sceneOf = (d: DeckDesign) => {
  const sc = deckScene(buildStructure(d));
  const idx = new Set(sc.legend.map((l, i) => (l.role.startsWith("skirt") ? i : -1)).filter((i) => i >= 0));
  return { sc, boxes: sc.boxes.filter((_, i) => idx.has(sc.tags[i])), roles: (r: string) => sc.boxes.filter((_, i) => sc.legend[sc.tags[i]]?.role === r) };
};
const lat = sceneOf(mk());
const brd = sceneOf(mk({}, "boards"));
const none = sceneOf(mk({}, null));
check("the 3D draws the lattice: a border round every bay and slats crossing both ways", lat.roles("skirt frame").length === 4 * sk.panels.length && lat.roles("skirt lattice").filter((b) => (b[9] ?? 0) > 0.7).length > 20 && lat.roles("skirt lattice").filter((b) => (b[9] ?? 0) < -0.7).length > 20, `${lat.roles("skirt frame").length} border, ${lat.roles("skirt lattice").length} slats`);
check("…and a board skirt as rows of boards", brd.roles("skirt board").length === boards.panels.reduce((a, p) => a + skirtBoardRows(p.topIn - p.bottomIn), 0) && brd.roles("skirt lattice").length === 0, `${brd.roles("skirt board").length} boards`);
const topFt = f.joistBottomIn / 12;
check("every part of it between the ground's 2 in. and the underside of the frame", [...lat.boxes, ...brd.boxes].every((b) => b[3] > SKIRT_GROUND_CLEAR_IN / 12 - 0.001 && b[3] < topFt + 0.001));
check("a deck without it: the same scene as before", none.boxes.length === 0 && none.sc.boxes.length === lat.sc.boxes.length - lat.boxes.length);
const big = sceneOf(mk({ shape: { kind: "rect", widthFt: 40, depthFt: 24 }, heightIn: 120, placement: "detached" }));
check("a big, tall deck still draws (coarser lattice, well inside the scene's limit)", big.boxes.length > 200 && big.sc.boxes.length < 6000, `${big.boxes.length} skirt boxes of ${big.sc.boxes.length}`);

/* ── 9. The price, the list, the words ───────────────────────────────── */
const p0 = priceDeck(mk({}, null));
const pL = priceDeck(mk());
const pB = priceDeck(mk({}, "boards"));
const lineL = pL.lines.find((l) => l.id === "deck-skirt");
const lineB = pB.lines.find((l) => l.id === "deck-skirt");
const others = (p: typeof p0) => p.lines.filter((l) => l.id !== "deck-skirt").map((l) => `${l.id}:${l.quantity}:${l.unitPrice}`).join("|");
check("a line of its own, by the square foot", !!lineL && lineL.quantity === Math.round(sk.sqFt) && lineL.unit === "sqft" && lineL.materialCost > 0 && lineL.laborCost > 0);
check("every other line is what it was (the fascia's too)", others(pL) === others(p0) && others(pB) === others(p0));
check("the total is the deck's plus that line", near(pL.subtotal - p0.subtotal, lineL!.quantity * lineL!.unitPrice, 1.5) && pB.subtotal > pL.subtotal, `${(pL.subtotal - p0.subtotal).toFixed(2)} vs ${(lineL!.quantity * lineL!.unitPrice).toFixed(2)}`);
const bomL = pL.takeoff.lines.filter((l) => l.id.includes("skirt"));
const bomB = pB.takeoff.lines.filter((l) => l.id.includes("skirt"));
check("the list: lattice by the square foot and treated 2x4s for the frame", bomL.length === 2 && bomL.some((l) => l.rateKey === "trim.lattice" && l.unit === "sq ft") && bomL.some((l) => l.rateKey === "lf.2x4" && /ground-contact/.test(l.note ?? "")), bomL.map((l) => `${l.label} ${l.qty}`).join("; "));
check("…or the deck's own boards in 12-footers, a tenth over", bomB.some((l) => l.rateKey === `deck.${pB.takeoff.surface!.product.id}` && l.qty === Math.ceil((boards.boardLf * 1.1) / 12 - 1e-9)) && lineB!.materialCost > lineL!.materialCost, bomB.map((l) => `${l.label} ${l.qty}`).join("; "));
check("the scope the client signs names it", deckScope(pL).some((t) => /Skirting under the deck/.test(t) && /lattice/.test(t) && /hinged/.test(t)) && deckScope(pB).some((t) => /own boards/.test(t)) && !deckScope(p0).some((t) => /[Ss]kirting/.test(t)));
const ck = deckChecks(plain).find((c) => c.id === "deck-skirt");
check("the checks say what hangs there: how much, the frame, the air, the way under", !!ck && ck.level === "pass" && /40 ft/.test(ck.text) && /7 bays/.test(ck.text) && /hinges/.test(ck.text) && /2 in\. clear/.test(ck.text), ck?.text ?? "");
check("…cut round the posts where they stand at the edge", /cut round the \d+ posts/.test(deckChecks(flushS).find((c) => c.id === "deck-skirt")?.text ?? ""));
check("its checks are the builder's own (clear of the auto-fix)", !AUTO_FIX.test("deck-skirt") && !AUTO_FIX.test("deck-skirt-none"));
check("the same checks otherwise", deckChecks(plain).filter((c) => !c.id.startsWith("deck-skirt")).map((c) => `${c.id}:${c.level}`).join() === deckChecks(buildStructure(mk({}, null))).map((c) => `${c.id}:${c.level}`).join());
let pages = 0;
let threw = "";
try {
  pages = permitPages(pL, { address: "1 Test St", contractor: "QA" } as never).length;
} catch (e) {
  threw = String(e);
}
check("the permit set draws", pages > 4 && !threw, threw);

/* ── 10. By voice ────────────────────────────────────────────────────── */
const say = (d: DeckDesign, text: string) => {
  let o = d;
  const said: string[] = [];
  let refused = false;
  for (const cmd of parseUtterance(text, { design: d } as never).clauses.flatMap((c) => c.cmds)) {
    const r = runCommand(o, cmd);
    o = r.design;
    said.push(...r.said);
    refused = refused || !!r.refused;
  }
  return { design: o, said: said.join(" "), refused };
};
const open = mk({}, null);
const v1 = say(open, "add lattice skirting");
check("\"add lattice skirting\": built, and said as built", v1.design.extras.skirt === "lattice" && /Lattice skirting/.test(v1.said) && /40 ft/.test(v1.said), v1.said);
const v2 = say(open, "skirt the deck with deck boards");
check("\"skirt the deck with deck boards\": the deck's own boards", v2.design.extras.skirt === "boards" && /own boards/.test(v2.said), v2.said);
check("\"close in the underside\" and \"hide the posts\": lattice", say(open, "close in the underside").design.extras.skirt === "lattice" && say(open, "hide the posts").design.extras.skirt === "lattice");
const v3 = say(v1.design, "take the skirting off");
check("\"take the skirting off\"", v3.design.extras.skirt === undefined && /open underneath/.test(v3.said), v3.said);
const v4 = say(mk({ heightIn: 16 }, null), "add skirting");
check("on a deck too low for it: not added, and why", v4.design.extras.skirt === undefined && v4.refused && /too low/.test(v4.said), v4.said);
check("it is no longer a blank item of the contractor's own", v1.design.extras.items.length === 0 && v2.design.extras.items.length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
