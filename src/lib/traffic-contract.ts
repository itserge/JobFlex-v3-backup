export type TrafficAudience = "all" | "new" | "returning";
export type TrafficEnvironment = "all" | "production" | "development";
export interface TrafficFilters {
  from: string;
  to: string;
  timezone: string;
  audience: TrafficAudience;
  environment: TrafficEnvironment;
  page: string;
  source: string;
  device: string;
  host: string;
  flow: "all" | "standard" | "google" | "otp";
  windowDays: number;
  billingMode: "live" | "test" | "all";
  /** Admins only: count before TRAFFIC_SINCE too (lib/traffic-visitor). Off by default. */
  fullHistory: boolean;
}
export interface TrafficTotals {
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  repeatVisitors: number;
  sessions: number;
  pageviews: number;
}
/** One day of the selected range. The daily extras (2026-10-01): the
 *  estimated people ($ip + $raw_user_agent, unique that day), the FB / IG
 *  in-app visitors and people, and the visitors per ad tag for the
 *  reconciliation with Ads Manager. */
export interface TrafficDaily { people: number; inAppVisitors: number; inAppPeople: number; adsFb: number; adsIg: number; adsAn: number; adsFbclid: number; adsAny: number }
export interface TrafficPoint extends TrafficTotals, TrafficDaily { date: string }
export interface TrafficPage extends TrafficTotals { page: string }
export interface TrafficBreakdown { name: string; visitors: number; sessions: number; conversions: number }
export interface FunnelStage { id: string; label: string; visitors: number }
export interface ExperimentResult {
  experiment: string;
  variant: string;
  visitors: number;
  attempts: number;
  completed: number;
  mixedVisitors: number;
  /** Verified signups by the mode the server recorded (lib/signupMode). */
  completedByMode?: { "3-step": number; "2-step": number; passwordless: number; unknown: number };
}

/** A missing or malformed analytics count is unavailable, never a fabricated zero. */
export function experimentResultFromRow(row: unknown): ExperimentResult {
  if (!Array.isArray(row) || row.length < 6 || typeof row[0] !== "string" || !row[0] || typeof row[1] !== "string" || !row[1]) {
    throw new Error("PostHog returned an invalid experiment result.");
  }
  const count = (value: unknown): number => {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
      throw new Error("PostHog returned an unavailable experiment count.");
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("PostHog returned an invalid experiment count.");
    return n;
  };
  const [visitors, attempts, completed, mixedVisitors] = row.slice(2, 6).map(count);
  if (attempts > visitors || completed > visitors) throw new Error("PostHog returned inconsistent experiment counts.");
  const byMode = row.length >= 10 ? row.slice(6, 10).map(count) : null;
  return { experiment: row[0], variant: row[1], visitors, attempts, completed, mixedVisitors, ...(byMode ? { completedByMode: { "3-step": byMode[0], "2-step": byMode[1], passwordless: byMode[2], unknown: byMode[3] } } : {}) };
}
export interface StageVisitor {
  id: string;
  reachedAt: string;
  lastSeen: string;
  device: string;
  browser: string;
  os: string;
  country: string;
  region: string;
  city: string;
  source: string;
  referrer: string;
  campaign: string;
  sessions: number;
  views: number;
  furthest: string;
  personUrl: string | null;
}
export interface StageVisitorsReport {
  stage: { id: string; label: string };
  filters: TrafficFilters;
  total: number;
  visitors: StageVisitor[];
  fetchedAt: string;
}
/** PostHog did not answer (2026-10-03): what is on screen is the last answer
 *  it did give, read at `since`. `scope` names the part that is old when the
 *  rest is fresh ("the totals", "pages, funnel"); none = all of it. */
export interface StaleNote { since: string; reason: string; scope?: string }
/** 9:41 PM — or Oct 30, 9:41 PM for an answer from another day. */
function staleClock(since: string, timezone: string): string {
  try {
    const d = new Date(since);
    const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(x);
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", ...(day(d) === day(new Date()) ? {} : { month: "short", day: "numeric" }) }).format(d);
  } catch { return since; /* an unreadable time or zone: the stamp as it came */ }
}
/** "PostHog unavailable, showing data from 9:41 PM" — the one wording, everywhere. */
export function staleLabel(stale: StaleNote, timezone: string): string {
  return `PostHog unavailable${stale.scope ? ` for ${stale.scope}` : ""}, showing data from ${staleClock(stale.since, timezone)}`;
}
/** "as of 9:41 PM" — the small line under a figure that is PostHog's last
 *  answer (2026-11-02); the banner is for a page with nothing to show. */
export function asOfLabel(stale: StaleNote, timezone: string): string {
  return `as of ${staleClock(stale.since, timezone)}`;
}
export interface TrafficReport {
  filters: TrafficFilters;
  fetchedAt: string;
  status: "ok" | "disabled" | "error";
  message?: string;
  /** Set when some or all of the figures are the last good answer, not a fresh one. */
  stale?: StaleNote;
  errors: string[];
  totals: TrafficTotals | null;
  previous: TrafficTotals | null;
  lifetime: number | null;
  today: number | null;
  firstTrackedAt: string | null;
  firstStepAt: string | null;
  /** The range's estimated people and its FB / IG in-app share (2026-10-01). */
  people: { people: number; inAppVisitors: number; inAppPeople: number } | null;
  points: TrafficPoint[];
  pages: TrafficPage[];
  sources: TrafficBreakdown[];
  referrers: TrafficBreakdown[];
  campaigns: TrafficBreakdown[];
  devices: TrafficBreakdown[];
  browsers: TrafficBreakdown[];
  countries: TrafficBreakdown[];
  terms: TrafficBreakdown[];
  hosts: TrafficBreakdown[];
  funnel: FunnelStage[];
  funnelOutcomes: { trials: number; purchases: number; other: number; trialAttempts: number; purchaseAttempts: number } | null;
  experiments: ExperimentResult[];
  /** Landing variant d vs e (pass A): visitors whose first registration step
   *  carried `variant` ("e") or not ("d"), and how many of them completed a
   *  verified signup inside the conversion window. */
  variants: VariantFunnel[];
  modes: ModeFunnel[];
}
export interface VariantFunnel { variant: "d" | "e"; started: number; completed: number }
/** Sign-ups by mode (lib/signupMode): starts by the mode of the visitor's first
 *  step, their completions inside the window, and completions by the mode the
 *  server recorded on them. "unknown" = events from before modes were recorded. */
export interface ModeFunnel { mode: string; started: number; completed: number; recorded: number }

export const TRAFFIC_EVENTS = {
  step: "jf_registration_step_viewed",
  attempt: "jf_checkout_attempted",
  opened: "jf_checkout_opened",
  completed: "jf_signup_completed",
  error: "jf_registration_error",
  exposure: "jf_experiment_exposed",
  // One per landing load: which trade hero was shown ("default" when none)
  // plus the visit's utm_*. Fired by the landing's LandingVariantEffects.
  landingView: "landing_view",
  // One per click on a landing CTA: placement (hero | google | sticky |
  // footer | nav | intro | integrations; "pill" in events before 2026-10-14,
  // when the gold launch link left the hero), the button's words, the trade
  // hero shown, the target path. Fired by the landing's CtaTracker (2026-09-09).
  ctaClick: "cta_click",
  // The HVAC landing's hero window (2026-10-01): a step reached — by the
  // clock ("auto", once per load) or by a tap — and a tier / size / SEER2
  // picked. Fired by landing-e/hvac-estimator-shot.tsx; always industry "hvac".
  hvacDemoStep: "hvac_demo_step",
  hvacDemoTier: "hvac_demo_tier",
  // The first screen's demo film on the HVAC, roofing and fencing landings
  // (2026-10-19): `demo_play` once it starts, then `demo_25` / `demo_50` /
  // `demo_100` as a quarter, half and all of it has played (the film's own
  // time) — `kind` "video". Each once per landing per browser session. Fired
  // by landing-e/demo-film.tsx (demo-track), with industry and landing the
  // landing's key ("hvac", "roofing", "fencing") and the `hook` when the
  // headline was an ad's.
  demoPlay: "demo_play",
  demo25: "demo_25",
  demo50: "demo_50",
  demo100: "demo_100",
  // The same film when the browser could play none of its files (2026-10-19):
  // `code` the MediaError code (0 when every <source> failed, so there is no
  // MediaError), `reason` "media" | "no_source", the browser's `message`,
  // the file it tried and the `ua`. The poster stays. Once per landing load.
  demoError: "demo_error",
  // One per landing section the visitor actually reaches (the analyst,
  // 2026-10-02): section key (lib/landing-sections), its index, seconds since
  // the page opened, the trade hero shown. Fired by landing-e/section-tracker.
  // Several per visit, so the report's `raw` CTE leaves it out — only the
  // analyst's own query reads it (lib/traffic-analyst).
  landingSection: "landing_section",
  // The first screen as the visitor's own phone drew it (the analyst,
  // 2026-10-04): ms from the tap to the first paint, to the headline being
  // visible (hero-entrance), to the page's JavaScript being ready and to the
  // tracking loading; KB downloaded; the connection where Chrome names it
  // ("4g", "3g"; "" elsewhere). One per landing load, once the headline has
  // shown — or, leaving before that, `shown` false with the moment they
  // left. Fired by landing-e/landing-timing.tsx; the analyst alone reads it.
  landingTiming: "landing_timing",
  // Step 1 of the sign-up as it became usable (2026-10-04): `outcome`
  // "ready" once per form load — ms until the form's JavaScript took over,
  // whether the visitor had typed (`typed_before_ready`) or pressed Continue
  // (`early_submit`) before that — then "continue" when step 1 passes and
  // "error" with `reason` when it refuses. Fired by
  // auth-register-blueprint/register-content.tsx; the analyst alone reads it.
  signupStep1: "signup_step1",
  // WATCHING THE SIGN-UP FORM (owner, 2026-10-14: "we need to see in real
  // time what they're doing exactly, and at which point they leave — is it
  // our side?"). Fired by lib/signup-watch on /auth/register:
  //   signup_field   — a box left: which one (never what was typed), ms in it,
  //                    filled, valid, edits, the screen it was on;
  //   signup_problem — every refusal and failure the visitor met, with the
  //                    reason, "ours" / "theirs", and the words they saw
  //                    (emails and long digit runs struck);
  //   signup_away / signup_back — the tab hidden (often: reading the code
  //                    email) and the return, with how long;
  //   signup_leave   — the page closed or left: the screen, the box, ms on
  //                    the step and on the page, the last problem, and where
  //                    it went ("closed", "google", "done").
  // Several per visit, so the report's `raw` CTE leaves them out
  // (DETAIL_EVENTS); the live view, the form report and the alerts read them.
  signupField: "signup_field",
  signupProblem: "signup_problem",
  signupAway: "signup_away",
  signupBack: "signup_back",
  signupLeave: "signup_leave",
  // THE HAND-OFF TO STRIPE, BY THE SERVER (2026-10-19): /auth/register/checkout answered with a 303 to Stripe's
  // card page — `reason` step1 (the email step), google (back from Google), relogin (a sign-up reopened later),
  // plan_pick (a plan card pressed); `plan`, `interval`. Sent from the server (lib/traffic-capture-server).
  checkoutRedirect: "signup_checkout_redirect",
  // The plan cards drawn without a press (2026-10-19): `reason` returned (Stripe's back arrow, or Back) or
  // checkout_failed (the card page did not open). Fired by auth-register-blueprint/register-content.tsx.
  plansShown: "signup_plans_shown",
  // THE COST GUIDES (2026-10-26, /cost/<work>/<city>): `seo_cost_view` once per
  // guide load with `trade` and `city` (the slugs); `seo_cost_cta` per click on
  // one of its calls to action — `which` is quotes_calc / quotes_block (the
  // homeowner's request) or pro_calc / pro_footer / pro_inline (the
  // contractor landing). Fired by components/seo-cost/cost-track.tsx.
  seoCostView: "seo_cost_view",
  seoCostCta: "seo_cost_cta",
  // "PRICE MY PROJECT" (2026-10-27; in the homeowner portal, /homeowner/price/<trade>, since 2026-10-28): the
  // homeowner's own estimators. `price_start` once per flow load (`trade`), `price_address` when the house is
  // confirmed (`state`), `price_range` when a range is shown (`basis` solar | size, `cached`), `price_lead` on "Get
  // quotes", `price_email_only` on "Email me this range"; `price_pick` when the portal's box sends them into an
  // estimator (`trade`, `via` nudge | tile — the nudge is the one their words lit). Fired by
  // components/v3/price-my-project/*.
  priceStart: "price_start",
  priceAddress: "price_address",
  priceRange: "price_range",
  priceLead: "price_lead",
  priceEmailOnly: "price_email_only",
  pricePick: "price_pick",
} as const;

/** Events that come several per visit: the report's `raw` CTE leaves them out (lib/traffic-query). */
export const DETAIL_EVENTS: ReadonlySet<string> = new Set([
  TRAFFIC_EVENTS.landingSection,
  TRAFFIC_EVENTS.signupField,
  TRAFFIC_EVENTS.signupProblem,
  TRAFFIC_EVENTS.signupAway,
  TRAFFIC_EVENTS.signupBack,
  TRAFFIC_EVENTS.signupLeave,
  TRAFFIC_EVENTS.seoCostCta,
]);

/** Signups read from the database by what the landing recorded on them. */
export interface SignupAttribution {
  from: string;
  to: string;
  total: number;
  dimensions: Record<"landingIndustry" | "signupVariant" | "utmSource" | "utmMedium" | "utmCampaign" | "utmContent", Array<{ name: string; signups: number }>>;
}

export function pageLabel(page: string): string {
  const labels: Record<string, string> = {
    "/": "Landing page", "/auth/login": "Login", "/auth/register": "Registration entry",
    "registration:1": "Step 1 / Account", "registration:2": "Step 2 / Company", "registration:3": "Step 3 / Plan",
    "registration:code": "Step 1 / Email code",
  };
  return labels[page] ?? page;
}

export function percent(value: number, total: number): number | null {
  return total > 0 ? value / total * 100 : null;
}

/** Wilson interval: uncertainty for a conversion rate, not a significance verdict. */
export function conversionInterval(converted: number, exposed: number): [number, number] | null {
  if (!exposed) return null;
  const p = converted / exposed;
  const z2 = 1.96 ** 2;
  const center = p + z2 / (2 * exposed);
  const spread = 1.96 * Math.sqrt(p * (1 - p) / exposed + z2 / (4 * exposed ** 2));
  return [(center - spread) / (1 + z2 / exposed) * 100, (center + spread) / (1 + z2 / exposed) * 100];
}
