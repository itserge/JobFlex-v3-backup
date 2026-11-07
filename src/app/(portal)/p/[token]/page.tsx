// THE HOMEOWNER'S PROJECT PAGE — /p/<token> (the client build, 2026-11-06). One link, no sign-in: where their
// project stands (% done, the stages ticked), the next days the crew is on site, the photos the office chose, the
// documents marked for them, what is paid and the next payment with its Pay button (the proposal's own pay page).
// The token is the only key and the page shows this one project. Styled by ./client.css (root `.jf-client`), the
// sibling of /buy/[token]'s buy.css. Server-rendered; nothing here writes.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientView } from "@/lib/projectClient/server";
import "./client.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your project — JobFlex",
  description: "Where your project stands.",
  robots: { index: false, follow: false },
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function ClientProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) notFound();
  const v = await clientView(token);
  if (!v) notFound();
  const done = v.progress.done ?? 0;
  const owed = v.payments.reduce((n, p) => n + p.remaining, 0);
  const contact = [v.company.phone ? { href: `tel:${v.company.phone.replace(/[^\d+]/g, "")}`, text: v.company.phone } : null, v.company.email ? { href: `mailto:${v.company.email}`, text: v.company.email } : null].filter((x): x is { href: string; text: string } => !!x);

  return (
    <main className="jf-client">
      <div className="cl-card">
        <header className="cl-head">
          {v.company.logoUrl && /^https?:\/\//.test(v.company.logoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cl-logo" src={v.company.logoUrl} alt="" />
          ) : null}
          <p className="cl-kicker">
            {v.company.name} · Your project{v.project.number ? ` · ${v.project.number}` : ""}
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
            <ol className="cl-stages">
              {v.progress.stages.map((s) => (
                <li key={s.name} className={`cl-stage is-${s.state}`}>
                  <span className="cl-mark" aria-hidden="true">
                    {s.state === "done" ? "✓" : s.state === "now" ? "▶" : ""}
                  </span>
                  <span className="cl-stageName">{s.name}</span>
                  <span className="cl-stageState">{s.state === "done" ? "done" : s.state === "now" ? "in progress" : "coming up"}</span>
                </li>
              ))}
            </ol>
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

        {v.photos.length ? (
          <section className="cl-sec" aria-label="Photos">
            <h2 className="cl-lab">Photos</h2>
            <div className="cl-photos">
              {v.photos.map((p) => (
                <a key={p.id} className="cl-photo" href={p.href} target="_blank" rel="noreferrer" title={p.caption ?? day(p.at)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.href} alt={p.caption ?? "Project photo"} loading="lazy" />
                </a>
              ))}
            </div>
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
