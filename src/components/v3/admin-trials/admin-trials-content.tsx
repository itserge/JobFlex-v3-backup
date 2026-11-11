"use client";

// ADMIN TRIAL WATCH — /admin/trials, blueprint (2026-09-24).
//
// The companies signed up in the window, highest score first: what they
// looked at, what they made, and why the score is what it is — each signal a
// sentence with its weight, under the row. Same vocabulary as the other
// admin pages (admin-shared): the KPI strip, the filter bar, the estimate
// table that stacks on a phone.

import { Fragment, Suspense, use, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { TrialCard, TrialPayments, TrialWatchData } from "@/actions/trialWatch";
import type { SignupFlow, SignupPlanSetting, SignupTrialState, SignupViewSetting } from "@/lib/trialPolicyServer";
import { TrialPolicyPanel } from "./trial-policy-panel";
import { SignupStepsPanel } from "./signup-steps-panel";
import { SignupPlanPanel } from "./signup-plan-panel";
import { SignupViewPanel } from "./signup-view-panel";
import { PricingModelPanel } from "./pricing-model-panel";
import type { PricingModelSetting } from "@/lib/toolPlans/server";
import type { TrialLevel } from "@/lib/trialWatch";
import { formatSpend, PAID_SERVICE_LABEL } from "@/lib/paidApiCosts";
import { TRIAL_CAP_KEYS, TRIAL_CAP_NOUN } from "@/lib/trialCaps";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import { Ic, StatusChip, ago } from "@/components/v3/admin-overview/admin-ui";
import t from "./admin-trials.module.css";
import type { PaymentCard } from "@/lib/paymentCard";
import { PaymentCardLabel } from "@/components/v3/admin-subscribers/payment-card";
import pc from "@/components/v3/admin-subscribers/payment-card.module.css";

const LEVEL_LABEL: Record<TrialLevel, string> = { suspicious: "Look at this", watch: "Watch", clear: "Clear" };
/** The card-less trial's card, as the row's second line says it. */
const CARD_LABEL: Record<TrialCard, string> = { none: "No card", "on-file": "Card added", ended: "Ended, no card", restarted: "Paid after trial" };

/** The row's card words (owner, 2026-10-07): the card itself from Stripe
 *  ("Visa ···· 4242", lib/paymentCard) wherever one is on file — a card-less
 *  trial that added one, a card-first trial, a restart — and the card-less
 *  record's own words otherwise. Nothing for a company Stripe holds no
 *  subscription for. Until Stripe answers (it streams) the record's words show. */
type Winback = { sent: number; offerUntil: string | null } | null;
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
function CardLine({ card, payment, winback = null }: { card: TrialCard | null; payment: PaymentCard | null; winback?: Winback }) {
  const method = payment && payment.kind !== "none" ? <PaymentCardLabel card={payment} /> : null;
  const words =
    card === "restarted" ? (
      <>
        {CARD_LABEL.restarted}
        {method && <> · {method}</>}
      </>
    ) : card === "ended" ? (
      <>
        {CARD_LABEL.ended}
        {winback ? <> · win-back · {winback.sent} {winback.sent === 1 ? "mail" : "mails"}{winback.offerUntil ? ` · 10% until ${DAY.format(new Date(winback.offerUntil))}` : ""}</> : null}
      </>
    ) : (
      method ?? (card ? CARD_LABEL[card] : payment?.label)
    );
  if (!words) return null;
  // Its own line under the status, free to wrap: the column is narrow and the
  // status line beside it cuts off with an ellipsis.
  return (
    <div className={pc.trialCard} data-card={card ?? "card-first"} data-card-kind={payment?.kind ?? "unknown"}>
      {words}
    </div>
  );
}

function StreamedCardLine({ id, card, payments, winback = null }: { id: string; card: TrialCard | null; payments: Promise<TrialPayments>; winback?: Winback }) {
  return <CardLine card={card} payment={use(payments)[id] ?? null} winback={winback} />;
}

export function AdminTrialsContent({
  data,
  policy,
  signup,
  plan,
  view,
  pricing,
  pricingReady,
  pricingParts,
  payments,
}: {
  data: TrialWatchData;
  policy: SignupTrialState;
  signup: SignupFlow;
  plan: SignupPlanSetting;
  view: SignupViewSetting;
  pricing: PricingModelSetting;
  pricingReady: boolean;
  pricingParts: ReadonlyArray<{ part: number; what: string; done: boolean }>;
  payments: Promise<TrialPayments>;
}) {
  const [level, setLevel] = useState<"" | TrialLevel>("");
  // Card-less trials apart (owner, 2026-10-01): "no-card" is every trial that
  // started without one, whatever has happened since; the rest narrow it.
  const [card, setCard] = useState<"" | "no-card" | TrialCard>("");
  const [query, setQuery] = useState("");
  // Score first (the watch's own order), or what the trial cost us in paid APIs.
  const [sort, setSort] = useState<"score" | "spend">("score");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cardOk = (c: TrialCard | null) => !card || (card === "no-card" ? c !== null : c === card);
    const kept = data.rows.filter((r) => (!level || r.level === level) && cardOk(r.card) && (!q || r.name.toLowerCase().includes(q) || (r.ownerEmail ?? "").toLowerCase().includes(q)));
    return sort === "spend" ? [...kept].sort((a, b) => b.spend.cents - a.spend.cents || b.score - a.score) : kept;
  }, [data.rows, level, card, query, sort]);
  const spendTotal = data.rows.reduce((n, r) => n + r.spend.cents, 0);
  const spenders = data.rows.filter((r) => r.spend.cents > 0).length;
  const cardless = data.rows.filter((r) => r.card !== null).length;
  const suspicious = data.rows.filter((r) => r.level === "suspicious").length;
  const watching = data.rows.filter((r) => r.level === "watch").length;
  const working = data.rows.filter((r) => r.writes > 0).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · Trials</div>
          <h1 className="page-title">Trial watch</h1>
        </div>
        <div className={s.headSide}>
          {suspicious > 0 ? <span className={`chip ${s.chipDanger}`}>{suspicious} to look at</span> : <span className="chip ok">Nothing to look at</span>}
          <Link className="btn btn-ghost" href={"/admin/subscribers" as Route}>
            <Ic id="i-card" />
            Subscribers
          </Link>
        </div>
      </div>

      {!data.viewsAvailable && (
        <p className={`${s.note} ${t.warn}`} data-views-missing>
          <b>Page views are not being recorded yet.</b> The PageView table is not in this database — push the schema and this page fills in. Until then only the signals that need no page views show: a competitor&apos;s domain, a test name, the records made.
        </p>
      )}

      <TrialPolicyPanel initial={policy} />
      <SignupStepsPanel initial={signup} />
      <SignupPlanPanel initial={plan} requiresCard={policy.mode === "card"} />
      <SignupViewPanel initial={view} />
      <PricingModelPanel initial={pricing} ready={pricingReady} parts={pricingParts} />

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-lbl">Trials · last {data.windowDays} days</div>
          <div className="kpi-val">{data.rows.length}</div>
          <div className={s.kpiSrc}>Signed up in the window</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Look at these</div>
          <div className={suspicious > 0 ? "kpi-val accent" : "kpi-val"}>{suspicious}</div>
          <div className={s.kpiSrc}>Score 60 and up</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Watching</div>
          <div className="kpi-val">{watching}</div>
          <div className={s.kpiSrc}>Score 30 to 59</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Working</div>
          <div className="kpi-val">{working}</div>
          <div className={s.kpiSrc}>Made a client, proposal, job or lead</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Paid API spend</div>
          <div className="kpi-val">{formatSpend(spendTotal)}</div>
          <div className={s.kpiSrc}>
            {spenders} {spenders === 1 ? "trial" : "trials"} · estimated, list price
          </div>
        </div>
      </div>

      <p className={s.note}>
        A screenshot cannot be seen. Behaviour can: an account that opens every screen and creates nothing, races through the product, signs up from a competitor&apos;s domain or shares a device with another trial scores up; proposals sent and jobs scheduled score it down. Page views are kept for a company&apos;s first {data.watchDays} days. Every screen of an unpaid account carries a faint watermark with the company, the email and the date, so a leaked screenshot names its source.
      </p>

      <div className="card">
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">Trials, highest score first</div>
          </div>
          <span className={s.count}>
            {rows.length} of {data.rows.length}
          </span>
        </div>
        <div className={s.filters}>
          <input className={`${s.search} ${s.fSearch}`} placeholder="Company or email" aria-label="Find a trial" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className={`bp-sel bp-sel--admin ${s.fSel}`}>
            <select className="bp-sel-in" aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value as "" | TrialLevel)}>
              <option value="">All levels</option>
              <option value="suspicious">Look at these</option>
              <option value="watch">Watching</option>
              <option value="clear">Clear</option>
            </select>
          </span>
          <span className={`bp-sel bp-sel--admin ${s.fSel}`}>
            <select className="bp-sel-in" aria-label="Card" value={card} onChange={(e) => setCard(e.target.value as typeof card)}>
              <option value="">All signups</option>
              <option value="no-card">Started without a card ({cardless})</option>
              <option value="none">· No card yet</option>
              <option value="on-file">· Card added</option>
              <option value="ended">· Ended, no card</option>
              <option value="restarted">· Paid after the trial</option>
            </select>
          </span>
          <span className={`bp-sel bp-sel--admin ${s.fSel}`}>
            <select className="bp-sel-in" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="score">Highest score first</option>
              <option value="spend">Highest API spend first</option>
            </select>
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">{data.rows.length ? "No trials match." : `No companies signed up in the last ${data.windowDays} days.`}</div>
        ) : (
          <table className={s.tbl}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Signed up</th>
                <th className={s.num}>Screens</th>
                <th className={s.num}>Records</th>
                <th>Active</th>
                <th className={s.num}>
                  <button type="button" className={t.sortBtn} aria-pressed={sort === "spend"} onClick={() => setSort(sort === "spend" ? "score" : "spend")}>
                    API spend{sort === "spend" ? " ↓" : ""}
                  </button>
                </th>
                <th>Score</th>
                <th>
                  <span className={t.srOnly}>Why</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr data-trial-row={r.id} data-level={r.level}>
                    <td data-l="Company">
                      <div>
                        <b>{r.name}</b>
                        <div className={s.sub}>{r.ownerEmail ?? "no owner email"}</div>
                      </div>
                    </td>
                    <td data-l="Signed up">
                      <div>
                        {ago(r.createdAt, data.now)}
                        <div className={s.sub}>
                          <StatusChip status={r.status} />
                        </div>
                        <Suspense fallback={<CardLine card={r.card} payment={null} winback={r.winback} />}>
                          <StreamedCardLine id={r.id} card={r.card} payments={payments} winback={r.winback} />
                        </Suspense>
                      </div>
                    </td>
                    <td data-l="Screens" className={s.num}>
                      {r.distinctRoutes}
                      <span className={s.sub}> · {r.views} views</span>
                    </td>
                    <td data-l="Records" className={s.num}>
                      {r.writes}
                      <span className={s.sub}> · {r.records.sent} sent</span>
                    </td>
                    <td data-l="Active">
                      {r.sessions ? `${r.sessions} ${r.sessions === 1 ? "sitting" : "sittings"} · ${r.minutesActive} min` : "—"}
                      {r.lastSeen && <div className={s.sub}>last {ago(r.lastSeen, data.now)}</div>}
                    </td>
                    <td data-l="API spend" className={s.num} data-spend={r.spend.cents}>
                      {r.spend.cents > 0 ? formatSpend(r.spend.cents) : "—"}
                      {r.spend.byService.length ? <span className={s.sub}> · {r.spend.byService.reduce((n, x) => n + x.calls, 0)} calls</span> : null}
                    </td>
                    <td data-l="Score">
                      <div className={t.score}>
                        <i className={t.bar} data-level={r.level}>
                          <b style={{ width: `${r.score}%` }} />
                        </i>
                        <b>{r.score}</b>
                        <span className={t.level} data-level={r.level}>
                          {LEVEL_LABEL[r.level]}
                        </span>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? "Close" : "Why"}
                      </button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className={s.detail} data-trial-detail>
                      <td colSpan={8}>
                        <div className={t.detail}>
                          <div>
                            <div className={s.detailHead}>Signals</div>
                            {r.signals.length ? (
                              <ul className={t.signals}>
                                {r.signals.map((sg) => (
                                  <li key={sg.code} data-weight={sg.weight > 0 ? "up" : "down"}>
                                    <b>{sg.weight > 0 ? `+${sg.weight}` : sg.weight}</b>
                                    {sg.text}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className={s.detailNote}>Nothing stands out.</p>
                            )}
                          </div>
                          <div>
                            <div className={s.detailHead}>Screens opened</div>
                            {r.routes.length ? (
                              <div className={t.routes}>
                                {r.routes.slice(0, 24).map((rt) => (
                                  <span key={rt}>{rt}</span>
                                ))}
                                {r.routes.length > 24 && <span>+{r.routes.length - 24} more</span>}
                              </div>
                            ) : (
                              <p className={s.detailNote}>No page views recorded{data.viewsAvailable ? "" : " — the table is not in this database"}.</p>
                            )}
                          </div>
                          <div>
                            <div className={s.detailHead}>Paid APIs during the trial</div>
                            {r.spend.byService.length ? (
                              <ul className={t.signals}>
                                {r.spend.byService.map((x) => (
                                  <li key={x.service} data-kind="spend">
                                    <b>{formatSpend(x.cents)}</b>
                                    {PAID_SERVICE_LABEL[x.service]} · {x.calls} {x.calls === 1 ? "call" : "calls"}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className={s.detailNote}>Nothing paid recorded.</p>
                            )}
                            {TRIAL_CAP_KEYS.some((k) => (r.spend.uses[k] ?? 0) > 0) ? (
                              <p className={s.detailNote}>
                                Trial ceilings used:{" "}
                                {TRIAL_CAP_KEYS.filter((k) => (r.spend.uses[k] ?? 0) > 0)
                                  .map((k) => `${r.spend.uses[k]} ${TRIAL_CAP_NOUN[k][(r.spend.uses[k] ?? 0) === 1 ? 0 : 1]}`)
                                  .join(" · ")}
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <div className={s.detailHead}>Made</div>
                            <p className={s.detailNote}>
                              {r.records.clients} clients · {r.records.proposals} proposals ({r.records.sent} sent) · {r.records.jobs} jobs · {r.records.leads} leads
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
