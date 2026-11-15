// THE DECK'S ROOF CLEAR OF THE WINDOWS, FROM THE START (2026-11-14). Pure.
//
// Owner, of a preset covered deck laid on a house built from its photo: "it's supposed to watch where the bottom of
// the house is and not attach it right away to cover the windows … find the right spot and the height of the deck, not
// to cover the windows or doors … at the very beginning attach the deck to the right spot. Make it smart."
//
// The deck's floor is set by lib/deck/houseFromPhoto (the door's threshold, the old deck's floor, else under the
// window sills). This is the roof: where a covered deck's roof would meet the house across a window or a door — the
// check lib/deck/openingChecks "roof-openings" fails — the roof is brought clear the gentlest way that works: lower
// posts (down to 7 ft of head room) or a lower pitch, whichever changes the roof least. The deck's
// own checks are the judge, so what is offered here is exactly what clears them; a roof that cannot be brought clear
// is left as it is, and the check says so with what is in the way.

import { ROOF_LIMITS, type DeckDesign, type RoofDesign } from "./design";
import { buildStructure } from "./structure";
import { deckChecks } from "./checks";

const crosses = (d: DeckDesign): boolean => deckChecks(buildStructure(d)).some((c) => c.id === "roof-openings" && c.level === "fail");
const ftIn = (inches: number) => `${Math.floor(inches / 12)} ft${inches % 12 ? ` ${inches % 12} in.` : ""}`;

export interface RoofFit {
  roof: RoofDesign;
  /** "The roof pitched 3:12 (was 4:12) so it meets the house under the upper windows." */
  words: string;
}

/** The roof brought clear of the house's windows and doors, or null when it is clear already — or cannot be. */
export function roofClearOfWindows(design: DeckDesign): RoofFit | null {
  if (design.structure === "deck" || design.placement === "detached" || !design.house.openings?.length) return null;
  if (!crosses(design)) return null;
  const r = design.roof;
  // Every lower pitch and lower post height there is, the gentlest change first: an inch of lower posts costs an inch,
  // a step of pitch about the eight inches it takes off a 16-ft gable at the wall — and more below 4:12, where
  // shingles want a second layer of underlayment, and again below 3:12.
  const tries: Array<{ roof: RoofDesign; cost: number }> = [];
  for (let pitch = Math.floor(r.pitch); pitch >= ROOF_LIMITS.pitch.min; pitch--)
    for (let eave = Math.floor(r.eaveHeightIn); eave >= ROOF_LIMITS.eaveHeightIn.min; eave -= 3) {
      if (pitch === r.pitch && eave === r.eaveHeightIn) continue;
      const cost = (r.eaveHeightIn - eave) + (r.pitch - pitch) * 8 + (pitch < 4 && r.pitch >= 4 ? 6 : 0) + (pitch < 3 && r.pitch >= 3 ? 12 : 0);
      tries.push({ roof: { ...r, pitch, eaveHeightIn: eave }, cost });
    }
  tries.sort((a, b) => a.cost - b.cost);
  for (const { roof } of tries) {
    if (crosses({ ...design, roof })) continue;
    const said = [roof.pitch !== r.pitch ? `pitched ${roof.pitch}:12 (was ${r.pitch}:12)` : "", roof.eaveHeightIn !== r.eaveHeightIn ? `set on posts ${ftIn(roof.eaveHeightIn)} to the beam (was ${ftIn(r.eaveHeightIn)})` : ""].filter(Boolean).join(" and ");
    return { roof, words: `The roof ${said}, so it meets the house clear of the windows.` };
  }
  return null;
}
