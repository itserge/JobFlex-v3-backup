"use client";

// Blueprint proposals — page CONTENT only. The donor's `.content` children,
// verbatim; the sidebar, topbar and sprite come from the shared shell
// (components/v3/blueprint-shell), which persists across navigation. Dynamic
// regions (#pMast, the table body, the accepted/completed stacks, the pagers
// and #pMenu) are left empty exactly like the donor and filled by the ported
// script on mount — same architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// Three blocks are NOT the donor's:
//   - the three `mdl pmdl` dialogs, which are how the row menu's Send / Delete
//     land on real server actions and how a refused write reports itself.
//     `.mdl` puts them on the shared open/close motion contract; `.pmdl` is the
//     hook this page's own dialog rules hang off, because proposals.module.css
//     is applied on EVERY blueprint page and ten other modules declare their own
//     `.mdl-box` at the same specificity (see the note in that stylesheet);
//   - `#pMatHost`, an empty node the behavior module hands to React so the
//     already-built MaterialsSheet can mount over this page.
// The dialogs and the island host are excluded from the reveal cascade in the
// behavior module, so the donor's block set — and therefore its i*60ms stagger
// indices — is unchanged.

import Link from "next/link";
import { useCallback, useRef } from "react";
import "@/components/v3/blueprint-shell/filter-bar.css";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initProposalsContent } from "./proposals-behavior";
import type { ProposalRow } from "./proposals-data";

/**
 * @param rows the org's real proposal book, read in the page's server
 *   component. The behavior module takes it as its starting state and then
 *   keeps itself in step with the database through the proposal server actions.
 */
export function ProposalsContent({ rows }: { rows: ProposalRow[] }) {
  // The seed reaches `init` through a ref, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a
  // re-run tears the page down and replays the whole reveal cascade — so the
  // init has to stay referentially stable for the life of the mount. The ref is
  // never written after creation: the behavior module owns the book from the
  // first commit onwards, and a navigation away unmounts this component, so the
  // next visit gets a fresh ref holding freshly-queried rows.
  const seedRef = useRef(rows);

  const init = useCallback(
    (content: HTMLElement) => initProposalsContent(content, { rows: seedRef.current }),
    [],
  );
  useBlueprintContent(init);

  return (
    <>
      {/* PAGE HEAD */}
      <div className="page-head">
        <div>
          <div className="kicker">Sales · Documents</div>
          <h1 className="page-title">Proposals</h1>
        </div>
        <div className="page-actions">
          {/* No per-page search field here (owner's call, 2026-07-30): the
              topbar's search is the one search on the page, and a second box a
              few pixels below it asks the user which one they meant. The tabs
              and status chips are this page's filtering. */}
          {/* One creation route here (owner, 2026-10-20: Smart Proposal left
              the list; it is still in the sidebar). The manual builder is the
              blueprint one (2026-08-15): it reads real clients, writes through
              saveProposal / sendProposal and is the destination the estimator
              picker's "Manual" card already points at. `Link` keeps it a soft
              navigation. */}
          <Link className="btn btn-ghost" href="/dashboard/manual-blueprint">
            <svg className="ic">
              <use href="#i-file" />
            </svg>
            Manual proposal
          </Link>
        </div>
      </div>

      {/* KPI STRIP */}
      <div className="pmast" id="pMast"></div>

      {/* TABS + TYPE (owner, 2026-10-20): Type — the families of work the
          book holds, each with its estimating tool's square and a count —
          narrows every tab, chip and figure, so it sits on the tabs' row at
          the right edge on all three. Painted by proposals-behavior
          renderKinds and hidden while the book holds one family. */}
      <div className="ptabs-row">
        <div className="ptabs" id="pTabs">
          <button className="ptab active" type="button" data-tab="all">
            All<span className="ptab-count" data-count="all">0</span>
          </button>
          <button className="ptab" type="button" data-tab="accepted">
            Accepted<span className="ptab-count" data-count="accepted">0</span>
          </button>
          <button className="ptab" type="button" data-tab="completed">
            Completed<span className="ptab-count" data-count="completed">0</span>
          </button>
        </div>
        <div className="flt-drop flt-drop--bp flt-drop--end" id="pKinds" hidden>
          <button className="flt-drop-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="pKindsMenu">
            <span className="flt-key">Type</span>
            <span className="flt-face"></span>
            <svg className="ic">
              <use href="#i-chev" />
            </svg>
          </button>
          <div className="flt-menu" id="pKindsMenu" role="listbox" aria-label="Type of work"></div>
        </div>
      </div>

      {/* STATUS (owner, 2026-10-18, blueprint-shell/filter-bar.css; drawn
          in the Blueprint plate 2026-10-20): the All tab's list as a
          segmented control, shown on All only. */}
      <div className="flt-bar flt-bar--bp" id="pFilters">
        <div className="flt-seg" id="pChips" role="group" aria-label="Status">
          {(
            [
              ["ALL", "All"],
              ["DRAFT", "Draft"],
              ["SENT", "Sent"],
              ["VIEWED", "Viewed"],
              ["DECLINED", "Declined"],
              ["EXPIRED", "Expired"],
            ] as const
          ).map(([f, label]) => (
            <button key={f} className={`flt-seg-btn${f === "ALL" ? " active" : ""}`} type="button" data-f={f}>
              {label} <span className="flt-n" data-cf={f}>0</span>
            </button>
          ))}
        </div>
      </div>

      {/* TAB: ALL */}
      <section className="ppanel" data-panel="all">
        <div className="card card--table" id="allCard" data-card="c">
          <table className="ptable">
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Status</th>
                <th className="c">Total</th>
                <th className="c">Views</th>
                <th>Updated</th>
                <th className="th-owner">Owner</th>
              </tr>
            </thead>
            <tbody id="propTableBody"></tbody>
          </table>
        </div>
        <div className="pempty is-hidden" id="allEmpty">
          No proposals match this filter
        </div>
        <div className="pager" id="allPager"></div>
      </section>

      {/* TAB: ACCEPTED */}
      <section className="ppanel is-hidden" data-panel="accepted">
        <div className="pstack" id="propStack"></div>
        <div className="pempty is-hidden" id="accEmpty">
          No accepted contracts yet — send a proposal to get one signed
        </div>
        <div className="pager" id="accPager"></div>
      </section>

      {/* TAB: COMPLETED */}
      <section className="ppanel is-hidden" data-panel="completed">
        <div className="psheets" id="doneStack"></div>
        <div className="pempty is-hidden" id="doneEmpty">
          Nothing filed yet — completed jobs land here
        </div>
        <div className="pager" id="donePager"></div>
      </section>

      <div className="pmenu" id="pMenu"></div>

      {/* React island host — MaterialsSheet mounts here. The behavior module
          never writes to this node again once React owns it. */}
      <div id="pMatHost" data-island="materials"></div>
      {/* React island host — ChangeOrderSheet mounts here on "Change order". */}
      <div id="pCoHost" data-island="change-order"></div>

      {/* DIALOGS — position:fixed overlays, so their place at the end of the
          fragment changes no layout. */}
      <div className="mdl pmdl" id="sendMdl">
        <div className="mdl-bg" data-mdl="send"></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span id="sendTitle">Send to client</span>
            <button className="mdl-x" type="button" data-mdl="send" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-body">
            {/* A proposal with no client yet (owner, 2026-10-13): the send names
                one — shown by the behavior module only for those. */}
            <div className="mf is-hidden" id="sendNameRow">
              <label className="mf-lbl" htmlFor="sendName">Client name</label>
              <input className="mf-in" id="sendName" type="text" autoComplete="off" placeholder="Jane Cooper" />
            </div>
            <div className="mf">
              <label className="mf-lbl" htmlFor="sendEmail">Client email</label>
              <input className="mf-in" id="sendEmail" type="email" autoComplete="off" placeholder="client@example.com" />
            </div>
            {/* What the send actually does, in the drawing-annotation voice. */}
            <div className="mf-note" id="sendNote"></div>
            <div className="mf-err is-hidden" id="sendErr" role="alert"></div>
          </div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl="send">Cancel</button>
            <button className="btn btn-primary btn--sm" type="button" id="sendOk">
              <svg className="ic">
                <use href="#i-send" />
              </svg>
              <span data-save-lbl>Send proposal</span>
            </button>
          </div>
        </div>
      </div>

      {/* Send invoice — which rail the client pays on. Filled by the behavior module. */}
      <div className="mdl pmdl" id="invMdl">
        <div className="mdl-bg" data-mdl="inv"></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span id="invTitle">Send invoice</span>
            <button className="mdl-x" type="button" data-mdl="inv" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-body">
            <div className="mf-note" id="invNote"></div>
            <div className="inv-opts">
              <button className="inv-opt" type="button" id="invCard">
                <span className="inv-t">Card — pay online</span>
                <span className="inv-sub">Hosted checkout</span>
              </button>
              <button className="inv-opt" type="button" id="invBank">
                <span className="inv-t">Bank transfer</span>
                <span className="inv-sub">Your transfer details go in the email</span>
              </button>
              <button className="inv-opt" type="button" id="invAny">
                <span className="inv-t">Client&apos;s choice</span>
                <span className="inv-sub">Every way you accept, on the portal</span>
              </button>
            </div>
            <div className="mf-err is-hidden" id="invErr" role="alert"></div>
          </div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl="inv">Cancel</button>
          </div>
        </div>
      </div>

      <div className="mdl pmdl" id="delMdl">
        <div className="mdl-bg" data-mdl="del"></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span>Delete proposal?</span>
            <button className="mdl-x" type="button" data-mdl="del" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-txt" id="delTxt"></div>
          {/* The action refuses on a proposal the caller doesn't own — the
              reason lands here rather than the dialog closing on a write that
              never happened. */}
          <div className="mf-err mf-err--boxed is-hidden" id="delErr" role="alert"></div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl="del">Cancel</button>
            <button className="btn btn-primary btn--sm" type="button" id="delOk">
              <svg className="ic">
                <use href="#i-trash" />
              </svg>
              <span data-save-lbl>Delete forever</span>
            </button>
          </div>
        </div>
      </div>

      {/* Where a refused write with no dialog of its own reports itself (a
          duplicate over the plan limit, a status change on someone else's
          proposal). Silence would read as "the click did nothing". */}
      <div className="mdl pmdl" id="alertMdl">
        <div className="mdl-bg" data-mdl="alert"></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span id="alertTitle">Couldn&apos;t do that</span>
            <button className="mdl-x" type="button" data-mdl="alert" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-txt" id="alertTxt"></div>
          <div className="mdl-foot">
            <button className="btn btn-primary btn--sm" type="button" data-mdl="alert">Close</button>
          </div>
        </div>
      </div>
    </>
  );
}
