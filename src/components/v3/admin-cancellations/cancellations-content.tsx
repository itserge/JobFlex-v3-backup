"use client";

// ADMIN CANCELLATIONS — BLUEPRINT
// /admin/cancellations (owner, 2026-10-20)
//
// Every cancellation with its reasons (lib/cancelFeedback), newest first, and
// one filter: a reason. The counts above the table are the reasons' totals over
// every row (a cancellation may carry several). Read-only; furniture from the
// partner-money kit (admin-influencers/admin-ui).
//
// 2026-10-28 (owner: "did anybody start paying after the trial expired with no
// card, or cancel during the trial and come back?"): the "Came back" card on
// top lists both, from lib/cameBack, and every cancellation row says what its
// company is today — paying again, on a trial again, or still gone.

import { useMemo, useRef, useState } from "react";
import { longDate, shortDate } from "@/lib/format";
import { ADMIN_REASON, CANCEL_REASONS, reasonLabel, type StoredReason } from "@/lib/cancelFeedback";
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
  /** When the plan switches to Free (the end of the paid cycle or trial). */
  periodEnd: string | null;
  createdAt: string;
}

type Filter = "ALL" | "BACK" | StoredReason;
/** The owner's reasons, then a platform admin's cancels (lib/adminCancel). */
const REASON_FILTERS = [...CANCEL_REASONS, { key: ADMIN_REASON, label: "By admin" }];
const NOW_TONE: Record<NowWord, Tone> = { paying: "ok", trial: "wait", failing: "bad", gone: "mute" };

/** What a cancelled company is today, as a chip. */
function NowChip({ now }: { now: NowWord }) {
  return <Chip tone={NOW_TONE[now]}>{NOW_WORDS[now]}</Chip>;
}

export function AdminCancellationsContent({ rows, last30, cameBack = null }: { rows: CancellationDTO[] | null; /** Booked in the last 30 days (counted on the server). */ last30: number; /** Who came back (lib/cameBack); null when the read failed. */ cameBack?: CameBack | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [filter, setFilter] = useState<Filter>("ALL");
  const list = useMemo(() => rows ?? [], [rows]);
  const nowOfRow = (id: string): NowWord | null => cameBack?.nowByCancel[id]?.now ?? null;

  const counts = useMemo(() => {
    const c = new Map<Filter, number>([["ALL", list.length]]);
    for (const r of list) for (const k of r.reasons) c.set(k, (c.get(k) ?? 0) + 1);
    return c;
  }, [list]);
  const backCount = useMemo(() => list.filter((r) => { const n = cameBack?.nowByCancel[r.id]?.now; return !!n && isBack(n); }).length, [list, cameBack]);
  const shown = useMemo(
    () => (filter === "ALL" ? list : filter === "BACK" ? list.filter((r) => { const n = cameBack?.nowByCancel[r.id]?.now; return !!n && isBack(n); }) : list.filter((r) => r.reasons.includes(filter))),
    [list, filter, cameBack],
  );
  const top = useMemo(
    () => CANCEL_REASONS.map((r) => ({ key: r.key, n: counts.get(r.key) ?? 0 })).sort((a, b) => b.n - a.n)[0],
    [counts],
  );

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Subscriptions</div>
          <h1 className="page-title">Cancellations</h1>
        </div>
      </div>

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
          <Empty>Cancellation reasons are not set up in this database yet — apply prisma/sql/prod-2026-10-20-cancel-feedback-trial-requests.sql.</Empty>
        </section>
      ) : (
        <>
          <KpiStrip
            cells={[
              { label: "Cancellations", value: String(list.length) },
              { label: "Last 30 days", value: String(last30), tone: last30 > 0 ? "warn" : undefined },
              { label: "In their own words", value: String(counts.get("other") ?? 0) },
              { label: top && top.n > 0 ? `Top reason · ${top.n}` : "Top reason", value: top && top.n > 0 ? reasonLabel(top.key) : "—", accent: true },
            ]}
          />

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Why they cancelled</div>
                <div className="card-sub">Ticked on &ldquo;Cancel &lt;plan&gt;?&rdquo; — one cancellation can give several reasons.</div>
              </div>
            </div>
            {/* A phone gets the house select: eight reasons as chips fill the screen. */}
            <label className={styles.pick}>
              <span className={ui.tdLbl}>Reason</span>
              <span className="bp-sel bp-sel--admin">
                <select className="bp-sel-in" value={filter} aria-label="Filter by reason" onChange={(e) => setFilter(e.target.value as Filter)}>
                  {([{ key: "ALL", label: "All reasons" }, ...(cameBack ? [{ key: "BACK", label: "Came back" }] : []), ...REASON_FILTERS] as { key: Filter; label: string }[]).map((f) => (
                    <option key={f.key} value={f.key}>{`${f.label} (${f.key === "BACK" ? backCount : counts.get(f.key) ?? 0})`}</option>
                  ))}
                </select>
              </span>
            </label>
            <div className={cx(ui.filters, styles.filters)} role="group" aria-label="Filter by reason">
              {([{ key: "ALL", label: "All" }, ...(cameBack ? [{ key: "BACK", label: "Came back" }] : []), ...REASON_FILTERS] as { key: Filter; label: string }[]).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={cx(ui.filter, filter === f.key && ui.filterOn)}
                  aria-pressed={filter === f.key}
                  data-reason-filter={f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <i>{f.key === "BACK" ? backCount : counts.get(f.key) ?? 0}</i>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <Empty>{list.length === 0 ? "No cancellations with reasons yet." : filter === "BACK" ? "No cancelled company is on a plan again." : `Nobody gave “${reasonLabel(filter)}”.`}</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="Cancellations">
                <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                  <span>Date</span>
                  <span>Company</span>
                  <span>Plan</span>
                  <span>Reasons</span>
                  <span>To Free</span>
                  <span>Now</span>
                </div>
                {shown.map((r) => (
                  <div key={r.id} className={cx(ui.tr, styles.cols)} role="row" data-cancellation={r.id}>
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
                    <span className={ui.tdWide}>
                      <span className={ui.tdLbl}>Reasons</span>
                      <span className={styles.reasons}>
                        {r.reasons.map((k) => (
                          <span key={k} className={styles.reason}>
                            {reasonLabel(k)}
                          </span>
                        ))}
                      </span>
                      {r.otherText ? <span className={styles.other}>{`“${r.otherText}”`}</span> : null}
                    </span>
                    <span className={styles.date}>
                      <span className={ui.tdLbl}>Switches to Free</span>
                      {r.periodEnd ? longDate(r.periodEnd) : <Meta>—</Meta>}
                    </span>
                    <span data-now={nowOfRow(r.id) ?? ""}>
                      <span className={ui.tdLbl}>Now</span>
                      {nowOfRow(r.id) ? <NowChip now={nowOfRow(r.id) as NowWord} /> : <Meta>—</Meta>}
                      {cameBack?.nowByCancel[r.id]?.duringTrial ? <span className={styles.sub}>cancelled during the trial</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
