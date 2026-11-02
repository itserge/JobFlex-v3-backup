"use client";

// ADMIN · SUPPORT — the triage queue.
// Route: /admin/support. Renders ONLY the shell's `.content` children (the
// admin layout mounts the blueprint chrome), as a fragment, so the reveal
// cascade walks `.content > *`.
//
// Every ticket any org has filed, newest first: who, which org, category,
// status, age, and whether it arrived since the operator last looked. Opening
// a row shows the message verbatim and changes the status. The write is the
// existing `updateTicketStatus` (src/actions/admin.ts), which whitelists the
// four statuses — the column is a free String, so that guard is the only one.
//
// THE CONVERSATION (owner, 2026-10-14 "respond to the client from admin right
// away"; 2026-10-17 "one dialog per ticket"): the sheet is a chat — the
// ticket's words, then every message in order (the customer's, ours, the
// AI's), the box at the bottom. A message is kept in the conversation (here
// and on the customer's support page) and emailed to them
// (replyToSupportTicket → lib/supportThread). The open sheet asks for news
// every 5 s; the queue every 10 s, so a customer's reply lifts its ticket to
// the top, unread. Opening a ticket reads it.
//
// THE AI (owner, 2026-10-15: "add smart AI that answers them automatically …
// copy to our email … a bug: tell the user we're on it, but don't fix
// anything — ask in admin and email us, we confirm"): the switch above the
// queue, a state chip on every row the AI has read, and in the sheet what it
// did — the answer it sent or the one waiting for you, its notes, and a bug's
// fix proposal with Approve / Decline and, once approved and live, "Mark
// fixed — tell the customer". The work is lib/support; the writes are
// actions/supportAi.
//
// The controls are components/v3/admin-users/admin-kit, and the vocabulary is
// its admin-shared.module.css: same buttons, same estimate-style table, same
// status badges, same hand-rolled sheet as /admin/users and /admin/plans.
// decisions.md — "never create parallel style sets for identical blocks".

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { adminSupportConversation, markSupportTicketRead, markSupportTicketsRead, supportQueueStamp } from "@/actions/support";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { replyToSupportTicket, updateTicketStatus } from "@/actions/admin";
import type { ThreadMessage } from "@/lib/supportReply";
import { hasReplyCard, replyBlocks } from "@/lib/support/replyCards";
import { approveSupportFix, askSupportAi, declineSupportFix, extendTrialFromSupport, markSupportFixed, redraftSupportAnswers, setSupportAiMode } from "@/actions/supportAi";
import {
  SUPPORT_AI_CATEGORY_LABEL,
  SUPPORT_AI_MODES,
  SUPPORT_AI_MODE_LABEL,
  badgeFor,
  needsPersonSince,
  waitingForPerson,
  type SupportAiBadge,
  type SupportAiMode,
  type SupportAiRecord,
} from "@/lib/support/aiState";
import { createTaskFromSupportTicket } from "@/actions/adminTasks";
import { taskPath } from "@/lib/adminTasks/model";
import shared from "@/components/v3/admin-users/admin-shared.module.css";
import {
  makeCx,
  KIT_BTN_CLASS,
  useSheet,
  Sheet,
  SheetBody,
  SheetFoot,
  Field,
  Select,
  Note,
  errorMessage,
} from "@/components/v3/admin-users/admin-kit";
import { useAdminMotion } from "@/components/v3/admin-users/use-admin-motion";
import s from "./admin-support.module.css";

const cx = makeCx(s, shared);

/** One of our answers: its paragraphs, and its cards ("[offer]" / "[note]", lib/support/replyCards) drawn as the customer sees them. */
function ReplyCards({ body }: { body: string }) {
  return (
    <div className={cx("replyBody", "replyBlocks")}>
      {replyBlocks(body).map((b, i) =>
        b.kind === "text" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <div key={i} className={cx("replyCard", b.kind === "offer" ? "replyCard--offer" : "replyCard--note")} data-support-card={b.kind}>
            <b>{b.title}</b>
            {b.text ? <p>{b.text}</p> : null}
          </div>
        ),
      )}
    </div>
  );
}

export interface SupportTicketDTO {
  /** Whether the team can add trial days for this company (the offer the AI makes on a cancellation), 2026-10-26. */
  trialOffer?: { eligible: boolean; pendingDays: number | null; trialEndsAt: string | null } | null;
  id: string;
  /** Short reference, derived from the id by the page (lib/notify). */
  ref: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  orgName: string;
  submitterEmail: string | null;
  /** The filer's name, as their messages are signed in the conversation. */
  submitterName?: string | null;
  createdAt: string;
  /** The conversation's latest message — the queue's order. */
  lastMessageAt: string;
  /** No adminReadAt yet: a new ticket, or the customer wrote since an admin last opened it. */
  unread: boolean;
  /** The task made from this ticket on /admin/tasks, if any. */
  task: { id: string; title: string; status: string } | null;
  /** The conversation after the ticket's own words, oldest first (lib/supportThread). */
  messages: ThreadMessage[];
  /** Where an answer goes — whoever filed it, else the account's owner, else its billing email; null = nowhere. */
  to: string | null;
  /** What the support AI did on this ticket (lib/support), or null when it hasn't read it. */
  ai: SupportAiRecord | null;
}

export interface SupportCounts {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
}

/** The four statuses `updateTicketStatus` accepts. Any other string in the
 *  column is shown as-is and never offered. */
const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

/** `SupportTicket.category` — the taxonomy both writers share (the
 *  /dashboard/support form and the corner Help widget). */
const CATEGORY_LABEL: Record<string, string> = {
  technical: "Technical",
  billing: "Billing",
  account: "Account",
  feature: "Feature",
  general: "General",
};

function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status.replace(/_/g, " ");
}

function statusTone(status: string): string | false {
  switch (status) {
    case "OPEN":
      return "st--bp";
    case "IN_PROGRESS":
      return "st--warn";
    case "RESOLVED":
      return "st--ok";
    default:
      return false;
  }
}

/** A person answered after the AI read the ticket — or after the customer said
 *  it still isn't solved: what was waiting is handled. */
function answeredByPerson(t: { messages: ThreadMessage[] }, ai: SupportAiRecord | null): boolean {
  if (!ai) return false;
  const since = needsPersonSince(ai);
  return t.messages.some((m) => m.from === "team" && m.at > since);
}

/** The customer has the last word in the conversation (after at least one answer). */
function customerWaiting(messages: ThreadMessage[]): boolean {
  return messages.length > 0 && messages[messages.length - 1].from === "customer";
}

function badgeTone(b: SupportAiBadge): string | false {
  return b.tone === "ok" ? "st--ok" : b.tone === "warn" ? "st--warn" : b.tone === "danger" ? "st--danger" : b.tone === "info" ? "st--sky" : false;
}

function modeHint(mode: SupportAiMode, copyTo: string[]): string {
  const inbox = copyTo.length ? copyTo.join(", ") : "the support inbox";
  if (mode === "auto") {
    return `Answers new tickets on its own and copies every answer to ${inbox}. Money back, account changes, upset customers and anything it isn't sure of wait for you — the customer gets a "we're on it" note at once. Bugs come with a fix proposal for your OK; nothing is changed without it.`;
  }
  if (mode === "draft") return `Writes an answer for every new ticket and copies it to ${inbox}. Nothing reaches the customer until you send it.`;
  return `Off — new tickets wait for you. "Ask AI" on a ticket still writes a draft.`;
}

/** Age, anchored on a clock the SERVER read, so the first paint and the
 *  hydration agree. `Date.now()` here would differ between the two and React
 *  would report a mismatch on every row. */
function age(iso: string, now: string): string {
  const diff = (new Date(now).getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / (86400 * 30))}mo`;
}

const FILED = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
/** UTC, so server and client render the same string. */
function filedAt(iso: string): string {
  return `${FILED.format(new Date(iso))} UTC`;
}

export function AdminSupportContent({
  tickets,
  counts,
  unread = 0,
  now,
  initialTicketId = null,
  tasksAvailable = true,
  signer = "JobFlex support",
  aiMode = "auto",
  aiCopyTo = [],
}: {
  tickets: SupportTicketDTO[];
  counts: SupportCounts;
  /** Tickets no admin has opened since their latest customer message. */
  unread?: number;
  /** ?ticket=<id> — open this ticket on arrival (a task's related link). */
  initialTicketId?: string | null;
  /** False when the task tables can't be read: no "Create task" then. */
  tasksAvailable?: boolean;
  /** ISO clock read in the server page — the anchor for every age. */
  now: string;
  /** The name a reply is signed with — this admin's. */
  signer?: string;
  /** The support AI's switch, and where its copies go. */
  aiMode?: SupportAiMode;
  aiCopyTo?: string[];
}) {
  useAdminMotion(KIT_BTN_CLASS);
  const router = useRouter();

  // Read on this visit, as of which message (the rows themselves are re-read by
  // the queue's poll): a customer message after that makes the ticket unread again.
  const [readUpTo, setReadUpTo] = useState<Record<string, string>>({});
  const isUnread = useCallback((t: SupportTicketDTO) => t.unread && !(readUpTo[t.id] && readUpTo[t.id] >= t.lastMessageAt), [readUpTo]);
  const unreadLeft = tickets.filter(isUnread).length;
  const [markingAll, setMarkingAll] = useState(false);
  async function markAllRead() {
    setMarkingAll(true);
    try {
      await markSupportTicketsRead();
      setReadUpTo(Object.fromEntries(tickets.map((t) => [t.id, t.lastMessageAt])));
      router.refresh();
    } catch {
      /* the next poll shows the truth */
    } finally {
      setMarkingAll(false);
    }
  }

  // THE QUEUE'S POLL: every 10 s while the tab is visible, "anything new?" —
  // one cheap read; a change re-reads the page, so a customer's reply lifts its
  // ticket to the top, unread, without a reload.
  const stamp = useRef<string | null>(tickets.reduce<string | null>((m, t) => (!m || t.lastMessageAt > m ? t.lastMessageAt : m), null));
  const unreadSeen = useRef(unread);
  useEffect(() => {
    unreadSeen.current = unread;
  }, [unread]);
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const q = await supportQueueStamp();
        if (q.latest !== stamp.current || q.unread !== unreadSeen.current) {
          stamp.current = q.latest;
          unreadSeen.current = q.unread;
          router.refresh();
        }
      } catch {
        /* offline: the next tick retries */
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), 10_000);
    return () => window.clearInterval(id);
  }, [router]);

  // The AI: its switch, what it did on tickets touched this visit, and the queue filter.
  const [mode, setMode] = useState<SupportAiMode>(aiMode);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  // Re-draft every waiting answer under the current rules (owner, 2026-10-26: "re-answer the existing answers").
  const [redrafting, setRedrafting] = useState(false);
  const [redraftNote, setRedraftNote] = useState<string | null>(null);
  async function redraftAll() {
    setRedrafting(true);
    setRedraftNote(null);
    try {
      const r = await redraftSupportAnswers();
      if (!r.ok) setRedraftNote(r.error);
      else { setRedraftNote(`${r.redrafted} of ${r.waiting} written again — open a ticket to read it.`); router.refresh(); }
    } catch {
      setRedraftNote("That didn't work — try again.");
    } finally {
      setRedrafting(false);
    }
  }
  const [liveAi, setLiveAi] = useState<Record<string, SupportAiRecord>>({});
  const [aiFilter, setAiFilter] = useState<"" | "fix" | "needs">("");
  const aiOf = useCallback((t: SupportTicketDTO) => liveAi[t.id] ?? t.ai, [liveAi]);
  const fixesWaiting = tickets.filter((t) => aiOf(t)?.fix?.status === "awaiting").length;
  const answersWaiting = tickets.filter((t) => waitingForPerson(aiOf(t), answeredByPerson(t, aiOf(t)))).length;

  async function changeMode(next: string) {
    const previous = mode;
    setMode(next as SupportAiMode);
    setModeBusy(true);
    setModeError(null);
    try {
      const r = await setSupportAiMode(next);
      if (!r.ok) {
        setMode(previous);
        setModeError(r.error);
      }
    } catch {
      setMode(previous);
      setModeError("Couldn't change it. Check the connection and try again.");
    } finally {
      setModeBusy(false);
    }
  }

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  // A task's "related link" lands here with ?ticket=<id>: that ticket starts selected.
  const [selected, setSelected] = useState<SupportTicketDTO | null>(() =>
    initialTicketId ? (tickets.find((x) => x.id === initialTicketId) ?? null) : null,
  );
  /** Tasks made from tickets on this visit (the rows themselves are not re-read). */
  const [madeTasks, setMadeTasks] = useState<Record<string, NonNullable<SupportTicketDTO["task"]>>>({});
  const sheet = useSheet();

  /** Only the categories actually present, so the filter can never offer a
   *  choice that returns nothing. */
  const categoryOptions = useMemo(() => {
    const seen = Array.from(new Set(tickets.map((t) => t.category)));
    return seen.sort().map((c) => ({ value: c, label: categoryLabel(c) }));
  }, [tickets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      const ai = liveAi[t.id] ?? t.ai;
      if (aiFilter === "fix" && ai?.fix?.status !== "awaiting") return false;
      if (aiFilter === "needs" && !waitingForPerson(ai, answeredByPerson(t, ai))) return false;
      if (status && t.status !== status) return false;
      if (category && t.category !== category) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.orgName.toLowerCase().includes(q) ||
        t.ref.toLowerCase().includes(q) ||
        (t.submitterEmail ?? "").toLowerCase().includes(q)
      );
    });
  }, [tickets, query, status, category, aiFilter, liveAi]);

  const openRow = useCallback(
    (t: SupportTicketDTO) => {
      setSelected(t);
      sheet.open();
    },
    [sheet],
  );
  const closeSheet = useCallback(() => sheet.close(() => setSelected(null)), [sheet]);

  // …and its sheet opens once, on arrival.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current) return;
    linked.current = true;
    if (selected) sheet.open();
  }, [selected, sheet]);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, t: SupportTicketDTO) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRow(t);
    }
  };

  const filtering = Boolean(query.trim() || status || category || aiFilter);

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Platform</div>
          <h1 className={cx("page-title")}>Support tickets</h1>
        </div>
        {unreadLeft ? (
          <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={markAllRead} disabled={markingAll} data-support-mark-all>
            {markingAll ? "Marking…" : `Mark ${unreadLeft} read`}
          </button>
        ) : null}
      </div>

      <div className={cx("kpi-grid")}>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Open</div>
          <div className={cx("kpi-val", "accent")}>{counts.open}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>In progress</div>
          <div className={cx("kpi-val")}>{counts.inProgress}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Resolved</div>
          <div className={cx("kpi-val")}>{counts.resolved}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Closed</div>
          <div className={cx("kpi-val")}>{counts.closed}</div>
        </div>
      </div>

      {/* The support AI: its switch, and what is waiting for you. */}
      <section className={cx("card", "aiPanel")} data-support-ai-panel>
        <div className={cx("aiPanelRow")}>
          <div className={cx("aiPanelTxt")}>
            <div className={cx("aiPanelT")}>AI support</div>
            <div className={cx("aiPanelS")} data-support-ai-hint>{modeHint(mode, aiCopyTo)}</div>
          </div>
          <div className={cx("aiMode")}>
            <Select
              value={mode}
              onChange={changeMode}
              options={SUPPORT_AI_MODES.map((m) => ({ value: m, label: SUPPORT_AI_MODE_LABEL[m] }))}
              disabled={modeBusy}
              ariaLabel="What the support AI does"
            />
          </div>
        </div>
        {fixesWaiting || answersWaiting ? (
          <div className={cx("aiChips")}>
            {fixesWaiting ? (
              <button type="button" className={cx("aiChip", "aiChip--fix", aiFilter === "fix" && "on")} onClick={() => setAiFilter(aiFilter === "fix" ? "" : "fix")} aria-pressed={aiFilter === "fix"} data-support-fix-filter>
                {fixesWaiting} fix{fixesWaiting === 1 ? "" : "es"} waiting for your OK
              </button>
            ) : null}
            {answersWaiting ? (
              <button type="button" className={cx("aiChip", aiFilter === "needs" && "on")} onClick={() => setAiFilter(aiFilter === "needs" ? "" : "needs")} aria-pressed={aiFilter === "needs"} data-support-needs-filter>
                {answersWaiting} answer{answersWaiting === 1 ? "" : "s"} waiting for you
              </button>
            ) : null}
          </div>
        ) : null}
        {answersWaiting ? (
          <div className={cx("aiChips")}>
            <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} disabled={redrafting} onClick={() => void redraftAll()} data-support-redraft>
              {redrafting ? "Writing them again…" : `Re-draft the ${answersWaiting} waiting answer${answersWaiting === 1 ? "" : "s"} with the current guidance`}
            </button>
            {redraftNote ? <span className={cx("aiPanelS")} data-support-redraft-note>{redraftNote}</span> : null}
          </div>
        ) : null}
        {modeError ? <Note tone="danger">{modeError}</Note> : null}
      </section>

      <section className={cx("card")}>
        <div className={cx("filters")}>
          <label className={cx("search", "fSearch")}>
            <Search className={cx("ic")} aria-hidden="true" />
            <input
              type="search"
              placeholder="Subject, message, org, email or ref…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tickets"
            />
          </label>
          <div className={cx("fSel")}>
            <Select
              value={status}
              onChange={setStatus}
              placeholder="Any status"
              options={STATUS_OPTIONS}
              ariaLabel="Filter by status"
            />
          </div>
          <div className={cx("fSel")}>
            <Select
              value={category}
              onChange={setCategory}
              placeholder="Any category"
              options={categoryOptions}
              ariaLabel="Filter by category"
            />
          </div>
          {filtering ? (
            <button
              type="button"
              className={cx("btn", "btn-ghost", "btn-sm")}
              onClick={() => {
                setQuery("");
                setStatus("");
                setCategory("");
                setAiFilter("");
              }}
            >
              Clear
            </button>
          ) : null}
          <span className={cx("count")}>
            {filtered.length}/{tickets.length}
          </span>
        </div>
      </section>

      <section className={cx("card", "tbl-card")}>
        {filtered.length === 0 ? (
          <div className={cx("tbl-empty")}>
            {tickets.length === 0 ? "No tickets yet." : "Nothing matches those filters."}
          </div>
        ) : (
          <div className={cx("tbl-wrap")}>
            <table className={cx("tbl", "tbl--stack")}>
              <colgroup>
                <col className={cx("cTicket")} />
                <col className={cx("cCat")} />
                <col className={cx("cStatus")} />
                <col className={cx("cAge")} />
              </colgroup>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className={cx("is-link")}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ticket ${t.ref}`}
                    onClick={() => openRow(t)}
                    onKeyDown={(e) => onRowKey(e, t)}
                  >
                    <td>
                      <div className={cx("subj")}>
                        {isUnread(t) ? (
                          <span className={cx("mark")} role="img" aria-label="New" />
                        ) : null}
                        <div
                          className={cx("t-title", isUnread(t) && "unread")}
                          title={t.subject}
                        >
                          {t.subject}
                        </div>
                        {customerWaiting(t.messages) ? (
                          <span className={cx("st", "st--bp", "aiBadge")} data-support-customer-replied>
                            Customer replied
                          </span>
                        ) : null}
                        {t.priority === "high" ? (
                          <span className={cx("st", "st--danger")}>Urgent</span>
                        ) : null}
                        {(() => {
                          const ai = liveAi[t.id] ?? t.ai;
                          const b = badgeFor(ai, answeredByPerson(t, ai));
                          return b ? (
                            <span className={cx("st", badgeTone(b), "aiBadge")} data-support-ai-badge>
                              {b.label}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div className={cx("t-sub")} title={t.submitterEmail ?? undefined}>
                        {t.orgName}
                        {t.submitterEmail ? ` · ${t.submitterEmail}` : ""}
                      </div>
                    </td>
                    <td data-l="Category" className={cx("t-mono")}>
                      {categoryLabel(t.category)}
                    </td>
                    <td data-l="Status">
                      <span className={cx("st", statusTone(t.status))}>{statusLabel(t.status)}</span>
                    </td>
                    <td data-l="Updated" className={cx("t-mono")}>
                      {age(t.lastMessageAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet
        handle={sheet}
        kicker={selected ? `${selected.ref} · ${selected.orgName}` : "Ticket"}
        title={selected?.subject ?? "Ticket"}
        onClose={closeSheet}
      >
        {selected ? (
          <TicketDetail
            key={selected.id}
            ticket={selected}
            task={madeTasks[selected.id] ?? selected.task}
            onTask={(t) => setMadeTasks((m) => ({ ...m, [selected.id]: t }))}
            tasksAvailable={tasksAvailable}
            signer={signer}
            ai={liveAi[selected.id] ?? selected.ai}
            onAi={(rec) => setLiveAi((m) => ({ ...m, [selected.id]: rec }))}
            onRead={(upTo) => setReadUpTo((m) => ({ ...m, [selected.id]: upTo }))}
          />
        ) : null}
      </Sheet>
    </>
  );
}

// ── The open ticket ────────────────────────────────────────────────
// Keyed on the ticket id by the parent, so every field initialises from props
// and no effect syncs state — the sheet stays mounted through its 190ms exit
// with the last ticket's values still in place (admin-kit's contract).

/** The AI's tag on its message: what kind of send it was. */
function aiTagLabel(m: ThreadMessage): string {
  return `AI${m.kind === "ack" ? " · holding note" : m.kind === "fixed" ? " · fixed note" : ""}`;
}

/** How often the open conversation asks for news. */
const LIVE_MS = 5_000;

function TicketDetail({
  ticket,
  task,
  onTask,
  tasksAvailable,
  signer,
  ai,
  onAi,
  onRead,
}: {
  ticket: SupportTicketDTO;
  task: SupportTicketDTO["task"];
  onTask: (t: NonNullable<SupportTicketDTO["task"]>) => void;
  tasksAvailable: boolean;
  signer: string;
  ai: SupportAiRecord | null;
  onAi: (rec: SupportAiRecord) => void;
  /** Read up to this message (its ISO time). */
  onRead: (upTo: string) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(ticket.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  // The conversation: the messages after the ticket's words, the one being written, and the last send.
  const [messages, setMessages] = useState<ThreadMessage[]>(ticket.messages);
  const [lastAt, setLastAt] = useState(ticket.lastMessageAt);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ at: string; note?: string } | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  // The AI on this ticket: its record, the call in flight, and the fix's note.
  const [aiRec, setAiRec] = useState<SupportAiRecord | null>(ai);
  const [aiBusy, setAiBusy] = useState<"ask" | "approve" | "decline" | "done" | "give" | null>(null);
  // The days the draft offers, given from here (2026-10-26): the request filed and approved at once.
  const [given, setGiven] = useState<string | null>(null);
  async function give(days: 7 | 14) {
    setAiBusy("give");
    try {
      const r = await extendTrialFromSupport(ticket.id, days);
      if (!r.ok) setGiven(`Couldn't add the days: ${r.error}`);
      else setGiven(`${days} more days given${r.until ? ` — their trial now runs until ${filedAt(r.until)}` : ""}${r.localOnly ? " (noted here; Stripe wasn't reachable)" : ""}. They've been emailed.`);
    } catch {
      setGiven("Couldn't add the days — try again.");
    } finally {
      setAiBusy(null);
    }
  }
  const [aiError, setAiError] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  function keepAi(rec: SupportAiRecord) {
    setAiRec(rec);
    onAi(rec);
  }

  // Opening it reads it — and so does a customer's message arriving while it is open.
  const read = useCallback(
    (upTo: string) => {
      onRead(upTo);
      markSupportTicketRead(ticket.id).catch(() => {});
    },
    [onRead, ticket.id],
  );
  const readOnce = useRef(false);
  useEffect(() => {
    if (readOnce.current || !ticket.unread) return;
    readOnce.current = true;
    read(ticket.lastMessageAt);
  }, [read, ticket.unread, ticket.lastMessageAt]);

  // THE LIVE CONVERSATION: every 5 s while the tab is visible, one cheap read
  // ("changed since?"); news replaces the messages, the status and the AI's record.
  const live = useRef({ lastAt, status });
  useEffect(() => {
    live.current = { lastAt, status };
  }, [lastAt, status]);
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await adminSupportConversation(ticket.id, live.current.lastAt, live.current.status);
        if (r && "messages" in r) {
          setMessages(r.messages.slice(1));
          setLastAt(r.lastMessageAt);
          setStatus(r.status);
          if (r.ai) keepAi(r.ai);
          if (r.unread) read(r.lastMessageAt);
        }
      } catch {
        /* offline: the next tick retries */
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), LIVE_MS);
    return () => window.clearInterval(id);
    // keepAi and read are stable enough for a poll; the id never changes for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  // A new message brings the bottom of the conversation into view.
  const count = messages.length;
  const seenCount = useRef(count);
  useEffect(() => {
    if (count > seenCount.current) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    seenCount.current = count;
  }, [count]);

  async function askAi() {
    setAiBusy("ask");
    setAiError(null);
    try {
      const r = await askSupportAi(ticket.id);
      if (r.ok) {
        keepAi(r.record);
        if (r.record.reply) setDraft(r.record.reply);
      } else setAiError(r.error);
    } catch {
      setAiError("The AI didn't answer. Check the connection and try again.");
    } finally {
      setAiBusy(null);
    }
  }

  async function decide(decision: "approve" | "decline") {
    setAiBusy(decision);
    setAiError(null);
    try {
      const r = decision === "approve" ? await approveSupportFix(ticket.id, fixNote) : await declineSupportFix(ticket.id, fixNote);
      if (r.ok) {
        keepAi(r.record);
        setFixNote("");
        router.refresh();
      } else setAiError(r.error);
    } catch {
      setAiError("That didn't save. Check the connection and try again.");
    } finally {
      setAiBusy(null);
    }
  }

  async function fixedNow() {
    setAiBusy("done");
    setAiError(null);
    try {
      const r = await markSupportFixed(ticket.id);
      if (r.ok) {
        keepAi(r.record);
        setMessages((list) => [...list, r.reply]);
        setLastAt(r.reply.at);
        setStatus("RESOLVED");
        router.refresh();
      } else setAiError(r.error);
    } catch {
      setAiError("The customer wasn't told. Check the connection and try again.");
    } finally {
      setAiBusy(null);
    }
  }

  async function sendReply() {
    if (sending || draft.trim().length < 2) return;
    setSending(true);
    setReplyError(null);
    try {
      const r = await replyToSupportTicket(ticket.id, draft);
      if (r.ok) {
        setMessages((list) => [...list, r.reply]);
        setLastAt(r.reply.at);
        setDraft("");
        setSent({ at: r.reply.at, ...(r.emailed ? {} : { note: r.emailNote ?? "Not emailed." }) });
        setStatus(r.status);
        router.refresh();
      } else setReplyError(r.error);
    } catch {
      setReplyError("The message wasn't sent. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // "Create task" (2026-10-11): a Support task on /admin/tasks with the
  // ticket's subject and message and a link back here. A second press — or a
  // second admin — gets the task already made, never a duplicate.
  async function makeTask() {
    setMaking(true);
    setError(null);
    try {
      const r = await createTaskFromSupportTicket(ticket.id);
      if (r.ok) onTask({ id: r.task.id, title: r.task.title, status: r.task.status });
      else setError(r.error);
    } catch {
      setError("Couldn't create the task. Check your connection and try again.");
    } finally {
      setMaking(false);
    }
  }

  async function change(next: string) {
    const previous = status;
    setStatus(next);
    setBusy(true);
    setError(null);
    try {
      await updateTicketStatus(ticket.id, next);
      router.refresh();
    } catch (err: unknown) {
      setStatus(previous);
      setError(errorMessage(err, "Could not change the status."));
    } finally {
      setBusy(false);
    }
  }

  const opening: ThreadMessage = {
    id: `ticket:${ticket.id}`,
    at: ticket.createdAt,
    from: "customer",
    by: ticket.submitterName || ticket.submitterEmail || ticket.orgName,
    to: null,
    body: ticket.body,
    channel: "app",
  };

  return (
    <>
      <SheetBody>
        <div className={cx("meta")}>
          <span>
            Filed <b>{filedAt(ticket.createdAt)}</b>
          </span>
          <span>
            Category <b>{categoryLabel(ticket.category)}</b>
          </span>
          <span>
            Priority <b>{ticket.priority}</b>
          </span>
          {ticket.submitterEmail ? (
            <span>
              From <b>{ticket.submitterEmail}</b>
            </span>
          ) : null}
        </div>

        {/* The conversation, oldest first: the customer's on the left, ours on the right. */}
        <div className={cx("chat")} data-support-thread role="log" aria-label="Conversation" aria-live="polite">
          {[opening, ...messages].map((m) => (
            <div
              key={m.id}
              className={cx("bubble", m.from === "customer" ? "bubble--them" : "bubble--us", m.from === "ai" && "bubble--ai")}
              data-support-message={m.from}
            >
              <div className={cx("replyMeta")}>
                {m.from === "ai" ? <span className={cx("aiTag")}>{aiTagLabel(m)}</span> : null}
                {m.by || (m.from === "customer" ? "Customer" : "JobFlex support")} · {filedAt(m.at)}
                {m.channel === "email" ? " · by email" : ""}
                {m.from !== "customer" && m.to ? ` · emailed to ${m.to}` : ""}
              </div>
              {m.from === "customer" ? <div className={cx("replyBody")}>{m.body}</div> : <ReplyCards body={m.body} />}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className={cx("replyBox")} data-support-reply>
          <Field
            label="Reply"
            htmlFor="ticket-reply"
            hint={
              ticket.to
                ? `Shows in their conversation at once and goes by email to ${ticket.to}, signed ${signer} · JobFlex support — no need to sign it. Ctrl+Enter sends.`
                : "Shows in their conversation. Nobody can be emailed: no one is on this ticket and the account has no owner or billing email."
            }
          >
            <textarea
              id="ticket-reply"
              className={cx("in", "ta")}
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void sendReply();
                }
              }}
              placeholder="Write the answer as you'd say it."
              disabled={sending}
              data-support-reply-text
            />
          </Field>
          <div className={cx("replyActs")}>
            <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={sendReply} disabled={sending || draft.trim().length < 2} data-support-send>
              {sending ? "Sending…" : "Send"}
            </button>
            {sent && !draft ? (
              <span className={cx(sent.note ? "aiWhy" : "replySent")} data-support-sent>
                {sent.note ? `In the conversation · ${sent.note}` : `Sent · ${filedAt(sent.at)}`}
              </span>
            ) : null}
          </div>
          {replyError ? <Note tone="danger">{replyError}</Note> : null}
          {/* A draft with cards ("[offer]" / "[note]"): how the customer will see it, as it is typed. */}
          {hasReplyCard(draft) ? (
            <div className={cx("cardPreview")} data-support-card-preview>
              <span className={cx("cardPreviewH")}>How they&apos;ll see it</span>
              <ReplyCards body={draft} />
            </div>
          ) : null}
        </div>

        {/* What the support AI did here — and, for a bug, the fix waiting for a decision. */}
        <div className={cx("aiCard")} data-support-ai>
          {aiRec ? (
            <>
              <div className={cx("aiHead")}>
                {(() => {
                  const b = badgeFor(aiRec, answeredByPerson({ messages }, aiRec));
                  return b ? <span className={cx("st", badgeTone(b))}>{b.label}</span> : null;
                })()}
                {aiRec.outcome !== "failed" ? (
                  <span className={cx("aiMeta")}>
                    {SUPPORT_AI_CATEGORY_LABEL[aiRec.category]} · {aiRec.confidence}% sure · {filedAt(aiRec.at)}
                  </span>
                ) : null}
              </div>
              {aiRec.summary ? <div className={cx("aiSummary")}>{aiRec.summary}</div> : null}
              {ticket.trialOffer?.eligible ? (
                <div className={cx("aiWhy")} data-support-offer>
                  {given
                    ? given
                    : ticket.trialOffer.pendingDays
                      ? `They already asked for ${ticket.trialOffer.pendingDays} more days — give them here, or decide it on Trial requests.`
                      : `Two free weeks if they simply haven't had time to explore: their trial can take more days${ticket.trialOffer.trialEndsAt ? ` (it ends ${filedAt(ticket.trialOffer.trialEndsAt)})` : ""}. Give them here — the request is filed, approved and emailed at once.`}
                  {!given ? (
                    <div className={cx("replyActs")}>
                      <button type="button" className={cx("btn", "btn-primary", "btn-sm")} disabled={!!aiBusy} onClick={() => void give(14)} data-support-give-days="14">
                        {aiBusy === "give" ? "Adding…" : "Give 14 more days"}
                      </button>
                      <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} disabled={!!aiBusy} onClick={() => void give(7)} data-support-give-days="7">
                        Give 7
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {aiRec.customer ? (
                <div className={cx("aiVerdict", aiRec.customer.verdict === "solved" ? "aiVerdict--ok" : "aiVerdict--stuck")} data-support-verdict={aiRec.customer.verdict}>
                  <b>{aiRec.customer.verdict === "solved" ? "The customer pressed “That solved it”" : "The customer pressed “I still need help”"}</b>
                  <span> · {filedAt(aiRec.customer.at)}</span>
                  {aiRec.customer.note ? <div className={cx("aiVerdictNote")}>{aiRec.customer.note}</div> : null}
                </div>
              ) : null}
              {aiRec.reason ? <div className={cx("aiWhy")}>{aiRec.outcome === "failed" ? "What happened: " : aiRec.outcome === "sent" ? "Note: " : "Why it waited: "}{aiRec.reason}</div> : null}
              {aiRec.outcome !== "sent" && aiRec.reply ? (
                <details className={cx("aiMore")} open={aiRec.outcome === "held" || aiRec.outcome === "drafted"}>
                  <summary>The AI&apos;s answer{aiRec.outcome === "held" || aiRec.outcome === "drafted" ? ", waiting for you" : ""}</summary>
                  <div className={cx("replyBody")} data-support-ai-draft>{aiRec.reply}</div>
                  <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => setDraft(aiRec.reply)} data-support-ai-use>
                    Put it in the reply box
                  </button>
                </details>
              ) : null}
              {aiRec.internalNotes ? (
                <details className={cx("aiMore")}>
                  <summary>Notes for the team</summary>
                  <div className={cx("replyBody")}>{aiRec.internalNotes}</div>
                </details>
              ) : null}
              {aiRec.factsUsed.length ? (
                <details className={cx("aiMore")}>
                  <summary>What it relied on</summary>
                  <ul className={cx("aiFacts")}>
                    {aiRec.factsUsed.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {aiRec.fix ? (
                <div className={cx("fix", `fix--${aiRec.fix.status}`)} data-support-fix data-fix-status={aiRec.fix.status}>
                  <div className={cx("fixHead")}>
                    <span className={cx("fixKicker")}>Fix proposal · {aiRec.fix.severity}</span>
                    <b className={cx("fixTitle")}>{aiRec.fix.title}</b>
                  </div>
                  <dl className={cx("fixList")}>
                    <dt>Symptoms</dt>
                    <dd>{aiRec.fix.symptoms}</dd>
                    <dt>Likely cause</dt>
                    <dd>{aiRec.fix.likelyCause}</dd>
                    <dt>Proposed fix</dt>
                    <dd>{aiRec.fix.proposedFix}</dd>
                    {aiRec.fix.areas.length ? (
                      <>
                        <dt>Where to look</dt>
                        <dd className={cx("fixAreas")}>{aiRec.fix.areas.join("\n")}</dd>
                      </>
                    ) : null}
                    {aiRec.fix.workaround ? (
                      <>
                        <dt>Workaround told to the customer</dt>
                        <dd>{aiRec.fix.workaround}</dd>
                      </>
                    ) : null}
                  </dl>
                  {aiRec.fix.status === "awaiting" || aiRec.fix.status === "declined" ? (
                    <div className={cx("fixActs")}>
                      {aiRec.fix.status === "declined" ? (
                        <div className={cx("aiWhy")}>
                          Declined by {aiRec.fix.decidedBy}
                          {aiRec.fix.note ? ` — ${aiRec.fix.note}` : ""}.
                        </div>
                      ) : null}
                      <input
                        className={cx("in")}
                        value={fixNote}
                        onChange={(e) => setFixNote(e.target.value)}
                        placeholder="A note for the team (optional)"
                        aria-label="A note about this fix"
                        disabled={!!aiBusy}
                      />
                      <div className={cx("replyActs")}>
                        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={() => decide("approve")} disabled={!!aiBusy} data-support-fix-approve>
                          {aiBusy === "approve" ? "Approving…" : "Approve the fix"}
                        </button>
                        {aiRec.fix.status === "awaiting" ? (
                          <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => decide("decline")} disabled={!!aiBusy} data-support-fix-decline>
                            {aiBusy === "decline" ? "Declining…" : "Decline"}
                          </button>
                        ) : null}
                      </div>
                      <div className={cx("aiWhy")}>Approving emails the brief to the team and puts it on the task board. Nothing in JobFlex changes until someone makes the fix.</div>
                    </div>
                  ) : null}
                  {aiRec.fix.status === "approved" ? (
                    <div className={cx("fixActs")}>
                      <div className={cx("aiWhy")}>
                        Approved by {aiRec.fix.decidedBy} · {aiRec.fix.decidedAt ? filedAt(aiRec.fix.decidedAt) : ""}
                        {aiRec.fix.note ? ` — ${aiRec.fix.note}` : ""}. When the fix is live:
                      </div>
                      <div className={cx("replyActs")}>
                        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={fixedNow} disabled={!!aiBusy || !ticket.to} data-support-fix-done>
                          {aiBusy === "done" ? "Telling the customer…" : "Mark fixed — tell the customer"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {aiRec.fix.status === "done" ? (
                    <div className={cx("aiWhy")} data-support-fix-told>
                      Fixed · the customer was told {aiRec.fix.doneAt ? filedAt(aiRec.fix.doneAt) : ""}
                      {aiRec.fix.doneBy ? ` by ${aiRec.fix.doneBy}` : ""}.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className={cx("aiWhy")}>The AI hasn&apos;t read this ticket.</div>
          )}
          <div className={cx("replyActs")}>
            <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={askAi} disabled={!!aiBusy} data-support-ask-ai>
              {aiBusy === "ask" ? "The AI is reading…" : aiRec ? "Ask AI again" : "Ask AI for an answer"}
            </button>
            <span className={cx("aiWhy")}>A draft lands in the reply box — nothing is sent. Once anyone on the team writes here, the AI stops answering this ticket on its own.</span>
          </div>
          {aiError ? <Note tone="danger">{aiError}</Note> : null}
        </div>

        {/* Without the task tables (not set up yet) there is nothing to link or make. */}
        {tasksAvailable ? (
          <div className={cx("taskBar")}>
            {task ? (
              <Link href={taskPath(task.id) as Route} className={cx("btn", "btn-ghost", "btn-sm", "taskLink")}>
                <svg className={cx("ic")} aria-hidden="true" focusable="false">
                  <use href="#i-board" />
                </svg>
                <span className={cx("taskLinkTxt")}>Task: {task.title}</span>
              </Link>
            ) : (
              <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={makeTask} disabled={making}>
                <svg className={cx("ic")} aria-hidden="true" focusable="false">
                  <use href="#i-plus" />
                </svg>
                {making ? "Creating…" : "Create task"}
              </button>
            )}
          </div>
        ) : null}

        {error ? <Note tone="danger">{error}</Note> : null}
      </SheetBody>

      <SheetFoot>
        <div className={cx("grow")}>
          <Field label="Status" hint={busy ? "Saving" : undefined}>
            <Select
              value={status}
              onChange={change}
              options={STATUS_OPTIONS}
              disabled={busy}
              ariaLabel="Ticket status"
            />
          </Field>
        </div>
      </SheetFoot>
    </>
  );
}
