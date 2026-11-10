"use client";

// THE CRM DESK BAND (Smart CRM part 4, 2026-11-10) — the top of the Today tab, on the desk and on the phone:
//
//   FOLLOW-UPS WAITING FOR YOU   the messages the follow-up agent prepared and did not send, because the rule says
//                                "ask me first" — read it, change it, send it or skip it. And the plain reminders
//                                ("just remind me"): have it written, or say you followed up yourself.
//   PROMISES                     what was said to clients ("I'll send the revised quote Friday"), caught from the
//                                messages people write, and whether it happened: overdue, due today, open, waiting on
//                                the client, kept.
//
// The band owns its own data: the desktop page seeds it, the phone lets it read through `getCrmDesk`, and after
// every action it reads again — what shows is what the database says. Mobile-first CSS in ./crm-agent.module.css,
// Blueprint tokens with fallbacks (the same pattern as ./crm-brief).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getCrmDesk } from "@/actions/crmDesk";
import { markFollowUpDone, runFollowUpNow, saveFollowUpDraft, skipFollowUp, writeFollowUpDraft } from "@/actions/followUps";
import { movePromiseDay, settlePromise } from "@/actions/clients360";
import { HREF, money } from "@/lib/crm/brief";
import type { CrmDesk } from "@/lib/crm/desk";
import type { WaitingFollowUp } from "@/lib/followUps/agent";
import { dayKey, dueWords, type PromiseBucket, type TrackedPromise } from "@/lib/promises/shared";
import s from "./crm-agent.module.css";

type Route = Parameters<typeof Link>[0]["href"];

const ICON = {
  check: "M20 6 9 17l-5-5",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9z",
  hand: "M7 11V5a2 2 0 0 1 4 0v5m0-2a2 2 0 0 1 4 0v3m0-1a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.5L3 15a2 2 0 0 1 3.4-2L7 14",
  cal: "M3 5h18v16H3zM3 10h18M8 2v6M16 2v6",
  msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  x: "M18 6 6 18M6 6l12 12",
} as const;

function Ic({ id, className }: { id: keyof typeof ICON; className?: string }) {
  return (
    <svg className={className ?? s.ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[id]} />
    </svg>
  );
}

/** Server actions reject with an Error written for the person; a refused result carries `error`. */
function words(err: unknown): string {
  return err instanceof Error && err.message && !/digest|server components/i.test(err.message) ? err.message : "That didn't go through. Try again.";
}

const CHASES = new Set(["SENT", "VIEWED", "DECLINED"]);

const WHOSE: Record<string, string> = { ai: "Written for them by AI", rules: "Standard words", person: "Edited by hand" };

const SOURCE: Record<string, string> = {
  EMAIL: "caught in an email",
  SMS: "caught in a text",
  PORTAL: "from their message",
  CALL: "from a call",
  NOTE: "from a note",
  PERSON: "added by hand",
  OPERATOR: "added by the AI Operator",
};

export function AgentDesk({ initial, onFollowUpClosed, onCount }: { initial?: CrmDesk | null; onFollowUpClosed?: (id: string) => void; onCount?: (n: number) => void }) {
  const [desk, setDesk] = useState<CrmDesk | null>(initial ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; day: string } | null>(null);
  const [showKept, setShowKept] = useState(false);

  const reload = useCallback(async () => {
    const r = await getCrmDesk().catch(() => null);
    if (r?.ok) setDesk(r.data);
  }, []);

  // The phone mounts the band with nothing in hand.
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    getCrmDesk()
      .then((r) => {
        if (live && r.ok) setDesk(r.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [initial]);

  const count = desk ? desk.waiting.length + desk.promises.overdue.length + desk.promises.today.length : 0;
  useEffect(() => {
    onCount?.(count);
  }, [count, onCount]);

  /** One action on one row: busy, run, say what happened, read again. */
  const run = useCallback(
    async (id: string, fn: () => Promise<string | null | void>, closes?: string) => {
      setBusy(id);
      setErr(null);
      setFlash(null);
      try {
        const said = await fn();
        if (said) setFlash(said);
        if (closes) onFollowUpClosed?.(closes);
        await reload();
        return true;
      } catch (e) {
        setErr(words(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload, onFollowUpClosed],
  );

  if (!desk) return null;
  const now = new Date(desk.now);
  const p = desk.promises;
  const openN = p.overdue.length + p.today.length + p.open.length + p.waiting.length;
  const today = dayKey(now, desk.tz);

  const send = (w: WaitingFollowUp) =>
    run(
      w.id,
      async () => {
        const r = await runFollowUpNow(w.id);
        return r?.sent === false ? `Not sent — the proposal for ${w.client} has moved on since. The follow-up is closed.` : `Sent to ${w.client}.`;
      },
      w.id,
    );
  const skip = (w: WaitingFollowUp) => run(w.id, async () => void (await skipFollowUp(w.id)), w.id);
  const done = (w: WaitingFollowUp) => run(w.id, async () => void (await markFollowUpDone(w.id)), w.id);
  const write = (w: WaitingFollowUp) =>
    run(w.id, async () => {
      const r = await writeFollowUpDraft(w.id);
      if (!r.ok) throw new Error(r.error);
    });
  const save = () => {
    if (!editing) return;
    const e = editing;
    // The box closes once the list is read again, so the old words never show for a moment.
    void run(e.id, async () => {
      const r = await saveFollowUpDraft({ id: e.id, subject: e.subject.trim() || null, body: e.body });
      if (!r.ok) throw new Error(r.error);
    }).then((ok) => ok && setEditing(null));
  };

  const settle = (t: TrackedPromise, outcome: "KEPT" | "CANCELED") =>
    run(t.id, async () => {
      const r = await settlePromise(t.id, outcome);
      if (!r.ok) throw new Error("That promise was already closed. The list is refreshed.");
    });
  const move = () => {
    if (!moving) return;
    const m = moving;
    void run(m.id, async () => {
      const r = await movePromiseDay(m.id, m.day || null);
      if (!r.ok) throw new Error("Couldn't move it. Pick a day and try again.");
    }).then((ok) => ok && setMoving(null));
  };

  const groups: Array<{ key: PromiseBucket; label: string; rows: TrackedPromise[]; tone: string }> = [
    { key: "overdue", label: "Overdue", rows: p.overdue, tone: s.tDanger },
    { key: "today", label: "Due today", rows: p.today, tone: s.tWarn },
    { key: "open", label: "Open", rows: p.open, tone: s.tInfo },
    { key: "waiting", label: "Waiting on client", rows: p.waiting, tone: s.tInfo },
  ];

  return (
    <div className={s.desk} data-crm-desk data-waiting={desk.waiting.length} data-promises={openN}>
      {err && (
        <div className={s.err} role="alert" data-desk-err>
          {err}
        </div>
      )}
      {flash && (
        <div className={s.flash} role="status" data-desk-flash>
          {flash}
        </div>
      )}

      {/* ── follow-ups waiting for a person ── */}
      {desk.waiting.length > 0 && (
        <section className={s.sec} data-desk-waiting>
          <h3 className={s.secH}>
            <Ic id="hand" className={s.icSm} />
            Follow-ups waiting for you
            <span className={s.secN}>{desk.waiting.length}</span>
          </h3>
          <p className={s.secSub}>Prepared, not sent. Nothing goes to the client until you say so.</p>
          <ul className={s.cards}>
            {desk.waiting.map((w) => {
              const isBusy = busy === w.id;
              const ed = editing?.id === w.id ? editing : null;
              const reminder = !w.draftBody;
              return (
                <li key={w.id} className={`${s.card} ${reminder ? s.tInfo : s.tWarn}`} data-fu={w.id} data-fu-mode={w.mode} data-fu-by={w.draftBy ?? ""} data-fu-channel={w.channel}>
                  <div className={s.cardTop}>
                    <div className={s.cardTxt}>
                      <div className={s.cardT}>
                        {w.clientId ? (
                          <Link href={HREF.client(w.clientId) as Route} className={s.name}>
                            {w.client}
                          </Link>
                        ) : (
                          w.client
                        )}
                      </div>
                      <div className={s.cardWhy}>
                        {w.proposalId ? (
                          <Link href={HREF.proposal(w.proposalId) as Route} className={s.quiet}>
                            {w.title}
                          </Link>
                        ) : (
                          w.title
                        )}
                        {" · "}
                        {w.rule}
                      </div>
                    </div>
                    <div className={s.amt}>{money(w.total)}</div>
                  </div>

                  <div className={s.chips}>
                    <span className={s.chip}>{reminder ? "Reminder" : w.channel === "TEXT" ? "Text" : "Email"}</span>
                    {!reminder && w.draftBy && <span className={`${s.chip} ${w.draftBy === "ai" ? s.chipAi : ""}`}>{WHOSE[w.draftBy] ?? "Draft"}</span>}
                  </div>

                  {reminder ? (
                    <p className={s.remind}>Time to follow up. Call them — or have the message written for you to read first.</p>
                  ) : ed ? (
                    <div className={s.edit}>
                      {w.channel === "EMAIL" && (
                        <label className={s.field}>
                          <span>Subject</span>
                          <input value={ed.subject} maxLength={160} onChange={(e) => setEditing({ ...ed, subject: e.target.value })} data-fu-subject />
                        </label>
                      )}
                      <label className={s.field}>
                        <span>Message</span>
                        <textarea value={ed.body} rows={w.channel === "TEXT" ? 4 : 7} maxLength={w.channel === "TEXT" ? 480 : 2000} onChange={(e) => setEditing({ ...ed, body: e.target.value })} data-fu-body />
                      </label>
                    </div>
                  ) : (
                    <div className={s.draft} data-fu-draft>
                      {w.channel === "EMAIL" && w.draftSubject && <div className={s.subj}>{w.draftSubject}</div>}
                      <div className={s.body}>{w.draftBody}</div>
                      {w.channel === "TEXT" && CHASES.has(w.trigger) && <div className={s.fine}>The link to the proposal is added at the end.</div>}
                      {w.channel === "EMAIL" && <div className={s.fine}>It goes on your letterhead with the “view proposal” button.</div>}
                    </div>
                  )}

                  <div className={s.foot}>
                    {reminder ? (
                      <>
                        <button type="button" className={s.cta} disabled={isBusy} onClick={() => write(w)} data-fu-write>
                          <Ic id="bolt" className={s.icSm} />
                          {isBusy ? "Writing…" : "Write it for me"}
                        </button>
                        <button type="button" className={s.ghost} disabled={isBusy} onClick={() => done(w)} data-fu-done>
                          I followed up
                        </button>
                      </>
                    ) : ed ? (
                      <>
                        <button type="button" className={s.cta} disabled={isBusy || ed.body.trim().length < 2} onClick={save} data-fu-save>
                          <Ic id="check" className={s.icSm} />
                          {isBusy ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className={s.ghost} disabled={isBusy} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className={s.cta} disabled={isBusy} onClick={() => send(w)} data-fu-send>
                          <Ic id="send" className={s.icSm} />
                          {isBusy ? "Sending…" : "Send"}
                        </button>
                        <button type="button" className={s.ghost} disabled={isBusy} onClick={() => setEditing({ id: w.id, subject: w.draftSubject ?? "", body: w.draftBody ?? "" })} data-fu-edit>
                          <Ic id="pen" className={s.icSm} />
                          Edit
                        </button>
                      </>
                    )}
                    {!ed && (
                      <button type="button" className={s.ghost} disabled={isBusy} onClick={() => skip(w)} data-fu-skip>
                        Skip
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── the promise tracker ── */}
      <section className={s.sec} data-desk-promises>
        <h3 className={s.secH}>
          <Ic id="check" className={s.icSm} />
          Promises
          <span className={s.secN}>{openN} open</span>
        </h3>
        <p className={s.secSub}>{desk.ownOnly ? "What you told your clients you'd do, and what they told you." : "What your team told clients they'd do, and what clients said they'd do."}</p>

        <div className={s.rail} role="list">
          {groups.map((g) => (
            <span key={g.key} role="listitem" className={`${s.railChip} ${g.tone} ${g.rows.length ? "" : s.railZero}`} data-promise-count={g.key}>
              {g.label}
              <b>{g.rows.length}</b>
            </span>
          ))}
          <button type="button" className={`${s.railChip} ${s.tOk} ${s.railBtn} ${p.kept.length ? "" : s.railZero}`} aria-expanded={showKept} disabled={!p.kept.length} onClick={() => setShowKept((v) => !v)} data-promise-count="kept">
            Kept
            <b>{p.kept.length}</b>
          </button>
        </div>

        {openN === 0 && !showKept && (
          <div className={s.none} data-promises-none>
            <b>No open promises.</b>
            <span>When someone writes a client “I’ll send the revised quote Friday”, it lands here — and they get a nudge before it is late.</span>
          </div>
        )}

        {groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <div key={g.key} className={s.group} data-promise-group={g.key}>
              <h4 className={`${s.groupH} ${g.tone}`}>{g.label}</h4>
              <ul className={s.rows}>
                {g.rows.map((t) => {
                  const isBusy = busy === t.id;
                  const mv = moving?.id === t.id ? moving : null;
                  const due = dueWords(t.dueAt, now, desk.tz);
                  const late = t.dueAt != null && dayKey(new Date(t.dueAt), desk.tz) < today;
                  const isToday = t.dueAt != null && dayKey(new Date(t.dueAt), desk.tz) === today;
                  const whose = t.direction === "THEIRS" ? "their promise" : t.ownerId === desk.me ? "yours" : t.owner ? t.owner : "nobody’s yet";
                  return (
                    <li key={t.id} className={`${s.row} ${late ? s.tDanger : isToday ? s.tWarn : s.tInfo}`} data-promise={t.id} data-promise-dir={t.direction} data-promise-kind={t.kind}>
                      <button type="button" className={s.tick} disabled={isBusy} onClick={() => settle(t, "KEPT")} title={t.direction === "THEIRS" ? "They did it" : "Done — I kept it"} aria-label={t.direction === "THEIRS" ? "They did it" : "Mark kept"} data-promise-keep>
                        <Ic id="check" className={s.tickIc} />
                      </button>
                      <div className={s.rowTxt}>
                        <div className={s.rowT}>{t.text}</div>
                        <div className={s.rowS}>
                          <Link href={HREF.client(t.clientId) as Route} className={s.name}>
                            {t.client}
                          </Link>
                          {" · "}
                          {whose}
                          {t.sourceKind && SOURCE[t.sourceKind] ? ` · ${SOURCE[t.sourceKind]}` : ""}
                        </div>
                        {mv && (
                          <div className={s.move}>
                            <input type="date" value={mv.day} min={today} onChange={(e) => setMoving({ id: t.id, day: e.target.value })} aria-label="New day" data-promise-day />
                            <button type="button" className={s.cta} disabled={isBusy || !mv.day} onClick={move} data-promise-day-save>
                              {isBusy ? "Saving…" : "Save"}
                            </button>
                            <button type="button" className={s.ghost} disabled={isBusy} onClick={() => setMoving(null)}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                      <div className={s.rowEnd}>
                        <span className={s.due} data-promise-due>
                          {due}
                        </span>
                        <div className={s.rowAct}>
                          {t.threadId && (
                            <Link href={`/dashboard/inbox?t=${encodeURIComponent(t.threadId)}` as Route} className={s.mini} title="Open the conversation" aria-label="Open the conversation">
                              <Ic id="msg" className={s.icSm} />
                            </Link>
                          )}
                          <button type="button" className={s.mini} disabled={isBusy} onClick={() => setMoving(mv ? null : { id: t.id, day: t.dueAt != null && !late ? dayKey(new Date(t.dueAt), desk.tz) : "" })} title="Give it a new day" aria-label="Give it a new day" data-promise-move>
                            <Ic id="cal" className={s.icSm} />
                          </button>
                          <button type="button" className={s.mini} disabled={isBusy} onClick={() => settle(t, "CANCELED")} title="Not happening — remove it" aria-label="Remove this promise" data-promise-cancel>
                            <Ic id="x" className={s.icSm} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

        {showKept && p.kept.length > 0 && (
          <div className={s.group} data-promise-group="kept">
            <h4 className={`${s.groupH} ${s.tOk}`}>Kept · the last 7 days</h4>
            <ul className={s.rows}>
              {p.kept.map((t) => (
                <li key={t.id} className={`${s.row} ${s.tOk} ${s.rowKept}`} data-promise={t.id} data-promise-kept>
                  <span className={`${s.tick} ${s.tickOn}`} aria-hidden="true">
                    <Ic id="check" className={s.tickIc} />
                  </span>
                  <div className={s.rowTxt}>
                    <div className={s.rowT}>{t.text}</div>
                    <div className={s.rowS}>
                      <Link href={HREF.client(t.clientId) as Route} className={s.name}>
                        {t.client}
                      </Link>
                      {" · "}
                      <span data-promise-evidence>{t.evidence ?? "ticked off by hand"}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
