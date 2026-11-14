// THE CORNER LOOK (2026-11-13, owner, of a photo read as "A straight wall" though the reader had found the corner in
// its middle: "it still doesn't understand the jogs — make it more smart to understand and read the jogs").
//
// The picture's own pass (lib/deck/wallSteps) finds the corners in a wall — an edge that runs up every storey — and
// which way each part stands by where its eave sits in the picture. Under one straight eave (one roof over a stepped
// wall, its soffit simply deeper over the part set back) it can say there IS a corner and not which side of it stands
// forward; the corner was then left as a divider "to tap", and built as nothing.
//
// So the corner is asked about by itself: a close cut of the picture round that one line — roof edge to the ground —
// goes to the model with ONE question: which side of this line stands nearer the camera, and by about how much?
// A model that has to place every window of a whole house says steps the wrong way round; looking at one corner,
// enlarged, with the evidence named, it has little else to get wrong. Its answer sets the step (or takes the divider
// away, when the line is a downspout or a trim board on one flat wall); "unclear" leaves the divider as it was.
//
// Pure: the cut, the question, the answer's shape, and the answer laid on the read.

import { z } from "zod";
import type { HouseRead, ReadCrop } from "./houseRead";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const CORNER_VERDICTS = ["right-forward", "left-forward", "same-plane", "not-a-corner", "unclear"] as const;
export type CornerVerdict = (typeof CORNER_VERDICTS)[number];

export const houseCornerSchema = z.object({
  /** what the line at the picture's middle is, in a few words: "an outside corner of the wall", "a downspout", … */
  line: z.string(),
  verdict: z.enum(CORNER_VERDICTS),
  /** how far the nearer side stands in front of the other, feet; null when it cannot be judged */
  stepFt: z.number().nullable(),
  /** the evidence seen, one sentence */
  evidence: z.string(),
  confidence: z.number(),
});
export type HouseCornerAnswer = z.infer<typeof houseCornerSchema>;

export const HOUSE_CORNER_PROMPT = `You look at ONE vertical line on the back wall of a house, for a deck builder who must know the wall's shape. The picture is a close cut of a photo taken from the yard: the line in question runs up the wall at the MIDDLE of the picture's width (the user message gives its x in pixels). To its LEFT is one stretch of the house's wall, to its RIGHT another.
THE QUESTION: is this line a step in the wall — and if so, which stretch stands NEARER the camera (further out into the yard)?
Answer "verdict": "right-forward" (the wall to the RIGHT of the line stands nearer the camera than the wall to its left), "left-forward" (the wall to the LEFT stands nearer), "same-plane" (both stretches are one flat wall: the line is a trim board, a colour change, a downspout or a joint on it), "not-a-corner" (there is no such line on the house's wall here — a tree trunk, a post, a fence, a porch roof's post), or "unclear".
THE EVIDENCE, in the order to trust it:
1. A RETURN: at a step, a narrow strip of wall faces SIDEWAYS between the two stretches — its siding courses foreshortened, its shade different. The strip belongs to the stretch that stands FORWARD and joins it to the one behind.
2. THE GROUND LINE: where each stretch meets the ground (or the patio). The nearer stretch's base sits LOWER in the picture; a flat wall's base runs straight through the line.
3. THE SIDING COURSES (lap lines, brick courses): on one flat wall they run straight through the line. At a step they BREAK — offset up or down, or spaced differently either side (wider apart on the nearer stretch).
4. THE EAVE AND SOFFIT: under one straight roof edge, the soffit is DEEPER (a wider dark band under the eave) over the stretch that is set BACK. A stretch with its own roof edge standing lower or further out is nearer.
5. SHADOW: a stretch that stands forward throws a shadow onto the wall beside it, starting at the line.
6. SIZE: the same kind of window or door looks a little larger on the nearer stretch.
A porch roof, a patio cover, its posts, an old deck, a railing, stairs, a hedge or a tree in front of the wall are NOT the wall: look past them at the wall itself. A lower roof over one stretch's ground storey is not by itself a step — judge the WALL under it and above it.
"stepFt": about how far the nearer stretch stands in front of the other, in feet (a bay or a bump-out is 2 to 4; a room or a wing 4 to 12; judge it by the return strip's width against a door, 80 inches tall, or a window, 3 to 4 ft wide); null when you cannot judge it. "line": what the line is, in a few words. "evidence": the one or two things you actually saw, in one sentence. "confidence": 0 to 1 — under 0.5, answer "unclear". Never guess a step you cannot see.`;

/** Around one step of the read: a cut of the picture from above the eave to below the base, the step at its middle. */
export function cornerCrop(read: HouseRead, jogIndex: number): ReadCrop | null {
  const j = read.jogs[jogIndex];
  if (!j) return null;
  const left = Math.min(read.base.left.x, read.base.right.x), right = Math.max(read.base.left.x, read.base.right.x);
  const wall = Math.max(0.05, right - left);
  // the wall's height in the picture at the step
  const t = clamp((j.x - read.base.left.x) / Math.max(1e-6, read.base.right.x - read.base.left.x), 0, 1);
  const baseY = read.base.left.y + (read.base.right.y - read.base.left.y) * t;
  const eaveY = read.eave ? read.eave.left.y + (read.eave.right.y - read.eave.left.y) * t : baseY - 0.3;
  const tall = Math.max(0.08, baseY - eaveY);
  // wide enough to show a window either side and the return between: a quarter of the wall, no less than the wall is tall
  const half = clamp(Math.max(wall * 0.22, tall * 0.5), 0.06, 0.3);
  const x0 = clamp(j.x - half, 0, 1), x1 = clamp(j.x + half, 0, 1);
  // keep the step at the middle where the picture's edge cuts one side short
  const reach = Math.min(j.x - x0, x1 - j.x);
  if (reach < 0.03) return null;
  const y0 = clamp(eaveY - tall * 0.35, 0, 1), y1 = clamp(baseY + tall * 0.22, 0, 1);
  if (y1 - y0 < 0.05) return null;
  return { x: r3(j.x - reach), y: r3(y0), w: r3(2 * reach), h: r3(y1 - y0) };
}

/** The steps the read still cannot say the way of: dividers the picture's pass (or the review) left level. */
export function unresolvedSteps(read: HouseRead): number[] {
  return read.jogs.map((j, i) => (j.depthFt === 0 ? i : -1)).filter((i) => i >= 0);
}

/**
 * The model's answer about one step laid on the read: a side said to stand forward makes the divider a step that way
 * (at the model's depth, half-feet, 1 to 12 ft; unsized — a guess, said so — when it gave none); "same plane" or
 * "not a corner", said with confidence, takes the divider away; anything else leaves the read as it was.
 */
export function applyCornerVerdict(read: HouseRead, jogIndex: number, answer: Pick<HouseCornerAnswer, "verdict" | "stepFt" | "confidence">): { read: HouseRead; did: "step" | "removed" | "kept" } {
  const j = read.jogs[jogIndex];
  if (!j || !Number.isFinite(answer.confidence) || answer.confidence < 0.5) return { read, did: "kept" };
  if (answer.verdict === "right-forward" || answer.verdict === "left-forward") {
    const depthFt = typeof answer.stepFt === "number" && Number.isFinite(answer.stepFt) && answer.stepFt >= 0.75 ? Math.round(clamp(answer.stepFt, 1, 12) * 2) / 2 : null;
    const jogs = read.jogs.map((x, i) => (i === jogIndex ? { ...x, dir: answer.verdict === "right-forward" ? ("toward" as const) : ("away" as const), depthFt } : x));
    return { read: { ...read, jogs }, did: "step" };
  }
  if ((answer.verdict === "same-plane" || answer.verdict === "not-a-corner") && answer.confidence >= 0.7) {
    return { read: { ...read, jogs: read.jogs.filter((_, i) => i !== jogIndex) }, did: "removed" };
  }
  return { read, did: "kept" };
}
