// NO TWO OPENINGS ON ONE SPOT OF THE WALL (2026-11-13, lib/deck/house — owner: "the glass and doors on the 3D are
// messy"): a photo's read had put a window inside the sliding door and another under its edge, and the 3D drew every
// one of them. The doors stand first, then the windows; an opening mostly inside another is left out; one that runs
// into another is cut back, or left out when too little would be left. What the 3D, the drawings and the code checks
// read is the settled wall — and a scene saved before the rule is settled when it is read. Pure.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-openings-settle.check.ts
import { defaultDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { applyDeckPatch, deckChecks } from "@/lib/deck/checks";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { OPENING_GAP_FT, settleOpeningRects, settleOpenings, settleSceneOpenings, type HouseOpening, type OpeningRect } from "@/lib/deck/house";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};

const rect = (kind: OpeningRect["kind"], x0: number, x1: number, y0: number, y1: number, face = 0): OpeningRect => ({ kind, x0, x1, y0, y1, face });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** Every pair of standing openings on one face keeps the rule's gap, side by side or one over the other. */
const clear = (rs: Array<OpeningRect | null>) => {
  const s = rs.filter((r): r is OpeningRect => !!r);
  return s.every((a, i) => s.slice(i + 1).every((b) => (a.face ?? 0) !== (b.face ?? 0) || Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= -(OPENING_GAP_FT.side - 0.05) || Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= -(OPENING_GAP_FT.over - 0.05)));
};

console.log("— the rule, on rectangles —");
const slider = rect("slider", 7, 13, 2.6, 9.35);
{
  const apart = [rect("window", 1, 4, 5.2, 9.2), slider, rect("window", 14, 17, 5.2, 9.2)];
  const out = settleOpeningRects(apart);
  check("openings that stand apart are left exactly as they are", out.every((r, i) => !!r && near(r.x0, apart[i].x0) && near(r.x1, apart[i].x1) && near(r.y0, apart[i].y0) && near(r.y1, apart[i].y1)), out);
}
{
  const out = settleOpeningRects([rect("window", 8.5, 11.5, 4.6, 8.6), slider]);
  check("a window inside the sliding door is the door's own glass: left out, the door untouched", out[0] === null && !!out[1] && near(out[1].x0, 7) && near(out[1].x1, 13), out);
}
{
  const out = settleOpeningRects([rect("window", 4.7, 7.7, 5.2, 9.2), slider]);
  check("a window whose edge runs under the door is cut back to leave a casing each", !!out[0] && near(out[0].x0, 4.7) && near(out[0].x1, 7 - OPENING_GAP_FT.side) && near(out[0].y0, 5.2), out);
  check("…and the door is the one that stays whole", !!out[1] && near(out[1].x0, 7) && near(out[1].x1, 13));
}
{
  const out = settleOpeningRects([rect("window", 5.8, 8.8, 5.2, 9.2), slider]);
  check("a window with too little left beside the door is left out, not drawn as a sliver", out[0] === null, out);
}
{
  const out = settleOpeningRects([slider, rect("window", 8, 12, 9.4, 10.6)]);
  check("a transom over the door stays over it, a casing's band above the door's head", !!out[1] && near(out[1].y0, 9.35 + OPENING_GAP_FT.over) && near(out[1].y1, 10.6) && near(out[1].x0, 8) && near(out[1].x1, 12), out);
}
{
  const out = settleOpeningRects([slider, rect("window", 8, 12, 9.62, 10.8)]);
  check("a transom already a casing's band above is not touched", !!out[1] && near(out[1].y0, 9.62), out);
}
{
  const out = settleOpeningRects([rect("door", 20, 23, 2.6, 9.35), rect("slider", 14, 22, 2.6, 9.35)]);
  check("a door read on top of the sliding door is the same door read twice: one stands, the larger", out[0] === null && !!out[1], out);
}
{
  const out = settleOpeningRects([rect("door", 12.6, 15.6, 2.6, 9.35), slider]);
  check("a door that only brushes the sliding door is narrowed, never cut in height", !!out[0] && near(out[0].x0, 13.5) && near(out[0].x1, 15.6) && near(out[0].y0, 2.6) && near(out[0].y1, 9.35), out);
}
{
  const out = settleOpeningRects([rect("door", 12, 15, 2.6, 9.35), slider]);
  check("a door that would be left under 2 ft wide is left out", out[0] === null, out);
}
{
  const out = settleOpeningRects([rect("window", 1, 4, 5.2, 9.2), rect("window", 3.6, 6.6, 5.2, 9.2), rect("window", 1.1, 3.9, 5.3, 9.1)]);
  check("windows: the first of two equals stands, the next is cut back; the same window read twice is one window", !!out[0] && near(out[0].x1, 4) && !!out[1] && near(out[1].x0, 4.5) && out[2] === null, out);
}
{
  const out = settleOpeningRects([rect("window", 8.5, 11.5, 4.6, 8.6, 4), slider]);
  check("openings on different faces of the wall never touch each other", !!out[0] && !!out[1], out);
}
{
  // Many openings thrown at one wall: whatever stands is clear of the rest, and settling it again changes nothing.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let ok = true;
  let stable = true;
  for (let n = 0; n < 400; n++) {
    const rs: OpeningRect[] = [];
    for (let i = 0; i < 3 + Math.floor(rnd() * 9); i++) {
      const door = rnd() < 0.3;
      const w = door ? (rnd() < 0.5 ? 3 : 6) : 1 + rnd() * 5;
      const h = door ? 6.75 : 1 + rnd() * 4;
      const x = rnd() * 30;
      const y = door ? 2.5 : 2.5 + rnd() * 8;
      rs.push(rect(door ? (w > 4 ? "slider" : "door") : "window", x, x + w, y, y + h));
    }
    const out = settleOpeningRects(rs);
    if (!clear(out)) ok = false;
    const kept = out.filter((r): r is OpeningRect => !!r);
    const again = settleOpeningRects(kept);
    if (!again.every((r, i) => !!r && near(r.x0, kept[i].x0) && near(r.x1, kept[i].x1) && near(r.y0, kept[i].y0) && near(r.y1, kept[i].y1))) stable = false;
    if (!out.some((r) => !!r)) ok = false;
  }
  check("400 walls of openings thrown together: what stands is always clear of the rest", ok);
  check("…and settling a settled wall changes nothing", stable);
}

console.log("— the design's openings —");
const o = (id: string, kind: HouseOpening["kind"], xFt: number, widthFt: number, heightFt: number, sillFt: number): HouseOpening => ({ id, kind, xFt, widthFt, heightFt, sillFt });
const messy: HouseOpening[] = [o("w1", "window", 2.5, 3, 4, 5.2), o("w2", "window", 6.2, 3, 4, 5.2), o("d1", "slider", 10, 6, 6.75, 2.6), o("w3", "window", 10, 3, 4, 4.6), o("w4", "window", 15.5, 3, 4, 5.2)];
{
  const out = settleOpenings(messy);
  check("the owner's wall: the window inside the door goes, the one under its edge is cut back, the rest stand", out.map((x) => x.id).join(" ") === "w1 w2 d1 w4" && out[0] === messy[0] && out[2] === messy[2] && out[3] === messy[4], out);
  const w2 = out[1];
  check("…the cut window ends a casing each short of the door, its other edge where it was — kept to the inch", Math.abs(w2.xFt + w2.widthFt / 2 - 6.5) < 0.05 && Math.abs(w2.xFt - w2.widthFt / 2 - 4.7) < 0.05 && Math.abs(w2.sillFt - 5.2) < 0.05 && near(w2.heightFt, 4), w2);
  check("a clean wall comes back as the same openings", settleOpenings([messy[0], messy[2], messy[4]]).every((x, i) => x === [messy[0], messy[2], messy[4]][i]));
}

console.log("— what the 3D is given —");
const d0 = defaultDeckDesign({ state: "WA" });
const withOpenings = (openings: HouseOpening[], more: Parameters<typeof applyDeckPatch>[1] = {}): DeckDesign => applyDeckPatch(d0, { shape: { kind: "rect", widthFt: 20, depthFt: 12 }, heightIn: 30, ...more, house: { ...d0.house, openings } });
{
  const scene = deckScene(buildStructure(withOpenings(messy)));
  const H = scene.house!;
  check("the scene's house: one sliding door, three windows", H.doors?.length === 1 && H.doors[0][5] === 1 && H.windows?.length === 3, { doors: H.doors, windows: H.windows });
  const rows = [...(H.windows ?? []), ...(H.doors ?? [])].map((r) => rect("window", r[0] - r[2] / 2, r[0] + r[2] / 2, r[4], r[4] + r[3], r[1]));
  check("…none of them on another's spot", clear(rows), rows);
  const clean = deckScene(buildStructure(withOpenings([messy[0], messy[2], messy[4]])));
  // (The design keeps a sill to the inch: 5.2 ft is 5 ft 2 in., 2.6 ft is 2 ft 7 in.)
  check("a clean wall is drawn exactly where its openings are", JSON.stringify(clean.house?.windows) === JSON.stringify([[2.5, 0, 3, 4, 5.17], [15.5, 0, 3, 4, 5.17]]) && JSON.stringify(clean.house?.doors) === JSON.stringify([[10, 0, 6, 6.75, 2.58, 1]]), clean.house);
}
{
  // A scene saved before the rule: the window is still inside the door in the stored rows.
  const scene = deckScene(buildStructure(withOpenings([messy[0], messy[2], messy[4]])));
  const stored = JSON.parse(JSON.stringify(scene)) as { house: { windows: number[][]; doors: number[][] } };
  stored.house.windows.push([10, 0, 3, 4, 4.6], [6.2, 0, 3, 4, 5.2]);
  const back = parseDeckScene(stored);
  check("a saved scene with a window inside its door is read back clean", !!back && back.house?.windows?.length === 3 && back.house.doors?.length === 1 && clear([...(back.house.windows ?? []), ...(back.house.doors ?? [])].map((r) => rect("window", r[0] - r[2] / 2, r[0] + r[2] / 2, r[4], r[4] + r[3], r[1]))), back?.house);
  const same = parseDeckScene(JSON.parse(JSON.stringify(scene)));
  check("a clean saved scene is read back as it was", JSON.stringify(same?.house) === JSON.stringify(scene.house));
  const none = settleSceneOpenings(undefined, undefined);
  check("a house with no openings listed stays that way", none.windows === undefined && none.doors === undefined);
}

console.log("— a house drawn by rule: the door on the deck's floor, every row of windows clear of it —");
{
  // (2026-11-14) A second-storey deck: its door stands on the upper floor, where only the FIRST row of windows used
  // to leave a door clear — the upper row ran straight across it.
  const byRule = (heightIn: number, widthFt = 24, more: Parameters<typeof applyDeckPatch>[1] = {}) => deckScene(buildStructure(applyDeckPatch(d0, { shape: { kind: "rect", widthFt, depthFt: 12 }, heightIn, ...more }))).house!;
  const rowsOf = (H: NonNullable<ReturnType<typeof byRule>>, deckFt: number) => [
    ...(H.door ? [rect("slider", H.door[0] - H.door[1] / 2, H.door[0] + H.door[1] / 2, deckFt, deckFt + H.door[2], H.door[3] ?? 0)] : []),
    ...(H.windows ?? []).map((r) => rect("window", r[0] - r[2] / 2, r[0] + r[2] / 2, r[4], r[4] + r[3], r[1])),
  ];
  const up = byRule(114);
  const door = up.door!;
  const nearDoor = (up.windows ?? []).filter((w) => w[4] < 9.5 + door[2] + 1 && w[4] + w[3] > 9.5 - 1 && Math.abs(w[0] - door[0]) < door[1] / 2 + 1.5 + w[2] / 2 - 0.01);
  check("a second-storey deck: there is a door on the deck, and windows on that floor", !!door && (up.windows ?? []).some((w) => w[4] > 9.5), up.windows);
  check("…and no window stands on the door or inside its trim", nearDoor.length === 0, nearDoor);
  check("…nothing on the wall is on another's spot", clear(rowsOf(up, 9.5)), rowsOf(up, 9.5));
  // The owner's deck: a covered second-storey deck. Its roof's peak makes the wall taller, the taller wall gets an
  // upper row of windows — and that row is the one on the door's floor.
  const covered = byRule(114, 24, { structure: "covered-deck", roof: { ...d0.roof, kind: "gable", attach: "wall" } });
  const cDoor = covered.door!;
  const onDoor = (covered.windows ?? []).filter((w) => Math.abs(w[0] - cDoor[0]) < cDoor[1] / 2 + 1.5 + w[2] / 2 - 0.01 && w[4] < 9.5 + cDoor[2] + 1);
  check("a covered second-storey deck: windows stand on the door's floor, each side of it", (covered.windows ?? []).some((w) => w[0] < cDoor[0]) && (covered.windows ?? []).some((w) => w[0] > cDoor[0]) && (covered.windows ?? []).every((w) => w[4] > 9.5), covered.windows);
  check("…none of them on the door or inside its trim", onDoor.length === 0 && clear(rowsOf(covered, 9.5)), onDoor);
  const upper2 = byRule(114, 24, { house: { ...d0.house, storeys: 2 } });
  check("a second-storey deck on a two-storey house: the same", clear(rowsOf(upper2, 9.5)) && (upper2.windows ?? []).length > 0, upper2.windows);
  let ok = true;
  const badAt: number[] = [];
  for (let h = 8; h <= 168; h += 4) {
    for (const w of [8, 12, 16, 24, 36]) {
      const H = byRule(h, w);
      if (!clear(rowsOf(H, h / 12))) {
        ok = false;
        badAt.push(h, w);
      }
    }
  }
  check("every deck height from 8 in. to 14 ft, five widths: the door and the windows never meet", ok, badAt.slice(0, 12));
  const two = byRule(30, 24, { house: { ...d0.house, storeys: 2 } });
  const over = (two.windows ?? []).filter((w) => w[4] > 9.5 && Math.abs(w[0] - two.door![0]) < 3);
  check("a low deck on a two-storey house keeps the upper windows over its door (they are a storey above it)", over.length > 0 && clear(rowsOf(two, 2.5)), two.windows);
}

console.log("— the code checks read the settled wall —");
{
  // A window marked low inside the sliding door (its glass): on its own it would read as a window the deck runs across.
  const ghost = o("w9", "window", 10, 3, 3, 2.7);
  const alone = deckChecks(buildStructure(withOpenings([ghost], { heightIn: 36 })));
  const inDoor = deckChecks(buildStructure(withOpenings([o("d1", "slider", 10, 6, 6.75, 3.1), ghost], { heightIn: 36 })));
  check("a real window the ledger would cross still fails", alone.some((c) => c.id.startsWith("window-ledger") && c.level === "fail"), alone.filter((c) => /^window/.test(c.id)).map((c) => c.id));
  check("the same box inside a sliding door is the door's glass: no window check at all", !inDoor.some((c) => /^window/.test(c.id)), inDoor.filter((c) => /^window/.test(c.id)).map((c) => c.id));
  check("…and the door is still checked against the deck", inDoor.some((c) => c.id === "door-threshold"));
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
