"use client";

// ROOF DIAGRAM · ADMIN PREVIEW — the roof estimator's card for platform admins (owner, 2026-11-12: "add to roof
// estimator diagram … will see how it will be, but only at admin account").
//
// Under a measured roof, the same drawing the lab makes (lib/roofFacets): the facets diagram, the lines diagram, the
// aerial photo and the height map with the lines on them, and the two tables. The roof estimator's page decides who
// gets the card (page.tsx asks requirePlatformAdmin); the action and the picture route behind it refuse everyone
// else on their own, so a contractor who forged the flag would see only "Platform admin only".

import { useEffect, useState } from "react";
import { drawRoofLab } from "@/actions/adminRoofLab";
import type { RoofLabDrawing } from "@/lib/roofFacets/server";
import { RoofLabStage } from "./roof-lab-content";
import r from "./roof-lab.module.css";

type Drawn = { ok: true; drawing: RoofLabDrawing } | { ok: false; error: string };

export function RoofDiagramPreview({ measurementId }: { measurementId: string }) {
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  useEffect(() => {
    let on = true;
    drawRoofLab(measurementId)
      .then((res) => { if (on) setDrawn(res); })
      .catch(() => { if (on) setDrawn({ ok: false, error: "The diagram could not be drawn just now. Open the roof again to retry." }); });
    return () => { on = false; };
  }, [measurementId]);

  return (
    <div className="card" data-roof-diagram-preview>
      <div className="card-head">
        <div className="card-title">Roof diagram</div>
        <span className="chip wait">Admin preview</span>
      </div>
      <p className={r.note} style={{ margin: "0 0 14px" }}>
        Only platform admins see this card. The facets and lines are read off Google&apos;s height map of the roof, so treat the figures as a draft beside the measurement above.
      </p>
      {!drawn ? <p className={r.busy} role="status">Drawing the facets…</p> : null}
      {drawn && !drawn.ok ? (
        <p className={r.fail} role="alert" data-roof-diagram-error>
          {drawn.error}
        </p>
      ) : null}
      {drawn?.ok ? <RoofLabStage id={measurementId} drawing={drawn.drawing} startView="facets" /> : null}
    </div>
  );
}
