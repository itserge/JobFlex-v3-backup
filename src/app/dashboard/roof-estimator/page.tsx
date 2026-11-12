// Roof estimator — Blueprint edition. The blueprint chrome is the donor's
// (jobflex-roof-estimator-blueprint_3.html); the FLOW is the real one from
// /dashboard/advanced-ai/roof, mounted by roof-estimator-content.
//
// The sidebar and topbar come from the shared shell mounted in ../layout.tsx,
// so this page renders only the `.content` children.
//
// The two capability flags are read HERE because both helpers read process.env
// on the server. They gate the same things they gate on the classic route:
// without EagleView the form renders its "not configured" card instead of an
// intake, and without an OpenAI key the estimate generator returns a sample.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { isEagleViewEnabled } from "@/lib/eagleview";
import { isRoofMeasurementEnabled } from "@/lib/roofMeasurementProvider";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { RoofEstimatorContent } from "@/components/v3/roof-estimator-blueprint/roof-estimator-content";
import { readEstimateSeed } from "@/lib/estimateSeed";
import { EstimateSeedStrip } from "@/components/v3/estimate-seed-strip";
import { looksLikeStreetAddress } from "@/lib/leadRules";
import { requireOrg, requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { parseStateZip } from "@/lib/fence/market";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { readWebLeadFor } from "@/lib/webEstimatorServer";
import { roofSeedFromWebLead, type WebRoofSeed } from "@/lib/webHandoff";

/** The hand-off seed for this company's roof estimator, or null — never an error. */
async function readRoofSeed() {
  try {
    const { organizationId } = await requireOrg();
    return await readEstimateSeed(organizationId, "roof");
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
// The measure action this page calls places up to seven aerial orders, waits
// for them together, then runs the elevation pass — a few minutes at worst.
// A server action runs under the segment config of the page that calls it,
// so the ceiling is set here (review 2026-09-17: with the platform default
// the first click on a new address was cut off mid-order).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "JobFlex · Roof Estimator",
  description:
    "Roof estimator — order a measurement report, read the facets and linear footage, then price the takeoff.",
};

export default async function RoofEstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await customPageGate("roof-estimator");
  if (gate) return gate;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/login?next=%2Fdashboard%2Froof-estimator");
  }

  // SERVER flag (deliberately not NEXT_PUBLIC): while the 2D/3D engine is
  // being reworked, the page shows the data-only view — Instant numbers, ortho
  // with the outline, no reconstruction run at all. ROOF_DRAWING_ENABLED=true
  // opts back into the drawing tool.
  //
  // OPT-IN since 2026-09-05. It used to be opt-out ("anything but false keeps
  // the drawing tool"), and the live deploy — which had never been given the
  // flag — showed the drawing tool while every local run had it set to false.
  // Two different roof pages for one commit, and the live one depended on a
  // server Google key entitled to Geocoding + Solar that the deploy did not
  // have. A deploy with no flag now gets the same page as local dev.
  const drawingEnabled = process.env.ROOF_DRAWING_ENABLED === "true";
  // A roof lead handed over from its page (lib/estimateSeed): the address is
  // already in the search field when the contractor arrives — a street
  // address only (2026-09-26). A lead with just a town or a ZIP opens here too
  // now; its field starts empty for the street, and the strip shows the rest.
  const seed = await readRoofSeed();
  // A website estimator's roof lead (2026-11-01): its aerial measurement, the package the website priced and its lines.
  let webRoof: WebRoofSeed | null = null;
  if (seed?.leadId) {
    try {
      const { organizationId } = await requireOrg();
      const rec = await readWebLeadFor(seed.leadId, organizationId, "roof");
      webRoof = rec ? roofSeedFromWebLead(rec) : null;
    } catch {
      webRoof = null;
    }
  }
  // A saved roof proposal opened again from the proposal builder (2026-10-13):
  // the estimator loads it (loadRoofFromProposal checks it is this company's).
  const raw = (await searchParams).proposal;
  const proposalId = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 64) || undefined;
  // The shop's own state (2026-10-16): the roofing brands are ranked for it until the roof's address says otherwise.
  let homeState: string | null = null;
  try {
    const { organizationId } = await requireOrg();
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true } });
    homeState = parseStateZip(org?.address).state;
  } catch {
    /* no company yet: the roof's own address decides */
  }

  // The roof diagram card (2026-11-12, owner: "only at admin account"): platform admins see the facets and lines
  // drawn under a measurement; everyone else gets the roof estimator exactly as before. The action and the picture
  // route behind the card ask the same question again on their own.
  const roofDiagramPreview = await requirePlatformAdmin().then(() => true, () => false);

  return (
    <>
      <EstimateSeedStrip seed={seed} />
      <RoofEstimatorContent
        roofDiagramPreview={roofDiagramPreview}
        evEnabled={isEagleViewEnabled()}
        measurementEnabled={isRoofMeasurementEnabled()}
        aiEnabled={isOpenAIEnabled()}
        drawingEnabled={drawingEnabled}
        initialAddress={seed?.address && looksLikeStreetAddress(seed.address) ? seed.address : undefined}
        leadEstimateId={seed?.platformLeadId ?? undefined}
        webRoof={webRoof ?? undefined}
        proposalId={proposalId}
        homeState={homeState}
      />
    </>
  );
}
