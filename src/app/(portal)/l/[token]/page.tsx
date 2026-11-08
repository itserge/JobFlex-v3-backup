// THE LENDER'S PAGE — /l/<token> (2026-11-08, the plan "Projects: Remodel and New construction", part 7). One
// read-only link for the bank that pays a new build in draws: the house's progress, the phases and what closes each,
// the draw schedule with the bundle the office took at each request, the inspections with their results, and the
// photos the office chose for the client. Never the budget, the basis, the margin or a note; no buttons. The token is
// the only key (lib/projectClient lenderView). Styled by the homeowner's client.css plus ./lender.css.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lenderView } from "@/lib/projectClient/server";
import "../../p/[token]/client.css";
import "./lender.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Construction loan draws — JobFlex",
  description: "The draw schedule and where the house stands.",
  robots: { index: false, follow: false },
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayUTC = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const stateWords = (state: "done" | "now" | "next") => (state === "done" ? "done" : state === "now" ? "in progress" : "coming up");

function inspectionWords(i: { result: string; date: string | null }): string {
  const when = i.date ? ` ${dayUTC(i.date)}` : "";
  if (i.result === "PASSED") return `passed${when}`;
  if (i.result === "FAILED") return `failed${when} — to be redone`;
  return i.date ? `booked${when}` : "ahead";
}

export default async function LenderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) notFound();
  const v = await lenderView(token);
  if (!v) notFound();
  const done = v.progress.done ?? 0;
  const contact = [v.company.phone ?? null, v.company.email ?? null].filter((x): x is string => !!x);

  return (
    <main className="jf-client jf-lender">
      <div className="cl-card">
        <header className="cl-head">
          {v.company.logoUrl && /^https?:\/\//.test(v.company.logoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cl-logo" src={v.company.logoUrl} alt="" />
          ) : null}
          <p className="cl-kicker">
            {v.company.name} · Construction loan · draws{v.project.number ? ` · ${v.project.number}` : ""}
          </p>
          <h1 className="cl-title">{v.project.name}</h1>
          <p className="cl-sub" data-lender-sub>
            {v.project.borrower ? `Borrower: ${v.project.borrower}. ` : ""}
            {v.progress.words}. Read-only, as of {longDay(v.asOf)}.
          </p>
        </header>

        <section className="cl-sec" aria-label="Progress">
          <div className="cl-barRow">
            <div className="cl-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, done)}%` }} />
            </div>
            <b className="cl-pct">{v.progress.done != null ? `${done}%` : ""}</b>
          </div>
        </section>

        <section className="cl-sec" aria-label="Draws" data-lender-draws>
          <h2 className="cl-lab">Draws</h2>
          {v.draws.rows.length ? (
            <>
              <p className="cl-drawHead" data-lender-draws-head>
                <b>{money(v.draws.funded)}</b> funded of {money(v.draws.total)}
                {v.draws.requested ? ` · ${money(v.draws.requested)} requested` : ""}
                {v.draws.held ? ` · ${money(v.draws.held)} retainage held` : ""}
              </p>
              <ul className="cl-list">
                {v.draws.rows.map((d) => (
                  <li key={d.number} className="cl-row cl-draw" data-lender-draw data-draw-state={d.state}>
                    <b>
                      {d.number}. {d.name}
                    </b>
                    <span className="cl-drawAmt">{money(d.amount)}</span>
                    <span className={`cl-drawState is-${d.state}`}>
                      {d.words}
                      {d.state === "FUNDED" && d.fundedAmount != null && Math.round(d.fundedAmount) !== Math.round(d.released) ? ` · ${money(d.fundedAmount)} landed` : ""}
                    </span>
                    {d.bundle ? (
                      <p className="cl-bundle" data-lender-bundle>
                        {d.bundle}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="cl-note">The draw schedule is not laid out yet.</p>
          )}
        </section>

        {v.phases.length ? (
          <section className="cl-sec" aria-label="Phases" data-lender-phases>
            <h2 className="cl-lab">Phases</h2>
            <ol className="cl-stages">
              {v.phases.map((ph) => {
                const sub = [ph.stageCount ? `${ph.stagesDone} of ${ph.stageCount} stage${ph.stageCount === 1 ? "" : "s"}` : null, ph.state !== "done" && ph.gate ? ph.gate : null].filter(Boolean).join(" · ");
                return (
                  <li key={ph.id} className={`cl-stage is-${ph.state}`} data-lender-phase data-phase-state={ph.state}>
                    <span className="cl-mark" aria-hidden="true">
                      {ph.state === "done" ? "✓" : ph.state === "now" ? "▶" : ""}
                    </span>
                    <span className="cl-stageName">
                      {ph.name}
                      {sub ? <small className="cl-stageSub">{sub}</small> : null}
                    </span>
                    <span className="cl-stageState">{stateWords(ph.state)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {v.inspections.length ? (
          <section className="cl-sec" aria-label="Inspections" data-lender-inspections>
            <h2 className="cl-lab">Inspections</h2>
            <ul className="cl-list">
              {v.inspections.map((i, n) => (
                <li key={`${i.name}-${n}`} className="cl-row cl-insp" data-lender-inspection data-result={i.result}>
                  <b>
                    {i.name}
                    {i.stage ? <small className="cl-stageSub">{i.stage}</small> : null}
                  </b>
                  <span className={`is-${i.result}`}>{inspectionWords(i)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.photoGroups.length ? (
          <section className="cl-sec" aria-label="Photos">
            <h2 className="cl-lab">Photos</h2>
            {v.photoGroups.map((g, i) => (
              <div key={g.phase ?? `more-${i}`} className="cl-photoGroup">
                {g.phase ? <p className="cl-groupLab">{g.phase}</p> : v.photoGroups.length > 1 ? <p className="cl-groupLab">More photos</p> : null}
                <div className="cl-photos">
                  {g.photos.map((p) => (
                    <a key={p.id} className="cl-photo" href={p.href} target="_blank" rel="noreferrer" title={p.caption ?? day(p.at)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.href} alt={p.caption ?? "Site photo"} loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <footer className="cl-foot">
          Prepared by {v.company.name}
          {contact.length ? ` · ${contact.join(" · ")}` : ""}. Figures as the builder recorded them; the retainage is released with the final draw.
        </footer>
      </div>
    </main>
  );
}
