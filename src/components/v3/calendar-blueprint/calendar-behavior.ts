// Calendar blueprint — runtime behaviors, ported verbatim from the donor
// file's <script> (jobflex-calendar-blueprint_5.html). Every duration, easing,
// stagger, window (6:00–20:00), format string and formula is the donor's exact
// value. Adaptations are mechanical only:
// - queries are scoped to the mounted `.content` root instead of `document`;
// - document/window listeners and observers are tracked for unmount cleanup;
// - the donor blocks that belong to the PERSISTENT chrome are skipped, because
//   components/v3/blueprint-shell/shell-behavior.ts already owns them: the
//   mobile nav drawer / burger, FLUID SCALE, the sidebar entry cascade, the
//   sliding active-item indicator and the graph-paper parallax;
// - the donor's `window.matchMedia` polyfill (for file-preview webviews) is
//   dropped: it patched a global, and the browsers this app targets all ship
//   matchMedia;
// - the donor's unused `traySeq` counter is dropped (dead in the donor too).
//
// Everything the script injects lands inside `.content` — nothing is appended
// to document.body.

import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from "@/actions/appointments";
import {
  createBlockedTime,
  deleteBlockedTime,
  rescheduleBlockedTime,
} from "@/actions/blockedTime";
import {
  assignEventWorker,
  createJobEvent,
  deleteJobEvent,
  rescheduleJobEventTime,
  scheduleJobFromTray,
  updateJob,
  updateJobEvent,
} from "@/actions/jobs";
import { assignWorker, markAssignmentAccepted, unassignWorker } from "@/actions/workers";
import { markNavSeen } from "@/actions/notifications";
import { getCalendarSeed } from "@/app/dashboard/calendar/calendar-actions";
import { VISIT_VIA } from "@/lib/calendar/visitVia";
import { expandWindows, spanWords, zonedHhmm, zonedYmd } from "@/lib/deskHours";
import { removeDeskHours, reserveDeskHours } from "@/actions/deskHours";
import {
  TODAY as TODAY_FIXTURE,
  JOB_STATUSES,
  workersData as WORKERS_FIXTURE,
  EVENTS_SEED,
  TRAY_SEED,
  INBOX_SEED,
  LINK_OPTIONS as LINK_FIXTURE,
  LINK_TABS,
  LINK_LABEL,
  WG_START,
  WG_END,
  WG_ROW,
  SNAP_MIN,
  DOW,
  DOW1,
  KIND_IC,
  type CalendarSeed,
  type CalEvent,
  type CalKind,
  type InboxItem,
  type LinkOption,
  type TrayJob,
} from "./calendar-data";

export type CalendarContentOptions = {
  /** The org's real calendar, read server-side. Omit to fall back to the donor
   *  fixture (the standalone mock route has no session to read from). */
  seed?: CalendarSeed;
  /** Next's client-side router push, handed down from calendar-content.tsx.
   *
   *  Used by the detail sheet's "Open job". A `location.assign()` here would be
   *  a HARD document load, and the destination is a blueprint page whose
   *  entrance cascade is armed from a LAYOUT EFFECT — on a hard load the server
   *  HTML paints in full before hydration, so the job record appears finished,
   *  drops to opacity 0 and replays its entrance: the "it shows one version,
   *  then the real one" double take. A hard load also tears the shared shell
   *  down and rebuilds the sidebar. Same contract as clients-behavior.ts.
   *
   *  Optional: the standalone mock route mounts this module with no router, and
   *  the fixture has no job ids to open anyway. */
  navigate?: (href: string) => void;
};

/** The jobs board's own href shape (jobs-behavior.ts `jobHref`) — one shape, so
 *  the two surfaces cannot disagree about where a job lives. */
function jobHref(id: string): string {
  return "/dashboard/jobs/" + encodeURIComponent(id);
}

/**
 * `?date=YYYY-MM-DD` / `?new=1` — the overview's week card links here to open
 * on a specific day, optionally with the create sheet already up.
 *
 * Read once off `window.location` on mount, then removed from the URL (see
 * `clearEntryParams`) so a Back navigation into this page is just the calendar
 * and not the create sheet all over again. A missing or malformed date is a
 * no-op: `2026-02-31` rolls over in the Date constructor, so the only proof the
 * date was real is that it survives the round trip.
 */
function readEntryParams(): { date: Date | null; create: boolean; ev: string | null } {
  if (typeof window === "undefined") return { date: null, create: false, ev: null };
  // THIS EDITION IS NOT ALWAYS THE ONE THE USER GETS. `ResponsiveDashboardShell`
  // renders desktop on the server — it cannot know the viewport — and corrects
  // during hydration, so on a phone this module mounts, inits and unmounts
  // inside a single frame before `MobileCalendar` takes over. Consuming here
  // therefore STOLE `?date=` / `?new=1` from the handheld build, which then
  // opened on today with no create sheet. The same query the shell switches on,
  // evaluated at the same moment, so the two can only ever agree about which
  // edition owns the params.
  if (window.matchMedia("(max-width: 768px)").matches) return { date: null, create: false, ev: null };
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(window.location.search);
  } catch {
    return { date: null, create: false, ev: null };
  }
  const raw = q.get("date");
  const m = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  let date: Date | null = null;
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (
      !Number.isNaN(d.getTime()) &&
      d.getFullYear() === Number(m[1]) &&
      d.getMonth() === Number(m[2]) - 1 &&
      d.getDate() === Number(m[3])
    ) {
      date = d;
    }
  }
  // `?ev=apt:<id>` — one event's sheet open on arrival (the Phone page's "Open the
  // visit" on a call the AI desk booked, 2026-10-13). An id the loaded range does not
  // hold is a no-op in `openDetail`.
  const ev = q.get("ev");
  return { date, create: q.get("new") === "1", ev: ev && /^[a-z]+:[A-Za-z0-9_-]{1,64}$/.test(ev) ? ev : null };
}

/** Drop `date` / `new` / `ev` from the address bar without a navigation. */
function clearEntryParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("date") && !url.searchParams.has("new") && !url.searchParams.has("ev")) return;
  url.searchParams.delete("date");
  url.searchParams.delete("new");
  url.searchParams.delete("ev");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/** Server actions reject with an Error whose message is written for the user
 *  ("You can only change appointments you created or are staffed on.",
 *  "Link a lead, a client, or a proposal — not more than one"). Surface that
 *  text; fall back to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  // A Next.js server-action transport failure has no useful message.
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

export function initCalendarContent(
  content: HTMLElement,
  options: CalendarContentOptions = {},
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
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const byId = (id: string) => root.querySelector<HTMLElement>("#" + id);
  // The page's own controls listen through `on`, so a second start of this module on the same page (React runs every
  // effect twice in development) never leaves the first one's handlers behind — a stale copy acted on its own state
  // and saved a second, wrong event from one click (2026-10-16).
  const onId = (id: string, ev: string, fn: (e: Event) => void) => {
    const el = byId(id);
    if (el) on(el, ev, fn as EventListener);
  };
  // Click targets inside a button are often the icon, and an <svg>/<use> is an
  // SVGElement — NOT an HTMLElement. Returning null for those made every
  // delegated handler ignore clicks that landed on an icon: the filter
  // triggers, the kind tabs and the event chips all needed a second click on
  // their text to respond. Walk up to the nearest HTML ancestor instead.
  const asEl = (t: EventTarget | null): HTMLElement | null => {
    let n: Node | null = t instanceof Node ? t : null;
    while (n && !(n instanceof HTMLElement)) n = n.parentNode;
    return n instanceof HTMLElement ? n : null;
  };

  // Each block is wrapped so a failure in one does not disable the rest
  // (the donor's `safe()` helper).
  const safe = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error("[JobFlex] module failed: " + name, err);
    }
  };

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

  // ================= CALENDAR: DATA =================
  // Real data when the page's server component supplied it, the donor fixture
  // otherwise. `wired` is the single switch every mutation path checks: with a
  // seed each change is sent to its server action and reverted if refused;
  // without one the module stays the self-contained donor demo it started as.
  const seed = options.seed ?? null;
  const wired = seed !== null;
  /** Manager-level membership. Dispatch (tray, crew inbox, team re-assignment)
   *  goes through `requireManager()` actions — a sales rep or field worker sees
   *  those surfaces but must not be handed a drag that can only be rejected. */
  const canManage = seed ? seed.canManage : true;

  // The fixture's frozen "today" is a fixture detail; a live calendar opens on
  // the server's real date. Both are midnight-normalised so `sameDay` and the
  // `atMins` defaults behave identically.
  const TODAY = seed
    ? (function () {
        const d = new Date(seed.today);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      })()
    : TODAY_FIXTURE;
  /** Team-view rows and the crew picker. WorkerProfile ids on real data, which
   *  is the id space `assignWorker` / `syncAssignments` accept. */
  const workersData = seed ? seed.workers : WORKERS_FIXTURE;
  const LINK_OPTIONS = seed ? seed.links : LINK_FIXTURE;
  /** The kind tabs this role can actually submit — see `CalendarSeed`. */
  const CREATE_KINDS: CalKind[] = seed ? seed.createKinds : ["job", "appointment", "blocked"];

  // Runtime mutations (drag-to-reschedule, create, delete, confirm) — clone the
  // rows per mount so the module owns its copy and a revert has something to
  // restore to.
  const eventsData: CalEvent[] = (seed ? seed.events : EVENTS_SEED).map((e) => ({
    ...e,
    start: new Date(e.start),
    end: new Date(e.end),
    workers: e.workers.slice(),
    assignmentIds: { ...(e.assignmentIds || {}) },
  }));
  let trayJobs: TrayJob[] = (seed ? seed.tray : TRAY_SEED).map((j) => ({ ...j }));
  const inboxData: InboxItem[] = (seed ? seed.inbox : INBOX_SEED).map((r) => ({ ...r }));
  /** Crew answers not yet looked at — rides the bell on top of the pending
   *  count and clears when the sheet opens (seen-stamped server-side). */
  let inboxUnseen = seed?.inboxUnseen ?? 0;
  let evSeq = 100;

  // ---------- write plumbing ----------
  /** Failed writes have to say so. A drag-to-reschedule happens with no sheet
   *  open, so `#calToast` is the only surface that can carry the message. */
  let toastTimer = 0;
  function toast(msg: string, bad = true) {
    const el = byId("calToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("cal-toast--bad", bad);
    el.classList.add("on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.classList.remove("on"); }, 6000);
  }
  disposers.push(() => window.clearTimeout(toastTimer));

  /** Tracked timeouts — an unmount mid-animation must not fire the rest of a
   *  sequence into a detached tree. (The leaveRow scheduler that used this is
   *  gone — the crew inbox keeps its rows now — but the cleanup stays for any
   *  future tracked timer.) */
  const timers: number[] = [];
  disposers.push(() => { timers.forEach((t) => window.clearTimeout(t)); timers.length = 0; });

  /** Everything a move touches, so a refused write can be put back exactly. */
  type EvSnap = { start: Date; end: Date; workers: string[]; allDay?: boolean; lane?: number };
  function snapshot(e: CalEvent): EvSnap {
    return { start: new Date(e.start), end: new Date(e.end), workers: e.workers.slice(), allDay: e.allDay, lane: e.lane };
  }
  function restore(e: CalEvent, s: EvSnap) {
    e.start = s.start; e.end = s.end; e.workers = s.workers; e.allDay = s.allDay; e.lane = s.lane;
  }

  /**
   * Send a completed drag to the server. The local model has ALREADY moved and
   * rendered — this either confirms it or puts it back and says why.
   *
   * `workerId` is set only by a drop on a team-view row, which is a staffing
   * change as well as a move.
   */
  async function persistMove(e: CalEvent, before: EvSnap, workerId?: string) {
    if (!wired || !e.rid) return;
    // Checked BEFORE any write: throwing after the reschedule landed would send
    // the catch below into reverting a move the database had already accepted.
    if (workerId && e.kind === "job" && !e.jobId) {
      restore(e, before);
      renderCal();
      toast("This event isn’t linked to a job, so it has no crew to staff.");
      return;
    }
    try {
      if (e.kind === "job") {
        await rescheduleJobEventTime(e.rid, e.start.toISOString(), e.end.toISOString());
        if (workerId) {
          try {
            // ADDS the target worker to the job's crew — it does not strip the
            // others. Removing crew is the sheet's picker, which is why the
            // optimistic update in the drop handler appends rather than replaces.
            await assignEventWorker(e.rid, workerId);
          } catch (err) {
            // The move landed; only the staffing did not. Roll back the crew and
            // leave the block where the database now says it is.
            e.workers = before.workers.slice();
            renderCal();
            toast(actionError(err));
            return;
          }
        }
      } else if (e.kind === "appointment") {
        await updateAppointment(e.rid, {
          startsAt: e.start.toISOString(),
          endsAt: e.end.toISOString(),
          ...(workerId ? { workerIds: [workerId] } : {}),
        });
      } else {
        // Blocked time has exactly one move action and it changes the DATE
        // only, keeping the clock time. The local model was reconciled to that
        // before this ran (see `applyBlockedMove`), so nothing to fix up here.
        await rescheduleBlockedTime(e.rid, e.start.toISOString());
      }
    } catch (err) {
      restore(e, before);
      renderCal();
      toast(actionError(err));
    }
  }

  /**
   * Blocked time, moved. `rescheduleBlockedTime` is the whole API: it takes a
   * new date and re-applies the ORIGINAL time of day. Mirroring that formula
   * locally is what stops the grid from showing a slot the database does not
   * hold — and the user is told, once, when the drop asked for a time it could
   * not have.
   */
  function applyBlockedMove(e: CalEvent, before: EvSnap, day: Date, askedMins: number | null) {
    const s = new Date(day);
    s.setHours(before.start.getHours(), before.start.getMinutes(), 0, 0);
    e.start = s;
    e.end = new Date(s.getTime() + (before.end.getTime() - before.start.getTime()));
    e.allDay = before.allDay;
    e.lane = undefined;
    if (askedMins != null && askedMins !== before.start.getHours() * 60 + before.start.getMinutes()) {
      toast("Blocked time moves by the day — its time of day stays where you set it.", false);
    }
  }

  /** `?date=` / `?new=1`, read before the cursor is seeded so the calendar
   *  OPENS on the asked-for day instead of jumping to it after first paint. */
  const entry = readEntryParams();

  const cal = {
    view: "month" as "month" | "week" | "team",
    cursor: new Date(entry.date ?? TODAY),
    trayOpen: true,
    workers: [] as string[],
    statuses: [] as string[],
    query: "",
    dragEvent: null as string | null,
    dragJob: null as string | null,
    /** Minutes between a dragged block's start and the point it was grabbed. */
    dragGrabMin: 0,
    sheet: null as string | null,
    editing: null as string | null,
    kind: "job" as CalKind,
    /** Direction of the last cursor move — the view animates in from that side. */
    nav: "" as "" | "prev" | "next",
    /** Working state of the sheet's form controls (the custom pickers own their
     *  value here instead of in a native input). */
    form: {
      start: new Date(TODAY),
      end: new Date(TODAY),
      crew: [] as string[],
      link: null as string | null,
      status: "SCHEDULED",
      /** Which pop-over the pickers currently have open, if any. */
      pop: null as string | null,
      /** Month the picker calendars are browsing, per picker id. */
      calCursor: {} as Record<string, string>,
      linkTab: "all" as string,
      linkQuery: "",
      allDay: false,
    },
  };

  function sameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function startOfWeek(d: Date) {
    const x = new Date(d);
    x.setDate(x.getDate() - x.getDay());
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function fmtTime(d: Date) {
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + (m ? ":" + String(m).padStart(2, "0") : "") + " " + ap;
  }
  function fmtDate(d: Date) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
  }
  function fmtDayShort(d: Date) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  }
  function fmtMonthYear(d: Date) {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
  }
  /** "7:00 AM – 3:00 PM" — the range label used by chips, previews and pickers. */
  function fmtRange(a: Date, b: Date) {
    return fmtTime(a) + " – " + fmtTime(b);
  }
  function durLabel(ms: number) {
    const total = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return m + "m";
    return m ? h + "h " + m + "m" : h + "h";
  }
  /** Minutes since midnight. */
  function minsOf(d: Date) {
    return d.getHours() * 60 + d.getMinutes();
  }
  function addMin(d: Date, m: number) {
    return new Date(d.getTime() + m * 60000);
  }
  /** Same calendar day as `day`, at `mins` minutes past midnight. */
  function atMins(day: Date, mins: number) {
    const x = new Date(day);
    x.setHours(0, 0, 0, 0);
    return new Date(x.getTime() + mins * 60000);
  }
  function snapMins(mins: number) {
    return Math.round(mins / SNAP_MIN) * SNAP_MIN;
  }
  function initials(name: string) {
    return name.split(" ").map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase();
  }
  function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function statusCls(e: CalEvent) {
    if (e.kind === "job") return "evc--" + e.status.toLowerCase();
    // Hours reserved for the AI desk: an open frame, not a booking (2026-10-16).
    if (e.kind === "desk") return "evc--desk";
    // A visit wears its own card (2026-10-16): the channel's colour all round,
    // softer corners, and a tag saying who booked it — a job card never has one.
    if (e.kind === "appointment") return "evc--appointment evc--via-" + (e.via || "team") + (e.status === "CANCELED" ? " evc--apt-off" : "");
    return "evc--" + e.kind;
  }
  /** The chip's leading icon: the channel's for a visit, the kind's otherwise. */
  function evIcon(e: CalEvent) {
    if (e.kind === "appointment") return VISIT_VIA[e.via || "team"].icon;
    return KIND_IC[e.kind] || "i-cal";
  }
  /** "AI DESK" / "ONLINE" / "PLAN" / "OFFICE" — only visits carry one. */
  function viaTag(e: CalEvent) {
    if (e.kind !== "appointment") return "";
    return '<span class="evc-via">' + esc(VISIT_VIA[e.via || "team"].tag) + "</span>";
  }

  function visibleEvents() {
    const q = cal.query.trim().toLowerCase();
    return eventsData.filter(function (e) {
      if (cal.statuses.length && cal.statuses.indexOf(e.status) === -1) return false;
      if (cal.workers.length && !e.workers.some(function (w) { return cal.workers.indexOf(w) !== -1; })) return false;
      if (!q) return true;
      // "ai desk", "online", "plan" find the visits booked that way.
      const via = e.kind === "appointment" ? " " + VISIT_VIA[e.via || "team"].tag + " " + (e.visitFor || "") : "";
      return (e.title + " " + (e.client || "") + " " + (e.addr || "") + via).toLowerCase().indexOf(q) !== -1;
    });
  }
  function eventsOn(day: Date, workerId?: string) {
    return visibleEvents().filter(function (e) {
      if (!sameDay(e.start, day)) return false;
      if (workerId && e.workers.indexOf(workerId) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
  }
  function workerNames(e: CalEvent) {
    return e.workers.map(function (id) {
      const w = workersData.find(function (x) { return x.id === id; });
      return w ? w.name : id;
    });
  }

  // ================= RENDER: toolbar and filters =================
  function renderBar() {
    const c = cal.cursor;
    let title: string;
    if (cal.view === "month") {
      title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(c);
    } else {
      const st = startOfWeek(c), en = new Date(st); en.setDate(en.getDate() + 6);
      const sMo = new Intl.DateTimeFormat("en-US", { month: "short" }).format(st);
      const eMo = new Intl.DateTimeFormat("en-US", { month: "short" }).format(en);
      title = st.getMonth() === en.getMonth()
        ? sMo + " " + st.getDate() + "–" + en.getDate() + ", " + en.getFullYear()
        : sMo + " " + st.getDate() + " – " + eMo + " " + en.getDate() + ", " + en.getFullYear();
    }
    const calTitle = byId("calTitle");
    if (calTitle) calTitle.textContent = title;
    const inb = byId("inboxN");
    if (inb) {
      // The badge counts only UNANSWERED assignments — the ledger also holds
      // accepted/declined rows now, and those are history, not workload.
      const pendingN = inboxData.filter(function (r) {
        return (r.status ?? "PENDING") === "PENDING";
      }).length;
      // Workload + news: unanswered asks plus answers the office hasn't seen
      // (a decline must register here even when nothing is pending anymore).
      const bellN = pendingN + inboxUnseen;
      inb.textContent = String(bellN);
      inb.classList.toggle("is-hidden", bellN === 0);
    }
    const tr = byId("trayN");
    if (tr) {
      tr.textContent = String(trayJobs.length);
      tr.classList.toggle("is-hidden", trayJobs.length === 0 || cal.trayOpen);
    }
    const trayCount = byId("trayCount");
    if (trayCount) trayCount.textContent = String(trayJobs.length);
    byId("trayBtn")?.classList.toggle("active", cal.trayOpen);
    byId("trayBtn")?.setAttribute("aria-expanded", String(cal.trayOpen));
    byId("trayBtn")?.setAttribute("aria-label", cal.trayOpen ? "Expand calendar" : "Show unscheduled");
    const trayLabel = byId("trayLabel");
    if (trayLabel) trayLabel.textContent = cal.trayOpen ? "Expand calendar" : "Show unscheduled";
    byId("calWrap")?.classList.toggle("no-tray", !cal.trayOpen);
    byId("trayEmpty")?.classList.toggle("is-hidden", trayJobs.length !== 0);
  }
  const STATUS_DOT: Record<string, string> = {
    SCHEDULED: "var(--blueprint)", IN_PROGRESS: "var(--warning)",
    COMPLETED: "var(--success)", CANCELED: "var(--danger)",
  };

  /** Summary shown on a filter button: "All" / the single pick / "N selected". */
  function fddValue(picked: string[], labelOf: (v: string) => string) {
    if (!picked.length) return "All";
    if (picked.length === 1) return labelOf(picked[0]);
    return picked.length + " selected";
  }
  /** One filter dropdown: trigger + multi-select menu. The two sets are the
   *  only filter chrome left in the bar — the old row of one-chip-per-worker
   *  and one-chip-per-status buttons collapsed into these. */
  function fddHtml(opts: {
    id: string; icon: string; label: string; value: string;
    count: number; body: string; open: boolean;
  }) {
    return '<button class="fdd-btn' + (opts.count ? " on" : "") + '" type="button" data-fdd="' + opts.id +
        '" aria-expanded="' + opts.open + '">' +
        '<svg class="ic fdd-ic"><use href="#' + opts.icon + '"/></svg>' +
        '<span class="fdd-lbl">' + opts.label + '</span>' +
        '<span class="fdd-sep" aria-hidden="true"></span>' +
        '<span class="fdd-val">' + esc(opts.value) + '</span>' +
        '<span class="fdd-n' + (opts.count ? "" : " is-hidden") + '">' + (opts.count || "") + '</span>' +
        '<svg class="ic fdd-chev"><use href="#i-chev"/></svg>' +
      "</button>" +
      '<div class="fdd-menu" role="group">' +
        '<div class="fdd-menu-head"><span>' + opts.label + '</span>' +
          '<button class="fdd-reset" type="button" data-fdd-reset="' + opts.id + '">Reset</button></div>' +
        opts.body +
      "</div>";
  }

  /** The worker filter's own summary line, used by both the full render and the
   *  in-place patch so the two can never word it differently. */
  function workerSummary() {
    return fddValue(cal.workers, function (id) {
      const w = workersData.find(function (x) { return x.id === id; });
      return w ? w.name : id;
    });
  }

  /**
   * Repaint one dropdown's trigger WITHOUT touching its menu.
   *
   * Toggling an option used to run a full `renderFilters()`, which replaced the
   * open menu's innerHTML — so the row you had just clicked was destroyed
   * mid-click and every remaining row restarted its `calendar_optIn` entry
   * animation from `opacity: 0`. The selection did register, but the menu
   * blinked and the calendar behind it re-animated, which reads as "the click
   * did nothing". Now only the summary, the count badge and the clicked row
   * change, and the menu stays perfectly still.
   */
  function paintFddTrigger(hostId: string, value: string, count: number) {
    const host = byId(hostId);
    if (!host) return;
    host.querySelector<HTMLElement>(".fdd-btn")?.classList.toggle("on", count > 0);
    const val = host.querySelector<HTMLElement>(".fdd-val");
    if (val) val.textContent = value;
    const n = host.querySelector<HTMLElement>(".fdd-n");
    if (n) {
      n.textContent = count ? String(count) : "";
      n.classList.toggle("is-hidden", count === 0);
    }
  }

  /** The "Clear N" affordance — shared by the full render and the patch path. */
  function syncClear() {
    const n = cal.workers.length + cal.statuses.length + (cal.query.trim() ? 1 : 0);
    const clearN = byId("clearN");
    if (clearN) clearN.textContent = String(n);
    byId("calClear")?.classList.toggle("is-hidden", n === 0);
  }
  function renderFilters() {
    const wf = byId("workerFilter");
    if (wf) {
      const wasOpen = wf.classList.contains("open");
      wf.innerHTML = fddHtml({
        id: "worker", icon: "i-users", label: "Worker",
        value: workerSummary(),
        count: cal.workers.length,
        open: wasOpen,
        body: workersData.map(function (w) {
          const on = cal.workers.indexOf(w.id) !== -1;
          return '<button class="fdd-opt' + (on ? " on" : "") + '" type="button" data-w="' + w.id + '" aria-pressed="' + on + '">' +
            '<span class="ckbox"><svg class="ic"><use href="#i-check"/></svg></span>' +
            '<span class="cav">' + initials(w.name) + "</span>" +
            '<span class="fdd-opt-t">' + esc(w.name) + "<em>" + esc(w.role) + "</em></span>" +
            "</button>";
        }).join(""),
      });
      wf.classList.toggle("open", wasOpen);
    }
    // One button per status, each its own toggle. Active buttons take their own
    // status tones (border/fill/text) through `data-f`, the same pure-CSS
    // mechanism the proposals filter chips use.
    const sf = byId("statusFilter");
    if (sf) {
      sf.innerHTML = JOB_STATUSES.map(function (st) {
        const on = cal.statuses.indexOf(st.value) !== -1;
        return '<button class="sfil' + (on ? " on" : "") + '" type="button" data-s="' + st.value +
          '" data-f="' + st.value.toLowerCase() + '" aria-pressed="' + on + '">' + st.label + "</button>";
      }).join("");
    }
    syncClear();
  }
  function closeFdd() {
    $$(".fdd.open").forEach(function (d) {
      d.classList.remove("open");
      d.querySelector(".fdd-btn")?.setAttribute("aria-expanded", "false");
    });
  }

  // ================= RENDER: chips =================
  /**
   * Every JobEvent write — reschedule, staffing, delete — is behind
   * `requireManager()`. A sales rep or a field worker CAN see those chips and
   * CAN drag them, and every drag would be rejected on arrival. Offering a
   * gesture that can only ever be undone is worse than not offering it, so the
   * chip simply stops being draggable for them. Appointments and their own
   * blocked time stay draggable — those actions accept their role.
   */
  function canDrag(e: CalEvent) {
    // Reserved desk hours are edited from their sheet (remove, reserve again) — a drag has no action behind it.
    if (e.kind === "desk") return false;
    return canManage || e.kind !== "job";
  }

  function chipHtml(e: CalEvent, compact: boolean) {
    return '<button class="evc ' + statusCls(e) + '" type="button" draggable="' + canDrag(e) + '" data-ev="' + e.id + '">' +
      '<span class="evc-t"><svg class="ic"><use href="#' + evIcon(e) + '"/></svg><span class="evc-txt">' + esc(e.title) + "</span></span>" +
      (compact
        ? (e.kind === "appointment" ? '<span class="evc-time">' + viaTag(e) + "</span>" : "")
        : '<span class="evc-time">' + viaTag(e) + (e.allDay ? "All day" : fmtTime(e.start)) + " · " + esc(workerNames(e).join(", ") || (e.orgWide ? "everyone" : "unassigned")) + "</span>") +
      "</button>";
  }

  // ================= RENDER: month =================
  /** A month cell shows at most this many chips before it offers "show more". */
  const MG_CAP = 3;
  /** Days expanded past MG_CAP, by `toDateString()`. Reset when the month or the
   *  filters change — an expansion belongs to what is on screen now. */
  const mgOpen: string[] = [];
  const mgKey = (day: Date) => day.toDateString();

  function renderMonth() {
    const mgHead = byId("mgHead");
    if (mgHead) mgHead.innerHTML = DOW.map(function (d) { return "<span>" + d + "</span>"; }).join("");
    const first = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    let html = "";
    for (let w = 0; w < 6; w++) {
      html += '<div class="mg-row">';
      for (let d = 0; d < 7; d++) {
        const day = new Date(gridStart);
        day.setDate(day.getDate() + w * 7 + d);
        const out = day.getMonth() !== cal.cursor.getMonth();
        const evs = eventsOn(day);
        const open = mgOpen.indexOf(mgKey(day)) !== -1;
        const hidden = Math.max(0, evs.length - MG_CAP);
        const shown = open ? evs : evs.slice(0, MG_CAP);
        // The control is a real button so it is reachable by keyboard and cannot
        // be mistaken for the cell's own "click an empty day to create" surface.
        const more = hidden > 0
          ? '<button class="mg-more" type="button" data-more="' + day.toISOString() + '" aria-expanded="' + open + '">' +
            (open ? "Show less" : "Show " + hidden + " more") + "</button>"
          : "";
        html += '<div class="mg-cell' + (out ? " out" : "") + ((w + d) % 2 ? " alt" : "") +
          (sameDay(day, TODAY) ? " today" : "") + (open ? " is-open" : "") +
          '" data-day="' + day.toISOString() + '">' +
          '<div class="mg-day">' + day.getDate() + "</div>" +
          shown.map(function (e) { return chipHtml(e, false); }).join("") +
          more +
          "</div>";
      }
      html += "</div>";
    }
    const mgGrid = byId("mgGrid");
    if (mgGrid) mgGrid.innerHTML = html;
  }

  /** Expand or collapse one day's overflow. Only the month grid is redrawn — a
   *  full `renderCal()` would replay the card's entry animation for what is a
   *  local disclosure. */
  function toggleMonthMore(iso: string) {
    const key = mgKey(new Date(iso));
    const i = mgOpen.indexOf(key);
    if (i === -1) mgOpen.push(key); else mgOpen.splice(i, 1);
    renderMonth();
  }

  // ================= RENDER: week (time grid) =================
  // The week is a real time grid: one column per day, events absolutely
  // positioned and sized by their actual duration, so a 9-hour reroof reads as
  // a 9-hour block. Under the event layer sits a slot per hour — those are the
  // drop targets for drag-and-drop and the surface drag-to-create paints on.
  const WG_MINS = (WG_END - WG_START) * 60;
  const WG_H = (WG_END - WG_START) * WG_ROW;
  /** Minutes → offset in px inside a day column. */
  function yOfMins(mins: number) {
    return ((Math.max(WG_START * 60, Math.min(WG_END * 60, mins)) - WG_START * 60) / WG_MINS) * WG_H;
  }
  /** Offset in px inside a day column → minutes since midnight. */
  function minsOfY(y: number) {
    return WG_START * 60 + (Math.max(0, Math.min(WG_H, y)) / WG_H) * WG_MINS;
  }

  // ---- the week's preview block ----
  // One element serves both gestures: drawing a new span, and showing where a
  // dragged card will land. It survives the pointer release so the span the
  // user drew stays on the grid while the create form is open — it is cleared
  // when the form closes or when a render replaces the grid.
  let wgGhost: HTMLElement | null = null;
  /** Where the preview sat before the paint currently in progress — the "First"
   *  of a FLIP. Null when there is nothing to animate from. */
  let ghostFrom: DOMRect | null = null;

  function ghostIn(col: HTMLElement) {
    const layer = col.querySelector<HTMLElement>(".wg-evs");
    if (!layer) return null;
    // Create ONCE and move the same node between columns. It used to be removed
    // and rebuilt on every column change, which is why the preview vanished from
    // one column and reappeared in the next instead of travelling: a brand-new
    // element has no previous position to animate from.
    if (!wgGhost) {
      wgGhost = document.createElement("div");
      wgGhost.className = "wg-ghost";
    }
    ghostFrom = wgGhost.isConnected ? wgGhost.getBoundingClientRect() : null;
    if (wgGhost.parentElement !== layer) layer.appendChild(wgGhost);
    return wgGhost;
  }

  /**
   * Animate the preview from where it just was to where it now is.
   *
   * A transition cannot do this on its own: `left`/`width` are percentages of
   * the COLUMN, so crossing into a new column changes the containing block and
   * the browser has no continuous value to interpolate. Measuring the real
   * before/after boxes and animating the difference on `transform` works across
   * the re-parent, and stays on the compositor.
   */
  function flipGhost() {
    const el = wgGhost;
    const from = ghostFrom;
    ghostFrom = null;
    if (!el || !from || reduced()) return;
    const to = el.getBoundingClientRect();
    // Rects are in zoomed pixels; a transform is applied in the element's own
    // unzoomed space. Read the scale off the shell root, which is where FLUID
    // SCALE puts it.
    const host = el.closest<HTMLElement>(".jf-blueprint");
    const zRaw = host ? parseFloat(getComputedStyle(host).zoom) : NaN;
    const z = isFinite(zRaw) && zRaw > 0 ? zRaw : 1;
    const dx = (from.left - to.left) / z;
    const dy = (from.top - to.top) / z;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.transition = "none";
    el.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
    requestAnimationFrame(function () {
      if (!el.isConnected) return;
      // 160ms: inside the Motion System's UI band and deliberately at its fast
      // end — the preview has to keep up with the cursor, not trail it.
      el.style.transition = "transform 160ms cubic-bezier(0.22, 0.61, 0.36, 1)";
      el.style.transform = "translate(0,0)";
    });
  }
  function dropGhost() {
    clearPreview();
    wgGhost?.remove();
    wgGhost = null;
    $$(".wg-col.is-drawing").forEach(function (c) { c.classList.remove("is-drawing"); });
  }
  function paintGhost(day: Date, a: number, b: number, title: string, extra?: string, lane?: { lane: number; lanes: number }) {
    if (!wgGhost) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const top = yOfMins(lo), h = Math.max(yOfMins(hi) - top, 8);
    // Same flush-top correction as a real block, so the preview is the size and
    // position the card will actually land at — down to the hairline.
    const g = flushTop(top, h);
    wgGhost.className = "wg-ghost" + (extra ? " " + extra : "") + (h < 46 ? " is-tight" : "");
    wgGhost.style.cssText =
      "top:" + g.top.toFixed(1) + "px;height:" + g.height.toFixed(1) + "px;" +
      laneStyle(lane ? lane.lane : 0, lane ? lane.lanes : 1);
    wgGhost.innerHTML =
      '<span class="wg-ghost-t">' + esc(title) + "</span>" +
      '<span class="wg-ghost-time">' + fmtRange(atMins(day, lo), atMins(day, hi)) + "</span>" +
      '<span class="wg-ghost-dur">' + durLabel((hi - lo) * 60000) + "</span>";
    // Only the DROP preview glides. The drag-to-create preview is being resized
    // live under the pointer — animating that would make the box lag the hand
    // that is drawing it.
    if (extra === "is-move") flipGhost();
    else ghostFrom = null;
  }

  // ---- live drop preview ----
  // While a card is dragged over the grid, the column is laid out AS IF the card
  // were already there: the blocks it would share an hour with shrink into lanes
  // and the preview takes its own lane, so what you see is the result, not a
  // floating outline. The originals' inline geometry is stashed on the node and
  // written back when the pointer leaves.
  let previewCol: HTMLElement | null = null;
  let previewKey = "";
  function clearPreview() {
    if (!previewCol) return;
    previewCol.querySelectorAll<HTMLElement>(".wg-ev[data-geo]").forEach(function (el) {
      el.style.cssText = el.dataset.geo || "";
      delete el.dataset.geo;
      // The shrink may have crossed the "too short for a time line" threshold.
      el.classList.toggle("is-short", (parseFloat(el.style.height) || 999) < 42);
    });
    previewCol = null;
    previewKey = "";
  }
  /**
   * Which lane a block of `durMin` starting at `startMins` should take on `day`,
   * and how many lanes its overlap cluster therefore needs.
   *
   * The blocks that are STAYING are laid out on their own, exactly as they are
   * already rendered, and the newcomer is slotted into the first lane none of
   * them occupies at that moment. Because the dragged block is excluded, the
   * survivors' lane INDICES cannot move; only the divisor widens, so they narrow
   * to make room instead of trading places.
   *
   * Extracted so the DROP can ask the identical question the PREVIEW asked. The
   * preview alone was never enough: `layoutDay` has only two call sites and they
   * share no state, so the moment the drop re-rendered the week the preview's
   * answer was gone. See `CalEvent.lane`.
   */
  function laneFor(day: Date, startMins: number, durMin: number, dragId: string | null) {
    const gStart = atMins(day, startMins).getTime();
    const gEnd = atMins(day, startMins + durMin).getTime();
    const placed = layoutDay(
      eventsOn(day).filter(function (e) { return !e.allDay && e.id !== dragId; }),
    );
    // `layoutDay` floors every event at 15 minutes of height, so overlap is
    // tested against the same floor it used.
    const overlapping = placed.filter(function (p) {
      const s = p.e.start.getTime();
      return s < gEnd && Math.max(p.e.end.getTime(), s + 15 * 60000) > gStart;
    });
    const taken = overlapping.map(function (p) { return p.lane; });
    let lane = 0;
    while (taken.indexOf(lane) !== -1) lane += 1;
    const lanes = overlapping.reduce(function (n, p) { return Math.max(n, p.lanes); }, lane + 1);
    // Only the cluster the newcomer lands in narrows; a block elsewhere in the
    // day keeps its full width.
    overlapping.forEach(function (p) { p.lanes = lanes; });
    return { lane: lane, lanes: lanes, placed: placed };
  }

  function previewDrop(col: HTMLElement, day: Date, startMins: number, durMin: number, title: string, dragId: string | null) {
    const key = col.dataset.day + ":" + startMins + ":" + durMin;
    if (previewCol === col && previewKey === key) return;
    if (previewCol !== col) clearPreview();
    previewCol = col;
    previewKey = key;

    const { lane: gLane, lanes, placed } = laneFor(day, startMins, durMin, dragId);

    if (!ghostIn(col)) return;
    paintGhost(day, startMins, startMins + durMin, title, "is-move", { lane: gLane, lanes: lanes });
    placed.forEach(function (p) {
      const el = col.querySelector<HTMLElement>('.wg-ev[data-ev="' + p.e.id + '"]');
      if (!el) return;
      if (el.dataset.geo === undefined) el.dataset.geo = el.style.cssText;
      el.style.cssText = geoStyle(p);
      el.classList.toggle("is-short", p.height < 42);
    });
  }
  /** Pointer/drag Y → snapped minutes inside a day column. The column's box is
   *  zoomed exactly like the coordinates, so the ratio is zoom-free. */
  function minsAtY(col: HTMLElement, clientY: number) {
    const box = col.getBoundingClientRect();
    return snapMins(minsOfY(((clientY - box.top) / box.height) * WG_H));
  }
  /** Start time a drop should produce: the cursor minus where the block was
   *  grabbed, which is exactly where the browser's drag image is showing it.
   *  Clamped to the window only — not by duration, so a long job still lands
   *  where it was pointed instead of snapping back to fit. */
  function dropStartMins(col: HTMLElement, clientY: number) {
    const raw = minsAtY(col, clientY) - cal.dragGrabMin;
    return snapMins(Math.max(WG_START * 60, Math.min(WG_END * 60, raw)));
  }

  type Placed = { e: CalEvent; top: number; height: number; lane: number; lanes: number };
  /** Side-by-side lanes for overlapping events, computed per overlap cluster so
   *  a single 8-hour job never narrows the rest of the day. */
  function layoutDay(evs: CalEvent[]): Placed[] {
    const out: Placed[] = [];
    let cluster: Placed[] = [];
    let laneEnds: number[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes = laneEnds.length || 1;
      if (lanes > 1) honourLaneHints(cluster, lanes);
      cluster.forEach(function (p) { p.lanes = lanes; });
      out.push(...cluster);
      cluster = []; laneEnds = []; clusterEnd = -1;
    };
    evs.forEach(function (e) {
      const s = e.start.getTime();
      const en = Math.max(e.end.getTime(), s + 15 * 60000);
      if (clusterEnd !== -1 && s >= clusterEnd) flush();
      let lane = laneEnds.findIndex(function (t) { return t <= s; });
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(en); } else { laneEnds[lane] = en; }
      clusterEnd = Math.max(clusterEnd, en);
      const top = yOfMins(minsOf(e.start));
      const endMins = sameDay(e.start, e.end) ? minsOf(e.end) : WG_END * 60;
      cluster.push({ e: e, top: top, height: Math.max(22, yOfMins(endMins) - top), lane: lane, lanes: 1 });
    });
    if (cluster.length) flush();
    return out;
  }

  /**
   * Give a just-dropped block back the lane its preview showed, by trading with
   * whoever greedily took that lane first.
   *
   * A hint pointing outside this cluster's width is ignored, which is what makes
   * a stale hint harmless once the day stops splitting that far.
   *
   * CAREFUL: a single lane can hold SEVERAL blocks in one cluster — they merely
   * have to be disjoint in time from each other, not from everything. An earlier
   * version of this asked `cluster.find(q => q.lane === want)` and traded with
   * the first match, which silently rendered two cards on top of each other
   * whenever the lane held more than one block. Both sides of the trade are
   * therefore checked here: nothing in the target lane may overlap the incoming
   * block, and the displaced partner must survive the lane being vacated.
   */
  function honourLaneHints(cluster: Placed[], lanes: number) {
    const span = (p: Placed): [number, number] => {
      const s = p.e.start.getTime();
      return [s, Math.max(p.e.end.getTime(), s + 15 * 60000)];
    };
    const hits = (a: Placed, b: Placed) => {
      const [aS, aE] = span(a);
      const [bS, bE] = span(b);
      return aS < bE && bS < aE;
    };
    cluster.forEach(function (p) {
      const want = p.e.lane;
      if (want == null || want === p.lane || want < 0 || want >= lanes) return;
      // Everything already in `want` that p would sit on top of.
      const blockers = cluster.filter(function (q) {
        return q !== p && q.lane === want && hits(p, q);
      });
      if (blockers.length === 0) {
        p.lane = want; // the lane is free at p's hours — just take it
        return;
      }
      if (blockers.length > 1) return; // one trade cannot clear two
      const other = blockers[0];
      // The partner has to survive the lane p is vacating, too.
      const clash = cluster.some(function (q) {
        return q !== p && q !== other && q.lane === p.lane && hits(other, q);
      });
      if (clash) return;
      other.lane = p.lane;
      p.lane = want;
    });
  }

  /** Gap between two blocks sharing an hour. Only BETWEEN them — a single block,
   *  and the outer edges of a split pair, stay flush with the column's grid
   *  lines, so nothing floats inside its cell. */
  const LANE_GAP = 3;
  function laneStyle(lane: number, lanes: number) {
    if (lanes <= 1) return "left:0;width:100%;";
    const inner = (lanes - 1) * LANE_GAP;
    // w = (100% - inner) / n ; left = lane * (w + gap) = lane * (100% + gap) / n
    return "left:calc((100% + " + LANE_GAP + "px) * " + lane + " / " + lanes + ");" +
      "width:calc((100% - " + inner + "px) / " + lanes + ");";
  }

  /** Width of the week grid's hour hairlines. Mirrors the `1.5px` on `.wg-slot`'s
   *  `border-bottom` in calendar.module.css — the two must move together. */
  const GRID_LINE = 1.5;
  /**
   * A block's own 1.5px top border and the hour line it starts on are two
   * SEPARATE hairlines. `.wg-slot` draws its line at the BOTTOM of its box, so a
   * block starting on the hour begins immediately below that line and the pair
   * abuts into one 3px rule. At the other end the block's bottom border lands
   * exactly ON its last slot's line, the two coincide, and the result is 1.5px —
   * hence the reported "thick on top, thin on the bottom".
   *
   * Shifting a flush block up by one line width makes its top border paint over
   * the hour line, so both edges read at the same 1.5px. The height grows to
   * match, which keeps the block's bottom edge exactly where the time says it
   * is. Row 0 is excluded: the line above it belongs to the head (a 2px ink
   * rule) and is the card's boundary already.
   */
  function flushTop(top: number, height: number) {
    const onLine = top > 0.5 && Math.abs(top % WG_ROW) < 0.5;
    return onLine
      ? { top: top - GRID_LINE, height: height + GRID_LINE, onLine: true }
      : { top: top, height: height, onLine: false };
  }
  function geoStyle(p: Placed) {
    const g = flushTop(p.top, p.height);
    return "top:" + g.top.toFixed(1) + "px;height:" + g.height.toFixed(1) + "px;" + laneStyle(p.lane, p.lanes);
  }
  /**
   * Whether this block's edges may be dragged to change its span.
   *
   * Four things have to be true, and each of them is a write or a drawing that
   * would otherwise lie:
   * - BLOCKED TIME has exactly one move action and `rescheduleBlockedTime`
   *   keeps both the clock time AND the duration, so no server call exists that
   *   could land a resize. The gesture is not offered rather than refused on
   *   release — the same reasoning `canDrag` applies to a role that cannot
   *   write.
   * - ALL-DAY events are drawn in the band above the grid, where an hour has no
   *   height to drag.
   * - A block that does not START AND END on its own day is drawn clipped at
   *   the window's edge (`layoutDay` caps it at WG_END), so the handle would
   *   sit on the clip, not on the time. Same for a span that runs outside
   *   06:00–20:00 at either end.
   * - And the role has to be allowed to move the thing at all, which is exactly
   *   what `canDrag` already decides.
   */
  function canResize(e: CalEvent) {
    if (e.kind === "blocked" || e.allDay) return false;
    if (!sameDay(e.start, e.end)) return false;
    if (minsOf(e.start) < WG_START * 60 || minsOf(e.end) > WG_END * 60) return false;
    return canDrag(e);
  }

  function weekEvHtml(p: Placed) {
    const short = p.height < 42;
    return '<button class="evc wg-ev ' + statusCls(p.e) + (short ? " is-short" : "") +
      (flushTop(p.top, p.height).onLine ? " is-flush-top" : "") + '" type="button" draggable="' + canDrag(p.e) + '"' +
      ' data-ev="' + p.e.id + '"' +
      ' style="' + geoStyle(p) + '">' +
      '<span class="evc-t"><svg class="ic"><use href="#' + evIcon(p.e) + '"/></svg>' +
      '<span class="evc-txt">' + esc(p.e.title) + "</span></span>" +
      '<span class="wg-ev-time">' + viaTag(p.e) + fmtRange(p.e.start, p.e.end) + "</span>" +
      // The two edge grips. Rendered inside the block (which is the containing
      // block for them) and marked aria-hidden: they are a pointer affordance
      // for a gesture the sheet's own start/end pickers already expose to the
      // keyboard, so announcing them would add two stops that do nothing.
      (canResize(p.e)
        ? '<span class="wg-rz wg-rz--t" data-rz="start" aria-hidden="true"></span>' +
          '<span class="wg-rz wg-rz--b" data-rz="end" aria-hidden="true"></span>'
        : "") +
      "</button>";
  }

  /** All-day events overlapping `day` — they span dates, so a same-day test on
   *  the start would hide days 2..n of a multi-day block. */
  function allDayOn(day: Date) {
    const d0 = new Date(day); d0.setHours(0, 0, 0, 0);
    const d1 = d0.getTime() + 86400000;
    return visibleEvents().filter(function (e) {
      if (!e.allDay) return false;
      return e.start.getTime() < d1 && e.end.getTime() >= d0.getTime();
    }).sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
  }

  function renderWeek() {
    const st = startOfWeek(cal.cursor);
    // Row 1 of `#wgHead`: the gutter corner plus seven day names, as DIRECT
    // children of the grid. No wrapper — see the note in calendar-content.tsx.
    let head = '<span class="wg-corner"><svg class="ic"><use href="#i-clock"/></svg></span>';
    for (let d = 0; d < 7; d++) {
      const day = new Date(st); day.setDate(day.getDate() + d);
      head += '<span class="' + (sameDay(day, TODAY) ? "today" : "") + '">' +
        DOW[d] + ' <b>' + day.getDate() + "</b></span>";
    }

    // All-day band — only when the week actually has all-day events, so a week
    // without any keeps the grid flush against the day names.
    const adCols: string[] = [];
    let adAny = false;
    for (let d = 0; d < 7; d++) {
      const day = new Date(st); day.setDate(day.getDate() + d);
      const evs = allDayOn(day);
      if (evs.length) adAny = true;
      adCols.push('<div class="wg-ad-cell" data-day="' + day.toISOString() + '">' +
        evs.map(function (e) {
          return '<button class="evc wg-ad-ev ' + statusCls(e) + '" type="button" draggable="true" data-ev="' + e.id + '">' +
            '<span class="evc-t"><svg class="ic"><use href="#' + evIcon(e) + '"/></svg>' +
            '<span class="evc-txt">' + esc(e.title) + "</span></span></button>";
        }).join("") + "</div>");
    }
    // Row 2, when the week has any all-day work: the label lands in the gutter
    // track and the seven cells in the day tracks, on the SAME grid as row 1.
    if (adAny) {
      head += '<div class="wg-ad-lbl">All day</div>' + adCols.join("");
    }
    const wgHead = byId("wgHead");
    // The all-day row needs no state class: its cells carry their own top rule
    // and paper fill, so they simply are not there on a week without all-day work.
    if (wgHead) wgHead.innerHTML = head;

    // Hour gutter — full words ("6 AM", not "6a").
    let gutter = '<div class="wg-gutter">';
    for (let h = WG_START; h < WG_END; h++) {
      const hh = h % 12 || 12;
      gutter += '<div class="wg-hour"><span>' + hh + " " + (h >= 12 ? "PM" : "AM") + "</span></div>";
    }
    gutter += "</div>";

    let body = gutter;
    for (let d = 0; d < 7; d++) {
      const day = new Date(st); day.setDate(day.getDate() + d);
      const isToday = sameDay(day, TODAY);
      let slots = "";
      for (let h = WG_START; h < WG_END; h++) {
        slots += '<div class="wg-slot" data-hour="' + h + '"></div>';
      }
      // All-day events live in the band above, never in the time grid.
      const placed = layoutDay(eventsOn(day).filter(function (e) { return !e.allDay; }));
      body += '<div class="wg-col' + (d === 0 || d === 6 ? " wknd" : "") + (isToday ? " today" : "") + '"' +
        ' data-day="' + day.toISOString() + '" data-timecol="1">' +
        slots +
        '<div class="wg-evs">' + placed.map(weekEvHtml).join("") + "</div>" +
        (isToday ? '<div class="wg-now" data-now></div>' : "") +
        "</div>";
    }
    const wgBody = byId("wgBody");
    if (wgBody) wgBody.innerHTML = body;
    // The preview block lived inside the markup just replaced.
    wgGhost = null;
    syncNowLine();
  }

  /** The "now" marker on today's column: a hairline + dot at the wall clock,
   *  hidden when the current time falls outside the 6:00–20:00 window. */
  function syncNowLine() {
    const line = root.querySelector<HTMLElement>("[data-now]");
    if (!line) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const inside = mins >= WG_START * 60 && mins <= WG_END * 60;
    line.classList.toggle("is-hidden", !inside);
    if (inside) {
      line.style.top = yOfMins(mins).toFixed(1) + "px";
      line.dataset.label = fmtTime(now);
    }
  }

  // ================= RENDER: team =================
  function renderTeam() {
    const st = startOfWeek(cal.cursor);
    let head = "<span>Crew</span>";
    for (let d = 0; d < 7; d++) {
      const day = new Date(st); day.setDate(day.getDate() + d);
      head += "<span>" + DOW[d] + " " + day.getDate() + "</span>";
    }
    const tgHead = byId("tgHead");
    if (tgHead) tgHead.innerHTML = head;
    const tgBody = byId("tgBody");
    if (!tgBody) return;
    tgBody.innerHTML = workersData.map(function (w) {
      let row = '<div class="tg-row">' +
        '<div class="tg-who"><span class="cav">' + w.name.split(" ").map(function (p) { return p[0]; }).join("").slice(0, 2) + "</span>" +
        '<span><span class="tg-name" style="display:block">' + esc(w.name) + "</span>" +
        '<span class="tg-role" style="display:block">' + esc(w.role) + "</span></span></div>";
      for (let d = 0; d < 7; d++) {
        const day = new Date(st); day.setDate(day.getDate() + d);
        const evs = eventsOn(day, w.id);
        const weekend = d === 0 || d === 6;
        row += '<div class="tg-cell' + (weekend && evs.length === 0 ? " off" : "") + ((d + workersData.indexOf(w)) % 2 ? " alt" : "") + '" data-day="' + day.toISOString() + '" data-worker="' + w.id + '">' +
          evs.map(function (e) { return chipHtml(e, true); }).join("") + "</div>";
      }
      return row + "</div>";
    }).join("");
  }

  // ================= RENDER: tray =================
  function renderTray() {
    const trayList = byId("trayList");
    if (!trayList) return;
    trayList.innerHTML = trayJobs.map(function (j) {
      return '<div class="tray-card" draggable="true" data-job="' + j.id + '">' +
        '<div class="tray-t">' + esc(j.title) + "</div>" +
        '<div class="tray-c">' + esc(j.client) + " · " + esc(j.city) + "</div>" +
        '<div class="tray-m">Est. ' + esc(j.duration) + " · drag to a day</div>" +
        "</div>";
    }).join("");
  }

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderCal() {
    renderBar(); renderFilters();
    byId("monthCard")?.classList.toggle("is-hidden", cal.view !== "month");
    byId("weekCard")?.classList.toggle("is-hidden", cal.view !== "week");
    byId("teamCard")?.classList.toggle("is-hidden", cal.view !== "team");
    if (cal.view === "month") renderMonth();
    if (cal.view === "week") renderWeek();
    if (cal.view === "team") renderTeam();
    renderTray();
    playViewAnim();
  }
  /** The view the swap animation last played for — so a re-render that changed
   *  neither the view nor the cursor does not replay it. */
  let animatedView = "";
  /** Installed by the motion module below: replays one list's staggered row
   *  entrance. Stays null under `prefers-reduced-motion`. */
  let staggerRows: ((hostId: string) => void) | null = null;
  /** Same contract for the week and team grids' chips. Separate from
   *  `staggerRows` because those two hosts are addressed together and neither
   *  is ever cascaded on its own. */
  let staggerChips: (() => void) | null = null;
  /**
   * The active card animates in: from the right/left when the cursor moved
   * next/prev, straight up when the view itself changed.
   *
   * NOT on anything else. This used to fire on every single `renderCal()`, so
   * toggling a worker filter, typing in the search box or opening the tray
   * replayed the whole card's entry animation — the grid flashed and slid on
   * every keystroke and every click, which is what made the filters read as
   * broken rather than merely noisy.
   */
  function playViewAnim() {
    const viewChanged = animatedView !== cal.view;
    animatedView = cal.view;
    if (reduced()) { cal.nav = ""; return; }
    if (!cal.nav && !viewChanged) return;
    // The month's rows cascade on the same signal as the card itself, so a real
    // navigation still reads as a page of the calendar turning.
    staggerRows?.("mgGrid");
    staggerChips?.();
    const card = byId(cal.view === "month" ? "monthCard" : cal.view === "week" ? "weekCard" : "teamCard");
    if (!card) { cal.nav = ""; return; }
    const cls = cal.nav === "next" ? "swap-next" : cal.nav === "prev" ? "swap-prev" : "swap-in";
    card.classList.remove("swap-next", "swap-prev", "swap-in");
    void card.offsetWidth;
    card.classList.add(cls);
    card.addEventListener("animationend", function ae() {
      card.classList.remove("swap-next", "swap-prev", "swap-in");
      card.removeEventListener("animationend", ae);
    });
    cal.nav = "";
  }

  // ================= PANELS =================
  // `.content` carries z-index 1 in the shell, which makes it a stacking
  // context BELOW the sticky topbar (z-index 30) — so the panel, fixed and at
  // z-index 111, still painted under the topbar. The CSS lifts `.content` while
  // `.sheet.open` exists; locking `.main` here keeps the page from scrolling
  // underneath the lifted layer.
  let scrollLock = "";
  // Navigating away with the panel open never runs closeSheet, and `.main`
  // belongs to the shell — it would stay locked on the next page.
  disposers.push(() => {
    if (main && scrollLock) main.style.overflowY = scrollLock === "auto" ? "" : scrollLock;
    scrollLock = "";
  });
  function openSheet(title: string, html: string) {
    const sheetTitle = byId("sheetTitle");
    if (sheetTitle) sheetTitle.textContent = title;
    const sheetBody = byId("sheetBody");
    if (sheetBody) sheetBody.innerHTML = html;
    byId("sheet")?.classList.add("open");
    byId("sheetBg")?.classList.add("open");
    if (main && !scrollLock) {
      scrollLock = main.style.overflowY || "auto";
      main.style.overflowY = "hidden";
    }
  }
  function closeSheet() {
    byId("sheet")?.classList.remove("open");
    byId("sheetBg")?.classList.remove("open");
    // A refusal belongs to the form that caused it — it must not greet the next
    // thing opened in this panel.
    sheetBusy = false;
    // Nothing was created, so the span the preview was holding is released.
    dropGhost();
    cal.sheet = null; cal.editing = null; cal.form.pop = null;
    if (main && scrollLock) {
      main.style.overflowY = scrollLock === "auto" ? "" : scrollLock;
      scrollLock = "";
    }
  }
  // ---------- sheet form controls ----------
  // Native <input type="date">/<input type="time"> are replaced by two
  // date-time pickers (Start / End), a crew dropdown and a job-or-proposal
  // picker. All three keep their value in `cal.form` and repaint in place.

  /** Whoever owns the shop — an empty crew on a blocked event means "my time".
   *  A real org can have no WorkerProfile rows at all (a solo contractor who
   *  never invited anyone), so this falls back to a row-less stand-in rather
   *  than indexing off the end of an empty roster. */
  const OWNER = workersData.find(function (w) { return w.role === "Owner"; })
    || workersData[workersData.length - 1]
    || { id: "", name: "You", role: "Owner" };

  const DTP_ICON: Record<string, string> = { start: "i-clock", end: "i-hourglass" };
  const DTP_LABEL: Record<string, string> = { start: "Start", end: "End" };

  function dtpValue(id: string) {
    return id === "start" ? cal.form.start : cal.form.end;
  }
  function dtpCursor(id: string) {
    const stored = cal.form.calCursor[id];
    const d = stored ? new Date(stored) : new Date(dtpValue(id));
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  /** All-day events are stated as dates, so the whole clock half of the picker
   *  (trigger time, time column, duration) drops out of the UI. */
  function allDayLabel() {
    const a = cal.form.start, b = cal.form.end;
    return sameDay(a, b) ? "All day · " + fmtDayShort(a) : "All day · " + fmtDayShort(a) + " – " + fmtDayShort(b);
  }

  /** The month grid + time column inside a picker's pop-over. */
  function dtpPopHtml(id: string) {
    const val = dtpValue(id);
    const cur = dtpCursor(id);
    const gridStart = startOfWeek(cur);
    let days = "";
    for (let i = 0; i < 42; i++) {
      const day = new Date(gridStart); day.setDate(day.getDate() + i);
      const out = day.getMonth() !== cur.getMonth();
      const cls = "dtp-day" + (out ? " out" : "") + (sameDay(day, TODAY) ? " today" : "") + (sameDay(day, val) ? " sel" : "");
      days += '<button class="' + cls + '" type="button" data-dtp-day="' + day.toISOString() + '">' + day.getDate() + "</button>";
    }
    let times = "";
    for (let m = 5 * 60; m <= 22 * 60; m += SNAP_MIN) {
      const t = atMins(val, m);
      const on = minsOf(val) === m;
      times += '<button class="dtp-time' + (on ? " sel" : "") + '" type="button" data-dtp-time="' + m + '">' + fmtTime(t) + "</button>";
    }
    // A drag-created 7:15 start is not on the 15-minute list only if SNAP_MIN
    // changes; the list is generated from SNAP_MIN so the value is always there.
    const dur = cal.form.end.getTime() - cal.form.start.getTime();
    const allDay = cal.form.allDay;
    return '<div class="dtp-pop' + (allDay ? " is-dateonly" : "") + '">' +
        '<div class="dtp-cal">' +
          '<div class="dtp-cal-head">' +
            '<button class="dtp-nav" type="button" data-dtp-nav="-1" aria-label="Previous month"><svg class="ic rot-l"><use href="#i-chev"/></svg></button>' +
            "<span>" + fmtMonthYear(cur) + "</span>" +
            '<button class="dtp-nav" type="button" data-dtp-nav="1" aria-label="Next month"><svg class="ic rot-r"><use href="#i-chev"/></svg></button>' +
          "</div>" +
          '<div class="dtp-dow">' + DOW1.map(function (d) { return "<span>" + d + "</span>"; }).join("") + "</div>" +
          '<div class="dtp-grid">' + days + "</div>" +
        "</div>" +
        (allDay ? "" : '<div class="dtp-times" data-dtp-times>' + times + "</div>") +
        '<div class="dtp-foot">' +
          '<span class="dtp-dur">' + (allDay ? allDayLabel() : dur > 0 ? "Duration " + durLabel(dur) : "Ends before it starts") + "</span>" +
          '<button class="dtp-done" type="button" data-dtp-done="1">Done</button>' +
        "</div>" +
      "</div>";
  }
  /** Trigger + pop for one picker; `.sf` wrapper is written once by the form. */
  function dtpInnerHtml(id: string) {
    const val = dtpValue(id);
    return '<button class="dtp-btn" type="button" data-dtp-toggle="' + id + '" aria-expanded="' + (cal.form.pop === id) + '">' +
        '<svg class="ic dtp-ic"><use href="#' + (cal.form.allDay ? "i-cal" : DTP_ICON[id]) + '"/></svg>' +
        '<span class="dtp-date">' + fmtDayShort(val) + "</span>" +
        (cal.form.allDay ? "" :
          '<span class="dtp-dot"></span><span class="dtp-time-val">' + fmtTime(val) + "</span>") +
        '<svg class="ic dtp-chev"><use href="#i-chev"/></svg>' +
      "</button>" +
      dtpPopHtml(id);
  }
  function dtpFieldHtml(id: string) {
    return '<div class="sf"><span class="sf-lbl">' + DTP_LABEL[id] + "</span>" +
      '<div class="dtp' + (cal.form.pop === id ? " open" : "") + '" data-dtp="' + id + '">' + dtpInnerHtml(id) + "</div>" +
      (id === "end" ? '<span class="sf-hint" data-dur-hint>' + durHintHtml() + "</span>" : "") +
      "</div>";
  }
  function durHintHtml() {
    if (cal.form.allDay) {
      const days = Math.round((atMins(cal.form.end, 0).getTime() - atMins(cal.form.start, 0).getTime()) / 86400000) + 1;
      return '<svg class="ic"><use href="#i-cal"/></svg>' + allDayLabel() + (days > 1 ? " · " + days + " days" : "");
    }
    return '<svg class="ic"><use href="#i-clock"/></svg>' +
      durLabel(cal.form.end.getTime() - cal.form.start.getTime()) + " · " + fmtRange(cal.form.start, cal.form.end);
  }

  /** All-day switch — sits between the two pickers' block and the rest. */
  function allDayFieldHtml() {
    const on = cal.form.allDay;
    return '<div class="sf sf-toggle">' +
      '<button class="tgl' + (on ? " on" : "") + '" type="button" data-allday="1" role="switch" aria-checked="' + on + '">' +
        '<span class="tgl-track"><span class="tgl-knob"></span></span>' +
        '<span class="tgl-txt">All-day event<em>' + (on ? "Runs the whole day — no start or end time" : "Set an exact start and end time") + "</em></span>" +
      "</button>" +
    "</div>";
  }
  function paintDtp(id: string) {
    const host = root.querySelector<HTMLElement>('[data-dtp="' + id + '"]');
    if (!host) return;
    host.innerHTML = dtpInnerHtml(id);
    host.classList.toggle("open", cal.form.pop === id);
    if (cal.form.pop === id) scrollTimeIntoView(host);
  }
  function scrollTimeIntoView(host: HTMLElement) {
    const list = host.querySelector<HTMLElement>("[data-dtp-times]");
    const sel = list?.querySelector<HTMLElement>(".dtp-time.sel");
    if (list && sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2;
  }
  /** Repaint the End hint and both triggers after a value change. */
  function paintTimes() {
    paintDtp("start");
    paintDtp("end");
    const hint = root.querySelector<HTMLElement>("[data-dur-hint]");
    if (hint) hint.innerHTML = durHintHtml();
  }

  // ---------- crew dropdown ----------
  function crewSummary() {
    if (!cal.form.crew.length) {
      return cal.kind === "blocked" ? "Just me · " + OWNER.name : "Unassigned";
    }
    const names = cal.form.crew.map(function (id) {
      const w = workersData.find(function (x) { return x.id === id; });
      return w ? w.name : id;
    });
    return names.length > 1 ? names[0] + " +" + (names.length - 1) : names[0];
  }
  function crewInnerHtml() {
    const blocked = cal.kind === "blocked";
    return '<button class="pdd-btn" type="button" data-crew-toggle="1" aria-expanded="' + (cal.form.pop === "crew") + '">' +
        '<svg class="ic pdd-ic"><use href="#' + (cal.form.crew.length ? "i-users" : "i-user") + '"/></svg>' +
        '<span class="pdd-val' + (cal.form.crew.length ? "" : " is-empty") + '">' + esc(crewSummary()) + "</span>" +
        (cal.form.crew.length > 1 ? '<span class="pdd-n">' + cal.form.crew.length + "</span>" : "") +
        '<svg class="ic pdd-chev"><use href="#i-chev"/></svg>' +
      "</button>" +
      '<div class="pdd-menu">' +
        (workersData.length === 0 ? '<div class="pdd-note" role="status">You have no crew.</div>' : "") +
        workersData.map(function (w) {
          const on = cal.form.crew.indexOf(w.id) !== -1;
          return '<button class="pdd-opt' + (on ? " on" : "") + '" type="button" data-crew="' + w.id + '" aria-pressed="' + on + '">' +
            '<span class="ckbox"><svg class="ic"><use href="#i-check"/></svg></span>' +
            '<span class="cav">' + initials(w.name) + "</span>" +
            '<span class="pdd-opt-t">' + esc(w.name) + "<em>" + esc(w.role) + "</em></span>" +
            "</button>";
        }).join("") +
        (blocked
          ? '<div class="pdd-note"><svg class="ic"><use href="#i-ban"/></svg><span>Pick a crew member to block <b>their</b> time. Leave it empty and the block is <b>yours</b> (' + OWNER.name + ").</span></div>"
          : "") +
      "</div>";
  }
  function crewFieldHtml() {
    const blocked = cal.kind === "blocked";
    // `createBlockedTime` is self-owned by construction — the action takes no
    // owner and there is no update path for one. On real data the picker would
    // therefore be a control that changes nothing, so the field states the rule
    // instead of offering a choice that cannot be honoured.
    if (wired && blocked) {
      // An existing block already has an owner; a new one will be the caller's.
      const held = cal.form.crew.length
        ? workersData.find(function (x) { return x.id === cal.form.crew[0]; })
        : null;
      return '<div class="sf" id="crewRow"><span class="sf-lbl">Block for</span>' +
        '<div class="sf-static"><svg class="ic"><use href="#i-user"/></svg><span>' +
          esc(held ? held.name : "Just me · " + OWNER.name) + "</span></div>" +
        '<span class="sf-hint"><svg class="ic"><use href="#i-ban"/></svg>Blocked time belongs to whoever created it.</span>' +
        "</div>";
    }
    return '<div class="sf" id="crewRow"><span class="sf-lbl">' + (blocked ? "Block for" : "Crew") + "</span>" +
      '<div class="pdd' + (cal.form.pop === "crew" ? " open" : "") + '" data-pdd="crew">' + crewInnerHtml() + "</div>" +
      (blocked ? '<span class="sf-hint"><svg class="ic"><use href="#i-user"/></svg>' + (cal.form.crew.length ? "Blocks the selected crew" : "Blocks your own calendar") + "</span>" : "") +
      "</div>";
  }
  function paintCrew() {
    const host = root.querySelector<HTMLElement>('[data-pdd="crew"]');
    if (!host) return;
    host.innerHTML = crewInnerHtml();
    host.classList.toggle("open", cal.form.pop === "crew");
    const hint = host.parentElement?.querySelector<HTMLElement>(".sf-hint");
    if (hint && cal.kind === "blocked") {
      hint.innerHTML = '<svg class="ic"><use href="#i-user"/></svg>' +
        (cal.form.crew.length ? "Blocks the selected crew" : "Blocks your own calendar");
    }
  }

  // ---------- job / proposal link picker ----------
  function linkOpt(id: string | null) {
    return LINK_OPTIONS.find(function (o) { return o.id === id; }) || null;
  }
  /** Which record types the current event kind may link to. */
  function linkKinds() {
    return LINK_TABS[cal.kind] || LINK_TABS.job;
  }
  function linkRows() {
    const q = cal.form.linkQuery.trim().toLowerCase();
    const allowed = linkKinds();
    const rows = LINK_OPTIONS.filter(function (o) {
      if (allowed.indexOf(o.kind) === -1) return false;
      if (cal.form.linkTab !== "all" && o.kind !== cal.form.linkTab) return false;
      if (!q) return true;
      return (o.title + " " + o.client + " " + o.meta).toLowerCase().indexOf(q) !== -1;
    });
    if (!rows.length) {
      return '<div class="lnk-none">' +
        (q ? "Nothing matches “" + esc(cal.form.linkQuery) + "”" : "Nothing to link yet") + "</div>";
    }
    return rows.map(function (o: LinkOption) {
      const on = cal.form.link === o.id;
      return '<button class="lnk-row' + (on ? " on" : "") + '" type="button" data-link="' + o.id + '">' +
        '<span class="cav cav--' + o.kind + '">' + initials(o.title) + "</span>" +
        '<span class="lnk-row-t">' + esc(o.title) + "<em>" + LINK_LABEL[o.kind] + " · " + esc(o.meta) + "</em></span>" +
        '<span class="pstatus pstatus--' + o.status + '">' + o.status + "</span>" +
        "</button>";
    }).join("");
  }
  function linkInnerHtml() {
    const picked = linkOpt(cal.form.link);
    return '<button class="pdd-btn" type="button" data-lnk-toggle="1" aria-expanded="' + (cal.form.pop === "link") + '">' +
        '<svg class="ic pdd-ic"><use href="#' + (picked ? (picked.kind === "job" ? "i-jobs" : "i-file") : "i-link") + '"/></svg>' +
        '<span class="pdd-val' + (picked ? "" : " is-empty") + '">' +
          (picked ? esc(picked.title) + " — " + esc(picked.client) : "Search or choose a job / proposal…") +
        "</span>" +
        '<svg class="ic pdd-chev"><use href="#i-chev"/></svg>' +
      "</button>" +
      // A sibling, not a child: a button inside a button is invalid markup and
      // the inner one never gets its own accessible name.
      (picked ? '<button class="pdd-x" type="button" data-link-clear="1" aria-label="Clear link">×</button>' : "") +
      '<div class="pdd-menu pdd-menu--wide">' +
        '<label class="lnk-search"><svg class="ic"><use href="#i-search"/></svg>' +
          '<input type="text" id="lnkQ" placeholder="Search ' +
            linkKinds().map(function (k) { return LINK_LABEL[k].toLowerCase() + "s"; }).join(", ") +
          '…" autocomplete="off" value="' + esc(cal.form.linkQuery) + '"></label>' +
        '<div class="lnk-tabs">' +
          (["all"] as string[]).concat(linkKinds()).map(function (t) {
            return '<button class="lnk-tab' + (cal.form.linkTab === t ? " on" : "") + '" type="button" data-lt="' + t + '">' +
              (t === "all" ? "All" : LINK_LABEL[t as "job"]) + "</button>";
          }).join("") +
        "</div>" +
        '<div class="lnk-list">' + linkRows() + "</div>" +
      "</div>";
  }
  function linkFieldHtml() {
    return '<div class="sf" id="linkRow"><span class="sf-lbl">Link</span>' +
      '<div class="pdd' + (cal.form.pop === "link" ? " open" : "") + '" data-pdd="link">' + linkInnerHtml() + "</div>" +
      "</div>";
  }
  function paintLink(keepFocus?: boolean) {
    const host = root.querySelector<HTMLElement>('[data-pdd="link"]');
    if (!host) return;
    host.innerHTML = linkInnerHtml();
    host.classList.toggle("open", cal.form.pop === "link");
    if (keepFocus) {
      const q = host.querySelector<HTMLInputElement>("#lnkQ");
      if (q) { q.focus(); q.selectionStart = q.selectionEnd = q.value.length; }
    }
  }

  // ---------- status dropdown (job events) ----------
  function statusInnerHtml() {
    const cur = JOB_STATUSES.find(function (s) { return s.value === cal.form.status; }) || JOB_STATUSES[0];
    return '<button class="pdd-btn" type="button" data-status-toggle="1" aria-expanded="' + (cal.form.pop === "status") + '">' +
        '<span class="fdd-dot" style="background:' + STATUS_DOT[cur.value] + '"></span>' +
        '<span class="pdd-val">' + cur.label + "</span>" +
        '<svg class="ic pdd-chev"><use href="#i-chev"/></svg>' +
      "</button>" +
      '<div class="pdd-menu">' +
        JOB_STATUSES.map(function (s) {
          return '<button class="pdd-opt' + (s.value === cal.form.status ? " on" : "") + '" type="button" data-status="' + s.value + '">' +
            '<span class="fdd-dot" style="background:' + STATUS_DOT[s.value] + '"></span>' +
            '<span class="pdd-opt-t">' + s.label + "</span></button>";
        }).join("") +
      "</div>";
  }
  function statusFieldHtml() {
    return '<div class="sf" id="statusRow"><span class="sf-lbl">Status</span>' +
      '<div class="pdd' + (cal.form.pop === "status" ? " open" : "") + '" data-pdd="status">' + statusInnerHtml() + "</div></div>";
  }
  function paintStatus() {
    const host = root.querySelector<HTMLElement>('[data-pdd="status"]');
    if (!host) return;
    host.innerHTML = statusInnerHtml();
    host.classList.toggle("open", cal.form.pop === "status");
  }

  /** One pop-over at a time, inside the sheet as well as in the filter bar. */
  function setPop(id: string | null) {
    const prev = cal.form.pop;
    cal.form.pop = prev === id ? null : id;
    const repaint = function (p: string | null) {
      if (p === "start" || p === "end") paintDtp(p);
      else if (p === "crew") paintCrew();
      else if (p === "link") paintLink(p === cal.form.pop);
      else if (p === "status") paintStatus();
    };
    if (prev && prev !== cal.form.pop) repaint(prev);
    repaint(cal.form.pop);
  }
  function closePops() {
    if (cal.form.pop) setPop(cal.form.pop);
  }
  const KIND_TITLE: Record<string, string> = { job: "Job event", appointment: "Appointment", blocked: "Blocked time" };
  /** Where a visit's sheet can take you: the lead or client it is for, the
   *  visit page (equipment + report), and the desk's call log. */
  function visitLinksHtml(e: CalEvent) {
    if (e.kind !== "appointment") return "";
    const btn = function (href: string, icon: string, label: string) {
      return '<button class="btn btn-ghost btn--sm" type="button" data-act="open-href" data-href="' + esc(href) + '"><svg class="ic"><use href="#' + icon + '"/></svg>' + label + "</button>";
    };
    return '<div class="sf-links">' + (e.clientId ? btn("/dashboard/client-detail?client=" + encodeURIComponent(e.clientId), "i-user", "Open client") : "") +
      (!e.clientId && e.leadId ? btn("/dashboard/leads/" + encodeURIComponent(e.leadId), "i-target", "Open lead") : "") +
      (e.rid ? btn("/dashboard/visits/" + encodeURIComponent(e.rid), "i-file", "Visit page") : "") +
      (e.via === "ai-desk" ? btn("/dashboard/phone", "i-phone", "Call log") : "") + "</div>";
  }
  function visitMetaHtml(e: CalEvent) {
    if (e.kind !== "appointment") return "";
    const v = VISIT_VIA[e.via || "team"];
    return '<div class="sf-meta-row sf-via evc--via-' + (e.via || "team") + '"><span class="kpi-lbl">Booked</span><span><span class="evc-via">' + esc(v.tag) + "</span>" + esc(e.booked || "By your team") + "</span></div>" +
      (e.visitFor ? '<div class="sf-meta-row"><span class="kpi-lbl">Visit for</span><span>' + esc(e.visitFor) + (e.member ? " · member price" : "") + "</span></div>" : "");
  }

  function openDetail(id: string) {
    const e = eventsData.find(function (x) { return x.id === id; });
    if (!e) return;
    if (e.kind === "desk") { openDeskDetail(e); return; }
    cal.sheet = "detail"; cal.editing = id; cal.kind = e.kind;
    cal.form.start = new Date(e.start);
    cal.form.end = new Date(e.end);
    cal.form.crew = e.workers.slice();
    cal.form.status = e.status;
    cal.form.link = null;
    cal.form.pop = null;
    cal.form.calCursor = {};
    cal.form.allDay = !!e.allDay;
    cal.form.linkTab = "all";
    cal.form.linkQuery = "";
    // Crew line carries each person's ANSWER on a job event (2026-08-22):
    // "Casey Stone accepted · Dima pending". The office asked for the
    // confirmation state to be readable on the event itself, not only in the
    // inbox ledger. Already-escaped HTML, so it is dropped in raw below.
    const crewHtml = e.kind === "blocked" && e.orgWide
      ? "Everyone — the whole company"
      : e.kind === "blocked" && e.selfOnly
      ? esc("Just me · " + OWNER.name)
      : e.workers.length
        ? e.workers.map(function (id) {
            const w = workersData.find(function (x) { return x.id === id; });
            const st = e.kind === "job" ? e.assignmentStatus?.[id] : undefined;
            const chip = st
              ? ' <span class="pstatus pstatus--' + esc(st.toLowerCase()) + '">' + esc(st.toLowerCase()) + "</span>"
              : "";
            return esc(w ? w.name : id) + chip;
          }).join(", ")
        : "Unassigned";
    openSheet(e.kind === "appointment" && e.via && e.via !== "team" ? "Appointment · " + VISIT_VIA[e.via].tag : KIND_TITLE[e.kind] || "Job event",
      '<div class="sf-meta">' +
        visitMetaHtml(e) +
        '<div class="sf-meta-row"><span class="kpi-lbl">When</span><span>' +
          (e.allDay
            ? fmtDate(e.start) + (sameDay(e.start, e.end) ? "" : " – " + fmtDate(e.end))
            : fmtDate(e.start) + " · " + fmtRange(e.start, e.end)) + "</span></div>" +
        '<div class="sf-meta-row"><span class="kpi-lbl">Duration</span><span>' +
          (e.allDay
            ? "All day" + (sameDay(e.start, e.end) ? "" : " · " + (Math.round((atMins(e.end, 0).getTime() - atMins(e.start, 0).getTime()) / 86400000) + 1) + " days")
            : durLabel(e.end.getTime() - e.start.getTime())) + "</span></div>" +
        (e.client ? '<div class="sf-meta-row"><span class="kpi-lbl">' + (e.kind === "appointment" && !e.clientId && e.leadId ? "Lead" : "Client") + "</span><span>" + esc(e.client) + "</span></div>" : "") +
        (e.phone ? '<div class="sf-meta-row"><span class="kpi-lbl">Phone</span><span><a class="sf-tel" href="tel:' + esc(e.phone.replace(/[^\d+]/g, "")) + '">' + esc(e.phone) + "</a></span></div>" : "") +
        (e.addr ? '<div class="sf-meta-row"><span class="kpi-lbl">Address</span><span>' + esc(e.addr) + "</span></div>" : "") +
        '<div class="sf-meta-row"><span class="kpi-lbl">Crew</span><span>' + crewHtml + "</span></div>" +
        (e.scope ? '<div class="sf-meta-row"><span class="kpi-lbl">Scope</span><span>' + esc(e.scope) + "</span></div>" : "") +
      "</div>" +
      '<label class="sf"><span class="sf-lbl">Title</span><input class="sf-in" data-e="title" value="' + esc(e.title) + '"></label>' +
      allDayFieldHtml() +
      dtpFieldHtml("start") +
      dtpFieldHtml("end") +
      (e.kind === "job" ? statusFieldHtml() : "") +
      crewFieldHtml() +
      '<label class="sf"><span class="sf-lbl">Notes</span><textarea class="sf-area" data-e="notes" placeholder="Anything the crew should know">' + esc(e.notes || "") + "</textarea></label>" +
      visitLinksHtml(e) +
      '<div class="sf-act">' +
        '<button class="btn btn-primary btn--sm" type="button" data-act="save-event"><svg class="ic"><use href="#i-check"/></svg>Save changes</button>' +
        // Only a JobEvent with a job behind it has anything to open — an
        // appointment, a block, and the optional-job path in createJobEvent all
        // have none, so the button is absent rather than disabled. The id is
        // carried on the button, not read back off `cal.editing`, so the
        // handler cannot open a job the sheet has since moved off.
        (e.jobId
          ? '<button class="btn btn-ghost btn--sm" type="button" data-act="open-job" data-job="' +
            esc(e.jobId) + '"><svg class="ic"><use href="#i-jobs"/></svg>Open job</button>'
          : "") +
        // The one destructive control on this page, so it carries the house
        // danger treatment (`btn--danger`) rather than reading as a third
        // equal-weight ghost button next to Save and Open job. Same modifier and
        // same tones as the crew inspector's Remove in workers-blueprint — one
        // treatment per control, published once.
        '<button class="btn btn-ghost btn--sm btn--danger" type="button" data-act="delete-event"><svg class="ic"><use href="#i-trash"/></svg>Delete</button>' +
      "</div>");
  }

  /** Reserved AI desk hours: what they are, whose, and the way to give them back. */
  function openDeskDetail(e: CalEvent) {
    cal.sheet = "detail"; cal.editing = e.id; cal.kind = "desk";
    const desk = seed?.desk;
    const mine = !!desk && e.deskUserId === desk.me;
    const canRemove = canManage || mine;
    const who = e.title.replace(/^AI desk hours · /, "");
    openSheet("AI desk hours",
      '<div class="sf-meta">' +
        '<div class="sf-meta-row"><span class="kpi-lbl">When</span><span>' + fmtDate(e.start) + " · " + esc(spanWords(pad2(e.start.getHours()) + ":" + pad2(e.start.getMinutes()), pad2(e.end.getHours()) + ":" + pad2(e.end.getMinutes()))) + "</span></div>" +
        '<div class="sf-meta-row"><span class="kpi-lbl">Repeats</span><span>' + (e.deskWeekly ? "Every " + e.start.toLocaleDateString("en-US", { weekday: "long" }) : "This day only") + "</span></div>" +
        '<div class="sf-meta-row"><span class="kpi-lbl">For</span><span>' + esc(who === "anyone" ? "Anyone at the company" : who) + "</span></div>" +
        '<div class="sf-meta-row"><span class="kpi-lbl">The desk</span><span>' + (desk && desk.mode === "reserved" ? "Books callers into these hours, skipping anything already on the calendar." : "Books from the open hours right now — these count once the company switches to reserved hours.") + "</span></div>" +
      "</div>" +
      '<div class="sf-act">' +
        (canRemove
          ? '<button class="btn btn-ghost btn--sm btn--danger" type="button" data-act="remove-desk" data-rid="' + esc(e.rid || "") + '"><svg class="ic"><use href="#i-trash"/></svg>' + (e.deskWeekly ? "Remove every week" : "Remove these hours") + "</button>"
          : "") +
        '<button class="btn btn-ghost btn--sm" type="button" data-sheet="close">Close</button>' +
      "</div>");
  }
  function pad2(n: number) { return (n < 10 ? "0" : "") + n; }

  /** The create form. `start`/`end` come from the drag-to-create preview when
   *  there is one, otherwise from the clicked cell (2h default). */
  function openQuickAdd(start: Date | null, end: Date | null, allDay?: boolean) {
    if (!CREATE_KINDS.length) {
      dropGhost();
      toast("Your role can view this calendar but not add to it.", false);
      return;
    }
    cal.sheet = "add"; cal.kind = CREATE_KINDS[0]; cal.editing = null;
    // No day was clicked (the "New event" button), so default to the day the
    // calendar is SHOWING, not to today. `cal.cursor` is today until you
    // navigate, so the common case is unchanged — but paging to another week
    // and pressing New event used to file the event on today, i.e. into a
    // different column, or out of the visible week entirely. It read as the
    // event jumping columns the moment it was created.
    const s = start ? new Date(start) : atMins(cal.cursor, 8 * 60);
    cal.form.start = s;
    cal.form.end = end ? new Date(end) : addMin(s, 120);
    cal.form.crew = [];
    cal.form.link = null;
    cal.form.status = "SCHEDULED";
    cal.form.pop = null;
    cal.form.calCursor = {};
    cal.form.linkTab = "all";
    cal.form.linkQuery = "";
    cal.form.allDay = !!allDay;
    // `false` = do not inherit typed text. `quickAddHtml` reads the title and
    // notes back out of the live DOM so they survive a kind switch — but the
    // sheet's markup is only replaced by `openSheet` on the NEXT line, so at
    // this moment the PREVIOUS event's form is still mounted. Inheriting here
    // meant every event created after the first opened pre-filled with the last
    // one's title, and creating three in a row produced three identical rows.
    openSheet("New event", quickAddHtml(false));
    root.querySelector<HTMLInputElement>('[data-e="title"]')?.focus();
  }
  /** Rebuilt whole when the kind tab changes — Blocked drops the link field and
   *  relabels the crew picker, so the field set is not the same form. */
  function quickAddHtml(keepTyped = true) {
    const blocked = cal.kind === "blocked";
    // Carried across a kind switch (the form is rebuilt in place, so whatever
    // was typed must survive); never carried into a NEWLY opened form.
    const seedTitle = keepTyped ? currentTitle() : "";
    const seedNotes = keepTyped ? currentNotes() : "";
    const ph: Record<string, string> = {
      job: "Roof tear-off — 4812 Maple Ave",
      appointment: "Estimate visit — S. Rao",
      blocked: "Shop maintenance",
      desk: "",
    };
    if (cal.kind === "desk") return kindTabsHtml() + deskFormHtml();
    // A tab strip with one tab is a label pretending to be a choice — when the
    // role can only create one kind, the strip is dropped entirely and the
    // sheet's own title carries the meaning.
    return kindTabsHtml() +
      '<label class="sf"><span class="sf-lbl">Title</span><input class="sf-in" data-e="title" placeholder="' + ph[cal.kind] + '" value="' + esc(seedTitle) + '"></label>' +
      allDayFieldHtml() +
      dtpFieldHtml("start") +
      dtpFieldHtml("end") +
      (blocked ? "" : linkFieldHtml()) +
      crewFieldHtml() +
      '<label class="sf"><span class="sf-lbl">Notes</span><textarea class="sf-area" data-e="notes" placeholder="Anything the crew should know">' + esc(seedNotes) + "</textarea></label>" +
      '<div class="sf-act">' +
        '<button class="btn btn-primary btn--sm" type="button" data-act="create-event"><svg class="ic"><use href="#i-check"/></svg>' +
          (blocked ? "Block time" : "Create event") + "</button>" +
        '<button class="btn btn-ghost btn--sm" type="button" data-sheet="close">Cancel</button>' +
      "</div>";
  }
  function kindTabsHtml() {
    return CREATE_KINDS.length > 1
      ? '<div class="sf-kinds" id="kindTabs">' +
          CREATE_KINDS.map(function (k) {
            return '<button class="sf-kind' + (cal.kind === k ? " on" : "") + '" type="button" data-kind="' + k + '">' +
              '<svg class="ic"><use href="#' + KIND_IC[k] + '"/></svg>' +
              (k === "job" ? "Job event" : k === "appointment" ? "Appointment" : k === "desk" ? "AI desk hours" : "Blocked") + "</button>";
          }).join("") +
        "</div>"
      : "";
  }
  /**
   * AI desk hours (2026-10-16): the hours a person — or anyone at the company — keeps open for the AI desk to book
   * visits into, by the hour, one day or every week. Saved to the same list as the AI desk's own panel.
   */
  function deskFormHtml() {
    const desk = seed?.desk;
    const people = desk ? desk.people : [];
    const whoHtml = canManage
      ? '<select class="sf-in" data-e="deskWho"><option value="">Anyone at the company</option>' +
          people.map(function (p) { return '<option value="' + esc(p.userId) + '"' + (desk && p.userId === desk.me ? " selected" : "") + ">" + esc(p.name) + (desk && p.userId === desk.me ? " (me)" : "") + "</option>"; }).join("") +
        "</select>"
      : '<div class="sf-static"><svg class="ic"><use href="#i-user"/></svg><span>' + esc((people[0] && people[0].name) || "Me") + "</span></div>";
    return '<p class="sf-note">The AI desk books callers into these hours' + (desk && desk.mode !== "reserved" ? " once the company switches it to “Only hours we reserve” (AI desk → When it can book visits)" : "") + ". Each visit goes to the person whose hours they are.</p>" +
      dtpFieldHtml("start") +
      dtpFieldHtml("end") +
      '<div class="sf"><span class="sf-lbl">For</span>' + whoHtml + "</div>" +
      '<label class="sf sf-check"><input type="checkbox" data-e="deskWeekly"> <span>Every week, same day and hours</span></label>' +
      '<div class="sf-act">' +
        '<button class="btn btn-primary btn--sm" type="button" data-act="create-event"><svg class="ic"><use href="#i-check"/></svg>Reserve hours</button>' +
        '<button class="btn btn-ghost btn--sm" type="button" data-sheet="close">Cancel</button>' +
      "</div>";
  }
  /** Typed text survives a kind switch. */
  function currentTitle() {
    return root.querySelector<HTMLInputElement>('[data-e="title"]')?.value || "";
  }
  function currentNotes() {
    return root.querySelector<HTMLTextAreaElement>('[data-e="notes"]')?.value || "";
  }
  function openInbox() {
    cal.sheet = "inbox";
    // Looking IS seeing: the unseen-answers part of the bell clears now and
    // the server remembers it (fire-and-forget — bookkeeping, not a gate).
    if (inboxUnseen) {
      inboxUnseen = 0;
      renderBar();
      if (wired) void markNavSeen("crewInbox").catch(() => {});
    }
    // The inbox is a CONFIRMATION LEDGER now (2026-08-22): every assignment's
    // answer — pending, accepted, declined — not only the unanswered ones. A
    // decline used to vanish from this list the moment the worker sent it,
    // which read as "handled" when it meant the opposite. Pending rows keep
    // the manual "Mark accepted" override; answered rows just say their state.
    const pendingN = inboxData.filter(function (r) { return (r.status ?? "PENDING") === "PENDING"; }).length;
    openSheet("Crew confirmations · " + pendingN + " pending",
      inboxData.length ? inboxData.map(function (r) {
        const st = r.status ?? "PENDING";
        const cls = st === "ACCEPTED" ? "pstatus--accepted" : st === "DECLINED" ? "pstatus--declined" : "pstatus--pending";
        return '<div class="inbox-row" data-inbox="' + r.id + '">' +
          '<div class="inbox-t">' + esc(r.title) + "</div>" +
          '<div class="inbox-s">' + esc(r.worker) + " · " + esc(r.when) + "</div>" +
          '<div class="inbox-act"><span class="pstatus ' + cls + '">' + st.toLowerCase() + "</span>" +
          (st === "PENDING"
            ? '<button class="btn btn-primary btn--sm" type="button" data-act="confirm"><svg class="ic"><use href="#i-check"/></svg>Mark accepted</button>'
            : "") +
          "</div></div>";
      }).join("") : '<div class="pempty"><b>Everyone has confirmed</b><br>All crew assignments have been accepted.</div>');
  }
  function readCrew() {
    return cal.form.crew.slice();
  }
  /** The span the form should store: whole days when all-day is on, otherwise
   *  the picked times with a 2h fallback if the end never got past the start. */
  function formSpan() {
    if (cal.form.allDay) {
      const s = atMins(cal.form.start, 0);
      const e = atMins(cal.form.end.getTime() < s.getTime() ? s : cal.form.end, 23 * 60 + 59);
      return { start: s, end: e };
    }
    const s = new Date(cal.form.start);
    return { start: s, end: cal.form.end.getTime() > s.getTime() ? new Date(cal.form.end) : addMin(s, 120) };
  }

  // ================= EVENTS =================
  onId("calPrev", "click", function () {
    const c = new Date(cal.cursor);
    if (cal.view === "month") c.setMonth(c.getMonth() - 1); else c.setDate(c.getDate() - 7);
    cal.cursor = c; cal.nav = "prev"; renderCal();
  });
  onId("calNext", "click", function () {
    const c = new Date(cal.cursor);
    if (cal.view === "month") c.setMonth(c.getMonth() + 1); else c.setDate(c.getDate() + 7);
    cal.cursor = c; cal.nav = "next"; renderCal();
  });
  onId("calToday", "click", function () { cal.cursor = new Date(TODAY); renderCal(); });
  onId("calViews", "click", function (e) {
    const b = asEl(e.target)?.closest<HTMLElement>(".vsw-btn");
    if (!b) return;
    cal.view = (b.dataset.view || "month") as "month" | "week" | "team";
    $$("#calViews .vsw-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
    renderCal();
  });
  onId("trayBtn", "click", function () { cal.trayOpen = !cal.trayOpen; renderCal(); });
  onId("inboxBtn", "click", openInbox);
  onId("newEventBtn", "click", function () { openQuickAdd(null, null); });
  const calSearch = root.querySelector<HTMLInputElement>("#calSearch");
  if (calSearch) {
    // Grid + Clear only. A full `renderCal()` per keystroke rebuilt the entire
    // filter row — including the worker menu — while the user was typing.
    on(calSearch, "input", function () {
      cal.query = calSearch.value;
      syncClear();
      renderGrid();
    });
  }
  onId("calClear", "click", function () {
    cal.workers = []; cal.statuses = []; cal.query = "";
    if (calSearch) calSearch.value = "";
    closeFdd();
    // Everything is being reset, so the filter chrome does need a full redraw.
    renderFilters();
    renderGrid();
  });

  // ---------- filter dropdowns ----------
  /** Redraw the calendar body for the current filters, and nothing else. Used by
   *  every filter path: a full `renderCal()` would rebuild the filter chrome
   *  itself — including any menu the pointer is still inside. */
  function renderGrid() {
    if (cal.view === "month") renderMonth();
    if (cal.view === "week") renderWeek();
    if (cal.view === "team") renderTeam();
  }

  /** Redraw only what a filter change actually affects: the toggled rows, the
   *  trigger summary, the "Clear N" chip and the grid. */
  function repaintAfterFilter(hostId: string, key: "workers" | "statuses", attr: "w" | "s") {
    const host = byId(hostId);
    if (host) {
      host.querySelectorAll<HTMLElement>("[data-" + attr + "]").forEach(function (b) {
        const on = cal[key].indexOf(b.dataset[attr] as string) !== -1;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      // Statuses are bare chips with no trigger to summarise; the selectors
      // inside simply find nothing.
      if (host.classList.contains("fdd")) {
        paintFddTrigger(hostId, workerSummary(), cal[key].length);
      }
    }
    syncClear();
    renderGrid();
  }

  function bindFilter(hostId: string, key: "workers" | "statuses", attr: "w" | "s") {
    onId(hostId, "click", function (e) {
      const t = asEl(e.target);
      if (!t) return;
      const trigger = t.closest<HTMLElement>("[data-fdd]");
      if (trigger) {
        const host = byId(hostId);
        const willOpen = !host?.classList.contains("open");
        closeFdd(); closePops();
        host?.classList.toggle("open", willOpen);
        trigger.setAttribute("aria-expanded", String(willOpen));
        return;
      }
      if (t.closest("[data-fdd-reset]")) {
        cal[key] = [];
        repaintAfterFilter(hostId, key, attr);
        return;
      }
      const opt = t.closest<HTMLElement>("[data-" + attr + "]");
      const v = opt?.dataset[attr];
      if (!v) return;
      const i = cal[key].indexOf(v);
      if (i === -1) cal[key].push(v); else cal[key].splice(i, 1);
      repaintAfterFilter(hostId, key, attr);
    });
  }
  bindFilter("workerFilter", "workers", "w");
  // Statuses are plain toggles, no menu to open or close.
  onId("statusFilter", "click", function (e) {
    const b = asEl(e.target)?.closest<HTMLElement>("[data-s]");
    if (!b || !b.dataset.s) return;
    closeFdd();
    const i = cal.statuses.indexOf(b.dataset.s);
    if (i === -1) cal.statuses.push(b.dataset.s); else cal.statuses.splice(i, 1);
    repaintAfterFilter("statusFilter", "statuses", "s");
  });

  // calendar clicks: chip → details, empty cell → quick create.
  // Week cells are handled by the drag-to-create pointer flow below, which
  // opens the form on release — so they are skipped here to avoid two opens.
  onId("calWrap", "click", function (e) {
    const t = asEl(e.target);
    if (!t) return;
    // Before the chip and empty-cell branches: the disclosure sits INSIDE a
    // `[data-day]` cell, so either of them would otherwise swallow it and open
    // the create form instead of expanding the day.
    const more = t.closest<HTMLElement>("[data-more]");
    if (more) { toggleMonthMore(more.dataset.more as string); return; }
    const chip = t.closest<HTMLElement>(".evc");
    if (chip) { if (chip.dataset.ev) openDetail(chip.dataset.ev); return; }
    if (t.closest(".wg-body")) return;
    const cell = t.closest<HTMLElement>("[data-day]");
    if (cell && !t.closest(".tray")) {
      const day = new Date(cell.dataset.day as string);
      // Clicking the all-day band asks for an all-day event, so the form opens
      // with the switch already on.
      if (cell.closest(".wg-ad-cell")) {
        openQuickAdd(atMins(day, 0), atMins(day, 0), true);
        return;
      }
      const start = atMins(day, (cell.dataset.hour ? Number(cell.dataset.hour) : 8) * 60);
      openQuickAdd(start, addMin(start, 120));
    }
  });

  // ---------- week: drag a span to create ----------
  // Press on empty grid, drag, release: a live preview block grows with the
  // pointer and prints the range it covers; the release opens the create form
  // pre-filled with exactly that span. A press without movement stays a click
  // and opens the 2-hour default.
  const wgBody = byId("wgBody");
  if (wgBody) {
    let col: HTMLElement | null = null;
    let anchor = 0;      // minutes since midnight where the press landed
    let day: Date | null = null;
    let moved = false;
    let pid = -1;
    const endDraw = () => { col = null; day = null; moved = false; };

    on(wgBody, "pointerdown", function (ev) {
      const pe = ev as PointerEvent;
      if (pe.button !== 0) return;
      const t = asEl(pe.target);
      if (!t || t.closest(".wg-ev")) return;      // chips keep their own drag
      const c = t.closest<HTMLElement>(".wg-col");
      if (!c) return;
      closeFdd();
      // A pending preview from the previous gesture (form cancelled by clicking
      // straight onto the grid) is replaced, not stacked.
      dropGhost();
      if (!ghostIn(c)) { endDraw(); return; }
      col = c;
      day = new Date(c.dataset.day as string);
      anchor = minsAtY(c, pe.clientY);
      moved = false;
      c.classList.add("is-drawing");
      paintGhost(day, anchor, anchor + 60, "New " + (cal.kind === "blocked" ? "block" : "event"));
      // Suppresses the text selection a drag across the grid would otherwise
      // paint. Safe for the compat mouse events it also cancels: chips returned
      // above, and the week's create runs off pointerup.
      pe.preventDefault();
      pid = pe.pointerId;
      try { wgBody.setPointerCapture(pid); } catch { /* capture is best-effort */ }
    });
    on(wgBody, "pointermove", function (ev) {
      const pe = ev as PointerEvent;
      if (!col || !day) return;
      const cur = minsAtY(col, pe.clientY);
      if (Math.abs(cur - anchor) >= SNAP_MIN) moved = true;
      paintGhost(day, anchor, moved ? cur : anchor + 60, "New " + (cal.kind === "blocked" ? "block" : "event"));
    });
    const finish = (pe: PointerEvent) => {
      if (!col || !day) return;
      const raw = minsAtY(col, pe.clientY);
      const d = day;
      const a = Math.min(anchor, raw);
      const b = moved ? Math.max(Math.max(anchor, raw), a + 30) : anchor + 120;
      try { wgBody.releasePointerCapture(pid); } catch { /* already released */ }
      col.classList.remove("is-drawing");
      endDraw();
      // The preview STAYS: it is the span the form is about to create, so it
      // holds its place on the grid until the event exists or the form closes.
      paintGhost(d, a, b, "New " + (cal.kind === "blocked" ? "block" : "event"), "is-pending");
      openQuickAdd(atMins(d, a), atMins(d, b));
    };
    on(wgBody, "pointerup", function (ev) { finish(ev as PointerEvent); });
    on(wgBody, "pointercancel", function () {
      col?.classList.remove("is-drawing");
      endDraw();
      dropGhost();
    });
    on(document, "keydown", function (ev) {
      if ((ev as KeyboardEvent).key !== "Escape") return;
      col?.classList.remove("is-drawing");
      endDraw();
      closeFdd();
      if (cal.form.pop) { closePops(); return; }
      if (cal.sheet) { closeSheet(); return; }
      dropGhost();
    });
  }

  // ---------- week: drag an edge to re-time ----------
  // Press the grip on a block's top or bottom edge and drag: the BLOCK itself
  // grows and shrinks under the pointer and its time line rewrites live, with a
  // mono plate riding the edge being moved. Bottom changes the end, top changes
  // the start; both snap to SNAP_MIN, exactly like drag-to-create and
  // drag-to-move, and the release goes through `persistMove` — the SAME write
  // path a drag-and-drop move uses, so a resize and a move cannot disagree
  // about what "this event now runs 9:00–13:30" means to the database.
  //
  // Nothing is written until the pointer is released. An abandoned gesture
  // (Escape, pointercancel, a release that never moved) costs a repaint.
  if (wgBody) {
    let rzEv: CalEvent | null = null;
    let rzEl: HTMLElement | null = null;
    let rzCol: HTMLElement | null = null;
    let rzTag: HTMLElement | null = null;
    let rzDay: Date | null = null;
    let rzEdge: "start" | "end" = "end";
    /** The edge that stays put, in minutes since midnight. */
    let rzAnchor = 0;
    /** The live span under the pointer, in minutes since midnight. */
    let rzA = 0;
    let rzB = 0;
    let rzMoved = false;
    let rzPid = -1;
    /**
     * A gesture ends with a `pointerup` on the block, and the browser follows
     * that with a `click` — which `#calWrap`'s delegate reads as "open this
     * event". Deadline rather than a one-shot flag: the commit re-renders the
     * week, so whether the click lands at all depends on what the browser makes
     * of a mousedown target that no longer exists, and a flag nobody consumes
     * would swallow an innocent click minutes later.
     */
    let rzSwallowUntil = 0;

    /** Paint the block at the live span, using the geometry a render would give
     *  it — so committing changes nothing visible and abandoning restores
     *  nothing. */
    const rzPaint = () => {
      if (!rzEl || !rzDay) return;
      const top = yOfMins(rzA);
      // The same 22px floor `layoutDay` applies, then the same flush-top
      // correction `geoStyle` applies. Any other pair of numbers here would make
      // the block jump by a hairline on release.
      const raw = Math.max(22, yOfMins(rzB) - top);
      const g = flushTop(top, raw);
      rzEl.style.top = g.top.toFixed(1) + "px";
      rzEl.style.height = g.height.toFixed(1) + "px";
      rzEl.classList.toggle("is-flush-top", g.onLine);
      rzEl.classList.toggle("is-short", raw < 42);
      const label = fmtRange(atMins(rzDay, rzA), atMins(rzDay, rzB));
      const line = rzEl.querySelector<HTMLElement>(".wg-ev-time");
      if (line) line.textContent = label;
      if (rzTag) {
        // A short block hides its time line, so the plate is not a duplicate —
        // it is the only reading of the span while the block is small.
        rzTag.textContent = label + " · " + durLabel((rzB - rzA) * 60000);
        // The plate is wider than a day column, so it hangs over the column to
        // its right. Saturday has none, and `.wg-scroll` computes `overflow-x`
        // from its `overflow-y: auto` — an overhang there would put a
        // horizontal scrollbar under the whole week. In the last column the
        // plate is anchored to the right edge and grows inward instead.
        const last = !!rzCol && !rzCol.nextElementSibling;
        rzTag.classList.toggle("is-right", last);
        // `left` is copied verbatim: on a split hour it is a `calc()` against
        // the same containing block the plate sits in, so it resolves to the
        // block's own lane.
        rzTag.style.left = last ? "auto" : rzEl.style.left || "0";
        rzTag.style.right = last ? "0" : "auto";
        // Centred on the edge it reports, but never half-outside the grid: the
        // plate is ~17px tall and the scroller clips, so at 6:00 and 20:00 it
        // would lose its top or bottom half.
        const edgeY = yOfMins(rzEdge === "start" ? rzA : rzB);
        rzTag.style.top = Math.min(WG_H - 10, Math.max(10, edgeY)).toFixed(1) + "px";
      }
    };

    /** Put the gesture down. `commit` false = abandon it and repaint from the
     *  model; a gesture that never moved is a click and is left alone. */
    const rzEnd = (commit: boolean) => {
      const ev = rzEv;
      const el = rzEl;
      const day = rzDay;
      const moved = rzMoved;
      const a = rzA;
      const b = rzB;
      if (rzPid !== -1) {
        try { wgBody.releasePointerCapture(rzPid); } catch { /* already released */ }
        rzPid = -1;
      }
      rzTag?.remove();
      rzTag = null;
      el?.classList.remove("is-resizing");
      rzCol?.classList.remove("is-resizing");
      if (el && ev) el.draggable = canDrag(ev);
      rzEv = null; rzEl = null; rzCol = null; rzDay = null; rzMoved = false;
      if (!ev || !day) return;
      // Pressed and released without ever passing a snap boundary: the DOM was
      // never changed (rzPaint's first call reproduces the rendered geometry),
      // so there is nothing to put back and the click may open the sheet.
      if (!moved) return;
      if (!commit) { renderWeek(); return; }
      rzSwallowUntil = Date.now() + 500;
      const before = snapshot(ev);
      // Read BEFORE the span moves: the lane the block is currently DRAWN in.
      //
      // A resize is not a move. The block never leaves its lane — only its
      // extent changes — so the hint has to be where it already is, and
      // `laneFor` (which is what a DROP asks) is the wrong question here: it
      // lays out everyone else and hands the caller the first FREE lane, i.e.
      // the answer for a newcomer arriving. Asking it made a pair sharing an
      // hour swap sides the instant one of them was stretched, because the
      // stretched block was told to take the lane beside its neighbour and the
      // neighbour slid into the one it vacated. `honourLaneHints` still
      // validates both ends, so a hint that the new extent has made impossible
      // is simply ignored rather than stacking two cards.
      const held = layoutDay(eventsOn(day).filter(function (x) { return !x.allDay; }))
        .find(function (p) { return p.e.id === ev.id; });
      ev.start = atMins(day, a);
      ev.end = atMins(day, b);
      ev.lane = held ? held.lane : undefined;
      landed = ev.id;
      renderCal();
      flashEvent();
      void persistMove(ev, before);
    };

    on(wgBody, "pointerdown", function (e) {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      const grip = asEl(pe.target)?.closest<HTMLElement>(".wg-rz");
      if (!grip) return;
      const el = grip.closest<HTMLElement>(".wg-ev");
      const c = grip.closest<HTMLElement>(".wg-col");
      if (!el || !c || !el.dataset.ev || !c.dataset.day) return;
      const ev = eventsData.find(function (x) { return x.id === el.dataset.ev; });
      if (!ev || !canResize(ev)) return;
      closeFdd();
      dropGhost();
      // The block is `draggable` for the MOVE gesture. A press that starts on a
      // grip must not also arm an HTML5 drag, or the browser takes the pointer
      // away mid-resize and the block lands somewhere nobody asked for.
      el.draggable = false;
      rzEv = ev; rzEl = el; rzCol = c;
      rzDay = new Date(c.dataset.day);
      rzEdge = grip.dataset.rz === "start" ? "start" : "end";
      rzA = minsOf(ev.start);
      rzB = minsOf(ev.end);
      rzAnchor = rzEdge === "start" ? rzB : rzA;
      rzMoved = false;
      el.classList.add("is-resizing");
      c.classList.add("is-resizing");
      const layer = el.parentElement;
      if (layer) {
        rzTag = document.createElement("span");
        rzTag.className = "wg-rz-tag";
        layer.appendChild(rzTag);
      }
      rzPaint();
      // Suppresses the text selection a drag across the grid paints, and the
      // compat mouse events that would otherwise start the native drag.
      pe.preventDefault();
      rzPid = pe.pointerId;
      try { wgBody.setPointerCapture(rzPid); } catch { /* capture is best-effort */ }
    });

    on(wgBody, "pointermove", function (e) {
      const pe = e as PointerEvent;
      if (!rzEv || !rzCol) return;
      const raw = minsAtY(rzCol, pe.clientY);
      // Day bounds are the grid's own window, and the two edges are clamped
      // against each other one slot apart — so an edge can neither leave its
      // column nor pass its partner, and the minimum a block can be dragged to
      // is exactly the minimum `rescheduleJobEventTime` enforces server-side.
      if (rzEdge === "end") {
        rzA = rzAnchor;
        rzB = Math.min(WG_END * 60, Math.max(rzAnchor + SNAP_MIN, raw));
      } else {
        rzB = rzAnchor;
        rzA = Math.max(WG_START * 60, Math.min(rzAnchor - SNAP_MIN, raw));
      }
      if (rzA !== minsOf(rzEv.start) || rzB !== minsOf(rzEv.end)) rzMoved = true;
      rzPaint();
    });

    on(wgBody, "pointerup", function () { if (rzEv) rzEnd(true); });
    on(wgBody, "pointercancel", function () { if (rzEv) rzEnd(false); });
    on(document, "keydown", function (e) {
      if ((e as KeyboardEvent).key !== "Escape" || !rzEv) return;
      rzEnd(false);
    });
    on(root, "click", function (e) {
      if (!rzSwallowUntil || Date.now() > rzSwallowUntil) { rzSwallowUntil = 0; return; }
      rzSwallowUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true });
  }

  // dragging: event chips and tray cards.
  // `landed` names the chip that just moved — after the re-render it gets a
  // short landing flash so the eye can follow it (the donor's kanban idea).
  let landed: string | null = null;

  // A 1×1 fully transparent GIF, handed to `setDragImage` so the browser has
  // nothing to paint under the cursor. Dragging a week block used to show THREE
  // things at once: this native snapshot flying with the pointer, the source
  // block left in place at 40% opacity, and the blue landing preview. The first
  // said nothing the other two did not already say, and being a snapshot of an
  // element that is itself already faded it read as a smear.
  const BLANK_DRAG = new Image();
  BLANK_DRAG.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  on(document, "dragstart", function (e) {
    const t = asEl(e.target);
    if (!t) return;
    const chip = t.closest<HTMLElement>(".evc");
    if (chip) {
      cal.dragEvent = chip.dataset.ev || null; cal.dragJob = null;
      chip.classList.add("dragging");
      // Where inside the block the grab landed, in minutes. The browser's drag
      // image keeps that offset, so the drop must keep it too — otherwise the
      // block lands with its top at the cursor and the two previews disagree.
      cal.dragGrabMin = 0;
      const col = chip.closest<HTMLElement>(".wg-col");
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        // Firefox refuses to start a drag with no payload; this module never set
        // one, so HTML5 drag was silently dead there.
        dt.setData("text/plain", chip.dataset.ev || "");
        // ONLY in the week grid. Month and team have no `.wg-ghost` landing
        // preview (previewDrop bails for cells without `data-timecol`), so there
        // the flying copy is the only cursor-attached feedback and has to stay.
        if (col) dt.setDragImage(BLANK_DRAG, 0, 0);
      }
      const ev = eventsData.find(function (x) { return x.id === cal.dragEvent; });
      if (col && ev && !ev.allDay) {
        const box = chip.getBoundingClientRect();
        const dy = (e as DragEvent).clientY - box.top;
        cal.dragGrabMin = Math.round((dy / Math.max(1, box.height)) *
          Math.max(SNAP_MIN, (ev.end.getTime() - ev.start.getTime()) / 60000));
      }
      return;
    }
    const card = t.closest<HTMLElement>(".tray-card");
    if (card) {
      cal.dragJob = card.dataset.job || null; cal.dragEvent = null;
      // A tray card has no start time to offset from — and a stale offset from a
      // previous chip drag would shift the drop.
      cal.dragGrabMin = 0;
      card.classList.add("dragging");
    }
  });
  on(document, "dragend", function () {
    $$(".dragging").forEach(function (x) { x.classList.remove("dragging"); });
    $$(".dragover").forEach(function (x) { x.classList.remove("dragover"); });
    dropGhost();
    cal.dragEvent = null; cal.dragJob = null; cal.dragGrabMin = 0;
  });
  on(document, "dragover", function (e) {
    const cell = asEl(e.target)?.closest<HTMLElement>("[data-day]");
    if (!cell || (!cal.dragEvent && !cal.dragJob)) return;
    e.preventDefault();
    $$(".dragover").forEach(function (x) { if (x !== cell) x.classList.remove("dragover"); });
    cell.classList.add("dragover");
    // In the week grid, lay the column out as if the card were already dropped.
    if (!cell.dataset.timecol) { dropGhost(); return; }
    const ev = cal.dragEvent ? eventsData.find(function (x) { return x.id === cal.dragEvent; }) : null;
    if (ev && ev.allDay) { dropGhost(); return; }
    const durMin = ev
      ? Math.max(SNAP_MIN, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000))
      : 240;
    const job = cal.dragJob ? trayJobs.find(function (x) { return x.id === cal.dragJob; }) : null;
    const label = ev ? ev.title : job ? job.title : "Move here";
    previewDrop(cell, new Date(cell.dataset.day as string), dropStartMins(cell, (e as DragEvent).clientY),
      durMin, label, cal.dragEvent);
  });
  on(document, "dragleave", function (e) {
    // Leaving the grid entirely (not just crossing between its columns).
    const to = asEl((e as DragEvent).relatedTarget);
    if (!to || !to.closest(".wg-body")) dropGhost();
  });
  on(document, "drop", function (e) {
    const cell = asEl(e.target)?.closest<HTMLElement>("[data-day]");
    if (!cell) return;
    e.preventDefault();
    const day = new Date(cell.dataset.day as string);
    // Week columns are one continuous time axis, so the drop time comes from
    // where the pointer landed inside the column, snapped like drag-to-create.
    let hour = cell.dataset.hour ? Number(cell.dataset.hour) : null;
    let dropMins: number | null = null;
    if (cell.dataset.timecol) {
      // Same formula the preview used, so the block lands exactly where it was
      // shown — grab offset included.
      dropMins = dropStartMins(cell, (e as DragEvent).clientY);
      hour = Math.floor(dropMins / 60);
    }
    const targetWorker = cell.dataset.worker || null;
    if (cal.dragEvent) {
      const ev = eventsData.find(function (x) { return x.id === cal.dragEvent; });
      if (ev) {
        // Everything the move touches, captured before it moves — the revert
        // path for a write the server refuses.
        const before = snapshot(ev);
        cal.dragEvent = null; cal.dragJob = null;

        // Blocked time first: it has ONE move action, it changes the date only,
        // and it has no owner-transfer at all — so none of the branches below
        // describe anything it can actually do.
        if (wired && ev.kind === "blocked") {
          if (targetWorker) {
            toast("Blocked time belongs to whoever created it — it can’t be handed to another crew member.");
            return;
          }
          applyBlockedMove(ev, before, day, dropMins);
          landed = ev.id;
          renderCal(); flashEvent();
          void persistMove(ev, before);
          return;
        }

        // Crossing between the all-day band and the time grid changes what the
        // event IS, so the flag follows the surface it was dropped on.
        const intoBand = !!cell.closest(".wg-ad-cell");
        if (intoBand && !ev.allDay) {
          ev.allDay = true;
          ev.start = atMins(day, 0);
          ev.end = atMins(day, 23 * 60 + 59);
          landed = ev.id;
          renderCal(); flashEvent();
          void persistMove(ev, before);
          return;
        }
        if (cell.dataset.timecol && ev.allDay) {
          ev.allDay = undefined;
          const ns0 = atMins(day, dropMins != null ? dropMins : 8 * 60);
          ev.start = ns0; ev.end = addMin(ns0, 120);
          landed = ev.id;
          renderCal(); flashEvent();
          void persistMove(ev, before);
          return;
        }
        const dur = ev.end.getTime() - ev.start.getTime();
        const ns = dropMins != null
          ? atMins(day, dropMins)
          : (function () {
              const x = new Date(day);
              x.setHours(hour != null ? hour : ev.start.getHours(), hour != null ? 0 : ev.start.getMinutes(), 0, 0);
              return x;
            })();
        // Ask for the lane BEFORE the span moves — `laneFor` excludes this event
        // by id, but it reads every other block's live times, and the answer has
        // to describe where the preview was showing the card land.
        const landedLane =
          cell.dataset.timecol && dropMins != null
            ? laneFor(day, dropMins, Math.max(SNAP_MIN, Math.round(dur / 60000)), ev.id).lane
            : undefined;
        ev.start = ns; ev.end = new Date(ns.getTime() + dur);
        // The hint is what stops the re-render from re-laning the pair in start
        // order and swapping them under the cursor. Cleared for a drop outside
        // the time grid, where lanes do not exist.
        ev.lane = landedLane;
        // A team-row drop is a staffing change as well as a move, and the two
        // actions behind it disagree about what that means — so the optimistic
        // update has to match whichever one is about to run.
        // `assignEventWorker` ADDS the target to a job's crew; `syncAssignments`
        // (inside updateAppointment) REPLACES an appointment's staff list.
        if (targetWorker && ev.workers.indexOf(targetWorker) === -1) {
          ev.workers = wired && ev.kind === "job"
            ? ev.workers.concat([targetWorker])
            : [targetWorker];
        }
        landed = ev.id;
        renderCal(); flashEvent();
        void persistMove(ev, before, targetWorker && canManage ? targetWorker : undefined);
        return;
      }
    } else if (cal.dragJob) {
      const j = trayJobs.find(function (x) { return x.id === cal.dragJob; });
      if (j) {
        const ns = dropMins != null ? atMins(day, dropMins) : (function () {
          const x = new Date(day);
          x.setHours(hour != null ? hour : 8, 0, 0, 0);
          return x;
        })();
        evSeq += 1;
        const created: CalEvent = {
          id: "e" + evSeq, kind: "job", title: j.title + " — " + j.client,
          start: ns, end: new Date(ns.getTime() + 4 * 3600 * 1000),
          status: "SCHEDULED", workers: targetWorker ? [targetWorker] : [],
          client: j.client, addr: j.city,
        };
        eventsData.push(created);
        landed = "e" + evSeq;
        trayJobs = trayJobs.filter(function (x) { return x.id !== j.id; });
        cal.dragEvent = null; cal.dragJob = null;
        renderCal(); flashEvent();
        if (wired) void persistTrayDrop(created, j, day, dropMins != null || hour != null, targetWorker);
        return;
      }
    }
    cal.dragEvent = null; cal.dragJob = null;
    renderCal();
    flashEvent();
  });

  /**
   * A tray card became a scheduled job. `scheduleJobFromTray` is the action the
   * classic dispatch tray used: it books the job, writes the JobEvent and logs
   * the activity in one call — but it always books 9:00–14:00, so a drop that
   * named a time follows up with `rescheduleJobEventTime` to keep the block
   * where the user put it.
   *
   * The optimistic row is already on the grid under a temporary id; this
   * rewrites it with the real one, or takes it back off and returns the card to
   * the tray.
   */
  async function persistTrayDrop(
    created: CalEvent,
    job: TrayJob,
    day: Date,
    exactTime: boolean,
    targetWorker: string | null,
  ) {
    try {
      const res = await scheduleJobFromTray(job.id, day.toISOString());
      created.id = res.id;
      created.rid = res.id;
      created.jobId = job.id;
      if (exactTime) {
        await rescheduleJobEventTime(res.id, created.start.toISOString(), created.end.toISOString());
      } else {
        // No time was named, so the action's own 9:00–14:00 is the truth.
        created.start = atMins(day, 9 * 60);
        created.end = atMins(day, 14 * 60);
      }
      if (targetWorker && canManage) {
        await assignWorker(job.id, targetWorker);
        created.workers = [targetWorker];
      }
      renderCal();
    } catch (err) {
      const i = eventsData.indexOf(created);
      if (i > -1) eventsData.splice(i, 1);
      trayJobs = trayJobs.concat([job]);
      renderCal();
      toast(actionError(err));
    }
  }

  function flashEvent() {
    const id = landed;
    landed = null;
    if (!id || reduced()) return;
    const chip = root.querySelector<HTMLElement>('.evc[data-ev="' + id + '"]');
    if (!chip) return;
    chip.classList.add("ev-land");
    chip.addEventListener("animationend", function ae() {
      chip.classList.remove("ev-land");
      chip.removeEventListener("animationend", ae);
    });
  }

  // panel: pickers, kind tabs, save, delete, create
  onId("sheet", "click", function (e) {
    const t = asEl(e.target);
    if (!t) return;

    // ---- date-time pickers ----
    const dtpToggle = t.closest<HTMLElement>("[data-dtp-toggle]");
    if (dtpToggle) { setPop(dtpToggle.dataset.dtpToggle || null); return; }
    const host = t.closest<HTMLElement>("[data-dtp]");
    if (host) {
      const id = host.dataset.dtp as string;
      const nav = t.closest<HTMLElement>("[data-dtp-nav]");
      if (nav) {
        const cur = dtpCursor(id);
        cur.setMonth(cur.getMonth() + Number(nav.dataset.dtpNav));
        cal.form.calCursor[id] = cur.toISOString();
        paintDtp(id);
        return;
      }
      const dayBtn = t.closest<HTMLElement>("[data-dtp-day]");
      if (dayBtn) {
        const picked = new Date(dayBtn.dataset.dtpDay as string);
        setDatePart(id, picked);
        return;
      }
      const timeBtn = t.closest<HTMLElement>("[data-dtp-time]");
      if (timeBtn) {
        setTimePart(id, Number(timeBtn.dataset.dtpTime));
        return;
      }
      if (t.closest("[data-dtp-done]")) { setPop(null); paintDtp(id); return; }
      return;
    }

    // ---- crew ----
    if (t.closest("[data-crew-toggle]")) { setPop("crew"); return; }
    const crew = t.closest<HTMLElement>("[data-crew]");
    if (crew && crew.dataset.crew) {
      const i = cal.form.crew.indexOf(crew.dataset.crew);
      if (i === -1) cal.form.crew.push(crew.dataset.crew); else cal.form.crew.splice(i, 1);
      paintCrew();
      return;
    }

    // ---- all-day switch ----
    if (t.closest("[data-allday]")) {
      cal.form.allDay = !cal.form.allDay;
      if (cal.form.allDay) {
        // Normalise to whole days so the stored value matches what is shown.
        cal.form.start = atMins(cal.form.start, 0);
        if (cal.form.end.getTime() < cal.form.start.getTime()) cal.form.end = new Date(cal.form.start);
      } else if (minsOf(cal.form.start) === 0 && minsOf(cal.form.end) === 0) {
        // Coming back to a timed event, offer a sensible working slot.
        cal.form.start = atMins(cal.form.start, 8 * 60);
        cal.form.end = addMin(cal.form.start, 120);
      }
      cal.form.pop = null;
      repaintForm();
      return;
    }

    // ---- link ----
    if (t.closest("[data-link-clear]")) { cal.form.link = null; paintLink(); return; }
    if (t.closest("[data-lnk-toggle]")) { setPop("link"); return; }
    const tab = t.closest<HTMLElement>("[data-lt]");
    if (tab) {
      cal.form.linkTab = tab.dataset.lt || "all";
      paintLink(true);
      return;
    }
    const row = t.closest<HTMLElement>("[data-link]");
    if (row) {
      cal.form.link = cal.form.link === row.dataset.link ? null : (row.dataset.link as string);
      cal.form.pop = null;
      paintLink();
      // Borrow the linked record's name when the title is still empty.
      const titleEl = root.querySelector<HTMLInputElement>('[data-e="title"]');
      const opt = linkOpt(cal.form.link);
      if (titleEl && !titleEl.value.trim() && opt) titleEl.value = opt.title + " — " + opt.client;
      return;
    }

    // ---- status ----
    if (t.closest("[data-status-toggle]")) { setPop("status"); return; }
    const stOpt = t.closest<HTMLElement>("[data-status]");
    if (stOpt && stOpt.dataset.status) {
      cal.form.status = stOpt.dataset.status;
      cal.form.pop = null;
      paintStatus();
      return;
    }

    // ---- kind tabs ----
    const kind = t.closest<HTMLElement>("[data-kind]");
    if (kind) {
      const next = (kind.dataset.kind || "job") as CalKind;
      if (next === cal.kind) return;
      cal.kind = next;
      cal.form.pop = null;
      // The tab set differs per kind (an appointment links to leads/clients),
      // so a carried-over tab could name a type this kind cannot link to.
      cal.form.linkTab = "all";
      cal.form.linkQuery = "";
      cal.form.link = null;
      const body = byId("sheetBody");
      if (body) body.innerHTML = quickAddHtml();
      return;
    }

    const act = t.closest<HTMLElement>("[data-act]");
    if (!act) return;
    const val = function (f: string) {
      const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-e="' + f + '"]');
      return field ? field.value : "";
    };

    if (act.dataset.act === "open-href") {
      const href = act.dataset.href;
      // Same-origin dashboard paths only — the value is built above, never typed.
      if (!href || href.charAt(0) !== "/" || href.charAt(1) === "/") return;
      closeSheet();
      if (options.navigate) options.navigate(href);
      else window.location.assign(href);
      return;
    }
    if (act.dataset.act === "open-job") {
      const jobId = act.dataset.job;
      if (!jobId) return;
      closeSheet();
      const href = jobHref(jobId);
      if (options.navigate) options.navigate(href);
      else window.location.assign(href);
      return;
    }
    if (act.dataset.act === "save-event") {
      if (sheetBusy) return;
      void saveEvent(val);
      return;
    }
    if (act.dataset.act === "remove-desk") {
      const rid = act.dataset.rid;
      if (!rid || sheetBusy) return;
      void (async function () {
        setSheetBusy(true, "Removing…");
        let r: Awaited<ReturnType<typeof removeDeskHours>>;
        try { r = await removeDeskHours(rid); } catch (err) { setSheetBusy(false); sheetError(actionError(err)); return; }
        setSheetBusy(false);
        if (!r.ok) { sheetError(r.error); return; }
        for (let i = eventsData.length - 1; i >= 0; i--) if (eventsData[i].kind === "desk" && eventsData[i].rid === rid) eventsData.splice(i, 1);
        closeSheet(); renderCal();
        toast("Those hours are no longer reserved for the AI desk.", false);
      })();
      return;
    }
    if (act.dataset.act === "delete-event") {
      if (sheetBusy) return;
      void deleteEvent();
      return;
    }
    if (act.dataset.act === "create-event") {
      if (sheetBusy) return;
      void createEvent(val);
      return;
    }
    if (act.dataset.act === "confirm") {
      const row2 = act.closest<HTMLElement>("[data-inbox]");
      if (row2 && row2.dataset.inbox) void confirmAssignment(row2, row2.dataset.inbox);
      return;
    }
  });

  // ================= SHEET WRITES =================
  /** Set while a sheet action is in flight: a second click on Save must not
   *  start a second write against a form that is already committing. */
  let sheetBusy = false;

  /** The action's own wording, shown under the form it belongs to. Cleared by
   *  passing null. */
  function sheetError(msg: string | null) {
    const body = byId("sheetBody");
    if (!body) return;
    let box = body.querySelector<HTMLElement>(".sf-err");
    if (!msg) { box?.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.className = "sf-err";
      box.setAttribute("role", "alert");
      body.appendChild(box);
    }
    box.textContent = msg;
    box.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  /**
   * Refuse a save because a required field is empty: name the reason in the
   * sheet's own error box, mark the field, and put the caret in it.
   *
   * The mark clears on the next keystroke rather than on the next submit —
   * a field that stays red while you are fixing it is telling you something
   * that has stopped being true.
   */
  function requireField(field: string, msg: string) {
    sheetError(msg);
    const el = root.querySelector<HTMLInputElement>('[data-e="' + field + '"]');
    if (!el) return;
    el.classList.add("is-bad");
    el.setAttribute("aria-invalid", "true");
    el.addEventListener("input", function clear() {
      el.classList.remove("is-bad");
      el.removeAttribute("aria-invalid");
      sheetError(null);
      el.removeEventListener("input", clear);
    });
    el.focus();
  }

  /** Disable the sheet's actions and say what is happening on the primary one.
   *  Restores the label the button was authored with. */
  function setSheetBusy(on: boolean, busyLabel?: string) {
    sheetBusy = on;
    const primary = root.querySelector<HTMLButtonElement>('.sheet [data-act="save-event"], .sheet [data-act="create-event"]');
    root.querySelectorAll<HTMLButtonElement>(".sheet [data-act]").forEach(function (b) { b.disabled = on; });
    if (!primary) return;
    if (on) {
      // The authored label carries an icon, so the whole inner markup is stashed
      // and restored — replacing only the words would drop the check glyph.
      if (!primary.dataset.label) primary.dataset.label = primary.innerHTML;
      primary.textContent = busyLabel || "Saving…";
    } else if (primary.dataset.label) {
      primary.innerHTML = primary.dataset.label;
    }
  }

  /** Which record a link option points at, in the shape each create action wants. */
  function linkPayload(opt: LinkOption | null) {
    const rid = opt ? opt.rid || opt.id : null;
    return {
      jobId: opt && opt.kind === "job" ? rid : null,
      proposalId: opt && opt.kind === "proposal" ? rid : null,
      leadId: opt && opt.kind === "lead" ? rid : null,
      clientId: opt && opt.kind === "client" ? rid : null,
    };
  }

  async function saveEvent(val: (f: string) => string) {
    const ev = eventsData.find(function (x) { return x.id === cal.editing; });
    if (!ev) { closeSheet(); return; }
    const span = formSpan();
    const before = snapshot(ev);
    const beforeTitle = ev.title;
    const beforeNotes = ev.notes;
    const beforeStatus = ev.status;
    // Clearing the title used to silently restore the old one, so the field
    // could be emptied, saved, and come back full with no explanation. Refuse
    // it the same way the create form does.
    const title = val("title").trim();
    if (!title) { requireField("title", "Give this a title before saving it."); return; }
    sheetError(null);
    const notes = val("notes");
    const crew = readCrew();
    const timeChanged =
      span.start.getTime() !== before.start.getTime() || span.end.getTime() !== before.end.getTime();

    if (wired && ev.rid) {
      sheetError(null);
      setSheetBusy(true, "Saving…");
      try {
        if (ev.kind === "job") {
          await updateJobEvent(ev.rid, { title, notes: notes || null });
          if (timeChanged || cal.form.allDay !== before.allDay) {
            await rescheduleJobEventTime(ev.rid, span.start.toISOString(), span.end.toISOString());
          }
          // Status and crew live on the JOB, not the event — a jobless event has
          // neither, and saying so beats silently dropping the edit.
          if (ev.jobId) {
            // The picker only ever offers JOB_STATUSES, but `cal.form.status` is
            // a plain string — narrow against the same list the picker is built
            // from rather than asserting.
            const picked = JOB_STATUSES.find(function (s) { return s.value === cal.form.status; });
            if (picked && picked.value !== beforeStatus) {
              await updateJob(ev.jobId, { status: picked.value as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" });
            }
            await syncJobCrew(ev, crew);
          } else if (cal.form.status !== beforeStatus || crew.join() !== before.workers.join()) {
            setSheetBusy(false);
            sheetError("This event isn’t linked to a job, so it has no status or crew of its own. The title, notes and times were saved.");
            ev.title = title; ev.notes = notes; ev.start = span.start; ev.end = span.end;
            ev.allDay = cal.form.allDay || undefined;
            renderCal();
            return;
          }
        } else if (ev.kind === "appointment") {
          await updateAppointment(ev.rid, {
            title,
            notes: notes || null,
            startsAt: span.start.toISOString(),
            endsAt: span.end.toISOString(),
            workerIds: crew,
          });
          ev.workers = crew;
        } else {
          // Blocked time has no update action at all — only a date move. Refuse
          // the parts that cannot land instead of pretending they did.
          if (title !== beforeTitle || notes !== beforeNotes) {
            setSheetBusy(false);
            sheetError("Blocked time can only be moved or removed from here — its reason and notes aren’t editable yet.");
            return;
          }
          if (timeChanged) {
            applyBlockedMove(ev, before, span.start, span.start.getHours() * 60 + span.start.getMinutes());
            await rescheduleBlockedTime(ev.rid, ev.start.toISOString());
          }
          setSheetBusy(false);
          landed = ev.id;
          closeSheet(); renderCal(); flashEvent();
          return;
        }
      } catch (err) {
        // Some branches above have already moved the local model (the blocked
        // path normalises the span before it writes). Put it back so a refused
        // save leaves the grid exactly as the user found it.
        restore(ev, before);
        setSheetBusy(false);
        sheetError(actionError(err));
        renderCal();
        return;
      }
      setSheetBusy(false);
    }

    ev.title = title;
    ev.allDay = cal.form.allDay || undefined;
    ev.start = span.start;
    ev.end = span.end;
    if (ev.kind === "job") ev.status = cal.form.status || ev.status;
    ev.notes = notes;
    if (!wired || ev.kind !== "appointment") ev.workers = crew;
    // A company-wide block stays everyone's: an edit moves its time, never its owner (actions/blockedTime).
    if (ev.kind === "blocked" && !ev.orgWide) {
      ev.selfOnly = ev.workers.length === 0;
      if (ev.selfOnly) ev.workers = [OWNER.id];
    }
    landed = ev.id;
    closeSheet(); renderCal(); flashEvent();
  }

  /**
   * Crew on a job event is crew on the JOB. Diff the picker against what the
   * event arrived with: added members go through `assignWorker` (which notifies
   * them and puts the assignment in the crew inbox as PENDING — the same call
   * the Jobs page makes), removed ones through `unassignWorker`, which needs the
   * ASSIGNMENT id and is why the seed carries `assignmentIds`.
   */
  async function syncJobCrew(ev: CalEvent, next: string[]) {
    if (!ev.jobId) return;
    const prev = ev.workers.slice();
    const added = next.filter(function (w) { return prev.indexOf(w) === -1; });
    const removed = prev.filter(function (w) { return next.indexOf(w) === -1; });
    for (const w of removed) {
      const aid = ev.assignmentIds ? ev.assignmentIds[w] : undefined;
      // No assignment id means the row was created in this session and was
      // never read back; skip rather than guess at a delete target.
      if (aid) {
        await unassignWorker(aid);
        delete ev.assignmentIds![w];
      }
    }
    for (const w of added) await assignWorker(ev.jobId, w);
    ev.workers = next;
  }

  async function deleteEvent() {
    const i = eventsData.findIndex(function (x) { return x.id === cal.editing; });
    if (i < 0) { closeSheet(); return; }
    const ev = eventsData[i];
    if (wired && ev.rid) {
      sheetError(null);
      setSheetBusy(true, "Deleting…");
      try {
        if (ev.kind === "job") await deleteJobEvent(ev.rid);
        else if (ev.kind === "appointment") await deleteAppointment(ev.rid);
        else await deleteBlockedTime(ev.rid);
      } catch (err) {
        setSheetBusy(false);
        sheetError(actionError(err));
        return;
      }
      setSheetBusy(false);
    }
    eventsData.splice(i, 1);
    closeSheet(); renderCal();
  }

  async function createEvent(val: (f: string) => string) {
    if (cal.kind === "desk") { await createDeskHours(); return; }
    const title = val("title").trim();
    // Was a bare `.focus()` and nothing else: pressing Create on an empty form
    // moved the caret and gave no reason, so the button read as broken. A
    // refusal has to say what it wants.
    if (!title) { requireField("title", "Give this a title before creating it."); return; }
    sheetError(null);
    const span = formSpan();
    const st = span.start;
    const en = span.end;
    const crewIds = readCrew();
    // Blocked time with nobody picked is MY time — it lands on the owner's
    // row and reads as "Just me" everywhere it is shown.
    const selfOnly = cal.kind === "blocked" && crewIds.length === 0;
    const opt = linkOpt(cal.form.link);
    const link = linkPayload(opt);

    let newId = "e" + (evSeq + 1);
    let rid: string | undefined;
    let jobId: string | null | undefined;

    if (wired) {
      sheetError(null);
      setSheetBusy(true, cal.kind === "blocked" ? "Blocking…" : "Creating…");
      try {
        if (cal.kind === "job") {
          const res = await createJobEvent({
            title,
            jobId: link.jobId,
            proposalId: link.proposalId,
            startsAt: st.toISOString(),
            endsAt: en.toISOString(),
            notes: val("notes") || null,
          });
          newId = res.id; rid = res.id; jobId = res.jobId;
          // Staffing is a job-level write, so it only exists once a job does.
          if (res.jobId && crewIds.length) {
            for (const w of crewIds) await assignWorker(res.jobId, w);
          }
        } else if (cal.kind === "appointment") {
          const res = await createAppointment({
            title,
            leadId: link.leadId,
            clientId: link.clientId,
            proposalId: link.proposalId,
            startsAt: st.toISOString(),
            endsAt: en.toISOString(),
            notes: val("notes") || null,
            status: "SCHEDULED",
            workerIds: crewIds,
          });
          newId = "apt:" + res.id; rid = res.id;
        } else {
          const res = await createBlockedTime({
            reason: title,
            startsAt: st.toISOString(),
            endsAt: en.toISOString(),
          });
          newId = "block:" + res.id; rid = res.id;
        }
      } catch (err) {
        setSheetBusy(false);
        sheetError(actionError(err));
        return;
      }
      setSheetBusy(false);
    } else {
      evSeq += 1;
    }

    eventsData.push({
      id: newId, rid, jobId, kind: cal.kind, title: title, start: st, end: en,
      status: cal.kind === "job" ? cal.form.status : "SCHEDULED",
      workers: selfOnly ? [OWNER.id] : crewIds,
      notes: val("notes"),
      client: opt ? opt.client : undefined,
      selfOnly: selfOnly || undefined,
      allDay: cal.form.allDay || undefined,
    });
    landed = newId;
    // Linking a tray job schedules it, so it leaves the unscheduled list.
    if (opt && opt.kind === "job") {
      const linkedId = opt.rid || opt.id;
      trayJobs = trayJobs.filter(function (x) { return x.id !== linkedId; });
    }
    closeSheet(); renderCal(); flashEvent();
  }

  /** Reserve the picked hours for the AI desk, then show every day they land on. */
  async function createDeskHours() {
    sheetError(null);
    const desk = seed?.desk;
    if (!wired || !desk) { sheetError("Reserving hours needs the live calendar."); return; }
    const span = formSpan();
    const tz = desk.timeZone;
    const day = zonedYmd(span.start, tz);
    if (zonedYmd(span.end, tz) !== day) { sheetError("Reserve hours inside one day — pick an end on the same day."); return; }
    const weekly = !!root.querySelector<HTMLInputElement>('[data-e="deskWeekly"]')?.checked;
    const who = canManage ? root.querySelector<HTMLSelectElement>('[data-e="deskWho"]')?.value || "" : desk.me;
    setSheetBusy(true, "Reserving…");
    let res: Awaited<ReturnType<typeof reserveDeskHours>>;
    try {
      res = await reserveDeskHours({ userId: who || null, date: weekly ? null : day, dow: weekly ? new Date(day + "T12:00:00Z").getUTCDay() : null, from: zonedHhmm(span.start, tz), to: zonedHhmm(span.end, tz) });
    } catch (err) {
      setSheetBusy(false);
      sheetError(actionError(err));
      return;
    }
    setSheetBusy(false);
    if (!res.ok) { sheetError(res.error); return; }
    const w = res.window;
    const person = w.userId ? desk.people.find(function (p) { return p.userId === w.userId; }) : null;
    const wid = w.userId ? workersData.find(function (x) { return x.userId === w.userId; })?.id : undefined;
    const spans = expandWindows([w], TODAY, 183, tz);
    let first: string | null = null;
    for (const sp of spans) {
      const id = "desk:" + w.id + ":" + sp.startsAt.getTime();
      if (!first && sp.startsAt.getTime() >= span.start.getTime() - 60000) first = id;
      eventsData.push({ id, rid: w.id, kind: "desk", title: "AI desk hours · " + (person ? person.name : "anyone"), start: sp.startsAt, end: sp.endsAt, status: "SCHEDULED", workers: wid ? [wid] : [], deskUserId: w.userId || undefined, deskWeekly: sp.weekly || undefined });
    }
    landed = first;
    closeSheet(); renderCal(); flashEvent();
    toast("Reserved for the AI desk: " + res.words + ".", false);
  }

  /**
   * Crew inbox: mark one pending assignment accepted. The confirmed row leaves
   * on its own and the rows below close the gap — rebuilding the sheet body
   * would restart every remaining row's entrance and steal the focus from the
   * button that was just pressed.
   */
  async function confirmAssignment(row: HTMLElement, id: string) {
    const btn = row.querySelector<HTMLButtonElement>('[data-act="confirm"]');
    if (btn?.disabled) return;
    // Stash the whole inner markup, not the words: the label carries a check
    // glyph that a textContent restore would silently drop.
    const label = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.textContent = "Marking…"; }
    if (wired) {
      try {
        await markAssignmentAccepted(id);
      } catch (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
        toast(actionError(err));
        return;
      }
    }
    // The row STAYS (2026-08-22): the inbox is a confirmation ledger, so a
    // marked-accepted assignment flips its chip in place instead of leaving —
    // exactly what a real worker's accept does to the same row on reload.
    const item = inboxData.find(function (x) { return x.id === id; });
    if (item) item.status = "ACCEPTED";
    const chip = row.querySelector<HTMLElement>(".pstatus");
    if (chip) {
      chip.classList.remove("pstatus--pending");
      chip.classList.add("pstatus--accepted");
      chip.textContent = "accepted";
    }
    btn?.remove();
    renderBar();
    const pendingN = inboxData.filter(function (x) { return (x.status ?? "PENDING") === "PENDING"; }).length;
    const title = byId("sheetTitle");
    if (title) title.textContent = "Crew confirmations · " + pendingN + " pending";
  }

  /** After the all-day switch flips: update the switch in place (so its knob
   *  slides instead of the node being replaced and re-running the field
   *  cascade) and repaint both pickers. */
  function repaintForm() {
    const btn = root.querySelector<HTMLElement>("[data-allday]");
    if (btn) {
      btn.classList.toggle("on", cal.form.allDay);
      btn.setAttribute("aria-checked", String(cal.form.allDay));
      const em = btn.querySelector("em");
      if (em) {
        em.textContent = cal.form.allDay
          ? "Runs the whole day — no start or end time"
          : "Set an exact start and end time";
      }
    }
    paintTimes();
  }

  /** Move the date, keep the clock time; the end follows to keep the duration. */
  function setDatePart(id: string, picked: Date) {
    const cur = dtpValue(id);
    const next = atMins(picked, minsOf(cur));
    applyValue(id, next);
  }
  function setTimePart(id: string, mins: number) {
    applyValue(id, atMins(dtpValue(id), mins));
  }
  function applyValue(id: string, next: Date) {
    if (cal.form.allDay) {
      // Whole days: the start carries the span along, the end never precedes it.
      const day = atMins(next, 0);
      if (id === "start") {
        const span = Math.max(0, Math.round(
          (atMins(cal.form.end, 0).getTime() - atMins(cal.form.start, 0).getTime()) / 86400000));
        cal.form.start = day;
        cal.form.end = new Date(day.getTime() + span * 86400000);
      } else {
        cal.form.end = day.getTime() < atMins(cal.form.start, 0).getTime()
          ? new Date(cal.form.start)
          : day;
      }
      (["start", "end"] as const).forEach(function (k) {
        const v = dtpValue(k);
        cal.form.calCursor[k] = new Date(v.getFullYear(), v.getMonth(), 1).toISOString();
      });
      paintTimes();
      return;
    }
    if (id === "start") {
      const dur = Math.max(SNAP_MIN * 60000, cal.form.end.getTime() - cal.form.start.getTime());
      cal.form.start = next;
      cal.form.end = new Date(next.getTime() + dur);
    } else {
      // An end at or before the start is meaningless — clamp it forward.
      cal.form.end = next.getTime() <= cal.form.start.getTime()
        ? addMin(cal.form.start, 30)
        : next;
    }
    // Both calendars follow their own (possibly moved) value, so neither opens
    // on a month it no longer contains.
    (["start", "end"] as const).forEach(function (k) {
      const v = dtpValue(k);
      cal.form.calCursor[k] = new Date(v.getFullYear(), v.getMonth(), 1).toISOString();
    });
    paintTimes();
  }

  // Search inside the link picker (delegated: the input is re-rendered often).
  onId("sheet", "input", function (e) {
    const t = asEl(e.target);
    if (!t || t.id !== "lnkQ") return;
    cal.form.linkQuery = (t as HTMLInputElement).value;
    const list = root.querySelector<HTMLElement>(".lnk-list");
    if (list) list.innerHTML = linkRows();
  });

  on(document, "click", function (e) {
    const t = asEl(e.target);
    if (!t) return;
    if (t.closest('[data-sheet="close"]') || t.id === "sheetBg") { closeSheet(); return; }
    // A target the owning handler already re-rendered away is detached, and
    // `closest()` on it always misses — treating that as an outside click would
    // close the very menu that handler just reopened.
    if (!t.isConnected) return;
    if (!t.closest(".fdd")) closeFdd();
    if (!t.closest(".dtp") && !t.closest(".pdd")) closePops();
  });

  // ================= INITIALIZATION =================
  safe("init", function () {
    // A role that cannot create anything gets no create button. The grid's
    // click-to-create paths still exist (they are the same gesture as a click on
    // an empty cell) and answer with the one-line explanation in `openQuickAdd`.
    byId("newEventBtn")?.classList.toggle("is-hidden", CREATE_KINDS.length === 0);
    renderCal();

    // `?date=` already moved the cursor (see `entry` above, read before `cal`
    // was built). This is the other half: `?new=1` means the caller wants to
    // BOOK something on that day, so the create sheet opens prefilled at the
    // day's 8:00 default. `openQuickAdd` refuses on its own when the role
    // cannot create, so there is no second guard here.
    if (entry.create) {
      const day = entry.date ?? cal.cursor;
      openQuickAdd(atMins(day, 8 * 60), atMins(day, 10 * 60));
    } else if (entry.ev) {
      openDetail(entry.ev);
    }
    // Consumed either way: leaving them in the URL means Back re-opens the
    // sheet, and a stale `?date=` outliving the day it was about. A no-op at
    // handheld width, where `readEntryParams` declined to read them and the
    // handheld build owns the clearing — see its guard.
    if (entry.date || entry.create || entry.ev) clearEntryParams();
  });

  // Keep the week's "now" marker honest while the page stays open (outside the
  // motion block: the marker is information, not decoration).
  const nowTick = window.setInterval(syncNowLine, 30000);
  disposers.push(() => window.clearInterval(nowTick));

  // A visit booked from outside the grid — SmartBook's Requests card above it (2026-10-31): the visits are read
  // again and the view redrawn, so the Yes lands on the calendar without a reload.
  if (wired) {
    on(window, "jf:calendar-reload", function () {
      getCalendarSeed()
        .then(function (fresh) {
          eventsData.splice(
            0,
            eventsData.length,
            ...fresh.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end), workers: e.workers.slice(), assignmentIds: { ...(e.assignmentIds || {}) } })),
          );
          renderCal();
        })
        .catch(function () {
          /* the next visit to the page reads it */
        });
    });
  }

  // The mobile nav drawer and FLUID SCALE belong to the persistent chrome and
  // live in components/v3/blueprint-shell/shell-behavior.ts.

  // ================= MOTION SYSTEM — BALANCED (package 02) =================
  (function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

    // Reveal: load + scroll
    // Reveal adapts to scroll speed: slow scroll — the full 420ms animation;
    // fast — a short one (down to 200ms): never lagging, still visible.
    const vpH = window.innerHeight;
    const scrollHost = main;
    let velLastY = scrollHost ? scrollHost.scrollTop : 0;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    // `.main` is shell-owned and outlives this page, so the listener is
    // tracked for cleanup rather than left to die with the unmounted nodes.
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
    // `.sheet-bg` / `.sheet` are siblings of `.main` in the donor, not
    // `.content` children, so they were never part of its reveal cascade.
    // Inside the app they can only render as `.content` children, so they are
    // excluded here — the remaining blocks keep the donor's 60ms stagger.
    const blocks = $$(".content > *:not(.sheet):not(.sheet-bg)");
    blocks.forEach((el, i) => {
      el.classList.add("rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? i * 60 + "ms" : "200ms";
    });
    // Second layer of the arrival — Overview cascades its `.kpi` strip here.
    // This page has no `.kpi`, so the layer was silently absent; its equivalent
    // set of small units is the side cards. Skip anything the block cascade
    // already claimed: no element should carry `rv` and `rv-cell` at once.
    const cells = $$(".cal-card").filter((el) => !el.classList.contains("rv"));
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
            // element below the fold: duration from the current scroll speed
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

    // Row stagger on list (re)render
    function animateRows(list: HTMLElement) {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(".mg-row, .tray-card"));
      rows.forEach((r, i) => {
        r.style.opacity = "0";
        r.style.transform = "translateY(8px)";
        r.style.transition =
          "opacity 300ms " + EASE + " " + i * 45 + "ms, transform 300ms " + EASE + " " + i * 45 + "ms";
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            r.style.opacity = "1";
            r.style.transform = "none";
          }),
        );
        // Drop the inline styles once the stagger lands. Left in place, the
        // inline `transform: none` outranks every stylesheet `:hover` rule,
        // so hover lift on month rows and tray cards silently stops working.
        r.addEventListener("transitionend", function te(e) {
          if (e.propertyName !== "transform") return;
          r.style.opacity = "";
          r.style.transform = "";
          r.style.transition = "";
          r.removeEventListener("transitionend", te);
        });
      });
    }
    // Played on FIRST paint, and from then on only when the view or the week/
    // month actually changes — see `staggerRows` and its single caller in
    // `playViewAnim`.
    //
    // This used to hang off a MutationObserver on `#mgGrid`, which fires on ANY
    // childList change. So toggling a worker filter, typing one character into
    // the search box or expanding a day's "show more" replayed a six-row
    // staggered fade — the whole month blanked to `opacity: 0` and crawled back
    // over ~500ms on every click. The filter was in fact applying; it just
    // looked like the calendar had wiped itself. A chip that genuinely moved
    // still gets its own targeted `ev-land` flash from `flashEvent()`.
    ["mgGrid", "trayList"].forEach((id) => {
      const list = byId(id);
      if (list) animateRows(list);
    });
    staggerRows = (id: string) => {
      const list = byId(id);
      if (list) animateRows(list);
    };

    // Week / team chips cascade on a real ARRIVAL only — the renderers stay
    // motion-agnostic, exactly like the month rows above.
    //
    // These two hosts were the last MutationObserver stagger left in the app,
    // and the most costly one: `wgBody` is rebuilt by `renderWeek()`, which
    // `renderCal()` runs after EVERY mutation — so completing a drag replayed
    // the entrance animation across every chip in the week, under the cursor,
    // at the exact moment the user wanted to see where the card had landed.
    // Filter toggles and search keystrokes did the same. The month grid was
    // already moved onto `playViewAnim`'s gate; this puts the other two views
    // on the same one.
    function animateChips(host: HTMLElement, sel: string) {
      const chips = Array.from(host.querySelectorAll<HTMLElement>(sel));
      chips.forEach((c, i) => {
        c.style.opacity = "0";
        c.style.transform = "translateY(6px)";
        c.style.transition =
          "opacity 260ms " + EASE + " " + Math.min(i * 26, 320) + "ms, transform 260ms " + EASE + " " + Math.min(i * 26, 320) + "ms";
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            c.style.opacity = "1";
            c.style.transform = "none";
          }),
        );
        c.addEventListener("transitionend", function te(e) {
          if (e.propertyName !== "transform") return;
          c.style.opacity = "";
          c.style.transform = "";
          c.style.transition = "";
          c.removeEventListener("transitionend", te);
        });
      });
    }
    const CHIP_HOSTS = [["wgBody", ".wg-ev"], ["tgBody", ".evc"]] as const;
    /** Re-read by id on every call: `renderWeek`/`renderTeam` replace the host's
     *  children, and the card itself is hidden and shown as views switch. */
    const cascadeChips = () => {
      CHIP_HOSTS.forEach(([id, sel]) => {
        const host = byId(id);
        if (host) animateChips(host, sel);
      });
    };
    cascadeChips();
    staggerChips = cascadeChips;


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

    // Press effects — delegated to `root` so nodes injected after init
    // (menu items, JS-rendered buttons, innerHTML re-renders) still press.
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
    pressify(".btn, .card-foot-btn, .ptab, .pchip, .pager-btn, .pmenu-item, .photo-box, .pt-open", "pressed");
    pressify(".week-strip .day", "day-pressed");
    // The toolbar, the view switcher and the filter triggers exist from first
    // paint; everything inside a pop-over is injected later, so those press via
    // delegation on `.content` instead of per-node listeners.
    pressify(".cal-nav, .vsw-btn", "pressed");
    on(root, "click", (e) => {
      const el = (e.target instanceof HTMLElement ? e.target : null)?.closest<HTMLElement>(
        ".fdd-btn, .fdd-opt, .dtp-btn, .dtp-day, .dtp-time, .dtp-done, .pdd-btn, .pdd-opt, .lnk-tab, .lnk-row, .sf-kind",
      );
      if (!el) return;
      el.classList.remove("pressed");
      void el.offsetWidth;
      el.classList.add("pressed");
      el.addEventListener("animationend", function ae() {
        el.classList.remove("pressed");
        el.removeEventListener("animationend", ae);
      });
    });

    // (Graph-paper parallax lives in the shell — it owns .main.)
  })();

  // The sliding sidebar indicator lives in the shell — it survives navigation
  // and re-points at whichever item React marks `active`.

  return () => {
    disposers.forEach((d) => d());
  };
}
