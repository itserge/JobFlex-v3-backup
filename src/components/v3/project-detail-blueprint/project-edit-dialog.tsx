"use client";

// EDIT PROJECT (owner walk, 2026-11-04). A project's name, client, scope, dates
// and status were set once, in the New project dialog, and the desktop page had
// no way back to them. This is the house `mdl pmdl` dialog (the attach dialog's
// frame) writing through the same `updateProject` the phone's list sheet uses.
//
// The dates are DAYS: the inputs carry "YYYY-MM-DD" read off the stored UTC
// midnight, and the action's coercion writes the same midnight back — so the
// day typed is the day kept, east or west of Greenwich.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listProjectClients, updateProject } from "@/actions/projects";
import { KIND_HINT, KIND_LABEL, PROJECT_KINDS, kindOf, type ProjectKind, kindsSwap } from "@/lib/projectKind";
import { FOR_WHOM, FOR_WHOM_HINT, FOR_WHOM_LABEL, MONEY_MODES, MONEY_MODE_HINT, MONEY_MODE_LABEL, parseMoneySettings, type ForWhom, type MoneyMode } from "@/lib/projectMoneyPlan/shared";
import { closeMdl, openMdl } from "@/components/v3/blueprint-shell/mdl-motion";
import { initDatePopovers } from "@/components/v3/shared/date-popover";
import s from "./project-detail.module.css";

function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => (s as Record<string, string>)[n as string] ?? (n as string))
    .join(" ");
}

export const PROJECT_STATUS: Array<[string, string]> = [
  ["ACTIVE", "Active"],
  ["ON_HOLD", "On hold"],
  ["COMPLETED", "Completed"],
  ["ARCHIVED", "Archived"],
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export type EditableProject = {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  /** As stored — UTC midnight of the day (withLocalDays is for display only). */
  startsAt: Date | null;
  endsAt: Date | null;
  client?: { id: string; name: string } | null;
  /** REMODEL or NEW_BUILD (2026-11-07); `occupied`: a remodel's client lives there; `kindLocked`: a stage is done. */
  kind?: string;
  occupied?: boolean;
  kindLocked?: boolean;
  /** Who it is for and how the money is made (part 5, lib/projectMoneyPlan). */
  forWhom?: string;
  moneyMode?: string;
  marginPct?: number | null;
  feeAmount?: number | null;
  salePrice?: number | null;
};

const numOf = (v: string): number | null => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export function ProjectEditDialog({ project, open, onClose }: { project: EditableProject; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string; street: string }> | null>(null);
  const [status, setStatus] = useState(project.status ?? "ACTIVE");
  const [kind, setKind] = useState<ProjectKind>(kindOf(project.kind));
  const [occupied, setOccupied] = useState(project.occupied === true);
  const money0 = parseMoneySettings(project);
  const [forWhom, setForWhom] = useState<ForWhom>(money0.forWhom);
  const [moneyMode, setMoneyMode] = useState<MoneyMode>(money0.forWhom === "CLIENT" && money0.moneyMode === "NONE" ? "NONE" : money0.moneyMode);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The page remounts the dialog (a fresh key) for every open, so the fields and the status start from the project.
    if (open) {
      openMdl(el);
      requestAnimationFrame(() => el.querySelector<HTMLInputElement>("#pdEditName")?.focus());
      if (!clients) listProjectClients().then(setClients, () => setClients([]));
    } else {
      closeMdl(el, (ms, fn) => setTimeout(fn, ms));
    }
    // The client list is read once per page; reopening keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return initDatePopovers(el, [
      { sel: "#pdEditStart", icon: "i-clock", label: "Starts" },
      { sel: "#pdEditEnd", icon: "i-hourglass", label: "Ends" },
    ]);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || saving) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    if (!name) {
      setErr("Enter a project name");
      return;
    }
    const start = String(f.get("startsAt") ?? "").trim();
    const end = String(f.get("endsAt") ?? "").trim();
    if ((start && !ISO.test(start)) || (end && !ISO.test(end))) {
      setErr("Pick the dates from the calendar");
      return;
    }
    if (start && end && end < start) {
      setErr("The project ends before it starts");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await updateProject({
        id: project.id,
        name,
        description: String(f.get("description") ?? "").trim() || null,
        status,
        startsAt: start || null,
        endsAt: end || null,
        clientId: String(f.get("clientId") ?? "") || null,
        ...(project.kindLocked && !kindsSwap(kindOf(project.kind), kind) ? {} : { kind }),
        occupied: kind === "REMODEL" ? occupied : false,
        forWhom,
        moneyMode: forWhom === "SELF" ? "NONE" : moneyMode,
        marginPct: numOf(String(f.get("marginPct") ?? "")),
        feeAmount: numOf(String(f.get("feeAmount") ?? "")),
        salePrice: numOf(String(f.get("salePrice") ?? "")),
      });
      onClose();
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save the project");
    } finally {
      setSaving(false);
    }
  }

  const clientList = clients ?? (project.client ? [{ ...project.client, street: "" }] : []);
  if (project.client && clients && !clients.some((c) => c.id === project.client!.id)) clientList.unshift({ ...project.client, street: "" });

  return (
    <div className={cx("mdl", "pmdl")} ref={ref} role="dialog" aria-modal="true" aria-labelledby="pdEditTitle" data-project-edit>
      <div className={cx("mdl-bg")} onClick={() => !saving && onClose()} />
      <div className={cx("mdl-box", "pd-edit-box")}>
        <div className={cx("mdl-head", "mdl-head--row")}>
          <span id="pdEditTitle">Edit project</span>
          <button className={cx("mdl-x")} type="button" onClick={onClose} disabled={saving} aria-label="Close dialog">
            <svg className={cx("ic")}>
              <use href="#i-x" />
            </svg>
          </button>
        </div>
        <form onSubmit={save} id="pdEditForm">
          <div className={cx("mdl-body")}>
            <div className={cx("mf")}>
              <label className={cx("mf-lbl")} htmlFor="pdEditName">Project name</label>
              <input className={cx("mf-in")} id="pdEditName" name="name" defaultValue={project.name} autoComplete="off" />
            </div>
            <div className={cx("mf")}>
              <label className={cx("mf-lbl")} htmlFor="pdEditClient">Client</label>
              <select className={cx("mf-in")} id="pdEditClient" name="clientId" defaultValue={project.client?.id ?? ""} key={clients ? "loaded" : "wait"}>
                <option value="">No client</option>
                {clientList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.street ? ` — ${c.street}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className={cx("mf")}>
              <label className={cx("mf-lbl")} htmlFor="pdEditScope">Scope</label>
              <textarea className={cx("mf-in", "pd-edit-scope")} id="pdEditScope" name="description" defaultValue={project.description ?? ""} />
            </div>
            <div className={cx("pd-edit-row")}>
              <div className={cx("mf")}>
                <label className={cx("mf-lbl")} htmlFor="pdEditStart">Starts</label>
                <input className={cx("mf-in")} id="pdEditStart" name="startsAt" defaultValue={isoDay(project.startsAt)} placeholder="YYYY-MM-DD" autoComplete="off" />
              </div>
              <div className={cx("mf")}>
                <label className={cx("mf-lbl")} htmlFor="pdEditEnd">Ends</label>
                <input className={cx("mf-in")} id="pdEditEnd" name="endsAt" defaultValue={isoDay(project.endsAt)} placeholder="YYYY-MM-DD" autoComplete="off" />
              </div>
            </div>
            {/* THE KIND (2026-11-07): a remodel or a new build. It stays once a stage is done — the templates, and soon the
                gates and the money, hang on it. A remodel asks whether the client lives there during the work. */}
            <div className={cx("mf")}>
              <span className={cx("mf-lbl")}>What kind of project</span>
              <div className={cx("pd-edit-seg")} role="group" aria-label="Project kind">
                {PROJECT_KINDS.map((k) => (
                  <button key={k} type="button" className={cx("pd-edit-opt", kind === k && "on")} aria-pressed={kind === k} disabled={project.kindLocked && !kindsSwap(kindOf(project.kind), k)} data-kind={k} onClick={() => setKind(k)}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <div className={cx("mf-note")}>{project.kindLocked && kindOf(project.kind) === "NEW_BUILD" ? "A new build stays one once a stage is done." : KIND_HINT[kind]}</div>
            </div>
            {kind === "REMODEL" ? (
              <div className={cx("mf")}>
                <span className={cx("mf-lbl")}>Does the client live there during the work?</span>
                <div className={cx("pd-edit-seg")} role="group" aria-label="Lives there during the work">
                  <button type="button" className={cx("pd-edit-opt", occupied && "on")} aria-pressed={occupied} data-occupied="yes" onClick={() => setOccupied(true)}>
                    Yes
                  </button>
                  <button type="button" className={cx("pd-edit-opt", !occupied && "on")} aria-pressed={!occupied} data-occupied="no" onClick={() => setOccupied(false)}>
                    No
                  </button>
                </div>
              </div>
            ) : null}
            {/* WHO IT IS FOR, AND THE MONEY (part 5): for a client with a margin or a fee, or for yourself. */}
            <div className={cx("mf")} data-edit-money>
              <span className={cx("mf-lbl")}>Who is it for</span>
              <div className={cx("pd-edit-seg")} role="group" aria-label="Who the project is for">
                {FOR_WHOM.map((w) => (
                  <button key={w} type="button" className={cx("pd-edit-opt", forWhom === w && "on")} aria-pressed={forWhom === w} data-for-whom={w} onClick={() => { setForWhom(w); if (w === "CLIENT" && moneyMode === "NONE") setMoneyMode("PROJECT_MARGIN"); }}>
                    {FOR_WHOM_LABEL[w]}
                  </button>
                ))}
              </div>
              <div className={cx("mf-note")}>{FOR_WHOM_HINT[forWhom]}</div>
            </div>
            {forWhom === "CLIENT" ? (
              <>
                <div className={cx("mf")}>
                  <span className={cx("mf-lbl")}>How you earn</span>
                  <div className={cx("pd-edit-seg")} role="group" aria-label="How the money is made">
                    {MONEY_MODES.map((m) => (
                      <button key={m} type="button" className={cx("pd-edit-opt", moneyMode === m && "on")} aria-pressed={moneyMode === m} data-money-mode={m} onClick={() => setMoneyMode(m)}>
                        {MONEY_MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <div className={cx("mf-note")}>{MONEY_MODE_HINT[moneyMode]}</div>
                </div>
                {moneyMode !== "NONE" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className={cx("mf")}>
                      <label className={cx("mf-lbl")} htmlFor="pdEditMargin">{moneyMode === "COST_PLUS" ? "Fee, % of cost" : "Margin, % of cost"}</label>
                      <input className={cx("mf-in")} id="pdEditMargin" name="marginPct" defaultValue={project.marginPct != null ? String(project.marginPct) : ""} placeholder="18" inputMode="decimal" autoComplete="off" />
                    </div>
                    {moneyMode === "COST_PLUS" ? (
                      <div className={cx("mf")}>
                        <label className={cx("mf-lbl")} htmlFor="pdEditFee">Or a fixed fee ($)</label>
                        <input className={cx("mf-in")} id="pdEditFee" name="feeAmount" defaultValue={project.feeAmount != null ? String(project.feeAmount) : ""} placeholder="45000" inputMode="decimal" autoComplete="off" />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={cx("mf")}>
                <label className={cx("mf-lbl")} htmlFor="pdEditSale">Sale price ($, optional)</label>
                <input className={cx("mf-in")} id="pdEditSale" name="salePrice" defaultValue={project.salePrice != null ? String(project.salePrice) : ""} placeholder="780000" inputMode="decimal" autoComplete="off" />
              </div>
            )}
            <div className={cx("mf")}>
              <span className={cx("mf-lbl")}>Status</span>
              <div className={cx("pd-edit-seg")} role="group" aria-label="Project status">
                {PROJECT_STATUS.map(([v, l]) => (
                  <button key={v} type="button" className={cx("pd-edit-opt", status === v && "on")} aria-pressed={status === v} onClick={() => setStatus(v)}>
                    {l}
                  </button>
                ))}
              </div>
              {status === "ARCHIVED" ? <div className={cx("mf-note")}>Archived projects leave the Projects list; their jobs and money stay.</div> : null}
            </div>
            {err ? <div className={cx("mf-err")}>{err}</div> : null}
          </div>
          <div className={cx("mdl-foot")}>
            <button className={cx("btn", "btn-ghost")} type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className={cx("btn", "btn-primary")} type="submit" disabled={saving}>
              {saving ? "Saving" : "Save project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
