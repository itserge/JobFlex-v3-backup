// The Deck Studio's engine (lib/deck/*, 2026-10-04): the code tables as
// printed, the framing a design gets, the material package, the price, the
// code-check strip and the 3D scene data. The printed numbers below were
// typed from the 2021 International Residential Code (Section R507), AWC's
// DCA 6 guide (Table 3A, Table 5) and the screw makers' tables — not copied
// from the engine — so a slip in the generated tables shows up here.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-engine.check.ts
import { BEAM_ROWS, FOOTING_ROWS, JOIST_ROWS, LEDGER_ROWS, POST_ROWS } from "../../../src/lib/deck/codeTables.data";
import {
  builtUpBeamMaxSpanIn,
  effectiveJoistSpanFt,
  footingMinSize,
  ftIn,
  joistMaxCantileverIn,
  joistMaxSpanIn,
  joistSpanFactor,
  ledgerSpacingIn,
  LOADS,
  postMaxHeightIn,
  risersFor,
  solidBeamMaxSpanIn,
  woodDeckingMaxSpacingIn,
  type LoadPsf,
  type SpeciesGroup,
} from "../../../src/lib/deck/codeTables";
import { DECKING, FRAMING_SPECIES, WALL_TYPES, defaultDecking, defaultFramingSpecies, deckingProduct } from "../../../src/lib/deck/catalog";
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, shapeAreaSqFt, shapeEdges, shapeOutline, shapeZones, sizeWords, type DeckDesign } from "../../../src/lib/deck/design";
import { autoOverhangIn, buildDeckFrame, layoutPosts, splitRun, supportShares, STOCK_MAX_IN } from "../../../src/lib/deck/frame";
import { deckSurface, planRow } from "../../../src/lib/deck/surface";
import { deckTakeoff, packPieces, stockFor } from "../../../src/lib/deck/takeoff";
import { DECK_RATES, deckRate, sanitizeDeckRateBook } from "../../../src/lib/deck/rates";
import { deckNotes, deckScope, priceDeck } from "../../../src/lib/deck/pricing";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, checkSummary, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene, parseDeckScene, SCENE_LAYERS } from "../../../src/lib/deck/scene";

/** A bare deck always has a frame and boards; the harness says so once. */
const framed = <T,>(v: T | null): T => {
  if (v === null) throw new Error("expected a deck frame");
  return v;
};
import { deckConvertSchema, parseDeckPlan } from "../../../src/lib/deck/convertSchema";
import { resolveMarket } from "../../../src/lib/fence/market";

/** The checks of a design, built whole (M3: the checks read the structure, not a frame). */
const checksOf = (d: DeckDesign) => deckChecks(buildStructure(d));

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const fi = (ft: number, inch: number) => ft * 12 + inch;
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const GROUPS: SpeciesGroup[] = ["SP", "DF", "RW"];

console.log("── the code's tables, as printed");
check("joists, 40 psf: Southern pine 2x8 at 12/16/24 in. spans 13-1 / 11-10 / 9-8", same(JOIST_ROWS[40].SP["2x8"].span, [fi(13, 1), fi(11, 10), fi(9, 8)]));
check("joists, 40 psf: Douglas fir group 2x10 spans 15-8 / 13-7 / 11-1; 2x6 9-6 / 8-4 / 6-10", same(JOIST_ROWS[40].DF["2x10"].span, [fi(15, 8), fi(13, 7), fi(11, 1)]) && same(JOIST_ROWS[40].DF["2x6"].span, [fi(9, 6), fi(8, 4), fi(6, 10)]));
check("joists, 40 psf: redwood group 2x12 spans 17-5 / 15-1 / 12-4", same(JOIST_ROWS[40].RW["2x12"].span, [fi(17, 5), fi(15, 1), fi(12, 4)]));
check("joists under snow: Southern pine 2x10 at 16 in. goes 14-0 → 13-9 → 12-9 → 11-11", joistMaxSpanIn(40, "SP", "2x10", 16) === 168 && joistMaxSpanIn(50, "SP", "2x10", 16) === 165 && joistMaxSpanIn(60, "SP", "2x10", 16) === 153 && joistMaxSpanIn(70, "SP", "2x10", 16) === 143);
check("joists, 70 psf: redwood group 2x8 9-8 / 8-10 / 7-4", same(JOIST_ROWS[70].RW["2x8"].span, [fi(9, 8), fi(8, 10), fi(7, 4)]));
check("cantilever row: Southern pine 2x10, back spans 4…18 ft → 1-0 1-6 2-0 2-6 3-0 3-4 3-4 NP", same(JOIST_ROWS[40].SP["2x10"].cant, [12, 18, 24, 30, 36, 40, 40, 0]));
check("cantilever row: Douglas fir group 2x8 → 1-0 1-6 2-0 2-3 2-0 NP NP NP", same(JOIST_ROWS[40].DF["2x8"].cant, [12, 18, 24, 27, 24, 0, 0, 0]));
check("beams, 40 psf: Southern pine 2-2x10 → 10-4 9-0 8-0 7-4 6-9 6-4 6-0", same(BEAM_ROWS[40].SP["2-2x10"], [fi(10, 4), fi(9, 0), fi(8, 0), fi(7, 4), fi(6, 9), fi(6, 4), fi(6, 0)]));
check("beams, 40 psf: Douglas fir group 3-2x12 → 14-6 12-7 11-3 10-3 9-6 8-11 8-5", same(BEAM_ROWS[40].DF["3-2x12"], [fi(14, 6), fi(12, 7), fi(11, 3), fi(10, 3), fi(9, 6), fi(8, 11), fi(8, 5)]));
check("beams, 70 psf: redwood group 2-2x8 → 6-8 5-9 5-2 4-8 4-2 3-10 3-6", same(BEAM_ROWS[70].RW["2-2x8"], [fi(6, 8), fi(5, 9), fi(5, 2), fi(4, 8), fi(4, 2), fi(3, 10), fi(3, 6)]));
check("the three cells misprinted in the 2021 text carry the 2024 values (6-4, 6-11, 5-10)", BEAM_ROWS[50].RW["3-2x8"][4] === fi(6, 4) && BEAM_ROWS[60].RW["3-2x8"][2] === fi(6, 11) && BEAM_ROWS[60].RW["3-2x8"][4] === fi(5, 10));
check("the row both editions print oddly is kept as printed: 1-2x12 Douglas fir at 16 and 18 ft = 3-9, 3-6", BEAM_ROWS[40].DF["1-2x12"][5] === fi(3, 9) && BEAM_ROWS[40].DF["1-2x12"][6] === fi(3, 6));
check("posts, 40 psf: Southern pine 4x4 → 14-0 13-8 11-0 9-5 8-4 7-5 6-9 6-2", same(POST_ROWS[40].SP["4x4"], [168, fi(13, 8), fi(11, 0), fi(9, 5), fi(8, 4), fi(7, 5), fi(6, 9), fi(6, 2)]));
check("posts, 40 psf: redwood 6x6 holds 14-0 to 120 sq ft, then 13-7 and 9-7; redwood 4x4 is NP from 120", same(POST_ROWS[40].RW["6x6"], [168, 168, 168, 168, 168, 168, fi(13, 7), fi(9, 7)]) && same(POST_ROWS[40].RW["4x4"].slice(5), [0, 0, 0]));
check("posts, 70 psf: Douglas fir group 6x6 → … 12-2 9-9 5-9 at 120/140/160", same(POST_ROWS[70].DF["6x6"].slice(5), [fi(12, 2), fi(9, 9), fi(5, 9)]));
check("footings, 40 psf on 1,500 psf soil: 60 sq ft → 17 sq / 19 round / 6 thick; 100 → 22 / 25 / 8; 160 → 28 / 31 / 11", same(FOOTING_ROWS[40][3].s1500, [17, 19, 6]) && same(FOOTING_ROWS[40][5].s1500, [22, 25, 8]) && same(FOOTING_ROWS[40][8].s1500, [28, 31, 11]));
check("footings, 70 psf: 160 sq ft → 35 / 40 / 15 on 1,500 psf, 25 / 28 / 9 on 3,000 psf", same(FOOTING_ROWS[70][8].s1500, [35, 40, 15]) && same(FOOTING_ROWS[70][8].s3000, [25, 28, 9]));
check("ledger, 40 psf: lags 30 23 18 15 13 11 10; bolts 36 36 34 29 24 21 19; spaced-off bolts 36 36 29 24 21 18 16", same(LEDGER_ROWS[40].map((r) => r[1]), [30, 23, 18, 15, 13, 11, 10]) && same(LEDGER_ROWS[40].map((r) => r[2]), [36, 36, 34, 29, 24, 21, 19]) && same(LEDGER_ROWS[40].map((r) => r[3]), [36, 36, 29, 24, 21, 18, 16]));
check("ledger, 70 psf: lags 22 16 13 11 9 8 7", same(LEDGER_ROWS[70].map((r) => r[1]), [22, 16, 13, 11, 9, 8, 7]));
{
  // Shape: every table whole, every row falling the way wood does.
  let whole = true;
  let falls = true;
  for (const load of LOADS) {
    for (const g of GROUPS) {
      for (const size of ["2x6", "2x8", "2x10", "2x12"] as const) {
        const r = JOIST_ROWS[load][g][size];
        whole = whole && r.span.length === 3 && r.cant.length === 8;
        falls = falls && r.span[0] >= r.span[1] && r.span[1] >= r.span[2];
        if (load > 40) falls = falls && r.span.every((v, i) => v <= JOIST_ROWS[(load - 10) as LoadPsf][g][size].span[i]);
      }
      for (const row of Object.values(BEAM_ROWS[load][g])) {
        whole = whole && row.length === 7 && row.every((v) => v > 0);
        falls = falls && row.every((v, i) => i === 0 || v <= row[i - 1]);
      }
      for (const row of Object.values(POST_ROWS[load][g])) {
        whole = whole && row.length === 8;
        falls = falls && row.every((v, i) => i === 0 || v <= row[i - 1]);
      }
    }
    whole = whole && FOOTING_ROWS[load].length === 9 && LEDGER_ROWS[load].length === 7;
    falls = falls && FOOTING_ROWS[load].every((r, i, all) => i === 0 || (r.s1500[0] >= all[i - 1].s1500[0] && r.s1500[1] >= all[i - 1].s1500[1]));
    falls = falls && LEDGER_ROWS[load].every((r, i, all) => i === 0 || (r[1] <= all[i - 1][1] && r[2] <= all[i - 1][2]));
  }
  check("every table is whole: 4 loads × 3 species, 12 beams, 4 joists, 4 posts, 9 footing rows, 7 ledger rows", whole);
  check("every row falls the way wood does: wider spacing, more load, longer joists and bigger areas never allow more", falls);
}

console.log("── reading the tables");
check("joist span: a lookup is the printed cell", joistMaxSpanIn(40, "DF", "2x8", 16) === fi(11, 1) && joistMaxSpanIn(60, "DF", "2x12", 24) === fi(11, 8));
check("cantilever: on a column it is the cell; between two it is in proportion, rounded down", joistMaxCantileverIn(40, "DF", "2x8", 10) === 27 && joistMaxCantileverIn(40, "DF", "2x8", 9) === 25 && joistMaxCantileverIn(40, "SP", "2x10", 13) === 38);
check("cantilever: a stretch that reaches a 'not permitted' cell has no number; past the table none", joistMaxCantileverIn(40, "SP", "2x8", 13) === 0 && joistMaxCantileverIn(40, "SP", "2x8", 12) === 27 && joistMaxCantileverIn(40, "SP", "2x12", 19) === 0);
check("cantilever: under a 4-ft back span it stays a quarter of the span", joistMaxCantileverIn(40, "SP", "2x8", 3) === 9 && joistMaxCantileverIn(40, "SP", "2x8", 4) === 12);
check("joist span factors: 0.66 with no cantilever, 0.72 / 0.80 / 0.84 / 0.90 up the staircase, 1.00 at a quarter", joistSpanFactor(0, 12) === 0.66 && joistSpanFactor(1, 12) === 0.72 && joistSpanFactor(1.2, 12) === 0.8 && joistSpanFactor(1.5, 12) === 0.84 && joistSpanFactor(2, 12) === 0.9 && joistSpanFactor(3, 12) === 1);
check("a ratio between two rows takes the row above (1 ft on 14 ft reads 1/12)", joistSpanFactor(1, 14) === 0.72 && joistSpanFactor(0.01, 12) === 0.72);
check("effective joist span: 12 ft with no cantilever enters the beam table at 7.92 ft", near(effectiveJoistSpanFt(12, 0), 7.92));
check("built-up beam: on a column the cell; between columns in proportion; under 6 ft the 6-ft column; past 18 ft nothing", builtUpBeamMaxSpanIn(40, "SP", "2-2x10", 12) === 88 && builtUpBeamMaxSpanIn(40, "SP", "2-2x10", 9) === 102 && builtUpBeamMaxSpanIn(40, "SP", "2-2x10", 4) === 124 && builtUpBeamMaxSpanIn(40, "SP", "2-2x10", 18.5) === 0);
check("the 2024 code's own columns agree: 12-ft joists with no cantilever on a Southern pine 2-2x10 → 9-0 (its '12 & 0' column)", builtUpBeamMaxSpanIn(40, "SP", "2-2x10", effectiveJoistSpanFt(12, 0)) >= fi(9, 0) && builtUpBeamMaxSpanIn(40, "SP", "2-2x10", effectiveJoistSpanFt(12, 0)) <= fi(9, 1));
check("solid beams (AWC DCA 6 Table 3A), 12-ft joists: 4x6 4-3, 4x8 5-8, 4x10 6-9, 4x12 7-10", solidBeamMaxSpanIn(40, "DF", "4x6", 12) === fi(4, 3) && solidBeamMaxSpanIn(40, "DF", "4x8", 12) === fi(5, 8) && solidBeamMaxSpanIn(40, "DF", "4x10", 12) === fi(6, 9) && solidBeamMaxSpanIn(40, "DF", "4x12", 12) === fi(7, 10));
check("solid beams, 8-ft joists: 5-3 / 7-0 / 8-4 / 9-8; 18-ft: 3-5 / 4-7 / 5-5 / 6-4", solidBeamMaxSpanIn(40, "RW", "4x6", 8) === fi(5, 3) && solidBeamMaxSpanIn(40, "RW", "4x12", 8) === fi(9, 8) && solidBeamMaxSpanIn(40, "DF", "4x6", 18) === fi(3, 5) && solidBeamMaxSpanIn(40, "DF", "4x12", 18) === fi(6, 4));
check("solid beams: a span between two columns reads the next one up (11 ft reads 12)", solidBeamMaxSpanIn(40, "DF", "4x8", 11) === fi(5, 8) && solidBeamMaxSpanIn(40, "DF", "4x8", 10) === fi(6, 3));
check("solid beams are NOT stretched: nothing for Southern pine, nothing under a snow load, nothing past 18 ft", solidBeamMaxSpanIn(40, "SP", "4x12", 8) === 0 && solidBeamMaxSpanIn(50, "DF", "4x12", 8) === 0 && solidBeamMaxSpanIn(40, "DF", "4x12", 19) === 0);
check("posts: the cell, the proportion between cells, 'not permitted' poisoning the stretch that reaches it, nothing past 160 sq ft", postMaxHeightIn(40, "SP", "4x4", 60) === 132 && postMaxHeightIn(40, "SP", "4x4", 50) === 148 && postMaxHeightIn(40, "RW", "4x4", 110) === 0 && postMaxHeightIn(40, "RW", "4x4", 100) === 68 && postMaxHeightIn(40, "SP", "6x6", 161) === 0);
check("posts: under 20 sq ft reads the 20 column", postMaxHeightIn(70, "RW", "4x4", 5) === 168);
{
  const f = footingMinSize(40, 50, 1500);
  check("footings: 50 sq ft sits between the 40 and 60 rows, rounded up to the inch → 16 sq / 18 round / 6", !!f && f.squareIn === 16 && f.roundIn === 18 && f.thickIn === 6, JSON.stringify(f));
  check("footings: past 160 sq ft there is no answer; under 5 sq ft the first row", footingMinSize(40, 161, 1500) === null && footingMinSize(40, 2, 1500)?.roundIn === 8);
  check("footings: better soil, smaller footing (100 sq ft: 25 → 21 → 17 in. round)", footingMinSize(40, 100, 1500)?.roundIn === 25 && footingMinSize(40, 100, 2000)?.roundIn === 21 && footingMinSize(40, 100, 3000)?.roundIn === 17);
}
const lag = (load: LoadPsf, span: number) => ledgerSpacingIn({ load, fastener: "lag", joistSpanFt: span, rim: "lumber" }).spacingIn;
check("ledger lags: the cell on a row, the proportion between rows (11 ft → 16 in.), the first row under 6 ft", lag(40, 12) === 15 && lag(40, 11) === 16 && lag(40, 4) === 30 && lag(60, 10) === 15);
check("ledger: a joist past 18 ft is past the table", lag(40, 18.5) === 0 && lag(40, 18) === 10);
check("ledger bolts: 34 in. at 10 ft; spaced off the wall 29 in.", ledgerSpacingIn({ load: 40, fastener: "bolt", joistSpanFt: 10, rim: "lumber" }).spacingIn === 34 && ledgerSpacingIn({ load: 40, fastener: "bolt-gap", joistSpanFt: 10, rim: "lumber" }).spacingIn === 29);
{
  const ll = (load: LoadPsf, span: number, rim: "lumber" | "engineered" = "lumber", hemFir = false) => ledgerSpacingIn({ load, fastener: "ledgerlok", joistSpanFt: span, rim, hemFirLedger: hemFir }).spacingIn;
  check("LedgerLOK (maker's table), 40 psf on 2x lumber: 24 18 14 12 10 9 8 — closer than lags", same([6, 8, 10, 12, 14, 16, 18].map((s) => ll(40, s)), [24, 18, 14, 12, 10, 9, 8]));
  check("LedgerLOK: a hem-fir ledger 20 15 12 10 8 7 6; an engineered rim 25 19 15 12 10 9 8", same([6, 8, 10, 12, 14, 16, 18].map((s) => ll(40, s, "lumber", true)), [20, 15, 12, 10, 8, 7, 6]) && same([6, 8, 10, 12, 14, 16, 18].map((s) => ll(40, s, "engineered")), [25, 19, 15, 12, 10, 9, 8]));
  check("LedgerLOK: 60 psf 17 13 10 8 7 6 5; a 50 psf snow load reads the 60 rows; 70 psf is not printed; 'up to' columns step up", same([6, 8, 10, 12, 14, 16, 18].map((s) => ll(60, s)), [17, 13, 10, 8, 7, 6, 5]) && ll(50, 10) === 10 && ll(70, 10) === 0 && ll(40, 9) === 14);
  const sd = (load: LoadPsf, span: number, rim: "lumber" | "engineered" = "lumber") => ledgerSpacingIn({ load, fastener: "sdws", joistSpanFt: span, rim }).spacingIn;
  check("Simpson SDWS (maker's table), 40 psf: 22 16 13 11 9 8 7 on lumber, 14 10 8 7 6 5 5 on a 1-in. rim", same([6, 8, 10, 12, 14, 16, 18].map((s) => sd(40, s)), [22, 16, 13, 11, 9, 8, 7]) && same([6, 8, 10, 12, 14, 16, 18].map((s) => sd(40, s, "engineered")), [14, 10, 8, 7, 6, 5, 5]));
  check("Simpson SDWS, 60 psf: 15 12 9 8 7 6 5; no number for an 18-ft joist on a 1-in. rim", same([6, 8, 10, 12, 14, 16, 18].map((s) => sd(60, s)), [15, 12, 9, 8, 7, 6, 5]) && sd(60, 18, "engineered") === 0);
  const er = ledgerSpacingIn({ load: 40, fastener: "lag", joistSpanFt: 12, rim: "engineered" });
  check("an engineered rim takes the tighter of the code and AWC's Table 5 (12 in. at a 12-ft joist, not 15)", er.spacingIn === 12 && /DCA 6/.test(er.rule), `${er.spacingIn} ${er.rule}`);
}
check("wood decking: 5/4 boards on joists 16 in. apart, 12 in. on the diagonal; 2x boards 24 in.", woodDeckingMaxSpacingIn("5/4", false) === 16 && woodDeckingMaxSpacingIn("5/4", true) === 12 && woodDeckingMaxSpacingIn("2x", true) === 24);
check("stairs: 36 in. takes 5 risers, 7 3/4 in. takes 1, 8 ft takes 13", risersFor(36) === 5 && risersFor(7.75) === 1 && risersFor(96) === 13 && risersFor(0) === 0);
check("a tape reads 88 in. as 7'-4\"", ftIn(88) === "7'-4\"" && ftIn(168) === "14'-0\"");

console.log("── the catalog");
// 2026-11-12: Owens Corning OC Lumber joined as the ninth — a composite read on the maker's own tables ("OC"), never the code's.
check("eight wood framing species, each on one of the code's three rows; only redwood and cedar heart are untreated — and OC Lumber, a composite on Owens Corning's tables", FRAMING_SPECIES.length === 9 && FRAMING_SPECIES.filter((s) => s.material === "wood").length === 8 && FRAMING_SPECIES.filter((s) => s.material === "wood").every((s) => (GROUPS as readonly string[]).includes(s.group)) && FRAMING_SPECIES.filter((s) => s.material === "composite").map((s) => `${s.id}:${s.group}`).join() === "oc-lumber:OC" && FRAMING_SPECIES.filter((s) => !s.treated && s.material === "wood").map((s) => s.id).join() === "redwood,western-cedar");
check("the West frames in hem-fir, everywhere else in Southern pine", defaultFramingSpecies("WA") === "hem-fir" && defaultFramingSpecies("ut") === "hem-fir" && defaultFramingSpecies("TX") === "southern-pine" && defaultFramingSpecies(null) === "southern-pine");
check("decking: every board has a width, a price above zero, stock lengths and a joist spacing no wider than 24 in.", DECKING.length >= 28 && DECKING.every((d) => d.widthIn > 0 && d.thickIn > 0 && d.pricePerLf > 0 && d.lengthsFt.length > 0 && d.maxSpacingIn.square <= 24 && d.maxSpacingIn.diagonal <= d.maxSpacingIn.square));
check("decking ids are unique, and an unknown id falls back to the first board", new Set(DECKING.map((d) => d.id)).size === DECKING.length && deckingProduct("no-such-board").id === DECKING[0].id);
check("sawn wood reads the code's table: 5/4 → 16 / 12 in., 2x6 → 24 in.", deckingProduct("pt-pine-54").maxSpacingIn.square === 16 && deckingProduct("pt-pine-54").maxSpacingIn.diagonal === 12 && deckingProduct("cedar-2x6").maxSpacingIn.square === 24 && deckingProduct("pt-pine-54").source === "code");
check("PVC carries its maker's blocking rule (rows no more than 6 ft apart)", deckingProduct("pvc").blockingRowsMaxFt === 6);
// 2026-10-12 (lib/deck/regional): the Pacific coast and Hawaii start on capped composite — treated decking is a small
// share of what is built there; the Mountain states and Alaska keep the treated 2x6, the East the 5/4 pine.
check("a new deck starts on the region's board: treated 2x6 in the Mountain states, composite on the Pacific coast, 5/4 pine in the East", defaultDecking("UT") === "pt-hemfir-2x6" && defaultDecking("OR") === "composite-better" && defaultDecking("GA") === "pt-pine-54" && defaultDecking(null) === "pt-pine-54");
check("ten walls: a ledger on wood or concrete, none on veneer, hollow block, an overhang, truss ribbons, SIPs, or framing nobody can see", WALL_TYPES.length === 10 && WALL_TYPES.filter((w) => w.ledger).map((w) => w.id).join() === "wood-rim,engineered-rim,foam-sheathing,concrete" && WALL_TYPES.filter((w) => w.ledger).every((w) => w.fasteners.length > 0));

console.log("── a design, brought inside its rails");
// The worked examples below were figured on treated hem-fir 2x6 boards — Washington's starting board until 2026-10-12,
// when the Pacific coast began on composite (lib/deck/regional; checked in deck-brands-regional). The board is pinned.
const WA0 = defaultDeckDesign({ state: "WA", frostIn: 18 });
const WA = { ...WA0, decking: { ...WA0.decking, product: "pt-hemfir-2x6" } };
const TX = defaultDeckDesign({ state: "TX", frostIn: 6 });
check("a new deck: 16 x 12, on the house, 36 in. up, 40 psf, the owner's standards (6x6 posts, doubled rim, joist tape, solid beams, lags, poured footings)", WA.shape.kind === "rect" && WA.shape.widthFt === 16 && WA.shape.depthFt === 12 && WA.placement === "attached" && WA.heightIn === 36 && WA.loadPsf === 40 && WA.framing.post === "6x6" && WA.framing.doubleRim && WA.framing.joistTape && WA.framing.beamKind === "solid" && WA.ledger.fastener === "lag" && WA.footing.type === "poured" && WA.decking.diagonal === false);
check("garbage in, a buildable deck out", JSON.stringify(normalizeDeckDesign(null)) === JSON.stringify(defaultDeckDesign()) && normalizeDeckDesign({ shape: { kind: "rect", widthFt: "abc", depthFt: -4 }, heightIn: NaN, loadPsf: 45, framing: { joist: "2x14", post: "9x9" } }).framing.post === "6x6");
check("numbers are held inside their rails (width 4–60 ft, depth 4–40 ft, height 4–360 in.)", normalizeDeckDesign({ shape: { kind: "rect", widthFt: 900, depthFt: 1 }, heightIn: 9999 }).shape.widthFt === 60 && normalizeDeckDesign({ shape: { kind: "rect", widthFt: 900, depthFt: 1 } }).shape.depthFt === 4 && normalizeDeckDesign({ heightIn: 9999 }).heightIn === 360);
check("a ledger on brick veneer becomes a deck beside the house", normalizeDeckDesign({ ...WA, wall: "brick-veneer" }).placement === "beside" && normalizeDeckDesign({ ...WA, wall: "wood-rim" }).placement === "attached");
check("a fastener the wall has no table for becomes the wall's first (concrete → anchors, foam → spaced bolts)", normalizeDeckDesign({ ...WA, wall: "concrete" }).ledger.fastener === "anchor" && normalizeDeckDesign({ ...WA, wall: "foam-sheathing", ledger: { fastener: "ledgerlok", lateral: "two" } }).ledger.fastener === "bolt-gap");
check("a beam size of the other kind is dropped (a 2-2x10 is not a solid beam)", normalizeDeckDesign({ ...WA, framing: { ...WA.framing, beamKind: "solid", beam: "2-2x10" } }).framing.beam === "auto" && normalizeDeckDesign({ ...WA, framing: { ...WA.framing, beamKind: "built-up", beam: "2-2x10" } }).framing.beam === "2-2x10");
{
  const L = normalizeDeckDesign({ ...WA, shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } });
  const zones = shapeZones(L.shape);
  check("an L is two rectangles: 14 x 16 and 10 x 10 for a 10 x 6 notch out of 24 x 16", zones.length === 2 && zones[0].x1 - zones[0].x0 === 168 && zones[0].y1 === 192 && zones[1].x1 - zones[1].x0 === 120 && zones[1].y1 === 120);
  check("its area is the rectangle less the notch (324 sq ft), its outline has six corners", shapeAreaSqFt(L.shape) === 324 && shapeOutline(L.shape).length === 6);
  const edges = shapeEdges(L.shape, "attached");
  check("its sides: 24 ft on the house, 56 ft open", near(edges.filter((e) => e.house).reduce((a, e) => a + e.lengthIn, 0), 288) && near(edges.filter((e) => !e.house).reduce((a, e) => a + e.lengthIn, 0), 56 * 12));
  const bump = normalizeDeckDesign({ ...WA, shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "back-left", widthFt: 8, depthFt: 4 } } });
  const be = shapeEdges(bump.shape, "attached");
  check("a back notch is the house stepping into the deck: 28 ft against the house (16 + 8 + the 4-ft return)", near(be.filter((e) => e.house).reduce((a, e) => a + e.lengthIn, 0), 28 * 12) && near(be.filter((e) => !e.house).reduce((a, e) => a + e.lengthIn, 0), 52 * 12));
  check("a detached deck has no house side at all", shapeEdges(L.shape, "detached").every((e) => !e.house));
  const tight = normalizeDeckDesign({ ...WA, shape: { kind: "L", widthFt: 10, depthFt: 10, notch: { corner: "front-left", widthFt: 30, depthFt: 30 } } });
  check("a notch never eats a leg: each keeps 3 ft", tight.shape.kind === "L" && tight.shape.notch.widthFt === 7 && tight.shape.notch.depthFt === 7);
  check("a rectangle too small for an L stays a rectangle", normalizeDeckDesign({ ...WA, shape: { kind: "L", widthFt: 4, depthFt: 4, notch: { corner: "front-left", widthFt: 2, depthFt: 2 } } }).shape.kind === "rect");
  check("the size in words", sizeWords(WA) === "16 ft × 12 ft" && sizeWords(L) === "24 ft × 16 ft L-shaped" && sizeWords(normalizeDeckDesign({ ...WA, shape: { kind: "rect", widthFt: 15.5, depthFt: 12 } })) === "15'-6\" × 12 ft");
}

console.log("── a member on its supports");
{
  const two = supportShares([0, 10, 20], 0, 20, true);
  check("an unbroken joist over a middle beam puts 1.25 spans on it; cut joists put 1", near(two[1], 12.5) && near(supportShares([0, 10, 20], 0, 20, false)[1], 10));
  check("the ends never carry less than their cut share (0.5 of a span each)", near(two[0], 5) && near(two[2], 5));
  const over = supportShares([0, 10], 0, 12, false);
  check("a span with an overhang: (L² − c²)/2L on the back support, (L + c)²/2L on the front", near(over[0], (100 - 4) / 20) && near(over[1], 144 / 20));
  const sum = supportShares([2, 9, 16, 22], 0, 24, false).reduce((a, v) => a + v, 0);
  check("cut over its supports, the shares add up to the member's length", near(sum, 24));
  const three = supportShares([0, 10, 20, 30], 0, 30, true);
  check("three equal spans, unbroken: 1.1 spans on each inner support", near(three[1], 11) && near(three[2], 11));
  check("one support carries it all; none carries nothing", near(supportShares([5], 0, 12, true)[0], 12) && supportShares([], 0, 12, true).length === 0);
}
check("posts along a 16-ft beam that spans 7-5: three, set in 12 in., 7 ft apart", JSON.stringify(layoutPosts(192, 89, "dropped")) === JSON.stringify({ count: 3, endIn: 12, spanIn: 84 }));
{
  const p = layoutPosts(192, 81, "dropped");
  check("a beam may run past its end posts to save one: 16 ft at a 6-9 span is 3 posts with 15-in. ends, not 4", p.count === 3 && p.endIn === 15 && p.spanIn === 81 && p.endIn <= p.spanIn / 4);
  const q = layoutPosts(192, 75, "dropped");
  check("…but never more than a quarter of the span: at 6-3 it takes the fourth post", q.count === 4 && q.endIn === 12);
  check("a flush beam's posts sit at its ends", layoutPosts(144, 81, "flush").endIn === 3 && layoutPosts(144, 81, "flush").count === 3);
}
check("a 24-ft run is two 12s, cut on a joist; a run that fits one stick is one", JSON.stringify(splitRun(0, 288, [16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 272])) === JSON.stringify([[0, 144], [144, 288]]) && splitRun(0, 240, [100]).length === 1);
check("the default overhang: a fifth of the depth to the half foot, 2 ft at most", autoOverhangIn(144) === 24 && autoOverhangIn(96) === 18 && autoOverhangIn(72) === 12 && autoOverhangIn(48) === 6 && autoOverhangIn(300) === 24);

console.log("── the frame of the owner's default deck (Washington, 16 x 12, 36 in. up)");
const fWA = buildDeckFrame(WA);
{
  const z = fWA.zones[0];
  check("treated hem-fir, 2x8 joists at 16 in., one dropped beam 2 ft in from the edge", fWA.species.id === "hem-fir" && fWA.joistSize === "2x8" && fWA.spacingIn === 16 && fWA.beamStyle === "dropped" && fWA.beams.length === 1 && z.beamYs[0] === 120);
  check("the joists span 9'-9\" face to face and run 1'-10 1/2\" past the beam", z.spansIn[0] === 117 && z.frontCantIn === 22.5 && z.ok);
  const b = fWA.beams[0];
  check("the beam is a solid 4x10 read from AWC's table at a 9.75-ft joist: 7'-5\" allowed, 3 posts 7 ft apart", b.spec.size === "4x10" && b.table === "DCA6" && near(b.tableSpanFt, 9.75) && b.maxSpanIn === 89 && b.postXs.length === 3 && b.spanIn === 84 && b.endIn === 12);
  check("a 4x10 on 3 posts costs less than a 4x8 on 4 — the engine weighs the beam against the footing", b.spec.size === "4x10");
  check("levels: surface 36 in., joists 34.5 → 27.25 in., beam down to 18 in., posts 15 in. tall on footings 3 in. proud", fWA.surfaceIn === 36 && fWA.joistTopIn === 34.5 && fWA.joistBottomIn === 27.25 && b.bottomIn === 18 && fWA.posts.every((p) => p.heightIn === 15));
  const mid = fWA.posts[1];
  check("the middle post carries 50 sq ft; the three together carry the deck less the ledger's share", near(mid.tributarySqFt, 50, 0.02) && near(fWA.posts.reduce((a, p) => a + p.tributarySqFt, 0) + 16 * supportShares([1.5, 120], 0, 144, false)[0] / 12, 192, 0.01));
  check("its footing: the table asks 18 in. round, 6 in. thick; poured as an 18-in. pad under a 12-in. pier, 18 in. deep (frost), 4 bags", mid.footing.required?.roundIn === 18 && mid.footing.padIn === 18 && mid.footing.pierIn === 12 && mid.footing.depthIn === 18 && mid.footing.bags === 4);
  const l = fWA.ledgers[0];
  check("the ledger: 16 ft, 1/2-in. lags every 18 in. for a 9.75-ft joist, 12 of them", fWA.ledgers.length === 1 && l.lengthIn === 192 && l.spacingIn === 18 && l.fasteners === 12);
  check("15 joist lines: 11 on the layout plus the doubled outside pairs", fWA.joists.length === 15 && fWA.joists.filter((j) => j.sister).length === 2 && fWA.joists.filter((j) => j.edge).length === 4);
  check("hardware: 11 hangers + 2 double hangers at the ledger, a tie per joist on the beam, 3 bases, 3 caps, 2 hold-downs, no braces under 2 ft", fWA.hardware.hangers === 11 && fWA.hardware.doubleHangers === 2 && fWA.hardware.ties === 15 && fWA.hardware.postBases === 3 && fWA.hardware.postCaps === 3 && fWA.hardware.lateralTies === 2 && fWA.hardware.braces === 0);
  check("blocking over the beam the joists run past: 12 pieces", fWA.blockingRows.length === 1 && fWA.blockingRows[0].why === "beam" && fWA.blockingRows[0].pieces === 12);
  check("the rim is doubled and the ledger is at least a 2x8", fWA.sticks.filter((s) => s.role === "rim").length === 2 && fWA.sticks.find((s) => s.role === "ledger")?.nominal === "2x8");
  check("nothing is flagged", !fWA.flags.tooLow && !fWA.flags.droppedDoesNotFit && !fWA.flags.joistBeyondTable && fWA.flags.beamBeyondTable.length === 0);
}

console.log("── what changes the frame");
{
  const tx = buildDeckFrame(TX);
  check("Texas frames in Southern pine, and its beams are built up — AWC prints no solid beam for Southern pine", tx.species.id === "southern-pine" && tx.beamKind === "built-up" && !!tx.beamKindNote && tx.beams.every((b) => b.table === "IRC" && b.spec.kind === "built-up"));
  check("its footings stop at the code's 12 in. (a 6-in. frost line)", tx.posts.every((p) => p.footing.depthIn === 12));
  const snow = buildDeckFrame({ ...WA, loadPsf: 60, frostIn: 36 });
  check("a 60 psf snow load: built-up beams off the 60 psf table, lags every 15 in., bigger footings 36 in. deep", snow.beamKind === "built-up" && snow.ledgers[0].spacingIn === 15 && snow.posts[1].footing.required!.roundIn > fWA.posts[1].footing.required!.roundIn && snow.posts[1].footing.depthIn === 36);
  const high = buildDeckFrame({ ...WA, shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 96 });
  check("20 x 14, 8 ft up: 2x10 joists (2x8 stops at 11-1), posts over 6 ft, a knee brace at each corner post", high.joistSize === "2x10" && high.posts[0].heightIn > 72 && high.hardware.braces === 2 && high.sticks.filter((s) => s.role === "brace").every((s) => s.nominal === "2x4" && s.lengthIn === 34));
  const low = buildDeckFrame({ ...WA, shape: { kind: "rect", widthFt: 12, depthFt: 12 }, heightIn: 14 });
  check("14 in. up there is no room under the joists: the beam goes flush, the joists hang on it, no rim, no ties", low.beamStyle === "flush" && low.beams[0].spec.depthIn >= 9.25 && low.sticks.filter((s) => s.role === "rim").length === 0 && low.hardware.ties === 0 && low.hardware.hangers === 16 && low.hardware.doubleHangers === 4);
  check("its beam sits on the footings — bases, no posts, no caps", low.posts.every((p) => p.heightIn < 1) && low.hardware.postCaps === 0 && low.sticks.filter((s) => s.role === "post").length === 0);
  check("a flush beam's outer face is the deck's edge", near(low.beams[0].y + low.beams[0].spec.thickIn / 2, 144));
  const veneer = buildDeckFrame({ ...WA, wall: "brick-veneer", heightIn: 30 });
  check("brick veneer: no ledger, a beam line by the house instead, joists overhanging both, blocking over both", veneer.design.placement === "beside" && veneer.ledgers.length === 0 && veneer.beams.length === 2 && veneer.beams[0].role === "back" && veneer.zones[0].backCantIn === 22.5 && veneer.hardware.hangers === 0 && veneer.hardware.lateralTies === 0 && veneer.blockingRows.length === 2);
  check("standing free, the posts together carry the whole deck", near(veneer.posts.reduce((a, p) => a + p.tributarySqFt, 0), 192, 0.01));
  check("free-standing footings are not forced to frost depth (the code asks it of an attached deck)", veneer.posts.every((p) => p.footing.depthIn === 12) && buildDeckFrame({ ...WA, wall: "brick-veneer", footing: { ...WA.footing, frostAlways: true } }).posts.every((p) => p.footing.depthIn === 18));
  const deep = buildDeckFrame({ ...WA, shape: { kind: "rect", widthFt: 16, depthFt: 22 }, heightIn: 48 });
  const mid = deep.beams.find((b) => b.role === "middle");
  check("22 ft deep: no joist spans it, so a middle beam is added and the joists stay 2x8", deep.joistSize === "2x8" && deep.beams.length === 2 && !!mid && mid.bothSides);
  check("the middle beam is sized for the strip an unbroken joist puts on it (about 1.25 spans), not half of each side", !!mid && mid.tableSpanFt > 15.5 && mid.tableSpanFt < 16.5 && mid.spec.depthIn >= deep.beams.find((b) => b.role === "front")!.spec.depthIn);
  check("joists longer than a 20-ft stick are cut over the middle beam", deep.sticks.filter((s) => s.role === "joist").length === 30 && deep.sticks.every((s) => s.lengthIn <= STOCK_MAX_IN + 0.01));
  const L = buildDeckFrame({ ...WA, shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } }, heightIn: 60 });
  check("an L with two fronts gets a beam under each, one overhang for both", L.beams.length === 2 && L.zones[0].frontCantIn === L.zones[1].frontCantIn && L.ledgers.length === 1 && L.ledgers[0].lengthIn === 288);
  check("its ledger is spaced for the longer joists", L.ledgers[0].joistSpanFt === Math.max(...L.zones.map((z) => z.spansIn[0] / 12)));
  const bump = buildDeckFrame({ ...WA, shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "back-left", widthFt: 8, depthFt: 4 } }, heightIn: 60 });
  check("where the house steps into the deck: two ledgers (16 ft and 8 ft), and ONE beam across the shared front", bump.ledgers.length === 2 && bump.ledgers.map((l) => l.lengthIn).sort((a, b) => a - b).join() === "96,192" && bump.beams.length === 1 && bump.beams[0].x1 - bump.beams[0].x0 === 288 && bump.beams[0].zoneIds.length === 2);
  check("that beam is sized for the longer joists, and its posts carry each stretch's own strip", near(bump.beams[0].tableSpanFt, 13.75) && new Set(bump.posts.map((p) => p.tributarySqFt)).size > 2);
  check("the joist against the house's return wall is not doubled; the two open sides are", bump.joists.filter((j) => j.sister).length === 2);
  const pvc = buildDeckFrame({ ...WA, decking: { ...WA.decking, product: "pvc", diagonal: true } });
  check("PVC on the diagonal: joists at 12 in. and a row of blocking so no two rows are more than 6 ft apart", pvc.spacingIn === 12 && pvc.deckingMaxSpacingIn === 12 && pvc.blockingRows.some((r) => r.why === "maker"));
  const asked = buildDeckFrame({ ...WA, framing: { ...WA.framing, joist: "2x6", overhangFt: 0 } });
  check("a 2x6 the contractor asks for cannot span 11-9: the engine adds a middle beam rather than refuse", asked.joistSize === "2x6" && asked.beams.length === 2 && !asked.flags.joistBeyondTable);
  const far = buildDeckFrame({ ...WA, framing: { ...WA.framing, overhangFt: 4 } });
  check("an overhang past the table is drawn as asked and flagged, not quietly shortened", far.zones[0].frontCantIn === 46.5 && far.flags.joistBeyondTable && checksOf(far.design).some((c) => c.id.startsWith("joist-overhang") && c.level === "fail" && !!c.fix));
  const four = buildDeckFrame({ ...WA, framing: { ...WA.framing, post: "4x4" }, heightIn: 120 });
  check("4x4 posts 8 ft tall under 50 sq ft: the table says no (11-0 at 60 sq ft … but 8'-6\" tall carries less than it must)", four.posts.some((p) => p.heightIn > p.maxHeightIn) === (four.posts[1].heightIn > postMaxHeightIn(40, "DF", "4x4", four.posts[1].tributarySqFt)));
  const block = buildDeckFrame({ ...WA, placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, heightIn: 18, footing: { ...WA.footing, type: "pier-block" } });
  check("pier blocks: no concrete, no tubes, the blocks' tops 7 in. up", block.posts.every((p) => p.footing.type === "pier-block" && p.footing.bags === 0) && block.footingTopIn === 7);
}

console.log("── a sweep: every size the studio draws, framed inside the tables");
{
  let frames = 0;
  let clean = 0;
  const trouble: string[] = [];
  const fails: string[] = [];
  for (const state of ["WA", "TX"]) {
    for (const load of [40, 60] as const) {
      for (const width of [8, 12, 16, 20, 28, 40]) {
        for (const depth of [8, 10, 12, 14, 16, 20, 24]) {
          for (const heightIn of [10, 18, 30, 48, 96, 144]) {
            for (const placement of ["attached", "detached"] as const) {
              const design = normalizeDeckDesign({ ...defaultDeckDesign({ state, frostIn: 24 }), loadPsf: load, placement, shape: { kind: "rect", widthFt: width, depthFt: depth }, heightIn });
              const f = buildDeckFrame(design);
              frames++;
              const tag = `${state} ${load}psf ${width}x${depth} ${heightIn}in ${placement}`;
              const maxSpan = joistMaxSpanIn(f.load, f.group, f.joistSize, f.spacingIn);
              const numbersOk = f.sticks.every((s) => [s.cx, s.cy, s.cz, s.sx, s.sy, s.sz, s.lengthIn].every((v) => Number.isFinite(v)) && s.lengthIn > 0 && s.lengthIn <= STOCK_MAX_IN + 0.01 && s.sx > 0 && s.sy > 0 && s.sz > 0);
              if (!numbersOk) trouble.push(`${tag}: a stick with a bad number or longer than stock`);
              if (f.flags.joistBeyondTable || f.flags.beamBeyondTable.length || f.flags.droppedDoesNotFit) trouble.push(`${tag}: flagged ${JSON.stringify(f.flags)}`);
              if (!f.flags.tooLow) {
                if (f.zones.some((z) => z.spansIn.some((s) => s > maxSpan))) trouble.push(`${tag}: a joist past its span`);
                if (f.zones.some((z) => z.frontCantIn > joistMaxCantileverIn(f.load, f.group, f.joistSize, z.spansIn[z.spansIn.length - 1] / 12))) trouble.push(`${tag}: an overhang past the table`);
                for (const b of f.beams) {
                  if (b.spanIn > b.maxSpanIn + 0.01) trouble.push(`${tag}: beam ${b.spec.size} spans ${ftIn(b.spanIn)} of ${ftIn(b.maxSpanIn)}`);
                  if (b.endIn > b.spanIn / 4 + 0.01) trouble.push(`${tag}: beam end ${b.endIn} past a quarter of ${b.spanIn}`);
                  if (b.style === "flush" && b.spec.depthIn < f.joistTopIn - f.joistBottomIn) trouble.push(`${tag}: a flush beam shallower than its joists`);
                }
                for (const p of f.posts) {
                  if (p.heightIn > p.maxHeightIn + 0.01) trouble.push(`${tag}: post ${ftIn(p.heightIn)} of ${ftIn(p.maxHeightIn)}`);
                  if (!p.footing.required) trouble.push(`${tag}: a footing past the table (${p.tributarySqFt} sq ft)`);
                  else if (p.footing.padIn < p.footing.required.roundIn) trouble.push(`${tag}: a footing smaller than the table asks`);
                }
                if (placement === "attached" && f.ledgers.some((l) => !(l.spacingIn > 0) || l.fasteners < 2)) trouble.push(`${tag}: a ledger with no fasteners`);
                const carried = f.posts.reduce((a, p) => a + p.tributarySqFt, 0);
                if (placement === "detached" && !near(carried, f.areaSqFt, 0.02)) trouble.push(`${tag}: posts carry ${carried} of ${f.areaSqFt} sq ft`);
              }
              const failed = checksOf(design).filter((c) => c.level === "fail");
              if (failed.length === 0) clean++;
              // The only things an automatic frame may fail on: a deck too low to frame, or one past the post table's 14 ft.
              for (const c of failed) if (!(c.id === "low-fit" || c.id === "low-beam" || c.id === "post-height" || c.id === "beam-fit")) fails.push(`${tag}: ${c.id} — ${c.text}`);
              if (failed.some((c) => c.id === "post-height") && heightIn < 144) fails.push(`${tag}: a post-height failure under 12 ft`);
            }
          }
        }
      }
    }
  }
  check(`${frames} decks framed; no stick with a bad number, none longer than a 20-ft stick, nothing past a table`, trouble.length === 0, trouble.slice(0, 6).join(" | "));
  check("the automatic frame fails a check only when the deck is too low to frame at all", fails.length === 0, fails.slice(0, 6).join(" | "));
  check("most of them need nothing from the contractor", clean / frames > 0.8, `${clean} of ${frames} with no failed check`);
}

console.log("── the boards");
check("a 16-ft row is one 16-ft board; a 24-ft row is two 12s, not a 20 and a cut", JSON.stringify([...planRow(192, 10, [12, 16, 20]).buy]) === JSON.stringify([[16, 10]]) && JSON.stringify([...planRow(288, 10, [12, 16, 20]).buy]) === JSON.stringify([[12, 20]]));
check("6-ft rows come two to a 12-ft board", JSON.stringify([...planRow(72, 10, [12, 16, 20]).buy]) === JSON.stringify([[12, 5]]));
{
  const p = planRow(360, 10, [12, 16, 20]);
  check("a 30-ft row is a 20 and half a 20: 15 boards for 10 rows, nothing wasted", p.boughtIn === 3600 && p.joints === 1 && p.cuts.join() === "240,120", JSON.stringify([...p.buy]));
  const q = planRow(170, 4, [8, 10, 12, 14, 16]);
  check("a row between two stock lengths takes the next one up (14'-2\" → 16 ft)", JSON.stringify([...q.buy]) === JSON.stringify([[16, 4]]));
}
{
  const s = deckSurface(fWA);
  check("the default deck: 26 rows of 2x6 across 12 ft, sixteen-footers, 10% over → 29 boards", s.rows === 26 && s.stock.length === 1 && s.stock[0].lengthFt === 16 && s.stock[0].count === 29 && s.netLf === 416 && s.boughtLf === 464);
  check("every board lies on the deck, and together they cover it (less the gaps)", s.pieces.length === 26 && s.pieces.every((p) => p.cx - p.sx / 2 >= -0.01 && p.cx + p.sx / 2 <= 192.01 && p.cy + p.sy / 2 <= 144.01) && near(s.pieces.reduce((a, p) => a + p.sx * p.sy, 0) / 144, 192, 0.04));
  check("26 rows cross 13 joists: 338 crossings, two screws each; treated wood is screwed down, no fascia", s.crossings === 338 && s.fastening === "screws" && !s.fascia.on);
  const comp = deckSurface(buildDeckFrame({ ...WA, shape: { kind: "rect", widthFt: 24, depthFt: 12 }, decking: { ...WA.decking, product: "composite-better" } }));
  // (2026-11-15: the joints stagger — the rows take 12 + 12, 16 + 8 and 20 + 4 in turn, the same feet of board bought: qa/tests/logic/deck-board-joints.check.ts.)
  const jointAt = (y: number) => Math.round(Math.min(...comp.pieces.filter((p) => Math.abs(p.cy - y) < 0.01).map((p) => p.cx + p.sx / 2)));
  const rowYs = [...new Set(comp.pieces.map((p) => Math.round(p.cy * 100) / 100))].sort((m, n) => m - n);
  check("composite on a 24-ft deck: every row spliced on a joist, no two rows side by side on one line, hidden clips, fascia on the 48 ft of open edge", comp.stock.reduce((a2, st) => a2 + st.lengthFt * st.count, 0) >= comp.netLf && comp.pieces.every((p) => p.sx % 48 === 0 && p.sx <= 240) && rowYs.every((y, i) => i === 0 || Math.abs(jointAt(y) - jointAt(rowYs[i - 1])) >= 32) && comp.fastening === "hidden" && comp.fascia.on && comp.fascia.lf === 48 && comp.fascia.boards === 5, comp.stock);
  const diag = deckSurface(buildDeckFrame({ ...WA, decking: { ...WA.decking, diagonal: true } }));
  check("on the diagonal: the same feet of board, 5 points more waste, bought in the longest stock", diag.diagonal && near(diag.netLf, 192 * 12 / 5.625, 0.01) && diag.wastePct === 15 && diag.stock[0].lengthFt === 20 && diag.boughtLf >= diag.netLf * 1.15);
  const L = deckSurface(buildDeckFrame({ ...WA, shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } }));
  check("an L buys two lengths: rows across the full 24 ft, and rows across the 14-ft leg", near(L.pieces.reduce((a, p) => a + p.sx * p.sy, 0) / 144, 324, 0.04) && L.stock.length >= 2);
}

console.log("── the material package");
{
  const t = deckTakeoff(buildStructure(WA));
  const q = (id: string) => t.lines.find((l) => l.id === id)?.qty ?? 0;
  check("lumber as the yard sells it: 15 joists from 12-ft 2x8s, 2 sixteens for the rim, a 16-ft ledger, one 16-ft 4x10", q("lumber-joist-2x8-12") === 15 && q("lumber-rim-2x8-16") === 2 && q("lumber-ledger-2x8-16") === 1 && q("lumber-beam-4x10-16") === 1);
  check("three 15-in. posts come out of one 8-ft 6x6; twelve blocks out of two 8-ft 2x8s", q("lumber-post-6x6-8") === 1 && q("lumber-blocking-2x8-8") === 2);
  check("posts, the ledger and the beam are ordered ground-contact; joists and rim above-ground", t.lines.filter((l) => l.kind === "lumber").every((l) => (/posts|ledger|beams/.test(l.label) ? /ground-contact/.test(l.note ?? "") : /above-ground/.test(l.note ?? ""))));
  check("concrete: 3 + 4 + 3 bags; 4 ft of 12-in. tube; a base, an anchor bolt and a cap per post", t.concreteBags === 10 && q("concrete") === 10 && q("tube-12") === 4 && q("post-bases") === 3 && q("anchor-bolts") === 3 && q("post-caps") === 3);
  check("the ledger: 12 lags, 17 ft of cap flashing (4 in. past each end), 34 ft of membrane, 2 hold-downs", q("ledger-fasteners") === 12 && q("flashing") === 17 && q("membrane") === 34 && q("lateral-ties") === 2);
  check("connectors: 11 hangers, 2 doubles, 15 ties, a fastener set for each connector, 45 rim screws", q("hangers") === 11 && q("double-hangers") === 2 && q("ties") === 15 && q("connector-fasteners") === 11 + 4 + 15 + 3 + 3 && q("rim-screws") === 45);
  check("joist tape over every top a board sits on, to the ten feet", q("joist-tape") === 240);
  check("29 deck boards and screws for 192 sq ft", q("boards-16") === 29 && q("deck-fasteners") === 192);
  check("every line names a price-book row that exists", t.lines.every((l) => DECK_RATES.some((r) => r.key === l.rateKey)), t.lines.filter((l) => !DECK_RATES.some((r) => r.key === l.rateKey)).map((l) => l.rateKey).join());
  check("every line is filed under a step, and the steps come in build order", t.lines.map((l) => l.step).join().replace(/(\w+)(,\1)+/g, "$1") === "footings,ledger,framing,decking");
  check("stock: the shortest stick that the piece comes out of", stockFor(139.5) === 12 && stockFor(96) === 8 && stockFor(96.5) === 10 && stockFor(240) === 20);
  check("short pieces are laid into boards longest first: 15 blocks need two 10-ft boards, not three 8s", JSON.stringify(packPieces([...new Array(13).fill(14.5), 12.25, 12.25], [8, 10, 12, 16])) === JSON.stringify({ stockFt: 10, boards: 2 }));
  const st = deckTakeoff(buildStructure({ ...WA, extras: { ...WA.extras, stainless: true } }));
  check("stainless multiplies the connectors and fasteners, not the flashing or the tape", st.lines.find((l) => l.id === "hangers")!.factor > 2 && st.lines.find((l) => l.id === "flashing")!.factor === 1 && st.lines.find((l) => l.id === "joist-tape")!.factor === 1);
  const four = deckTakeoff(buildStructure({ ...WA, ledger: { fastener: "ledgerlok", lateral: "four" } }));
  const fir = deckTakeoff(buildStructure({ ...WA, framing: { ...WA.framing, species: "douglas-fir" }, ledger: { fastener: "ledgerlok", lateral: "two" } }));
  check("LedgerLOK instead of lags: closer together — every 14 in. in a fir ledger (15), every 12 in. in a hem-fir one (17) — and four 750-lb ties when chosen", fir.lines.find((l) => l.id === "ledger-fasteners")!.qty === 15 && four.lines.find((l) => l.id === "ledger-fasteners")!.qty === 17 && /LedgerLOK/.test(four.lines.find((l) => l.id === "ledger-fasteners")!.label) && /every 12 in\./.test(four.lines.find((l) => l.id === "ledger-fasteners")!.note ?? "") && four.lines.find((l) => l.id === "lateral-ties")!.qty === 4);
}

console.log("── the price");
const seattle = resolveMarket({ state: "WA", zip: "98052" });
{
  const p = priceDeck(WA, { market: seattle });
  check("four lines for a plain deck — footings, ledger, framing, decking — the job's steps", p.lines.map((l) => l.id).join() === "deck-footings,deck-ledger,deck-framing,deck-decking");
  check("each line's halves add up to its unit price, to the cent", p.lines.every((l) => Math.abs(l.materialCost + l.laborCost - l.unitPrice) < 0.005));
  check("the package's total IS the sum of its lines (the proposal will show the same number)", Math.abs(p.subtotal - p.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0)) < 0.005 && Math.abs(p.materialSubtotal + p.laborSubtotal - p.subtotal) < 0.05);
  check("the lines' material is the material list's cost, within a cent a unit", Math.abs(p.materialSubtotal - p.bom.reduce((a, l) => a + l.cost, 0)) < 0.01 * p.lines.reduce((a, l) => a + l.quantity, 0));
  // Since 2026-10-12 a default is Home Depot's surveyed price where it sells the item (lib/deck/storePrices), else an example.
  check("with no price book, nothing is the shop's own: every default is a store price or an example, and the share says so", p.bom.every((l) => l.source !== "book") && p.exampleShare > 0 && p.exampleShare + p.storeShare * (p.materialSubtotal / p.subtotal) > 0.999, `examples ${Math.round(p.exampleShare * 100)}%, store ${Math.round(p.storeShare * 100)}% of materials`);
  check("a plain treated deck prices between $20 and $60 a square foot on the examples", p.pricePerSqFt > 20 && p.pricePerSqFt < 60, `$${p.pricePerSqFt}/sq ft, $${p.subtotal}`);
  const national = priceDeck(WA);
  check("the job's market moves the examples: Seattle labor is dearer than the national figure", p.laborSubtotal > national.laborSubtotal * 1.2 && national.bom.every((l) => l.source === "example" || l.source === "store"));
  const book = sanitizeDeckRateBook({ "labor.framing": 12, "lf.2x8": 1.8, "deck.pt-hemfir-2x6": 1.2, nonsense: 5, "labor.footing": 999999, "hw.tie": "abc" });
  check("the shop's book keeps what it changed: unknown rows, numbers past their rails and restated defaults are dropped", JSON.stringify(book) === JSON.stringify({ "labor.framing": 12, "lf.2x8": 1.8 }));
  const own = priceDeck(WA, { market: seattle, rates: book });
  check("a typed rate is charged as typed — the market does not touch it", deckRate("labor.framing", book, seattle).price === 12 && deckRate("labor.framing", book, seattle).source === "book" && deckRate("labor.framing", undefined, seattle).price > 9);
  const framing = own.lines.find((l) => l.id === "deck-framing")!;
  check("the framing line's labor is then the shop's $12 a square foot", framing.laborCost === 12, String(framing.laborCost));
  check("…and less of the total stands on examples", own.exampleShare < 1 && own.exampleShare > 0.3, own.exampleShare.toFixed(2));
  // A v2 design's words (extras.rail, stairFlights) still read as a rail type and flights down the front.
  const legacy = normalizeDeckDesign({ shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 96, extras: { rail: "aluminum", stairFlights: 2, stairWidthFt: 5 } });
  check("an older design's railing allowance and stair count become a rail and real stairs", legacy.rail.type === "aluminum" && legacy.stairs.length === 2 && legacy.stairs.every((st) => st.side === "front" && st.widthFt === 5) && legacy.stairs[0].atFt < legacy.stairs[1].atFt);
  const full = priceDeck({ ...WA, heightIn: 96, shape: { kind: "rect", widthFt: 20, depthFt: 14 }, decking: { ...WA.decking, product: "composite-better" }, rail: { ...WA.rail, type: "aluminum" }, stairs: [defaultStair("s1", "front", 10)], extras: { ...WA.extras, demoSqFt: 150 } }, { market: seattle });
  check("composite, 8 ft up, with rail, stairs and a tear-out: eight lines", full.lines.map((l) => l.id).join() === "deck-footings,deck-ledger,deck-framing,deck-decking,deck-fascia,deck-stairs,deck-rail,deck-demo", full.lines.map((l) => l.id).join());
  const rails = full.structure.rails;
  check("railing on every open edge less the stair opening (48 − 4 = 44 ft) plus both sides of the stair; 13 risers; tear-out is labor only", rails.lf === 44 && rails.stairLf > 20 && full.railFt === rails.totalLf && full.stairSteps === 13 && full.structure.stairs[0].rail.sides === 2 && full.lines.find((l) => l.id === "deck-demo")!.materialCost === 0 && !full.lines.find((l) => l.id === "deck-demo")!.taxable, `${rails.lf} + ${rails.stairLf}`);
  const custom = priceDeck({ ...WA, rail: { ...WA.rail, type: "custom", customPerFt: 200 } });
  check("a custom rail is the shop's own price per foot, over the feet it runs — never an example", custom.lines.find((l) => l.id === "deck-rail")!.unitPrice === 200 && custom.lines.find((l) => l.id === "deck-rail")!.quantity === custom.structure.rails.totalLf);
  const redwood = priceDeck({ ...WA, framing: { ...WA.framing, species: "redwood" } });
  check("redwood heart frames cost more than treated hem-fir, and span less (bigger joists or beams)", redwood.materialSubtotal > national.materialSubtotal * 1.3);
  const parsed = deckConvertSchema.safeParse({ title: "Deck — 16 ft × 12 ft", scope: deckScope(full).join("\n"), assumptions: deckNotes(full), lines: full.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), address: "118 Cedar Ln, Redmond, WA 98052", plan: { design: framed(full.frame).design, scene: JSON.parse(JSON.stringify(deckScene(full.structure))) } });
  check("every line the engine makes passes the rules the convert action applies", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
  check("a broken 3D is refused, not sent to a client", !deckConvertSchema.safeParse({ title: "x", assumptions: [], lines: [{ name: "a", quantity: 1, materialCost: 1, laborCost: 1 }], plan: { design: {}, scene: { v: 1, boxes: "nope" } } }).success);
  const scope = deckScope(full, "118 Cedar Ln, Redmond");
  check("the client's scope: plain sentences, the deck's size first, no dollar sign and no estimate words", /^Build a 20 ft × 14 ft deck \(280 sq ft\), 8'-0" above the ground, at 118 Cedar Ln/.test(scope[0]) && scope.every((s) => !/\$|estimate|example|allowance/i.test(s)) && scope.some((s) => /ft of textured black aluminum railing/.test(s)) && scope.some((s) => /13 risers/.test(s)));
  check("the notes name the code, the soil and frost the footings assume, and what is not included", deckNotes(p).some((n) => /International Residential Code/.test(n) && /DCA 6/.test(n) && /permit fees/.test(n)) && deckNotes(p).some((n) => /1,500 psf/.test(n) && /18 in\./.test(n)) && deckNotes(p).some((n) => /guard rail/.test(n)));
}

console.log("── the code-check strip");
{
  const checks = checksOf(WA);
  const sum = checkSummary(checks);
  check("the default deck: nothing fails; joists, beam, posts, footings and ledger each pass with their numbers and their table", sum.fail === 0 && ["joist-span", "beam-b1", "post-height", "footing-size", "footing-depth", "ledger", "ledger-lateral"].every((id) => checks.find((c) => c.id === id)?.level === "pass") && checks.filter((c) => c.level === "pass").every((c) => !!c.rule));
  check("the joist line reads the span and the table's limit", /2x8 at 16 in\. span 9'-9"; the table allows 11'-1"/.test(checks.find((c) => c.id === "joist-span")!.text));
  check("36 in. up needs a guard: a warning with a one-tap railing allowance; 5 risers to the ground, a one-tap flight", checks.find((c) => c.id === "guard")?.level === "warn" && !!checks.find((c) => c.id === "guard")?.fix && /5 risers/.test(checks.find((c) => c.id === "stairs")!.text));
  const withRail = applyDeckPatch(WA, checks.find((c) => c.id === "guard")!.fix!.patch);
  check("tapping the fix answers the check", withRail.rail.type === "treated" && checksOf(withRail).find((c) => c.id === "guard")?.level === "pass");
  const lowDeck = checksOf({ ...WA, heightIn: 24 });
  check("24 in. up: no guard is asked for", lowDeck.find((c) => c.id === "guard")?.level === "info");
  const wide = buildDeckFrame({ ...WA, decking: { ...WA.decking, product: "composite-better" }, framing: { ...WA.framing, spacingIn: 24 } });
  const spacing = checksOf(wide.design).find((c) => c.id === "joist-spacing")!;
  check("composite on joists 24 in. apart fails, and the fix sets them at 16", spacing.level === "fail" && checksOf(applyDeckPatch(wide.design, spacing.fix!.patch)).find((c) => c.id === "joist-spacing")?.level === "pass");
  const blocks = checksOf({ ...WA, footing: { ...WA.footing, type: "pier-block" } }).find((c) => c.id === "footing-blocks")!;
  check("pier blocks under a deck on the house fail (free-standing, 200 sq ft and 20 in. at most), with the fix to pour", blocks.level === "fail" && /hangs on the house/.test(blocks.text) && blocks.fix?.patch.footing?.type === "poured");
  const smallFree = checksOf({ ...WA, placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, heightIn: 18, footing: { ...WA.footing, type: "pier-block" } });
  check("a small low free-standing deck may sit on blocks — with the code's own caveat — and may need no permit", smallFree.find((c) => c.id === "footing-blocks")?.level === "warn" && smallFree.some((c) => c.id === "free-permit") && smallFree.some((c) => c.id === "free-lateral" && c.level === "warn"));
  const tall = checksOf({ ...WA, heightIn: 200 });
  check("posts past 14 ft are an engineer's, and the strip says so", tall.find((c) => c.id === "post-height")?.level === "fail" && /engineer/.test(tall.find((c) => c.id === "post-height")!.text));
  const ground = checksOf({ ...WA, heightIn: 6 });
  check("a deck 6 in. high cannot be framed: it fails plainly instead of drawing joists in the dirt", ground.find((c) => c.id === "low-fit")?.level === "fail");
  const veneer = checksOf({ ...WA, wall: "brick-veneer" });
  check("on brick veneer the strip says why there is no ledger", veneer.some((c) => c.id === "free-wall" && /veneer/.test(c.text)) && !veneer.some((c) => c.part === "Ledger"));
  const deepChecks = checksOf({ ...WA, shape: { kind: "rect", widthFt: 16, depthFt: 22 } });
  check("a middle beam is flagged for the building office, not hidden", deepChecks.some((c) => c.id.startsWith("beam-both") && c.level === "warn") && deepChecks.some((c) => c.id === "joist-middle-beam"));
  const ll70 = checksOf({ ...WA, loadPsf: 70, ledger: { fastener: "ledgerlok", lateral: "two" } }).find((c) => c.id === "ledger")!;
  check("a structural screw with no printed spacing at 70 psf fails, with the way back to lags", ll70.level === "fail" && ll70.fix?.patch.ledger?.fastener === "lag");
  check("Southern pine and snow loads each say why the beams are built up", checksOf(TX).some((c) => c.id === "beam-kind" && /Southern pine/.test(c.text)) && checksOf({ ...WA, loadPsf: 50 }).some((c) => c.id === "beam-kind" && /50 psf/.test(c.text)));
  check("treated SPF warns that posts, ledger and beams need a ground-contact species", checksOf({ ...WA, framing: { ...WA.framing, species: "spf" } }).some((c) => c.id === "lumber-spf" && c.level === "warn"));
  // Every fix the strip offers on a spread of troubled decks leaves a design the engine still builds.
  const troubled: DeckDesign[] = [
    { ...WA, framing: { ...WA.framing, joist: "2x6", overhangFt: 3 } },
    { ...WA, framing: { ...WA.framing, beamStyle: "dropped" }, heightIn: 12 },
    { ...WA, framing: { ...WA.framing, post: "4x4" }, heightIn: 150 },
    { ...WA, framing: { ...WA.framing, beamKind: "built-up", beam: "2-2x6", beamStyle: "flush" }, heightIn: 16 },
    { ...WA, shape: { kind: "rect", widthFt: 40, depthFt: 30 }, framing: { ...WA.framing, joist: "2x12", spacingIn: 24 } },
  ];
  let fixesTried = 0;
  let fixesHelped = 0;
  for (const d of troubled) {
    const f = buildDeckFrame(d);
    for (const c of checksOf(f.design).filter((x) => x.level === "fail" && x.fix)) {
      fixesTried++;
      const after = checksOf(applyDeckPatch(f.design, c.fix!.patch));
      if (after.find((x) => x.id === c.id)?.level !== "fail") fixesHelped++;
    }
  }
  check("on a spread of decks built wrong on purpose, every one-tap fix clears the check it answers", fixesTried >= 4 && fixesHelped === fixesTried, `${fixesHelped} of ${fixesTried}`);
}

console.log("── the 3D, as data");
{
  const p = priceDeck({ ...WA, decking: { ...WA.decking, product: "composite-better" } });
  const scene = deckScene(p.structure);
  const hardware = scene.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("hardware")).length;
  check("a box for every stick, every board, every fascia run and every bolt, hanger and tie, filed by layer in build order", scene.boxes.length === framed(p.frame).sticks.length + framed(p.takeoff.surface).pieces.length + 3 + hardware && hardware > 30 && SCENE_LAYERS.slice(0, 10).join() === "footing,post,beam,ledger,joist,rim,blocking,brace,decking,fascia", `${scene.boxes.length} boxes, ${hardware} hardware`);
  check("every box carries a tag into the legend; the legend names the parts and their cuts; the connections are called out", scene.tags.length === scene.boxes.length && scene.legend.length > 8 && scene.legend.some((l) => /hanger/.test(l.role)) && scene.legend.some((l) => /lag|bolt|screw/.test(l.nominal)) && scene.callouts.length >= 5, `${scene.legend.length} legend, ${scene.callouts.length} callouts`);
  check("in feet: 16 x 12, the boards' tops at 3 ft", scene.widthFt === 16 && scene.depthFt === 12 && scene.heightFt === 3 && scene.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("decking")).every((b) => near(b[3] + b[6] / 2, 3, 0.001)));
  check("a footing for every post, and a house with a door where the deck meets one", scene.footings.length === 3 && !!scene.house && scene.house.blocks.length === 1 && !!scene.house.door && scene.house.heightFt === 12);
  check("it reads back exactly after a trip through JSON", JSON.stringify(parseDeckScene(JSON.parse(JSON.stringify(scene)))) === JSON.stringify(scene));
  check("a 16 x 12 deck's scene with its hardware and legend stays under 60 kB", JSON.stringify(scene).length < 60_000, `${JSON.stringify(scene).length} bytes`);
  check("bad shapes are no scene: a wrong version, a box with a missing number, a negative size, a layer that does not exist", parseDeckScene({ ...scene, v: 4 }) === null && parseDeckScene({ ...scene, boxes: [[0, 1, 2]] }) === null && parseDeckScene({ ...scene, boxes: [[0, 1, 1, 1, -1, 1, 1, 0]] }) === null && parseDeckScene({ ...scene, boxes: [[99, 1, 1, 1, 1, 1, 1, 0]] }) === null && parseDeckScene("x") === null);
  const detached = deckScene(buildStructure({ ...WA, placement: "detached" }));
  check("a detached deck stands alone: no house", detached.house === null);
  const dScene = deckScene(buildStructure({ ...WA, decking: { ...WA.decking, diagonal: true } }));
  const ringArea = (r: number[]) => Math.abs(r.reduce((a, _, i) => (i % 2 ? a : a + r[i] * r[(i + 3) % r.length] - r[(i + 2) % r.length] * r[i + 1]), 0)) / 2;
  check("boards on the diagonal are cut to the outline: together they cover the deck less the gaps", !!dScene.diagonal && dScene.diagonal.boards.length > 30 && near(dScene.diagonal.boards.reduce((a, r) => a + ringArea(r), 0), 192 * (5.5 / 5.625), 0.02) && dScene.boxes.every((b) => b[0] !== SCENE_LAYERS.indexOf("decking")));
  const big = priceDeck({ ...WA, shape: { kind: "rect", widthFt: 60, depthFt: 40 } });
  const bigScene = deckScene(big.structure);
  check("the largest deck the studio draws still fits the stored scene's limits", bigScene.boxes.length < 12000 && JSON.stringify(bigScene).length < 900_000 && !!parseDeckScene(JSON.parse(JSON.stringify(bigScene))), `${bigScene.boxes.length} boxes, ${JSON.stringify(bigScene).length} bytes`);
  const plan = parseDeckPlan(JSON.parse(JSON.stringify({ v: 1, design: framed(p.frame).design, scene, address: "118 Cedar Ln" })));
  check("the deck kept with a proposal reads back: the design, the scene, the address", !!plan && plan.design.decking.product === "composite-better" && plan.scene.boxes.length === scene.boxes.length && plan.address === "118 Cedar Ln" && parseDeckPlan({ design: {}, scene: null }) === null);
}

console.log(bad === 0 ? "\nAll deck engine checks passed." : `\n${bad} deck engine check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
