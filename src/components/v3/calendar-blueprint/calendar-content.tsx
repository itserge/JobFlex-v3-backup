"use client";

// Blueprint calendar — page CONTENT only. The donor's `.content` children
// (jobflex-calendar-blueprint_5.html), verbatim; the sidebar, topbar, sprite
// and graph-paper field come from the shared shell
// (components/v3/blueprint-shell), which persists across navigation. Dynamic
// regions (#mgHead/#mgGrid, #wgHead/#wgBody, #tgHead/#tgBody, the filter sets,
// #trayList and #sheetBody) are left empty exactly like the donor and filled
// by the ported script on mount — same architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// Two donor nodes are NOT `.content` children in the donor file: `#sheetBg`
// and `#sheet` are siblings of `.main`, both `position: fixed`. The page can
// only render inside `.content`, so they ship here at the end of the fragment
// and the behavior module excludes them from the reveal cascade to keep it
// donor-exact. See the manifest note about their stacking context.
//
// The donor sprite is byte-identical to the shell's 42-symbol sprite, so no
// page-local sprite is needed.

import { useCallback, useRef } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { JobOffers } from "@/components/v3/jobs-blueprint/job-offers";
import { SmartBookRequests } from "@/components/v3/smartbook/smartbook-requests";
import { initCalendarContent } from "./calendar-behavior";
import type { CalendarSeed } from "./calendar-data";
import "./calendar-global.css";

/**
 * @param seed the org's real calendar, read in the page's server component.
 *   Omitted only by the standalone mock route, which has no session to read
 *   from and falls back to the donor fixture.
 */
export function CalendarContent({ seed }: { seed?: CalendarSeed }) {
  // The seed reaches `init` through a ref, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a re-run
  // tears the page down and replays the whole reveal cascade — so the init has
  // to stay referentially stable for the life of the mount. The ref is never
  // written after creation: it is seeded on the first render, the layout effect
  // that reads it runs against that same commit, and from then on the behavior
  // module owns the calendar and keeps itself in step with the database through
  // the server actions.
  const seedRef = useRef(seed);
  // Same contract as the seed, and for the same reason: it reaches `init`
  // through a ref rather than through the dependency array, so the callback's
  // identity never changes and the entrance cascade is never replayed.
  // `useRouter` returns the same object for the life of the mount. The behavior
  // module opens a job record with it — see `navigate` in calendar-behavior.ts
  // for why a client-side push and not a document load.
  const router = useRouter();
  const routerRef = useRef(router);

  // Dispatch chrome is manager-only. Same expression the behaviour module uses
  // (calendar-behavior.ts, `const canManage = seed ? seed.canManage : true`), so
  // the standalone mock route — which has no session and no seed — keeps the
  // donor's full toolbar.
  const canManage = seed ? seed.canManage : true;

  const init = useCallback(
    (content: HTMLElement) =>
      initCalendarContent(content, {
        seed: seedRef.current,
        navigate: (href) => routerRef.current.push(href as Route),
      }),
    [],
  );
  useBlueprintContent(init);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Delivery</div>
          <h1 className="page-title">Calendar</h1>
        </div>
      </div>

      {/* SMARTBOOK REQUESTS (2026-10-31): customers waiting on the company for a time they named — drawn only when
          one waits, for the office and the sales reps (the card loads itself). A Yes that books asks the grid to read
          its visits again (calendar-behavior, `jf:calendar-reload`). Workers see nothing here. */}
      {canManage || seed?.canSmartBook ? (
        <SmartBookRequests onBooked={() => window.dispatchEvent(new Event("jf:calendar-reload"))} />
      ) : null}

      {/* TOOLBAR: navigation · title · views · inbox · create · tray */}
      <div className="cal-bar">
        <div className="cal-bar-l">
          <button className="cal-nav" type="button" id="calPrev" aria-label="Previous">
            <svg className="ic rot-l">
              <use href="#i-chev" />
            </svg>
          </button>
          <button className="cal-nav" type="button" id="calNext" aria-label="Next">
            <svg className="ic rot-r">
              <use href="#i-chev" />
            </svg>
          </button>
          <button className="btn btn-ghost" type="button" id="calToday">
            Today
          </button>
          <div className="cal-title" id="calTitle">—</div>
        </div>
        <div className="cal-bar-r">
          <div className="vsw" id="calViews">
            <button className="vsw-btn active" type="button" data-view="month">Month</button>
            <button className="vsw-btn" type="button" data-view="week">Week</button>
            {/* Team view is a DISPATCH surface: one row per member of the crew,
                each labelled with their role. The seed's events are role-scoped,
                but the roster behind this grid is not — so for a field worker
                (canManage false) it printed a directory of every colleague and
                what they do, on a page whose whole promise is "your jobs only".
                Dropped for them, exactly as the production sidebar drops the
                surfaces a worker has no business in. The behaviour module reads
                the view off the clicked button and null-guards `#teamCard`, so
                absent means unreachable, not broken. */}
            {canManage && (
              <button className="vsw-btn" type="button" data-view="team">Team</button>
            )}
          </div>
          {/* Two audiences, one slot (2026-08-22): the office gets the crew
              confirmation ledger; a limited role gets THEIR side of the same
              conversation — the offers island, so an assignment made while
              they look at the calendar is answerable right here (it polls and
              auto-opens on arrival). The ledger button is manager-only now:
              a limited seed carries no inbox, so it was an empty sheet. */}
          {canManage ? (
            <button className="cal-nav has-badge" type="button" id="inboxBtn" aria-label="Crew inbox">
              <svg className="ic">
                <use href="#i-bell" />
              </svg>
              <span className="cal-badge" id="inboxN">0</span>
            </button>
          ) : (
            <JobOffers />
          )}
          <button className="btn btn-primary" type="button" id="newEventBtn">
            <svg className="ic">
              <use href="#i-plus" />
            </svg>
            New event
          </button>
          <button className="btn btn-ghost has-badge active" type="button" id="trayBtn" aria-label="Expand calendar" aria-expanded="true" aria-controls="tray">
            <svg className="ic">
              <use href="#i-chev" />
            </svg>
            <span className="cal-badge" id="trayN">0</span>
            <span id="trayLabel">Expand calendar</span>
          </button>
        </div>
      </div>

      {/* FILTERS: search · worker dropdown · status dropdown */}
      <div className="cal-filters">
        <label className="lsearch">
          <svg className="ic">
            <use href="#i-search" />
          </svg>
          <input type="text" id="calSearch" placeholder="Search events…" autoComplete="off" />
        </label>
        {/* Same roster, same reason: the Worker dropdown lists every crew
            member's name and role. `renderFilters` guards on the host being
            present, so leaving it out simply skips that filter. */}
        {canManage && <div className="fdd" id="workerFilter"></div>}
        {/* Statuses are four fixed values, so they are direct toggles — a
            dropdown would hide them behind a click for no gain. */}
        <div className="fset" id="statusFilter"></div>
        <button className="cal-clear is-hidden" type="button" id="calClear">
          Clear <span id="clearN">0</span>
        </button>
      </div>

      {/* CALENDAR + TRAY */}
      <div className="cal-wrap" id="calWrap">
        <div className="cal-main">
          <div className="card cal-card" id="monthCard">
            <div className="mg-head" id="mgHead"></div>
            <div className="mg-grid" id="mgGrid"></div>
          </div>

          {/* The head lives INSIDE the scroller and sticks: sharing one
              scroll container is what keeps its 8 columns on the same grid as
              the body's. Outside it, the body's vertical scrollbar narrowed
              only the body and every column drifted left of its header. */}
          {/* `#wgHead` IS the grid, not a block wrapping one. It used to be a
              plain block holding a `.wg-head` grid and (when the week had any)
              a separate `.wg-allday` grid — three elements that each had to
              arrive at the same eight columns on their own, one of which sized
              itself against the scroll container rather than the body. Now the
              day names and the all-day band are rows of ONE grid that is a
              sibling of `.wg-body`, so "the head drifted off the body's
              columns" has no mechanism left. */}
          <div className="card cal-card is-hidden" id="weekCard">
            <div className="wg-scroll" id="wgScroll">
              <div className="wg-head" id="wgHead"></div>
              <div className="wg-body" id="wgBody"></div>
            </div>
          </div>

          <div className="card cal-card is-hidden" id="teamCard">
            <div className="tg-head" id="tgHead"></div>
            <div className="tg-body" id="tgBody"></div>
          </div>
        </div>

        <aside className="tray" id="tray">
          <div className="tray-head">
            <div>
              <div className="kpi-lbl">Unscheduled</div>
              <div className="tray-sub">Drag a job onto a day to schedule it</div>
            </div>
            <span className="tray-count" id="trayCount">0</span>
          </div>
          <div className="tray-list" id="trayList"></div>
          <div className="tray-empty is-hidden" id="trayEmpty">Everything is scheduled</div>
        </aside>
      </div>
      <div className="pmenu" id="pMenu"></div>

      {/* A rejected write has to say so somewhere. Drag-and-drop happens with no
          sheet open, so the sheet's own error line cannot carry it — this strip
          is the only surface a failed reschedule can speak from. It is
          `position: fixed` and empty until something goes wrong. */}
      <div className="cal-toast" id="calToast" role="status" aria-live="polite"></div>

      {/* Donor siblings of `.main` — both position: fixed. */}
      <div className="sheet-bg" id="sheetBg"></div>
      <aside className="sheet" id="sheet">
        <div className="sheet-head">
          <div className="sheet-title" id="sheetTitle">—</div>
          <button className="sheet-x" type="button" data-sheet="close" aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body" id="sheetBody"></div>
      </aside>
    </>
  );
}
