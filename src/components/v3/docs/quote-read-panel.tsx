"use client";
// WHAT THE AI READ (2026-11-08, the subcontractors plan, part 2): the viewer's side panel for an estimate — every
// figure the reader found with the line it came from and how sure it was, the terms in the document's own words, the
// flags, and the human review: Use these (the total becomes the version's price), Not right (set aside), Read again.
// Everything shown is labelled as coming from the document; nothing here acts on its own.

import { useState } from "react";
import { acceptQuoteRead, readQuoteVersionNow, rejectQuoteRead } from "@/actions/projectSubs";
import { dollars } from "@/lib/projectSubs/shared";
import { REVIEW_LABEL, readSummary, reviewStatusOf, type QuoteRead, type StoredRead } from "@/lib/subQuotes/shared";
import s from "./quote-read-panel.module.css";

export type ReadVersion = {
  id: string;
  version: number;
  amount: number | null;
  reviewStatus: string;
  readError: string | null;
  readAttempts: number;
  reviewedAt: string | null;
  read: StoredRead | null;
  document: { name: string } | null;
};

const FIGURES: Array<{ key: keyof Pick<QuoteRead, "total" | "labor" | "materials" | "taxes" | "permits" | "deposit">; label: string }> = [
  { key: "total", label: "Total" },
  { key: "labor", label: "Labor" },
  { key: "materials", label: "Materials" },
  { key: "taxes", label: "Taxes" },
  { key: "permits", label: "Permits" },
  { key: "deposit", label: "Deposit" },
];

const CONF: Record<"high" | "medium" | "low", string> = { high: "sure", medium: "likely", low: "unsure" };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function QuoteReadPanel({ version, canManage, onChanged }: { version: ReadVersion; canManage: boolean; onChanged?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const status = reviewStatusOf(version.reviewStatus);
  const stored = version.read;
  const read = stored?.read ?? null;

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (words) setNote(words);
      onChanged?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={s.panel} data-quote-read data-quote-read-status={status}>
      <div className={s.head}>
        <span className={s.title}>What the AI read</span>
        <span className={`${s.pill} ${status === "READ" ? s.pillWait : status === "REVIEWED" ? s.pillIn : status === "FAILED" || status === "REJECTED" ? s.pillLate : ""}`} data-quote-read-pill>
          {REVIEW_LABEL[status]}
        </span>
      </div>
      <p className={s.meta}>
        V{version.version}
        {stored ? ` · ${stored.from === "text" ? "from the PDF's words" : stored.from === "pdf" ? "from the scanned pages" : "from the picture"}${stored.pages ? ` · ${stored.pages} page${stored.pages === 1 ? "" : "s"}` : ""}${stored.at ? ` · ${when(stored.at)}` : ""}` : ""}
        {version.reviewedAt && status === "REVIEWED" ? ` · used ${when(version.reviewedAt)}` : ""}
      </p>

      {status === "PENDING" && !read ? <p className={s.state}>Reading {version.document?.name ?? "the document"}… the figures appear here in a minute.</p> : null}
      {status === "NONE" ? <p className={s.state}>No document to read on this version.</p> : null}
      {status === "FAILED" ? <p className={`${s.state} ${s.bad}`}>Could not read it{version.readError ? `: ${version.readError}` : "."}</p> : null}

      {read ? (
        <>
          <p className={s.about}>{read.about}</p>
          <div className={s.figures}>
            {FIGURES.map((f) => {
              const fig = read[f.key];
              return (
                <div key={f.key} className={s.fig} data-quote-read-figure={f.key}>
                  <span className={s.lbl}>{f.label}</span>
                  <span className={s.val} data-quote-read-value>{fig.value != null ? dollars(fig.value) : "—"}</span>
                  <span className={s.src}>{fig.value != null ? `${CONF[fig.confidence]}${fig.source ? ` · “${fig.source}”` : ""}` : "not in the document"}</span>
                </div>
              );
            })}
          </div>
          <dl className={s.terms}>
            {read.scope ? <Term label="Scope" value={read.scope} /> : null}
            {read.exclusions.length ? <Term label="Exclusions" value={read.exclusions.join("; ")} /> : null}
            {read.paymentSchedule ? <Term label="Payment schedule" value={read.paymentSchedule} /> : null}
            {read.duration || read.start ? <Term label="Timeline" value={[read.duration, read.start ? `start ${read.start}` : null].filter(Boolean).join(" · ")} /> : null}
            {read.warranty ? <Term label="Warranty" value={read.warranty} /> : null}
            {read.validUntil ? <Term label="Valid until" value={read.validUntil} /> : null}
            {read.conditions.length ? <Term label="Conditions" value={read.conditions.join("; ")} /> : null}
            {read.proposalNumber || read.date ? <Term label="Document" value={[read.proposalNumber ? `#${read.proposalNumber}` : null, read.date].filter(Boolean).join(" · ")} /> : null}
          </dl>
          {read.flags.length ? (
            <ul className={s.flags} data-quote-read-flags>
              {read.flags.map((f, i) => (
                <li key={i} data-quote-read-flag>
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
          <p className={s.summary} data-quote-read-summary>
            {readSummary(read)}
            {version.amount != null && read.total.value != null && Math.abs(version.amount - read.total.value) > 0.5 ? ` — the version says ${dollars(version.amount)}` : ""}
          </p>
        </>
      ) : null}

      {note ? (
        <p className={s.note} role="status" data-quote-read-note>
          {note}
        </p>
      ) : null}

      {canManage ? (
        <div className={s.acts}>
          {read && (status === "READ" || status === "REJECTED") ? (
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void run("use", async () => { const r = await acceptQuoteRead(version.id); return r.amount != null ? `Used — the price is ${dollars(r.amount)}.` : "Used — the document states no total; the price stays as typed."; })} data-quote-read-use>
              Use these
            </button>
          ) : null}
          {read && status === "READ" ? (
            <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void run("reject", async () => { await rejectQuoteRead(version.id); return "Set aside — the figures stay here, nothing changed."; })} data-quote-read-reject>
              Not right
            </button>
          ) : null}
          {version.document && status !== "PENDING" ? (
            <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void run("again", async () => { const r = await readQuoteVersionNow(version.id); return r.ok ? "Read again — the figures are below." : (r.error ?? "Could not read it."); })} data-quote-read-again>
              {busy === "again" ? "Reading…" : "Read again"}
            </button>
          ) : null}
          {version.document && status === "PENDING" ? (
            <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void run("now", async () => { const r = await readQuoteVersionNow(version.id); return r.ok ? "Read — the figures are below." : (r.error ?? "Could not read it."); })} data-quote-read-now>
              {busy === "now" ? "Reading…" : "Read now"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.term}>
      <dt className={s.lbl}>{label}</dt>
      <dd className={s.termVal}>{value}</dd>
    </div>
  );
}
