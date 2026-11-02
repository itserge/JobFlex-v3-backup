"use client";

// SUPPORT — the customer's tickets with the JobFlex team (Blueprint, 2026-10-17).
// Route: /dashboard/support. Both editions render THIS component — the desk
// inside the blueprint shell, the handheld inside BlueprintHandheldFrame
// (./support-handheld) — with `handheld` choosing the composition:
//
//   · desk: the list of tickets on the left (status, subject, the last message,
//     an unread mark) with "New ticket" in the page head; the open ticket on the
//     right as a chat, the reply box under it. "New ticket" puts the form where
//     the chat was. Quick answers and the other ways to reach us sit folded
//     under the list.
//   · handheld: the list first; a tap opens the chat as a layer under the app's
//     top bar, with a back button and the reply box on the bottom edge.
//
// THE LOGIC IS THE CLASSIC PAGE'S, moved (5c774aaf, 4d35fa2e): filing is
// submitSupportTicket, then the AI's answer is watched for (liveSupportAnswer)
// and the list re-read; a reply is postSupportReply; the open ticket asks
// supportConversation for news every 5 s while the tab is visible; a reply in a
// resolved or closed ticket opens it again (the server decides). ?ticket=<id>
// opens that ticket.
//
// THE UNREAD MARK is this browser's: the last message is ours and arrived after
// the ticket was last open here (localStorage `jf_support_seen`). Nothing on
// the server tracks what a customer has read; on a first visit everything
// counts as seen, so old answers don't light up all at once.
//
// Styles: ./support.css — plain CSS, every selector under `.jf-support` at two
// classes or more (the shell's reset ties single-class rules in production).
// The page head, buttons, cards and status stamps are the shell's shared
// classes (.page-head, .btn, .card, .pstatus); nothing re-paints them.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { postSupportReply, submitSupportTicket, supportConversation } from "@/actions/support";
import { liveSupportAnswer } from "@/actions/supportLive";
import { REPLY_LIMITS, type ThreadMessage } from "@/lib/supportReply";
import { answerBlocks, type AnswerPiece } from "@/lib/support/aiState";
import { relative } from "@/lib/format";
import { toast } from "@/components/ui/Toast";
import "./support.css";

export interface SupportTicketView {
  id: string;
  /** The short reference the letters and the Help window quote. */
  ref: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  /** ISO. */
  createdAt: string;
  /** ISO — the conversation's latest message; the poll's "anything new?" stamp. */
  lastMessageAt: string;
  /** The ticket's own words first, then every message, oldest first. */
  messages: ThreadMessage[];
}

type Category = "technical" | "billing" | "account" | "feature" | "general";
type Priority = "low" | "normal" | "high";

const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "technical", label: "Technical" },
  { key: "billing", label: "Billing" },
  { key: "account", label: "Account" },
  { key: "feature", label: "Feature idea" },
  { key: "general", label: "Something else" },
];
const CATEGORY_LABEL: Record<string, string> = { technical: "Technical", billing: "Billing", account: "Account", feature: "Feature idea", general: "General" };

const PRIORITIES: Array<{ key: Priority; label: string; help: string }> = [
  { key: "low", label: "Low", help: "Whenever you can" },
  { key: "normal", label: "Normal", help: "Standard reply" },
  { key: "high", label: "Urgent", help: "Blocking my work" },
];

/** The four statuses, in the shared stamp's tones (.pstatus--*). */
const STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: "Open", tone: "pstatus--sent" },
  IN_PROGRESS: { label: "In progress", tone: "pstatus--expired" },
  RESOLVED: { label: "Resolved", tone: "pstatus--accepted" },
  CLOSED: { label: "Closed", tone: "pstatus--completed" },
};
function Stamp({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "" };
  return <span className={`pstatus ${s.tone}`}>{s.label}</span>;
}

// Self-serve answers — the classic page's, word for word; they point at the real surfaces.
const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "How do I send a proposal to a client?",
    a: "Build one under Proposals — it creates a shareable link you can email or text. Your client can review, accept, and pay online, and you'll see the status update in real time.",
  },
  {
    q: "When and how do I get paid?",
    a: "Payments run through your connected Stripe, PayPal, or Square account. Accepted proposals show a payment schedule, and you can send a reminder for any installment in one tap.",
  },
  {
    q: "Can I bring in my existing leads?",
    a: "Yes. Open Leads → Import to paste a list, upload a file, or add them by hand. New inquiries also land in the Incoming tab for you to accept or decline.",
  },
  {
    q: "How do I add my crew?",
    a: "Go to Workers and invite by email. Each worker gets a read-only portal showing only the jobs and schedule assigned to them.",
  },
  {
    q: "How do I change my plan or update billing?",
    a: "Company → Subscription shows your current plan and lets you switch. If something looks off, pick Billing as the category and we'll sort it quickly.",
  },
];

/** How often the open conversation asks for news. */
const LIVE_MS = 5_000;

// ── This browser's "seen up to" per ticket ───────────────────────────────────

const SEEN_KEY = "jf_support_seen";
const SEEN_EVENT = "jf:support-seen";
type Seen = Record<string, string>;
// An external store over localStorage (another tab's write arrives as `storage`).
function subscribeSeen(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SEEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SEEN_EVENT, onChange);
  };
}
function seenSnapshot(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
const seenServerSnapshot = () => null;
function parseSeen(raw: string | null): Seen | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Seen;
  } catch {
    return null;
  }
}
function writeSeen(s: Seen) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(SEEN_EVENT));
  } catch {
    /* private window: the mark just won't persist */
  }
}

const Icon = ({ id, className = "ic" }: { id: string; className?: string }) => (
  <svg className={className} aria-hidden="true" focusable="false">
    <use href={`#${id}`} />
  </svg>
);

function lastOf(t: SupportTicketView): ThreadMessage {
  return t.messages[t.messages.length - 1];
}

function firstLine(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

// ── The workspace ────────────────────────────────────────────────────────────

/** "filed": the form was sent; the ticket opens as soon as the re-read list carries it. */
type Pane = { kind: "ticket"; id: string } | { kind: "new" } | { kind: "filed"; id: string } | { kind: "none" };

export function SupportWorkspace({ tickets: initial, openId, handheld }: { tickets: SupportTicketView[]; openId: string | null; handheld: boolean }) {
  const router = useRouter();

  // The server's list, with what this visit learned since (a reply, a poll) laid over it.
  const [live, setLive] = useState<Record<string, Pick<SupportTicketView, "messages" | "status" | "lastMessageAt">>>({});
  const tickets = useMemo(() => {
    const merged = initial.map((t) => {
      const l = live[t.id];
      return l && l.lastMessageAt >= t.lastMessageAt ? { ...t, ...l } : t;
    });
    return merged.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0));
  }, [initial, live]);

  // What is open: the linked ticket; on a desk the newest one, or the form when there is none.
  const [chosen, setPane] = useState<Pane>(() => {
    if (openId && initial.some((t) => t.id === openId)) return { kind: "ticket", id: openId };
    if (handheld) return { kind: "none" };
    return initial.length ? { kind: "ticket", id: initial[0].id } : { kind: "new" };
  });
  const filedIn = chosen.kind === "filed" && initial.some((t) => t.id === chosen.id);
  const pane: Pane = chosen.kind === "filed" ? (filedIn ? { kind: "ticket", id: chosen.id } : { kind: "new" }) : chosen;
  const open = pane.kind === "ticket" ? (tickets.find((t) => t.id === pane.id) ?? null) : null;

  // ?ticket=<id> follows what is open, so a reload or a copied link lands on it.
  const linkedId = pane.kind === "ticket" ? pane.id : null;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("ticket") === linkedId) return;
    if (linkedId) url.searchParams.set("ticket", linkedId);
    else url.searchParams.delete("ticket");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [linkedId]);

  // The unread marks: this browser's "seen up to", the open ticket always seen.
  const seenRaw = useSyncExternalStore(subscribeSeen, seenSnapshot, seenServerSnapshot);
  const seen = useMemo(() => parseSeen(seenRaw), [seenRaw]);
  // A first visit: everything there is counts as seen.
  useEffect(() => {
    if (seenSnapshot() === null) writeSeen(Object.fromEntries(initial.map((t) => [t.id, t.lastMessageAt])));
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openId_ = open?.id ?? null;
  const openAt = open?.lastMessageAt ?? null;
  useEffect(() => {
    if (!openId_ || !openAt || !seen) return;
    if (seen[openId_] && seen[openId_] >= openAt) return;
    writeSeen({ ...seen, [openId_]: openAt });
  }, [openId_, openAt, seen]);
  const isUnread = useCallback(
    (t: SupportTicketView) => {
      if (!seen) return false;
      const last = lastOf(t);
      if (last.from === "customer") return false;
      return !seen[t.id] || seen[t.id] < t.lastMessageAt;
    },
    [seen],
  );

  const keep = useCallback((c: { ticketId: string; messages: ThreadMessage[]; status: string; lastMessageAt: string }) => {
    setLive((m) => ({ ...m, [c.ticketId]: { messages: c.messages, status: c.status, lastMessageAt: c.lastMessageAt } }));
  }, []);

  const openTicket = (id: string) => setPane({ kind: "ticket", id });
  const newTicket = () => setPane({ kind: "new" });
  const back = () => setPane({ kind: "none" });

  // The handheld layer takes focus when it opens (a dialog: Tab starts inside
  // it, Escape closes it); the layer itself, so no ring lands on a button.
  const layerRef = useRef<HTMLDivElement>(null);
  const layerOpen = handheld && pane.kind !== "none";
  useEffect(() => {
    if (layerOpen) layerRef.current?.focus({ preventScroll: true });
  }, [layerOpen]);
  // THE KEYBOARD. A fixed layer is placed against the LAYOUT viewport, which a
  // phone's on-screen keyboard does not shrink (iOS; Chrome on Android since
  // it resizes only the visual viewport) — the reply box would sit under the
  // keys. The visual viewport says how much of the screen is left: the layer's
  // bottom edge rides on top of the keyboard and its top edge follows a
  // page the browser scrolled to keep the caret in view.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = layerRef.current;
    if (!layerOpen || !vv || !el) return;
    const fit = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty("--sup-kb", `${Math.round(kb)}px`);
      el.style.setProperty("--sup-vvtop", `${Math.round(vv.offsetTop)}px`);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, [layerOpen]);

  // Quick answers and the other ways in sit at the foot of the list's own panel,
  // folded, so they never push the two panels past the window.
  const list = (
    <TicketList tickets={tickets} openId={pane.kind === "ticket" ? pane.id : null} isUnread={isUnread} onOpen={openTicket} onNew={newTicket} foot={<HelpExtras />} />
  );

  const paneBody =
    pane.kind === "new" ? (
      <NewTicket
        handheld={handheld}
        canCancel={tickets.length > 0 || handheld}
        onCancel={() => (handheld ? back() : setPane(tickets.length ? { kind: "ticket", id: tickets[0].id } : { kind: "new" }))}
        onFiled={(id) => {
          setPane({ kind: "filed", id });
          router.refresh();
        }}
        filing={chosen.kind === "filed"}
      />
    ) : open ? (
      <Conversation key={open.id} ticket={open} handheld={handheld} onBack={back} onNews={keep} />
    ) : pane.kind === "ticket" ? (
      <>
        {handheld ? <LayerHead title="Ticket" onBack={back} /> : null}
        <div className="sup-empty" role="status">
          That ticket isn&apos;t one of yours, or it is gone.
        </div>
      </>
    ) : null;

  if (handheld) {
    const layer = pane.kind !== "none";
    return (
      <div className="jf-support jf-support--hand" data-support-page data-support-handheld>
        <div className="page-head">
          <div>
            <div className="kicker">Help &amp; support</div>
            <h1 className="page-title">Support</h1>
          </div>
        </div>
        <button type="button" className="btn btn-primary sup-new-wide" onClick={newTicket} data-support-new>
          <Icon id="i-plus" />
          New ticket
        </button>
        {list}
        {layer ? (
          <div
            className="sup-layer"
            role="dialog"
            aria-modal="true"
            aria-label={pane.kind === "new" ? "New ticket" : (open?.subject ?? "Ticket")}
            tabIndex={-1}
            ref={layerRef}
            onKeyDown={(e) => {
              if (e.key === "Escape") back();
            }}
            data-support-layer
          >
            {paneBody}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="jf-support" data-support-page>
      <div className="page-head">
        <div>
          <div className="kicker">Help &amp; support</div>
          <h1 className="page-title">Support</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={newTicket} aria-pressed={pane.kind === "new"} data-support-new>
            <Icon id="i-plus" />
            New ticket
          </button>
        </div>
      </div>
      <div className="sup-grid">
        {list}
        <section className="card sup-pane" aria-label={pane.kind === "new" ? "New ticket" : "Conversation"}>
          {paneBody ?? (
            <div className="sup-empty">
              Pick a ticket to read the conversation, or start a new one.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

function TicketList({
  tickets,
  openId,
  isUnread,
  onOpen,
  onNew,
  foot,
}: {
  tickets: SupportTicketView[];
  openId: string | null;
  isUnread: (t: SupportTicketView) => boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  foot?: ReactNode;
}) {
  return (
    <section className="card sup-list" aria-label="Your tickets">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">Your tickets</div>
          <div className="card-sub">Only you and our team see these.</div>
        </div>
        <span className="tag">{tickets.length}</span>
      </div>
      {tickets.length === 0 ? (
        <div className="empty sup-list-empty">
          No tickets yet.{" "}
          <button type="button" className="sup-textlink" onClick={onNew}>
            Write to us
          </button>{" "}
          — the conversation stays here.
        </div>
      ) : (
        <ul className="sup-rows">
          {tickets.map((t) => {
            const last = lastOf(t);
            const unread = isUnread(t);
            const who = last.from === "customer" ? "You" : "JobFlex";
            return (
              <li key={t.id} className="sup-row-li">
                <button
                  type="button"
                  className={`sup-row${t.id === openId ? " is-open" : ""}${unread ? " is-unread" : ""}`}
                  onClick={() => onOpen(t.id)}
                  aria-current={t.id === openId ? "true" : undefined}
                  data-support-ticket={t.id}
                >
                  <span className="sup-row-top">
                    {unread ? <span className="sup-mark" role="img" aria-label="New answer" data-support-unread /> : null}
                    <span className="sup-row-subj">{t.subject}</span>
                    <Stamp status={t.status} />
                  </span>
                  <span className="sup-row-last">
                    <b>{who}:</b> {firstLine(last.body)}
                  </span>
                  <span className="sup-row-meta">
                    {t.ref} · {relative(new Date(t.lastMessageAt))}
                    {t.priority === "high" ? <span className="sup-urgent">Urgent</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {foot ? <div className="sup-list-foot">{foot}</div> : null}
    </section>
  );
}

// ── Quick answers and the other ways in — folded, at the foot of the list ───

function HelpExtras() {
  return (
    <div className="sup-extras">
      <details className="sup-fold">
        <summary className="sup-fold-sum" data-support-faq>
          <span className="sup-fold-t">Quick answers</span>
          <Icon id="i-chev" className="ic sup-fold-ic" />
        </summary>
        <div className="sup-faq">
          {FAQS.map((f) => (
            <details key={f.q} className="sup-faq-item">
              <summary className="sup-faq-q">
                <span>{f.q}</span>
                <Icon id="i-chev" className="ic sup-fold-ic" />
              </summary>
              <p className="sup-faq-a">{f.a}</p>
            </details>
          ))}
        </div>
      </details>
      <div className="sup-reach">
        <span className="sup-reach-lbl">Other ways to reach us</span>
        <span>
          Email <a href="mailto:support@jobflex.app">support@jobflex.app</a> · typically within one business day, Mon–Fri.
        </span>
      </div>
    </div>
  );
}

// ── The handheld layer's head: back, then what is open ──────────────────────

function LayerHead({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="sup-lhead">
      <button type="button" className="sup-back" onClick={onBack} aria-label="Back to your tickets" data-support-back>
        <Icon id="i-chev" className="ic sup-back-ic" />
      </button>
      <div className="sup-lhead-txt">
        <div className="sup-lhead-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ── The open ticket: the chat ────────────────────────────────────────────────

function Conversation({
  ticket,
  handheld,
  onBack,
  onNews,
}: {
  ticket: SupportTicketView;
  handheld: boolean;
  onBack: () => void;
  onNews: (c: { ticketId: string; messages: ThreadMessage[]; status: string; lastMessageAt: string }) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reopens = ticket.status === "RESOLVED" || ticket.status === "CLOSED";

  // THE LIVE CONVERSATION — only while open and the tab is visible; one cheap read ("changed since?").
  const stamp = useRef({ lastAt: ticket.lastMessageAt, status: ticket.status });
  useEffect(() => {
    stamp.current = { lastAt: ticket.lastMessageAt, status: ticket.status };
  }, [ticket.lastMessageAt, ticket.status]);
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await supportConversation(ticket.id, stamp.current.lastAt, stamp.current.status);
        if (r && "messages" in r) onNews(r);
      } catch {
        /* offline: the next tick retries */
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), LIVE_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ticket.id, onNews]);

  // The newest message in view: on opening, and whenever one arrives. The
  // chat STICKS to its bottom while the reader is there: whatever grows the
  // messages afterwards — the web font settling, the reply box growing, the
  // window resizing, the keyboard — keeps the last one in view. Scrolled up
  // to read, it stays where the reader left it.
  //
  // The bottom is reached by asking for far past it and letting the browser
  // clamp: under the shell's root `zoom` (FLUID SCALE, above 1 on big
  // screens) scrollTop and scrollHeight are not in the same units, so
  // `scrollTop = scrollHeight` stopped short of the last two messages at
  // 1920×1080. "At the bottom" is likewise measured against where that
  // clamp landed, never against scrollHeight.
  const innerRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const bottomAt = useRef(0);
  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 1e9;
    bottomAt.current = el.scrollTop;
    stick.current = true;
  }, []);
  const count = ticket.messages.length;
  useEffect(() => {
    toBottom();
  }, [count, toBottom]);
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const onScroll = () => {
      stick.current = el.scrollTop >= bottomAt.current - 24;
    };
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    ro.observe(inner);
    ro.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [toBottom]);

  async function send() {
    const body = draft.trim();
    if (sending || body.length < REPLY_LIMITS.min) return;
    setSending(true);
    setError(null);
    try {
      const r = await postSupportReply(ticket.id, body);
      if (r.ok) {
        setDraft("");
        onNews(r.conversation);
      } else setError(r.error);
    } catch {
      setError("Your message didn't go. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  const meta = (
    <div className="sup-chat-meta">
      <Stamp status={ticket.status} />
      <span>
        {ticket.ref} · {CATEGORY_LABEL[ticket.category] ?? "General"}
        {ticket.priority === "high" ? " · Urgent" : ""}
      </span>
    </div>
  );

  return (
    <div className="sup-chat" data-support-conversation={ticket.id}>
      {handheld ? (
        <LayerHead title={ticket.subject} onBack={onBack}>
          {meta}
        </LayerHead>
      ) : (
        <div className="sup-chat-head">
          <h2 className="sup-chat-title">{ticket.subject}</h2>
          {meta}
        </div>
      )}

      <div ref={scrollRef} className="sup-msgs" role="log" aria-label="Conversation" aria-live="polite">
        <div ref={innerRef} className="sup-msgs-in">
          {ticket.messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </div>
      </div>

      <div className="sup-compose">
        <label className="sup-lbl" htmlFor={`reply-${ticket.id}`}>
          Reply
        </label>
        <textarea
          id={`reply-${ticket.id}`}
          className="sup-in sup-ta"
          rows={handheld ? 2 : 3}
          value={draft}
          maxLength={REPLY_LIMITS.body}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={reopens ? "Write here and the ticket opens again." : "Write your reply…"}
          disabled={sending}
          data-support-reply-text
        />
        <div className="sup-compose-row">
          <span className="sup-note">{reopens ? "This ticket is closed — your reply opens it again." : "We get it at once, and answer here and by email."}</span>
          <button type="button" className="btn btn-primary sup-send" onClick={send} disabled={sending || draft.trim().length < REPLY_LIMITS.min} data-support-send>
            <Icon id="i-send" />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {error ? (
          <p className="sup-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One message: yours on the right; ours and the AI's — signed JobFlex support — on the left, on a blueprint rule. */
/** One paragraph of our answer: words, line breaks, JobFlex's own links. */
function AnswerPieces({ parts }: { parts: AnswerPiece[] }) {
  return (
    <>
      {parts.map((piece, j) =>
        "br" in piece ? (
          <br key={j} />
        ) : "path" in piece ? (
          <Link key={j} href={piece.path as Route} className="sup-textlink">
            {piece.label}
          </Link>
        ) : (
          <span key={j}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function Bubble({ m }: { m: ThreadMessage }) {
  const mine = m.from === "customer";
  return (
    <div className={`sup-msg ${mine ? "sup-msg--mine" : "sup-msg--ours"}`} data-support-message={m.from}>
      <div className="sup-msg-meta">
        <span className="sup-msg-who">{mine ? "You" : "JobFlex support"}</span>
        <time dateTime={m.at}>{relative(new Date(m.at))}</time>
        {m.channel === "email" ? <span className="sup-msg-ch">by email</span> : null}
      </div>
      {mine ? (
        <p className="sup-msg-body">{m.body}</p>
      ) : (
        // Our answers: paragraphs and cards ("[offer]" / "[note]"), JobFlex's own links clickable (the Help window's rule).
        <div className="sup-msg-body">
          {answerBlocks(m.body).map((b, i) =>
            b.kind === "text" ? (
              <p key={i}>
                <AnswerPieces parts={b.parts} />
              </p>
            ) : (
              <div key={i} className={`sup-card sup-card--${b.kind}`} data-support-card={b.kind}>
                <b>{b.title}</b>
                {b.parts.length ? (
                  <p>
                    <AnswerPieces parts={b.parts} />
                  </p>
                ) : null}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ── A new ticket: the form, where the chat was ───────────────────────────────

function NewTicket({
  handheld,
  canCancel,
  onCancel,
  onFiled,
  filing,
}: {
  handheld: boolean;
  canCancel: boolean;
  onCancel: () => void;
  onFiled: (id: string) => void;
  filing: boolean;
}) {
  const router = useRouter();
  // The watch for the support AI's answer to the ticket just filed: stopped on
  // unmount, and replaced if another ticket is filed meanwhile.
  const watch = useRef<{ stop: boolean; timer: number } | null>(null);
  useEffect(
    () => () => {
      if (watch.current) {
        watch.current.stop = true;
        window.clearTimeout(watch.current.timer);
      }
    },
    [],
  );
  const watchForAnswer = useCallback(
    (id: string, ref: string) => {
      if (watch.current) {
        watch.current.stop = true;
        window.clearTimeout(watch.current.timer);
      }
      const w = { stop: false, timer: 0 };
      watch.current = w;
      const started = Date.now();
      const ask = async () => {
        try {
          const live = await liveSupportAnswer(id);
          if (w.stop) return;
          if (live.state === "answer") {
            router.refresh();
            toast.success("We answered your ticket", `Reference ${ref} — it's in the conversation, and in your email.`);
            return;
          }
          if (live.state === "held") {
            router.refresh();
            toast.info("We're on it", `Reference ${ref}. A member of our team is looking into it personally.`);
            return;
          }
          if (live.state === "none") return;
        } catch {
          /* ask again */
        }
        if (w.stop || Date.now() - started > 90_000) return;
        w.timer = window.setTimeout(ask, 2_000);
      };
      w.timer = window.setTimeout(ask, 1_200);
    },
    [router],
  );

  const [category, setCategory] = useState<Category>("technical");
  const [priority, setPriority] = useState<Priority>("normal");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});
  const [busy, setBusy] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: { subject?: string; body?: string } = {};
    if (!subject.trim()) next.subject = "Add a subject so we know what to look at.";
    if (!body.trim()) next.body = "Tell us what's going on.";
    setErrors(next);
    if (next.subject) return subjectRef.current?.focus();
    if (next.body) return bodyRef.current?.focus();
    setBusy(true);
    try {
      const filed = await submitSupportTicket({ subject: subject.trim(), body: body.trim(), category, priority });
      // What happened, not what usually happens: the action reports whether the
      // operator alert went out. The ticket is filed either way.
      watchForAnswer(filed.id, filed.ref);
      if (filed.notified) toast.success("Ticket filed", `Reference ${filed.ref}. Our team has been alerted by email.`);
      else toast.info("Ticket filed", `Reference ${filed.ref}. The email alert didn't go out — quote this reference if you follow up.`);
      setSubject("");
      setBody("");
      setCategory("technical");
      setPriority("normal");
      onFiled(filed.id);
    } catch (err: unknown) {
      toast.error("Couldn't send", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <>
      <div className="sup-field">
        <label className="sup-lbl" htmlFor="sup-subject">
          Subject
        </label>
        <input
          ref={subjectRef}
          id="sup-subject"
          className="sup-in"
          value={subject}
          maxLength={200}
          onChange={(e) => {
            setSubject(e.target.value);
            if (errors.subject) setErrors((p) => ({ ...p, subject: undefined }));
          }}
          aria-invalid={errors.subject ? true : undefined}
          aria-describedby={errors.subject ? "sup-subject-err" : undefined}
          placeholder="Can't send a proposal"
          data-support-subject
        />
        {errors.subject ? (
          <span className="sup-err" id="sup-subject-err">
            {errors.subject}
          </span>
        ) : null}
      </div>

      {/* The category the customer picks is mirrored straight into admin triage. */}
      <div className="sup-field" role="group" aria-labelledby="sup-cat-lbl">
        <span className="sup-lbl" id="sup-cat-lbl">
          What&apos;s it about?
        </span>
        <div className="sup-seg sup-seg--wrap">
          {CATEGORIES.map((c) => (
            <button key={c.key} type="button" className="sup-seg-btn" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sup-field" role="group" aria-labelledby="sup-pri-lbl">
        <span className="sup-lbl" id="sup-pri-lbl">
          How urgent is it?
        </span>
        <div className="sup-seg sup-seg--3">
          {PRIORITIES.map((p) => (
            <button key={p.key} type="button" className="sup-seg-btn sup-seg-btn--two" aria-pressed={priority === p.key} onClick={() => setPriority(p.key)}>
              <b>{p.label}</b>
              <span>{p.help}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sup-field">
        <label className="sup-lbl" htmlFor="sup-body">
          Message
        </label>
        <textarea
          ref={bodyRef}
          id="sup-body"
          className="sup-in sup-ta"
          rows={handheld ? 6 : 7}
          value={body}
          maxLength={5000}
          onChange={(e) => {
            setBody(e.target.value);
            if (errors.body) setErrors((p) => ({ ...p, body: undefined }));
          }}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? "sup-body-err" : undefined}
          placeholder="Describe what happened, what you expected, and any error you saw."
          data-support-body
        />
        {errors.body ? (
          <span className="sup-err" id="sup-body-err">
            {errors.body}
          </span>
        ) : null}
      </div>
    </>
  );

  const actions = (
    <div className="sup-form-foot">
      <span className="sup-note">Only you and our team can see this.</span>
      <div className="sup-form-acts">
        {canCancel && !handheld ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary sup-send" disabled={busy || filing} data-support-file>
          <Icon id="i-send" />
          {busy ? "Sending…" : filing ? "Opening…" : "Send"}
        </button>
      </div>
    </div>
  );

  return (
    <form className="sup-form" onSubmit={submit} noValidate data-support-form>
      {handheld ? (
        <LayerHead title="New ticket" onBack={onCancel} />
      ) : (
        <div className="sup-chat-head">
          <h2 className="sup-chat-title">New ticket</h2>
          <div className="sup-chat-meta">
            <span>The more you tell us, the faster we can help. You&apos;ll get our answer here and by email.</span>
          </div>
        </div>
      )}
      <div className="sup-form-body">{fields}</div>
      {actions}
    </form>
  );
}
