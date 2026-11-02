"use client";

import Link from "next/link";

// Blueprint leads — page CONTENT only. The donor's `.content` children,
// verbatim; the sidebar, topbar and sprite come from the shared shell
// (components/v3/blueprint-shell), which persists across navigation. Dynamic
// regions (the filter chip rows, the table body, the board, the incoming grid
// and the staged list) are left empty exactly like the donor and filled by the
// ported script on mount — same architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// One donor node moves: the delete-confirm dialog (`.mdl`) sits beside `.main`
// in the donor file, but this page may only render inside `.content`, so it is
// the last child here. It is `position: fixed`, so nothing about its painted
// geometry changes; leads-behavior.ts skips it in the reveal cascade and
// leads.module.css carries the matching stacking-context rule.

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initLeadsContent, type LeadsHandle } from "./leads-behavior";
import { STAGES, isMetaImportedLead, type Lead, type Offer } from "./leads-data";
import { PICKABLE_SOURCES } from "@/lib/leads/sources";
import "@/components/v3/blueprint-shell/filter-bar.css";

/**
 * @param leads the org's real pipeline, read in the page's server component.
 * @param offers live Lead Center offers (status OFFERED, window still open).
 *
 * The behavior module takes both as its starting state and then keeps itself in
 * step with the database through the lead server actions.
 */
export function LeadsContent({ leads: allLeads, offers: allOffers }: { leads: Lead[]; offers: Offer[] }) {
  const metaOnly = useSearchParams().get("imported") === "meta";
  const leads = useMemo(() => metaOnly ? allLeads.filter(isMetaImportedLead) : allLeads, [allLeads, metaOnly]);
  const offers = useMemo(() => metaOnly ? [] : allOffers, [allOffers, metaOnly]);
  // The seed reaches `init` through refs, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a re-run
  // tears the page down and replays the whole reveal cascade — so the init has
  // to stay referentially stable for the life of the mount.
  const seedRef = useRef({ leads, offers });
  const handleRef = useRef<LeadsHandle | null>(null);
  const routerRef = useRef(useRouter());
  // The identity of the last props the behavior module has already seen. It
  // starts at the seed, so the first run of the sync effect below is a no-op.
  const appliedRef = useRef({ leads, offers });

  const init = useCallback((content: HTMLElement) => {
    const dispose = initLeadsContent(content, {
      leads: seedRef.current.leads,
      offers: seedRef.current.offers,
      refresh: () => routerRef.current.refresh(),
      navigate: (href) => routerRef.current.push(href as Route),
      onReady: (handle) => {
        handleRef.current = handle;
      },
    });
    return () => {
      handleRef.current = null;
      dispose();
    };
  }, []);
  useBlueprintContent(init);

  // Every lead action calls `revalidatePath("/dashboard/leads")`, so the server
  // component re-renders with fresh rows after each write. Hand them to the
  // behavior module, which compares them against its own state and repaints
  // ONLY when they actually differ — an optimistic update that the server then
  // confirms leaves the DOM untouched.
  useEffect(() => {
    if (appliedRef.current.leads === leads && appliedRef.current.offers === offers) return;
    appliedRef.current = { leads, offers };
    handleRef.current?.sync(leads, offers);
  }, [leads, offers]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">{metaOnly ? "Meta imports" : "Pipeline"}</div>
          <h1 className="page-title">Leads</h1>
        </div>
        {metaOnly && <Link className="btn btn-ghost btn-sm" href="/dashboard/leads">Show all leads</Link>}
      </div>

      {/* TABS: All / Incoming — with Import as the row's right-hand action.
          Import is a verb, not a view, so it reads as a button rather than a
          third tab; it still switches to the import panel. */}
      <div className="ptabs" id="lTabs">
        <button className="ptab active" type="button" data-tab="all">
          My leads<span className="ptab-count" data-count="all">0</span>
        </button>
        <button className="ptab" type="button" data-tab="incoming">
          Incoming<span className="ptab-count" data-count="incoming">0</span>
          {/* Filled by the behavior module: anything in this queue arrived from
              the Lead Center, which is the one thing a bare count cannot say. */}
          <span className="ptab-new is-hidden">New lead came in</span>
        </button>
        <button className="ptab ptab--action" type="button" data-tab="import" id="goImport" data-tour="leads:import">
          <svg className="ic"><use href="#i-file" /></svg>
          Import leads
        </button>
      </div>

      {/* TAB: ALL */}
      <section className="ppanel" data-panel="all">
        {/* WHERE THE LEADS CAME FROM (owner, 2026-10-16): the ones JobFlex sent
            apart from the shop's own, and the shop's own by source. One filter
            bar (blueprint-shell/filter-bar.css, owner 2026-10-18): the three
            sides as a segmented control, then Source as a dropdown. Counts,
            the source menu and the JobFlex note are painted by the behavior
            module (renderOrigin). */}
        <div className="flt-bar lorigin" id="lOrigin">
          <div className="flt-seg" role="group" aria-label="Where the leads came from">
            <button className="flt-seg-btn active" type="button" data-side="" aria-pressed="true">
              All <span className="flt-n" data-side-n="all">0</span>
            </button>
            <button className="flt-seg-btn" type="button" data-side="jobflex" aria-pressed="false">
              From JobFlex <span className="flt-n" data-side-n="jobflex">0</span>
            </button>
            <button className="flt-seg-btn" type="button" data-side="own" aria-pressed="false">
              Your own leads <span className="flt-n" data-side-n="own">0</span>
            </button>
          </div>
          <div className="flt-drop" id="lSrcDd" hidden>
            <button className="flt-drop-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="lSrcMenu">
              <span className="flt-key">Source:</span>
              <span className="flt-face"></span>
              <svg className="ic">
                <use href="#i-chev" />
              </svg>
            </button>
            <div className="flt-menu" id="lSrcMenu" role="listbox" aria-label="Your own leads by source"></div>
          </div>
        </div>
        <p className="flt-note" id="lSrcs"></p>
        <div className="lbar">
          <label className="lsearch">
            <svg className="ic">
              <use href="#i-search" />
            </svg>
            <input type="text" id="lSearch" placeholder="Search leads…" autoComplete="off" />
          </label>
          <div className="lbar-right">
            {/* The filter popover is a child of the button's wrapper, not a
                sibling of the bar, so it hangs off the control that opened it
                instead of pushing the table down the page. */}
            <div className="fwrap">
              <button
                className="btn btn-ghost btn--sm fbtn"
                type="button"
                id="filterBtn"
                aria-haspopup="dialog"
                aria-expanded="false"
                aria-controls="fPop"
              >
                <svg className="ic"><use href="#i-board" /></svg>Filters
                <span className="fcount is-hidden" id="fCount">0</span>
                <svg className="ic fchev"><use href="#i-chev" /></svg>
              </button>

              {/* Status / Source / Specialty. Status is an option list with a
                  live count per status; source and specialty stay chip rows —
                  short labels that read faster side by side than stacked. */}
              <div className="fpop" id="fPop" role="dialog" aria-label="Filters">
                <div className="fpop-head">
                  <span className="fpop-title">Filters</span>
                  <button className="fpop-clear" type="button" id="fClear">Clear all</button>
                </div>
                <div className="fgrp">
                  <div className="fgrp-lbl">Status</div>
                  <div className="dd fdd" id="fStatusDd">
                    <button className="dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
                      <span className="dd-label">All statuses</span>
                      <span className="dd-n" id="fStatusN">0</span>
                      <svg className="ic"><use href="#i-chev" /></svg>
                    </button>
                    <div className="dd-menu" role="listbox" aria-label="Status" id="fStatus"></div>
                  </div>
                </div>
                <div className="fgrp"><div className="fgrp-lbl">Source</div><div className="fgrp-row" id="fSource"></div></div>
                <div className="fgrp"><div className="fgrp-lbl">Specialty</div><div className="fgrp-row" id="fSpec"></div></div>
              </div>
            </div>
            <div className="vsw" id="vSwitch">
              <button className="vsw-btn active" type="button" data-view="table">Table</button>
              <button className="vsw-btn" type="button" data-view="board">Board</button>
            </div>
          </div>
        </div>

        <div id="tableView">
          <div className="card card--table" id="leadsCard">
            <table className="ptable">
              <thead>
                <tr><th>Lead</th><th>Project</th><th>Status</th><th>Assigned</th><th>Age</th><th className="th-open"></th></tr>
              </thead>
              <tbody id="leadTableBody"></tbody>
            </table>
          </div>
          <div className="pempty is-hidden" id="allEmpty">No leads match these filters</div>
          <div className="pager" id="leadsPager"></div>
        </div>

        {/* Board view — the dashboard's Lead Flow board, verbatim structure.
            The columns are static markup (exactly like dashboard-content.tsx)
            so their drag listeners survive every re-render; leads-behavior.ts
            only fills each `.stage-cards` and its `.stage-count`. Leads runs
            the full seven-stage pipeline, so this board carries two columns
            the dashboard's five-stage summary omits (Won, Lost). */}
        <div id="boardView" className="is-hidden">
          {/* Seven columns at a 206px floor overflow every desktop content
              width, and a trackpad-less mouse has no way to push a horizontally
              scrolling grid. The rail is that control: one column of travel per
              click, disabled at each end, and hidden outright when the board
              already fits (and on handhelds, where the board stacks). Filled by
              leads-behavior.ts — the buttons are static markup so their
              listeners survive every board re-render. */}
          <div className="brail is-hidden" id="lRail">
            <span className="brail-lbl">Pipeline stages</span>
            <span className="brail-of" id="lRailOf"></span>
            <div className="brail-btns">
              <button className="brail-btn" type="button" data-brail="prev" aria-label="Scroll stages left" aria-controls="lBoard" disabled>
                <svg className="ic rot-l"><use href="#i-chev" /></svg>
              </button>
              <button className="brail-btn" type="button" data-brail="next" aria-label="Scroll stages right" aria-controls="lBoard">
                <svg className="ic rot-r"><use href="#i-chev" /></svg>
              </button>
            </div>
          </div>
          <div className="stage-board" id="lBoard">
            {STAGES.map((st) => (
              <div className="stage-col" data-stage={st.key} key={st.key}>
                <div className="stage-col-head">
                  <span className="stage-dot"></span>
                  <span className="stage-lbl">{st.label}</span>
                  <span className="stage-count">0</span>
                </div>
                <div className="stage-cards"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TAB: INCOMING
          Lead Center ONLY — live platform offers and the leads the platform
          routed to this shop. Leads the contractor entered themselves (by hand,
          pasted, imported) go straight to the pipeline; they are not something
          to accept or decline. See isPlatformIncoming in leads-data.ts. */}
      <section className="ppanel is-hidden" data-panel="incoming">
        <div className="inbox-grid" id="inboxGrid"></div>
        <div className="pempty is-hidden" id="inboxEmpty">
          <b>{"You're all caught up"}</b><br />Leads the lead center routes to your shop land here to accept or decline. Leads you add yourself go straight to the pipeline.
        </div>
      </section>

      {/* TAB: IMPORT
          The staging card is a permanent half of this row, not something the
          first staged lead conjures into existence. The panel reads left to
          right — enter a lead, watch it land in the queue, send the batch — so
          the destination has to be on screen before there is anything in it.
          While the queue is empty the card carries a dashed "note on a drawing"
          instead of a blank interior, and Import is disabled rather than a live
          button that does nothing. The pair collapses to one column at the
          page's existing 860px handheld breakpoint. */}
      <section className="ppanel is-hidden" data-panel="import">
        <div className="imeth" id="iMeth">
          <button className="imeth-btn active" type="button" data-m="manual"><svg className="ic"><use href="#i-pen" /></svg>Manual entry</button>
          <button className="imeth-btn" type="button" data-m="email"><svg className="ic"><use href="#i-msg" /></svg>Paste email</button>
          <button className="imeth-btn" type="button" data-m="file"><svg className="ic"><use href="#i-file" /></svg>File</button>
        </div>

        <div className="imp-grid">
          {/* The three method panes share one column; only the active one is
              displayed, so the wrapper — not display:none bookkeeping — is what
              holds the left grid track. */}
          <div className="imp-forms">
            <div className="card imp-pane" data-m="manual">
              <label className="fld"><span className="fld-lbl">Name</span><input className="fld-in" id="mName" placeholder="J. Whitfield" /></label>
              <label className="fld"><span className="fld-lbl">Email</span><input className="fld-in" id="mEmail" placeholder="name@mail.com" /></label>
              <label className="fld"><span className="fld-lbl">Phone</span><input className="fld-in" id="mPhone" placeholder="(425) 555-0112" /></label>
              <label className="fld"><span className="fld-lbl">Project type</span><input className="fld-in" id="mProject" placeholder="Metal roof repair" /></label>
              {/* Where it came from — so "Your own leads" can say which source pays. */}
              <label className="fld"><span className="fld-lbl">Where it came from</span>
                <select className="fld-in" id="mSource" defaultValue="">
                  <option value="">Added by hand</option>
                  {PICKABLE_SOURCES.map((src) => (
                    <option key={src.key} value={src.stored}>{src.label}</option>
                  ))}
                </select>
              </label>
              <div className="fld-act"><button className="btn btn-ghost btn--sm" type="button" id="mAdd"><svg className="ic"><use href="#i-plus" /></svg>Add to import list</button></div>
            </div>

            <div className="card imp-pane is-hidden" data-m="email">
              <label className="fld"><span className="fld-lbl">Paste the email</span>
                <textarea className="fld-area" id="pasteBox" placeholder="Paste the full email here — we'll pull out the name, email and phone we can find." />
              </label>
              <p className="fld-note">An email from Angi, Thumbtack, Yelp, Google, Houzz, Nextdoor or Facebook is tagged with that source by itself.</p>
              <div className="fld-act"><button className="btn btn-ghost btn--sm" type="button" id="pasteAdd"><svg className="ic"><use href="#i-plus" /></svg>Add to import list</button></div>
            </div>

            <div className="card imp-pane is-hidden" data-m="file">
              <button className="dropzone" type="button" id="dropZone">
                <svg className="ic">
                  <use href="#i-file" />
                </svg>
                <span id="dropZoneLbl">Drop a CSV here or tap to choose</span>
              </button>
              {/* The real picker behind the drawn dropzone — the donor's button
                  staged three hardcoded demo rows; this reads the file. */}
              <input
                type="file"
                id="dropInput"
                className="is-hidden"
                accept=".csv,.txt,text/csv,text/plain"
              />
              <div className="mf-err is-hidden" id="fileErr" role="alert"></div>
            </div>
          </div>

          <div className="staged" id="stagedWrap">
            <div className="staged-head">
              <span className="staged-title">Ready to import <b id="stagedCount">0</b></span>
              <button className="btn btn-primary btn--sm" type="button" id="importBtn" disabled>
                <svg className="ic"><use href="#i-check" /></svg>
                <span data-save-lbl>Import leads</span>
              </button>
            </div>
            {/* importLeads refuses when the batch would blow the plan's lead
                quota. The reason lands here rather than the queue silently
                staying put. */}
            <div className="mf-err mf-err--boxed is-hidden" id="impErr" role="alert"></div>
            <div className="staged-body">
              <div id="stagedList"></div>
              <div className="staged-empty" id="stagedEmpty">
                <svg className="ic"><use href="#i-userplus" /></svg>
                <b>Nothing staged yet</b>
                <span>Leads you add on the left queue up here. Nothing reaches the pipeline until you import the batch.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mdl" id="mdl">
        <div className="mdl-bg" data-mdl="close"></div>
        <div className="mdl-box">
          <div className="mdl-head">Delete lead?</div>
          <div className="mdl-txt" id="mdlText">{"This can't be undone."}</div>
          {/* deleteLead is manager-gated on the server — a sales rep gets a
              real refusal, and it belongs in the dialog that asked. */}
          <div className="mf-err mf-err--boxed is-hidden" id="mdlErr" role="alert"></div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl="close">Cancel</button>
            <button className="btn btn-primary btn--sm" type="button" id="mdlOk">
              <svg className="ic"><use href="#i-trash" /></svg>
              <span data-save-lbl>Delete</span>
            </button>
          </div>
        </div>
      </div>

      {/* Failures that have no dialog to land in — a stage drag the server
          refused, an accept/decline that lost a race. Fixed, so the message is
          on screen wherever the board was scrolled to when it failed. The
          reveal cascade skips it for the same reason it skips `.mdl`: a
          display:none element never intersects, so it would be stranded at
          opacity 0 the first time it was shown. */}
      <div className="l-toast is-hidden" id="lToast" role="alert" aria-live="assertive">
        <svg className="ic"><use href="#i-ban" /></svg>
        <span id="lToastText"></span>
        <button className="l-toast-x" type="button" data-toast="close" aria-label="Dismiss">
          <svg className="ic"><use href="#i-x" /></svg>
        </button>
      </div>
    </>
  );
}
