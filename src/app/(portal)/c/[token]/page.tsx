// THE CLIENT'S HOME PAGE — /c/[token] (2026-11-10, Smart CRM part 5). One lasting link per client, made by the
// office (the client's record → Client's page) and sent by text or email: their proposals with what is paid and what
// is left, what waits for their OK, their projects, the next visits and work days, plan visits, documents, a review if
// one was asked for, and the messages with the company — they can write back, and it lands in the office's Inbox.
// No account: the token is the key (lib/clientHome). `?preview=1` is the office's look and doesn't mark it opened.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientHomeView } from "@/lib/clientHome/server";
import { greeting } from "@/lib/clientHome/shared";
import { MessageBox } from "./message-box";
import "./home.css";
import { publicLinkPaused } from "@/lib/publicLinks";
import { LinkPaused } from "@/components/v3/upgrade-gate/link-paused";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your job — in one place",
  description: "Your proposals, payments, schedule, documents and messages with your contractor.",
  robots: { index: false, follow: false },
};

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export default async function ClientHomePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { token } = await params;
  const { preview } = await searchParams;
  // Paused while the company is on the Free plan (owner, 2026-11-09; lib/publicLinks) — nothing read, nothing stamped.
  if (await publicLinkPaused("client-home", token)) return <LinkPaused />;
  const v = await clientHomeView(token, { stamp: preview !== "1" });
  if (!v) notFound();
  const sold = v.money.contract > 0;
  return (
    <main className="jf-chome" data-client-home>
      <div className="ch-card">
        <header className="ch-head">
          {v.org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ch-logo" src={v.org.logoUrl} alt="" />
          ) : null}
          <p className="ch-kicker">{v.org.name}</p>
          <h1 className="ch-title">{greeting(v.client.name)}</h1>
          <p className="ch-sub">Everything for your job with {v.org.name}, in one place. Save this page — the link stays the same.</p>
          <div className="ch-acts">
            {v.org.phone ? (
              <a className="ch-btn ch-btn--ghost" href={`tel:${v.org.phone.replace(/[^\d+]/g, "")}`}>
                Call {v.org.phone}
              </a>
            ) : null}
            {v.org.bookHref ? (
              <a className="ch-btn" href={v.org.bookHref} data-home-book>
                Book a visit
              </a>
            ) : null}
          </div>
        </header>

        {sold ? (
          <section className="ch-sec" aria-label="Payments" data-home-money>
            <p className="ch-lab">Payments</p>
            <div className="ch-figs">
              <div>
                <span>Total</span>
                <b>{money(v.money.contract)}</b>
              </div>
              <div>
                <span>Paid</span>
                <b className="ch-good">{money(v.money.paid)}</b>
              </div>
              <div>
                <span>Left</span>
                <b>{money(v.money.left)}</b>
              </div>
            </div>
            <div className="ch-bar" aria-hidden="true">
              <i style={{ width: `${v.money.contract > 0 ? Math.min(100, Math.round((v.money.paid / v.money.contract) * 100)) : 0}%` }} />
            </div>
          </section>
        ) : null}

        {v.waiting.length ? (
          <section className="ch-sec" aria-label="Waiting for you" data-home-waiting>
            <p className="ch-lab">Waiting for your OK</p>
            <ul className="ch-list">
              {v.waiting.map((w) => (
                <li className="ch-row" key={w.href ?? w.title}>
                  <a href={w.href ?? "#"}>{w.title}</a>
                  <span>{w.note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.proposals.length ? (
          <section className="ch-sec" aria-label="Proposals" data-home-proposals>
            <p className="ch-lab">Proposals</p>
            <ul className="ch-props">
              {v.proposals.map((p) => (
                <li className={`ch-prop ch-prop--${p.tone}`} key={p.id} data-home-proposal>
                  <div className="ch-propTop">
                    <a href={p.href}>{p.title}</a>
                    <b>{money(p.contract)}</b>
                  </div>
                  <div className="ch-propMeta">
                    <span className="ch-chip">{p.label}</span>
                    <span>{p.when}</span>
                    {p.paid > 0 && p.left > 0 ? <span>{money(p.paid)} paid · {money(p.left)} left</span> : null}
                    {p.late ? <span className="ch-due">a payment is due</span> : null}
                  </div>
                  {p.payHref ? (
                    <a className="ch-btn ch-btn--pay" href={p.payHref} data-home-pay>
                      Pay {money(p.payAmount)}
                    </a>
                  ) : p.tone === "wait" ? (
                    <a className="ch-btn ch-btn--ghost" href={p.href}>
                      Review and sign
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.upcoming.length ? (
          <section className="ch-sec" aria-label="Coming up" data-home-upcoming>
            <p className="ch-lab">Coming up</p>
            <ul className="ch-list">
              {v.upcoming.map((u, i) => (
                <li className="ch-row" key={`${u.title}-${i}`}>
                  <b>{u.title}</b>
                  <span>{u.when}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.projects.length ? (
          <section className="ch-sec" aria-label="Projects" data-home-projects>
            <p className="ch-lab">Projects</p>
            <ul className="ch-list">
              {v.projects.map((p) => (
                <li className="ch-row" key={p.title}>
                  {p.href ? <a href={p.href}>{p.title} — progress, photos, documents</a> : <b>{p.title}</b>}
                  <span>{p.when}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.plans.length ? (
          <section className="ch-sec" aria-label="Service plans" data-home-plans>
            <p className="ch-lab">Service plan</p>
            <ul className="ch-list">
              {v.plans.map((p) => (
                <li className="ch-row" key={p.title}>
                  {p.href ? <a href={p.href}>{p.title} — sign it here</a> : <b>{p.title}</b>}
                  <span>{p.when}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.documents.length ? (
          <section className="ch-sec" aria-label="Documents" data-home-documents>
            <p className="ch-lab">Documents</p>
            <ul className="ch-list">
              {v.documents.map((d) => (
                <li className="ch-row" key={d.href ?? d.title}>
                  <a href={d.href ?? "#"} target="_blank" rel="noopener noreferrer">
                    {d.title}
                  </a>
                  <span>{d.when}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.review ? (
          <section className="ch-sec" aria-label="Review" data-home-review>
            <p className="ch-lab">How did we do?</p>
            <a className="ch-btn ch-btn--ghost" href={v.review}>
              Leave a review
            </a>
          </section>
        ) : null}

        <section className="ch-sec" aria-label="Messages" data-home-messages>
          <p className="ch-lab">Messages</p>
          {v.messages.length ? (
            <ol className="ch-msgs">
              {v.messages.map((m) => (
                <li key={m.id} className={m.mine ? "ch-msg ch-msg--mine" : "ch-msg"} data-home-message>
                  <div className="ch-msgWho">
                    {m.mine ? "You" : v.org.name} · {m.when}
                    {m.via === "email" ? " · email" : ""}
                  </div>
                  <p>{m.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ch-empty">No messages yet.</p>
          )}
          {v.canWrite ? <MessageBox token={v.token} company={v.org.name} /> : null}
        </section>

        <p className="ch-foot">
          {v.org.name}
          {v.org.phone ? ` · ${v.org.phone}` : ""}
          {v.org.email ? ` · ${v.org.email}` : ""}
          <br />
          This page is just for you — anyone with the link can open it, so share it only with people you trust.
        </p>
      </div>
    </main>
  );
}
