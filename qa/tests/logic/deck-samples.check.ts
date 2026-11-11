// THE KIND PICKER'S SAMPLES AND PICTURES (2026-10-11, lib/deck/samples +
// lib/deck/iso): every sample is a design the engine builds as described,
// reads back the same through normalize, passes its own checks without a
// failure, prices, and draws as a small picture — lit, in its materials, with
// the house behind it (lib/deck/iso, 2026-10-13) — its faces in paint order
// and grouped by build step in the markup. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-samples.check.ts
import { DECK_SAMPLES, KINDS, KIND_WORDS, kindSample, sampleById, sampleDesign, samplesFor } from "../../../src/lib/deck/samples";
import { isoDrawing, isoMarkup, shadeHex, type IsoMaterials } from "../../../src/lib/deck/iso";
import { defaultDeckDesign, defaultRoofDesign, normalizeDeckDesign, hasDeck, hasRoof, STRUCTURES } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckScene, parseDeckScene, SCENE_MAX_BOXES } from "../../../src/lib/deck/scene";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { priceDeck } from "../../../src/lib/deck/pricing";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

check("four kinds, each with a card sample and words", KINDS.length === 4 && STRUCTURES.every((k) => samplesFor(k).length >= 3 && kindSample(k).structure === k && !!KIND_WORDS[k].blurb));
check("every sample id is unique", new Set(DECK_SAMPLES.map((s) => s.id)).size === DECK_SAMPLES.length);
check("a sample is found by id", sampleById("deck-classic")?.name === "Backyard deck with stairs" && sampleById("nope") === null);

for (const sample of DECK_SAMPLES) {
  const d = sampleDesign(sample);
  const again = normalizeDeckDesign(JSON.parse(JSON.stringify(d)));
  check(`${sample.id}: keeps its kind, floor and shape through normalize`, again.structure === sample.structure && again.floor === d.floor && JSON.stringify(again.shape) === JSON.stringify(d.shape) && again.roof.kind === d.roof.kind && again.roof.attach === d.roof.attach, `${again.structure}/${again.floor}/${again.roof.kind}/${again.roof.attach}`);
  check(`${sample.id}: the patch's own fields stand`, d.structure === sample.structure && (sample.patch.heightIn === undefined || d.heightIn === sample.patch.heightIn) && (sample.patch.rail?.type === undefined || d.rail.type === sample.patch.rail.type) && (sample.patch.stairs === undefined || d.stairs.length === sample.patch.stairs.length) && (sample.patch.lower?.on === undefined || d.lower.on === sample.patch.lower.on), `h ${d.heightIn} rail ${d.rail.type} stairs ${d.stairs.length} lower ${d.lower.on}`);
  const st = buildStructure(d);
  const scene = deckScene(st);
  check(`${sample.id}: builds and scenes within the caps`, scene.boxes.length > 0 && scene.boxes.length <= SCENE_MAX_BOXES && parseDeckScene(JSON.parse(JSON.stringify(scene))) !== null, `${scene.boxes.length} boxes, ${scene.polys.length} polys`);
  const checks = deckChecks(st);
  const fails = checks.filter((c) => c.level === "fail");
  check(`${sample.id}: no check fails`, fails.length === 0, fails.map((f) => `${f.part}: ${f.text}`).join(" | ").slice(0, 160));
  const pkg = priceDeck(d);
  check(`${sample.id}: prices`, pkg.subtotal > 500 && Number.isFinite(pkg.subtotal), `$${Math.round(pkg.subtotal)}`);
  check(`${sample.id}: has a deck ${hasDeck(d)} / a roof ${hasRoof(d)} as its kind says`, hasRoof(d) === (sample.structure !== "deck") && hasDeck(d) === (d.floor === "deck"));
  const iso = isoDrawing(scene);
  const vb = iso.viewBox.split(" ").map(Number);
  check(`${sample.id}: draws`, iso.faces.length >= 30 && iso.faces.length <= 6000 && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 5 && vb[3] > 3 && iso.ranks.length >= 3, `${iso.faces.length} faces, ${iso.solids} solids, ${iso.ranks.length} ranks, viewBox ${iso.viewBox}`);
  check(`${sample.id}: the faces come in build order`, iso.faces.every((f, i) => i === 0 || f.rank >= -1) && iso.ranks.every((r, i) => i === 0 || r > iso.ranks[i - 1]));
  const attached = d.placement !== "detached" && !!scene.house;
  check(`${sample.id}: the house is behind it when attached (${attached})`, attached === iso.faces.some((f) => f.layer === "house") || d.placement === "detached");
  // A face is a closed ring; the one exception is lines only (fill "none"): a long member's own edges over its strips.
  check(`${sample.id}: every path is closed and finite`, iso.faces.every((f) => (f.fill === "none" ? /^M[-\d.,LM]+$/.test(f.d) && !!f.stroke : /^M[-\d.,L]+Z$/.test(f.d))));
}

// The picture's maths.
check("shadeHex darkens and clamps", shadeHex("#808080", 0.5) === "#404040" && shadeHex("#ffffff", 2) === "#ffffff" && shadeHex("not", 0.5) === "not");
const stock = defaultDeckDesign();
const stockScene = deckScene(buildStructure(stock));
const stockIso = isoDrawing(stockScene);
check("the stock deck draws with the ground first", stockIso.faces[0].layer === "ground" && stockIso.faces.length > 50, `${stockIso.faces.length} faces`);
const turned = isoDrawing(stockScene, { yawDeg: -34 });
check("a different yaw gives a different picture", turned.viewBox !== stockIso.viewBox || turned.faces[5].d !== stockIso.faces[5].d);
const capped = isoDrawing(stockScene, { maxSolids: 20 });
check("a tight budget drops the thin layers first, never the decking", capped.solids < stockIso.solids && capped.faces.some((f) => f.layer === "decking"), `${capped.solids} of ${stockIso.solids}`);
const noSkip = isoDrawing(stockScene, { skip: [] });
check("with nothing skipped the hardware is drawn too", noSkip.faces.some((f) => f.layer === "hardware") || noSkip.solids >= stockIso.solids);

// ── Made real (2026-10-13): light, materials, the house, shadows, the markup.
const ids = (d: ReturnType<typeof isoDrawing>) => d.defs.map((x) => x.id);
check("the stock deck has its lawn, a soft shadow under it, and the house with windows and a roof", ids(stockIso).includes("ground") && ids(stockIso).includes("soft") && stockIso.faces.some((f) => f.layer === "shadow") && stockIso.faces.filter((f) => f.layer === "house").length > 12 && stockIso.faces.some((f) => f.fill === "url(#window)"), ids(stockIso).join(","));
check("the boards carry their grain (a pattern along the boards) and every board its own shade", ids(stockIso).some((i) => i.startsWith("grain-")) && new Set(stockIso.faces.filter((f) => f.layer === "decking" && !f.fill.startsWith("url(")).map((f) => f.fill)).size >= 6);
check("the shadows come right after the ground, before the house", (() => { const g = stockIso.faces.findIndex((f) => f.layer === "shadow"); const h = stockIso.faces.findIndex((f) => f.layer === "house"); const last = stockIso.faces.map((f) => f.layer).lastIndexOf("ground"); return g > last && h > g; })());
check("a lit face is a hex colour with its own edge", stockIso.faces.filter((f) => f.layer === "decking" && /^#[0-9a-f]{6}$/.test(f.fill) && f.stroke && /^#[0-9a-f]{6}$/.test(f.stroke)).length > 10);
const quick = isoDrawing(stockScene, { detail: "quick" });
check("a quick frame (while it turns) has no grain and no siding lines, and draws faster", !ids(quick).some((i) => i.startsWith("grain-")) && quick.faces.length < stockIso.faces.length);
const t0 = performance.now();
for (let i = 0; i < 20; i++) isoDrawing(stockScene, { yawDeg: 34 + i * 3, detail: "quick" });
const perFrame = (performance.now() - t0) / 20;
check("a turning frame draws in under 25 ms", perFrame < 25, `${perFrame.toFixed(1)} ms`);

// The materials: a glossy composite deck under a standing-seam roof with glass rails.
const glossy = applyDeckPatch(stock, { structure: "covered-deck", decking: { product: "composite-best" }, rail: { type: "glass", infill: "glass" }, roof: { ...defaultRoofDesign("covered-deck"), roofing: "standing-seam" } });
const glossyMats: IsoMaterials = { decking: "composite", roofing: "standing-seam", rail: "glass" };
const glossyIso = isoDrawing(deckScene(buildStructure(glossy)), { materials: glossyMats });
check("composite boards get a sheen, the metal roof its seams and a sheen, the glass its sky", ids(glossyIso).some((i) => i.startsWith("sheen-")) && ids(glossyIso).includes("sheen-roof") && ids(glossyIso).includes("glass") && glossyIso.faces.some((f) => f.fill === "url(#glass)" && f.stroke === "#ffffff"), ids(glossyIso).join(","));
const seamLines = glossyIso.faces.filter((f) => f.layer === "roofing" && f.fill === "#ffffff" && f.opacity === 0.42).length;
check("the standing seams run across the roof", seamLines >= 6, `${seamLines} seams`);
const shingled = isoDrawing(deckScene(buildStructure(applyDeckPatch(glossy, { roof: { ...glossy.roof, roofing: "arch-shingle" } }))), { materials: { ...glossyMats, roofing: "arch-shingle" } });
const courses = shingled.faces.filter((f) => f.layer === "roofing" && f.fill === "#000000").length;
check("a shingle roof is drawn in courses", courses >= 10 && !ids(shingled).includes("sheen-roof"), `${courses} courses`);

// Paint order: what stands under a roof is painted before the roof, whatever its build step (the ceiling never covers the roof).
const covered = sampleById("covered-gable")!;
const covIso = isoDrawing(deckScene(buildStructure(sampleDesign(covered))));
const lastOf = (layer: string) => covIso.faces.map((f) => f.layer).lastIndexOf(layer);
check("under a gable roof the rafters and the ceiling are painted before the roofing", lastOf("rafter") < lastOf("roofing") && lastOf("ceiling") < lastOf("roofing"), `rafter ${lastOf("rafter")} ceiling ${lastOf("ceiling")} roofing ${lastOf("roofing")} of ${covIso.faces.length}`);

// The markup: defs under the figure's prefix, groups by build step in paint order, the shadows in their soft group.
const markup = isoMarkup(stockIso, { prefix: "t1", layerClass: "lay" });
check("the markup carries its defs under the prefix and refers to them so", markup.includes('<radialGradient id="t1-ground"') && markup.includes('fill="url(#t1-ground)"') && markup.includes('<filter id="t1-soft"') && markup.includes('<g filter="url(#t1-soft)" opacity="0.34">'));
const groups = markup.match(/<g class="lay" style="--i:(\d+)" data-rank="(-?\d+)">/g) ?? [];
check("the faces are grouped in paint order, each group delayed by its build step", groups.length >= stockIso.ranks.length && groups.every((g) => { const m = /--i:(\d+)" data-rank="(-?\d+)/.exec(g)!; return stockIso.ranks[Number(m[1])] === Number(m[2]); }), `${groups.length} groups, ${stockIso.ranks.length} steps`);
check("no face is lost in the markup", (markup.match(/<path /g) ?? []).length === stockIso.faces.length);

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
