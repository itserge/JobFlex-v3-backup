// Mobile phone (mobile-phone-v2) — row shape + pure helpers.
//
// The ten-call Seattle fixture that used to live here ((425) 555-0142, lead
// L-6041, the (425) 555-0100 shop line, the app.jobflex.com webhook) is gone:
// the build now takes the org's real AiPhoneCall rows, the server-counted
// stats, the Twilio state and the real webhook URL as props from
// app/dashboard/phone/load-phone, the same loader the desktop sheet reads. The
// row type is the desktop's, re-exported so the two editions cannot drift;
// what this module still owns is the derived direction vocabulary, the
// filters, the keypad and the formatters.

import type { Call, CallScriptLine, PhoneStats } from "@/components/v3/phone-blueprint/phone-data";

export type { Call, CallScriptLine, PhoneStats };

/* ============================================================
   DERIVED VOCABULARY
   ============================================================ */

/**
 * Direction is the STATUS on this surface, so it is one derived value rather
 * than two independent fields. Four states, three status tones plus blueprint:
 * inbound = success, outbound = blueprint, missed = danger, live = warning.
 * Missed being danger is the point — a missed call is lost work.
 */
export type Kind = "in" | "out" | "missed" | "live";

export function kindOf(c: Call): Kind {
  if (c.status === "IN_PROGRESS") return "live";
  if (c.status === "FAILED") return "missed";
  return c.dir === "OUTBOUND" ? "out" : "in";
}

export const KIND_LABEL: Record<Kind, string> = {
  in: "Inbound",
  out: "Outbound",
  missed: "Missed",
  live: "Live",
};

/** Donor: `fmtDur`. A call still ringing has no duration — it reads as a dash. */
export function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The feed's date dividers, parsed back out of the server's `relative()` label
 * ("25m ago", "2h ago", "1d ago", "3w ago", "2mo ago") — the same string the
 * desktop prints in its When column. Minutes and hours are today; anything the
 * pattern does not recognise files under "Earlier" rather than under today.
 */
export function dayGroup(when: string): string {
  const w = when.trim().toLowerCase();
  if (w === "just now" || w === "now" || w === "today") return "Today";
  const m = /^(\d+)\s*(m|h|d|w|mo|y)\b/.exec(w);
  if (!m) return "Earlier";
  const n = Number(m[1]);
  const u = m[2];
  if (u === "m" || u === "h") return "Today";
  if (u === "d") return n === 1 ? "Yesterday" : `${n} days ago`;
  if (u === "w") return n === 1 ? "Last week" : `${n} weeks ago`;
  if (u === "mo") return n === 1 ? "Last month" : `${n} months ago`;
  return "Earlier";
}

/* ---- filter -------------------------------------------------------------
   The desktop's four chips (All / Inbound / Outbound / Became leads) plus
   Missed, which is the one thing a contractor opens this page to find. A chip
   rail does not survive 320px, so all five live in one dropdown. */
export const ALL = "ALL";
export const INBOUND = "INBOUND";
export const OUTBOUND = "OUTBOUND";
export const MISSED = "MISSED";
export const LEADS = "LEADS";

export const FILTERS: Array<{ k: string; l: string }> = [
  { k: ALL, l: "All calls" },
  { k: INBOUND, l: "Inbound" },
  { k: OUTBOUND, l: "Outbound" },
  { k: MISSED, l: "Missed" },
  { k: LEADS, l: "Leads" },
];

export function matchesFilter(c: Call, f: string): boolean {
  if (f === LEADS) return Boolean(c.lead);
  if (f === MISSED) return kindOf(c) === "missed";
  if (f === INBOUND) return c.dir === "INBOUND";
  if (f === OUTBOUND) return c.dir === "OUTBOUND";
  return true;
}

/** Numbers, the written summary, the lead id AND what was actually said. */
export function matchesQuery(c: Call, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  // Digits match digits: "5095550173" finds "(509) 555-0173".
  const qd = q.replace(/\D/g, "");
  return (
    (c.name ?? "").toLowerCase().includes(q) ||
    (qd.length >= 3 && (c.from.replace(/\D/g, "").includes(qd) || c.to.replace(/\D/g, "").includes(qd))) ||
    c.from.toLowerCase().includes(q) ||
    c.to.toLowerCase().includes(q) ||
    (c.summary ?? "").toLowerCase().includes(q) ||
    (c.lead ?? "").toLowerCase().includes(q) ||
    (c.transcript ?? "").toLowerCase().includes(q) ||
    c.script.some((l) => l[1].toLowerCase().includes(q))
  );
}

export function filterCount(list: Call[], f: string): number {
  return list.filter((c) => matchesFilter(c, f)).length;
}

/** The other party — the shop's own number is never the interesting one. */
export function counterparty(c: Call): string {
  return c.dir === "OUTBOUND" ? c.to : c.from;
}

/* ---- device links ------------------------------------------------------ */

/** `tel:` accepts digits, `+`, and the DTMF pause characters. Anything else in
 *  a stored number is presentation (spaces, parens, dashes) and is dropped, so
 *  a hostile "number" cannot become a different URL scheme. The desktop's own
 *  guard, verbatim. */
export function telHref(num: string): string | null {
  const cleaned = num.replace(/[^\d+,;*#]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return "tel:" + cleaned;
}

/** Same guard, for the messaging app. */
export function smsHref(num: string): string | null {
  const cleaned = num.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 7) return null;
  return "sms:" + cleaned;
}

/* ---- keypad ------------------------------------------------------------- */

export const KEYS: Array<{ d: string; s: string }> = [
  { d: "1", s: "" }, { d: "2", s: "ABC" }, { d: "3", s: "DEF" },
  { d: "4", s: "GHI" }, { d: "5", s: "JKL" }, { d: "6", s: "MNO" },
  { d: "7", s: "PQRS" }, { d: "8", s: "TUV" }, { d: "9", s: "WXYZ" },
  { d: "*", s: "" }, { d: "0", s: "+" }, { d: "#", s: "" },
];

/** Progressive US formatting while the keypad is being typed into. */
export function fmtDial(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  if (raw.length <= 3) return raw;
  if (raw.length <= 6) return `(${raw.slice(0, 3)}) ${raw.slice(3)}`;
  if (raw.length <= 10) return `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
  return `+${raw.slice(0, raw.length - 10)} (${raw.slice(-10, -7)}) ${raw.slice(-7, -4)}-${raw.slice(-4)}`;
}

/** Server actions reject with an Error whose message is written for the user
 *  ("You've reached the Lead limit on your plan."). Surface that text; fall
 *  back to a generic line for anything unrecognisable. */
export function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}
