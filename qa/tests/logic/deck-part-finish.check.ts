// BOARDS OF THEIR OWN FOR THE STEPS AND THE BUILT-INS (2026-11-14, lib/deck/finish — the owner: "when I click on the 3D,
// for example, steps around, I can replace a different material or colour. And the same with the bench… so I click and I
// can change the colours or material on the steps and the accessories"). A stair's treads and risers and a built-in's
// boards may be any line of the catalog in any colour of it: read back safely, bought as their own line at their own
// price, drawn in their own colour, picked from the part's card in the 3D. Absent, they are the deck's own. Pure.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-part-finish.check.ts
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, type DeckDesign, type DeckShape } from "@/lib/deck/design";
import { applyDeckPatch } from "@/lib/deck/checks";
import { buildStructure } from "@/lib/deck/structure";
import { priceDeck } from "@/lib/deck/pricing";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { finishPatch, partAt, partCard, tryChoice } from "@/lib/deck/parts";
import { finishColors, finishKey, finishLines, finishProduct, finishWords, normalizeFinish, sameFinish } from "@/lib/deck/finish";
import { deckingProduct, DECKING } from "@/lib/deck/catalog";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};

const d0 = defaultDeckDesign({ state: "WA" });
const bench = { id: "b1", kind: "bench", side: "front", atFt: 4, lengthFt: 6 } as const;
const planter = { id: "b2", kind: "planter", side: "front", atFt: 13, lengthFt: 4 } as const;
const base = (more: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, heightIn: 30, stairs: [defaultStair("s1", "front", 8)], extras: { ...d0.extras, builtIns: [bench, planter] }, ...more });

console.log("— read back —");
{
  check("a line of the catalog in one of its colours is kept", sameFinish(normalizeFinish({ product: "trex-select", color: "saddle" }), { product: "trex-select", color: "saddle" }));
  check("a colour that line does not come in is its usual tone", normalizeFinish({ product: "trex-select", color: "jasper" })?.color === "");
  check("a line the catalog does not have is no board of its own", normalizeFinish({ product: "made-up" }) === null && normalizeFinish(null) === null && normalizeFinish("trex") === null);
  const d = normalizeDeckDesign({ ...d0, stairs: [{ ...defaultStair("s1", "front", 8), finish: { product: "ipe-54", color: "nope" } }], extras: { ...d0.extras, builtIns: [{ ...bench, finish: { product: "trex-select", color: "saddle" } }] } });
  check("on a stair and a built-in, through the design's own read-back", d.stairs[0].finish?.product === "ipe-54" && d.stairs[0].finish?.color === "" && d.extras.builtIns?.[0].finish?.color === "saddle", { st: d.stairs[0].finish, bi: d.extras.builtIns?.[0].finish });
  check("absent stays absent (the deck's own)", base().stairs[0].finish === undefined && base().extras.builtIns?.every((b) => b.finish === undefined));
  check("every line of the catalog is offered, grouped", finishLines().reduce((a, g) => a + g.products.length, 0) === DECKING.length && finishLines()[0].family === "treated");
  check("a line's colours, each with its look", finishColors("trex-select").length === 5 && finishColors("trex-select").every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)) && finishColors("cedar-54").length === 0);
  check("in words", finishWords({ product: "trex-select", color: "saddle" }) === "Trex Select in Saddle" && finishWords(null) === "the deck's own boards");
  check("a key for the material list's ids", finishKey({ product: "trex-select", color: "saddle" }) === "trex-select.saddle" && finishKey({ product: "ipe-54", color: "" }) === "ipe-54");
  const deck = buildStructure(base()).surface!.product;
  const own = finishProduct(deck, { product: "trex-select", color: "saddle" });
  check("the board resolved: its line, named with its colour, looking like it", own.id === "trex-select" && own.label === "Trex Select in Saddle" && own.color === "#8b5e40" && own.colorName === "Saddle");
  check("none: the deck's own board as the frame resolved it", finishProduct(deck, null) === deck);
}

console.log("— the material list —");
{
  const plain = priceDeck(base());
  const owned = priceDeck(base({ stairs: [{ ...defaultStair("s1", "front", 8), finish: { product: "trex-select", color: "saddle" } }], extras: { ...d0.extras, builtIns: [{ ...bench, finish: { product: "ipe-54", color: "" } }, planter] } }));
  const ids = (p: typeof plain) => p.bom.map((l) => l.id);
  check("the deck's own: the lines as they always were", ids(plain).includes("bench-boards") && ids(plain).includes("planter-boards") && ids(plain).some((i) => /^tread-boards-\d+$/.test(i)) && ids(plain).includes("riser-boards"));
  const tread = owned.bom.find((l) => l.id.startsWith("tread-boards-own-trex-select.saddle-"));
  check("the stair's own treads: a line of their own, the board named with its colour, at that board's price", !!tread && /^Trex Select in Saddle × \d+ ft — treads$/.test(tread.label) && tread.rateKey === "deck.trex-select", tread);
  check("…its risers in the fascia that goes with the board", owned.bom.some((l) => l.id === "riser-boards-own-trex-select.saddle" && l.rateKey === "fascia.composite"));
  const seat = owned.bom.find((l) => l.id === "bench-boards-ipe-54");
  check("the bench's own boards: a line of their own at that board's price", !!seat && seat.label.startsWith("Ipe 5/4x6 × 12 ft — bench seats") && seat.rateKey === "deck.ipe-54", seat);
  check("…its apron in wood fascia (ipe is wood)", owned.bom.some((l) => l.id === "bench-apron-ipe-54" && l.rateKey === "fascia.wood"));
  check("the planter left as it was keeps the deck's boards", owned.bom.some((l) => l.id === "planter-boards") && !owned.bom.some((l) => l.id === "bench-boards"));
  const cost = (p: typeof plain, re: RegExp) => p.bom.filter((l) => re.test(l.id)).reduce((a, l) => a + l.cost, 0);
  check("dearer boards cost more", cost(owned, /^tread-boards/) > cost(plain, /^tread-boards/) && cost(owned, /^bench-boards/) > cost(plain, /^bench-boards/), { tread: [cost(plain, /^tread-boards/), cost(owned, /^tread-boards/)], bench: [cost(plain, /^bench-boards/), cost(owned, /^bench-boards/)] });
  check("the frame under them is the same lumber", JSON.stringify(plain.bom.filter((l) => /bench-(posts|cleats|blocking)|stringer/.test(l.id)).map((l) => [l.id, l.qty])) === JSON.stringify(owned.bom.filter((l) => /bench-(posts|cleats|blocking)|stringer/.test(l.id)).map((l) => [l.id, l.qty])));
  // A board of the contractor's own for the deck is the DECK's: it does not reach a stair with its own boards.
  const custom = priceDeck(applyDeckPatch(base({ stairs: [{ ...defaultStair("s1", "front", 8), finish: { product: "trex-select", color: "saddle" } }] }), { custom: { decking: { name: "Yard special", pricePerUnit: 1, unit: "lf" } } as unknown as DeckDesign["custom"] }));
  const ownTread = custom.bom.find((l) => l.id.startsWith("tread-boards-own-"));
  check("the contractor's own decking price does not reach treads of their own", !!ownTread && ownTread.rateKey === "deck.trex-select", ownTread?.rateKey);
}

console.log("— the 3D —");
{
  const s = buildStructure(base({ stairs: [{ ...defaultStair("s1", "front", 8), wrap: true, finish: { product: "trex-select", color: "saddle" } }], extras: { ...d0.extras, builtIns: [{ ...bench, finish: { product: "ipe-54", color: "" } }, planter] } }));
  const sc = deckScene(s);
  const role = (i: number) => sc.legend[sc.tags[i]]?.role ?? "";
  const stairPaint = sc.paints?.find((p) => p.of === "s1");
  const benchPaint = sc.paints?.find((p) => p.of === "b1");
  check("the steps' boards wear their own colour", !!stairPaint && stairPaint.hex === "#8b5e40" && stairPaint.boxes.length > 0 && stairPaint.boxes.every((i) => /tread|riser/.test(role(i))), { paint: stairPaint && { hex: stairPaint.hex, n: stairPaint.boxes.length }, roles: [...new Set(stairPaint?.boxes.map(role))] });
  check("the bench's boards wear theirs — its legs and cleats stay the frame's", !!benchPaint && benchPaint.boxes.length > 0 && benchPaint.boxes.every((i) => /bench (seat|back|cap|apron)/.test(role(i))) && sc.boxes.some((_, i) => /bench leg/.test(role(i)) && !benchPaint.boxes.includes(i)), [...new Set(benchPaint?.boxes.map(role))]);
  check("the planter left as it was wears no paint", !sc.paints?.some((p) => p.of === "b2"));
  check("a deck with no boards of their own has no paints", deckScene(buildStructure(base())).paints === undefined);
  const back = parseDeckScene(JSON.parse(JSON.stringify(sc)));
  check("kept when a saved scene is read back", JSON.stringify(back?.paints) === JSON.stringify(sc.paints));
  const junk = parseDeckScene({ ...JSON.parse(JSON.stringify(sc)), paints: [{ hex: "red", boxes: [1] }, { hex: "#123456", boxes: [-1, 999999, 2.5, 3], rings: [7] }] });
  check("a malformed paint is dropped, a bad index left out", junk?.paints?.length === 1 && JSON.stringify(junk.paints[0].boxes) === "[3]" && junk.paints[0].rings.length === 0, junk?.paints);
  // Steps round a shaped deck are boards cut to a shape: their rings wear the paint too.
  const shaped: DeckShape = { kind: "wall", widthFt: 20, depthFt: 14, back: [{ x0Ft: 0, x1Ft: 20, yFt: 0 }], front: [{ x0Ft: 0, x1Ft: 6, yFt: 10 }, { x0Ft: 6, x1Ft: 14, yFt: 14, clipLeftFt: 2, clipRightFt: 2 }, { x0Ft: 14, x1Ft: 20, yFt: 10 }] };
  const ss = buildStructure(base({ shape: shaped, stairs: [{ ...defaultStair("s1", "front", 10), wrap: true, wrapSides: 3, finish: { product: "trex-select", color: "saddle" } }] }));
  const ssc = deckScene(ss);
  const rp = ssc.paints?.find((p) => p.of === "s1");
  check("steps round a shaped deck: their cut treads wear it", !!rp && rp.rings.length > 0 && (ss.stairs[0].treadRings?.length ?? 0) === rp.rings.length, { rings: rp?.rings.length, treadRings: ss.stairs[0].treadRings?.length });
  check("…and a click on one of them is that stair", !!rp && partAt(ss, ssc, null, "decking", rp.rings[0])?.kind === "stair" && partAt(ss, ssc, null, "decking", rp.rings[0])?.id === "s1");
  const plainShaped = buildStructure(base({ shape: shaped, stairs: [{ ...defaultStair("s1", "front", 10), wrap: true, wrapSides: 3 }] }));
  const psc = deckScene(plainShaped);
  const firstTreadRing = (psc.diagonal?.boards ?? []).findIndex((r) => (plainShaped.stairs[0].treadRings ?? []).some((t) => t.ring.length === r.length && t.ring.every((v, i) => Math.abs(v / 12 - r[i]) < 0.01)));
  check("…even before they have boards of their own", firstTreadRing >= 0 && partAt(plainShaped, psc, null, "decking", firstTreadRing)?.id === "s1", firstTreadRing);
  check("a click on a deck board that is no step is nothing to pick", partAt(plainShaped, psc, null, "decking", 0)?.kind !== "stair" || firstTreadRing === 0);
}

console.log("— the card —");
{
  const d = base({ stairs: [{ ...defaultStair("s1", "front", 8), wrap: true }] });
  const s = buildStructure(d);
  const sc = deckScene(s);
  const role = (i: number) => sc.legend[sc.tags[i]]?.role ?? "";
  const seatBox = sc.boxes.findIndex((_, i) => role(i) === "bench seat");
  const legBox = sc.boxes.findIndex((_, i) => role(i) === "bench leg");
  // (Steps round the deck lay their treads as boards cut to the outline — rings; their risers are boxes.)
  const treadBox = sc.boxes.findIndex((_, i) => /riser/.test(role(i)));
  const treadRing = (sc.diagonal?.boards ?? []).findIndex((r) => (s.stairs[0].treadRings ?? []).some((t) => t.ring.length === r.length && t.ring.every((v, i) => Math.abs(v / 12 - r[i]) < 0.01)));
  check("a click on a bench's seat is that bench", partAt(s, sc, seatBox)?.kind === "built-in" && partAt(s, sc, seatBox)?.id === "b1", partAt(s, sc, seatBox));
  check("…on its leg too", partAt(s, sc, legBox)?.kind === "built-in" && partAt(s, sc, legBox)?.id === "b1", partAt(s, sc, legBox));
  check("a click on a step's riser is that stair", treadBox >= 0 && partAt(s, sc, treadBox)?.kind === "stair" && partAt(s, sc, treadBox)?.id === "s1", treadBox);
  check("a click on a step's tread is that stair", treadRing >= 0 && partAt(s, sc, null, "decking", treadRing)?.id === "s1", treadRing);
  const bc = partCard(s, { kind: "built-in", id: "b1" });
  check("the bench's card: its title, what it is, its boards (the deck's own now), and Remove", bc.title === "Bench" && /bench of deck boards/.test(bc.does) && bc.finish?.now === null && bc.finish?.target.kind === "built-in" && bc.choices.some((c) => c.tone === "remove"), { title: bc.title, finish: bc.finish });
  const sc2 = partCard(s, { kind: "stair", id: "s1" });
  check("the steps' card: 'Steps round the deck', their boards", sc2.title === "Steps round the deck" && sc2.finish?.target.kind === "stair" && sc2.finish.deckProduct === d.decking.product, { title: sc2.title, finish: sc2.finish });
  const pc = partCard(s, { kind: "built-in", id: "b2" });
  check("a planter's card", pc.title === "Planter box" && !!pc.finish);
  // Picking a board: the patch, tried first.
  const p = finishPatch(d, { kind: "stair", id: "s1" }, { product: "trex-select", color: "saddle" });
  const after = applyDeckPatch(d, p);
  check("picking a board for the steps sets it on that stair alone", after.stairs[0].finish?.color === "saddle" && JSON.stringify(after.extras.builtIns) === JSON.stringify(d.extras.builtIns));
  const back = applyDeckPatch(after, finishPatch(after, { kind: "stair", id: "s1" }, null));
  check("…and back to the deck's own takes it off", back.stairs[0].finish === undefined && !("finish" in back.stairs[0]));
  const pb = applyDeckPatch(d, finishPatch(d, { kind: "built-in", id: "b1" }, { product: "trex-select", color: "pebble-grey" }));
  check("a bench's board: that bench alone", pb.extras.builtIns?.[0].finish?.product === "trex-select" && pb.extras.builtIns?.[1].finish === undefined && pb.stairs[0].finish === undefined, pb.extras.builtIns);
  const o = tryChoice(d, { patch: finishPatch(d, { kind: "built-in", id: "b1" }, { product: "ipe-54", color: "" }) });
  check("tried first: what it does to the price is known before it is picked", o.delta > 0 && !o.nothing, { delta: o.delta });
  const colourOnly = tryChoice(d, { patch: finishPatch(d, { kind: "stair", id: "s1" }, { product: d.decking.product, color: finishColors(d.decking.product)[0]?.id ?? "" }) });
  check("another colour of the deck's own line costs about the same", Math.abs(colourOnly.delta) < 1, colourOnly.delta);
  const shown = partCard(buildStructure(after), { kind: "stair", id: "s1" });
  check("the card after: its board now", shown.finish?.now?.color === "saddle");
  check("the catalog's colour names are what the card says", finishColors("trex-select").find((c) => c.id === "saddle")?.name === "Saddle" && deckingProduct("trex-select").label === "Trex Select");
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
