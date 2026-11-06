"use client";
// THE TASKS SHEET (2026-11-05, batch 4): everything the AI Operator did or is doing for this person in the last week —
// what needs their yes, what is working, what is done, what didn't go and why. One list, five filters, each row
// opening the real record when there is one. Drawn with the page's own tokens: paper in the desk panel, blueprint
// on the phone's sheet (operator.css redefines the tokens inside its root).

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { FeedAction } from "@/lib/assistant/shared";
import { PIN_TOOLS, SCHEDULED_TOOLS } from "@/lib/assistant/shared";
import s from "./tasks.module.css";

export const TOOL_LABEL: Record<string, string> = {
  build_deck: "Deck estimate",
  change_deck: "Deck estimate",
  build_estimate: "Estimate",
  build_fence: "Fence estimate",
  build_roof: "Roof estimate",
  build_hvac: "HVAC estimate",
  build_lawn: "Lawn estimate",
  change_estimate: "Estimate",
  send_proposal: "Send a proposal",
  schedule_job: "Schedule",
  text_crew: "Text the crew",
  text_crew_each: "Text the crew",
  payment_reminder: "Payment reminder",
  remind_overdue: "Payment reminders",
  add_client: "Add a client",
  update_client: "Update a client",
  add_lead: "Add a lead",
  book_visit: "Book a visit",
  move_visit: "Move a visit",
  cancel_visit: "Cancel a visit",
  remind_me: "Reminder",
  send_invoice: "Invoice",
  financing_link: "Financing link",
};

const BUILDS = new Set(["build_deck", "change_deck", "build_estimate", "change_estimate", "build_fence", "build_roof", "build_hvac", "build_lawn"]);

export type Tone = "warn" | "ok" | "bad" | "quiet" | "info";

export function stampOf(a: FeedAction, waiting: boolean): { label: string; tone: Tone } {
  const st = a.status;
  if (st === "AWAITING") return waiting ? { label: "Needs you", tone: "warn" } : { label: "Expired", tone: "quiet" };
  if (st === "QUEUED") return BUILDS.has(a.tool) ? { label: "Working", tone: "info" } : SCHEDULED_TOOLS.includes(a.tool) ? { label: "Set", tone: "info" } : { label: "In 2 min", tone: "info" };
  if (st === "RUNNING") return { label: "Working", tone: "info" };
  if (st === "DONE") return { label: BUILDS.has(a.tool) ? "Ready" : "Done", tone: "ok" };
  if (st === "FAILED") return { label: "Didn't go", tone: "bad" };
  if (st === "CANCELED") return { label: "Cancelled", tone: "quiet" };
  return { label: "Expired", tone: "quiet" };
}

type Filter = "all" | "needs" | "working" | "done" | "didnt";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs", label: "Needs you" },
  { key: "working", label: "Working" },
  { key: "done", label: "Done" },
  { key: "didnt", label: "Didn't go" },
];

function bucket(a: FeedAction, waitingId: string | null): Filter {
  if (a.status === "AWAITING") return a.id === waitingId ? "needs" : "didnt";
  if (a.status === "QUEUED" || a.status === "RUNNING") return "working";
  if (a.status === "DONE") return "done";
  return "didnt";
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? t : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${t}`;
}

export function TaskList({
  tasks,
  waitingId,
  busy,
  onAnswer,
}: {
  tasks: FeedAction[] | null;
  /** The one read-back still open: only it takes Do it / Cancel. */
  waitingId: string | null;
  busy: boolean;
  onAnswer: (id: string, yes: boolean, pin?: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [pin, setPin] = useState("");
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, needs: 0, working: 0, done: 0, didnt: 0 };
    for (const a of tasks ?? []) {
      c.all += 1;
      c[bucket(a, waitingId)] += 1;
    }
    return c;
  }, [tasks, waitingId]);
  const rows = (tasks ?? []).filter((a) => filter === "all" || bucket(a, waitingId) === filter);

  return (
    <div className={s.root}>
      <div className={s.filters} role="tablist" aria-label="Tasks">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`${s.filter} ${filter === f.key ? s.on : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}
            <small>{counts[f.key]}</small>
          </button>
        ))}
      </div>
      {tasks === null ? (
        <p className={s.empty}>Reading your tasks…</p>
      ) : rows.length === 0 ? (
        <p className={s.empty}>{filter === "all" ? "Nothing yet this week. Ask for something and it lands here." : "Nothing under that."}</p>
      ) : (
        <ul className={s.list}>
          {rows.map((a) => {
            const st = stampOf(a, a.id === waitingId);
            const needPin = PIN_TOOLS.includes(a.tool);
            return (
              <li key={a.id} className={s.row} data-tone={st.tone}>
                <div className={s.head}>
                  <span className={s.label}>{TOOL_LABEL[a.tool] ?? "Change"}</span>
                  <span className={s.stamp} data-tone={st.tone}>
                    {st.label}
                  </span>
                </div>
                <p className={s.text}>{a.readback}</p>
                {a.result && a.status !== "AWAITING" ? <p className={s.result}>{a.result.replace(/\s*Open it:\s*https?:\/\/\S+/g, "")}</p> : null}
                <div className={s.foot}>
                  <span className={s.when}>{when(a.createdAt)}</span>
                  {a.link ? (
                    <Link className={s.open} href={a.link as Route} target="_blank" rel="noopener noreferrer">
                      Open it →
                    </Link>
                  ) : null}
                </div>
                {a.id === waitingId && a.status === "AWAITING" ? (
                  <div className={`${s.actions} ${needPin ? s.withPin : ""}`}>
                    {needPin ? (
                      <input
                        className={s.pin}
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        autoComplete="off"
                        placeholder="PIN"
                        aria-label="Your 4-digit PIN"
                        value={pin}
                        disabled={busy}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      />
                    ) : null}
                    <button type="button" className={s.doIt} disabled={busy || (needPin && pin.length !== 4)} onClick={() => void onAnswer(a.id, true, needPin ? pin : undefined)}>
                      Do it
                    </button>
                    <button type="button" className={s.cancel} disabled={busy} onClick={() => void onAnswer(a.id, false)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
