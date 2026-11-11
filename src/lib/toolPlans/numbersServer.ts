import "server-only";
// THE NEW PLANS' NUMBERS, READ (Base + Tools, part 5). The pure figures (lib/toolPlans/numbers) over the subscriber
// rows a caller already has — Admin → Revenue's own read (lib/revenue-server), so no second Stripe read — and every
// shop's record (SyncState `orgTools:<orgId>`, one query). Callers check the platform admin first: nothing here does.

import { db } from "@/lib/db";
import { readPricingModel } from "./server";
import { TOOLS_RECORD_PREFIX } from "./billing";
import { parseToolsRecord, type ToolsRecord } from "./shared";
import { toolPlansNumbers, type NumbersRow, type ToolPlansReport } from "./numbers";

export async function readToolPlansNumbers(rows: readonly NumbersRow[], source: "stripe" | "record"): Promise<ToolPlansReport> {
  const [recordRows, model] = await Promise.all([
    db.syncState.findMany({ where: { key: { startsWith: TOOLS_RECORD_PREFIX } }, select: { key: true, cursor: true } }),
    readPricingModel(),
  ]);
  const records = recordRows
    .map((row) => ({ organizationId: row.key.slice(TOOLS_RECORD_PREFIX.length), record: parseToolsRecord(row.cursor) }))
    .filter((r): r is { organizationId: string; record: ToolsRecord } => !!r.record);
  return { ...toolPlansNumbers({ rows, records }), switchOn: model.mode === "tools", source };
}
