// THE JOBFLEX ASSISTANT · the pure core (2026-11-04): the short replies answered
// without the model, the life of a proposed change, the undo window, dates on
// the company's clock (DST too), money words, who may ask for what, and the
// prompt's hard rules. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant.check.ts
import "../_lib/_server-only";
import {
  andList,
  canMove,
  confirmPrompt,
  dayOf,
  dayRange,
  money,
  quickReply,
  spanWords,
  stillAwaiting,
  timeOf,
  undoWindowMs,
  wallInstant,
  APPROVAL_TTL_MS,
  type ActionStatus,
} from "../../../src/lib/assistant/shared";
import { ownProposalsOnly, roleAllows, type Capability } from "../../../src/lib/assistant/roles";
import { searchWords } from "../../../src/lib/assistant/find";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── short replies ───────────────────────────────────────────────────────────
{
  const kind = (s: string) => quickReply(s)?.kind ?? null;
  for (const s of ["yes", "YES", "Yes.", "y", "ok", "OK thanks", "yes please", "do it", "send it", "go ahead", "Sí", "да"]) check(`quick: "${s}" is a yes`, kind(s) === "yes", kind(s));
  for (const s of ["no", "No!", "nope", "cancel", "never mind", "нет"]) check(`quick: "${s}" is a no`, kind(s) === "no", kind(s));
  check("quick: UNDO", kind("undo") === "undo" && kind("wait") === "undo");
  check("quick: STOP and HELP", kind("STOP") === "stop" && kind("help") === "help" && kind("?") === "help");
  const d = quickReply("2");
  check("quick: a single digit is a choice", d?.kind === "digit" && d.n === 2, d);
  check("quick: '#3' is a choice", quickReply("#3")?.kind === "digit");
  for (const s of ["no, make it Friday", "yes but Friday", "send the Smith proposal", "is it sent?", "12", "ok so what's on tomorrow", ""]) {
    check(`quick: "${s}" goes to the model`, quickReply(s) === null, quickReply(s));
  }
}

// ── the life of a proposed change ───────────────────────────────────────────
{
  const ok: Array<[ActionStatus, ActionStatus]> = [["AWAITING", "QUEUED"], ["AWAITING", "CANCELED"], ["AWAITING", "EXPIRED"], ["QUEUED", "RUNNING"], ["QUEUED", "CANCELED"], ["RUNNING", "DONE"], ["RUNNING", "FAILED"]];
  for (const [a, b] of ok) check(`status: ${a} → ${b}`, canMove(a, b));
  const no: Array<[ActionStatus, ActionStatus]> = [["AWAITING", "RUNNING"], ["AWAITING", "DONE"], ["QUEUED", "DONE"], ["RUNNING", "QUEUED"], ["RUNNING", "CANCELED"], ["DONE", "RUNNING"], ["FAILED", "QUEUED"], ["CANCELED", "QUEUED"], ["EXPIRED", "QUEUED"]];
  for (const [a, b] of no) check(`status: never ${a} → ${b}`, !canMove(a, b));
  const t0 = Date.parse("2026-11-04T18:00:00Z");
  check("awaiting: fresh read-back is open", stillAwaiting({ status: "AWAITING", createdAt: new Date(t0) }, t0 + 60_000));
  check("awaiting: expires after the TTL", !stillAwaiting({ status: "AWAITING", createdAt: new Date(t0) }, t0 + APPROVAL_TTL_MS + 1));
  check("awaiting: only AWAITING counts", !stillAwaiting({ status: "QUEUED", createdAt: new Date(t0) }, t0));
  check("undo: the app runs at once (the person tapped Do it on the read-back)", undoWindowMs("app") === 0);
  check("undo: a YES by text or voice waits two minutes", undoWindowMs("sms") === 120_000 && undoWindowMs("voice") === 120_000);
  check("confirm words by channel", /Do it/.test(confirmPrompt("app")) && /YES/.test(confirmPrompt("sms")));
}

// ── dates on the company's clock ────────────────────────────────────────────
{
  const LA = "America/Los_Angeles";
  const r = dayRange("2026-11-06", LA);
  check("day: Nov 6 in LA starts 08:00 UTC (PST)", r?.from.toISOString() === "2026-11-06T08:00:00.000Z", r?.from.toISOString());
  check("day: and ends 24 h later", r ? r.to.getTime() - r.from.getTime() === 86_400_000 : false);
  const dst = dayRange("2026-11-01", LA); // the fall-back day: 25 hours
  check("day: the DST fall-back day is 25 hours", dst ? dst.to.getTime() - dst.from.getTime() === 25 * 3_600_000 : false, dst);
  const nine = wallInstant("2026-11-06", "09:00", LA);
  check("wall: 9:00 AM Thursday in LA = 17:00 UTC — not 09:00 UTC (the server's clock)", nine?.toISOString() === "2026-11-06T17:00:00.000Z", nine?.toISOString());
  const ny = wallInstant("2026-07-15", "14:30", "America/New_York");
  check("wall: summer in New York (EDT)", ny?.toISOString() === "2026-07-15T18:30:00.000Z", ny?.toISOString());
  check("wall: bad input is refused", wallInstant("2026-13-01", "09:00", LA) === null || wallInstant("Thursday", "09:00", LA) === null);
  check("wall: bad time refused", wallInstant("2026-11-06", "25:00", LA) === null && wallInstant("2026-11-06", "9am", LA) === null);
  const late = new Date("2026-11-07T06:30:00Z"); // Nov 6, 10:30 PM in LA
  check("dayOf: late evening in LA is still the 6th", dayOf(late, LA) === "2026-11-06" && timeOf(late, LA) === "22:30", [dayOf(late, LA), timeOf(late, LA)]);
  const span = spanWords(nine!, wallInstant("2026-11-06", "14:00", LA)!, LA);
  check("span words: one day", span === "Fri, Nov 6, 9:00 AM–2:00 PM", span);
}

// ── money and lists ─────────────────────────────────────────────────────────
{
  check("money: whole dollars", money(16164) === "$16,164", money(16164));
  check("money: cents kept", money(2500.5) === "$2,500.50", money(2500.5));
  check("money: bad currency falls back", money(10, "??") === "$10");
  check("list: one", andList(["Mike"]) === "Mike");
  check("list: two", andList(["Mike", "Ana"]) === "Mike and Ana");
  check("list: three", andList(["Mike", "Ana", "Joe"]) === "Mike, Ana and Joe");
  check("search words drop the filler", JSON.stringify(searchWords("the Smith roof proposal from yesterday")) === JSON.stringify(["Smith", "roof"]), searchWords("the Smith roof proposal from yesterday"));
}

// ── who may ask for what ────────────────────────────────────────────────────
{
  const all: Capability[] = ["today", "proposals.read", "proposals.send", "schedule.read", "schedule.write", "crew.read", "crew.text", "money.read", "payments.remind"];
  for (const role of ["OWNER", "ADMIN", "MANAGER"]) check(`roles: ${role} may do everything`, all.every((c) => roleAllows(role, c)), all.filter((c) => !roleAllows(role, c)));
  check("roles: a field worker is refused everything (the crew portal is theirs)", all.every((c) => !roleAllows("INSTALLER", c)));
  check("roles: SALES sends proposals", roleAllows("SALES", "proposals.send"));
  check("roles: SALES never schedules, texts the crew, reads money or sends reminders", !roleAllows("SALES", "schedule.write") && !roleAllows("SALES", "crew.text") && !roleAllows("SALES", "money.read") && !roleAllows("SALES", "payments.remind"));
  check("roles: ESTIMATOR sends proposals but never schedules or texts the crew", roleAllows("ESTIMATOR", "proposals.send") && !roleAllows("ESTIMATOR", "schedule.write") && !roleAllows("ESTIMATOR", "crew.text"));
  check("roles: SALES and ESTIMATOR see only their own proposals", ownProposalsOnly("SALES") && ownProposalsOnly("ESTIMATOR") && !ownProposalsOnly("OWNER") && !ownProposalsOnly("MANAGER"));
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
