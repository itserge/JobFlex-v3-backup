"use client";

// MOBILE WORKERS (mobile-workers-v2) — Blueprint system, handheld build.
//
// Fourth sibling to mobile-v2 (Overview), mobile-proposals-v2 (Proposals) and
// mobile-clients-v2 (Clients). Tokens, palette, type scale, status tones and
// Motion System "Balanced" are the reference dashboard's; the shell (topbar +
// hamburger drawer + sprite) is the shared <MobileNav />, so the four handheld
// surfaces are one product. Where a question had a precedent on
// mobile-clients-v2, this page answers it the same way.
//
// Every component / region / variant of the desktop workers sheet is covered:
//  · the Crew / Roster crumb head + the Invite-worker action + the search box
//  · the three stat filter tiles → a computed masthead (one numeral, mono
//    kicker, EXACTLY two annotations) plus one filter dropdown
//  · the 7-column roster list → row cards with monogram avatars
//  · invite-status states (accepted / pending / declined) and the role pill
//  · the per-worker load figure and the hourly rate
//  · BOTH empty states (empty roster / no match) with their actions
//  · the inspector aside → the record view of the worker sheet: every field
//    row, the active-jobs manifest, and the token portal link with a real
//    clipboard copy
//  · the invite / edit dialog → a form sheet (required-field errors, locked
//    email on edit, the 4-way role picker, the mono invite note)
//  · the remove dialog → the confirm view of the same sheet
//
// What changes versus the desktop sheet, and why:
//  · The desktop's 7-column row cannot survive 320px, so each worker becomes a
//    three-line row card — not a table with columns hidden.
//  · The three stat tiles cannot be a chip rail at 320px: their numbers become
//    the masthead and their filter role becomes one dropdown.
//  · The inspector cannot sit beside the list on a phone, so it is a view of
//    the bottom sheet the ⋮ button already opens (CLAUDE.md prefers sheets, and
//    there is no hover on touch).
//  · The roster pages 6 at a time: a handheld row is three lines tall.
//  · The folio number leaves the row and lives in the sheet kicker — it was
//    noise repeated on every row, and it is an identifier, not a decision.
//
// THIS IS NOT A FIXTURE any more (2026-08-16). The roster is the org's real
// crew: ./workers-roster.ts runs the desktop page's own query on mount, and the
// invite / edit / remove flows call the same three server actions the desktop
// sheet calls (createWorkerInvite, updateWorker, removeWorker). Local state is
// still updated in step so one row moves rather than the whole book blinking —
// but the write happens first, and a failure keeps the sheet open with the
// action's own message on it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./mobile-workers.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { createWorkerInvite, removeWorker, updateWorker } from "@/actions/workers";
import { failureAsError } from "@/lib/planLimits";
import { roleAccess } from "@/lib/roleAccess";
import { loadRoster } from "./workers-roster";
import {
  ALL,
  FILTERS,
  PAGE_SIZE,
  WORKER_ROLES,
  counts,
  filterCount,
  matchesFilter,
  matchesQuery,
  monogram,
  portalLink,
  roleLabel,
  type WorkerEntry,
} from "./workers-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** Invite status is a real status, so it takes the three-tone treatment:
 *  base border, soft fill, base text. Never used for decoration elsewhere. */
const INVITE: Record<string, { label: string; cls: string }> = {
  ACCEPTED: { label: "Active", cls: "badgeOk" },
  PENDING: { label: "Invited", cls: "badgeWarn" },
  DECLINED: { label: "Declined", cls: "badgeDanger" },
};

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
      el.textContent = num(value);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = num(value * (1 - Math.pow(1 - pr, 3)));
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div ref={ref} className={className}>
      {num(value)}
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

/** The action's own message where it wrote one ("That worker has already
 *  joined…", "Not found"), a generic line for the transport failures that carry
 *  none. Same contract as the desktop dialog's `actionError`. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** The worker sheet is one element with three views, so moving from the action
 *  list to the record — or to the delete confirmation — never cross-slides two
 *  sheets past each other. */
type SheetView = "actions" | "record" | "confirm";

export function MobileWorkers() {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // `null` is LOADING, not empty. The distinction is the whole point: an empty
  // array is a real answer ("no crew yet") and drawing that state while the read
  // is still in flight tells a contractor with a twelve-man crew that their
  // roster is gone.
  const [data, setData] = useState<WorkerEntry[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);

  /* ---- the worker sheet ---- */
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [view, setView] = useState<SheetView>("actions");
  const [copied, setCopied] = useState(false);

  /* ---- the invite / edit form sheet ---- */
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", rate: "", spec: "" });
  const [role, setRole] = useState<string>("INSTALLER");
  const [nameErr, setNameErr] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [rateErr, setRateErr] = useState(false);
  /** A write is in flight. The foot buttons say so and refuse a second tap —
   *  createWorkerInvite sends an email, so a double submit is not free. */
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const filterRef = useRef<HTMLDivElement>(null);

  /* Portal links are absolute in the real product, so the host is read from the
     browser once, in a lazy initialiser rather than in an effect. There is no
     hydration risk: the link string only ever renders inside the worker sheet,
     which is closed on first paint, so the server's fallback never reaches the
     DOM as text. */
  const [host] = useState(() =>
    typeof window === "undefined" ? "jobflex.app" : window.location.host,
  );

  /* ---------- the roster read ------------------------------------------
     One read on mount, the desktop page's own query (./workers-roster.ts).
     `alive` because a handheld visitor can navigate off the surface long
     before a cold server action answers. */
  const reload = useCallback(async () => {
    try {
      const rows = await loadRoster();
      setData(rows);
      setLoadErr(null);
    } catch (err) {
      setLoadErr(actionError(err));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadRoster()
      .then((rows) => alive && setData(rows))
      .catch((err) => alive && setLoadErr(actionError(err)));
    return () => {
      alive = false;
    };
  }, []);

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
    const host2 = scrollRef.current;
    const content = contentRef.current;
    if (!host2 || !content) return;

    let velLastY = host2.scrollTop;
    let velLastT = performance.now();
    let vel = 0;
    const onScroll = () => {
      const now = performance.now();
      vel = Math.abs(host2.scrollTop - velLastY) / Math.max(1, now - velLastT);
      velLastY = host2.scrollTop;
      velLastT = now;
    };
    host2.addEventListener("scroll", onScroll, { passive: true });

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
      host2.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ---------- Motion: graph-paper parallax ----------------------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host2 = scrollRef.current;
    if (!host2) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host2.style.setProperty("--gy", `${(-(host2.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host2.addEventListener("scroll", onScroll, { passive: true });
    return () => host2.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp (delegated, covers late rows) --------- */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const sel = [
      styles.btn, styles.ddBtn, styles.ddItem, styles.pagerBtn, styles.wmenuItem,
      styles.sheetCancel, styles.sheetBack, styles.wrowOpen,
      styles.wemptyA, styles.srchX, styles.roleBtn, styles.linkBtn,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes whatever the PAGE owns, topmost first ----------
     The drawer is not listed: MobileNav owns its own Escape, and it only binds
     while open, so the two listeners cannot both claim one key press. Inside
     the worker sheet, Escape steps back a view before it closes the sheet. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (formOpen) setFormOpen(false);
      else if (sheetId && view !== "actions") setView("actions");
      else if (sheetId) setSheetId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, formOpen, sheetId, view]);

  /* ---------- Filter dropdown: close on outside tap -------------------- */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen]);

  /* ---------- Paging returns you to the top of the roster ---------------
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

  /* ---------- The copy confirmation clears itself ----------------------- */
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  /* ---------- derived ------------------------------------------------- */
  /** The roster once it has arrived. Everything below reads this rather than
   *  `data`, so a read in flight is a distinct state and never a false empty. */
  const roster = useMemo(() => data ?? [], [data]);
  const loading = data === null && loadErr === null;
  const visible = useMemo(
    () => roster.filter((e) => matchesFilter(e, filter) && matchesQuery(e, query)),
    [roster, filter, query],
  );
  const c = useMemo(() => counts(roster), [roster]);

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const sheetWorker = sheetId === null ? null : (roster.find((e) => e.id === sheetId) ?? null);
  const editWorker = editId === null ? null : (roster.find((e) => e.id === editId) ?? null);
  const sheetFolio = sheetWorker ? String(roster.indexOf(sheetWorker) + 1).padStart(2, "0") : "—";
  const sheetPath = sheetWorker ? portalLink(host, sheetWorker.token) : "";

  const resetFilters = () => {
    setFilter(ALL);
    setQuery("");
    setPage(1);
  };

  const openSheet = (id: string) => {
    setView("actions");
    setCopied(false);
    setSheetId(id);
  };

  /* Tapping the ROW opens the same sheet already on its record view. The row is
     an identity, not a menu: on a phone the question a crew row raises is "who
     is this and how do I reach them", and making you pick "Worker record" out of
     a six-row action list first is a tap spent on nothing. The ⋮ button still
     opens the action list, so both intents keep a target of their own. */
  const openRecord = (id: string) => {
    setView("record");
    setCopied(false);
    setSheetId(id);
  };

  /* ---------- the token portal link ------------------------------------
     The link is the thing a manager actually hands to a worker, so it goes on
     the clipboard for real; the check flash is the confirmation of a write that
     happened, not a decoration. */
  const copyPortal = () => {
    if (!sheetPath) return;
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(sheetPath.startsWith("http") ? sheetPath : `${window.location.protocol}//${sheetPath}`)
        .then(done, done);
    } else {
      done();
    }
  };

  /* ---------- row sheet ------------------------------------------------
     Built inline rather than memoised: it is six literals, and a useMemo over a
     row of `data` is exactly the shape the React Compiler refuses to optimise
     around. Call and Send email arrive DISABLED whenever the record has no
     number or no address on file, and one row is the danger row. */
  const menuRows: MenuRow[] = sheetWorker
    ? [
        { act: "record", icon: "i-user", tone: styles.wmiBp, title: "Worker record",
          sub: "Contact, trades, rate and portal" },
        { act: "call", icon: "i-phone", tone: styles.wmiSky, title: "Call worker",
          sub: sheetWorker.phone ?? "No phone on file", disabled: !sheetWorker.phone },
        { act: "mail", icon: "i-mail", tone: styles.wmiOk, title: "Send email",
          sub: sheetWorker.email ?? "No email on file", disabled: !sheetWorker.email },
        { act: "copy", icon: "i-copy", tone: styles.wmiWarn, title: "Copy portal link",
          sub: copied ? "Link copied to clipboard" : sheetPath },
        { act: "edit", icon: "i-workers-pen", title: "Edit worker",
          sub: "Name, phone, rate, trades and role" },
        { act: "remove", icon: "i-trash", tone: styles.wmiDanger, title: "Remove worker",
          sub: "They lose portal access at once", danger: true },
      ]
    : [];

  /* ---------- the invite / edit form ----------------------------------- */
  const openForm = (entry: WorkerEntry | null) => {
    setEditId(entry ? entry.id : null);
    setForm({
      name: entry ? entry.name : "",
      email: entry?.email ?? "",
      phone: entry?.phone ?? "",
      rate: entry && entry.rate !== null ? String(entry.rate) : "",
      spec: entry ? entry.specialties.join(", ") : "",
    });
    setRole(entry ? entry.role : "INSTALLER");
    setNameErr(false);
    setEmailErr(false);
    setRateErr(false);
    setFormErr(null);
    setSheetId(null);
    setFormOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  const runMenu = (act: string) => {
    const e = sheetWorker;
    if (!e) return;
    if (act === "record") {
      setView("record");
      return;
    }
    if (act === "copy") {
      copyPortal();
      return;
    }
    if (act === "edit") {
      openForm(e);
      return;
    }
    if (act === "remove") {
      setView("confirm");
      return;
    }
    // Call and Send email hand off to the device in the real product; here they
    // just close, the same as the corresponding rows on mobile-clients-v2.
    setSheetId(null);
  };

  /* The real removal. The row leaves local state only after the action has
     answered — an optimistic drop would hide a "Can't remove the last owner"
     refusal behind a row that is already gone. */
  const confirmRemove = async () => {
    const e = sheetWorker;
    if (!e || removing) return;
    setRemoving(true);
    setRemoveErr(null);
    try {
      await removeWorker(e.id);
      setData((prev) => (prev ?? []).filter((x) => x.id !== e.id));
      setPage(1);
      setSheetId(null);
    } catch (err) {
      setRemoveErr(actionError(err));
    } finally {
      setRemoving(false);
    }
  };

  const submitForm = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    const email = form.email.trim();
    const rateRaw = form.rate.trim();
    const rate = rateRaw ? Number(rateRaw) : null;

    const badName = !name;
    // createWorkerInvite needs a real address: the invite link is emailed, and
    // the address doubles as the worker's login identity. It is locked on edit.
    const badEmail = !editId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const badRate = rate !== null && !Number.isFinite(rate);
    setNameErr(badName);
    setEmailErr(badEmail);
    setRateErr(badRate);
    if (badName) {
      nameRef.current?.focus();
      return;
    }
    if (badEmail) {
      emailRef.current?.focus();
      return;
    }
    if (badRate) return;

    const specialties = form.spec.split(",").map((s) => s.trim()).filter(Boolean);
    const phone = form.phone.trim() || null;

    setSaving(true);
    setFormErr(null);
    try {
      if (editId) {
        await updateWorker({ id: editId, name, role, phone, specialties, hourlyRate: rate });
        // ONE worker changed, so one row is swapped rather than the roster
        // re-read: a full reload here would blink every other row for nothing.
        setData((prev) =>
          (prev ?? []).map((x) =>
            x.id === editId ? { ...x, name, phone, rate, specialties, role } : x,
          ),
        );
        setLandedId(editId);
      } else {
        // The action returns the REAL profile id and magic-link token, so the
        // row appended here is the database row — portal link included.
        const created = await createWorkerInvite({
          name,
          email,
          role,
          phone,
          specialties,
          hourlyRate: rate,
        });
        if (!created.ok) throw failureAsError(created);
        const rec: WorkerEntry = {
          id: created.id,
          name,
          email,
          phone,
          specialties,
          rate,
          token: created.token,
          invite: "PENDING",
          role,
          joined: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
          lastActive: "Never",
          jobs: [],
        };
        // Appended, not prepended: the folio is the array index, so inserting at
        // the top would renumber the whole roster. The filter is cleared and the
        // pager jumps to the page the new row lands on, so the flash lands on a
        // row that is actually on screen.
        setData((prev) => [...(prev ?? []), rec]);
        setFilter(ALL);
        setQuery("");
        setPage(Math.ceil((roster.length + 1) / PAGE_SIZE));
        setLandedId(rec.id);
      }
      setFormOpen(false);
    } catch (err) {
      // The sheet stays open with the action's own refusal on it — "That worker
      // has already joined", a seat limit, a dead connection.
      setFormErr(actionError(err));
    } finally {
      setSaving(false);
    }
  };

  const anyOverlay = Boolean(sheetWorker) || formOpen;

  // Swipe-down dismissal. The worker sheet closes outright rather than stepping
  // back a view: the pull is the scrim's gesture, not the Back chevron's, and
  // the chevron and Escape still walk the views.
  const workerDrag = useSheetDrag(Boolean(sheetWorker), () => setSheetId(null));
  const formDrag = useSheetDrag(formOpen, () => setFormOpen(false));

  return (
    <div className={styles.app} onClick={onRootClick}>

      {/* Shared handheld nav: topbar + drawer + the 48-symbol sprite. Owns its
          own open state, so the page holds none. */}
      <MobileNav />

      {/* The one glyph the shared sprite does not carry. Prefixed so it can
          never collide with the shared set or another page's additions.
          Original lucide `pencil`, 24×24, stroke 2, currentColor. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <symbol id="i-workers-pen" viewBox="0 0 24 24">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </symbol>
        </defs>
      </svg>

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD
              The badge is one word (owner, 2026-08-16). "Crew · Roster" said
              the same thing twice and then said it a third time under the
              title, which is what a page called WORKERS already says. */}
          <div className={styles.pageHead}>
            <div className={styles.kicker}>Crew</div>
            <h1 className={styles.pageTitle}>Workers</h1>
            <div className={styles.pageActions}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={() => openForm(null)} data-tour="team:invite">
                <Icon id="i-userplus" />Invite worker
              </button>
            </div>
          </div>

          {/* MASTHEAD — one numeral, mono kicker, EXACTLY two annotations.
              All three are computed, so inviting or removing moves them. */}
          <div className={styles.wmast}>
            <div className={styles.wmastTop}>
              <div className={styles.wmastLbl}>
                Crew
                <span className={styles.wmastRule} />
              </div>
              <CountUp value={c.all} className={styles.wmastVal} />
            </div>
            <div className={styles.wmastCnt}>
              <div className={styles.wmastSub}>
                <div className={styles.wmastSubL}>On a job</div>
                <div className={styles.wmastSubV}>{c.onJob}</div>
              </div>
              <div className={styles.wmastSub}>
                <div className={styles.wmastSubL}>Assignments</div>
                <div className={styles.wmastSubV}>{c.active}</div>
              </div>
            </div>
          </div>

          {/* FIND BAR — search over the roster, plus the three stat-tile
              filters (and the two invite states) as ONE dropdown. */}
          <div className={styles.find}>
            <label className={styles.srch}>
              <Icon id="i-search" />
              <input
                className={styles.srchInput}
                type="search"
                value={query}
                placeholder="Search name, email or trade…"
                autoComplete="off"
                aria-label="Search the roster"
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
                <span className={`${styles.ddValue} ${filter === ALL ? styles.isAll : ""}`}>
                  {activeFilter.label} · {filterCount(roster, filter)}
                </span>
                <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
              </button>
              <div className={styles.ddMenu} role="listbox">
                {FILTERS.map((f) => (
                  <button key={f.key} className={`${styles.ddItem} ${filter === f.key ? styles.active : ""}`}
                    type="button" role="option" aria-selected={filter === f.key}
                    onClick={() => { setFilter(f.key); setPage(1); setFilterOpen(false); }}>
                    {f.label}
                    <span className={styles.ddCount}>{filterCount(roster, f.key)}</span>
                    {filter === f.key ? <Icon id="i-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ROSTER — the desktop 7-column list re-cut as row cards.
              Four states, in the order they can occur: the read is in flight,
              the read failed, the crew is genuinely empty, the filters match
              nothing. The first two used to be impossible because the page
              could not fail — it rendered a constant. */}
          {loadErr ? (
            <div className={styles.wempty}>
              <div className={styles.wemptyT}>Couldn&rsquo;t load your crew</div>
              <div className={styles.wemptyS}>{loadErr}</div>
              <button className={styles.wemptyA} type="button"
                onClick={() => { setLoadErr(null); void reload(); }}>
                <Icon id="i-rotate" />Try again
              </button>
            </div>
          ) : loading ? (
            <div className={styles.wempty}>
              <div className={styles.wemptyT}>Loading your crew…</div>
              <div className={styles.wemptyS}>Reading the roster on file for your company.</div>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.wempty}>
              {roster.length === 0 ? (
                <>
                  <div className={styles.wemptyT}>No workers on the books</div>
                  <div className={styles.wemptyS}>
                    Invite your first crew member. They get a token portal — no password,
                    no account juggling, and you keep control of the link.
                  </div>
                  <button className={styles.wemptyA} type="button" onClick={() => openForm(null)}>
                    <Icon id="i-userplus" />Invite the first worker
                  </button>
                </>
              ) : (
                <>
                  <div className={styles.wemptyT}>No matches</div>
                  <div className={styles.wemptyS}>No worker matches that search and filter.</div>
                  <button className={styles.wemptyA} type="button" onClick={resetFilters}>
                    <Icon id="i-x" />Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.book}>
              {slice.map((e, i) => {
                const inv = INVITE[e.invite] ?? INVITE.PENDING;
                return (
                  <div
                    key={e.id}
                    className={`${styles.wrow} ${styles.rowIn} ${landedId === e.id ? styles.landed : ""}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    {/* The whole card is the target for "open this worker".
                        A transparent stretched button rather than wrapping the
                        row in one: the ⋮ is a button too, and a button cannot
                        legally nest inside a button. It is listed FIRST so the
                        record is what a tab reaches before the ⋮ overflow. */}
                    <button className={styles.wrowHit} type="button"
                      aria-label={`Open ${e.name}'s record`} onClick={() => openRecord(e.id)} />
                    <span className={`${styles.wav} ${e.invite === "ACCEPTED" ? "" : styles.isProvisional}`}>
                      {monogram(e.name)}
                    </span>
                    {/* IDENTITY BLOCK — name line and contact line in ONE grid
                        cell, so the pair is welded and centred against the
                        monogram instead of being pushed apart by the slack of
                        a two-row span. */}
                    <div className={styles.wid}>
                      <div className={styles.wname}>
                        <span className={styles.wnameT}>{e.name}</span>
                        {/* The affordance. Without it a flat row card reads as
                            a read-out, and only the ⋮ looks pressable — so the
                            disclosure chevron rides with the name, where the
                            eye already is, and slides on press. It is a FLEX
                            item, not inline text: the app's reset draws every
                            svg as display:block, which used to drop this glyph
                            onto a line of its own between the name and the
                            email. */}
                        <Icon id="i-chevr" className={`${styles.ic} ${styles.wnameChev}`} />
                      </div>
                      {/* How you reach them. Not uppercased: an address that is
                          not lower-case is an address you mistype. */}
                      <div className={`${styles.wmeta} ${e.email ? "" : styles.isNone}`}>
                        {e.email ?? "no email on file"}
                        {/* when they were last in the app — the desk roster's plate (2026-09-24) */}
                        {e.lastActive && e.lastActive !== "Never" ? <span className={styles.wseen}>{e.lastActive.replace(/^Active /, "active ")}</span> : null}
                      </div>
                    </div>
                    <button className={styles.wrowOpen} type="button"
                      aria-label={`Actions for ${e.name}`} onClick={() => openSheet(e.id)}>
                      <Icon id="i-dots" />
                    </button>
                    {/* Row 3 — status badges lead, the figures close at the far
                        right. Folio and "joined" were dropped: they are in the
                        sheet, and neither changes a decision here. */}
                    <div className={styles.wrowFoot}>
                      <span className={styles.wbadges}>
                        <span className={`${styles.badge} ${styles[inv.cls]}`}>{inv.label}</span>
                        <span className={`${styles.badge} ${styles.rolePill}`}>{roleLabel(e.role)}</span>
                      </span>
                      <span className={styles.wrowFigs}>
                        <span className={styles.wjobs}>
                          {e.jobs.length ? `${e.jobs.length} job${e.jobs.length === 1 ? "" : "s"}` : "no jobs"}
                        </span>
                        {/* No rate reads as a dash, never "$0" — zero is a
                            number, "no rate on file" is an absence. The truthy
                            test is the donor's own: a $0/hr crew member is not
                            a state this roster has, so 0 means unset. */}
                        <span className={`${styles.wrate} ${e.rate ? "" : styles.isZero}`}>
                          {e.rate ? <>${e.rate}<span className={styles.wrateU}>/hr</span></> : "—"}
                        </span>
                      </span>
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
        </div>
      </main>

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => { setSheetId(null); setFormOpen(false); }}
        aria-hidden="true"
      />

      {/* ============ WORKER SHEET — actions / record / confirm ============
          The desktop's ⋮ menu, its 360px inspector aside and its remove dialog
          are three views of one sheet, so stepping between them never slides
          two sheets past each other. */}
      <div className={`${styles.sheet} ${sheetWorker ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label={sheetWorker ? `Worker · ${sheetWorker.name}` : "Worker"} aria-hidden={!sheetWorker} {...workerDrag.sheetProps}>
        <div className={styles.sheetGrab} {...workerDrag.handleProps} />
        {/* HEAD — rebuilt 2026-08-16. It was a 44px back square beside a
            three-clause eyebrow that wrapped to two lines the moment the square
            appeared, which left the name sitting low and off-axis. Now: a 38px
            back square centred on the whole text block, a ONE-LINE eyebrow
            (folio and role — the joined date is a field row in the record
            below, where it was already repeated), and the name a size up so the
            record reads as a record rather than as a wide menu title. */}
        <div className={styles.sheetHead} {...workerDrag.handleProps}>
          {view === "actions" ? null : (
            <button className={styles.sheetBack} type="button" aria-label="Back to actions"
              onClick={() => setView("actions")}>
              <Icon id="i-chevl" />
            </button>
          )}
          <div className={styles.sheetHeadTxt}>
            <div className={styles.sheetKicker}>
              {sheetWorker ? `Folio ${sheetFolio} · ${roleLabel(sheetWorker.role)}` : "Worker"}
            </div>
            <div className={styles.sheetTitle}>
              {view === "confirm" ? `Remove ${sheetWorker?.name ?? "worker"}?` : sheetWorker?.name ?? "Actions"}
            </div>
          </div>
        </div>

        {/* ---- view: actions ---- */}
        {view === "actions" ? (
          <>
            <div className={styles.sheetBody}>
              {menuRows.map((r) => (
                <button key={r.act} type="button" disabled={r.disabled}
                  className={`${styles.wmenuItem} ${r.danger ? styles.wmenuItemDanger : ""}`}
                  onClick={() => runMenu(r.act)}>
                  <span className={`${styles.wmiIc} ${r.tone ?? ""} ${r.act === "copy" && copied ? styles.done : ""}`}>
                    <Icon id={r.act === "copy" && copied ? "i-check" : r.icon} />
                  </span>
                  <span className={styles.wmenuItemTxt}>
                    <span className={styles.wmenuItemT}>{r.title}</span>
                    <span className={styles.wmenuItemS}>{r.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            <button className={styles.sheetCancel} type="button" onClick={() => setSheetId(null)}>Cancel</button>
          </>
        ) : null}

        {/* ---- view: record (the desktop inspector) ---- */}
        {view === "record" && sheetWorker ? (
          <>
            <div className={`${styles.sheetBody} ${styles.recBody}`}>
              {/* Status leads the record now that the row opens straight here:
                  the row's badge scrolls out of sight behind the sheet, and
                  "are they actually on the crew" governs every field under it. */}
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Status</div>
                <div className={styles.fldRowV}>
                  <span className={`${styles.badge} ${styles[(INVITE[sheetWorker.invite] ?? INVITE.PENDING).cls]}`}>
                    {(INVITE[sheetWorker.invite] ?? INVITE.PENDING).label}
                  </span>
                </div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Email</div>
                <div className={`${styles.fldRowV} ${sheetWorker.email ? "" : styles.isNone}`}>
                  {sheetWorker.email ?? "no email"}
                </div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Phone</div>
                <div className={`${styles.fldRowV} ${sheetWorker.phone ? styles.isMono : styles.isNone}`}>
                  {sheetWorker.phone ?? "no phone"}
                </div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Role</div>
                <div className={styles.fldRowV}>{roleLabel(sheetWorker.role)}</div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Specialties</div>
                <div className={`${styles.fldRowV} ${sheetWorker.specialties.length ? "" : styles.isNone}`}>
                  {sheetWorker.specialties.length ? sheetWorker.specialties.join(" · ") : "none set"}
                </div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Hourly rate</div>
                <div className={`${styles.fldRowV} ${sheetWorker.rate ? styles.isMono : styles.isNone}`}>
                  {sheetWorker.rate ? `$${sheetWorker.rate}/hr` : "not set"}
                </div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Joined</div>
                <div className={`${styles.fldRowV} ${styles.isMono}`}>{sheetWorker.joined}</div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Last active</div>
                <div className={`${styles.fldRowV} ${sheetWorker.lastActive && sheetWorker.lastActive !== "Never" ? styles.isMono : styles.isNone}`}>
                  {sheetWorker.lastActive && sheetWorker.lastActive !== "Never" ? sheetWorker.lastActive.replace(/^Active /, "") : "never"}
                </div>
              </div>
              <div className={styles.fldRow}>
                <div className={styles.fldLbl}>Active jobs ({sheetWorker.jobs.length})</div>
                {sheetWorker.jobs.length ? (
                  <div className={styles.jobList}>
                    {sheetWorker.jobs.map((j) => (
                      <div className={styles.jobRow} key={j.id}>
                        <span className={styles.jobTitle}>{j.title}</span>
                        <Icon id="i-arrow" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`${styles.fldRowV} ${styles.isNone}`}>no live work</div>
                )}
              </div>

              {/* The token portal link — the one artefact this page exists to
                  hand over. Copy writes to the clipboard for real. */}
              <div className={styles.linkBox}>
                <div className={styles.fldLbl}>Worker dashboard link</div>
                <div className={styles.linkRow}>
                  <span className={styles.linkUrl}>{sheetPath}</span>
                  <button className={`${styles.linkBtn} ${copied ? styles.done : ""}`} type="button"
                    aria-label="Copy portal link" onClick={copyPortal}>
                    <Icon id={copied ? "i-check" : "i-copy"} />
                  </button>
                </div>
              </div>
            </div>
            {/* Same beige foot class as the form and the confirm view — one
                action bar, never a parallel style set per view. */}
            <div className={styles.formFoot}>
              <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
                onClick={() => openForm(sheetWorker)}>
                <Icon id="i-workers-pen" />Edit worker
              </button>
              <button className={`${styles.btn} ${styles.btnDanger}`} type="button"
                onClick={() => setView("confirm")}>
                <Icon id="i-trash" />Remove
              </button>
            </div>
          </>
        ) : null}

        {/* ---- view: confirm (the desktop remove dialog) ---- */}
        {view === "confirm" && sheetWorker ? (
          <>
            <div className={`${styles.sheetBody} ${styles.cfmBody}`}>
              <div className={styles.cfmTxt}>
                They lose access to their portal immediately. Job history stays on the jobs.
              </div>
              {sheetWorker.jobs.length ? (
                <div className={styles.cfmWarn}>
                  <Icon id="i-jobs" />
                  {sheetWorker.jobs.length} live assignment{sheetWorker.jobs.length === 1 ? "" : "s"} will
                  need a new owner.
                </div>
              ) : null}
              {removeErr ? <div className={styles.sheetErr} role="alert">{removeErr}</div> : null}
            </div>
            <div className={styles.formFoot}>
              <button className={`${styles.btn} ${styles.btnGhost}`} type="button" disabled={removing}
                onClick={() => setView("actions")}>
                Cancel
              </button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" disabled={removing}
                onClick={() => void confirmRemove()}>
                <Icon id="i-trash" />{removing ? "Removing…" : "Remove worker"}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* ============ INVITE / EDIT SHEET ============ */}
      <div className={`${styles.sheet} ${styles.sheetForm} ${formOpen ? styles.on : ""}`} role="dialog"
        aria-modal="true" aria-labelledby="mwFormTitle" aria-hidden={!formOpen}
        {...formDrag.sheetProps}>
        <div className={styles.sheetGrab} {...formDrag.handleProps} />
        <div className={styles.sheetHead} {...formDrag.handleProps}>
          <div className={styles.sheetHeadTxt}>
            <div className={styles.sheetKicker}>{editId ? "Crew / edit record" : "Crew / new invite"}</div>
            <div className={styles.sheetTitle} id="mwFormTitle">
              {editId ? editWorker?.name ?? "Edit worker" : "Invite worker"}
            </div>
          </div>
        </div>
        <form className={`${styles.sheetBody} ${styles.formBody}`} id="mwForm" noValidate onSubmit={submitForm}>
          <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mwName">
              Full name<span className={styles.req}>*</span>
            </label>
            <input ref={nameRef} className={styles.pinput} id="mwName" name="name" type="text"
              placeholder="Casey Stone" autoComplete="off" value={form.name}
              aria-invalid={nameErr} aria-describedby={nameErr ? "mwNameErr" : undefined}
              onChange={(ev) => {
                setForm((f) => ({ ...f, name: ev.target.value }));
                if (ev.target.value.trim()) setNameErr(false);
              }} />
            {nameErr ? <span className={styles.fldErr} id="mwNameErr">Enter the worker&apos;s full name</span> : null}
          </div>

          <div className={`${styles.fld} ${emailErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mwEmail">
              Email{editId ? " (locked)" : <span className={styles.req}>*</span>}
            </label>
            <input ref={emailRef} className={styles.pinput} id="mwEmail" name="email" type="email"
              placeholder="casey@example.com" autoComplete="off" inputMode="email" value={form.email}
              disabled={Boolean(editId)}
              aria-invalid={emailErr} aria-describedby={emailErr ? "mwEmailErr" : undefined}
              onChange={(ev) => {
                setForm((f) => ({ ...f, email: ev.target.value }));
                if (ev.target.value.trim()) setEmailErr(false);
              }} />
            {emailErr ? (
              <span className={styles.fldErr} id="mwEmailErr">
                A valid email is required — that is where the invite link goes
              </span>
            ) : null}
            {editId ? (
              <span className={styles.fldHint}>
                Email is the worker&apos;s login identity, so it cannot change here.
              </span>
            ) : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mwPhone">Phone</label>
            <input className={styles.pinput} id="mwPhone" name="phone" type="tel"
              placeholder="(425) 555-0199" autoComplete="off" inputMode="tel" value={form.phone}
              onChange={(ev) => setForm((f) => ({ ...f, phone: ev.target.value }))} />
          </div>

          <div className={`${styles.fld} ${rateErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mwRate">Hourly rate</label>
            <input className={styles.pinput} id="mwRate" name="rate" type="number" min="0"
              placeholder="38" autoComplete="off" inputMode="decimal" value={form.rate}
              aria-invalid={rateErr} aria-describedby={rateErr ? "mwRateErr" : undefined}
              onChange={(ev) => {
                setForm((f) => ({ ...f, rate: ev.target.value }));
                if (rateErr) setRateErr(false);
              }} />
            {rateErr ? <span className={styles.fldErr} id="mwRateErr">Hourly rate must be a number</span> : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mwSpec">Specialties</label>
            <input className={styles.pinput} id="mwSpec" name="spec" type="text"
              placeholder="Roofing, Fencing" autoComplete="off" value={form.spec}
              onChange={(ev) => setForm((f) => ({ ...f, spec: ev.target.value }))} />
            <span className={styles.fldHint}>Comma-separated — they show on the worker&apos;s record.</span>
          </div>

          <div className={styles.fld}>
            <span className={styles.fldLbl}>Role</span>
            <div className={styles.roleGrid}>
              {WORKER_ROLES.map((r) => (
                <button key={r.value} className={`${styles.roleBtn} ${role === r.value ? styles.on : ""}`}
                  type="button" aria-pressed={role === r.value} onClick={() => setRole(r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
            {/* What the chosen role gets — the contractor sees what they are
                handing out before they send (owner, 2026-09-14). One list of
                facts, lib/roleAccess, shared with the desktop sheet. */}
            {(() => {
              const a = roleAccess(role);
              return (
                <div className={styles.roleWhat} aria-live="polite">
                  <div className={styles.roleWhatH}>
                    <span className={styles.roleWhatRole}>{a.title}</span>
                    <span className={styles.roleWhatWho}>{a.who}</span>
                  </div>
                  <ul className={styles.roleWhatL}>
                    {a.gets.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                  <div className={styles.roleWhatNo}>{`Not included: ${a.not}`}</div>
                </div>
              );
            })()}
          </div>

          <div className={styles.formNote}>
            {editId ? "Changes save straight to the roster." : roleAccess(role).invite}
          </div>
          {/* The action's own refusal, on the sheet that caused it. */}
          {formErr ? <div className={styles.sheetErr} role="alert">{formErr}</div> : null}
        </form>
        {/* The submit pair sits in a beige foot OUTSIDE the scrolling body and
            reaches the form through form=, so it is always in the thumb zone. */}
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button" disabled={saving}
            onClick={() => setFormOpen(false)}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" form="mwForm" disabled={saving}>
            <Icon id="i-check" />
            {saving ? (editId ? "Saving…" : "Sending…") : editId ? "Save changes" : "Send invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
