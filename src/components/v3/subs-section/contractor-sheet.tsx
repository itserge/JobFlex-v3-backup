"use client";
// THE CONTRACTOR SHEET (2026-11-08, the subcontractors plan, part 1): one BlueprintSheet to add or edit a sub in the
// company's directory — who they are and how to reach them, their trades, the license and its state, the insurance
// (carrier, policy, expiry) and the bond, the W-9, where they work, notes — and, once the sub exists, their W-9 or
// insurance certificate kept as a document (lib/subDocs/client → actions keepContractorDocument). Used by the
// project's Subcontractors section and by the company's directory page.

import { useRef, useState } from "react";
import { addProjectContractor, keepContractorDocument, updateProjectContractor } from "@/actions/projectSubs";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { ContractorRow, DocRow } from "@/lib/projectSubs/server";
import { LICENSE_LABEL, LICENSE_STATUSES, W9_LABEL, W9_STATUSES } from "@/lib/projectSubs/shared";
import { DOC_ACCEPT } from "@/lib/subDocs/shared";
import { DocUploadError, uploadSubDocument } from "@/lib/subDocs/client";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "./subs.module.css";

export type ContractorDraft = {
  id: string | null;
  name: string;
  company: string;
  contactName: string;
  trade: string;
  trades: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  serviceAreas: string;
  license: string;
  licenseStatus: string;
  insuranceCarrier: string;
  insurancePolicy: string;
  insuranceUntil: string;
  bondAmount: string;
  bondUntil: string;
  w9Status: string;
  textsOptOut: boolean;
  notes: string;
};

export function draftOf(c: ContractorRow | null, trade = ""): ContractorDraft {
  return {
    id: c?.id ?? null,
    name: c?.name ?? "",
    company: c?.company ?? "",
    contactName: c?.contactName ?? "",
    trade: c?.trade ?? trade,
    trades: c ? c.trades.filter((t) => t !== c.trade).join(", ") : "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    website: c?.website ?? "",
    address: c?.address ?? "",
    serviceAreas: c?.serviceAreas ?? "",
    license: c?.license ?? "",
    licenseStatus: c?.licenseStatus ?? "UNKNOWN",
    insuranceCarrier: c?.insuranceCarrier ?? "",
    insurancePolicy: c?.insurancePolicy ?? "",
    insuranceUntil: c?.insuranceUntil ?? "",
    bondAmount: c?.bondAmount != null ? String(c.bondAmount) : "",
    bondUntil: c?.bondUntil ?? "",
    w9Status: c?.w9Status ?? "NONE",
    textsOptOut: c?.textsOptOut ?? false,
    notes: c?.notes ?? "",
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: string): number | null => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export function ContractorSheet({ draft, setDraft, documents, onSaved, onDocument, onClose }: {
  draft: ContractorDraft | null;
  setDraft: (fn: (cur: ContractorDraft | null) => ContractorDraft | null) => void;
  /** The sub's documents on file (a W-9, a certificate), shown and added to when the sub exists. */
  documents: DocRow[];
  onSaved: (row: ContractorRow) => void;
  onDocument: (doc: DocRow) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileKind, setFileKind] = useState<"W9" | "INSURANCE">("W9");

  const set = <K extends keyof ContractorDraft>(k: K, v: ContractorDraft[K]) => setDraft((cur) => (cur ? { ...cur, [k]: v } : cur));

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return setErr("Name the contractor.");
    setBusy("save");
    setErr(null);
    try {
      const data = {
        name: draft.name.trim(),
        company: draft.company.trim() || null,
        contactName: draft.contactName.trim() || null,
        trade: draft.trade || null,
        trades: draft.trades.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        website: draft.website.trim() || null,
        address: draft.address.trim() || null,
        serviceAreas: draft.serviceAreas.trim() || null,
        license: draft.license.trim() || null,
        licenseStatus: draft.licenseStatus as (typeof LICENSE_STATUSES)[number],
        insuranceCarrier: draft.insuranceCarrier.trim() || null,
        insurancePolicy: draft.insurancePolicy.trim() || null,
        insuranceUntil: DAY.test(draft.insuranceUntil) ? draft.insuranceUntil : null,
        bondAmount: num(draft.bondAmount),
        bondUntil: DAY.test(draft.bondUntil) ? draft.bondUntil : null,
        w9Status: draft.w9Status as (typeof W9_STATUSES)[number],
        textsOptOut: draft.textsOptOut,
        notes: draft.notes.trim() || null,
      };
      const row = draft.id ? await updateProjectContractor({ id: draft.id, ...data }) : await addProjectContractor(data);
      onSaved(row);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusy(null);
    }
  }

  async function addFile(file: File) {
    if (!draft?.id) return;
    setBusy("file");
    setErr(null);
    setPct(1);
    try {
      const up = await uploadSubDocument({ kind: "office", projectId: null }, file, setPct);
      const doc = await keepContractorDocument({ contractorId: draft.id, kind: fileKind, file: { url: up.url, name: up.name, contentType: up.contentType, bytes: up.bytes } });
      onDocument(doc);
      if (fileKind === "W9") set("w9Status", "ON_FILE");
    } catch (e) {
      setErr(e instanceof DocUploadError || e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(null);
      setPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <BlueprintSheet
      open={draft !== null}
      onClose={() => busy === null && onClose()}
      title={draft?.id ? draft.name || "Contractor" : "New contractor"}
      description="The directory's card on a sub: who to reach, what they do, the paper that keeps them on your jobs."
      footer={
        <>
          <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !draft?.name.trim()} onClick={() => void save()} data-sub-save>
            {busy === "save" ? "Saving…" : draft?.id ? "Save" : "Add"}
          </button>
        </>
      }
    >
      {draft ? (
        // `h.w` is the hub stylesheet's scope (`.w.w .x` rules: empty boxes, links, button rows). A wrapper, never on
        // the sheet's box itself — `.w` sets display: block and would undo the box's flex column.
        <div className={h.w}>
        <div className={h.form} data-sub-sheet>
          <div className={s.sheetGrid}>
            <label className={h.field}>
              <span className={h.lab}>Name</span>
              <input className={h.input} value={draft.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="ABC Electrical" autoFocus data-sub-name />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Company</span>
              <input className={h.input} value={draft.company} maxLength={120} onChange={(e) => set("company", e.target.value)} data-sub-company />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Contact</span>
              <input className={h.input} value={draft.contactName} maxLength={120} onChange={(e) => set("contactName", e.target.value)} placeholder="Who you talk to" data-sub-contact />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Trade</span>
              <select className={h.input} value={draft.trade} onChange={(e) => set("trade", e.target.value)} data-sub-trade>
                <option value="">Trade</option>
                {TRADE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={h.field}>
              <span className={h.lab}>Other trades</span>
              <input className={h.input} value={draft.trades} onChange={(e) => set("trades", e.target.value)} placeholder="Siding, Windows" data-sub-trades />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Phone</span>
              <input className={h.input} inputMode="tel" value={draft.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} data-sub-phone />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Email</span>
              <input className={h.input} inputMode="email" value={draft.email} maxLength={200} onChange={(e) => set("email", e.target.value)} data-sub-email />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Website</span>
              <input className={h.input} inputMode="url" value={draft.website} maxLength={200} onChange={(e) => set("website", e.target.value)} placeholder="abcelectrical.com" data-sub-website />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Address</span>
              <input className={h.input} value={draft.address} maxLength={240} onChange={(e) => set("address", e.target.value)} data-sub-address />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Service area</span>
              <input className={h.input} value={draft.serviceAreas} maxLength={240} onChange={(e) => set("serviceAreas", e.target.value)} placeholder="Snohomish and King counties" data-sub-areas />
            </label>
            <label className={h.field}>
              <span className={h.lab}>License number</span>
              <input className={h.input} value={draft.license} maxLength={80} onChange={(e) => set("license", e.target.value)} data-sub-license />
            </label>
            <label className={h.field}>
              <span className={h.lab}>License state</span>
              <select className={h.input} value={draft.licenseStatus} onChange={(e) => set("licenseStatus", e.target.value)} data-sub-license-status>
                {LICENSE_STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {LICENSE_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className={h.field}>
              <span className={h.lab}>Insurance carrier</span>
              <input className={h.input} value={draft.insuranceCarrier} maxLength={120} onChange={(e) => set("insuranceCarrier", e.target.value)} data-sub-ins-carrier />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Policy number</span>
              <input className={h.input} value={draft.insurancePolicy} maxLength={80} onChange={(e) => set("insurancePolicy", e.target.value)} data-sub-ins-policy />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Insurance expires</span>
              <input className={h.input} type="text" placeholder="YYYY-MM-DD" value={draft.insuranceUntil} onChange={(e) => set("insuranceUntil", e.target.value)} data-sub-ins-until />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Bond ($)</span>
              <input className={h.input} inputMode="numeric" value={draft.bondAmount} onChange={(e) => set("bondAmount", e.target.value)} data-sub-bond />
            </label>
            <label className={h.field}>
              <span className={h.lab}>Bond expires</span>
              <input className={h.input} type="text" placeholder="YYYY-MM-DD" value={draft.bondUntil} onChange={(e) => set("bondUntil", e.target.value)} data-sub-bond-until />
            </label>
            <label className={h.field}>
              <span className={h.lab}>W-9</span>
              <select className={h.input} value={draft.w9Status} onChange={(e) => set("w9Status", e.target.value)} data-sub-w9>
                {W9_STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {W9_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={h.check}>
            <input type="checkbox" checked={draft.textsOptOut} onChange={(e) => set("textsOptOut", e.target.checked)} data-sub-no-texts />
            <span>No texts — email and calls only</span>
          </label>
          <label className={h.field}>
            <span className={h.lab}>Notes</span>
            <textarea className={h.input} rows={3} maxLength={1000} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Internal — never shown to the sub." data-sub-notes />
          </label>
          {draft.id ? (
            <div className={h.field} data-sub-docs>
              <span className={h.lab}>Paper on file</span>
              {documents.length ? (
                documents.map((d) => (
                  <div key={d.id} className={h.check}>
                    <span>
                      {d.kind === "W9" ? "W-9" : "Insurance"} · {d.name} · <a className={h.link} href={`/api/subs/doc/${d.id}?download=1`}>download</a>
                    </span>
                  </div>
                ))
              ) : (
                <p className={h.empty}>Nothing kept yet.</p>
              )}
              <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                <select className={h.input} style={{ width: "auto" }} value={fileKind} onChange={(e) => setFileKind(e.target.value as "W9" | "INSURANCE")} aria-label="Which paper" data-sub-doc-kind>
                  <option value="W9">W-9</option>
                  <option value="INSURANCE">Insurance certificate</option>
                </select>
                <input ref={fileRef} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void addFile(e.target.files[0])} data-sub-doc-file />
                <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => fileRef.current?.click()} data-sub-doc-add>
                  {busy === "file" ? `Uploading… ${pct ?? 0}%` : "+ Keep a PDF or picture"}
                </button>
              </div>
            </div>
          ) : (
            <p className={h.empty}>Add the contractor first, then keep their W-9 and insurance certificate here.</p>
          )}
          {err ? <p className={h.note}>{err}</p> : null}
        </div>
        </div>
      ) : null}
    </BlueprintSheet>
  );
}
