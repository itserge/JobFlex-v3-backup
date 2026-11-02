// SMARTBOOK · THE SETTINGS (owner, 2026-10-31: "the calendar from JobFlex would offer availability by text or email
// or calling from AI desk … super smart … easy for clients and easy for contractors").
//
// One blob per company in SyncState `smartbook:settings:<orgId>` (no schema change), healed on every read. Off until
// the owner turns it on; `onSince` is when — a lead that came in before it is never contacted on its own.
//
// Pure, no imports beyond the source vocabulary: the settings pane, the engine and the QA read it.
import { leadSourceOf, type LeadSourceKey } from "@/lib/leads/sources";

/** Which leads SmartBook answers by itself. "other" is everything a person added or imported. */
export interface SmartBookSources {
  facebook: boolean;
  website: boolean;
  /** The Lead Center (JobFlex sent it). */
  jobflex: boolean;
  /** A message left with the AI desk. */
  desk: boolean;
  other: boolean;
}

export interface SmartBookSettings {
  on: boolean;
  /** ISO — when it was last turned on. */
  onSince: string | null;
  sources: SmartBookSources;
  text: boolean;
  email: boolean;
  /** One AI call when a lead hasn't answered in 2 business hours (owner, 2026-10-31: off until switched on). */
  call: boolean;
  /** The booking visit type offered; null = the first estimate visit. */
  serviceKey: string | null;
  /** How many times the first message offers (2–4). */
  offers: number;
  /** A time the customer suggests: ask the contractor (the owner's flow), or book it when the calendar is free. */
  ownTime: "ask" | "auto";
  /** The first text in the owner's words, or null for SmartBook's own. */
  firstMessage: string | null;
}

export const smartBookSettingsKey = (organizationId: string) => `smartbook:settings:${organizationId}`;

export const DEFAULT_SMARTBOOK: SmartBookSettings = {
  on: false,
  onSince: null,
  sources: { facebook: true, website: true, jobflex: true, desk: true, other: false },
  text: true,
  email: true,
  call: false,
  serviceKey: null,
  offers: 3,
  ownTime: "ask",
  firstMessage: null,
};

/** The longest first message the owner may write — it still has to fit the times and the STOP line in a text. */
export const FIRST_MESSAGE_MAX = 400;

export function parseSmartBookSettings(cursor: string | null | undefined): SmartBookSettings {
  const d = DEFAULT_SMARTBOOK;
  if (!cursor) return { ...d, sources: { ...d.sources } };
  try {
    const v = JSON.parse(cursor) as Partial<SmartBookSettings> & { sources?: Partial<SmartBookSources> };
    const s: Partial<SmartBookSources> = v.sources ?? {};
    const bool = (x: unknown, dflt: boolean) => (typeof x === "boolean" ? x : dflt);
    const offers = typeof v.offers === "number" && Number.isFinite(v.offers) ? Math.min(4, Math.max(2, Math.round(v.offers))) : d.offers;
    const onSince = typeof v.onSince === "string" && Number.isFinite(Date.parse(v.onSince)) ? v.onSince : null;
    const firstMessage = typeof v.firstMessage === "string" && v.firstMessage.trim() ? v.firstMessage.trim().slice(0, FIRST_MESSAGE_MAX) : null;
    return {
      on: bool(v.on, d.on),
      onSince,
      sources: {
        facebook: bool(s.facebook, d.sources.facebook),
        website: bool(s.website, d.sources.website),
        jobflex: bool(s.jobflex, d.sources.jobflex),
        desk: bool(s.desk, d.sources.desk),
        other: bool(s.other, d.sources.other),
      },
      text: bool(v.text, d.text),
      email: bool(v.email, d.email),
      call: bool(v.call, d.call),
      serviceKey: typeof v.serviceKey === "string" && v.serviceKey.trim() ? v.serviceKey.trim().slice(0, 80) : null,
      offers,
      ownTime: v.ownTime === "auto" ? "auto" : "ask",
      firstMessage,
    };
  } catch {
    return { ...d, sources: { ...d.sources } };
  }
}

/** Which switch a lead's stored source falls under. Booked visits never reach SmartBook (they already have a time). */
export function sourceGroup(source: string | null | undefined): keyof SmartBookSources | null {
  const key: LeadSourceKey = leadSourceOf(source).key;
  if (key === "booking") return null;
  if (key === "facebook" || key === "instagram") return "facebook";
  if (key === "website") return "website";
  if (key === "jobflex") return "jobflex";
  if (key === "ai-desk" || key === "phone") return "desk";
  return "other";
}

/**
 * Does SmartBook answer a lead from this source on its own? The path that made the lead names its group (a lead typed
 * in by hand with "Phone" as its source is not a desk message); `sourceGroup` reads a stored lead's source.
 */
export function sourceAllowed(settings: SmartBookSettings, group: keyof SmartBookSources | null): boolean {
  return group ? settings.sources[group] : false;
}
