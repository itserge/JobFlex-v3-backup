// The fence in 3D is built from its type's parts (2026-09-28, lib/fence/build
// + fenceGeometry), and the ground is read for its SHAPE (fenceTerrain): a
// gradual slope racks as one line, rolling ground steps, a build that cannot
// rack steps sooner. Static imports only (tsx has no top-level await).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/fence-build.check.ts
import { describeBuild, fenceBuildFor, fenceBuildForFamily, parseFenceBuild } from "../../../src/lib/fence/build";
import { fenceType } from "../../../src/lib/fence/catalog";
import { computeFenceLayout, railRowsFor } from "../../../src/components/estimator/fence/fenceGeometry";
import { profileShape, terrainFromProfile, type SegSampling } from "../../../src/components/estimator/fence/fenceTerrain";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── the build, off the catalog
const cedar6 = fenceBuildFor(fenceType("cedar-privacy"), 6);
check("cedar privacy at 6 ft: posts every 8 ft, three 2×4 rails on edge, 5½\" boards butted, pyramid caps",
  cedar6.spacingFt === 8 && cedar6.rails === 3 && cedar6.infill === "boards" && Math.abs(cedar6.boardWidthFt - 5.5 / 12) < 1e-9 && Math.abs(cedar6.railHeightFt - 3.5 / 12) < 1e-9 && cedar6.postCap === "pyramid" && cedar6.postProfile === "square",
  describeBuild(cedar6));
const cedar4 = fenceBuildFor(fenceType("cedar-privacy"), 4);
check("the same type at 4 ft carries two rails", cedar4.rails === 2);
const chain = fenceBuildFor(fenceType("chain-link-galv"), 4);
check("chain link: mesh on round 1⅝\" posts every 10 ft, loop caps, one top rail, 2\" diamonds",
  chain.kind === "mesh" && chain.infill === "mesh" && chain.postProfile === "round" && Math.abs(chain.postWidthFt - 1.625 / 12) < 1e-9 && chain.spacingFt === 10 && chain.postCap === "loop" && chain.rails === 1 && Math.abs((chain.meshDiamondFt ?? 0) - 2 / 12) < 1e-9,
  describeBuild(chain));
const shadow = fenceBuildFor(fenceType("shadowbox"), 6);
check("shadowbox: boards on both faces", shadow.infill === "shadowbox" && shadow.boardGapFt > 0);
const bob = fenceBuildFor(fenceType("board-on-board"), 6);
check("board-on-board: an overlap, two layers", bob.infill === "board-on-board" && bob.boardGapFt < 0);
const horiz = fenceBuildFor(fenceType("horizontal-modern"), 6);
check("horizontal modern: no rails, the boards are the horizontals, posts every 6 ft", horiz.rails === 0 && horiz.infill === "horizontal" && horiz.spacingFt === 6);
const alu = fenceBuildFor(fenceType("aluminum-ornamental"), 4);
check("aluminum: ¾\" bars through channel rails every 6 ft, racks like a hill", alu.infill === "bars" && alu.spacingFt === 6 && alu.rackMaxDeg === 25);
const vinyl = fenceBuildFor(fenceType("vinyl-privacy"), 6);
check("vinyl privacy: a prefab panel that barely racks (4°)", vinyl.kind === "panel" && vinyl.rackMaxDeg === 4);
const split = fenceBuildFor(fenceType("split-rail-2"), 3);
check("split rail: two rails, nothing between, round posts standing proud", split.infill === "none" && split.rails === 2 && split.postProfile === "round" && split.postProudFt > 0.5);
check("a spacing override holds on a stick build and not on a panel", fenceBuildFor(fenceType("cedar-privacy"), 6, 6).spacingFt === 6 && fenceBuildFor(fenceType("vinyl-privacy"), 6, 6).spacingFt === 8);
check("a family alone still builds (older plans)", fenceBuildForFamily("chain-link", 4).infill === "mesh" && fenceBuildForFamily("nonsense", 6).infill === "boards");
check("a stored build round-trips; a bad one is no build", JSON.stringify(parseFenceBuild(JSON.parse(JSON.stringify(cedar6)))) === JSON.stringify(cedar6) && parseFenceBuild({ ...cedar6, spacingFt: 99 }) === null && parseFenceBuild({ ...cedar6, infill: "lasers" }) === null && parseFenceBuild(null) === null);

// ── the layout, from the build
const L = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }];
const lay8 = computeFenceLayout(L, [], { build: cedar6 });
const lay10 = computeFenceLayout(L, [], { build: chain });
check("posts follow the type's spacing: 40 + 30 ft is 5 + 4 bays at 8 ft (10 posts), 4 + 3 at 10 ft (8 posts)", lay8.postCount === 10 && lay8.bayCount === 9 && lay10.postCount === 8 && lay10.bayCount === 7, `${lay8.postCount}/${lay8.bayCount} · ${lay10.postCount}/${lay10.bayCount}`);
const terminals = Array.from(lay8.postTerminal).filter((v) => v === 1).length;
check("the two ends and the corner are terminal posts, the rest line posts", terminals === 3, String(terminals));
check("a butted privacy run is boards on the outside face, clear of the posts", lay8.picketCount > 140 && Array.from(lay8.picketOffset).every((z) => z < -0.15));
const layShadow = computeFenceLayout(L, [], { build: shadow });
const sides = new Set(Array.from(layShadow.picketOffset).map((z) => Math.sign(z)));
check("a shadowbox puts boards on both sides of the rails", sides.has(-1) && sides.has(1));
const layMesh = computeFenceLayout(L, [], { build: chain });
check("mesh has no boards; a rail fence has none either", layMesh.picketCount === 0 && computeFenceLayout(L, [], { build: split }).picketCount === 0);
const rows6 = railRowsFor(cedar6, 6);
check("three rails on a 6 ft privacy fence sit a foot up, mid-way and a hand under the top", rows6.length === 3 && rows6[0].off < 1.05 && Math.abs(rows6[1].off - (rows6[0].off + rows6[2].off) / 2) < 1e-6 && rows6[2].off > 5, rows6.map((r) => r.off.toFixed(2)).join(" / "));
const rowsH = railRowsFor(horiz, 6);
check("horizontal boards stack up the face: eleven 5½\" boards with ¾\" gaps under 6 ft", rowsH.length === 11 && rowsH.every((r) => Math.abs(r.h - 5.5 / 12) < 1e-9), String(rowsH.length));
const rowsMesh = railRowsFor(chain, 4);
check("chain link carries a top rail at the fabric's top and a tension wire near the ground", rowsMesh.length === 2 && rowsMesh[0].off > 3.9 && rowsMesh[1].off < 0.2);
const layDefault = computeFenceLayout(L);
check("without a build the old privacy run comes out as it always did (8 ft, one face)", layDefault.postCount === 10 && layDefault.build.spacingFt === 8 && layDefault.picketCount > 0);

// ── the ground: stepped bays split at a code step, with extra posts
const hill = (x: number) => -x * 0.3; // 30 % grade down the x axis
const layHill = computeFenceLayout([{ x: 0, y: 0 }, { x: 16, y: 0 }], [], { build: cedar6, groundAt: hill, segClass: () => "stepped" });
check("a stepped 16 ft run dropping 4.8 ft is not two 2.4 ft cliffs: five even ≤ 1 ft steps (6 posts, 5 bays)", layHill.postCount === 6 && layHill.bayCount === 5 && layHill.steppedBays === 5, `${layHill.postCount} posts · ${layHill.bayCount} bays`);
// The ticket's count wins over the ground under each bay (vinyl: 29 drawn, 31 priced).
const layPriced = computeFenceLayout([{ x: 0, y: 0 }, { x: 16, y: 0 }], [], { build: cedar6, groundAt: hill, segClass: () => "stepped", segSteps: () => 5 });
check("given the ticket's step count, the 3D draws exactly that many equal steps", layPriced.steppedBays === 5 && layPriced.bayCount === 5 && layPriced.postCount === 6, `${layPriced.steppedBays} steps · ${layPriced.postCount} posts`);
const dropOk = (() => {
  for (let i = 0; i < layHill.bayCount; i++) {
    const o = i * 7;
    if (Math.abs(layHill.bays[o + 2] - layHill.bays[o + 5]) > 1e-6) return false; // level panel
    if (i > 0 && layHill.bays[(i - 1) * 7 + 2] - layHill.bays[o + 2] > 1.0001) return false; // ≤ 1 ft step
  }
  return true;
})();
check("every stepped panel is level and every step is a foot or less", dropOk);
const layRack = computeFenceLayout([{ x: 0, y: 0 }, { x: 16, y: 0 }], [], { build: cedar6, groundAt: hill, segClass: () => "racked" });
check("a racked run follows the grade in two bays — no extra posts", layRack.postCount === 3 && layRack.bayCount === 2 && Math.abs(layRack.bays[2] - layRack.bays[5]) > 2);

// ── the shape of the ground: gradual racks, rolling steps
const seg = (planFt: number, count: number): SegSampling => ({ seg: 0, start: 0, count, planFt });
const gradual = terrainFromProfile([seg(80, 9)], [0, -1, -2, -3, -4, -5, -6, -7, -8], { sectionFt: 8, rackMaxDeg: 20 });
check("a gradual 10 % slope with no up and down racks: one line following the grade", gradual.segs[0].cls === "racked" && !gradual.segs[0].rolling, gradual.segs[0].cls);
const rolling = terrainFromProfile([seg(80, 9)], [0, -1, -2, -0.5, 0.5, -1.5, -3, -4, -5], { sectionFt: 8, rackMaxDeg: 20 });
check("the same net fall over rolling ground steps", rolling.segs[0].cls === "stepped" && rolling.segs[0].rolling === true, `${rolling.segs[0].cls} · off line ${rolling.segs[0].offLineFt} ft`);
const hump = terrainFromProfile([seg(40, 5)], [0, 0.4, 1.6, 0.3, 0.1], { sectionFt: 8, rackMaxDeg: 20 });
check("a hump on level ground steps too — a racked panel would bury or hang", hump.segs[0].cls === "stepped" && hump.segs[0].rolling === true);
const steep = terrainFromProfile([seg(40, 5)], [0, -4, -8, -12, -16], { sectionFt: 8, rackMaxDeg: 20 });
check("steeper than the build can rack (22° > 20°) steps — a step per foot of its 16 ft fall", steep.segs[0].cls === "stepped" && steep.segs[0].steps === 16 && !steep.segs[0].rolling, String(steep.segs[0].steps));
const steepPanel = terrainFromProfile([seg(40, 5)], [0, -1.5, -3, -4.5, -6], { sectionFt: 8, rackMaxDeg: 4 });
const steepStick = terrainFromProfile([seg(40, 5)], [0, -1.5, -3, -4.5, -6], { sectionFt: 8, rackMaxDeg: 20 });
check("the same 15 % grade (8.5°) racks stick-built and steps a prefab panel", steepStick.segs[0].cls === "racked" && steepPanel.segs[0].cls === "stepped", `${steepStick.segs[0].cls} / ${steepPanel.segs[0].cls}`);
const gentle = terrainFromProfile([seg(40, 5)], [0, -0.5, -1, -1.5, -2], { sectionFt: 8, rackMaxDeg: 4 });
check("a 5 % grade (under 5°) is level even for a panel", gentle.segs[0].cls === "level");
const chainRacks = terrainFromProfile([seg(40, 5)], [0, -4, -8, -12, -16], { sectionFt: 10, rackMaxDeg: 25 });
check("chain link follows a 22° hill (under its 25°)", chainRacks.segs[0].cls === "racked");
const chainSteps = terrainFromProfile([seg(40, 5)], [0, -6, -12, -18, -24], { sectionFt: 10, rackMaxDeg: 25 });
check("past that it steps — 24 ft of fall over 40 ft: a step every 2 ft, the shortest bay (20)", chainSteps.segs[0].cls === "stepped" && chainSteps.segs[0].steps === 20, String(chainSteps.segs[0].steps));
const flat = terrainFromProfile([seg(40, 5)], [10, 10.1, 10, 9.9, 10], {});
check("flat ground is level, no rules needed", flat.segs[0].cls === "level" && !flat.segs[0].rolling);
const shape = profileShape([0, 1, 2, 1, 0]);
check("profileShape reads a hump: 2 ft off the line, 2 ft of travel back", Math.abs(shape.offLineFt - 2) < 1e-9 && Math.abs(shape.backFt - 2) < 1e-9);

// ── judged where the fence meets it, two bays at a time (2026-11-10)
// The test lot's real side (USGS lidar, 164.7 ft, samples every 9.7 ft): it only bends as it climbs — 1.7 ft off its
// end-to-end line, no travel back, its biggest bump over 20 ft 0.46 ft. It stepped every bay (21 steps) before.
const lawn = [359.3, 359.4, 359.5, 359.8, 360.2, 360.6, 361.2, 362.6, 363.2, 363.4, 364.4, 364.8, 366.0, 367.1, 368.2, 368.9, 369.1, 369.4];
const lawnCedar = terrainFromProfile([seg(164.7, lawn.length)], lawn, { sectionFt: 8, rackMaxDeg: 20 });
check("a smooth lawn that only bends as it climbs racks a cedar fence — no priced steps", lawnCedar.segs[0].cls === "racked" && !lawnCedar.segs[0].steps && !lawnCedar.segs[0].rolling, `${lawnCedar.segs[0].cls} ${lawnCedar.segs[0].steps ?? 0}`);
// The lot's other long side: gentle on average (3.9°) with a steep middle (≈12° over 20 ft).
const crest = [374.1, 374.4, 374.2, 373.9, 373.7, 373.5, 372.8, 370.8, 368.5, 366.5, 366.0, 365.1, 364.8, 364.1, 363.7, 363.2, 363.0, 362.7];
const crestCedar = terrainFromProfile([seg(164.7, crest.length)], crest, { sectionFt: 8, rackMaxDeg: 20 });
const crestVinyl = terrainFromProfile([seg(164.7, crest.length)], crest, { sectionFt: 8, rackMaxDeg: 4 });
check("a steep middle inside a gentle side: cedar (racks 20°) follows it, a vinyl panel (4°) steps", crestCedar.segs[0].cls === "racked" && crestVinyl.segs[0].cls === "stepped" && (crestVinyl.segs[0].steps ?? 0) > 0, `${crestCedar.segs[0].cls} / ${crestVinyl.segs[0].cls}`);
check("the shape reads the bump inside two bays and the steepest stretch", (() => { const s = profileShape(crest, 164.7 / 17, 2); return s.bumpFt < 1 && s.steepDeg > 10 && s.steepDeg < 15; })());

console.log(bad ? `\n${bad} failing` : "\nall green");
process.exit(bad ? 1 : 0);
