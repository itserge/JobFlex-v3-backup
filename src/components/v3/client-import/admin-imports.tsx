"use client";

// ADMIN → IMPORTS (2026-11-16, CRM migration plan part 4 — "Do it for me": free for everyone, within 2 business days,
// worked by the platform admins). The queue, and one request open: its facts, its files, and the workbench — the same
// file cards and "What comes in" as the contractor's own import page (./import-page), read from the files in the
// private store (actions/importRequests adminReadRequest), then "Bring them in for <company>" (adminBringIn). A file
// that cannot be read here (an old Excel, a Numbers file, a PDF) is listed: download it, save it as CSV, add it.
// Styles: ./import.css (`.jf-import` root).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { adminAddRequestFile, adminBringIn, adminCancelRequest, adminReadRequest, adminTakeRequest } from "@/actions/importRequests";
import type { ImportPreview, PreviewFile } from "@/lib/import/pipeline";
import type { AdminRequestDetail, AdminRequestRow } from "@/lib/import/requestServer";
import type { FileKind, ImportField } from "@/lib/import/columns";
import type { PlanCounts } from "@/lib/import/plan";
import { countLines, REASON_MAX, REQUEST_FILE_ACCEPT } from "@/lib/import/requests";
import { ImportUploadError, uploadImportFile } from "@/lib/import/uploadClient";
import { Examples, FileCard } from "./import-page";
import "./import.css";

type Setup = Record<string, { kind?: FileKind; map?: ImportField[]; leaveOut?: boolean }>;
const setupJson = (s: Setup) => JSON.stringify(Object.entries(s).map(([id, v]) => ({ id, ...v })));
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const OPEN = new Set(["NEW", "WORKING", "RUNNING"]);

export function AdminImportsContent({ rows, detail, openId }: { rows: AdminRequestRow[] | null; detail: AdminRequestDetail | null; openId: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const shown = useMemo(() => (rows ?? []).filter((r) => (filter === "all" ? true : filter === "open" ? OPEN.has(r.status) : !OPEN.has(r.status))), [rows, filter]);
  const openCount = (rows ?? []).filter((r) => OPEN.has(r.status)).length;
  const late = (rows ?? []).filter((r) => r.late).length;

  return (
    <div className="jf-import" data-admin-imports>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · Do it for me</div>
          <h1 className="page-title">Imports</h1>
        </div>
      </div>
      <p className="imp-lead">
        Contractors who sent us the files their old program exported. We promised their clients in within 2 business days, free. Open one, check the columns, bring it in for them — they&apos;re emailed, and the files are deleted from storage.
      </p>

      {rows === null ? (
        <p className="imp-error" role="alert">
          The ImportRequest table isn&apos;t in this database yet — run prisma/sql/prod-2026-11-16-import-requests.sql.
        </p>
      ) : null}
      {openId && !detail ? (
        <p className="imp-error" role="alert">
          No such request.
        </p>
      ) : null}
      {detail ? <RequestDetail key={detail.id + detail.status + detail.fileLinks.length} d={detail} onChanged={() => router.refresh()} /> : null}

      {rows ? (
        <section className="imp-step" data-queue>
          <h2 className="imp-h">
            Requests · {openCount} waiting{late ? <span className="imp-late"> · {late} late</span> : null}
          </h2>
          <div className="imp-acts" role="group" aria-label="Show">
            {(["open", "closed", "all"] as const).map((f) => (
              <button key={f} type="button" className={`imp-btn ${filter === f ? "imp-primary" : "imp-quiet"}`} onClick={() => setFilter(f)}>
                {f === "open" ? "Waiting" : f === "closed" ? "Done or cancelled" : "All"}
              </button>
            ))}
          </div>
          {shown.length ? (
            <div className="imp-table-wrap">
              <table className="imp-queue">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Company</th>
                    <th>From</th>
                    <th>Files</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={r.id === openId ? "is-open" : ""} data-queue-row={r.id} data-queue-status={r.status}>
                      <td>{when(r.createdAt)}</td>
                      <td>
                        <Link href={`/admin/imports?request=${r.id}` as Route}>{r.orgName}</Link>
                        <div className="imp-soft">{r.askedBy}</div>
                      </td>
                      <td>{r.sourceLabel}</td>
                      <td>{r.files.length}</td>
                      <td className={r.late ? "imp-late" : ""}>{OPEN.has(r.status) ? `${r.due}${r.late ? " · late" : ""}` : "—"}</td>
                      <td>
                        {r.status === "NEW" ? "New" : r.status === "WORKING" ? `Working${r.worker ? ` · ${r.worker.split(" · ")[0]}` : ""}` : r.status === "RUNNING" ? "Bringing in…" : r.status === "DONE" ? "Done" : "Cancelled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="imp-meta">{filter === "open" ? "Nothing waiting." : "Nothing here yet."}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function RequestDetail({ d, onChanged }: { d: AdminRequestDetail; onChanged: () => void }) {
  const open = OPEN.has(d.status);
  const [setup, setSetup] = useState<Setup>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"reading" | "bringing" | null>(null);
  const [done, setDone] = useState<PlanCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function read(next: Setup) {
    const mine = ++seq.current;
    setBusy("reading");
    const res = await adminReadRequest(d.id, setupJson(next)).catch(() => ({ ok: false as const, error: "Couldn't read the files — try again." }));
    if (mine !== seq.current) return;
    setPreview(res);
    setBusy(null);
  }

  function change(id: string, s: Setup[string], wait = 0) {
    const next = { ...setup, [id]: s };
    setSetup(next);
    setBusy("reading");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void read(next), wait);
  }

  const mapOf = (f: PreviewFile): ImportField[] => {
    const own = setup[f.id]?.map;
    return own && own.length === f.map.length && (setup[f.id]?.kind ?? f.kind) === f.kind ? own : f.map;
  };

  async function bring() {
    if (!preview?.ok) return;
    const confirmed: Setup = { ...setup };
    for (const f of preview.files) confirmed[f.id] = { kind: f.kind, map: f.map };
    setBusy("bringing");
    setError(null);
    const res = await adminBringIn(d.id, setupJson(confirmed)).catch(() => ({ ok: false as const, error: "Something went wrong — nothing was brought in." }));
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(res.counts);
    onChanged();
  }

  async function act(p: Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    const res = await p.catch(() => ({ ok: false as const, error: "That didn't go through — try again." }));
    if (!res.ok) setError(res.error);
    else onChanged();
  }

  async function addFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    setAdding(`${file.name} · 0%`);
    try {
      const up = await uploadImportFile(file, { requestId: d.id, onProgress: (pct) => setAdding(`${file.name} · ${pct}%`) });
      const res = await adminAddRequestFile(d.id, up);
      if (!res.ok) setError(res.error);
      else onChanged();
    } catch (err) {
      setError(err instanceof ImportUploadError ? err.message : "The upload failed — try again.");
    } finally {
      setAdding(null);
    }
  }

  const ready = !!preview?.ok && !preview.blocked && preview.files.length > 0 && preview.files.every((f) => !f.missing.length) && busy === null;

  return (
    <section className="imp-step" data-detail={d.id} data-detail-status={d.status}>
      <h2 className="imp-h">
        {d.orgName} · from {d.sourceLabel}
      </h2>
      <dl className="imp-facts">
        <div>
          <dt>Asked by</dt>
          <dd>{d.askedBy}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>{when(d.createdAt)}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd className={d.late ? "imp-late" : ""}>{open ? `${d.due}${d.late ? " — late" : ""}` : "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {d.statusWords}
            {d.worker ? ` · ${d.worker}` : ""}
          </dd>
        </div>
      </dl>
      {d.note ? <p className="imp-note">“{d.note}”</p> : <p className="imp-meta">No note.</p>}

      <h3 className="imp-h3">Files</h3>
      {d.filesDeleted ? <p className="imp-meta">Deleted from storage.</p> : null}
      <ul className="imp-dfm-files">
        {d.fileLinks.map((f, i) => (
          <li key={`${f.name}:${i}`} data-detail-file={f.name}>
            <span className="imp-dfm-name">{f.href ? <a href={f.href}>{f.name}</a> : f.name}</span>
            <span className="imp-soft">{size(f.bytes)}</span>
            {f.addedBy === "admin" ? <span className="imp-soft">added by the team</span> : null}
            {!f.readable ? <span className="imp-flag">can&apos;t be read here — download it, save it as CSV, add it below</span> : null}
          </li>
        ))}
      </ul>

      {d.status === "DONE" ? (
        <div className="imp-done" data-detail-done>
          <h3 className="imp-h3">Brought in{d.doneAt ? ` · ${when(d.doneAt)}` : ""}</h3>
          <ul className="imp-list">
            {(d.countLines.length ? d.countLines : ["Done"]).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.status === "CANCELED" ? <p className="imp-meta">Cancelled{d.reason ? ` — “${d.reason}”` : ""}.</p> : null}

      {error ? (
        <p className="imp-error" role="alert" data-detail-error>
          {error}
        </p>
      ) : null}

      {open && !done ? (
        <>
          <div className="imp-acts">
            {d.status === "NEW" ? (
              <button type="button" className="imp-btn imp-ghost" onClick={() => void act(adminTakeRequest(d.id))} data-take>
                I&apos;m on it
              </button>
            ) : null}
            <button type="button" className="imp-btn imp-ghost" onClick={() => addInput.current?.click()} disabled={!!adding} data-add>
              {adding ?? "Add a file"}
            </button>
            <input ref={addInput} type="file" accept={REQUEST_FILE_ACCEPT} hidden onChange={(e) => { void addFile(e.target.files); e.target.value = ""; }} data-add-input />
            <button type="button" className="imp-btn imp-quiet" onClick={() => setCancelOpen((v) => !v)} data-cancel-open>
              Cancel with a reason
            </button>
          </div>
          {cancelOpen ? (
            <div className="imp-ask" role="group" aria-label="Cancel this request">
              <textarea
                className="imp-dfm-note"
                rows={2}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What we found — the company reads it (e.g. “The file is a PDF report; please send the Customers export as CSV.”)"
                data-cancel-reason
              />
              <button type="button" className="imp-btn imp-danger" disabled={!reason.trim()} onClick={() => void act(adminCancelRequest(d.id, reason))} data-cancel-send>
                Cancel and email them
              </button>
            </div>
          ) : null}

          <div className="imp-summary" data-workbench>
            <h3 className="imp-h3">Bring it in for {d.orgName}</h3>
            {!preview ? (
              <div className="imp-acts">
                <button type="button" className="imp-btn imp-primary" disabled={busy !== null || d.filesDeleted} onClick={() => void read({})} data-read>
                  {busy === "reading" ? "Reading the files…" : "Read the files"}
                </button>
              </div>
            ) : null}
            {preview && !preview.ok ? (
              <p className="imp-error" role="alert" data-workbench-error>
                {preview.error}
              </p>
            ) : null}
            {preview?.ok ? (
              <>
                {preview.unread.length ? (
                  <div className="imp-error" role="alert" data-unread>
                    Not read: {preview.unread.map((u) => `${u.name} — ${u.why}`).join(" · ")}
                  </div>
                ) : null}
                {busy === "reading" ? <p className="imp-meta">Reading the files…</p> : null}
                {preview.files.map((f) => (
                  <FileCard
                    key={f.id}
                    f={f}
                    map={mapOf(f)}
                    source={preview.source}
                    onKind={(k) => (k === "out" ? change(f.id, { leaveOut: true }) : change(f.id, { kind: k }))}
                    onField={(col, field) => {
                      const map = [...mapOf(f)];
                      map[col] = field;
                      change(f.id, { kind: f.kind, map }, 500);
                    }}
                  />
                ))}
                <h3 className="imp-h3">What comes in</h3>
                <ul className="imp-list" data-workbench-summary>
                  {countLines(preview.counts).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                  {preview.counts.again ? <li className="imp-soft">{preview.counts.again.toLocaleString("en-US")} rows already in JobFlex — left as they are</li> : null}
                  {preview.counts.skipped ? <li className="imp-soft">{preview.counts.skipped.toLocaleString("en-US")} rows left out</li> : null}
                </ul>
                <Examples preview={preview} />
                {preview.blocked ? (
                  <p className="imp-error" role="alert" data-workbench-blocked>
                    {preview.blocked} Tell the company — they can upgrade, or we bring a part.
                  </p>
                ) : null}
                <div className="imp-acts">
                  <button type="button" className="imp-btn imp-primary" disabled={!ready} onClick={() => void bring()} data-bring>
                    {busy === "bringing" ? "Bringing them in…" : `Bring them in for ${d.orgName}`}
                  </button>
                </div>
                <p className="imp-meta">Nothing is sent to their clients. They&apos;re emailed when it&apos;s done and can undo it themselves; the files are deleted from storage.</p>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {done ? (
        <div className="imp-done" data-bring-done>
          <h3 className="imp-h3">Brought in for {d.orgName}</h3>
          <ul className="imp-list">
            {countLines(done).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
