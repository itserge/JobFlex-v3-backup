"use client";

// PHOTOS & FILES ON A PROJECT, in Blueprint (2026-10-30). The same folder and
// the same way up as before (lib/home/uploadClient: Blob with a token, this
// machine's disk in development, a small data-URL picture before the store
// exists; actions/homeFiles to remove) — now with a drop zone beside the
// button, a preview tile per file and a progress line per upload. The
// contractor hears once per batch, with the last file.

import * as React from "react";
import { useRouter } from "next/navigation";
import { deleteHomeFile } from "@/actions/homeFiles";
import type { FolderFileView, FolderRequestView } from "@/lib/home/files";
import { uploadHomeFile } from "@/lib/home/uploadClient";
import { MediaUploadError } from "@/lib/media/uploadJobMedia";
import { fileSize } from "@/lib/jobMediaShared";
import { LocalTime } from "@/components/portal/live-time";
import s from "./portal.module.css";

const ACCEPT = "image/*,video/*,application/pdf";
type Progress = { name: string; pct: number; error: string | null };

export function FolderBox({ homeKey, token, orgName, files, requests, storage, timeZone }: { homeKey: string; token: string; orgName: string | null; files: FolderFileView[]; requests: FolderRequestView[]; storage: "blob" | "local" | "inline"; timeZone: string }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [progress, setProgress] = React.useState<Progress[]>([]);
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const open = requests.filter((r) => !r.fulfilledAt);

  async function send(list: FileList | File[] | null) {
    if (!list || !list.length || busy) return;
    const picked = Array.from(list).slice(0, 12);
    setBusy(true);
    setDone(null);
    setError(null);
    setProgress(picked.map((f) => ({ name: f.name, pct: 0, error: null })));
    let added = 0;
    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      const last = i === picked.length - 1;
      try {
        const r = await uploadHomeFile({
          homeKey,
          token,
          file,
          note: note.trim() || null,
          notify: last ? { count: added + 1 } : null,
          onProgress: (pct) => setProgress((p) => p.map((x, j) => (j === i ? { ...x, pct } : x))),
        });
        if (r.ok) {
          added += 1;
          setProgress((p) => p.map((x, j) => (j === i ? { ...x, pct: 100 } : x)));
        } else setProgress((p) => p.map((x, j) => (j === i ? { ...x, error: r.error } : x)));
      } catch (err) {
        const msg = err instanceof MediaUploadError ? err.message : "The upload didn't go through — check the connection and try again.";
        setProgress((p) => p.map((x, j) => (j === i ? { ...x, error: msg } : x)));
      }
    }
    setBusy(false);
    if (added) {
      setDone(added === 1 ? `Added — ${orgName ? `${orgName} can see it.` : "the contractor who takes the project will see it."}` : `${added} files added${orgName ? ` — ${orgName} can see them.` : "."}`);
      setNote("");
      router.refresh();
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await deleteHomeFile({ key: homeKey, id });
      if (r.ok) router.refresh();
      else setError(r.error);
    } catch {
      setError("Couldn't remove that file — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack} style={{ gap: 12 }}>
      {open.map((r) => (
        <p key={r.id} className={s.ask} role="status">
          <b>{r.orgName} asked for photos</b>
          {r.note ? <> — “{r.note}”</> : null}
          <span className={s.muted}> · <LocalTime iso={r.at} tz={timeZone} /></span>
        </p>
      ))}

      <div
        className={s.drop}
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files);
        }}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void send(e.target.files)} />
        <button type="button" className={s.btnPrimary} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Uploading…" : "Add photos or files"}
        </button>
        <p className={s.muted}>or drop them here — pictures, videos, PDFs</p>
      </div>
      <label className={s.field}>
        <span>A note with the files (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="The leak is above the window" maxLength={500} name={`folder-note-${token}`} />
      </label>

      {progress.length > 0 && (
        <ul className={s.progress} aria-live="polite">
          {progress.map((p, i) => (
            <li key={i}>
              <span className={s.tileName}>{p.name}</span>
              {p.error ? <span className={s.err}>{p.error}</span> : <span className={s.meter} role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label={p.name}><i style={{ width: `${p.pct}%` }} /></span>}
            </li>
          ))}
        </ul>
      )}
      {done && <p className={s.ok} role="status">{done}</p>}
      {error && <p className={s.err} role="alert">{error}</p>}

      {files.length > 0 ? (
        <ul className={s.tiles} aria-label="Files on this project">
          {files.map((f) => (
            <li key={f.id} className={s.tile} data-media={f.media}>
              <a className={s.tileLink} href={f.href} target="_blank" rel="noopener noreferrer" title={f.note ?? f.name}>
                {f.media === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private file through its own checked route, no loader
                  <img src={f.href} alt={f.note ?? f.name} loading="lazy" />
                ) : (
                  <span>{f.media === "video" ? "Video" : "PDF"}</span>
                )}
              </a>
              <span className={s.tileName}>{f.note || f.name}</span>
              <span className={s.muted} style={{ fontSize: 12 }}>{fileSize(f.bytes)} · <LocalTime iso={f.at} kind="date" tz={timeZone} /></span>
              <button type="button" className={s.tileX} aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => void remove(f.id)}>
                <svg className={`${s.ic} ${s.icSm}`} aria-hidden="true"><use href="#i-x" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.muted}>No photos yet. Pictures of the problem help the contractor price it right.</p>
      )}
      <p className={s.fine}>
        {storage === "inline"
          ? "Pictures up to 4 MB for now — videos need JobFlex's file storage, which is being switched on."
          : `Pictures, videos and PDFs up to 100 MB each. Only you and ${orgName ?? "your contractor"} can see them.`}
      </p>
    </div>
  );
}
