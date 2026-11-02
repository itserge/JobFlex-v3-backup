"use client";

// VIDEO ESTIMATOR / BLUEPRINT — the page.
// Route: /dashboard/video-estimator.
//
// The donor `jobflex-videoestimator-blueprint.html`, ported value for value,
// and WIRED (2026-08-22): the clip is real, the frames are pulled from it, the
// audio is transcribed, the reading is a model's, and the estimate is priced
// by the Smart Proposal's own engine. Nothing on this page is a fixture any
// more — the ticket number is the org's next estimate, the date is today, the
// source line is the file's own length, and every figure in the result came
// back from a server call.
//
// ── WHERE THE LOGIC LIVES ──────────────────────────────────────────
// ./use-video-estimator.ts owns the whole flow and is shared with the handheld
// build; this file is the desktop RENDERING of it. ./video-ingest.ts is the
// browser-side reading of the clip (probe, stills, audio); actions/
// videoEstimator.ts is the model's reading of those; actions/advancedEstimator
// prices it. See the headers of each for the why.
//
// ── CHROME DROPPED ─────────────────────────────────────────────────
// The donor carries its own sidebar, topbar, sprite, `.layout`, `.main` and
// `.content`; blueprint-shell renders all of it from src/app/dashboard/
// layout.tsx and it persists across navigation. This component returns ONLY
// the donor's `.content` children, as a fragment, so they stay DIRECT children
// of `.content` — the reveal cascade walks `.content > *`.
//
// ── STATE, NOT innerHTML ───────────────────────────────────────────
// A repaint is not a re-render: rebuilding a container's markup would steal
// focus from the field being typed in and replay the entrance animations
// inside it. Both steps stay mounted, toggled by `hidden`, which is the donor's
// own `stepIntake.hidden` / `stepResult.hidden` mechanism and what lets the
// motion module's observer watch the result block before it is shown.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { lineTotal, unitSelectOptions } from "@/lib/estimate/console-model";
import { BlueprintSelect } from "@/components/v3/advanced-ai-blueprint/blueprint-select";
import { HoverTitle } from "@/components/v3/advanced-ai-blueprint/hover-title";
import { ClarifyDialog } from "./clarify-dialog";
import { VIDEO_ACCEPT, fmtClock } from "./video-ingest";
import { confidenceTone, money, useVideoEstimator } from "./use-video-estimator";
import { BEHIND_LABEL } from "@/lib/estimate/video-schema";
import { useVideoEstimatorMotion } from "./video-estimator-motion";
import s from "./video-estimator.module.css";
import "./video-estimator-global.css";

/** Hashed module class, or the literal name when the module has none — which is
 *  how the fleet's global `rv` / `rv-in` / `pressed` and this page's
 *  `vt-prog-dot` (a global, see the module header) pass through. */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => (s as Record<string, string>)[n as string] ?? (n as string))
    .join(" ");
}

export function VideoEstimatorContent({
  ticketNo,
  aiEnabled,
}: {
  /** The org's next estimate number — what the ticket stamp prints. */
  ticketNo: number;
  /** OPENAI_API_KEY present; read on the server in page.tsx. */
  aiEnabled: boolean;
}) {
  useVideoEstimatorMotion(s.btn);

  // The hook navigates after "Convert to proposal"; it has no React tree of its
  // own, so the router is handed down through a ref that is always current.
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const navigate = useCallback((href: string) => routerRef.current.push(href as Route), []);

  const ve = useVideoEstimator({ navigate, aiEnabled });

  const inputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const intakeRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);

  // ── NOTES: РАСШИРЯЮЩЕЕСЯ ПОЛЕ ────────────────────────────────────────────
  useEffect(() => {
    const ta = notesRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [ve.notes]);

  // Donor: after the swap, the result block reveals and scrolls itself into
  // view. Kept MOUNTED behind `hidden`, so the motion module's observer is
  // already watching it — this replays the donor's explicit `rv` / `rv-in` add
  // and the smooth scroll, and brings the intake back the same way.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = ve.step === "result" ? resultRef.current : intakeRef.current;
    if (!el) return;
    el.classList.add("rv");
    const raf = requestAnimationFrame(() => el.classList.add("rv-in"));
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    return () => cancelAnimationFrame(raf);
  }, [ve.step]);

  // ── ЭКРАН: THE FILE ──────────────────────────────────────────────────────
  const openPicker = () => inputRef.current?.click();
  const takeFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void ve.pickFile(f);
  };

  const conf = ve.analysis ? ve.analysis.confidence : null;
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

  // ── The ledger, editable ────────────────────────────────────────────────
  // Raw text while a numeric cell has focus, the model otherwise — the Smart
  // Proposal console's own buffer. Without it, clearing a field to retype it
  // parses as 0 and the row's total flickers to $0 mid-keystroke.
  const [field, setField] = useState<{ key: string; text: string } | null>(null);
  const cellValue = (key: string, n: number) => (field?.key === key ? field.text : String(n));
  type NumKey = "qty" | "materialPrice" | "laborPrice";
  const commitNumber = (id: string, k: NumKey, raw: string) => {
    const v = Number(raw);
    ve.setLine(id, { [k]: Number.isFinite(v) && v >= 0 ? v : 0 });
    setField(null);
  };
  /** A numeric cell: plain text with a decimal keyboard, never a native number
   *  spinner — `type="number"` draws OS arrows on a drawn sheet and eats a
   *  trailing "." while typing. */
  const numberCell = (l: (typeof ve.lines)[number], k: NumKey, extra: string, label: string) => {
    const key = `${l.id}:${k}`;
    return (
      <input
        className={cx("vr-in", extra)}
        type="text"
        inputMode="decimal"
        aria-label={`${l.name || "Line item"} — ${label}`}
        value={cellValue(key, l[k])}
        onFocus={() => setField({ key, text: String(l[k]) })}
        onChange={(e) => setField({ key, text: e.target.value })}
        onBlur={(e) => commitNumber(l.id, k, e.target.value)}
      />
    );
  };

  /** THE LEDGER — one section, one fused line per task (owner, 2026-09-02).
   *  Material and labor are two $/unit COLUMNS of every row, not two ledgers:
   *  the client reads "Install 6 ft cedar fence · 120 lf" once, with what the
   *  materials and the labor for those 120 lf each cost beside it. */
  const ledger = (
    <section className={cx("vr-sec")}>
      <div className={cx("vr-sec-bar")}>
        <div className={cx("vr-sec-h")}>Line items</div>
        <b className={cx("vr-sec-total")}>{money(ve.totals.subtotal)}</b>
      </div>

      {/* One header cell per grid track, so each label sits over the field it
          names — Qty over the qty input, Unit over the select. */}
      <div className={cx("vr-thead")}>
        <span>Item</span>
        <span>Qty</span>
        <span className={cx("vr-th--l")}>Unit</span>
        <span>Material</span>
        <span>Labor</span>
        <span>Total</span>
        <span />
      </div>

      {ve.lines.length === 0 ? (
        <div className={cx("vr-none")}>No line items on this estimate.</div>
      ) : null}

      {ve.lines.map((l) => (
        <div
          className={cx(
            "vr-row",
            l.badge === "Added" && "is-new",
            l.badge === "Updated" && "is-upd",
          )}
          key={l.id}
        >
          {/* Product names run past the column; the plate shows the whole
              string at the cursor when — and only when — the field clips it. */}
          <HoverTitle text={l.name}>
            <input
              className={cx("vr-name")}
              value={l.name}
              placeholder="Line item"
              aria-label="Line item"
              onChange={(e) => ve.setLine(l.id, { name: e.target.value })}
            />
          </HoverTitle>
          {numberCell(l, "qty", "vr-in--qty", "quantity")}
          {/* The manual builder's unit picker, drawn: the ten house units
              (console-model ESTIMATE_UNITS), with the model's own unit kept
              at the head of the list when it is not one of them, so
              switching the control never silently rewrites a line. */}
          <BlueprintSelect
            value={l.unit}
            onChange={(unit) => ve.setLine(l.id, { unit })}
            options={unitSelectOptions(l.unit)}
            placeholder="unit"
            ariaLabel={`${l.name || "Line item"} — unit`}
            triggerClass="vr-unit"
            styles={s}
          />
          {numberCell(l, "materialPrice", "vr-in--mat", "material $ per unit")}
          {numberCell(l, "laborPrice", "vr-in--lab", "labor $ per unit")}
          <span className={cx("vr-row-t")}>{money(lineTotal(l))}</span>
          <button
            className={cx("vr-row-x")}
            type="button"
            aria-label={`Remove ${l.name || "line"}`}
            onClick={() => ve.removeLine(l.id)}
          >
            <svg className={cx("ic")}>
              <use href="#i-x" />
            </svg>
          </button>
        </div>
      ))}

      <button className={cx("vr-add")} type="button" onClick={ve.addLine}>
        <svg className={cx("ic")}>
          <use href="#i-plus" />
        </svg>
        Add line
      </button>
    </section>
  );

  return (
    <>
      <div className={cx("page-head", "rv")}>
        <div>
          <div className={cx("kicker")}>Automation</div>
          <h1 className={cx("page-title")}>Video estimator</h1>
        </div>
      </div>

      {/* ─── ЗАГОЛОВОЧНЫЙ СТЕК ─── */}
      <div className={cx("vt", "rv")} ref={intakeRef} hidden={ve.step === "result"}>
        {/* Просмотровый экран — the drop target */}
        <div
          className={cx("vt-screen", drag && "is-drag")}
          onDragEnter={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!drag) setDrag(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            takeFiles(e.dataTransfer.files);
          }}
        >
          <span className={cx("vt-crop", "tl")}></span>
          <span className={cx("vt-crop", "tr")}></span>
          <span className={cx("vt-crop", "bl")}></span>
          <span className={cx("vt-crop", "br")}></span>

          {/* VISUALLY hidden, not `display: none`. This module carries a
              `[hidden] { display: none !important }` rule, and a file input
              that is display:none is refused a picker by iOS Safari and
              several Android webviews — the click lands and nothing opens.
              Same off-screen pattern the Smart Proposal's photo input uses. */}
          <input
            ref={inputRef}
            type="file"
            accept={VIDEO_ACCEPT}
            className={cx("vt-file")}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              takeFiles(e.target.files);
              // Picking the same file twice must fire again.
              e.target.value = "";
            }}
          />

          <div className={cx("vt-empty")} hidden={!!ve.file}>
            <button
              className={cx("vt-play")}
              type="button"
              aria-label="Add a walkthrough video"
              onClick={openPicker}
            >
              <svg className={cx("ic", "vt-play-ic")}>
                <use href="#i-video" />
              </svg>
            </button>
            <div className={cx("vt-empty-t")}>{drag ? "Drop to add" : "Drop a walkthrough"}</div>
            <div className={cx("vt-empty-m")}>MP4 / MOV &middot; up to 5 min &middot; say the measurements as you walk</div>
            <button className={cx("btn", "btn-primary", "vt-add")} type="button" onClick={openPicker} data-tour="video:add">
              <svg className={cx("ic")}>
                <use href="#i-plus" />
              </svg>
              Add video
            </button>
          </div>

          <div className={cx("vt-loaded")} hidden={!ve.file}>
            <div className={cx("vt-fileline")}>
              <svg className={cx("ic")}>
                <use href="#i-video" />
              </svg>
              <b>{ve.file?.name}</b>
              <span>{ve.fileMeta}</span>
              <button
                className={cx("vt-remove")}
                type="button"
                onClick={ve.removeFile}
                disabled={ve.busy}
              >
                Remove
              </button>
            </div>
            {ve.framesDeferred ? (
              <div className={cx("vt-defer")} data-video-deferred>
                This browser reads a clip from a tap only — the stills are pulled when you tap Analyze video.
              </div>
            ) : null}
            {/* preload="none": a second decoder on the clip while the still pass
                runs is one more than a phone has to give — the first still is
                the poster, and a tap loads the player. */}
            {ve.previewUrl ? (
              <video
                className={cx("vt-preview")}
                src={ve.previewUrl}
                controls
                muted
                playsInline
                preload="none"
                poster={ve.stripFrames[0]?.dataUrl}
              />
            ) : null}
            <div className={cx("vt-strip")}>
              {ve.stripFrames.length > 0
                ? ve.stripFrames.map((f) => (
                    <div className={cx("vt-cell")} key={f.t}>
                      {/* A data: URL the browser rendered a moment ago — next/image has nothing to optimise. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.dataUrl} alt="" />
                      <span>{fmtClock(f.t)}</span>
                    </div>
                  ))
                : [0, 1, 2, 3].map((i) => (
                    <div className={cx("vt-cell", "is-wait")} key={i}>
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

        {/* Титульный блок — чертёжный штамп */}
        <div className={cx("vt-tb")}>
          <div className={cx("vt-tb-head")}>
            <span>Job ticket</span>
            <span className={cx("vt-tb-no")}>&#8470; {ticketNo}</span>
          </div>

          <div className={cx("vt-cells")}>
            <label className={cx("vt-c", "vt-c--full")}>
              <span className={cx("vt-c-l")}>Project</span>
              <input
                className={cx("vt-c-in")}
                type="text"
                placeholder="Optional — read from the video if left blank"
                value={ve.job}
                onChange={(e) => ve.setJob(e.target.value)}
                disabled={ve.busy}
              />
            </label>
            <label className={cx("vt-c", "vt-c--full")}>
              <span className={cx("vt-c-l")}>Address</span>
              <input
                className={cx("vt-c-in")}
                type="text"
                placeholder="Street, city"
                value={ve.addr}
                onChange={(e) => ve.setAddr(e.target.value)}
                disabled={ve.busy}
              />
            </label>
            <div className={cx("vt-c")}>
              <span className={cx("vt-c-l")}>Date</span>
              <b className={cx("vt-c-v")}>{ve.today || " "}</b>
            </div>
            <div className={cx("vt-c")}>
              <span className={cx("vt-c-l")}>Source</span>
              <b className={cx("vt-c-v")}>{ve.sourceLabel}</b>
            </div>
            <label className={cx("vt-c", "vt-c--full")}>
              <span className={cx("vt-c-l")}>Notes</span>
              <textarea
                className={cx("vt-c-in", "vt-c-ta")}
                ref={notesRef}
                rows={1}
                placeholder="Optional — anything the camera can't tell: material, finish, what to leave out"
                value={ve.notes}
                onChange={(e) => ve.setNotes(e.target.value)}
                disabled={ve.busy}
              />
            </label>
          </div>

          <div className={cx("vt-tb-foot")}>
            <div className={cx("vt-prog")} hidden={!ve.stage}>
              <span className="vt-prog-dot"></span>
              <span>{ve.stageText}</span>
            </div>
            <div className={cx("vt-err")} hidden={!ve.error} role="alert">
              <span>{ve.error}</span>
              {ve.framesFailed ? (
                <button
                  className={cx("btn", "vt-err-retry")}
                  type="button"
                  onClick={ve.retryFrames}
                  disabled={ve.busy || !!ve.framesProgress}
                  data-video-retry
                >
                  Retry
                </button>
              ) : null}
              <button
                className={cx("vt-err-x")}
                type="button"
                aria-label="Dismiss"
                onClick={ve.dismissError}
              >
                <svg className={cx("ic")}>
                  <use href="#i-x" />
                </svg>
              </button>
            </div>
            <button
              className={cx("btn", "btn-primary", "vt-go")}
              type="button"
              disabled={!ve.canAnalyze}
              onClick={() => void ve.analyze()}
            >
              <svg className={cx("ic")}>
                <use href="#i-bulb" />
              </svg>
              Analyze video
            </button>
          </div>
        </div>
      </div>

      {/* ─── РЕЗУЛЬТАТ ───
          THREE CARDS, ONE JOB EACH (owner's call, 2026-08-28):
            1. SCOPE     — everything the walkthrough said: the paragraph, then
                           measurements, site notes and assumptions side by side
                           in ONE row.
            2. TOTALS    — the ledger and the figure, on their own full width.
                           They used to share a row with the read-out column,
                           which is what squeezed the total into a corner.
            3. MATERIALS — the shoppable list, its own card.
          The FRAMES STRIP is gone from the view. Frame extraction still runs
          and still feeds the model (ve.framesRead is untouched) — it was a
          picture of the machine's working, not of the job.
          The per-section "change the materials…" box and its review gate are
          gone with it: refining by sentence is still on the hook, but it is not
          on this sheet. */}
      <div className={cx("step-result")} ref={resultRef} hidden={ve.step !== "result"}>
        <section className={cx("card", "card--flush")}>
          <div className={cx("vr-mast")}>
            <div className={cx("vr-mast-min")}>
              <div className={cx("vr-mast-k")}>Video estimate &middot; ready</div>
              <h2 className={cx("vr-mast-t")}>{ve.title}</h2>
              <div className={cx("vr-mast-s")}>
                {ve.locationUsed || ve.addr.trim() || "Location not stated"} &middot; from{" "}
                {ve.probe ? fmtClock(ve.probe.duration) : "—"} walkthrough{audioNote}
              </div>
            </div>
            {conf !== null ? (
              <span className={cx("vr-conf", `vr-conf--${confidenceTone(conf)}`)}>
                Confidence {conf}%
              </span>
            ) : null}
          </div>

          <div className={cx("vr-body")}>
            {ve.scope ? <p className={cx("vr-scope")}>{ve.scope}</p> : null}

            {/* One row: what was measured, what was noticed, what was assumed. */}
            <div className={cx("vr-facts")}>
              <div className={cx("vr-fact")}>
                <div className={cx("vr-sec-h")}>Measured from video</div>
                {ve.analysis && ve.analysis.measurements.length > 0 ? (
                  <div className={cx("vr-meas")}>
                    {ve.analysis.measurements.map((m, i) => (
                      <div className={cx("vr-m")} key={`${m.label}-${i}`}>
                        <span>{m.label}</span>
                        <b>
                          {m.value}
                          {m.unit ? ` ${m.unit}` : ""}
                        </b>
                        <i className={cx("vr-m-tag")} data-c={m.confidence}>
                          {m.source} &middot; {m.confidence}
                        </i>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={cx("vr-none")}>
                    Nothing measurable was said or visible — priced on the scope and assumptions.
                  </div>
                )}
              </div>

              <div className={cx("vr-fact")}>
                <div className={cx("vr-sec-h")}>Site notes</div>
                {ve.analysis && ve.analysis.observations.length > 0 ? (
                  <ul className={cx("vr-notes")}>
                    {ve.analysis.observations.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                ) : (
                  <div className={cx("vr-none")}>Nothing noted on site.</div>
                )}
              </div>

              <div className={cx("vr-fact")}>
                <div className={cx("vr-sec-h")}>Assumptions</div>
                {ve.assumptions.length > 0 ? (
                  <ul className={cx("vr-notes", "vr-notes--assume")}>
                    {ve.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  <div className={cx("vr-none")}>None taken.</div>
                )}
              </div>
            </div>

            {/* THE LOOK-AHEAD (owner, 2026-10-14): the work list, what each task
                brings with it, and the procedure — the reading the planner priced
                from, shown so the contractor sees the sink AND the shutoffs under
                it. Absent entirely for a reading in the old shape. */}
            {ve.deep ? (
              <div className={cx("vr-deep")} data-video-deep>
                <div className={cx("vr-fact")}>
                  <div className={cx("vr-sec-h")}>The work</div>
                  {ve.deep.work.length > 0 ? (
                    <ul className={cx("vr-notes")} data-video-work>
                      {ve.deep.work.map((w, i) => (
                        <li key={i}>
                          {w.what}
                          {w.where ? <span className={cx("vr-dim")}> — {w.where}</span> : null}
                          {w.detail ? <span className={cx("vr-dim")}> · {w.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={cx("vr-none")}>No task list came back — the scope above is the job.</div>
                  )}

                  <div className={cx("vr-sec-h", "vr-sec-h--gap")}>What the work brings with it</div>
                  {ve.deep.behind.length > 0 ? (
                    <ul className={cx("vr-notes", "vr-notes--behind")} data-video-behind>
                      {ve.deep.behind.map((b, i) => (
                        <li key={i}>
                          <b>{b.item}</b>
                          {b.because ? <span className={cx("vr-dim")}> — {b.because}</span> : null}
                          <i className={cx("vr-m-tag")} data-h={b.handling}>
                            {BEHIND_LABEL[b.handling]}
                          </i>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={cx("vr-none")}>Nothing beyond the work itself.</div>
                  )}
                </div>

                <div className={cx("vr-fact")}>
                  <div className={cx("vr-sec-h")}>Procedure</div>
                  {ve.deep.steps.length > 0 ? (
                    <ol className={cx("vr-steps")} data-video-steps>
                      {ve.deep.steps.map((s, i) => (
                        <li key={i}>
                          <b>{s.step}</b>
                          {s.materials ? <span>Materials: {s.materials}</span> : null}
                          {s.labor ? <span>Labor: {s.labor}</span> : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className={cx("vr-none")}>No step list came back.</div>
                  )}
                  {ve.deep.permits.length > 0 ? (
                    <>
                      <div className={cx("vr-sec-h", "vr-sec-h--gap")}>Permits &amp; inspections</div>
                      <ul className={cx("vr-notes")} data-video-permits>
                        {ve.deep.permits.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ── TOTALS ── */}
        <section className={cx("card", "card--flush", "vr-card")}>
          <div className={cx("vr-body")}>
            {ledger}

            {/* The money chain, from console-model computeTotals: the two
                column sums, then the discount, then the figure. */}
            <div className={cx("vr-sums")}>
              <div className={cx("vr-line")}>
                <b>Materials</b>
                <span>{money(ve.totals.materials)}</span>
              </div>
              <div className={cx("vr-line")}>
                <b>Labor</b>
                <span>{money(ve.totals.labor)}</span>
              </div>
              {ve.totals.discountCash > 0 ? (
                <div className={cx("vr-line")}>
                  <b>Discount</b>
                  <span>&minus;{money(ve.totals.discountCash)}</span>
                </div>
              ) : null}
              <div className={cx("vr-total")}>
                <span>Total</span>
                <b>{money(ve.totals.total)}</b>
              </div>
              {ve.pricing ? (
                <p className={cx("vr-company")} data-ve-company>
                  Priced your company&rsquo;s way (Settings &rarr; Estimating): {ve.pricing.words}.
                  Sales tax goes on in the proposal.
                </p>
              ) : null}
            </div>
          </div>

          {/* The page's own bar, closing the totals. It closed a Materials
              request card until 2026-10-09, when the owner took that card out:
              the estimate is not a shop list, and store products — some of
              them wrong — embarrassed the contractor in front of the client. */}
          <div className={cx("vr-bar")}>
            <button
              className={cx("btn", "btn-danger")}
              type="button"
              onClick={ve.startOver}
              disabled={locked}
            >
              Start over
            </button>
            <div className={cx("vr-bar-r")}>
              {/* No "Save estimate" button (owner, 2026-08-22): Convert already
                  writes the AiEstimate row before it creates the proposal, so a
                  separate save was a second name for a step that always
                  happened anyway. `ve.save` stays on the hook — Convert calls
                  it. */}
              <button
                className={cx("btn", "btn-primary")}
                type="button"
                onClick={() => void ve.convert()}
                disabled={locked || ve.lines.length === 0}
              >
                <svg className={cx("ic")}>
                  <use href="#i-arrow" />
                </svg>
                {ve.saveState === "opening"
                  ? "Opening…"
                  : ve.saveState === "saving"
                    ? "Saving…"
                    : "Convert to proposal"}
              </button>
            </div>
          </div>
        </section>
      </div>


      {ve.clarify ? <ClarifyDialog questions={ve.clarify} onSettle={ve.settleClarify} cx={cx} /> : null}
    </>
  );
}
