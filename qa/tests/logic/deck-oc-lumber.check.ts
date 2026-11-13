// OC LUMBER FRAMING (2026-11-12, owner: "add that OC into the framing build, like it's a wood, or it's a OC composite
// framing, so make it smart"): a frame of Owens Corning OC Lumber is sized on the maker's own tables (Sept 2024 span
// tables, DrJ listing 2302-42), never the code's; it is built and bought the maker's way — built-up beams, the 3-ply
// 2x6 OC post, blocking every 5 ft, stainless screws, OC boards in 12/16/20 ft on their own price rows — and the
// checks, the permit notes and the proposal say whose tables those are. A wood frame is untouched. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-oc-lumber.check.ts
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckTakeoff } from "../../../src/lib/deck/takeoff";
import { deckNotes, deckScope, priceDeck } from "../../../src/lib/deck/pricing";
import { permitNotes } from "../../../src/lib/deck/permit";
import { joistMaxSpanIn } from "../../../src/lib/deck/codeTables";
import { DECKING, framingSpecies } from "../../../src/lib/deck/catalog";
import { deckingColors } from "../../../src/lib/deck/deckingColors";
import { OC_POST, OC_POST_MAX_HEIGHT_IN, ocBeamMaxSpanIn, ocJoistMaxSpanIn, ocPostMaxHeightIn } from "../../../src/lib/deck/ocLumber";
import { deckRate } from "../../../src/lib/deck/rates";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { autoFixDesign, settleDesign } from "../../../src/lib/deck/settle";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const wood = applyDeckPatch(defaultDeckDesign({ state: "WA" }), { shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36 });
const ocOf = (d: DeckDesign, more: Partial<DeckDesign["framing"]> = {}) => applyDeckPatch(d, { framing: { species: "oc-lumber", doubleRim: true, ...more } });
const oc = ocOf(wood);

// ── The maker's tables, as printed ─────────────────────────────────────────────────────────────────────────────────
check("OC joists: a 2x8 at 16 in. reaches 8'-0\" (L/360, Sept 2024), a 2x12 at 16 in. 11'-8\"", ocJoistMaxSpanIn(40, "2x8", 16) === 96 && ocJoistMaxSpanIn(40, "2x12", 16) === 140);
check("a 50 psf snow load reads the 60 psf table; 70 reads the 80", ocJoistMaxSpanIn(50, "2x10", 16) === 103 && ocJoistMaxSpanIn(70, "2x10", 16) === 93);
check("the code's species rows are not touched: treated fir 2x8 at 16 in. still 11'-1\"", joistMaxSpanIn(40, "DF", "2x8", 16) === 133);
check("OC beams: a 3-ply 2x8 under 10-ft joists, posts 6'-7\" apart; 9.5 ft reads the 10-ft column", ocBeamMaxSpanIn(40, "3-2x8", 10) === 79 && ocBeamMaxSpanIn(40, "3-2x8", 9.5) === 79);
check("OC beams: nothing past 11-ft joists, nothing for a single board", ocBeamMaxSpanIn(40, "2-2x12", 11.5) === 0 && ocBeamMaxSpanIn(40, "1-2x10", 6) === 0);
check("a heavier load never reads longer than a lighter one (the 60 psf table's 4-ft column prints longer)", ocBeamMaxSpanIn(60, "2-2x6", 4) === 61);
check("the built-up OC post: 9 ft, 5,500 lb under 2 plies, 8,250 under 3", ocPostMaxHeightIn(40, 110, 2) === OC_POST_MAX_HEIGHT_IN && ocPostMaxHeightIn(40, 111, 2) === 0 && ocPostMaxHeightIn(40, 165, 3) === OC_POST_MAX_HEIGHT_IN);

// ── The design: switching to OC sets the maker's frame ─────────────────────────────────────────────────────────────
{
  const n = normalizeDeckDesign({ ...oc, framing: { ...oc.framing, beamKind: "solid", post: "6x6", beam: "3-2x10" } });
  check("an OC frame always has the 3-ply 2x6 OC post, and its beams are built up (a built-up pick kept)", n.framing.post === OC_POST && n.framing.beam === "3-2x10" && buildStructure(n).frame!.beamKind === "built-up");
  const back = normalizeDeckDesign({ ...n, framing: { ...n.framing, species: "hem-fir", beam: "auto" } });
  check("back to wood: the OC post goes, a sawn post comes back, and the wood frame's solid beams with it", back.framing.post === "6x6" && buildStructure(back).frame!.beamKind === "solid");
  check("an OC frame shows no 'solid beams are not tabulated' note", buildStructure(n).frame!.beamKindNote === null);
}

// ── The frame ──────────────────────────────────────────────────────────────────────────────────────────────────────
const sOc = buildStructure(oc);
const sWood = buildStructure(wood);
const f = sOc.frame!;
check("the frame is read on Owens Corning's book", f.group === "OC" && f.species.id === "oc-lumber" && f.beams.every((b) => b.table === "OC"));
{
  const worst = Math.max(...f.zones.flatMap((z) => z.spansIn));
  check("every joist span is inside Owens Corning's joist table", worst <= ocJoistMaxSpanIn(f.load, f.joistSize, f.spacingIn), `${f.joistSize} @ ${f.spacingIn}: ${worst} in.`);
  check("every beam's posts are inside Owens Corning's beam table, 2- or 3-ply", f.beams.every((b) => b.maxSpanIn > 0 && b.spanIn <= b.maxSpanIn + 0.01 && b.spec.plies >= 2), f.beams.map((b) => `${b.spec.size} ${Math.round(b.spanIn)}/${b.maxSpanIn}`).join(", "));
  check("joist cantilevers inside 2 ft and a quarter of the span", f.zones.every((z) => z.frontCantIn <= Math.min(24, z.spansIn[z.spansIn.length - 1] / 4) + 0.01));
  check("the 12-ft-deep deck needs more beams in OC than in wood (it spans shorter)", f.beams.length > sWood.frame!.beams.length, `${f.beams.length} OC beam(s) vs ${sWood.frame!.beams.length} wood`);
  check("the posts are the 3-ply 2x6 OC post", f.posts.every((p) => p.size === OC_POST) && f.posts.every((p) => p.maxHeightIn === OC_POST_MAX_HEIGHT_IN));
  // Blocking every 5 ft at most: a shallower deck with ~7-ft joist spans gets a row in each.
  const f8 = buildStructure(ocOf(applyDeckPatch(wood, { shape: { kind: "rect", widthFt: 16, depthFt: 8 } }))).frame!;
  const longSpan = Math.max(...f8.zones.flatMap((z) => z.spansIn));
  check("blocking rows no more than 5 ft apart between supports", longSpan > 60 && f8.blockingRows.some((r) => r.why === "maker"), `span ${longSpan} in., ${f8.blockingRows.filter((r) => r.why === "maker").length} rows`);
  const caps = f.hardware.postCaps + f.hardware.notchedPosts;
  check("every OC post is capped (3-ply beam) or notched (2-ply beam)", caps === f.posts.filter((p) => p.heightIn >= 1).length, `${f.hardware.postCaps} caps, ${f.hardware.notchedPosts} notched`);
}

// ── What is bought ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = deckTakeoff(sOc);
  const frameLumber = t.lines.filter((l) => l.kind === "lumber" && ["framing", "ledger", "footings"].includes(l.step) && !/stair|kicker|rail/i.test(l.label));
  check("the frame is bought as OC Lumber on its own price rows", frameLumber.length > 0 && frameLumber.every((l) => l.rateKey.startsWith("oc.") && /^OC Lumber /.test(l.label)), frameLumber.filter((l) => !l.rateKey.startsWith("oc.")).map((l) => l.label).join("; "));
  check("in 12, 16 and 20 ft only", frameLumber.every((l) => / × (12|16|20) ft/.test(l.label)), frameLumber.map((l) => l.label.match(/× (\d+) ft/)?.[1]).join(","));
  const posts = t.lines.find((l) => l.id.includes("lumber-post"));
  check("the posts are bought as three 2x6 OC boards each", !!posts && /2x6/.test(posts.label) && /three boards each/.test(posts.note ?? ""), posts?.label ?? "none");
  check("stainless composite screws, never framing nails", t.lines.some((l) => l.rateKey === "hw.ocScrew3" && l.qty > 50) && t.lines.some((l) => l.rateKey === "hw.ocScrew4" && l.qty > 0) && !t.lines.some((l) => l.rateKey === "fast.framing"));
  check("the wood deck still buys treated lumber and framing nails", deckTakeoff(sWood).lines.some((l) => l.rateKey === "fast.framing") && !deckTakeoff(sWood).lines.some((l) => l.rateKey.startsWith("oc.")));
  check("OC Lumber prices at The Deck Store's 16-ft board ÷ 16 (2x8 $10.73 a foot), the market not moving it", deckRate("oc.2x8").price === 10.73);
  const pOc = priceDeck(oc);
  const pWood = priceDeck(wood);
  const fr = (p: typeof pOc) => p.lines.find((l) => l.id === "deck-framing");
  const mat = (p: typeof pOc) => (fr(p)?.materialCost ?? 0) * (fr(p)?.quantity ?? 0);
  check("the framing line costs more in OC than in wood, and names it", mat(pOc) > 2 * mat(pWood) && /OC Lumber/.test(fr(pOc)?.name ?? ""), `framing material OC $${Math.round(mat(pOc))} vs wood $${Math.round(mat(pWood))}; whole deck OC $${Math.round(pOc.subtotal)} vs wood $${Math.round(pWood.subtotal)}`);
}

// ── The checks and the paper say whose tables ──────────────────────────────────────────────────────────────────────
{
  const cs = deckChecks(sOc);
  const joist = cs.find((c) => c.id === "joist-span");
  check("the joist check cites Owens Corning's table", !!joist && /Owens Corning/.test(joist.rule ?? ""), joist?.rule);
  check("the beam checks cite Owens Corning's beam table", cs.filter((c) => /^beam-b\d/.test(c.id)).every((c) => /Owens Corning/.test(c.rule ?? "")));
  check("the posts check reads the listing's post, 9 ft and its load", cs.some((c) => c.id === "post-height" && c.level === "pass" && /three 2x6 OC/.test(c.text) && /2302-42/.test(c.rule ?? "")));
  check("a warning says to bring listing 2302-42 to the permit office", cs.some((c) => c.id === "oc-listing" && c.level === "warn"));
  check("no fail on a plain 16 x 12 OC deck", !cs.some((c) => c.level === "fail"), cs.filter((c) => c.level === "fail").map((c) => c.text).join(" | "));
  check("no treated-lumber or heartwood note on an OC frame", !cs.some((c) => c.id === "lumber-heart" || c.id === "low-contact"));
  const single = deckChecks(buildStructure(applyDeckPatch(oc, { framing: { doubleRim: false } })));
  check("single band joists on OC: a warning with the fix", single.some((c) => c.id === "oc-band" && c.fix?.patch.framing?.doubleRim === true));
  const lok = deckChecks(buildStructure(applyDeckPatch(oc, { ledger: { fastener: "ledgerlok" } })));
  check("LedgerLOK into an OC ledger: a warning back to lags", lok.some((c) => c.id === "oc-ledger" && c.fix?.patch.ledger?.fastener === "lag"));
  const tall = deckChecks(buildStructure(applyDeckPatch(oc, { heightIn: 140 })));
  check("posts past 9 ft fail, the way back to wood offered — a choice, never applied by itself", tall.some((c) => c.id === "post-oc-tall" && c.level === "fail" && !c.fix && c.alts?.[0]?.label === "Frame it in wood"));
  const tallOc = applyDeckPatch(oc, { heightIn: 140 });
  check("settling or auto-fixing a too-tall OC deck never switches it to wood", settleDesign(tallOc).design.framing.species === "oc-lumber" && autoFixDesign(tallOc).design.framing.species === "oc-lumber");
  const notes = permitNotes(sOc).join("\n");
  check("the permit notes name Owens Corning's tables and the listing, not AWPA treatment", /OC Lumber/.test(notes) && /2302-42/.test(notes) && !/Preservative-treated per AWPA/.test(notes));
  check("the wood deck's permit notes are the code's", /Preservative-treated per AWPA/.test(permitNotes(sWood).join("\n")));
  const pkg = priceDeck(oc);
  const words = [...deckScope(pkg), ...deckNotes(pkg)].join(" ");
  check("the proposal says it is OC Lumber, sized on Owens Corning's tables", /Owens Corning OC Lumber/.test(words) && /span tables/.test(words), words.slice(0, 120));
}

// ── Sizes across the range: never a joist or beam past the maker's table when the studio sizes it ─────────────────
{
  let n = 0, out = 0;
  const notes: string[] = [];
  for (const W of [10, 12, 16, 20, 24]) for (const D of [8, 10, 12, 14, 16]) for (const placement of ["attached", "detached"] as const) for (const load of [40, 60] as const) {
    const d = ocOf(applyDeckPatch(defaultDeckDesign({ state: "WA" }), { shape: { kind: "rect", widthFt: W, depthFt: D }, heightIn: 48, placement, loadPsf: load }));
    const fr = buildStructure(d).frame!;
    n++;
    const worst = Math.max(...fr.zones.flatMap((z) => z.spansIn));
    const okJ = worst <= ocJoistMaxSpanIn(load, fr.joistSize, fr.spacingIn);
    const okB = fr.beams.every((b) => b.maxSpanIn > 0 && b.spanIn <= b.maxSpanIn + 0.01);
    if (!okJ || !okB) {
      out++;
      if (notes.length < 4) notes.push(`${W}x${D} ${placement} ${load}`);
    }
  }
  check("40 sizes x 2 placements x 2 loads: every OC frame inside Owens Corning's joist and beam tables", out === 0, `${out} of ${n} out${notes.length ? ": " + notes.join(", ") : ""}`);
}

// ── A roof over an OC deck stays sawn wood ─────────────────────────────────────────────────────────────────────────
{
  const covered = applyDeckPatch(oc, { structure: "covered-deck" });
  const s = buildStructure(covered);
  check("a roof over an OC deck is framed in the region's treated lumber", !!s.roof && s.roof.species.group !== "OC" && s.frame?.group === "OC", s.roof?.species.short);
}

// ── The Owens Corning boards ───────────────────────────────────────────────────────────────────────────────────────
{
  const b = DECKING.find((d) => d.id === "oc-marine-54x6");
  check("Owens Corning Marine Grade boards: joists up to 24 in. apart, six colours", !!b && b.maxSpacingIn.square === 24 && deckingColors("oc-marine-54x6").length === 6 && deckingColors("oc-marine-2x6").length === 6);
  const s = buildStructure(applyDeckPatch(oc, { decking: { product: "oc-marine-54x6", color: "gobi" }, framing: { spacingIn: 24 } }));
  check("on those boards the joists may go 24 in. apart", s.frame!.spacingIn === 24 && !deckChecks(s).some((c) => c.id === "joist-spacing" && c.level === "fail"));
  check("the colour rides with the board's name", /Gobi/.test(s.frame!.decking.label), s.frame!.decking.label);
}

// ── Voice ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const cmds = parseUtterance("frame it in OC lumber", { design: wood, subject: null }).clauses.flatMap((c) => c.cmds);
  const cmd = cmds.find((c) => c.do === "framing");
  check("\"frame it in OC lumber\" picks the OC framing", !!cmd && cmd.do === "framing" && cmd.set.species === "oc-lumber", JSON.stringify(cmds));
  check("framingSpecies knows OC", framingSpecies("oc-lumber").material === "composite");
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
