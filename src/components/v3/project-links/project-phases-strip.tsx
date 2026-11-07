"use client";
// THE PHASES STRIP (2026-11-07, part 4 of the plan "Projects: Remodel and New construction"). On a new build, above
// the Stages card on the desk and the handheld project page: the phases from the lot to the keys as a row of tiles —
// done ✓, the one the project is on lit ▶ with its gate's words, the rest planned; a side lane (Site, Shop) says so.
// A tap opens the phase: what closes it (the county's inspections on its stages and their state, the client's or
// the lender's word), how far along its stages are, and the lead times it is known for. Read-only: the stages card
// and the Timeline do the work (lib/projectPhases).

import { useState } from "react";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdPhases } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { gateLineOf } from "@/lib/projectPhases/shared";
import s from "./project-hub.module.css";

type Phase = PdPhases["phases"][number];

const leadsOf = (p: Phase): Array<{ what: string; days: number }> => {
  try {
    const raw = JSON.parse(p.leadsJson ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is { what: string; days: number } => !!x && typeof x === "object" && typeof (x as { what?: unknown }).what === "string" && typeof (x as { days?: unknown }).days === "number") : [];
  } catch {
    return [];
  }
};

export function ProjectPhasesStrip({ phases, answers }: { phases: PdPhases; answers: string | null }) {
  const [open, setOpen] = useState<Phase | null>(null);
  if (!phases.phases.length) return null;
  const cur = phases.current;
  const done = phases.phases.filter((p) => p.status === "DONE").length;
  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Phases" data-project-phases>
        <div className={s.head}>
          <h3 className={s.title}>Phases</h3>
          <span className={s.headSub} data-phases-head>
            {cur ? (
              <>
                <b>{cur.name}</b> · gate: {gateLineOf(cur)}
              </>
            ) : (
              "Every phase is done"
            )}
            {` · ${done} of ${phases.phases.length} done`}
            {answers ? ` · ${answers}` : ""}
          </span>
        </div>
        <div className={s.phases} data-phases-strip>
          {phases.phases.map((p) => {
            const on = cur?.id === p.id;
            return (
              <button key={p.id} type="button" className={`${s.phase} ${p.status === "DONE" ? s.phaseDone : ""} ${on ? s.phaseOn : ""}`} onClick={() => setOpen(p)} data-phase data-phase-key={p.key} data-phase-status={p.status} aria-current={on ? "step" : undefined}>
                <span className={s.phaseMark} aria-hidden="true">
                  {p.status === "DONE" ? "✓" : on ? "▶" : ""}
                </span>
                <span className={s.phaseName}>{p.name}</span>
                <span className={s.phaseGate} data-phase-gate>
                  {p.lane ? `${p.lane} lane · ` : ""}
                  {gateLineOf(p)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <BlueprintSheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.name ?? "Phase"}
        description={open ? `${open.stagesDone} of ${open.stageCount} stage${open.stageCount === 1 ? "" : "s"} done · ${Math.round(open.share * 100)}% of the work${open.lane ? ` · drawn in the ${open.lane} lane` : ""}` : undefined}
      >
        {open ? (
          <div className="bps-form" data-phase-sheet>
            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">What closes it</span>
              <p style={{ margin: "4px 0 0" }}>
                {open.gateKind === "INSPECTION" ? "The county's inspections on its stages. " : open.gateKind === "LENDER" ? "The lender's word. " : "The client's word. "}
                {open.gateWords}
              </p>
              {open.holding.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {open.holding.map((g, i) => (
                    <li key={`${g.name}:${i}`}>
                      {g.name} — {g.result === "FAILED" ? "failed, re-inspect" : g.date ? `booked ${g.date}` : "not booked yet"}
                    </li>
                  ))}
                </ul>
              ) : open.gateKind === "INSPECTION" && open.status !== "DONE" ? (
                <p className="bps-hint">Every inspection on it has passed, or none is booked yet — see the Timeline card.</p>
              ) : null}
            </div>
            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Lead times</span>
              {leadsOf(open).length ? (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {leadsOf(open).map((l) => (
                    <li key={l.what}>
                      {l.what} — order or apply {l.days} days ahead
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bps-hint">Nothing with a long lead in this phase.</p>
              )}
            </div>
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
