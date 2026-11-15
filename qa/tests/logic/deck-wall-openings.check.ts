// THE WALL'S WINDOWS AND DOORS, SET BY HAND IN THE 3D (2026-11-15; lib/deck/wallOpenings, lib/deck/house) — the owner:
// "here is the double deck, and the first floor should be with the doors, sliding door and windows on the 3D model" and
// "give me an option to double click on the window and move it anywhere I want it… change the sliding door for a triple
// sliding door, 4 doors, or a single regular door; same thing for the windows… and also make the size… make it super smart".
// The rule that draws a house without a photo gives the floor under a second-storey deck its windows — and, under a
// double deck, the door onto the lower floor. Every window and door has a name; the first move by hand turns a wall
// drawn by rule into a list (a SKETCH: drawn as set, not checked against), and each is moved along the wall and up
// it, sized, swapped for another kind, taken off or added. A door stands on a floor and follows it.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-openings.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { buildStructure } from "@/lib/deck/structure";
import { applyDeckPatch, deckChecks, type DeckPatch } from "@/lib/deck/checks";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { DOOR_CHOICES, WINDOW_CHOICES, houseScene, openingChoiceOf, openingPanels, ruleOpenings, type DrawnOpening } from "@/lib/deck/house";
import { addOpening, addOpeningAt, editOpening, houseDrawn, openingsReal, realOpenings, removeOpening, wallOpenings } from "@/lib/deck/wallOpenings";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36, house: { ...d0.house, storeys: 2, leftFt: 8, rightFt: 8, jogs: [] }, ...over });
const near = (a: number, b: number, tol = 0.09) => Math.abs(a - b) <= tol;
const drawnOf = (d: DeckDesign): DrawnOpening[] => wallOpenings(buildStructure(d))!.drawn;
const apply = (d: DeckDesign, p: DeckPatch | null) => (p ? applyDeckPatch(d, p) : d);
const sceneOf = (d: DeckDesign) => {
  const s = buildStructure(d);
  const h = houseDrawn(s)!;
  return houseScene(h.shape, d.house, h.ctx);
};

/* ── 1. The rule: as it was for a low deck ─────────────────────────────── */
const low = mk();
const lowScene = sceneOf(low);
check("a deck 3 ft up: one door onto the deck, no door below, the rows as before (first row above the deck's floor, the upper storey's)", !!lowScene.door && !lowScene.doors && lowScene.windows.every((w) => near(w[4], 4.2) || near(w[4], 12.5)), lowScene.windows.map((w) => w[4]));
check("…every window and door has a name: the door d1, the windows w1…", lowScene.openingsAt?.[0].id === "d1" && lowScene.openingsAt.length === lowScene.windows.length + 1 && new Set(lowScene.openingsAt.map((o) => o.id)).size === lowScene.openingsAt.length);
check("…the door and the first row stand on the deck's floor (they follow it); the upper storey's windows on the wall by their own height", lowScene.openingsAt![0].floor === "deck" && lowScene.openingsAt!.filter((o) => near(o.sill, 4.2)).every((o) => o.floor === "deck" && near(o.upFt ?? 0, 1.2, 0.001)) && lowScene.openingsAt!.filter((o) => near(o.sill, 12.5)).every((o) => !o.floor));

/* ── 2. Under a deck a storey up: the floor below gets its windows ─────── */
const high = mk({ heightIn: 126 });
const highScene = sceneOf(high);
const under = highScene.windows.filter((w) => w[4] < 8);
check("a deck 10 ft 6 in. up: the ground floor has a row of windows, sills 3 ft up, under the deck's frame", under.length >= 4 && under.every((w) => near(w[4], 3) && w[4] + w[3] <= 126 / 12 - 1.5), under.map((w) => [w[0], w[3], w[4]]));
check("…no door below without a floor to step onto; the door onto the deck as before", !highScene.doors && !!highScene.door && near(highScene.door[0], 8));
check("a deck 5 ft up: no row under it (a window would not fit under the frame)", !sceneOf(mk({ heightIn: 60 })).windows.some((w) => w[4] < 4));

/* ── 3. A double deck: the door onto the lower floor ───────────────────── */
const dbl = mk({ heightIn: 126, lower: { on: true, place: "under", heightIn: 18 } });
const dblScene = sceneOf(dbl);
const lowDoor = dblScene.doors?.find((r) => near(r[4], 1.5));
check("a double deck: two doors — the one onto the upper deck, and a sliding door onto the lower floor, on that floor, on its back edge's middle", dblScene.doors?.length === 2 && !!lowDoor && lowDoor[5] === 1 && near(lowDoor[0], 8) && near(lowDoor[2], 6) && near(dblScene.doors[0][4], 10.5), dblScene.doors);
const groundRow = dblScene.windows.filter((w) => w[4] < 8);
check("…the ground floor's windows 3 ft above the lower floor, clear of that door", groundRow.length >= 2 && groundRow.every((w) => near(w[4], 4.5) && (w[0] + w[2] / 2 <= 8 - 3 - 1.5 + 0.01 || w[0] - w[2] / 2 >= 8 + 3 + 1.5 - 0.01)), groundRow.map((w) => [w[0], w[4]]));
check("…they stand on the lower floor (they follow it)", dblScene.openingsAt!.find((o) => o.id === "d2")?.floor === "lower" && dblScene.openingsAt!.filter((o) => near(o.sill, 4.5)).every((o) => o.floor === "lower" && near(o.upFt ?? 0, 3, 0.001)));
const offset = mk({ heightIn: 126, lower: { on: true, place: "under", heightIn: 18, shape: { kind: "rect", widthFt: 10, depthFt: 12 }, offsetFt: 6 } });
check("a lower floor of its own, slid along the house: its door is on ITS back edge", near(sceneOf(offset).doors?.find((r) => near(r[4], 1.5))?.[0] ?? -1, 11), sceneOf(offset).doors);

/* ── 4. A wall drawn by rule, as a list: the same picture ──────────────── */
for (const [name, d] of [["low", low], ["high", high], ["double", dbl]] as const) {
  const s = buildStructure(d);
  const h = houseDrawn(s)!;
  const list = ruleOpenings(h.shape, d.house, h.ctx);
  const again = houseScene(h.shape, { ...d.house, openings: list }, h.ctx).openingsAt ?? [];
  const before = houseScene(h.shape, d.house, h.ctx).openingsAt ?? [];
  const same = again.length === before.length && before.every((b) => { const a = again.find((q) => q.id === b.id); return !!a && a.kind === b.kind && near(a.x, b.x) && near(a.w, b.w) && near(a.h, b.h) && near(a.sill, b.sill) && near(a.face, b.face); });
  check(`the ${name} deck's wall written out as a list draws the same windows and doors, to the inch`, same && list.length === before.length, { rule: before.length, list: again.length });
}

/* ── 5. Moved along the wall and up it ─────────────────────────────────── */
let d = low;
let s = buildStructure(d);
const first = drawnOf(d);
const win = first.find((o) => o.kind === "window" && near(o.sill, 4.2) && o.x > 12)!;
check("before any move the house has no list (drawn by rule)", d.house.openings === undefined && wallOpenings(s)!.byRule);
d = apply(d, editOpening(s, win.id, { xFt: win.x + 1.25 }));
s = buildStructure(d);
let moved = drawnOf(d).find((o) => o.id === win.id)!;
check("a window moved 15 in. along the wall: it stands there; the wall is a list now, marked a sketch", near(moved.x, win.x + 1.25, 0.01) && d.house.openings?.length === first.length && d.house.openingsSketch === true, [moved.x, d.house.openings?.length, d.house.openingsSketch]);
check("…every other window and the door where they were", first.filter((o) => o.id !== win.id).every((o) => { const a = drawnOf(d).find((q) => q.id === o.id); return !!a && near(a.x, o.x) && near(a.sill, o.sill) && near(a.w, o.w); }));
const next = drawnOf(d).filter((o) => o.kind === "window" && near(o.sill, moved.sill) && o.x > moved.x).sort((a, b) => a.x - b.x)[0];
d = apply(d, editOpening(s, win.id, { xFt: next.x }));
s = buildStructure(d);
moved = drawnOf(d).find((o) => o.id === win.id)!;
check("moved onto the next window: it stops beside it, the casings' room between them", moved.x + moved.w / 2 <= next.x - next.w / 2 - 0.44 && moved.x + moved.w / 2 >= next.x - next.w / 2 - 0.62 && near(moved.w, 3, 0.01), [moved.x, next.x]);
d = apply(d, editOpening(s, win.id, { sillFt: 6 }));
s = buildStructure(d);
moved = drawnOf(d).find((o) => o.id === win.id)!;
check("pulled up the wall: its sill at 6 ft; it still stands on the deck's floor, 3 ft above it", near(moved.sill, 6, 0.01) && d.house.openings!.find((o) => o.id === win.id)?.floor === "deck" && near(d.house.openings!.find((o) => o.id === win.id)!.upFt ?? 0, 3, 0.01));
const raised = normalizeDeckDesign({ ...d, heightIn: 60 });
const up = drawnOf(raised);
check("the deck raised 2 ft: the door and what stands on its floor go up with it; the upper storey's windows stay", near(up.find((o) => o.id === "d1")!.sill, 5, 0.01) && near(up.find((o) => o.id === win.id)!.sill, 8, 0.01) && up.filter((o) => !o.floor && o.kind === "window").every((o) => near(o.sill, 12.5)), up.map((o) => [o.id, o.sill]));
check("moved past the wall's end: it stays on the wall, a hand's width in", (() => { const far = drawnOf(apply(d, editOpening(s, win.id, { xFt: 99 }))).find((o) => o.id === win.id)!; return far.x + far.w / 2 <= 24 - 0.24 && far.x > 12; })());

/* ── 6. A door goes to the nearer floor ────────────────────────────────── */
let dd = dbl;
let ds = buildStructure(dd);
dd = apply(dd, editOpening(ds, "d1", { xFt: 3.5, sillFt: 4 }));
ds = buildStructure(dd);
const twoDown = drawnOf(dd).filter((o) => o.kind !== "window");
check("a double deck's upper door pulled down beside the lower one: it goes to the lower floor (not to a place between)", near(twoDown.find((o) => o.id === "d1")!.sill, 1.5, 0.01) && dd.house.openings!.find((o) => o.id === "d1")?.floor === "lower", twoDown.map((o) => [o.id, o.x, o.sill]));
dd = apply(dd, editOpening(ds, "d1", { sillFt: 9 }));
check("…pulled back up: on the upper deck's floor again", near(drawnOf(dd).find((o) => o.id === "d1")!.sill, 10.5, 0.01));

/* ── 7. Swapped for another kind ───────────────────────────────────────── */
check("the choices: a door, a double door, a sliding door of 2, 3 or 4 panels; a window single, double or triple", DOOR_CHOICES.map((c) => c.key).join() === "door,door2,slider2,slider3,slider4" && WINDOW_CHOICES.map((c) => c.key).join() === "window,window2,window3");
d = low;
s = buildStructure(d);
const door0 = drawnOf(d).find((o) => o.id === "d1")!;
check("the rule's 6-ft door onto the deck is a sliding door of 2 panels", door0.kind === "slider" && openingPanels(door0) === 2 && openingChoiceOf(door0)?.key === "slider2");
const swap = (key: string) => { const dn = apply(d, editOpening(s, "d1", { choice: key })); return { d: dn, o: drawnOf(dn).find((q) => q.id === "d1")!, list: dn.house.openings ?? [] }; };
const tri = swap("slider3");
check("swapped for a triple sliding door: 9 ft wide, 3 panels, on the same middle and threshold", tri.o.kind === "slider" && near(tri.o.w, 9, 0.01) && tri.o.panels === 3 && near(tri.o.x, door0.x, 0.01) && near(tri.o.sill, door0.sill, 0.01), tri.o);
check("…the windows it grew over are cut back or left out of the picture — and still on the list", drawnOf(tri.d).filter((o) => o.kind === "window" && near(o.sill, 4.2)).every((o) => o.x - o.w / 2 >= tri.o.x + 4.5 + 0.44 || o.x + o.w / 2 <= tri.o.x - 4.5 - 0.44) && tri.list.length === first.length, drawnOf(tri.d).filter((o) => near(o.sill, 4.2)).map((o) => [o.x, o.w]));
const four = swap("slider4");
check("a 4-panel sliding door: 12 ft, 4 panels", near(four.o.w, 12, 0.01) && four.o.panels === 4 && four.o.kind === "slider");
const single = swap("door");
check("a single regular door: 3 ft, a door", single.o.kind === "door" && near(single.o.w, 3, 0.01) && near(single.o.h, door0.h, 0.01));
check("a double door: 6 ft, two leaves", swap("door2").o.kind === "door" && swap("door2").o.panels === 2 && near(swap("door2").o.w, 6, 0.01));
const w0 = drawnOf(d).find((o) => o.kind === "window" && near(o.sill, 12.5))!;
const wide = drawnOf(apply(d, editOpening(s, w0.id, { choice: "window3" }))).find((q) => q.id === w0.id)!;
check("a window swapped for a triple one: 9 ft, 3 sashes (or as wide as the wall beside it leaves)", wide.kind === "window" && wide.panels === 3 && wide.w > 3.5, wide);
check("a window is not swapped for a door, nor a door for a window", editOpening(s, w0.id, { choice: "slider3" }) === null && editOpening(s, "d1", { choice: "window2" }) === null);

/* ── 8. Its size ───────────────────────────────────────────────────────── */
const sized = drawnOf(apply(d, editOpening(s, w0.id, { widthFt: 4.5, heightFt: 5 }))).find((q) => q.id === w0.id)!;
check("a window made 4 ft 6 in. wide and 5 ft tall: so it is (to the inch)", near(sized.w, 4.5, 0.01) && near(sized.h, 5, 0.01) && near(sized.x, w0.x, 0.01));
const tiny = drawnOf(apply(d, editOpening(s, "d1", { widthFt: 0.5 }))).find((q) => q.id === "d1")!;
check("a sliding door is never made narrower than 4 ft", near(tiny.w, 4, 0.01));
const neighbour = drawnOf(d).filter((o) => o.kind === "window" && near(o.sill, w0.sill) && o.id !== w0.id).sort((a, b) => Math.abs(a.x - w0.x) - Math.abs(b.x - w0.x))[0];
const grown = drawnOf(apply(d, editOpening(s, w0.id, { widthFt: 14 })));
const g0 = grown.find((q) => q.id === w0.id)!;
const gn = grown.find((q) => q.id === neighbour.id)!;
check("a window widened into its neighbour: as wide as is clear of it, and the neighbour untouched", g0.w > 3 && g0.w < 14 && near(gn.w, neighbour.w, 0.01) && Math.abs(g0.x - gn.x) >= g0.w / 2 + gn.w / 2 + 0.44, [g0.w, gn.w]);

/* ── 9. A sketch is not checked; the real wall is ──────────────────────── */
const edited = apply(low, editOpening(buildStructure(low), win.id, { xFt: win.x + 1 }));
const doorChecks = (dn: DeckDesign) => deckChecks(buildStructure(dn)).filter((c) => c.part === "Doors and windows");
check("a wall arranged by hand is a picture: the deck is not checked against its doors and windows", edited.house.openingsSketch === true && realOpenings(edited) === null && doorChecks(edited).length === 0);
const real = apply(edited, openingsReal(buildStructure(edited), true));
check("…said to be the real ones: checked, each where it stands now", real.house.openingsSketch === undefined && (realOpenings(real)?.length ?? 0) === edited.house.openings!.length && doorChecks(real).length > 0, doorChecks(real).map((c) => c.id));
check("…and a picture again: not checked", doorChecks(apply(real, openingsReal(buildStructure(real), false))).length === 0);
const photo = mk({ house: { ...d0.house, storeys: 1, leftFt: 8, rightFt: 8, jogs: [], openings: [{ id: "a", kind: "slider", xFt: 8, widthFt: 6, heightFt: 6.67, sillFt: 3 }, { id: "b", kind: "window", xFt: 2, widthFt: 3, heightFt: 4, sillFt: 5.5 }] } });
const photoMoved = apply(photo, editOpening(buildStructure(photo), "b", { xFt: 1 }));
check("a wall that came as a list (a photo's) stays real when one is moved", photoMoved.house.openingsSketch === undefined && near(photoMoved.house.openings!.find((o) => o.id === "b")!.xFt, 1, 0.01) && doorChecks(photoMoved).length > 0);
check("…and a photo's opening has no floor of its own: its sill is its height above the ground, as before", photoMoved.house.openings!.every((o) => o.floor === undefined && o.panels === undefined));

/* ── 10. Taken off, and one more ───────────────────────────────────────── */
const gone = apply(low, removeOpening(buildStructure(low), win.id));
check("a window taken off: gone from the picture, the rest stand", !drawnOf(gone).some((o) => o.id === win.id) && drawnOf(gone).length === first.length - 1);
const more = addOpening(buildStructure(gone), "window", win.x);
const added = more ? drawnOf(apply(gone, more.patch)).find((o) => o.id === more.id) : undefined;
check("a window added where that one stood: 3 ft wide, 4 ft tall, its sill 3 ft above the deck's floor", !!added && near(added.x, win.x, 0.01) && near(added.w, 3, 0.01) && near(added.sill, 6, 0.01), added);
const moreDoor = addOpening(buildStructure(low), "door");
const addedDoor = moreDoor ? drawnOf(apply(low, moreDoor.patch)).find((o) => o.id === moreDoor.id) : undefined;
check("a door added with no place given: on the deck's floor, in the first clear place from the deck's middle", !!addedDoor && addedDoor.kind === "door" && near(addedDoor.sill, 3, 0.01) && drawnOf(apply(low, moreDoor!.patch)).filter((o) => o.kind !== "window").length === 2, addedDoor);
check("an opening that is not on the wall: nothing to do", editOpening(buildStructure(low), "nope", { xFt: 3 }) === null && removeOpening(buildStructure(low), "nope") === null);
check("a deck off the house has no wall to arrange", wallOpenings(buildStructure(mk({ placement: "detached" }))) === null && editOpening(buildStructure(mk({ placement: "detached" })), "d1", { xFt: 3 }) === null);

/* ── 10b. Put where the wall was clicked ───────────────────────────────── */
// (The owner: "I just select door or window and click on the wall where it's supposed to be, and you find the right
// spot — in line with the deck if it's a door, or in line with the window — and then I can move it or adjust the size.")
{
  const without = (dn: DeckDesign, ...ids: string[]) => ids.reduce((acc, id2) => apply(acc, removeOpening(buildStructure(acc), id2)), dn);
  const put = (dn: DeckDesign, key: string, x: number, z: number) => {
    const made = addOpeningAt(buildStructure(dn), key, x, z);
    const after = made ? apply(dn, made.patch) : dn;
    return { made, d: after, o: made ? drawnOf(after).find((q) => q.id === made.id) : undefined, listed: made ? after.house.openings?.find((q) => q.id === made.id) : undefined };
  };
  // The low deck's wall: the door d1 at 8 ft on the deck's floor (3 ft up); a row at 4.2 ft (w1–w4); the upper row at 12.5 ft, every 5 ft (w5–w10).
  const gap = without(low, "w8");
  const inRow = put(gap, "window", 9.2, 14);
  check("a window clicked in the upper row, where one is missing: in line with that row — its sill and its height — where it was clicked", !!inRow.o && near(inRow.o.sill, 12.5, 0.01) && near(inRow.o.h, 4, 0.01) && near(inRow.o.x, 9.2, 0.05) && near(inRow.o.w, 3, 0.01), inRow.o);
  check("…the wall is a list now, a sketch; the new one has a name of its own", inRow.d.house.openingsSketch === true && !!inRow.made && !first.some((o) => o.id === inRow.made!.id));
  const col = put(without(low, "w9"), "window", 14.8, 14);
  check("clicked within 9 in. of the middle of a window on the row below: it goes straight over that one", !!col.o && near(col.o.x, 15, 0.01) && near(col.o.sill, 12.5, 0.01), col.o);
  const between = put(without(low, "w8"), "window", 9.3, 10.4);
  check("clicked between the two rows (a full window fits in neither gap): it goes into the nearer row, in line with it", !!between.o && near(between.o.sill, 12.5, 0.01) && near(between.o.x, 9.3, 0.05), between.o);
  const tight = put(without(low, "w8"), "window", 8.2, 14);
  check("clicked half onto its neighbour: it lands beside it, the casings' room between", !!tight.o && tight.o.x - 1.5 >= 4.5 + 1.5 + 0.44 && tight.o.x < 9.2, tight.o);
  check("clicked in a row with no room within 5 ft: nothing is added", put(low, "window", 12, 14).made === null && put(low, "window3", 12, 14).made === null);
  const bare = mk({ house: { ...d0.house, storeys: 1, leftFt: 8, rightFt: 8, jogs: [], openings: [{ id: "a", kind: "slider", xFt: 8, widthFt: 6, heightFt: 6.67, sillFt: 3 }] } });
  const alone = put(bare, "window", 13, 7.7);
  check("a window clicked on a bare stretch, no row there: its middle under the pointer — its sill 3 ft above the deck's floor when that is within a foot (and it follows that floor)", !!alone.o && near(alone.o.sill, 6, 0.01) && near(alone.o.h, 4, 0.01) && alone.listed?.floor === "deck" && near(alone.listed.upFt ?? 0, 3, 0.01), [alone.o, alone.listed]);
  const free = put(bare, "window2", 19, 6.6);
  check("…farther from any floor's usual sill: where it was clicked, by its own height; a double window is 6 ft with 2 sashes", !!free.o && near(free.o.sill, 4.6, 0.02) && free.listed?.floor === undefined && near(free.o.w, 6, 0.01) && free.o.panels === 2, [free.o, free.listed]);
  // Doors.
  const noDoor = without(low, "d1");
  const mid = put(noDoor, "slider2", 8.4, 5);
  check("a sliding door clicked over the deck, within 9 in. of the deck's middle: on the deck's floor, on its middle", !!mid.o && near(mid.o.x, 8, 0.01) && near(mid.o.sill, 3, 0.01) && mid.o.kind === "slider" && mid.listed?.floor === "deck", [mid.o, mid.listed]);
  const end = put(noDoor, "door", 15.7, 5);
  check("a door clicked at the deck's very end: kept wholly on the deck's stretch of the wall (it opens onto the deck, not past it)", !!end.o && near(end.o.x + end.o.w / 2, 16 - 0.25, 0.02) && near(end.o.sill, 3, 0.01), end.o);
  const side = put(low, "door", 21, 4);
  check("a door clicked beside the deck: at the ground, where it was clicked (no deck floor to stand on there)", !!side.o && near(side.o.x, 21, 0.02) && near(side.o.sill, 0, 0.01) && side.listed?.floor === undefined, [side.o, side.listed]);
  const second = put(low, "door", 9, 5);
  check("a door clicked onto the deck's own door: it lands beside it, still on the deck", !!second.o && (second.o.x + 1.5 <= 5 - 0.44 || second.o.x - 1.5 >= 11 + 0.44) && second.o.x - 1.5 >= 0.2 && second.o.x + 1.5 <= 15.8 && near(second.o.sill, 3, 0.01), second.o);
  const upper = put(dbl, "door", 2.6, 12);
  const lower = put(dbl, "door", 2.6, 4);
  check("a double deck, a door clicked at the upper floor's height: on the upper deck's floor; at the lower floor's height: on the lower floor", !!upper.o && near(upper.o.sill, 10.5, 0.01) && upper.listed?.floor === "deck" && !!lower.o && near(lower.o.sill, 1.5, 0.01) && lower.listed?.floor === "lower", [upper.o, lower.o]);
  check("no such choice, or no wall: nothing", addOpeningAt(buildStructure(low), "nope", 3, 5) === null && addOpeningAt(buildStructure(mk({ placement: "detached" })), "door", 3, 5) === null);
}

/* ── 11. The 3D: a handle each, and their panels ───────────────────────── */
const sc = deckScene(buildStructure(tri.d));
const hs = sc.handles.filter((h) => h.kind === "opening");
const hd = hs.find((h) => h.id === "d1");
check("each window and door is a handle: its middle along the house and its sill (ft), its box on the wall, what it is", hs.length === drawnOf(tri.d).length && hd?.axis === "xz" && near(hd.value, 8, 0.01) && near(hd.value2 ?? -1, 3, 0.01) && hd.open?.kind === "slider" && hd.open.panels === 3 && near(hd.open.w, 9, 0.01) && !!hd.grab && hd.grab[0] < 8 && hd.grab[3] > 8, hd);
check("…they come last in the list (the knobs first)", sc.handles.findIndex((h) => h.kind === "opening") > sc.handles.findIndex((h) => h.kind === "width") && sc.handles.slice(sc.handles.findIndex((h) => h.kind === "opening")).every((h) => h.kind === "opening"));
check("…the door's panels ride on its row in the scene", sc.house?.doors?.find((r) => near(r[0], 8))?.[6] === 3 && sc.house.doors.every((r) => r.length === 6 || r.length === 7));
const back = parseDeckScene(JSON.parse(JSON.stringify(sc)));
check("…and all of it reads back from a saved scene", back?.handles.find((h) => h.kind === "opening" && h.id === "d1")?.open?.panels === 3 && back.house?.doors?.find((r) => near(r[0], 8))?.[6] === 3);
check("a wall drawn by rule has the handles too (so the first click finds them)", deckScene(buildStructure(low)).handles.filter((h) => h.kind === "opening").length === first.length);
check("a deck off the house has none", !deckScene(buildStructure(mk({ placement: "detached" }))).handles.some((h) => h.kind === "opening"));

/* ── 12. Read back ─────────────────────────────────────────────────────── */
const kept = normalizeDeckDesign(JSON.parse(JSON.stringify(tri.d)));
check("a wall arranged by hand reads back the same: panels, floors, the sketch mark", JSON.stringify(kept.house.openings) === JSON.stringify(tri.d.house.openings) && kept.house.openingsSketch === true);
const odd = mk({ house: { ...d0.house, leftFt: 8, rightFt: 8, jogs: [], openingsSketch: true, openings: [{ id: "a", kind: "garage", xFt: 8, widthFt: 9, heightFt: 7, sillFt: 0, panels: 3 }, { id: "b", kind: "door", xFt: 2, widthFt: 3, heightFt: 6.67, sillFt: 3, panels: 4, floor: "attic", upFt: 2 }, { id: "c", kind: "slider", xFt: 14, widthFt: 6, heightFt: 6.67, sillFt: 3, panels: 1, floor: "deck", upFt: -3 }] } }).house.openings!;
check("…held to what each kind can be: a garage door no panels, a door two leaves at most, a slider two at least; no floor that is none; never under its floor", odd.find((o) => o.id === "a")?.panels === undefined && odd.find((o) => o.id === "b")?.panels === 2 && odd.find((o) => o.id === "b")?.floor === undefined && odd.find((o) => o.id === "c")?.panels === 2 && odd.find((o) => o.id === "c")?.upFt === 0, odd);
check("the sketch mark means nothing without a list", mk({ house: { ...d0.house, openingsSketch: true } }).house.openingsSketch === undefined);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
