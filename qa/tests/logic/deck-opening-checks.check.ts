// The deck against the house's real doors and windows (2026-10-23, lib/deck/openingChecks — Stage 3 of "build the house
// from a photo"): the door's threshold against the deck's surface (above it, level with it, the steps the code allows,
// too far down) with the one-tap height that answers it; a window the ledger would run across, and a window under the
// deck; low glass beside the new walking surface; a covered deck's roof running into an upper window or over a tall door
// where it meets the house, with the pitch or the eave that clears it; glass by the hot tub. A house drawn by rule and a
// detached deck are not checked. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-opening-checks.check.ts
import { defaultDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { applyDeckPatch, deckChecks, type DeckCheck } from "@/lib/deck/checks";
import { buildStructure } from "@/lib/deck/structure";
import type { HouseOpening } from "@/lib/deck/house";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};

const d0 = defaultDeckDesign({ state: "WA" }); // 16 × 12, 36 in. high, on the house
const withOpenings = (d: DeckDesign, openings: HouseOpening[], more: Parameters<typeof applyDeckPatch>[1] = {}) => applyDeckPatch(d, { ...more, house: { ...d.house, openings } });
const run = (d: DeckDesign) => deckChecks(buildStructure(d));
const find = (cs: DeckCheck[], id: string) => cs.find((c) => c.id === id);
const door = (sillFt: number, kind: HouseOpening["kind"] = "door", xFt = 8): HouseOpening => ({ id: "d1", kind, xFt, widthFt: kind === "slider" ? 6 : 3, heightFt: 6.75, sillFt });
const win = (xFt: number, sillFt: number, widthFt = 3, heightFt = 4, id = "w1"): HouseOpening => ({ id, kind: "window", xFt, widthFt, heightFt, sillFt });
const ids = (cs: DeckCheck[]) => cs.filter((c) => /^(door|window|roof-openings|spa-glass)/.test(c.id)).map((c) => `${c.id}:${c.level}`).join(" ");

console.log("— the door the deck serves —");
const above = run(withOpenings(d0, [door(2.5)])); // threshold 30 in., deck 36 in.
const a = find(above, "door-threshold");
check("a deck 6 in. above the door's threshold fails, and offers the deck an inch under it", a?.level === "fail" && /6 in\. above/.test(a.text) && a.fix?.patch.heightIn === 29, JSON.stringify(a));
const fixed = run(applyDeckPatch(withOpenings(d0, [door(2.5)]), a!.fix!.patch));
check("…and with it the step is the code's 1 in.: a pass", find(fixed, "door-threshold")?.level === "pass", ids(fixed));
check("level with the threshold: a warning (no room for the flashing)", find(run(withOpenings(d0, [door(3)])), "door-threshold")?.level === "warn");
check("an inch and a bit under: a pass", find(run(withOpenings(d0, [door(3.1)])), "door-threshold")?.level === "pass");
const slider = find(run(withOpenings(d0, [door(3.4, "slider")])), "door-threshold");
check("a 5-in. step from a sliding door: allowed (it doesn't swing out over the deck)", slider?.level === "pass" && /sliding door doesn't/.test(slider.text), JSON.stringify(slider));
const swing = find(run(withOpenings(d0, [door(3.4)])), "door-threshold");
check("the same step from a swinging door: said, with the door that swings out in mind", swing?.level === "info" && /swings in/.test(swing.text) && swing.fix?.patch.heightIn === 40);
const deep = find(run(withOpenings(d0, [door(4)])), "door-threshold");
check("a 12-in. step down: past the code's 7¾ in. — raise the deck to 47 in.", deep?.level === "warn" && deep.fix?.patch.heightIn === 47, JSON.stringify(deep));
check("a door past the deck's end is not this deck's door", !find(run(withOpenings(d0, [door(2.5, "door", 24)])), "door-threshold"));

console.log("— windows the deck runs across, and under it —");
const low = withOpenings(d0, [win(4, 2)]); // sill 24 in., deck 36 in.
const across = find(run(low), "window-ledger");
check("a window whose sill is under the deck's surface: the deck runs across it — a fail, lower the deck under it, or stand it free", across?.level === "fail" && across.fix?.patch.heightIn === 22 && across.alts?.[0].patch.placement === "beside", JSON.stringify(across));
check("…lowered under the sill, the window is clear of the deck", !find(run(applyDeckPatch(low, across!.fix!.patch)), "window-ledger"), ids(run(applyDeckPatch(low, across!.fix!.patch))));
const ledgerOnly = find(run(withOpenings(d0, [win(4, 0.5, 3, 2.5)])), "window-ledger"); // head 36 in. — the boards' level
check("a window just under the boards: the ledger crosses its head", ledgerOnly?.level === "fail" && /ledger/.test(ledgerOnly.text), JSON.stringify(ledgerOnly));
const high = applyDeckPatch(d0, { heightIn: 72 });
const under = find(run(withOpenings(high, [win(4, 1, 3, 3)])), "window-under");
check("a basement window under a high deck: the escape-window note, clear enough", under?.level === "info" && /36 in\./.test(under.text), JSON.stringify(under));
const cramped = find(run(withOpenings(applyDeckPatch(d0, { heightIn: 40 }), [win(4, 0.5, 2, 1.5)])), "window-under");
check("under a lower deck with less than 36 in. under the frame: a warning", cramped?.level === "warn", JSON.stringify(cramped));
check("a standing-free deck has no ledger to run across a window", !find(run(withOpenings(applyDeckPatch(d0, { placement: "beside" }), [win(4, 2)])), "window-ledger"));

console.log("— low glass beside the deck —");
const lowGlass = find(run(withOpenings(d0, [win(4, 4, 4, 5)])), "window-low-glass"); // 12 in. above the deck, 20 sq ft
check("a big window 12 in. above the deck: safety glass", lowGlass?.level === "warn" && /12 in\. above the deck/.test(lowGlass.text) && lowGlass.rule === "IRC R308.4.3", JSON.stringify(lowGlass));
check("a small one (6 sq ft) is not", !find(run(withOpenings(d0, [win(4, 4, 2, 3)])), "window-low-glass"));
check("a window 2 ft above the deck is not", !find(run(withOpenings(d0, [win(4, 5, 4, 5)])), "window-low-glass"));
const row = run(withOpenings(d0, [win(3, 3.25, 3, 5, "w1"), win(7, 3.25, 3, 5, "w2"), win(11, 3.17, 3, 5, "w3"), win(14, 6, 2, 2, "w4")]));
const rowGlass = row.filter((c) => c.id.startsWith("window-low-glass"));
check("a row of low windows is said once, every one named, the heights as a range", rowGlass.length === 1 && /^3 windows \(3'-0", 7'-0" and 11'-0" along the deck\) start 2–3 in\. above/.test(rowGlass[0].text), JSON.stringify(rowGlass.map((c) => c.text)));

console.log("— a covered deck's roof where it meets the house —");
const cov = applyDeckPatch(d0, { structure: "covered-deck" });
const shed = applyDeckPatch(cov, { roof: { ...cov.roof, kind: "shed", attach: "wall" } });
const zIn = buildStructure(shed).roof!.ledger!.zIn;
const upper = withOpenings(shed, [win(8, (zIn - 6) / 12, 3, 4)]);
const hit = find(run(upper), "roof-openings");
check("an upper window whose sill is under the roof's line: a fail, with a lower pitch (and a lower eave) to clear it", hit?.level === "fail" && /window/.test(hit.text) && typeof hit.fix?.patch.roof?.pitch === "number" && (hit.fix.patch.roof.pitch as number) < shed.roof.pitch, JSON.stringify(hit));
const cleared = run(applyDeckPatch(upper, hit!.fix!.patch));
check("…pitched lower, the roof meets the house under the window, with room for the flashing", find(cleared, "roof-openings")?.level === "pass", ids(cleared));
if (hit?.alts?.[0]) check("…or with the eave dropped", find(run(applyDeckPatch(upper, hit.alts[0].patch)), "roof-openings")?.level === "pass", ids(run(applyDeckPatch(upper, hit.alts[0].patch))));
check("a window well above the roof: clear", find(run(withOpenings(shed, [win(8, (zIn + 12) / 12, 3, 4)])), "roof-openings")?.level === "pass");
// A low porch roof (a 7-ft eave at 2:12) over a door with a tall transom: the roof's ledger crosses the door's head.
const lowShed = applyDeckPatch(shed, { roof: { ...shed.roof, eaveHeightIn: 84, pitch: 2 } });
const lowZ = buildStructure(lowShed).roof!.ledger!.zIn;
const tall = withOpenings(lowShed, [{ id: "d1", kind: "door", xFt: 8, widthFt: 3, heightFt: Math.min(12, (lowZ - 35) / 12), sillFt: 37 / 12 }]);
const over = find(run(tall), "roof-openings");
check("a tall door whose head reaches the roof's ledger: raise the roof", over?.level === "fail" && /ledger would cross/.test(over.text) && (over.fix?.patch.roof?.pitch as number) > lowShed.roof.pitch, `${lowZ} ${JSON.stringify(over)}`);
check("…and raised, it clears", find(run(applyDeckPatch(tall, over!.fix!.patch)), "roof-openings")?.level === "pass");
const gable = applyDeckPatch(cov, { roof: { ...cov.roof, kind: "gable", attach: "wall" } });
const gs = buildStructure(gable).roof!;
const gUpper = find(run(withOpenings(gable, [win(8, (gs.peakIn - 10) / 12, 3, 3)])), "roof-openings");
const gSide = find(run(withOpenings(gable, [win(0.5, (gs.headerTopIn + 20) / 12, 1, 3)])), "roof-openings");
check("a gable into the wall: a window under its peak is hit; one by the corner, above the eave, is clear", gUpper?.level === "fail" && gSide?.level === "pass", `${JSON.stringify(gUpper?.level)} ${JSON.stringify(gSide)}`);
check("the roof's old 'check it clears the windows' note is not said when the windows are known", !/the windows and/.test(find(run(upper), "roof-wall-height")?.text ?? "") && /the windows and/.test(find(run(shed), "roof-wall-height")?.text ?? ""));

console.log("— glass by the hot tub —");
const tubDeck = applyDeckPatch(d0, { shape: { kind: "rect", widthFt: 16, depthFt: 8 }, spa: { ...d0.spa, on: true, widthFt: 7, depthFt: 7, align: "center" } });
const tub = find(run(withOpenings(tubDeck, [win(8, 4, 3, 4)])), "spa-glass");
check("a window within 5 ft of the tub's water and under 5 ft up: safety glass", tub?.level === "warn" && tub.rule === "IRC R308.4.5", JSON.stringify(tub) + " " + ids(run(withOpenings(tubDeck, [win(8, 4, 3, 4)]))));
check("…not on a 16-ft-deep deck, where the tub by the front rail is 8 ft out from the wall", !find(run(withOpenings(applyDeckPatch(d0, { shape: { kind: "rect", widthFt: 16, depthFt: 16 }, spa: { ...d0.spa, on: true, widthFt: 7, depthFt: 7 } }), [win(8, 4, 3, 4)])), "spa-glass"));

console.log("— a second-storey deck: every opening on its own floor (2026-11-13) —");
// A deck builder's report: a second-storey deck was checked against the first floor's doors and windows as if it served them.
const both: HouseOpening[] = [
  { id: "d1", kind: "door", xFt: 8, widthFt: 3, heightFt: 6.75, sillFt: 0.5 },
  win(3, 3, 3, 4, "w1"),
  { id: "g1", kind: "garage", xFt: 13, widthFt: 4, heightFt: 7, sillFt: 0 },
  { id: "d2", kind: "slider", xFt: 8, widthFt: 6, heightFt: 6.75, sillFt: 115 / 12 },
  win(3, 12.5, 3, 4, "w2"),
];
const upDeck = applyDeckPatch(d0, { heightIn: 114, house: { ...d0.house, storeys: 2, openings: both } });
const upChecks = run(upDeck);
const loudOnes = upChecks.filter((c) => /^(door|window|spa-glass)/.test(c.id) && (c.level === "fail" || c.level === "warn" || !!c.fix));
check("a deck at the second floor, doors and windows on both floors: nothing to answer", !loudOnes.length, ids(upChecks));
check("…its own door is the upper one: an inch under its threshold", find(upChecks, "door-threshold")?.level === "pass" && /sliding door/.test(find(upChecks, "door-threshold")!.text) && !find(upChecks, "door-threshold-2"), ids(upChecks));
check("…the doors of the floor below are said once, as under the deck, with the room to its frame", find(upChecks, "door-under")?.level === "pass" && /^2 doors .* on the floor below/.test(find(upChecks, "door-under")!.text) && /8'-4"/.test(find(upChecks, "door-under")!.text), JSON.stringify(find(upChecks, "door-under")));
check("…and the window of the floor below, a storey under the frame, is a pass", find(upChecks, "window-under")?.level === "pass", JSON.stringify(find(upChecks, "window-under")));
check("the old fault: no 'stands 108 in. above the threshold', no 'set the deck at 5 in.'", !upChecks.some((c) => /above the door's threshold/.test(c.text) || c.fix?.patch.heightIn === 5));
const tubUp = applyDeckPatch(tubDeck, { heightIn: 114 });
check("a window of the floor below, under the deck, is not glass beside the tub", !find(run(withOpenings(tubUp, [win(8, 3, 3, 4)])), "spa-glass"), ids(run(withOpenings(tubUp, [win(8, 3, 3, 4)]))));
check("…a window above the boards within reach of the water still is", find(run(withOpenings(tubUp, [win(8, 10.5, 3, 4)])), "spa-glass")?.level === "warn");
const crossing = find(run(applyDeckPatch(upDeck, { heightIn: 60 })), "door-threshold");
check("a deck across the middle of a door is a real conflict still: under its threshold, or clear above its head", crossing?.level === "fail" && /would run across the door/.test(crossing.text) && crossing.fix?.patch.heightIn === 5 && crossing.alts?.[0].patch.heightIn === 96, JSON.stringify(crossing));
check("…raised clear above it, that door is under the deck", !!find(run(applyDeckPatch(applyDeckPatch(upDeck, { heightIn: 60 }), crossing!.alts![0].patch)), "door-under"));
const freeUp = run(applyDeckPatch(upDeck, { placement: "beside" }));
const inWay = find(freeUp, "door-under-post");
check("a free-standing deck's post in front of the door below: a warning, by the post's own place", inWay?.level === "warn" && /24 in\. out from the wall/.test(inWay.text) && inWay.rule === "IRC R311.3", JSON.stringify(inWay));
check("…and in front of the garage door below", /garage door/.test(find(freeUp, "door-under-post-2")?.text ?? ""), ids(freeUp));
const lowOnly = run(applyDeckPatch(d0, { heightIn: 12, house: { ...d0.house, storeys: 2, openings: [both[3]] } }));
const upperDoor = find(lowOnly, "door-above");
check("a low deck under an upper door alone: a note that the door is the floor above's, with the height that would reach it", upperDoor?.level === "info" && upperDoor.fix?.patch.heightIn === 114 && !find(lowOnly, "door-threshold"), ids(lowOnly));
const lowBoth = run(applyDeckPatch(upDeck, { heightIn: 5 }));
check("a low deck at its own door: the upper door is nothing to it", find(lowBoth, "door-threshold")?.level === "pass" && !find(lowBoth, "door-above") && !find(lowBoth, "door-threshold-2"), ids(lowBoth));

console.log("— what is not checked —");
check("a house drawn by rule (no doors or windows of its own): none of these checks", !ids(run(d0)), ids(run(d0)));
check("a detached deck: none", !ids(run(withOpenings(applyDeckPatch(d0, { placement: "detached" }), [door(2.5), win(4, 2)]))));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
