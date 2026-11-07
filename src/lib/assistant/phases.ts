import "server-only";
// A NEW BUILD'S PHASES FOR THE AI OPERATOR (2026-11-07, part 4 of the plan "Projects: Remodel and New construction") —
// "What's the next gate on the Lee house?", "where are we on the Lee house?", "what holds the framing?". One read,
// a thin call into what the Phases strip reads (lib/projectPhases); the Operator never decides a phase's state itself.

import { z } from "zod";
import type { ReadTool } from "@/lib/assistant/tools";
import { projectNamed } from "@/lib/assistant/projects";
import { phasesOf } from "@/lib/projectPhases/server";
import { gateLineOf } from "@/lib/projectPhases/shared";

const ID = z.string().min(1).max(64);

const nextGate: ReadTool<{ projectId: string }> = {
  kind: "read",
  name: "next_gate",
  need: "projects.read",
  card: {
    label: "Next gate",
    purpose: "Where a new build stands: the phase it is on, what closes it (the county's inspections and their state, the client's or the lender's word), and every phase's state from the lot to the keys.",
    when: "'What's the next gate on the Lee house?', 'where are we on the Lee house', 'what holds the framing phase', 'how many phases are done': next_gate with the project id (find it first). A remodel has no phases — project_status then.",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "what's the next gate on the Lee house?", args: { projectId: "proj_1" } }],
  },
  description:
    "A new build's phases (land, design, permits, site work, foundation, framing and dry-in, rough-ins, insulation and drywall, finishes, final and keys; a shop lane when there is one): the one the project is on, its gate — the inspections on its stages that still have to pass, or the client's or the lender's word — and each phase's state. Give the project id (find it first). Use for: what's the next gate, where are we, what holds the framing, how many phases are done. A remodel has no phases.",
  params: z.object({ projectId: ID }),
  async run({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { error: "I couldn't find that project." };
    const read = await phasesOf(p.one.id);
    if (!read.phases.length) return { project: p.one.name, note: `${p.one.name} has no phases — it is a remodel, or its stages were added by hand. project_status has where it stands.` };
    const cur = read.current;
    return {
      project: p.one.name,
      current: cur
        ? {
            phase: cur.name,
            gate: gateLineOf(cur),
            gateKind: cur.gateKind,
            holding: cur.holding.map((g) => `${g.name} — ${g.result === "FAILED" ? "failed, re-inspect" : g.date ? `booked ${g.date}` : "not booked yet"}`),
            stages: `${cur.stagesDone} of ${cur.stageCount} done`,
          }
        : null,
      done: read.phases.filter((x) => x.status === "DONE").length,
      total: read.phases.length,
      phases: read.phases.map((x) => ({ phase: x.name, status: x.status.toLowerCase(), lane: x.lane, gate: gateLineOf(x) })),
      note: cur ? undefined : "Every phase is done — the finish line is what is left (finish_line).",
    };
  },
};

export const PHASE_TOOLS = [nextGate] as const;
