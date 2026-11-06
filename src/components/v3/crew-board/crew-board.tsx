"use client";

// THE CREW BOARD (stage C, 2026-09-30) — days on site, the photos and videos
// of each day, and the receipts, for a job.
//
// ONE component set for both entrances and both layouts: the dashboard's job
// page (desk and handheld editions) and the worker portal, which now renders
// the same editions. `door` says how requests are authenticated — the session,
// or the portal's token in every body — and every write goes to /api/crew/…,
// which checks the caller against the job the same way for both. After a
// write the page re-reads from the database (router.refresh), so what is on
// screen is always the server's answer, never a guess.
//
//   CrewPendingBanner — days that passed without being closed, on top.
//   CrewDays          — today (Start · Back on site · Close day) and the
//                       gallery, day by day, with who opened / closed each.
//   CrewReceipts      — add, edit, delete; status chips; the office's
//                       approve / reject with a reason / reimbursed.

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, Download, FileText, Pencil, Plus, Receipt, Trash2, X } from "lucide-react";
import { OverlayPortal } from "@/components/v3/blueprint-shell/overlay-layer";
import { lockScroll } from "@/lib/scrollLock";
import { MediaUploadError, uploadJobFile, uploadJobMedia, type UploadDoor } from "@/lib/media/uploadJobMedia";
import { IMAGE_ACCEPT, MEDIA_ACCEPT, fileSize, type MediaKind } from "@/lib/jobMediaShared";
import s from "./crew-board.module.css";
import { RECEIPT_STATUS, money2, type CrewBoardData, type CrewDay, type CrewDoor, type CrewFile, type CrewReceipt } from "./crew-board-data";

const RECEIPT_ACCEPT = `${IMAGE_ACCEPT},application/pdf`;

function cx(...n: Array<string | false | null | undefined>) {
  return n
    .filter(Boolean)
    .map((k) => (s as Record<string, string>)[k as string] ?? k)
    .join(" ");
}

function uploadDoor(door: CrewDoor): UploadDoor {
  return door.kind === "token" ? { token: door.token } : { session: true };
}

/** Requests through either door, with the page re-read after a write. */
export function useCrewCalls(door: CrewDoor) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const call = useCallback(
    async (key: string, url: string, method: string, body: Record<string, unknown> = {}): Promise<boolean> => {
      setBusy(key);
      setError(null);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(door.kind === "token" ? { ...body, token: door.token } : body),
        });
        if (!res.ok) {
          let msg = "That did not go through — try again.";
          try {
            msg = ((await res.json()) as { error?: string }).error ?? msg;
          } catch {
            /* keep */
          }
          setError(msg);
          return false;
        }
        refresh();
        return true;
      } catch {
        setError("The connection dropped — check the signal and try again.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [door, refresh],
  );
  return { busy, error, setError, call, refresh };
}

/** An error line, in words, dismissible. */
export function ErrorLine({ text, onClose }: { text: string | null; onClose: () => void }) {
  if (!text) return null;
  return (
    <div className={cx("err")} role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

// ── the sheet ──────────────────────────────────────────────────────────────

export function Sheet({ open, title, kicker, onClose, children, footer }: { open: boolean; title: string; kicker?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The latest onClose, read at the moment of use. It is NOT an effect
  // dependency: callers pass a new function on every render, and with it in the
  // deps every keystroke in the sheet re-ran the open effect — scroll unlocked
  // and relocked, focus handed back and taken again. On an iPhone that closed
  // the keyboard after each letter and opened the photo picker (the hidden
  // file input was the first "input" the refocus found). 2026-10-01.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    const prev = document.activeElement as HTMLElement | null;
    // Once, on open: the first TEXT field — never a file input (focusing one
    // opens the photo picker on iOS), never a radio.
    const t = window.setTimeout(
      () => panelRef.current?.querySelector<HTMLElement>('textarea, input:not([type="file"]):not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')?.focus(),
      30,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      unlock();
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <OverlayPortal>
      <div className={cx("layer")}>
        <div className={cx("scrim")} onClick={onClose} aria-hidden="true" />
        <div className={cx("sheet")} role="dialog" aria-modal="true" aria-labelledby={labelId} ref={panelRef}>
          <div className={cx("sheetHead")}>
            <div>
              {kicker && <div className={cx("label")}>{kicker}</div>}
              <h2 id={labelId} className={cx("sheetTitle")}>
                {title}
              </h2>
            </div>
            <button type="button" className={cx("iconBtn")} onClick={onClose} aria-label="Close">
              <X aria-hidden="true" />
            </button>
          </div>
          <div className={cx("sheetBody")}>{children}</div>
          {footer && <div className={cx("sheetFoot")}>{footer}</div>}
        </div>
      </div>
    </OverlayPortal>
  );
}

// ── uploads with progress ──────────────────────────────────────────────────

type QueueItem = { key: string; name: string; size: number; pct: number; state: "up" | "done" | "failed"; error?: string };

function useUploads(jobId: string, door: CrewDoor) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const patch = (key: string, next: Partial<QueueItem>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...next } : x)));
  const run = useCallback(
    async (files: FileList | File[], kind: MediaKind, date: string | null): Promise<number> => {
      let ok = 0;
      const list = Array.from(files);
      const keys = list.map((f, i) => `${Date.now()}-${i}-${f.name}`);
      setQueue((q) => [...q.filter((x) => x.state !== "done"), ...list.map((f, i) => ({ key: keys[i], name: f.name, size: f.size, pct: 0, state: "up" as const }))]);
      for (let i = 0; i < list.length; i++) {
        try {
          await uploadJobMedia({ jobId, door: uploadDoor(door), file: list[i], kind, date, onProgress: (pct) => patch(keys[i], { pct }) });
          patch(keys[i], { pct: 100, state: "done" });
          ok++;
        } catch (err) {
          patch(keys[i], { state: "failed", error: err instanceof MediaUploadError || err instanceof Error ? err.message : "The upload failed." });
        }
      }
      return ok;
    },
    [door, jobId],
  );
  return { queue, run, clear: () => setQueue([]) };
}

function UploadList({ queue }: { queue: QueueItem[] }) {
  if (!queue.length) return null;
  return (
    <ul className={cx("uploads")} aria-live="polite">
      {queue.map((q) => (
        <li key={q.key} data-state={q.state}>
          <div className={cx("upRow")}>
            <span className={cx("upName")}>{q.name}</span>
            <span className={cx("mono")}>{q.state === "done" ? "Uploaded" : q.state === "failed" ? "Failed" : `${q.pct}%`}</span>
          </div>
          {q.state === "up" && (
            <div className={cx("bar")} role="progressbar" aria-valuenow={q.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${q.name}`}>
              <i style={{ width: `${q.pct}%` }} />
            </div>
          )}
          {q.error && <div className={cx("upErr")}>{q.error}</div>}
          <div className={cx("mono", "upSize")}>{fileSize(q.size)}</div>
        </li>
      ))}
    </ul>
  );
}

// ── one file ───────────────────────────────────────────────────────────────

function FileTile({ f, door, onError }: { f: CrewFile; door: CrewDoor; onError: (m: string) => void }) {
  const { call, busy } = useCrewCalls(door);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(f.caption ?? "");
  // A video the browser cannot play is offered as a file instead of a black
  // player. Decided by TRYING it, not by canPlayType: Chrome answers "" for
  // "video/quicktime" yet plays an iPhone's HEVC .mov (checked against the real
  // store, 2026-10-01). Unplayable = an error, or metadata with no picture
  // (the sound track alone decodes).
  const [playable, setPlayable] = useState(true);
  const del = async () => {
    if (!window.confirm(`Delete this ${f.media}? It is removed from the job and from storage.`)) return;
    const ok = await call("del", `/api/crew/media/${f.id}`, "DELETE");
    if (!ok) onError("Could not delete that file.");
  };
  const save = async () => {
    const ok = await call("cap", `/api/crew/media/${f.id}`, "PATCH", { caption });
    if (ok) setEditing(false);
  };
  return (
    <figure className={cx("tile")} data-file={f.id} data-media={f.media}>
      <div className={cx("media")}>
        {f.media === "video" ? (
          playable ? (
            <video
              src={f.href}
              preload="metadata"
              controls
              playsInline
              onError={() => setPlayable(false)}
              onLoadedMetadata={(e) => {
                if (e.currentTarget.videoWidth === 0) setPlayable(false);
              }}
            />
          ) : (
            <a className={cx("noPlay")} href={f.downloadHref} data-download>
              <Download aria-hidden="true" />
              <span>This video does not play in this browser</span>
              <b>Download</b>
            </a>
          )
        ) : (
          // Signed private links and older data URLs: a plain img.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.href} alt={f.caption ?? `${f.kind} photo`} loading="lazy" />
        )}
        <span className={cx("kind")}>{f.media === "video" ? `Video · ${f.kind}` : f.kind}</span>
      </div>
      <figcaption className={cx("cap")}>
        {editing ? (
          <div className={cx("capEdit")}>
            <input className={cx("input")} value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} aria-label="Caption" placeholder="What does it show?" />
            <button type="button" className={cx("btn", "btnPrimary", "btnSm")} disabled={busy === "cap"} onClick={() => void save()}>
              Save
            </button>
            <button type="button" className={cx("btn", "btnSm")} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            {f.caption && <div className={cx("capText")}>{f.caption}</div>}
            <div className={cx("meta")}>
              {f.by ?? "Unknown"} · {f.at}
              {f.size ? ` · ${f.size}` : ""}
              {f.edited && <span className={cx("edited")}> · {f.edited}</span>}
            </div>
            {(f.canEdit || f.canDelete) && (
              <div className={cx("tileActs")}>
                {f.canEdit && (
                  <button type="button" className={cx("textBtn")} onClick={() => setEditing(true)}>
                    <Pencil aria-hidden="true" /> {f.caption ? "Edit caption" : "Add caption"}
                  </button>
                )}
                {f.canDelete && (
                  <button type="button" className={cx("textBtn", "danger")} disabled={busy === "del"} onClick={() => void del()}>
                    <Trash2 aria-hidden="true" /> Delete
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </figcaption>
    </figure>
  );
}

// ── close a day ────────────────────────────────────────────────────────────

function CloseDaySheet({ data, door, day, open, onClose }: { data: CrewBoardData; door: CrewDoor; day: CrewDay | null; open: boolean; onClose: () => void }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const up = useUploads(data.jobId, door);
  const [note, setNote] = useState(day?.note ?? "");
  // The hours the crew member put in that day (the crew build, 2026-11-05) — saved with the close, Labor on the job.
  const [hours, setHours] = useState("");
  const [added, setAdded] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const existing = day?.files.length ?? 0;
  const late = !!day && day.date !== data.today;
  const canClose = note.trim().length > 0 || existing + added > 0;
  const uploading = up.queue.some((q) => q.state === "up");
  const close = useCallback(() => {
    up.clear();
    setAdded(0);
    setError(null);
    onClose();
  }, [onClose, setError, up]);
  if (!day) return null;
  return (
    <Sheet
      open={open}
      onClose={close}
      kicker={late ? `Needs closing · ${day.label}` : `Today · ${day.label}`}
      title={`Close day ${day.dayNumber}`}
      footer={
        <>
          <button type="button" className={cx("btn")} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={cx("btn", "btnPrimary")}
            disabled={!canClose || uploading || busy === "close"}
            data-close-day
            onClick={async () => {
              if (!canClose) {
                setError("Write a note or add at least one photo or video of the day before closing it.");
                return;
              }
              // The hours first, so a close that fails leaves them typed; the office's close types nobody's hours.
              if (!data.office && Number(hours) > 0) {
                const saved = await call("close", `/api/crew/${data.jobId}/hours`, "POST", { hours: Number(hours), date: day.date });
                if (!saved) return;
              }
              const ok = await call("close", `/api/crew/${data.jobId}/day`, "POST", { action: "close", note, date: day.date });
              if (ok) close();
            }}
          >
            {busy === "close" ? "Closing…" : "Close day"}
          </button>
        </>
      }
    >
      <p className={cx("hint")}>A note, or at least one photo or video of the day — one of the two is needed. The day closes for the whole crew.</p>
      {!data.office && (
        <label className={cx("field")}>
          <span className={cx("fieldLabel")}>Your hours today</span>
          <input className={cx("input")} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="8" data-close-hours />
        </label>
      )}
      <label className={cx("field")}>
        <span className={cx("fieldLabel")}>What got done</span>
        <textarea className={cx("input", "area")} rows={4} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Posts set on the north run, concrete cured, gate hardware tomorrow." />
      </label>
      <div className={cx("field")}>
        <span className={cx("fieldLabel")}>Photos and videos of the day</span>
        <div className={cx("mono")}>{existing + added ? `${existing + added} on this day` : "None yet"}</div>
        <input
          ref={inputRef}
          className={cx("file")}
          type="file"
          multiple
          accept={data.storage === "inline" ? IMAGE_ACCEPT : MEDIA_ACCEPT}
          onChange={async (e) => {
            // Copied out BEFORE the input is cleared: clearing it empties the live FileList.
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!files?.length) return;
            const n = await up.run(files, "PROGRESS", day.date);
            setAdded((a) => a + n);
          }}
        />
        <button type="button" className={cx("btn", "btnBlock")} disabled={uploading} onClick={() => inputRef.current?.click()}>
          <Camera aria-hidden="true" /> {uploading ? "Uploading…" : "Add photos or videos"}
        </button>
        <UploadList queue={up.queue} />
      </div>
      <ErrorLine text={error} onClose={() => setError(null)} />
    </Sheet>
  );
}

// ── pending days, on top ───────────────────────────────────────────────────

export function CrewPendingBanner({ data, door }: { data: CrewBoardData; door: CrewDoor }) {
  const [closing, setClosing] = useState<CrewDay | null>(null);
  if (!data.pending.length) return null;
  const n = data.pending.length;
  return (
    <section className={cx("root", "pending")} aria-label="Days that need closing" data-pending-days={n}>
      <div className={cx("pendHead")}>
        <AlertTriangle aria-hidden="true" />
        <div>
          <div className={cx("pendTitle")}>{n === 1 ? "1 day needs closing" : `${n} days need closing`}</div>
          <div className={cx("pendSub")}>The day passed without a note or photos. Close it now — it keeps its own date.</div>
        </div>
      </div>
      <ul className={cx("pendList")}>
        {data.pending.map((d) => (
          <li key={d.id}>
            <div>
              <b>
                Day {d.dayNumber} · {d.label}
              </b>
              <span className={cx("mono")}>
                opened by {d.openedBy ?? "—"}
                {d.byOffice ? " (office)" : ""}
                {d.files.length ? ` · ${d.files.length} file${d.files.length === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            {data.canWork && (
              <button type="button" className={cx("btn", "btnPrimary", "btnSm")} onClick={() => setClosing(d)} data-close-pending={d.date}>
                Close day
              </button>
            )}
          </li>
        ))}
      </ul>
      <CloseDaySheet data={data} door={door} day={closing} open={!!closing} onClose={() => setClosing(null)} />
    </section>
  );
}

// ── today and the gallery ──────────────────────────────────────────────────

function DayStamp({ status }: { status: CrewDay["status"] }) {
  const t = status === "CLOSED" ? { l: "Closed", tone: "ok" } : status === "PENDING" ? { l: "Needs closing", tone: "wait" } : { l: "On site", tone: "open" };
  return <span className={cx("stamp", `stamp-${t.tone}`)}>{t.l}</span>;
}

/** Where today stands, in one line — the day card and the crew's actions say the same. */
function todayLine(data: CrewBoardData): string {
  const t = data.todayDay;
  const doneDays = data.days.length;
  if (data.jobStatus === "CANCELED") return "This job is canceled.";
  if (t && t.status === "OPEN") return `Day ${t.dayNumber} on site · opened by ${t.openedBy ?? "—"}${t.byOffice ? " (office)" : ""}`;
  if (t && t.status === "CLOSED") return `Day ${t.dayNumber} closed by ${t.closedBy ?? "—"}${t.closedAt ? ` at ${t.closedAt}` : ""}`;
  if (data.jobStatus === "COMPLETED") return doneDays ? `Job completed after ${doneDays} ${doneDays === 1 ? "day" : "days"} on site` : "Job completed";
  if (data.jobStatus === "IN_PROGRESS") return `Not on site today · ${doneDays} ${doneDays === 1 ? "day" : "days"} so far`;
  return "Not started yet";
}

// ── the crew's own actions, first thing on the page ────────────────────────

/**
 * THE CREW'S DAY, AS BUTTONS (2026-10-01, owner after the iPhone check): a
 * worker does not "set up a status" — they start, come back, close the day,
 * complete. Big, full-width, one under another, only the ones that apply now:
 *   Start work       — a scheduled job, nothing opened today
 *   Back on site     — a job in progress, nobody on site yet today
 *   Close day        — today is open (note or files, the same sheet)
 *   Mark completed   — a job in progress (it asks first)
 * The office's four-state picker stays the owner's and the manager's.
 */
export function CrewActions({ data, door }: { data: CrewBoardData; door: CrewDoor }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const [closeOpen, setCloseOpen] = useState(false);
  if (!data.canWork) return null;
  const t = data.todayDay;
  const next = data.days.length + 1;
  const canStart = !t && data.jobStatus === "SCHEDULED";
  const canBack = !t && data.jobStatus === "IN_PROGRESS";
  const openToday = !!t && t.status === "OPEN";
  const canComplete = data.jobStatus === "IN_PROGRESS";
  const any = canStart || canBack || openToday || canComplete;
  return (
    <div className={cx("root")}>
    <section className={cx("card", "crewActs")} aria-label="Your day on this job" data-crew-actions>
      <div className={cx("crewActsHead")}>
        <span className={cx("label")}>Your day</span>
        <p className={cx("line")} data-crew-line>
          {todayLine(data)}
        </p>
      </div>
      {any && (
        <div className={cx("bigActs")}>
          {canStart && (
            <button type="button" className={cx("btn", "btnPrimary", "bigBtn")} disabled={busy === "start"} onClick={() => void call("start", `/api/crew/${data.jobId}/day`, "POST", { action: "start" })} data-crew-act="start">
              {busy === "start" ? "Starting…" : "Start work"}
            </button>
          )}
          {canBack && (
            <button type="button" className={cx("btn", "btnPrimary", "bigBtn")} disabled={busy === "continue"} onClick={() => void call("continue", `/api/crew/${data.jobId}/day`, "POST", { action: "continue" })} data-crew-act="continue">
              {busy === "continue" ? "Marking…" : `Back on site · day ${next}`}
            </button>
          )}
          {openToday && (
            <button type="button" className={cx("btn", "btnPrimary", "bigBtn")} onClick={() => setCloseOpen(true)} data-crew-act="close">
              Close day {t!.dayNumber}
            </button>
          )}
          {canComplete && (
            <button
              type="button"
              className={cx("btn", "bigBtn")}
              disabled={busy === "complete"}
              data-crew-act="complete"
              onClick={() => {
                if (window.confirm("Mark the whole job completed? The office is told.")) void call("complete", `/api/crew/${data.jobId}/day`, "POST", { action: "complete" });
              }}
            >
              <Check aria-hidden="true" /> {busy === "complete" ? "Completing…" : "Mark completed"}
            </button>
          )}
        </div>
      )}
      <ErrorLine text={error} onClose={() => setError(null)} />
      <CloseDaySheet data={data} door={door} day={openToday ? t : null} open={closeOpen} onClose={() => setCloseOpen(false)} />
    </section>
    </div>
  );
}

export function CrewDays({ data, door }: { data: CrewBoardData; door: CrewDoor }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const up = useUploads(data.jobId, door);
  const [closeOpen, setCloseOpen] = useState(false);
  const [kind, setKind] = useState<MediaKind>("PROGRESS");
  const pickRef = useRef<HTMLInputElement>(null);
  const t = data.todayDay;
  const uploading = up.queue.some((q) => q.state === "up");
  const accept = data.storage === "inline" ? IMAGE_ACCEPT : MEDIA_ACCEPT;
  const doneDays = data.days.length;
  const line = todayLine(data);

  const canStart = data.canWork && !t && data.jobStatus === "SCHEDULED";
  const canBack = data.canWork && !t && data.jobStatus === "IN_PROGRESS";
  const openToday = data.canWork && !!t && t.status === "OPEN";

  return (
    <div className={cx("root")} data-crew-days>
      <section className={cx("card")} data-today>
        <div className={cx("head")}>
          <div>
            <div className={cx("label")}>Today · {new Date(`${data.today}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}</div>
            <h2 className={cx("title")}>Day on site</h2>
          </div>
          {t && <DayStamp status={t.status} />}
        </div>
        <div className={cx("body")}>
          <p className={cx("line")} data-today-line>
            {line}
          </p>
          {t?.weather && <div className={cx("mono")} data-today-weather>{t.weather}</div>}
          {t?.note && <p className={cx("note")}>{t.note}</p>}
          {(canStart || canBack || openToday) && (
            <div className={cx("acts")}>
              {canStart && (
                <button type="button" className={cx("btn", "btnPrimary")} disabled={busy === "start"} onClick={() => void call("start", `/api/crew/${data.jobId}/day`, "POST", { action: "start" })} data-day="start">
                  {busy === "start" ? "Starting…" : "Start work"}
                </button>
              )}
              {canBack && (
                <button type="button" className={cx("btn", "btnPrimary")} disabled={busy === "continue"} onClick={() => void call("continue", `/api/crew/${data.jobId}/day`, "POST", { action: "continue" })} data-day="continue">
                  {busy === "continue" ? "Marking…" : `Back on site · day ${doneDays + 1}`}
                </button>
              )}
              {openToday && (
                <>
                  <button type="button" className={cx("btn")} disabled={uploading} onClick={() => pickRef.current?.click()} data-day="add">
                    <Camera aria-hidden="true" /> {uploading ? "Uploading…" : "Add photos or videos"}
                  </button>
                  <button type="button" className={cx("btn", "btnPrimary")} onClick={() => setCloseOpen(true)} data-day="close">
                    Close day
                  </button>
                </>
              )}
            </div>
          )}
          {openToday && (
            <div className={cx("kinds")} role="group" aria-label="What the photos show">
              {(["BEFORE", "PROGRESS", "AFTER"] as MediaKind[]).map((k) => (
                <button key={k} type="button" className={cx("seg", kind === k && "segOn")} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </button>
              ))}
              <span className={cx("mono")}>Up to {fileSize(data.maxBytes)} a file</span>
            </div>
          )}
          <input
            ref={pickRef}
            className={cx("file")}
            type="file"
            multiple
            accept={accept}
            onChange={async (e) => {
              // Copied out BEFORE the input is cleared: clearing it empties the live FileList.
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files?.length) await up.run(files, kind, null);
              if (files?.length) setError(null);
            }}
          />
          <UploadList queue={up.queue} />
          {data.storage === "inline" && data.canWork && <p className={cx("hint")}>File storage is not switched on yet: photos go through, videos wait for it.</p>}
          <ErrorLine text={error} onClose={() => setError(null)} />
        </div>
      </section>

      <section className={cx("card")} data-gallery>
        <div className={cx("head")}>
          <div>
            <div className={cx("label")}>Photos & videos</div>
            <h2 className={cx("title")}>Day by day</h2>
          </div>
          <span className={cx("mono")}>{((n) => `${n} ${n === 1 ? "file" : "files"}`)(data.days.reduce((a, d) => a + d.files.length, 0) + data.looseFiles.length)}</span>
        </div>
        {data.days.length === 0 && data.looseFiles.length === 0 ? (
          <div className={cx("empty")}>No days on site yet. Start work to open day 1.</div>
        ) : (
          <div className={cx("days")}>
            {data.days.map((d) => (
              <article key={d.id} className={cx("day")} data-day-date={d.date} data-day-status={d.status}>
                <header className={cx("dayHead")}>
                  <div>
                    <div className={cx("dayTitle")}>
                      Day {d.dayNumber} · {d.label}
                    </div>
                    <div className={cx("mono")}>
                      opened by {d.openedBy ?? "—"}
                      {d.byOffice ? " (office)" : ""}
                      {d.status === "CLOSED" ? ` · closed by ${d.closedBy ?? "—"}${d.closedAt ? ` at ${d.closedAt}` : ""}` : ""}
                    </div>
                  </div>
                  <DayStamp status={d.status} />
                </header>
                {d.note && <p className={cx("note")}>{d.note}</p>}
                {d.files.length ? (
                  <div className={cx("grid")}>
                    {d.files.map((f) => (
                      <FileTile key={f.id} f={f} door={door} onError={setError} />
                    ))}
                  </div>
                ) : (
                  <div className={cx("mono", "dayEmpty")}>No photos or videos on this day.</div>
                )}
              </article>
            ))}
            {data.looseFiles.length > 0 && (
              <article className={cx("day")} data-day-date="loose">
                <header className={cx("dayHead")}>
                  <div>
                    <div className={cx("dayTitle")}>Not tied to a day</div>
                    <div className={cx("mono")}>added before days were kept, or outside a day on site</div>
                  </div>
                </header>
                <div className={cx("grid")}>
                  {data.looseFiles.map((f) => (
                    <FileTile key={f.id} f={f} door={door} onError={setError} />
                  ))}
                </div>
              </article>
            )}
          </div>
        )}
      </section>
      <CloseDaySheet data={data} door={door} day={t} open={closeOpen} onClose={() => setCloseOpen(false)} />
    </div>
  );
}

// ── receipts ───────────────────────────────────────────────────────────────

type ReceiptForm = { amount: string; vendor: string; spentAt: string; category: string; paidBy: "WORKER" | "COMPANY"; note: string };

function ReceiptSheet({ data, door, open, onClose, editing }: { data: CrewBoardData; door: CrewDoor; open: boolean; onClose: () => void; editing: CrewReceipt | null }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const blank: ReceiptForm = { amount: "", vendor: "", spentAt: data.today, category: data.categories[0], paidBy: data.office ? "COMPANY" : "WORKER", note: "" };
  // Mounted fresh for every opening (keyed by the caller), so the form starts
  // from the receipt being edited, or blank.
  const [form, setForm] = useState<ReceiptForm>(() =>
    editing
      ? { amount: String(editing.amount), vendor: editing.vendor ?? "", spentAt: editing.spentISO, category: editing.category, paidBy: editing.paidBy, note: editing.note ?? "" }
      : blank,
  );
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ReceiptForm>(k: K, v: ReceiptForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setError("Enter the amount on the receipt.");
      return;
    }
    let url: string | undefined;
    if (file) {
      try {
        setPct(1);
        const up = await uploadJobFile({ jobId: data.jobId, door: uploadDoor(door), file, folder: "receipts", onProgress: setPct });
        url = up.url;
      } catch (err) {
        setPct(null);
        setError(err instanceof Error ? err.message : "The upload failed.");
        return;
      }
    }
    const payload = { amount, vendor: form.vendor.trim() || null, spentAt: form.spentAt, category: form.category, paidBy: form.paidBy, note: form.note.trim() || null, ...(url ? { url } : {}) };
    const ok = editing ? await call("save", `/api/crew/receipts/${editing.id}`, "PATCH", payload) : await call("save", `/api/crew/${data.jobId}/receipts`, "POST", { ...payload, url: url ?? null });
    setPct(null);
    if (ok) onClose();
  };
  const busyNow = busy === "save" || pct !== null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      kicker={editing ? "Edit receipt" : data.office ? "Add an expense" : "Send a receipt"}
      title={editing ? `${money2(editing.amount)}${editing.vendor ? ` · ${editing.vendor}` : ""}` : "Receipt"}
      footer={
        <>
          <button type="button" className={cx("btn")} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx("btn", "btnPrimary")} disabled={busyNow} onClick={() => void save()} data-receipt-save>
            {pct !== null ? `Uploading ${pct}%` : busy === "save" ? "Saving…" : editing ? "Save" : data.office ? "Add expense" : "Send receipt"}
          </button>
        </>
      }
    >
      {!data.office && !editing && <p className={cx("hint")}>It counts once the owner or a manager approves it.</p>}
      {editing?.status === "REJECTED" && <p className={cx("hint")}>Saving sends it back for review.</p>}
      <div className={cx("field")}>
        <span className={cx("fieldLabel")}>Photo of the receipt</span>
        <input ref={inputRef} className={cx("file")} type="file" accept={data.storage === "inline" ? IMAGE_ACCEPT : RECEIPT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" className={cx("btn", "btnBlock")} onClick={() => inputRef.current?.click()}>
          <Camera aria-hidden="true" /> {file ? file.name : editing?.file ? "Replace the picture" : "Take or choose a photo"}
        </button>
        {file && <div className={cx("mono")}>{fileSize(file.size)}</div>}
        {pct !== null && (
          <div className={cx("bar")} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading the receipt">
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className={cx("two")}>
        <label className={cx("field")}>
          <span className={cx("fieldLabel")}>Amount</span>
          <input className={cx("input")} inputMode="decimal" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" required />
        </label>
        <label className={cx("field")}>
          <span className={cx("fieldLabel")}>Date</span>
          <input className={cx("input")} type="date" value={form.spentAt} max={data.today} onChange={(e) => set("spentAt", e.target.value)} />
        </label>
      </div>
      <label className={cx("field")}>
        <span className={cx("fieldLabel")}>Store or supplier</span>
        <input className={cx("input")} value={form.vendor} maxLength={120} onChange={(e) => set("vendor", e.target.value)} placeholder="Home Depot" />
      </label>
      <label className={cx("field")}>
        <span className={cx("fieldLabel")}>Category</span>
        <select className={cx("input")} value={form.category} onChange={(e) => set("category", e.target.value)}>
          {data.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <fieldset className={cx("field", "radios")}>
        <legend className={cx("fieldLabel")}>Who paid</legend>
        <label className={cx("radio", form.paidBy === "WORKER" && "radioOn")}>
          <input type="radio" name="paidBy" checked={form.paidBy === "WORKER"} onChange={() => set("paidBy", "WORKER")} />
          {data.office ? "The worker (to reimburse)" : "I paid"}
        </label>
        <label className={cx("radio", form.paidBy === "COMPANY" && "radioOn")}>
          <input type="radio" name="paidBy" checked={form.paidBy === "COMPANY"} onChange={() => set("paidBy", "COMPANY")} />
          Company card
        </label>
      </fieldset>
      <label className={cx("field")}>
        <span className={cx("fieldLabel")}>Note</span>
        <input className={cx("input")} value={form.note} maxLength={2000} onChange={(e) => set("note", e.target.value)} placeholder="Post mix, 6 bags" />
      </label>
      <ErrorLine text={error} onClose={() => setError(null)} />
    </Sheet>
  );
}

function RejectSheet({ receipt, door, onClose }: { receipt: CrewReceipt | null; door: CrewDoor; onClose: () => void }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const [reason, setReason] = useState("");
  if (!receipt) return null;
  return (
    <Sheet
      open={!!receipt}
      onClose={onClose}
      kicker="Reject receipt"
      title={`${money2(receipt.amount)}${receipt.vendor ? ` · ${receipt.vendor}` : ""}`}
      footer={
        <>
          <button type="button" className={cx("btn")} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={cx("btn", "btnDanger")}
            disabled={!reason.trim() || busy === "reject"}
            data-reject-confirm
            onClick={async () => {
              if (await call("reject", `/api/crew/receipts/${receipt.id}/review`, "POST", { decision: "reject", reason })) onClose();
            }}
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </>
      }
    >
      <label className={cx("field")}>
        <span className={cx("fieldLabel")}>Why — {receipt.by ?? "the worker"} reads this</span>
        <textarea className={cx("input", "area")} rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Company tools come from the shop — not a job expense." />
      </label>
      <ErrorLine text={error} onClose={() => setError(null)} />
    </Sheet>
  );
}

function ReceiptRow({ r, door, onEdit, onReject }: { r: CrewReceipt; door: CrewDoor; onEdit: (r: CrewReceipt) => void; onReject: (r: CrewReceipt) => void }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const st = RECEIPT_STATUS[r.status];
  return (
    <li className={cx("rc")} data-receipt={r.id} data-status={r.status}>
      <div className={cx("rcThumb")}>
        {r.file ? (
          r.file.pdf ? (
            <a href={r.file.href} target="_blank" rel="noopener noreferrer" aria-label="Open the receipt PDF">
              <FileText aria-hidden="true" />
            </a>
          ) : (
            <a href={r.file.href} target="_blank" rel="noopener noreferrer" aria-label="Open the receipt picture">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.file.href} alt="" loading="lazy" />
            </a>
          )
        ) : (
          <Receipt aria-hidden="true" />
        )}
      </div>
      <div className={cx("rcMain")}>
        <div className={cx("rcTop")}>
          <span className={cx("rcName")}>{r.vendor || r.category}</span>
          <span className={cx("rcAmt")}>{money2(r.amount)}</span>
        </div>
        <div className={cx("meta")}>
          {r.category} · {r.spent} · {r.paidBy === "WORKER" ? `paid by ${r.mine ? "you" : r.by ?? "the worker"}` : "company card"}
          {r.by && !r.mine ? ` · sent by ${r.by}` : ""}
          {r.edited && <span className={cx("edited")}> · {r.edited}</span>}
        </div>
        {r.note && <div className={cx("rcNote")}>{r.note}</div>}
        {r.status === "REJECTED" && r.rejectReason && (
          <div className={cx("reason")} data-reject-reason>
            Rejected: {r.rejectReason}
          </div>
        )}
        <div className={cx("rcActs")}>
          <span className={cx("stamp", `stamp-${st.tone}`)}>{st.label}</span>
          {r.canReview && (r.status === "SUBMITTED" || r.status === "REJECTED") && (
            <button type="button" className={cx("btn", "btnPrimary", "btnSm")} disabled={busy === "approve"} onClick={() => void call("approve", `/api/crew/receipts/${r.id}/review`, "POST", { decision: "approve" })} data-approve>
              <Check aria-hidden="true" /> Approve
            </button>
          )}
          {r.canReview && (r.status === "SUBMITTED" || r.status === "APPROVED") && (
            <button type="button" className={cx("btn", "btnSm")} onClick={() => onReject(r)} data-reject>
              Reject
            </button>
          )}
          {r.canReview && r.status === "APPROVED" && r.paidBy === "WORKER" && (
            <button type="button" className={cx("btn", "btnSm")} disabled={busy === "reimburse"} onClick={() => void call("reimburse", `/api/crew/receipts/${r.id}/review`, "POST", { decision: "reimburse" })} data-reimburse>
              Mark reimbursed
            </button>
          )}
          {r.canEdit && (
            <button type="button" className={cx("textBtn")} onClick={() => onEdit(r)} data-edit-receipt>
              <Pencil aria-hidden="true" /> Edit
            </button>
          )}
          {r.canDelete && (
            <button
              type="button"
              className={cx("textBtn", "danger")}
              disabled={busy === "del"}
              data-delete-receipt
              onClick={async () => {
                if (window.confirm("Delete this receipt? Its picture is removed too.")) await call("del", `/api/crew/receipts/${r.id}`, "DELETE");
              }}
            >
              <Trash2 aria-hidden="true" /> Delete
            </button>
          )}
        </div>
        <ErrorLine text={error} onClose={() => setError(null)} />
      </div>
    </li>
  );
}

export function CrewReceipts({ data, door }: { data: CrewBoardData; door: CrewDoor }) {
  const [sheet, setSheet] = useState<{ editing: CrewReceipt | null } | null>(null);
  const [rejecting, setRejecting] = useState<CrewReceipt | null>(null);
  const onReview = data.receipts.filter((r) => r.status === "SUBMITTED");
  return (
    <div className={cx("root")} data-crew-receipts>
      <section className={cx("card")}>
        <div className={cx("head")}>
          <div>
            <div className={cx("label")}>Receipts</div>
            <h2 className={cx("title")}>Money spent on the job</h2>
          </div>
          {data.canWork && (
            <button type="button" className={cx("btn", "btnPrimary")} onClick={() => setSheet({ editing: null })} data-add-receipt>
              <Plus aria-hidden="true" /> {data.office ? "Add expense" : "Send receipt"}
            </button>
          )}
        </div>
        <div className={cx("totals")}>
          <div>
            <span className={cx("label")}>Counted</span>
            <b data-total-counted>{money2(data.totals.counted)}</b>
          </div>
          <div>
            <span className={cx("label")}>On review</span>
            <b data-total-pending>{money2(data.totals.pending)}</b>
          </div>
          <div>
            <span className={cx("label")}>Owed to crew</span>
            <b data-total-owed>{money2(data.totals.owedToWorkers)}</b>
          </div>
        </div>
        {data.receipts.length === 0 ? (
          <div className={cx("empty")}>No receipts on this job yet.</div>
        ) : (
          <ul className={cx("rcList")}>
            {[...onReview, ...data.receipts.filter((r) => r.status !== "SUBMITTED")].map((r) => (
              <ReceiptRow key={r.id} r={r} door={door} onEdit={(x) => setSheet({ editing: x })} onReject={setRejecting} />
            ))}
          </ul>
        )}
      </section>
      {sheet && <ReceiptSheet key={sheet.editing?.id ?? "new"} data={data} door={door} open editing={sheet.editing ?? null} onClose={() => setSheet(null)} />}
      <RejectSheet key={rejecting?.id ?? "none"} receipt={rejecting} door={door} onClose={() => setRejecting(null)} />
    </div>
  );
}
