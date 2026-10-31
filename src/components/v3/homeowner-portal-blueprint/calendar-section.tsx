// CALENDAR, one card of /home/[key] (the side column on a desk): the visits
// coming up as 56px rows — a 44px date square, then what and who — with "Add
// to phone calendar" (the same .ics as before) in the title row; then the
// planned projects as a plain list under a kicker and "+ Plan something" to
// add one. Plans moved here from the old "Plans" anchor: every plan has a
// month and was already in the calendar and its .ics.
import type { HomeDashboard } from "@/lib/home/portal";
import { LocalTime } from "@/components/portal/live-time";
import { Icon } from "./portal-frame";
import { SideCard } from "./fold-section";
import { PlanAheadForm, PlannedList } from "./plan-ahead";
import { homeHref, newProjectHref, projectHref } from "./view";
import s from "./portal.module.css";

type Upcoming = { key: string; ymd: string; at: string | null; tz: string; title: string; who: string; href: string | null };

function ymdIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function CalendarSection({ h }: { h: HomeDashboard }) {
  const today = ymdIn(new Date().toISOString(), h.timeZone);
  const items: Upcoming[] = [];
  for (const p of h.projects) {
    for (const v of p.visits) items.push({ key: `v-${p.token}-${v.startsAt}`, ymd: ymdIn(v.startsAt, v.timeZone), at: v.startsAt, tz: v.timeZone, title: v.title, who: v.orgName, href: projectHref(h.key, p.token) });
  }
  for (const m of h.memberships) {
    if (m.nextVisit) items.push({ key: `m-${m.href}`, ymd: ymdIn(m.nextVisit.at, h.timeZone), at: null, tz: h.timeZone, title: m.nextVisit.label, who: `${m.orgName} · ${m.name}`, href: m.href });
  }
  const planned = h.plans.filter((p) => p.status === "PLANNED");
  const upcoming = items.filter((x) => x.ymd >= today).sort((a, b) => a.ymd.localeCompare(b.ymd));

  const quotesHref: Record<string, string> = {};
  const rangeHref: Record<string, string> = {};
  for (const p of planned) {
    quotesHref[p.id] = newProjectHref(h.key, { plan: p.id });
    if (p.estimate) rangeHref[p.id] = `/homeowner/price/roof?home=${encodeURIComponent(h.key)}&plan=${encodeURIComponent(p.id)}`;
  }
  const submitted = h.plans.filter((p) => p.status === "SUBMITTED" && p.token);

  return (
    <SideCard id="calendar" title="Calendar" action={<a className={s.btnText} href={`${homeHref(h.key)}/calendar.ics`} data-ics><Icon id="cal" small />Add to phone calendar</a>}>
      <p className={s.kicker}>Coming up</p>
      {upcoming.length === 0 ? (
        <p className={s.sub}>Nothing booked yet. Visits your contractor books show up here.</p>
      ) : (
        <ul className={s.events}>
          {upcoming.map((x) => {
            const date = new Date(`${x.ymd}T12:00:00Z`);
            return (
              <li key={x.key} className={s.event} data-upcoming>
                <span className={s.eventDate}>
                  <span>{date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
                  <b>{date.getUTCDate()}</b>
                </span>
                <span className={s.eventBody}>
                  {x.href ? <a className={s.rowLink} href={x.href}>{x.title}</a> : <span>{x.title}</span>}
                  <span className={s.sub}>{x.at ? <><LocalTime iso={x.at} kind="time" tz={x.tz} /> · </> : ""}{x.who}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className={s.sideGroup} id="plan">
        <p className={s.kicker}>Planned</p>
        {planned.length > 0 ? (
          <PlannedList homeKey={h.key} plans={planned} quotesHref={quotesHref} rangeHref={rangeHref} />
        ) : (
          <p className={s.sub}>Planning something for later? Put it on the calendar — when the month comes, we remind you and one tap gets you quotes.</p>
        )}
        {submitted.length > 0 && (
          <p className={s.sub}>
            Sent from here:{" "}
            {submitted.map((p, i) => (
              <span key={p.id}>{i > 0 ? ", " : ""}<a className={s.link} href={projectHref(h.key, p.token!)}>{p.title}</a></span>
            ))}
          </p>
        )}
        <details className={s.planAdd}>
          <summary><Icon id="plus" small />Plan something</summary>
          <PlanAheadForm homeKey={h.key} />
        </details>
      </div>
    </SideCard>
  );
}
