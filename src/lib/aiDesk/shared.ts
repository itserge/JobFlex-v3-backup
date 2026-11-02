// THE AI DESK — what a company's number does with a call. Pure, browser-safe.
//
// One number per company (lib/sms/registration buys it): it answers calls the day it is
// bought, and texts once the carriers approve it. This is the calls half. The settings
// live in SyncState `aidesk:<orgId>` as JSON — no schema change, like the registration.
//
//   ANSWER   JobFlex's phone assistant takes the call (today: it takes a message and
//            writes it up — the live desk comes with the voice server)
//   FORWARD  the call rings the company's own phone; a call nobody picks up goes to
//            the assistant's voicemail

import { cleanProfile, EMPTY_PROFILE, type DeskProfile } from "./profile";
import { cleanReview, type DeskReviewItem } from "./tradeCore";

export const DESK_MODES = ["ANSWER", "FORWARD"] as const;
export type DeskMode = (typeof DESK_MODES)[number];

/** OpenAI's realtime voices. */
export const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
export type DeskVoice = (typeof VOICES)[number];

/** Each voice in a few words, for the picker. */
export const VOICE_WORDS: Record<DeskVoice, string> = {
  marin: "warm and clear — the one we recommend",
  cedar: "calm, a little deeper",
  alloy: "even and neutral",
  ash: "soft and low",
  ballad: "gentle, unhurried",
  coral: "bright and friendly",
  echo: "steady, matter-of-fact",
  sage: "light and easy",
  shimmer: "crisp, upbeat",
  verse: "expressive",
};

/**
 * Whether the company's own phone forwards to the desk's number — set at the carrier, not
 * here; the desk only needs to know, because with "all" a transfer back to that phone would
 * ring the desk again.
 *   none    customers call the desk's number directly
 *   all     every call to the company phone forwards (*72) — the desk takes messages, never transfers
 *   missed  only unanswered calls forward (*71) — transfers still reach a person
 */
export const DESK_FORWARDING = ["none", "all", "missed"] as const;
export type DeskForwarding = (typeof DESK_FORWARDING)[number];

export type DeskSettings = {
  mode: DeskMode;
  forwarding: DeskForwarding;
  /** The voice the live desk speaks with. */
  voice: DeskVoice;
  /** What the owner typed or said about the company, as they said it. */
  brief: string;
  /** The desk's profile (lib/aiDesk/profile) — null until written. */
  profile: DeskProfile | null;
  profileUpdatedAt: string | null;
  /** What the desk still cannot answer — questions for the owner. */
  questions: string[];
  /** The kind of business, as the contractor typed it ("roofing, gutters") — what the desk was preset for. */
  business: string;
  /** The parts of the profile the contractor should still check (lib/aiDesk/tradePresets), highlighted until they do. */
  review: DeskReviewItem[];
  /** The desk calls new leads (owner, 2026-10-31; lib/aiDesk/leadCalls): a lead with a phone that nobody reached
   *  `afterMinutes` after it came in gets one call, inside calling hours. Off until the owner turns it on. */
  leadCalls: DeskLeadCalls;
};

export type DeskLeadCalls = { on: boolean; afterMinutes: number };
/** How long a new lead waits for a person before the desk calls it — the choices on the settings card. */
export const LEAD_CALL_DELAYS = [5, 10, 15, 30, 60] as const;
export const DEFAULT_LEAD_CALLS: DeskLeadCalls = { on: false, afterMinutes: 10 };

export function cleanLeadCalls(raw: unknown): DeskLeadCalls {
  const o = raw && typeof raw === "object" ? (raw as Partial<DeskLeadCalls>) : {};
  const minutes = Number(o.afterMinutes);
  return {
    on: o.on === true,
    afterMinutes: (LEAD_CALL_DELAYS as readonly number[]).includes(minutes) ? minutes : DEFAULT_LEAD_CALLS.afterMinutes,
  };
}

export const DEFAULT_DESK: DeskSettings = { mode: "ANSWER", forwarding: "none", voice: "marin", brief: "", profile: null, profileUpdatedAt: null, questions: [], business: "", review: [], leadCalls: DEFAULT_LEAD_CALLS };

/** The zones a US/Canadian contractor picks from; any IANA zone is accepted on save. */
export const US_TIMEZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern — New York, Miami, Atlanta" },
  { id: "America/Chicago", label: "Central — Chicago, Dallas, Houston" },
  { id: "America/Denver", label: "Mountain — Denver, Salt Lake City" },
  { id: "America/Phoenix", label: "Arizona — Phoenix (no daylight time)" },
  { id: "America/Los_Angeles", label: "Pacific — Seattle, Portland, Los Angeles" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Toronto", label: "Eastern — Toronto" },
  { id: "America/Edmonton", label: "Mountain — Calgary, Edmonton" },
  { id: "America/Vancouver", label: "Pacific — Vancouver" },
];

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone's name for a card, with the time there now. */
export function timezoneWords(tz: string, at: Date = new Date()): string {
  const known = US_TIMEZONES.find((z) => z.id === tz)?.label ?? tz;
  try {
    return `${known} · ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })} there now`;
  } catch {
    return known;
  }
}

/** The stored JSON, read tolerantly: anything unreadable is the default. */
export function parseDeskSettings(json: string | null | undefined): DeskSettings {
  if (!json) return { ...DEFAULT_DESK };
  try {
    const raw = JSON.parse(json) as Partial<DeskSettings>;
    const mode = (DESK_MODES as readonly string[]).includes(String(raw.mode)) ? (raw.mode as DeskMode) : DEFAULT_DESK.mode;
    return {
      mode,
      forwarding: (DESK_FORWARDING as readonly string[]).includes(String(raw.forwarding)) ? (raw.forwarding as DeskForwarding) : DEFAULT_DESK.forwarding,
      voice: (VOICES as readonly string[]).includes(String(raw.voice)) ? (raw.voice as DeskVoice) : DEFAULT_DESK.voice,
      brief: typeof raw.brief === "string" ? raw.brief.slice(0, 4000) : "",
      profile: raw.profile && typeof raw.profile === "object" ? cleanProfile(raw.profile, EMPTY_PROFILE) : null,
      profileUpdatedAt: typeof raw.profileUpdatedAt === "string" ? raw.profileUpdatedAt : null,
      questions: Array.isArray(raw.questions) ? raw.questions.filter((x): x is string => typeof x === "string").slice(0, 8) : [],
      business: typeof raw.business === "string" ? raw.business.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      review: cleanReview(raw.review),
      leadCalls: cleanLeadCalls(raw.leadCalls),
    };
  } catch {
    return { ...DEFAULT_DESK };
  }
}

/**
 * Where a call to the company's number goes, in words — for the settings card.
 *   assistant  the phone assistant answers (the Phone page is on the plan)
 *   phone      it rings the company phone
 *   none       no phone to ring and no assistant on the plan
 */
export type CallsGo = "assistant" | "phone" | "none";

export function callsGo(input: { mode: DeskMode; assistantOnPlan: boolean; companyPhone: string | null }): CallsGo {
  if (input.mode === "ANSWER" && input.assistantOnPlan) return "assistant";
  if (input.companyPhone) return "phone";
  return input.assistantOnPlan ? "assistant" : "none";
}

/* ── the desk's minutes ─────────────────────────────────────────────────────
   One row a month per company (SyncState `deskuse:<orgId>:<YYYY-MM>`): the seconds the
   live desk was on calls, and the seconds the owner spent testing it from the browser.
   The plan's included minutes and the packs (step 5) are counted against the same row. */
export type DeskUse = {
  callSeconds: number;
  calls: number;
  testSeconds: number;
  tests: number;
  /** Of this month's seconds, how many were already taken off the pack balance (lib/aiDesk/minutes settle). */
  packSeconds: number;
  /** When the owner was told the desk ran out this month — once a month. */
  outNoticeAt: string | null;
};
export const EMPTY_USE: DeskUse = { callSeconds: 0, calls: 0, testSeconds: 0, tests: 0, packSeconds: 0, outNoticeAt: null };

/** `2026-10` — UTC, so the month turns at the same moment for every company. */
export const monthKey = (d: Date = new Date()): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function parseDeskUse(json: string | null | undefined): DeskUse {
  if (!json) return { ...EMPTY_USE };
  try {
    const raw = JSON.parse(json) as Partial<DeskUse>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
    return { callSeconds: n(raw.callSeconds), calls: n(raw.calls), testSeconds: n(raw.testSeconds), tests: n(raw.tests), packSeconds: n(raw.packSeconds), outNoticeAt: typeof raw.outNoticeAt === "string" ? raw.outNoticeAt : null };
  } catch {
    return { ...EMPTY_USE };
  }
}

/* ── minutes and packs ──────────────────────────────────────────────────────
   A plan includes minutes a month (the plan editor's "AI desk minutes" limit; a plan
   row without one gets the tier's default below). Past those, calls run on packs:
   300 minutes for $29, a balance that does not expire (SyncState `deskpacks:<orgId>`).
   Out of both, the desk stops answering — calls ring the company phone or take a
   message — until a pack is added, by hand or by auto top-up. */
export const DESK_PACK = { minutes: 300, cents: 2900 } as const;

/** Included minutes a month when the plan row has no `deskMinutes` limit of its own. */
export const DESK_MINUTES_DEFAULT: Record<string, number> = { FREE: 0, STARTER: 0, PROFESSIONAL: 150, ENTERPRISE: 500 };
/** The build-your-plan company with the Phone page: the add-on's minutes. */
export const DESK_MINUTES_CUSTOM_WITH_PHONE = 60;
/** "Running low" from here down; auto top-up buys at or under TOP_UP_AT. */
export const LOW_MINUTES_SECONDS = 15 * 60;
export const TOP_UP_AT_SECONDS = 5 * 60;

export type DeskPackVia = "card-on-file" | "checkout" | "auto" | "admin";
export type DeskPackRecord = { at: string; minutes: number; cents: number; via: DeskPackVia; ref: string | null };
export type DeskPacks = {
  /** Pack seconds still unused. */
  seconds: number;
  autoTopUp: boolean;
  /** The last time auto top-up could not charge the card — tried again a day later, not sooner. */
  autoFailedAt: string | null;
  history: DeskPackRecord[];
};
export const EMPTY_PACKS: DeskPacks = { seconds: 0, autoTopUp: false, autoFailedAt: null, history: [] };

export function parseDeskPacks(json: string | null | undefined): DeskPacks {
  if (!json) return { ...EMPTY_PACKS, history: [] };
  try {
    const raw = JSON.parse(json) as Partial<DeskPacks>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
    const history = Array.isArray(raw.history)
      ? raw.history
          .filter((h): h is DeskPackRecord => !!h && typeof h === "object" && typeof (h as DeskPackRecord).at === "string")
          .map((h) => ({ at: h.at, minutes: n(h.minutes), cents: n(h.cents), via: (["card-on-file", "checkout", "auto", "admin"] as const).includes(h.via) ? h.via : "card-on-file", ref: typeof h.ref === "string" ? h.ref : null }))
          .slice(0, 24)
      : [];
    return { seconds: Math.max(0, n(raw.seconds)), autoTopUp: raw.autoTopUp === true, autoFailedAt: typeof raw.autoFailedAt === "string" ? raw.autoFailedAt : null, history };
  } catch {
    return { ...EMPTY_PACKS, history: [] };
  }
}

export type DeskBalance = {
  includedMinutes: number;
  /** This month's seconds, calls and tests. */
  usedSeconds: number;
  /** Of the included minutes, what is left. */
  includedLeftSeconds: number;
  /** Pack seconds left after this month's overage. */
  packSeconds: number;
  remainingSeconds: number;
  out: boolean;
  low: boolean;
  autoTopUp: boolean;
};

/** Pack seconds this month's use has eaten beyond the included minutes and that are not yet off the balance. */
export const unsettledPackSeconds = (includedMinutes: number, use: DeskUse): number => Math.max(0, use.callSeconds + use.testSeconds - includedMinutes * 60) - use.packSeconds;

/** Where the company stands: included minutes first, then packs. `packs.seconds` is read as already settled. */
export function deskBalance(includedMinutes: number, use: DeskUse, packs: DeskPacks): DeskBalance {
  const usedSeconds = use.callSeconds + use.testSeconds;
  const includedLeftSeconds = Math.max(0, includedMinutes * 60 - usedSeconds);
  // Overage not yet settled comes off the packs here too, so the figure never lags a settle.
  const packSeconds = Math.max(0, packs.seconds - Math.max(0, unsettledPackSeconds(includedMinutes, use)));
  const remainingSeconds = includedLeftSeconds + packSeconds;
  return { includedMinutes, usedSeconds, includedLeftSeconds, packSeconds, remainingSeconds, out: remainingSeconds <= 0, low: remainingSeconds > 0 && remainingSeconds < LOW_MINUTES_SECONDS, autoTopUp: packs.autoTopUp };
}

/** "427 min left" · "12 min left — running low" · "Out of minutes". */
export function minutesLeftWords(b: DeskBalance): string {
  if (b.out) return "Out of minutes";
  const m = Math.floor(b.remainingSeconds / 60);
  const left = m >= 1 ? `${m} min left` : "Under a minute left";
  return b.low ? `${left} — running low` : left;
}

export const dollars = (cents: number): string => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);

/** Seconds as minutes for a figure: under a minute rounds up to one, otherwise to the nearest. */
export const minutesOf = (seconds: number): number => (seconds <= 0 ? 0 : Math.max(1, Math.round(seconds / 60)));

/** Seconds as a clock — "1:05", "0:42". */
export const clock = (seconds: number): string => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, Math.round(seconds)) % 60).padStart(2, "0")}`;

/* ── how a call the desk answered went, in words ──────────────────────────── */
export type DeskOutcomeWord = "booked" | "message" | "transfer" | "answered" | "failed";

export const DESK_OUTCOME_LABEL: Record<DeskOutcomeWord, string> = {
  booked: "booked a visit",
  message: "took a message",
  transfer: "handed to you",
  answered: "answered",
  failed: "couldn't take it",
};

/** From the outcome the voice server reported (lib/aiDesk/liveCall CallOutcome). */
export function deskOutcomeWord(o: { outcome: string; appointmentId: string | null; messageTaken: boolean }): DeskOutcomeWord {
  if (o.appointmentId) return "booked";
  if (o.messageTaken) return "message";
  if (o.outcome === "transfer") return "transfer";
  if (o.outcome === "failed") return "failed";
  return "answered";
}

/** `+18665550199` → `(866) 555-0199`; anything else as written. */
/**
 * The codes that turn forwarding on and off at the contractor's own carrier, with the desk's number in them
 * (2026-10-14: the owner set "forwards every call", dialed nothing that his carrier knew, and his cell kept ringing —
 * *72 is Verizon's; AT&T and T-Mobile, and the brands on their networks, use the GSM codes). `kind` "all" forwards
 * every call, "missed" only what is not picked up. Empty for a number that is not a 10-digit US one.
 */
export type ForwardCode = { carrier: string; on: string; off: string };
export function forwardingCodes(deskNumber: string, kind: "all" | "missed"): ForwardCode[] {
  const d = deskNumber.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^\d{10}$/.test(d)) return [];
  return kind === "all"
    ? [
        { carrier: "Verizon", on: `*72${d}`, off: "*73" },
        { carrier: "AT&T · T-Mobile", on: `**21*${d}#`, off: "##21#" },
      ]
    : [
        { carrier: "Verizon", on: `*71${d}`, off: "*73" },
        { carrier: "AT&T · T-Mobile", on: `**004*${d}#`, off: "##004#" },
      ];
}

export function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** What the assistant says before it takes a message ("Ridgeline Roofing Co." keeps one period). */
export const greetingFor = (companyName: string): string =>
  `Thanks for calling ${companyName.trim().replace(/\.+$/, "")}. Please leave your name, phone number, and a short description of your project after the beep.`;
