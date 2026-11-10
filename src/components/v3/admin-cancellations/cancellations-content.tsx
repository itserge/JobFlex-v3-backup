"use client";

// ADMIN CANCELLATIONS — BLUEPRINT
// /admin/cancellations (owner, 2026-10-20; the question tree 2026-11-09)
//
// On top, the last 30 days by answer (lib/cancelTree): how many took each
// branch, the tools named most under "didn't work", the reasons named most
// under "something else", the trial-day asks sent instead of a cancel, and
// the owners who would come back. Then every cancellation, newest first —
// the path, one line of the answer, and a row that opens into every answer
// in the order asked. Filters: path, tool, reason. Rows from before
// 2026-11-09 carry the old reasons only. Read-only; furniture from the
// partner-money kit (admin-influencers/admin-ui).
//
// 2026-10-28 (owner: "did anybody start paying after the trial expired with no
// card, or cancel during the trial and come back?"): the "Came back" card
// lists both, from lib/cameBack, and every cancellation row says what its
// company is today — paying again, on a trial again, or still gone.

import { Fragment, useMemo, useRef, useState } from "react";
import { longDate, shortDate } from "@/lib/format";
import { CANCEL_REASONS, reasonLabel, type StoredReason } from "@/lib/cancelFeedback";
import { CANCEL_PATHS, CANCEL_TOOLS, pathShort, type CancelPath } from "@/lib/cancelTree";
import { NOW_WORDS, isBack, type CameBack, type NowWord } from "@/lib/cameBack";
import { Chip, Empty, KpiStrip, Meta, cx, useReveal, type Tone } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./cancellations.module.css";

export interface CancellationDTO {
  id: string;
  orgName: string;
  email: string;
  planName: string;
  reasons: StoredReason[];
  otherText: string | null;
  /** A platform admin's cancel (lib/adminCancel). */
  byAdmin: boolean;
  /** The main reason (lib/cancelTree); null before 2026-11-09 and for an admin's cancel. */
  path: CancelPath | null;
  /** "didn't have time · wants Roof estimator". */
  summary: string | null;
  /** Every answer, in the order asked. */
  lines: { q: string; a: string; sub?: boolean }[] | null;
  /** A2's "didn't work" tools. */
  tools: string[];
  /** Every tool the answer names (A2's, or A1's "try first") — the tool filter. */
  toolsNamed: string[];
  again: string | null;
  /** "Yes — email me when it's fixed" with the box on. */
  followUpEmail: string | null;
  /** When the plan switches to Free (the end of the paid cycle or trial). */
  periodEnd: string | null;
  createdAt: string;
}

export interface CancelDigest {
  total: number;
  byPath: { A1: number; A2: number; A3: number; older: number; admin: number };
  topTools: { key: string; label: string; n: number }[];
  topReasons: { key: string; label: string; n: number }[];
  extensions: number;
  comeBack: number;
}

type PathFilter = "ALL" | CancelPath | "OLDER" | "ADMIN";
type ReasonFilter = "ALL" | "BACK" | StoredReason;
const PATH_FILTERS: { key: PathFilter; label: string }[] = [
  { key: "ALL", label: "All paths" },
  ...CANCEL_PATHS.map((p) => ({ key: p.key as PathFilter, label: `${p.key} · ${p.short}` })),
  { key: "OLDER", label: "Before the questions" },
  { key: "ADMIN", label: "By admin" },
];
const NOW_TONE: Record<NowWord, Tone> = { paying: "ok", trial: "wait", failing: "bad", gone: "mute" };
const PATH_TONE: Record<CancelPath, Tone> = { A1: "wait", A2: "bad", A3: "bp" };

/** What a cancelled company is today, as a chip. */
function NowChip({ now }: { now: NowWord }) {
  return <Chip tone={NOW_TONE[now]}>{NOW_WORDS[now]}</Chip>;
}

function pathOf(r: CancellationDTO): PathFilter {
  return r.byAdmin ? "ADMIN" : (r.path ?? "OLDER");
}

/** A ranked list: label, a bar to scale, the count. */
function Ranked({ title, items, empty }: { title: string; items: { key: string; label: string; n: number }[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className={styles.rank}>
      <h3 className={styles.backTitle}>{title}</h3>
      {items.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ol className={styles.rankList}>
          {items.map((i) => (
            <li key={i.key}>
              <span className={styles.rankL}>{i.label}</span>
              <span className={styles.rankBar} aria-hidden="true">
                <i style={{ width: `${(i.n / max) * 100}%` }} />
              </span>
              <span className={styles.rankN}>{i.n}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AdminCancellationsContent({
  rows,
  digest = null,
  cameBack = null,
}: {
  rows: CancellationDTO[] | null;
  /** The last 30 days by answer (counted on the server). */
  digest?: CancelDigest | null;
  /** Who came back (lib/cameBack); null when the read failed. */
  cameBack?: CameBack | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [path, setPath] = useState<PathFilter>("ALL");
  const [tool, setTool] = useState<string>("ALL");
  const [reason, setReason] = useState<ReasonFilter>("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => rows ?? [], [rows]);
  const nowOfRow = (id: string): NowWord | null => cameBack?.nowByCancel[id]?.now ?? null;

  const shown = useMemo(() => {
    const back = (id: string) => {
      const n = cameBack?.nowByCancel[id]?.now;
      return !!n && isBack(n);
    };
    return list.filter(
      (r) =>
        (path === "ALL" || pathOf(r) === path) &&
        (tool === "ALL" || r.toolsNamed.includes(tool)) &&
        (reason === "ALL" || (reason === "BACK" ? back(r.id) : r.reasons.includes(reason))),
    );
  }, [list, path, tool, reason, cameBack]);
  const counts = useMemo(() => {
    const isBackRow = (id: string) => {
      const n = cameBack?.nowByCancel[id]?.now;
      return !!n && isBack(n);
    };
    const path = new Map<string, number>();
    const tool = new Map<string, number>();
    const reason = new Map<string, number>();
    for (const r of list) {
      path.set(pathOf(r), (path.get(pathOf(r)) ?? 0) + 1);
      for (const t of r.toolsNamed) tool.set(t, (tool.get(t) ?? 0) + 1);
      for (const k of r.reasons) reason.set(k, (reason.get(k) ?? 0) + 1);
      if (isBackRow(r.id)) reason.set("BACK", (reason.get("BACK") ?? 0) + 1);
    }
    return { path, tool, reason };
  }, [list, cameBack]);
  const reasonOptions: { key: ReasonFilter; label: string }[] = [
    { key: "ALL", label: "All reasons" },
    ...(cameBack ? [{ key: "BACK" as ReasonFilter, label: "Came back" }] : []),
    ...CANCEL_REASONS.map((r) => ({ key: r.key as ReasonFilter, label: r.label })),
    { key: "admin", label: "By admin" },
  ];

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Subscriptions</div>
          <h1 className="page-title">Cancellations</h1>
        </div>
      </div>

      {/* ── the last 30 days by answer — on top ── */}
      {rows && digest ? (
        <section className="card rv" data-cancel-digest="">
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title">Last 30 days</div>
              <div className="card-sub">By the owner&rsquo;s main reason. &ldquo;Asked for days instead&rdquo; counts the trial-day requests sent from the questions in place of a cancel.</div>
            </div>
          </div>
          <KpiStrip
            cols={6}
            cells={[
              { label: "Cancellations", value: String(digest.total), tone: digest.total > 0 ? "warn" : undefined },
              { label: "A1 · Didn't have time", value: String(digest.byPath.A1) },
              { label: "A2 · Tools didn't work", value: String(digest.byPath.A2) },
              { label: "A3 · Something else", value: String(digest.byPath.A3) },
              { label: "Asked for days instead", value: String(digest.extensions), tone: digest.extensions > 0 ? "ok" : undefined },
              { label: "Would come back · Yes", value: String(digest.comeBack), accent: digest.comeBack > 0 },
            ]}
          />
          {digest.byPath.older || digest.byPath.admin ? (
            <p className={styles.digestNote}>
              {[digest.byPath.older ? `${digest.byPath.older} on the old form` : null, digest.byPath.admin ? `${digest.byPath.admin} by an admin` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <div className={styles.backGrid}>
            <Ranked title="Tools that didn't work (A2) · top 5" items={digest.topTools} empty="No A2 answers in the last 30 days." />
            <Ranked title="Reasons under something else (A3)" items={digest.topReasons} empty="No A3 answers in the last 30 days." />
          </div>
        </section>
      ) : null}

      {/* ── who came back ── */}
      {cameBack && (
        <section className="card rv" data-came-back>
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title">Came back</div>
              <div className="card-sub">
                Companies that left and pay again: card-less trials that ran out with no card and later paid (the day is recorded), and cancellations whose company is on a plan again (the day is not —
                the next invoice stands in). A cancel made in Stripe itself leaves no row here.
              </div>
            </div>
          </div>
          <KpiStrip
            cells={[
              { label: "Came back", value: String(cameBack.counts.back), tone: cameBack.counts.back > 0 ? "ok" : undefined },
              { label: `Paid after the trial ran out · of ${cameBack.counts.cardlessEnded}`, value: String(cameBack.counts.restarted) },
              { label: "After the 10% offer", value: String(cameBack.counts.afterOffer) },
              { label: `Cancelled, then back · ${cameBack.counts.cancelledDuringTrialBack} during a trial`, value: String(cameBack.counts.cancelledBack) },
            ]}
          />
          {cameBack.restarted.length === 0 && cameBack.cancelledBack.length === 0 ? (
            <Empty>Nobody yet — no card-less trial that ran out has paid since, and no cancelled company is on a plan again.</Empty>
          ) : (
            <div className={styles.backGrid}>
              <div>
                <h3 className={styles.backTitle}>Paid after the trial ran out</h3>
                {cameBack.restarted.length === 0 ? (
                  <Empty>None yet.</Empty>
                ) : (
                  <div className={ui.tbl} role="table" aria-label="Paid after the trial ran out">
                    <div className={cx(ui.tr, ui.th, styles.backCols)} role="row">
                      <span>Company</span>
                      <span>Trial ended</span>
                      <span>Paid on</span>
                      <span>Now</span>
                    </div>
                    {cameBack.restarted.map((r) => (
                      <div key={r.orgId} className={cx(ui.tr, styles.backCols)} role="row" data-restarted={r.orgId}>
                        <span className={ui.tdWide}>
                          <span className={ui.tdName} title={r.name}>{r.name}</span>
                          <span className={ui.tdSub} title={r.email}>{r.email}</span>
                        </span>
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Trial ended</span>
                          {r.trialEnded ? shortDate(new Date(r.trialEnded).toISOString()) : <Meta>—</Meta>}
                        </span>
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Paid on</span>
                          {shortDate(new Date(r.paidOn).toISOString())}
                          <span className={styles.sub}>{r.daysAfter !== null ? `${r.daysAfter} ${r.daysAfter === 1 ? "day" : "days"} after` : ""}{r.afterOffer ? " · after the 10% offer" : r.mailsBefore > 0 ? ` · ${r.mailsBefore} win-back ${r.mailsBefore === 1 ? "mail" : "mails"}` : ""}</span>
                        </span>
                        <span>
                          <span className={ui.tdLbl}>Now</span>
                          <NowChip now={r.now} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className={styles.backTitle}>Cancelled, then on a plan again</h3>
                {cameBack.cancelledBack.length === 0 ? (
                  <Empty>None yet.</Empty>
                ) : (
                  <div className={ui.tbl} role="table" aria-label="Cancelled, then on a plan again">
                    <div className={cx(ui.tr, ui.th, styles.backCols)} role="row">
                      <span>Company</span>
                      <span>Cancelled</span>
                      <span>Next invoice</span>
                      <span>Now</span>
                    </div>
                    {cameBack.cancelledBack.map((r) => (
                      <div key={r.id} className={cx(ui.tr, styles.backCols)} role="row" data-cancelled-back={r.id}>
                        <span className={ui.tdWide}>
                          <span className={ui.tdName} title={r.name}>{r.name}</span>
                          <span className={ui.tdSub} title={r.email}>{r.email}</span>
                        </span>
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Cancelled</span>
                          {shortDate(new Date(r.cancelledOn).toISOString())}
                          <span className={styles.sub}>{r.duringTrial ? "during the trial" : "after the trial"}</span>
                        </span>
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Next invoice</span>
                          {r.nextInvoice ? shortDate(new Date(r.nextInvoice).toISOString()) : <Meta>—</Meta>}
                        </span>
                        <span>
                          <span className={ui.tdLbl}>Now</span>
                          <NowChip now={r.now} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {rows === null ? (
        <section className="card rv">
          <Empty>Cancellations are not set up in this database yet — apply prisma/sql/prod-2026-10-20-cancel-feedback-trial-requests.sql, then prisma/sql/prod-2026-11-09-cancel-tree.sql.</Empty>
        </section>
      ) : (
        <>

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Why they cancelled</div>
                <div className="card-sub">Open a row for every answer, in the order it was asked.</div>
              </div>
            </div>
            <div className={styles.picks}>
              <label className={styles.pick}>
                <span className={styles.pickL}>Path</span>
                <span className="bp-sel bp-sel--admin">
                  <select className="bp-sel-in" value={path} aria-label="Filter by path" data-filter="path" onChange={(e) => setPath(e.target.value as PathFilter)}>
                    {PATH_FILTERS.map((f) => (
                      <option key={f.key} value={f.key}>{`${f.label} (${f.key === "ALL" ? list.length : (counts.path.get(f.key) ?? 0)})`}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className={styles.pick}>
                <span className={styles.pickL}>Tool</span>
                <span className="bp-sel bp-sel--admin">
                  <select className="bp-sel-in" value={tool} aria-label="Filter by tool" data-filter="tool" onChange={(e) => setTool(e.target.value)}>
                    <option value="ALL">{`All tools (${list.length})`}</option>
                    {CANCEL_TOOLS.map((t) => (
                      <option key={t.key} value={t.key}>{`${t.long} (${counts.tool.get(t.key) ?? 0})`}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className={styles.pick}>
                <span className={styles.pickL}>Reason</span>
                <span className="bp-sel bp-sel--admin">
                  <select className="bp-sel-in" value={reason} aria-label="Filter by reason" data-filter="reason" onChange={(e) => setReason(e.target.value as ReasonFilter)}>
                    {reasonOptions.map((f) => (
                      <option key={f.key} value={f.key}>{`${f.label} (${f.key === "ALL" ? list.length : (counts.reason.get(f.key) ?? 0)})`}</option>
                    ))}
                  </select>
                </span>
              </label>
            </div>

            {shown.length === 0 ? (
              <Empty>{list.length === 0 ? "No cancellations yet." : "No cancellation matches these filters."}</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="Cancellations">
                <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                  <span>Date</span>
                  <span>Company</span>
                  <span>Plan</span>
                  <span>Path</span>
                  <span>Answer</span>
                  <span>To Free</span>
                  <span>Now</span>
                </div>
                {shown.map((r) => {
                  const isOpen = open === r.id;
                  const now = nowOfRow(r.id);
                  return (
                    <Fragment key={r.id}>
                      <button
                        type="button"
                        className={cx(ui.tr, ui.trBtn, styles.cols, isOpen && styles.rowOpen)}
                        aria-expanded={isOpen}
                        aria-controls={`cx-answers-${r.id}`}
                        data-cancellation={r.id}
                        data-path={r.path ?? (r.byAdmin ? "admin" : "older")}
                        onClick={() => setOpen(isOpen ? null : r.id)}
                      >
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Date</span>
                          <span title={longDate(r.createdAt)}>{shortDate(r.createdAt)}</span>
                        </span>
                        <span className={ui.tdWide}>
                          <span className={ui.tdName} title={r.orgName}>
                            {r.orgName}
                          </span>
                          <span className={ui.tdSub} title={r.email}>
                            {r.email}
                          </span>
                        </span>
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Plan</span>
                          {r.planName}
                        </span>
                        <span>
                          <span className={ui.tdLbl}>Path</span>
                          {r.path ? <Chip tone={PATH_TONE[r.path]}>{`${r.path} · ${pathShort(r.path)}`}</Chip> : <Meta>{r.byAdmin ? "By admin" : "Old form"}</Meta>}
                        </span>
                        <span className={ui.tdWide}>
                          <span className={ui.tdLbl}>Answer</span>
                          {r.summary ? (
                            <span className={styles.summary}>{r.summary}</span>
                          ) : (
                            <span className={styles.reasons}>
                              {r.reasons.map((k) => (
                                <span key={k} className={styles.reason}>
                                  {reasonLabel(k)}
                                </span>
                              ))}
                            </span>
                          )}
                          {!r.summary && r.otherText ? <span className={styles.other}>{`“${r.otherText}”`}</span> : null}
                          {r.followUpEmail ? <span className={styles.sub}>{`Email when fixed · ${r.followUpEmail}`}</span> : null}
                        </span>
                        <span className={styles.date}>
                          <span className={ui.tdLbl}>Switches to Free</span>
                          {r.periodEnd ? longDate(r.periodEnd) : <Meta>—</Meta>}
                        </span>
                        <span data-now={now ?? ""} className={styles.nowCell}>
                          <span className={ui.tdLbl}>Now</span>
                          <span className={styles.nowIn}>
                            {now ? <NowChip now={now} /> : <Meta>—</Meta>}
                            <svg className={styles.chev} aria-hidden="true" viewBox="0 0 24 24">
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </span>
                          {cameBack?.nowByCancel[r.id]?.duringTrial ? <span className={styles.sub}>cancelled during the trial</span> : null}
                        </span>
                      </button>
                      {isOpen ? (
                        <div className={styles.answers} id={`cx-answers-${r.id}`} data-answers={r.id}>
                          <dl className={styles.lines}>
                            {r.lines ? (
                              r.lines.map((l, i) => (
                                <div key={i} className={cx(styles.line, l.sub && styles.lineSub)}>
                                  <dt>{l.q}</dt>
                                  <dd>{l.a}</dd>
                                </div>
                              ))
                            ) : (
                              <>
                                <div className={styles.line}>
                                  <dt>{r.byAdmin ? "Cancelled by" : "Reasons"}</dt>
                                  <dd>{r.byAdmin ? `${r.email} (JobFlex admin)` : r.reasons.map(reasonLabel).join(" · ") || "—"}</dd>
                                </div>
                                {r.otherText ? (
                                  <div className={styles.line}>
                                    <dt>{r.byAdmin ? "Admin's note" : "Other"}</dt>
                                    <dd>{`“${r.otherText}”`}</dd>
                                  </div>
                                ) : null}
                              </>
                            )}
                          </dl>
                          {!r.lines && !r.byAdmin ? <p className={styles.digestNote}>Booked before the questions (2026-11-09) — only the reasons were asked.</p> : null}
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
