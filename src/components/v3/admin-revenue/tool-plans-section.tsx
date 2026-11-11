// ADMIN → REVENUE: THE NEW PLANS (Base + Tools, part 5 — owner, 2026-11-10: "the numbers: MRR by tool, tries kept,
// Classic vs new"). The figures lib/toolPlans/numbers works out from the same subscriber rows as the MRR above it:
// four tiles, the sizes and the tools as tables (cards on a phone), the free tries in one line. No chart — a handful
// of numbers reads better as numbers. Presentational only (no hooks): the client page and the server's
// "Revenue unavailable" page (Stripe not set up — a dev stand) both draw it.

import type { ToolPlansReport } from "@/lib/toolPlans/numbers";
import s from "./revenue.module.css";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ToolPlansSection({ data, currency, mobile = false }: { data: ToolPlansReport | undefined; currency: string; mobile?: boolean }) {
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
  const head = (
    <div className={s.toolsHead}>
      <div>
        <p className={s.eyebrow}>Base + Tools</p>
        <h2 id="tool-plans-title">New plans (Base + Tools)</h2>
      </div>
      {data ? <span className={s.toolsSwitch} data-tool-plans-switch={data.switchOn ? "on" : "off"}>{data.switchOn ? "Plans switch on: new sign-ups get these plans" : "Plans switch off: new sign-ups get Classic"}</span> : null}
    </div>
  );
  if (!data || data.empty) {
    return (
      <section className={`${s.sheet} ${s.tools}`} aria-labelledby="tool-plans-title" data-tool-plans={data ? "empty" : "pending"}>
        {head}
        <p className={s.toolsEmpty}>{data ? "No shop is on the new plans yet." : "The new plans' numbers come with the next Stripe read. Press Refresh to read them now."}</p>
      </section>
    );
  }
  const t = data.tries;
  const decided = t.kept + t.removed + t.declined;
  const sizes = data.bySize.filter((x) => x.shops > 0 || x.mrrCents > 0);
  const tools = data.byTool.filter((x) => x.paying > 0 || x.mainOf > 0 || x.tries.started > 0 || x.mrrCents > 0);
  const tile = (label: string, value: string, note: string, key: string) => (
    <div className={s.toolsTile} data-tool-plans-tile={key}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
  return (
    <section className={`${s.sheet} ${s.tools}`} aria-labelledby="tool-plans-title" data-tool-plans="numbers">
      {head}
      <div className={s.toolsTiles}>
        {tile("New plans MRR", money(data.mrr.newCents), `${data.paying} paying of ${plural(data.shops, "shop")} · ${data.trialing} in trial`, "new")}
        {tile("Classic MRR", money(data.mrr.classicCents), `${plural(data.mrr.classicSubs, "paying subscription")}`, "classic")}
        {tile("On the new plans", pct(data.mrr.newShare), "of all MRR", "share")}
        {tile("Free tries kept", pct(t.keepRate), decided ? `${t.kept} of ${decided} decided · ${t.open} still open` : `${t.open} still open, none decided yet`, "kept")}
      </div>

      <div className={s.toolsBlock}>
        <h3>By size</h3>
        {!sizes.length ? (
          <p className={s.toolsNote}>No live subscription on a size yet.</p>
        ) : mobile ? (
          <div className={s.toolsCards}>
            {sizes.map((x) => (
              <article key={x.plan} data-tool-plans-size={x.plan}>
                <div><b>{x.name}</b><strong>{money(x.mrrCents)}</strong></div>
                <p>{plural(x.shops, "shop")} · {x.paying} paying · {x.trialing} in trial{x.extraPeople ? ` · +${plural(x.extraPeople, "person", "people")}` : ""}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table>
              <thead><tr><th>Size</th><th>Shops</th><th>Paying</th><th>In trial</th><th>Extra people</th><th>MRR · plan + people</th></tr></thead>
              <tbody>
                {sizes.map((x) => (
                  <tr key={x.plan} data-tool-plans-size={x.plan}><td><b>{x.name}</b></td><td>{x.shops}</td><td>{x.paying}</td><td>{x.trialing}</td><td>{x.extraPeople}</td><td><b>{money(x.mrrCents)}</b></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={s.toolsBlock}>
        <h3>By tool</h3>
        {!tools.length ? (
          <p className={s.toolsNote}>No tool is on a bill, a main tool or tried yet.</p>
        ) : mobile ? (
          <div className={s.toolsCards}>
            {tools.map((x) => (
              <article key={x.tool} data-tool-plans-tool={x.tool}>
                <div><b>{x.label}</b><strong>{money(x.mrrCents)}</strong></div>
                <p>Main tool of {x.mainOf} · on {x.paying} paying {x.paying === 1 ? "bill" : "bills"}</p>
                <p>{plural(x.tries.started, "try", "tries")}: {x.tries.kept} kept · {x.tries.removed} removed · {x.tries.declined} declined · kept {pct(x.tries.keepRate)}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table>
              <thead><tr><th>Tool</th><th>Main tool of</th><th>Paying</th><th>MRR</th><th>Tries</th><th>Kept</th><th>Removed</th><th>Declined</th><th>Keep rate</th></tr></thead>
              <tbody>
                {tools.map((x) => (
                  <tr key={x.tool} data-tool-plans-tool={x.tool}><td><b>{x.label}</b></td><td>{x.mainOf}</td><td>{x.paying}</td><td><b>{money(x.mrrCents)}</b></td><td>{x.tries.started}</td><td>{x.tries.kept}</td><td>{x.tries.removed}</td><td>{x.tries.declined}</td><td>{pct(x.tries.keepRate)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className={s.toolsLine} data-tool-plans-tries>
        Free tries: {t.started} started · {t.open} still open · {t.kept} kept · {t.removed} removed · {t.declined} declined (card) · {plural(t.reminded, "reminder")} sent
      </p>
      <div className={s.toolsFoot}>
        <p>MRR is the page&apos;s MRR rule: active, billed subscriptions after coupons, no trials. By size and by tool are the lines&apos; amounts a month, a yearly line ÷ 12. A try counts as kept when it went on the bill, or when its tool became the main tool or the size took it in.</p>
        {data.coupons.rows ? <p>{plural(data.coupons.rows, "paying shop")} on the new plans {data.coupons.rows === 1 ? "has" : "have"} a coupon: the lines add up to {money(data.coupons.gapCents)} a month more than their MRR.</p> : null}
        {data.unpriced ? <p>{plural(data.unpriced, "paying subscription")} had no lines to read: in the MRR, left out of by size and by tool.</p> : null}
        {data.source === "record" ? <p>Stripe isn&apos;t read here: these come from the platform&apos;s own record, priced at the plans&apos; list prices.</p> : null}
      </div>
    </section>
  );
}
