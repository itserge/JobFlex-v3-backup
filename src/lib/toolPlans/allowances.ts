// THE NEW PLANS' ALLOWANCES (Base + Tools, part 3a — owner, 2026-11-10). Each answer is null for a Classic shop, so
// the caller keeps its own Classic rule exactly as it was (lib/entitlements smsAllowanceFor, lib/aiDesk/minutes
// DESK_MINUTES_DEFAULT) — and a number, or a yes/no, for a shop whose plan is a "tools-" slug.
//
//   texts        Text messaging held: TOOLS_TEXT_ALLOWANCE a month; without it none to clients and leads (the shop's
//                own team is still texted — lib/sms/send — and those texts aren't counted against an allowance).
//   desk minutes Advanced and Complete include the AI desk: TOOLS_DESK_MINUTES_INCLUDED; a smaller size that adds
//                the AI desk (bought, closing or on a try): TOOLS_DESK_MINUTES_ADDED; without it, none.
//   texting      whether a text to someone outside the team is refused (lib/sms/send dispatch).
//
// Server code (it reads the database), but no "server-only" marker: lib/sms/send loads it, and that module is
// loaded by plain-node checks that don't stub the marker (qa/tests/logic/sms.check.ts) — as lib/customPageAccess.

import { isPageLocked, isToolsShop, type GateAs } from "@/lib/customPageAccess";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { TOOLS_DESK_MINUTES_ADDED, TOOLS_DESK_MINUTES_INCLUDED, TOOLS_TEXT_ALLOWANCE, isToolsSlug, toolPlanBySlug } from "./shared";

/** The month's text allowance on the new plans, or null for a Classic shop. */
export async function toolsSmsAllowance(organizationId: string): Promise<number | null> {
  if (!(await isToolsShop(organizationId))) return null;
  return (await isPageLocked(organizationId, "texting", { as: null })) ? 0 : TOOLS_TEXT_ALLOWANCE;
}

/** True only for a new-plan shop whose plan doesn't hold Text messaging: its number texts its own team alone.
 *  Asked as the session's user by default (a platform admin in the company texts, as lib/paidCaps orgMayText). */
export async function toolsTextingClosed(organizationId: string, opts: GateAs = {}): Promise<boolean> {
  if (!(await isToolsShop(organizationId))) return false;
  return isPageLocked(organizationId, "texting", opts);
}

/** The AI desk's included minutes a month on the new plans, or null for a Classic shop. */
export async function toolsDeskMinutes(organizationId: string): Promise<number | null> {
  const sub = await readAccessSubscription(organizationId).catch(() => null);
  if (!isToolsSlug(sub?.plan)) return null;
  if (await isPageLocked(organizationId, "phone", { as: null }).catch(() => true)) return 0;
  return toolPlanBySlug(sub?.plan)?.officeIncluded ? TOOLS_DESK_MINUTES_INCLUDED : TOOLS_DESK_MINUTES_ADDED;
}
