"use client";

// STAGES OF A PROJECT (the stages build, 2026-11-05). One card for the desktop and the handheld project page: the
// order of the work as stages — Footings, Framing, Decking and railings — each with its tasks, its days and its
// state, and what they add up to (% done, lib/projectStages/shared percentDone). A new project gets its stages
// from a trade template or the AI's draft (lib/projectStages/server); this card adds, edits, starts, finishes
// and reopens them, and ticks the tasks. "+ Stage" (owner, 2026-11-06: "simplify to add new stage and it would
// add it, and then under this stage you can add more tasks") is one sheet: the name, its days, its tasks one per
// line — with the tasks the templates know for a stage of that name offered as you type — and, for a whole set at
// once, the templates and the AI draft on the same sheet. Every write is actions/projectStages (estimators and
// managers); everyone else reads the card.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addStageWithTasks,
  addStagesFromTemplate,
  addTask,
  deleteStage,
  deleteTask,
  draftStages,
  keepDraftedStages,
  moveStage,
  setStageStatus,
  setTaskDone,
  updateStage,
} from "@/actions/projectStages";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdStages, PdStage } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { currentStage, lateStages, lateWords, percentDone, stageStatusOf, suggestTasks, templatesFor } from "@/lib/projectStages/shared";
import type { ProjectKind } from "@/lib/projectKind";
import { gateHolds, gateShort, gateWords } from "@/lib/projectGates";
import s from "./project-hub.module.css";

/** "Nov 3" from a stage's day (UTC midnight, like the project's own days). */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function dates(st: PdStage): string | null {
  if (st.startsAt && st.endsAt) return `${day(st.startsAt)} – ${day(st.endsAt)}`;
  if (st.startsAt) return `from ${day(st.startsAt)}`;
  if (st.endsAt) return `by ${day(st.endsAt)}`;
  return null;
}

type Editing = { id: string | null; name: string; startsAt: string; endsAt: string; tasks: string };

const taskLines = (text: string) => text.split("\n").map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
/** The gating inspections still holding a stage (part 3, 2026-11-07): Done waits until each has passed. */
const holdingOf = (st: PdStage) => gateHolds((st.gates ?? []).map((g) => ({ ...g, gate: true })));

export function ProjectStagesCard({ projectId, stages: initial, canManage, kind = "REMODEL" }: { projectId: string; stages: PdStages; canManage: boolean; kind?: ProjectKind }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // The rows are the server's, laid over with each tick and status change until the refresh lands — then the
  // fresh rows replace the overlay (state adjusted during render, as React's docs do it, not in an effect).
  const [stages, setStages] = useState<PdStage[]>(initial.stages);
  const [seen, setSeen] = useState(initial.stages);
  if (seen !== initial.stages) {
    setSeen(initial.stages);
    setStages(initial.stages);
  }
  const now = currentStage(stages);
  // The stage the project is on opens with its tasks; the rest fold.
  const [open, setOpen] = useState<Set<string>>(() => new Set(now ? [now.id] : []));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<Record<string, string>>({});

  const done = percentDone(stages);
  const late = new Map(lateStages(stages, new Date()).map((x) => [x.stage.id, x.days]));
  const refresh = () => startTransition(() => router.refresh());

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
      setStages(initial.stages);
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function tick(st: PdStage, task: PdStage["tasks"][number], value: boolean) {
    setStages((cur) =>
      cur.map((x) => {
        if (x.id !== st.id) return x;
        const tasks = x.tasks.map((t) => (t.id === task.id ? { ...t, done: value } : t));
        const allDone = tasks.length > 0 && tasks.every((t) => t.done);
        // The last tick closes the stage — unless a gate holds it (the server says the same).
        const status = value && allDone ? (holdingOf(x).length ? (x.status === "PLANNED" ? "ACTIVE" : x.status) : "DONE") : !value && x.status === "DONE" ? "ACTIVE" : value && x.status === "PLANNED" ? "ACTIVE" : x.status;
        return { ...x, tasks, status };
      }),
    );
    void run(`task:${task.id}`, () => setTaskDone(task.id, value));
  }

  function setStatus(st: PdStage, status: "PLANNED" | "ACTIVE" | "DONE") {
    setStages((cur) => cur.map((x) => (x.id === st.id ? { ...x, status, tasks: status === "DONE" ? x.tasks.map((t) => ({ ...t, done: true })) : x.tasks } : x)));
    if (status === "ACTIVE") setOpen((cur) => new Set(cur).add(st.id));
    void run(`status:${st.id}`, () => setStageStatus(st.id, status));
  }

  async function submitTask(st: PdStage) {
    const title = (newTask[st.id] ?? "").trim();
    if (!title) return;
    setNewTask((cur) => ({ ...cur, [st.id]: "" }));
    await run(`addtask:${st.id}`, async () => {
      await addTask(st.id, { title });
    });
  }

  function openEdit(st: PdStage | null) {
    setEditErr(null);
    setEditing(st ? { id: st.id, name: st.name, startsAt: isoDay(st.startsAt), endsAt: isoDay(st.endsAt), tasks: "" } : { id: null, name: "", startsAt: "", endsAt: "", tasks: "" });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim()) return setEditErr("Name the stage");
    if (editing.startsAt && editing.endsAt && editing.endsAt < editing.startsAt) return setEditErr("The stage ends before it starts");
    const data = { name: editing.name.trim(), startsAt: editing.startsAt || null, endsAt: editing.endsAt || null };
    const id = editing.id;
    const tasks = taskLines(editing.tasks);
    setEditing(null);
    await run(`edit:${id ?? "new"}`, async () => {
      if (id) await updateStage(id, data);
      else await addStageWithTasks(projectId, { ...data, tasks });
    });
  }

  // The suggested tasks for the name typed — the ones not already on the list.
  const suggested = editing && !editing.id ? suggestTasks(editing.name).filter((t) => !taskLines(editing.tasks).some((x) => x.toLowerCase() === t.toLowerCase())) : [];
  const addLine = (t: string) => setEditing((cur) => (cur ? { ...cur, tasks: cur.tasks.trim() ? `${cur.tasks.replace(/\s+$/, "")}\n${t}` : t } : cur));

  /** The whole-set buttons: a trade's template or the AI's draft. Inside a sheet they wear the sheet's own buttons
   *  (the sheet is portalled out of the card, where `.btnSm` is styled). */
  function templates(inSheet: boolean) {
    const cls = inSheet ? "bps-btn bps-btn--ghost" : s.btnSm;
    return (
      <div className={s.chips}>
        {templatesFor(kind).map((t) => (
          <button
            key={t.key}
            type="button"
            className={cls}
            disabled={busy !== null}
            data-stage-template={t.key}
            onClick={() => {
              setEditing(null);
              void run(`tpl:${t.key}`, async () => {
                await addStagesFromTemplate(projectId, t.key);
              });
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className={cls}
          disabled={busy !== null}
          data-stage-draft
          onClick={() => {
            setEditing(null);
            void run("draft", async () => {
              const r = await draftStages(projectId);
              if ("error" in r) throw new Error(r.error);
            });
          }}
        >
          {busy === "draft" ? "Drafting…" : "Draft with AI"}
        </button>
      </div>
    );
  }

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Stages" data-project-stages data-project-done={done ?? ""}>
        <div className={s.head}>
          <h3 className={s.title}>Stages</h3>
          <span className={s.headSub}>
            {done != null ? (
              <>
                <b>{done}%</b> done{now ? ` · ${now.name}` : " · all stages done"}
              </>
            ) : (
              "The order of the work, step by step"
            )}
          </span>
          {canManage && stages.length ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openEdit(null)} data-stage-new>
                + Stage
              </button>
            </div>
          ) : null}
        </div>
        {done != null ? (
          <div className={s.bar} aria-hidden="true">
            <i style={{ width: `${done}%` }} />
          </div>
        ) : null}

        {initial.draftedByAi ? (
          <div className={s.note} data-stages-drafted>
            The AI drafted these stages from what was sold. Keep them, or change any of them.{" "}
            {canManage ? (
              <button type="button" className={s.btnSm} disabled={busy !== null} data-stages-keep onClick={() => void run("keep", () => keepDraftedStages(projectId))}>
                Keep them
              </button>
            ) : null}
          </div>
        ) : null}

        {stages.length ? (
          <div className={s.stageList}>
            {stages.map((st) => {
              const status = stageStatusOf(st.status);
              const isOpen = open.has(st.id);
              const ticked = st.tasks.filter((t) => t.done).length;
              const lateDays = late.get(st.id);
              const when = dates(st);
              const holding = status === "DONE" ? [] : holdingOf(st);
              return (
                <div key={st.id} className={`${s.row} ${status === "DONE" ? s.isDone : ""} ${status === "ACTIVE" ? s.isActive : ""}`} data-stage-row data-stage-status={status} data-stage-id={st.id}>
                  <span className={s.mark} aria-hidden="true">
                    {status === "DONE" ? "✓" : status === "ACTIVE" ? "▶" : ""}
                  </span>
                  <button type="button" className={s.name} onClick={() => toggle(st.id)} aria-expanded={isOpen} data-stage-name>
                    {st.name}
                  </button>
                  <div className={s.meta}>
                    {when ? <span>{when}</span> : null}
                    {st.tasks.length ? <span>{`${ticked} of ${st.tasks.length} task${st.tasks.length === 1 ? "" : "s"}`}</span> : null}
                    {lateDays ? <span className={s.lateTag}>{lateWords(lateDays)}</span> : null}
                    {holding.length ? <span className={holding.some((g) => g.result === "FAILED") ? s.lateTag : undefined} data-stage-gate>{gateShort(holding)}</span> : null}
                    {!when && !st.tasks.length && !holding.length ? <span>{status === "DONE" ? "done" : status === "ACTIVE" ? "in progress" : "planned"}</span> : null}
                  </div>
                  {canManage ? (
                    <div className={s.rowActs}>
                      {status === "DONE" ? (
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setStatus(st, "ACTIVE")} data-stage-reopen>
                          Reopen
                        </button>
                      ) : (
                        <>
                          {status === "PLANNED" ? (
                            <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setStatus(st, "ACTIVE")} data-stage-start>
                              Start
                            </button>
                          ) : null}
                          <button type="button" className={s.btnSm} disabled={busy !== null || holding.length > 0} title={holding.length ? gateWords(holding, st.name) : undefined} onClick={() => setStatus(st, "DONE")} data-stage-done>
                            Done
                          </button>
                        </>
                      )}
                      <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openEdit(st)} aria-label={`Edit ${st.name}`} data-stage-edit>
                        Edit
                      </button>
                    </div>
                  ) : null}
                  {isOpen ? (
                    <div className={s.tasks} data-stage-tasks>
                      {st.tasks.map((t) => (
                        <label key={t.id} className={s.task} data-task>
                          <input type="checkbox" checked={t.done} disabled={!canManage || busy !== null} onChange={(e) => tick(st, t, e.target.checked)} />
                          <span className={t.done ? s.taskDone : ""}>{t.title}</span>
                          {t.photoNeeded ? <span className={s.photo}>photo</span> : null}
                          {canManage ? (
                            <button
                              type="button"
                              className={s.taskX}
                              aria-label={`Remove ${t.title}`}
                              disabled={busy !== null}
                              onClick={(e) => {
                                e.preventDefault();
                                setStages((cur) => cur.map((x) => (x.id === st.id ? { ...x, tasks: x.tasks.filter((y) => y.id !== t.id) } : x)));
                                void run(`deltask:${t.id}`, () => deleteTask(t.id));
                              }}
                            >
                              ×
                            </button>
                          ) : null}
                        </label>
                      ))}
                      {canManage ? (
                        <form
                          className={s.taskAdd}
                          onSubmit={(e) => {
                            e.preventDefault();
                            void submitTask(st);
                          }}
                        >
                          <input value={newTask[st.id] ?? ""} onChange={(e) => setNewTask((cur) => ({ ...cur, [st.id]: e.target.value }))} placeholder="Add a task" maxLength={200} aria-label={`New task in ${st.name}`} data-task-new />
                          <button type="submit" className={s.btnSm} disabled={busy !== null || !(newTask[st.id] ?? "").trim()}>
                            Add
                          </button>
                        </form>
                      ) : null}
                      {!st.tasks.length && !canManage ? <span className={s.headSub}>No tasks</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={s.empty} data-stages-empty>
            No stages yet. {canManage ? "Start from a template for the trade, let the AI draft them from what was sold, or add them one at a time." : "The office adds them."}
            {canManage ? (
              <>
                {templates(false)}
                <div className={s.chips}>
                  <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openEdit(null)} data-stage-new>
                    + Stage
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
        {err ? <div className={s.err}>{err}</div> : null}
      </section>

      {/* ONE STAGE — new: its name, days and tasks (the templates' tasks offered as you type), or a whole set;
          existing: its name and days; move it or take it off the project. */}
      <BlueprintSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit stage" : "New stage"}
        description={editing?.id ? undefined : "The stage goes after the ones you have. Its tasks are what the crew ticks off on site."}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void saveEdit()} data-stage-save>
              {editing?.id ? "Save" : taskLines(editing?.tasks ?? "").length ? `Add stage · ${taskLines(editing?.tasks ?? "").length} task${taskLines(editing?.tasks ?? "").length === 1 ? "" : "s"}` : "Add stage"}
            </button>
          </>
        }
      >
        {editing ? (
          <div className="bps-form">
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Stage</span>
              <input className="bps-in" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} placeholder="Drywall and paint" autoFocus data-stage-name-input />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">First day</span>
              <input className="bps-in" type="date" value={editing.startsAt} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })} />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Last day</span>
              <input className="bps-in" type="date" value={editing.endsAt} min={editing.startsAt || undefined} onChange={(e) => setEditing({ ...editing, endsAt: e.target.value })} />
            </label>
            {!editing.id ? (
              <>
                <label className="bps-fld bps-fld--wide">
                  <span className="bps-lbl">Tasks — one per line</span>
                  <textarea className="bps-in" rows={4} value={editing.tasks} onChange={(e) => setEditing({ ...editing, tasks: e.target.value })} placeholder={"Hang the drywall\nTape and mud\nPrime and paint"} data-stage-tasks-input />
                </label>
                {suggested.length ? (
                  <div className="bps-fld bps-fld--wide" data-stage-suggested>
                    <span className="bps-lbl">Usual for a stage like this — tap to add</span>
                    <div className={s.chips} style={{ marginTop: 6 }}>
                      {suggested.map((t) => (
                        <button key={t} type="button" className="bps-btn bps-btn--ghost" onClick={() => addLine(t)} data-stage-suggest>
                          + {t}
                        </button>
                      ))}
                      {suggested.length > 1 ? (
                        <button type="button" className="bps-btn bps-btn--ghost" onClick={() => suggested.forEach(addLine)} data-stage-suggest-all>
                          Add all
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="bps-fld bps-fld--wide" data-stage-sets>
                  <span className="bps-lbl">Or a whole set of stages at once</span>
                  {templates(true)}
                </div>
              </>
            ) : (
              <div className={`bps-fld bps-fld--wide ${s.chips}`}>
                <button type="button" className="bps-btn bps-btn--ghost" onClick={() => void run(`up:${editing.id}`, () => moveStage(editing.id!, "up")).then(() => setEditing(null))}>
                  Move up
                </button>
                <button type="button" className="bps-btn bps-btn--ghost" onClick={() => void run(`down:${editing.id}`, () => moveStage(editing.id!, "down")).then(() => setEditing(null))}>
                  Move down
                </button>
                <button
                  type="button"
                  className="bps-btn bps-btn--ghost"
                  data-stage-delete
                  onClick={() => {
                    const id = editing.id!;
                    setEditing(null);
                    setStages((cur) => cur.filter((x) => x.id !== id));
                    void run(`del:${id}`, () => deleteStage(id));
                  }}
                >
                  Remove stage
                </button>
              </div>
            )}
            <p className="bps-hint bps-fld--wide">Days are the plan; a stage past its last day and not done shows as late on the project and in the list.</p>
            {editErr ? <div className="bps-err bps-fld--wide">{editErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
