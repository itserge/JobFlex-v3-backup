// YOUR CONTRACTORS, a section of /home/[key]: one 56px row per contractor a
// project is or was with — their initials in a square, the name, the work they
// do for this house and what they are on now, then Call / Text / Email as
// square icons. "Hire again" and online booking stay as quiet links in the
// row. Hidden when there are none. Service plans (memberships) follow only
// when there are any.
import Link from "next/link";
import type { HomeDashboard } from "@/lib/home/portal";
import type { PortalOrg } from "@/lib/requestPortal";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, Section } from "./portal-frame";
import { initials, newProjectHref, projectTitle } from "./view";
import s from "./portal.module.css";

/** The contractor's initials in a 32px ink square. */
export function OrgSquare({ name }: { name: string }) {
  return <span className={s.orgSquare} aria-hidden="true">{initials(name)}</span>;
}

/** Call · Text · Email as 32px squares (each a 44px target). */
export function ContactIcons({ org }: { org: PortalOrg }) {
  return (
    <span className={s.iconRow} data-contact-icons>
      {org.telHref && <a className={s.iconBtn} href={org.telHref} aria-label={`Call ${org.name}${org.phoneDisplay ? `, ${org.phoneDisplay}` : ""}`} title={org.phoneDisplay ?? "Call"}><span><Icon id="phone" small /></span></a>}
      {org.smsHref && <a className={s.iconBtn} href={org.smsHref} aria-label={`Text ${org.name}`} title="Text"><span><Icon id="sms" small /></span></a>}
      {org.email && <a className={s.iconBtn} href={`mailto:${org.email}`} aria-label={`Email ${org.name}`} title={org.email}><span><Icon id="msg" small /></span></a>}
    </span>
  );
}

export function ContractorsSection({ h }: { h: HomeDashboard }) {
  if (h.contractors.length === 0 && h.memberships.length === 0) return null;
  return (
    <Section id="contractors" title="Your contractors">
      {h.contractors.length > 0 && (
        <ul className={`${s.card} ${s.list}`}>
          {h.contractors.map((c) => {
            const theirs = h.projects.filter((p) => p.current?.org.id === c.org.id || p.previous.some((x) => x.org.id === c.org.id));
            const now = theirs.filter((p) => p.current?.org.id === c.org.id && p.status2 !== "DONE");
            const trades = [...new Set(theirs.map(projectTitle))].join(", ");
            return (
              <li key={c.org.id} className={s.person} data-contractor>
                <OrgSquare name={c.org.name} />
                <div className={s.personText}>
                  <p className={s.personName}>{c.org.name}</p>
                  <p className={s.sub}>
                    {now.length > 0 ? `Working on: ${now.map(projectTitle).join(", ")}` : trades}
                    {c.org.rating && <> · ★ {c.org.rating.avg.toFixed(1)}</>}
                    {" · "}<Link className={s.inlineLink} href={newProjectHref(h.key, { with: c.org.id })}>Hire again</Link>
                    {c.bookingHref && <> · <a className={s.inlineLink} href={c.bookingHref}>Book a visit</a></>}
                  </p>
                </div>
                <ContactIcons org={c.org} />
              </li>
            );
          })}
        </ul>
      )}
      {h.memberships.length > 0 && (
        <section className={s.card} aria-labelledby="plans-title">
          <h3 id="plans-title" className={s.h2}>Service plans</h3>
          <ul className={s.rows}>
            {h.memberships.map((m) => (
              <li key={m.href} className={s.row}>
                <div className={s.rowHead}>
                  <p className={s.personName}>{m.name}</p>
                  <p className={s.status} data-tone={m.status === "ACTIVE" ? "emerald" : "accent"}>{m.status === "ACTIVE" ? "You're a member" : "Offered to you"}</p>
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
