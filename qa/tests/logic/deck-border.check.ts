// THE PICTURE-FRAME BORDER SHOWS, ON EVERY SHAPE (2026-11-13, lib/deck/surface + scene) — a deck builder: "enabling
// the Picture Frame Border option does not visibly change the deck in the overhead or 3D view." Three faults: in the
// deck's own colour the border was drawn exactly like the field; an L or a deck that follows the house's wall dropped it
// without a word; and nothing under it was counted. Worked by hand on a 16 x 12 ft deck with 5½-in. boards.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-border.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene } from "../../../src/lib/deck/scene";
import { permitNotes } from "../../../src/lib/deck/permit";
import { borderWords, type DeckSurface } from "../../../src/lib/deck/surface";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const base = (over: Record<string, unknown>, decking: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, ...over, decking: { ...d0.decking, ...decking } });
const surf = (d: DeckDesign): DeckSurface => buildStructure(d).surface!;
/** The border's boards: plain ones, and the ones cut at 45° to meet another (2026-11-13) — those are cut pieces, as rings. */
const borderRings = (s: DeckSurface): Array<Array<[number, number]>> => s.shaped.slice(s.shapedBorderFrom).map((r) => r.reduce<Array<[number, number]>>((a, v, i) => (i % 2 ? a : [...a, [v, r[i + 1]]]), []));
const borderCount = (s: DeckSurface) => s.pieces.filter((p) => p.border).length + borderRings(s).length;
const inRing = (ring: Array<[number, number]>, x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
  return inside;
};
/** How many boards lie on a point of the deck. */
const boardsAt = (s: DeckSurface, x: number, y: number, borderOnly = false) => s.pieces.filter((p) => (!borderOnly || p.border) && x > p.cx - p.sx / 2 && x < p.cx + p.sx / 2 && y > p.cy - p.sy / 2 && y < p.cy + p.sy / 2).length + borderRings(s).filter((r) => inRing(r, x, y)).length + (borderOnly ? 0 : s.shaped.slice(0, s.shapedBorderFrom).filter((r) => inRing(r.reduce<Array<[number, number]>>((a, v, i) => (i % 2 ? a : [...a, [v, r[i + 1]]]), []), x, y)).length);
/** Points of the deck (every 1.7 in.) with two boards on them: no board lies on another. */
const overlaps = (s: DeckSurface): number => {
  const xs = [...s.pieces.flatMap((p) => [p.cx - p.sx / 2, p.cx + p.sx / 2]), ...borderRings(s).flatMap((r) => r.map((q) => q[0]))];
  const ys = [...s.pieces.flatMap((p) => [p.cy - p.sy / 2, p.cy + p.sy / 2]), ...borderRings(s).flatMap((r) => r.map((q) => q[1]))];
  let n = 0;
  for (let x = Math.min(...xs) + 0.9; x < Math.max(...xs); x += 1.7) for (let y = Math.min(...ys) + 0.9; y < Math.max(...ys); y += 1.7) if (boardsAt(s, x, y) > 1) n++;
  return n;
};
const covered = (s: DeckSurface, x: number, y: number, borderOnly = false) => boardsAt(s, x, y, borderOnly) > 0;
const roles = (d: DeckDesign) => {
  const sc = deckScene(buildStructure(d));
  return { sc, border: sc.boxes.filter((_, i) => /border board$/.test(sc.legend[sc.tags[i]]?.role ?? "")).length + (sc.diagonal?.border?.length ?? 0) };
};

console.log("── on, it shows");
const off = base({});
const one = base({}, { border: 1 });
const two = base({}, { border: 2 });
const s1 = surf(one);
check("one board: a board along each side and one across the front, the house side bare", s1.border === 1 && borderCount(s1) === 3 && s1.borderLf === 40, `${borderCount(s1)} ${s1.borderLf}`);
check("two boards: two along each of the three open edges", borderCount(surf(two)) === 6 && surf(two).borderLf === 80);
// Mitred (2026-11-13): at the two front corners the boards are cut 45° to each other — the front board's outer edge runs the deck's whole 16 ft, its inner edge a board's width shorter at each end.
const frontRing = borderRings(s1).find((r) => r.every((q) => q[1] > 144 - 6.5))!;
const w1 = s1.product.widthIn;
check("the corners are mitred: the front board's outer edge is 16 ft less the edge gaps, its inner edge shorter by a board's width at each end; a side board is square at the house and cut at the front", !!frontRing && Math.abs(Math.max(...frontRing.map((q) => q[0])) - Math.min(...frontRing.map((q) => q[0])) - (192 - 2 * ((s1.product.gapIn + w1) / 2 - w1 / 2))) < 0.01 && new Set(frontRing.map((q) => Math.round(q[0] * 100))).size === 4 && borderRings(s1).filter((r) => r.some((q) => q[1] < 1)).length === 2, JSON.stringify(frontRing));
const sceneOff = roles(off);
const sceneOn = roles(one);
check("the 3D has border boards when it is on, none when it is off", sceneOn.border === 3 && sceneOff.border === 0);
check("in the deck's OWN colour the border is drawn a shade deeper than the field — the frame can be seen", !!sceneOn.sc.colors.border && sceneOn.sc.colors.border !== sceneOn.sc.colors.decking && sceneOff.sc.colors.border === undefined, `${sceneOn.sc.colors.border} / ${sceneOn.sc.colors.decking}`);
check("…and the legend says it is the deck's colour, toned", sceneOn.sc.legend.some((l) => /border board$/.test(l.role) && /deck's own colour/.test(l.note) && /one board wide/.test(l.note)));
check("turning it on changes the picture: the scene is not the same scene", JSON.stringify(sceneOn.sc.boxes) !== JSON.stringify(sceneOff.sc.boxes) && JSON.stringify(sceneOn.sc.colors) !== JSON.stringify(sceneOff.sc.colors));
check("the field stays inside it: no board lies on another", overlaps(s1) === 0 && overlaps(surf(two)) === 0, `${overlaps(s1)} ${overlaps(surf(two))}`);

console.log("── after the deck is resized");
const wider = applyDeckPatch(one, { shape: { kind: "rect", widthFt: 20, depthFt: 10 } });
const sw = surf(wider);
const frontW = borderRings(sw).map((r) => ({ w: Math.max(...r.map((q) => q[0])) - Math.min(...r.map((q) => q[0])), y: Math.max(...r.map((q) => q[1])) })).sort((a, b) => b.w - a.w)[0];
check("a 20 x 10 ft deck: the border follows — 40 ft of edge again, the front board the deck's new width at its new front, still no overlap", sw.borderLf === 40 && Math.abs(frontW.w - 240) < 0.5 && Math.abs(frontW.y - 120) < 0.5 && overlaps(sw) === 0, `${sw.borderLf} ${JSON.stringify(frontW)}`);

console.log("── on every shape");
const ell = base({ shape: { kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } } }, { border: 1 });
const sl = surf(ell);
check("an L-shaped deck keeps its border (it was dropped without a word): a board along each of its five open edges", buildStructure(ell).design.shape.kind === "L" && sl.border === 1 && borderCount(sl) === 5 && sl.borderLf === 48, `${sl.border} ${borderCount(sl)} ${sl.borderLf}`);
check("…the field is cut short of it and ripped along it: no board lies on another", overlaps(sl) === 0, String(overlaps(sl)));
// The notch's inside corner stands at x = 12 ft, y = 8 ft: just inside it, both ways, is border — one board runs on to close the frame.
check("…at the notch's inside corner the two boards are mitred into the corner, so the frame closes: border on both sides of the 45° line, and along both edges", covered(sl, 144 - 1.5, 96 - 3.5, true) && covered(sl, 144 - 3.5, 96 - 1.5, true) && covered(sl, 144 - 2.5, 96 + 10, true) && covered(sl, 144 + 10, 96 - 2.5, true), JSON.stringify(borderRings(sl)));
check("…and every part of the deck still has a board on it", [[30, 30], [200, 60], [100, 150], [130, 100], [230, 90]].every(([x, y]) => covered(sl, x, y)));
check("…the 3D draws it, the checks say it", roles(ell).border === 5 && deckChecks(buildStructure(ell)).some((c) => c.id === "decking-border" && c.level === "pass" && /48 ft of open edge/.test(c.text)));
const stepped = base({ shape: { kind: "wall", widthFt: 20, depthFt: 12, back: [{ x0Ft: 0, x1Ft: 12, yFt: 0 }, { x0Ft: 12, x1Ft: 20, yFt: 3 }] } }, { border: 1 });
const ss = surf(stepped);
check("a deck that follows a stepped house wall — a shape the studio sets by itself — keeps its border too", buildStructure(stepped).design.shape.kind === "wall" && ss.border === 1 && borderCount(ss) >= 3 && overlaps(ss) === 0, `${buildStructure(stepped).design.shape.kind} ${ss.border} ${borderCount(ss)} ${overlaps(ss)}`);
const freeDiag = base({ placement: "detached" }, { border: 1, pattern: "diagonal", diagonal: true });
const sf = surf(freeDiag);
const pitch = sf.product.widthIn + sf.product.gapIn;
const diag = deckScene(buildStructure(freeDiag)).diagonal!;
const fieldRings = diag.boards.filter((_, i) => !diag.border?.includes(i));
check("a free-standing deck laid on the diagonal: its border runs all four sides and the diagonal field stops at it on all four (it ran on under the back border)", borderCount(sf) === 4 && fieldRings.length > 10 && fieldRings.every((r) => r.every((v, i) => (i % 2 === 0 ? v >= pitch / 12 - 0.01 && v <= 16 - pitch / 12 + 0.01 : v >= pitch / 12 - 0.01 && v <= 12 - pitch / 12 + 0.01))), `${borderCount(sf)} rings ${fieldRings.length}`);

console.log("── what it takes: boards, backing, words");
const pkg = priceDeck(one);
const backing = pkg.bom.find((l) => /^lumber-border-backing/.test(l.id));
check("along the sides the field's board ends want a joist under them: one more length a side, in the joists' own stock", JSON.stringify(s1.borderBackingIn) === JSON.stringify([144, 144]) && !!backing && backing.qty === 2 && /12 ft/.test(backing.label), JSON.stringify([s1.borderBackingIn, backing?.label, backing?.qty]));
check("a double border: a joist under each of its two boards a side", surf(two).borderBackingIn.length === 4);
check("none without a border", !priceDeck(off).bom.some((l) => /border/.test(l.id)) && surf(off).borderBackingIn.length === 0);
check("the border's boards are in the order, and the price moves with it", pkg.bom.some((l) => /picture-frame border included/.test(l.note ?? "")) && pkg.subtotal > priceDeck(off).subtotal, `${pkg.subtotal} vs ${priceDeck(off).subtotal}`);
check("said in a line for the plans", borderWords(s1) === "a single picture-frame border along 40 ft of open edge" && borderWords(surf(two)) === "a double picture-frame border along 40 ft of open edge" && borderWords(surf(off)) === "");
check("the permit set's notes carry it", permitNotes(buildStructure(one)).some((n) => /Decking: .*with a single picture-frame border along 40 ft of open edge/.test(n)) && !permitNotes(buildStructure(off)).some((n) => /picture-frame/.test(n)));
const saved = normalizeDeckDesign(JSON.parse(JSON.stringify(two)));
check("kept through a save", saved.decking.border === 2 && JSON.stringify(surf(saved).shaped) === JSON.stringify(surf(two).shaped) && JSON.stringify(surf(saved).pieces) === JSON.stringify(surf(two).pieces));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
