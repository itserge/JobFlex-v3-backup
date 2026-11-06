"use client";
// THE ASSISTANT · THE DESK PANEL (2026-11-04). Opened by the Assistant row under
// SmartHelp (./assistant-row, event `jf:assistant`); mounted once, beside
// SmartHelp inside SupportWidget, so it exists wherever Help does.
//
// WHERE IT STANDS — SmartHelp's geometry (DESIGN.md):
//   ≥1024px    a 380px panel on the right; the page moves over (globals.css pads <body>
//              while html[data-assistant-open]) so nothing is covered.
//   769–1023   the same panel over the page.
//   ≤768px     no panel: the rows go to the handheld page (/mobile-assistant-v1).
// The two panels share the right edge, so opening one closes the other. Esc (with
// focus inside) and ✕ close it; it stays open across pages.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { AudioLines, X } from "lucide-react";
import { useIsHandheld } from "@/components/v3/responsive-shell/use-handheld";
import { OPEN_EVENT as SMARTHELP_OPEN } from "@/components/v3/smarthelp/events";
import { MOBILE_HREF, OPEN_EVENT, type OpenDetail } from "./events";
import { Conversation } from "./conversation";
import { TaskList } from "./task-list";
import { useAssistant } from "./use-assistant";
import s from "./assistant.module.css";

const WIDE = "(min-width: 1024px)";

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

export function AssistantRoot() {
  const router = useRouter();
  const phone = useIsHandheld();
  const wide = useIsWide();
  const titleId = useId();
  const state = useAssistant();
  const { load } = state;
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  // Tasks (2026-11-05): the week's changes in place of the conversation, while the button is on.
  const [showTasks, setShowTasks] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const showing = open && !phone;

  // A row, anywhere: open it — or, on a phone, go to the Assistant's own page.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenDetail>).detail;
      if (window.matchMedia("(max-width: 768px)").matches) {
        router.push(MOBILE_HREF as Route);
        return;
      }
      openerRef.current = detail?.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setPrefill(detail?.text ?? null);
      setOpen(true);
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, [router]);

  // SmartHelp shares the right edge: it opening closes this.
  useEffect(() => {
    const onSmartHelp = () => setOpen(false);
    document.addEventListener(SMARTHELP_OPEN, onSmartHelp);
    return () => document.removeEventListener(SMARTHELP_OPEN, onSmartHelp);
  }, []);

  // The conversation, read each time the panel opens (it lives in the database).
  useEffect(() => {
    if (showing) load();
  }, [showing, load]);
  const { loadTasks } = state;
  useEffect(() => {
    if (showing && showTasks) loadTasks();
  }, [showing, showTasks, loadTasks]);

  // The page moves over for the desk panel (globals.css), only while it is drawn.
  useEffect(() => {
    const root = document.documentElement;
    if (showing) root.setAttribute("data-assistant-open", "");
    else root.removeAttribute("data-assistant-open");
    return () => root.removeAttribute("data-assistant-open");
  }, [showing]);

  const close = () => {
    setOpen(false);
    setPrefill(null);
    const back = openerRef.current;
    openerRef.current = null;
    if (back?.isConnected) back.focus();
  };

  if (!showing) return null;
  return (
    <div className={s.host} data-nest="">
      <aside
        className={`${s.panel} ${wide ? "" : s.mid}`}
        role="dialog"
        aria-modal={!wide}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <header className={s.head}>
          <span className={s.mark} aria-hidden="true">
            <AudioLines />
          </span>
          <div className={s.headText}>
            <h2 className={s.headName} id={titleId}>
              AI Operator
            </h2>
            <p className={s.headSub}>Ask, or tell JobFlex what to do.</p>
          </div>
          <button type="button" className={`${s.tasksBtn} ${showTasks ? s.tasksOn : ""}`} aria-pressed={showTasks} onClick={() => setShowTasks((v) => !v)}>
            Tasks
          </button>
          <button type="button" className={s.close} aria-label="Close the AI Operator" onClick={close}>
            <X />
          </button>
        </header>
        {showTasks ? (
          <div className={`${s.body} ${s.tasksBody}`}>
            <TaskList
              tasks={state.tasks}
              waitingId={state.feed?.awaiting?.id ?? null}
              busy={state.busy}
              onAnswer={async (id, yes, pin) => {
                await state.answer(id, yes, pin);
                state.loadTasks();
              }}
            />
          </div>
        ) : (
          <div className={s.body}>
            <Conversation state={state} prefill={prefill} autoFocus variant="panel" />
          </div>
        )}
      </aside>
    </div>
  );
}
