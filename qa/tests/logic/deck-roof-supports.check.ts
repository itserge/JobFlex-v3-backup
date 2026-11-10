// THE ROOF'S SUPPORTS (2026-10-12; owner: "check if we have selections of beams for cross roof beams and supports, and if
// this part is calculated and engineered right"): a ridge board gets rafter ties wherever rafters meet on it; a free
// hip's ridge beam stands on king posts on CROSS BEAMS with a post under each end; a gable's ridge beam takes cross beams
// when asked; the hips' push on the corners gets a tension strap at every header joint; a louvered pergola is sized as
// the roof it is when closed; the hip's deflection reads the textbook coefficient; LVL is kept out of the weather. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-roof-supports.check.ts
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, defaultRoofDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { designHip } from "../../../src/lib/deck/roof";
import { buildStructure } from "../../../src/lib/deck/structure";
import { priceStructure } from "../../../src/lib/deck/pricing";
import { DRESSED_DEPTH_IN, JOIST_SIZES } from "../../../src/lib/deck/codeTables";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const site = (state: string, snow: number) => {
  const d = defaultDeckDesign({ state });
  return applyDeckPatch(d, { site: { ...d.site, groundSnowPsf: snow, state } });
};
const roofOn = (b: DeckDesign, w: number, dpt: number, roof: Partial<DeckDesign["roof"]>, free = true) =>
  applyDeckPatch(applyDeckPatch(b, { shape: { kind: "rect", widthFt: w, depthFt: dpt }, ...(free ? { placement: "detached" as const } : {}) }), { structure: "covered-deck", roof: { ...defaultRoofDesign("covered-deck"), ...(free ? { attach: "free" as const } : {}), ...roof } });
const TX = site("TX", 0);
const UT = site("UT", 50);

console.log("── a free hip on a ridge BOARD: ties, full-slope headers, straps");
const hb = buildStructure(roofOn(TX, 20, 12, { kind: "hip" })).roof!;
check("rafter ties across where the commons meet the ridge (8 ft: three), and a tie from each end header", hb.ridge?.kind === "board" && hb.ties === 3 && hb.hipEndTies === 2 && hb.members.filter((m) => m.role === "tie").length === 5, `${hb.ties} + ${hb.hipEndTies}`);
const longH = hb.headers.filter((h) => !h.cross && h.lengthIn > 200);
const face = hb.faces.find((f) => f.top === "ridge");
// The posts stand 4½ in. in from the deck's edge: the slope's run from the eave line is half of 12 ft less 9 in. plus the overhangs.
const runFt = (12 * 12 - 9 + 2 * 12) / 2 / 12;
check("the long headers carry the whole slope — the board holds nothing up", longH.length === 2 && longH.every((h) => near(h.eqJoistSpanFt, (2 * runFt * hb.totalPsf) / 50, 0.15)), longH.map((h) => `${h.spec.size} eq ${h.eqJoistSpanFt} (whole slope: ${((2 * runFt * hb.totalPsf) / 50).toFixed(1)})`).join(", ") + (face ? "" : ""));
const W = hb.hips.loadLb ?? 0;
const T = Math.round((2 * W) / 3 / ((4 / 12) * Math.cos(Math.PI / 4)) / (2 * Math.sin(Math.PI / 4)));
check("the corners: a tension strap at all four header joints, rated for the hips' push", hb.hardware.cornerStraps === 4 && near(hb.ringTensionLb, T, 2) && hb.ringTensionLb > 1000, `${hb.ringTensionLb} lb (hand: ${T})`);
const hbChecks = deckChecks(buildStructure(roofOn(TX, 20, 12, { kind: "hip" })));
check("the strip says ties and straps — and never that a hip ties itself", hbChecks.some((c) => c.id === "ridge" && /rafter tie/.test(c.text) && /end header/.test(c.text)) && hbChecks.some((c) => c.id === "roof-ring" && /tension strap/.test(c.text)) && !hbChecks.some((c) => /ties itself/.test(c.text)));
const hbPkg = priceStructure(buildStructure(roofOn(TX, 20, 12, { kind: "hip" })));
const strapLine = hbPkg.bom.find((l) => l.id === "corner-straps");
check("…and the straps are in the material list, each line saying the rating", !!strapLine && strapLine.qty === 4 && /at least [\d,]+ lb/.test(strapLine.note ?? ""), strapLine?.note);

console.log("── a free hip on a ridge BEAM: cross beams, king posts, posts under them");
const hbBeamS = buildStructure(roofOn(TX, 20, 12, { kind: "hip", ridge: "beam" }));
const hx = hbBeamS.roof!;
const cross = hx.headers.filter((h) => h.cross);
check("two cross beams, eave header to eave header, one at each of the ridge's ends", hx.crossBeams === 2 && cross.length === 2 && cross.every((h) => near(h.lengthIn, 12 * 12 - 9, 2) && h.kingPost), cross.map((h) => `${h.spec.size} ${h.lengthIn}`).join(", "));
const rx = hx.ridge!;
check("the ridge beam spans between them, held by two king posts", rx.kind === "beam" && near(rx.spanIn, (20 - 12) * 12, 1) && hx.kingPosts === 2 && hx.members.filter((m) => m.role === "king").length === 2, `${rx.spec?.size} over ${rx.spanIn}`);
const longX = hx.headers.filter((h) => !h.cross && h.lengthIn > 200);
/** A header's posts in plan (a ring header may run either way). */
const postPts = (h: { x0: number; y0: number; x1: number; y1: number; lengthIn: number; postAt: number[] }) => h.postAt.map((a) => ({ x: h.x0 + ((h.x1 - h.x0) * a) / h.lengthIn, y: h.y0 + ((h.y1 - h.y0) * a) / h.lengthIn }));
const underEnd = (h: Parameters<typeof postPts>[0], c: { x0: number; y0: number; x1: number; y1: number }) => postPts(h).some((p) => (near(p.x, c.x0, 1) && near(p.y, c.y0, 1)) || (near(p.x, c.x1, 1) && near(p.y, c.y1, 1)));
check("a post stands under every cross beam's end — the long headers break there", longX.length === 2 && longX.every((h) => cross.every((c) => underEnd(h, c))), longX.map((h) => h.postAt.map((a) => Math.round(a)).join("/")).join(" · "));
check("nothing pushes out: no ties, no straps, and the headers carry half the slope again", hx.ties === 0 && hx.hipEndTies === 0 && hx.hardware.cornerStraps === 0 && hx.ringTensionLb === 0 && longX.every((h) => h.eqJoistSpanFt < 6));
check("…hung in beam hangers, a bracket at each king post", hx.hardware.crossHangers === 4 && hx.hardware.kingBrackets === 2);
// The cross beam, checked by hand (NDS / the LVL figures): the king post's load at its middle.
const c0 = cross[0];
const P = (() => {
  const sp = hx.posts.filter((p) => cross.some((c) => near(p.x, c.x0, 1) && (near(p.y, c.y0, 1) || near(p.y, c.y1, 1))));
  return sp.length;
})();
const Pk = (hx.totalPsf * (5.667 * 1)) * 8 / 2 + 2 * ((2 * (hx.hips.loadLb ?? 0)) / 3);
const Lc = c0.lengthIn + 9;
const M = (Pk * Lc) / 4;
const S = (c0.spec.thickIn * c0.spec.depthIn ** 2) / 6;
const I = (c0.spec.thickIn * c0.spec.depthIn ** 3) / 12;
const E = c0.spec.kind === "lvl" ? 2_000_000 : 1_400_000;
const Fb = c0.spec.kind === "lvl" ? 2600 : 1000;
const defl = (Pk * Lc ** 3) / (48 * E * I);
check("the cross beam by hand: bending and deflection under the king post's load pass", M / S <= Fb && defl <= Lc / 240 && P === 4, `${c0.spec.size}: ${Math.round(M / S)} psi of ${Fb}, deflection L/${Math.round(Lc / defl)}, ${P} posts under the ends, king ≈ ${Math.round(Pk)} lb`);
const hxChecks = deckChecks(hbBeamS);
check("the strip says the ridge beam stands on king posts on cross beams, each cross beam read and passed", hxChecks.some((c) => c.id === "ridge" && c.level === "pass" && /cross beam/.test(c.text)) && cross.every((h) => hxChecks.some((c) => c.id === `header-${h.id}` && c.level === "pass" && /cross beam/.test(c.text))));
const hxPkg = priceStructure(hbBeamS);
check("…the cross beams' hangers in the material list", hxPkg.bom.some((l) => l.id === "cross-hangers" && l.qty === 4));
const hxUT = buildStructure(roofOn(UT, 20, 12, { kind: "hip", ridge: "beam" })).roof!;
check("under 50 psf of snow the cross beams grow, and still pass", hxUT.crossBeams === 2 && hxUT.headers.filter((h) => h.cross).every((h) => h.maxSpanIn >= h.spanIn - 0.5), hxUT.headers.filter((h) => h.cross).map((h) => h.spec.size).join(", "));

console.log("── a gable's ridge beam on cross beams, when asked");
const g0 = buildStructure(roofOn(TX, 24, 14, { kind: "gable", ridge: "beam" })).roof!;
const g1 = buildStructure(roofOn(TX, 24, 14, { kind: "gable", ridge: "beam", crossBeams: 1 })).roof!;
const g2 = buildStructure(roofOn(TX, 24, 14, { kind: "gable", ridge: "beam", crossBeams: 2 })).roof!;
check("none: the ridge spans gable end to gable end, as before", g0.crossBeams === 0 && g0.kingPosts === 2 && !g0.headers.some((h) => h.cross));
check("one: the ridge spans half as far, three king posts", g1.crossBeams === 1 && near(g1.ridge!.spanIn, (g0.ridge!.spanIn || 23.25 * 12) / 2, 2) && g1.kingPosts === 3, `${g1.ridge!.spec?.size} over ${g1.ridge!.spanIn} (no cross beam: ${g0.ridge!.spec?.size} over ${g0.ridge!.spanIn})`);
check("two: a third as far, four king posts — and a lighter ridge than none", g2.crossBeams === 2 && g2.kingPosts === 4 && (g2.ridge!.spec?.depthIn ?? 99) <= (g0.ridge!.spec?.depthIn ?? 0), `${g2.ridge!.spec?.size}`);
const gEaves = g1.headers.filter((h) => !h.cross && h.lengthIn > 200);
const gx = g1.headers.find((h) => h.cross)!;
check("a post under each end of the cross beam", gEaves.length === 2 && gEaves.every((h) => underEnd(h, gx)), gEaves.map((h) => h.postAt.map((a) => Math.round(a)).join("/")).join(" · "));
const gw = buildStructure(roofOn(TX, 16, 16, { kind: "gable", ridge: "beam", crossBeams: 2 }, false)).roof!;
check("on the house, too: the ridge from the wall out in three spans, two cross beams", gw.attach === "wall" && gw.crossBeams === 2 && gw.kingPosts === 3 && gw.headers.filter((h) => h.cross).length === 2);
const gBoard = buildStructure(roofOn(TX, 24, 14, { kind: "gable", ridge: "board", crossBeams: 2 })).roof!;
check("cross beams belong to a ridge BEAM: a board with ties takes none", gBoard.crossBeams === 0 && gBoard.ties > 0);
const bal = (r: typeof g1) => ({ posts: r.posts.reduce((a, p) => a + p.loadLb, 0), roof: r.totalPsf * r.footprintSqFt });
const b1 = bal(g1);
check("the posts carry the roof (and the beams' own weight) — no load lost to the cross beams", b1.posts >= b1.roof && b1.posts <= b1.roof * 1.12, `${Math.round(b1.posts)} lb on the posts, ${Math.round(b1.roof)} lb of roof`);

console.log("── gazebos, Dutch gables, gambrels");
const gz = buildStructure(applyDeckPatch(UT, { structure: "gazebo", floor: "slab", roof: defaultRoofDesign("gazebo") })).roof!;
check("a 12 × 12 gazebo in 50-psf snow: a strap at every header joint, ~2,000 lb each", gz.kind === "pyramid" && gz.hardware.cornerStraps === 4 && gz.ringTensionLb > 1500 && gz.ringTensionLb < 2600, `${gz.ringTensionLb} lb`);
const dutch = buildStructure(roofOn(TX, 20, 14, { kind: "dutch-gable" })).roof!;
check("a Dutch gable: rafter ties where its commons meet the ridge, straps at the corners", dutch.kind === "dutch-gable" && dutch.ties >= 2 && dutch.hardware.cornerStraps === 4);
const gam = buildStructure(roofOn(TX, 20, 14, { kind: "gambrel" })).roof!;
const gamFace = gam.headers.filter((h) => h.lengthIn > 200);
check("a gambrel: ties at the header line besides its break ties, the eaves carrying the whole slope", gam.ties >= 2 && gamFace.every((h) => h.eqJoistSpanFt > 8), gamFace.map((h) => h.eqJoistSpanFt).join(", "));
const hw = buildStructure(roofOn(TX, 24, 10, { kind: "hip" }, false)).roof!;
check("a hip on the house hangs on its ledger: no ties, no straps, said as such", hw.attach === "wall" && hw.ties === 0 && hw.ringTensionLb === 0 && deckChecks(buildStructure(roofOn(TX, 24, 10, { kind: "hip" }, false))).some((c) => c.id === "ridge" && c.level === "pass" && /ledger/.test(c.text)));

console.log("── a louvered pergola is a roof when it closes");
const slats = buildStructure(applyDeckPatch(UT, { structure: "pergola", floor: "slab", roof: { ...defaultRoofDesign("pergola"), plan: { shape: "rect", widthFt: 16, depthFt: 12, acrossFt: 12, offsetFt: 0 } } })).roof!;
const louvS = buildStructure(applyDeckPatch(UT, { structure: "pergola", floor: "slab", roof: { ...defaultRoofDesign("pergola"), pergolaStyle: "louvered", plan: { shape: "rect", widthFt: 16, depthFt: 12, acrossFt: 12, offsetFt: 0 } } }));
const louv = louvS.roof!;
check("open slats: 10 psf and the frame's own weight", slats.totalPsf === 14);
check("louvered, in 50-psf snow: the snow and the blades — and bigger beams or more posts", louv.totalPsf === 58 && (louv.posts.length > slats.posts.length || louv.headers.some((h, i) => h.spec.depthIn > (slats.headers[i]?.spec.depthIn ?? 0))), `${louv.totalPsf} psf; ${louv.headers.map((h) => h.spec.size).join(", ")}`);
check("…its rafters read on the snow table, and the strip says it is a roof", deckChecks(louvS).some((c) => c.id === "rafter-span" && /50 psf roof table/.test(c.text)) && deckChecks(louvS).some((c) => c.id === "pergola-open" && /louvers make a roof/.test(c.text)));

console.log("── the hip's deflection reads the textbook coefficient");
const NO2_E = 1_600_000;
const NO2_FB: Record<string, number> = { "2x6": 1170, "2x8": 1080, "2x10": 990, "2x12": 900 };
let mismatch = "";
for (const runFt of [6, 8, 10, 12, 14]) {
  const h = designHip(runFt * 12, 12, Math.PI / 4, "2x6", "DF", 32, false, false);
  if (h.kind !== "sawn") continue;
  const spanIn = (runFt * 12 - 12) / Math.cos(Math.PI / 4);
  const W = (32 * runFt ** 2) / 2;
  const fits = (z: string, plies: number) => {
    const d = DRESSED_DEPTH_IN[Number(z.split("x")[1])];
    const b = 1.5 * plies;
    return (0.1283 * W * spanIn) / ((b * d * d) / 6) <= NO2_FB[z] * 1.25 * (plies >= 2 ? 1.15 : 1) && (0.01304 * W * spanIn ** 3) / (NO2_E * ((b * d ** 3) / 12)) <= spanIn / 180;
  };
  const first = [1, 2, 3].flatMap((pl) => JOIST_SIZES.slice(JOIST_SIZES.indexOf("2x8")).map((z) => ({ z, pl }))).find((o) => fits(o.z, o.pl));
  const want = first ? (first.pl === 1 ? first.z : `${first.pl}-${first.z}`) : "lvl";
  if (want !== h.nominal) mismatch += `${runFt} ft: ${h.nominal} vs ${want}; `;
}
check("the smallest hip that passes bending and 0.01304·W·L³/EI ≤ L/180 is the one picked", mismatch === "", mismatch);

console.log("── LVL out of the weather");
const lvlRoof = buildStructure(roofOn(UT, 24, 14, { kind: "gable", ridge: "beam" }));
check("an engineered beam under an open roof: wrap it, or a treated PSL or glulam", lvlRoof.roof!.headers.some((h) => h.spec.kind === "lvl") || lvlRoof.roof!.ridge?.spec?.kind === "lvl" ? deckChecks(lvlRoof).some((c) => c.id === "roof-lvl-weather" && c.level === "warn" && /dry service/.test(c.text)) : false);
check("…and no such line where every beam is sawn", !deckChecks(buildStructure(roofOn(TX, 16, 12, { kind: "gable", ridge: "board" }))).some((c) => c.id === "roof-lvl-weather"));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
