import { NextResponse } from "next/server";
import { DOOR_COOKIE, DOOR_MAX_AGE_S } from "@/lib/editions";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { isPartnerPublic, principalRedirect } from "@/lib/principalRoutes";
import { REGION_COOKIE, REGION_MAX_AGE_S, consentModeFor } from "@/lib/consent";
import { TRIAL_OFFER_COOKIE, TRIAL_OFFER_MAX_AGE, TRIAL_TEST_ENDED } from "@/lib/trialOffer";
import { movedPricePath } from "@/lib/home/portalPrice";

// The standalone handheld URLs (/mobile-*, /trade-services) are protected too:
// they render the same org data as their /dashboard twins and the (mobile)
// group layout applies the same role + custom-plan gates, which read the
// x-pathname header set here.
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/influencer", "/v3", "/mobile-", "/trade-services"];

// Handheld surfaces that are public by design (marketing, homeowner intake,
// the customer's proposal view, the auth screens, the estimator picker).
const PUBLIC_MOBILE_PREFIXES = [
  // Removed 2026-10-02 (the homeowner page is /homeowner alone). Left here so
  // the old address answers 404 to everyone — under "/mobile-" a visitor
  // without a session would otherwise be sent to sign in for a page that is gone.
  "/mobile-homeowner-v2",
  "/mobile-proposal-client-v2",
  "/mobile-estimator-picker-v2",
  "/mobile-v1",
];

/* THE LANDINGS THAT ARE GONE (owner, 2026-09-18). landing-e is the only one,
   and it is the root; /landing, its A/B/C drafts, the aerial draft and the
   handheld twin were removed with their components. They are redirected rather
   than left to 404 because links to them exist outside this codebase — an ad,
   a bookmark, a signature — and a 404 spends a visitor the ads were paid for.

   308, not 302: the move is permanent and the method must be preserved. The
   query string rides along untouched, which is the point — `?industry=roofing`
   picks the trade hero, and utm_* / fbclid are how the visit is attributed.
   /landing-e keeps its own redirect in the route itself (it has to read the
   query to rebuild it there); everything listed here is gone from the app. */
const REMOVED_LANDINGS = new Set([
  "/landing",
  "/landing-a",
  "/landing-b",
  "/landing-c",
  "/landing-aerial",
  "/mobile-landing-v2",
]);

/* THE TRADE SHORTCUTS (2026-10-01). /hvac is the HVAC landing's short
   address for an ad, a card or a spoken link: 308 to the root with the trade
   in the query, everything else in the query (utm_*, fbclid) kept. The
   landing reads the variant from the query only, so this is the one way in. */
const TRADE_SHORTCUTS: Record<string, string> = {
  "/hvac": "hvac",
  // The Deck Studio door (2026-10-11, lib/editions): the decking landing is the edition's own page.
  "/deck": "decking",
};

/* THE DECK DOOR'S OWN HOST (2026-10-11, lib/editions). On deck.jobflex.app the
   root IS the Deck Studio landing and the sign-in page opens on the deck door;
   the choice is remembered as the door cookie. The hosts come from DECK_HOSTS
   (comma-separated) so a bought domain pointed at the app works the same. */
const DECK_HOSTS = new Set((process.env.DECK_HOSTS ?? "deck.jobflex.app,deckstudio.jobflex.app").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));

/* THE INVENTORY PAGES THAT MOVED. The per-trade boards, the HVAC service
   menu page and the handheld HVAC preview went to one shared page on
   2026-09-29; since 2026-10-10 each trade's inventory is its own page under
   its estimator (lib/inventory INVENTORY_PATH), so they go straight there.
   308 by exact path, the query string kept (nothing there was ever read).
   /dashboard/inventory itself forwards in its page (it needs the org). */
const MOVED_INVENTORY: Record<string, string> = {
  "/dashboard/roof-estimator/board": "/dashboard/roof-estimator/inventory?tab=stock",
  "/dashboard/fence-estimator/board": "/dashboard/fence-estimator/inventory?tab=stock",
  "/dashboard/hvac-estimator/board": "/dashboard/hvac-estimator/inventory?tab=stock",
  "/dashboard/hvac-estimator/services": "/dashboard/hvac-estimator/inventory?tab=services",
  "/mobile-hvac-inventory-v1": "/dashboard/hvac-estimator/inventory?tab=stock",
};

/* THE CLASSIC ROOF PAGE (2026-10-09). /dashboard/advanced-ai/roof prices and
   orders through the legacy measurement API, which on this deployment is the
   vendor's sandbox: a real address is a dead end (ticket HQFESV). The
   Blueprint roof estimator does the same job. 307, not 308 — the page's code
   stays, and a temporary redirect is not cached by browsers if it comes back. */
const MOVED_PAGES: Record<string, string> = {
  "/dashboard/advanced-ai/roof": "/dashboard/roof-estimator",
};

/* ONE ADDRESS PER PAGE, WITHOUT THE TRAILING SLASH (2026-11-02). next.config.ts
   sets skipTrailingSlashRedirect for the PostHog proxy (/ingest/e/ must reach
   PostHog with its slash), which also took Next's own /page/ → /page redirect off
   every other route — /cost/roof-replacement/dallas-tx/ answered 200 as a
   duplicate of the canonical page. The redirect is put back here: 308, query
   kept. Not for /ingest (the proxy), /api, /_next, or a file with an extension. */
function trailingSlashTarget(req: NextRequest): URL | null {
  const { pathname } = req.nextUrl;
  if (pathname === "/" || !pathname.endsWith("/")) return null;
  if (/^\/(ingest|api|_next)(\/|$)/.test(pathname)) return null;
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  if (/\.[\w]+$/.test(trimmed)) return null;
  // A plain URL, not req.nextUrl.clone(): NextURL remembers the incoming slash and
  // writes it back onto any pathname set on it, so the redirect pointed at itself.
  return new URL(trimmed + req.nextUrl.search, req.url);
}

/* THE CONSENT MODEL BY COUNTRY (owner, 2026-09-30; lib/consent). Vercel's
   x-vercel-ip-country decides notice or opt-in once, on the first page this
   browser asks for, and the answer — never the country — is kept a year in
   jf_region for the client to read. Here rather than in the root layout: a
   request header read there rendered every page per request, /pricing's
   catalogue read included. No header (localhost) is the US: notice. */
export async function middleware(req: NextRequest) {
  const slashless = trailingSlashTarget(req);
  if (slashless) return NextResponse.redirect(slashless, 308);
  const offerPath = req.nextUrl.pathname === "/" || req.nextUrl.pathname === "/pricing" || req.nextUrl.pathname.startsWith("/auth/register");
  const existingOffer = req.cookies.get(TRIAL_OFFER_COOKIE)?.value;
  let assigned: string | null = null;
  // No assignment once the test is over (lib/trialOffer TRIAL_TEST_ENDED).
  if (!TRIAL_TEST_ENDED && offerPath && existingOffer !== "a" && existingOffer !== "b") {
    assigned = crypto.getRandomValues(new Uint8Array(1))[0] < 128 ? "a" : "b";
    // Forward it in this request too, so first paint and the next request agree.
    req.cookies.set(TRIAL_OFFER_COOKIE, assigned);
  }
  const res = await route(req);
  if (assigned) res.cookies.set(TRIAL_OFFER_COOKIE, assigned, {
    path: "/", maxAge: TRIAL_OFFER_MAX_AGE, httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:",
  });
  if (!req.cookies.has(REGION_COOKIE)) {
    res.cookies.set(REGION_COOKIE, consentModeFor(req.headers.get("x-vercel-ip-country")), {
      path: "/",
      maxAge: REGION_MAX_AGE_S,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
    });
  }
  return res;
}

async function route(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (DECK_HOSTS.has(host) && (pathname === "/" || pathname === "/auth/login")) {
    const url = req.nextUrl.clone();
    if (pathname === "/") url.searchParams.set("industry", "decking");
    else if (!url.searchParams.get("door")) url.searchParams.set("door", "deck");
    const res = NextResponse.rewrite(url);
    res.cookies.set(DOOR_COOKIE, "deck", { path: "/", maxAge: DOOR_MAX_AGE_S, sameSite: "lax", secure: req.nextUrl.protocol === "https:" });
    return res;
  }
  const moved = MOVED_INVENTORY[pathname];
  if (moved) {
    const url = req.nextUrl.clone();
    const [path, query] = moved.split("?");
    url.pathname = path;
    // The old address's own query rides along (?group=…); the tab is the new
    // page's, and the trade is its path now (2026-10-10), never a parameter.
    url.searchParams.delete("trade");
    for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
    return NextResponse.redirect(url, 308);
  }
  // ONE HOMEOWNER PORTAL (2026-10-28, lib/home/portalPrice): /price, /price/roof and the house estimators'
  // /estimate/jobflex/<trade> live in the portal now. 308 with the query kept — a saved range's ?home=&plan=, a
  // cost guide's ?city=&state= — so the emails already sent and the guides' links land on the same estimator.
  const movedPrice = movedPricePath(pathname);
  if (movedPrice) {
    const url = req.nextUrl.clone();
    url.pathname = movedPrice;
    return NextResponse.redirect(url, 308);
  }
  const movedPage = MOVED_PAGES[pathname];
  if (movedPage) {
    const url = req.nextUrl.clone();
    url.pathname = movedPage;
    return NextResponse.redirect(url, 307);
  }
  const shortcut = TRADE_SHORTCUTS[pathname];
  if (shortcut) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("industry", shortcut);
    return NextResponse.redirect(url, 308);
  }
  if (REMOVED_LANDINGS.has(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    // url.search is carried over by clone(); nothing else is touched.
    return NextResponse.redirect(url, 308);
  }
  // Influencer login, invite / reset set-password and forgot-password must
  // stay reachable without a session (lib/principalRoutes).
  if (isPartnerPublic(pathname)) {
    return NextResponse.next();
  }
  if (PUBLIC_MOBILE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next({ request: { headers: req.headers } });

  // Cookie-presence only — the real principal/role gate lives in the route
  // group layouts and server guards (requirePlatformAdmin / requireInfluencer).
  const sessionToken =
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-authjs.session-token")?.value;

  // THE PRINCIPAL FIRST. A partner's session (INFLUENCER) has no organisation:
  // on /dashboard it drew the contractor shell over nothing and every action
  // threw NoOrgError; an owner's session on /influencer found the partner door.
  // Each is sent to its own home. Fail-open like the role gate below — the
  // server guards (requireUser refuses a partner, requireInfluencer refuses a
  // user) are the boundary; this is the redirect that keeps it from being felt.
  if (sessionToken) {
    try {
      const principal = (await decodeSession(req))?.principal;
      const home = principalRedirect(pathname, typeof principal === "string" ? principal : null);
      if (home) {
        const url = req.nextUrl.clone();
        url.pathname = home;
        url.search = "";
        return NextResponse.redirect(url);
      }
    } catch {
      // fail-open — see above
    }
  }

  // Platform admin console. Two cookies open it: the authjs session (a user
  // flagged isPlatformAdmin) or the signed `jf_admin` cookie minted by the
  // username/password login (src/actions/adminAuth.ts). Presence only, like the
  // rule below — the (admin) layout verifies the signature and the DB flag.
  // /admin/login is reachable with neither, or the door could never be opened.
  // The pathname header is set here too: the (admin) layout reads it to render
  // the login page bare instead of guarding it (a guard there would redirect
  // the login page to itself).
  if (pathname.startsWith("/admin")) {
    const adminHeaders = new Headers(req.headers);
    adminHeaders.set("x-pathname", pathname);
    const isLogin = pathname === "/admin/login" || pathname.startsWith("/admin/login/");
    const adminCookie = req.cookies.get("jf_admin")?.value;
    if (!isLogin && !sessionToken && !adminCookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request: { headers: adminHeaders } });
  }

  if (!sessionToken) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/influencer") ? "/influencer/login" : "/auth/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Limited-role route-gate (UX layer). Decode the JWT to read the role and keep
  // workers / sales reps / estimators inside their allowed surfaces (including
  // bouncing a bare /dashboard hit to their home page). Fail-open by design: if
  // decoding ever fails we do NOT restrict — nav hiding, per-page data scoping,
  // and the server guards (requireManager & friends) are the real boundaries, so
  // a hiccup here can never lock a manager out or expose a write path.
  // /v3 sandbox routes render the same org-wide data as their live twins, so
  // limited roles are kept out of them entirely (their home is under /dashboard).
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/v3")) {
    try {
      const token = await decodeSession(req);
      const gate = token?.role ? ROLE_ROUTE_GATES[String(token.role)] : undefined;
      if (gate && !isPathAllowed(gate, pathname)) {
        const url = req.nextUrl.clone();
        url.pathname = gate.home;
        url.search = "";
        return NextResponse.redirect(url);
      }
    } catch {
      // fail-open — see comment above
    }
  }

  // Expose the path to server components (the dashboard layout reads this to
  // fail CLOSED on the worker route-gate even if the JWT decode above threw —
  // the layout derives role from the DB, not the JWT, so it's the real boundary).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/** The session JWT's claims, or null. Same cookie rules NextAuth uses. */
async function decodeSession(req: NextRequest) {
  const secureCookie =
    req.cookies.has("__Secure-authjs.session-token") ||
    (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
  const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token";
  return getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
    salt: cookieName,
    secureCookie,
    cookieName,
  });
}

export const config = {
  // Every page, for the jf_region cookie above; the auth, role and redirect
  // rules inside still apply only to the paths they name. API routes, Next's
  // own files and anything with a file extension (images, fonts, robots.txt)
  // never come through here.
  matcher: ["/((?!api/|_next/|_vercel/|.*\\.[\\w]+$).*)"],
};
