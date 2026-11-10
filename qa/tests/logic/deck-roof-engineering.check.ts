// The roof engineered to code (2026-10-11; owner: "a 40-ft span on the roof with no supports is bad engineering — check
// the roof trusses and the rafters up to the code"): trusses where rafters or a ridge cannot be framed; rafters opposite
// each other at a ridge; every post's load from what it really carries, the roof's weight and the posts' loads in
// balance; more posts until each footing reads on its table; a post under every king post on a header of more than one
// span; rafter ties past stock and trusses past their span caught; a shed's side headers carrying no rafters; hips
// designed as beams; LVL headers as wide as their posts; and a deep deck's frame taking the beam line its beams need.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-roof-engineering.check.ts
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { POST_TABLE_MAX_AREA } from "../../../src/lib/deck/codeTables";
import { defaultDeckDesign } from "../../../src/lib/deck/design";
import { priceStructure } from "../../../src/lib/deck/pricing";
import { designHip, sizeLvl } from "../../../src/lib/deck/roof";
import { SCENE_LAYERS, deckScene } from "../../../src/lib/deck/scene";
import { buildStructure } from "../../../src/lib/deck/structure";
import { DECK_SAMPLES, sampleDesign } from "../../../src/lib/deck/samples";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
type Patch = Parameters<typeof applyDeckPatch>[1];
const build = (p: Patch) => buildStructure(applyDeckPatch(base, p));
const covered = (w: number, d: number, roof: Partial<typeof base.roof> = {}, more: Patch = {}): Patch => ({ structure: "covered-deck", shape: { kind: "rect", widthFt: w, depthFt: d }, roof: { ...base.roof, ...roof }, ...more });
const limitLb = POST_TABLE_MAX_AREA * (base.loadPsf + 10);
/** The roof's own weight on its posts and the house: the roof at its load, plus every header's own weight. */
const balance = (s: ReturnType<typeof buildStructure>) => {
  const r = s.roof!;
  const roofLb = r.totalPsf * r.footprintSqFt;
  const headersLb = r.headers.reduce((a, h) => a + ((35 * h.spec.thickIn * h.spec.depthIn) / 144) * (h.lengthIn / 12), 0);
  const postsLb = r.posts.reduce((a, p) => a + p.loadLb, 0);
  return { roofLb, headersLb, postsLb };
};

// ── the owner's free-standing 39'-6" × 25' gable: trusses, nothing in the middle, every post on its footing table
const free = build(covered(39.5, 25, { kind: "gable", attach: "free" }));
const fr = free.roof!;
check("the owner's 39'-6\" × 25' free gable is trussed: no ridge member, no king posts, no ties", !!fr.trusses && fr.ridge === null && fr.kingPosts === 0 && fr.ties === 0, JSON.stringify(fr.trusses));
// Free-standing on a deck against the house, its back posts stand off the wall for the back gutter's gap (2026-11-07):
// the trusses span from them to the front posts, 4½ in. in from the deck's front edge.
const spanFree = 25 * 12 - 4.5 - (fr.houseGap?.postsIn ?? 4.5);
check("…the trusses span from the back posts — off the house for the gutter's gap — to the front, 24 in. apart along the 39 ft ridge", !!fr.trusses && !!fr.houseGap && near(fr.trusses.spanIn, spanFree, 2) && fr.trusses.spacingIn === 24 && fr.trusses.count >= 20 && fr.trusses.count <= 22 && fr.trusses.gableEnds === 2, `${fr.trusses?.count} × ${fr.trusses?.spanIn} in.`);
check("…each truss drawn whole: two top chords, a bottom chord and four webs", fr.members.filter((m) => m.role === "truss").length === 7 * (fr.trusses?.count ?? 0));
check("…every post brings down less than its footing table reads", fr.posts.every((p) => p.loadLb <= limitLb), `${Math.max(...fr.posts.map((p) => p.loadLb))} lb, the table reads ${limitLb}`);
const fb = balance(free);
check("…and the posts carry exactly the roof and the headers' own weight (a free roof: nothing on the house)", near(fb.postsLb, fb.roofLb + fb.headersLb, 0.02 * fb.postsLb), `${Math.round(fb.postsLb)} vs ${Math.round(fb.roofLb)} + ${Math.round(fb.headersLb)}`);
const frChecks = deckChecks(free);
const trussCheck = frChecks.find((c) => c.id === "rafter-span");
check("the strip reads the trusses on IRC R802.10, the truss maker's stamped drawings with the permit", trussCheck?.level === "pass" && /manufactured trusses 24 in\. on center span/.test(trussCheck.text) && trussCheck.rule === "IRC R802.10" && /stamps them/.test(trussCheck.text), trussCheck?.text.slice(0, 160));
check("…says why: a ridge beam would span the ridge with only a king post at each end", /ridge beam here would have to span|No beam in the table spans the ridge/.test(trussCheck?.text ?? ""));
check("…the ridge passes with no beam to carry, and nothing on the roof fails", frChecks.some((c) => c.id === "ridge" && c.level === "pass" && /No ridge beam or board/.test(c.text)) && !frChecks.some((c) => c.level === "fail" && /^(rafter|ridge|roof|header)/.test(c.id)), frChecks.filter((c) => c.level === "fail").map((c) => c.id).join(","));
const pkg = priceStructure(free);
const tc = pkg.bom.find((l) => l.id === "trusses-common");
const tg = pkg.bom.find((l) => l.id === "trusses-gable");
check("the materials buy the trusses by the truss, priced by the foot of span: commons and two gable ends", !!tc && !!tg && tc.rateKey === "lf.truss" && tc.qty === (fr.trusses?.count ?? 0) - 2 && tg.qty === 2 && near(tc.rateQty, (tc.qty * spanFree) / 12, 1), `${tc?.qty} + ${tg?.qty}`);
check("…a hurricane tie at both bearings of every truss, and the truss bracing", fr.hardware.hurricaneTies === 2 * (fr.trusses?.count ?? 0) && pkg.bom.some((l) => /truss bracing/.test(l.label)));
check("…and no rafters or ridge lumber bought", !pkg.bom.some((l) => /— rafters$|— ridge$|rafter ties/.test(l.label)), pkg.bom.filter((l) => /rafter|ridge/.test(l.label)).map((l) => l.label).join(" | "));

// The 3D: every web's ends land on a chord.
const dist = (p: number[], b: number[]) => {
  const yaw = b.length >= 10 ? b[8] : 0;
  const tilt = b.length >= 10 ? b[9] : 0;
  const ax = [Math.cos(yaw) * Math.cos(tilt), Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt)];
  const ay = [-Math.sin(yaw), Math.cos(yaw), 0];
  const az = [-Math.cos(yaw) * Math.sin(tilt), -Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt)];
  const d = [p[0] - b[1], p[1] - b[2], p[2] - b[3]];
  const dot = (v: number[]) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  return Math.hypot(Math.max(0, Math.abs(dot(ax)) - b[4] / 2), Math.max(0, Math.abs(dot(ay)) - b[5] / 2), Math.max(0, Math.abs(dot(az)) - b[6] / 2));
};
const scene = deckScene(free);
let loose = 0;
for (const b of scene.boxes) {
  if (SCENE_LAYERS[b[0]] !== "rafter" || b.length < 10 || b[9] === 0) continue;
  const ax = Math.cos(b[8]) * Math.cos(b[9]);
  const ay = Math.sin(b[8]) * Math.cos(b[9]);
  const az = Math.sin(b[9]);
  const ends = [[b[1] - (ax * b[4]) / 2, b[2] - (ay * b[4]) / 2, b[3] - (az * b[4]) / 2], [b[1] + (ax * b[4]) / 2, b[2] + (ay * b[4]) / 2, b[3] + (az * b[4]) / 2]];
  const high = ends[0][2] > ends[1][2] ? ends[0] : ends[1];
  if (Math.min(...scene.boxes.filter((o) => o !== b).map((o) => dist(high, o))) > 0.1) loose++;
}
check("the 3D draws every truss whole: each top chord and web meets the rest at its high end", loose === 0, `${loose} loose`);

// ── the owner's 39'-6" × 25' gable on the house: a ridge beam would bring ~10,000 lb down one king post — trusses across
const wall = build(covered(39.5, 25, { kind: "gable", attach: "wall" }));
const wr = wall.roof!;
check("on the house, the same gable is trussed across its 38'-9\" width: a king post would bring more down than a footing reads", wr.trusses?.why === "post" && near(wr.trusses.spanIn, 465, 2) && wr.trusses.chord === "2x6" && (wr.trusses.kingLoadLb ?? 0) > limitLb, JSON.stringify(wr.trusses));
check("…its posts all read on their footing table", wr.posts.every((p) => p.loadLb <= limitLb), `${Math.max(...wr.posts.map((p) => p.loadLb))} lb`);

// ── rafters opposite each other at the ridge (R802.3): one layout for both faces
const along = (s: ReturnType<typeof buildStructure>) => {
  const r = s.roof!;
  const byFace = new Map<string, number[]>();
  for (const m of r.members.filter((mm) => mm.role === "rafter")) {
    const alongX = Math.abs(m.x1 - m.x0) < Math.abs(m.y1 - m.y0);
    const pos = alongX ? (m.x0 + m.x1) / 2 : (m.y0 + m.y1) / 2;
    byFace.set(m.of ?? "", [...(byFace.get(m.of ?? "") ?? []), pos]);
  }
  return [...byFace.values()].map((v) => v.sort((a, b) => a - b));
};
for (const [name, p] of [["the 16 × 12 gable on the house", covered(16, 12)], ["a 30 × 16 free gable", covered(30, 16, { kind: "gable", attach: "free" })]] as Array<[string, Patch]>) {
  const faces = along(build(p));
  const ok = faces.length === 2 && faces[0].length === faces[1].length && faces[0].every((x, i) => Math.abs(x - faces[1][i]) <= 1.5);
  check(`${name}: every common rafter meets its partner at the ridge, within 1½ in. (IRC R802.3)`, ok, faces.map((f) => f.length).join(" / "));
}

// ── a post under every king post on a header of more than one span
const mid = build(covered(22.5, 20));
const kingH = mid.roof!.headers.find((h) => h.kingPost);
check("22'-6\" × 20' on the house: an LVL ridge beam on a king post over the front header", mid.roof!.ridge?.kind === "beam" && mid.roof!.kingPosts === 1 && !!kingH);
check("…and the front header has a post right under the king post (an even number of spans)", !!kingH && (kingH.postAt.length - 1) % 2 === 0 && kingH.postAt.some((a) => Math.abs(a - kingH.lengthIn / 2) < 1), kingH ? `${kingH.postAt.length - 1} spans at ${kingH.postAt.map((a) => Math.round(a)).join(",")}` : "no king header");

// ── a ridge board asked for where its ties would be longer than stock; trusses asked for past their span
const boardAsked = build(covered(39.5, 25, { kind: "gable", attach: "free", ridge: "board" }));
const tieFail = deckChecks(boardAsked).find((c) => c.id === "ridge-ties");
check("a ridge board on the 25-ft-wide roof: its 24-ft ties are past 20-ft stock — a failure whose fix is trusses", boardAsked.roof!.flags.tiesBeyondStock && tieFail?.level === "fail" && tieFail.fix?.label === "Frame it with trusses", tieFail?.text.slice(0, 120));
const fixed = buildStructure(applyDeckPatch(applyDeckPatch(base, covered(39.5, 25, { kind: "gable", attach: "free", ridge: "board" })), tieFail?.fix?.patch ?? {}));
check("…and the fix frames it with trusses, nothing failing on the roof", !!fixed.roof!.trusses && fixed.roof!.trusses.why === "asked" && !deckChecks(fixed).some((c) => c.level === "fail" && /^(rafter|ridge|roof)/.test(c.id)));
// (a deck is at most 40 ft deep, so only a gable on the house — its ridge out from the wall — spans more across)
const tooWide = build(covered(50, 20, { kind: "gable", attach: "wall", ridge: "trusses" }));
check("trusses asked for across a 50-ft gable on the house: past what a common truss spans here — said, with an engineer", tooWide.roof!.flags.trussesBeyond && tooWide.roof!.ridgeAcrossIn > 480 && deckChecks(tooWide).some((c) => c.id === "roof-trusses" && c.level === "fail"), `across ${tooWide.roof!.ridgeAcrossIn} in.`);
const askedSmall = build(covered(16, 12, { kind: "gable", ridge: "trusses" }));
check("trusses asked for on a 16 × 12 gable: trussed, the reason 'as chosen'", askedSmall.roof!.trusses?.why === "asked" && askedSmall.roof!.ridge === null);

// ── a shed's side headers carry no rafters: the posts and the house carry the roof once
const shed = build(covered(30, 16, { kind: "shed", attach: "free" }, { placement: "detached" }));
const sb = balance(shed);
check("a free 30 × 16 shed: the posts carry the roof and the headers' weight once, not the side headers' phantom half-depth", near(sb.postsLb, sb.roofLb + sb.headersLb, 0.02 * sb.postsLb), `${Math.round(sb.postsLb)} vs ${Math.round(sb.roofLb + sb.headersLb)}`);
const shedWall = build(covered(30, 25, { kind: "shed" }));
const sideHeaders = shedWall.roof!.headers.filter((h) => h.wallEnd);
check("an attached 30 × 25 shed: its side headers are light (rafters run parallel to them)", sideHeaders.length === 2 && sideHeaders.every((h) => h.eqJoistSpanFt < 3), sideHeaders.map((h) => `${h.spec.size} eq ${h.eqJoistSpanFt}`).join(" · "));

// ── hips designed as beams (R802.3)
const g12 = designHip(7 * 12, 12, Math.PI / 4, "2x6", "DF", 32, false, false);
check("a 12-ft square gazebo's hip: a 2x8, one size deeper than the 2x6 commons, carries its ~784 lb of jacks", g12.nominal === "2x8" && g12.kind === "sawn" && near(g12.loadLb, 784, 2), `${g12.nominal} ${g12.loadLb} lb`);
const big = build(covered(40, 25, { kind: "hip", attach: "free" }, { placement: "detached" }));
check("a 40 × 25 open hip roof: hips bigger than one size deeper — designed for their ~2,750 lb of jacks over 17 ft", ["3-2x12", "2-2x12"].includes(big.roof!.hips.nominal) || big.roof!.hips.kind === "lvl", `${big.roof!.hips.nominal} · ${big.roof!.hips.loadLb} lb over ${big.roof!.hips.spanIn} in.`);
check("…the strip says what each hip carries and that it is sized as a beam", deckChecks(big).some((c) => c.id === "roof-hips" && c.level === "pass" && /lb of jack rafters over/.test(c.text) && /sized as a beam/.test(c.text)));
check("…each built-up hip drawn ply by ply", big.roof!.members.filter((m) => m.role === "hip").length === big.roof!.hips.count * (big.roof!.hips.nominal.startsWith("3-") ? 3 : big.roof!.hips.nominal.startsWith("2-") ? 2 : 1));
const huge = designHip(30 * 12, 12, Math.PI / 4, "2x12", "HF", 92, true, false);
check("a hip past a 3-ply LVL is said as beyond", huge.beyond);

// ── LVL headers as wide as their posts
check("an LVL is never one ply when three are asked for (a 6x6 post's cap)", (sizeLvl(240, 400, 3)?.plies ?? 3) >= 3 && (sizeLvl(120, 100, 2)?.plies ?? 2) >= 2);
const lvlHeaders = [free, wall, big].flatMap((s) => s.roof!.headers.filter((h) => h.spec.kind === "lvl"));
check("…and every LVL header on these roofs' 6x6 posts is three plies (5¼ in.)", lvlHeaders.length > 0 && lvlHeaders.every((h) => h.spec.plies === 3), lvlHeaders.map((h) => h.spec.size).join(" · "));

// ── a deep deck takes the beam line its beams need
const deep = build({ shape: { kind: "rect", widthFt: 39.5, depthFt: 25 } });
const deepF = deep.frame!;
check("a 39'-6\" × 25' deck: two middle beams and a front one, every beam and post inside its table", deepF.beams.filter((b) => b.role === "middle").length >= 2 && !deckChecks(deep).some((c) => c.level === "fail"), `${deepF.beams.map((b) => `${b.role}:${b.spec.size}`).join(" ")} · ${deckChecks(deep).filter((c) => c.level === "fail").map((c) => c.id).join(",")}`);

// ── roof posts clear of the stairs (2026-10-12: the covered samples set a post in the middle of the stair on the front)
const sampleBase = defaultDeckDesign({ state: "WA", frostIn: 18 });
const stairDesign = (side: "front" | "left" | "right", atFt: number, widthFt: number) => [{ id: "s1", side, atFt, widthFt, level: "upper" as const, wrap: false, wrapSides: 1 as const, landing: "pad" as const, handrail: "auto" as const }];
const opening = (st: { side: string; atFt: number; widthFt: number }) => [st.atFt * 12 - (st.widthFt * 12) / 2, st.atFt * 12 + (st.widthFt * 12) / 2];
const postsIn = (s: ReturnType<typeof buildStructure>) =>
  (s.roof?.posts ?? []).filter((p) =>
    s.design.stairs.some((st) => {
      if (st.level !== "upper" || st.wrap) return false;
      const [a, b] = opening(st);
      const half = (s.roof!.roof.post === "4x4" ? 3.5 : 5.5) / 2;
      const D = Math.max(...(s.frame?.zones ?? []).map((z) => z.zone.y1));
      const W = Math.max(...(s.frame?.zones ?? []).map((z) => z.zone.x1));
      return st.side === "front" ? Math.abs(p.y - D) < 24 && p.x + half > a && p.x - half < b : st.side === "left" ? Math.abs(p.x) < 24 && p.y + half > a && p.y - half < b : Math.abs(p.x - W) < 24 && p.y + half > a && p.y - half < b;
    }),
  );
for (const id of ["covered-gable", "covered-shed", "covered-hip"]) {
  const sample = DECK_SAMPLES.find((x) => x.id === id)!;
  const s = buildStructure(sampleDesign(sample, sampleBase));
  check(`the ${id} sample: no roof post in the stair's opening, the front header sized for the spans it has`, s.stairs.length > 0 && postsIn(s).length === 0 && s.roof!.headers.every((h) => h.maxSpanIn === 0 || h.spanIn <= h.maxSpanIn + 0.5) && !deckChecks(s).some((c) => c.id.startsWith("roof-post-stair")), s.roof!.posts.map((p) => `(${(p.x / 12).toFixed(1)}, ${(p.y / 12).toFixed(1)})`).join(" "));
}
const kingStair = build(covered(22.5, 20, { kind: "gable", ridge: "beam" } as never, { stairs: stairDesign("front", 11.25, 4) as never }));
const kingFront = kingStair.roof!.headers.find((h) => h.kingPost)!;
const kingLimit = POST_TABLE_MAX_AREA * (base.loadPsf + 10);
check("a 22'-6\" × 20' gable on a ridge beam with a 4-ft stair under its king post: the post stands beside the stair, the header carries the king post across it", !!kingFront && postsIn(kingStair).length === 0 && kingFront.postAt.length >= 3 && kingFront.spanIn <= kingFront.maxSpanIn + 0.5 && kingStair.roof!.posts.every((p) => p.loadLb <= kingLimit) && !deckChecks(kingStair).some((c) => c.level === "fail" && /roof|header|ridge/i.test(c.part)), kingFront ? `${kingFront.spec.size}, posts at ${kingFront.postAt.map((a) => (a / 12).toFixed(2)).join(" ")} ft, span ${(kingFront.spanIn / 12).toFixed(1)} of ${(kingFront.maxSpanIn / 12).toFixed(1)}` : "no king header");
const kingPlain = build(covered(22.5, 20, { kind: "gable", ridge: "beam" } as never));
const plainFront = kingPlain.roof!.headers.find((h) => h.kingPost)!;
check("…and with no stair there, the post still stands right under the king post", !!plainFront && plainFront.postAt.some((a) => Math.abs(a - plainFront.lengthIn / 2) < 0.5));
let corner = applyDeckPatch(base, covered(16, 12, { kind: "gable" }, { stairs: stairDesign("front", 2, 4) as never }));
const cornerCheck = deckChecks(buildStructure(corner)).find((c) => c.id.startsWith("roof-post-stair"));
check("a stair run into the corner post: a failing check that says the corner cannot move, with a fix that slides the stair", !!cornerCheck && cornerCheck.level === "fail" && /cannot move/.test(cornerCheck.text) && !!cornerCheck.fix, cornerCheck?.text ?? "no check");
if (cornerCheck?.fix) corner = applyDeckPatch(corner, cornerCheck.fix.patch);
const cornerFixed = buildStructure(corner);
check("…and after the fix the stair clears it", postsIn(cornerFixed).length === 0 && cornerFixed.roof!.postsInStair.length === 0 && !deckChecks(cornerFixed).some((c) => c.id.startsWith("roof-post-stair")), `stair at ${corner.stairs[0].atFt.toFixed(2)} ft`);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
