"use client";

// Blueprint CRM — page CONTENT only. The donor's `.content` children
// (jobflex-crm-blueprint_1.html), verbatim; the sidebar, topbar and SVG sprite
// come from the shared shell (components/v3/blueprint-shell), which persists
// across navigation. The donor's sprite is byte-identical to the shell's, so
// no local copy is needed.
//
// Dynamic regions (#statGrid, #freshList, #actionList, #recentList, #cbTiles,
// #cbChips, #cbCaption, #cbBody, #ruleForm, #rulesList, #queueBody,
// #queuePager) are left empty exactly like the donor and filled by the ported
// script on mount — same architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.

import { useCallback, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initCrmContent } from "./crm-behavior";
import type { CrmContentData } from "./crm-data";
import type { CrmBrief } from "@/lib/crm/brief";
import { OfficePanel, TodayPanel } from "./crm-brief";
import { AgentDesk } from "./crm-agent";
import { deskOpen, type CrmDesk } from "@/lib/crm/desk";

/**
 * @param data the org's real CRM rows, read in the page's server component.
 *   The behavior module takes them as its starting state and then keeps itself
 *   in step with the database through the follow-up server actions.
 */
/**
 * @param brief today's checks and the office figures (lib/crm/briefServer) —
 *   drawn by React inside two `.ppanel` sections the behavior module switches
 *   like any other tab. Today is the sheet the CRM opens on.
 */
/**
 * @param desk the follow-ups waiting for a yes and the promise tracker (lib/crm/deskServer) — the band at the top of
 *   Today. Null when it could not be read: the page still opens, without the band.
 */
export function CrmContent({ data, brief, desk }: { data: CrmContentData; brief: CrmBrief; desk: CrmDesk | null }) {
  const router = useRouter();
  // What the band holds for the person today (waiting follow-ups + promises overdue or due today): it joins the Today
  // tab's count and keeps the "nothing waiting on you" block away.
  const [deskN, setDeskN] = useState(() => deskOpen(desk));
  // A follow-up sent, skipped or done from the band also leaves the queue the behavior module draws.
  const followUpClosed = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent("crm:follow-up-closed", { detail: id }));
  }, []);

  // The payload reaches `init` through refs, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a re-run
  // tears the page down and replays the whole reveal cascade — so the init has
  // to stay referentially stable for the life of the mount.
  //
  // Neither ref is written after creation, and neither needs to be: they are
  // seeded on the first render, the layout effect that reads them runs against
  // that same commit, and from then on the behavior module owns the rules and
  // the queue and keeps itself in step with the database through the actions. A
  // navigation away unmounts the component, so the next visit gets fresh refs
  // holding freshly-queried rows.
  const seedRef = useRef(data);
  const routerRef = useRef(router);

  const init = useCallback(
    (content: HTMLElement) =>
      initCrmContent(content, {
        data: seedRef.current,
        // Client-side navigation: the two overview rows that used to fake a
        // "flash" now actually go where they say they go, and going through the
        // router keeps the persistent shell mounted instead of reloading it.
        // `typedRoutes` is on, so `push` wants a `Route`, not a bare string;
        // the hrefs are literals owned by the behavior module.
        navigate: (href: string) =>
          routerRef.current.push(href as Parameters<typeof routerRef.current.push>[0]),
      }),
    [],
  );
  useBlueprintContent(init);

  return (
    <>
      {/* PAGE HEAD */}
      <div className="page-head">
        <div>
          <div className="kicker">Pipeline</div>
          <h1 className="page-title">CRM</h1>
        </div>
      </div>

      {/* CRM TABS (Smart CRM part 1, 2026-11-08): the four screens first — Today · Inbox · Pipeline · Customers —
          then the working panels (Office · Overview · Workflows · Follow-up queue) behind them. Inbox and Pipeline
          go to their pages: the client Inbox (part 2) and the Pipeline (part 3). */}
      <nav className="crm-tabs" id="crmTabs">
        <button className="crm-tab active" type="button" data-tab="today" data-crm-tab="today">
          <svg className="ic">
            <use href="#i-cal" />
          </svg>
          Today
          {brief.today.score.open + deskN > 0 && <span className="crm-tab-n">{brief.today.score.open + deskN}</span>}
        </button>
        <button className="crm-tab" type="button" data-crm-nav="inbox" onClick={() => router.push("/dashboard/inbox" as Route)}>
          <svg className="ic">
            <use href="#i-msg" />
          </svg>
          Inbox
        </button>
        <button className="crm-tab" type="button" data-crm-nav="pipeline" onClick={() => router.push("/dashboard/pipeline" as Route)}>
          <svg className="ic">
            <use href="#i-target" />
          </svg>
          Pipeline
        </button>
        <button className="crm-tab" type="button" data-tab="customers">
          <svg className="ic">
            <use href="#i-users" />
          </svg>
          Customers
        </button>
        {brief.office && (
          <button className="crm-tab" type="button" data-tab="office" data-crm-tab="office">
            <svg className="ic">
              <use href="#i-chart" />
            </svg>
            Office
          </button>
        )}
        <button className="crm-tab" type="button" data-tab="overview">
          <svg className="ic">
            <use href="#i-grid" />
          </svg>
          Overview
        </button>
        <button className="crm-tab" type="button" data-tab="workflows">
          <svg className="ic">
            <use href="#i-crm" />
          </svg>
          Workflows
        </button>
        <button className="crm-tab" type="button" data-tab="queue">
          <svg className="ic">
            <use href="#i-cal" />
          </svg>
          Follow-up queue
          <span className="crm-tab-n" id="queueTabN">
            0
          </span>
        </button>
      </nav>

      {/* ========== TODAY — what to check ========== */}
      <section className="ppanel" data-panel="today">
        <TodayPanel key={brief.today.dayKey} today={brief.today} extraOpen={deskN} extra={desk ? <AgentDesk initial={desk} onFollowUpClosed={followUpClosed} onCount={setDeskN} /> : null} />
      </section>

      {/* ========== OFFICE — how the company is doing, right now ========== */}
      {brief.office && (
        <section className="ppanel is-hidden" data-panel="office">
          <OfficePanel office={brief.office} company={data.org.name} />
        </section>
      )}

      {/* ========== OVERVIEW ========== */}
      <section className="ppanel is-hidden" data-panel="overview">
        <div className="stat-grid" id="statGrid"></div>

        <div className="crm-cols">
          <div className="card">
            <div className="card-head">
              <div className="card-titles">
                <div className="card-title">Fresh leads</div>
                <div className="card-sub">Latest five — claim or route.</div>
              </div>
            </div>
            <ul className="fresh" id="freshList"></ul>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-titles">
                <div className="card-title">What needs you</div>
                <div className="card-sub">Pinch points worth acting on.</div>
              </div>
            </div>
            <ul className="actions" id="actionList"></ul>
            <div className="recent">
              <div className="kpi-lbl">Recent activity</div>
              <ul className="recent-list" id="recentList"></ul>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CUSTOMER BOOK ========== */}
      <section className="ppanel is-hidden" data-panel="customers">
        <div className="cb-tiles" id="cbTiles"></div>
        <div className="cb-filters">
          <div className="cb-chips" id="cbChips"></div>
          <span className="cb-caption" id="cbCaption"></span>
        </div>
        <div className="card card--table">
          <table className="ptable cb-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Top status</th>
                <th className="num">Quotes</th>
                <th className="num">Quoted value</th>
                <th className="num">Lifetime value</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody id="cbBody"></tbody>
          </table>
        </div>
      </section>

      {/* ========== WORKFLOWS ==========
          Two cards side by side: the rules on the left, and to their RIGHT the
          message that actually goes out. The preview is not decoration — it is
          rendered by the same module the dispatcher sends from
          (src/lib/followUps/copy.ts + lib/email/renderEmail), so what a
          contractor approves here is byte-for-byte what the homeowner opens. */}
      <section className="ppanel is-hidden" data-panel="workflows">
        {/* One line over the rules: are follow-ups going out, and when the
            next one goes (crm-behavior renderFuStatus). Off → Turn on defaults. */}
        <div className="fu-status" id="fuStatus" role="status">
          <p className="fu-status-txt">
            <span className="fu-dot" aria-hidden="true" />
            <span id="fuStatusTxt" />
          </p>
          <button className="btn btn-primary btn--sm is-hidden" type="button" id="fuDefaultsBtn">
            Turn on defaults
          </button>
        </div>
        <div className="wf-cols">
          <div className="card">
            <div className="card-head">
              <div className="card-titles">
                <div className="card-title">Follow-up rules</div>
                <div className="card-sub">
                  Auto-schedule a follow-up when a proposal hits a status. The wording is written
                  for that moment and filled in with the client&rsquo;s own details at send.
                </div>
              </div>
              <button className="btn btn-ghost newrule-btn" type="button" id="newRuleBtn">
                <svg className="ic">
                  <use href="#i-plus" />
                </svg>
                New rule
              </button>
            </div>
            <div className="rule-form is-hidden" id="ruleForm"></div>
            {/* Toggle / delete run straight against the database; when the action
                refuses (rule CRUD is manager-only) the reason lands here rather
                than the row silently snapping back. */}
            <div className="mf-err mf-err--boxed is-hidden" id="rulesErr" role="alert"></div>
            <ul className="rules" id="rulesList"></ul>
            <div className="pempty is-hidden" id="rulesEmpty">
              <b>No rules yet</b>
              <br />
              Create one to start automating reminders.
            </div>
          </div>

          <div className="card prev-card">
            <div className="card-head">
              <div className="card-titles">
                <div className="card-title">What they receive</div>
                <div className="card-sub" id="prevSub"></div>
              </div>
              <span className="bp-sel prev-pick">
                <select className="bp-sel-in" id="prevTrigger" aria-label="Preview moment"></select>
              </span>
            </div>
            <div className="prev-stage" id="prevStage"></div>
          </div>
        </div>
      </section>

      {/* ========== FOLLOW-UP QUEUE ========== */}
      <section className="ppanel is-hidden" data-panel="queue">
        <div className="ptabs" id="qTabs">
          <button className="ptab active" type="button" data-q="ALL">
            All
            <span className="ptab-count" data-qn="ALL">
              0
            </span>
          </button>
          <button className="ptab" type="button" data-q="DUE">
            Due now
            <span className="ptab-count" data-qn="DUE">
              0
            </span>
          </button>
          <button className="ptab" type="button" data-q="SCHEDULED">
            Scheduled
            <span className="ptab-count" data-qn="SCHEDULED">
              0
            </span>
          </button>
        </div>
        {/* Done / Send dispatch real follow-ups; a refusal is reported here. */}
        <div className="mf-err mf-err--boxed mf-err--flush is-hidden" id="queueErr" role="alert"></div>
        <div className="card card--table" id="queueCard">
          <table className="ptable q-table">
            <thead>
              <tr>
                <th>Follow-up</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th className="th-open"></th>
              </tr>
            </thead>
            <tbody id="queueBody"></tbody>
          </table>
        </div>
        <div className="pempty is-hidden" id="queueEmpty">
          <b>Queue is clear</b>
          <br />
          Follow-ups are scheduled by your workflow rules. When proposals trigger them,
          they&apos;ll land here.
        </div>
        <div className="pager" id="queuePager"></div>
      </section>

      <div className="pmenu" id="pMenu"></div>
    </>
  );
}
