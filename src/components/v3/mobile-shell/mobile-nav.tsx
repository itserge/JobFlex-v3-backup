"use client";

// MOBILE NAV — the shared handheld navigation chrome.
//
// One component for every mobile surface: the dark topbar (burger, product
// mark, wordmark, new estimate, help, notifications) and the slide-out drawer
// carrying the full 22-item nav map with its sliding active-item plate.
//
// WHY THIS EXISTS (owner's call, 2026-07-29). The topbar and drawer were
// byte-identical in all three mobile page modules: 29 duplicated CSS classes,
// three copies of the open/close state, three copies of the indicator
// measurement, three private sprites. Every new mobile page paid that cost
// again, and the three copies had already begun to drift. There is now one, and
// a new page gets the nav by rendering <MobileNav /> as the first child of its
// own `.app` grid.
//
// This deliberately mirrors the DESKTOP arrangement: BlueprintShell owns the
// sidebar + topbar + sprite for the ~21 desktop blueprint pages and each page
// supplies only its `.content` children. Same division of labour, same reason.
//
// WHAT THE PAGE STILL OWNS. This is nav only, not a layout wrapper: the page
// keeps its own `.app` grid, `.scroll` scroller and `.content`, because those
// carry page-specific padding, the graph-paper parallax and the reveal
// cascade — and because `.content > *` is what the cascade measures, so it has
// to stay in the page's own tree.
//
// TOKEN CONTRACT. The stylesheet reads --paper / --ink / --topbar-h /
// --sidebar-w / --pad-x / --tbar-gap / --safe-b and friends from the page root
// it is mounted inside. Custom properties inherit, so a page declaring them on
// its `.app` is enough. See mobile-nav.module.css for the full list.

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  activeHref,
  canOpen,
  isLimitedRole,
  navSectionsFor,
  type NavItem,
  type NavSection,
} from "@/components/v3/blueprint-shell/nav-map";
import {
  quotaPill,
  useNavBadges,
  useNavIdentity,
  useNavLimits,
  useNavLimitsExempt,
  useNavHidden,
  useNavView,
  useNavLocked,
  type NavLimit,
} from "@/components/v3/blueprint-shell/nav-role";
import { NotificationBell } from "@/components/v3/blueprint-shell/notification-bell";
import { SignOutButton } from "@/components/v3/blueprint-shell/sign-out";
import { EstimatorPicker } from "@/components/v3/estimators-blueprint/estimator-picker";
import { FilingChip } from "@/components/v3/filing-chip/filing-chip";
import { SupportWidget } from "@/components/v3/support-widget/support-widget";
import { ACTIVE_ENGINE_HREFS } from "@/components/v3/estimators-blueprint/estimators-data";
import styles from "./mobile-nav.module.css";
import "@/components/v3/estimators-blueprint/estimators-global.css";
import { MobileSprite } from "./sprite";
import { TourChip } from "@/components/v3/onboarding-tour/tour-chip";
import { SmartHelpRow } from "@/components/v3/smarthelp/smarthelp-row";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Icon({ id }: { id: string }) {
  return (
    <svg className={styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** Membership.role is a raw enum-ish string; the account row shows it to a
 *  human. Empty outside the provider rather than guessing "Owner". */
function roleTitle(role: string | null): string {
  if (!role) return "";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/** The pill's spoken copy: what the number counts and when it resets — the
 *  desktop sidebar's hover tooltip, as the tap/long-press title here. */
function quotaTip(q: NavLimit): string {
  const cycle = q.scope === "absolute" ? "" : " this cycle";
  if (q.remaining <= 0) {
    return `You've used all ${q.limit} ${q.label} in your plan${cycle}. Upgrade to add more.`;
  }
  return `${q.remaining} of ${q.limit} ${q.label} left${cycle}.`;
}

/** Initials for the account plate — the same rule the desktop sidebar uses. */
function monogram(name: string): string {
  const p = name.replace(/[^A-Za-z. ]/g, "").split(" ").filter(Boolean);
  if (!p.length) return "?";
  return p.length === 1
    ? p[0].slice(0, 2).toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/**
 * Surfaces that exist ONLY as handheld builds, spliced into the shared map for
 * the drawer alone. The desktop sidebar has nowhere to send them — on a desk
 * Overhead is the second tab of /dashboard/financials, not a page — so they
 * are not added to NAV_SECTIONS.
 *
 * Each rides directly under its parent item and inherits the parent's role
 * gate: if the filter dropped Financials, Overhead goes with it.
 */
const HANDHELD_SURFACES: ReadonlyArray<{ after: string; item: NavItem }> = [
  {
    after: "/dashboard/financials",
    item: { label: "Overhead", icon: "i-building", href: "/mobile-overhead-v1" },
  },
];

function withHandheldSurfaces(sections: NavSection[]): NavSection[] {
  return sections.map((sec) => {
    const items: NavItem[] = [];
    for (const it of sec.items) {
      items.push(it);
      for (const h of HANDHELD_SURFACES) if (h.after === it.href) items.push(h.item);
    }
    return items.length === sec.items.length ? sec : { ...sec, items };
  });
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const navScrollRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  // Where focus goes back when SmartHelp, opened from the drawer, closes: the drawer's row is gone by then.
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  /* Derived from the URL, never held in state. A label string only moved the
     highlight, which is why the drawer could once change the plate without
     changing the page. */
  const pathname = usePathname() ?? "";
  // Handheld-only surfaces (HANDHELD_SURFACES) are not in the shared map, so
  // the shared resolver returns null for them; the raw path is then the
  // item's own href.
  const active = activeHref(pathname) ?? pathname;
  // Which estimator trees are open. Unset: open when the estimator or its sub-page is the page shown.
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const isTreeOpen = (item: NavItem) => folds[item.href] ?? (active === item.href || !!item.children?.some((c) => c.href === active));

  /* Who is looking, from the provider the blueprint layout mounts. The drawer
     drew the full 22-item map for everybody until 2026-08-17, so an installer
     invited as a field worker got a phone-sized copy of the manager's app.
     Same filter as the desktop sidebar, from the same module — see nav-map's
     ROLE FILTER header. Outside the provider (the standalone /mobile-*-v2
     review URLs) the role is null and nothing is filtered, exactly as before. */
  const { role, name: accountName } = useNavIdentity();
  // Custom-plan page locks, from the same provider; empty on every other plan.
  const locked = useNavLocked();
  const hidden = useNavHidden();
  const view = useNavView();
  const sections = withHandheldSurfaces(navSectionsFor(role, locked, hidden, view));
  /* Unread / pending counts by href, from the same provider the identity
     rides. Outside it (the standalone /mobile-*-v2 review URLs) the map is
     empty and no badge is drawn — exactly what those routes showed before. */
  const badges = useNavBadges();
  /* Remaining plan quota per href (lib/navLimits) — the same pills the desk
     sidebar draws, in the drawer since 2026-09-04 (owner: the phone showed
     none of the counters). */
  const limits = useNavLimits();
  const limitsExempt = useNavLimitsExempt();
  /* Every engine in the picker lives outside a field worker's allow-list, so
     for them the handheld New Estimate button could only open a dialog whose
     every card bounces. Asked of the engine list itself, not a copy of it. */
  const canEstimate = ACTIVE_ENGINE_HREFS.some((href) => canOpen(role, href, locked));
  /* The review URLs render this nav with no session behind it, so the Help
     button would open a composer whose send could only ever fail. Same signal
     the widget itself is given. */
  const signedIn = Boolean(accountName);
  const canOpenSettings = canOpen(role, "/dashboard/settings", locked);
  const canOpenAccount = canOpen(role, "/dashboard/settings/account");

  /* The sliding plate is MEASURED, not guessed: it needs the active link's real
     offsetTop/Height, which only exist once the drawer is laid out. `ready` is
     added a frame later so the first open snaps into place rather than sliding
     down from zero. */
  useEffect(() => {
    const ind = indicatorRef.current;
    if (!ind) return;
    if (!open) {
      ind.classList.remove(styles.ready);
      return;
    }
    const nav = navScrollRef.current;
    if (!nav) return;
    const raf = requestAnimationFrame(() => {
      const link = nav.querySelector<HTMLElement>(`.${styles.sbLink}.${styles.active}`);
      if (!link) return;
      ind.style.top = `${link.offsetTop}px`;
      ind.style.height = `${link.offsetHeight}px`;
      requestAnimationFrame(() => ind.classList.add(styles.ready));
    });
    return () => cancelAnimationFrame(raf);
  }, [open, active, folds]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* Press stamp for the nav's own controls. Delegated from the nav root so it
     also covers the drawer's links, which only exist once it is open. */
  const press = (e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const sel = [styles.tbarBtn, styles.sbClose, styles.sbFootIc, styles.sbFootAcc]
      .map((c) => `.${c}`)
      .join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  };


  // One row. An estimating tool keeps its coloured icon square (owner, 2026-10-17, as on the desk sidebar); a
  // sub-page row is indented under its estimator and marks itself when it is the page shown.
  const row = (item: NavItem, child = false) => {
    const isActive = item.href === active;
    const tool = child ? undefined : item.tool;
    const soonMark = !!item.soon && !item.locked;
    const cls = `${styles.sbLink} ${isActive ? styles.active : ""}${child ? ` ${styles.sbSubLink}` : ""}`;
    const count = badges[item.href] ?? 0;
    // The quota only when it is low or gone (quotaPill): a full
    // meter is not news, and a row never carries a bare "0".
    const quota = limits[item.href] ? quotaPill(limits[item.href]) : null;
    // Surfaces with no page yet stay dead, but must not jump the
    // scroller to the top on the way — the drawer just closes.
    return item.href === "#" ? (
      <a
        key={item.label}
        className={cls}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <Icon id={item.icon} />
        {item.label}
      </a>
    ) : (
      <Link
        key={item.label}
        className={cls + (item.locked ? ` ${styles.sbLockd}` : "") + (tool ? ` ${styles.sbTool}` : "") + (tool && soonMark ? ` ${styles.sbToolSoon}` : "")}
        data-tone={tool?.tone}
        data-tour={`nav:${item.href}`}
        href={item.href as Route}
        aria-current={isActive ? "page" : undefined}
        onClick={() => setOpen(false)}
      >
        {tool ? (
          <>
            <span className={styles.sbTile} aria-hidden="true">
              <Icon id={item.icon} />
            </span>
            <span className={styles.sbTxt}>
              <span className={styles.sbName}>{item.label}</span>
              {soonMark && (
                <span className={styles.sbSoonTag} aria-label="Coming soon">
                  Soon
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <Icon id={item.icon} />
            <span className={styles.sbName}>{item.label}</span>
          </>
        )}
        {/* Custom-plan lock beats the badge: a page the plan does
            not include has no unread anything worth advertising.
            Still a live link — the route shows the upgrade offer. */}
        {soonMark ? (
          tool ? null : <span className={styles.sbSoon}>Soon</span>
        ) : item.locked ? (
          <svg className={styles.sbLockIc} viewBox="0 0 24 24" aria-label="Not in your plan">
            <rect x="5" y="11" width="14" height="10" rx="1.5" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        ) : (
          <>
            {count > 0 && (
              <span className={styles.sbBadge} aria-label={`${count} new`}>
                {count > 99 ? "99+" : count}
              </span>
            )}
            {quota ? (
              <span
                className={`${styles.sbQuota}${quota.out ? ` ${styles.isOut}` : ""}${count > 0 ? "" : ` ${styles.sbQuotaEnd}`}`}
                title={quotaTip(limits[item.href])}
                aria-label={quotaTip(limits[item.href])}
              >
                {quota.text}
              </span>
            ) : null}
          </>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* One sprite for the whole surface — the page ships none of its own. */}
      <MobileSprite />

      {/* The estimator picker, mounted here for the same reason the desktop
          shell mounts it: this component is on every handheld surface, so the
          dialog its topbar button opens belongs beside it rather than in any
          one page. Its stylesheet carries its own tokens and keyframes, so it
          does not need the blueprint shell to be present. */}
      <EstimatorPicker />
      {/* Where the estimate on screen will be filed, when the picker was opened from a project or a client (2026-09-18). */}
      <FilingChip />

      {/* The support composer, mounted for the same reason and in the same slot
          as the picker: it is on every handheld surface, so it belongs beside
          the nav rather than in any one page. Its LAUNCHER is the topbar
          button below — nothing floats at this width.
          `accountName` is empty on the standalone /mobile-*-v2 review URLs,
          which have no session and no NavRoleProvider. */}
      <SupportWidget signedIn={signedIn} />

      <header className={styles.tbar} onClick={press} data-mnav="">
        <button
          className={styles.tbarBtn}
          type="button"
          aria-label="Open navigation"
          data-tour="nav-menu"
          ref={menuBtnRef}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon id="i-menu" />
        </button>
        {/* The real product mark, not a drawn glyph. Only ~42.5% of the asset is
            ink; the rest is transparent margin, so an oversized <img> is cropped
            by its box to keep that margin out of the layout.
            brightness(0) invert(1) makes the black asset paper-white for the ink
            plate without a second colourway. */}
        <span className={styles.tbarMarkBox}>
          <Image
            className={styles.tbarMarkImg}
            src="/jobflex-mark.png"
            alt=""
            width={108}
            height={108}
            priority
          />
        </span>
        <span className={styles.tbarTxt}>
          <span className={styles.tbarName}>JOBFLEX</span>
          <span className={styles.tbarSub}>Contractor OS</span>
        </span>
        <div className={styles.tbarRight}>
          {/* New Estimate — the handheld twin of the desktop topbar's button,
              and the only way onto the estimator picker from a phone. An icon
              rather than a labelled button: the mobile topbar has no room for
              a word next to the mark, and every other control up here is an
              icon already. */}
          {canEstimate && (
            <button
              className={styles.tbarBtn}
              type="button"
              aria-label="New estimate"
              onClick={() => document.dispatchEvent(new CustomEvent("jf:estimator-picker"))}
            >
              <Icon id="i-plus" />
            </button>
          )}
          {/* Help — the launcher for the support composer the widget below
              mounts, and the only one the app has at any width now. It is HERE
              rather than floating in the corner because a globally mounted
              button there loses that corner to the page: on handheld it
              covered the Smart Proposal wizard's only "Next" and the manual
              builder's totals chevron, and on the desk, once lowered out of
              their way, it ended up buried under FloatingCostsCard on the
              proposal editor. The desktop shells carry the same button in
              their own top bars, so the control is one object everywhere.

              It stands in the slot the SEARCH button held. That button was
              INERT — no onClick, no href, and no listener for it anywhere in
              the tree (`git show HEAD:…/mobile-nav.tsx`): it opened nothing on
              any of the surfaces that mount this nav, most of which carry
              their own working search field in the page body (the `.find` bar
              on jobs, clients, leads, projects, messages, …). It is not
              restored alongside Help because the slot is the last one there
              is: the right group is already New Estimate + Help + bell, and
              the 320px budget in mobile-nav.module.css is burger + mark +
              wordmark + the right group. A fourth control there pushes
              "CONTRACTOR OS" past its ellipsis. A real handheld search needs
              a surface to open first — nothing in this fleet has one. */}
          {/* The handheld bell had NO onClick at all and rendered `.bellDot`
              unconditionally — a dot that advertised unread notifications on
              every page load whether or not any existed. Same component the
              desktop topbar mounts, wearing this shell's chrome classes; the
              dot now appears only when something is genuinely newer than the
              last time this person opened it. */}
          <NotificationBell buttonClassName={styles.tbarBtn} iconClassName={styles.ic} />
        </div>
      </header>

      <div
        className={`${styles.sbOverlay} ${open ? styles.on : ""}`}
        data-mnav=""
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`${styles.sb} ${open ? styles.open : ""}`}
        data-mnav=""
        aria-label="Main navigation"
        aria-hidden={!open}
        onClick={press}
      >
        <div className={styles.sbHead}>
          <span className={styles.sbMarkBox}>
            <Image className={styles.sbMarkImg} src="/jobflex-mark.png" alt="" width={108} height={108} />
          </span>
          <div className={styles.sbHeadTxt}>
            <div className={styles.sbHeadName}>JOBFLEX</div>
            <div className={styles.sbHeadSub}>Contractor OS</div>
          </div>
          <button
            className={styles.sbClose}
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <Icon id="i-x" />
          </button>
        </div>

        {/* The first-estimate tour, paused or under way (components/v3/onboarding-tour) — at the head of
            the drawer, where the trial ribbon's dock never covers it. */}
        <TourChip onPick={() => setOpen(false)} />
        {/* SmartHelp (components/v3/smarthelp): the drawer closes, then the sheet comes up. */}
        <SmartHelpRow variant="drawer" onBeforeOpen={() => setOpen(false)} opener={() => menuBtnRef.current} />
        <nav className={styles.sbScroll} ref={navScrollRef}>
          <div className={styles.sbIndicator} ref={indicatorRef} />
          {sections.map((sec) => (
            <div key={sec.label}>
              <div className={styles.sbSecLabel}>{sec.label}</div>
              {sec.items.map((item) =>
                item.children?.length ? (
                  // An estimator with its inventory folded under it — the desk sidebar's tree (owner, 2026-10-17:
                  // "apply the sidebar changes to the mobile too"): the row, a small white square with the arrow
                  // beside it, and the sub-page rows indented on a guide line, in the rows' own ink.
                  <div key={item.label} className={styles.sbTree}>
                    <div className={styles.sbParent}>
                      {row(item)}
                      <button
                        type="button"
                        className={styles.sbFoldBtn}
                        aria-expanded={isTreeOpen(item)}
                        aria-controls={`msb-sub-${item.icon}`}
                        aria-label={`${isTreeOpen(item) ? "Hide" : "Show"} ${item.label} subpages`}
                        onClick={() => setFolds((f) => ({ ...f, [item.href]: !isTreeOpen(item) }))}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                    <div id={`msb-sub-${item.icon}`} className={styles.sbSub} hidden={!isTreeOpen(item)}>
                      {item.children.map((c) => row(c, true))}
                    </div>
                  </div>
                ) : (
                  row(item)
                ),
              )}
            </div>
          ))}
        </nav>


        {/* The account row printed the donor's demo identity — the literal
            strings "I" / "Ivan" / "Owner" — to every signed-in user, and both
            controls were dead <button>s. It now shows the real session identity
            when the provider supplies one (the desktop sidebar was fixed the
            same way, for the same reason: a wrong name is worse than no name),
            and the settings gear is a real link, dropped for the roles whose
            gate would bounce it. */}
        <div className={styles.sbFoot}>
          {canOpenAccount ? (
            <Link
              className={styles.sbFootAcc}
              href={"/dashboard/settings/account" as Route}
              title="Account"
              onClick={() => setOpen(false)}
            >
              <span className={styles.sbFootAv}>{monogram(accountName || "Account")}</span>
              <span className={styles.sbFootTxt}>
                <span className={styles.sbFootName}>{accountName || "Account"}</span>
                <span className={styles.sbFootRole}>{roleTitle(role)}</span>
                {limitsExempt ? <span className={`${styles.sbFootRole} ${styles.sbFootUnlim}`}>Unlimited · platform admin</span> : null}
              </span>
            </Link>
          ) : (
            <div className={styles.sbFootAcc} title={accountName || "Account"}>
              <span className={styles.sbFootAv}>{monogram(accountName || "Account")}</span>
              <span className={styles.sbFootTxt}>
                <span className={styles.sbFootName}>{accountName || "Account"}</span>
                <span className={styles.sbFootRole}>{roleTitle(role)}</span>
                {limitsExempt ? <span className={`${styles.sbFootRole} ${styles.sbFootUnlim}`}>Unlimited · platform admin</span> : null}
              </span>
            </div>
          )}
          {canOpenSettings && (
            <Link
              className={styles.sbFootIc}
              href={"/dashboard/settings" as Route}
              aria-label="Settings"
              onClick={() => setOpen(false)}
            >
              <Icon id="i-gear" />
            </Link>
          )}
          {/* Sign out — gated roles only, matching the desktop sidebar. The
              drawer IS the handheld sidebar, so the same rule applies rather
              than a second answer on phones. */}
          {isLimitedRole(role) && (
            <SignOutButton
              className={`${styles.sbFootIc} ${styles.sbFootOut}`}
              iconClassName={styles.ic}
              onDone={() => setOpen(false)}
            />
          )}
        </div>
      </aside>
    </>
  );
}
