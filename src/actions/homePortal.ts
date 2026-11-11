"use server";

// What a homeowner can DO from their home dashboard (lib/home/portal, 2026-10-03).
// Public like the intake: the key in the URL is the authorization, so every
// action resolves the home through the key and nothing else, and each carries
// its own brake.

import { z } from "zod";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { orgReplyTo } from "@/lib/email/orgSend";
import { buildHomeLink, buildHomeownerMessage, buildHomePlanSaved } from "@/lib/email/build/platform";
import { enforceRateLimit, clientIp, HOUR, RateLimitError } from "@/lib/rateLimit";
import { findHomeByKey, homeUrl, HOME_TZ_DEFAULT } from "@/lib/home/portal";
import { planDate, planWhen, reminderFor, remindModeOf, validTimeZone, type RemindMode } from "@/lib/home/dates";

export type HomeActionResult = { ok: true; note: string } | { ok: false; error: string };

const key = z.string().min(8).max(200);

async function brake(k: string, max: number, what: string): Promise<string | null> {
  try {
    await enforceRateLimit(k, max, HOUR, what);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return err.message;
    throw err;
  }
}

/** "Lost the link?" — the dashboard link goes to the email, never on screen,
 *  and the answer is the same whether or not a home exists for it. */
export async function emailHomeLink(raw: unknown): Promise<HomeActionResult> {
  const email = z.string().trim().toLowerCase().email().max(200).parse(raw);
  const braked = (await brake(`home-link:${email}`, 3, "link emails")) ?? (await brake(`home-link-ip:${await clientIp()}`, 12, "link emails"));
  if (braked) return { ok: false, error: braked };
  const home = await db.home.findUnique({ where: { email }, select: { name: true, accessToken: true, _count: { select: { leads: true } } } });
  if (home) {
    try {
      const { subject, html } = renderEmail(buildHomeLink({ name: home.name, homeUrl: await homeUrl(home.accessToken), projects: home._count.leads }));
      // Asked for by the person: their sign-in link (transactional, lib/mailBlockShared).
      await sendEmail({ mailClass: "transactional", to: email, subject, html, kind: "otp" });
    } catch (err) {
      console.error("[home] link email failed:", err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, note: `If we have a home dashboard for ${email}, its link is on the way.` };
}

/** "Email me this link" on the dashboard itself — the key is already in hand. */
export async function emailMyHomeLink(raw: unknown): Promise<HomeActionResult> {
  const k = key.parse(raw);
  const home = await db.home.findUnique({ where: { accessToken: k }, select: { name: true, email: true, accessToken: true, _count: { select: { leads: true } } } });
  if (!home) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-link:${home.email}`, 3, "link emails");
  if (braked) return { ok: false, error: braked };
  try {
    const { subject, html } = renderEmail(buildHomeLink({ name: home.name, homeUrl: await homeUrl(home.accessToken), projects: home._count.leads }));
    await sendEmail({ mailClass: "transactional", to: home.email, subject, html, kind: "otp" });
  } catch (err) {
    console.error("[home] link email failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't send the email right now — try again in a minute." };
  }
  return { ok: true, note: `Sent to ${home.email}.` };
}

const detailsInput = z.object({
  key,
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(16).optional(),
});

/** The homeowner's own details, as the next request will be prefilled. The email stays — it is the identity. */
export async function updateHomeDetails(raw: unknown): Promise<HomeActionResult> {
  const data = detailsInput.parse(raw);
  const home = await findHomeByKey(data.key);
  if (!home) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-details:${home.id}`, 20, "changes");
  if (braked) return { ok: false, error: braked };
  await db.home.update({
    where: { id: home.id },
    data: { name: data.name, phone: data.phone || null, address: data.address || null, city: data.city || null, state: data.state || null, zip: data.zip || null },
  });
  return { ok: true, note: "Saved. Your next project starts with these." };
}

const remindMode = z.enum(["start", "2w", "1w", "none"]);
const planInput = z.object({
  key,
  title: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1000).optional(),
  /** "2026-11" for a whole month, "2026-11-14" for a day. */
  when: z.string().trim().min(7).max(10),
  /** When to remind (lib/home/dates REMIND_MODES); the start of the month unless said. */
  remind: remindMode.optional(),
});

const remindOnWords = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

/** A project the homeowner means to do: on the calendar, reminded about when its time comes. */
export async function addHomePlan(raw: unknown): Promise<HomeActionResult & { id?: string }> {
  const data = planInput.parse(raw);
  const home = await findHomeByKey(data.key);
  if (!home) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-plan:${home.id}`, 40, "plans");
  if (braked) return { ok: false, error: braked };
  const wholeMonth = data.when.length === 7;
  const plannedFor = planDate(data.when, wholeMonth);
  if (!plannedFor) return { ok: false, error: "Pick a month or a day for it." };
  const open = await db.homePlan.count({ where: { homeId: home.id, status: "PLANNED" } });
  if (open >= 30) return { ok: false, error: "Thirty plans is plenty — submit or drop one first." };
  const tz = home.timezone && validTimeZone(home.timezone) ? home.timezone : HOME_TZ_DEFAULT;
  const mode: RemindMode = data.remind ?? "start";
  const remindAt = reminderFor(plannedFor, tz, new Date(), mode);
  const plan = await db.homePlan.create({
    data: { homeId: home.id, title: data.title, notes: data.notes || null, plannedFor, wholeMonth, remindAt },
  });
  // Said back by email at once: what was planned, and when the nudge comes.
  const remindOn = remindOnWords(remindAt);
  try {
    const { subject, html } = renderEmail(buildHomePlanSaved({ name: home.name, title: data.title, when: planWhen(plannedFor, wholeMonth), remindOn, notes: data.notes || null, homeUrl: await homeUrl(home.accessToken) }));
    await sendEmail({ mailClass: "transactional", to: home.email, subject, html });
  } catch (err) {
    console.warn("[home] plan-saved email failed:", err instanceof Error ? err.message : err);
  }
  return { ok: true, id: plan.id, note: remindOn ? `Planned for ${planWhen(plannedFor, wholeMonth)} — we'll email you on ${remindOn}, and we've sent you a note now.` : `Planned for ${planWhen(plannedFor, wholeMonth)} — no reminder, as you chose.` };
}

const planEdit = z.object({
  key,
  id: z.string().min(1).max(60),
  title: z.string().trim().min(2).max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  when: z.string().trim().min(7).max(10).optional(),
  remind: remindMode.optional(),
  status: z.enum(["PLANNED", "DONE", "DROPPED"]).optional(),
});

export async function updateHomePlan(raw: unknown): Promise<HomeActionResult> {
  const data = planEdit.parse(raw);
  const home = await findHomeByKey(data.key);
  if (!home) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-plan:${home.id}`, 40, "changes");
  if (braked) return { ok: false, error: braked };
  const plan = await db.homePlan.findFirst({ where: { id: data.id, homeId: home.id } });
  if (!plan) return { ok: false, error: "That plan is gone." };
  const tz = home.timezone && validTimeZone(home.timezone) ? home.timezone : HOME_TZ_DEFAULT;
  const patch: { title?: string; notes?: string | null; plannedFor?: Date; wholeMonth?: boolean; remindAt?: Date | null; remindedAt?: Date | null; status?: string } = {};
  if (data.title) patch.title = data.title;
  if (data.notes !== undefined) patch.notes = data.notes || null;
  let plannedFor = plan.plannedFor;
  if (data.when) {
    const wholeMonth = data.when.length === 7;
    const moved = planDate(data.when, wholeMonth);
    if (!moved) return { ok: false, error: "Pick a month or a day for it." };
    plannedFor = moved;
    patch.plannedFor = moved;
    patch.wholeMonth = wholeMonth;
  }
  // A moved plan, or a new choice of reminder, starts the reminders over.
  if (data.when || data.remind) {
    const mode: RemindMode = data.remind ?? remindModeOf(plan.plannedFor, plan.remindAt);
    patch.remindAt = reminderFor(plannedFor, tz, new Date(), mode);
    patch.remindedAt = null;
  }
  if (data.status) patch.status = data.status;
  await db.homePlan.update({ where: { id: plan.id }, data: patch });
  const remindOn = patch.remindAt !== undefined ? remindOnWords(patch.remindAt) : null;
  return { ok: true, note: data.status === "DONE" ? "Marked done." : data.status === "DROPPED" ? "Removed from your plans." : data.remind || data.when ? (remindOn ? `Saved — we'll email you on ${remindOn}.` : "Saved — no reminder.") : "Saved." };
}

const messageInput = z.object({
  key,
  /** The request's own token: which project, and so which contractor. */
  token: z.string().min(8).max(200),
  body: z.string().trim().min(2).max(1500),
});

/** A message to the contractor on a project: emailed to the shop with the
 *  homeowner as reply-to, noted on the shop's lead, kept on the dashboard. */
export async function sendHomeMessage(raw: unknown): Promise<HomeActionResult> {
  const data = messageInput.parse(raw);
  const home = await findHomeByKey(data.key);
  if (!home) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-msg:${home.id}`, 12, "messages");
  if (braked) return { ok: false, error: braked };
  const pl = await db.platformLead.findFirst({ where: { accessToken: data.token, homeId: home.id } });
  if (!pl) return { ok: false, error: "That project isn't on this dashboard." };
  if (pl.status !== "MATCHED" || !pl.matchedOrgId) return { ok: false, error: "No contractor is on this project yet — once one is matched, your message goes to them." };
  const org = await db.organization.findUnique({ where: { id: pl.matchedOrgId }, select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true, deletedAt: true } });
  if (!org || org.deletedAt) return { ok: false, error: "That contractor is no longer on JobFlex." };
  const to = orgReplyTo(org);
  const project = `${pl.detectedTrade ?? pl.projectType ?? "project"} in ${[pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || "your area"}`;
  let emailed = false;
  if (to) {
    try {
      const appUrl = await appBaseUrl();
      const { subject, html } = renderEmail(
        buildHomeownerMessage({ homeownerName: home.name, orgName: org.name, project, body: data.body, leadUrl: pl.matchedLeadId ? `${appUrl}/dashboard/leads/${pl.matchedLeadId}` : `${appUrl}/dashboard/leads` }),
      );
      await sendEmail({ mailClass: "transactional", to, subject, html, replyTo: home.email });
      emailed = true;
    } catch (err) {
      console.error("[home] message email failed:", err instanceof Error ? err.message : err);
    }
  }
  await db.homeMessage.create({ data: { homeId: home.id, platformLeadId: pl.id, organizationId: org.id, body: data.body, emailed } });
  // A line on the shop's lead too, so the office sees it where they work.
  if (pl.matchedLeadId) {
    await db.activityEvent
      .create({ data: { organizationId: org.id, leadId: pl.matchedLeadId, kind: "NOTE", summary: `${home.name} wrote from their home dashboard: “${data.body.slice(0, 180)}${data.body.length > 180 ? "…" : ""}”` } })
      .catch(() => null);
  }
  return { ok: true, note: emailed ? `Sent to ${org.name}. They can reply straight to your email.` : `Kept on your project — ${org.name} will see it on their lead.` };
}
