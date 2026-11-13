"use client";

// Blueprint roof estimator — page CONTENT.
//
// HISTORY. The donor's markup (intake / measuring / report / build) shipped
// first, filled from a hand-authored fixture. On 2026-07-30 it was replaced by
// a mount of the classic RoofEstimatorForm, so the page stopped looking like
// the donor. Since 2026-08-23 the donor markup is back, in
// roof-estimator-blueprint-form.tsx — now driven by the EagleView measurement
// engine (evRoofModel / reconRoofPreview / order flow) with its 2D/3D viewers.
//
// It is mounted as an ordinary React child, NOT through
// blueprint-shell/react-island: the shell renders `.content`'s children from
// the App Router tree, so a child here keeps the router context the form needs
// (`useRouter()` for the redirect after "Convert to proposal").
//
// `roof-estimator-behavior` is page-level motion only (the reveal cascade and
// the press effect) — every interaction on this page belongs to the form.

import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initRoofEstimatorContent } from "./roof-estimator-behavior";
import { RoofEstimatorBlueprintForm } from "./roof-estimator-blueprint-form";
import { RoofEstimatorDataForm } from "./roof-estimator-data-form";
import type { WebRoofSeed } from "@/lib/webHandoff";
import { RoofEstimatorSprite } from "./sprite";

export function RoofEstimatorContent({
  evEnabled,
  measurementEnabled = false,
  aiEnabled,
  drawingEnabled = true,
  initialAddress,
  leadEstimateId,
  webRoof,
  proposalId,
  homeState = null,
  roofDiagramPreview = false,
}: {
  /** A platform admin is looking (2026-11-12): the roof diagram card (lib/roofFacets) shows under a saved measurement. */
  roofDiagramPreview?: boolean;
  /** A lead's address, typed into the search field on arrival (lib/estimateSeed). */
  initialAddress?: string;
  /** A Lead Center lead the homeowner priced on /price (2026-10-27): its whole hidden estimate opens here. */
  leadEstimateId?: string;
  /** A website estimator's roof lead (2026-11-01): opens on its measurement, priced as the homeowner saw it. */
  webRoof?: WebRoofSeed;
  /** A saved roof proposal to open again and update (2026-10-13). */
  proposalId?: string;
  /** The shop's own state — the brand picker's fallback when the roof has no address (2026-10-16). */
  homeState?: string | null;
  /** EagleView credentials present — read on the server, in page.tsx. */
  evEnabled: boolean;
  /** The configured measurement service is available. */
  measurementEnabled?: boolean;
  /** OpenAI key present; without it the estimate generator returns a sample. */
  aiEnabled: boolean;
  /** ROOF_DRAWING_ENABLED (server env, page.tsx): false = the 2D/3D tool is
   *  hidden while the engine is reworked, and the page shows the data-only
   *  view — Instant numbers + ortho with the outline, no reconstruction. */
  drawingEnabled?: boolean;
}) {
  useBlueprintContent(initRoofEstimatorContent);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Automation · Measurement</div>
          <h1 className="page-title">Roof estimator</h1>
        </div>
        {/* The donor's "Measure another" action. The form portals the button in
            here so the page head and the panel state share one source. */}
        <div className="page-actions" id="rfAgainHost" />
      </div>

      {measurementEnabled ? (
        drawingEnabled && evEnabled ? (
          <RoofEstimatorBlueprintForm aiEnabled={aiEnabled} />
        ) : (
          <RoofEstimatorDataForm aiEnabled={aiEnabled} evEnabled={evEnabled} measurementEnabled={measurementEnabled} initialAddress={initialAddress} leadEstimateId={leadEstimateId} webRoof={webRoof} proposalId={proposalId} homeState={homeState} roofDiagramPreview={roofDiagramPreview} />
        )
      ) : (
        <div className="card rf-card">
          <div className="rf-body">
            <div className="card-title">Roof measurement is unavailable.</div>
            <p className="rf-note">
              Ask your administrator to enable roof measurement.
            </p>
          </div>
        </div>
      )}

      <RoofEstimatorSprite />
    </>
  );
}
