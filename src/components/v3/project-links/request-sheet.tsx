"use client";
// THE REQUEST SHEET (2026-11-08, the subcontractors plan, part 1): one BlueprintSheet, used by the project page's
// Subcontractors card and by the Subcontractors section — the stage (the scope prefilled from it and its tasks), the
// contractors of its trade first (a new one added in place), the deadline, and under "More details" the words the
// prompt asks for: a title, a description, materials, labor, the dates, instructions, and the files attached — the
// project's Files ticked, and drawings uploaded here (lib/subDocs/client → actions keepRequestDrawing). Send writes
// one request and one link per contractor (actions/projectSubs askProjectQuotes).

import { useMemo, useRef, useState } from "react";
import { addProjectContractor, askProjectQuotes, keepRequestDrawing } from "@/actions/projectSubs";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdStage, PdSubs } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { replyByDefault, scopeFor, tradeForStage } from "@/lib/projectSubs/shared";
import { DOC_ACCEPT, docSize } from "@/lib/subDocs/shared";
import { DocUploadError, uploadSubDocument } from "@/lib/subDocs/client";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import s from "./project-hub.module.css";

type ContractorRow = PdSubs["contractors"][number];
const todayIso = () => new Date().toISOString().slice(0, 10);

export type RequestDraft = {
  stageId: string;
  picked: Set<string>;
  scope: string;
  dueBy: string;
  more: boolean;
  title: string;
  description: string;
  materials: string;
  labor: string;
  startsAt: string;
  endsAt: string;
  instructions: string;
  fileIds: Set<string>;
  drawings: Array<{ id: string; name: string; bytes: number | null }>;
  adding: { name: string; trade: string; phone: string; email: string } | null;
};

export function newRequestDraft(stages: PdStage[], stageId: string): RequestDraft {
  const st = stages.find((x) => x.id === stageId) ?? stages[0];
  return {
    stageId: st?.id ?? "",
    picked: new Set(),
    scope: st ? scopeFor(st.name, st.tasks.map((t) => t.title)) : "",
    dueBy: replyByDefault(todayIso()),
    more: false,
    title: st?.name ?? "",
    description: "",
    materials: "",
    labor: "",
    startsAt: "",
    endsAt: "",
    instructions: "",
    fileIds: new Set(),
    drawings: [],
    adding: null,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function RequestSheet({ projectId, draft, setDraft, stages, contractors, setContractors, files, onSent, onClose }: {
  projectId: string;
  draft: RequestDraft | null;
  setDraft: (fn: (cur: RequestDraft | null) => RequestDraft | null) => void;
  stages: PdStage[];
  contractors: ContractorRow[];
  setContractors: (fn: (cur: ContractorRow[]) => ContractorRow[]) => void;
  files: PdSubs["files"];
  onSent: (words: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const stage = draft ? stages.find((x) => x.id === draft.stageId) ?? null : null;
  const trade = stage ? tradeForStage(stage.name) : null;
  const ordered = useMemo(() => {
    const mine = contractors.filter((c) => trade && (c.trade === trade || c.trades.includes(trade)));
    const rest = contractors.filter((c) => !mine.includes(c));
    return [...mine, ...rest];
  }, [contractors, trade]);

  function pickStage(stageId: string) {
    setDraft((cur) => {
      if (!cur) return cur;
      const st = stages.find((x) => x.id === stageId);
      return { ...cur, stageId, title: st?.name ?? cur.title, scope: st ? scopeFor(st.name, st.tasks.map((t) => t.title)) : cur.scope, picked: new Set() };
    });
  }

  async function addNew() {
    if (!draft?.adding?.name.trim()) return;
    const a = draft.adding;
    setBusy("add");
    setNote(null);
    try {
      const made = await addProjectContractor({ name: a.name, trade: a.trade || null, phone: a.phone || null, email: a.email || null });
      setContractors((cur) => [...cur, made]);
      setDraft((cur) => (cur ? { ...cur, adding: null, picked: new Set([...cur.picked, made.id]) } : cur));
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  async function addDrawing(file: File) {
    setBusy("drawing");
    setNote(null);
    setPct(1);
    try {
      const up = await uploadSubDocument({ kind: "office", projectId }, file, setPct);
      const doc = await keepRequestDrawing({ projectId, file: { url: up.url, name: up.name, contentType: up.contentType, bytes: up.bytes } });
      setDraft((cur) => (cur ? { ...cur, drawings: [...cur.drawings, { id: doc.id, name: doc.name, bytes: doc.bytes }] } : cur));
    } catch (err) {
      setNote(err instanceof DocUploadError || err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy(null);
      setPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    if (!draft) return;
    const ids = [...draft.picked];
    if (!ids.length) return setNote("Pick at least one contractor.");
    if (!draft.scope.trim()) return setNote("Say what the work is.");
    setBusy("send");
    setNote(null);
    try {
      const r = await askProjectQuotes({
        projectId,
        stageId: draft.stageId || null,
        contractorIds: ids,
        scope: draft.scope,
        dueBy: DAY.test(draft.dueBy) ? draft.dueBy : null,
        title: draft.title.trim() || null,
        trade,
        description: draft.description.trim() || null,
        materials: draft.materials.trim() || null,
        labor: draft.labor.trim() || null,
        startsAt: DAY.test(draft.startsAt) ? draft.startsAt : null,
        endsAt: DAY.test(draft.endsAt) ? draft.endsAt : null,
        instructions: draft.instructions.trim() || null,
        fileIds: [...draft.fileIds],
        documentIds: draft.drawings.map((d) => d.id),
      });
      const how = (a: (typeof r.asked)[number]) => (a.text === "sent" && a.email === "sent" ? "text and email sent" : a.text === "sent" ? "text sent" : a.email === "sent" ? "email sent" : a.text === "failed" || a.email === "failed" ? "the send failed — copy the link" : "no phone or email on file — copy the link");
      onSent(`RFQ-${r.requestNumber} sent to ${r.asked.map((a) => `${a.contractor} (${how(a)})`).join(", ")}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof RequestDraft>(k: K, v: RequestDraft[K]) => setDraft((cur) => (cur ? { ...cur, [k]: v } : cur));

  return (
    <BlueprintSheet open={draft !== null} onClose={() => busy === null && onClose()} title="Request quotes" description="Each contractor gets an email (and a text where allowed) with their own link: the scope and the files, a price box with their estimate attached, a note.">
      {draft ? (
        <div className={s.form} data-subs-ask-sheet>
          <label className={s.field}>
            <span className={s.lab}>The work</span>
            <select className={s.input} value={draft.stageId} onChange={(e) => pickStage(e.target.value)} data-subs-ask-stage>
              {stages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
          <div className={s.field}>
            <span className={s.lab}>Contractors{trade ? ` — ${trade} first` : ""}</span>
            {ordered.length ? (
              <div className={s.checks}>
                {ordered.map((c) => (
                  <label key={c.id} className={s.check} data-subs-ask-contractor>
                    <input
                      type="checkbox"
                      checked={draft.picked.has(c.id)}
                      onChange={(e) =>
                        setDraft((cur) => {
                          if (!cur) return cur;
                          const next = new Set(cur.picked);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return { ...cur, picked: next };
                        })
                      }
                    />
                    <span>
                      {c.name}
                      {c.company ? ` · ${c.company}` : ""}
                      {c.trade ? ` · ${c.trade}` : ""}
                      {!c.phone && !c.email ? " · no phone or email" : ""}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className={s.empty}>No contractors on your list yet.</p>
            )}
            {draft.adding ? (
              <div className={s.form} style={{ marginTop: 8 }} data-subs-new-contractor>
                <input className={s.input} placeholder="Name" value={draft.adding.name} onChange={(e) => setDraft((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, name: e.target.value } } : cur))} aria-label="Contractor name" data-subs-new-name />
                <select className={s.input} value={draft.adding.trade} onChange={(e) => setDraft((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, trade: e.target.value } } : cur))} aria-label="Trade">
                  <option value="">Trade</option>
                  {TRADE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input className={s.input} placeholder="Phone" inputMode="tel" value={draft.adding.phone} onChange={(e) => setDraft((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, phone: e.target.value } } : cur))} aria-label="Phone" data-subs-new-phone />
                <input className={s.input} placeholder="Email" inputMode="email" value={draft.adding.email} onChange={(e) => setDraft((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, email: e.target.value } } : cur))} aria-label="Email" data-subs-new-email />
                <div className={s.stageActs} style={{ justifyContent: "flex-start" }}>
                  <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !draft.adding.name.trim()} onClick={() => void addNew()} data-subs-new-save>
                    Add and pick
                  </button>
                  <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => set("adding", null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="bps-btn bps-btn--ghost" style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => set("adding", { name: "", trade: trade ?? "", phone: "", email: "" })} data-subs-new>
                + New contractor
              </button>
            )}
          </div>
          <label className={s.field}>
            <span className={s.lab}>The scope they read</span>
            <textarea className={s.input} rows={6} maxLength={2000} value={draft.scope} onChange={(e) => set("scope", e.target.value)} data-subs-ask-scope />
          </label>
          <label className={s.field}>
            <span className={s.lab}>Reply by</span>
            <input className={s.input} type="text" placeholder="YYYY-MM-DD" value={draft.dueBy} onChange={(e) => set("dueBy", e.target.value)} data-subs-ask-due />
          </label>
          <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => set("more", !draft.more)} data-subs-ask-more>
            {draft.more ? "Fewer details" : "More details and files"}
          </button>
          {draft.more ? (
            <>
              <label className={s.field}>
                <span className={s.lab}>Title</span>
                <input className={s.input} value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} data-subs-ask-title />
              </label>
              <label className={s.field}>
                <span className={s.lab}>Description</span>
                <textarea className={s.input} rows={4} maxLength={4000} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="What the work is in your own words — the rooms, the finish, what is in and what is out." data-subs-ask-description />
              </label>
              <label className={s.field}>
                <span className={s.lab}>Materials</span>
                <textarea className={s.input} rows={2} maxLength={2000} value={draft.materials} onChange={(e) => set("materials", e.target.value)} placeholder="Who supplies what; the brands or grades asked for." data-subs-ask-materials />
              </label>
              <label className={s.field}>
                <span className={s.lab}>Labor</span>
                <textarea className={s.input} rows={2} maxLength={2000} value={draft.labor} onChange={(e) => set("labor", e.target.value)} placeholder="Crew size, hours on site, what the office's crew does." data-subs-ask-labor />
              </label>
              <div className={s.form} style={{ gridTemplateColumns: "1fr 1fr", display: "grid", gap: 8 }}>
                <label className={s.field}>
                  <span className={s.lab}>Starts about</span>
                  <input className={s.input} type="text" placeholder="YYYY-MM-DD" value={draft.startsAt} onChange={(e) => set("startsAt", e.target.value)} data-subs-ask-starts />
                </label>
                <label className={s.field}>
                  <span className={s.lab}>Done by</span>
                  <input className={s.input} type="text" placeholder="YYYY-MM-DD" value={draft.endsAt} onChange={(e) => set("endsAt", e.target.value)} data-subs-ask-ends />
                </label>
              </div>
              <label className={s.field}>
                <span className={s.lab}>Instructions</span>
                <textarea className={s.input} rows={2} maxLength={2000} value={draft.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="How to quote: lump sum or by unit, exclusions to list, a site visit day." data-subs-ask-instructions />
              </label>
              <div className={s.field}>
                <span className={s.lab}>Files they get</span>
                {files.length ? (
                  <div className={s.checks}>
                    {files.map((f) => (
                      <label key={f.id} className={s.check} data-subs-ask-file>
                        <input
                          type="checkbox"
                          checked={draft.fileIds.has(f.id)}
                          onChange={(e) =>
                            setDraft((cur) => {
                              if (!cur) return cur;
                              const next = new Set(cur.fileIds);
                              if (e.target.checked) next.add(f.id);
                              else next.delete(f.id);
                              return { ...cur, fileIds: next };
                            })
                          }
                        />
                        <span>
                          {f.name} · {f.kind}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className={s.empty}>No files on the project yet — the Client&apos;s page card keeps them.</p>
                )}
                {draft.drawings.map((d) => (
                  <div key={d.id} className={s.check} data-subs-ask-drawing>
                    <span>
                      {d.name}
                      {d.bytes ? ` · ${docSize(d.bytes)}` : ""} · drawing
                    </span>
                  </div>
                ))}
                <input ref={fileRef} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void addDrawing(e.target.files[0])} data-subs-ask-upload />
                <button type="button" className="bps-btn bps-btn--ghost" style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => fileRef.current?.click()} data-subs-ask-upload-btn>
                  {busy === "drawing" ? `Uploading… ${pct ?? 0}%` : "+ Upload a drawing or photo"}
                </button>
              </div>
            </>
          ) : null}
          {note ? <p className={s.note}>{note}</p> : null}
          <div className={s.stageActs}>
            <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !draft.picked.size || !draft.scope.trim()} onClick={() => void send()} data-subs-ask-send>
              {busy === "send" ? "Sending…" : `Send to ${draft.picked.size || ""}`.trim()}
            </button>
          </div>
        </div>
      ) : null}
    </BlueprintSheet>
  );
}
