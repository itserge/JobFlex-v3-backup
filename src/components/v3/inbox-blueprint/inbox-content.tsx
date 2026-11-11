"use client";

// THE INBOX — THE PAGE (Smart CRM part 2, 2026-11-08; the approved design "JobFlex Smart CRM — design", Inbox
// artboard). Three columns on a desk, stacked on a phone:
//
//   THREADS   one row per client, newest first: name, the last line, when, the channel and the stamps (urgent,
//             unread, needs answer, waiting on them). Filter chips across the top — the plan's words — with counts.
//   THREAD    the conversation, oldest first, every channel in one line of talk: texts, emails (words kept), desk
//             calls (their summary), portal notes. Under it the answer box: Email or Text, three AI drafts on
//             request, Send. Nothing sends on its own.
//   MEANING   the AI's reading of their newest message: intent, what they want, what changed, deadlines, money,
//             complaints, promises, one suggested step — marked AI, with what it read; and what the memory holds.
//
// Writes go through src/actions/inbox; after each the server view is refreshed.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { INBOX_FILTERS } from "@/lib/inbox/shared";
import { inboxDrafts, sendInboxReply, setInboxStatus, setInboxUrgent, takeInboxThread } from "@/actions/inbox";
import type { InboxOpen, InboxView } from "./inbox-load";
import styles from "./inbox.module.css";
import { ContactStops } from "@/components/v3/contact-stops/contact-stops";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

const CHANNEL_WORD: Record<string, string> = { EMAIL: "Email", SMS: "Text", CALL: "Call", PORTAL: "Portal", NOTE: "Note" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-26" → "Nov 26" — read off the string, so no timezone can move the day. */
const dayWord = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}` : iso;
};

export function InboxContent({ view }: { view: InboxView }) {
  const router = useRouter();
  const go = (f: string, t?: string | null) => router.push(`/dashboard/inbox?f=${f}${t ? `&t=${t}` : ""}` as Route);
  return (
    <div className={styles.page} data-inbox="">
      <div className={cx("page-head", styles.head)}>
        <div>
          <div className="kicker">CRM</div>
          <h1 className="page-title">Inbox</h1>
        </div>
        <div className={styles.headNote}>One thread per client — texts, email, calls and portal messages</div>
      </div>

      {!view.receiving ? (
        <div className={styles.notice} role="note">
          Email replies arrive here once receiving is switched on (one DNS record and one Resend setting). Texts and calls already do.
        </div>
      ) : null}

      <div className={styles.filters} role="group" aria-label="Filter threads">
        {INBOX_FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={view.filter === f.key} className={cx(styles.filter, view.filter === f.key && styles.filterOn, f.key === "urgent" && view.counts.urgent > 0 && styles.filterHot)} onClick={() => go(f.key)} data-inbox-filter={f.key}>
            {f.label}
            <span className={styles.filterN}>{view.counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className={styles.cols}>
        <section className={cx(styles.card, styles.list)} aria-label="Threads">
          {view.threads.length === 0 ? (
            <p className={styles.empty}>{view.filter === "all" ? "No conversations yet. Client texts, email replies and calls land here." : "Nothing in this filter."}</p>
          ) : (
            view.threads.map((t) => (
              <button key={t.id} type="button" className={cx(styles.row, view.open?.id === t.id && styles.rowOn)} onClick={() => go(view.filter, t.id)} data-thread-row={t.id}>
                <span className={styles.rowTop}>
                  <b className={styles.rowName}>{t.name}</b>
                  <span className={styles.rowWhen}>{t.when}</span>
                </span>
                <span className={styles.rowPrev}>{t.preview || "—"}</span>
                <span className={styles.stamps}>
                  {t.urgent ? <span className={cx(styles.stamp, styles.bad)}>Urgent</span> : null}
                  {t.channel ? <span className={styles.stamp}>{CHANNEL_WORD[t.channel] ?? t.channel}</span> : null}
                  {t.status === "NEEDS_REPLY" ? <span className={cx(styles.stamp, styles.warn)}>Needs answer</span> : null}
                  {t.status === "WAITING" ? <span className={cx(styles.stamp, styles.good)}>Waiting on them</span> : null}
                  {t.mine ? <span className={cx(styles.stamp, styles.accent)}>Mine</span> : null}
                </span>
                {t.unread > 0 ? <span className={styles.dot} aria-label={`${t.unread} unread`} /> : null}
              </button>
            ))
          )}
        </section>

        {view.open ? <Thread key={view.open.id} open={view.open} /> : <section className={cx(styles.card, styles.thread)}><p className={styles.empty}>Pick a conversation.</p></section>}

        {view.open ? <Meaning open={view.open} /> : null}
      </div>
    </div>
  );
}

function Thread({ open }: { open: InboxOpen }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [channel, setChannel] = useState<"EMAIL" | "SMS">(open.canText && (open.messages.at(-1)?.channel === "SMS" || !open.canEmail) ? "SMS" : "EMAIL");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Array<{ label: string; text: string }> | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; words: string } | null>(null);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const r = await sendInboxReply({ threadId: open.id, channel, body });
      if (r.ok) {
        setText("");
        setDrafts(null);
        setNote(r.note ? { tone: "ok", words: r.note } : { tone: "ok", words: "Sent." });
        router.refresh();
      } else setNote({ tone: "bad", words: r.error ?? "Not sent." });
    });
  };
  const askDrafts = async () => {
    setDrafting(true);
    setNote(null);
    const r = await inboxDrafts(open.id);
    setDrafting(false);
    if (r.ok) setDrafts(r.drafts);
    else setNote({ tone: "bad", words: "No drafts right now — the AI didn't answer. Write it yourself or try again." });
  };
  const lever = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <section className={cx(styles.card, styles.thread)} aria-label={`Conversation with ${open.name}`}>
      <div className={styles.threadHead}>
        <div className={styles.threadWho}>
          <div className={styles.threadName}>{open.name}</div>
          <div className={styles.threadMeta}>{[open.phone, open.email].filter(Boolean).join(" · ") || "No contact on file"}</div>
        </div>
        <div className={styles.threadActs}>
          {open.clientId ? (
            <button type="button" className="btn btn-ghost btn--sm" onClick={() => router.push(`/dashboard/client-detail?client=${open.clientId}` as Route)}>
              Open client
            </button>
          ) : null}
          {!open.mine ? (
            <button type="button" className="btn btn-ghost btn--sm" disabled={busy} onClick={() => lever(() => takeInboxThread(open.id))}>
              Take it
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn--sm" disabled={busy} onClick={() => lever(() => setInboxUrgent(open.id, !open.urgent))} data-thread-urgent>
            {open.urgent ? "Not urgent" : "Urgent"}
          </button>
          <button type="button" className="btn btn-ghost btn--sm" disabled={busy} onClick={() => lever(() => setInboxStatus(open.id, open.status === "CLOSED" ? "OPEN" : "CLOSED"))} data-thread-close>
            {open.status === "CLOSED" ? "Reopen" : "Close"}
          </button>
        </div>
      </div>
      {/* "Don't email" · "Don't text" for the client behind the thread (2026-11-11). */}
      {open.clientId ? <ContactStops key={open.clientId} clientId={open.clientId} variant="strip" /> : null}

      <div className={styles.talk} data-thread-talk="">
        {open.messages.length === 0 ? (
          <p className={styles.empty}>Nothing said yet.</p>
        ) : (
          open.messages.map((m) => (
            <div key={m.id} className={cx(styles.bubble, m.direction === "OUT" ? styles.out : styles.in)} data-msg={m.direction}>
              {m.subject && m.channel === "EMAIL" && m.subject !== m.body ? <div className={styles.subject}>{m.subject}</div> : null}
              <div className={styles.body}>{m.body}</div>
              {m.attachments.length ? (
                <div className={styles.files}>
                  {m.attachments.map((a) => (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                      {a.name}
                    </a>
                  ))}
                </div>
              ) : null}
              <div className={styles.meta}>
                {m.direction === "OUT" ? "You" : open.name} · {CHANNEL_WORD[m.channel] ?? m.channel} · {m.when}
                {m.detail ? ` · ${m.detail}` : ""}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.answer}>
        <div className={styles.answerTop}>
          <div className={styles.seg} role="group" aria-label="Answer by">
            <button type="button" aria-pressed={channel === "EMAIL"} className={cx(styles.segBtn, channel === "EMAIL" && styles.segOn)} disabled={!open.canEmail} onClick={() => setChannel("EMAIL")}>
              Email
            </button>
            <button type="button" aria-pressed={channel === "SMS"} className={cx(styles.segBtn, channel === "SMS" && styles.segOn)} disabled={!open.canText} onClick={() => setChannel("SMS")} title={open.canText ? undefined : "Needs their phone and your company's texting number"}>
              Text
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn--sm" onClick={askDrafts} disabled={drafting} data-inbox-drafts>
            {drafting ? "Writing drafts…" : "3 drafts"}
          </button>
        </div>
        {drafts && drafts.length ? (
          <div className={styles.drafts} aria-label="Reply drafts">
            {drafts.map((d, i) => (
              <button key={i} type="button" className={styles.draft} onClick={() => setText(d.text)} data-inbox-draft={i}>
                <b>{d.label}</b>
                <span>{d.text}</span>
              </button>
            ))}
            <div className={styles.draftNote}>AI drafts from their history — pick one, edit it, then send.</div>
          </div>
        ) : null}
        <label className={styles.srOnly} htmlFor="inboxAnswer">
          Your answer
        </label>
        <textarea id="inboxAnswer" className={styles.box} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={open.canEmail || open.canText ? `Answer ${open.name.split(" ")[0]} by ${channel === "EMAIL" ? "email" : "text"}…` : "No email or phone on file — add one on the client's page."} data-inbox-box />
        <div className={styles.answerFoot}>
          {note ? <span className={note.tone === "ok" ? styles.ok : styles.err} role="status">{note.words}</span> : <span />}
          <button type="button" className="btn btn-primary btn--sm" onClick={send} disabled={busy || !text.trim() || (channel === "EMAIL" ? !open.canEmail : !open.canText)} data-inbox-send>
            {busy ? "Sending…" : channel === "EMAIL" ? "Send email" : "Send text"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Meaning({ open }: { open: InboxOpen }) {
  const r = open.read;
  const rows = useMemo(() => {
    if (!r) return [];
    const out: Array<{ k: string; v: string; tone?: "warn" | "bad" }> = [];
    if (r.intent) out.push({ k: "Intent", v: r.intent });
    for (const x of r.requests) out.push({ k: "Asks for", v: x });
    for (const x of r.changes) out.push({ k: "Change", v: x, tone: "warn" });
    for (const d of r.deadlines) out.push({ k: "Deadline", v: d.date ? `${d.what} → ${dayWord(d.date)}` : d.what });
    for (const x of r.questions) out.push({ k: "Question", v: x });
    for (const x of r.money) out.push({ k: "Money", v: x });
    for (const x of r.complaints) out.push({ k: "Complaint", v: x, tone: "bad" });
    for (const p of r.promises) out.push({ k: "They promise", v: p.due ? `${p.text} — by ${dayWord(p.due)}` : p.text });
    return out;
  }, [r]);
  return (
    <aside className={cx(styles.card, styles.meaning)} aria-label="What this means" data-inbox-meaning={r ? "read" : "none"}>
      <div className={styles.meaningHead}>
        <span className={styles.meaningTitle}>What this means</span>
        <span className={styles.aiStamp}>AI read</span>
      </div>
      {r ? (
        <>
          {r.summary ? <p className={styles.summary}>{r.summary}</p> : null}
          {rows.map((row, i) => (
            <div key={i} className={styles.mRow}>
              <span className={styles.mKey}>{row.k}</span>
              <span className={cx(styles.mVal, row.tone === "warn" && styles.warnTxt, row.tone === "bad" && styles.badTxt)}>{row.v}</span>
            </div>
          ))}
          {r.suggested ? (
            <div className={styles.suggest}>
              <span className={styles.mKey}>Suggested</span>
              <span className={styles.mVal}>{r.suggested}</span>
            </div>
          ) : null}
          <p className={styles.source}>
            Read from their {(CHANNEL_WORD[r.channel] ?? "message").toLowerCase()}
            {r.when ? `, ${r.when}` : ""} — an AI reading, not a record. The original stays in the thread.
          </p>
        </>
      ) : (
        <p className={styles.empty}>Their next message is read here: what they want, what changed, any deadline or promise.</p>
      )}
      {open.facts.length ? (
        <div className={styles.memory}>
          <span className={styles.meaningTitle}>Memory</span>
          {open.facts.map((f, i) => (
            <div key={i} className={styles.mRow}>
              <span className={styles.mKey}>{f.category.toLowerCase()}</span>
              <span className={styles.mVal}>{f.fact}</span>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
