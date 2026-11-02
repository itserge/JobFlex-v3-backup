"use client";

// MOBILE REVIEWS (mobile-reviews-v2) — Blueprint system, handheld build.
//
// Archetype B (FEED): the page's subject is a chronological run of client
// submissions, newest first, grouped under drawn date rules. Tokens, palette,
// type scale and Motion System "Balanced" are the reference dashboard's; the
// shell (topbar / hamburger drawer / sprite) is the shared <MobileNav />, so
// this surface is the same product as its twelve siblings.
//
// Every component of the desktop reviews sheet is covered:
//  · page head (Reputation / Reviews) + the two head actions
//  · the 3-stat grid, folded into ONE masthead: average rating as the numeral,
//    total reviews and response rate as the two annotations — all computed
//  · the All / 5 / 4 / 3 / 2 / 1 chip rail, as one Filter dropdown
//  · the review list, re-cut as feed entry cards under date dividers
//  · the score spread (5 → 1 bars, animated on mount)
//  · "Awaiting response" with its live count, status badges and Send / Resend
//    nudge (SENT + "just now" after 1200ms, exactly the donor's timing)
//  · the review empty state, plus a second one for a filter that excludes
//    everything, plus the awaiting list's own
//
// What changes versus the desktop sheet, and why:
//  · NO STARS. House rule, and there is no star in the shared sprite. A score
//    renders as a NUMERAL beside a drawn five-cell meter — a gauge on a
//    technical drawing. Five small glyphs do not read at arm's length in
//    jobsite glare; a 20px numeral and a filled bar do.
//  · The desktop's right-hand rail (spread + awaiting) becomes two sections
//    stacked under the feed. A 320px viewport has no rail.
//  · The chip rail becomes one dropdown: six chips do not survive 320px.
//  · The "⋮" popover becomes a bottom sheet (no hover on touch, and CLAUDE.md
//    prefers sheets over modals). It doubles as the DETAIL sheet: the entry
//    card clamps its comment to two lines, the sheet carries the full text.
//  · A "Request review" form sheet is added for the head's primary action. The
//    desktop dialog is the same thing in a modal: pick one of the jobs that has
//    no request yet, and the server sends the client their link.
//  · No search box and no pager: a score is the only dimension worth a control
//    on this feed, and it has one.
//
// DATA: REAL, and the same book the desktop sheet shows. The page's server
// loader (app/dashboard/reviews/load-reviews) reads the org's ReviewRequest
// rows — with each open row's public token — plus the jobs that have no
// request yet, and hands them down as props through the page's viewport switch
// (app/dashboard/reviews/reviews-responsive) or the /mobile-reviews-v2 preview
// page. "Send request" calls the SAME createReviewRequest action the desktop
// dialog calls, which is what emails the client their link; the row only
// appears once that action resolves.
//
// What is NOT here, and why: there is no resend, cancel or delete action in
// src/actions, and no public "feature this review" surface — the fixture build
// offered all four and only mutated local state, so a nudge that never sent an
// email read as a send. The row sheet now carries what has a destination: the
// client's link, the comment, and the job.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-reviews.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { createReviewRequest, setReviewHidden } from "@/actions/reviewRequests";
import type { ReviewsProps } from "@/app/dashboard/reviews/load-reviews";
import {
  ALL,
  FILTER_KEYS,
  SCORE_KEYS,
  actionError,
  filterLabel,
  groupByAge,
  initials,
  isCompleted,
  isOpenRequest,
  matchesScore,
  reviewLink,
  scoreCount,
  scoreTone,
  type ReviewRequest,
  type Tone,
} from "./reviews-data";

/** Fed by app/dashboard/reviews/load-reviews. One loader, two editions. */
export type MobileReviewsProps = ReviewsProps;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scores read as one decimal everywhere, so "5" never gets mistaken for a
 *  count and the digit columns line up under each other. */
const score1 = (n: number) => n.toFixed(1);

const TONE_CLASS: Record<Tone, string> = {
  hi: styles.toneHi,
  mid: styles.toneMid,
  low: styles.toneLow,
};

/** Drawn fills run on scaleX(--fill), never on an animated width: forty-five
 *  of them arm at once on mount and a transform costs no layout. */
const fillVar = (ratio: number) => ({ "--fill": ratio }) as CSSProperties;

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/**
 * THE RATING METER — five 2px ink-framed cells filled to the score, like a
 * gauge on a technical drawing. The last cell takes the fraction, so 4.13 reads
 * as four filled cells and a sliver, which is what a gauge does and what five
 * glyphs cannot. Decorative for assistive tech: the numeral beside it is the
 * value, and the wrapper carries the label.
 */
function Meter({ score, armed, large }: { score: number; armed: boolean; large?: boolean }) {
  return (
    <span className={`${styles.meter} ${large ? styles.meterLg : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span className={styles.meterCell} key={i}>
          <span
            className={styles.meterFill}
            style={fillVar(armed ? Math.max(0, Math.min(1, score - i)) : 0)}
          />
        </span>
      ))}
    </span>
  );
}

/** 750ms easeOutCubic. tabular-nums keep the digit columns from jumping. The
 *  precision is a number, not a formatter callback: a function prop would be a
 *  new identity every render and would restart the count on every keystroke
 *  elsewhere on the page. */
function CountUp({ value, digits, className }: { value: number; digits: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = value.toFixed(digits);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = (value * (1 - Math.pow(1 - pr, 3))).toFixed(digits);
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, digits]);
  return (
    <div ref={ref} className={className}>
      {value.toFixed(digits)}
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

export function MobileReviews({ entries, jobs, publicHref, publicRating }: MobileReviewsProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /* The server's book and its eligible-job list, patched in place after a send
     RESOLVES. Re-seeded when the server hands down new ones (a
     router.refresh() after a send, or a fresh navigation): the compare runs
     DURING render, React's own "adjusting state when a prop changes" pattern,
     so the stale list is never painted for a frame the way an effect would
     paint it. */
  const [data, setData] = useState<ReviewRequest[]>(entries);
  /** Jobs with no request yet — the send sheet's options, minus the ones sent
   *  in this session so a second send cannot look like a new one. */
  const [openJobs, setOpenJobs] = useState(jobs);
  const [seed, setSeed] = useState({ entries, jobs });
  if (seed.entries !== entries || seed.jobs !== jobs) {
    setSeed({ entries, jobs });
    setData(entries);
    setOpenJobs(jobs);
  }
  const [filter, setFilter] = useState<string>(ALL);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle");
  /* The drawn instruments (masthead meter + spread bars) fill in from zero on
     mount — the house "a line gets drawn" character. Flipped one frame after
     mount so the transition has a start value to run from. */
  const [armed, setArmed] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);

  /* ---- request-review form ----
     One field, because the action takes one: which job. The client and the
     address are the job's own, and the server emails them their link. */
  const [jobId, setJobId] = useState("");
  const [jobErr, setJobErr] = useState(false);
  const [sending, setSending] = useState(false);
  const [askErr, setAskErr] = useState("");
  const jobRef = useRef<HTMLSelectElement>(null);

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

  useEffect(() => {
    const raf = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(raf);
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
      styles.btn, styles.ddBtn, styles.ddItem, styles.rmenuItem, styles.sheetCancel,
      styles.frowOpen, styles.prowOpen, styles.pbtn, styles.emptyA, styles.fchk,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes what the PAGE owns ----------------------------
     The drawer is not listed: MobileNav handles its own Escape, and it only
     binds while open, so the two listeners cannot both claim one key press. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (askOpen) setAskOpen(false);
      else if (sheetId) setSheetId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, askOpen, sheetId]);

  /* ---------- Filter dropdown: close on outside tap -------------------- */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen]);

  /* ---------- The one blue flash on a record you just changed ---------- */
  useEffect(() => {
    if (!landedId) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => clearTimeout(t);
  }, [landedId]);

  useEffect(() => {
    if (copy === "idle") return;
    const t = window.setTimeout(() => setCopy("idle"), 1600);
    return () => clearTimeout(t);
  }, [copy]);

  /* ---------- derived -------------------------------------------------- */
  const completed = useMemo(() => data.filter(isCompleted), [data]);
  const waiting = useMemo(() => data.filter(isOpenRequest), [data]);

  const avg = useMemo(
    () => (completed.length ? completed.reduce((a, r) => a + r.rating, 0) / completed.length : 0),
    [completed],
  );
  const rate = useMemo(
    () => (data.length ? Math.round((completed.length / data.length) * 100) : 0),
    [completed.length, data.length],
  );
  /* An empty book has no tone: a red 0.00 would read as a terrible rating
     rather than as "nothing has come back yet". */
  const avgTone = completed.length ? TONE_CLASS[scoreTone(avg)] : styles.toneNone;

  const rows = useMemo(() => completed.filter((r) => matchesScore(r, filter)), [completed, filter]);
  const groups = useMemo(() => groupByAge(rows), [rows]);
  /* One running position across every group, so the row cascade reads as one
     list rather than restarting under each date rule. Precomputed rather than
     counted during render — a counter mutated inside the JSX drifts on a
     re-render that does not start from the top. */
  const rowOrder = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  const spread = useMemo(() => {
    const cells = SCORE_KEYS.map((k) => ({
      k,
      n: completed.filter((r) => r.rating === Number(k)).length,
      tone: TONE_CLASS[scoreTone(Number(k))],
    }));
    const max = Math.max(1, ...cells.map((c) => c.n));
    return cells.map((c) => ({ ...c, ratio: c.n / max }));
  }, [completed]);

  const sheetRec = sheetId === null ? null : (data.find((r) => r.id === sheetId) ?? null);
  const sheetDone = sheetRec !== null && isCompleted(sheetRec);

  const resetFilter = () => setFilter(ALL);

  /* ---------- clipboard -------------------------------------------------
     The result is reported honestly: a blocked clipboard says so rather than
     pretending. */
  const copyText = useCallback((text: string) => {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip?.writeText) {
      setCopy("fail");
      return;
    }
    clip.writeText(text).then(
      () => setCopy("ok"),
      () => setCopy("fail"),
    );
  }, []);

  /* ---------- row / entry sheet ---------------------------------------
     One sheet, two row sets. A completed submission and an open request are
     different records with different verbs, but they are the same object in
     the same list, so they share the sheet rather than forking the markup.
     Every row here has a real destination or a real clipboard write; the
     fixture build's resend / cancel / delete / feature rows are gone because
     no action behind them exists. */
  const menuRows = useMemo<MenuRow[]>(() => {
    const r = sheetRec;
    if (!r) return [];
    if (isCompleted(r)) {
      return [
        // Hidden = off the public page and the proposal badge; still counted
        // here and in lead routing. Presentation, not deletion.
        { act: "hide", icon: r.hidden ? "i-check" : "i-x", tone: styles.rmiWarn,
          title: r.hidden ? "Show on public page" : "Hide from public page",
          sub: r.hidden
            ? "Off the public page and the proposal badge right now"
            : "Stays counted here and in lead routing" },
        { act: "public", icon: "i-out", tone: styles.rmiSky, title: "Open public page",
          sub: publicHref ? "What clients see from the proposal badge" : "No public page",
          disabled: !publicHref },
        { act: "copy-comment", icon: "i-copy", title: "Copy the comment",
          sub: r.comment ? "Paste it into a listing or post" : "No comment left with this score",
          disabled: !r.comment },
        { act: "job", icon: "i-jobs", tone: styles.rmiWarn, title: "Open the job",
          sub: r.jobId ? r.job : "This review is not linked to a job",
          disabled: !r.jobId },
      ];
    }
    return [
      { act: "copy-link", icon: "i-copy", tone: styles.rmiSky, title: "Copy review link",
        sub: r.token ? `Text or email it to ${r.client}` : "No link on this request",
        disabled: !r.token },
      { act: "job", icon: "i-jobs", tone: styles.rmiWarn, title: "Open the job",
        sub: r.jobId ? r.job : "This request is not linked to a job",
        disabled: !r.jobId },
    ];
  }, [sheetRec, publicHref]);

  const runMenu = (act: string) => {
    const r = sheetRec;
    setSheetId(null);
    if (!r) return;
    if (act === "hide") {
      const next = !r.hidden;
      setReviewHidden(r.id, next).then(
        () => setData((prev) => prev.map((x) => (x.id === r.id ? { ...x, hidden: next } : x))),
        (err) => window.alert(actionError(err)),
      );
    } else if (act === "public" && publicHref) {
      window.open(publicHref, "_blank", "noopener,noreferrer");
    } else if (act === "copy-comment" && r.comment) {
      copyText(r.comment);
    } else if (act === "copy-link") {
      const url = reviewLink(r);
      if (url) copyText(url);
      else setCopy("fail");
    } else if (act === "job" && r.jobId) {
      router.push(`/dashboard/jobs/${r.jobId}`);
    }
  };

  /* ---------- request-review form --------------------------------------
     The real send: createReviewRequest(jobId) creates the request, counts it
     against the plan's review-request limit and emails the client their link.
     The row is added only once it resolves, carrying the id the server gave. */
  const openAsk = () => {
    setJobId(openJobs[0]?.id ?? "");
    setJobErr(false);
    setAskErr("");
    setAskOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    window.setTimeout(() => jobRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  const submitAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const job = openJobs.find((j) => j.id === jobId);
    if (!job) {
      setJobErr(true);
      jobRef.current?.focus();
      return;
    }
    setSending(true);
    setAskErr("");
    try {
      const res = await createReviewRequest(job.id);
      setData((prev) => [
        {
          id: res.id,
          jobId: job.id,
          proposalId: null,
          status: "SENT",
          rating: null,
          client: job.client,
          job: job.title,
          when: "just now",
          comment: null,
          photos: [],
          hidden: false,
          token: res.publicToken,
        },
        ...prev,
      ]);
      // The job has a request now, so it leaves the option list.
      setOpenJobs((prev) => prev.filter((j) => j.id !== job.id));
      setAskOpen(false);
      setLandedId(res.id);
      router.refresh();
    } catch (err) {
      setAskErr(actionError(err));
    } finally {
      setSending(false);
    }
  };

  const anyOverlay = Boolean(sheetRec) || askOpen;

  // Swipe-down dismissal, one gesture per sheet, on the same setters the
  // Escape ladder uses.
  const entryDrag = useSheetDrag(Boolean(sheetRec), () => setSheetId(null));
  const askDrag = useSheetDrag(askOpen, () => setAskOpen(false));

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
            <div className={styles.kicker}>Reputation</div>
            <h1 className={styles.pageTitle}>Reviews</h1>
            <div className={styles.pageActions}>
              {/* The head's ghost "Copy link" is gone: there is no org-wide
                  review URL to copy. A link belongs to ONE request and is
                  copied from that row's sheet, which is where its token is. */}
              <button
                data-tour="reviews:request"
                className={`${styles.btn} ${styles.btnPrimary}`}
                type="button"
                onClick={openAsk}
                disabled={openJobs.length === 0}
              >
                <Icon id="i-send" />Request review
              </button>
            </div>
            {/* Where a row-sheet copy reports back, since the sheet that
                started it has already closed. */}
            {copy !== "idle" ? (
              <div className={styles.actErr} role="status" data-ok={copy === "ok" ? "" : undefined}>
                {copy === "ok" ? "Copied to the clipboard." : "Couldn't reach the clipboard."}
              </div>
            ) : null}
          </div>

          {/* MASTHEAD — the desktop's 3-stat grid, folded into one numeral, a
              mono kicker and EXACTLY two annotations. All three computed, so
              deleting a review moves them. The numeral takes the score's status
              tone and sits beside the drawn meter. */}
          <div className={styles.rmast}>
            <div className={styles.rmastTop}>
              <div className={styles.rmastLbl}>
                Average rating
                <span className={styles.rmastRule} />
              </div>
              <div className={`${styles.rmastRow} ${avgTone}`}>
                {/* No reviews reads as an em dash, never "0.00" — zero is a
                    number, an unrated book is an absence. The desktop stat did
                    the same. */}
                {completed.length ? (
                  <CountUp value={avg} digits={2} className={styles.rmastVal} />
                ) : (
                  <div className={styles.rmastVal}>—</div>
                )}
                <Meter score={avg} armed={armed} large />
              </div>
            </div>
            <div className={styles.rmastCnt}>
              <div className={styles.rmastSub}>
                <div className={styles.rmastSubL}>Reviews</div>
                <div className={styles.rmastSubV}>{completed.length}</div>
              </div>
              <div className={styles.rmastSub}>
                <div className={styles.rmastSubL}>Response</div>
                <div className={styles.rmastSubV}>{rate}%</div>
              </div>
            </div>
            {/* The public page — what a client sees from the proposal badge.
                Its figure can differ from the numeral above: hidden reviews
                count here, never there. */}
            {publicHref ? (
              <a className={styles.rmastLink} href={publicHref} target="_blank" rel="noopener noreferrer">
                <Icon id="i-out" />
                <span>Public page</span>
                <b>
                  {publicRating?.count
                    ? `${publicRating.avg} · ${publicRating.count} public`
                    : "nothing public yet"}
                </b>
              </a>
            ) : null}
          </div>

          {/* SCORE SPREAD — the desktop's side card, unchanged in meaning:
              five bars, share of the book, drawn on 1.5px ink tracks. */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitle}>Score spread</div>
              <div className={styles.cardNote}>{completed.length} rated</div>
            </div>
            <div className={styles.spread}>
              {spread.map((s) => (
                <div className={styles.spRow} key={s.k}>
                  <span className={styles.spK}>{s.k}</span>
                  <span className={styles.spTrack}>
                    <span
                      className={`${styles.spFill} ${s.tone}`}
                      style={fillVar(armed ? s.ratio : 0)}
                    />
                  </span>
                  <span className={styles.spN}>{s.n}</span>
                </div>
              ))}
            </div>
          </div>

          {/* FILTER — one dropdown, never a chip rail: six chips do not survive
              320px. The chosen score reads back on the face as plain text. */}
          <div className={`${styles.dd} ${filterOpen ? styles.open : ""}`} ref={filterRef}>
            <button className={styles.ddBtn} type="button" aria-haspopup="listbox"
              aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>
              <Icon id="i-filter" />
              Filter
              <span className={`${styles.ddValue} ${filter === ALL ? styles.isAll : ""}`}>
                {filterLabel(filter)} · {scoreCount(completed, filter)}
              </span>
              <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
            </button>
            <div className={styles.ddMenu} role="listbox">
              {FILTER_KEYS.map((k) => (
                <button key={k} className={`${styles.ddItem} ${filter === k ? styles.active : ""}`}
                  type="button" role="option" aria-selected={filter === k}
                  onClick={() => { setFilter(k); setFilterOpen(false); }}>
                  {filterLabel(k)}
                  <span className={styles.ddCount}>{scoreCount(completed, k)}</span>
                  {filter === k ? <Icon id="i-check" /> : null}
                </button>
              ))}
            </div>
          </div>

          {/* THE FEED — entry cards under drawn date rules, newest first. */}
          {rows.length === 0 ? (
            <div className={styles.empty}>
              {completed.length === 0 ? (
                <>
                  <div className={styles.emptyT}>No reviews yet</div>
                  <div className={styles.emptyS}>
                    Send a request when a job wraps and the client gets a review link. Their
                    submission appears here.
                  </div>
                  {openJobs.length ? (
                    <button className={styles.emptyA} type="button" onClick={openAsk}>
                      <Icon id="i-send" />Request review
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <div className={styles.emptyT}>No matches</div>
                  <div className={styles.emptyS}>
                    Nothing has come back at a score of {filter} yet. Clear the filter to see
                    all {completed.length} reviews.
                  </div>
                  <button className={styles.emptyA} type="button" onClick={resetFilter}>
                    <Icon id="i-x" />Clear filter
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.feed}>
              {groups.map((g) => (
                <section className={styles.fgroup} key={g.key}>
                  {/* A 1.5px ink rule with the date label sitting on it — the
                      section marker off a technical drawing. */}
                  <div className={styles.fdate}>
                    <span className={styles.fdateT}>{g.label}</span>
                    <span className={styles.fdateN}>{g.rows.length}</span>
                  </div>
                  <div className={styles.fcard}>
                    {g.rows.map((r) => {
                      return (
                        <article
                          key={r.id}
                          className={`${styles.frow} ${styles.rowIn} ${landedId === r.id ? styles.landed : ""}`}
                          style={{ animationDelay: `${(rowOrder.get(r.id) ?? 0) * 45}ms` }}
                        >
                          <span className={styles.fav}>{initials(r.client)}</span>
                          <div className={styles.fname}>{r.client}</div>
                          <button className={styles.frowOpen} type="button"
                            aria-label={`Actions for ${r.client}'s review`}
                            onClick={() => setSheetId(r.id)}>
                            <Icon id="i-dots" />
                          </button>
                          <div className={styles.fjob}>{r.job}</div>
                          <div className={styles.ffoot}>
                            <span className={`${styles.frate} ${TONE_CLASS[scoreTone(r.rating)]}`}
                              aria-label={`Rated ${score1(r.rating)} out of 5`}>
                              <span className={styles.frateVal}>{score1(r.rating)}</span>
                              <Meter score={r.rating} armed={armed} />
                            </span>
                            <span className={styles.fwhen}>{r.when}</span>
                            {r.hidden ? <span className={styles.fhidden}>Hidden</span> : null}
                          </div>
                          {/* Two lines and an ellipsis. The full text is in the
                              sheet — a feed entry is a summary, not a document. */}
                          {r.comment ? <p className={styles.fquote}>{r.comment}</p> : null}
                          {r.photos.length ? (
                            <div className={styles.fphotos} aria-label={`${r.photos.length} photos`}>
                              {r.photos.slice(0, 3).map((u) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={u} src={u} alt="" loading="lazy" />
                              ))}
                              {r.photos.length > 3 ? <span>+{r.photos.length - 3}</span> : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* AWAITING RESPONSE — the desktop's second side card. Same three
              lines as a row card: identity + actions, mono meta, then the
              status badge with the nudge closing at the far right. */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitle}>Awaiting response</div>
              <div className={`${styles.cardCount} ${waiting.length ? "" : styles.isZero}`}>
                {waiting.length}
              </div>
            </div>
            {waiting.length === 0 ? (
              <div className={`${styles.empty} ${styles.emptyIn}`}>
                <div className={styles.emptyT}>All answered</div>
                <div className={styles.emptyS}>
                  Every request has come back. Send another when the next job closes.
                </div>
                {openJobs.length ? (
                  <button className={styles.emptyA} type="button" onClick={openAsk}>
                    <Icon id="i-send" />Request review
                  </button>
                ) : null}
              </div>
            ) : (
              <div className={styles.plist}>
                {waiting.map((r, i) => (
                  <div
                    key={r.id}
                    className={`${styles.prow} ${styles.rowIn} ${landedId === r.id ? styles.landed : ""}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <div className={styles.pname}>{r.client}</div>
                    <button className={styles.prowOpen} type="button"
                      aria-label={`Actions for ${r.client}'s request`}
                      onClick={() => setSheetId(r.id)}>
                      <Icon id="i-dots" />
                    </button>
                    <div className={styles.pmeta}>{r.job} · {r.when}</div>
                    <div className={styles.pfoot}>
                      <span className={`${styles.pbadge} ${r.status === "SENT" ? styles.stSent : styles.stPending}`}>
                        {r.status === "SENT" ? "Sent" : "Pending"}
                      </span>
                      {/* The fixture build offered Send / Resend here and only
                          flipped a local badge — there is no resend action, so
                          the useful control is the client's own link. */}
                      <button
                        className={styles.pbtn}
                        type="button"
                        disabled={!r.token}
                        onClick={() => {
                          const url = reviewLink(r);
                          if (url) copyText(url);
                          else setCopy("fail");
                        }}
                      >
                        <Icon id="i-copy" />Copy link
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => { setSheetId(null); setAskOpen(false); }}
        aria-hidden="true"
      />

      {/* ============ ENTRY / REQUEST SHEET ============ */}
      <div className={`${styles.sheet} ${sheetRec ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Review actions" aria-hidden={!sheetRec} {...entryDrag.sheetProps}>
        <div className={styles.sheetGrab} {...entryDrag.handleProps} />
        <div className={styles.sheetHead} {...entryDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetRec
              ? sheetDone
                ? `Reviewed · ${sheetRec.when}`
                : `${sheetRec.status === "SENT" ? "Sent" : "Pending"} · ${sheetRec.when}`
              : "Review · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetRec?.client ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {sheetRec ? (
            <div className={styles.rdetail}>
              <div className={styles.rdetailTop}>
                {sheetDone && sheetRec.rating !== null ? (
                  <span className={`${styles.frate} ${TONE_CLASS[scoreTone(sheetRec.rating)]}`}
                    aria-label={`Rated ${score1(sheetRec.rating)} out of 5`}>
                    <span className={styles.frateVal}>{score1(sheetRec.rating)}</span>
                    <Meter score={sheetRec.rating} armed={armed} />
                  </span>
                ) : (
                  <span className={`${styles.pbadge} ${sheetRec.status === "SENT" ? styles.stSent : styles.stPending}`}>
                    {sheetRec.status === "SENT" ? "Sent" : "Pending"}
                  </span>
                )}
              </div>
              <div className={styles.rdetailJob}>{sheetRec.job}</div>
              {/* The full comment lives here, not on the card. */}
              {sheetRec.comment ? (
                <p className={styles.rquoteFull}>{sheetRec.comment}</p>
              ) : (
                <p className={styles.rnote}>
                  {sheetDone
                    ? "Scored, but no comment was left."
                    : "No submission yet — the link is still open."}
                </p>
              )}
              {sheetRec.photos.length ? (
                <div className={styles.rdetailPhotos}>
                  {sheetRec.photos.map((u, i) => (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer"
                      aria-label={`Photo ${i + 1} of ${sheetRec.photos.length}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : null}
              {sheetDone && sheetRec.hidden ? (
                <p className={styles.rnote}>Hidden from the public page and the proposal badge.</p>
              ) : null}
            </div>
          ) : null}
          {menuRows.map((r) => (
            <button key={r.act} type="button" disabled={r.disabled}
              className={`${styles.rmenuItem} ${r.danger ? styles.rmenuItemDanger : ""}`}
              onClick={() => runMenu(r.act)}>
              <span className={`${styles.rmiIc} ${r.tone ?? ""}`}><Icon id={r.icon} /></span>
              <span>
                <span className={styles.rmenuItemT}>{r.title}</span>
                <span className={styles.rmenuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetId(null)}>Cancel</button>
      </div>

      {/* ============ REQUEST REVIEW SHEET ============ */}
      <div className={`${styles.sheet} ${askOpen ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="mrAskTitle" aria-hidden={!askOpen} {...askDrag.sheetProps}>
        <div className={styles.sheetGrab} {...askDrag.handleProps} />
        <div className={styles.sheetHead} {...askDrag.handleProps}>
          <div className={styles.sheetKicker}>Reputation / new request</div>
          <div className={styles.sheetTitle} id="mrAskTitle">Request review</div>
        </div>
        <form className={`${styles.sheetBody} ${styles.formBody}`} id="mrAskForm" noValidate onSubmit={submitAsk}>
          {/* One field, because the action takes one. The client, their email
              and the job title all come off the job the server already has —
              typing them again here would be three chances to disagree with
              the record. Jobs that already have a request are not offered:
              createReviewRequest is idempotent per job, so sending again would
              look like a send and do nothing. */}
          <div className={`${styles.fld} ${jobErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mrJob">
              Job<span className={styles.req}>*</span>
            </label>
            <select
              ref={jobRef}
              className={styles.pinput}
              id="mrJob"
              name="job"
              value={jobId}
              aria-invalid={jobErr}
              aria-describedby={jobErr ? "mrJobErr" : undefined}
              onChange={(e) => {
                setJobId(e.target.value);
                if (e.target.value) setJobErr(false);
              }}
            >
              <option value="">Choose a job…</option>
              {openJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} — {j.client}
                </option>
              ))}
            </select>
            {jobErr ? <span className={styles.fldErr} id="mrJobErr">Choose the job to ask about</span> : null}
            <span className={styles.fldHint}>
              {openJobs.length
                ? "The client gets an email with their review link."
                : "Every job already has a request out."}
            </span>
          </div>

          {askErr ? <div className={styles.actErr} role="alert">{askErr}</div> : null}
        </form>
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => setAskOpen(false)}>
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            type="submit"
            form="mrAskForm"
            disabled={sending || openJobs.length === 0}
          >
            <Icon id="i-send" />{sending ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
