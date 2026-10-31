// CALENDAR, a section of /home/[key] (one page since 2026-10-31; the side
// column on a desk): what is coming, as a list — "Nov 5 · Install day ·
// Bright Air" — with "Add to phone calendar" (the same .ics as before), then
// the planned projects with their months and "Plan something for later",
// folded so the column stays short. Plans moved here from the old "Plans"
// anchor: every plan has a month and was already in the calendar and its .ics.
import type { HomeDashboard } from "@/lib/home/portal";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, Section } from "./portal-frame";
import { PlanAheadForm, PlannedList } from "./plan-ahead";
import { homeHref, newProjectHref, projectHref } from "./view";
import s from "./portal.module.css";

type Upcoming = { key: string; ymd: string; at: string | null; tz: string; title: string; who: string; href: string | null; month: string | null };

function ymdIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function CalendarSection({ h }: { h: HomeDashboard }) {
  const today = ymdIn(new Date().toISOString(), h.timeZone);
  const items: Upcoming[] = [];
  for (const p of h.projects) {
    for (const v of p.visits) items.push({ key: `v-${p.token}-${v.startsAt}`, ymd: ymdIn(v.startsAt, v.timeZone), at: v.startsAt, tz: v.timeZone, title: v.title, who: v.orgName, href: projectHref(h.key, p.token), month: null });
  }
  for (const m of h.memberships) {
    if (m.nextVisit) items.push({ key: `m-${m.href}`, ymd: ymdIn(m.nextVisit.at, h.timeZone), at: null, tz: h.timeZone, title: m.nextVisit.label, who: `${m.orgName} · ${m.name}`, href: m.href, month: null });
  }
  const planned = h.plans.filter((p) => p.status === "PLANNED");
  for (const p of planned) items.push({ key: `p-${p.id}`, ymd: p.date, at: null, tz: "UTC", title: p.title, who: "Planned", href: null, month: p.wholeMonth ? p.when : null });
  const upcoming = items.filter((x) => x.ymd >= today.slice(0, x.month ? 7 : 10)).sort((a, b) => a.ymd.localeCompare(b.ymd));

  const quotesHref: Record<string, string> = {};
  const rangeHref: Record<string, string> = {};
  for (const p of planned) {
    quotesHref[p.id] = newProjectHref(h.key, { plan: p.id });
    if (p.estimate) rangeHref[p.id] = `/homeowner/price/roof?home=${encodeURIComponent(h.key)}&plan=${encodeURIComponent(p.id)}`;
  }
  const submitted = h.plans.filter((p) => p.status === "SUBMITTED" && p.token);

  return (
    <Section id="calendar" kicker="Visits and plans" title="Calendar">
      <section className={`${s.card} ${s.compact}`} aria-labelledby="up-title">
        <div className={s.cardHead}>
          <h3 id="up-title" className={s.h2}>Coming up</h3>
          <a className={s.btnText} href={`${homeHref(h.key)}/calendar.ics`} data-ics><Icon id="cal" small />Add to phone calendar</a>
        </div>
        {upcoming.length === 0 ? (
          <p className={s.muted}>Nothing on the calendar yet. Visits your contractor books and the projects you plan show up here.</p>
        ) : (
          <ul className={s.events}>
            {upcoming.map((x) => {
              const date = new Date(`${x.ymd}T12:00:00Z`);
              return (
                <li key={x.key} className={s.event} data-upcoming>
                  <span className={s.eventDate}>
                    <b>{x.month ? date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</b>
                    <span>{x.month ? date.getUTCFullYear() : date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
                  </span>
                  <span className={s.eventBody}>
                    {x.href ? <a className={s.rowLink} href={x.href}>{x.title}</a> : <span>{x.title}</span>}
                    <span className={s.sub}>{x.at ? <><LocalTime iso={x.at} kind="time" tz={x.tz} /> · </> : x.month ? "Sometime in the month · " : ""}{x.who}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={`${s.card} ${s.compact}`} aria-labelledby="planned-title" id="plan">
        <h3 id="planned-title" className={s.h2}>Planned</h3>
        {planned.length > 0 && <PlannedList homeKey={h.key} plans={planned} quotesHref={quotesHref} rangeHref={rangeHref} />}
        {submitted.length > 0 && (
          <p className={s.sub}>
            Sent from here:{" "}
            {submitted.map((p, i) => (
              <span key={p.id}>{i > 0 ? ", " : ""}<a className={s.link} href={projectHref(h.key, p.token!)}>{p.title}</a></span>
            ))}
          </p>
        )}
        <details className={s.fold} open={planned.length === 0}>
          <summary>Planning something for later?</summary>
          <div className={s.foldBody}>
            <p className={s.sub}>Put it on the calendar. When the month comes, we remind you — and one tap gets you quotes.</p>
            <PlanAheadForm homeKey={h.key} />
          </div>
        </details>
      </section>
    </Section>
  );
}
