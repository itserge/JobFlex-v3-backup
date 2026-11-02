// ONLINE BOOKING — THE BOOK (2026-09-23), server only. The rules live in
// lib/booking; this is what touches the database: the shop's settings, what
// is already on the calendar, a visit booked by a customer (a client the
// shop knows, or a new lead), the appointment it becomes, the manage link,
// confirmations and reminders.

import { db } from "@/lib/db";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import type { EmailDoc } from "@/lib/email/doc";
import { appBaseUrl } from "@/lib/appUrl";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { buildBookedOnline } from "@/lib/email/build/operator";
import { afterResponse } from "@/lib/server-events";
import { textAppointmentBooked, textAppointmentCancelled, textAppointmentMoved as textVisitMoved, visitFacts } from "@/lib/sms/schedule";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { toE164 } from "@/lib/phone";
import { aptSourceKey, bookingNoteHead, type AptSource } from "@/lib/calendar/visitVia";
import { deskHoursKey, parseDeskHours, reservedSlots, type DeskDaySlots, type DeskHours } from "@/lib/deskHours";
import { availableSlots, bookingScope, parseBookingSettings, slotLabel, type BookingService, type BookingSettings, type Busy, type DaySlots } from "@/lib/booking";

const ORG_SELECT = { id: true, name: true, slug: true, timezone: true, logoUrl: true, phone: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, tradeTypesJson: true, bookingSettingsJson: true } as const;
type OrgRow = { id: string; name: string | null; slug: string; timezone: string; logoUrl: string | null; phone: string | null; billingEmail: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; tradeTypesJson: string | null; bookingSettingsJson: string | null };
const DAY = 86400000;

export function settingsOf(org: { tradeTypesJson: string | null; bookingSettingsJson: string | null }): BookingSettings {
  return parseBookingSettings(org.bookingSettingsJson, parseTradeTypes(org.tradeTypesJson));
}

export async function orgBySlug(slug: string): Promise<OrgRow | null> {
  return db.organization.findUnique({ where: { slug }, select: ORG_SELECT });
}

/** Everything that already takes the crew's time between two instants. */
export async function busyBetween(organizationId: string, from: Date, to: Date): Promise<Busy[]> {
  const [appts, jobs, blocks] = await Promise.all([
    db.appointment.findMany({ where: { organizationId, status: { notIn: ["CANCELED", "NO_SHOW"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
    db.job.findMany({ where: { organizationId, status: { notIn: ["CANCELED", "DONE", "COMPLETED"] }, startsAt: { not: null, lt: to }, endsAt: { not: null, gt: from } }, select: { startsAt: true, endsAt: true } }),
    db.blockedTime.findMany({ where: { organizationId, ownerId: null, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
  ]);
  return [...appts, ...blocks, ...jobs.map((j) => ({ startsAt: j.startsAt!, endsAt: j.endsAt! }))];
}

/** The client the shop knows by this email, whatever its case (SQLite on the stand has no insensitive mode). */
async function clientByEmail(organizationId: string, email: string): Promise<{ id: string; name: string } | null> {
  const exact = await db.client.findFirst({ where: { organizationId, deletedAt: null, email }, select: { id: true, name: true } });
  if (exact) return exact;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const same = await db.client.findMany({ where: { organizationId, deletedAt: null, email: { endsWith: email.slice(at) } }, select: { id: true, name: true, email: true }, take: 50 });
  const hit = same.find((c) => (c.email ?? "").toLowerCase() === email);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** A client the shop knows by this number (the AI desk's caller has a number, rarely an email). */
async function clientByPhone(organizationId: string, phone: string): Promise<{ id: string; name: string } | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  const same = await db.client.findMany({ where: { organizationId, deletedAt: null, phone: { contains: e164.slice(-4) } }, select: { id: true, name: true, phone: true }, take: 25 });
  const hit = same.find((c) => toE164(c.phone ?? "") === e164);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** An open lead with this number — the caller who left a message yesterday and calls back to book. */
async function openLeadByPhone(organizationId: string, phone: string): Promise<{ id: string } | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  const same = await db.lead.findMany({ where: { organizationId, status: { notIn: ["WON", "LOST", "ARCHIVED"] }, phone: { contains: e164.slice(-4) } }, orderBy: { createdAt: "desc" }, select: { id: true, phone: true }, take: 25 });
  const hit = same.find((l) => toE164(l.phone ?? "") === e164);
  return hit ? { id: hit.id } : null;
}

export async function availabilityFor(org: OrgRow, service: BookingService, now = new Date()): Promise<DaySlots[]> {
  const settings = settingsOf(org);
  const busy = await busyBetween(org.id, new Date(now.getTime() - DAY), new Date(now.getTime() + (settings.horizonDays + 2) * DAY));
  return availableSlots({ settings, service, busy, timeZone: org.timezone || "America/New_York", now });
}

// ── the AI desk's hours (lib/deskHours) ─────────────────────────────────────

export async function readDeskHours(organizationId: string): Promise<DeskHours> {
  const row = await db.syncState.findUnique({ where: { key: deskHoursKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  return parseDeskHours(row?.cursor);
}

/**
 * What already takes each person's time: visits assigned to them or that they made, jobs they're on, their own
 * blocked time — and the company's blocks, which take everyone's.
 */
export async function personBusy(organizationId: string, userIds: readonly string[], from: Date, to: Date): Promise<Map<string, Busy[]>> {
  const out = new Map<string, Busy[]>(userIds.map((u) => [u, []]));
  if (!userIds.length) return out;
  const profiles = await db.workerProfile.findMany({ where: { organizationId, userId: { in: [...userIds] } }, select: { id: true, userId: true } });
  const workerOf = new Map(profiles.map((p) => [p.id, p.userId]));
  const workerIds = profiles.map((p) => p.id);
  const live = { status: { notIn: ["CANCELED", "NO_SHOW"] }, startsAt: { lt: to }, endsAt: { gt: from } };
  const [appts, blocks, jobs] = await Promise.all([
    db.appointment.findMany({ where: { organizationId, ...live, OR: [{ createdById: { in: [...userIds] } }, ...(workerIds.length ? [{ assignments: { some: { workerId: { in: workerIds } } } }] : [])] }, select: { startsAt: true, endsAt: true, createdById: true, assignments: { select: { workerId: true } } } }),
    db.blockedTime.findMany({ where: { organizationId, startsAt: { lt: to }, endsAt: { gt: from }, OR: [{ ownerId: null }, { ownerId: { in: [...userIds] } }] }, select: { startsAt: true, endsAt: true, ownerId: true } }),
    workerIds.length
      ? db.job.findMany({ where: { organizationId, status: { notIn: ["CANCELED", "DONE", "COMPLETED"] }, startsAt: { not: null, lt: to }, endsAt: { not: null, gt: from }, assignments: { some: { workerId: { in: workerIds } } } }, select: { startsAt: true, endsAt: true, assignments: { select: { workerId: true } } } })
      : Promise.resolve([] as Array<{ startsAt: Date | null; endsAt: Date | null; assignments: Array<{ workerId: string }> }>),
  ]);
  const add = (u: string | null | undefined, b: Busy) => { if (u && out.has(u)) out.get(u)!.push(b); };
  for (const a of appts) {
    const who = new Set<string>([...(a.createdById ? [a.createdById] : []), ...a.assignments.map((x) => workerOf.get(x.workerId)).filter((x): x is string => !!x)]);
    for (const u of who) add(u, { startsAt: a.startsAt, endsAt: a.endsAt });
  }
  for (const b of blocks) {
    if (b.ownerId) add(b.ownerId, b);
    else for (const u of userIds) add(u, b);
  }
  for (const j of jobs) for (const x of j.assignments) add(workerOf.get(x.workerId), { startsAt: j.startsAt!, endsAt: j.endsAt! });
  return out;
}

/**
 * The times the AI desk can offer: the open hours (as the booking page has them), or — when the company chose
 * reserved hours — only inside what was reserved, each time carrying whose it is.
 */
export async function deskAvailabilityFor(org: OrgRow, service: BookingService, now = new Date()): Promise<{ mode: DeskHours["mode"]; days: DeskDaySlots[] }> {
  const hours = await readDeskHours(org.id);
  if (hours.mode !== "reserved") {
    const days = await availabilityFor(org, service, now);
    return { mode: "open-hours", days: days.map((d) => ({ ...d, slots: d.slots.map((x) => ({ ...x, userId: null, windowId: "" })) })) };
  }
  const settings = settingsOf(org);
  const from = new Date(now.getTime() - DAY);
  const to = new Date(now.getTime() + (settings.horizonDays + 2) * DAY);
  const people = Array.from(new Set(hours.windows.map((w) => w.userId).filter((u): u is string => !!u)));
  const [orgBusy, busy] = await Promise.all([busyBetween(org.id, from, to), personBusy(org.id, people, from, to)]);
  const days = reservedSlots({ settings, service, windows: hours.windows, orgBusy, busyOf: (u) => busy.get(u) ?? [], timeZone: org.timezone || "America/New_York", now });
  return { mode: "reserved", days };
}

export async function emailCustomer(org: OrgRow, to: string | null | undefined, doc: Omit<EmailDoc, "lockup" | "footer">): Promise<boolean> {
  if (!to) return false;
  try {
    const name = org.name ?? "Your contractor";
    const { subject, html } = renderEmail({ ...doc, lockup: { kind: "org", name, logoUrl: org.logoUrl }, footer: { name, contact: org.phone ?? org.billingEmail ?? undefined } });
    const r = await sendOrgEmail(org, { to, subject, html });
    return !!r && (r as { ok?: boolean }).ok !== false;
  } catch (err) {
    console.warn(`[booking] email not sent: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export interface NewBooking {
  serviceKey: string;
  startsAtISO: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  answers: Array<{ key: string; label: string; value: string }>;
  /** Who booked: the customer on the booking page (default), the AI desk on a call, or SmartBook with a new lead. */
  channel?: "online" | "ai-desk" | "smartbook";
  /** The desk's call, kept with the visit so the calendar can point back to it. */
  callSid?: string | null;
  /** SmartBook: the lead the visit is for (it already exists — no client match, no new lead). */
  leadId?: string | null;
  /** SmartBook: the company said yes to this exact time, so it is booked even outside the open slots. */
  confirmed?: boolean;
}

export interface BookingReceipt {
  ok: true;
  manageToken: string;
  when: string;
  serviceLabel: string;
  member: boolean;
  priceText: string;
  arrivalWindow: number;
}

/**
 * A customer books: the slot is checked against the calendar again, the
 * customer is matched to a client the shop knows (by email) or becomes a
 * lead with the booking as its scope, the appointment lands on the
 * calendar, the office hears, the customer gets the confirmation with the
 * manage link. A member (an active plan on the matched client) gets the
 * member price on the receipt.
 */
export async function createBooking(org: OrgRow, input: NewBooking, now = new Date()): Promise<BookingReceipt | { ok: false; error: string }> {
  const settings = settingsOf(org);
  if (!settings.enabled) return { ok: false, error: "Online booking is off for this company right now — please call." };
  const service = settings.services.find((s) => s.key === input.serviceKey);
  if (!service) return { ok: false, error: "That service is no longer offered online." };
  const startsAt = new Date(input.startsAtISO);
  if (!Number.isFinite(startsAt.getTime())) return { ok: false, error: "Pick a time." };
  const channel = input.channel === "ai-desk" || input.channel === "smartbook" ? input.channel : "online";
  const desk = channel === "ai-desk";
  const smart = channel === "smartbook";
  // SmartBook books onto the lead it is talking with (lib/smartbook, 2026-10-31).
  const ownLead = smart && input.leadId ? await db.lead.findFirst({ where: { id: input.leadId, organizationId: org.id }, select: { id: true } }) : null;
  if (smart && !ownLead) return { ok: false, error: "That lead is no longer on file." };
  // The desk and SmartBook book from the desk's hours (open hours, or only what was reserved); the booking page from
  // the open hours. A time the company confirmed by name is booked as it stands.
  const days: DeskDaySlots[] = smart && input.confirmed ? [] : desk || smart ? (await deskAvailabilityFor(org, service, now)).days : (await availabilityFor(org, service, now)).map((d) => ({ ...d, slots: d.slots.map((x) => ({ ...x, userId: null, windowId: "" })) }));
  const slot = smart && input.confirmed ? { startsAt, endsAt: new Date(startsAt.getTime() + service.minutes * 60000), userId: null, windowId: "" } : days.flatMap((d) => d.slots).find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) return { ok: false, error: "That time was just taken — please pick another." };
  // A person's reserved hours: the visit is theirs — on their calendar (assigned, or made in their name when they have
  // no crew profile), and in the text the office gets.
  const owner = slot.userId ? await db.workerProfile.findFirst({ where: { organizationId: org.id, userId: slot.userId }, select: { id: true } }) : null;
  const tz = org.timezone || "America/New_York";
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  // A caller is matched by their number (the desk rarely has an email); a web
  // booking only by email — a number typed into a form proves nothing.
  const client = smart ? null : (email ? await clientByEmail(org.id, email) : null) ?? (desk && phone ? await clientByPhone(org.id, phone) : null);
  const knownLead = !client && desk && phone ? await openLeadByPhone(org.id, phone) : null;
  const memberPlan = client ? await db.servicePlan.findFirst({ where: { organizationId: org.id, clientId: client.id, status: "ACTIVE" }, select: { name: true } }) : null;
  const member = !!memberPlan;
  const scope = bookingScope(service, input.answers.map((a) => ({ label: a.label, value: a.value })), input.notes, channel);
  const when = slotLabel(slot, tz, settings.arrivalWindow);
  const priceText = member && service.memberPriceText ? service.memberPriceText : service.priceText;
  let manageToken = "";
  let bookedAppointmentId: string | null = null;
  await db.$transaction(async (tx) => {
    let leadId: string | null = knownLead?.id ?? ownLead?.id ?? null;
    // A caller with an open lead: what the desk learned on this call joins what the lead already says.
    if (knownLead) {
      const cur = await tx.lead.findUnique({ where: { id: knownLead.id }, select: { scope: true, description: true, email: true } });
      if (cur && !(cur.scope ?? "").includes(scope)) {
        await tx.lead.update({ where: { id: knownLead.id }, data: { scope: [cur.scope, scope].filter(Boolean).join("\n\n").slice(0, 20000), ...(cur.description ? {} : { description: scope }), ...(!cur.email && email ? { email } : {}) } });
      }
    }
    if (!client && !leadId) {
      const lead = await tx.lead.create({
        data: { organizationId: org.id, name: input.name, email, phone, address: input.address?.trim() || null, projectType: service.label, description: scope, scope, source: desk ? "AI_DESK" : "BOOKING", status: "NEW", aiCategory: service.trade },
        select: { id: true },
      });
      leadId = lead.id;
    }
    const appt = await tx.appointment.create({
      data: {
        organizationId: org.id,
        clientId: client?.id ?? null,
        leadId,
        ...(slot.userId && !owner ? { createdById: slot.userId } : {}),
        ...(owner ? { assignments: { create: { workerId: owner.id } } } : {}),
        title: `${service.label} — ${input.name}`,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: "SCHEDULED",
        notes: [bookingNoteHead(channel, priceText, member ? memberPlan!.name : null), input.phone ? `Phone ${input.phone}` : null, input.address ? `Address ${input.address}` : null, "", scope].filter((x) => x !== null).join("\n"),
      },
      select: { id: true },
    });
    const booking = await tx.booking.create({
      data: { organizationId: org.id, appointmentId: appt.id, leadId, clientId: client?.id ?? null, serviceKey: service.key, serviceLabel: service.label, minutes: service.minutes, name: input.name, email: desk ? null : email, phone: input.phone?.trim() || null, address: input.address?.trim() || null, notes: input.notes?.trim() || null, answersJson: JSON.stringify(input.answers), member, startsAt: slot.startsAt, endsAt: slot.endsAt },
      select: { manageToken: true },
    });
    manageToken = booking.manageToken;
    bookedAppointmentId = appt.id;
    // How it was booked, beside the appointment (no schema change) — the
    // calendar reads it to tag the visit (lib/calendar/visitVia).
    const marker: AptSource = { channel, callSid: desk ? input.callSid?.trim().slice(0, 64) || null : null, at: now.toISOString() };
    await tx.syncState.upsert({ where: { key: aptSourceKey(appt.id) }, create: { key: aptSourceKey(appt.id), cursor: JSON.stringify(marker) }, update: { cursor: JSON.stringify(marker) } });
    const tail = member ? " · member" : knownLead ? " · lead on file" : leadId ? " · new lead" : "";
    const summary = desk ? `The AI desk booked ${input.name} for ${service.label.toLowerCase()} on a call — ${when}${tail}` : smart ? `SmartBook booked ${input.name} for ${service.label.toLowerCase()} — ${when}` : `${input.name} booked ${service.label.toLowerCase()} — ${when}${tail}`;
    await tx.activityEvent.create({ data: { organizationId: org.id, kind: "BOOKING_NEW", clientId: client?.id ?? null, leadId, summary, meta: JSON.stringify({ href: "/dashboard/booking", appointmentId: appt.id, channel }) } });
  });
  // The office hears about it by text (2026-09-29): "Booked: … · online."
  // A desk booking says so: "Booked: … · by the AI desk."
  if (bookedAppointmentId) {
    const id = bookedAppointmentId;
    afterResponse(() => textAppointmentBooked(id, null, desk ? "the AI desk" : smart ? "SmartBook" : "online"));
  }
  // And by email (owner, 2026-10-28): a booking from the page mails every office member who keeps "Booked online"
  // on — the Blueprint office mail (email/build/operator → buildBookedOnline), after the response like the text.
  if (bookedAppointmentId && !desk) {
    const href = smart && ownLead ? `${await appBaseUrl()}/dashboard/leads/${ownLead.id}` : `${await appBaseUrl()}/dashboard/booking`;
    afterResponse(() =>
      sendToMembersByPref(
        org.id,
        "booking-online",
        buildBookedOnline({
          org: { name: org.name ?? "Your company", logoUrl: org.logoUrl, phone: org.phone },
          name: input.name,
          service: service.label,
          when,
          price: priceText,
          phone,
          email,
          address: input.address?.trim() || null,
          answers: input.answers,
          notes: input.notes?.trim() || null,
          who: member ? "member" : client ? "client" : "lead",
          href,
          ...(smart ? { via: "smartbook" as const } : {}),
        }),
      ).then(() => undefined),
    );
  }
  const manageHref = `${await appBaseUrl()}/book/manage/${manageToken}`;
  // A desk booking was read back on the call. Its email was heard, not typed — a misheard address would send the
  // visit's details to a stranger, so it is kept on the lead only: no confirmation, and the booking row has no email
  // for the day-before reminder to use.
  if (!desk) await emailCustomer(org, email, {
    subject: `Booked: ${service.label} — ${when}`,
    kicker: { text: "Your visit", tone: "ok" },
    headline: when,
    prose: [`Thank you, ${input.name.split(" ")[0]}. ${org.name ?? "We"} will be there for your ${service.label.toLowerCase()}.${settings.arrivalWindow ? ` The technician arrives inside that window and calls on the way.` : ""}`, `Price: ${priceText}.`],
    box: [{ type: "field", label: "Service", value: service.label }, ...(input.address ? [{ type: "field" as const, label: "Address", value: input.address }] : []), ...input.answers.filter((a) => a.value).map((a) => ({ type: "field" as const, label: a.label, value: a.value }))],
    cta: { label: "Change or cancel this visit", href: manageHref },
    after: ["Please make sure the equipment is reachable — the indoor unit, the outdoor unit and the electrical panel."],
  });
  return { ok: true, manageToken, when, serviceLabel: service.label, member, priceText, arrivalWindow: settings.arrivalWindow };
}

export async function bookingByToken(token: string) {
  return db.booking.findUnique({ where: { manageToken: token }, include: { organization: { select: ORG_SELECT }, appointment: { select: { id: true, status: true } } } });
}

/** `checked`: SmartBook moved it to a time it found open in the desk's hours (or the company confirmed) — no second look. */
export async function rescheduleBooking(token: string, startsAtISO: string, now = new Date(), opts: { checked?: boolean } = {}): Promise<{ ok: boolean; error?: string; when?: string }> {
  const b = await bookingByToken(token);
  if (!b || b.status === "CANCELED") return { ok: false, error: "This visit can no longer be changed." };
  const settings = settingsOf(b.organization);
  const service = settings.services.find((s) => s.key === b.serviceKey) ?? { key: b.serviceKey, label: b.serviceLabel, kind: "other" as const, minutes: b.minutes, priceText: "", trade: "" };
  const startsAt = new Date(startsAtISO);
  const days = opts.checked ? [] : await availabilityFor(b.organization, service, now);
  const slot = opts.checked && Number.isFinite(startsAt.getTime()) ? { startsAt, endsAt: new Date(startsAt.getTime() + b.minutes * 60000) } : days.flatMap((d) => d.slots).find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) return { ok: false, error: "That time is not open — pick another." };
  const tz = b.organization.timezone || "America/New_York";
  const when = slotLabel(slot, tz, settings.arrivalWindow);
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { startsAt: slot.startsAt, endsAt: slot.endsAt, status: "RESCHEDULED", remindedAt: null } });
    if (b.appointmentId) await tx.appointment.update({ where: { id: b.appointmentId }, data: { startsAt: slot.startsAt, endsAt: slot.endsAt, status: "SCHEDULED" } });
    await tx.activityEvent.create({ data: { organizationId: b.organizationId, kind: "BOOKING_MOVED", clientId: b.clientId, leadId: b.leadId, summary: `${b.name} moved their ${b.serviceLabel.toLowerCase()} to ${when}`, meta: JSON.stringify({ href: "/dashboard/booking", appointmentId: b.appointmentId }) } });
  });
  if (b.appointmentId) {
    const id = b.appointmentId;
    const was = b.startsAt;
    afterResponse(() => textVisitMoved(id, was, null));
  }
  await emailCustomer(b.organization, b.email, { subject: `Moved: ${b.serviceLabel} — ${when}`, kicker: { text: "Your visit" }, headline: when, prose: [`Your ${b.serviceLabel.toLowerCase()} with ${b.organization.name ?? "us"} is now ${when}.`], cta: { label: "Change or cancel this visit", href: `${await appBaseUrl()}/book/manage/${b.manageToken}` } });
  return { ok: true, when };
}

export async function cancelBooking(token: string): Promise<{ ok: boolean }> {
  const b = await bookingByToken(token);
  if (!b || b.status === "CANCELED") return { ok: false };
  const visit = b.appointmentId ? await visitFacts(b.appointmentId).catch(() => null) : null;
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELED", canceledAt: new Date() } });
    if (b.appointmentId) await tx.appointment.update({ where: { id: b.appointmentId }, data: { status: "CANCELED" } });
    await tx.activityEvent.create({ data: { organizationId: b.organizationId, kind: "BOOKING_CANCELED", clientId: b.clientId, leadId: b.leadId, summary: `${b.name} canceled their ${b.serviceLabel.toLowerCase()}`, meta: JSON.stringify({ href: "/dashboard/booking" }) } });
  });
  afterResponse(() => textAppointmentCancelled(visit, null, "online"));
  await emailCustomer(b.organization, b.email, { subject: `Canceled: ${b.serviceLabel}`, kicker: { text: "Your visit" }, headline: "Your visit is canceled", prose: [`We have taken your ${b.serviceLabel.toLowerCase()} off the calendar. Book again any time.`], link: { label: "Book a visit", href: `${await appBaseUrl()}/book/${b.organization.slug}` } });
  return { ok: true };
}

/** The day before: one reminder to the customer. Runs from the daily cron. */
export async function runBookingReminders(now = new Date()): Promise<{ reminded: number }> {
  const soon = new Date(now.getTime() + 36 * 3600000);
  const rows = await db.booking.findMany({ where: { status: { in: ["BOOKED", "RESCHEDULED"] }, remindedAt: null, startsAt: { gte: now, lte: soon } }, include: { organization: { select: ORG_SELECT } } });
  let reminded = 0;
  for (const b of rows) {
    try {
      const settings = settingsOf(b.organization);
      const when = slotLabel({ startsAt: b.startsAt, endsAt: b.endsAt }, b.organization.timezone || "America/New_York", settings.arrivalWindow);
      await db.booking.update({ where: { id: b.id }, data: { remindedAt: now } });
      if (await emailCustomer(b.organization, b.email, { subject: `Tomorrow: ${b.serviceLabel} — ${when}`, kicker: { text: "Your visit" }, headline: when, prose: [`A reminder from ${b.organization.name ?? "us"}: your ${b.serviceLabel.toLowerCase()} is ${when}. The technician calls on the way.`], cta: { label: "Change or cancel", href: `${await appBaseUrl()}/book/manage/${b.manageToken}` } })) reminded++;
    } catch (err) {
      console.error(`[booking] reminder ${b.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { reminded };
}

// ── the office ──────────────────────────────────────────────────────────────

export interface BookingDashboard {
  settings: BookingSettings;
  trades: string[];
  link: string;
  slug: string;
  timeZone: string;
  upcoming: Array<{ id: string; when: Date; name: string; serviceLabel: string; member: boolean; status: string; phone: string | null; email: string | null; address: string | null; clientId: string | null; leadId: string | null; appointmentId: string | null; manageToken: string; answers: Array<{ label: string; value: string }>; notes: string | null }>;
  stats: { thisWeek: number; next30: number; services: number; allTime: number };
}

export async function loadBookingDashboard(organizationId: string, now = new Date()): Promise<BookingDashboard> {
  const [org, rows, allTime, appUrl] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT }),
    db.booking.findMany({ where: { organizationId, startsAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { startsAt: "asc" }, take: 60 }),
    db.booking.count({ where: { organizationId } }),
    appBaseUrl(),
  ]);
  if (!org) throw new Error("No organization");
  const settings = settingsOf(org);
  const week = new Date(now.getTime() + 7 * DAY);
  const month = new Date(now.getTime() + 30 * DAY);
  const live = rows.filter((b) => b.status !== "CANCELED");
  return {
    settings,
    trades: parseTradeTypes(org.tradeTypesJson),
    link: `${appUrl}/book/${org.slug}`,
    slug: org.slug,
    timeZone: org.timezone || "America/New_York",
    upcoming: rows.map((b) => ({ id: b.id, when: b.startsAt, name: b.name, serviceLabel: b.serviceLabel, member: b.member, status: b.status, phone: b.phone, email: b.email, address: b.address, clientId: b.clientId, leadId: b.leadId, appointmentId: b.appointmentId, manageToken: b.manageToken, answers: parseAnswers(b.answersJson), notes: b.notes })),
    stats: { thisWeek: live.filter((b) => b.startsAt <= week && b.startsAt >= now).length, next30: live.filter((b) => b.startsAt <= month && b.startsAt >= now).length, services: settings.services.length, allTime },
  };
}
const parseAnswers = (json: string): Array<{ label: string; value: string }> => {
  try {
    const v = JSON.parse(json) as Array<{ label?: string; value?: string }>;
    return Array.isArray(v) ? v.filter((a) => a && typeof a.label === "string" && typeof a.value === "string").map((a) => ({ label: a.label!, value: a.value! })) : [];
  } catch {
    return [];
  }
};

export async function saveSettings(organizationId: string, next: BookingSettings): Promise<void> {
  await db.organization.update({ where: { id: organizationId }, data: { bookingSettingsJson: JSON.stringify(next) } });
}
