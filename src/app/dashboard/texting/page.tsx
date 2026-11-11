// Texting — its own page (2026-10-16). Until today it was the Texting pane of
// Settings; the owner moved it under AI desk in the sidebar's Automation
// section: who gets texted, from which number, saying what.
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, which also carries the limited-role gate: INSTALLER / SALES /
// ESTIMATOR could not open Settings and cannot open this page; every office
// role can, as it could open Settings → Texting. No custom-plan gate — Settings
// never had one, and texting is not a page the custom plan sells.
//
// THE READ is the same one Settings used (src/lib/settings/loadSettingsData.ts
// → loadTextingWorkspace): a plain module that takes the org context this page
// resolved, never a "use server" export keyed by an org id. Both editions — the
// desk page above 768px and the handheld build at or below — get this one
// object through ./texting-responsive. Writes are the existing actions
// (@/actions/sms, @/actions/textRules).

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { loadTextingWorkspace } from "@/lib/settings/loadSettingsData";
import { TextingResponsive } from "./texting-responsive";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Texting",
  description: "Texting — your texting number, who on the team gets texts, texts to clients and texts you write yourself.",
};

export default async function TextingPage() {
  // Text messaging is a tool on the new plans; open on every Classic plan (lib/customPlan). Texts to the team still
  // go without it (lib/sms/send).
  const gate = await customPageGate("texting");
  if (gate) return gate;
  let ctx;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Ftexting");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const sms = await loadTextingWorkspace(ctx);
  if (!sms) redirect("/dashboard?error=forbidden");

  return <TextingResponsive sms={sms} />;
}
