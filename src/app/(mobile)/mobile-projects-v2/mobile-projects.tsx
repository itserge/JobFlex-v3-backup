"use client";

// MOBILE PROJECTS (mobile-projects-v2) — Blueprint system, handheld build.
//
// Fourth surface in the handheld family. Tokens, palette, type scale, status
// tones and Motion System "Balanced" are the reference dashboard's; the shell
// (dark topbar + hamburger drawer) is the shared <MobileNav />, so this page and
// its three siblings are one product.
//
// Every component / region / variant of the desktop projects sheet is covered:
//  · page head — "Delivery" kicker, Projects H1, the New-project action
//  · computed masthead (one numeral + mono kicker + EXACTLY two annotations)
//  · the status chip rail, re-cut as ONE dropdown (a chip rail cannot survive
//    320px), with two further real states added: Unscheduled and Not started
//  · the project CARD (name, scope, status, jobs, budget, window, progress bar,
//    "x of y complete · due z"), re-cut as a row card with a drawn progress rule
//  · all three status badges — active / on hold / completed, in the desktop's
//    own three tones
//  · the 0% and 100% progress colourways, and the no-dates record
//  · pager, and BOTH empty states (nothing yet / no matches)
//  · the create dialog as a bottom sheet: required-field validation, the
//    segmented status picker with its three status dots, the paired date row
//  · a row-actions sheet: 6 tonal boxes, two disabled states driven by real
//    fixture data, one danger row
//
// What changes versus the desktop sheet, and why:
//  · The 2-up card grid becomes one column of row cards separated by a real
//    1.5px ink rule. A card grid at 320px is a column of tall boxes with three
//    stacked stat cells inside them; the row card puts the same six figures on
//    three lines and gets four records on screen instead of one and a half.
//  · The scope paragraph leaves the row and lands in the actions sheet head.
//    Ninety characters of description is three lines at 320px, and it changes no
//    decision while scanning — the same reason "updated" left the proposals and
//    clients rows.
//  · A search box is added: name, scope and status all answer it. It filters the
//    same fixture client-side, no new endpoint.
//  · The centre-screen create dialog becomes a bottom sheet (CLAUDE.md prefers
//    sheets, and there is no hover on touch).
//  · Page size: the desktop grid shows all six, this pages six.
//
// ── DATA (2026-08-13) ──────────────────────────────────────────────────────
// The demo fixture is GONE. The book is the org's real one, read through
// `listProjects()` — the desktop page's own query, org-scoped, ARCHIVED
// hidden — and every control writes through the same server actions the
// desktop sheet uses:
//   · New project      → createProject (plan-limit enforced, refusal surfaced)
//   · Mark completed   → updateProject { status: COMPLETED }
//   · Put on hold /
//     Resume project   → updateProject { status: ON_HOLD | ACTIVE }
//   · Archive project  → archiveProject (the row leaves the book, which is
//                        what the query's ARCHIVED exclusion means)
//   · Open / jobs /
//     schedule         → the real /dashboard/projects/<id> record
// The component is mounted PROPS-LESS by the responsive shell at ≤768px, so it
// reads the book itself on mount and re-reads it after every write rather than
// patching a local array — the server stays the single source of truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUILD_DEFAULTS, BUILD_QUESTIONS, buildAnswersFromStrings } from "@/lib/projectPhases/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { KIND_HINT, KIND_LABEL } from "@/lib/projectKind";
import { SPACES, parseSpace, type SpaceId } from "@/lib/projectSpaces";
import { ProjectSpacesHome, SpaceHeader, type SpaceOffer } from "@/components/v3/projects-blueprint/project-spaces";
import { spaceOfRow } from "@/components/v3/projects-blueprint/project-spaces-data";
import styles from "./mobile-projects.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { createClient } from "@/actions/clients";
import { archiveProject, createProject, listClosedProjectSpaceOffers, listProjectClients, listProjects, updateProject } from "@/actions/projects";
import {
  FILTERS,
  ISO_DATE,
  PAGE_SIZE,
  STATUSES,
  filterCount,
  fromISODate,
  matchesFilter,
  matchesQuery,
  progress,
  statusLabel,
  toISODate,
  windowLabel,
  type FilterKey,
  type Project,
} from "./projects-data";
import { projectFlags } from "@/components/v3/projects-blueprint/projects-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The project actions reject with an Error whose message is written for the
 *  user — the plan-limit refusal, the role refusal. Surface that text; fall
 *  back to a generic line for anything unrecognisable (a server-action
 *  transport failure carries no useful message). */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** Status → its badge tone class. The desktop's three tones, verbatim. */
const STATUS_CLASS: Record<string, string> = {
  ACTIVE: styles.pjsActive,
  ON_HOLD: styles.pjsOnHold,
  COMPLETED: styles.pjsCompleted,
};

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/* ============================================================
   DROPDOWN PLACEMENT (2026-08-15)

   The filter is a `.dd`: a `position: relative` wrapper holding a full-width
   button and a `position: absolute; top: 100%` menu. That geometry has one
   failure mode and this page hits it whenever the book under the bar is short
   or empty — the page is barely taller than the viewport, so there is nothing
   to scroll, and an absolutely positioned box does not lengthen the `.scroll`
   container it overflows. The menu was not merely below the fold; its lower
   half was unreachable.

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
};

/* ============================================================
   DATE FIELD — the house month grid, handheld edition.

   A native `<input type="date">` opens an OS panel CSS cannot reach, and it drew
   the SAME grey browser glyph on Starts and Ends, so the two fields were
   indistinguishable. Replacing the CONTROL is the only way to style the panel —
   the call the desktop dialog already made in shared/date-popover.ts. The wire
   format helpers come FROM that module rather than being re-derived here, so
   "YYYY-MM-DD" can never mean two different days on the two surfaces. See the
   `.dpk` block in the stylesheet for why this is a sibling and not an import of
   the whole control.
   ============================================================ */
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const LONG_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
/** Sunday-first, matching the calendar page's own grid. */
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Where the panel sits, in viewport coordinates. */
type PopAt = { left: number; top: number };

/**
 * The month grid itself, MOUNTED only while open.
 *
 * That is not an optimisation — it is what lets the panel seed its month from
 * the field's current value with a plain lazy `useState` initialiser. Keeping it
 * mounted and re-seeding on open would mean a setState inside an effect, which
 * is a cascading render (and the lint rule that says so).
 */
function DatePanel({
  hostRef,
  label,
  value,
  onCommit,
  onDismiss,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  onDismiss: () => void;
}) {
  const picked = fromISODate(value);
  const [month, setMonth] = useState(() => startOfMonth(picked ?? new Date()));
  const [at, setAt] = useState<PopAt | null>(null);

  /* Placed against the VISUAL viewport, and flipped above the field when there
     is not enough room under it — the panel is a fixed layer, so nothing else
     keeps it on screen. Re-run on scroll because `.sheetBody` scrolls under
     it. */
  const place = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewH = vv?.height ?? window.innerHeight;
    const viewW = vv?.width ?? window.innerWidth;
    const w = Math.min(300, viewW - 24);
    // 344px is the panel at its tallest: head + six week rows + the foot bar.
    const h = 344;
    const below = viewTop + viewH - r.bottom - 7 - 12;
    const flip = below < h && r.top - viewTop > below;
    setAt({
      left: Math.min(Math.max(12, r.left), viewW - w - 12),
      top: flip ? Math.max(12, r.top - 7 - h) : r.bottom + 7,
    });
  }, [hostRef]);

  useEffect(() => {
    place();
    const vv = window.visualViewport;
    // capture: the page scroller and the sheet body are both inner elements, so
    // a bubbling document listener would never see their scroll events.
    document.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    vv?.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
    };
  }, [place]);

  const commit = (d: Date | null) => onCommit(d ? toISODate(d) : "");

  const today = new Date();
  const first = startOfWeek(startOfMonth(month));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));

  return (
    <div className={styles.dpkLayer}>
      <div className={styles.dpkCatch} onClick={onDismiss} aria-hidden="true" />
      {at ? (
        <div
          className={styles.dpkPop}
          style={{ left: at.left, top: at.top }}
          role="dialog"
          aria-label={`${label} — calendar`}
        >
          <div className={styles.dpkCal}>
            <div className={styles.dpkHead}>
              <button
                className={styles.dpkNav}
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              >
                <Icon id="i-chevl" />
              </button>
              <span className={styles.dpkMonth}>{MONTH_YEAR.format(month)}</span>
              <button
                className={styles.dpkNav}
                type="button"
                aria-label="Next month"
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              >
                <Icon id="i-chevr" />
              </button>
            </div>
            <div className={styles.dpkDow} aria-hidden="true">
              {DOW.map((d, i) => (
                <span key={`${d}${i}`}>{d}</span>
              ))}
            </div>
            <div className={styles.dpkGrid}>
              {cells.map((d) => {
                const out = d.getMonth() !== month.getMonth();
                const isToday = sameDay(d, today);
                const isSel = Boolean(picked && sameDay(d, picked));
                return (
                  <button
                    key={toISODate(d)}
                    className={`${styles.dpkDay} ${out ? styles.dpkOut : ""} ${
                      isToday ? styles.dpkToday : ""
                    } ${isSel ? styles.dpkSel : ""}`}
                    type="button"
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSel}
                    onClick={() => commit(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.dpkFoot}>
            <span className={styles.dpkVal}>{picked ? LONG_DAY.format(picked) : "No date"}</span>
            <span className={styles.dpkActs}>
              <button className={styles.dpkAct} type="button" onClick={() => commit(new Date())}>
                Today
              </button>
              <button className={styles.dpkAct} type="button" onClick={() => commit(null)}>
                Clear
              </button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateField({
  id,
  icon,
  label,
  value,
  onChange,
  open,
  onOpenChange,
}: {
  id: string;
  icon: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`${styles.dpk} ${open ? styles.open : ""}`} ref={hostRef}>
      <span className={styles.dpkLead}>
        <Icon id={icon} />
      </span>
      {/* Still a real, typable input whose `.value` is the "YYYY-MM-DD" string
          `createProject` already reads — the grid writes it, it does not
          replace it. */}
      <input
        className={`${styles.pinput} ${styles.dpkIn}`}
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        autoComplete="off"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className={styles.dpkTgl}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} — pick a date`}
        onClick={() => onOpenChange(!open)}
      >
        <Icon id="i-chev" />
      </button>

      {open ? (
        <DatePanel
          hostRef={hostRef}
          label={label}
          value={value}
          onCommit={(v) => {
            onChange(v);
            onOpenChange(false);
          }}
          onDismiss={() => onOpenChange(false)}
        />
      ) : null}
    </div>
  );
}

export function MobileProjects() {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /* The org's book. `null` until the first read lands, which is what separates
     "still loading" from "this org has no projects" — the two must not draw the
     same screen. Every write re-reads rather than patching the array, so the
     row you just changed shows the database's answer, not the client's guess. */
  const [data, setData] = useState<Project[] | null>(null);
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);

  /* ---- new-project form ---- */
  const [form, setForm] = useState({ name: "", scope: "", starts: "", ends: "", budget: "" });
  // Whose project it is (2026-09-18). The list is fetched the first time the
  // sheet opens; a picked client names a still-blank project for them.
  const [clientChoices, setClientChoices] = useState<Array<{ id: string; name: string; street: string }> | null>(null);
  const [clientPick, setClientPick] = useState("");
  // "+ New client…" (2026-11-04): the client is made with the project.
  const [newClient, setNewClient] = useState({ name: "", phone: "" });
  const [clientErr, setClientErr] = useState(false);
  const nameAutoRef = useRef(false);
  const [draftStatus, setDraftStatus] = useState<string>(STATUSES[0]);
  // The kind and the remodel's question (2026-11-07, lib/projectKind).
  // The workspace (2026-11-09): `?space=`, read on every render so the drawer's links switch it in place. One the
  // plan doesn't hold (the new plans' Remodeler / Home Builder — lib/projectSpacesServer) has no card and no switch
  // link, and its address opens the chooser; the server refuses its work anyway. A Classic plan closes none.
  const [closedSpaces, setClosedSpaces] = useState<readonly SpaceId[]>([]);
  // Their tool and price, for the preview cards (owner, 2026-11-11: the closed workspaces stay as previews).
  const [spaceOffers, setSpaceOffers] = useState<Partial<Record<SpaceId, SpaceOffer>>>({});
  const askedSpace = parseSpace(useSearchParams().get("space"));
  const space = askedSpace && !closedSpaces.includes(askedSpace) ? askedSpace : null;
  const [draftKind, setDraftKind] = useState<"REMODEL" | "NEW_BUILD" | "JOB">("REMODEL");
  const [draftOccupied, setDraftOccupied] = useState(false);
  // A new build's start questions (part 4, lib/projectPhases): the picks by question; unsaid = the usual.
  const [draftBuild, setDraftBuild] = useState<Record<string, string>>({});
  // Who it is for and how the money is made (part 5): a new build for a client with one margin unless said.
  const [draftForWhom, setDraftForWhom] = useState<"CLIENT" | "SELF">("CLIENT");
  const [draftMode, setDraftMode] = useState<"PROJECT_MARGIN" | "JOB_MARGIN" | "COST_PLUS">("PROJECT_MARGIN");
  const [draftMargin, setDraftMargin] = useState("");
  const [draftSale, setDraftSale] = useState("");
  const [nameErr, setNameErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  /* Which schedule field owns the month grid, if any. One flag rather than two
     booleans: the two panels would otherwise overlap on a 390px sheet. */
  const [pickerFor, setPickerFor] = useState<"starts" | "ends" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /* The filter menu's placement AND the outside-tap closer share one node.
     `useAnchoredMenu` caps the panel at the room actually left under the trigger
     and flips it above when there is more room there — without it the menu hung
     off the bottom edge of the phone whenever the book was short, and an
     absolutely positioned box does not lengthen the scroller it overflows, so
     the lower half was unreachable rather than merely below the fold. */
  const filterRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  useMenuPlacement(filterOpen, filterRef, filterMenuRef);

  /* ---------- the book ---------------------------------------------------
     One read, shared by the first paint and by every write's follow-up. The
     action is org-scoped server-side; nothing here can widen it. */
  const applyBook = useCallback((rows: Project[]) => {
    setData(rows);
    setBookErr(null);
  }, []);
  const applyBookError = useCallback((err: unknown) => {
    setBookErr(actionError(err));
    // Land on the empty state rather than the loading state: a read that keeps
    // spinning forever reads as a hung page.
    setData((prev) => prev ?? []);
  }, []);

  /** The book, re-read. Both settlements land in a callback rather than in the
   *  caller's body, so the mount effect below is a subscription to the read
   *  rather than a synchronous state write. */
  const load = useCallback(
    () => listProjects().then(applyBook, applyBookError),
    [applyBook, applyBookError],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let live = true;
    void listClosedProjectSpaceOffers().then(
      (c) => {
        if (!live) return;
        setClosedSpaces(c.closed);
        setSpaceOffers(c.offers);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  /* ---------- viewport height ------------------------------------------
     Mandatory rule: viewport heights only via var(--app-h). A phone's URL bar
     changes innerHeight mid-scroll, so the real value is republished rather than
     trusting a bare 100vh/100dvh. This is the React form of the donor's FLUID
     SCALE module — no root zoom, since the composition here is already the
     handheld one. */
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
          // Below the fold: duration follows scroll speed — slow ≈ 900ms, fast
          // never shorter than 550ms.
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
      styles.btn, styles.ddBtn, styles.ddItem, styles.pagerBtn, styles.pmenuItem,
      styles.sheetCancel, styles.pjOpen, styles.pjemptyA, styles.srchX, styles.fsegBtn,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes whatever the PAGE owns, topmost first ----------
     The drawer is not listed: MobileNav handles its own Escape, and it only
     binds while open, so the two listeners cannot both claim one key press. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pickerFor) setPickerFor(null);
      else if (filterOpen) setFilterOpen(false);
      else if (newOpen) setNewOpen(false);
      else if (sheetId) setSheetId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, newOpen, sheetId, pickerFor]);

  /* ---------- Filter dropdown: close on outside tap -------------------- */
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
  }, [page]);

  /* ---------- The one blue flash on a record you just changed ----------- */
  useEffect(() => {
    if (!landedId) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => clearTimeout(t);
  }, [landedId]);

  /* ---------- derived ------------------------------------------------- */
  /** The loaded book, or an empty one while the first read is in flight. */
  const book = useMemo(() => (data ?? []).filter((p) => !space || spaceOfRow(p) === space), [data, space]);
  const loading = data === null;

  const visible = useMemo(
    () => book.filter((p) => matchesFilter(p, filter) && matchesQuery(p, query)),
    [book, filter, query],
  );

  /* Masthead: one numeral, a short mono kicker, EXACTLY two annotations — all
     three computed from the org's own records, so completing or archiving a
     project moves them. */
  const activeBudget = useMemo(
    () => book.reduce((a, p) => (p.status === "ACTIVE" ? a + p.budget : a), 0),
    [book],
  );
  const jobs = useMemo(
    () =>
      book.reduce(
        (a, p) => ({ done: a.done + p.completedJobs, total: a.total + p.jobCount }),
        { done: 0, total: 0 },
      ),
    [book],
  );

  const activeOption = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const sheetProject = sheetId === null ? null : (book.find((p) => p.id === sheetId) ?? null);

  const resetFilters = () => {
    setFilter("ALL");
    setQuery("");
    setPage(1);
  };

  /* ---------- the record ------------------------------------------------
     The one destination this surface has, and it is /dashboard/projects/<id>
     rather than /mobile-project-detail-v2/<id>. Both render the SAME handheld
     component, but only the dashboard route switches on viewport
     (project-detail-viewport-switch.tsx): a reader who opens a project on a
     phone gets the handheld build, and the same link opened on a laptop —
     shared, bookmarked, or the desktop half of this responsive surface — gets
     the desktop record instead of a phone layout stretched across 1440px. The
     mobile-* route is the direct-review door, always mobile at any width.
     Reached from the card itself and from the sheet's first two rows — the
     same door, three handles. */
  const openRecord = useCallback(
    (id: string, view?: "calendar") =>
      // Two whole literals rather than one with the query spliced in: typed
      // routes match the template against the route manifest, and a segment
      // assembled from a variable is not a literal it can match.
      view
        ? router.push(`/dashboard/projects/${id}?view=${view}`)
        : router.push(`/dashboard/projects/${id}`),
    [router],
  );

  /* ---------- row sheet ------------------------------------------------ */
  const menuRows = useMemo<MenuRow[]>(() => {
    const p = sheetProject;
    if (!p) return [];
    const done = p.status === "COMPLETED";
    const held = p.status === "ON_HOLD";
    const scheduled = Boolean(p.startsAt && p.endsAt);
    const busy = busyId === p.id;
    return [
      { act: "open", icon: "i-folder", tone: styles.pmiBp, title: "Open project",
        sub: "Jobs, budget and timeline" },
      { act: "jobs", icon: "i-jobs", tone: styles.pmiSky, title: "View jobs",
        sub: p.jobCount ? `${p.jobCount} jobs · ${p.completedJobs} complete` : "No jobs attached yet",
        disabled: p.jobCount === 0 },
      { act: "sched", icon: "i-cal", tone: styles.pmiWarn, title: "Open schedule",
        sub: scheduled ? `${p.startsAt} → ${p.endsAt}` : "No dates set on project",
        disabled: !scheduled },
      { act: "done", icon: "i-check", tone: styles.pmiOk,
        title: done ? "Already filed" : "Mark completed",
        // Honest: the action moves the PROJECT's status. It does not close out
        // the attached jobs — nothing in the data layer does that in one call.
        sub: done ? `Closed out ${p.endsAt ?? "—"}` : "Files the project as complete",
        disabled: done || busy },
      { act: "hold", icon: "i-rotate",
        title: held ? "Resume project" : "Put on hold",
        // Status only, and the copy says so — nothing downstream is paused or
        // rescheduled by this write.
        sub: held ? "Sets the status back to active" : "Marks the status on hold",
        disabled: busy },
      // `archiveProject`, not a delete: the book's query hides ARCHIVED, so the
      // row leaves this list — and the label says what actually happens rather
      // than promising a destroy the data layer never performs.
      { act: "archive", icon: "i-trash", tone: styles.pmiDanger, title: "Archive project",
        sub: "Files it away and hides it from this book", danger: true, disabled: busy },
    ];
  }, [sheetProject, busyId]);

  const runMenu = useCallback(
    async (act: string) => {
      const p = sheetProject;
      setSheetId(null);
      if (!p) return;

      // Navigation — the real record page. The detail surface reads `view`, so
      // the schedule row lands on the schedule rather than on the jobs list.
      if (act === "open" || act === "jobs") {
        openRecord(p.id);
        return;
      }
      if (act === "sched") {
        openRecord(p.id, "calendar");
        return;
      }

      setBusyId(p.id);
      setBookErr(null);
      try {
        if (act === "archive") {
          await archiveProject(p.id);
          setPage(1);
        } else if (act === "done") {
          await updateProject({ id: p.id, status: "COMPLETED" });
        } else if (act === "hold") {
          await updateProject({ id: p.id, status: p.status === "ON_HOLD" ? "ACTIVE" : "ON_HOLD" });
        }
        await load();
        if (act !== "archive") setLandedId(p.id);
      } catch (err) {
        setBookErr(actionError(err));
      } finally {
        setBusyId(null);
      }
    },
    [sheetProject, openRecord, load],
  );

  /* ---------- new-project form ----------------------------------------- */
  const openNew = () => {
    setForm({ name: "", scope: "", starts: "", ends: "", budget: "" });
    setClientPick("");
    setNewClient({ name: "", phone: "" });
    setClientErr(false);
    nameAutoRef.current = false;
    if (!clientChoices) void listProjectClients().then(setClientChoices).catch(() => setClientChoices([]));
    setDraftStatus(STATUSES[0]);
    setDraftKind(space ? SPACES[space].kind : "REMODEL");
    setDraftOccupied(false);
    setDraftBuild({});
    setDraftForWhom("CLIENT");
    setDraftMode("PROJECT_MARGIN");
    setDraftMargin("");
    setDraftSale("");
    setNameErr(false);
    setSaveErr(null);
    setPickerFor(null);
    setNewOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the keyboard
    // fight the animation.
    window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  /** Every dismissal of the new-project sheet runs through here: the month grid
   *  is a FIXED layer, so a sheet closed out from under an open picker would
   *  leave the panel floating over the book. */
  const closeNew = useCallback(() => {
    setPickerFor(null);
    setNewOpen(false);
  }, []);

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }
    const making = clientPick === "__new";
    if (making && !newClient.name.trim()) {
      setClientErr(true);
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      let clientId = making ? null : clientPick || null;
      if (making) {
        const made = await createClient({ name: newClient.name.trim(), phone: newClient.phone.trim() || undefined });
        clientId = made.id;
        // Picked from now on, so a refused project does not make the client twice on the second press.
        setClientChoices((list) => [{ id: made.id, name: made.name, street: "" }, ...(list ?? [])]);
        setClientPick(made.id);
      }
      // The action's schema coerces the dates; the month grid writes the same
      // "YYYY-MM-DD" the native control produced, read as UTC midnight —
      // exactly what `listProjects` formats back for the row plates.
      const res = await createProject({
        name,
        description: form.scope.trim() || null,
        status: draftStatus,
        kind: draftKind,
        occupied: draftKind === "REMODEL" && draftOccupied,
        build: draftKind === "NEW_BUILD" ? buildAnswersFromStrings(Object.fromEntries(BUILD_QUESTIONS.map((q) => [q.key, draftBuild[q.key] ?? String(BUILD_DEFAULTS[q.key])]))) : undefined,
        ...(draftKind === "NEW_BUILD"
          ? {
              forWhom: draftForWhom,
              moneyMode: draftForWhom === "SELF" ? "NONE" : draftMode,
              marginPct: draftForWhom === "CLIENT" && draftMargin.trim() ? Number(draftMargin.replace(/[^\d.]/g, "")) || null : null,
              salePrice: draftForWhom === "SELF" && draftSale.trim() ? Number(draftSale.replace(/[^\d.]/g, "")) || null : null,
            }
          : {}),
        startsAt: ISO_DATE.test(form.starts) ? form.starts : null,
        endsAt: ISO_DATE.test(form.ends) ? form.ends : null,
        budget: Math.round(Number(form.budget.replace(/[^\d.]/g, "")) || 0),
        clientId,
      });
      await load();
      // Drop back to All, so a project created while a filter was active is
      // actually visible — it lands first, the book being ordered by updatedAt.
      resetFilters();
      closeNew();
      setLandedId(res.id);
    } catch (err) {
      // The plan-limit refusal and the role refusal are both written for the
      // user; the sheet stays open carrying what they typed.
      setSaveErr(actionError(err));
    } finally {
      setSaving(false);
    }
  };

  const anyOverlay = Boolean(sheetProject) || newOpen;

  // Swipe-down dismissal, one gesture per sheet, on the same setters the
  // Escape ladder uses.
  const actionsDrag = useSheetDrag(Boolean(sheetProject), () => setSheetId(null));
  const newDrag = useSheetDrag(newOpen, closeNew);

  return (
    <div className={styles.app} onClick={onRootClick}>

      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, so the page holds none. */}
      <MobileNav />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* THE WORKSPACES (2026-11-09, lib/projectSpaces): none chosen opens the three cards; one chosen, its own
              header and road, and the book is its projects. */}
          {!space ? <ProjectSpacesHome rows={data ?? []} closed={closedSpaces} offers={spaceOffers} /> : null}
          {space ? (
            <>
          <SpaceHeader
            space={space}
            closed={closedSpaces}
            rows={data ?? []}
            actions={
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={openNew} style={{ background: SPACES[space].color, borderColor: SPACES[space].color }}>
                <Icon id="i-plus" />New {SPACES[space].one}
              </button>
            }
          />

          {/* MASTHEAD */}
          <div className={styles.pmast}>
            <div className={styles.pmastTop}>
              <div className={styles.pmastLbl}>
                Active budget
                <span className={styles.pmastRule} />
              </div>
              <CountUp value={activeBudget} className={styles.pmastVal} />
            </div>
            <div className={styles.pmastCnt}>
              <div className={styles.pmastSub}>
                <div className={styles.pmastSubL}>Projects</div>
                <div className={styles.pmastSubV}>{book.length}</div>
              </div>
              <div className={styles.pmastSub}>
                <div className={styles.pmastSubL}>Jobs done</div>
                <div className={styles.pmastSubV}>{jobs.done} / {jobs.total}</div>
              </div>
            </div>
          </div>

          {/* FIND BAR — search + status filter */}
          <div className={styles.find}>
            <label className={styles.srch}>
              <Icon id="i-search" />
              <input
                className={styles.srchInput}
                type="search"
                value={query}
                placeholder="Search name, scope or status…"
                autoComplete="off"
                aria-label="Search projects"
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

            <div className={`${styles.dd} ${filterOpen ? styles.open : ""}`} ref={filterRef}>
              <button className={styles.ddBtn} type="button" aria-haspopup="listbox"
                aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>
                <Icon id="i-filter" />
                Filter
                <span className={styles.ddValue} data-f={filter}>
                  {activeOption.label} · {filterCount(book, filter)}
                </span>
                <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
              </button>
              <div className={styles.ddMenu} role="listbox" ref={filterMenuRef}>
                {FILTERS.map((f) => (
                  <button key={f.key} className={`${styles.ddItem} ${filter === f.key ? styles.active : ""}`}
                    type="button" role="option" aria-selected={filter === f.key}
                    onClick={() => { setFilter(f.key); setPage(1); setFilterOpen(false); }}>
                    {f.label}
                    <span className={styles.ddCount}>{filterCount(book, f.key)}</span>
                    {filter === f.key ? <Icon id="i-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* A refused or failed read/write says so here rather than leaving
              the book silently stale. */}
          {bookErr ? (
            <div className={styles.bookErr} role="alert">
              {bookErr}
            </div>
          ) : null}

          {/* PROJECT LIST */}
          {loading ? (
            <div className={styles.pjempty}>
              <div className={styles.pjemptyT}>Reading the book</div>
              <div className={styles.pjemptyS}>Fetching your projects…</div>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.pjempty}>
              {book.length === 0 ? (
                <>
                  <div className={styles.pjemptyT}>No projects yet</div>
                  <div className={styles.pjemptyS}>
                    Bundle related jobs together to track multi-phase builds and shared budgets.
                  </div>
                  <button className={styles.pjemptyA} type="button" onClick={openNew}>
                    <Icon id="i-plus" />New project
                  </button>
                </>
              ) : (
                <>
                  <div className={styles.pjemptyT}>No matches</div>
                  <div className={styles.pjemptyS}>No project matches that search and filter.</div>
                  <button className={styles.pjemptyA} type="button" onClick={resetFilters}>
                    <Icon id="i-x" />Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.book}>
              {slice.map((p, i) => {
                const pct = progress(p);
                const done = pct >= 100;
                /* --pw / --pd drive the progress rule: the fill is drawn from
                   zero after the row has landed. Custom properties inherit, so
                   declaring them on the row reaches the fill inside it. */
                const rowStyle = {
                  animationDelay: `${i * 45}ms`,
                  "--pw": `${pct}%`,
                  "--pd": `${i * 45 + 140}ms`,
                } as React.CSSProperties;
                return (
                  <div
                    key={p.id}
                    className={`${styles.pjrow} ${styles.rowIn} ${landedId === p.id ? styles.landed : ""}`}
                    style={rowStyle}
                    /* THE CARD IS THE DOOR. It was inert: the only tap target
                       on a row was the ⋮ button, so a reader who tapped the
                       project — which is what a row-shaped object asks for —
                       got nothing, and the record was two taps and a menu
                       away. `role`/`tabIndex`/`onKeyDown` rather than a
                       <button>: the row already contains one, and a button
                       inside a button is invalid HTML that Safari resolves by
                       dropping one of them. Same treatment as the clients
                       book's .crow. */
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${p.name}`}
                    onClick={() => openRecord(p.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      openRecord(p.id);
                    }}
                  >
                    {/* Row 1 — the drawing annotation (delivery window + job
                        tally) as a KICKER over the name. DOM order follows the
                        visual order so a screen reader hears the dateline
                        before the project it belongs to, same as the eye. */}
                    <div className={styles.pjMeta}>{windowLabel(p)}</div>
                    {/* Row 2 — identity, actions hard right */}
                    <div className={styles.pjName}>
                      {p.name}
                      {p.clientName ? <span className={styles.pjClient}>{p.clientName}</span> : null}
                    </div>
                    {/* `stopPropagation`: the ⋮ sits inside the card's own tap
                        target, and without it opening the menu would also open
                        the record underneath it. */}
                    <button className={styles.pjOpen} type="button"
                      aria-label={`Actions for ${p.name}`}
                      onClick={(e) => { e.stopPropagation(); setSheetId(p.id); }}>
                      <Icon id="i-dots" />
                    </button>
                    {/* Row 3 — badge leads, the figures close at the far right */}
                    <div className={styles.pjFoot}>
                      <span className={`${styles.pjstatus} ${STATUS_CLASS[p.status] ?? ""}`}>
                        {statusLabel(p.status)}
                      </span>
                      {p.kind === "NEW_BUILD" ? <span className={styles.pjKind}>New build</span> : null}
                      <span className={styles.pjFigs}>
                        <span className={`${styles.pjPct} ${done ? styles.isDone : ""}`}>{p.jobCount ? `${p.completedJobs}/${p.jobCount} jobs` : "no jobs"}</span>
                        <span className={`${styles.pjMoney} ${(p.sold ?? 0) > 0 ? "" : styles.isZero}`}>
                          {(p.sold ?? 0) > 0 ? money(p.sold ?? 0) : "—"}
                        </span>
                      </span>
                    </div>
                    {/* Row 3b — the money behind the row (2026-09-20): what is
                        sold, what is spent against what was budgeted, and any
                        flag the project page would raise. */}
                    <div className={styles.pjFacts}>
                      <span>
                        {p.budget > 0
                          ? `Spent ${money(p.spent ?? 0)} of ${money(p.budget)}`
                          : (p.spent ?? 0) > 0
                            ? `Spent ${money(p.spent ?? 0)} · no budget`
                            : "No budget set"}
                      </span>
                      {projectFlags(p).map((f) => (
                        <span key={`${f.kind}:${f.text}`} className={`${styles.pjFlag} ${styles["pjFlag_" + f.kind]}`}>
                          {f.text}
                        </span>
                      ))}
                    </div>
                    {/* Row 4 — the progress rule. A drawn line, not a fourth
                        text line: it belongs to the figures above it. */}
                    <div className={styles.pjTrack}>
                      <span className={`${styles.pjFill} ${done ? styles.isDone : ""}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* PAGER */}
          {visible.length > PAGE_SIZE ? (
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
            </>
          ) : null}
        </div>
      </main>

      {/* No floating action button: the primary action lives in the page head,
          so nothing needs to hover over the content. */}

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => {
          setSheetId(null);
          if (!saving) closeNew();
        }}
        aria-hidden="true"
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div className={`${styles.sheet} ${sheetProject ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Project actions" aria-hidden={!sheetProject} {...actionsDrag.sheetProps}>
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetProject
              ? `${statusLabel(sheetProject.status)} · ${sheetProject.jobCount} jobs · ${sheetProject.budget ? money(sheetProject.budget) : "no budget set"}`
              : "Project · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetProject?.name ?? "Actions"}</div>
          {/* The desktop card's scope paragraph lives here rather than on the
              row. One record has none, so the absence has its own line. */}
          <div className={styles.sheetSub}>
            {sheetProject?.description ?? "No scope noted on this project."}
          </div>
        </div>
        <div className={styles.sheetBody}>
          {menuRows.map((r) => (
            <button key={r.act} type="button" disabled={r.disabled}
              className={`${styles.pmenuItem} ${r.danger ? styles.pmenuItemDanger : ""}`}
              onClick={() => {
                void runMenu(r.act);
              }}>
              <span className={`${styles.pmiIc} ${r.tone ?? ""}`}><Icon id={r.icon} /></span>
              <span>
                <span className={styles.pmenuItemT}>{r.title}</span>
                <span className={styles.pmenuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetId(null)}>Cancel</button>
      </div>

      {/* ============ NEW PROJECT SHEET ============ */}
      <div className={`${styles.sheet} ${newOpen ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="mpNewTitle" aria-hidden={!newOpen} {...newDrag.sheetProps}>
        <div className={styles.sheetGrab} {...newDrag.handleProps} />
        <div className={styles.sheetHead} {...newDrag.handleProps}>
          <div className={styles.sheetKicker}>Delivery / new record</div>
          <div className={styles.sheetTitle} id="mpNewTitle">New project</div>
        </div>
        <form
          className={`${styles.sheetBody} ${styles.formBody}`}
          id="mpNewForm"
          noValidate
          onSubmit={(e) => {
            void submitNew(e);
          }}
        >
          {/* The server action's own refusal text — the plan-limit message and
              the role refusal are both written for the user. */}
          {saveErr ? (
            <div className={styles.bookErr} role="alert">
              {saveErr}
            </div>
          ) : null}

          {/* THE KIND (2026-11-07): a remodel or a new build; a remodel asks whether the client lives there. */}
          <div className={styles.fld} style={space ? { display: "none" } : undefined}>
            <span className={styles.fldLbl}>What kind of project</span>
            <div className={styles.fseg} role="group" aria-label="Project kind" data-kind-seg>
              {(["REMODEL", "NEW_BUILD", "JOB"] as const).map((k) => (
                <button key={k} className={`${styles.fsegBtn} ${draftKind === k ? styles.on : ""}`} type="button" data-v={k} aria-pressed={draftKind === k} onClick={() => setDraftKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <span className={styles.fldHint}>{KIND_HINT[draftKind]}</span>
          </div>
          {draftKind === "NEW_BUILD" ? (
            <div className={styles.fld} data-money-seg>
              <span className={styles.fldLbl}>Who is it for</span>
              <div className={styles.fseg} role="group" aria-label="Who the project is for">
                {(["CLIENT", "SELF"] as const).map((w) => (
                  <button key={w} className={`${styles.fsegBtn} ${draftForWhom === w ? styles.on : ""}`} type="button" data-v={w} aria-pressed={draftForWhom === w} onClick={() => setDraftForWhom(w)}>
                    {w === "CLIENT" ? "For a client" : "For myself"}
                  </button>
                ))}
              </div>
              <span className={styles.fldHint}>{draftForWhom === "SELF" ? "A spec house, your own home, a flip: one budget from the land to the keys, no margin." : "The client has a budget; you earn a margin or a fee on the work."}</span>
              {draftForWhom === "CLIENT" ? (
                <div style={{ marginTop: 8 }}>
                  <span className={styles.fldHint} style={{ marginTop: 0 }}>How you earn</span>
                  <div className={styles.fseg} role="group" aria-label="How the money is made">
                    {(["PROJECT_MARGIN", "JOB_MARGIN", "COST_PLUS"] as const).map((m) => (
                      <button key={m} className={`${styles.fsegBtn} ${draftMode === m ? styles.on : ""}`} type="button" data-v={m} aria-pressed={draftMode === m} onClick={() => setDraftMode(m)}>
                        {m === "PROJECT_MARGIN" ? "One margin" : m === "JOB_MARGIN" ? "Per job" : "Cost-plus"}
                      </button>
                    ))}
                  </div>
                  <label className={styles.fldHint} htmlFor="mpMargin" style={{ display: "block", marginTop: 8 }}>{draftMode === "COST_PLUS" ? "Fee, percent of cost" : "Margin, percent of cost"}</label>
                  <input className={styles.pinput} id="mpMargin" type="text" inputMode="decimal" placeholder="18" autoComplete="off" value={draftMargin} onChange={(e) => setDraftMargin(e.target.value)} style={{ maxWidth: 140 }} />
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <label className={styles.fldHint} htmlFor="mpSale" style={{ display: "block", marginTop: 0 }}>Sale price ($, optional)</label>
                  <input className={styles.pinput} id="mpSale" type="text" inputMode="numeric" placeholder="780,000" autoComplete="off" value={draftSale} onChange={(e) => setDraftSale(e.target.value)} style={{ maxWidth: 200 }} />
                </div>
              )}
            </div>
          ) : null}
          {draftKind === "NEW_BUILD" ? (
            <div className={styles.fld} data-build-seg>
              <span className={styles.fldLbl}>About the lot and the house</span>
              {BUILD_QUESTIONS.map((q) => (
                <div key={q.key} data-build={q.key} style={{ marginTop: 8 }}>
                  <span className={styles.fldHint} style={{ marginTop: 0 }}>{q.ask}</span>
                  <div className={styles.fseg} role="group" aria-label={q.ask}>
                    {q.choices.map((c) => {
                      const v = String(c.v);
                      const on = (draftBuild[q.key] ?? String(BUILD_DEFAULTS[q.key])) === v;
                      return (
                        <button key={v} className={`${styles.fsegBtn} ${on ? styles.on : ""}`} type="button" data-v={v} aria-pressed={on} onClick={() => setDraftBuild((cur) => ({ ...cur, [q.key]: v }))}>
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {draftKind === "REMODEL" ? (
            <div className={styles.fld}>
              <span className={styles.fldLbl}>Does the client live there during the work?</span>
              <div className={styles.fseg} role="group" aria-label="Lives there during the work" data-occupied-seg>
                <button className={`${styles.fsegBtn} ${draftOccupied ? styles.on : ""}`} type="button" data-v="yes" aria-pressed={draftOccupied} onClick={() => setDraftOccupied(true)}>
                  Yes
                </button>
                <button className={`${styles.fsegBtn} ${!draftOccupied ? styles.on : ""}`} type="button" data-v="no" aria-pressed={!draftOccupied} onClick={() => setDraftOccupied(false)}>
                  No
                </button>
              </div>
            </div>
          ) : null}

          <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mpName">
              Project name<span className={styles.req}>*</span>
            </label>
            <input ref={nameRef} className={styles.pinput} id="mpName" name="name" type="text"
              placeholder="Willow Park fencing" autoComplete="off" value={form.name}
              aria-invalid={nameErr} aria-describedby={nameErr ? "mpNameErr" : undefined}
              onChange={(e) => {
                nameAutoRef.current = false;
                setForm((f) => ({ ...f, name: e.target.value }));
                if (e.target.value.trim()) setNameErr(false);
              }} />
            {nameErr ? <span className={styles.fldErr} id="mpNameErr">Enter a project name</span> : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mpClient">Client</label>
            <select className={styles.pinput} id="mpClient" name="clientId" value={clientPick}
              onChange={(e) => {
                const id = e.target.value;
                setClientPick(id);
                const c = clientChoices?.find((x) => x.id === id);
                // Name a blank project for the client and the street; never
                // overwrite a name the contractor typed.
                setForm((f) => {
                  if (!c) return nameAutoRef.current ? { ...f, name: "" } : f;
                  if (f.name.trim() && !nameAutoRef.current) return f;
                  nameAutoRef.current = true;
                  return { ...f, name: c.street ? `${c.name} — ${c.street}` : c.name };
                });
                if (c) setNameErr(false);
              }}>
              <option value="">{clientChoices ? "No client" : "Loading clients…"}</option>
              <option value="__new">+ New client…</option>
              {(clientChoices ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.street ? ` — ${c.street}` : ""}
                </option>
              ))}
            </select>
            {clientPick === "__new" ? (
              <>
                <input className={`${styles.pinput} ${styles.fldMore}`} id="mpClientName" type="text" placeholder="Client name"
                  autoComplete="off" aria-label="New client's name" value={newClient.name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewClient((c) => ({ ...c, name: v }));
                    if (v.trim()) setClientErr(false);
                    setForm((f) => {
                      if (f.name.trim() && !nameAutoRef.current) return f;
                      nameAutoRef.current = !!v.trim();
                      return { ...f, name: v.trim() };
                    });
                  }} />
                <input className={`${styles.pinput} ${styles.fldMore}`} id="mpClientPhone" type="tel" inputMode="tel" placeholder="Phone (optional)"
                  autoComplete="off" aria-label="New client's phone" value={newClient.phone}
                  onChange={(e) => setNewClient((c) => ({ ...c, phone: e.target.value }))} />
                {clientErr ? <span className={styles.fldErr}>Enter the client&apos;s name</span> : null}
              </>
            ) : null}
            <span className={styles.fldHint}>Its proposals can join the project from the project page.</span>
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mpScope">Scope</label>
            <textarea className={`${styles.pinput} ${styles.ptextarea}`} id="mpScope" name="scope"
              placeholder="Cedar privacy fencing for eight lots, shared materials drop."
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} />
            <span className={styles.fldHint}>
              Shown when you open the project&apos;s actions, not on the list row.
            </span>
          </div>

          <div className={styles.fld}>
            <span className={styles.fldLbl}>Status</span>
            <div className={styles.fseg} role="group" aria-label="Project status">
              {STATUSES.map((s) => (
                <button key={s} className={`${styles.fsegBtn} ${draftStatus === s ? styles.on : ""}`}
                  type="button" data-v={s} aria-pressed={draftStatus === s}
                  onClick={() => setDraftStatus(s)}>
                  <span className={styles.fsegDot} />
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule. The native date control is gone: it opened an OS panel no
              stylesheet can reach and drew the SAME browser glyph on both
              fields, so Starts and Ends looked identical. Each now carries the
              calendar page's own pairing — a clock on the start, an hourglass on
              the end — and the blueprint month grid. One picker open at a time:
              two panels over a 390px sheet is two panels overlapping. */}
          <div className={styles.mdlRow}>
            <div className={styles.fld}>
              <label className={styles.fldLbl} htmlFor="mpStart">Starts</label>
              <DateField
                id="mpStart"
                icon="i-clock"
                label="Starts"
                value={form.starts}
                onChange={(v) => setForm((f) => ({ ...f, starts: v }))}
                open={pickerFor === "starts"}
                onOpenChange={(o) => setPickerFor(o ? "starts" : null)}
              />
            </div>
            <div className={styles.fld}>
              <label className={styles.fldLbl} htmlFor="mpEnd">Ends</label>
              <DateField
                id="mpEnd"
                icon="i-hourglass"
                label="Ends"
                value={form.ends}
                onChange={(v) => setForm((f) => ({ ...f, ends: v }))}
                open={pickerFor === "ends"}
                onOpenChange={(o) => setPickerFor(o ? "ends" : null)}
              />
            </div>
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mpBudget">Cost budget</label>
            <input className={styles.pinput} id="mpBudget" name="budget" type="text"
              inputMode="numeric" placeholder="74,300" autoComplete="off" value={form.budget}
              onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
            <span className={styles.fldHint}>What the work should cost you — materials, labor, subs. Not the client&apos;s price: that comes from the proposals.</span>
          </div>
        </form>
        <div className={styles.formFoot}>
          {/* A write already on the wire must not be cancelled out from under
              itself, and must not be sent twice. */}
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button" disabled={saving}
            onClick={closeNew}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" form="mpNewForm"
            disabled={saving}>
            <Icon id="i-check" />{saving ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* The SVG sprite is the shared one — <MobileNav /> renders it, and this page
   references only ids that already exist there: i-plus, i-search, i-x, i-filter,
   i-chev, i-check, i-dots, i-chevl, i-chevr, i-folder, i-jobs, i-cal, i-rotate,
   i-trash. No page-local symbols were needed. */
