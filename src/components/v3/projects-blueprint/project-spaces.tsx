"use client";

// THE PROJECT WORKSPACES (owner, 2026-11-09; lib/projectSpaces): the Projects page opens on three cards — New Home
// Builder, Remodeler, Job Projects — each a drawing, a line, what it adds and its live numbers; under them, what needs
// someone today across all of them. Inside a workspace, its own header in its colour with the way to the other two,
// and its road: the work in order with every project pinned where it stands. Desk and phone draw the same.

import Link from "next/link";
import type { Route } from "next";
import type { CSSProperties, ReactNode } from "react";
import { SPACES, SPACE_IDS, spaceHref, type SpaceId } from "@/lib/projectSpaces";
import { needsToday, roadPins, spaceOfRow, spaceSummaries } from "./project-spaces-data";
import type { Project } from "./projects-data";
import s from "./project-spaces.module.css";

const styleOf = (id: SpaceId) => ({ "--space": SPACES[id].color, "--space-wash": SPACES[id].wash }) as CSSProperties;
const projectHref = (id: string) => `/dashboard/projects/${id}` as Route;

/** The workspace's drawing: a house frame on its lot, a kitchen, a deck and its stairs. Line work in ink, the
 *  workspace's colour where the eye should land. */
export function SpaceArt({ id, className }: { id: SpaceId; className?: string }) {
  const ink = "var(--ink, #0a0a0a)";
  const c = SPACES[id].color;
  const common = { viewBox: "0 0 240 140", className, role: "img" as const, fill: "none", stroke: ink, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "build") {
    return (
      <svg {...common} aria-label="A house frame on its lot">
        <circle cx="206" cy="26" r="10" fill={c} fillOpacity="0.18" stroke={c} />
        <path d="M8 118h224" />
        <path d="M14 118v-14M14 104l6 4M226 118v-14M226 104l-6 4" stroke={c} />
        <rect x="40" y="104" width="160" height="14" fill={c} fillOpacity="0.14" />
        <path d="M40 104V60h160v44" />
        {[56, 72, 88, 104, 136, 152, 168, 184].map((x) => (
          <path key={x} d={`M${x} 104V60`} strokeWidth={1.5} />
        ))}
        <path d="M112 104V76h16v28" stroke={c} />
        <path d="M32 60 120 20l88 40" strokeWidth={2.5} />
        <path d="M120 20v40M76 40l22 20M164 40l-22 20M76 40v20M164 40v20" strokeWidth={1.5} />
      </svg>
    );
  }
  if (id === "remodel") {
    return (
      <svg {...common} aria-label="A kitchen being remodeled">
        <path d="M8 118h224" />
        <rect x="24" y="22" width="62" height="32" />
        <path d="M55 22v32" strokeWidth={1.5} />
        <rect x="154" y="22" width="62" height="32" />
        <path d="M185 22v32" strokeWidth={1.5} />
        <path d="M104 22h32l8 22h-48z" fill={c} fillOpacity="0.14" stroke={c} />
        <path d="M18 80h204" strokeWidth={4} stroke={c} />
        <rect x="24" y="82" width="192" height="36" />
        <path d="M70 82v36M170 82v36" strokeWidth={1.5} />
        <rect x="98" y="88" width="44" height="24" fill={c} fillOpacity="0.1" />
        <path d="M104 84h4M116 84h4M128 84h4" stroke={c} />
        {[60, 66, 72].map((y) => (
          <path key={y} d={`M24 ${y}h56M160 ${y}h56`} strokeWidth={1} strokeOpacity={0.35} />
        ))}
        <path d="M120 54v8" stroke={c} />
        <circle cx="120" cy="66" r="4" fill={c} stroke={c} />
      </svg>
    );
  }
  return (
    <svg {...common} aria-label="A deck with its railing and stairs">
      <circle cx="206" cy="26" r="10" fill={c} fillOpacity="0.18" stroke={c} />
      <path d="M8 118h224" />
      <path d="M22 30v88" strokeWidth={2.5} />
      <rect x="22" y="76" width="152" height="10" fill={c} fillOpacity="0.2" stroke={c} />
      <path d="M40 86v32M100 86v32M164 86v32" />
      <path d="M22 50h152" strokeWidth={2.5} />
      {[34, 46, 58, 70, 82, 94, 106, 118, 130, 142, 154, 166].map((x) => (
        <path key={x} d={`M${x} 50v26`} strokeWidth={1.5} />
      ))}
      <path d="M174 86h12v10h12v10h12v12" stroke={c} strokeWidth={2.5} />
      <path d="M174 50l38 44" strokeWidth={2} />
    </svg>
  );
}

/** The three cards and what needs someone today. */
export function ProjectSpacesHome({ rows }: { rows: Project[] }) {
  const sum = spaceSummaries(rows);
  const today = needsToday(rows);
  return (
    <div className={s.home} data-project-spaces>
      <div className={s.homeHead}>
        <div className={s.kicker}>Projects</div>
        <h1 className={s.homeTitle}>Pick your workspace</h1>
        <p className={s.homeLead}>Each one is built for its kind of work: its own steps, its own checks, its own words.</p>
      </div>
      <div className={s.cards}>
        {SPACE_IDS.map((id) => {
          const sp = SPACES[id];
          const n = sum[id];
          return (
            <Link key={id} href={spaceHref(id) as Route} className={s.spaceCard} style={styleOf(id)} data-space-card={id}>
              <span className={s.artBox}>
                <SpaceArt id={id} className={s.art} />
              </span>
              <span className={s.brand}>{sp.brand}</span>
              <span className={s.spaceName}>{sp.name}</span>
              <span className={s.tagline}>{sp.tagline}</span>
              <span className={s.adds}>
                {sp.adds.map((a) => (
                  <span key={a} className={s.add}>
                    {a}
                  </span>
                ))}
              </span>
              <span className={s.stats} data-space-stats>
                <span className={s.stat}>
                  <b>{n.active}</b> active
                </span>
                <span className={`${s.stat} ${n.atRisk ? s.statRisk : ""}`}>
                  <b>{n.atRisk}</b> at risk
                </span>
                <span className={`${s.stat} ${n.needsYou ? s.statNeeds : ""}`}>
                  <b>{n.needsYou}</b> need you
                </span>
              </span>
              <span className={s.worst}>{n.worst ? <>{n.worst.risk ? "⚠ " : ""}<b>{n.worst.name}</b>: {n.worst.text}</> : n.active ? "Everything is on track." : `No ${sp.plural} yet.`}</span>
              <span className={s.open}>Open {sp.name} →</span>
            </Link>
          );
        })}
      </div>
      <section className={s.today} aria-label="Needs you today" data-needs-today>
        <h2 className={s.todayTitle}>Needs you today</h2>
        {today.length ? (
          <ul className={s.todayList}>
            {today.map((x) => (
              <li key={x.id} style={styleOf(x.space)}>
                <Link href={projectHref(x.id)} className={s.todayRow}>
                  <span className={`${s.todayDot} ${x.risk ? s.todayRisk : ""}`} aria-hidden />
                  <span className={s.todaySpace}>{SPACES[x.space].name}</span>
                  <b className={s.todayName}>{x.name}</b>
                  <span className={s.todayText}>
                    {x.text}
                    {x.more ? ` · +${x.more} more` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={s.calm}>Nothing needs you across your projects today.</div>
        )}
      </section>
    </div>
  );
}

/** A workspace's own header: its brand and name in its colour, its drawing, the way to the other two, and its road. */
export function SpaceHeader({ space, rows, actions }: { space: SpaceId; rows: Project[]; actions: ReactNode }) {
  const sp = SPACES[space];
  const road = roadPins(space, rows);
  const mine = rows.filter((p) => spaceOfRow(p) === space && (p.status === "ACTIVE" || p.status === "ON_HOLD"));
  return (
    <div className={s.spaceHead} style={styleOf(space)} data-space-head={space}>
      <div className={s.band}>
        <div className={s.bandText}>
          <nav className={s.switch} aria-label="Workspaces">
            <Link href={"/dashboard/projects" as Route} className={s.switchAll}>
              ← All workspaces
            </Link>
            {SPACE_IDS.filter((id) => id !== space).map((id) => (
              <Link key={id} href={spaceHref(id) as Route} className={s.switchTo} style={styleOf(id)}>
                {SPACES[id].name}
              </Link>
            ))}
          </nav>
          <div className={s.kicker}>{sp.brand}</div>
          <h1 className={s.spaceTitle}>{sp.name}</h1>
          <p className={s.spaceLead}>{sp.tagline}</p>
          <div className={s.bandActs}>{actions}</div>
        </div>
        <SpaceArt id={space} className={s.bandArt} />
      </div>
      <div className={s.roadCard} data-space-road>
        <div className={s.roadHead}>
          <b>Where every {sp.one} stands</b>
          <span>{mine.length ? `${mine.length} working · tap one to open it` : sp.empty}</span>
        </div>
        <ol className={s.road} style={{ "--steps": road.length } as CSSProperties}>
          {road.map((st, i) => (
            <li key={st.key} className={`${s.roadStep} ${st.pins.length ? s.roadBusy : ""}`} data-road-step={st.key}>
              <span className={s.roadDot}>{st.pins.length || i + 1}</span>
              <span className={s.roadName}>{st.name}</span>
              <span className={s.pins}>
                {st.pins.slice(0, 3).map((p) => (
                  <Link key={p.id} href={projectHref(p.id)} className={`${s.pin} ${p.risk ? s.pinRisk : ""}`} title={p.done != null ? `${p.done}% done` : undefined} data-road-pin>
                    {p.name}
                  </Link>
                ))}
                {st.pins.length > 3 ? <span className={s.pinMore}>+{st.pins.length - 3} more</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
