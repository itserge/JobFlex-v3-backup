import "server-only";
// THE SUBCONTRACTORS SWEEP (2026-11-08, the subcontractors plan, part 2) — every ten minutes from /api/cron/subs: the
// queued estimate reads, the requests whose links have run out, and the one "reply by tomorrow" reminder. A lease in
// SyncState keeps two runs from overlapping; the last run's figures sit in SyncState for the admin's health page.

import { db } from "@/lib/db";
import { expireRequests, remindDue } from "@/lib/projectSubs/server";
import { runPendingReads } from "./server";

const LEASE_KEY = "subs:sweep:lease";
const STATUS_KEY = "subs:sweep:status";
const LEASE_MS = 9 * 60_000;

export type SweepStatus = { at: string; reads: { tried: number; read: number; failed: number }; expired: number; reminded: number; error: string | null; ms: number };

async function takeLease(): Promise<boolean> {
  const now = Date.now();
  const row = await db.syncState.findUnique({ where: { key: LEASE_KEY } }).catch(() => null);
  if (row && Number(row.cursor) > now) return false;
  const cursor = String(now + LEASE_MS);
  try {
    if (row) {
      const r = await db.syncState.updateMany({ where: { key: LEASE_KEY, cursor: row.cursor }, data: { cursor } });
      return r.count === 1;
    }
    await db.syncState.create({ data: { key: LEASE_KEY, cursor } });
    return true;
  } catch {
    return false;
  }
}

async function dropLease(): Promise<void> {
  await db.syncState.updateMany({ where: { key: LEASE_KEY }, data: { cursor: "0" } }).catch(() => undefined);
}

export async function readSweepStatus(): Promise<SweepStatus | null> {
  const row = await db.syncState.findUnique({ where: { key: STATUS_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as SweepStatus;
  } catch {
    return null;
  }
}

export async function runSubsSweep(opts: { reads?: number } = {}): Promise<SweepStatus | { skipped: "busy" }> {
  if (!(await takeLease())) return { skipped: "busy" };
  const t0 = Date.now();
  const status: SweepStatus = { at: new Date().toISOString(), reads: { tried: 0, read: 0, failed: 0 }, expired: 0, reminded: 0, error: null, ms: 0 };
  try {
    status.reads = await runPendingReads(opts.reads ?? 5);
    status.expired = await expireRequests();
    status.reminded = await remindDue();
  } catch (err) {
    status.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`[subs-sweep] ${status.error}`);
  } finally {
    status.ms = Date.now() - t0;
    const cursor = JSON.stringify(status);
    await db.syncState.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, cursor }, update: { cursor } }).catch(() => undefined);
    await dropLease();
  }
  return status;
}
