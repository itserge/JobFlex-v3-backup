// /home/[key]/details (2026-10-30): the homeowner's own details, the
// paperwork every contractor sent (quotes, their PDFs, change orders), and
// how the link works.
import { LocalTime } from "@/components/portal/live-time";
import type { HomeDashboard } from "@/lib/home/portal";
import { Icon, PortalFrame } from "./portal-frame";
import { DetailsForm } from "./details-form";
import { houseLine } from "./view";
import s from "./portal.module.css";

const DOC_WORD = (label: string) => label.replace(/proposal/gi, (m) => (m[0] === "P" ? "Quote" : "quote"));

export function DetailsPage({ h }: { h: HomeDashboard }) {
  return (
    <PortalFrame homeKey={h.key} house={houseLine(h)} tab="details" email={h.email}>
      <h1 className={s.h1}>Details</h1>
      <div className={s.cols}>
        <div className={s.col}>
          <section className={s.card} aria-labelledby="you-title" id="details">
            <h2 id="you-title" className={s.h2}>Your details</h2>
            <DetailsForm homeKey={h.key} details={h.details} />
          </section>
          <section className={s.card} aria-labelledby="docs-title">
            <h2 id="docs-title" className={s.h2}>Documents</h2>
            {h.documents.length === 0 ? (
              <p className={s.muted}>Quotes, their PDFs and change orders land here as contractors send them.</p>
            ) : (
              <ul className={s.rows}>
                {h.documents.map((d, i) => (
                  <li key={i} className={s.row} style={{ gridTemplateColumns: "20px minmax(0,1fr)", alignItems: "start", gap: 10 }}>
                    <Icon id={d.kind === "pdf" ? "download" : "file"} small />
                    <span className={s.stack} style={{ gap: 2 }}>
                      <a className={s.link} href={d.href} target={d.kind === "pdf" ? "_blank" : undefined} rel={d.kind === "pdf" ? "noopener noreferrer" : undefined}>{DOC_WORD(d.label)}</a>
                      <span className={s.muted}>{d.orgName}{d.orgName ? " · " : ""}<LocalTime iso={d.at} kind="date" tz={h.timeZone} /></span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className={s.col}>
          <section className={s.card} aria-labelledby="link-title">
            <h2 id="link-title" className={s.h2}>Your link</h2>
            <p className={s.text}>No account, no password: this page&apos;s link is your key. Keep it, and share it carefully — anyone with it can see your projects.</p>
            <p className={s.muted}>With JobFlex since <LocalTime iso={h.since} kind="date" tz={h.timeZone} />.</p>
          </section>
        </div>
      </div>
    </PortalFrame>
  );
}
