"use client";

// MOBILE CALENDAR (mobile-calendar-v2) — Blueprint system, handheld build.
//
// Tokens, palette, type scale, status tones and Motion System "Balanced" are
// the reference dashboard's; the shell (topbar / hamburger drawer / bottom
// sheets) is the shared <MobileNav /> that mobile-v2, mobile-proposals-v2 and
// mobile-clients-v2 already use, so the four handheld surfaces are one product.
//
// Every region / view / variant of the desktop calendar sheet is covered:
//  · Delivery head + the New-event action + the crew-inbox action with its badge
//  · 3 view tabs (Month / Week / Team) with live counts + sliding rule
//  · the toolbar: prev / next / Today / range title, plus the tray badge
//  · search + the worker dropdown + the four status toggles, as ONE dropdown
//  · MONTH: the 6×7 grid — today filled blueprint, selected day inset, out-of-
//    month faded, status dots, "+N" past three — plus the selected day's agenda
//  · WEEK: a swipe rail — one day per full-width panel, its events as rows
//  · TEAM: a swipe rail — one crew member per panel, their week as rows
//  · the desktop event chip re-cut as a row card (time plate / title / actions,
//    who-where in mono, status badge + crew + duration)
//  · a tap on a row opens the EVENT DETAIL sheet; the "⋮" opens the actions
//    sheet: 6 tonal rows, three ways to reach a disabled row, one danger row
//  · the create AND edit forms as a bottom sheet: kind tabs, required-field
//    validation, all-day switch, status segments, the searchable crew picker,
//    the kind-aware link-a-record picker, and the meta read-out on an existing
//    event
//  · the crew-confirmation inbox and the unscheduled tray as sheets
//  · BOTH empty states (nothing scheduled / no matches) in all three views
//
// What changes versus the desktop sheet, and why:
//  · The week TIME GRID (8 columns × 14 one-hour rows) and the team GRID
//    (crew × 7 days) are the two things a 320px viewport cannot hold, and
//    hiding columns is not allowed. Columns side by side on a phone are ~45px
//    of unreadable slivers, so BOTH become scroll-snap rails: one column per
//    swipe, full width, its events read as ROWS. Nothing is dropped — the same
//    events, the same days, one panel at a time.
//  · No aggregate masthead. "59 booked hours / 14 events" is a number nobody
//    acts on standing in a driveway, and it sat between the page title and the
//    schedule itself (owner's call, 2026-07-30). The tab counts still carry how
//    much is in each range, and Team still carries per-crew load.
//  · Drag-and-drop is gone; there is no drag on a touch surface worth
//    defending. Its two jobs are now explicit: "Push to tomorrow" in the
//    actions sheet reschedules, and the tray's "Schedule" opens the create form
//    pre-filled with that job on the selected day.
//  · The two desktop filter controls become ONE dropdown (house rule), and
//    single-select: a 320px face can show one value and one count, not "2
//    selected" plus a chip rail.
//  · Date and time are HOUSE panels, not the native inputs. Those opened an OS
//    sheet no stylesheet can reach — no ink frame, no mono numerals, and a
//    Material clock dial on Android in the middle of a blueprint form. The date
//    grid is mobile-projects-v2's control ported over; the clock is its sibling.
//  · No pager: prev / next / Today IS a calendar's pager, and a range is
//    already a page.
//
// Content is the ORG'S REAL CALENDAR. The component takes a `data` book from
// the standalone page's server read, and when it is mounted PROPS-LESS by
// ResponsiveDashboardShell on /dashboard/calendar it asks the read-only
// `getCalendarSeed` action for the same one — the pattern
// mobile-v2/mobile-dashboard.tsx set.
//
// WRITES — where the line currently sits (2026-08-15):
//  · CREATE is REAL. The form calls the same three guarded actions the desktop
//    sheet calls (`createJobEvent` / `createAppointment` / `createBlockedTime`,
//    plus `assignWorker` per crew member) and pushes the row the server returned,
//    carrying its `rid`. A booking made on a phone survives a reload.
//  · EDIT, complete, push-to-tomorrow and delete are STILL LOCAL to the mount.
//    Each needs its own update/delete action plus assignment diffing; they are
//    honest previews of the interaction until then, not writes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import styles from "./mobile-calendar.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { SmartBookRequests } from "@/components/v3/smartbook/smartbook-requests";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { getCalendarSeed } from "@/app/dashboard/calendar/calendar-actions";
import {
  createJobEvent,
  deleteJobEvent,
  rescheduleJobEventTime,
  updateJob,
  updateJobEvent,
} from "@/actions/jobs";
import {
  createAppointment,
  deleteAppointment,
  rescheduleAppointment,
  updateAppointment,
} from "@/actions/appointments";
import {
  createBlockedTime,
  deleteBlockedTime,
  rescheduleBlockedTime,
} from "@/actions/blockedTime";
import { assignWorker, markAssignmentAccepted, unassignWorker } from "@/actions/workers";
import { markNavSeen } from "@/actions/notifications";
import { VISIT_VIA } from "@/lib/calendar/visitVia";
import { expandWindows, spanWords, zonedHhmm, zonedYmd } from "@/lib/deskHours";
import { removeDeskHours, reserveDeskHours } from "@/actions/deskHours";
import { MobileJobOffers } from "@/app/(mobile)/mobile-jobs-v2/mobile-jobs";
import {
  ALL,
  DOW,
  DOW1,
  JOB_STATUSES,
  KIND_IC,
  KIND_LABEL,
  LINK_FIELD_LABEL,
  LINK_LABEL,
  LINK_OPTIONS,
  LINK_TABS,
  MG_CAP,
  OWNER,
  TODAY,
  VIEWS,
  addDays,
  addMin,
  atMins,
  byStart,
  crewLabel,
  durLabel,
  eventHours,
  filterCount,
  filterOptions,
  installCalendarBook,
  fmtDate,
  fmtDayShort,
  fmtClock,
  fmtMeridiem,
  fmtMins,
  fmtMonthYear,
  fmtRange,
  fmtWeekRange,
  fromDateInput,
  fromTimeInput,
  initials,
  linkPayload,
  matchesFilter,
  matchesQuery,
  minsToTimeInput,
  sameDay,
  sameMonth,
  startOfWeek,
  toDateInput,
  toTimeInput,
  toneKey,
  toneLabel,
  fromInputs,
  whoWhere,
  workerName,
  workersData,
  type CalendarBook,
  type CalEvent,
  type CalKind,
  type InboxItem,
  type LinkKind,
  type TrayJob,
  type ViewKey,
} from "./calendar-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
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

/** The three status tones plus the two kind tones — badges and dots share them. */
const TONE_BADGE: Record<string, string> = {
  scheduled: styles.stSched,
  in_progress: styles.stProg,
  completed: styles.stDone,
  canceled: styles.stCancel,
  appt: styles.stAppt,
  blocked: styles.stBlocked,
  desk: styles.stDesk,
};
const TONE_DOT: Record<string, string> = {
  scheduled: styles.dotSched,
  in_progress: styles.dotProg,
  completed: styles.dotDone,
  canceled: styles.dotCancel,
  appt: styles.dotAppt,
  blocked: styles.dotBlocked,
  desk: styles.dotDesk,
};

/**
 * ONE row card, shared by all three views — the desktop event chip re-cut.
 * A chip carried kind, title, time, crew and status inside a ~120px box; these
 * three lines carry all five plus the client and the address.
 *
 * `showDay` is for the Team rail only: its panel is a crew member, so a row can
 * be any day of the week and the plate has to name which. Month and Week panels
 * are already one day, so there it would be the same word on every row.
 *
 * Declared at module scope, not inside MobileCalendar: a component created
 * during render is a NEW type on every keystroke, so React unmounts and
 * remounts every row — which would restart the row's entrance animation each
 * time the search box changed.
 */
function EventRow({
  e, i, landed, showDay, onOpen, onSelect,
}: {
  e: CalEvent; i: number; landed: boolean; showDay?: boolean;
  onOpen: (id: string) => void; onSelect: (id: string) => void;
}) {
  const tone = toneKey(e);
  const today = sameDay(e.start, TODAY);
  // Blocked time is the one kind that is a REFUSAL — nobody can work this slot —
  // so the row carries the danger rail and wash rather than reading as one more
  // thing on the schedule. Matches the desktop's rose treatment for the same
  // rows (WeekGridA / TeamGridA).
  const blocked = e.kind === "blocked";
  // A visit is its own card (2026-10-16): tinted in the colour of whoever
  // booked it, with a rail and time plate in that colour — a job row never is.
  const visit = e.kind === "appointment" ? VISIT_VIA[e.via || "team"] : null;
  return (
    <div
      className={`${styles.erow} ${blocked ? styles.isBlocked : ""} ${e.kind === "desk" ? styles.isDesk : ""} ${visit ? styles.isVisit : ""} ${visit && e.status === "CANCELED" ? styles.isVisitOff : ""} ${styles.rowIn} ${landed ? styles.landed : ""}`}
      style={{ animationDelay: `${i * 45}ms`, ...(visit ? ({ "--via": visit.tone } as React.CSSProperties) : {}) }}
    >
      {/* Time is the one thing a calendar row is about, so it takes the left
          plate. Today is ALWAYS filled blueprint — the reference's rule. */}
      <span className={`${styles.etime} ${today ? styles.isToday : ""}`}>
        {showDay ? <span className={styles.etimeD}>{DOW[e.start.getDay()]}</span> : null}
        {e.allDay ? (
          <>
            <span className={styles.etimeH}>ALL</span>
            <span className={styles.etimeM}>DAY</span>
          </>
        ) : (
          <>
            <span className={styles.etimeH}>{fmtClock(e.start)}</span>
            <span className={styles.etimeM}>{fmtMeridiem(e.start)}</span>
          </>
        )}
      </span>
      {/* The kind glyph that used to lead this line is gone (owner's call,
          2026-07-30): it indented every title by 23px and said nothing the
          status badge on row 3 does not already say in words — "Appointment",
          "Blocked", or one of the four job statuses.
          The title IS the row's control: its ::after covers the whole card, so
          a tap anywhere outside the ⋮ opens the detail sheet. One button, and
          its accessible name is the event — no second tab stop for the card. */}
      <button className={styles.etitle} type="button" onClick={() => onSelect(e.id)}>
        {/* The clamp lives on the inner span, not the button: the button is
            what carries the stretched ::after, and an -webkit-box with
            overflow:hidden is the one box you do not want owning it. */}
        <span className={styles.etitleTxt}>{e.title}</span>
      </button>
      <button
        className={styles.erowOpen}
        type="button"
        aria-label={`Actions for ${e.title}`}
        onClick={() => onOpen(e.id)}
      >
        <Icon id="i-dots" />
      </button>
      {/* Row 2 — who and where, hard left */}
      <div className={styles.ewho}>{whoWhere(e)}</div>
      {/* Row 3 — badge leads, the duration closes at the far right */}
      <div className={styles.erowFoot}>
        <span className={`${styles.estatus} ${visit ? styles.stVia : TONE_BADGE[tone] ?? ""}`}>
          {visit ? <Icon id={visit.icon} className={`${styles.ic} ${styles.stViaIc}`} /> : null}
          {toneLabel(e)}
        </span>
        <span className={styles.ecrew}>{crewLabel(e)}</span>
        <span className={`${styles.edur} ${e.allDay ? styles.isZero : ""}`}>
          {e.allDay ? "—" : durLabel(e.end.getTime() - e.start.getTime())}
        </span>
      </div>
    </div>
  );
}

/**
 * The estimate-sheet read-out an event opens with. ONE list, shared by the
 * detail sheet and the edit form's meta box, so the two can never drift into
 * disagreeing about the same event. Optional fields are omitted rather than
 * printed empty — a blank "Phone —" row is noise, and the fixture deliberately
 * carries events with no phone, no address and no client.
 */
function metaRowsFor(e: CalEvent): [string, string][] {
  // Reserved AI desk hours: when, how often, whose — nothing else applies.
  if (e.kind === "desk") {
    const hh = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return [
      ["When", `${fmtDate(e.start)} · ${spanWords(hh(e.start), hh(e.end))}`],
      ["Repeats", e.deskWeekly ? `Every ${e.start.toLocaleDateString("en-US", { weekday: "long" })}` : "This day only"],
      ["For", e.title.replace(/^AI desk hours · /, "").replace(/^anyone$/, "Anyone at the company")],
    ];
  }
  const rows: [string, string][] = [
    ["When", e.allDay ? fmtDate(e.start) : `${fmtDate(e.start)} · ${fmtRange(e.start, e.end)}`],
    ["Duration", e.allDay ? "All day" : durLabel(e.end.getTime() - e.start.getTime())],
  ];
  if (e.kind === "appointment") {
    rows.push(["Booked", e.booked || "By your team"]);
    if (e.visitFor) rows.push(["Visit for", e.visitFor + (e.member ? " · member price" : "")]);
  }
  if (e.client) rows.push([e.kind === "appointment" && !e.clientId && e.leadId ? "Lead" : "Client", e.client]);
  if (e.phone) rows.push(["Phone", e.phone]);
  if (e.addr) rows.push(["Address", e.addr]);
  rows.push([
    "Crew",
    e.kind === "blocked" && e.orgWide
      ? "Everyone — the whole company"
      : e.kind === "blocked" && e.selfOnly
      ? `Just me · ${OWNER.name}`
      : // Each person's answer rides their name on a job event (2026-08-22):
        // "Casey Stone · accepted, Dima · pending".
        e.workers
          .map((id) => {
            const st = e.kind === "job" ? e.assignmentStatus?.[id] : undefined;
            return workerName(id) + (st ? ` · ${st.toLowerCase()}` : "");
          })
          .join(", ") || "Unassigned",
  ]);
  if (e.scope) rows.push(["Scope", e.scope]);
  return rows;
}

/** Where a visit's sheet can go: its lead or client, the visit page, the desk's call log. */
function visitLinks(e: CalEvent): Array<{ href: string; icon: string; title: string; sub: string }> {
  const out: Array<{ href: string; icon: string; title: string; sub: string }> = [];
  if (e.clientId) out.push({ href: `/dashboard/client-detail?client=${encodeURIComponent(e.clientId)}`, icon: "i-user", title: "Open client", sub: "Their record, jobs and proposals" });
  else if (e.leadId) out.push({ href: `/dashboard/leads/${encodeURIComponent(e.leadId)}`, icon: "i-target", title: "Open lead", sub: "What they asked for and how to reach them" });
  if (e.rid) out.push({ href: `/dashboard/visits/${encodeURIComponent(e.rid)}`, icon: "i-file", title: "Visit page", sub: "Equipment on file and the visit report" });
  if (e.via === "ai-desk") out.push({ href: "/dashboard/phone", icon: "i-phone", title: "Call log", sub: "The AI desk call that booked it" });
  return out;
}

/** Never blank: it says what happened AND what to do. Two distinct states —
 *  a filter that excludes everything is not the same thing as an open day. */
function EmptyState({
  what, filtered, onClear, onNew,
}: { what: string; filtered: boolean; onClear: () => void; onNew: () => void }) {
  return filtered ? (
    <div className={styles.empty}>
      <div className={styles.emptyT}>No matches</div>
      <div className={styles.emptyS}>Nothing in this {what} matches that search and filter.</div>
      <button className={styles.emptyA} type="button" onClick={onClear}>
        <Icon id="i-x" />Clear filters
      </button>
    </div>
  ) : (
    <div className={styles.empty}>
      <div className={styles.emptyT}>Nothing scheduled</div>
      <div className={styles.emptyS}>
        This {what} is open. Book a job, or pull one off the unscheduled list.
      </div>
      <button className={styles.emptyA} type="button" onClick={onNew}>
        <Icon id="i-plus" />New event
      </button>
    </div>
  );
}

/* ============================================================
   DATE AND TIME FIELDS — the house pickers.

   The native `<input type="date">` / `<input type="time">` these replace opened
   an OS panel no stylesheet can reach: no ink frame, no 2px radius, no mono
   numerals, and on Android a Material clock dial in the middle of a blueprint
   sheet. Replacing the CONTROL is the only way to style the panel — the same
   call mobile-projects-v2 made for its create form, whose `DatePanel` this is a
   port of rather than a second design (see the `.dpk` block in the stylesheet).

   Both fields still hand the form the exact strings the native controls did —
   "YYYY-MM-DD" and 24-hour "HH:MM" — so `fromInputs()` and the save path never
   learn that the control underneath them changed.
   ============================================================ */
const DPK_DOW = ["S", "M", "T", "W", "T", "F", "S"];
const DPK_MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Where a picker panel sits, in viewport coordinates. */
type PopAt = { left: number; top: number };

/**
 * Places a panel against the VISUAL viewport and keeps it there.
 *
 * The panel is a fixed layer, so nothing else keeps it on screen: it flips above
 * its field when there is not enough room below, and re-places on scroll because
 * `.sheetBody` scrolls underneath it. Capture-phase, since the sheet body is an
 * inner element whose scroll never bubbles to document.
 */
function usePanelPlacement(hostRef: React.RefObject<HTMLDivElement | null>, height: number): PopAt | null {
  const [at, setAt] = useState<PopAt | null>(null);
  const place = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewH = vv?.height ?? window.innerHeight;
    const viewW = vv?.width ?? window.innerWidth;
    const w = Math.min(300, viewW - 24);
    const below = viewTop + viewH - r.bottom - 7 - 12;
    const flip = below < height && r.top - viewTop > below;
    setAt({
      left: Math.min(Math.max(12, r.left), viewW - w - 12),
      top: flip ? Math.max(12, r.top - 7 - height) : r.bottom + 7,
    });
  }, [hostRef, height]);

  useEffect(() => {
    place();
    const vv = window.visualViewport;
    document.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    vv?.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
    };
  }, [place]);

  return at;
}

/**
 * The month grid, MOUNTED only while open.
 *
 * That is not an optimisation — it is what lets the panel seed its month from
 * the field's current value with a plain lazy `useState` initialiser. Kept
 * mounted, re-seeding on open would be a setState inside an effect, which is a
 * cascading render (and the lint rule that says so).
 */
function DatePanel({
  hostRef, label, value, onCommit, onDismiss,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  onDismiss: () => void;
}) {
  const picked = fromDateInput(value);
  const [month, setMonth] = useState(() => startOfMonth(picked ?? new Date(TODAY)));
  // 344px is the panel at its tallest: head + six week rows + the foot bar.
  const at = usePanelPlacement(hostRef, 344);

  const today = new Date(TODAY);
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
              <span className={styles.dpkMonth}>{DPK_MONTH_YEAR.format(month)}</span>
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
              {DPK_DOW.map((d, i) => (
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
                    key={toDateInput(d)}
                    className={`${styles.dpkDay} ${out ? styles.dpkOut : ""} ${
                      isToday ? styles.dpkToday : ""
                    } ${isSel ? styles.dpkSel : ""}`}
                    type="button"
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSel}
                    onClick={() => onCommit(toDateInput(d))}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.dpkFoot}>
            <span className={styles.dpkVal}>{picked ? fmtDate(picked) : "No date"}</span>
            <span className={styles.dpkActs}>
              <button
                className={styles.dpkAct}
                type="button"
                onClick={() => onCommit(toDateInput(today))}
              >
                Today
              </button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateField({
  id, label, value, onChange, open, onOpenChange,
}: {
  id: string;
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
        <Icon id="i-cal" />
      </span>
      {/* Still a real, typable input whose `.value` is the "YYYY-MM-DD" string
          the save path already reads — the grid writes it, it does not replace
          it. Someone who would rather type the date still can. */}
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

/** 12, then 1–11 — the face of a clock, not 0-indexed hours. */
const TPK_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** SNAP_MIN is 15, so these four ARE the pickable minutes. Offering :07 would be
 *  offering a value the save path silently moves. */
const TPK_MINS = [0, 15, 30, 45];

function TimePanel({
  hostRef, label, mins, onPick, onDismiss,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  label: string;
  mins: number;
  onPick: (mins: number) => void;
  onDismiss: () => void;
}) {
  // Three banks (hours / minutes / meridiem) plus the foot: ~300px tall.
  const at = usePanelPlacement(hostRef, 300);
  const h24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const pm = h24 >= 12;
  const h12 = h24 % 12 || 12;

  /** Rebuild the value from whichever bank was touched. */
  const set = (nextH12: number, nextMin: number, nextPm: boolean) => {
    const base = nextH12 % 12;
    onPick((base + (nextPm ? 12 : 0)) * 60 + nextMin);
  };

  return (
    <div className={styles.dpkLayer}>
      <div className={styles.dpkCatch} onClick={onDismiss} aria-hidden="true" />
      {at ? (
        <div
          className={styles.dpkPop}
          style={{ left: at.left, top: at.top }}
          role="dialog"
          aria-label={`${label} — clock`}
        >
          <div className={styles.tpkBank}>
            <div className={styles.tpkLbl}>Hour</div>
            <div className={styles.tpkHours}>
              {TPK_HOURS.map((h) => (
                <button
                  key={h}
                  className={`${styles.tpkCell} ${h === h12 ? styles.on : ""}`}
                  type="button"
                  aria-pressed={h === h12}
                  onClick={() => set(h, minute, pm)}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.tpkBank}>
            <div className={styles.tpkLbl}>Minute</div>
            <div className={styles.tpkMins}>
              {TPK_MINS.map((m) => (
                <button
                  key={m}
                  className={`${styles.tpkCell} ${m === minute ? styles.on : ""}`}
                  type="button"
                  aria-pressed={m === minute}
                  onClick={() => set(h12, m, pm)}
                >
                  :{String(m).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.tpkBank}>
            <div className={styles.tpkLbl}>Half</div>
            <div className={styles.tpkAmpm}>
              {[false, true].map((isPm) => (
                <button
                  key={String(isPm)}
                  className={`${styles.tpkCell} ${isPm === pm ? styles.on : ""}`}
                  type="button"
                  aria-pressed={isPm === pm}
                  onClick={() => set(h12, minute, isPm)}
                >
                  {isPm ? "PM" : "AM"}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.dpkFoot}>
            <span className={styles.dpkVal}>{fmtMins(mins)}</span>
            <span className={styles.dpkActs}>
              <button className={styles.dpkAct} type="button" onClick={onDismiss}>
                Done
              </button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The time field. Its face is a BUTTON, not an input: unlike a date, a time has
 * no format worth typing on a phone ("7:00 AM"? "0700"? "7p"?), so the value is
 * picked and never spelled. `value` stays the 24-hour "HH:MM" wire string.
 */
function TimeField({
  label, value, onChange, open, onOpenChange, describedBy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  describedBy?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // A half-typed or absent value must not be able to produce NaN o'clock.
  const mins = fromTimeInput(value) ?? 8 * 60;
  return (
    <div className={`${styles.tpk} ${open ? styles.open : ""}`} ref={hostRef}>
      <span className={styles.dpkLead}>
        <Icon id="i-clock" />
      </span>
      <button
        className={styles.tpkFace}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} — ${fmtMins(mins)}`}
        aria-describedby={describedBy}
        onClick={() => onOpenChange(!open)}
      >
        <span className={styles.tpkVal}>{fmtMins(mins)}</span>
      </button>
      <span className={styles.dpkTgl} aria-hidden="true">
        <Icon id="i-chev" />
      </span>
      {open ? (
        <TimePanel
          hostRef={hostRef}
          label={label}
          mins={mins}
          onPick={(m) => onChange(minsToTimeInput(m))}
          onDismiss={() => onOpenChange(false)}
        />
      ) : null}
    </div>
  );
}

type FormState = {
  mode: "new" | "edit";
  id: string | null;
  kind: CalKind;
  title: string;
  date: string;
  startT: string;
  endT: string;
  allDay: boolean;
  status: string;
  crew: string[];
  link: string | null;
  notes: string;
  /** Set when the form was opened from the tray: creating consumes that job. */
  fromTray: string | null;
  /** AI desk hours only: whose ("" = anyone at the company) and whether every week. */
  deskWho?: string;
  deskWeekly?: boolean;
};

/** Which picker panel is open. One at a time — two floating layers over one
 *  bottom sheet is one layer too many on a phone. */
type PickerKey = "date" | "start" | "end" | null;

/** Server actions reject with an Error whose message is written for the user.
 *  Surface that text; fall back to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/**
 * `?date=YYYY-MM-DD` / `?new=1`, read once off `window.location` and then wiped
 * out of the URL.
 *
 * `window.location`, not `useSearchParams()`, for two reasons: this component
 * is mounted `ssr: false` by the responsive shell, where a Suspense boundary
 * for the params hook would be ceremony around a value that is only ever read
 * on the client; and consuming the params means REMOVING them, which the hook
 * cannot do. A malformed or absent date is a no-op — a bad `?date=` must never
 * be able to produce an Invalid Date cursor.
 */
function readEntryParams(): { date: Date | null; create: boolean } {
  if (typeof window === "undefined") return { date: null, create: false };
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(window.location.search);
  } catch {
    return { date: null, create: false };
  }
  const raw = q.get("date");
  let date: Date | null = null;
  const m = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Rejects 2026-02-31 and friends: the constructor rolls them over, so the
    // only proof the date was real is that it survives the round trip.
    if (
      !Number.isNaN(d.getTime()) &&
      d.getFullYear() === Number(m[1]) &&
      d.getMonth() === Number(m[2]) - 1 &&
      d.getDate() === Number(m[3])
    ) {
      date = d;
    }
  }
  return { date, create: q.get("new") === "1" };
}

/** Drop `date` / `new` from the address bar without a navigation, so Back does
 *  not land on the same URL and re-open the create sheet. */
function clearEntryParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("date") && !url.searchParams.has("new")) return;
  url.searchParams.delete("date");
  url.searchParams.delete("new");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/**
 * ENTRY — resolves the org's calendar, then draws the sheet.
 *
 * Split in two so every hook in the view below runs against a real book and
 * none of them is conditional. `data` arrives as a prop from the standalone
 * /mobile-calendar-v2 page; it is ABSENT when `ResponsiveDashboardShell` mounts
 * this props-less on /dashboard/calendar, and that path asks the read-only
 * action for the same seed the desktop page reads. Same contract as
 * mobile-v2/mobile-dashboard.tsx.
 */
export function MobileCalendar({ data: seed }: { data?: CalendarBook }) {
  const [book, setBook] = useState<CalendarBook | null>(seed ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (seed) return;
    let alive = true;
    getCalendarSeed()
      .then((b) => {
        if (alive) setBook(b);
      })
      .catch((err) => {
        if (alive) setLoadError(actionError(err));
      });
    return () => {
      alive = false;
    };
  }, [seed]);

  if (book) return <CalendarBoard book={book} />;
  return <BootScreen error={loadError} />;
}

/** Paper hold while the calendar lands, and an honest failure if it does not.
 *  The shell's own `MobileHold` paints the same cream behind the chunk fetch,
 *  so the two read as one uninterrupted load. */
function BootScreen({ error }: { error: string | null }) {
  if (!error) return <div className={styles.app} />;
  return (
    <div className={styles.app}>
      <main className={styles.scroll}>
        <div className={styles.content}>
          <div className={styles.empty}>
            <div className={styles.emptyT}>Calendar unavailable</div>
            <div className={styles.emptyS}>{error}</div>
          </div>
        </div>
      </main>
    </div>
  );
}

function CalendarBoard({ book }: { book: CalendarBook }) {
  // Points TODAY / workersData / OWNER / LINK_OPTIONS at this org, BEFORE the
  // state initialisers and module helpers below read them. Identity-guarded, so
  // every render after the first is a single comparison. See the note at the
  // top of calendar-data.ts for why the book is module state.
  installCalendarBook(book);

  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /* `?date=` / `?new=1` — read once, at the same moment the cursor is seeded,
     so the calendar OPENS on the asked-for day rather than jumping to it.
     A lazy `useState` and not a ref: the value IS needed during render (the two
     cursors below are seeded from it), which is exactly what a ref must not be
     used for. There is no setter, so it is a per-mount constant. */
  const [entry] = useState(readEntryParams);

  /* Cloned per mount so runtime edits never write back through the seed. */
  const [data, setData] = useState<CalEvent[]>(() =>
    book.events.map((e) => ({
      ...e,
      start: new Date(e.start),
      end: new Date(e.end),
      workers: e.workers.slice(),
    })),
  );
  /* A visit SmartBook's Requests card booked (2026-10-31): the visits are read again, so the Yes lands on the grid. */
  const reloadEvents = () => {
    getCalendarSeed()
      .then((b) => setData(b.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end), workers: e.workers.slice() }))))
      .catch(() => {});
  };
  const [tray, setTray] = useState<TrayJob[]>(() => book.tray.map((j) => ({ ...j })));
  const [inbox, setInbox] = useState<InboxItem[]>(() => book.inbox.map((r) => ({ ...r })));
  /** Crew answers not yet looked at — rides the bell with the pending count;
   *  opening the sheet clears it and stamps the server. */
  const [inboxUnseen, setInboxUnseen] = useState<number>(book.inboxUnseen ?? 0);

  const [view, setView] = useState<ViewKey>("month");
  // Team is a DISPATCH view: a rail of every crew member with their role, drawn
  // over the seed's whole `workers` roster. The events in it are role-scoped by
  // the query, the roster is not — so on a field worker's phone it was a staff
  // directory sitting behind a tab on the one page that promises "your jobs
  // only". The seed already carries `canManage`; it was arriving here and going
  // unread. Matches the desktop toolbar, which drops the same tab (see
  // components/v3/calendar-blueprint/calendar-content.tsx).
  const views = book.canManage ? VIEWS : VIEWS.filter((v) => v.key !== "team");
  const [cursor, setCursor] = useState<Date>(() => new Date(entry.date ?? TODAY));
  const [sel, setSel] = useState<Date>(() => new Date(entry.date ?? TODAY));

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>(ALL);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const [actId, setActId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // `?new=1` opens the create sheet as part of the FIRST render rather than as
  // an effect that re-opens it a frame later — the sheet's slide-up should be
  // the page arriving, not a second thing happening to it.
  const [formOpen, setFormOpen] = useState(entry.create);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);

  /* Which kinds this ROLE may create, in tab order. The three create actions
     have three different guards, so the strip is built from the seed's own list
     rather than offering all three and letting two of them fail on submit —
     which is a new problem now that the submit is a real write. An empty list
     (a role that may create nothing) still falls back to the full set so the
     form is never a dead end; the server refuses it and the sheet says why. */
  const createKinds: CalKind[] = book.createKinds.length
    ? book.createKinds
    : ["job", "appointment", "blocked"];

  /* ---- create / edit form ---- */
  const [form, setForm] = useState<FormState>(() => ({
    mode: "new", id: null, kind: createKinds[0], title: "",
    // Prefilled with `?date=` when there was one, so `?new=1` lands on the day
    // the caller tapped rather than on today.
    date: toDateInput(entry.date ?? TODAY), startT: "08:00", endT: "10:00",
    allDay: false, status: "SCHEDULED", crew: [], link: null, notes: "", fromTray: null,
  }));
  const [titleErr, setTitleErr] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [crewOpen, setCrewOpen] = useState(false);
  const [crewQuery, setCrewQuery] = useState("");
  /** Which of the three house pickers (date / start / end) is showing. */
  const [picker, setPicker] = useState<PickerKey>(null);
  /** The create is a real server write now, so the form has the two states any
   *  network form has: in flight, and refused. */
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

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

  /* ---------- Motion: press stamp (delegated, covers late rows) ---------
     A calendar day keeps the reference's own press-pulse (.94 → 1.02 → 1)
     rather than the flat stamp — decisions.md gives the day cell that
     signature and it is the one control on the page that is a plate, not a
     button face. */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const sel2 = [
      styles.btn, styles.ddBtn, styles.ddItem, styles.tab, styles.navBtn, styles.rbarBtn,
      styles.agAdd, styles.erowOpen, styles.mrow, styles.sheetCancel, styles.emptyA,
      styles.srchX, styles.segBtn, styles.fchk, styles.kindBtn, styles.linkBtn,
      styles.linkRow, styles.queueBtn, styles.mgCell,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel2);
    if (!el) return;
    const cls = el.classList.contains(styles.mgCell) ? styles.dayPressed : styles.pressed;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  }, []);

  /* ---------- Esc closes what the PAGE owns ----------------------------
     The drawer is not listed: MobileNav owns its own Escape and only binds
     while open, so the two listeners can never claim one key press. Innermost
     first — the detail sheet is checked before the actions sheet because Edit
     is reached THROUGH it, so it is the newer layer. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (picker) setPicker(null);
      else if (crewOpen) setCrewOpen(false);
      else if (linkOpen) setLinkOpen(false);
      else if (formOpen) setFormOpen(false);
      else if (trayOpen) setTrayOpen(false);
      else if (inboxOpen) setInboxOpen(false);
      else if (actId) setActId(null);
      else if (detailId) setDetailId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, picker, crewOpen, linkOpen, formOpen, trayOpen, inboxOpen, actId, detailId]);

  /* ---------- Filter dropdown: close on outside pointerdown ------------ */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen]);

  /* ---------- The one blue flash on a record you just changed ----------- */
  useEffect(() => {
    if (!landedId) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => clearTimeout(t);
  }, [landedId]);

  /* ---------- derived ranges ------------------------------------------- */
  const visible = useMemo(
    () => data.filter((e) => matchesFilter(e, filter) && matchesQuery(e, query)),
    [data, filter, query],
  );
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const monthEvents = useMemo(() => visible.filter((e) => sameMonth(e.start, cursor)), [visible, cursor]);
  const weekEvents = useMemo(
    () => visible.filter((e) => e.start >= weekStart && e.start < addDays(weekStart, 7)),
    [visible, weekStart],
  );
  const dayEvents = useMemo(
    () => visible.filter((e) => sameDay(e.start, sel)).sort(byStart),
    [visible, sel],
  );
  const crewOn = useMemo(
    () => workersData.filter((w) => weekEvents.some((e) => e.workers.includes(w.id))).length,
    [weekEvents],
  );

  const counts: Record<ViewKey, number> = {
    month: monthEvents.length,
    week: weekEvents.length,
    team: crewOn,
  };

  /* ---------- swipe rails: Week (7 days) and Team (4 crew) --------------
     Both views used to lay their columns out side by side, which on a phone is
     seven ~40px slivers nobody can read. Each is now a scroll-snap rail: one
     full-width panel per swipe, its events as ROWS. The index below is only
     ever a READ-OUT of where the rail already is — nothing writes scrollLeft
     from it, so the finger is always the authority. */
  const weekRailRef = useRef<HTMLDivElement>(null);
  const teamRailRef = useRef<HTMLDivElement>(null);
  const [weekIdx, setWeekIdx] = useState(0);
  const [teamIdx, setTeamIdx] = useState(0);

  /** Which panel is under the viewport, from the rail's own scroll position. */
  const railIndex = (rail: HTMLDivElement, count: number) => {
    const col = rail.firstElementChild as HTMLElement | null;
    const w = col?.offsetWidth || 1;
    return Math.max(0, Math.min(count - 1, Math.round(rail.scrollLeft / w)));
  };

  /* The week rail opens on the day you were already looking at, not on Sunday:
     landing on an empty Sunday when today is Wednesday is the single easiest
     way to make a swipe rail feel broken. Nothing here sets `sel`, so this
     cannot loop back on itself. */
  useEffect(() => {
    if (view !== "week") return;
    const rail = weekRailRef.current;
    if (!rail) return;
    const idx = Math.max(0, weekDays.findIndex((d) => sameDay(d, sel)));
    const col = rail.firstElementChild as HTMLElement | null;
    rail.scrollTo({ left: (col?.offsetWidth ?? 0) * idx, behavior: "auto" });
    setWeekIdx(idx);
  }, [view, weekDays, sel]);

  /* The rail unmounts with its view, so its scrollLeft is 0 again on return and
     the read-out has to be reset with it or it reports a stale panel. Done on
     the tab press rather than in an effect: switching view is an event, not a
     synchronisation with an outside system. The week rail needs no equivalent —
     its effect below re-derives the index from the position it scrolls to. */
  const changeView = (next: ViewKey) => {
    setView(next);
    setTeamIdx(0);
  };

  /* ---------- range navigation -----------------------------------------
     Moving the range keeps the agenda honest: the selected day snaps into the
     range you just opened — today when it is in there, otherwise its first
     day — instead of pointing at a day the grid no longer shows. */
  const goto = (next: Date) => {
    setCursor(next);
    const inRange = view === "month"
      ? sameMonth(TODAY, next)
      : TODAY >= startOfWeek(next) && TODAY < addDays(startOfWeek(next), 7);
    if (inRange) {
      setSel(new Date(TODAY));
      return;
    }
    setSel(view === "month" ? new Date(next.getFullYear(), next.getMonth(), 1) : startOfWeek(next));
  };
  const step = (dir: -1 | 1) => {
    const c = new Date(cursor);
    if (view === "month") c.setMonth(c.getMonth() + dir);
    else c.setDate(c.getDate() + dir * 7);
    goto(c);
  };
  const goToday = () => {
    setCursor(new Date(TODAY));
    setSel(new Date(TODAY));
  };

  const rangeTitle = view === "month" ? fmtMonthYear(cursor) : fmtWeekRange(weekStart);

  /* ---------- month grid ----------------------------------------------- */
  const monthCells = useMemo(() => {
    const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, i) => {
      const day = addDays(gridStart, i);
      const evs = visible.filter((e) => sameDay(e.start, day)).sort(byStart);
      return { day, evs, out: day.getMonth() !== cursor.getMonth() };
    });
  }, [cursor, visible]);

  const filtersActive = Boolean(query.trim()) || filter !== ALL;
  const resetFilters = () => {
    setFilter(ALL);
    setQuery("");
  };

  const options = useMemo(() => filterOptions(), []);
  const activeOption = options.find((o) => o.key === filter) ?? options[0];

  /* ---------- actions sheet / detail sheet ------------------------------
     Both read back out of `data` rather than holding a copy of the event, so a
     sheet that is open while the record changes underneath it (mark completed,
     push to tomorrow) redraws with the new values instead of the stale ones. */
  const actEvent = actId === null ? null : (data.find((e) => e.id === actId) ?? null);
  const detailEvent = detailId === null ? null : (data.find((e) => e.id === detailId) ?? null);

  const menuRows = useMemo<MenuRow[]>(() => {
    const e = actEvent;
    if (!e) return [];
    // Reserved AI desk hours: see them, or give them back — they have no job, client, status or move.
    if (e.kind === "desk") {
      const canRemove = book.canManage || e.deskUserId === book.desk?.me;
      return [
        { act: "deskinfo", icon: "i-phone", tone: styles.miSky, title: "See these hours", sub: e.deskWeekly ? "Reserved every week for the AI desk" : "Reserved for the AI desk" },
        { act: "deskdel", icon: "i-trash", tone: styles.miDanger, title: e.deskWeekly ? "Remove every week" : "Remove these hours", sub: canRemove ? "The AI desk stops booking into them" : "Only their owner or a manager can", danger: true, disabled: !canRemove },
      ];
    }
    const isJob = e.kind === "job";
    const done = e.status === "COMPLETED";
    return [
      // Only job EVENTS carry a job. An appointment or a block has nothing to
      // open, so the row states that rather than going missing — a menu whose
      // rows move between events is a menu you have to re-read every time.
      { act: "job", icon: "i-jobs", tone: styles.miBp, title: "Open job",
        sub: e.jobId ? "Full record, crew and photos" : "This event is not attached to a job",
        disabled: !e.jobId },
      { act: "edit", icon: "i-file", tone: styles.miBp, title: "Edit event",
        sub: "Time, crew, status and notes" },
      { act: "call", icon: "i-phone", tone: styles.miSky, title: "Call client",
        sub: e.phone ?? "No phone on this event", disabled: !e.phone },
      { act: "dir", icon: "i-pin", tone: styles.miWarn, title: "Get directions",
        sub: e.addr ? `${e.addr} — open in maps` : "No address on this event", disabled: !e.addr },
      { act: "done", icon: "i-check", tone: styles.miOk,
        title: done ? "Already completed" : "Mark completed",
        sub: !isJob ? "Only job events carry a status" : done ? `Filed ${fmtDayShort(e.end)}` : "Closes it out on the schedule",
        disabled: done || !isJob },
      { act: "push", icon: "i-rotate", title: "Push to tomorrow",
        sub: `Moves the whole span to ${fmtDayShort(addDays(e.start, 1))}` },
      { act: "del", icon: "i-trash", tone: styles.miDanger, title: "Delete event",
        sub: "Removes it from the calendar", danger: true },
    ];
  }, [actEvent, book.canManage, book.desk?.me]);

  /** The jobs board's own href shape (jobs-behavior.ts `jobHref`), so the two
   *  surfaces cannot disagree about where a job lives. A client-side push, not
   *  a document load: the destination is a blueprint page whose entrance
   *  cascade is armed from a layout effect, and a hard load replays it. */
  const openJob = useCallback(
    (jobId: string) => router.push(("/dashboard/jobs/" + encodeURIComponent(jobId)) as Route),
    [router],
  );

  // Delete / done / push are REAL SERVER WRITES now (2026-08-21). They used to
  // mutate React state and stop — the DB rows survived, so a "deleted" event
  // resurrected on the very next seed read (creating another event, a remount,
  // a reload) and a "completed" one reverted. Optimistic update stays for the
  // hand-feel; the matching action lands the change, and a reject rolls the
  // local state back so the calendar never lies about what the server holds.
  // Rows without `rid` (purely local, pre-wire) keep the local-only path.
  /** Give reserved AI desk hours back — every day they land on. */
  const removeDesk = async (e: CalEvent) => {
    if (!e.rid) return;
    const rid = e.rid;
    const before = data.filter((x) => x.kind === "desk" && x.rid === rid);
    setData((prev) => prev.filter((x) => !(x.kind === "desk" && x.rid === rid)));
    const r = await removeDeskHours(rid).catch(() => ({ ok: false as const, error: "Couldn't remove. Try again." }));
    if (!r.ok) setData((prev) => [...prev, ...before]);
  };

  const runMenu = (act: string) => {
    const e = actEvent;
    setActId(null);
    if (!e) return;
    if (act === "deskinfo") {
      setDetailId(e.id);
      return;
    }
    if (act === "deskdel") {
      void removeDesk(e);
      return;
    }
    if (act === "job") {
      if (e.jobId) openJob(e.jobId);
      return;
    }
    if (act === "del") {
      setData((prev) => prev.filter((x) => x.id !== e.id));
      if (e.rid) {
        const del =
          e.kind === "job"
            ? deleteJobEvent(e.rid)
            : e.kind === "appointment"
              ? deleteAppointment(e.rid)
              : deleteBlockedTime(e.rid);
        void del.catch(() => setData((prev) => [...prev, e]));
      }
      return;
    }
    if (act === "done") {
      setData((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: "COMPLETED" } : x)));
      setLandedId(e.id);
      // Status lives on the JOB row — the menu only offers Done for job events.
      if (e.jobId) {
        void updateJob(e.jobId, { status: "COMPLETED" }).catch(() =>
          setData((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: e.status } : x))),
        );
      }
      return;
    }
    if (act === "push") {
      const start = addDays(e.start, 1);
      const end = addDays(e.end, 1);
      setData((prev) => prev.map((x) => (x.id === e.id ? { ...x, start, end } : x)));
      setSel(addDays(e.start, 1));
      setLandedId(e.id);
      if (e.rid) {
        const mv =
          e.kind === "job"
            ? rescheduleJobEventTime(e.rid, start.toISOString(), end.toISOString())
            : e.kind === "appointment"
              ? rescheduleAppointment(e.rid, start.toISOString())
              : rescheduleBlockedTime(e.rid, start.toISOString());
        void mv.catch(() =>
          setData((prev) =>
            prev.map((x) => (x.id === e.id ? { ...x, start: e.start, end: e.end } : x)),
          ),
        );
      }
      return;
    }
    if (act === "edit") openEdit(e);
  };

  /* ---------- form ----------------------------------------------------- */
  const focusTitle = () => {
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    window.setTimeout(() => titleRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  /** Every transient the form carries, back to zero. Missing one of these is how
   *  a picker from the last event comes back open on the next one. */
  const resetFormChrome = () => {
    setTitleErr(false);
    setLinkOpen(false);
    setLinkQuery("");
    setCrewOpen(false);
    setCrewQuery("");
    setPicker(null);
    setSaving(false);
    setSaveErr(null);
  };

  /**
   * The ONE way the create/edit sheet closes.
   *
   * The sheet has five exits — Escape, the scrim, Cancel, a pull down, a
   * successful save — and every one of them has to take the form's floating
   * panels with it. `setFormOpen(false)` on its own leaves the date panel's
   * full-screen dismiss catcher mounted over a sheet that is no longer there.
   * A helper, not an effect on `formOpen`: setState inside an effect is a
   * cascading render, and closing a sheet is an event, not a synchronisation.
   */
  const closeForm = () => {
    setFormOpen(false);
    setPicker(null);
    setCrewOpen(false);
    setLinkOpen(false);
  };

  const openNew = (day?: Date, seed?: TrayJob) => {
    const base = day ?? sel;
    // The tray hands over a JOB, so the form opens on the kind that can link one
    // — and pre-links it, which is what makes "Schedule" from the tray a single
    // decision instead of a search the user just did being repeated.
    const trayLink = seed ? (LINK_OPTIONS.find((o) => o.kind === "job" && (o.rid ?? o.id) === seed.id)?.id ?? null) : null;
    setForm({
      mode: "new", id: null, kind: createKinds[0] ?? "job",
      title: seed ? `${seed.title} — ${seed.client}` : "",
      date: toDateInput(base), startT: "08:00", endT: seed ? "12:00" : "10:00",
      allDay: false, status: "SCHEDULED", crew: [], link: trayLink,
      notes: seed ? `Est. ${seed.duration}` : "", fromTray: seed ? seed.id : null,
    });
    resetFormChrome();
    setTrayOpen(false);
    setFormOpen(true);
    focusTitle();
  };

  const openEdit = (e: CalEvent) => {
    setForm({
      mode: "edit", id: e.id, kind: e.kind, title: e.title,
      date: toDateInput(e.start), startT: toTimeInput(e.start), endT: toTimeInput(e.end),
      allDay: Boolean(e.allDay), status: e.status, crew: e.workers.slice(),
      link: null, notes: e.notes ?? "", fromTray: null,
    });
    resetFormChrome();
    setFormOpen(true);
  };

  /* ---------- ?date= / ?new=1, consumed ---------------------------------
     Both params were spent during the first render: the cursor and the form's
     date were seeded from `?date=`, and `formOpen` started true on `?new=1`.
     All that is left is to take them back out of the address bar, so a Back
     navigation into this page is the calendar and not the create sheet all
     over again — and so a stale `?date=` cannot outlive the day it was about.
     No state is touched here; the sheet is already open. */
  useEffect(() => {
    if (entry.create) focusTitle();
    clearEntryParams();
    // `entry` is a per-mount constant and `focusTitle` only reads a ref, so
    // this genuinely runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchForm = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  /**
   * Moving the START carries the END with it, keeping the span.
   *
   * The desktop sheet's `updateStarts` rule. It did not matter while these were
   * native time inputs — a half-typed "1" was a transient nobody looked at — but
   * a PICKED time is committed the instant a cell is tapped, so without this the
   * form sits there reading "Start 3:00 PM / End 10:00 AM" while the user is
   * still choosing.
   *
   * The span is FROZEN when the picker opens, not recomputed per tap. Three taps
   * (hour, then minute, then AM/PM) are one decision, and the intermediate
   * values are nonsense: 8–10 AM tapped to "3" is momentarily a seven-hour
   * 3 AM–10 AM span, and reading the span off THAT is how tapping PM used to
   * land the end at 10 PM. Frozen, the same three taps give 3–5 PM.
   */
  const spanRef = useRef(120);
  const freezeSpan = () => {
    const s = fromTimeInput(form.startT);
    const e = fromTimeInput(form.endT);
    spanRef.current = s !== null && e !== null && e > s ? e - s : 120;
  };
  const setStartT = (v: string) =>
    setForm((f) => {
      const next = fromTimeInput(v);
      const prevEnd = fromTimeInput(f.endT);
      if (next === null || prevEnd === null || next < prevEnd) return { ...f, startT: v };
      // 23:45 is the last slot the picker can express, so a late start stops
      // there rather than silently rolling the end into the next day.
      const end = Math.min(23 * 60 + 45, next + spanRef.current);
      return { ...f, startT: v, endT: minsToTimeInput(end) };
    });

  const toggleCrew = (id: string) =>
    setForm((f) => ({
      ...f,
      crew: f.crew.includes(id) ? f.crew.filter((x) => x !== id) : [...f.crew, id],
    }));

  /* ---- linked record: ONE kind per event kind -------------------------------
     A JOB event links a JOB; a VISIT links the LEAD it is about; blocked time
     links nothing. `LINK_TABS` is the map and it is the only place that decides
     — the picker reads it rather than carrying a second opinion. */
  const linkKinds: LinkKind[] = LINK_TABS[form.kind] ?? [];
  const linkRows = useMemo(() => {
    const kinds: LinkKind[] = LINK_TABS[form.kind] ?? [];
    const q = linkQuery.trim().toLowerCase();
    return LINK_OPTIONS.filter((o) => kinds.includes(o.kind)).filter(
      (o) => !q || `${o.title} ${o.client} ${o.meta}`.toLowerCase().includes(q),
    );
  }, [form.kind, linkQuery]);
  const linkPick = LINK_OPTIONS.find((o) => o.id === form.link) ?? null;
  const linkNoun = linkKinds.length === 1 ? LINK_LABEL[linkKinds[0]].toLowerCase() : "record";

  /* ---- crew: the desktop WorkerMultiPicker's roster, searchable ---- */
  const crewRows = useMemo(() => {
    const q = crewQuery.trim().toLowerCase();
    if (!q) return workersData;
    return workersData.filter((w) => `${w.name} ${w.role}`.toLowerCase().includes(q));
  }, [crewQuery]);
  const crewPicked = form.crew
    .map((id) => workersData.find((w) => w.id === id))
    .filter((w): w is (typeof workersData)[number] => Boolean(w));

  /**
   * Save.
   *
   * CREATING IS A REAL SERVER WRITE (2026-08-15). It used to push a row into
   * local state and stop there, so a contractor could book a job on a phone,
   * watch it land on the schedule, pull to refresh and find it had never
   * existed. It now calls the same three actions the desktop sheet calls —
   * `createJobEvent` / `createAppointment` / `createBlockedTime`, plus
   * `assignWorker` per crew member — and only then pushes the returned row,
   * carrying its real `rid` and `jobId`. No new data layer: these are the
   * pre-existing, individually guarded actions.
   *
   * EDITING IS A REAL SERVER WRITE TOO (2026-08-21). It was local-only for the
   * same reason creating once was, with the same consequence: adding a crew
   * member to an existing booking on a phone wrote nothing, emailed nobody and
   * vanished on reload. It now runs the same update actions the desktop sheet
   * does, plus assignment diffing against `assignmentIds`.
   */
  /** Assignment diff for a job's crew - mirrors the desktop sheet's
   *  `syncJobCrew`. Adding someone runs `assignWorker`, which is what emails
   *  them and writes the activity row; removing runs `unassignWorker` against
   *  the id the seed read back. A worker added and removed inside one session
   *  has no assignment id yet, so it is skipped rather than guessed at. */
  const syncJobCrew = async (row: CalEvent, next: string[]) => {
    if (!row.jobId) return;
    const prev = row.workers.slice();
    const added = next.filter((w) => prev.indexOf(w) === -1);
    const removed = prev.filter((w) => next.indexOf(w) === -1);
    for (const w of removed) {
      const aid = row.assignmentIds?.[w];
      if (aid) await unassignWorker(aid);
    }
    for (const w of added) await assignWorker(row.jobId, w);
  };

  /** AI desk hours (2026-10-16): reserve the picked hours, then show every day they land on. */
  const reserveDesk = async () => {
    const desk = book.desk;
    if (!desk) {
      setSaveErr("Reserving hours needs the live calendar.");
      return;
    }
    const start = fromInputs(form.date, form.startT, sel);
    const end = fromInputs(form.date, form.endT, sel);
    if (end.getTime() <= start.getTime()) {
      setSaveErr("The end has to be after the start.");
      return;
    }
    const tz = desk.timeZone;
    const day = zonedYmd(start, tz);
    if (zonedYmd(end, tz) !== day) {
      setSaveErr("Reserve hours inside one day.");
      return;
    }
    const who = book.canManage ? (form.deskWho ?? desk.me) : desk.me;
    setSaveErr(null);
    setSaving(true);
    let r: Awaited<ReturnType<typeof reserveDeskHours>>;
    try {
      r = await reserveDeskHours({ userId: who || null, date: form.deskWeekly ? null : day, dow: form.deskWeekly ? new Date(`${day}T12:00:00Z`).getUTCDay() : null, from: zonedHhmm(start, tz), to: zonedHhmm(end, tz) });
    } catch (err) {
      setSaving(false);
      setSaveErr(actionError(err));
      return;
    }
    setSaving(false);
    if (!r.ok) {
      setSaveErr(r.error);
      return;
    }
    const w = r.window;
    const person = w.userId ? desk.people.find((x) => x.userId === w.userId) : null;
    const wid = w.userId ? workersData.find((x) => x.userId === w.userId)?.id : undefined;
    const rows: CalEvent[] = expandWindows([w], TODAY, 183, tz).map((sp) => ({
      id: `desk:${w.id}:${sp.startsAt.getTime()}`,
      rid: w.id,
      kind: "desk",
      title: `AI desk hours · ${person ? person.name : "anyone"}`,
      start: sp.startsAt,
      end: sp.endsAt,
      status: "SCHEDULED",
      workers: wid ? [wid] : [],
      deskUserId: w.userId ?? undefined,
      deskWeekly: sp.weekly || undefined,
    }));
    setData((prev) => [...prev, ...rows]);
    setCursor(new Date(start));
    setSel(new Date(start));
    setLandedId(rows.find((x) => x.start.getTime() >= start.getTime() - 60000)?.id ?? null);
    closeForm();
  };

  const submitForm = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    if (form.kind === "desk") {
      await reserveDesk();
      return;
    }
    const title = form.title.trim();
    if (!title) {
      setTitleErr(true);
      titleRef.current?.focus();
      return;
    }
    const start = form.allDay
      ? fromInputs(form.date, "00:00", sel)
      : fromInputs(form.date, form.startT, sel);
    const endRaw = form.allDay
      ? atMins(start, 23 * 60 + 59)
      : fromInputs(form.date, form.endT, sel);
    // A 2h fallback if the end never got past the start — the donor's rule.
    const end = form.allDay ? endRaw : endRaw.getTime() > start.getTime() ? endRaw : addMin(start, 120);
    const selfOnly = form.kind === "blocked" && form.crew.length === 0;
    const opt = form.link ? LINK_OPTIONS.find((o) => o.id === form.link) : undefined;

    if (form.mode === "edit" && form.id) {
      const id = form.id;
      const row = data.find((x) => x.id === id);
      const nextCrew = selfOnly ? [OWNER.id] : form.crew.slice();
      const notesOut = form.notes.trim();

      // EDIT IS A REAL SERVER WRITE. It used to mutate React state and return,
      // so a manager could open a booking on a phone, add a crew member, watch
      // the chip appear, and have written nothing at all: no assignment, no
      // email to that worker, and the change gone on the next reload. Same
      // actions the desktop sheet calls, in the same order.
      if (row?.rid) {
        setSaveErr(null);
        setSaving(true);
        try {
          if (row.kind === "job") {
            await updateJobEvent(row.rid, { title, notes: notesOut || null });
            const timeChanged =
              row.start.getTime() !== start.getTime() || row.end.getTime() !== end.getTime();
            if (timeChanged || Boolean(row.allDay) !== form.allDay) {
              await rescheduleJobEventTime(row.rid, start.toISOString(), end.toISOString());
            }
            // Status and crew live on the JOB, not the event.
            if (row.jobId) {
              const picked = JOB_STATUSES.find((st) => st.value === form.status);
              if (picked && picked.value !== row.status) {
                await updateJob(row.jobId, {
                  status: picked.value as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED",
                });
              }
              await syncJobCrew(row, nextCrew);
            } else if (form.status !== row.status || nextCrew.join() !== row.workers.join()) {
              // Say it rather than drop it — the desktop refuses the same way.
              setSaving(false);
              setSaveErr(
                "This event is not linked to a job, so it has no status or crew of its own. The title, notes and times were saved.",
              );
            }
          } else if (row.kind === "appointment") {
            await updateAppointment(row.rid, {
              title,
              notes: notesOut || null,
              startsAt: start.toISOString(),
              endsAt: end.toISOString(),
              workerIds: nextCrew,
            });
          } else {
            // Blocked time has no update action - only a move.
            if (row.start.getTime() !== start.getTime()) {
              await rescheduleBlockedTime(row.rid, start.toISOString());
            }
          }
        } catch (err) {
          setSaving(false);
          setSaveErr(actionError(err));
          return;
        }
        setSaving(false);
      }

      setData((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x, title, start, end,
                allDay: form.allDay || undefined,
                status: x.kind === "job" ? form.status : x.status,
                workers: nextCrew,
                selfOnly: selfOnly || undefined,
                notes: notesOut || undefined,
              }
            : x,
        ),
      );
      setSel(new Date(start));
      setLandedId(id);
      closeForm();
      return;
    }

    const link = linkPayload(opt);
    const crew = form.crew.slice();
    const notes = form.notes.trim() || null;
    // The three tables have independent id spaces and one array holds all three,
    // so the DOM id carries a kind prefix — the scheme calendar-query.ts writes.
    let rowId = "";
    let rid: string | undefined;
    let jobId: string | null | undefined;

    setSaveErr(null);
    setSaving(true);
    try {
      if (form.kind === "job") {
        const res = await createJobEvent({
          title,
          jobId: link.jobId,
          proposalId: link.proposalId,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          notes,
        });
        rowId = res.id;
        rid = res.id;
        jobId = res.jobId;
        // Staffing is a JOB-level write, so it only exists once a job does: a
        // jobless event has nowhere to hang a crew, which is exactly what the
        // field's hint says while no job is linked.
        if (res.jobId && crew.length) {
          for (const w of crew) await assignWorker(res.jobId, w);
        }
      } else if (form.kind === "appointment") {
        const res = await createAppointment({
          title,
          leadId: link.leadId,
          clientId: link.clientId,
          proposalId: link.proposalId,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          notes,
          status: "SCHEDULED",
          workerIds: crew,
        });
        rowId = `apt:${res.id}`;
        rid = res.id;
      } else {
        const res = await createBlockedTime({
          reason: title,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
        rowId = `block:${res.id}`;
        rid = res.id;
      }
    } catch (err) {
      setSaving(false);
      setSaveErr(actionError(err));
      return;
    }
    setSaving(false);

    setData((prev) => [
      ...prev,
      {
        id: rowId, rid, jobId, kind: form.kind, title, start, end,
        allDay: form.allDay || undefined,
        status: form.kind === "job" ? form.status : "SCHEDULED",
        // A block is self-owned by construction (`createBlockedTime` takes no
        // owner), so it lands on the owner's row whatever the form said.
        workers: form.kind === "blocked" ? (OWNER.id ? [OWNER.id] : []) : crew,
        client: opt ? opt.client : undefined,
        selfOnly: form.kind === "blocked" || undefined,
        notes: form.notes.trim() || undefined,
      },
    ]);
    // Linking a tray job schedules it, so it leaves the unscheduled list.
    if (form.fromTray) setTray((prev) => prev.filter((j) => j.id !== form.fromTray));
    setCursor(new Date(start));
    setSel(new Date(start));
    setLandedId(rowId);
    closeForm();
  };

  const anyOverlay = Boolean(actEvent) || Boolean(detailEvent) || formOpen || inboxOpen || trayOpen;
  const closeAll = () => {
    setActId(null);
    setDetailId(null);
    closeForm();
    setInboxOpen(false);
    setTrayOpen(false);
  };

  // Swipe-down dismissal. Five sheets, five gestures, each on the same setter
  // the Escape ladder above uses — the detail sheet closes without disturbing
  // the actions sheet it was reached from.
  const actDrag = useSheetDrag(Boolean(actEvent), () => setActId(null));
  const detailDrag = useSheetDrag(Boolean(detailEvent), () => setDetailId(null));
  const inboxDrag = useSheetDrag(inboxOpen, () => setInboxOpen(false));
  const trayDrag = useSheetDrag(trayOpen, () => setTrayOpen(false));
  const formDrag = useSheetDrag(formOpen, () => closeForm());

  return (
    <div className={styles.app} onClick={onRootClick}>
      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, so the page holds none. It is the first child because its
          topbar is the only in-flow node it contributes, and that node fills
          the grid's first row. */}
      <MobileNav />

      {/* The ONE symbol this page adds. The shared sprite carries 48 and `ban`
          is not one of them; the i-calendar- prefix makes a collision with it —
          or with another page — impossible. Original lucide path, 24×24,
          stroke 2, currentColor. Absolutely positioned, so it claims no grid
          track: it is a definition, not a picture. */}
      <svg className={styles.sprite} aria-hidden="true" focusable="false">
        <symbol id="i-calendar-ban" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="m4.9 4.9 14.2 14.2" />
        </symbol>
      </svg>

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD */}
          <div className={styles.pageHead}>
            <div className={styles.kicker}>Delivery</div>
            <h1 className={styles.pageTitle}>Calendar</h1>
            <div className={styles.pageActions}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={() => openNew()}>
                <Icon id="i-plus" />New event
              </button>
              {/* The crew member's side of the same conversation (2026-08-22):
                  offers land answerable right on the calendar — the island
                  polls and auto-opens on arrival, same brain as the jobs page.
                  Hidden while the create/edit sheet is up, like on jobs. */}
              {!book.canManage && (
                <MobileJobOffers
                  // Answering changes the JOB's board labels, not this grid —
                  // the event row was already visible via the assignment.
                  // Nothing to reload here.
                  onAnswered={() => {}}
                  otherOverlayOpen={formOpen || inboxOpen || trayOpen || detailId !== null}
                />
              )}
              {/* Manager-only, like the desktop dispatch surfaces: a limited
                  role's seed carries no inbox, so the button was an empty
                  sheet — and confirmations are office work anyway. The badge
                  counts only PENDING rows; the ledger also holds answers. */}
              {book.canManage && (
                <button
                  className={`${styles.btn} ${styles.btnGhost}`}
                  type="button"
                  onClick={() => {
                    setInboxOpen(true);
                    // Looking is seeing: unseen answers clear on open, and
                    // the server remembers (fire-and-forget bookkeeping).
                    if (inboxUnseen) {
                      setInboxUnseen(0);
                      void markNavSeen("crewInbox").catch(() => {});
                    }
                  }}
                >
                  <Icon id="i-bell" />Crew inbox
                  {(() => {
                    const n =
                      inbox.filter((x) => (x.status ?? "PENDING") === "PENDING").length +
                      inboxUnseen;
                    return n ? <span className={styles.btnCount}>{n}</span> : null;
                  })()}
                </button>
              )}
            </div>
          </div>

          {/* SMARTBOOK REQUESTS (2026-10-31): customers waiting on a time they named — only when one waits, for the
              office and the sales reps; the card loads itself. */}
          {book.canManage || book.canSmartBook ? <SmartBookRequests mobile onBooked={reloadEvents} /> : null}

          {/* VIEW TABS — also the only aggregate left on the page: the count on
              each tab says how much is in that range, in the control you would
              use to go there. The masthead that used to sit here spent a whole
              card on "59h / 14 events / 4 unscheduled" above the schedule
              itself (removed, owner's call 2026-07-30). */}
          {/* The column count is inline because it is now DATA, not design: the
              stylesheet's `repeat(3, minmax(0,1fr))` was correct while every
              role saw three tabs, and would leave a worker a dead third column.
              The plate's width follows for the same reason — the stylesheet's
              33.3333% is the three-tab case of this. */}
          <div
            className={styles.tabs}
            style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}
          >
            <span
              className={styles.tabInd}
              style={{
                width: `${100 / views.length}%`,
                transform: `translateX(${views.findIndex((v) => v.key === view) * 100}%)`,
              }}
            />
            {views.map((v) => (
              <button
                key={v.key}
                className={`${styles.tab} ${view === v.key ? styles.active : ""}`}
                type="button"
                aria-current={view === v.key ? "page" : undefined}
                onClick={() => changeView(v.key)}
              >
                {v.label}
                <span className={styles.tabCount}>{counts[v.key]}</span>
              </button>
            ))}
          </div>

          {/* RANGE BAR — the desktop toolbar: prev / next / Today / title,
              plus the unscheduled tray and its badge. All flat: only the head
              pair and the filter carry a fill. */}
          <div className={styles.rbar}>
            {/* Flex rows, not a grid: the second row has to span the full width
                and a grid would need every child pinned to a column to keep
                auto-placement from claiming the wrong one. */}
            <div className={styles.rbarNav}>
              <button className={styles.navBtn} type="button" aria-label="Previous" onClick={() => step(-1)}>
                <Icon id="i-chevl" />
              </button>
              <div className={styles.rbarTitle}>{rangeTitle}</div>
              <button className={styles.navBtn} type="button" aria-label="Next" onClick={() => step(1)}>
                <Icon id="i-chevr" />
              </button>
            </div>
            <div className={styles.rbarBtns}>
              <button className={styles.rbarBtn} type="button" onClick={goToday}>
                <Icon id="i-target" />Today
              </button>
              <button className={styles.rbarBtn} type="button" onClick={() => setTrayOpen(true)}>
                <Icon id="i-board" />Unscheduled
                {tray.length ? <span className={styles.btnCount}>{tray.length}</span> : null}
              </button>
            </div>
          </div>

          {/* FIND BAR — search + the one filter dropdown */}
          <div className={styles.find}>
            <label className={styles.srch}>
              <Icon id="i-search" />
              <input
                className={styles.srchInput}
                type="search"
                value={query}
                placeholder="Search title, client or address…"
                autoComplete="off"
                aria-label="Search events"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button
                  className={styles.srchX}
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
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
                  {activeOption.label} · {filterCount(data, filter)}
                </span>
                <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
              </button>
              <div className={styles.ddMenu} role="listbox">
                {options.map((o) => (
                  <button
                    key={o.key}
                    className={`${styles.ddItem} ${filter === o.key ? styles.active : ""}`}
                    type="button"
                    role="option"
                    aria-selected={filter === o.key}
                    onClick={() => {
                      setFilter(o.key);
                      setFilterOpen(false);
                    }}
                  >
                    {o.label}
                    <span className={styles.ddCount}>{filterCount(data, o.key)}</span>
                    {filter === o.key ? <Icon id="i-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ============ VIEW: MONTH ============ */}
          {view === "month" && (
            <div className={styles.mcard}>
              <div className={styles.mgHead}>
                {DOW.map((d, i) => (
                  <span className={styles.mgHeadCell} key={d + i}>
                    <span className={styles.mgHeadLong}>{d}</span>
                    <span className={styles.mgHeadShort}>{DOW1[i]}</span>
                  </span>
                ))}
              </div>
              <div className={styles.mgGrid}>
                {monthCells.map((c) => {
                  const isToday = sameDay(c.day, TODAY);
                  const isSel = sameDay(c.day, sel);
                  const extra = Math.max(0, c.evs.length - MG_CAP);
                  return (
                    <button
                      key={c.day.toISOString()}
                      type="button"
                      className={`${styles.mgCell} ${c.out ? styles.isOut : ""} ${isToday ? styles.isToday : ""} ${isSel ? styles.isSel : ""}`}
                      aria-label={`${fmtDate(c.day)} — ${c.evs.length} events`}
                      aria-pressed={isSel}
                      onClick={() => setSel(c.day)}
                    >
                      <span className={styles.mgNum}>{c.day.getDate()}</span>
                      <span className={styles.mgDots}>
                        {c.evs.slice(0, MG_CAP).map((e) => (
                          <span
                            key={e.id}
                            className={`${styles.mgDot} ${e.kind === "appointment" ? styles.dotVia : TONE_DOT[toneKey(e)] ?? ""}`}
                            style={e.kind === "appointment" ? ({ "--via": VISIT_VIA[e.via || "team"].tone } as React.CSSProperties) : undefined}
                          />
                        ))}
                      </span>
                      {extra ? <span className={styles.mgMore}>+{extra}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* MONTH: the selected day's agenda. The head is deliberately
              lopsided — the DATE owns the row at 900 weight and the Add button
              is a hairline chip beside it. It used to be the other way round:
              a 1.5px ink box shouting ADD next to an 11px mono date, so the eye
              landed on the action before it knew which day it was on. */}
          {view === "month" && (
            <div className={styles.agenda}>
              <div className={styles.agHead}>
                <div className={styles.agHeadT}>
                  {DOW[sel.getDay()]} · {fmtDayShort(sel)}
                  {sameDay(sel, TODAY) ? <span className={styles.agToday}>Today</span> : null}
                </div>
                <button
                  className={styles.agAdd}
                  type="button"
                  onClick={() => openNew(sel)}
                  aria-label={`New event on ${fmtDate(sel)}`}
                >
                  <Icon id="i-plus" />Add
                </button>
              </div>
              {dayEvents.length ? (
                <div className={styles.agList}>
                  {dayEvents.map((e, i) => (
                    <EventRow
                      e={e}
                      i={i}
                      key={e.id}
                      landed={landedId === e.id}
                      onOpen={setActId}
                      onSelect={setDetailId}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.agEmpty}>
                  <EmptyState
                    what="day"
                    filtered={filtersActive}
                    onClear={resetFilters}
                    onNew={() => openNew()}
                  />
                </div>
              )}
            </div>
          )}

          {/* ============ VIEW: WEEK — one day per swipe ============
              Seven day COLUMNS side by side is ~40px of sliver each on a phone.
              The same seven days are now a scroll-snap rail: one full-width
              panel per swipe, the day's events as the same row cards the month
              agenda uses, and a tick rule underneath saying where you are. */}
          {view === "week" && (
            weekEvents.length === 0 ? (
              <EmptyState
                what="week"
                filtered={filtersActive}
                onClear={resetFilters}
                onNew={() => openNew()}
              />
            ) : (
              <div className={styles.railWrap}>
                <div
                  className={styles.rail}
                  ref={weekRailRef}
                  onScroll={(ev) => setWeekIdx(railIndex(ev.currentTarget, weekDays.length))}
                >
                  {weekDays.map((day) => {
                    const evs = weekEvents.filter((e) => sameDay(e.start, day)).sort(byStart);
                    return (
                      <section
                        className={styles.railCol}
                        key={day.toISOString()}
                        aria-label={fmtDate(day)}
                      >
                        <div className={styles.agHead}>
                          <div className={styles.agHeadT}>
                            {DOW[day.getDay()]} · {fmtDayShort(day)}
                            {sameDay(day, TODAY) ? <span className={styles.agToday}>Today</span> : null}
                          </div>
                          <button
                            className={styles.agAdd}
                            type="button"
                            onClick={() => openNew(day)}
                            aria-label={`New event on ${fmtDate(day)}`}
                          >
                            <Icon id="i-plus" />Add
                          </button>
                        </div>
                        {evs.length ? (
                          <div className={styles.agList}>
                            {evs.map((e, i) => (
                              <EventRow
                                e={e}
                                i={i}
                                key={e.id}
                                landed={landedId === e.id}
                                onOpen={setActId}
                                onSelect={setDetailId}
                              />
                            ))}
                          </div>
                        ) : (
                          <button className={styles.note} type="button" onClick={() => openNew(day)}>
                            Nothing scheduled — tap to book this day
                          </button>
                        )}
                      </section>
                    );
                  })}
                </div>
                {/* A measuring rule under the drawing, not a dot pager: seven
                    ticks across the full width, the live one filled blueprint,
                    plus the panel number in mono for anyone who cannot see it. */}
                <div className={styles.railMeta}>
                  <span className={styles.railTicks} aria-hidden="true">
                    {weekDays.map((d, i) => (
                      <i key={d.toISOString()} className={`${styles.railTick} ${i === weekIdx ? styles.on : ""}`} />
                    ))}
                  </span>
                  <span className={styles.railNow} aria-live="polite">
                    Day {weekIdx + 1} / {weekDays.length}
                  </span>
                </div>
              </div>
            )
          )}

          {/* ============ VIEW: TEAM — one crew member per swipe ============
              Same restructure as Week, keyed on the person instead of the day:
              the desktop's crew × 7-day grid becomes one full-width panel per
              installer. Rows carry their weekday on the time plate, since a
              crew panel spans the whole week. */}
          {view === "team" && (
            weekEvents.length === 0 ? (
              <EmptyState
                what="week"
                filtered={filtersActive}
                onClear={resetFilters}
                onNew={() => openNew()}
              />
            ) : (
              <div className={styles.railWrap}>
                <div
                  className={styles.rail}
                  ref={teamRailRef}
                  onScroll={(ev) => setTeamIdx(railIndex(ev.currentTarget, workersData.length))}
                >
                  {workersData.map((w) => {
                    const evs = weekEvents.filter((e) => e.workers.includes(w.id)).sort(byStart);
                    const hrs = evs.reduce((a, e) => a + eventHours(e), 0);
                    return (
                      <section className={styles.railCol} key={w.id} aria-label={`${w.name}, ${w.role}`}>
                        <div className={styles.tcardHead}>
                          <span className={`${styles.tav} ${evs.length ? styles.isOn : ""}`}>{initials(w.name)}</span>
                          <div className={styles.tWho}>
                            <div className={styles.tname}>{w.name}</div>
                            <div className={styles.trole}>{w.role}</div>
                          </div>
                          <div className={styles.tfigs}>
                            <div className={`${styles.tfigV} ${hrs ? "" : styles.isZero}`}>
                              {hrs ? `${Math.round(hrs)}h` : "—"}
                            </div>
                            <div className={styles.tfigL}>{evs.length} booked</div>
                          </div>
                        </div>
                        {evs.length ? (
                          <div className={styles.agList}>
                            {evs.map((e, i) => (
                              <EventRow
                                e={e}
                                i={i}
                                key={e.id}
                                landed={landedId === e.id}
                                showDay
                                onOpen={setActId}
                                onSelect={setDetailId}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className={styles.note}>Nothing on this week</div>
                        )}
                      </section>
                    );
                  })}
                </div>
                <div className={styles.railMeta}>
                  <span className={styles.railTicks} aria-hidden="true">
                    {workersData.map((w, i) => (
                      <i key={w.id} className={`${styles.railTick} ${i === teamIdx ? styles.on : ""}`} />
                    ))}
                  </span>
                  <span className={styles.railNow} aria-live="polite">
                    Crew {teamIdx + 1} / {workersData.length}
                  </span>
                </div>
              </div>
            )
          )}
        </div>
      </main>

      {/* ============ SHEET SCRIM (shared by all four sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={closeAll}
        aria-hidden="true"
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div
        className={`${styles.sheet} ${actEvent ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Event actions"
        aria-hidden={!actEvent}
        {...actDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...actDrag.handleProps} />
        <div className={styles.sheetHead} {...actDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {actEvent
              ? `${fmtDayShort(actEvent.start)} · ${actEvent.allDay ? "All day" : fmtRange(actEvent.start, actEvent.end)}`
              : "Event · —"}
          </div>
          <div className={styles.sheetTitle}>{actEvent?.title ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {menuRows.map((r) => (
            <button
              key={r.act}
              type="button"
              disabled={r.disabled}
              className={`${styles.mrow} ${r.danger ? styles.mrowDanger : ""}`}
              onClick={() => runMenu(r.act)}
            >
              <span className={`${styles.mrowIc} ${r.tone ?? ""}`}>
                <Icon id={r.icon} />
              </span>
              <span>
                <span className={styles.mrowT}>{r.title}</span>
                <span className={styles.mrowS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setActId(null)}>
          Cancel
        </button>
      </div>

      {/* ============ EVENT DETAIL SHEET ============
          What a row card cannot hold: the full span, the phone number, the
          whole crew, the scope and the notes. A tap on the row opens it; the
          "⋮" still goes straight to the actions, so the two paths never fight.
          Closing is the scrim, Escape, the foot, or a pull down on the handle —
          the house set. */}
      <div
        className={`${styles.sheet} ${detailEvent ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Event detail"
        aria-hidden={!detailEvent}
        {...detailDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...detailDrag.handleProps} />
        <div className={styles.sheetHead} {...detailDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {detailEvent
              ? `${DOW[detailEvent.start.getDay()]} · ${fmtDayShort(detailEvent.start)}`
              : "Event · —"}
          </div>
          <div className={styles.sheetTitle}>{detailEvent?.title ?? "Event"}</div>
        </div>
        <div className={styles.sheetBody}>
          {detailEvent ? (
            <>
              {/* Status leads, in its own tone; kind and span follow in the
                  neutral badge so three badges never read as three statuses. */}
              <div className={styles.dBadges}>
                <span
                  className={`${styles.estatus} ${detailEvent.kind === "appointment" ? styles.stVia : TONE_BADGE[toneKey(detailEvent)] ?? ""}`}
                  style={detailEvent.kind === "appointment" ? ({ "--via": VISIT_VIA[detailEvent.via || "team"].tone } as React.CSSProperties) : undefined}
                >
                  {detailEvent.kind === "appointment" ? <Icon id={VISIT_VIA[detailEvent.via || "team"].icon} className={`${styles.ic} ${styles.stViaIc}`} /> : null}
                  {toneLabel(detailEvent)}
                </span>
                <span className={styles.estatus}>{KIND_LABEL[detailEvent.kind]}</span>
                <span className={styles.estatus}>
                  {detailEvent.allDay
                    ? "All day"
                    : durLabel(detailEvent.end.getTime() - detailEvent.start.getTime())}
                </span>
              </div>

              <div className={styles.dSec}>
                <div className={styles.metaBox}>
                  {metaRowsFor(detailEvent).map(([l, v]) => (
                    <div className={styles.metaRow} key={l}>
                      <span className={styles.metaL}>{l}</span>
                      <span className={styles.metaV}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.dSec}>
                <div className={styles.dSecLbl}>Notes</div>
                {detailEvent.notes ? (
                  <div className={styles.dNote}>{detailEvent.notes}</div>
                ) : (
                  <div className={styles.note}>Nothing noted on this event</div>
                )}
              </div>

              {/* The way out of the calendar and into the work. Only job events
                  have a job to open, so on an appointment or a block the row is
                  simply not there — unlike the actions sheet, this is not a
                  fixed menu whose shape has to stay learnable. `.mrow` is the
                  house action row: ≥44px, icon plate, two lines. */}
              {detailEvent.jobId ? (
                <div className={styles.dSec}>
                  <div className={styles.dSecLbl}>Work</div>
                  <button
                    className={styles.mrow}
                    type="button"
                    onClick={() => {
                      const id = detailEvent.jobId;
                      setDetailId(null);
                      if (id) openJob(id);
                    }}
                  >
                    <span className={`${styles.mrowIc} ${styles.miBp}`}>
                      <Icon id="i-jobs" />
                    </span>
                    <span>
                      <span className={styles.mrowT}>Open job</span>
                      <span className={styles.mrowS}>Full record, crew and photos</span>
                    </span>
                  </button>
                </div>
              ) : null}

              {/* A visit's ways out (2026-10-16): the lead or client it is
                  for, the visit page (equipment + report), and — when the AI
                  desk booked it — the call log. */}
              {detailEvent.kind === "appointment" ? (
                <div className={styles.dSec}>
                  <div className={styles.dSecLbl}>Visit</div>
                  {visitLinks(detailEvent).map((l) => (
                    <button
                      key={l.href}
                      className={styles.mrow}
                      type="button"
                      onClick={() => {
                        setDetailId(null);
                        router.push(l.href as Route);
                      }}
                    >
                      <span className={`${styles.mrowIc} ${styles.miBp}`}>
                        <Icon id={l.icon} />
                      </span>
                      <span>
                        <span className={styles.mrowT}>{l.title}</span>
                        <span className={styles.mrowS}>{l.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => setDetailId(null)}>
            Close
          </button>
          {detailEvent?.kind === "desk" ? (
            book.canManage || detailEvent.deskUserId === book.desk?.me ? (
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                type="button"
                onClick={() => {
                  const e = detailEvent;
                  setDetailId(null);
                  void removeDesk(e);
                }}
                data-desk-remove
              >
                <Icon id="i-trash" />
                {detailEvent.deskWeekly ? "Remove every week" : "Remove these hours"}
              </button>
            ) : null
          ) : (
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={() => {
                const e = detailEvent;
                setDetailId(null);
                if (e) openEdit(e);
              }}
            >
              <Icon id="i-file" />Edit event
            </button>
          )}
        </div>
      </div>

      {/* ============ CREW INBOX SHEET ============ */}
      <div
        className={`${styles.sheet} ${inboxOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Crew confirmations"
        aria-hidden={!inboxOpen}
        {...inboxDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...inboxDrag.handleProps} />
        <div className={styles.sheetHead} {...inboxDrag.handleProps}>
          <div className={styles.sheetKicker}>Crew confirmations</div>
          <div className={styles.sheetTitle}>
            {inbox.filter((x) => (x.status ?? "PENDING") === "PENDING").length} pending
          </div>
        </div>
        <div className={styles.sheetBody}>
          {/* A confirmation LEDGER (2026-08-22): pending, accepted and declined
              rows all show — a decline must not vanish and read as handled.
              "Mark accepted" is a REAL write now; it used to filter local
              state only, and the row resurrected on the next seed read. */}
          {inbox.length ? (
            inbox.map((r) => {
              const st = r.status ?? "PENDING";
              return (
                <div className={styles.qrow} key={r.id}>
                  <div className={styles.qrowT}>{r.title}</div>
                  <div className={styles.qrowS}>
                    {r.worker} · {r.when}
                  </div>
                  <div className={styles.qrowFoot}>
                    <span
                      className={`${styles.estatus} ${
                        st === "ACCEPTED" ? styles.stDone : st === "DECLINED" ? styles.stCancel : styles.stProg
                      }`}
                    >
                      {st === "ACCEPTED" ? "Accepted" : st === "DECLINED" ? "Declined" : "Pending"}
                    </span>
                    {st === "PENDING" && (
                      <button
                        className={styles.queueBtn}
                        type="button"
                        onClick={() => {
                          setInbox((prev) =>
                            prev.map((x) => (x.id === r.id ? { ...x, status: "ACCEPTED" } : x)),
                          );
                          void markAssignmentAccepted(r.id).catch(() =>
                            setInbox((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, status: "PENDING" } : x)),
                            ),
                          );
                        }}
                      >
                        <Icon id="i-check" />Mark accepted
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.qempty}>
              <div className={styles.emptyT}>Everyone has confirmed</div>
              <div className={styles.emptyS}>All crew assignments have been accepted.</div>
            </div>
          )}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setInboxOpen(false)}>
          Close
        </button>
      </div>

      {/* ============ UNSCHEDULED TRAY SHEET ============
          The desktop aside was a drag source. There is no drag worth defending
          on touch, so each job carries the action instead: Schedule opens the
          create form pre-filled on the selected day, and creating consumes the
          job off this list. */}
      <div
        className={`${styles.sheet} ${trayOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Unscheduled work"
        aria-hidden={!trayOpen}
        {...trayDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...trayDrag.handleProps} />
        <div className={styles.sheetHead} {...trayDrag.handleProps}>
          <div className={styles.sheetKicker}>Unscheduled · drop onto a day</div>
          <div className={styles.sheetTitle}>{tray.length} waiting</div>
        </div>
        <div className={styles.sheetBody}>
          {tray.length ? (
            tray.map((j) => (
              <div className={styles.qrow} key={j.id}>
                <div className={styles.qrowT}>{j.title}</div>
                <div className={styles.qrowS}>
                  {j.client} · {j.city}
                </div>
                <div className={styles.qrowFoot}>
                  <span className={styles.qrowEst}>Est. {j.duration}</span>
                  <button className={styles.queueBtn} type="button" onClick={() => openNew(sel, j)}>
                    <Icon id="i-plus" />Schedule
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.qempty}>
              <div className={styles.emptyT}>Everything is scheduled</div>
              <div className={styles.emptyS}>No unscheduled work is waiting on a date.</div>
            </div>
          )}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setTrayOpen(false)}>
          Close
        </button>
      </div>

      {/* ============ CREATE / EDIT SHEET ============ */}
      <div
        className={`${styles.sheet} ${formOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcalFormTitle"
        aria-hidden={!formOpen}
        {...formDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...formDrag.handleProps} />
        <div className={styles.sheetHead} {...formDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {form.mode === "edit" ? "Delivery / edit event" : "Delivery / new record"}
          </div>
          <div className={styles.sheetTitle} id="mcalFormTitle">
            {form.mode === "edit" ? KIND_LABEL[form.kind] : "New event"}
          </div>
        </div>
        <form className={`${styles.sheetBody} ${styles.formBody}`} id="mcalForm" noValidate onSubmit={submitForm}>
          {/* The kind decides which fields exist, so it is only offered while
              creating — the desktop detail sheet does not re-kind an event
              either. */}
          {form.mode === "new" ? (
            <div className={styles.fld}>
              <span className={styles.fldLbl}>Kind</span>
              <div className={styles.kinds}>
                {createKinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`${styles.kindBtn} ${form.kind === k ? styles.active : ""}`}
                    aria-pressed={form.kind === k}
                    // The kind decides which record the picker links and which
                    // action the save calls, so a change to it retires the
                    // record picked under the previous one.
                    onClick={() => {
                      patchForm({ kind: k, link: null });
                      setLinkOpen(false);
                      setLinkQuery("");
                      setCrewOpen(false);
                      setSaveErr(null);
                    }}
                  >
                    <Icon id={KIND_IC[k]} />
                    {k === "job" ? "Job" : k === "appointment" ? "Visit" : k === "desk" ? "AI desk" : "Blocked"}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.metaBox}>
              {(() => {
                const e = form.id ? data.find((x) => x.id === form.id) : null;
                if (!e) return null;
                // Same builder the detail sheet uses. Notes are NOT appended
                // here — the editable field for them is a few rows down.
                return metaRowsFor(e).map(([l, v]) => (
                  <div className={styles.metaRow} key={l}>
                    <span className={styles.metaL}>{l}</span>
                    <span className={styles.metaV}>{v}</span>
                  </div>
                ));
              })()}
            </div>
          )}

          {form.kind !== "desk" ? (
            <div className={`${styles.fld} ${titleErr ? styles.invalid : ""}`}>
              <label className={styles.fldLbl} htmlFor="mcalTitle">
                Title<span className={styles.req}>*</span>
              </label>
              <input
                ref={titleRef}
                className={styles.pinput}
                id="mcalTitle"
                name="title"
                type="text"
                placeholder={
                  form.kind === "job"
                    ? "Roof tear-off — 4812 Maple Ave"
                    : form.kind === "appointment"
                      ? "Estimate visit — S. Rao"
                      : "Shop maintenance"
                }
                autoComplete="off"
                value={form.title}
                aria-invalid={titleErr}
                aria-describedby={titleErr ? "mcalTitleErr" : undefined}
                onChange={(e) => {
                  patchForm({ title: e.target.value });
                  if (e.target.value.trim()) setTitleErr(false);
                }}
              />
              {titleErr ? (
                <span className={styles.fldErr} id="mcalTitleErr">
                  Give the event a title
                </span>
              ) : null}
            </div>
          ) : null}

          {/* The house month grid, not `<input type="date">` — see the DATE AND
              TIME FIELDS note at the top of this file. Value is still the
              "YYYY-MM-DD" string the save path reads. */}
          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcalDate">Date</label>
            <DateField
              id="mcalDate"
              label="Date"
              value={form.date}
              onChange={(v) => patchForm({ date: v })}
              open={picker === "date"}
              onOpenChange={(o) => setPicker(o ? "date" : null)}
            />
          </div>

          {form.kind !== "desk" ? (
            <div className={styles.fld}>
              <span className={styles.fldLbl}>Span</span>
              <button
                className={`${styles.fchk} ${styles.allDayToggle}`}
                type="button"
                aria-pressed={form.allDay}
                onClick={() => patchForm({ allDay: !form.allDay })}
              >
                <span className={styles.fchkBox}>
                  <Icon id="i-check" />
                </span>
                All day
                <span className={styles.fchkSub}>no clock</span>
              </button>
            </div>
          ) : null}

          {/* Clock banks, not `<input type="time">`: the native control is an OS
              spinner on iOS and a Material dial on Android, and neither takes a
              single house style. Both faces still resolve to 24-hour "HH:MM". */}
          {!form.allDay ? (
            <div className={styles.pair}>
              <div className={styles.fld}>
                <span className={styles.fldLbl} id="mcalStartLbl">Start</span>
                <TimeField
                  label="Start"
                  value={form.startT}
                  onChange={setStartT}
                  open={picker === "start"}
                  onOpenChange={(o) => {
                    if (o) freezeSpan();
                    setPicker(o ? "start" : null);
                  }}
                />
              </div>
              <div className={styles.fld}>
                <span className={styles.fldLbl} id="mcalEndLbl">End</span>
                <TimeField
                  label="End"
                  value={form.endT}
                  onChange={(v) => patchForm({ endT: v })}
                  open={picker === "end"}
                  onOpenChange={(o) => setPicker(o ? "end" : null)}
                  describedBy="mcalEndHint"
                />
                <span className={styles.fldHint} id="mcalEndHint">
                  Left behind the start, it becomes a 2-hour span.
                </span>
              </div>
            </div>
          ) : null}

          {form.kind === "job" ? (
            <div className={styles.fld}>
              <span className={styles.fldLbl}>Status</span>
              <div className={styles.seg}>
                {JOB_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`${styles.segBtn} ${form.status === s.value ? styles.active : ""}`}
                    aria-pressed={form.status === s.value}
                    onClick={() => patchForm({ status: s.value })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* LINKED RECORD, per kind. A JOB event links a JOB; a VISIT links the
              LEAD it is about; blocked time links nothing. One kind each, so the
              picker never asks "which sort of thing?" before "which one?" —
              `LINK_TABS` is the map and this reads it. */}
          {linkKinds.length ? (
            <div className={styles.fld}>
              <span className={styles.fldLbl}>{LINK_FIELD_LABEL[form.kind] ?? "Linked record"}</span>
              <div className={styles.linkBox}>
                <button
                  className={styles.linkBtn}
                  type="button"
                  aria-expanded={linkOpen}
                  onClick={() => setLinkOpen((v) => !v)}
                >
                  <Icon id={form.kind === "job" ? "i-jobs" : "i-target"} />
                  <span className={`${styles.linkVal} ${linkPick ? "" : styles.linkNone}`}>
                    {linkPick ? linkPick.title : `No ${linkNoun} linked`}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.linkCaret}`} />
                </button>
                {linkOpen ? (
                  <div className={styles.linkPanel}>
                    <label className={styles.linkSrch}>
                      <Icon id="i-search" />
                      <input
                        className={styles.srchInput}
                        type="search"
                        value={linkQuery}
                        placeholder={`Search ${linkNoun}s…`}
                        autoComplete="off"
                        aria-label={`Search ${linkNoun}s to link`}
                        onChange={(e) => setLinkQuery(e.target.value)}
                      />
                    </label>
                    <div className={styles.linkList}>
                      <button
                        className={styles.linkRow}
                        type="button"
                        onClick={() => {
                          patchForm({ link: null });
                          setLinkOpen(false);
                        }}
                      >
                        <span className={styles.linkKind}>None</span>
                        <span className={styles.linkRowT}>Not linked</span>
                        <span className={styles.linkRowM}>Stand-alone entry on the schedule</span>
                      </button>
                      {linkRows.map((o) => (
                        <button
                          key={o.id}
                          className={styles.linkRow}
                          type="button"
                          onClick={() => {
                            patchForm({ link: o.id });
                            setLinkOpen(false);
                          }}
                        >
                          <span className={styles.linkKind}>{LINK_LABEL[o.kind]}</span>
                          <span className={styles.linkRowT}>{o.title}</span>
                          <span className={styles.linkRowM}>
                            {o.client} · {o.meta}
                          </span>
                        </button>
                      ))}
                      {linkRows.length === 0 ? (
                        <div className={styles.note}>
                          {linkQuery.trim()
                            ? `No ${linkNoun} matches that search`
                            : `This org has no ${linkNoun} to link yet`}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {form.kind === "desk" ? (
            <>
              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mcalDeskWho">For</label>
                {book.canManage ? (
                  <select id="mcalDeskWho" className={styles.pinput} value={form.deskWho ?? book.desk?.me ?? ""} onChange={(e) => patchForm({ deskWho: e.target.value })} data-desk-who>
                    <option value="">Anyone at the company</option>
                    {(book.desk?.people ?? []).map((x) => (
                      <option key={x.userId} value={x.userId}>
                        {x.userId === book.desk?.me ? `${x.name} (me)` : x.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className={styles.crewStatic}>
                    <Icon id="i-user" />
                    <span>{book.desk?.people[0]?.name ?? "Me"}</span>
                  </div>
                )}
              </div>
              <div className={styles.fld}>
                <button className={styles.fchk} type="button" aria-pressed={!!form.deskWeekly} onClick={() => patchForm({ deskWeekly: !form.deskWeekly })} data-desk-weekly>
                  <span className={styles.fchkBox}>
                    <Icon id="i-check" />
                  </span>
                  Every week
                  <span className={styles.fchkSub}>same day and hours</span>
                </button>
                <span className={styles.fldHint}>
                  {book.desk?.mode === "reserved"
                    ? "The AI desk books callers into these hours. Each visit goes to the person whose hours they are."
                    : "The AI desk books into these once the company switches to reserved hours (AI desk → When it can book visits). Each visit goes to the person whose hours they are."}
                </span>
              </div>
            </>
          ) : (
            <>
          {/* CREW — the desktop WorkerMultiPicker's semantics on a bottom sheet:
              search the roster, tap to toggle, chosen crew reads back as
              removable chips, and the count rides the collapsed face. */}
          <div className={styles.fld}>
            <span className={styles.fldLbl}>Crew</span>
            {form.kind === "blocked" ? (
              <>
                <div className={styles.crewStatic}>
                  <Icon id="i-user" />
                  <span>Just me · {OWNER.name || "You"}</span>
                </div>
                <span className={styles.fldHint}>
                  Blocked time belongs to whoever creates it — there is no owner to
                  pick. To block someone else&apos;s day, have them block it.
                </span>
              </>
            ) : (
              <div className={styles.linkBox}>
                {crewPicked.length ? (
                  <div className={styles.crewChips}>
                    {crewPicked.map((w) => (
                      <span className={styles.crewChip} key={w.id}>
                        <span className={styles.crewChipT}>{w.name}</span>
                        <button
                          className={styles.crewChipX}
                          type="button"
                          aria-label={`Remove ${w.name}`}
                          onClick={() => toggleCrew(w.id)}
                        >
                          <Icon id="i-x" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <button
                  className={styles.linkBtn}
                  type="button"
                  aria-expanded={crewOpen}
                  onClick={() => setCrewOpen((v) => !v)}
                >
                  <Icon id="i-users" />
                  <span className={`${styles.linkVal} ${crewPicked.length ? "" : styles.linkNone}`}>
                    {crewPicked.length ? "Add or remove crew" : "Nobody assigned"}
                  </span>
                  <span className={styles.crewCount}>
                    {crewPicked.length} / {workersData.length}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.linkCaret}`} />
                </button>
                {crewOpen ? (
                  <div className={styles.linkPanel}>
                    <label className={styles.linkSrch}>
                      <Icon id="i-search" />
                      <input
                        className={styles.srchInput}
                        type="search"
                        value={crewQuery}
                        placeholder="Search the roster…"
                        autoComplete="off"
                        aria-label="Search crew"
                        onChange={(e) => setCrewQuery(e.target.value)}
                      />
                    </label>
                    <div className={styles.linkList}>
                      {crewRows.map((w) => (
                        <button
                          key={w.id}
                          className={styles.crewRow}
                          type="button"
                          aria-pressed={form.crew.includes(w.id)}
                          onClick={() => toggleCrew(w.id)}
                        >
                          <span className={styles.fchkBox}>
                            <Icon id="i-check" />
                          </span>
                          <span className={styles.crewAv}>{initials(w.name)}</span>
                          <span className={styles.crewWho}>
                            <span className={styles.crewName}>{w.name}</span>
                            <span className={styles.crewRole}>{w.role}</span>
                          </span>
                        </button>
                      ))}
                      {crewRows.length === 0 ? (
                        <div className={styles.note}>
                          {workersData.length
                            ? "Nobody on the roster matches that"
                            : "You have no crew."}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {/* Staffing is a JOB-level write, so a job event with no job
                    linked has nowhere to hang a crew. Say so BEFORE the submit
                    quietly drops it. */}
                {form.kind === "job" && form.crew.length > 0 ? (
                  <span className={styles.fldHint}>
                    {linkPick
                      ? "Crew get an invite and confirm from the worker portal."
                      : "Crew need a linked job — pick one above, or this event saves unstaffed."}
                  </span>
                ) : null}
              </div>
            )}
          </div>
            </>
          )}

          {form.kind !== "desk" ? (
            <div className={styles.fld}>
              <label className={styles.fldLbl} htmlFor="mcalNotes">Notes</label>
              <textarea
                className={styles.parea}
                id="mcalNotes"
                name="notes"
                rows={3}
                placeholder="Anything the crew should know"
                value={form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
              />
            </div>
          ) : null}

          {/* A refusal from the server, in its own words. Above the foot rather
              than in it, so it cannot be pushed off by the keyboard. */}
          {saveErr ? (
            <div className={styles.formErr} role="alert">
              <Icon id="i-calendar-ban" />
              <span>{saveErr}</span>
            </div>
          ) : null}
        </form>
        {/* The submit pair sits in a beige foot OUTSIDE the scrolling body and
            reaches the form with form=. */}
        <div className={styles.formFoot}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            disabled={saving}
            onClick={closeForm}
          >
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            type="submit"
            form="mcalForm"
            disabled={saving}
          >
            <Icon id="i-check" />
            {saving
              ? form.kind === "blocked" ? "Blocking…" : form.kind === "desk" ? "Reserving…" : "Creating…"
              : form.mode === "edit"
                ? "Save changes"
                : form.kind === "blocked"
                  ? "Block time"
                  : form.kind === "desk"
                    ? "Reserve hours"
                    : "Create event"}
          </button>
        </div>
      </div>
    </div>
  );
}
