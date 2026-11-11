// Phone — the ONE loader both editions read.
//
// /dashboard/phone (desktop sheet + handheld build behind the viewport switch)
// and the /mobile-phone-v2 preview route call this. The call log, the three
// stat figures, the Twilio configuration state and the webhook URL are all
// read here — the same four queries, the same `await isTwilioEnabled()` check and
// the same `TWILIO_APP_URL ?? appBaseUrl()` webhook the archived classic page
// used, so both editions describe the same line.

import { redirect } from "next/navigation";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { relative } from "@/lib/format";
import type { CallOutcome } from "@/lib/aiDesk/liveCall";
import { DESK_OUTCOME_LABEL, deskOutcomeWord, minutesOf, prettyPhone } from "@/lib/aiDesk/shared";
import { deskStripFor } from "@/lib/aiDesk/strip";
import { readDeskUse } from "@/lib/aiDesk/usage";
import type { PhoneContentProps } from "@/components/v3/phone-blueprint/phone-content";
import type { Call, CallDesk, CallScriptLine } from "@/components/v3/phone-blueprint/phone-data";

export type PhoneProps = PhoneContentProps;

/** Speaker prefixes a transcript may carry, and which side of the sheet each
 *  belongs on. Twilio's raw transcription has no labels at all; OpenAI-shaped
 *  and hand-pasted transcripts usually do. */
const SPEAKER_LINE = /^([A-Za-z][A-Za-z ]{0,14}?)\s*[:：]\s*(.+)$/;
const AGENT_SPEAKERS = new Set(["agent", "shop", "rep", "receptionist", "you", "assistant", "ai"]);
/** The AI desk's own side of a call it answered (lib/aiDesk/liveCall writes "Desk: …"). */
const DESK_SPEAKERS = new Set(["desk", "ai desk"]);

/**
 * Split a transcript into the sheet's two-column script.
 *
 * All-or-nothing on purpose: if ANY non-blank line lacks a speaker prefix the
 * text is not a labelled dialogue, and guessing would attribute half a
 * conversation to the wrong person. The caller then renders `transcript` as one
 * block instead — which is what the classic sheet did with every transcript.
 */
function parseTranscript(raw: string | null): CallScriptLine[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const out: CallScriptLine[] = [];
  for (const line of lines) {
    const m = SPEAKER_LINE.exec(line);
    if (!m) return [];
    const key = m[1].trim().toLowerCase();
    const who = DESK_SPEAKERS.has(key) ? "desk" : AGENT_SPEAKERS.has(key) ? "agent" : "caller";
    out.push([who, m[2].trim()]);
  }
  return out;
}

/**
 * @param nextPath where the login redirect should return to — the route that
 *   called this, so a preview URL comes back to the preview.
 */
export async function loadPhoneProps(nextPath: string): Promise<PhoneProps> {
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const [calls, todayCount, weekCount, leadsCreated, use, strip, org] = await Promise.all([
    db.aiPhoneCall.findMany({
      where: { organizationId },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    db.aiPhoneCall.count({ where: { organizationId, startedAt: { gte: startOfDay } } }),
    db.aiPhoneCall.count({ where: { organizationId, startedAt: { gte: startOfWeek } } }),
    db.aiPhoneCall.count({
      where: { organizationId, leadId: { not: null }, startedAt: { gte: startOfWeek } },
    }),
    readDeskUse(organizationId),
    deskStripFor(organizationId).catch(() => null),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);

  // What the AI desk did on each call it answered (2026-10-13): the outcome rows the
  // voice server posted (SyncState `callout:<sid>`, no schema change) and the visits it
  // booked, so a row can say "booked a visit" and open it on the calendar.
  const outcomes = new Map<string, CallOutcome>();
  if (calls.length) {
    const rows = await db.syncState.findMany({ where: { key: { in: calls.map((c) => `callout:${c.callSid}`) } }, select: { key: true, cursor: true } });
    for (const r of rows) {
      try {
        outcomes.set(r.key.slice("callout:".length), JSON.parse(r.cursor) as CallOutcome);
      } catch {
        /* an unreadable row shows as a call the desk did not take */
      }
    }
  }
  // Who was on the line: the lead the call is on (a call the desk took, or one turned into a lead).
  const leadIds = Array.from(new Set(calls.map((c) => c.leadId).filter((x): x is string => !!x)));
  const leads = leadIds.length ? await db.lead.findMany({ where: { id: { in: leadIds }, organizationId }, select: { id: true, name: true } }) : [];
  const nameByLead = new Map(leads.map((l) => [l.id, l.name?.trim() || null]));
  const apptIds = Array.from(outcomes.values()).map((o) => o.appointmentId).filter((x): x is string => !!x);
  const appts = apptIds.length ? await db.appointment.findMany({ where: { id: { in: apptIds }, organizationId }, select: { id: true, startsAt: true } }) : [];
  const apptById = new Map(appts.map((a) => [a.id, a]));
  const tz = org?.timezone || "America/New_York";
  const deskOf = (callSid: string): CallDesk | null => {
    const o = outcomes.get(callSid);
    if (!o) return null;
    const word = deskOutcomeWord(o);
    const a = o.appointmentId ? apptById.get(o.appointmentId) : null;
    return {
      word,
      label: DESK_OUTCOME_LABEL[word],
      seconds: o.seconds,
      appointment: a ? { id: a.id, when: a.startsAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }), date: localDate(a.startsAt, tz) } : null,
      error: typeof o.error === "string" && o.error ? o.error : null,
    };
  };

  const entries: Call[] = calls.map((c) => ({
    id: c.id,
    // Numbers as people read them: "(509) 555-0173", not "+15095550173" (a non-US number stays as stored).
    from: prettyPhone(c.fromNumber),
    to: prettyPhone(c.toNumber),
    dir: c.direction,
    status: c.status,
    dur: c.durationSeconds,
    rec: c.recordingUrl,
    lead: c.leadId,
    when: relative(c.startedAt),
    summary: c.summary,
    script: parseTranscript(c.transcript),
    transcript: c.transcript,
    desk: deskOf(c.callSid),
    name: c.leadId ? (nameByLead.get(c.leadId) ?? null) : null,
  }));

  const appUrl = await appBaseUrl();
  const webhookUrl = `${process.env.TWILIO_APP_URL ?? appUrl}/api/twilio/voice`;

  return {
    entries,
    stats: { today: todayCount, week: weekCount, leads: leadsCreated, deskMinutes: minutesOf(use.callSeconds + use.testSeconds) },
    webhookUrl,
    twilioConfigured: await isTwilioEnabled(),
    desk: strip,
  };
}

/** `2026-10-14` in the company's zone — the calendar's `?date=` for the day of a visit. */
function localDate(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
