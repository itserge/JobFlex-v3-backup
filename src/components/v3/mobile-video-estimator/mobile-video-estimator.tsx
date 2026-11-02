"use client";

// VIDEO ESTIMATOR · HANDHELD.  Route: /mobile-video-estimator-v1.
//
// A handheld re-cut of /dashboard/video-estimator — both of its steps: the
// walkthrough INTAKE (dark graph-paper screen + Job-ticket drawing stamp) and
// the RESULT sheet (ink masthead, frames, measurements, the two editable
// ledgers, the total, the shoppable materials request and the refine review
// gate). Fluid 320–768px. It is served at /mobile-video-estimator-v1 AND at
// /dashboard/video-estimator below 768px, through
// ../video-estimator-blueprint/video-estimator-viewport-switch.tsx.
//
// ── PARITY WITH THE DESKTOP RESULT SHEET (2026-08-22, fused 2026-09-02) ──
// The desktop sheet was rebuilt and this one follows it, feature for feature:
//   · ONE ledger of fused lines (lib/estimate/console-model): each row is a
//     task with a quantity, a unit, a material $/unit and a labor $/unit.
//     Material and labor are columns of every row, not two sections.
//   · Every field (name, qty, unit, material, labor) is editable in place with
//     a per-row delete, over ve.setLine / ve.removeLine / ve.addLine.
//   · No Materials request (owner, 2026-10-09): no store, link or picture on
//     an estimate.
//   · No "Save estimate": Convert writes the AiEstimate row itself.
// What is re-decided here is only the GEOMETRY; every value is the desktop's.
//
// Built with the jobflex-page-styler skill (visual system: the donor's tokens,
// palette, type scale, Motion System "Balanced") and the mobile-app-ui-design
// skill (structure: thumb-zone primary, ≥44px targets, one control per
// dimension). Where the two disagree the house system wins — hard 3px offset
// shadows with no blur, 2px radii, Inter 800–900 caps and JetBrains Mono for
// the drawing-annotation layer stay, rather than the mobile skill's
// soft-shadow / rounded-3xl defaults.
//
// ── NOTHING HERE IS A FIXTURE (rewired 2026-08-22) ─────────────────
// The demo data this page used to import is gone. The clip is a real file the
// contractor picks, the stills are pulled from it in the browser, the audio is
// transcribed, the reading is a model's and the estimate is priced by the Smart
// Proposal's own engine — so there ARE server calls behind this page, and
// "Convert to proposal" really writes one and opens it.
//
// ── WHERE THE LOGIC LIVES ──────────────────────────────────────────
// ../video-estimator-blueprint/use-video-estimator.ts owns the entire flow and
// is shared with the desktop page; this file is the HANDHELD RENDERING of it
// and holds no flow logic of its own. Two renderers of one contract cannot
// drift. ../video-estimator-blueprint/video-ingest.ts is the browser-side
// reading of the clip (probe, stills, audio). The questions the reading asks
// are put to the contractor by ./mobile-clarify-sheet.tsx — a BOTTOM SHEET
// here, where the desktop uses a centred dialog.
//
// ── STATE, NOT innerHTML ───────────────────────────────────────────
// A repaint is not a re-render: rebuilding a container's markup would steal
// focus from the field being typed in and replay the entrance animations
// inside it. There is also no MutationObserver anywhere — the stagger trap the
// page-styler skill documents.
//
// ── BOTH STEPS STAY MOUNTED, TOGGLED BY `hidden` ───────────────────
// Not conditional rendering: this is the donor's own `stepIntake.hidden` /
// `stepResult.hidden` mechanism, and it is what lets the reveal observer watch
// the result block before it is shown. It is also why the stylesheet declares
// `[hidden] { display: none !important }` — `.mve-prog` sets `display: flex`,
// which would otherwise beat Tailwind preflight's plain `[hidden]` rule on
// source order.
//
// ── CHROME ─────────────────────────────────────────────────────────
// The shared <MobileNav /> — dark topbar, slide-out drawer, icon sprite — as
// the first child of this page's own grid, the same arrangement the rest of the
// handheld fleet and the sibling mobile-job-detail-v1 use. This page still owns
// its `.mve-scroll` and `.mve-content`, because those carry the padding, the
// graph-paper parallax and the reveal cascade, and `.mve-content > *` is what
// the cascade measures.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { lineTotal, unitSelectOptions } from "@/lib/estimate/console-model";
import {
  VIDEO_ACCEPT,
  fmtClock,
} from "@/components/v3/video-estimator-blueprint/video-ingest";
import {
  money,
  useVideoEstimator,
} from "@/components/v3/video-estimator-blueprint/use-video-estimator";
import { BEHIND_LABEL } from "@/lib/estimate/video-schema";
import { MobileClarifySheet } from "./mobile-clarify-sheet";
import "./mobile-video-estimator.css";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Icons come from the shared MobileNav sprite mounted above. */
function Icon({ id }: { id: string }) {
  return (
    <svg className="mve-ic" aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function MobileVideoEstimator({
  ticketNo,
  aiEnabled,
}: {
  /** The org's next estimate number — what the ticket stamp prints. */
  ticketNo: number;
  /** OPENAI_API_KEY present; read on the server in the route. */
  aiEnabled: boolean;
}) {
  // The hook navigates after "Convert to proposal"; it has no React tree of its
  // own, so the router is handed down through a ref that is always current.
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const navigate = useCallback((href: string) => routerRef.current.push(href as Route), []);

  const ve = useVideoEstimator({ navigate, aiEnabled });

  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const intakeRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ---------- The file ----------------------------------------------------
     The plate and the "Add video" button both reach the same hidden input;
     picking the same file twice has to fire again, so the value is reset. */
  const openPicker = useCallback(() => fileRef.current?.click(), []);
  const takeFile = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void ve.pickFile(f);
  };

  /* ---------- Notes: the auto-growing field ------------------------------
     Height auto, then scrollHeight. Run on every value change rather than only
     on keystroke, so a programmatic reset re-measures too. */
  useEffect(() => {
    const ta = notesRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [ve.notes]);

  /* ---------- The step reveals and scrolls itself into view ---------------
     Both blocks are kept MOUNTED behind `hidden`, so the reveal observer below
     is already watching them; a hidden element never intersects, so the result
     sits at `mve-rv` opacity 0 until this runs — the donor's own explicit
     `rv` / `rv-in` add. The first pass is skipped so the initial screen keeps
     the entrance cascade's 60ms stagger instead of being revealed whole. */
  const shownStep = useRef(ve.step);
  useEffect(() => {
    // Compare against the step LAST ACTED ON, not a first-run flag: React's
    // StrictMode runs every effect twice on mount, and a flag that flipped on
    // the first pass let the second one through — which scrolled the intake
    // block to the top of the viewport on every load, before anyone had
    // tapped anything. Same step as last time means nothing to reveal.
    if (shownStep.current === ve.step) return;
    shownStep.current = ve.step;
    const el = ve.step === "result" ? resultRef.current : intakeRef.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    el.classList.add("mve-rv");
    const raf = requestAnimationFrame(() => el.classList.add("mve-rv-in"));
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    return () => cancelAnimationFrame(raf);
  }, [ve.step]);

  /* ---------- Motion: reveal on load / on scroll --------------------------
     The donor's Balanced reveal, at its own numbers: the initial screen's
     blocks cascade at 60ms; anything below the fold waits 200ms and gets a
     duration that follows scroll speed — slow ≈ 900ms, fast never shorter than
     550ms. Runs once, on `.mve-content`'s own children. */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const content = contentRef.current;
    const host = scrollRef.current;
    if (!content || !host) return;

    let lastY = host.scrollTop;
    let lastT = performance.now();
    let vel = 0; // px/ms
    const onScroll = () => {
      const now = performance.now();
      vel = Math.abs(host.scrollTop - lastY) / Math.max(1, now - lastT);
      lastY = host.scrollTop;
      lastT = now;
    };
    host.addEventListener("scroll", onScroll, { passive: true });

    const vpH = window.innerHeight;
    const blocks = Array.from(content.children) as HTMLElement[];
    blocks.forEach((el, i) => {
      el.classList.add("mve-rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${i * 60}ms` : "200ms";
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          if (t.dataset.rvScroll) {
            t.style.transitionDuration = `${Math.round(Math.max(550, 900 - vel * 160))}ms`;
          }
          t.classList.add("mve-rv-in");
          io.unobserve(t);
          // Inline delay/duration are cleared once the entrance is done, or
          // they would slow every later hover on the same element.
          const done = () => {
            t.style.transitionDelay = "";
            t.style.transitionDuration = "";
            t.removeEventListener("transitionend", done);
          };
          t.addEventListener("transitionend", done);
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      host.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ---------- Motion: graph-paper parallax (scrollTop × 0.06) ------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host.style.setProperty("--gy", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp, delegated from the root ----------------
     Delegated rather than bound to the controls that exist at mount: the whole
     result card, the review gate's Confirm / Discard and the questions sheet
     appear later, and a listener attached at mount would never reach them.

     `.mve-btn` only, matching the donor's `pressify('.btn', …)`. The play plate
     is deliberately excluded: it carries its own translate lift, and stacking
     the press scale on top of that fights it. */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".mve-btn");
    if (!el) return;
    el.classList.remove("mve-pressed");
    void el.offsetWidth;
    el.classList.add("mve-pressed");
  }, []);
  const onRootAnimEnd = useCallback((e: React.AnimationEvent) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains("mve-pressed")) el.classList.remove("mve-pressed");
  }, []);

  const audioNote =
    ve.audioState === "none"
      // "No audio" was a lie half the time: the state is also what a track with
      // no SPEECH in it comes back as — music, road noise, a hallucination the
      // route dropped. What the reading actually went without is the words.
      ? " · no speech heard"
      : ve.audioState === "failed"
        ? " · audio not transcribed"
        : ve.audioState === "partial"
          ? " · audio partly transcribed"
          : "";
  const locked = ve.saveState === "saving" || ve.saveState === "opening";

  /* ---------- The ledger, editable ---------------------------------------
     The desktop's numeric edit buffer, verbatim: raw text while a cell has
     focus, the model otherwise. Without it, clearing a field to retype it
     parses as 0 and the row's total flickers to $0 mid-keystroke. */
  const [field, setField] = useState<{ key: string; text: string } | null>(null);
  const cellValue = (key: string, n: number) => (field?.key === key ? field.text : String(n));
  type NumKey = "qty" | "materialPrice" | "laborPrice";
  const commitNumber = (id: string, k: NumKey, raw: string) => {
    const v = Number(raw);
    ve.setLine(id, { [k]: Number.isFinite(v) && v >= 0 ? v : 0 });
    setField(null);
  };
  /** A numeric cell: plain text with a decimal keyboard, never a native number
   *  spinner. */
  const numberCell = (l: (typeof ve.lines)[number], k: NumKey, extra: string, label: string) => {
    const key = `${l.id}:${k}`;
    return (
      <input
        className={`mve-in ${extra}`}
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={cellValue(key, l[k])}
        onFocus={() => setField({ key, text: String(l[k]) })}
        onChange={(e) => setField({ key, text: e.target.value })}
        onBlur={(e) => commitNumber(l.id, k, e.target.value)}
      />
    );
  };

  /** THE LEDGER — one section, one fused line per task (owner, 2026-09-02):
   *  material and labor are two $/unit columns of every row, not two ledgers.
   *
   *  THE ROW is where the geometry is re-decided. The desktop's seven columns
   *  (name · qty · unit · material · labor · total · delete) do not survive a
   *  320px measure, so the name takes its own line with the row total set right
   *  against it — the one figure a contractor reads without editing — qty, unit
   *  and delete share the line beneath, and the two prices share a third,
   *  each under a caption so a $/unit is never a bare figure. Every control is
   *  ≥44px and 16px, the iOS zoom floor. */
  const ledger = (
    <div className="mve-sec">
      <div className="mve-sec-bar">
        <div className="mve-sec-h">Line items</div>
        <b className="mve-sec-total">{money(ve.totals.subtotal)}</b>
      </div>

      {ve.lines.length === 0 ? (
        <div className="mve-none">No line items on this estimate.</div>
      ) : null}

      {ve.lines.map((l) => (
        <div
          className={`mve-row${l.badge === "Added" ? " mve-is-new" : ""}${
            l.badge === "Updated" ? " mve-is-upd" : ""
          }`}
          key={l.id}
        >
          <div className="mve-row-top">
            <input
              className="mve-rname"
              value={l.name}
              placeholder="Line item"
              aria-label="Line item"
              onChange={(e) => ve.setLine(l.id, { name: e.target.value })}
            />
            <span className="mve-row-t">{money(lineTotal(l))}</span>
          </div>
          <div className="mve-row-f">
            <label className="mve-f mve-f--qty">
              <span className="mve-fl">Qty</span>
              {numberCell(l, "qty", "mve-in--qty", "Quantity")}
            </label>
            {/* A real select, as the manual builder's line items have (owner,
                2026-09-02). The model's own unit is kept at the head of the
                list when it is not one of the house options, so switching the
                control never silently rewrites a line. */}
            <label className="mve-f mve-f--unit">
              <span className="mve-fl">Unit</span>
              <span className="mve-unit-wrap">
                <select
                  className="mve-unit"
                  aria-label="Unit"
                  value={l.unit}
                  onChange={(e) => ve.setLine(l.id, { unit: e.target.value })}
                >
                  {unitSelectOptions(l.unit).map((o) => (
                    <option value={o.value} key={o.value}>
                      {o.label || "unit"}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <button
              className="mve-row-x"
              type="button"
              aria-label={`Remove ${l.name || "line"}`}
              onClick={() => ve.removeLine(l.id)}
            >
              <Icon id="i-x" />
            </button>
          </div>
          <div className="mve-row-p">
            <label className="mve-f">
              <span className="mve-fl">Material $ / unit</span>
              {numberCell(l, "materialPrice", "mve-in--price", "Material price per unit")}
            </label>
            <label className="mve-f">
              <span className="mve-fl">Labor $ / unit</span>
              {numberCell(l, "laborPrice", "mve-in--price", "Labor price per unit")}
            </label>
          </div>
        </div>
      ))}

      <button className="mve-addline" type="button" onClick={ve.addLine}>
        <Icon id="i-plus" />
        Add line
      </button>
    </div>
  );

  return (
    <div
      className="jf-mobile-video-estimator"
      onClick={onRootClick}
      onAnimationEnd={onRootAnimEnd}
    >
      {/* Shared handheld chrome: dark topbar + slide-out drawer + icon sprite.
          It owns its own state and reads its token contract off this root. */}
      <MobileNav />

      <main className="mve-scroll" ref={scrollRef}>
        <div className="mve-content" ref={contentRef}>
          {/* ============ PAGE HEAD — shown in both steps ============ */}
          <div className="mve-head">
            <div className="mve-kick">Automation</div>
            <h1 className="mve-title">Video estimator</h1>
          </div>

          {/* ============ INTAKE · THE WALKTHROUGH SCREEN ============ */}
          <div className="mve-screen" ref={intakeRef} hidden={ve.step === "result"}>
            <span className="mve-crop mve-crop-tl" />
            <span className="mve-crop mve-crop-tr" />
            <span className="mve-crop mve-crop-bl" />
            <span className="mve-crop mve-crop-br" />

            {/* Outside both faces on purpose: the picker has to survive the
                swap from empty to loaded and back. */}
            {/* VISUALLY hidden, not `display: none` — a display:none file
                input is refused a picker by iOS Safari and several Android
                webviews, which is exactly where this build runs. */}
            <input
              ref={fileRef}
              type="file"
              accept={VIDEO_ACCEPT}
              className="mve-file"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                takeFile(e.target.files);
                e.target.value = "";
              }}
            />

            <div className="mve-empty" hidden={!!ve.file}>
              <button
                className="mve-play"
                type="button"
                aria-label="Add a walkthrough video"
                onClick={openPicker}
              >
                <i />
              </button>
              <div className="mve-empty-t">Add a walkthrough</div>
              <div className="mve-empty-m">
                MP4 / MOV &middot; up to 5 min &middot; say the measurements as you walk
              </div>
              <button
                className="mve-btn mve-btn-primary mve-add"
                type="button"
                onClick={openPicker}
                data-tour="video:add"
              >
                <Icon id="i-plus" />
                Add video
              </button>
            </div>

            <div className="mve-loaded" hidden={!ve.file}>
              <div className="mve-fileline">
                <Icon id="i-video" />
                <b>{ve.file?.name}</b>
                <button
                  className="mve-remove"
                  type="button"
                  onClick={ve.removeFile}
                  disabled={ve.busy}
                >
                  Remove
                </button>
                <span>{ve.fileMeta}</span>
              </div>
              {ve.framesDeferred ? (
                <div className="mve-defer" data-video-deferred>
                  This browser reads a clip from a tap only — the stills are pulled when you tap Analyze video.
                </div>
              ) : null}
              {/* preload="none": a second decoder on the clip while the still
                  pass runs is one more than a phone has to give — the first
                  still is the poster, and a tap loads the player. */}
              {ve.previewUrl ? (
                <video
                  className="mve-preview"
                  src={ve.previewUrl}
                  controls
                  muted
                  playsInline
                  preload="none"
                  poster={ve.stripFrames[0]?.dataUrl}
                />
              ) : null}
              {/* Real stills as they land; until then the cells wear the
                  hatch and count the extraction. */}
              <div className="mve-strip">
                {ve.stripFrames.length > 0
                  ? ve.stripFrames.map((f) => (
                      <div className="mve-cell" key={f.t}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.dataUrl} alt="" />
                        <span>{fmtClock(f.t)}</span>
                      </div>
                    ))
                  : [0, 1, 2, 3].map((i) => (
                      <div className="mve-cell mve-is-wait" key={i}>
                        <span>
                          {ve.framesProgress
                            ? `${ve.framesProgress.done} / ${ve.framesProgress.total}`
                            : "…"}
                        </span>
                      </div>
                    ))}
              </div>
            </div>
          </div>

          {/* ============ INTAKE · THE JOB TICKET ============ */}
          <div className="mve-tb" hidden={ve.step === "result"}>
            <div className="mve-tb-head">
              <span>Job ticket</span>
              <span className="mve-tb-no">&#8470; {ticketNo}</span>
            </div>

            <div className="mve-cells">
              <label className="mve-c mve-c--full">
                <span className="mve-c-l">Project</span>
                <input
                  className="mve-c-in"
                  type="text"
                  placeholder="Optional — read from the video if left blank"
                  value={ve.job}
                  onChange={(e) => ve.setJob(e.target.value)}
                  disabled={ve.busy}
                />
              </label>
              <label className="mve-c mve-c--full">
                <span className="mve-c-l">Address</span>
                <input
                  className="mve-c-in"
                  type="text"
                  placeholder="Street, city"
                  value={ve.addr}
                  onChange={(e) => ve.setAddr(e.target.value)}
                  disabled={ve.busy}
                />
              </label>
              {/* The two half cells. `mve-c--rule` is the donor's
                  `nth-child(odd of …)` right divider, made explicit. */}
              <div className="mve-c mve-c--rule">
                <span className="mve-c-l">Date</span>
                <b className="mve-c-v">{ve.today || " "}</b>
              </div>
              <div className="mve-c">
                <span className="mve-c-l">Source</span>
                <b className="mve-c-v">{ve.sourceLabel}</b>
              </div>
              <label className="mve-c mve-c--full">
                <span className="mve-c-l">Notes</span>
                <textarea
                  className="mve-c-in mve-c-ta"
                  ref={notesRef}
                  rows={1}
                  placeholder="Optional — anything the camera can't tell: material, finish, what to leave out"
                  value={ve.notes}
                  onChange={(e) => ve.setNotes(e.target.value)}
                  disabled={ve.busy}
                />
              </label>
            </div>
          </div>

          {/* ============ RESULT ============ */}
          <div className="mve-result" ref={resultRef} hidden={ve.step !== "result"}>
            <section className="mve-card">
              {/* No "Video estimate · ready" kicker and no confidence badge
                  (owner's call, 2026-08-28): the sheet being on screen IS the
                  ready state, and a percentage on a machine's own work reads as
                  a score for the estimate rather than what it is. */}
              <div className="mve-mast">
                <div className="mve-mast-min">
                  <h2 className="mve-mast-t">{ve.title}</h2>
                  <div className="mve-mast-s">
                    {ve.locationUsed || ve.addr.trim() || "Location not stated"} &middot; from{" "}
                    {ve.probe ? fmtClock(ve.probe.duration) : "—"} walkthrough{audioNote}
                  </div>
                </div>
              </div>

              {/* SCOPE — what the walkthrough said. The FRAME STRIP is gone
                  from the view (extraction still runs and still feeds the
                  model): it was a picture of the machine's working, and on a
                  phone it pushed the actual reading a screen and a half down. */}
              <div className="mve-sec">
                {ve.scope ? (
                  <>
                    <div className="mve-sec-h">Scope</div>
                    <p className="mve-scope">{ve.scope}</p>
                  </>
                ) : null}

                <div className={`mve-sec-h${ve.scope ? " mve-sec-h--gap" : ""}`}>Measured from video</div>
                {ve.analysis && ve.analysis.measurements.length > 0 ? (
                  <div className="mve-meas">
                    {ve.analysis.measurements.map((m, i) => (
                      <div className="mve-m" key={`${m.label}-${i}`}>
                        <span>{m.label}</span>
                        <b>
                          {m.value}
                          {m.unit ? ` ${m.unit}` : ""}
                        </b>
                        <i className="mve-m-tag" data-c={m.confidence}>
                          {m.source} &middot; {m.confidence}
                        </i>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mve-none">
                    Nothing measurable was said or visible — the estimate is priced on the scope
                    and assumptions.
                  </div>
                )}

                <div className="mve-sec-h mve-sec-h--gap">Site notes</div>
                {ve.analysis && ve.analysis.observations.length > 0 ? (
                  <ul className="mve-notes">
                    {ve.analysis.observations.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mve-none">Nothing noted on site.</div>
                )}

                {/* THE LOOK-AHEAD (owner, 2026-10-14): the work, what it brings
                    with it, the procedure — absent for a reading in the old shape. */}
                {ve.deep ? (
                  <div data-video-deep>
                    <div className="mve-sec-h mve-sec-h--gap">The work</div>
                    {ve.deep.work.length > 0 ? (
                      <ul className="mve-notes" data-video-work>
                        {ve.deep.work.map((w, i) => (
                          <li key={i}>
                            {w.what}
                            {w.where ? <span className="mve-dim"> — {w.where}</span> : null}
                            {w.detail ? <span className="mve-dim"> · {w.detail}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mve-none">No task list came back — the scope is the job.</div>
                    )}

                    <div className="mve-sec-h mve-sec-h--gap">What the work brings with it</div>
                    {ve.deep.behind.length > 0 ? (
                      <ul className="mve-notes mve-notes--behind" data-video-behind>
                        {ve.deep.behind.map((b, i) => (
                          <li key={i}>
                            <b>{b.item}</b>
                            {b.because ? <span className="mve-dim"> — {b.because}</span> : null}
                            <i className="mve-m-tag" data-h={b.handling}>
                              {BEHIND_LABEL[b.handling]}
                            </i>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mve-none">Nothing beyond the work itself.</div>
                    )}

                    <div className="mve-sec-h mve-sec-h--gap">Procedure</div>
                    {ve.deep.steps.length > 0 ? (
                      <ol className="mve-steps" data-video-steps>
                        {ve.deep.steps.map((s, i) => (
                          <li key={i}>
                            <b>{s.step}</b>
                            {s.materials ? <span>Materials: {s.materials}</span> : null}
                            {s.labor ? <span>Labor: {s.labor}</span> : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="mve-none">No step list came back.</div>
                    )}
                    {ve.deep.permits.length > 0 ? (
                      <>
                        <div className="mve-sec-h mve-sec-h--gap">Permits &amp; inspections</div>
                        <ul className="mve-notes" data-video-permits>
                          {ve.deep.permits.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="mve-sec-h mve-sec-h--gap">Assumptions</div>
                {ve.assumptions.length > 0 ? (
                  <ul className="mve-notes mve-notes--assume">
                    {ve.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mve-none">None taken.</div>
                )}
              </div>

            </section>

            {/* ── TOTALS, its own card. The one ledger of fused lines, then
                the column sums (Materials / Labor), the discount and the
                grand total closing the card. ── */}
            <section className="mve-card">
              {ledger}

              <div className="mve-sec mve-sec--tot">
                <div className="mve-line">
                  <b>Materials</b>
                  <span>{money(ve.totals.materials)}</span>
                </div>
                <div className="mve-line">
                  <b>Labor</b>
                  <span>{money(ve.totals.labor)}</span>
                </div>
                {ve.totals.discountCash > 0 ? (
                  <div className="mve-line">
                    <b>Discount</b>
                    <span>&minus;{money(ve.totals.discountCash)}</span>
                  </div>
                ) : null}
                <div className="mve-total">
                  <span>Total</span>
                  <b>{money(ve.totals.total)}</b>
                </div>
                {ve.pricing ? (
                  <p className="mve-company" data-ve-company>
                    Priced your company&rsquo;s way (Settings &rarr; Estimating): {ve.pricing.words}.
                    Sales tax goes on in the proposal.
                  </p>
                ) : null}
              </div>

              {/* No Materials request card under this one any more (owner,
                  2026-10-09): the estimate is not a shop list, so the bar
                  that closed that card closes the totals instead.
                  The donor's bar. The primary is in the thumb zone below, and
                  there is no "Save estimate" (owner, 2026-08-22): Convert
                  already writes the AiEstimate row before it creates the
                  proposal, so a separate save was a second name for a step that
                  always happened anyway. `ve.save` stays on the hook — Convert
                  calls it. Start over is the one destructive control on the
                  page and wears the status-badge danger treatment. */}
              <div className="mve-cardbar">
                <button
                  className="mve-btn mve-btn-danger"
                  type="button"
                  onClick={ve.startOver}
                  disabled={locked}
                >
                  Start over
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* ============ THE ACTION BAR — thumb zone ============ */}
      <div className="mve-bar">
        <div className="mve-bar-in">
          {/* `hidden`, not a conditional: the donor's own mechanism, and
              the reason the stylesheet needs the attribute selector. */}
          <div className="mve-prog" hidden={!ve.stage} aria-live="polite">
            <span className="mve-prog-dot" />
            <span>{ve.stageText}</span>
          </div>
          {/* The bar shows the failure line in BOTH steps, so a refine that
              failed needs a way off the screen that is not Start over. */}
          <div className="mve-err" hidden={!ve.error} role="alert">
            <span>{ve.error}</span>
            {ve.framesFailed ? (
              <button
                className="mve-btn mve-err-retry"
                type="button"
                onClick={ve.retryFrames}
                disabled={ve.busy || !!ve.framesProgress}
                data-video-retry
              >
                Retry
              </button>
            ) : null}
            <button
              className="mve-err-x"
              type="button"
              aria-label="Dismiss"
              onClick={ve.dismissError}
            >
              <Icon id="i-x" />
            </button>
          </div>
          {ve.step === "intake" ? (
            <button
              className="mve-btn mve-btn-primary mve-btn-block"
              type="button"
              disabled={!ve.canAnalyze}
              onClick={() => void ve.analyze()}
            >
              <Icon id="i-bulb" />
              Analyze video
            </button>
          ) : (
            <button
              className="mve-btn mve-btn-primary mve-btn-block"
              type="button"
              disabled={locked || ve.lines.length === 0}
              onClick={() => void ve.convert()}
            >
              <Icon id="i-arrow" />
              {ve.saveState === "opening" ? "Opening…" : "Convert to proposal"}
            </button>
          )}
        </div>
      </div>

      {/* The reading's questions, put to the contractor as a bottom sheet. */}
      {ve.clarify ? (
        <MobileClarifySheet questions={ve.clarify} onSettle={ve.settleClarify} />
      ) : null}
    </div>
  );
}
