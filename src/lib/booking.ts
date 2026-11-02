// ONLINE BOOKING — THE PLAIN RULES (2026-09-23). Pure. What a shop offers
// to book (from the trades it works), when it is open, which slots are
// free given what is already on the calendar, and the questions a booking
// asks so the tech arrives knowing the job. The database side is
// lib/bookingBook.

export type ServiceKind = "diagnostic" | "tune-up" | "emergency" | "estimate" | "consult" | "other";

export interface BookingService {
  key: string;
  label: string;
  kind: ServiceKind;
  minutes: number;
  /** What the customer reads next to the service: "$129", "Free", "Free for members". */
  priceText: string;
  /** Members (an active service plan) see this instead, when set. */
  memberPriceText?: string;
  description?: string;
  /** The one or two questions that matter for this visit. */
  questions?: { key: string; label: string; options?: string[] }[];
  /** Same-day / next-day: the earliest slot ignores the lead time. */
  urgent?: boolean;
  trade: string;
}

export interface DayHours {
  open: string; // "08:00"
  close: string; // "17:00"
}

export interface BookingSettings {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday; null = closed. */
  hours: Array<DayHours | null>;
  slotMinutes: number;
  leadHours: number;
  horizonDays: number;
  /** How many visits can start in the same window (crews on the road). */
  crews: number;
  /** The arrival window the customer is promised, in minutes (0 = the exact time). */
  arrivalWindow: number;
  services: BookingService[];
  intro?: string;
}

const WEEKDAY: DayHours = { open: "08:00", close: "17:00" };
export const DEFAULT_HOURS: Array<DayHours | null> = [null, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, null];

const SYMPTOM = { key: "symptom", label: "What is it doing?", options: ["No cooling", "No heat", "Not enough air", "Noise", "Water or a leak", "Short cycling", "Thermostat / controls", "Something else"] };
const AGE = { key: "age", label: "About how old is the system?", options: ["Under 5 years", "5–10", "10–15", "15+", "Not sure"] };
const SYSTEM = { key: "system", label: "What kind of system?", options: ["AC + furnace", "Heat pump", "Ductless mini split", "Package unit", "Not sure"] };

/** The services a shop offers to book, from the trades it works. Editable afterwards. */
export function defaultServicesFor(trades: readonly string[]): BookingService[] {
  const t = new Set(trades.map((x) => x.toLowerCase()));
  const out: BookingService[] = [];
  // No trades set yet: only the plain estimate visit and "something else" —
  // the office page says to set the trades in Company for the smart defaults.
  if (t.has("hvac")) {
    out.push(
      { key: "hvac-diagnostic", label: "Repair / diagnostic visit", kind: "diagnostic", minutes: 90, priceText: "$129 diagnostic, applied to the repair", memberPriceText: "Diagnostic waived for members", description: "A technician finds the fault and quotes the repair on the spot.", questions: [SYMPTOM, SYSTEM, AGE], trade: "HVAC" },
      { key: "hvac-emergency", label: "No cooling / no heat — today", kind: "emergency", minutes: 120, priceText: "$189 same-day diagnostic", memberPriceText: "Priority same-day, diagnostic waived", description: "The first open slot today or tomorrow.", questions: [SYMPTOM, SYSTEM], urgent: true, trade: "HVAC" },
      { key: "hvac-tuneup", label: "Seasonal tune-up", kind: "tune-up", minutes: 90, priceText: "$149", memberPriceText: "Included in your plan", description: "Cooling or heating tune-up with a written report.", questions: [SYSTEM, AGE], trade: "HVAC" },
      { key: "hvac-estimate", label: "Replacement estimate", kind: "estimate", minutes: 60, priceText: "Free", description: "A sized, priced proposal for a new system — Good, Better, Best.", questions: [SYSTEM, AGE], trade: "HVAC" },
    );
  }
  if (t.has("roofing")) {
    out.push(
      { key: "roof-estimate", label: "Roof inspection and estimate", kind: "estimate", minutes: 60, priceText: "Free", description: "We measure the roof and leave a written proposal.", questions: [{ key: "roofAge", label: "About how old is the roof?", options: ["Under 10 years", "10–20", "20+", "Not sure"] }, { key: "roofIssue", label: "What brings you to us?", options: ["Leak", "Storm damage", "Aging roof", "Selling the house", "Just a quote"] }], trade: "Roofing" },
      { key: "roof-leak", label: "Leak call", kind: "diagnostic", minutes: 90, priceText: "$149 leak diagnosis", description: "Find the leak, stop the water, quote the fix.", questions: [{ key: "leakWhere", label: "Where is the water showing?", options: ["Ceiling", "Attic", "Wall", "Around a chimney or vent", "Not sure"] }], urgent: true, trade: "Roofing" },
    );
  }
  if (t.has("fencing")) {
    out.push({ key: "fence-estimate", label: "Fence estimate visit", kind: "estimate", minutes: 45, priceText: "Free", description: "We walk the line, measure, and price it on the spot.", questions: [{ key: "fenceFeet", label: "About how many feet?", options: ["Under 100", "100–200", "200–400", "400+", "Not sure"] }, { key: "fenceType", label: "What kind?", options: ["Cedar", "Vinyl", "Chain link", "Aluminum", "Not sure yet"] }], trade: "Fencing" });
  }
  if (t.has("plumbing")) {
    out.push({ key: "plumb-service", label: "Plumbing service call", kind: "diagnostic", minutes: 90, priceText: "$99 service fee, applied to the work", questions: [{ key: "plumbIssue", label: "What is going on?", options: ["Leak", "Clog / drain", "Water heater", "No water / low pressure", "Something else"] }], urgent: true, trade: "Plumbing" });
  }
  if (t.has("electrical")) {
    out.push({ key: "elec-service", label: "Electrical service call", kind: "diagnostic", minutes: 90, priceText: "$99 service fee, applied to the work", questions: [{ key: "elecIssue", label: "What is going on?", options: ["Outlet or switch", "Breaker tripping", "Panel / service upgrade", "EV charger", "Lighting", "Something else"] }], trade: "Electrical" });
  }
  const remodel = ["kitchen & bath", "remodeling", "general contractor", "painting", "flooring", "tile", "drywall"];
  if ([...t].some((x) => remodel.some((r) => x.includes(r.split(" ")[0])))) {
    out.push({ key: "remodel-consult", label: "Remodel consultation", kind: "consult", minutes: 60, priceText: "Free", description: "We look at the space, hear what you want, and follow with a proposal.", questions: [{ key: "room", label: "Which space?", options: ["Kitchen", "Bathroom", "Basement", "Whole home", "Other"] }, { key: "budget", label: "Rough budget in mind?", options: ["Under $15k", "$15–40k", "$40–100k", "$100k+", "Not sure"] }], trade: "Remodeling" });
  }
  if (!out.some((s) => s.kind === "estimate" || s.kind === "consult")) {
    out.push({ key: "estimate", label: "Estimate visit", kind: "estimate", minutes: 60, priceText: "Free", description: "We come out, look, and leave a written proposal.", trade: trades[0] ?? "General" });
  }
  out.push({ key: "other", label: "Something else", kind: "other", minutes: 60, priceText: "We'll confirm", description: "Tell us what you need and we will confirm the visit.", questions: [{ key: "what", label: "What do you need?" }], trade: trades[0] ?? "General" });
  return out;
}

export function defaultBookingSettings(trades: readonly string[]): BookingSettings {
  return { enabled: true, hours: DEFAULT_HOURS, slotMinutes: 60, leadHours: 24, horizonDays: 21, crews: 1, arrivalWindow: 120, services: defaultServicesFor(trades) };
}

/** A saved settings blob, healed: anything missing takes the default. */
export function parseBookingSettings(json: string | null | undefined, trades: readonly string[]): BookingSettings {
  const d = defaultBookingSettings(trades);
  if (!json) return d;
  try {
    const v = JSON.parse(json) as Partial<BookingSettings>;
    const hours = Array.isArray(v.hours) && v.hours.length === 7 ? v.hours.map((h) => (h && typeof h.open === "string" && typeof h.close === "string" ? { open: h.open, close: h.close } : null)) : d.hours;
    const services = Array.isArray(v.services) && v.services.length ? v.services.filter((s): s is BookingService => !!s && typeof s.key === "string" && typeof s.label === "string" && typeof s.minutes === "number") : d.services;
    return {
      enabled: v.enabled !== false,
      hours,
      slotMinutes: clampInt(v.slotMinutes, 15, 240, d.slotMinutes),
      leadHours: clampInt(v.leadHours, 0, 168, d.leadHours),
      horizonDays: clampInt(v.horizonDays, 3, 60, d.horizonDays),
      crews: clampInt(v.crews, 1, 20, d.crews),
      arrivalWindow: clampInt(v.arrivalWindow, 0, 480, d.arrivalWindow),
      services,
      intro: typeof v.intro === "string" ? v.intro.slice(0, 400) : undefined,
    };
  } catch {
    return d;
  }
}
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);

// ── time in the shop's zone ─────────────────────────────────────────────────

/** The parts of an instant on the shop's clock. */
export function zonedParts(d: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow };
}

/**
 * The instant when the shop's clock reads y-m-d h:min. The offset is read twice: on the day the clocks change the
 * first guess sits on the other side of the change (8 AM on the first Sunday of November came out as 7 AM).
 */
export function zonedInstant(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const want = Date.UTC(y, m - 1, d, h, min, 0);
  try {
    const offsetAt = (t: number) => {
      const p = zonedParts(new Date(t), timeZone);
      return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0) - t;
    };
    const first = want - offsetAt(want);
    const second = want - offsetAt(first);
    return new Date(second);
  } catch {
    return new Date(want);
  }
}

export interface Busy {
  startsAt: Date;
  endsAt: Date;
}
export interface Slot {
  startsAt: Date;
  endsAt: Date;
}
export interface DaySlots {
  /** "2026-09-24" on the shop's clock. */
  day: string;
  weekday: string;
  slots: Slot[];
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
};

/**
 * The slots a customer can take: inside the shop's hours on each day of the
 * horizon, on the slot grid, long enough for the service, after the lead
 * time (an urgent service may start as soon as the next slot), and with
 * fewer than `crews` visits already overlapping. `busy` is everything on
 * the calendar (appointments, jobs, org-wide blocks).
 */
export function availableSlots(input: { settings: BookingSettings; service: BookingService; busy: Busy[]; timeZone: string; now?: Date; days?: number }): DaySlots[] {
  const { settings, service, busy, timeZone } = input;
  const now = input.now ?? new Date();
  const days = input.days ?? settings.horizonDays;
  const earliest = new Date(now.getTime() + (service.urgent ? Math.min(settings.leadHours, 2) : settings.leadHours) * 3600000);
  const out: DaySlots[] = [];
  const today = zonedParts(now, timeZone);
  for (let i = 0; i < days; i++) {
    const dayStart = zonedInstant(today.y, today.m, today.d + i, 0, 0, timeZone);
    const parts = zonedParts(new Date(dayStart.getTime() + 12 * 3600000), timeZone);
    const hours = settings.hours[parts.dow];
    if (!hours) continue;
    const open = hm(hours.open);
    const close = hm(hours.close);
    const dayOpen = zonedInstant(parts.y, parts.m, parts.d, open.h, open.m, timeZone);
    const dayClose = zonedInstant(parts.y, parts.m, parts.d, close.h, close.m, timeZone);
    const slots: Slot[] = [];
    for (let t = dayOpen.getTime(); t + service.minutes * 60000 <= dayClose.getTime(); t += settings.slotMinutes * 60000) {
      const s = new Date(t);
      const e = new Date(t + service.minutes * 60000);
      if (s < earliest) continue;
      const overlapping = busy.filter((b) => b.startsAt < e && b.endsAt > s).length;
      if (overlapping >= settings.crews) continue;
      slots.push({ startsAt: s, endsAt: e });
    }
    if (slots.length) out.push({ day: `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`, weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][parts.dow], slots });
  }
  return out;
}

/** "Tue, Sep 29 · 8:00–10:00 AM arrival window" on the shop's clock. */
export function slotLabel(s: Slot, timeZone: string, arrivalWindow: number): string {
  const day = s.startsAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  if (!arrivalWindow) return `${day} · ${t(s.startsAt)}`;
  return `${day} · ${t(s.startsAt)}–${t(new Date(s.startsAt.getTime() + arrivalWindow * 60000))} arrival`;
}

/** The scope a booking hands the lead: the service, the answers, the customer's words. */
/** The lead's scope for a booked visit. `channel` "ai-desk": the desk booked it on a call, and the notes are what the caller said. */
export function bookingScope(service: BookingService, answers: Array<{ label: string; value: string }>, notes: string | null | undefined, channel: "online" | "ai-desk" | "smartbook" = "online"): string {
  const lines = [channel === "ai-desk" ? `${service.label} booked by phone with the AI desk.` : channel === "smartbook" ? `${service.label} booked with SmartBook.` : `${service.label} booked online.`];
  for (const a of answers) if (a.value) lines.push(`${a.label} ${a.value}`);
  if (notes?.trim()) lines.push(`${channel === "ai-desk" ? "On the call" : "In their words"}: ${notes.trim()}`);
  return lines.join("\n");
}
