// BUILT-IN BENCHES AND PLANTER BOXES (2026-11-14; lib/deck/builtins) — the second of the luxury options the owner
// asked for. A bench, a bench with a back or a planter box, built into the deck in its own boards along ONE edge: the
// front (any part of it, a corner cut at an angle too) or an end; inside the railing where there is one; kept on its
// edge; what it runs into said (a stair's top, wide steps, another built-in). A planter's weight full of wet soil is
// worked out, and whether a beam line stands under it. Drawn, counted, priced on lines of their own, in the scope and
// the checks, asked for by voice. A deck without them is exactly as it was.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-builtins.check.ts
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, shapeOutline, shapeWithFront, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { patchDesign } from "../../../src/lib/deck/edit";
import { deckScope, priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { permitPages } from "../../../src/lib/deck/permit";
import { AUTO_FIX } from "../../../src/lib/deck/settle";
import { DECK_RATES } from "../../../src/lib/deck/rates";
import { BENCH_BACK_IN, BENCH_SEAT_IN, BENCH_SUPPORT_MAX_IN, BUILT_IN_INSET_IN, BUILT_IN_LIMITS, KITCHEN_DEPTH_IN, KITCHEN_HEIGHT_IN, PLANTER_DEPTH_IN, SOIL_LB_PER_CUFT, defaultBuiltIn, planGap, type BuiltIn, type BuiltInBuild } from "../../../src/lib/deck/builtins";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (over: Record<string, unknown> = {}, builtIns: unknown = []): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 20, depthFt: 12 }, heightIn: 36, rail: { ...d0.rail, type: "aluminum" }, ...over, extras: { ...d0.extras, builtIns } });
const B = (kind: BuiltIn["kind"], side: BuiltIn["side"], atFt: number, lengthFt: number, id = "b1"): BuiltIn => ({ id, kind, side, atFt, lengthFt });
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
const inRing = (ring: Array<{ x: number; y: number }>, x: number, y: number) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const one = (d: DeckDesign, id = "b1"): BuiltInBuild => buildStructure(d).builtIns.find((b) => b.design.id === id)!;
const roles = (b: BuiltInBuild, role: string) => b.members.filter((m) => m.role === role);
const xs = (b: BuiltInBuild) => b.footprint.map((p) => p.x);
const ys = (b: BuiltInBuild) => b.footprint.map((p) => p.y);

/* ── 1. The design ───────────────────────────────────────────────────── */
check("a new deck has none", d0.extras.builtIns === undefined && buildStructure(mk()).builtIns.length === 0 && mk().extras.builtIns === undefined);
const junk = mk({}, [B("bench", "front", 10, 8), { id: "b1", kind: "bench", side: "left", atFt: 3, lengthFt: 4 }, { kind: "sofa", side: "front" }, null, 7, { kind: "planter", side: "sky", atFt: -5, lengthFt: 99 }, { kind: "bench-back", atFt: 999, lengthFt: 0.5 }]);
const jl = junk.extras.builtIns ?? [];
check("read back: a kind and a side that exist, a name of its own each, a place on the edge, a length inside the limits", jl.length === 4 && new Set(jl.map((b) => b.id)).size === 4 && jl[2].kind === "planter" && jl[2].side === "front" && jl[2].atFt === 0 && jl[2].lengthFt === BUILT_IN_LIMITS.planterFt.max && jl[3].atFt === 20 && jl[3].lengthFt === BUILT_IN_LIMITS.lengthFt.min, JSON.stringify(jl));
check("eight at the most", (mk({}, Array.from({ length: 20 }, (_, i) => B("bench", "front", 10, 4, `x${i}`))).extras.builtIns ?? []).length === BUILT_IN_LIMITS.count);
check("only where there is a deck to stand on", normalizeDeckDesign({ ...mk({}, [B("bench", "front", 10, 8)]), structure: "pergola", floor: "ground" }).extras.builtIns === undefined);
check("the first one offered: a bench in the middle of the front, a planter at a front corner", defaultBuiltIn("a", "bench", 20).atFt === 10 && defaultBuiltIn("a", "bench", 20).lengthFt === 8 && defaultBuiltIn("a", "planter", 20).atFt === 3 && defaultBuiltIn("a", "planter", 20).lengthFt === 4);

/* ── 2. A bench along the front ──────────────────────────────────────── */
const frontD = mk({}, [B("bench", "front", 10, 8)]);
const sF = buildStructure(frontD);
const bench = sF.builtIns[0];
const S = sF.frame!.surfaceIn;
const ring = shapeOutline(frontD.shape);
check("an 8-ft bench in the middle of the front: built, 8 ft long, on the deck", bench.built && bench.lengthIn === 96 && near(Math.min(...xs(bench)), 72) && near(Math.max(...xs(bench)), 168) && bench.footprint.every((p) => inRing(ring, p.x, p.y)));
check("just inside the railing: its back 6 in. in from the edge where the rail's posts stand on the boards", near(Math.max(...ys(bench)), 144 - BUILT_IN_INSET_IN.top));
check("…and at the edge on a deck with no railing", near(Math.max(...ys(one(mk({ heightIn: 14, rail: { ...d0.rail, type: "none" } }, [B("bench", "front", 10, 8)])))), 144 - BUILT_IN_INSET_IN.none));
const seat = roles(bench, "bench seat");
check("the seat: three of the deck's boards, its top 18 in. above the deck", seat.length === 3 && seat.every((m) => near(m.cz + m.sz / 2, S + BENCH_SEAT_IN) && m.sx === 96) && near(bench.depthIn, 3 * sF.surface!.product.widthIn + 2 * sF.surface!.product.gapIn, 0.02) && bench.heightIn === BENCH_SEAT_IN);
const legs = roles(bench, "bench leg");
const cleats = roles(bench, "bench cleat");
const legXs = [...new Set(legs.map((m) => m.cx))].sort((a, b) => a - b);
check("on supports no more than 4 ft apart: two 4x4 legs under a 2x4 cleat each, standing on the boards", bench.supports === 3 && legs.length === 6 && cleats.length === 3 && legXs.every((x, i) => i === 0 || x - legXs[i - 1] <= BENCH_SUPPORT_MAX_IN + 0.01) && legs.every((m) => near(m.cz - m.sz / 2, S)) && cleats.every((m) => near(m.cz - m.sz / 2, legs[0].cz + legs[0].sz / 2)));
check("a fascia apron under the seat's edge all round", roles(bench, "bench apron").length === 4 && roles(bench, "bench apron").every((m) => near(m.cz + m.sz / 2, S + BENCH_SEAT_IN - sF.surface!.product.thickIn)));
check("every part of it over its own footprint", bench.members.every((m) => m.cx >= Math.min(...xs(bench)) - 0.01 && m.cx <= Math.max(...xs(bench)) + 0.01 && m.cy >= Math.min(...ys(bench)) - 1.01 && m.cy <= Math.max(...ys(bench)) + 0.01 && m.cz > S));
check("counted: seat boards, apron, legs, cleats", bench.boardLf === 24 && bench.apronLf > 16 && near(bench.postLf, (6 * (BENCH_SEAT_IN - sF.surface!.product.thickIn - 1.5)) / 12, 0.02) && bench.frameLf > 3);

/* ── 3. With a back; along an end; along a cut corner ────────────────── */
const backB = one(mk({}, [B("bench-back", "left", 6, 10)]));
check("a bench with a back along the left end: runs out from the house, 10 ft, its seat in front of a row of posts", backB.built && backB.lengthIn === 120 && near(Math.min(...xs(backB)), BUILT_IN_INSET_IN.top) && near(Math.max(...ys(backB)) - Math.min(...ys(backB)), 120) && near(backB.depthIn, bench.depthIn + 3.5, 0.02));
const posts = roles(backB, "bench back post");
check("the back: 4x4 posts 36 in. tall behind the seat, two boards across them above it, a cap board on top", posts.length === backB.supports && posts.every((m) => m.sz === BENCH_BACK_IN && near(m.cz - m.sz / 2, S)) && roles(backB, "bench back").length === 2 && roles(backB, "bench back").every((m) => m.cz - m.sz / 2 > S + BENCH_SEAT_IN + 2) && roles(backB, "bench cap").length === 1 && near(roles(backB, "bench cap")[0].cz - roles(backB, "bench cap")[0].sz / 2, S + BENCH_BACK_IN) && backB.heightIn > BENCH_BACK_IN);
check("…the posts toward the edge, the seat toward the deck", posts.every((p) => p.cx < Math.min(...roles(backB, "bench seat").map((m) => m.cx))) && roles(backB, "bench leg").length === backB.supports);
const cutD = patchDesign(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 14 } }), { shape: shapeWithFront(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 14 } }).shape, [{ widthFt: 24, yFt: 14, clipLeftFt: 6, clipRightFt: 6 }]) });
const angled = one(normalizeDeckDesign({ ...cutD, extras: { ...cutD.extras, builtIns: [B("bench", "front", 21, 6)] } }));
check("on a corner cut at an angle the bench runs along the cut", angled.built && near(Math.abs(Math.cos(angled.members[0].yaw)), Math.SQRT1_2, 0.01) && angled.footprint.every((p) => inRing(shapeOutline(cutD.shape), p.x, p.y)), `${angled.why ?? ""} yaw ${angled.members[0]?.yaw}`);

/* ── 4. Kept on its edge; what it runs into ──────────────────────────── */
const long = one(mk({}, [B("bench", "front", 10, 30)]));
check("longer than its edge: as long as the edge allows, clear of the corners' rail posts, and said", long.built && long.flags.shortened && near(long.lengthIn, 240 - 2 * BUILT_IN_INSET_IN.top) && /room for 19 ft/.test(deckChecks(buildStructure(mk({}, [B("bench", "front", 10, 30)]))).find((c) => c.id === "builtin-b1")?.text ?? ""));
check("toward an end: kept on the edge, not past the corner", near(Math.min(...xs(one(mk({}, [B("bench", "front", 0, 8)])))), BUILT_IN_INSET_IN.top));
// (A corner cut 2 ft back leaves an edge 34 in. long: between the rail posts at its two ends there is no room for 2 ft.)
const snipD = patchDesign(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 14 } }), { shape: shapeWithFront(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 14 } }).shape, [{ widthFt: 24, yFt: 14, clipLeftFt: 2 }]) });
const tight = buildStructure(normalizeDeckDesign({ ...snipD, extras: { ...snipD.extras, builtIns: [B("planter", "front", 1, 4), B("bench", "front", 12, 8, "b2")] } }));
const noRoom = tight.builtIns.find((b) => !b.built);
const noRoomCheck = noRoom ? deckChecks(tight).find((c) => c.id === `builtin-${noRoom.design.id}`) : undefined;
check("an edge too short for one: not built, said, not priced, one tap takes it off", !!noRoom && noRoom.design.id === "b1" && !!noRoomCheck && noRoomCheck.level === "warn" && !!noRoomCheck.fix && (applyDeckPatch(tight.design, noRoomCheck.fix.patch).extras.builtIns ?? []).every((b) => b.id !== noRoom.design.id) && !priceDeck(tight.design).lines.some((l) => l.id === "deck-planters"), JSON.stringify(tight.builtIns.map((b) => [b.design.id, b.built, b.why])));
// (Found by the random run.) A thin part with its corner cut away: the cut's edge is long enough, the deck behind it is not deep enough.
const tipBase = mk({ shape: { kind: "rect", widthFt: 12, depthFt: 14 } });
const tipD = patchDesign(tipBase, { shape: shapeWithFront(tipBase.shape, [{ widthFt: 9, yFt: 10 }, { widthFt: 3, yFt: 14, clipRightFt: 3 }]) });
const tip = buildStructure(normalizeDeckDesign({ ...tipD, extras: { ...tipD.extras, builtIns: [B("bench", "front", 10.5, 4)] } })).builtIns[0];
check("where the deck is narrower than the bench is deep: not built, and why", !tip.built && /too narrow/.test(tip.why ?? "") && tip.members.length === 0, `${tip.built} ${tip.why}`);
const onStair = buildStructure(mk({ stairs: [defaultStair("s1", "front", 10)] }, [B("bench", "front", 10, 10)]));
const stairCheck = deckChecks(onStair).find((c) => c.id === "builtin-b1-stair");
check("across the top of a stair: a failing check, with the way out", onStair.builtIns[0].flags.onStair && stairCheck?.level === "fail" && !!stairCheck.fix && !deckChecks(buildStructure(mk({ stairs: [defaultStair("s1", "front", 4)] }, [B("bench", "front", 14, 8)]))).some((c) => c.id === "builtin-b1-stair"));
const onSteps = buildStructure(mk({ heightIn: 21, rail: { ...d0.rail, type: "none" }, stairs: [{ ...defaultStair("s1", "front", 10), wrap: true, wrapSides: 1 }] }, [B("bench", "front", 10, 8)]));
check("along an edge wide steps run on: said", onSteps.builtIns[0].flags.onSteps && deckChecks(onSteps).some((c) => c.id === "builtin-b1-steps" && c.level === "warn"));
const crossing = buildStructure(mk({}, [B("bench", "front", 16, 10), B("bench", "right", 8, 10, "b2")]));
const [cA, cB] = crossing.builtIns;
check("two asked to the same corner: the second stops at the first one's face, and they meet without crossing", cA.built && cB.built && cA.lengthIn === 120 && cB.flags.shortened && cB.flags.beside && cB.lengthIn < 120 && near(Math.max(...ys(cB)), Math.min(...ys(cA)) - 0.25) && crossing.builtIns.every((b) => b.flags.overlaps.length === 0) && !deckChecks(crossing).some((c) => /-overlap$/.test(c.id)) && /beside the other built-in there is room for/.test(deckChecks(crossing).find((c) => c.id === "builtin-b2")?.text ?? ""), `${cB.lengthIn} ${Math.max(...ys(cB))} ${Math.min(...ys(cA))}`);
const packed = buildStructure(mk({}, [B("bench", "front", 10, 30), B("planter", "front", 10, 4, "b2")]));
check("…and where the first one has taken the whole edge the second is not built, and that is said", packed.builtIns[0].built && !packed.builtIns[1].built && /another built-in stands there/.test(deckChecks(packed).find((c) => c.id === "builtin-b2")?.text ?? ""));

/* ── 5. A planter box ────────────────────────────────────────────────── */
const plD = mk({}, [B("planter", "front", 3, 4)]);
const sP = buildStructure(plD);
const pl = sP.builtIns[0];
check("a 4-ft planter at a front corner: 20 in. deep, three boards high with a cap round the rim, soil inside", pl.built && pl.lengthIn === 48 && pl.depthIn === PLANTER_DEPTH_IN && roles(pl, "planter board").length === 12 && roles(pl, "planter cap").length === 4 && roles(pl, "planter soil").length === 1 && pl.heightIn > 17 && pl.heightIn < 21);
check("on feet: clear of the deck's boards", roles(pl, "planter board").every((m) => m.cz - m.sz / 2 >= S + 0.74));
check("its weight full of wet soil is worked out: soil by the cubic foot, well past what the deck is framed for", near(pl.soilCuFt, ((48 - 2 * sP.surface!.product.thickIn) * (20 - 2 * sP.surface!.product.thickIn) * 14) / 1728, 0.02) && pl.weightLb > pl.soilCuFt * SOIL_LB_PER_CUFT && pl.weightLb < pl.soilCuFt * SOIL_LB_PER_CUFT + 200 && pl.psf > 2 * sP.frame!.load);
const plCheck = deckChecks(sP).find((c) => c.id === "builtin-b1");
check("over the front beam's line: passes, the weight said", pl.overBeam && plCheck?.level === "pass" && /weighs about \d+ lb/.test(plCheck.text) && /over a beam line/.test(plCheck.text), plCheck?.text ?? "");
const midP = buildStructure(mk({ shape: { kind: "rect", widthFt: 20, depthFt: 16 } }, [B("planter", "left", 6, 4)]));
const midCheck = deckChecks(midP).find((c) => c.id === "builtin-b1");
check("away from every beam line: a warning, with what to do", !midP.builtIns[0].overBeam && midCheck?.level === "warn" && /double the joists/.test(midCheck.text), `${midP.frame!.beams.map((b) => b.y).join()} ${midCheck?.text ?? ""}`);

/* ── 5b. A privacy screen ────────────────────────────────────────────── */
const scrD = mk({}, [{ id: "s1", kind: "screen", side: "left", atFt: 6, lengthFt: 30, heightFt: 6 }]);
const sS = buildStructure(scrD);
const scr = sS.builtIns[0];
const railNo = buildStructure(mk());
check("a 6-ft screen along the left end: from the house wall to 8 in. short of the front corner (the front rail's corner post stands there)", scr.built && scr.kind === "screen" && near(Math.min(...ys(scr)), 0.5) && near(Math.max(...ys(scr)), 144 - 8) && scr.flags.shortened, `${Math.min(...ys(scr))}..${Math.max(...ys(scr))}`);
check("it stands on the rail's own line: its posts' outer faces 1 in. inside the edge", near(Math.min(...xs(scr)), 1) && roles(scr, "screen post").every((m) => near(m.cx - m.sx / 2, 1, 0.02)));
check("6x6 posts no more than 6 ft apart, one piece from the boards to the cap; the deck's boards across their inner faces; a cap board", scr.postSize === "6x6" && scr.posts === 3 && roles(scr, "screen post").length === 3 && roles(scr, "screen post").every((m) => m.sz === 72 && near(m.cz - m.sz / 2, S)) && roles(scr, "screen board").length >= 10 && roles(scr, "screen board").every((m) => m.cz + m.sz / 2 <= S + 72 && m.cz - m.sz / 2 >= S + 1.99) && roles(scr, "screen cap").length === 1 && near(scr.heightIn, 72 + sS.surface!.product.thickIn));
check("a screen 4 ft high or less stands on 4x4 posts", one(mk({}, [{ id: "s1", kind: "screen", side: "front", atFt: 10, lengthFt: 8, heightFt: 4 }]), "s1").postSize === "4x4");
check("the rail leaves its stretch to it: no rail along the left end, the rest as it was", !sS.rails.segments.some((g) => near(g.x0, 0, 1) && near(g.x1, 0, 1)) && sS.rails.segments.length === railNo.rails.segments.length - 1 && near(sS.rails.lf, railNo.rails.lf - 12, 0.6), `${sS.rails.lf} vs ${railNo.rails.lf}`);
const midScr = buildStructure(mk({}, [{ id: "s1", kind: "screen", side: "front", atFt: 10, lengthFt: 8, heightFt: 6 }]));
const frontRuns = midScr.rails.segments.filter((g) => near(g.y0, 144, 1) && near(g.y1, 144, 1));
check("in the middle of an edge the rail stops a hand short of each of its ends", frontRuns.length === 2 && frontRuns.every((g) => Math.max(g.x0, g.x1) <= 72 - 4.9 || Math.min(g.x0, g.x1) >= 168 + 4.9), JSON.stringify(frontRuns.map((g) => [g.x0, g.x1])));
check("the wind on it is worked out: 20 psf on each post's share, and the turning it makes at the deck", near(scr.windLb, Math.round((((scr.lengthIn - 5.5) / 2) * 72 * 20) / 144), 1) && near(scr.windFtLb, Math.round(scr.windLb * 3), 6) && scr.sqFt === Math.round(((scr.lengthIn * 72) / 144) * 100) / 100);
const scrCheck = deckChecks(sS).find((c) => c.id === "builtin-s1");
check("the check says how it stands, that it is the guard there, and what the wind asks of its posts", scrCheck?.level === "pass" && /in the railing's place and is the guard/.test(scrCheck.text) && /each post takes about \d+ lb/.test(scrCheck.text) && /through-bolted twice/.test(scrCheck.text), scrCheck?.text ?? "");
const tallCheck = deckChecks(buildStructure(mk({}, [{ id: "s1", kind: "screen", side: "left", atFt: 6, lengthFt: 10, heightFt: 8 }]))).find((c) => c.id === "builtin-s1");
check("over 6 ft: a warning — an engineer, and the building office", tallCheck?.level === "warn" && /engineer/.test(tallCheck.text));
const withBench = buildStructure(mk({}, [{ id: "s1", kind: "screen", side: "right", atFt: 6, lengthFt: 10, heightFt: 6 }, B("bench", "right", 6, 8)]));
const [scrR, benchR] = [withBench.builtIns.find((b) => b.kind === "screen")!, withBench.builtIns.find((b) => b.kind === "bench")!];
check("a bench in front of a screen: set inside it as inside a rail, the two not touching", scrR.built && benchR.built && Math.max(...xs(benchR)) <= Math.min(...xs(scrR)) + 0.01 && benchR.flags.overlaps.length === 0 && withBench.builtIns[0].kind === "screen", `${Math.max(...xs(benchR))} vs ${Math.min(...xs(scrR))}`);
const lowScr = deckChecks(buildStructure(mk({ heightIn: 14, rail: { ...d0.rail, type: "none" } }, [{ id: "s1", kind: "screen", side: "left", atFt: 6, lengthFt: 10 }]))).find((c) => c.id === "builtin-s1");
check("on a low deck with no railing it stands at the deck's edge, and nothing is said of a guard", /stands at the deck's edge\./.test(lowScr?.text ?? "") && !/guard/.test(lowScr?.text ?? ""), lowScr?.text ?? "");
const pS = priceDeck(scrD);
const scrLine = pS.lines.find((l) => l.id === "deck-screens");
check("priced by the square foot on a line of its own; the rail's line is shorter by what it replaced", !!scrLine && scrLine.quantity === Math.round(scr.sqFt) && scrLine.unit === "sqft" && scrLine.materialCost > 0 && scrLine.laborCost > 0 && (pS.lines.find((l) => l.id === "deck-rail")?.quantity ?? 0) < (priceDeck(mk()).lines.find((l) => l.id === "deck-rail")?.quantity ?? 0));
const scrBom = pS.takeoff.lines.filter((l) => l.step === "builtins");
check("the list: the deck's boards, 6x6 posts in one piece, two through-bolts a post, blocking behind them", scrBom.some((l) => l.id === "screen-boards") && scrBom.some((l) => /screen-posts/.test(l.id) && l.rateKey === "lf.6x6" && l.qty === 3) && scrBom.some((l) => l.id === "screen-post-bolts" && l.qty === 6) && scrBom.some((l) => /screen-blocking/.test(l.id)) && scrBom.every((l) => DECK_RATES.some((r) => r.key === l.rateKey)) && DECK_RATES.some((r) => r.key === "labor.screen"), scrBom.map((l) => `${l.id} ${l.qty}`).join());
check("the scope names it", deckScope(pS).some((t) => /privacy screen 6 ft high along the left end/.test(t)));

/* ── 5c. An outdoor kitchen island ───────────────────────────────────── */
const big = (over: Record<string, unknown> = {}, builtIns: unknown = []) => mk({ shape: { kind: "rect", widthFt: 24, depthFt: 16 }, ...over }, builtIns);
const kitD = big({}, [{ id: "k1", kind: "kitchen", side: "front", atFt: 19, lengthFt: 8 }]);
const sK = buildStructure(kitD);
const kit = sK.builtIns[0];
const SK = sK.frame!.surfaceIn;
check("an 8-ft outdoor kitchen along the front: an island 30 in. deep and 36 in. high, just inside the railing", kit.built && kit.kind === "kitchen" && kit.lengthIn === 96 && kit.depthIn === KITCHEN_DEPTH_IN && kit.heightIn === KITCHEN_HEIGHT_IN && near(Math.max(...ys(kit)), 192 - BUILT_IN_INSET_IN.top));
check("clad in the deck's boards on all four sides, a top for stone, a grill built in at its middle", roles(kit, "kitchen board").length >= 20 && roles(kit, "kitchen top").length === 1 && near(roles(kit, "kitchen top")[0].cz + roles(kit, "kitchen top")[0].sz / 2, SK + KITCHEN_HEIGHT_IN) && roles(kit, "kitchen grill").length === 1 && near(roles(kit, "kitchen grill")[0].cx, (Math.min(...xs(kit)) + Math.max(...xs(kit))) / 2) && roles(kit, "kitchen grill")[0].cz > SK + KITCHEN_HEIGHT_IN);
check("its weight with a stone top and a grill is worked out", near(kit.weightLb, Math.round((20 * 96 * 30) / 144 + (20 * 96) / 12 + 250), 1) && kit.psf === Math.round(kit.weightLb / 20));
const under = sK.frame!.joists.filter((j) => !j.sister && j.x >= Math.min(...xs(kit)) - 2 && j.x <= Math.max(...xs(kit)) + 2).length;
check("the joists under it are doubled their whole length", kit.sisters === under && kit.sisters >= 5 && near(kit.sisterLf, kit.sisters * 16, 0.5), `${kit.sisters} of ${under}, ${kit.sisterLf} ft`);
check("the part that burns is the grill, not the island", kit.hot.length === 4 && Math.max(...kit.hot.map((q) => q.x)) - Math.min(...kit.hot.map((q) => q.x)) === 30);
const kitCheck = deckChecks(sK).find((c) => c.id === "builtin-k1");
check("the check: what it is, what it weighs, the joists doubled, the grill's jacket and clearances, the trades", kitCheck?.level === "pass" && /weighs about \d+ lb/.test(kitCheck.text) && /joists under it are doubled/.test(kitCheck.text) && /insulated jacket/.test(kitCheck.text) && /licensed trades/.test(kitCheck.text), kitCheck?.text ?? "");
const kitWall = buildStructure(big({ rail: { ...d0.rail, type: "cedar" } }, [{ id: "k1", kind: "kitchen", side: "left", atFt: 2, lengthFt: 6 }]));
const wallCheck = deckChecks(kitWall).find((c) => c.id === "builtin-k1");
check("at the house wall: a warning — how near the grill stands to the siding, and what to do", wallCheck?.level === "warn" && /The grill stands \d+ in\. from the house wall/.test(wallCheck.text) && /3 ft away/.test(wallCheck.text));
check("…and a railing that burns behind the grill is named", /The cedar railing is \d+ in\. behind the grill/.test(wallCheck?.text ?? "") && !/railing is/.test(kitCheck?.text ?? ""));
const pK = priceDeck(kitD);
const kLine = pK.lines.find((l) => l.id === "deck-kitchen");
const kBom = pK.takeoff.lines.filter((l) => /kitchen/.test(l.id));
check("priced by the foot on a line of its own: the boards, the frame, the doubled joists and the labour", !!kLine && kLine.quantity === 8 && kLine.unit === "ln ft" && kLine.materialCost > 0 && kLine.laborCost > 0 && kBom.some((l) => l.id === "kitchen-boards") && kBom.some((l) => /kitchen-frame/.test(l.id)) && kBom.some((l) => /kitchen-sisters/.test(l.id) && new RegExp(sK.frame!.joistSize).test(l.label)) && kBom.every((l) => DECK_RATES.some((r) => r.key === l.rateKey)) && DECK_RATES.some((r) => r.key === "labor.kitchen"), kBom.map((l) => `${l.id} ${l.qty}`).join());
check("the scope says what is not included", deckScope(pK).some((t) => /outdoor kitchen island along the front/.test(t) && /The top, the grill, gas and power are not included/.test(t)));

/* ── 5d. A gas fire table ────────────────────────────────────────────── */
const fireD = big({}, [{ id: "f1", kind: "fire", side: "front", atFt: 8, lengthFt: 4, inFt: 6 }]);
const sFi = buildStructure(fireD);
const fi = sFi.builtIns[0];
check("a 4-ft fire table 6 ft in from the front: out on the deck, its middle 6 ft from the edge", fi.built && fi.kind === "fire" && fi.lengthIn === 48 && fi.depthIn === 24 && near((Math.min(...ys(fi)) + Math.max(...ys(fi))) / 2, 192 - 72) && near((Math.min(...xs(fi)) + Math.max(...xs(fi))) / 2, 96));
check("square up to 3½ ft, 2 ft deep when longer", one(big({}, [{ id: "f1", kind: "fire", side: "front", atFt: 8, lengthFt: 3, inFt: 6 }]), "f1").depthIn === 36 && fi.depthIn === 24);
check("drawn — a base, a top, the burner — and all of it is the part that burns", roles(fi, "fire base").length === 1 && roles(fi, "fire top").length === 1 && roles(fi, "fire burner").length === 1 && fi.hot.length === 4 && fi.heightIn === 24);
const pF = priceDeck(fireD);
check("nothing is built or priced for it: the table is by others — the price is the deck's", near(pF.subtotal, priceDeck(big()).subtotal, 0.001) && !pF.takeoff.lines.some((l) => /fire/.test(l.id)) && deckScope(pF).some((t) => /place for a 4-ft gas fire table/.test(t) && /not included/.test(t)));
const fiCheck = deckChecks(sFi).find((c) => c.id === "builtin-f1");
check("the check: by others, a heat shield under it, 36 in. clear, gas only", fiCheck?.level === "pass" && /by others/.test(fiCheck.text) && /heat shield/.test(fiCheck.text) && /nothing stands nearer here\./.test(fiCheck.text) && /Gas only/.test(fiCheck.text) && !/\.\./.test(fiCheck.text), fiCheck?.text ?? "");
const crowded = buildStructure(big({}, [{ id: "s1", kind: "screen", side: "left", atFt: 8, lengthFt: 30, heightFt: 6 }, B("bench", "front", 6, 8), { id: "f1", kind: "fire", side: "front", atFt: 4, lengthFt: 3, inFt: 3.5 }]));
const crowdCheck = deckChecks(crowded).find((c) => c.id === "builtin-f1");
check("what stands nearer than 36 in. is measured and named: a warning", crowdCheck?.level === "warn" && /nearer than that here: a privacy screen \d+ in\., a bench \d+ in\./.test(crowdCheck.text) && !/in\.\./.test(crowdCheck.text), crowdCheck?.text ?? "");
const roofedD = big({ structure: "covered-deck" }, [{ id: "k1", kind: "kitchen", side: "front", atFt: 19, lengthFt: 8 }, { id: "f1", kind: "fire", side: "front", atFt: 8, lengthFt: 5, inFt: 7 }]);
const roofedChecks = deckChecks(buildStructure(roofedD));
check("under a roof: both are warnings — a hood over the grill, a unit listed for a cover and the room above the flame", roofedChecks.find((c) => c.id === "builtin-k1")?.level === "warn" && /vent hood/.test(roofedChecks.find((c) => c.id === "builtin-k1")?.text ?? "") && roofedChecks.find((c) => c.id === "builtin-f1")?.level === "warn" && /listed for use under a cover/.test(roofedChecks.find((c) => c.id === "builtin-f1")?.text ?? "") && /less than the 8 ft most ask/.test(roofedChecks.find((c) => c.id === "builtin-f1")?.text ?? ""));
check("a fire table asked for farther in than the deck is deep: not built, and that is said", !one(big({}, [{ id: "f1", kind: "fire", side: "front", atFt: 8, lengthFt: 4, inFt: 30 }]), "f1").built);

/* ── 6. The price, the list, the words ───────────────────────────────── */
const allD = mk({}, [B("bench", "front", 10, 8), B("bench-back", "left", 6, 6, "b2"), B("planter", "front", 18, 4, "b3")]);
const p0 = priceDeck(mk());
const pA = priceDeck(allD);
const benchLine = pA.lines.find((l) => l.id === "deck-benches");
const planterLine = pA.lines.find((l) => l.id === "deck-planters");
const others = (p: typeof p0) => p.lines.filter((l) => l.id !== "deck-benches" && l.id !== "deck-planters").map((l) => `${l.id}:${l.quantity}:${l.unitPrice}`).join("|");
check("a line for the benches and a line for the planters, by the foot", !!benchLine && benchLine.quantity === 14 && benchLine.unit === "ln ft" && /2 built-in benches, 1 with a back/.test(benchLine.name) && !!planterLine && planterLine.quantity === 4 && planterLine.materialCost > 0 && planterLine.laborCost > 0, `${benchLine?.name} / ${planterLine?.name}`);
check("every other line is what it was", others(pA) === others(p0));
check("the total is the deck's plus those two lines", near(pA.subtotal - p0.subtotal, benchLine!.quantity * benchLine!.unitPrice + planterLine!.quantity * planterLine!.unitPrice, 1.5), `${(pA.subtotal - p0.subtotal).toFixed(2)}`);
const bom = pA.takeoff.lines.filter((l) => l.step === "builtins");
check("the list: the deck's boards, fascia for the aprons, 4x4 legs and posts, 2x4 cleats and frames, blocking under the benches", ["bench-boards", "bench-apron", "planter-boards"].every((id) => bom.some((l) => l.id === id)) && bom.some((l) => /bench-posts/.test(l.id) && l.rateKey === "lf.4x4") && bom.some((l) => /bench-cleats/.test(l.id)) && bom.some((l) => /bench-blocking/.test(l.id)) && bom.some((l) => /planter-frame/.test(l.id)) && bom.every((l) => DECK_RATES.some((r) => r.key === l.rateKey)), bom.map((l) => l.id).join());
check("the labour is in the price book", ["labor.bench", "labor.benchBack", "labor.planter"].every((k) => DECK_RATES.some((r) => r.key === k)));
const scope = deckScope(pA);
check("the scope the client signs names each one", scope.filter((t) => /bench/.test(t)).length === 2 && scope.some((t) => /bench with a back along the left end/.test(t) && /capped back/.test(t)) && scope.some((t) => /planter box along the front/.test(t) && /Soil and plants are not included/.test(t)) && !deckScope(p0).some((t) => /bench|planter/i.test(t)));
const guardText = deckChecks(buildStructure(allD)).find((c) => c.id === "builtin-b1")?.text ?? "";
const lowText = deckChecks(buildStructure(mk({ heightIn: 14, rail: { ...d0.rail, type: "none" } }, [B("bench", "front", 10, 8)]))).find((c) => c.id === "builtin-b1")?.text ?? "";
check("where a guard is required the check speaks of the seat beside it; on a low deck it does not", /step up for a child/.test(guardText) && /until 2012/.test(guardText) && !/guard/.test(lowText) && /3 supports/.test(lowText));
check("a bench's back is not called a guard", /Its back is not a guard/.test(deckChecks(buildStructure(allD)).find((c) => c.id === "builtin-b2")?.text ?? ""));
check("their checks are the builder's own (clear of the auto-fix)", !AUTO_FIX.test("builtin-b1") && !AUTO_FIX.test("builtin-b1-stair"));
check("the same checks otherwise", deckChecks(buildStructure(allD)).filter((c) => !c.id.startsWith("builtin-")).map((c) => `${c.id}:${c.level}`).join() === deckChecks(buildStructure(mk())).map((c) => `${c.id}:${c.level}`).join());

/* ── 7. The 3D ───────────────────────────────────────────────────────── */
const sc = deckScene(buildStructure(allD));
const sc0 = deckScene(buildStructure(mk()));
const members = buildStructure(allD).builtIns.reduce((a, b) => a + b.members.length, 0);
const tagged = sc.boxes.filter((_, i) => /^(bench|planter)/.test(sc.legend[sc.tags[i]]?.role ?? ""));
check("the 3D draws every stick and board of them", tagged.length === members && sc.boxes.length === sc0.boxes.length + members, `${tagged.length} of ${members}`);
check("…all of it above the deck's boards", tagged.every((b) => b[3] - b[6] / 2 >= S / 12 - 0.001));
let pages = 0;
let threw = "";
try {
  pages = permitPages(pA, { address: "1 Test St", contractor: "QA" } as never).length;
} catch (e) {
  threw = String(e);
}
check("the permit set draws", pages > 4 && !threw, threw);

/* ── 8. By voice ─────────────────────────────────────────────────────── */
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
const plain = mk();
const v1 = say(plain, "add a bench");
check("\"add a bench\": a bench along the front, said as built", v1.design.extras.builtIns?.length === 1 && v1.design.extras.builtIns[0].kind === "bench" && v1.design.extras.builtIns[0].side === "front" && /8-ft bench along the front/.test(v1.said) && v1.design.extras.items.length === 0, v1.said);
const v2 = say(plain, "add a 10 foot bench with a back on the left side");
check("\"a 10 foot bench with a back on the left side\"", v2.design.extras.builtIns?.[0]?.kind === "bench-back" && v2.design.extras.builtIns[0].side === "left" && v2.design.extras.builtIns[0].lengthFt === 10 && /capped back/.test(v2.said), `${JSON.stringify(v2.design.extras.builtIns)} ${v2.said}`);
const v3 = say(plain, "put planters at the front corners");
const v3b = buildStructure(v3.design).builtIns;
check("\"planters at the front corners\": two planter boxes, one at each end of the front", v3b.length === 2 && v3b.every((b) => b.kind === "planter" && b.built) && Math.min(...xs(v3b[0])) < 12 && Math.max(...xs(v3b[1])) > 228, JSON.stringify(v3.design.extras.builtIns));
const v4 = say(plain, "add a corner bench");
const v4b = buildStructure(v4.design).builtIns;
check("\"a corner bench\": two benches that meet at the front corner without crossing", v4b.length === 2 && v4b.every((b) => b.built && b.flags.overlaps.length === 0) && new Set(v4b.map((b) => b.design.side)).size === 2, JSON.stringify(v4b.map((b) => [b.design.side, b.design.atFt, b.design.lengthFt, b.flags.overlaps])));
const v5 = say(v1.design, "take the bench off");
check("\"take the bench off\"", v5.design.extras.builtIns === undefined && /Took the bench off/.test(v5.said), v5.said);
check("…and there is none to take off a deck without one", say(plain, "remove the planters").refused);
const v6 = say(plain, "add a bench for $400");
check("with a price said it stays the contractor's own item", v6.design.extras.builtIns === undefined && v6.design.extras.items.length === 1 && v6.design.extras.items[0].price === 400, JSON.stringify(v6.design.extras));
const v8 = say(plain, "add a privacy screen on the right side");
check("\"add a privacy screen on the right side\": 6 ft high, the whole right end, said with its wind", v8.design.extras.builtIns?.[0]?.kind === "screen" && v8.design.extras.builtIns[0].side === "right" && v8.design.extras.builtIns[0].heightFt === 6 && /privacy screen 6 ft high along the right end/.test(v8.said) && /lb on each post/.test(v8.said), `${JSON.stringify(v8.design.extras.builtIns)} ${v8.said}`);
const v9 = say(plain, "an 8 ft long privacy screen 5 ft high on the left");
check("\"an 8 ft long privacy screen 5 ft high on the left\"", v9.design.extras.builtIns?.[0]?.lengthFt === 8 && v9.design.extras.builtIns[0].heightFt === 5 && v9.design.extras.builtIns[0].side === "left", JSON.stringify(v9.design.extras.builtIns));
check("\"take the privacy screen off\"", say(v8.design, "take the privacy screen off").design.extras.builtIns === undefined);
const roofed = normalizeDeckDesign({ ...plain, structure: "covered-deck" });
check("under a roof, privacy screens stay the roof's walls", (say(roofed, "add privacy screens").design.extras.builtIns ?? []).length === 0);
const v10 = say(big(), "add an outdoor kitchen");
check("\"add an outdoor kitchen\": an island toward the right of the front, said with its weight", v10.design.extras.builtIns?.[0]?.kind === "kitchen" && v10.design.extras.builtIns[0].side === "front" && /outdoor kitchen island along the front/.test(v10.said) && /joists under it are doubled/.test(v10.said) && /by others/.test(v10.said), v10.said);
const v11 = say(big(), "add a fire pit");
check("\"add a fire pit\": a gas fire table's place — and gas only", v11.design.extras.builtIns?.[0]?.kind === "fire" && /place for a 4-ft gas fire table/.test(v11.said) && /Gas only/.test(v11.said) && v11.design.extras.items.length === 0, v11.said);
check("\"a 5 ft fire table 8 ft in\"", (() => { const b = say(big(), "add a 5 ft long fire table 8 ft in").design.extras.builtIns?.[0]; return b?.kind === "fire" && b.lengthFt === 5 && b.inFt === 8; })(), JSON.stringify(say(big(), "add a 5 ft long fire table 8 ft in").design.extras.builtIns));
check("\"take the fire table off\", \"remove the outdoor kitchen\"", say(v11.design, "take the fire table off").design.extras.builtIns === undefined && say(v10.design, "remove the outdoor kitchen").design.extras.builtIns === undefined);
check("the gap between two shapes in plan is measured edge to edge", near(planGap([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [{ x: 13, y: 14 }, { x: 20, y: 14 }, { x: 20, y: 20 }, { x: 13, y: 20 }]), 5) && planGap([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [{ x: 5, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 20 }, { x: 5, y: 20 }]) === 0);
const v7 = say(normalizeDeckDesign({ ...plain, structure: "pergola", floor: "ground" }), "add a bench");
check("on a pergola standing on the ground: not built, and why", v7.refused && /no deck/.test(v7.said), v7.said);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
