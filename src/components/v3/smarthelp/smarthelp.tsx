"use client";
// SMARTHELP · THE PANEL (owner, 2026-10-29; docs/superpowers/specs/2026-10-29-smarthelp-design.md). Opened by the
// SmartHelp row at the head of every nav (./smarthelp-row, event `jf:smarthelp`); mounted once, inside SupportWidget,
// so it exists wherever Help does and nowhere a page has no session.
//
// WHERE IT STANDS
//   ≥1024px    a 380px panel on the right; the page moves over (globals.css pads <body> while
//              html[data-smarthelp-open]) so nothing the person follows is covered. Open and Show me keep it open.
//   769–1023   the same panel over the page; Show me folds it to the 44px "Back to SmartHelp" bar.
//   ≤768px     a bottom sheet, 85dvh, on the sheets' scrim; Open and Show me close it to the bar.
// It stays open across pages. Esc (with focus inside) and ✕ close it.
//
// WHAT IS IN IT: the ink block as its header; the guides for this person ("Set it up" — to-do ones first with a dot,
// finished ones ✓ — then "How it works"), from smartHelpPanel; a tap shows a guide's steps (guideFor, no AI); the ask
// box sends a typed question (askSmartHelp). Every answer is numbered steps, each with Open (go to its page) and Show me
// (go there and light the element, ./spotlight) unless the person's role or plan can't open that page — then the step
// says so. 👍 / 👎 under each answer; a 👎, and every answer SmartHelp leaves to a person, put Ask a person first: the
// Help composer opens with the question and SmartHelp's answer in it, marked as SmartHelp's hand-off, so the support AI
// only drafts and a person sends (support-widget/composer).
//
// MEMORY: the open state (folded too) and the conversation (last 20 entries) live in this tab's sessionStorage —
// nothing is saved to the account. Every read and write is in a try/catch: private windows and blocked storage just
// start empty.
//
// GOING TO A STEP'S PAGE is the app router's — except the page already showing with another ?query (an AI desk step,
// a Settings pane): those pages read their section from the address when they load and keep it in their own state
// after, so a router move would leave the old section up. That trip is a fresh load; the panel comes back from this
// tab's memory and a Show me waits for the new page (showMeAfterLoad).

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import {
  ArrowLeft,
  Box,
  Building2,
  CalendarCheck,
  Check,
  CreditCard,
  Fence,
  FolderKanban,
  Globe,
  HardHat,
  House,
  Inbox,
  MessageSquareText,
  Palette,
  PhoneCall,
  PhoneForwarded,
  Ruler,
  Send,
  Sparkles,
  Star,
  Thermometer,
  ThumbsDown,
  ThumbsUp,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { askSmartHelp, guideFor, rateSmartHelp, smartHelpPanel } from "@/actions/smartHelp";
import type { SmartHelpReply } from "@/lib/smarthelp/answer";
import { QUESTION_MAX, replyText } from "@/lib/smarthelp/log";
import { HELP_PAGES, pathOf } from "@/lib/smarthelp/pages";
import { PERSON_REPLY, type PersonTopic } from "@/lib/smarthelp/personTopic";
import type { GuideCard, HelpContext, StepView } from "@/lib/smarthelp/types";
import { lockScroll } from "@/lib/scrollLock";
import { HANDHELD, useIsHandheld } from "@/components/v3/responsive-shell/use-handheld";
import { openSupportComposer, type SupportPrefill } from "@/components/v3/support-widget/support-widget";
import { OPEN_EVENT, type OpenDetail } from "./events";
import { MISS_EVENT, SmartHelpSpotlight, showMe, showMeAfterLoad } from "./spotlight";
import styles from "./smarthelp.module.css";

export { openSmartHelp } from "./events";

/** The guides' icons, by the lucide-react name each guide carries (lib/smarthelp/guides). */
const ICONS: Record<string, LucideIcon> = {
  Box,
  Building2,
  CalendarCheck,
  CreditCard,
  Fence,
  FolderKanban,
  Globe,
  HardHat,
  House,
  Inbox,
  MessageSquareText,
  Palette,
  PhoneCall,
  PhoneForwarded,
  Ruler,
  Send,
  Sparkles,
  Star,
  Thermometer,
  Users,
  Video,
};

const OPEN_KEY = "smarthelp:open";
const CHAT_KEY = "smarthelp:chat";
const KEEP_ENTRIES = 20;
const HISTORY_SENT = 6;
const WIDE = "(min-width: 1024px)";
const UPGRADE: Route = "/dashboard/subscription" as Route;

type Rated = "up" | "down";
type GuideEntry = { kind: "guide"; key: string; id: string; title: string; steps?: StepView[]; error?: string; rated?: Rated; rateError?: string };
type AskEntry = {
  kind: "ask";
  key: string;
  q: string;
  pending?: boolean;
  reply?: SmartHelpReply;
  logId?: string;
  canForce?: boolean;
  error?: string;
  rated?: Rated;
  rateError?: string;
};
type Entry = GuideEntry | AskEntry;
type Saved = { view: "home" | "thread"; entries: Entry[] };

// ── This tab's memory ────────────────────────────────────────────────────────

function readSaved(): { open: boolean; folded: boolean; chat: Saved } {
  const chat: Saved = { view: "home", entries: [] };
  try {
    const raw = window.sessionStorage.getItem(CHAT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (parsed && Array.isArray(parsed.entries)) {
      // An answer still on its way when the tab reloaded never arrives.
      chat.entries = parsed.entries
        .filter((e): e is Entry => !!e && (e.kind === "guide" || e.kind === "ask") && typeof e.key === "string")
        .slice(-KEEP_ENTRIES)
        .map((e) => (e.kind === "ask" && e.pending ? { ...e, pending: false, error: "That answer didn't arrive — ask again." } : e));
      chat.view = parsed.view === "thread" && chat.entries.length ? "thread" : "home";
    }
  } catch {
    /* storage blocked or junk: start empty */
  }
  let state: string | null = null;
  try {
    state = window.sessionStorage.getItem(OPEN_KEY);
  } catch {
    /* storage blocked */
  }
  return { open: state === "1" || state === "fold", folded: state === "fold", chat };
}

function save(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked or full: the panel works, it just won't be remembered */
  }
}

// ── Small pure helpers ───────────────────────────────────────────────────────

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** The name a step's page goes by — the panel's words for "Ask your account owner to open …". */
function pageName(open: string): string {
  const noHash = open.split("#")[0];
  return HELP_PAGES.find((p) => p.path === noHash)?.name ?? HELP_PAGES.find((p) => p.path === pathOf(open))?.name ?? "that page";
}

/** What the panel says to look for when Show me can't find the element: the menu row's page, or the step's first
 *  sentence (it names the button). */
function lookFor(step: StepView): string {
  if (step.show?.startsWith("nav:")) return `${pageName(step.show.slice(4))} in the menu`;
  const first = step.text.split(/(?<=[.!?])\s/)[0].trim().replace(/[.!?]+$/, "");
  return first.length <= 90 ? first : `${first.slice(0, 89).trimEnd()}…`;
}

/** The person topic a reply given without the model stands for — its category in the Help composer. */
function topicOf(reply: SmartHelpReply): PersonTopic | null {
  const hit = (Object.keys(PERSON_REPLY) as PersonTopic[]).find((t) => PERSON_REPLY[t] === reply.title);
  return hit ?? null;
}

function categoryOf(entry: Entry): SupportPrefill["category"] {
  if (entry.kind !== "ask" || !entry.reply) return "general";
  const topic = topicOf(entry.reply);
  if (topic === "leaving" || topic === "money") return "billing";
  if (topic === "data" || topic === "security") return "account";
  return "general";
}

/** The Help composer's starting words for a hand-off from this entry (the composer clips them to its own limit). */
function handoff(entry: Entry | undefined): SupportPrefill {
  if (!entry) return { message: "", origin: "smarthelp" };
  if (entry.kind === "guide") {
    return { message: `I followed the SmartHelp guide "${entry.title}" and I'm still stuck.`, category: "general", origin: "smarthelp" };
  }
  const said = entry.reply ? `\n\nSmartHelp said:\n${replyText(entry.reply)}` : "";
  return { message: `${entry.q}${said}`, category: categoryOf(entry), origin: "smarthelp", logId: entry.logId };
}

/** True when going to `open` must be a fresh load: the page already showing, with another ?query (see the header). */
function needsLoad(open: string): boolean {
  const to = new URL(open, window.location.href);
  return to.pathname === window.location.pathname && to.search !== window.location.search;
}

// ── The viewport ─────────────────────────────────────────────────────────────

function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const useIsWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

// ── The panel ────────────────────────────────────────────────────────────────

export function SmartHelpRoot() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const phone = useIsHandheld();
  const wide = useIsWide();
  const titleId = useId();

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [foldedRaw, setFolded] = useState(false);
  const [panel, setPanel] = useState<{ cards: GuideCard[]; ctx: HelpContext } | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [chat, setChat] = useState<Saved>({ view: "home", entries: [] });
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const revealRef = useRef<string | null>(null);

  // The desk never folds: there the panel stands beside the page.
  const folded = foldedRaw && !wide;
  const showing = open && !folded;

  // This tab's memory, read once in the browser (the server draws nothing here).
  useEffect(() => {
    const restore = () => {
      const saved = readSaved();
      setChat(saved.chat);
      setOpen(saved.open);
      setFolded(saved.folded);
      setMounted(true);
    };
    restore();
  }, []);

  useEffect(() => {
    if (mounted) save(OPEN_KEY, open ? (foldedRaw ? "fold" : "1") : "0");
  }, [open, foldedRaw, mounted]);
  useEffect(() => {
    if (mounted) save(CHAT_KEY, JSON.stringify({ view: chat.view, entries: chat.entries.slice(-KEEP_ENTRIES) }));
  }, [chat, mounted]);

  // The page moves over for the desk panel (globals.css), only while it is drawn.
  useEffect(() => {
    const root = document.documentElement;
    if (showing) root.setAttribute("data-smarthelp-open", "");
    else root.removeAttribute("data-smarthelp-open");
    return () => root.removeAttribute("data-smarthelp-open");
  }, [showing]);

  // The phone sheet holds the page still under it, like every sheet.
  useEffect(() => {
    if (!(showing && phone)) return;
    return lockScroll();
  }, [showing, phone]);

  // The guides for this person, read each time the panel opens.
  const loadPanel = useCallback((page: string) => {
    smartHelpPanel(page)
      .then((p) => {
        setPanel(p);
        setPanelError(null);
      })
      .catch(() => setPanelError("SmartHelp couldn't load your guides just now. Close it and open it again."));
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) loadPanel(window.location.pathname);
    wasOpen.current = open;
  }, [open, loadPanel]);

  const close = useCallback(() => {
    setOpen(false);
    setFolded(false);
    setMiss(null);
    const back = openerRef.current;
    openerRef.current = null;
    if (back?.isConnected) back.focus();
  }, []);

  // A row, anywhere: open (or unfold) and put the cursor in the ask box — on a phone the sheet itself, not the keyboard.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenDetail>).detail;
      openerRef.current = detail?.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setOpen(true);
      setFolded(false);
      requestAnimationFrame(() => {
        if (window.matchMedia(HANDHELD).matches) panelRef.current?.focus();
        else askRef.current?.focus();
      });
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Show me couldn't find its element on the page.
  useEffect(() => {
    const onMiss = (e: Event) => setMiss((e as CustomEvent<{ label: string }>).detail?.label ?? null);
    window.addEventListener(MISS_EVENT, onMiss);
    return () => window.removeEventListener(MISS_EVENT, onMiss);
  }, []);

  // A new entry scrolls into view once it is drawn.
  useEffect(() => {
    const key = revealRef.current;
    if (!key || !showing) return;
    revealRef.current = null;
    bodyRef.current?.querySelector(`[data-entry="${key}"]`)?.scrollIntoView({ block: "start" });
  }, [chat.entries, showing]);

  const patch = useCallback((key: string, change: Partial<GuideEntry> | Partial<AskEntry>) => {
    setChat((c) => ({ ...c, entries: c.entries.map((e) => (e.key === key ? ({ ...e, ...change } as Entry) : e)) }));
  }, []);
  const append = useCallback((entry: Entry) => {
    revealRef.current = entry.key;
    setChat((c) => ({ view: "thread", entries: [...c.entries, entry].slice(-KEEP_ENTRIES) }));
  }, []);

  function openGuide(card: GuideCard) {
    const key = newKey();
    setMiss(null);
    append({ kind: "guide", key, id: card.id, title: card.title });
    guideFor(card.id, pathname)
      .then((r) => patch(key, "error" in r ? { error: r.error } : { title: r.guide.title, steps: r.guide.steps }))
      .catch(() => patch(key, { error: "That guide didn't open — try again in a moment." }));
  }

  function ask(text: string, force = false) {
    const q = text.trim();
    if (!q || asking) return;
    const key = newKey();
    const history = chat.entries
      .filter((e): e is AskEntry => e.kind === "ask" && !!e.reply)
      .slice(-HISTORY_SENT)
      .map((e) => ({ q: e.q, a: replyText(e.reply!) }));
    setMiss(null);
    setAsking(true);
    append({ kind: "ask", key, q, pending: true });
    if (!force) setQuestion("");
    askSmartHelp({ question: q, history, page: pathname, force })
      .then((r) => patch(key, "error" in r ? { pending: false, error: r.error } : { pending: false, reply: r.reply, logId: r.logId, canForce: r.canForce }))
      .catch(() => patch(key, { pending: false, error: "SmartHelp couldn't answer just now. The guides still work, or ask a person." }))
      .finally(() => setAsking(false));
  }

  function rate(entry: Entry, verdict: Rated) {
    if (entry.rated) return;
    const target = entry.kind === "guide" ? { guideId: entry.id } : entry.logId ? { logId: entry.logId } : null;
    if (!target) return;
    patch(entry.key, { rated: verdict, rateError: undefined });
    rateSmartHelp(target, verdict)
      .then((r) => {
        if (!r.ok) patch(entry.key, { rated: undefined, rateError: r.error });
      })
      .catch(() => patch(entry.key, { rated: undefined, rateError: "That didn't save — try again in a moment." }));
  }

  function askPerson(entry: Entry | undefined, button: HTMLElement) {
    openSupportComposer(button, handoff(entry));
  }

  /** Open: the step's page. The phone sheet steps aside to the bar; the desk and mid panels stay. */
  function goOpen(step: StepView) {
    if (!step.open) return;
    setMiss(null);
    if (phone) setFolded(true);
    if (needsLoad(step.open)) window.location.assign(step.open);
    else router.push(step.open as Route);
  }

  /** Show me: the step's page, then its element lit. Below the desk the panel folds so the element is in view. */
  function goShow(step: StepView) {
    if (!step.show) return;
    setMiss(null);
    if (!wide) setFolded(true);
    if (step.open && needsLoad(step.open)) {
      showMeAfterLoad(step.show, lookFor(step));
      window.location.assign(step.open);
      return;
    }
    if (step.open) router.push(step.open as Route);
    showMe(step.show, lookFor(step));
  }

  // The spotlight keeps its place in the tree whether the panel is up or not, so opening the panel never resets it.
  if (!mounted || !open) {
    return (
      <>
        <SmartHelpSpotlight />
        {null}
      </>
    );
  }

  const owner = panel?.ctx.role === "OWNER";
  const lastEntry = chat.entries[chat.entries.length - 1];
  const setupCards = panel?.cards.filter((c) => c.group === "setup") ?? [];
  const howCards = panel?.cards.filter((c) => c.group === "how") ?? [];

  const steps = (list: StepView[]) => (
    <ol className={styles.steps}>
      {list.map((s, i) => (
        <li key={i} className={styles.step}>
          <span className={styles.num} aria-hidden="true">
            {i + 1}
          </span>
          <div className={styles.stepBody}>
            <p className={styles.stepText}>{s.text}</p>
            {s.blocked === "role" && s.open ? (
              <p className={styles.blocked}>Ask your account owner to open {pageName(s.open)}.</p>
            ) : s.blocked === "plan" && s.open ? (
              <p className={styles.blocked}>
                {pageName(s.open)} is on another plan.
                {owner ? (
                  <button type="button" className={styles.link} onClick={() => goOpen({ text: "", open: UPGRADE })}>
                    Upgrade
                  </button>
                ) : null}
              </p>
            ) : s.open || s.show ? (
              <div className={styles.stepActs}>
                {s.open ? (
                  <button type="button" className={styles.btn} onClick={() => goOpen(s)}>
                    Open
                  </button>
                ) : null}
                {s.show ? (
                  <button type="button" className={`${styles.btn} ${styles.btnShow}`} onClick={() => goShow(s)}>
                    Show me
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );

  const rating = (entry: Entry) => (
    <div className={styles.rate}>
      {entry.rated ? (
        <span className={styles.thanks}>{entry.rated === "up" ? "Thanks — glad it helped." : "Thanks. A person can help with this one."}</span>
      ) : (
        <>
          <span className={styles.rateQ}>Did this help?</span>
          <button type="button" className={styles.thumb} aria-label="Yes, this helped" onClick={() => rate(entry, "up")}>
            <ThumbsUp aria-hidden="true" />
          </button>
          <button type="button" className={styles.thumb} aria-label="No, this didn't help" onClick={() => rate(entry, "down")}>
            <ThumbsDown aria-hidden="true" />
          </button>
        </>
      )}
      {entry.rateError ? <span className={styles.err}>{entry.rateError}</span> : null}
    </div>
  );

  const personFirst = (entry: Entry, extra?: ReactNode) => (
    <div className={styles.personRow}>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={(e) => askPerson(entry, e.currentTarget)}>
        Ask a person
      </button>
      {extra}
    </div>
  );

  const entryView = (entry: Entry) => {
    if (entry.kind === "guide") {
      return (
        <article key={entry.key} className={styles.entry} data-entry={entry.key}>
          <h3 className={styles.entryTitle}>{entry.title}</h3>
          {entry.error ? <p className={styles.err}>{entry.error}</p> : entry.steps ? steps(entry.steps) : <p className={styles.wait}>Opening…</p>}
          {entry.steps ? rating(entry) : null}
          {entry.rated === "down" ? personFirst(entry) : null}
        </article>
      );
    }
    const r = entry.reply;
    const toPerson = r && (r.kind === "person" || r.kind === "unknown");
    return (
      <article key={entry.key} className={styles.entry} data-entry={entry.key}>
        <p className={styles.q}>{entry.q}</p>
        {entry.pending ? <p className={styles.wait}>Looking it up…</p> : null}
        {entry.error ? (
          <>
            <p className={styles.err}>{entry.error}</p>
            {personFirst(entry)}
          </>
        ) : null}
        {r ? (
          <>
            {toPerson
              ? personFirst(
                  entry,
                  entry.canForce ? (
                    <button type="button" className={styles.link} disabled={asking} onClick={() => ask(entry.q, true)}>
                      Answer it anyway
                    </button>
                  ) : null,
                )
              : null}
            <p className={styles.replyTitle}>{r.title}</p>
            {r.steps.length ? steps(r.steps) : null}
            {r.note ? <p className={styles.note}>{r.note}</p> : null}
            {entry.logId ? rating(entry) : null}
            {entry.rated === "down" && !toPerson ? personFirst(entry) : null}
          </>
        ) : null}
      </article>
    );
  };

  const card = (c: GuideCard) => {
    const Icon = ICONS[c.icon] ?? Sparkles;
    return (
      <li key={c.id}>
        <button type="button" className={styles.card} onClick={() => openGuide(c)}>
          <span className={styles.cardIcon} aria-hidden="true">
            <Icon />
          </span>
          <span className={styles.cardTitle}>{c.title}</span>
          {c.state === "todo" ? (
            <span className={styles.dot}>
              <span className={styles.sr}>Not set up yet</span>
            </span>
          ) : c.state === "done" ? (
            <span className={styles.done}>
              <Check aria-hidden="true" />
              <span className={styles.sr}>Done</span>
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  const panelView = (
    <aside
      ref={panelRef}
      className={`${styles.panel} ${phone ? styles.sheet : wide ? styles.desk : styles.mid}`}
      role={phone ? "dialog" : "complementary"}
      aria-modal={phone ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-nest=""
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      {phone ? <div className={styles.grab} aria-hidden="true" /> : null}
      <header className={styles.head}>
        <span className={styles.mark} aria-hidden="true">
          <Sparkles />
        </span>
        <h2 className={styles.headName} id={titleId}>
          SmartHelp
        </h2>
        <span className={styles.askTag} aria-hidden="true">
          ASK
        </span>
        <button type="button" className={styles.close} aria-label="Close SmartHelp" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </header>

      <div ref={bodyRef} className={styles.body}>
        {miss ? (
          <p className={styles.miss} role="status">
            Couldn&apos;t light it on this page. Look for <b>{miss}</b>.
          </p>
        ) : null}
        {chat.view === "thread" ? (
          <>
            <button type="button" className={styles.back} onClick={() => setChat((c) => ({ ...c, view: "home" }))}>
              <ArrowLeft aria-hidden="true" /> All guides
            </button>
            {chat.entries.map(entryView)}
          </>
        ) : (
          <>
            <p className={styles.intro}>Ask anything about JobFlex in your own words — or pick a guide. Every answer is steps, with a button to each page.</p>
            {panelError ? <p className={styles.err}>{panelError}</p> : null}
            {!panel && !panelError ? <p className={styles.wait}>Loading your guides…</p> : null}
            {setupCards.length ? (
              <section className={styles.group} aria-label="Set it up">
                <h3 className={styles.groupName}>Set it up</h3>
                <ul className={styles.cards}>{setupCards.map(card)}</ul>
              </section>
            ) : null}
            {howCards.length ? (
              <section className={styles.group} aria-label="How it works">
                <h3 className={styles.groupName}>How it works</h3>
                <ul className={styles.cards}>{howCards.map(card)}</ul>
              </section>
            ) : null}
            {chat.entries.length ? (
              <button type="button" className={styles.link} onClick={() => setChat((c) => ({ ...c, view: "thread" }))}>
                Back to your answers
              </button>
            ) : null}
          </>
        )}
      </div>

      <form
        className={styles.askBox}
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <textarea
          ref={askRef}
          className={styles.input}
          value={question}
          maxLength={QUESTION_MAX}
          rows={2}
          placeholder="How do I…? Ask in any language"
          aria-label="Ask SmartHelp a question"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(question);
            }
          }}
        />
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={asking || !question.trim()}>
          Ask
        </button>
      </form>
      <footer className={styles.foot}>
        Still stuck?
        <button type="button" className={styles.link} onClick={(e) => askPerson(chat.view === "thread" ? lastEntry : undefined, e.currentTarget)}>
          Ask a person
        </button>
      </footer>
    </aside>
  );

  // Drawn where SupportWidget is mounted, beside the composer — NOT portalled to <body>: the app sits in one stacking
  // context (layout.tsx's `relative z-10`), and the composer (95 inside it) has to come up over this panel when
  // Ask a person opens it. The panel's 58 clears the page's drawers and sheets (40/50) and the sticky bars (30).
  return (
    <>
      <SmartHelpSpotlight />
      <div className={styles.root} data-nest="">
        {folded ? (
          <div className={styles.bar}>
            <button type="button" className={styles.barOpen} onClick={() => setFolded(false)}>
              <span className={styles.mark} aria-hidden="true">
                <Sparkles />
              </span>
              <span className={styles.barTxt}>
                Back to SmartHelp
                {miss ? <span className={styles.barMiss}>Look for {miss}</span> : null}
              </span>
            </button>
            <button type="button" className={styles.barClose} aria-label="Close SmartHelp" onClick={close}>
              <X aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            {phone ? <div className={styles.scrim} onClick={close} aria-hidden="true" /> : null}
            {panelView}
          </>
        )}
      </div>
    </>
  );
}
