"use client";

import { useEffect } from "react";
import { effectiveConsent } from "@/lib/consent";
import { trackTraffic } from "@/lib/traffic-client";
import { SPOTLIGHT_COOKIE, SPOTLIGHT_MAX_AGE_S, type AdTool } from "@/lib/planSpotlight";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import {
  FBCLID_COOKIE,
  FBCLID_MAX_AGE_S,
  INDUSTRY_COOKIE,
  INDUSTRY_MAX_AGE_S,
  UTM_COOKIE,
  hasUtm,
  serializeUtm,
  type LandingVariantKey,
  type UtmParams,
} from "./landing-variants";

/** The landing's memory, written from the browser: the trade (when one was
 *  asked for) and the visit's utm_*, for 30 days. Called after paint by this
 *  component and SYNCHRONOUSLY by the Google button before it leaves for
 *  Google, so the return from Google finds both even when the click beat the
 *  effect. */
export function writeLandingCookies(industry: LandingVariantKey | undefined, utm: UtmParams | undefined, tool?: AdTool | null) {
  try {
    if (industry) document.cookie = `${INDUSTRY_COOKIE}=${industry}; path=/; max-age=${INDUSTRY_MAX_AGE_S}; samesite=lax`;
    // The tool the ad sold (lib/planSpotlight), for the register and /pricing to keep marking.
    if (tool) document.cookie = `${SPOTLIGHT_COOKIE}=${tool}; path=/; max-age=${SPOTLIGHT_MAX_AGE_S}; samesite=lax`;
    if (hasUtm(utm)) document.cookie = `${UTM_COOKIE}=${encodeURIComponent(serializeUtm(utm!))}; path=/; max-age=${INDUSTRY_MAX_AGE_S}; samesite=lax`;
  } catch {
    /* cookies blocked — the visit simply is not remembered */
  }
}

/** Before a Google sign-in: the ad's click id for the return of a NEW address,
 *  which comes back through the auth callback's own redirect and not the
 *  callbackUrl (landing-variants FBCLID_COOKIE). Marketing consent only. */
export function rememberFbclidForGoogle(fbclid: string | null | undefined) {
  if (!fbclid || !/^[\w-]{1,500}$/.test(fbclid) || !effectiveConsent().marketing) return;
  try {
    document.cookie = `${FBCLID_COOKIE}=${fbclid}; path=/; max-age=${FBCLID_MAX_AGE_S}; samesite=lax`;
  } catch {
    /* cookies blocked — the callbackUrl still carries it */
  }
}

/* Invisible. Two side effects of a landing view, both after paint:

   1. MEMORY. When the variant came from an explicit `?industry=` the page
      remembers it for 30 days in a first-party cookie, the same way the promo
      capture remembers `?promo=`. The cookie is for /auth/register ONLY — it
      pre-selects the trade when the visitor arrives there later with no
      parameter (and on the return from Google). The landing itself never
      reads it (owner, 2026-09-10): no parameter is always the default page.

   2. ANALYTICS. One `landing_view` per page load with the industry that was
      shown ("default" when none) and whatever utm_* the visit carried. Goes
      through trackTraffic, which queues until PostHog is initialised and
      never throws. When the headline was an ad's opening line (`?hook=`,
      2026-10-04) the event names it as `hook`, so one hook can be read
      against another; a view of the trade's own hero carries no `hook`. */
export function LandingVariantEffects({
  industry,
  remember,
  utm,
  hook,
  tool,
}: {
  industry: LandingVariantKey | undefined;
  /** True only when the variant came from the URL, not the cookie. */
  remember: boolean;
  utm: UtmParams;
  /** The key of the ad's opening line the headline showed (LANDING_HOOKS), if any. */
  hook?: string;
  /** The tool this URL marks (`?tool=`, else the trade's own estimator; lib/planSpotlight) — remembered like the trade.
   *  With the new plans on, any ad's key (parseAdTool); Classic surfaces read the cookie as a Classic key or nothing. */
  tool?: AdTool | null;
}) {
  useEffect(() => {
    writeLandingCookies(industry && remember ? industry : undefined, utm, tool);
    trackTraffic(TRAFFIC_EVENTS.landingView, { industry: industry ?? "default", variant: "e", ...(hook ? { hook } : {}), ...utm });
    // One capture per page load; the props only change on a full navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
