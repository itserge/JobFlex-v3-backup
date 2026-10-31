// The portal's frame: the ink bar (brand, the house on a desk, ONE action —
// "Start a project"), then the sticky tabs Projects · Contractors · Calendar ·
// Details. Since 2026-10-31 the four are sections of the one page /home/[key]
// (as the portal was before the 2026-10-30 rebuild): on that page the tabs are
// in-page anchors with scroll-spy (AnchorTabs); on a project and on Start a
// project they link back to those anchors. Plans live in Calendar: every plan
// has a month, and the calendar and its .ics already carried them.
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Sprite } from "@/components/v3/blueprint-shell/sprite";
import { ProductMark } from "@/components/brand/ProductMark";
import { LiveRefresh } from "@/components/portal/live-time";
import { AnchorTabs } from "./anchor-tabs";
import { STEPS, homeHref, newProjectHref } from "./view";
import s from "./portal.module.css";

export type PortalTab = "projects" | null;

export const SECTIONS = [
  { id: "projects", label: "Projects" },
  { id: "contractors", label: "Contractors" },
  { id: "calendar", label: "Calendar" },
  { id: "details", label: "Details" },
] as const;

export function Icon({ id, small = false }: { id: string; small?: boolean }) {
  return (
    <svg className={small ? `${s.ic} ${s.icSm}` : s.ic} aria-hidden="true">
      <use href={`#i-${id}`} />
    </svg>
  );
}

/**
 * `homeKey` null: a page with no home yet (lost the link) — the brand only.
 * `onePage`: the home page itself, whose sections the tabs scroll to.
 */
export function PortalFrame({ homeKey, house, tab, onePage = false, live = true, startCta = true, email, children }: { homeKey: string | null; house?: string | null; tab: PortalTab; onePage?: boolean; live?: boolean; startCta?: boolean; email?: string; children: ReactNode }) {
  return (
    <div className={s.hp} data-nest data-home-portal>
      <Sprite />
      <header className={s.bar}>
        <div className={s.barIn}>
          <Link className={s.brand} href={homeKey ? homeHref(homeKey) : "/"} aria-label="JobFlex Home">
            <ProductMark tone="paper" />
            <span className={s.brandText}>
              <span className={s.brandWord}>JobFlex</span>
              <span className={s.brandTag}>Homeowner portal</span>
            </span>
          </Link>
          {house && (
            <p className={s.house}>
              <Icon id="pin" small />
              {house}
            </p>
          )}
          {homeKey && startCta && (
            <Link className={`${s.btnPrimary} ${s.start}`} href={newProjectHref(homeKey)} aria-label="Start a project" data-home-start>
              <Icon id="plus" small />
              Start<span className={s.startMore}> a project</span>
            </Link>
          )}
        </div>
      </header>
      {homeKey &&
        (onePage ? (
          <AnchorTabs tabs={SECTIONS.map((t) => ({ id: t.id, label: t.label }))} />
        ) : (
          <nav className={s.tabs} aria-label="Your home">
            <div className={s.tabsIn}>
              {SECTIONS.map((t) => (
                <Link key={t.id} className={s.tab} href={`${homeHref(homeKey)}#${t.id}` as Route} aria-current={tab === t.id ? "page" : undefined}>
                  {t.label}
                </Link>
              ))}
            </div>
          </nav>
        ))}
      <main className={s.wrap}>{children}</main>
      <footer className={s.foot}>
        {homeKey && live && <LiveRefresh className={s.live} />}
        {homeKey && (
          <p>
            This page is private to you — anyone with the link can see your projects, so share it carefully.
            {email ? <> Lost the link? Go to <Link href="/home">jobflex.app/home</Link> and we&apos;ll email it to {email}.</> : null}
          </p>
        )}
        <p>
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/homeowner">JobFlex for homeowners</Link>
        </p>
      </footer>
    </div>
  );
}

/** A section of the home page: its uppercase title and kicker on one 40px rule, then its content. */
export function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={s.section} aria-labelledby={`${id}-title`}>
      <div className={s.secHead}>
        <h2 id={`${id}-title`} className={s.secTitle}>{title}</h2>
        <p className={s.kicker}>{kicker}</p>
      </div>
      <div className={s.secBody}>{children}</div>
    </section>
  );
}

/** The six-step rail: numbered squares — reached ones filled ink, the step the project is on blue, the rest outlined. */
export function StatusTrack({ stage, label }: { stage: number; label: string }) {
  return (
    <ol className={s.track} aria-label={label}>
      {STEPS.map((st, i) => {
        const state = i < stage ? "done" : i === stage ? "now" : "todo";
        return (
          <li key={st} className={s.trackStep} data-state={state} aria-current={state === "now" ? "step" : undefined}>
            <span className={s.trackMark} aria-hidden="true" />
            <span>
              {st}
              <span className={s.srOnly}>{state === "done" ? " — done" : state === "now" ? " — where it is now" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
