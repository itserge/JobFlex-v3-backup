// /home/[key]/calendar (2026-10-30): what is coming, as a list — "Nov 4 ·
// Site visit · Alder Peak Roofing" — with "Add to phone calendar" (the same
// .ics as before); the planned projects with their months; "Planning
// something for later? Put it on the calendar". A compact month grid only on
// a desk, on the right. Plans moved here from the old "Plans" anchor: every
// plan has a month and was already in the calendar and its .ics.
import type { HomeDashboard } from "@/lib/home/portal";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, PortalFrame } from "./portal-frame";
import { PlanAheadForm, PlannedList } from "./plan-ahead";
import { homeHref, houseLine, newProjectHref, projectHref } from "./view";
import s from "./portal.module.css";

type Upcoming = { key: string; ymd: string; at: string | null; tz: string; title: string; who: string; href: string | null; month: string | null };

function ymdIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function monthGrid(year: number, month: number): Array<string | null> {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function CalendarPage({ h }: { h: HomeDashboard }) {
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

  // The grid: this month and the next, every calendar day the dashboard knows (past ones grey).
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const byDay = new Map<string, "visit" | "plan" | "past">();
  for (const it of h.calendar) {
    const kind = it.kind === "plan" ? "plan" : it.kind === "visit" ? "visit" : "past";
    if (!byDay.has(it.date) || kind === "visit") byDay.set(it.date, kind);
  }
  const months = [0, 1].map((i) => {
    const d = new Date(Date.UTC(ty, tm + i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });

  return (
    <PortalFrame homeKey={h.key} house={houseLine(h)} tab="calendar" email={h.email}>
      <h1 className={s.h1}>Calendar</h1>
      <div className={s.cols}>
        <div className={s.col}>
          <section className={s.card} aria-labelledby="up-title">
            <div className={s.cardHead}>
              <h2 id="up-title" className={s.h2}>Coming up</h2>
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
                        {x.href ? <a href={x.href}>{x.title}</a> : <span>{x.title}</span>}
                        <span className={s.muted}>{x.at ? <><LocalTime iso={x.at} kind="time" tz={x.tz} /> · </> : x.month ? "Sometime in the month · " : ""}{x.who}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={s.card} aria-labelledby="ahead-title" id="plan">
            <div className={s.stack}>
              <h2 id="ahead-title" className={s.h2}>Planning something for later?</h2>
              <p className={s.text}>Put it on the calendar. When the month comes, we remind you — and one tap gets you quotes.</p>
            </div>
            <PlanAheadForm homeKey={h.key} />
          </section>

          {planned.length > 0 && (
            <section className={s.card} aria-labelledby="planned-title">
              <h2 id="planned-title" className={s.h2}>Planned</h2>
              <PlannedList homeKey={h.key} plans={planned} quotesHref={quotesHref} rangeHref={rangeHref} />
              {submitted.length > 0 && (
                <p className={s.muted}>
                  Sent from here:{" "}
                  {submitted.map((p, i) => (
                    <span key={p.id}>{i > 0 ? ", " : ""}<a className={s.link} href={projectHref(h.key, p.token!)}>{p.title}</a></span>
                  ))}
                </p>
              )}
            </section>
          )}
        </div>

        <div className={`${s.col} ${s.month}`} aria-hidden="true">
          <section className={s.card}>
            {months.map((mo) => (
              <div key={mo.label}>
                <p className={s.monthName}>{mo.label}</p>
                <div className={s.grid}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i} className={s.dow}>{d}</span>)}
                  {monthGrid(mo.y, mo.m).map((ymd, i) => {
                    const kind = ymd ? byDay.get(ymd) : undefined;
                    const cls = [s.day, !ymd ? s.dayPad : "", ymd === today ? s.dayToday : "", kind ? s.dayHas : ""].join(" ");
                    return <span key={i} className={cls} data-kind={kind && ymd && ymd < today ? "past" : kind}>{ymd ? Number(ymd.slice(8, 10)) : ""}</span>;
                  })}
                </div>
              </div>
            ))}
            <p className={`${s.muted} ${s.legend}`}>
              <span><i data-kind="visit" />Visit</span>
              <span><i data-kind="plan" />Planned</span>
              <span><i data-kind="past" />Past</span>
            </p>
          </section>
        </div>
      </div>
    </PortalFrame>
  );
}
