"use client";

// THE TIMELINE OF A PROJECT (the timeline build, 2026-11-06). One card for the desktop and the handheld project
// page: the stages as bars across the weeks, with the deliveries (▼) and the inspections (◆) on them, the crew's
// calendar days under them and today drawn through. "Shift the rest" from a stage that slipped moves every stage
// after it, the crew's days and the pending inspections by N work days (lib/projectTimeline); "Lay out the days"
// dates the stages that have none. The inspections live under the chart: the day, what to have ready, pass or
// fail. Writes: actions/projectTimeline and actions/projectFinish (estimators and managers); everyone else reads.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { layOutStages, previewShift, shiftTheRest } from "@/actions/projectTimeline";
import { addProjectInspection, deleteProjectInspection, recordProjectInspection, updateProjectInspection } from "@/actions/projectFinish";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdTimeline } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { RESULT_LABEL, addWorkDays, barOf, dayLabel, dayLabelLong, inspectionResultOf, markOf, timelineWindow, workDaysLate, workDaysWords, type ShiftPlan } from "@/lib/projectTimeline/shared";
import { GATE_PRESETS, INSPECTION_NAME } from "@/lib/projectGates";
import s from "./project-hub.module.css";

const iso = (d: string | null) => (d ? d.slice(0, 10) : null);

type InspEdit = { id: string | null; name: string; date: string; readyNote: string; stageId: string; isFinal: boolean; gate: boolean };
/** The quick picks, in the county's words (lib/projectGates); the last is the project's final inspection. */
const PRESETS = GATE_PRESETS.map((k) => ({ name: INSPECTION_NAME[k], isFinal: k === "FINAL" }));

export function ProjectTimelineCard({ projectId, timeline, canManage }: { projectId: string; timeline: PdTimeline; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shift, setShift] = useState<{ stageId: string; name: string; days: string } | null>(null);
  const [preview, setPreview] = useState<{ key: string; plan: ShiftPlan | { error: string } } | null>(null);
  const [layout, setLayout] = useState<{ from: string; workDays: string } | null>(null);
  const [insp, setInsp] = useState<InspEdit | null>(null);
  const [inspErr, setInspErr] = useState<string | null>(null);

  const today = timeline.today;
  const stages = timeline.stages;
  const dated = stages.filter((st) => st.startsAt || st.endsAt);
  const undated = stages.filter((st) => !st.startsAt && !st.endsAt && st.status !== "DONE");
  const win = timelineWindow([...stages.flatMap((st) => [iso(st.startsAt), iso(st.endsAt)]), ...timeline.inspections.map((i) => i.date), ...timeline.deliveries.map((d) => d.day), ...timeline.crewDays.map((c) => c.day)], today);
  const refresh = () => startTransition(() => router.refresh());

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  // The shift sheet reads its plan back before the yes: what moves, to where.
  const shiftKey = shift ? `${shift.stageId}:${shift.days}` : "";
  useEffect(() => {
    if (!shift) return;
    const days = Number(shift.days);
    if (!(days >= 1)) return;
    const key = `${shift.stageId}:${shift.days}`;
    const t = setTimeout(() => {
      previewShift(projectId, shift.stageId, days)
        .then((plan) => setPreview({ key, plan }))
        .catch(() => setPreview({ key, plan: { error: "Could not read the plan — try again." } }));
    }, 250);
    return () => clearTimeout(t);
  }, [projectId, shift, shiftKey]);
  const plan = preview && preview.key === shiftKey ? preview.plan : null;

  function openShift(st: PdTimeline["stages"][number]) {
    const end = iso(st.endsAt) ?? iso(st.startsAt) ?? today;
    const late = workDaysLate(end, today);
    setShift({ stageId: st.id, name: st.name, days: String(Math.max(1, late)) });
  }

  function openInspection(row: PdTimeline["inspections"][number] | null, preset?: { name: string; isFinal?: boolean }) {
    setInspErr(null);
    setInsp(
      row
        ? { id: row.id, name: row.name, date: row.date ?? "", readyNote: row.readyNote ?? "", stageId: row.stageId ?? "", isFinal: row.isFinal, gate: row.gate }
        : { id: null, name: preset?.name ?? "", date: "", readyNote: "", stageId: "", isFinal: Boolean(preset?.isFinal), gate: true },
    );
  }

  async function saveInspection() {
    if (!insp) return;
    if (!insp.name.trim()) return setInspErr("Name the inspection — Rough-in, Framing, Final");
    const data = { name: insp.name.trim(), date: insp.date || null, readyNote: insp.readyNote.trim() || null, stageId: insp.stageId || null, isFinal: insp.isFinal, gate: insp.stageId ? insp.gate : false };
    const id = insp.id;
    setInsp(null);
    await run(`insp:${id ?? "new"}`, async () => {
      if (id) await updateProjectInspection(projectId, id, data);
      else await addProjectInspection(projectId, data);
    });
  }

  function record(row: PdTimeline["inspections"][number], result: "PASSED" | "FAILED") {
    const note = window.prompt(result === "PASSED" ? "Anything the inspector said? (optional)" : "What did the inspector want fixed?", "");
    if (note == null) return;
    void run(`result:${row.id}`, () => recordProjectInspection(row.id, result, note));
  }

  const lateOf = (st: PdTimeline["stages"][number]) => (st.status !== "DONE" && st.endsAt && iso(st.endsAt)! < today ? workDaysLate(iso(st.endsAt)!, today) : 0);
  // Lanes (part 4): the house's stages first, then each side lane (Site, Shop) under its own label row.
  const firstAt = (lane: string) => Math.min(...stages.filter((st) => (st.lane ?? "") === lane).map((st) => st.position));
  const lanes = [...new Set(stages.map((st) => st.lane ?? ""))].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : firstAt(a) - firstAt(b)));
  const laneRows: Array<{ kind: "lane"; lane: string } | { kind: "stage"; st: PdTimeline["stages"][number] }> = lanes.flatMap((lane) => [...(lane ? [{ kind: "lane" as const, lane }] : []), ...stages.filter((st) => (st.lane ?? "") === lane).map((st) => ({ kind: "stage" as const, st }))]);
  const chained = stages.some((st) => st.afterId);
  const stageName = (id: string | null) => stages.find((st) => st.id === id)?.name ?? null;
  const next = timeline.inspections.filter((i) => i.result === "PENDING" && i.date && i.date >= today).sort((a, b) => a.date!.localeCompare(b.date!))[0];

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Timeline" data-project-timeline>
        <div className={s.head}>
          <h3 className={s.title}>Timeline</h3>
          <span className={s.headSub}>
            {dated.length ? (
              <>
                <b>{dayLabel(win.from)}</b> – <b>{dayLabel(win.to)}</b>
                {next ? ` · next inspection ${next.name}, ${dayLabelLong(next.date)}` : ""}
              </>
            ) : (
              "The stages across the weeks, with deliveries and inspections on them"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              {undated.length ? (
                <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setLayout({ from: addWorkDays(today, 1), workDays: "" })} data-timeline-layout>
                  Lay out the days
                </button>
              ) : null}
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openInspection(null)} data-inspection-add>
                + Inspection
              </button>
            </div>
          ) : null}
        </div>

        {dated.length ? (
          <div className={s.tlScroll}>
            <div className={s.tl} data-timeline-chart style={{ minWidth: Math.max(520, win.weeks.length * 64) }}>
              <div className={s.tlWeeks} aria-hidden="true">
                <span className={s.tlName} />
                <span className={s.tlTrack}>
                  {win.weeks.map((w) => (
                    <i key={w.from} className={s.tlWeek} style={{ left: `${w.left}%`, width: `${w.width}%` }}>
                      {w.label}
                    </i>
                  ))}
                </span>
              </div>
              {laneRows.map((row) => {
                if (row.kind === "lane") {
                  return (
                    <div key={`lane:${row.lane}`} className={s.tlRow} data-timeline-lane={row.lane}>
                      <span className={s.tlName}>
                        <i className={s.tlLane}>{row.lane} lane</i>
                      </span>
                      <span className={s.tlTrack} aria-hidden="true" />
                    </div>
                  );
                }
                const st = row.st;
                const bar = barOf(iso(st.startsAt), iso(st.endsAt), win);
                const late = lateOf(st);
                const marks = [
                  ...timeline.deliveries.filter((d) => d.stageId === st.id).map((d) => ({ key: `d:${d.id}`, left: markOf(d.day, win), kind: "delivery" as const, tone: d.status === "DELIVERED" ? "in" : d.status === "PARTIAL" ? "late" : "wait", title: `Order ${d.number} · ${d.from} · ${d.status === "DELIVERED" ? "delivered" : "expected"} ${dayLabel(d.day)}` })),
                  ...timeline.inspections.filter((i) => i.stageId === st.id).map((i) => ({ key: `i:${i.id}`, left: markOf(i.date, win), kind: "inspection" as const, tone: i.result === "PASSED" ? "in" : i.result === "FAILED" ? "late" : "wait", title: `${i.name} · ${RESULT_LABEL[inspectionResultOf(i.result)]}${i.date ? ` ${dayLabel(i.date)}` : ""}` })),
                ];
                return (
                  <div key={st.id} className={s.tlRow} data-timeline-stage data-stage-status={st.status} data-stage-late={late ? "1" : "0"}>
                    <span className={s.tlName} title={st.name}>
                      <b className={s.tlNameText}>{st.name}</b>
                      {canManage && st.status !== "DONE" && bar ? (
                        <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={() => openShift(st)} data-shift-open aria-label={`Shift what comes after ${st.name}`}>
                          {late ? `${workDaysWords(late)} late · shift` : "shift"}
                        </button>
                      ) : null}
                    </span>
                    <span className={s.tlTrack}>
                      {win.weeks.map((w) => (
                        <i key={w.from} className={s.tlGrid} style={{ left: `${w.left}%` }} aria-hidden="true" />
                      ))}
                      {bar ? (
                        <i
                          className={`${s.tlBar} ${st.status === "DONE" ? s.tlBarDone : st.status === "ACTIVE" ? s.tlBarActive : ""} ${late ? s.tlBarLate : ""}`}
                          style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                          title={`${st.name}: ${dayLabel(iso(st.startsAt) ?? iso(st.endsAt))} – ${dayLabel(iso(st.endsAt) ?? iso(st.startsAt))}${late ? ` · ${workDaysWords(late)} late` : ""}`}
                        />
                      ) : (
                        <i className={s.tlNoBar}>no days yet</i>
                      )}
                      {marks.map((m) =>
                        m.left == null ? null : (
                          <b key={m.key} className={`${s.tlMark} ${m.kind === "delivery" ? s.tlDelivery : s.tlInspection} ${m.tone === "in" ? s.tagIn : m.tone === "late" ? s.tagLate : s.tagOrdered}`} style={{ left: `${m.left}%` }} title={m.title} data-timeline-mark={m.kind}>
                            {m.kind === "delivery" ? "▼" : "◆"}
                          </b>
                        ),
                      )}
                    </span>
                  </div>
                );
              })}
              {timeline.inspections.some((i) => !i.stageId && i.date) ? (
                <div className={s.tlRow} data-timeline-inspections>
                  <span className={s.tlName}>Inspections</span>
                  <span className={s.tlTrack}>
                    {timeline.inspections
                      .filter((i) => !i.stageId)
                      .map((i) => {
                        const left = markOf(i.date, win);
                        return left == null ? null : (
                          <b key={i.id} className={`${s.tlMark} ${s.tlInspection} ${i.result === "PASSED" ? s.tagIn : i.result === "FAILED" ? s.tagLate : s.tagOrdered}`} style={{ left: `${left}%` }} title={`${i.name} · ${dayLabel(i.date)}`} data-timeline-mark="inspection">
                            ◆
                          </b>
                        );
                      })}
                  </span>
                </div>
              ) : null}
              {timeline.crewDays.length ? (
                <div className={`${s.tlRow} ${s.tlCrewRow}`} data-timeline-crew>
                  <span className={s.tlName}>Crew on site</span>
                  <span className={s.tlTrack}>
                    {timeline.crewDays.map((c) => {
                      const left = markOf(c.day, win);
                      return left == null ? null : <i key={`${c.day}:${c.jobId}`} className={s.tlCrewDay} style={{ left: `${left}%`, width: `${100 / win.days}%` }} title={`${c.jobTitle} · ${dayLabelLong(c.day)}`} />;
                    })}
                  </span>
                </div>
              ) : null}
              {win.todayLeft != null ? (
                <div className={s.tlTodayRow} aria-hidden="true">
                  <span className={s.tlName} />
                  <span className={s.tlTrack}>
                    <i className={s.tlToday} style={{ left: `${win.todayLeft}%` }}>
                      today
                    </i>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={s.empty} data-timeline-empty>
            {stages.length ? "The stages have no days yet. " : "No stages yet — add them on the Stages card first. "}
            {canManage && undated.length ? "Lay out the days puts them back to back from a day you pick; Edit on a stage sets its own." : ""}
          </div>
        )}
        {dated.length ? (
          <p className={s.tlLegend} aria-hidden="true">
            <i className={`${s.tlKey} ${s.tlBarDone}`} /> done <i className={`${s.tlKey} ${s.tlBarActive}`} /> in progress <i className={s.tlKey} /> planned <b className={s.tagOrdered}>▼</b> delivery <b className={s.tagOrdered}>◆</b> inspection
          </p>
        ) : null}

        {timeline.inspections.length ? (
          <div className={s.group} data-inspections>
            <div className={s.groupHead}>
              <span>Inspections</span>
              <span>· {timeline.inspections.filter((i) => i.result === "PASSED").length} passed of {timeline.inspections.length}</span>
            </div>
            {timeline.inspections.map((i) => {
              const r = inspectionResultOf(i.result);
              const passedDay = r === "PENDING" && i.date && i.date < today;
              return (
                <div key={i.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-inspection data-inspection-result={r}>
                  <span className={s.lineName}>
                    {i.name}
                    {i.isFinal ? <span className={s.tag} style={{ marginLeft: 8 }}>final</span> : null}
                    {i.gate && i.stageId && r !== "PASSED" ? (
                      <span className={s.tag} style={{ marginLeft: 8 }} title={`${stageName(i.stageId) ?? "The stage"} cannot be marked done until this passes`} data-inspection-gate>
                        holds {stageName(i.stageId) ?? "its stage"}
                      </span>
                    ) : null}
                    <span className={s.lineSub} style={{ display: "block" }}>
                      {[i.date ? dayLabelLong(i.date) : "no day set", stageName(i.stageId) ? `on ${stageName(i.stageId)}` : null, i.readyNote ? `have ready: ${i.readyNote}` : null, i.resultNote ? `“${i.resultNote}”` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={s.rowActs}>
                    <span className={`${s.tag} ${r === "PASSED" ? s.tagIn : r === "FAILED" ? s.tagLate : passedDay ? s.tagLate : s.tagOrdered}`}>{r === "PENDING" && passedDay ? "result?" : RESULT_LABEL[r]}</span>
                    {canManage && r === "PENDING" ? (
                      <>
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => record(i, "PASSED")} data-inspection-pass>
                          Passed
                        </button>
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => record(i, "FAILED")} data-inspection-fail>
                          Failed
                        </button>
                      </>
                    ) : null}
                    {canManage && r !== "PENDING" ? (
                      <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`reopen:${i.id}`, () => recordProjectInspection(i.id, "PENDING", null))} data-inspection-reopen>
                        {r === "FAILED" ? "Re-inspect" : "Reopen"}
                      </button>
                    ) : null}
                    {canManage ? (
                      <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openInspection(i)} aria-label={`Edit ${i.name}`} data-inspection-edit>
                        Edit
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {err ? <div className={s.err}>{err}</div> : null}
      </section>

      {/* SHIFT THE REST — read back before the yes. */}
      <BlueprintSheet
        open={shift !== null}
        onClose={() => setShift(null)}
        title="Shift the rest"
        description={shift ? `"${shift.name}" slipped. ${chained ? "Everything that depends on it moves" : "Everything after it moves"} by work days — Mon to Fri; a weekend day goes to the Monday.` : undefined}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setShift(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="bps-btn bps-btn--primary"
              disabled={!shift || !(Number(shift.days) >= 1) || !plan || "error" in plan || busy !== null}
              data-shift-apply
              onClick={() => {
                if (!shift) return;
                const { stageId, days } = shift;
                setShift(null);
                void run(`shift:${stageId}`, async () => {
                  await shiftTheRest(projectId, stageId, Number(days));
                });
              }}
            >
              Shift
            </button>
          </>
        }
      >
        {shift ? (
          <div className="bps-form">
            <label className="bps-fld">
              <span className="bps-lbl">Work days</span>
              <input className="bps-in" inputMode="numeric" value={shift.days} onChange={(e) => setShift({ ...shift, days: e.target.value.replace(/[^\d]/g, "") })} autoFocus data-shift-days />
            </label>
            <div className="bps-fld bps-fld--wide">
              {!plan ? (
                <p className="bps-hint">Reading what moves…</p>
              ) : "error" in plan ? (
                <div className="bps-err">{plan.error}</div>
              ) : (
                <ul className={s.planList} data-shift-plan>
                  {plan.words.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* LAY OUT THE DAYS — the undated stages back to back. */}
      <BlueprintSheet
        open={layout !== null}
        onClose={() => setLayout(null)}
        title="Lay out the days"
        description={`${undated.length} stage${undated.length === 1 ? " has" : "s have"} no days. Each gets work days by its share of the work — about three a unit — or the lot fits the length you give. Move any of them after.`}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setLayout(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="bps-btn bps-btn--primary"
              disabled={!layout || !layout.from || busy !== null}
              data-layout-apply
              onClick={() => {
                if (!layout) return;
                const { from, workDays } = layout;
                setLayout(null);
                void run("layout", async () => {
                  await layOutStages(projectId, { from, workDays: workDays ? Number(workDays) : null });
                });
              }}
            >
              Lay them out
            </button>
          </>
        }
      >
        {layout ? (
          <div className="bps-form">
            <label className="bps-fld">
              <span className="bps-lbl">First day</span>
              <input className="bps-in" type="date" value={layout.from} onChange={(e) => setLayout({ ...layout, from: e.target.value })} data-layout-from />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Work days in all (optional)</span>
              <input className="bps-in" inputMode="numeric" value={layout.workDays} placeholder="e.g. 30" onChange={(e) => setLayout({ ...layout, workDays: e.target.value.replace(/[^\d]/g, "") })} data-layout-days />
            </label>
            <p className="bps-hint bps-fld--wide">Stages that already have days keep them; the undated ones follow after.</p>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* ONE INSPECTION — its day, what to have ready, which stage it belongs to. */}
      <BlueprintSheet
        open={insp !== null}
        onClose={() => setInsp(null)}
        title={insp?.id ? "Edit inspection" : "Inspection"}
        description="The day it is booked for and what the inspector needs ready — the crew sees it on the job the day before."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setInsp(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void saveInspection()} data-inspection-save>
              {insp?.id ? "Save" : "Add"}
            </button>
          </>
        }
      >
        {insp ? (
          <div className="bps-form">
            {!insp.id ? (
              <div className={`bps-fld bps-fld--wide ${s.chips}`} style={{ marginTop: 0 }}>
                {PRESETS.map((p) => (
                  <button key={p.name} type="button" className="bps-btn bps-btn--ghost" onClick={() => setInsp({ ...insp, name: p.name, isFinal: p.isFinal })}>
                    {p.name}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Inspection</span>
              <input className="bps-in" value={insp.name} onChange={(e) => setInsp({ ...insp, name: e.target.value })} placeholder="Rough-in" maxLength={120} autoFocus data-inspection-name />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Day</span>
              <input className="bps-in" type="date" value={insp.date} onChange={(e) => setInsp({ ...insp, date: e.target.value })} data-inspection-date />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">On stage</span>
              <select className="bps-in" value={insp.stageId} onChange={(e) => setInsp({ ...insp, stageId: e.target.value })}>
                <option value="">— none —</option>
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Have ready</span>
              <textarea className="bps-in" rows={3} value={insp.readyNote} onChange={(e) => setInsp({ ...insp, readyNote: e.target.value })} placeholder="The permit card on site, the plans, a ladder to the attic" maxLength={1000} data-inspection-ready />
            </label>
            <label className={`bps-fld bps-fld--wide ${s.check}`}>
              <input type="checkbox" checked={insp.stageId ? insp.gate : false} disabled={!insp.stageId} onChange={(e) => setInsp({ ...insp, gate: e.target.checked })} data-inspection-gate-box />
              <span className="bps-lbl" style={{ margin: 0 }}>
                Holds the stage until it passes{insp.stageId ? "" : " — pick a stage first"}
              </span>
            </label>
            <label className={`bps-fld bps-fld--wide ${s.check}`}>
              <input type="checkbox" checked={insp.isFinal} onChange={(e) => setInsp({ ...insp, isFinal: e.target.checked })} />
              <span className="bps-lbl" style={{ margin: 0 }}>
                This is the final inspection
              </span>
            </label>
            {insp.id ? (
              <div className={`bps-fld bps-fld--wide ${s.chips}`}>
                <button
                  type="button"
                  className="bps-btn bps-btn--ghost"
                  data-inspection-delete
                  onClick={() => {
                    const id = insp.id!;
                    setInsp(null);
                    void run(`del:${id}`, () => deleteProjectInspection(id));
                  }}
                >
                  Remove inspection
                </button>
              </div>
            ) : null}
            {inspErr ? <div className="bps-err bps-fld--wide">{inspErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
