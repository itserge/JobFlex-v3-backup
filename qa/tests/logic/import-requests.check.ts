// "DO IT FOR ME" + "SWITCH TO JOBFLEX" (2026-11-16, CRM migration plan parts 3–4; lib/import/requests, sources) —
// the owner: free for everyone, answered within 2 business days, worked by the platform admins; public pages per
// program. The pure rules, proved here: the due day (weekends skipped, on the team's clock), which files are taken,
// a file's safe name and folder, a request's checks, the words, and the programs' public pages.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/import-requests.check.ts
import {
  checkRequest,
  countLines,
  dueBy,
  dueWords,
  isLate,
  isOpen,
  MAX_REQUEST_FILE_BYTES,
  MAX_REQUEST_FILES,
  parseFiles,
  requestFileType,
  requestFolder,
  requestPathname,
  safeFileName,
  statusWords,
} from "@/lib/import/requests";
import { IMPORT_SOURCES, sourceBySlug, SWITCH_SOURCES } from "@/lib/import/sources";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
const iso = (d: Date) => d.toISOString();

/* ── 1. When it is due ─────────────────────────────────────────────────── */
{
  const mon = dueBy(new Date("2026-11-16T18:00:00Z")); // Mon 10:00 in Los Angeles
  check("asked Monday → due Wednesday night (Los Angeles)", iso(mon) === "2026-11-19T07:59:00.000Z" && dueWords(mon) === "Wed, Nov 18", [iso(mon), dueWords(mon)]);
  const fri = dueBy(new Date("2026-11-21T00:30:00Z")); // Fri 16:30 in Los Angeles (Saturday already in UTC)
  check("asked Friday afternoon → due Tuesday (the weekend skipped, the team's clock not UTC)", iso(fri) === "2026-11-25T07:59:00.000Z", iso(fri));
  const sat = dueBy(new Date("2026-11-21T20:00:00Z"));
  const sun = dueBy(new Date("2026-11-23T05:00:00Z")); // Sun 21:00 in Los Angeles, Monday in UTC
  check("asked Saturday, or late Sunday evening → due Tuesday", iso(sat) === "2026-11-25T07:59:00.000Z" && iso(sun) === "2026-11-25T07:59:00.000Z", [iso(sat), iso(sun)]);
  const dst = dueBy(new Date("2027-03-12T20:00:00Z")); // Fri; the clocks go forward on Sun Mar 14
  check("across the spring clock change: due Tuesday 23:59 Pacific daylight time", iso(dst) === "2027-03-17T06:59:00.000Z", iso(dst));
  const due = new Date("2026-11-19T07:59:00Z");
  check("late = still open and past the day; done or cancelled is never late", isLate("NEW", due, new Date("2026-11-19T08:00:00Z")) && isLate("RUNNING", due, new Date("2026-11-20T00:00:00Z")) && !isLate("WORKING", due, new Date("2026-11-19T07:00:00Z")) && !isLate("DONE", due, new Date("2027-01-01T00:00:00Z")) && !isLate("CANCELED", due, new Date("2027-01-01T00:00:00Z")));
  check("open = new, being worked, or being brought in", isOpen("NEW") && isOpen("WORKING") && isOpen("RUNNING") && !isOpen("DONE") && !isOpen("CANCELED"));
  check("the words the contractor reads", statusWords("NEW") === "Waiting for our team" && statusWords("RUNNING") === "Our team is on it" && statusWords("DONE") === "Done — your clients are in");
}

/* ── 2. Files ──────────────────────────────────────────────────────────── */
{
  check("the files a person can open are taken, by their ending, whatever the browser said", requestFileType("Customers.CSV") === "text/csv" && requestFileType("jobs.xlsx") === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && requestFileType("old.xls") === "application/vnd.ms-excel" && requestFileType("book.numbers") === "application/vnd.apple.numbers" && requestFileType("qb.zip") === "application/zip" && requestFileType("list.pdf") === "application/pdf");
  check("anything else is not", requestFileType("setup.exe") === null && requestFileType("photo.jpg") === null && requestFileType("noending") === null && requestFileType("") === null);
  check("a file's name: no path, no odd marks, never empty", safeFileName("../../etc/passwd") === "passwd" && safeFileName("C:\\Users\\me\\My Customers (2).csv") === "My Customers (2).csv" && safeFileName("a<b>|c.csv") === "a-b-c.csv" && safeFileName("") === "export.csv");
  check("each company's files in its own folder", requestFolder("org1") === "imports/org1/" && requestPathname("org1", "a b.csv", 0) === "imports/org1/0-a b.csv");
  const inFolder = (u: string) => u.startsWith("local:imports/org1/");
  const f = (name: string, bytes = 1000, url = `local:imports/org1/x-${name}`) => ({ url, name, bytes });
  check("a request needs a file", !checkRequest({ files: [] }, inFolder).ok);
  check(`no more than ${MAX_REQUEST_FILES} files`, !checkRequest({ files: Array.from({ length: MAX_REQUEST_FILES + 1 }, (_, i) => f(`f${i}.csv`)) }, inFolder).ok);
  const r1 = checkRequest({ files: [f("run.exe")] }, inFolder);
  check("a file that is not an export is refused, in words", !r1.ok && /CSV, Excel or Numbers/.test(r1.ok ? "" : r1.error), r1);
  check("an empty file, a file over the limit, a file outside the company's folder: refused", !checkRequest({ files: [f("a.csv", 0)] }, inFolder).ok && !checkRequest({ files: [f("a.csv", MAX_REQUEST_FILE_BYTES + 1)] }, inFolder).ok && !checkRequest({ files: [f("a.csv", 10, "local:imports/org2/x-a.csv")] }, inFolder).ok);
  check("a note over the limit is refused; a good request passes", !checkRequest({ files: [f("a.csv")], note: "x".repeat(1001) }, inFolder).ok && checkRequest({ files: [f("Customers.csv"), f("Jobs.xlsx"), f("old.xls")], note: "only active" }, inFolder).ok);
  const parsed = parseFiles(JSON.stringify([{ url: "u1", name: "a.csv", bytes: "12" }, { url: "u2", name: "b.numbers", bytes: 5, addedBy: "admin" }, { nope: 1 }]));
  check("the stored files read back: types from the name, who added each, junk dropped", parsed.length === 2 && parsed[0].contentType === "text/csv" && parsed[0].bytes === 12 && parsed[0].addedBy === "company" && parsed[1].addedBy === "admin" && parseFiles("not json").length === 0, parsed);
}

/* ── 3. What came in, in words (the page, Admin → Imports, the email) ───── */
{
  const lines = countLines({ newClients: 412, joined: 3, upcoming: 9, unscheduled: 1, invoices: 18, owed: 9240.5, history: 1, paid: 300, skipped: 2, again: 0 });
  check("the counts as sentences", JSON.stringify(lines) === JSON.stringify(["412 new clients", "3 clients joined to ones already here", "18 open invoices · $9,240.50 owed", "9 upcoming jobs on the calendar", "1 job not scheduled yet", "1 past job, invoice or estimate in the clients' history · $300 paid"]), lines);
}

/* ── 4. The programs' public pages ─────────────────────────────────────── */
{
  const slugs = SWITCH_SOURCES.map((s) => s.slug);
  check("a public page per program, contacts excepted: seven, each its own address", slugs.length === 7 && new Set(slugs).size === 7 && !slugs.includes(null) && !IMPORT_SOURCES.find((s) => s.id === "CONTACTS")?.slug, slugs);
  check("an address names its program; an unknown one names none", sourceBySlug("housecall-pro")?.id === "HOUSECALL_PRO" && sourceBySlug("spreadsheet")?.id === "OTHER" && sourceBySlug("contacts") === null && sourceBySlug("nope") === null);
  check("every program's page has its steps and the files to bring", SWITCH_SOURCES.every((s) => s.steps.length >= 2 && s.files.length > 5));
  check("every named program's steps were checked against its own help center (and say so)", SWITCH_SOURCES.filter((s) => s.id !== "OTHER").every((s) => s.checked !== null && s.docs.length > 0));
  const wz = sourceBySlug("workiz")!;
  check("Workiz: no client-list export in its help center — the steps say so and point to “Do it for me”", wz.checked === "no-client-export" && /no export of the client list/i.test(wz.steps[0]) && wz.steps.some((x) => /Do it for me/.test(x)));
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
