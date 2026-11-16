// "DO IT FOR ME" — THE RULES (2026-11-16, CRM migration plan part 4) — pure, no I/O.
//
// The owner's answers: free for everyone (the trial too), answered within 2 business days, worked by the platform
// admins. A contractor sends the files their old program exported — any of them, an old Excel or a Numbers file too:
// a person opens them — with a note; the files wait in the private store under the company's own folder until the
// request is done or cancelled, then they are deleted.

import { zonedInstant, zonedParts } from "@/lib/booking";
import type { PlanCounts } from "./plan";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/** What an import brings in, line by line — the import page, Admin → Imports and the "your clients are in" email. */
export function countLines(c: PlanCounts): string[] {
  return [
    c.newClients ? plural(c.newClients, "new client") : null,
    c.joined ? `${plural(c.joined, "client")} joined to ${c.joined === 1 ? "one" : "ones"} already here` : null,
    c.invoices ? `${plural(c.invoices, "open invoice")} · ${money(c.owed)} owed` : null,
    c.upcoming ? `${plural(c.upcoming, "upcoming job")} on the calendar` : null,
    c.unscheduled ? `${plural(c.unscheduled, "job")} not scheduled yet` : null,
    c.history ? `${plural(c.history, "past job, invoice or estimate", "past jobs, invoices and estimates")} in the clients' history${c.paid ? ` · ${money(c.paid)} paid` : ""}` : null,
  ].filter((x): x is string => !!x);
}

/** RUNNING = a platform admin pressed "Bring them in" and it is being written (one at a time; back to WORKING if it fails). */
export const REQUEST_STATUSES = ["NEW", "WORKING", "RUNNING", "DONE", "CANCELED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const isRequestStatus = (v: unknown): v is RequestStatus => typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);

/** The team's clock: the 2 business days are counted on it. */
export const TEAM_ZONE = "America/Los_Angeles";
/** What the contractor is promised, in words. */
export const PROMISE = "within 2 business days";

/** The most files one request carries, and the most one file weighs (a ten-year jobs workbook fits). */
export const MAX_REQUEST_FILES = 12;
export const MAX_REQUEST_FILE_BYTES = 50 * 1024 * 1024;
export const NOTE_MAX = 1000;
export const REASON_MAX = 400;

/** The files a person can open, by their ending; the type the store keeps is the one named here, whatever the browser
 *  said (a CSV comes from Windows as "application/vnd.ms-excel", a Numbers file with no type at all). */
const TYPES: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  numbers: "application/vnd.apple.numbers",
  zip: "application/zip",
  pdf: "application/pdf",
};
export const REQUEST_FILE_TYPES: readonly string[] = [...new Set(Object.values(TYPES))];
export const REQUEST_FILE_ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(",");

/** The type a request file is kept as, from its name; null = not a file we take. */
export function requestFileType(name: string | null | undefined): string | null {
  const ext = ((name ?? "").split(".").pop() ?? "").toLowerCase();
  return TYPES[ext] ?? null;
}

/** A file's name cleaned for the store and the page: no path, no odd marks; 100 characters. */
export function safeFileName(name: string | null | undefined): string {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    .trim()
    .replace(/[^A-Za-z0-9 ._()-]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(-100);
  return base || "export.csv";
}

/** The company's folder in the store: a request only ever names files under it. */
export const requestFolder = (organizationId: string) => `imports/${organizationId}/`;

/** Where one file lands: imports/<org>/<stamp>-<name>. */
export const requestPathname = (organizationId: string, name: string, now = Date.now()) => `${requestFolder(organizationId)}${now.toString(36)}-${safeFileName(name)}`;

export interface RequestFile {
  url: string;
  name: string;
  bytes: number;
  contentType: string;
  /** "company" = sent by the contractor; "admin" = a file the team added (an old Excel saved again as CSV). */
  addedBy: "company" | "admin";
}

export function parseFiles(json: string | null | undefined): RequestFile[] {
  try {
    const v = JSON.parse(json ?? "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((f): f is RequestFile => !!f && typeof f === "object" && typeof (f as RequestFile).url === "string" && typeof (f as RequestFile).name === "string")
      .map((f) => ({ url: f.url, name: f.name, bytes: Number(f.bytes) || 0, contentType: f.contentType || requestFileType(f.name) || "application/octet-stream", addedBy: f.addedBy === "admin" ? "admin" : "company" }));
  } catch {
    return [];
  }
}

/**
 * When the answer is due: the end of the second business day after the day it was asked, on the team's clock.
 * Asked Monday (any hour) → due Wednesday night; Friday → Tuesday; Saturday or Sunday → Tuesday. Weekends only — a
 * holiday is a person's call.
 */
export function dueBy(asked: Date, timeZone = TEAM_ZONE): Date {
  const p = zonedParts(asked, timeZone);
  // Walk the calendar days after the asking day (noon UTC, so no clock change moves a date).
  let day = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  let counted = 0;
  while (counted < 2) {
    day = new Date(day.getTime() + 86_400_000);
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) counted++;
  }
  return zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 23, 59, timeZone);
}

/** Past its day and still not answered. */
export const isLate = (status: string, dueAt: Date, now = new Date()) => isOpen(status) && now.getTime() > dueAt.getTime();

/** Still waiting on the team. */
export const isOpen = (status: string) => status === "NEW" || status === "WORKING" || status === "RUNNING";

/** "Wed, Nov 18" — the due day as the contractor and the team read it. */
export function dueWords(dueAt: Date, timeZone = TEAM_ZONE): string {
  return dueAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}

/** What a status reads as, for the contractor. */
export function statusWords(status: string): string {
  switch (status) {
    case "NEW":
      return "Waiting for our team";
    case "WORKING":
    case "RUNNING":
      return "Our team is on it";
    case "DONE":
      return "Done — your clients are in";
    case "CANCELED":
      return "Cancelled";
    default:
      return status;
  }
}

/** The checks a request passes before it is kept: files named, in the company's folder, not too many, a note not too long. */
export function checkRequest(input: { files: Array<{ url: string; name: string; bytes: number }>; note?: string | null }, inFolder: (url: string) => boolean): { ok: true } | { ok: false; error: string } {
  if (!input.files.length) return { ok: false, error: "Add the files your old program exported." };
  if (input.files.length > MAX_REQUEST_FILES) return { ok: false, error: `Up to ${MAX_REQUEST_FILES} files in one request.` };
  for (const f of input.files) {
    if (!requestFileType(f.name)) return { ok: false, error: `${f.name}: send the CSV, Excel or Numbers file your program exported (a PDF or a zip is fine too).` };
    if (!(f.bytes > 0)) return { ok: false, error: `${f.name} is empty.` };
    if (f.bytes > MAX_REQUEST_FILE_BYTES) return { ok: false, error: `${f.name} is over ${MAX_REQUEST_FILE_BYTES / 1024 / 1024} MB.` };
    if (!inFolder(f.url)) return { ok: false, error: `${f.name} didn't upload — try again.` };
  }
  if ((input.note ?? "").length > NOTE_MAX) return { ok: false, error: `Keep the note under ${NOTE_MAX} characters.` };
  return { ok: true };
}
