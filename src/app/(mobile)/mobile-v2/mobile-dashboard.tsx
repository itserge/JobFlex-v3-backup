"use client";

// MOBILE DASHBOARD (mobile-v2) — Blueprint design system, handheld build.
//
// Ported from the scratchpad donor jobflex-dashboard-mobile-blueprint.html,
// which is itself assembled from the canonical reference dashboard
// (.claude/skills/jobflex-page-styler/assets/jobflex-dashboard-blueprint.html).
// Tokens, palette, type scale, status tones and the Motion System "Balanced"
// are the reference's; the composition is re-cut for a phone.
//
// What changes versus the desktop sheet, and why:
//  · Sidebar → a burger drawer carrying the full nav, plus a 3-item bottom
//    bar (New Proposal · Settings · Account). The floating FAB it replaced
//    was removed at the owner's call, 2026-07-29: the action now lives in
//    the bar, so nothing hovers over the content.
//  · KPI row of 4 → a masthead hero numeral + a 3-up strip, so one number
//    owns the screen instead of four competing for it. The four figures are
//    the desktop's four, unchanged.
//  · The week strip shows FIVE day cells, not seven: at 320px seven cells fall
//    under the 44px touch minimum. The window slides so it always contains
//    today; the full week's count is in the card's sub line, and any day
//    outside the window is one tap away on the Calendar.
//  · Schedule and jobs move ABOVE revenue: on a phone the question is
//    "what's next", and the money question is already answered by the hero.
//  · Chart plot box re-cut for a 320px screen; hover → pointer scrub.
//  · Kanban drag & drop → tap a lead, pick a stage in a bottom sheet.
//    HTML5 drag has no touch equivalent, so the interaction is rebuilt
//    rather than desktop-gated. The drop PERSISTS through `updateLeadStatus`,
//    the same action the desktop board and the classic kanban use, and rolls
//    back with the server's own message when a write is refused.
//
// DATA. This surface was a demo fixture until 2026-08-13 — invented clients,
// invented amounts, an invented week. It now renders `DashboardData`: the same
// org-scoped read the desktop Overview runs, reached two ways because the
// surface has two mounts.
//   · /mobile-v2 — the server page awaits it and passes `data`.
//   · /dashboard at ≤768px — `ResponsiveDashboardShell` mounts this component
//     props-less and client-only, so it fetches the identical rows itself
//     through the `getDashboardData` action.
// There is no local seed left to fall back to.

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./mobile-v2.module.css";
import {
  useNavBadges,
  useNavIdentity,
  useNavLimits,
  useNavLimitsExempt,
  quotaPill,
  useNavHidden,
  useNavLocked,
  useNavRole,
  type NavLimit, useNavView } from "@/components/v3/blueprint-shell/nav-role";
import { canOpen } from "@/components/v3/blueprint-shell/nav-map";
import { ACTIVE_ENGINE_HREFS } from "@/components/v3/estimators-blueprint/estimators-data";
import { EstimatorPicker } from "@/components/v3/estimators-blueprint/estimator-picker";
import {
  LEAD_STAGES,
  navSectionsFor,
  activeHref,
  PLOT,
  RANGES,
  WEEK_CELLS,
  Y_ROWS,
  type RangeKey,
  type StageKey,
} from "./mobile-data";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { getDashboardData } from "@/app/dashboard/dashboard-actions";
import { updateLeadStatus } from "@/actions/leads";
import {
  leadProfileMissing,
  leadProfileNameOnly,
  leadProfileHref,
  type BoardLead,
  type DashboardData,
} from "@/components/v3/dashboard-blueprint/blueprint-data";
import { NotificationBell } from "@/components/v3/blueprint-shell/notification-bell";
import { Who } from "@/components/v3/who/who";
import { TourChip } from "@/components/v3/onboarding-tour/tour-chip";
import { SmartHelpRow } from "@/components/v3/smarthelp/smarthelp-row";
import { TourShowMe } from "@/components/v3/onboarding-tour/tour-show-me";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The list-height measurement must land before paint or the card renders at
// full height and snaps. Resolved once at module load, so this is not a
// conditional hook call — it just keeps useLayoutEffect off the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** The classic CompleteLeadProfileBanner snoozed the Lead Center nudge for a
 *  week in localStorage, deliberately not in the schema. Same key and window as
 *  the desktop blueprint, so a dismissal on either edition is honoured by both. */
const SNOOZE_KEY = "jf.leadProfileNag";
const SNOOZE_DAYS = 7;

/** Destinations this surface links to. Literals so `typedRoutes` checks them. */
const R = {
  calendar: "/dashboard/calendar",
  jobs: "/dashboard/jobs",
  leads: "/dashboard/leads",
  company: "/dashboard/company",
  // The blueprint builder, not the classic editor: /dashboard/proposals/new is
  // the old design, and the handheld route map sends this one through the
  // mobile manual builder (responsive-dashboard-shell).
  newProposal: "/dashboard/manual-blueprint",
  // The hub, not the classic /dashboard/settings/preferences page: the gear
  // on this surface was the last handheld link still landing on the old design.
  settings: "/dashboard/settings",
  account: "/dashboard/settings/account",
  login: "/auth/login",
} satisfies Record<string, Route>;

const usd = (n: number) => n.toLocaleString("en-US");

/** `updateLeadStatus` rejects with a message written for the user ("You can
 *  only update your own leads"). Surface that text; fall back to a generic line
 *  for a transport failure, which carries nothing useful. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** A phone cannot carry "$132,400" in a third of the KPI strip. Compact it —
 *  but only once the figure is big enough that the rounding is invisible. */
function compactMoney(n: number): { value: number; prefix: string; suffix: string; decimals: number } {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return { value: n / 1_000_000, prefix: "$", suffix: "M", decimals: 1 };
  if (abs >= 10_000) return { value: n / 1_000, prefix: "$", suffix: "K", decimals: 0 };
  return { value: n, prefix: "$", suffix: "", decimals: 0 };
}

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/* ============================================================
   COUNT-UP — 750ms easeOutCubic. tabular-nums keep the digit
   columns from jumping while the number climbs.
   ============================================================ */
function CountUp({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fmt = useCallback(
    (n: number) =>
      n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    [decimals],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = prefix + fmt(value) + suffix;
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      const e = 1 - Math.pow(1 - pr, 3);
      el.textContent = prefix + fmt(value * e) + suffix;
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, prefix, suffix, fmt]);

  return (
    <div ref={ref} className={className}>
      {prefix + fmt(value) + suffix}
    </div>
  );
}

/* ============================================================
   LIST LIMIT — ≤4 rows plain; 5+ internal scroll sized to the
   real bottom of the 4th row; >10 rows expose the inline
   "Go to …" button as the last element inside the scroll.
   ============================================================ */
function useListLimit(ref: React.RefObject<HTMLDivElement | null>, count: number, visible: number, deps: unknown[]) {
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      el.classList.toggle(styles.hasMore, count > 10);
      if (count > visible) {
        el.classList.add(styles.scrollable);
        let h = 0;
        for (let i = 0; i < Math.min(visible, el.children.length); i++) {
          h += (el.children[i] as HTMLElement).offsetHeight;
        }
        if (h) el.style.height = `${Math.round(h + 2)}px`;
      } else {
        el.classList.remove(styles.scrollable);
        el.style.height = "";
      }
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [count, visible, ...deps]);
}

/* ============================================================
   ENTRY — resolves the org's rows, then draws the sheet.
   Split in two so every hook below runs against real data and
   none of them is conditional.
   ============================================================ */
/** The quota pill's copy — the desk sidebar's tooltip, as the title here. */
function quotaTip(q: NavLimit): string {
  const cycle = q.scope === "absolute" ? "" : " this cycle";
  if (q.remaining <= 0) {
    return `You've used all ${q.limit} ${q.label} in your plan${cycle}. Upgrade to add more.`;
  }
  return `${q.remaining} of ${q.limit} ${q.label} left${cycle}.`;
}

/** `sample`: the Overview drawn as a picture with made-up rows behind the phone sign-up
 *  (components/v3/auth-register-mobile) — no session, so the bell is drawn still (its feed is a signed-in
 *  action) and the estimator picker is not mounted. */
export function MobileDashboard({ data: seed, notice, sample = false }: { data?: DashboardData; notice?: React.ReactNode; sample?: boolean }) {
  const [data, setData] = useState<DashboardData | null>(seed ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (seed) return;
    let alive = true;
    getDashboardData({ showTour: new URLSearchParams(window.location.search).get("tour") === "show" })
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setData(res.data);
          return;
        }
        // Not a fault: a signed-in login with no company, or a session that has
        // lapsed. Both used to arrive here as a 500 from the action.
        setLoadError(
          res.reason === "no-org"
            ? "This account isn't a member of any company yet, so there's nothing to show. Sign in with the address you registered, or ask for a new invite."
            : res.reason === "no-access"
              ? "The Overview isn't part of your role — your own pages are in the menu."
              : "Your session has expired. Sign in again to continue.",
        );
      })
      .catch((err) => {
        if (alive) setLoadError(actionError(err));
      });
    return () => {
      alive = false;
    };
  }, [seed]);

  if (data) return <DashboardView data={data} notice={notice} sample={sample} />;
  return <BootScreen error={loadError} />;
}

/** Paper hold while the rows land, and an honest failure if they do not. The
 *  shell's own `MobileHold` paints the same cream behind the chunk fetch, so
 *  the two read as one uninterrupted load. */
function BootScreen({ error }: { error: string | null }) {
  return (
    <div className={styles.app}>
      <Sprite />
      {error ? (
        /* bootMain, not scroll alone: `.app` is a three-row grid whose first row
           is the topbar, and this screen renders no topbar — so the card landed
           in the 56px topbar row and was clipped to a sliver. It is pinned to
           the middle row instead. */
        <main className={`${styles.scroll} ${styles.bootMain}`}>
          <div className={styles.content}>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitles}>
                  <div className={styles.cardTitle}>Overview unavailable</div>
                  <div className={styles.cardSub}>{error}</div>
                </div>
              </div>
              <Link className={styles.cardFootBtn} href={R.login}>
                Sign in
                <Icon id="i-arrow" />
              </Link>
            </div>
          </div>
        </main>
      ) : null}
    </div>
  );
}

function DashboardView({ data, notice, sample }: { data: DashboardData; notice?: React.ReactNode; sample: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /* ---------- WEEK WINDOW --------------------------------------------
     Five cells out of the server's seven, always containing today. Sunday
     is reachable early in the week, Saturday late — the days a contractor
     is most likely to be looking at from the day they are standing on. */
  const weekWindow = useMemo(() => {
    const days = data.week.days;
    if (days.length <= WEEK_CELLS) return days;
    const t = days.findIndex((d) => d.today);
    const max = days.length - WEEK_CELLS;
    const start = t < 0 ? 0 : Math.max(0, Math.min(t - 2, max));
    return days.slice(start, start + WEEK_CELLS);
  }, [data.week.days]);

  const defaultIso = weekWindow.some((d) => d.iso === data.week.todayIso)
    ? data.week.todayIso
    : (weekWindow[0]?.iso ?? "");
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const selectedIso = pickedIso ?? defaultIso;

  const [range, setRange] = useState<RangeKey>("7d");
  const [leads, setLeads] = useState<BoardLead[]>(() => data.leads.map((l) => ({ ...l })));
  const [navOpen, setNavOpen] = useState(false);
  /* The lit nav item is DERIVED from the URL, not held in state. It used to be
     a label string the drawer set on click, which is why clicking a link only
     moved the highlight and never changed the page. */
  const activeNav = activeHref(usePathname() ?? "");
  const [banner, setBanner] = useState<"open" | "closing" | "hidden">("open");
  const [sheetLead, setSheetLead] = useState<BoardLead | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [railIdx, setRailIdx] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  /* ---------- viewport height ----------------------------------------
     Mandatory rule: viewport heights only via var(--app-h). A phone's URL
     bar changes innerHeight mid-scroll, so the real value is republished
     rather than trusting a bare 100vh/100dvh. */
  useEffect(() => {
    const setH = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${h}px`);
    };
    setH();
    window.addEventListener("resize", setH);
    window.visualViewport?.addEventListener("resize", setH);
    const releaseScroll = lockScroll();
    return () => {
      window.removeEventListener("resize", setH);
      window.visualViewport?.removeEventListener("resize", setH);
      document.documentElement.style.removeProperty("--app-h");
      releaseScroll();
    };
  }, []);

  /* ---------- Motion: reveal on load + adaptive reveal on scroll ------ */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    let velLastY = host.scrollTop;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    const onScroll = () => {
      const now = performance.now();
      scrollVel = Math.abs(host.scrollTop - velLastY) / Math.max(1, now - velLastT);
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
    const cells = Array.from(content.querySelectorAll<HTMLElement>(`.${styles.kpi}`));
    cells.forEach((el, i) => {
      el.classList.add(styles.rvCell);
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${160 + (i % 8) * 45}ms` : "200ms";
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          if (t.dataset.rvScroll) {
            // Below the fold: duration follows the current scroll speed —
            // slow scroll ≈ 900ms, fast never shorter than 550ms.
            t.style.transitionDuration = `${Math.round(Math.max(550, 900 - scrollVel * 160))}ms`;
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
    [...blocks, ...cells].forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      host.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ---------- Motion: graph-paper parallax ---------------------------- */
  useEffect(() => {
    const host = scrollRef.current;
    if (!host || prefersReducedMotion()) return;
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

  /* ---------- NAV DRAWER ---------------------------------------------
     The sliding active-item indicator is measured, not guessed. */
  const navScrollRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ind = indicatorRef.current;
    if (!ind) return;
    if (!navOpen) {
      ind.classList.remove(styles.ready);
      return;
    }
    const nav = navScrollRef.current;
    if (!nav) return;
    const raf = requestAnimationFrame(() => {
      const link = nav.querySelector<HTMLElement>(`.${styles.sbLink}.${styles.active}`);
      if (!link) return;
      ind.style.top = `${link.offsetTop}px`;
      ind.style.height = `${link.offsetHeight}px`;
      requestAnimationFrame(() => ind.classList.add(styles.ready));
    });
    return () => cancelAnimationFrame(raf);
  }, [navOpen, activeNav]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  /* ---------- Motion: press stamp (delegated, so it also covers rows
     rendered later, e.g. the sheet options) --------------------------- */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const target = e.target as HTMLElement;
    const pressSel = `.${styles.segBtn}, .${styles.tbarBtn}, .${styles.cardFootBtn}, .${styles.sheetOpt}, .${styles.sheetCancel}, .${styles.emptyAct}, .${styles.sbFootIc}, .${styles.sbFootAcc}, .${styles.bnavBtn}`;
    const el = target.closest<HTMLElement>(pressSel);
    const cls = el ? styles.pressed : styles.dayPressed;
    const node = el ?? target.closest<HTMLElement>(`.${styles.day}`);
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    node.addEventListener("animationend", () => node.classList.remove(cls), { once: true });
  }, []);

  /* ---------- TOAST — the only channel a refused board move has ------- */
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ---------- Lead Center banner -------------------------------------
     Rendered only when the org genuinely cannot receive platform leads, and
     the snooze is read before paint so a dismissed banner never flashes. */
  const bannerRef = useRef<HTMLDivElement>(null);
  useIsoLayoutEffect(() => {
    try {
      if (Date.now() < Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0)) setBanner("hidden");
    } catch {
      /* private mode: show it */
    }
  }, []);

  const dismissBanner = () => {
    const b = bannerRef.current;
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    } catch {
      /* still collapse for this visit */
    }
    if (!b || banner !== "open") return;
    if (prefersReducedMotion()) return setBanner("hidden");
    b.style.height = `${b.offsetHeight}px`;
    b.style.transitionDelay = "0ms";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setBanner("closing");
        b.style.height = "0px";
      }),
    );
    const done = (e: TransitionEvent) => {
      if (e.propertyName !== "height") return;
      setBanner("hidden");
      b.removeEventListener("transitionend", done);
    };
    b.addEventListener("transitionend", done);
  };

  const gap = data.leadProfile;
  const missingPiece = gap ? leadProfileMissing(gap) : "";

  /* ---------- THIS WEEK ---------------------------------------------- */
  const dayEvents = useMemo(
    () => (data.week.events[selectedIso] ?? []).slice().sort((a, b) => a.m - b.m),
    [data.week.events, selectedIso],
  );
  const weekListRef = useRef<HTMLDivElement>(null);
  useListLimit(weekListRef, dayEvents.length, 4, [selectedIso]);
  /** Open the calendar ON the picked day with the new-event composer already
   *  up. A bare /dashboard/calendar dropped the selection, so the day the user
   *  had just tapped had to be found again on the other side. */
  const scheduleHref = `${R.calendar}?date=${selectedIso}&new=1` as Route;

  /* ---------- UPCOMING JOBS ------------------------------------------
     Server order is `startsAt` ascending — nearest first is already true.
     The date plate arrives as "JUL 28"; the phone stacks the two halves. */
  const jobs = useMemo(
    () =>
      data.jobs.map((j) => {
        const [mo = "", dd = ""] = j.date.split(" ");
        return { ...j, mo, dd };
      }),
    [data.jobs],
  );
  const jobsListRef = useRef<HTMLDivElement>(null);
  useListLimit(jobsListRef, jobs.length, 4, []);

  /* ---------- RECENT ACTIVITY (server already caps at 10) ------------- */
  const actListRef = useRef<HTMLDivElement>(null);
  useListLimit(actListRef, data.activities.length, 5, []);

  /* ---------- CHART --------------------------------------------------- */
  const ds = data.chart[range];
  const pts = useMemo(() => {
    const n = ds.values.length;
    if (!n) return [];
    const span = PLOT.x1 - PLOT.x0;
    const hgt = PLOT.y1 - PLOT.y0;
    return ds.values.map((v, i) => ({
      x: n === 1 ? (PLOT.x0 + PLOT.x1) / 2 : PLOT.x0 + i * (span / (n - 1)),
      y: PLOT.y1 - (ds.yMax > 0 ? (v / ds.yMax) * hgt : 0),
      v,
      d: ds.labels[i] ?? "",
    }));
  }, [ds]);

  // A 320px screen cannot carry 10–13 x-labels legibly: thin to ~5.
  const labelStep = Math.max(1, Math.ceil(pts.length / 5));
  const peak = useMemo(
    () => (pts.length ? pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0]) : null),
    [pts],
  );
  const peakLabel = useMemo(() => {
    if (!peak) return "";
    let k = (Math.round(peak.v / 100) / 10).toString();
    if (k.slice(-2) === ".0") k = k.slice(0, -2);
    return `$${k}K`;
  }, [peak]);

  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const activeDot = scrubIdx ?? pts.length - 1;

  const lineRef = useRef<SVGPolylineElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const noteRef = useRef<SVGTextElement>(null);
  const dotsRef = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipTextRef = useRef<SVGTextElement>(null);
  const tipBoxRef = useRef<SVGRectElement>(null);
  const [tipW, setTipW] = useState(90);

  // Drawing (Balanced): the line draws itself, points appear along the way,
  // the fill and the peak annotation land after. Replays on range change.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const line = lineRef.current;
    const area = areaRef.current;
    const note = noteRef.current;
    const dots = dotsRef.current ? (Array.from(dotsRef.current.children) as SVGRectElement[]) : [];
    if (!line || !area) return;
    const len = line.getTotalLength();
    line.style.strokeDasharray = String(len);
    line.style.strokeDashoffset = String(len);
    line.style.transition = "none";
    area.style.opacity = "0";
    if (note) note.style.opacity = "0";
    dots.forEach((d) => (d.style.opacity = "0"));
    const timers: number[] = [];
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        line.style.transition = "stroke-dashoffset 850ms cubic-bezier(0.4, 0, 0.2, 1)";
        line.style.strokeDashoffset = "0";
        dots.forEach((d, i) => {
          timers.push(
            window.setTimeout(
              () => {
                d.style.transition = "opacity 180ms ease";
                d.style.opacity = "1";
              },
              Math.round(850 * (i / Math.max(1, dots.length - 1))),
            ),
          );
        });
        timers.push(
          window.setTimeout(() => {
            area.style.opacity = "1";
            if (note) note.style.opacity = "1";
          }, 950),
        );
      }),
    );
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [range]);

  // Tooltip box follows the text width (mono, so it changes with the value)
  useEffect(() => {
    if (scrubIdx === null || !tipTextRef.current) return;
    setTipW(tipTextRef.current.getBBox().width + 18);
  }, [scrubIdx, range]);

  const hideTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );
  const pickPoint = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || !pts.length) return;
      const r = svg.getBoundingClientRect();
      const sx = ((clientX - r.left) / r.width) * 340;
      let best = 0;
      let bd = Infinity;
      pts.forEach((p, i) => {
        const dd = Math.abs(p.x - sx);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      setScrubIdx(best);
    },
    [pts],
  );

  // Pointer events cover mouse, pen and touch on one path. touch-action is
  // pan-y, so a vertical swipe still scrolls the page past the chart.
  const onScrubDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    pickPoint(e.clientX);
  };
  const onScrubMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.pointerType === "mouse" || e.currentTarget.hasPointerCapture(e.pointerId)) pickPoint(e.clientX);
  };
  const onScrubRelease = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (e.pointerType === "mouse") return;
    // Touch: leave the readout up long enough to actually be read.
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setScrubIdx(null), 2200);
  };

  const tipX = scrubIdx !== null ? Math.min(Math.max(pts[scrubIdx].x - tipW / 2, PLOT.x0 + 2), PLOT.x1 - tipW) : 0;
  const tipY =
    scrubIdx !== null ? (pts[scrubIdx].y - 40 < 14 ? pts[scrubIdx].y + 16 : pts[scrubIdx].y - 40) : 0;

  /* ---------- LEAD FLOW ----------------------------------------------- */
  const railRef = useRef<HTMLDivElement>(null);
  const onRailScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    const col = rail.firstElementChild as HTMLElement | null;
    const w = col?.offsetWidth || 1;
    setRailIdx(Math.max(0, Math.min(LEAD_STAGES.length - 1, Math.round(rail.scrollLeft / w))));
  };

  /** Cards with a stage write still in flight; a second tap would race its own
   *  rollback. */
  const busyLeads = useRef<Set<string>>(new Set());
  const landTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (landTimer.current) clearTimeout(landTimer.current);
    },
    [],
  );

  /** Lands at the END of the target column — exactly where the desktop
   *  drop-slot preview sits. */
  const placeLead = useCallback((lead: BoardLead, stage: string) => {
    setLeads((prev) => {
      const next = prev.filter((l) => l.id !== lead.id);
      next.push({ ...lead, stage });
      return next;
    });
  }, []);

  /**
   * OPTIMISTIC, then PERSISTED with `updateLeadStatus` — the same action the
   * desktop board uses. The server is org-scoped and gates sales reps to their
   * own slice, so a refusal is real and has to be honoured: the card goes back
   * to the column it came from and the action's own message is shown.
   */
  const moveLead = async (to: StageKey) => {
    const lead = sheetLead;
    setSheetLead(null);
    if (!lead || lead.stage === to) return;
    if (busyLeads.current.has(lead.id)) return;
    const from = lead.stage;
    busyLeads.current.add(lead.id);

    placeLead(lead, to);
    setLandedId(lead.id);
    if (landTimer.current) clearTimeout(landTimer.current);
    landTimer.current = window.setTimeout(() => setLandedId(null), 500);

    const rail = railRef.current;
    const idx = LEAD_STAGES.findIndex((s) => s.key === to);
    if (rail && idx >= 0) {
      const col = rail.children[idx] as HTMLElement | undefined;
      if (col) rail.scrollTo({ left: col.offsetLeft, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }

    try {
      await updateLeadStatus(lead.id, to.toUpperCase());
    } catch (err) {
      placeLead(lead, from);
      showToast(actionError(err));
    } finally {
      busyLeads.current.delete(lead.id);
    }
  };

  // Esc closes the sheet
  useEffect(() => {
    if (!sheetLead) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetLead(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetLead]);

  // Swipe-down dismissal, on the same close path as Escape and the scrim.
  const sheetDrag = useSheetDrag(Boolean(sheetLead), () => setSheetLead(null));

  const rowDelay = (i: number) => ({ animationDelay: `${i * 45}ms` });
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";
  const avatar = (data.viewer.name.trim().charAt(0) || "A").toUpperCase();
  // This surface owns a THIRD copy of the drawer (the desktop sidebar and
  // components/v3/mobile-shell/mobile-nav are the other two), so it takes the
  // same role filter rather than drawing the map whole. The RAW role comes from
  // the provider the blueprint layout mounts — `data.viewer.role` beside it is
  // already humanised for display and cannot be matched against "INSTALLER".
  const navRole = useNavRole();
  // Custom-plan page locks, same provider; empty on every other plan.
  const navLocked = useNavLocked();
  /* Unread counts and remaining plan quota per href — the desk sidebar's
     badge + pill, in this drawer since 2026-09-04 (owner: the phone showed
     neither). Both come from the same provider the shell mounts. */
  const navBadges = useNavBadges();
  const navLimits = useNavLimits();
  // A platform admin in their own organization: no pills, one line in the foot.
  const navLimitsExempt = useNavLimitsExempt();
  // Early-access pages this account may not see (lib/earlyAccess).
  const navHidden = useNavHidden();
  const navView = useNavView();
  const navSections = navSectionsFor(navRole, navLocked, navHidden, navView);
  /* The composer this page's Help button opens is mounted by the responsive
     shell, which only wraps the authenticated route. On the standalone
     /mobile-v2 review URL there is no provider and no session, so the button
     would dispatch at nothing — it is not drawn there. */
  // Every engine the picker offers sits outside a field worker's allow-list, so
  // the button is only drawn for roles that can open one (same test the other
  // bars use).
  const estimatorRole = useNavIdentity().role;
  const canEstimate = ACTIVE_ENGINE_HREFS.some((href) => canOpen(estimatorRole, href, navLocked));
  const heroRevenue = data.kpiRaw.revenue;
  const pipeline = compactMoney(data.kpiRaw.pipeline);

  return (
    <div className={styles.app} ref={rootRef} onClick={onRootClick}>
      <Sprite />

      {/* ============ TOPBAR ============
          The search and bell buttons that used to sit on the right were
          decoration: neither had a handler, and `.bellDot` was a static dot no
          code ever toggled, so it advertised unread notifications permanently.
          There is no handheld search or notification surface to open — the
          desktop pair open the command palette, which lives in the blueprint
          shell this build replaces — so they are gone rather than lying. The
          drawer carries every destination they implied. */}
      <header className={styles.tbar}>
        <button
          className={styles.tbarBtn}
          type="button"
          aria-label="Open navigation"
          data-tour="nav-menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <Icon id="i-menu" />
        </button>
        <span className={styles.tbarMarkBox}>
          <Image
            className={styles.tbarMarkImg}
            src="/jobflex-mark.png"
            alt=""
            width={108}
            height={108}
            priority
          />
        </span>
        <span className={styles.tbarTxt}>
          <span className={styles.tbarName}>JOBFLEX</span>
          <span className={styles.tbarSub}>Contractor OS</span>
        </span>
        {/* This bar carried a burger and a wordmark and nothing else, so the
            one surface an owner opens first on a phone had no notification
            surface at all — while the handheld shell used by every OTHER
            route (mobile-shell/mobile-nav) did have a bell, and that one had
            no handler. Same component both places now. `.bellDot` already
            exists in this module; it was written for the bell that was never
            built here. */}
        {/* Help moved OUT of this bar on 2026-08-27 (owner's call): the
            support launcher is the floating plate in the bottom-right corner
            again, mounted by the widget itself. New Estimate takes the slot it
            left — the same control the other handheld bar carries, opening the
            same picker dialog. */}
        {/* The right group. The search button that used to fill this bar left
            with the Help move, and nothing after the wordmark pushed toward
            the far edge any more: signed in, the plus and the bell sat ~70px
            short of the right padding line while the burger sat 15px from
            the left. `.tbarRight` (margin-left: auto) is the same wrapper the
            shared mobile-nav bar uses; `.tbarBell`'s own auto margin only
            covered the signed-out, no-plus case. */}
        <div className={styles.tbarRight}>
          {canEstimate && (
            <button
              className={styles.tbarBtn}
              type="button"
              aria-label="New estimate"
              onClick={() => document.dispatchEvent(new CustomEvent("jf:estimator-picker"))}
            >
              <Icon id="i-plus" />
            </button>
          )}
          {sample ? (
            <span className={styles.tbarBtn} aria-hidden="true">
              <Icon id="i-bell" />
            </span>
          ) : (
            <NotificationBell buttonClassName={styles.tbarBtn} iconClassName={styles.ic} />
          )}
        </div>
      </header>

      {/* The dialog the bar's New Estimate button opens. Every other handheld
          surface gets it from <MobileNav />; this page draws its own bar, so it
          mounts its own copy. */}
      {sample ? null : <EstimatorPicker />}

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {notice}
          {/* LEAD CENTER BANNER — only for an org that cannot receive platform
              leads yet, and only until it is snoozed for a week. */}
          {gap && banner !== "hidden" ? (
            <div
              ref={bannerRef}
              className={[styles.banner, banner === "closing" ? styles.bannerClosing : ""]
                .filter(Boolean)
                .join(" ")}
              data-lead-banner={leadProfileNameOnly(gap) ? undefined : ""}
            >
              <Icon id="i-pin" className={`${styles.ic} ${styles.bannerPin}`} />
              <div className={styles.bannerBody}>
                <div className={styles.bannerKicker}>{leadProfileNameOnly(gap) ? "Company" : "Lead Center"}</div>
                <div className={styles.bannerTxt}>
                  {leadProfileNameOnly(gap)
                    ? "Your company has no name yet — clients see your own name on proposals, emails and texts."
                    : <>Homeowner leads near you aren&apos;t reaching your shop yet — add {missingPiece} to
                  start receiving them.</>}
                </div>
                {/* Its own line, not a word inside the sentence: at 44px tall a
                    control inflates the line box it sits in and the paragraph
                    stops reading as a paragraph. */}
                <Link className={styles.bannerLink} href={leadProfileHref(gap) as Route}>
                  Complete your profile
                  <Icon id="i-arrow" />
                </Link>
              </div>
              <button
                className={styles.bannerClose}
                type="button"
                aria-label="Dismiss for a week"
                onClick={dismissBanner}
              >
                <Icon id="i-x" />
              </button>
            </div>
          ) : null}

          {/* FIRST RUN (landing-e pass A, 2026-09-11) — a variant-e shop with
              no estimate yet: one card, one 44px button by trade. The server
              stops sending it after the first proposal / estimate / measurement. */}
          {data.firstRun ? (
            <div className={styles.firstRun} id="firstRun" data-trade={data.firstRun.trade}>
              <div className={styles.firstRunKicker}>First estimate</div>
              <div className={styles.firstRunTitle}>Make your first estimate</div>
              <div className={styles.firstRunTxt}>
                {data.firstRun.trade === "roofing"
                  ? "Type an address and the roof is measured from the aerial — squares, pitch, a priced proposal in about two minutes."
                  : data.firstRun.trade === "fencing"
                    ? "Draw the fence line on the map — footage, posts, gates and a priced proposal in about two minutes."
                    : data.firstRun.trade === "hvac"
                      ? "Type an address — the house, the load, the unit that fits and a priced proposal in about two minutes."
                    : "Type the job the way you'd say it to a customer — the estimate writes itself in about two minutes."}
              </div>
              <Link className={styles.firstRunBtn} href={data.firstRun.href as Route} data-cta="first-run">
                {data.firstRun.label}
                <Icon id="i-arrow" />
              </Link>
              {/* The first-estimate tour, step by step (components/v3/onboarding-tour). */}
              <TourShowMe className={styles.firstRunHow} />
            </div>
          ) : null}

          {/* PAGE HEAD */}
          <div className={styles.pageHead}>
            <div className={styles.kicker}>{data.greeting}</div>
            <h1 className={styles.pageTitle}>Overview</h1>
          </div>

          {/* MASTHEAD — the one number that owns the screen.
              The "Collected / Outstanding" pair that used to sit under it was
              removed: neither figure had a source anywhere in the schema, they
              were two literals in the markup. The four KPIs shown here are the
              desktop sheet's four, so both editions describe one business. */}
          <div className={styles.masthead}>
            <div className={styles.mastMain}>
              <div className={styles.mastKicker}>Revenue · 30D</div>
              <CountUp value={heroRevenue} prefix="$" className={styles.mastVal} />
            </div>
          </div>

          {/* KPI STRIP */}
          <div className={styles.kpiGrid}>
            <div className={styles.kpi}>
              <div className={styles.kpiLbl}>Pipeline</div>
              <CountUp
                value={pipeline.value}
                prefix={pipeline.prefix}
                suffix={pipeline.suffix}
                decimals={pipeline.decimals}
                className={styles.kpiVal}
              />
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLbl}>Open Prop.</div>
              <CountUp value={data.kpiRaw.openProposals} className={`${styles.kpiVal} ${styles.accent}`} />
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLbl}>Leads · 7D</div>
              <CountUp value={data.kpiRaw.newLeads} className={styles.kpiVal} />
            </div>
          </div>

          {/* RECENT ACTIVITY */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitles}>
                <div className={styles.cardTitle}>Recent Activity</div>
              </div>
            </div>
            <hr className={styles.cardRule} />
            <div className={styles.list} ref={actListRef}>
              {data.activities.length ? (
                data.activities.map((a, i) => (
                  <div key={`${a.t}-${i}`} className={`${styles.actRow} ${styles.rowIn}`} style={rowDelay(i)}>
                    <div className={styles.actIc}>
                      <Icon id={a.i} />
                    </div>
                    <div className={styles.actBody}>
                      <div className={styles.actTitle}>{a.t}</div>
                      <div className={styles.actFoot}>
                        {/* The author only when it is someone else — not the
                            reader, not the system (owner, 2026-09-26). */}
                        {a.mine || !a.who ? null : <Who who={a.who} compact />}
                        <div className={styles.actMeta}>{a.m}</div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={`${styles.empty} ${styles.rowIn}`}>
                  <div className={styles.emptyTxt}>No activity yet.</div>
                </div>
              )}
            </div>
          </div>

          {/* THIS WEEK */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitles}>
                <div className={styles.cardTitle}>This Week</div>
                <div className={styles.cardSub}>
                  {data.week.range} · <b>{data.week.scheduled} scheduled</b>
                </div>
              </div>
            </div>
            <div className={styles.weekStrip}>
              {weekWindow.map((d) => (
                <div
                  key={d.iso}
                  className={[
                    styles.day,
                    d.today ? styles.today : "",
                    d.iso === selectedIso ? styles.selected : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-day={d.iso}
                  role="button"
                  tabIndex={0}
                  aria-pressed={d.iso === selectedIso}
                  onClick={() => setPickedIso(d.iso)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPickedIso(d.iso);
                    }
                  }}
                >
                  <div className={styles.dayLbl}>{d.lbl}</div>
                  <div className={styles.dayNum}>{d.num}</div>
                  <div className={`${styles.dayDot} ${d.has ? "" : styles.off}`} />
                </div>
              ))}
            </div>
            <div className={`${styles.list} ${styles.weekList}`} ref={weekListRef}>
              {dayEvents.length ? (
                dayEvents.map((e, i) => (
                  <div
                    key={`${selectedIso}-${e.m}-${e.title}`}
                    className={`${styles.schedRow} ${styles.rowIn}`}
                    style={rowDelay(i)}
                  >
                    <span className={styles.tag}>{e.t}</span>
                    <span className={styles.schedTitle}>{e.title}</span>
                  </div>
                ))
              ) : (
                /* No action inside the note: the card footer below carries
                   "Schedule a job" on every state now, and two of them a
                   centimetre apart read as two different actions. */
                <div key={`empty-${selectedIso}`} className={`${styles.empty} ${styles.rowIn}`}>
                  <div className={styles.emptyTxt}>Nothing scheduled for this day.</div>
                </div>
              )}
            </div>
            {/* The card's own footer, outside the list. "Schedule a job" used to
                exist only in the empty state — the moment a day had one event
                the way to add a second one vanished — and it dropped the picked
                day on the way to the calendar. */}
            <div className={styles.weekFoot}>
              <Link className={`${styles.cardFootBtn} ${styles.cardFootBtnNew}`} href={scheduleHref}>
                <Icon id="i-plus" />
                Schedule a job
              </Link>
              <Link className={styles.cardFootBtn} href={R.calendar}>
                Go to Calendar
                <Icon id="i-arrow" />
              </Link>
            </div>
          </div>

          {/* UPCOMING JOBS */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitles}>
                <div className={styles.cardTitle}>Upcoming Jobs</div>
                <div className={styles.cardSub}>Next installs on the calendar</div>
              </div>
            </div>
            <hr className={styles.cardRule} />
            <div className={styles.list} ref={jobsListRef}>
              {jobs.length ? (
                jobs.map((j, i) => (
                  <div key={j.id} className={`${styles.jobRow} ${styles.rowIn}`} style={rowDelay(i)}>
                    <span className={`${styles.jobDate} ${j.today ? styles.today : ""}`}>
                      {j.mo}
                      <b>{j.dd}</b>
                    </span>
                    <div className={styles.jobInfo}>
                      <div className={styles.jobTitle}>{j.title}</div>
                      <div className={styles.jobFoot}>
                        <span className={styles.jobSub}>{j.sub}</span>
                        <span className={`${styles.chip} ${j.st === "ok" ? styles.ok : styles.wait}`}>
                          {j.st === "ok" ? "Confirmed" : "Pending"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={`${styles.empty} ${styles.rowIn}`}>
                  <div className={styles.emptyTxt}>Your calendar is clear.</div>
                  <Link className={styles.emptyAct} href={`${R.calendar}?new=1` as Route}>
                    <Icon id="i-plus" />
                    Schedule a job
                  </Link>
                </div>
              )}
              <Link className={styles.cardFootBtn} href={R.jobs}>
                Go to Jobs
                <Icon id="i-arrow" />
              </Link>
            </div>
          </div>

          {/* REVENUE TREND */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitles}>
                <div className={styles.cardTitle}>Revenue Trend</div>
              </div>
            </div>
            <div className={styles.seg} role="tablist" aria-label="Chart range">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  className={`${styles.segBtn} ${range === r.key ? styles.active : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={range === r.key}
                  onClick={() => {
                    setScrubIdx(null);
                    setRange(r.key);
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className={styles.chartWrap}>
              <svg
                ref={svgRef}
                viewBox="0 0 340 212"
                role="img"
                aria-label={`Revenue trend, last ${rangeLabel}`}
              >
                <defs>
                  <pattern id="mvMinor" x={PLOT.x0} y={PLOT.y0} width="20.71" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20.71 0 L 0 0 0 20" className={styles.chMinor} fill="none" />
                  </pattern>
                </defs>
                <rect x={PLOT.x0} y={PLOT.y0} width={PLOT.x1 - PLOT.x0} height={PLOT.y1 - PLOT.y0} fill="url(#mvMinor)" />
                {/* Horizontal majors only — verticals read as noise */}
                {Y_ROWS.slice(0, 4).map((y) => (
                  <line key={y} x1={PLOT.x0} y1={y} x2={PLOT.x1} y2={y} className={styles.chMajor} />
                ))}
                <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={PLOT.y1} className={styles.chAxis} />
                <line x1={PLOT.x0} y1={PLOT.y1} x2={PLOT.x1} y2={PLOT.y1} className={styles.chAxis} />
                {/* The server's ticks carry a "$" the desktop gutter has room
                    for and this one does not — 32px at 320px. */}
                {Y_ROWS.map((y, i) => (
                  <text key={y} x={32} y={y + 4} textAnchor="end" className={styles.chLbl}>
                    {(ds.ticks[i] ?? "").replace("$", "")}
                  </text>
                ))}
                {pts.map((p, i) =>
                  i % labelStep === 0 || i === pts.length - 1 ? (
                    <text key={`x-${i}`} x={p.x} y={192} textAnchor="middle" className={styles.chLbl}>
                      {p.d}
                    </text>
                  ) : null,
                )}
                <path
                  ref={areaRef}
                  className={styles.chArea}
                  d={`M${PLOT.x0},${PLOT.y1} ${pts.map((p) => `L${p.x},${p.y}`).join(" ")} L${PLOT.x1},${PLOT.y1} Z`}
                />
                <polyline ref={lineRef} className={styles.chLine} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                {/* Data points are SQUARES, never circles */}
                <g ref={dotsRef}>
                  {pts.map((p, i) => (
                    <rect
                      key={`dot-${i}`}
                      x={p.x - 4.5}
                      y={p.y - 4.5}
                      width={9}
                      height={9}
                      className={`${styles.chDot} ${i === activeDot ? styles.on : ""}`}
                    />
                  ))}
                </g>
                {/* Peak is COMPUTED from the dataset max, and hides while scrubbing */}
                {peak ? (
                  <text
                    ref={noteRef}
                    // Clamp by the label's own width (15px mono ≈ 9px/char) so a
                    // first-day peak never hangs over the y-axis labels.
                    x={Math.min(
                      Math.max(peak.x, PLOT.x0 + peakLabel.length * 4.5 + 4),
                      PLOT.x1 - peakLabel.length * 4.5 - 4,
                    )}
                    y={Math.max(peak.y - 14, 22)}
                    textAnchor="middle"
                    className={styles.chNote}
                    style={{ opacity: scrubIdx === null ? 1 : 0 }}
                  >
                    {peakLabel}
                  </text>
                ) : null}
                <line
                  x1={0}
                  y1={PLOT.y0}
                  x2={0}
                  y2={PLOT.y1}
                  className={styles.chGuide}
                  style={{
                    opacity: scrubIdx === null ? 0 : 0.55,
                    transform: scrubIdx === null ? undefined : `translateX(${pts[scrubIdx].x}px)`,
                  }}
                />
                <g
                  className={styles.chTipg}
                  style={{
                    opacity: scrubIdx === null ? 0 : 1,
                    transform: scrubIdx === null ? undefined : `translate(${tipX}px, ${tipY}px)`,
                  }}
                >
                  <rect ref={tipBoxRef} rx={2} height={26} x={0} y={0} width={tipW} className={styles.chTipBox} />
                  <text ref={tipTextRef} x={9} y={18} className={styles.chTipText}>
                    {scrubIdx === null ? "" : `${pts[scrubIdx].d} · $${usd(pts[scrubIdx].v)}`}
                  </text>
                </g>
                <rect
                  x={PLOT.x0}
                  y={4}
                  width={PLOT.x1 - PLOT.x0}
                  height={PLOT.y1 + 4}
                  fill="transparent"
                  className={styles.chOverlay}
                  onPointerDown={onScrubDown}
                  onPointerMove={onScrubMove}
                  onPointerUp={onScrubRelease}
                  onPointerCancel={onScrubRelease}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setScrubIdx(null);
                  }}
                />
              </svg>
            </div>
          </div>

          {/* LEAD FLOW */}
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Lead Flow</h2>
            <Link className={styles.cardLink} href={R.leads}>
              <span>Open leads</span>
              <Icon id="i-arrow" />
            </Link>
          </div>

          <div className={styles.railWrap}>
            <div className={styles.stageRail} ref={railRef} onScroll={onRailScroll}>
              {LEAD_STAGES.map((s) => {
                const items = leads.filter((l) => l.stage === s.key);
                return (
                  <div key={s.key} className={styles.stageCol} data-stage={s.key}>
                    <div className={styles.stageColHead}>
                      <span className={styles.stageDot} />
                      <span className={styles.stageLbl}>{s.label}</span>
                      <span className={styles.stageCount}>{items.length}</span>
                    </div>
                    <div className={styles.stageCards}>
                      {items.length ? (
                        items.map((l) => (
                          <button
                            key={l.id}
                            className={`${styles.leadCard} ${landedId === l.id ? styles.landed : ""}`}
                            type="button"
                            onClick={() => setSheetLead(l)}
                            aria-label={`Move ${l.name} to another stage`}
                          >
                            <span className={styles.leadName}>{l.name}</span>
                            <span className={styles.leadJob}>
                              {l.job} · {l.city}
                            </span>
                            <span className={styles.leadMeta}>
                              {/* The donor printed an invented dollar value here.
                                  A Lead carries no amount; it carries an owner,
                                  which is what the desktop board shows too. */}
                              <span className={`${styles.leadVal} ${l.owner ? "" : styles.none}`}>
                                {l.owner || "Unassigned"}
                              </span>
                              <span className={styles.leadAge}>{l.age}</span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className={styles.leadEmpty}>No leads</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.railMeta}>
              <span className={styles.railTicks}>
                {LEAD_STAGES.map((s, i) => (
                  <i key={s.key} className={`${styles.railTick} ${i === railIdx ? styles.on : ""}`} />
                ))}
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* ============ BOTTOM NAV ============
          A grid row of .app, so it never overlaps the scroller. Three cells:
          the primary action, then the two account-level destinations. All
          three were bare <button>s with no handler until 2026-08-13 — the
          press animation was the only thing that ever responded. */}
      <nav className={styles.bottomNav} aria-label="Primary actions">
        <Link className={`${styles.bnavBtn} ${styles.primary}`} href={R.newProposal}>
          <span className={styles.bnavPlate}>
            <Icon id="i-fileplus" />
          </span>
          <span className={styles.bnavLbl}>New Proposal</span>
        </Link>
        <Link className={styles.bnavBtn} href={R.settings}>
          <span className={styles.bnavPlate}>
            <Icon id="i-gear" />
          </span>
          <span className={styles.bnavLbl}>Settings</span>
        </Link>
        <Link className={styles.bnavBtn} href={R.account}>
          <span className={styles.bnavPlate}>
            <Icon id="i-user" />
          </span>
          <span className={styles.bnavLbl}>Account</span>
        </Link>
      </nav>

      {/* ============ NAV DRAWER (the reference sidebar) ============ */}
      <div
        className={`${styles.sbOverlay} ${navOpen ? styles.on : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <aside className={`${styles.sb} ${navOpen ? styles.open : ""}`} aria-label="Main navigation" aria-hidden={!navOpen}>
        <div className={styles.sbHead}>
          <span className={styles.sbMarkBox}>
            <Image className={styles.sbMarkImg} src="/jobflex-mark.png" alt="" width={108} height={108} />
          </span>
          <div className={styles.sbHeadTxt}>
            <div className={styles.sbHeadName}>JOBFLEX</div>
            <div className={styles.sbHeadSub}>Contractor OS</div>
          </div>
          <button
            className={styles.sbClose}
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <Icon id="i-x" />
          </button>
        </div>

        {/* The first-estimate tour, paused or under way (components/v3/onboarding-tour) — at the head of
            the drawer, where the trial ribbon's dock never covers it. */}
        <TourChip onPick={() => setNavOpen(false)} />
        {/* SmartHelp (components/v3/smarthelp): the drawer closes, then the sheet comes up. */}
        <SmartHelpRow variant="drawer" onBeforeOpen={() => setNavOpen(false)} />
        <nav className={styles.sbScroll} ref={navScrollRef}>
          <div className={styles.sbIndicator} ref={indicatorRef} />
          {navSections.map((sec) => (
            <div key={sec.label}>
              <div className={styles.sbSecLabel}>{sec.label}</div>
              {sec.items.map((item) => {
                const isActive = item.href === activeNav;
                const cls = `${styles.sbLink} ${isActive ? styles.active : ""}`;
                // Surfaces with no page yet stay dead, but they must not jump
                // the scroller to the top of the document on the way — the
                // drawer just closes.
                return item.href === "#" ? (
                  <a
                    key={item.label}
                    className={cls}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setNavOpen(false);
                    }}
                  >
                    <Icon id={item.icon} />
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.label}
                    className={cls + (item.locked ? ` ${styles.sbLockd}` : "") + (item.tool ? ` ${styles.sbTool}` : "") + (item.tool && item.soon && !item.locked ? ` ${styles.sbToolSoon}` : "")}
                    data-tone={item.tool?.tone}
                    data-tour={`nav:${item.href}`}
                    href={item.href as Route}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setNavOpen(false)}
                  >
                    {/* An estimating tool (2026-10-16): the shared drawer's
                        tool row (mobile-shell/mobile-nav) — an icon square on
                        a shadow in the tool's colour, the name, "Soon". */}
                    {item.tool ? (
                      <>
                        <span className={styles.sbTile} aria-hidden="true">
                          <Icon id={item.icon} />
                        </span>
                        <span className={styles.sbTxt}>
                          <span className={styles.sbName}>{item.label}</span>
                          {item.soon && !item.locked && (
                            <span className={styles.sbSoonTag} aria-label="Coming soon">
                              Soon
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <Icon id={item.icon} />
                        {item.label}
                      </>
                    )}
                    {/* Custom-plan lock: page not in the org's plan; the link
                        opens the upgrade offer. Inline svg — this surface's
                        sprite has no padlock. */}
                    {item.locked ? (
                      <svg
                        viewBox="0 0 24 24"
                        aria-label="Not in your plan"
                        style={{
                          width: 14, height: 14, marginLeft: "auto", flexShrink: 0,
                          fill: "none", stroke: "currentColor", strokeWidth: 2,
                          strokeLinecap: "round", strokeLinejoin: "round", opacity: 0.8,
                        }}
                      >
                        <rect x="5" y="11" width="14" height="10" rx="1.5" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    ) : (
                      <>
                        {(navBadges[item.href] ?? 0) > 0 ? (
                          <span className={styles.sbBadge} aria-label={`${navBadges[item.href]} new`}>
                            {navBadges[item.href] > 99 ? "99+" : navBadges[item.href]}
                          </span>
                        ) : null}
                        {/* The quota only when it is low or gone (quotaPill):
                            a full meter is not news, and never a bare "0". */}
                        {navLimits[item.href] && quotaPill(navLimits[item.href]) ? (
                          <span
                            className={`${styles.sbQuota}${quotaPill(navLimits[item.href])!.out ? ` ${styles.isOut}` : ""}${(navBadges[item.href] ?? 0) > 0 ? "" : ` ${styles.sbQuotaEnd}`}`}
                            title={quotaTip(navLimits[item.href])}
                            aria-label={quotaTip(navLimits[item.href])}
                          >
                            {quotaPill(navLimits[item.href])!.text}
                          </span>
                        ) : null}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>


        {/* The footer printed the donor's demo identity — the literal strings
            "Ivan" / "Owner" — to every signed-in user, and neither control went
            anywhere. Both are now real: the name and role come from the same
            `requireOrg()` read that fills the sheet. */}
        <div className={styles.sbFoot}>
          <Link
            className={styles.sbFootAcc}
            href={R.account}
            title="Account"
            onClick={() => setNavOpen(false)}
          >
            <span className={styles.sbFootAv}>{avatar}</span>
            <span className={styles.sbFootTxt}>
              <span className={styles.sbFootName}>{data.viewer.name}</span>
              <span className={styles.sbFootRole}>{data.viewer.role}</span>
              {navLimitsExempt ? <span className={`${styles.sbFootRole} ${styles.sbFootUnlim}`}>Unlimited · platform admin</span> : null}
            </span>
          </Link>
          <Link
            className={styles.sbFootIc}
            href={R.settings}
            aria-label="Settings"
            onClick={() => setNavOpen(false)}
          >
            <Icon id="i-gear" />
          </Link>
        </div>
      </aside>

      {/* ============ BOTTOM SHEET — move a lead ============ */}
      <div
        className={`${styles.scrim} ${sheetLead ? styles.on : ""}`}
        onClick={() => setSheetLead(null)}
        aria-hidden="true"
      />
      <div
        className={`${styles.sheet} ${sheetLead ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Move lead to stage"
        aria-hidden={!sheetLead}
        {...sheetDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...sheetDrag.handleProps} />
        <div className={styles.sheetHead} {...sheetDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetLead ? `${sheetLead.name} · ${sheetLead.job}` : "Lead · —"}
          </div>
          <div className={styles.sheetTitle}>Move to stage</div>
        </div>
        <div className={styles.sheetBody}>
          {LEAD_STAGES.map((s, i) => {
            const current = sheetLead?.stage === s.key;
            return (
              <button
                key={s.key}
                className={`${styles.sheetOpt} ${current ? styles.current : ""}`}
                type="button"
                disabled={current || !sheetLead}
                onClick={() => void moveLead(s.key)}
              >
                <span className={styles.sheetOptN}>{String(i + 1).padStart(2, "0")}</span>
                {s.label}
                {current ? <Icon id="i-check" /> : null}
              </button>
            );
          })}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetLead(null)}>
          Cancel
        </button>
      </div>

      {/* ============ TOAST ============
          A refused stage move has no dialog of its own to speak through, and a
          silent rollback reads as the app losing the tap. Fixed, so the reason
          is on screen wherever the rail was scrolled to. */}
      {toast ? (
        <div className={styles.toast} role="alert" aria-live="assertive">
          <Icon id="i-x" />
          <span className={styles.toastTxt}>{toast}</span>
          <button
            className={styles.toastX}
            type="button"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
          >
            <Icon id="i-x" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   SVG SPRITE — line icons 24×24, stroke 2, currentColor.
   Only original lucide paths; i-bulb is the reference's
   hand-drawn "switched-on" bulb (Smart Proposal).
   ============================================================ */
function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {/* i-logo (the drawn "J" sketch) is gone — both mastheads now render the
            real product mark from /jobflex-mark.png. */}
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </symbol>
        <symbol id="i-grid" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </symbol>
        <symbol id="i-file" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </symbol>
        <symbol id="i-target" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </symbol>
        <symbol id="i-cal" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="1" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </symbol>
        <symbol id="i-jobs" viewBox="0 0 24 24">
          <rect x="2" y="7" width="20" height="14" rx="1" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <path d="M2 13h20" />
        </symbol>
        <symbol id="i-bank" viewBox="0 0 24 24">
          <path d="M3 22h18" />
          <path d="M6 18v-7" />
          <path d="M10 18v-7" />
          <path d="M14 18v-7" />
          <path d="M18 18v-7" />
          <path d="m12 2 9 5H3z" />
        </symbol>
        <symbol id="i-phone" viewBox="0 0 24 24">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
        </symbol>
        <symbol id="i-msg" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </symbol>
        {/* Texting (2026-10-16, nav-map): the desk sprite's glyph. */}
        <symbol id="i-sms" viewBox="0 0 24 24">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M9 7h6" />
          <path d="M9 11h4" />
          <path d="M12 18h.01" />
        </symbol>
        <symbol id="i-thumb" viewBox="0 0 24 24">
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </symbol>
        <symbol id="i-bulb" viewBox="0 0 24 24">
          <path d="M9 15c-.2-1-.7-1.7-1.4-2.4A4.9 4.9 0 0 1 7.1 9.4a4.9 4.9 0 0 1 9.8 0c0 1.2-.5 2.3-1.5 3.2-.7.7-1.2 1.4-1.4 2.4" />
          <path d="M9.5 18h5" />
          <path d="M10.5 21h3" />
          <path d="M12 1.5V3" />
          <path d="m5.4 4.2 1.1 1.1" />
          <path d="m18.6 4.2-1.1 1.1" />
          <path d="M3 9.5h1.5" />
          <path d="M19.5 9.5H21" />
        </symbol>
        <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </symbol>
        {/* lucide file-plus — "new proposal" reads better as a document being
            created than as a bare "+", which is what the FAB had to settle for */}
        <symbol id="i-fileplus" viewBox="0 0 24 24">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h6" />
          <path d="M12 18v-6" />
          <path d="M9 15h6" />
        </symbol>
        <symbol id="i-user" viewBox="0 0 24 24">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </symbol>
        <symbol id="i-bell" viewBox="0 0 24 24">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </symbol>
        <symbol id="i-pin" viewBox="0 0 24 24">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </symbol>
        <symbol id="i-x" viewBox="0 0 24 24">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </symbol>
        {/* The drawer (mobile-shell/mobile-nav) draws every nav-map icon from
            THIS sprite on this route — it was missing these two, so Video
            estimator and Subscription rendered without a glyph (owner's
            report, 2026-09-03). Same paths as mobile-shell/sprite.tsx. */}
        <symbol id="i-video" viewBox="0 0 24 24">
          <rect x="2" y="6" width="13" height="12" rx="1.5" />
          <path d="M15 10.5 21 7v10l-6-3.5" />
        </symbol>
        <symbol id="i-card" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="14" rx="1" />
          <path d="M2 10h20" />
        </symbol>
        {/* …and these three (2026-10-16): Blueprint, HVAC and Deck drew an
            empty icon square in this page's drawer. */}
        <symbol id="i-plans" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M3 10h6" />
          <path d="M13 10h8" />
          <path d="M11 3v10" />
          <path d="M14 21v-6h7" />
          <path d="M6 15v3" />
        </symbol>
        <symbol id="i-heatpump" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 12V8.5" />
          <path d="m12 12 3 1.8" />
          <path d="m12 12-3 1.8" />
        </symbol>
        <symbol id="i-deck" viewBox="0 0 24 24">
          <path d="M2 10h20" />
          <path d="M2 13h20" />
          <path d="M4 13v8" />
          <path d="M20 13v8" />
          <path d="M12 13v8" />
          <path d="M5 10V5h14v5" />
        </symbol>
        <symbol id="i-pen" viewBox="0 0 24 24">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </symbol>
        <symbol id="i-folder" viewBox="0 0 24 24">
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </symbol>
        <symbol id="i-crm" viewBox="0 0 24 24">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4" />
          <path d="m15.4 6.5-6.8 4" />
        </symbol>
        <symbol id="i-hardhat" viewBox="0 0 24 24">
          <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" />
          <path d="M10 10V5a2 2 0 1 1 4 0v5" />
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
        </symbol>
        <symbol id="i-userplus" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6" />
          <path d="M22 11h-6" />
        </symbol>
        <symbol id="i-building" viewBox="0 0 24 24">
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </symbol>
        <symbol id="i-roof" viewBox="0 0 24 24">
          <path d="m2 11 10-8 10 8" />
          <path d="M5 9v12h14V9" />
        </symbol>
        <symbol id="i-fence" viewBox="0 0 24 24">
          <path d="M4 21V8l2-3 2 3v13" />
          <path d="M10 21V8l2-3 2 3v13" />
          <path d="M16 21V8l2-3 2 3v13" />
          <path d="M2 12h20" />
          <path d="M2 17h20" />
        </symbol>
        <symbol id="i-megaphone" viewBox="0 0 24 24">
          <path d="m3 11 18-5v12L3 13z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </symbol>
        <symbol id="i-board" viewBox="0 0 24 24">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M12 11h4" />
          <path d="M12 16h4" />
          <path d="M8 11h.01" />
          <path d="M8 16h.01" />
        </symbol>
        <symbol id="i-gift" viewBox="0 0 24 24">
          <rect x="3" y="8" width="18" height="4" />
          <path d="M12 8v13" />
          <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
          <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </symbol>
        <symbol id="i-chart" viewBox="0 0 24 24">
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </symbol>
        <symbol id="i-gear" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </symbol>
      </defs>
    </svg>
  );
}
