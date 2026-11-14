// OWENS CORNING OC LUMBER — THE MAKER'S OWN RULE BOOK (2026-11-12) — pure data.
//
// Owner: "add that OC into the framing build, like it's a wood, or it's a OC
// composite framing, so make it smart." OC Lumber is a glass-fiber-reinforced
// polyethylene board (GLAS-POWERED, Advantex fiberglass) sold for deck and dock
// framing: 2x4 to 2x12, 12, 16 and 20 ft, black as standard. It is NOT in the
// code's deck tables (IRC R507 is written for sawn wood), so a frame of it is
// sized here, from what Owens Corning prints:
//
//   · SPAN PERFORMANCE TABLES, pub. 10027125, September 2024 — joists 2x6 to
//     2x12 at 12/16/24 in. and 2- and 3-ply beams, for 40, 60, 80 and 100 psf
//     live load + 10 psf dead. The joist column used is L/360 under live load,
//     the same limit the code's own deck joist table is printed at.
//   · DrJ Engineering listing 2302-42 ("Performance Characteristics of Owens
//     Corning (OC) Lumber", rev. 2023-12-07) — the cantilevers, the built-up
//     post and what it carries, the screws, the hangers' least capacities.
//   · The installation guide for residential decks (pub. 10026715, Aug 2023) —
//     how the posts, beams and band joists are put together.
//
// THE NEWER TABLE WINS. The 2023 guide and the listing print LONGER joist spans
// (a 2x8 at 16 in.: 11'-2") than the 2024 tables (8'-0" at L/360; even the
// loosest column, L/120, stops at 10'-8"). The 2024 numbers are used, the safe
// side; the inspector may be shown either.
//
// HOW A TABLE IS READ (as codeTables.ts): never past the last column, and a
// value between two columns reads the next column up (the tables do not say
// "interpolation permitted"). A load the tables do not print reads the next
// heavier one: the code's 50 psf snow load on the 60 psf table, 70 on the 80.
// Where a heavier load's beam table prints a LONGER span than a lighter one's
// (it does, at the 4-ft column), the shorter is used.
//
// This is estimating grade. The building department decides.

import type { BuiltUpBeam, JoistSize, LoadPsf } from "./codeTables.data";
import type { SpacingIn } from "./codeTables";

/** The documents every OC number comes from — printed beside it. */
export const OC_SOURCES = {
  spans: { title: "Owens Corning OC Lumber Span Performance Tables (pub. 10027125, September 2024)", url: "https://dcpd6wotaa0mb.cloudfront.net/mdms/dms/CSB/10027125/10027125-OC-Lumber-Structural-Framing-Span-Performance-Table.pdf" },
  listing: { title: "DrJ Engineering listing 2302-42, Performance Characteristics of Owens Corning (OC) Lumber", url: "https://dcpd6wotaa0mb.cloudfront.net/mdms/dms/CSB/10026716/10026716-OC%E2%84%A2-Lumber-Products-Performance-Bulletins---Post-Span-Performance-.pdf" },
  guide: { title: "Owens Corning Lumber Installation Guide for Residential Deck Construction (pub. 10026715)", url: "https://www.thedecksupply.com/wp-content/uploads/2023/12/10026715-OC-Lumber-Installation-Guide-for-Residential-Deck-Construction.pdf" },
  /** Owens Corning Lumber's technical line, from the guide. */
  phone: "855-909-9501",
} as const;

/** Where each kind of OC number is written — what the checks and the plans print beside it. */
export const OC_RULE = {
  joist: "Owens Corning span tables (Sept 2024), joists at L/360",
  cantilever: "DrJ listing 2302-42, 6.3.1 — 2 ft or ¼ of the span",
  beam: "Owens Corning span tables (Sept 2024), beams",
  beamCantilever: "DrJ listing 2302-42, 6.4.1 — 2 ft or ¼ of the post spacing",
  post: "DrJ listing 2302-42, Table 5 — built-up OC post",
  bracing: "DrJ listing 2302-42, 6.6.2 — every post braced",
  treatment: "Owens Corning: rotproof, ground and water contact allowed",
  fasteners: "DrJ listing 2302-42, 6.7 — stainless composite screws",
  hangers: "DrJ listing 2302-42, Table 6",
  listing: "DrJ Engineering listing 2302-42",
} as const;

/** The lengths OC Lumber is stocked in, ft (a 2x6 runs to 28 ft on special order). */
export const OC_STOCK_LENGTHS_FT = [12, 16, 20] as const;

/** The built-up post the listing tabulates: three 2x6 OC boards screwed together. */
export const OC_POST = "3-2x6" as const;
/** A post size as people say it: "6x6", or "3-ply 2x6 OC" for the built-up OC post. */
export const postWords = (post: string): string => (post === OC_POST ? "3-ply 2x6 OC" : post);
/** As it measures: 5 1/2 in. along the beam, 4 1/2 in. (three plies) across. */
export const OC_POST_ACTUAL_IN = [5.5, 4.5] as const;
/** The tallest post the listing allows (6.6.1), braced diagonally (6.6.2). */
export const OC_POST_MAX_HEIGHT_IN = 108;
/** What one built-up post carries (Table 5), lb: under a 2-ply beam, and under a 3-ply one. */
export const OC_POST_CAPACITY_LB = { 2: 5500, 3: 8250 } as const;
/** The guide's notched post under a 2-ply beam: #10 x 3 in. screws in each of two rows, by the beam's depth. */
export const OC_NOTCH_SCREWS_PER_ROW: Record<number, number> = { 6: 2, 8: 3, 10: 4, 12: 5 };
/** Joist and beam cantilevers: 2 ft, or a quarter of the span, whichever is less (6.3.1, 6.4.1). */
export const OC_CANTILEVER_MAX_IN = 24;
/** Blocking between the joists every 4 to 5 ft (listing 2311-03, 8.4.6); the studio sets rows no farther apart than 5. */
export const OC_BLOCKING_MAX_FT = 5;
/** The guide asks to call Owens Corning for a beam on more than three posts. */
export const OC_GUIDE_MAX_POSTS = 3;

type OcRow = 40 | 60 | 80;
/** The table a deck's load is read on. */
export function ocLoadRow(load: LoadPsf): OcRow {
  return load <= 40 ? 40 : load <= 60 ? 60 : 80;
}
const LIGHTER: Record<OcRow, readonly OcRow[]> = { 40: [40], 60: [40, 60], 80: [40, 60, 80] };

/** Joists: the longest span at 12, 16 and 24 in. on center, inches (L/360 under live load, + 10 psf dead). */
const OC_JOIST_IN: Record<OcRow, Record<JoistSize, readonly [number, number, number]>> = {
  40: { "2x6": [77, 70, 61], "2x8": [105, 96, 83], "2x10": [131, 118, 103], "2x12": [154, 140, 122] },
  60: { "2x6": [67, 61, 53], "2x8": [92, 83, 73], "2x10": [113, 103, 90], "2x12": [135, 122, 107] },
  80: { "2x6": [61, 55, 48], "2x8": [83, 76, 66], "2x10": [103, 93, 82], "2x12": [122, 111, 97] },
};
const SPACING_COL: Record<SpacingIn, 0 | 1 | 2> = { 12: 0, 16: 1, 24: 2 };

/** The beam tables' columns: the length of the joists the beam carries, ft. */
export const OC_BEAM_JOIST_FT = [4, 5, 6, 7, 8, 9, 10, 11] as const;
/** The beam tables' last column. */
export const OC_BEAM_LAST_FT = OC_BEAM_JOIST_FT[OC_BEAM_JOIST_FT.length - 1];

type OcBeam = "2-2x6" | "3-2x6" | "2-2x8" | "3-2x8" | "2-2x10" | "3-2x10" | "2-2x12" | "3-2x12";
/** Beams on two supports (simple span), L/360 under live load: the post spacing, inches, by the joist length 4…11 ft. */
const OC_BEAM_IN: Record<OcRow, Record<OcBeam, readonly number[]>> = {
  40: {
    "2-2x6": [61, 59, 57, 55, 53, 52, 51, 49],
    "3-2x6": [70, 67, 65, 63, 61, 59, 58, 57],
    "2-2x8": [83, 80, 77, 75, 73, 71, 69, 68],
    "3-2x8": [96, 92, 89, 86, 83, 81, 79, 77],
    "2-2x10": [103, 99, 96, 93, 90, 87, 85, 83],
    "3-2x10": [118, 113, 109, 106, 103, 100, 98, 96],
    "2-2x12": [122, 118, 113, 110, 107, 104, 101, 99],
    "3-2x12": [140, 135, 130, 126, 122, 119, 116, 113],
  },
  60: {
    "2-2x6": [67, 62, 59, 56, 53, 51, 49, 48],
    "3-2x6": [77, 72, 67, 64, 61, 59, 57, 55],
    "2-2x8": [92, 85, 80, 76, 73, 70, 68, 65],
    "3-2x8": [105, 98, 92, 87, 83, 80, 77, 75],
    "2-2x10": [113, 105, 99, 94, 90, 85, 83, 81],
    "3-2x10": [130, 120, 113, 108, 103, 99, 96, 93],
    "2-2x12": [135, 125, 118, 112, 107, 103, 99, 96],
    "3-2x12": [154, 143, 135, 128, 122, 118, 113, 110],
  },
  80: {
    "2-2x6": [61, 57, 53, 51, 48, 46, 45, 43],
    "3-2x6": [70, 65, 61, 58, 55, 53, 51, 50],
    "2-2x8": [83, 77, 73, 69, 66, 64, 61, 59],
    "3-2x8": [96, 89, 83, 79, 76, 73, 70, 68],
    "2-2x10": [103, 96, 90, 85, 82, 78, 76, 73],
    "3-2x10": [118, 109, 103, 98, 93, 90, 87, 84],
    "2-2x12": [122, 113, 107, 101, 97, 93, 90, 87],
    "3-2x12": [140, 130, 118, 116, 111, 107, 103, 100],
  },
};

/** The longest span of an OC joist, inches. */
export function ocJoistMaxSpanIn(load: LoadPsf, size: JoistSize, spacing: SpacingIn): number {
  return OC_JOIST_IN[ocLoadRow(load)][size][SPACING_COL[spacing]];
}

/** The longest cantilever of an OC joist past its beam for a back span of `backSpanFt`, inches. */
export function ocJoistMaxCantileverIn(backSpanFt: number): number {
  if (!(backSpanFt > 0)) return 0;
  return Math.min(OC_CANTILEVER_MAX_IN, Math.floor((backSpanFt * 12) / 4 + 1e-9));
}

/**
 * The longest span between posts of a 2- or 3-ply OC beam that carries joists
 * `joistFt` long, inches; 0 when the tables do not size it (a single board, or
 * joists past 11 ft).
 */
export function ocBeamMaxSpanIn(load: LoadPsf, beam: BuiltUpBeam, joistFt: number): number {
  if (!(beam in OC_BEAM_IN[40])) return 0;
  const x = Math.max(joistFt, 0.01);
  if (x > OC_BEAM_LAST_FT + 1e-9) return 0;
  const col = OC_BEAM_JOIST_FT.findIndex((c) => x <= c + 1e-9);
  return Math.min(...LIGHTER[ocLoadRow(load)].map((row) => OC_BEAM_IN[row][beam as OcBeam][col]));
}

/** What one built-up OC post may carry under a beam of `beamPlies`, lb (a single board is not tabulated). */
export function ocPostCapacityLb(beamPlies: number): number {
  return beamPlies >= 3 ? OC_POST_CAPACITY_LB[3] : beamPlies === 2 ? OC_POST_CAPACITY_LB[2] : 0;
}

/** The deck area a built-up OC post may carry under that beam, at this load (+ 10 psf dead), sq ft. */
export function ocPostMaxAreaSqFt(load: LoadPsf, beamPlies: number): number {
  return ocPostCapacityLb(beamPlies) / (load + 10);
}

/** The tallest built-up OC post for the area it carries, inches (0 = more than the listing's post carries). */
export function ocPostMaxHeightIn(load: LoadPsf, tributarySqFt: number, beamPlies: number): number {
  return tributarySqFt * (load + 10) <= ocPostCapacityLb(beamPlies) + 1e-6 ? OC_POST_MAX_HEIGHT_IN : 0;
}
