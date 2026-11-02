// The target lookup (2026-10-30, lib/onboarding/targets), shared by the first-estimate tour and SmartHelp's Show me:
// which `data-tour` element is THE one to light, and the frame drawn round it. Pure: a fake page, no browser.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/onboarding-targets.check.ts
import { firstVisibleTarget, frameOf } from "../../../src/lib/onboarding/targets";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// A 1440×900 screen. frameOf reads the window; firstVisibleTarget reads the document's own.
const SCREEN = { innerWidth: 1440, innerHeight: 900 };
Object.assign(globalThis, { window: SCREEN });

/** What getBoundingClientRect returns for a box at (left, top). */
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── frameOf: 6px outside the element, held 4px inside the screen, none when under 8px of it is on screen ──
const box = frameOf(rect(100, 200, 300, 40));
const boxOk = same(box, { top: 194, left: 94, width: 312, height: 52 });
check("a normal rect → its box, 6px outside it", boxOk, boxOk ? "" : JSON.stringify(box));
check("zero-size (an element with no box: display none, taken off the page) → none", frameOf(rect(0, 0, 0, 0)) === null);
check("off screen above → none", frameOf(rect(100, -200, 300, 100)) === null);
check("off screen below → none", frameOf(rect(100, 950, 300, 40)) === null);
check("off screen to the left or right → none", frameOf(rect(-400, 100, 300, 40)) === null && frameOf(rect(1500, 100, 300, 40)) === null);
check("scrolled just past the top edge (its foot at 0) → none", frameOf(rect(100, -40, 300, 40)) === null);
check("half on screen → cut 4px inside the edge", same(frameOf(rect(100, -20, 300, 60)), { top: 4, left: 94, width: 312, height: 42 }));
check("bigger than the screen → the screen less 4px a side", same(frameOf(rect(-50, -50, 2000, 2000)), { top: 4, left: 4, width: 1432, height: 892 }));
// The tour's frame as it was (onboarding-tour's `framed`): a box collapsed to a point where it stood keeps the 6px pad.
check("a box collapsed where it stood (the tour's frame, unchanged) → the 12px square round the point", same(frameOf(rect(300, 300, 0, 0)), { top: 294, left: 294, width: 12, height: 12 }));

// ── firstVisibleTarget: the first name with an element drawn and on screen sideways; on screen beats below the fold ──
type Spec = { name: string; at: [number, number, number, number]; noBox?: boolean; inHidden?: boolean; inAriaHidden?: boolean; invisible?: boolean };
const el = (s: Spec) =>
  ({
    id: `${s.name}@${s.at.join(",")}`,
    getClientRects: () => ({ length: s.noBox ? 0 : 1 }),
    closest: (sel: string) => ((sel === '[aria-hidden="true"]' ? s.inAriaHidden : s.inHidden) ? {} : null),
    checkVisibility: () => !s.invisible,
    getBoundingClientRect: () => rect(...s.at),
    dataset: { tour: s.name },
  }) as unknown as HTMLElement;
/** A page holding `list` in document order; `[data-tour="x"]` finds x's. */
const page = (list: HTMLElement[], view: typeof SCREEN | null = SCREEN) =>
  ({ defaultView: view, querySelectorAll: (sel: string) => list.filter((e) => sel === `[data-tour="${e.dataset.tour}"]`) }) as unknown as Document;
const idOf = (e: HTMLElement | null) => (e ? (e as unknown as { id: string }).id : "none");

const skipped = [
  el({ name: "a", at: [10, 10, 100, 30], noBox: true }), // display:none — no box
  el({ name: "a", at: [10, 50, 100, 30], inHidden: true }), // inside [hidden] / .is-hidden
  el({ name: "a", at: [10, 90, 100, 30], inAriaHidden: true }), // inside aria-hidden="true"
  el({ name: "a", at: [10, 130, 100, 30], invisible: true }), // visibility / opacity: a closed drawer that keeps its box
  el({ name: "a", at: [-300, 170, 280, 30] }), // off the left edge (a closed drawer's link)
  el({ name: "a", at: [1440, 210, 100, 30] }), // off the right edge
  el({ name: "a", at: [10, 250, 0, 30] }), // no width
];
check("nothing drawn and on screen sideways → none", firstVisibleTarget(["a"], page(skipped)) === null);
const below = el({ name: "b", at: [10, 1400, 100, 30] });
const onScreen = el({ name: "b", at: [10, 400, 100, 30] });
check("of two of the same, the one on screen", idOf(firstVisibleTarget(["b"], page([below, onScreen]))) === idOf(onScreen));
check("none on screen → the first in the document", idOf(firstVisibleTarget(["b"], page([below, el({ name: "b", at: [10, -900, 100, 30] })]))) === idOf(below));
const later = el({ name: "c", at: [10, 300, 100, 30] });
check("the names in order: the first name found wins, on screen or not", idOf(firstVisibleTarget(["a", "b", "c"], page([...skipped, below, later]))) === idOf(below));
check("a name with nothing drawn passes to the next", idOf(firstVisibleTarget(["a", "c"], page([...skipped, later]))) === idOf(later));
check("a document with no window (parsed, never displayed) → none", firstVisibleTarget(["c"], page([later], null)) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
