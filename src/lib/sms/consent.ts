// A CLIENT SAID YES TO TEXTS (2026-10-02) — server only.
//
// A contractor's own number is registered with the carriers on one opt-in
// story: the client ticks "Text me about my visit and estimate" on the
// company's booking page. That yes is kept per company and phone in SyncState
// `smsok:<orgId>:<E.164>` (no schema change) with a trail row, and the sending
// chokepoint (send.ts) asks for it before a company's own number texts anyone
// who is not on the team. STOP still wins: SmsOptOut is checked first.
//
// SmartBook (owner, 2026-10-31: "text when they agreed") keeps the same yes from the other places a customer gives it:
// the consent box on the company's Facebook lead form, a website estimator's box, a Lead Center request (its own
// consent covers the contractors it is sent to), and the "Prefer texts? Tap here" in SmartBook's email.

import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

const keyOf = (organizationId: string, phone: string) => `smsok:${organizationId}:${phone}`;

export type ConsentSource = "booking" | "facebook-form" | "website" | "lead-center" | "email-tap" | "phone-call";
const CONSENT_WHERE: Record<ConsentSource, string> = {
  booking: "on the booking page",
  "facebook-form": "on the Facebook lead form",
  website: "on the website estimator",
  "lead-center": "with their JobFlex request",
  "email-tap": "from SmartBook's email",
  "phone-call": "on a call with the AI desk",
};

/** Keep a client's yes. False when the phone cannot be read. */
export async function recordTextConsent(
  organizationId: string,
  rawPhone: string,
  how: { source: ConsentSource; name?: string | null; leadId?: string | null; clientId?: string | null },
): Promise<boolean> {
  const phone = toE164(rawPhone);
  if (!phone) return false;
  const cursor = JSON.stringify({ at: new Date().toISOString(), source: how.source });
  await db.syncState.upsert({ where: { key: keyOf(organizationId, phone) }, create: { key: keyOf(organizationId, phone), cursor }, update: { cursor } });
  await logActivity({
    organizationId,
    actorId: null,
    kind: TRAIL_KINDS.CLIENT,
    summary: `${how.name?.trim() || "A client"} agreed to texts about their visit and estimate ${CONSENT_WHERE[how.source]}`,
    leadId: how.leadId ?? null,
    clientId: how.clientId ?? null,
    meta: { phoneLast4: phone.slice(-4), source: how.source },
  });
  return true;
}

/** Did this phone say yes to this company's texts? */
export async function hasTextConsent(organizationId: string, phone: string): Promise<boolean> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId, phone) }, select: { key: true } });
  return Boolean(row);
}

/** A phone on the company's own team: a member's mobile, a crew phone, an extra office number.
 *  Crew and extra phones may be stored as typed, so they are compared as E.164. */
export async function isTeamPhone(organizationId: string, phone: string): Promise<boolean> {
  const member = await db.membership.findFirst({ where: { organizationId, user: { smsPhone: phone } }, select: { userId: true } });
  if (member) return true;
  const [workers, extras] = await Promise.all([
    db.workerProfile.findMany({ where: { organizationId, phone: { not: null } }, select: { phone: true }, take: 500 }),
    db.notificationPhone.findMany({ where: { organizationId }, select: { phone: true }, take: 50 }),
  ]);
  return [...workers.map((w) => w.phone), ...extras.map((x) => x.phone)].some((p) => p && toE164(p) === phone);
}
