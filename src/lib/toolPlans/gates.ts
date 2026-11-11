import "server-only";
// THE NEW PLANS' SIZE GATES (Base + Tools, part 5 — owner, 2026-11-10). What a size opens beyond Basic (lib/toolPlans/
// shared SizeFeature) is asked through the one page gate (lib/customPageAccess requirePage / isPageLocked), so a
// platform admin, a lapsed plan and a Classic shop are answered exactly as every other gated id is:
//
//   roles          inviting office and sales people, and changing a member's role — Professional and up
//                  (actions/team createInvite, updateMembershipRole; actions/workers for an office role)
//   custom-domain  lib/entitlements custom_domain and white_label — Advanced and Complete
//   multi-org      lib/entitlements multi_org ("several companies under one login") — Advanced and Complete
//
// CLASSIC IS UNCHANGED: those ids have no Classic twin (shared classicEquivalent), so the gate answers them open for a
// Classic shop, and a Classic shop's entitlement is lib/entitlements hasFeature on its plan, as it always was (every
// feature open on every plan since 2026-08-14).
//
// Note (2026-11-11): nothing in the app sells a custom domain, a white-label portal or a second company yet — the
// entitlements are defined and never asked, and the old switcher's "Create organization" has no action behind it. The
// day one is built, its server code asks requireOrgFeature here; the size already says who has it.

import { isPageLocked, isToolsShop, requirePage, type GateAs } from "@/lib/customPageAccess";
import { hasFeature, requireFeatureOrThrow, type Feature } from "@/lib/entitlements";
import { getOrgPlanById } from "@/lib/orgPlan";

/** The gated id each entitlement is on the new plans; an entitlement not listed follows lib/entitlements there too. */
export const TOOLS_FEATURE_GATE: Partial<Record<Feature, "custom-domain" | "multi-org">> = {
  custom_domain: "custom-domain",
  white_label: "custom-domain",
  multi_org: "multi-org",
};

/** True when the organization may not use the entitlement: its size on the new plans, else its Classic plan. */
export async function orgFeatureLocked(organizationId: string, feature: Feature, opts: GateAs = {}): Promise<boolean> {
  const page = TOOLS_FEATURE_GATE[feature];
  if (page && (await isToolsShop(organizationId))) return isPageLocked(organizationId, page, opts);
  return !hasFeature(await getOrgPlanById(organizationId), feature);
}

/** The server boundary for an entitlement: throws CustomPageLockedError on the new plans without the size, the
 *  Classic FEATURE_GATED error (lib/entitlements) otherwise. */
export async function requireOrgFeature(organizationId: string, feature: Feature, opts: GateAs = {}): Promise<void> {
  const page = TOOLS_FEATURE_GATE[feature];
  if (page && (await isToolsShop(organizationId))) return requirePage(organizationId, page, opts);
  requireFeatureOrThrow(await getOrgPlanById(organizationId), feature);
}

/** Inviting office and sales people and changing a role: Professional and up on the new plans; open on Classic. */
export async function requireTeamRoles(organizationId: string, opts: GateAs = {}): Promise<void> {
  await requirePage(organizationId, "roles", opts);
}
