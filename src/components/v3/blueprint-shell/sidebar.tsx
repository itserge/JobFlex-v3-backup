"use client";

// Blueprint shell — sidebar. Markup is the donor's, verbatim; the only
// adaptations are functional: dead `href="#"` anchors became real routes via
// next/link, and the `active` item is derived from the current pathname
// instead of being hardcoded per page. The rendered DOM is still
// `<a class="sb-link">`, so the donor's styling and the sliding indicator
// plate behave exactly as authored.
//
// This lives in the shared layout, so it mounts ONCE and survives navigation
// between blueprint pages — no teardown, no re-running the entry cascade.

import { Fragment, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

// The nav map and the active-item resolver moved to ./nav-map.ts on 2026-07-29
// so the mobile hamburger drawers could share them instead of carrying a
// second, href-less copy. Re-exported here for existing importers.
import { NAV_SECTIONS, activeHref, canOpen, isLimitedRole, navSectionsFor, type NavItem } from "./nav-map";
import { quotaPill, useNavBadges, useNavLimits, useNavLimitsExempt, type NavLimit, useNavHidden, useNavLocked, useNavRole, useNavView } from "./nav-role";
import { DoorSwitch } from "./door-switch";
import { SignOutButton } from "./sign-out";
import { foldShortcutLabel } from "./sidebar-fold";
import { TourChip } from "@/components/v3/onboarding-tour/tour-chip";
import { SmartHelpRow } from "@/components/v3/smarthelp/smarthelp-row";

export { NAV_SECTIONS };

export type SidebarUser = {
  /** Display name for the account block. */
  name: string;
  /** Org role, already humanised ("Owner", "Installer"). */
  role: string;
};

/** Initials for the avatar plate — the same rule the rest of the app uses. */
function monogram(name: string): string {
  const p = name.replace(/[^A-Za-z. ]/g, "").split(" ").filter(Boolean);
  if (!p.length) return "?";
  return p.length === 1
    ? p[0].slice(0, 2).toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/** The hover copy for a quota pill: what the number counts and when it resets. */
function quotaTip(q: NavLimit): string {
  const cycle = q.scope === "absolute" ? "" : " this cycle";
  if (q.remaining <= 0) {
    return `You've used all ${q.limit} ${q.label} in your plan${cycle}. Upgrade to add more.`;
  }
  return `${q.remaining} of ${q.limit} ${q.label} left${cycle}.`;
}

export function Sidebar({
  user,
  folded = false,
  onToggleFold,
}: {
  user?: SidebarUser;
  /** Drawn as the icon rail (desktop only; the drawer ignores it). */
  folded?: boolean;
  /** Flips the fold; without it no arrow is drawn on the sidebar's edge. */
  onToggleFold?: () => void;
}) {
  const pathname = usePathname() ?? "";
  // HOVER LABELS for the folded rail. One plate, positioned against the
  // sidebar itself (not the viewport): the shell root carries a CSS zoom, and
  // offsets measured inside it stay in its own coordinates where viewport
  // rectangles do not. `.sb-scroll` clips sideways, so the plate lives outside
  // it, in `.sb`.
  const sbRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const showTip = useCallback(
    (el: HTMLElement, text: string, always = false) => {
      if (!folded && !always) return;
      const sb = sbRef.current;
      if (!sb) return;
      let top = el.offsetHeight / 2;
      let node: HTMLElement | null = el;
      while (node && node !== sb) {
        top += node.offsetTop - (node.parentElement && node.parentElement !== sb ? node.parentElement.scrollTop : 0);
        node = node.offsetParent as HTMLElement | null;
      }
      setTip({ text, top });
    },
    [folded],
  );
  const hideTip = useCallback(() => setTip(null), []);
  const tipProps = (text: string, always = false) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(e.currentTarget, text, always),
    onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(e.currentTarget, text, always),
    onMouseLeave: hideTip,
    onBlur: hideTip,
  });
  // THE CLICKED ROW IS ACTIVE AT ONCE (2026-10-11). The estimator trees open
  // and close with `active`; read off the pathname alone they moved only when
  // the next page committed, after the plate had already been aimed at the old
  // layout — so it slid to a stale spot and was corrected a frame (in Safari a
  // long frame) later: an overshoot and a bounce, and the list jumped when a
  // tree closed above a scrolled-down row. The click sets `pending`
  // synchronously; it counts only while the pathname is still the one the
  // click left from, so the route that lands takes over by itself.
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const active = activeHref(pending && pending.from === pathname ? pending.href : pathname);
  const onRowClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // Committed inside the click, so the shell measures the plate's target
    // (shell-behavior, after React's handler) against the new layout.
    flushSync(() => setPending({ href, from: pathname }));
  };
  // The shell renders on routes that read the session server-side and pass it
  // down. The fallback is deliberately generic rather than the donor's "Ivan":
  // a wrong name is worse than no name.
  const name = user?.name || "Account";
  const role = user?.role || "";
  // The RAW role, for the rules. `user.role` above is the humanised copy the
  // account block prints, so it can't be matched against "INSTALLER".
  const navRole = useNavRole();
  // Custom-plan page locks ride the same provider; empty on every other plan.
  const navLocked = useNavLocked();
  const navHidden = useNavHidden();
  // The edition's view (lib/editions): the Deck Studio workspace keeps only its rows.
  const navView = useNavView();
  const sections = navSectionsFor(navRole, navLocked, navHidden, navView);
  // Unread / pending counts by href, from the layout via the nav provider.
  // Empty outside it, so nothing is drawn — a stale zero beats a wrong number.
  const badges = useNavBadges();
  // Remaining plan quota by href — drawn as an OUTLINE pill beside the unread
  // badge (owner, 2026-09-02): same size and type, no fill, red at zero, and
  // a hover note that says what the number counts.
  const limits = useNavLimits();
  // A platform admin in their own organization: no pills, one line that says so.
  const limitsExempt = useNavLimitsExempt();
  // The footer's two links leave the nav's own surfaces, so they get the same
  // test everything else does. A limited role that cannot open /dashboard/
  // settings would otherwise be handed a gear that bounces it back to Jobs.
  const canOpenSettings = canOpen(navRole, "/dashboard/settings", navLocked);
  const canOpenAccount = canOpen(navRole, "/dashboard/settings/account", navLocked);
  // Which trees are folded. Unset means "open when its page is the one shown".
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const isOpen = (item: NavItem) => folds[item.href] ?? (active === item.href || !!item.children?.some((c) => c.href === active));
  // One row grammar for every item (owner, 2026-09-21): icon · label · a
  // badge slot · a chevron slot. Both slots are reserved whether or not they
  // hold anything, so the badges of different rows stand in one column and
  // the chevrons in theirs; a child row (an inventory) is indented instead and
  // has no chevron slot of its own.
  const renderRow = (item: NavItem, child = false) => {
    const quota = limits[item.href] ? quotaPill(limits[item.href]) : null;
    // THE PLATE STAYS ON THE ESTIMATOR (owner, 2026-10-10: the inventory row
    // "looks the same as the main estimator button"). A parent row is `active`
    // for its own page and for its sub-pages; a sub-page row never takes the
    // plate — it marks itself (`sb-sub-on`, blueprint-global.css) as the page
    // open inside the estimator.
    const here = !child && (item.href === active || !!item.children?.some((c) => c.href === active));
    const current = child && item.href === active;
    // AN ESTIMATING TOOL (owner, 2026-10-17, undoing 2026-10-16's plain rows):
    // one line — a white icon square on a hard offset shadow in the tool's own
    // colour (globals.css --tool-*), filled with it while the tool is open,
    // then the name, with "Soon" right after it on the same line.
    const tool = child ? undefined : item.tool;
    const soonMark = !!item.soon && !item.locked;
    return item.href === "#" ? (
                <a key={item.label} className="sb-link" href="#" {...tipProps(item.label)}>
                  <svg className="ic">
                    <use href={`#${item.icon}`} />
                  </svg>
                  <span className="sb-lbl">{item.label}</span>
                  <span className="sb-slot sb-slot-b" />
                  {!child && <span className="sb-slot sb-slot-c" />}
                </a>
              ) : (
                <Link
                  key={item.label}
                  className={`sb-link${tool ? " sb-tool" : ""}${here ? " active" : ""}${child ? " sb-sub-link" : ""}${current ? " sb-sub-on" : ""}${item.locked ? " sb-lockd" : ""}${tool && soonMark ? " sb-tool-soon" : ""}`}
                  data-tone={tool?.tone}
                  data-tour={`nav:${item.href}`}
                  aria-current={current ? "page" : undefined}
                  href={item.href as Route}
                  onClick={(e) => onRowClick(e, item.href)}
                  {...tipProps(
                    (badges[item.href] ?? 0) > 0 ? `${item.label} · ${badges[item.href]} new` : item.locked ? `${item.label} · not in your plan` : item.soon ? `${item.label} · coming soon` : quota ? `${item.label} · ${quota.text}` : item.label,
                  )}
                >
                  {tool ? (
                    <span className="sb-tile" aria-hidden="true">
                      <svg className="ic">
                        <use href={`#${item.icon}`} />
                      </svg>
                    </span>
                  ) : (
                    <svg className="ic">
                      <use href={`#${item.icon}`} />
                    </svg>
                  )}
                  {/* The label in its own span so the folded rail can hide it
                      and keep it for screen readers; the row's name is still
                      its text. */}
                  {tool ? (
                    <span className="sb-txt">
                      <span className="sb-lbl">{tool.short ?? item.label}</span>
                      {soonMark && <span className="sb-soon" aria-label="Coming soon">Soon</span>}
                    </span>
                  ) : (
                    <span className="sb-lbl">{item.label}</span>
                  )}
                  <span className="sb-slot sb-slot-b">
                  {/* CUSTOM-PLAN LOCK — the page is not in this org's plan.
                      Still a live link on purpose: the route renders the
                      upgrade offer, so the padlock is a door, not a wall. */}
                  {/* News outranks "Soon" (2026-10-13): a coming-soon tool an admin works in still gets its badge
                      — a client's deck design sent back, say. */}
                  {soonMark && (badges[item.href] ?? 0) > 0 ? (
                    <span className="sb-badge" aria-label={`${badges[item.href]} new`}>
                      {badges[item.href] > 99 ? "99+" : badges[item.href]}
                    </span>
                  ) : soonMark ? (
                    tool ? null : <span className="sb-soon" aria-label="Coming soon">Soon</span>
                  ) : item.locked ? (
                    <svg className="sb-lock-ic" viewBox="0 0 24 24" aria-label="Not in your plan">
                      <rect x="5" y="11" width="14" height="10" rx="1.5" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  ) : (
                    <>
                      {(badges[item.href] ?? 0) > 0 && (
                        <span className="sb-badge" aria-label={`${badges[item.href]} new`}>
                          {badges[item.href] > 99 ? "99+" : badges[item.href]}
                        </span>
                      )}
                      {/* The quota, only when it is low or gone — see quotaPill. */}
                      {quota ? (
                        <span
                          className={`sb-quota${quota.out ? " is-out" : ""}`}
                          tabIndex={0}
                          aria-label={quotaTip(limits[item.href])}
                        >
                          <span className="sb-quota-n">{quota.text}</span>
                          <span className="sb-quota-tip" role="tooltip">
                            {quotaTip(limits[item.href])}
                          </span>
                        </span>
                      ) : null}
                    </>
                  )}
                  </span>
                  {!child && <span className="sb-slot sb-slot-c" aria-hidden="true" />}
                </Link>
              );
  };

  // A row, or an estimator with the rows folded under it.
  const renderItem = (item: NavItem) =>
    item.children?.length ? (
      <div key={item.label} className={`sb-tree${isOpen(item) ? " is-open" : ""}`}>
        <div className="sb-parent">
          {renderRow(item)}
          {/* The fold (owner, 2026-09-20): a chevron in the row's
              chevron slot. Open on its own when the estimator or its
              inventory is the page; the click remembers the choice. */}
          <button
            type="button"
            className="sb-fold-btn"
            aria-expanded={isOpen(item)}
            aria-controls={`sb-sub-${item.icon}`}
            aria-label={`${isOpen(item) ? "Hide" : "Show"} ${item.label} subpages`}
            onClick={() => setFolds((f) => ({ ...f, [item.href]: !isOpen(item) }))}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div id={`sb-sub-${item.icon}`} className="sb-sub" hidden={!isOpen(item)}>{item.children.map((child) => renderRow(child, true))}</div>
      </div>
    ) : (
      renderRow(item)
    );

  return (
    <aside className="sb" ref={sbRef}>
      <div className="sb-head">
        {/* The real product mark, not the drawn `i-logo` sketch J (owner's
            call, 2026-07-30) — desktop now shows the same logo as the handheld
            shell. The asset is mostly transparent margin, so it renders larger
            than its box and the box clips it; see .sb-mark-img in
            dashboard-blueprint/blueprint.module.css. The i-logo symbol stays in
            the sprite: /v3/proposals-v2 and /v3/proposals-v3 still draw it. */}
        <span className="sb-mark-box">
          <Image className="sb-mark-img" src="/jobflex-mark.png" alt="" width={108} height={108} priority />
        </span>
        <div className="sb-head-txt">
          <div className="sb-head-name">JOBFLEX</div>
          <div className="sb-head-sub">Contractor OS</div>
        </div>
      </div>

      <nav className="sb-scroll" onScroll={hideTip}>
        <div className="sb-indicator" id="sbIndicator"></div>
        {/* SmartHelp (components/v3/smarthelp): the first row, above the sections. Its own button, not an
            `.sb-link` — shell-behavior.ts treats those as nav links (indicator, drawer close, hover plate). */}
        <SmartHelpRow variant="blueprint" />
        {/* Section labels and estimator trees share the scroll container.
            The indicator accounts for positioned wrappers inside each tree. */}
        {sections.map((section) => {
          // THE TOOL BAY (owner, 2026-10-12; unframed since 2026-10-16). Tools
          // that follow each other share one bay; a section made only of tools
          // puts its label at the head of the bay instead of above it. A role's
          // mixed section (an estimator's Automation) keeps its label.
          const bayOnly = section.items.length > 0 && section.items.every((i) => !!i.tool);
          const runs: (NavItem | NavItem[])[] = [];
          for (const item of section.items) {
            const last = runs[runs.length - 1];
            if (item.tool && Array.isArray(last)) last.push(item);
            else runs.push(item.tool ? [item] : item);
          }
          return (
            <Fragment key={section.label}>
              {!bayOnly && <div className="sb-sec-label">{section.label}</div>}
              {runs.map((run) =>
                Array.isArray(run) ? (
                  <div key={`bay:${run[0].href}`} className="sb-bay">
                    {bayOnly && <div className="sb-sec-label sb-bay-head">{section.label}</div>}
                    {run.map(renderItem)}
                  </div>
                ) : (
                  renderItem(run)
                ),
              )}
            </Fragment>
          );
        })}
      </nav>

      {/* The first-estimate tour, paused or under way (components/v3/onboarding-tour). */}
      <TourChip />

      {/* The account block was a dead <button> showing the hardcoded literals
          "Ivan" / "Owner" — the donor's demo identity, displayed to every user
          regardless of who was signed in. It is now a real link to the account
          page, and the name, role and monogram come from the session. */}
      <div className="sb-foot">
        {canOpenAccount ? (
          <Link className="sb-foot-acc" href={"/dashboard/settings/account" as Route} {...tipProps(`${name}${role ? ` · ${role}` : ""}`)}>
            <span className="sb-foot-av">{monogram(name)}</span>
            <span className="sb-foot-txt">
              <span className="sb-foot-name">{name}</span>
              <span className="sb-foot-role">{role}</span>
              {limitsExempt ? <span className="sb-foot-role sb-foot-unlim">Unlimited · platform admin</span> : null}
            </span>
          </Link>
        ) : (
          /* Same plate, no link: a field worker's account page is behind their
             route gate, and a control that only ever bounces you is worse than
             a label. The identity itself still belongs here — it is how you
             check WHICH login you are on before confirming a job. */
          <div className="sb-foot-acc" title={name}>
            <span className="sb-foot-av">{monogram(name)}</span>
            <span className="sb-foot-txt">
              <span className="sb-foot-name">{name}</span>
              <span className="sb-foot-role">{role}</span>
              {limitsExempt ? <span className="sb-foot-role sb-foot-unlim">Unlimited · platform admin</span> : null}
            </span>
          </div>
        )}
        {/* The donor's settings page marks this gear active (donor line 1974
            ships it as `class="sb-foot-ic on"`), so it lights up while any
            /dashboard/settings URL is open. The `.sb-foot-ic.on` rule lives in
            settings-blueprint/settings.module.css — it is the one chrome rule
            that page's stylesheet owns, and it only applies while that
            stylesheet is on the shell root. */}
        {canOpenSettings && (
          <Link
            className={`sb-foot-ic${pathname.startsWith("/dashboard/settings") ? " on" : ""}`}
            href={"/dashboard/settings" as Route}
            aria-label="Settings"
            {...tipProps("Settings")}
          >
            <svg className="ic">
              <use href="#i-gear" />
            </svg>
          </Link>
        )}
        {/* Sign out — drawn for the gated roles only (owner's call). The
            blueprint shell carried none, and the app's other one lives in the
            classic Topbar's account menu, behind pages an installer, sales rep
            or estimator cannot open. Office roles reach that menu on the
            classic surfaces, so they do not need a second control here. */}
        {isLimitedRole(navRole) && (
          <SignOutButton className="sb-foot-ic sb-foot-out" iconClassName="ic" />
        )}
        {/* THE DOOR SWITCH (2026-10-11): for an account that holds both workspaces — to the Deck Studio, or back. */}
        {navView.switchable && (
          <DoorSwitch workspace={navView.workspace} className="sb-foot-ic">
            <svg className="ic">
              <use href={navView.workspace === "deck" ? "#i-grid" : "#i-deck"} />
            </svg>
          </DoorSwitch>
        )}
      </div>

      {/* THE FOLD ARROW — on the sidebar's edge, halfway down (owner,
          2026-09-18, asked for again 2026-10-10 after a merge dropped it). It
          points the way the sidebar will move; its label says what it does
          and the shortcut that does the same. Desktop only: the drawer below
          860px hides it. Same arrow as the admin console's. */}
      {onToggleFold && (
        <button
          type="button"
          className="sb-fold"
          aria-label={folded ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!folded}
          onClick={() => {
            hideTip();
            onToggleFold();
          }}
          {...tipProps(`${folded ? "Expand" : "Collapse"} · ${foldShortcutLabel()}`, true)}
        >
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}

      {tip && (
        <div className="sb-tip" role="tooltip" style={{ top: tip.top }}>
          {tip.text}
        </div>
      )}
    </aside>
  );
}
