// Which EagleView Property Data packs the ACCOUNT may order.
//
// A 403 / 10880 on a pack is a fact about the credentials, not about the
// address that was being ordered (2026-09-08: pack 001 orders, the seven-pack
// order does not — the entitlement is partial). So the record lives here,
// account-wide, not per address and not per organization:
//
//   live    an order for this pack was accepted (billed) — the pack is on.
//   denied  an order carrying the pack was refused for entitlement (403, or
//           400 / 10640 — lib/eagleview pdEntitlementRefusal); `error` keeps
//           EagleView's code, `checkedAt` the moment. A refusal costs nothing,
//           so a denied pack is probed again once the record is older than a day.
//   no row  never probed.
//
// The reader is lib/eagleviewOrder (the order planner); the only writers are
// that planner and scripts/eagleview-recheck-entitlements.ts, which resets
// the table so the next order re-probes everything.

import { db } from "@/lib/db";
import { PD_DIAGRAM_PACKS, PD_FIGURE_PACKS, type PdPack } from "@/lib/eagleview";

export type PackStatus = "live" | "denied";

export interface PackRecord {
  pack: string;
  status: PackStatus;
  checkedAt: Date;
  error: string | null;
  /** Not observed by this table — the starting assumption below. */
  assumed?: boolean;
}

/**
 * STARTING STATE, before the table has seen a single order: the figure packs
 * (001 area, 002 pitch + eave) are taken as live. That is the one thing the
 * upstream fix 5c727b0 (2026-09-08) knew from the field — the account, org
 * 347167560, was refused the seven-pack order and accepted 001 + 002 — and
 * its hard-coded "retry with 001 + 002" is replaced by this assumption
 * feeding the planner: 002 goes in the grouped known-live request, the rest
 * are probed one by one. The first real verdict on 002 overwrites it.
 */
export const ASSUMED_LIVE: readonly PdPack[] = PD_FIGURE_PACKS;
const ASSUMED_NOTE = "assumed live from the field observation of 2026-09-08 (upstream 5c727b0: org 347167560 accepted 001 + 002); not yet verified by this table";

/** A denied pack older than this is asked again on the next order. */
export const DENIED_RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * The order packs are probed one by one when a grouped order is refused —
 * the ones the roof page misses most first: material / condition / SHAPE /
 * FACET COUNT (all four ride in 003 — the stored raw bodies say so,
 * 2026-10-16), pitch + eave height, the outline, then chimney / solar / AC
 * (005) and the age classifier. The imagery (008) is not here: it is never
 * probed alone (PAIRED_ONLY).
 */
export const PROBE_ORDER: readonly PdPack[] = [
  "property_data_id_003",
  "property_data_id_002",
  "property_data_id_007",
  "property_data_id_005",
  "property_data_id_004",
];

/**
 * Packs that are never asked for ALONE: the ortho imagery (008). EagleView's
 * own Data Packs guide carries the note "requesting this pack alone returned
 * errorCode 10640 (entitlement) but it returned data when paired with another
 * pack" — and alone is exactly how this table re-checked it from 2026-09-08 on,
 * so its "denied" could never turn back to "live" whatever the account had
 * (2026-11-12). In August it arrived inside the seven-pack order. Such a pack
 * is re-checked riding along with another order of the same click (the
 * planner, lib/eagleviewOrder), never by itself.
 */
export const PAIRED_ONLY: readonly PdPack[] = ["property_data_id_008"];

/** What each pack is, for the admin's table (Admin → Integrations). */
export const PACK_NAMES: Record<string, string> = {
  property_data_id_001: "Roof area",
  property_data_id_002: "Pitch + eave height",
  property_data_id_003: "Material, condition, shape, facets",
  property_data_id_004: "Roof age",
  property_data_id_005: "Chimney, solar, rooftop AC",
  property_data_id_006: "Risk scores (not ordered)",
  property_data_id_007: "Building outlines",
  property_data_id_008: "Ortho imagery (aerial photo)",
  property_data_id_009: "Oblique imagery (not ordered)",
};

export interface PackRow {
  pack: string;
  name: string;
  status: PackStatus | "unchecked";
  /** ISO time of the last verdict; null when never checked. */
  checkedAt: string | null;
  /** EagleView's refusal as "403 / 10880", "400 / 10640"; null when none. */
  refusal: string | null;
  /** The last re-check that settled nothing, as written by notePacks. */
  unsettled: string | null;
}

/** The account's packs as the admin reads them: every diagram pack, checked or not, in pack order. */
export async function packRows(): Promise<PackRow[]> {
  const rows = await db.eagleViewEntitlement.findMany();
  const byPack = new Map(rows.map((r) => [r.pack, r]));
  const packs = [...new Set([...PD_DIAGRAM_PACKS, ...rows.map((r) => r.pack)])].sort();
  return packs.map((pack) => {
    const r = byPack.get(pack);
    const err = r?.error ?? null;
    const unsettled = err?.startsWith(UNSETTLED_PREFIX) ? err : null;
    const m = err && !unsettled ? err.match(/\((\d{3}(?: \/ \d+)?)\)/) : null;
    return {
      pack,
      name: PACK_NAMES[pack] ?? pack,
      status: r ? (r.status as PackStatus) : "unchecked",
      checkedAt: r ? r.checkedAt.toISOString() : null,
      refusal: r?.status === "denied" ? (m?.[1] ?? null) : null,
      unsettled,
    };
  });
}

/** A probe that settled nothing (timeout, 5xx, a function cut off): said, dated, verdict unchanged. */
export const UNSETTLED_PREFIX = "Not settled";

export async function readEntitlements(): Promise<Map<string, PackRecord>> {
  const rows = await db.eagleViewEntitlement.findMany();
  const map = new Map<string, PackRecord>(
    rows.map((r) => [r.pack, { pack: r.pack, status: r.status as PackStatus, checkedAt: r.checkedAt, error: r.error }]),
  );
  for (const pack of ASSUMED_LIVE) {
    if (!map.has(pack)) map.set(pack, { pack, status: "live", checkedAt: new Date(0), error: ASSUMED_NOTE, assumed: true });
  }
  return map;
}

export async function markPacks(packs: readonly string[], status: PackStatus, error: string | null = null): Promise<void> {
  const now = new Date();
  for (const pack of packs) {
    await db.eagleViewEntitlement.upsert({
      where: { pack },
      update: { status, checkedAt: now, error },
      create: { pack, status, checkedAt: now, error },
    });
  }
}

/**
 * A re-check that reached no verdict: the reason and the moment go on the
 * pack's row, its status and checkedAt stay — so the 24-hour clock is not reset
 * by a failure that said nothing about the account, and the next order asks
 * again. Before 2026-11-12 these were only logged, which is why the 2026-11-12
 * re-check of 008 left no trace at all. A pack with no row gets none.
 */
export async function notePacks(packs: readonly string[], reason: string): Promise<void> {
  const error = `${UNSETTLED_PREFIX} ${new Date().toISOString()}: ${reason}`.slice(0, 500);
  for (const pack of packs) {
    await db.eagleViewEntitlement.updateMany({ where: { pack }, data: { error } });
  }
}

/** No record, or a refusal old enough to be worth a free re-ask. */
export function needsProbe(rec: PackRecord | undefined, now = Date.now()): boolean {
  if (!rec) return true;
  return rec.status === "denied" && now - rec.checkedAt.getTime() > DENIED_RECHECK_MS;
}

/** Forget every verdict; the next order probes from scratch. Returns rows removed. */
export async function resetEntitlements(): Promise<number> {
  const r = await db.eagleViewEntitlement.deleteMany();
  return r.count;
}
