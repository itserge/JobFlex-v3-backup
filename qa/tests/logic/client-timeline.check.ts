// THE CLIENT TIMELINE'S PURE RULES (Smart CRM part 1, 2026-11-08) — lib/clientTimeline/shared and the brief's
// staleness rule, on made-up rows. No database, no network.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/client-timeline.check.ts

import { clip, digits10, mergeTimeline, sameEmail, samePhone, TIMELINE_FILTERS, type TimelineEvent } from "@/lib/clientTimeline/shared";
import { briefCurrent } from "@/lib/clientTimeline/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── phones and emails meet across spellings ──
check("digits10 keeps the last ten", digits10("+1 (425) 772-0164") === "4257720164");
check("samePhone: +1 form meets the bare form", samePhone("+14257720164", "(425) 772-0164"));
check("samePhone: a 7-digit tail still meets", samePhone("772-0164", "+1 425 772 0164"));
check("samePhone: six digits never match", !samePhone("20164", "4257720164"));
check("samePhone: different numbers don't", !samePhone("4257720164", "4257720165"));
check("sameEmail ignores case and space", sameEmail(" Olga@Gmail.com ", "olga@gmail.com"));
check("sameEmail: empty never matches", !sameEmail("", "") && !sameEmail(null, null));

// ── clip ──
check("clip shortens with an ellipsis", clip("a".repeat(200), 20).length === 20 && clip("a".repeat(200), 20).endsWith("…"));
check("clip flattens whitespace", clip("  two\n lines ") === "two lines");

// ── the merge: order, dedupe, cap ──
const at = (ms: number) => new Date(1_700_000_000_000 + ms);
const ev = (id: string, ms: number): TimelineEvent => ({ id, at: at(ms), kind: "TEXT", stamp: "Text", tone: "ink", title: id });
const merged = mergeTimeline([
  [ev("a", 1000), ev("b", 3000)],
  [ev("c", 2000), ev("a", 1000)],
]);
check("mergeTimeline: newest first", merged.map((e) => e.id).join(",") === "b,c,a", merged.map((e) => e.id));
check("mergeTimeline: one line per id", merged.length === 3);
check("mergeTimeline: the cap holds", mergeTimeline([Array.from({ length: 400 }, (_, i) => ev(`e${i}`, i))], 250).length === 250);
const badDate: TimelineEvent = { ...ev("x", 0), at: new Date(NaN) };
check("mergeTimeline: an unreadable date is dropped", mergeTimeline([[badDate, ev("y", 1)]]).length === 1);

// ── the filters cover every kind they name ──
const all = TIMELINE_FILTERS.find((f) => f.key === "all");
check("filters: All passes everything", !!all && all.kinds === null);
const msg = TIMELINE_FILTERS.find((f) => f.key === "messages");
check("filters: Messages = email, text, call", !!msg && msg.kinds?.join(",") === "EMAIL,TEXT,CALL");

// ── the brief's staleness ──
const NOW = at(10 * 60_000);
const fresh = { builtAt: at(9 * 60_000) };
const old = { builtAt: at(0) };
check("brief: none yet = rebuild", !briefCurrent(null, [], NOW));
check("brief: younger than the floor never rebuilds", briefCurrent(fresh, [ev("new", 9.5 * 60_000)], NOW));
check("brief: older, with newer events = rebuild", !briefCurrent(old, [ev("new", 60_000)], NOW));
check("brief: older, nothing newer = keep", briefCurrent(old, [ev("old", -60_000)], NOW));
check("brief: older, empty timeline = keep", briefCurrent(old, [], NOW));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
