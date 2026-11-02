"use client";
// SMARTHELP · SHOW ME (2026-10-30) — lights the button or field a guide's step names, with the tour's target lookup
// (lib/onboarding/targets), not a second one. The panel goes to the step's page with the app router and calls
// showMe(target, label); <SmartHelpSpotlight /> (mounted once, beside the panel) then looks for `data-tour="<target>"`
// every 250ms for up to 8 seconds.
//   Found → scrolled to the middle of the screen and framed: a 2px accent frame with a hard 4px ink shadow, nothing
//   dimmed (the person is following steps on that page), repainted as the page scrolls or resizes. The light goes out
//   when the person clicks inside the element, presses Esc, leaves the page, or after 15 seconds.
//   Not found (a role, a plan, a changed page) → the event `jf:smarthelp-miss` carries the label, and the panel says
//   "Look for <label> on this page".
// A page change during the 8-second search is the Show me's own trip to its page: the search starts again there
// instead of ending (a sidebar link is on every page, so it could be lit on the page being left). A trip that is a
// fresh load (the same page with another ?query — the panel decides) waits in this tab for the next page:
// showMeAfterLoad.
// Module scope, like the shell's other stores: showMe can run before the spotlight has drawn.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { firstVisibleTarget, frameOf, type FrameBox } from "@/lib/onboarding/targets";
import styles from "./spotlight.module.css";

export const SHOW_EVENT = "jf:smarthelp-show";
export const MISS_EVENT = "jf:smarthelp-miss";

const POLL_MS = 250;
const SEARCH_MS = 8_000;
const LIT_MS = 15_000;

type Request = { target: string; label: string; at: number };

let pending: Request | null = null;

/** A Show me whose trip to its page is a fresh load waits in this tab for the new page (showMeAfterLoad): picked up
 *  within KEPT_MS, with a fresh 8-second search from there. */
const KEPT_KEY = "smarthelp:show";
const KEPT_MS = 20_000;

function kept(): Request | null {
  try {
    const raw = window.sessionStorage.getItem(KEPT_KEY);
    window.sessionStorage.removeItem(KEPT_KEY);
    const r = raw ? (JSON.parse(raw) as Partial<Request>) : null;
    if (!r || typeof r.target !== "string" || typeof r.label !== "string" || typeof r.at !== "number") return null;
    return Date.now() - r.at < KEPT_MS ? { target: r.target, label: r.label, at: Date.now() } : null;
  } catch {
    return null;
  }
}

/** Light `target` (a `data-tour` name) once it is on the page; `label` is the words the panel shows if it never is. */
export function showMe(target: string, label: string): void {
  pending = { target, label, at: Date.now() };
  window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { target, label } }));
}

/** The same, for a trip to the page that is a fresh load (the page is about to go): the next page lights it. */
export function showMeAfterLoad(target: string, label: string): void {
  try {
    window.sessionStorage.setItem(KEPT_KEY, JSON.stringify({ target, label, at: Date.now() } satisfies Request));
  } catch {
    /* storage blocked: the step still names the button */
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SmartHelpSpotlight() {
  const pathname = usePathname() ?? "";
  const [request, setRequest] = useState<Request | null>(null);
  // The element found and the page it was found on: it is lit only while that page is the one showing.
  const [lit, setLit] = useState<{ el: HTMLElement; path: string } | null>(null);
  const [frame, setFrame] = useState<FrameBox | null>(null);
  const shown = lit && lit.path === pathname ? lit.el : null;

  const clear = useCallback(() => {
    pending = null;
    setRequest(null);
    setLit(null);
    setFrame(null);
  }, []);

  // A request made before this mounted — on this page, or on the one before a fresh load — then every new one.
  useEffect(() => {
    const take = () => {
      pending ??= kept();
      if (!pending) return;
      setLit(null);
      setFrame(null);
      setRequest({ ...pending });
    };
    take();
    window.addEventListener(SHOW_EVENT, take);
    return () => window.removeEventListener(SHOW_EVENT, take);
  }, []);

  // The search: every 250ms until found or 8 seconds from the showMe. Lit on a page since left: while the search is
  // young that was Show me's own trip, so look again on this page; after it, leaving the page put the light out.
  useEffect(() => {
    if (!request || shown) return;
    if (lit && Date.now() - request.at >= SEARCH_MS) {
      // Out for good, so coming back to the page (the sidebar keeps its element) doesn't light it again.
      const out = window.setTimeout(clear, 0);
      return () => window.clearTimeout(out);
    }
    let timer = 0;
    const look = () => {
      const el = firstVisibleTarget([request.target]);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        setLit({ el, path: window.location.pathname });
        return;
      }
      if (Date.now() - request.at >= SEARCH_MS) {
        window.dispatchEvent(new CustomEvent(MISS_EVENT, { detail: { label: request.label } }));
        clear();
        return;
      }
      timer = window.setTimeout(look, POLL_MS);
    };
    look();
    return () => window.clearTimeout(timer);
  }, [request, lit, shown, clear]);

  // While lit: the frame follows the element; a click inside it, Esc, or 15 seconds put it out.
  useEffect(() => {
    if (!shown) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (!shown.isConnected) return clear();
      setFrame(frameOf(shown.getBoundingClientRect()));
    };
    const repaint = () => {
      if (!raf) raf = window.requestAnimationFrame(paint);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && shown.contains(e.target)) clear();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    paint();
    const out = window.setTimeout(clear, LIT_MS);
    window.addEventListener("scroll", repaint, { capture: true, passive: true });
    window.addEventListener("resize", repaint);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.clearTimeout(out);
      window.removeEventListener("scroll", repaint, { capture: true });
      window.removeEventListener("resize", repaint);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown, clear]);

  if (!shown || !frame) return null;
  return createPortal(
    <div className={styles.frame} style={frame} data-smarthelp-spotlight={request?.target} aria-hidden="true" />,
    document.body,
  );
}
