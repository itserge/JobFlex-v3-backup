// WHERE SIGN-UPS STOP (owner, 2026-10-14: "at which point they're leaving the site … whether the problem is on our
// side … a smart approach to track where they stop and what's wrong").
//
// Pure: one HogQL query reads every sign-up VISIT of the last week or month as one row (a visit = one PostHog
// session that opened /auth/register), and this turns those rows into the report under the live map — how far each
// screen gets them, which box they stop in, what the form refused or what failed on our side, how long each step
// takes, which phones and browsers finish, and one verdict line: of the people who stopped, how many met a fault of
// ours, how many were refused by the form, and how many simply chose to go.
//
// The same reasons and sides as the live line (lib/signup-watch-shared). A visit whose person finished in another
// visit is "finished later", not a stop. Box-by-box detail exists only for visits since the watcher went live
// (2026-10-14); the screens and the finish rate read every visit.
//
// The alert rule is here too: the last hour's problems by reason, and which of them is worth an email.
import { TRAFFIC_EVENTS as E } from "./traffic-contract";
import { BROWSER_TYPE_SQL, HOST_SQL, IN_APP_SQL, UA_SQL, visitorRuleSql, type VisitorScope } from "./traffic-visitor";
import { BROWSER_NOISE_PATTERN, SIGNUP_REASONS, durationWords, problemOf, reasonWords, screenName, type SignupSide } from "./signup-watch-shared";

export const DROPOFF_DAYS = [7, 30] as const;
export type DropoffDays = (typeof DROPOFF_DAYS)[number];
/** A visit with no leave and an event this recent may still be typing: not a stop yet. */
export const STILL_ON_FORM_MS = 30 * 60_000;
/** The screens, in the order the form goes through them. */
export const DROPOFF_SCREENS = ["account", "code", "company", "plan"] as const;
export type DropoffScreen = (typeof DROPOFF_SCREENS)[number];

const WATCH = [E.signupField, E.signupProblem, E.signupAway, E.signupBack, E.signupLeave] as const;

// ── the query ──────────────────────────────────────────────────────────────

const prop = (name: string) => `ifNull(toString(properties.${name}), '')`;
const PATH = `ifNull(nullIf(${prop("$pathname")}, ''), path(${prop("$current_url")}))`;
/** One visit: the browser's session, else (an event sent before the library loaded) its visitor id. */
const VISIT_KEY = `if(${prop("$session_id")} != '', ${prop("$session_id")}, concat('d:', toString(distinct_id)))`;
const RULE = (scope: VisitorScope) => visitorRuleSql({ host: HOST_SQL, ua: UA_SQL, browserType: BROWSER_TYPE_SQL, event: "event" }, scope);
const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** Every sign-up visit of the last `days`, one row each, newest first. Columns are read by dropoffVisitFromRow. */
export function buildDropoffQuery(days: number, scope: VisitorScope = "production"): string {
  const d = Math.max(1, Math.min(30, Math.round(days)));
  const at = (cond: string) => `minIf(toUnixTimestamp(timestamp), ${cond})`;
  const stepAt = (tag: string) => at(`event = '${E.step}' AND ${prop("step")} = '${tag}'`);
  const watched = `event IN (${list(WATCH)})`;
  return `SELECT ${VISIT_KEY} AS visit, any(toString(distinct_id)),
    toUnixTimestamp(min(timestamp)) * 1000 AS started, toUnixTimestamp(max(timestamp)) * 1000,
    anyIf(${prop("$device_type")}, ${prop("$device_type")} != ''), anyIf(${prop("$browser")}, ${prop("$browser")} != ''), anyIf(${prop("$os")}, ${prop("$os")} != ''),
    max(${IN_APP_SQL}), anyIf(${prop("flow")}, event = '${E.step}' AND ${prop("flow")} != ''),
    ${stepAt("1")}, ${stepAt("code")}, ${stepAt("2")}, ${stepAt("3")},
    ${at(`event = '${E.completed}' AND ${prop("verified")} IN ('true', '1', '')`)},
    countIf(event = '${E.opened}'),
    arraySlice(groupArrayIf(concat(${prop("field")}, '|', ${prop("ms")}, '|', ${prop("filled")}, '|', ${prop("valid")}, '|', ${prop("screen")}, '|', toString(toUnixTimestamp(timestamp))), event = '${E.signupField}' AND ${prop("phase")} = 'out'), 1, 80),
    arraySlice(groupArrayIf(concat(${prop("reason")}, '|', ${prop("side")}, '|', ${prop("screen")}, '|', ${prop("field")}, '|', toString(toUnixTimestamp(timestamp)), '|', ${prop("message")}), event = '${E.signupProblem}'), 1, 40),
    argMaxIf(concat(${prop("kind")}, '|', ${prop("screen")}, '|', ${prop("field")}, '|', ${prop("last_problem")}), timestamp, event = '${E.signupLeave}'),
    argMaxIf(concat(${prop("screen")}, '|', ${prop("field")}), timestamp, event = '${E.signupAway}'),
    countIf(${watched}), countIf(event = '${E.signupAway}'),
    countIf(event = '$pageview'),
    argMaxIf(${prop("screen")}, timestamp, ${watched} AND ${prop("screen")} != '')
    FROM events
    WHERE timestamp > now() - INTERVAL ${d} DAY AND timestamp <= now()
      AND event IN (${list(["$pageview", E.step, E.completed, E.opened, ...WATCH])})
      AND startsWith(${PATH}, '/auth/register')
      AND ${RULE(scope)}
    GROUP BY visit ORDER BY started DESC LIMIT 5000`;
}

/** The last hour's problems on the form, one row per reason: who met it (visits), how often, a sample of its words. */
export function buildAlertQuery(minutes = 60, scope: VisitorScope = "production"): string {
  const m = Math.max(5, Math.min(240, Math.round(minutes)));
  // The browser's own failures (problemOf) are one reason of their own here too, never a page_error of ours.
  const reason = `if(${prop("reason")} IN ('browser_error', 'outside_script') OR match(lower(${prop("message")}), '${BROWSER_NOISE_PATTERN.replace(/\\/g, "\\\\")}'), 'browser_error', ${prop("reason")})`;
  return `SELECT ${reason} AS reason, if(reason = 'browser_error', 'outside', any(${prop("side")})), uniq(${VISIT_KEY}), count(),
    anyIf(${prop("message")}, ${prop("message")} != ''), any(${prop("screen")})
    FROM events
    WHERE timestamp > now() - INTERVAL ${m} MINUTE AND timestamp <= now() AND event = '${E.signupProblem}' AND ${RULE(scope)}
    GROUP BY reason ORDER BY count() DESC LIMIT 50`;
}

// ── the rows ───────────────────────────────────────────────────────────────

export interface DropoffBox { field: string; ms: number; filled: boolean; valid: boolean; screen: string; at: number }
export interface DropoffProblem { reason: string; side: SignupSide; screen: string; field: string; at: number; message: string }
export interface DropoffVisit {
  id: string;
  person: string;
  startedAt: number;
  endedAt: number;
  device: string;
  browser: string;
  os: string;
  inApp: boolean;
  flow: string;
  /** When each screen was first shown (ms), null when it was not. */
  reached: Record<DropoffScreen, number | null>;
  /** When the verified sign-up landed (ms), null when it did not. */
  finishedAt: number | null;
  checkoutOpened: boolean;
  boxes: DropoffBox[];
  problems: DropoffProblem[];
  leave: { kind: string; screen: string; field: string; lastProblem: string } | null;
  away: { screen: string; field: string } | null;
  /** Events from the form's watcher: the visit's box-by-box detail exists. */
  watched: boolean;
  awayCount: number;
  /** The watcher's last screen for the visit. */
  lastScreen: string;
}

const text = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const secMs = (v: unknown) => { const n = num(v); return n > 0 ? n * 1000 : null; };
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(text);
  if (typeof v === "string" && v.startsWith("[")) { try { const p = JSON.parse(v) as unknown; return Array.isArray(p) ? p.map(text) : []; } catch { return []; } }
  return [];
};
const yes = (v: string) => v === "true" || v === "1";

export function dropoffVisitFromRow(row: unknown[]): DropoffVisit | null {
  if (!Array.isArray(row) || row.length < 23) return null;
  const id = text(row[0]);
  if (!id) return null;
  const boxes = arr(row[15]).map((s): DropoffBox | null => {
    const [field, ms, filled, valid, screen, at] = s.split("|");
    return field ? { field, ms: Math.max(0, num(ms)), filled: yes(filled), valid: valid !== "false", screen: screen || "", at: num(at) * 1000 } : null;
  }).filter((b): b is DropoffBox => !!b);
  const problems = arr(row[16]).map((s): DropoffProblem | null => {
    const parts = s.split("|");
    if (!parts[0]) return null;
    const message = parts.slice(5).join("|");
    const { reason, side } = problemOf(parts[0], parts[1], message);
    return { reason, side, screen: parts[2] || "", field: parts[3] || "", at: num(parts[4]) * 1000, message };
  }).filter((p): p is DropoffProblem => !!p);
  const leaveRaw = text(row[17]);
  const [kind, lScreen, lField, lProblem] = leaveRaw.split("|");
  const finishedAt = secMs(row[13]);
  const checkoutOpened = num(row[14]) > 0;
  // "done" is the account made only with the server's completed event (2026-10-28): after the checkout opened it was
  // the hand-off to Stripe's card page (events before the fix); from any other screen, a close on that screen.
  const leaveKind = kind !== "done" ? kind : lScreen && lScreen !== "done" ? "closed" : finishedAt != null ? "done" : checkoutOpened ? "checkout" : "done";
  const leaveScreen = leaveKind === "checkout" && lScreen === "done" ? "checkout" : lScreen || "";
  const awayRaw = text(row[18]);
  const [aScreen, aField] = awayRaw.split("|");
  return {
    id,
    person: text(row[1]),
    startedAt: num(row[2]),
    endedAt: num(row[3]),
    device: text(row[4]),
    browser: text(row[5]),
    os: text(row[6]),
    inApp: num(row[7]) > 0 || text(row[7]) === "true",
    flow: text(row[8]),
    reached: { account: secMs(row[9]), code: secMs(row[10]), company: secMs(row[11]), plan: secMs(row[12]) },
    finishedAt,
    checkoutOpened,
    boxes,
    problems,
    leave: leaveRaw && kind ? { kind: leaveKind, screen: leaveScreen, field: lField || "", lastProblem: lProblem || "" } : null,
    away: awayRaw && (aScreen || aField) ? { screen: aScreen || "", field: aField || "" } : null,
    watched: num(row[19]) > 0,
    awayCount: num(row[20]),
    lastScreen: text(row[22]),
  };
}

// ── the report ─────────────────────────────────────────────────────────────

export type DropoffTone = "bad" | "warn" | "good" | "info";

export interface DropoffScreenRow {
  key: DropoffScreen;
  label: string;
  /** Visits that saw this screen. */
  reached: number;
  /** Of the visits that stopped, the ones that stopped here. */
  stoppedHere: number;
  /** Median seconds from this screen to the next one, among those that went on; null with fewer than two. */
  medianSecs: number | null;
}
export interface DropoffBoxRow {
  field: string;
  screen: string;
  /** Visits that spent time in the box. */
  visits: number;
  medianSecs: number | null;
  leftEmpty: number;
  invalid: number;
  /** Stopped visits whose last box was this one. */
  lastBox: number;
}
export interface DropoffProblemRow {
  reason: string;
  words: string;
  side: SignupSide;
  /** Visits that met it. */
  visits: number;
  times: number;
  /** Of those visits, the ones that still finished (then or later). */
  finishedAnyway: number;
  screen: string;
  message: string;
}
export interface DropoffDeviceRow { label: string; visits: number; finished: number; rate: number }
export interface DropoffStopPlace { place: string; screen: string; field: string; visits: number }
export interface DropoffReport {
  days: number;
  visits: number;
  /** Visits with the watcher's box-by-box events. */
  watched: number;
  finished: number;
  finishedLater: number;
  stillOnForm: number;
  stopped: number;
  /** Stopped visits after going to Google or the checkout on purpose. */
  wentToGoogle: number;
  wentToCheckout: number;
  screens: DropoffScreenRow[];
  boxes: DropoffBoxRow[];
  problems: DropoffProblemRow[];
  devices: DropoffDeviceRow[];
  stopPlaces: DropoffStopPlace[];
  verdict: { tone: DropoffTone; headline: string; detail: string; ours: number; theirs: number; choice: number; counted: number };
}

/** The middle value; null below `least` samples (two for a step's time, one for a box's). */
const median = (xs: number[], least = 2): number | null => {
  if (xs.length < least || !xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pctWords = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Ours first, then the form's refusals, the browser's own failures last. */
const SIDE_ORDER: Record<SignupSide, number> = { ours: 0, theirs: 1, outside: 2 };

/** The furthest screen a visit saw (by the order of the form). */
export function furthestScreen(v: DropoffVisit): DropoffScreen {
  let out: DropoffScreen = "account";
  for (const s of DROPOFF_SCREENS) if (v.reached[s] != null) out = s;
  const watcher = v.leave?.screen || v.lastScreen;
  if (watcher && DROPOFF_SCREENS.indexOf(watcher as DropoffScreen) > DROPOFF_SCREENS.indexOf(out)) out = watcher as DropoffScreen;
  return out;
}

/** Whether a visit saw a screen: its own step event, the watcher there, or a later screen — the email-code screen only
 *  on the email-code flow. Finishing alone says nothing (a two-step sign-up never shows the plan screen). */
export function sawScreen(v: DropoffVisit, key: DropoffScreen): boolean {
  if (key === "account" || v.reached[key] != null || v.leave?.screen === key || v.lastScreen === key) return true;
  if (key === "code" && v.flow !== "otp") return false;
  return DROPOFF_SCREENS.indexOf(furthestScreen(v)) > DROPOFF_SCREENS.indexOf(key);
}

/** Where a visit that stopped stopped: the screen and the box, from the leave first, then the tab going away, then
 *  the last box they were in on that screen. */
export function stopPlaceOf(v: DropoffVisit): { screen: DropoffScreen; field: string } {
  const screen = (DROPOFF_SCREENS as readonly string[]).includes(v.leave?.screen ?? "") ? (v.leave!.screen as DropoffScreen) : furthestScreen(v);
  const lastBox = [...v.boxes].filter((b) => !b.screen || b.screen === screen).sort((a, b) => a.at - b.at).pop();
  const field = v.leave?.field || (v.away?.screen === screen ? v.away.field : "") || lastBox?.field || "";
  return { screen, field };
}

/** A device the way the admin says it: "iPhone · Facebook app", "Desktop · Chrome". */
export function deviceLabel(v: Pick<DropoffVisit, "device" | "browser" | "os" | "inApp">): string {
  const kind = v.device === "Mobile" ? (/ios/i.test(v.os) ? "iPhone" : /android/i.test(v.os) ? "Android" : "Phone") : v.device === "Tablet" ? "Tablet" : v.device || "Unknown";
  const browser = v.inApp ? "Facebook / Instagram app" : v.browser.replace(/^Mobile /, "") || "Unknown browser";
  return `${kind} · ${browser}`;
}

export function buildDropoffReport(visits: DropoffVisit[], days: number, now: number): DropoffReport {
  // Who finished, and when — a person who stopped once and finished in a later visit is not a stop.
  const finishedBy = new Map<string, number>();
  for (const v of visits) if (v.finishedAt != null && v.person) finishedBy.set(v.person, Math.max(finishedBy.get(v.person) ?? 0, v.finishedAt));
  const finished = visits.filter((v) => v.finishedAt != null);
  const later = visits.filter((v) => v.finishedAt == null && v.person && (finishedBy.get(v.person) ?? 0) > v.startedAt);
  const laterIds = new Set(later.map((v) => v.id));
  const still = visits.filter((v) => v.finishedAt == null && !laterIds.has(v.id) && !v.leave && now - v.endedAt < STILL_ON_FORM_MS);
  const stillIds = new Set(still.map((v) => v.id));
  const stopped = visits.filter((v) => v.finishedAt == null && !laterIds.has(v.id) && !stillIds.has(v.id));
  const done = (v: DropoffVisit) => v.finishedAt != null || laterIds.has(v.id);

  // ── the screens ──
  const otpSeen = visits.some((v) => v.reached.code != null || v.flow === "otp");
  const screenKeys = DROPOFF_SCREENS.filter((s) => s !== "code" || otpSeen);
  const stopAt = new Map(stopped.map((v) => [v.id, stopPlaceOf(v)]));
  const screens: DropoffScreenRow[] = screenKeys.map((key) => {
    const idx = DROPOFF_SCREENS.indexOf(key);
    const reached = visits.filter((v) => sawScreen(v, key)).length;
    const stoppedHere = stopped.filter((v) => stopAt.get(v.id)?.screen === key).length;
    // From this screen to whatever came next for that visit (the next screen it saw, else the finish).
    const secs: number[] = [];
    for (const v of visits) {
      const from = v.reached[key];
      if (from == null) continue;
      const next = DROPOFF_SCREENS.slice(idx + 1).map((s) => v.reached[s]).find((t): t is number => t != null && t >= from) ?? (v.finishedAt != null && v.finishedAt >= from ? v.finishedAt : null);
      if (next != null) secs.push((next - from) / 1000);
    }
    return { key, label: screenName(key), reached, stoppedHere, medianSecs: median(secs) };
  });

  // ── the boxes (watched visits only) ──
  const watched = visits.filter((v) => v.watched);
  const boxMap = new Map<string, { field: string; screen: string; perVisit: number[]; leftEmpty: number; invalid: number; lastBox: number }>();
  for (const v of watched) {
    const byField = new Map<string, DropoffBox[]>();
    for (const b of v.boxes) byField.set(b.field, [...(byField.get(b.field) ?? []), b]);
    for (const [field, bs] of byField) {
      const row = boxMap.get(field) ?? { field, screen: bs[0].screen, perVisit: [], leftEmpty: 0, invalid: 0, lastBox: 0 };
      row.perVisit.push(bs.reduce((a, b) => a + b.ms, 0) / 1000);
      const last = [...bs].sort((a, b) => a.at - b.at).pop()!;
      if (!last.filled) row.leftEmpty += 1;
      if (last.filled && !last.valid) row.invalid += 1;
      boxMap.set(field, row);
    }
  }
  for (const v of stopped) {
    const f = stopAt.get(v.id)?.field;
    if (!f) continue;
    const row = boxMap.get(f) ?? { field: f, screen: stopAt.get(v.id)!.screen, perVisit: [], leftEmpty: 0, invalid: 0, lastBox: 0 };
    row.lastBox += 1;
    boxMap.set(f, row);
  }
  const boxes: DropoffBoxRow[] = [...boxMap.values()]
    .map((r) => ({ field: r.field, screen: r.screen, visits: r.perVisit.length, medianSecs: median(r.perVisit, 1), leftEmpty: r.leftEmpty, invalid: r.invalid, lastBox: r.lastBox }))
    .sort((a, b) => b.lastBox - a.lastBox || b.visits - a.visits);

  // ── the problems ──
  const probMap = new Map<string, { side: SignupSide; visits: Set<string>; times: number; finished: Set<string>; screens: Map<string, number>; messages: Map<string, number> }>();
  for (const v of visits) {
    for (const p of v.problems) {
      const row = probMap.get(p.reason) ?? { side: p.side, visits: new Set<string>(), times: 0, finished: new Set<string>(), screens: new Map<string, number>(), messages: new Map<string, number>() };
      row.visits.add(v.id);
      row.times += 1;
      if (done(v)) row.finished.add(v.id);
      if (p.screen) row.screens.set(p.screen, (row.screens.get(p.screen) ?? 0) + 1);
      if (p.message) row.messages.set(p.message, (row.messages.get(p.message) ?? 0) + 1);
      probMap.set(p.reason, row);
    }
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const problems: DropoffProblemRow[] = [...probMap.entries()]
    .map(([reason, r]) => ({ reason, words: reasonWords(reason), side: r.side, visits: r.visits.size, times: r.times, finishedAnyway: r.finished.size, screen: top(r.screens), message: top(r.messages) }))
    .sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || b.visits - a.visits || b.times - a.times);

  // ── devices ──
  const devMap = new Map<string, { visits: number; finished: number }>();
  for (const v of visits) {
    if (stillIds.has(v.id)) continue;
    const label = deviceLabel(v);
    const row = devMap.get(label) ?? { visits: 0, finished: 0 };
    row.visits += 1;
    if (done(v)) row.finished += 1;
    devMap.set(label, row);
  }
  const devices = [...devMap.entries()].map(([label, r]) => ({ label, visits: r.visits, finished: r.finished, rate: r.visits ? r.finished / r.visits : 0 })).sort((a, b) => b.visits - a.visits).slice(0, 8);

  // ── where they stopped ──
  const placeMap = new Map<string, DropoffStopPlace>();
  for (const v of stopped) {
    const at = stopAt.get(v.id)!;
    const gone = v.leave?.kind === "google" ? " — went to Google" : v.leave?.kind === "checkout" ? " — went to Stripe's card page" : "";
    const place = `${screenName(at.screen)}${at.field ? ` · ${at.field}` : ""}${gone}`;
    const row = placeMap.get(place) ?? { place, screen: at.screen, field: at.field, visits: 0 };
    row.visits += 1;
    placeMap.set(place, row);
  }
  const stopPlaces = [...placeMap.values()].sort((a, b) => b.visits - a.visits).slice(0, 8);

  // ── the verdict: of the watched visits that stopped, what came first ──
  const counted = stopped.filter((v) => v.watched);
  const ours = counted.filter((v) => v.problems.some((p) => p.side === "ours"));
  // The browser's own failures are shown, never the verdict: a visit that met only those left by its choice.
  const theirs = counted.filter((v) => !ours.includes(v) && v.problems.some((p) => p.side === "theirs"));
  const choice = counted.length - ours.length - theirs.length;
  const topReason = (vs: DropoffVisit[], side: SignupSide) => {
    const m = new Map<string, number>();
    for (const v of vs) for (const r of new Set(v.problems.filter((p) => p.side === side).map((p) => p.reason))) m.set(r, (m.get(r) ?? 0) + 1);
    const r = top(m);
    return r ? `“${reasonWords(r)}”` : "";
  };
  const topPlace = stopPlaces.find((p) => counted.some((v) => { const at = stopAt.get(v.id)!; return at.screen === p.screen && at.field === p.field; }))?.place ?? "";
  let verdict: DropoffReport["verdict"];
  if (counted.length < 5) {
    verdict = { tone: "info", headline: counted.length ? `Too early to call — ${plural(counted.length, "watched visit")} stopped so far` : "No watched visit has stopped yet", detail: "The form is watched box by box from Oct 14; the verdict appears at five stopped visits.", ours: ours.length, theirs: theirs.length, choice, counted: counted.length };
  } else if (ours.length / counted.length >= 0.25) {
    verdict = { tone: "bad", headline: `It's us: ${ours.length} of ${counted.length} who stopped met a fault on our side first`, detail: `Mostly ${topReason(ours, "ours") || "our side"}. Fix that before touching the wording.`, ours: ours.length, theirs: theirs.length, choice, counted: counted.length };
  } else if (theirs.length >= choice) {
    verdict = { tone: "warn", headline: `The form turns them away: ${theirs.length} of ${counted.length} were refused before they left`, detail: `Mostly ${topReason(theirs, "theirs") || "a refusal"} — make that box clearer or more forgiving.${ours.length ? ` ${plural(ours.length, "visit")} also met a fault of ours.` : ""}`, ours: ours.length, theirs: theirs.length, choice, counted: counted.length };
  } else {
    verdict = { tone: ours.length ? "warn" : "info", headline: `Mostly a choice: ${choice} of ${counted.length} left without any error`, detail: `${topPlace ? `Most at ${topPlace}. ` : ""}Nothing broke for them — look at what that screen asks for.${ours.length ? ` Still, ${plural(ours.length, "visit")} met a fault of ours.` : ""}`, ours: ours.length, theirs: theirs.length, choice, counted: counted.length };
  }

  return {
    days,
    visits: visits.length,
    watched: watched.length,
    finished: finished.length,
    finishedLater: later.length,
    stillOnForm: still.length,
    stopped: stopped.length,
    wentToGoogle: stopped.filter((v) => v.leave?.kind === "google").length,
    wentToCheckout: stopped.filter((v) => v.leave?.kind === "checkout").length,
    screens,
    boxes,
    problems,
    devices,
    stopPlaces,
    verdict,
  };
}

/** "3 visits", "1 visit". */
export const visitsWords = (n: number) => plural(n, "visit");
/** "42 s" or "—". */
export const secsWords = (s: number | null) => (s == null ? "—" : durationWords(s * 1000));
export { pctWords };

// ── the alerts ─────────────────────────────────────────────────────────────

export interface SignupProblemGroup { reason: string; side: SignupSide; visits: number; times: number; message: string; screen: string }
export interface SignupAlert extends SignupProblemGroup { words: string }

/** Faults of ours that are never noise: two visitors in an hour is already a pattern. */
export const HARD_FAULTS: ReadonlySet<string> = new Set(["server_error", "check_failed", "start_failed", "email_send_failed", "pending_failed", "checkout_rejected", "checkout_unavailable", "trial_rejected", "trial_unavailable", "google_failed", "page_crash", "offer_changed"]);
export const ALERT_VISITS = 3;
export const ALERT_HARD_VISITS = 2;
/** The same reason is emailed at most this often. */
export const ALERT_REPEAT_MS = 6 * 3_600_000;

export function problemGroupFromRow(row: unknown[]): SignupProblemGroup | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const reason = text(row[0]);
  if (!reason) return null;
  const side = text(row[1]);
  const message = text(row[4]);
  return { ...problemOf(reason, side, message), visits: num(row[2]), times: num(row[3]), message, screen: text(row[5]) };
}

/** The last hour's reasons worth a person's attention: three visitors on one reason, or two on a hard fault of ours. */
export function signupAlertsOf(groups: SignupProblemGroup[]): SignupAlert[] {
  return groups
    // An outside script's failure is noted on the page, never an alarm: there is nothing of ours to fix.
    .filter((g) => g.side !== "outside" && (g.visits >= ALERT_VISITS || (g.side === "ours" && HARD_FAULTS.has(g.reason) && g.visits >= ALERT_HARD_VISITS)))
    .map((g) => ({ ...g, words: reasonWords(g.reason) }))
    .sort((a, b) => (a.side === b.side ? 0 : a.side === "ours" ? -1 : 1) || b.visits - a.visits);
}

/** Which alerts to email now: those not emailed for their reason in the last ALERT_REPEAT_MS. */
export function alertsToSend(alerts: SignupAlert[], sent: Record<string, number>, now: number): SignupAlert[] {
  return alerts.filter((a) => now - (sent[a.reason] ?? 0) >= ALERT_REPEAT_MS);
}

/** One line for an alert: "3 visitors hit "Wrong code" on the Email code screen in the last hour — 5 times". */
export function alertLine(a: Pick<SignupAlert, "words" | "visits" | "times" | "screen" | "side">, minutes = 60): string {
  const where = a.screen ? ` on the ${screenName(a.screen)} screen` : "";
  const span = minutes === 60 ? "the last hour" : `the last ${minutes} min`;
  return `${plural(a.visits, "visitor")} hit "${a.words}"${where} in ${span}${a.times > a.visits ? ` — ${a.times} times` : ""}${a.side === "ours" ? " · our side" : ""}`;
}

/** Every reason the alert rule knows, for the checks. */
export const KNOWN_REASONS = Object.keys(SIGNUP_REASONS);
