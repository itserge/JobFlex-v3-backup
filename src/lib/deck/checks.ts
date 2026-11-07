// THE CODE-CHECK STRIP (2026-10-04) — pure.
//
// Owner: "it follows the code." Under the studio's plan and 3D sits one
// strip that says, part by part, what the frame is, what the table allows,
// and where that table is printed — and, when something is past the table,
// what one tap would bring it back. A contractor reads it the way an
// inspector would walk the deck: joists, beams, posts, footings, the
// ledger, then the things around the frame (guards, stairs, a low deck's
// clearance, the permit).
//
// Four levels:
//   pass — inside the table; the numbers are there to be read.
//   info — a fact worth knowing; nothing to do.
//   warn — allowed, but it needs a second look or an owner's decision.
//   fail — past the table or against the code as built here. The studio
//          will not hide it; a fail with a `fix` offers the way back.
//
// Facts about THIS deck only. Estimating grade — the building department
// decides.

import {
  BRACE_ABOVE_IN,
  GUARD_REQUIRED_ABOVE_IN,
  HANDRAIL_FROM_RISERS,
  JOIST_SIZES,
  LEDGER_FASTENER_LABEL,
  LEDGER_TABLE_MAX_SPAN_FT,
  PERMIT_EXEMPT,
  PIER_BLOCK_MAX_AREA_SQFT,
  PIER_BLOCK_MAX_HEIGHT_IN,
  POST_TABLE_MAX_AREA,
  POST_TABLE_MAX_IN,
  RULE,
  ftIn,
  joistDepthIn,
  joistMaxCantileverIn,
  joistMaxSpanIn,
  risersFor,
} from "./codeTables";
import { GROUND_CONTACT_WITHIN_IN, MIN_FRAME_CLEAR_IN, PIER_BLOCK, footingDepthIn, type DeckFrame } from "./frame";
import { FIXTURE_LABEL, GUTTER_LABEL, ROOFING_LABEL, WALL_FILL_LABEL, defaultStair, frontRadiusFt, normalizeDeckDesign, type DeckDesign, spaRectIn } from "./design";
import { STAIR_POST_CLEAR_IN, type RoofFrame } from "./roof";
import { RULE_HIP, RULE_RAFTER, RULE_RIDGE, RULE_ROOF_LOAD, RULE_TIES } from "./roofTables";
import { BETWEEN_LEVELS_STAIR_ID, betweenLevelsStair, type DeckStructure } from "./structure";
import { stairRules } from "./stairs";
import { SNOW_TABLE_MAX_PSF, TERMITE_LABEL, deckLoadForSnow, roofLoadForSnow } from "./site";
import { POST_ACTUAL_IN, STAIR_MIN_WIDTH_IN } from "./codeTables";
import { FRAMING_SPECIES, defaultFramingSpecies } from "./catalog";
import { cite, codeWords, inFrac, stateName } from "./stateCodes";
import { openingChecks } from "./openingChecks";

/** A change to a design, part by part; anything left out stays as it is. */
export type DeckPatch = {
  [K in keyof DeckDesign]?: DeckDesign[K] extends object ? Partial<DeckDesign[K]> : DeckDesign[K];
};

/** A design with a patch laid over it, brought back inside its rails. */
export function applyDeckPatch(design: DeckDesign, patch: DeckPatch): DeckDesign {
  const out: Record<string, unknown> = { ...design };
  for (const [key, value] of Object.entries(patch)) {
    const current = (design as unknown as Record<string, unknown>)[key];
    // The shape is replaced whole (a rectangle has no notch to keep), a list (the stairs, the fixtures) too; every other part is merged.
    out[key] = key !== "shape" && !Array.isArray(value) && value && typeof value === "object" && current && typeof current === "object" ? { ...(current as object), ...(value as object) } : value;
  }
  // A manual storey change replaces the photo's measured wall height. A new
  // photo supplies both fields together and must retain its own vertical scale.
  if (patch.house?.storeys !== undefined && patch.house.storeys !== design.house.storeys && !("eaveHeightFt" in patch.house)) {
    delete (out.house as Record<string, unknown>).eaveHeightFt;
  }
  return normalizeDeckDesign(out);
}

export interface DeckCheck {
  id: string;
  level: "pass" | "info" | "warn" | "fail";
  /** The part of the deck, as a heading: "Joists". */
  part: string;
  text: string;
  /** Where the rule is printed. */
  rule?: string;
  /** One tap that answers it. */
  fix?: { label: string; patch: DeckPatch };
  /** Other answers, where there is a real choice (a gable or a shed; a wood, composite or aluminum railing). Auto-fix takes `fix`. */
  alts?: Array<{ label: string; patch: DeckPatch }>;
}

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

export function deckChecks(s: DeckStructure): DeckCheck[] {
  const { design, frame, roof } = s;
  const out: DeckCheck[] = [];
  const add = (c: DeckCheck) => out.push(c);
  if (frame) deckFrameChecks(frame, add, roof, "");
  if (s.lower) deckFrameChecks(s.lower.frame, add, null, "Lower level — ");
  if (roof) roofChecks(roof, design, frame, add);
  siteChecks(s, add);
  codeCheck(s, add);
  if (frame) guardAndStairChecks(s, add);
  // The house's real doors and windows (2026-10-23, read off a photo): the deck against each one (lib/deck/openingChecks).
  openingChecks(s, add);
  electricalChecks(s, add);
  // ── The hot-tub spot ─────────────────────────────────────────────
  if (frame && design.spa.on) {
    const r = spaRectIn(design);
    if (r) {
      const sqFt = Math.round(((r.x1 - r.x0) / 12) * ((r.y1 - r.y0) / 12));
      add({
        id: "spa-framing",
        level: "info",
        part: "Hot tub spot",
        text: `Every joist under the ${design.spa.widthFt}×${design.spa.depthFt} ft tub footprint is doubled (a sister alongside), which carries twice the table's load. A filled tub reads near 100 psf over its ${sqFt} sq ft — the doubled ${frame.joistSize} at ${frame.spacingIn} in. covers it on these spans. AN ESTIMATE by the deck tables' method, not a tub engineering letter: the tub maker's pad drawing governs.`,
        rule: "Doubled joists under a concentrated load; IRC R507 tables read at twice the load share.",
      });
      if (design.heightIn > 30) {
        add({
          id: "spa-height",
          level: "warn",
          part: "Hot tub spot",
          text: `The tub stands ${Math.round(design.heightIn / 12 * 10) / 10} ft up. Above 30 in., the posts and footings under a filled tub are past what the deck tables say on their own — have an engineer size them before the tub is set.`,
          rule: "Concentrated loads above guard height are outside the prescriptive deck tables.",
        });
      }
    }
  }
  return out;
}

function deckFrameChecks(frame: DeckFrame, addRaw: (c: DeckCheck) => void, roof: RoofFrame | null, prefix: string): void {
  const add = (c: DeckCheck) => addRaw(prefix ? { ...c, id: `lower-${c.id}`, part: `${prefix}${c.part}` } : c);
  const { design, species, decking, wall, group, load } = frame;
  const attached = design.placement === "attached";
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;

  /* ── Joists ─────────────────────────────────────────────────────── */
  const maxSpan = joistMaxSpanIn(load, group, frame.joistSize, frame.spacingIn);
  const worstSpan = Math.max(...frame.zones.flatMap((z) => z.spansIn));
  const middleBeams = frame.beams.filter((b) => b.role === "middle").length;
  if (worstSpan <= maxSpan) {
    add({ id: "joist-span", level: "pass", part: "Joists", text: `${frame.joistSize} at ${frame.spacingIn} in. span ${ftIn(worstSpan)}; the table allows ${ftIn(maxSpan)} in ${species.short.toLowerCase()}${load > 40 ? ` at ${load} psf` : ""}.`, rule: RULE.joist });
  } else {
    const bigger = JOIST_SIZES.find((s) => joistMaxSpanIn(load, group, s, frame.spacingIn) >= worstSpan);
    add({
      id: "joist-span",
      level: "fail",
      part: "Joists",
      text: `${frame.joistSize} at ${frame.spacingIn} in. would span ${ftIn(worstSpan)}; the table stops at ${ftIn(maxSpan)}.`,
      rule: RULE.joist,
      fix: bigger ? { label: `Use ${bigger} joists`, patch: { framing: { joist: bigger } } } : { label: "Let the studio size the joists", patch: { framing: { joist: "auto", spacingIn: "auto", overhangFt: "auto" } } },
    });
  }
  if (design.framing.joist === "auto" && middleBeams > 0 && worstSpan <= maxSpan) {
    add({ id: "joist-middle-beam", level: "info", part: "Joists", text: `No joist in the table reaches across this deck in one span at ${frame.spacingIn} in., so ${middleBeams === 1 ? "a middle beam carries" : `${middleBeams} middle beams carry`} them.`, rule: RULE.joist });
  }
  for (const z of frame.zones) {
    const checkCant = (cant: number, backSpanIn: number, where: string, id: string) => {
      if (!(cant > 0.5)) return;
      const allowed = joistMaxCantileverIn(load, group, frame.joistSize, backSpanIn / 12);
      if (cant <= allowed) add({ id, level: "pass", part: "Joists", text: `Joists run ${ftIn(cant)} past the ${where} beam; the table allows ${ftIn(allowed)} behind a ${ftIn(backSpanIn)} span.`, rule: RULE.cantilever });
      else
        add({
          id,
          level: "fail",
          part: "Joists",
          text: allowed > 0 ? `Joists run ${ftIn(cant)} past the ${where} beam; the table allows ${ftIn(allowed)} behind a ${ftIn(backSpanIn)} span.` : `The table allows no overhang for a ${frame.joistSize} behind a ${ftIn(backSpanIn)} span.`,
          rule: RULE.cantilever,
          fix: { label: "Let the studio set the overhang", patch: { framing: { overhangFt: "auto" } } },
        });
    };
    checkCant(z.frontCantIn + frame.frontExtraCantIn, z.spansIn[z.spansIn.length - 1], front?.kind === "curve" ? "outer beam at the middle of the bow" : "outer", `joist-overhang-${z.zone.id}`);
    if (z.back === "beam") checkCant(z.backCantIn, z.spansIn[0], "house-side", `joist-overhang-back-${z.zone.id}`);
  }
  if (front?.kind === "curve") {
    const R = frontRadiusFt(design.shape);
    const bendable = decking.family === "pvc" ? 4 : decking.family === "composite" ? 13 : decking.family === "mineral" ? 15 : Infinity;
    if (R < bendable) add({ id: "front-curve", level: "pass", part: "Front", text: `The bow is a ${R}-ft radius: the rim is laminated from three plies of treated plywood, the joists cut to the arc and blocked, ${decking.family === "pvc" || decking.family === "composite" || decking.family === "mineral" ? "the border heat-bent to the curve" : "the boards' ends cut to the curve"}.`, rule: "Professional Deck Builder / Fine Homebuilding, curved decks" });
    else add({ id: "front-curve", level: "info", part: "Front", text: `The bow is a ${R}-ft radius. ${decking.label} will not bend that tight${decking.family === "composite" ? " (capped composite bends to about 13 ft with heat)" : decking.family === "pvc" ? "" : ""}: the border is left out and the boards' ends are cut to the arc instead.`, rule: "The maker's bending guide" });
  }
  if (front?.kind === "clipped") add({ id: "front-clip", level: "info", part: "Front", text: `Both front corners clipped ${front.clipFt} ft at 45°: the rim turns twice on each side, the joists there are cut short, the rail follows.` });
  if (frame.spacingIn > frame.deckingMaxSpacingIn) {
    add({
      id: "joist-spacing",
      level: "fail",
      part: "Joists",
      text: `${decking.label}${design.decking.diagonal ? " on the diagonal" : ""} may sit on joists no more than ${frame.deckingMaxSpacingIn} in. apart; these are at ${frame.spacingIn} in.`,
      rule: decking.source === "code" ? RULE.decking : decking.sourceNote,
      fix: { label: `Space the joists at ${frame.deckingMaxSpacingIn >= 16 ? 16 : 12} in.`, patch: { framing: { spacingIn: frame.deckingMaxSpacingIn >= 16 ? 16 : 12 } } },
    });
  } else {
    add({ id: "joist-spacing", level: decking.source === "trade" ? "info" : "pass", part: "Joists", text: `${decking.label}${design.decking.diagonal ? " on the diagonal" : ""} may sit on joists up to ${frame.deckingMaxSpacingIn} in. apart${decking.source === "trade" ? " by the yard's usual practice — confirm it with your supplier" : ""}.`, rule: decking.source === "code" ? RULE.decking : decking.source === "maker" ? "The maker's installation guide" : undefined });
  }

  /* ── Beams ──────────────────────────────────────────────────────── */
  if (frame.beamKindNote) add({ id: "beam-kind", level: "info", part: "Beams", text: frame.beamKindNote, rule: RULE.solidBeam });
  if (design.framing.beamStyle === "auto" && frame.beamStyle === "flush") {
    add({ id: "beam-flush", level: "info", part: "Beams", text: `At ${design.heightIn} in. there is no room for a beam under the joists, so the beams sit flush and the joists hang on them.`, rule: RULE.flushBeam });
  }
  if (frame.flags.droppedDoesNotFit) {
    add({ id: "beam-fit", level: "fail", part: "Beams", text: `A beam under the joists does not clear the footings on a deck ${design.heightIn} in. high.`, fix: { label: "Set the beams flush", patch: { framing: { beamStyle: "flush" } } } });
  }
  const joistDepth = joistDepthIn(frame.joistSize);
  for (const b of frame.beams) {
    const name = `${b.spec.size} ${b.role === "middle" ? "middle " : b.role === "back" ? "house-side " : ""}beam`;
    const table = b.table === "DCA6" ? RULE.solidBeam : RULE.beam;
    const carried = b.table === "DCA6" && !b.bothSides ? `${ftIn(b.tableSpanFt * 12)} joists` : `an effective joist span of ${ftIn(b.tableSpanFt * 12)}`;
    if (frame.flags.beamBeyondTable.includes(b.id) || !(b.maxSpanIn > 0)) {
      add({
        id: `beam-${b.id}`,
        level: "fail",
        part: "Beams",
        text: `No ${frame.beamKind === "solid" ? "solid" : "built-up"} beam in the table carries ${carried}. An engineer sizes this one, or the joists get another beam line.`,
        rule: table,
        fix: frame.beamKind === "solid" ? { label: "Try built-up beams", patch: { framing: { beamKind: "built-up", beam: "auto" } } } : undefined,
      });
      continue;
    }
    if (b.spanIn > b.maxSpanIn + 0.01) {
      add({ id: `beam-${b.id}`, level: "fail", part: "Beams", text: `${name}: posts ${ftIn(b.spanIn)} apart; the table allows ${ftIn(b.maxSpanIn)} under ${carried}.`, rule: table, fix: { label: "Let the studio size the beams", patch: { framing: { beam: "auto" } } } });
    } else {
      add({ id: `beam-${b.id}`, level: "pass", part: "Beams", text: `${name}, ${ftIn(b.x1 - b.x0)} on ${plural(b.postXs.length, "post")}: ${ftIn(b.spanIn)} between posts; the table allows ${ftIn(b.maxSpanIn)} under ${carried}.`, rule: table });
    }
    if (b.endIn > b.spanIn / 4 + 0.01) add({ id: `beam-end-${b.id}`, level: "fail", part: "Beams", text: `${name} runs ${ftIn(b.endIn)} past its end posts; a quarter of the span is ${ftIn(b.spanIn / 4)}.`, rule: RULE.beamCantilever });
    if (b.style === "flush" && b.spec.depthIn < joistDepth) {
      add({ id: `beam-depth-${b.id}`, level: "fail", part: "Beams", text: `A flush ${b.spec.size} is shallower than the ${frame.joistSize} joists that hang on it.`, rule: RULE.flushBeam, fix: { label: "Let the studio size the beams", patch: { framing: { beam: "auto" } } } });
    }
    if (b.bothSides) {
      add({ id: `beam-both-${b.id}`, level: "warn", part: "Beams", text: `The ${b.spec.size} middle beam carries joists on both sides. The code's beam table is printed for joists on one side, so this one is sized from the strip of deck it really carries — show it to the building office.`, rule: RULE.beam });
    }
  }

  /* ── Posts ──────────────────────────────────────────────────────── */
  if (frame.posts.length) {
    const tallest = frame.posts.reduce((m, p) => (p.heightIn > m.heightIn ? p : m));
    const heaviest = frame.posts.reduce((m, p) => (p.tributarySqFt > m.tributarySqFt ? p : m));
    const bad = frame.posts.filter((p) => p.heightIn > p.maxHeightIn + 0.01);
    if (tallest.heightIn > POST_TABLE_MAX_IN) {
      add({ id: "post-height", level: "fail", part: "Posts", text: `Posts ${ftIn(tallest.heightIn)} tall: the post table stops at 14 ft. A deck this high is an engineer's.`, rule: RULE.post });
    } else if (heaviest.tributarySqFt > POST_TABLE_MAX_AREA) {
      add({ id: "post-area", level: "fail", part: "Posts", text: `One post carries ${Math.round(heaviest.tributarySqFt)} sq ft of deck; the table stops at ${POST_TABLE_MAX_AREA}. More posts, or an engineer.`, rule: RULE.post, fix: design.framing.beam !== "auto" ? { label: "Let the studio size the beams", patch: { framing: { beam: "auto" } } } : undefined });
    } else if (bad.length) {
      const p = bad[0];
      add({
        id: "post-height",
        level: "fail",
        part: "Posts",
        text: p.maxHeightIn > 0 ? `A ${p.size} post ${ftIn(p.heightIn)} tall carrying ${Math.round(p.tributarySqFt)} sq ft: the table allows ${ftIn(p.maxHeightIn)}.` : `The table does not permit a ${p.size} post under ${Math.round(p.tributarySqFt)} sq ft of deck.`,
        rule: RULE.post,
        fix: design.framing.post !== "6x6" && design.framing.post !== "8x8" ? { label: "Use 6x6 posts", patch: { framing: { post: "6x6" } } } : design.framing.post === "6x6" ? { label: "Use 8x8 posts", patch: { framing: { post: "8x8" } } } : undefined,
      });
    } else if (tallest.heightIn >= 1) {
      add({ id: "post-height", level: "pass", part: "Posts", text: `${plural(frame.posts.length, "post")}, ${design.framing.post}, ${ftIn(tallest.heightIn)} tall, the busiest under ${Math.round(heaviest.tributarySqFt)} sq ft; the table allows ${ftIn(heaviest.maxHeightIn)} there.`, rule: RULE.post });
    } else {
      add({ id: "post-height", level: "info", part: "Posts", text: "The beams sit right on their footings: post bases, no posts.", rule: RULE.post });
    }
    if (design.framing.post === "4x4" || design.framing.post === "4x6") add({ id: "post-size", level: "info", part: "Posts", text: `The code's table allows a ${design.framing.post} here; the American Wood Council's guide builds every deck on 6x6 posts, and many building offices ask for them.`, rule: "AWC DCA 6" });
    const braced = frame.sticks.filter((s) => s.role === "brace").length;
    if (braced > 0) add({ id: "post-braces", level: "pass", part: "Posts", text: `${plural(braced, "knee brace")}: a 2x4 at each corner post, 2 ft down the post and 2 ft out, a 1/2-in. lag at each end.`, rule: RULE.bracing });
    else if (design.framing.braces === false && tallest.heightIn > BRACE_ABOVE_IN) add({ id: "post-braces", level: "warn", part: "Posts", text: `Posts over 2 ft with no knee braces. The American Wood Council's guide braces every corner post that tall.`, rule: RULE.bracing, fix: { label: "Add knee braces", patch: { framing: { braces: true } } } });
  }

  /* ── Footings ───────────────────────────────────────────────────── */
  if (frame.posts.length) {
    const depth = footingDepthIn(design);
    const beyond = frame.posts.filter((p) => !p.footing.required);
    const pours = frame.posts.filter((p) => p.footing.type === "poured");
    if (beyond.length) {
      add({ id: "footing-size", level: "fail", part: "Footings", text: `One footing carries more than 160 sq ft of deck — past the footing table. More posts, or an engineer.`, rule: RULE.footing });
    } else if (pours.length) {
      const pads = pours.map((p) => p.footing.padIn);
      const min = Math.min(...pads);
      const max = Math.max(...pads);
      const thick = Math.max(...pours.map((p) => p.footing.padThickIn));
      add({ id: "footing-size", level: "pass", part: "Footings", text: `${plural(pours.length, "poured footing")}, ${min === max ? `${min} in.` : `${min} to ${max} in.`} across and ${thick} in. thick at the base, on ${design.soilPsf.toLocaleString("en-US")} psf soil — each sized for the deck its post carries.`, rule: RULE.footing });
    }
    if (design.footing.type === "pier-block") {
      const allowed = !attached && frame.areaSqFt <= PIER_BLOCK_MAX_AREA_SQFT && design.heightIn <= PIER_BLOCK_MAX_HEIGHT_IN;
      const tooSmall = frame.posts.filter((p) => p.footing.required && p.footing.required.squareIn > PIER_BLOCK.baseIn);
      if (!allowed) {
        add({
          id: "footing-blocks",
          level: "fail",
          part: "Footings",
          text: `Precast pier blocks carry a deck only when it stands free of the house, is no bigger than ${PIER_BLOCK_MAX_AREA_SQFT} sq ft and no higher than ${PIER_BLOCK_MAX_HEIGHT_IN} in. This one ${attached ? "hangs on the house" : frame.areaSqFt > PIER_BLOCK_MAX_AREA_SQFT ? `is ${Math.round(frame.areaSqFt)} sq ft` : `is ${design.heightIn} in. high`}.`,
          rule: RULE.pierBlock,
          fix: { label: "Pour the footings", patch: { footing: { type: "poured" } } },
        });
      } else {
        add({ id: "footing-blocks", level: "warn", part: "Footings", text: `Pier blocks are allowed under a deck this small and low — but the code's wording is for joists set straight on the blocks, with no beams or posts. Where a permit is needed, ask the building office before building it this way.`, rule: RULE.pierBlock, fix: { label: "Pour the footings", patch: { footing: { type: "poured" } } } });
      }
      if (tooSmall.length) add({ id: "footing-block-size", level: "warn", part: "Footings", text: `${plural(tooSmall.length, "post")} need a footing wider than a ${PIER_BLOCK.baseIn}-in. block on this soil. More posts, or pour those.`, rule: RULE.footing, fix: { label: "Pour the footings", patch: { footing: { type: "poured" } } } });
    } else if (attached) {
      add({ id: "footing-depth", level: "pass", part: "Footings", text: depth > 12 ? `Dug ${depth} in. — below the ${design.frostIn}-in. frost line, as a deck on the house must be.` : `Dug ${depth} in. — the code's least depth; the frost line here is ${design.frostIn} in.`, rule: depth > 12 ? RULE.frost : RULE.footingDepth });
    } else {
      add({
        id: "footing-depth",
        level: "info",
        part: "Footings",
        text: design.footing.frostAlways ? `Dug ${depth} in., to the frost line, by the shop's choice.` : `Dug ${depth} in. The code asks for frost depth only where a deck is attached to the house${design.frostIn > 12 ? `; the frost line here is ${design.frostIn} in., and many building offices want it anyway` : ""}.`,
        rule: RULE.frost,
        fix: !design.footing.frostAlways && design.frostIn > 12 ? { label: `Dig to ${design.frostIn} in.`, patch: { footing: { frostAlways: true } } } : undefined,
      });
    }
    if (design.placement === "beside" && frame.posts.some((p) => p.y < 60)) add({ id: "footing-near-house", level: "info", part: "Footings", text: "Footings within 5 ft of the house foundation go down to the level of the house footing, so they do not load the backfill against the wall.", rule: "AWC DCA 6" });
  }

  /* ── Ledger, or standing free ───────────────────────────────────── */
  if (attached) {
    const worst = frame.ledgers.reduce((m, l) => (l.joistSpanFt > m ? l.joistSpanFt : m), 0);
    const untabled = frame.ledgers.filter((l) => !(l.spacingIn > 0));
    const fasteners = frame.ledgers.reduce((a, l) => a + l.fasteners, 0);
    const label = LEDGER_FASTENER_LABEL[design.ledger.fastener];
    if (worst > LEDGER_TABLE_MAX_SPAN_FT) {
      add({ id: "ledger", level: "fail", part: "Ledger", text: `Joists ${ftIn(worst * 12)} long hang on the ledger; the ledger table stops at 18 ft. A middle beam, or an engineer.`, rule: RULE.ledger });
    } else if (untabled.length) {
      add({ id: "ledger", level: "fail", part: "Ledger", text: `${label.replace(/^(.)/, (c) => c.toUpperCase())} have no printed spacing at ${load} psf${wall.rim === "engineered" ? " on an engineered rim" : ""}.`, rule: untabled[0].rule, fix: wall.fasteners.includes("lag") ? { label: "Use 1/2-in. lag screws", patch: { ledger: { fastener: "lag" } } } : undefined });
    } else {
      const spacings = [...new Set(frame.ledgers.map((l) => l.spacingIn))].sort((a, b) => a - b);
      add({ id: "ledger", level: "pass", part: "Ledger", text: `${plural(fasteners, "fastener")}: ${label} every ${spacings.join(" / ")} in., in two staggered rows, for ${ftIn(worst * 12)} joists.`, rule: frame.ledgers[0].rule });
    }
    add({ id: "ledger-wall", level: "info", part: "Ledger", text: wall.why, rule: RULE.ledgerWall });
    if (design.ledger.fastener === "anchor") add({ id: "ledger-anchor", level: "warn", part: "Ledger", text: "Concrete anchors are counted at the through-bolt spacing. The anchor maker's own table sets the real spacing and embedment — check it before ordering.", rule: "AWC DCA 6" });
    add({ id: "ledger-flashing", level: "pass", part: "Ledger", text: "Flashed: metal cap flashing over the ledger, membrane behind it and over its top. No aluminum against copper-treated lumber.", rule: "IRC R507.2.4" });
    add({ id: "ledger-lateral", level: "pass", part: "Ledger", text: design.ledger.lateral === "four" ? "Four 750-lb ties hold the deck to the house against sideways movement." : "Two 1,500-lb hold-downs, one within 2 ft of each end, hold the deck to the house against sideways movement.", rule: RULE.lateral });
  } else {
    if (design.placement === "beside") add({ id: "free-wall", level: "info", part: "Standing free", text: wall.ledger ? "Framed on its own posts beside the house, by choice: nothing hangs on the wall." : wall.why, rule: wall.ledger ? RULE.selfSupporting : RULE.ledgerWall });
    add({ id: "free-lateral", level: "warn", part: "Standing free", text: "A deck that stands free must resist sideways movement on its own. Neither the code nor the American Wood Council's guide prints a bracing design for one; the knee braces here are a starting point — have the bracing looked at where a permit is needed.", rule: "AWC DCA 6, commentary" });
    if (frame.areaSqFt <= PERMIT_EXEMPT.maxAreaSqFt && design.heightIn <= PERMIT_EXEMPT.maxHeightIn) add({ id: "free-permit", level: "info", part: "Standing free", text: `No bigger than ${PERMIT_EXEMPT.maxAreaSqFt} sq ft, no higher than ${PERMIT_EXEMPT.maxHeightIn} in. and not attached: the model code asks for no permit, as long as the deck does not serve the house's required exit door. Local rules differ — ask.`, rule: RULE.permit });
  }

  /* ── The frame's lumber ─────────────────────────────────────────── */
  if (species.id === "spf") {
    const local = defaultFramingSpecies(design.site.state);
    const to = local !== "spf" ? local : "hem-fir";
    const toLabel = FRAMING_SPECIES.find((f) => f.id === to)?.short ?? to;
    add({ id: "lumber-spf", level: "warn", part: "Lumber", text: "Treated spruce-pine-fir is an above-ground stock. Order the posts, the ledger and the beams in a species treated for ground contact.", rule: RULE.treatment, fix: { label: `Frame it in ${toLabel.toLowerCase()}`, patch: { framing: { species: to } } } });
  }
  if (!species.treated) add({ id: "lumber-heart", level: "info", part: "Lumber", text: `${species.short}: only heartwood is naturally durable. Sapwood under a deck has to be pressure-treated.`, rule: RULE.treatment });
  if (design.extras.stainless) add({ id: "lumber-stainless", level: "info", part: "Lumber", text: "Stainless connectors and fasteners throughout — required within 300 ft of salt water.", rule: RULE.fasteners });

  /* ── Height: a low deck, a guard, the stairs ────────────────────── */
  if (frame.flags.tooLow) {
    const smaller = JOIST_SIZES.filter((s) => frame.joistTopIn - joistDepthIn(s) >= MIN_FRAME_CLEAR_IN);
    add({
      id: "low-fit",
      level: "fail",
      part: "Height",
      text: `At ${design.heightIn} in. the ${frame.joistSize} joists would sit ${frame.joistBottomIn <= 0 ? "in the ground" : `${Math.round(frame.joistBottomIn * 10) / 10} in. off the ground`}. Raise the deck, dig the ground out, or build it on sleepers over a slab.`,
      fix: smaller.length && design.framing.joist !== "auto" ? { label: "Let the studio size the joists", patch: { framing: { joist: "auto" } } } : undefined,
    });
  } else if (frame.joistBottomIn < GROUND_CONTACT_WITHIN_IN) {
    add({ id: "low-contact", level: "info", part: "Height", text: `The frame is ${Math.round(frame.joistBottomIn * 10) / 10} in. off the ground. Wood within 6 in. of the soil is ordered ground-contact, and the material list says so.`, rule: RULE.treatment });
  }
  const lowestBeam = frame.beams.length ? Math.min(...frame.beams.map((b) => b.bottomIn)) : frame.joistBottomIn;
  if (!frame.flags.tooLow && lowestBeam < 0) add({ id: "low-beam", level: "fail", part: "Height", text: `The beams are deeper than the deck is high: their undersides would be ${Math.round(-lowestBeam * 10) / 10} in. in the ground.`, fix: { label: "Let the studio size the beams", patch: { framing: { beam: "auto", beamStyle: "auto" } } } });
  if (decking.minClearanceIn && !frame.flags.tooLow && frame.joistBottomIn < decking.minClearanceIn) add({ id: "low-air", level: "warn", part: "Height", text: `${decking.label} wants at least ${decking.minClearanceIn} in. of open air under the joists; this frame leaves ${Math.round(frame.joistBottomIn * 10) / 10} in.`, rule: "The maker's installation guide", fix: { label: `Raise the deck to ${Math.ceil(design.heightIn + (decking.minClearanceIn - frame.joistBottomIn))} in.`, patch: { heightIn: Math.ceil(design.heightIn + (decking.minClearanceIn - frame.joistBottomIn)) } } });

  /* ── Load ───────────────────────────────────────────────────────── */
  if (load > 40) add({ id: "load", level: "info", part: "Load", text: `Sized for a ${load} psf ground snow load — every table is read on its ${load} psf rows.`, rule: "IRC R507.1" });

  /* ── Decking ────────────────────────────────────────────────────── */
  const makerRows = frame.blockingRows.filter((r) => r.why === "maker").length;
  if (makerRows > 0) add({ id: "decking-blocking", level: "pass", part: "Decking", text: `Rows of solid blocking no more than ${decking.blockingRowsMaxFt} ft apart, as this board's maker requires.`, rule: "The maker's installation guide" });
  if (design.decking.diagonal) add({ id: "decking-diagonal", level: "info", part: "Decking", text: "Boards on the diagonal: 5 points more waste than you set, and the crew's diagonal rate on top." });

  /* ── The roof's posts through the deck ──────────────────────────────── */
  const roofPosts = frame.posts.filter((p) => p.roof);
  if (roof && roofPosts.length) {
    const beyond = roofPosts.filter((p) => !p.footing.required);
    const heaviest = roofPosts.reduce((m, p) => (p.tributarySqFt > m.tributarySqFt ? p : m));
    const lb = Math.round(heaviest.tributarySqFt * (load + 10));
    if (beyond.length) add({ id: "roof-post-footing", level: "fail", part: "Roof posts", text: `A roof post brings down about ${lb.toLocaleString("en-US")} lb — more than the footing table reads. An engineer sizes that footing, or the roof gets more posts.`, rule: RULE.footing });
    else add({ id: "roof-post-footing", level: "pass", part: "Roof posts", text: `${plural(roofPosts.length, "roof post")} run from their own footings up through the deck; the busiest brings down about ${lb.toLocaleString("en-US")} lb, read on the footing table as ${Math.round(heaviest.tributarySqFt)} sq ft of deck — a ${heaviest.footing.padIn}-in. footing.`, rule: RULE.footing });
  }
}


/* ------------------------------------------------------------------ */
/*  The roof (M2)                                                      */
/* ------------------------------------------------------------------ */

function roofChecks(roof: RoofFrame, design: DeckDesign, frame: DeckFrame | null, add: (c: DeckCheck) => void): void {
  const r = roof.roof;
  const pergola = roof.kind === "pergola";
  /** A louvered top closes into a roof: sized for the roof's load (2026-10-12). */
  const louvered = pergola && r.pergolaStyle === "louvered";
  const kindName = roof.kind === "double-tier" ? "double-tier" : roof.kind;
  const rafterRule = RULE_RAFTER[roof.roofLoad];

  if (roof.kindNote) add({ id: "roof-kind", level: "warn", part: "Roof", text: roof.kindNote, fix: { label: "Make it a gable roof", patch: { roof: { ...r, kind: "gable" } } }, alts: [{ label: "Make it a shed roof", patch: { roof: { ...r, kind: "shed" } } }] });

  /* ── Rafters ────────────────────────────────────────────────────────── */
  const span = roof.rafters.spanIn;
  const max = roof.rafters.maxSpanIn;
  const who = roof.rafterGroup === "RW" ? `${roof.species.short.toLowerCase()} (read on the Southern pine row, shortened — no rafter row is printed for it)` : roof.species.short.toLowerCase();
  if (pergola) {
    add({ id: "rafter-span", level: span <= max ? "pass" : "fail", part: "Pergola", text: span <= max ? `${roof.rafters.size} rafters at ${roof.rafters.spacingIn} in. span ${ftIn(span)} header to header; ${louvered ? `the ${roof.roofLoad} psf roof table — closed louvers are a roof —` : "the 20 psf roof table"} allows ${ftIn(max)} in ${who}.` : `${roof.rafters.size} rafters at ${roof.rafters.spacingIn} in. would span ${ftIn(span)}; the table stops at ${ftIn(max)}.`, rule: RULE_RAFTER[louvered ? roof.roofLoad : 20], fix: span <= max ? undefined : { label: "Let the studio size the rafters", patch: { roof: { ...r, rafter: "auto" } } } });
    if (louvered) add({ id: "pergola-open", level: "info", part: "Pergola", text: `Closed, the louvers make a roof: the frame is sized for ${roof.roofLoad} psf ${roof.roofLoad === 20 ? "of roof live load" : "of ground snow"} plus the blades' weight, like any roof here — and the louver kit's own rating has to meet it too.` });
    else add({ id: "pergola-open", level: "info", part: "Pergola", text: `Open slats: ${r.slats.size} every ${r.slats.spacingIn} in. The frame is sized for 10 psf, its own weight and the wind; it gives shade, not shelter.${design.site.groundSnowPsf >= 30 ? ` The ground snow here is ${design.site.groundSnowPsf} psf: slats hold some of it, and the building office may want the frame sized for snow.` : ""}` });
  } else if (roof.trusses) {
    // Trusses (2026-10-11): one piece header to header, designed and stamped by the truss maker for this roof.
    const T = roof.trusses;
    const why = T.why === "rafters" ? `Rafters would span ${ftIn(span)} — past the ${ftIn(max)} the table allows ${roof.rafters.size}, the deepest that fits` : T.why === "ridge" ? `No beam in the table spans the ridge, and a tie across it would be ${ftIn(T.spanIn)} — longer than stock lumber` : T.why === "post" ? `A ridge beam here would have to span ${ftIn(T.ridgeSpanIn ?? 0)} with only a king post at ${roof.attach === "wall" ? "its outer end" : "each end"} — about ${(T.kingLoadLb ?? 0).toLocaleString("en-US")} lb down one post, more than a footing table reads — and a tie across would be longer than stock` : "Trusses, as chosen";
    add({ id: "rafter-span", level: "pass", part: "Trusses", text: `${plural(T.count, "manufactured truss", "manufactured trusses")} 24 in. on center span ${ftIn(T.spanIn)} header to header at ${r.pitch}:12, ${T.chord} chords — no ridge beam, no ties, nothing standing in the middle. ${why}. The truss maker designs and stamps them for ${roof.roofLoad} psf ${roof.roofLoad === 20 ? "roof live load" : "ground snow"} and ${roof.deadPsf} psf dead; their drawings go to the building office with the permit, and they are braced as those drawings and BCSI-B3 say.`, rule: "IRC R802.10" });
  } else if (span <= max) {
    add({ id: "rafter-span", level: "pass", part: "Rafters", text: `${roof.rafters.size} at ${roof.rafters.spacingIn} in. span ${ftIn(span)} (horizontal, header to ${roof.ridge ? "ridge" : roof.ledger ? "ledger" : "peak"}); the table allows ${ftIn(max)} in ${who} at ${roof.roofLoad} psf${r.ceiling !== "none" ? ", shortened for the ceiling's weight" : ""}.`, rule: rafterRule });
  } else {
    const spacingFix = roof.rafters.spacingIn > 12;
    add({
      id: "rafter-span",
      level: "fail",
      part: "Rafters",
      text: `${roof.rafters.size} at ${roof.rafters.spacingIn} in. would span ${ftIn(span)}; the table stops at ${ftIn(max)}${roof.rafters.size === "2x12" ? " — a 2x12 is the deepest sawn rafter in the table: closer spacing, or an engineer" : ""}.`,
      rule: rafterRule,
      fix: r.rafter !== "auto" ? { label: "Let the studio size the rafters", patch: { roof: { ...r, rafter: "auto" } } } : spacingFix ? { label: `Space the rafters at ${roof.rafters.spacingIn === 24 ? 16 : 12} in.`, patch: { roof: { ...r, rafterSpacingIn: roof.rafters.spacingIn === 24 ? 16 : 12 } } } : undefined,
    });
  }
  if (!pergola && roof.flags.speciesEstimated) add({ id: "rafter-species", level: "warn", part: "Rafters", text: `No rafter table is printed for ${roof.species.short.toLowerCase()}: its spans are read on the Southern pine row and cut by 15%. Have the building office confirm, or frame the roof in a tabulated species.`, rule: rafterRule });
  if (!pergola && r.ceiling !== "none") add({ id: "rafter-ceiling", level: "info", part: "Rafters", text: `A ${r.ceiling === "tongue-groove" ? "board" : "panel"} ceiling adds weight: spans are read 7% shorter than the 10-psf-dead-load table prints. The code's 20-psf table is the one to show the building office.`, rule: rafterRule });
  // The hips designed as beams (2026-10-11; R802.3: with no bearing wall under the ridge a hip must be designed for the
  // load it carries there) — lib/deck/roof designHip.
  if (!pergola && roof.hips.count) {
    const H = roof.hips;
    const lb = (H.loadLb ?? 0).toLocaleString("en-US");
    if (H.beyond) add({ id: "roof-hips", level: "fail", part: "Rafters", text: `Each hip carries about ${lb} lb of jack rafters over ${ftIn(H.spanIn ?? 0)} from its corner post to the ridge — more than a 3-ply LVL 1¾×18 carries there. A post under the ridge's end, a smaller roof, or an engineer.`, rule: RULE_HIP });
    else add({ id: "roof-hips", level: "pass", part: "Rafters", text: `${plural(H.count, `${H.nominal} hip`)}: each carries about ${lb} lb of jack rafters over ${ftIn(H.spanIn ?? 0)} from its corner post to the ridge and is sized as a beam for it — bending and deflection on No. 2 values${H.kind === "lvl" ? ", past what sawn lumber carries, so an LVL" : ""} — as R802.3 asks of a hip with no bearing wall under the ridge.`, rule: RULE_HIP });
  }

  /* ── Headers ────────────────────────────────────────────────────────── */
  for (const h of roof.headers) {
    const name = h.cross ? `${h.spec.size} cross beam ${h.id.replace("x", "")}` : `${h.spec.size} header ${h.id.replace("h", "")}`;
    if (h.spec.kind === "lvl") {
      add({ id: `header-${h.id}`, level: h.maxSpanIn > 0 ? "pass" : "fail", part: "Headers", text: h.maxSpanIn > 0 ? `${name}, ${ftIn(h.lengthIn)} post to post: no sawn header in the deck beam table reaches, so an engineered beam is sized by the usual LVL figures (2.0E, 2,600 psi, L/240) — the maker's software or an engineer confirms the size.` : `${name}: even a three-ply 18-in. LVL does not carry ${ftIn(h.lengthIn)} under this roof. More posts, or an engineer.`, rule: "LVL maker's span tables" });
      continue;
    }
    if (!(h.maxSpanIn > 0)) {
      add({ id: `header-${h.id}`, level: "fail", part: "Headers", text: `${name} (${ftIn(h.lengthIn)}) carries more than the deck beam table reads at this roof load${h.kingPost ? " — it also holds the ridge's king post" : ""}. An engineer sizes it (an LVL), or the roof gets more posts.`, rule: RULE.beam, fix: r.header !== "auto" ? { label: "Let the studio size the headers", patch: { roof: { ...r, header: "auto" } } } : undefined });
    } else if (h.spanIn > h.maxSpanIn + 0.01) {
      add({ id: `header-${h.id}`, level: "fail", part: "Headers", text: `${name}: posts ${ftIn(h.spanIn)} apart; the table allows ${ftIn(h.maxSpanIn)} under this roof.`, rule: RULE.beam, fix: { label: "Let the studio size the headers", patch: { roof: { ...r, header: "auto" } } } });
    } else {
      add({ id: `header-${h.id}`, level: "pass", part: "Headers", text: `${name}, ${ftIn(h.lengthIn)} ${h.cross ? "from eave header to eave header, hung on them over a post at each end, with a king post at its middle" : `on ${plural(h.postAt.length - (h.wallEnd ? 1 : 0), "post")}${h.wallEnd ? " and the house" : ""}`}: ${ftIn(h.spanIn)} between supports; read on the deck beam table as a ${h.eqJoistSpanFt}-ft joist span at 40 psf (${roof.totalPsf} psf of roof${h.kingPost ? " plus the king post" : ""}), which allows ${ftIn(h.maxSpanIn)}.`, rule: RULE.beam });
    }
  }
  // THE RING (2026-10-12): hips with nothing under their tops push the corners out; a strap across every header joint.
  if (roof.ringTensionLb > 0) add({ id: "roof-ring", level: "pass", part: "Headers", text: `The hips push the corners out: about ${roof.ringTensionLb.toLocaleString("en-US")} lb of tension at each header joint. A tension strap rated for at least that across all ${roof.hardware.cornerStraps} joints holds the headers as a ring — they are in the material list.`, rule: RULE_HIP });
  // LVL OUT OF THE WEATHER (2026-10-12): an LVL is a dry-service beam.
  const lvlParts = [...new Set([...roof.headers.filter((h) => h.spec.kind === "lvl").map((h) => (h.cross ? "cross beams" : "headers")), ...(roof.ridge?.spec?.kind === "lvl" ? ["ridge beam"] : []), ...(roof.hips.kind === "lvl" ? ["hips"] : [])])];
  if (lvlParts.length) add({ id: "roof-lvl-weather", level: "warn", part: "Headers", text: pergola ? "LVL is made for dry service, and a pergola's beams take the rain: order an exterior-rated (treated) engineered beam, or sawn beams on more posts." : `LVL is made for dry service: wrap every exposed face of the engineered ${lvlParts.join(", ")} (flashing or trim), or order a treated PSL or glulam of the same size.`, rule: "LVL maker's installation guide", fix: r.header === "lvl" ? { label: "Sawn headers where they reach", patch: { roof: { ...r, header: "auto" } } } : undefined });
  if (roof.headers.length) add({ id: "header-method", level: "info", part: "Headers", text: `Roof headers are read on the code's DECK beam tables at the weight the roof really puts on them (${roof.roofLoad} psf ${roof.roofLoad === 20 ? "live" : "snow"} + ${roof.deadPsf} psf dead)${roof.headers.some((h) => h.eqJoistSpanFt < 6) ? "; a load lighter than the table's first column stretches its span by the square root of the load ratio, an estimate" : ""}. The code prints no table for a roof beam; show the building office the reading, or bring an engineer's letter.`, rule: RULE.beam });

  /* ── Ridge ──────────────────────────────────────────────────────────── */
  if (roof.trusses) {
    add({ id: "ridge", level: "pass", part: "Ridge", text: "No ridge beam or board to carry: each truss is one piece from header to header, plated at every joint, so the ridge is only where its two top chords meet.", rule: "IRC R802.10" });
  } else if (roof.ridge) {
    if (roof.ridge.kind === "beam") {
      if (roof.flags.ridgeBeyondTable) add({ id: "ridge", level: "fail", part: "Ridge", text: `A ${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam spanning ${ftIn(roof.ridge.spanIn)} is past the beam table. An engineered beam (LVL), a post under the ridge, or trusses.`, rule: RULE_RIDGE, fix: roof.kind === "gable" && roof.ridgeAcrossIn > 240 ? { label: "Frame it with trusses", patch: { roof: { ...r, ridge: "trusses" } } } : { label: "Use a ridge board with ties instead", patch: { roof: { ...r, ridge: "board" } } } });
      else add({ id: "ridge", level: "pass", part: "Ridge", text: `${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam, ${ftIn(roof.ridge.lengthIn)} long, spanning ${ftIn(roof.ridge.spanIn)} between ${roof.kind === "hip" && roof.crossBeams ? "two king posts at the hips' meeting points, each standing on a cross beam from eave header to eave header — the hips bear on it as beams" : roof.crossBeams ? `king posts — ${roof.crossBeams === 1 ? "one on a cross beam" : `${roof.crossBeams} on cross beams`} under the ridge, ${roof.kingPosts - roof.crossBeams === 2 ? "one at each end" : "one at the front, and the house"}` : roof.kingPosts === 2 ? "two king posts" : "the house and a king post"}; the rafters bear on it and the ceiling stays open — no ties needed.${roof.ridge.maxSpanIn ? ` Read on the deck beam table as a ${roof.ridge.eqJoistSpanFt}-ft joist span: allows ${ftIn(roof.ridge.maxSpanIn)}.` : ""}`, rule: RULE_RIDGE });
    } else if (roof.ties > 0) {
      add({ id: "ridge", level: roof.ridge.fellBack ? "info" : "pass", part: "Ridge", text: `${roof.ridge.fellBack ? `No beam in the table spans the ${ftIn(roof.ridge.spanIn)} ridge under this roof, so it is framed with a ` : ""}${roof.ridge.nominal} ridge board${roof.ridge.fellBack ? "" : ""} with ${plural(roof.ties, "2x6 rafter tie")} every 4 ft at the header line${roof.kind === "hip" ? " where the commons meet the ridge, and a tie from each end header back to them" : ""}: the ties take the rafters' thrust, so the board carries no load and the headers carry the whole slope.${roof.ridge.fellBack ? " Choose Ridge beam to price an engineered beam (LVL) and an open ceiling instead." : ""}`, rule: RULE_TIES });
    } else {
      // 2026-10-12: "a hip roof ties itself" was wrong — a board holds nothing up, and where commons meet on it they push
      // the headers apart. A hip with a board gets rafter ties (above); this is a hip or a Dutch gable's lone board.
      if (roof.attach === "wall") add({ id: "ridge", level: "pass", part: "Ridge", text: "On the house: the commons and the hips' tops hang on the ledger, so nothing pushes the headers apart.", rule: RULE_RIDGE });
      else add({ id: "ridge", level: "warn", part: "Ridge", text: `${roof.ridge.nominal} ridge board between the hips with nothing under it: the rafters that meet on it push the headers apart. Rafter ties across, or a ridge beam on king posts.`, rule: RULE_TIES, fix: { label: "A ridge beam on cross beams", patch: { roof: { ...r, ridge: "beam" } } } });
    }
  } else if (!pergola && roof.hips.count) {
    add({ id: "ridge", level: "info", part: "Ridge", text: roof.hardware.ringPlate ? `No ridge: the ${roof.hips.count} hips meet at a steel compression ring at the peak, the way a polygon gazebo is framed, and push the corners out — the headers hold them as a ring.` : `No ridge: the ${roof.hips.count} hips meet at the peak, carry the roof to the corner posts and push the corners out — the headers hold them as a ring.`, rule: RULE_HIP });
  }
  // A hip cannot be trussed here (trusses are a gable's): its fix is a ridge beam on a king post, which needs no ties (2026-10-22).
  if (roof.flags.tiesBeyondStock) add({ id: "ridge-ties", level: "fail", part: "Ridge", text: `Rafter ties across this roof would be ${ftIn(roof.ridgeAcrossIn)} long — past the longest stock lumber (20 ft). A spliced tie needs a designed splice; ${roof.kind === "gable" ? "trusses are the usual way" : "a ridge beam on a king post, which needs no ties, is the usual way"}.`, rule: RULE_TIES, fix: roof.kind === "gable" ? { label: "Frame it with trusses", patch: { roof: { ...r, ridge: "trusses" } } } : { label: "Carry the ridge on a beam", patch: { roof: { ...r, ridge: "beam" } } } });
  if (roof.flags.trussesBeyond) add({ id: "roof-trusses", level: "fail", part: "Trusses", text: `Trusses spanning ${ftIn(roof.ridgeAcrossIn)} are past what a common truss does here (40 ft): a girder truss or a bearing line in the middle — the truss maker's engineer.`, rule: "IRC R802.10" });
  if (roof.kind === "double-tier") add({ id: "roof-tier", level: "info", part: "Ridge", text: `Two tiers: the lower roof stops at a 2x8 ring beam on the hips; ${plural(roof.members.filter((m) => m.role === "tier-post").length, "4x4 post")} carry the upper roof above a 2-ft open band (screen or louvers are the owner's choice, not in the price).` });
  if (roof.kind === "gambrel") add({ id: "roof-gambrel", level: "info", part: "Ridge", text: `A gambrel: the lower slope at 20:12, the upper at ${r.pitch}:12, the two rafters of each pair meeting at the break on plywood gussets with a 2x6 tie across — ${plural(roof.breakTies, "tie")}. The ridge is ${roof.ridge?.kind === "beam" ? `a ${roof.ridge.spec?.size ?? roof.ridge.nominal} beam` : "a board"}.`, rule: "IRC R802.3 — rafters tied at every pair" });
  if (roof.kind === "dutch-gable") add({ id: "roof-dutch", level: "info", part: "Ridge", text: `A Dutch gable: the hips stop at a 2x6 cap beam, and a small gable (the gablet) stands on each end — studs at 16 in., sheathed and sided to match the house, a vent where the owner wants one.` });
  if (roof.flags.engineeredBeyond) add({ id: "roof-engineered", level: "fail", part: "Headers", text: "A span here is past even an engineered beam from the usual list. More posts, a shorter roof, or an engineer's design.", rule: "LVL maker's span tables" });
  if (roof.walls) add({ id: "roof-walls", level: "info", part: "Walls", text: `${WALL_FILL_LABEL[roof.walls.fill]} on ${plural(roof.walls.segments.length, "side")}, ${roof.walls.sqFt} sq ft${roof.walls.fill === "screen" ? `, over a 36-in. kneewall that stands in for the guard${roof.walls.doors ? `; ${plural(roof.walls.doors, "screen door")}` : ""}` : ", floor to header"}. The house side is never filled.`, rule: roof.walls.fill === "screen" ? "IRC R312 — the kneewall is the guard" : undefined });
  if (roof.louvers) add({ id: "roof-louvers", level: "info", part: "Pergola", text: `${roof.louvers.blades} louver blades that turn — open for sun, closed for shade or a light rain. The kit is priced per square foot of cover; a motor is the owner's upgrade.` });
  if (roof.archRafters) add({ id: "roof-arch", level: "info", part: "Pergola", text: "Arched rafters cut from 2x12 stock, two boards each; the slats follow the curve." });

  /* ── Posts ──────────────────────────────────────────────────────────── */
  {
    const n = roof.posts.length;
    const heaviest = roof.posts.reduce((m, p) => (p.loadLb > m.loadLb ? p : m), roof.posts[0]);
    if (roof.flags.postBeyondTable) add({ id: "roof-post-height", level: "fail", part: "Roof posts", text: `A ${r.post} post ${ftIn(r.eaveHeightIn)} tall under ${heaviest.loadLb.toLocaleString("en-US")} lb of roof: the post table allows ${ftIn(heaviest.maxHeightIn)} for that weight.`, rule: RULE.post, fix: r.post === "4x4" ? { label: "Use 6x6 posts", patch: { roof: { ...r, post: "6x6" } } } : r.post === "6x6" ? { label: "Use 8x8 posts", patch: { roof: { ...r, post: "8x8" } } } : undefined });
    else add({ id: "roof-post-height", level: "pass", part: "Roof posts", text: `${plural(n, `${r.post} post`)}, ${ftIn(r.eaveHeightIn)} from the ${roof.floor === "deck" ? "deck" : roof.floor === "slab" ? "slab" : "footings"} to the headers; the busiest carries about ${heaviest.loadLb.toLocaleString("en-US")} lb of roof, read on the post table as ${heaviest.tributarySqFt} sq ft of deck — it allows ${ftIn(heaviest.maxHeightIn)}.`, rule: RULE.post });
    if (roof.flags.postSpliced) add({ id: "roof-post-splice", level: "info", part: "Roof posts", text: "Footing to header is longer than a 20-ft post: the roof posts are spliced at the deck, bolted through the rim and the beam." });
    // A roof post in a stair's opening (2026-10-12). The posts a header's spans set stand beside the stairs on their own
    // (lib/deck/roof, CLEAR OF THE STAIRS); a ring corner carries the roof's corner and cannot move, so the stair slides.
    roof.postsInStair.forEach((p, i) => {
      const along = p.side === "front" ? p.x : p.y;
      const sideLen = p.side === "front" ? (frame ? Math.max(...frame.zones.map((z) => z.zone.x1)) : 0) : frame ? Math.max(...frame.zones.map((z) => z.zone.y1)) : 0;
      const pw = POST_ACTUAL_IN[r.post][0];
      const st = design.stairs.find((sd) => sd.level === "upper" && !sd.wrap && sd.side === p.side && along > sd.atFt * 12 - (sd.widthFt * 12) / 2 - pw / 2 && along < sd.atFt * 12 + (sd.widthFt * 12) / 2 + pw / 2);
      if (!st) return;
      const half = (st.widthFt * 12) / 2;
      const clear = pw / 2 + STAIR_POST_CLEAR_IN;
      // Away from the post: past it toward the side's middle.
      const atIn = along < sideLen / 2 ? Math.ceil(along + clear + half) : Math.floor(along - clear - half);
      const fits = sideLen > 0 && atIn - half >= 0 && atIn + half <= sideLen;
      const where = p.side === "front" ? "front" : `${p.side} side`;
      add({
        id: `roof-post-stair-${i + 1}`,
        level: "fail",
        part: "Roof posts",
        text: `A roof post stands in the stair's opening on the ${where}${p.corner ? ": the corner post carries the roof's corner and cannot move" : ""}. ${fits ? `Slide the stair ${Math.abs(Math.round(atIn - st.atFt * 12))} in. along the ${where} to clear it.` : "Move the stair along the side, or make it narrower, to clear it."}`,
        ...(fits ? { fix: { label: "Slide the stair clear of the post", patch: { stairs: design.stairs.map((sd) => (sd.id === st.id ? { ...sd, atFt: atIn / 12 } : sd)) } } } : {}),
      });
    });
    if (roof.floor === "slab") add({ id: "roof-post-slab", level: "info", part: "Roof posts", text: `Posts on stand-off bases, two wedge anchors each, into a 4-in. slab; the slab is a foot wider than the posts all round. Where the frost line is deep, the building office may want footings under the slab's corners.`, rule: RULE.footingDepth });
    if (roof.floor === "existing") add({ id: "roof-post-existing", level: "info", part: "Roof posts", text: `Posts on stand-off bases, two wedge anchors each, into the existing slab — no concrete in this price. The slab must be sound, at least 4 in. thick, and reach a foot past every post; a cracked or thin patio wants footings cut through it instead.`, rule: RULE.footingDepth });
    if (roof.floor === "ground") {
      const fts = roof.posts.map((p) => p.footing).filter((f): f is NonNullable<typeof f> => !!f);
      const pads = fts.map((f) => f.padIn);
      if (fts.length) add({ id: "roof-footings", level: fts.some((f) => !f.required) ? "fail" : "pass", part: "Roof posts", text: fts.some((f) => !f.required) ? "One post's footing is past the footing table — more posts, or an engineer." : `${plural(fts.length, "poured footing")}, ${Math.min(...pads) === Math.max(...pads) ? `${pads[0]} in.` : `${Math.min(...pads)} to ${Math.max(...pads)} in.`} across, ${fts[0].depthIn} in. deep${roof.attach === "wall" ? ", below the frost line as a structure on the house must be" : ""}.`, rule: RULE.footing });
    }
    if (roof.hardware.braces) add({ id: "roof-braces", level: "pass", part: "Roof posts", text: `${plural(roof.hardware.braces, "4x4 knee brace")} at the posts, 2 ft down and 2 ft out along the headers, a lag at each end — what holds a free-standing roof square.`, rule: RULE.bracing });
    else if (r.braces === false && roof.attach === "free") add({ id: "roof-braces", level: "warn", part: "Roof posts", text: "A free-standing roof with no knee braces has nothing holding it square but the post bases. Brace it, or have the bracing looked at where a permit is needed.", rule: RULE.bracing, fix: { label: "Add knee braces", patch: { roof: { ...r, braces: true } } } });
  }

  /* ── On the house ───────────────────────────────────────────────────── */
  if (roof.attach === "wall") {
    if (roof.ledger) add({ id: "roof-ledger", level: "pass", part: "On the house", text: `${roof.ledger.nominal} ledger on the wall, ${ftIn(roof.ledger.lengthIn)}, ${roof.ledger.fasteners} structural screws (two every 16 in., into the studs or the rim); the rafters hang on it in hangers. Flashed into the siding above.`, rule: RULE.ledgerBoard });
    if (roof.hardware.wallHangers) add({ id: "roof-wall-hangers", level: "pass", part: "On the house", text: "The side headers end on beam hangers bolted to the house framing; the ridge beam sits in a bracket on the wall.", rule: RULE.ledgerBoard });
    const meetIn = roof.ledger ? roof.ledger.zIn : roof.peakIn;
    const above = meetIn - roof.floorIn;
    // The windows themselves are checked when the house carries them (lib/deck/openingChecks, "roof-openings").
    const known = !!design.house.openings?.length;
    add({ id: "roof-wall-height", level: "info", part: "On the house", text: `The roof meets the house ${ftIn(Math.round(above))} above the ${roof.floor === "deck" ? "deck" : "floor"} (${ftIn(Math.round(meetIn))} above the ground). Check it clears ${known ? "" : "the windows and "}the house's own eave; the siding there is cut back and flashed (${Math.round(roof.wallFt)} ft).`, rule: "IRC R903.2" });
  } else if (!pergola) {
    add({ id: "roof-free", level: "info", part: "Standing free", text: `A free-standing ${kindName} roof: ${plural(roof.posts.length, "post")}, headers all round, knee braces. The building office may want its lateral bracing shown.`, rule: RULE.selfSupporting });
  }

  /* ── Covering, trim, gutters ────────────────────────────────────────── */
  if (!pergola) {
    const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
    add({ id: "roofing", level: "info", part: "Roofing", text: `${ROOFING_LABEL[r.roofing]} on ${Math.round(roof.roofAreaSqFt)} sq ft of roof: ${roof.squares} squares with ${Math.round((roof.wasteFactor - 1) * 100)}% waste${roof.sheets ? `, ${plural(roof.sheets, "sheet")} of sheathing` : ", on 2x4 purlins"}; ${Math.round(roof.eaveFt)} ft of eave, ${Math.round(roof.rakeFt)} ft of rake, ${Math.round(roof.hipFt + roof.ridgeFt)} ft of hip and ridge.`, rule: metalRoof ? "IRC R905.10" : r.roofing === "cedar-shake" ? "IRC R905.8" : "IRC R905.2" });
    if (r.pitch < 4 && !metalRoof) add({ id: "roof-pitch", level: r.pitch < 2 ? "fail" : "warn", part: "Roofing", text: r.pitch < 2 ? `Shingles are not permitted below 2:12.` : `At ${r.pitch}:12 shingles need two layers of underlayment (the code's low-slope rule); one layer is priced.`, rule: "IRC R905.2.2", fix: { label: "Pitch it 4:12", patch: { roof: { ...r, pitch: 4 } } }, alts: [{ label: "Use a standing-seam metal roof", patch: { roof: { ...r, roofing: "standing-seam" } } }] });
    if (metalRoof && r.roofDeck === "purlins") add({ id: "roof-purlins", level: "info", part: "Roofing", text: "Metal on open purlins: cheaper, and the underside shows. Condensation drips in cold weather unless the panels have an anti-condensation backing.", rule: "IRC R905.10.2" });
    if (roof.roofLoad >= 30) add({ id: "roof-snow", level: "info", part: "Load", text: `Sized for a ${roof.roofLoad} psf ground snow load; the rafter table is read on its ${roof.roofLoad} psf page.`, rule: RULE_ROOF_LOAD });
    if (roof.gutters) add({ id: "gutters", level: "pass", part: "Gutters", text: `${GUTTER_LABEL[roof.gutters.kind]}: ${Math.round(roof.gutters.lf)} ft on the eaves, ${plural(roof.gutters.downspouts, "downspout")} (one per run and one more every 35 ft), hangers every ${roof.roofLoad >= 30 ? 18 : 24} in.${roof.gutters.closed ? ", mitred at every corner" : ""}.`, rule: "SMACNA · IRC R801.3" });
    else if (design.structure === "covered-deck" && frame) add({ id: "gutters", level: "warn", part: "Gutters", text: `No gutters: ${Math.round(roof.eaveFt)} ft of eave drips onto the deck and splashes the house. 5-in. K-style aluminum is the usual answer.`, rule: "IRC R801.3", fix: { label: "Add 5-in. gutters", patch: { roof: { ...r, gutters: { kind: "k5", guards: false } } } } });
    if (r.fascia.eave || r.fascia.rake) add({ id: "roof-fascia", level: "info", part: "Trim", text: `A 2x sub-fascia across the rafter tails and ${r.fascia.finish === "aluminum-wrap" ? "aluminum wrap over it" : `a ${roof.rafters.size === "2x10" || roof.rafters.size === "2x12" ? "1x10" : "1x8"} ${r.fascia.finish === "pvc" ? "PVC" : "primed wood"} board`}${r.fascia.rake && roof.rakeFt ? ", rake boards on the fly rafters" : ""}${roof.soffitSqFt ? `, ${roof.soffitSqFt} sq ft of vented soffit` : ", open eaves (no soffit)"}.` });
  }
}

/* ------------------------------------------------------------------ */
/*  The site (M3)                                                      */
/* ------------------------------------------------------------------ */

function siteChecks(s: DeckStructure, add: (c: DeckCheck) => void): void {
  const { design } = s;
  const pg = design.site.groundSnowPsf;
  if (pg > 0) {
    const deck = deckLoadForSnow(pg);
    const roofPage = roofLoadForSnow(pg);
    if (pg > SNOW_TABLE_MAX_PSF) add({ id: "site-snow", level: "fail", part: "Site", text: `Ground snow here is about ${pg} psf — past the ${SNOW_TABLE_MAX_PSF} psf the code's deck and rafter tables carry. An engineer sets the design loads.`, rule: "IRC Figure R301.2(5) · R507.1" });
    else if (deck.load > design.loadPsf) add({ id: "site-snow", level: "warn", part: "Site", text: `Ground snow here is about ${pg} psf; the deck is read on the ${design.loadPsf} psf tables. Snow country reads the ${deck.load} psf column.`, rule: "IRC R507.1 · Figure R301.2(5)", fix: { label: `Design for ${deck.load} psf`, patch: { loadPsf: deck.load } } });
    else add({ id: "site-snow", level: "info", part: "Site", text: `Ground snow here is about ${pg} psf (the map's figure; the building office's number governs): the deck is read on its ${design.loadPsf} psf tables${s.roof ? `, the roof on the ${roofPage.load} psf rafter page` : ""}.`, rule: "IRC Figure R301.2(5)" });
  }
  if (design.site.termite === "very-heavy" || design.site.termite === "moderate-heavy") add({ id: "site-termite", level: "info", part: "Site", text: `Termite hazard here is ${TERMITE_LABEL[design.site.termite]}: lumber within 6 in. of the soil is ground-contact treated, and the posts stand on bases clear of the concrete; many offices want a termite shield or a soil treatment too.`, rule: "IRC R318 · Figure R301.2(6)" });
  if (s.gradePct >= 2 && s.frame) {
    const tallest = s.frame.posts.reduce((m, p) => (p.heightIn > m.heightIn ? p : m), s.frame.posts[0]);
    const shortest = s.frame.posts.reduce((m, p) => (p.heightIn < m.heightIn ? p : m), s.frame.posts[0]);
    add({ id: "site-slope", level: "info", part: "Site", text: `The ground falls about ${s.gradePct}% under the deck (${design.site.slope.outDropIn ? `${Math.abs(design.site.slope.outDropIn)} in. ${design.site.slope.outDropIn > 0 ? "away from" : "toward"} the house` : ""}${design.site.slope.outDropIn && design.site.slope.acrossDropIn ? ", " : ""}${design.site.slope.acrossDropIn ? `${Math.abs(design.site.slope.acrossDropIn)} in. ${design.site.slope.acrossDropIn > 0 ? "left to right" : "right to left"}` : ""}): the posts run from ${ftIn(shortest?.heightIn ?? 0)} to ${ftIn(tallest?.heightIn ?? 0)}, each footing dug from its own ground. The stairs land on the real ground.` });
  }
}

/* ------------------------------------------------------------------ */
/*  Guards, rails and stairs (M3)                                       */
/* ------------------------------------------------------------------ */

/**
 * The code the deck is checked against (lib/deck/stateCodes): the state's own
 * edition and its amendments — a warning where the state leaves it to its
 * cities, so the office that issues the permit is asked which edition.
 */
function codeCheck(s: DeckStructure, add: (c: DeckCheck) => void): void {
  const code = s.code;
  add({ id: "code", level: code.statewide ? "info" : "warn", part: "Code", text: codeWords(code), rule: `${code.short} · R507 deck provisions · AWC DCA 6 tables` });
  code.notes.slice(0, 4).forEach((n, i) => add({ id: `code-${i}`, level: "info", part: "Code", text: n }));
}

function guardAndStairChecks(s: DeckStructure, add: (c: DeckCheck) => void): void {
  const { design, rails, stairs, frame, code } = s;
  if (!frame) return;
  const H = design.heightIn;
  // The state's own figures: the guard's height, the riser and the tread (lib/deck/stateCodes).
  const SR = stairRules(code);
  const guardRule = cite(code, "R312.1", `a guard at least ${code.guardIn} in. high where the surface is more than 30 in. up`);
  if (rails.required && !rails.on) {
    add({ id: "guard", level: "warn", part: "Guard and stairs", text: `More than 30 in. up, so a guard at least ${code.guardIn} in. high is required on the ${Math.round(frame.openEdgeFt)} ft of open edge${s.lower ? " (and on the lower level where it is that high)" : ""}. No railing is in the price yet.`, rule: guardRule, fix: { label: "Add a treated-wood railing", patch: { rail: { type: "treated" } } }, alts: [{ label: "Add a composite railing", patch: { rail: { type: "composite" } } }, { label: "Add an aluminum railing", patch: { rail: { type: "aluminum" } } }] });
  } else if (rails.on) {
    add({ id: "guard", level: "pass", part: "Guard and stairs", text: `${Math.round(rails.lf)} ft of ${rails.label.toLowerCase()} railing ${rails.heightIn} in. high${rails.required ? " where the code asks for a guard" : " by choice"}: ${plural(rails.posts, "post")} ${design.rail.postSpacingFt} ft apart at most, bolted through the rim with tension ties; ${rails.infill === "balusters" ? "balusters 5 in. on centre leave the code's 4-in. gap" : rails.infill === "cable" ? "cable runs 3 in. apart, tensioned so a 4-in. sphere cannot pass" : rails.infill === "glass" ? "tempered glass panels" : rails.infill === "panel" ? "solid panels" : "horizontal rails 5 1/2 in. apart"}${rails.stairLf ? `; ${Math.round(rails.stairLf)} ft on the stairs` : ""}.`, rule: `${guardRule} · R312.1.3 · R507.2.4` });
    if (rails.system === "wood" && design.rail.postSpacingFt > 6) add({ id: "guard-posts", level: "warn", part: "Guard and stairs", text: `Wood 4x4 rail posts 8 ft apart: the 200-lb load on the top rail wants them no more than 6 ft apart (AWC's guide). Kits are rated by their maker.`, rule: "AWC DCA 6 · IRC Table R301.5", fix: { label: "Posts 6 ft apart", patch: { rail: { postSpacingFt: 6 } } } });
    if (rails.required && rails.heightIn < code.guardIn) add({ id: "guard-height", level: "fail", part: "Guard and stairs", text: `A guard must be at least ${code.guardIn} in. high${code.guardIn !== 36 && stateName(code.state) ? ` in ${stateName(code.state)}` : ""}.`, rule: guardRule, fix: { label: `Make it ${code.guardIn} in.`, patch: { rail: { heightIn: code.guardIn } } } });
  } else if (H <= GUARD_REQUIRED_ABOVE_IN) {
    add({ id: "guard", level: "info", part: "Guard and stairs", text: "No more than 30 in. up: the code asks for no guard.", rule: guardRule });
  }
  if (s.lower && s.stepDown?.stairWanted) {
    const atFt = Math.round(((s.lower.offsetXIn + (design.lower.widthFt * 12) / 2) / 12) * 10) / 10;
    add({ id: "lower-step", level: "warn", part: "Lower level", text: `The lower level is ${ftIn(s.stepDown.dropIn)} down — more than one riser. A stair between the levels is needed.`, rule: SR.riser, fix: { label: "Add a stair between the levels", patch: { stairs: [...design.stairs, { ...defaultStair(`s${design.stairs.length + 1}`, "front", atFt), widthFt: Math.min(6, design.lower.widthFt), landing: "patio" }] } } });
  } else if (s.lower && s.stepDown && s.stairs.some((b) => b.design.id === BETWEEN_LEVELS_STAIR_ID)) {
    // The engine built the steps between the levels (lib/deck/structure): said, and one tap makes them the contractor's to move.
    const between = s.stairs.find((b) => b.design.id === BETWEEN_LEVELS_STAIR_ID)!;
    add({ id: "lower-step", level: "info", part: "Lower level", text: `The lower level is ${ftIn(s.stepDown.dropIn)} down: ${between.risers} risers between the levels are built in the middle of it. Make them one of your stairs to move or resize them.`, rule: SR.riser, fix: { label: "Make it one of my stairs", patch: { stairs: [...design.stairs, betweenLevelsStair(design, s.lower.offsetXIn, `s${design.stairs.length + 1}`)] } } });
  } else if (s.lower && s.stepDown) add({ id: "lower-step", level: "info", part: "Lower level", text: `The lower level is one step down (${ftIn(s.stepDown.dropIn)}); where it stands less than 30 in. up no guard is needed between the levels.`, rule: guardRule });
  const risers = risersFor(H);
  if (stairs.length === 0 && risers > 1) add({ id: "stairs", level: "info", part: "Guard and stairs", text: `Reaching the ground takes ${risers} risers. No stairs are in the price yet.`, rule: RULE.stairs, fix: design.rail.type === "none" && risers >= HANDRAIL_FROM_RISERS ? { label: "Add a flight down the front, with a handrail", patch: { stairs: [defaultStair("s1", "front", design.shape.widthFt / 2)], rail: { type: "treated" } } } : { label: "Add a flight down the front", patch: { stairs: [defaultStair("s1", "front", design.shape.widthFt / 2)] } } });
  stairs.forEach((st, i) => {
    const tag = `stair-${st.design.id}`;
    const where = `${st.kind === "box" ? "Box steps" : `Stair ${i + 1}`} (${st.design.side})`;
    if (st.flags.tooTallForBox) add({ id: `${tag}-box`, level: "fail", part: where, text: `Box steps go three risers at most; this climb is ${plural(st.risers, "riser")}. It is framed as a flight.`, rule: SR.box, fix: { label: "Make it a flight", patch: { stairs: design.stairs.map((d) => (d.id === st.design.id ? { ...d, wrap: false } : d)) } } });
    if (st.risers === 0) {
      if (st.lands === "lower-deck") add({ id: `${tag}-step`, level: "info", part: where, text: "The lower level is one step down here: nothing to build but the riser's trim." });
      return;
    }
    add({ id: `${tag}-riser`, level: "pass", part: where, text: `${plural(st.risers, "riser")} of ${st.riserIn.toFixed(2)} in. (${inFrac(code.riserMaxIn)} at most), treads ${st.runIn + 1} in. deep with a 1-in. nosing (${code.treadMinIn} in. at least), ${st.widthIn} in. wide${st.lands === "lower-deck" ? ", landing on the lower level" : st.design.landing === "pad" ? ", onto a new pad" : st.design.landing === "patio" ? ", onto the patio" : ", onto pavers"}.`, rule: `${SR.riser} · ${SR.tread}` });
    if (st.widthIn < STAIR_MIN_WIDTH_IN) add({ id: `${tag}-width`, level: "fail", part: where, text: `${st.widthIn} in. wide: the code asks for 36 in. clear.`, rule: SR.width, fix: { label: "Make it 3 ft wide", patch: { stairs: design.stairs.map((d) => (d.id === st.design.id ? { ...d, widthFt: 3 } : d)) } } });
    if (st.kind === "flight") {
      add({ id: `${tag}-stringers`, level: "pass", part: where, text: `${plural(st.stringers.count, "2x12 cut stringer")} ${st.stringers.spacingIn} in. apart (${frame.decking.family === "pvc" ? "PVC treads want 10" : frame.decking.family === "composite" || frame.decking.family === "mineral" ? "composite treads want 12" : "wood treads take 16"}), ${ftIn(st.stringers.lengthIn)} each, on connectors at the rim and a treated kicker${st.pad ? " bolted to the pad" : ""}${st.midSupport ? "; a 2x8 beam on two posts midway — a cut stringer spans 6 ft at most" : ""}${st.landing ? "; a landing midway — a flight climbs 12 ft 3 in. at most" : ""}.`, rule: `${SR.stringer}${st.landing ? ` · ${SR.landing}` : ""}` });
      if (st.risers >= HANDRAIL_FROM_RISERS) {
        if (st.rail.sides === 0 && (st.rail.wanted > 0 || design.rail.type === "none")) add({ id: `${tag}-handrail`, level: "fail", part: where, text: `${plural(st.risers, "riser")}: a graspable handrail 34 to 38 in. above the nosings is required${st.guard ? ", and guards on both open sides" : ""}. ${design.rail.type === "none" ? "Choose a railing to put one on." : "None is on this stair."}`, rule: SR.handrail, fix: design.rail.type === "none" ? { label: "Add a treated-wood railing", patch: { rail: { type: "treated" } } } : { label: st.guard ? "Rails on both sides" : "A handrail on one side", patch: { stairs: design.stairs.map((d) => (d.id === st.design.id ? { ...d, handrail: st.guard ? "both" : "one" } : d)) } } });
        else if (st.guard && st.rail.sides < 2) add({ id: `${tag}-handrail`, level: "warn", part: where, text: `The stair is more than 30 in. up: both open sides want a guard, not one handrail.`, rule: SR.guard, fix: { label: "Rails on both sides", patch: { stairs: design.stairs.map((d) => (d.id === st.design.id ? { ...d, handrail: "both" } : d)) } } });
        else add({ id: `${tag}-handrail`, level: "pass", part: where, text: `${st.rail.sides === 2 ? "Rails on both sides" : "A handrail on one side"}, ${plural(st.rail.posts, "post")}, 36 in. above the nosings.`, rule: SR.handrail });
      }
    } else add({ id: `${tag}-box`, level: "pass", part: where, text: `${plural(st.treads, "level")} of 2x6 box frames wrapping ${st.design.wrapSides === 4 ? "all four sides" : st.design.wrapSides === 3 ? "three sides" : "the front"}, the lowest on ${plural(st.boxBlocks, "block")} over gravel, treads of the deck's boards.`, rule: SR.box });
  });
}

/* ------------------------------------------------------------------ */
/*  Electrical (M3)                                                    */
/* ------------------------------------------------------------------ */

function electricalChecks(s: DeckStructure, add: (c: DeckCheck) => void): void {
  const { design, electrical: el, frame } = s;
  // The code wants a receptacle on a deck of any size that opens from the house (NEC 210.52(E)(3)).
  if (frame && design.placement !== "detached" && frame.areaSqFt >= 20 && !design.electrical.fixtures.some((f) => f.kind === "outlet")) {
    add({ id: "elec-outlet", level: "info", part: "Electrical", text: "A deck opening from the house needs at least one weatherproof receptacle within its perimeter (the electrical code). None is in the price yet.", rule: "NEC 210.52(E)(3) · 210.8", fix: { label: "Add an outlet", patch: { electrical: { ...design.electrical, fixtures: [...design.electrical.fixtures, { id: `e${design.electrical.fixtures.length + 1}`, kind: "outlet", supply: "we", qty: 1, at: null }] } } } });
  }
  if (!el.on) return;
  for (const c of el.circuits) add({ id: `elec-${c.id}`, level: "pass", part: "Electrical", text: c.kind === "lights-outlets" ? `Circuit ${c.id.slice(1)}: 20 A, GFCI-protected, ${plural(c.devices, "device")} at ${c.va} VA, ${c.wireFt} ft of 12/2 from the panel.` : `Circuit ${c.id.slice(1)}: a ${c.amps}-A${c.poles === 2 ? " two-pole" : ""} circuit of its own for a ${c.kind === "heater-240" ? "4-kW 240-V" : "1.5-kW 120-V"} heater, ${c.wireFt} ft of ${c.wire}.`, rule: "NEC 210.8 · 210.23 · 424" });
  if (el.lv) add({ id: "elec-lv", level: "pass", part: "Electrical", text: `${plural(el.lv.transformers, "low-voltage transformer")} (${el.lv.watts} W of strips, caps and string lights at 150 W each), ${el.lv.wireFt} ft of 16/2.`, rule: "NEC 411" });
  if (el.trenchFt) add({ id: "elec-trench", level: "info", part: "Electrical", text: `The structure stands away from the house: the feed runs underground — about ${el.trenchFt} ft of trench and conduit, 18 in. deep (12 in. with GFCI protection in some jurisdictions).`, rule: "NEC Table 300.5" });
  if (el.fixtures.some((f) => f.kind === "heater")) add({ id: "elec-heater", level: "info", part: "Electrical", text: "Infrared heaters are hard-wired and mounted with the maker's clearances — usually 8 ft above the floor and clear of the roof, the rails and anything that burns.", rule: "The heater's listing" });
  if (el.byClient.length) add({ id: "elec-client", level: "info", part: "Electrical", text: `${el.byClient.length === 1 ? "One fixture is" : `${el.byClient.length} fixtures are`} the client's to buy (${[...new Set(el.byClient.map((f) => FIXTURE_LABEL[f.kind].toLowerCase()))].join(", ")}): drawn as a sample, priced at nothing — the box, the wire and the hanging are in the price. The proposal says "to be determined".` });
  add({ id: "elec-permit", level: "info", part: "Electrical", text: "Outdoor wiring is a licensed electrician's work and an inspection item; the permit is not in this price.", rule: "NEC 406.9 — weatherproof, in-use covers" });
}

/** The strip's verdict in one glance. */
export function checkSummary(checks: readonly DeckCheck[]): { fail: number; warn: number; pass: number; info: number } {
  const count = (level: DeckCheck["level"]) => checks.filter((c) => c.level === level).length;
  return { fail: count("fail"), warn: count("warn"), pass: count("pass"), info: count("info") };
}
