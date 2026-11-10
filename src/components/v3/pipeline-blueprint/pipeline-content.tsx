"use client";

// THE PIPELINE — THE PAGE (Smart CRM part 3, 2026-11-08; the approved design's Pipeline artboard).
//
//   FIGURES   open pipeline value, won this month, high-risk value, the average days from first contact to won.
//   STAGES    a bar over the board with all eight stages, their counts and values — always in view, even when the
//             board is wider than the screen. Drop a card on a stage there, or click one to scroll the board to it.
//   BOARD     eight columns, New lead → Won / Lost. Cards drag between columns on a desk; every card also has a
//             "Move to" menu (the phone's way, and the keyboard's). A card shows the person, the job, the value,
//             the source, the owner, a risk stamp with its reasons, and one next step. A card a person moved shows
//             "moved by hand". Won cards carry two more stamps — building and getting paid are not the sale.
//   SOURCES   ?view=sources — each lead source from leads to money collected, with the monthly spend the company
//             types in (cost per job only then).
//
// Writes go through src/actions/pipeline; after each the server view is refreshed.

import { useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { moveDealCard, setDealCardDetails, setSourceSpend } from "@/actions/pipeline";
import { STAGES, type Stage } from "@/lib/pipeline/shared";
import type { CardView, PipelineView } from "./pipeline-load";
import styles from "./pipeline.module.css";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const short = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : usd(n));

export function PipelineContent({ view }: { view: PipelineView }) {
  const router = useRouter();
  const base = (o: { view?: string; mine?: boolean; days?: number }) => {
    const v = o.view ?? view.view;
    const mine = o.mine ?? view.mineOnly;
    const days = o.days ?? view.days;
    return `/dashboard/pipeline?view=${v}${mine ? "&mine=1" : ""}${v === "sources" ? `&days=${days}` : ""}` as Route;
  };
  return (
    <div className={styles.page} data-pipeline={view.view}>
      <div className={cx("page-head", styles.head)}>
        <div>
          <div className="kicker">CRM</div>
          <h1 className="page-title">Pipeline</h1>
        </div>
        <div className={styles.toggles}>
          <div className={styles.seg} role="group" aria-label="View">
            <button type="button" aria-pressed={view.view === "board"} className={cx(styles.segBtn, view.view === "board" && styles.segOn)} onClick={() => router.push(base({ view: "board" }))}>
              Board
            </button>
            {view.canSources ? (
              <button type="button" aria-pressed={view.view === "sources"} className={cx(styles.segBtn, view.view === "sources" && styles.segOn)} onClick={() => router.push(base({ view: "sources" }))} data-pipeline-sources>
                Lead sources
              </button>
            ) : null}
          </div>
          {view.view === "board" ? (
            <button type="button" aria-pressed={view.mineOnly} className={cx(styles.chip, view.mineOnly && styles.chipOn)} onClick={() => router.push(base({ mine: !view.mineOnly }))}>
              Mine only
            </button>
          ) : null}
        </div>
      </div>

      <div className={cx(styles.card, styles.figures)}>
        <div className={styles.fig}>
          <div className={styles.kick}>Open pipeline</div>
          <div className={styles.figVal}>{usd(view.figures.openValue)}</div>
        </div>
        <div className={styles.fig}>
          <div className={styles.kick}>Won this month</div>
          <div className={cx(styles.figVal, styles.good)}>{usd(view.figures.wonMonth)}</div>
        </div>
        <div className={styles.fig}>
          <div className={styles.kick}>High risk</div>
          <div className={cx(styles.figVal, view.figures.atRisk > 0 && styles.bad)}>{usd(view.figures.atRisk)}</div>
        </div>
        <div className={styles.fig}>
          <div className={styles.kick}>Lead to won, average</div>
          <div className={styles.figVal}>{view.figures.cycleDays !== null ? `${view.figures.cycleDays} days` : "—"}</div>
        </div>
        <div className={cx(styles.fig, styles.figNote)}>Cards move on what happens — opened, signed, paid, a visit booked — and by hand. Selling, building and getting paid are tracked apart.</div>
      </div>

      {view.view === "board" ? <Board view={view} /> : <Sources view={view} onDays={(d) => router.push(base({ days: d }))} />}
    </div>
  );
}

function Board({ view }: { view: PipelineView }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [over, setOver] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const move = (key: string, stage: Stage, from: Stage) => {
    if (stage === from) return;
    let reason: string | null = null;
    if (stage === "LOST") {
      reason = window.prompt("Why was it lost? (a few words — price, timing, went with someone else…)") ?? null;
      if (reason === null) return;
    }
    start(async () => {
      const r = await moveDealCard({ key, stage, lostReason: reason });
      if (!r.ok) setError(r.error ?? "Not moved.");
      else setError(null);
      router.refresh();
    });
  };
  // A column and its stage on the bar take the same drop.
  const dropOn = (stage: Stage) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(stage);
    },
    onDragLeave: () => setOver((o) => (o === stage ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const [key, from] = e.dataTransfer.getData("text/plain").split("|");
      if (key && from) move(key, stage, from as Stage);
    },
  });
  return (
    <>
      <div className={styles.rail} aria-label="Stages">
        {view.columns.map((col) => (
          <button
            key={col.key}
            type="button"
            className={cx(styles.railStep, over === col.key && styles.railOver, col.key === "WON" && styles.railWon, col.key === "LOST" && styles.railLost)}
            data-rail={col.key}
            title={`Show ${col.label} — or drop a card here`}
            onClick={() => boardRef.current?.querySelector(`[data-col="${col.key}"]`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
            {...dropOn(col.key)}
          >
            <span className={styles.railLabel}>{col.short}</span>
            <span className={styles.railNum}>
              {col.count}
              {col.value ? ` · ${short(col.value)}` : ""}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p className={styles.err} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.board} aria-busy={busy} ref={boardRef}>
        {view.columns.map((col) => (
          <section
            key={col.key}
            className={cx(styles.col, over === col.key && styles.colOver)}
            aria-label={`${col.label}: ${col.count}`}
            data-col={col.key}
            {...dropOn(col.key)}
          >
            <div className={cx(styles.colHead, col.key === "WON" && styles.colWon, col.key === "LOST" && styles.colLost)}>
              <span>{col.label}</span>
              <span>
                {col.count}
                {col.value ? ` · ${short(col.value)}` : ""}
              </span>
            </div>
            {col.cards.length === 0 ? <p className={styles.colEmpty}>—</p> : col.cards.map((c) => <Card key={c.key} c={c} onMove={move} />)}
          </section>
        ))}
      </div>
      <p className={styles.legend}>Drag a card onto a column or a stage in the bar, or use its Move to. Lost asks why. A proposal is never signed or declined by a move — only the card moves.</p>
    </>
  );
}

function Card({ c, onMove }: { c: CardView; onMove: (key: string, stage: Stage, from: Stage) => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <article
      className={cx(styles.deal, c.risk === "HIGH" && styles.dealHigh, c.risk === "MEDIUM" && styles.dealMed)}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", `${c.key}|${c.stage}`)}
      data-deal={c.key}
    >
      <div className={styles.dealTop}>
        <button type="button" className={styles.dealName} onClick={() => router.push(c.href as Route)}>
          {c.name}
        </button>
        {c.value ? <b className={styles.dealVal}>{usd(c.value)}</b> : null}
      </div>
      <div className={styles.dealTitle}>{c.title}</div>
      <div className={styles.stamps}>
        <span className={styles.stamp} style={{ color: c.source.tone }} title={c.source.label}>
          {c.source.short}
        </span>
        {c.risk !== "LOW" ? <span className={cx(styles.stamp, c.risk === "HIGH" ? styles.bad : styles.warn)}>{c.risk === "HIGH" ? "High risk" : "Medium risk"}</span> : null}
        {c.build ? <span className={cx(styles.stamp, c.build === "Built" ? styles.good : styles.accent)}>Build: {c.build}</span> : null}
        {c.paid ? <span className={cx(styles.stamp, c.paid === "Paid" ? styles.good : styles.warn)}>{c.paid}</span> : null}
        {c.byHand ? <span className={styles.stamp}>Moved by hand</span> : null}
      </div>
      {c.reasons.length ? <div className={styles.why}>Why: {c.reasons.join(" · ")}</div> : null}
      {c.next ? <div className={styles.next}>Next: {c.next}</div> : null}
      {c.lostReason ? <div className={styles.why}>Lost: {c.lostReason}</div> : null}
      <div className={styles.dealFoot}>
        <span className={styles.meta}>
          {c.owner ? `${c.owner} · ` : ""}
          {c.touched ? `last ${c.touched}` : "no contact yet"}
          {c.close ? ` · close by ${c.close}` : ""}
        </span>
        <label className={styles.moveLabel}>
          <span className={styles.srOnly}>Move {c.name} to</span>
          <select className={styles.move} value={c.stage} onChange={(e) => onMove(c.key, e.target.value as Stage, c.stage)} data-move={c.key}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key === c.stage ? `In ${s.label}` : `Move to ${s.label}`}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.moveLabel}>
          <span className={styles.srOnly}>Expected close for {c.name}</span>
          <input
            type="date"
            className={styles.date}
            defaultValue={c.closeIso ?? ""}
            disabled={busy}
            onChange={(e) =>
              start(async () => {
                const r = await setDealCardDetails({ key: c.key, expectedClose: e.target.value || null });
                if (!r.ok && r.error) window.alert(r.error);
                router.refresh();
              })
            }
            title="Expected close"
          />
        </label>
      </div>
    </article>
  );
}

function Sources({ view, onDays }: { view: PipelineView; onDays: (d: number) => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const save = (key: string, raw: string) => {
    const n = raw.trim() === "" ? null : Number(raw.replace(/[$,]/g, ""));
    if (n !== null && !Number.isFinite(n)) return;
    start(async () => {
      await setSourceSpend(key, n);
      router.refresh();
    });
  };
  return (
    <section className={cx(styles.card, styles.sources)} aria-label="Lead sources" aria-busy={busy}>
      <div className={styles.srcHead}>
        <span className={styles.srcTitle}>Which sources turn into paid work</span>
        <div className={styles.seg} role="group" aria-label="Period">
          {[30, 90, 365].map((d) => (
            <button key={d} type="button" aria-pressed={view.days === d} className={cx(styles.segBtn, view.days === d && styles.segOn)} onClick={() => onDays(d)}>
              {d === 365 ? "Year" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {view.sources.length === 0 ? (
        <p className={styles.colEmpty}>No leads in this period yet.</p>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Source</th>
                <th className={styles.num}>Leads</th>
                <th className={styles.num}>Contacted</th>
                <th className={styles.num}>Visits</th>
                <th className={styles.num}>Estimates</th>
                <th className={styles.num}>Won</th>
                <th className={styles.num}>Won value</th>
                <th className={styles.num}>Collected</th>
                <th className={styles.num}>First reply</th>
                <th className={styles.num}>Spend / month</th>
                <th className={styles.num}>Per won job</th>
              </tr>
            </thead>
            <tbody>
              {view.sources.map((r) => (
                <tr key={r.key} data-source-row={r.key}>
                  <td>
                    <span className={styles.dot} style={{ background: r.tone }} />
                    {r.label}
                  </td>
                  <td className={styles.num}>{r.leads}</td>
                  <td className={styles.num}>{r.contacted}</td>
                  <td className={styles.num}>{r.visits}</td>
                  <td className={styles.num}>{r.estimates}</td>
                  <td className={styles.num}>{r.won}</td>
                  <td className={styles.num}>{usd(r.wonValue)}</td>
                  <td className={styles.num}>{usd(r.collected)}</td>
                  <td className={styles.num}>{r.medianReplyMin === null ? "—" : r.medianReplyMin < 60 ? `${r.medianReplyMin} min` : `${Math.round(r.medianReplyMin / 60)} h`}</td>
                  <td className={styles.num}>
                    <input className={styles.spend} defaultValue={r.monthlySpend ?? ""} placeholder="—" inputMode="decimal" aria-label={`Monthly spend on ${r.label}`} onBlur={(e) => save(r.key, e.target.value)} data-spend={r.key} />
                  </td>
                  <td className={styles.num}>{r.costPerJob === null ? "—" : usd(r.costPerJob)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.legend}>Cost per job shows only where you enter what you spend on that source each month — JobFlex never guesses ad cost.</p>
    </section>
  );
}
