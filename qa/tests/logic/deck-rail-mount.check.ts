// HOW A RAIL'S POSTS MEET THE DECK (2026-11-13, lib/deck/rails + design.ts RailMount) — a deck builder: "some sections
// show side-mounted, others top-mounted, though the job is top-mounted; aluminum; it matters at the permit desk."
// The mount is the builder's, for the deck and for any one side of it, and the 3D, the material list, the checks and the
// permit set's guard detail all follow it. Worked by hand: a 16 x 12 ft deck, 48 in. up, three open sides.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-rail-mount.check.ts
import { defaultDeckDesign, normalizeDeckDesign, railMountFor, shapeOutline, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene } from "../../../src/lib/deck/scene";
import { detailDrawings, permitNotes, sectionDrawing } from "../../../src/lib/deck/permit";
import { floorDetails } from "../../../src/lib/deck/plans/details";
import { planModel } from "../../../src/lib/deck/plans/model";
import { DECK_RATES } from "../../../src/lib/deck/rates";
import { BASE_PLATE_THICK_IN, POST_EMBED_IN, SIDE_MOUNT_IN, TOP_MOUNT_IN, railHeldWords, railMountLine } from "../../../src/lib/deck/rails";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const base = (over: Record<string, unknown>): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "TX", frostIn: 12 }), heightIn: 48, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, ...over });
const W = 192;
const D = 144;
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const posts = (d: DeckDesign) => buildStructure(d).rails.members.filter((m) => m.role === "rail-post");
/** Inside a ring (inches), `by` in from every edge at least. */
const insideBy = (ring: Array<{ x: number; y: number }>, x: number, y: number): number => {
  let inside = false;
  let dist = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / L2)) : 0;
    dist = Math.min(dist, Math.hypot(x - (a.x + (b.x - a.x) * t), y - (a.y + (b.y - a.y) * t)));
  }
  return inside ? dist : -dist;
};

console.log("── what each system is sold for");
check("auto: a metal post on its base plate, a wood post — bare or sleeved — on the rim", railMountFor("aluminum", "auto") === "top" && railMountFor("cable", "auto") === "top" && railMountFor("glass", "auto") === "top" && railMountFor("treated", "auto") === "side" && railMountFor("cedar", "auto") === "side" && railMountFor("composite", "auto") === "side" && railMountFor("vinyl", "auto") === "side");
check("…and the builder's word wins either way", railMountFor("aluminum", "side") === "side" && railMountFor("cedar", "top") === "top");

console.log("── aluminum, top-mounted: every post on the boards, inside the edge");
const alu = base({ rail: { type: "aluminum" } });
const aluS = buildStructure(alu);
const aluPosts = posts(alu);
const surface = aluS.frame!.surfaceIn;
check("every post is top-mounted — none hung on the rim", aluPosts.length > 0 && aluPosts.every((m) => m.mount === "top") && aluS.rails.topPosts === aluS.rails.posts && aluS.rails.sidePosts === 0, `${aluS.rails.topPosts}/${aluS.rails.posts}`);
check("each stands ON the boards — drawn on its base plate, its top 36 in. above the surface, a 36-in. post bought", aluPosts.every((m) => near(m.cz - m.sz / 2, surface + BASE_PLATE_THICK_IN) && near(m.cz + m.sz / 2, surface + 36.25) && near(m.lengthIn, 36)), JSON.stringify(aluPosts.map((m) => [m.cz - m.sz / 2, m.lengthIn]).slice(0, 2)));
check(`each stands ${TOP_MOUNT_IN} in. inside the deck's open edges (the two by the house wall half a post off it) — no post outside the outline`, aluPosts.every((m) => m.cx > TOP_MOUNT_IN - 0.02 && m.cx < W - TOP_MOUNT_IN + 0.02 && m.cy < D - TOP_MOUNT_IN + 0.02 && insideBy(shapeOutline(alu.shape), m.cx, m.cy) >= 2.2) && aluPosts.filter((m) => near(insideBy(shapeOutline(alu.shape), m.cx, m.cy), TOP_MOUNT_IN, 0.02)).length === 6, JSON.stringify(aluPosts.map((m) => insideBy(shapeOutline(alu.shape), m.cx, m.cy).toFixed(2))));
const corner = (x: number, y: number) => aluPosts.filter((m) => near(m.cx, x, 0.05) && near(m.cy, y, 0.05)).length;
check("the two front corners carry ONE post each, where the two runs' lines cross", corner(TOP_MOUNT_IN, D - TOP_MOUNT_IN) === 1 && corner(W - TOP_MOUNT_IN, D - TOP_MOUNT_IN) === 1);
check("…so the post count is the one a builder counts: 3 + 4 + 3 less the 2 shared corners = 8", aluS.rails.posts === 8, String(aluS.rails.posts));
const frontRail = aluS.rails.members.find((m) => m.role === "rail-top" && Math.abs(Math.sin(m.yaw)) < 0.01 && near(m.cy, D - TOP_MOUNT_IN, 0.05));
check("the front's top rail runs from corner post to corner post — to each one's face, not through it", !!frontRail && near(frontRail.cx - frontRail.sx / 2, TOP_MOUNT_IN + 1.75, 0.05) && near(frontRail.cx + frontRail.sx / 2, W - TOP_MOUNT_IN - 1.75, 0.05), JSON.stringify(frontRail));
check("the hardware is a top mount's: two pieces of blocking a post, no tension ties, no fascia brackets", aluS.rails.hardware.blocks === 16 && aluS.rails.hardware.postTies === 0 && aluS.rails.hardware.fasciaBrackets === 0 && aluS.rails.hardware.postBases === 0, JSON.stringify(aluS.rails.hardware));
const aluBom = priceDeck(alu).bom;
check("the material list: blocking under the posts in the joists' stock, and no tension ties", aluBom.some((l) => /^lumber-rail-blocking/.test(l.id) && /two under each of 8 top-mounted posts/.test(l.note ?? "")) && !aluBom.some((l) => l.id === "rail-post-ties"), aluBom.filter((l) => l.step === "rails").map((l) => l.id).join(" "));
const aluScene = deckScene(aluS);
const roleOf = (i: number) => aluScene.legend[aluScene.tags[i]]?.role ?? "";
check("the 3D draws a base plate under every post, on the boards", aluScene.boxes.filter((_, i) => roleOf(i) === "rail post base").length === 8 && !aluScene.boxes.some((_, i) => roleOf(i) === "rail post tie"), `${aluScene.boxes.filter((_, i) => roleOf(i) === "rail post base").length}`);
check("…and its note says top-mounted, base plate, blocking", aluScene.legend.some((l) => l.role === "rail post" && /top-mounted/.test(l.note) && /base plate/.test(l.note) && /blocking/.test(l.note)));

console.log("── the same railing, side-mounted");
const aluSide = base({ rail: { type: "aluminum", mount: "side" } });
const aluSideS = buildStructure(aluSide);
const sidePosts = posts(aluSide);
check("every post hangs on the rim: outside the edge, from just above the joists' underside", sidePosts.every((m) => m.mount === "side" && near(insideBy(shapeOutline(aluSide.shape), m.cx, m.cy), -SIDE_MOUNT_IN, 0.02) && near(m.cz - m.sz / 2, aluSideS.frame!.joistBottomIn + POST_EMBED_IN)), JSON.stringify(sidePosts.map((m) => insideBy(shapeOutline(aluSide.shape), m.cx, m.cy).toFixed(2)).slice(0, 3)));
check("a metal post's fascia bracket each, no blocking under posts, no wood-post ties", aluSideS.rails.hardware.fasciaBrackets === aluSideS.rails.posts && aluSideS.rails.hardware.blocks === 0 && aluSideS.rails.hardware.postTies === 0, JSON.stringify(aluSideS.rails.hardware));
check("the material list buys the brackets", priceDeck(aluSide).bom.some((l) => l.id === "rail-fascia-brackets" && l.qty === aluSideS.rails.posts));
const sideScene = deckScene(aluSideS);
check("the 3D draws a bracket on each, and says side-mounted", sideScene.boxes.filter((_, i) => sideScene.legend[sideScene.tags[i]]?.role === "rail post bracket").length === aluSideS.rails.posts && sideScene.legend.some((l) => l.role === "rail post" && /side-mounted/.test(l.note) && /fascia bracket/.test(l.note)));

console.log("── wood: on the rim as before, on the boards by choice");
const cedar = base({ rail: { type: "cedar" } });
const cedarS = buildStructure(cedar);
check("a cedar rail is side-mounted unless told otherwise: bolted through the rim, a pair of tension ties a post — as it always was", posts(cedar).every((m) => m.mount === "side") && cedarS.rails.hardware.postTies === 8 && cedarS.rails.posts === 8 && railHeldWords(cedarS.rails) === "bolted through the rim with tension ties");
check("…and an old design, saved before there was a mount, reads the same", JSON.stringify(buildStructure(normalizeDeckDesign({ ...cedar, rail: { type: "cedar", heightIn: 36, postSpacingFt: 6, cap: true } })).rails.members) === JSON.stringify(cedarS.rails.members));
const cedarTop = base({ rail: { type: "cedar", mount: "top" } });
const cedarTopS = buildStructure(cedarTop);
const woodNote = deckChecks(cedarTopS).find((c) => c.id === "guard-mount-wood");
check("top-mounted wood posts: a rated base and blocking under each, shorter posts — and a note for the permit desk with the way back", cedarTopS.rails.hardware.postBases === 8 && cedarTopS.rails.hardware.blocks === 16 && cedarTopS.rails.hardware.postTies === 0 && posts(cedarTop).every((m) => near(m.lengthIn, 36)) && woodNote?.level === "info" && woodNote.fix?.patch.rail?.mount === "side", JSON.stringify(woodNote));
check("…the material list buys the bases", priceDeck(cedarTop).bom.some((l) => l.id === "rail-post-bases" && l.qty === 8));
check("…and the fix takes it back to the rim", posts(applyDeckPatch(cedarTop, woodNote!.fix!.patch)).every((m) => m.mount === "side"));
check("every piece of hardware the mount counts has a price", ["hw.railPostBase", "hw.railFasciaBracket", "hw.railPostTie"].every((k) => DECK_RATES.some((r) => r.key === k)));

console.log("── one side mounted another way");
const mixed = base({ rail: { type: "aluminum", mount: "top", mountBy: { "upper-left": "side" } } });
const mixedS = buildStructure(mixed);
const mPosts = posts(mixed);
check("the left side hangs on the rim; the front and the right stand on the boards", mPosts.filter((m) => m.of === "upper-left").every((m) => m.mount === "side" && near(m.cx, -SIDE_MOUNT_IN, 0.05)) && mPosts.filter((m) => m.of !== "upper-left").every((m) => m.mount === "top" && m.cx > 0 && m.cy < D), JSON.stringify(mPosts.map((m) => [m.of, m.mount, Math.round(m.cx)])));
check("where the two meet each run keeps its own end post (one on the rim, one on the boards)", mixedS.rails.posts === 9 && mixedS.rails.sidePosts === 3 && mixedS.rails.topPosts === 6, `${mixedS.rails.posts} ${mixedS.rails.sidePosts} ${mixedS.rails.topPosts}`);
check("each run says how it is mounted", mixedS.rails.segments.every((sg) => sg.mount === (sg.key === "upper-left" ? "side" : "top")) && railMountLine(mixedS.rails) === "top-mounted on the front and right side, side-mounted on the left side", railMountLine(mixedS.rails));
const mixedCheck = deckChecks(mixedS).find((c) => c.id === "guard-mount");
check("the checks name both, with what each needs", mixedCheck?.level === "pass" && /top-mounted on the front and right side, side-mounted on the left side/.test(mixedCheck.text) && /base plate/.test(mixedCheck.text) && /fascia bracket/.test(mixedCheck.text), JSON.stringify(mixedCheck));
check("the hardware is each side's own", mixedS.rails.hardware.blocks === 12 && mixedS.rails.hardware.fasciaBrackets === 3, JSON.stringify(mixedS.rails.hardware));

console.log("── the permit set draws it as it is mounted");
const titles = (d: DeckDesign) => detailDrawings(buildStructure(d), "floor").filter((x) => x.title.startsWith("Guard post"));
const topDetail = titles(alu);
check("top-mounted: one guard detail — the post on a base plate over blocking, the note says TOP MOUNT", topDetail.length === 1 && /TOP MOUNT/.test(topDetail[0].notes[0]) && topDetail[0].drawing.items.some((it) => it.t === "text" && /base plate/.test(it.s)) && topDetail[0].drawing.items.some((it) => it.t === "text" && /solid blocking/.test(it.s)), JSON.stringify(topDetail.map((x) => x.notes[0])));
const sideDetail = titles(aluSide);
check("side-mounted metal: the bracket on the rim, the note says SIDE MOUNT", sideDetail.length === 1 && /SIDE MOUNT/.test(sideDetail[0].notes[0]) && sideDetail[0].drawing.items.some((it) => it.t === "text" && /fascia bracket/.test(it.s)));
const woodDetail = titles(cedar);
check("side-mounted wood: the bolted detail and its note, word for word as before", woodDetail.length === 1 && /^Guard 36 in\. high, posts through-bolted to the rim with two ½-in\. bolts and blocked, pickets with no 4-in\. opening\./.test(woodDetail[0].notes[0]) && woodDetail[0].drawing.items.filter((it) => it.t === "circle").length === 2);
const mixedDetail = titles(mixed);
check("two mounts on one deck: two details, each naming its sides", mixedDetail.length === 2 && mixedDetail[0].title === "Guard post" && /TOP MOUNT \(front, right side\)/.test(mixedDetail[0].notes[0]) && mixedDetail[1].title === "Guard post, side-mounted" && /SIDE MOUNT \(left side\)/.test(mixedDetail[1].notes[0]), JSON.stringify(mixedDetail.map((x) => [x.title, x.notes[0].slice(0, 70)])));
const planKeys = (d: DeckDesign) => floorDetails(planModel(buildStructure(d), priceDeck(d))).map((x) => x.key);
check("…on the details sheet the second one comes last, so the others keep their numbers", planKeys(mixed).includes("guard2") && planKeys(mixed)[planKeys(mixed).length - 1] === "guard2" && planKeys(mixed).filter((k) => k !== "guard2").join() === planKeys(alu).join(), `${planKeys(mixed).join()} vs ${planKeys(alu).join()}`);
const secPost = (d: DeckDesign) => (sectionDrawing(buildStructure(d))?.items ?? []).find((it) => it.t === "rect" && it.w === 3.5 && it.h > 30) as { x: number; z: number } | undefined;
check("the section through the deck: a top-mounted front post inside the edge on the boards, a side-mounted one outside it down the rim", (secPost(alu)?.x ?? 0) < D - 3.5 && near(secPost(alu)?.z ?? 0, surface) && (secPost(aluSide)?.x ?? 0) >= D && (secPost(aluSide)?.z ?? 99) < surface, `${JSON.stringify(secPost(alu))} ${JSON.stringify(secPost(aluSide))}`);
check("the general notes say how the guard posts are held", permitNotes(aluS).some((n) => /guard posts top-mounted on their base plates over blocking/.test(n)) && permitNotes(cedarS).some((n) => /guard posts bolted through the rim with tension ties, the rim blocked/.test(n)));

console.log("── kept through a save, and inside every shape");
const saved = normalizeDeckDesign(JSON.parse(JSON.stringify(mixed)));
check("the mount and the one side's own come back from a saved design", saved.rail.mount === "top" && saved.rail.mountBy["upper-left"] === "side" && JSON.stringify(buildStructure(saved).rails.members) === JSON.stringify(mixedS.rails.members));
const junk = normalizeDeckDesign({ ...alu, rail: { type: "aluminum", mount: "sideways", mountBy: { "upper-front": "side", "upper-roof": "top", "lower-left": "under" } } });
check("junk is not kept: an unknown mount is the system's own, an unknown side or mount is dropped", junk.rail.mount === "auto" && JSON.stringify(junk.rail.mountBy) === JSON.stringify({ "upper-front": "side" }));
const ell = base({ shape: { kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } }, rail: { type: "aluminum" } });
const ellRing = shapeOutline(buildStructure(ell).design.shape);
const ellPosts = posts(ell);
check("an L-shaped deck, top-mounted: every post inside the outline, ONE post at the inside corner where the two lines cross (2.75 in. in from both edges)", buildStructure(ell).design.shape.kind === "L" && ellPosts.length > 6 && ellPosts.every((m) => insideBy(ellRing, m.cx, m.cy) >= 2.2) && ellPosts.filter((m) => near(insideBy(ellRing, m.cx, m.cy), TOP_MOUNT_IN * Math.SQRT2, 0.05)).length === 1, JSON.stringify(ellPosts.map((m) => insideBy(ellRing, m.cx, m.cy).toFixed(1))));
const lowered = base({ heightIn: 60, rail: { type: "aluminum" }, lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 21, align: "centre" } });
const lowS = buildStructure(lowered);
check("a lower level's rail is mounted like the deck's, on its own boards", lowS.rails.members.filter((m) => m.role === "rail-post" && m.of.startsWith("lower-")).length > 0 && lowS.rails.members.filter((m) => m.role === "rail-post" && m.of.startsWith("lower-")).every((m) => m.mount === "top" && near(m.cz - m.sz / 2, lowS.lower!.frame.surfaceIn + BASE_PLATE_THICK_IN)));

console.log("── under a roof");
const covered = base({ structure: "covered-deck", rail: { type: "aluminum" }, roof: { ...defaultDeckDesign({ state: "TX" }).roof, kind: "gable", attach: "wall" } });
const covS = buildStructure(covered);
const roofPostsOn = covS.roof!.posts;
const railPosts = covS.rails.members.filter((m) => m.role === "rail-post");
check("a covered deck, top-mounted: no rail post is set inside a roof post — the roof's post is the rail's post there, and the checks say so", roofPostsOn.length > 0 && covS.rails.onRoofPosts > 0 && !railPosts.some((m) => roofPostsOn.some((rp) => Math.abs(rp.x - m.cx) < 4.5 && Math.abs(rp.y - m.cy) < 4.5)) && /roof's post is the rail's post there/.test(deckChecks(covS).find((c) => c.id === "guard-mount")?.text ?? ""), `${covS.rails.onRoofPosts} on roof posts; ${railPosts.length} rail posts`);
check("…side-mounted, the rail hangs outside the rim, clear of the roof's posts: every rail post its own", buildStructure(base({ structure: "covered-deck", rail: { type: "aluminum", mount: "side" }, roof: covered.roof })).rails.onRoofPosts === 0);

console.log("── the stairs' rail posts follow the side they leave");
const stairOn = (rail: Record<string, unknown>) => base({ rail, stairs: [{ id: "s1", side: "front", atFt: 8, widthFt: 4, level: "upper", wrap: false, wrapSides: 1, landing: "pad", handrail: "both" }] });
const stairPostsOf = (d: DeckDesign) => buildStructure(d).stairs[0].members.filter((m) => m.role === "stair-rail-post");
const aluStair = stairOn({ type: "aluminum" });
const aluSt = buildStructure(aluStair);
const stTop = stairPostsOf(aluStair);
const treadTops = new Set(Array.from({ length: aluSt.stairs[0].risers }, (_, k) => Math.round((surface - k * aluSt.stairs[0].riserIn) * 10)));
check("an aluminum rail, top-mounted: the stair's posts stand ON the treads (each foot at the deck's surface or a tread's), 2¾ in. in from the stair's edges", aluSt.stairs[0].rail.mount === "top" && stTop.length === aluSt.stairs[0].rail.posts && stTop.every((m) => treadTops.has(Math.round((m.cz - m.sz / 2) * 10))) && new Set(stTop.map((m) => Math.round(Math.abs(m.cx - 96) * 100))).size === 1 && Math.abs(Math.abs(stTop[0].cx - 96) - (24 - 2.75)) < 0.01, JSON.stringify(stTop.map((m) => [m.cx, (m.cz - m.sz / 2).toFixed(2)]).slice(0, 4)));
check("…no post runs down the stringer, no tension ties: blocking under every post, the deck's and the stairs'", aluSt.rails.hardware.postTies === 0 && aluSt.rails.stairTopPosts === aluSt.rails.stairPosts && aluSt.rails.hardware.blocks === 2 * (aluSt.rails.posts + aluSt.rails.stairPosts), JSON.stringify(aluSt.rails.hardware));
const cedarStair = stairOn({ type: "cedar" });
const cedarSt = buildStructure(cedarStair);
check("a cedar rail, side-mounted: the stair's posts are bolted to the stringers as they always were — down the stringer's depth, a pair of ties each", cedarSt.stairs[0].rail.mount === "side" && stairPostsOf(cedarStair).every((m) => m.sz > 36 + 6 + 10) && cedarSt.rails.hardware.postTies === cedarSt.rails.posts + cedarSt.rails.stairPosts && cedarSt.rails.stairTopPosts === 0);
const frontSide = buildStructure(stairOn({ type: "aluminum", mountBy: { "upper-front": "side" } }));
check("the front alone side-mounted: the stair down the front follows it — on the stringers, on the maker's brackets", frontSide.stairs[0].rail.mount === "side" && frontSide.rails.stairTopPosts === 0 && frontSide.rails.hardware.fasciaBrackets === frontSide.rails.sidePosts + frontSide.rails.stairPosts, JSON.stringify(frontSide.rails.hardware));
check("the checks say how the stairs' posts are held", /stairs' \d+ posts follow the side they leave: on the treads/.test(deckChecks(aluSt).find((c) => c.id === "guard-mount")?.text ?? "") && /on the stringers/.test(deckChecks(cedarSt).find((c) => c.id === "guard-mount")?.text ?? ""));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
