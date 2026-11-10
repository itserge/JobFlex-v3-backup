// THE PAGE-LEVEL HALF OF THE CUSTOM-PLAN GATE (owner, 2026-10-06).
//
// A layout renders only when its segment is entered: on a client-side
// navigation between two dashboard pages the shared layout is reused and only
// the PAGE segment is rendered on the server. The layout gate therefore never
// ran on that request — the page's server component did, and its data rode
// to the browser in the RSC payload even though the client swap painted the
// offer over it (the audit found a calendar's events in that payload).
//
// So every add-on page asks here FIRST, before it reads anything:
//
//   const gate = await customPageGate("calendar");
//   if (gate) return gate;
//
// It returns the offer for an org on the custom plan that does not hold the
// page, else null. A signed-out visitor gets null: the page's own
// redirect-to-login handles them, as before. Fails closed (lib/customPageAccess).

import { requireOrg } from "@/lib/orgContext";
import { getBlockedCustomPages, isPageLocked } from "@/lib/customPageAccess";
import { gatedPage, type GatedPageId } from "@/lib/customPlan";
import { UpgradeGate } from "./upgrade-gate";
import { HandheldGate } from "./handheld-gate";

export async function customPageGate(
  page: GatedPageId,
  opts: { handheld?: boolean } = {},
): Promise<React.ReactElement | null> {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch {
    return null;
  }
  if (!(await isPageLocked(ctx.organizationId, page))) return null;
  // A paid feature without a page of its own (lib/customPlan PAID_FEATURES) is named by its id: the gate reads
  // the label from it and says the plan ended.
  const href = gatedPage(page)?.href ?? `#feature:${page}`;
  const locked = (await getBlockedCustomPages(ctx.organizationId)) ?? [];
  const isOwner = ctx.role === "OWNER";
  // The standalone handheld URLs (/mobile-*) have no shell above them: the
  // gate brings the handheld frame and its navigation.
  if (opts.handheld) {
    return (
      <HandheldGate
        pathname={href}
        locked={locked}
        isOwner={isOwner}
        identity={{ role: ctx.role, name: ctx.user.name ?? ctx.user.email ?? "Account", hidden: [] }}
      />
    );
  }
  return <UpgradeGate pathname={href} locked={locked} isOwner={isOwner} />;
}
