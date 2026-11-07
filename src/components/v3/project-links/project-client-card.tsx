"use client";

// THE CLIENT'S PAGE, FOR THE OFFICE (the client build, 2026-11-06). One card for the desktop and the handheld project
// page: the homeowner's link (/p/<token>) — made, copied, opened — "Send the update" (email, and a text when the
// company texts its clients) with a word of your own, "Choose photos" (the project's jobs' photos, ticked for the
// page), and Files: the contract, the permit, the plans, the warranty — uploaded (a photo or a PDF) or linked, each
// marked for the client or not; the crew sees every file on the job. Writes: actions/projectClient (estimators and
// managers); everyone else reads the card.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProjectFile, loadProjectPhotos, removeProjectFile, sendClientUpdate, setClientPhotos, setProjectFileVisible, shareProjectPage } from "@/actions/projectClient";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdShare } from "@/components/v3/project-detail-blueprint/project-detail-data";
import type { PhotoRow } from "@/lib/projectClient/server";
import { FILE_KINDS, FILE_KIND_LABEL, FILE_MAX_BYTES, bytesWords, guessFileKind, type FileKind } from "@/lib/projectClient/shared";
import s from "./project-hub.module.css";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type FileDraft = { name: string; kind: FileKind; dataUrl: string | null; fileName: string | null; bytes: number; link: string; clientVisible: boolean };

export function ProjectClientCard({ projectId, share, canManage }: { projectId: string; share: PdShare; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState<{ note: string } | null>(null);
  const [picking, setPicking] = useState<{ photos: PhotoRow[]; on: Set<string>; loading: boolean } | null>(null);
  const [file, setFile] = useState<FileDraft | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = share.files.filter((f) => f.clientVisible).length;
  const refresh = () => startTransition(() => router.refresh());

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    let href = share.href;
    if (!href) {
      await run("share", async () => {
        href = (await shareProjectPage(projectId)).href;
      });
    }
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the link", href);
    }
  }

  async function openPicker() {
    setPicking({ photos: [], on: new Set(), loading: true });
    try {
      const photos = await loadProjectPhotos(projectId);
      setPicking({ photos, on: new Set(photos.filter((p) => p.shared).map((p) => p.id)), loading: false });
    } catch (e) {
      setPicking(null);
      setErr(e instanceof Error ? e.message : "Could not load the photos.");
    }
  }

  async function savePicker() {
    if (!picking) return;
    const was = new Set(picking.photos.filter((p) => p.shared).map((p) => p.id));
    const add = [...picking.on].filter((id) => !was.has(id));
    const drop = [...was].filter((id) => !picking.on.has(id));
    setPicking(null);
    await run("photos", async () => {
      if (add.length) await setClientPhotos(projectId, add, true);
      if (drop.length) await setClientPhotos(projectId, drop, false);
    });
  }

  function pickFile(f: File) {
    if (f.size > FILE_MAX_BYTES) return setFileErr("That file is over 8 MB — paste a link to it instead.");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      setFile((cur) => (cur ? { ...cur, dataUrl, fileName: f.name, bytes: f.size, link: "", name: cur.name || f.name.replace(/\.[a-z0-9]+$/i, ""), kind: cur.name ? cur.kind : guessFileKind(f.name) } : cur));
      setFileErr(null);
    };
    reader.onerror = () => setFileErr("Could not read that file.");
    reader.readAsDataURL(f);
  }

  async function saveFile() {
    if (!file) return;
    if (!file.name.trim()) return setFileErr("Name the file — Signed contract, Permit card, Kitchen plans");
    if (!file.dataUrl && !file.link.trim()) return setFileErr("Pick a file or paste a link");
    const draft = file;
    setFile(null);
    await run("file", async () => {
      await addProjectFile(projectId, { name: draft.name.trim(), kind: draft.kind, dataUrl: draft.dataUrl, link: draft.link.trim() || null, clientVisible: draft.clientVisible });
    });
  }

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Client's page" data-project-client>
        <div className={s.head}>
          <h3 className={s.title}>Client&apos;s page</h3>
          <span className={s.headSub}>
            {share.token ? (
              <>
                <b>{share.photosShared}</b> photo{share.photosShared === 1 ? "" : "s"} · <b>{visible}</b> document{visible === 1 ? "" : "s"}
                {share.updateSentAt ? ` · update sent ${day(share.updateSentAt)}` : " · no update sent yet"}
              </>
            ) : (
              "One link for the homeowner: progress, photos, documents, the next payment"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void openPicker()} data-client-photos>
                Choose photos
              </button>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => { setFileErr(null); setFile({ name: "", kind: "OTHER", dataUrl: null, fileName: null, bytes: 0, link: "", clientVisible: true }); }} data-file-add>
                + File
              </button>
              <button type="button" className={s.btnPrimary} disabled={busy !== null} onClick={() => setSending({ note: "" })} data-client-send>
                Send the update
              </button>
            </div>
          ) : null}
        </div>

        <div className={s.linkRow} data-client-link>
          {share.href ? (
            <>
              <input readOnly value={share.href} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={s.btnSm} onClick={() => void copyLink()} data-client-copy>
                {copied ? "Copied" : "Copy"}
              </button>
              <a className={s.btnSm} href={share.href} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                Open
              </a>
            </>
          ) : canManage ? (
            <>
              <span className={s.headSub}>No link yet — make it, then send it or copy it.</span>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void copyLink()} data-client-make>
                {busy === "share" ? "Making…" : "Make the link"}
              </button>
            </>
          ) : (
            <span className={s.headSub}>The office has not shared this project yet.</span>
          )}
        </div>

        <div className={s.group} data-project-files>
          <div className={s.groupHead}>
            <span>Files</span>
            <span>· {share.files.length ? `${share.files.length} · ${visible} the client sees` : "the contract, the permit, the plans"}</span>
          </div>
          {share.files.map((f) => (
            <div key={f.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-project-file data-file-visible={f.clientVisible ? "1" : "0"}>
              <span className={s.lineName}>
                <a href={f.href} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
                <span className={s.lineSub} style={{ display: "block" }}>
                  {[f.kindLabel, f.isLink ? "link" : bytesWords(f.bytes), day(f.at)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={s.rowActs}>
                {canManage ? (
                  <button type="button" className={`${s.tag} ${f.clientVisible ? s.tagIn : ""}`} style={{ cursor: "pointer", background: "none" }} disabled={busy !== null} onClick={() => void run(`vis:${f.id}`, () => setProjectFileVisible(f.id, !f.clientVisible))} data-file-toggle>
                    {f.clientVisible ? "client sees it" : "office only"}
                  </button>
                ) : (
                  <span className={`${s.tag} ${f.clientVisible ? s.tagIn : ""}`}>{f.clientVisible ? "client sees it" : "office only"}</span>
                )}
                {canManage ? (
                  <button type="button" className={s.taskX} aria-label={`Remove ${f.name}`} disabled={busy !== null} onClick={() => { if (window.confirm(`Remove "${f.name}" from the project?`)) void run(`del:${f.id}`, () => removeProjectFile(f.id)); }}>
                    ×
                  </button>
                ) : null}
              </span>
            </div>
          ))}
          {!share.files.length ? <div className={s.empty} style={{ marginTop: 8 }}>No files yet. {canManage ? "Upload a photo or a PDF, or paste a link to where it lives. The crew sees every file on the job; the client sees the ones you mark." : ""}</div> : null}
        </div>

        {note ? (
          <div className={s.note} data-client-note style={{ overflowWrap: "anywhere" }}>
            {note}{" "}
            <button type="button" className={s.lineBtn} onClick={() => setNote(null)}>
              ok
            </button>
          </div>
        ) : null}
        {err ? <div className={s.err}>{err}</div> : null}
      </section>

      {/* SEND THE UPDATE — a word of your own, then where it goes. */}
      <BlueprintSheet
        open={sending !== null}
        onClose={() => setSending(null)}
        title="Send the update"
        description={`${share.clientName ?? "The client"} gets where the project stands and the link to their page${share.clientEmail ? ` — by email to ${share.clientEmail}` : " — no email on file"}${share.clientPhone ? (share.textsOn ? `, and by text to ${share.clientPhone} once they have agreed to texts` : ", not by text (texts to clients are off)") : ""}.`}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setSending(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="bps-btn bps-btn--primary"
              disabled={busy !== null || (!share.clientEmail && !share.clientPhone)}
              data-client-send-go
              onClick={() => {
                if (!sending) return;
                const n = sending.note.trim() || null;
                setSending(null);
                void run("send", async () => {
                  const r = await sendClientUpdate(projectId, n);
                  setNote(`${r.words} The page: ${r.href}`);
                });
              }}
            >
              Send
            </button>
          </>
        }
      >
        {sending ? (
          <div className="bps-form">
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">A word from you (optional)</span>
              <textarea className="bps-in" rows={4} value={sending.note} maxLength={600} onChange={(e) => setSending({ note: e.target.value })} placeholder="Tile goes in this week — the kitchen will be dusty Tuesday and Wednesday." autoFocus data-client-note-input />
            </label>
            {!share.clientEmail && !share.clientPhone ? <div className="bps-err bps-fld--wide">The client has no email or phone on file — add one on the client record first.</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* CHOOSE PHOTOS — the project's jobs' photos, ticked for the page. */}
      <BlueprintSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title="Photos for the client"
        description="Tick the ones the homeowner sees on their page — the good ones."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setPicking(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={!picking || picking.loading || busy !== null} onClick={() => void savePicker()} data-client-photos-save>
              {picking ? `Show ${picking.on.size} photo${picking.on.size === 1 ? "" : "s"}` : "Save"}
            </button>
          </>
        }
      >
        {picking ? (
          picking.loading ? (
            <p className="bps-hint">Loading the photos…</p>
          ) : picking.photos.length ? (
            <div className={s.photoGrid} data-client-photo-grid>
              {picking.photos.map((p) => {
                const on = picking.on.has(p.id);
                return (
                  <label key={p.id} className={`${s.photoPick} ${on ? s.isOn : ""}`} title={`${p.jobTitle} · ${day(p.at)}${p.caption ? ` · ${p.caption}` : ""}`} data-client-photo data-on={on ? "1" : "0"}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setPicking((cur) => {
                          if (!cur) return cur;
                          const next = new Set(cur.on);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return { ...cur, on: next };
                        })
                      }
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.href} alt="" loading="lazy" />
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="bps-hint">No photos on this project&apos;s jobs yet — the crew adds them from the job page.</p>
          )
        ) : null}
      </BlueprintSheet>

      {/* ONE FILE — uploaded or linked. */}
      <BlueprintSheet
        open={file !== null}
        onClose={() => setFile(null)}
        title="Add a file"
        description="A photo or a PDF up to 8 MB, or a link to where it lives — Google Drive, the county's permit portal."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setFile(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void saveFile()} data-file-save>
              Add
            </button>
          </>
        }
      >
        {file ? (
          <div className="bps-form">
            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">The file</span>
              <div className={s.chips} style={{ marginTop: 6 }}>
                <button type="button" className="bps-btn bps-btn--ghost" onClick={() => fileRef.current?.click()} data-file-pick>
                  {file.fileName ? `${file.fileName} · ${bytesWords(file.bytes)}` : "Pick a photo or PDF"}
                </button>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickFile(f); }} />
              </div>
            </div>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Or a link</span>
              <input className="bps-in" value={file.link} onChange={(e) => setFile({ ...file, link: e.target.value, ...(e.target.value.trim() ? { dataUrl: null, fileName: null, bytes: 0 } : {}) })} placeholder="https://drive.google.com/…" inputMode="url" data-file-link />
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Name</span>
              <input className="bps-in" value={file.name} maxLength={120} onChange={(e) => setFile({ ...file, name: e.target.value, kind: file.name ? file.kind : guessFileKind(e.target.value) })} placeholder="Signed contract" data-file-name />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Kind</span>
              <select className="bps-in" value={file.kind} onChange={(e) => setFile({ ...file, kind: e.target.value as FileKind })} data-file-kind>
                {FILE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FILE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className={`bps-fld ${s.check}`} style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={file.clientVisible} onChange={(e) => setFile({ ...file, clientVisible: e.target.checked })} data-file-client />
              <span className="bps-lbl" style={{ margin: 0 }}>
                The client sees it
              </span>
            </label>
            <p className="bps-hint bps-fld--wide">The crew sees every file on the job, read-only.</p>
            {fileErr ? <div className="bps-err bps-fld--wide">{fileErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
