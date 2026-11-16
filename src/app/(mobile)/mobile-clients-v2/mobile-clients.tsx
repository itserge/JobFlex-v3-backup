"use client";

// MOBILE CLIENTS (mobile-clients-v2) — Blueprint system, handheld build.
//
// Ported from the scratchpad donor jobflex-clients-mobile-blueprint.html.
// Tokens, palette, type scale and Motion System "Balanced" are the reference
// dashboard's; the shell (topbar / hamburger drawer / bottom sheets) is the
// same one as mobile-v2 and mobile-proposals-v2, so the three handheld
// surfaces are one product.
//
// Every component of the desktop clients sheet is covered:
//  · CRM head + the New-client action
//  · computed masthead — ONE numeral over ONE mono label, nothing else
//  · the tag chip rail, as one dropdown (plus VIP and Untagged)
//  · the 7-column table, re-cut as row cards with initials avatars
//  · VIP state, multi-tag rows, and the untagged case
//  · pager, and BOTH empty states (no clients / no matches)
//  · the "⋮" menu as a bottom sheet of tonal boxes
//  · the create-client modal as a bottom sheet, with required-field validation
//    and the drawn VIP toggle
//
// What changes versus the desktop sheet, and why:
//  · A search box is added. It is the one thing the desktop leaves to the
//    global topbar, and on a phone paging through a book to reach a named
//    client is the whole job. It filters the loaded book client-side — no
//    second endpoint.
//  · "Updated" is dropped from the row. It was noise on the proposals ledger
//    for the same reason and lives in the sheet instead.
//  · Page size 12 → 8: a handheld row is three lines tall.
//
// NO LONGER A FIXTURE. This file rendered an eighteen-row demo book — invented
// names, cities, proposal counts and pipeline totals — on the LIVE
// /dashboard/clients URL at ≤768px, and its sheet actions all dead-ended in
// local state. The book is now read by ./client-book.ts (the desktop page's
// query, org-scoped) and every action reaches a real effect: the record page,
// the estimator picker, the mail client, the maps app, and the same
// createClient / updateClient server actions the desktop dialog posts to.
//
// TWO SHEET ACTIONS WERE REMOVED rather than left drawing nothing. "Mark as
// VIP" had no data layer to write to — VIP is an org-scoped Tag that
// `createClient` can set on CREATE and `updateClient` has no path to, which is
// exactly why the desktop edit dialog hides its own VIP field — and "Delete
// client" had none either: there is no client delete or archive action
// anywhere in the app, and the desktop row menu offers no delete. Both are
// reported rather than faked.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./mobile-clients.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { lockScroll } from "@/lib/scrollLock";
import { createClient, updateClient } from "@/actions/clients";
import { clientChannels, messageClient, type ClientChannel } from "@/actions/clientMessage";
import { isPlanLimitFailure } from "@/lib/planLimits";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { loadClientBook } from "./client-book";
import { canImportClients } from "@/actions/dataImport";
import { AddToProjectSheet } from "@/components/v3/project-links/add-to-project-sheet";
import { openAddToProject } from "@/components/v3/project-links/open-add-to-project";
import { ensureCompanyName } from "@/components/company-name/company-name-gate";
import {
  ALL,
  PAGE_SIZE,
  VIP,
  allTags,
  initials,
  locationLabel,
  matchesQuery,
  matchesTag,
  tagCount,
  todayPlate,
  type Client,
} from "./clients-data";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Everything on file, for the maps handoff. The row's `address` is only the
 *  "City, ST" display line; a directions link built from that alone drives to
 *  the middle of the town. Empty when there is nothing to route to, which is
 *  what switches the action off. */
function fullAddress(c: Client): string {
  return [c.line1, c.city, c.state, c.zip].filter(Boolean).join(", ");
}

/* ---------- the message sheet's three ways out ------------------------
   Identical to the desktop record's (client-detail-blueprint/cd-dialogs.tsx),
   deliberately: one client, two channels and the same handoff links, so the
   contractor who wrote a follow-up on a laptop and the one who wrote it in a
   truck sent the same message through the same door. Where the desktop dialog
   BRANCHES on viewport, this build is the handheld branch — the Text channel
   always hands off to the phone's own messenger. */

/** Where the two gates send the reader. Both are real routes. */
const TEXTING_ROUTE = "/dashboard/texting" as Route;
const GMAIL_ROUTE = "/dashboard/settings/gmail" as Route;

/** Gmail's and Outlook's documented compose deep links. Everything is
 *  percent-encoded: a subject with an ampersand in it would otherwise start a
 *  new query parameter and truncate itself. */
function gmailCompose(to: string, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

function outlookCompose(to: string, subject: string, body: string): string {
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(
    to,
  )}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** `sms:` takes the number in the path and the text in the query. The stray
 *  `?&` is deliberate — it is the form iOS has always parsed, and Android
 *  ignores the empty first parameter. */
function smsLink(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
}

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

/** The action's own message where it wrote one ("Name is required", "Client not
 *  found"), a generic line for the transport failures that carry none. Same
 *  contract as the desktop dialog's `actionError`. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

const EMPTY_FORM = { name: "", email: "", phone: "", address: "", notes: "" };

export function MobileClients() {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // `null` is LOADING, not empty. The distinction is the whole point: an empty
  // array is a real answer ("no clients yet") and drawing that state while the
  // read is still in flight tells a contractor with two hundred clients that
  // their book is gone.
  const [data, setData] = useState<Client[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tag, setTag] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);

  /* ---- create / edit form ---- */
  const [form, setForm] = useState(EMPTY_FORM);
  /** The id being edited, or null for create. Drives the sheet's title, its
   *  button and which action the submit posts to. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [vipDraft, setVipDraft] = useState(false);
  const [nameErr, setNameErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /* ---- the sheet's busy plate -----------------------------------------
     Armed on a 300ms fuse, never shown outright. Two things can make the
     sheet unusable: it is opening and not yet typeable, or a write is still
     in flight over it. Anything that settles inside 300ms clears the fuse
     before it burns — which is every open on this surface and most saves —
     so a reader who never waited never sees a spinner. What it replaces is
     the frozen sheet: docked, blank and not yet answering, with nothing on
     it saying why. */
  const [busy, setBusy] = useState<string | null>(null);
  const busyFuse = useRef(0);
  const armBusy = useCallback((label: string) => {
    window.clearTimeout(busyFuse.current);
    busyFuse.current = window.setTimeout(() => setBusy(label), 300);
  }, []);
  useEffect(() => () => window.clearTimeout(busyFuse.current), []);
  // The sheet has painted, or it has gone away, or a write has settled. Any of
  // the three means nothing is waiting any more, so the fuse is pulled and the
  // plate comes down. The clear rides a frame callback rather than the effect
  // body — a bare setState in an effect is a cascading render, and the extra
  // frame is what makes this a measure of PAINT rather than of commit.
  useEffect(() => {
    if (saving) return;
    window.clearTimeout(busyFuse.current);
    const frame = window.requestAnimationFrame(() => setBusy(null));
    return () => window.cancelAnimationFrame(frame);
  }, [newOpen, saving]);

  const filterRef = useRef<HTMLDivElement>(null);

  // The Import button (bring a book over from another program) is the owner's, an admin's or a manager's; the
  // component is mounted without props on the live URL, so it asks.
  const [canImport, setCanImport] = useState(false);
  useEffect(() => {
    let live = true;
    canImportClients()
      .then((ok) => {
        if (live) setCanImport(ok);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /* ---- message sheet ---------------------------------------------------
     The desktop record's Message dialog, re-cut as a bottom sheet. Same two
     channels, same server reads, same gates — see the helper block at the top
     of this file. `msgId` is the client being written to, or null. */
  const [msgId, setMsgId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ClientChannel>("email");
  const [subject, setSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  /** What the server says about reaching this client: the two addresses on
   *  file, and whether this org can actually send on each channel. Read when
   *  the sheet opens rather than inferred from the row, because neither the
   *  Twilio line nor the connected Gmail is something the client book knows. */
  const [reach, setReach] = useState<{
    email: string | null;
    phone: string | null;
    smsConfigured: boolean;
    emailConfigured: boolean;
  } | null>(null);
  const [reachLoading, setReachLoading] = useState(false);

  /* ---------- the book -------------------------------------------------
     Read once on mount. The surface is mounted props-less from two entry
     points (its own route and responsive-dashboard-shell at ≤768px), so it
     cannot be handed a server component's data — it asks for it. */
  const reload = useCallback(async () => {
    try {
      const rows = await loadClientBook();
      setData(rows);
      setLoadErr(null);
    } catch (err) {
      setLoadErr(actionError(err));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadClientBook()
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
      styles.btn, styles.ddBtn, styles.ddItem, styles.pagerBtn, styles.cmenuItem,
      styles.sheetCancel, styles.crowOpen, styles.fchk,
      styles.cemptyA, styles.srchX, styles.msgChip,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);


  /* ---------- Esc closes whatever is topmost --------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (newOpen) setNewOpen(false);
      else if (msgId) setMsgId(null);
      else if (sheetId) setSheetId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, newOpen, msgId, sheetId]);

  /* ---------- Filter dropdown: close on outside tap -------------------- */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filterOpen]);

  /* ---------- Paging returns you to the top of the book ----------------
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

  /* ---------- derived -------------------------------------------------
     `book` is the loaded rows or an empty list. Every figure below is computed
     from it on this render — nothing about the book is stored twice. */
  const book = useMemo(() => data ?? [], [data]);
  const loading = data === null && loadErr === null;

  const visible = useMemo(
    () => book.filter((c) => matchesTag(c, tag) && matchesQuery(c, query)),
    [book, tag, query],
  );
  const pipeline = useMemo(() => book.reduce((a, c) => a + c.pipelineValue, 0), [book]);
  /* The masthead's sub-stat strip. All three are read off the same book as the
     figure above them and they RECONCILE with it: pipeline ÷ proposals is the
     average, so a reader who doubts one of the numbers can check it against
     the other two on the same plate. Zero proposals is a real state on a new
     book — the division is guarded rather than printing NaN. */
  const proposals = useMemo(() => book.reduce((a, c) => a + c.proposalCount, 0), [book]);
  const avgDeal = proposals ? pipeline / proposals : 0;

  /* The desktop rail's real labels, plus VIP — an account state the book holds
     and the one thing you look for by state on a phone. "Untagged" was dropped
     (owner's call): it is the absence of a label rather than a label, and on a
     book where most rows carry no tags it selects nearly everything, which
     makes it a second All rather than a filter. */
  const options = useMemo(
    () => [
      { k: ALL, l: "All clients" },
      { k: VIP, l: "VIP" },
      ...allTags(book).map((t) => ({ k: t, l: t })),
    ],
    [book],
  );
  const activeOption = options.find((o) => o.k === tag) ?? options[0];

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const sheetClient = sheetId === null ? null : (book.find((c) => c.id === sheetId) ?? null);

  const resetFilters = () => {
    setTag(ALL);
    setQuery("");
    setPage(1);
  };

  /* ---------- the record ------------------------------------------------
     The one destination this surface has. Client-side push: the destination is
     a blueprint page whose entrance cascade is armed from a layout effect, and
     a hard load replays it (see the `navigate` note in clients-behavior.ts).
     Reached from the card itself and from the sheet's first row — the same
     door, two handles. */
  const openRecord = useCallback(
    (id: string) => router.push(`/dashboard/client-detail?client=${encodeURIComponent(id)}` as Route),
    [router],
  );

  /* ---------- row sheet ------------------------------------------------
     Six actions, and every one of them reaches something real. The desktop
     row menu offers three (open / edit / message); the two extra here are the
     ones a phone is actually better at — starting a proposal on site, and
     driving to the address. */
  const menuRows = useMemo<MenuRow[]>(() => {
    const c = sheetClient;
    if (!c) return [];
    return [
      { act: "open", icon: "i-users", tone: styles.cmiBp, title: "Open client", sub: "Full record and history" },
      { act: "prop", icon: "i-file", tone: styles.cmiSky, title: "New proposal", sub: `Start one for ${c.name}` },
      // 2026-09-18: the client and their proposals into a project.
      { act: "proj", icon: "i-folder", tone: styles.cmiBp, title: "Add to project", sub: "New or existing, with their proposals" },
      // `i-user` and not `i-pen`: the handheld sprite (mobile-shell/sprite.tsx)
      // has no pen, and an edit box drawn with a missing symbol renders an
      // empty 24px square that reads as a broken icon.
      { act: "edit", icon: "i-user", title: "Edit client", sub: "Name, contact, location" },
      // MESSAGE, not "Send email". This used to be a `mailto:` — which on a
      // phone opens whatever mail app is registered, with nothing in it, and
      // leaves no trace on the client's file. It is now the record page's own
      // composer: two channels, the org's real send path, and an ActivityEvent
      // written against the client. Never disabled for want of an address —
      // the sheet says which channel is off and why, which a greyed row cannot.
      { act: "msg", icon: "i-mail", tone: styles.cmiOk, title: "Message",
        sub: c.email || c.phone || "No email or phone on file" },
      { act: "dir", icon: "i-pin", tone: styles.cmiWarn, title: "Get directions",
        sub: c.address ? `${c.address} — open in maps` : "No address on file",
        disabled: !fullAddress(c) },
    ];
  }, [sheetClient]);

  const runMenu = (act: string) => {
    const c = sheetClient;
    setSheetId(null);
    if (!c) return;
    if (act === "open") {
      openRecord(c.id);
    } else if (act === "prop") {
      // The estimator picker is mounted once in MobileNav and listens on the
      // document, exactly as it does in the desktop shell. The client rides
      // along, so whichever engine is chosen starts with them attached.
      //
      // Dispatched on the NEXT frame, not on this one. The sheet is closing on
      // the same click, and `.scrim`/`.sheet` play a 280ms exit over the top of
      // the picker — a dialog opened inside that pass comes up underneath the
      // outgoing scrim and reads as a click that did nothing.
      requestAnimationFrame(() => {
        document.dispatchEvent(
          new CustomEvent("jf:estimator-picker", { detail: { clientId: c.id, clientName: c.name } }),
        );
      });
    } else if (act === "proj") {
      // Next frame, for the same reason as "prop" above: this sheet is still
      // playing its exit.
      requestAnimationFrame(() => openAddToProject(c.id));
    } else if (act === "edit") {
      openForm(c);
    } else if (act === "msg") {
      openMessage(c);
    } else if (act === "dir") {
      const to = fullAddress(c);
      if (to) {
        // Platform-neutral: the maps query URL is what iOS, Android and a
        // desktop browser all resolve to their own maps app.
        window.open(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(to)}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
    }
  };

  /* ---------- message --------------------------------------------------
     Opening asks the server how this client can be reached. The answer decides
     which channel the sheet lands on and which gate it prints; until it comes
     back nothing is offered, because a composer that only fails after the
     message is typed is worse than one that says why before a word is. */
  const openMessage = (c: Client) => {
    setMsgId(c.id);
    // A first guess from the row so the chooser is not blank for the frame the
    // read takes; the server's answer replaces it below.
    setChannel(c.email ? "email" : "sms");
    setSubject("");
    setMsgBody("");
    setMsgErr(null);
    setSent(null);
    setReach(null);
    setReachLoading(true);
    clientChannels(c.id)
      .then((r) => {
        setReach(r);
        // Email leads when both work — it carries a subject and a paper trail;
        // a text is the answer for a client with no address on file.
        setChannel(r.email ? "email" : "sms");
      })
      .catch((err) => setMsgErr(actionError(err)))
      .finally(() => setReachLoading(false));
    // No autofocus. On a phone the keyboard would come up over the channel
    // chooser and the gate line under it — the two things the reader has to
    // see before typing anything.
  };

  const sendMessage = async () => {
    if (sending || !msgId) return;
    // The first message to a client names the business first (lib/orgName).
    if (!(await ensureCompanyName())) return;
    setSending(true);
    setMsgErr(null);
    try {
      const res = await messageClient({ clientId: msgId, channel, subject, body: msgBody });
      // The month's texts are used: the plan dialog says so (lib/sms/send).
      if (isPlanLimitFailure(res)) {
        reportPlanLimitResult(res);
        return;
      }
      // `delivered: false` means the transport is switched off in this
      // environment and the message went to a server log. Saying "Sent" there
      // would be a lie the contractor only discovers from the client.
      setSent(
        res.delivered
          ? `${res.channel === "email" ? "Emailed" : "Texted"} ${res.to}`
          : `Logged against the record — the ${res.channel === "email" ? "email" : "SMS"} transport is switched off in this environment, so nothing left the building.`,
      );
      setMsgBody("");
      setSubject("");
    } catch (err) {
      setMsgErr(actionError(err));
    } finally {
      setSending(false);
    }
  };

  /* ---------- create / edit form ---------------------------------------
     ONE sheet, two modes, because the two forms would otherwise be the same
     five fields written twice. `editingId` is the whole difference. */
  const openForm = (entry: Client | null) => {
    // Armed before the fill, cleared once the first field has focus — the
    // plate covers exactly the span in which the sheet is open and not yet
    // typeable, and on this surface that span is one frame.
    armBusy("Opening");
    setEditingId(entry?.id ?? null);
    setForm({
      name: entry?.name ?? "",
      email: entry?.email ?? "",
      phone: entry?.phone ?? "",
      // The record's own display line, so an untouched box round-trips the
      // columns behind it rather than rewriting them (see `locationParts`).
      address: entry?.address ?? "",
      // Filled from the record, so a save sends back what is on file. `notes`
      // is the one column an empty box would erase.
      notes: entry?.notes ?? "",
    });
    setVipDraft(false);
    setNameErr(false);
    setFormErr(null);
    setSaving(false);
    setNewOpen(true);
    // The fuse is NOT cleared here — clearing it on the same synchronous pass
    // that arms it would make the plate unreachable by construction. It is
    // cleared from an effect below, which runs after React has committed and
    // the browser has painted the docked sheet. That is the honest measure of
    // "open and usable": the span this covers is the render of a book that may
    // be hundreds of rows on a phone that is not a flagship.
    //
    // Focus after the slide settles — focusing mid-transform makes the
    // keyboard fight the animation.
    window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  const openNew = () => openForm(null);

  /**
   * The handheld form has ONE Location box; the database has address / city /
   * state / zip and `updateClient` writes all four. Left untouched, the box
   * hands the record's own columns straight back, so the street line and zip
   * survive an edit made here. Retyped, it is read as "City, ST". Identical
   * rule to the desktop dialog — the two forms must not disagree about what a
   * location string means.
   */
  const locationParts = (entry: Client | null, value: string) => {
    const v = value.trim();
    if (entry && v === (entry.address || "")) {
      return {
        address: entry.line1 || "",
        city: entry.city || "",
        state: entry.state || "",
        zip: entry.zip || "",
      };
    }
    const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      address: entry?.line1 || "",
      city: parts[0] || "",
      state: parts.length > 1 ? parts.slice(1).join(", ") : "",
      zip: entry?.zip || "",
    };
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }
    const entry = editingId ? (book.find((c) => c.id === editingId) ?? null) : null;
    const notes = form.notes.trim();
    const payload = {
      name,
      email: form.email.trim(),
      phone: form.phone.trim(),
      notes,
      ...locationParts(entry, form.address),
    };

    setFormErr(null);
    setSaving(true);
    armBusy(editingId ? "Saving" : "Creating");
    try {
      if (editingId) {
        const saved = await updateClient(editingId, payload);
        // One record changed, so one row is patched from what the write
        // returned — a reload reads the same values back.
        setData((prev) =>
          (prev ?? []).map((c) =>
            c.id === editingId
              ? {
                  ...c,
                  name: saved.name,
                  email: saved.email,
                  phone: saved.phone,
                  line1: saved.address,
                  city: saved.city,
                  state: saved.state,
                  zip: saved.zip,
                  address: locationLabel(saved),
                  // `notes` is not in the action's returned shape, so the card
                  // keeps what was just sent — the same value the next server
                  // read hands back.
                  notes: notes || null,
                  updated: todayPlate(),
                }
              : c,
          ),
        );
        setNewOpen(false);
        setLandedId(editingId);
      } else {
        const created = await createClient({ ...payload, vip: vipDraft });
        setData((prev) => [
          {
            id: created.id,
            name: created.name,
            email: created.email,
            address: locationLabel(created),
            proposalCount: 0,
            pipelineValue: 0,
            vip: vipDraft,
            // Tags are an org-scoped join table with no write path in
            // src/actions/clients.ts beyond the VIP flag above, so a new
            // record starts untagged rather than pretending to carry labels.
            tags: [],
            updated: todayPlate(),
            phone: created.phone,
            line1: created.address,
            city: created.city,
            state: created.state,
            zip: created.zip,
            notes: notes || null,
          },
          ...(prev ?? []),
        ]);
        // Drop back to All so a client created under an active tag filter is
        // actually visible — they land in the first row.
        resetFilters();
        setNewOpen(false);
        setLandedId(created.id);
      }
    } catch (err) {
      setFormErr(actionError(err));
    } finally {
      setSaving(false);
    }
  };

  /* ---------- what the message sheet can do -----------------------------
     Split into "is there an address at all" and "can this app do the sending".
     The first kills the composer — there is nowhere to type to. The second only
     kills Send, because the handoff routes below need no integration.

     This is the HANDHELD half of the desktop dialog's branch: the Text channel
     always leaves the app for the phone's own messenger, so it does not care
     whether the org rents a Twilio number. Email in-app still needs a connected
     Gmail; without one the Gmail / Outlook draft links are the way out. */
  const msgClient = msgId === null ? null : (book.find((c) => c.id === msgId) ?? null);
  const msgEmail = reach?.email ?? "";
  const msgPhone = reach?.phone ?? "";
  const composerOff = channel === "email" ? !!reach && !reach.email : !!reach && !reach.phone;
  const canSendEmail = !!reach?.email && !!reach.emailConfigured;
  const canSendText = !!reach?.phone;
  const subjectLine = subject.trim() || "A message about your project";

  const closeMessage = () => setMsgId(null);

  const anyOverlay = Boolean(sheetClient) || newOpen || Boolean(msgClient);

  // Swipe-down dismissal. Each sheet gets its own gesture bound to the same
  // close path Cancel and the scrim already use, so nothing else changes.
  const actionsDrag = useSheetDrag(Boolean(sheetClient), () => setSheetId(null));
  const newDrag = useSheetDrag(newOpen, () => setNewOpen(false));
  const msgDrag = useSheetDrag(Boolean(msgClient), closeMessage);

  return (
    <div className={styles.app} onClick={onRootClick}>

      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, so the page holds none. */}
      <MobileNav />
      <AddToProjectSheet />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD
              No eyebrow. The "CRM" kicker named the SECTION above a title that
              already says what the page is, and on a 390px head that is a line
              of type spent restating the drawer item you tapped to get here. */}
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>Clients</h1>
            <div className={styles.pageActions}>
              {canImport ? (
                // Moving from Housecall Pro, Jobber, ServiceTitan or a spreadsheet (2026-11-16).
                <Link className={`${styles.btn} ${styles.btnGhost}`} href={"/dashboard/clients/import" as Route} data-clients-import>
                  Import
                </Link>
              ) : null}
              <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={openNew}>
                <Icon id="i-plus" />New client
              </button>
            </div>
          </div>

          {/* MASTHEAD — ONE FIGURE, ONE LABEL, THREE ANNOTATIONS.
              The figure and the single mono label under it say what the money
              IS; the recessed strip beneath says what it is made of. Only ONE
              caption sits on the numeral — the band's earlier version also
              carried a kicker ABOVE it, which captioned the same number twice
              and cost a row of the fold to do it.
              The strip is the house sub-stat table (the same plate as
              mobile-proposals-v2's masthead): ink rule on top, 1.5px verticals,
              mono caps over a heavy tabular numeral, on the recessed ground. */}
          <div className={styles.cmast}>
            <div className={styles.cmastTop}>
              <CountUp value={pipeline} className={styles.cmastVal} />
              <div className={styles.cmastLbl}>Client pipeline</div>
            </div>
            <div className={styles.cmastCnt}>
              <div className={styles.cmastSub}>
                <div className={styles.cmastSubL}>Clients</div>
                <div className={styles.cmastSubV}>{book.length}</div>
              </div>
              <div className={styles.cmastSub}>
                <div className={styles.cmastSubL}>Proposals</div>
                <div className={styles.cmastSubV}>{proposals}</div>
              </div>
              <div className={styles.cmastSub}>
                <div className={styles.cmastSubL}>Avg deal</div>
                <div className={styles.cmastSubV}>{money(avgDeal)}</div>
              </div>
            </div>
          </div>

          {/* FIND BAR — search + tag filter */}
          <div className={styles.find}>
            <label className={styles.srch}>
              <Icon id="i-search" />
              <input
                className={styles.srchInput}
                type="search"
                value={query}
                placeholder="Search name, city or tag…"
                autoComplete="off"
                aria-label="Search clients"
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
                <span className={`${styles.ddValue} ${tag === ALL ? styles.isAll : ""}`}>
                  {activeOption.l} · {tagCount(book, tag)}
                </span>
                <Icon id="i-chev" className={`${styles.ic} ${styles.ddCaret}`} />
              </button>
              {/* THE MENU IS A DRAWN TABLE, AND A TABLE NEEDS TO KNOW HOW WIDE
                  IT IS. The fleet's filter menus are a flat 3-column grid,
                  which is right for the six-to-nine fixed options they carry.
                  This one's option list is DATA — All, VIP, then one cell per
                  org tag — so on a book with no tags it is two options, and two
                  options in a 3-column grid draw a 119px cell beside a 238px
                  one (the ragged-edge span rule hands the last cell the rest of
                  the row). That is the lopsided panel. The column count follows
                  the options instead, capped at the fleet's three. */}
              <div className={styles.ddMenu} role="listbox" data-cols={Math.min(3, options.length)}>
                {options.map((o) => (
                  <button key={o.k} className={`${styles.ddItem} ${tag === o.k ? styles.active : ""}`}
                    type="button" role="option" aria-selected={tag === o.k}
                    onClick={() => { setTag(o.k); setPage(1); setFilterOpen(false); }}>
                    {o.l}
                    <span className={styles.ddCount}>{tagCount(book, o.k)}</span>
                    {tag === o.k ? <Icon id="i-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CLIENT BOOK
              Four states, in the order they can occur: the read is in flight,
              the read failed, the book is genuinely empty, the filters match
              nothing. The first two used to be impossible because the page
              could not fail — it rendered a constant. */}
          {loadErr ? (
            <div className={styles.cempty}>
              <div className={styles.cemptyT}>Couldn&rsquo;t load your clients</div>
              <div className={styles.cemptyS}>{loadErr}</div>
              <button
                className={styles.cemptyA}
                type="button"
                onClick={() => {
                  setLoadErr(null);
                  void reload();
                }}
              >
                <Icon id="i-rotate" />Try again
              </button>
            </div>
          ) : loading ? (
            <div className={styles.cempty}>
              <div className={styles.cemptyT}>Loading your client book…</div>
              <div className={styles.cemptyS}>Reading the records on file for your company.</div>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.cempty}>
              {book.length === 0 ? (
                <>
                  <div className={styles.cemptyT}>No clients yet</div>
                  <div className={styles.cemptyS}>
                    Send your first proposal and a client is created automatically.
                  </div>
                  <button className={styles.cemptyA} type="button" onClick={openNew}>
                    <Icon id="i-plus" />New client
                  </button>
                </>
              ) : (
                <>
                  <div className={styles.cemptyT}>No matches</div>
                  <div className={styles.cemptyS}>No client matches that search and filter.</div>
                  <button className={styles.cemptyA} type="button" onClick={resetFilters}>
                    <Icon id="i-x" />Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.book}>
              {slice.map((c, i) => (
                <div
                  key={c.id}
                  className={`${styles.crow} ${styles.rowIn} ${landedId === c.id ? styles.landed : ""}`}
                  style={{ animationDelay: `${i * 45}ms` }}
                  /* THE CARD IS THE DOOR. It used to be inert: the only tap
                     target on a row was the ⋮ button, so a reader who tapped
                     the client — which is what a row-shaped object asks for —
                     got nothing at all, and the record page was two taps and a
                     menu away. `role`/`tabIndex`/`onKeyDown` rather than a
                     <button>: the row already contains a button, and a button
                     inside a button is invalid HTML that Safari resolves by
                     dropping one of them. */
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${c.name}`}
                  onClick={() => openRecord(c.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    openRecord(c.id);
                  }}
                >
                  <span className={`${styles.cav} ${c.vip ? styles.isVip : ""}`}>{initials(c.name)}</span>
                  {/* `title` keeps the tail of a clamped name reachable — the
                      card cuts at two lines (see .cname), and the whole record
                      is one tap away either way. */}
                  <div className={styles.cname} title={c.name}>{c.name}</div>
                  {/* `stopPropagation`: the ⋮ sits inside the card's own tap
                      target, and without it opening the menu would also open
                      the record underneath it. */}
                  <button className={styles.crowOpen} type="button"
                    aria-label={`Actions for ${c.name}`}
                    onClick={(e) => { e.stopPropagation(); setSheetId(c.id); }}>
                    <Icon id="i-dots" />
                  </button>
                  <div className={styles.cwhere} title={c.address}>{c.address}</div>
                  <div className={styles.crowFoot}>
                    {/* THE LEFT GROUP IS WHAT KIND OF CLIENT, the right is what
                        they are worth.
                        No "NO TAGS" plate any more: a dashed chip announcing
                        the absence of a label is a label, and on a book where
                        most rows carry none it was the most repeated object on
                        the page. The count takes the slot instead — a fact
                        about the record rather than a hole where a fact would
                        go — and it is a mono ANNOTATION, not a second plate, so
                        the row's only figure-weight type stays the money. */}
                    <span className={styles.crowTags}>
                      {c.vip ? <span className={`${styles.tag} ${styles.isVip}`}>VIP</span> : null}
                      {c.tags.map((t) => (
                        <span className={styles.tag} key={t}>{t}</span>
                      ))}
                      <span className={styles.cprop}>
                        {c.proposalCount} {c.proposalCount === 1 ? "proposal" : "proposals"}
                      </span>
                    </span>
                    <span className={styles.crowFigs}>
                      <span className={`${styles.cpipe} ${c.pipelineValue ? "" : styles.isZero}`}>
                        {c.pipelineValue ? money(c.pipelineValue) : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
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
        onClick={() => { setSheetId(null); setNewOpen(false); setMsgId(null); }}
        aria-hidden="true"
      />

      {/* ============ ROW ACTIONS SHEET ============ */}
      <div className={`${styles.sheet} ${sheetClient ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Client actions" aria-hidden={!sheetClient} {...actionsDrag.sheetProps}>
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          {/* `1 proposal`, not `1 proposals`. The card under this sheet counts
              the same records and reads them out in the same words, and one of
              the two saying it wrong is worse than either saying it alone. */}
          <div className={styles.sheetKicker}>
            {sheetClient
              ? `${sheetClient.proposalCount} ${sheetClient.proposalCount === 1 ? "proposal" : "proposals"} · ${sheetClient.pipelineValue ? money(sheetClient.pipelineValue) : "nothing open"} · upd ${sheetClient.updated}`
              : "Client · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetClient?.name ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {menuRows.map((r) => (
            <button key={r.act} type="button" disabled={r.disabled}
              className={`${styles.cmenuItem} ${r.danger ? styles.cmenuItemDanger : ""}`}
              onClick={() => runMenu(r.act)}>
              <span className={`${styles.cmiIc} ${r.tone ?? ""}`}><Icon id={r.icon} /></span>
              <span>
                <span className={styles.cmenuItemT}>{r.title}</span>
                <span className={styles.cmenuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetId(null)}>Cancel</button>
      </div>

      {/* ============ CREATE / EDIT SHEET ============ */}
      <div className={`${styles.sheet} ${newOpen ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="mcNewTitle" aria-hidden={!newOpen} {...newDrag.sheetProps}>
        <div className={styles.sheetGrab} {...newDrag.handleProps} />
        <div className={styles.sheetHead} {...newDrag.handleProps}>
          <div className={styles.sheetKicker}>{editingId ? "CRM / edit record" : "CRM / new record"}</div>
          <div className={styles.sheetTitle} id="mcNewTitle">{editingId ? "Edit client" : "New client"}</div>
        </div>
        <form className={`${styles.sheetBody} ${styles.formBody}`} id="mcNewForm" noValidate onSubmit={submitForm}>
          <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="mcName">
              Client name<span className={styles.req}>*</span>
            </label>
            {/* 120 is the action's own cap (`z.string().max(120)`), enforced
                where the reader can see it. Without it a longer name reaches
                the server, is refused there, and the refusal arrives as a raw
                Zod dump in the error line. `maxLength` covers paste too, which
                is how a name that long gets into a field at all. */}
            <input ref={nameRef} className={styles.pinput} id="mcName" name="name" type="text"
              maxLength={120}
              placeholder="D. Reyes" autoComplete="off" value={form.name}
              aria-invalid={nameErr} aria-describedby={nameErr ? "mcNameErr" : undefined}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                if (e.target.value.trim()) setNameErr(false);
              }} />
            {nameErr ? <span className={styles.fldErr} id="mcNameErr">Enter a client name</span> : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcEmail">Email</label>
            <input className={styles.pinput} id="mcEmail" name="email" type="email"
              placeholder="d.reyes@mail.com" autoComplete="off" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>

          {/* Phone stands where the donor put a free-text Tags box. Tags are a
              separate org-scoped table (Tag / ClientTag) with no write path in
              src/actions/clients.ts, so that box could only ever swallow what
              was typed into it. Phone is a real Client column both actions
              write — and it is what makes a call from a phone possible. */}
          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcPhone">Phone</label>
            <input className={styles.pinput} id="mcPhone" name="phone" type="tel"
              placeholder="(425) 555-0134" autoComplete="off" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcAddress">Location</label>
            <input className={styles.pinput} id="mcAddress" name="address" type="text"
              placeholder="Kirkland, WA" autoComplete="off" value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            <span className={styles.fldHint}>
              City, state — the Location line and the address on their proposals.
            </span>
          </div>

          {/* Notes writes `Client.notes`, a real column both actions carry. It
              is the ONE field whose absence is not an erase: the action's
              schema hands an omitted key back as `undefined`, so a form that
              never shows the box leaves what is on file alone. This one shows
              it, so it round-trips. */}
          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="mcNotes">Notes</label>
            <textarea className={`${styles.pinput} ${styles.ptextarea}`} id="mcNotes" name="notes"
              rows={3} placeholder="Gate code, access hours, who to ask for on site…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <span className={styles.fldHint}>Internal — never printed on a proposal.</span>
          </div>

          {/* VIP is an org Tag that `createClient` sets on CREATE and
              `updateClient` has no path to, so the toggle is hidden in edit
              mode rather than shown doing nothing. Same rule as the desktop
              dialog's `cfVipFld`. */}
          {editingId ? null : (
            <div className={styles.fld}>
              <span className={styles.fldLbl}>Account</span>
              <button className={styles.fchk} type="button" aria-pressed={vipDraft}
                onClick={() => setVipDraft((v) => !v)}>
                <span className={styles.fchkBox}><Icon id="i-check" /></span>
                Mark as VIP
                <span className={styles.fchkSub}>priority</span>
              </button>
            </div>
          )}

          {/* createClient / updateClient reject with messages written for the
              reader ("Name is required", "Client not found"). They land here
              rather than the sheet closing on a write that never happened. */}
          {formErr ? <span className={styles.fldErr} role="alert">{formErr}</span> : null}
        </form>
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
            disabled={saving} onClick={() => setNewOpen(false)}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" form="mcNewForm"
            disabled={saving}>
            <Icon id="i-check" />
            {saving
              ? editingId ? "Saving…" : "Creating…"
              : editingId ? "Save changes" : "Create client"}
          </button>
        </div>

        {/* The house busy widget — the pulsing blueprint SQUARE the system uses
            in place of a round spinner. Only ever mounted once the 300ms fuse
            has burned, so a fast open and a fast save never paint it. */}
        {busy ? (
          <div className={styles.sheetBusy} role="status" aria-live="polite">
            <span className={styles.sheetBusyDot} aria-hidden="true" />
            {busy}
          </div>
        ) : null}
      </div>

      {/* ============ MESSAGE SHEET ============
          The desktop record's Message dialog, in the house sheet frame. Same
          server actions, same gates, same handoff links — see the helper block
          at the top of this file for why the two must not diverge. */}
      <div className={`${styles.sheet} ${msgClient ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="mcMsgTitle" aria-hidden={!msgClient} {...msgDrag.sheetProps}>
        <div className={styles.sheetGrab} {...msgDrag.handleProps} />
        <div className={styles.sheetHead} {...msgDrag.handleProps}>
          <div className={styles.sheetKicker}>CRM / message</div>
          <div className={styles.sheetTitle} id="mcMsgTitle">{msgClient?.name ?? "Message"}</div>
        </div>

        <div className={`${styles.sheetBody} ${styles.formBody}`}>
          {/* THE CHANNEL is a two-button group, not a select: there are exactly
              two and both are worth reading at a glance. NEITHER CHIP IS EVER
              DISABLED, even when its channel cannot be used — the reason only
              renders for the SELECTED channel, so disabling the one with the
              problem is exactly how you hide the answer from the person looking
              for it. Selecting it shows the reason; Send is what stays off. */}
          <div className={styles.fld}>
            <span className={styles.fldLbl} id="mcChanLbl">Send by</span>
            <div className={styles.msgChips} role="group" aria-labelledby="mcChanLbl">
              <button type="button" aria-pressed={channel === "email"}
                className={`${styles.msgChip} ${channel === "email" ? styles.msgChipOn : ""}`}
                onClick={() => setChannel("email")}>
                <Icon id="i-mail" />Email
              </button>
              <button type="button" aria-pressed={channel === "sms"}
                className={`${styles.msgChip} ${channel === "sms" ? styles.msgChipOn : ""}`}
                onClick={() => setChannel("sms")}>
                <Icon id="i-phone" />Text
              </button>
            </div>
          </div>

          {reachLoading ? (
            <div className={styles.msgBusy} role="status" aria-live="polite">
              <span className={styles.sheetBusyDot} aria-hidden="true" />
              Checking how this client can be reached…
            </div>
          ) : (
            <>
              {channel === "email" ? (
                <div className={styles.fld}>
                  <label className={styles.fldLbl} htmlFor="mcSubject">Subject</label>
                  <input className={styles.pinput} id="mcSubject" type="text"
                    placeholder="About your roof proposal" autoComplete="off"
                    value={subject} disabled={composerOff}
                    onChange={(e) => setSubject(e.target.value)} />
                </div>
              ) : null}

              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="mcBody">Message</label>
                <textarea className={`${styles.pinput} ${styles.ptextarea}`} id="mcBody" rows={5}
                  placeholder="Hi — following up on the garage re-roof…"
                  value={msgBody} disabled={composerOff}
                  onChange={(e) => setMsgBody(e.target.value)} />
              </div>

              {/* THE GATES. One line each, and every one of them names the page
                  that fixes it — a warning that does not say where to go is a
                  dead end with punctuation. */}
              {channel === "email" && reach && !reach.email ? (
                <span className={styles.msgNote}>
                  No email on file for this client — add one with Edit client.
                </span>
              ) : null}

              {channel === "email" && reach?.email && !reach.emailConfigured ? (
                <span className={styles.msgNote}>
                  <Link className={styles.msgLink} href={GMAIL_ROUTE}>Connect your Gmail in Settings</Link>{" "}
                  to send email from JobFlex. Until then, open a draft in Gmail or Outlook below.
                </span>
              ) : null}

              {channel === "sms" && reach && !reach.phone ? (
                <span className={styles.msgNote}>
                  No phone number on file for this client — add one with Edit client.
                </span>
              ) : null}

              {channel === "sms" && reach?.phone && !reach.smsConfigured ? (
                <span className={styles.msgNote}>
                  Texting is not switched on yet —{" "}
                  <Link className={styles.msgLink} href={TEXTING_ROUTE}>see the Texting page</Link>
                  . Meanwhile, Open in Messages hands this to your phone.
                </span>
              ) : null}

              {/* THE HANDOFF. Needs no integration, so it is offered whether or
                  not the org has connected anything — the same message, composed
                  in the reader's own mail client. */}
              {channel === "email" && reach?.email ? (
                <div className={styles.fld}>
                  <span className={styles.fldLbl}>Or open a draft in</span>
                  <div className={styles.msgChips}>
                    <a className={styles.msgChip} href={gmailCompose(msgEmail, subjectLine, msgBody)}
                      target="_blank" rel="noopener noreferrer">Gmail</a>
                    <a className={styles.msgChip} href={outlookCompose(msgEmail, subjectLine, msgBody)}
                      target="_blank" rel="noopener noreferrer">Outlook</a>
                  </div>
                </div>
              ) : null}

              {sent ? <span className={styles.msgNote}>{sent}</span> : null}
            </>
          )}

          {msgErr ? <span className={styles.fldErr} role="alert">{msgErr}</span> : null}
        </div>

        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
            disabled={sending} onClick={closeMessage}>
            Close
          </button>

          {/* On a phone the text channel LEAVES THE APP: the primary is an
              `sms:` link, so the phone's own messenger opens with the number and
              the typed message already in it. Nothing is logged against the
              record for that route — the send happens outside the app, and a log
              entry for a message the contractor might still cancel would be a
              fiction on the client's file. */}
          {channel === "sms" && canSendText ? (
            <a className={`${styles.btn} ${styles.btnPrimary} ${msgBody.trim() ? "" : styles.btnOff}`}
              href={smsLink(msgPhone, msgBody)}
              aria-disabled={!msgBody.trim()}
              onClick={(e) => { if (!msgBody.trim()) e.preventDefault(); }}>
              <Icon id="i-send" />Open in Messages
            </a>
          ) : (
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="button"
              disabled={sending || reachLoading || !canSendEmail || !msgBody.trim() || channel === "sms"}
              onClick={() => void sendMessage()}>
              <Icon id="i-send" />
              {sending ? "Sending…" : channel === "email" ? "Send email" : "Send text"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SVG SPRITE — line icons 24×24, stroke 2, currentColor. Only
   original lucide paths; i-bulb is the reference's hand-drawn
   "switched-on" bulb (Smart Proposal).
   ============================================================ */