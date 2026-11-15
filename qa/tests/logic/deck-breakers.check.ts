// BREAKER BOARDS (2026-11-14; lib/deck/surface, design.decking.breakers) — another of the luxury options the owner
// asked for. A board laid ACROSS the field, out from the house, in the border's colour: every row of the field stops
// against it, so a deck wider than the longest board has no butt joints and the floor reads as panels. One in the
// middle of the field, two at its thirds; the whole depth of the field where it stands, between the border's boards
// where there is a border; moved off a place that would leave a stub; not laid where it does not fit — and that is
// said. Bought, drawn, framed under (a joist under each row of board ends, blocking between), said in the checks,
// asked for by voice. A deck without one is exactly as it was.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-breakers.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { deckingColors } from "../../../src/lib/deck/deckingColors";
import { AUTO_FIX } from "../../../src/lib/deck/settle";
import { permitPages } from "../../../src/lib/deck/permit";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (over: Record<string, unknown> = {}, decking: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 28, depthFt: 14 }, heightIn: 36, ...over, decking: { ...d0.decking, ...decking } });
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
const surf = (d: DeckDesign) => buildStructure(d).surface!;
/** Does a field board's piece lie across a breaker's strip? */
const across = (sf: ReturnType<typeof surf>) => sf.pieces.filter((p) => !p.border).some((p) => sf.breakers.some((b) => p.cx - p.sx / 2 < b.x + sf.product.widthIn / 2 - 0.01 && p.cx + p.sx / 2 > b.x - sf.product.widthIn / 2 + 0.01 && p.cy > b.y0 && p.cy < b.y1));

/* ── 1. The design ───────────────────────────────────────────────────── */
check("a new deck has none", d0.decking.breakers === undefined && surf(mk()).breakers.length === 0 && surf(mk()).breakerLf === 0);
check("one or two are read back; anything else is not", mk({}, { breakers: 1 }).decking.breakers === 1 && mk({}, { breakers: 2 }).decking.breakers === 2 && mk({}, { breakers: 3 }).decking.breakers === undefined && mk({}, { breakers: "x" }).decking.breakers === undefined);
check("they go with boards laid straight: on a diagonal or a herringbone they are not kept", mk({}, { breakers: 1, pattern: "diagonal", diagonal: true }).decking.breakers === undefined && mk({}, { breakers: 2, pattern: "herringbone", diagonal: true }).decking.breakers === undefined);

/* ── 2. One, on a deck wider than the longest board ──────────────────── */
const plain = surf(mk());
const one = surf(mk({}, { breakers: 1 }));
const W = one.product.widthIn;
check("28 ft wide with none: every row is spliced (longer than a 20-ft board)", plain.longestRowIn === 336 && plain.longestRowIn > Math.max(...plain.product.lengthsFt) * 12);
check("one breaker: in the middle of the field, from ¼ in. off the wall to the front edge", one.breakers.length === 1 && one.breakers[0].x === 168 && near(one.breakers[0].y0, 0.25) && near(one.breakers[0].y1, 168) && near(one.breakerLf, 14, 0.05));
const bp = one.pieces.filter((p) => p.breaker);
check("it is a board of its own, laid out from the house", bp.length === 1 && bp[0].border === true && near(bp[0].yaw ?? 0, Math.PI / 2) && near(bp[0].sx, 167.75) && bp[0].sy === W && near(bp[0].cx, 168));
check("every row stops against it: no field board lies across it, the maker's gap either side", !across(one) && one.pieces.filter((p) => !p.border).every((p) => p.cx + p.sx / 2 <= 168 - W / 2 - one.product.gapIn + 0.01 || p.cx - p.sx / 2 >= 168 + W / 2 + one.product.gapIn - 0.01));
check("…so the longest board in a row is under 14 ft and no row has a butt joint: two boards a row", near(one.longestRowIn, 168 - W / 2 - one.product.gapIn, 0.05) && one.pieces.filter((p) => !p.border).length === 2 * one.rows, `${one.longestRowIn} · ${one.pieces.filter((p) => !p.border).length} pieces in ${one.rows} rows`);
check("the same rows, the same deck: the field's area is the deck's less the breaker's strip", one.rows === plain.rows && near(one.netLf, plain.netLf - ((W + 2 * one.product.gapIn) * one.rows) / 12 + one.breakerLf, 0.6), `${one.netLf} vs ${plain.netLf}`);
check("three lengths go under it: a joist under each row of board ends and one cut into blocks", one.breakerBackingIn.length === 3 && one.breakerBackingIn.every((v) => v === 168));

/* ── 3. Two; with a border; a deck that stands free ──────────────────── */
const two = surf(mk({}, { breakers: 2, border: 1 }));
const pitch = W + two.product.gapIn;
check("two breakers stand at the thirds of the field, inside the border", two.breakers.length === 2 && near(two.breakers[0].x, pitch + (336 - 2 * pitch) / 3, 0.6) && near(two.breakers[1].x, pitch + (2 * (336 - 2 * pitch)) / 3, 0.6) && !across(two));
check("…each runs to the border's inner edge, not across its boards", two.breakers.every((b) => near(b.y0, 0.25) && near(b.y1, 168 - pitch, 0.05)) && two.breakerBackingIn.length === 6);
const free = surf(mk({ placement: "detached" }, { breakers: 1, border: 1 }));
check("a free-standing deck: between the back border and the front one", free.breakers.length === 1 && near(free.breakers[0].y0, pitch, 0.05) && near(free.breakers[0].y1, 168 - pitch, 0.05));

/* ── 4. How it is bought ─────────────────────────────────────────────── */
const lfOf = (st: Array<{ lengthFt: number; count: number }>) => st.reduce((a, q) => a + q.lengthFt * q.count, 0);
check("in the deck's own colour it comes from the field's stock: nothing ordered apart", one.borderStock.length === 0 && lfOf(one.stock) >= one.netLf);
const colours = deckingColors("trex-transcend-lineage");
const twoTone = surf(mk({}, { product: "trex-transcend-lineage", color: colours[0]?.id, border: 1, borderColor: colours[1]?.id, breakers: 1 }));
const twoToneNo = surf(mk({}, { product: "trex-transcend-lineage", color: colours[0]?.id, border: 1, borderColor: colours[1]?.id }));
check("with a border in a second colour it is in that colour, and in that colour's own order", !!twoTone.product.border && twoTone.breakers.length === 1 && lfOf(twoTone.borderStock) > lfOf(twoToneNo.borderStock), `${lfOf(twoTone.borderStock)} vs ${lfOf(twoToneNo.borderStock)}`);
const pOne = priceDeck(mk({}, { breakers: 1 }));
const backing = pOne.takeoff.lines.find((l) => /breaker-backing/.test(l.id));
check("the list has the framing under it, in the joists' own size", !!backing && backing.step === "framing" && backing.qty === 3 && new RegExp(pOne.structure.frame!.joistSize).test(backing.label), backing ? `${backing.label} ${backing.qty}` : "none");
check("no line of its own in the price: it is decking and framing", !pOne.lines.some((l) => /breaker/.test(l.id)) && pOne.subtotal !== priceDeck(mk()).subtotal);

/* ── 5. Where it goes, and where it does not ─────────────────────────── */
const wide = buildStructure(mk({ shape: { kind: "rect", widthFt: 44, depthFt: 14 } }, { breakers: 1 }));
const wideCheck = deckChecks(wide).find((c) => c.id === "decking-breaker");
check("44 ft wide with one: the rows are still longer than a board — said, with the way out", wide.surface!.longestRowIn > 240 && /still longer than a 20-ft board/.test(wideCheck?.text ?? "") && wideCheck?.fix?.label === "Two breaker boards");
const widened = buildStructure(applyDeckPatch(wide.design, wideCheck!.fix!.patch));
check("…two of them: every row one board", widened.surface!.breakers.length === 2 && widened.surface!.longestRowIn <= 240 && /no row has a butt joint/.test(deckChecks(widened).find((c) => c.id === "decking-breaker")?.text ?? ""));
const ell = surf(mk({ shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } }, { breakers: 1, border: 1 }));
check("an L: moved off the place that would leave a stub beside the inside corner — every board beside it 2 ft or more", ell.breakers.length === 1 && ell.breakers[0].x !== Math.round(pitch + (288 - 2 * pitch) / 2) && !across(ell) && ell.field.every((c) => c.x1 - c.x0 >= 24 - 0.01), `${ell.breakers[0]?.x} ${JSON.stringify(ell.field.map((c) => [Math.round(c.x0), Math.round(c.x1)]))}`);
check("…the whole depth of the deck where it stands", ell.breakers[0].y1 > 16 * 12 - 2 * pitch);
const narrowD = mk({ shape: { kind: "rect", widthFt: 4, depthFt: 10 } }, { breakers: 2 });
const narrow = buildStructure(narrowD);
const noneCheck = deckChecks(narrow).find((c) => c.id === "decking-breaker-none");
check("a deck too narrow for one: not laid, said, with the way out", narrow.surface!.breakers.length === 0 && narrow.surface!.breakersLeftOut === 2 && noneCheck?.level === "warn" && !!noneCheck.fix && applyDeckPatch(narrowD, noneCheck.fix.patch).decking.breakers === undefined && near(priceDeck(narrowD).subtotal, priceDeck(mk({ shape: { kind: "rect", widthFt: 4, depthFt: 10 } })).subtotal, 0.001));
const sixFt = buildStructure(mk({ shape: { kind: "rect", widthFt: 6, depthFt: 10 } }, { breakers: 2 }));
check("6 ft wide with two asked: one fits (2 ft of board either side), the other is left out — and that is said", sixFt.surface!.breakers.length === 1 && sixFt.surface!.breakersLeftOut === 1 && /One of the two asked for is left out/.test(deckChecks(sixFt).find((c) => c.id === "decking-breaker")?.text ?? ""));
const bowed = buildStructure(mk({ shape: { kind: "rect", widthFt: 24, depthFt: 14, front: { kind: "curve", bulgeFt: 2, clipFt: 2 } } }, { breakers: 1 }));
check("under a bowed front: not laid, and why", bowed.surface!.breakers.length === 0 && /bowed or clipped front/.test(deckChecks(bowed).find((c) => c.id === "decking-breaker-none")?.text ?? ""));
const oneS = buildStructure(mk({}, { breakers: 1 }));
const ck = deckChecks(oneS).find((c) => c.id === "decking-breaker");
check("the check says what it does and what goes under it", ck?.level === "pass" && /across the middle of the field/.test(ck.text) && /no row has a butt joint/.test(ck.text) && /joist under each row of board ends/.test(ck.text) && /42 ft of/.test(ck.text), ck?.text ?? "");
check("its checks are the builder's own (clear of the auto-fix)", !AUTO_FIX.test("decking-breaker") && !AUTO_FIX.test("decking-breaker-none"));
check("the same checks otherwise", deckChecks(oneS).filter((c) => !c.id.startsWith("decking-breaker")).map((c) => `${c.id}:${c.level}`).join() === deckChecks(buildStructure(mk())).map((c) => `${c.id}:${c.level}`).join());

/* ── 6. The 3D, the plans ────────────────────────────────────────────── */
const sc = deckScene(oneS);
const sc0 = deckScene(buildStructure(mk()));
const drawn = sc.boxes.filter((_, i) => sc.legend[sc.tags[i]]?.role === "breaker board");
check("the 3D draws it, a shade deeper than the field so it reads", drawn.length === 1 && !!sc.colors.border && sc.colors.border !== sc.colors.decking && !sc0.colors.border);
let pages = 0;
let threw = "";
try {
  pages = permitPages(pOne, { address: "1 Test St", contractor: "QA" } as never).length;
} catch (e) {
  threw = String(e);
}
check("the permit set draws", pages > 4 && !threw, threw);

/* ── 7. By voice ─────────────────────────────────────────────────────── */
const say = (d: DeckDesign, text: string) => {
  let o = d;
  const said: string[] = [];
  let refused = false;
  for (const cmd of parseUtterance(text, { design: d } as never).clauses.flatMap((c) => c.cmds)) {
    const r = runCommand(o, cmd);
    o = r.design;
    said.push(...r.said);
    refused = refused || !!r.refused;
  }
  return { design: o, said: said.join(" "), refused };
};
const v1 = say(mk(), "add a breaker board");
check("\"add a breaker board\": one across the middle, said as laid", v1.design.decking.breakers === 1 && v1.design.decking.border === 0 && /breaker board across the middle/.test(v1.said) && /no row has a butt joint/.test(v1.said), v1.said);
check("\"two breaker boards\"", say(mk(), "two breaker boards").design.decking.breakers === 2);
check("\"no breaker boards\" takes them off", say(v1.design, "no breaker boards").design.decking.breakers === undefined);
const v2 = say(mk({}, { pattern: "diagonal", diagonal: true }), "add a breaker board");
check("asked for on diagonal boards: the boards go straight for it, and that is said", v2.design.decking.breakers === 1 && v2.design.decking.pattern === "straight" && /laid straight/.test(v2.said), v2.said);
check("a picture-frame border is still a border", say(mk(), "add a picture frame border").design.decking.border === 1 && say(mk(), "add a picture frame border").design.decking.breakers === undefined);
const v3 = say(narrowD, "add a breaker board");
check("on a deck too narrow for one: not added, and why", v3.refused && /does not fit/.test(v3.said), v3.said);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
