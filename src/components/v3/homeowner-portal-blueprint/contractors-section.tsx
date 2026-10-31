// CONTRACTORS, a section of /home/[key] (one page since 2026-10-31): every
// contractor a project is or was with — name, phone, Call / Text / Email in
// one row, booking and hire-again — then the service plans (memberships)
// they run or offered.
import Link from "next/link";
import type { HomeDashboard } from "@/lib/home/portal";
import { publicReviewsPath } from "@/lib/reviews/publicSummary";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, Section } from "./portal-frame";
import { newProjectHref, projectHref, projectTitle } from "./view";
import s from "./portal.module.css";

export function ContractorsSection({ h }: { h: HomeDashboard }) {
  return (
    <Section id="contractors" kicker="Who works on your house" title="Contractors">
      <div className={s.cols}>
        <div className={s.col}>
          {h.contractors.length === 0 ? (
            <section className={`${s.card} ${s.empty}`}>
              <h3 className={s.h3}>No contractors yet</h3>
              <p className={s.text}>When a local contractor takes one of your projects, they show up here with their phone and email.</p>
              <Link className={s.btnPrimary} href={newProjectHref(h.key)}>Start a project</Link>
            </section>
          ) : (
            h.contractors.map((c) => {
              const theirs = h.projects.filter((p) => p.current?.org.id === c.org.id || p.previous.some((x) => x.org.id === c.org.id));
              return (
                <section key={c.org.id} className={s.card} aria-labelledby={`org-${c.org.id}`} data-contractor>
                  <div className={s.stack}>
                    <h3 id={`org-${c.org.id}`} className={`${s.h2} ${s.entity}`}>{c.org.name}</h3>
                    <div className={s.meta}>
                      {c.org.phoneDisplay && <span className={s.num}>{c.org.phoneDisplay}</span>}
                      {c.org.place && <span>{c.org.place}</span>}
                      {c.org.rating && (
                        <a className={s.link} href={publicReviewsPath(c.org.slug)} target="_blank" rel="noopener noreferrer">
                          ★ {c.org.rating.avg.toFixed(1)} · {c.org.rating.count} review{c.org.rating.count === 1 ? "" : "s"}
                        </a>
                      )}
                    </div>
                  </div>
                  {(c.org.telHref || c.org.email) && (
                    <div className={s.contact}>
                      {c.org.telHref && <a className={s.btn} href={c.org.telHref}><Icon id="phone" small />Call</a>}
                      {c.org.smsHref && <a className={s.btn} href={c.org.smsHref}><Icon id="sms" small />Text</a>}
                      {c.org.email && <a className={s.btn} href={`mailto:${c.org.email}`}><Icon id="msg" small />Email</a>}
                    </div>
                  )}
                  {theirs.length > 0 && (
                    <>
                      <div className={s.rule} />
                      <ul className={s.rows}>
                        {theirs.map((p) => (
                          <li key={p.token} className={s.row} style={{ gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center" }}>
                            <Link className={`${s.h3} ${s.rowLink}`} href={projectHref(h.key, p.token)}>{projectTitle(p)}</Link>
                            <span className={s.muted}><LocalTime iso={p.submittedAt} kind="date" tz={h.timeZone} /></span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className={s.actions}>
                    <Link className={s.btn} href={newProjectHref(h.key, { with: c.org.id })}>Hire again</Link>
                    {c.bookingHref && <a className={s.btnText} href={c.bookingHref}>Book a visit online</a>}
                  </div>
                </section>
              );
            })
          )}
        </div>
        <div className={s.col}>
          <section className={s.card} aria-labelledby="plans-title">
            <h3 id="plans-title" className={s.h2}>Service plans</h3>
            {h.memberships.length === 0 ? (
              <p className={s.muted}>When a contractor offers you a maintenance plan — a yearly tune-up, a roof check — it shows up here.</p>
            ) : (
              <ul className={s.rows}>
                {h.memberships.map((m) => (
                  <li key={m.href} className={s.row}>
                    <div className={s.rowHead}>
                      <p className={s.h3}>{m.name}</p>
                      <span className={s.stamp} data-tone={m.status === "ACTIVE" ? "emerald" : "accent"}>{m.status === "ACTIVE" ? "Member" : "Offered to you"}</span>
                    </div>
                    <p className={s.muted}>
                      {m.orgName}
                      {m.nextVisit && <> · next visit <LocalTime iso={m.nextVisit.at} kind="day" tz={h.timeZone} /> — {m.nextVisit.label}</>}
                      {m.endsAt && m.status === "ACTIVE" && <> · through <LocalTime iso={m.endsAt} kind="date" tz={h.timeZone} /></>}
                    </p>
                    <div className={s.actions}><a className={m.status === "SENT" ? s.btnPrimary : s.btn} href={m.href}>{m.status === "SENT" ? "See the plan" : "Open"}</a></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Section>
  );
}
