"use client";
import { safeNextPath } from "@/lib/safeNext";

// SIGN IN — BLUEPRINT · the page.
// Route: /auth/login.
//
// A verbatim port of the approved mockup `jobflex-auth-login-blueprint.html`.
// Not a redesign: every string of copy, every class name and every CSS
// declaration is the source's (see ./login.module.css for the stylesheet and
// its drop/restore notes).
//
// ── REPLACEMENT, NOT A FORK ────────────────────────────────────────────
// This file REPLACES the previous /auth/login markup in place. It does not
// ship beside it as `/auth/login-blueprint`. That REVERSES the side-by-side
// convention once asserted in the header of
// src/app/dashboard/subscription-blueprint/page.tsx ("the standing repo
// convention a donor surface is never overwritten by its successor") — a file
// deleted 2026-08-12 when its port was itself promoted over the donor; for the
// auth family the instruction was replacement from the start.
//
// The old page's `md:hidden` MobileLogin half went with it: the source's own
// media queries (1000px / 560px / max-height 620px) are what makes this page
// responsive, so a second hand-built mobile tree would be a second design.
// ./mobile-login.tsx was deleted — it had exactly one importer, this file.
//
// ── STANDALONE CHROME ──────────────────────────────────────────────────
// Auth pages carry their own frame. Nothing here is mounted inside
// blueprint-shell and no shell file was touched. The wrapper <div> wears the
// literal global class `jf-auth-login`, which is the root every rule in
// login.module.css hangs off; everything else is a hashed local class reached
// through cx() by the source's literal names.
//
// ── AUTH BEHAVIOUR IS THE OLD PAGE'S, UNCHANGED ────────────────────────
// The mockup's <script> is a fake: it accepts the literal password
// "password123" and fakes a 900ms success. Only its UI behaviour is ported —
// the show/hide password toggle, the inline error slot, the "Signing in…" →
// check-mark "Signed in" button progression, and the Google button's busy
// label. The credentials themselves still go through NextAuth exactly as
// before: same signIn("credentials", { redirect: false }) call, same ?next=
// open-redirect guard, same three error branches, same toasts, same
// router.push + refresh, same dev-only prefill. No server action, no API
// route, no Prisma — the data layer was not touched.
//
// Two of the source's strings line up with the live handler by luck and are
// kept: its empty-field message ("Enter your email and password.") becomes the
// client-side guard, and its wrong-password message is byte-identical to the
// one the old page already showed for a CredentialsSignin result.

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import styles from "./login.module.css";
import { ProductMark } from "@/components/brand/ProductMark";

/**
 * Class list by the SOURCE's literal names, so the JSX below reads as the
 * mockup's markup does and the stylesheet stays diffable against it. Any name
 * the module does not export is emitted literally (none on this page — every
 * class in the login markup has a rule, `is-hidden` included, since the source
 * only ever writes it compounded as `.err.is-hidden`).
 */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => styles[n as string] ?? (n as string))
    .join(" ");
}

/** The source's inline <symbol> sheet, character for character. */
function LoginSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2"/><path d="M6.6 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M3 3l18 18"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></symbol>
      <symbol id="i-google" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.97 6.19C6.51 42.62 14.62 48 24 48Z"/>
      </symbol>
    </svg>
  );
}


/** NextAuth's ?error= codes, in the product's words. */
function authErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "AccessDenied":
      return "Google sign-in was refused for that address. Sign in with your email and password, or use the Google account that matches it.";
    case "OAuthAccountNotLinked":
      return "That email already has a password account. Sign in with the password.";
    case "OAuthCallbackError":
    case "OAuthSignin":
    case "OAuthCallback":
      return "Google sign-in didn't complete. Try again.";
    case "Configuration":
      // Auth.js says "Configuration" for ANY failure it cannot classify — on
      // 2026-09-12 that was a Google sign-in started on jobflex-v3.vercel.app
      // whose callback landed on www.jobflex.app. Say the thing that fixes it.
      return "Sign-in didn't complete. Open www.jobflex.app and try again — starting from another address breaks the Google hand-off.";
    default:
      return "Sign in didn't work. Try again.";
  }
}

function LoginInner() {
  const search = useSearchParams();
  // Only honor same-site relative paths so `?next=` can't be used as an open
  // redirect (reject absolute URLs and protocol-relative `//evil.com`).
  // A prefix check alone is not enough (`/\evil.com` resolves off-site) —
  // see lib/safeNext for the origin comparison.
  const nextPath = safeNextPath(search.get("next"));
  // Prefill the demo address only in local development — never in production.
  // The password is not prefilled (2026-10-10): the form opens on the code in
  // development as in production, and a filled password would switch it.
  const isDev = process.env.NODE_ENV === "development";
  // ?email= prefills the address (a used trial confirmation link lands here,
  // /auth/register/confirm); the dev prefill stands only without it.
  const emailParam = search.get("email")?.trim().slice(0, 200) || null;

  return (
    <div className="jf-auth-login">
      <LoginSprite />

      <main className={cx("auth")}>
        <section className={cx("auth-form")}>
          <Link className={cx("brand")} href="/"><ProductMark /><span className={cx("brand-name")}>JobFlex</span></Link>

          {/* The "Sign in" kicker is gone (2026-09-02): the heading and the
              button both already say it. Same call as register step 1. */}
          <h1 className={cx("auth-h1")}>Welcome back.</h1>

          {/* THE FORM (2026-10-10): Google, then the email and "Email me a
              code"; the password one link away (components/auth/login-form).
              NextAuth's ?error= codes arrive as its first message. */}
          {/* One door (owner, 2026-10-21): the "Open: JobFlex platform / Deck Studio" switch is gone — the studio is a page of the platform. */}
          <LoginForm
            nextPath={nextPath}
            initialEmail={emailParam ?? (isDev ? "owner@acme.test" : "")}
            initialPhone={search.get("phone")?.trim().slice(0, 20) || ""}
            initialError={authErrorMessage(search.get("error"))}
          />

          <div className={cx("foot")}>Don&apos;t have an account? <Link className={cx("link-ink")} href={"/auth/register" as never}>Create an account</Link></div>

        </section>

        <aside className={cx("auth-side")}>
          <div className={cx("side-wash")}></div>
          {/* THE ART PANEL. This column used to carry a testimonial card
              quoting a customer who does not exist — the one thing a sign-in
              page should not do. It carries a picture now: generated for this
              panel in the product's own drawing language (cream ground, ink
              outlines, hard offset shadows, one blue, no lettering).
              public/auth/side-blueprint.png is the drawn alternative, kept beside
              it; swapping is these sources. Desk only and light (2026-10-16):
              a phone hides this column, so the sources match only a desk and a
              phone gets the 1×1 placeholder instead of the 1.3 MB PNG; the desk
              gets the 60 KB WebP (PNG without WebP). See register-content. */}
          <picture>
            <source media="(min-width: 1001px)" srcSet="/auth/side-site-2.webp" type="image/webp" />
            <source media="(min-width: 1001px)" srcSet="/auth/side-site-2.png" />
            <img className={cx("side-art")} src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="" aria-hidden="true" decoding="async" />
          </picture>
        </aside>
      </main>
    </div>
  );
}

// ── VIEWPORT SWITCH ────────────────────────────────────────────────────
// One URL, two designs: this desktop build above 768px, the handheld rebuild
// at or below it. A MEDIA QUERY, never the user agent — the mobile-first rule
// forbids UA detection, and a query is also the only thing that makes DevTools'
// device toolbar work: drag the viewport under 768px and the surface swaps
// live, no reload and no second URL to remember.
//
// The switch lives inline in this file rather than in a sibling
// `login-responsive.tsx`, because such a file would have to import LoginInner
// from here while this file imported the switch from it — a cycle. Register
// gets a sibling file instead: its page is a server component, so the cycle
// cannot arise there.
//
// The handheld build previously shipped only at /mobile-v1/auth/login, which
// nothing linked to. That preview URL still works; this is what makes the real
// URL serve it.

/** CLAUDE.md's handheld target: ≤768px. Matches the mobile module's own scale. */
const HANDHELD = "(max-width: 768px)";

// Paper-coloured full-bleed hold for the one chunk fetch that happens when the
// viewport first crosses 768px. Without it `dynamic` renders null and the swap
// blinks through to whatever is behind the app — which reads as a crash rather
// than a load. Inline styles on purpose: this has to paint before the handheld
// stylesheet has been fetched, which is also why the #f2f0eb drafting cream is
// written out rather than read from a token.
const MobileHold = () => (
  <div style={{ position: "fixed", inset: 0, zIndex: 45, background: "#f2f0eb" }} />
);

// Imported out of the (mobile) tree rather than copied, so /auth/login and
// /mobile-v1/auth/login cannot drift apart — one implementation, two entry
// points. Lazy and `ssr: false` so a desktop visitor never downloads the
// handheld bundle or its stylesheet for a tree they will not render.
const MobileLogin = dynamic(
  () =>
    import("@/components/v3/mobile-auth-login/mobile-login-content").then(
      (m) => m.MobileLoginContent,
    ),
  { ssr: false, loading: MobileHold },
);

// Module scope so the identities are stable across renders — a fresh
// `subscribe` on every render makes useSyncExternalStore re-subscribe each
// time, which on a resize-driven store means tearing down the listener in the
// middle of the resize that triggered the render.
function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
// The server cannot know the viewport, so it renders desktop and the client
// corrects during hydration. A phone therefore shows desktop for one frame; the
// alternative — render nothing until mounted — flashes blank for every visitor
// at every viewport, a worse trade on the app's entry page.
const getServerSnapshot = () => false;

// EXACTLY ONE TREE IS MOUNTED, never both. Both branches call
// signIn("credentials") against the same handler and both read `?next=`; two
// live forms would put a second set of email/password fields in the tab order
// and let a password manager fill the hidden one.
function LoginSwitch() {
  const isHandheld = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isHandheld ? <MobileLogin /> : <LoginInner />;
}

// useSearchParams() must sit under a Suspense boundary for static prerender
// (Next.js CSR-bailout requirement). Both branches call it, so the boundary
// wraps the switch rather than either tree.
export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginSwitch />
    </React.Suspense>
  );
}
