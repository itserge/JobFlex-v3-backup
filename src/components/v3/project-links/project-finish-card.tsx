"use client";

// THE FINISH LINE OF A PROJECT (the timeline build, 2026-11-06). One card for the desktop and the handheld project
// page: the seven steps to the end, in order, each done, next or still to do — the punch list (its items right
// here, ticked with an "after" photo), the final inspection, the client's sign-off, the final payment, the review,
// the warranty, finished and archived — and one button for the next step. The rules are lib/projectFinish/shared;
// the writes actions/projectFinish (estimators and managers); the invoice goes through actions/notify as the
// Payments card sends it. Everyone else reads the card.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { sendInstallmentInvoice } from "@/actions/notify";
import {
  addProjectInspection,
  addPunchList,
  archiveFinishedProject,
  askProjectReview,
  clientSignedOff,
  markProjectFinished,
  recordProjectInspection,
  removePunchItem,
  reopenFinishedProject,
  setProjectWarranty,
  setPunchDone,
  undoClientSignOff,
  updateProjectInspection,
} from "@/actions/projectFinish";
import { setTaskDone } from "@/actions/projectStages";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdFinish, PdPayments } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { uploadJobMedia } from "@/lib/media/uploadJobMedia";
import { atFinishLine, finishSteps, warrantyDefault, type FinishStep } from "@/lib/projectFinish/shared";
import { addWorkDays, dayLabelLong } from "@/lib/projectTimeline/shared";
import s from "./project-hub.module.css";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const todayISO = () => new Date().toISOString().slice(0, 10);

export function ProjectFinishCard({ projectId, finish, jobs, payments = [], canManage }: { projectId: string; finish: PdFinish; jobs: Array<{ id: string; title: string }>; payments?: PdPayments; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ text: string; jobId: string } | null>(null);
  const [finalSheet, setFinalSheet] = useState<{ date: string; readyNote: string } | null>(null);
  const [warrantyEdit, setWarrantyEdit] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const steps = finishSteps(finish);
  const doneCount = steps.filter((x) => x.state === "done").length;
  const nextStep = steps.find((x) => x.state === "next") ?? null;
  const here = atFinishLine(finish);
  const open = finish.punchItems.filter((p) => !(p.id in ticked ? ticked[p.id] : p.done));
  const closed = finish.punchItems.filter((p) => (p.id in ticked ? ticked[p.id] : p.done));
  const owedOn = payments.filter((p) => p.remaining > 0.5);
  const [expanded, setExpanded] = useState(here || doneCount > 0 || finish.punchItems.length > 0);
  const refresh = () => startTransition(() => router.refresh());

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
      setTicked({});
    } finally {
      setBusy(null);
    }
  }

  async function punchPhoto(file: File) {
    const itemId = photoFor;
    if (!itemId) return;
    const item = finish.punchItems.find((p) => p.id === itemId);
    const jobId = item?.jobId ?? jobs[0]?.id;
    if (!jobId) return setErr("Add a job to the project first — a photo lives on a job.");
    await run(`photo:${itemId}`, async () => {
      const up = await uploadJobMedia({ jobId, door: { session: true }, file, kind: "AFTER" });
      setTicked((cur) => ({ ...cur, [itemId]: true }));
      await setPunchDone(itemId, true, up.id);
    });
    setPhotoFor(null);
  }

  async function saveFinal() {
    if (!finalSheet) return;
    const data = { name: "Final inspection", date: finalSheet.date || null, readyNote: finalSheet.readyNote.trim() || null, isFinal: true };
    const existing = finish.finalInspection?.id ?? null;
    setFinalSheet(null);
    await run("final", async () => {
      if (existing) {
        await updateProjectInspection(projectId, existing, data);
        if (finish.finalInspection?.result === "FAILED") await recordProjectInspection(existing, "PENDING", null);
      } else await addProjectInspection(projectId, data);
    });
  }

  function action(step: FinishStep) {
    if (!canManage) return null;
    const fi = finish.finalInspection;
    // A new build's steps (part 4) are the Final stage's tasks: Done ticks the task.
    if (step.key === "co" || step.key === "handover" || step.key === "walkthrough") {
      const fact = finish.build?.[step.key] ?? null;
      if (!fact || fact.done) return null;
      return (
        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`build:${step.key}`, () => setTaskDone(fact.taskId, true).then(() => undefined))} data-build-step-done>
          Done
        </button>
      );
    }
    switch (step.key) {
      case "punch":
        return (
          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setAdding({ text: "", jobId: jobs[0]?.id ?? "" })} data-punch-add>
            + Items
          </button>
        );
      case "inspection":
        if (!fi || fi.result === "FAILED")
          return (
            <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setFinalSheet({ date: fi?.date ?? addWorkDays(todayISO(), 3), readyNote: fi?.readyNote ?? "" })} data-final-schedule>
              {fi ? "Schedule again" : "Schedule it"}
            </button>
          );
        if (fi.result === "PENDING")
          return (
            <>
              <button
                type="button"
                className={s.btnSm}
                disabled={busy !== null}
                data-final-pass
                onClick={() => {
                  const n = window.prompt("Anything the inspector said? (optional)", "");
                  if (n == null) return;
                  void run("final:pass", () => recordProjectInspection(fi.id, "PASSED", n));
                }}
              >
                Passed
              </button>
              <button
                type="button"
                className={s.btnSm}
                disabled={busy !== null}
                data-final-fail
                onClick={() => {
                  const n = window.prompt("What did the inspector want fixed?", "");
                  if (n == null) return;
                  void run("final:fail", () => recordProjectInspection(fi.id, "FAILED", n));
                }}
              >
                Failed
              </button>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setFinalSheet({ date: fi.date ?? "", readyNote: fi.readyNote ?? "" })} aria-label="Edit the final inspection">
                Edit
              </button>
            </>
          );
        return null;
      case "signoff":
        return finish.signedOffAt ? (
          <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={() => void run("signoff:undo", () => undoClientSignOff(projectId))}>
            undo
          </button>
        ) : (
          <button
            type="button"
            className={s.btnSm}
            disabled={busy !== null}
            data-signoff
            onClick={() => {
              const by = window.prompt("Who signed off?", finish.clientName ?? "");
              if (by == null) return;
              void run("signoff", () => clientSignedOff(projectId, by));
            }}
          >
            Client signed off
          </button>
        );
      case "payment":
        return owedOn.length ? (
          <button
            type="button"
            className={s.btnSm}
            disabled={busy !== null}
            data-final-invoice
            onClick={() =>
              void run("invoice", async () => {
                const lines: string[] = [];
                for (const p of owedOn) {
                  const r = await sendInstallmentInvoice(p.proposalId, null, "any");
                  if (!r.ok) throw new Error(r.error ?? "Could not send the invoice");
                  lines.push(`${r.label} ${money(r.amount)} — ${[r.email ? "emailed" : null, r.sms ? "texted" : null].filter(Boolean).join(" and ") || "link made"}: ${r.href}`);
                }
                setNote(lines.join("\n"));
              })
            }
          >
            {busy === "invoice" ? "Sending…" : `Invoice ${money(owedOn.reduce((n, p) => n + p.remaining, 0))}`}
          </button>
        ) : null;
      case "review":
        return finish.review?.askedAt ? (
          finish.reviewHref ? (
            <a className={s.lineBtn} href={finish.reviewHref} target="_blank" rel="noreferrer">
              the link
            </a>
          ) : null
        ) : (
          <button
            type="button"
            className={s.btnSm}
            disabled={busy !== null}
            data-ask-review
            onClick={() =>
              void run("review", async () => {
                const r = await askProjectReview(projectId);
                setNote(r.emailed ? "The review request went to the client by email." : `No client email on file — send them this link: ${typeof window !== "undefined" ? window.location.origin : ""}${r.href}`);
              })
            }
          >
            {finish.review ? "Send the link" : "Ask for a review"}
          </button>
        );
      case "warranty":
        return warrantyEdit !== null ? (
          <span className={s.chips} style={{ marginTop: 0 }}>
            <input className={s.inlineDate} type="date" value={warrantyEdit} onChange={(e) => setWarrantyEdit(e.target.value)} aria-label="Warranty until" data-warranty-date />
            <button
              type="button"
              className={s.btnSm}
              disabled={busy !== null || !warrantyEdit}
              data-warranty-save
              onClick={() => {
                const until = warrantyEdit;
                setWarrantyEdit(null);
                void run("warranty", () => setProjectWarranty(projectId, until));
              }}
            >
              Save
            </button>
            <button type="button" className={s.lineBtn} onClick={() => setWarrantyEdit(null)}>
              cancel
            </button>
          </span>
        ) : (
          <button type="button" className={finish.warrantyUntil ? s.lineBtn : s.btnSm} disabled={busy !== null} onClick={() => setWarrantyEdit((finish.warrantyUntil ?? warrantyDefault(finish.signedOffAt ?? todayISO())).slice(0, 10))} data-warranty-set>
            {finish.warrantyUntil ? "change" : "Set 12 months"}
          </button>
        );
      case "finish":
        if (finish.status === "ARCHIVED")
          return (
            <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={() => void run("reopen", () => reopenFinishedProject(projectId))}>
              reopen
            </button>
          );
        if (finish.status === "COMPLETED")
          return (
            <>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run("archive", () => archiveFinishedProject(projectId))} data-archive>
                Archive
              </button>
              <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={() => void run("reopen", () => reopenFinishedProject(projectId))}>
                reopen
              </button>
            </>
          );
        return (
          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run("finish", () => markProjectFinished(projectId))} data-finish>
            Mark finished
          </button>
        );
    }
  }

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Finish line" data-project-finish data-finish-done={doneCount}>
        <div className={s.head}>
          <h3 className={s.title}>Finish line</h3>
          <span className={s.headSub}>
            {finish.status === "ARCHIVED" ? (
              "Archived"
            ) : doneCount === steps.length ? (
              "Every step done"
            ) : (
              <>
                <b>{doneCount}</b> of {steps.length} steps{nextStep ? ` · next: ${nextStep.label.toLowerCase()}` : ""}
                {!here && !doneCount ? " · after the last stage" : ""}
              </>
            )}
          </span>
          <div className={s.acts}>
            {canManage && !expanded ? (
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setAdding({ text: "", jobId: jobs[0]?.id ?? "" })} data-punch-add>
                + Punch items
              </button>
            ) : null}
            <button type="button" className={s.lineBtn} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-finish-toggle>
              {expanded ? "fold" : "show the steps"}
            </button>
          </div>
        </div>

        {expanded ? (
          <div className={s.steps} data-finish-steps>
            {steps.map((step) => (
              <div key={step.key} className={`${s.step} ${step.state === "done" ? s.isDone : step.state === "next" ? s.isActive : ""}`} data-finish-step={step.key} data-step-state={step.state}>
                <span className={s.mark} aria-hidden="true">
                  {step.state === "done" ? "✓" : step.state === "next" ? "▶" : ""}
                </span>
                <span className={s.stepLabel}>{step.label}</span>
                <span className={s.stepDetail}>{step.detail}</span>
                <span className={s.rowActs}>{action(step)}</span>
                {step.key === "punch" && finish.punchItems.length ? (
                  <div className={s.punchList} data-punch-list>
                    {open.map((p) => (
                      <div key={p.id} className={s.punchRow} data-punch-item>
                        <input
                          type="checkbox"
                          checked={false}
                          disabled={!canManage || busy !== null}
                          aria-label={`Done: ${p.note}`}
                          onChange={() => {
                            setTicked((cur) => ({ ...cur, [p.id]: true }));
                            void run(`punch:${p.id}`, async () => {
                              await setPunchDone(p.id, true, null);
                            });
                          }}
                        />
                        <span className={s.lineName}>
                          {p.note}
                          {p.jobTitle ? <span className={s.lineSub} style={{ display: "block" }}>{p.jobTitle}</span> : null}
                        </span>
                        {canManage ? (
                          <span className={s.rowActs}>
                            <button
                              type="button"
                              className={s.btnSm}
                              disabled={busy !== null}
                              data-punch-photo
                              onClick={() => {
                                setPhotoFor(p.id);
                                photoRef.current?.click();
                              }}
                            >
                              <Camera size={14} aria-hidden="true" /> {busy === `photo:${p.id}` ? "Sending…" : "Done + photo"}
                            </button>
                            <button type="button" className={s.taskX} aria-label={`Remove ${p.note}`} disabled={busy !== null} onClick={() => void run(`del:${p.id}`, () => removePunchItem(p.id))}>
                              ×
                            </button>
                          </span>
                        ) : null}
                      </div>
                    ))}
                    {closed.length ? (
                      <p className={s.headSub} style={{ margin: "6px 0 0" }}>
                        <button type="button" className={s.lineBtn} onClick={() => setShowDone((v) => !v)}>
                          {showDone ? "Hide" : "Show"} {closed.length} done
                        </button>
                      </p>
                    ) : null}
                    {showDone
                      ? closed.map((p) => (
                          <div key={p.id} className={`${s.punchRow} ${s.punchDone}`} data-punch-item data-punch-done="1">
                            <input
                              type="checkbox"
                              checked
                              disabled={!canManage || busy !== null}
                              aria-label={`Reopen: ${p.note}`}
                              onChange={() => {
                                setTicked((cur) => ({ ...cur, [p.id]: false }));
                                void run(`punch:${p.id}`, async () => {
                                  await setPunchDone(p.id, false, null);
                                });
                              }}
                            />
                            <span className={s.lineName}>
                              <span className={s.taskDone}>{p.note}</span>
                              <span className={s.lineSub} style={{ display: "block" }}>
                                {[p.by, p.doneAt ? dayLabelLong(p.doneAt.slice(0, 10)) : null].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            {p.photo ? (
                              <a href={p.photo.href} target="_blank" rel="noreferrer" className={s.punchThumb} aria-label="The after photo">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.photo.href} alt="" />
                              </a>
                            ) : null}
                          </div>
                        ))
                      : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          aria-hidden="true"
          tabIndex={-1}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void punchPhoto(f);
            else setPhotoFor(null);
          }}
        />
        {note ? (
          <div className={s.note} data-finish-note style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {note}{" "}
            <button type="button" className={s.lineBtn} onClick={() => setNote(null)}>
              ok
            </button>
          </div>
        ) : null}
        {err ? <div className={s.err}>{err}</div> : null}
      </section>

      {/* PUNCH ITEMS — one per line. */}
      <BlueprintSheet
        open={adding !== null}
        onClose={() => setAdding(null)}
        title="Punch list"
        description="The small things left at the end, one per line. The crew ticks them from the job's board and adds the after photo."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setAdding(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="bps-btn bps-btn--primary"
              disabled={!adding || !adding.text.trim() || busy !== null}
              data-punch-save
              onClick={() => {
                if (!adding) return;
                const notes = adding.text.split("\n").map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
                const jobId = adding.jobId || null;
                setAdding(null);
                setExpanded(true);
                void run("punch:add", async () => {
                  await addPunchList(projectId, notes, jobId);
                });
              }}
            >
              Add
            </button>
          </>
        }
      >
        {adding ? (
          <div className="bps-form">
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Items</span>
              <textarea className="bps-in" rows={6} value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} placeholder={"Touch up the paint by the pantry door\nCaulk the tub spout\nAdjust the closet door"} autoFocus data-punch-text />
            </label>
            {jobs.length > 1 ? (
              <label className="bps-fld bps-fld--wide">
                <span className="bps-lbl">For the crew on</span>
                <select className="bps-in" value={adding.jobId} onChange={(e) => setAdding({ ...adding, jobId: e.target.value })}>
                  <option value="">any job on the project</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* THE FINAL INSPECTION — its day and what to have ready. */}
      <BlueprintSheet
        open={finalSheet !== null}
        onClose={() => setFinalSheet(null)}
        title="Final inspection"
        description="The day it is booked for and what the inspector needs ready. It shows on the timeline and the job the day before."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setFinalSheet(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void saveFinal()} data-final-save>
              Save
            </button>
          </>
        }
      >
        {finalSheet ? (
          <div className="bps-form">
            <label className="bps-fld">
              <span className="bps-lbl">Day</span>
              <input className="bps-in" type="date" value={finalSheet.date} onChange={(e) => setFinalSheet({ ...finalSheet, date: e.target.value })} autoFocus data-final-date />
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Have ready</span>
              <textarea className="bps-in" rows={3} value={finalSheet.readyNote} onChange={(e) => setFinalSheet({ ...finalSheet, readyNote: e.target.value })} placeholder="The permit card, the signed-off rough-in, smoke detectors in, access to the panel" maxLength={1000} data-final-ready />
            </label>
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
