"use client";

// THE FIRST-ESTIMATE TOUR (2026-10-26). Mounted once by the dashboard layout,
// outside the responsive shell, so the desk and the handheld trees both carry
// it; everything it draws is portalled to <body>.
//
//   · The welcome card — "Create your first roof estimate", Start / Not now —
//     for a new company with no estimate (lib/onboarding/progress decides).
//   · The run: one step at a time, the step's element lit (a dimmed page with a
//     Blueprint frame round the element) and a card docked bottom-right on the
//     desk, across the foot on a phone; the element is scrolled clear of the
//     card, never the card moved off it. A step passes when the page shows it was done
//     (lib/onboarding/tour-paths), checked on a short tick and on every click,
//     change or keystroke inside the lit element.
//   · Away and back: leaving the step's page keeps the step; coming back asks
//     "Pick up where you left off?". Not now / Escape / ✕ pause the tour and
//     the sidebar keeps a chip that resumes it.
//   · After the Send screen: "Next steps · 1/3" behind the same chip.
//
// No library. The frame's position comes from getBoundingClientRect, written
// straight to its style on every scroll and resize so it moves 1:1 with the
// page; a ResizeObserver and a slow tick keep the rest fresh. The dim never
// takes a click, so the page works exactly as it does without the tour.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { saveTourProgress, type TourWrite } from "@/actions/onboarding";
import {
  NEXT_STEPS,
  TOUR_PATHS,
  isShown,
  tourCount,
  tourTitle,
  type TourPathId,
  type TourStep,
} from "@/lib/onboarding/tour-paths";
import type { TourView } from "@/lib/onboarding/progress";
import { firstVisibleTarget, frameOf } from "@/lib/onboarding/targets";
import { HANDHELD, useIsHandheld } from "@/components/v3/responsive-shell/use-handheld";
import { publishTour } from "./tour-store";
import styles from "./onboarding-tour.module.css";

type Mode = "welcome" | "resume" | "run" | "idle";
type Box = { top: number; left: number; width: number; height: number };

const TICK_MS = 350;
/** A conditional step whose element has not appeared by then is not this page's. */
const WHEN_GRACE_MS = 2000;
/** The docked card's distance from the screen's edges: desk, phone. */
const DOCK_DESK = 24;
const DOCK_PHONE = 12;
/** Room kept clear of the shell's top bar when an element is scrolled to. */
const TOP_CLEAR = 72;
/** Nested scroll containers settle late: look again this long after a scroll. */
const RECHECK_MS = 350;
/** The frame glides between steps, never while the page scrolls. */
const SCROLL_QUIET_MS = 120;

const PATH_LINE: Record<TourPathId, string> = {
  roof: "Type an address and the roof is measured from the aerial — squares, pitch and a priced proposal in about two minutes.",
  fence: "Find the property, draw the fence on the map — footage, posts, gates and a priced proposal in about two minutes.",
  hvac: "Type an address — the house, the load, the unit that fits and a priced proposal in about two minutes.",
  smart: "Type the job the way you'd say it to a customer — the estimate writes itself in about two minutes.",
  deck: "Pick the structure, set the size and the boards — a 3D deck and a priced proposal in a few minutes.",
  manual: "Name the job, add the lines and save — your first proposal in a few minutes.",
};

const subscribeNever = () => () => {};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function onRoute(step: TourStep, pathname: string): boolean {
  return !step.route || pathname === step.route || pathname.startsWith(step.route + "/");
}

/** The step's element — the first of its targets on the page and on screen sideways (lib/onboarding/targets) —
 *  and the name it carries (the menu button has words of its own). */
function findTarget(step: TourStep): { el: HTMLElement; name: string } | null {
  const names = step.handheldTargets && window.matchMedia(HANDHELD).matches ? step.handheldTargets : step.targets;
  const el = firstVisibleTarget(names);
  return el ? { el, name: el.dataset.tour ?? "" } : null;
}

/** Another surface's modal is open (the estimator's question, the email panel, the plan-limit dialog): stand aside. */
function foreignModal(root: HTMLElement | null): boolean {
  for (const el of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) {
    if (root?.contains(el) || !isShown(el) || el.closest('[aria-hidden="true"]')) continue;
    // Mounted but parked (a closed sheet slid off the screen, a faded-out dialog) is not open.
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    return true;
  }
  return false;
}

/** A bar fixed to the screen (Save & send, a sticky total): scrolling cannot move it. Read up to
 *  the first scroll container only — the phone shell itself is a fixed box round a scrolling page. */
function pinned(el: HTMLElement): boolean {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.position === "fixed" || cs.position === "sticky") return true;
    if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) return false;
  }
  return false;
}

/** Where the step card sits when docked, from its size alone (never its live box, which may be lifted). */
function dockBox(handheld: boolean, w: number, h: number): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (handheld) return { top: vh - DOCK_PHONE - h, left: DOCK_PHONE, width: vw - DOCK_PHONE * 2, height: h };
  return { top: vh - DOCK_DESK - h, left: vw - DOCK_DESK - w, width: w, height: h };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

export function OnboardingTour({ view }: { view: TourView }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const handheld = useIsHandheld();
  const path = TOUR_PATHS[view.path];
  const steps = path.steps;
  const last = steps.length - 1;

  const [status, setStatus] = useState(view.status);
  const [step, setStep] = useState(view.step);
  const [mode, setMode] = useState<Mode>(() =>
    view.status === "offer" ? "welcome" : view.status === "active" ? (view.step === 0 ? "run" : "idle") : "idle",
  );
  const [next, setNext] = useState(view.next);
  const [nextOpen, setNextOpen] = useState(false);
  /** The next steps' "Show me": the Send screen's bar, lit on its own. */
  const [nextSpot, setNextSpot] = useState(false);
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [blocked, setBlocked] = useState(false);
  const [target, setTarget] = useState<{ el: HTMLElement; name: string } | null>(null);
  const [focusIn, setFocusIn] = useState(false);
  /** The card's bottom (px) when the lit element is a bar fixed under the docked card; else docked. */
  const [lift, setLift] = useState<number | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  /** The step card's last measured size (a hidden card measures 0 and is not counted). */
  const cardSizeRef = useRef({ w: 340, h: 200 });
  /** Left the step's page mid-run: coming back asks first. A reload mid-run counts as coming back. */
  const awayRef = useRef(view.status === "active" && view.step > 0);
  const interactedRef = useRef(false);
  const seenRef = useRef(false);
  const stepSinceRef = useRef(0);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const persist = useCallback(
    (op: TourWrite["op"], at: number, tour: TourWrite["tour"] = "first_estimate") => {
      void saveTourProgress({ tour, op, path: tour === "next_steps" ? "next" : view.path, step: at }).catch(() => false);
    },
    [view.path],
  );

  const goStep = useCallback(
    (to: number) => {
      const at = Math.min(to, last);
      interactedRef.current = false;
      seenRef.current = false;
      stepSinceRef.current = Date.now();
      setStep(at);
      // Reaching the Send screen is the goal: the proposal exists.
      persist(at >= last ? "complete" : "step", at);
    },
    [last, persist],
  );

  // ── Doors ──────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    persist("start", 0);
    awayRef.current = false;
    interactedRef.current = false;
    seenRef.current = false;
    stepSinceRef.current = Date.now();
    setStatus("active");
    setStep(0);
    setNextOpen(false);
    setMode("run");
  }, [persist]);

  const pause = useCallback(() => {
    awayRef.current = false;
    persist("pause", step);
    setStatus("paused");
    setMode("idle");
  }, [persist, step]);

  const skip = useCallback(() => {
    persist("skip", step);
    setStatus("skipped");
    setMode("idle");
  }, [persist, step]);

  const resume = useCallback(() => {
    if (status === "completed" || status === "skipped" || status === "none" || status === "offer") return start();
    if (status === "paused") persist(step === 0 ? "start" : "resume", step);
    awayRef.current = false;
    setStatus("active");
    setMode("run");
    const s = steps[step];
    if (s?.route && !onRoute(s, window.location.pathname)) router.push((s.route) as Route);
  }, [status, step, steps, persist, start, router]);

  const finish = useCallback(() => {
    // The Send screen closed: the tour is done; its next steps take the chip.
    setStatus("completed");
    setMode("idle");
    const draft = new URLSearchParams(window.location.search).get("proposal");
    setNext((n) => n ?? { status: "active", sent: false, draftId: draft });
  }, []);

  const hideNext = useCallback(() => {
    persist("skip", 0, "next_steps");
    setNext(null);
    setNextOpen(false);
  }, [persist]);

  const showMeSend = useCallback(() => {
    setNextOpen(false);
    stepSinceRef.current = Date.now();
    setNextSpot(true);
    const dest = next?.draftId ? `/dashboard/manual-blueprint?proposal=${next.draftId}` : "/dashboard/proposals";
    router.push(dest as Route);
  }, [next, router]);

  // ── The chip and the doors, for the sidebar and the Overview ──────────
  useEffect(() => {
    const live = status === "active" || status === "paused";
    if (live) {
      const c = tourCount(view.path, step);
      publishTour({ kind: "first", path: view.path, done: c.done, total: c.total, active: status === "active" }, { start, resume, openNext: () => setNextOpen(true) });
    } else if (status === "completed" && next) {
      publishTour({ kind: "next", done: next.sent ? 1 : 0, total: NEXT_STEPS.length }, { start, resume, openNext: () => setNextOpen(true) });
    } else {
      publishTour({ kind: "none" }, { start, resume, openNext: () => setNextOpen(true) });
    }
  }, [status, step, next, view.path, start, resume]);
  useEffect(() => () => publishTour({ kind: "none" }, null), []);

  // ── The tick: has the step been done, is its page open ─────────────────
  const runStep: TourStep | null = nextSpot ? steps[last] : status === "active" ? steps[step] ?? null : null;
  useEffect(() => {
    if (!runStep) return;
    let timer = 0;
    const tick = () => {
      const p = window.location.pathname;
      const s = runStep;
      if (!stepSinceRef.current) stepSinceRef.current = Date.now();
      setBlocked(foreignModal(rootRef.current));
      // In transit to the builder: the proposals/<id> page redirects there.
      if (/^\/dashboard\/proposals\/[^/]+$/.test(p)) return;
      const found = onRoute(s, p) ? findTarget(s) : null;
      if (found) seenRef.current = true;
      setTarget((t) => (t?.el === found?.el ? t : found));

      if (nextSpot) {
        if (document.getElementById("mb-done-h")) {
          setNextSpot(false);
          setNext((n) => (n ? { ...n, sent: true } : n));
        }
        // Gone elsewhere (after the push has had time to land): the spot is dropped.
        if (p !== "/dashboard/manual-blueprint" && Date.now() - stepSinceRef.current > 4000) setNextSpot(false);
        return;
      }
      if (mode === "welcome" || mode === "resume") return;

      const ctx = { pathname: p, search: window.location.search, doc: document, interacted: interactedRef.current };
      const guarded = s.when && !seenRef.current;
      if (guarded && onRoute(s, p) && Date.now() - stepSinceRef.current > WHEN_GRACE_MS) {
        // Not this page's step (the roof came with its pitch): passed over.
        goStep(step + 1);
        return;
      }
      if (!guarded && s.done(ctx)) {
        if (step >= last) finish();
        else goStep(step + 1);
        return;
      }
      if (!onRoute(s, p)) {
        if (mode === "run") {
          awayRef.current = true;
          setMode("idle");
        }
        return;
      }
      // The away mark stays until the person answers the offer: a second tick before the
      // re-render must not turn the offer into the step.
      if (mode === "idle") setMode(awayRef.current ? "resume" : "run");
    };
    const onAct = (e: Event) => {
      const t = e.target as Node | null;
      const lit = findTarget(runStep)?.el;
      if (lit && t && lit.contains(t)) interactedRef.current = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, 60);
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    document.addEventListener("click", onAct, true);
    document.addEventListener("change", onAct, true);
    document.addEventListener("input", onAct, true);
    document.addEventListener("focusout", onAct, true);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timer);
      document.removeEventListener("click", onAct, true);
      document.removeEventListener("change", onAct, true);
      document.removeEventListener("input", onAct, true);
      document.removeEventListener("focusout", onAct, true);
    };
  }, [runStep, step, last, mode, nextSpot, goStep, finish, pathname]);

  // A conditional step (the roof's pitch) says nothing until its element is on the page.
  const showing = ((mode === "run" && status === "active") || nextSpot) && !(runStep?.when && !target);
  const align = runStep?.align;

  /** The docked card's box, when the lit element would sit under it. */
  const dockedOver = useCallback(
    (b: Box | null) => {
      if (!b) return false;
      const { w, h } = cardSizeRef.current;
      return overlaps(b, dockBox(handheld, w, h));
    },
    [handheld],
  );

  // ── The frame: written straight to its style, 1:1 with the page ──────
  useLayoutEffect(() => {
    if (!showing || !target || blocked) return;
    const el = target.el;
    const fixed = pinned(el);
    let quiet = 0;
    const paint = () => {
      let b = frameOf(el.getBoundingClientRect());
      // Taller than the room above the card (the roof report on a phone): the frame ends at the card.
      if (b && !fixed && cardRef.current?.getClientRects().length) {
        const { w, h } = cardSizeRef.current;
        const dock = dockBox(handheld, w, h);
        const cut = dock.top - 8 - b.top;
        if (overlaps(b, dock) && cut >= 24) b = { ...b, height: cut };
      }
      const f = frameRef.current;
      if (f) {
        if (b) {
          f.style.top = `${b.top}px`;
          f.style.left = `${b.left}px`;
          f.style.width = `${b.width}px`;
          f.style.height = `${b.height}px`;
          f.style.visibility = "";
        } else {
          f.style.visibility = "hidden";
        }
      }
      return b;
    };
    const onScroll = () => {
      paint();
      const f = frameRef.current;
      if (!f) return;
      f.dataset.scrolling = "";
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => delete f.dataset.scrolling, SCROLL_QUIET_MS);
    };
    // The slow half: the dim (typing in the lit field), and the card's lift off a fixed bar.
    const settle = () => {
      const b = paint();
      setFocusIn(el.contains(document.activeElement));
      const vh = window.innerHeight;
      const up = b && fixed && dockedOver(b) ? vh - b.top + DOCK_PHONE : null;
      setLift(up !== null && up + cardSizeRef.current.h <= vh - DOCK_PHONE ? Math.round(up) : null);
    };
    settle();
    const ro = new ResizeObserver(settle);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    const id = window.setInterval(settle, 500);
    return () => {
      ro.disconnect();
      window.clearTimeout(quiet);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      window.clearInterval(id);
    };
  }, [showing, target, blocked, handheld, dockedOver]);

  // ── Scroll the lit element clear of the card: every step, every new target ──
  const reveal = useCallback(
    (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const { w, h } = cardSizeRef.current;
      const dock = dockBox(handheld, w, h);
      // The element lands above the card when it shares the card's column (always on a phone).
      const sharesColumn = r.left < dock.left + dock.width && r.right > dock.left;
      const inset = sharesColumn ? window.innerHeight - dock.top + DOCK_PHONE : DOCK_PHONE;
      const room = window.innerHeight - TOP_CLEAR - inset;
      const block: ScrollLogicalPosition = r.height <= room ? "center" : align === "end" ? "end" : "start";
      // scroll-margin widens the box scrollIntoView centres; read at the call, so put back straight after.
      const was = { top: el.style.scrollMarginTop, bottom: el.style.scrollMarginBottom };
      el.style.scrollMarginTop = `${TOP_CLEAR}px`;
      el.style.scrollMarginBottom = `${inset}px`;
      el.scrollIntoView({ block, inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      el.style.scrollMarginTop = was.top;
      el.style.scrollMarginBottom = was.bottom;
    },
    [handheld, align],
  );

  useEffect(() => {
    if (!showing || !target || blocked) return;
    const el = target.el;
    if (pinned(el)) return;
    reveal(el);
    const again = window.setTimeout(() => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const off = r.bottom <= TOP_CLEAR || r.top >= window.innerHeight;
      if (off || dockedOver(frameOf(r))) reveal(el);
    }, RECHECK_MS);
    return () => window.clearTimeout(again);
  }, [showing, target, step, nextSpot, blocked, reveal, dockedOver]);

  // The card's own size, for the dock and the scroll inset.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const read = () => {
      if (el.offsetWidth && el.offsetHeight) cardSizeRef.current = { w: el.offsetWidth, h: el.offsetHeight };
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-attached whenever the card comes or goes; the observer follows its size in between.
  }, [mounted, mode, nextOpen, nextSpot, showing, blocked, handheld, status]);

  // ── Focus and Escape ───────────────────────────────────────────────────
  const modalOpen = mode === "welcome" || nextOpen;
  const anyCard = modalOpen || mode === "resume" || showing;
  useEffect(() => {
    if (!anyCard || blocked) return;
    if (modalOpen && !lastFocusRef.current) lastFocusRef.current = document.activeElement as HTMLElement | null;
    headRef.current?.focus({ preventScroll: true });
  }, [anyCard, modalOpen, mode, step, nextSpot, blocked]);
  useEffect(() => {
    if (modalOpen) return;
    const back = lastFocusRef.current;
    lastFocusRef.current = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }, [modalOpen]);

  const notNow = useCallback(() => {
    if (nextOpen) return setNextOpen(false);
    if (nextSpot) return setNextSpot(false);
    if (mode === "welcome") {
      persist("pause", 0);
      setStatus("paused");
      setMode("idle");
      return;
    }
    if (step >= last) return finish();
    pause();
  }, [nextOpen, nextSpot, mode, step, last, persist, pause, finish]);

  useEffect(() => {
    if (!anyCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Another surface's own dialog closes first; so does an address list in a field being typed in.
        if (blocked) return;
        const a = document.activeElement as HTMLElement | null;
        if (a && !rootRef.current?.contains(a) && a.matches("input, textarea, select, [contenteditable='true']")) return;
        e.preventDefault();
        notNow();
        return;
      }
      if (e.key === "Tab" && modalOpen && cardRef.current) {
        const f = cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
        if (!f.length) return;
        const first = f[0];
        const end = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === headRef.current)) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anyCard, modalOpen, blocked, notNow]);

  if (!mounted) return null;
  const lit = showing && !!target;

  // ── What to draw ───────────────────────────────────────────────────────
  const count = tourCount(view.path, step);
  const title = tourTitle(view.path);
  let card: React.ReactNode = null;

  if (mode === "welcome" && status === "offer") {
    const list = steps.slice(0, -1).filter((s) => !s.when || s.counted);
    card = (
      <>
        <div className={styles.kicker}>First estimate</div>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>{title}</h2>
        <p className={styles.body}>{PATH_LINE[view.path]}</p>
        <ol className={styles.plan}>
          {list.map((s, i) => (
            <li key={s.id}>
              <span className={styles.sq} aria-hidden="true">{i + 1}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
        <div className={styles.acts}>
          <button type="button" className={styles.primary} onClick={start}>Start</button>
          <button type="button" className={styles.link} onClick={notNow}>Not now</button>
        </div>
      </>
    );
  } else if (nextOpen && next) {
    const done = next.sent ? 1 : 0;
    card = (
      <>
        <div className={styles.kicker}>Next steps · {done}/{NEXT_STEPS.length} done</div>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>Your first estimate is made</h2>
        <ol className={styles.nextList}>
          {NEXT_STEPS.map((n, i) => {
            const isDone = n.id === "send" && next.sent;
            return (
              <li key={n.id} className={isDone ? styles.isDone : undefined}>
                <span className={`${styles.sq} ${isDone ? styles.sqDone : ""}`} aria-hidden="true">{isDone ? "✓" : i + 1}</span>
                <span className={styles.nextTxt}>
                  <span className={styles.nextT}>{n.title}</span>
                  <span className={styles.nextB}>{n.body}</span>
                </span>
                {isDone ? (
                  <span className={`${styles.stamp} ${styles.stampOk}`}>Done</span>
                ) : n.live ? (
                  <button type="button" className={styles.small} onClick={showMeSend}>Show me</button>
                ) : (
                  <span className={styles.stamp}>Coming next</span>
                )}
              </li>
            );
          })}
        </ol>
        <div className={styles.acts}>
          <button type="button" className={styles.primary} onClick={() => setNextOpen(false)}>Close</button>
          <button type="button" className={styles.link} onClick={hideNext}>Hide these</button>
        </div>
      </>
    );
  } else if (mode === "resume" && status === "active") {
    const s = steps[step];
    card = (
      <>
        <div className={styles.kicker}>First estimate · step {Math.min(count.done + 1, count.total)} of {count.total}</div>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>Pick up where you left off?</h2>
        <p className={styles.body}>Next: {s?.title}.</p>
        <div className={styles.acts}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              awayRef.current = false;
              setMode("run");
            }}
          >
            Continue
          </button>
          <button type="button" className={styles.link} onClick={pause}>Not now</button>
        </div>
      </>
    );
  } else if (showing && runStep) {
    const s = runStep;
    const final = nextSpot || step >= last;
    const text = !target && s.waiting ? s.waiting : target?.name === "nav-menu" && s.menuBody ? s.menuBody : handheld && s.handheldBody ? s.handheldBody : s.body;
    card = (
      <>
        <div className={styles.kicker}>
          {nextSpot ? "Next steps · send it" : final ? "First estimate · done" : `First estimate · step ${count.done + 1} of ${count.total}`}
        </div>
        <button type="button" className={styles.close} onClick={notNow} aria-label={final ? "Close" : "Close the tour for now"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>{s.title}</h2>
        <p className={styles.body}>{text}</p>
        {!target && s.waiting ? <p className={styles.wait} role="status">Working…</p> : null}
        <div className={styles.acts}>
          {final ? (
            <button type="button" className={styles.primary} onClick={nextSpot ? () => setNextSpot(false) : finish}>Got it</button>
          ) : s.next ? (
            <button type="button" className={styles.primary} onClick={() => goStep(step + 1)}>Next</button>
          ) : (
            <span className={styles.hint}>Do this step to go on</span>
          )}
          {!final && (
            <button type="button" className={styles.link} onClick={skip}>Skip tour</button>
          )}
        </div>
      </>
    );
  }

  if (!card || blocked) return null;
  // A phone, a field in the frame being typed in: the keyboard and the field's own list need the screen.
  const stepAside = handheld && showing && focusIn;

  const modal = mode === "welcome" || nextOpen;
  const dim = lit && !focusIn;
  // The welcome and the next steps: centred on the desk, the handheld sheet on a phone.
  // Every other card: docked bottom-right on the desk, across the foot on a phone.
  const place = modal ? (handheld ? styles.sheet : styles.center) : handheld ? `${styles.pop} ${styles.popPhone}` : styles.pop;

  return createPortal(
    <div className={styles.root} ref={rootRef} data-tour-root="">
      {modal && <div className={styles.scrim} onClick={notNow} aria-hidden="true" />}
      {lit && (
        // Positioned by the measuring effect, straight on its style.
        <div ref={frameRef} className={`${styles.frame} ${dim ? styles.frameDim : ""}`} aria-hidden="true">
          {!nextSpot && step < last && <span className={styles.tag}>{count.done + 1}/{count.total}</span>}
        </div>
      )}
      <div className={handheld ? styles.layer : styles.deskLayer} hidden={stepAside}>
        <div
          ref={cardRef}
          className={`${styles.card} ${place}`}
          style={!modal && lit && lift !== null ? { bottom: lift } : undefined}
          role="dialog"
          aria-modal={modal ? "true" : "false"}
          aria-labelledby="tour-h"
        >
          {handheld && modal && <span className={styles.grab} aria-hidden="true" />}
          {card}
        </div>
      </div>
    </div>,
    document.body,
  );
}
