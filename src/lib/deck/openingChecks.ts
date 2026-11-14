// THE DECK AGAINST THE HOUSE'S DOORS AND WINDOWS (2026-10-23, Stage 3 of "build the house from a photo of the back
// wall") — pure. Owner: "if there is a windows on the way, then … make it smart". Once the house carries its real doors
// and windows (read off a photo, lib/deck/houseFromPhoto), the deck is checked against each one it stands in front of:
//   · the door it serves — its threshold against the deck's surface (water, and the step the code allows);
//   · a window the ledger or the boards would run across, and a window under the deck (a way out of a bedroom);
//   · glass that becomes low glass beside the new walking surface (safety glazing);
//   · a covered deck's roof running into a window or a door where it meets the house;
//   · glass by the hot tub.
// BY HEIGHT AS WELL AS BY PLACE (2026-11-13, a deck builder: "a second-storey deck is checked against the first floor's
// doors and windows"): every opening is first put on its floor against THIS deck — under its frame (the floor below),
// at its boards, or well above them (the floor above). Only a door at the boards has its threshold checked; a door
// under the deck is checked for what can really be in its way down there — a post in front of it, a beam under its
// head; a window under the deck's surface is not glass beside the tub.
// Houses drawn by rule (no openings) are not checked: their doors and windows are a picture, not a measurement.
// Estimating grade — the building department decides.

import { DECK_LIMITS, LOWER_LIMITS, ROOF_LIMITS, spaRectIn, type DeckDesign } from "./design";
import { DRESSED_DEPTH_IN, ftIn, joistDepthIn } from "./codeTables";
import type { HouseOpening } from "./house";
import type { DeckStructure } from "./structure";
import type { RoofFrame } from "./roof";
import type { DeckCheck } from "./checks";

const PART = "Doors and windows";
/** The usual mark: the boards an inch under the threshold — under it for the water, close for the foot. */
export const UNDER_THRESHOLD_IN = 1;
/** The step down from a door the code allows onto the landing outside: 1½ in.; 7¾ in. where the door does not swing out over it. */
export const STEP_ANY_DOOR_IN = 1.5;
export const STEP_NO_SWING_IN = 7.75;
/** How far above a roof the wall's flashing turns up, and so where a window above it may begin. */
export const ROOF_FLASHING_IN = 4;
/** Safety glass beside a walking surface (IRC R308.4.3): a pane over 9 sq ft whose bottom is under 18 in. up and whose top is over 36 in. */
const LOW_GLASS = { bottomIn: 18, topIn: 36, areaSqFt: 9 } as const;
/** Glass by a hot tub (IRC R308.4.5): within 60 in. of the water's edge and under 60 in. up. */
const TUB_GLASS_IN = 60;
/** Past this far above the boards a door is not this deck's door: nobody steps down four feet — it is a door of the floor above. */
export const DOOR_ABOVE_IN = 48;
/** The clear landing a door needs outside it, in the way one walks out (IRC R311.3), and the head room walking out (R311.2's door height). */
const LANDING_IN = 36;
const HEAD_ROOM_IN = 80;
/** Half a post, with a little air: how far past a door's side a post still stands in the doorway. */
const POST_HALF_IN = 3;

/** Where an opening stands against a deck's floor: wholly under its frame (the floor below), at its boards, or — a door — well above them (the floor above). */
export type OpeningLevel = "below" | "deck" | "above";
export function openingLevel(o: Pick<HouseOpening, "kind" | "sillFt" | "heightFt">, deckTopIn: number, frameBottomIn: number): OpeningLevel {
  const sill = o.sillFt * 12;
  if (sill + o.heightFt * 12 <= frameBottomIn) return "below";
  if (o.kind !== "window" && sill - deckTopIn > DOOR_ABOVE_IN) return "above";
  return "deck";
}
/** The underside of a deck's frame at the house: its boards, then its joists. Inches above the ground. */
export const frameBottomIn = (deckTopIn: number, joistSize: Parameters<typeof joistDepthIn>[0]) => deckTopIn - UNDER_THRESHOLD_IN - joistDepthIn(joistSize);

const WHAT: Record<HouseOpening["kind"], string> = { window: "window", door: "door", slider: "sliding door", garage: "garage door" };
const where = (o: HouseOpening) => `${ftIn(Math.round(Math.max(0, o.xFt) * 12))} along the deck`;
/** Several openings' places along the deck, in one breath: "3'-6", 6'-6" and 9'-3" along the deck". */
const places = (os: HouseOpening[]) => {
  const at = os.map((o) => ftIn(Math.round(Math.max(0, o.xFt) * 12)));
  return `${at.length > 1 ? `${at.slice(0, -1).join(", ")} and ${at[at.length - 1]}` : at[0]} along the deck`;
};
const span = (o: HouseOpening) => ({ x0: (o.xFt - o.widthFt / 2) * 12, x1: (o.xFt + o.widthFt / 2) * 12 });
const overlapIn = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const inches = (n: number) => `${Math.round(n * 4) / 4} in.`;

/** Where a covered deck's roof meets the house: its stretch along the wall and the roof's line against it, inches. */
export function roofAtWall(roof: RoofFrame, design: DeckDesign): { x0: number; x1: number; z: (x: number) => number; ledgerIn: number } | null {
  if (roof.attach !== "wall") return null;
  const p = design.roof.plan;
  if (p.shape === "hexagon" || p.shape === "octagon" || p.shape === "round") return null;
  const W = design.shape.widthFt * 12;
  const cx = p.shape === "follows-deck" ? W / 2 : W / 2 + p.offsetFt * 12;
  const half = p.shape === "follows-deck" ? W / 2 : (p.widthFt * 12) / 2;
  if (!(half > 0)) return null;
  // What the roof hangs on at the wall: its ledger, or (a ridge into the wall) about a rafter's depth.
  const ledgerIn = roof.ledger ? (DRESSED_DEPTH_IN[Number(roof.ledger.nominal.split("x")[1])] ?? 7.25) : 7.25;
  // A shed: one line, its ledger. A ridge running into the wall (a gable, a deep hip): the gable's line, from the eave at
  // the corners up to the peak in the middle.
  if (roof.kind === "shed" && roof.ledger) {
    const z = roof.ledger.zIn;
    return { x0: cx - half, x1: cx + half, z: () => z, ledgerIn };
  }
  const peak = Math.max(roof.peakIn, roof.ledger?.zIn ?? 0);
  const eave = roof.headerTopIn;
  return { x0: cx - half, x1: cx + half, z: (x) => eave + (peak - eave) * Math.max(0, 1 - Math.abs(x - cx) / half), ledgerIn };
}

export function openingChecks(s: DeckStructure, add: (c: DeckCheck) => void): void {
  const { design, frame, roof } = s;
  const all = design.house.openings;
  if (!all?.length || design.placement === "detached" || !frame) return;
  const W = design.shape.widthFt * 12;
  const deck = { x0: 0, x1: W };
  const top = design.heightIn;
  const onDeck = all.filter((o) => overlapIn(span(o), deck) > 3);
  const minH = DECK_LIMITS.heightIn.min;
  const maxH = DECK_LIMITS.heightIn.max;

  /* ── Each door on its floor: under the deck, at its boards, above it ── */
  const bottom = frameBottomIn(top, frame.joistSize);
  const level = (o: HouseOpening) => openingLevel(o, top, bottom);
  // A garage door is never the door the deck serves (2026-10-26): no threshold check against it.
  const doors = onDeck.filter((o) => o.kind !== "window" && o.kind !== "garage");
  const served = doors.filter((d) => level(d) === "deck");

  /* ── The door the deck serves ─────────────────────────────────────── */
  served.forEach((d, i) => {
    const id = `door-threshold${i ? `-${i + 1}` : ""}`;
    const th = Math.round(d.sillFt * 12 * 4) / 4;
    const drop = th - top;
    const what = WHAT[d.kind];
    const set = Math.round(th - UNDER_THRESHOLD_IN);
    const fix = set >= minH && set <= maxH && set !== top ? { label: `Set the deck at ${set} in.`, patch: { heightIn: set } } : undefined;
    if (drop < -12) {
      // Not a deck a little too high for its door: the frame runs across the doorway itself. Under the threshold, or clear above the head.
      const head = th + d.heightFt * 12;
      const over = Math.ceil(head + (top - bottom));
      const alts = over <= maxH ? [{ label: `Raise the deck clear above it: ${over} in.`, patch: { heightIn: over } }] : undefined;
      add({ id, level: "fail", part: PART, text: `The deck would run across the ${what} ${where(d)}: its threshold is ${ftIn(Math.round(th))} off the ground and its head ${ftIn(Math.round(head))}, and the deck's frame runs from ${ftIn(Math.round(bottom))} to ${ftIn(Math.round(top))}. Set the boards about ${UNDER_THRESHOLD_IN} in. under the threshold, or raise the deck clear above the door's head.`, rule: "IRC R311.3.1 · R507.9", fix, alts });
    } else if (drop < 0) add({ id, level: "fail", part: PART, text: `The deck's surface stands ${inches(-drop)} above the ${what}'s threshold (${where(d)}): rain runs in under it${d.kind === "door" ? " and the door can't swing out over the boards" : ""}. Keep the boards about ${UNDER_THRESHOLD_IN} in. under it.`, rule: "IRC R311.3.1 · R507.2.4", fix });
    else if (drop < 0.5) add({ id, level: "warn", part: PART, text: `The deck's surface is level with the ${what}'s threshold (${where(d)}) — no room for the flashing under the door, and water stands at the sill. About ${UNDER_THRESHOLD_IN} in. under it is the usual mark.`, rule: "IRC R311.3.1 · R507.2.4", fix });
    else if (drop <= STEP_ANY_DOOR_IN) add({ id, level: "pass", part: PART, text: `The deck's surface sits ${inches(drop)} under the ${what}'s threshold (${where(d)}) — the step the code allows at any door.`, rule: "IRC R311.3.1" });
    else if (drop <= STEP_NO_SWING_IN) add({ id, level: d.kind === "slider" ? "pass" : "info", part: PART, text: `A ${inches(drop)} step down from the ${what} (${where(d)}) onto the deck: allowed where the door does not swing out over the deck${d.kind === "slider" ? " — a sliding door doesn't" : " — a door that swings in, as most back doors do. A door swinging out wants the deck within 1½ in."}.`, rule: "IRC R311.3.1, exception", fix: d.kind === "door" ? fix : undefined });
    else add({ id, level: "warn", part: PART, text: `A ${inches(drop)} step down from the ${what}'s threshold (${where(d)}) to the deck — past the 7¾ in. the code allows. Raise the deck, or build a landing step at the door.`, rule: "IRC R311.3.1", fix });
    // A roof's post running up through the deck in front of its own door.
    const sp = span(d);
    const post = frame.posts.find((p) => p.roof && p.y < LANDING_IN && p.x > sp.x0 - POST_HALF_IN && p.x < sp.x1 + POST_HALF_IN);
    if (post) add({ id: `door-post${i ? `-${i + 1}` : ""}`, level: "warn", part: PART, text: `A post of the roof stands ${inches(post.y)} out from the wall in front of the ${what} ${where(d)}. A door needs a clear landing ${LANDING_IN} in. deep outside it: slide the roof along the wall, or hang it on the wall there.`, rule: "IRC R311.3" });
  });

  /* ── A door of the floor above, when the deck serves none of its own ── */
  if (!served.length) {
    const up = doors.filter((d) => level(d) === "above").sort((a, b) => a.sillFt - b.sillFt)[0];
    if (up) {
      const th = Math.round(up.sillFt * 12 * 4) / 4;
      const set = Math.round(th - UNDER_THRESHOLD_IN);
      const fix = set >= minH && set <= maxH ? { label: `Set the deck at ${set} in.`, patch: { heightIn: set } } : undefined;
      add({ id: "door-above", level: "info", part: PART, text: `The ${WHAT[up.kind]} ${where(up)} is ${ftIn(Math.round(th - top))} above the deck's surface: a door of the floor above, which this deck does not reach.${fix ? ` If the deck is meant for that door, it stands at ${ftIn(set)}.` : ""}`, rule: "IRC R311.3.1", fix });
    }
  }

  /* ── A DOUBLE DECK (2026-11-13): the floor below's door opens onto the LOWER deck — it is that deck's door ── */
  const lowerDeck = s.lower?.place === "under" ? s.lower : null;
  const onLower: string[] = [];
  if (lowerDeck) {
    const lTop = lowerDeck.frame.surfaceIn;
    const lBottom = frameBottomIn(lTop, lowerDeck.frame.joistSize);
    doors
      .filter((d) => level(d) === "below" && openingLevel(d, lTop, lBottom) !== "below")
      .forEach((d, i) => {
        onLower.push(d.id);
        const id = `lower-door-threshold${i ? `-${i + 1}` : ""}`;
        const th = Math.round(d.sillFt * 12 * 4) / 4;
        const drop = th - lTop;
        const what = WHAT[d.kind];
        const set = Math.round(th - UNDER_THRESHOLD_IN);
        const fix = set >= LOWER_LIMITS.heightIn.min && set <= top - LOWER_LIMITS.storeyIn && set !== lTop ? { label: `Set the lower deck at ${set} in.`, patch: { lower: { heightIn: set } } } : undefined;
        if (drop < 0) add({ id, level: "fail", part: PART, text: `The lower deck's surface stands ${inches(-drop)} above the threshold of the ${what} it serves (${where(d)}): rain runs in under the door. Keep its boards about ${UNDER_THRESHOLD_IN} in. under the threshold.`, rule: "IRC R311.3.1 · R507.2.4", fix });
        else if (drop < 0.5) add({ id, level: "warn", part: PART, text: `The lower deck's surface is level with the threshold of the ${what} it serves (${where(d)}) — no room for the flashing under the door. About ${UNDER_THRESHOLD_IN} in. under it is the usual mark.`, rule: "IRC R311.3.1 · R507.2.4", fix });
        else if (drop <= STEP_NO_SWING_IN) add({ id, level: "pass", part: PART, text: `The ${what} ${where(d)} is on the floor below: it opens onto the lower deck, whose surface sits ${inches(drop)} under its threshold.`, rule: "IRC R311.3.1" });
        else add({ id, level: "warn", part: PART, text: `The lower deck sits ${inches(drop)} under the threshold of the ${what} on the floor below (${where(d)}) — past the 7¾ in. the code allows for the step at a door. Raise the lower deck, or build a landing step at the door.`, rule: "IRC R311.3.1", fix });
      });
  }

  /* ── Doors on the floor below: under the deck, and what can stand in their way there ── */
  const under = onDeck.filter((o) => o.kind !== "window" && level(o) === "below");
  if (under.length) {
    const blocked: string[] = [];
    under.forEach((d, i) => {
      const sp = span(d);
      const th = d.sillFt * 12;
      const n = i ? `-${i + 1}` : "";
      const what = WHAT[d.kind];
      const post = frame.posts.filter((p) => p.y < LANDING_IN && p.x > sp.x0 - POST_HALF_IN && p.x < sp.x1 + POST_HALF_IN).sort((a, b) => a.y - b.y)[0];
      if (post) {
        blocked.push(d.id);
        add({ id: `door-under-post${n}`, level: "warn", part: PART, text: `A post of the ${post.roof ? "roof" : "deck"} stands ${inches(post.y)} out from the wall in front of the ${what} on the floor below (${where(d)}). ${d.kind === "garage" ? "Nothing drives in or out past it" : `A door needs a clear landing ${LANDING_IN} in. deep outside it`}: slide the deck along the wall, or move that post clear of the doorway and size the beam for the longer span.`, rule: d.kind === "garage" ? undefined : "IRC R311.3" });
      }
      const beam = d.kind === "garage" ? undefined : frame.beams.find((b) => b.y < LANDING_IN && overlapIn(sp, b) > 3 && b.bottomIn - th < HEAD_ROOM_IN);
      if (beam) {
        blocked.push(d.id);
        add({ id: `door-under-beam${n}`, level: "warn", part: PART, text: `The deck's beam by the house runs ${inches(beam.y)} out from the wall with its underside ${ftIn(Math.round(beam.bottomIn))} off the ground — ${ftIn(Math.round(beam.bottomIn - th))} over the threshold of the ${what} on the floor below (${where(d)}). Walking out under it wants ${ftIn(HEAD_ROOM_IN)} of head room: raise the deck, or carry that end on the house.`, rule: "IRC R311.2" });
      }
    });
    const free = under.filter((d) => !blocked.includes(d.id) && !onLower.includes(d.id));
    if (free.length) {
      const room = Math.min(...free.map((d) => bottom - d.sillFt * 12));
      const which = free.length === 1 ? `The ${WHAT[free[0].kind]} ${where(free[0])} is on the floor below: it opens` : `${free.length} doors (${places(free)}) are on the floor below: they open`;
      add({ id: "door-under", level: "pass", part: PART, text: `${which} under the deck, with ${ftIn(Math.round(room))} from the threshold to the deck's frame and no post in the way. ${free.length === 1 ? "It is" : "They are"} not checked against this deck's surface.`, rule: "IRC R311.3" });
    }
  }

  /* ── Windows the deck runs across, and windows under it ───────────── */
  if (design.placement === "attached") {
    const ledgerBottom = bottom;
    const underDeck: HouseOpening[] = [];
    onDeck
      .filter((o) => o.kind === "window")
      .forEach((w, i) => {
        const sill = w.sillFt * 12;
        const head = sill + w.heightFt * 12;
        const n = i ? `-${i + 1}` : "";
        if (sill < top + 0.5 && head > ledgerBottom) {
          // The ledger or the boards cross it. Below the window's sill, the deck could sit under it.
          const under = Math.floor(sill - 2);
          const fix = under >= minH && under < top && sill - 2 > joistDepthIn(frame.joistSize) + 2 ? { label: `Lower the deck to ${under} in.`, patch: { heightIn: under } } : undefined;
          add({ id: `window-ledger${n}`, level: "fail", part: PART, text: `The ${sill < ledgerBottom ? "deck's ledger" : "deck"} would run across the window ${where(w)} — its sill is ${ftIn(Math.round(sill))} off the ground, the deck's surface ${ftIn(Math.round(top))}${sill >= ledgerBottom ? ` and its ledger down to ${ftIn(Math.round(ledgerBottom))}` : ""}. A ledger needs solid wall to bolt to: lower the deck under the window, end it before the window, or stand that part on its own posts.`, rule: "IRC R507.9", fix, alts: [{ label: "Stand the deck free beside the house", patch: { placement: "beside" } }] });
        } else if (head <= ledgerBottom && sill >= 0) underDeck.push(w);
      });
    if (underDeck.length) {
      const clear = ledgerBottom;
      const which = underDeck.length === 1 ? `A window under the deck ${where(underDeck[0])}` : `${underDeck.length} windows under the deck (${places(underDeck)})`;
      // A post right in front of one of them narrows that way out, whatever the height.
      const inFront = underDeck.find((w) => frame.posts.some((p) => p.y < LANDING_IN && p.x > span(w).x0 - POST_HALF_IN && p.x < span(w).x1 + POST_HALF_IN));
      // A whole storey of room under the frame (2026-11-13): the floor below's windows are simply under a second-storey deck — said as a pass, not as something to look at.
      if (clear >= HEAD_ROOM_IN && !inFront) add({ id: "window-under", level: "pass", part: PART, text: `${which}, on the floor below: the frame there is ${ftIn(Math.round(clear))} off the ground, so a bedroom's escape window still opens all the way and keeps its way out to the yard (36 in. is the least).`, rule: "IRC R310 · escape openings under decks" });
      else add({ id: "window-under", level: clear < 36 ? "warn" : "info", part: PART, text: `${which}. If ${underDeck.length === 1 ? "it is" : "one is"} a bedroom's escape window, it must still open all the way and leave a way out under the deck at least 36 in. high to the yard — ${clear < 36 ? `the frame there is only ${ftIn(Math.round(clear))} off the ground` : `the frame there is ${ftIn(Math.round(clear))} up`}${inFront ? `, and a post stands in front of the window ${where(inFront)}` : ""}.`, rule: "IRC R310 · escape openings under decks" });
    }
  }

  /* ── Low glass beside the new walking surface ─────────────────────── */
  const lowGlass = onDeck.filter((w) => {
    const bottom = w.sillFt * 12 - top;
    return w.kind === "window" && bottom >= 0 && bottom < LOW_GLASS.bottomIn && bottom + w.heightFt * 12 > LOW_GLASS.topIn && w.widthFt * w.heightFt > LOW_GLASS.areaSqFt;
  });
  if (lowGlass.length) {
    const lows = lowGlass.map((w) => w.sillFt * 12 - top);
    const lo = Math.min(...lows);
    const hi = Math.max(...lows);
    const height = lo === hi ? inches(lo) : `${Math.round(lo)}–${inches(hi)}`;
    const which = lowGlass.length === 1 ? `The window ${where(lowGlass[0])} starts` : `${lowGlass.length} windows (${places(lowGlass)}) start`;
    add({ id: "window-low-glass", level: "warn", part: PART, text: `${which} ${height} above the deck: glass that low beside a walking surface, a pane over 9 sq ft, must be safety (tempered) glass. Check the stamp in ${lowGlass.length === 1 ? "its" : "each one's"} corner; where it isn't, the sash is replaced — price it.`, rule: "IRC R308.4.3" });
  }

  /* ── A covered deck's roof where it meets the house ───────────────── */
  const rw = roof ? roofAtWall(roof, design) : null;
  if (rw && roof) {
    const r = design.roof;
    let worst: { o: HouseOpening; lower: number; raise: number } | null = null;
    all.forEach((o) => {
      const sp = span(o);
      const lo = Math.max(sp.x0, rw.x0);
      const hi = Math.min(sp.x1, rw.x1);
      if (hi - lo <= 3) return;
      const zs = [lo, hi, Math.min(Math.max((rw.x0 + rw.x1) / 2, lo), hi)].map(rw.z);
      const zMax = Math.max(...zs);
      const zMin = Math.min(...zs);
      const sill = o.sillFt * 12;
      const head = sill + o.heightFt * 12;
      if (!(sill < zMax + ROOF_FLASHING_IN && head > zMin - rw.ledgerIn)) return;
      // Above the roof's line (an upper window): the roof comes down; under it (a tall door, a transom): the roof goes up.
      const lower = (sill + head) / 2 > zMax ? zMax + ROOF_FLASHING_IN - sill : 0;
      const raise = lower ? 0 : head - (zMin - rw.ledgerIn);
      if (!worst || Math.max(lower, raise) > Math.max(worst.lower, worst.raise)) worst = { o, lower, raise };
    });
    if (worst) {
      const { o, lower, raise } = worst as { o: HouseOpening; lower: number; raise: number };
      const depthFt = r.plan.shape === "follows-deck" ? design.shape.depthFt : r.plan.depthFt;
      let fix: DeckCheck["fix"];
      const alts: NonNullable<DeckCheck["alts"]> = [];
      if (roof.kind === "shed" && depthFt > 0) {
        // A shed's line at the wall moves a pitch-step's rise per foot of its run: about `depthFt` inches per 1:12.
        const step = Math.ceil(Math.max(lower, raise) / depthFt);
        const pitch = lower ? r.pitch - step : r.pitch + step;
        if (pitch >= ROOF_LIMITS.pitch.min && pitch <= ROOF_LIMITS.pitch.max) fix = { label: `Pitch the roof ${pitch}:12`, patch: { roof: { ...r, pitch } } };
        const eave = lower ? Math.floor(r.eaveHeightIn - lower) : Math.ceil(r.eaveHeightIn + raise);
        if (eave >= ROOF_LIMITS.eaveHeightIn.min && eave <= ROOF_LIMITS.eaveHeightIn.max) {
          const e = { label: `${lower ? "Drop" : "Raise"} the roof's eave to ${ftIn(eave)}`, patch: { roof: { ...r, eaveHeightIn: eave } } };
          if (fix) alts.push(e);
          else fix = e;
        }
      }
      add({
        id: "roof-openings",
        level: "fail",
        part: "On the house",
        text: lower
          ? `The roof would meet the house across the ${WHAT[o.kind]} ${where(o)}: its sill is ${ftIn(Math.round(o.sillFt * 12))} off the ground, and the roof with its flashing reaches ${ftIn(Math.round(o.sillFt * 12 + lower))} there. Bring the roof down ${inches(lower)} — a lower pitch or a lower eave — or stop it short of the window.`
          : `The roof's ledger would cross the top of the ${WHAT[o.kind]} ${where(o)}: it stands ${ftIn(Math.round((o.sillFt + o.heightFt) * 12))} at its head, and the ledger needs solid wall above it. Raise the roof ${inches(raise)}.`,
        rule: "IRC R903.2 · R507.9",
        fix,
        alts: alts.length ? alts : undefined,
      });
    } else {
      const n = all.filter((o) => overlapIn(span(o), rw) > 3).length;
      if (n) add({ id: "roof-openings", level: "pass", part: "On the house", text: `The roof meets the house clear of the ${n === 1 ? "window or door" : `${n} windows and doors`} along it, with room for the flashing.`, rule: "IRC R903.2" });
    }
  }

  /* ── Glass by the hot tub ─────────────────────────────────────────── */
  const tub = design.spa.on ? spaRectIn(design) : null;
  if (tub) {
    const near = onDeck.filter((w) => {
      if (w.kind !== "window") return false;
      const sp = span(w);
      const dx = Math.max(0, sp.x0 - tub.x1, tub.x0 - sp.x1);
      // Glass beside the tub is glass above the boards: a window of the floor below, under the deck, is not (2026-11-13).
      return Math.hypot(dx, tub.y0) <= TUB_GLASS_IN && w.sillFt * 12 - top < TUB_GLASS_IN && (w.sillFt + w.heightFt) * 12 > top;
    });
    if (near.length) add({ id: "spa-glass", level: "warn", part: "Hot tub spot", text: `${near.length === 1 ? `The window ${where(near[0])} is` : `${near.length} windows are`} within 5 ft of the tub's water and less than 5 ft above the deck: that glass must be safety (tempered) glass. Check the stamps, or move the tub toward the rail.`, rule: "IRC R308.4.5" });
  }
}
