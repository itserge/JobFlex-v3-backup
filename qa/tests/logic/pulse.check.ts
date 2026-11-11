// THE COMPANY PULSE'S PURE RULES (Smart CRM part 7, 2026-11-10) — lib/pulse/shared on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/pulse.check.ts

import { buildPulse, clockStart, defaultPeriod, isPulsePeriod, lostAt, median, pulseLine, pulseWindow, startOfWeekTz, waitWords, weeklyReportDue, type PulseInput, type PulseLead, type PulseProposal } from "@/lib/pulse/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
// Wednesday 2026-11-11, 10:00 in Seattle (PST = UTC-8).
const now = new Date("2026-11-11T18:00:00Z");
const iso = (d: Date) => d.toISOString();

// ── the week is the company's week ──
check("the week starts Monday 00:00 company time", iso(startOfWeekTz(now, TZ)) === "2026-11-09T08:00:00.000Z", iso(startOfWeekTz(now, TZ)));
check("on a Monday morning the week started today", iso(startOfWeekTz(new Date("2026-11-09T16:00:00Z"), TZ)) === "2026-11-09T08:00:00.000Z");
check("late Sunday night still belongs to the old week", iso(startOfWeekTz(new Date("2026-11-09T07:30:00Z"), TZ)) === "2026-11-02T08:00:00.000Z");
// The clocks went back on Sunday 2026-11-01: the Monday before is at UTC-7.
check("a week with a clock change in it keeps its Monday", iso(startOfWeekTz(new Date("2026-11-01T20:00:00Z"), TZ)) === "2026-10-26T07:00:00.000Z", iso(startOfWeekTz(new Date("2026-11-01T20:00:00Z"), TZ)));

const week = pulseWindow("week", now, TZ);
check("this week runs Monday → now", iso(week.from) === "2026-11-09T08:00:00.000Z" && week.to.getTime() === now.getTime());
check("…against the same stretch of last week", iso(week.prevFrom) === "2026-11-02T08:00:00.000Z" && week.prevTo.getTime() - week.prevFrom.getTime() === now.getTime() - week.from.getTime());
check("…and says so", week.label === "This week so far" && week.prevLabel === "the same days last week" && week.range === "Nov 9 – Nov 11", week.range);
const last = pulseWindow("last-week", now, TZ);
check("last week is Monday → Monday", iso(last.from) === "2026-11-02T08:00:00.000Z" && iso(last.to) === "2026-11-09T08:00:00.000Z" && last.range === "Nov 2 – Nov 8", last.range);
check("…against the week before, across the clock change", iso(last.prevFrom) === "2026-10-26T07:00:00.000Z" && last.prevTo.getTime() === last.from.getTime(), iso(last.prevFrom));
const d30 = pulseWindow("30d", now, TZ);
check("30 days against the 30 before", d30.to.getTime() - d30.from.getTime() === 30 * DAY && d30.prevTo.getTime() === d30.from.getTime() && d30.from.getTime() - d30.prevFrom.getTime() === 30 * DAY);
check("the sheet opens on last week on a Monday, this week otherwise", defaultPeriod(new Date("2026-11-09T16:00:00Z"), TZ) === "last-week" && defaultPeriod(now, TZ) === "week");
check("a made-up period is refused", isPulsePeriod("90d") && !isPulsePeriod("year") && !isPulsePeriod(null));

// ── the Monday report's hour ──
check("Monday 7am company time: due", weeklyReportDue(new Date("2026-11-09T15:05:00Z"), TZ));
check("Monday 6am: not yet", !weeklyReportDue(new Date("2026-11-09T14:05:00Z"), TZ));
check("Monday noon: too late for this week", !weeklyReportDue(new Date("2026-11-09T20:05:00Z"), TZ));
check("Tuesday 8am: not a Monday", !weeklyReportDue(new Date("2026-11-10T16:05:00Z"), TZ));
check("Monday in UTC but still Sunday at the company: no", !weeklyReportDue(new Date("2026-11-09T07:30:00Z"), TZ));

// ── small arithmetic ──
check("the median of an even count is the middle two's average", median([10, 2, 4, 30]) === 7 && median([5]) === 5 && median([]) === null);
check("waits in words", waitWords(0.4) === "under a minute" && waitWords(12) === "12 min" && waitWords(200) === "3 h" && waitWords(3 * 1440) === "3 days");

// ── when the clock starts ──
const at = (h: number) => new Date(week.from.getTime() + h * HOUR);
check("our own lead: the moment it came in", clockStart({ source: "WEBSITE", status: "NEW", createdAt: at(1), claimedAt: null })?.getTime() === at(1).getTime());
check("a Lead Center lead: the moment we took it", clockStart({ source: "LEAD_CENTER", status: "CLAIMED", createdAt: at(1), claimedAt: at(5) })?.getTime() === at(5).getTime());
check("a Lead Center offer not taken is nobody's wait", clockStart({ source: "LEAD_CENTER", status: "ROUTED", createdAt: at(1), claimedAt: null }) === null);

// ── a made-up week ──
let n = 0;
const lead = (o: Partial<PulseLead> & { createdAt: Date }): PulseLead => ({ id: `l${++n}`, name: `Lead ${n}`, claimedAt: null, contactedAt: null, status: "NEW", source: "WEBSITE", ownerId: null, ...o });
const replied = (h: number, min: number, ownerId: string | null = "u1"): PulseLead => lead({ createdAt: at(h), contactedAt: new Date(at(h).getTime() + min * MIN), status: "CONTACTED", ownerId });
const prop = (o: Partial<PulseProposal>): PulseProposal => ({ id: `p${++n}`, ownerId: "u1", status: "SENT", total: 1000, sentAt: null, acceptedAt: null, declinedAt: null, canceledAt: null, validUntil: null, createdAt: at(-400), ...o });
const prevAt = (h: number) => new Date(week.prevFrom.getTime() + h * HOUR);

const leads: PulseLead[] = [
  replied(1, 3), // within 5 min
  replied(2, 5), // exactly 5 → still "within 5"
  replied(3, 40), // within the hour
  replied(4, 300, "u2"), // same day
  replied(5, 2000, "u2"), // later
  lead({ createdAt: at(6), name: "Dana Waiting", ownerId: "u2" }), // waiting
  lead({ createdAt: at(30), name: "Newer Waiting" }), // waiting, unassigned
  lead({ createdAt: at(7), status: "QUOTED", ownerId: "u1" }), // moved on with no time
  lead({ createdAt: at(8), source: "LEAD_CENTER", status: "ROUTED" }), // an offer nobody took: no clock
  lead({ createdAt: at(9), source: "LEAD_CENTER", status: "CONTACTED", claimedAt: at(20), contactedAt: new Date(at(20).getTime() + 10 * MIN), ownerId: "u1" }), // 10 min from the claim
  // last week's same stretch: two leads, replies of 100 and 200 min
  lead({ createdAt: prevAt(2), contactedAt: new Date(prevAt(2).getTime() + 100 * MIN), status: "WON" }),
  lead({ createdAt: prevAt(3), contactedAt: new Date(prevAt(3).getTime() + 200 * MIN), status: "LOST" }),
  // last week, but after the matching stretch: outside both windows
  lead({ createdAt: new Date(week.prevTo.getTime() + HOUR), contactedAt: new Date(week.prevTo.getTime() + 2 * HOUR) }),
];
const proposals: PulseProposal[] = [
  prop({ sentAt: at(2), total: 5000 }), // sent, open
  prop({ sentAt: at(3), status: "ACCEPTED", acceptedAt: at(10), total: 8000 }), // sent + won this week
  prop({ sentAt: prevAt(1), status: "PAID", acceptedAt: at(12), total: 2000 }), // sent last week, won this week
  prop({ sentAt: prevAt(1), status: "DECLINED", declinedAt: at(13) }), // lost this week
  prop({ ownerId: "u2", sentAt: at(4), status: "DECLINED", declinedAt: at(14) }),
  prop({ ownerId: "u2", sentAt: prevAt(4), status: "EXPIRED", validUntil: at(15) }),
  prop({ ownerId: "u2", sentAt: prevAt(5), status: "DECLINED", acceptedAt: prevAt(6), canceledAt: at(16) }), // signed, then cancelled this week
  prop({ ownerId: "u2", sentAt: prevAt(5), status: "ACCEPTED", acceptedAt: at(17), total: 3000 }),
  prop({ ownerId: null, sentAt: at(5), status: "VIEWED" }),
  prop({ ownerId: "gone", sentAt: prevAt(2), status: "ACCEPTED", acceptedAt: prevAt(20), total: 9000 }), // last week's win
  prop({ sentAt: prevAt(2), status: "DECLINED", declinedAt: prevAt(10) }), // last week's loss
  prop({ sentAt: prevAt(2), status: "ACCEPTED", acceptedAt: new Date(week.prevTo.getTime() + HOUR), total: 500 }), // after the matching stretch
];
const input: PulseInput = {
  window: week,
  now,
  leads,
  proposals,
  payments: [
    { amount: 1200.5, paidAt: at(3) },
    { amount: 800, paidAt: at(20) },
    { amount: 5000, paidAt: prevAt(4) },
    { amount: 999, paidAt: new Date(week.prevTo.getTime() + HOUR) },
  ],
  members: [
    { id: "u1", name: "Mike Ortiz", role: "SALES" },
    { id: "u2", name: "Sara Lund", role: "MANAGER" },
  ],
  sources: [
    { key: "GOOGLE", label: "Google", leads: 6, won: 2, wonValue: 10000, collected: 2000, medianReplyMin: 5, monthlySpend: 900, costPerJob: 105 },
    { key: "ANGI", label: "Angi", leads: 5, won: 0, wonValue: 0, collected: 0, medianReplyMin: 300, monthlySpend: 400, costPerJob: null },
    { key: "REFERRAL", label: "Referral", leads: 0, won: 0, wonValue: 0, collected: 0, medianReplyMin: null, monthlySpend: null, costPerJob: null },
  ],
};
const p = buildPulse(input);
const stat = (k: string) => p.stats.find((s) => s.key === k)!;
const bucket = (k: string) => p.speed.buckets.find((b) => b.key === k)!.count;

check("ten leads this week, two in last week's same stretch", p.speed.leads === 10 && stat("leads").value === "10" && stat("leads").delta?.words === "▲ from 2 the same days last week", stat("leads"));
check("the buckets: 3 within 5 min (5 exactly counts), 2 within the hour, 1 same day, 1 later", bucket("5m") === 2 && bucket("1h") === 2 && bucket("day") === 1 && bucket("later") === 1, p.speed.buckets);
check("two still waiting, oldest first, with whose they are", bucket("waiting") === 2 && p.speed.waiting[0].name === "Dana Waiting" && p.speed.waiting[0].owner === "Sara Lund" && p.speed.waiting[1].owner === null, p.speed.waiting);
check("one moved on with no reply time; the untaken offer is counted as a lead but has no clock", bucket("untimed") === 1 && p.speed.buckets.reduce((a, b) => a + b.count, 0) === 9);
// replies: 3, 5, 10, 40, 300, 2000 → median (10+40)/2 = 25
check("the median first reply is the true middle", p.speed.medianMin === 25 && stat("reply").value === "25 min", p.speed.medianMin);
check("…against last week's 150 min, and faster is good", p.speed.prevMedianMin === 150 && stat("reply").delta?.tone === "ok" && stat("reply").delta?.words === "▼ from 3 h the same days last week", stat("reply").delta);
check("the Lead Center lead's wait runs from the claim", p.speed.people.find((x) => x.userId === "u1")?.medianMin === 7.5, p.speed.people);
check("people first, the unassigned pile last", p.speed.people.at(-1)?.userId === null && p.speed.people.at(-1)?.name === "Not assigned" && p.speed.people.at(-1)?.waiting === 1, p.speed.people);
check("Sara: 3 leads, 2 replied, 1 waiting", JSON.stringify(p.speed.people.find((x) => x.userId === "u2")) === JSON.stringify({ userId: "u2", name: "Sara Lund", role: "MANAGER", leads: 3, replied: 2, medianMin: 1150, waiting: 1 }), p.speed.people);

check("sent this week: 4 (by the day it went, whoever's it is)", p.wins.total.sent === 4 && stat("sent").value === "4", p.wins.total);
check("won this week: 3, by the day it was signed — $13,000", p.wins.total.won === 3 && p.wins.total.wonValue === 13000, p.wins.total);
check("lost this week: 4 — declined, ran out, and a signed job cancelled", p.wins.total.lost === 4 && p.wins.total.rate === 43, p.wins.total);
check("a cancelled job is lost the day it was cancelled, not the day it was declined or made", lostAt(prop({ status: "DECLINED", canceledAt: at(1), declinedAt: at(-50), validUntil: at(-80) })).getTime() === at(1).getTime());
const mike = p.wins.rows.find((r) => r.userId === "u1")!;
const sara = p.wins.rows.find((r) => r.userId === "u2")!;
check("Mike: 2 sent, 2 won of 3 decided (67%), $10,000", mike.sent === 2 && mike.won === 2 && mike.lost === 1 && mike.rate === 67 && mike.wonValue === 10000, mike);
check("Sara: 1 sent, 1 won of 4 decided (25%)", sara.sent === 1 && sara.won === 1 && sara.lost === 3 && sara.rate === 25, sara);
check("the proposal with no salesperson sits last under its own name", p.wins.rows.at(-1)?.name === "No salesperson" && p.wins.rows.at(-1)?.rate === null);
check("the best seller by money leads the table", p.wins.rows[0].userId === "u1");
check("win rate against last week's 50%", stat("rate").value === "43%" && stat("rate").delta?.words === "▼ from 50% the same days last week" && stat("rate").delta?.tone === "warn", stat("rate"));
check("collected this week against last week's stretch", stat("collected").value === "$2,001" || stat("collected").value === "$2.0K" || stat("collected").value === "$2K", stat("collected"));
check("…and less than before reads as a warning", stat("collected").delta?.tone === "warn");

check("sources: only the ones that brought anything", p.sources.length === 2 && p.sources[0].key === "GOOGLE" && p.sourcesMore === 0);
const keys = p.notes.map((x) => x.key);
check("the first thing worth a look is who is still waiting", keys[0] === "waiting" && p.notes[0].text.startsWith("2 leads from this week so far have no reply yet — Dana Waiting came in "), p.notes[0]);
check("faster replies are said, with both times", p.notes.find((x) => x.key === "faster")?.text === "First replies got faster: 25 min now, 3 h the same days last week.", p.notes);
check("two replies are too few to call a person slow", !keys.includes("slow-person"), keys);
check("four notes at most", p.notes.length === 4, keys);
check("not a quiet week", !p.quiet);
check("the line", pulseLine(p).startsWith("This week so far: 10 new leads (first reply 25 min, 2 still waiting), 4 proposals sent, 3 won ($13,000), win rate 43%, "), pulseLine(p));

// ── the notes that did not fit above ──
const calm = buildPulse({ ...input, leads: [...leads.filter((l) => l.contactedAt), replied(40, 900, "u2")], proposals: proposals.filter((x) => !(x.ownerId === "u2" && x.status === "ACCEPTED")) });
check("three slow replies: said against the company's middle", calm.notes.find((x) => x.key === "slow-person")?.text === "Sara Lund's leads wait 15 h for a first reply; the company's middle is 40 min.", calm.notes);
check("the salesperson 20 points below the company is said", calm.notes.find((x) => x.key === "behind")?.text === "Sara Lund won 0 of 3 decided (0%); the company won 33%.", calm.notes);
check("18 points below is not", !p.notes.some((x) => x.key === "behind") && !buildPulse({ ...input, leads: [] }).notes.some((x) => x.key === "behind"));
const src = buildPulse({ ...input, leads: [], proposals: [] });
check("the best source and the paid one that won nothing", src.notes.map((x) => x.key).join() === "best-source,dry-source" && src.notes[0].text === "Google brought the most paid work: 2 jobs won ($10,000) from 6 leads." && src.notes[1].text === "Angi: 5 leads and nothing won yet, at $400 a month.", src.notes);
const slow = buildPulse({ ...input, leads: [replied(1, 200), replied(2, 300), replied(3, 400)], proposals: [] });
check("a slow middle is said plainly", slow.notes.some((x) => x.key === "slow" && x.text === "Half of the leads waited longer than 5 h for a first reply."), slow.notes);

// ── a quiet week ──
const quiet = buildPulse({ ...input, leads: [], proposals: [], payments: [], sources: [] });
check("nothing happened: quiet, no notes, dashes not zeros for the rates", quiet.quiet && quiet.notes.length === 0 && quiet.stats.find((s) => s.key === "reply")?.value === "—" && quiet.stats.find((s) => s.key === "rate")?.value === "—");
check("…and the line says so", pulseLine(quiet) === "This week so far: no new leads, proposals or payments.");
check("no comparison is drawn from nothing", quiet.stats.every((s) => s.delta === null), quiet.stats);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
