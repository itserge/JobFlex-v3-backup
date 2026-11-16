// THE WELCOME PAGE (Base + Tools, part 3b — owner, 2026-11-10: "a welcome page on day one"). /dashboard/welcome, desk
// and phone (one responsive page: the route sits in the shell's BLUEPRINT_HANDHELD set, so a phone gets the handheld
// nav around it and components/v3/tools-plan restacks it). For the owner of a shop on the new plans only: a Classic
// shop and every other role go to the Overview.
//
// What it says: their plan, "Not the tool you wanted? Switch your main tool" (only in the free days), three tools
// that work well with the main tool and every other tool, each with Try free. Shown once: the first time the owner
// opens /dashboard they are sent here (lib/toolPlans/view toolsWelcomeDue), and rendering it stamps
// SyncState `toolsWelcome:<orgId>`. After that the Subscription page holds the same cards; this URL still opens.

import type { Metadata } from "next";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { isOwnerRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { loadToolsModel, markToolsWelcomeShown } from "@/lib/toolPlans/view";
import { ToolsWelcome } from "@/components/v3/tools-plan/tools-plan";
import { cookies } from "next/headers";
import { isImportSource, MOVING_COOKIE } from "@/lib/import/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Welcome", description: "Your plan, your main tool and the tools you can try free." };

export default async function WelcomePage() {
  let organizationId: string;
  let role: string;
  try {
    ({ organizationId, role } = await requireOrg());
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fwelcome");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!isOwnerRole(role)) redirect("/dashboard" as Route);
  const model = await loadToolsModel(organizationId).catch(() => null);
  if (!model || model.lapsed) redirect("/dashboard" as Route);
  await markToolsWelcomeShown(organizationId);
  // Came through a "Switch to JobFlex" page (/switch/<program>): the "Moving from…" card names their program.
  const raw = (await cookies()).get(MOVING_COOKIE)?.value ?? "";
  return <ToolsWelcome model={model} movingFrom={isImportSource(raw) ? raw : null} />;
}
