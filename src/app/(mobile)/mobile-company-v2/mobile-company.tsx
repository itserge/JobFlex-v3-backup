"use client";

// MOBILE COMPANY (mobile-company-v2) — Blueprint system, handheld build.
//
// Tokens, palette, type scale, status tones and Motion System "Balanced" are
// the reference dashboard's; the shell (topbar / hamburger drawer / sprite) is
// the shared <MobileNav />, so this surface is the same product as /mobile-v2,
// /mobile-proposals-v2 and /mobile-clients-v2.
//
// Every region of the desktop Company sheet (components/v3/company-blueprint)
// is covered:
//  · page head (kicker "Account" + H1) with the primary / ghost action pair
//  · the four section tabs, with a sliding blueprint rule
//  · BRANDING — Identity (5 fields), brand colour (8 presets + hex), logo drop,
//    live email-header preview, and the autosave lines
//  · LEAD MATCHING — the 3-state status badge, both contact fields, all 12
//    trades, the "Accept platform leads" toggle
//  · TEAM — the unified-roster card and its flashing "Open Workers" action
//  · TEAM ACTIVITY — the 5 category filters, the person filter, search, the
//    day-grouped feed, "Load more" (as a pager), and the empty state
//  · LANDING BUILDER — the Soon pill, the publish toggle, both hero fields
//  · the desktop `data-flash` button behaviour (Copy details / Open Workers)
//
// What changes versus the desktop sheet, and why:
//  · Identity's five always-live inputs become a read summary plus a form
//    SHEET. On a phone the branding tab is one long scroll and a focused input
//    ends up under the keyboard; the sheet also gives the page head a real
//    primary action, which the desktop page (autosave only) never needed.
//  · The category chip rail and the person <select> become two dropdowns of one
//    construction: a chip rail cannot survive 320px, and a native select cannot
//    carry the frame or the counts.
//  · The activity feed's desktop row becomes a three-line row card with a
//    38px monogram avatar and a ⋮ actions sheet — the feed is this page's only
//    list, so it is where the row-card rules apply.
//  · "Load more" becomes a pager at 5 per page: appending twelve three-line
//    rows buries the rest of the panel on a handheld.
//  · The 44×24 toggle becomes a full-width row button, so the target clears
//    44px instead of being a 24px-tall track.
//
// Content is the ORG'S REAL COMPANY RECORD. The component is mounted
// props-less (by ResponsiveDashboardShell on /dashboard/company and by the
// standalone /mobile-company-v2 route) and asks the read-only `getCompanySeed`
// action for the same org row + member roster + toActivityEntries feed the
// desktop page reads — the pattern mobile-calendar-v2 set. Every save runs the
// same three server actions the desktop sheet runs (updateBranding /
// updateLeadProfile / updateLanding), behind the donor's 700ms debounce for
// typing and immediately for decisions (swatch, chip, toggle, form submit).
// The feed is read-only, like the desktop's: there is no delete affordance.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-company.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { LOGO_ACCEPT, LOGO_HINT, LogoFileError, prepareLogo } from "@/lib/logoClient";
import { lockScroll } from "@/lib/scrollLock";
import { roleLabel } from "@/lib/team/who";
import {
  getCompanySeed,
  updateBranding,
  updateLanding,
  updateLeadProfile,
} from "@/actions/company";
import { CompanyNameNote } from "@/components/company-name/company-name-note";
import { companyNameStatus } from "@/actions/companyName";
import {
  ACT_CATS,
  ALL_CAT,
  COLOR_PRESETS,
  DEFAULT_COLOR,
  EVERYONE,
  LANDING_PLACEHOLDERS,
  PAGE_SIZE,
  TRADE_TYPES,
  actionError,
  catCount,
  catLabel,
  hasRecord,
  matchesEntry,
  metaAmount,
  metaType,
  monogram,
  orNull,
  personCount,
  plainSummary,
  rowBadge,
  summaryParts,
  toneKey,
  type ActivityRecord,
  type CompanySeed,
  type Identity,
  type ToneKey,
} from "./company-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const TABS = [
  { key: "branding", label: "Branding" },
  { key: "team", label: "Team" },
  // The desktop labels are "Team activity" and "Landing builder"; four columns
  // at 320px give each tab ~65px of label room, so the two long ones lose the
  // words the H1 and the card titles already say.
  { key: "activity", label: "Activity" },
  { key: "landing", label: "Landing" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* The fixture stores its bead colour as a raw `var(--…)` string; these maps turn
   that into real classes, so the badge gets all three status tones (base border
   / soft fill / base text) from the stylesheet. Written as maps rather than
   `styles[\`tone${key}\`]` so every class is statically visible. */
const TONE_BADGE: Record<ToneKey, string> = {
  bp: styles.toneBp,
  warn: styles.toneWarn,
  ok: styles.toneOk,
  danger: styles.toneDanger,
  none: styles.toneNone,
};
const TONE_BEAD: Record<ToneKey, string> = {
  bp: styles.beadBp,
  warn: styles.beadWarn,
  ok: styles.beadOk,
  danger: styles.beadDanger,
  none: styles.beadNone,
};

/** The three tonal box classes the row sheet hands out, plus neutral. */
type MenuRow = {
  act: string;
  icon: string;
  tone?: string;
  title: string;
  sub: string;
  disabled?: boolean;
  danger?: boolean;
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
      el.textContent = value.toLocaleString("en-US");
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      el.textContent = Math.round(value * (1 - Math.pow(1 - pr, 3))).toLocaleString("en-US");
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div ref={ref} className={className}>
      {value.toLocaleString("en-US")}
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "err";

/**
 * The donor's autosave line, now in front of a REAL write. `run` shows
 * "Saving…", debounces (700ms for typing, 0 for decisions), awaits the server
 * action, then reports what the server actually did — "All changes saved" or
 * the error, inline. One instance per card, so the line always reports what
 * that card owns. The sequence token means a slow older write can never
 * overwrite the report of a newer one.
 */
function useAutosave() {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);
  const run = useCallback((write: () => Promise<unknown>, delay = 700) => {
    setState("saving");
    setError(null);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const token = ++seq.current;
      write().then(
        () => {
          if (seq.current === token) setState("saved");
        },
        (err: unknown) => {
          if (seq.current !== token) return;
          setState("err");
          setError(actionError(err));
        },
      );
    }, delay);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return { state, error, run };
}

/** The donor's `data-flash`: swap the label for a check for 1500ms. */
function useFlash(ms: number) {
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);
  const fire = useCallback(() => {
    setOn(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return [on, fire] as const;
}

function SaveLine({
  state,
  error,
  idle,
}: {
  state: SaveState;
  error?: string | null;
  idle?: string;
}) {
  if (state === "idle" && !idle) return null;
  const cls =
    state === "saved" ? styles.saved : state === "err" ? styles.err : "";
  return (
    <div className={`${styles.saveLine} ${cls}`}>
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "All changes saved"
          : state === "err"
            ? (error ?? "Couldn’t save — try again.")
            : idle}
    </div>
  );
}

/**
 * Props-less mount: fetch the real seed, then hand it to the board. Failure is
 * an honest boot error with a retry — never the fixture.
 */
export function MobileCompany() {
  const [seed, setSeed] = useState<CompanySeed | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getCompanySeed()
      .then((s) => {
        if (alive) setSeed(s);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(actionError(err));
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (seed) return <CompanyBoard seed={seed} />;
  return (
    <BootScreen
      error={loadError}
      onRetry={() => {
        // Back to the paper hold while the refetch runs; the effect re-runs
        // off `attempt`.
        setLoadError(null);
        setAttempt((a) => a + 1);
      }}
    />
  );
}

/** Paper hold while the seed lands, and an honest failure if it does not.
 *  No Icon here: the sprite ships with <MobileNav />, which only the board
 *  mounts. */
function BootScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return <div className={styles.app} />;
  return (
    <div className={styles.app}>
      <main className={styles.scroll}>
        <div className={styles.content}>
          <div className={styles.empty}>
            <div className={styles.emptyT}>Couldn’t load company</div>
            <div className={styles.emptyS}>{error}</div>
            <button className={styles.emptyA} type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function CompanyBoard({ seed }: { seed: CompanySeed }) {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("branding");

  /* ---- branding ---- */
  const [identity, setIdentity] = useState<Identity>(() => ({
    name: seed.org.name,
    email: seed.org.billingEmail,
    phone: seed.org.phone,
    site: seed.org.website,
    addr: seed.org.address,
  }));
  const [color, setColor] = useState(seed.org.primaryColor || DEFAULT_COLOR);
  const [hex, setHex] = useState(seed.org.primaryColor || DEFAULT_COLOR);
  const [logoUrl, setLogoUrl] = useState<string | null>(seed.org.logoUrl);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoBusyRef = useRef(false);
  /** "Remove logo" asks once more: the first tap arms it for a few seconds. */
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => {
    if (!removeArmed) return;
    const t = window.setTimeout(() => setRemoveArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [removeArmed]);
  // /dashboard/company#logo: this tree mounts after the browser's own hash
  // jump (the viewport switch imports it), so make that jump here.
  useEffect(() => {
    if (window.location.hash !== "#logo") return;
    const t = window.setTimeout(() => document.getElementById("logo")?.scrollIntoView({ block: "center" }), 0);
    return () => window.clearTimeout(t);
  }, []);

  /* ---- lead matching ---- */
  const [lead, setLead] = useState(() => ({ addr: seed.org.address, phone: seed.org.phone }));
  const [radius, setRadius] = useState(() => String(seed.org.serviceRadiusMiles ?? 50));
  const [trades, setTrades] = useState<string[]>(() => [...seed.org.tradeTypes]);
  const [leadsOn, setLeadsOn] = useState(seed.org.leadOffersEnabled);
  /* The matcher's third condition. Held in state, not derived, because
     updateLeadProfile answers with the geocode result and the badge has to
     stop saying "Matching on" the moment the address stops resolving. */
  const [geocoded, setGeocoded] = useState(seed.org.geocoded);

  /* ---- landing builder ---- */
  const [publicOn, setPublicOn] = useState(seed.org.publicProfileEnabled);
  const [landing, setLanding] = useState(() => ({
    title: seed.org.landingHeroTitle,
    sub: seed.org.landingHeroSubtitle,
  }));

  /* ---- team ---- */
  const members = seed.members;
  const [workersFlash, fireWorkers] = useFlash(1500);
  const [copied, fireCopied] = useFlash(1500);

  /* ---- activity (read-only, like the desktop feed) ---- */
  const activity: ActivityRecord[] = seed.activity;
  const [actCat, setActCat] = useState(ALL_CAT);
  const [actPerson, setActPerson] = useState(EVERYONE);
  const [actQuery, setActQuery] = useState("");
  const [actPage, setActPage] = useState(1);
  const [catOpen, setCatOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);
  const personRef = useRef<HTMLDivElement>(null);

  /* ---- overlays ---- */
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);

  /* ---- identity form draft ---- */
  const [form, setForm] = useState<Identity>(() => ({
    name: seed.org.name,
    email: seed.org.billingEmail,
    phone: seed.org.phone,
    site: seed.org.website,
    addr: seed.org.address,
  }));
  const [nameErr, setNameErr] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const saveIdentity = useAutosave();
  const saveBrand = useAutosave();
  const saveLead = useAutosave();
  const saveLanding = useAutosave();

  /** Every Lead matching write goes through here so the badge is corrected
   *  from the server's answer rather than guessed at on the client. */
  const pushLead = useCallback(
    (
      patch: {
        address?: string | null;
        phone?: string | null;
        tradeTypes?: string[];
        leadOffersEnabled?: boolean;
        serviceRadiusMiles?: number;
      },
      delay?: number,
    ) =>
      saveLead.run(async () => {
        const res = await updateLeadProfile(patch);
        setGeocoded(res.geocoded);
        return res;
      }, delay),
    // `saveLead.run` is the stable half of the hook (useCallback with no deps);
    // the object around it is rebuilt every render, so depending on the whole
    // thing would rebuild this callback on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saveLead.run],
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
      styles.menuItem, styles.sheetCancel, styles.arowOpen, styles.cardEdit,
      styles.sw, styles.trade, styles.tgRow, styles.logoDrop, styles.teamAct,
      styles.emptyA, styles.srchX,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes what the PAGE owns -----------------------------
     The drawer is not listed: MobileNav binds its own Escape while open, so the
     two listeners can never claim one key press. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (catOpen) setCatOpen(false);
      else if (personOpen) setPersonOpen(false);
      else if (identityOpen) setIdentityOpen(false);
      else if (sheetId) setSheetId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [catOpen, personOpen, identityOpen, sheetId]);

  /* ---------- Dropdowns: close on outside pointerdown ------------------ */
  useEffect(() => {
    if (!catOpen && !personOpen) return;
    const onDown = (e: PointerEvent) => {
      if (catOpen && !catRef.current?.contains(e.target as Node)) setCatOpen(false);
      if (personOpen && !personRef.current?.contains(e.target as Node)) setPersonOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [catOpen, personOpen]);

  /* ---------- Paging returns you to the top of the log ------------------
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
  }, [actPage]);

  /* ---------- The one blue flash on a record you just changed ----------- */
  useEffect(() => {
    if (!landed) return;
    const t = window.setTimeout(() => setLanded(null), 700);
    return () => clearTimeout(t);
  }, [landed]);

  /* ---------- derived --------------------------------------------------- */
  const visible = useMemo(
    () => activity.filter((e) => matchesEntry(e, actCat, actPerson, actQuery)),
    [activity, actCat, actPerson, actQuery],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(actPage, pages);
  const slice = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // The same three conditions the matcher filters on (lib/leadCenter/matching)
  // and the same four labels the desk badge shows — the geocode was missing
  // from both until 2026-09-17, so a shop with no pin was told it was matching.
  const leadReady = trades.length > 0 && leadsOn && geocoded;
  const leadLabel = leadReady
    ? "Matching on"
    : !leadsOn
      ? "Paused"
      : trades.length === 0
        ? "Pick a trade"
        : "Matching off";

  const previewSub = identity.site || identity.phone || identity.email || "—";
  const previewName = identity.name || "Your company";

  const idRows = useMemo(
    () => [
      { k: "Company name", v: identity.name },
      { k: "Billing email", v: identity.email },
      { k: "Phone", v: identity.phone },
      { k: "Website", v: identity.site },
      { k: "Address", v: identity.addr },
    ],
    [identity],
  );

  const sheetEntry = sheetId === null ? null : (activity.find((e) => e.id === sheetId) ?? null);
  const tabIndex = TABS.findIndex((t) => t.key === tab);

  /* The person filter's options: the EVERYONE sentinel plus the real roster.
     Values are membership user ids — display names can collide. */
  const personOptions = useMemo(
    () => [{ id: EVERYONE, name: "Everyone" }, ...members],
    [members],
  );
  const personLabel = (id: string) =>
    personOptions.find((m) => m.id === id)?.name ?? "Member";

  /* ---------- actions -------------------------------------------------- */
  const copyText = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard unavailable — the flash still confirms the tap */
    }
  };

  const copyDetails = () => {
    copyText(
      [identity.name, identity.addr, identity.phone, identity.email, identity.site]
        .filter(Boolean)
        .join("\n"),
    );
    fireCopied();
  };

  /* A swatch is a decision, not typing — save it without the type-ahead wait.
     Same single-field write the desktop swatch sends. */
  const pickColor = (c: string) => {
    setColor(c);
    setHex(c);
    saveBrand.run(() => updateBranding({ primaryColor: c }), 0);
  };

  const onHex = (v: string) => {
    setHex(v);
    const t = v.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(t)) {
      setColor(t);
      saveBrand.run(() => updateBranding({ primaryColor: t }));
    }
  };

  /* A chip is a decision too — desktop sends `{ tradeTypes }` alone, delay 0. */
  const toggleTrade = (t: string) => {
    const next = trades.includes(t) ? trades.filter((x) => x !== t) : [...trades, t];
    setTrades(next);
    pushLead({ tradeTypes: next }, 0);
  };

  const openWorkers = () => {
    fireWorkers();
    router.push("/dashboard/workers");
  };

  const resetFilters = () => {
    setActCat(ALL_CAT);
    setActPerson(EVERYONE);
    setActQuery("");
    setActPage(1);
  };

  /* The passwordless sign-up's stand-in name (lib/orgName): said under the
     field, and /dashboard/company#company-name opens the sheet on it. */
  const [nameUnset, setNameUnset] = useState(false);
  useEffect(() => {
    let live = true;
    void companyNameStatus().then((st) => {
      if (live) setNameUnset(st.unset);
    });
    return () => {
      live = false;
    };
  }, []);

  const openIdentity = () => {
    setForm({ ...identity });
    setNameErr(false);
    setEmailErr(false);
    setIdentityOpen(true);
    // Focus after the slide settles — focusing mid-transform makes the keyboard
    // fight the animation.
    window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };
  useEffect(() => {
    if (window.location.hash !== "#company-name") return;
    const t = window.setTimeout(() => openIdentity(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens
  }, []);

  const submitIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    const badName = !name;
    const badEmail = !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    setNameErr(badName);
    setEmailErr(badEmail);
    if (badName || badEmail) {
      // Focus the FIRST offending field, not always the first field — landing
      // on a valid input while the error sits below it is the classic form trap.
      (badName ? nameRef : emailRef).current?.focus();
      return;
    }
    const next: Identity = {
      name,
      email,
      phone: form.phone.trim(),
      site: form.site.trim(),
      addr: form.addr.trim(),
    };
    setIdentity(next);
    // Branding and Lead matching edit the SAME two Organization columns
    // (address, phone) — keep the pair of cards in step, like the desktop's
    // mirrorField, so the sheet never shows two values for one column.
    setLead({ addr: next.addr, phone: next.phone });
    setIdentityOpen(false);
    // Same field mapping as the desktop's saveBranding().
    saveIdentity.run(
      () =>
        updateBranding({
          name: next.name,
          billingEmail: orNull(next.email),
          phone: orNull(next.phone),
          website: orNull(next.site),
          address: orNull(next.addr),
          primaryColor: color,
        }),
      0,
    );
    setLanded("identity");
  };

  /* No "Remove from log" row: ActivityEvent has no delete action and the
     desktop feed is read-only — the audit trail is not editable. */
  const menuRows = useMemo<MenuRow[]>(() => {
    const e = sheetEntry;
    if (!e) return [];
    return [
      {
        act: "open",
        icon: "i-file",
        tone: styles.miBp,
        title: "Open record",
        // A team / system event has no proposal, job or lead behind it, so
        // there is nothing to open.
        sub: hasRecord(e) ? `${metaType(e.meta)} · full history` : "Team change — no record to open",
        disabled: !hasRecord(e),
      },
      { act: "msg", icon: "i-msg", tone: styles.miSky, title: `Message ${e.actor}`, sub: "Ask about this update" },
      {
        act: "only",
        icon: "i-user",
        tone: styles.miOk,
        title: `Show only ${e.actor}`,
        // A client-side / system event carries no membership to filter on.
        sub: e.actorId ? "Filter the log to this person" : "No team member behind this update",
        disabled: !e.actorId,
      },
      { act: "copy", icon: "i-copy", title: "Copy update", sub: "Summary and reference as text" },
    ];
  }, [sheetEntry]);

  const runMenu = (act: string) => {
    const e = sheetEntry;
    setSheetId(null);
    if (!e) return;
    if (act === "only") {
      if (!e.actorId) return;
      setActPerson(e.actorId);
      setActPage(1);
      setLanded(e.id);
    } else if (act === "copy") {
      copyText(`${e.actor} ${plainSummary(e.summary)} — ${e.meta} (${e.day}, ${e.time})`);
    }
  };

  const anyOverlay = Boolean(sheetEntry) || identityOpen;

  // Swipe-down dismissal, one gesture per sheet, on the same setters the
  // Escape ladder uses.
  const actionsDrag = useSheetDrag(Boolean(sheetEntry), () => setSheetId(null));
  const identityDrag = useSheetDrag(identityOpen, () => setIdentityOpen(false));

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
            <div className={styles.kicker}>Account</div>
            <h1 className={styles.pageTitle}>Company</h1>
            <div className={styles.pageActions}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={openIdentity}>
                <Icon id="i-building" />
                Edit identity
              </button>
              <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={copyDetails}>
                <Icon id={copied ? "i-check" : "i-copy"} />
                {copied ? "Copied" : "Copy details"}
              </button>
            </div>
          </div>

          {/* MASTHEAD — one numeral, a mono kicker, EXACTLY two annotations.
              All three are real: the log count, the roster size, and the
              org's trades over the canonical taxonomy. */}
          <div className={styles.omast}>
            <div className={styles.omastTop}>
              <div className={styles.omastLbl}>
                Team updates
                <span className={styles.omastRule} />
              </div>
              <CountUp value={activity.length} className={styles.omastVal} />
            </div>
            <div className={styles.omastCnt}>
              <div className={styles.omastSub}>
                <div className={styles.omastSubL}>Crew</div>
                <div className={styles.omastSubV}>{members.length}</div>
              </div>
              <div className={styles.omastSub}>
                <div className={styles.omastSubL}>Trades</div>
                <div className={styles.omastSubV}>
                  {trades.length}/{TRADE_TYPES.length}
                </div>
              </div>
            </div>
          </div>

          {/* TABS — four sections, sliding blueprint rule */}
          <div className={styles.tabs}>
            <span className={styles.tabInd} style={{ transform: `translateX(${tabIndex * 100}%)` }} />
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`${styles.tab} ${tab === t.key ? styles.active : ""}`}
                type="button"
                aria-current={tab === t.key ? "page" : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ================= BRANDING ================= */}
          {tab === "branding" && (
            <>
              {/* IDENTITY — read summary; the fields live in the form sheet */}
              <div className={`${styles.card} ${landed === "identity" ? styles.landed : ""}`}>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitle}>Identity</div>
                  <button className={styles.cardEdit} type="button" onClick={openIdentity}>
                    <Icon id="i-file" />
                    Edit
                  </button>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.idList}>
                    {idRows.map((r) => (
                      <div className={styles.idRow} key={r.k}>
                        <span className={styles.idLbl}>{r.k}</span>
                        <span className={`${styles.idVal} ${r.v ? "" : styles.isEmpty}`}>
                          {r.v || "Not set"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <SaveLine state={saveIdentity.state} error={saveIdentity.error} />
              </div>

              {/* BRAND — colour, logo, live preview. Zoned white → beige →
                  white, the house card pattern. */}
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitle}>Brand</div>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.zoneLbl}>Brand color</div>
                  <div className={styles.swatches} data-tour="branding:color">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        className={`${styles.sw} ${color.toLowerCase() === c.toLowerCase() ? styles.on : ""}`}
                        type="button"
                        style={{ background: c }}
                        aria-label={`Pick color ${c}`}
                        aria-pressed={color.toLowerCase() === c.toLowerCase()}
                        onClick={() => pickColor(c)}
                      />
                    ))}
                  </div>
                  <input
                    className={styles.hex}
                    value={hex}
                    aria-label="Brand color hex"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(ev) => onHex(ev.target.value)}
                  />
                </div>

                <div className={styles.zoneBeige} id="logo">
                  <div className={styles.zoneLbl}>Logo</div>
                  {/* Real upload, desktop's rule (lib/logoClient): PNG, JPG,
                      WebP or SVG up to 15 MB, shrunk in the browser to
                      ≤1024 px and under 1 MB, then the optimistic swap with
                      rollback through the same updateBranding write. Busy
                      until saved; a second pick meanwhile is ignored. */}
                  <input
                    ref={logoFileRef}
                    className={styles.srOnlyInput ?? ""}
                    style={{ display: "none" }}
                    type="file"
                    accept={LOGO_ACCEPT}
                    onChange={(ev) => {
                      const file = ev.target.files?.[0];
                      ev.target.value = "";
                      if (!file || logoBusyRef.current) return;
                      logoBusyRef.current = true;
                      setLogoBusy(true);
                      saveBrand.run(async () => {
                        try {
                          let dataUrl: string;
                          try {
                            dataUrl = await prepareLogo(file);
                          } catch (err) {
                            throw new Error(
                              err instanceof LogoFileError ? err.message : "Couldn’t read that file.",
                            );
                          }
                          const previous = logoUrl;
                          setLogoUrl(dataUrl);
                          try {
                            await updateBranding({ logoUrl: dataUrl });
                          } catch (err) {
                            setLogoUrl(previous);
                            throw err;
                          }
                        } finally {
                          logoBusyRef.current = false;
                          setLogoBusy(false);
                        }
                      }, 0);
                    }}
                  />
                  <button
                    className={`${styles.logoDrop}${logoBusy ? ` ${styles.busy}` : ""}`}
                    data-tour="branding:logo"
                    type="button"
                    aria-busy={logoBusy}
                    onClick={() => {
                      if (!logoBusyRef.current) logoFileRef.current?.click();
                    }}
                  >
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- may be a data: URL
                      <img className={styles.logoImg} src={logoUrl} alt="Company logo" />
                    ) : (
                      <>
                        <Icon id="i-imgplus" />
                        <span className={styles.logoT}>Tap to upload</span>
                        <span className={styles.logoH}>{LOGO_HINT}</span>
                      </>
                    )}
                  </button>
                  {logoUrl ? (
                    <div className={styles.logoActs}>
                      <button
                        className={`${styles.btn} ${styles.btnGhost}`}
                        type="button"
                        disabled={logoBusy}
                        onClick={() => {
                          if (!logoBusyRef.current) logoFileRef.current?.click();
                        }}
                      >
                        Replace
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnGhost} ${styles.logoRemove}${removeArmed ? ` ${styles.armed}` : ""}`}
                        type="button"
                        disabled={logoBusy}
                        onClick={() => {
                          if (logoBusyRef.current) return;
                          if (!removeArmed) {
                            setRemoveArmed(true);
                            return;
                          }
                          setRemoveArmed(false);
                          logoBusyRef.current = true;
                          setLogoBusy(true);
                          saveBrand.run(async () => {
                            const previous = logoUrl;
                            setLogoUrl(null);
                            try {
                              await updateBranding({ logoUrl: null });
                            } catch (err) {
                              setLogoUrl(previous);
                              throw err;
                            } finally {
                              logoBusyRef.current = false;
                              setLogoBusy(false);
                            }
                          }, 0);
                        }}
                      >
                        {removeArmed ? "Tap again to remove" : "Remove logo"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.zoneLbl}>
                    Live preview
                    <span className={styles.zoneHint}>Email header</span>
                  </div>
                  {/* The brand colour is a user value, not a design token, so it
                      is the one thing carried inline. */}
                  <div className={styles.mailPrev} style={{ borderLeftColor: color }}>
                    <span className={styles.mailMark} style={{ background: color }}>
                      {previewName.charAt(0).toUpperCase()}
                    </span>
                    <span className={styles.mailTxt}>
                      <span className={styles.mailName}>{previewName}</span>
                      <span className={styles.mailSub}>{previewSub}</span>
                    </span>
                  </div>
                </div>
                <SaveLine
                  state={saveBrand.state}
                  error={saveBrand.error}
                  idle="Autosaves as you edit"
                />
              </div>

              {/* LEAD MATCHING */}
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitle}>Lead matching</div>
                  <span
                    className={`${styles.leadState} ${leadReady ? styles.leadOk : styles.leadWait}`}
                  >
                    {leadLabel}
                  </span>
                </div>
                <div className={styles.cardBody}>
                  {/* No pin, trades picked, toggle on: say what is missing and
                      put the caret in the field that fixes it. A badge that
                      only reads "Matching off" leaves the owner hunting. */}
                  {leadsOn && trades.length > 0 && !geocoded ? (
                    <button
                      className={styles.leadHint}
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("mcoLeadAddr");
                        el?.scrollIntoView({ block: "center", behavior: "smooth" });
                        (el as HTMLInputElement | null)?.focus();
                      }}
                    >
                      Homeowner leads can&apos;t reach you yet — add your business address
                    </button>
                  ) : null}
                  <div className={styles.fld}>
                    <label className={styles.fldLbl} htmlFor="mcoLeadAddr">
                      Business address
                    </label>
                    <input
                      className={styles.pinput}
                      id="mcoLeadAddr"
                      data-tour="profile:lead-address"
                      type="text"
                      placeholder="Street, city, state, zip"
                      autoComplete="off"
                      value={lead.addr}
                      onChange={(ev) => {
                        const addr = ev.target.value;
                        setLead((l) => ({ ...l, addr }));
                        // Same column as the identity card's address — mirror it.
                        setIdentity((i) => ({ ...i, addr }));
                        // Desktop's saveLead() sends all four fields together.
                        pushLead({
                          address: orNull(addr.trim()),
                          phone: orNull(lead.phone.trim()),
                          tradeTypes: trades,
                          leadOffersEnabled: leadsOn,
                        });
                      }}
                    />
                  </div>
                  <div className={styles.fld}>
                    <label className={styles.fldLbl} htmlFor="mcoLeadPhone">
                      Phone for lead alerts
                    </label>
                    <input
                      className={styles.pinput}
                      id="mcoLeadPhone"
                      type="tel"
                      autoComplete="off"
                      value={lead.phone}
                      onChange={(ev) => {
                        const phone = ev.target.value;
                        setLead((l) => ({ ...l, phone }));
                        // Same column as the identity card's phone — mirror it.
                        setIdentity((i) => ({ ...i, phone }));
                        pushLead({
                          address: orNull(lead.addr.trim()),
                          phone: orNull(phone.trim()),
                          tradeTypes: trades,
                          leadOffersEnabled: leadsOn,
                        });
                      }}
                    />
                  </div>
                  {/* Leads farther than this from the business address are
                      never offered (lib/leadCenter/matching). */}
                  <div className={styles.fld}>
                    <label className={styles.fldLbl} htmlFor="mcoLeadRadius">
                      Service radius, miles
                    </label>
                    <input
                      className={styles.pinput}
                      id="mcoLeadRadius"
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={500}
                      step={5}
                      value={radius}
                      onChange={(ev) => {
                        const next = ev.target.value;
                        setRadius(next);
                        const n = Number(next);
                        // 5–500 whole miles, or nothing sent yet.
                        if (Number.isInteger(n) && n >= 5 && n <= 500) pushLead({ serviceRadiusMiles: n });
                      }}
                    />
                  </div>
                </div>

                <div className={styles.zoneBeige}>
                  <div className={styles.zoneLbl}>
                    Trades you take
                    <span className={styles.zoneHint}>
                      {trades.length} of {TRADE_TYPES.length}
                    </span>
                  </div>
                  <div className={styles.trades} data-tour="profile:trades">
                    {TRADE_TYPES.map((t) => {
                      const on = trades.includes(t);
                      return (
                        <button
                          key={t}
                          className={`${styles.trade} ${on ? styles.on : ""}`}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleTrade(t)}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  className={styles.tgRow}
                  type="button"
                  aria-pressed={leadsOn}
                  onClick={() => {
                    const next = !leadsOn;
                    setLeadsOn(next);
                    // A toggle is a decision — single-field write, no debounce,
                    // exactly like the desktop's #leadToggle.
                    pushLead({ leadOffersEnabled: next }, 0);
                  }}
                >
                  <span className={styles.tgTxt}>
                    <span className={styles.tgT}>Accept platform leads</span>
                    <span className={styles.tgH}>
                      Turn off to pause new homeowner leads without losing your profile.
                    </span>
                  </span>
                  <span className={styles.tgl} />
                </button>
                <SaveLine
                  state={saveLead.state}
                  error={saveLead.error}
                  idle="Autosaves as you edit"
                />
              </div>
            </>
          )}

          {/* ================= TEAM ================= */}
          {tab === "team" && (
            <div className={styles.card}>
              <div className={styles.teamBody}>
                <div className={styles.teamIc}>
                  <Icon id="i-users" />
                </div>
                <div className={styles.teamT}>Team lives in the unified roster</div>
                <p className={styles.teamP}>
                  Crew, roles, invites and portal links are all managed on the Workers page.
                </p>
                <div className={styles.teamCrew}>
                  {members.map((m) => m.name).join(" · ") || "No crew yet"}
                </div>
                <button className={styles.teamAct} type="button" onClick={openWorkers}>
                  <Icon id={workersFlash ? "i-check" : "i-arrow"} />
                  {workersFlash ? "Opening" : "Open Workers"}
                </button>
              </div>
            </div>
          )}

          {/* ================= TEAM ACTIVITY ================= */}
          {tab === "activity" && (
            <div className={styles.find}>
              <label className={styles.srch}>
                <Icon id="i-search" />
                <input
                  className={styles.srchInput}
                  type="search"
                  value={actQuery}
                  placeholder="Search activity…"
                  autoComplete="off"
                  aria-label="Search activity"
                  onChange={(ev) => {
                    setActQuery(ev.target.value);
                    setActPage(1);
                  }}
                />
                {actQuery ? (
                  <button
                    className={styles.srchX}
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setActQuery("");
                      setActPage(1);
                    }}
                  >
                    <Icon id="i-x" />
                  </button>
                ) : null}
              </label>

              {/* Category filter — one dropdown, never the desktop chip rail */}
              <div className={`${styles.dd} ${catOpen ? styles.open : ""}`} ref={catRef}>
                <button
                  className={styles.ddBtn}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={catOpen}
                  onClick={() => {
                    setPersonOpen(false);
                    setCatOpen((v) => !v);
                  }}
                >
                  <Icon id="i-filter" />
                  Filter
                  <span className={`${styles.ddValue} ${actCat === ALL_CAT ? styles.isAll : ""}`}>
                    {catLabel(actCat)} · {catCount(activity, actCat)}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
                </button>
                <div className={styles.ddMenu} role="listbox">
                  {ACT_CATS.map((c) => (
                    <button
                      key={c.key}
                      className={`${styles.ddItem} ${actCat === c.key ? styles.active : ""}`}
                      type="button"
                      role="option"
                      aria-selected={actCat === c.key}
                      onClick={() => {
                        setActCat(c.key);
                        setActPage(1);
                        setCatOpen(false);
                      }}
                    >
                      {c.label}
                      <span className={styles.ddCount}>{catCount(activity, c.key)}</span>
                      {actCat === c.key ? <Icon id="i-check" /> : null}
                    </button>
                  ))}
                </div>
              </div>

              {/* Person filter — the desktop <select>, same construction as the
                  category dropdown so the panel reads as one control set */}
              <div className={`${styles.dd} ${personOpen ? styles.open : ""}`} ref={personRef}>
                <button
                  className={styles.ddBtn}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={personOpen}
                  onClick={() => {
                    setCatOpen(false);
                    setPersonOpen((v) => !v);
                  }}
                >
                  <Icon id="i-user" />
                  Person
                  <span
                    className={`${styles.ddValue} ${actPerson === EVERYONE ? styles.isAll : ""}`}
                  >
                    {personLabel(actPerson)} · {personCount(activity, actPerson)}
                  </span>
                  <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
                </button>
                <div className={styles.ddMenu} role="listbox">
                  {personOptions.map((m) => (
                    <button
                      key={m.id}
                      className={`${styles.ddItem} ${actPerson === m.id ? styles.active : ""}`}
                      type="button"
                      role="option"
                      aria-selected={actPerson === m.id}
                      onClick={() => {
                        setActPerson(m.id);
                        setActPage(1);
                        setPersonOpen(false);
                      }}
                    >
                      {m.name}
                      <span className={styles.ddCount}>{personCount(activity, m.id)}</span>
                      {actPerson === m.id ? <Icon id="i-check" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "activity" &&
            (visible.length === 0 ? (
              <div className={styles.empty}>
                {activity.length === 0 ? (
                  <>
                    <div className={styles.emptyT}>No activity yet</div>
                    <div className={styles.emptyS}>
                      Team actions show up here as they happen — proposals sent, jobs started,
                      leads claimed.
                    </div>
                    <button className={styles.emptyA} type="button" onClick={openWorkers}>
                      <Icon id={workersFlash ? "i-check" : "i-userplus"} />
                      {workersFlash ? "Opening" : "Invite the crew"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.emptyT}>No matches</div>
                    <div className={styles.emptyS}>
                      No update matches that search, category and person.
                    </div>
                    <button className={styles.emptyA} type="button" onClick={resetFilters}>
                      <Icon id="i-x" />
                      Clear filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className={styles.book}>
                {slice.map((e, i) => {
                  const showDay = i === 0 || slice[i - 1].day !== e.day;
                  const amount = metaAmount(e.meta);
                  const tone = toneKey(e.tone);
                  return (
                    <Fragment key={e.id}>
                      {showDay ? <div className={styles.aday}>{e.day}</div> : null}
                      <div
                        className={`${styles.arow} ${styles.rowIn} ${landed === e.id ? styles.landed : ""}`}
                        style={{ animationDelay: `${i * 45}ms` }}
                      >
                        {/* The mark (lib/team/who): the tile in the person's own
                            color, the same color they wear on every page; a
                            system or client row keeps the plain tile. */}
                        <span
                          className={`${styles.aav} ${e.actorId ? styles.aavWho : ""}`}
                          style={e.actorId && e.actorColor ? { background: e.actorColor, borderColor: e.actorColor } : undefined}
                        >
                          {monogram(e.actor)}
                          <span className={`${styles.abead} ${TONE_BEAD[tone]}`} />
                        </span>
                        <div className={styles.atxt}>
                          <b className={styles.aactor}>{e.actor}</b>
                          {e.actorId && e.actorRole ? (
                            <em className={styles.arole} style={e.actorColor ? { color: e.actorColor, borderColor: e.actorColor } : undefined}>
                              {roleLabel(e.actorRole)}
                            </em>
                          ) : null}{" "}
                          {summaryParts(e.summary).map((p, n) =>
                            p.bold ? <b key={n}>{p.text}</b> : <span key={n}>{p.text}</span>,
                          )}
                        </div>
                        <button
                          className={styles.arowOpen}
                          type="button"
                          aria-label={`Actions for ${e.actor}'s update`}
                          onClick={() => setSheetId(e.id)}
                        >
                          <Icon id="i-dots" />
                        </button>
                        {/* Rows 2 and 3 are one group: the mono annotation sits
                            tight above the badge + figure line, and the whole
                            group is pushed clear of the identity line. */}
                        {/* `time` is the event's time of day (the desktop
                            mapper's timeOfDay), not a relative age. */}
                        <div className={styles.ameta}>
                          {metaType(e.meta)} · {e.time}
                        </div>
                        <div className={styles.afoot}>
                          <span className={`${styles.badge} ${TONE_BADGE[tone]}`}>
                            {rowBadge(e)}
                          </span>
                          {/* No amount is an absence, not a zero — an em dash,
                              never "$0". */}
                          <span className={`${styles.amoney} ${amount ? "" : styles.isZero}`}>
                            {amount ? money(amount) : "—"}
                          </span>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            ))}

          {tab === "activity" && visible.length > PAGE_SIZE ? (
            <div className={styles.pager}>
              <button
                className={styles.pagerBtn}
                type="button"
                disabled={safePage <= 1}
                onClick={() => setActPage(Math.max(1, safePage - 1))}
              >
                <Icon id="i-chevl" />
                Prev
              </button>
              <button
                className={styles.pagerBtn}
                type="button"
                disabled={safePage >= pages}
                onClick={() => setActPage(Math.min(pages, safePage + 1))}
              >
                Next
                <Icon id="i-chevr" />
              </button>
              <span className={styles.pagerInfo}>
                {safePage} / {pages}
              </span>
            </div>
          ) : null}

          {/* ================= LANDING BUILDER ================= */}
          {tab === "landing" && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>Public profile</div>
                <span className={`${styles.leadState} ${styles.soonPill}`}>Soon</span>
              </div>
              <button
                className={styles.tgRow}
                type="button"
                aria-pressed={publicOn}
                onClick={() => {
                  const next = !publicOn;
                  setPublicOn(next);
                  // A toggle is a decision — single-field write, no debounce,
                  // exactly like the desktop's #publicToggle.
                  saveLanding.run(() => updateLanding({ publicProfileEnabled: next }), 0);
                }}
              >
                <span className={styles.tgTxt}>
                  <span className={styles.tgT}>Publish public profile</span>
                  <span className={styles.tgH}>
                    When on, your customizations below appear on the public form. When off, the
                    form falls back to JobFlex defaults.
                  </span>
                </span>
                <span className={styles.tgl} />
              </button>
              <div className={styles.cardBody}>
                <div className={styles.fld}>
                  <label className={styles.fldLbl} htmlFor="mcoHeroTitle">
                    Hero title
                  </label>
                  <input
                    className={styles.pinput}
                    id="mcoHeroTitle"
                    type="text"
                    placeholder={LANDING_PLACEHOLDERS.title}
                    autoComplete="off"
                    value={landing.title}
                    onChange={(ev) => {
                      const title = ev.target.value;
                      setLanding((l) => ({ ...l, title }));
                      // Desktop's saveLanding() sends the toggle + both fields.
                      saveLanding.run(() =>
                        updateLanding({
                          publicProfileEnabled: publicOn,
                          landingHeroTitle: orNull(title.trim()),
                          landingHeroSubtitle: orNull(landing.sub.trim()),
                        }),
                      );
                    }}
                  />
                </div>
                <div className={styles.fld}>
                  <label className={styles.fldLbl} htmlFor="mcoHeroSub">
                    Hero subtitle
                  </label>
                  <input
                    className={styles.pinput}
                    id="mcoHeroSub"
                    type="text"
                    placeholder={LANDING_PLACEHOLDERS.sub}
                    autoComplete="off"
                    value={landing.sub}
                    onChange={(ev) => {
                      const sub = ev.target.value;
                      setLanding((l) => ({ ...l, sub }));
                      saveLanding.run(() =>
                        updateLanding({
                          publicProfileEnabled: publicOn,
                          landingHeroTitle: orNull(landing.title.trim()),
                          landingHeroSubtitle: orNull(sub.trim()),
                        }),
                      );
                    }}
                  />
                  <span className={styles.fldHint}>
                    Both lines fall back to JobFlex defaults while the profile is unpublished.
                  </span>
                </div>
              </div>
              <SaveLine
                state={saveLanding.state}
                error={saveLanding.error}
                idle="Autosaves as you edit"
              />
            </div>
          )}
        </div>
      </main>

      {/* No floating action button: the primary actions live in the page head,
          so nothing needs to hover over the content. */}

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => {
          setSheetId(null);
          setIdentityOpen(false);
        }}
        aria-hidden="true"
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div
        className={`${styles.sheet} ${sheetEntry ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Activity actions"
        aria-hidden={!sheetEntry}
        {...actionsDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetEntry ? `${sheetEntry.meta} · ${sheetEntry.day}, ${sheetEntry.time}` : "Update · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetEntry?.actor ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
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
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetId(null)}>
          Cancel
        </button>
      </div>

      {/* ============ IDENTITY FORM SHEET ============ */}
      <div
        className={`${styles.sheet} ${identityOpen ? styles.on : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcoIdTitle"
        aria-hidden={!identityOpen}
        {...identityDrag.sheetProps}
      >
        <div className={styles.sheetGrab} {...identityDrag.handleProps} />
        <div className={styles.sheetHead} {...identityDrag.handleProps}>
          <div className={styles.sheetKicker}>Account / company record</div>
          <div className={styles.sheetTitle} id="mcoIdTitle">
            Identity
          </div>
        </div>
        <form
          className={`${styles.sheetBody} ${styles.formBody}`}
          id="mcoIdForm"
          noValidate
          onSubmit={submitIdentity}
        >
          <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mcoName">
              Company name<span className={styles.req}>*</span>
            </label>
            <input
              ref={nameRef}
              className={styles.pinput}
              id="mcoName"
              type="text"
              placeholder="Bell Roofing & Fence"
              autoComplete="off"
              value={form.name}
              aria-invalid={nameErr}
              aria-describedby={nameErr ? "mcoNameErr" : undefined}
              onChange={(ev) => {
                setForm((f) => ({ ...f, name: ev.target.value }));
                if (ev.target.value.trim()) setNameErr(false);
              }}
            />
            {nameErr ? (
              <span className={styles.fldErr} id="mcoNameErr">
                Enter the company name
              </span>
            ) : null}
            {nameUnset ? <CompanyNameNote inputId="mcoName" unset /> : null}
          </div>

          <div className={`${styles.fld} ${emailErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mcoEmail">
              Billing email<span className={styles.req}>*</span>
            </label>
            <input
              ref={emailRef}
              className={styles.pinput}
              id="mcoEmail"
              type="email"
              placeholder="billing@bellroofing.com"
              autoComplete="off"
              value={form.email}
              aria-invalid={emailErr}
              aria-describedby={emailErr ? "mcoEmailErr" : undefined}
              onChange={(ev) => {
                setForm((f) => ({ ...f, email: ev.target.value }));
                if (ev.target.value.trim()) setEmailErr(false);
              }}
            />
            {emailErr ? (
              <span className={styles.fldErr} id="mcoEmailErr">
                Enter a billing email we can send invoices to
              </span>
            ) : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcoPhone">
              Phone
            </label>
            <input
              className={styles.pinput}
              id="mcoPhone"
              type="tel"
              placeholder="(425) 555-0100"
              autoComplete="off"
              value={form.phone}
              onChange={(ev) => setForm((f) => ({ ...f, phone: ev.target.value }))}
            />
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcoSite">
              Website
            </label>
            <input
              className={styles.pinput}
              id="mcoSite"
              type="text"
              placeholder="bellroofing.com"
              autoComplete="off"
              value={form.site}
              onChange={(ev) => setForm((f) => ({ ...f, site: ev.target.value }))}
            />
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcoAddr">
              Address
            </label>
            <input
              className={styles.pinput}
              id="mcoAddr"
              type="text"
              placeholder="1180 Monroe Ave NE, Bothell, WA 98011"
              autoComplete="off"
              value={form.addr}
              onChange={(ev) => setForm((f) => ({ ...f, addr: ev.target.value }))}
            />
            <span className={styles.fldHint}>
              Printed on proposals and invoices, and used for the email header preview.
            </span>
          </div>
        </form>
        {/* The submit pair sits in a beige foot OUTSIDE the scrolling body and
            reaches the form with form=, so it is always in reach. */}
        <div className={styles.formFoot}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            onClick={() => setIdentityOpen(false)}
          >
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" form="mcoIdForm">
            <Icon id="i-check" />
            Save identity
          </button>
        </div>
      </div>
    </div>
  );
}
