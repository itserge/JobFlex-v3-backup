// THE HOMEOWNER'S PROJECT PAGE — /p/<token> (the client build, 2026-11-06). One link, no sign-in: where their
// project stands (% done, the stages ticked), the next days the crew is on site, the photos the office chose, the
// documents marked for them, what is paid and the next payment with its Pay button (the proposal's own pay page).
// The token is the only key and the page shows this one project. Styled by ./client.css (root `.jf-client`), the
// sibling of /buy/[token]'s buy.css. Server-rendered; the one write is the homeowner's choice (./choices.tsx).
//
// Part 7 (2026-11-08, the plan "Projects: Remodel and New construction"): on a new build the phases stand in for the
// stage list — where each stands and what closes it, in the homeowner's words — the choices to make carry the day
// each is needed by and a box to answer, the construction loan's draws show as the borrower reads them, the photos
// sit under their phase, and a cost-plus contract (only) shows the costs so far.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientView } from "@/lib/projectClient/server";
import { Choices } from "./choices";
import "./client.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your project — JobFlex",
  description: "Where your project stands.",
  robots: { index: false, follow: false },
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const stateWords = (state: "done" | "now" | "next") => (state === "done" ? "done" : state === "now" ? "in progress" : "coming up");

export default async function ClientProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) notFound();
  const v = await clientView(token);
  if (!v) notFound();
  const done = v.progress.done ?? 0;
  const owed = v.payments.reduce((n, p) => n + p.remaining, 0);
  const contact = [v.company.phone ? { href: `tel:${v.company.phone.replace(/[^\d+]/g, "")}`, text: v.company.phone } : null, v.company.email ? { href: `mailto:${v.company.email}`, text: v.company.email } : null].filter((x): x is { href: string; text: string } => !!x);
  const byPhase = v.phases.length > 0;

  return (
    <main className="jf-client">
      <div className="cl-card">
        <header className="cl-head">
          {v.company.logoUrl && /^https?:\/\//.test(v.company.logoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cl-logo" src={v.company.logoUrl} alt="" />
          ) : null}
          <p className="cl-kicker">
            {v.company.name} · {v.project.kind === "NEW_BUILD" ? "Your new home" : "Your project"}{v.project.number ? ` · ${v.project.number}` : ""}
          </p>
          <h1 className="cl-title">{v.project.name}</h1>
          <p className="cl-sub">
            {v.project.clientFirst ? `Hi ${v.project.clientFirst} — ` : ""}
            {v.finished ? "the work is finished." : `${v.progress.words.charAt(0).toLowerCase()}${v.progress.words.slice(1)}.`}
          </p>
        </header>

        {v.progress.stages.length ? (
          <section className="cl-sec" aria-label="Progress">
            <div className="cl-barRow">
              <div className="cl-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, done)}%` }} />
              </div>
              <b className="cl-pct">{v.progress.done != null ? `${done}%` : ""}</b>
            </div>
            {byPhase ? (
              <ol className="cl-stages" data-client-phases>
                {v.phases.map((ph) => {
                  const sub = [ph.stageCount ? `${ph.stagesDone} of ${ph.stageCount} stage${ph.stageCount === 1 ? "" : "s"}` : null, ph.state !== "done" && ph.gate ? ph.gate : null].filter(Boolean).join(" · ");
                  return (
                    <li key={ph.id} className={`cl-stage is-${ph.state}`} data-client-phase data-phase-state={ph.state}>
                      <span className="cl-mark" aria-hidden="true">
                        {ph.state === "done" ? "✓" : ph.state === "now" ? "▶" : ""}
                      </span>
                      <span className="cl-stageName">
                        {ph.name}
                        {sub ? <small className="cl-stageSub" data-phase-sub>{sub}</small> : null}
                      </span>
                      <span className="cl-stageState">{stateWords(ph.state)}</span>
                      {ph.stages.length ? (
                        <ul className="cl-phaseStages" data-phase-stages>
                          {ph.stages.map((s) => (
                            <li key={s.name} className={`is-${s.state}`}>
                              {s.name}
                              <span>{stateWords(s.state)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <ol className="cl-stages">
                {v.progress.stages.map((s) => (
                  <li key={s.name} className={`cl-stage is-${s.state}`}>
                    <span className="cl-mark" aria-hidden="true">
                      {s.state === "done" ? "✓" : s.state === "now" ? "▶" : ""}
                    </span>
                    <span className="cl-stageName">{s.name}</span>
                    <span className="cl-stageState">{stateWords(s.state)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        {v.selections.length ? (
          <section className="cl-sec" aria-label="Your choices">
            <h2 className="cl-lab">Your choices</h2>
            <Choices token={token} selections={v.selections} />
          </section>
        ) : null}

        {v.nextDays.length ? (
          <section className="cl-sec" aria-label="Next on site">
            <h2 className="cl-lab">Next on site</h2>
            <ul className="cl-list">
              {v.nextDays.map((d) => (
                <li key={d.day} className="cl-row">
                  <b>{d.label}</b>
                  <span>{d.jobTitle}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.photoGroups.length ? (
          <section className="cl-sec" aria-label="Photos">
            <h2 className="cl-lab">Photos</h2>
            {v.photoGroups.map((g, i) => (
              <div key={g.phase ?? `more-${i}`} className="cl-photoGroup" data-photo-group={g.phase ?? ""}>
                {g.phase ? <p className="cl-groupLab">{g.phase}</p> : v.photoGroups.length > 1 ? <p className="cl-groupLab">More photos</p> : null}
                <div className="cl-photos">
                  {g.photos.map((p) => (
                    <a key={p.id} className="cl-photo" href={p.href} target="_blank" rel="noreferrer" title={p.caption ?? day(p.at)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.href} alt={p.caption ?? "Project photo"} loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {v.files.length ? (
          <section className="cl-sec" aria-label="Documents">
            <h2 className="cl-lab">Documents</h2>
            <ul className="cl-list">
              {v.files.map((f) => (
                <li key={f.id} className="cl-row">
                  <a href={f.href} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                  <span>{f.kindLabel}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.payments.length ? (
          <section className="cl-sec" aria-label="Payments">
            <h2 className="cl-lab">Payments</h2>
            {v.payments.map((p) => (
              <div key={p.title} className="cl-pay">
                <div className="cl-row">
                  <b>{p.title}</b>
                  <span>
                    {money(p.paid)} paid of {money(p.total)}
                  </span>
                </div>
                {p.next ? (
                  <div className="cl-payNext">
                    <span>
                      Next: <b>{p.next.label}</b> · {money(p.next.amount)}
                    </span>
                    <a className="cl-btn" href={p.next.href}>
                      Pay {money(p.next.amount)}
                    </a>
                  </div>
                ) : p.remaining > 0.5 ? (
                  <p className="cl-note">{money(p.remaining)} is billed later, as the work goes.</p>
                ) : (
                  <p className="cl-note">Paid in full — thank you.</p>
                )}
              </div>
            ))}
            {owed <= 0.5 && v.payments.length > 1 ? <p className="cl-note">Everything is paid — thank you.</p> : null}
          </section>
        ) : null}

        {v.draws ? (
          <section className="cl-sec" aria-label="Your construction loan" data-client-draws>
            <h2 className="cl-lab">Your construction loan</h2>
            <p className="cl-drawHead" data-client-draws-head>
              <b>{money(v.draws.funded)}</b> funded of {money(v.draws.total)}
              {v.draws.held ? ` · ${money(v.draws.held)} held back until the end` : ""}
            </p>
            <ul className="cl-list">
              {v.draws.rows.map((d) => (
                <li key={d.number} className="cl-row cl-draw" data-client-draw data-draw-state={d.state}>
                  <b>
                    {d.number}. {d.name}
                  </b>
                  <span className="cl-drawAmt">{money(d.amount)}</span>
                  <span className={`cl-drawState is-${d.state}`}>{d.words}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.costs ? (
          <section className="cl-sec" aria-label="Costs so far" data-client-costs>
            <h2 className="cl-lab">Costs so far</h2>
            <p className="cl-note">{v.costs.words}</p>
            <ul className="cl-list">
              {v.costs.rows.map((r) => (
                <li key={r.phase} className="cl-row">
                  <b>{r.phase}</b>
                  <span>{money(r.spent)}</span>
                </li>
              ))}
              <li className="cl-row">
                <b>So far</b>
                <span>{money(v.costs.total)}</span>
              </li>
            </ul>
          </section>
        ) : null}

        {v.finished ? (
          <section className="cl-sec" aria-label="Finished">
            <p className="cl-note">
              The work is finished{v.finalInspectionPassed ? " and passed its final inspection" : ""}.{v.warrantyUntil ? ` Your warranty runs until ${new Date(`${v.warrantyUntil}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.` : ""}
            </p>
          </section>
        ) : null}

        <footer className="cl-foot">
          Questions? {contact.length ? contact.map((c, i) => (
            <span key={c.href}>
              {i ? " · " : ""}
              <a href={c.href}>{c.text}</a>
            </span>
          )) : `Reach ${v.company.name} the usual way.`}
          {v.company.website ? (
            <>
              {" · "}
              <a href={/^https?:\/\//.test(v.company.website) ? v.company.website : `https://${v.company.website}`} target="_blank" rel="noreferrer">
                {v.company.website.replace(/^https?:\/\//, "")}
              </a>
            </>
          ) : null}
        </footer>
      </div>
    </main>
  );
}
