import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { readRevenueReport } from "@/lib/revenue-server";
import type { RevenueReport } from "@/lib/revenue-contract";

// THE REVENUE PAGE'S SAVED COPY (owner, 2026-11-04: "check why the revenue page in admin is loading forever"). The
// read walks all of Stripe's history — every subscription, invoice, payment, charge, refund and dispute, then a
// preview of each upcoming bill — and a slow one outlasted the page's five minutes, leaving "Reading subscriptions
// and payments from Stripe…" on screen for good. So the last good read is kept (SyncState), the page opens on it at
// once, and a new read runs after the response when it is over ten minutes old or Refresh is pressed — one at a time
// across instances. Only the very first read is waited for, and only so long; then the page says it is still reading
// and opens by itself when it is done. Callers check the platform admin first: nothing here does.

const SAVED = "revenueReport";
const READING = "revenueReport:reading";
/** A saved read younger than this is shown as it is. */
const FRESH_MS = 10 * 60_000;
/** With nothing saved, the page waits this long for the first read before saying it is still reading. */
const WAIT_MS = 25_000;
/** A read not finished by then has died with its function (the page's maxDuration is 300 s). */
const READING_MS = 5 * 60_000;
/** After a failed read with nothing saved, the page says so for this long before trying again by itself. */
const FAILED_MS = 2 * 60_000;

type ReadMark = { startedAt: number; endedAt?: number; failed?: boolean };
export type RevenueView = { kind: "report"; report: RevenueReport } | { kind: "reading" } | { kind: "failed" };

async function readJson<T>(key: string): Promise<T | null> {
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as T;
  } catch {
    return null;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  const cursor = JSON.stringify(value);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}
const isReading = (m: ReadMark | null) => !!m && !m.endedAt && Date.now() - m.startedAt < READING_MS;

/** A new read, saved when it lands — or null when another is already running. Wrapped, so awaiting this waits for
 *  the start, not the read. */
async function beginRead(): Promise<{ read: Promise<RevenueReport> } | null> {
  if (isReading(await readJson<ReadMark>(READING))) return null;
  const startedAt = Date.now();
  await writeJson(READING, { startedAt } satisfies ReadMark);
  const read = readRevenueReport().then(
    async (report) => {
      await writeJson(SAVED, report);
      await writeJson(READING, { startedAt, endedAt: Date.now() } satisfies ReadMark);
      return report;
    },
    async (error: unknown) => {
      console.error("[revenue] read failed", error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError");
      await writeJson(READING, { startedAt, endedAt: Date.now(), failed: true } satisfies ReadMark).catch(() => {});
      throw error;
    },
  );
  return { read };
}
/** The read keeps going after the response; its failure is logged in beginRead, never thrown at the page. */
const keepGoing = (read: Promise<RevenueReport>) => after(read.then(() => undefined, () => undefined));

/** What the page shows: the saved read (and a new one started behind it when it is old), or the first read. */
export async function readRevenueView(): Promise<RevenueView> {
  const [saved, mark] = await Promise.all([readJson<RevenueReport>(SAVED), readJson<ReadMark>(READING)]);
  if (saved) {
    if (Date.now() - Date.parse(saved.asOf) > FRESH_MS && !isReading(mark)) {
      const begun = await beginRead();
      if (begun) keepGoing(begun.read);
      return { kind: "report", report: { ...saved, updating: !!begun } };
    }
    return { kind: "report", report: { ...saved, updating: isReading(mark) } };
  }
  if (isReading(mark)) return { kind: "reading" };
  if (mark?.failed && mark.endedAt && Date.now() - mark.endedAt < FAILED_MS) return { kind: "failed" };
  const begun = await beginRead();
  if (!begun) return { kind: "reading" };
  const first = await Promise.race([begun.read.then((report) => report, () => "failed" as const), new Promise<null>((done) => setTimeout(() => done(null), WAIT_MS))]);
  if (first === "failed") return { kind: "failed" };
  if (first) return { kind: "report", report: first };
  keepGoing(begun.read);
  return { kind: "reading" };
}

/** Refresh pressed: a new read behind the saved one, unless one is running. */
export async function startRevenueRead(): Promise<void> {
  const begun = await beginRead();
  if (begun) keepGoing(begun.read);
}
