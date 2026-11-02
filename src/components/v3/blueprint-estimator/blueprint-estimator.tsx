"use client";
// BLUEPRINT ESTIMATOR — upload the plans, ask for the job, get it measured and priced.
// Route: /dashboard/blueprint-estimator (owner, 2026-10-13: "upload it and don't wait…
// then you type in or use the voice what you want from this blueprint… and only after
// the request look into the pages, find it, and put it in an estimate").
//
//   1 · Upload   the plan set opens in the browser (pdf.js) and goes straight to the
//                question; every sheet is read in the background meanwhile (lib/plans/sheet
//                → takeoff → build list), with no page-by-page show
//   2 · Ask      typed or spoken: "granite countertops", "drywall with texture and primer"
//   3 · Work     the request made into a job (askPlan), the sheets that show it looked at
//                again for exactly those things (measurePlanSheet), the job's trades priced
//                (pricePlanTrade) — one calm progress, four steps
//   4 · Result   what was found on the plans, page by page, beside the priced lines;
//                Create proposal, or Edit in Smart Proposal (lib/plans/handoff)
//
// A tool of its own in the sidebar, apart from Smart Proposal (owner, 2026-10-13).
import { useRef, useState } from "react";
import s from "./blueprint-estimator.module.css";
import { BlueprintLoadingCard } from "./blueprint-loading-card";
import { ASKS, clockText, money, qtyText, SIZE_ASKS, UNIT_SHORT, useBlueprintEstimator } from "./use-blueprint-estimator";
import { MeasureReportView } from "./measure-report";
import { MaterialsView } from "./materials-view";
import { MATERIAL_TOPICS } from "@/lib/plans/materialsReport";
import type { PlanHvacLoad } from "@/lib/plans/hvacEnvelope";
import { MAX_PLAN_PAGES } from "@/lib/plans/pdfClient";
import { TRADE_LABEL } from "@/lib/plans/takeoff";
import { buildListCsv, downloadText, SOURCE_LABEL } from "@/lib/plans/csv";
import { isBilled, lineTotal } from "@/lib/estimate/console-model";
import { DictateButton } from "@/components/estimator/DictateButton";

export function BlueprintEstimator() {
  // The state, the reading, the ask and the work: use-blueprint-estimator (shared with the phone page).
  const {
    stage, setStage, opening, pages, skipped, readTotal, readDone, ready, request, setRequest, locEdit, setLocEdit,
    step, pricing, working, result, lines, saving, retrying, viewer, setViewer, err, setErr, planName, planAddress,
    billed, total, setQty, removeLine, acceptLine, openFiles, runAsk, retryTrade, createProposal, editInSmartProposal,
    openViewer, startOver, cancelWork, kindOf,
    mode, setMode, sizes, runMeasure, workSteps,
    mats, materials, runMaterials, setDeckSize, editMeasure, extraPct, setExtraPct, reads,
  } = useBlueprintEstimator();
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // ══════════════ RENDER ══════════════
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

  const head = (title: string, sub?: string | null) => (
    <div className={s.head}>
      <h1 className={s.title}>{title}</h1>
      {sub ? <p className={s.sub}>{sub}</p> : null}
    </div>
  );

  const viewerEl = viewer && (
    <div className={s.viewer} role="dialog" aria-modal="true" aria-label={`Sheet ${viewer.page}`} onClick={() => setViewer(null)}>
      <div className={s.viewerSheet} onClick={(e) => e.stopPropagation()}>
        <div className={s.viewerBar}>
          <span>
            Sheet {viewer.page} · {kindOf(viewer.page)}
          </span>
          <button type="button" className={s.btnGhost} onClick={() => setViewer(null)}>
            Close
          </button>
        </div>
        {viewer.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, a data URL
          <img className={s.viewerImg} src={viewer.url} alt={`Sheet ${viewer.page}`} />
        ) : (
          <div className={s.viewerWait}>Opening the sheet…</div>
        )}
      </div>
    </div>
  );


  // 1 · upload
  if (stage === "upload") {
    return (
      <div className={s.be}>
        {chooser}
        {head("Blueprint estimator")}
        <section
          className={`${s.card} ${s.drop} ${drag ? s.dropOn : ""}`}
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
          <svg className={s.dropIcon} aria-hidden="true">
            <use href="#i-plans" />
          </svg>
          <h2 className={s.h2}>{opening != null ? `Opening the plans · ${opening} page${opening === 1 ? "" : "s"}` : "Drop the plan set here"}</h2>
          <p className={s.p}>A PDF of the plans, or photos of the sheets — up to {MAX_PLAN_PAGES} pages.</p>
          <button type="button" className={s.btnPrimary} disabled={opening != null} onClick={() => fileInput.current?.click()} data-tour="blueprint:upload">
            {opening != null ? "Opening…" : "Choose the plans"}
          </button>
          {err && <div className={s.err}>{err}</div>}
        </section>
        <ol className={s.how}>
          <li>
            <span className={s.howN}>1</span>
            <b>Upload the plans</b>
            <span>They open in seconds — no waiting on the reading.</span>
          </li>
          <li>
            <span className={s.howN}>2</span>
            <b>Ask for the job</b>
            <span>Type it or say it: &ldquo;granite countertops&rdquo;, &ldquo;drywall with texture and paint&rdquo;.</span>
          </li>
          <li>
            <span className={s.howN}>3</span>
            <b>Get it measured and priced</b>
            <span>Every number from the sheets, with its page — then one tap to a proposal.</span>
          </li>
        </ol>
      </div>
    );
  }

  // 3 · working — the roof estimator's compact progress-card layout.
  if (stage === "work") {
    // No description lines under the bars (owner, 2026-10-20) — the steps and the meter say it.
    return (
      <div className={s.be}>
        {head("Working on it", working.title)}
        <BlueprintLoadingCard request={mode === "estimate" ? request.trim() : ""} step={step} readDone={readDone} readTotal={readTotal}
          priced={pricing.done} priceTotal={pricing.total} steps={workSteps}
          onCancel={cancelWork} />
      </div>
    );
  }

  // 2 · ask
  if (stage === "ask") {
    const fileName = pages[0]?.fileName ?? "Plans";
    return (
      <div className={s.be}>
        {chooser}
        {viewerEl}
        {head(planName || "What do you want from these plans?", planAddress)}
        <div className={s.askGrid}>
          <section className={`${s.card} ${s.ask}`}>
            {/* An estimate, or the sizes alone (owner, 2026-10-21: "so need estimate or sizes measurements"). */}
            <div className={s.modes} role="tablist" aria-label="What you want from the plans">
              <button type="button" role="tab" aria-selected={mode === "estimate"} className={`${s.mode} ${mode === "estimate" ? s.modeOn : ""}`} onClick={() => setMode("estimate")} data-be-mode="estimate">
                Estimate a job
              </button>
              <button type="button" role="tab" aria-selected={mode === "sizes"} className={`${s.mode} ${mode === "sizes" ? s.modeOn : ""}`} onClick={() => setMode("sizes")} data-be-mode="sizes">
                Sizes &amp; measurements
              </button>
              <button type="button" role="tab" aria-selected={mode === "materials"} className={`${s.mode} ${mode === "materials" ? s.modeOn : ""}`} onClick={() => setMode("materials")} data-be-mode="materials">
                Materials
              </button>
            </div>
            {mode === "materials" ? (
              <>
                <h2 className={s.h2}>What materials do you need?</h2>
                <p className={s.p}>Everything to buy, in the units it is sold in — drywall in sheets with its mud and tape, shingles in bundles, lumber by the piece, concrete by the yard — worked out from the plans, with how each was figured. Tap a trade, or say the job.</p>
                <div className={s.chips} role="group" aria-label="Trades">
                  {MATERIAL_TOPICS.map((t) => (
                    <button key={t.key} type="button" className={s.chip} onClick={() => void runMaterials(null, t.key)} data-be-material={t.key}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className={s.area}
                  aria-label="What materials do you need from these plans?"
                  placeholder="e.g. Drywall for the garage only · a 16x20 composite deck, 4 ft high · roof materials for a metal roof"
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim().length >= 2) void runMaterials(request);
                  }}
                  data-be-materials-ask
                />
                <DictateButton
                  id="blueprintMaterialsDictate"
                  label="Speak it"
                  value={request}
                  onChange={setRequest}
                  wrapClassName={s.dictate}
                  buttonClassName={s.btnGhost}
                  onClassName={s.dictateOn}
                  noteClassName={s.dictateNote}
                  iconClassName={s.ic}
                />
                {err && <div className={s.err}>{err}</div>}
                <div className={s.bar}>
                  {mats ? (
                    <button type="button" className={s.btnGhost} onClick={() => setStage("materials")}>
                      Back to the materials
                    </button>
                  ) : null}
                  <button type="button" className={s.btnPrimary} disabled={request.trim().length < 2} onClick={() => void runMaterials(request)} data-be-materials-go>
                    Work out the materials
                  </button>
                </div>
              </>
            ) : mode === "sizes" ? (
              <>
                <h2 className={s.h2}>What do you want measured?</h2>
                <p className={s.p}>Every room by name with its size and square feet, the floors, walls, roof, windows and doors — each with its sheet, ready as a PDF. Tap a part of the house, or ask for something in particular.</p>
                <div className={s.chips} role="group" aria-label="Parts of the house">
                  {SIZE_ASKS.map((a) => (
                    <button key={a.label} type="button" className={s.chip} onClick={() => void runMeasure(null, a.focus)} data-be-size={a.focus ?? "all"}>
                      {a.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className={s.area}
                  aria-label="What do you want measured on these plans?"
                  placeholder="e.g. The master bedroom and its closet, the baseboard in linear feet, the kitchen counters"
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim().length >= 2) void runMeasure(request);
                  }}
                  data-be-measure-ask
                />
                <DictateButton
                  id="blueprintMeasureDictate"
                  label="Speak it"
                  value={request}
                  onChange={setRequest}
                  wrapClassName={s.dictate}
                  buttonClassName={s.btnGhost}
                  onClassName={s.dictateOn}
                  noteClassName={s.dictateNote}
                  iconClassName={s.ic}
                />
                {err && <div className={s.err}>{err}</div>}
                <div className={s.bar}>
                  {sizes ? (
                    <button type="button" className={s.btnGhost} onClick={() => setStage("sizes")}>
                      Back to the sizes
                    </button>
                  ) : null}
                  <button type="button" className={s.btnPrimary} disabled={request.trim().length < 2} onClick={() => void runMeasure(request)} data-be-measure-go>
                    Measure it
                  </button>
                </div>
              </>
            ) : (
              <>
              <h2 className={s.h2}>What do you want estimated?</h2>
              <p className={s.p}>Say the job the way you would to your estimator — the plans are measured for it, then priced.</p>
              <textarea
                className={s.area}
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
                wrapClassName={s.dictate}
                buttonClassName={s.btnGhost}
                onClassName={s.dictateOn}
                noteClassName={s.dictateNote}
                iconClassName={s.ic}
              />
              <div className={s.chips} role="group" aria-label="Common jobs">
                {ASKS.map((a) => (
                  <button key={a.label} type="button" className={s.chip} onClick={() => setRequest(a.ask)}>
                    {a.label}
                  </button>
                ))}
              </div>
              <label className={s.loc}>
                <span>Price it for</span>
                <input value={locEdit ?? planAddress ?? ""} onChange={(e) => setLocEdit(e.target.value)} placeholder="City, ST — regional prices" />
              </label>
              {err && <div className={s.err}>{err}</div>}
              <div className={s.bar}>
                <button type="button" className={s.btnPrimary} disabled={request.trim().length < 2} onClick={() => void runAsk()}>
                  Estimate it
                </button>
              </div>
              </>
            )}
          </section>

          <section className={`${s.card} ${s.set}`} aria-label="The plan set">
            <div className={s.setHead}>
              <div className={s.setName}>
                <b>{fileName}</b>
                <span>
                  {pages.length} sheet{pages.length === 1 ? "" : "s"}
                </span>
              </div>
              <span className={`${s.stamp} ${ready ? s.stampOk : ""}`}>{ready ? "Ready" : "Getting ready"}</span>
            </div>
            {!ready && <p className={s.setNote}>The plans are being read in the background — you can ask now.</p>}
            {skipped.length > 0 && <p className={s.setNote}>{skipped.join(" ")}</p>}
            <ul className={s.thumbs}>
              {pages.map((p) => (
                <li key={p.page}>
                  <button type="button" className={s.thumb} onClick={() => void openViewer(p.page)} aria-label={`Open sheet ${p.page}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, a data URL */}
                    <img src={p.thumb} alt="" />
                    <span className={s.thumbCap}>
                      <b>{p.page}</b> {kindOf(p.page)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={s.bar}>
              <button type="button" className={s.btnGhost} onClick={startOver}>
                Other plans
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // 4 · the sizes and measurements alone (2026-10-21) — the report on every sheet read, Download PDF.
  if (stage === "sizes" && sizes) {
    return (
      <div className={s.be}>
        {viewerEl}
        <MeasureReportView
          sizes={sizes}
          plan={{ name: planName, address: planAddress, file: pages[0]?.fileName ?? "Plans" }}
          onPage={(p) => void openViewer(p)}
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
      </div>
    );
  }

  // 4b · the materials (2026-10-21) — every material to buy for a trade, a typed job or a deck, from the plans.
  if (stage === "materials" && materials && mats) {
    return (
      <div className={s.be}>
        {viewerEl}
        <MaterialsView
          report={materials}
          deckAsk={mats.deckAsk}
          plan={{ name: planName, address: planAddress, file: pages[0]?.fileName ?? "Plans", sheets: Object.values(reads).filter((r) => r.status === "ok").length }}
          extraPct={extraPct}
          onExtra={setExtraPct}
          onMeasure={editMeasure}
          onDeck={(spec) => void setDeckSize(spec)}
          onPage={(p) => void openViewer(p)}
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
      </div>
    );
  }

  // 5 · result
  if (!result) return null;
  const m = result.merged;
  const groups = Array.from(new Set(lines.map((l) => l.group ?? ""))).map((g) => {
    const rows = lines.filter((l) => (l.group ?? "") === g);
    return { g, rows, sub: rows.filter(isBilled).reduce((a, l) => a + lineTotal(l), 0) };
  });
  const showGroups = groups.length > 1;
  const measuredRows = result.rows;
  const site = [planName, planAddress].filter(Boolean).join(" · ");
  const tookMs = result.timing.reduce((a, [, ms]) => a + ms, 0);
  return (
    <div className={s.be}>
      {viewerEl}
      {/* THE RESULT (owner, 2026-10-17: the AI desk's clarity pass): the job, then the total and the one next step
          — Create proposal — at the top, so a 300-line estimate never hides it. */}
      <div className={s.resultHead}>
        {head(result.scope.title, `${site ? `${site} — ` : ""}“${result.request}”`)}
        <div className={s.headTotal}>
          <span>Estimate</span>
          <b>{money(total)}</b>
          <button type="button" className={s.btnPrimary} disabled={!billed.length || saving != null} onClick={() => void createProposal()}>
            {saving === "saving" ? "Creating…" : saving === "opening" ? "Opening…" : "Create proposal"}
          </button>
        </div>
      </div>
      <div className={s.resGrid}>
        <section className={`${s.card} ${s.est}`}>
          <h2 className={s.h2}>Estimate</h2>
          {result.failed.map((f) => (
            <div key={f.trade} className={s.failRow}>
              <span>
                <b>{TRADE_LABEL[f.trade]}</b> could not be priced — {f.error}
              </span>
              <button type="button" className={s.btnGhost} disabled={retrying != null} onClick={() => void retryTrade(f.trade)}>
                {retrying === f.trade ? "Pricing…" : "Try again"}
              </button>
            </div>
          ))}
          <div className={s.lines}>
            {groups.map(({ g, rows, sub }) => (
              <div key={g || "-"} className={s.lineGroup}>
                {showGroups && (
                  <div className={s.groupHead}>
                    <span>{g}</span>
                    <b>{money(sub)}</b>
                  </div>
                )}
                {rows.map((l) => {
                  const suggested = !isBilled(l);
                  return (
                    <div key={l.id} className={`${s.line} ${suggested ? s.lineSuggested : ""}`}>
                      <span className={s.lineName}>
                        {l.name}
                        {suggested && <span className={s.lineNote}>Suggested — not in the total</span>}
                      </span>
                      <input className={s.lineQty} key={`${l.id}:${l.qty}`} defaultValue={qtyText(l.qty)} inputMode="decimal" aria-label={`${l.name} — quantity`} onBlur={(e) => setQty(l.id, e.target.value)} />
                      <span className={s.lineUnit}>{l.unit}</span>
                      <span className={s.lineTotal}>{money(lineTotal(l))}</span>
                      {suggested ? (
                        <button type="button" className={s.lineAct} onClick={() => acceptLine(l.id)} aria-label={`Add ${l.name}`}>
                          Add
                        </button>
                      ) : (
                        <button type="button" className={`${s.lineAct} ${s.lineRemove}`} onClick={() => removeLine(l.id)} aria-label={`Remove ${l.name}`}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={s.totalRow}>
            <span>Total</span>
            <b>{money(total)}</b>
          </div>
          {(m.notes.length > 0 || result.timing.length > 0) && (
            <details className={s.more}>
              <summary>
                <span>Notes and checks{m.notes.length ? ` · ${m.notes.length}` : ""}</span>
                <svg className={s.moreChev} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </summary>
              <ul className={s.notes}>
                {m.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {result.timing.length > 0 && (
                  <li className={s.timing}>
                    Took {clockText(tookMs)}
                    {result.timing.map(([label, ms]) => ` · ${label.toLowerCase()} ${clockText(ms)}`).join("")}
                  </li>
                )}
              </ul>
            </details>
          )}
          <div className={s.actions}>
            <button type="button" className={s.btnPrimary} disabled={!billed.length || saving != null} onClick={() => void createProposal()}>
              {saving === "saving" ? "Creating…" : saving === "opening" ? "Opening…" : "Create proposal"}
            </button>
            <button type="button" className={s.btnGhost} disabled={saving != null} onClick={editInSmartProposal}>
              Edit in Smart Proposal
            </button>
            <button
              type="button"
              className={s.btnGhost}
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

        <section className={`${s.card} ${s.found}`}>
          <h2 className={s.h2}>Found on your plans</h2>
          {result.scope.summary && <p className={s.p}>{result.scope.summary}</p>}
          {measuredRows.length > 0 ? (
            <ul className={s.rows}>
              {measuredRows.map((r, i) => (
                <li key={`${r.label}-${i}`} className={s.foundRow}>
                  <div className={s.foundMain}>
                    <b>{r.label}</b>
                    <span className={s.foundQty}>{r.qty != null ? `${qtyText(r.qty)} ${UNIT_SHORT[r.unit]}` : "—"}</span>
                  </div>
                  <div className={s.foundMeta}>
                    <span className={`${s.stamp} ${r.status === "measured" ? s.stampOk : s.stampWarn}`}>{r.status === "measured" ? "Measured" : r.status === "kept" ? "Estimated" : "Not drawn"}</span>
                    {r.pages.map((pg) => (
                      <button key={pg} type="button" className={s.pageLink} onClick={() => void openViewer(pg)}>
                        p. {pg}
                      </button>
                    ))}
                  </div>
                  {r.asWritten && <p className={s.asWritten}>{r.asWritten}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.p}>Every quantity of this job comes straight from the plans&apos; build list below.</p>
          )}
          {result.takeoff.hvac && <HvacLoadCard load={result.takeoff.hvac} onPage={(pg) => void openViewer(pg)} />}
          {result.specs.length > 0 && (
            <div className={s.specs}>
              <h3 className={s.h3}>From the plans&apos; notes</h3>
              <ul>
                {result.specs.map((x) => (
                  <li key={`${x.page}:${x.text}`}>
                    <span>{x.text}</span>
                    <button type="button" className={s.pageLink} onClick={() => void openViewer(x.page)}>
                      p. {x.page}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className={s.more}>
            <summary>
              <span>
                Every quantity of this job · {result.items.length} line{result.items.length === 1 ? "" : "s"}
              </span>
              <svg className={s.moreChev} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <ul className={s.items}>
              {result.items.map((i) => (
                <li key={i.id}>
                  <span className={s.itemName}>{i.label}</span>
                  <span className={s.itemQty}>
                    {qtyText(i.qty)} {UNIT_SHORT[i.unit]}
                  </span>
                  <span className={`${s.src} ${i.measured ? s.srcMeasured : i.source === "rule" ? s.srcRule : ""}`}>{i.measured ? "measured" : SOURCE_LABEL[i.source]}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={s.btnGhost}
              onClick={() => downloadText(`${(planName ?? "Plans").replace(/[^\w .-]+/g, "").trim() || "Plans"} — ${result.scope.title.replace(/[^\w .-]+/g, "")}.csv`, buildListCsv(result.items), "text/csv;charset=utf-8")}
            >
              Download CSV
            </button>
          </details>
          {result.scope.notIncluded.length > 0 && (
            <p className={s.notIn}>
              <b>Not in this estimate:</b> {result.scope.notIncluded.join(" ")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** The heating & cooling load worked out from the plans (2026-10-18): the size it calls for, then every input with
 *  where it came from — the plans (with their pages) or an assumption — and the parts of the load, folded. */
function HvacLoadCard({ load, onPage }: { load: PlanHvacLoad; onPage: (page: number) => void }) {
  const n = (v: number) => v.toLocaleString("en-US");
  const sys = load.system;
  const size = `${sys.systems > 1 ? `${sys.systems} × ` : ""}${sys.tons} ton${sys.tons === 1 ? "" : "s"}`;
  return (
    <div className={s.hvac} data-hvac-load>
      <h3 className={s.h3}>Heating &amp; cooling load · Manual J-style</h3>
      <div className={s.hvacNums}>
        <div><b>{n(load.coolingTotalBtuh)}</b><span>Btu/h cooling at {load.climate.coolingF} °F · {load.loadTons} tons of load</span></div>
        <div><b>{n(load.heatingBtuh)}</b><span>Btu/h heating at {load.climate.heatingF} °F</span></div>
        <div><b>{size}</b><span>{sys.heatPump ? "heat pump" : "A/C with furnace"} · {n(load.coolingCfm)} CFM</span></div>
      </div>
      <p className={s.hvacNote}>{sys.note}</p>
      <ul className={s.hvacInputs}>
        {load.inputs.map((i) => (
          <li key={i.label}>
            <span className={s.hvacLabel}>{i.label}</span>
            <span className={s.hvacValue}>{i.value}</span>
            <span className={s.hvacFrom}>
              <span className={`${s.stamp} ${i.from === "plans" ? s.stampOk : s.stampWarn}`}>{i.from === "plans" ? "Plans" : "Assumed"}</span>
              {(i.pages ?? []).slice(0, 4).map((pg) => (
                <button key={pg} type="button" className={s.pageLink} onClick={() => onPage(pg)}>
                  p. {pg}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <details className={s.more}>
        <summary>
          <span>Where the load comes from · {load.components.length} parts</span>
          <svg className={s.moreChev} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <ul className={s.hvacParts}>
          {load.components.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
              <span>{n(c.coolingBtuh)} cooling</span>
              <span>{n(c.heatingBtuh)} heating</span>
            </li>
          ))}
        </ul>
        {load.levers.length > 0 && <p className={s.hvacNote}>{load.levers.join(" ")}</p>}
        <ul className={s.hvacAssume}>
          {load.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </details>
      <p className={s.hvacFine}>The JobFlex HVAC engine&apos;s block load, estimating grade — not an ACCA-approved Manual J report. The permit&apos;s report stays on the build list.</p>
    </div>
  );
}
