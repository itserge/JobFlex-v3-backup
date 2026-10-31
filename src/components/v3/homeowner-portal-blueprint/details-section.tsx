// DETAILS, one card of /home/[key] (the side column on a desk, folded under
// its title on a phone): the homeowner's own details as a definition grid,
// the paperwork every contractor sent (quotes, their PDFs, change orders) as
// 44px rows under a kicker, and how the link works as a quiet paragraph.
import { LocalTime } from "@/components/portal/live-time";
import type { HomeDashboard } from "@/lib/home/portal";
import { Icon } from "./portal-frame";
import { DetailsForm } from "./details-form";
import { SideCard } from "./fold-section";
import s from "./portal.module.css";

const DOC_WORD = (label: string) => label.replace(/proposal/gi, (m) => (m[0] === "P" ? "Quote" : "quote"));

export function DetailsSection({ h }: { h: HomeDashboard }) {
  return (
    <SideCard id="details" title="Details" fold>
      <DetailsForm homeKey={h.key} details={h.details} />
      <div className={s.sideGroup}>
        <p className={s.kicker}>Documents</p>
        {h.documents.length === 0 ? (
          <p className={s.sub}>Quotes, their PDFs and change orders land here as contractors send them.</p>
        ) : (
          <ul className={s.docs}>
            {h.documents.map((d, i) => {
              const pdf = d.kind === "pdf";
              const name = DOC_WORD(d.label);
              return (
                <li key={i} className={s.doc}>
                  <Icon id="file" />
                  <span className={s.docText}>
                    <span className={s.docTitle}><a className={s.docName} href={d.href} target={pdf ? "_blank" : undefined} rel={pdf ? "noopener noreferrer" : undefined} title={name}>{name}</a></span>
                    <span className={s.sub}>{d.orgName}{d.orgName ? " · " : ""}<LocalTime iso={d.at} kind="date" tz={h.timeZone} /></span>
                  </span>
                  <a className={s.docGo} href={d.href} target={pdf ? "_blank" : undefined} rel={pdf ? "noopener noreferrer" : undefined} aria-label={pdf ? `Download ${name}` : `Open ${name}`}>
                    <span><Icon id={pdf ? "download" : "arrow"} small /></span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className={`${s.sub} ${s.sideGroup}`}>
        Your link: no account, no password — this page&apos;s link is your key. Keep it, and share it carefully; anyone with it can see your projects. With JobFlex since <LocalTime iso={h.since} kind="date" tz={h.timeZone} />.
      </p>
    </SideCard>
  );
}
