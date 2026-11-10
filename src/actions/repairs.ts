"use server";
// REPAIRS AND COME-BACKS — the repair sheet's actions (2026-11-09, the ProSmart gaps plan, part 2). The office books
// a repair (owner, admin, manager): sales and the crew don't send a van. The work is lib/repairs/server.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/orgContext";
import { bookRepair, repairOpenTimes, repairSheetData, setRepairCause, type BookRepairResult, type RepairSheetData } from "@/lib/repairs/server";
import { isCause } from "@/lib/repairs/shared";

const ID = z.string().min(1).max(64);

export async function getRepairSheet(raw: unknown): Promise<RepairSheetData> {
  const { organizationId } = await requireManager();
  const ref = z.object({ jobId: ID.nullish(), proposalId: ID.nullish(), projectId: ID.nullish(), clientId: ID.nullish() }).parse(raw);
  return repairSheetData(organizationId, ref);
}

export async function getRepairOpenTimes(raw: unknown): Promise<Array<{ workerId: string; who: string; day: string; start: string; words: string }>> {
  const { organizationId } = await requireManager();
  const input = z.object({ workerId: ID.nullable(), hours: z.number().min(0.5).max(12) }).parse(raw);
  const offers = await repairOpenTimes(organizationId, input);
  return offers.map((o) => ({ workerId: o.workerId, who: o.who, day: o.day, start: o.start, words: o.words }));
}

const bookSchema = z.object({
  jobId: ID.nullable(),
  proposalId: ID.nullable(),
  reasons: z.array(z.string().max(40)).max(12),
  note: z.string().max(1500).nullable(),
  cause: z.string().nullable(),
  billable: z.boolean(),
  charge: z.number().min(0).max(1_000_000).nullable(),
  sendChangeOrder: z.boolean(),
  workerId: ID.nullable(),
  pay: z.number().min(0).max(100_000).nullable(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).nullable(),
  hours: z.number().min(0.5).max(12),
  force: z.boolean(),
});

export async function bookRepairFromSheet(raw: unknown): Promise<BookRepairResult> {
  const { organizationId, user } = await requireManager();
  const d = bookSchema.parse(raw);
  const r = await bookRepair({ organizationId, userId: user.id }, { ...d, cause: isCause(d.cause) ? d.cause : null, via: "sheet" });
  if (r.ok) {
    for (const p of ["/dashboard/calendar", "/dashboard/jobs", `/dashboard/jobs/${r.jobId}`, `/dashboard/jobs/${r.original.id}`, "/dashboard/proposals", "/dashboard/workers", "/dashboard/projects", "/dashboard/clients"]) revalidatePath(p);
  }
  return r;
}

export async function setRepairCauseAction(jobId: string, cause: string | null): Promise<{ cause: string | null }> {
  const { organizationId, user } = await requireManager();
  const r = await setRepairCause(organizationId, user.id, ID.parse(jobId), isCause(cause) ? cause : null);
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/workers");
  return r;
}
