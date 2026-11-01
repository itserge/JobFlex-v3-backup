// CALENDAR, one card of /home/[key] — "When is someone coming?". A month grid
// first (today outlined, a blue dot where someone is coming, a line on a
// planned project's month; ‹ › to walk the months), then "Coming up" in
// words: "Install day — Bright Air Heating & Cooling, 7:00 AM" beside a
// NOV / 5 square, and the planned projects as "April 2027 — Garage epoxy
// floor" (each opening to its reminder and Get quotes). The foot: "Add to
// phone calendar" (the same .ics as before) and "+ Plan something".
import type { HomeDashboard } from "@/lib/home/portal";
import { Icon } from "./portal-frame";
import { SideCard } from "./fold-section";
import { MonthGrid } from "./month-grid";
import { PlanAheadForm, PlannedList } from "./plan-ahead";
import { homeHref, newProjectHref, projectHref } from "./view";
import s from "./portal.module.css";

type Upcoming = { key: string; ymd: string; at: string | null; tz: string; title: string; who: string; href: string };

function ymdIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
const timeIn = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));

export function CalendarSection({ h }: { h: HomeDashboard }) {
  const today = ymdIn(new Date().toISOString(), h.timeZone);
  const items: Upcoming[] = [];
  for (const p of h.projects) {
    for (const v of p.visits) items.push({ key: `v-${p.token}-${v.startsAt}`, ymd: ymdIn(v.startsAt, v.timeZone), at: v.startsAt, tz: v.timeZone, title: v.title, who: v.orgName, href: projectHref(h.key, p.token) });
  }
  for (const m of h.memberships) {
    if (m.nextVisit) items.push({ key: `m-${m.href}`, ymd: ymdIn(m.nextVisit.at, h.timeZone), at: null, tz: h.timeZone, title: m.nextVisit.label, who: `${m.orgName} · ${m.name}`, href: m.href });
  }
  const upcoming = items.filter((x) => x.ymd >= today).sort((a, b) => a.ymd.localeCompare(b.ymd));
  const planned = h.plans.filter((p) => p.status === "PLANNED");

  // The grid's marks: every visit the dashboard knows, and each planned project's month (on its first day).
  const marks: Record<string, "visit" | "plan"> = {};
  for (const p of planned) marks[p.date] = "plan";
  for (const it of h.calendar) if (it.kind === "visit") marks[it.date] = "visit";
  for (const x of items) marks[x.ymd] = "visit";

  const quotesHref: Record<string, string> = {};
  const rangeHref: Record<string, string> = {};
  for (const p of planned) {
    quotesHref[p.id] = newProjectHref(h.key, { plan: p.id });
    if (p.estimate) rangeHref[p.id] = `/homeowner/price/roof?home=${encodeURIComponent(h.key)}&plan=${encodeURIComponent(p.id)}`;
  }
  const submitted = h.plans.filter((p) => p.status === "SUBMITTED" && p.token);

  return (
    <SideCard id="calendar" title="Calendar">
      <MonthGrid today={today} marks={marks} />

      <div className={s.sideGroup}>
        <h3 className={s.groupTitle}>Coming up</h3>
        {upcoming.length === 0 && planned.length === 0 ? (
          <p className={s.sub}>Nothing on the calendar yet. When a contractor books a visit, it shows up here.</p>
        ) : (
          <>
            {upcoming.length > 0 && (
              <ul className={s.events}>
                {upcoming.map((x) => {
                  const date = new Date(`${x.ymd}T12:00:00Z`);
                  return (
                    <li key={x.key} className={s.event} data-upcoming>
                      <span className={s.eventDate}>
                        <span>{date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
                        <b>{date.getUTCDate()}</b>
                      </span>
                      <a className={s.eventText} href={x.href}>
                        <span><b>{x.title}</b> — {x.who}{x.at ? `, ${timeIn(x.at, x.tz)}` : ""}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
            {planned.length > 0 && <PlannedList homeKey={h.key} plans={planned} quotesHref={quotesHref} rangeHref={rangeHref} />}
          </>
        )}
        {submitted.length > 0 && (
          <p className={s.sub}>
            Sent from here:{" "}
            {submitted.map((p, i) => (
              <span key={p.id}>{i > 0 ? ", " : ""}<a className={s.link} href={projectHref(h.key, p.token!)}>{p.title}</a></span>
            ))}
          </p>
        )}
      </div>

      <div className={s.calFoot} id="plan">
        <a className={s.btnText} href={`${homeHref(h.key)}/calendar.ics`} data-ics><Icon id="cal" small />Add to phone calendar</a>
        <details className={s.planAdd}>
          <summary><Icon id="plus" small />Plan something</summary>
          <PlanAheadForm homeKey={h.key} />
        </details>
      </div>
    </SideCard>
  );
}
