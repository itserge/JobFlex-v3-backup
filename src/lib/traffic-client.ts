"use client";

import type { PostHog } from "posthog-js";
import { TRAFFIC_EVENTS } from "./traffic-contract";
import { effectiveConsent } from "./consent";
import { isQaVisitor } from "./qaEmail";
import { isBrowserNoise } from "./signup-watch-shared";

/* posthog-js is NOT imported here (landing-e pass C, 2026-09-11): it is a
   259 KB script, and a static import from this module put it in every page
   that tracks a click. The root capture provider loads it on its own
   schedule and hands the instance over through `trafficReady(instance)`;
   until then events queue as they always did. */

type EventName = typeof TRAFFIC_EVENTS[keyof typeof TRAFFIC_EVENTS];
type Properties = Record<string, string | number | boolean>;
/* `error` rides along only for "$exception": once the library is in, the
   instance builds the stack frames from it; the beacon path sends without. */
type Queued = { event: EventName | "$exception"; properties: Record<string, unknown>; error?: Error };
const queued: Queued[] = [];
let available = false;
let client: PostHog | null = null;
const readyListeners = new Set<() => void>();
let readyAt: number | null = null;
export const isTrafficReady = () => available;
/** Ms from navigation to the library's first availability on this page — null until then (landing-timing.tsx). */
export const trafficReadyAt = () => readyAt;
/** The loaded PostHog instance, or null before the provider has brought it in. */
export const getPostHog = () => client;
export function onTrafficReady(callback: () => void): () => void {
  readyListeners.add(callback);
  if (available) callback();
  return () => { readyListeners.delete(callback); };
}

/** Registration effects can mount before the root capture provider initializes. */
export function trafficReady(instance?: PostHog) {
  if (instance) client = instance;
  if (!client) return;
  applyMember();
  applySignupView();
  const first = !available;
  available = true;
  if (first && typeof performance !== "undefined") readyAt = Math.round(performance.now());
  for (const item of queued.splice(0)) deliver(item);
  if (first) for (const callback of readyListeners) callback();
}

export function trackTraffic(event: EventName, properties: Properties = {}) {
  deliver({ event, properties });
}

function deliver(item: Queued) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || typeof window === "undefined") return;
  if (!available || !client) { if (queued.length < 30) queued.push(item); return; }
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) return;
  if (isQaVisitor()) return; // the QA Lab's own browsers (lib/qaEmail)
  try {
    if (item.event === "$exception" && item.error) { client.captureException(item.error, item.properties); return; }
    client.capture(item.event, { ...item.properties, $pathname: window.location.pathname }, { transport: "sendBeacon", send_instantly: true });
  } catch { /* Analytics must never interrupt signup or checkout. */ }
}

/* A CLICK THAT BEATS THE LIBRARY (landing-e pass C, 2026-09-11). posthog-js
   now loads after the page; a CTA click in the first seconds queues its
   event and then navigates away, and an in-memory queue would go with it.
   On pagehide (and when the tab is hidden) any queued events are sent by
   beacon straight to the capture endpoint, under the same distinct_id
   posthog-js will adopt when it loads on the next page: the id is written
   into the persistence record the library reads at init. */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// The same /ingest proxy as posthog-capture (next.config.ts rewrites it to PostHog US).
const HOST = "/ingest";
/** A v4 UUID; `crypto.randomUUID` needs a secure context, a LAN address is not one. */
function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function distinctId(): string {
  const name = `ph_${KEY}_posthog`;
  try {
    const raw = localStorage.getItem(name);
    const rec = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (typeof rec.distinct_id === "string" && rec.distinct_id) return rec.distinct_id;
    const id = uuid();
    localStorage.setItem(name, JSON.stringify({ ...rec, distinct_id: id, $device_id: id }));
    return id;
  } catch {
    return uuid();
  }
}
function flushByBeacon() {
  if (!KEY || available || !queued.length || typeof navigator === "undefined" || !navigator.sendBeacon) return;
  const path = window.location.pathname;
  if (path === "/admin" || path.startsWith("/admin/") || isQaVisitor()) { queued.length = 0; return; }
  const id = distinctId();
  const now = new Date().toISOString();
  const batch = queued.splice(0).map((q) => ({
    event: q.event,
    // No instance, so no parsed frames: type and message are what the beacon carries.
    properties: { ...(q.error ? { $exception_list: [{ type: q.error.name, value: q.error.message, mechanism: { handled: true, synthetic: false } }], $exception_level: "error" } : {}), ...(signupView ? { signup_view: signupView } : {}), ...q.properties, $pathname: path, $current_url: window.location.href.split("#")[0], $lib: "web", $lib_version: "beacon", distinct_id: id, jf_hostname: window.location.hostname },
    timestamp: now,
  }));
  try {
    navigator.sendBeacon(`${HOST.replace(/\/$/, "")}/e/?ip=1&_=${Date.now()}`, new Blob([JSON.stringify({ api_key: KEY, batch })], { type: "text/plain" }));
  } catch { /* nothing to do */ }
}
/** Send whatever is queued now, by beacon — for an event queued inside a pagehide handler that ran after ours. */
export function flushTrafficNow() { flushByBeacon(); }
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushByBeacon);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushByBeacon(); });
}

export function trafficIdentity(): { distinctId: string; sessionId: string; hostname: string; environment: string } | undefined {
  if (!available || !client || typeof window === "undefined" || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return undefined;
  try {
    return { distinctId: client.get_distinct_id(), sessionId: client.get_session_id(), hostname: window.location.hostname,
      environment: window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "development" : "production" };
  } catch { return undefined; }
}

/** Call only after a future variant has actually rendered. Assignment alone is not exposure. */
export function trackTrafficExperiment(experiment: string, variant: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(experiment) || !/^[a-zA-Z0-9_-]{1,80}$/.test(variant)) return;
  trackTraffic(TRAFFIC_EVENTS.exposure, { experiment, variant });
}

/* ERRORS THE VISITOR SAW (2026-09-20). app/error.tsx and app/global-error.tsx
   report here. What goes out: the message (emails and long digit runs struck,
   300 chars), Next's digest, the route with ids folded to [id], and who hit
   it in the coarsest terms — role, plan, organization id. Never field text,
   names or addresses. The signed-in layouts set that context through
   <TrafficContext>; module state, so it outlives the layout the error
   boundary has just replaced. */
type ErrorContext = { role: string | null; plan: string | null; organizationId: string | null };
let errorContext: ErrorContext = { role: null, plan: null, organizationId: null };
export function setTrafficContext(next: ErrorContext) { errorContext = next; }

/* WHO IS IN THE APP (owner, 2026-10-01: "a member in the app — at least show
   the company or the name"). The signed-in layouts hand over the organization
   and user ids; they ride on every later event as super properties, so the
   admin's live view can tell which company is in the app. Ids only — the
   names are looked up by the admin's server action, never sent here. */
let member: { org: string; user: string } | null = null;
function applyMember() {
  if (!client || !member) return;
  try { client.register({ jf_org_id: member.org, jf_user_id: member.user }); } catch { /* analytics never breaks the app */ }
}
export function setTrafficMember(organizationId: string | null, userId: string | null) {
  if (!organizationId || !userId) return;
  if (member && member.org === organizationId && member.user === userId) return;
  member = { org: organizationId, user: userId };
  applyMember();
}

/* THE SIGN-UP SCREEN (2026-10-22, lib/signupView): the screen this visitor's sign-up was drawn in — the page or the
   app — rides on every later event as a super property, so any step on the traffic page can be split by it. */
let signupView: string | null = null;
function applySignupView() {
  if (!client || !signupView) return;
  try { client.register({ signup_view: signupView }); } catch { /* analytics never breaks the app */ }
}
export function setTrafficSignupView(view: "app" | "page") {
  if (signupView === view) return;
  signupView = view;
  applySignupView();
}

/** /dashboard/proposals/cmf3k2… → /dashboard/proposals/[id]; portal tokens fold the same way. */
export function trafficRoute(pathname: string): string {
  return pathname.split("/").map((seg) =>
    /^\d+$/.test(seg) || (seg.length >= 16 && /\d/.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg)) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) ? "[id]" : seg).join("/");
}
const scrubMessage = (message: string) =>
  message.replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, "[email]").replace(/\d{6,}/g, "[n]").slice(0, 300);

const reported = new WeakSet<object>();
/** `boundary: "global"` means the root layout is gone and the library with it: send now, by beacon. */
export function trackException(error: Error & { digest?: string }, boundary: "route" | "global") {
  if (!KEY || typeof window === "undefined" || reported.has(error)) return;
  // The same choice the capture provider applies; a queued event never outruns it.
  if (!effectiveConsent().analytics) return;
  reported.add(error);
  const message = scrubMessage(String(error.message ?? ""));
  // The instance reads the message off the error itself — hand it the scrubbed one.
  const safe = new Error(message);
  safe.name = error.name || "Error";
  if (error.stack) { const [head, ...frames] = error.stack.split("\n"); safe.stack = [scrubMessage(head), ...frames].join("\n"); }
  deliver({
    event: "$exception", error: safe,
    properties: {
      message, boundary, digest: error.digest ?? "", route: trafficRoute(window.location.pathname),
      role: errorContext.role ?? "none", plan: errorContext.plan ?? "none",
      organizationId: errorContext.organizationId ?? "",
    },
  });
  // On the sign-up form a crash is the visitor's last sight of us: the form's watcher reads it as ours (2026-10-14).
  if (window.location.pathname.startsWith("/auth/register")) {
    // …unless the words are the browser's own (an in-app webview's bridge gone): not ours (2026-10-30).
    const outside = isBrowserNoise(message);
    deliver({ event: TRAFFIC_EVENTS.signupProblem, properties: { reason: outside ? "browser_error" : "page_crash", side: outside ? "outside" : "ours", message, screen: "", step: "" } });
  }
  if (boundary === "global") flushByBeacon();
}
