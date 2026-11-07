"use client";
// SELECTIONS — the card (2026-11-07, part 3 of the plan "Projects: Remodel and New construction"). On the desktop and
// the handheld project page, before Buying: what the client has to choose — cabinets, counters, tile, fixtures,
// flooring, paint — grouped by the stage that needs it, each with the day the choice must be in (the stage's first
// day less its lead time, the way a material gets its order-by day; a day set by hand wins), the allowance set (or
// the one the proposal's material lines suggest), and once chosen what was picked, from whom, at what price, against
// the allowance. "Chosen…" is one sheet; "+ Selection" / Edit another. The templates seed the usual selections
// (lib/projectStages); a late one flags the project on the list like a late order. Every write is
// actions/projectSelections (estimators and managers); everyone else reads the card.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProjectSelection, chooseProjectSelection, deleteProjectSelection, reopenProjectSelection, updateProjectSelection } from "@/actions/projectSelections";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdSelections, PdStage } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { SELECTION_PRESETS, allowanceWords, dayWords, dollars, dueWords, leadDaysFor } from "@/lib/projectSelections/shared";
import s from "./project-hub.module.css";

type Row = PdSelections["selections"][number];

type EditDraft = { id: string | null; name: string; stageId: string; leadDays: string; dueBy: string; allowance: string; note: string; suggested: number | null };
type PickDraft = { id: string; name: string; chosen: string; vendor: string; price: string; allowance: number | null };

const num = (v: string): number | null => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export function ProjectSelectionsCard({ projectId, selections, stages, canManage }: { projectId: string; selections: PdSelections; stages: PdStage[]; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [pick, setPick] = useState<PickDraft | null>(null);

  const today = selections.today;
  const rows = selections.selections;

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") setNote(words);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  // By the stage that needs them, in the stages' order; the project-wide ones last.
  const groups = useMemo(() => {
    const byStage = new Map<string | null, Row[]>();
    for (const r of rows) byStage.set(r.stageId, [...(byStage.get(r.stageId) ?? []), r]);
    const order = [...stages.map((st) => st.id), null];
    return order.filter((id) => byStage.has(id)).map((id) => {
      const st = id ? stages.find((x) => x.id === id) : null;
      const first = byStage.get(id)![0];
      return { stageId: id, stageName: id ? (st?.name ?? first.stageName ?? "Stage") : "The whole project", stageStart: first.stageStart, stageDone: first.stageDone, rows: byStage.get(id)! };
    });
  }, [rows, stages]);

  function openEdit(row: Row | null) {
    setEditErr(null);
    setNote(null);
    setEdit(
      row
        ? { id: row.id, name: row.name, stageId: row.stageId ?? "", leadDays: String(row.leadDays), dueBy: row.dueBy ?? "", allowance: row.allowance != null ? String(row.allowance) : "", note: row.note ?? "", suggested: row.allowanceSuggested }
        : { id: null, name: "", stageId: stages.find((st) => st.status !== "DONE")?.id ?? "", leadDays: "14", dueBy: "", allowance: "", note: "", suggested: null },
    );
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.name.trim()) return setEditErr("Name the selection — Cabinets, Tile, Paint colors");
    const lead = Number(edit.leadDays);
    const data = {
      name: edit.name.trim(),
      stageId: edit.stageId || null,
      leadDays: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : null,
      dueBy: /^\d{4}-\d{2}-\d{2}$/.test(edit.dueBy) ? edit.dueBy : null,
      allowance: num(edit.allowance),
      note: edit.note.trim() || null,
    };
    const id = edit.id;
    setEdit(null);
    await run(`edit:${id ?? "new"}`, async () => {
      if (id) await updateProjectSelection(projectId, id, data);
      else await addProjectSelection(projectId, data);
      return null;
    });
  }

  function openPick(row: Row) {
    setNote(null);
    setPick({ id: row.id, name: row.name, chosen: row.chosen ?? "", vendor: row.vendor ?? "", price: row.price != null ? String(row.price) : "", allowance: row.allowance });
  }

  async function savePick() {
    if (!pick) return;
    const data = { chosen: pick.chosen.trim() || null, vendor: pick.vendor.trim() || null, price: num(pick.price) };
    const id = pick.id;
    setPick(null);
    await run(`pick:${id}`, async () => {
      const r = await chooseProjectSelection(projectId, id, data);
      return `${r.words}.`;
    });
  }

  const tagOf = (r: Row): { text: string; tone: string } => {
    if (r.state === "chosen") return { text: `Chosen${r.chosenAt ? ` ${dayWords(r.chosenAt.slice(0, 10))}` : ""}`, tone: s.tagIn };
    if (r.stageDone) return { text: "stage done", tone: "" };
    if (r.state === "late") return { text: dueWords(r, today), tone: s.tagLate };
    if (r.state === "soon") return { text: dueWords(r, today), tone: s.tagOrdered };
    return { text: dueWords(r, today), tone: "" };
  };

  const pickOver = pick ? allowanceWords(num(pick.price), pick.allowance) : null;

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Selections" data-project-selections>
        <div className={s.head}>
          <h3 className={s.title}>Selections</h3>
          <span className={s.headSub} data-sel-head>
            {rows.length ? (
              <>
                <b>{selections.open}</b> to choose{selections.late ? ` · ${selections.late} late` : ""}{selections.chosen ? ` · ${selections.chosen} chosen` : ""}
              </>
            ) : (
              "What the client has to choose — cabinets, tile, paint — each by the day its stage needs it"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openEdit(null)} data-sel-add>
                + Selection
              </button>
            </div>
          ) : null}
        </div>
        {note ? (
          <p className={s.note} role="status" data-sel-note-line>
            {note}
          </p>
        ) : null}
        {groups.map((g) => (
          <div key={g.stageId ?? "project"} className={s.group} data-sel-stage>
            <div className={s.groupHead}>
              <b>{g.stageName}</b>
              <span>{g.stageDone ? "done" : g.stageStart ? `starts ${dayWords(g.stageStart)}` : g.stageId ? "no days yet" : ""}</span>
            </div>
            {g.rows.map((r) => {
              const tag = tagOf(r);
              const against = r.state === "chosen" ? allowanceWords(r.price, r.allowance) : null;
              return (
                <div key={r.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-sel-row data-sel-state={r.state}>
                  <div>
                    <div className={s.lineName} style={{ fontWeight: 600 }}>
                      {r.name}
                      <span className={`${s.tag} ${tag.tone}`} style={{ marginLeft: 8 }} data-sel-tag>
                        {tag.text}
                      </span>
                    </div>
                    <div className={s.lineSub} data-sel-sub>
                      {r.state === "chosen"
                        ? [r.chosen, r.vendor ? `from ${r.vendor}` : null, r.price != null ? dollars(r.price) : null, against].filter(Boolean).join(" · ")
                        : r.allowance != null
                          ? `allowance ${dollars(r.allowance)}`
                          : r.allowanceSuggested != null
                            ? `no allowance set — the proposal's lines add up to ${dollars(r.allowanceSuggested)}`
                            : "no allowance set"}
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                    {canManage ? (
                      <div className={s.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                        {r.state !== "chosen" ? (
                          <button type="button" className={s.btnPrimary} style={{ minHeight: 32, padding: "0 12px", fontSize: 10.5 }} disabled={busy !== null} onClick={() => openPick(r)} data-sel-choose>
                            Chosen…
                          </button>
                        ) : (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`reopen:${r.id}`, async () => { await reopenProjectSelection(projectId, r.id); return null; })} data-sel-reopen>
                            Reopen
                          </button>
                        )}
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`} data-sel-edit>
                          Edit
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <span className={s.qty}>{r.leadDays ? `${r.leadDays}-day lead` : ""}</span>
                </div>
              );
            })}
          </div>
        ))}
        {!rows.length ? (
          <p className={s.empty} data-sel-empty>
            Nothing to choose yet. A template brings the usual selections with its stages; + Selection adds your own.
          </p>
        ) : null}
      </section>

      {/* ONE SELECTION — its name, the stage that needs it, the lead time or a day, the allowance. */}
      <BlueprintSheet
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit selection" : "Selection"}
        description="The day it is due reads from the stage's first day less the lead time — or set the day yourself."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void saveEdit()} data-sel-save>
              {edit?.id ? "Save" : "Add"}
            </button>
          </>
        }
      >
        {edit ? (
          <div className="bps-form" data-sel-sheet>
            {!edit.id ? (
              <div className={`bps-fld bps-fld--wide ${s.chips}`} style={{ marginTop: 0 }}>
                {SELECTION_PRESETS.map((p) => (
                  <button key={p.name} type="button" className="bps-btn bps-btn--ghost" onClick={() => setEdit({ ...edit, name: p.name, leadDays: String(p.leadDays) })}>
                    {p.name}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">What the client chooses</span>
              <input className="bps-in" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, leadDays: edit.id || edit.leadDays !== "14" ? edit.leadDays : String(leadDaysFor(e.target.value)) })} placeholder="Cabinets" maxLength={120} autoFocus data-sel-name />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">The stage that needs it</span>
              <select className="bps-in" value={edit.stageId} onChange={(e) => setEdit({ ...edit, stageId: e.target.value })} data-sel-stage-pick>
                <option value="">— the whole project —</option>
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Days before the stage</span>
              <input className="bps-in" inputMode="numeric" value={edit.leadDays} onChange={(e) => setEdit({ ...edit, leadDays: e.target.value.replace(/[^\d]/g, "") })} placeholder="14" data-sel-lead />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Or a day of your own</span>
              <input className="bps-in" type="date" value={edit.dueBy} onChange={(e) => setEdit({ ...edit, dueBy: e.target.value })} data-sel-due />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Allowance ($)</span>
              <input className="bps-in" inputMode="decimal" value={edit.allowance} onChange={(e) => setEdit({ ...edit, allowance: e.target.value })} placeholder={edit.suggested != null ? String(Math.round(edit.suggested)) : "e.g. 8000"} data-sel-allowance />
            </label>
            {edit.suggested != null && !edit.allowance ? (
              <div className="bps-fld bps-fld--wide">
                <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setEdit({ ...edit, allowance: String(Math.round(edit.suggested!)) })} data-sel-use-suggested>
                  Use {dollars(edit.suggested)} — the proposal&apos;s lines
                </button>
              </div>
            ) : null}
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Note</span>
              <input className="bps-in" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Showroom on 5th; the client wants to see samples first" maxLength={1000} data-sel-note />
            </label>
            {edit.id ? (
              <div className={`bps-fld bps-fld--wide ${s.chips}`}>
                <button
                  type="button"
                  className="bps-btn bps-btn--ghost"
                  data-sel-delete
                  onClick={() => {
                    const id = edit.id!;
                    setEdit(null);
                    void run(`del:${id}`, async () => {
                      await deleteProjectSelection(projectId, id);
                      return null;
                    });
                  }}
                >
                  Remove selection
                </button>
              </div>
            ) : null}
            {editErr ? <div className="bps-err bps-fld--wide">{editErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* THE CHOICE IS IN — what, from whom, the price against the allowance. */}
      <BlueprintSheet
        open={pick !== null}
        onClose={() => setPick(null)}
        title={pick ? `${pick.name} — chosen` : "Chosen"}
        description="What the client picked, from whom and at what price; the allowance is read against it."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setPick(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !pick || (!pick.chosen.trim() && !pick.vendor.trim() && !pick.price.trim())} onClick={() => void savePick()} data-sel-pick-save>
              Save
            </button>
          </>
        }
      >
        {pick ? (
          <div className="bps-form" data-sel-pick-sheet>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">What was chosen</span>
              <input className="bps-in" value={pick.chosen} onChange={(e) => setPick({ ...pick, chosen: e.target.value })} placeholder="Shaker, white, 36-inch uppers" maxLength={500} autoFocus data-sel-pick-what />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">From whom</span>
              <input className="bps-in" value={pick.vendor} onChange={(e) => setPick({ ...pick, vendor: e.target.value })} placeholder="Pacific Cabinet Supply" maxLength={120} data-sel-pick-vendor />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Price ($)</span>
              <input className="bps-in" inputMode="decimal" value={pick.price} onChange={(e) => setPick({ ...pick, price: e.target.value })} placeholder={pick.allowance != null ? String(Math.round(pick.allowance)) : "e.g. 8400"} data-sel-pick-price />
            </label>
            <p className="bps-hint bps-fld--wide" data-sel-pick-against>
              {pick.allowance != null ? `Allowance ${dollars(pick.allowance)}${pickOver ? ` — ${pickOver}` : ""}` : "No allowance set on this selection."}
            </p>
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
