"use client";

// ADMIN SENT MAIL — BLUEPRINT
// /admin/mail/log (2026-10-21)
//
// The mail log (lib/emailLog): one row per letter sendEmail() handled. The
// filters live in the URL and the server reads them (period, status, kind, an
// address); this side pages the rows (usePagedList) and unfolds a row's
// details — the error, the transport's id, how long the send took. Furniture
// from the partner-money kit (admin-influencers/admin-ui), as /admin/cancellations.

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { usePagedList } from "@/lib/usePagedList";
import { Pagination } from "@/components/ui/Pagination";
import { TEAM_TZ } from "@/lib/adminTasks/teamShared";
import { EMAIL_KINDS, MAIL_PERIODS, type EmailKind, type EmailStatus, type MailLogPeriod } from "@/lib/emailLogShared";
import { Chip, Empty, Ic, KpiStrip, cx, useReveal, type Tone } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./mail-log.module.css";

const PERIOD_LABEL: Record<MailLogPeriod, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };

export interface MailLogRow {
  id: string;
  at: string;
  to: string;
  subject: string;
  kind: EmailKind;
  transport: string;
  status: EmailStatus;
  providerId: string | null;
  error: string | null;
  durationMs: number;
  orgName: string | null;
}

type Filters = { period: MailLogPeriod; status: EmailStatus | null; kind: EmailKind | null; q: string };

const KIND_LABEL: Record<EmailKind, string> = {
  otp: "Sign-in code",
  "password-reset": "Password reset",
  security: "Security notice",
  dunning: "Billing",
  invoice: "Invoice",
  receipt: "Receipt",
  proposal: "Proposal",
  "follow-up": "Follow-up",
  welcome: "Welcome",
  support: "Support",
  inbox: "Inbox reply",
  "inbox-forward": "Inbox copy",
  campaign: "Campaign",
  other: "Other",
};
const STATUS_LABEL: Record<EmailStatus, string> = { sent: "Sent", failed: "Failed", skipped: "Skipped" };
const STATUS_TONE: Record<EmailStatus, Tone> = { sent: "ok", failed: "bad", skipped: "mute" };
const TRANSPORT_LABEL: Record<string, string> = { smtp: "SMTP", resend: "Resend", skipped: "—" };
/** Why a letter was skipped, from the marker sendEmail returned. */
const SKIP_WHY: Record<string, string> = {
  "qa-test-mode": "QA test mode — an automated check's @qa.jobflex.test address",
  preview: "Preview deployment — the address is outside PREVIEW_EMAIL_ALLOW",
  "dev-outbox": "Written to EMAIL_DEV_OUTBOX instead of sent (development)",
  disabled: "No mail transport configured (RESEND_API_KEY / SMTP_*)",
  "mail-block": "The address is on the do-not-email list (Platform · Mail · Do not email)",
};
const skipWhy = (id: string | null) => (id ? (SKIP_WHY[id.split(":")[0]] ?? null) : null);

const PAGE_SIZE = 25;

// The team's clock, not the browser's or the server's: the same text on both sides of hydration.
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const FULL = new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TZ, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

function hrefFor(f: Filters): Route {
  const p = new URLSearchParams();
  p.set("period", f.period);
  if (f.status) p.set("status", f.status);
  if (f.kind) p.set("kind", f.kind);
  if (f.q) p.set("q", f.q);
  return `/admin/mail/log?${p.toString()}` as Route;
}

const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function AdminMailLogContent({
  rows,
  capped,
  counts,
  filters,
  dailyLimit,
}: {
  /** Null when the table is not in this database yet. */
  rows: MailLogRow[] | null;
  /** The read stopped at its ceiling — older rows of the period are not shown. */
  capped: boolean;
  /** The period's letters by status (kind and address applied, status not). */
  counts: Record<EmailStatus, number>;
  filters: Filters;
  dailyLimit: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const router = useRouter();
  const [busy, startNav] = useTransition();
  const go = (next: Partial<Filters>) => startNav(() => router.push(hrefFor({ ...filters, ...next }), { scroll: false }));

  const [draft, setDraft] = useState(filters.q);
  const list = useMemo(() => rows ?? [], [rows]);
  const { page, pageCount, setPage, pageItems } = usePagedList(list, PAGE_SIZE);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const attempts = counts.sent + counts.failed;
  const failRate = attempts ? Math.round((counts.failed / attempts) * 1000) / 10 : 0;
  const total = counts.sent + counts.failed + counts.skipped;

  return (
    <div ref={rootRef} className={styles.root} data-mail-log>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Mail</div>
          <h1 className="page-title">Sent mail</h1>
        </div>
        <div className="page-actions">
          <nav className={styles.range} aria-label="Period">
            {MAIL_PERIODS.map((p) => (
              <Link key={p} href={hrefFor({ ...filters, period: p })} scroll={false} className={cx(styles.rangeBtn, p === filters.period && styles.rangeOn)} aria-current={p === filters.period ? "page" : undefined}>
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {rows === null ? (
        <section className="card rv">
          <Empty>The mail log is not in this database yet — apply prisma/sql/prod-2026-10-21-email-log.sql.</Empty>
        </section>
      ) : (
        <>
          <KpiStrip
            cells={[
              { label: "Sent", value: String(counts.sent), accent: true },
              { label: "Failed", value: String(counts.failed), tone: counts.failed > 0 ? "bad" : undefined },
              { label: "Skipped", value: String(counts.skipped) },
              { label: "Failure rate", value: attempts ? `${failRate}%` : "—", tone: failRate >= 5 ? "bad" : failRate > 0 ? "warn" : undefined },
            ]}
          />

          <form
            className={cx(styles.find, "rv")}
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: draft.trim().toLowerCase() });
            }}
          >
            <Ic name="search" />
            <input className={styles.findIn} type="search" inputMode="email" autoCapitalize="none" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Address or part of one" aria-label="Find letters by address" data-mail-find />
            {draft || filters.q ? (
              <button
                type="button"
                className={styles.findX}
                aria-label="Clear the search"
                onClick={() => {
                  setDraft("");
                  go({ q: "" });
                }}
              >
                <Ic name="x" />
              </button>
            ) : null}
            <button type="submit" className={cx("btn", "btn-primary", ui.btnSm)} disabled={busy}>
              {busy ? "Loading…" : "Search"}
            </button>
          </form>

          <section className={cx("card", "rv", busy && styles.busy)} aria-busy={busy}>
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Letters</div>
                <div className="card-sub">
                  {filters.period === "today" ? "Since midnight UTC — the day the limit counts" : `The last ${PERIOD_LABEL[filters.period].toLowerCase()}`}
                  {filters.q ? ` · addresses holding “${filters.q}”` : ""}. Daily limit {dailyLimit}.
                </div>
              </div>
            </div>

            <div className={styles.bar}>
              <div className={cx(ui.filters, styles.chips)} role="group" aria-label="Filter by status">
                {([null, "sent", "failed", "skipped"] as (EmailStatus | null)[]).map((s) => (
                  <Link key={s ?? "all"} href={hrefFor({ ...filters, status: s })} scroll={false} className={cx(ui.filter, filters.status === s && ui.filterOn)} aria-current={filters.status === s ? "true" : undefined} data-status-filter={s ?? "all"}>
                    {s ? STATUS_LABEL[s] : "All"}
                    <i>{s ? counts[s] : total}</i>
                  </Link>
                ))}
              </div>
              <label className={cx(styles.pick, styles.pickStatus)}>
                <span className={styles.pickLbl}>Status</span>
                <span className="bp-sel bp-sel--admin">
                  <select className="bp-sel-in" value={filters.status ?? ""} aria-label="Filter by status" onChange={(e) => go({ status: (e.target.value || null) as EmailStatus | null })}>
                    <option value="">{`All (${total})`}</option>
                    {(["sent", "failed", "skipped"] as EmailStatus[]).map((s) => (
                      <option key={s} value={s}>{`${STATUS_LABEL[s]} (${counts[s]})`}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className={styles.pick}>
                <span className={styles.pickLbl}>Kind</span>
                <span className="bp-sel bp-sel--admin">
                  <select className="bp-sel-in" value={filters.kind ?? ""} aria-label="Filter by kind" data-kind-filter onChange={(e) => go({ kind: (e.target.value || null) as EmailKind | null })}>
                    <option value="">All kinds</option>
                    {EMAIL_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>

            {list.length === 0 ? (
              <Empty>{filters.q || filters.status || filters.kind ? "No letters match these filters in this period." : "No letters in this period yet."}</Empty>
            ) : (
              <>
                <div className={cx(ui.tr, ui.th, styles.cols)} aria-hidden="true">
                  <span>Time · PT</span>
                  <span>To</span>
                  <span>Subject</span>
                  <span>Kind</span>
                  <span>Via</span>
                  <span>Status</span>
                  <span />
                </div>
                <ul className={styles.list} aria-label="Letters">
                  {pageItems.map((r) => {
                    const isOpen = open.has(r.id);
                    const why = r.status === "skipped" ? skipWhy(r.providerId) : null;
                    return (
                      <li key={r.id} className={styles.item} data-mail-row={r.id} data-status={r.status} data-kind={r.kind}>
                        <button type="button" className={cx(ui.tr, ui.trBtn, styles.cols, styles.rowBtn)} aria-expanded={isOpen} aria-controls={`ml-${r.id}`} onClick={() => toggle(r.id)}>
                          <span className={styles.time}>
                            <span className={ui.tdLbl}>Time · PT</span>
                            {TIME.format(new Date(r.at))}
                          </span>
                          <span className={cx(styles.stat, styles.statTop)}>
                            <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                          </span>
                          <span className={cx(ui.tdWide, styles.to)}>
                            <span className={ui.tdLbl}>To</span>
                            <span className={styles.addr}>{r.to}</span>
                          </span>
                          <span className={cx(ui.tdWide, styles.subj)}>
                            <span className={ui.tdLbl}>Subject</span>
                            <span className={styles.subjTxt}>{r.subject || "—"}</span>
                            {r.status === "failed" && r.error ? <span className={styles.errLine}>{r.error}</span> : null}
                          </span>
                          <span>
                            <span className={ui.tdLbl}>Kind</span>
                            <span className={styles.kind}>{KIND_LABEL[r.kind]}</span>
                          </span>
                          <span className={styles.via}>
                            <span className={ui.tdLbl}>Via</span>
                            {TRANSPORT_LABEL[r.transport] ?? r.transport}
                          </span>
                          <span className={cx(styles.stat, styles.statCol)}>
                            <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                          </span>
                          <span className={styles.chev} aria-hidden="true">
                            <Ic name="chev" />
                          </span>
                        </button>
                        <div id={`ml-${r.id}`} className={styles.detail} hidden={!isOpen}>
                          {r.error ? (
                            <div className={styles.dRow}>
                              <span className={styles.dK}>Error</span>
                              <span className={styles.dErr}>{r.error}</span>
                            </div>
                          ) : null}
                          {why ? (
                            <div className={styles.dRow}>
                              <span className={styles.dK}>Skipped</span>
                              <span>{why}</span>
                            </div>
                          ) : null}
                          <div className={styles.dRow}>
                            <span className={styles.dK}>When</span>
                            <span>{FULL.format(new Date(r.at))}</span>
                          </div>
                          <div className={styles.dRow}>
                            <span className={styles.dK}>{r.transport === "skipped" ? "Marker" : "Message id"}</span>
                            <span className={styles.dMono}>{r.providerId ?? "—"}</span>
                          </div>
                          <div className={styles.dRow}>
                            <span className={styles.dK}>Took</span>
                            <span>{seconds(r.durationMs)}</span>
                          </div>
                          <div className={styles.dRow}>
                            <span className={styles.dK}>Company</span>
                            <span>{r.orgName ?? "—"}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div data-nest className={styles.pager}>
                  <Pagination page={page} pageCount={pageCount} onPage={setPage} />
                </div>
                {capped ? <p className={styles.note}>The newest {list.length} letters are shown — narrow the period, the kind or the address to see older ones.</p> : null}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
