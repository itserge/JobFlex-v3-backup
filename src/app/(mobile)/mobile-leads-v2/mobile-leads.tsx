"use client";

import Link from "next/link";

// MOBILE LEADS (mobile-leads-v2) — Blueprint system, handheld build.
//
// Fourth sibling to /mobile-v2 (Overview), /mobile-proposals-v2 and
// /mobile-clients-v2. Tokens, palette, type scale, status tones and Motion
// System "Balanced" are the reference dashboard's; the page vocabulary
// (masthead, tab strip, one-dropdown filter, row cards, tonal menu boxes,
// bottom sheets) is lifted from those three so the four surfaces read as one
// product. The topbar and hamburger drawer come from the shared
// components/v3/mobile-shell/mobile-nav — this page ships no nav and no sprite.
//
// Built with the jobflex-page-styler skill (the visual system) and the
// mobile-app-ui-design skill (structure: thumb reach, ≥44px targets, sheets
// over modals, search over paging, initials over a repeated glyph). Where the
// two disagree the house system wins — hard 3px offset shadows, 2px radii and
// Inter 900 caps stay, rather than the mobile skill's soft-shadow / rounded-3xl
// defaults.
//
// EVERY region of the desktop leads sheet is covered:
//  · Pipeline head + the two primary actions (New lead / Import)
//  · computed masthead: one numeral, mono kicker, EXACTLY two annotations
//  · the tab row (All leads / Incoming) plus the Table↔Board view switch,
//    folded into one 3-segment tab strip with live counts and a sliding rule
//  · the search box
//  · the filter popover's Status list, as ONE dropdown whose 3×3 grid carries
//    all nine statuses with counts scoped to the current search
//  · the 6-column table, re-cut as row cards with initials avatars
//  · the seven-stage kanban, redrawn as vertical stage sections with tap-to-move
//  · the pager, and BOTH All-tab empty states (nothing yet / no matches)
//  · the Incoming inbox: platform offers with the live 24h window, routed
//    leads, accept / pass / decline, and its own empty state
//  · the row menu as a bottom sheet: 5 tonal boxes, two reachable disabled
//    rows, one danger row
//  · the delete-confirm dialog as a sheet
//  · the whole Import panel as a sheet: 3-method switch, manual form with
//    required-field validation, email paste + its parser, CSV dropzone, and —
//    for CSV only — the staged tray with per-row remove and the batch commit
//
// What changes versus the desktop sheet, and why:
//  · The 6-column table cannot survive 320px, so each record becomes a three
//    line row card — not a table with columns hidden.
//  · Source and Specialty were chip ROWS in the desktop popover. Chip rails do
//    not survive 320px, so they are answered by the search box instead (both
//    values are printed on the row card, so the target stays visible) and the
//    single dropdown is spent on Status — the dimension the board is built on.
//  · Drag & drop has no touch equivalent: a stage card is a button that opens
//    the stage picker, the pattern mobile-v2 already ships.
//  · Won and Lost do not take board sections. They are outcomes, not work; they
//    are tallied on the board's foot, filterable in All leads, and still
//    destinations in the move sheet.
//  · Page size 20 → 8: a handheld row is three lines tall.
//  · NO STAGING TRAY for by-hand and paste (2026-08-15). A tray is a desk idea —
//    build a batch, review it, send it. On a phone you are adding the person in
//    front of you, so "Add lead" writes the record and closes the sheet. The CSV
//    tab keeps the tray, because a file genuinely is a batch. The desktop sheet
//    is unchanged: all three of its methods still stage.
//  · Incoming is Lead Center ONLY (2026-08-15). It used to be every NEW/ROUTED
//    lead, which meant a CSV import asked you to accept or decline your own
//    typing. See isPlatformIncoming in the desktop leads-data.ts.
//
// DATA. This surface is NOT a fixture. The pipeline and the live Lead Center
// offers are read from the database through `leads-source.ts` (the desktop
// sheet's own org-scoped query) on mount, and every control writes through the
// shared lead server actions:
//   move stage      → updateLeadStatus        accept a routed lead → claimLead
//   decline         → updateLeadStatus(LOST)  assign to me         → claimLead
//   delete          → deleteLead              commit staged rows   → importLeads
//   accept an offer → acceptLeadOffer         pass an offer        → declineLeadOffer
// Writes are optimistic and rolled back on refusal — the actions are org-scoped
// and gate sales reps to their own slice, so a refusal is real and its message
// (written for the user) is shown rather than swallowed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./mobile-leads.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { useAnchoredMenu } from "@/components/v3/mobile-shell/use-anchored-menu";
import { useScrollFade } from "@/components/v3/mobile-shell/use-scroll-fade";
import { lockScroll } from "@/lib/scrollLock";
import { claimLead, deleteLead, importLeads, updateLeadStatus } from "@/actions/leads";
import { LeadProfileNudge } from "@/components/dashboard/LeadProfileNudge";
import { acceptLeadOffer, declineLeadOffer } from "@/actions/leadOffers";
import { buyLead, LeadPurchaseHost, priceLabel, PURCHASED_EVENT } from "@/components/leads/LeadPurchase";
// The classic import bench's CSV parser, shared with the desktop sheet rather
// than re-written: same quote handling, same header sniffing, same column
// guesses, so a file that stages five rows there stages the same five here.
import { parseCsvRows, ownLeads, isMetaImportedLead } from "@/components/v3/leads-blueprint/leads-data";
import { loadMobileLeads } from "./leads-source";
import { PICKABLE_SOURCES, leadSide, leadSourceKey, leadSourceOf, ownSourceCounts, sideCounts } from "@/lib/leads/sources";
import {
  LEAD_STATUSES,
  METHODS,
  PAGE_SIZE,
  STAGES,
  TABS,
  WORKING_STAGES,
  actionError,
  clock,
  initials,
  isInPlay,
  isIncoming,
  matchesQuery,
  parsePastedEmail,
  pct,
  srcLabel,
  statusLabel,
  type Lead,
  type MethodKey,
  type Offer,
  type StagedRow,
  type TabKey,
} from "./leads-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Status → badge tone. Kept beside the render so `styles.` stays literal. */
const STATUS_TONE: Record<string, string> = {
  NEW: styles.lstNew,
  ROUTED: styles.lstRouted,
  CLAIMED: styles.lstClaimed,
  CONTACTED: styles.lstContacted,
  QUOTED: styles.lstQuoted,
  WON: styles.lstWon,
  LOST: styles.lstLost,
  ARCHIVED: styles.lstArchived,
};

/** SmartBook's word for the lead (2026-10-31): the source tag's flat dot and plain text, as on the desk table. */
const SMART_DOT: Record<string, string> = { accent: "var(--accent)", amber: "var(--amber)", emerald: "var(--emerald)", muted: "var(--muted-light)" };
function SmartTag({ s }: { s: Lead["smart"] }) {
  if (!s) return null;
  return (
    <span className={styles.lsb}>
      <i style={{ "--t": SMART_DOT[s.tone] ?? SMART_DOT.muted } as React.CSSProperties} aria-hidden="true" />
      SmartBook · {s.label}
    </span>
  );
}

/** The trade tag's percentage doubles as a fill gauge, as on the desktop sheet. */
type GaugeStyle = React.CSSProperties & { "--p": string };
const gauge = (conf: number): GaugeStyle => ({ "--p": `${Math.round(conf * 100)}%` });

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
      el.textContent = String(value);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = String(Math.round(value * (1 - Math.pow(1 - pr, 3))));
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div ref={ref} className={className}>
      {value}
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

export function MobileLeads() {
  const router = useRouter();
  const metaOnly = useSearchParams().get("imported") === "meta";
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [allData, setData] = useState<Lead[]>([]);
  const [allOffers, setOffers] = useState<Offer[]>([]);
  const data = useMemo(() => metaOnly ? allData.filter(isMetaImportedLead) : allData, [allData, metaOnly]);
  const offers = useMemo(() => metaOnly ? [] : allOffers, [allOffers, metaOnly]);
  /** The signed-in user's display name — the row sheet's ownership copy. */
  const [me, setMe] = useState("You");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("all");
  const [status, setStatus] = useState<string>("ALL");
  /** Where the leads came from (2026-10-16): all, the ones JobFlex sent, the shop's own. */
  const [side, setSide] = useState<"" | "jobflex" | "own">("");
  /** One of the shop's own sources (a lib/leads/sources KEY), under "Your own". */
  const [srcKey, setSrcKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  /** The source menu under "Your own" (2026-10-18: the page's .dd, not a native select). */
  const [srcOpen, setSrcOpen] = useState(false);
  /** The filter row slides sideways when it does not fit; this fades the side that holds more. */
  const segFade = useScrollFade<HTMLDivElement>(side);

  const [sheetId, setSheetId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [method, setMethod] = useState<MethodKey>("manual");
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [landedId, setLandedId] = useState<string | null>(null);

  /* ---- add-leads form ---- */
  const [form, setForm] = useState({ name: "", email: "", phone: "", project: "", source: "" });
  const [nameErr, setNameErr] = useState(false);
  const [paste, setPaste] = useState("");
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [impErr, setImpErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* ---------- the failure surface ---------------------------------------
     Refusals that have no sheet of their own (a stage move the server said no
     to, an accept that lost its race) land in one fixed line. */
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  /* One write per record at a time: a second tap on a card whose first write is
     still in flight would race its own rollback. */
  const busyRef = useRef<Set<string>>(new Set());
  const claim = (id: string) => {
    if (busyRef.current.has(id)) return false;
    busyRef.current.add(id);
    return true;
  };
  const release = (id: string) => busyRef.current.delete(id);

  /* ---------- the read --------------------------------------------------
     The viewport switch mounts this component with NO props, so the rows are
     fetched here rather than handed down. Every write reloads after it lands
     (an import returns a count, an accepted offer materializes server-side —
     neither can be reconstructed on the client). */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Returns the snapshot as well as applying it: a direct add has to work out
  // WHICH row is the one it just created, and importLeads only answers with a
  // count.
  const reload = useCallback(async () => {
    try {
      const snap = await loadMobileLeads();
      if (!aliveRef.current) return null;
      setData(snap.leads);
      setOffers(snap.offers);
      setMe(snap.me);
      setLoadErr(null);
      return snap;
    } catch (err) {
      if (aliveRef.current) setLoadErr(actionError(err));
      return null;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  // The read is awaited inside the effect rather than called from its body:
  // nothing about it is synchronous, and it must not look like it is.
  useEffect(() => {
    (async () => {
      await reload();
    })();
  }, [reload]);

  /* ---------- a card leaves before the list re-flows --------------------
     The desktop fades an inbox card out over 220ms and mutates afterwards.
     The pending mutation rides a ref so the timer effect stays dependency-free. */
  const [outKey, setOutKey] = useState<string | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const fadeOut = (key: string, apply: () => void) => {
    if (prefersReducedMotion()) {
      apply();
      return;
    }
    pendingRef.current = apply;
    setOutKey(key);
  };
  useEffect(() => {
    if (!outKey) return;
    const t = window.setTimeout(() => {
      const fn = pendingRef.current;
      pendingRef.current = null;
      setOutKey(null);
      fn?.();
    }, 220);
    return () => clearTimeout(t);
  }, [outKey]);

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
     Runs once the first read has landed: the blocks it cascades do not exist
     while the page is still loading. */
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
      styles.btn, styles.ptab, styles.ddBtn, styles.ddItem, styles.pagerBtn,
      styles.lmenuItem, styles.sheetOpt, styles.sheetCancel, styles.lrowOpen,
      styles.lcard, styles.imethBtn, styles.icardBtn, styles.lemptyA,
      styles.srchX, styles.stagedGo, styles.stX, styles.dropzone,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes what the PAGE owns, topmost first --------------
     The drawer is NOT listed: MobileNav handles its own Escape and only binds
     while open, so the two listeners can never claim one key press. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (srcOpen) setSrcOpen(false);
      else if (delId !== null) setDelId(null);
      else if (moveId !== null) setMoveId(null);
      else if (addOpen) setAddOpen(false);
      else if (sheetId !== null) setSheetId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, srcOpen, delId, moveId, addOpen, sheetId]);

  /* ---------- Filter dropdown: placement + outside pointerdown -----------
     The menu is absolutely positioned, so it does not lengthen the scroller it
     overflows: with an EMPTY ledger under the bar the page has no scroll room
     and a downward menu is simply unreachable. The shared hook measures the
     room above and below the button and flips / caps accordingly. Its anchor is
     the same `.dd` node the outside-click test needs, so the hit test comes
     from the hook rather than a second ref on one element. */
  const filterMenu = useAnchoredMenu(filterOpen);
  const filterHit = filterMenu.contains;
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterHit(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen, filterHit]);
  // The source menu: the same placement hook and outside-tap closer.
  const srcMenu = useAnchoredMenu(srcOpen);
  const srcHit = srcMenu.contains;
  useEffect(() => {
    if (!srcOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!srcHit(e.target as Node)) setSrcOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [srcOpen, srcHit]);

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
    if (landedId === null) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => clearTimeout(t);
  }, [landedId]);

  /* ---------- Offer window: counted down, as in the original ------------ */
  useEffect(() => {
    const id = window.setInterval(() => {
      setOffers((prev) => prev.map((o) => (o.mins > 0 ? { ...o, mins: o.mins - 1 } : o)));
    }, 30000);
    return () => clearInterval(id);
  }, []);

  /* ---------- derived --------------------------------------------------
     `pool` is everything the SEARCH keeps, before the status filter. The
     dropdown's per-status counts are taken from it, so each cell answers "how
     many would I get if I picked this" under the search already in play — a
     count taken from the whole dataset would lie the moment anything is typed. */
  // The shop's own book — the platform hand-offs it has not answered yet live
  // in Incoming and are counted there, not here. Shared with the desk sheet
  // (leads-blueprint/leads-data → ownLeads), which is the whole point: the two
  // editions used to disagree about how many leads this shop had.
  const own = useMemo(() => ownLeads(data), [data]);
  // The search alone — what the origin switch and its source menu count from.
  const searched = useMemo(() => own.filter((l) => matchesQuery(l, query)), [own, query]);
  const sides = useMemo(() => sideCounts(searched), [searched]);
  const srcCounts = useMemo(() => ownSourceCounts(searched), [searched]);
  const srcNow = srcKey ? srcCounts.find((c) => c.key === srcKey) ?? null : null;
  const pool = useMemo(
    () =>
      searched.filter(
        (l) => (!side || leadSide(l.source) === side) && (!srcKey || leadSourceKey(l.source) === srcKey),
      ),
    [searched, side, srcKey],
  );
  const visible = useMemo(
    () => pool.filter((l) => status === "ALL" || l.status === status),
    [pool, status],
  );
  const statusCount = useCallback(
    (st: string) => (st === "ALL" ? pool.length : pool.filter((l) => l.status === st).length),
    [pool],
  );

  const inPlay = useMemo(() => own.filter(isInPlay), [own]);
  const inbox = useMemo(() => data.filter(isIncoming), [data]);
  const won = useMemo(() => own.filter((l) => l.status === "WON").length, [own]);
  const lost = useMemo(() => own.filter((l) => l.status === "LOST").length, [own]);
  const unassigned = useMemo(() => own.filter((l) => !l.assignee).length, [own]);
  const winRate = won + lost === 0 ? 0 : Math.round((won / (won + lost)) * 100);

  const counts: Record<TabKey, number> = {
    all: own.length,
    pipeline: inPlay.length,
    incoming: inbox.length + offers.length,
  };
  const tabIndex = TABS.findIndex((t) => t.key === tab);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const sheetLead = sheetId === null ? null : (data.find((l) => l.id === sheetId) ?? null);
  const moveLeadRec = moveId === null ? null : (data.find((l) => l.id === moveId) ?? null);
  const delLead = delId === null ? null : (data.find((l) => l.id === delId) ?? null);

  const clearFilters = () => {
    setStatus("ALL");
    setSide("");
    setSrcKey("");
    setQuery("");
    setPage(1);
  };

  /* ---------- mutations ------------------------------------------------
     Optimistic, then persisted. The lead actions are org-scoped and gate sales
     reps to their own slice, so a refusal is real: the record goes back to what
     it was and the action's own message is shown. */

  /** The card lands at the END of its new stage — exactly where the desktop
      drop-slot sat — so the section it joins reads chronologically. */
  const moveTo = async (id: string, st: string) => {
    setMoveId(null);
    const lead = data.find((l) => l.id === id);
    if (!lead || lead.status === st) return;
    if (!claim(id)) return;
    const from = lead.status;
    setData((prev) => {
      const rec = prev.find((l) => l.id === id);
      if (!rec) return prev;
      const rest = prev.filter((l) => l.id !== id);
      rest.push({ ...rec, status: st });
      return rest;
    });
    setLandedId(id);
    try {
      await updateLeadStatus(id, st);
    } catch (err) {
      setData((prev) => prev.map((l) => (l.id === id ? { ...l, status: from } : l)));
      setToast(actionError(err));
    } finally {
      release(id);
    }
  };

  const patchLead = (id: string, fn: (l: Lead) => Lead) =>
    setData((prev) => prev.map((l) => (l.id === id ? fn({ ...l }) : l)));

  /** Take the lead: claimLead stamps CLAIMED plus who took it and when, which
      is why it is not just updateLeadStatus(id, "CLAIMED"). */
  const takeLead = async (l: Lead) => {
    if (!claim(l.id)) return;
    const before = l;
    patchLead(l.id, (x) => ({ ...x, status: "CLAIMED", assignee: me, mine: true }));
    setLandedId(l.id);
    try {
      await claimLead(l.id);
    } catch (err) {
      patchLead(before.id, () => ({ ...before }));
      setToast(actionError(err));
    } finally {
      release(l.id);
    }
  };

  /** A priced offer is a purchase (components/leads/LeadPurchase): the card
      stays until the lead opens; the re-read then brings the paid lead in. */
  const buyOffer = async (o: Offer) => {
    if (!claim(o.id)) return;
    try {
      const out = await buyLead(o.id);
      if (out === "unlocked") {
        await reload();
        setTab("all");
      }
    } finally {
      release(o.id);
    }
  };

  // A lead paid for from the pop-up (or back from Stripe) — re-read the lists.
  useEffect(() => {
    const onPaid = () => void reload();
    window.addEventListener(PURCHASED_EVENT, onPaid);
    return () => window.removeEventListener(PURCHASED_EVENT, onPaid);
  }, [reload]);

  /** Accepting a platform offer materializes the org Lead server-side, so the
      new row can only come back from a re-read. */
  const acceptOffer = (o: Offer) =>
    fadeOut(`o:${o.id}`, () => {
      void (async () => {
        if (!claim(o.id)) return;
        setOffers((prev) => prev.filter((x) => x.id !== o.id));
        try {
          await acceptLeadOffer(o.id);
          await reload();
          setTab("all");
        } catch (err) {
          setOffers((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev]));
          setToast(actionError(err));
        } finally {
          release(o.id);
        }
      })();
    });

  /** Pass advances the platform cascade to the next shop. */
  const passOffer = (o: Offer) =>
    fadeOut(`o:${o.id}`, () => {
      void (async () => {
        if (!claim(o.id)) return;
        setOffers((prev) => prev.filter((x) => x.id !== o.id));
        try {
          await declineLeadOffer(o.id);
        } catch (err) {
          setOffers((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev]));
          setToast(actionError(err));
        } finally {
          release(o.id);
        }
      })();
    });

  /** Incoming triage: accept is a claim, decline is the LOST transition — the
      same pair the desktop Incoming tab runs. */
  const decideLead = (l: Lead, accept: boolean) =>
    fadeOut(`l:${l.id}`, () => {
      if (accept) {
        void takeLead(l);
        return;
      }
      void (async () => {
        if (!claim(l.id)) return;
        const from = l.status;
        patchLead(l.id, (x) => ({ ...x, status: "LOST" }));
        try {
          await updateLeadStatus(l.id, "LOST");
        } catch (err) {
          patchLead(l.id, (x) => ({ ...x, status: from }));
          setToast(actionError(err));
        } finally {
          release(l.id);
        }
      })();
    });

  /** deleteLead is manager-gated on the server, so a sales rep gets a real
      refusal — which keeps the record and says why. */
  const confirmDelete = async () => {
    const id = delId;
    if (id === null || deleting) return;
    const before = data;
    setDeleting(true);
    try {
      await deleteLead(id);
      setData((prev) => prev.filter((l) => l.id !== id));
      setDelId(null);
      setPage(1);
    } catch (err) {
      setData(before);
      setDelId(null);
      setToast(actionError(err));
    } finally {
      setDeleting(false);
    }
  };

  /* ---------- add leads ------------------------------------------------ */
  const openAdd = (m: MethodKey) => {
    setMethod(m);
    setNameErr(false);
    setImpErr(null);
    setFileErr(null);
    setAddOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    if (m === "manual") {
      window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
    }
  };

  /* ---------- ONE lead, in one step (by hand / paste) --------------------
     A staging tray is a DESK idea: you build a batch, look it over, then send
     it. On a phone you are adding the person standing in front of you, so
     "Add lead" writes the record and gets out of the way — no tray, no second
     confirmation, no half-finished state to come back to. Only the CSV tab
     keeps the tray, because a file genuinely IS a batch and its rows are worth
     reviewing before they land.

     There is no separate server action for this: importLeads takes an array, so
     one lead is an array of one — same quota check, same NEW status, same owner
     notification as every other row that reaches the pipeline. */
  const addOne = async (row: StagedRow): Promise<boolean> => {
    if (importing) return false;
    setImpErr(null);
    setImporting(true);
    const before = new Set(data.map((l) => l.id));
    try {
      await importLeads([
        {
          name: row.name,
          email: row.email,
          phone: row.phone,
          projectType: row.project,
          description: row.description,
          source: row.source,
        },
      ]);
      setAddOpen(false);
      setTab("all");
      clearFilters();
      // The confirmation is the record itself: the ledger is cleared of filters
      // and the new row — the one id that was not there a moment ago — takes the
      // page's single blue flash. importLeads returns a count, so this is the
      // only way to know which row is the new one.
      const snap = await reload();
      const fresh = snap?.leads.find((l) => !before.has(l.id));
      if (fresh) setLandedId(fresh.id);
      return true;
    } catch (err) {
      setImpErr(actionError(err));
      return false;
    } finally {
      setImporting(false);
    }
  };

  const addManual = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }
    void (async () => {
      const ok = await addOne({
        name,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        project: form.project.trim() || null,
        description: null,
        // Where it came from (2026-10-16): a call, a referral, Facebook, Angi…
        source: form.source || "MANUAL",
      });
      // The form is only cleared once the row is really in the pipeline — a
      // quota refusal must not also eat what was typed.
      if (ok) setForm({ name: "", email: "", phone: "", project: "", source: "" });
    })();
  };

  /** One paste is one enquiry: the parser reads the whole blob for a name, an
      email and a phone, and keeps the text as the lead's note. */
  const addPaste = () => {
    const row = parsePastedEmail(paste);
    if (!row) {
      pasteRef.current?.focus();
      return;
    }
    void (async () => {
      if (await addOne(row)) setPaste("");
    })();
  };

  /** The dropzone stages whatever is actually in the chosen file. Nothing here
      touches the database — the batch still has to be sent with the commit. */
  const readCsv = (file: File) => {
    setFileErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvRows(String(reader.result ?? ""));
      if (!rows.length) {
        setFileErr(`Couldn't find any rows in ${file.name}.`);
        return;
      }
      setStaged((prev) => [...prev, ...rows]);
    };
    reader.onerror = () => setFileErr("That file couldn't be read.");
    reader.readAsText(file);
  };

  /** The CSV tray's commit — the one place a BATCH is still sent. importLeads
      enforces the plan's lead quota across the whole batch and creates every row
      as NEW; it returns a count, not rows, so the pipeline is re-read after. */
  const commitStaged = async () => {
    if (!staged.length || importing) return;
    setImpErr(null);
    setImporting(true);
    try {
      await importLeads(
        staged.map((r) => ({
          name: r.name,
          email: r.email,
          phone: r.phone,
          projectType: r.project,
          description: r.description,
          source: r.source,
        })),
      );
      setStaged([]);
      setAddOpen(false);
      setTab("all");
      clearFilters();
      await reload();
    } catch (err) {
      setImpErr(actionError(err));
    } finally {
      setImporting(false);
    }
  };

  /* ---------- row sheet ------------------------------------------------ */
  const menuRows = useMemo<MenuRow[]>(() => {
    const l = sheetLead;
    if (!l) return [];
    return [
      { act: "open", icon: "i-user", tone: styles.lmiBp, title: "Open lead", sub: "Full record and history" },
      { act: "call", icon: "i-phone", tone: styles.lmiSky, title: "Call",
        sub: l.phone ?? "No phone on file", disabled: !l.phone },
      { act: "mail", icon: "i-mail", tone: styles.lmiOk, title: "Send email",
        sub: l.email ?? "No email on file", disabled: !l.email },
      { act: "move", icon: "i-board", tone: styles.lmiWarn, title: "Move stage",
        sub: `Now ${statusLabel(l.status).toLowerCase()} — pick a new one` },
      { act: "mine", icon: "i-userplus", title: l.mine ? "Already yours" : "Assign to me",
        sub: l.mine ? "You own this lead" : l.assignee ? `Owned by ${l.assignee}` : "Nobody owns it yet",
        disabled: l.mine },
      { act: "del", icon: "i-trash", tone: styles.lmiDanger, title: "Delete lead",
        sub: "Removes the record permanently", danger: true },
    ];
  }, [sheetLead]);

  const runMenu = (act: string) => {
    const l = sheetLead;
    setSheetId(null);
    if (!l) return;
    if (act === "open") router.push(`/dashboard/leads/${l.id}`);
    else if (act === "call" && l.phone) window.location.assign(`tel:${l.phone.replace(/[^\d+]/g, "")}`);
    else if (act === "mail" && l.email) window.location.assign(`mailto:${l.email}`);
    else if (act === "move") setMoveId(l.id);
    else if (act === "del") setDelId(l.id);
    else if (act === "mine") void takeLead(l);
  };

  const anyOverlay = sheetLead !== null || moveLeadRec !== null || delLead !== null || addOpen;

  // Swipe-down dismissal. Four sheets, four gestures, each pointed at the same
  // setter Escape and the scrim already call.
  const actionsDrag = useSheetDrag(sheetLead !== null, () => setSheetId(null));
  const moveDrag = useSheetDrag(moveLeadRec !== null, () => setMoveId(null));
  const delDrag = useSheetDrag(delLead !== null, () => setDelId(null));
  const addDrag = useSheetDrag(addOpen, () => setAddOpen(false));

  /* Only the manual pane is a real form, so only it can be reached with form=.
     By hand and Paste commit ONE lead on the spot; CSV opens the picker and its
     rows are sent from the tray's own button. */
  const footPrimary =
    method === "manual"
      ? { label: importing ? "Adding…" : "Add lead", type: "submit" as const, onClick: undefined }
      : method === "email"
        ? { label: importing ? "Adding…" : "Add lead", type: "button" as const, onClick: addPaste }
        : { label: "Choose CSV", type: "button" as const, onClick: () => fileRef.current?.click() };

  return (
    <div className={styles.app} onClick={onRootClick}>
      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, its own Escape and its own indicator, so the page holds none. */}
      <MobileNav />
      {/* Pays for priced offers — a sales rep's phone has no pop-up to host it. */}
      <LeadPurchaseHost />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD */}
          <div className={styles.pageHead}>
            <div className={styles.kicker}>{metaOnly ? "Meta imports" : "Pipeline"}</div>
            <h1 className={styles.pageTitle}>Leads</h1>
            <div className={styles.pageActions}>
              {metaOnly && <Link className={styles.btn} href="/dashboard/leads">Show all leads</Link>}
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button"
                onClick={() => openAdd("manual")}>
                <Icon id="i-plus" />New lead
              </button>
              {/* "Import" opens the CSV pane, not the paste pane: paste is now a
                  one-lead action and belongs behind New lead's own tab strip. */}
              <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
                onClick={() => openAdd("file")} data-tour="leads:import">
                <Icon id="i-file" />Import
              </button>
            </div>
          </div>

          {/* Why the Incoming tab is empty, when it is empty for a reason the
              shop can fix. Self-fetching, so it costs this page no wiring; it
              renders nothing for a shop that is already routable, and nothing
              for a week once dismissed. */}
          <LeadProfileNudge className={styles.leadGap} />

          {/* The read has to land before anything below can be true, so the
              masthead, the tabs and the ledger wait on it rather than flashing
              a pipeline of zeroes. */}
          {loading ? (
            <div className={styles.lempty}>
              <div className={styles.lemptyT}>Loading pipeline</div>
              <div className={styles.lemptyS}>Reading your leads and any offers reserved for your shop.</div>
            </div>
          ) : loadErr ? (
            <div className={styles.lempty}>
              <div className={styles.lemptyT}>Couldn&apos;t load the pipeline</div>
              <div className={styles.lemptyS}>{loadErr}</div>
              <button className={styles.lemptyA} type="button"
                onClick={() => { setLoading(true); void reload(); }}>
                <Icon id="i-rotate" />Try again
              </button>
            </div>
          ) : (
          <>
          {/* MASTHEAD — one numeral, mono kicker, EXACTLY two annotations.
              key on tab so the 320ms slide-in replays on a tab change. */}
          <div className={`${styles.lmast} ${styles.slide}`} key={tab}>
            <div className={styles.lmastTop}>
              <div className={styles.lmastLbl}>
                Leads in play
                <span className={styles.lmastRule} />
              </div>
              <CountUp value={inPlay.length} className={styles.lmastVal} />
            </div>
            <div className={styles.lmastCnt}>
              <div className={styles.lmastSub}>
                <div className={styles.lmastSubL}>Unassigned</div>
                <div className={styles.lmastSubV}>{unassigned}</div>
              </div>
              <div className={styles.lmastSub}>
                <div className={styles.lmastSubL}>Win rate</div>
                <div className={styles.lmastSubV}>{winRate}%</div>
              </div>
            </div>
          </div>

          {/* TABS */}
          <div className={styles.ptabs}>
            <span className={styles.ptabInd} style={{ transform: `translateX(${tabIndex * 100}%)` }} />
            {TABS.map((t) => (
              <button key={t.key} className={`${styles.ptab} ${tab === t.key ? styles.active : ""}`}
                type="button" aria-current={tab === t.key ? "page" : undefined}
                onClick={() => setTab(t.key)}>
                {t.label}
                <span className={styles.ptabCount}>{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {/* ============ TAB: ALL LEADS ============ */}
          {tab === "all" && (
            <div className={styles.find}>
              <label className={styles.srch}>
                <Icon id="i-search" />
                <input
                  className={styles.srchInput}
                  type="search"
                  value={query}
                  placeholder="Name, project, city, source…"
                  autoComplete="off"
                  aria-label="Search leads"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
                {query ? (
                  <button className={styles.srchX} type="button" aria-label="Clear search"
                    onClick={() => { setQuery(""); setPage(1); }}>
                    <Icon id="i-x" />
                  </button>
                ) : null}
              </label>

              <div className={`${styles.dd} ${filterOpen ? styles.open : ""}`} {...filterMenu.anchorProps}>
                <button className={styles.ddBtn} type="button" aria-haspopup="listbox"
                  aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>
                  <Icon id="i-filter" />
                  Filter
                  <span className={styles.ddValue} data-f={status}>
                    {statusLabel(status)} · {statusCount(status)}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
                </button>
                <div className={styles.ddMenu} role="listbox" {...filterMenu.menuProps}>
                  {LEAD_STATUSES.map((st) => (
                    <button key={st} className={`${styles.ddItem} ${status === st ? styles.active : ""}`}
                      type="button" role="option" aria-selected={status === st}
                      onClick={() => { setStatus(st); setPage(1); setFilterOpen(false); }}>
                      {statusLabel(st)}
                      <span className={styles.ddCount}>{statusCount(st)}</span>
                      {status === st ? <Icon id="i-check" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* WHERE THE LEADS CAME FROM (owner, 2026-10-16): All / JobFlex / Your
              own, and under "Your own" the source as a dropdown at the row's
              end. The Blueprint segmented control (owner, 2026-10-18): one
              square hair-framed plate, the page's plain type, grey counts, a
              flat dot per source, the row sliding sideways rather than
              clipping a word when it does not fit. */}
          {tab === "all" && own.length > 0 && (
            <div className={styles.fbar}>
              <div className={styles.fseg}>
                <div className={styles.fsegScroll} ref={segFade} role="group" aria-label="Where the leads came from">
                  {([
                    ["", "All", sides.all],
                    ["jobflex", "JobFlex", sides.jobflex],
                    ["own", "Your own", sides.own],
                  ] as const).map(([k, label, n]) => (
                    <button
                      key={k || "all"}
                      type="button"
                      className={`${styles.fsegBtn} ${side === k ? styles.on : ""}`}
                      aria-pressed={side === k}
                      data-side={k}
                      onClick={() => {
                        setSide(k);
                        if (k === "jobflex") setSrcKey("");
                        setPage(1);
                      }}
                    >
                      {label}
                      <span className={styles.fsegN}>{n}</span>
                    </button>
                  ))}
                </div>
              </div>
              {side === "own" && srcCounts.length > 1 ? (
                <div className={`${styles.fdrop} ${srcOpen ? styles.open : ""} ${srcNow ? styles.isSet : ""}`} {...srcMenu.anchorProps}>
                  <button className={styles.fdropBtn} type="button" aria-haspopup="listbox"
                    aria-expanded={srcOpen} aria-label={`Source: ${srcNow ? srcNow.label : "all sources"}`}
                    onClick={() => setSrcOpen((v) => !v)}>
                    {srcNow ? (
                      <><i className={styles.fdot} style={{ "--dot": srcNow.tone } as React.CSSProperties} aria-hidden="true" />{srcNow.short}</>
                    ) : (
                      <span className={styles.fdropKey}>Source</span>
                    )}
                    <Icon id="i-chev" className={`${styles.ic} ${styles.fdropCaret}`} />
                  </button>
                  <div className={styles.fmenu} role="listbox" aria-label="Your own leads by source" {...srcMenu.menuProps}>
                    {[{ key: "", label: "All sources", tone: "", count: sides.own }, ...srcCounts].map((c) => (
                      <button key={c.key || "every"} className={`${styles.fitem} ${srcKey === c.key ? styles.on : ""}`}
                        type="button" role="option" aria-selected={srcKey === c.key}
                        onClick={() => { setSrcKey(c.key); setPage(1); setSrcOpen(false); }}>
                        <i className={styles.fdot} style={c.tone ? ({ "--dot": c.tone } as React.CSSProperties) : undefined} aria-hidden="true" />
                        {c.label}
                        <span className={styles.fsegN}>{c.count}</span>
                        {srcKey === c.key ? <Icon id="i-check" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {tab === "all" && (
            visible.length === 0 ? (
              <div className={styles.lempty}>
                {data.length === 0 ? (
                  <>
                    <div className={styles.lemptyT}>No leads yet</div>
                    <div className={styles.lemptyS}>
                      Add one by hand, paste an enquiry email, or drop a CSV — they land here as new.
                    </div>
                    <button className={styles.lemptyA} type="button" onClick={() => openAdd("manual")}>
                      <Icon id="i-plus" />New lead
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.lemptyT}>No matches</div>
                    <div className={styles.lemptyS}>No lead matches that search and status.</div>
                    <button className={styles.lemptyA} type="button" onClick={clearFilters}>
                      <Icon id="i-x" />Clear filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className={styles.book}>
                {slice.map((l, i) => (
                  <div
                    key={l.id}
                    className={`${styles.lrow} ${styles.rowIn} ${landedId === l.id ? styles.landed : ""}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <span className={styles.lav}>{initials(l.name)}</span>
                    <div className={styles.lname}>{l.name}</div>
                    <button className={styles.lrowOpen} type="button"
                      aria-label={`Actions for ${l.name}`} onClick={() => setSheetId(l.id)}>
                      <Icon id="i-dots" />
                    </button>
                    <div className={styles.lwhere}>{l.project} · {l.city}</div>
                    {/* PARITY WITH THE DESKTOP TABLE. Its first column reads
                        "name / contact · source"; the card had the name and
                        dropped the other two, which took the only way to tell a
                        pasted enquiry from a platform lead off the handheld
                        ledger. Contact carries the left (it is what you act on),
                        source holds the right edge and never wraps. */}
                    <div className={styles.lcontact}>
                      <span
                        className={`${styles.lcontactV} ${l.email || l.phone ? "" : styles.isNone}`}
                      >
                        {/* ONE contact, email first — the desktop table's own
                            choice. Printing both put a half-truncated phone
                            after the email on a 390px card, and a half phone
                            number is worse than no phone number. Both are on
                            the row sheet, one tap away. */}
                        {l.email || l.phone || "No contact on file"}
                      </span>
                      {leadSide(l.source) === "jobflex" ? (
                        <span className={`${styles.lsrc} ${styles.lsrcJf}`}><i aria-hidden="true" />JobFlex</span>
                      ) : leadSourceOf(l.source).key === "facebook" ? (
                        <span className={`${styles.lsrc} ${styles.lsrcFb}`} style={{ "--t": leadSourceOf(l.source).tone } as React.CSSProperties} title="From your Facebook lead ads">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>Facebook
                        </span>
                      ) : (
                        <span className={styles.lsrc}>
                          <i style={{ "--t": leadSourceOf(l.source).tone } as React.CSSProperties} aria-hidden="true" />
                          {leadSourceOf(l.source).short}
                        </span>
                      )}
                    </div>
                    <div className={styles.lrowFoot}>
                      <span className={styles.lrowBadges}>
                        <span className={`${styles.pstatus} ${STATUS_TONE[l.status] ?? ""}`}>{l.status}</span>
                        <SmartTag s={l.smart} />
                        {l.spec ? (
                          <span className={styles.ltrade} style={gauge(l.conf)}>
                            {l.spec}<b className={styles.ltradePct}>{pct(l.conf)}</b>
                          </span>
                        ) : (
                          <span className={`${styles.ltrade} ${styles.isNone}`}>Unsorted</span>
                        )}
                      </span>
                      <span className={styles.lrowFigs}>
                        <span className={`${styles.lown} ${l.assignee ? "" : styles.isNone}`}>
                          {l.assignee ?? "—"}
                        </span>
                        <span className={styles.lage}>{l.age}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "all" && visible.length > PAGE_SIZE ? (
            <div className={styles.pager}>
              <button className={styles.pagerBtn} type="button" disabled={safePage <= 1}
                onClick={() => setPage(Math.max(1, safePage - 1))}>
                <Icon id="i-chevl" />Prev
              </button>
              <button className={styles.pagerBtn} type="button" disabled={safePage >= pages}
                onClick={() => setPage(Math.min(pages, safePage + 1))}>
                Next<Icon id="i-chevr" />
              </button>
              <span className={styles.pagerInfo}>{safePage} / {pages}</span>
            </div>
          ) : null}

          {/* ============ TAB: PIPELINE — the kanban as stage sections ============ */}
          {tab === "pipeline" && (
            <div className={styles.board}>
              {WORKING_STAGES.map((s) => {
                const items = data.filter((l) => l.status === s.key);
                return (
                  <div className={styles.stageSec} key={s.key}>
                    <div className={styles.stageHead}>
                      <span className={styles.stageDot} />
                      <span className={styles.stageLbl}>{s.label}</span>
                      <span className={styles.stageCount}>{items.length}</span>
                    </div>
                    <div className={styles.stageCards}>
                      {items.length === 0 ? (
                        <div className={styles.lcardEmpty}>No leads</div>
                      ) : (
                        items.map((l, i) => (
                          <button
                            key={l.id}
                            className={`${styles.lcard} ${styles.rowIn} ${landedId === l.id ? styles.landed : ""}`}
                            style={{ animationDelay: `${i * 45}ms` }}
                            type="button"
                            aria-label={`Move ${l.name} to another stage`}
                            onClick={() => setMoveId(l.id)}
                          >
                            <span className={styles.lcardName}>{l.name}</span>
                            <span className={styles.lcardJob}>{l.project} · {l.city}</span>
                            <span className={styles.lcardMeta}>
                              <span className={`${styles.lcardOwn} ${l.assignee ? "" : styles.isNone}`}>
                                {l.assignee ?? "Unassigned"}
                              </span>
                              <span className={styles.lcardAge}>{l.age}</span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
              <div className={styles.boardFoot}>
                <span className={styles.boardNote}>Tap a card to move it</span>
                <span className={styles.boardTally}>{won} won · {lost} lost</span>
              </div>
            </div>
          )}

          {/* ============ TAB: INCOMING ============ */}
          {tab === "incoming" && (
            offers.length + inbox.length === 0 ? (
              <div className={styles.lempty}>
                <div className={styles.lemptyT}>You&apos;re all caught up</div>
                <div className={styles.lemptyS}>
                  Leads the lead center routes to your shop land here to accept or decline. Leads
                  you add yourself go straight to the pipeline.
                </div>
                <button className={styles.lemptyA} type="button" onClick={() => openAdd("manual")}>
                  <Icon id="i-plus" />New lead
                </button>
              </div>
            ) : (
              <div className={styles.istack}>
                {offers.map((o, i) => (
                  <div key={o.id}
                    className={`${styles.icard} ${styles.rowIn} ${outKey === `o:${o.id}` ? styles.out : ""}`}
                    style={{ animationDelay: `${i * 60}ms` }}>
                    {/* The platform window: one line, the countdown holds the right edge */}
                    <div className={styles.icardStrip}>
                      <Icon id="i-send" />
                      <span className={styles.icardStripLbl}>Platform lead — reserved for your shop</span>
                      <span className={`${styles.icardTimer} ${o.mins < 240 ? styles.warn : ""}`}>
                        {clock(o.mins)}
                      </span>
                    </div>
                    <div className={styles.icardBody}>
                      <div className={styles.icardTop}>
                        <span className={styles.lav}>{initials(o.name)}</span>
                        <div className={styles.icardId}>
                          <div className={styles.icardName}>{o.name}</div>
                          <div className={styles.icardMeta}>{o.age} · Lead center · {o.city}</div>
                        </div>
                        <span className={`${styles.pstatus} ${styles.lstNew}`}>Offer</span>
                      </div>
                      <div className={styles.icardProj}>
                        {o.project}
                        <span className={styles.ltrade} style={gauge(o.conf)}>
                          {o.spec}<b className={styles.ltradePct}>{pct(o.conf)}</b>
                        </span>
                      </div>
                      <div className={styles.icardDesc}>{o.desc}</div>
                      <div className={styles.icardContact}>
                        {o.priceCents ? `${priceLabel(o.priceCents)} to unlock contact` : "Contact details open when you accept"}
                      </div>
                      <div className={styles.icardAct}>
                        <button className={`${styles.icardBtn} ${styles.icardBtnGo}`} type="button"
                          onClick={() => (o.priceCents ? void buyOffer(o) : acceptOffer(o))}>
                          <Icon id="i-check" />{o.priceCents ? `Accept · ${priceLabel(o.priceCents)}` : "Accept lead"}
                        </button>
                        <button className={styles.icardBtn} type="button" onClick={() => passOffer(o)}>
                          Pass
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {inbox.map((l, i) => (
                  <div key={l.id}
                    className={`${styles.icard} ${styles.rowIn} ${outKey === `l:${l.id}` ? styles.out : ""}`}
                    style={{ animationDelay: `${(offers.length + i) * 60}ms` }}>
                    <div className={styles.icardBody}>
                      <div className={styles.icardTop}>
                        <span className={styles.lav}>{initials(l.name)}</span>
                        <div className={styles.icardId}>
                          <div className={styles.icardName}>{l.name}</div>
                          <div className={styles.icardMeta}>
                            {l.age} · {srcLabel(l.source)} · {l.city}
                          </div>
                          <SmartTag s={l.smart} />
                        </div>
                        <span className={`${styles.pstatus} ${STATUS_TONE[l.status] ?? ""}`}>{l.status}</span>
                      </div>
                      <div className={styles.icardProj}>
                        {l.project}
                        {l.spec ? (
                          <span className={styles.ltrade} style={gauge(l.conf)}>
                            {l.spec}<b className={styles.ltradePct}>{pct(l.conf)}</b>
                          </span>
                        ) : (
                          <span className={`${styles.ltrade} ${styles.isNone}`}>Unsorted</span>
                        )}
                      </div>
                      {l.desc ? <div className={styles.icardDesc}>{l.desc}</div> : null}
                      <div className={styles.icardContact}>
                        {[l.email, l.phone].filter(Boolean).join(" · ")}
                      </div>
                      <div className={styles.icardAct}>
                        <button className={`${styles.icardBtn} ${styles.icardBtnGo}`} type="button"
                          onClick={() => decideLead(l, true)}>
                          <Icon id="i-check" />Accept
                        </button>
                        <button className={styles.icardBtn} type="button"
                          onClick={() => decideLead(l, false)}>
                          Decline
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
          </>
          )}
        </div>
      </main>

      {/* No floating action button: both primary actions live in the page head. */}

      {/* ============ SHEET SCRIM (shared by all four sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => { setSheetId(null); setMoveId(null); setDelId(null); setAddOpen(false); }}
        aria-hidden="true"
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div className={`${styles.sheet} ${sheetLead ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Lead actions" aria-hidden={!sheetLead} {...actionsDrag.sheetProps}>
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetLead
              ? `${statusLabel(sheetLead.status)} · ${srcLabel(sheetLead.source)} · ${sheetLead.age}`
              : "Lead · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetLead?.name ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {menuRows.map((r) => (
            <button key={r.act} type="button" disabled={r.disabled}
              className={`${styles.lmenuItem} ${r.danger ? styles.lmenuItemDanger : ""}`}
              onClick={() => runMenu(r.act)}>
              <span className={`${styles.lmiIc} ${r.tone ?? ""}`}><Icon id={r.icon} /></span>
              <span>
                <span className={styles.lmenuItemT}>{r.title}</span>
                <span className={styles.lmenuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetId(null)}>Cancel</button>
      </div>

      {/* ============ STAGE PICKER (the board's drag & drop) ============ */}
      <div className={`${styles.sheet} ${moveLeadRec ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Move lead to stage" aria-hidden={!moveLeadRec} {...moveDrag.sheetProps}>
        <div className={styles.sheetGrab} {...moveDrag.handleProps} />
        <div className={styles.sheetHead} {...moveDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {moveLeadRec ? `${moveLeadRec.project} · ${moveLeadRec.city}` : "Lead · —"}
          </div>
          <div className={styles.sheetTitle}>Move to stage</div>
        </div>
        <div className={styles.sheetBody}>
          {STAGES.map((s, i) => {
            const current = moveLeadRec?.status === s.key;
            return (
              <button key={s.key} className={`${styles.sheetOpt} ${current ? styles.current : ""}`}
                type="button" disabled={current || !moveLeadRec}
                onClick={() => moveLeadRec && void moveTo(moveLeadRec.id, s.key)}>
                <span className={styles.sheetOptN}>{String(i + 1).padStart(2, "0")}</span>
                {s.label}
                {current ? <Icon id="i-check" /> : null}
              </button>
            );
          })}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setMoveId(null)}>Cancel</button>
      </div>

      {/* ============ DELETE CONFIRMATION (the desktop dialog) ============ */}
      <div className={`${styles.sheet} ${delLead ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="mlDelTitle" aria-hidden={!delLead} {...delDrag.sheetProps}>
        <div className={styles.sheetGrab} {...delDrag.handleProps} />
        <div className={styles.sheetHead} {...delDrag.handleProps}>
          <div className={styles.sheetKicker}>Pipeline / remove record</div>
          <div className={styles.sheetTitle} id="mlDelTitle">Delete lead?</div>
        </div>
        <div className={`${styles.sheetBody} ${styles.confirmBody}`}>
          <p className={styles.confirmTxt}>
            Remove {delLead?.name ?? "this lead"} from the pipeline? This can&apos;t be undone.
          </p>
        </div>
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => setDelId(null)}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnDanger}`} type="button"
            disabled={deleting} onClick={() => void confirmDelete()}>
            <Icon id="i-trash" />{deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {/* ============ ADD LEADS (the desktop Import panel) ============ */}
      <div className={`${styles.sheet} ${addOpen ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="mlAddTitle" aria-hidden={!addOpen} {...addDrag.sheetProps}>
        <div className={styles.sheetGrab} {...addDrag.handleProps} />
        <div className={styles.sheetHead} {...addDrag.handleProps}>
          <div className={styles.sheetKicker}>Pipeline / new records</div>
          <div className={styles.sheetTitle} id="mlAddTitle">Add leads</div>
        </div>

        {/* The desktop method switch, as a segmented control */}
        <div className={styles.imeth}>
          {METHODS.map((m) => (
            <button key={m.key} className={`${styles.imethBtn} ${method === m.key ? styles.active : ""}`}
              type="button" aria-pressed={method === m.key}
              onClick={() => { setMethod(m.key); setImpErr(null); setFileErr(null); }}>
              <Icon id={m.icon} />{m.label}
            </button>
          ))}
        </div>

        <div className={styles.sheetBody}>
          {/* importLeads refuses when the write would blow the plan's lead
              quota. One error line for all three methods — the refusal is the
              same refusal whether it came from one lead or forty. */}
          {impErr ? <span className={styles.fldErr} role="alert">{impErr}</span> : null}

          {method === "manual" ? (
            <form className={styles.formBody} id="mlManual" noValidate onSubmit={addManual}>
              <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
                <label className={styles.fldLbl} htmlFor="mlName">
                  Name<span className={styles.req}>*</span>
                </label>
                <input ref={nameRef} className={styles.pinput} id="mlName" name="name" type="text"
                  placeholder="J. Whitfield" autoComplete="off" value={form.name}
                  aria-invalid={nameErr} aria-describedby={nameErr ? "mlNameErr" : undefined}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: e.target.value }));
                    if (e.target.value.trim()) setNameErr(false);
                  }} />
                {nameErr ? <span className={styles.fldErr} id="mlNameErr">Enter a name for the lead</span> : null}
              </div>

              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mlEmail">Email</label>
                <input className={styles.pinput} id="mlEmail" name="email" type="email"
                  placeholder="name@mail.com" autoComplete="off" value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>

              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mlPhone">Phone</label>
                <input className={styles.pinput} id="mlPhone" name="phone" type="tel"
                  placeholder="(425) 555-0112" autoComplete="off" value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>

              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mlProject">Project type</label>
                <input className={styles.pinput} id="mlProject" name="project" type="text"
                  placeholder="Metal roof repair" autoComplete="off" value={form.project}
                  onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))} />
                <span className={styles.fldHint}>
                  Leave it blank and the lead lands as a general enquiry, ready to sort on the board.
                </span>
              </div>

              {/* Where it came from — so "Your own" can say which source pays. */}
              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mlSource">Where it came from</label>
                <select className={styles.pinput} id="mlSource" name="source" value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
                  <option value="">Added by hand</option>
                  {PICKABLE_SOURCES.map((src) => (
                    <option key={src.key} value={src.stored}>{src.label}</option>
                  ))}
                </select>
              </div>
            </form>
          ) : null}

          {method === "email" ? (
            <div className={styles.formBody}>
              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mlPaste">Paste the email</label>
                <textarea ref={pasteRef} className={styles.parea} id="mlPaste" value={paste}
                  placeholder={"Paste the full email here — we'll pull out the name, email and phone we can find."}
                  onChange={(e) => setPaste(e.target.value)} />
                <span className={styles.fldHint}>
                  One enquiry, one lead. The email text is kept on the record as its note.
                </span>
              </div>
            </div>
          ) : null}

          {method === "file" ? (
            <div className={styles.formBody}>
              <button className={styles.dropzone} type="button" onClick={() => fileRef.current?.click()}>
                <Icon id="i-file" />
                <span className={styles.dropzoneTxt}>Tap to choose a CSV</span>
              </button>
              {/* The real picker behind the drawn dropzone — it stages whatever
                  is in the file, not a demo batch. */}
              <input
                ref={fileRef}
                className={styles.fileInput}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readCsv(file);
                  // Let the same file be chosen twice in a row.
                  e.target.value = "";
                }}
              />
              {fileErr ? <span className={styles.fldErr} role="alert">{fileErr}</span> : null}
            </div>
          ) : null}

          {/* The CSV tray — the only staged flow left. A file IS a batch, and
              its rows are worth reading before they land; a lead typed or
              pasted on a phone is not, so those two commit on the spot. */}
          {method === "file" && staged.length ? (
            <div className={styles.staged}>
              <div className={styles.stagedHead}>
                <span className={styles.stagedTitle}>Ready to add</span>
                <button className={styles.stagedGo} type="button" disabled={importing}
                  onClick={() => void commitStaged()}>
                  <Icon id="i-check" />
                  {importing
                    ? "Adding…"
                    : `Add ${staged.length} ${staged.length === 1 ? "lead" : "leads"}`}
                </button>
              </div>
              {staged.map((r, i) => (
                <div className={styles.stRow} key={`${r.name}-${i}`}>
                  <div>
                    <div className={styles.stName}>{r.name}</div>
                    <div className={styles.stMeta}>
                      {[r.email, r.phone, r.project].filter(Boolean).join(" · ") || srcLabel(r.source)}
                    </div>
                  </div>
                  <button className={styles.stX} type="button" aria-label={`Remove ${r.name}`}
                    onClick={() => setStaged((prev) => prev.filter((_, n) => n !== i))}>
                    <Icon id="i-x" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* The submit pair sits in a beige foot OUTSIDE the scrolling body and
            reaches the manual form with the form= attribute. */}
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => setAddOpen(false)}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type={footPrimary.type}
            disabled={importing}
            form={method === "manual" ? "mlManual" : undefined} onClick={footPrimary.onClick}>
            <Icon id="i-plus" />{footPrimary.label}
          </button>
        </div>
      </div>

      {/* ============ THE FAILURE LINE ============
          A write the server refused, where there is no sheet to hold the
          message: a stage move outside a sales rep's slice, an offer that
          expired between the render and the tap. */}
      <div className={`${styles.mlToast} ${toast ? "" : styles.mlToastHidden}`}
        role="alert" aria-live="assertive">
        <span className={styles.mlToastTxt}>{toast}</span>
        <button className={styles.mlToastX} type="button" aria-label="Dismiss"
          onClick={() => setToast(null)}>
          <Icon id="i-x" />
        </button>
      </div>
    </div>
  );
}
