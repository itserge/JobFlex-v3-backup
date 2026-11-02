"use client";

// MOBILE PROPOSALS (mobile-proposals-v2) — Blueprint system, handheld build.
//
// Ported from the scratchpad donor jobflex-proposals-mobile-blueprint.html.
// Tokens, palette, type scale, status tones and Motion System "Balanced" are
// the reference dashboard's; the proposals vocabulary (masthead, dossier
// cards, tear-sheets, tonal menu boxes, stamp buttons) follows
// design-system.md → "Proposals page patterns".
//
// Every component / tab / view / variant of the desktop page is covered:
//  · 3 tabs (All / Accepted / Completed) with live counts + sliding rule
//  · masthead: one numeral per tab, mono kicker, EXACTLY two annotations
//  · 6 filter chips, each inheriting its status badge tones when active
//  · all status badges (Draft/Sent/Viewed/Accepted/Declined/Expired/Paid)
//  · ledger rows, contract dossiers, completion tear-sheets
//  · BOTH payment variants: ≤5 instalments → columns, 6+ → row table
//  · row actions sheet: tonal icon boxes, disabled rows and a danger item
//  · pagers, empty states, and the mutating actions behind them
//
// What changes versus the desktop sheet, and why:
//  · The 7-column table cannot survive 320px, so each record becomes a row
//    card — not a table with columns hidden.
//  · The "⋮" popover becomes a bottom sheet (no hover, and CLAUDE.md prefers
//    sheets over modals on mobile).
//  · Page sizes drop (6/2/1 vs 8/3/2): phone rows are taller, and density
//    falls along the funnel.
//
// ── THE DATA LAYER (2026-08-13) ────────────────────────────────────────────
// This surface WAS a fixture: sixteen invented proposals with invented clients,
// cities and totals, mutated in memory by menu items that wrote nothing. It is
// now the org's real proposal book, and every control reaches a real effect:
//
//   Open proposal    → /dashboard/proposals/<id>          (the live editor)
//   View public page → /portal/q/<publicId>               (the client page)
//   Duplicate        → duplicateProposal()
//   Send to client   → sendProposal()
//   Send reminder    → notifyPaymentReminder()
//   Request payment  → notifyPaymentReminder() (no instalment = whole balance)
//   Mark accepted / completed / un-accept → updateProposalStatus()
//   Get directions   → the maps URL built server-side from the client address
//   Before / After   → uploadProposalPhoto()
//   PDF              → /api/proposals/<id>/pdf
//   Delete           → bulkDeleteProposals()
//
// Rows arrive two ways. The standalone /mobile-proposals-v2 route reads them in
// its server component and passes them as props. The copy the responsive shell
// mounts at /dashboard/proposals gets NO props — that map renders props-less
// components — so it loads the same book itself through ./proposals-actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Fragment } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-proposals.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { Who } from "@/components/v3/who/who";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import {
  bulkDeleteProposals,
  duplicateProposal,
  sendProposal,
  updateProposalStatus,
  uploadProposalPhoto,
} from "@/actions/proposals";
import { getInvoiceOptions, notifyPaymentReminder, sendInstallmentInvoice } from "@/actions/notify";
import { markInstallmentPaid } from "@/actions/installments";
import { sendFinancingLink } from "@/actions/financing";
import { loadProposalBook } from "./proposals-actions";
import {
  FILTERS,
  PAGE_ACC,
  PAGE_ALL,
  PAGE_DONE,
  TABS,
  instDollars,
  statusPlate,
  sumOf,
  type FilterKey,
  type ProposalRow,
  type TabKey,
} from "./proposals-data";
import {
  chainsOf,
  chained,
  nextStage,
  paidTier,
  payState,
  sendState,
  stageFacts,
  statusAfterSend,
  type Installment,
  type PaidTier,
} from "@/components/v3/proposals-blueprint/proposals-data";
import { familyCounts, kindWord, type ProposalKind, type WorkFamily } from "@/lib/proposalKind";
import { clientProposalUrl, proposalTextMessage, smsHref } from "@/lib/proposalLink";
import { ensureCompanyName } from "@/components/company-name/company-name-gate";

/**
 * VIEWS — what the contractor checks after sending (owner, 2026-09-20). A
 * draft cannot be opened; a sent proposal nobody has opened says so; an
 * opened one carries the count and when it was last read.
 */
function Views({ p }: { p: ProposalRow }) {
  if (p.status === "DRAFT") return <span className={styles.viewsNa}>Not sent</span>;
  // The count names itself — "3 views" — and when it was last opened goes under it (owner, 2026-10-20:
  // a bare "3" beside "1mo ago" read as nothing).
  if (p.views <= 0) {
    // Amber only while the proposal is still waiting on the client.
    const waiting = p.status === "SENT" || p.status === "VIEWED";
    return (
      <span className={`${styles.views} ${waiting ? styles.viewsNone : styles.viewsQuiet}`}>
        <b>0 <small>views</small></b>
        <i>not opened</i>
      </span>
    );
  }
  return (
    <span className={`${styles.views} ${styles.viewsSeen}`}>
      <b>{p.views} <small>{p.views === 1 ? "view" : "views"}</small></b>
      {p.lastViewed ? <i>{p.lastViewed}</i> : null}
    </span>
  );
}

/** The paid bar's hue by how far the client has paid (proposals-data → paidTier). */
const TRACK_TIER: Record<PaidTier, "trackLow" | "trackPart" | "trackFull"> = { low: "trackLow", part: "trackPart", full: "trackFull" };

function PaymentSummary({ p }: { p: ProposalRow }) {
  const total = p.contract ?? p.total;
  const paid = p.paidAmt ?? 0;
  const percentage = total > 0 ? Math.max(0, Math.min(100, paid / total * 100)) : 0;
  return <div className={styles.paymentSummary}>
    <span>{money(paid)} paid</span>
    {p.owed > 0 && <span>{money(p.owed)} due</span>}
    <div className={`${styles.paymentTrack} ${styles[TRACK_TIER[paidTier(p)]]}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={money(paid) + " paid of " + money(total)}>
      <span style={{ width: percentage + "%" }} />
    </div>
  </div>;
}

/**
 * THE ALL-TAB CARD ON THE PHONE (owner, 2026-10-30: keep card C, "we also need the mobile version", and "the cards
 * gotta be separated") — the desk's two-panel dossier (proposals-blueprint/cards/card-c.ts) stacked for one column:
 * each proposal its own framed card, a gap between cards. Top, the job: kind, title, client · city, the client's
 * design, then a ruled Status | Views | Updated ledger. Under it the money plate on its tinted ground: Quote /
 * Contract, the amount, the paid track with a tick where each stage ends, then the stages — the one being chased
 * framed, with Mark paid / Invoice / Remind (each 44px). Foot: one ruled bar — Open (blue), Send or Sent ⇄ Resend,
 * and ⋮ for the rest (client view, change order, copy link, delete live in the actions sheet).
 */
const SIGNED = new Set(["ACCEPTED", "COMPLETED", "PAID"]);

function paidPct(p: ProposalRow): number {
  const contract = p.contract ?? p.total;
  if (contract > 0 && p.owed <= 0) return 100;
  return contract > 0 ? Math.max(0, Math.min(100, Math.round(((p.paidAmt ?? 0) / contract) * 100))) : 0;
}

/** Stage boundaries as % of the contract — skipped within a point of either end. */
function stageTicks(p: ProposalRow): number[] {
  const contract = p.contract ?? p.total;
  const insts = p.inst ?? [];
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

function CardMoney({ p, writing, onMarkPaid, onInvoice, onRemind }: {
  p: ProposalRow;
  writing: boolean;
  onMarkPaid: (it: Installment) => void;
  onInvoice: (it: Installment | null) => void;
  onRemind: (it: Installment | null) => void;
}) {
  const state = payState(p);
  const contract = p.contract ?? p.total;
  const head = (
    <>
      <div className={styles.cmMk}>{SIGNED.has(p.status) ? "Contract" : "Quote"}</div>
      <div className={styles.cmAmt}>{money(contract)}</div>
    </>
  );
  // Nothing to collect: declined, archived, or no payment plan yet — one calm line.
  if (!state) {
    const calm = p.status === "DECLINED" ? "Declined — nothing to collect" : p.status === "ARCHIVED" ? "Archived" : "No payment plan yet";
    return (
      <div className={`${styles.cmMoney} ${styles.cmCalm}${p.status === "DECLINED" ? " " + styles.cmDeclined : ""}`}>
        {head}
        <p className={styles.cmCalmLine}>{calm}</p>
      </div>
    );
  }
  const insts = p.inst ?? [];
  const next = state === "collect" ? nextStage(p) : null;
  const pending = next?.status === "PENDING";
  const pct = state === "plan" ? 0 : paidPct(p);
  const tier = state === "plan" ? styles.cmBarPlan : styles[TRACK_TIER[paidTier(p)]];
  const acts = (it: Installment | null) =>
    p.canBill === false ? null : (
      <div className={styles.cmActs}>
        {it ? (
          <button className={`${styles.cmAct} ${styles.cmActPaid}`} type="button" disabled={writing || pending}
            onClick={() => onMarkPaid(it)}><Icon id="i-check" />Mark paid</button>
        ) : null}
        <button className={`${styles.cmAct} ${styles.cmActInv}`} type="button" disabled={writing || pending}
          onClick={() => onInvoice(it)}><Icon id="i-send" />Invoice</button>
        <button className={`${styles.cmAct} ${styles.cmActRem}`} type="button" disabled={writing || !p.clientEmail}
          onClick={() => onRemind(it)}><Icon id="i-bell" />Remind</button>
      </div>
    );
  return (
    <div className={styles.cmMoney} data-row-pay={state}>
      {head}
      <div className={`${styles.cmBar} ${tier ?? ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={state === "plan" ? "Not billed yet" : `${money(p.paidAmt ?? 0)} paid of ${money(contract)}`}>
        <span style={{ width: pct + "%" }} />
        {stageTicks(p).map((t) => <i key={t} className={styles.cmTick} style={{ left: t + "%" }} />)}
      </div>
      {state === "plan" ? (
        <div className={styles.cmLine}>
          <span>{insts.length || 1} {insts.length === 1 ? "payment" : "payments"}</span>
          <span>Billed after {p.clientId && p.client ? p.client.split(/\s+/)[0] : "the client"} accepts</span>
        </div>
      ) : state === "paid" ? (
        <div className={`${styles.cmLine} ${styles.cmLineOk}`}><span><Icon id="i-check" />Paid in full</span></div>
      ) : (
        <div className={styles.cmLine}>
          <span><b>{money(p.paidAmt ?? 0)}</b> paid</span>
          <span className={styles.cmDue}><b>{money(p.owed)}</b> due</span>
        </div>
      )}
      <ol className={styles.cmStages}>
        {insts.map((it, i) => {
          const share = it.pct ? <em>{Math.round(it.amount)}%</em> : null;
          const amount = money(instDollars(p, it));
          if (next && it.id === next.id) {
            return (
              <li key={it.id} className={`${styles.cmSt} ${styles.cmStNext}${it.overdue ? " " + styles.cmStLate : ""}`} data-stage={it.id}>
                <span className={styles.cmStK}>{it.label}{share}</span>
                <span className={styles.cmStV}>{amount}</span>
                <span className={styles.cmStFacts}>{stageFacts(it).join(" · ") || "Next to collect"}</span>
                {acts(next)}
              </li>
            );
          }
          const paid = it.status === "PAID";
          const tail = paid ? (it.paidOn ? `Paid ${it.paidOn}` : "Paid")
            : it.status === "WAIVED" ? "Closed"
            : it.due ? `Due ${it.due}`
            // Not signed yet: only the first stage is billed on signing; the rest follow it.
            : state === "plan" && i === 0 ? "After signing" : "Later";
          return (
            <li key={it.id} className={`${styles.cmSt}${paid ? " " + styles.cmStPaid : it.status === "WAIVED" ? " " + styles.cmStClosed : ""}`} data-stage={it.id}>
              <span className={styles.cmStM}>{paid ? <Icon id="i-check" /> : <i aria-hidden="true" />}</span>
              <span className={styles.cmStK}>{it.label}{share}</span>
              <span className={styles.cmStS}>{tail}</span>
              <span className={styles.cmStV}>{amount}</span>
            </li>
          );
        })}
        {/* Signed with no schedule: the balance is the one thing to collect. */}
        {!insts.length && state === "collect" ? (
          <li className={`${styles.cmSt} ${styles.cmStNext}`}>
            <span className={styles.cmStK}>Balance</span>
            <span className={styles.cmStV}>{money(p.owed)}</span>
            <span className={styles.cmStFacts}>Next to collect</span>
            {acts(null)}
          </li>
        ) : null}
      </ol>
      {/* A sales rep or an estimator reads what is left instead of the billing buttons. */}
      {state === "collect" && p.canBill === false ? <p className={styles.cmLeft}><b>{money(p.owed)}</b> left to collect</p> : null}
      <RowFinancing p={p} />
    </div>
  );
}

function CardSend({ p, onSend }: { p: ProposalRow; onSend: () => void }) {
  const s = sendState(p);
  if (s === "none") return <span className={styles.cmCellFill} aria-hidden="true" />;
  if (s === "send") {
    return (
      <button className={`${styles.cmCell} ${styles.cmSend}`} type="button" data-row-send="send" onClick={onSend}
        title={p.clientEmail ? "Send to " + p.clientEmail : "Send to the client"}>
        <Icon id="i-send" />Send
      </button>
    );
  }
  // One button (owner, 2026-10-29): Sent and when; on hover or focus it reads Resend. A phone has no hover, so
  // there both halves show side by side.
  return (
    <button className={`${styles.cmCell} ${styles.cmSwap}`} type="button" data-row-send={s} onClick={onSend}
      title={"Sent " + (p.sentAgo ?? "") + " — send it again" + (p.clientEmail ? " to " + p.clientEmail : "")}
      aria-label={"Sent " + (p.sentAgo ?? "") + ". Resend"}>
      <span className={styles.cmSwapSent}><Icon id="i-check" />Sent <small>{p.sentAgo}</small></span>
      <span className={styles.cmSwapResend}><Icon id="i-send" />Resend</span>
    </button>
  );
}

/** Wisetack financing (2026-10-28): where the client's loan stands, and Send financing link for the office. */
function RowFinancing({ p }: { p: ProposalRow }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const f = p.fin;
  if (!f || (!f.line && !f.canSend)) return null;
  async function send() {
    setBusy(true);
    setSaid("");
    try {
      const r = await sendFinancingLink(p.id, "auto");
      setSaid(r.ok ? (r.via === "text" ? "Texted" : "Emailed") : r.error);
    } catch {
      setSaid("Couldn't send — try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.mPayActs} data-fin-row>
      {f.line ? <span className={styles.mPayNote}><Icon id="i-bank" />{f.line}</span> : null}
      {f.canSend ? (
        <button className={styles.mPayAct} type="button" disabled={busy} onClick={() => void send()} data-fin-send>
          <Icon id="i-send" />{busy ? "Sending…" : "Send financing link"}
        </button>
      ) : null}
      {said ? <span className={styles.mPayNote} role="status">{said}</span> : null}
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Server actions reject with an Error whose message is written for the user
 *  ("Not found", "Plan limit reached", a send-transport failure). Surface that
 *  text; fall back to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  const code = (err as { code?: string } | null)?.code;
  if (code === "PLAN_LIMIT_REACHED") {
    return "Plan limit reached — upgrade to create more proposals.";
  }
  if (msg === "Not found") return "That proposal is no longer available to you. Pull to refresh.";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** 750ms easeOutCubic. tabular-nums keep the digit columns from jumping. */
function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = money(value);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = money(value * (1 - Math.pow(1 - pr, 3)));
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div ref={ref} className={className}>
      {money(value)}
    </div>
  );
}

type MenuRow = {
  act: string;
  icon: string;
  tone?: string;
  title: string;
  sub: string;
  disabled?: boolean;
  danger?: boolean;
  /** Set on the first row of a group: the label drawn above it. */
  group?: string;
};

/* ============================================================
   DROPDOWN PLACEMENT (2026-08-15)

   The filter is a `.dd`: a `position: relative` wrapper holding a full-width
   button and a `position: absolute; top: 100%` menu. That geometry fails
   whenever the ledger under the bar is short or empty — the page is barely
   taller than the viewport, so there is nothing to scroll, and an absolutely
   positioned box does not lengthen the `.scroll` container it overflows. The
   menu was not merely below the fold; its lower half was unreachable.

   The rule, which is the one native pickers use: open DOWNWARD while there is
   room below the trigger; when there is not, and there is more room above, FLIP
   UP; either way cap the panel at the space actually available and let it
   scroll internally. Nothing is ever positioned outside the visual viewport.

   Written straight at the DOM — one attribute and one custom property on the
   wrapper — because it re-runs on scroll and on every visual-viewport change
   (the software keyboard), and none of that should cost a React render.
   ============================================================ */
const MENU_GAP = 6;
const MENU_MARGIN = 12;
/** Two rows of a 62px cell plus the frame — below this, opening down is not
 *  worth it even if a scroller that short would technically hold the menu. */
const MENU_MIN_DOWN = 140;

function useMenuPlacement(
  open: boolean,
  anchorRef: React.RefObject<HTMLDivElement | null>,
  menuRef: React.RefObject<HTMLDivElement | null>,
) {
  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // visualViewport, not innerHeight: with the software keyboard up the two
    // disagree by ~300px, and the keyboard is exactly when a filter gets opened
    // right after typing in the search box.
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewH = vv?.height ?? window.innerHeight;

    const below = viewTop + viewH - rect.bottom - MENU_GAP - MENU_MARGIN;
    const above = rect.top - viewTop - MENU_GAP - MENU_MARGIN;
    // The natural height decides whether a flip is warranted at all: a short
    // menu that fits below must not jump above just because there is more room
    // up there. `.ddMenu` hides with visibility/opacity, not display, so it is
    // laid out and measurable while closed.
    const natural = menuRef.current?.scrollHeight ?? 0;

    const place = below >= Math.max(MENU_MIN_DOWN, natural) || below >= above ? "down" : "up";
    anchor.dataset.place = place;
    anchor.style.setProperty(
      "--menu-max-h",
      `${Math.max(MENU_MIN_DOWN, Math.round(place === "down" ? below : above))}px`,
    );
  }, [anchorRef, menuRef]);

  useEffect(() => {
    if (!open) return;
    measure();
    const vv = window.visualViewport;
    // capture: the page scroller is an inner element, so a bubbling document
    // listener would never see its scroll event.
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      document.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [open, measure]);
}

function Pager({
  page,
  total,
  per,
  onGo,
}: {
  page: number;
  total: number;
  per: number;
  onGo: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (total <= per) return null;
  return (
    <div className={styles.pager}>
      <button
        className={styles.pagerBtn}
        type="button"
        disabled={page <= 1}
        onClick={() => onGo(Math.max(1, page - 1))}
      >
        <Icon id="i-chevl" />
        Prev
      </button>
      <button
        className={styles.pagerBtn}
        type="button"
        disabled={page >= pages}
        onClick={() => onGo(Math.min(pages, page + 1))}
      >
        Next
        <Icon id="i-chevr" />
      </button>
      <span className={styles.pagerInfo}>
        {page} / {pages}
      </span>
    </div>
  );
}

export function MobileProposals({ rows }: { rows?: ProposalRow[] }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<ProposalRow[]>(() => rows ?? []);
  // Only the shell-mounted copy loads its own book; the standalone route is
  // server-rendered and arrives with rows already in hand.
  const [loading, setLoading] = useState(rows === undefined);
  // Re-seed when the SERVER hands down a new book — router.refresh() after a
  // write re-runs the page's query, and the local optimistic copy has to give
  // way to it. React's documented "adjust state when a prop changes" shape:
  // compare against the last prop seen, during render, no effect involved.
  const [seenRows, setSeenRows] = useState(rows);
  if (rows !== undefined && rows !== seenRows) {
    setSeenRows(rows);
    setData(rows);
  }
  const [tab, setTab] = useState<TabKey>("all");
  const [filter, setFilter] = useState<FilterKey>("ALL");
  /** The type strip's pick (2026-10-17, lib/proposalKind): every tab, list and figure narrows to one family. */
  const [kind, setKind] = useState<"ALL" | WorkFamily>("ALL");
  const [pageAll, setPageAll] = useState(1);
  const [pageAcc, setPageAcc] = useState(1);
  const [pageDone, setPageDone] = useState(1);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  // "Send to client" as a step in the sheet (owner, 2026-10-13): the client's
  // email shown and editable — and a name for a proposal with no client yet.
  const [sendAsk, setSendAsk] = useState<{ email: string; name: string; err: string } | null>(null);
  // "Send invoice" as a step in the sheet (2026-10-23): the stage, then how the client pays — card, bank or
  // their choice — as on the desk. The rails a company has are read the first time the step opens.
  const [invAsk, setInvAsk] = useState<{ instId: string | null; what: string; err: string } | null>(null);
  const [invOpts, setInvOpts] = useState<{ card: boolean; bank: boolean; cardVia: string[] } | null>(null);
  /** Guards a second write while one is on the wire. */
  const [writing, setWriting] = useState(false);
  /** One-line report for a write that succeeded or refused. */
  const [note, setNote] = useState<{ tone: "ok" | "bad" | "live"; text: string } | null>(null);
  /* The Type menu on the filter bar (owner, 2026-10-18). Its placement AND the
     outside-tap closer share one node: useMenuPlacement caps the panel at the
     room actually left under the trigger and flips it above when there is more
     room there — an absolutely positioned box does not lengthen the scroller it
     overflows, so a menu hanging off the bottom edge would be unreachable. */
  const [typeOpen, setTypeOpen] = useState(false);
  /* Status is a dropdown beside Type (owner, 2026-10-20), on the same rules. */
  const [statusOpen, setStatusOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement>(null);
  const typeMenuRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  useMenuPlacement(typeOpen, typeRef, typeMenuRef);
  useMenuPlacement(statusOpen, statusRef, statusMenuRef);

  /* ---------- the book, when nobody handed one down -------------------
     Only the shell-mounted copy gets here (rows === undefined). The rows
     the standalone route passes are reconciled during render, above. */
  useEffect(() => {
    if (rows !== undefined) return;
    let alive = true;
    loadProposalBook()
      .then((book) => {
        if (alive) setData(book);
      })
      .catch(() => {
        if (alive) setNote({ tone: "bad", text: "Couldn't load your proposals. Reload the page." });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [rows]);

  /* ---------- the note clears itself ---------------------------------- */
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 4200);
    return () => window.clearTimeout(id);
  }, [note]);

  /* ---------- Status / Type menus: close on outside tap / Esc --------- */
  useEffect(() => {
    if (!typeOpen && !statusOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!typeRef.current?.contains(e.target as Node)) setTypeOpen(false);
      if (!statusRef.current?.contains(e.target as Node)) setStatusOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTypeOpen(false);
        setStatusOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [typeOpen, statusOpen]);

  /* ---------- viewport height + effective-width classes --------------
     Mandatory rule: viewport heights only via var(--app-h). A phone's URL
     bar changes innerHeight mid-scroll, so the real value is republished
     rather than trusting a bare 100vh/100dvh. This is the React form of
     the donor's FLUID SCALE module — no root zoom, since the composition
     here is already the handheld one. */
  useEffect(() => {
    const apply = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${h}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    const releaseScroll = lockScroll();
    return () => {
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-h");
      releaseScroll();
    };
  }, []);

  /* ---------- Motion: reveal on load + adaptive reveal on scroll ------
     Runs once the book has landed: before that the content block is a single
     placeholder, and observing it would spend the cascade on nothing. */
  useEffect(() => {
    if (loading) return;
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    let velLastY = host.scrollTop;
    let velLastT = performance.now();
    let vel = 0;
    const onScroll = () => {
      const now = performance.now();
      vel = Math.abs(host.scrollTop - velLastY) / Math.max(1, now - velLastT);
      velLastY = host.scrollTop;
      velLastT = now;
    };
    host.addEventListener("scroll", onScroll, { passive: true });

    const vpH = window.innerHeight;
    const blocks = Array.from(content.children) as HTMLElement[];
    blocks.forEach((el, i) => {
      el.classList.add(styles.rv);
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${i * 60}ms` : "200ms";
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          // Below the fold: duration follows scroll speed — slow ≈ 900ms,
          // fast never shorter than 550ms.
          if (t.dataset.rvScroll) {
            t.style.transitionDuration = `${Math.round(Math.max(550, 900 - vel * 160))}ms`;
          }
          t.classList.add(styles.rvIn);
          io.unobserve(t);
          const done = () => {
            t.style.transitionDelay = "";
            t.style.transitionDuration = "";
            t.removeEventListener("transitionend", done);
          };
          t.addEventListener("transitionend", done);
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      host.removeEventListener("scroll", onScroll);
    };
  }, [loading]);

  /* ---------- Motion: graph-paper parallax --------------------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        // --grid-y is registered non-inheriting (globals.css), so this restyles the scroller and its
        // grid ::before only, not every row under it.
        host.style.setProperty("--grid-y", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp (delegated, covers late rows) ------- */
  /** A tap on a proposal row or a contract's header opens the proposal; the
   *  ⋯ button and every other control inside keep their own tap. */
  const openFromTap = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
    router.push(`/dashboard/proposals/${id}`);
  };

  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const sel = [
      styles.btn, styles.ptab, styles.ddBtn, styles.ddItem, styles.pagerBtn, styles.btnStamp,
      styles.pjobAct, styles.pmenuItem, styles.sheetCancel,
      styles.prowOpen, styles.pschedRem,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);


  /* ---------- Esc closes what the PAGE owns -----------------------------
     The drawer is no longer listed here: MobileNav handles its own Escape, and
     it only binds while open, so the two listeners cannot both claim one key
     press. The filter dropdown has its own handler for the same reason. */
  useEffect(() => {
    if (sheetId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSheetId(null);
      setConfirmDel(false);
      setSendAsk(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetId]);

  /* ---------- derived lists ------------------------------------------ */
  // THE TYPE STRIP (2026-10-17): the families of work the book holds; a pick that left the book reads as All.
  const kindChips = useMemo(() => familyCounts(data.map((p) => ({ family: p.kind?.family ?? "other" }))), [data]);
  const kindNow = kind !== "ALL" && !kindChips.some((f) => f.key === kind) ? "ALL" : kind;
  const book = useMemo(() => (kindNow === "ALL" ? data : data.filter((p) => (p.kind?.family ?? "other") === kindNow)), [data, kindNow]);
  const pickKind = (k: "ALL" | WorkFamily) => { setKind(k); setPageAll(1); setPageAcc(1); setPageDone(1); };
  // A project's proposals sit together under its name (2026-09-18).
  const listAll = useMemo(
    () => chained(filter === "ALL" ? book : book.filter((p) => p.status === filter)),
    [book, filter],
  );
  const chains = useMemo(() => chainsOf(listAll), [listAll]);
  const listAcc = useMemo(() => book.filter((p) => p.status === "ACCEPTED"), [book]);
  const listDone = useMemo(() => book.filter((p) => p.status === "COMPLETED" || p.status === "PAID"), [book]);

  const counts = useMemo(
    () => ({ all: book.length, accepted: listAcc.length, completed: listDone.length }),
    [book.length, listAcc.length, listDone.length],
  );
  const chipCounts = useMemo(() => {
    const out: Record<string, number> = { ALL: book.length };
    FILTERS.forEach((f) => {
      if (f.key !== "ALL") out[f.key] = book.filter((p) => p.status === f.key).length;
    });
    return out;
  }, [book]);

  /* ---------- masthead: one numeral, mono kicker, TWO annotations ----- */
  const mast = useMemo(() => {
    if (tab === "all") {
      // THE PIPELINE IS EVERYTHING STILL ON THE TABLE OR WON (owner,
      // 2026-09-02): drafts, sent, viewed, accepted and paid. Only a declined
      // or expired sheet is out of it. The first cut summed the three OPEN
      // statuses alone, so a book of one accepted and one declined proposal
      // read "$0 · 0 proposals" — under two rows that plainly existed. The
      // COUNT is the whole book, declined included: a declined proposal is
      // still a proposal that was written.
      const counted = book.filter((p) => p.status !== "DECLINED" && p.status !== "EXPIRED");
      const t = sumOf(counted);
      return {
        kicker: "Pipeline value",
        value: t,
        good: false,
        a1: { l: "Proposals", v: String(book.length) },
        a2: { l: "Avg deal", v: money(counted.length ? t / counted.length : 0) },
      };
    }
    if (tab === "accepted") {
      const t = sumOf(listAcc);
      return {
        kicker: "Contracted · signed",
        value: t,
        good: false,
        a1: { l: "Contracts", v: String(listAcc.length) },
        a2: { l: "Avg value", v: money(listAcc.length ? t / listAcc.length : 0) },
      };
    }
    const t = sumOf(listDone);
    return {
      kicker: "Collected · paid",
      value: t,
      good: true,
      a1: { l: "Jobs filed", v: String(listDone.length) },
      a2: { l: "Avg value", v: money(listDone.length ? t / listDone.length : 0) },
    };
  }, [tab, book, listAcc, listDone]);

  /* ---------- paging returns you to the top of the list ---------------
     Done in an effect rather than in the click handler: the ref must not
     be read during render, and the scroll belongs to the page CHANGE, not
     to the button. The first run is skipped so mounting doesn't scroll. */
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [pageAll, pageAcc, pageDone]);

  /* ================= WRITES (real server actions) =====================
     Every one of these is the action the desktop row menu calls, org- and
     owner-scoped on the server and revalidating /dashboard/proposals. Local
     state is patched from the result so the surface repaints immediately;
     router.refresh() re-reads the same rows for the server-rendered entry. */
  const resetPages = () => {
    setPageAll(1);
    setPageAcc(1);
    setPageDone(1);
  };
  const patch = (id: string, fn: (p: ProposalRow) => ProposalRow) => {
    setData((prev) => prev.map((p) => (p.id === id ? fn({ ...p }) : p)));
    resetPages();
  };
  const todayPlate = () =>
    new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase();

  async function runStatus(p: ProposalRow, status: "ACCEPTED" | "PAID" | "DRAFT", ok: string) {
    if (writing) return;
    setWriting(true);
    try {
      const res = await updateProposalStatus(p.id, status);
      if (!res.ok) {
        setNote({
          tone: "bad",
          text:
            res.reason === "provider_paid"
              ? "Paid through Stripe / Square — refund from that dashboard and it syncs back."
              : "A proposal with paid stages can't go back to draft.",
        });
        return;
      }
      patch(p.id, (x) => ({
        ...x,
        status,
        updated: "just now",
        accepted: status === "DRAFT" ? undefined : status === "ACCEPTED" ? todayPlate() : x.accepted,
        paid: status === "PAID" ? todayPlate() : undefined,
      }));
      setNote({ tone: "ok", text: ok });
      router.refresh();
    } catch (err) {
      setNote({ tone: "bad", text: actionError(err) });
    } finally {
      setWriting(false);
    }
  }

  /** Mark a stage paid by hand. ONE TAP (owner, 2026-09-03): the in-place
   *  bank / cash / check picker read as the button breaking into three, and
   *  the stage was not recorded until one was pressed. The stage's own amount
   *  is recorded as a manual payment; the book is re-read afterwards so the
   *  row shows the frozen amount the server recorded. */
  async function runMarkPaid(instId: string) {
    if (writing) return;
    setWriting(true);
    /* OPTIMISTIC, AND VISIBLY IN FLIGHT — same reasoning as the desk build.
       The action re-reads the whole book before it answers, which on a cold
       server is seconds of a screen that has not moved. The stage reads
       "Paid" on the same frame as the tap, the card dims while the request
       is out, and the note strip carries a spinner. The refetch below is
       still the source of truth, and a failure restores the snapshot. */
    const snapshot = data;
    const plate = todayPlate();
    setData((prev) =>
      prev.map((row) => {
        const stage = row.inst?.find((i) => i.id === instId);
        if (!stage) return row;
        // The money moves with the stage (2026-10-23) — a part payment is not re-read.
        const amt = instDollars(row, stage);
        return {
          ...row,
          paidAmt: Math.round(((row.paidAmt ?? 0) + amt) * 100) / 100,
          owed: Math.max(0, Math.round((row.owed - amt) * 100) / 100),
          inst: row.inst?.map((i) => (i.id === instId ? { ...i, status: "PAID", paidVia: "MANUAL", paidAmt: amt, paidOn: plate } : i)),
        };
      }),
    );
    setNote({ tone: "live", text: "Recording payment…" });
    try {
      const res = await markInstallmentPaid({ installmentId: instId, method: "OTHER" });
      // Re-read only when the answer can differ — see the desk build's note.
      // A part payment is already on screen; a payment that settles the
      // schedule waives the rest and moves the card, so that one re-reads.
      if (res.outcome !== "settled" || res.proposalPaid) {
        setData(await loadProposalBook());
      }
      setNote({ tone: "ok", text: "Payment recorded." });
      router.refresh();
    } catch (err) {
      setData(snapshot);
      setNote({ tone: "bad", text: actionError(err) });
    } finally {
      setWriting(false);
    }
  }

  /** Remind / Request payment. An empty instalment id is the whole outstanding
   *  balance — notifyPaymentReminder's own documented fallback. */
  async function runReminder(p: ProposalRow, installmentId: string) {
    if (writing) return;
    setWriting(true);
    try {
      const res = await notifyPaymentReminder({ proposalId: p.id, installmentId });
      if (res.skipped) {
        setNote({
          tone: "bad",
          text:
            res.reason === "no-client-email"
              ? "This client has no email on file. Add one on the client record."
              : "That proposal is no longer available to you.",
        });
      } else {
        setNote({ tone: "ok", text: `Reminder sent to ${p.clientEmail ?? p.client}.` });
      }
    } catch (err) {
      setNote({ tone: "bad", text: actionError(err) });
    } finally {
      setWriting(false);
    }
  }

  async function runSend(p: ProposalRow, to: { email: string; name: string }) {
    if (writing) return;
    const email = to.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSendAsk({ ...to, err: "That email address doesn't look right." });
      return;
    }
    // The first send to a client names the business first (lib/orgName).
    if (!(await ensureCompanyName())) return;
    setWriting(true);
    try {
      // The typed address goes onto the client record first (sendProposal), or
      // makes the client for a proposal that has none.
      const r = await sendProposal(p.id, email ? { email, name: to.name.trim() } : undefined);
      patch(p.id, (x) => ({
        ...x,
        status: statusAfterSend(x.status),
        sentAgo: "just now",
        updated: "just now",
        clientEmail: r.to ?? x.clientEmail,
        ...(r.clientId ? { clientId: r.clientId, client: r.client ?? x.client } : {}),
      }));
      setSendAsk(null);
      setSheetId(null);
      setNote({
        tone: "ok",
        text: r.to ? `Sent to ${r.to}.` : "Marked sent — no email went out, there is no client email.",
      });
      router.refresh();
    } catch (err) {
      setSendAsk({ ...to, err: actionError(err) });
    } finally {
      setWriting(false);
    }
  }

  /** The card's Send / Send again: the sheet's send step, straight away. */
  function openSend(p: ProposalRow) {
    setSheetId(p.id);
    setConfirmDel(false);
    setInvAsk(null);
    setSendAsk({ email: p.clientEmail ?? "", name: "", err: "" });
  }
  /** The card's Invoice: the sheet's invoice step for the next stage (or the balance). */
  function openInvoice(p: ProposalRow, it: Installment | null) {
    setSheetId(p.id);
    setConfirmDel(false);
    setSendAsk(null);
    setInvAsk({ instId: it?.id ?? null, what: it ? `${it.label} · ${money(instDollars(p, it))}` : `The balance · ${money(p.owed)}`, err: "" });
    if (!invOpts) {
      getInvoiceOptions().then(setInvOpts, () => setInvOpts({ card: false, bank: false, cardVia: [] }));
    }
  }
  async function runInvoice(p: ProposalRow, method: "card" | "bank" | "any") {
    if (writing || !invAsk) return;
    const ask = invAsk;
    setWriting(true);
    try {
      const r = await sendInstallmentInvoice(p.id, ask.instId, method);
      if (!r.ok) {
        setInvAsk({ ...ask, err: r.error ?? "Couldn't send the invoice." });
        return;
      }
      // sendInvoice stamps the stage (Installment.invoiceSentAt); the card says so at once.
      patch(p.id, (x) => ({ ...x, inst: x.inst?.map((i) => (i.id === ask.instId ? { ...i, invoiced: "just now", invoiceVia: method } : i)) }));
      setInvAsk(null);
      setSheetId(null);
      setNote({ tone: "ok", text: `Invoice sent — ${r.label}, ${money(r.amount)}.` });
    } catch (err) {
      setInvAsk({ ...ask, err: actionError(err) });
    } finally {
      setWriting(false);
    }
  }

  async function runDuplicate(p: ProposalRow) {
    if (writing) return;
    setWriting(true);
    try {
      const res = await duplicateProposal(p.id);
      // The copy's publicId is generated server-side and is not returned, so
      // there is nothing honest to append to the list here — open the copy in
      // the editor, which is what "Clone & edit" meant on the desktop menu.
      router.push(`/dashboard/proposals/${res.id}`);
    } catch (err) {
      setNote({ tone: "bad", text: actionError(err) });
      setWriting(false);
    }
  }

  async function runDelete(p: ProposalRow) {
    if (writing) return;
    setWriting(true);
    try {
      const res = await bulkDeleteProposals([p.id]);
      if (res.deleted === 0) {
        setNote({ tone: "bad", text: "That proposal is no longer yours to delete." });
        return;
      }
      setData((prev) => prev.filter((x) => x.id !== p.id));
      resetPages();
      setNote({ tone: "ok", text: `"${p.title}" deleted.` });
      router.refresh();
    } catch (err) {
      setNote({ tone: "bad", text: actionError(err) });
    } finally {
      setWriting(false);
      setSheetId(null);
      setConfirmDel(false);
    }
  }

  /** Before / After completion shot → uploadProposalPhoto(). Stored on the
   *  proposal (Vercel Blob when configured, inline data URL if not). */
  async function runPhotoUpload(p: ProposalRow, slot: "before" | "after", file: File) {
    if (writing) return;
    setWriting(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("Couldn't read that file."));
        fr.readAsDataURL(file);
      });
      const photo = await uploadProposalPhoto(p.id, dataUrl, file.name, slot);
      patch(p.id, (x) => ({
        ...x,
        before: slot === "before" ? [...x.before, photo] : x.before,
        after: slot === "after" ? [...x.after, photo] : x.after,
      }));
      setNote({ tone: "ok", text: `${slot === "before" ? "Before" : "After"} photo added.` });
      router.refresh();
    } catch (err) {
      setNote({ tone: "bad", text: actionError(err) });
    } finally {
      setWriting(false);
    }
  }

  const sheetProposal = sheetId === null ? null : (data.find((p) => p.id === sheetId) ?? null);

  // Swipe-down dismissal, on the same close path as Escape and the scrim.
  const sheetDrag = useSheetDrag(sheetProposal !== null, () => {
    setSheetId(null);
    setConfirmDel(false);
    setSendAsk(null);
  });

  const menuRows = useMemo<MenuRow[]>(() => {
    const p = sheetProposal;
    if (!p) return [];
    const isDraft = p.status === "DRAFT";
    const isAcc = p.status === "ACCEPTED";
    // The desktop menu's groups and hues (2026-09-25): open it, share it with
    // the client, the contract, the rest — the group's main action solid.
    return [
      { act: "open", icon: "i-file", tone: styles.pmiBpSolid, title: "Open proposal", sub: "Edit the full document", group: "Open" },
      // "Client view" (owner, 2026-10-13): the page the client gets, by its own name.
      { act: "public", icon: "i-arrow", tone: styles.pmiBp, title: "Client view", sub: "The page the client gets" },
      { act: "send", icon: "i-send", tone: styles.pmiOkSolid, title: "Send to client",
        sub: p.clientEmail ?? (p.clientId ? "No email yet — add it when you send" : "No client yet — add them when you send"),
        group: "Share with client" },
      // The client's link, copied or handed to the phone's messages (2026-09-24).
      { act: "copylink", icon: "i-out", tone: styles.pmiOk, title: "Copy client link", sub: "Paste it into a text" },
      { act: "accept", icon: "i-check", tone: styles.pmiWarnSolid,
        title: isAcc ? "Already accepted" : "Mark accepted",
        sub: isAcc ? `Signed ${p.accepted ?? ""}` : "Move it into contracts", disabled: isAcc, group: "Contract" },
      { act: "remind", icon: "i-card", tone: styles.pmiWarn, title: "Send payment reminder",
        sub: isDraft
          ? "Draft — nothing sent yet"
          : p.clientEmail
            ? "Nudge the client by email"
            : "No email on the client record",
        disabled: isDraft || !p.clientEmail },
      { act: "dir", icon: "i-pin", tone: styles.pmiInk, title: "Get directions",
        sub: p.maps ? `${p.city || "Client address"} — open in maps` : "No address on client",
        disabled: !p.maps },
      { act: "del", icon: "i-trash", tone: styles.pmiDanger, title: "Delete", sub: "Remove permanently", danger: true },
    ];
  }, [sheetProposal]);

  const runMenu = (act: string) => {
    const p = sheetProposal;
    if (!p) return;
    if (act === "del") {
      // Two-step in the sheet rather than a native confirm(): the delete is
      // permanent and CLAUDE.md prefers sheets to dialogs on handheld.
      setConfirmDel(true);
      return;
    }
    if (act === "send") {
      setSendAsk({ email: p.clientEmail ?? "", name: "", err: "" });
      return;
    }
    setSheetId(null);
    if (act === "open") router.push(`/dashboard/proposals/${p.id}`);
    else if (act === "public") window.open(`/portal/q/${p.publicId}`, "_blank", "noopener,noreferrer");
    else if (act === "copylink") {
      const url = clientProposalUrl(p.publicId);
      navigator.clipboard.writeText(url).then(
        () => setNote({ tone: "ok", text: "Client link copied — paste it into a text." }),
        () => setNote({ tone: "bad", text: `Couldn't copy. The link: ${url}` }),
      );
    } else if (act === "textlink") window.location.assign(smsHref(null, proposalTextMessage({ clientName: p.client, title: p.title, link: clientProposalUrl(p.publicId) })));
    else if (act === "dup") void runDuplicate(p);
    else if (act === "remind") void runReminder(p, "");
    else if (act === "accept") void runStatus(p, "ACCEPTED", `"${p.title}" moved into contracts.`);
    else if (act === "dir" && p.maps) window.open(p.maps, "_blank", "noopener,noreferrer");
  };

  const sliceAll = listAll.slice((pageAll - 1) * PAGE_ALL, pageAll * PAGE_ALL);
  const sliceAcc = listAcc.slice((pageAcc - 1) * PAGE_ACC, pageAcc * PAGE_ACC);
  const sliceDone = listDone.slice((pageDone - 1) * PAGE_DONE, pageDone * PAGE_DONE);
  const tabIndex = TABS.findIndex((t) => t.key === tab);

  return (
    <div className={styles.app} onClick={onRootClick}>

      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, so the page holds none. */}
      <MobileNav />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD */}
          <div className={styles.pageHead}>
            <div className={styles.kicker}>Sales · Documents</div>
            <h1 className={styles.pageTitle}>Proposals</h1>
            <div className={styles.pageActions}>
              {/* One creation route here, as on the desk (owner, 2026-10-20:
                  Smart Proposal left the list). An anchor: a navigation that
                  works without JavaScript. Same destination as the desktop
                  proposals page and the estimator picker's "Manual" card —
                  the wired blueprint builder, one URL for both viewports. */}
              <Link
                className={`${styles.btn} ${styles.btnGhost}`}
                href="/dashboard/manual-blueprint"
              >
                <Icon id="i-file" />Manual proposal
              </Link>
            </div>
          </div>

          {loading ? (
            <div className={styles.pempty}>Loading your proposals…</div>
          ) : (
          <>
          {/* MASTHEAD — key on tab so the 320ms slide-in replays */}
          <div className={`${styles.pmast} ${styles.slide}`} key={tab}>
            <div className={styles.pmastTop}>
              <div className={styles.pmastLbl}>
                {mast.kicker}
                <span className={styles.pmastRule} />
              </div>
              <CountUp value={mast.value} className={`${styles.pmastVal} ${mast.good ? styles.isGood : ""}`} />
            </div>
            <div className={styles.pmastCnt}>
              {[mast.a1, mast.a2].map((a) => (
                <div className={styles.pmastSub} key={a.l}>
                  <div className={styles.pmastSubL}>{a.l}</div>
                  <div className={styles.pmastSubV}>{a.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* TABS */}
          <div className={styles.ptabs} data-active={tab}>
            <span className={styles.ptabInd} style={{ transform: `translateX(${tabIndex * 100}%)` }} />
            {TABS.map((t) => (
              <button key={t.key} className={`${styles.ptab} ${tab === t.key ? styles.active : ""}`}
                type="button" data-tab={t.key} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}>
                {t.label}
                <span className={styles.ptabCount}>{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {/* FILTERS (owner, 2026-10-20): one row under the tabs, two
              Blueprint dropdowns — STATUS (the All list's statuses, All tab
              only) and TYPE (deck · roof · fence · HVAC · remodel · other,
              each with its tool's flat square). Each menu opens across the
              whole row. Type narrows every tab, so it stays on all three. */}
          {tab === "all" || kindChips.length > 1 ? (
            <div className={styles.fbar}>
              {tab === "all" ? (
                <div className={`${styles.fdrop} ${statusOpen ? styles.open : ""} ${filter !== "ALL" ? styles.isSet : ""}`} ref={statusRef}>
                  <button className={styles.fdropBtn} type="button" aria-haspopup="listbox"
                    aria-expanded={statusOpen} onClick={() => { setStatusOpen((v) => !v); setTypeOpen(false); }}>
                    <span className={styles.fdropKey}>Status</span>
                    <span className={styles.fdropVal}>
                      {FILTERS.find((f) => f.key === filter)?.label}
                      <span className={styles.fsegN}>{chipCounts[filter] ?? 0}</span>
                    </span>
                    <Icon id="i-chev" className={`${styles.ic} ${styles.fdropCaret}`} />
                  </button>
                  <div className={styles.fmenu} role="listbox" aria-label="Status" ref={statusMenuRef}>
                    {FILTERS.map((f) => (
                      <button key={f.key} className={`${styles.fitem} ${filter === f.key ? styles.on : ""}`}
                        type="button" role="option" aria-selected={filter === f.key}
                        onClick={() => { setFilter(f.key); setPageAll(1); setStatusOpen(false); }}>
                        {f.label}
                        <span className={styles.fsegN}>{chipCounts[f.key] ?? 0}</span>
                        {filter === f.key ? <Icon id="i-check" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {kindChips.length > 1 ? (
                <div className={`${styles.fdrop} ${typeOpen ? styles.open : ""} ${kindNow !== "ALL" ? styles.isSet : ""}`} ref={typeRef}>
                  <button className={styles.fdropBtn} type="button" aria-haspopup="listbox"
                    aria-expanded={typeOpen} onClick={() => { setTypeOpen((v) => !v); setStatusOpen(false); }}>
                    <span className={styles.fdropKey}>Type</span>
                    <span className={styles.fdropVal}>
                      {kindNow === "ALL" ? (
                        "All"
                      ) : (
                        <><i className={styles.fdot} data-fam={kindNow} aria-hidden="true" />{kindChips.find((f) => f.key === kindNow)?.label}</>
                      )}
                    </span>
                    <Icon id="i-chev" className={`${styles.ic} ${styles.fdropCaret}`} />
                  </button>
                  <div className={styles.fmenu} role="listbox" aria-label="Type of work" ref={typeMenuRef}>
                    {[{ key: "ALL" as const, label: "All types", count: data.length }, ...kindChips].map((f) => (
                      <button key={f.key} className={`${styles.fitem} ${kindNow === f.key ? styles.on : ""}`}
                        type="button" role="option" aria-selected={kindNow === f.key}
                        onClick={() => { pickKind(f.key); setTypeOpen(false); }}>
                        <i className={styles.fdot} data-fam={f.key === "ALL" ? undefined : f.key} aria-hidden="true" />
                        {f.label}
                        <span className={styles.fsegN}>{f.count}</span>
                        {kindNow === f.key ? <Icon id="i-check" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ============ TAB: ALL ============ */}
          {tab === "all" && (
            listAll.length === 0 ? (
              <div className={styles.pempty}>
                {data.length === 0
                  ? "No proposals yet — start one with Manual proposal above."
                  : "No proposals match this filter."}
              </div>
            ) : (
              <div className={styles.cmList}>
                {sliceAll.map((p, i) => {
                  const st = statusPlate(p.status);
                  const c = p.projectId ? chains.get(p.projectId) : undefined;
                  const inChain = Boolean(c && c.count > 1);
                  const at = (pageAll - 1) * PAGE_ALL + i;
                  const first = inChain && (i === 0 || listAll[at - 1]?.projectId !== p.projectId);
                  const last = inChain && listAll[at + 1]?.projectId !== p.projectId;
                  return (
                    <Fragment key={p.id}>
                    {first && c ? (
                      <Link className={styles.pgrp} href={`/dashboard/projects/${c.id}`}>
                        <Icon id="i-folder" className={styles.pgrpIc} />
                        <span className={styles.pgrpTxt}>
                          <span className={styles.pgrpName}>{c.name}</span>
                          <span className={styles.pgrpMeta}>
                            {c.count} proposals
                            {c.sold ? ` · ${money(c.sold)} sold` : ""}
                            {c.open ? ` · ${money(c.open)} open` : ""}
                            {i === 0 && listAll[at - 1]?.projectId === p.projectId ? " · continued" : ""}
                          </span>
                        </span>
                      </Link>
                    ) : null}
                    <article className={`${styles.cm} ${styles.rowIn}${inChain ? " " + styles.cmChain : ""}${last ? " " + styles.cmChainEnd : ""}`} style={{ animationDelay: `${i * 45}ms` }} data-mrow={p.id}
                      role="link" tabIndex={0} aria-label={`Open ${p.title}`}
                      onClick={(e) => openFromTap(e, p.id)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/dashboard/proposals/${p.id}`); }}>
                      <div className={styles.cmJob}>
                        {/* The owner only when it is someone else (2026-09-25). */}
                        {p.mine ? null : (
                          <div className={styles.prowId}>{p.ownerWho ? <Who who={p.ownerWho} compact /> : p.owner}</div>
                        )}
                        <KindMark k={p.kind} />
                        <div className={styles.cmTitle}>{p.title}</div>
                        {p.client || p.city || (p.projectName && !inChain) ? (
                          <div className={styles.cmSub}>
                            {[p.client, p.city].filter(Boolean).join(" · ")}
                            {p.projectName && !inChain ? <span className={styles.prowProj}> · {p.projectName}</span> : null}
                          </div>
                        ) : null}
                        {/* The client's deck design on this proposal (2026-10-13): where it stands; Open when it came back. */}
                        {p.clientDesign ? (
                          <div className={`${styles.prowClient}${p.clientDesign.unseen ? " " + styles.prowClientNew : p.clientDesign.standing === "returned" ? " " + styles.prowClientBack : ""}`} data-client-design={p.clientDesign.standing}>
                            <Icon id="i-deck" />
                            <span>{p.clientDesign.line}</span>
                            {p.clientDesign.draftId ? <Link href={`/dashboard/deck-estimator?draft=${p.clientDesign.draftId}`} onClick={(e) => e.stopPropagation()}>Open design</Link> : null}
                          </div>
                        ) : null}
                        <dl className={styles.cmFacts}>
                          <div className={styles.cmF}>
                            <dt>Status</dt>
                            <dd>
                              <span className={`${styles.pstatus} ${st.cls ? styles[st.cls] : ""}`}>{st.label}</span>
                              {p.decided ? <small className={p.status === "DECLINED" ? styles.prowDeclined : styles.prowAccepted}>{p.decided}</small> : null}
                            </dd>
                          </div>
                          <div className={styles.cmF}><dt>Views</dt><dd><Views p={p} /></dd></div>
                          <div className={styles.cmF}><dt>Updated</dt><dd>{p.updated}</dd></div>
                        </dl>
                      </div>
                      <CardMoney p={p} writing={writing}
                        onMarkPaid={(it) => void runMarkPaid(it.id)}
                        onInvoice={(it) => openInvoice(p, it)}
                        onRemind={(it) => void runReminder(p, it?.id ?? "")} />
                      <div className={styles.cmFoot}>
                        <Link className={`${styles.cmCell} ${styles.cmOpen}`} href={`/dashboard/proposals/${p.id}`}><Icon id="i-file" />Open</Link>
                        <CardSend p={p} onSend={() => openSend(p)} />
                        <button className={`${styles.cmCell} ${styles.cmMore}`} type="button"
                          aria-label={`More actions for ${p.title}`} onClick={() => setSheetId(p.id)}>
                          <Icon id="i-dots" />
                        </button>
                      </div>
                    </article>
                    </Fragment>
                  );
                })}
              </div>
            )
          )}
          {tab === "all" && (
            <Pager page={pageAll} total={listAll.length} per={PAGE_ALL} onGo={setPageAll} />
          )}

          {/* ============ TAB: ACCEPTED — contract dossiers ============ */}
          {tab === "accepted" && (
            listAcc.length === 0 ? (
              <div className={styles.pempty}>No accepted contracts yet — send a proposal to get one signed.</div>
            ) : (
              <div className={styles.pstack}>
                {sliceAcc.map((p, i) => {
                  const inst = p.inst ?? [];
                  return (
                    <div key={p.id} className={`${styles.pjob} ${styles.rowIn}`} style={{ animationDelay: `${i * 60}ms` }}>
                      <div className={`${styles.pjobHead} ${styles.prowTap}`} role="link" tabIndex={0} aria-label={`Open ${p.title}`}
                        onClick={(e) => openFromTap(e, p.id)} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/dashboard/proposals/${p.id}`); }}>
                        <KindMark k={p.kind} />
                        <div className={styles.pjobTitle}>{p.title}</div>
                        <div className={styles.pjobSub}>
                          <span>{p.client}</span>{p.city ? <span>{p.city}</span> : null}
                          <span className={styles.pjobSubLine}>signed {p.accepted ?? "—"}</span>
                        </div>
                        <div className={styles.pjobTotal}>
                          <div className={styles.pjobTotalL}>Contract value</div>
                          <div className={styles.pjobTotalV}>{money(p.contract ?? p.total)}</div>
                          <PaymentSummary p={p} />
                        </div>
                      </div>

                      {/* ≤5 instalments → columns; 6+ → row table with Remind */}
                      {inst.length === 0 ? null : inst.length <= 5 ? (
                        <div className={styles.pcols}>
                          {inst.map((it) => {
                            const paid = it.status === "PAID";
                            const sub = paid
                              ? `Paid · ${it.paidVia === "STRIPE" ? "Stripe" : it.paidVia === "SQUARE" ? "Square" : "manual"}`
                              : it.pct ? `${it.amount}% of total` : it.due ? `due ${it.due}` : "";
                            return (
                              <div className={styles.pcol} key={it.id}>
                                <div className={styles.pcolLbl}>{it.label}</div>
                                <div className={styles.pcolVal}>{money(instDollars(p, it))}</div>
                                {sub ? <div className={styles.pcolSub}>{sub}</div> : null}
                                {!paid && it.status !== "WAIVED" ? (
                                  <div className={styles.pcolActs}>
                                    <button className={`${styles.pschedRem} ${styles.remPaid}`} type="button" disabled={writing}
                                      onClick={() => void runMarkPaid(it.id)}><Icon id="i-check" />Mark paid</button>
                                    {/* Real: mails THIS instalment's reminder (2026-10-20, as on the desk). */}
                                    <button className={`${styles.pschedRem} ${styles.remRemind}`} type="button"
                                      disabled={writing || !p.clientEmail}
                                      onClick={() => void runReminder(p, it.id)}><Icon id="i-bell" />Remind</button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={styles.psched}>
                          {inst.map((it) => (
                            <div className={styles.pschedRow} key={it.id}>
                              <div className={styles.pschedLbl}>{it.label}</div>
                              <div className={styles.pschedAmt}>{money(instDollars(p, it))}</div>
                              <div className={styles.pschedDue}>
                                {it.status === "PAID" ? "Paid" : it.due ? `due ${it.due}` : "on completion"}
                              </div>
                              {it.status === "PAID" || it.status === "WAIVED" ? null : (
                                <>
                                  <button className={`${styles.pschedRem} ${styles.remPaid}`} type="button" disabled={writing}
                                    onClick={() => void runMarkPaid(it.id)}>Mark paid</button>
                                  {/* Real: mails THIS instalment's reminder. */}
                                  <button className={`${styles.pschedRem} ${styles.remRemind}`} type="button"
                                    disabled={writing || !p.clientEmail}
                                    onClick={() => void runReminder(p, it.id)}>Remind</button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={styles.pjobFoot}>
                        <button className={`${styles.pjobAct} ${styles.pjobActOk}`} type="button"
                          disabled={writing}
                          onClick={() => void runStatus(p, "PAID", `"${p.title}" filed as completed.`)}>
                          <Icon id="i-check" />Mark completed
                        </button>
                        <button className={`${styles.pjobAct} ${styles.pjobActAccent}`} type="button"
                          disabled={writing || !p.clientEmail}
                          onClick={() => void runReminder(p, "")}>
                          <Icon id="i-card" />Request payment
                        </button>
                        <button className={styles.pjobAct} type="button" onClick={() => setSheetId(p.id)}>
                          <Icon id="i-dots" />More
                        </button>
                        <button className={styles.pjobAct} type="button"
                          disabled={writing}
                          onClick={() => void runStatus(p, "DRAFT", `"${p.title}" is back in draft.`)}>
                          <Icon id="i-rotate" />Un-accept
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
          {tab === "accepted" && (
            <Pager page={pageAcc} total={listAcc.length} per={PAGE_ACC} onGo={setPageAcc} />
          )}

          {/* ============ TAB: COMPLETED — tear-sheets ============ */}
          {tab === "completed" && (
            listDone.length === 0 ? (
              <div className={styles.pempty}>Nothing filed yet — completed jobs land here.</div>
            ) : (
              <div className={styles.psheets}>
                {sliceDone.map((p, i) => (
                  <div key={p.id} className={`${styles.psheet} ${styles.rowIn}`} style={{ animationDelay: `${i * 60}ms` }}>
                    {/* No "Completed" stamp over the title and no "1mo ago" under it (owner, 2026-10-20):
                        the Done tab already says it, and the Paid column says when. */}
                    <div className={styles.psheetHead}>
                      <KindMark k={p.kind} />
                      <div className={styles.pjobTitle}>{p.title}</div>
                      <div className={styles.pjobSub}>
                        <span>{p.client}</span>{p.city ? <span>{p.city}</span> : null}
                      </div>
                    </div>

                    <div className={styles.bankedSummary}>
                      <div className={styles.psheetBanklbl}>Banked</div>
                      <div className={styles.pjobTotalV}>{money(p.paidAmt ?? 0)}</div>
                      <PaymentSummary p={p} />
                    </div>

                    {/* Same .pcols/.pcol classes as Accepted — no parallel set */}
                    <div className={`${styles.pcols} ${styles.pcolsSheet}`}>
                      <div className={styles.pcol}>
                        <div className={styles.pcolLbl}>Contract</div>
                        <div className={styles.pcolVal}>{money(p.contract ?? p.total)}</div>
                        <div className={styles.pcolSub}>{p.mat} material lines</div>
                      </div>
                      <div className={styles.pcol}>
                        <div className={styles.pcolLbl}>Signed</div>
                        <div className={styles.pcolVal}>{p.accepted ?? "—"}</div>
                        <div className={styles.pcolSub}>{p.views > 0 ? `${p.views} view${p.views === 1 ? "" : "s"}${p.lastViewed ? ` · ${p.lastViewed}` : ""}` : "not opened"}</div>
                      </div>
                      <div className={styles.pcol}>
                        <div className={styles.pcolLbl}>Paid</div>
                        <div className={styles.pcolVal}>{p.paid ?? "—"}</div>
                        <div className={styles.pcolSub}>{p.mine ? null : p.ownerWho ? <Who who={p.ownerWho} compact /> : p.owner}</div>
                      </div>
                    </div>

                    {(p.inst ?? []).length > 0 && (
                      <div className={styles.psheetBody}>
                        <div className={styles.psheetSecl}>Payment record</div>
                        {(p.inst ?? []).map((it) => (
                          <div className={styles.pchk} key={it.id}>
                            <span className={styles.pchkIc}><Icon id="i-check" /></span>
                            <span className={styles.pchkLbl}>{it.label}</span>
                            <span className={styles.pchkLead} />
                            <span className={styles.pchkAmt}>{money(instDollars(p, it))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className={styles.psheetBody}>
                      <div className={styles.psheetSecl}>Completion photos</div>
                      <div className={styles.psheetPhotos}>
                        {(["before", "after"] as const).map((slot) => {
                          const shots = slot === "before" ? p.before : p.after;
                          const last = shots[shots.length - 1];
                          const label = slot === "before" ? "Before" : "After";
                          return (
                            // A <label> wrapping a hidden file input: the whole
                            // 116px box is the picker's hit target.
                            <label key={slot}
                              className={`${styles.photoBox} ${last ? styles.photoBoxFilled : ""}`}>
                              {last ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={last.url} alt={`${label} photo`} />
                              ) : (
                                <><Icon id="i-imgplus" />{label}</>
                              )}
                              <input type="file" accept="image/*" hidden disabled={writing}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = "";
                                  if (file) void runPhotoUpload(p, slot, file);
                                }} />
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.psheetFoot}>
                      {/* The donor drew a "Send paid receipt to <email>" box
                          here. There is no receipt transport in the app — no
                          builder in lib/email/build, no action — so the input
                          and its Send button were removed rather than left
                          pretending to mail something. The proposal PDF, which
                          IS a real route, is what a paid client actually asks
                          for, and un-marking the payment is a real write. */}

                      <div className={styles.psheetSend}>
                        <a className={`${styles.btnStamp} ${styles.btnStampAccent}`}
                          href={`/api/proposals/${p.id}/pdf`} target="_blank" rel="noopener noreferrer">
                          <Icon id="i-download" />PDF
                        </a>
                        <button className={styles.btnStamp} type="button" disabled={writing}
                          onClick={() => void runStatus(p, "ACCEPTED", `"${p.title}" is back in contracts.`)}>
                          <Icon id="i-rotate" />Reopen job
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "completed" && (
            <Pager page={pageDone} total={listDone.length} per={PAGE_DONE} onGo={setPageDone} />
          )}
          </>
          )}
        </div>
      </main>

      {/* No floating action button: removed at the owner's call 2026-07-29.
          The two primary actions already live in the page head, so nothing
          needs to hover over the content. */}

      {/* What a write did, or why it refused. Silence would read as "the tap
          did nothing", which is exactly the failure this page had. */}
      {note ? (
        <div
          className={`${styles.note} ${note.tone === "bad" ? styles.noteBad : ""} ${note.tone === "live" ? styles.noteLive : ""}`}
          role="status"
        >
          {/* A live note is a request still out — it carries the spinner, so
              the strip says "working" rather than just stating a fact. */}
          {note.tone === "live" ? <span className={styles.noteSpin} aria-hidden="true" /> : null}
          {note.text}
        </div>
      ) : null}

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div className={`${styles.scrim} ${sheetProposal ? styles.on : ""}`}
        onClick={() => { setSheetId(null); setConfirmDel(false); setSendAsk(null); setInvAsk(null); }} aria-hidden="true" />
      <div className={`${styles.sheet} ${sheetProposal ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Proposal actions" aria-hidden={!sheetProposal} {...sheetDrag.sheetProps}>
        <div className={styles.sheetGrab} {...sheetDrag.handleProps} />
        <div className={styles.sheetHead} {...sheetDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetProposal ? `${sheetProposal.client} · ${money(sheetProposal.total)}` : "Proposal · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetProposal?.title ?? "Actions"}</div>
        </div>
        {confirmDel && sheetProposal ? (
          <div className={styles.sheetBody}>
            <div className={styles.pempty}>
              Deleting removes the proposal, its line items, payment schedule and snapshots.
              Public links stop working, and it can&apos;t be undone.
            </div>
            <button className={`${styles.pmenuItem} ${styles.pmenuItemDanger}`} type="button"
              disabled={writing} onClick={() => void runDelete(sheetProposal)}>
              <span className={`${styles.pmiIc} ${styles.pmiDanger}`}><Icon id="i-trash" /></span>
              <span>
                <span className={styles.pmenuItemT}>Delete forever</span>
                <span className={styles.pmenuItemS}>{sheetProposal.title}</span>
              </span>
            </button>
          </div>
        ) : invAsk && sheetProposal ? (
          <div className={`${styles.sheetBody} ${styles.psend}`} data-invoice-step>
            <p className={styles.psendNote}>
              {invAsk.what} — {sheetProposal.clientEmail ? `the invoice goes to ${sheetProposal.clientEmail}` : "a text goes to the client's phone"}. How should they pay?
            </p>
            {invAsk.err ? <p className={styles.psendErr} role="alert">{invAsk.err}</p> : null}
            {([
              ["card", "i-card", styles.pmiBpSolid, "Card", invOpts?.card ? `Hosted checkout · ${invOpts.cardVia.join(" / ")}` : "No card processor connected — Settings → Integrations / Payments", !invOpts?.card],
              ["bank", "i-out", styles.pmiBp, "Bank transfer", invOpts?.bank ? "Your transfer details go in the email" : "Add bank-transfer instructions in Settings → Integrations / Payments", !invOpts?.bank],
              ["any", "i-send", styles.pmiOkSolid, "Client's choice", "Card or bank — they pick on the page", !(invOpts?.card || invOpts?.bank)],
            ] as const).map(([method, icon, tone, title, sub, off]) => (
              <button key={method} className={styles.pmenuItem} type="button" disabled={writing || !invOpts || off}
                onClick={() => void runInvoice(sheetProposal, method)}>
                <span className={`${styles.pmiIc} ${tone}`}><Icon id={icon} /></span>
                <span>
                  <span className={styles.pmenuItemT}>{writing ? "Sending…" : title}</span>
                  <span className={styles.pmenuItemS}>{invOpts ? sub : "Checking your payment settings…"}</span>
                </span>
              </button>
            ))}
          </div>
        ) : sendAsk && sheetProposal ? (
          <form className={`${styles.sheetBody} ${styles.psend}`} data-send-step noValidate
            onSubmit={(e) => { e.preventDefault(); void runSend(sheetProposal, sendAsk); }}>
            {!sheetProposal.clientId ? (
              <label className={styles.psendF}>
                <span>Client name</span>
                <input className={styles.psendIn} id="m-send-name" type="text" autoComplete="off" placeholder="Jane Cooper"
                  value={sendAsk.name} onChange={(e) => setSendAsk({ ...sendAsk, name: e.target.value, err: "" })} />
              </label>
            ) : null}
            <label className={styles.psendF}>
              <span>Client email</span>
              <input className={styles.psendIn} id="m-send-email" type="email" inputMode="email" autoComplete="off" placeholder="client@example.com"
                value={sendAsk.email} onChange={(e) => setSendAsk({ ...sendAsk, email: e.target.value, err: "" })} />
            </label>
            <p className={styles.psendNote}>
              {!sendAsk.email.trim()
                ? sheetProposal.clientId
                  ? `${sheetProposal.client} has no email on file. Add it and it is saved on their client record — or leave it empty to mark the proposal sent.`
                  : "No client on this proposal yet. Add their name and email — they are added to your clients."
                : sheetProposal.clientEmail && sendAsk.email.trim().toLowerCase() !== sheetProposal.clientEmail.toLowerCase()
                  ? `This also changes ${sheetProposal.client}'s email on their client record.`
                  : sheetProposal.clientEmail
                    ? `The proposal email goes to ${sheetProposal.clientEmail}.`
                    : sheetProposal.clientId
                      ? `Saved on ${sheetProposal.client}'s client record, then sent.`
                      : "Added to your clients, then sent."}
            </p>
            {sendAsk.err ? <p className={styles.psendErr} role="alert">{sendAsk.err}</p> : null}
            <button className={styles.pmenuItem} type="submit" disabled={writing}>
              <span className={`${styles.pmiIc} ${styles.pmiOkSolid}`}><Icon id="i-send" /></span>
              <span>
                <span className={styles.pmenuItemT}>{writing ? "Sending…" : sendAsk.email.trim() ? "Send proposal" : "Mark as sent"}</span>
                <span className={styles.pmenuItemS}>{sheetProposal.title}</span>
              </span>
            </button>
          </form>
        ) : (
          <div className={styles.sheetBody}>
            {menuRows.map((r) => (
              <Fragment key={r.act}>
                {r.group && <div className={styles.pmenuGrp}>{r.group}</div>}
                <button type="button" disabled={r.disabled || writing}
                  className={`${styles.pmenuItem} ${r.danger ? styles.pmenuItemDanger : ""}`}
                  onClick={() => runMenu(r.act)}>
                  <span className={`${styles.pmiIc} ${r.tone ?? ""}`}><Icon id={r.icon} /></span>
                  <span>
                    <span className={styles.pmenuItemT}>{r.title}</span>
                    <span className={styles.pmenuItemS}>{r.sub}</span>
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
        )}
        <button className={styles.sheetCancel} type="button"
          onClick={() => { setSheetId(null); setConfirmDel(false); setSendAsk(null); setInvAsk(null); }}>Cancel</button>
      </div>
    </div>
  );
}

/* ============================================================
   SVG SPRITE — line icons 24×24, stroke 2, currentColor. Only
   original lucide paths; i-bulb is the reference's hand-drawn
   "switched-on" bulb (Smart Proposal).
   ============================================================ */

/** WHAT KIND (2026-10-17, lib/proposalKind): the work's square and its one word — "Roof", "Deck"; a proposal
 *  no trade could be read from says how it was made, "Manual" (owner, 2026-10-20). */
function KindMark({ k }: { k?: ProposalKind }) {
  if (!k) return null;
  return (
    <div className={styles.pkind} data-fam={k.family}>
      <i className={styles.pkSq} aria-hidden="true" />
      <b>{kindWord(k)}</b>
    </div>
  );
}
