import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { withSentryConfig } from "@sentry/nextjs";

// Content-Security-Policy, REPORT-ONLY for the first release. Enumerated from
// the third parties the code actually loads: Stripe.js + Checkout, PayPal and
// Square JS SDKs, Google Maps JS/static/geocode, PostHog, Vercel Blob images,
// Google avatars. 'unsafe-inline' for script is required by the blueprint
// pages' inline behaviour scripts until a per-request nonce lands; the header
// is Report-Only so a missed host shows up in the console instead of breaking
// checkout on launch day. Promote to Content-Security-Policy once a week of
// reports is clean.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com https://www.paypal.com https://www.sandbox.paypal.com https://web.squarecdn.com https://sandbox.web.squarecdn.com https://maps.googleapis.com https://us-assets.i.posthog.com https://us.i.posthog.com https://connect.facebook.net https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https://*.public.blob.vercel-storage.com",
  "connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://maps.googleapis.com https://places.googleapis.com https://www.paypal.com https://www.sandbox.paypal.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://*.public.blob.vercel-storage.com https://vercel.live wss://ws-us3.pusher.com https://www.facebook.com https://connect.facebook.net https://accounts.google.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://www.paypal.com https://www.sandbox.paypal.com https://web.squarecdn.com https://sandbox.web.squarecdn.com https://www.google.com https://accounts.google.com https://vercel.live https://www.facebook.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  // www.facebook.com in frame-src and form-action: the Meta Pixel sends a
  // large event as a form POST into a hidden iframe (2026-10-01, it was the
  // console's only report on the landing and the register page).
  "form-action 'self' https://checkout.stripe.com https://www.facebook.com",
  "frame-ancestors 'self'",
  // `upgrade-insecure-requests` is deliberately absent: browsers ignore it in a
  // report-only policy and log a warning on every page. Add it back when this
  // header is promoted to enforcing.
].join("; ");

const nextConfig: NextConfig = {
  // A production build of its own for the mobile sweep (scripts/qa/mobile-sweep.check.ts):
  // several sessions build this checkout, and a `next build` into .next swaps the files
  // under a running `next start` — the sweep then measures half of someone else's build.
  ...(process.env.JOBFLEX_DIST_DIR ? { distDir: process.env.JOBFLEX_DIST_DIR } : {}),
  reactStrictMode: true,
  typedRoutes: true,
  // pdf.js (lib/subQuotes/pdfText, 2026-11-08) runs in Node for the estimate reader: loaded from node_modules at
  // run time, not bundled — its legacy build carries browser globals the server bundle has no use for.
  serverExternalPackages: ["pdfjs-dist"],
  // THE TYPE CHECK RUNS BEFORE THE BUILD ON VERCEL (2026-10-28). Inside `next build` it ran after the compile, in a
  // worker beside everything the compile still held, and the 8 GB build container was OOM-killed ("Running TypeScript
  // … SIGKILL"). vercel.json's buildCommand now runs `next typegen && tsc --noEmit` on its own first (about 5 GB at
  // peak) and sets JOBFLEX_TYPECHECKED=1 for `next build` only once that passed — a type error still fails the deploy.
  // Everywhere else (a local `npm run build`) the build checks types itself, as before.
  typescript: { ignoreBuildErrors: process.env.JOBFLEX_TYPECHECKED === "1" },
  // Readable stacks on Vercel PREVIEW builds only: a minified "reading '0' at
  // b (3jtyjojq….js:1:5704)" is undebuggable, and previews are where the
  // owner reproduces production-data bugs. Production stays without maps —
  // they would publish the source to anyone who opens DevTools.
  productionBrowserSourceMaps: process.env.VERCEL_ENV === "preview",
  // Do not advertise the framework in every response.
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
  // Deployment skew protection. A phone that loaded the app from one build and
  // is still open when the next one ships will, on its next navigation, ask the
  // CDN for a chunk filename only the old build ever emitted — a 404 that
  // surfaces to the user as "Application error: a client-side exception has
  // occurred", because the lazy import for the route it was mounting never
  // arrived. This app is unusually exposed to that: the handheld half of every
  // promoted route is a `dynamic(…, { ssr: false })` chunk fetched at
  // navigation time, so on a phone almost every page change is a chunk fetch.
  //
  // Stamping the build's deployment id onto asset requests lets Vercel route
  // them back to the deployment that owns them, and makes Next hard-navigate
  // instead of throwing when the ids disagree. Only set on Vercel: locally the
  // env var is absent, the key stays off, and dev keeps its normal build ids.
  //
  // The routing half needs Skew Protection switched ON in the Vercel project
  // (Settings → Advanced, or `vercel project protection enable --skew`) —
  // without it the old chunk URL still 404s and only the hard-navigate applies.
  // Config and setting are two halves of one fix; do not remove one alone.
  ...(process.env.VERCEL_DEPLOYMENT_ID
    ? { deploymentId: process.env.VERCEL_DEPLOYMENT_ID }
    : {}),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "maps.googleapis.com" },
      { protocol: "https", hostname: "oaidalleapiprodscus.blob.core.windows.net" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // A git worktree nested inside the checkout (.worktrees/<name>) has no
  // node_modules of its own and Turbopack refuses symlinks that leave the
  // project root, so such a worktree names the checkout as the root and
  // resolves packages by walking up. Unset everywhere else (the default).
  ...(process.env.JOBFLEX_TURBOPACK_ROOT ? { turbopack: { root: process.env.JOBFLEX_TURBOPACK_ROOT } } : {}),
  experimental: {
    // Turbopack's on-disk dev cache corrupted twice on 2026-09-03 ("Restore of
    // All for task … failed in another thread" panic, then a segfault on the
    // next start) and took the whole dev server down mid-session. Off until
    // Next ships a fix; cold starts are a few seconds slower, nothing else
    // changes. Re-enable by deleting this line (the default is true).
    turbopackFileSystemCacheForDev: false,
    // BUILD MEMORY (2026-11-06). Vercel's standard build box has 8 GB and 4
    // vCPUs; Next forks (vCPUs - 1) workers to collect page data and prerender,
    // each loading the server bundle (~0.6 GB). Measured cold on this app: the
    // build process alone peaks at ~8.3 GB and the whole build at ~9.1 GB, so
    // the standard box is killed during "Collecting page data" (SIGKILL, OOM)
    // whenever the restored build cache can't carry most of the compile. The
    // fix is the bigger box (Vercel → Project → Settings → Build and Deployment
    // → Build Machine); this keeps the worker count at 3 there too (8 vCPUs
    // would fork 7), so the page-data phase never adds more than ~2 GB on top
    // of the compile.
    cpus: 3,
    // "Jest worker encountered 2 child process exceptions, exceeding retry
    // limit" — the dev server's static-paths worker, not app code.
    //
    // In dev, Next forks a full child node process (next/dist/server/dev/
    // next-dev-server.js) to evaluate getStaticPaths for each dynamic route,
    // with maxRetries: 1. Two child deaths kill that pool for the LIFE of the
    // server, after which EVERY dynamic route 500s with that message — which is
    // why /api/auth/[...nextauth] started failing and no role could sign in.
    // Only a restart cleared it.
    //
    // workerThreads runs the same worker on worker_threads instead of a forked
    // process: one heap, no stdio pipes (so no `write EPIPE`), and no child to
    // die in the first place.
    //
    // DEV ONLY — see the phase switch at the bottom of this file. `next build`
    // hands its page-generation workers values a structured clone cannot carry
    // (`Error [DataCloneError]: ()=>null could not be cloned`), which fails the
    // build outright; a forked child gets those values over its own channel and
    // is fine. The flag is set per phase rather than deleted because the dev
    // crash it fixes is real.
    workerThreads: false,
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  // ONE HOST FOR SIGN-IN. Google sign-in started on jobflex-v3.vercel.app on
  // 2026-09-12: the PKCE cookie was set on that host, Google sent the browser
  // back to NEXTAUTH_URL's host (jobflex.app → www), the verifier there did not
  // match and the login page said "Auth error: Configuration". The Vercel
  // alias is not a place to be signed in from; send it to the real address
  // before any cookie is set. Preview deployments have other hostnames and
  // are untouched.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "jobflex-v3.vercel.app" }],
        destination: "https://www.jobflex.app/:path*",
        permanent: true,
      },
    ];
  },
  // Baseline HTTP security headers applied to every route. The CSP ships in
  // Report-Only mode first (see CSP_REPORT_ONLY above).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // microphone=(self): the Smart Proposal brief is dictated in the
          // browser (2026-09-18) — "()" made every browser refuse the mic
          // before asking. Still closed to embedded third-party frames.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(self)",
          },
        ],
      },
      // The website estimators (2026-10-27): a contractor embeds /estimate/<slug>/<trade> in an iframe on their own
      // site, so that route may be framed anywhere — a CSP frame-ancestors rule, which browsers honour over the
      // X-Frame-Options above. The shop's own domain allow-list is enforced in the page (lib/webEstimator hostAllowed).
      {
        source: "/estimate/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

// Phase switch. The only per-phase value is experimental.workerThreads: on for
// the dev server, where it stops the static-paths worker from dying and taking
// every dynamic route down with it, and off everywhere else, where it breaks
// `next build`. Everything above is shared.
function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...nextConfig,
    experimental: { ...nextConfig.experimental, workerThreads: dev },
    ...(dev ? { webpack: relaxCssModules, allowedDevOrigins: ["192.168.88.*"] } : {}), // dev only: a phone on the LAN gets HMR, so the page hydrates
  };
}

// SENTRY SOURCE MAPS (2026-10-22; docs/sentry.md). Only a build that has
// SENTRY_AUTH_TOKEN is wrapped: it uploads the client and server source maps
// to Sentry (SENTRY_ORG / SENTRY_PROJECT name where) and deletes the browser
// maps it generated, so production still publishes none. Without the token
// the config is exactly the one above — Sentry's runtime needs no wrapper
// (src/instrumentation.ts, src/instrumentation-client.ts start it).
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : config;

// WEBPACK FALLBACK, DEV ONLY (2026-09-14). Turbopack accepts a CSS-module rule
// whose selector is `:global(...)` alone; webpack's css-loader runs CSS modules
// in "pure" mode and refuses it, and the blueprint modules carry thousands of
// them. When the native SWC binding cannot load (Windows Smart App Control
// blocks next-swc.win32-x64-msvc.node) `next dev --webpack` is the only dev
// mode there is, so under it the modules run in "local" mode: the same class
// hashing, without the purity check. Only invoked by webpack; Turbopack and
// `next build` never see it.
type LoaderUse = { loader?: string; options?: { modules?: { mode?: string } } };
type Rule = { oneOf?: Rule[]; rules?: Rule[]; use?: LoaderUse | LoaderUse[] };
function relaxCssModules(config: { module?: { rules?: Rule[] } }) {
  const visit = (rules: Rule[]) => {
    for (const rule of rules) {
      if (!rule || typeof rule !== "object") continue;
      if (rule.oneOf) visit(rule.oneOf);
      if (rule.rules) visit(rule.rules);
      const uses = Array.isArray(rule.use) ? rule.use : rule.use ? [rule.use] : [];
      for (const u of uses) if (u?.options?.modules?.mode === "pure") u.options.modules.mode = "local";
    }
  };
  visit(config.module?.rules ?? []);
  return config;
}
