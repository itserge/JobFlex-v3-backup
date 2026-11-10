"use client";

// MOBILE CRM (mobile-crm-v2) — Blueprint system, handheld build.
//
// Fourth sibling to /mobile-v2 (Overview), /mobile-proposals-v2 and
// /mobile-clients-v2. Tokens, palette, type scale, status tones, the shared nav
// and Motion System "Balanced" are theirs; where the mobile-app-ui-design skill
// disagrees with the house system (soft shadows, rounded-3xl, gradients) the
// house system wins — hard 3px offset shadows, 2px radii and Inter 900 caps.
//
// Every region of the desktop CRM sheet (src/components/v3/crm-blueprint) is
// covered:
//  · page head (Pipeline / CRM) + the New-rule action
//  · the 4 CRM panels as one tab strip with a sliding rule
//  · the 4-cell stat grid → the Overview masthead (conversion, won·lost, active)
//  · Fresh leads (5 rows), What needs you (action rows), Recent activity
//  · Customer book: the 3 tiles → the Book masthead, the 8-status chip rail →
//    ONE filter dropdown, the 6-column table → row cards with initials avatars
//  · Workflows: the rules list with its drawn toggle, and the rule form
//  · Follow-up queue: the All/Due/Scheduled sub-tabs → the Due tab's filter
//    dropdown, the 4-column table → row cards with the severity ladder, pager
//  · the "⋮" popover → one bottom sheet serving all four record kinds, each
//    with a disabled row driven by real fixture state and a danger row
//  · every empty state, plus the second "no matches" state behind each filter
//
// What changes versus the desktop sheet, and why:
//  · Tab labels are short ("Book", "Rules", "Due"): four columns of a 320px
//    screen are ~72px each, and "Customer book" / "Follow-up queue" cannot
//    survive that at 13px.
//  · A search box is added to the book. Finding a named account is the real
//    job on a phone; it filters the already-loaded rows client-side — no new
//    endpoint.
//  · "Last activity" leaves the row for the sheet, the same call that took
//    "updated" off the proposals ledger and the clients book.
//  · Page sizes drop (book 13-unpaged → 8, queue 20 → 6): a handheld record
//    card is three lines tall.
//  · The desktop's per-row Done + Send pair becomes one flat framed Send on the
//    row; Done and everything else live in the row's sheet.
//
// DATA: every row, figure and badge below is the signed-in org's own, read
// through `getCrmSnapshot()` (crm-snapshot.ts) — the same org-scoped Prisma
// queries the desktop CRM sheet runs. Every write goes to an existing server
// action (followUps.ts, leads.ts) and the snapshot is re-read afterwards, so
// what the phone shows is what the database holds.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-crm.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { Who } from "@/components/v3/who/who";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { claimLead, deleteLead } from "@/actions/leads";
import {
  deleteFollowUpRule,
  markFollowUpDone,
  runFollowUpNow,
  setFollowUpRuleEnabled,
  turnOnDefaultFollowUps,
  upsertFollowUpRule,
} from "@/actions/followUps";
import { renderEmail } from "@/lib/email/renderEmail";
import {
  FOLLOW_UP_CHANNELS,
  TEXT_NEEDS_TWILIO,
  channelLabel,
  delayLabel,
  followUpsStatus,
  readDelayDays,
  followUpEmailDoc,
  followUpSmsText,
  previewContext,
  type FollowUpChannel,
} from "@/lib/followUps/copy";
import { getCrmSnapshot } from "./crm-snapshot";
import { getCrmBrief } from "@/actions/crmBrief";
import { moneyShort, type CrmBrief } from "@/lib/crm/brief";
import { OfficePanel, TodayPanel } from "@/components/v3/crm-blueprint/crm-brief";
import { CompanyPulse } from "@/components/v3/crm-blueprint/company-pulse";
import { AgentDesk } from "@/components/v3/crm-blueprint/crm-agent";
import { WinBackPanel } from "@/components/v3/crm-blueprint/win-back";
import { FOLLOW_UP_MODES, FOLLOW_UP_WORDS, modeLabel, type FollowUpMode, type FollowUpWords } from "@/lib/followUps/agent";
import {
  LEAD_CLS,
  PAGE_BOOK,
  PAGE_QUEUE,
  QUEUE_FILTERS,
  STATUS_CLS,
  STATUS_ORDER,
  TABS,
  TRIGGERS,
  humanDelay,
  initials,
  isCompany,
  matchesCustomer,
  money,
  severity,
  titleCase,
  triggerLabel,
  type ActivityItem,
  type CrmLead,
  type CrmStats,
  type Customer,
  type FollowUpRule,
  type PreviewOrg,
  type QueueFilterKey,
  type QueueItem,
  type TabKey,
} from "./crm-data";

const EMPTY_STATS: CrmStats = { won: 0, lost: 0, active: 0, conversations: 0 };
const EMPTY_ORG: PreviewOrg = { name: "Your company", phone: null, logoUrl: null };

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Stable module-scope formatters: an inline one would be a new function every
   render and would restart the count-up on every keystroke. */
const fmtMoney = (n: number) => money(n);
const fmtInt = (n: number) => String(Math.round(n));
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** 750ms easeOutCubic. tabular-nums keep the digit columns from jumping. */
function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = format(value);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = format(value * (1 - Math.pow(1 - pr, 3)));
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, format]);
  return (
    <div ref={ref} className={className}>
      {format(value)}
    </div>
  );
}

/**
 * What the client receives, rendered live.
 *
 * Not a mock-up: the doc comes from src/lib/followUps/copy.ts and the HTML from
 * lib/email/renderEmail — the same two calls `dispatchOne()` makes before it
 * hands the message to the transport. Change the trigger and this repaints.
 *
 * The email goes in an iframe because it is a whole document with its own
 * <style> block and its own 560px measure; inlining it would let the page's
 * stylesheet leak in and stop the preview being truthful. It is authored at its
 * natural 600px and scaled down to the phone's column, so the layout stays the
 * one the homeowner will actually see. Scripts are sandboxed off;
 * `allow-same-origin` is kept only so the frame's height can be measured.
 */
function MessagePreview({
  trigger,
  channel,
  delayMinutes,
  org,
  smsEnabled,
}: {
  trigger: string;
  channel: FollowUpChannel;
  delayMinutes: number;
  org: PreviewOrg;
  smsEnabled: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [docHeight, setDocHeight] = useState(900);
  const [scale, setScale] = useState(0.6);

  const ctx = useMemo(() => {
    const c = previewContext(org.name, delayMinutes);
    c.orgPhone = org.phone;
    c.orgLogoUrl = org.logoUrl;
    return c;
  }, [org, delayMinutes]);

  const html = useMemo(
    () => (channel === "TEXT" ? null : renderEmail(followUpEmailDoc(trigger, ctx)).html),
    [channel, trigger, ctx],
  );

  useEffect(() => {
    if (channel === "TEXT") return;
    const measure = () => {
      const w = stageRef.current?.clientWidth ?? 0;
      if (w) setScale(Math.min(1, w / 600));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [channel]);

  if (channel === "TEXT") {
    return (
      <div className={styles.prevStage}>
        <div className={styles.prevSms}>
          <div className={styles.prevSmsHd}>{org.name}</div>
          <div className={styles.prevSmsBub}>{followUpSmsText(trigger, ctx)}</div>
          {smsEnabled ? null : <div className={styles.prevSmsWarn}>{TEXT_NEEDS_TWILIO}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.prevStage}
      ref={stageRef}
      style={{ height: `${Math.round(docHeight * scale)}px` }}
    >
      <iframe
        ref={frameRef}
        className={styles.prevFrame}
        title="Follow-up email preview"
        sandbox="allow-same-origin"
        srcDoc={html ?? ""}
        style={{ height: `${docHeight}px`, transform: `scale(${scale})` }}
        onLoad={() => {
          // +12 so the card's own offset shadow and bottom border land inside
          // the stage rather than being shaved off by it.
          const h = frameRef.current?.contentDocument?.body?.scrollHeight;
          if (h) setDocHeight(h + 12);
        }}
      />
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
};

/* Every `id` below is a real database row id — Lead.id, Client.id,
   FollowUpRule.id, FollowUp.id — because every sheet row acts on one. */
type SheetTarget =
  | { kind: "lead"; id: string }
  | { kind: "customer"; id: string }
  | { kind: "rule"; id: string }
  | { kind: "queue"; id: string };

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

export function MobileCrm() {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /* ---- live rows, read from the database on mount and after every write ---- */
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  /* The one place a refused or failed write is reported. */
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [stats, setStats] = useState<CrmStats>(EMPTY_STATS);
  /* Today's checks and the office figures — the same read the desktop sheet
     gets as props (lib/crm/briefServer), fetched beside the snapshot. */
  const [brief, setBrief] = useState<CrmBrief | null>(null);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rules, setRules] = useState<FollowUpRule[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  /* The org's own letterhead + whether this deployment can text at all. Both
     feed the preview card and the rule form's channel picker. */
  const [org, setOrg] = useState<PreviewOrg>(EMPTY_ORG);
  const [smsEnabled, setSmsEnabled] = useState(false);
  /* The snapshot's server clock — the status line's "next send in 5 h". */
  const [renderedAt, setRenderedAt] = useState(0);
  /* One row at a time: the id currently mid-write, so its controls disable. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<TabKey>("today");
  const [bookFilter, setBookFilter] = useState<string>("ALL");
  const [bookQuery, setBookQuery] = useState("");
  const [bookPage, setBookPage] = useState(1);
  const [qFilter, setQFilter] = useState<QueueFilterKey>("ALL");
  const [qPage, setQPage] = useState(1);

  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  /* Queue rows fade for 240ms before they leave the array — the donor's
     `.gone` pass, so the list does not jump under the thumb. */
  const [gone, setGone] = useState<string[]>([]);

  /* ---- rule form sheet ---- */
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", trigger: "SENT", days: "2", channel: "EMAIL" as FollowUpChannel, mode: "AUTO" as FollowUpMode, words: "STANDARD" as FollowUpWords });
  // What the desk band (follow-ups waiting for a yes + promises) holds for the person today.
  const [deskN, setDeskN] = useState(0);
  const followUpClosed = useCallback((id: string) => setQueue((prev) => prev.filter((q) => q.id !== id)), []);
  const [nameErr, setNameErr] = useState(false);
  const [daysErr, setDaysErr] = useState<string | null>(null);

  /* ---- preview card ----
     What the "What they receive" card is showing. Seeded from the first rule,
     then driven by the rule sheet — pick a trigger in the form and the card is
     on that message when the sheet closes. Its own picker steers it too, so the
     copy is readable without opening the editor. */
  const [prev, setPrev] = useState<{ trigger: string; channel: FollowUpChannel; days: number }>({
    trigger: "SENT",
    channel: "EMAIL",
    days: 2,
  });
  /* One rule seed only — after that the card belongs to whoever is steering it,
     and a background refresh must not yank it back. */
  const prevSeeded = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /* ---------- the read ---------------------------------------------------
     One action, the same queries the desktop sheet runs. Called on mount and
     again after every write, so an optimistic row that the server refused
     snaps back to the truth instead of lingering. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [res, b] = await Promise.all([getCrmSnapshot(), getCrmBrief()]);
    if (!alive.current) return;
    if (b.ok) setBrief(b.data);
    if (!res.ok) {
      setLoadErr(res.error);
      return;
    }
    setLoadErr(null);
    setStats(res.data.stats);
    setLeads(res.data.leads);
    setActivity(res.data.activity);
    setCustomers(res.data.customers);
    setRules(res.data.rules);
    setOrg(res.data.org);
    setSmsEnabled(res.data.smsEnabled);
    setRenderedAt(res.data.renderedAt);
    if (!prevSeeded.current && res.data.rules.length) {
      const first = res.data.rules[0];
      prevSeeded.current = true;
      setPrev({
        trigger: first.triggerStatus,
        channel: first.channel,
        days: Math.max(1, Math.round(first.delayMinutes / 60 / 24)),
      });
    }
    setQueue(res.data.queue);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) setLoadErr("Couldn't load the CRM. Pull down to try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /** Run a write, report a refusal in the page's own error line, then re-read.
   *  Server actions here are role-gated (rule CRUD is manager-only, the queue
   *  is sales-or-manager), so a refusal is a normal outcome, not a crash. */
  const commit = useCallback(
    async (id: string | null, run: () => Promise<unknown>) => {
      setActionErr(null);
      setBusyId(id);
      try {
        await run();
        await refresh();
        return true;
      } catch (err: unknown) {
        if (alive.current) {
          setActionErr(err instanceof Error ? err.message : "That didn't go through.");
          // Undo any optimistic paint: cancelling the pending fade (the effect
          // cleanup clears its timer) and re-reading the truth.
          setGone([]);
          await refresh().catch(() => {});
        }
        return false;
      } finally {
        if (alive.current) setBusyId(null);
      }
    },
    [refresh],
  );

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

  /* ---------- Motion: reveal on load + adaptive reveal on scroll -------- */
  useEffect(() => {
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
  }, []);

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
      styles.btn, styles.tab, styles.ddBtn, styles.ddItem, styles.pagerBtn,
      styles.cmenuItem, styles.sheetCancel, styles.rowOpen, styles.qsend,
      styles.arow, styles.fitem, styles.emptyA, styles.srchX, styles.tgl,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* The donor flashed an "Opened" stamp on the action rows that went nowhere.
     Every one of them navigates now, so the stamp is gone with them. */

  /* ---------- Esc closes what the PAGE owns ---------------------------
     The drawer is not listed: MobileNav owns its own Escape and only binds
     while open, so the two listeners cannot both claim one key press. */
  useEffect(() => {
    if (!filterOpen && !ruleOpen && !sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (ruleOpen) setRuleOpen(false);
      else setSheet(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, ruleOpen, sheet]);

  /* ---------- Filter dropdown: close on outside pointerdown ------------
     Only one dropdown is mounted at a time (the tab decides which), so one ref
     and one flag serve both. */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen]);

  /* ---------- Paging returns you to the top of the list -----------------
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
  }, [bookPage, qPage]);

  /* ---------- The one blue flash on a record you just changed ----------- */
  useEffect(() => {
    if (!landedId) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => clearTimeout(t);
  }, [landedId]);

  /* ---------- Queue rows leave after their fade ------------------------- */
  useEffect(() => {
    if (!gone.length) return;
    const t = window.setTimeout(
      () => {
        setQueue((prev) => prev.filter((q) => !gone.includes(q.id)));
        setGone([]);
      },
      prefersReducedMotion() ? 0 : 240,
    );
    return () => clearTimeout(t);
  }, [gone]);

  /* ---------- derived: Overview ---------------------------------------- */
  /* Won / lost / active are counted across the WHOLE Lead table server-side —
     the same figures the desktop stat grid prints. `leads` is only the five
     newest NEW/ROUTED/CLAIMED rows the Overview lists. */
  const won = stats.won;
  const lost = stats.lost;
  const active = stats.active;
  const rate = won + lost > 0 ? (won / (won + lost)) * 100 : 0;
  const fresh = leads;
  const dueNow = useMemo(() => queue.filter((q) => q.overdue), [queue]);
  const laterOn = useMemo(() => queue.filter((q) => !q.overdue), [queue]);
  const oldest = useMemo(
    () => dueNow.reduce((a, q) => Math.max(a, q.days), 0),
    [dueNow],
  );

  /* ---------- derived: book ------------------------------------------- */
  const bookCounts = useMemo(() => {
    const out: Record<string, number> = { ALL: customers.length };
    STATUS_ORDER.forEach((s) => {
      out[s] = customers.filter((c) => c.top === s).length;
    });
    return out;
  }, [customers]);
  /* Only the statuses the book actually holds get a cell — the desktop chip
     rail does the same, so an empty status never becomes a dead target. */
  const bookOptions = useMemo(
    () => [
      { key: "ALL", label: "All" },
      ...STATUS_ORDER.filter((s) => bookCounts[s] > 0).map((s) => ({ key: s, label: titleCase(s) })),
    ],
    [bookCounts],
  );
  const bookVisible = useMemo(
    () =>
      customers.filter(
        (c) => (bookFilter === "ALL" || c.top === bookFilter) && matchesCustomer(c, bookQuery),
      ),
    [customers, bookFilter, bookQuery],
  );
  const ltvTotal = useMemo(() => customers.reduce((a, c) => a + c.ltv, 0), [customers]);
  const quotesTotal = useMemo(() => customers.reduce((a, c) => a + c.quotes, 0), [customers]);
  const payers = useMemo(() => customers.filter((c) => c.ltv > 0).length, [customers]);
  const bookPages = Math.max(1, Math.ceil(bookVisible.length / PAGE_BOOK));
  const bookSafe = Math.min(bookPage, bookPages);
  const bookSlice = bookVisible.slice((bookSafe - 1) * PAGE_BOOK, bookSafe * PAGE_BOOK);

  /* ---------- derived: rules ------------------------------------------ */
  const rulesOn = useMemo(() => rules.filter((r) => r.enabled), [rules]);
  const fastest = useMemo(
    () => (rulesOn.length ? Math.min(...rulesOn.map((r) => r.delayMinutes)) : 0),
    [rulesOn],
  );

  /* ---------- derived: queue ------------------------------------------ */
  const qCounts = useMemo(
    () => ({ ALL: queue.length, DUE: dueNow.length, SCHEDULED: laterOn.length }),
    [queue.length, dueNow.length, laterOn.length],
  );
  const qVisible = useMemo(
    () => (qFilter === "DUE" ? dueNow : qFilter === "SCHEDULED" ? laterOn : queue),
    [qFilter, dueNow, laterOn, queue],
  );
  const qPages = Math.max(1, Math.ceil(qVisible.length / PAGE_QUEUE));
  const qSafe = Math.min(qPage, qPages);
  const qSlice = qVisible.slice((qSafe - 1) * PAGE_QUEUE, qSafe * PAGE_QUEUE);

  /* ---------- masthead: one numeral, mono kicker, TWO annotations -------
     Never a third, and all three computed — claim a lead or send a follow-up
     and the head moves with it. */
  const mast = useMemo(() => {
    if (tab === "today") {
      const t = brief?.today ?? null;
      const open = t ? t.score.open : 0;
      const urgent = t ? t.checks.filter((c) => c.tone === "danger" && !c.done).length : 0;
      return {
        kicker: "Today · to check",
        value: open,
        format: fmtInt,
        tone: t && t.score.total > 0 && open === 0 ? styles.isGood : urgent ? styles.isBad : "",
        a1: { l: "Checked", v: t ? `${t.score.done} of ${t.score.total}` : "—" },
        a2: { l: "Can't wait", v: t ? String(urgent) : "—" },
      };
    }
    if (tab === "office") {
      const o = brief?.office ?? null;
      const by = (k: string) => o?.health.find((x) => x.key === k);
      return {
        kicker: "Collected this month",
        value: by("mtd")?.raw ?? 0,
        format: fmtMoney,
        tone: "",
        a1: { l: "Still owed", v: o ? moneyShort(by("outstanding")?.raw ?? 0) : "—" },
        a2: { l: "Win rate · 90d", v: by("win")?.value ?? "—" },
      };
    }
    if (tab === "back") {
      return {
        // Money, not a head count: the panel below counts the clients itself, by its own (wider) rule.
        kicker: "Win back · paid by your clients, all time",
        value: ltvTotal,
        format: fmtMoney,
        tone: "",
        a1: { l: "Paying clients", v: String(payers) },
        a2: { l: "Proposals", v: String(quotesTotal) },
      };
    }
    if (tab === "overview") {
      return {
        kicker: "Conversion · won rate",
        value: rate,
        format: fmtPct,
        tone: "",
        a1: { l: "Won · lost", v: `${won} · ${lost}` },
        a2: { l: "Active leads", v: String(active) },
      };
    }
    if (tab === "book") {
      return {
        kicker: "Lifetime value · paid",
        value: ltvTotal,
        format: fmtMoney,
        tone: "",
        a1: { l: "Customers", v: String(customers.length) },
        a2: { l: "Proposals", v: String(quotesTotal) },
      };
    }
    if (tab === "rules") {
      return {
        kicker: "Follow-up rules · live",
        value: rulesOn.length,
        format: fmtInt,
        tone: "",
        a1: { l: "Rules total", v: String(rules.length) },
        a2: { l: "Fastest", v: fastest ? humanDelay(fastest) : "—" },
      };
    }
    return {
      kicker: "Follow-ups · overdue",
      value: dueNow.length,
      format: fmtInt,
      tone: dueNow.length ? styles.isBad : styles.isGood,
      a1: { l: "Scheduled", v: String(laterOn.length) },
      a2: { l: "Oldest", v: oldest ? `${oldest}d` : "—" },
    };
  }, [
    tab, brief, rate, won, lost, active, ltvTotal, customers.length, quotesTotal, payers,
    rulesOn.length, rules.length, fastest, dueNow.length, laterOn.length, oldest,
  ]);

  /* ---------- What needs you — the donor's action rows ------------------
     `go` switches a tab on this page; `nav` leaves for another page. Every row
     does one or the other — none of them is decoration. */
  const actionRows = useMemo(() => {
    const rows: Array<{
      tone: string;
      icon: string;
      t: string;
      h: string;
      go: TabKey | null;
      nav?: string;
    }> = [];
    if (dueNow.length > 0) {
      rows.push({
        tone: styles.toneDanger,
        icon: "i-cal",
        t: `${dueNow.length} follow-up${dueNow.length === 1 ? "" : "s"} overdue`,
        h: "Run or mark done in the queue",
        go: "queue",
      });
    }
    if (active > 0) {
      rows.push({
        tone: styles.toneBp,
        icon: "i-target",
        t: `${active} lead${active === 1 ? "" : "s"} still in motion`,
        h: "Push them forward in the pipeline",
        go: null,
        nav: "/dashboard/leads",
      });
    }
    if (stats.conversations > 0) {
      rows.push({
        tone: "",
        icon: "i-msg",
        t: `${stats.conversations} conversation${stats.conversations === 1 ? "" : "s"}`,
        h: "Open the shared inbox",
        go: null,
        nav: "/dashboard/messages",
      });
    }
    rows.push({
      tone: "",
      icon: "i-chart",
      t: "Quote → close optimization",
      h: "Tighten your follow-up workflow rules",
      go: "rules",
    });
    return rows;
  }, [dueNow.length, active, stats.conversations]);

  /** `typedRoutes` is on, so `push` wants a Route; every href here is a
   *  literal owned by this module. */
  const go = useCallback(
    (href: string) => router.push(href as Parameters<typeof router.push>[0]),
    [router],
  );

  /* ---------- the row sheet, one per record kind ------------------------ */
  const sheetView = useMemo<{ kicker: string; title: string; rows: MenuRow[] } | null>(() => {
    if (!sheet) return null;

    if (sheet.kind === "lead") {
      const l = leads.find((x) => x.id === sheet.id);
      if (!l) return null;
      const claimed = l.status === "CLAIMED";
      return {
        kicker: `Lead · ${l.status.toLowerCase()} · ${l.age}`,
        title: l.name,
        rows: [
          { act: "open", icon: "i-target", tone: styles.toneBp, title: "Open lead", sub: l.project },
          {
            act: "claim", icon: "i-userplus", tone: styles.toneSky,
            title: claimed ? "Already claimed" : "Claim lead",
            sub: claimed ? `Working with ${l.assignee ?? "the shop"}` : "Assign it to you",
            disabled: claimed,
          },
          {
            act: "msg", icon: "i-msg", tone: styles.toneOk, title: "Message assignee",
            sub: l.assignee ? `Open the inbox — ${l.assignee}` : "Unassigned — route it first",
            disabled: !l.assignee,
          },
          {
            act: "quote", icon: "i-fileplus", tone: styles.toneWarn,
            title: "Convert to proposal", sub: "Start a Smart Proposal",
          },
          {
            act: "drop", icon: "i-trash", tone: styles.toneDanger,
            title: "Discard lead", sub: "Removes it from the pipeline", danger: true,
          },
        ],
      };
    }

    if (sheet.kind === "customer") {
      const c = customers.find((x) => x.id === sheet.id);
      if (!c) return null;
      // No "Remove from book" row: a customer joins the book by having a
      // proposal, and there is no client-delete action in the data layer to
      // wire it to. A row that only hides itself would be a lie.
      return {
        kicker: `${c.quotes} proposal${c.quotes === 1 ? "" : "s"} · ${money(c.quoted)} quoted · last ${c.last}`,
        title: c.name,
        rows: [
          {
            act: "open", icon: "i-user", tone: styles.toneBp, title: "Open customer",
            sub: c.ltv ? `Record, proposals and ${money(c.ltv)} collected` : "Record and proposal history",
          },
          { act: "prop", icon: "i-fileplus", tone: styles.toneSky, title: "New proposal", sub: `Start one for ${c.name}` },
          {
            act: "mail", icon: "i-mail", tone: styles.toneOk, title: "Send email",
            sub: c.email || "No email on file", disabled: !c.email,
          },
        ],
      };
    }

    if (sheet.kind === "rule") {
      const r = rules.find((x) => x.id === sheet.id);
      if (!r) return null;
      return {
        kicker: `${triggerLabel(r.triggerStatus)} · ${humanDelay(r.delayMinutes)} delay`,
        title: r.name,
        rows: [
          { act: "edit", icon: "i-gear", tone: styles.toneBp, title: "Edit rule", sub: "Trigger, delay and channel" },
          {
            act: "preview", icon: "i-file", tone: styles.toneSky, title: "Preview the message",
            sub: `Shows the ${channelLabel(r.channel).toLowerCase()} this rule sends`,
          },
          {
            act: "flip", icon: "i-rotate", tone: styles.toneOk,
            title: r.enabled ? "Turn off" : "Turn on",
            sub: r.enabled ? "Stops scheduling new follow-ups" : "Starts scheduling again",
          },
          // A starter rule is never deleted (actions/followUps turns it off
          // instead), so its sheet keeps only the Turn off / Turn on row above.
          ...(r.isDefault
            ? []
            : [{ act: "del", icon: "i-trash", tone: styles.toneDanger, title: "Delete rule", sub: "Scheduled follow-ups stay in the queue", danger: true }]),
        ],
      };
    }

    const q = queue.find((x) => x.id === sheet.id);
    if (!q) return null;
    // Reschedule and Cancel are gone: `FollowUp` has no reschedule or cancel
    // action, only runFollowUpNow / markFollowUpDone. Both of those are here.
    return {
      kicker: `${q.date} · ${q.rel}`,
      title: q.client,
      rows: [
        { act: "send", icon: "i-send", tone: styles.toneSky, title: "Send now", sub: "Delivers the follow-up and clears it" },
        { act: "done", icon: "i-check", tone: styles.toneOk, title: "Mark done", sub: "Clears it without sending" },
        {
          act: "open", icon: "i-folder", tone: styles.toneBp, title: "Open proposal",
          sub: q.proposalId ? (q.title ?? "The proposal this follow-up chases") : "No proposal on this follow-up",
          disabled: !q.proposalId,
        },
      ],
    };
  }, [sheet, leads, customers, rules, queue]);

  /* ---------- rule form ----------------------------------------------- */
  const openRule = (r: FollowUpRule | null) => {
    const days = r ? Math.max(1, Math.round(r.delayMinutes / 60 / 24)) : 2;
    setForm({
      name: r?.name ?? "",
      trigger: r?.triggerStatus ?? "SENT",
      days: String(days),
      channel: r?.channel ?? "EMAIL",
      mode: r?.mode ?? "AUTO",
      words: r?.words ?? "STANDARD",
    });
    // The preview under the list follows the form, so closing the sheet leaves
    // the card on the message the rule being edited actually sends.
    prevSeeded.current = true;
    setPrev({ trigger: r?.triggerStatus ?? "SENT", channel: r?.channel ?? "EMAIL", days });
    setEditingId(r?.id ?? null);
    setNameErr(false);
    setDaysErr(null);
    setActionErr(null);
    setSheet(null);
    setTab("rules");
    setFilterOpen(false);
    setRuleOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  /* Create / update goes through `upsertFollowUpRule` — the same action the
     desktop sheet and the classic editor call. `channel` is the only per-rule
     choice left; the wording comes from the trigger. */
  const submitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }
    // Whole days in range, or the field says so — `parseInt(...) || 1` sent 40
    // nines on as 1.44e43 minutes and the save came back a 500 (QA F-fd2683fc).
    const days = readDelayDays(form.days);
    if (typeof days === "string") {
      setDaysErr(days);
      return;
    }
    const existing = editingId ? rules.find((r) => r.id === editingId) : null;
    setSaving(true);
    // A refusal is thrown on here, client-side, so `commit` reports it the
    // way it reports any write that didn't go through — and the sheet stays open.
    const ok = await commit(editingId, async () => {
      const res = await upsertFollowUpRule({
        id: editingId ?? undefined,
        name,
        triggerStatus: form.trigger,
        delayMinutes: days * 60 * 24,
        // A new rule starts live; an edit keeps whatever the switch says.
        enabled: existing ? existing.enabled : true,
        channel: form.channel,
        mode: form.mode,
        words: form.words,
      });
      if (!res.ok) throw new Error(res.error);
    });
    setSaving(false);
    if (ok) {
      if (editingId) setLandedId(editingId);
      setRuleOpen(false);
    }
  };

  /* ---------- mutations — every one of these hits the database ---------- */
  const toggleRule = (id: string, next: boolean) => {
    // Paint the flip immediately; `commit` re-reads and corrects if refused.
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: next } : r)));
    setLandedId(id);
    return commit(id, () => setFollowUpRuleEnabled(id, next));
  };

  /* The row fades for 240ms before it leaves the list — the donor's `.gone`
     pass — while the server action runs underneath. */
  const fadeOut = (id: string) => setGone((prev) => (prev.includes(id) ? prev : [...prev, id]));

  const sendFollowUp = (id: string) => {
    fadeOut(id);
    return commit(id, () => runFollowUpNow(id));
  };

  const runSheet = async (act: string) => {
    const target = sheet;
    setSheet(null);
    if (!target) return;

    if (target.kind === "lead") {
      const lead = leads.find((l) => l.id === target.id);
      if (act === "drop") {
        await commit(target.id, () => deleteLead(target.id));
      } else if (act === "claim") {
        setLandedId(target.id);
        await commit(target.id, () => claimLead(target.id));
      } else if (act === "open") {
        go(`/dashboard/leads/${target.id}`);
      } else if (act === "msg" && lead?.assignee) {
        go("/dashboard/messages");
      } else if (act === "quote") {
        go("/dashboard/advanced-ai");
      }
      return;
    }
    if (target.kind === "customer") {
      const c = customers.find((x) => x.id === target.id);
      if (act === "open") {
        go(`/dashboard/clients/${target.id}`);
      } else if (act === "prop") {
        go("/dashboard/manual-blueprint");
      } else if (act === "mail" && c?.email) {
        // Hands off to the phone's mail app. `assign` rather than the router:
        // mailto: is not an app route. The address is filtered to the addr-spec
        // charset so nothing can smuggle extra mailto headers through it.
        window.location.assign(`mailto:${c.email.trim().replace(/[^\w.@+-]/g, "")}`);
      }
      return;
    }
    if (target.kind === "rule") {
      const r = rules.find((x) => x.id === target.id);
      if (act === "del") {
        await commit(target.id, () => deleteFollowUpRule(target.id));
      } else if (act === "flip" && r) {
        await toggleRule(target.id, !r.enabled);
      } else if (act === "edit") {
        openRule(r ?? null);
      } else if (act === "preview" && r) {
        prevSeeded.current = true;
        setPrev({
          trigger: r.triggerStatus,
          channel: r.channel,
          days: Math.max(1, Math.round(r.delayMinutes / 60 / 24)),
        });
        previewRef.current?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      }
      return;
    }

    const q = queue.find((x) => x.id === target.id);
    if (act === "send") {
      await sendFollowUp(target.id);
    } else if (act === "done") {
      fadeOut(target.id);
      await commit(target.id, () => markFollowUpDone(target.id));
    } else if (act === "open" && q?.proposalId) {
      go(`/dashboard/proposals/${q.proposalId}`);
    }
  };

  const clearBook = () => {
    setBookFilter("ALL");
    setBookQuery("");
    setBookPage(1);
  };

  const goTab = (next: TabKey) => {
    setTab(next);
    setFilterOpen(false);
  };

  /* The Office and Win back tabs are the office's alone; a sales rep or an
     estimator never sees them (lib/crm/brief decides who is who). */
  const tabs = useMemo(() => TABS.filter((t) => (t.key !== "office" && t.key !== "back") || !!brief?.office), [brief?.office]);
  /* A link may open the page on the Office tab (2026-11-10: the Monday report's button → ?tab=office) — once, when
     the read says this person has one. */
  const linkTab = useRef<string | null>(null);
  useEffect(() => {
    linkTab.current = new URLSearchParams(window.location.search).get("tab");
  }, []);
  const hasOffice = !!brief?.office;
  useEffect(() => {
    if (!hasOffice || linkTab.current !== "office") return;
    linkTab.current = null;
    setTab("office");
  }, [hasOffice]);
  const tabIndex = Math.max(0, tabs.findIndex((t) => t.key === tab));
  const anyOverlay = Boolean(sheetView) || ruleOpen;
  /* Panels wait for the read. Rendering them first would print "Book is
     empty" / "Queue is clear" over rows that are still in flight. */
  const ready = !loading && !loadErr;

  // Swipe-down dismissal, one gesture per sheet, wired to the close paths the
  // scrim and Cancel already use.
  const actionsDrag = useSheetDrag(Boolean(sheetView), () => setSheet(null));
  const ruleDrag = useSheetDrag(ruleOpen, () => setRuleOpen(false));

  return (
    <div className={styles.app} onClick={onRootClick}>

      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, so the page holds none. */}
      <MobileNav />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD
              No eyebrow. The "Pipeline" kicker named the SECTION above a title
              that already says which section it is — the same trim the mobile
              Clients head got. */}
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>CRM</h1>
            <div className={styles.pageActions}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                type="button"
                onClick={() => openRule(null)}
              >
                <Icon id="i-plus" />New rule
              </button>
            </div>
          </div>

          {/* MASTHEAD — key on tab so the 320ms slide-in replays */}
          <div className={`${styles.cmast} ${styles.slide}`} key={tab}>
            <div className={styles.cmastTop}>
              <div className={styles.cmastLbl}>
                {mast.kicker}
                <span className={styles.cmastRule} />
              </div>
              <CountUp
                value={mast.value}
                format={mast.format}
                className={`${styles.cmastVal} ${mast.tone}`}
              />
            </div>
            <div className={styles.cmastCnt}>
              {[mast.a1, mast.a2].map((a) => (
                <div className={styles.cmastSub} key={a.l}>
                  <div className={styles.cmastSubL}>{a.l}</div>
                  <div className={styles.cmastSubV}>{a.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* TABS — the desktop's four CRM panels */}
          <div className={styles.tabs} data-n={tabs.length} style={{ ["--tabs" as string]: tabs.length }}>
            <span className={styles.tabInd} style={{ transform: `translateX(${tabIndex * 100}%)` }} />
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`${styles.tab} ${tab === t.key ? styles.active : ""}`}
                type="button"
                aria-current={tab === t.key ? "page" : undefined}
                onClick={(e) => {
                  goTab(t.key);
                  /* Seven tabs scroll sideways on a phone: keep the chosen one whole. */
                  e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                }}
              >
                {t.label}
                {t.key === "queue" ? <span className={styles.tabCount}>{dueNow.length}</span> : null}
              </button>
            ))}
          </div>

          {/* ---- read state: the panels only paint once the rows are in ---- */}
          {loading ? (
            <div className={styles.note} role="status">
              <div className={styles.noteT}>Loading your CRM…</div>
              <div className={styles.noteS}>
                Leads, the customer book, your workflow rules and the follow-up queue.
              </div>
            </div>
          ) : null}

          {!loading && loadErr ? (
            <div className={styles.empty} role="alert">
              <div className={styles.emptyT}>Couldn&rsquo;t load the CRM</div>
              <div className={styles.emptyS}>{loadErr}</div>
              <button
                className={styles.emptyA}
                type="button"
                onClick={() => {
                  setLoading(true);
                  refresh().finally(() => setLoading(false));
                }}
              >
                <Icon id="i-rotate" />Try again
              </button>
            </div>
          ) : null}

          {/* A write the server refused (rule CRUD is manager-only, the queue
              is sales-or-manager) reports here rather than silently snapping. */}
          {actionErr ? (
            <div className={styles.note} role="alert">
              <div className={styles.noteT}>That didn&rsquo;t go through</div>
              <div className={styles.noteS}>{actionErr}</div>
            </div>
          ) : null}

          {/* ============ TAB: TODAY — what to check ============ */}
          {ready && tab === "today" && brief && (
            <TodayPanel key={brief.today.dayKey} today={brief.today} onGoto={(t) => goTab(t === "queue" ? "queue" : t === "workflows" ? "rules" : "book")} extraOpen={deskN} extra={<AgentDesk onFollowUpClosed={followUpClosed} onCount={setDeskN} />} />
          )}
          {ready && tab === "today" && !brief && (
            <div className={styles.note} role="status">
              <div className={styles.noteT}>Today&rsquo;s checks didn&rsquo;t load</div>
              <div className={styles.noteS}>Pull down to try again.</div>
            </div>
          )}

          {/* ============ TAB: OFFICE — how the company is doing ============ */}
          {ready && tab === "office" && brief?.office && <OfficePanel office={brief.office} company={org.name} extra={<CompanyPulse />} />}

          {/* WIN BACK — bring past clients back (Smart CRM part 6); it reads its own numbers. */}
          {ready && tab === "back" && brief?.office && <WinBackPanel />}

          {/* ============ TAB: OVERVIEW ============ */}
          {ready && tab === "overview" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>Fresh leads</div>
                <div className={styles.cardSub}>Latest five — tap one to claim or route.</div>
              </div>
              {fresh.length === 0 ? (
                <div className={styles.note}>
                  <div className={styles.noteT}>No new leads</div>
                  <div className={styles.noteS}>
                    Claimed and routed work moves on to the pipeline. New enquiries land here on
                    their own.
                  </div>
                </div>
              ) : (
                <div className={styles.fresh}>
                  {fresh.map((l, i) => (
                    <button
                      key={l.id}
                      className={`${styles.fitem} ${styles.rowIn} ${landedId === l.id ? styles.landed : ""}`}
                      style={{ animationDelay: `${i * 45}ms` }}
                      type="button"
                      onClick={() => setSheet({ kind: "lead", id: l.id })}
                    >
                      <span className={styles.fname}>{l.name}</span>
                      <span className={styles.fbadge}>
                        <span className={`${styles.pstatus} ${styles[LEAD_CLS[l.status]] ?? ""}`}>
                          {l.status.toLowerCase()}
                        </span>
                      </span>
                      <span className={styles.fsub}>
                        {l.project}
                        {l.assignee ? ` · ${l.assignee}` : ""}
                      </span>
                      <span className={styles.fage}>{l.age}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {ready && tab === "overview" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>What needs you</div>
                <div className={styles.cardSub}>Pinch points worth acting on.</div>
              </div>
              <div className={styles.arows}>
                {actionRows.map((r) => (
                  <button
                    key={r.t}
                    className={styles.arow}
                    type="button"
                    onClick={() => (r.go ? goTab(r.go) : r.nav ? go(r.nav) : undefined)}
                  >
                    <span className={`${styles.mIc} ${r.tone}`}>
                      <Icon id={r.icon} />
                    </span>
                    <span className={styles.arowTxt}>
                      <span className={styles.arowT}>{r.t}</span>
                      <span className={styles.arowH}>{r.h}</span>
                    </span>
                    <Icon id="i-arrow" className={`${styles.ic} ${styles.arowGo}`} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {ready && tab === "overview" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>Recent activity</div>
              </div>
              {activity.length === 0 ? (
                <div className={styles.note}>
                  <div className={styles.noteT}>Nothing recorded yet</div>
                  <div className={styles.noteS}>
                    Sends, views, payments and status changes are logged here as they happen.
                  </div>
                </div>
              ) : (
                <ul className={styles.recent}>
                  {activity.slice(0, 5).map((a) => (
                    <li className={styles.ritem} key={a.id}>
                      <span className={styles.rtxt}>{a.summary}</span>
                      <span className={styles.rage}>{a.age}</span>
                      <Who who={a.who} compact className={styles.rwho} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ============ TAB: CUSTOMER BOOK ============ */}
          {ready && tab === "book" && (
            <div className={styles.find}>
              <label className={styles.srch}>
                <Icon id="i-search" />
                <input
                  className={styles.srchInput}
                  type="search"
                  value={bookQuery}
                  placeholder="Search name, email or status…"
                  autoComplete="off"
                  aria-label="Search the customer book"
                  onChange={(e) => {
                    setBookQuery(e.target.value);
                    setBookPage(1);
                  }}
                />
                {bookQuery ? (
                  <button
                    className={styles.srchX}
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setBookQuery("");
                      setBookPage(1);
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
                  <span className={styles.ddValue} data-f={bookFilter}>
                    {bookOptions.find((o) => o.key === bookFilter)?.label ?? "All"} ·{" "}
                    {bookCounts[bookFilter] ?? 0}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
                </button>
                <div className={styles.ddMenu} role="listbox">
                  {bookOptions.map((o) => (
                    <button
                      key={o.key}
                      className={`${styles.ddItem} ${bookFilter === o.key ? styles.active : ""}`}
                      type="button"
                      role="option"
                      aria-selected={bookFilter === o.key}
                      onClick={() => {
                        setBookFilter(o.key);
                        setBookPage(1);
                        setFilterOpen(false);
                      }}
                    >
                      {o.label}
                      <span className={styles.ddCount}>{bookCounts[o.key] ?? 0}</span>
                      {bookFilter === o.key ? <Icon id="i-check" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {ready && tab === "book" && (
            bookVisible.length === 0 ? (
              <div className={styles.empty}>
                {customers.length === 0 ? (
                  <>
                    <div className={styles.emptyT}>Book is empty</div>
                    <div className={styles.emptyS}>
                      An account joins the book on its first proposal. Send one and it appears here.
                    </div>
                    <button
                      className={styles.emptyA}
                      type="button"
                      onClick={() => go("/dashboard/manual-blueprint")}
                    >
                      <Icon id="i-fileplus" />New proposal
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.emptyT}>No matches</div>
                    <div className={styles.emptyS}>
                      No customer matches that search and filter.
                    </div>
                    <button className={styles.emptyA} type="button" onClick={clearBook}>
                      <Icon id="i-x" />Clear filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className={styles.list}>
                {bookSlice.map((c, i) => (
                  <div
                    key={c.id}
                    className={`${styles.row} ${styles.rowIn} ${landedId === c.id ? styles.landed : ""}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <span className={`${styles.cav} ${isCompany(c.name) ? styles.isCo : ""}`}>
                      {initials(c.name)}
                    </span>
                    <div className={styles.cname}>{c.name}</div>
                    <button
                      className={styles.rowOpen}
                      type="button"
                      aria-label={`Actions for ${c.name}`}
                      onClick={() => setSheet({ kind: "customer", id: c.id })}
                    >
                      <Icon id="i-dots" />
                    </button>
                    <div className={styles.cmail}>{c.email}</div>
                    <div className={styles.rowFoot}>
                      <span className={styles.rowMeta}>
                        <span className={`${styles.pstatus} ${styles[STATUS_CLS[c.top]] ?? ""}`}>
                          {titleCase(c.top)}
                        </span>
                        <span className={styles.rowMono}>
                          {c.quotes} quote{c.quotes === 1 ? "" : "s"}
                        </span>
                      </span>
                      {/* A figure of zero is an em dash, never "$0": zero is a
                          number, "nothing collected" is an absence. */}
                      <span className={`${styles.rowFig} ${c.ltv ? "" : styles.isZero}`}>
                        {c.ltv ? money(c.ltv) : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {ready && tab === "book" && (
            <Pager page={bookSafe} total={bookVisible.length} per={PAGE_BOOK} onGo={setBookPage} />
          )}

          {/* ============ TAB: WORKFLOWS ============ */}
          {ready && tab === "rules" && (() => {
            const next = queue.reduce<number | null>((m, q) => (m === null || q.runAt < m ? q.runAt : m), null);
            const st = followUpsStatus(rulesOn.length, next, renderedAt);
            return (
              <div className={`${styles.fuStatus} ${st.on ? "" : styles.fuOff}`} role="status">
                <p className={styles.fuTxt}>
                  <span className={styles.fuDot} aria-hidden="true" />
                  <span>
                    <b>{st.lead}</b>
                    {st.rest ? ` ${st.rest}` : ""}
                  </span>
                </p>
                {st.on ? null : (
                  <button
                    className={styles.fuBtn}
                    type="button"
                    disabled={busyId === "fu-defaults"}
                    onClick={() => void commit("fu-defaults", () => turnOnDefaultFollowUps())}
                  >
                    Turn on defaults
                  </button>
                )}
              </div>
            );
          })()}
          {ready && tab === "rules" && (
            rules.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyT}>No rules yet</div>
                <div className={styles.emptyS}>
                  A rule schedules a follow-up when a proposal hits a status. Create one to start
                  automating reminders.
                </div>
                <button className={styles.emptyA} type="button" onClick={() => openRule(null)}>
                  <Icon id="i-plus" />New rule
                </button>
              </div>
            ) : (
              <div className={styles.list}>
                {rules.map((r, i) => (
                  <div
                    key={r.id}
                    className={`${styles.row} ${styles.rowB} ${styles.rowIn} ${landedId === r.id ? styles.landed : ""}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <div className={styles.rname}>
                      {r.name}
                      {r.isDefault ? <span className={styles.ruleDef}>Default</span> : null}
                    </div>
                    <button
                      className={styles.rowOpen}
                      type="button"
                      aria-label={`Actions for ${r.name}`}
                      onClick={() => setSheet({ kind: "rule", id: r.id })}
                    >
                      <Icon id="i-dots" />
                    </button>
                    <div className={styles.rmeta}>
                      {triggerLabel(r.triggerStatus)} · {channelLabel(r.channel)} · <span data-rule-mode={r.mode ?? "AUTO"}>{modeLabel(r.mode ?? "AUTO")}</span>
                      {r.words === "AI" && r.mode !== "SUGGEST" ? " · Written for each client" : ""}
                    </div>
                    <div className={styles.rowFoot}>
                      <span className={styles.rowMeta}>
                        <span className={`${styles.pstatus} ${r.enabled ? styles.rstOn : styles.rstOff}`}>
                          {r.enabled ? "active" : r.isDefault ? "Turned off" : "off"}
                        </span>
                        {/* A drawn switch: the native control carries neither
                            the ink frame nor a 44px tap height. */}
                        <button
                          className={styles.tgl}
                          type="button"
                          aria-pressed={r.enabled}
                          disabled={busyId === r.id}
                          aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.name}`}
                          onClick={() => void toggleRule(r.id, !r.enabled)}
                        >
                          <span className={styles.tglTrack}>
                            <span className={styles.tglKnob} />
                          </span>
                        </button>
                      </span>
                      <span className={styles.rowFig}>{humanDelay(r.delayMinutes)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ---- what the client receives ----
              Below the rules rather than beside them: at 390px there is no
              "right of". Same render the dispatcher sends, driven by the
              trigger picked here or in the rule sheet. */}
          {ready && tab === "rules" && (
            <div className={styles.prevCard} ref={previewRef}>
              <div className={styles.prevHead}>
                <div className={styles.prevTitles}>
                  <div className={styles.prevTitle}>What they receive</div>
                  <div className={styles.prevSub}>
                    {channelLabel(prev.channel)} · {delayLabel(prev.days * 60 * 24)} after{" "}
                    {triggerLabel(prev.trigger).toLowerCase()}
                  </div>
                </div>
                <span className={styles.pselBox}>
                  <select
                    className={styles.psel}
                    aria-label="Preview moment"
                    value={prev.trigger}
                    onChange={(e) => {
                      prevSeeded.current = true;
                      setPrev((p) => ({ ...p, trigger: e.target.value }));
                    }}
                  >
                    {TRIGGERS.map((t) => (
                      <option value={t.value} key={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.pselCaret}`} />
                </span>
              </div>
              <MessagePreview
                trigger={prev.trigger}
                channel={prev.channel}
                delayMinutes={prev.days * 60 * 24}
                org={org}
                smsEnabled={smsEnabled}
              />
            </div>
          )}

          {/* ============ TAB: FOLLOW-UP QUEUE ============ */}
          {ready && tab === "queue" && queue.length > 0 && (
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
                <span className={styles.ddValue} data-f={qFilter}>
                  {QUEUE_FILTERS.find((f) => f.key === qFilter)?.label ?? "All"} · {qCounts[qFilter]}
                </span>
                <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
              </button>
              <div className={styles.ddMenu} role="listbox">
                {QUEUE_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`${styles.ddItem} ${qFilter === f.key ? styles.active : ""}`}
                    type="button"
                    role="option"
                    aria-selected={qFilter === f.key}
                    onClick={() => {
                      setQFilter(f.key);
                      setQPage(1);
                      setFilterOpen(false);
                    }}
                  >
                    {f.label}
                    <span className={styles.ddCount}>{qCounts[f.key]}</span>
                    {qFilter === f.key ? <Icon id="i-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {ready && tab === "queue" && (
            qVisible.length === 0 ? (
              <div className={styles.empty}>
                {queue.length === 0 ? (
                  <>
                    <div className={styles.emptyT}>Queue is clear</div>
                    <div className={styles.emptyS}>
                      Follow-ups are scheduled by your workflow rules. When proposals trigger them,
                      they land here.
                    </div>
                    <button className={styles.emptyA} type="button" onClick={() => openRule(null)}>
                      <Icon id="i-plus" />New rule
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.emptyT}>No matches</div>
                    <div className={styles.emptyS}>
                      Nothing in the queue is {qFilter === "DUE" ? "overdue" : "scheduled ahead"}{" "}
                      right now.
                    </div>
                    <button
                      className={styles.emptyA}
                      type="button"
                      onClick={() => {
                        setQFilter("ALL");
                        setQPage(1);
                      }}
                    >
                      <Icon id="i-x" />Clear filter
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className={styles.list}>
                {qSlice.map((q, i) => {
                  const sev = severity(q);
                  return (
                    <div
                      key={q.id}
                      className={`${styles.row} ${styles.rowB} ${styles.rowIn} ${gone.includes(q.id) ? styles.gone : ""} ${landedId === q.id ? styles.landed : ""}`}
                      style={{ animationDelay: `${i * 45}ms` }}
                    >
                      <div className={styles.qwho}>{q.client}</div>
                      <button
                        className={styles.rowOpen}
                        type="button"
                        aria-label={`Actions for the ${q.client} follow-up`}
                        onClick={() => setSheet({ kind: "queue", id: q.id })}
                      >
                        <Icon id="i-dots" />
                      </button>
                      <div className={styles.qtitle}>
                        {q.title ?? "Follow-up"}
                        {/* Why it's waiting sits under the job's name, in the same cell — never a second thing in that row. */}
                        {q.reason && !q.waiting ? (
                          <span className={styles.qreason} data-q-reason>
                            {q.reason}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.rowFoot}>
                        <span className={styles.rowMeta}>
                          <span className={`${styles.sev} ${styles[sev.cls]}`}>{sev.label}</span>
                          <span className={styles.rowMono}>{q.date}</span>
                        </span>
                        <button
                          className={styles.qsend}
                          type="button"
                          disabled={busyId === q.id}
                          onClick={() => void sendFollowUp(q.id)}
                        >
                          <Icon id="i-send" />Send
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {ready && tab === "queue" && (
            <Pager page={qSafe} total={qVisible.length} per={PAGE_QUEUE} onGo={setQPage} />
          )}
        </div>
      </main>

      {/* No floating action button: the page's one create action lives in the
          head, so nothing needs to hover over the content. */}

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => {
          setSheet(null);
          setRuleOpen(false);
        }}
        aria-hidden="true"
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div
        className={`${styles.sheet} ${sheetView ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Record actions"
        aria-hidden={!sheetView}
        {...actionsDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          <div className={styles.sheetKicker}>{sheetView?.kicker ?? "CRM · —"}</div>
          <div className={styles.sheetTitle}>{sheetView?.title ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {(sheetView?.rows ?? []).map((r) => (
            <button
              key={r.act}
              type="button"
              disabled={r.disabled}
              className={`${styles.cmenuItem} ${r.danger ? styles.cmenuItemDanger : ""}`}
              onClick={() => runSheet(r.act)}
            >
              <span className={`${styles.mIc} ${r.tone ?? ""}`}>
                <Icon id={r.icon} />
              </span>
              <span>
                <span className={styles.cmenuItemT}>{r.title}</span>
                <span className={styles.cmenuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheet(null)}>
          Cancel
        </button>
      </div>

      {/* ============ RULE FORM SHEET ============ */}
      <div
        className={`${styles.sheet} ${ruleOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcrRuleTitle"
        aria-hidden={!ruleOpen}
        {...ruleDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...ruleDrag.handleProps} />
        <div className={styles.sheetHead} {...ruleDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {editingId ? "Workflows / edit rule" : "Workflows / new rule"}
          </div>
          <div className={styles.sheetTitle} id="mcrRuleTitle">
            {editingId ? "Edit rule" : "New rule"}
          </div>
        </div>
        <form
          className={`${styles.sheetBody} ${styles.formBody}`}
          id="mcrRuleForm"
          noValidate
          onSubmit={submitRule}
        >
          <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mcrName">
              Rule name<span className={styles.req}>*</span>
            </label>
            <input
              ref={nameRef}
              className={styles.pinput}
              id="mcrName"
              name="name"
              type="text"
              placeholder="Nudge after send"
              autoComplete="off"
              maxLength={120}
              value={form.name}
              aria-invalid={nameErr}
              aria-describedby={nameErr ? "mcrNameErr" : undefined}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                if (e.target.value.trim()) setNameErr(false);
              }}
            />
            {nameErr ? (
              <span className={styles.fldErr} id="mcrNameErr">
                Enter a rule name
              </span>
            ) : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcrTrigger">
              Trigger
            </label>
            <span className={styles.pselBox}>
              <select
                className={styles.psel}
                id="mcrTrigger"
                name="trigger"
                value={form.trigger}
                onChange={(e) => {
                  const trigger = e.target.value;
                  setForm((f) => ({ ...f, trigger }));
                  prevSeeded.current = true;
                  setPrev((p) => ({ ...p, trigger }));
                }}
              >
                {TRIGGERS.map((t) => (
                  <option value={t.value} key={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Icon id="i-chev" className={`${styles.ic} ${styles.pselCaret}`} />
            </span>
          </div>

          <div className={`${styles.fld} ${daysErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mcrDays">
              Delay (days)
            </label>
            <input
              className={styles.pinput}
              id="mcrDays"
              name="days"
              type="number"
              min="1"
              inputMode="numeric"
              value={form.days}
              aria-invalid={!!daysErr}
              aria-describedby={daysErr ? "mcrDaysErr" : undefined}
              onChange={(e) => {
                setForm((f) => ({ ...f, days: e.target.value }));
                setDaysErr(null);
                // The prose says the delay out loud ("we sent this over 2 days
                // ago"), so the preview follows it as it is typed.
                prevSeeded.current = true;
                setPrev((p) => ({ ...p, days: Math.max(1, parseInt(e.target.value, 10) || 1) }));
              }}
            />
            {daysErr ? (
              <span className={styles.fldErr} id="mcrDaysErr">
                {daysErr}
              </span>
            ) : (
              <span className={styles.fldHint}>
                How long after the trigger the follow-up is scheduled.
              </span>
            )}
          </div>

          {/* No template field. A rule's wording is written for its trigger
              (src/lib/followUps/copy.ts) — the only choice left is how it
              reaches the client, and TEXT needs a Twilio number, so it is
              offered disabled until there is one. */}
          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcrChannel">
              Send by
            </label>
            <span className={styles.pselBox}>
              <select
                className={styles.psel}
                id="mcrChannel"
                name="channel"
                value={form.channel}
                onChange={(e) => {
                  const channel = e.target.value as FollowUpChannel;
                  setForm((f) => ({ ...f, channel }));
                  prevSeeded.current = true;
                  setPrev((p) => ({ ...p, channel }));
                }}
              >
                {FOLLOW_UP_CHANNELS.map((c) => (
                  <option value={c.value} key={c.value} disabled={c.value === "TEXT" && !smsEnabled}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Icon id="i-chev" className={`${styles.ic} ${styles.pselCaret}`} />
            </span>
            <span className={styles.fldHint}>
              {smsEnabled
                ? "The preview under the rules list is the message this sends."
                : TEXT_NEEDS_TWILIO}
            </span>
          </div>
          {/* Who sends it, and whose words (lib/followUps/agent). */}
          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcrMode">
              Who sends it
            </label>
            <span className={styles.pselBox}>
              <select className={styles.psel} id="mcrMode" name="mode" value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as FollowUpMode }))}>
                {FOLLOW_UP_MODES.map((m) => (
                  <option value={m.value} key={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Icon id="i-chev" className={`${styles.ic} ${styles.pselCaret}`} />
            </span>
            <span className={styles.fldHint}>{FOLLOW_UP_MODES.find((m) => m.value === form.mode)?.hint}</span>
          </div>
          {form.mode !== "SUGGEST" && (
            <div className={styles.fld}>
              <label className={styles.fldLbl} htmlFor="mcrWords">
                Words
              </label>
              <span className={styles.pselBox}>
                <select className={styles.psel} id="mcrWords" name="words" value={form.words} onChange={(e) => setForm((f) => ({ ...f, words: e.target.value as FollowUpWords }))}>
                  {FOLLOW_UP_WORDS.map((w) => (
                    <option value={w.value} key={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
                <Icon id="i-chev" className={`${styles.ic} ${styles.pselCaret}`} />
              </span>
              <span className={styles.fldHint}>{FOLLOW_UP_WORDS.find((w) => w.value === form.words)?.hint}</span>
            </div>
          )}
          {/* The write the server refused, where the person is looking — the
              page's own note sits under this sheet. */}
          {ruleOpen && actionErr ? (
            <span className={styles.fldErr} role="alert">
              {actionErr}
            </span>
          ) : null}
        </form>
        <div className={styles.formFoot}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            onClick={() => setRuleOpen(false)}
          >
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            type="submit"
            form="mcrRuleForm"
            disabled={saving}
          >
            <Icon id="i-check" />
            {saving ? "Saving…" : "Save rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
