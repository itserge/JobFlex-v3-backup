// Proposals blueprint — runtime behaviors, ported from the donor file's
// <script> (jobflex-proposals-blueprint.html). Every duration, easing, stagger,
// page size and formula is the donor's exact value. Adaptations:
//
// - queries are scoped to the mounted root;
// - document/window listeners, timers and observers are tracked for unmount
//   cleanup;
// - FLUID SCALE zooms the page ROOT instead of document.documentElement (the
//   root owns the full viewport, so the visual result is identical, and the
//   zoom cannot leak into the rest of the app); the menu-positioning math reads
//   the root's zoom accordingly;
// - the reveal cascade reads `.content > *:not(.mdl):not([data-island])`. The
//   dialogs and the React-island host are not donor blocks; leaving them in
//   would shift the donor's i*60ms stagger indices, and a `display:none`
//   overlay that gets `.rv` never receives the IntersectionObserver callback
//   that would clear `opacity: 0` — it would open invisible.
//
// THE REAL WORK
//
// The donor page was a fixture: a seed array paged and mutated in memory. It
// is now the org's real proposal book, read in
// src/app/dashboard/proposals/page.tsx and handed in through `options.rows`;
// every row action calls the same server action the classic row menu called
// (src/components/proposal/RowActions.tsx), so a write here is the write the
// old design performed:
//
//   Edit proposal    → /dashboard/proposals/<id>            (the live editor)
//   View public page → /portal/q/<publicId>                 (the client page)
//   Duplicate        → duplicateProposal()
//   Send to client   → sendProposal()
//   Order materials  → the MaterialsSheet component, mounted as a React island
//                      (the accepted card's chip; out of the row menu 2026-09-25)
//   View on Zillow   → zillowSearchUrl(), precomputed per row on the server
//   Delete proposal  → bulkDeleteProposals([id])
//
// and the accepted / completed cards move through updateProposalStatus().
//
// Row motion follows the house rule: NO MutationObserver stagger. A list
// staggers only when it genuinely ARRIVES (first paint, first reveal of a tab,
// a page turn); a filter, a keystroke or a single-row change repaints silently,
// and a row that LEAVES does so alone through leaveRow.

import { ensureCompanyName } from "@/components/company-name/company-name-gate";
import {
  bulkDeleteProposals,
  duplicateProposal,
  sendProposal,
  updateProposalStatus,
  uploadProposalPhoto,
} from "@/actions/proposals";
import { notifyPaymentReminder, setProposalReminders, sendInstallmentInvoice, getInvoiceOptions } from "@/actions/notify";
import { sendFinancingLink } from "@/actions/financing";
import { markInstallmentPaid, unmarkInstallmentPaid, recordRemainingPayment } from "@/actions/installments";
// The handheld surface's route-local read of the SAME book this page renders
// from (same query, same requireProposalStaff guard) — used to pick up a row
// the server just created without leaving the page.
import { loadProposalBook } from "@/app/(mobile)/mobile-proposals-v2/proposals-actions";
import { MaterialsSheet } from "@/components/proposal/MaterialsSheet";
import { ChangeOrderSheet } from "@/components/changeOrders/ChangeOrderSheet";
import { currentZoom, leaveRow, staggerIn } from "@/components/v3/blueprint-shell/list-motion";
import { MDL_EXIT_MS, closeMdl, openMdl } from "@/components/v3/blueprint-shell/mdl-motion";
import { mountIsland, type Island } from "@/components/v3/blueprint-shell/react-island";
import { clientProposalUrl } from "@/lib/proposalLink";
import { whoHtml } from "@/lib/team/who";
import { familyCounts, kindWord, type WorkFamily } from "@/lib/proposalKind";
import { renderCardC, type CardKit } from "./cards";
import {
  PAGE_ACC,
  PAGE_ALL,
  PAGE_DONE,
  cloneRows,
  statusPlate,
  type Installment,
  type ProposalRow,
  chainsOf,
  chained,
  paidTier,
  nextStage,
  payState,
  sendState,
  stageFacts,
  statusAfterSend,
  type Chain,
} from "./proposals-data";

export type ProposalsContentOptions = {
  /** The org's real proposal book, read server-side. There is no fixture to
   *  fall back to any more — an omitted book renders the real empty states. */
  rows?: ProposalRow[];
};

type MaterialsSheetProps = Parameters<typeof MaterialsSheet>[0];
type ChangeOrderSheetProps = Parameters<typeof ChangeOrderSheet>[0];

/** Server actions reject with an Error whose message is written for the user
 *  ("Not found", "Plan limit reached", the send-transport failure). Surface
 *  that text; fall back to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  const code = (err as { code?: string } | null)?.code;
  if (code === "PLAN_LIMIT_REACHED") {
    return "Plan limit reached — this org has used its proposals for the period. Upgrade the plan to create more.";
  }
  if (msg === "Not found") {
    return "That proposal is no longer available to you. Reload the page.";
  }
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** Every row field below is operator-entered text that lands in an innerHTML
 *  string. Escaping is not optional: a client called `Ben & Co <Roofing>` would
 *  otherwise break the table, and a crafted title would inject markup. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stamps that bloomed in this page's lifetime (see bloomOnce inside the init). */
const BLOOM_KEY = "jf-pbloom";
const bloomedNow = new Set<string>();

export function initProposalsContent(
  content: HTMLElement,
  options: ProposalsContentOptions = {},
): () => void {
  // Scoped to `.content`, which the shared shell owns and re-fills on every
  // navigation. `.main` lives in the shell, above this element.
  const root = content;
  const main = content.closest<HTMLElement>(".main");
  const disposers: Array<() => void> = [];
  const on = (
    target: EventTarget,
    ev: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // Tracked `setTimeout`s, so an unmount mid-flight cannot fire into a
  // detached tree. leaveRow and closeMdl both take this helper.
  const timers = new Set<number>();
  const after = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  disposers.push(() => {
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
  });

  // Runtime state — cloned per mount so edits never leak between navigations.
  let proposalsData: ProposalRow[] = cloneRows(options.rows ?? []);

  // Dismiss Lead Center banners (smooth height + gap collapse) — inert on this
  // page (no banner in the markup), kept for donor parity with shared shells.
  $$(".banner-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = btn.closest<HTMLElement>(".banner");
      if (!b || b.classList.contains("closing")) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        b.classList.add("hidden");
        return;
      }
      b.style.height = b.offsetHeight + "px";
      b.style.transitionDelay = "0ms";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          b.classList.add("closing");
          b.style.height = "0px";
        }),
      );
      b.addEventListener("transitionend", function te(e) {
        if (e.propertyName !== "height") return;
        b.classList.add("hidden");
        b.removeEventListener("transitionend", te);
      });
    });
  });

  const pstate = {
    tab: "all",
    filter: "ALL",
    /** The type bar's pick (2026-10-17): every tab, chip and figure narrows to one family of work. */
    kind: "ALL" as "ALL" | WorkFamily,
    pageAll: 1,
    pageAcc: 1,
    pageDone: 1,
    menuId: null as string | null,
    /** The ⋮ the open menu belongs to — it carries the in-flight busy state. */
    menuBtn: null as HTMLElement | null,
    /** Guards a second write while one is on the wire. */
    writing: false,
    /** A panel staggers its rows the first time it is actually on screen. */
    revealed: { all: false, accepted: false, completed: false } as Record<string, boolean>,
  };

  function fmtMoney(n: number) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  // The All tab draws each proposal through the dossier card (cards/card-c.ts, owner's pick 2026-10-30); the kit
  // hands it this page's helpers so its figures and buttons are the classic card's.
  const cardKit: CardKit = {
    esc,
    fmtMoney,
    proposalHref: (id) => proposalHref(id),
    subLine: (p) => subLine(p),
    kindHtml: (p) => kindHtml(p),
    clientDesignHtml: (p) => clientDesignHtml(p),
    bloomOnce: (id, kind, at) => bloomOnce(id, kind, at),
    viewsCellHtml: (p) => viewsCellHtml(p),
    paidCellHtml: (p) => paidCellHtml(p),
    payBarHtml: (p, withTotal) => payBarHtml(p, withTotal),
    sendCellHtml: (p) => sendCellHtml(p),
    payActsHtml: (p, next) => payActsHtml(p, next),
    finHtml: (p) => finHtml(p),
    instDollars: (p, it) => instDollars(p, it),
    payRowHtml: (p, chain) => payRowHtml(p, chain),
    barRowHtml: (p, chain) => barRowHtml(p, chain),
    classicHtml: (p, chain) => classicRowHtml(p, chain),
  };
  /** Money that has to be exact because a write uses the same figure: the
   *  invoice dialog's quote and the confirmation of what was actually sent. */
  function fmtCents(n: number) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /** What a stage is worth right now, to the cent. The row carries the
   *  RESOLVER's figure (proposals-query) — re-deriving a percent here rounded
   *  to whole dollars, and this figure is what the invoice dialog quotes before
   *  sendInstallmentInvoice bills the exact amount. */
  function instDollars(p: ProposalRow, inst: Installment) {
    if (inst.status === "PAID" && inst.paidAmt != null) return inst.paidAmt;
    if (typeof inst.owed === "number") return inst.owed;
    return inst.pct ? Math.round(p.total * inst.amount) / 100 : inst.amount;
  }
  function payPct(p: ProposalRow): number {
    const contract = p.contract ?? p.total;
    const paid = p.paidAmt ?? 0;
    if (p.owed <= 0 && contract > 0) return 100;
    return contract > 0 ? Math.max(0, Math.min(100, Math.round((paid / contract) * 100))) : 0;
  }
  /** Where one stage ends and the next begins, as percentages of the contract
   *  — the ticks on the paid track. Cumulative, without the two ends, and
   *  skipped within a point of either end so a tick never sits on the frame. */
  function payTicks(p: ProposalRow): number[] {
    const contract = p.contract ?? p.total;
    const insts = p.inst || [];
    if (contract <= 0 || insts.length < 2) return [];
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < insts.length - 1; i++) {
      acc += instDollars(p, insts[i]);
      const at = Math.round((acc / contract) * 10000) / 100;
      if (at > 1 && at < 99) out.push(at);
    }
    return out;
  }
  /** Compact dollar summary beneath the card's headline amount. */
  function payBarHtml(p: ProposalRow, withTotal = false): string {
    const contract = p.contract ?? p.total;
    const paid = p.paidAmt ?? 0;
    const pct = payPct(p);
    const full = contract > 0 && p.owed <= 0;
    return (
      '<div class="ppay-line">' +
      '<span class="ppay-paid">Paid <b>' + fmtMoney(paid) + "</b></span>" +
      // The fill's hue says how far the client has paid (owner, 2026-09-26):
      // red short of the first stage, amber past it, green in full.
      '<div class="ppay-bar ppay-bar--' + paidTier(p) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      pct +
      '" aria-valuetext="' +
      esc(fmtMoney(paid) + " paid of " + fmtMoney(contract)) +
      '"><span style="width:' +
      pct +
      '%"></span>' +
      payTicks(p)
        .map((t) => '<i class="ppay-tick" style="left:' + t + '%"></i>')
        .join("") +
      "</div>" +
      (full && !withTotal
        ? ""
        : '<span class="ppay-tag">' +
          (full ? "" : "<b>" + fmtMoney(p.owed) + "</b> due") +
          (withTotal ? (full ? "" : " · ") + "<b>" + fmtMoney(contract) + "</b> total" : "") +
          "</span>") +
      "</div>"
    );
  }
  /** Payment stages and change orders between the card's head and foot. */
  function payStripHtml(p: ProposalRow, blocks: string): string {
    const contract = p.contract ?? p.total;
    const full = contract > 0 && p.owed <= 0;
    return '<div class="ppay' + (full ? " ppay--full" : "") + '">' + blocks + "</div>";
  }
  /** "2 change orders · +$1,080 approved · 1 awaiting approval" — or nothing. */
  /**
   * VIEWS — the thing a contractor checks after sending (owner, 2026-09-20:
   * "check if viewed proposals count working and make more accent it"). A
   * draft has nobody to open it; a sent proposal nobody has opened is worth
   * seeing at a glance; an opened one says how many times and how long ago.
   */
  function viewsCellHtml(p: ProposalRow): string {
    if (p.status === "DRAFT") return '<span class="pt-views pt-views--na" title="A draft has not gone out yet">—</span>';
    if (p.views <= 0) {
      // Amber is for a proposal still WAITING on the client. One that is
      // already accepted, paid or declined was settled another way (signed at
      // the table, agreed on the phone), and a warning on it is noise.
      const waiting = p.status === "SENT" || p.status === "VIEWED";
      return (
        '<span class="pt-views ' + (waiting ? "pt-views--none" : "pt-views--quiet") + '" title="Not opened online' +
        (p.sentAgo ? esc(" — sent " + p.sentAgo) : "") +
        '">' + "<b>0</b><i>not opened</i></span>"
      );
    }
    return (
      '<span class="pt-views pt-views--seen" title="' +
      (p.lastViewed ? esc("Last opened " + p.lastViewed) : "Opened by the client") +
      '">' + "<b>" + p.views + "</b><i>" +
      (p.lastViewed ? esc(p.lastViewed) : p.views === 1 ? "view" : "views") +
      "</i></span>"
    );
  }
  /** A quiet amount paid beneath the contract total. */
  function paidCellHtml(p: ProposalRow): string {
    return '<div class="pt-paid">' + fmtMoney(p.paidAmt ?? 0) + ' paid</div>';
  }
  function coChipHtml(p: ProposalRow): string {
    const co = p.co;
    if (!co || !co.count) return "";
    const bits: string[] = [];
    if (co.approvedTotal) bits.push((co.approvedTotal > 0 ? "+" : "−") + fmtMoney(Math.abs(co.approvedTotal)) + " approved");
    if (co.pending) bits.push(co.pending + " awaiting approval" + (co.pendingTotal ? " (" + (co.pendingTotal > 0 ? "+" : "−") + fmtMoney(Math.abs(co.pendingTotal)) + ")" : ""));
    if (co.drafts) bits.push(co.drafts + " draft" + (co.drafts === 1 ? "" : "s"));
    return (
      '<button class="pco-chip' + (co.pending ? " pco-chip--wait" : "") + '" type="button" data-act="change-order" title="Open the change orders">' +
      '<svg class="ic"><use href="#i-plus"/></svg>' +
      co.count + " change order" + (co.count === 1 ? "" : "s") +
      (bits.length ? " · " + bits.join(" · ") : "") +
      "</button>"
    );
  }
  function instCellActions(p: ProposalRow, inst: Installment): string {
    if (inst.status === "PAID") {
      const via = inst.paidVia === "STRIPE" ? "Stripe" : inst.paidVia === "SQUARE" ? "Square" : "manual";
      return (
        '<span class="pinst-paid"><svg class="ic"><use href="#i-check"/></svg>Paid · ' +
        via +
        "</span>" +
        (inst.paidVia === "MANUAL"
          ? '<button class="btn btn-ghost btn--sm" type="button" data-act="unmark-line" data-inst="' +
            esc(inst.id) +
            '">Undo</button>'
          : "")
      );
    }
    if (inst.status === "WAIVED") return '<span class="pinst-paid">Closed</span>';
    return (
      '<button class="btn btn-ghost btn--sm" type="button" data-act="markpaid" data-inst="' +
      esc(inst.id) +
      '"><svg class="ic"><use href="#i-check"/></svg>Mark paid</button>' +
      '<button class="btn btn-ghost btn--sm" type="button" data-act="invoice" data-inst="' +
      esc(inst.id) +
      '"><svg class="ic"><use href="#i-send"/></svg>Send invoice</button>' +
      '<button class="btn btn-ghost btn--sm" type="button" data-act="remind" data-inst="' +
      esc(inst.id) +
      '"' +
      (p.clientEmail ? "" : " disabled") +
      '><svg class="ic"><use href="#i-bell"/></svg>Remind</button>'
    );
  }
  function sumOf(list: ProposalRow[]) {
    return list.reduce((a, p) => a + p.total, 0);
  }
  function byId(id: string | null) {
    return id ? proposalsData.find((p) => p.id === id) ?? null : null;
  }
  /** The row's second line — a client with no city must not print "Name · ". */
  function subLine(p: ProposalRow) {
    return [p.client, p.city].filter(Boolean).join(" · ");
  }
  /** Every proposal the tabs and chips then narrow. The page had a search box
   *  filtering this list; it was removed with the box rather than left as a
   *  filter nothing can set. */
  function book() {
    return pstate.kind === "ALL" ? proposalsData : proposalsData.filter((p) => (p.kind?.family ?? "other") === pstate.kind);
  }
  /** WHAT KIND (2026-10-17, lib/proposalKind): a square in the work's colour and the work's one word (owner,
   *  2026-10-20: "Roof", the tool that made it only in the tooltip). Above the title on the row and the cards. */
  function kindHtml(p: ProposalRow): string {
    const k = p.kind;
    if (!k) return "";
    const tip = k.work + " — made with " + k.toolWords + (k.tool === "copy" && k.via ? ', a copy of "' + k.via + '"' : k.tool === "template" && k.via ? ' "' + k.via + '"' : "");
    return (
      '<div class="pkind" data-fam="' + esc(k.family) + '" title="' + esc(tip) + '">' +
      '<i class="pkind-sq" aria-hidden="true"></i><b>' + esc(kindWord(k)) + "</b></div>"
    );
  }
  /** The Type dropdown on the filter bar (owner, 2026-10-18): All types + each family the book holds,
   *  each with its tool-colour dot and count — drawn only when there is a choice. */
  function renderKinds() {
    const dd = $("#pKinds");
    if (!dd) return;
    const fams = familyCounts(proposalsData.map((p) => ({ family: p.kind?.family ?? "other" })));
    if (pstate.kind !== "ALL" && !fams.some((f) => f.key === pstate.kind)) pstate.kind = "ALL";
    const menu = $("#pKindsMenu");
    if (fams.length < 2) {
      setKindsOpen(false);
      dd.hidden = true;
      if (menu) menu.innerHTML = "";
      return;
    }
    dd.hidden = false;
    const all = { key: "ALL", label: "All types", count: proposalsData.length };
    const now = pstate.kind === "ALL" ? all : fams.find((f) => f.key === pstate.kind) ?? all;
    const dot = (key: string) =>
      key === "ALL" ? '<i class="flt-dot flt-dot--none" aria-hidden="true"></i>' : '<i class="flt-dot" data-fam="' + key + '" aria-hidden="true"></i>';
    const face = dd.querySelector<HTMLElement>(".flt-face");
    if (face)
      face.innerHTML =
        (now.key === "ALL" ? "All" : dot(now.key) + esc(now.label)) + ' <span class="flt-n">' + now.count + "</span>";
    dd.classList.toggle("is-set", pstate.kind !== "ALL");
    if (menu) {
      menu.innerHTML = [all, ...fams]
        .map((f) => {
          const sel = pstate.kind === f.key;
          return (
            '<button class="flt-item' + (sel ? " active" : "") + '" type="button" role="option" aria-selected="' + sel + '" data-k="' + f.key + '">' +
            dot(f.key) + esc(f.label) + '<span class="flt-n">' + f.count + "</span></button>"
          );
        })
        .join("");
    }
  }
  function setKindsOpen(open: boolean) {
    const dd = $("#pKinds");
    if (!dd) return;
    dd.classList.toggle("open", open);
    dd.querySelector(".flt-drop-btn")?.setAttribute("aria-expanded", String(open));
  }
  function filteredAll() {
    const base = book();
    return pstate.filter === "ALL" ? base : base.filter((p) => p.status === pstate.filter);
  }
  function listAccepted() {
    return book().filter((p) => p.status === "ACCEPTED");
  }
  function listDone() {
    // Completed is a fact about the work (COMPLETED); PAID is the money. Both file here.
    return book().filter((p) => p.status === "PAID" || p.status === "COMPLETED");
  }
  function rmOk() {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function panelVisible(name: string) {
    const pn = root.querySelector<HTMLElement>(`.ppanel[data-panel="${name}"]`);
    return !!pn && !pn.classList.contains("is-hidden");
  }
  /** Find a rendered row by its proposal id without building a selector out of
   *  operator data (a cuid is safe, but the rule should not depend on that). */
  function findRow(container: HTMLElement | null, id: string): HTMLElement | null {
    if (!container) return null;
    return (
      Array.from(container.querySelectorAll<HTMLElement>("[data-id]")).find(
        (el) => el.dataset.id === id,
      ) ?? null
    );
  }

  // ================= PROPOSALS: RENDER =================
  // Masthead: one headline number per tab + exactly two annotations
  function mastData() {
    const all = book(),
      acc = listAccepted(),
      done = listDone();
    if (pstate.tab === "accepted") {
      const owed = sumOf(acc);
      return {
        lbl: "Money Owed · Work In Motion",
        tone: "accent",
        val: fmtMoney(owed),
        sub: [
          ["Active jobs", acc.length],
          ["Avg contract", acc.length ? fmtMoney(Math.round(owed / acc.length)) : "—"],
        ] as Array<[string, string | number]>,
      };
    }
    if (pstate.tab === "completed") {
      const banked = sumOf(done);
      return {
        lbl: "Banked · Jobs Closed",
        tone: "good",
        val: fmtMoney(banked),
        sub: [
          ["Filed jobs", done.length],
          ["Avg job size", done.length ? fmtMoney(Math.round(banked / done.length)) : "—"],
        ] as Array<[string, string | number]>,
      };
    }
    return {
      lbl: "Total Value",
      tone: "accent",
      val: fmtMoney(sumOf(all)),
      sub: [
        ["Open proposals", all.filter((p) => p.status !== "PAID").length],
        ["Accepted", acc.length],
      ] as Array<[string, string | number]>,
    };
  }
  function renderKpis() {
    const m = mastData();
    const el = $("#pMast");
    if (!el) return;
    el.innerHTML =
      '<div class="pmast-top"><span class="pmast-lbl">' +
      m.lbl +
      '</span><span class="pmast-rule"></span></div>' +
      '<div class="pmast-val ' +
      m.tone +
      '">' +
      m.val +
      "</div>" +
      '<div class="pmast-sub">' +
      m.sub.map((x) => "<span>" + x[0] + " <b>" + x[1] + "</b></span>").join("") +
      "</div>";
    if (rmOk()) {
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      el.style.transition =
        "opacity 320ms cubic-bezier(0.22, 0.61, 0.36, 1), transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.opacity = "";
          el.style.transform = "";
          el.addEventListener(
            "transitionend",
            () => {
              el.style.transition = "";
            },
            { once: true },
          );
        }),
      );
    }
  }
  function renderTabCounts() {
    const counts: Record<string, number> = {
      all: book().length,
      accepted: listAccepted().length,
      completed: listDone().length,
    };
    root.querySelectorAll<HTMLElement>("#pTabs .ptab-count").forEach((el) => {
      el.textContent = String(counts[el.dataset.count || ""]);
    });
  }
  function renderChipCounts() {
    const c: Record<string, number> = { ALL: 0, DRAFT: 0, SENT: 0, VIEWED: 0, DECLINED: 0, EXPIRED: 0 };
    book().forEach((p) => {
      c.ALL += 1;
      if (p.status in c && p.status !== "ALL") c[p.status] += 1;
    });
    root.querySelectorAll<HTMLElement>("#pChips [data-cf]").forEach((el) => {
      el.textContent = String(c[el.dataset.cf || ""] ?? 0);
    });
  }
  function renderPager(el: HTMLElement | null, page: number, pages: number, key: string) {
    if (!el) return;
    if (pages <= 1) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML =
      '<span class="pager-info">Page ' +
      page +
      " / " +
      pages +
      "</span>" +
      '<button class="pager-btn" type="button" data-pg="prev" data-key="' +
      key +
      '"' +
      (page <= 1 ? " disabled" : "") +
      ' aria-label="Previous page"><svg class="ic rot-l"><use href="#i-chev"/></svg></button>' +
      '<button class="pager-btn" type="button" data-pg="next" data-key="' +
      key +
      '"' +
      (page >= pages ? " disabled" : "") +
      ' aria-label="Next page"><svg class="ic rot-r"><use href="#i-chev"/></svg></button>';
  }

  /* ── PROJECT CHAINS (2026-09-18) ────────────────────────────────────────
     Proposals filed under the same project read as one piece of work: they
     sit together, under a header naming the project, its client and the
     project's combined contract, joined by a rail down the left edge. The
     group takes the place of its most recently touched proposal, so the list
     still reads newest first. A project with a single proposal in view gets
     no header — its row just names the project. */
  function chainHeadHtml(c: Chain, continued: boolean) {
    return (
      '<tr class="prow-grp" data-grp="' +
      esc(c.id) +
      '"><td colspan="6"><div class="pgrp">' +
      '<svg class="ic pgrp-ic"><use href="#i-folder"/></svg>' +
      '<a class="pgrp-name" href="/dashboard/projects/' +
      encodeURIComponent(c.id) +
      '">' +
      esc(c.name) +
      "</a>" +
      (c.client ? '<span class="pgrp-client">' + esc(c.client) + "</span>" : "") +
      (continued ? '<span class="pgrp-cont">continued</span>' : "") +
      '<span class="pgrp-meta">' +
      c.count +
      " proposals" +
      (c.sold ? " · <b>" + fmtMoney(c.sold) + "</b> sold" : "") +
      (c.open ? " · <b>" + fmtMoney(c.open) + "</b> open" : "") +
      "</span>" +
      "</div></td></tr>"
    );
  }

  /**
   * SEND ON THE ROW (owner, 2026-10-23: "Send proposal, or it's been sent"). A draft carries a green Send; a
   * proposal already sent reads Sent and when, and turns into Resend on hover — signed or not. The dialog is the
   * menu's Send to client.
   */
  function sendCellHtml(p: ProposalRow): string {
    const s = sendState(p);
    if (s === "none") return "";
    if (s === "send") {
      return (
        '<button class="pact pact--send" type="button" data-act="send" title="' +
        esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client — add their email as you send") +
        '"><svg class="ic"><use href="#i-send"/></svg><span>Send</span></button>'
      );
    }
    // Once sent it can always go again, and says so (owner, 2026-10-28: "make it possible and visible you can
    // resend it"; 2026-10-29: "the sent message when hovered turns into a resend button"). One button: it reads
    // Sent and when, and on hover or focus the same plate turns into Resend and opens the send dialog. Without a
    // hover (touch) both halves show side by side.
    return (
      '<button class="pact pact--sent pact--swap" type="button" data-act="send" title="' +
      esc("Sent " + (p.sentAgo ?? "") + " — send it again" + (p.clientEmail ? " to " + p.clientEmail : "")) +
      '" aria-label="' + esc("Sent " + (p.sentAgo ?? "") + ". Resend") + '">' +
      '<span class="pswap pswap--sent"><svg class="ic"><use href="#i-check"/></svg>Sent <small>' + esc(p.sentAgo ?? "") + "</small></span>" +
      '<span class="pswap pswap--resend"><svg class="ic"><use href="#i-send"/></svg>Resend</span>' +
      "</button>"
    );
  }

  /**
   * PAYMENTS ON THE ROW (owner, 2026-10-23: "get the payment options visible at the main proposal row"). A line
   * under the proposal, across the table: every stage with where it stands, and for the stage that is next —
   * once the client has signed — Mark paid, Send invoice (card, bank or the client's choice) and Remind, the
   * same writes as the contract card. Before signing it is the schedule the client will pay by. Nothing for a
   * declined or archived proposal.
   */
  function payRowHtml(p: ProposalRow, chain: string): string {
    const state = payState(p);
    if (!state) return "";
    const insts = p.inst ?? [];
    const next = state === "collect" ? nextStage(p) : null;
    // PAYMENTS, REDRAWN (owner, 2026-10-28: "redesign the payments section to something that looks better"): every
    // stage a column of its own — what it is, its share, the amount large, where it stands — under one heading line
    // that says the money at a glance; the actions in equal columns at the right.
    const stages = insts
      .map((it) => {
        const amount = fmtMoney(instDollars(p, it));
        const share = it.pct ? Math.round(it.amount) + "%" : "";
        let tone = "later";
        let tail = "";
        if (it.status === "PAID") {
          tone = "paid";
          tail = it.paidOn ? "Paid " + it.paidOn : "Paid";
        } else if (it.status === "WAIVED") {
          tone = "closed";
          tail = "Closed";
        } else if (state === "plan") {
          tone = "plan";
          tail = it.due ? "Due " + it.due : "After signing";
        } else if (next && it.id === next.id) {
          // The stage being chased carries its own facts: due or late, invoiced, reminded.
          tone = it.overdue ? "next is-late" : "next";
          tail = stageFacts(it).join(" · ") || "Next to collect";
        } else {
          tail = it.due ? "Due " + it.due : "Later";
        }
        return (
          '<li class="ppl-st ppl-st--' + tone + '" data-stage="' + esc(it.id) + '">' +
          '<span class="ppl-st-k">' + esc(it.label) + (share ? "<em>" + share + "</em>" : "") + "</span>" +
          '<span class="ppl-st-v">' + amount + "</span>" +
          '<i class="ppl-st-s">' + (it.status === "PAID" ? '<svg class="ic"><use href="#i-check"/></svg>' : "") + esc(tail) + "</i>" +
          "</li>"
        );
      })
      .join("") ||
      // Signed with no schedule: the balance is the one thing to collect.
      (state === "collect" ? '<li class="ppl-st ppl-st--next"><span class="ppl-st-k">Balance</span><span class="ppl-st-v">' + fmtMoney(p.owed) + '</span><i class="ppl-st-s">Next to collect</i></li>' : "");
    const contract = p.contract ?? p.total;
    const sum = fmtMoney(contract) + " · " + (insts.length || 1) + (insts.length === 1 ? " payment" : " payments");
    let side = "";
    if (state === "plan") {
      side = '<span class="ppl-note">' + esc((p.clientId ? "Billed after " + p.client.split(/\s+/)[0] + " accepts" : "Billed after the client accepts")) + "</span>";
    } else if (state === "paid") {
      side = '<span class="ppl-note ppl-note--ok"><svg class="ic"><use href="#i-check"/></svg>Paid in full</span>';
    } else {
      // Billing is the office's: a sales rep or an estimator reads what is left instead of the buttons.
      side = p.canBill === false ? '<span class="ppl-note"><b>' + fmtMoney(p.owed) + "</b> left to collect</span>" : payActsHtml(p, next);
    }
    return (
      '<tr class="prow-pay ppl--' + state + chain.replace(/prow--/g, "prow-pay--") + '" data-id="' + esc(p.id) + '"' +
      (chain && p.projectId ? ' data-grp="' + esc(p.projectId) + '"' : "") +
      '><td colspan="6"><div class="ppl">' +
      '<div class="ppl-head"><div class="ppl-title"><span class="ppl-lbl"><svg class="ic"><use href="#i-card"/></svg>Payments</span>' +
      // Signed: paid, the bar, due and the total — the accepted card's line (owner, 2026-10-28).
      (state === "plan" ? '<span class="ppl-sum">' + sum + "</span>" : payBarHtml(p, true)) +
      "</div></div>" +
      '<div class="ppl-body">' +
      (stages ? '<ol class="ppl-stages">' + stages + "</ol>" : "") +
      '<div class="ppl-side">' + side + finHtml(p) + "</div>" +
      "</div>" +
      "</div></td></tr>"
    );
  }
  /** Wisetack financing (2026-10-28): where the client's loan stands, and Send financing link for the office. */
  function finHtml(p: ProposalRow): string {
    const f = p.fin;
    if (!f || (!f.line && !f.canSend)) return "";
    return (
      '<div class="ppl-fin" data-fin-row>' +
      (f.line ? '<span class="ppl-note"><svg class="ic"><use href="#i-bank"/></svg>' + esc(f.line) + "</span>" : "") +
      (f.canSend ? '<button class="ppl-act" type="button" data-act="fin-send" title="Text or email the client the proposal, opened at Pay over time"><svg class="ic"><use href="#i-send"/></svg>Send financing link</button>' : "") +
      "</div>"
    );
  }
  /** The next stage's three actions, or the whole balance's when the job has no schedule. */
  function payActsHtml(p: ProposalRow, next: Installment | null): string {
    const inst = next ? ' data-inst="' + esc(next.id) + '"' : "";
    const what = next ? next.label + " · " + fmtMoney(instDollars(p, next)) : "the balance · " + fmtMoney(p.owed);
    const busy = next?.status === "PENDING";
    return (
      '<span class="ppl-acts">' +
      (next
        ? '<button class="ppl-act ppl-act--paid" type="button" data-act="markpaid"' + inst + (busy ? " disabled" : "") + ' title="' + esc("Record " + what + " as paid by hand") + '"><svg class="ic"><use href="#i-check"/></svg>Mark paid</button>'
        : '<button class="ppl-act ppl-act--paid" type="button" data-act="paidfull" title="' + esc("Record " + what + " as paid by hand") + '"><svg class="ic"><use href="#i-check"/></svg>Mark paid</button>') +
      '<button class="ppl-act ppl-act--inv" type="button" data-act="invoice"' + inst + (busy ? " disabled" : "") + ' title="' + esc("Invoice " + what + " — card, bank or the client's choice") + '"><svg class="ic"><use href="#i-send"/></svg>' + (next?.invoiced ? "Invoice again" : "Send invoice") + "</button>" +
      '<button class="ppl-act ppl-act--rem" type="button" data-act="remind"' + inst + (p.clientEmail ? "" : " disabled") + ' title="' + esc(p.clientEmail ? "Email " + p.clientEmail + " a reminder for " + what : "No email on the client record") + '"><svg class="ic"><use href="#i-bell"/></svg>Remind</button>' +
      "</span>"
    );
  }

  /**
   * THE PROPOSAL'S ACTION BAR (owner, 2026-10-28: "a lower section divided by a bold line with all the action
   * buttons from the 3 dots — all buttons in that lower action bar"). The row keeps what the proposal IS; this bar,
   * the card's last line, keeps everything that can be done to it: send, open, the client's view, the client's link,
   * a change order, the listing, and — apart, at the far end — delete. Billing lives in the payments above it.
   */
  function barRowHtml(p: ProposalRow, chain: string): string {
    const s = sendState(p);
    const send =
      s === "none"
        ? '<button class="pbar-btn" type="button" data-act="send" title="' + esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client") + '"><svg class="ic"><use href="#i-send"/></svg>Send to client</button>'
        : sendCellHtml(p).replace(/class="pact /g, 'class="pbar-btn pact ');
    const zillow = p.zillow
      ? '<a class="pbar-btn" href="' + esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing"><svg class="ic"><use href="#i-building"/></svg>Zillow</a>'
      : "";
    return (
      '<tr class="prow-bar' + chain.replace(/prow--/g, "prow-bar--") + '" data-id="' + esc(p.id) + '"' +
      (chain && p.projectId ? ' data-grp="' + esc(p.projectId) + '"' : "") +
      '><td colspan="6"><div class="pbar">' +
      '<div class="pbar-l">' +
      '<a class="pbar-btn pbar-btn--open" href="' + proposalHref(p.id) + '" title="Open the proposal"><svg class="ic"><use href="#i-pen"/></svg>Open</a>' +
      send +
      '<a class="pbar-btn pbar-btn--view" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab"><svg class="ic"><use href="#i-eye"/></svg>Client view</a>' +
      '<button class="pbar-btn" type="button" data-act="change-order" title="Price extras, send for signature"><svg class="ic"><use href="#i-plus"/></svg>' + (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") + "</button>" +
      zillow +
      '<button class="pbar-btn" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text"><svg class="ic"><use href="#i-link"/></svg>Copy client link</button>' +
      "</div>" +
      '<button class="pbar-btn pbar-btn--del" type="button" data-act="del" title="Delete this proposal — permanent"><svg class="ic"><use href="#i-trash"/></svg>Delete</button>' +
      "</div></td></tr>" +
      '<tr class="prow-gap" data-id="' + esc(p.id) + '" aria-hidden="true"><td colspan="6"></td></tr>'
    );
  }

  /** The rows the ALL table is currently showing, with the page clamped. */
  function allSlice() {
    const rows = chained(filteredAll());
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_ALL));
    if (pstate.pageAll > pages) pstate.pageAll = pages;
    return { rows, pages, slice: rows.slice((pstate.pageAll - 1) * PAGE_ALL, pstate.pageAll * PAGE_ALL) };
  }
  function allRowHtml(p: ProposalRow, chain = "") {
    return renderCardC(p, chain, cardKit);
  }
  function classicRowHtml(p: ProposalRow, chain = "") {
    const st = statusPlate(p.status);
    const pay = payRowHtml(p, chain);
    return (
      '<tr class="prow' +
      chain +
      (pay ? " has-pay" : " no-pay") +
      '" data-id="' +
      esc(p.id) +
      '"' +
      (chain && p.projectId ? ' data-grp="' + esc(p.projectId) + '"' : "") +
      ">" +
      // The title is a real link to the proposal (⌘-click opens a tab); a
      // click anywhere else on the row follows it too — see openFromRow.
      // Each card carries its own column labels (owner, 2026-10-28: "attached to every card").
      '<td><span class="pt-lbl">Proposal</span>' +
      kindHtml(p) +
      '<a class="pt-title pt-link" href="' +
      proposalHref(p.id) +
      '">' +
      esc(p.title) +
      '</a><div class="pt-sub">' +
      esc(subLine(p)) +
      // A proposal alone in view from its project names it; a chained one has
      // the header above it to say so.
      (p.projectId && !chain
        ? ' · <a class="pt-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + esc(p.projectName ?? "Project") + "</a>"
        : "") +
      (p.co && p.co.count
        ? ' · <span class="pt-co' + (p.co.pending ? " pt-co--wait" : "") + '">' + p.co.count + " change order" + (p.co.count === 1 ? "" : "s") + (p.co.pending ? " · " + p.co.pending + " awaiting approval" : "") + "</span>"
        : "") +
      "</div>" +
      clientDesignHtml(p) +
      "</td>" +
      '<td><span class="pt-lbl">Status</span><span class="pstatus ' +
      st.cls +
      (p.fresh && bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined) ? " pstatus--fresh" : "") +
      '"' +
      (p.fresh && p.fresh.accepted ? ' title="Accepted ' + esc(p.accepted ?? "") + '"' : p.fresh && p.fresh.declined ? ' title="Declined"' : "") +
      ">" +
      esc(st.label) +
      // The day it was signed rides on the badge (owner, 2026-10-28: "add the date to the badge itself").
      (p.accepted && (p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID") ? '<em class="pstatus-d">' + esc(p.accepted) + "</em>" : "") +
      "</span></td>" +
      '<td class="c pt-total"><span class="pt-lbl">Total</span><span class="pt-money">' +
      fmtMoney(p.contract ?? p.total) +
      "</span>" +
      (p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID" ? paidCellHtml(p) : "") +
      "</td>" +
      '<td class="c"><span class="pt-lbl">Views</span>' + viewsCellHtml(p) + '</td>' +
      '<td><span class="pt-lbl">Updated</span><span class="pt-mono">' + esc(p.updated) + '</span></td>' +
      // The member's mark — name, role and their color (lib/team/who); the
      // given-name plate only when the owner is no longer on the org. Nothing
      // on the reader's own proposals (owner, 2026-09-25): the column names
      // someone else, and hides itself when every proposal is the reader's.
      '<td class="td-owner"><span class="pt-lbl">Owner</span>' +
      (p.mine ? "" : p.ownerWho ? whoHtml(p.ownerWho) : '<span class="pt-mono">' + esc(p.owner) + "</span>") +
      "</td>" +
      "</tr>" +
      pay +
      barRowHtml(p, chain)
    );
  }
  /** A stamp blooms ONCE in this browser (2026-10-13): the render that shows it records it a moment later, so
   *  the next one (a later visit; in development, StrictMode's second mount) draws it calm — and a mount torn
   *  down inside that moment still blooms, because the memory of it lives at module scope, outside this init.
   *  Cosmetic: no storage means it blooms every time, never that it fails to. */
  function bloomOnce(id: string, kind: string, at: string | undefined): boolean {
    if (!at) return false;
    const key = id + ":" + kind + ":" + at;
    if (bloomedNow.has(key)) return true;
    try {
      if ((JSON.parse(localStorage.getItem(BLOOM_KEY) ?? "[]") as string[]).includes(key)) return false;
    } catch {
      /* no storage: it blooms */
    }
    bloomedNow.add(key);
    setTimeout(() => {
      try {
        const seen = JSON.parse(localStorage.getItem(BLOOM_KEY) ?? "[]") as string[];
        if (!seen.includes(key)) localStorage.setItem(BLOOM_KEY, JSON.stringify([key, ...seen].slice(0, 200)));
      } catch {
        /* no storage */
      }
    }, 1500);
    return true;
  }
  /** The client's deck design on this proposal (2026-10-13): where it stands, and Open when it came back. Blooms unopened. */
  function clientDesignHtml(p: ProposalRow): string {
    const cd = p.clientDesign;
    if (!cd) return "";
    const open = cd.draftId ? '/dashboard/deck-estimator?draft=' + encodeURIComponent(cd.draftId) : "";
    const tone = cd.standing === "returned" ? (cd.unseen ? " pt-cd--new" : " pt-cd--back") : cd.standing === "designing" || cd.standing === "opened" ? " pt-cd--live" : "";
    return (
      '<div class="pt-cd' + tone + '" data-client-design="' + cd.standing + (cd.unseen ? "-new" : "") + '">' +
      '<svg class="ic"><use href="#i-deck"/></svg>' +
      '<span>' + esc(cd.line) + "</span>" +
      (open ? '<a class="pt-cd-open" href="' + open + '">' + (cd.unseen ? "Open the design" : "Open design") + "</a>" : "") +
      "</div>"
    );
  }
  /** Chrome only — pager + empty state. Never touches the tbody, so it is safe
   *  to call from inside a leaveRow commit. */
  function syncAllChrome() {
    const { rows, pages } = allSlice();
    $("#allCard")?.classList.toggle("is-hidden", rows.length === 0);
    // The Owner column names someone ELSE; when every proposal in the book is
    // the reader's own it has nothing to say and folds away.
    $("#allCard .ptable")?.classList.toggle("is-solo", !book().some((p) => !p.mine));
    const empty = $("#allEmpty");
    empty?.classList.toggle("is-hidden", rows.length !== 0);
    // An empty BOOK and an empty FILTER are different situations and the copy
    // has to say which — "no match" on a brand new org reads as a broken page.
    if (empty && rows.length === 0) {
      empty.textContent = book().length
        ? "No proposals match this filter"
        : "No proposals yet — start one with Manual proposal above";
    }
    renderPager($("#allPager"), pstate.pageAll, pages, "all");
  }
  function renderAll(stagger = false) {
    const body = $("#propTableBody");
    if (!body) return;
    const { rows, slice } = allSlice();
    const chains = chainsOf(rows);
    const start = (pstate.pageAll - 1) * PAGE_ALL;
    let html = "";
    slice.forEach((p, i) => {
      const c = p.projectId ? chains.get(p.projectId) : undefined;
      if (!c || c.count < 2) {
        html += allRowHtml(p);
        return;
      }
      const at = start + i;
      const prev = rows[at - 1];
      const next = rows[at + 1];
      const firstInChain = !prev || prev.projectId !== p.projectId;
      const lastInChain = !next || next.projectId !== p.projectId;
      // A header opens the chain, and opens it again at the top of a page that
      // starts in the middle of one.
      if (i === 0 || firstInChain) html += chainHeadHtml(c, i === 0 && !firstInChain);
      html += allRowHtml(p, " prow--chain" + (lastInChain ? " prow--chain-end" : ""));
    });
    body.innerHTML = html;
    syncAllChrome();
    if (stagger && panelVisible("all")) {
      staggerIn(Array.from(body.querySelectorAll<HTMLElement>(".prow, .prow-pay, .prow-bar")));
    }
  }
  function accSlice() {
    const rows = listAccepted();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_ACC));
    if (pstate.pageAcc > pages) pstate.pageAcc = pages;
    return { rows, pages, slice: rows.slice((pstate.pageAcc - 1) * PAGE_ACC, pstate.pageAcc * PAGE_ACC) };
  }
  function syncAccChrome() {
    const { rows, pages } = accSlice();
    $("#accEmpty")?.classList.toggle("is-hidden", rows.length !== 0);
    renderPager($("#accPager"), pstate.pageAcc, pages, "acc");
  }
  function acceptedCardHtml(p: ProposalRow) {
    const insts = p.inst || [];
    // Payments: 1–5 items — columns; 6+ — a row table with dividers
    let payBlock = "";
    if (insts.length > 5) {
      payBlock =
        '<table class="psched psched--div"><tbody>' +
        insts
          .map(
            (inst) =>
              "<tr>" +
              '<td class="psched-label">' +
              esc(inst.label) +
              "</td>" +
              '<td><span class="pt-mono">' +
              (inst.due ? "due " + esc(inst.due) : "no due date") +
              "</span></td>" +
              '<td class="td-price"><span class="pt-money">' +
              fmtMoney(instDollars(p, inst)) +
              "</span></td>" +
              // Real: Mark paid records a manual payment (bank / cash / check);
              // Remind mails the client this instalment's reminder.
              '<td class="td-remind pinst-acts">' +
              instCellActions(p, inst) +
              "</td>" +
              "</tr>",
          )
          .join("") +
        "</tbody></table>";
    } else if (insts.length) {
      payBlock =
        '<div class="pcols">' +
        insts
          .map((inst) => {
            const sub =
              inst.status === "PAID"
                ? "Paid"
                : inst.pct
                  ? inst.amount + "% of total"
                  : inst.due
                    ? "due " + esc(inst.due)
                    : "";
            return (
              '<div class="pcol' +
              (inst.status === "PAID" ? " pcol--paid" : "") +
              '"><div class="kpi-lbl">' +
              esc(inst.label) +
              "</div>" +
              '<div class="pcol-val">' +
              fmtMoney(instDollars(p, inst)) +
              "</div>" +
              (sub ? '<div class="pcol-sub">' + sub + "</div>" : "") +
              '<div class="pinst-acts">' +
              instCellActions(p, inst) +
              "</div>" +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    }
    return (
      '<div class="pjob" data-id="' +
      esc(p.id) +
      '">' +
      '<div class="pjob-head">' +
      "<div>" +
      kindHtml(p) +
      '<a class="pjob-title pt-link" href="' +
      proposalHref(p.id) +
      '">' +
      esc(p.title) +
      "</a>" +
      '<div class="pjob-sub">' +
      esc(subLine(p)) +
      (p.projectId ? ' · <a class="pt-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + esc(p.projectName ?? "Project") + "</a>" : "") +
      (p.accepted ? " · accepted " + esc(p.accepted) : "") +
      "</div></div>" +
      '<div class="pjob-total"><span class="pt-mono">Contract value</span><span class="pt-money">' +
      fmtMoney(p.contract ?? p.total) +
      "</span>" +
      (p.co && p.co.approvedTotal
        ? '<span class="pt-mono pjob-total-sub">' + fmtMoney(p.total) + " + " + fmtMoney(p.co.approvedTotal) + " in changes</span>"
        : "") +
      payBarHtml(p) +
      "</div>" +
      "</div>" +
      payStripHtml(p, (p.co && p.co.count ? '<div class="pjob-cos">' + coChipHtml(p) + "</div>" : "") + payBlock) +
      '<div class="pjob-foot">' +
      '<div class="pjob-foot-l">' +
      // Real: the scheduling surface. An anchor, not a handler, so ⌘-click and
      // "open in new tab" behave — the same shape the Pressroom edition uses.
      '<a class="btn btn-ghost btn--sm" href="/dashboard/calendar"><svg class="ic"><use href="#i-cal"/></svg>Schedule</a>' +
      // Real (2026-09-13): invoice the outstanding balance on a chosen rail —
      // card, bank transfer, or the client's choice (the invoice dialog).
      '<button class="btn btn--accent btn--sm" type="button" data-act="invoice"' +
      (p.owed > 0 ? "" : " disabled") +
      '><svg class="ic"><use href="#i-send"/></svg>Send invoice</button>' +
      // Real (2026-09-13): this proposal's automatic reminders — on / off /
      // the company's mode (Settings → Payments). Cycles on click.
      '<button class="btn btn-ghost btn--sm" type="button" data-act="reminders" title="Automatic payment reminders for this proposal">' +
      (p.remindersOn === true ? "Auto-remind · on" : p.remindersOn === false ? "Auto-remind · off" : "Auto-remind · company") +
      "</button>" +
      // Real (2026-09-13): the change-order sheet — plywood found on tear-off
      // day, priced and sent for the client's signature from this card.
      '<button class="btn btn-ghost btn--sm" type="button" data-act="change-order"><svg class="ic"><use href="#i-plus"/></svg>' +
      (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") +
      "</button>" +
      // Real: the client-facing page for this proposal.
      '<a class="btn btn-ghost btn--sm" href="/portal/q/' +
      encodeURIComponent(p.publicId) +
      '" target="_blank" rel="noopener noreferrer"><svg class="ic"><use href="#i-ext"/></svg>View public</a>' +
      // Owner (2026-09-24): the client's link, to paste into a text.
      '<button class="btn btn-ghost btn--sm" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text"><svg class="ic"><use href="#i-link"/></svg>Copy client link</button>' +
      "</div>" +
      '<div class="pjob-foot-r">' +
      '<button class="btn btn-ghost btn--sm" type="button" data-act="unaccept"><svg class="ic"><use href="#i-undo"/></svg>Un-accept</button>' +
      '<button class="btn btn-primary btn--sm" type="button" data-act="done"><svg class="ic"><use href="#i-check"/></svg>Mark completed</button>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }
  function renderAccepted(stagger = false) {
    const stack = $("#propStack");
    if (!stack) return;
    const { slice } = accSlice();
    stack.innerHTML = slice.map(acceptedCardHtml).join("");
    syncAccChrome();
    if (stagger && panelVisible("accepted")) {
      staggerIn(Array.from(stack.querySelectorAll<HTMLElement>(".pjob")));
    }
  }
  function doneSlice() {
    const rows = listDone();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_DONE));
    if (pstate.pageDone > pages) pstate.pageDone = pages;
    return { rows, pages, slice: rows.slice((pstate.pageDone - 1) * PAGE_DONE, pstate.pageDone * PAGE_DONE) };
  }
  function syncDoneChrome() {
    const { rows, pages } = doneSlice();
    $("#doneEmpty")?.classList.toggle("is-hidden", rows.length !== 0);
    renderPager($("#donePager"), pstate.pageDone, pages, "done");
  }
  /** A dashed drop box per slot, showing what is already on the record. The
   *  input is a real <input type="file">, so the click opens the picker and the
   *  change handler uploads through uploadProposalPhoto(). */
  function photoBoxHtml(p: ProposalRow, slot: "before" | "after") {
    const shots = slot === "before" ? p.before : p.after;
    const last = shots[shots.length - 1];
    const label = slot === "before" ? "Before" : "After";
    return (
      '<div><div class="kpi-lbl">' +
      label +
      '</div><label class="photo-box' +
      (last ? " photo-box--filled" : "") +
      '">' +
      (last
        ? '<img src="' + esc(last.url) + '" alt="' + esc(label + " photo") + '">'
        : '<svg class="ic"><use href="#i-imgadd"/></svg>Add ' + label.toLowerCase()) +
      '<input type="file" accept="image/*" hidden data-photo="' +
      slot +
      '"></label></div>'
    );
  }

  function doneCardHtml(p: ProposalRow) {
    const insts = p.inst || [];
    // The donor invented a deposit (30% of the total) when a proposal had no
    // payment schedule. A proposal with no instalments genuinely has no
    // deposit on record, so print the em dash rather than a plausible number.
    const dep = insts.length ? fmtMoney(instDollars(p, insts[0])) : "—";
    const checks = insts
      .map(
        (inst) =>
          '<div class="pchk"><span class="pchk-ic"><svg class="ic"><use href="#i-check"/></svg></span>' +
          '<span class="pchk-lbl">' +
          esc(inst.label) +
          '</span><span class="pchk-lead"></span>' +
          '<span class="pt-money">' +
          fmtMoney(instDollars(p, inst)) +
          "</span></div>",
      )
      .join("");
    return (
      '<div class="psheet" data-id="' +
      esc(p.id) +
      '">' +
      '<div class="psheet-head">' +
      "<div>" +
      kindHtml(p) +
      '<a class="pjob-title pt-link" href="' +
      proposalHref(p.id) +
      '">' +
      esc(p.title) +
      "</a>" +
      '<div class="pjob-sub">' +
      esc(subLine(p)) +
      (p.projectId ? ' · <a class="pt-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + esc(p.projectName ?? "Project") + "</a>" : "") +
      "</div></div>" +
      '<div class="pjob-total psheet-total"><span class="psheet-banklbl">Banked</span><span class="pt-money banked big">' +
      fmtMoney(p.paidAmt ?? 0) +
      "</span>" +
      payBarHtml(p) +
      "</div>" +
      "</div>" +
      payStripHtml(
        p,
        (p.co && p.co.count ? '<div class="pjob-cos">' + coChipHtml(p) + "</div>" : "") +
          '<div class="pcols pcols--sheet">' +
          '<div class="pcol"><div class="kpi-lbl">Deposit</div><div class="pcol-val">' +
          dep +
          '</div><div class="pcol-sub">' +
          (insts.length ? "Locked in" : "No payment schedule") +
          "</div></div>" +
          '<div class="pcol"><div class="kpi-lbl">Start</div><div class="pcol-val">' +
          esc(p.accepted || "—") +
          '</div><div class="pcol-sub">Work began</div></div>' +
          '<div class="pcol"><div class="kpi-lbl">Completed</div><div class="pcol-val' +
          (p.owed > 0 ? "" : " good") +
          '">' +
          esc(p.paid || "—") +
          '</div><div class="pcol-sub">' +
          (p.owed > 0 ? "Payment outstanding" : "Paid in full") +
          "</div></div>" +
          "</div>",
      ) +
      '<div class="psheet-body">' +
      '<div class="psheet-check">' +
      checks +
      "</div>" +
      '<div class="psheet-photos">' +
      photoBoxHtml(p, "before") +
      photoBoxHtml(p, "after") +
      "</div>" +
      "</div>" +
      '<div class="psheet-foot">' +
      '<div class="psheet-foot-l">' +

      // The donor's "Send paid receipt to <email>" box was decoration: there is
      // no receipt transport in the app (no builder in lib/email/build, no
      // action), so the input and its Send button were removed rather than left
      // pretending to mail something. The proposal PDF — the document a paid
      // client actually asks for — is a real route, so that is what ships here.

      '<a class="btn btn-ghost btn--sm" href="/api/proposals/' +
      encodeURIComponent(p.id) +
      '/pdf" target="_blank" rel="noopener noreferrer"><svg class="ic"><use href="#i-download"/></svg>Download PDF</a>' +

      '<button class="btn btn-ghost btn--sm" type="button" data-act="invoice"' +
      (p.owed > 0 ? "" : " disabled") +
      '><svg class="ic"><use href="#i-send"/></svg>Send invoice</button>' +
      '<button class="btn btn-ghost btn--sm" type="button" data-act="change-order"><svg class="ic"><use href="#i-plus"/></svg>' +
      (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") +
      "</button>" +
      '</div><div class="psheet-foot-r">' +
      '<button class="btn btn-ghost btn--sm" type="button" data-act="unmark"><svg class="ic"><use href="#i-undo"/></svg>Reopen job</button>' +
      (p.owed > 0
        ? '<button class="btn btn-primary btn--sm" type="button" data-act="paidfull" title="Record the whole balance as paid by hand (bank, cash, check)"><svg class="ic"><use href="#i-check"/></svg>Mark paid in full</button>'
        : "") +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }
  function renderDone(stagger = false) {
    const stack = $("#doneStack");
    if (!stack) return;
    const { slice } = doneSlice();
    stack.innerHTML = slice.map(doneCardHtml).join("");
    syncDoneChrome();
    if (stagger && panelVisible("completed")) {
      staggerIn(Array.from(stack.querySelectorAll<HTMLElement>(".psheet")));
    }
  }
  function renderProposals(stagger = false) {
    renderKinds();
    renderKpis();
    renderTabCounts();
    renderChipCounts();
    renderAll(stagger);
    renderAccepted(stagger);
    renderDone(stagger);
  }

  /**
   * One record changed. Repaint the counts and the two lists the user was NOT
   * looking at (silently — they are behind a hidden panel), and leave the acted
   * list to its caller, which patches or removes exactly one node.
   */
  function repaintExcept(acted: "all" | "acc" | "done") {
    renderKinds();
    renderKpis();
    renderTabCounts();
    renderChipCounts();
    if (acted !== "all") renderAll();
    if (acted !== "acc") renderAccepted();
    if (acted !== "done") renderDone();
  }

  /** A row's payment line, the <tr> under it, or null. */
  function payRowOf(tr: HTMLElement): HTMLElement | null {
    const next = tr.nextElementSibling as HTMLElement | null;
    return next && next.classList.contains("prow-pay") ? next : null;
  }
  /** Every row after a proposal's own that belongs to it: its payments, its action bar, the gap under the card. */
  function tailRowsOf(tr: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    let n = tr.nextElementSibling as HTMLElement | null;
    while (n && n.dataset.id === tr.dataset.id && /\bprow-(pay|bar|gap)\b/.test(n.className)) {
      out.push(n);
      n = n.nextElementSibling as HTMLElement | null;
    }
    return out;
  }
  /** Patch a single ALL row in place: the row and its payment line are rebuilt from the record, since a write
   *  can change the plate, the money, the Send cell and every stage (2026-10-23). Unchained rows only — a
   *  chained one redraws the table with its project's header. */
  function patchAllRow(tr: HTMLElement, p: ProposalRow) {
    const t = document.createElement("tbody");
    t.innerHTML = allRowHtml(p);
    tailRowsOf(tr).forEach((r) => r.remove());
    tr.replaceWith(...Array.from(t.children));
  }

  /**
   * The one case a single-row exit cannot fix by itself: the row that left was
   * the last one on its page, so the reader is looking at an empty table with
   * records still in the book. Scheduled AFTER the exit (leave 180 + close 260)
   * so it never replaces the nodes the FLIP is still moving. A whole new page
   * of records genuinely arriving is one of the few things that earns a stagger.
   */
  function healAllPage() {
    after(460, () => {
      const body = $("#propTableBody");
      if (!body) return;
      const { slice } = allSlice();
      if (body.querySelectorAll(".prow").length === 0 && slice.length > 0) renderAll(true);
    });
  }
  /** Same repair for the two card stacks. */
  function healStack(kind: "acc" | "done") {
    after(460, () => {
      if (kind === "acc") {
        const stack = $("#propStack");
        if (stack && stack.querySelectorAll(".pjob").length === 0 && accSlice().slice.length > 0) {
          renderAccepted(true);
        }
        return;
      }
      const stack = $("#doneStack");
      if (stack && stack.querySelectorAll(".psheet").length === 0 && doneSlice().slice.length > 0) {
        renderDone(true);
      }
    });
  }

  /**
   * Reflect a change to one record in the ALL table.
   * - still on this page  → patch that row's cells, nothing else moves;
   * - no longer on it     → that row alone leaves through leaveRow;
   * - not currently drawn → a silent repaint (nothing on screen animates).
   */
  function syncAllAfterChange(id: string) {
    const body = $("#propTableBody");
    const tr = findRow(body, id);
    const onPage = allSlice().slice.some((p) => p.id === id);
    // A chained row carries its project's header totals with it: redraw the
    // table silently rather than patch one row around a stale header.
    if (tr && tr.dataset.grp) {
      renderAll();
      repaintExcept("all");
      return;
    }
    if (tr && !onPage) {
      tailRowsOf(tr).forEach((r) => r.remove());
      leaveRow(
        tr,
        () => {
          syncAllChrome();
          repaintExcept("all");
          healAllPage();
        },
        after,
        { leaveClass: "is-leaving" },
      );
      return;
    }
    if (tr) {
      const p = byId(id);
      if (p) patchAllRow(tr, p);
      syncAllChrome();
      repaintExcept("all");
      return;
    }
    renderAll();
    repaintExcept("all");
  }

  // ================= PROPOSALS: ROW CONTEXT MENU =================
  const pMenu = $("#pMenu");
  type MenuOpts = { href?: string; blank?: boolean; dis?: boolean; danger?: boolean };
  function menuItem(
    icon: string,
    tone: string,
    t: string,
    sub: string,
    act: string,
    opts: MenuOpts = {},
  ) {
    const cls =
      "pmenu-item" + (opts.dis ? " is-disabled" : "") + (opts.danger ? " is-danger" : "");
    const inner =
      '<span class="pmi-ic' +
      (tone ? " " + tone : "") +
      '"><svg class="ic"><use href="#' +
      icon +
      '"/></svg></span>' +
      '<span><span class="pmenu-item-t">' +
      t +
      '</span><span class="pmenu-item-s" style="display:block">' +
      sub +
      "</span></span>";
    // Navigations are real links: middle-click, ⌘-click and "copy link
    // address" all work, and they need no JavaScript to do their job.
    if (opts.href && !opts.dis) {
      return (
        '<a class="' +
        cls +
        '" href="' +
        opts.href +
        '" data-mact="' +
        act +
        '"' +
        (opts.blank ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        inner +
        "</a>"
      );
    }
    return (
      '<button class="' +
      cls +
      '" type="button" data-mact="' +
      act +
      '"' +
      (opts.dis ? " disabled" : "") +
      ">" +
      inner +
      "</button>"
    );
  }
  /** Where a proposal opens: the editor, for any status (the menu's Edit proposal). */
  function proposalHref(id: string) {
    return "/dashboard/proposals/" + encodeURIComponent(id);
  }
  /**
   * A click on a proposal row, or on the header of an accepted or completed
   * card, opens the proposal (owner, 2026-09-14: "when I click the proposal
   * line, open the proposal"). Buttons, links, inputs and a text selection
   * keep their own behavior; ⌘ / Ctrl-click opens a new tab like the link.
   */
  function openFromRow(e: MouseEvent, target: HTMLElement): boolean {
    const host = target.closest<HTMLElement>(".prow, .prow-pay, .pjob-head, .psheet-head");
    if (!host) return false;
    if (target.closest("a, button, input, select, textarea, label, [data-act], [data-menu]")) return false;
    if ((window.getSelection()?.toString() ?? "").length > 0) return false;
    const id = host.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!id || !byId(id)) return false;
    const href = proposalHref(id);
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
    else window.location.assign(href);
    return true;
  }

  function openMenu(id: string, btn: HTMLElement) {
    const p = byId(id);
    if (!p || !pMenu) return;
    pstate.menuId = id;
    pstate.menuBtn = btn;
    // Grouped the way the job goes (owner, 2026-09-25: "in order more
    // logically, and change colors so they are different"): open it, share it
    // with the client, bill it, the rest — one hue per group, the group's
    // main action a solid plate. Order materials left the menu that day; the
    // accepted card's Materials chip still opens the sheet.
    const accepted = p.status === "ACCEPTED" || p.status === "COMPLETED";
    const settled = (p.contract ?? p.total) > 0 && p.owed <= 0 && (accepted || p.status === "PAID");
    const canInvoice = p.owed > 0 && accepted;
    const invoiceSub = canInvoice
      ? fmtMoney(p.owed) + " due · card, bank or the client's choice"
      : settled
        ? "Paid in full — nothing to bill"
        : accepted || p.status === "PAID"
          ? "Nothing owed"
          : "After the client accepts";
    pMenu.innerHTML =
      '<div class="pmenu-head"><div class="pmenu-title">' +
      esc(p.title) +
      '</div><div class="pmenu-sub">' +
      esc(subLine(p)) +
      "</div></div>" +
      // Open and Client view sit on the row itself (2026-10-13); the menu keeps the rarer actions.
      '<div class="pmenu-grp">Share with client</div>' +
      menuItem(
        "i-send",
        "pmi--ok-solid",
        "Send to client",
        p.clientEmail ? esc(p.clientEmail) : p.clientId ? "No email yet — add it when you send" : "No client yet — add them when you send",
        "sendto",
      ) +
      // The client's link, copied or handed to the phone's own messages (2026-09-24).
      menuItem("i-link", "pmi--ok", "Copy client link", "Paste it into a text", "copylink") +
      '<div class="pmenu-grp">Billing</div>' +
      menuItem("i-send", "pmi--warn-solid", "Send invoice", invoiceSub, "invoice", { dis: !canInvoice }) +
      menuItem("i-plus", "pmi--warn", "Change order", "Price extras, send for signature", "change-order") +
      '<div class="pmenu-grp">More</div>' +
      menuItem(
        "i-building",
        "pmi--ink",
        "View on Zillow",
        p.zillow ? "Open listing" : "No address on client",
        "zillow",
        { href: p.zillow ?? undefined, blank: true, dis: !p.zillow },
      ) +
      '<div class="pmenu-div"></div>' +
      menuItem("i-trash", "pmi--danger", "Delete proposal", "Permanent", "del", { danger: true });
    pMenu.classList.add("open");
    // FLUID SCALE zoom lives on the SHELL ROOT (.jf-blueprint), not on this
    // page's `.content` column and not on documentElement — so reading it off
    // `root` here always parsed "" to NaN and fell through to 1. At any window
    // other than the ~1728px reference the menu was then laid out in the wrong
    // unit system: on a wide screen (zoom up to 1.35) it painted 254 × zoom
    // wide while the clamp still believed 254, and ran off the right edge of
    // the viewport with the client's email clipped in half.
    const z = currentZoom(btn);
    const vw = window.innerWidth / z,
      vh = window.innerHeight / z;
    // getBoundingClientRect reports ZOOMED pixels; `left`/`top` are written
    // back into the zoomed subtree, which measures in unzoomed ones. Every
    // measurement crossing that boundary has to be divided by z.
    const r = btn.getBoundingClientRect();
    const rRight = r.right / z,
      rTop = r.top / z,
      rBottom = r.bottom / z;
    const mw = 254;
    let left = Math.min(rRight - mw, vw - mw - 12);
    left = Math.max(12, left);
    pMenu.style.left = left + "px";
    pMenu.style.top = "0px";
    // The menu has grown to nine rows (Send invoice, Change order, Order
    // materials, Zillow), ~600px tall, and on a short window it fit neither
    // below the button nor above it: the flip clamped to 12px, straight under
    // the sticky topbar (which sits in a higher stacking layer than this
    // menu), and the tail ran off the bottom. So: keep clear of the topbar,
    // take whichever side holds the whole menu, and when neither does cap the
    // height and let the menu scroll inside itself.
    pMenu.style.maxHeight = "";
    const mh = pMenu.offsetHeight;
    const bar = document.querySelector<HTMLElement>("header.topbar");
    const minTop = Math.max(12, (bar ? bar.getBoundingClientRect().bottom / z : 0) + 8);
    const maxBottom = vh - 12;
    const roomBelow = maxBottom - (rBottom + 6);
    const roomAbove = rTop - 6 - minTop;
    const column = maxBottom - minTop;
    let top: number;
    if (mh <= roomBelow) {
      top = rBottom + 6;
    } else if (mh <= roomAbove) {
      top = rTop - 6 - mh;
    } else if (mh <= column) {
      // Neither side holds it whole, but the window does: slide it along the
      // roomier side just far enough to fit, over the button's edge, rather
      // than hand the reader a scrollbar for the last few pixels.
      top = roomBelow >= roomAbove ? rBottom + 6 : rTop - 6 - mh;
      top = Math.min(Math.max(top, minTop), maxBottom - mh);
    } else {
      // Taller than the whole window: fill the column and scroll inside it.
      top = minTop;
      pMenu.style.maxHeight = Math.floor(column) + "px";
    }
    pMenu.style.top = top + "px";
  }
  function closeMenu() {
    pstate.menuId = null;
    pMenu?.classList.remove("open");
  }
  // `.main` lives in the SHELL and survives navigation, so this listener has to
  // be tracked — an untracked one would stack up a dead closure per visit.
  if (main) on(main, "scroll", closeMenu, { passive: true });

  // ================= DIALOGS =================
  function openDlg(id: string) {
    const el = $("#" + id);
    if (el) openMdl(el);
  }
  function closeDlg(id: string) {
    const el = $("#" + id);
    if (el) closeMdl(el, after);
  }
  function setDlgError(sel: string, msg: string | null) {
    const box = $(sel);
    if (!box) return;
    box.textContent = msg ?? "";
    box.classList.toggle("is-hidden", !msg);
  }
  /**
   * A card action carrying its own write. The clicked button's icon gives way
   * to a drawn square (the stylesheet draws its outline around — nothing
   * spins), its label turns present-participle, it goes inert, and its width
   * is pinned FIRST so the shorter label cannot narrow the bar under the
   * cursor. `busy = false` puts every one of those back.
   */
  function setActBusy(btn: HTMLElement | null, busy: boolean, busyLbl = "") {
    if (!btn || busy === btn.classList.contains("is-busy")) return;
    const b = btn as HTMLButtonElement;
    const label = Array.from(b.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (busy) {
      b.style.minWidth = b.offsetWidth + "px";
      if (label) {
        b.dataset.idleLbl = label.textContent ?? "";
        label.textContent = busyLbl;
      }
      const NS = "http://www.w3.org/2000/svg";
      const square = document.createElementNS(NS, "svg");
      square.setAttribute("class", "ic ic--busy");
      square.setAttribute("viewBox", "0 0 18 18");
      square.setAttribute("aria-hidden", "true");
      const outline = document.createElementNS(NS, "rect");
      outline.setAttribute("x", "4");
      outline.setAttribute("y", "4");
      outline.setAttribute("width", "10");
      outline.setAttribute("height", "10");
      square.append(outline);
      b.prepend(square);
      b.classList.add("is-busy");
      b.setAttribute("aria-busy", "true");
      b.disabled = true;
      return;
    }
    b.querySelector(".ic--busy")?.remove();
    if (label && b.dataset.idleLbl != null) label.textContent = b.dataset.idleLbl;
    delete b.dataset.idleLbl;
    b.classList.remove("is-busy");
    b.removeAttribute("aria-busy");
    b.disabled = false;
    b.style.minWidth = "";
  }
  /** Busy state on a dialog's confirm button — same shape as Workers. */
  function setSaving(btn: HTMLElement | null, busy: boolean, busyLbl: string, idleLbl: string) {
    if (!btn) return;
    pstate.writing = busy;
    btn.classList.toggle("is-busy", busy);
    (btn as HTMLButtonElement).disabled = busy;
    const lbl = btn.querySelector<HTMLElement>("[data-save-lbl]");
    if (lbl) lbl.textContent = busy ? busyLbl : idleLbl;
  }
  function showAlert(title: string, msg: string) {
    const t = $("#alertTitle");
    const b = $("#alertTxt");
    if (t) t.textContent = title;
    if (b) b.textContent = msg;
    openDlg("alertMdl");
  }

  // Materials sheet — the finished React component, mounted as an island over
  // its own empty host. Props flow in; the only thing coming back is onClose.
  let matIsland: Island<MaterialsSheetProps> | null = null;
  let matProps: MaterialsSheetProps = {
    open: false,
    onClose: closeMaterials,
    proposalTitle: "",
    clientName: "",
    items: [],
  };
  function closeMaterials() {
    matProps = { ...matProps, open: false };
    matIsland?.update(matProps);
  }
  function shoppable(p: ProposalRow) {
    return p.materials.filter((m) => (m.materialCost ?? 0) > 0 && m.quantity > 0);
  }
  function openMaterials(p: ProposalRow) {
    const host = $("#pMatHost");
    if (!host) return;
    if (shoppable(p).length === 0) {
      showAlert(
        "Nothing to order",
        `"${p.title}" has no line item with a material cost, so there is nothing to shop for. Add materials in the editor first.`,
      );
      return;
    }
    matProps = {
      open: true,
      onClose: closeMaterials,
      proposalTitle: p.title,
      clientName: p.client,
      items: p.materials,
    };
    if (!matIsland) matIsland = mountIsland(host, MaterialsSheet, matProps);
    else matIsland.update(matProps);
  }
  disposers.push(() => {
    matIsland?.destroy();
    matIsland = null;
  });

  // The change-order sheet, the same island pattern. Props flow in; the sheet
  // reports back only by closing and by router.refresh().
  let coIsland: Island<ChangeOrderSheetProps> | null = null;
  let coProps: ChangeOrderSheetProps = { open: false, onClose: closeChangeOrder };
  function closeChangeOrder() {
    coProps = { ...coProps, open: false };
    coIsland?.update(coProps);
  }
  function openChangeOrder(p: ProposalRow) {
    const host = $("#pCoHost");
    if (!host) return;
    coProps = { open: true, onClose: closeChangeOrder, proposalId: p.id };
    if (!coIsland) coIsland = mountIsland(host, ChangeOrderSheet, coProps);
    else coIsland.update(coProps);
  }
  disposers.push(() => {
    coIsland?.destroy();
    coIsland = null;
  });

  // ================= PROPOSALS: EVENTS =================
  /** The client's page on the clipboard; the button says Copied for a moment. */
  function copyClientLink(p: { publicId: string }, btn: HTMLElement | null) {
    const url = clientProposalUrl(p.publicId);
    const done = () => { if (btn) flashBtn(btn, "Copied"); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt("Copy the client's link:", url));
    else window.prompt("Copy the client's link:", url);
  }
  function flashBtn(btn: HTMLElement, label: string) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = "1";
    const old = btn.innerHTML;
    btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>' + label;
    btn.classList.add("is-flashed");
    after(1600, () => {
      btn.innerHTML = old;
      btn.classList.remove("is-flashed");
      delete btn.dataset.busy;
    });
  }
  $("#pTabs")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".ptab");
    if (!btn || btn.classList.contains("active")) return;
    pstate.tab = btn.dataset.tab || "all";
    root.querySelectorAll<HTMLElement>("#pTabs .ptab").forEach((t) => t.classList.toggle("active", t === btn));
    $$(".ppanel").forEach((pn) => pn.classList.toggle("is-hidden", pn.dataset.panel !== pstate.tab));
    // The statuses belong to the All list; Type sits on the tab row for every tab (owner, 2026-10-20).
    $("#pFilters")?.classList.toggle("is-hidden", pstate.tab !== "all");
    renderKpis();
    // A panel's rows arrive the first time it is actually on screen. Playing
    // the cascade earlier — while the panel is display:none — would leave every
    // row pinned at `transform: none`, which kills row hover for good.
    if (!pstate.revealed[pstate.tab]) {
      pstate.revealed[pstate.tab] = true;
      const stack =
        pstate.tab === "accepted" ? $("#propStack") : pstate.tab === "completed" ? $("#doneStack") : $("#propTableBody");
      if (stack) staggerIn(Array.from(stack.querySelectorAll<HTMLElement>(".prow, .prow-pay, .pjob, .psheet")));
    }
  });
  // Through `on` (2026-10-20): a raw listener outlived a re-mount (StrictMode's second mount in development),
  // and the two of them toggled the menu open and shut on one click.
  const kindsDd = $("#pKinds");
  if (kindsDd) on(kindsDd, "click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".flt-drop-btn")) {
      setKindsOpen(!$("#pKinds")?.classList.contains("open"));
      return;
    }
    const item = target.closest<HTMLElement>("[data-k]");
    if (!item) return;
    setKindsOpen(false);
    $<HTMLButtonElement>("#pKinds .flt-drop-btn")?.focus();
    const k = (item.dataset.k || "ALL") as "ALL" | WorkFamily;
    if (k === pstate.kind) return;
    pstate.kind = k;
    pstate.pageAll = 1;
    pstate.pageAcc = 1;
    pstate.pageDone = 1;
    // Narrowing by type is a repaint, not a list arriving — silently, every panel and figure at once.
    renderProposals();
  });
  // The Type menu closes on a click anywhere else and on Escape (focus back on its button).
  on(document, "pointerdown", (e) => {
    const dd = $("#pKinds");
    if (dd?.classList.contains("open") && !dd.contains(e.target as Node)) setKindsOpen(false);
  });
  on(document, "keydown", (e) => {
    const dd = $("#pKinds");
    if ((e as KeyboardEvent).key !== "Escape" || !dd?.classList.contains("open")) return;
    setKindsOpen(false);
    dd.querySelector<HTMLButtonElement>(".flt-drop-btn")?.focus();
  });
  $("#pChips")?.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-f]");
    if (!chip) return;
    pstate.filter = chip.dataset.f || "ALL";
    pstate.pageAll = 1;
    root.querySelectorAll<HTMLElement>("#pChips [data-f]").forEach((c) => c.classList.toggle("active", c === chip));
    // A filter toggle is NOT a list arriving — it repaints silently.
    renderAll();
  });

  on(document, "click", (e) => {
    const target = e.target as HTMLElement;

    // Dialog dismissals (scrim, ×, Cancel, the alert's Close).
    const dismiss = target.closest<HTMLElement>("[data-mdl]");
    if (dismiss) {
      if (pstate.writing) return; // never interrupt a write already on the wire
      const which = dismiss.dataset.mdl;
      if (which === "send") closeDlg("sendMdl");
      if (which === "del") closeDlg("delMdl");
      if (which === "inv") closeDlg("invMdl");
      if (which === "alert") closeDlg("alertMdl");
      return;
    }

    const menuBtn = target.closest<HTMLElement>("[data-menu]");
    if (menuBtn) {
      const id = String(menuBtn.dataset.menu);
      if (pstate.menuId === id) closeMenu();
      else openMenu(id, menuBtn);
      return;
    }
    const mact = target.closest<HTMLElement>("[data-mact]");
    if (mact) {
      const id = pstate.menuId;
      const p = byId(id);
      const act = mact.dataset.mact;
      if (mact.classList.contains("is-disabled")) {
        e.preventDefault();
        return;
      }
      // `edit`, `view` and `zillow` are real anchors — let the browser follow
      // them. Closing the menu is deferred past the end of this dispatch:
      // `display: none`-ing the anchor mid-click can cancel the navigation.
      if (act === "edit" || act === "view" || act === "zillow" || act === "textlink") {
        after(0, closeMenu);
        return;
      }
      closeMenu();
      if (!p || !id) return;
      if (act === "copylink") {
        copyClientLink(p, menuBtnFor(id));
        return;
      }
      if (pstate.writing) return;
      if (act === "dup") {
        void runDuplicate(p, menuBtnFor(id));
        return;
      }
      if (act === "sendto") {
        promptSend(p);
        return;
      }
      if (act === "materials") {
        openMaterials(p);
        return;
      }
      if (act === "change-order") {
        closeMenu();
        openChangeOrder(p);
        return;
      }
      if (act === "invoice") {
        closeMenu();
        promptInvoice(p, "");
        return;
      }
      if (act === "del") {
        promptDelete(p);
        return;
      }
      return;
    }
    if (!target.closest(".pmenu")) closeMenu();

    const pg = target.closest<HTMLButtonElement>(".pager-btn");
    if (pg && !pg.disabled) {
      const d = pg.dataset.pg === "next" ? 1 : -1;
      // A page turn IS a list arriving — a whole new set of records lands, and
      // nothing the reader was using is destroyed.
      if (pg.dataset.key === "all") {
        pstate.pageAll += d;
        renderAll(true);
      }
      if (pg.dataset.key === "acc") {
        pstate.pageAcc += d;
        renderAccepted(true);
      }
      if (pg.dataset.key === "done") {
        pstate.pageDone += d;
        renderDone(true);
      }
      return;
    }

    if (openFromRow(e as MouseEvent, target)) return;

    const act = target.closest<HTMLElement>("[data-act]");
    if (act) {
      const kind = act.dataset.act;
      const card = act.closest<HTMLElement>("[data-id]");
      const p = byId(card?.dataset.id ?? null);
      if (kind === "send" && p) {
        if (!pstate.writing) promptSend(p);
        return;
      }
      if (kind === "materials" && p) {
        openMaterials(p);
        return;
      }
      if (kind === "copylink" && p) {
        copyClientLink(p, act);
        return;
      }
      if (kind === "change-order" && p) {
        openChangeOrder(p);
        return;
      }
      if (kind === "del" && p) {
        if (!pstate.writing) promptDelete(p);
        return;
      }
      if (kind === "reminders" && p) {
        void runReminders(p, act);
        return;
      }
      // The four status writes hand the clicked button along: it is the one
      // control that shows the write in flight (setActBusy), and each carries
      // its own present participle so the label stays the verb being done.
      if (kind === "done" && p && card) {
        // COMPLETED is a fact about the work; the money stays owed on the sheet
        // until it is paid — by the client, or by "Mark paid in full".
        void runStatus(p, "COMPLETED", card, "acc", act, "Marking…");
        return;
      }
      if (kind === "paidfull" && p && card) {
        void runPaidInFull(p, card, act);
        return;
      }
      if (kind === "unaccept" && p && card) {
        void runStatus(p, "DRAFT", card, "acc", act, "Undoing…");
        return;
      }
      if (kind === "unmark" && p && card) {
        // "Undoing…", not "Reopening…": the busy label must never be wider
        // than the idle one (the button's width is pinned to it), and both
        // undo-arrow buttons — Un-accept and Reopen job — undo a status.
        void runStatus(p, "ACCEPTED", card, "done", act, "Undoing…");
        return;
      }
      // Both of these mail the client through notifyPaymentReminder(): the
      // instalment row sends that line, the footer button sends the whole
      // outstanding balance (the action falls back to the proposal total when
      // it cannot find the instalment).
      if (kind === "remind" && p) {
        void runReminder(p, act.dataset.inst ?? "", act);
        return;
      }
      if (kind === "fin-send" && p) {
        void runFinancingLink(p, act);
        return;
      }
      if (kind === "markpaid" && p) {
        // ONE TAP (owner, 2026-09-03). The in-place bank / cash / check picker
        // read as the button breaking into three new buttons, and a stage was
        // never actually recorded until one of them was pressed — which is
        // how "I marked both paid and it still won't complete" happened.
        void runMarkPaid(p, act.dataset.inst ?? "", "OTHER");
        return;
      }
      if (kind === "unmark-line" && p) {
        void runUnmark(p, act.dataset.inst ?? "", act);
        return;
      }
      if (kind === "invoice" && p) {
        promptInvoice(p, act.dataset.inst ?? "");
        return;
      }
    }
  });

  // Completion photos — a real <input type="file"> inside each dashed box.
  on(document, "change", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input || input.type !== "file" || !input.dataset.photo) return;
    const slot = input.dataset.photo === "after" ? "after" : "before";
    const card = input.closest<HTMLElement>("[data-id]");
    const p = byId(card?.dataset.id ?? null);
    const file = input.files?.[0];
    input.value = "";
    if (!p || !file) return;
    void runPhotoUpload(p, slot, file, input.closest<HTMLElement>(".photo-box"));
  });

  function menuBtnFor(id: string): HTMLElement | null {
    const tr = findRow($("#propTableBody"), id);
    return tr?.querySelector<HTMLElement>(".pt-open") ?? null;
  }

  // ================= WRITES (real server actions) =================
  // These are the live proposal actions from src/actions/proposals.ts — the
  // same ones the classic row menu called. They are org-scoped and
  // owner-scoped on the server and they revalidate /dashboard/proposals.
  // `proposalsData` is patched from the result so the book repaints
  // immediately; a reload reads the same rows back from the database.

  async function runDuplicate(p: ProposalRow, btn: HTMLElement | null) {
    pstate.writing = true;
    btn?.classList.add("is-busy");
    try {
      const res = await duplicateProposal(p.id);
      // Duplicating is a LIST action: it makes a second row, and the person
      // doing it is working through the list. Sending them into an editor for
      // the copy (which is what "Clone & edit" used to do, via a hard
      // location.assign that also replayed the whole blueprint entrance) threw
      // away their filter, their tab and their scroll position to open a
      // document they had not asked to edit.
      //
      // Re-reading the book is what makes the copy appear: duplicateProposal
      // returns only an id, and a row needs a publicId, a client, totals and a
      // Zillow link — all server-derived. loadProposalBook() is the SAME query
      // the page rendered from, behind the same guard.
      proposalsData = cloneRows(await loadProposalBook());
      renderAll();
      repaintExcept("all");
      pstate.writing = false;
      btn?.classList.remove("is-busy");
      flashRow(res.id);
    } catch (err) {
      pstate.writing = false;
      btn?.classList.remove("is-busy");
      showAlert("Couldn't duplicate", actionError(err));
    }
  }

  /** Bring a freshly-created row into view and mark it, so a copy that lands
   *  further down a long list is not silently off-screen. */
  function flashRow(id: string) {
    const tr = findRow($("#propTableBody"), id);
    if (!tr) return;
    tr.scrollIntoView({ block: "center", behavior: "smooth" });
    tr.classList.add("is-fresh");
    window.setTimeout(() => tr.classList.remove("is-fresh"), 2200);
  }

  let sendId: string | null = null;
  // ── Send invoice: pick the rail, then it goes (lib/payments/invoices) ──
  let invCtx: { proposalId: string; installmentId: string | null } | null = null;
  let invOpts: { card: boolean; bank: boolean; cardVia: string[] } | null = null;
  void getInvoiceOptions()
    .then((o) => {
      invOpts = o;
      syncInvoiceOptions();
    })
    .catch(() => {});
  function syncInvoiceOptions() {
    const card = $<HTMLButtonElement>("#invCard");
    const bank = $<HTMLButtonElement>("#invBank");
    const any = $<HTMLButtonElement>("#invAny");
    if (!invOpts) return;
    if (card) {
      card.disabled = !invOpts.card;
      const sub = card.querySelector(".inv-sub");
      if (sub) sub.textContent = invOpts.card ? "Hosted checkout · " + invOpts.cardVia.join(" / ") : "No card processor connected — Settings → Integrations / Payments";
    }
    if (bank) {
      bank.disabled = !invOpts.bank;
      const sub = bank.querySelector(".inv-sub");
      if (sub) sub.textContent = invOpts.bank ? "Your transfer details go in the email; the portal shows only those" : "Add bank-transfer instructions in Settings → Integrations / Payments";
    }
    if (any) any.disabled = !(invOpts.card || invOpts.bank);
  }
  function promptInvoice(p: ProposalRow, installmentId: string) {
    const inst = installmentId ? (p.inst || []).find((i) => i.id === installmentId) ?? null : null;
    invCtx = { proposalId: p.id, installmentId: inst ? inst.id : null };
    const title = $("#invTitle");
    if (title) title.textContent = inst ? `Invoice · ${inst.label}` : "Invoice · remaining balance";
    const note = $("#invNote");
    if (note) {
      const amount = inst ? instDollars(p, inst) : p.owed;
      note.textContent =
        `${fmtCents(amount)} on "${p.title}" for ${p.client}. ` +
        (p.clientEmail ? "The invoice goes to the email on the client record" : "This client has no email on file — a text goes out if there is a phone") +
        ". Choose how they should pay:";
    }
    setDlgError("#invErr", null);
    syncInvoiceOptions();
    openDlg("invMdl");
  }
  for (const [id, method] of [["#invCard", "card"], ["#invBank", "bank"], ["#invAny", "any"]] as const) {
    const btn = $<HTMLButtonElement>(id);
    if (!btn) continue;
    on(btn, "click", () => {
      if (pstate.writing || !invCtx) return;
      void sendInvoiceNow(method, btn);
    });
  }
  async function sendInvoiceNow(method: "card" | "bank" | "any", btn: HTMLButtonElement) {
    if (!invCtx) return;
    pstate.writing = true;
    btn.disabled = true;
    setDlgError("#invErr", null);
    try {
      const r = await sendInstallmentInvoice(invCtx.proposalId, invCtx.installmentId, method);
      if (!r.ok) {
        setDlgError("#invErr", r.error ?? "Couldn't send the invoice.");
        return;
      }
      closeDlg("invMdl");
      // The stage says it went (Installment.invoiceSentAt, stamped by sendInvoice) on the row and the card.
      const p = byId(invCtx.proposalId);
      const stage = p?.inst?.find((i) => i.id === invCtx?.installmentId);
      if (stage) {
        stage.invoiced = "just now";
        stage.invoiceVia = method;
        renderAll();
        renderAccepted();
      }
      showAlert(
        "Invoice sent",
        `${fmtCents(r.amount)} — ${r.label}. Email ${r.email}, text ${r.sms}. The client pays from the link${method === "bank" ? " or by bank transfer using the details in the email" : ""}.`,
      );
    } catch (err) {
      setDlgError("#invErr", actionError(err));
    } finally {
      pstate.writing = false;
      btn.disabled = false;
      syncInvoiceOptions();
    }
  }

  function promptSend(p: ProposalRow) {
    sendId = p.id;
    const title = $("#sendTitle");
    if (title) title.textContent = p.sentAgo ? `Send "${p.title}" again` : `Send "${p.title}"`;
    // THE BOX TAKES AN ADDRESS (owner, 2026-10-13: "the email is set and it
    // doesn't appear — make it work to send"). It used to be locked, because
    // the send read only the client record; sendProposal now writes what is
    // typed here onto that record first (or makes the client, for a proposal
    // that has none), so the box is honest.
    const unassigned = !p.clientId;
    const nameRow = $("#sendNameRow");
    nameRow?.classList.toggle("is-hidden", !unassigned);
    const name = $<HTMLInputElement>("#sendName");
    if (name) name.value = "";
    const email = $<HTMLInputElement>("#sendEmail");
    if (email) {
      email.value = p.clientEmail ?? "";
      email.placeholder = "client@example.com";
      email.disabled = false;
    }
    syncSendNote();
    setDlgError("#sendErr", null);
    pstate.writing = false;
    openDlg("sendMdl");
    // Straight to the first empty box.
    after(50, () => {
      const first = unassigned && name && !name.value ? name : email && !email.value ? email : null;
      first?.focus();
    });
  }
  /** The line under the boxes and the button's words follow what is typed. */
  function syncSendNote() {
    const p = byId(sendId);
    if (!p) return;
    const typed = ($<HTMLInputElement>("#sendEmail")?.value ?? "").trim();
    const note = $("#sendNote");
    const changed = Boolean(p.clientId && p.clientEmail && typed && typed.toLowerCase() !== p.clientEmail.toLowerCase());
    const line = !typed
      ? p.clientId
        ? `${p.client} has no email on file. Add it here and it is saved on their client record — or leave it empty to mark the proposal sent without an email.`
        : "This proposal has no client yet. Add their name and email — they are added to your clients and the proposal is filed under them."
      : changed
        ? `This also changes ${p.client}'s email on their client record.`
        : !p.clientEmail
          ? p.clientId
            ? `Saved on ${p.client}'s client record, then sent.`
            : "Added to your clients, then sent."
          : "";
    if (note) {
      note.textContent = line;
      note.classList.toggle("is-hidden", !line);
    }
    setSaving($("#sendOk"), false, "", typed ? "Send proposal" : "Mark as sent");
  }
  for (const sel of ["#sendEmail", "#sendName"]) {
    const box = $(sel);
    if (box) {
      on(box, "input", () => syncSendNote());
      on(box, "keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter" && !pstate.writing) {
          e.preventDefault();
          void confirmSend();
        }
      });
    }
  }
  const sendOk = $("#sendOk");
  if (sendOk) {
    on(sendOk, "click", () => {
      if (pstate.writing) return;
      void confirmSend();
    });
  }
  async function confirmSend() {
    const p = byId(sendId);
    if (!p) return;
    const email = ($<HTMLInputElement>("#sendEmail")?.value ?? "").trim();
    const name = ($<HTMLInputElement>("#sendName")?.value ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setDlgError("#sendErr", "That email address doesn't look right — check it and try again.");
      return;
    }
    // A new client needs a name; one already on file by this email is found by the server.
    // The first send to a client names the business first (lib/orgName).
    if (!(await ensureCompanyName())) return;
    setDlgError("#sendErr", null);
    pstate.writing = true;
    setSaving($("#sendOk"), true, email ? "Sending…" : "Saving…", "");
    try {
      const r = await sendProposal(p.id, email ? { email, name } : undefined);
      p.status = statusAfterSend(p.status);
      p.sentAgo = "just now";
      p.updated = "just now";
      if (r.clientId) {
        p.clientId = r.clientId;
        if (r.client) p.client = r.client;
      }
      p.clientEmail = r.to ?? p.clientEmail;
      pstate.writing = false;
      setSaving($("#sendOk"), false, "", "Send proposal");
      closeDlg("sendMdl");
      syncAllAfterChange(p.id);
      // Say it went (owner, 2026-09-26) — the row's stamp alone was easy to miss.
      showAlert(
        r.to ? "Proposal sent" : "Marked as sent",
        r.to
          ? `"${p.title}" is on its way to ${r.to}.`
          : "No email went out — there is no client email. Add one and send it again, or share the client link.",
      );
    } catch (err) {
      pstate.writing = false;
      syncSendNote();
      // sendProposal refuses BEFORE writing when the provider fails, so the
      // proposal is genuinely still unsent — say so instead of closing.
      setDlgError("#sendErr", actionError(err));
    }
  }

  let delId: string | null = null;
  function promptDelete(p: ProposalRow) {
    delId = p.id;
    const txt = $("#delTxt");
    if (txt) {
      txt.textContent = `"${p.title}" for ${p.client}. This removes the proposal, its line items, payment schedule and snapshots. Public links stop working, and it can't be undone.`;
    }
    setDlgError("#delErr", null);
    setSaving($("#delOk"), false, "", "Delete forever");
    pstate.writing = false;
    openDlg("delMdl");
  }
  const delOk = $("#delOk");
  if (delOk) {
    on(delOk, "click", () => {
      if (pstate.writing) return;
      void confirmDelete();
    });
  }
  async function confirmDelete() {
    const id = delId;
    const p = byId(id);
    if (!id || !p) return;
    setDlgError("#delErr", null);
    setSaving($("#delOk"), true, "Deleting…", "");
    try {
      const res = await bulkDeleteProposals([id]);
      if (res.deleted === 0) {
        setSaving($("#delOk"), false, "", "Delete forever");
        setDlgError("#delErr", "That proposal is no longer yours to delete. Reload the page.");
        return;
      }
      proposalsData = proposalsData.filter((x) => x.id !== id);
      setSaving($("#delOk"), false, "", "Delete forever");
      closeDlg("delMdl");
      delId = null;
      // The row leaves alone, once the dialog is out of the way. Every other
      // list repaints silently inside leaveRow's commit.
      after(MDL_EXIT_MS, () => {
        const tr = findRow($("#propTableBody"), id);
        if (tr) {
          leaveRow(
            tr,
            () => {
              syncAllChrome();
              repaintExcept("all");
              healAllPage();
            },
            after,
            { leaveClass: "is-leaving" },
          );
        } else {
          renderProposals();
        }
      });
    } catch (err) {
      setSaving($("#delOk"), false, "", "Delete forever");
      setDlgError("#delErr", actionError(err));
    }
  }

  /**
   * Mark completed / Un-accept / Unmark as paid. The card always leaves the
   * stack it was in (its status no longer belongs there), so it exits through
   * leaveRow and every other list repaints behind a hidden panel.
   */
  async function runStatus(
    p: ProposalRow,
    status: "PAID" | "DRAFT" | "ACCEPTED" | "COMPLETED",
    card: HTMLElement,
    acted: "acc" | "done",
    btn: HTMLElement | null = null,
    busyLbl = "Saving…",
  ) {
    if (pstate.writing) return;
    pstate.writing = true;
    // The card dims and goes inert; the button that was pressed carries the
    // write. On success the button stays as it is — the card is leaving with
    // it, and a label flipping back mid-exit would read as a second event.
    card.classList.add("is-busy");
    setActBusy(btn, true, busyLbl);
    try {
      const res = await updateProposalStatus(p.id, status);
      if (!res.ok) {
        pstate.writing = false;
        card.classList.remove("is-busy");
        setActBusy(btn, false);
        if (res.reason === "provider_paid") {
          showAlert(
            "Paid through Stripe / Square",
            "Refund it from that dashboard — the proposal syncs back automatically.",
          );
        } else {
          showAlert("Stages already paid", "A proposal with paid stages can't go back to draft.");
        }
        return;
      }
      p.status = status;
      p.updated = "just now";
      if (status === "PAID") p.paid = todayPlate();
      if (status === "ACCEPTED") p.paid = undefined;
      if (status === "DRAFT") {
        p.accepted = undefined;
        p.paid = undefined;
      }
      pstate.writing = false;
      card.classList.remove("is-busy");
      leaveRow(
        card,
        () => {
          if (acted === "acc") syncAccChrome();
          else syncDoneChrome();
          repaintExcept(acted);
          healStack(acted);
        },
        after,
        { leaveClass: "is-leaving" },
      );
    } catch (err) {
      pstate.writing = false;
      card.classList.remove("is-busy");
      setActBusy(btn, false);
      showAlert("Couldn't update", actionError(err));
    }
  }
  function todayPlate() {
    return new Date()
      .toLocaleDateString("en-US", { month: "short", day: "2-digit" })
      .toUpperCase();
  }

  /**
   * Mark paid (manual). One tap records the stage's own amount as a manual
   * payment (method OTHER); a different figure or a named method is a job
   * for the desktop editor's Record payment dialog.
   */
  /** The office records the whole balance as paid by hand: every open stage settles, the proposal files PAID. */
  async function runPaidInFull(p: ProposalRow, card: HTMLElement, btn: HTMLElement | null = null) {
    if (pstate.writing) return;
    if (!window.confirm(`Record ${fmtMoney(p.owed)} as paid by hand for "${p.title}"? Every open stage closes and the proposal files as paid.`)) return;
    pstate.writing = true;
    card.classList.add("is-busy");
    setActBusy(btn, true, "Recording…");
    try {
      await recordRemainingPayment({ proposalId: p.id, method: "OTHER" });
      proposalsData = cloneRows(await loadProposalBook());
      renderDone();
      renderAccepted();
      renderAll();
    } catch (err) {
      showAlert("Couldn't record the payment", actionError(err));
    } finally {
      pstate.writing = false;
      card.classList.remove("is-busy");
      // A success re-rendered the sheet, so this only ever restores the
      // button a failure left in place.
      setActBusy(btn, false);
    }
  }

  async function runMarkPaid(p: ProposalRow, instId: string, method: string) {
    if (pstate.writing) return;
    pstate.writing = true;

    /* OPTIMISTIC, AND VISIBLY IN FLIGHT.
       The write is a server action that re-reads the whole proposal book
       afterwards; on a cold dev server that is seconds, and all the button
       did was grey itself out — the page read as frozen and the click as
       lost. Two changes, and they answer different halves of that:

         · the stage flips to "Paid · manual" HERE, before the request, so
           the tap has an answer on the same frame;
         · the card takes `.is-busy` for as long as the request is out —
           dimmed and inert — so "already done" is never confused with
           "still going". (The stage's own button is gone with the re-render,
           so this write has no control to carry it the way runStatus does.)

       The server's answer still wins: the refetch below replaces the whole
       row (and moves the card to Completed when that payment settles the
       schedule), and a failure puts the stage back exactly as it was. */
    const stage = p.inst?.find((i) => i.id === instId);
    const prev = stage ? { status: stage.status, paidVia: stage.paidVia, paidAmt: stage.paidAmt, paidOn: stage.paidOn, rowPaid: p.paidAmt, rowOwed: p.owed } : null;
    if (stage) {
      // The money moves with the stage (2026-10-23): a part payment is not re-read, so the row's "paid" and
      // what is left follow here, from the same figure the write records.
      const amt = instDollars(p, stage);
      stage.status = "PAID";
      stage.paidVia = "MANUAL";
      stage.paidAmt = amt;
      stage.paidOn = todayPlate();
      p.paidAmt = Math.round(((p.paidAmt ?? 0) + amt) * 100) / 100;
      p.owed = Math.max(0, Math.round((p.owed - amt) * 100) / 100);
    }
    renderAccepted();
    // The row's payment line shows it on the same frame too (2026-10-23), dimmed while the write is out.
    renderAll();
    findRow($("#propStack"), p.id)?.classList.add("is-busy");
    const tr = findRow($("#propTableBody"), p.id);
    if (tr) payRowOf(tr)?.classList.add("is-busy");
    try {
      const res = await markInstallmentPaid({ installmentId: instId, method });
      // RE-READ ONLY WHEN THE ANSWER CAN DIFFER. Refetching the whole book
      // after every stage doubled the wait — the write itself is ~3s on a
      // cold server and the refetch is another round trip, so the card sat
      // dimmed for six. The optimistic flip above already IS the new state
      // for a part payment; only a payment that settles the schedule
      // changes anything else (the other stages are waived and the card
      // moves to Completed), and that is the one case worth re-reading.
      if (res.outcome !== "settled" || res.proposalPaid) {
        proposalsData = cloneRows(await loadProposalBook());
      }
      renderAccepted();
      repaintExcept("acc");
    } catch (err) {
      if (stage && prev) {
        stage.status = prev.status;
        stage.paidVia = prev.paidVia;
        stage.paidAmt = prev.paidAmt;
        stage.paidOn = prev.paidOn;
        p.paidAmt = prev.rowPaid;
        p.owed = prev.rowOwed;
      }
      renderAccepted();
      renderAll();
      showAlert("Couldn't record payment", actionError(err));
    } finally {
      pstate.writing = false;
    }
  }
  async function runUnmark(p: ProposalRow, instId: string, btn: HTMLElement) {
    if (pstate.writing) return;
    pstate.writing = true;
    (btn as HTMLButtonElement).disabled = true;
    try {
      const res = await unmarkInstallmentPaid(instId);
      if (!res.ok) {
        showAlert("Can't undo here", res.message);
        (btn as HTMLButtonElement).disabled = false;
        return;
      }
      proposalsData = cloneRows(await loadProposalBook());
      renderAccepted();
      repaintExcept("acc");
    } catch (err) {
      showAlert("Couldn't undo", actionError(err));
      (btn as HTMLButtonElement).disabled = false;
    } finally {
      pstate.writing = false;
    }
    void p;
  }

  /**
   * Remind / Request payment. One action for both: notifyPaymentReminder mails
   * the client the branded reminder with a link to the public page. An empty
   * `installmentId` is the whole balance — the action's own fallback, not a
   * trick — which is exactly what "Request payment" means on a contract card.
   *
   * The action is requireManager()-gated, so a SALES / ESTIMATOR caller gets a
   * refusal here rather than a silent no-op; it also RETURNS a skip reason
   * instead of throwing, so a skipped send has to be reported too.
   */
  /** Cycle the proposal's reminder override: company → on → off → company. */
  async function runReminders(p: ProposalRow, btn: HTMLElement) {
    if (pstate.writing) return;
    pstate.writing = true;
    (btn as HTMLButtonElement).disabled = true;
    const next = p.remindersOn == null ? true : p.remindersOn ? false : null;
    try {
      await setProposalReminders(p.id, next);
      p.remindersOn = next;
      renderAccepted();
    } catch (err) {
      showAlert("Couldn't change reminders", actionError(err));
    } finally {
      pstate.writing = false;
      (btn as HTMLButtonElement).disabled = false;
    }
  }

  async function runFinancingLink(p: ProposalRow, btn: HTMLElement) {
    if (pstate.writing) return;
    pstate.writing = true;
    (btn as HTMLButtonElement).disabled = true;
    try {
      const res = await sendFinancingLink(p.id, "auto");
      if (res.ok) flashBtn(btn, res.via === "text" ? "Texted" : "Emailed");
      else showAlert("Nothing sent", res.error);
    } catch (err) {
      showAlert("Couldn't send", actionError(err));
    } finally {
      pstate.writing = false;
      (btn as HTMLButtonElement).disabled = false;
    }
  }

  async function runReminder(p: ProposalRow, installmentId: string, btn: HTMLElement) {
    if (pstate.writing) return;
    pstate.writing = true;
    (btn as HTMLButtonElement).disabled = true;
    try {
      const res = await notifyPaymentReminder({ proposalId: p.id, installmentId });
      if (res && "skipped" in res && res.skipped) {
        showAlert(
          "Nothing sent",
          res.reason === "no-client-email"
            ? "This client has no email on file. Add an address to the client record and try again."
            : "That proposal is no longer available to you. Reload the page.",
        );
      } else {
        flashBtn(btn, "Sent");
      }
    } catch (err) {
      showAlert("Couldn't send", actionError(err));
    } finally {
      pstate.writing = false;
      (btn as HTMLButtonElement).disabled = false;
    }
  }

  /** Before / After completion shot → uploadProposalPhoto(). The action stores
   *  it on the proposal (Vercel Blob when configured, inline data URL if not)
   *  and returns the persisted record, which is what the box then shows. */
  async function runPhotoUpload(
    p: ProposalRow,
    slot: "before" | "after",
    file: File,
    box: HTMLElement | null,
  ) {
    if (pstate.writing) return;
    pstate.writing = true;
    box?.classList.add("is-busy");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("Couldn't read that file."));
        fr.readAsDataURL(file);
      });
      const photo = await uploadProposalPhoto(p.id, dataUrl, file.name, slot);
      if (slot === "before") p.before = [...p.before, photo];
      else p.after = [...p.after, photo];
      if (box) {
        box.classList.add("photo-box--filled");
        const img = document.createElement("img");
        img.src = photo.url;
        img.alt = slot === "before" ? "Before photo" : "After photo";
        box.querySelectorAll("svg, img").forEach((n) => n.remove());
        box.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) n.textContent = "";
        });
        box.prepend(img);
      }
    } catch (err) {
      showAlert("Couldn't add the photo", actionError(err));
    } finally {
      pstate.writing = false;
      box?.classList.remove("is-busy");
    }
  }

  // ================= INITIALIZATION =================
  renderProposals();
  pstate.revealed.all = true;

  // The mobile nav drawer and FLUID SCALE belong to the persistent chrome and
  // now live in components/v3/blueprint-shell/shell-behavior.ts.

  // ================= MOTION SYSTEM — BALANCED (package 02) =================
  (function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Reveal: load + scroll
    const vpH = window.innerHeight;
    const scrollHost = main;
    let velLastY = scrollHost ? scrollHost.scrollTop : 0;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    if (scrollHost)
      on(
        scrollHost,
        "scroll",
        () => {
          const now = performance.now();
          scrollVel = Math.abs(scrollHost.scrollTop - velLastY) / Math.max(1, now - velLastT);
          velLastY = scrollHost.scrollTop;
          velLastT = now;
        },
        { passive: true },
      );
    const blocks = $$(".content > *:not(.mdl):not([data-island])");
    blocks.forEach((el, i) => {
      el.classList.add("rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? i * 60 + "ms" : "200ms";
    });
    const cells = $$(".kpi");
    cells.forEach((el, i) => {
      el.classList.add("rv-cell");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? 160 + (i % 8) * 45 + "ms" : "200ms";
    });
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((en) => {
          if (!en.isIntersecting) return;
          const target = en.target as HTMLElement;
          if (target.dataset.rvScroll) {
            const dur = Math.round(Math.max(550, 900 - scrollVel * 160));
            target.style.transitionDuration = dur + "ms";
          }
          target.classList.add("rv-in");
          io.unobserve(target);
          target.addEventListener("transitionend", function te() {
            target.style.transitionDelay = "";
            target.style.transitionDuration = "";
            target.removeEventListener("transitionend", te);
          });
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.concat(cells).forEach((el) => io.observe(el));
    disposers.push(() => io.disconnect());

    // (Sidebar cascade lives in the shell — it plays once, on first load.)

    // Row stagger on the FIRST paint of the visible tab. The donor drove this
    // from a MutationObserver on each list; that replayed the full cascade on
    // every render — a filter, a keystroke, a delete — and read as the list
    // wiping itself. `staggerIn` is called from the places where a list
    // genuinely arrives instead (here, a tab's first reveal, a page turn).
    const firstList = $("#propTableBody");
    if (firstList) staggerIn(Array.from(firstList.querySelectorAll<HTMLElement>(".prow")));

    // KPI count-up
    $$(".kpi-val").forEach((el) => {
      const raw = (el.textContent || "").trim();
      const money = raw.charAt(0) === "$";
      const target = parseInt(raw.replace(/[^0-9]/g, ""), 10);
      if (!isFinite(target)) return;
      let t0: number | null = null;
      function frame(t: number) {
        if (!t0) t0 = t;
        const pr = Math.min(1, (t - t0) / 750);
        const e = 1 - Math.pow(1 - pr, 3);
        el.textContent = (money ? "$" : "") + Math.round(target * e).toLocaleString("en-US");
        if (pr < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    // Press effects
    function pressify(sel: string, cls: string) {
      on(root, "click", (e) => {
        const el = (e.target as Element).closest<HTMLElement>(sel);
        if (!el || !root.contains(el)) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
      });
      on(root, "animationend", (e) => {
        const el = e.target as HTMLElement;
        if (el.matches && el.matches(sel)) el.classList.remove(cls);
      });
    }
    // Shell controls (.icon-btn, .sb-foot-*) press from the shell module.
    pressify(
      ".page-actions .btn, .card-foot-btn, .ptab, .pchip, .pager-btn, .pmenu-item, .photo-box, .pt-open, .pjob-foot .btn, .psheet-foot .btn, .td-remind .btn",
      "pressed",
    );

    // (Graph-paper parallax lives in the shell — it owns .main.)
  })();

  // The sliding sidebar indicator lives in the shell — it survives navigation
  // and re-points at whichever item React marks `active`.

  return () => {
    disposers.forEach((d) => d());
  };
}
