"use client";

// BRING YOUR CLIENTS (2026-11-16 — the owner: "offer me a plan how to move contractors' CRM base with clients to
// JobFlex from other platforms like Housecall Pro or others"; parts 1–2) — /dashboard/clients/import.
//
//   1. Where are you coming from? — Housecall Pro, Jobber, ServiceTitan, Workiz, JobNimbus, QuickBooks, contacts, a
//      spreadsheet; each with the steps to get its files out (lib/import/sources).
//   2. Drop the files (CSV or Excel, several at once). Each is read (actions/dataImport previewImport): what it is
//      (clients · jobs and invoices · estimates), which column is what — the person can change any of it — and
//      what would come in: new clients, clients joined to ones already here, open invoices and what is owed,
//      upcoming jobs, history, rows left out and why. Nothing is written until…
//   3. Bring them in. Then: what came in, the links to see it, and Undo. Past imports are listed with their Undo.
//
// Styles: ./import.css — plain CSS under `.jf-import`, every rule at two classes or more (the shell's reset).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { listImports, previewImport, runImport, undoImport } from "@/actions/dataImport";
import type { ImportPreview, PreviewFile } from "@/lib/import/pipeline";
import type { ImportRecord } from "@/lib/import/server";
import { IMPORT_SOURCES, sourceInfo, type ImportSource } from "@/lib/import/sources";
import { FIELD_LABEL, FIELDS_FOR, FILE_KIND_LABEL, FILE_KINDS, type FileKind, type ImportField } from "@/lib/import/columns";
import type { PlanCounts } from "@/lib/import/plan";
import { MAX_TABLE_ROWS } from "@/lib/import/table";
import { countLines } from "@/lib/import/requests";
import type { RequestView } from "@/lib/import/requestServer";
import { DoItForMe, RequestList } from "./do-it-for-me";
import "./import.css";

type Setup = Record<string, { kind?: FileKind; map?: ImportField[]; leaveOut?: boolean }>;

const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/** What one call may carry: Vercel takes about 4.5 MB in a request, and the form itself needs a little of it. */
const MAX_SEND_BYTES = 4_200_000;
const packs = new WeakMap<File, Promise<File>>();

/** A CSV packed (gzip) before it travels — it shrinks to about a tenth; the server opens it again (lib/import/server
 *  tablesOf). An Excel file is packed already; a browser without CompressionStream sends the file as it is. */
function packed(file: File): Promise<File> {
  const had = packs.get(file);
  if (had) return had;
  const go = (async () => {
    if (typeof CompressionStream === "undefined" || file.size < 100_000 || /\.(xlsx|xlsm|xls|numbers|gz)$/i.test(file.name)) return file;
    try {
      const blob = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
      return blob.size < file.size ? new File([blob], `${file.name}.gz`, { type: "application/gzip" }) : file;
    } catch {
      return file;
    }
  })();
  packs.set(file, go);
  return go;
}

/** The files and how they are set up, as one call carries them — or why they cannot go in one call. */
async function form(files: File[], source: ImportSource, setup: Setup): Promise<FormData | string> {
  const sent = await Promise.all(files.map(packed));
  const total = sent.reduce((a, f) => a + f.size, 0);
  if (total > MAX_SEND_BYTES) {
    return files.length > 1
      ? "Those files are too big to bring in together. Bring the clients file first, then the jobs and invoices, then the estimates — each import finds the clients an earlier one brought."
      : `${files[0].name} is too big to bring in at once. Export it in parts (a year of jobs at a time) and bring them one after another.`;
  }
  const f = new FormData();
  f.set("source", source);
  for (const file of sent) f.append("file", file);
  f.set("setup", JSON.stringify(Object.entries(setup).map(([id, s]) => ({ id, ...s }))));
  return f;
}

export function ClientImportPage({ imports: first, requests, initialSource = null }: { imports: ImportRecord[]; requests: RequestView[]; initialSource?: ImportSource | null }) {
  // A visitor who came from a "Switch to JobFlex" page (?from=housecall-pro) starts on their program.
  const [source, setSource] = useState<ImportSource | null>(initialSource);
  const [files, setFiles] = useState<File[]>([]);
  const [setup, setSetup] = useState<Setup>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const [done, setDone] = useState<{ importId: string; counts: PlanCounts } | null>(null);
  const [imports, setImports] = useState<ImportRecord[]>(first);
  const [reqs, setReqs] = useState<RequestView[]>(requests);
  const [undoAsk, setUndoAsk] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const info = source ? sourceInfo(source) : null;

  async function read(nextFiles: File[], nextSetup: Setup, src: ImportSource) {
    if (!nextFiles.length) {
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    setBusy("reading");
    const body = await form(nextFiles, src, nextSetup);
    const res: ImportPreview =
      typeof body === "string" ? { ok: false, error: body } : await previewImport(body).catch(() => ({ ok: false as const, error: "Couldn't read those files. Try again." }));
    if (mine !== seq.current) return;
    setPreview(res);
    setBusy(null);
  }

  function pick(list: FileList | null) {
    if (!list?.length || !source) return;
    const have = new Set(files.map((f) => `${f.name}:${f.size}`));
    const next = [...files, ...[...list].filter((f) => !have.has(`${f.name}:${f.size}`))].slice(0, 12);
    setFiles(next);
    setSetup({});
    setDone(null);
    void read(next, {}, source);
  }

  function removeFile(i: number) {
    if (!source) return;
    const next = files.filter((_, k) => k !== i);
    setFiles(next);
    setSetup({});
    void read(next, {}, source);
  }

  function change(id: string, s: Setup[string], wait = 0) {
    if (!source) return;
    const next = { ...setup, [id]: s };
    setSetup(next);
    // Reading from now: "Bring them in" waits for the preview of what was just changed, never runs on the one before.
    setBusy("reading");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void read(files, next, source), wait);
  }

  function setKind(f: PreviewFile, kind: FileKind | "out") {
    if (kind === "out") change(f.id, { leaveOut: true });
    else change(f.id, { kind });
  }

  /** A file's columns as the person has them: their own changes over the last preview's (two quick changes both hold). */
  const mapOf = (f: PreviewFile): ImportField[] => {
    const own = setup[f.id]?.map;
    return own && own.length === f.map.length && (setup[f.id]?.kind ?? f.kind) === f.kind ? own : f.map;
  };

  function setField(f: PreviewFile, col: number, field: ImportField) {
    const map = [...mapOf(f)];
    map[col] = field;
    change(f.id, { kind: f.kind, map }, 500);
  }

  async function bringIn() {
    if (!source || !preview?.ok) return;
    // The run reads the files exactly as the preview shows them: each file's kind and columns.
    const confirmed: Setup = { ...setup };
    for (const f of preview.files) confirmed[f.id] = { kind: f.kind, map: f.map };
    setBusy("importing");
    const body = await form(files, source, confirmed);
    const res =
      typeof body === "string" ? { ok: false as const, error: body } : await runImport(body).catch(() => ({ ok: false as const, error: "Something went wrong. Nothing was brought in — try again." }));
    setBusy(null);
    if (!res.ok) {
      setPreview({ ok: false, error: res.error });
      return;
    }
    setDone({ importId: res.importId, counts: res.counts });
    setFiles([]);
    setSetup({});
    setPreview(null);
    setImports(await listImports().catch(() => imports));
    // The shell scrolls its own column, not the window: bring the page's top (the "Brought in" card) into view.
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function undo(id: string) {
    setUndoAsk(null);
    const res = await undoImport(id).catch(() => ({ ok: false as const, error: "Couldn't undo it. Try again." }));
    if (!res.ok) {
      setNote(res.error);
      return;
    }
    const r = res.result;
    setNote(
      `Undone: ${plural(r.removed.clients, "client")} removed, ${plural(r.removed.invoices, "invoice")}, ${plural(r.removed.jobs, "job")} and ${plural(r.removed.history, "history line")} taken away.${r.kept.clients + r.kept.jobs + r.kept.invoices ? ` Kept because they were worked on since: ${[r.kept.clients ? plural(r.kept.clients, "client") : null, r.kept.jobs ? plural(r.kept.jobs, "job") : null, r.kept.invoices ? plural(r.kept.invoices, "invoice") : null].filter(Boolean).join(", ")}.` : ""}`,
    );
    if (done?.importId === id) setDone(null);
    setImports(await listImports().catch(() => imports));
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const left = useMemo(() => Object.entries(setup).filter(([, s]) => s.leaveOut).map(([id]) => id), [setup]);
  const ready = !!preview?.ok && !preview.blocked && preview.files.every((f) => !f.missing.length) && busy === null;

  return (
    <div className="jf-import" data-import-page ref={root}>
      <div className="page-head">
        <div>
          <div className="kicker">Clients</div>
          <h1 className="page-title">Bring your clients</h1>
        </div>
        <div className="page-actions">
          <Link className="imp-btn imp-ghost" href={"/dashboard/clients" as Route}>
            Back to clients
          </Link>
        </div>
      </div>
      <p className="imp-lead">
        Moving from another program? Bring your clients — and their unpaid invoices, upcoming jobs and history — from the files it exports. Nothing is sent to your clients, nothing is changed until you press <b>Bring them in</b>, and every import can be undone.
      </p>

      {done ? (
        <section className="imp-done" data-import-done>
          <h2 className="imp-h">Brought in</h2>
          <ul className="imp-list">
            {countLines(done.counts).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="imp-acts">
            <Link className="imp-btn imp-primary" href={"/dashboard/clients" as Route}>
              See your clients
            </Link>
            {done.counts.upcoming ? (
              <Link className="imp-btn imp-ghost" href={"/dashboard/calendar" as Route}>
                Open the calendar
              </Link>
            ) : null}
            {done.counts.invoices ? (
              <Link className="imp-btn imp-ghost" href={"/dashboard/financials" as Route}>
                See who owes money
              </Link>
            ) : null}
            <button type="button" className="imp-btn imp-quiet" onClick={() => setUndoAsk(done.importId)} data-import-undo={done.importId}>
              Undo this import
            </button>
          </div>
          {undoAsk === done.importId ? <UndoAsk onYes={() => void undo(done.importId)} onNo={() => setUndoAsk(null)} /> : null}
        </section>
      ) : null}
      {note ? (
        <p className="imp-note" role="status" data-import-note>
          {note}
        </p>
      ) : null}

      <section className="imp-step">
        <h2 className="imp-h">1 · Where are you coming from?</h2>
        <div className="imp-sources" role="radiogroup" aria-label="Where are you coming from?">
          {IMPORT_SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={source === s.id}
              className={`imp-source${source === s.id ? " is-on" : ""}`}
              onClick={() => {
                setSource(s.id);
                if (files.length) void read(files, setup, s.id);
              }}
              data-import-source={s.id}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {info ? (
        <section className="imp-step" data-import-steps>
          <h2 className="imp-h">2 · Get your files out of {info.label}</h2>
          <ol className="imp-howto">
            {info.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="imp-meta">Bring: {info.files} You can drop them all at once.</p>
          <div
            className={`imp-drop${dragging ? " is-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files);
            }}
            data-import-drop
          >
            <p>
              <b>Drop the exported files here</b>
              <br />
              CSV or Excel (.xlsx) — the customers file, the jobs, the estimates
            </p>
            <button type="button" className="imp-btn imp-primary" onClick={() => input.current?.click()}>
              Choose files
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = "";
              }}
              data-import-input
            />
          </div>
          {files.length ? (
            <ul className="imp-files">
              {files.map((f, i) => (
                <li key={`${f.name}:${f.size}`}>
                  <span>{f.name}</span>
                  <button type="button" className="imp-x" aria-label={`Remove ${f.name}`} onClick={() => removeFile(i)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <DoItForMe source={info.id} onSent={(r) => setReqs((all) => [r, ...all])} />
        </section>
      ) : null}

      <RequestList requests={reqs} onChange={setReqs} />

      {info && (busy === "reading" || preview) ? (
        <section className="imp-step" data-import-preview>
          <h2 className="imp-h">3 · Check what comes in</h2>
          {busy === "reading" ? <p className="imp-meta">Reading your files…</p> : null}
          {preview && !preview.ok ? (
            <p className="imp-error" role="alert" data-import-error>
              {preview.error}
            </p>
          ) : null}
          {preview?.ok ? (
            <>
              {preview.files.map((f) => (
                <FileCard key={f.id} f={f} map={mapOf(f)} source={source!} onKind={(k) => setKind(f, k)} onField={(col, field) => setField(f, col, field)} />
              ))}
              {left.length ? (
                <p className="imp-meta">
                  {plural(left.length, "file")} left out.{" "}
                  <button type="button" className="imp-link" onClick={() => change(left[0], {}, 0)}>
                    Bring {left.length === 1 ? "it" : "one"} back
                  </button>
                </p>
              ) : null}
              <div className="imp-summary" data-import-summary>
                <h3 className="imp-h3">What comes in</h3>
                <ul className="imp-list">
                  {countLines(preview.counts).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                  {preview.counts.again ? <li className="imp-soft">{plural(preview.counts.again, "row")} already in JobFlex — left as they are</li> : null}
                </ul>
                <Examples preview={preview} />
                {preview.skipped.length ? (
                  <details className="imp-skipped">
                    <summary>
                      {plural(preview.counts.skipped, "row")} left out — see why
                    </summary>
                    <ul>
                      {preview.skipped.map((s) => (
                        <li key={`${s.file}:${s.row}`}>
                          {s.file}, line {s.row}: {s.why}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <p className="imp-meta">
                  New clients are tagged <b>{source === "OTHER" ? "Imported" : `From ${info.label}`}</b>. Nothing is sent to anyone: no texts, emails, reminders or review requests.
                </p>
                {preview.blocked ? (
                  <p className="imp-error" role="alert" data-import-blocked>
                    {preview.blocked}{" "}
                    <Link className="imp-link" href={"/dashboard/upgrade" as Route}>
                      See plans
                    </Link>
                  </p>
                ) : null}
                <div className="imp-acts">
                  <button type="button" className="imp-btn imp-primary" disabled={!ready} onClick={() => void bringIn()} data-import-run>
                    {busy === "importing" ? "Bringing them in…" : "Bring them in"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {imports.length ? (
        <section className="imp-step" data-import-history>
          <h2 className="imp-h">Your imports</h2>
          <ul className="imp-past">
            {imports.map((r) => (
              <li key={r.id} data-import-row={r.id} data-import-status={r.status}>
                <div>
                  <b>{r.label}</b> · {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  <span className="imp-soft">
                    {" "}
                    · {r.status === "DONE" ? (r.counts ? countLines(r.counts).join(" · ") : "done") : r.status === "UNDONE" ? "undone" : r.status === "FAILED" ? "didn't finish — nothing kept" : "running"}
                  </span>
                </div>
                {r.status === "DONE" ? (
                  undoAsk === r.id ? (
                    <UndoAsk onYes={() => void undo(r.id)} onNo={() => setUndoAsk(null)} />
                  ) : (
                    <button type="button" className="imp-btn imp-quiet" onClick={() => setUndoAsk(r.id)} data-import-undo={r.id}>
                      Undo
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function UndoAsk({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="imp-ask" role="group" aria-label="Undo this import?">
      <span>Take back the clients, invoices, jobs and history this import made? Anything worked on since stays.</span>
      <button type="button" className="imp-btn imp-danger" onClick={onYes} data-import-undo-yes>
        Yes, undo it
      </button>
      <button type="button" className="imp-btn imp-ghost" onClick={onNo}>
        Keep it
      </button>
    </div>
  );
}

export function Examples({ preview }: { preview: Extract<ImportPreview, { ok: true }> }) {
  const e = preview.examples;
  const groups: Array<[string, string[]]> = [
    ["New clients", e.clients],
    ["Joined to clients already here", e.joined],
    ["Open invoices", e.invoices],
    ["Upcoming jobs", e.jobs],
    ["History", e.history],
  ];
  const shown = groups.filter(([, l]) => l.length);
  if (!shown.length) return null;
  return (
    <div className="imp-examples">
      {shown.map(([h, l]) => (
        <div key={h}>
          <div className="imp-ex-h">{h}, for example</div>
          <ul>
            {l.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function FileCard({ f, map, source, onKind, onField }: { f: PreviewFile; map: ImportField[]; source: ImportSource; onKind: (k: FileKind | "out") => void; onField: (col: number, field: ImportField) => void }) {
  const fields = FIELDS_FOR[f.kind];
  const open = f.missing.length > 0 || f.byModel;
  return (
    <div className="imp-file" data-import-file={f.id} data-import-kind={f.kind}>
      <div className="imp-file-head">
        <div className="imp-file-name">
          <b>{f.name}</b>
          <span className="imp-soft"> · {plural(f.rows, "row")}</span>
          {f.detected && f.detected !== source ? <span className="imp-flag"> · looks like a {sourceInfo(f.detected).label} file</span> : null}
        </div>
        <label className="imp-kind">
          <span>This file is</span>
          <select value={f.kind} onChange={(e) => onKind(e.target.value as FileKind | "out")} data-import-kind-select>
            {FILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {FILE_KIND_LABEL[k]}
              </option>
            ))}
            <option value="out">Leave this file out</option>
          </select>
        </label>
      </div>
      {f.missing.length ? (
        <p className="imp-error" role="alert">
          Set which column holds {f.missing.join(" and ")} — below.
        </p>
      ) : null}
      {f.cut ? (
        <p className="imp-error" role="alert" data-import-cut>
          This file has more than {MAX_TABLE_ROWS.toLocaleString("en-US")} rows — only the first {MAX_TABLE_ROWS.toLocaleString("en-US")} are read. Export the rest separately (a few years at a time) and bring it in after this one; rows already in JobFlex are left as they are.
        </p>
      ) : null}
      {f.byModel ? <p className="imp-meta">Some columns were read by AI — check them below.</p> : null}
      <details className="imp-cols" open={open}>
        <summary>Check the columns ({f.headers.length})</summary>
        <div className="imp-table-wrap">
          <table className="imp-table">
            <thead>
              <tr>
                <th>Their column</th>
                <th>First row</th>
                <th>In JobFlex</th>
              </tr>
            </thead>
            <tbody>
              {f.headers.map((h, i) => (
                <tr key={`${h}:${i}`} className={map[i] === "skip" ? "is-skip" : ""}>
                  <td>{h}</td>
                  <td className="imp-sample">{f.samples.map((r) => r[i]).find(Boolean) ?? ""}</td>
                  <td>
                    <select value={map[i]} aria-label={`${h} is`} onChange={(e) => onField(i, e.target.value as ImportField)} data-import-field={i}>
                      {fields.map((k) => (
                        <option key={k} value={k}>
                          {FIELD_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
