// The portal's frame (2026-10-30): the brand, the house, ONE action ("Start a
// project") and the menu — Projects · Contractors · Calendar · Details. Plans
// live in Calendar: every plan has a month, the calendar and its .ics file
// already carried them, and "put it on the calendar" is what planning ahead
// is. The menu is links between pages, not anchors on one long page.
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Sprite } from "@/components/v3/blueprint-shell/sprite";
import { ProductMark } from "@/components/brand/ProductMark";
import { LiveRefresh } from "@/components/portal/live-time";
import { STEPS, homeHref, newProjectHref } from "./view";
import s from "./portal.module.css";

export type PortalTab = "projects" | "contractors" | "calendar" | "details" | null;

const TABS: Array<{ id: Exclude<PortalTab, null>; label: string; path: string }> = [
  { id: "projects", label: "Projects", path: "" },
  { id: "contractors", label: "Contractors", path: "/contractors" },
  { id: "calendar", label: "Calendar", path: "/calendar" },
  { id: "details", label: "Details", path: "/details" },
];

export function Icon({ id, small = false }: { id: string; small?: boolean }) {
  return (
    <svg className={small ? `${s.ic} ${s.icSm}` : s.ic} aria-hidden="true">
      <use href={`#i-${id}`} />
    </svg>
  );
}

/** `homeKey` null: a page with no home yet (lost the link) — the brand only. */
export function PortalFrame({ homeKey, house, tab, live = true, startCta = true, email, children }: { homeKey: string | null; house?: string | null; tab: PortalTab; live?: boolean; startCta?: boolean; email?: string; children: ReactNode }) {
  return (
    <div className={s.hp} data-nest data-home-portal>
      <Sprite />
      <header className={s.top}>
        <div className={s.topIn}>
          <div className={s.topRow}>
            <Link className={s.brand} href={homeKey ? homeHref(homeKey) : "/"} aria-label="JobFlex Home">
              <ProductMark />
              <span className={s.brandWord}>JobFlex <span>Home</span></span>
            </Link>
            {homeKey && startCta && (
              <Link className={s.btnPrimary} href={newProjectHref(homeKey)} data-home-start>
                <Icon id="plus" small />
                Start a project
              </Link>
            )}
          </div>
          {house && (
            <p className={s.house}>
              <Icon id="pin" small />
              {house}
            </p>
          )}
          {homeKey ? (
            <nav className={s.nav} aria-label="Your home">
              {TABS.map((t) => (
                <Link key={t.id} className={s.navLink} href={`${homeHref(homeKey)}${t.path}` as Route} aria-current={tab === t.id ? "page" : undefined}>
                  {t.label}
                </Link>
              ))}
            </nav>
          ) : (
            <div style={{ height: 10 }} />
          )}
        </div>
      </header>
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

/** The six-step bar: reached steps in ink with a square check, the step the project is on in blue, the rest grey. */
export function StatusTrack({ stage, label }: { stage: number; label: string }) {
  return (
    <ol className={s.track} aria-label={label}>
      {STEPS.map((st, i) => {
        const state = i < stage ? "done" : i === stage ? "now" : "todo";
        return (
          <li key={st} className={s.trackStep} data-state={state} aria-current={state === "now" ? "step" : undefined}>
            <span className={s.trackMark} aria-hidden="true">
              {state !== "todo" && (
                <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              )}
            </span>
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
