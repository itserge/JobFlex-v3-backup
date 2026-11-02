"use client";

// Blueprint workers — page CONTENT only. The donor's `.content` children,
// verbatim; the sidebar, topbar and sprite come from the shared shell
// (components/v3/blueprint-shell), which persists across navigation. Dynamic
// regions (#wkCrumbs, #wkTiles, #wkCount, #wkList, #wkEmpty, #wkInsp and the
// invite dialog body) are left empty exactly like the donor and filled by the
// ported script on mount — same architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// The two dialogs are the only structural move: in the donor they sit beside
// `.main`, outside `.content`. They are `position: fixed` overlays, so putting
// them at the end of the fragment changes no layout, and the behavior module
// excludes `.mdl` from the reveal cascade so the donor's block set and its
// i*60ms stagger indices stay exactly as authored.

import { useCallback, useRef } from "react";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initWorkersContent } from "./workers-behavior";
import type { WorkerEntry } from "./workers-data";

/**
 * @param entries the org's real roster, read in the page's server component.
 *   The behavior module takes it as its starting state and then keeps itself in
 *   step with the database through the worker server actions.
 */
export function WorkersContent({ entries }: { entries: WorkerEntry[] }) {
  // The seed reaches `init` through a ref, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a
  // re-run tears the page down and replays the whole reveal cascade — so the
  // init has to stay referentially stable for the life of the mount.
  //
  // The ref is never written after creation, and it does not need to be: it is
  // seeded on the first render, the layout effect that reads it runs against
  // that same commit, and from then on the behavior module owns the roster and
  // keeps itself in step with the database through the server actions. A
  // navigation away unmounts the component, so the next visit gets a fresh ref
  // holding freshly-queried rows.
  const seedRef = useRef(entries);

  const init = useCallback(
    (content: HTMLElement) => initWorkersContent(content, { entries: seedRef.current }),
    [],
  );
  useBlueprintContent(init);

  return (
    <>
      {/* HEADER BAND: Crew / Roster / N on the books / M active */}
      <div className="wk-head">
        <div>
          {/* The kicker is the one word "Crew". It used to be a live
              breadcrumb — Crew / Roster / N on the books / N active — repainted
              on every write; the counts it carried are the stat tiles directly
              below it, so the kicker was reading them out twice. Static markup
              now, which also means it no longer paints in after mount. */}
          <div className="kicker wk-crumbs" id="wkCrumbs"><span>Crew</span></div>
          <h1 className="page-title">Workers</h1>
        </div>
        <div className="wk-head-r">
          <label className="lsearch">
            <svg className="ic">
              <use href="#i-search" />
            </svg>
            <input type="search" id="wkSearch" placeholder="Search name or email…" autoComplete="off" />
          </label>
          <button className="btn btn-primary" type="button" id="inviteBtn" data-tour="team:invite">
            <svg className="ic">
              <use href="#i-plus" />
            </svg>
            Invite worker
          </button>
        </div>
      </div>

      {/* STAT FILTER TILES */}
      <div className="card wk-tiles" id="wkTiles"></div>

      {/* WORKSPACE: roster + inspector */}
      <div className="wk-space" id="wkSpace">
        <div className="card wk-card">
          <div className="wk-card-head">
            <span className="kpi-lbl">Roster</span>
            <span id="wkCount"></span>
          </div>
          <ul className="wk-list" id="wkList"></ul>
          <div className="wk-empty is-hidden" id="wkEmpty"></div>
        </div>

        <aside className="wk-insp is-hidden" id="wkInsp"></aside>
      </div>
      <div className="pmenu" id="pMenu"></div>

      {/* DIALOGS — donor position:fixed overlays (siblings of .main there). */}
      {/* Both dialogs get an explicit × . The scrim and the Cancel button were
          the only ways out, and neither is where the eye looks for a dismiss —
          the create dialogs on Jobs / Clients / Projects have carried a corner
          × since they were built, so this is the house pattern, not a new one. */}
      <div className="mdl" id="inviteMdl">
        <div className="mdl-bg" data-mdl="invite"></div>
        <div className="mdl-box mdl-box--wide">
          <div className="mdl-head mdl-head--row">
            <span id="inviteTitle">Invite worker</span>
            <button className="mdl-x" type="button" data-mdl="invite" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-body" id="inviteBody"></div>
        </div>
      </div>

      <div className="mdl" id="removeMdl">
        <div className="mdl-bg" data-mdl="remove"></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span id="removeTitle">Remove worker?</span>
            <button className="mdl-x" type="button" data-mdl="remove" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-txt">They lose access to their portal immediately. Job history stays on the jobs.</div>
          {/* removeWorker refuses on the last owner — the reason lands here
              rather than the dialog closing on a write that never happened. */}
          <div className="mf-err mf-err--boxed is-hidden" id="removeErr" role="alert"></div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl="remove">Cancel</button>
            <button className="btn btn-primary btn--sm" type="button" id="removeOk">
              <svg className="ic">
                <use href="#i-trash" />
              </svg>
              <span data-save-lbl>Remove worker</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
