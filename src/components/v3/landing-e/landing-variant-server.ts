/* Server half of the trade variant: query → props for <LandingE>. Kept apart
   from landing-variants.ts, which client components import and which must
   therefore stay free of next/headers types. */

import type { LandingEProps } from "./landing-e-page";
import { pickFbclid, pickUtm, resolveLandingHook, resolveLandingVariant } from "./landing-variants";
import { parseAdTool, parseSpotlightTool } from "@/lib/planSpotlight";

/** The variant this visit gets — from the URL and NOTHING ELSE (owner,
    2026-09-10). The jf_industry cookie the page writes is for the register
    form's pre-select only; it never chooses the landing.

    · `?industry=` / `?trade=` present and known → that variant.
    · present but unknown, or absent → the default page.
    · `?hook=` (2026-10-04) → the ad's opening line as that variant's
      headline, when the key is in the trade's table (LANDING_HOOKS); any
      other value, or a trade without a table, is the trade's own hero. */
export function readLandingVariant(params: Record<string, string | string[] | undefined>): LandingEProps {
  const utm = pickUtm(params);
  const variant = resolveLandingVariant(params.industry ?? params.trade);
  // `?tool=` (lib/planSpotlight, 2026-10-14): the tool the ad sold, marked on the plan cards. `adTool` is the same link
  // read for the new plans (any ad's key, part 4) — used only while the Plans switch is on.
  return { variant, explicitVariant: Boolean(variant), utm, fbclid: pickFbclid(params), hook: resolveLandingHook(variant, params.hook), tool: parseSpotlightTool(params.tool), adTool: parseAdTool(params.tool) };
}
