// THE TARGET LOOKUP (2026-10-30) — shared by the first-estimate tour
// (components/v3/onboarding-tour) and SmartHelp's Show me
// (components/v3/smarthelp/spotlight): which `data-tour` element on the page
// is THE one to light, and the frame drawn round it. Moved here from the tour
// as it was. It reads the live page, so it runs in the browser; it imports
// nothing from the server. qa/tests/logic/onboarding-targets.check.ts holds it.

import { isShown } from "./tour-paths";

/** The frame round a lit element, in screen pixels. */
export type FrameBox = { top: number; left: number; width: number; height: number };

/** How far the frame stands outside the element. */
const FRAME_PAD = 6;

/**
 * The first of `names` with an element on the page and on screen sideways (a
 * closed drawer's link sits off the left edge): drawn, not under
 * `aria-hidden`, not made invisible, with a width. Of two of the same, the one
 * on screen; else the first in the document.
 */
export function firstVisibleTarget(names: string[], doc: Document = document): HTMLElement | null {
  const view = doc.defaultView;
  // A document no window shows (parsed, never displayed) has nothing on screen.
  if (!view) return null;
  for (const name of names) {
    let first: HTMLElement | null = null;
    for (const el of doc.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      if (!isShown(el) || el.closest('[aria-hidden="true"]')) continue;
      // A closed drawer that is only made invisible (visibility, opacity) still has a box.
      if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.right <= 0 || r.left >= view.innerWidth) continue;
      // Two of the same (HVAC's Convert in the summary and under the lines): the one on screen.
      if (r.bottom > 0 && r.top < view.innerHeight) return el;
      first ??= el;
    }
    if (first) return first;
  }
  return null;
}

/**
 * The frame round an element's box (its getBoundingClientRect): 6px outside
 * it, held 4px inside the screen's edges; null when less than 8px of it is on
 * screen (no box at all, or scrolled away).
 */
export function frameOf(r: DOMRect): FrameBox | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.max(r.top - FRAME_PAD, 4);
  const left = Math.max(r.left - FRAME_PAD, 4);
  const bottom = Math.min(r.bottom + FRAME_PAD, vh - 4);
  const right = Math.min(r.right + FRAME_PAD, vw - 4);
  if (bottom - top < 8 || right - left < 8) return null;
  return { top, left, width: right - left, height: bottom - top };
}
