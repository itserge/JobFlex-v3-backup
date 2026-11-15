// THE JOINTS OF SPLICED ROWS, STAGGERED (2026-11-15; lib/deck/surface staggerRows) — the owner, of a 24-ft deck in the
// 3D: "there is a line on the floor… ten rows in a straight line, which is wrong, should be staggered."
// A row longer than the longest board is spliced. Every second row used to be turned end for end "so the joints
// stagger" — but the cheapest way to buy a 24-ft row is two 12s, and two 12s turned are two 12s: every row broke on one
// line down the middle of the deck. Now the rows take every cheapest way of buying the row in turn, in an order that
// keeps a row's joints away from the joints of the row before; the same feet of board are bought.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-board-joints.check.ts
import { defaultDeckDesign, normalizeDeckDesign } from "@/lib/deck/design";
import { buildDeckFrame } from "@/lib/deck/frame";
import { deckSurface, planRow, staggerRows, JOINT_STAGGER_IN } from "@/lib/deck/surface";
import { buildStructure } from "@/lib/deck/structure";
import { priceDeck } from "@/lib/deck/pricing";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
const feet = (buy: Map<number, number>) => [...buy].reduce((a, [st, n]) => a + st * n, 0);
const jointsOf = (cuts: readonly number[]) => {
  const at: number[] = [];
  let x = 0;
  for (const c of cuts.slice(0, -1)) at.push((x += c));
  return at;
};
/** The least distance between the joints of any two rows side by side, in. */
const apart = (rows: number[][]) => {
  let least = Infinity;
  for (let i = 1; i < rows.length; i++) for (const a of jointsOf(rows[i])) for (const b of jointsOf(rows[i - 1])) least = Math.min(least, Math.abs(a - b));
  return least;
};
/** The most rows that break on any one line. */
const onOneLine = (rows: number[][]) => {
  const n = new Map<number, number>();
  for (const r of rows) for (const j of jointsOf(r)) n.set(Math.round(j), (n.get(Math.round(j)) ?? 0) + 1);
  return Math.max(0, ...n.values());
};
const STOCK = [12, 16, 20] as const;

/* ── 1. The rows of a deck wider than the longest board ─────────────────── */
{
  const one = planRow(288, 30, STOCK);
  const lay = staggerRows(288, 30, STOCK);
  check("a 24-ft row was two 12s in every row: 30 rows broke on one line", one.cuts.join() === "144,144" && onOneLine(new Array<number[]>(30).fill(one.cuts)) === 30);
  check("now the rows take 12 + 12, 16 + 8, 20 + 4 and those turned end for end, in turn: five lines of joints, six rows on each", lay.lines === 5 && onOneLine(lay.cuts) === 6, [lay.lines, onOneLine(lay.cuts)]);
  check("…no two rows side by side break within 32 in. of each other (here: 4 ft or more)", apart(lay.cuts) >= JOINT_STAGGER_IN && apart(lay.cuts) >= 48, apart(lay.cuts));
  check("…every row is the deck's length, every piece a board's length or less, every joint on a joist's line (a multiple of 4 ft)", lay.cuts.every((r) => r.reduce((a, c) => a + c, 0) === 288 && r.every((c) => c <= 240 && c % 48 === 0)));
  check("…the same feet of board bought — as 12s, 16s and 20s now", feet(lay.buy) === feet(one.buy) && feet(one.buy) === 720 && [...lay.buy.keys()].sort((a, b) => a - b).join() === "12,16,20", [...lay.buy]);
}
for (const [ft, rows] of [[22, 30], [26, 24], [28, 28], [32, 31], [36, 20], [44, 26]] as const) {
  const one = planRow(ft * 12, rows, STOCK);
  const lay = staggerRows(ft * 12, rows, STOCK);
  check(`a ${ft}-ft deck, ${rows} rows: no two rows side by side break within 32 in.; no line takes more than half the rows; no more than 3% more lumber`, apart(lay.cuts) >= JOINT_STAGGER_IN && onOneLine(lay.cuts) <= Math.ceil(rows / 2) && feet(lay.buy) <= feet(one.buy) * 1.03 + 0.01 && lay.cuts.every((r) => Math.abs(r.reduce((a, c) => a + c, 0) - ft * 12) < 0.01 && r.every((c) => c <= 240.01 && c >= 12)), { apart: apart(lay.cuts), line: onOneLine(lay.cuts), bought: [feet(lay.buy), feet(one.buy)] });
}

/* ── 2. Where there is only one way to buy the row ──────────────────────── */
{
  const lay = staggerRows(480, 30, [20]);
  check("a line sold in 20-footers only, a 40-ft deck: every second row has a board cut in two, a part at each end — the same 60 boards", lay.cuts[0].join() === "240,240" && lay.cuts[1].length === 3 && lay.cuts[1].reduce((a, c) => a + c, 0) === 480 && feet(lay.buy) === 1200 && apart(lay.cuts) >= 48, lay.cuts.slice(0, 3));
  const short = staggerRows(200, 30, [12, 16]);
  check("a row a little longer than the longest board (16 ft 8 in.): a 12 and a cut, turned end for end row by row — two lines, 7 ft apart", short.lines === 2 && apart(short.cuts) >= 80 && feet(short.buy) === feet(planRow(200, 30, [12, 16]).buy), [short.lines, apart(short.cuts)]);
}

/* ── 3. A row that needs no splice ──────────────────────────────────────── */
{
  const lay = staggerRows(192, 26, STOCK);
  check("a 16-ft row is one 16-ft board, as before: nothing to stagger, the same boards bought", lay.lines === 0 && lay.cuts.every((r) => r.join() === "192") && JSON.stringify([...lay.buy]) === JSON.stringify([...planRow(192, 26, STOCK).buy]));
  check("one row alone is laid the cheapest way", staggerRows(288, 1, STOCK).cuts[0].join() === "144,144");
}

/* ── 4. On a deck ───────────────────────────────────────────────────────── */
{
  const d0 = defaultDeckDesign({ state: "WA" });
  const mk = (w: number, dp: number, more: Record<string, unknown> = {}) => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: w, depthFt: dp }, ...more });
  const rowsOf = (sf: ReturnType<typeof deckSurface>) => {
    const by = new Map<number, Array<{ x0: number; x1: number }>>();
    for (const p of sf.pieces) {
      const y = Math.round(p.cy * 100) / 100;
      by.set(y, [...(by.get(y) ?? []), { x0: p.cx - p.sx / 2, x1: p.cx + p.sx / 2 }]);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, ps]) => ps.sort((a, b) => a.x0 - b.x0).map((q) => q.x1 - q.x0));
  };
  const wide = deckSurface(buildDeckFrame(mk(24, 14)));
  const rows = rowsOf(wide);
  check("a 24 × 14 ft deck: every row covers the deck's width, and no line of joints runs across the floor", rows.length === wide.rows && rows.every((r) => Math.abs(r.reduce((a, c) => a + c, 0) - 288) < 0.01) && apart(rows) >= JOINT_STAGGER_IN && onOneLine(rows) <= Math.ceil(rows.length / 4), { rows: rows.length, apart: apart(rows), line: onOneLine(rows) });
  const narrow = deckSurface(buildDeckFrame(mk(16, 12)));
  check("a 16-ft deck has no joints at all: one board a row, as before", rowsOf(narrow).every((r) => r.length === 1));
  const L = deckSurface(buildDeckFrame(mk(28, 16, { shape: { kind: "l", widthFt: 28, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } })));
  const lRows = rowsOf(L);
  check("an L-shaped deck: its long rows and its short rows each staggered among themselves", lRows.length > 10 && apart(lRows.filter((r) => r.length > 1)) >= 24, { apart: apart(lRows.filter((r) => r.length > 1)) });
  const before = 26 * 24 * 1; // (rows × ft, for the record: the price is by the foot bought.)
  void before;
  const pkg = priceDeck(mk(24, 14));
  check("…and it is priced: the boards' line is there, by the boards bought", pkg.lines.some((l) => /deck-boards|decking/.test(l.id)) && wide.boughtLf >= wide.netLf, pkg.lines.map((l) => l.id).slice(0, 6));
  check("breaker boards still take the joints away altogether (every row stops against them)", (() => { const b = buildStructure(mk(24, 14, { decking: { ...d0.decking, breakers: 1 } })).surface; return !!b && b.breakers.length === 1 && rowsOf(b).every((r) => r.every((c) => c <= 240)); })());
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
