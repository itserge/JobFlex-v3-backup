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
};

export function ProjectEditDialog({ project, open, onClose }: { project: EditableProject; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string; street: string }> | null>(null);
  const [status, setStatus] = useState(project.status ?? "ACTIVE");
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
