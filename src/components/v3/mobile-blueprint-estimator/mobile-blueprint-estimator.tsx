"use client";
// BLUEPRINT ESTIMATOR · HANDHELD — /mobile-blueprint-estimator-v1 (2026-10-20)
//
// The desk estimator (/dashboard/blueprint-estimator, untouched by this route) composed for a phone: the shared
// MobileNav on top, one scrolling column, and a foot in the thumb zone that carries the stage's one next step —
// "Estimate it" on the question, the total and "Create proposal" on the answer. The SAME estimator: the state, the
// reading, the ask, the pricing, the retry and the proposal all come from blueprint-estimator/use-blueprint-estimator,
// so the phone calls exactly the actions and the /api/estimator/plan-price route the desk calls.
//
//   1 · Upload   the desk's look, fitted to the phone (owner: the upload stays as it is)
//   2 · Ask      the question first, the plan set under it (thumbs on one swiped rail), "Estimate it" in the foot
//   3 · Work     one raised card: the request, the step and its percent, the bar, the four steps, a red Cancel —
//                nothing written under the bars (owner, 2026-10-20)
//   4 · Result   the total on a blue plate, then one framed switch: Estimate | Found on your plans; the
//                total and Create proposal stay in the foot
//
// Every sheet opens in a bottom sheet (swipe down, the scrim, Close or Escape).
// Styles: mobile-blueprint-estimator.css — a plain stylesheet under `.jf-mblueprint`, not a module.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { WorkSquare } from "@/components/v3/estimators-blueprint/work-square";
import { ASKS, clockText, money, PRICING_STEP, qtyText, SIZE_ASKS, UNIT_SHORT, useBlueprintEstimator, workProgress } from "@/components/v3/blueprint-estimator/use-blueprint-estimator";
import { MeasureReportView } from "@/components/v3/blueprint-estimator/measure-report";
import { MaterialsView } from "@/components/v3/blueprint-estimator/materials-view";
import { MATERIAL_TOPICS } from "@/lib/plans/materialsReport";
import type { PlanHvacLoad } from "@/lib/plans/hvacEnvelope";
import { MAX_PLAN_PAGES } from "@/lib/plans/pdfClient";
import { TRADE_LABEL } from "@/lib/plans/takeoff";
import { buildListCsv, downloadText, SOURCE_LABEL } from "@/lib/plans/csv";
import { isBilled, lineTotal } from "@/lib/estimate/console-model";
import { DictateButton, MicIcon } from "@/components/estimator/DictateButton";
import "./mobile-blueprint-estimator.css";

/** "Edit in Smart Proposal" lands on the phone's Smart Proposal, which reads the same handoff (lib/plans/handoff). */
const SMART_PROPOSAL = "/mobile-advanced-ai-v2";

function Ic({ id, className = "mbe-ic" }: { id: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function MobileBlueprintEstimator() {
  const {
    stage, setStage, opening, pages, skipped, readTotal, readDone, ready, request, setRequest, locEdit, setLocEdit,
    step, pricing, working, result, lines, saving, retrying, viewer, setViewer, err, setErr, planName, planAddress,
    billed, total, setQty, removeLine, acceptLine, openFiles, runAsk, retryTrade, createProposal, editInSmartProposal,
    openViewer, startOver, cancelWork, kindOf,
    mode, setMode, sizes, runMeasure, workSteps,
    mats, materials, runMaterials, setDeckSize, editMeasure, extraPct, setExtraPct, reads,
  } = useBlueprintEstimator({ smartProposalHref: SMART_PROPOSAL });
  const [drag, setDrag] = useState(false);
  // The open half of the answer, for this answer only: a new answer opens on its estimate.
  const [tabOf, setTabOf] = useState<{ scope: object | null; tab: "estimate" | "found" }>({ scope: null, tab: "estimate" });
  const tab = result && tabOf.scope === result.scope ? tabOf.tab : "estimate";
  const [zoom, setZoom] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backFocus = useRef<HTMLElement | null>(null);

  // A new stage starts at the top of the page.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [stage]);

  // ── the sheet viewer: a bottom sheet ──
  const closeViewer = () => {
    setViewer(null);
    setZoom(false);
    const back = backFocus.current;
    backFocus.current = null;
    if (back) requestAnimationFrame(() => back.focus());
  };
  const sheetDrag = useSheetDrag(viewer != null, closeViewer);
  const openSheet = (page: number) => {
    if (document.activeElement instanceof HTMLElement) backFocus.current = document.activeElement;
    setZoom(false);
    void openViewer(page);
  };
  const viewerOpen = viewer != null;
  useEffect(() => {
    if (!viewerOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current?.click();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewerOpen]);

  const switchTab = (next: "estimate" | "found") => {
    setTabOf({ scope: result?.scope ?? null, tab: next });
    const scroller = scrollRef.current;
    const bar = tabsRef.current;
    if (scroller && bar && scroller.scrollTop > bar.offsetTop) scroller.scrollTo({ top: bar.offsetTop });
  };

  const chooser = (
    <input
      ref={fileInput}
      type="file"
      accept="application/pdf,.pdf,image/*"
      multiple
      hidden
      onChange={(e) => {
        const list = Array.from(e.target.files ?? []);
        e.target.value = "";
        void openFiles(list);
      }}
    />
  );

  const head = (title: string, sub?: string | null, entity = false) => (
    <header className="mbe-head">
      <h1 className={`mbe-title${entity ? " mbe-title--entity" : ""}`}>{title}</h1>
      {sub ? <p className="mbe-sub">{sub}</p> : null}
    </header>
  );

  const errEl = err ? (
    <div className="mbe-err" role="alert">
      {err}
    </div>
  ) : null;

  const viewerEl = viewer && (
    <div className="mbe-layer">
      <div className="mbe-scrim" onClick={closeViewer} aria-hidden="true" />
      <div className="mbe-sheet" role="dialog" aria-modal="true" aria-label={`Sheet ${viewer.page}`} {...sheetDrag.sheetProps}>
        <div className="mbe-sheet-grab" {...sheetDrag.handleProps} aria-hidden="true" />
        <div className="mbe-sheet-head" {...sheetDrag.handleProps}>
          <b className="mbe-sheet-title">
            Sheet {viewer.page} · {kindOf(viewer.page)}
          </b>
          {viewer.url && (
            <button type="button" className="mbe-btn mbe-btn--ghost mbe-btn--sm" aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>
              <Ic id={zoom ? "i-grid" : "i-search"} />
              {zoom ? "Fit" : "Zoom"}
            </button>
          )}
          <button ref={closeRef} type="button" className="mbe-btn mbe-btn--ghost mbe-btn--sm" onClick={closeViewer}>
            Close
          </button>
        </div>
        <div className={`mbe-sheet-body${zoom ? " is-zoom" : ""}`}>
          {viewer.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, a data URL
            <img className="mbe-sheet-img" src={viewer.url} alt={`Sheet ${viewer.page}`} />
          ) : (
            <div className="mbe-sheet-wait">Opening the sheet…</div>
          )}
        </div>
      </div>
    </div>
  );

  let body: ReactNode = null;
  let foot: ReactNode = null;

  // 1 · upload — the desk's upload, fitted to the phone.
  if (stage === "upload") {
    body = (
      <>
        {head("Blueprint estimator")}
        <section
          className={`mbe-card mbe-drop${drag ? " is-on" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void openFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <Ic id="i-plans" className="mbe-drop-ic" />
          <h2 className="mbe-drop-h">{opening != null ? `Opening the plans · ${opening} page${opening === 1 ? "" : "s"}` : "Drop the plan set here"}</h2>
          <p className="mbe-p">A PDF of the plans, or photos of the sheets — up to {MAX_PLAN_PAGES} pages.</p>
          <button type="button" className="mbe-btn mbe-btn--primary mbe-btn--wide" disabled={opening != null} aria-busy={opening != null} onClick={() => fileInput.current?.click()} data-tour="blueprint:upload">
            {opening != null ? "Opening…" : "Choose the plans"}
          </button>
          {errEl}
        </section>
        <ol className="mbe-how">
          <li>
            <span className="mbe-how-n">1</span>
            <b>Upload the plans</b>
            <span>They open in seconds — no waiting on the reading.</span>
          </li>
          <li>
            <span className="mbe-how-n">2</span>
            <b>Ask for the job</b>
            <span>Type it or say it: &ldquo;granite countertops&rdquo;, &ldquo;drywall with texture and paint&rdquo;.</span>
          </li>
          <li>
            <span className="mbe-how-n">3</span>
            <b>Get it measured and priced</b>
            <span>Every number from the sheets, with its page — then one tap to a proposal.</span>
          </li>
        </ol>
      </>
    );
  }

  // 2 · ask — the question first; the plan set under it.
  else if (stage === "ask") {
    const fileName = pages[0]?.fileName ?? "Plans";
    const canAsk = request.trim().length >= 2;
    body = (
      <>
        {head(planName || "What do you want from these plans?", planAddress, true)}
        <section className="mbe-card mbe-ask" aria-labelledby="mbe-ask-h">
          {/* An estimate, or the sizes alone (owner, 2026-10-21). */}
          <div className="mbe-modes" role="tablist" aria-label="What you want from the plans">
            <button type="button" role="tab" aria-selected={mode === "estimate"} className={`mbe-mode${mode === "estimate" ? " is-on" : ""}`} onClick={() => setMode("estimate")} data-be-mode="estimate">
              Estimate a job
            </button>
            <button type="button" role="tab" aria-selected={mode === "sizes"} className={`mbe-mode${mode === "sizes" ? " is-on" : ""}`} onClick={() => setMode("sizes")} data-be-mode="sizes">
              Sizes &amp; measurements
            </button>
            <button type="button" role="tab" aria-selected={mode === "materials"} className={`mbe-mode${mode === "materials" ? " is-on" : ""}`} onClick={() => setMode("materials")} data-be-mode="materials">
              Materials
            </button>
          </div>
          {mode === "materials" ? (
            <>
              <h2 className="mbe-h2" id="mbe-ask-h">
                What materials do you need?
              </h2>
              <p className="mbe-p">Everything to buy, in the units it is sold in, worked out from the plans. Tap a trade, or say the job.</p>
              <div className="mbe-chips" role="group" aria-label="Trades">
                {MATERIAL_TOPICS.map((t) => (
                  <button key={t.key} type="button" className="mbe-chip" onClick={() => void runMaterials(null, t.key)} data-be-material={t.key}>
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                className="mbe-area"
                aria-label="What materials do you need from these plans?"
                placeholder="Or say the job — drywall for the garage only, a 16x20 composite deck 4 ft high…"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                data-be-materials-ask
              />
              <DictateButton
                id="blueprintMaterialsDictate"
                label="Speak it"
                value={request}
                onChange={setRequest}
                wrapClassName="mbe-dictate"
                buttonClassName="mbe-btn mbe-btn--ghost mbe-btn--wide"
                onClassName="is-listening"
                noteClassName="mbe-dictate-note"
                icon={<MicIcon className="mbe-ic" />}
              />
              {mats ? (
                <button type="button" className="mbe-btn mbe-btn--ghost mbe-btn--wide" onClick={() => setStage("materials")}>
                  Back to the materials
                </button>
              ) : null}
              {errEl}
            </>
          ) : mode === "sizes" ? (
            <>
              <h2 className="mbe-h2" id="mbe-ask-h">
                What do you want measured?
              </h2>
              <p className="mbe-p">Every room by name with its size and square feet, the floors, walls, roof, windows and doors — each with its sheet, ready as a PDF.</p>
              <div className="mbe-chips" role="group" aria-label="Parts of the house">
                {SIZE_ASKS.map((a) => (
                  <button key={a.label} type="button" className="mbe-chip" onClick={() => void runMeasure(null, a.focus)} data-be-size={a.focus ?? "all"}>
                    {a.label}
                  </button>
                ))}
              </div>
              <textarea
                className="mbe-area"
                aria-label="What do you want measured on these plans?"
                placeholder="Or ask for something in particular — the master closet, the baseboard in linear feet…"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                data-be-measure-ask
              />
              <DictateButton
                id="blueprintMeasureDictate"
                label="Speak it"
                value={request}
                onChange={setRequest}
                wrapClassName="mbe-dictate"
                buttonClassName="mbe-btn mbe-btn--ghost mbe-btn--wide"
                onClassName="is-listening"
                noteClassName="mbe-dictate-note"
                icon={<MicIcon className="mbe-ic" />}
              />
              {sizes ? (
                <button type="button" className="mbe-btn mbe-btn--ghost mbe-btn--wide" onClick={() => setStage("sizes")}>
                  Back to the sizes
                </button>
              ) : null}
              {errEl}
            </>
          ) : (
            <>
              <h2 className="mbe-h2" id="mbe-ask-h">
                What do you want estimated?
              </h2>
              <p className="mbe-p">Say the job the way you would to your estimator — the plans are measured for it, then priced.</p>
              <textarea
                className="mbe-area"
                aria-label="What do you want estimated from these plans?"
                placeholder="e.g. Granite countertops for the kitchen, the island and the bathroom vanities"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runAsk();
                }}
              />
              <DictateButton
                id="blueprintAskDictate"
                label="Speak the job"
                value={request}
                onChange={setRequest}
                wrapClassName="mbe-dictate"
                buttonClassName="mbe-btn mbe-btn--ghost mbe-btn--wide"
                onClassName="is-listening"
                noteClassName="mbe-dictate-note"
                icon={<MicIcon className="mbe-ic" />}
              />
              <div className="mbe-chips" role="group" aria-label="Common jobs">
                {ASKS.map((a) => (
                  <button key={a.label} type="button" className="mbe-chip" aria-pressed={request === a.ask} onClick={() => setRequest(a.ask)}>
                    {a.label}
                  </button>
                ))}
              </div>
              <label className="mbe-loc">
                <span>Price it for</span>
                <input value={locEdit ?? planAddress ?? ""} onChange={(e) => setLocEdit(e.target.value)} placeholder="City, ST — regional prices" autoComplete="address-level2" />
              </label>
              {errEl}
            </>
          )}
        </section>

        <section className="mbe-card mbe-set" aria-label="The plan set">
          <div className="mbe-set-head">
            <span className="mbe-set-plate" aria-hidden="true">
              <Ic id="i-plans" />
            </span>
            <div className="mbe-set-name">
              <b>{fileName}</b>
              <span>
                {pages.length} sheet{pages.length === 1 ? "" : "s"}
              </span>
            </div>
            <span className={`mbe-stamp${ready ? " mbe-stamp--ok" : ""}`}>{ready ? "Ready" : "Getting ready"}</span>
          </div>
          {!ready && <p className="mbe-note">The plans are being read in the background — you can ask now.</p>}
          {skipped.length > 0 && <p className="mbe-note">{skipped.join(" ")}</p>}
          <ul className="mbe-thumbs">
            {pages.map((p) => (
              <li key={p.page}>
                <button type="button" className="mbe-thumb" onClick={() => openSheet(p.page)} aria-label={`Open sheet ${p.page}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, a data URL */}
                  <img src={p.thumb} alt="" />
                  <span className="mbe-thumb-cap">
                    <b>{p.page}</b> {kindOf(p.page)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mbe-btn mbe-btn--ghost mbe-btn--wide" onClick={startOver}>
            Other plans
          </button>
        </section>
      </>
    );
    foot = (
      <div className="mbe-foot">
        {mode === "materials" ? (
          <button type="button" className="mbe-btn mbe-btn--primary mbe-btn--wide mbe-btn--lg" disabled={!canAsk} onClick={() => void runMaterials(request)} data-be-materials-go>
            Work out the materials
          </button>
        ) : mode === "sizes" ? (
          <button type="button" className="mbe-btn mbe-btn--primary mbe-btn--wide mbe-btn--lg" disabled={!canAsk} onClick={() => void runMeasure(request)} data-be-measure-go>
            Measure it
          </button>
        ) : (
          <button type="button" className="mbe-btn mbe-btn--primary mbe-btn--wide mbe-btn--lg" disabled={!canAsk} onClick={() => void runAsk()}>
            Estimate it
          </button>
        )}
      </div>
    );
  }

  // 3 · working — no description lines under the bars (owner, 2026-10-20).
  else if (stage === "work") {
    const { progress, pricingWords } = workProgress({ step, readDone, readTotal, priced: pricing.done, priceTotal: pricing.total, steps: workSteps.length });
    body = (
      <>
        {head("Working on it", working.title, true)}
        <section className="mbe-card mbe-work" aria-label="Blueprint estimate progress">
          {mode === "estimate" ? <div className="mbe-work-req">{request.trim()}</div> : null}
          <div className="mbe-work-body">
            <div className="mbe-work-head">
              <div className="mbe-work-stage" role="status">
                {workSteps[step]}…
              </div>
              <div className="mbe-work-pct">
                {progress}
                <small>%</small>
              </div>
            </div>
            <div className="mbe-meter" role="progressbar" aria-label="Estimate progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <ol className="mbe-steps" aria-label="Estimate steps">
              {workSteps.map((label, i) => (
                <li key={label} className={i < step ? "is-done" : i === step ? "is-now" : undefined}>
                  <WorkSquare state={i < step ? "done" : i === step ? "now" : "wait"} />
                  <span className="mbe-step-label">{label}</span>
                  <span className="mbe-step-state">{i < step ? "Done" : i === step ? (i === PRICING_STEP && pricingWords ? pricingWords : "In progress") : ""}</span>
                </li>
              ))}
            </ol>
            <button type="button" className="mbe-btn mbe-btn--cancel mbe-btn--wide" onClick={cancelWork}>
              Cancel
            </button>
          </div>
        </section>
      </>
    );
  }

  // 4 · the sizes and measurements alone (2026-10-21)
  else if (stage === "sizes" && sizes) {
    body = (
      <MeasureReportView
        sizes={sizes}
        plan={{ name: planName, address: planAddress, file: pages[0]?.fileName ?? "Plans" }}
        onPage={(p) => openSheet(p)}
        onAsk={() => {
          setMode("sizes");
          setStage("ask");
        }}
        onEstimate={() => {
          setMode("estimate");
          setRequest("");
          setStage("ask");
        }}
      />
    );
  }

  // 4b · the materials (2026-10-21)
  else if (stage === "materials" && materials && mats) {
    body = (
      <MaterialsView
        report={materials}
        deckAsk={mats.deckAsk}
        plan={{ name: planName, address: planAddress, file: pages[0]?.fileName ?? "Plans", sheets: Object.values(reads).filter((r) => r.status === "ok").length }}
        extraPct={extraPct}
        onExtra={setExtraPct}
        onMeasure={editMeasure}
        onDeck={(spec) => void setDeckSize(spec)}
        onPage={(p) => openSheet(p)}
        onAsk={() => {
          setMode("materials");
          setStage("ask");
        }}
        onEstimate={() => {
          setMode("estimate");
          setRequest("");
          setStage("ask");
        }}
      />
    );
  }

  // 5 · result
  else if (result) {
    const m = result.merged;
    const groups = Array.from(new Set(lines.map((l) => l.group ?? ""))).map((g) => {
      const rows = lines.filter((l) => (l.group ?? "") === g);
      return { g, rows, sub: rows.filter(isBilled).reduce((a, l) => a + lineTotal(l), 0) };
    });
    const showGroups = groups.length > 1;
    const measuredRows = result.rows;
    const site = [planName, planAddress].filter(Boolean).join(" · ");
    const tookMs = result.timing.reduce((a, [, ms]) => a + ms, 0);
    const createLabel = saving === "saving" ? "Creating…" : saving === "opening" ? "Opening…" : "Create proposal";

    const estimate = (
      <section className="mbe-card mbe-est" aria-label="Estimate" id="mbe-panel-estimate">
        {result.failed.map((f) => (
          <div key={f.trade} className="mbe-fail">
            <span>
              <b>{TRADE_LABEL[f.trade]}</b> could not be priced — {f.error}
            </span>
            <button type="button" className="mbe-btn mbe-btn--ghost mbe-btn--wide" disabled={retrying != null} aria-busy={retrying === f.trade} onClick={() => void retryTrade(f.trade)}>
              {retrying === f.trade ? "Pricing…" : "Try again"}
            </button>
          </div>
        ))}
        <div className="mbe-lines">
          {groups.map(({ g, rows, sub }) => (
            <div key={g || "-"} className="mbe-group">
              {showGroups && (
                <div className="mbe-group-head">
                  <span>{g}</span>
                  <b>{money(sub)}</b>
                </div>
              )}
              {rows.map((l) => {
                const suggested = !isBilled(l);
                return (
                  <div key={l.id} className={`mbe-line${suggested ? " is-suggested" : ""}`}>
                    <span className="mbe-line-name">
                      {l.name}
                      {suggested && <span className="mbe-line-note">Suggested — not in the total</span>}
                    </span>
                    {suggested ? (
                      <button type="button" className="mbe-line-act mbe-line-add" onClick={() => acceptLine(l.id)} aria-label={`Add ${l.name}`}>
                        Add
                      </button>
                    ) : (
                      <button type="button" className="mbe-line-act mbe-line-remove" onClick={() => removeLine(l.id)} aria-label={`Remove ${l.name}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    )}
                    <span className="mbe-line-qty">
                      <input key={`${l.id}:${l.qty}`} defaultValue={qtyText(l.qty)} inputMode="decimal" enterKeyHint="done" aria-label={`${l.name} — quantity`} onBlur={(e) => setQty(l.id, e.target.value)} />
                      <span className="mbe-line-unit">{l.unit}</span>
                    </span>
                    <span className="mbe-line-total">{money(lineTotal(l))}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mbe-total-row">
          <span>Total</span>
          <b>{money(total)}</b>
        </div>
        {(m.notes.length > 0 || result.timing.length > 0) && (
          <details className="mbe-more">
            <summary>
              <span>Notes and checks{m.notes.length ? ` · ${m.notes.length}` : ""}</span>
              <Ic id="i-chev" className="mbe-more-chev" />
            </summary>
            <ul className="mbe-notes">
              {m.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {result.timing.length > 0 && (
                <li className="mbe-timing">
                  Took {clockText(tookMs)}
                  {result.timing.map(([label, ms]) => ` · ${label.toLowerCase()} ${clockText(ms)}`).join("")}
                </li>
              )}
            </ul>
          </details>
        )}
        <div className="mbe-actions">
          <button type="button" className="mbe-btn mbe-btn--ghost mbe-btn--wide" disabled={saving != null} onClick={editInSmartProposal}>
            Edit in Smart Proposal
          </button>
          <button
            type="button"
            className="mbe-btn mbe-btn--ghost mbe-btn--wide"
            disabled={saving != null}
            onClick={() => {
              setErr("");
              setStage("ask");
            }}
          >
            Ask for another job
          </button>
        </div>
      </section>
    );

    const found = (
      <section className="mbe-card mbe-found" aria-label="Found on your plans" id="mbe-panel-found">
        {result.scope.summary && <p className="mbe-p">{result.scope.summary}</p>}
        {measuredRows.length > 0 ? (
          <ul className="mbe-rows">
            {measuredRows.map((r, i) => (
              <li key={`${r.label}-${i}`} className="mbe-found-row">
                <div className="mbe-found-main">
                  <b>{r.label}</b>
                  <span className="mbe-found-qty">{r.qty != null ? `${qtyText(r.qty)} ${UNIT_SHORT[r.unit]}` : "—"}</span>
                </div>
                <div className="mbe-found-meta">
                  <span className={`mbe-stamp ${r.status === "measured" ? "mbe-stamp--ok" : "mbe-stamp--warn"}`}>{r.status === "measured" ? "Measured" : r.status === "kept" ? "Estimated" : "Not drawn"}</span>
                  {r.pages.map((pg) => (
                    <button key={pg} type="button" className="mbe-page" onClick={() => openSheet(pg)}>
                      p. {pg}
                    </button>
                  ))}
                </div>
                {r.asWritten && <p className="mbe-as-written">{r.asWritten}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mbe-p">Every quantity of this job comes straight from the plans&apos; build list below.</p>
        )}
        {result.takeoff.hvac && <HvacLoadCard load={result.takeoff.hvac} onPage={openSheet} />}
        {result.specs.length > 0 && (
          <div className="mbe-specs">
            <h3 className="mbe-h3">From the plans&apos; notes</h3>
            <ul>
              {result.specs.map((x) => (
                <li key={`${x.page}:${x.text}`}>
                  <span>{x.text}</span>
                  <button type="button" className="mbe-page" onClick={() => openSheet(x.page)}>
                    p. {x.page}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="mbe-more">
          <summary>
            <span>
              Every quantity of this job · {result.items.length} line{result.items.length === 1 ? "" : "s"}
            </span>
            <Ic id="i-chev" className="mbe-more-chev" />
          </summary>
          <ul className="mbe-items">
            {result.items.map((i) => (
              <li key={i.id}>
                <span className="mbe-item-name">{i.label}</span>
                <span className="mbe-item-qty">
                  {qtyText(i.qty)} {UNIT_SHORT[i.unit]}
                </span>
                <span className={`mbe-src${i.measured ? " mbe-src--measured" : i.source === "rule" ? " mbe-src--rule" : ""}`}>{i.measured ? "measured" : SOURCE_LABEL[i.source]}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mbe-btn mbe-btn--ghost mbe-btn--wide"
            onClick={() => downloadText(`${(planName ?? "Plans").replace(/[^\w .-]+/g, "").trim() || "Plans"} — ${result.scope.title.replace(/[^\w .-]+/g, "")}.csv`, buildListCsv(result.items), "text/csv;charset=utf-8")}
          >
            <Ic id="i-download" />
            Download CSV
          </button>
        </details>
        {result.scope.notIncluded.length > 0 && (
          <p className="mbe-not-in">
            <b>Not in this estimate:</b> {result.scope.notIncluded.join(" ")}
          </p>
        )}
      </section>
    );

    body = (
      <>
        {head(result.scope.title, `${site ? `${site} — ` : ""}“${result.request}”`, true)}
        <section className="mbe-plate" aria-label="Estimate total">
          <span className="mbe-plate-k">Estimate</span>
          <b className="mbe-plate-v">{money(total)}</b>
        </section>
        <div className="mbe-tabs" ref={tabsRef} role="tablist" aria-label="The answer">
          <button type="button" role="tab" id="mbe-tab-estimate" aria-selected={tab === "estimate"} aria-controls="mbe-panel-estimate" className="mbe-tab" onClick={() => switchTab("estimate")}>
            Estimate
          </button>
          <button type="button" role="tab" id="mbe-tab-found" aria-selected={tab === "found"} aria-controls="mbe-panel-found" className="mbe-tab" onClick={() => switchTab("found")}>
            Found on your plans
          </button>
        </div>
        <div role="tabpanel" aria-labelledby={tab === "estimate" ? "mbe-tab-estimate" : "mbe-tab-found"} className="mbe-panel">
          {tab === "estimate" ? estimate : found}
        </div>
      </>
    );
    foot = (
      <div className="mbe-foot mbe-foot--total">
        <div className="mbe-foot-total">
          <span>Total</span>
          <b>{money(total)}</b>
        </div>
        <button type="button" className="mbe-btn mbe-btn--primary mbe-btn--lg" disabled={!billed.length || saving != null} aria-busy={saving != null} onClick={() => void createProposal()}>
          {createLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="jf-mblueprint" data-stage={stage}>
      {/* Shared handheld chrome: dark topbar + slide-out drawer + icon sprite. */}
      <MobileNav />
      <main className="mbe-scroll" ref={scrollRef}>
        <div className="mbe-content">
          {chooser}
          {body}
        </div>
      </main>
      {foot}
      {viewerEl}
    </div>
  );
}

/** The heating & cooling load worked out from the plans — the desk's card (blueprint-estimator.tsx), on a phone. */
function HvacLoadCard({ load, onPage }: { load: PlanHvacLoad; onPage: (page: number) => void }) {
  const n = (v: number) => v.toLocaleString("en-US");
  const sys = load.system;
  const size = `${sys.systems > 1 ? `${sys.systems} × ` : ""}${sys.tons} ton${sys.tons === 1 ? "" : "s"}`;
  return (
    <div className="mbe-hvac" data-hvac-load>
      <h3 className="mbe-h3">Heating &amp; cooling load · Manual J-style</h3>
      <div className="mbe-hvac-nums">
        <div>
          <b>{n(load.coolingTotalBtuh)}</b>
          <span>
            Btu/h cooling at {load.climate.coolingF} °F · {load.loadTons} tons of load
          </span>
        </div>
        <div>
          <b>{n(load.heatingBtuh)}</b>
          <span>Btu/h heating at {load.climate.heatingF} °F</span>
        </div>
        <div>
          <b>{size}</b>
          <span>
            {sys.heatPump ? "heat pump" : "A/C with furnace"} · {n(load.coolingCfm)} CFM
          </span>
        </div>
      </div>
      <p className="mbe-hvac-note">{sys.note}</p>
      <ul className="mbe-hvac-inputs">
        {load.inputs.map((i) => (
          <li key={i.label}>
            <span className="mbe-hvac-label">{i.label}</span>
            <span className="mbe-hvac-value">{i.value}</span>
            <span className="mbe-hvac-from">
              <span className={`mbe-stamp ${i.from === "plans" ? "mbe-stamp--ok" : "mbe-stamp--warn"}`}>{i.from === "plans" ? "Plans" : "Assumed"}</span>
              {(i.pages ?? []).slice(0, 4).map((pg) => (
                <button key={pg} type="button" className="mbe-page" onClick={() => onPage(pg)}>
                  p. {pg}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <details className="mbe-more">
        <summary>
          <span>Where the load comes from · {load.components.length} parts</span>
          <Ic id="i-chev" className="mbe-more-chev" />
        </summary>
        <ul className="mbe-hvac-parts">
          {load.components.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
              <span>{n(c.coolingBtuh)} cooling</span>
              <span>{n(c.heatingBtuh)} heating</span>
            </li>
          ))}
        </ul>
        {load.levers.length > 0 && <p className="mbe-hvac-note">{load.levers.join(" ")}</p>}
        <ul className="mbe-hvac-assume">
          {load.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
      <p className="mbe-hvac-fine">The JobFlex HVAC engine&apos;s block load, estimating grade — not an ACCA-approved Manual J report. The permit&apos;s report stays on the build list.</p>
    </div>
  );
}
