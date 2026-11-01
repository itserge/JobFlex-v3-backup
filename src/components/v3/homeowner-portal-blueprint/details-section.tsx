// YOUR DETAILS and DOCUMENTS, two cards at the foot of the side column of
// /home/[key] (the end of the page on a phone): what the homeowner told us as a
// two-column grid with Edit details and "Email me this link"; every quote, PDF
// and change order a contractor sent as 44px rows; then one quiet line on how
// the link works.
import { LocalTime } from "@/components/portal/live-time";
import type { HomeDashboard } from "@/lib/home/portal";
import { Icon } from "./portal-frame";
import { DetailsForm } from "./details-form";
import { SideCard } from "./fold-section";
import s from "./portal.module.css";

const DOC_WORD = (label: string) => label.replace(/proposal/gi, (m) => (m[0] === "P" ? "Quote" : "quote"));

export function DetailsSection({ h }: { h: HomeDashboard }) {
  return (
    <>
      <SideCard id="details" title="Your details">
        <DetailsForm homeKey={h.key} details={h.details} />
      </SideCard>
      <SideCard id="documents" title="Documents">
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
      </SideCard>
      <p className={s.keyNote}>This page&apos;s link is your key — keep it and share it carefully.</p>
    </>
  );
}
