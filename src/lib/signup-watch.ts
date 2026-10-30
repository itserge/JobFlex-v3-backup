// THE SIGN-UP FORM, WATCHED — the browser's half (owner, 2026-10-14: "more statistics while they try to sign up,
// in real time — what they're doing exactly and where they leave — a smart approach to find whether it's on our
// side").
//
// One watcher per sign-up page (register-content starts it). It follows the page, not each box: a focus anywhere in
// the form names the box by its id (lib/signup-watch-shared), and on leaving it says how long, filled or not, valid
// or not, how many edits — never what was typed. The screens tell it where the visitor is (setSignupPosition); every
// refusal and failure goes through signupProblem with its reason and side; the tab going away, coming back and the
// page closing are sent with where they were at that moment. All of it is fire-and-forget through trackTraffic —
// nothing here can stop a sign-up — and nothing is sent off /auth/register.
import { flushTrafficNow, trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { fieldName, isBrowserNoise, isForeignFile, isOutsideScriptError, reasonOfMessage, reasonSide, scrubWords, type SignupSide } from "@/lib/signup-watch-shared";

type Leaving = "closed" | "google" | "checkout" | "done";
interface Position {
  step: string;
  screen: string;
  flow: string;
}

const state: {
  pos: Position;
  stepSince: number;
  pageSince: number;
  current: { field: string; since: number; edits: number; el: HTMLElement; announce: ReturnType<typeof setTimeout> | null } | null;
  lastProblem: string;
  leaving: Leaving;
  awayAt: number | null;
  lastSent: Map<string, number>;
} = {
  pos: { step: "1", screen: "account", flow: "standard" },
  stepSince: Date.now(),
  pageSince: Date.now(),
  current: null,
  lastProblem: "",
  leaving: "closed",
  awayAt: null,
  lastSent: new Map(),
};

const onSignupPage = () => typeof window !== "undefined" && window.location.pathname.startsWith("/auth/register");
const send = (event: (typeof TRAFFIC_EVENTS)[keyof typeof TRAFFIC_EVENTS], props: Record<string, string | number | boolean>) => {
  if (!onSignupPage()) return;
  try {
    trackTraffic(event, { ...props, step: state.pos.step, screen: state.pos.screen, flow: state.pos.flow });
  } catch {
    /* watching never interrupts a sign-up */
  }
};

/** Where the visitor is now: the screens call this as they change. A new screen restarts the step's clock. */
export function setSignupPosition(next: Partial<Position>) {
  const moved = (next.screen && next.screen !== state.pos.screen) || (next.step && next.step !== state.pos.step);
  state.pos = { ...state.pos, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) } as Position;
  if (moved) state.stepSince = Date.now();
}

/** How the leave reads now: a hand-off said on purpose (Google, the checkout), else "done" only ON the done screen —
 *  the account made — else a close. Read at the leave, never latched from a screen: the done screen that flashes by
 *  before the plan step, or before Stripe's card page, used to mark the later leave "done" (2026-10-28). */
export function signupLeaveKind(): Leaving {
  if (state.leaving !== "closed") return state.leaving;
  return state.pos.screen === "done" ? "done" : "closed";
}

/** The page is about to go somewhere on purpose (Google, the checkout): the leave is not an abandon. */
export function signupLeavingTo(where: Exclude<Leaving, "closed">) {
  state.leaving = where;
}

/**
 * A refusal or a failure the visitor met. `reason` from SIGNUP_REASONS (or read from the words the server sent back
 * when it is not known); the side follows the reason unless given. The same reason twice within two seconds is one.
 */
export function signupProblem(reason: string, opts: { message?: string; side?: SignupSide } = {}) {
  const r = reason || reasonOfMessage(opts.message ?? "");
  const now = Date.now();
  const key = `${state.pos.screen}:${r}`;
  if (now - (state.lastSent.get(key) ?? 0) < 2000) return;
  state.lastSent.set(key, now);
  state.lastProblem = r;
  send(TRAFFIC_EVENTS.signupProblem, {
    reason: r,
    side: opts.side ?? reasonSide(r),
    message: scrubWords(opts.message ?? ""),
    field: state.current?.field ?? "",
    ms: now - state.stepSince,
  });
}

/** The box an element is, or null when it is not one of the form's. */
function boxOf(el: EventTarget | null): { field: string; el: HTMLElement } | null {
  if (!(el instanceof HTMLElement)) return null;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return null;
  if (el instanceof HTMLInputElement && (el.type === "hidden" || el.type === "submit" || el.type === "button")) return null;
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") && el.closest("[id*='trade' i], [class*='trade' i]")) return { field: "Trades", el };
  const name = fieldName(el.id) ?? fieldName(el.getAttribute("name") ?? "");
  return name ? { field: name, el } : null;
}

function leaveBox() {
  const c = state.current;
  state.current = null;
  if (!c) return;
  if (c.announce) clearTimeout(c.announce);
  const ms = Date.now() - c.since;
  if (ms < 300) return;
  const el = c.el as HTMLInputElement;
  const value = typeof el.value === "string" ? el.value : "";
  const filled = el.type === "checkbox" || el.type === "radio" ? true : value.trim().length > 0;
  let valid = true;
  try {
    valid = (typeof el.checkValidity === "function" ? el.checkValidity() : true) && el.getAttribute("aria-invalid") !== "true";
  } catch {
    valid = true;
  }
  send(TRAFFIC_EVENTS.signupField, { phase: "out", field: c.field, ms, filled, valid, edits: c.edits });
}

/**
 * Start following the page. Returns the stop. Safe to call more than once (the last call's stop wins); does nothing
 * off the sign-up page or without a window.
 */
export function startSignupWatch(): () => void {
  if (typeof window === "undefined") return () => {};
  state.pageSince = Date.now();
  state.stepSince = Date.now();
  state.leaving = "closed";

  const onFocusIn = (e: FocusEvent) => {
    const box = boxOf(e.target);
    if (!box) return;
    if (state.current && state.current.el === box.el) return;
    leaveBox();
    // "In the Email box now" for the live view — once they have stayed half a second (a tab through is not a visit).
    const announce = setTimeout(() => {
      if (state.current?.el === box.el) send(TRAFFIC_EVENTS.signupField, { phase: "in", field: box.field, ms: 0 });
    }, 600);
    state.current = { field: box.field, since: Date.now(), edits: 0, el: box.el, announce };
  };
  const onFocusOut = (e: FocusEvent) => {
    if (state.current && e.target === state.current.el) leaveBox();
  };
  const onInput = (e: Event) => {
    if (state.current && e.target === state.current.el) state.current.edits += 1;
  };
  const onVisibility = () => {
    if (!onSignupPage()) return;
    if (document.visibilityState === "hidden") {
      state.awayAt = Date.now();
      send(TRAFFIC_EVENTS.signupAway, { field: state.current?.field ?? "", ms: Date.now() - state.stepSince, page_ms: Date.now() - state.pageSince, last_problem: state.lastProblem });
      flushTrafficNow();
    } else if (state.awayAt != null) {
      send(TRAFFIC_EVENTS.signupBack, { ms: Date.now() - state.awayAt });
      state.awayAt = null;
    }
  };
  const onPageHide = () => {
    if (!onSignupPage()) return;
    // The box they were in when the page went: its time, and whether they left it empty, count like any other.
    const field = state.current?.field ?? "";
    leaveBox();
    send(TRAFFIC_EVENTS.signupLeave, {
      kind: signupLeaveKind(),
      field,
      ms: Date.now() - state.stepSince,
      page_ms: Date.now() - state.pageSince,
      last_problem: state.lastProblem,
    });
    // traffic-client's own pagehide flush ran before this handler; send what was just queued.
    flushTrafficNow();
  };
  // The page breaking under them is ours — extension noise and the browser's own resize loop are not.
  const onError = (e: ErrorEvent) => {
    const file = e.filename || "";
    if (/^(chrome|moz|safari)-extension:/.test(file) || /ResizeObserver loop/i.test(e.message || "")) return;
    // A script from another site failing tells us only "Script error." — not ours, and not theirs: said as such.
    if (isOutsideScriptError(e.message, file, e.lineno)) return signupProblem("browser_error", { message: "Script error." });
    // The in-app browser's own bridge ("Java object is gone"), or a file served from another site: the browser's.
    if (isBrowserNoise(e.message) || isForeignFile(file, window.location.host)) {
      const host = isForeignFile(file, window.location.host) ? ` (${new URL(file).host})` : "";
      return signupProblem("browser_error", { message: `${e.message || "Script error"}${host}` });
    }
    signupProblem("page_error", { message: e.message || "Script error" });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const why = e.reason instanceof Error ? e.reason.message : typeof e.reason === "string" ? e.reason : "";
    if (isBrowserNoise(why)) signupProblem("browser_error", { message: why });
    else if (/Failed to fetch|NetworkError|Load failed|network/i.test(why)) signupProblem("network", { message: why });
    else signupProblem("page_error", { message: why || "Unhandled rejection" });
  };

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    leaveBox();
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
