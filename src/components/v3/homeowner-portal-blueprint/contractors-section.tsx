// CONTRACTORS, a section of /home/[key] (one page since 2026-10-31): one
// row per contractor a project is or was with — name, the work they do for
// this house, then Call / Text / Email as square icons on the right; "Hire
// again" and online booking as quiet links in the row. Service plans
// (memberships) follow only when there are any.
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
      {h.contractors.length === 0 ? (
        <div className={`${s.card} ${s.empty}`}>
          <h3 className={s.h3}>No contractors yet</h3>
          <p className={s.text}>When a local contractor takes one of your projects, they show up here with their phone and email.</p>
          <Link className={s.btnPrimary} href={newProjectHref(h.key)}>Start a project</Link>
        </div>
      ) : (
        <ul className={`${s.card} ${s.list}`}>
          {h.contractors.map((c) => {
            const theirs = h.projects.filter((p) => p.current?.org.id === c.org.id || p.previous.some((x) => x.org.id === c.org.id));
            return (
              <li key={c.org.id} className={s.person} data-contractor>
                <div className={s.personText}>
                  <p className={s.h3}>{c.org.name}</p>
                  <p className={s.sub}>
                    {theirs.map((p, i) => (
                      <span key={p.token}>{i > 0 ? ", " : ""}<Link className={s.inlineLink} href={projectHref(h.key, p.token)}>{projectTitle(p)}</Link></span>
                    ))}
                    {c.org.rating && (
                      <> · <a className={s.inlineLink} href={publicReviewsPath(c.org.slug)} target="_blank" rel="noopener noreferrer">★ {c.org.rating.avg.toFixed(1)}</a></>
                    )}
                    {" · "}<Link className={s.inlineLink} href={newProjectHref(h.key, { with: c.org.id })}>Hire again</Link>
                    {c.bookingHref && <> · <a className={s.inlineLink} href={c.bookingHref}>Book a visit</a></>}
                  </p>
                </div>
                <div className={s.iconRow}>
                  {c.org.telHref && <a className={s.iconBtn} href={c.org.telHref} aria-label={`Call ${c.org.name}${c.org.phoneDisplay ? `, ${c.org.phoneDisplay}` : ""}`} title={c.org.phoneDisplay ?? "Call"}><span><Icon id="phone" small /></span></a>}
                  {c.org.smsHref && <a className={s.iconBtn} href={c.org.smsHref} aria-label={`Text ${c.org.name}`} title="Text"><span><Icon id="sms" small /></span></a>}
                  {c.org.email && <a className={s.iconBtn} href={`mailto:${c.org.email}`} aria-label={`Email ${c.org.name}`} title={c.org.email}><span><Icon id="msg" small /></span></a>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {h.memberships.length > 0 && (
        <section className={`${s.card} ${s.compact}`} aria-labelledby="plans-title">
          <h3 id="plans-title" className={s.h2}>Service plans</h3>
          <ul className={s.rows}>
            {h.memberships.map((m) => (
              <li key={m.href} className={s.row}>
                <div className={s.rowHead}>
                  <p className={s.h3}>{m.name}</p>
                  <span className={s.stamp} data-tone={m.status === "ACTIVE" ? "emerald" : "accent"}>{m.status === "ACTIVE" ? "Member" : "Offered to you"}</span>
                </div>
                <p className={s.sub}>
                  {m.orgName}
                  {m.nextVisit && <> · next visit <LocalTime iso={m.nextVisit.at} kind="day" tz={h.timeZone} /> — {m.nextVisit.label}</>}
                  {m.endsAt && m.status === "ACTIVE" && <> · through <LocalTime iso={m.endsAt} kind="date" tz={h.timeZone} /></>}
                </p>
                <div className={s.actions}><a className={m.status === "SENT" ? s.btnPrimary : s.btn} href={m.href}>{m.status === "SENT" ? "See the plan" : "Open"}</a></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Section>
  );
}
