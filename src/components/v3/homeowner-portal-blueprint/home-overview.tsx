// /home/[key] in Blueprint (2026-10-30): the house first (its address, how
// many projects are moving, one "Start a project"), then whatever waits on
// the homeowner outside a project (a review, a service plan, a plan whose
// month came), then each project as a card — a six-step bar, one line on
// what happens next, one main action. Finished projects follow as the
// house's record. No counters: a "0 hired" or "$0 invested" told nobody
// anything.
import Link from "next/link";
import type { HomeDashboard } from "@/lib/home/portal";
import type { RequestPortalView } from "@/lib/requestPortal";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, PortalFrame, StatusTrack } from "./portal-frame";
import { STEPS, houseLine, newProjectHref, nextStep, projectHref, projectTitle, stageOf } from "./view";
import s from "./portal.module.css";

/** Needs that belong to no project card: reviews, service-plan offers, plans whose month came. */
function houseNeeds(h: HomeDashboard) {
  return h.needs
    .filter((n) => n.kind === "review" || n.kind === "plan")
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

  // The house line is the card's title here, so the frame does not repeat it.

  return (
    <PortalFrame homeKey={h.key} tab="projects" email={h.email}>
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

      {needs.length > 0 && (
        <section className={`${s.card} ${s.attention}`} aria-labelledby="needs-title">
          <div className={s.cardHead}>
            <h2 id="needs-title" className={s.h2}>{needs.length === 1 ? "One thing needs you" : `${needs.length} things need you`}</h2>
          </div>
          <div>
            {needs.map((n, i) => (
              <div key={i} className={s.needRow}>
                <p className={s.text}>{n.text}</p>
                <a className={s.btn} href={n.href}>{n.word}</a>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={s.stack} aria-labelledby="projects-title" id="projects">
        <h2 id="projects-title" className={s.kicker}>{active.length === 1 ? "Your project" : "Your projects"}</h2>
        {active.length === 0 ? (
          <div className={`${s.card} ${s.empty}`}>
            <h3 className={s.h3}>{record.length ? "Nothing in progress right now" : "No projects yet"}</h3>
            <p className={s.text}>Tell us what you need done — a local contractor takes it from there, and it shows up here.</p>
            <Link className={s.btnPrimary} href={start}>Start a project</Link>
          </div>
        ) : (
          <div className={s.col}>
            {active.map((p) => <ProjectCard key={p.token} p={p} h={h} />)}
          </div>
        )}
      </section>

      {record.length > 0 && (
        <section className={s.stack} aria-labelledby="record-title">
          <h2 id="record-title" className={s.kicker}>Done on your house</h2>
          <div className={s.col}>
            {record.map((p) => <ProjectCard key={p.token} p={p} h={h} />)}
          </div>
        </section>
      )}
    </PortalFrame>
  );
}

export function ProjectCard({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const stage = stageOf(p);
  const next = nextStep(p, h);
  const page = projectHref(h.key, p.token);
  return (
    <article className={`${s.card} ${s.project}`} aria-labelledby={`p-${p.token}`} data-project-stage={STEPS[stage]}>
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
        <Link className={s.btnText} href={page}>
          Open project
          <Icon id="arrow" small />
        </Link>
      </div>
    </article>
  );
}
