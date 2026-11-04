"use client";

// MOBILE FINANCIALS (mobile-financials-v2) — Blueprint system, handheld build.
//
// Fourth surface in the handheld family, after mobile-v2 (Overview),
// mobile-proposals-v2 and mobile-clients-v2. Tokens, palette, type scale,
// status tones and Motion System "Balanced" are the reference dashboard's; the
// masthead / tab strip / filter dropdown / row-card / bottom-sheet vocabulary
// is mobile-clients-v2's, so the four pages read as one product. The topbar and
// drawer come from the shared <MobileNav /> — this page ships no nav chrome and
// no sprite beyond two page-local symbols.
//
// Every region of the desktop sheet (components/v3/financials-blueprint) is
// covered:
//  · Money head + a computed masthead per tab (one numeral, mono kicker, two
//    annotations)
//  · 4 tabs — Overview / Expenses / Change orders / Invoices — with live counts
//  · Revenue-vs-Expenses chart: 12 months, grouped bars, the dashed net line,
//    square net dots, and the desktop's month readout (hover → drag/tap here)
//    retargeting the three-figure strip and the scope line
//  · the profit-margin gauge: semicircular scale, 10% ticks, the 35% target
//    mark, tone badge (Healthy / Tight / Losing money) and the 3-up foot
//  · the 4-card stat strip incl. the margin delta, and the Attention list with
//    its two jumps
//  · receipt capture and the staged expense form (vendor / total / category /
//    job) with Save and Discard
//  · all three ledgers as row cards, every status badge (draft·sent·approved·
//    declined, pending·paid·failed·refunded, the 7 categories, no-receipt), the
//    "banked" paid figure, and the row-void choreography
//  · row actions as bottom sheets, each with a real disabled row and a danger
//    row; pagers; and BOTH empty states per ledger
//
// What changes versus the desktop sheet, and why:
//  · The three 6-column tables become row cards. A 6-column table cannot
//    survive 320px and hiding columns (what the desktop's own ≤860px layer
//    does) hides the note and the date, which is most of the record.
//  · A search box is added per ledger, and the desktop's category/status
//    reading becomes ONE filter dropdown — a chip rail does not survive 320px.
//  · The tab strip is a 2×2 pad: four tabs in one row cannot hold
//    "Change orders" plus its count badge on one line at 320px.
//  · Receipt capture and manual logging move to the page head, so the primary
//    actions are where the family puts them (and there is no FAB).
//  · Expense bars are drawn with a drafting hatch instead of the desktop's
//    amber: status colours are for statuses, and 24 amber bars would blow the
//    ~5% accent budget on a phone-sized sheet.
//
// CONTENT IS THE ORG'S REAL BOOK. It was the donor demo fixture while the
// layout was being judged; it is now the same read the desktop sheet makes —
// `loadFinancials()` (actions/financialsMobile.ts → lib/financialsSnapshot.ts)
// on mount — and the same server actions for every gesture that writes:
// scanReceipt / saveReceiptExpense for capture, addJobExpense for a logged
// line, deleteJobExpense, sendChangeOrder and deleteChangeOrder for the row
// menus. Nothing here mutates a local array and calls it a save. The invoices
// book is read-only, exactly as it is on the desk.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import styles from "./mobile-financials.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { safeHref } from "@/lib/safeHref";
import { loadFinancials } from "@/actions/financialsMobile";
import { FinancialsProjects, type FinancialsProject } from "@/components/v3/financials-blueprint/financials-projects";
import { JobCostCard, OfficeReview } from "@/components/v3/crew-board/office-review";
import { EMPTY_OFFICE_MONEY, EXPENSE_STATUS_FILTERS, type OfficeMoney } from "@/components/v3/crew-board/office-review-data";
import { loadFinancialsWho } from "./who-action";
import { Who } from "@/components/v3/who/who";
import { ChangeOrderSheet } from "@/components/changeOrders/ChangeOrderSheet";
import { InvoiceSheet } from "@/components/billing/InvoiceSheet";
import { scanReceipt, saveReceiptExpense } from "@/actions/receiptOcr";
import { prepareReceiptImage, receiptTransportError, ReceiptImageError } from "@/lib/receiptImage";
import { addJobExpense, deleteJobExpense } from "@/actions/expenses";
import { deleteChangeOrder, sendChangeOrder } from "@/actions/changeOrders";
import {
  ALL,
  CO_STATUSES,
  EMPTY_ROLLUP,
  EMPTY_WHO,
  EXPENSE_CATEGORIES,
  INV_STATUSES,
  PAGE_SIZE,
  TABS,
  initials,
  matchesExpense,
  matchesInvoice,
  matchesOrder,
  type ChangeOrder,
  type Expense,
  type FinancialsJob,
  type FinancialsSnapshot,
  type FinancialsWho,
  type Invoice,
  type WhoMark,
  type InvoiceTarget,
  type MonthPoint,
  type Rollup,
  type TabKey,
} from "./financials-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** The invoices book prints CENTS — whole dollars are this page's style, but an
 *  invoice is a document the office reconciles against a bank line. */
const moneyCents = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A loss reads "−$4,100", never "$-4,100". */
const signed = (n: number) => (n < 0 ? `−${money(Math.abs(n))}` : money(n));
/** Chart axis ticks only — the donor's helper. */
const shortMoney = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
/** The ledger plate a row just written gets, so it reads the same before and
 *  after a reload — the server stamps every other row exactly this way. */
const plate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });

/** The known vocabulary first, then anything the rows actually carry that it
 *  does not name — see the filter options below. */
const withPresent = (known: string[], present: string[]) => [
  ...known,
  ...Array.from(new Set(present))
    .filter((v) => v && !known.includes(v))
    .sort(),
];

/** Server actions reject with an Error whose message is written for the user
 *  ("Only drafts can be deleted.", "Not found"). Surface that text; fall back
 *  to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/* Chart geometry. 1 viewBox unit ≈ 1 CSS px at 360px, so the mono annotations
   land at their real size instead of being scaled down to noise. */
const CH = { w: 340, h: 206, x0: 44, x1: 332, y0: 12, y1: 168, lblY: 190, bw: 8.5 };
const CH_IW = CH.x1 - CH.x0;
const CH_IH = CH.y1 - CH.y0;
/* Gauge geometry — the desktop's, verbatim. */
const GA = { cx: 124, cy: 134, r: 94, sw: 18, target: 35 };
const GA_CIRC = Math.PI * GA.r;

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** 750ms easeOutCubic, written straight to the node so a count-up does not
 *  re-render the chart 45 times. tabular-nums keep the digits from jumping. */
function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = signed(value);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = signed(value * (1 - Math.pow(1 - pr, 3)));
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div ref={ref} className={className}>
      {signed(value)}
    </div>
  );
}

/** The same count-up for the gauge's numeral, which lives in an <svg> <text>
 *  and keeps its unit ("44.3%") — digits-only rebuilding would drop it. */
function CountPct({ value, x, y, className, style }: {
  value: number;
  x: number;
  y: number;
  className: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<SVGTextElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = `${value.toFixed(1)}%`;
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = `${(value * (1 - Math.pow(1 - pr, 3))).toFixed(1)}%`;
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <text ref={ref} x={x} y={y} className={className} style={style}>
      {`${value.toFixed(1)}%`}
    </text>
  );
}

type SheetKind = "exp" | "co" | "inv";
type SheetRef = { kind: SheetKind; id: string };

type MenuRow = {
  act: string;
  icon: string;
  tone?: string;
  title: string;
  sub: string;
  disabled?: boolean;
  danger?: boolean;
};

/** Status → badge tone. Explicit maps, so every class is a literal the CSS
 *  audit can see. */
const CO_TONE: Record<string, string> = {
  DRAFT: styles.stDraft,
  SENT: styles.stSent,
  APPROVED: styles.stApproved,
  DECLINED: styles.stDeclined,
};
const INV_TONE: Record<string, string> = {
  PENDING: styles.stPending,
  PAID: styles.stPaid,
  FAILED: styles.stFailed,
  REFUNDED: styles.stRefunded,
  // Superseded by a later invoice for the same money: in the book, out of
  // every total (lib/payments/invoiceRecord).
  VOID: styles.stVoid,
};

export function MobileFinancials() {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  /* ---------- the org's book ------------------------------------------
     The responsive shell mounts this component with NO props, so the page
     asks for its own data: one org-scoped read on mount, then local patches
     from the writes the row menus and the expense form make — the same way
     the desktop sheet patches its copy after a successful action. Empty until
     the read lands; never a fixture. */
  const [jobs, setJobs] = useState<FinancialsJob[]>([]);
  const [monthly, setMonthly] = useState<MonthPoint[]>([]);
  const [rollup, setRollup] = useState<Rollup>(EMPTY_ROLLUP);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  // Stage D: the review queue, owed to workers, cost by job (lib/officeMoney).
  const [office, setOffice] = useState<OfficeMoney>(EMPTY_OFFICE_MONEY);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  /** Contracts that still owe money — the invoice picker's list, read from the
   *  proposals by the snapshot, not derived from the book. */
  const [invoiceTargets, setInvoiceTargets] = useState<InvoiceTarget[]>([]);
  // What each project makes (2026-11-04) — the desk's Projects card, from the same snapshot.
  const [projects, setProjects] = useState<FinancialsProject[]>([]);
  /** WHO DID IT — the marks by row id, read beside the book. Empty until it
   *  lands and after a failed read: a missing mark is a blank, never an error. */
  const [whoBook, setWhoBook] = useState<FinancialsWho>(EMPTY_WHO);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // The book to open on: ?tab= as the desk reads it, and ?review=1 — where the
  // "receipt on review" bell and email land (stage D) — opens Expenses, whose
  // top is the review queue. Client-only (the shell mounts this ssr: false).
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "overview";
    const q = new URLSearchParams(window.location.search);
    const want = q.get("tab");
    if (q.get("review") || want === "expenses") return "expenses";
    return want === "orders" || want === "invoices" ? want : "overview";
  });
  const [filter, setFilter] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetRef | null>(null);
  /* ---------- the page-head actions menu -------------------------------
     Four ways to add to the books, the desk's four. Two of them hand off to
     the SHARED sheets — the change order is the one the job and the proposal
     raise, the invoice is the one the desk's Financials raises — so this
     build adds no second copy of either form. `step` is the menu's own second
     page: a change order needs the job it amends, and the job list is the
     picker (no new form for that either). */
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsStep, setActionsStep] = useState<"root" | "job">("root");
  const [coJob, setCoJob] = useState<string | null>(null);
  const [invOpen, setInvOpen] = useState(false);
  /** What the row sheet's kicker carries instead of the record line: the write
   *  that is on the wire, or the reason the server refused it. The sheet stays
   *  OPEN while a write runs, so the refusal lands on the record it names. */
  /* ---------- A new record, a clean status line ------------------------
     The note carries the id of the row it is ABOUT, and the text is derived in
     render: opening another row's menu shows nothing, while a note set on the
     row already open survives. It used to be reset by an effect on [sheet],
     which is a state write in an effect body — the same shape the Projects
     book avoids by settling in callbacks. */
  const [sheetNote, setSheetNote] = useState<{ id: string; text: string } | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [staged, setStaged] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [strike, setStrike] = useState<SheetRef | null>(null);
  /** The month under the finger, or null for the 12-month roll-up. */
  const [scrub, setScrub] = useState<number | null>(null);
  const [gaugeReady, setGaugeReady] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);

  /* ---- expense form ----
     `job` is a real Job id now, and `receipt` is the image itself: the bytes
     that were captured, held so the SAME file that was reviewed is the one
     uploaded. */
  const [form, setForm] = useState({
    vendor: "",
    amount: "",
    category: EXPENSE_CATEGORIES[0],
    job: "",
  });
  const [image, setImage] = useState<{ dataUrl: string; filename: string } | null>(null);
  const [vendorErr, setVendorErr] = useState(false);
  const [amountErr, setAmountErr] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The status line the form sheet's kicker carries: what the receipt reader
   *  is doing, or why a save was refused. */
  const [formNote, setFormNote] = useState("");
  const vendorRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** "scan" — the page-head Capture button, which runs OCR and stages the
   *  result. "attach" — the form's own Receipt toggle, which only attaches. */
  const pickMode = useRef<"scan" | "attach">("scan");

  /* ---------- the one read ----------------------------------------------
     Both settlements land in a CALLBACK rather than in the caller's body, so
     the mount effect below is a subscription to the read rather than a
     synchronous state write — the shape the Projects book uses
     (mobile-projects-v2/mobile-projects.tsx). */
  const applyBook = useCallback((snap: FinancialsSnapshot) => {
    setJobs(snap.jobs);
    setMonthly(snap.monthly);
    setRollup(snap.rollup);
    setExpenses(snap.expenses);
    setOffice(snap.office ?? EMPTY_OFFICE_MONEY);
    setOrders(snap.orders);
    setInvoices(snap.invoices);
    setInvoiceTargets(snap.invoiceTargets);
    setProjects(snap.projects ?? []);
    setLoadErr(null);
    setReady(true);
  }, []);
  const applyBookError = useCallback((err: unknown) => {
    setLoadErr(actionError(err));
  }, []);
  const load = useCallback(() => {
    // The marks ride beside the book, not behind it — both reads leave at
    // once, and a trail that cannot be read leaves the rows unmarked.
    void loadFinancialsWho().then(setWhoBook, () => setWhoBook(EMPTY_WHO));
    return loadFinancials().then(applyBook, applyBookError);
  }, [applyBook, applyBookError]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- viewport height ------------------------------------------
     Mandatory rule: viewport heights only via var(--app-h). A phone's URL bar
     changes innerHeight mid-scroll, so the real value is republished rather
     than trusting a bare 100vh/100dvh. This is the React form of the donor's
     FLUID SCALE module — no root zoom, since the composition here is already
     the handheld one. */
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

  /* ---------- Motion: reveal on load + adaptive reveal on scroll --------
     Runs when the BOOK lands, not on mount: before that the scroller holds the
     loading state, and the blocks this observes do not exist yet. */
  useEffect(() => {
    if (!ready) return;
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
  }, [ready]);

  /* ---------- Motion: graph-paper parallax ----------------------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host.style.setProperty("--gy", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp (delegated, covers late rows) --------- */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const sel = [
      styles.btn, styles.ftab, styles.ddBtn, styles.ddItem, styles.pagerBtn,
      styles.menuItem, styles.sheetCancel, styles.frowOpen, styles.irowOpen,
      styles.attOpen, styles.femptyA, styles.srchX, styles.choiceBtn,
      styles.jobOpt, styles.fchk,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes what the PAGE owns ---------------------------
     The drawer is not listed: MobileNav handles its own Escape and only binds
     while open, so two listeners can never claim one key press. */
  useEffect(() => {
    if (!filterOpen && !formOpen && !sheet && !actionsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Never while a write is on the wire, or the user is left unsure whether
      // it went through.
      if (filterOpen) setFilterOpen(false);
      else if (formOpen) {
        if (!saving) setFormOpen(false);
      } else if (actionsOpen) setActionsOpen(false);
      else if (sheet && !menuBusy) setSheet(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, formOpen, sheet, saving, menuBusy, actionsOpen]);

  /* ---------- Filter dropdown: close on outside pointerdown ------------ */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen]);

  /* ---------- Paging returns you to the top of the ledger ---------------
     In an effect, not the click handler: the ref must not be read during
     render, and the scroll belongs to the page CHANGE. First run skipped so
     mounting doesn't scroll. */
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [page]);

  /* ---------- The one blue flash on a record you just changed ----------- */
  useEffect(() => {
    if (!landedId) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => clearTimeout(t);
  }, [landedId]);

  /* ---------- Gauge fill draws itself once laid out --------------------- */
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGaugeReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------- Row void: strike (240ms) → gone --------------------------
     The desktop plays three beats (strike / lift / FLIP-close). The first is
     the one that carries the information — WHICH line is being voided — so it
     is kept verbatim; the rows below then close the gap.

     A row only leaves after the DELETE has landed on the server — the strike
     reports a write that happened, not one being attempted. Invoices are never
     removed here: the invoices book is read-only on both editions. */
  const commitRemove = useCallback((ref: SheetRef) => {
    if (ref.kind === "exp") setExpenses((prev) => prev.filter((x) => x.id !== ref.id));
    else if (ref.kind === "co") setOrders((prev) => prev.filter((x) => x.id !== ref.id));
  }, []);

  useEffect(() => {
    if (!strike) return;
    const t = window.setTimeout(() => {
      commitRemove(strike);
      setStrike(null);
    }, 240);
    return () => clearTimeout(t);
  }, [strike, commitRemove]);

  const removeRow = (ref: SheetRef) => {
    if (prefersReducedMotion()) commitRemove(ref);
    else setStrike(ref);
  };

  /* ---------- live roll-up ---------------------------------------------
     The four 30-day figures are the server's (`getFinancialsRollup`): paid
     PAYMENTS against job expenses over a rolling 30 days, which is a different
     scope from the rows this page lists, so they are never re-derived from the
     ledgers. They are patched — the way the desktop patches them — when this
     page itself books an expense into that window.
     The masthead's own figures below ARE the rows: what is logged, what has
     been collected, what is still out. */
  const logged = useMemo(() => expenses.reduce((a, e) => a + e.amount, 0), [expenses]);
  const collected = useMemo(
    () => invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0),
    [invoices],
  );
  const outstanding = useMemo(
    () => invoices.filter((i) => i.status === "PENDING").reduce((a, i) => a + i.amount, 0),
    [invoices],
  );
  const revenue30d = rollup.revenue30d;
  const expenses30d = rollup.expenses30d;
  const profit30d = rollup.profit30d;
  const marginPct = rollup.marginPct;

  /** An expense this page just booked is inside the window the gauge and the
   *  stat strip read, so the roll-up moves with it. Same arithmetic the
   *  desktop runs after `saveReceiptExpense`. */
  const bookExpense = useCallback((amount: number) => {
    setRollup((r) => {
      const expenses30dNext = r.expenses30d + amount;
      const profitNext = r.revenue30d - expenses30dNext;
      return {
        ...r,
        expenses30d: expenses30dNext,
        profit30d: profitNext,
        marginPct: r.revenue30d > 0 ? (profitNext / r.revenue30d) * 100 : 0,
      };
    });
  }, []);

  const ordersValue = useMemo(() => orders.reduce((a, o) => a + o.amount, 0), [orders]);
  const awaitingCo = useMemo(
    () => orders.filter((o) => o.status === "DRAFT" || o.status === "SENT").length,
    [orders],
  );
  const pendingInv = useMemo(() => invoices.filter((i) => i.status === "PENDING").length, [invoices]);
  const failedInv = useMemo(() => invoices.filter((i) => i.status === "FAILED").length, [invoices]);
  const noReceipt = useMemo(() => expenses.filter((e) => !e.receiptUrl).length, [expenses]);

  /* ---------- chart series --------------------------------------------
     Twelve CALENDAR months from the server (`getMonthlyRollup`), drawn as they
     were read. The 30-day roll-up is a rolling window, not this month, so it
     never overwrites the last column. */
  const chart = useMemo(() => {
    const max = Math.max(...monthly.map((m) => Math.max(m.revenue, m.expenses)), 1);
    const step = Math.max(10000, Math.ceil(max / 4 / 10000) * 10000);
    const top = step * 4;
    const gw = CH_IW / Math.max(1, monthly.length);
    const bars = monthly.map((m, i) => {
      const x = CH.x0 + gw * i;
      const cx = x + gw / 2;
      const rh = Math.max(0, (m.revenue / top) * CH_IH);
      const eh = Math.max(0, (m.expenses / top) * CH_IH);
      return {
        m,
        x,
        cx,
        // The net point sits over the CENTRE OF THE REVENUE COLUMN, not the
        // month's midpoint: the midpoint is the seam between the two bars, and
        // in a month with no expenses that seam is the revenue bar's right
        // edge — the dot read as pinned to the side of the column.
        netX: cx - CH.bw / 2 - 1,
        rh,
        eh,
        revY: CH.y1 - rh,
        expY: CH.y1 - eh,
        netY: CH.y1 - ((m.revenue - m.expenses) / top) * CH_IH,
      };
    });
    return { step, top, gw, bars, ticks: [0, 1, 2, 3, 4].map((i) => step * i) };
  }, [monthly]);

  const totals = useMemo(
    () =>
      monthly.reduce((a, m) => ({ r: a.r + m.revenue, e: a.e + m.expenses }), { r: 0, e: 0 }),
    [monthly],
  );
  const read = scrub === null ? null : monthly[scrub];
  const readRev = read ? read.revenue : totals.r;
  const readExp = read ? read.expenses : totals.e;
  const readNet = readRev - readExp;

  /* ---------- gauge --------------------------------------------------- */
  const gauge = useMemo(() => {
    const pct = marginPct;
    const tone = pct >= 35 ? "ok" : pct >= 15 ? "warn" : "bad";
    return {
      pct,
      tone,
      color: tone === "ok" ? "var(--success)" : tone === "warn" ? "var(--warning)" : "var(--danger)",
      label: tone === "ok" ? "Healthy" : tone === "warn" ? "Tight" : "Losing money",
      badge: tone === "ok" ? styles.mtOk : tone === "warn" ? styles.mtWarn : styles.mtBad,
      foot: tone === "ok" ? styles.toneOk : tone === "warn" ? styles.toneWarn : styles.toneBad,
      off: GA_CIRC - (GA_CIRC * Math.max(0, Math.min(100, pct))) / 100,
    };
  }, [marginPct]);

  const gaugeTicks = useMemo(() => {
    const at = (p: number, dist: number): [number, number] => {
      const a = Math.PI - (Math.PI * p) / 100;
      return [GA.cx + Math.cos(a) * dist, GA.cy - Math.sin(a) * dist];
    };
    const rows: Array<{ p: number; o: [number, number]; i: [number, number] }> = [];
    for (let p = 10; p < 100; p += 10) {
      rows.push({ p, o: at(p, GA.r + GA.sw / 2), i: at(p, GA.r - GA.sw / 2) });
    }
    return {
      rows,
      t1: at(GA.target, GA.r + GA.sw / 2 + 5),
      t2: at(GA.target, GA.r - GA.sw / 2 - 3),
      tl: at(GA.target, GA.r + GA.sw / 2 + 16),
    };
  }, []);

  /* ---------- stat strip + attention ----------------------------------
     Typed explicitly: an array literal whose members have different shapes
     infers a union, and `c.d` then fails to resolve on the members without a
     delta. */
  const statCards: Array<{
    l: string;
    v: string;
    h: string;
    tone: string;
    d?: { txt: string; up: boolean };
  }> = [
    { l: "Revenue · 30d", v: money(revenue30d), h: "Paid invoices", tone: "" },
    { l: "Expenses · 30d", v: money(expenses30d), h: "Job-level", tone: "" },
    {
      l: "Profit · 30d",
      v: signed(profit30d),
      h: "Revenue − expenses",
      tone: profit30d < 0 ? styles.toneBad : "",
      d: { txt: `${marginPct.toFixed(1)}%`, up: marginPct >= 0 },
    },
    { l: "Pipeline value", v: money(rollup.pipelineValue), h: "Open proposals", tone: styles.accent },
  ];

  const attention = [
    {
      label: "Invoices pending",
      count: pendingInv,
      hint: failedInv > 0 ? `${failedInv} payment failed` : "All current",
      tone: failedInv > 0 ? styles.attDanger : "",
      go: "invoices" as TabKey,
      cta: "Open invoices",
    },
    {
      label: "Change orders awaiting",
      count: awaitingCo,
      hint: "Draft or sent",
      tone: awaitingCo > 0 ? styles.attAccent : "",
      go: "orders" as TabKey,
      cta: "Open change orders",
    },
  ];

  /* ---------- masthead: one numeral, mono kicker, TWO annotations ------ */
  const mast = useMemo(() => {
    if (tab === "expenses") {
      return {
        kicker: "Expenses logged",
        value: logged,
        tone: "",
        a1: { l: "Items", v: String(expenses.length) },
        a2: { l: "No receipt", v: String(noReceipt) },
      };
    }
    if (tab === "orders") {
      return {
        kicker: "Change orders",
        value: ordersValue,
        tone: "",
        a1: { l: "Orders", v: String(orders.length) },
        a2: { l: "Awaiting", v: String(awaitingCo) },
      };
    }
    if (tab === "invoices") {
      return {
        kicker: "Collected · paid",
        value: collected,
        tone: styles.isGood,
        a1: { l: "Invoices", v: String(invoices.length) },
        a2: { l: "Outstanding", v: outstanding ? money(outstanding) : "—" },
      };
    }
    return {
      kicker: "Net profit · 30d",
      value: profit30d,
      tone: profit30d < 0 ? styles.isBad : "",
      a1: { l: "Revenue", v: money(revenue30d) },
      a2: { l: "Margin", v: `${marginPct.toFixed(1)}%` },
    };
  }, [
    tab, logged, expenses.length, noReceipt, ordersValue, orders.length, awaitingCo,
    collected, invoices.length, outstanding, profit30d, revenue30d, marginPct,
  ]);

  /* ---------- filter options for the active ledger ---------------------
     The known vocabulary FIRST, then anything the rows actually carry that it
     does not name. A real book can hold a value this page never listed — the
     receipt reader is allowed to answer "Tools" or "Subcontractor" — and a row
     no filter can reach is a row the owner cannot find. */
  const options = useMemo(() => {
    if (tab === "expenses") {
      return [
        { k: ALL, l: "All", n: expenses.length },
        // Where each receipt stands (stage D), then what it was for.
        ...EXPENSE_STATUS_FILTERS.filter((f) => f.key !== "ALL").map((f) => ({
          k: `st:${f.key}`,
          l: f.label,
          n: expenses.filter((e) => (e.status ?? "APPROVED") === f.key).length,
        })),
        ...withPresent(EXPENSE_CATEGORIES, expenses.map((e) => e.category)).map((c) => ({
          k: c,
          l: c,
          n: expenses.filter((e) => e.category === c).length,
        })),
      ];
    }
    if (tab === "orders") {
      return [
        { k: ALL, l: "All", n: orders.length },
        ...withPresent(CO_STATUSES, orders.map((o) => o.status)).map((s) => ({
          k: s,
          l: sentence(s),
          n: orders.filter((o) => o.status === s).length,
        })),
      ];
    }
    return [
      { k: ALL, l: "All", n: invoices.length },
      ...withPresent(INV_STATUSES, invoices.map((i) => i.status)).map((s) => ({
        k: s,
        l: sentence(s),
        n: invoices.filter((i) => i.status === s).length,
      })),
    ];
  }, [tab, expenses, orders, invoices]);
  const activeOption = options.find((o) => o.k === filter) ?? options[0];

  /* ---------- the visible ledger -------------------------------------- */
  const expView = useMemo(
    () =>
      expenses.filter(
        (e) =>
          (filter === ALL || (filter.startsWith("st:") ? (e.status ?? "APPROVED") === filter.slice(3) : e.category === filter)) &&
          matchesExpense(e, query),
      ),
    [expenses, filter, query],
  );
  const coView = useMemo(
    () => orders.filter((o) => (filter === ALL || o.status === filter) && matchesOrder(o, query)),
    [orders, filter, query],
  );
  const invView = useMemo(
    () => invoices.filter((i) => (filter === ALL || i.status === filter) && matchesInvoice(i, query)),
    [invoices, filter, query],
  );

  const rowCount =
    tab === "expenses" ? expView.length : tab === "orders" ? coView.length : invView.length;
  const seedCount =
    tab === "expenses" ? expenses.length : tab === "orders" ? orders.length : invoices.length;
  const pages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const from = (safePage - 1) * PAGE_SIZE;
  const expSlice = expView.slice(from, from + PAGE_SIZE);
  const coSlice = coView.slice(from, from + PAGE_SIZE);
  const invSlice = invView.slice(from, from + PAGE_SIZE);

  const tabCounts: Record<TabKey, number | null> = {
    overview: null,
    expenses: expenses.length,
    orders: orders.length,
    invoices: invoices.length,
  };
  const tabIdx = TABS.findIndex((t) => t.key === tab);

  /* ---------- navigation + find state --------------------------------- */
  const clearFind = () => {
    setFilter(ALL);
    setQuery("");
    setPage(1);
  };
  const goTab = (next: TabKey) => {
    setTab(next);
    setFilterOpen(false);
    setScrub(null);
    clearFind();
  };

  /* ---------- chart scrub --------------------------------------------
     Pointer events cover mouse, pen and touch on one path; the overlay's
     touch-action is pan-y, so a vertical swipe still scrolls the page. */
  const svgRef = useRef<SVGSVGElement>(null);
  const hideTimer = useRef<number | null>(null);
  const pick = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const sx = ((clientX - r.left) / r.width) * CH.w;
      const idx = Math.floor((sx - CH.x0) / chart.gw);
      setScrub(Math.max(0, Math.min(monthly.length - 1, idx)));
    },
    [chart.gw, monthly.length],
  );
  const onScrubDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e.clientX);
  };
  const onScrubMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.pointerType === "mouse" || e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
  };
  const onScrubUp = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (e.pointerType === "mouse") return;
    // Touch: leave the readout up long enough to actually be read.
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setScrub(null), 2200);
  };
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  /* ---------- row sheets ---------------------------------------------- */
  const sheetExp = sheet?.kind === "exp" ? expenses.find((e) => e.id === sheet.id) ?? null : null;
  const sheetCo = sheet?.kind === "co" ? orders.find((o) => o.id === sheet.id) ?? null : null;
  const sheetInv = sheet?.kind === "inv" ? invoices.find((i) => i.id === sheet.id) ?? null : null;
  const sheetOpen = Boolean(sheetExp || sheetCo || sheetInv);

  const record = sheetExp
    ? { kicker: `${sheetExp.category} · ${sheetExp.when} · ${money(sheetExp.amount)}`, title: sheetExp.job }
    : sheetCo
      ? { kicker: `${sentence(sheetCo.status)} · ${sheetCo.when} · ${money(sheetCo.amount)}`, title: sheetCo.title }
      : sheetInv
        ? { kicker: `${sheetInv.num} · ${sheetInv.provider} · due ${sheetInv.due}`, title: sheetInv.client }
        : { kicker: "Record · —", title: "Actions" };
  // A write in flight, or one the server refused, takes the kicker line: it is
  // the one place in this sheet that is already a status line, and it sits
  // directly above the record the message is about.
  const noteText = sheetNote && sheet && sheetNote.id === sheet.id ? sheetNote.text : "";
  const sheetHead = noteText ? { kicker: noteText, title: record.title } : record;

  /* Only gestures with a REAL action behind them are offered. The fixture
     edition listed five invoice actions and a change-order approval that no
     server action implements — a control that cannot do what it says is worse
     than no control. What the server does implement, and this sheet calls:
     deleteJobExpense, addJobExpense, sendChangeOrder, deleteChangeOrder. The
     invoices book is read-only, so its one row is a link to the contract. */
  const menuRows = useMemo<MenuRow[]>(() => {
    if (sheetExp) {
      const e = sheetExp;
      const receipt = safeHref(e.receiptUrl);
      return [
        { act: "receipt", icon: "i-financials-ext", tone: styles.miBp, title: "View receipt",
          sub: receipt ? "Opens the captured image" : "No receipt attached", disabled: !receipt },
        { act: "job", icon: "i-jobs", tone: styles.miSky, title: "Open job", sub: e.job },
        { act: "dup", icon: "i-copy", title: "Log another like this", sub: `${e.category} · ${money(e.amount)}` },
        { act: "del", icon: "i-trash", tone: styles.miDanger, title: "Delete expense",
          sub: "Voids the line permanently", danger: true },
      ];
    }
    if (sheetCo) {
      const o = sheetCo;
      const sent = o.status !== "DRAFT";
      return [
        { act: "send", icon: "i-send", tone: styles.miSky, title: sent ? "Already sent" : "Send to client",
          sub: sent ? `Sent ${o.when}` : "Emails it for signature", disabled: sent },
        { act: "job", icon: "i-jobs", tone: styles.miWarn, title: "Open job",
          sub: o.jobId ? o.job : "Amends a proposal, not a job", disabled: !o.jobId },
        { act: "del", icon: "i-trash", tone: styles.miDanger, title: "Delete change order",
          sub: sent ? "Only drafts can be deleted" : "Voids the line permanently",
          danger: true, disabled: sent },
      ];
    }
    if (sheetInv) {
      const i = sheetInv;
      return [
        { act: "open", icon: "i-file", tone: styles.miBp, title: "Open invoice",
          sub: i.proposalId ? `${i.num} · ${i.client}` : "No proposal behind this invoice",
          disabled: !i.proposalId },
      ];
    }
    return [];
  }, [sheetExp, sheetCo, sheetInv]);

  /** Every row here is a real write or a real destination. Writes keep the
   *  sheet open until the server answers; navigation and the receipt link
   *  close it at once. */
  const runMenu = async (act: string) => {
    const ref = sheet;
    if (!ref || menuBusy) return;

    if (act === "receipt") {
      const href = sheetExp ? safeHref(sheetExp.receiptUrl) : null;
      setSheet(null);
      if (href) window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (act === "job") {
      const jobId = sheetExp?.jobId ?? sheetCo?.jobId ?? null;
      setSheet(null);
      if (jobId) router.push(`/dashboard/jobs/${jobId}` as Route);
      return;
    }
    if (act === "open") {
      const proposalId = sheetInv?.proposalId ?? null;
      setSheet(null);
      if (proposalId) router.push(`/dashboard/proposals/${proposalId}` as Route);
      return;
    }

    if (act === "del") {
      setMenuBusy(true);
      setSheetNote({ id: ref.id, text: "Deleting…" });
      try {
        if (ref.kind === "exp") await deleteJobExpense(ref.id);
        else await deleteChangeOrder(ref.id);
      } catch (err) {
        setMenuBusy(false);
        setSheetNote({ id: ref.id, text: actionError(err) });
        return;
      }
      setMenuBusy(false);
      setSheetNote(null);
      setSheet(null);
      removeRow(ref);
      return;
    }

    if (act === "send" && ref.kind === "co") {
      setMenuBusy(true);
      setSheetNote({ id: ref.id, text: "Sending…" });
      try {
        await sendChangeOrder(ref.id);
      } catch (err) {
        setMenuBusy(false);
        setSheetNote({ id: ref.id, text: actionError(err) });
        return;
      }
      setMenuBusy(false);
      setSheetNote(null);
      setSheet(null);
      setOrders((prev) => prev.map((o) => (o.id === ref.id ? { ...o, status: "SENT" } : o)));
      setLandedId(ref.id);
      return;
    }

    if (act === "dup" && ref.kind === "exp") {
      const src = expenses.find((e) => e.id === ref.id);
      if (!src) return;
      setMenuBusy(true);
      setSheetNote({ id: ref.id, text: "Logging…" });
      let created: { id: string };
      try {
        created = await addJobExpense({
          jobId: src.jobId,
          category: src.category,
          amount: src.amount,
          note: src.note || null,
        });
      } catch (err) {
        setMenuBusy(false);
        setSheetNote({ id: ref.id, text: actionError(err) });
        return;
      }
      setMenuBusy(false);
      setSheetNote(null);
      setSheet(null);
      const rec: Expense = { ...src, id: created.id, when: plate(new Date()), receiptUrl: null };
      setExpenses((prev) => [rec, ...prev]);
      bookExpense(rec.amount);
      clearFind();
      setLandedId(rec.id);
    }
  };

  /* ---------- the expense form ----------------------------------------
     Two ways in, one form, one save path. "Log expense" opens it empty;
     "Capture receipt" opens the camera / photo picker, sends the image past
     the same OCR the desktop uses (`scanReceipt`) and stages what came back
     for review. Nothing is written until Save. */

  /** The category chips, plus whatever the reader answered if it is not one of
   *  them — the desktop's own rule, so a "Tools" receipt is not silently
   *  re-filed under "Materials". */
  const formCategories = useMemo(
    () => withPresent(EXPENSE_CATEGORIES, [form.category]),
    [form.category],
  );

  const openForm = () => {
    setStaged(false);
    setVendorErr(false);
    setAmountErr(false);
    setFormNote("");
    setImage(null);
    setForm({ vendor: "", amount: "", category: EXPENSE_CATEGORIES[0], job: jobs[0]?.id ?? "" });
    setFormOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    window.setTimeout(() => vendorRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  /** Open the picker. `mode` decides what happens to the file that comes back:
   *  "scan" reads it, "attach" simply carries it into the save. */
  const pickFile = (mode: "scan" | "attach") => {
    if (!jobs.length) {
      setFormNote("A receipt is charged to a job, and this org has none yet.");
      if (mode === "scan") {
        setStaged(true);
        setFormOpen(true);
      }
      return;
    }
    pickMode.current = mode;
    const el = fileRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  };

  const onPickFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const mode = pickMode.current;
    // The same preparation the desktop makes (lib/receiptImage): upright,
    // 2000px on the long edge, JPEG under 3 MB — a phone photo as the phone
    // took it went up as a 5 MB data URL and never reached the reader. Every
    // refusal is a sentence in the form's own note line.
    let dataUrl: string;
    let filename: string;
    try {
      const prepared = await prepareReceiptImage(file);
      dataUrl = prepared.dataUrl;
      filename = prepared.filename;
    } catch (err) {
      setFormNote(err instanceof ReceiptImageError ? err.message : "That image couldn't be read — try a JPG or PNG of the receipt.");
      if (mode === "scan") {
        setStaged(true);
        setFormOpen(true);
      }
      return;
    }
    setImage({ dataUrl, filename });

    if (mode === "attach") {
      setFormNote("");
      return;
    }

    // Staged for review, not saved. The sheet opens straight away so the wait
    // happens somewhere the user can see it.
    const jobId = jobs[0].id;
    setStaged(true);
    setVendorErr(false);
    setAmountErr(false);
    setForm({ vendor: "", amount: "", category: EXPENSE_CATEGORIES[0], job: jobId });
    setFormNote("Reading the receipt…");
    setFormOpen(true);

    let res: Awaited<ReturnType<typeof scanReceipt>>;
    try {
      res = await scanReceipt({ jobId, dataUrl });
    } catch (err) {
      setFormNote(receiptTransportError(err));
      return;
    }
    if (!res.ok) {
      setFormNote(res.error || "Could not read that receipt.");
      return;
    }
    const ocr = res.ocr;
    setForm({
      vendor: ocr.vendor || "",
      amount: ocr.total ? String(ocr.total) : "",
      category: ocr.category || EXPENSE_CATEGORIES[0],
      job: jobId,
    });
    setFormNote(
      res.disabled ? "Vision is off, so these are placeholder values — check every field." : "",
    );
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const vendor = form.vendor.trim();
    const raw = form.amount.trim().replace(/[$,\s]/g, "");
    const n = Number(raw);
    const badAmount = raw === "" || !Number.isFinite(n) || n < 0;
    setVendorErr(!vendor);
    setAmountErr(badAmount);
    if (!vendor) {
      vendorRef.current?.focus();
      return;
    }
    if (badAmount) return;
    if (!form.job) {
      setFormNote("Pick the job this receipt belongs to.");
      return;
    }

    setSaving(true);
    setFormNote("");
    let id: string;
    let receiptUrl: string | null = null;
    // saveReceiptExpense uploads the image and creates the JobExpense with its
    // receiptUrl — which is what makes the receipt ATTACHED to the job rather
    // than merely mentioned in a note. With no image there is nothing to
    // upload, so a plain line goes through addJobExpense.
    const note = image ? (vendor ? `Vendor: ${vendor}` : "") : vendor;
    try {
      if (image) {
        const saved = await saveReceiptExpense({
          jobId: form.job,
          dataUrl: image.dataUrl,
          filename: image.filename,
          vendor,
          total: n,
          category: form.category,
          note: null,
          ocrJson: null,
        });
        id = saved.id;
        receiptUrl = saved.receiptUrl;
      } else {
        const saved = await addJobExpense({
          jobId: form.job,
          category: form.category,
          amount: n,
          note: note || null,
        });
        id = saved.id;
      }
    } catch (err) {
      setSaving(false);
      setFormNote(actionError(err));
      return;
    }

    // The id is the DATABASE id the action just created — which is what makes
    // the new row's own Delete work without a reload.
    const rec: Expense = {
      id,
      jobId: form.job,
      job: jobs.find((j) => j.id === form.job)?.title ?? "—",
      category: form.category,
      amount: n,
      note,
      when: plate(new Date()),
      receiptUrl,
    };
    setSaving(false);
    setExpenses((prev) => [rec, ...prev]);
    bookExpense(n);
    setImage(null);
    setFormOpen(false);
    setTab("expenses");
    setScrub(null);
    clearFind();
    setLandedId(rec.id);
  };

  const anyOverlay = sheetOpen || formOpen || actionsOpen;

  // Swipe-down dismissal, one gesture per sheet, wired to the close paths the
  // scrim and Cancel already use — and, like them, inert while a write runs.
  const actionsDrag = useSheetDrag(sheetOpen, () => {
    if (!menuBusy) setSheet(null);
  });
  const formDrag = useSheetDrag(formOpen, () => {
    if (!saving) setFormOpen(false);
  });
  const addDrag = useSheetDrag(actionsOpen, () => setActionsOpen(false));

  /* ---------- what the page-head menu offers ---------------------------
     The desk's four, in the desk's order. Two of them open a shared sheet;
     a change order asks which job first, because it amends one. */
  const addRows: Array<{ act: "expense" | "co" | "invoice" | "scan"; icon: string; tone?: string; title: string; sub: string; disabled?: boolean }> = [
    { act: "expense", icon: "i-plus", tone: styles.miSky, title: "Add expense", sub: "Book a cost against a job" },
    { act: "co", icon: "i-jobs", tone: styles.miWarn, title: "Add change order", sub: jobs.length ? "Amend a job, then send it" : "No job to amend yet", disabled: !jobs.length },
    { act: "invoice", icon: "i-financials-receipt", tone: styles.miSky, title: "New invoice", sub: invoiceTargets.length ? "Bill the balance on a contract" : "No contract owes anything", disabled: !invoiceTargets.length },
    { act: "scan", icon: "i-financials-receipt", title: "Scan receipt", sub: "Photograph it and read the total" },
  ];

  const rowCls = (id: string) =>
    `${styles.rowIn} ${strike?.id === id ? styles.striking : ""} ${landedId === id ? styles.landed : ""}`;

  /* ============ BEFORE THE BOOK LANDS ============
     The head, and one honest line about what is happening. No masthead, no
     tabs, no chart: a zero, a dash and an empty ledger are all claims about
     the org's money, and none of them is known yet. Same box, same dashed
     vocabulary, as the ledger empty states below. */
  if (!ready) {
    return (
      <div className={styles.app} onClick={onRootClick}>
        <MobileNav />
        <main className={styles.scroll} ref={scrollRef}>
          <div className={styles.content} ref={contentRef}>
            <div className={styles.pageHead}>
              <div className={styles.kicker}>Money</div>
              <h1 className={styles.pageTitle}>Financials</h1>
            </div>
            <div className={styles.fempty}>
              <div className={styles.femptyT}>{loadErr ? "Could not load" : "Reading the books"}</div>
              <div className={styles.femptyS}>
                {loadErr ?? "Revenue, expenses, change orders and invoices for this company."}
              </div>
              {loadErr ? (
                <button className={styles.femptyA} type="button" onClick={() => void load()}>
                  <Icon id="i-arrow" />Try again
                </button>
              ) : null}
            </div>
          </div>
        </main>
        <FinancialsIcons />
      </div>
    );
  }

  return (
    <div className={styles.app} onClick={onRootClick}>
      {/* Shared handheld nav: topbar + drawer + the 48-symbol sprite. Owns its
          own open state, so this page holds none. */}
      <MobileNav />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD */}
          <div className={styles.pageHead}>
            <div className={styles.kicker}>Money</div>
            <h1 className={styles.pageTitle}>Financials</h1>
            <div className={styles.pageActions}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={() => pickFile("scan")}>
                <Icon id="i-financials-receipt" />Capture receipt
              </button>
              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={actionsOpen}
                onClick={() => {
                  setActionsStep("root");
                  setActionsOpen(true);
                }}
              >
                <Icon id="i-plus" />Actions
              </button>
            </div>
            {/* The camera / photo picker behind both entry points. Off-screen
                rather than hidden: a display:none input cannot be opened by
                .click() in every browser. */}
            <input
              ref={fileRef}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void onPickFile(e)}
            />
          </div>

          {/* MASTHEAD — key on tab so the 320ms slide-in replays */}
          <div className={`${styles.fmast} ${styles.slide}`} key={tab}>
            <div className={styles.fmastTop}>
              <div className={styles.fmastLbl}>
                {mast.kicker}
                <span className={styles.fmastRule} />
              </div>
              <CountUp value={mast.value} className={`${styles.fmastVal} ${mast.tone}`} />
            </div>
            <div className={styles.fmastCnt}>
              {[mast.a1, mast.a2].map((a) => (
                <div className={styles.fmastSub} key={a.l}>
                  <div className={styles.fmastSubL}>{a.l}</div>
                  <div className={styles.fmastSubV}>{a.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* TABS — 2×2 pad, sliding blueprint rule */}
          <div className={styles.ftabs}>
            <span
              className={styles.ftabInd}
              style={{ transform: `translate(${(tabIdx % 2) * 100}%, ${Math.floor(tabIdx / 2) * 100}%)` }}
            />
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`${styles.ftab} ${tab === t.key ? styles.active : ""}`}
                type="button"
                aria-current={tab === t.key ? "page" : undefined}
                onClick={() => goTab(t.key)}
              >
                {t.label}
                {tabCounts[t.key] === null ? null : (
                  <span className={styles.ftabCount}>{tabCounts[t.key]}</span>
                )}
              </button>
            ))}
            {/* Fifth cell, full width: the desktop's second tab. Overhead is its
                own handheld surface (/mobile-overhead-v1, real data), so this is
                a link out of the pad rather than a fifth in-page panel — and it
                is an <a>, so the button-only nth-of-type dividers and the 2×2
                indicator math above are untouched. */}
            <Link
              href={"/mobile-overhead-v1" as Route}
              className={`${styles.ftab} ${styles.ftabLink}`}
              aria-label="Overhead — monthly business costs"
            >
              <svg className={styles.ftabIc} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 21V7l9-4 9 4v14" />
                <path d="M3 21h18" />
                <path d="M9 21v-6h6v6" />
                <path d="M9 11h.01M15 11h.01" />
              </svg>
              Overhead
              <span className={styles.ftabGo} aria-hidden="true">→</span>
            </Link>
          </div>

          {/* ============ TAB: OVERVIEW ============ */}
          {tab === "overview" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitles}>
                  <div className={styles.cardTitle}>Revenue vs Expenses</div>
                  {/* Doubles as the chart's readout: drag across the plot and it
                      names the month the strip below is reporting. */}
                  <div className={styles.cardSub}>
                    {read ? `${read.m} · one month` : "Last 12 months"}
                  </div>
                </div>
              </div>

              <div className={`${styles.hstrip} ${read ? styles.isMonth : ""}`}>
                <div className={styles.hs}>
                  <div className={styles.hsL}>
                    <i className={styles.swRev} />Revenue
                  </div>
                  <div className={`${styles.hsV} ${styles.hsSwap}`} key={`r${scrub ?? "all"}`}>
                    {money(readRev)}
                  </div>
                </div>
                <div className={styles.hs}>
                  <div className={styles.hsL}>
                    <i className={styles.swExp} />Expenses
                  </div>
                  <div className={`${styles.hsV} ${styles.hsSwap}`} key={`e${scrub ?? "all"}`}>
                    {money(readExp)}
                  </div>
                </div>
                <div className={styles.hs}>
                  <div className={styles.hsL}>
                    <i className={styles.swNet} />Net
                  </div>
                  <div
                    className={`${styles.hsV} ${styles.hsSwap} ${readNet < 0 ? styles.toneBad : styles.toneOk}`}
                    key={`n${scrub ?? "all"}`}
                  >
                    {signed(readNet)}
                  </div>
                </div>
              </div>

              <div className={`${styles.chart} ${read ? styles.isHot : ""}`}>
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${CH.w} ${CH.h}`}
                  role="img"
                  aria-label={`Revenue against expenses by month. Last twelve months: revenue ${money(totals.r)}, expenses ${money(totals.e)}, net ${signed(totals.r - totals.e)}.`}
                >
                  <defs>
                    {/* A drafting hatch for the expense bars — the drawing
                        language's "second material", not a status colour. */}
                    <pattern
                      id="mfHatch"
                      width="5"
                      height="5"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <rect width="5" height="5" className={styles.hatchBg} />
                      <line x1="0" y1="0" x2="0" y2="5" className={styles.hatchLine} />
                    </pattern>
                  </defs>

                  {/* Horizontal majors only — verticals read as noise */}
                  {chart.ticks.map((t, i) => {
                    const y = CH.y1 - (CH_IH * i) / 4;
                    return (
                      <g key={t}>
                        <line className={styles.gridLine} x1={CH.x0} y1={y} x2={CH.x1} y2={y} />
                        <text className={styles.axisTxt} x={CH.x0 - 8} y={y + 4} textAnchor="end">
                          {shortMoney(t)}
                        </text>
                      </g>
                    );
                  })}

                  {chart.bars.map((b, i) => (
                    <g key={b.m.m} className={`${styles.moGroup} ${scrub === i ? styles.on : ""}`}>
                      <rect className={styles.moHit} x={b.x} y={CH.y0} width={chart.gw} height={CH_IH} />
                      <rect
                        className={`${styles.barRev} ${styles.barDraw}`}
                        style={{ animationDelay: `${i * 40}ms` }}
                        x={b.cx - CH.bw - 1}
                        y={b.revY}
                        width={CH.bw}
                        height={b.rh}
                      />
                      <rect
                        className={`${styles.barExp} ${styles.barDraw}`}
                        style={{ animationDelay: `${i * 40 + 20}ms` }}
                        x={b.cx + 1}
                        y={b.expY}
                        width={CH.bw}
                        height={b.eh}
                      />
                      {i % 3 === 0 || i === chart.bars.length - 1 ? (
                        <text
                          className={`${styles.axisTxt} ${styles.moLbl}`}
                          x={b.cx}
                          y={CH.lblY}
                          textAnchor="middle"
                        >
                          {b.m.m}
                        </text>
                      ) : null}
                      <title>
                        {`${b.m.m} · revenue ${money(b.m.revenue)} · expenses ${money(b.m.expenses)} · net ${signed(b.m.revenue - b.m.expenses)}`}
                      </title>
                    </g>
                  ))}

                  {/* Net profit above the bars, with SQUARE dots */}
                  <polyline
                    className={styles.netLine}
                    points={chart.bars.map((b) => `${b.netX.toFixed(1)},${b.netY.toFixed(1)}`).join(" ")}
                  />
                  {chart.bars.map((b) => (
                    <rect
                      key={`d${b.m.m}`}
                      className={styles.netDot}
                      x={b.cx - 2.5}
                      y={b.netY - 2.5}
                      width={5}
                      height={5}
                    />
                  ))}

                  <line className={styles.axisLine} x1={CH.x0} y1={CH.y1} x2={CH.x1} y2={CH.y1} />

                  <rect
                    className={styles.chOverlay}
                    x={CH.x0}
                    y={CH.y0}
                    width={CH_IW}
                    height={CH_IH}
                    onPointerDown={onScrubDown}
                    onPointerMove={onScrubMove}
                    onPointerUp={onScrubUp}
                    onPointerCancel={onScrubUp}
                    onPointerLeave={(e) => {
                      if (e.pointerType === "mouse") setScrub(null);
                    }}
                  />
                </svg>
              </div>
            </div>
          )}

          {tab === "overview" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitles}>
                  <div className={styles.cardTitle}>Profit margin</div>
                </div>
                <span className={`${styles.gstatus} ${gauge.badge}`}>{gauge.label}</span>
              </div>

              <div className={styles.gaugeWrap}>
                <svg viewBox="0 0 248 168" role="img" aria-label={`Profit margin ${gauge.pct.toFixed(1)} percent — ${gauge.label}. Target 35 percent.`}>
                  <path
                    className={styles.gTrack}
                    style={{ strokeWidth: GA.sw }}
                    d={`M ${GA.cx - GA.r} ${GA.cy} A ${GA.r} ${GA.r} 0 0 1 ${GA.cx + GA.r} ${GA.cy}`}
                  />
                  <path
                    className={styles.gFill}
                    style={{
                      stroke: gauge.color,
                      strokeWidth: GA.sw,
                      strokeDasharray: GA_CIRC.toFixed(1),
                      strokeDashoffset: (gaugeReady ? gauge.off : GA_CIRC).toFixed(1),
                    }}
                    d={`M ${GA.cx - GA.r} ${GA.cy} A ${GA.r} ${GA.r} 0 0 1 ${GA.cx + GA.r} ${GA.cy}`}
                  />
                  {gaugeTicks.rows.map((t) => (
                    <line
                      key={t.p}
                      className={styles.gTick}
                      x1={t.o[0].toFixed(1)}
                      y1={t.o[1].toFixed(1)}
                      x2={t.i[0].toFixed(1)}
                      y2={t.i[1].toFixed(1)}
                    />
                  ))}
                  <line
                    className={styles.gTarget}
                    x1={gaugeTicks.t1[0].toFixed(1)}
                    y1={gaugeTicks.t1[1].toFixed(1)}
                    x2={gaugeTicks.t2[0].toFixed(1)}
                    y2={gaugeTicks.t2[1].toFixed(1)}
                  />
                  <text
                    className={styles.gTlbl}
                    x={gaugeTicks.tl[0].toFixed(1)}
                    y={gaugeTicks.tl[1].toFixed(1)}
                    textAnchor="middle"
                  >
                    {`${GA.target}%`}
                  </text>
                  <CountPct
                    value={gauge.pct}
                    x={GA.cx}
                    y={GA.cy + 2}
                    className={styles.gVal}
                    style={{ fill: gauge.color }}
                  />
                  <text className={styles.gCap} x={GA.cx} y={GA.cy + 20}>
                    MARGIN · 30D
                  </text>
                  <text className={styles.gEnd} x={GA.cx - GA.r} y={GA.cy + 18} textAnchor="middle">
                    0%
                  </text>
                  <text className={styles.gEnd} x={GA.cx + GA.r} y={GA.cy + 18} textAnchor="middle">
                    100%
                  </text>
                </svg>
              </div>

              <div className={styles.gaugeFoot}>
                <div className={styles.gf}>
                  <div className={styles.gfL}>Revenue</div>
                  <div className={styles.gfV}>{money(revenue30d)}</div>
                </div>
                <div className={styles.gf}>
                  <div className={styles.gfL}>Expenses</div>
                  <div className={styles.gfV}>{money(expenses30d)}</div>
                </div>
                <div className={styles.gf}>
                  <div className={styles.gfL}>Profit</div>
                  <div className={`${styles.gfV} ${gauge.foot}`}>{signed(profit30d)}</div>
                </div>
              </div>
            </div>
          )}

          {tab === "overview" && (
            <div className={styles.stats}>
              {statCards.map((c, i) => (
                <div key={c.l} className={`${styles.stat} ${styles.rowIn}`} style={{ animationDelay: `${i * 45}ms` }}>
                  <div className={styles.statLbl}>{c.l}</div>
                  <div className={`${styles.statVal} ${c.tone}`}>{c.v}</div>
                  {c.d ? (
                    <div className={`${styles.statDelta} ${c.d.up ? styles.toneOk : styles.toneBad}`}>
                      {c.d.up ? "▲" : "▼"} {c.d.txt}
                    </div>
                  ) : null}
                  <div className={styles.statHint}>{c.h}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "overview" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitles}>
                  <div className={styles.cardTitle}>Attention</div>
                  <div className={styles.cardSub}>What needs you this week</div>
                </div>
              </div>
              <ul className={styles.attList}>
                {attention.map((r) => (
                  <li className={styles.att} key={r.label}>
                    <div className={styles.attTxt}>
                      <div className={styles.attT}>{r.label}</div>
                      <div className={styles.attH}>{r.hint}</div>
                    </div>
                    <span className={`${styles.attN} ${r.tone}`}>{r.count}</span>
                    <button className={styles.attOpen} type="button" onClick={() => goTab(r.go)}>
                      <Icon id="i-arrow" />
                      {r.cta}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "overview" && ready && <FinancialsProjects projects={projects} />}

          {/* ============ EXPENSES: the office's side (stage D) ============
              The crew's receipts waiting for review and what is owed to
              workers — on top, where the work is; the same component the desk
              draws. A review re-reads the book. */}
          {tab === "expenses" && ready && <OfficeReview data={office} onChanged={() => void load()} />}

          {/* ============ FIND BAR — the three ledgers ============ */}
          {tab !== "overview" && (
            <div className={styles.find}>
              <label className={styles.srch}>
                <Icon id="i-search" />
                <input
                  className={styles.srchInput}
                  type="search"
                  value={query}
                  placeholder={
                    tab === "expenses"
                      ? "Search job, vendor or note…"
                      : tab === "orders"
                        ? "Search change order or job…"
                        : "Search invoice, client or provider…"
                  }
                  autoComplete="off"
                  aria-label="Search this ledger"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
                {query ? (
                  <button
                    className={styles.srchX}
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery("");
                      setPage(1);
                    }}
                  >
                    <Icon id="i-x" />
                  </button>
                ) : null}
              </label>

              <div className={`${styles.dd} ${filterOpen ? styles.open : ""}`} ref={filterRef}>
                <button
                  className={styles.ddBtn}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={filterOpen}
                  onClick={() => setFilterOpen((v) => !v)}
                >
                  <Icon id="i-filter" />
                  Filter
                  <span className={`${styles.ddValue} ${filter === ALL ? styles.isAll : ""}`}>
                    {activeOption.l} · {activeOption.n}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
                </button>
                <div className={styles.ddMenu} role="listbox">
                  {options.map((o) => (
                    <button
                      key={o.k}
                      className={`${styles.ddItem} ${filter === o.k ? styles.active : ""}`}
                      type="button"
                      role="option"
                      aria-selected={filter === o.k}
                      onClick={() => {
                        setFilter(o.k);
                        setPage(1);
                        setFilterOpen(false);
                      }}
                    >
                      {o.l}
                      <span className={styles.ddCount}>{o.n}</span>
                      {filter === o.k ? <Icon id="i-check" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============ EMPTY STATES ============ */}
          {tab !== "overview" && rowCount === 0 && (
            <div className={styles.fempty}>
              {seedCount === 0 ? (
                tab === "expenses" ? (
                  <>
                    <div className={styles.femptyT}>No expenses yet</div>
                    <div className={styles.femptyS}>
                      Capture a receipt and the vendor, total and category are read off it and
                      staged for your review.
                    </div>
                    <button className={styles.femptyA} type="button" onClick={() => pickFile("scan")}>
                      <Icon id="i-financials-receipt" />Capture receipt
                    </button>
                  </>
                ) : tab === "orders" ? (
                  <>
                    <div className={styles.femptyT}>No change orders yet</div>
                    <div className={styles.femptyS}>
                      Raise one from a job when the scope grows — it lands here for signature.
                    </div>
                    <button className={styles.femptyA} type="button" onClick={() => goTab("overview")}>
                      <Icon id="i-chevl" />Back to overview
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.femptyT}>No invoices yet</div>
                    <div className={styles.femptyS}>
                      An invoice appears here when a proposal is accepted and billed.
                    </div>
                    <button className={styles.femptyA} type="button" onClick={() => goTab("overview")}>
                      <Icon id="i-chevl" />Back to overview
                    </button>
                  </>
                )
              ) : (
                <>
                  <div className={styles.femptyT}>No matches</div>
                  <div className={styles.femptyS}>
                    Nothing in this ledger matches that search and filter.
                  </div>
                  <button className={styles.femptyA} type="button" onClick={clearFind}>
                    <Icon id="i-x" />Clear filters
                  </button>
                </>
              )}
            </div>
          )}

          {/* ============ TAB: EXPENSES ============ */}
          {tab === "expenses" && expSlice.length > 0 && (
            <div className={styles.ledger}>
              {expSlice.map((e, i) => (
                <div key={e.id} className={`${styles.frow} ${rowCls(e.id)}`} style={{ animationDelay: `${i * 45}ms` }}>
                  <div className={styles.frowTitle}>{e.job}</div>
                  <button
                    className={styles.frowOpen}
                    type="button"
                    aria-label={`Actions for ${e.note || e.job}`}
                    onClick={() => setSheet({ kind: "exp", id: e.id })}
                  >
                    <Icon id="i-dots" />
                  </button>
                  <div className={styles.frowSub}>{e.note || "—"}</div>
                  <div className={styles.frowFoot}>
                    <span className={styles.frowTags}>
                      <span className={`${styles.badge} ${styles.stCat}`}>{e.category}</span>
                      {e.status === "SUBMITTED" ? <span className={`${styles.badge} ${styles.stPending}`}>On review</span> : null}
                      {e.status === "REJECTED" ? <span className={`${styles.badge} ${styles.stDeclined}`}>Rejected</span> : null}
                      {e.status === "REIMBURSED" ? <span className={`${styles.badge} ${styles.stPaid}`}>Reimbursed</span> : null}
                      {e.purpose === "STOCK" ? <span className={`${styles.badge} ${styles.stNone}`}>For stock</span> : null}
                      {e.receiptUrl ? null : (
                        <span className={`${styles.badge} ${styles.stNone}`}>No receipt</span>
                      )}
                      <WhoTag mark={whoBook.expenses[e.id]} />
                    </span>
                    <span className={styles.frowFigs}>
                      <span className={styles.frowMono}>{e.when}</span>
                      <span className={`${styles.money} ${e.amount ? "" : styles.isZero}`}>
                        {e.amount ? money(e.amount) : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ============ TAB: CHANGE ORDERS ============ */}
          {tab === "orders" && coSlice.length > 0 && (
            <div className={styles.ledger}>
              {coSlice.map((o, i) => (
                <div key={o.id} className={`${styles.frow} ${rowCls(o.id)}`} style={{ animationDelay: `${i * 45}ms` }}>
                  <div className={styles.frowTitle}>{o.title}</div>
                  <button
                    className={styles.frowOpen}
                    type="button"
                    aria-label={`Actions for ${o.title}`}
                    onClick={() => setSheet({ kind: "co", id: o.id })}
                  >
                    <Icon id="i-dots" />
                  </button>
                  <div className={styles.frowSub}>{o.job}</div>
                  <div className={styles.frowFoot}>
                    <span className={styles.frowTags}>
                      <span className={`${styles.badge} ${CO_TONE[o.status] ?? ""}`}>{sentence(o.status)}</span>
                      <WhoTag mark={whoBook.orders[o.id]} />
                    </span>
                    <span className={styles.frowFigs}>
                      <span className={styles.frowMono}>{o.when}</span>
                      <span className={`${styles.money} ${o.amount ? "" : styles.isZero}`}>
                        {o.amount ? money(o.amount) : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ============ TAB: INVOICES ============ */}
          {tab === "invoices" && invSlice.length > 0 && (
            <div className={styles.ledger}>
              {invSlice.map((inv, i) => {
                const paid = inv.status === "PAID";
                return (
                  <div key={inv.id} className={`${styles.irow} ${rowCls(inv.id)}`} style={{ animationDelay: `${i * 45}ms` }}>
                    <span className={`${styles.iav} ${paid ? styles.banked : ""}`}>{initials(inv.client)}</span>
                    <div className={styles.iname}>{inv.client}</div>
                    <button
                      className={styles.irowOpen}
                      type="button"
                      aria-label={`Actions for invoice ${inv.num}`}
                      onClick={() => setSheet({ kind: "inv", id: inv.id })}
                    >
                      <Icon id="i-dots" />
                    </button>
                    <div className={styles.iwhere}>{inv.num} · {inv.provider}</div>
                    <div className={styles.ifoot}>
                      <span className={styles.frowTags}>
                        <span className={`${styles.badge} ${INV_TONE[inv.status] ?? ""}`}>
                          {sentence(inv.status)}
                        </span>
                        <WhoTag mark={whoBook.invoices[inv.id]} />
                      </span>
                      <span className={styles.frowFigs}>
                        <span className={styles.frowMono}>due {inv.due}</span>
                        {/* The ask, when a payment did not match it. */}
                        {inv.billed != null ? (
                          <span className={styles.frowMono}>billed {moneyCents(inv.billed)}</span>
                        ) : null}
                        <span className={`${styles.money} ${paid ? styles.banked : ""} ${inv.amount ? "" : styles.isZero}`}>
                          {inv.amount ? moneyCents(inv.amount) : "—"}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ============ PAGER ============ */}
          {tab !== "overview" && rowCount > PAGE_SIZE && (
            <div className={styles.pager}>
              <button
                className={styles.pagerBtn}
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(Math.max(1, safePage - 1))}
              >
                <Icon id="i-chevl" />Prev
              </button>
              <button
                className={styles.pagerBtn}
                type="button"
                disabled={safePage >= pages}
                onClick={() => setPage(Math.min(pages, safePage + 1))}
              >
                Next<Icon id="i-chevr" />
              </button>
              <span className={styles.pagerInfo}>
                {safePage} / {pages}
              </span>
            </div>
          )}

          {/* What each job consumed (lib/jobCost) — the job page's own figure. */}
          {tab === "expenses" && ready && <JobCostCard costs={office.costs} stockPurchases30d={office.stockPurchases30d} />}
        </div>
      </main>

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => {
          if (!menuBusy) setSheet(null);
          if (!saving) setFormOpen(false);
          setActionsOpen(false);
        }}
        aria-hidden="true"
      />

      {/* ============ ADD SHEET — the page head's four ============
          Page one is the four actions; page two is the job list, which is the
          change order's context picker. Nothing here is a form: Add expense
          opens the page's own expense sheet, and the change order and the
          invoice open the SHARED sheets. */}
      <div
        className={`${styles.sheet} ${actionsOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={actionsStep === "job" ? "Pick the job to amend" : "Add to the books"}
        aria-hidden={!actionsOpen}
        {...addDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...addDrag.handleProps} />
        <div className={styles.sheetHead} {...addDrag.handleProps}>
          <div className={styles.sheetKicker}>{actionsStep === "job" ? "Change order" : "Add to the books"}</div>
          <div className={styles.sheetTitle}>{actionsStep === "job" ? "Which job does it amend?" : "Four ways in"}</div>
        </div>
        <div className={styles.sheetBody}>
          {actionsStep === "root"
            ? addRows.map((r) => (
                <button
                  key={r.act}
                  type="button"
                  disabled={r.disabled}
                  className={styles.menuItem}
                  onClick={() => {
                    if (r.act === "expense") {
                      setActionsOpen(false);
                      openForm();
                    } else if (r.act === "scan") {
                      setActionsOpen(false);
                      // The same call the head's Capture button makes. Inside
                      // a map() the rule cannot see that this closure only
                      // ever runs on a tap, so the file input it opens reads
                      // like a ref touched during render.
                      // eslint-disable-next-line react-hooks/refs
                      pickFile("scan");
                    } else if (r.act === "invoice") {
                      setActionsOpen(false);
                      setInvOpen(true);
                    } else {
                      // a change order amends ONE job — the menu's second page picks it
                      setActionsStep("job");
                    }
                  }}
                >
                  <span className={`${styles.miIc} ${r.tone ?? ""}`}>
                    <Icon id={r.icon} />
                  </span>
                  <span>
                    <span className={styles.menuItemT}>{r.title}</span>
                    <span className={styles.menuItemS}>{r.sub}</span>
                  </span>
                </button>
              ))
            : jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setCoJob(j.id);
                    setActionsOpen(false);
                    setActionsStep("root");
                  }}
                >
                  <span className={`${styles.miIc} ${styles.miWarn}`}>
                    <Icon id="i-jobs" />
                  </span>
                  <span>
                    <span className={styles.menuItemT}>{j.title}</span>
                    <span className={styles.menuItemS}>{j.status.toLowerCase()}</span>
                  </span>
                </button>
              ))}
        </div>
        <button
          className={styles.sheetCancel}
          type="button"
          onClick={() => {
            if (actionsStep === "job") setActionsStep("root");
            else setActionsOpen(false);
          }}
        >
          {actionsStep === "job" ? "Back" : "Cancel"}
        </button>
      </div>

      {/* The shared sheets: the job/proposal change order, and the invoice the
          desk's Financials raises. Both reload the book, so the new record is
          in the ledger and in the sums without a page reload. */}
      {coJob ? (
        <ChangeOrderSheet
          open={Boolean(coJob)}
          onClose={() => setCoJob(null)}
          jobId={coJob}
          onDone={() => {
            void load();
            setTab("orders");
          }}
        />
      ) : null}
      <InvoiceSheet
        open={invOpen}
        onClose={() => setInvOpen(false)}
        targets={invoiceTargets}
        onSent={() => {
          // Sending bills the balance, stamps the installment AND writes the
          // row in the invoice book (lib/payments/invoiceRecord) — so the
          // reload has something new to show, and the tab it landed in opens.
          void load();
          goTab("invoices");
        }}
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div
        className={`${styles.sheet} ${sheetOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Record actions"
        aria-hidden={!sheetOpen}
        {...actionsDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          <div className={styles.sheetKicker}>{sheetHead.kicker}</div>
          <div className={styles.sheetTitle}>{sheetHead.title}</div>
        </div>
        <div className={styles.sheetBody}>
          {menuRows.map((r) => (
            <button
              key={r.act}
              type="button"
              disabled={r.disabled || menuBusy}
              className={`${styles.menuItem} ${r.danger ? styles.menuItemDanger : ""}`}
              onClick={() => void runMenu(r.act)}
            >
              <span className={`${styles.miIc} ${r.tone ?? ""}`}>
                <Icon id={r.icon} />
              </span>
              <span>
                <span className={styles.menuItemT}>{r.title}</span>
                <span className={styles.menuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          className={styles.sheetCancel}
          type="button"
          disabled={menuBusy}
          onClick={() => setSheet(null)}
        >
          Cancel
        </button>
      </div>

      {/* ============ EXPENSE FORM SHEET ============ */}
      <div
        className={`${styles.sheet} ${formOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mfFormTitle"
        aria-hidden={!formOpen}
        {...formDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...formDrag.handleProps} />
        <div className={styles.sheetHead} {...formDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {formNote || (staged ? "Staged from receipt — check before saving" : "Money out / new record")}
          </div>
          <div className={styles.sheetTitle} id="mfFormTitle">
            {staged ? "Review expense" : "Log expense"}
          </div>
        </div>
        <form
          className={`${styles.sheetBody} ${styles.formBody}`}
          id="mfExpForm"
          noValidate
          onSubmit={(e) => void submitForm(e)}
        >
          <div className={`${styles.fld} ${vendorErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mfVendor">
              Vendor or note<span className={styles.req}>*</span>
            </label>
            <input
              ref={vendorRef}
              className={styles.finput}
              id="mfVendor"
              name="vendor"
              type="text"
              placeholder="Bothell Building Supply"
              autoComplete="off"
              value={form.vendor}
              aria-invalid={vendorErr}
              aria-describedby={vendorErr ? "mfVendorErr" : undefined}
              onChange={(e) => {
                setForm((f) => ({ ...f, vendor: e.target.value }));
                if (e.target.value.trim()) setVendorErr(false);
              }}
            />
            {vendorErr ? (
              <span className={styles.fldErr} id="mfVendorErr">
                Enter the vendor or a short note
              </span>
            ) : null}
          </div>

          <div className={`${styles.fld} ${amountErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mfAmount">
              Total<span className={styles.req}>*</span>
            </label>
            <input
              className={styles.finput}
              id="mfAmount"
              name="amount"
              type="text"
              inputMode="decimal"
              placeholder="1284.40"
              autoComplete="off"
              value={form.amount}
              aria-invalid={amountErr}
              aria-describedby={amountErr ? "mfAmountErr" : "mfAmountHint"}
              onChange={(e) => {
                setForm((f) => ({ ...f, amount: e.target.value }));
                if (e.target.value.trim()) setAmountErr(false);
              }}
            />
            {amountErr ? (
              <span className={styles.fldErr} id="mfAmountErr">
                Enter the amount as a number
              </span>
            ) : (
              <span className={styles.fldHint} id="mfAmountHint">
                Dollars. A zero-cost line (a warranty swap) is allowed and reads as a dash.
              </span>
            )}
          </div>

          <div className={styles.fld}>
            <span className={styles.fldLbl}>Category</span>
            <div className={styles.choice}>
              {formCategories.map((c) => (
                <button
                  key={c}
                  className={styles.choiceBtn}
                  type="button"
                  aria-pressed={form.category === c}
                  onClick={() => setForm((f) => ({ ...f, category: c }))}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.fld}>
            <span className={styles.fldLbl}>Job</span>
            <div className={styles.jobList}>
              {jobs.map((j) => (
                <button
                  key={j.id}
                  className={styles.jobOpt}
                  type="button"
                  aria-pressed={form.job === j.id}
                  onClick={() => setForm((f) => ({ ...f, job: j.id }))}
                >
                  {j.title}
                  <Icon id="i-check" />
                </button>
              ))}
            </div>
          </div>

          <div className={styles.fld}>
            <span className={styles.fldLbl}>Receipt</span>
            {/* The toggle IS the image: pressed means bytes are held and will
                be uploaded with the line; pressing it opens the picker, and
                pressing it again drops the photo. */}
            <button
              className={styles.fchk}
              type="button"
              aria-pressed={Boolean(image)}
              onClick={() => (image ? setImage(null) : pickFile("attach"))}
            >
              <span className={styles.fchkBox}>
                <Icon id="i-check" />
              </span>
              Image attached
              <span className={styles.fchkSub}>audit</span>
            </button>
          </div>
        </form>
        <div className={styles.formFoot}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            disabled={saving}
            onClick={() => setFormOpen(false)}
          >
            Discard
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            type="submit"
            form="mfExpForm"
            disabled={saving}
          >
            <Icon id="i-check" />
            {saving ? "Saving…" : "Save expense"}
          </button>
        </div>
      </div>

      <FinancialsIcons />
    </div>
  );
}

/* ============================================================
   PAGE-LOCAL SYMBOLS — the two ids the shared 48-symbol sprite
   does not carry. Prefixed i-financials- so they can never
   collide with the shared set or another page. Original lucide
   paths, 24×24, stroke 2, currentColor.
   ============================================================ */
/** WHO DID IT — the mark in a row's tag line. A member in their color with
 *  their role (lib/team/who); the client who paid online as a grey "Client";
 *  nothing when the trail cannot place the row. Dressed by who.css, which the
 *  (mobile) layout and the responsive shell both load. */
function WhoTag({ mark }: { mark: WhoMark | undefined }) {
  if (!mark) return null;
  if (mark.whoKind === "client") {
    return (
      <span className="who who--system" style={{ ["--who" as string]: "#8a8a8a" }} data-who="" title="Client · paid online">
        <i className="who-dot" aria-hidden="true">C</i>
        <b className="who-name">Client</b>
        <em className="who-role">online</em>
      </span>
    );
  }
  if (!mark.who?.id) return null;
  return <Who who={mark.who} />;
}

function FinancialsIcons() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-financials-receipt" viewBox="0 0 24 24">
          <path d="M4 2v20l2.5-1.6L9 22l2.5-1.6L14 22l2.5-1.6L19 22V2l-2.5 1.6L14 2l-2.5 1.6L9 2 6.5 3.6Z" />
          <path d="M8 8h8" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </symbol>
        <symbol id="i-financials-ext" viewBox="0 0 24 24">
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </symbol>
      </defs>
    </svg>
  );
}
