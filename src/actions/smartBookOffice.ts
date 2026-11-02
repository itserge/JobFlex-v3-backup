"use server";

// SMARTBOOK · THE COMPANY'S ACTIONS (2026-10-31, Batch 3). Signed in, org-scoped — the public token pages' actions
// stay in ./smartBook.ts.
//
//   Settings → SmartBook   load, save, "Send me a test"           managers (requireManager)
//   the calendar's Requests and the lead page: answer a request, Pause, Restart, Offer times
//                                                                 managers and sales reps, a rep on their own leads
//                                                                 only (the lead page's rule: theirs, or still NEW)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { isSalesRole, NoOrgError, requireManager, requireSalesOrManager, UnauthorizedError } from "@/lib/orgContext";
import { prettyPhone } from "@/lib/aiDesk/shared";
import { smsAllowanceUsed } from "@/lib/sms/send";
import { getMetaConnection } from "@/lib/meta/connections";
import { ensureMetaAutoImport, metaConsentSummary } from "@/lib/meta/autoImport";
import { parseMetaSettings } from "@/lib/settings";
import { decideRequest, offerTimesByHand, pauseSmartBook, readSmartBookSettings, restartSmartBook, saveSmartBookSettings, smartBookPreview, startSmartBookTest, type Decision, type SmartBookPreview } from "@/lib/smartbook/engine";
import { leadSmartBook, smartBookRequests, type LeadSmartBook, type RequestCard } from "@/lib/smartbook/office";
import { FIRST_MESSAGE_MAX, type SmartBookSettings } from "@/lib/smartbook/settings";
import { isTestLead, testLeadId } from "@/lib/smartbook/store";
import { leadCallReadiness } from "@/lib/aiDesk/leadCalls";
import { deskBalanceFor } from "@/lib/aiDesk/minutes";

const DENIED = "You don't have access to SmartBook here.";

type Ctx = Awaited<ReturnType<typeof requireSalesOrManager>>;

async function guard<T extends Ctx>(get: () => Promise<T>): Promise<T | null> {
  try {
    return await get();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) return null;
    throw err;
  }
}

/** The leads of `ids` this person may open: all of them for the office, a rep's own (or still NEW) for a rep. */
async function visibleLeads(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.lead.findMany({
    where: { organizationId: ctx.organizationId, id: { in: ids }, ...(isSalesRole(ctx.role) ? { OR: [{ assignedToId: ctx.user.id }, { claimedById: ctx.user.id }, { status: "NEW" }] } : {}) },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

async function mayTouch(ctx: Ctx, leadId: string): Promise<boolean> {
  if (isTestLead(leadId)) return leadId === testLeadId(ctx.user.id);
  return (await visibleLeads(ctx, [leadId])).has(leadId);
}

const who = (ctx: Ctx) => ctx.user.name?.trim() || ctx.user.email || "Someone on your team";

function touched(leadId?: string) {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/leads");
  if (leadId && !isTestLead(leadId)) revalidatePath(`/dashboard/leads/${leadId}`);
}

// ── Settings → SmartBook ─────────────────────────────────────────────────────

export interface SmartBookSettingsView {
  settings: SmartBookSettings;
  preview: SmartBookPreview;
  /** The month's texts are used: SmartBook goes on by email until the next month. */
  textsUsed: boolean;
  /** The connected Page's lead forms, and how many carry the texts box (null before the first check); `auto`: the Meta
   *  sweep's "New leads come in by themselves" is on (lib/meta/autoImport) — the way Facebook leads reach SmartBook. */
  facebook: { connected: boolean; auto: boolean; forms: number | null; withTexts: number | null; withCalls: number | null };
  /** Where the test goes: the person's verified mobile and their email. */
  me: { phone: string | null; email: string | null };
  /** The one AI call: why it can't go yet (null: it can), and the desk minutes left this month. */
  call: { blocked: string | null; minutesLeft: number | null };
}

export async function loadSmartBookSettings(): Promise<{ ok: true; view: SmartBookSettingsView } | { ok: false; error: string }> {
  const ctx = await guard(requireManager);
  if (!ctx) return { ok: false, error: DENIED };
  const [settings, preview, textsUsed, meta, consent, me, blocked, balance, org] = await Promise.all([
    readSmartBookSettings(ctx.organizationId),
    smartBookPreview(ctx.organizationId),
    smsAllowanceUsed(ctx.organizationId).catch(() => false),
    getMetaConnection(ctx.organizationId).catch(() => null),
    metaConsentSummary(ctx.organizationId).catch(() => null),
    db.user.findUnique({ where: { id: ctx.user.id }, select: { email: true, smsPhone: true, smsVerifiedAt: true } }),
    // SmartBook's call is the desk's own call to a lead (lib/aiDesk/leadCalls): its readiness, in its words.
    leadCallReadiness(ctx.organizationId).then((r) => (r.ok ? null : r.why)).catch(() => "The AI desk can't be checked right now."),
    deskBalanceFor(ctx.organizationId).catch(() => null),
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { metaSettingsJson: true } }),
  ]);
  if (!preview) return { ok: false, error: DENIED };
  return {
    ok: true,
    view: {
      settings,
      preview,
      textsUsed,
      facebook: { connected: !!meta, auto: parseMetaSettings(org?.metaSettingsJson).autoCreate === true, forms: consent?.forms ?? null, withTexts: consent?.withTexts ?? null, withCalls: consent?.withCalls ?? null },
      me: { phone: me?.smsPhone && me.smsVerifiedAt ? prettyPhone(me.smsPhone) : null, email: me?.email ?? null },
      call: { blocked, minutesLeft: balance ? Math.floor(balance.remainingSeconds / 60) : null },
    },
  };
}

const settingsInput = z.object({
  on: z.boolean(),
  sources: z.object({ facebook: z.boolean(), website: z.boolean(), jobflex: z.boolean(), desk: z.boolean(), other: z.boolean() }),
  text: z.boolean(),
  email: z.boolean(),
  call: z.boolean(),
  serviceKey: z.string().max(80).nullable(),
  offers: z.number().int().min(2).max(4),
  ownTime: z.enum(["ask", "auto"]),
  firstMessage: z.string().max(FIRST_MESSAGE_MAX).nullable(),
});

export async function saveSmartBook(raw: unknown): Promise<{ ok: true; settings: SmartBookSettings; facebookAuto: boolean } | { ok: false; error: string }> {
  const ctx = await guard(requireManager);
  if (!ctx) return { ok: false, error: DENIED };
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Something in the form isn't right — check it and save again." };
  const v = parsed.data;
  if (!v.text && !v.email) return { ok: false, error: "Keep Text or Email on — SmartBook needs a way to reach people." };
  const next: SmartBookSettings = { ...v, onSince: null, firstMessage: v.firstMessage?.trim() || null };
  const settings = await saveSmartBookSettings(ctx.organizationId, next);
  // Facebook leads reach SmartBook through the Meta sweep: SmartBook on for them turns its switch on (from now).
  if (settings.on && settings.sources.facebook) await ensureMetaAutoImport(ctx.organizationId).catch(() => false);
  const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { metaSettingsJson: true } });
  revalidatePath("/dashboard/settings");
  return { ok: true, settings, facebookAuto: parseMetaSettings(org?.metaSettingsJson).autoCreate === true };
}

/** "Send me a test": the whole conversation, with the person pressing it as the customer. */
export async function sendSmartBookTest(): Promise<{ ok: true; line: string } | { ok: false; error: string }> {
  const ctx = await guard(requireManager);
  if (!ctx) return { ok: false, error: DENIED };
  const user = await db.user.findUnique({ where: { id: ctx.user.id }, select: { id: true, name: true, email: true, smsPhone: true, smsVerifiedAt: true } });
  if (!user) return { ok: false, error: DENIED };
  const r = await startSmartBookTest(ctx.organizationId, user);
  if (!r.ok) return r;
  const phone = user.smsPhone ? prettyPhone(user.smsPhone) : "your phone";
  const line =
    r.by === "both"
      ? `Sent — check the text on ${phone} and your email. Reply to the text as a customer would; for the next two hours your texts go to the test.`
      : r.by === "text"
        ? `Sent — check the text on ${phone}. Reply as a customer would; for the next two hours your texts go to the test.`
        : `Sent — check your email (${user.email}) and tap a time, or suggest your own.`;
  revalidatePath("/dashboard/calendar");
  return { ok: true, line };
}

// ── the calendar's Requests, the lead page ───────────────────────────────────

export async function loadSmartBookRequests(): Promise<{ ok: true; requests: RequestCard[] } | { ok: false; error: string }> {
  const ctx = await guard(requireSalesOrManager);
  if (!ctx) return { ok: false, error: DENIED };
  return { ok: true, requests: await smartBookRequests(ctx.organizationId, { userId: ctx.user.id, visible: (ids) => visibleLeads(ctx, ids) }) };
}

const decisionInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("yes") }),
  z.object({ decision: z.literal("no") }),
  z.object({ decision: z.literal("other"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), time: z.string().regex(/^\d{2}:\d{2}$/) }),
]);

/** Yes / No / another time — the same answer as the text and the email's page. */
export async function answerSmartBookRequest(leadId: string, raw: unknown): Promise<{ ok: true; line: string; booked: boolean } | { ok: false; error: string }> {
  const ctx = await guard(requireSalesOrManager);
  if (!ctx) return { ok: false, error: DENIED };
  const id = String(leadId ?? "").slice(0, 80);
  const parsed = decisionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick an answer, or a day and a time." };
  if (!(await mayTouch(ctx, id))) return { ok: false, error: DENIED };
  const line = await decideRequest(ctx.organizationId, id, parsed.data as Decision, { actorId: ctx.user.id });
  if (!line) return { ok: false, error: "Already answered — this request isn't waiting any more." };
  touched(id);
  return { ok: true, line, booked: /^Done —/.test(line) };
}

export async function loadLeadSmartBook(leadId: string): Promise<{ ok: true; view: LeadSmartBook | null } | { ok: false; error: string }> {
  const ctx = await guard(requireSalesOrManager);
  if (!ctx) return { ok: false, error: DENIED };
  const id = String(leadId ?? "").slice(0, 80);
  if (!(await mayTouch(ctx, id))) return { ok: false, error: DENIED };
  return { ok: true, view: await leadSmartBook(ctx.organizationId, id) };
}

type Step = { ok: true; view: LeadSmartBook | null } | { ok: false; error: string };

async function onLead(leadId: string, fn: (ctx: Ctx, id: string) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<Step> {
  const ctx = await guard(requireSalesOrManager);
  if (!ctx) return { ok: false, error: DENIED };
  const id = String(leadId ?? "").slice(0, 80);
  if (isTestLead(id) || !(await mayTouch(ctx, id))) return { ok: false, error: DENIED };
  const r = await fn(ctx, id);
  touched(id);
  const view = await leadSmartBook(ctx.organizationId, id);
  return r.ok ? { ok: true, view } : { ok: false, error: r.error };
}

export async function pauseLeadSmartBook(leadId: string): Promise<Step> {
  return onLead(leadId, async (ctx, id) => ((await pauseSmartBook(ctx.organizationId, id, { actorId: ctx.user.id, who: who(ctx) })) ? { ok: true } : { ok: false, error: "SmartBook isn't talking with them right now." }));
}

export async function restartLeadSmartBook(leadId: string): Promise<Step> {
  return onLead(leadId, (ctx, id) => restartSmartBook(ctx.organizationId, id, { actorId: ctx.user.id, who: who(ctx) }));
}

export async function offerLeadTimes(leadId: string): Promise<Step> {
  return onLead(leadId, (ctx, id) => offerTimesByHand(id, { actorId: ctx.user.id, who: who(ctx) }));
}
