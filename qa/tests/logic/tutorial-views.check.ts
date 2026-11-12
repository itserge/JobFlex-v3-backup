// WHO WATCHED THE TUTORIALS — the counting (2026-11-11), on made-up records. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/tutorial-views.check.ts

import { applyViewEvent, PLAY_GAP_MS, tutorialStats, watchedPct, type TutorialView } from "@/lib/tutorials/viewStats";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const t0 = new Date(Date.UTC(2026, 10, 11, 15));
const at = (ms: number) => new Date(t0.getTime() + ms);
const base = { userId: "u1", organizationId: "o1", slug: "crm", duration: 555 };

// ── one person's record ──
let v = applyViewEvent(null, { ...base, event: "play", sec: 0, now: t0 });
check("the first play counts", v.plays === 1 && v.maxSec === 0 && !v.done && v.firstAt === t0.toISOString());
v = applyViewEvent(v, { ...base, event: "progress", sec: 61.4, now: at(30_000) });
check("progress moves the furthest point, not the plays", v.plays === 1 && v.maxSec === 61);
v = applyViewEvent(v, { ...base, event: "play", sec: 61, now: at(40_000) });
check("a second play within a minute is the same play", v.plays === 1);
v = applyViewEvent(v, { ...base, event: "progress", sec: 20, now: at(50_000) });
check("going back doesn't lower the furthest point", v.maxSec === 61);
v = applyViewEvent(v, { ...base, event: "play", sec: 0, now: at(PLAY_GAP_MS + 60_000) });
check("opened again later: a new play", v.plays === 2);
v = applyViewEvent(v, { ...base, event: "done", sec: 555, now: at(10 * 60_000) });
check("the end reached: finished, furthest = the whole film", v.done && v.maxSec === 555 && !!v.doneAt);
const doneAt = v.doneAt;
v = applyViewEvent(v, { ...base, event: "done", sec: 555, now: at(20 * 60_000) });
check("finished again keeps the first finish time", v.doneAt === doneAt);
const near = applyViewEvent(null, { ...base, event: "progress", sec: 554, now: t0 });
check("reaching the last seconds counts as finished", near.done);
const wild = applyViewEvent(null, { ...base, event: "progress", sec: 99999, now: t0 });
check("a nonsense second is held to the film", wild.maxSec <= 560);
const nan = applyViewEvent(null, { ...base, event: "progress", sec: Number.NaN, now: t0 });
check("no second at all reads as 0", nan.maxSec === 0);

// ── the counts ──
const films = [
  { slug: "crm", title: "The CRM", duration: 555 },
  { slug: "deck-studio", title: "Deck Studio", duration: 506 },
  { slug: "remodel", title: "Remodel", duration: 282 },
];
const rec = (o: Partial<TutorialView>): TutorialView => ({ userId: "u", organizationId: "o", slug: "crm", plays: 1, maxSec: 0, done: false, firstAt: t0.toISOString(), lastAt: t0.toISOString(), ...o });
const views = [
  rec({ userId: "a", organizationId: "A", slug: "crm", plays: 3, maxSec: 555, done: true }),
  rec({ userId: "b", organizationId: "A", slug: "crm", plays: 1, maxSec: 111 }),
  rec({ userId: "b", organizationId: "A", slug: "deck-studio", plays: 2, maxSec: 253 }),
  rec({ userId: "c", organizationId: "B", slug: "deck-studio", plays: 0, maxSec: 0 }),
  rec({ userId: "d", organizationId: "C", slug: "gone-film", plays: 5 }),
];
const st = tutorialStats(views, films);
check("plays add up (no-play and unknown films left out)", st.plays === 6, st);
check("people and companies are counted once", st.people === 2 && st.companies === 1);
check("finished", st.finished === 1);
const crm = st.films.find((f) => f.slug === "crm")!;
check("a film's line: plays, people, finished, how far the middle viewer got", crm.plays === 4 && crm.people === 2 && crm.finished === 1 && crm.avgPct === Math.round((100 + 20) / 2), crm);
check("a film nobody watched still has its line", st.films.find((f) => f.slug === "remodel")?.plays === 0 && st.films.length === 3);
check("percent", watchedPct(253, 506) === 50 && watchedPct(999, 506) === 100 && watchedPct(5, 0) === 0);
check("nothing watched: zeros", tutorialStats([], films).plays === 0 && tutorialStats([], films).people === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
