// THE POSTHOG ANSWER CACHE (2026-11-02). PostHog lets the whole team ask its
// query endpoint 120 times an hour, and /admin/traffic in Live mode spent that
// in 10–15 minutes ("PostHog query limit reached"): a 12-second cache under a
// 15-second poll was one query per tick, ~300 an hour for one open tab. Every
// HogQL answer the admin surfaces read goes through here, under a name the
// caller gives:
//   - kept in this function's memory AND in SyncState (`phq:` keys), so a cold
//     start, another instance or a cron reads the answer instead of asking again;
//   - within its TTL it is served as is; past it PostHog is asked once, and
//     everyone asking meanwhile waits on that one call;
//   - PostHog refuses (429) or fails: the last answer, with when it was read
//     (StaleNote) — an error only when there never was one. After a 429 nobody
//     here asks again until PostHog's Retry-After has passed (the limit is the
//     team's, not one query's);
//   - `force` (a Refresh button) skips the TTL, but not within 30 s of the last read.
import { createHash } from "node:crypto";
import type { StaleNote } from "./traffic-contract";

export type Rows = unknown[][];
export interface CachedRows { rows: Rows; at: number; stale: StaleNote | null }

/** How old an answer may be (owner, 2026-11-02). */
export const POSTHOG_TTL = {
  /** "Live now": the window, its list, the map and the day's converts — one query. */
  live: 60_000,
  /** Today: visitors today (the same query counts yesterday, the week and since the launch), a map span up to a day, a drill-down, the other admin pages. */
  today: 5 * 60_000,
  /** Weeks and months: the analyst, where sign-ups stop, the report's range, the A/B bench, a map span past a day. */
  history: 30 * 60_000,
} as const;
/** A Refresh button asks PostHog again — but one answer at most once in this long. */
export const FORCE_FLOOR_MS = 30_000;
const LIMIT_PAUSE_MS = 60_000;
const LIMIT_PAUSE_MIN_MS = 15_000;
const LIMIT_PAUSE_MAX_MS = 15 * 60_000;
/** Any other failure: that one answer is not asked again for this long (or its TTL, if shorter). */
const FAIL_PAUSE_MS = 30_000;
const MEMORY_MAX = 128;
const STORE_PREFIX = "phq:";
/** A bigger answer (a busy window's rows) stays in memory only. */
const STORE_MAX_CHARS = 1_500_000;
const STORE_KEEP_MS = 2 * 24 * 60 * 60_000;
const STORE_WAIT_MS = 1_500;

/** Where answers outlive the function: SyncState by default; the checks swap in their own. */
export interface PosthogAnswerStore {
  read(key: string): Promise<{ at: number; rows: Rows } | null>;
  write(key: string, entry: { at: number; rows: Rows }): Promise<void>;
}
type Entry = { at: number; rows: Rows };

const storeKey = (key: string) => STORE_PREFIX + (key.length > 160 ? createHash("sha1").update(key).digest("hex") : key);
const syncStateStore: PosthogAnswerStore = {
  async read(key) {
    const { db } = await import("./db");
    const row = await db.syncState.findUnique({ where: { key: storeKey(key) }, select: { cursor: true } });
    if (!row?.cursor) return null;
    const v = JSON.parse(row.cursor) as { at?: unknown; rows?: unknown };
    return typeof v.at === "number" && Array.isArray(v.rows) ? { at: v.at, rows: v.rows as Rows } : null;
  },
  async write(key, entry) {
    const cursor = JSON.stringify(entry);
    if (cursor.length > STORE_MAX_CHARS) return;
    const { db } = await import("./db");
    await db.syncState.upsert({ where: { key: storeKey(key) }, create: { key: storeKey(key), cursor }, update: { cursor } });
    // Answers for ranges nobody asks about any more: gone after two days, swept now and then.
    if (Date.now() - state.prunedAt > 6 * 60 * 60_000) {
      state.prunedAt = Date.now();
      await db.syncState.deleteMany({ where: { key: { startsWith: STORE_PREFIX }, updatedAt: { lt: new Date(Date.now() - STORE_KEEP_MS) } } });
    }
  },
};

// On globalThis so Next's dev reloads keep it, like lib/posthog's snapshot.
const g = globalThis as unknown as { __jfPosthogAnswers?: {
  memory: Map<string, Entry>; flying: Map<string, Promise<CachedRows>>; failed: Map<string, { until: number; error: unknown }>;
  limitedUntil: number; limitError: unknown; store: PosthogAnswerStore | null; prunedAt: number;
} };
const state = (g.__jfPosthogAnswers ??= { memory: new Map(), flying: new Map(), failed: new Map(), limitedUntil: 0, limitError: null, store: syncStateStore, prunedAt: 0 });

/** The one wording for why an answer is old. */
export const failureWords = (err: unknown) => err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long." : err instanceof Error ? err.message : "PostHog did not answer.";
const staleOf = (e: Entry, err: unknown): CachedRows => ({ rows: e.rows, at: e.at, stale: { since: new Date(e.at).toISOString(), reason: failureWords(err) } });
const isLimit = (err: unknown) => (err as { status?: unknown } | null)?.status === 429;
function pauseOf(err: unknown): number {
  const ms = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof ms === "number" && ms > 0 ? Math.min(LIMIT_PAUSE_MAX_MS, Math.max(LIMIT_PAUSE_MIN_MS, ms)) : LIMIT_PAUSE_MS;
}
function remember(key: string, e: Entry) {
  state.memory.delete(key);
  if (state.memory.size >= MEMORY_MAX) state.memory.delete(state.memory.keys().next().value!);
  state.memory.set(key, e);
}
/** The store never holds a poll up: a slow or failing database is the same as an empty one. */
async function within<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(), new Promise<T>((r) => { timer = setTimeout(() => r(fallback), STORE_WAIT_MS); })]);
  } catch { return fallback; } finally { clearTimeout(timer); }
}

/** PostHog's answer under `key`, at most `ttlMs` old — see the top of this file. */
export async function cachedRows(key: string, ttlMs: number, ask: () => Promise<Rows>, opts: { force?: boolean } = {}): Promise<CachedRows> {
  const k = `${process.env.POSTHOG_PROJECT_ID ?? ""}|${key}`;
  const maxAge = opts.force ? Math.min(ttlMs, FORCE_FLOOR_MS) : ttlMs;
  const hit = state.memory.get(k);
  if (hit && Date.now() - hit.at < maxAge) return { rows: hit.rows, at: hit.at, stale: null };
  const flying = state.flying.get(k);
  if (flying) return flying;
  const read = refresh(k, maxAge, ttlMs, ask);
  const done = () => { if (state.flying.get(k) === read) state.flying.delete(k); };
  read.then(done, done);
  state.flying.set(k, read);
  return read;
}

async function refresh(key: string, maxAge: number, ttlMs: number, ask: () => Promise<Rows>): Promise<CachedRows> {
  let last = state.memory.get(key) ?? null;
  // Another instance, a cron or the last deploy may have asked since.
  const store = state.store;
  const kept = store ? await within(() => store.read(key), null) : null;
  if (kept && (!last || kept.at > last.at)) { remember(key, kept); last = kept; }
  if (last && Date.now() - last.at < maxAge) return { rows: last.rows, at: last.at, stale: null };
  const now = Date.now();
  const failed = state.failed.get(key);
  const paused = state.limitedUntil > now ? state.limitError : failed && failed.until > now ? failed.error : null;
  if (paused) {
    if (last) return staleOf(last, paused);
    throw paused;
  }
  try {
    const rows = await ask();
    const entry = { at: Date.now(), rows };
    remember(key, entry);
    state.failed.delete(key);
    if (store) await within(() => store.write(key, entry), undefined);
    return { rows, at: entry.at, stale: null };
  } catch (err) {
    if (isLimit(err)) { state.limitedUntil = Date.now() + pauseOf(err); state.limitError = err; }
    else state.failed.set(key, { until: Date.now() + Math.min(ttlMs, FAIL_PAUSE_MS), error: err });
    if (last) return staleOf(last, err);
    throw err;
  }
}

/** For the checks: this instance's memory forgotten (a cold start), and the shared store swapped. */
export function resetPosthogAnswers(opts: { store?: PosthogAnswerStore | null } = {}) {
  state.memory.clear(); state.flying.clear(); state.failed.clear();
  state.limitedUntil = 0; state.limitError = null;
  if ("store" in opts) state.store = opts.store ?? null;
}
