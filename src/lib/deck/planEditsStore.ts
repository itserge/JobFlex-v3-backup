import "server-only";
// THE CONTRACTOR'S EDITS TO THE PLAN SET, KEPT BY THE PROPERTY (2026-11-09) —
// beside the site plan (lib/deck/sitePlanStore) and for the same reason: the
// draft, the proposal and an unsaved design at one address print one set. A
// design without an address keeps them by its draft or its proposal. SyncState,
// no schema change; the studio's auto-save never touches them.

import { db } from "@/lib/db";
import { addressKey } from "./sitePlanStore";
import { MAX_EDITS_JSON, normalizePlanEdits, type PlanEdits } from "./plans/edits";

export interface PlanEditsRef {
  address?: string | null;
  draftId?: string | null;
  proposalId?: string | null;
}

const idPart = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  return t.length >= 6 ? t : null;
};

/** Where a set's edits are kept: the address, else the draft, else the proposal; null when none is known. */
export function planEditsKey(organizationId: string, ref: PlanEditsRef): string | null {
  const a = addressKey(ref.address);
  if (a) return `deckplanedits:${organizationId}:${a}`;
  const d = idPart(ref.draftId);
  if (d) return `deckplanedits:${organizationId}:draft:${d}`;
  const p = idPart(ref.proposalId);
  if (p) return `deckplanedits:${organizationId}:proposal:${p}`;
  return null;
}

export async function readPlanEdits(organizationId: string, ref: PlanEditsRef): Promise<PlanEdits | null> {
  const key = planEditsKey(organizationId, ref);
  if (!key) return null;
  try {
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    if (!row?.cursor) return null;
    return normalizePlanEdits(JSON.parse(row.cursor));
  } catch {
    return null;
  }
}

/** Keeps the edits (already normalized by the caller); false when no key is known or they are over the size limit. */
export async function writePlanEdits(organizationId: string, ref: PlanEditsRef, edits: PlanEdits): Promise<boolean> {
  const key = planEditsKey(organizationId, ref);
  if (!key) return false;
  const cursor = JSON.stringify(edits);
  if (cursor.length > MAX_EDITS_JSON) return false;
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  return true;
}
