"use client";

// SMARTBOOK · ON THE LEAD PAGE (2026-10-31, Batch 3). Where SmartBook stands with this lead in one line and a stamp
// (the leads list's word), the request waiting on the company with its three answers, the times on offer, what
// happens next, the conversation both ways — and the person's own controls: Pause SmartBook (a person takes it from
// here), Restart (fresh times again), Offer times (a lead SmartBook didn't start by itself). The page reads the first
// view on the server; every button reads it again (actions/smartBookOffice).
import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CalendarCheck } from "lucide-react";
import { loadLeadSmartBook, offerLeadTimes, pauseLeadSmartBook, restartLeadSmartBook } from "@/actions/smartBookOffice";
import type { LeadSmartBook as View } from "@/lib/smartbook/office";
import { RequestAnswer } from "./request-answer";
import styles from "./smartbook.module.css";

const SHOWN = 6;

export function LeadSmartBook({ leadId, initial, className }: { leadId: string; initial: View; className?: string }) {
  const [view, setView] = useState<View>(initial);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<string | null>(null);

  const run = (what: string, fn: (id: string) => Promise<{ ok: true; view: View | null } | { ok: false; error: string }>) =>
    start(async () => {
      setWhich(what);
      setError(null);
      const r = await fn(leadId);
      if (r.ok) {
        if (r.view) setView(r.view);
      } else {
        setError(r.error);
        const again = await loadLeadSmartBook(leadId);
        if (again.ok && again.view) setView(again.view);
      }
    });
  const reload = () =>
    start(async () => {
      const again = await loadLeadSmartBook(leadId);
      if (again.ok && again.view) setView(again.view);
    });

  const lines = all ? view.lines : view.lines.slice(-SHOWN);
  const busy = (w: string) => (pending && which === w ? "true" : undefined);

  return (
    <section className={className} aria-labelledby="sbLeadT">
      <div className={`${styles.sb} ${styles.leadCard}`} data-nest data-lead-smartbook>
        <div className={styles.lcHead}>
          <h2 className={styles.lcTitle} id="sbLeadT">
            <CalendarCheck size={16} aria-hidden="true" />
            SmartBook
          </h2>
          {view.chip ? (
            <span className={styles.stamp} data-tone={view.chip.tone === "muted" ? undefined : view.chip.tone} data-smartbook-chip={view.chip.key}>
              {view.chip.label}
            </span>
          ) : null}
        </div>

        <p className={styles.lcLine} data-smartbook-headline>
          {view.headline}
        </p>

        {view.offers.length ? (
          <ol className={styles.lcTimes} aria-label="Times on offer">
            {view.offers.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        ) : null}

        {view.started ? (
          <div className={styles.lcFacts}>
            {view.channel ? <span>{view.channel === "text" ? "By text — they said yes to texts." : "By email — no yes to texts yet."}</span> : null}
            {view.next ? <span>Next: {view.next}.</span> : null}
          </div>
        ) : !view.on ? (
          <p className={styles.lcFacts}>
            <span>
              SmartBook isn&rsquo;t answering new leads on its own yet — <Link href={"/dashboard/settings?tab=smartbook" as Route}>turn it on in Settings</Link>. You can still offer this lead times.
            </span>
          </p>
        ) : (
          <p className={styles.lcFacts}>
            <span>It answers new leads from the sources you picked. This one came another way — offer times and it takes it from there.</span>
          </p>
        )}

        {view.request ? (
          <div className={styles.lcBox}>
            <RequestAnswer card={view.request} linkName={false} onDone={() => reload()} />
          </div>
        ) : null}

        {view.lines.length ? (
          <div className={styles.lcBox}>
            <span className={styles.label}>The conversation</span>
            <div className={styles.talk} data-smartbook-talk>
              {lines.map((l) =>
                l.dir === "note" ? (
                  <p key={l.id} className={styles.msgNote}>
                    {l.text} · {l.when}
                  </p>
                ) : (
                  <div key={l.id} className={styles.msg} data-dir={l.dir}>
                    <span className={styles.msgMeta}>
                      {l.dir === "in" ? "Them" : "SmartBook"}
                      {l.channel ? ` · ${l.channel === "page" ? "their page" : l.channel === "call" ? "phone" : l.channel}` : ""} · {l.when}
                    </span>
                    <span>{l.text}</span>
                  </div>
                ),
              )}
            </div>
            {view.lines.length > SHOWN ? (
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => setAll((v) => !v)}>
                {all ? "Show the latest only" : `Show all ${view.lines.length}`}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={styles.lcBox}>
          <div className={styles.acts}>
            {view.can.offer ? (
              <button className={`${styles.btn} ${styles.btnP}`} type="button" disabled={pending || !!view.blocked} aria-busy={busy("offer")} data-smartbook-offer onClick={() => run("offer", offerLeadTimes)}>
                Offer times
              </button>
            ) : null}
            {view.can.restart ? (
              <button className={`${styles.btn} ${styles.btnP}`} type="button" disabled={pending} aria-busy={busy("restart")} data-smartbook-restart onClick={() => run("restart", restartLeadSmartBook)}>
                Restart — send new times
              </button>
            ) : null}
            {view.can.pause ? (
              <button className={`${styles.btn} ${styles.btnDanger}`} type="button" disabled={pending} aria-busy={busy("pause")} data-smartbook-pause onClick={() => run("pause", pauseLeadSmartBook)}>
                Pause SmartBook
              </button>
            ) : null}
            {view.page ? (
              <a className={`${styles.btn} ${styles.btnQuiet}`} href={view.page} target="_blank" rel="noopener noreferrer">
                See their page ↗
              </a>
            ) : null}
          </div>
          {view.blocked ? <p className={styles.help}>{view.blocked}</p> : null}
          {view.can.pause ? <p className={styles.help}>Pause when you&rsquo;d rather talk to them yourself — SmartBook stops, and their replies come to you.</p> : null}
          {error ? (
            <p className={styles.err} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
