"use client";

// Blueprint financials — page CONTENT only. The donor's `.content` children,
// verbatim; the sidebar, topbar, base sprite and graph-paper field come from
// the shared shell (components/v3/blueprint-shell), which persists across
// navigation. Dynamic regions (#chartTotals, #revChart, #gauge, #gaugeFoot,
// #statGrid, #attList, #rcStaged and the three table bodies) are left empty
// exactly like the donor and filled by the ported script on mount — same
// architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.

import { useCallback, useRef } from "react";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initFinancialsContent, type FinancialsJob } from "./financials-behavior";
import type {
  ChangeOrder,
  Expense,
  FinancialsByPerson,
  Invoice,
  InvoiceTarget,
  MonthPoint,
  OverheadMonth,
  OverheadSheet,
  Rollup,
} from "./financials-data";
import { FinancialsActions } from "./financials-actions";
import { DeskExpenseFilter } from "./desk-expense-filter";
import { JobCostCard, OfficeReview } from "@/components/v3/crew-board/office-review";
import { EMPTY_OFFICE_MONEY, type OfficeMoney } from "@/components/v3/crew-board/office-review-data";
import { FinancialsSprite } from "./sprite";
import { RampCardSpend } from "./ramp-card-spend";

export type FinancialsContentProps = {
  /** The org's real jobs. Receipt capture books an expense against one of
   *  these, so the picker cannot be a fixture — the id it submits has to
   *  exist. */
  jobs: FinancialsJob[];
  monthly: MonthPoint[];
  rollup: Rollup;
  expenses: Expense[];
  orders: ChangeOrder[];
  invoices: Invoice[];
  /** Contracts that still owe money — what "New invoice" may bill. */
  invoiceTargets: InvoiceTarget[];
  /** WHO DID IT — the 30-day split of payments recorded and expenses logged,
   *  per person; drawn under the Invoices and Expenses heads. */
  byPerson?: FinancialsByPerson;
  /** Twelve months of job money, oldest first — the Overhead tab's month
   *  cursor walks this, so switching months costs no round trip. */
  overheadMonths: OverheadMonth[];
  /** Every overhead sheet the org has saved, keyed "YYYY-MM". */
  overheadSheets: Record<string, OverheadSheet>;
  /** Stage D: the receipts on review, what is owed to workers, the cost of
   *  each job and the purchases for stock (lib/officeMoney). */
  office?: OfficeMoney;
};

/** After a review the books are read again — they are built once from the
 *  payload (see landOn in ./financials-actions.tsx) — landing on Expenses. */
const reloadExpenses = () => window.location.assign("/dashboard/financials?tab=expenses");

export function FinancialsContent(props: FinancialsContentProps) {
  // Reaches `init` through a write-once ref, NOT the callback's deps:
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a re-run
  // tears the page down and replays the whole reveal cascade. Same contract as
  // the Workers page — which is why the whole payload goes through ONE ref
  // rather than six.
  const dataRef = useRef(props);
  const init = useCallback((content: HTMLElement) => {
    const d = dataRef.current;
    return initFinancialsContent(content, {
      jobs: d.jobs,
      monthly: d.monthly,
      rollup: d.rollup,
      expenses: d.expenses,
      orders: d.orders,
      invoices: d.invoices,
      byPerson: d.byPerson,
      overheadMonths: d.overheadMonths,
      overheadSheets: d.overheadSheets,
    });
  }, []);
  useBlueprintContent(init);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Money</div>
          <h1 className="page-title">Financials</h1>
        </div>
        {/* The four things this page could never do: book an expense, raise a
            change order, invoice a balance, scan a receipt. Each drives an
            action that already existed elsewhere. */}
        <FinancialsActions jobs={props.jobs} invoiceTargets={props.invoiceTargets} stockItems={(props.office ?? EMPTY_OFFICE_MONEY).stockItems} />
      </div>

      <nav className="fi-tabs" id="fiTabs">
        <button className="fi-tab active" type="button" data-tab="overview">
          <svg className="ic">
            <use href="#i-grid" />
          </svg>
          Overview
        </button>
        <button className="fi-tab" type="button" data-tab="overhead">
          <svg className="ic">
            <use href="#i-building" />
          </svg>
          Overhead
        </button>
        <button className="fi-tab" type="button" data-tab="expenses">
          <svg className="ic">
            <use href="#i-receipt" />
          </svg>
          Expenses
        </button>
        <button className="fi-tab" type="button" data-tab="orders">
          <svg className="ic">
            <use href="#i-pen" />
          </svg>
          Change orders
        </button>
        <button className="fi-tab" type="button" data-tab="invoices">
          <svg className="ic">
            <use href="#i-file" />
          </svg>
          Invoices
        </button>
      </nav>

      {/* ========== OVERVIEW ========== */}
      <section className="ppanel" data-panel="overview">
        <div className="fi-band">
          <div className="card fi-card">
            <div className="fi-head">
              <div>
                <div className="kpi-lbl">Revenue vs Expenses</div>
                {/* The scope line doubles as the chart's hover readout: point at
                    a month and it names that month while #chartTotals switches
                    to its figures. Filled by the behavior module. */}
                <div className="fi-sub" id="chartScope"></div>
              </div>
              <div className="fi-headstats" id="chartTotals"></div>
            </div>
            <div className="fi-chart" id="revChart"></div>
            <div className="fi-legend">
              <span>
                <i className="sw-rev"></i>Revenue
              </span>
              <span>
                <i className="sw-exp"></i>Expenses
              </span>
              <span>
                <i className="net"></i>Net
              </span>
            </div>
          </div>

          <div className="card fi-card fi-gauge">
            <div className="fi-head">
              <div className="kpi-lbl">Profit margin</div>
              <span className="pstatus" id="marginTone"></span>
            </div>
            <div className="gauge-wrap" id="gauge"></div>
            <div className="gauge-foot" id="gaugeFoot"></div>
          </div>
        </div>

        <div className="stat-grid" id="statGrid"></div>

        <div className="fi-two">
          <div className="card fi-card">
            <div className="fi-head">
              <div>
                <div className="kpi-lbl">Receipt capture</div>
                <div className="fi-sub">Drop a receipt image — vendor, total and category are read off it and staged as an expense for your review.</div>
              </div>
              <svg className="ic fi-head-ic">
                <use href="#i-receipt" />
              </svg>
            </div>
            {/* The drop zone is a real upload now: the hidden input is what a
                click opens, and a drag-and-drop reaches the same handler. Both
                paths run the file through `scanReceipt` and stage the result
                against a real job. */}
            <div className="rc-body">
              <button className="rc-drop" type="button" id="rcDrop">
                <svg className="ic">
                  <use href="#i-imgadd" />
                </svg>
                <span className="rc-t">Drop a receipt or click to upload</span>
                <span className="rc-h">A phone photo — JPG, PNG or HEIC · read, then charged to a job</span>
              </button>
              {/* Any image the picker offers, HEIC included: the browser
                  re-encodes what it can decode (lib/receiptImage) and says in
                  words what it cannot, instead of the picker greying the
                  owner's phone photo out. */}
              <input
                type="file"
                id="rcFile"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="is-hidden"
              />
              {/* Progress and failure both land here — "Reading the receipt…",
                  "Vision is off, so these are placeholder values", or the
                  server action's own message. */}
              <div className="rc-note is-hidden" id="rcNote" role="status"></div>
              <div className="rc-staged is-hidden" id="rcStaged"></div>
            </div>
          </div>

          <div className="card fi-card">
            <div className="fi-head">
              <div>
                <div className="kpi-lbl">Attention</div>
                <div className="fi-sub">What needs you this week.</div>
              </div>
            </div>
            <ul className="att-list" id="attList"></ul>
          </div>
        </div>
      </section>

      {/* ========== OVERHEAD ==========
          The month's recurring cost of staying open, against what the work
          actually cleared. Every dynamic region is left empty and filled by
          overhead-behavior on mount — same contract as the rest of the page.

          Card heads use the donor's `.card-title` voice (15px / 900 / caps)
          rather than the 11px `.kpi-lbl` the stat cards wear: these are three
          named sheets, and the verdict beneath Coverage must not outrank the
          card it sits in. */}
      <section className="ppanel is-hidden" data-panel="overhead">
        <div className="card fi-card oh-card oh-cover">
          <div className="oh-head">
            <div className="card-titles">
              <div className="card-title">Coverage</div>
              <div className="card-sub" id="ohScope"></div>
            </div>
            <div className="oh-month">
              <button className="icon-sq" type="button" id="ohPrev" aria-label="Previous month">
                <svg className="ic rot-l">
                  <use href="#i-chev" />
                </svg>
              </button>
              <span className="oh-month-lbl" id="ohMonth"></span>
              <button className="icon-sq" type="button" id="ohNext" aria-label="Next month">
                <svg className="ic rot-r">
                  <use href="#i-chev" />
                </svg>
              </button>
            </div>
          </div>
          {/* Quarter marks: a gauge with no scale is a slab. The fill reads
              against them, and 100 is where the bills are paid. */}
          <div className="oh-bar">
            <div className="oh-bar-fill" id="ohFill"></div>
            <i className="oh-tick" style={{ left: "25%" }}></i>
            <i className="oh-tick" style={{ left: "50%" }}></i>
            <i className="oh-tick" style={{ left: "75%" }}></i>
          </div>
          <div className="oh-scale" aria-hidden="true">
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100%</span>
          </div>
          <div className="oh-verdict" id="ohVerdict"></div>
          <div className="oh-figs" id="ohFigs"></div>
        </div>

        {/* One sheet, two columns. Fixed is the long column (eight lines plus
            whatever the contractor adds); the short scaling column carries the
            totals and the write beneath it, so the page ends where the money
            does instead of leaving a void under three rows. */}
        <div className="oh-sheet">
          <div className="card fi-card oh-card">
            <div className="oh-head">
              <div className="card-titles">
                <div className="card-title">Fixed</div>
                <div className="card-sub">Same every month.</div>
              </div>
              <span className="oh-sum" id="ohFixedSum"></span>
            </div>
            <div className="oh-grid">
              <div id="ohFixed"></div>
              <div id="ohCustom"></div>
              <button className="oh-add" type="button" id="ohAddLine">
                <svg className="ic">
                  <use href="#i-plus" />
                </svg>
                Add a line
              </button>
            </div>
          </div>

          <div className="oh-col">
            <div className="card fi-card oh-card">
              <div className="oh-head">
                <div className="card-titles">
                  <div className="card-title">Scales with revenue</div>
                  <div className="card-sub">Dollars, or a percent of the month.</div>
                </div>
                <span className="oh-sum" id="ohVarSum"></span>
              </div>
              <div className="oh-grid" id="ohVar"></div>
            </div>

            <div className="card fi-card oh-card oh-total-card">
              <div className="oh-total-rows">
                <div className="oh-total-row">
                  <span className="oh-lbl">Fixed</span>
                  <b id="ohSumFixed"></b>
                </div>
                <div className="oh-total-row">
                  <span className="oh-lbl">Scaling</span>
                  <b id="ohSumVar"></b>
                </div>
                <div className="oh-total-row oh-total-row--total">
                  <span className="card-title">Total overhead</span>
                  <b className="oh-total-val" id="ohTotal"></b>
                </div>
              </div>
              {/* No Save button: the sheet writes itself 700ms after the last
                  keystroke (overhead-behavior). This row is the receipt. */}
              <div className="oh-total-act">
                <span className="oh-auto">Saves as you type</span>
                <span className="oh-note is-hidden" id="ohNote" role="status"></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== EXPENSES ========== */}
      <section className="ppanel is-hidden" data-panel="expenses">
        {/* Stage D (2026-09-30): the crew's receipts waiting for the owner or a
            manager, and what is owed to workers — on top, where the work is. */}
        <OfficeReview data={props.office ?? EMPTY_OFFICE_MONEY} onChanged={reloadExpenses} />
        {/* Ramp (2026-10-29): the swipes still waiting for a job, placed here by the office. Nothing when Ramp is not connected. */}
        <RampCardSpend jobs={props.jobs} />
        <div className="card card--table">
          <div className="tb-head">
            <span className="kpi-lbl">Expenses</span>
            <span className="tb-total" id="expTotal"></span>
          </div>
          <DeskExpenseFilter expenses={props.expenses} />
          {/* WHO DID IT: who logged what over the last 30 days, each in their
              color. Filled by the behavior module; stays hidden when the trail
              names nobody. */}
          <div className="fi-by is-hidden" id="expBy"></div>
          {/* A refused write says so here rather than the row silently staying
              put — `deleteJobExpense` throws "Not found" for anything outside
              the org, and the server is manager-gated. */}
          <div className="fi-tnote is-hidden" id="expNote" role="alert"></div>
          <table className="ptable fi-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Category</th>
                <th>Note</th>
                <th>Logged</th>
                <th className="num">Amount</th>
                <th className="th-open"></th>
              </tr>
            </thead>
            <tbody id="expBody"></tbody>
          </table>
        </div>
        <div className="pempty is-hidden" id="expEmpty">
          <b>No expenses yet</b>
          <br />
          Drop a receipt above or add one manually from any job&apos;s Expenses tab.
        </div>
        {/* What each job consumed (lib/jobCost) — the job page's own figure. */}
        <JobCostCard costs={(props.office ?? EMPTY_OFFICE_MONEY).costs} stockPurchases30d={(props.office ?? EMPTY_OFFICE_MONEY).stockPurchases30d} />
      </section>

      {/* ========== CHANGE ORDERS ========== */}
      <section className="ppanel is-hidden" data-panel="orders">
        <div className="card card--table">
          <div className="tb-head">
            <span className="kpi-lbl">Change orders</span>
            <span className="tb-total" id="coTotal"></span>
          </div>
          {/* `sendChangeOrder` refuses anything that is not a DRAFT, and
              `deleteChangeOrder` the same — both messages are written for the
              user, so they are shown verbatim. */}
          <div className="fi-tnote is-hidden" id="coNote" role="alert"></div>
          <table className="ptable fi-table">
            <thead>
              <tr>
                <th>Change order</th>
                <th>Job</th>
                <th>Status</th>
                <th>Created</th>
                <th className="num">Amount</th>
                <th className="th-open"></th>
              </tr>
            </thead>
            <tbody id="coBody"></tbody>
          </table>
        </div>
        <div className="pempty is-hidden" id="coEmpty">
          <b>No change orders yet</b>
          <br />
          Raise one from a job when scope grows.
        </div>
      </section>

      {/* ========== INVOICES ========== */}
      <section className="ppanel is-hidden" data-panel="invoices">
        <div className="card card--table">
          <div className="tb-head">
            <span className="kpi-lbl">Invoices</span>
            <span className="tb-total" id="invTotal"></span>
          </div>
          {/* WHO DID IT: who recorded the payments of the last 30 days — the
              client's own online payments as a grey "Client". */}
          <div className="fi-by is-hidden" id="invBy"></div>
          <table className="ptable fi-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Status</th>
                <th>Provider</th>
                <th>Due</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody id="invBody"></tbody>
          </table>
        </div>
        <div className="pempty is-hidden" id="invEmpty">
          <b>No invoices yet</b>
          <br />
          Invoices appear when a proposal is accepted and billed.
        </div>
      </section>

      <div className="pmenu" id="pMenu"></div>

      {/* Deleting an expense or a draft change order is a real, irreversible
          database write, so it goes through a confirmation the same way the
          classic tables' `confirm()` did — as a blueprint dialog rather than a
          browser prompt. One dialog serves both books; the behavior module
          retitles it and remembers which row is pending.

          It lives inside `.content` (it is position:fixed, so layout is
          unaffected) and is skipped by the reveal cascade — see the
          `:not(.mdl)` in financials-behavior. */}
      <div className="mdl" id="fiConfirm">
        <div className="mdl-bg" data-mdl-close></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span id="fiConfirmTitle">Delete?</span>
            <button className="mdl-x" type="button" data-mdl-close aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-txt" id="fiConfirmTxt"></div>
          <div className="fi-tnote fi-tnote--boxed is-hidden" id="fiConfirmErr" role="alert"></div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl-close>
              Cancel
            </button>
            <button className="btn btn-primary btn--sm" type="button" id="fiConfirmOk">
              <svg className="ic">
                <use href="#i-trash" />
              </svg>
              <span data-save-lbl>Delete</span>
            </button>
          </div>
        </div>
      </div>

      <FinancialsSprite />
    </>
  );
}
