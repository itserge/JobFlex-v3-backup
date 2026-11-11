"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { revenueDate, type RevenueReport } from "@/lib/revenue-contract";
import { refreshRevenue } from "@/actions/revenue";
import { ToolPlansSection } from "./tool-plans-section";
import s from "./revenue.module.css";

const Mobile = dynamic(() => import("./revenue-mobile"), { ssr: false });
const subscribe = (fn: () => void) => { const m = window.matchMedia("(max-width: 768px)"); m.addEventListener("change", fn); return () => m.removeEventListener("change", fn); };
const snapshot = () => window.matchMedia("(max-width: 768px)").matches;
export function RevenueContent({ data }: { data: RevenueReport }) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  return mobile ? <Mobile data={data} /> : <RevenueView data={data} />;
}
const shortDate = (day: string) => new Date(day.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
type Metric = "mrr" | "arr" | "collected";
const labels: Record<Metric, string> = { mrr: "MRR", arr: "ARR", collected: "Collected" };
const futureKeys = { mrr: "forecastMrr", arr: "forecastArr", collected: "forecastCollected" } as const;

export function RevenueView({ data, mobile = false }: { data: RevenueReport; mobile?: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // A new Stripe read runs behind these figures (lib/revenueSaved): look again every fifteen seconds until it lands.
  useEffect(() => {
    if (!data.updating) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [data.updating, router]);
  const [metric, setMetric] = useState<Metric>("mrr"), [tab, setTab] = useState("overview"), [range, setRange] = useState(90), [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency, maximumFractionDigits: 2 }).format(cents / 100);
  const today = revenueDate(Date.parse(data.asOf) / 1000);
  const cutoff = new Date(Date.parse(today + "T12:00:00Z") - range * 86400000).toISOString().slice(0, 10);
  const points = useMemo(() => data.points.filter(p => range === 0 || p.date >= cutoff), [data.points, range, cutoff]);
  const users = data.customers.filter(c => (!query || `${c.name} ${c.email} ${c.plans}`.toLowerCase().includes(query.toLowerCase())) && (filter === "all" || (filter === "paying" ? c.monthly > 0 : filter === "overdue" ? c.overdue > 0 : c.status.includes(filter))));
  const shown = users.slice(page * 20, page * 20 + 20);
  const predicted = metric === "mrr" ? data.projectedMrr : metric === "arr" ? data.projectedMrr * 12 : data.projectedCollected;
  return <main className={`${s.root} ${mobile ? s.mobile : ""}`}>
    <header className={s.header}><div><p className={s.eyebrow}>Platform / Financials</p><h1>Revenue</h1><p className={s.subtle}>Subscription money, in one place.</p></div><div className={s.sync}><span className={s.stamp}>{data.live ? "Live Stripe" : "Test data"}</span><button className={s.button} disabled={refreshing || data.updating} onClick={() => startRefresh(async () => { await refreshRevenue(); router.refresh(); })} aria-label="Refresh revenue"><RefreshCw size={16} />{refreshing || data.updating ? "Reading…" : "Refresh"}</button><small>Read {new Date(data.asOf).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} PT</small></div></header>
    <div className={s.metrics}>
      {(["mrr", "arr", "collected"] as const).map(key => <button key={key} className={`${s.metric} ${metric === key ? s.selected : ""}`} onClick={() => { setMetric(key); setTab("overview"); }} aria-pressed={metric === key}><span>{labels[key]}</span><strong>{money(data[key])}</strong><small>{key === "mrr" ? "Active monthly revenue" : key === "arr" ? "MRR × 12 · not cash" : "Lifetime · after refunds / disputes"}</small></button>)}
    </div>
    <nav className={s.tabs} aria-label="Revenue views"><button aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button aria-pressed={tab === "users"} onClick={() => setTab("users")}>Users <span>{data.customers.length}</span></button><Link className={s.tabLink} href="/admin/revenue/failed-payments">Failed payments</Link></nav>
    {data.warnings.map(w => <p key={w} className={s.warning} role="status">{w}</p>)}
    {tab === "overview" ? <>
      <section className={s.sheet} aria-label={`${labels[metric]} chart`}>
        <div className={s.chartHead}><div><h2>{metric === "mrr" ? "Monthly recurring revenue" : metric === "arr" ? "Annual run rate" : "Total collected"}</h2><div className={s.legend}><span><i />{metric === "collected" ? "Recorded cash" : "Paid-period history"}</span><span><i />Forecast</span></div></div><label className={s.range}>History<select value={range} onChange={e => setRange(Number(e.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={0}>All time</option></select></label></div>
        <div className={s.chart}>
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={mobile ? 260 : 340} initialDimension={{ width: mobile ? 320 : 960, height: mobile ? 260 : 340 }}><LineChart data={points} margin={{ top: 24, right: mobile ? 8 : 28, left: mobile ? -20 : 12, bottom: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--ink-line)" />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={mobile ? 45 : 55} tickLine={false} axisLine={false} stroke="var(--ink-soft)" fontSize={12} />
            <YAxis tickFormatter={v => new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: data.currency, maximumFractionDigits: 1 }).format(Number(v) / 100)} tickLine={false} axisLine={false} stroke="var(--ink-soft)" fontSize={12} />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className={s.tooltip}><b>{shortDate(String(label))}</b>{payload.map(p => <div key={String(p.dataKey)}><span>{p.dataKey === metric ? (metric === "collected" ? "Recorded" : "Paid-period value") : "Projected"}</span><strong>{money(Number(p.value))}</strong></div>)}{metric === "collected" && payload[0]?.payload.daily != null && <div><span>That day</span><strong>{money(payload[0].payload.daily)}</strong></div>}</div> : null} />
            <ReferenceLine x={today} stroke="var(--ink-muted)" strokeDasharray="3 4" label={{ value: "Today", position: "insideTopLeft", fill: "var(--ink-soft)", fontSize: 12 }} />
            <Line type="stepAfter" dataKey={metric} stroke="var(--accent)" strokeWidth={3} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line type="stepAfter" dataKey={futureKeys[metric]} stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="6 5" dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart></ResponsiveContainer>
        </div>
        <div className={s.forecast}><div><span className={s.eyebrow}>In 30 days · projected</span><strong>{money(predicted)}<ArrowUpRight size={22} /></strong></div><p>{data.eligibleTrials} eligible trials<br /><span>Saved payment method · not guaranteed</span></p></div>
      </section>
      <div className={s.supportGrid}><section className={s.sheet}><h2>Collection health</h2><dl className={s.health}><div><dt>Overdue invoices</dt><dd className={data.overdue ? s.danger : ""}>{money(data.overdue)}</dd></div><div><dt>Trials outside forecast</dt><dd>{data.excludedTrials}</dd></div><div><dt>Lifetime receipts</dt><dd>{money(data.gross)}</dd></div><div><dt>Refunded</dt><dd>{money(data.refunds)}</dd></div></dl></section><section className={s.sheet}><h2>Next payments</h2><div className={s.upcoming}>{data.customers.filter(c => c.nextDate && (c.nextAmount || 0) > 0).sort((a, b) => a.nextDate!.localeCompare(b.nextDate!)).slice(0, 5).map(c => <div key={c.id}><time>{shortDate(revenueDate(Date.parse(c.nextDate!) / 1000))}</time><span>{c.name}<small>{c.forecast}</small></span><strong>{money(c.nextAmount!)}</strong></div>)}</div><button className={s.textButton} onClick={() => setTab("users")}>All customers →</button></section></div>
      <ToolPlansSection data={data.toolPlans} currency={data.currency} mobile={mobile} />
      <details className={s.method}><summary>How these numbers work</summary><p>MRR uses JobFlex’s existing active-subscription rule: monthly-normalized recurring prices, standing discounts, no trials, paused or overdue subscriptions. ARR is MRR × 12. History is reconstructed from paid recurring invoice periods, excluding prorations; it is not a complete history of subscription changes.</p><p>Collected means captured subscription payments, less successful refunds and dispute balance movements, before Stripe fees, including any tax charged. It excludes manual marked-paid invoices, free invoices and proposal payments. All dates are Pacific time; totals use {data.currency.toUpperCase()} only.</p><p>The 30-day projection includes next invoice previews for eligible active subscriptions and trials with a default payment method that has not expired. Known cancellations reduce future MRR. Failed, overdue, paused, cardless and already-canceling trials are excluded. Future declines and cancellations cannot be known; prices and standing discounts are assumed unchanged. A saved payment method is not a guarantee of collection.</p></details>
    </> : <section className={s.sheet}>
      <div className={s.filters}><label className={s.search}><Search size={18} /><input aria-label="Find customer" placeholder="Find customer" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label><select aria-label="Customer status" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">All customers</option><option value="paying">Paying</option><option value="trialing">Trialing</option><option value="overdue">Overdue</option><option value="canceled">Canceled</option></select></div>
      {mobile ? <div className={s.userCards}>{shown.map(c => <article key={c.id}><h2>{c.name}</h2><p>{c.email}</p><span>{c.plans} · {c.status.replaceAll("_", " ")}</span><dl className={s.health}><div><dt>Collected</dt><dd>{money(c.collected)}</dd></div><div><dt>Monthly</dt><dd>{money(c.monthly)}</dd></div><div><dt>Next payment</dt><dd>{c.nextDate ? `${shortDate(revenueDate(Date.parse(c.nextDate) / 1000))} · ${money(c.nextAmount || 0)}` : "—"}</dd></div><div><dt>Overdue</dt><dd>{money(c.overdue)}</dd></div><div><dt>Payment method</dt><dd>{c.paymentMethod}</dd></div></dl><a href={`https://dashboard.stripe.com/${data.live ? "" : "test/"}customers/${c.id}`} target="_blank" rel="noreferrer">View in Stripe ↗</a></article>)}</div> : <div className={s.tableWrap}><table><thead><tr><th>Customer / Plan</th><th>Status</th><th>Collected</th><th>MRR</th><th>Next payment</th><th>Overdue</th></tr></thead><tbody>{shown.map(c => <tr key={c.id}><td><a href={`https://dashboard.stripe.com/${data.live ? "" : "test/"}customers/${c.id}`} target="_blank" rel="noreferrer">{c.name} ↗</a><small>{c.email}</small><small>{c.plans}</small></td><td>{c.status.replaceAll("_", " ")}<small>{c.paymentMethod}</small></td><td><b>{money(c.collected)}</b>{c.refunded > 0 && <small>{money(c.refunded)} refunded</small>}</td><td>{money(c.monthly)}</td><td>{c.nextDate ? <>{money(c.nextAmount || 0)}<small>{shortDate(revenueDate(Date.parse(c.nextDate) / 1000))} · {c.forecast}</small></> : "—"}</td><td className={c.overdue ? s.danger : ""}>{money(c.overdue)}</td></tr>)}</tbody></table></div>}
      {!shown.length && <p className={s.empty}>No customers match.</p>}
      <div className={s.pagination}><span>{users.length} customers</span><button className={s.button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><button className={s.button} disabled={(page + 1) * 20 >= users.length} onClick={() => setPage(p => p + 1)}>Next</button></div>
    </section>}
  </main>;
}
