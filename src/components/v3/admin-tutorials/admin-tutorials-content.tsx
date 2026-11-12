"use client";

// ADMIN → TUTORIALS (owner, 2026-11-11: "add to admin statistics how many times the tutorials were watched and by
// who"). On top the totals; then each film: plays, people, finished, how far people get; then who watched: the
// person, their company, the film, plays, how far, finished, when last. Filters: the film, and JobFlex staff in or out.
// Read-only; counted from lib/tutorials/views (since 2026-11-11 — nothing before was kept on the server).

import { useMemo, useRef, useState } from "react";
import { clock } from "@/lib/tutorials/catalog";
import { tutorialStats, watchedPct } from "@/lib/tutorials/viewStats";
import { Chip, Empty, KpiStrip, Meta, cx, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import s from "./admin-tutorials.module.css";

export interface ViewRowDTO {
  userId: string;
  organizationId: string;
  slug: string;
  plays: number;
  maxSec: number;
  done: boolean;
  firstAt: string;
  lastAt: string;
  name: string | null;
  email: string | null;
  staff: boolean;
  company: string | null;
}

export interface FilmDTO {
  slug: string;
  title: string;
  duration: number;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <span className={s.bar}>
      <i aria-hidden="true">
        <b style={{ width: `${pct}%` }} />
      </i>
      <span>{label}</span>
    </span>
  );
}

export function AdminTutorialsContent({ rows, films }: { rows: ViewRowDTO[] | null; films: FilmDTO[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [film, setFilm] = useState("ALL");
  const [staff, setStaff] = useState<"out" | "in">("out");
  const filmBy = useMemo(() => new Map(films.map((f) => [f.slug, f])), [films]);
  const counted = useMemo(() => (rows ?? []).filter((r) => r.plays > 0 && (staff === "in" || !r.staff)), [rows, staff]);
  const stats = useMemo(() => tutorialStats(counted, films), [counted, films]);
  const who = useMemo(
    () => counted.filter((r) => film === "ALL" || r.slug === film).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)),
    [counted, film],
  );
  const most = [...stats.films].sort((a, b) => b.plays - a.plays)[0];
  const staffRows = (rows ?? []).filter((r) => r.staff && r.plays > 0).length;

  return (
    <div ref={rootRef} className={s.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Learning</div>
          <h1 className="page-title">Tutorials</h1>
        </div>
      </div>

      {rows === null ? (
        <section className="card rv">
          <Empty>The tutorial counts couldn&apos;t be read. Refresh in a minute.</Empty>
        </section>
      ) : (
        <>
          <KpiStrip
            cols={5}
            cells={[
              { label: "Plays", value: String(stats.plays), accent: stats.plays > 0 },
              { label: "People", value: String(stats.people) },
              { label: "Companies", value: String(stats.companies) },
              { label: "Watched to the end", value: String(stats.finished), tone: stats.finished > 0 ? "ok" : undefined },
              { label: "Most watched", value: most && most.plays > 0 ? most.title : "—" },
            ]}
          />

          <section className="card rv" data-tutorial-films>
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Each tutorial</div>
                <div className="card-sub">A play is a film started on the Tutorials page; pausing and going on is the same play. How far: where the middle viewer got to.</div>
              </div>
            </div>
            <div className={ui.tbl} role="table" aria-label="Each tutorial">
              <div className={cx(ui.tr, ui.th, s.filmCols)} role="row">
                <span>Tutorial</span>
                <span>Plays</span>
                <span>People</span>
                <span>Finished</span>
                <span>How far people get</span>
              </div>
              {stats.films.map((f) => (
                <div key={f.slug} className={cx(ui.tr, s.filmCols)} role="row" data-tutorial-film={f.slug}>
                  <span className={ui.tdWide}>
                    <span className={ui.tdName} title={f.title}>{f.title}</span>
                    <span className={ui.tdSub}>{clock(f.duration)} long</span>
                  </span>
                  <span className={s.num}>
                    <span className={ui.tdLbl}>Plays</span>
                    {f.plays}
                  </span>
                  <span className={s.num}>
                    <span className={ui.tdLbl}>People</span>
                    {f.people}
                  </span>
                  <span className={s.num}>
                    <span className={ui.tdLbl}>Finished</span>
                    {f.finished}
                  </span>
                  <span>
                    <span className={ui.tdLbl}>How far people get</span>
                    {f.people ? <Bar pct={f.avgPct} label={`${f.avgPct}%`} /> : <Meta>Not watched yet</Meta>}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card rv" data-tutorial-who>
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Who watched</div>
                <div className="card-sub">Newest first. Counting started on Nov 11, 2026; before that the page kept progress only in each browser.</div>
              </div>
              <div className={s.filters}>
                <select aria-label="Tutorial" value={film} onChange={(e) => setFilm(e.target.value)} data-tutorial-filter>
                  <option value="ALL">All tutorials</option>
                  {films.map((f) => (
                    <option key={f.slug} value={f.slug}>
                      {f.title}
                    </option>
                  ))}
                </select>
                <select aria-label="JobFlex staff" value={staff} onChange={(e) => setStaff(e.target.value as "out" | "in")} data-tutorial-staff>
                  <option value="out">Without JobFlex staff{staffRows ? ` (${staffRows} hidden)` : ""}</option>
                  <option value="in">With JobFlex staff</option>
                </select>
              </div>
            </div>
            {who.length === 0 ? (
              <Empty>{counted.length === 0 ? "No one has watched a tutorial yet." : "No one has watched this tutorial yet."}</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="Who watched">
                <div className={cx(ui.tr, ui.th, s.whoCols)} role="row">
                  <span>Person</span>
                  <span>Company</span>
                  <span>Tutorial</span>
                  <span>Plays</span>
                  <span>How far</span>
                  <span>Finished</span>
                  <span>Last watched</span>
                </div>
                {who.map((r) => {
                  const f = filmBy.get(r.slug);
                  const pct = f ? watchedPct(r.maxSec, f.duration) : 0;
                  return (
                    <div key={`${r.userId}:${r.slug}`} className={cx(ui.tr, s.whoCols)} role="row" data-tutorial-viewer={r.userId}>
                      <span className={ui.tdWide}>
                        <span className={ui.tdName} title={r.name ?? r.email ?? ""}>
                          {r.name || r.email || "Someone"} {r.staff ? <Chip tone="mute">Staff</Chip> : null}
                        </span>
                        <span className={ui.tdSub} title={r.email ?? ""}>{r.email ?? ""}</span>
                      </span>
                      <span>
                        <span className={ui.tdLbl}>Company</span>
                        {r.company ?? <Meta>—</Meta>}
                      </span>
                      <span>
                        <span className={ui.tdLbl}>Tutorial</span>
                        {f?.title ?? r.slug}
                      </span>
                      <span className={s.num}>
                        <span className={ui.tdLbl}>Plays</span>
                        {r.plays}
                      </span>
                      <span>
                        <span className={ui.tdLbl}>How far</span>
                        <Bar pct={pct} label={f ? `${clock(Math.min(r.maxSec, f.duration))} of ${clock(f.duration)}` : `${r.maxSec}s`} />
                      </span>
                      <span>
                        <span className={ui.tdLbl}>Finished</span>
                        {r.done ? <Chip tone="ok">Finished</Chip> : <Meta>Not yet</Meta>}
                      </span>
                      <span>
                        <span className={ui.tdLbl}>Last watched</span>
                        {when(r.lastAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className={s.note}>One line per person per tutorial. A person who watched three tutorials has three lines.</p>
          </section>
        </>
      )}
    </div>
  );
}
