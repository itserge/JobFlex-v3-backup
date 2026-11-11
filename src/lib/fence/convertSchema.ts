// What the fence estimator hands to convertFenceEstimateToProposal. Kept out
// of the "use server" file so the QA harness (scripts/qa/fence-convert-lines
// .check.ts) can validate the package engine's lines against the SAME rules
// the action applies — a line the engine can produce and the schema refuses
// is a conversion that fails in the field.
import { z } from "zod";

/** The 3D snapshot: a JPEG/WebP/PNG data URL, compressed on the client
 *  (fence-estimator-behavior captureModel) to stay well under Vercel's
 *  4.5 MB request cap. The server drops anything larger rather than failing. */
export const PREVIEW_MAX_CHARS = 1_500_000;

const planPoint = z.object({ x: z.number().finite(), y: z.number().finite(), gap: z.boolean().optional() });

export const fenceConvertSchema = z.object({
  title: z.string().min(1).max(200),
  scope: z.string().optional(),
  materials: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().finite(),
      unitPrice: z.number().finite(),
      unit: z.string().optional(),
    }),
  ),
  labor: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().finite(),
      unitPrice: z.number().finite(),
      unit: z.string().optional(),
    }),
  ),
  assumptions: z.array(z.string()),
  // The package engine's lines (lib/fence/pricing, 2026-09-18): one row per
  // part of the job with its MATERIAL and LABOR halves per unit, so the
  // proposal can print both to the client and the org's markup lands on
  // each half. When present these are the proposal's lines; `materials` /
  // `labor` above stay for the older callers.
  lines: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(400).optional(),
        quantity: z.number().finite().min(0),
        unit: z.string().optional(),
        materialCost: z.number().finite().min(0),
        laborCost: z.number().finite().min(0),
      }),
    )
    .max(80)
    .optional(),
  // The studio's material takeoff for these lines (lib/fence/takeoff BomLine), kept beside the proposal as the
  // crew's pick list (lib/fence/savedTakeoff). Optional: without it the list is rebuilt from the lines.
  takeoff: z
    .array(z.object({ label: z.string().min(1).max(240), qty: z.number().finite().min(0).max(1_000_000), unit: z.string().max(20) }))
    .max(80)
    .optional(),
  // The job address: rides with the proposal and sets the state's sales tax.
  address: z.string().max(300).optional().nullable(),
  // Optional 3D snapshot (data URL) — uploaded to Blob and attached when present.
  previewDataUrl: z.string().optional(),
  // The traced layout (2026-09-23): kept with the proposal as an ActivityEvent
  // (FENCE_PLAN) and drawn for the client's page (lib/fence/planSvg). Local
  // feet about the address pin, like the estimator's own trace.
  plan: z
    .object({
      points: z.array(planPoint).min(2).max(600),
      gates: z.array(z.object({ segmentIndex: z.number().int().min(0).max(600), t: z.number().min(0).max(1), widthFt: z.number().min(0).max(40), kind: z.enum(["gate", "door"]), label: z.string().max(60).optional(), x: z.number().finite().optional(), y: z.number().finite().optional() })).max(40),
      buildings: z.array(z.object({ ring: z.array(planPoint).min(3).max(300), role: z.enum(["subject", "neighbor"]), heightFt: z.number().min(6).max(80).optional() })).max(40),
      lots: z.array(z.array(planPoint).min(3).max(400)).max(10),
      origin: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
      heightFt: z.number().min(0).max(20),
      typeLabel: z.string().max(120),
      totalLf: z.number().min(0).max(100_000),
      address: z.string().max(300).nullable(),
      // The studio's 3D beyond the plan (lib/fence/scene, 2026-09-27): the
      // look, the gates with their variants, the slope class per run, the
      // wall mounts, the land's lattice, the lot line's colour. Bounded like
      // the plan: the lattice is at most 80 × 80 and 2,500 points.
      scene: z
        .object({
          family: z.enum(["cedar", "vinyl", "chain-link", "aluminum", "composite"]),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          gates: z.array(z.object({ id: z.string().max(40), segmentIndex: z.number().int().min(-1).max(600), t: z.number().min(0).max(1), widthFt: z.number().min(0).max(40), kind: z.enum(["gate", "door"]), variant: z.string().max(20), x: z.number().finite().optional(), y: z.number().finite().optional() })).max(40),
          segClasses: z.record(z.string().regex(/^\d{1,3}$/), z.enum(["level", "racked", "stepped"])).refine((o) => Object.keys(o).length <= 600, "too many segments"),
          // The ticket's step count per stepped segment (2026-10-01).
          segSteps: z.record(z.string().regex(/^\d{1,3}$/), z.number().int().min(1).max(400)).refine((o) => Object.keys(o).length <= 600, "too many segments").optional(),
          wallMounts: z.array(planPoint).max(40),
          terrain: z
            .object({
              plan: z.object({ x0: z.number().finite(), y0: z.number().finite(), dx: z.number().positive().max(10_000), dy: z.number().positive().max(10_000), cols: z.number().int().min(2).max(80), rows: z.number().int().min(2).max(80) }),
              grid: z.array(z.array(z.number().finite()).min(2).max(80)).min(2).max(80),
            })
            .refine((t) => t.plan.cols * t.plan.rows <= 2500 && t.grid.length === t.plan.rows && t.grid.every((row) => row.length === t.plan.cols), "lattice shape")
            .nullable(),
          lotColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
          // What the fence is built from (lib/fence/build, 2026-09-28): read
          // back defensively there; here only the shape and the ranges.
          build: z
            .object({
              spacingFt: z.number().min(2).max(24),
              kind: z.enum(["stick", "panel", "mesh", "rail"]),
              rails: z.number().int().min(0).max(8),
              infill: z.enum(["boards", "board-on-board", "shadowbox", "pickets", "horizontal", "bars", "mesh", "none"]),
              boardWidthFt: z.number().min(0.01).max(2),
              boardGapFt: z.number().min(-1).max(2),
              boardDepthFt: z.number().min(0.005).max(0.5),
              railHeightFt: z.number().min(0.01).max(1),
              railDepthFt: z.number().min(0.01).max(1),
              postWidthFt: z.number().min(0.05).max(1.5),
              terminalWidthFt: z.number().min(0.05).max(1.5),
              postProfile: z.enum(["square", "round"]),
              postCap: z.enum(["flat", "pyramid", "gothic", "dome", "loop", "none"]),
              postProudFt: z.number().min(0).max(2),
              meshDiamondFt: z.number().min(0.05).max(1).optional(),
              rackMaxDeg: z.number().min(0).max(45),
            })
            .nullable()
            .optional(),
        })
        .optional(),
    })
    .optional(),
  // Pre-links the proposal to a client when converted from a client's page.
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
});

export type FenceConvertInput = z.infer<typeof fenceConvertSchema>;

/** The first thing wrong, as a person would say it: "lines.3.name: too short". */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.length ? issue.path.join(".") + ": " : "";
  return (path + issue.message).slice(0, 160);
}
