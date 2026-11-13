"use client";
import { safeNextPath } from "@/lib/safeNext";

// MOBILE AUTH · SIGN IN — the component.
// Rendered by src/app/(mobile)/mobile-v1/auth/login/page.tsx → /mobile-v1/auth/login.
//
// ── SIDE BY SIDE, NOT A REPLACEMENT ────────────────────────────────────────
// This ships BESIDE the desktop /auth/login, which is untouched, per the
// mobile route strategy in CLAUDE.md ("mobile pages live side-by-side with
// existing routes"). The desktop page's own header records that the auth
// family was REPLACED in place when it was ported from the mockup; that
// instruction covered the desktop port and does not extend to this mobile
// build, which is an addition.
//
// ── DESIGN ─────────────────────────────────────────────────────────────────
// Built with the jobflex-page-styler skill (visual system: Blueprint tokens,
// palette, 2px ink frames, 2px radii, hard offset shadows with no blur, Inter
// 800/900 caps + JetBrains Mono annotation layer, Motion System "Balanced")
// and the mobile-app-ui-design skill (structure: thumb reach, ≥44px targets,
// one primary action, peak-and-end). Where the two disagree the house system
// wins — the mobile skill's soft shadows, rounded-3xl cards and 60/30/10
// palette are all overridden by DESIGN.md.
//
// The design language is translated from the desktop port
// (src/app/(auth)/auth/login/page.tsx + login.module.css), which is the source
// of truth here — there is no HTML mockup for this page. Below 1000px that
// port drops its ink drafting-sheet half and becomes an all-cream form; the
// ink band at the top of this page is that half rebuilt for handheld, so the
// mobile surface keeps the design's colour blocking rather than flattening.
//
// ── STYLES ─────────────────────────────────────────────────────────────────
// ./mobile-auth-login.css is a PLAIN stylesheet, not a CSS Module. Every
// selector is prefixed with the literal root class `.jf-mobile-auth-login`.
// See the file header for why a module is the wrong tool here.
//
// ── ICONS ──────────────────────────────────────────────────────────────────
// Inline <svg> with no `id` attribute anywhere, rather than the house
// `<symbol>` sprite + `<use href="#…">`. SVG symbol ids are document-global;
// the desktop login ships `#i-eye`, `#i-eye-off`, `#i-check` and `#i-google`
// under exactly those names, and inline elements remove the collision surface
// entirely.
//
// ── AUTH BEHAVIOUR IS THE DESKTOP PAGE'S, VERBATIM ─────────────────────────
// Same signIn("credentials", …) call with the UNTRIMMED email, same three
// error branches with byte-identical message strings, same toast.error on
// each, same router.push(nextPath) + router.refresh(), same
// signIn("google", { callbackUrl: nextPath }), same ?next= open-redirect guard
// (relative paths only; absolute URLs and protocol-relative //evil.com are
// rejected), same React.Suspense boundary around useSearchParams (in
// page.tsx), same dev-only prefill, same password show/hide toggle.
//
// DATA LAYER UNTOUCHED. No server action, no API route, no Prisma.
//
// One deliberate accessibility change from the desktop port: the toggle's
// aria-label flips with state and the button carries aria-pressed. The desktop
// port keeps a static "Show password" and flags it in place as an authored
// quirk of its donor mockup; this page has no donor and a control whose
// accessible name contradicts its state fails WCAG 2.2 AA 4.1.2, which
// DESIGN.md lists as a hard constraint.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import "./mobile-auth-login.css";
import { ProductMark } from "@/components/brand/ProductMark";

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
      return "Sign-in didn't complete. Open www.jobflex.app and try again — starting from another address breaks the Google hand-off.";
    default:
      return "Sign in didn't work. Try again.";
  }
}

export function MobileLoginContent() {
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

  // The drawing annotation in the hero only earns its place when it says
  // something: where the user lands after signing in, when that isn't the
  // default. Never rendered for the default /dashboard destination.
  const returningTo = nextPath === "/dashboard" ? null : nextPath;

  return (
    <div className="jf-mobile-auth-login">
      <header className="hero">
        <div className="hero-wash" />
        <div className="hero-inner">
          <Link className="brand rv rv-1" href="/">
            <ProductMark tone="paper" />
            <span className="brand-name">JobFlex</span>
          </Link>

          <div className="kicker rv rv-2">
            <span className="kpi-lbl">Sign in</span>
          </div>
          <h1 className="h1 rv rv-2">Welcome back.</h1>
          <p className="lede rv rv-3">
            Your proposals, jobs and money — right where you left them.
          </p>

          {returningTo ? (
            <p className="hero-note rv rv-3">
              <span>Returning to</span>
              <b>{returningTo}</b>
            </p>
          ) : null}
        </div>
      </header>

      <main className="body">
        <section className="card rv rv-4">
          {/* THE FORM (2026-10-10): Google, then the email and "Email me a
              code"; the password one link away (components/auth/login-form). */}
          {/* One door (owner, 2026-10-21): no "Open: JobFlex platform / Deck Studio" switch here either. */}
          <LoginForm
            nextPath={nextPath}
            initialEmail={emailParam ?? (isDev ? "owner@acme.test" : "")}
            initialPhone={search.get("phone")?.trim().slice(0, 20) || ""}
            initialError={authErrorMessage(search.get("error"))}
          />
        </section>

        <p className="foot">
          Don&apos;t have an account?{" "}
          <Link className="link-ink" href={"/auth/register" as Route}>
            Create an account
          </Link>
        </p>

      </main>
    </div>
  );
}
