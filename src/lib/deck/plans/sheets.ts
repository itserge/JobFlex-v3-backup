// THE SHEETS OF THE PLAN SET (2026-10-23) — pure: which sheets a structure
// needs, numbered the way the building department expects (the U.S. National
// CAD Standard's discipline letter, then the sheet type, then the sequence):
//   G  general — the cover, the notes and the code compliance
//   A  architectural — the site plan
//   S  structural — the foundation, the framing, the roof, the elevations,
//      the sections, the details, the schedules
// The crew's construction set is its own short run on letter paper, C-1 on.
import type { DeckStructure } from "../structure";
import type { PaperKey } from "./paper";

export type PlanSheetKind = "cover" | "notes" | "notes2" | "site" | "foundation" | "framing" | "roof" | "elevations" | "sections" | "details" | "schedules" | "crew-cover" | "crew-layout" | "crew-framing" | "crew-stairs" | "crew-materials" | "crew-sequence" | "extra";

export interface PlanSheet {
  no: string;
  name: string;
  kind: PlanSheetKind;
  /** B = 11 × 17, C = 18 × 24, D = 24 × 36 landscape (lib/deck/plans/paper); A = letter portrait, the crew's. */
  paper: "A" | PaperKey;
  /** A sheet the contractor added in the set's Edit (kind "extra"; lib/deck/plans/edits). */
  extraId?: string;
}

/** `complianceMore`: the code compliance table runs past G-002 and continues on G-003. */
export function permitSheetList(s: DeckStructure, opts: { complianceMore?: boolean; paper?: PaperKey } = {}): PlanSheet[] {
  const paper: PaperKey = opts.paper ?? "B";
  const out: PlanSheet[] = [
    { no: "G-001", name: "Cover sheet", kind: "cover", paper },
    { no: "G-002", name: "General notes and code compliance", kind: "notes", paper },
  ];
  if (opts.complianceMore) out.push({ no: "G-003", name: "Code compliance, continued", kind: "notes2", paper });
  out.push({ no: "A-101", name: "Site plan", kind: "site", paper });
  if (s.frame) {
    out.push({ no: "S-101", name: "Foundation plan", kind: "foundation", paper });
    out.push({ no: "S-102", name: "Deck framing plan", kind: "framing", paper });
  }
  if (s.roof) out.push({ no: s.frame ? "S-103" : "S-101", name: s.roof.kind === "pergola" ? "Pergola framing plan" : "Roof framing plan", kind: "roof", paper });
  out.push({ no: "S-201", name: "Elevations", kind: "elevations", paper });
  if (s.frame) out.push({ no: "S-301", name: s.stairs.some((st) => st.kind === "flight") ? "Building section and stair" : "Building section", kind: "sections", paper });
  out.push({ no: "S-501", name: "Details", kind: "details", paper });
  out.push({ no: "S-601", name: "Schedules and materials", kind: "schedules", paper });
  return out;
}

export function crewSheetList(s: DeckStructure): PlanSheet[] {
  const out: PlanSheet[] = [{ no: "C-0", name: "Construction set — cover", kind: "crew-cover", paper: "A" }];
  if (s.frame) {
    out.push({ no: "C-1", name: "Footing layout", kind: "crew-layout", paper: "A" });
    out.push({ no: "C-2", name: "Framing and cut list", kind: "crew-framing", paper: "A" });
  }
  if (s.stairs.some((st) => st.kind === "flight" && st.risers > 0)) out.push({ no: `C-${out.length}`, name: "Stair layout", kind: "crew-stairs", paper: "A" });
  out.push({ no: `C-${out.length}`, name: "Materials schedule", kind: "crew-materials", paper: "A" });
  out.push({ no: `C-${out.length}`, name: "Build sequence and inspections", kind: "crew-sequence", paper: "A" });
  return out;
}
