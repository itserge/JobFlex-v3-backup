// FINANCIALS · PROJECTS (owner, 2026-11-04: "make sure it's gonna reflect on the financial page the project's
// financial profits"). One row a remodel: the contract before tax, what is spent, where the margin lands and what the
// client still owes — lib/projectMoney, the read behind the project page's Budget card and the Projects list, so the
// three never disagree. Server-rendered from the page's props; nothing on it writes.

import Link from "next/link";
import type { Route } from "next";
import type { FinancialsProject } from "./financials-data";
import s from "./financials-projects.module.css";

export type { FinancialsProject };

const whole = (n: number) => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");

function marginText(p: FinancialsProject): { text: string; sub: string; tone: string } {
  if (p.marginState === "none") return { text: "—", sub: "nothing priced yet", tone: "" };
  if (p.marginState === "short") return { text: `${whole(p.uncovered)} to price`, sub: "proposals cover less than the cost budget", tone: s.warn };
  const m = p.margin ?? 0;
  const pct = p.marginPct == null ? "" : `${Math.round(p.marginPct * 100)}%`;
  return {
    text: whole(m),
    sub: `${pct}${p.marginState === "projected" ? " · if the open proposals sell" : ""}`,
    tone: m < 0 ? s.bad : s.good,
  };
}

export function FinancialsProjects({ projects }: { projects: FinancialsProject[] }) {
  if (!projects.length) return null;
  const tot = projects.reduce(
    (a, p) => ({ contract: a.contract + p.contract, spent: a.spent + p.spent, collected: a.collected + p.collected, owed: a.owed + p.owed }),
    { contract: 0, spent: 0, collected: 0, owed: 0 },
  );
  const sold = projects.filter((p) => p.marginState === "sold" || p.marginState === "projected");
  const margin = sold.reduce((n, p) => n + (p.margin ?? 0), 0);
  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Projects" data-fin-projects>
        <div className={s.head}>
          <div>
            <div className={s.kicker}>Projects</div>
            <div className={s.sub}>What each remodel makes — contracts before sales tax, the cost budget against the spend.</div>
          </div>
          <div className={s.totals}>
            <span>
              Contracts <b>{whole(tot.contract)}</b>
            </span>
            <span>
              Spent <b>{whole(tot.spent)}</b>
            </span>
            {sold.length ? (
              <span>
                Projected margin <b className={margin < 0 ? s.bad : s.good}>{whole(margin)}</b>
              </span>
            ) : null}
            <span>
              Owed <b>{whole(tot.owed)}</b>
            </span>
          </div>
        </div>
        <div className={s.table} role="table">
          <div className={`${s.row} ${s.th}`} role="row">
            <span role="columnheader">Project</span>
            <span role="columnheader">Contract</span>
            <span role="columnheader">Spent</span>
            <span role="columnheader">Margin</span>
            <span role="columnheader">Paid · owed</span>
          </div>
          {projects.map((p) => {
            const m = marginText(p);
            return (
              <Link className={s.row} role="row" key={p.id} href={`/dashboard/projects/${p.id}` as Route}>
                <span role="cell" className={s.name}>
                  <b>{p.name}</b>
                  <i>
                    {[p.clientName, p.status === "ACTIVE" ? null : p.status.replace("_", " ").toLowerCase()].filter(Boolean).join(" · ") || "No client"}
                  </i>
                </span>
                <span role="cell" className={s.num}>
                  <em className={s.lbl}>Contract</em>
                  {whole(p.contract)}
                  {p.pipeline > 0 ? <i>+{whole(p.pipeline)} open</i> : null}
                </span>
                <span role="cell" className={s.num}>
                  <em className={s.lbl}>Spent</em>
                  {whole(p.spent)}
                  {p.budget > 0 ? <i>of {whole(p.budget)}</i> : <i>no budget</i>}
                </span>
                <span role="cell" className={`${s.num} ${m.tone}`}>
                  <em className={s.lbl}>Margin</em>
                  {m.text}
                  {m.sub ? <i>{m.sub}</i> : null}
                </span>
                <span role="cell" className={s.num}>
                  <em className={s.lbl}>Paid</em>
                  {whole(p.collected)}
                  <i>{p.owed > 0 ? `${whole(p.owed)} owed` : "nothing owed"}</i>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
