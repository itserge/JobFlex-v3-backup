"use client";

// ON SITE (the crew build, 2026-11-05) — the field block on the job page, both doors and both editions:
//   · the problems flagged from site (the office resolves them here);
//   · the project's tasks for the stage the work is on, ticked as they are done;
//   · the deliveries due on the project, marked delivered line by line (what did not come goes back on the list);
//   · the project's punch list (the timeline build, 2026-11-06): ticked done, with an "after" photo when one is
//     taken — the photo goes on the job's gallery too;
//   · the crew member's own hours today, and a button to flag a problem — a note, whether the work stopped.
// Every write goes through /api/crew/<job>/… with the door's token or the session (lib/crewActor), as the days
// and the receipts do. Styled by the crew board's own stylesheet.

import { useRef, useState } from "react";
import { AlertTriangle, Camera, Check } from "lucide-react";
import type { CrewDoor } from "./crew-board-data";
import { ErrorLine, Sheet, useCrewCalls } from "./crew-board";
import type { FieldData, FieldOrder } from "@/lib/crewField/server";
import { hoursWords } from "@/lib/crewField/shared";
import { uploadJobMedia } from "@/lib/media/uploadJobMedia";
import styles from "./crew-board.module.css";

const cx = (...n: Array<string | false | null | undefined>) => n.filter(Boolean).map((x) => styles[x as string] ?? x).join(" ");

export function CrewField({ data, jobId, door, office, canWork }: { data: FieldData; jobId: string; door: CrewDoor; office: boolean; canWork: boolean }) {
  const { call, busy, error, setError } = useCrewCalls(door);
  const [flagOpen, setFlagOpen] = useState(false);
  const [note, setNote] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [hours, setHours] = useState(data.hoursToday != null ? String(data.hoursToday) : "");
  const [delivering, setDelivering] = useState<{ order: FieldOrder; got: Record<string, boolean> } | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // The punch item a photo is being taken for; the file input opens for it.
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const open = data.problems.filter((p) => p.status === "OPEN");
  const stages = data.stages.filter((s) => s.current || s.tasks.some((t) => !t.done)).slice(0, 2);
  const punch = data.punch ?? [];
  const files = data.files ?? [];
  const nothing = !open.length && !stages.length && !data.orders.length && !punch.length && !files.length && !canWork;
  if (nothing) return null;

  const isDone = (id: string, done: boolean) => (id in ticked ? ticked[id] : done);
  const punchLeft = punch.filter((p) => !isDone(p.id, p.done)).length;

  async function punchPhoto(file: File) {
    const itemId = photoFor;
    if (!itemId) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const up = await uploadJobMedia({ jobId, door: door.kind === "token" ? { token: door.token } : { session: true }, file, kind: "AFTER" });
      setTicked((cur) => ({ ...cur, [itemId]: true }));
      await call(`punch:${itemId}`, `/api/crew/${jobId}/punch`, "POST", { itemId, done: true, photoId: up.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The photo did not go up — try again.");
    } finally {
      setPhotoBusy(false);
      setPhotoFor(null);
    }
  }

  return (
    <div className={cx("root")} data-crew-field>
      <section className={cx("card")} aria-label="On site">
        <div className={cx("head")}>
          <div>
            <span className={cx("label")}>On site</span>
            <h2 className={cx("title")}>{data.project ? data.project.name : "Today's work"}</h2>
            {data.weatherToday ? <div className={cx("mono")} data-weather>{data.weatherToday}</div> : null}
          </div>
          {open.length ? <span className={cx("stamp", open.some((p) => p.blocking) ? "stamp-no" : "stamp-wait")}>{open.some((p) => p.blocking) ? "Work stopped" : `${open.length} problem${open.length === 1 ? "" : "s"}`}</span> : null}
        </div>
        <div className={cx("body")}>
          {open.length ? (
            <div className={cx("fieldList")} data-problems>
              {open.map((p) => (
                <div key={p.id} className={cx("problem", p.blocking && "problemStop")} data-problem>
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <b>{p.blocking ? "Work stopped" : "Problem"}</b>
                    <span>{p.note}</span>
                    <span className={cx("mono")}>
                      {p.by ?? "crew"} · {p.when}
                    </span>
                  </div>
                  {office ? (
                    <button
                      type="button"
                      className={cx("btn", "btnSm")}
                      disabled={busy !== null}
                      data-problem-resolve
                      onClick={() => {
                        const resolution = window.prompt("What was done about it?", "");
                        if (resolution == null) return;
                        void call(`resolve:${p.id}`, `/api/crew/${jobId}/flag`, "PATCH", { flagId: p.id, resolution });
                      }}
                    >
                      Resolved
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {stages.map((s) => (
            <div key={s.id} data-field-stage>
              <span className={cx("label")}>
                {s.current ? "This stage · " : "Next · "}
                {s.name}
              </span>
              <div className={cx("fieldList")}>
                {s.tasks.map((t) => {
                  const done = isDone(t.id, t.done);
                  return (
                    <label key={t.id} className={cx("taskRow", done && "taskDone")} data-field-task>
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={!canWork || busy !== null}
                        onChange={(e) => {
                          setTicked((cur) => ({ ...cur, [t.id]: e.target.checked }));
                          void call(`task:${t.id}`, `/api/crew/${jobId}/task`, "POST", { taskId: t.id, done: e.target.checked });
                        }}
                      />
                      <span>{t.title}</span>
                      {t.photoNeeded ? <span className={cx("stamp", "stamp-wait")}>photo</span> : null}
                    </label>
                  );
                })}
                {!s.tasks.length ? <span className={cx("hint")}>No tasks listed for this stage.</span> : null}
              </div>
            </div>
          ))}

          {punch.length ? (
            <div data-field-punch>
              <span className={cx("label")}>Punch list · {punchLeft ? `${punchLeft} left` : "all done"}</span>
              <div className={cx("fieldList")}>
                {punch.map((p) => {
                  const done = isDone(p.id, p.done);
                  return (
                    <div key={p.id} className={cx("taskRow", done && "taskDone")} data-punch-item>
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={!canWork || busy !== null || photoBusy}
                        aria-label={p.note}
                        onChange={(e) => {
                          setTicked((cur) => ({ ...cur, [p.id]: e.target.checked }));
                          void call(`punch:${p.id}`, `/api/crew/${jobId}/punch`, "POST", { itemId: p.id, done: e.target.checked, photoId: null });
                        }}
                      />
                      <span>{p.note}</span>
                      {canWork && !done ? (
                        <button
                          type="button"
                          className={cx("btn", "btnSm")}
                          disabled={busy !== null || photoBusy}
                          data-punch-photo
                          onClick={() => {
                            setPhotoFor(p.id);
                            photoRef.current?.click();
                          }}
                        >
                          <Camera aria-hidden="true" /> {photoBusy && photoFor === p.id ? "Sending…" : "Done + photo"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <input
                ref={photoRef}
                className={cx("file")}
                type="file"
                accept="image/*"
                capture="environment"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void punchPhoto(f);
                  else setPhotoFor(null);
                }}
              />
            </div>
          ) : null}

          {files.length ? (
            <div data-field-files>
              <span className={cx("label")}>Documents</span>
              <div className={cx("fieldList")}>
                {files.map((f) => (
                  <a key={f.id} className={cx("deliveryRow")} href={f.href} target="_blank" rel="noreferrer" data-field-file>
                    <div>
                      <b>{f.name}</b>
                      <span className={cx("mono")}>{f.kindLabel}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {data.orders.length ? (
            <div data-field-deliveries>
              <span className={cx("label")}>Deliveries due</span>
              <div className={cx("fieldList")}>
                {data.orders.map((o) => (
                  <div key={o.id} className={cx("deliveryRow")} data-field-delivery>
                    <div>
                      <b>
                        Order {o.number} · {o.from}
                      </b>
                      <span className={cx("mono")}>
                        {o.lines.length} line{o.lines.length === 1 ? "" : "s"}
                        {o.expected ? ` · expected ${new Date(`${o.expected}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}
                        {o.status === "SHIPPED" ? " · on its way" : ""}
                      </span>
                    </div>
                    {canWork ? (
                      <button type="button" className={cx("btn", "btnPrimary", "btnSm")} disabled={busy !== null} onClick={() => setDelivering({ order: o, got: Object.fromEntries(o.lines.map((l) => [l.id, true])) })} data-field-delivered>
                        Delivered
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {canWork ? (
            <div className={cx("hoursRow")} data-field-hours>
              <label className={cx("field")}>
                <span className={cx("fieldLabel")}>Your hours today</span>
                <input className={cx("input")} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="8" aria-label="Hours today" />
              </label>
              <button
                type="button"
                className={cx("btn", "btnSm")}
                disabled={busy !== null || !hours.trim() || Number(hours) === data.hoursToday}
                data-field-hours-save
                onClick={() => void call("hours", `/api/crew/${jobId}/hours`, "POST", { hours: Number(hours), date: data.today })}
              >
                {busy === "hours" ? "Saving…" : "Save"}
              </button>
              <span className={cx("mono")}>{data.weekHours ? `${hoursWords(data.weekHours)} this week${office ? ", everyone" : ""}` : "Nothing logged this week"}</span>
            </div>
          ) : null}

          {canWork ? (
            <button type="button" className={cx("btn", "btnBlock")} onClick={() => setFlagOpen(true)} data-field-flag>
              <AlertTriangle aria-hidden="true" /> Flag a problem
            </button>
          ) : null}
          <ErrorLine text={error} onClose={() => setError(null)} />
        </div>
      </section>

      <Sheet
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        kicker="Tell the office"
        title="Flag a problem"
        footer={
          <>
            <button type="button" className={cx("btn")} onClick={() => setFlagOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={cx("btn", "btnPrimary")}
              disabled={note.trim().length < 3 || busy === "flag"}
              data-field-flag-send
              onClick={async () => {
                const ok = await call("flag", `/api/crew/${jobId}/flag`, "POST", { note, blocking });
                if (ok) {
                  setFlagOpen(false);
                  setNote("");
                  setBlocking(false);
                }
              }}
            >
              {busy === "flag" ? "Sending…" : "Send to the office"}
            </button>
          </>
        }
      >
        <p className={cx("hint")}>The office gets a text right now and the project shows it until they resolve it. Add photos of it on the day too.</p>
        <label className={cx("field")}>
          <span className={cx("fieldLabel")}>What&apos;s wrong</span>
          <textarea className={cx("input", "area")} rows={4} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="The subfloor under the old tub is rotten — needs replacing before the tile." />
        </label>
        <label className={cx("taskRow")}>
          <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
          <span>I can&apos;t keep working until this is sorted</span>
        </label>
      </Sheet>

      <Sheet
        open={delivering !== null}
        onClose={() => setDelivering(null)}
        kicker={delivering ? `Order ${delivering.order.number} · ${delivering.order.from}` : ""}
        title="What came in"
        footer={
          <>
            <button type="button" className={cx("btn")} onClick={() => setDelivering(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={cx("btn", "btnPrimary")}
              disabled={busy === "delivery"}
              data-field-delivery-save
              onClick={async () => {
                if (!delivering) return;
                const o = delivering.order;
                const lines = o.lines.map((l) => ({ lineId: l.id, receivedQty: delivering.got[l.id] ? Number((l.qty.match(/^[\d.]+/) ?? ["0"])[0]) : 0 }));
                const ok = await call("delivery", `/api/crew/${jobId}/delivery`, "POST", { orderId: o.id, lines });
                if (ok) setDelivering(null);
              }}
            >
              {busy === "delivery" ? "Saving…" : "Mark delivered"}
            </button>
          </>
        }
      >
        <p className={cx("hint")}>Untick anything that did not come or came damaged — it goes back on the list and the office is told.</p>
        {delivering?.order.lines.map((l) => (
          <label key={l.id} className={cx("taskRow", !delivering.got[l.id] && "taskMissing")} data-delivery-line>
            <input type="checkbox" checked={delivering.got[l.id]} onChange={(e) => setDelivering({ ...delivering, got: { ...delivering.got, [l.id]: e.target.checked } })} />
            <span>{l.name}</span>
            <span className={cx("mono")}>{l.qty}</span>
            {delivering.got[l.id] ? <Check aria-hidden="true" /> : <span className={cx("stamp", "stamp-no")}>missing</span>}
          </label>
        ))}
      </Sheet>
    </div>
  );
}
