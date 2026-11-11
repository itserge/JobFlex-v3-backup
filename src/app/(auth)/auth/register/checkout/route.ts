// THE SIGN-UP'S HAND-OFF TO STRIPE, MADE BY THE SERVER (owner, 2026-10-19).
//
// Until now the browser handed itself to Stripe: the plan step asked /api/checkout/signup for a session and set
// window.location to it, and a back-out was told apart by a mark in sessionStorage. On a phone that hand-off could
// stall or be thrown away (Safari, Facebook's and Instagram's in-app browsers), and the page then drew Professional's
// own screen with "Add your card" — right after step 1, for the person who reported it. Here the answer to one request
// is a 303 to Stripe's card page, so the hand-off needs no script and nothing kept in the browser:
//
//   GET  ?signup=<token>&reason=step1|google|relogin            the plan the sign-up rule picks (lib/signupAutoPlan:
//                                                                Professional, monthly), with the 7-day trial
//   GET  ?signup=<token>&plan=<slug>&interval=MONTH|YEAR&reason=plan_pick   a plan card pressed
//   POST name, email (+ the landing's trade, tool, utm_*)        step 1 sent without JavaScript: the short sign-up
//                                                                (actions/signupOtp startQuickSignup), then as step1
//
// Stripe's back arrow (cancel_url) opens the plan cards (`?signup=<token>&checkout=cancelled`). When Stripe has not made
// the session within eight seconds, or refuses, the cards open with a line to try again (`checkout=failed`) — the one
// time the cards are drawn without being asked for. The switch off ("pick") or a trial without a card: the plan step
// as built (`checkout=pick`). Every answer is a 303 — never a page.
import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { readSignupPlan, signupTrialMode } from "@/lib/trialPolicyServer";
import { autoPlanOffer } from "@/lib/signupAutoPlanServer";
import { createSignupCheckout } from "@/lib/signupCheckoutSession";
import { pendingSignupAlive } from "@/lib/pendingSignup";
import { parseSpotlightTool } from "@/lib/planSpotlight";
import { isQaEmail } from "@/lib/qaEmail";
import { readAttributionCookie } from "@/lib/attribution";
import { captureTrafficEvent, identityFromCookie } from "@/lib/traffic-capture-server";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { SIGNUP_VIEW_COOKIE } from "@/lib/signupView";
import { startQuickSignup } from "@/actions/signupOtp";
import { toolsPlansOn } from "@/lib/toolPlans/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Reason = "step1" | "google" | "relogin" | "plan_pick";
const REASONS: ReadonlySet<string> = new Set(["step1", "google", "relogin", "plan_pick"]);

/** A 303 — never cached, never a page. A path of this site goes as it is (the browser resolves it against the address
 *  it asked for, whatever host the server was started on); Stripe's page as its full URL. */
function go(to: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}
const register = (q: Record<string, string>) => `/auth/register?${new URLSearchParams(q).toString()}`;

/** What the hand-off needs from the pending signup's row (actions/signupCheckout): alive, and whose it is. */
async function pendingOf(token: string): Promise<{ email: string; tool: string | null; analytics: unknown } | null> {
  const row = await db.syncState.findUnique({ where: { key: `signup:${token}` } }).catch(() => null);
  if (!row) return null;
  try {
    const rec = JSON.parse(row.cursor) as { email?: string; createdAt?: number; cardless?: { requestedAt: number }; landingTool?: string; analytics?: unknown };
    if (!pendingSignupAlive(rec) || !rec.email) return null;
    return { email: rec.email, tool: rec.landingTool ?? null, analytics: rec.analytics };
  } catch {
    return null;
  }
}

async function handOff(
  req: Request,
  token: string,
  reason: Reason,
  ask: { plan: string | null; interval: string | null; edition: string | null; tool?: string | null },
): Promise<NextResponse> {
  const pending = await pendingOf(token);
  // Nothing left to sell (the day ran out, or the account was made in another tab): step 1 again.
  if (!pending) return go("/auth/register");

  let planSlug: string;
  let interval: "MONTH" | "YEAR" = "MONTH";
  if (reason === "plan_pick" && ask.plan) {
    planSlug = ask.plan;
    interval = ask.interval === "YEAR" ? "YEAR" : "MONTH";
  } else if (await toolsPlansOn()) {
    /* THE NEW PLANS (Base + Tools, part 4 — owner, 2026-11-10): the sign-up opens its own card page first —
       Professional + the ad's tool, "Working alone?", "Change tool" — so nothing goes to Stripe before it is pressed. */
    return go(register({ signup: token, checkout: "pick", ...(ask.plan ? { plan: ask.plan } : {}), ...(ask.tool ? { tool: ask.tool } : {}) }));
  } else {
    const [rule, trial] = await Promise.all([readSignupPlan(), signupTrialMode()]);
    // The switch is off, or the trial takes no card: there is no card page to open by itself.
    if (rule.mode !== "auto" || trial !== "card") return go(register({ signup: token, checkout: "pick" }));
    const offer = await autoPlanOffer({ asked: ask.plan, edition: ask.edition === "deck" ? "deck" : null, tool: parseSpotlightTool(pending.tool) });
    if (!offer) return go(register({ signup: token, checkout: "failed" }));
    // Monthly, always (owner, 2026-10-17: the person pays exactly what step 1 said).
    planSlug = offer.slug;
  }

  // The new plans' main tool rides with the pick; lib/signupPricing validates and prices it (a Classic plan ignores it).
  const res = await createSignupCheckout({ token, planSlug, interval, origin: new URL(req.url).origin, mainTool: ask.tool ?? null });
  const identity = pending.analytics ?? identityFromCookie((await cookies()).get(`ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY}_posthog`)?.value, new URL(req.url).hostname);
  const tracked = !isQaEmail(pending.email);
  if (!res.ok) {
    console.warn(`[signup] checkout did not open (${reason}, ${planSlug}): ${res.status} ${res.error}`);
    return go(register({ signup: token, checkout: "failed", ...(reason === "plan_pick" ? { plan: planSlug } : {}), ...(reason === "plan_pick" && ask.tool ? { tool: ask.tool } : {}) }));
  }
  if (tracked) {
    // The sign-up screen this browser was drawn (lib/signupView): the browser's events carry it as a super property.
    const view = (await cookies()).get(SIGNUP_VIEW_COOKIE)?.value?.replace(/!$/, "");
    const signupView = view === "app" || view === "page" ? view : null;
    after(async () => {
      const props = { reason, plan: planSlug, interval, plan_mode: reason === "plan_pick" ? "pick" : "auto", signup_view: signupView };
      await Promise.all([
        captureTrafficEvent(identity, TRAFFIC_EVENTS.checkoutRedirect, props),
        // The funnel's own step, as the browser used to send it when it had the URL in hand.
        captureTrafficEvent(identity, TRAFFIC_EVENTS.opened, { plan: planSlug, interval, plan_mode: props.plan_mode, flow: reason === "google" ? "google" : "otp", signup_view: signupView }),
      ]);
    });
  }
  return go(res.url);
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = sp.get("signup");
  if (!token || token.length > 80) return go("/auth/register");
  const asked = sp.get("reason") ?? "";
  const reason: Reason = REASONS.has(asked) ? (asked as Reason) : "relogin";
  return handOff(req, token, reason, { plan: sp.get("plan"), interval: sp.get("interval"), edition: sp.get("edition"), tool: sp.get("tool") });
}

/** Step 1 without JavaScript: the form posts here and the answer is Stripe's card page (or step 1 with the reason). */
export async function POST(req: Request) {
  // Only this site's own form: a post from another origin is turned back to step 1.
  const from = req.headers.get("origin");
  if (from && from !== "null" && URL.canParse(from) && new URL(from).host !== req.headers.get("host")) return go("/auth/register");
  const form = await req.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const name = field("name") ?? "";
  const email = field("email") ?? "";
  const utm = Object.fromEntries(
    (["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const).flatMap((k) => (field(k) ? [[k, field(k)!]] : [])),
  );
  const captured = await readAttributionCookie();
  const days = Number(field("trialDays"));
  const host = new URL(req.url).hostname;
  const quick = await startQuickSignup({
    name,
    email,
    analytics: identityFromCookie((await cookies()).get(`ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY}_posthog`)?.value, host),
    displayedTrialDays: days === 3 || days === 7 ? days : undefined,
    industry: field("industry"),
    tool: field("tool"),
    utm: Object.keys(utm).length ? utm : undefined,
    attribution: captured ? { kind: captured.k, code: captured.c } : null,
    fbclid: field("fbclid"),
  });
  if (!quick.ok) {
    // The rule changed under the form (the code is asked for again): step 1 as the page now draws it.
    if (quick.needsCode) return go("/auth/register");
    const e1 = quick.taken ? "taken" : /temporary|throwaway|disposable/i.test(quick.error) ? "disposable" : /Too many/.test(quick.error) ? "busy" : /valid email|name/i.test(quick.error) ? "invalid" : "trouble";
    return go(register({ e1, ...(name ? { name } : {}), ...(email ? { email } : {}) }));
  }
  return handOff(req, quick.signupToken, "step1", { plan: field("plan") ?? null, interval: null, edition: field("edition") ?? null, tool: field("tool") ?? null });
}
