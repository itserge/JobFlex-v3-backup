// THE STAIRS OF A DOUBLE DECK'S LOWER FLOOR LEAVE FROM ITS OWN EDGE (2026-11-15 — the owner, with a lower deck shaped
// on its own, 39 × 10½ ft under an upper deck 31 × 15 ft: "check why the steps are separated"). The lower floor's
// stairs were set on the UPPER deck's front line, so under a deeper upper deck they stood out in the yard, feet from
// the floor they serve. They leave from the lower floor's own outline now (lib/deck/structure, lib/deck/design
// normalizeStairs): its own front where the stair is, one part of that front, its end part's own side — and steps that
// wrap it follow its outline. A lower floor with the upper deck's own outline, and a lower level in front, are as they
// were. Pure.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-lower-stairs.check.ts
import { defaultDeckDesign, defaultStair, frontEdgeAt, normalizeDeckDesign, type DeckDesign, type DeckShape, type StairDesign } from "@/lib/deck/design";
import { buildStructure } from "@/lib/deck/structure";
import { deckChecks } from "@/lib/deck/checks";
import { priceDeck } from "@/lib/deck/pricing";
import { deckScene } from "@/lib/deck/scene";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};

const d0 = defaultDeckDesign({ state: "WA" });
const upper: DeckShape = { kind: "rect", widthFt: 31, depthFt: 15 };
// The owner's lower deck: wider than the upper, shallower, its front in two parts (31 ft at 8 ft out, 8 ft at 10½).
const ownLower: DeckShape = { kind: "wall", widthFt: 39, depthFt: 10.5, back: [{ x0Ft: 0, x1Ft: 39, yFt: 0 }], front: [{ x0Ft: 0, x1Ft: 31, yFt: 8 }, { x0Ft: 31, x1Ft: 39, yFt: 10.5 }] };
const stair = (id: string, side: StairDesign["side"], atFt: number, level: "upper" | "lower", more: Partial<StairDesign> = {}): StairDesign => ({ ...defaultStair(id, side, atFt), level, ...more });
const make = (lower: Record<string, unknown>, stairs: StairDesign[], shape: DeckShape = upper): DeckDesign =>
  normalizeDeckDesign({ ...d0, shape, heightIn: 126, house: { ...d0.house, leftFt: 2, rightFt: 12 }, lower: { ...d0.lower, on: true, place: "under", heightIn: 24, ...lower }, stairs });
/** How near the house a stair's members come, inches out from the house line: the head of its stringers (a front stair). */
const headY = (s: ReturnType<typeof buildStructure>, id: string) => Math.min(...s.stairs.find((st) => st.design.id === id)!.members.filter((m) => m.role === "stringer").map((m) => m.cy - (Math.abs(Math.sin(m.yaw)) * m.sx * Math.cos(m.tilt)) / 2));

console.log("— a lower floor shaped on its own —");
{
  const d = make({ shape: ownLower, offsetFt: 0 }, [stair("u1", "front", 26, "upper"), stair("l1", "front", 35, "lower"), stair("l2", "front", 10, "lower")]);
  const s = buildStructure(d);
  const own = s.lower!.design.shape;
  check("the lower floor is its own outline: 39 × 10½ ft, its front in two parts", s.lower!.place === "under" && own.widthFt === 39 && own.kind === "wall" && own.front?.length === 2, own);
  const l1 = headY(s, "l1");
  const l2 = headY(s, "l2");
  check("a stair on its right part leaves from ITS front there (10½ ft out), not the upper deck's (15 ft)", Math.abs(l1 - frontEdgeAt(own, 35 * 12)) <= 4 && frontEdgeAt(own, 35 * 12) === 126, { head: l1, lowerFront: frontEdgeAt(own, 35 * 12), upperFront: 180 });
  check("a stair on its left part leaves from that part's front (8 ft out)", Math.abs(l2 - frontEdgeAt(own, 10 * 12)) <= 4 && frontEdgeAt(own, 10 * 12) === 96, { head: l2 });
  const u1 = headY(s, "u1");
  check("the upper deck's own stair still leaves from the upper deck's front (15 ft)", Math.abs(u1 - 180) <= 4, u1);
  check("both lower stairs go to the ground from the lower floor's height", s.stairs.filter((st) => st.level === "lower").every((st) => st.kind === "flight" && st.risers >= 3 && st.risers <= 4), s.stairs.map((st) => [st.design.id, st.level, st.risers]));
  // In the 3D: the stair's stringers touch the lower deck's boards, in plan.
  const sc = deckScene(s);
  check("the 3D builds with them", sc.boxes.length > 0);
  check("it prices, and the checks run", priceDeck(d).subtotal > 0 && deckChecks(s).length > 0);
}

console.log("— on one part of its front, on its own end —");
{
  // A stair asked astride the step between the two parts (at 31 ft): it stays on one part of the LOWER floor's front.
  const d = make({ shape: ownLower, offsetFt: 0 }, [stair("l1", "front", 31, "lower")]);
  const st = d.stairs[0];
  const onPart = ownLower.kind === "wall" && ownLower.front!.some((q) => st.atFt - st.widthFt / 2 >= q.x0Ft - 1e-6 && st.atFt + st.widthFt / 2 <= q.x1Ft + 1e-6);
  check("a stair asked astride a step in the lower floor's front is moved onto one part of it", onPart, { atFt: st.atFt, widthFt: st.widthFt });
  // A side stair on the left end: that end part stands 8 ft out, so the stair's middle is within it.
  const side = make({ shape: ownLower, offsetFt: 0 }, [stair("l1", "left", 9.5, "lower")]);
  check("a side stair stays on the end part's own side (8 ft long here, not the deck's 10½)", side.stairs[0].atFt <= 8 - side.stairs[0].widthFt / 2 + 1e-6, side.stairs[0].atFt);
  const far = make({ shape: ownLower, offsetFt: 0 }, [stair("l1", "front", 60, "lower")]);
  check("a stair asked past the lower floor's end is brought onto it (39 ft wide, not the upper's 31)", far.stairs[0].atFt <= 39 - far.stairs[0].widthFt / 2 + 1e-6 && far.stairs[0].atFt > 31, far.stairs[0].atFt);
}

console.log("— slid along the house —");
{
  const d = make({ shape: { kind: "rect", widthFt: 20, depthFt: 10 }, offsetFt: 6 }, [stair("l1", "front", 10, "lower")]);
  const s = buildStructure(d);
  const st = s.stairs.find((x) => x.design.id === "l1")!;
  const xs = st.members.filter((m) => m.role === "stringer").map((m) => m.cx);
  check("a lower floor 6 ft along from the upper deck's end: its stair is at ITS 10 ft (16 ft from the upper deck's end)", Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 16 * 12) <= 3, xs);
  check("…and leaves from its own front (10 ft out)", Math.abs(headY(s, "l1") - 120) <= 4, headY(s, "l1"));
}

console.log("— steps that wrap the lower floor follow its outline —");
{
  const d = make({ shape: ownLower, offsetFt: 0, heightIn: 21 }, [stair("l1", "front", 10, "lower", { wrap: true, wrapSides: 3 })]);
  const s = buildStructure(d);
  const st = s.stairs.find((x) => x.design.id === "l1")!;
  check("built as wide steps", st.kind === "box" && st.treads > 0, { kind: st.kind, treads: st.treads });
  // A tread board along the LEFT part's front (8 ft out): one that runs most of that part's 31 ft, just outside 96 in.
  const rings = st.treadRings ?? [];
  const nearLeftFront = rings.some((t) => {
    const xs = t.ring.filter((_, i) => i % 2 === 0);
    const ys = t.ring.filter((_, i) => i % 2 === 1);
    return Math.min(...xs) < 24 && Math.max(...xs) > 25 * 12 && Math.min(...ys) >= 95 && Math.max(...ys) <= 96 + 40;
  });
  check("a step runs along its left part's own front (8 ft out) — not only along the rectangle it fits in", nearLeftFront, rings.length);
}

console.log("— as it was: the upper deck's own outline under it; a lower level in front —");
{
  // The same outline: the lower floor's front IS the upper deck's, so its stair stands where it always did.
  const same = make({}, [stair("l1", "front", 12, "lower")]);
  const s = buildStructure(same);
  check("a lower floor with the upper deck's outline: its stair at that shared front (15 ft)", Math.abs(headY(s, "l1") - 180) <= 4 && !same.lower.shape, headY(s, "l1"));
  const front = normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 20, depthFt: 12 }, heightIn: 60, lower: { ...d0.lower, on: true, place: "front", widthFt: 12, depthFt: 8, dropIn: 21 }, stairs: [stair("l1", "front", 6, "lower")] });
  const sf = buildStructure(front);
  // A lower level in front of the deck: its front is its own depth out from the deck's front.
  check("a lower level in front: its stair at its own front, as before", Math.abs(headY(sf, "l1") - (12 + 8) * 12) <= 4, headY(sf, "l1"));
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
