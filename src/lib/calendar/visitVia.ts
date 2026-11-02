// CALENDAR · HOW A VISIT WAS BOOKED (owner, 2026-10-16: "check that the AI desk
// can make an appointment, that it lands on the calendar, and that its card
// looks different from a job card — make it smart").
//
// An Appointment is written by three paths, and the calendar used to show all
// of them as one sky-edged card with no word on where it came from:
//
//   ai-desk — the AI desk booked it on a phone call (lib/aiDesk/liveCall →
//             createBooking with channel "ai-desk")
//   online  — the customer booked it on the booking page (/book/<slug>)
//   plan    — a service plan's visit put it on the calendar (servicePlanBook)
//   team    — someone in the office added it on the calendar
//   smartbook — SmartBook booked it with a new lead by text, email or the pick page (lib/smartbook, 2026-10-31)
//
// The channel is kept beside the appointment in SyncState `aptSource:<id>`
// (no schema change). Desk bookings made before that row existed are still
// recognised by the line the desk always wrote into the booking's notes.
//
// Pure, no imports: the calendar query, both calendar editions and the QA read it.

export type VisitVia = "ai-desk" | "online" | "plan" | "team" | "smartbook";

export interface VisitViaDef {
  key: VisitVia;
  /** The tag on the card. */
  tag: string;
  /** Sprite symbol — every shell's sprite has these four. */
  icon: string;
  /** The card's edge and tag colour. */
  tone: string;
  /** The phone row's badge, in words. */
  badge: string;
}

export const VISIT_VIA: Record<VisitVia, VisitViaDef> = {
  "ai-desk": { key: "ai-desk", tag: "AI desk", icon: "i-phone", tone: "#0f766e", badge: "AI desk booked" },
  online: { key: "online", tag: "Online", icon: "i-cal", tone: "#2563eb", badge: "Booked online" },
  plan: { key: "plan", tag: "Plan", icon: "i-plans", tone: "#b45309", badge: "Plan visit" },
  team: { key: "team", tag: "Office", icon: "i-user", tone: "#6d28d9", badge: "Appointment" },
  // The ink of SmartHelp's row (DESIGN.md): SmartBook is its sibling.
  smartbook: { key: "smartbook", tag: "SmartBook", icon: "i-cal", tone: "#0a0a0a", badge: "SmartBook booked" },
};

export const aptSourceKey = (appointmentId: string) => `aptSource:${appointmentId}`;

export interface AptSource {
  channel: "ai-desk" | "online" | "smartbook";
  callSid: string | null;
  at: string;
}

export function parseAptSource(cursor: string | null | undefined): AptSource | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(cursor) as Partial<AptSource>;
    if (v.channel !== "ai-desk" && v.channel !== "online" && v.channel !== "smartbook") return null;
    return { channel: v.channel, callSid: typeof v.callSid === "string" && v.callSid ? v.callSid : null, at: typeof v.at === "string" ? v.at : "" };
  } catch {
    return null;
  }
}

/** The words every desk booking carried in its notes before `aptSource` existed. */
const DESK_NOTE = /booked by (the )?ai desk|booked by phone · the ai desk/i;

export function visitVia(a: {
  marker?: AptSource | null;
  booking?: { notes?: string | null } | null;
  planVisit?: unknown;
  notes?: string | null;
}): VisitVia {
  if (a.marker) return a.marker.channel;
  if (a.booking) return DESK_NOTE.test(a.booking.notes ?? "") || DESK_NOTE.test(a.notes ?? "") ? "ai-desk" : "online";
  if (a.planVisit) return "plan";
  return "team";
}

/** The "Booked" line on the visit's sheet. */
export function bookedLine(via: VisitVia, facts: { by?: string | null; plan?: string | null; at?: Date | null }): string {
  const on = facts.at ? ` · ${facts.at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
  if (via === "ai-desk") return `By the AI desk, on a phone call${on}`;
  if (via === "online") return `By the customer, on your booking page${on}`;
  if (via === "smartbook") return `By SmartBook, with the customer${on}`;
  if (via === "plan") return `From the service plan${facts.plan ? ` “${facts.plan}”` : ""}`;
  return facts.by ? `By ${facts.by}${on}` : `By your team${on}`;
}

/**
 * The first line of an appointment's notes, written by createBooking. The desk
 * books through the booking machinery, and its visits used to say "Booked
 * online" here — which sent the office looking for a web booking that never
 * happened.
 */
export function bookingNoteHead(channel: "ai-desk" | "online" | "smartbook", priceText: string, memberPlan: string | null): string {
  const how = channel === "ai-desk" ? "Booked by phone · the AI desk" : channel === "smartbook" ? "Booked by SmartBook" : "Booked online";
  return `${how}${priceText ? ` · ${priceText}` : ""}${memberPlan ? ` · member of the ${memberPlan}` : ""}`;
}
