// /home/[key] — THE HOMEOWNER'S PAGE (2026-11-01, homeowner-first). Read by
// someone who opens the link once a week, so every block answers one of three
// questions in plain words: "What do I need to do?" (Needs you), "What's
// happening with my projects?" (Your projects, Your contractors) and "When is
// someone coming?" (the calendar). Blueprint stays the look — paper grid, ink
// frames, square buttons, uppercase section titles — but inside the cards the
// words are sentences: no mono-caps codes, no six-step rail.
//
// Desk: a welcome band across the top, then the main column (Needs you, Your
// projects, Your contractors) beside a side column (Calendar, Your details,
// Documents) that scrolls with the page. Phone: one column in that order.
import Link from "next/link";
import type { HomeDashboard } from "@/lib/home/portal";
import type { RequestPortalView } from "@/lib/requestPortal";
import { Icon, PortalFrame, Section, StatusTrack } from "./portal-frame";
import { ContractorsSection, ContactIcons, OrgSquare } from "./contractors-section";
import { CalendarSection } from "./calendar-section";
import { DetailsSection } from "./details-section";
import { HashForward } from "./hash-forward";
import { STEPS, homeHref, houseLine, needOf, newProjectHref, nextStep, projectHref, projectTitle, stageOf, statusOf, stepCaption } from "./view";
import s from "./portal.module.css";

type Need = { text: string; label: string; href: string };

/** Everything waiting on the homeowner: each project's one thing, then reviews, service-plan offers and plans whose month came. */
function needsOf(h: HomeDashboard): Need[] {
  const out: Need[] = [];
  for (const p of h.projects) {
    const n = needOf(p, h);
    if (n) out.push(n);
  }
  const doneOrgs = h.projects.filter((p) => p.status2 === "DONE" && p.current).map((p) => p.current!.org.name);
  for (const n of h.needs) {
    if (n.kind === "plan") {
      out.push({
        text: n.text.replace(/ offered you a plan: /, " offered you a service plan: ").replace(/ — ready to submit it\?$/, " — its month is here"),
        // A plan whose month came opens the portal's own Start a project.
        href: n.href.startsWith("/homeowner?home=") ? newProjectHref(h.key, { plan: new URL(n.href, "http://x").searchParams.get("plan") ?? undefined }) : n.href,
        label: n.href.startsWith("/plan/") ? "See the plan" : "Get quotes",
      });
    } else if (n.kind === "review" && !doneOrgs.some((o) => n.text.startsWith(o))) {
      out.push({ text: n.text, href: n.href, label: "Leave a review" });
    }
  }
  return out;
}

export function HomeOverview({ h }: { h: HomeDashboard }) {
  const active = h.projects.filter((p) => p.status2 !== "DONE");
  const record = h.projects.filter((p) => p.status2 === "DONE");
  const needs = needsOf(h);
  const start = newProjectHref(h.key);
  const facts = [
    houseLine(h),
    active.length === 0 ? "nothing in progress" : `${active.length} ${active.length === 1 ? "project" : "projects"} in progress`,
    record.length > 0 ? `${record.length} done` : null,
  ].filter(Boolean).join(" · ");

  return (
    <PortalFrame homeKey={h.key} house={houseLine(h)} tab="projects" onePage email={h.email}>
      <HashForward projectBase={`${homeHref(h.key)}/project`} />
      <header className={s.welcome} aria-labelledby="home-title">
        <div className={s.welcomeText}>
          <h1 id="home-title" className={s.h1}>Hi {h.firstName}</h1>
          <p className={s.welcomeLine}>{facts}</p>
        </div>
        <div className={s.actions}>
          <Link className={`${s.btnPrimary} ${s.btnBig}`} href={start}>
            <Icon id="plus" small />
            Start a project
          </Link>
          <Link className={s.btnText} href={`/homeowner?home=${encodeURIComponent(h.key)}`}>See a price range first</Link>
        </div>
      </header>

      <div className={s.homeSheet}>
        <div className={s.mainCol}>
          {needs.length > 0 && (
            <section className={s.needs} aria-labelledby="needs-title" data-needs>
              <h2 id="needs-title" className={s.needsTitle}>Needs you · {needs.length}</h2>
              <ul>
                {needs.map((n, i) => (
                  <li key={i} className={s.needRow}>
                    <p>{n.text}</p>
                    <a className={s.btnPrimary} href={n.href}>{n.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Section id="projects" title="Your projects" kicker={active.length ? `${active.length} in progress` : undefined}>
            {active.length === 0 ? (
              <div className={`${s.card} ${s.empty}`}>
                <h3 className={s.h3}>{record.length ? "Nothing in progress right now" : "No projects yet"}</h3>
                <p className={s.text}>Tell us what you need done — a local contractor takes it from there, and it shows up here.</p>
                <Link className={s.btnPrimary} href={start}>Start a project</Link>
              </div>
            ) : (
              active.map((p) => <ProjectCard key={p.token} p={p} h={h} />)
            )}
            {record.length > 0 && (
              <div className={s.doneGroup}>
                <h3 className={s.doneHead}>Done ({record.length})</h3>
                {record.map((p) => <DoneRow key={p.token} p={p} h={h} />)}
              </div>
            )}
          </Section>

          <ContractorsSection h={h} />
        </div>

        <aside className={s.sideCol} aria-label="Calendar and your details">
          <CalendarSection h={h} />
          <DetailsSection h={h} />
        </aside>
      </div>
    </PortalFrame>
  );
}

/** Three rows: the title with where it stands · who is on it (or who will be) · how far it has come — then its one action. */
export function ProjectCard({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const stage = stageOf(p);
  const status = statusOf(p);
  const next = nextStep(p, h);
  const org = p.current?.org ?? null;
  return (
    <article id={`folder-${p.token}`} className={`${s.card} ${s.project}`} aria-labelledby={`p-${p.token}`} data-project-stage={STEPS[stage]}>
      <div className={s.projectHead}>
        <h3 id={`p-${p.token}`} className={s.projectTitle}>
          <Link href={projectHref(h.key, p.token)}>{projectTitle(p)}</Link>
        </h3>
        <p className={s.status} data-tone={status.tone}>{status.text}</p>
      </div>
      {org ? (
        <div className={s.who}>
          <OrgSquare name={org.name} />
          <p className={s.whoText}>
            <b>{org.name}</b>
            {org.place && <span className={s.sub}>{org.place}</span>}
          </p>
          <ContactIcons org={org} />
        </div>
      ) : (
        <p className={s.waiting}>A local contractor will pick this up within 24 hours — we&apos;ll email you.</p>
      )}
      <StatusTrack stage={stage} caption={stepCaption(p, h.timeZone)} />
      <div className={s.projectFoot}>
        {next.action && <a className={next.action.primary ? s.btnPrimary : s.btn} href={next.action.href}>{next.action.label}</a>}
        <Link className={s.openLink} href={projectHref(h.key, p.token)}>Open project <Icon id="arrow" small /></Link>
      </div>
    </article>
  );
}

/** A finished project: one 48px row — the title, who did it, Done, and the way in. */
function DoneRow({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const stage = stageOf(p);
  return (
    <div id={`folder-${p.token}`} className={s.doneRow} data-project-stage={STEPS[stage]}>
      <p className={s.doneTitle}>
        <b>{projectTitle(p)}</b>
        {p.current && <span className={s.sub}> · {p.current.org.name}</span>}
      </p>
      <p className={s.status} data-tone="emerald">Done</p>
      <Link className={s.openLink} href={projectHref(h.key, p.token)}>Open project <Icon id="arrow" small /></Link>
    </div>
  );
}
