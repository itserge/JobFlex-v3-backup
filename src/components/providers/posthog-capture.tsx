"use client";
import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PostHog } from "posthog-js";
import { trafficReady } from "@/lib/traffic-client";
import { effectiveConsent, onConsent, readConsent } from "@/lib/consent";
import { TRAFFIC_EXPERIMENTS_ACTIVE } from "@/lib/traffic-experiments";
import { isQaVisitor } from "@/lib/qaEmail";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// INGEST THROUGH OUR OWN DOMAIN (2026-11-02). Every PostHog request goes to
// /ingest/… on this site and next.config.ts rewrites it to PostHog US
// (us.i.posthog.com, static assets from us-assets.i.posthog.com), so ad and
// tracking blockers that drop *.posthog.com let it through. No env override:
// the proxy is the one route. ui_host keeps the toolbar's links on PostHog.
const HOST = "/ingest";
const UI_HOST = "https://us.posthog.com";
const internal = (path: string) => path === "/admin" || path.startsWith("/admin/");

// THE LIBRARY LOADS AFTER THE PAGE, NOT WITH IT (landing-e pass C,
// 2026-09-11). posthog-js is 259 KB raw and used to sit in the first-screen
// JavaScript of every page. It is now fetched with a dynamic import once the
// page has loaded and the browser is idle (or at the visitor's first move,
// or after 3 s — whichever comes first), then initialised exactly as
// before. Nothing is lost: $pageview is sent the moment it is ready, and
// every trackTraffic() call made before then is queued (lib/traffic-client)
// and flushed on `trafficReady(instance)`.
let loading: Promise<PostHog | null> | null = null;
function loadPostHog(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null);
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    let done = false;
    const go = () => { if (done) return; done = true; resolve(); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (document.readyState === "complete") { if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1500); }
    else window.addEventListener("load", () => { if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1500); }, { once: true });
    for (const ev of ["scroll", "pointerdown", "touchstart", "keydown"]) window.addEventListener(ev, go, { passive: true, once: true });
    setTimeout(go, 3000);
  }).then(() => import("posthog-js")).then((m) => {
    const posthog = m.default;
    if (!posthog.__loaded) {
      posthog.init(KEY, {
        api_host: HOST, ui_host: UI_HOST, capture_pageview: false, person_profiles: "identified_only",
        capture_pageleave: true, autocapture: false,
        advanced_disable_feature_flags: !TRAFFIC_EXPERIMENTS_ACTIVE,
        // Off at init; the route effect below starts it on public paths only.
        disable_session_recording: true,
        session_recording: { maskAllInputs: true, maskTextSelector: "[data-ph-mask]" },
        before_send: (event) => {
          if (!event || internal(window.location.pathname)) return null;
          // A browser that typed a QA Lab address (@qa.jobflex.test) sends nothing (lib/qaEmail).
          if (isQaVisitor()) return null;
          // Opt-in countries with no choice yet send nothing (lib/consent).
          if (!effectiveConsent().analytics) return null;
          scrubUrls(event.properties);
          return event;
        },
      });
    }
    return posthog;
  });
  return loading;
}

// SESSION REPLAY IS FOR VISITORS, NOT FOR THE SIGNED-IN APP (owner, 2026-09-05).
// Recording runs on the public surfaces — landing pages, pricing, register and
// login, the homeowner/client portals — and is stopped the moment the route is
// an authenticated one. The gate is the PATH rather than the session: the auth
// cookie is httpOnly and invisible to this script, and the public surfaces are
// public whoever is looking at them. Every input is masked in the recording.
const PRIVATE_PREFIXES = ["/dashboard", "/admin", "/w/", "/mobile-", "/v3", "/studio", "/dev", "/influencer", "/api"];
const recordable = (path: string) =>
  !PRIVATE_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));

// RECORDING STARTS AT THE FIRST INTERACTION, NOT AT PAINT (CRO stage 1,
// 2026-09-09). The recorder is a 64 KB script that used to load with the
// landing's first screen; a visitor who only reads the hero and leaves now
// costs nothing. The first scroll, tap, click or key on a public route starts
// it, and it then stays on for the rest of the visit as before.
const INTERACTION_EVENTS = ["scroll", "pointerdown", "keydown", "touchstart"] as const;
let interacted = false;
let armed = false;
let ph: PostHog | null = null;
function onFirstInteraction() {
  interacted = true;
  disarmRecording();
  if (ph && recordable(window.location.pathname)) ph.startSessionRecording();
}
function armRecording() {
  if (interacted) { ph?.startSessionRecording(); return; }
  if (armed) return;
  armed = true;
  for (const ev of INTERACTION_EVENTS) window.addEventListener(ev, onFirstInteraction, { passive: true });
}
function disarmRecording() {
  if (!armed) return;
  armed = false;
  for (const ev of INTERACTION_EVENTS) window.removeEventListener(ev, onFirstInteraction);
}

// Preserve attribution, never signup tickets, OAuth handles or Stripe return tokens.
// The landing's trade (`?industry=roofing`, alias `?trade=`) is kept too: it is
// which ad they came from, and the admin's live view names the trade by it.
function safeUrl(value: string): string {
  if (!value || value === "$direct") return value;
  try {
    const url = new URL(value, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (!/^(utm_(source|medium|campaign|content|term)|industry|trade)$/.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}
function scrubUrls(properties: Record<string, unknown>) {
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && /\$(?:(initial_)?(current_url|referrer)|session_entry_url)$/.test(key)) properties[key] = safeUrl(value);
    if ((key === "$set" || key === "$set_once") && value && typeof value === "object") scrubUrls(value as Record<string, unknown>);
  }
}

export function PostHogCapture() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastUrl = React.useRef("");
  const [loaded, setLoaded] = React.useState(false);

  // Bring the library in on the page's own time, then let the effects below run.
  React.useEffect(() => {
    if (!KEY) return;
    let alive = true;
    void loadPostHog().then((instance) => {
      if (!alive || !instance) return;
      ph = instance;
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  // The cookie banner's analytics choice (lib/consent): "essential only"
  // opts the browser out of capture and replay; a later "accept" opts back
  // in. No decision yet follows the country: capture in the notice model,
  // nothing in the opt-in one (before_send drops it until a choice).
  React.useEffect(() => {
    if (!KEY || !loaded || !ph) return;
    const posthog = ph;
    const apply = (analytics: boolean) => {
      if (!posthog.__loaded) return;
      if (analytics) posthog.opt_in_capturing();
      else { posthog.stopSessionRecording(); posthog.opt_out_capturing(); }
    };
    const c = readConsent();
    if (c) apply(c.analytics);
    return onConsent((next) => apply(next.analytics));
  }, [loaded]);

  React.useEffect(() => {
    if (!KEY || !pathname || !loaded || !ph) return;
    const posthog = ph;
    if (internal(pathname)) { lastUrl.current = ""; disarmRecording(); posthog.stopSessionRecording(); return; }
    if (!effectiveConsent().analytics) { disarmRecording(); posthog.stopSessionRecording(); return; }
    if (recordable(pathname)) armRecording();
    else { disarmRecording(); posthog.stopSessionRecording(); }
    posthog.register({ jf_hostname: window.location.hostname,
      jf_environment: ["localhost", "127.0.0.1"].includes(window.location.hostname) ? "development" : "production" });
    const url = safeUrl(window.location.origin + pathname + (searchParams?.size ? `?${searchParams}` : ""));
    if (lastUrl.current !== url) {
      lastUrl.current = url;
      posthog.capture("$pageview", { $current_url: url, $pathname: pathname });
    }
    trafficReady(posthog);
  }, [pathname, searchParams, loaded]);
  return null;
}
