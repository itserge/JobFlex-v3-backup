"use client";

// Blueprint projects — page CONTENT only. The donor's `.content` children,
// verbatim; the sidebar, topbar and sprite come from the shared shell
// (components/v3/blueprint-shell), which persists across navigation. The
// dynamic regions (#pjChips and #pjGrid) are left empty exactly like the donor
// and filled by the ported script on mount — same architecture, same timing.
// The donor's third empty region, `#pMenu`, is dropped: nothing in the port
// ever filled it and no rule ever styled it, so it was a permanently empty
// node sitting in the reveal cascade.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.

import { useCallback, useRef, useState } from "react";
import { BUILD_DEFAULTS, BUILD_QUESTIONS } from "@/lib/projectPhases/shared";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { AutoProjectsSheet } from "@/components/v3/project-links/auto-projects-sheet";
import { initProjectsContent } from "./projects-behavior";
import { SpaceHeader } from "./project-spaces";
import { SPACES, type SpaceId } from "@/lib/projectSpaces";
import type { Project, ProjectClientChoice } from "./projects-data";

/**
 * @param projects the org's real project book, read in the page's server
 *   component. The behavior module takes it as its starting state and then
 *   keeps itself in step with the database through `createProject`.
 */
export function ProjectsContent({
  projects,
  allProjects,
  space,
  clients = [],
  canAddClient = false,
}: {
  projects: Project[];
  /** Every workspace's rows (the road's pins read only this workspace's; kept for the counts to come). */
  allProjects?: Project[];
  /** The workspace (2026-11-09, lib/projectSpaces): its header, its road, its kind for New project. */
  space?: SpaceId;
  clients?: ProjectClientChoice[];
  canAddClient?: boolean;
}) {
  // The rows reach `init` through a ref, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a
  // re-run tears the page down and replays the whole reveal cascade — so the
  // init has to stay referentially stable for the life of the mount. The ref is
  // never written after creation: it is seeded on the first render, the layout
  // effect that reads it runs against that same commit, and from then on the
  // behavior module owns the book. A navigation away unmounts the component, so
  // the next visit gets a fresh ref holding freshly-queried rows.
  const seedRef = useRef(projects);

  const init = useCallback(
    (content: HTMLElement) => initProjectsContent(content, { projects: seedRef.current, kind: space ? SPACES[space].kind : undefined }),
    // The workspace is fixed for the life of the mount (the page keys the content on it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useBlueprintContent(init);
  // The Automatic projects switch (2026-11-05) — a sheet, portalled, so the fragment's children stay as they are.
  const [autoOpen, setAutoOpen] = useState(false);

  return (
    <>
      <AutoProjectsSheet open={autoOpen} onClose={() => setAutoOpen(false)} />
      {/* PAGE HEAD — in a workspace, its own header and road (2026-11-09, ./project-spaces); the buttons are the same. */}
      {space ? (
        <SpaceHeader
          space={space}
          rows={allProjects ?? projects}
          actions={
            <>
              <button className="btn btn-ghost" type="button" onClick={() => setAutoOpen(true)} data-auto-projects>
                Automatic projects
              </button>
              <button className="btn btn-primary" id="newProjectBtn" style={{ background: SPACES[space].color, borderColor: SPACES[space].color }}>
                <svg className="ic">
                  <use href="#i-plus" />
                </svg>
                New {SPACES[space].one}
              </button>
            </>
          }
        />
      ) : (
        <div className="page-head">
          <div>
            <div className="kicker">Remodeling</div>
            <h1 className="page-title">Projects</h1>
          </div>
          <div className="page-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setAutoOpen(true)} data-auto-projects>
              Automatic projects
            </button>
            <button className="btn btn-primary" id="newProjectBtn">
              <svg className="ic">
                <use href="#i-plus" />
              </svg>
              New project
            </button>
          </div>
        </div>
      )}

      {/* MASTHEAD (2026-09-20) — the book's four numbers, painted by the
          behavior: what is being worked, what is sold, spend against budget,
          and how many rows need a look. The proposals page's own kpi tiles. */}
      <div className="kpi-grid pj-mast" id="pjMast">
        <div className="kpi">
          <div className="kpi-lbl">Active projects</div>
          <div className="kpi-val" id="pjKActive">0</div>
          <div className="kpi-sub" id="pjKActiveSub">&nbsp;</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Sold</div>
          <div className="kpi-val accent" id="pjKSold">$0</div>
          <div className="kpi-sub" id="pjKSoldSub">&nbsp;</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Spent of budget</div>
          <div className="kpi-val" id="pjKSpent">$0</div>
          <div className="kpi-sub" id="pjKSpentSub">&nbsp;</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Needs a look</div>
          <div className="kpi-val" id="pjKAttn">0</div>
          <div className="kpi-sub" id="pjKAttnSub">&nbsp;</div>
        </div>
      </div>

      {/* Filter rail: status, plus the rows that need a look */}
      <div className="pchips" id="pjChips"></div>

      {/* THE LEDGER (2026-09-20) — one row per project, the proposals page's
          own table vocabulary (.ptable / .prow / .pt-title), so twenty
          projects read on one screen. Squares of four numbers each did not
          say what a project was, and a wall of them would not have scaled. */}
      <div className="card pj-ledger-card" id="pjLedgerCard">
        <div className="pj-ledger-scroll">
          <table className="ptable pj-ledger" aria-label="Projects">
            <thead>
              <tr>
                {/* Fixed table layout: these header widths size the columns, and
                    the project name takes whatever is left. Window and Updated
                    step out on narrower screens so the rest keeps its room. */}
                <th>Project</th>
                <th className="pjc-status">Status</th>
                <th className="num pjc-sold">Sold</th>
                <th className="pjc-budget">Budget</th>
                <th className="pjc-jobs">Jobs</th>
                <th className="pjc-window">Window</th>
                <th className="pjc-updated">Updated</th>
                <th className="th-open pjc-open"></th>
              </tr>
            </thead>
            <tbody id="pjGrid"></tbody>
          </table>
        </div>
      </div>

      <div className="pempty is-hidden" id="pjEmpty">
        <b>No projects yet</b>
        <br />
        A project holds one client&apos;s proposals, the jobs they become and the budget they are built against. Start one
        with New project, or add a client to one from the Clients page.
      </div>

      {/* CREATE DIALOG — opened by #newProjectBtn, wired in projects-behavior.
          Static markup (not injected) so it is server-rendered like the rest of
          the page and the ported script only toggles `.open`. The submit button
          sits in the beige foot, OUTSIDE the scrolling body, and reaches the
          form through `form="pjNewForm"`. */}
      <div className="mdl" id="pjNew" role="dialog" aria-modal="true" aria-labelledby="pjNewTitle">
        <div className="mdl-bg" data-mdl="close"></div>
        <div className="mdl-box">
          <div className="mdl-head">
            <div>
              <span className="mdl-kick">Delivery / new record</span>
              <div className="mdl-title" id="pjNewTitle">{space ? `New ${SPACES[space].one}` : "New project"}</div>
            </div>
            <button className="mdl-x" type="button" data-mdl="close" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>

          <form className="mdl-body" id="pjNewForm" noValidate>
            {/* Server-action failures land here — the plan-limit refusal and the
                permission refusal both carry text written for the user. */}
            <div className="mdl-err is-hidden" id="pjNewErr" role="alert"></div>

            {/* THE KIND (2026-11-07, the plan "Projects: Remodel and New construction"): a remodel — the house stands —
                or a new build — a lot, then a house. The stages' templates, the question that follows and, as the
                plan ships, the gates and the money read it. Wired in projects-behavior like the status segment. */}
            <div className="fld">
              <span className="fld-lbl">What kind of project</span>
              <div className="fseg" id="pjfKind" role="group" aria-label="Project kind">
                <button className="fseg-btn on" type="button" data-v="REMODEL" aria-pressed="true">
                  <svg className="fseg-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8.5 8 3l6 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 7.5V14h8V7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6.5 14v-3.5h3V14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                  Remodel
                </button>
                <button className="fseg-btn" type="button" data-v="NEW_BUILD" aria-pressed="false">
                  <svg className="fseg-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8.5 8 3l6 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 7.5V14h8V7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6 8.2V14M8 7v7M10 8.2V14" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
                  New construction
                </button>
                <button className="fseg-btn" type="button" data-v="JOB" aria-pressed="false">
                  <svg className="fseg-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 9h12M3 9v5M13 9v5M2 5h12M4 5v4M8 5v4M12 5v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  Job project
                </button>
              </div>
              <span className="fld-hint" id="pjfKindHint">The house stands: a kitchen, a bath, an addition, a whole house.</span>
            </div>
            <div className="fld" id="pjfOccupiedFld">
              <span className="fld-lbl">Does the client live there during the work?</span>
              <div className="fseg" id="pjfOccupied" role="group" aria-label="Lives there during the work">
                <button className="fseg-btn" type="button" data-v="yes" aria-pressed="false">
                  Yes
                </button>
                <button className="fseg-btn on" type="button" data-v="no" aria-pressed="true">
                  No
                </button>
              </div>
            </div>
            {/* A NEW BUILD'S START QUESTIONS (2026-11-07, part 4, lib/projectPhases): sewer or septic, water or a well,
                the foundation, the stories, a garage, a shop, a lender, power, gas, fiber — the phases are shaped from
                them. The usual answer is on; painted and read in projects-behavior like the kind segment. */}
            {/* WHO IT IS FOR, AND THE MONEY (2026-11-07, part 5, lib/projectMoneyPlan): a new build for a client — with a
                margin or a fee — or for yourself, a cost tracker with a sale price. Painted and read in projects-behavior. */}
            <div className="fld is-hidden" id="pjfMoneyFld">
              <span className="fld-lbl">Who is it for</span>
              <div className="fseg" id="pjfForWhom" role="group" aria-label="Who the project is for">
                <button className="fseg-btn on" type="button" data-v="CLIENT" aria-pressed="true">
                  For a client
                </button>
                <button className="fseg-btn" type="button" data-v="SELF" aria-pressed="false">
                  For myself
                </button>
              </div>
              <span className="fld-hint" id="pjfForWhomHint">The client has a budget; you earn a margin or a fee on the work.</span>
              <div id="pjfModeFld">
                <span className="fseg-q-ask" style={{ display: "block", marginTop: 8 }}>How you earn</span>
                <div className="fseg fseg--sm" id="pjfMode" role="group" aria-label="How the money is made">
                  <button className="fseg-btn on" type="button" data-v="PROJECT_MARGIN" aria-pressed="true">
                    One margin on the whole project
                  </button>
                  <button className="fseg-btn" type="button" data-v="JOB_MARGIN" aria-pressed="false">
                    A margin per job
                  </button>
                  <button className="fseg-btn" type="button" data-v="COST_PLUS" aria-pressed="false">
                    Cost-plus
                  </button>
                </div>
                <label className="fseg-q-ask" htmlFor="pjfMargin" style={{ display: "block", marginTop: 8 }} id="pjfMarginLbl">Margin, percent of cost</label>
                <input className="pinput" id="pjfMargin" name="marginPct" type="text" inputMode="decimal" placeholder="18" autoComplete="off" style={{ maxWidth: 140 }} />
              </div>
              <div id="pjfSaleFld" className="is-hidden">
                <label className="fseg-q-ask" htmlFor="pjfSale" style={{ display: "block", marginTop: 8 }}>Sale price ($, optional)</label>
                <input className="pinput" id="pjfSale" name="salePrice" type="text" inputMode="numeric" placeholder="780,000" autoComplete="off" style={{ maxWidth: 200 }} />
              </div>
            </div>
            <div className="fld is-hidden" id="pjfBuildFld">
              <span className="fld-lbl">About the lot and the house</span>
              <div className="fseg-grid" id="pjfBuild">
                {BUILD_QUESTIONS.map((q) => (
                  <div className="fseg-q" key={q.key} data-build={q.key} data-default={String(BUILD_DEFAULTS[q.key])}>
                    <span className="fseg-q-ask">{q.ask}</span>
                    <div className="fseg fseg--sm" role="group" aria-label={q.ask}>
                      {q.choices.map((c) => (
                        <button key={String(c.v)} className={`fseg-btn${String(BUILD_DEFAULTS[q.key]) === String(c.v) ? " on" : ""}`} type="button" data-v={String(c.v)} aria-pressed={String(BUILD_DEFAULTS[q.key]) === String(c.v)}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="fld" data-fld="name">
              <label className="fld-lbl" htmlFor="pjfName">
                Project name<span className="req">*</span>
              </label>
              <input
                className="pinput"
                id="pjfName"
                name="name"
                type="text"
                placeholder="Willow Park fencing"
                autoComplete="off"
              />
              <span className="fld-err">Enter a project name</span>
            </div>

            {/* CLIENT (2026-09-18) — whose project it is. Picking one names
                the project for the client and the street when the name is
                still blank; the project page then offers that client's loose
                proposals, and "New proposal" there files for them. */}
            <div className="fld">
              <label className="fld-lbl" htmlFor="pjfClient">Client</label>
              <select className="pinput" id="pjfClient" name="clientId" defaultValue="">
                <option value="">No client</option>
                {/* A remodel often starts with someone not in the app yet
                    (2026-11-04): the client is made with the project. */}
                {canAddClient && <option value="__new">+ New client…</option>}
                {clients.map((c) => (
                  <option key={c.id} value={c.id} data-street={c.street}>
                    {c.name}
                    {c.street ? ` — ${c.street}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="mdl-row is-hidden" id="pjfNewClient">
              <div className="fld" data-fld="client">
                <label className="fld-lbl" htmlFor="pjfClientName">
                  Client name<span className="req">*</span>
                </label>
                <input className="pinput" id="pjfClientName" type="text" placeholder="Megan & Tom Bennett" autoComplete="off" />
                <span className="fld-err">Enter the client&apos;s name</span>
              </div>
              <div className="fld">
                <label className="fld-lbl" htmlFor="pjfClientPhone">Phone</label>
                <input className="pinput" id="pjfClientPhone" type="tel" inputMode="tel" placeholder="(206) 555-0142" autoComplete="off" />
              </div>
            </div>

            <div className="fld">
              <label className="fld-lbl" htmlFor="pjfDesc">Scope</label>
              <textarea
                className="pinput"
                id="pjfDesc"
                name="description"
                placeholder="Kitchen, two baths and new flooring through the main floor."
              ></textarea>
            </div>

            <div className="fld">
              <span className="fld-lbl">Status</span>
              <div className="fseg" id="pjfStatus" role="group" aria-label="Project status">
                <button className="fseg-btn on" type="button" data-v="ACTIVE" aria-pressed="true">
                  <span className="fseg-dot"></span>active
                </button>
                <button className="fseg-btn" type="button" data-v="ON_HOLD" aria-pressed="false">
                  <span className="fseg-dot"></span>on hold
                </button>
                <button className="fseg-btn" type="button" data-v="COMPLETED" aria-pressed="false">
                  <span className="fseg-dot"></span>completed
                </button>
              </div>
            </div>

            {/* Schedule. `type="text"`, not `type="date"`: the native control
                opens an OS panel no stylesheet can reach, and both fields drew
                the same grey browser glyph, so Starts and Ends looked
                identical. components/v3/shared/date-popover.ts upgrades them on
                mount — a clock on Starts, an hourglass on Ends (the calendar
                page's own pairing) and the blueprint month grid on each. The
                value stays the "YYYY-MM-DD" string shortDate parses. */}
            <div className="mdl-row">
              <div className="fld">
                <label className="fld-lbl" htmlFor="pjfStart">Starts</label>
                <input className="pinput" id="pjfStart" name="startsAt" type="text" placeholder="YYYY-MM-DD" autoComplete="off" />
              </div>
              <div className="fld">
                <label className="fld-lbl" htmlFor="pjfEnd">Ends</label>
                <input className="pinput" id="pjfEnd" name="endsAt" type="text" placeholder="YYYY-MM-DD" autoComplete="off" />
              </div>
            </div>

            <div className="fld">
              <label className="fld-lbl" htmlFor="pjfBudget">Cost budget</label>
              <input
                className="pinput"
                id="pjfBudget"
                name="budget"
                type="text"
                inputMode="numeric"
                placeholder="74,300"
                autoComplete="off"
                aria-describedby="pjfBudgetHint"
              />
              {/* It was read as the price (owner walk, 2026-11-04). */}
              <span className="fld-hint" id="pjfBudgetHint">
                What the work should cost you — materials, labor, subs. Not the client&apos;s price: that comes from the proposals.
              </span>
            </div>
          </form>

          <div className="mdl-foot">
            <button className="btn btn-ghost" type="button" data-mdl="close">
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="pjNewForm" id="pjNewOk">
              <svg className="ic">
                <use href="#i-check" />
              </svg>
              <span data-save-lbl>Create project</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
