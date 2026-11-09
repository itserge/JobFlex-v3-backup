"use client";

// MOBILE PROJECT DETAIL — the handheld rebuild of /dashboard/projects/[id].
//
// ONE implementation, TWO entry points, no copy:
//   · /mobile-project-detail-v2/[id]           — the preview route, always mobile
//   · /dashboard/projects/[id] at ≤768px       — the live route, switched by a
//     media query (never a user agent) in project-detail-viewport-switch.tsx
//
// It is a REBUILD, not the desktop page shrunk. The desktop port
// (src/components/v3/project-detail-blueprint/*) is the design source — palette,
// type scale, border weights, shadow treatment, button colour treatment, KPI
// strip, tab bar, attach panel, jobs list and gantt — and every behaviour it
// carries is preserved here: tab switching, the filter chips with their counts,
// the attach panel toggled with the `hidden` attribute so the reveal observer
// can still fade it up, the real `attachJob(projectId, jobId)` server action
// with its optimistic row, the reveal cascade, delegated press feedback and the
// KPI count-up. The data layer is untouched: same server action, same queries.
//
// ── WHAT IT DELIBERATELY DOES NOT INHERIT ──────────────────────────────────
// Three known defects in the donor / desktop port, each decided here rather
// than carried:
//
//  1. `--ease-out` is undefined in the donor's :root, so its gantt bars never
//     animate; the shipped desktop page only animates because globals.css
//     happens to define the token. This page declares --ease-out in its own
//     root block (see the stylesheet), so the bars grow deterministically at
//     both URLs, with or without globals.css.
//
//  2. The donor's KPI count-up rebuilds the numeral from
//     `raw.replace(/[^0-9]/g, '')`, so a real budget of "$1,234.50" counts to
//     $123,450 and STAYS there. The projects-behavior.ts fix is carried: keep
//     whatever frames the number, and skip any value carrying a decimal.
//
//  3. The gantt adds `+ 86400000` to every end date to make an inclusive end
//     day. Real `endsAt` values carry a time, so a job ending at 17:00 draws a
//     bar running a full day past its end. Replaced with an explicit
//     end-of-that-calendar-day snap (`dayEnd`), which is what the donor's
//     whole-day fixture meant by it. Identical output for midnight dates,
//     correct for every other one.
//
// ── STATES THE DONOR NEVER DREW ────────────────────────────────────────────
// Handled with the page's existing vocabulary only, no new badge and no new
// colour: a CANCELED job (neutral badge carrying its own label, counted only by
// "All", exactly as the desktop port decided); a job with a start and no end (a
// minimum-width bar and a "no end date" annotation); a project with no window
// (the window falls back to the span the dated jobs cover, and with no dated
// jobs at all the timeline prints the empty state); a failed attach (the
// optimistic row rolls back and the panel says so).

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setProposalProject } from "@/actions/projectLinks";
import Link from "next/link";
import type { Route } from "next";
import { money } from "@/lib/format";
import { KIND_TAG, kindOf } from "@/lib/projectKind";
import { lockScroll } from "@/lib/scrollLock";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
// Shapes and pure helpers are IMPORTED from the desktop module rather than
// re-declared: the status vocabulary, the bucket rules, the month tables and
// the short-date shape must not drift between the two builds. Nothing in that
// folder is modified.
import {
  MO,
  MOFULL,
  type PdAvailProposal,
  type PdBudget,
  type PdJob,
  type PdOpens,
  type PdPayments,
  type PdBuying, PdSubs, PdSelections, PdPhases, PdLot, PdMoneyPlan, PdDraws,
  type PdField,
  type PdFinish,
  type PdShare,
  type PdTimeline,
  type PdProject,
  type PdStages,
  type PdWorker,
  type PdProposal,
  attachableFirst,
  badgeMod,
  bucketOf,
  changeOrderDoor,
  jobLabel,
  labelOf,
  monthKey,
  proposalLabel,
  proposalMeta,
  proposalTone,
  shortDate,
  withLocalDays,
} from "@/components/v3/project-detail-blueprint/project-detail-data";
import "./mobile-project-detail.css";
import { LooseProposalsStrip } from "@/components/v3/project-links/loose-proposals-strip";
import { ChangeOrderSheet } from "@/components/changeOrders/ChangeOrderSheet";
import { ProjectBudgetCard } from "@/components/v3/project-links/project-budget-card";
import { ProjectPaymentsCard } from "@/components/v3/project-links/project-payments-card";
import { ProjectCombine } from "@/components/v3/project-links/project-combine";
import { ProjectCrewSheet } from "@/components/v3/project-links/project-crew-sheet";
import { ProjectStagesCard } from "@/components/v3/project-links/project-stages-card";
import { ProjectBuyingCard } from "@/components/v3/project-links/project-buying-card";
import { ProjectSubsCard } from "@/components/v3/project-links/project-subs-card";
import { ProjectSelectionsCard } from "@/components/v3/project-links/project-selections-card";
import { ProjectPhasesStrip } from "@/components/v3/project-links/project-phases-strip";
import { ProjectLotCard } from "@/components/v3/project-links/project-lot-card";
import { ProjectMoneyCard } from "@/components/v3/project-links/project-money-card";
import type { BuildAnswers } from "@/lib/projectPhases/shared";
import { ProjectFieldCard } from "@/components/v3/project-links/project-field-card";
import { ProjectTimelineCard } from "@/components/v3/project-links/project-timeline-card";
import { ProjectFinishCard } from "@/components/v3/project-links/project-finish-card";
import { ProjectClientCard } from "@/components/v3/project-links/project-client-card";
import { ProjectOverviewCard } from "@/components/v3/project-links/project-overview-card";
import type { Overview, Snoozes } from "@/lib/projectOverview/shared";
import { SPACES, spaceHref, type SpaceId } from "@/lib/projectSpaces";

const DAY_MS = 86400000;

const wholeDollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The Proposals card's count line: what is sold, and what is still open. */
function proposalsSummary(list: PdProposal[]): string {
  if (!list.length) return "None yet";
  const sold = list.filter((p) => proposalTone(p.status) === "done").reduce((n, p) => n + p.contract, 0);
  const open = list.filter((p) => proposalTone(p.status) === "prog" || proposalTone(p.status) === "sch").reduce((n, p) => n + p.total, 0);
  return [String(list.length), sold ? `${wholeDollars(sold)} sold with tax` : null, open ? `${wholeDollars(open)} open` : null].filter(Boolean).join(" · ");
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── date helpers ─────────────────────────────────────────────────────────
   The donor's `+ 86400000` replaced by an explicit day snap. `dayStart` also
   matters: a job starting at 08:00 covers that whole day on a month-scale
   chart, and starting its bar 1/3 of a day in just looks like a rounding
   error at 300px of track. */
function dayStart(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function dayEnd(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}
/** Inclusive whole days between two dates, never below 1. */
function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((dayEnd(b) - dayStart(a)) / DAY_MS));
}

type View = "list" | "calendar" | "gantt";
type ListFilter = "all" | "done" | "prog" | "sch";

/** `?view=` — the one piece of page state worth putting in the URL, so another
 *  surface can link straight at the schedule or the timeline (the projects
 *  book's row sheet does exactly that). Anything unrecognised falls back to the
 *  jobs list, which is what a bare /dashboard/projects/<id> opens on. */
function viewFromParam(raw: string | null): View {
  return raw === "calendar" || raw === "gantt" ? raw : "list";
}

function Icon({ id }: { id: string }) {
  return (
    <svg className="ic" aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** KPI count-up — 750ms easeOutCubic, tabular numerals so the digits do not
 *  jump. Keeps whatever frames the number ("$", "%", " jobs") and refuses any
 *  value carrying a decimal, which is the whole of the donor's bug. */
function CountUp({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    const m = text.match(/^([^\d]*)(\d[\d,]*)([^\d]*)$/);
    if (!m) return;
    const [, prefix, digits, suffix] = m;
    const target = parseInt(digits.replace(/,/g, ""), 10);
    if (!isFinite(target)) return;
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      const e = 1 - Math.pow(1 - pr, 3);
      el.textContent = prefix + Math.round(target * e).toLocaleString("en-US") + suffix;
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return (
    <div ref={ref} className={className}>
      {text}
    </div>
  );
}

/* ── the ONE filter control ───────────────────────────────────────────────
   Every view's filter is this dropdown (owner's call, 2026-08-12), replacing
   the wrapped chip rail each view carried. A chip rail costs two 44px rows
   before a single job is on screen, and the calendar's rail grew one more chip
   per month in the project window — a six-month project pushed the schedule
   itself below the fold. The dropdown is one 50px row at any option count, and
   it is the same control the mobile projects list already uses, so the two
   surfaces read as one product.

   The menu is the projects list's 3-column drawn table: a cell per option,
   label over count, and a last cell that would sit alone stretching across the
   remainder so the table stays a complete rectangle at 4 options or 14. */
type DdOption = { key: string; label: string; count: number; tone?: string };

function FilterDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: DdOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /* Outside tap and Escape both close it, bound only while open so two
     dropdowns on one page can never both claim one key press. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = options.find((o) => o.key === value) ?? options[0];

  return (
    <div className={`mpd-dd${open ? " mpd-open" : ""}`} ref={ref}>
      <button
        className="mpd-dd-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon id="i-filter" />
        {label}
        <span className="mpd-dd-value" data-tone={active?.tone ?? "all"}>
          {active ? `${active.label} · ${active.count}` : "—"}
        </span>
        <span className="mpd-dd-caret">
          <Icon id="i-chev" />
        </span>
      </button>
      <div className="mpd-dd-menu" role="listbox">
        {options.map((o) => (
          <button
            key={o.key}
            className={`mpd-dd-item${o.key === value ? " mpd-on" : ""}`}
            type="button"
            role="option"
            aria-selected={o.key === value}
            data-tone={o.tone ?? "all"}
            onClick={() => {
              onChange(o.key);
              setOpen(false);
            }}
          >
            {o.label}
            <i className="mpd-dd-count">{o.count}</i>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── the project window ───────────────────────────────────────────────────
   The project's own dates, or — when it carries none — the span the dated jobs
   themselves cover. Same rule as the desktop build, with the day snap. */
function windowOf(project: PdProject, jobs: PdJob[]): { w0: number; w1: number } | null {
  if (project.startsAt && project.endsAt) {
    const w0 = dayStart(project.startsAt);
    const w1 = dayEnd(project.endsAt);
    if (w1 > w0) return { w0, w1 };
  }
  const dated = jobs.filter((j) => j.startsAt);
  if (!dated.length) return null;
  const w0 = Math.min(...dated.map((j) => dayStart(j.startsAt as Date)));
  const w1 = Math.max(...dated.map((j) => dayEnd((j.endsAt ?? j.startsAt) as Date)));
  return w1 > w0 ? { w0, w1 } : null;
}

export function MobileProjectDetail({
  project: projectIn,
  jobs,
  proposals = [],
  availableProposals,
  looseProposals = [],
  budget,
  canManage = false,
  opens = { client: true, jobs: true },
  payments = [],
  roster = [],
  stages = { stages: [], done: null, draftedByAi: false },
  buying,
  subs,
  selections,
  phases,
  lot,
  lotAddress = null,
  build = null,
  buildWords = null,
  moneyPlan,
  draws = null,
  field,
  timeline,
  finish,
  share,
  overview,
  space = "remodel",
  snoozes = {},
}: {
  project: PdProject;
  jobs: PdJob[];
  proposals?: PdProposal[];
  availableProposals: PdAvailProposal[];
  looseProposals?: Array<{ id: string; title: string; total: number }>;
  budget?: PdBudget;
  canManage?: boolean;
  opens?: PdOpens;
  payments?: PdPayments;
  roster?: PdWorker[];
  /** The order of the work (2026-11-05). */
  stages?: PdStages;
  /** The to-buy list and the orders (2026-11-05). */
  buying?: PdBuying;
  subs?: PdSubs;
  /** What the client has to choose (2026-11-07). */
  selections?: PdSelections;
  /** A new build (part 4): the phases, the lot, the client's address, the start questions and their words. */
  phases?: PdPhases;
  lot?: PdLot;
  lotAddress?: string | null;
  build?: BuildAnswers | null;
  buildWords?: string | null;
  /** Who it is for and the money (part 5). */
  moneyPlan?: PdMoneyPlan;
  /** A lender's draws (part 6). */
  draws?: PdDraws | null;
  /** On site: problems, hours, the subs' bills (2026-11-05). */
  field?: PdField;
  /** The stages across the weeks (2026-11-06). */
  timeline?: PdTimeline;
  /** The punch list and the finish line (2026-11-06). */
  finish?: PdFinish;
  /** The client's page and the files (2026-11-06). */
  share?: PdShare;
  /** The Overview (2026-11-09), the workspace, the rows hidden with "Not now". */
  overview?: Overview;
  space?: SpaceId;
  snoozes?: Snoozes;
}) {
  // The project's dates are days, not moments (withLocalDays).
  const project = useMemo(() => withLocalDays(projectIn), [projectIn]);
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();

  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Seeded from `?view=`, then owned by the segmented control — deep-linking in
  // must not fight the tabs once you are on the page.
  const [view, setView] = useState<View>(() => viewFromParam(search.get("view")));
  const [listF, setListF] = useState<ListFilter>("all");
  const [calF, setCalF] = useState<string>("all");
  // The timeline gets the list's own status filter, so all three views are
  // filtered by one control of the same shape.
  const [ganttF, setGanttF] = useState<ListFilter>("all");
  const [attachOpen, setAttachOpen] = useState(false);
  // The proposal whose change orders are open (2026-09-18).
  const [coFor, setCoFor] = useState<string | null>(null);
  // The job whose Schedule & crew sheet is open (2026-11-04).
  const [crewFor, setCrewFor] = useState<PdJob | null>(null);

  // The authoritative lists are the server's, so the optimistic move is a set
  // of ids laid OVER them: once router.refresh() lands, the job is already in
  // `jobs` and gone from `availableJobs`, and the id turns inert on its own.
  const [moved, setMoved] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  /* ---------- viewport height -------------------------------------------
     Handheld rule: viewport heights only via var(--app-h). A phone's URL bar
     changes innerHeight mid-scroll, so the real value is republished rather
     than trusting a bare 100dvh. */
  useEffect(() => {
    const apply = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${h}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    // Shared lock: hand-rolling body.style.overflow poisons nested locks and
    // leaves the page stuck until a reload.
    const releaseScroll = lockScroll();
    return () => {
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-h");
      releaseScroll();
    };
  }, []);

  /* ---------- Motion: reveal on load + adaptive reveal on scroll ---------- */
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
      el.classList.add("mpd-rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${i * 60}ms` : "200ms";
    });
    // KPI cells run left-to-right behind their block, at the donor's numbers.
    const cells = Array.from(content.querySelectorAll<HTMLElement>(".mpd-cell"));
    cells.forEach((el, i) => {
      el.classList.add("mpd-rv-cell");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${160 + (i % 8) * 45}ms` : "200ms";
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          // Below the fold: duration follows scroll speed — slow ≈ 900ms, fast
          // never shorter than 550ms.
          if (t.dataset.rvScroll) {
            t.style.transitionDuration = `${Math.round(Math.max(550, 900 - vel * 160))}ms`;
          }
          t.classList.add("mpd-rv-in");
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
    blocks.concat(cells).forEach((el) => io.observe(el));
    // The attach panel starts `hidden`, so it never intersects and stays at
    // mpd-rv opacity 0 until it is opened — at which point the observer, which
    // is still watching it, fades it up. That is the donor's own behaviour,
    // preserved by keeping the element mounted rather than unmounting it.
    return () => {
      io.disconnect();
      host.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ---------- Escape closes the attach sheet ------------------------------
     Bound only while the sheet is open, so MobileNav's own Escape (its drawer)
     and this one can never both claim a single key press. */
  useEffect(() => {
    if (!attachOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAttachOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [attachOpen]);

  /* ---------- Motion: graph-paper parallax ------------------------------- */
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

  /* ---------- Motion: press stamp ----------------------------------------
     Delegated from the root, exactly like the desktop port: binding to the
     controls that exist at mount would lose the effect on every Attach button
     the moment the list re-renders. */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".mpd-btn, .mpd-seg-btn, .mpd-dd-btn, .mpd-dd-item, .mpd-av-btn",
    );
    if (!el) return;
    el.classList.remove("mpd-pressed");
    void el.offsetWidth;
    el.classList.add("mpd-pressed");
  }, []);
  const onRootAnimEnd = useCallback((e: React.AnimationEvent) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains("mpd-pressed")) el.classList.remove("mpd-pressed");
  }, []);

  /* ---------- attach ------------------------------------------------------ */
  const shownAvail = useMemo(
    () => attachableFirst(availableProposals.filter((p) => !moved.includes(p.id))),
    [availableProposals, moved],
  );
  /* No optimistic job row any more. The old panel attached ONE job and could
     splice a stand-in for it out of `availableJobs`; a proposal carries n jobs
     whose titles this page never reads, so inventing rows for them would mean
     widening the query to serve 300ms of placeholder. The attached proposal
     leaves the sheet the instant it is picked, and the jobs arrive with the
     refresh. */
  const shownJobs = jobs;

  /** Attach a PROPOSAL: file it under this project; its job and change
   *  orders come with it (actions/projectLinks). */
  const onAttach = useCallback(
    async (p: PdAvailProposal) => {
      setAttachErr(null);
      setBusyId(p.id);
      setMoved((m) => [...m, p.id]);
      try {
        await setProposalProject({ proposalId: p.id, projectId: project.id });
        startTransition(() => router.refresh());
      } catch (err) {
        setMoved((m) => m.filter((x) => x !== p.id));
        setAttachErr(err instanceof Error ? err.message : "Could not attach that proposal");
      } finally {
        setBusyId(null);
      }
    },
    [project.id, router],
  );

  /* ---------- KPI --------------------------------------------------------- */
  const kJobs = shownJobs.length;
  // Scheduled = on the calendar; an accepted job with no dates yet is not (2026-11-04).
  const kSch = shownJobs.filter((j) => j.status === "SCHEDULED" && !!j.startsAt).length;
  const kProg = shownJobs.filter((j) => j.status === "IN_PROGRESS").length;

  const hasWindow = Boolean(project.startsAt && project.endsAt);

  // Swipe-down dismissal on the attach sheet, on the same setter Escape and the
  // scrim use.
  const attachDrag = useSheetDrag(attachOpen, () => setAttachOpen(false));

  return (
    <div
      className="jf-mobile-project-detail"
      onClick={onRootClick}
      onAnimationEnd={onRootAnimEnd}
    >
      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own state. */}
      <MobileNav />

      <main className="mpd-scroll" ref={scrollRef}>
        <div className="mpd-content" ref={contentRef}>
          {/* ============ PAGE HEAD ============ */}
          <div className="mpd-head">
            {/* No "All projects" back link and no "Projects" kicker (owner's
                call, 2026-08-12): the drawer already carries the way back, and
                on a phone the project name should own the top of the page. */}
            {project.client ? (
              opens.client ? (
                <Link className="mpd-client" href={`/dashboard/client-detail?client=${project.client.id}` as Route}>
                  {project.client.name}
                </Link>
              ) : (
                <span className="mpd-client">{project.client.name}</span>
              )
            ) : null}
            <h1 className="mpd-title">{project.name}</h1>
            <div className="mpd-dateline">
              {project.number ? <span data-project-number>{`#${project.number} · `}</span> : null}
              <Link href={spaceHref(space) as Route} style={{ color: SPACES[space].color, fontWeight: 800 }} data-project-space={space}>
                {SPACES[space].name}
              </Link>
              <span data-project-kind={kindOf(project.kind)}>{` · ${KIND_TAG[kindOf(project.kind)]} · `}</span>
              {hasWindow ? (
                <>
                  Project window ·{" "}
                  <b>
                    {shortDate(project.startsAt as Date)} → {shortDate(project.endsAt as Date)}
                  </b>{" "}
                  · {daysBetween(project.startsAt as Date, project.endsAt as Date)} days
                </>
              ) : (
                <>No window set</>
              )}
            </div>
          </div>

          {/* ============ THE OVERVIEW (2026-11-09): how it stands and what to do, first ============ */}
          {overview ? (
            <div className="mpd-budget">
              <ProjectOverviewCard projectId={project.id} projectName={project.name} overview={overview} space={space} snoozes={snoozes} canManage={canManage} subsHref={`/mobile-project-subs-v1/${project.id}`} />
            </div>
          ) : null}

          {/* ============ MASTHEAD — budget + the three counts ============ */}
          <div className="mpd-mast">
            <div className="mpd-mast-top">
              <div className="mpd-mast-lbl">
                Cost budget
                <span className="mpd-mast-rule" />
              </div>
              <CountUp className="mpd-mast-val" text={money(project.budget)} />
            </div>
            <div className="mpd-cells">
              <div className="mpd-cell">
                <div className="mpd-cell-lbl">Jobs</div>
                <CountUp className="mpd-cell-val" text={String(kJobs)} />
              </div>
              <div className="mpd-cell">
                <div className="mpd-cell-lbl">Scheduled</div>
                <CountUp className="mpd-cell-val" text={String(kSch)} />
              </div>
              <div className="mpd-cell">
                <div className="mpd-cell-lbl">In progress</div>
                <CountUp className="mpd-cell-val" text={String(kProg)} />
              </div>
            </div>
          </div>

          {/* ============ A NEW BUILD: THE PHASES AND THE LOT (2026-11-07, part 4) ============ */}
          {phases && phases.phases.length ? (
            <div className="mpd-budget">
              <ProjectPhasesStrip phases={phases} answers={buildWords} />
            </div>
          ) : null}
          {kindOf(project.kind) === "NEW_BUILD" && lot && timeline ? (
            <div className="mpd-budget">
              <ProjectLotCard projectId={project.id} lot={lot} answers={build} clientAddress={lotAddress} today={timeline.today} canManage={canManage} />
            </div>
          ) : null}

          {/* ============ STAGES (2026-11-05) ============ */}
          <div className="mpd-budget">
            <ProjectStagesCard projectId={project.id} stages={stages} canManage={canManage} kind={kindOf(project.kind)} />
          </div>
          {timeline ? (
            <div className="mpd-budget">
              <ProjectTimelineCard projectId={project.id} timeline={timeline} canManage={canManage} />
            </div>
          ) : null}
          {share ? (
            <div className="mpd-budget">
              <ProjectClientCard projectId={project.id} share={share} canManage={canManage} />
            </div>
          ) : null}
          {field ? (
            <div className="mpd-budget">
              <ProjectFieldCard projectId={project.id} field={field} canManage={canManage} />
            </div>
          ) : null}
          {finish ? (
            <div className="mpd-budget">
              <ProjectFinishCard projectId={project.id} finish={finish} jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} payments={payments} canManage={canManage} />
            </div>
          ) : null}
          <div className="mpd-loose">
            <LooseProposalsStrip projectId={project.id} client={project.client} loose={looseProposals} />
          </div>
          <ChangeOrderSheet
            open={coFor !== null}
            onClose={() => setCoFor(null)}
            proposalId={coFor ?? undefined}
            onDone={() => startTransition(() => router.refresh())}
          />
          {/* ============ PROPOSALS (2026-09-18) ============ */}
          <section className="mpd-card mpd-props" aria-label="Proposals in this project">
            <div className="mpd-card-h">
              <div className="mpd-card-t">Proposals</div>
              <div className="mpd-card-s">{proposalsSummary(proposals)}</div>
            </div>
            {proposals.map((p) => (
              <div className="mpd-prop" key={p.id}>
                <Link className="mpd-prop-txt" href={`/dashboard/proposals/${p.id}` as Route}>
                  <span className="mpd-row-n">{p.title}</span>
                  <span className="mpd-row-m">
                    {wholeDollars(p.contract)}
                    {p.co.count ? ` · ${p.co.count} change order${p.co.count === 1 ? "" : "s"}` : ""}
                  </span>
                </Link>
                <span className={`mpd-b mpd-b--${proposalTone(p.status) === "bad" ? "sch" : proposalTone(p.status)}`}>{proposalLabel(p.status)}</span>
                {changeOrderDoor(p, canManage) ? (
                  <button className="mpd-prop-co" type="button" aria-label={`Change orders for ${p.title}`} onClick={() => setCoFor(p.id)}>
                    <Icon id="i-plus" />
                    CO
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="mpd-btn mpd-props-new"
              type="button"
              onClick={() =>
                // The picker is mounted in MobileNav; any engine files here.
                document.dispatchEvent(
                  new CustomEvent("jf:estimator-picker", {
                    detail: {
                      projectId: project.id,
                      projectName: project.name,
                      clientId: project.client?.id ?? null,
                      clientName: project.client?.name ?? null,
                    },
                  }),
                )
              }
            >
              <Icon id="i-plus" />
              New proposal in this project
            </button>
          </section>

          {/* ============ ONE PROPOSAL FOR ALL OF IT (2026-11-04) ============ */}
          <div className="mpd-budget">
            <ProjectCombine projectId={project.id} projectName={project.name} proposals={proposals} />
          </div>

          {/* ============ SELECTIONS (2026-11-07) ============ */}
          {selections ? (
            <div className="mpd-budget">
              <ProjectSelectionsCard projectId={project.id} selections={selections} stages={stages.stages} canManage={canManage} />
            </div>
          ) : null}

          {/* ============ BUYING AND DELIVERIES (2026-11-05) ============ */}
          {buying ? (
            <div className="mpd-budget">
              <ProjectBuyingCard projectId={project.id} buying={buying} stages={stages.stages} canManage={canManage} />
            </div>
          ) : null}
          {subs ? (
            <div className="mpd-budget">
              <ProjectSubsCard projectId={project.id} subs={subs} stages={stages.stages} canManage={canManage} sectionHref={`/mobile-project-subs-v1/${project.id}`} />
            </div>
          ) : null}

          {/* ============ THE MONEY (2026-11-07, part 5) ============ */}
          {moneyPlan ? (
            <div className="mpd-budget">
              <ProjectMoneyCard projectId={project.id} money={moneyPlan} canManage={canManage} />
            </div>
          ) : null}

          {/* ============ BUDGET (2026-09-18) ============ */}
          {budget ? (
            <div className="mpd-budget">
              <ProjectBudgetCard projectId={project.id} budget={budget} />
            </div>
          ) : null}

          {/* ============ PAYMENTS (2026-11-04) ============ */}
          <div className="mpd-budget">
            <ProjectPaymentsCard payments={payments} canManage={canManage} draws={draws} projectId={project.id} />
          </div>
          <ProjectCrewSheet key={crewFor?.id ?? "none"} job={crewFor} roster={roster} onClose={() => setCrewFor(null)} />

          {/* ============ VIEW BAR ============ */}
          <div className="mpd-views">
            <div className="mpd-seg" role="tablist" aria-label="Project views">
              {(
                [
                  ["list", "List"],
                  ["calendar", "Calendar"],
                  ["gantt", "Gantt"],
                ] as Array<[View, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`mpd-seg-btn${view === k ? " mpd-on" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={view === k}
                  onClick={() => setView(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className={`mpd-btn${attachOpen ? " mpd-open" : ""}`}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={attachOpen}
              onClick={() => {
                setAttachErr(null);
                setAttachOpen(true);
              }}
            >
              <Icon id="i-plus" />
              Attach proposal
            </button>
          </div>

          {/* ============ VIEW BODY ============ */}
          {view === "list" ? (
            <ListView jobs={shownJobs} listF={listF} onFilter={setListF} openJobs={opens.jobs} onCrew={canManage ? setCrewFor : null} />
          ) : view === "calendar" ? (
            <CalView project={project} jobs={shownJobs} calF={calF} onFilter={setCalF} />
          ) : (
            <GanttView project={project} jobs={shownJobs} ganttF={ganttF} onFilter={setGanttF} />
          )}
        </div>
      </main>

      {/* ============ ATTACH SHEET ============
          Was an inline `hidden`-toggled panel between the tab bar and the view
          (owner, 2026-08-15). It is a POPUP now, and on a handheld the house
          popup is a bottom sheet, not a centred dialog — CLAUDE.md's own rule,
          and the same `.sheet` grammar the projects book and the proposals
          ledger already use, down to the grab handle and the swipe-down
          dismissal. What it lists changed too: PROPOSALS, not jobs. */}
      <div
        className={`mpd-scrim${attachOpen ? " mpd-on" : ""}`}
        onClick={() => setAttachOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`mpd-sheet${attachOpen ? " mpd-on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mpdAttachTitle"
        aria-hidden={!attachOpen}
        {...attachDrag.sheetProps}
      >
        <div className="mpd-sheet-grab" {...attachDrag.handleProps} />
        <div className="mpd-sheet-head" {...attachDrag.handleProps}>
          <div className="mpd-sheet-kick">Delivery / attach</div>
          <div className="mpd-sheet-t" id="mpdAttachTitle">Attach a proposal</div>
          <div className="mpd-sheet-s">Picking one files it under {project.name}, with its change orders and job.</div>
        </div>
        <div className="mpd-sheet-body">
          {attachErr ? (
            <div className="mpd-attach-err" role="alert">
              <Icon id="i-x" />
              <span>{attachErr}</span>
            </div>
          ) : null}
          {shownAvail.length ? (
            shownAvail.map((p) => (
              <div className="mpd-av" key={p.id}>
                <div className="mpd-av-txt">
                  <div className="mpd-av-n">{p.title}</div>
                  <div className="mpd-av-m">{proposalMeta(p, money)}</div>
                </div>
                <button
                  className="mpd-av-btn"
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => onAttach(p)}
                >
                  {busyId === p.id ? "Attaching" : "Attach"}
                </button>
              </div>
            ))
          ) : (
            <div className="mpd-empty">No proposals left</div>
          )}
        </div>
        <button className="mpd-sheet-cancel" type="button" onClick={() => setAttachOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ================================ LIST ================================= */

/** A job row: a link to the job, or a plain row for a role that cannot open it. */
function RowLink({ className, href, children }: { className: string; href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link className={className} href={href as Route} data-pd-job>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

function ListView({
  jobs,
  listF,
  onFilter,
  openJobs,
  onCrew,
}: {
  jobs: PdJob[];
  listF: ListFilter;
  onFilter: (f: ListFilter) => void;
  /** False for a role with no job page: the rows stay plain. */
  openJobs: boolean;
  /** Opens Schedule & crew for a job — owners and managers; null hides the button. */
  onCrew: ((j: PdJob) => void) | null;
}) {
  const counts: Record<ListFilter, number> = {
    all: jobs.length,
    done: jobs.filter((j) => bucketOf(j.status) === "done").length,
    prog: jobs.filter((j) => bucketOf(j.status) === "prog").length,
    sch: jobs.filter((j) => bucketOf(j.status) === "sch").length,
  };
  const options: DdOption[] = [
    { key: "all", label: "All", count: counts.all, tone: "all" },
    { key: "prog", label: "In progress", count: counts.prog, tone: "prog" },
    { key: "sch", label: "Scheduled", count: counts.sch, tone: "sch" },
    { key: "done", label: "Done", count: counts.done, tone: "done" },
  ];
  const vis = listF === "all" ? jobs : jobs.filter((j) => bucketOf(j.status) === listF);

  return (
    <section className="mpd-card" role="tabpanel" aria-label="Jobs list">
      <div className="mpd-card-h">
        <h2 className="mpd-card-t">Jobs</h2>
        <span className="mpd-card-s">
          {vis.length} of {jobs.length}
        </span>
      </div>
      <div className="mpd-fbar">
        <FilterDropdown
          label="Status"
          options={options}
          value={listF}
          onChange={(k) => onFilter(k as ListFilter)}
        />
      </div>
      {vis.length ? (
        vis.map((j) => (
          <div className="mpd-jobrow mpd-row-in" key={j.id}>
            <RowLink className={`mpd-row${openJobs ? " mpd-row--link" : ""}`} href={openJobs ? `/dashboard/jobs/${j.id}` : null}>
              <div className="mpd-row-txt">
                <div className="mpd-row-n">{j.title}</div>
                <div className="mpd-row-m">
                  {j.clientName ?? "Unassigned"}
                  {j.startsAt
                    ? ` · ${shortDate(j.startsAt)}${j.endsAt ? ` → ${shortDate(j.endsAt)}` : ""}`
                    : " · no dates yet"}
                </div>
                {j.crew?.length ? <div className="mpd-row-crew">Crew · {j.crew.map((c) => c.name).join(", ")}</div> : null}
              </div>
              <span className={`mpd-b mpd-b--${badgeMod(j.status)}`}>{jobLabel(j)}</span>
            </RowLink>
            {onCrew ? (
              <button className="mpd-btn mpd-crew-btn" type="button" onClick={() => onCrew(j)} data-pd-crew={j.title}>
                {j.startsAt || j.crew?.length ? "Schedule & crew" : "Schedule"}
              </button>
            ) : null}
          </div>
        ))
      ) : (
        <div className="mpd-empty">Nothing in this filter</div>
      )}
    </section>
  );
}

/* ============================== CALENDAR =============================== */

function CalView({
  project,
  jobs,
  calF,
  onFilter,
}: {
  project: PdProject;
  jobs: PdJob[];
  calF: string;
  onFilter: (f: string) => void;
}) {
  const win = windowOf(project, jobs);
  const months: Array<{ y: number; m: number; key: string }> = [];
  if (win) {
    const cur = new Date(win.w0);
    cur.setHours(0, 0, 0, 0);
    cur.setDate(1);
    const end = new Date(win.w1);
    while (cur.getTime() <= end.getTime()) {
      months.push({
        y: cur.getFullYear(),
        m: cur.getMonth(),
        key: `${cur.getFullYear()}-${cur.getMonth()}`,
      });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  function inMonth(j: PdJob, y: number, m: number) {
    const m0 = new Date(y, m, 1).getTime();
    const m1 = new Date(y, m + 1, 1).getTime() - 1;
    const s0 = dayStart(j.startsAt as Date);
    const e0 = dayEnd((j.endsAt ?? j.startsAt) as Date);
    return s0 <= m1 && e0 >= m0;
  }

  const dated = jobs.filter((j) => j.startsAt);
  const undated = jobs.length - dated.length;
  const sorted = dated
    .filter((j) => {
      if (calF === "all") return true;
      const mo = months.find((x) => x.key === calF);
      return mo ? inMonth(j, mo.y, mo.m) : true;
    })
    .slice()
    .sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());

  const body: React.ReactNode[] = [];
  let lastMo = "";
  sorted.forEach((j) => {
    const start = j.startsAt as Date;
    const k = monthKey(start);
    if (k !== lastMo) {
      lastMo = k;
      body.push(
        <div className="mpd-ag-mo" key={`mo-${k}`}>
          {MOFULL[start.getMonth()]} {start.getFullYear()}
        </div>,
      );
    }
    body.push(
      <div className="mpd-row mpd-row-in" key={j.id}>
        <div className="mpd-row-txt">
          {/* The date leads the row on its own line — which is what the desktop
              build itself does below 860px, so this is the same composition. */}
          <span className="mpd-ag-d">
            {shortDate(start)}
            {j.endsAt ? ` → ${shortDate(j.endsAt)}` : ""}
          </span>
          <div className="mpd-row-n">{j.title}</div>
          <div className="mpd-row-m">{j.clientName ?? "Unassigned"}</div>
        </div>
        <span className={`mpd-b mpd-b--${badgeMod(j.status)}`}>{labelOf(j.status)}</span>
      </div>,
    );
  });

  return (
    <section className="mpd-card" role="tabpanel" aria-label="Schedule">
      <div className="mpd-card-h">
        <h2 className="mpd-card-t">Schedule</h2>
        <span className="mpd-card-s">
          {project.startsAt && project.endsAt
            ? `${shortDate(project.startsAt)} → ${shortDate(project.endsAt)}`
            : "no window set"}
        </span>
      </div>
      <div className="mpd-fbar">
        <FilterDropdown
          label="Month"
          options={[
            { key: "all", label: "All dates", count: dated.length, tone: "all" },
            ...months.map((mo) => ({
              key: mo.key,
              // The full month name, not the three-letter chip label: a
              // dropdown cell has the room a 44px chip never did.
              label: `${MOFULL[mo.m]} ${String(mo.y).slice(2)}`,
              count: dated.filter((j) => inMonth(j, mo.y, mo.m)).length,
            })),
          ]}
          value={calF}
          onChange={onFilter}
        />
      </div>
      {body.length ? body : <div className="mpd-empty">Nothing scheduled in this range</div>}
      {/* Undated jobs exist but cannot be placed. The desktop build drops them
          without a word; on a phone that reads as data loss. */}
      {undated > 0 ? (
        <div className="mpd-note">
          {undated} {undated === 1 ? "job has" : "jobs have"} no start date — see the List tab
        </div>
      ) : null}
    </section>
  );
}

/* =============================== GANTT ================================= */

function GanttView({
  project,
  jobs,
  ganttF,
  onFilter,
}: {
  project: PdProject;
  jobs: PdJob[];
  ganttF: ListFilter;
  onFilter: (f: ListFilter) => void;
}) {
  // The window is measured over EVERY job, filtered or not: a timeline whose
  // axis re-scaled on each filter change would make two bars impossible to
  // compare, which is the one thing a gantt is for.
  const win = windowOf(project, jobs);
  const scope = ganttF === "all" ? jobs : jobs.filter((j) => bucketOf(j.status) === ganttF);
  const rows = scope.filter((j) => j.startsAt);
  const undated = scope.length - rows.length;

  const counts: Record<ListFilter, number> = {
    all: jobs.length,
    done: jobs.filter((j) => bucketOf(j.status) === "done").length,
    prog: jobs.filter((j) => bucketOf(j.status) === "prog").length,
    sch: jobs.filter((j) => bucketOf(j.status) === "sch").length,
  };
  const filterEl = (
    <div className="mpd-fbar">
      <FilterDropdown
        label="Status"
        options={[
          { key: "all", label: "All", count: counts.all, tone: "all" },
          { key: "prog", label: "In progress", count: counts.prog, tone: "prog" },
          { key: "sch", label: "Scheduled", count: counts.sch, tone: "sch" },
          { key: "done", label: "Done", count: counts.done, tone: "done" },
        ]}
        value={ganttF}
        onChange={(k) => onFilter(k as ListFilter)}
      />
    </div>
  );

  // The clock, read once per mount. Hooks run before the `!win` early return
  // below, so this cannot sit beside its only use further down.
  const [now] = useState(() => Date.now());

  // Bars grow in sequence, at the donor's numbers (120ms + 70ms per row).
  // Driven straight at the DOM, as the donor does: a re-render rebuilds the
  // bars at scaleX(0) and the run replays, which is what renderView() produces.
  const hostRef = useRef<HTMLElement>(null);
  const runKey = rows.map((j) => j.id).join(",");
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduce = prefersReducedMotion();
    const bars = Array.from(host.querySelectorAll<HTMLElement>(".mpd-g-bar"));
    const timers: number[] = [];
    bars.forEach((b, i) => {
      if (reduce) {
        b.classList.add("mpd-in");
        return;
      }
      timers.push(window.setTimeout(() => b.classList.add("mpd-in"), 120 + i * 70));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [runKey]);

  if (!win || !rows.length) {
    return (
      <section className="mpd-card" role="tabpanel" aria-label="Timeline" ref={hostRef}>
        <div className="mpd-card-h">
          <h2 className="mpd-card-t">Timeline</h2>
        </div>
        {filterEl}
        <div className="mpd-empty">Nothing scheduled in this range</div>
      </section>
    );
  }

  const span = win.w1 - win.w0;

  // Month axis: the first of each month inside the window (the opening month is
  // cut off by the window's own start, exactly like the desktop build).
  const ticks: Array<{ key: string; left: number; label: string }> = [];
  {
    const cur = new Date(win.w0);
    cur.setHours(0, 0, 0, 0);
    cur.setDate(1);
    cur.setMonth(cur.getMonth() + 1);
    while (cur.getTime() <= win.w1) {
      if (cur.getTime() > win.w0) {
        ticks.push({
          key: `${cur.getFullYear()}-${cur.getMonth()}`,
          left: ((cur.getTime() - win.w0) / span) * 100,
          label: MO[cur.getMonth()],
        });
      }
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  // `now` is read ONCE per mount (the lazy initialiser above), not on every
  // render: `Date.now()` in a render body is an impure call, and re-reading the
  // clock on a filter tap could only ever move a day-scale marker by pixels it
  // cannot draw. Pre-existing lint failure, fixed while this file was open.
  const todayLeft = now > win.w0 && now < win.w1 ? ((now - win.w0) / span) * 100 : null;

  return (
    <section className="mpd-card" role="tabpanel" aria-label="Timeline" ref={hostRef}>
      <div className="mpd-card-h">
        <h2 className="mpd-card-t">Timeline</h2>
        <span className="mpd-card-s">
          {shortDate(new Date(win.w0))} → {shortDate(new Date(win.w1))}
        </span>
      </div>

      {filterEl}

      {/* The month ruler, drawn once. Its ticks repeat inside every track
          below at the same percentages, which is what keeps the bars readable
          against the calendar once the label column is gone. */}
      <div className="mpd-g-ruler" aria-hidden="true">
        {ticks.map((t) => (
          <span className="mpd-g-month" key={t.key} style={{ left: `${t.left.toFixed(1)}%` }}>
            {t.label}
          </span>
        ))}
      </div>

      {rows.map((j) => {
        const start = j.startsAt as Date;
        const end = (j.endsAt ?? j.startsAt) as Date;
        const st = dayStart(start);
        // NOT the donor's `+ 86400000`: the end of the day the job ends on.
        const en = dayEnd(end);
        const width = Math.max(3, Math.min(100, ((en - st) / span) * 100));
        const left = Math.min(100 - width, Math.max(0, ((st - win.w0) / span) * 100));
        return (
          <div className="mpd-g-row" key={j.id}>
            <div className="mpd-g-top">
              <div className="mpd-g-name">{j.title}</div>
              <span className={`mpd-b mpd-b--${badgeMod(j.status)}`}>{labelOf(j.status)}</span>
            </div>
            <div className="mpd-g-track">
              {ticks.map((t) => (
                <i className="mpd-g-grid" key={t.key} style={{ left: `${t.left.toFixed(1)}%` }} />
              ))}
              {todayLeft !== null ? (
                <i className="mpd-g-today" style={{ left: `${todayLeft.toFixed(1)}%` }} />
              ) : null}
              <div
                className={`mpd-g-bar mpd-g-bar--${badgeMod(j.status)}`}
                style={{ left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%` }}
              />
            </div>
            {/* The desktop's hover title, printed. There is no hover here. */}
            <div className="mpd-g-meta">
              <span>
                <b>{shortDate(start)}</b>
                {j.endsAt ? (
                  <>
                    {" → "}
                    <b>{shortDate(j.endsAt)}</b>
                  </>
                ) : (
                  " · no end date"
                )}
              </span>
              {j.endsAt ? <span>{daysBetween(start, j.endsAt)} days</span> : null}
            </div>
          </div>
        );
      })}

      {todayLeft !== null ? (
        <div className="mpd-note">Dashed rule marks today</div>
      ) : null}
      {undated > 0 ? (
        <div className="mpd-note">
          {undated} {undated === 1 ? "job has" : "jobs have"} no start date — not on the timeline
        </div>
      ) : null}
    </section>
  );
}
