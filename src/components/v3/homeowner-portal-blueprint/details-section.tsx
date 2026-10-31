// DETAILS, a section of /home/[key] (one page since 2026-10-31): the homeowner's own details, the
// paperwork every contractor sent (quotes, their PDFs, change orders), and
// how the link works.
import { LocalTime } from "@/components/portal/live-time";
import type { HomeDashboard } from "@/lib/home/portal";
import { Icon, Section } from "./portal-frame";
import { DetailsForm } from "./details-form";
import s from "./portal.module.css";

const DOC_WORD = (label: string) => label.replace(/proposal/gi, (m) => (m[0] === "P" ? "Quote" : "quote"));

export function DetailsSection({ h }: { h: HomeDashboard }) {
  return (
    <Section id="details" kicker="You and your link" title="Details">
      <div className={s.cols}>
        <div className={s.col}>
          <section className={s.card} aria-labelledby="you-title">
            <h3 id="you-title" className={s.h2}>Your details</h3>
            <DetailsForm homeKey={h.key} details={h.details} />
          </section>
          <section className={s.card} aria-labelledby="docs-title">
            <h3 id="docs-title" className={s.h2}>Documents</h3>
            {h.documents.length === 0 ? (
              <p className={s.muted}>Quotes, their PDFs and change orders land here as contractors send them.</p>
            ) : (
              <ul className={s.docs}>
                {h.documents.map((d, i) => {
                  const pdf = d.kind === "pdf";
                  const name = DOC_WORD(d.label);
                  return (
                    <li key={i} className={s.doc}>
                      <Icon id="file" />
                      <span className={s.docText}>
                        <a className={s.docName} href={d.href} target={pdf ? "_blank" : undefined} rel={pdf ? "noopener noreferrer" : undefined}>{name}</a>
                        <span className={s.muted}>{d.orgName}{d.orgName ? " · " : ""}<LocalTime iso={d.at} kind="date" tz={h.timeZone} /></span>
                      </span>
                      <a className={s.docGo} href={d.href} target={pdf ? "_blank" : undefined} rel={pdf ? "noopener noreferrer" : undefined} aria-label={pdf ? `Download ${name}` : `Open ${name}`}>
                        <span><Icon id={pdf ? "download" : "arrow"} small /></span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        <div className={s.col}>
          <section className={s.card} aria-labelledby="link-title">
            <h3 id="link-title" className={s.h2}>Your link</h3>
            <p className={s.text}>No account, no password: this page&apos;s link is your key. Keep it, and share it carefully — anyone with it can see your projects.</p>
            <p className={s.muted}>With JobFlex since <LocalTime iso={h.since} kind="date" tz={h.timeZone} />.</p>
          </section>
        </div>
      </div>
    </Section>
  );
}
