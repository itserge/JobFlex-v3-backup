"use client";

// MOBILE PHONE (mobile-phone-v2) — Blueprint system, handheld build.
//
// The desktop /dashboard/phone sheet, re-cut for a phone. Tokens, palette,
// type scale and Motion System "Balanced" are the reference dashboard's; the
// shell (topbar / hamburger drawer / bottom sheets) is the shared MobileNav, so
// this surface is one product with its twelve siblings.
//
// Every region of the desktop sheet is covered:
//  · page head (kicker "Automation · Voice" + title)
//  · the Twilio configuration banner, with the webhook URL and its Copy control
//  · the three stat cards, folded into ONE masthead numeral + two annotations
//  · the four filter chips, as one dropdown (plus Missed, which the desktop
//    leaves you to spot by eye)
//  · the 6-column call table, re-cut as FEED entry cards under date dividers
//  · every call state the fixture holds: inbound, outbound, missed, live,
//    lead / no lead, recorded / not, transcript / none
//  · the transcript panel: badges, recording player, summary, transcript,
//    and the Create-lead / Call-back action pair
//  · both empty states
//
// What changes versus the desktop sheet, and why:
//  · ARCHETYPE. A call log is a feed, not a ledger: entries are chronological
//    and grouped by day, and each card carries a 2-line excerpt of the summary
//    with the full text in the detail sheet.
//  · DIRECTION IS THE STATUS. The desktop shows direction and status in two
//    columns; on a phone they are one derived state — inbound / outbound /
//    missed / live — carried by a tonal plate and a badge. Missed is danger.
//  · A DIAL PAD. The one thing a handheld can do that a desktop table cannot —
//    and here it does the real thing: the Call button hands the number to the
//    phone's own dialer. It is secondary to the log: it opens from the page
//    head as a sheet and never competes with the feed for the page.
//  · The right-hand popover becomes a bottom sheet, and the row "⋮" gets its
//    own actions sheet (no hover on touch; CLAUDE.md prefers sheets).
//  · A search box is added — it reaches the numbers, the summary, the lead id
//    AND what was actually said, which is how you find a call again. It filters
//    the rows already on the page client-side, no new endpoint.
//  · No pager: the loader hands over the hundred most recent calls, and the
//    desktop table pages nothing either.
//
// DATA: REAL, and the same line the desktop sheet shows. The page's server
// loader (app/dashboard/phone/load-phone) reads the org's AiPhoneCall rows,
// counts the three stat figures over the whole table, checks isTwilioEnabled()
// and builds the deployment's own webhook URL, then hands them down as props
// through the page's viewport switch (app/dashboard/phone/phone-responsive) or
// the /mobile-phone-v2 preview page.
//
// WHAT THE FIXTURE BUILD FAKED, and what each control does now — the same four
// corrections the desktop sheet made (see phone-behavior.ts):
//  1. "Create lead" wrote `L-` + a counter into local state. It now awaits
//     createLeadFromCall(callId) — the org-scoped, plan-limited action — and
//     prints the action's own error text.
//  2. "Open lead" closed the sheet. It now navigates to /dashboard/leads/<id>.
//  3. "Call back" and the dial pad's Call opened a sheet / wrote a fake live
//     row. Both are now `tel:` on the real number, and "Send a text" is `sms:`.
//  4. The recording player advanced a bar over a fixture duration. It now
//     drives a real <audio> off AiPhoneCall.recordingUrl, and says so when the
//     URL will not load.
// Also gone: "Delete from log" (no action exists to delete a call) and the
// always-on Twilio banner, which now shows only when Twilio really is
// unconfigured and prints the real webhook URL.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-phone.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { DeskWorkspaceHeader } from "@/components/v3/ai-desk/desk-workspace-header";
import { createLeadFromCall } from "@/actions/aiPhoneCalls";
import type { PhoneProps } from "@/app/dashboard/phone/load-phone";
import {
  ALL,
  FILTERS,
  KEYS,
  KIND_LABEL,
  actionError,
  counterparty,
  dayGroup,
  filterCount,
  fmtDial,
  fmtDur,
  kindOf,
  matchesFilter,
  matchesQuery,
  smsHref,
  telHref,
  type Call,
  type Kind,
} from "./phone-data";

/** Fed by app/dashboard/phone/load-phone. One loader, two editions. */
export type MobilePhoneProps = PhoneProps;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/* The four icons the shared 48-symbol sprite has no equivalent for, plus the
   two transport controls. Ids are prefixed i-phone- so they can never collide
   with the shared set or with another page in this batch. Original lucide
   paths, 24×24, stroke 2, currentColor — arrow-down-left, phone-missed, play,
   pause, delete. Outbound reuses the shared i-arrow, and a live call reuses the
   shared i-phone. */
function PhoneSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-phone-in" viewBox="0 0 24 24"><path d="M17 7 7 17" /><path d="M17 17H7V7" /></symbol>
        <symbol id="i-phone-missed" viewBox="0 0 24 24"><path d="m22 2-6 6" /><path d="m16 2 6 6" /><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></symbol>
        <symbol id="i-phone-play" viewBox="0 0 24 24"><path d="M6 3 20 12 6 21Z" /></symbol>
        <symbol id="i-phone-pause" viewBox="0 0 24 24"><rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" /></symbol>
        <symbol id="i-phone-del" viewBox="0 0 24 24"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /><path d="m12 9 6 6" /><path d="m18 9-6 6" /></symbol>
      </defs>
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

/** Direction plate + badge share one tone. Missed is danger — a missed call is
 *  lost work, and that is the whole point of scanning this page. */
const KIND_TONE: Record<Kind, string> = {
  in: styles.kIn,
  out: styles.kOut,
  missed: styles.kMissed,
  live: styles.kLive,
};
const KIND_ICON: Record<Kind, string> = {
  in: "i-phone-in",
  out: "i-arrow",
  missed: "i-phone-missed",
  live: "i-phone",
};

type MenuRow = {
  act: string;
  icon: string;
  tone?: string;
  title: string;
  sub: string;
  disabled?: boolean;
  danger?: boolean;
};

/** Clipboard only — a browser API, not a network call. */
function copyText(text: string) {
  try {
    navigator.clipboard?.writeText(text).catch(() => {});
  } catch {
    // No clipboard on this origin; the button's own flash is the feedback.
  }
}

export function MobilePhone({ entries, stats, webhookUrl, twilioConfigured, deskSettings }: MobilePhoneProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  /* The server's log, patched in place after a write RESOLVES. Re-seeded when
     the server hands down a new list (a router.refresh() after a lead, or a
     fresh navigation): the compare runs DURING render, React's own "adjusting
     state when a prop changes" pattern, so the stale list is never painted for
     a frame the way an effect would paint it. */
  const [data, setData] = useState<Call[]>(entries);
  const [seed, setSeed] = useState(entries);
  if (seed !== entries) {
    setSeed(entries);
    setData(entries);
  }
  const [filter, setFilter] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [actId, setActId] = useState<string | null>(null);
  const [dialOpen, setDialOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The call whose lead is being created, so the button can say so and a
   *  second tap cannot spend a second lead against the plan. */
  const [makingLead, setMakingLead] = useState<string | null>(null);
  const [leadErr, setLeadErr] = useState("");
  /** Calls converted to a lead in THIS session. Used to carry the masthead's
   *  lead figure until the server's own count catches up — see below. */
  const [freshLeads, setFreshLeads] = useState<string[]>([]);

  /* ---- dial pad ---- */
  const [dial, setDial] = useState("");

  /* ---- recording player ----
     A real <audio> off AiPhoneCall.recordingUrl. One element at a time — the
     sheet shows one call — and it is torn down whenever the sheet closes or
     moves to another call. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [play, setPlay] = useState<{ on: boolean; t: number; total: number | null; err: boolean }>({
    on: false,
    t: 0,
    total: null,
    err: false,
  });

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
      styles.btn, styles.ddBtn, styles.ddItem, styles.menuItem, styles.sheetCancel,
      styles.copen, styles.crow, styles.emptyA, styles.srchX, styles.hookCopy,
      styles.playBtn, styles.padKey, styles.dialDel,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes whatever is topmost ---------------------------
     Only what THIS page owns. The drawer's own Escape lives in MobileNav. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dialOpen) setDialOpen(false);
      else if (actId) setActId(null);
      else if (openId) setOpenId(null);
      else if (filterOpen) setFilterOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialOpen, actId, openId, filterOpen]);

  /* ---------- Filter dropdown: close on outside tap -------------------- */
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

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  /* ---------- derived -------------------------------------------------
     The three masthead figures are the server's counts over the WHOLE table,
     not over the hundred rows on the page, so they stay honest past the cap —
     the same numbers the desktop stat cards print. Creating a lead here bumps
     the lead figure locally until the refresh lands. */
  const visible = useMemo(
    () => data.filter((c) => matchesFilter(c, filter) && matchesQuery(c, query)),
    [data, filter, query],
  );
  const weekCount = stats.week;
  const todayCount = stats.today;
  /* A lead created here is not in `stats` until the refresh lands, so it is
     counted on top — and only while the server's own list still shows that
     call without one, which is what makes the correction self-cancelling
     rather than a number that drifts. */
  const leadCount = useMemo(
    () => stats.leads + freshLeads.filter((id) => !entries.find((c) => c.id === id)?.lead).length,
    [stats.leads, freshLeads, entries],
  );

  /** Runs of the same day become one framed block under one drawn divider. */
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: Call[] }> = [];
    visible.forEach((c) => {
      const label = dayGroup(c.when);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(c);
      else out.push({ key: `${label}-${c.id}`, label, rows: [c] });
    });
    return out;
  }, [visible]);

  /** Flat position drives the row stagger, so it stays continuous across the
   *  dividers instead of restarting at every day. */
  const orderIndex = useMemo(() => {
    const m = new Map<string, number>();
    visible.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [visible]);

  const activeFilter = FILTERS.find((f) => f.k === filter) ?? FILTERS[0];
  const detail = openId === null ? null : (data.find((c) => c.id === openId) ?? null);
  const actCall = actId === null ? null : (data.find((c) => c.id === actId) ?? null);
  const anyOverlay = Boolean(detail) || Boolean(actCall) || dialOpen;

  // Swipe-down dismissal, one gesture per sheet, on the same setters the
  // Escape ladder uses.
  const detailDrag = useSheetDrag(Boolean(detail), () => setOpenId(null));
  const actDrag = useSheetDrag(Boolean(actCall), () => setActId(null));
  const dialDrag = useSheetDrag(dialOpen, () => setDialOpen(false));

  const resetFilters = () => {
    setFilter(ALL);
    setQuery("");
  };

  /* ---------- recording player -----------------------------------------
     Mounted for the call the sheet is showing, torn down when it closes or
     changes. `detail.rec` is the recording URL, so an absent one means the
     section is not rendered at all rather than a dead transport. */
  const recUrl = detail?.rec ?? null;
  /* The transport belongs to ONE recording, so moving to another call resets
     it during render rather than from inside the effect below — which keeps
     the effect a pure subscription and never paints the old call's elapsed
     time against the new call's clock. */
  const [playFor, setPlayFor] = useState<string | null>(recUrl);
  if (playFor !== recUrl) {
    setPlayFor(recUrl);
    setPlay({ on: false, t: 0, total: null, err: false });
  }
  useEffect(() => {
    if (!recUrl) {
      audioRef.current = null;
      return;
    }
    const el = new Audio(recUrl);
    el.preload = "metadata";
    audioRef.current = el;
    const total = () => (isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    const onTime = () => setPlay((p) => ({ ...p, t: el.currentTime, total: total() ?? p.total }));
    const onMeta = () => setPlay((p) => ({ ...p, total: total() ?? p.total }));
    const onPlay = () => setPlay((p) => ({ ...p, on: true, err: false }));
    const onPause = () => setPlay((p) => ({ ...p, on: false }));
    const onEnd = () => setPlay((p) => ({ ...p, on: false, t: 0 }));
    // Twilio's URL is signed and can expire or 404; say so where the clock was
    // rather than leaving a button that silently does nothing.
    const onErr = () => setPlay((p) => ({ ...p, on: false, err: true }));
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onErr);
    return () => {
      el.pause();
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onErr);
      el.removeAttribute("src");
      el.load();
      audioRef.current = null;
    };
  }, [recUrl]);

  const playing = play.on;
  const playT = play.t;
  const playDur = play.total ?? detail?.dur ?? 0;

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlay((p) => ({ ...p, on: false, err: true })));
    else el.pause();
  };

  /* ---------- actions -------------------------------------------------- */
  const openDial = (prefill: string) => {
    setDial(prefill.replace(/\D/g, ""));
    setActId(null);
    setOpenId(null);
    setDialOpen(true);
  };

  /** The REAL write: the same org-scoped, plan-limited action the desktop
   *  sheet calls. The badge appears only once it resolves. */
  const makeLead = async (id: string) => {
    if (makingLead) return;
    setMakingLead(id);
    setLeadErr("");
    try {
      const res = await createLeadFromCall(id);
      const leadId = typeof res === "object" && res && "id" in res ? String(res.id) : null;
      setData((prev) => prev.map((x) => (x.id === id ? { ...x, lead: leadId ?? x.lead } : x)));
      setFreshLeads((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setLandedId(id);
      router.refresh();
    } catch (err) {
      setLeadErr(actionError(err));
    } finally {
      setMakingLead(null);
    }
  };

  const menuRows = useMemo<MenuRow[]>(() => {
    const c = actCall;
    if (!c) return [];
    const other = counterparty(c);
    const tel = telHref(other);
    const sms = smsHref(other);
    return [
      { act: "call", icon: "i-phone", tone: styles.miBp, title: "Call back",
        sub: tel ? other : "No number to dial", disabled: !tel },
      { act: "text", icon: "i-msg", tone: styles.miSky, title: "Send a text",
        sub: sms ? `SMS to ${other}` : "No number to text", disabled: !sms },
      {
        act: "script", icon: "i-file", tone: styles.miOk, title: "Read transcript",
        sub: c.script.length
          ? `${c.script.length} lines on file`
          : c.transcript
            ? "Transcript on file"
            : "No transcript yet",
        disabled: c.script.length === 0 && !c.transcript,
      },
      c.lead
        ? { act: "lead", icon: "i-arrow", tone: styles.miWarn, title: "Open lead", sub: "Go to the lead record" }
        : { act: "lead", icon: "i-target", tone: styles.miWarn, title: "Create lead",
            sub: makingLead === c.id ? "Creating…" : "Start one from this call",
            disabled: Boolean(makingLead) },
      { act: "copy", icon: "i-copy", title: "Copy number", sub: other },
    ];
  }, [actCall, makingLead]);

  const runMenu = (act: string) => {
    const c = actCall;
    if (!c) return;
    const other = counterparty(c);
    if (act === "call") {
      const tel = telHref(other);
      if (tel) window.location.assign(tel);
      return;
    }
    if (act === "text") {
      const sms = smsHref(other);
      if (sms) window.location.assign(sms);
      return;
    }
    if (act === "script") {
      setActId(null);
      setOpenId(c.id);
      return;
    }
    if (act === "lead") {
      if (c.lead) {
        setActId(null);
        router.push(`/dashboard/leads/${c.lead}`);
      } else {
        void makeLead(c.id);
      }
      return;
    }
    setActId(null);
    if (act === "copy") copyText(other);
  };

  /** The phone's own dialer places the call — this app has no outbound line,
   *  and the fixture build's "live OUTBOUND row" was a drawing of one. */
  const dialHref = telHref(fmtDial(dial));
  const placeCall = () => {
    if (!dialHref) return;
    setDialOpen(false);
    window.location.assign(dialHref);
  };

  return (
    <div className={styles.app} onClick={onRootClick}>
      {/* Shared handheld nav: topbar + drawer + the 48-symbol sprite. Owns its
          own open state, so the page holds none. */}
      <MobileNav />
      <PhoneSprite />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          <DeskWorkspaceHeader settings={deskSettings} />
          {/* CALL ACTIONS */}
          <div className={styles.pageHead}>
            <div className={styles.pageActions}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                type="button"
                onClick={() => openDial("")}
              >
                <Icon id="i-phone" />Dial
              </button>
            </div>
          </div>

          {/* CONFIGURATION BANNER — the desktop cfg-banner. Shown only when
              Twilio really is unconfigured (the fixture build showed it
              always), and the URL is this deployment's own. */}
          {twilioConfigured ? null : (
            <div className={styles.cfg}>
              <span className={styles.cfgIc}>
                <Icon id="i-gear" />
              </span>
              <div className={styles.cfgT}>Twilio isn&apos;t configured</div>
              <div className={styles.cfgH}>
                Add <span className={styles.cfgCode}>TWILIO_ACCOUNT_SID</span>,{" "}
                <span className={styles.cfgCode}>TWILIO_AUTH_TOKEN</span> and{" "}
                <span className={styles.cfgCode}>TWILIO_PHONE_NUMBER</span>, then point the
                number&apos;s <span className={styles.cfgCode}>A call comes in</span> webhook here.
              </div>
              <div className={styles.cfgHook}>
                <span className={styles.hookUrl}>{webhookUrl}</span>
                <button
                  className={`${styles.hookCopy} ${copied ? styles.done : ""}`}
                  type="button"
                  onClick={() => {
                    copyText(webhookUrl);
                    setCopied(true);
                  }}
                >
                  <Icon id={copied ? "i-check" : "i-copy"} />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {/* MASTHEAD — the desktop's three stat cards as one numeral + two
              annotations. All three are the server's counts over the whole
              table, not over the rows on this page. */}
          <div className={styles.mast}>
            <div className={styles.mastTop}>
              <div className={styles.mastLbl}>
                Calls · 7 days
                <span className={styles.mastRule} />
              </div>
              <CountUp value={weekCount} className={styles.mastVal} />
            </div>
            <div className={styles.mastCnt}>
              <div className={styles.mastSub}>
                <div className={styles.mastSubL}>Today</div>
                <div className={styles.mastSubV}>{todayCount}</div>
              </div>
              <div className={styles.mastSub}>
                <div className={styles.mastSubL}>Auto-leads</div>
                <div className={styles.mastSubV}>{leadCount}</div>
              </div>
            </div>
          </div>

          {/* FIND BAR — search + the chip rail as one dropdown */}
          <div className={styles.find}>
            <label className={styles.srch}>
              <Icon id="i-search" />
              <input
                className={styles.srchInput}
                type="search"
                value={query}
                placeholder="Search number, summary or transcript…"
                autoComplete="off"
                aria-label="Search calls"
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
                  {activeFilter.l} · {filterCount(data, filter)}
                </span>
                <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
              </button>
              <div className={styles.ddMenu} role="listbox">
                {FILTERS.map((f) => (
                  <button
                    key={f.k}
                    className={`${styles.ddItem} ${filter === f.k ? styles.active : ""}`}
                    type="button"
                    role="option"
                    aria-selected={filter === f.k}
                    onClick={() => {
                      setFilter(f.k);
                      setFilterOpen(false);
                    }}
                  >
                    {f.l}
                    <span className={styles.ddCount}>{filterCount(data, f.k)}</span>
                    {filter === f.k ? <Icon id="i-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* THE FEED */}
          {visible.length === 0 ? (
            <div className={styles.empty}>
              {data.length === 0 ? (
                <>
                  <div className={styles.emptyT}>No calls yet</div>
                  <div className={styles.emptyS}>
                    Point your number&apos;s webhook at JobFlex and inbound calls land here on
                    their own — with a transcript and a lead.
                  </div>
                  <button className={styles.emptyA} type="button" onClick={() => openDial("")}>
                    <Icon id="i-phone" />Open the dial pad
                  </button>
                </>
              ) : (
                <>
                  <div className={styles.emptyT}>No matches</div>
                  <div className={styles.emptyS}>No call matches that search and filter.</div>
                  <button className={styles.emptyA} type="button" onClick={resetFilters}>
                    <Icon id="i-x" />Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.feed}>
              {groups.map((g) => (
                <div className={styles.fgroup} key={g.key}>
                  {/* A drawn rule with the day sitting on it — a section note */}
                  <div className={styles.dayDiv}>
                    <span className={styles.dayDivL}>{g.label}</span>
                    <span className={styles.dayDivN}>
                      {g.rows.length} {g.rows.length === 1 ? "call" : "calls"}
                    </span>
                  </div>
                  <div className={styles.glog}>
                    {g.rows.map((c) => {
                      const kind = kindOf(c);
                      const other = counterparty(c);
                      const i = orderIndex.get(c.id) ?? 0;
                      return (
                        <div
                          key={c.id}
                          className={`${styles.crow} ${styles.rowIn} ${landedId === c.id ? styles.landed : ""}`}
                          style={{ animationDelay: `${i * 45}ms` }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${KIND_LABEL[kind]} call, ${c.name || other} — open detail`}
                          onClick={() => setOpenId(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setOpenId(c.id);
                            }
                          }}
                        >
                          <span
                            className={`${styles.dplate} ${KIND_TONE[kind]} ${kind === "live" ? styles.livePulse : ""}`}
                          >
                            <Icon id={KIND_ICON[kind]} />
                          </span>
                          <div className={styles.cnum}>{c.name || other}</div>
                          <button
                            className={styles.copen}
                            type="button"
                            aria-label={`Actions for the call with ${c.name || other}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActId(c.id);
                            }}
                          >
                            <Icon id="i-dots" />
                          </button>
                          <div className={styles.cto}>
                            {/* the caller's name above (2026-11-11): their number moves down here */}
                            {c.name ? `${other} · ` : ""}
                            {c.dir === "OUTBOUND" ? `from ${c.from}` : `to ${c.to}`}
                          </div>
                          <div className={styles.cfoot}>
                            <span className={styles.cbadges}>
                              <span className={`${styles.badge} ${KIND_TONE[kind]}`}>
                                {KIND_LABEL[kind]}
                              </span>
                              {c.lead ? (
                                <span className={`${styles.badge} ${styles.isLead}`}>Lead</span>
                              ) : (
                                <span className={`${styles.badge} ${styles.isNoLead}`}>No lead</span>
                              )}
                            </span>
                          </div>
                          {/* Last line of the card: the summary owns the text
                              column, the duration anchors the bottom-right
                              corner. They are two grid cells, not a float and a
                              wrap — so a long summary can never slide under the
                              figure at 320px. The relative time ("2 days ago")
                              is not repeated here; the day divider above the
                              group already states it. */}
                          <div className={styles.cbottom}>
                            <div className={`${styles.cexcerpt} ${c.summary ? "" : styles.none}`}>
                              {c.summary ?? "No transcript yet — it is written once the recording finishes processing."}
                            </div>
                            <span className={`${styles.cdur} ${c.dur == null ? styles.isZero : ""}`}>
                              {fmtDur(c.dur)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ============ SHEET SCRIM (shared by all three sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => {
          setOpenId(null);
          setActId(null);
          setDialOpen(false);
        }}
        aria-hidden="true"
      />

      {/* ============ CALL DETAIL SHEET ============ */}
      <div
        className={`${styles.sheet} ${detail ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Call detail"
        aria-hidden={!detail}
        {...detailDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...detailDrag.handleProps} />
        <div className={styles.sheetHead} {...detailDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {detail
              ? `${KIND_LABEL[kindOf(detail)]} · ${detail.status.toLowerCase().replace("_", " ")} · ${detail.when}`
              : "Call · —"}
          </div>
          <div className={styles.sheetTitle}>{detail ? detail.name || counterparty(detail) : "Call"}</div>
        </div>
        <div className={styles.sheetBody}>
          {detail ? (
            <>
              <div className={styles.dBadges}>
                <span className={`${styles.badge} ${KIND_TONE[kindOf(detail)]}`}>
                  {KIND_LABEL[kindOf(detail)]}
                </span>
                <span className={styles.badge}>{fmtDur(detail.dur)}</span>
                {detail.lead ? (
                  <span className={`${styles.badge} ${styles.isLead}`}>Lead</span>
                ) : (
                  <span className={`${styles.badge} ${styles.isNoLead}`}>No lead</span>
                )}
              </div>

              {detail.rec ? (
                <div className={styles.dSec}>
                  <div className={styles.dSecLbl}>Recording</div>
                  <div className={styles.player}>
                    <button
                      className={styles.playBtn}
                      type="button"
                      disabled={play.err}
                      aria-label={playing ? "Pause recording" : "Play recording"}
                      onClick={togglePlay}
                    >
                      <Icon id={playing ? "i-phone-pause" : "i-phone-play"} />
                    </button>
                    <span className={styles.playTrack}>
                      <span
                        className={styles.playFill}
                        style={{ transform: `scaleX(${playDur ? Math.min(1, playT / playDur) : 0})` }}
                      />
                    </span>
                    <span className={styles.playTime}>
                      {play.err
                        ? "Recording unavailable"
                        : `${fmtDur(playT)} / ${fmtDur(play.total ?? detail.dur)}`}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className={styles.dSec}>
                <div className={styles.dSecLbl}>Call summary</div>
                {detail.summary ? (
                  <div className={styles.dSummary}>{detail.summary}</div>
                ) : (
                  <div className={styles.dNone}>
                    No summary yet — it is written once the recording finishes processing.
                  </div>
                )}
              </div>

              <div className={styles.dSec}>
                <div className={styles.dSecLbl}>Transcript</div>
                {detail.script.length ? (
                  <div className={styles.script}>
                    {detail.script.map((l, i) => (
                      <div
                        key={`${detail.id}-${i}`}
                        className={`${styles.scriptLine} ${l[0] === "agent" || l[0] === "desk" ? styles.scriptAgent : ""}`}
                      >
                        {/* the AI desk's own lines say so, as on the desktop sheet (they read "Caller" here before 2026-11-11) */}
                        <span className={styles.scriptWho}>{l[0] === "desk" ? "AI desk" : l[0] === "agent" ? "Shop" : "Caller"}</span>
                        <span className={styles.scriptTxt}>{l[1]}</span>
                      </div>
                    ))}
                  </div>
                ) : detail.transcript ? (
                  /* Unlabelled transcription — Twilio's raw text has no
                     speakers, and guessing would put half a conversation on the
                     wrong side. One block, exactly as the desktop renders it. */
                  <div className={styles.dSummary}>{detail.transcript}</div>
                ) : (
                  <div className={styles.dNone}>
                    No transcript yet — it is posted once the recording completes.
                  </div>
                )}
              </div>

              {leadErr ? <div className={styles.actErr} role="alert">{leadErr}</div> : null}
            </>
          ) : null}
        </div>
        <div className={styles.formFoot}>
          {/* The device places the call — a `tel:` link, guarded so a stored
              "number" cannot become another URL scheme. */}
          <a
            className={`${styles.btn} ${styles.btnGhost}`}
            href={detail ? telHref(counterparty(detail)) ?? "#" : "#"}
            aria-disabled={detail ? !telHref(counterparty(detail)) : true}
          >
            <Icon id="i-phone" />Call back
          </a>
          {detail?.lead ? (
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={() => {
                const leadId = detail.lead;
                setOpenId(null);
                if (leadId) router.push(`/dashboard/leads/${leadId}`);
              }}
            >
              <Icon id="i-arrow" />Open lead
            </button>
          ) : (
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              disabled={Boolean(makingLead)}
              onClick={() => {
                if (detail) void makeLead(detail.id);
              }}
            >
              <Icon id="i-target" />
              {makingLead && detail && makingLead === detail.id ? "Creating…" : "Create lead"}
            </button>
          )}
        </div>
      </div>

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div
        className={`${styles.sheet} ${actCall ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Call actions"
        aria-hidden={!actCall}
        {...actDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...actDrag.handleProps} />
        <div className={styles.sheetHead} {...actDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {actCall
              ? `${actCall.when} · ${fmtDur(actCall.dur)} · ${actCall.rec ? "recorded" : "no recording"}`
              : "Call · —"}
          </div>
          <div className={styles.sheetTitle}>{actCall ? actCall.name || counterparty(actCall) : "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {leadErr ? <div className={styles.actErr} role="alert">{leadErr}</div> : null}
          {menuRows.map((r) => (
            <button
              key={r.act}
              type="button"
              disabled={r.disabled}
              className={`${styles.menuItem} ${r.danger ? styles.menuItemDanger : ""}`}
              onClick={() => runMenu(r.act)}
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
        <button className={styles.sheetCancel} type="button" onClick={() => setActId(null)}>
          Cancel
        </button>
      </div>

      {/* ============ DIAL PAD SHEET ============ */}
      <div
        className={`${styles.sheet} ${dialOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Dial pad"
        aria-hidden={!dialOpen}
        {...dialDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...dialDrag.handleProps} />
        <div className={styles.sheetHead} {...dialDrag.handleProps}>
          {/* The call is placed by the device, not by the app, so the kicker
              names the handset rather than a shop line the app does not own. */}
          <div className={styles.sheetKicker}>Outbound · from this phone</div>
          <div className={styles.sheetTitle}>Dial</div>
        </div>
        <div className={styles.sheetBody}>
          <div className={styles.dialWrap}>
            <div className={styles.dialDisp}>
              {dial ? (
                <span className={styles.dialNum}>{fmtDial(dial)}</span>
              ) : (
                <span className={styles.dialPh}>Enter a number</span>
              )}
              <button
                className={styles.dialDel}
                type="button"
                disabled={!dial}
                aria-label="Delete last digit"
                onClick={() => setDial((v) => v.slice(0, -1))}
              >
                <Icon id="i-phone-del" />
              </button>
            </div>
            <div className={styles.pad}>
              {KEYS.map((k) => (
                <button
                  key={k.d}
                  className={styles.padKey}
                  type="button"
                  aria-label={`Key ${k.d}`}
                  onClick={() => setDial((v) => (v.length >= 15 ? v : v + k.d))}
                >
                  <span className={styles.padD}>{k.d}</span>
                  <span className={styles.padS}>{k.s}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.formFoot}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            onClick={() => setDialOpen(false)}
          >
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            type="button"
            disabled={!dialHref}
            onClick={placeCall}
          >
            <Icon id="i-phone" />Call
          </button>
        </div>
      </div>
    </div>
  );
}
