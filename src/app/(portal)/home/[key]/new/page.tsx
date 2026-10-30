// /home/[key]/new — Start a project from the home portal (2026-10-30).
// ?plan=<id> starts from a plan on the calendar, ?with=<orgId> asks for a
// contractor the home already had ("Hire again") — lib/home/portal
// loadWizardPrefill reads both, exactly as the public intake does.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWizardPrefill } from "@/lib/home/portal";
import { PortalFrame } from "@/components/v3/homeowner-portal-blueprint/portal-frame";
import { NewProject } from "@/components/v3/homeowner-portal-blueprint/new-project";
import { homeHref } from "@/components/v3/homeowner-portal-blueprint/view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start a project — JobFlex Home",
  description: "Tell us what you need done; a local contractor takes it from there.",
  robots: { index: false, follow: false },
};

export default async function HomeNewProjectPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  const prefill = await loadWizardPrefill(key, typeof sp.plan === "string" ? sp.plan : null, typeof sp.with === "string" ? sp.with : null);
  if (!prefill) notFound();
  const house = [prefill.address, prefill.zip && !prefill.address.includes(prefill.zip) ? prefill.zip : ""].filter(Boolean).join(" ");
  return (
    <PortalFrame homeKey={key} house={house || null} tab={null} startCta={false} live={false}>
      <NewProject prefill={prefill} homePath={homeHref(key)} projectBase={`${homeHref(key)}/project`} />
    </PortalFrame>
  );
}
