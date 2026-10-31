// /home/[key] in Blueprint — ONE page (2026-10-31, as the portal was before
// the 2026-10-30 rebuild split it): the house first (its address, how many
// projects are moving, one "Start a project"), then the sections the sticky
// tabs scroll to — Projects (whatever waits on the homeowner outside a
// project, then each project as a card: a six-step rail, one line on what
// happens next, one main action; finished projects as the house's record),
// Contractors, Calendar, Details. No counters: a "0 hired" or "$0 invested"
// told nobody anything.
import Link from "next/link";
import type { HomeDashboard } from "@/lib/home/portal";
import type { RequestPortalView } from "@/lib/requestPortal";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, PortalFrame, Section, StatusTrack } from "./portal-frame";
import { ContractorsSection } from "./contractors-section";
import { CalendarSection } from "./calendar-section";
import { DetailsSection } from "./details-section";
import { HashForward } from "./hash-forward";
import { STEPS, homeHref, houseLine, newProjectHref, nextStep, projectHref, projectTitle, stageOf } from "./view";
import s from "./portal.module.css";

/** Needs that belong to no project card: reviews, service-plan offers, plans whose month came. */
function houseNeeds(h: HomeDashboard) {
  // A review for a finished project is that project card's own action — said once.
  const doneOrgs = h.projects.filter((p) => p.status2 === "DONE" && p.current).map((p) => p.current!.org.name);
  return h.needs
    .filter((n) => n.kind === "plan" || (n.kind === "review" && !doneOrgs.some((o) => n.text.startsWith(o))))
    .map((n) => ({
      ...n,
      text: n.text.replace(/ offered you a plan: /, " offered you a service plan: ").replace(/ — ready to submit it\?$/, " — its month is here"),
      // A plan whose month came opens the portal's own Start a project.
      href: n.href.startsWith("/homeowner?home=") ? newProjectHref(h.key, { plan: new URL(n.href, "http://x").searchParams.get("plan") ?? undefined }) : n.href,
      word: n.kind === "review" ? "Leave a review" : n.href.startsWith("/plan/") ? "See the plan" : "Get quotes",
    }));
}

export function HomeOverview({ h }: { h: HomeDashboard }) {
  const active = h.projects.filter((p) => p.status2 !== "DONE");
  const record = h.projects.filter((p) => p.status2 === "DONE");
  const quotes = h.projects.reduce((n, p) => n + p.proposals.length, 0);
  const needs = houseNeeds(h);
  const start = newProjectHref(h.key);

  return (
    <PortalFrame homeKey={h.key} house={houseLine(h)} tab="projects" onePage email={h.email}>
      <HashForward projectBase={`${homeHref(h.key)}/project`} />
      <section className={`${s.card} ${s.homeCard}`} aria-labelledby="home-title">
        <div className={s.homeTitle}>
          <p className={s.kicker}>{h.returning ? "Welcome back" : "Welcome"}, {h.firstName}</p>
          <h1 id="home-title" className={s.h1}>{houseLine(h)}</h1>
        </div>
        <p className={s.homeFacts}>
          <span><b>{active.length === 0 ? "No projects" : active.length === 1 ? "1 project" : `${active.length} projects`}</b> in progress</span>
          {record.length > 0 && <span>{record.length} done</span>}
          {h.projects.length > 0 && quotes === 0 && <span>No quotes yet</span>}
        </p>
        <div className={s.actions}>
          <Link className={`${s.btnPrimary} ${s.btnWide}`} href={start} style={{ maxWidth: 360 }}>
            <Icon id="plus" small />
            Start a project
          </Link>
          <Link className={s.btnText} href={`/homeowner?home=${encodeURIComponent(h.key)}`}>See a price range first</Link>
        </div>
      </section>

      <Section id="projects" kicker={active.length === 1 ? "Your project" : "Your projects"} title="Projects">
        {needs.length > 0 && (
          <div className={`${s.card} ${s.attention}`}>
            <h3 className={s.h2}>{needs.length === 1 ? "One thing needs you" : `${needs.length} things need you`}</h3>
            <div>
              {needs.map((n, i) => (
                <div key={i} className={s.needRow}>
                  <p className={s.text}>{n.text}</p>
                  <a className={s.btn} href={n.href}>{n.word}</a>
                </div>
              ))}
            </div>
          </div>
        )}
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
          <>
            <h3 className={`${s.kicker} ${s.subKicker}`}>Done on your house</h3>
            {record.map((p) => <ProjectCard key={p.token} p={p} h={h} />)}
          </>
        )}
      </Section>

      <ContractorsSection h={h} />
      <CalendarSection h={h} />
      <DetailsSection h={h} />
    </PortalFrame>
  );
}

/** Sent · Contractor matched · Quote received (it waits on you) · Approved · Scheduled · Done. */
const STAGE_TONE = ["muted", "accent", "amber", "emerald", "accent", "emerald"] as const;

export function ProjectCard({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const stage = stageOf(p);
  const next = nextStep(p, h);
  const page = projectHref(h.key, p.token);
  return (
    <article id={`folder-${p.token}`} className={`${s.card} ${s.project}`} aria-labelledby={`p-${p.token}`} data-project-stage={STEPS[stage]}>
      <div className={s.projectHead}>
        <div>
          <p className={s.kicker}>
            {[p.place, `Sent `].filter(Boolean).join(" · ")}
            <LocalTime iso={p.submittedAt} kind="date" tz={h.timeZone} />
          </p>
          <h3 id={`p-${p.token}`} className={`${s.h2} ${s.projectTitle}`}>
            <Link href={page}>{projectTitle(p)}</Link>
          </h3>
          {p.current && <p className={s.muted}>{p.current.org.name}</p>}
        </div>
        <span className={s.stamp} data-tone={STAGE_TONE[stage]}>{STEPS[stage]}</span>
      </div>
      <StatusTrack stage={stage} label={`${projectTitle(p)}: ${STEPS[stage]}`} />
      <p className={s.next} data-tone={next.tone}>
        <b>What happens next</b>
        <span>
          {next.visit && (
            <>
              <LocalTime iso={next.visit.startsAt} kind="day" tz={next.visit.timeZone} />, <LocalTime iso={next.visit.startsAt} kind="time" tz={next.visit.timeZone} /> ·{" "}
            </>
          )}
          {next.text}
        </span>
      </p>
      <div className={s.projectFoot}>
        {next.action && (
          <a className={next.action.primary ? s.btnPrimary : s.btn} href={next.action.href}>{next.action.label}</a>
        )}
        <Link className={s.btn} href={page}>
          Open project
          <Icon id="arrow" small />
        </Link>
      </div>
    </article>
  );
}
