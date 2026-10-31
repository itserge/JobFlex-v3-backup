// /home/[key] in Blueprint — ONE page (2026-10-31): the house first (its
// address, how many projects are moving, one "Start a project"), then the
// sections the sticky tabs scroll to. Desk: a two-column sheet like
// /dashboard — house, Projects and Contractors in the main column, Calendar
// and Details in a sticky side column. Phone: one column. A project card is
// three rows (where/when + status, title · contractor, the rail beside the
// next step) and an action row only when there is one; finished projects
// fold to one row each. No counters: a "0 hired" told nobody anything.
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

  // Desk (≥1024px): the main column (house, projects, contractors) and a
  // sticky side column (calendar, details). Phone: one column, in the order
  // house → projects → calendar → contractors → details (CSS order).
  return (
    <PortalFrame homeKey={h.key} house={houseLine(h)} tab="projects" onePage email={h.email}>
      <HashForward projectBase={`${homeHref(h.key)}/project`} />
      <div className={s.homeSheet}>
        <div className={s.mainCol}>
          <section className={`${s.card} ${s.homeCard}`} aria-labelledby="home-title">
            <div className={s.homeTitle}>
              <p className={s.kicker}>{h.returning ? "Welcome back" : "Welcome"}, {h.firstName}</p>
              <h1 id="home-title" className={s.h1}>{houseLine(h)}</h1>
            </div>
            <div className={s.homeSide}>
              <p className={s.homeFacts}>
                <span><b>{active.length === 0 ? "None" : active.length}</b> in progress</span>
                {record.length > 0 && <span>· {record.length} done</span>}
                {h.projects.length > 0 && quotes === 0 && <span>· no quotes yet</span>}
              </p>
              <div className={s.actions}>
                <Link className={s.btnPrimary} href={start}>
                  <Icon id="plus" small />
                  Start a project
                </Link>
                <Link className={s.btnText} href={`/homeowner?home=${encodeURIComponent(h.key)}`}>See a price range first</Link>
              </div>
            </div>
          </section>

          <Section id="projects" kicker={`${active.length} in progress`} title="Projects">
            {needs.length > 0 && (
              <div className={`${s.card} ${s.compact} ${s.attention}`}>
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
              <div className={s.doneGroup}>
                <h3 className={s.doneHead}>Done ({record.length})</h3>
                {record.map((p) => <DoneRow key={p.token} p={p} h={h} />)}
              </div>
            )}
          </Section>

          <div className={s.orderContractors}>
            <ContractorsSection h={h} />
          </div>
        </div>

        <aside className={s.sideCol} data-side aria-label="Calendar and details">
          <div className={s.orderCalendar}>
            <CalendarSection h={h} />
          </div>
          <div className={s.orderDetails}>
            <DetailsSection h={h} />
          </div>
        </aside>
      </div>
    </PortalFrame>
  );
}

/** Sent · Contractor matched · Quote received (it waits on you) · Approved · Scheduled · Done. */
const STAGE_TONE = ["muted", "accent", "amber", "emerald", "accent", "emerald"] as const;

/** The next step as one line: when (for a visit), then what. */
function NextLine({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const next = nextStep(p, h);
  return (
    <p className={s.nextLine} data-tone={next.tone}>
      <b>Next</b>
      <span>
        {next.visit && (
          <>
            <LocalTime iso={next.visit.startsAt} kind="day" tz={next.visit.timeZone} />, <LocalTime iso={next.visit.startsAt} kind="time" tz={next.visit.timeZone} /> ·{" "}
          </>
        )}
        {next.text}
      </span>
    </p>
  );
}

/** Three rows: where and when + status · title · contractor · the rail (with the action under it, when there is one) beside the next step. */
export function ProjectCard({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const stage = stageOf(p);
  const next = nextStep(p, h);
  const page = projectHref(h.key, p.token);
  return (
    <article id={`folder-${p.token}`} className={`${s.card} ${s.project}`} aria-labelledby={`p-${p.token}`} data-project-stage={STEPS[stage]}>
      <div className={s.projectHead}>
        <p className={s.kicker}>
          {p.place ? `${p.place} · ` : ""}Sent <LocalTime iso={p.submittedAt} kind="date" tz={h.timeZone} />
        </p>
        <span className={s.stamp} data-tone={STAGE_TONE[stage]}>{STEPS[stage]}</span>
      </div>
      <h3 id={`p-${p.token}`} className={s.projectTitle}>
        <Link href={page}>{projectTitle(p)}</Link>
        {p.current && <span className={s.projectWho}> · {p.current.org.name}</span>}
      </h3>
      <div className={s.projectBody}>
        <StatusTrack stage={stage} label={`${projectTitle(p)}: ${STEPS[stage]}`} />
        <NextLine p={p} h={h} />
        {next.action && (
          <div className={s.projectFoot}>
            <a className={next.action.primary ? s.btnPrimary : s.btn} href={next.action.href}>{next.action.label}</a>
            <Link className={s.openLink} href={page}>Open project <Icon id="arrow" small /></Link>
          </div>
        )}
      </div>
    </article>
  );
}

/** A finished project: one 48px row — title · contractor · Done · Open project — that opens to its rail and next step. */
function DoneRow({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const stage = stageOf(p);
  const next = nextStep(p, h);
  const page = projectHref(h.key, p.token);
  return (
    <details id={`folder-${p.token}`} className={s.doneRow} data-project-stage={STEPS[stage]}>
      <summary>
        <span className={s.doneTitle}>
          <b>{projectTitle(p)}</b>
          {p.current && <span className={s.projectWho}> · {p.current.org.name}</span>}
        </span>
        <span className={s.stamp} data-tone="emerald">Done</span>
        <Link className={s.openLink} href={page}>Open project <Icon id="arrow" small /></Link>
      </summary>
      <div className={s.doneBody}>
        <div className={s.projectBody}>
          <StatusTrack stage={stage} label={`${projectTitle(p)}: ${STEPS[stage]}`} />
          <NextLine p={p} h={h} />
          {next.action && (
            <div className={s.projectFoot}>
              <a className={next.action.primary ? s.btnPrimary : s.btn} href={next.action.href}>{next.action.label}</a>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
