import "server-only";
// WHERE A BUILD IS (2026-11-05, batch 4): a running change notes its step on
// its own row (shared BUILD_STEPS — "Deck Studio", "Rate book", "Priced",
// "Saved"), so the phone's sheet, reading the conversation every few seconds,
// can draw the trace at the real pace. Only while RUNNING: the finish writes
// the result over it.
import { db } from "@/lib/db";

export async function reportProgress(actionId: string | null | undefined, step: string): Promise<void> {
  if (!actionId) return;
  await db.assistantAction.updateMany({ where: { id: actionId, status: "RUNNING" }, data: { resultJson: JSON.stringify({ progress: step.slice(0, 40) }) } }).catch(() => null);
}
