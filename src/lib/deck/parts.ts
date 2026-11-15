// CLICK A PART: TAKE IT OUT, SWAP IT, AND THE STRUCTURE RE-FRAMES (2026-11-09) — pure.
//
// Owner: "on the 3D, when it gets built, there are some 45-degree braces and
// some beams — make it click to delete. Somebody doesn't want those braces:
// you just click it and delete, or replace it for something else. I don't
// need that beam right here — delete it and you restructure the whole thing
// without that beam, to save money; or replace it for something smaller.
// Maybe we don't need that beam because a truss is up there. So contractors
// can click and remove and add. Make it smart."
//
// Three steps, each a pure function the studio calls:
//
//   1. `partAt` — the box the pointer landed on (the 3D reports its index in
//      the scene) becomes a PART the engine knows by name: this knee brace,
//      this beam, this post, the ridge, a rafter tie, a truss.
//   2. `partCard` — what that part DOES in the structure, and the choices a
//      framer really has for it: take this one out, take them all out, swap
//      its size, or the other way of framing that makes it unnecessary (a
//      ridge beam's king post goes when the roof is trussed; a middle beam
//      goes when a deeper joist spans the whole depth; a post goes when a
//      deeper beam spans between its neighbours). A part that carries the
//      structure says why it stays.
//   3. `tryChoice` — the choice is laid over the design, the tables re-run
//      and settle (lib/deck/settle), and what comes back is what changed, what
//      it does to the price, and anything the checks now object to. The card
//      shows this BEFORE the contractor commits, so "remove" is never a guess.
//
// Nothing here draws or stores anything: a choice is a DeckPatch, applied
// through the same door as every other change in the studio.

import { BRACE_ABOVE_IN, JOIST_SIZES, POST_ACTUAL_IN, POST_SIZES, SOLID_BEAMS, SPACINGS, ftIn } from "./codeTables";
import { wallType } from "./catalog";
import { addBeam, addPostUnder, addRoofPost, deckGrips, gripOfPart, removeBeamLine, removePost, roofCornerSides, roofSideOf, type DeckGrip } from "./byHand";
import { applyDeckPatch, deckChecks, type DeckPatch } from "./checks";
import { BUILT_UP_CHOICES, braceSizesFor, RAIL_MOUNT_LABEL, RAIL_MOUNT_WORDS, RAIL_SECTION_LABEL, ROOF_POST_LIMITS, ROOF_SIDE_LABEL, defaultRoofOpening, type DeckDesign, type RailSectionKey, type RoofDesign } from "./design";
import { priceDeck, type DeckPackage, type DeckPriceOptions } from "./pricing";
import { railMountLine } from "./rails";
import type { RoofMember } from "./roof";
import { ROOF_MEMBER_LAYER, SCENE_LAYERS, type DeckScene, type SceneLayer } from "./scene";
import { settleDesign } from "./settle";
import { BUILT_IN_LABEL, builtInWords } from "./builtins";
import type { FinishTarget, PartFinish } from "./finish";
import { BETWEEN_LEVELS_STAIR_ID, LOWER_KEY, buildStructure, structureLevels, type DeckStructure } from "./structure";

/* ------------------------------------------------------------------ */
/*  1. Which part is it                                                */
/* ------------------------------------------------------------------ */

export type PartKind =
  | "deck-brace"
  | "deck-beam"
  | "deck-post"
  | "joist"
  | "rim"
  | "ledger"
  | "blocking"
  | "roof-brace"
  | "roof-beam"
  | "cross-beam"
  | "king-post"
  | "ridge"
  | "rafter-tie"
  | "truss"
  | "rafter"
  | "roof-post"
  | "stair"
  | "rail"
  | "fascia"
  | "gutter"
  | "ceiling"
  | "walls"
  /** A bench, a bench with a back, a planter box or a privacy screen built into the deck (lib/deck/builtins). */
  | "built-in";

export interface PartRef {
  kind: PartKind;
  /** The engine's own name for it: a brace's key, a beam's, a post's or a header's id, a stair's id ("" where there is one of a kind). */
  id: string;
  level?: "upper" | "lower";
}

const DECK_LAYERS: readonly SceneLayer[] = ["post", "beam", "ledger", "joist", "rim", "blocking", "brace"];
const near = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => Math.hypot(ax - bx, ay - by, az - bz);

/** A roof member as a part. */
function roofPart(s: DeckStructure, m: RoofMember): PartRef | null {
  const roof = s.roof;
  if (!roof) return null;
  switch (m.role) {
    case "roof-brace":
      return { kind: "roof-brace", id: m.of ?? "" };
    case "header": {
      const h = roof.headers.find((x) => x.id === m.of);
      return h ? { kind: h.cross ? "cross-beam" : "roof-beam", id: h.id } : null;
    }
    case "king": {
      // The beam it stands on: a cross beam's middle, or a gable-end header.
      const on = roof.headers.find((h) => Math.hypot((h.x0 + h.x1) / 2 - m.cx, (h.y0 + h.y1) / 2 - m.cy) < 6 && h.kingPost);
      return { kind: "king-post", id: on?.id ?? "" };
    }
    case "ridge":
      return { kind: "ridge", id: "" };
    case "tie":
      return { kind: "rafter-tie", id: "" };
    case "truss":
      return { kind: "truss", id: "" };
    case "rafter":
    case "jack":
    case "fly":
      return { kind: "rafter", id: "" };
    case "roof-post": {
      const p = roof.posts.find((x) => Math.hypot(x.x - m.cx, x.y - m.cy) < 0.5);
      return p ? { kind: "roof-post", id: p.id } : null;
    }
    case "gutter":
    case "downspout":
      return { kind: "gutter", id: "" };
    default:
      return null;
  }
}

/**
 * The part a touch landed on. `boxIdx` is the scene's box (DeckPick.boxIdx); a flat face has none and is named by its
 * layer alone (the ceiling, a wall panel, a glass rail panel). Null for a part with nothing to choose (a board, a
 * shingle, a bolt).
 */
export function partAt(s: DeckStructure, scene: DeckScene, boxIdx: number | null | undefined, layer?: SceneLayer | string | null, ringIdx?: number | null): PartRef | null {
  // A board cut to a shape (2026-11-14): a step round a shaped deck is a stair's — the scene says whose it is.
  if (typeof ringIdx === "number" && ringIdx >= 0) {
    const of = scene.paints?.find((pt) => pt.rings.includes(ringIdx))?.of;
    if (of && s.stairs.some((st) => st.design.id === of)) return { kind: "stair", id: of };
    const ringOf = stairOfRing(s, scene, ringIdx);
    return ringOf ? { kind: "stair", id: ringOf } : null;
  }
  const b = typeof boxIdx === "number" ? scene.boxes[boxIdx] : undefined;
  const name: SceneLayer | undefined = b ? SCENE_LAYERS[b[0]] : (SCENE_LAYERS as readonly string[]).includes(layer ?? "") ? (layer as SceneLayer) : undefined;
  if (!name) return null;
  if (!b) {
    if (name === "ceiling") return { kind: "ceiling", id: "" };
    if (name === "wall" || name === "screen") return s.roof?.walls ? { kind: "walls", id: "" } : s.rails.on ? { kind: "rail", id: "" } : null;
    if (name === "glass") return { kind: "rail", id: "" };
    return null;
  }
  const [x, y, z] = [b[1] * 12, b[2] * 12, b[3] * 12];

  // A BUILT-IN (2026-11-14): its seat, legs, posts and boards are drawn on the deck's own layers — named by its role.
  const role = typeof boxIdx === "number" && scene.tags.length === scene.boxes.length && scene.tags[boxIdx] >= 0 ? scene.legend[scene.tags[boxIdx]]?.role ?? "" : "";
  if (/^(bench|planter|screen) /.test(role)) {
    let best: { id: string; d: number } | null = null;
    for (const bi of s.builtIns) {
      for (const m of bi.members) {
        const d = near(m.cx, m.cy, m.cz, x, y, z);
        if (d > 1.5 || (best && best.d <= d)) continue;
        best = { id: bi.design.id, d };
      }
    }
    if (best) return { kind: "built-in", id: best.id };
  }

  if (DECK_LAYERS.includes(name)) {
    let best: { ref: PartRef; d: number } | null = null;
    for (const level of structureLevels(s)) {
      const f = level.frame;
      for (const st of f.sticks) {
        if (st.role !== name) continue;
        const d = near(st.cx + level.offsetXIn, st.cy + level.offsetYIn, st.cz, x, y, z);
        if (d > 1.5 || (best && best.d <= d)) continue;
        const lower = level.id === "lower";
        let ref: PartRef | null = null;
        if (st.role === "brace") ref = { kind: "deck-brace", id: `${lower ? LOWER_KEY : ""}${st.of ?? ""}`, level: level.id };
        else if (st.role === "beam") ref = { kind: "deck-beam", id: st.of ?? "", level: level.id };
        else if (st.role === "post") {
          const p = f.posts.find((q) => Math.abs(q.x - st.cx) < 0.5 && Math.abs(q.y - st.cy) < 0.5);
          ref = p ? { kind: "deck-post", id: p.id, level: level.id } : null;
        } else if (st.role === "joist") ref = { kind: "joist", id: "", level: level.id };
        else if (st.role === "rim") ref = { kind: "rim", id: "", level: level.id };
        else if (st.role === "ledger") ref = { kind: "ledger", id: "", level: level.id };
        else if (st.role === "blocking") {
          const row = f.blockingRows.find((r) => Math.abs(r.y - st.cy) < 1);
          ref = { kind: "blocking", id: row?.why ?? "", level: level.id };
        }
        if (ref) best = { ref, d };
      }
    }
    return best?.ref ?? null;
  }

  if (s.roof) {
    let best: { m: RoofMember; d: number } | null = null;
    for (const m of s.roof.members) {
      if (ROOF_MEMBER_LAYER[m.role] !== name) continue;
      // A post standing through a deck is drawn in two, under the boards and over them: by its place in plan.
      const d = m.role === "roof-post" ? Math.hypot(m.cx - x, m.cy - y) : near(m.cx, m.cy, m.cz, x, y, z);
      if (d > 1.5 || (best && best.d <= d)) continue;
      best = { m, d };
    }
    if (best) return roofPart(s, best.m);
  }

  if (name === "stair") {
    let best: { id: string; d: number } | null = null;
    for (const st of s.stairs) {
      for (const m of st.members) {
        const d = near(m.cx, m.cy, m.cz, x, y, z);
        if (d > 1.5 || (best && best.d <= d)) continue;
        best = { id: st.design.id, d };
      }
    }
    return best ? { kind: "stair", id: best.id } : null;
  }
  if (name === "rail") return s.rails.on ? railPart(s, x, y, z) : null;
  if (name === "fascia") return { kind: "fascia", id: "" };
  return null;
}

/** The stair whose step a board cut to a shape is (a step round a shaped deck), by its ring's place against the stairs' own rings. */
function stairOfRing(s: DeckStructure, scene: DeckScene, ringIdx: number): string | null {
  const ring = scene.diagonal?.boards[ringIdx];
  if (!ring) return null;
  for (const st of s.stairs) {
    for (const t of st.treadRings ?? []) {
      // (The stair's rings are inches; the scene's, feet.)
      if (t.ring.length === ring.length && t.ring.every((v, i) => Math.abs(v / 12 - ring[i]) < 0.01)) return st.design.id;
    }
  }
  return null;
}

/**
 * The rail's section a box belongs to (2026-11-13): a level and the side its run stands along — "upper-front" — so one
 * side can be mounted another way than the rest. A stair's rail is the whole rail.
 */
function railPart(s: DeckStructure, x: number, y: number, z: number): PartRef {
  let best: { id: string; d: number } | null = null;
  for (const m of s.rails.members) {
    const d = near(m.cx, m.cy, m.cz, x, y, z);
    if (d > 1.5 || (best && best.d <= d)) continue;
    best = { id: m.of, d };
  }
  return { kind: "rail", id: best?.id ?? "" };
}

/** Every box of the scene that is this same part (a beam's plies, a post's two halves) — what the 3D lights. */
export function partBoxes(s: DeckStructure, scene: DeckScene, ref: PartRef, wholeKind = false): number[] {
  const out: number[] = [];
  scene.boxes.forEach((_, i) => {
    const r = partAt(s, scene, i);
    if (r && r.kind === ref.kind && (wholeKind || (r.id === ref.id && r.level === ref.level))) out.push(i);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  2. What can be done with it                                        */
/* ------------------------------------------------------------------ */

export interface PartChoice {
  id: string;
  /** remove: it goes; swap: something else stands in its place; add: one more of it; size: one of a row of sizes. */
  tone: "remove" | "swap" | "add" | "size";
  label: string;
  /** What it means, in a sentence, before it is tried. */
  note?: string;
  patch: DeckPatch;
  /** A size already on. */
  current?: boolean;
  /** A row of sizes this one belongs to ("Beam size — every beam"). */
  row?: string;
  /** Hovering it lights every part of the kind, not just this one. */
  whole?: boolean;
  /** Did it do what its label says? Read on the structure after the tables settled (a beam "removed" that the tables put back did not). */
  works?: (after: DeckStructure) => boolean;
}

export interface PartCard {
  ref: PartRef;
  /** "Knee brace", "Front beam", "Ridge beam". */
  title: string;
  /** What it does in the structure. */
  does: string;
  /** Why it cannot simply come out, when it cannot. */
  stays?: string;
  choices: PartChoice[];
  /** MOVED BY HAND (2026-11-13; lib/deck/byHand): a post or a beam that can be slid — where it stands, to type or nudge by the inch. */
  place?: DeckGrip;
  /** BOARDS OF ITS OWN (2026-11-14; lib/deck/finish): a stair or a built-in whose boards can be another line or colour — which, and the board now (null = the deck's own). */
  finish?: { target: FinishTarget; now: PartFinish | null; deck: string; deckProduct: string; deckColor: string };
}

/** The deck's own board, as a card offers it beside a board of its own: its name with its colour, its line, its colour. */
const deckBoardNow = (s: DeckStructure) => ({ deck: s.surface?.product.label ?? s.frame?.decking.label ?? "the deck's boards", deckProduct: s.design.decking.product, deckColor: s.design.decking.color });

/** A stair's or a built-in's boards set to a board of their own (`f`), or back to the deck's (null): the patch. */
export function finishPatch(d: DeckDesign, target: FinishTarget, f: PartFinish | null): DeckPatch {
  const set = <T extends { id: string; finish?: PartFinish }>(list: readonly T[]): T[] =>
    list.map((x) => {
      if (x.id !== target.id) return x;
      const { finish: _old, ...rest } = x;
      void _old;
      return (f ? { ...rest, finish: f } : rest) as T;
    });
  if (target.kind === "stair") return { stairs: set(d.stairs) };
  return { extras: { builtIns: set(d.extras.builtIns ?? []) } };
}

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const without = (list: readonly string[], id: string) => list.filter((x) => x !== id);
const withKey = (list: readonly string[], id: string) => [...without(list, id), id];
const roofPatch = (p: Partial<RoofDesign>): DeckPatch => ({ roof: p });

/** A row of sizes as choices: "auto" first, the one in use marked. */
function sizeRow<T extends string | number>(row: string, idPrefix: string, sizes: readonly T[], now: T | "auto", label: (v: T | "auto") => string, patch: (v: T | "auto") => DeckPatch): PartChoice[] {
  return (["auto", ...sizes] as Array<T | "auto">).map((v) => ({ id: `${idPrefix}-${v}`, tone: "size" as const, label: label(v), patch: patch(v), current: v === now, row }));
}

/** The ways a ridge can be framed, as choices — every one but the way it is framed now. */
function ridgeChoices(s: DeckStructure, extra: Partial<RoofDesign> = {}, also = ""): PartChoice[] {
  const roof = s.roof;
  if (!roof) return [];
  const out: PartChoice[] = [];
  const gable = roof.kind === "gable";
  const now = roof.trusses ? "trusses" : roof.ridge?.kind ?? "none";
  if (gable && now !== "trusses") out.push({ id: "trusses", tone: "swap", label: `Frame the roof with trusses${also}`, note: "Manufactured trusses span header to header in one piece: no ridge beam, no king posts, no ties, nothing standing in the middle. The truss maker designs and stamps them.", patch: roofPatch({ ridge: "trusses", crossBeams: 0, ...extra }), works: (after) => !!after.roof?.trusses && leftOut(after, extra) });
  if (now !== "board" && (gable || roof.kind === "hip" || roof.kind === "gambrel")) out.push({ id: "board", tone: "swap", label: `Ridge board with rafter ties${also}`, note: "The rafters lean on each other at a ridge board; a 2x6 tie across every 4 ft holds the headers from spreading. No ridge beam, no king posts.", patch: roofPatch({ ridge: "board", crossBeams: 0, ...extra }), works: (after) => !after.roof?.trusses && after.roof?.ridge?.kind === "board" && leftOut(after, extra) });
  if (now !== "beam" && (gable || roof.kind === "hip" || roof.kind === "gambrel")) out.push({ id: "beam", tone: "swap", label: "Carry the ridge on a beam", note: "The rafters bear on a ridge beam on king posts: no ties across, the ceiling stays open.", patch: roofPatch({ ridge: "beam" }), works: (after) => !after.roof?.trusses && after.roof?.ridge?.kind === "beam" });
  return out;
}
/** Every beam the patch asks to leave out is really out. */
const leftOut = (after: DeckStructure, extra: Partial<RoofDesign>) => (extra.headersOff ?? []).every((id) => !after.roof?.headers.some((h) => h.id === id));

/** The smallest change of beam that lets a post come out from under it — the kind of beam in use first, then the other — or null. */
function fewerDeckPosts(s: DeckStructure, beamId: string, opts: DeckPriceOptions): { size: string; kind: DeckDesign["framing"]["beamKind"]; posts: number } | null {
  const f = s.frame;
  const beam = f?.beams.find((b) => b.id === beamId);
  if (!f || !beam || beam.postXs.length <= 2) return null;
  const kinds: Array<DeckDesign["framing"]["beamKind"]> = f.beamKind === "solid" ? ["solid", "built-up"] : ["built-up", "solid"];
  for (const kind of kinds) {
    const sizes: readonly string[] = kind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES;
    let best: { size: string; posts: number; depth: number } | null = null;
    for (const size of sizes) {
      if (size === beam.spec.size) continue;
      const t = buildStructure(applyDeckPatch(s.design, { framing: { beamKind: kind, beam: size as DeckDesign["framing"]["beam"] } }), opts).frame;
      const tb = t?.beams.find((b) => b.id === beamId);
      if (!t || !tb || t.flags.beamBeyondTable.length || t.flags.droppedDoesNotFit || t.flags.tooLow || tb.postXs.length >= beam.postXs.length) continue;
      // The fewest posts; among those, the shallowest beam.
      if (!best || tb.postXs.length < best.posts || (tb.postXs.length === best.posts && tb.spec.depthIn < best.depth)) best = { size, posts: tb.postXs.length, depth: tb.spec.depthIn };
    }
    if (best) return { size: best.size, kind, posts: best.posts };
  }
  return null;
}

/** The lightest header choice that stands the roof on fewer posts, or null. */
function fewerRoofPosts(s: DeckStructure, opts: DeckPriceOptions): { header: RoofDesign["header"]; posts: number } | null {
  const roof = s.roof;
  if (!roof) return null;
  const tries: Array<RoofDesign["header"]> = [...BUILT_UP_CHOICES, "lvl"];
  for (const header of tries) {
    if (header === s.design.roof.header) continue;
    const t = buildStructure(applyDeckPatch(s.design, roofPatch({ header })), opts).roof;
    if (!t || t.flags.headerBeyondTable.length || t.flags.engineeredBeyond || t.posts.length >= roof.posts.length) continue;
    return { header, posts: t.posts.length };
  }
  return null;
}

/** What the part does, and what can be done with it. `opts` prices the search for a beam that needs fewer posts. */
export function partCard(s: DeckStructure, ref: PartRef, opts: DeckPriceOptions = {}): PartCard {
  const d = s.design;
  const roof = s.roof;
  const lower = ref.level === "lower";
  const f = lower ? s.lower?.frame ?? null : s.frame;
  // (A double deck's lower floor is "the lower deck": it hangs on the main deck's posts — 2026-11-13.)
  const under = lower && s.lower?.place === "under";
  const lvl = under ? "lower-deck " : lower ? "lower-level " : "";
  const card = (title: string, does: string, choices: PartChoice[], stays?: string, place?: DeckGrip | null): PartCard => ({ ref, title, does, choices, ...(stays ? { stays } : {}), ...(place && !place.fixed ? { place } : {}) });

  switch (ref.kind) {
    case "deck-brace": {
      const n = (s.frame?.hardware.braces ?? 0) + (s.lower?.frame.hardware.braces ?? 0);
      const choices: PartChoice[] = [{ id: "one", tone: "remove", label: "Remove this brace", patch: { framing: { bracesOff: withKey(d.framing.bracesOff, ref.id) } } }];
      if (n > 1) choices.push({ id: "all", tone: "remove", label: `Remove all ${n} deck braces`, patch: { framing: { braces: false, bracesOff: [] } }, whole: true });
      // THE BRACE'S TIMBER (2026-11-14 — the owner: "if it's a 6 by 6 brace, I can change it for 4 by 4, or 8 by 8 if the
      // post is 8 by 8"): a row of sizes, none larger than the post.
      const size = f?.sticks.find((st) => st.role === "brace")?.nominal ?? "2x4";
      const sizes = f?.group === "OC" ? [] : braceSizesFor(d.framing.post, "2x4");
      if (sizes.length > 1) choices.push(...sizeRow("Brace size — every deck brace", "brace-size", sizes, d.framing.braceSize, (v) => (v === "auto" ? "Auto" : String(v)), (v) => ({ framing: { braceSize: v as DeckDesign["framing"]["braceSize"] } })));
      return card("Knee brace", `A ${size} at 45° from the post up to the ${f?.beamStyle === "flush" ? "frame" : "beam"}: it keeps a tall post from racking sideways. The American Wood Council's deck guide puts one at every corner post over ${BRACE_ABOVE_IN / 12} ft.${sizes.length > 1 ? ` It can be a heavier timber — up to the post's own ${d.framing.post === "4x6" ? "4x4" : d.framing.post}.` : ""}`, choices);
    }

    case "deck-beam": {
      const beam = f?.beams.find((b) => b.id === ref.id);
      if (!f || !beam) return card("Beam", "A beam under the deck.", []);
      const many = f.beams.length > 1;
      const choices: PartChoice[] = [];
      let stays: string | undefined;
      const title = `${under ? "Lower-deck " : lvl ? "Lower-level " : ""}${beam.role === "front" ? "front beam" : beam.role === "middle" ? "middle beam" : "beam by the house"}`.replace(/^./, (c) => c.toUpperCase());
      let does = `${beam.spec.size} ${beam.style === "flush" ? "flush beam (the joists hang on it)" : "beam under the joists"} ${under ? "let into" : "on"} ${plural(beam.postXs.length, "post")}${under ? " of the upper deck" : ""}, ${ftIn(beam.spanIn)} between them. `;
      if (beam.role === "middle") {
        does += "It is here because the joists, at the size and spacing set, do not span the whole depth in one piece.";
        if (!lower && (d.framing.joist !== "auto" || d.framing.spacingIn !== "auto")) choices.push({ id: "re-span", tone: "remove", label: "Remove this beam — re-span the joists", note: "The joist size and spacing go back to the tables' own pick: a deeper joist, or joists closer together, that spans without a beam in the middle.", patch: { framing: { joist: "auto", spacingIn: "auto" } }, works: (after) => (after.frame?.beams.length ?? 0) < f.beams.length });
        else stays = "No joist in the code's table spans this depth in one piece: the beam in the middle stays, or an engineer sizes the joists.";
      } else if (beam.role === "back") {
        does += "This side stands on its own posts instead of hanging on the house.";
        const w = wallType(d.wall);
        if (!lower && d.placement === "beside" && w.ledger) choices.push({ id: "ledger", tone: "remove", label: "Remove it — hang this side on the house", note: "A ledger bolted to the house's rim carries this side instead: no beam, posts or footings along the wall.", patch: { placement: "attached" }, works: (after) => (after.frame?.ledgers.length ?? 0) > 0 });
        else stays = under ? "The lower deck's beams stand on the upper deck's own lines, let into its posts: move the upper deck's beam and this one goes with it." : lower ? "The lower level stands on its own beams, front and back." : d.placement === "detached" ? "The deck stands out in the yard: this beam is one of the two it stands on." : `${w.label}: ${w.why}`;
      } else {
        does += "It carries the outer ends of the joists down to the posts.";
        stays = "The joists' outer ends rest on it: it cannot come out. Its size, and how many posts it needs, can change.";
      }
      // BY HAND (2026-11-13; lib/deck/byHand): the beam slides along the joists — on the card, to the inch — one more
      // can be stood under the joists, and one the builder placed can be taken off again.
      const grip = lower ? null : gripOfPart(s, ref);
      if (!lower) {
        if (beam.by) choices.push({ id: "line-off", tone: "remove", label: "Remove this beam — it was set by hand", note: "Its posts go with it. If the joists cannot span what it leaves, deeper joists or a beam in the middle of the span carry them.", patch: removeBeamLine(s, beam.by.id) ?? {} });
        if (beam.role === "front" && d.framing.overhangFt !== "auto") choices.push({ id: "front-auto", tone: "swap", label: "Let the studio place this beam", note: "It goes back to where the joist table puts it.", patch: { framing: { overhangFt: "auto" } } });
        if (beam.role === "back" && d.framing.backOverhangFt !== "auto") choices.push({ id: "back-auto", tone: "swap", label: "Let the studio place this beam", note: "It goes back to as far in as the front beam.", patch: { framing: { backOverhangFt: "auto" } } });
        const more = addBeam(s, beam.id);
        if (more) choices.push({ id: "line-add", tone: "add", label: "Add a beam under the joists", note: `In the middle of the joists' longest span, ${ftIn(Math.round(more.spanIn))} now. The joists and the beams are sized again for the shorter spans.`, patch: more.patch });
        if (grip?.fixed) does += ` ${grip.fixed}`;
      }
      if (!lower) {
        const sizes: readonly string[] = f.beamKind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES;
        choices.push(...sizeRow(many ? "Beam size — every beam" : "Beam size", "beam", sizes, d.framing.beam, (v) => (v === "auto" ? "Auto" : String(v)), (v) => ({ framing: { beam: v as DeckDesign["framing"]["beam"] } })));
        choices.push(beam.style === "dropped" ? { id: "flush", tone: "swap", label: "Make the beams flush with the joists", note: "The beam moves up into the joists' plane and they hang on it in hangers: nothing below the frame but the posts.", patch: { framing: { beamStyle: "flush" } } } : { id: "dropped", tone: "swap", label: "Drop the beams under the joists", note: "The joists sit on top of the beam and may run past it.", patch: { framing: { beamStyle: "dropped" } } });
      }
      return card(title, does, choices, stays, grip);
    }

    case "deck-post": {
      const post = f?.posts.find((p) => p.id === ref.id);
      const beam = f?.beams.find((b) => b.id === post?.beamId);
      if (!f || !post || !beam) return card("Post", "A post under the deck.", []);
      const choices: PartChoice[] = [];
      let stays: string | undefined;
      // BY HAND (2026-11-13; design.framing.pins, lib/deck/byHand). A post slides along its beam — on the card, to the
      // inch — one can be added, and one set by hand taken off: the beam then stands on the posts as placed, and on
      // more only where its spans or its ends need one.
      const grips = lower ? [] : deckGrips(s);
      const grip = lower ? null : gripOfPart(s, ref, grips);
      if (grip) {
        const off = post.by ? removePost(s, grip.id, grips) : null;
        if (off) choices.push({ id: "pin-off", tone: "remove", label: "Remove this post — it was set by hand", note: "If the beam needs a post in the span it leaves, one stands in the middle of it.", patch: off });
        const more = addPostUnder(s, beam.id, grips);
        if (more) choices.push({ id: "pin-add", tone: "add", label: "Add a post under this beam", note: `In the middle of its longest span, ${ftIn(Math.round(more.spanIn))} now.`, patch: more.patch });
      }
      if (lower) stays = "The lower level's posts follow its own beams.";
      else if (post.by) stays = undefined;
      else if (beam.postXs.length <= 2) stays = "A beam stands on two posts at least.";
      else {
        const fewer = fewerDeckPosts(s, beam.id, opts);
        if (fewer) choices.push({ id: "fewer", tone: "remove", label: `Remove a post — a ${fewer.size} beam spans it`, note: `A deeper beam reaches farther between posts: ${plural(fewer.posts, "post")} under this beam instead of ${beam.postXs.length}, one hole and footing fewer each.`, patch: { framing: { beamKind: fewer.kind, beam: fewer.size as DeckDesign["framing"]["beam"] } } });
        else stays = "No beam in the code's table spans farther between posts here: they stay, or an engineer sizes the beam.";
      }
      if (!lower) choices.push(...sizeRow("Post size — every post", "post", POST_SIZES, d.framing.post, (v) => String(v), (v) => ({ framing: { post: v as DeckDesign["framing"]["post"] } })).filter((c) => c.id !== "post-auto"));
      return card(`${lvl ? "Lower-level post" : "Post"}`, `${post.size} post, ${ftIn(post.heightIn)} tall, carrying ${Math.round(post.tributarySqFt)} sq ft of ${!lower && f.carries > 1 ? "the two decks — the lower deck's beam is let into it —" : "deck"} down to its footing.`, choices, stays, grip);
    }

    case "joist": {
      if (!f) return card("Joist", "A joist.", []);
      const choices: PartChoice[] = lower
        ? []
        : [
            ...sizeRow("Joist size", "joist", JOIST_SIZES, d.framing.joist, (v) => (v === "auto" ? "Auto" : String(v)), (v) => ({ framing: { joist: v as DeckDesign["framing"]["joist"] } })),
            ...sizeRow("Spacing", "spacing", SPACINGS, d.framing.spacingIn, (v) => (v === "auto" ? "Auto" : `${v} in.`), (v) => ({ framing: { spacingIn: v as DeckDesign["framing"]["spacingIn"] } })),
          ];
      return card("Joist", `${f.joistSize} joists ${f.spacingIn} in. apart carry the boards to ${f.ledgers.length ? "the ledger and " : ""}the beams.`, choices, "The boards lie on the joists: they cannot come out. Their size and spacing can change.");
    }

    case "rim": {
      const choices: PartChoice[] = !lower && d.framing.doubleRim ? [{ id: "single-rim", tone: "remove", label: "Single rim and outside joists", note: "One board instead of two around the outside: less lumber; rail posts then need blocking behind them.", patch: { framing: { doubleRim: false } } }] : !lower ? [{ id: "double-rim", tone: "add", label: "Double the rim and the outside joists", patch: { framing: { doubleRim: true } } }] : [];
      return card("Rim", "The rim closes the joists' ends and takes the rail posts' bolts.", choices, "The joists' ends are fastened to it: it stays.");
    }

    case "ledger":
      return card("Ledger", "The ledger hangs this side of the deck on the house: lagged or bolted to the house's rim, flashed over.", [{ id: "free", tone: "swap", label: "Stand the deck on its own posts instead", note: "A second beam line with its own posts and footings by the house; nothing fastened to the wall.", patch: { placement: "beside" } }], "The joists hang on it: it stays while the deck is attached to the house.");

    case "blocking": {
      const why = ref.id;
      const choices: PartChoice[] = !lower && d.framing.blocking === "mid-span" ? [{ id: "auto", tone: "remove", label: "Remove the mid-span rows", note: "Blocking stays only where a beam or the board's maker requires it.", patch: { framing: { blocking: "auto" } } }] : [];
      const stays = why === "beam" ? "Over a dropped beam the joists run past it, and blocking there keeps them from rolling: it stays." : why === "maker" ? "The deck board's maker requires these rows under its boards: they stay with this board." : why === "curve" ? "It carries the bent rim of the curved front: it stays." : choices.length ? undefined : "It stays with this frame.";
      return card("Blocking", "Short pieces between the joists: they keep the joists upright and stiffen the floor.", choices, stays);
    }

    case "roof-brace": {
      if (!roof) return card("Knee brace", "A brace.", []);
      const n = roof.hardware.braces;
      const choices: PartChoice[] = [{ id: "one", tone: "remove", label: "Remove this brace", patch: roofPatch({ bracesOff: withKey(d.roof.bracesOff, ref.id) }) }];
      if (n > 1) choices.push({ id: "all", tone: "remove", label: `Remove all ${n} roof braces`, patch: roofPatch({ braces: false, bracesOff: [] }), whole: true });
      const rsize = roof.members.find((m) => m.role === "roof-brace")?.nominal ?? "4x4";
      const rsizes = braceSizesFor(d.roof.post, "4x4");
      if (rsizes.length > 1) choices.push(...sizeRow("Brace size — every roof brace", "rbrace-size", rsizes, d.roof.braceSize, (v) => (v === "auto" ? "Auto" : String(v)), (v) => roofPatch({ braceSize: v as RoofDesign["braceSize"] })));
      return card("Roof knee brace", `A ${rsize} at 45° from the post up to the beam: the braces are what hold ${roof.attach === "free" ? "a free-standing roof" : "the roof"} square against wind and racking.${rsizes.length > 1 ? ` It can be as heavy as the ${d.roof.post} post.` : d.roof.post === "4x4" ? " On a 4x4 post it is a 4x4: a larger post takes a larger brace." : ""}`, choices);
    }

    case "roof-beam": {
      const h = roof?.headers.find((x) => x.id === ref.id);
      if (!roof || !h) return card("Beam", "A beam on the posts.", []);
      const choices: PartChoice[] = [];
      let stays: string | undefined;
      let does = `${h.spec.size} beam on the posts, ${ftIn(h.lengthIn)} long${h.postAt.length > 2 ? `, ${ftIn(h.spanIn)} between posts` : ""}. `;
      const off = withKey(d.roof.headersOff, h.id);
      if (h.idle) {
        does += roof.trusses ? "Nothing bears on it: the truss above spans from post to post in one piece, so this beam only ties the two posts together." : roof.kind === "shed" ? "Nothing bears on it: the rafters rest on the beams at the high and low sides, so this one only ties two posts together." : "Nothing bears on it: the end rafters rest on the side beams, so this one only ties the two posts together.";
        choices.push({ id: "remove", tone: "remove", label: "Remove this beam", note: "The posts stay; any knee braces under this beam go with it.", patch: roofPatch({ headersOff: off }), works: (after) => leftOut(after, { headersOff: [h.id] }) });
      } else if (h.kingPost) {
        does += "It holds the king post that carries the end of the ridge beam.";
        stays = "While the ridge is a beam, its king post stands on this one: it stays. Framed another way, nothing bears on it.";
        choices.push(...ridgeChoices(s, { headersOff: off }, ", and remove this beam").filter((c) => c.id !== "beam"));
      } else {
        does += "The rafters' feet rest on it: it carries the roof to the posts.";
        stays = "It carries the rafters: it cannot come out. Its size can change.";
      }
      choices.push(...sizeRow("Beam size — every roof beam", "header", [...BUILT_UP_CHOICES, ...SOLID_BEAMS, "lvl"] as const, d.roof.header, (v) => (v === "auto" ? "Auto" : v === "lvl" ? "LVL" : String(v)), (v) => roofPatch({ header: v as RoofDesign["header"] })));
      return card(h.idle ? "End beam" : "Roof beam", does, choices, stays);
    }

    case "cross-beam":
    case "king-post": {
      if (!roof) return card("Beam", "A beam.", []);
      const h = roof.headers.find((x) => x.id === ref.id);
      const king = ref.kind === "king-post";
      const choices: PartChoice[] = [];
      let stays: string | undefined;
      if (h?.cross || (king && !h)) {
        const n = roof.crossBeams;
        const does = `${king ? "The king post stands on a cross beam and holds up the ridge beam. " : `${h?.spec.size ?? ""} cross beam from one side beam to the other, with a king post on it under the ridge. `}${roof.kind === "gable" ? `With ${plural(n, "cross beam")} the ridge beam spans ${ftIn(roof.ridge?.spanIn ?? 0)} at a time.` : "A free-standing hip's ridge beam stands on two of them."}`;
        if (roof.kind === "gable" && n > 0) choices.push({ id: "one-less", tone: "remove", label: king ? "Remove this king post and its cross beam" : "Remove this cross beam", note: `The ridge beam then spans farther between supports and is re-sized for it${n > 1 ? `; the ${n - 1} left are spaced evenly` : ""}.`, patch: roofPatch({ crossBeams: n - 1 }), works: (after) => (after.roof?.crossBeams ?? 0) < n });
        else stays = "The ridge beam stands on these: they stay while the ridge is a beam.";
        choices.push(...ridgeChoices(s).filter((c) => c.id !== "beam"));
        return card(king ? "King post" : "Cross beam", does, choices, stays);
      }
      // A king post on a gable-end beam.
      stays = "It carries the end of the ridge beam: it stays while the ridge is a beam.";
      choices.push(...ridgeChoices(s).filter((c) => c.id !== "beam"));
      return card("King post", "A 4x4 post on the end beam, under the ridge beam: it carries that end of the ridge.", choices, stays);
    }

    case "ridge": {
      if (!roof || !roof.ridge) return card("Ridge", "The ridge.", []);
      const beam = roof.ridge.kind === "beam";
      const choices: PartChoice[] = ridgeChoices(s);
      if (beam && roof.kind === "gable" && roof.crossBeams < 3) choices.push({ id: "cross", tone: "add", label: "Add a cross beam under it", note: `A beam across with a king post cuts the ridge's span to ${ftIn((roof.ridge.spanIn * (roof.crossBeams + 1)) / (roof.crossBeams + 2))}: a smaller ridge beam.`, patch: roofPatch({ crossBeams: roof.crossBeams + 1 }) });
      return card(beam ? "Ridge beam" : "Ridge board", beam ? `${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam: the rafters bear on it and it carries half the roof to its king posts${roof.attach === "wall" ? " and the house" : ""}, so no ties cross the ceiling.` : `${roof.ridge.nominal} ridge board: the rafter pairs nail through it and lean on each other; ${plural(roof.ties, "rafter tie")} across hold the beams from spreading.`, choices, "The rafters meet on it: it stays while the roof is framed with rafters.");
    }

    case "rafter-tie": {
      if (!roof) return card("Rafter tie", "A tie.", []);
      if (roof.kind === "gambrel" && roof.ridge?.kind !== "board") return card("Tie", "A 2x6 tie across at the gambrel's break, bolted to the rafter pair.", [], "It holds the gambrel's break together: it stays.");
      const choices = ridgeChoices(s).map((c) => (c.id === "beam" ? { ...c, tone: "remove" as const, label: "Remove the ties — carry the ridge on a beam" } : c));
      return card("Rafter tie", `A 2x6 across at the beams, every 4 ft: with a ridge board the rafters push outward, and the ties are what hold the beams from spreading (IRC R802.5.2).`, choices, "While the rafters meet on a ridge board the ties stay.");
    }

    case "truss": {
      if (!roof?.trusses) return card("Truss", "A truss.", []);
      const T = roof.trusses;
      const why = T.why === "asked" ? "" : T.why === "rafters" ? " The roof was trussed because rafters this long are past the rafter table." : T.why === "ridge" ? " The roof was trussed because no beam in the table spans the ridge." : " The roof was trussed because a ridge beam would bring more onto one post than a footing table reads.";
      return card("Truss", `${plural(T.count, "manufactured truss", "manufactured trusses")}, ${T.spacingIn} in. on center, spanning ${ftIn(T.spanIn)} beam to beam in one piece — each carries its own thrust.${why}`, ridgeChoices(s), "The trusses are the roof's frame: one cannot come out alone.");
    }

    case "rafter": {
      if (!roof) return card("Rafter", "A rafter.", []);
      const choices: PartChoice[] = roof.trusses || roof.kind === "pergola" ? [] : [...sizeRow("Rafter size", "rafter", JOIST_SIZES, d.roof.rafter, (v) => (v === "auto" ? "Auto" : String(v)), (v) => roofPatch({ rafter: v as RoofDesign["rafter"] })), ...sizeRow("Spacing", "rspacing", SPACINGS, d.roof.rafterSpacingIn, (v) => `${v} in.`, (v) => roofPatch({ rafterSpacingIn: v as RoofDesign["rafterSpacingIn"] })).filter((c) => c.id !== "rspacing-auto")];
      return card("Rafter", `${roof.rafters.size} rafters ${roof.rafters.spacingIn} in. apart carry the roof deck from the beams up to the ${roof.ridge ? "ridge" : "top"}.`, choices, "The roof lies on them: they cannot come out. Their size and spacing can change.");
    }

    case "roof-post": {
      const post = roof?.posts.find((p) => p.id === ref.id);
      if (!roof || !post) return card("Roof post", "A post under the roof.", []);
      const choices: PartChoice[] = [];
      let stays: string | undefined;
      // SET BY HAND (2026-11-13): a post the builder stood, or one that frames an opening of theirs — theirs to move,
      // resize or take off; any other post between the corners can have an opening framed beside it.
      const pin = post.by?.kind === "pin" ? d.roof.pins.find((x) => x.id === post.by?.id) : undefined;
      const opening = post.by?.kind === "opening" ? d.roof.openings.find((x) => x.id === post.by?.id) : undefined;
      const built = opening ? roof.openings.find((x) => x.id === opening.id) : undefined;
      if (pin) {
        choices.push({ id: "pin-off", tone: "remove", label: "Remove this post — it was set by hand", note: "The header is sized again for the span it leaves; if no header reaches, the roof puts a post back where the span needs one.", patch: roofPatch({ pins: d.roof.pins.filter((x) => x.id !== pin.id) }) });
      } else if (opening) {
        choices.push({ id: "opening-off", tone: "remove", label: "Remove the opening — its two posts go with it", note: "The side goes back to the posts its spans ask for.", patch: roofPatch({ openings: d.roof.openings.filter((x) => x.id !== opening.id) }) });
        for (const w of [3, 4, 5, 6, 8]) choices.push({ id: `opening-${w}`, tone: "size", label: `${w} ft`, patch: roofPatch({ openings: d.roof.openings.map((x) => (x.id === opening.id ? { ...x, widthFt: w } : x)) }), current: opening.widthFt === w, row: "The opening's clear width" });
        choices.push({ id: "opening-door", tone: "swap", label: opening.door ? "Leave it open — the door comes later" : "Hang a screen door in it now", note: opening.door ? undefined : "A door hangs only where the walls between the posts are screen.", patch: roofPatch({ openings: d.roof.openings.map((x) => (x.id === opening.id ? { ...x, door: !x.door } : x)) }) });
      }
      // BY HAND (2026-11-13; lib/deck/byHand): a post between two corners slides along its side — on the card, to the
      // inch (an opening's post takes the opening with it) — and one more can be stood on a side.
      const rgrips = deckGrips(s);
      const rgrip = gripOfPart(s, ref, rgrips);
      for (const side of post.corner ? roofCornerSides(roof, post) : rgrip?.side ? [rgrip.side] : []) {
        const more = addRoofPost(s, side, rgrips);
        if (more) choices.push({ id: `rpin-add-${side}`, tone: "add", label: `Add a post on the ${ROOF_SIDE_LABEL[side].toLowerCase()}`, note: `In the middle of the longest stretch between two posts there, ${ftIn(Math.round(more.spanIn))} now. The beam over it is sized again for the shorter spans.`, patch: more.patch });
      }
      if (post.corner) stays = "A corner post: the roof stands on it.";
      else if (rgrip?.fixed) stays = rgrip.fixed;
      else if (pin || opening) stays = undefined;
      else {
        const at = roofSideOf(roof, post);
        if (at && d.roof.openings.length < ROOF_POST_LIMITS.openings) {
          // Beside this post, toward the side's middle: the post becomes one of the opening's two.
          const toward = at.atFt < at.lengthFt / 2 ? 1 : -1;
          const id = `o${d.roof.openings.length + 1}${Math.round(at.atFt * 12).toString(36)}`.slice(0, 12);
          choices.push({ id: "opening-add", tone: "add", label: "Frame a 4-ft opening beside this post", note: "Two posts 4 ft apart for a door, now or later: the header over it is sized for that span.", patch: roofPatch({ openings: [...d.roof.openings, { ...defaultRoofOpening(id, at.side, Math.max(0, at.atFt + toward * (2 + POST_ACTUAL_IN[d.roof.post][0] / 12))) }] }) });
        }
        const fewer = fewerRoofPosts(s, opts);
        if (fewer) choices.push({ id: "fewer", tone: "remove", label: `Remove a post — ${fewer.header === "lvl" ? "LVL" : fewer.header} beams span it`, note: `Deeper beams reach farther between posts: the roof stands on ${plural(fewer.posts, "post")} instead of ${roof.posts.length}.`, patch: roofPatch({ header: fewer.header }) });
        else stays = "No beam in the list spans this side without it: it stays, or an engineer sizes the beam.";
      }
      choices.push(...sizeRow("Post size — every roof post", "rpost", ["4x4", "6x6", "8x8"] as const, d.roof.post, (v) => String(v), (v) => roofPatch({ post: v as RoofDesign["post"] })).filter((c) => c.id !== "rpost-auto"));
      return card(pin ? "Roof post — set by hand" : opening ? `Roof post — at the ${built ? ftIn(Math.round(built.widthIn)) : `${opening.widthFt}-ft`} opening` : "Roof post", `${post.size} post, ${ftIn(post.heightIn)} tall, bringing about ${Math.round(post.loadLb / 10) * 10} lb of roof down to ${post.bearing === "deck" ? "its own footing under the deck" : post.bearing === "ground" ? "its footing" : "the slab"}.`, choices, stays, rgrip);
    }

    case "stair": {
      if (ref.id === BETWEEN_LEVELS_STAIR_ID) return card("Steps between the levels", "The steps from the main deck down to the lower level.", [], "The lower level is more than one step down: it needs these steps. Put a stair of your own there to replace them.");
      const st = s.stairs.find((x) => x.design.id === ref.id);
      const wrap = st?.design.wrap;
      const c = card(wrap ? "Steps round the deck" : "Stairs", wrap ? "Box steps wrapping the deck's open sides: a frame of treated lumber under treads of deck boards." : "A flight of stairs with its stringers, treads and landing.", [{ id: "remove", tone: "remove", label: wrap ? "Remove these steps" : "Remove this stair", patch: { stairs: d.stairs.filter((x) => x.id !== ref.id) } }]);
      return st ? { ...c, finish: { target: { kind: "stair", id: ref.id }, now: st.design.finish ?? null, ...deckBoardNow(s) } } : c;
    }

    case "built-in": {
      const bi = s.builtIns.find((x) => x.design.id === ref.id);
      if (!bi) return card("Built-in", "Built into the deck.", []);
      const title = BUILT_IN_LABEL[bi.kind];
      const does = bi.kind === "screen" ? "A privacy screen of deck boards across posts carried down into the frame." : bi.kind === "planter" ? "A planter box of deck boards on a treated frame, standing on the boards." : "A bench of deck boards on treated legs, standing on the boards over blocking.";
      const c = card(title, `${does} ${builtInWords(bi).replace(/^./, (ch) => ch.toUpperCase())}.`, [{ id: "remove", tone: "remove", label: `Remove this ${title.toLowerCase()}`, patch: { extras: { builtIns: (d.extras.builtIns ?? []).filter((x) => x.id !== ref.id) } } }]);
      return { ...c, finish: { target: { kind: "built-in", id: ref.id }, now: bi.design.finish ?? null, ...deckBoardNow(s) } };
    }

    case "rail": {
      // HOW THIS SIDE IS MOUNTED (2026-11-13): top or side, for this side alone or for every side.
      const key = ref.id as RailSectionKey;
      const here = s.rails.mounts[key];
      const sideName = here ? RAIL_SECTION_LABEL[key]?.toLowerCase() : undefined;
      const choices: PartChoice[] = [];
      if (here && sideName) {
        const all = Object.values(s.rails.mounts);
        for (const m of ["top", "side"] as const) {
          const by = { ...d.rail.mountBy };
          if (m === s.rails.mount) delete by[key];
          else by[key] = m;
          choices.push({ id: `mount-${m}`, tone: "size", label: RAIL_MOUNT_LABEL[m], note: `The ${sideName} only: its posts ${RAIL_MOUNT_WORDS[m]}.`, patch: { rail: { mountBy: by } }, current: here === m, row: `Mounting — the ${sideName} only`, works: (after) => after.rails.mounts[key] === m });
        }
        if (all.length > 1) for (const m of ["top", "side"] as const) choices.push({ id: `mount-all-${m}`, tone: "size", label: RAIL_MOUNT_LABEL[m], note: `Every side: the posts ${RAIL_MOUNT_WORDS[m]}.`, patch: { rail: { mount: m, mountBy: {} } }, current: all.every((v) => v === m), row: "Mounting — every side", whole: true, works: (after) => Object.values(after.rails.mounts).every((v) => v === m) });
      }
      choices.push({ id: "remove", tone: "remove", label: "Remove the railing", note: s.rails.required ? "This deck is more than 30 in. off the ground: the code requires a guard." : undefined, patch: { rail: { type: "none" } }, whole: true });
      return card(sideName ? `Railing — ${sideName}` : "Railing", `${s.rails.label} railing, ${s.rails.heightIn} in. high${here ? `, ${here}-mounted on this side: the posts ${RAIL_MOUNT_WORDS[here]}` : ", along the open edges"}.`, choices);
    }

    case "fascia":
      return card("Fascia", "A trim board over the rim: it hides the frame's edge.", [{ id: "remove", tone: "remove", label: "Remove the fascia", patch: { decking: { fascia: "none" } } }]);

    case "gutter":
      return card("Gutters", "Gutters along the eaves and their downspouts.", [{ id: "remove", tone: "remove", label: "Remove the gutters", patch: roofPatch({ gutters: { kind: "none", guards: false } }) }]);

    case "ceiling":
      return card("Ceiling", "Boards closing the underside of the rafters.", [{ id: "remove", tone: "remove", label: "Remove the ceiling — rafters showing", patch: roofPatch({ ceiling: "none" }) }]);

    case "walls":
      return card("Walls between the posts", "Screens or panels filling the sides between the posts.", [{ id: "remove", tone: "remove", label: "Remove them — open between the posts", patch: roofPatch({ walls: { fill: "none", sides: d.roof.walls.sides } }) }]);
  }
}

/* ------------------------------------------------------------------ */
/*  3. What happens if                                                 */
/* ------------------------------------------------------------------ */

export interface PartOutcome {
  /** The design after the choice, settled to the tables. */
  design: DeckDesign;
  /** The price after, less the price before. */
  delta: number;
  /** What re-framed: "joists 2x8 → 2x12", "posts 6 → 4". */
  changes: string[];
  /** What the checks object to now that they did not before. */
  issues: string[];
  /** The structure comes out the same: nothing to do. */
  nothing: boolean;
  /** The tables did not let it do what its label says (PartChoice.works). */
  misses: boolean;
}

const set = (xs: readonly string[]) => [...new Set(xs)].sort().join(", ");

/** One line per thing that is framed differently. */
export function structureChanges(a: DeckStructure, b: DeckStructure): string[] {
  const out: string[] = [];
  const say = (what: string, x: string | number, y: string | number) => {
    if (String(x) !== String(y)) out.push(`${what} ${x} → ${y}`);
  };
  const fa = a.frame;
  const fb = b.frame;
  if (fa && fb) {
    say("joists", `${fa.joistSize} @ ${fa.spacingIn} in.`, `${fb.joistSize} @ ${fb.spacingIn} in.`);
    say("deck beams", fa.beams.length, fb.beams.length);
    say("beam size", set(fa.beams.map((x) => String(x.spec.size))), set(fb.beams.map((x) => String(x.spec.size))));
    if (fa.beamStyle !== fb.beamStyle) out.push(`beams ${fb.beamStyle === "flush" ? "flush with the joists" : "under the joists"}`);
    say("deck posts", `${fa.posts.filter((p) => !p.roof).length} ${fa.posts[0]?.size ?? ""}`.trim(), `${fb.posts.filter((p) => !p.roof).length} ${fb.posts[0]?.size ?? ""}`.trim());
    if (fa.ledgers.length !== fb.ledgers.length) out.push(fb.ledgers.length ? "a ledger on the house" : "no ledger: it stands on its own posts");
    say("deck braces", fa.hardware.braces + (a.lower?.frame.hardware.braces ?? 0), fb.hardware.braces + (b.lower?.frame.hardware.braces ?? 0));
    say("blocking rows", fa.blockingRows.length, fb.blockingRows.length);
    if (fa.design.framing.doubleRim !== fb.design.framing.doubleRim) out.push(fb.design.framing.doubleRim ? "rim and outside joists doubled" : "rim and outside joists single");
  }
  const ra = a.roof;
  const rb = b.roof;
  if (ra && rb) {
    const ridge = (r: NonNullable<DeckStructure["roof"]>) => (r.trusses ? `${r.trusses.count} trusses` : r.ridge ? (r.ridge.kind === "beam" ? `${r.ridge.spec?.size ?? r.ridge.nominal} ridge beam` : r.ridge.kind === "board" ? `${r.ridge.nominal} ridge board` : "no ridge") : "no ridge");
    if (ridge(ra) !== ridge(rb)) out.push(`${ridge(ra)} → ${ridge(rb)}`);
    say("rafter ties", ra.ties + ra.hipEndTies, rb.ties + rb.hipEndTies);
    say("king posts", ra.kingPosts, rb.kingPosts);
    say("cross beams", ra.crossBeams, rb.crossBeams);
    if (!ra.trusses && !rb.trusses) say("rafters", `${ra.rafters.size} @ ${ra.rafters.spacingIn} in.`, `${rb.rafters.size} @ ${rb.rafters.spacingIn} in.`);
    const ring = (r: NonNullable<DeckStructure["roof"]>) => r.headers.filter((h) => !h.cross);
    say("roof beams", ring(ra).length, ring(rb).length);
    say("roof beam size", set(ring(ra).map((h) => String(h.spec.size))), set(ring(rb).map((h) => String(h.spec.size))));
    say("roof posts", `${ra.posts.length} ${ra.posts[0]?.size ?? ""}`.trim(), `${rb.posts.length} ${rb.posts[0]?.size ?? ""}`.trim());
    say("roof braces", ra.hardware.braces, rb.hardware.braces);
    if (!!ra.gutters !== !!rb.gutters) out.push(rb.gutters ? "gutters on" : "no gutters");
    if (!!ra.walls !== !!rb.walls) out.push(rb.walls ? "walls between the posts" : "open between the posts");
    if (ra.ceilingSqFt !== rb.ceilingSqFt) out.push(rb.ceilingSqFt ? "a ceiling" : "no ceiling");
  }
  if (a.stairs.length !== b.stairs.length) out.push(`stairs ${a.stairs.length} → ${b.stairs.length}`);
  if (a.rails.on !== b.rails.on) out.push(b.rails.on ? "a railing" : "no railing");
  else if (b.rails.on && JSON.stringify(a.rails.mounts) !== JSON.stringify(b.rails.mounts)) out.push(`railing ${railMountLine(b.rails)}`);
  if (a.design.decking.fascia !== b.design.decking.fascia) out.push(b.design.decking.fascia === "none" ? "no fascia" : "fascia on");
  return out;
}

/** The choice tried: the design after it (settled), the price it moves, what re-framed, what the checks now say. */
export function tryChoice(design: DeckDesign, choice: Pick<PartChoice, "patch" | "works">, opts: DeckPriceOptions = {}, before: DeckPackage = priceDeck(design, opts)): PartOutcome {
  const next = settleDesign(applyDeckPatch(design, choice.patch), opts).design;
  const after = priceDeck(next, opts);
  const changes = structureChanges(before.structure, after.structure);
  const was = new Set(deckChecks(before.structure).filter((c) => c.level === "fail" || c.level === "warn").map((c) => `${c.level}:${c.id}`));
  const issues = deckChecks(after.structure)
    .filter((c) => (c.level === "fail" || c.level === "warn") && !was.has(`${c.level}:${c.id}`))
    .map((c) => `${c.part}: ${c.text.split(/(?<=\.)\s/)[0]}`);
  const delta = Math.round((after.subtotal - before.subtotal) * 100) / 100;
  return { design: next, delta, changes, issues, nothing: changes.length === 0 && Math.abs(delta) < 0.005 && JSON.stringify(next) === JSON.stringify(design), misses: choice.works ? !choice.works(after.structure) : false };
}

/* ------------------------------------------------------------------ */
/*  Put back                                                           */
/* ------------------------------------------------------------------ */

export interface TakenOut {
  id: string;
  /** "2 deck braces", "the end beam". */
  what: string;
  /** Puts it back. */
  patch: DeckPatch;
}

/** What the contractor took out by hand that the tables' own layout would have: each with the patch that puts it back. */
export function takenOut(s: DeckStructure): TakenOut[] {
  const d = s.design;
  const out: TakenOut[] = [];
  const deckLeft = (s.frame?.bracesLeftOut ?? 0) + (s.lower?.frame.bracesLeftOut ?? 0);
  const tall = [...(s.frame?.posts ?? []), ...(s.lower?.frame.posts ?? [])].some((p) => !p.roof && p.heightIn > BRACE_ABOVE_IN);
  if (s.frame && !d.framing.braces && tall) out.push({ id: "deck-braces", what: "the deck's knee braces", patch: { framing: { braces: true, bracesOff: [] } } });
  else if (deckLeft > 0) out.push({ id: "deck-braces", what: plural(deckLeft, "deck brace"), patch: { framing: { bracesOff: [] } } });
  if (s.roof) {
    if (!d.roof.braces) out.push({ id: "roof-braces", what: "the roof's knee braces", patch: roofPatch({ braces: true, bracesOff: [] }) });
    else if (s.roof.bracesLeftOut > 0) out.push({ id: "roof-braces", what: plural(s.roof.bracesLeftOut, "roof brace"), patch: roofPatch({ bracesOff: [] }) });
    if (s.roof.headersLeftOut.length) out.push({ id: "roof-beams", what: s.roof.headersLeftOut.length === 1 ? "an end beam of the roof" : `${s.roof.headersLeftOut.length} end beams of the roof`, patch: roofPatch({ headersOff: [] }) });
  }
  return out;
}
