// The corner look (2026-11-13, lib/deck/houseCorner — owner: "it still doesn't understand the jogs, make it more
// smart"): a corner the picture shows without saying which side stands forward is cut out and asked about by itself.
// Here: the cut (round the step, eave to ground, the step at its middle), which steps are still open, the model's
// answer laid on the read (a step either way, at its depth or unsized; a divider taken away; left alone when unsure),
// and what the built house says about a corner still open. Pure — the model's call itself is not made here.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house-corner.check.ts
import { HOUSE_CORNER_PROMPT, applyCornerVerdict, cornerCrop, houseCornerSchema, unresolvedSteps } from "@/lib/deck/houseCorner";
import { parseHouseRead, readSections, type HouseRead } from "@/lib/deck/houseRead";
import { houseFromPhoto } from "@/lib/deck/houseFromPhoto";
import { defaultDeckDesign } from "@/lib/deck/design";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// a two-storey wall across the picture, its base at 80 % of the height, its eave at 30 %
const W = 1200, H = 900;
const flat = parseHouseRead({
  base: { left: { x: 0.1, y: 0.8 }, right: { x: 0.9, y: 0.8 } },
  eave: { left: { x: 0.1, y: 0.3 }, right: { x: 0.9, y: 0.3 } },
  storeys: 2,
  sections: [{ x0: 0.1, x1: 0.9, outFt: 0 }],
  windows: [{ x0: 0.2, x1: 0.28, sill: 0.7, head: 0.58 }, { x0: 0.62, x1: 0.7, sill: 0.7, head: 0.58 }],
  doors: [],
  roof: { kind: "hip", pitch: 4 },
  bars: { top: 0, bottom: 0 },
  confidence: 0.8,
})!;
check("the test wall parses", !!flat && flat.jogs.length === 0);
// the picture's pass found a corner at the wall's middle and not which way: a divider
const open: HouseRead = { ...flat, jogs: [{ x: 0.5, y: 0.8, dir: "toward", depthFt: 0 }] };
check("a divider is a step still open; a sized step is not", unresolvedSteps(open).join() === "0" && unresolvedSteps({ ...open, jogs: [{ ...open.jogs[0], depthFt: 3 }] }).length === 0 && unresolvedSteps({ ...open, jogs: [{ ...open.jogs[0], depthFt: null }] }).length === 0);

const crop = cornerCrop(open, 0)!;
check("the cut has the corner at its middle", !!crop && near(crop.x + crop.w / 2, 0.5, 0.002), JSON.stringify(crop));
check("…runs from above the eave to below the base", crop.y < 0.3 - 0.1 && crop.y + crop.h > 0.8 + 0.05 && crop.y >= 0 && crop.y + crop.h <= 1, JSON.stringify(crop));
check("…and is wide enough to show a window either side, not the whole wall", crop.w >= 0.3 && crop.w <= 0.62, String(crop.w));
const edge = cornerCrop({ ...open, jogs: [{ ...open.jogs[0], x: 0.13 }] }, 0);
check("near the picture's edge the cut narrows to keep the corner at its middle", !!edge && near(edge.x + edge.w / 2, 0.13, 0.002) && edge.x >= 0, JSON.stringify(edge));
check("a corner at the very edge is not cut at all", cornerCrop({ ...open, jogs: [{ ...open.jogs[0], x: 0.01 }] }, 0) === null && cornerCrop(open, 3) === null);

const right = applyCornerVerdict(open, 0, { verdict: "right-forward", stepFt: 4.2, confidence: 0.8 });
check("the right side said to stand forward: a step out, at the model's depth in half-feet", right.did === "step" && right.read.jogs[0].dir === "toward" && right.read.jogs[0].depthFt === 4 && readSections(right.read).map((x) => x.outFt).join() !== "0,0", JSON.stringify(right.read.jogs));
const left = applyCornerVerdict(open, 0, { verdict: "left-forward", stepFt: null, confidence: 0.7 });
check("the left side forward with no depth judged: a step back, unsized (a guess, said so)", left.did === "step" && left.read.jogs[0].dir === "away" && left.read.jogs[0].depthFt === null);
check("a step is held to 1–12 ft", applyCornerVerdict(open, 0, { verdict: "right-forward", stepFt: 40, confidence: 0.9 }).read.jogs[0].depthFt === 12 && applyCornerVerdict(open, 0, { verdict: "right-forward", stepFt: 0.8, confidence: 0.9 }).read.jogs[0].depthFt === 1);
const same = applyCornerVerdict(open, 0, { verdict: "same-plane", stepFt: null, confidence: 0.9 });
check("one flat wall, said surely: the divider is taken away", same.did === "removed" && same.read.jogs.length === 0);
check("…said less surely, or unclear, or with little confidence: the read is left as it was", applyCornerVerdict(open, 0, { verdict: "not-a-corner", stepFt: null, confidence: 0.6 }).did === "kept" && applyCornerVerdict(open, 0, { verdict: "unclear", stepFt: 3, confidence: 0.9 }).did === "kept" && applyCornerVerdict(open, 0, { verdict: "right-forward", stepFt: 3, confidence: 0.4 }).read === open);

// what the built house says
const design = defaultDeckDesign({ state: "WA" });
const builtOpen = houseFromPhoto({ read: open, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!;
const stepsFact = builtOpen.facts.find((f) => f.id === "steps")!;
check("a corner still open is built as nothing, and SAID: in the summary and under Look at", builtOpen.house.jogs.length === 0 && /A straight wall so far — 1 corner seen in it, not yet a step/.test(stepsFact.value) && stepsFact.guess && builtOpen.checks.some((c) => /A corner shows in the wall about .* from its left end, but not which side stands forward/.test(c)), `${stepsFact.value} | ${builtOpen.checks.join(" | ")}`);
const builtSet = houseFromPhoto({ read: right.read, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!;
check("once the corner look has set it: one step out 4 ft, nothing left to look at about it", builtSet.house.jogs.length === 1 && builtSet.house.jogs[0].dir === "toward" && builtSet.house.jogs[0].depthFt === 4 && !builtSet.checks.some((c) => /which side stands forward/.test(c)), JSON.stringify(builtSet.house.jogs));
const builtPlain = houseFromPhoto({ read: flat, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!;
check("a wall with no corner in it is still just \"A straight wall\"", builtPlain.facts.find((f) => f.id === "steps")!.value === "A straight wall" && !builtPlain.facts.find((f) => f.id === "steps")!.guess);

// the question and the answer's shape
check("the question names the evidence: the return, the ground line, the siding courses, the soffit, the shadow", /A RETURN/.test(HOUSE_CORNER_PROMPT) && /THE GROUND LINE/.test(HOUSE_CORNER_PROMPT) && /THE SIDING COURSES/.test(HOUSE_CORNER_PROMPT) && /soffit is DEEPER/.test(HOUSE_CORNER_PROMPT) && /SHADOW/.test(HOUSE_CORNER_PROMPT) && /Never guess a step you cannot see/.test(HOUSE_CORNER_PROMPT));
check("…and tells the model to look past a porch roof and an old deck", /A porch roof, a patio cover, its posts, an old deck/.test(HOUSE_CORNER_PROMPT));
const ok = houseCornerSchema.safeParse({ line: "an outside corner", verdict: "right-forward", stepFt: 6, evidence: "a return strip facing left", confidence: 0.8 });
const no = houseCornerSchema.safeParse({ line: "x", verdict: "forward", stepFt: null, evidence: "", confidence: 1 });
check("the answer's shape is held: five verdicts, no other", ok.success && !no.success);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
