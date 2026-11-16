// A CELL'S VALUE (2026-11-16, lib/import) — pure. Phones, emails, money, dates and statuses as the other programs
// write them, read the one way JobFlex keeps them.

import { zonedInstant } from "../booking";

/** A phone's last ten digits (a US number with or without its 1) — how two records are found to be one person. */
export function phoneKey(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  if (d.length === 10) return d;
  return d.length >= 7 ? d : null;
}

/** The phones in a cell: "(555) 201-3344, 555.201.9988" → two. An extension stays with its number. */
export function phonesIn(v: string): string[] {
  return v
    .split(/[;|\n]|,(?!\s*(?:ext|x)\b)|\s\/\s/i)
    .map((p) => p.replace(/^\s*(mobile|cell|home|work|main|phone|tel|m|h|w|c)\s*[:\-]\s*/i, "").trim())
    .filter((p) => (p.match(/\d/g)?.length ?? 0) >= 7);
}

/** The emails in a cell, lower case. */
export function emailsIn(v: string): string[] {
  return [...new Set((v.match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
}

/** A sum of money: "$1,234.50", "1234.5", "(250.00)" (owed back), "USD 99" — null when there is none. */
export function moneyOf(v: string | null | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d.\-()]/g, ""));
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || !/\d/.test(s)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date's parts as written — wall clock, no zone. */
export interface WallDate {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  /** A time of day was written. */
  timed: boolean;
  /** Written with its own zone (ISO "Z", "+02:00"): the parts are UTC. */
  zoned?: boolean;
}

/** The time after a date: "9:30 AM", "14:05", "9am". */
function timeOf(rest: string): { h: number; min: number } | null {
  const t = /(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(rest);
  if (!t || (!t[2] && !t[3])) return null;
  let h = Number(t[1]);
  const min = Number(t[2] ?? 0);
  const ap = (t[3] ?? "").toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h <= 23 && min <= 59 ? { h, min } : null;
}

const fullYear = (y: number) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);
const ok = (y: number, m: number, d: number) => y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/**
 * A date as the programs write it: 2025-11-03 (with a time, or ISO with a zone), 11/3/2025 and 11/03/25 (the US
 * order), Nov 3, 2025 · 3 Nov 2025 · November 3rd 2025, and an Excel serial day (45964).
 */
export function wallDateOf(v: string | null | undefined): WallDate | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(.*))?$/.exec(s))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!ok(y, mo, d)) return null;
    // An instant with its own zone ("Z", "+02:00"): kept as that instant's UTC wall clock.
    if (m[4] && /(z|[+-]\d{2}:?\d{2})$/i.test(m[4])) {
      const at = new Date(s);
      if (!Number.isNaN(at.getTime())) return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate(), h: at.getUTCHours(), min: at.getUTCMinutes(), timed: true, zoned: true };
    }
    const t = m[4] ? timeOf(m[4]) : null;
    return { y, m: mo, d, h: t?.h ?? 0, min: t?.min ?? 0, timed: !!t };
  }
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[,\s]+(.*))?$/.exec(s))) {
    const [mo, d, y] = [Number(m[1]), Number(m[2]), fullYear(Number(m[3]))];
    if (!ok(y, mo, d)) return null;
    const t = m[4] ? timeOf(m[4]) : null;
    return { y, m: mo, d, h: t?.h ?? 0, min: t?.min ?? 0, timed: !!t };
  }
  if ((m = /^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[,\s]+(?:at\s+)?(.*))?$/i.exec(s))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const [d, y] = [Number(m[2]), Number(m[3])];
    if (!mo || !ok(y, mo, d)) return null;
    const t = m[4] ? timeOf(m[4]) : null;
    return { y, m: mo, d, h: t?.h ?? 0, min: t?.min ?? 0, timed: !!t };
  }
  if ((m = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})(?:[,\s]+(.*))?$/i.exec(s))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const [d, y] = [Number(m[1]), Number(m[3])];
    if (!mo || !ok(y, mo, d)) return null;
    const t = m[4] ? timeOf(m[4]) : null;
    return { y, m: mo, d, h: t?.h ?? 0, min: t?.min ?? 0, timed: !!t };
  }
  // An Excel day number (days since 1899-12-30), with a fraction for the time.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 18000 && n <= 80000) {
      const at = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
      const timed = n % 1 !== 0;
      return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate(), h: timed ? at.getUTCHours() : 0, min: timed ? at.getUTCMinutes() : 0, timed };
    }
  }
  return null;
}

/** A written date as an instant on the company's clock (an untimed date: noon there, so no zone moves it a day). */
export function instantOf(w: WallDate, timeZone: string): Date {
  if (w.zoned) return new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.min));
  return zonedInstant(w.y, w.m, w.d, w.timed ? w.h : 12, w.timed ? w.min : 0, timeZone);
}

/** Where a job stands, from its status words (and its payment's): done, canceled or still open. */
export function workState(status: string | null | undefined): "done" | "canceled" | "open" | null {
  const s = (status ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/cancel|void|deleted|declined|lost|rejected|no.?show|abandon/.test(s)) return "canceled";
  if (/complete|done|finish|closed|paid|invoiced|archived|won|approved and done/.test(s)) return "done";
  if (/schedul|progress|en ?route|dispatch|open|active|upcoming|pending|booked|need|unassigned|hold|confirm|requires|new|on.?site|started|working/.test(s)) return "open";
  return null;
}

/** Whether it was paid, from a "paid or not" column: paid, unpaid, partly paid. */
export function payState(v: string | null | undefined): "paid" | "partial" | "unpaid" | null {
  const s = (v ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/partial|part paid|partly/.test(s)) return "partial";
  if (/unpaid|not paid|open|due|outstanding|overdue|pending|sent|awaiting|^no$|^false$|^n$/.test(s)) return "unpaid";
  if (/paid|settled|closed|^yes$|^true$|^y$/.test(s)) return "paid";
  return null;
}

/** An estimate's outcome: approved, declined or still open. */
export function estimateState(v: string | null | undefined): "approved" | "declined" | "open" | null {
  const s = (v ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/approv|accept|won|convert|signed|sold|booked|job created/.test(s)) return "approved";
  if (/declin|reject|lost|expired|archiv|cancel|void/.test(s)) return "declined";
  return "open";
}

/** A yes in a "do not contact" or "unsubscribed" column. */
export const truthy = (v: string | null | undefined) => /^(y|yes|true|1|x|✓|checked|opted out|unsubscribed|do not contact)$/i.test((v ?? "").trim());

/** "123 Main St, Springfield, IL 62704" → its parts (null when it does not read that way). */
export function splitAddress(v: string): { street: string; city: string | null; state: string | null; zip: string | null } | null {
  const s = v.replace(/\s+/g, " ").trim();
  const m = /^(.*?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)(?:,?\s*(?:usa|us|united states))?$/i.exec(s);
  if (m) return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] };
  const n = /^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})$/i.exec(s);
  if (n) return { street: n[1].trim(), city: n[2].trim(), state: n[3].toUpperCase(), zip: null };
  return null;
}

/** A name or a street read the same however it was typed: lower case, letters and digits. */
export const looseKey = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|apartment|apt|unit|suite|ste)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "");
