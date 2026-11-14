// THE DECK STUDIO'S RULE BOOK (2026-10-04) — pure, no imports beyond the data.
//
// Owner: "it follows the code". A deck's frame is sized here from printed
// tables, and every answer names the table it came from, so the contractor
// can show the building office where a number is written:
//
//   · the International Residential Code, Section R507 (2021 edition; the
//     2024 edition prints the same values) — joists, built-up beams, posts,
//     footings, the ledger's lag screws and bolts. Numbers in
//     codeTables.data.ts, generated from the publisher's text.
//   · the American Wood Council's DCA 6 guide, Table 3A — SOLID 4x beams.
//     The 2021 and 2024 code tables list beams built up from 2x lumber only;
//     the solid 4x6…4x12 the owner builds with are in AWC's guide, for the
//     western species and the 40 psf load only. Nothing here stretches that
//     table: Southern pine or a snow load gets a built-up beam instead.
//   · the screw makers' own tables — FastenMaster LedgerLOK, Simpson SDWS.
//     A structural screw is not in the code's ledger table; its spacing is
//     the maker's, and it is closer together than a 1/2-in. lag.
//
// HOW A TABLE IS READ. Between two printed columns the value is read in
// proportion where the code allows it (its footnotes say "interpolation
// permitted"), and never past the last column ("extrapolation not
// permitted"). Past the table there is no answer here — 0 or null — and the
// studio says "beyond the table: an engineer sizes this". Everything is
// rounded to the safe side, to the whole inch.
//
// This is estimating grade. The building department decides.

import { BEAM_ROWS, FOOTING_ROWS, JOIST_ROWS, LEDGER_ROWS, POST_ROWS, type BuiltUpBeam, type JoistSize, type LoadPsf, type PostSize as WoodPostSize, type SpeciesGroup } from "./codeTables.data";
import { OC_POST, OC_POST_ACTUAL_IN, OC_RULE, ocJoistMaxCantileverIn, ocJoistMaxSpanIn, ocPostMaxHeightIn } from "./ocLumber";

export type { BuiltUpBeam, JoistSize, LoadPsf, SpeciesGroup, WoodPostSize };

/**
 * The rule book a frame is read on: one of the code's three species rows for
 * sawn wood, or "OC" — Owens Corning's own tables for its composite framing
 * (lib/deck/ocLumber, 2026-11-12). The code's tables never speak for OC.
 */
export type FramingGroup = SpeciesGroup | "OC";
/** A post: sawn lumber the code tabulates, or the built-up OC post (three 2x6 OC boards). */
export type PostSize = WoodPostSize | typeof OC_POST;

export const LOADS: readonly LoadPsf[] = [40, 50, 60, 70];
export const JOIST_SIZES: readonly JoistSize[] = ["2x6", "2x8", "2x10", "2x12"];
/** The sawn posts the code tabulates — what a wood frame offers. */
export const POST_SIZES: readonly WoodPostSize[] = ["4x4", "4x6", "6x6", "8x8"];
export type SpacingIn = 12 | 16 | 24;
export const SPACINGS: readonly SpacingIn[] = [12, 16, 24];
/** Soil that bears 1,500, 2,000 or 3,000 psf and more (Table R401.4.1). */
export type SoilPsf = 1500 | 2000 | 3000;
export const SOILS: readonly SoilPsf[] = [1500, 2000, 3000];

/** Where each kind of number is written — printed beside the number. */
export const RULE = {
  joist: "IRC Table R507.6",
  cantilever: "IRC Table R507.6",
  beam: "IRC Tables R507.5(1)–(5)",
  solidBeam: "AWC DCA 6 Table 3A",
  beamCantilever: "IRC R507.5",
  flushBeam: "IRC Table R507.5, note e",
  post: "IRC Table R507.4",
  footing: "IRC Table R507.3.1",
  footingDepth: "IRC R507.3.2",
  frost: "IRC R507.3.3",
  pierBlock: "IRC R507.3, exception 2",
  ledger: "IRC Table R507.9.1.3(1)",
  ledgerBoard: "IRC R507.9.1.1",
  ledgerWall: "IRC R507.9.1.1 · AWC DCA 6",
  lateral: "IRC R507.9.2",
  selfSupporting: "IRC R507.8",
  decking: "IRC Table R507.7",
  hangers: "IRC R507.6.1",
  restraint: "IRC R507.6.2",
  guard: "IRC R312.1",
  stairs: "IRC R311.7",
  permit: "IRC R105.2",
  bracing: "AWC DCA 6, Figure 10",
  treatment: "IRC R317 · AWPA U1",
  fasteners: "IRC Table R507.2.3",
} as const;

export type RuleBook = { -readonly [K in keyof typeof RULE]: string };

/** The rule names a frame's numbers are printed with: the code's, or Owens Corning's where OC framing replaces them. */
export function rulesFor(group: FramingGroup): RuleBook {
  if (group !== "OC") return RULE;
  return { ...RULE, joist: OC_RULE.joist, cantilever: OC_RULE.cantilever, beam: OC_RULE.beam, beamCantilever: OC_RULE.beamCantilever, post: OC_RULE.post, bracing: OC_RULE.bracing, treatment: OC_RULE.treatment, fasteners: OC_RULE.fasteners, hangers: OC_RULE.hangers, restraint: OC_RULE.hangers, flushBeam: OC_RULE.beam };
}

/* ------------------------------------------------------------------ */
/*  Lumber as it measures                                              */
/* ------------------------------------------------------------------ */

/** Dressed depth of 2x and 4x stock, inches, by the nominal depth. */
export const DRESSED_DEPTH_IN: Record<number, number> = { 4: 3.5, 6: 5.5, 8: 7.25, 10: 9.25, 12: 11.25 };
/** A 2x is 1 1/2 in. thick, a 4x 3 1/2 in. */
export const THICK_2X_IN = 1.5;
export const THICK_4X_IN = 3.5;

export function joistDepthIn(size: JoistSize): number {
  return DRESSED_DEPTH_IN[Number(size.slice(2))];
}

/** A post as it measures: [width along the beam, depth], inches. */
export const POST_ACTUAL_IN: Record<PostSize, readonly [number, number]> = {
  "4x4": [3.5, 3.5],
  "4x6": [3.5, 5.5],
  "6x6": [5.5, 5.5],
  "8x8": [7.5, 7.5],
  [OC_POST]: OC_POST_ACTUAL_IN,
};

/* ------------------------------------------------------------------ */
/*  Reading between columns                                            */
/* ------------------------------------------------------------------ */

/**
 * The value at `x` in a row printed at `cols`: in proportion between two
 * columns, the first column's value below the first, and 0 past the last.
 * A column that prints "not permitted" (0) poisons the stretch that reaches
 * it: between a real value and NP there is no number to stand on.
 * `stepUp` reads the next column up instead (tables headed "up to…").
 */
function readRow(cols: readonly number[], vals: readonly number[], x: number, stepUp = false): number {
  if (!(x > 0)) return 0;
  if (x <= cols[0]) return vals[0];
  const last = cols.length - 1;
  if (x > cols[last] + 1e-9) return 0;
  for (let i = 0; i < last; i++) {
    if (x <= cols[i + 1] + 1e-9) {
      if (Math.abs(x - cols[i]) < 1e-9) return vals[i];
      if (Math.abs(x - cols[i + 1]) < 1e-9 || stepUp) return vals[i + 1];
      if (vals[i] === 0 || vals[i + 1] === 0) return 0;
      const t = (x - cols[i]) / (cols[i + 1] - cols[i]);
      return vals[i] + (vals[i + 1] - vals[i]) * t;
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Joists — Table R507.6                                              */
/* ------------------------------------------------------------------ */

const SPACING_COL: Record<SpacingIn, number> = { 12: 0, 16: 1, 24: 2 };
const BACK_SPANS_FT = [4, 6, 8, 10, 12, 14, 16, 18] as const;

/** The longest span of a joist, inches. */
export function joistMaxSpanIn(load: LoadPsf, group: FramingGroup, size: JoistSize, spacing: SpacingIn): number {
  if (group === "OC") return ocJoistMaxSpanIn(load, size, spacing);
  return JOIST_ROWS[load][group][size].span[SPACING_COL[spacing]];
}

/**
 * The longest cantilever past the beam for a joist whose back span is
 * `backSpanFt`, inches (whole, rounded down). The table starts at a 4-ft
 * back span, where the cantilever is a quarter of it; a shorter back span
 * keeps that quarter — the table's own slope, and the limit AWC's guide
 * states outright.
 */
export function joistMaxCantileverIn(load: LoadPsf, group: FramingGroup, size: JoistSize, backSpanFt: number): number {
  if (group === "OC") return ocJoistMaxCantileverIn(backSpanFt);
  if (!(backSpanFt > 0)) return 0;
  if (backSpanFt < BACK_SPANS_FT[0]) return Math.floor((backSpanFt * 12) / 4);
  return Math.floor(readRow(BACK_SPANS_FT, JOIST_ROWS[load][group][size].cant, backSpanFt) + 1e-9);
}

/* ------------------------------------------------------------------ */
/*  Beams — Tables R507.5(1)–(5) and AWC DCA 6 Table 3A                */
/* ------------------------------------------------------------------ */

/**
 * Table R507.5(5): what a joist's cantilever does to the load on its beam.
 * A joist with no cantilever puts 0.66 of its span on the beam table; one
 * that hangs a quarter of its span past the beam, all of it. The table is a
 * staircase and is read as one: a ratio between two rows takes the row above.
 */
const JOIST_SPAN_FACTORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.66],
  [1 / 12, 0.72],
  [1 / 10, 0.8],
  [1 / 8, 0.84],
  [1 / 6, 0.9],
  [1 / 4, 1],
];
export function joistSpanFactor(cantileverFt: number, joistSpanFt: number): number {
  if (!(joistSpanFt > 0)) return 1;
  const r = Math.max(0, cantileverFt) / joistSpanFt;
  for (const [ratio, f] of JOIST_SPAN_FACTORS) if (r <= ratio + 1e-9) return f;
  // Past a quarter the joist table has already said no; the load still
  // grows, by the same statics the code's own factors follow.
  return 0.64 * (1 + r) * (1 + r);
}

/** The effective joist span a beam table is entered with, ft. */
export function effectiveJoistSpanFt(joistSpanFt: number, cantileverFt: number): number {
  return joistSpanFt * joistSpanFactor(cantileverFt, joistSpanFt);
}

/**
 * The effective joist span of a beam that carries joists on BOTH sides (a
 * middle beam), from the width of deck it holds up. The code's beam tables
 * are printed for a beam under one span of joists; its factor table follows
 * 0.66 x (1 + cantilever/span)^2, which is 1.32 x the strip of deck the beam
 * carries — and that reading is used here, with the strip a continuous joist
 * really puts on its middle support (more than half of each side).
 */
export function effectiveSpanFromTributaryFt(tributaryFt: number): number {
  return 1.32 * Math.max(0, tributaryFt);
}

const EFFECTIVE_SPANS_FT = [6, 8, 10, 12, 14, 16, 18] as const;
/** The beam tables' last column: no beam is read past an effective joist span of 18 ft. */
export const BEAM_TABLE_LAST_EFF_FT = EFFECTIVE_SPANS_FT[EFFECTIVE_SPANS_FT.length - 1];

/** The plies and the depth of a built-up beam. */
export function builtUpParts(beam: BuiltUpBeam): { plies: number; nominalDepth: number } {
  return { plies: Number(beam[0]), nominalDepth: Number(beam.slice(4)) };
}

/** The longest span of a built-up beam between posts, inches (0 = beyond the table). */
export function builtUpBeamMaxSpanIn(load: LoadPsf, group: SpeciesGroup, beam: BuiltUpBeam, effJoistSpanFt: number): number {
  return Math.floor(readRow(EFFECTIVE_SPANS_FT, BEAM_ROWS[load][group][beam], effJoistSpanFt) + 1e-9);
}

/** The solid beams AWC's guide tabulates. */
export type SolidBeam = "4x6" | "4x8" | "4x10" | "4x12";
export const SOLID_BEAMS: readonly SolidBeam[] = ["4x6", "4x8", "4x10", "4x12"];

/**
 * AWC DCA 6 (2015 edition), Table 3A: solid-sawn beams, 40 psf live + 10 psf
 * dead, No. 2, wet service. One set of rows for Douglas fir-larch, hem-fir,
 * spruce-pine-fir, redwood, western cedars, ponderosa and red pine; NO solid
 * rows for Southern pine. Columns are the joist span "less than or equal to"
 * 6, 8, 10, 12, 14, 16, 18 ft — the real span, the joists' overhang already
 * allowed for — so a span between two columns reads the next one up.
 */
const DCA6_SOLID_ROWS: Record<SolidBeam, readonly number[]> = {
  "4x6": [74, 63, 56, 51, 47, 44, 41],
  "4x8": [98, 84, 75, 68, 63, 59, 55],
  "4x10": [116, 100, 89, 81, 75, 70, 65],
  "4x12": [134, 116, 103, 94, 87, 81, 76],
};

/** Whether the solid-beam table speaks for this species and load at all. */
export function solidBeamTabulated(load: LoadPsf, group: FramingGroup): boolean {
  // Owens Corning prints beams of two and three 2x OC boards only.
  return load === 40 && group !== "SP" && group !== "OC";
}

/** The longest span of a solid 4x beam between posts, inches (0 = not in the table). */
export function solidBeamMaxSpanIn(load: LoadPsf, group: FramingGroup, beam: SolidBeam, joistSpanFt: number): number {
  if (!solidBeamTabulated(load, group)) return 0;
  return readRow(EFFECTIVE_SPANS_FT, DCA6_SOLID_ROWS[beam], joistSpanFt, true);
}

/** A beam may run past its end post by a quarter of the span beside it (R507.5). */
export const BEAM_CANTILEVER_SHARE = 0.25;

/* ------------------------------------------------------------------ */
/*  Posts — Table R507.4                                               */
/* ------------------------------------------------------------------ */

const POST_AREAS_SQFT = [20, 40, 60, 80, 100, 120, 140, 160] as const;
/** The tallest post the table prints. Taller, or a deck above a deck: an engineer. */
export const POST_TABLE_MAX_IN = 14 * 12;
/** The largest area one post may carry in the table. */
export const POST_TABLE_MAX_AREA = 160;

/**
 * The tallest post for the deck area it carries, inches (0 = not permitted / beyond the table). The built-up OC post
 * is read on Owens Corning's listing (what it carries under a 2- or a 3-ply beam, 9 ft at most); the code's table
 * has no row for it, and a sawn post has none in Owens Corning's.
 */
export function postMaxHeightIn(load: LoadPsf, group: FramingGroup, size: PostSize, tributarySqFt: number, beamPlies = 3): number {
  if (size === OC_POST) return group === "OC" ? ocPostMaxHeightIn(load, tributarySqFt, beamPlies) : 0;
  if (group === "OC") return 0;
  return Math.floor(readRow(POST_AREAS_SQFT, POST_ROWS[load][group][size], Math.max(tributarySqFt, 0.01)) + 1e-9);
}

/* ------------------------------------------------------------------ */
/*  Footings — Table R507.3.1                                          */
/* ------------------------------------------------------------------ */

export interface FootingSize {
  /** Side of a square footing, inches. */
  squareIn: number;
  /** Diameter of a round footing, inches. */
  roundIn: number;
  /** Thickness of the plain-concrete pad, inches. */
  thickIn: number;
}

/** The smallest footing for the deck area a post carries; null past 160 sq ft. */
export function footingMinSize(load: LoadPsf, tributarySqFt: number, soil: SoilPsf): FootingSize | null {
  const rows = FOOTING_ROWS[load];
  const key = soil === 1500 ? "s1500" : soil === 2000 ? "s2000" : "s3000";
  const cols = rows.map((r) => r.trib);
  const a = Math.max(tributarySqFt, 0.01);
  if (a > cols[cols.length - 1] + 1e-9) return null;
  const at = (i: number) => Math.ceil(readRow(cols, rows.map((r) => r[key][i]), a) - 1e-9);
  return { squareIn: at(0), roundIn: at(1), thickIn: at(2) };
}

/** Every deck footing sits at least this far below undisturbed ground (R507.3.2). */
export const FOOTING_MIN_DEPTH_IN = 12;

/** The code lets a small free-standing deck sit on precast pier blocks (R507.3, exception 2). */
export const PIER_BLOCK_MAX_AREA_SQFT = 200;
export const PIER_BLOCK_MAX_HEIGHT_IN = 20;

/* ------------------------------------------------------------------ */
/*  The ledger — Table R507.9.1.3(1) and the screw makers              */
/* ------------------------------------------------------------------ */

/** What holds the ledger to the house. */
export type LedgerFastener = "lag" | "bolt" | "bolt-gap" | "ledgerlok" | "sdws" | "anchor";
export const LEDGER_FASTENER_LABEL: Record<LedgerFastener, string> = {
  lag: "1/2-in. lag screws",
  bolt: "1/2-in. through-bolts",
  "bolt-gap": "1/2-in. through-bolts, spaced off the wall",
  ledgerlok: "LedgerLOK structural screws",
  sdws: "Simpson SDWS structural screws",
  anchor: "1/2-in. concrete anchors",
};

const LEDGER_SPANS_FT = [6, 8, 10, 12, 14, 16, 18] as const;
/** The code's ledger table stops at an 18-ft joist. */
export const LEDGER_TABLE_MAX_SPAN_FT = 18;

/**
 * FastenMaster's technical bulletin, Table 1 (2017): LedgerLOK spacing by
 * the joist span "up to" 6…18 ft. Printed for 40 and 60 psf; a 50 psf snow
 * load reads the 60 psf rows, and 70 psf is not printed at all. Rows: the
 * LEDGER's species (a hem-fir ledger holds less) on 2x lumber, and any
 * ledger on a 1-in. engineered rim board.
 */
const LEDGERLOK_ROWS: Record<40 | 60, { lumber: readonly number[]; lumberHemFir: readonly number[]; engineered: readonly number[] }> = {
  40: { lumber: [24, 18, 14, 12, 10, 9, 8], lumberHemFir: [20, 15, 12, 10, 8, 7, 6], engineered: [25, 19, 15, 12, 10, 9, 8] },
  60: { lumber: [17, 13, 10, 8, 7, 6, 5], lumberHemFir: [14, 11, 8, 7, 6, 5, 4], engineered: [18, 13, 10, 9, 7, 6, 6] },
};

/**
 * Simpson Strong-Tie's fastening guide (C-F-2017): SDWS22400DB through one
 * 2x ledger, spacing by the joist span "up to" 6…18 ft, 40 and 60 psf. The
 * 1-in. rim row is the thinnest engineered rim; thicker rims hold a little
 * more and are read as the 1-in. row here, to the safe side.
 */
const SDWS_ROWS: Record<40 | 60, { lumber: readonly number[]; engineered: readonly number[] }> = {
  40: { lumber: [22, 16, 13, 11, 9, 8, 7], engineered: [14, 10, 8, 7, 6, 5, 5] },
  60: { lumber: [15, 12, 9, 8, 7, 6, 5], engineered: [10, 7, 6, 5, 4, 4, 0] },
};

/**
 * AWC DCA 6 Table 5, 40 psf: 1/2-in. lags or bolts into a 1-in. engineered
 * rim board hold 300 lb each — closer together than the code's lumber
 * column. The code's own table does not tell the rims apart; the tighter of
 * the two is used on an engineered rim.
 */
const DCA6_ENGINEERED_RIM_40 = [24, 18, 14, 12, 10, 9, 8] as const;

export interface LedgerSpacingInput {
  load: LoadPsf;
  fastener: LedgerFastener;
  joistSpanFt: number;
  /** The house's rim: 2x lumber, or a 1-in. (or thicker) engineered rim board. */
  rim: "lumber" | "engineered";
  /** A hem-fir ledger (LedgerLOK's table tells it apart). */
  hemFirLedger?: boolean;
}

/**
 * On-center spacing of the ledger's fasteners, inches; 0 when no table
 * speaks for this case (the studio then says so and offers one that does).
 */
export function ledgerSpacingIn(input: LedgerSpacingInput): { spacingIn: number; rule: string } {
  const { load, fastener, joistSpanFt, rim } = input;
  const span = Math.max(joistSpanFt, 0.01);
  if (span > LEDGER_TABLE_MAX_SPAN_FT + 1e-9) return { spacingIn: 0, rule: RULE.ledger };
  if (fastener === "ledgerlok" || fastener === "sdws") {
    if (load === 70) return { spacingIn: 0, rule: fastener === "ledgerlok" ? "FastenMaster LedgerLOK bulletin, Table 1" : "Simpson fastening guide, SDWS ledger table" };
    const row = load === 40 ? 40 : 60;
    if (fastener === "ledgerlok") {
      const t = LEDGERLOK_ROWS[row];
      const vals = rim === "engineered" ? t.engineered : input.hemFirLedger ? t.lumberHemFir : t.lumber;
      return { spacingIn: readRow(LEDGER_SPANS_FT, vals, span, true), rule: "FastenMaster LedgerLOK bulletin, Table 1" };
    }
    const t = SDWS_ROWS[row];
    return { spacingIn: readRow(LEDGER_SPANS_FT, rim === "engineered" ? t.engineered : t.lumber, span, true), rule: "Simpson fastening guide, SDWS ledger table" };
  }
  // The code's own columns. A concrete anchor is spaced by its maker; it is
  // COUNTED here at the through-bolt column, and the studio says so.
  const col = fastener === "lag" ? 1 : fastener === "bolt-gap" ? 3 : 2;
  const rows = LEDGER_ROWS[load];
  const code = Math.floor(readRow(rows.map((r) => r[0]), rows.map((r) => r[col]), span) + 1e-9);
  if (rim === "engineered" && fastener !== "anchor" && load === 40) {
    const awc = readRow(LEDGER_SPANS_FT, DCA6_ENGINEERED_RIM_40, span, true);
    return awc < code ? { spacingIn: awc, rule: "AWC DCA 6 Table 5 (engineered rim)" } : { spacingIn: code, rule: RULE.ledger };
  }
  return { spacingIn: code, rule: RULE.ledger };
}

/** Lateral ties to the house (R507.9.2): two 1,500-lb hold-downs, or four 750-lb ones. */
export const LATERAL_TIES = { two: { count: 2, capacityLb: 1500 }, four: { count: 4, capacityLb: 750 } } as const;

/* ------------------------------------------------------------------ */
/*  Decking — Table R507.7                                             */
/* ------------------------------------------------------------------ */

/**
 * The widest joist spacing under WOOD deck boards, inches, for a board that
 * rests on three joists or more. Composite and PVC boards go by their label
 * and their maker (catalog.ts carries those).
 */
export function woodDeckingMaxSpacingIn(thickness: "5/4" | "2x", diagonal: boolean): number {
  if (thickness === "2x") return 24;
  return diagonal ? 12 : 16;
}

/* ------------------------------------------------------------------ */
/*  Guards and stairs — read for the notes; the stair builder comes later */
/* ------------------------------------------------------------------ */

/** A guard is required where the walking surface is more than this above the ground (R312.1.1). */
export const GUARD_REQUIRED_ABOVE_IN = 30;
export const GUARD_MIN_HEIGHT_IN = 36;
/** Stairs (R311.7.5): the tallest riser and the shortest tread. */
export const RISER_MAX_IN = 7.75;
export const TREAD_MIN_IN = 10;
export const STAIR_MIN_WIDTH_IN = 36;
/** A handrail from four risers up (R311.7.8). */
export const HANDRAIL_FROM_RISERS = 4;

/** Risers a stair needs to climb `heightIn`, each no taller than the code's riser. */
export function risersFor(heightIn: number): number {
  return heightIn > 0 ? Math.max(1, Math.ceil(heightIn / RISER_MAX_IN - 1e-9)) : 0;
}

/* ------------------------------------------------------------------ */
/*  Small-deck exemptions                                              */
/* ------------------------------------------------------------------ */

/** R105.2, item 10: no permit for a deck that is all four of these. */
export const PERMIT_EXEMPT = { maxAreaSqFt: 200, maxHeightIn: 30 } as const;

/** AWC DCA 6: a knee brace at each corner post taller than this. */
export const BRACE_ABOVE_IN = 24;

/** Feet-and-inches the way a tape reads: 7'-4". */
export function ftIn(inches: number): string {
  const whole = Math.round(inches);
  const ft = Math.floor(whole / 12);
  const inch = whole - ft * 12;
  return `${ft}'-${inch}"`;
}
