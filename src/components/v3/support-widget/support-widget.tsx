"use client";

// SUPPORT WIDGET — the Help control every signed-in user gets, and the
// composer it opens.
//
// ONE LAUNCHER, DOCKED, AT EVERY WIDTH — and why the floating plate is gone.
//   A globally mounted button parked in the bottom-right corner cannot hold
//   that corner against the pages. On handheld it covered the Smart Proposal
//   wizard's only "Next" (.wfoot), the dashboard error toast's only dismiss
//   (.toastX, no timeout) and the manual builder's totals-bar chevron
//   (.barExpand); dropping the plate to z-index 2 stopped the click-stealing
//   and then buried the plate itself under FloatingCostsCard (z 40), which is
//   PERMANENT furniture on /dashboard/proposals/new and /[id] — so above
//   860px, where the docked button used to be hidden, Help was unreachable on
//   both live proposal-editor routes.
//   The top bar is the one corner of the screen no page claims, it is already
//   where the handheld launcher lived, and it makes the control identical on
//   every viewport. <SupportLauncher /> renders there at EVERY width now, and
//   it is the only launcher there is.
//
// THE TWO PIECES TALK BY EVENT, not by props. `SupportLauncher` dispatches
// `jf:support` on `document`; the widget listens. Same arrangement as the
// estimator picker and the command palette, and for the same reason: the
// button belongs in a top bar three components away from the dialog it opens.
//
// WHO MOUNTS WHAT
//   · BlueprintShell        <SupportWidget> outside `.layout` (a node inside
//                           takes a grid column) + <SupportLauncher> in the
//                           blueprint topbar.
//   · MobileNav             <SupportWidget> + <SupportLauncher> in the topbar,
//                           for the handheld fleet.
//   · ResponsiveShell       <SupportWidget> for /dashboard, the one mapped
//                           handheld surface that kept its own topbar; that
//                           topbar mounts its own <SupportLauncher>.
//   · (dashboard) layout    <SupportWidget> for the ~50 classic routes — every
//                           billing and settings surface, which is exactly
//                           where the Billing and Account categories point.
//                           Its launcher is in the classic topbar, which is
//                           `hidden md:flex`; below 768 that group draws NO top
//                           bar at all, so the tab bar's More drawer carries
//                           the same control as a row. Still exactly one.
// THE ANSWER, RIGHT HERE (owner, 2026-10-15): once a ticket is filed the
// window says "Looking into it…" and asks for the support AI's answer
// (actions/supportLive) every two seconds for up to 90; the answer the
// customer was also emailed lands in the window, with "That solved it"
// (resolves the ticket) and "I still need help" (back to Open, a note for the
// team, the support inbox told). A ticket the AI hands to a person says so; no
// AI answer coming (switched off, drafts only) shows the plain confirmation.
//
// NOT the admin console (the operator does not file tickets to himself) and
// not the public or auth routes, which render no shell.
//
// EVERY MOUNT PASSES `signedIn`. The standalone /mobile-*-v2 review URLs render
// the same page components outside the dashboard layout and outside the
// middleware's matcher, so they have no session and no NavRoleProvider. A
// launcher there would open a composer whose send could only ever fail.
//
// The dialog is hand-rolled, not `.mdl`: those enter/exit keyframes are
// published by dashboard-blueprint/blueprint-global.css, which only the desktop
// shell imports. Same reason the estimator picker rolls its own — a control
// mounted in four shells cannot depend on any one of their stylesheets.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { submitSupportTicket } from "@/actions/support";
import { answerSupportVerdict, liveSupportAnswer } from "@/actions/supportLive";
import { answerBlocks, type AnswerPiece, type LiveState } from "@/lib/support/aiState";
import { lockScroll } from "@/lib/scrollLock";
// The categories, the message limit and SmartHelp's hand-off are the composer's pure half (./composer).
import { BODY_MAX, CATEGORIES, composerOpening, composerTicket, type HandoffMark, type SupportPrefill } from "./composer";
import { SmartHelpRoot } from "@/components/v3/smarthelp/smarthelp";
import "./support-widget.css";

export type { SupportPrefill } from "./composer";

/** Longest panel transition (the handheld sheet's 0.28s slide). */
const EXIT_MS = 280;

/** The one channel between a launcher and the composer. */
const OPEN_EVENT = "jf:support";

/** How long the window waits for the AI's answer before saying it will come by email. */
const LIVE_WAIT_MS = 90_000;
const LIVE_FIRST_MS = 1_200;
const LIVE_EVERY_MS = 2_000;

/** A paragraph's pieces: words, line breaks, JobFlex's own links. */
function Pieces({ parts }: { parts: AnswerPiece[] }) {
  return (
    <>
      {parts.map((piece, k) =>
        "br" in piece ? (
          <br key={k} />
        ) : "path" in piece ? (
          <a key={k} href={piece.path}>
            {piece.label}
          </a>
        ) : (
          <span key={k}>{piece.text}</span>
        ),
      )}
    </>
  );
}

/** The AI's answer, as paragraphs and cards ("[offer]" / "[note]", lib/support/replyCards); JobFlex's own links clickable. */
function AnswerBody({ body }: { body: string }) {
  return (
    <div className="jfsup-answer" data-support-live-answer>
      {answerBlocks(body).map((b, i) =>
        b.kind === "text" ? (
          <p key={i}>
            <Pieces parts={b.parts} />
          </p>
        ) : (
          <div key={i} className={`jfsup-card jfsup-card--${b.kind}`} data-support-card={b.kind}>
            <b>{b.title}</b>
            {b.parts.length ? (
              <p>
                <Pieces parts={b.parts} />
              </p>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

/** Everything a Tab can land on inside the panel. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Rendered, not merely present: `getClientRects()` is empty for a
 *  `display: none` element — which the classic group's docked launcher is
 *  below 768px, where that whole top bar is `hidden md:flex`. */
function isRendered(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
}

function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isRendered);
}

// lucide `circle-help` and `x`, inlined rather than imported: this component is
// mounted on every surface in the app, and two icons do not justify pulling the
// lucide runtime into chrome that is otherwise ~4kB. Same 24×24 / stroke-2 grid
// as the sprite, so it sits in the same drawing.
const HELP_PATHS = [
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",
  "M12 17h.01",
];
/** A HEADSET — a support desk, not a question mark (owner's call,
 *  2026-08-27), and with the boom mic the headphones alone were missing: a
 *  band with two cups reads as "listen to music", the mic is what makes it
 *  read as "talk to someone". lucide `headset`, unmodified, so it sits on the
 *  same 24x24 / stroke-2 grid as every other glyph here. */
const SUPPORT_PATHS = [
  "M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a9 9 0 1 1 18 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
  "M21 16v2a4 4 0 0 1-4 4h-5",
];
const X_PATHS = ["M18 6 6 18", "m6 6 12 12"];

/** Always decorative: every control that carries one has its own aria-label.
 *  The stroke basics are ATTRIBUTES, not CSS, so the glyph draws correctly
 *  inside a host topbar whose own icon class only sets a size. */
function Icon({ d, className }: { d: string[]; className?: string }) {
  return (
    <svg
      className={className ?? "jfsup-ic"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** What a launcher may hand the composer along with the request to open. */
type OpenDetail = { opener: HTMLElement | null; prefill: SupportPrefill | null };

/**
 * Open the composer from anywhere. For a host whose Help control is not an
 * icon button — the classic tab bar's "More" drawer, where it is a row.
 *
 * `opener` is the element focus should return to on close. Pass it whenever the
 * host tears its own chrome down on the way here: the composer otherwise reads
 * `document.activeElement`, and a drawer that closes as it opens the composer
 * leaves focus on a node that is about to unmount. Focus then has nowhere to go
 * and lands on `<body>` — the whole page's tab order, from the top.
 *
 * `prefill` is SmartHelp's hand-off: the message (clipped to the composer's own
 * limit) and category, and the mark the send carries. Opened without one, the
 * composer is as it always was, and a mark left by an earlier hand-off is gone.
 */
export function openSupportComposer(opener?: HTMLElement | null, prefill?: SupportPrefill): void {
  const detail: OpenDetail = { opener: opener ?? null, prefill: prefill ?? null };
  document.dispatchEvent(new CustomEvent<OpenDetail>(OPEN_EVENT, { detail }));
}

/**
 * THE launcher: one icon button in the host's top bar, wearing that bar's own
 * classes so it belongs to whichever chrome it is sitting in — the same
 * arrangement NotificationBell already uses. Rendered at every width; nothing
 * floats anywhere any more.
 *
 * The stylesheet adds the three things a host bar cannot know about: a 44px
 * touch floor that costs no layout, the hover tooltip, and a fallback size for
 * the glyph when the host names no icon class.
 */
export function SupportLauncher({
  className,
  iconClassName,
}: {
  /** The host bar's icon-button class (`.tbarBtn`, `icon-btn`, …). */
  className?: string;
  /** The host bar's icon class, for size. */
  iconClassName?: string;
}) {
  return (
    <button
      className={["jfsup-dock", className].filter(Boolean).join(" ")}
      type="button"
      aria-label="Help"
      aria-haspopup="dialog"
      onClick={(e) => openSupportComposer(e.currentTarget)}
    >
      <Icon d={HELP_PATHS} className={iconClassName} />
      {/* One word, on an ink plate, under the button — the same tooltip the
          floating plate carried, on the only side a control in a top bar has.
          aria-hidden: the button already says "Help" as its accessible name. */}
      <span className="jfsup-tip" aria-hidden="true">
        Help
      </span>
    </button>
  );
}

/**
 * THE FLOATING LAUNCHER — a plate in the bottom-right corner that widens on
 * hover to read "Support".
 *
 * It replaces the top-bar button (owner's call, 2026-08-27). The corner was
 * given up in the first place because a globally mounted plate covered page
 * controls; the answer this time is not to move the button but to give it room:
 * every shell's content column now carries bottom padding the height of this
 * plate, so the page can always be scrolled clear of it (see
 * support-widget.css and the `.content` / `main` rules that reserve the space).
 *
 * It does NOT carry `jfsup-dock`: that class is written for a button drawn by
 * a host top bar and its rules (trebled selectors, 34px box, relative
 * position) would overrule everything below. The composer's focus-return knows
 * about both classes instead.
 */
/** Clearance between the plate and whatever it is standing on. */
const FAB_GAP = 14;
/** Where the plate rests when NOTHING is under it — the same corner inset the
 *  desk stylesheet uses, so a bar-less handheld page (financials, the CRM
 *  list) puts the plate in the corner and not 84px up it. The stylesheet's
 *  handheld fallback assumes a tab bar and only stands until the first
 *  measurement; this is what that measurement writes when it finds none. */
const FAB_REST = 22;

/**
 * How much of the bottom of the viewport is already spoken for — a tab bar, a
 * sticky action bar, a totals bar — MEASURED, not assumed.
 *
 * The plate used to sit at a flat 84px on handheld, which was the height of one
 * bar on one page. Every taller bar in the fleet (the video estimator's ANALYZE
 * VIDEO bar, the manual builder's totals bar with its chevron open, anything
 * that wraps to two rows) then ran straight under it. A number written in the
 * stylesheet cannot follow a bar that changes height at runtime; this can.
 *
 * Three probes across the bottom edge rather than one, because a bar can be
 * inset or partial. `elementsFromPoint` skips `pointer-events: none` overlays
 * for free.
 *
 * WHAT COUNTS AS A BAR IS GEOMETRY, NOT `position`. The first cut of this only
 * accepted `fixed`/`sticky` elements and found NOTHING on the handheld
 * dashboard — that tab bar is a static row of a `100dvh` grid, and the plate
 * promptly parked itself on top of it. So: anything at the bottom edge that
 * spans most of the width and is short enough not to be the page itself. The
 * outermost match wins (smallest `top`), which is the bar rather than the
 * label inside it.
 */
function bottomObstruction(fab: HTMLElement): { px: number; bar: HTMLElement | null } {
  if (typeof window === "undefined") return { px: 0, bar: null };
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // ENDS ON the bottom edge, runs most of the way across, and is a band rather
  // than a page: 40% of the viewport is already a generous bar.
  //
  // ENDS ON, not merely REACHES. The first cut accepted anything whose bottom
  // was at or past the edge, and on a plain scrolling page that is every
  // mid-size block the scroll position happens to leave straddling it: on the
  // handheld financials page — no tab bar, no sticky bar at all — the revenue
  // chart's SVG crossed the edge, passed as a bar, and the plate parked itself
  // 111px up in the middle of the page. A bar is pinned: its bottom edge IS
  // the viewport's, within a few px for a fractional layout. Content scrolled
  // through the edge extends past it, and is not a bar.
  const isBand = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (Math.abs(r.bottom - vh) > 4) return false;
    if (r.height < 8 || r.height > vh * 0.4) return false;
    if (r.width < vw * 0.6) return false;
    return true;
  };

  let top = vh;
  let bar: HTMLElement | null = null;
  for (const f of [0.18, 0.5, 0.82]) {
    const x = Math.round(vw * f);
    const stack = document.elementsFromPoint(x, vh - 2);

    // THE FRONTMOST band, then its outermost band ANCESTOR — not the outermost
    // band in the whole hit list. `elementsFromPoint` returns everything under
    // the point, painted or not, and a sticky bar has page content scrolled
    // BEHIND it: on the manual builder the list held the bar (68px) and then a
    // card body (327px) lying under it, and "smallest top wins" chose the body.
    // The plate then parked itself 144px up, in the middle of the form, on a
    // page whose bar is 68px tall. Content behind the bar is never an ancestor
    // of the bar, so climbing from the front instead of scanning the stack
    // cannot reach it — while still landing on the bar rather than a
    // full-width row inside it, which was what the outermost rule was for.
    let el: HTMLElement | null = null;
    for (const hit of stack) {
      if (!(hit instanceof HTMLElement) || hit === fab || fab.contains(hit)) continue;
      if (isBand(hit)) {
        el = hit;
        break;
      }
    }
    if (!el) continue;
    let p = el.parentElement;
    while (p && p !== document.body && isBand(p)) {
      el = p;
      p = p.parentElement;
    }
    const r = el.getBoundingClientRect();
    if (r.top < top) {
      top = r.top;
      bar = el;
    }
  }
  return { px: Math.max(0, Math.round(vh - top)), bar };
}

export function SupportFab() {
  const ref = useRef<HTMLButtonElement>(null);

  // Re-measured on every input that can move a bottom bar: the viewport
  // resizing (including the mobile URL bar collapsing), the page scrolling a
  // sticky bar into place, the bar itself changing height, and the tree the bar
  // lives in being replaced on a route change.
  useEffect(() => {
    const fab = ref.current;
    if (!fab) return;

    let raf = 0;
    let barObserved: HTMLElement | null = null;
    const barRO = new ResizeObserver(() => schedule());

    function apply() {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      // HANDHELD ONLY. On the desk the plate has its own corner — every page
      // column stops well short of it and the shells reserve the strip under
      // it — so a bar measured there only ever LIFTED the plate off the
      // corner it was placed in (the manual builder's sticky total bar spans
      // the column, not the screen, and the plate climbed it anyway). The
      // stylesheet's desk inset stands; measurement is a phone's problem.
      if (!window.matchMedia("(max-width: 768px)").matches) {
        el.style.removeProperty("--jfsup-fab-bottom");
        if (barObserved) {
          barRO.unobserve(barObserved);
          barObserved = null;
        }
        return;
      }
      const { px, bar } = bottomObstruction(el);
      // The probe measures in VIEWPORT px; `bottom` is applied in the plate's
      // OWN px. Those differ inside the desk blueprint shell, whose FLUID SCALE
      // puts `zoom: 0.78` on the root this plate is mounted in — 65 CSS px of
      // inset there is ~51 visual px, and the plate sat on the bar's top edge
      // with its 14px gap zoomed away. Dividing by the plate's render scale
      // (its painted height over its layout height) converts back; 1 on every
      // unzoomed surface.
      const scale = el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1;
      const inset = Math.round((px > 0 ? px + FAB_GAP : FAB_REST) / (scale || 1));
      el.style.setProperty("--jfsup-fab-bottom", `calc(${inset}px + env(safe-area-inset-bottom, 0px))`);
      if (bar !== barObserved) {
        if (barObserved) barRO.unobserve(barObserved);
        if (bar) barRO.observe(bar);
        barObserved = bar;
      }
    }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    }

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    // THE BAR MOVES AFTER IT MOUNTS. The blueprint pages run an entrance
    // cascade — the sticky bar arrives translated down and fading in over
    // ~600ms — and every trigger above fires BEFORE that finishes: the
    // mutation on mount, the initial scroll, nothing after. The last probe
    // therefore read the bar ~14px lower than it would rest, and the plate
    // sat on the bar's top edge until the first scroll happened to re-run
    // it. Capture-phase, because neither event bubbles reliably out of a
    // child that animates, and coalesced by `schedule` so a page full of
    // reveal animations costs one rAF, not one per card.
    document.addEventListener("animationend", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    // And a settle pass regardless, for a cascade that ends on a `transform`
    // the page clears without an event (reduced motion, an interrupted
    // animation). 1.2s clears the longest entrance in the fleet.
    const settle = window.setTimeout(schedule, 1200);
    // A route change swaps the whole page tree, bar included; childList on the
    // body is the cheapest signal that has happened, and the work is one rAF.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      document.removeEventListener("animationend", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("scroll", schedule);
      mo.disconnect();
      barRO.disconnect();
    };
  }, []);

  return (
    <button
      ref={ref}
      className="jfsup-fab"
      type="button"
      aria-haspopup="dialog"
      onClick={(e) => openSupportComposer(e.currentTarget)}
    >
      <Icon d={SUPPORT_PATHS} className="jfsup-fab-ic" />
      <span className="jfsup-fab-lbl">Support</span>
    </button>
  );
}

export function SupportWidget({
  signedIn,
}: {
  /** False on the review URLs that render a page shell with no session. */
  signedIn: boolean;
}) {
  // Two flags because there are two things to say. `open` decides whether the
  // panel is in the frame at all (`hidden` → display: none); `on` is added one
  // frame later so the enter transition has a start state to leave from, and
  // removed first on the way out so the exit can play before the node goes.
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(false);
  const [category, setCategory] = useState<string>(CATEGORIES[0].value);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The filed ticket, and whether the operator alert actually went out.
   *  Non-null = the composer has collapsed. */
  const [filed, setFiled] = useState<{ id: string; ref: string; notified: boolean } | null>(null);
  /** The AI's answer to the filed ticket: waiting, here, handed to a person, none coming, or late. */
  const [live, setLive] = useState<LiveState | { state: "late" } | null>(null);
  /** The customer's word on it: asking for more detail, or given. */
  const [verdict, setVerdict] = useState<null | "asking" | "solved" | "needs-person">(null);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [stuckNote, setStuckNote] = useState("");
  const stuckRef = useRef<HTMLTextAreaElement>(null);

  const popRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const exitTimer = useRef<number | null>(null);
  /** Whatever opened this — the docked Help button in whichever top bar the
   *  surface draws, or the tab bar's More row below 768. Focus goes back to it
   *  on close. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** The SmartHelp hand-off mark this opening carries to the send, or null — set by every `show()`. */
  const handoffRef = useRef<HandoffMark>(null);
  /** True only while the dialog owns focus. Cleared BEFORE the close path
   *  moves focus out, so the containment guard below does not fight it. */
  const trapping = useRef(false);
  const titleId = useId();

  const close = useCallback(() => {
    setOn(false);
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(
      () => {
        exitTimer.current = null;
        trapping.current = false;
        setOpen(false);
        // The message survives a dismissal — a half-written report the user
        // closed by mistake is not something to throw away. A FILED one does
        // not: the next open starts a new ticket.
        setFiled(null);
        setLive(null);
        setVerdict(null);
        setVerdictError(null);
        setStuckNote("");
        setError(null);
        // Back to whatever opened this, and failing that to the dock — the
        // only launcher there is. The fallback matters for a host whose own
        // control has gone by now (the tab bar's More drawer closes behind
        // itself), and it is QUERIED rather than held in a ref because the dock
        // is rendered by the host bar, three components away. `isRendered` is
        // what keeps a `display: none` dock out of the list: `.focus()` on one
        // is a no-op and focus lands on <body> — the whole page's tab order,
        // from the top.
        const back = [
          openerRef.current,
          document.querySelector<HTMLElement>(".jfsup-fab"),
          document.querySelector<HTMLElement>(".jfsup-dock"),
        ].find(isRendered);
        back?.focus();
      },
      reducedMotion() ? 0 : EXIT_MS,
    );
  }, []);

  const show = useCallback((opener?: HTMLElement | null, prefill?: SupportPrefill | null) => {
    if (!signedIn) return;
    // Caught mid-exit: `open` is still true, so the enter effect below will not
    // re-run and the panel would sit in its faded-out state forever. Putting
    // `on` back is the whole recovery — focus never left the panel. Reachable
    // because the launcher does not know the panel's state and will happily ask
    // for it again during the 280ms exit.
    const midExit = exitTimer.current !== null;
    if (exitTimer.current) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    // An opener the launcher named beats whatever holds focus right now. A host
    // that closes its own chrome on the way here has already moved focus onto a
    // node one frame from unmounting, and every fallback in `close()` can be
    // unrendered at that width — so the named element is the only thing that
    // survives to be focused again.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && active !== document.body ? active : null;
    openerRef.current = isRendered(opener) ? opener : focused;
    // SmartHelp's hand-off starts from its words and category, and its mark
    // rides on the send (./composer). Any other opening carries no mark, so one
    // left by an earlier hand-off never files a ticket the person started.
    const opening = composerOpening(prefill);
    handoffRef.current = opening.mark;
    if (opening.start) {
      setMessage(opening.start.message);
      setCategory(opening.start.category);
    }
    setError(null);
    setFiled(null);
    setLive(null);
    setVerdict(null);
    setVerdictError(null);
    setStuckNote("");
    setOpen(true);
    if (midExit) setOn(true);
  }, [signedIn]);

  // Any launcher, anywhere in the document.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenDetail>).detail;
      show(detail?.opener ?? null, detail?.prefill ?? null);
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, [show]);

  // The frame-later `.on`, plus focus into the field the moment it can hold it.
  useEffect(() => {
    if (!open) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setOn(true);
        trapping.current = true;
        fieldRef.current?.focus();
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [open]);

  // HANDHELD SCROLL LOCK. At ≤860px the panel is a bottom sheet pinned to the
  // viewport, and a page that keeps scrolling behind it reads as the sheet
  // sliding off. Reference-counted through lib/scrollLock, never a hand-rolled
  // `document.body.style.overflow`: nested locks poison each other and the page
  // stays locked with nothing holding it (decisions.md, Session 3). Desktop
  // keeps its scroll — there the panel is a corner card over a transparent
  // scrim, not a sheet standing on the page.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(max-width: 860px)");
    let release: (() => void) | null = null;
    const sync = () => {
      if (mq.matches && !release) {
        release = lockScroll();
      } else if (!mq.matches && release) {
        release();
        release = null;
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      release?.();
    };
  }, [open]);

  // The confirmation replaces the form, so the field that had focus is gone.
  // Without this the browser drops focus to <body> mid-dialog.
  useEffect(() => {
    if (filed) doneRef.current?.focus();
  }, [filed]);

  // THE ANSWER, WHILE THE CUSTOMER WATCHES. Ask for it until it lands, the AI
  // says a person has it, nothing is coming, or LIVE_WAIT_MS runs out. A failed
  // ask (a blip, a deploy) just asks again.
  const filedId = filed?.id ?? null;
  useEffect(() => {
    if (!filedId) return;
    let stop = false;
    let timer = 0;
    const started = Date.now();
    const ask = async () => {
      try {
        const next = await liveSupportAnswer(filedId);
        if (stop) return;
        if (next.state !== "pending") {
          setLive(next);
          return;
        }
      } catch {
        /* ask again */
      }
      if (stop) return;
      if (Date.now() - started > LIVE_WAIT_MS) {
        setLive({ state: "late" });
        return;
      }
      timer = window.setTimeout(ask, LIVE_EVERY_MS);
    };
    timer = window.setTimeout(ask, LIVE_FIRST_MS);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [filedId]);

  useEffect(() => {
    if (verdict === "asking") stuckRef.current?.focus();
  }, [verdict]);

  async function giveVerdict(next: "solved" | "needs-person") {
    if (!filed || verdictBusy) return;
    setVerdictBusy(true);
    setVerdictError(null);
    try {
      const r = await answerSupportVerdict(filed.id, next, next === "needs-person" ? stuckNote : undefined);
      if (r.ok) setVerdict(next);
      else setVerdictError(r.error);
    } catch {
      setVerdictError("That didn't go through. Try again.");
    } finally {
      setVerdictBusy(false);
    }
  }

  // FOCUS CONTAINMENT. `aria-modal="true"` is a promise to a screen reader
  // that nothing outside the dialog is reachable; the app behind it has ~107
  // focusables and nothing inert, so the promise has to be kept in code.
  // Tab wraps inside the panel, and anything that lands focus outside it
  // — a browser control cycle, a stray programmatic focus — is pulled back.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      if (!trapping.current) return;
      const panel = popRef.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target && panel.contains(target)) return;
      (focusablesIn(panel)[0] ?? panel).focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // CAPTURE phase, and that is the whole point. Both nav shells bind their
      // own Escape for the drawer on `document` too, and `stopPropagation()`
      // from one bubble-phase listener cannot stop another on the SAME node —
      // the old code tried, and one press closed the composer and the drawer.
      // A capture listener on `document` runs before every bubble listener on
      // it, whatever order they registered in, so stopping there is decisive.
      e.stopPropagation();
      close();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  useEffect(
    () => () => {
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
    },
    [],
  );

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const panel = popRef.current;
    if (!panel) return;
    const items = focusablesIn(panel);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey ? active === first : active === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  async function send() {
    const body = message.trim();
    // Checked here as well as on the server so the predictable refusals read in
    // the widget's own words. Anything else that comes back is the server's and
    // is shown verbatim.
    if (!body) {
      setError("Write what happened.");
      fieldRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submitSupportTicket(composerTicket(body, category, handoffRef.current));
      setFiled({ id: result.id, ref: result.ref, notified: result.notified });
      setLive({ state: "pending" });
      setVerdict(null);
      setMessage("");
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : "Could not send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) return null;

  const cls = ["jfsup", open && "jfsup--open", on && "jfsup--on"].filter(Boolean).join(" ");

  const widget = (
    // data-nest: the widget resets itself (.jfsup *); a page root's reset steps around it (docs/design/mobile.md).
    <div className={cls} data-nest="">
      {/* The launcher travels WITH the widget now: one mount is one button, so
          no host can end up with two or none. Hidden while the composer is up —
          the panel stands in that corner. */}
      {!open ? <SupportFab /> : null}
      <div className="jfsup-scrim" hidden={!open} onClick={close} aria-hidden="true" />

      <div
        ref={popRef}
        className="jfsup-pop"
        hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
      >
        <div className="jfsup-grab" aria-hidden="true" />

        <div className="jfsup-head">
          <div className="jfsup-title" id={titleId}>
            Help
          </div>
          <button className="jfsup-x" type="button" aria-label="Close" onClick={close}>
            <Icon d={X_PATHS} />
          </button>
        </div>

        {filed ? (
          <div className="jfsup-body">
            {live?.state === "pending" ? (
              <div className="jfsup-live" aria-live="polite" data-support-live="pending">
                <div className="jfsup-live-t">
                  <span className="jfsup-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Looking into it…
                </div>
                <div className="jfsup-ok-s">
                  Ticket <span className="jfsup-ref">{filed.ref}</span> is in. The answer usually takes a few seconds — it
                  will also come by email.
                </div>
              </div>
            ) : live?.state === "answer" ? (
              <div className="jfsup-live" aria-live="polite" data-support-live="answer">
                <div className="jfsup-live-t">Here&apos;s what we found</div>
                <AnswerBody body={live.body} />
                <div className="jfsup-ok-s">
                  Ticket <span className="jfsup-ref">{filed.ref}</span> · also sent to your email.
                </div>
                {verdict === null && !live.verdict ? (
                  <div className="jfsup-acts">
                    <button className="jfsup-send" type="button" onClick={() => giveVerdict("solved")} disabled={verdictBusy} data-support-solved>
                      That solved it
                    </button>
                    <button className="jfsup-done" type="button" onClick={() => setVerdict("asking")} disabled={verdictBusy} data-support-stuck>
                      I still need help
                    </button>
                  </div>
                ) : verdict === "asking" ? (
                  <div className="jfsup-stuck">
                    <textarea
                      ref={stuckRef}
                      className="jfsup-in jfsup-in--short"
                      value={stuckNote}
                      maxLength={2000}
                      disabled={verdictBusy}
                      placeholder="What's still not working? (optional)"
                      aria-label="What's still not working"
                      onChange={(e) => setStuckNote(e.target.value)}
                      data-support-stuck-note
                    />
                    <button className="jfsup-send" type="button" onClick={() => giveVerdict("needs-person")} disabled={verdictBusy} data-support-stuck-send>
                      {verdictBusy ? "Sending" : "Send to our team"}
                    </button>
                  </div>
                ) : (verdict ?? live.verdict) === "solved" ? (
                  <div className="jfsup-thanks" data-support-thanks="solved">
                    Glad that helped! Ticket {filed.ref} is closed — open Help any time you need us.
                  </div>
                ) : (
                  <div className="jfsup-thanks" data-support-thanks="needs-person">
                    Thanks for telling us. Someone from our team will pick this up personally and write back by email.
                  </div>
                )}
                {verdictError ? (
                  <div className="jfsup-err" role="alert">
                    {verdictError}
                  </div>
                ) : null}
              </div>
            ) : live?.state === "held" ? (
              <div className="jfsup-live" aria-live="polite" data-support-live="held">
                <div className="jfsup-live-t">We&apos;re on it</div>
                <div className="jfsup-ok-s">
                  A member of our team is looking into this personally and will write back by email. Ticket{" "}
                  <span className="jfsup-ref">{filed.ref}</span>.
                </div>
              </div>
            ) : live?.state === "late" ? (
              <div className="jfsup-live" aria-live="polite" data-support-live="late">
                <div className="jfsup-live-t">Still working on it</div>
                <div className="jfsup-ok-s">
                  This one is taking a little longer — we&apos;ll email you the answer as soon as it&apos;s ready. Ticket{" "}
                  <span className="jfsup-ref">{filed.ref}</span>.
                </div>
              </div>
            ) : (
              <div className="jfsup-ok">
                <div className="jfsup-ok-t">Ticket filed</div>
                <span className="jfsup-ref">{filed.ref}</span>
                {/* What actually happened, not what usually happens: the action
                    reports whether the operator alert went out, and a dead mail
                    transport is the default in local and preview builds. */}
                <div className="jfsup-ok-s">
                  {filed.notified
                    ? "Our team has been alerted."
                    : "The email alert did not go out. Quote this reference if you follow up."}
                </div>
              </div>
            )}
            {/* The ticket is a conversation (2026-10-17): every role can open it and write in it. */}
            <a className="jfsup-done jfsup-open" href={`/dashboard/support?ticket=${filed.id}`} data-support-open-conversation>
              Open the conversation
            </a>
            <button className="jfsup-done" type="button" ref={doneRef} onClick={close}>
              Close
            </button>
          </div>
        ) : (
          <div className="jfsup-body">
            <div className="jfsup-cats" role="group" aria-label="What is this about">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  className="jfsup-cat"
                  type="button"
                  aria-pressed={category === c.value}
                  onClick={() => setCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <textarea
              ref={fieldRef}
              className="jfsup-in"
              value={message}
              maxLength={BODY_MAX}
              disabled={busy}
              placeholder="What happened?"
              aria-label="Message"
              onChange={(e) => setMessage(e.target.value)}
            />

            {error ? (
              <div className="jfsup-err" role="alert">
                {error}
              </div>
            ) : null}

            <button className="jfsup-send" type="button" disabled={busy} onClick={send}>
              {busy ? "Sending" : "Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // SmartHelp (components/v3/smarthelp) lives beside the composer, so it is wherever Help is — and in the same
  // stacking context, under the composer that its "Ask a person" opens.
  return (
    <>
      {widget}
      <SmartHelpRoot />
    </>
  );
}
