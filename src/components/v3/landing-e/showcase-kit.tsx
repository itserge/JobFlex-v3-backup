"use client";

/* ============================================================
   SHOWCASE KIT — what every estimator shot is built from
   ============================================================
   Moved out of estimators-showcase.tsx on 2026-09-06 so the FenceShot could
   also stand in the hero (the `?industry=fencing` landing) without the hero
   importing the whole showcase. Nothing here changed in the move: the
   palette, the three hooks (compact / phases / typed), the app chrome, the
   prompt, the takeoff rail and the plan-box geometry are the originals,
   now exported. */

import { useEffect, useState } from "react";
import { Counter } from "./counter";

export const INK = "#0a0a0a";
export const BLUE = "#1854A0";
export const SKY = "#4A9EFF";
export const HAIR = "rgba(10,10,10,0.12)";
export const EASE = "cubic-bezier(.22,.61,.36,1)";

/** True on a handheld column, where the rail sits under the stage rather than
    beside it — the prompt has no rail to slide away from there. */
export function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return compact;
}

/** True when the visitor asked for reduced motion (read after mount). */
export function useReduced() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  return reduced;
}

/** Advances through a sequence on its own clock, and rewinds when it restarts. */
export function usePhases(marks: number[], active: boolean, instant = false) {
  const [phase, setPhase] = useState(0);
  const [reduced, setReduced] = useState(false);
  const key = marks.join(",");

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (reduced || instant) {
      const id = requestAnimationFrame(() => setPhase(marks.length));
      return () => cancelAnimationFrame(id);
    }
    const timers = marks.map((ms, i) => setTimeout(() => setPhase(i + 1), ms));
    return () => timers.forEach(clearTimeout);
    // marks is a literal per shot; key keeps the identity stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced, instant, key]);

  return phase;
}

/* TYPING PACE (owner, 2026-09-26): the prompts type slowly enough to read,
   the finished line sits for a beat, and only then does the estimate come.
   A shot derives its phase marks from these — never a literal that could
   lift the prompt while it is still typing. */
/** ms per character. */
export const TYPE_MS = 52;
/** The caret blinks in the empty field this long before the first key. */
export const TYPE_LEAD = 450;
/** The typed line stays put this long before the prompt lifts. */
export const TYPE_BEAT = 1000;
/** How long the finished estimate stays up before the next slide. */
export const READ_HOLD = 3600;
/** When a prompt of `len` characters has finished typing. */
export const typedAt = (len: number) => TYPE_LEAD + len * TYPE_MS;

/** Types a string out on a fixed cadence once it is allowed to start. The
    count is read off a wall clock from the start (not a chain of timeouts,
    which drifted ~30 % slow), so a phase mark from `typedAt` is exact. */
export function useTyped(text: string, active: boolean, speed = 20, instant = false, delay = 0) {
  const [n, setN] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (reduced || instant) {
      const id = requestAnimationFrame(() => setN(text.length));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now() + delay;
    let timer = 0;
    const tick = () => {
      const k = Math.min(text.length, Math.max(0, Math.floor((performance.now() - t0) / speed) + 1));
      setN(k);
      if (k < text.length) timer = window.setTimeout(tick, Math.max(8, t0 + k * speed - performance.now()));
    };
    timer = window.setTimeout(tick, Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [active, reduced, instant, text, speed, delay]);

  return text.slice(0, n);
}

/* ============================================================
   CHROME
   ============================================================ */

export function AppFrame({
  path,
  body = "#ffffff",
  children,
}: {
  path: string;
  /** Retired (owner, 2026-09-26): the chrome no longer carries a "Send …"
   *  pill. Still accepted so an old caller compiles; nothing renders. */
  action?: string;
  body?: string;
  children: React.ReactNode;
}) {
  return (
    // `body` is the stage's own colour: the rail column sits on it and stays
    // invisible until the estimate slides in, instead of reading as a white slab.
    <div
      className="lp-mock-frame overflow-hidden rounded-md shadow-lp-mock ring-1 ring-black/10"
      style={{ background: body, transition: "background .8s ease" }}
    >
      <div className="flex items-center gap-3 border-b-2 border-ink bg-white px-4 py-2.5">
        <span className="grid h-5 w-5 place-items-center rounded-[2px] bg-ink text-[10px] font-black text-white">J</span>
        <span className="min-w-0 flex-1 truncate rounded-[2px] border border-black/10 bg-lp-paper px-2.5 py-1 font-mono text-[10.5px] text-ink-muted">
          {path}
        </span>
      </div>
      {children}
    </div>
  );
}

/** The prompt. Centre stage first, then it lifts and becomes a header bar.
    It keeps its size on the way up — scaling it left the written block a
    different width from the field it came out of.

    WHERE IT SITS (owner, 2026-09-26: "the left side of the zoomed search bar
    is offset"). The box used to be laid out across the whole card and then
    slid half the rail's width left on lift. Its width came from the card, not
    from the column it lands in, so from 640 to ~870 px the zoomed field was
    wider than the card (its left end, "SCOPE", cut off by the frame) and
    below ~1050 px the lifted bar ran off the card's left edge (by 13 px at
    1024). Now the box
    is laid out in the column it lands in — the stage, i.e. the card minus
    the 260 px rail — so it can never be wider than that column, and at rest
    it slides half the rail's width RIGHT and zooms, which centres it on the
    card with the same margin each side at any width. Lifted, it sits in the
    stage column with the stage's own gutters, over the written lines.
    Every figure is a CSS variable set per breakpoint on the element, so the
    first frame is already right on a phone — the old JS `compact` flag was
    false for the first paint and the field shrank in from the desktop zoom
    each time a slide began. */
export function Prompt({
  label,
  value,
  lifted,
  attach,
  search,
}: {
  label: string;
  value: string;
  lifted: boolean;
  attach?: boolean;
  search?: boolean;
  /** Retired (2026-09-26): the breakpoint is read by the stylesheet now.
   *  Still accepted so an old caller compiles. */
  compact?: boolean;
}) {
  return (
    <div
      className="absolute left-0 right-0 z-20 px-3 [--prompt-dx:0px] [--prompt-top:74px] [--prompt-zoom:1] sm:right-[260px] sm:px-5 sm:[--prompt-dx:130px] sm:[--prompt-top:148px] sm:[--prompt-zoom:1.15]"
      style={{
        // The box sits at its rest position; the lift is a transform
        // (pass C, 2026-09-11) — nothing here animates a layout property.
        top: "var(--prompt-top)",
        transform: lifted
          ? "translate(0, calc(8px - var(--prompt-top))) scale(1)"
          : "translate(var(--prompt-dx), 0) scale(var(--prompt-zoom))",
        transformOrigin: "center top",
        transition: `transform .8s ${EASE}`,
      }}
    >
      <div
        className="relative mx-auto w-full max-w-[640px] rounded-[3px] border-2 bg-white"
        style={{
          borderColor: lifted ? HAIR : INK,
          boxShadow: lifted ? "none" : "0 18px 40px -18px rgba(10,10,10,.35)",
          transition: `border-color .6s ease, box-shadow .6s ease`,
        }}
      >
        {/* Sized for the column it sits in (owner, 2026-08-25): at phone width
            the desktop field filled a third of the stage and still truncated. */}
        <div className="flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-4 sm:py-3.5">
          <span className="shrink-0 font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-[#6a6a6a] sm:text-[10px]">
            {label}
          </span>
          {/* The caret rides the end of the TEXT. Flexing the value pushed it to
              the right edge of the field, so it read as a cursor parked in an
              empty box while the words appeared away from it. */}
          <span className="flex min-w-0 flex-1 items-center">
            <span className="truncate text-[11.5px] text-ink sm:text-[15px]">{value}</span>
            <span className="ml-[1px] inline-block h-[13px] w-[1.5px] shrink-0 bg-ink sm:h-[17px]" style={{ animation: "caret 1s step-end infinite" }} />
          </span>
          {search && (
            /* Stays put through the lift (owner, 2026-08-25): a search field
               that loses its magnifier mid-animation reads as a glitch. */
            <svg
              viewBox="0 0 24 24"
              className="h-[13px] w-[13px] shrink-0 text-[#6a6a6a] sm:h-[17px] sm:w-[17px]"
              aria-hidden
            >
              <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.2-4.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>
        {attach && (
          /* The attach row hangs under the field as its own bordered strip
             (pass C): it folds away with opacity and a transform instead of
             a max-height, so the lift never reflows. */
          <div
            className="absolute -inset-x-[2px] top-full rounded-b-[3px] border-2 border-t-0 bg-white"
            style={{
              borderColor: INK,
              opacity: lifted ? 0 : 1,
              transform: lifted ? "translateY(-8px) scaleY(0.6)" : "translateY(0) scaleY(1)",
              transformOrigin: "center top",
              pointerEvents: "none",
              transition: `opacity .35s ease, transform .5s ${EASE}`,
            }}
          >
            <div className="flex items-center gap-2 border-t px-2.5 py-1.5 sm:px-4 sm:py-2" style={{ borderColor: HAIR }}>
              <span className="flex items-center gap-1.5 rounded-[2px] border border-black/15 px-1.5 py-[3px] text-[9px] font-semibold text-ink-muted sm:px-2 sm:py-1 sm:text-[10.5px]">
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                  <path d="M10 4.5L5.8 8.7a2 2 0 102.8 2.8l4.2-4.2a3.5 3.5 0 10-5-5L3.2 6.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Attach photo
              </span>
              <span className="rounded-[2px] bg-lp-paper px-1.5 py-[3px] font-mono text-[8.5px] text-[#6a6a6a] sm:px-2 sm:py-1 sm:text-[10px]">kitchen-01.jpg</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Rail({ title, shown, children }: { title: string; shown: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`lp-est-rail overflow-hidden${shown ? " is-on" : ""}`}
      style={{
        // Nothing of the rail exists until the estimate does — including its
        // paper and its border, which used to sit there as a white slab
        // waiting for numbers.
        // Transitions live in the stylesheet — on a handheld the rail also has
        // to collapse its own height, and an inline transition here would win
        // over that rule and leave the height snapping.
        background: shown ? "#f2f0eb" : "transparent",
        opacity: shown ? 1 : 0,
        transform: shown ? "translateX(0)" : "translateX(18px)",
      }}
    >
      <div className="lp-rail-row text-[9px] font-black uppercase tracking-[0.18em] text-[#6a6a6a]">{title}</div>
      <div className="lp-rail-rows mt-3 space-y-2.5">{children}</div>
    </div>
  );
}

export function Stat({ k, v, accent, minor }: { k: string; v: string; accent?: boolean;
  /** A row a short rail can do without (2026-10-04): the stylesheet leaves
   *  it out of an ad landing's hero on a phone (landing-e.css, [data-minor]). */
  minor?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-black/[0.08] pb-2 last:border-0" data-minor={minor ? "" : undefined}>
      <span className="truncate text-[11px] text-ink-muted">{k}</span>
      <span className={`shrink-0 font-mono text-[12.5px] font-bold ${accent ? "" : "text-ink"}`} style={accent ? { color: BLUE } : undefined}>
        {v}
      </span>
    </div>
  );
}

export function TotalPlate({ total, note, play = true }: { total: string; note: string; play?: boolean }) {
  return (
    <div className="mt-4 rounded-[2px] bg-ink px-3 py-2.5">
      <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">{note}</div>
      {/* The total counts up once it is on screen (pass C, counter.tsx).
          `play` holds the count until the rail is actually shown — the rail
          keeps its room while hidden, so the count used to run unseen. */}
      <div className="mt-0.5 font-mono text-[19px] font-black text-white">{play ? <Counter value={total} /> : total}</div>
    </div>
  );
}

export function Beat({ delay, children }: { delay: number; children: React.ReactNode }) {
  return <div style={{ animation: `toast-in .45s ${EASE} ${delay}ms backwards` }}>{children}</div>;
}

export const STAGE = "lp-est-stage relative h-[286px] overflow-hidden sm:h-[430px]";

/* Both orthophoto stages draw on a 420×280 plan. The photo is object-cover, so
   percentages of the STAGE don't line up with it — the fence panels used to
   float ~38px off the boundary because of exactly that. PlanBox is a box with
   the plan's own aspect, full width and centred, i.e. the cover crop itself:
   inside it the photo, the SVG and any standing element share one grid. */
export function planBoxStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    position: "absolute",
    // --plan-inset / --plan-y are set per breakpoint in landing-e.css. On a
    // phone the plate is pushed wider than the stage so it fills the floor
    // instead of floating in it, and nudged below centre because the prompt
    // owns the top of the stage.
    left: "var(--plan-inset, 0px)",
    right: "var(--plan-inset, 0px)",
    top: "var(--plan-y, 50%)",
    aspectRatio: "420 / 280",
    ...extra,
  };
}

export const pctX = (x: number) => `${(x / 420) * 100}%`;
export const pctY = (y: number) => `${(y / 280) * 100}%`;
