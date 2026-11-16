"use client";

// "DO IT FOR ME" ON THE IMPORT PAGE (2026-11-16, CRM migration plan part 4 — the owner: free for everyone, within 2
// business days). Under the program's export steps: send us the files instead (any of them — an old Excel, a Numbers
// file, the .zip QuickBooks gives), with a note. They go straight to the private store (lib/import/uploadClient) and
// the request is kept (actions/importRequests askForImport); the platform admins are emailed, and the list below
// says where each request stands. Styles: ./import.css (`.jf-import` root, three classes per rule).

import { useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { askForImport, cancelImportRequest } from "@/actions/importRequests";
import { MAX_REQUEST_FILES, NOTE_MAX, PROMISE, REQUEST_FILE_ACCEPT } from "@/lib/import/requests";
import { sourceInfo, type ImportSource } from "@/lib/import/sources";
import { ImportUploadError, uploadImportFile, type UploadedImportFile } from "@/lib/import/uploadClient";
import type { RequestView } from "@/lib/import/requestServer";

type Slot = { key: string; name: string; bytes: number; pct: number; done: UploadedImportFile | null; error: string | null };

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function DoItForMe({ source, onSent }: { source: ImportSource; onSent: (r: RequestView) => void }) {
  const label = sourceInfo(source).label;
  const program = source === "OTHER" ? "your program" : label;
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<RequestView | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Slot>) => setSlots((all) => all.map((s) => (s.key === key ? { ...s, ...p } : s)));

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const room = MAX_REQUEST_FILES - slots.length;
    const picked = [...list].slice(0, Math.max(0, room));
    if (list.length > room) setError(`Up to ${MAX_REQUEST_FILES} files in one request.`);
    const fresh: Array<Slot & { file: File }> = picked.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, name: file.name, bytes: file.size, pct: 0, done: null, error: null, file }));
    setSlots((all) => [...all, ...fresh.map((s): Slot => ({ key: s.key, name: s.name, bytes: s.bytes, pct: s.pct, done: s.done, error: s.error }))]);
    // One after another: a phone on a weak signal sends one file well rather than three badly.
    for (const s of fresh) {
      try {
        const done = await uploadImportFile(s.file, { onProgress: (pct) => patch(s.key, { pct }) });
        patch(s.key, { pct: 100, done });
      } catch (err) {
        patch(s.key, { error: err instanceof ImportUploadError ? err.message : "The upload failed — try again." });
      }
    }
  }

  async function send() {
    const files = slots.filter((s) => s.done).map((s) => s.done!);
    if (!files.length) return;
    setSending(true);
    setError(null);
    const res = await askForImport({ source, note: note.trim() || null, files }).catch(() => ({ ok: false as const, error: "Couldn't send it — try again." }));
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(res.request);
    setSlots([]);
    setNote("");
    onSent(res.request);
  }

  const uploading = slots.some((s) => !s.done && !s.error);
  const ready = slots.some((s) => s.done) && !uploading && !sending;

  return (
    <div className="imp-dfm" data-dfm>
      <div className="imp-dfm-head">
        <div>
          <h3 className="imp-h3">Rather we do it for you?</h3>
          <p className="imp-meta">
            Send us the files {program} gives you — any of them, an old Excel or a Numbers file too — and our team brings your clients in, free, {PROMISE}. We&apos;ll email you when they&apos;re in. We never ask for your {program} password.
          </p>
        </div>
        {!open ? (
          <button type="button" className="imp-btn imp-ghost" onClick={() => setOpen(true)} data-dfm-open>
            Do it for me
          </button>
        ) : null}
      </div>

      {sent ? (
        <p className="imp-note" role="status" data-dfm-sent>
          Sent. Our team will bring them in by <b>{sent.due}</b> and email you. You can follow it below.
        </p>
      ) : null}

      {open ? (
        <div className="imp-dfm-form">
          <div className="imp-acts">
            <button type="button" className="imp-btn imp-ghost" onClick={() => input.current?.click()} disabled={slots.length >= MAX_REQUEST_FILES}>
              Choose the files
            </button>
            <span className="imp-meta">CSV, Excel, Numbers, a PDF or a zip · up to 50 MB each</span>
            <input
              ref={input}
              type="file"
              multiple
              accept={REQUEST_FILE_ACCEPT}
              hidden
              onChange={(e) => {
                void pick(e.target.files);
                e.target.value = "";
              }}
              data-dfm-input
            />
          </div>
          {slots.length ? (
            <ul className="imp-dfm-files">
              {slots.map((s) => (
                <li key={s.key} data-dfm-file={s.done ? "done" : s.error ? "error" : "uploading"}>
                  <span className="imp-dfm-name">{s.name}</span>
                  <span className="imp-soft">{size(s.bytes)}</span>
                  <span className={s.error ? "imp-dfm-bad" : "imp-soft"}>{s.error ?? (s.done ? "✓ uploaded" : `${s.pct}%`)}</span>
                  <button type="button" className="imp-x" aria-label={`Remove ${s.name}`} onClick={() => setSlots((all) => all.filter((x) => x.key !== s.key))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="imp-dfm-label">
            <span>Anything we should know? (optional)</span>
            <textarea
              className="imp-dfm-note"
              rows={3}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Only active customers · the tag “VIP” means a maintenance plan · skip jobs before 2020…"
              data-dfm-note
            />
          </label>
          {error ? (
            <p className="imp-error" role="alert" data-dfm-error>
              {error}
            </p>
          ) : null}
          <div className="imp-acts">
            <button type="button" className="imp-btn imp-primary" disabled={!ready} onClick={() => void send()} data-dfm-send>
              {sending ? "Sending…" : uploading ? "Uploading…" : "Send to our team"}
            </button>
            <button
              type="button"
              className="imp-btn imp-quiet"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Not now
            </button>
          </div>
          <p className="imp-meta">Nothing is sent to your clients. Your files stay private and are deleted once your clients are in.</p>
        </div>
      ) : null}
    </div>
  );
}

export function RequestList({ requests, onChange }: { requests: RequestView[]; onChange: (next: RequestView[]) => void }) {
  const [ask, setAsk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!requests.length) return null;

  async function cancel(id: string) {
    setAsk(null);
    const res = await cancelImportRequest(id).catch(() => ({ ok: false as const, error: "Couldn't cancel it — try again." }));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChange(requests.map((r) => (r.id === id ? { ...r, status: "CANCELED", statusWords: "Cancelled", reason: "Cancelled by the company." } : r)));
  }

  return (
    <section className="imp-step" data-request-list>
      <h2 className="imp-h">Sent to our team</h2>
      {error ? (
        <p className="imp-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="imp-past">
        {requests.map((r) => (
          <li key={r.id} data-request-row={r.id} data-request-status={r.status}>
            <div>
              <b>{r.sourceLabel}</b> · sent {shortDate(r.createdAt)} · {r.files.length} file{r.files.length === 1 ? "" : "s"}
              <span className="imp-soft">
                {" "}
                · {r.statusWords}
                {r.status === "NEW" || r.status === "WORKING" || r.status === "RUNNING" ? ` — by ${r.due}` : ""}
                {r.status === "CANCELED" && r.reason ? ` — ${r.reason}` : ""}
              </span>
            </div>
            {r.status === "NEW" ? (
              ask === r.id ? (
                <div className="imp-ask" role="group" aria-label="Cancel this request?">
                  <span>Cancel it? Your files are deleted.</span>
                  <button type="button" className="imp-btn imp-danger" onClick={() => void cancel(r.id)} data-request-cancel-yes>
                    Yes, cancel
                  </button>
                  <button type="button" className="imp-btn imp-ghost" onClick={() => setAsk(null)}>
                    Keep it
                  </button>
                </div>
              ) : (
                <button type="button" className="imp-btn imp-quiet" onClick={() => setAsk(r.id)} data-request-cancel={r.id}>
                  Cancel
                </button>
              )
            ) : r.status === "DONE" ? (
              <Link className="imp-btn imp-quiet" href={"/dashboard/clients" as Route}>
                See your clients
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
