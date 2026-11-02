// LEAD CENTER TEST ENVIRONMENT (owner, 2026-10-29: "testing environments where we can send out automatic leads in a
// test environment without actually sending, so we can test and debug").
//
// A TEST-ENVIRONMENT LEAD is a test lead (PlatformLead.isTest, lib/leadCenter/testLeads) that the admin created with
// "Route automatically". Unlike an ordinary test lead it does not park in the queue: it runs the real cascade — the
// ranking, the 24-hour offers, the reminder two hours out, a pass or a lapse moving it on, three attempts, the
// manual queue — with two differences:
//   1. ONLY JobFlex's own organizations (Organization.isInternal) are in its ranking, so no real shop ever sees it.
//      What production WOULD have done is kept beside it: the real ranking's first shops (`wouldRank`).
//   2. NOTHING LEAVES. Every email and text on its path — the homeowner's, the shop's — is recorded here instead of
//      sent (lib/leadCenter/outboxContext), with the letter's HTML, and shown on the Lead Center.
// Routing mode does not apply to it: the point is to rehearse the automatic path while production is manual.
//
// STORAGE: SyncState rows (no schema change) — `leadSandbox:<id>` holds the run (when, wouldRank, the message list
// without bodies), `leadSandbox:<id>:msg:<n>` each body. At most MAX_MESSAGES per lead; the oldest go first.
//
// Plain server module (NOT "use server").
import { db } from "@/lib/db";
import { activeCapture, runCaptured, type CapturedMessage } from "./outboxContext";

const runKey = (id: string) => `leadSandbox:${id}`;
const msgKey = (id: string, n: number) => `leadSandbox:${id}:msg:${n}`;
const MAX_MESSAGES = 60;
const MAX_BODY = 200_000;

export type WouldRankEntry = { orgId: string; orgName: string; score: number; distanceMi: number | null };
export type SandboxMessageMeta = Omit<CapturedMessage, "body"> & { n: number; at: string; excerpt: string };
export type SandboxRun = {
  createdAt: string;
  /** The real ranking's first shops — who production would have offered it to, in order. Null until routed. */
  wouldRank: WouldRankEntry[] | null;
  messages: SandboxMessageMeta[];
  /** The running message number (never reused, so a cleared log does not hand out an old body). */
  seq: number;
};

function parseRun(cursor: string | null | undefined): SandboxRun | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(cursor) as SandboxRun;
    if (!v || typeof v.createdAt !== "string") return null;
    return { createdAt: v.createdAt, wouldRank: Array.isArray(v.wouldRank) ? v.wouldRank : null, messages: Array.isArray(v.messages) ? v.messages : [], seq: Number(v.seq) || 0 };
  } catch {
    return null;
  }
}

async function readRun(id: string): Promise<SandboxRun | null> {
  const row = await db.syncState.findUnique({ where: { key: runKey(id) } }).catch(() => null);
  return parseRun(row?.cursor);
}

async function writeRun(id: string, run: SandboxRun): Promise<void> {
  const cursor = JSON.stringify(run);
  await db.syncState.upsert({ where: { key: runKey(id) }, update: { cursor }, create: { key: runKey(id), cursor } });
}

/** One writer per lead at a time inside this process: a step sends several letters at once (Promise.all). */
const chains = new Map<string, Promise<unknown>>();
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(id, next);
  void next.finally(() => {
    if (chains.get(id) === next) chains.delete(id);
  });
  return next;
}

export async function isSandboxLead(platformLeadId: string): Promise<boolean> {
  return (await readRun(platformLeadId)) !== null;
}

/** Mark a fresh test lead as a test-environment lead. Called by the intake before anything is routed or sent. */
export async function markSandboxLead(platformLeadId: string): Promise<void> {
  await writeRun(platformLeadId, { createdAt: new Date().toISOString(), wouldRank: null, messages: [], seq: 0 });
}

export async function setWouldRank(platformLeadId: string, ranking: WouldRankEntry[]): Promise<void> {
  await serial(platformLeadId, async () => {
    const run = await readRun(platformLeadId);
    if (!run) return;
    await writeRun(platformLeadId, { ...run, wouldRank: ranking.slice(0, 5) });
  });
}

function excerptOf(m: CapturedMessage): string {
  const text = m.channel === "email"
    ? m.body.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    : m.body;
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

async function recordMessage(platformLeadId: string, m: CapturedMessage): Promise<void> {
  await serial(platformLeadId, async () => {
    const run = await readRun(platformLeadId);
    if (!run) return;
    const n = run.seq + 1;
    const body = m.body.slice(0, MAX_BODY);
    await db.syncState.upsert({ where: { key: msgKey(platformLeadId, n) }, update: { cursor: body }, create: { key: msgKey(platformLeadId, n), cursor: body } });
    const meta: SandboxMessageMeta = { channel: m.channel, to: m.to, subject: m.subject ?? null, note: m.note ?? null, what: m.what ?? null, n, at: new Date().toISOString(), excerpt: excerptOf(m) };
    const messages = [...run.messages, meta];
    const dropped = messages.length > MAX_MESSAGES ? messages.splice(0, messages.length - MAX_MESSAGES) : [];
    await writeRun(platformLeadId, { ...run, messages, seq: n });
    if (dropped.length) await db.syncState.deleteMany({ where: { key: { in: dropped.map((d) => msgKey(platformLeadId, d.n)) } } }).catch(() => null);
  });
  console.info(`[lead-test] ${m.channel} captured, not sent — lead=${platformLeadId}${m.what ? ` kind=${m.what}` : ""}`);
}

/**
 * Run one step of a lead's path. For a test-environment lead every email and text inside `fn` is recorded instead
 * of sent; for any other lead `fn` runs as it always did. Never throws on its own account.
 */
export async function inLeadSandbox<T>(platformLeadId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!platformLeadId) return fn();
  if (activeCapture()?.platformLeadId === platformLeadId) return fn();
  if (!(await isSandboxLead(platformLeadId).catch(() => false))) return fn();
  return runCaptured({ platformLeadId, record: (m) => recordMessage(platformLeadId, m).catch((err) => console.error("[lead-test] capture failed:", err)) }, fn);
}

/** The runs of these leads, for the Lead Center. */
export async function readSandboxRuns(ids: string[]): Promise<Map<string, SandboxRun>> {
  const out = new Map<string, SandboxRun>();
  if (!ids.length) return out;
  const rows = await db.syncState.findMany({ where: { key: { in: ids.map(runKey) } } }).catch(() => []);
  for (const r of rows) {
    const run = parseRun(r.cursor);
    if (run) out.set(r.key.slice("leadSandbox:".length), run);
  }
  return out;
}

/** One captured message's body — the letter's HTML or the text's words. */
export async function readSandboxBody(platformLeadId: string, n: number): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key: msgKey(platformLeadId, n) } }).catch(() => null);
  return row?.cursor ?? null;
}

/** Empty a run's log. The lead stays a test-environment lead. */
export async function clearSandboxMessages(platformLeadId: string): Promise<void> {
  await serial(platformLeadId, async () => {
    const run = await readRun(platformLeadId);
    if (!run) return;
    await db.syncState.deleteMany({ where: { key: { startsWith: `leadSandbox:${platformLeadId}:msg:` } } });
    await writeRun(platformLeadId, { ...run, messages: [] });
  });
}
