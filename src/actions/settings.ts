"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { openGmailTokens, revokeGmailToken } from "@/lib/sdk/gmail";
import { parseGmailSettings, parsePaymentSettings } from "@/lib/settings";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildTestEmail } from "@/lib/email/build/platform";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { refusal, type ActionResult } from "@/lib/actionResult";

const settingsSaved = (organizationId: string, actorId: string, area: string, meta?: Record<string, unknown>) =>
  logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: `Updated ${area} settings`, meta: { area, ...meta } });

// Org-level settings persistence. Each action validates its slice with zod and
// writes it as a JSON-as-String column on Organization. Mirrors the canonical
// company.ts pattern (requireOrg → parse → organization.update → revalidatePath).

// Only the slice the Payments pane still edits. Provider on/off and bank
// transfer live in src/actions/paymentConnections.ts; the write MERGES over
// the stored blob so those (and any legacy keys) survive a save from here.
const paymentSchema = z.object({
  currency: z.string().trim().max(8),
  depositPct: z.number().min(0).max(100),
  receiptsOnPayment: z.boolean(),
  reminderMode: z.enum(["auto", "manual", "off"]).optional(),
});

export async function updatePaymentSettings(raw: unknown) {
  const { organizationId, user } = await requireManager();
  const data = paymentSchema.parse(raw);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { paymentSettingsJson: true },
  });
  const current = parsePaymentSettings(org?.paymentSettingsJson);
  await db.organization.update({
    where: { id: organizationId },
    data: { paymentSettingsJson: JSON.stringify({ ...current, ...data }) },
  });
  revalidatePath("/dashboard/settings");
  await settingsSaved(organizationId, user.id, "payment", { depositPct: data.depositPct, reminderMode: data.reminderMode });
  return { ok: true };
}

const leadsSchema = z.object({
  strategy: z.enum(["round-robin", "first-come", "territory", "manual"]),
  aiCategorize: z.boolean(),
  instantSms: z.boolean(),
  businessHours: z.boolean(),
  autoDeclineDupes: z.boolean(),
  zips: z.string(),
  travelRadius: z.number(),
  outsidePolicy: z.string(),
  maxPerDay: z.number(),
  maxPerRep: z.number(),
  smartPrompt: z.string(),
});

export async function updateLeadsSettings(raw: unknown) {
  const { organizationId, user } = await requireManager();
  const data = leadsSchema.parse(raw);
  await db.organization.update({
    where: { id: organizationId },
    data: { leadsSettingsJson: JSON.stringify(data) },
  });
  revalidatePath("/dashboard/settings/leads");
  await settingsSaved(organizationId, user.id, "lead routing", { strategy: data.strategy });
  return { ok: true };
}

// Track-opens, two-way sync and the signature were decorative — stored, read
// by nothing — and left the UI on 2026-09-20. Older clients may still send
// them; they are accepted and ignored.
const gmailSchema = z.object({
  connected: z.boolean(),
  sendFromUser: z.boolean(),
  trackOpens: z.boolean().optional(),
  autoSync: z.boolean().optional(),
  displayName: z.string(),
  replyTo: z.string(),
  signature: z.string().optional(),
});

export async function updateGmailSettings(raw: unknown) {
  const { organizationId, user } = await requireManager();
  const data = gmailSchema.parse(raw);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { gmailSettingsJson: true },
  });
  const current = parseGmailSettings(org?.gmailSettingsJson);
  // The connection state is owned by the OAuth callback / disconnect — the
  // settings form only edits preferences and must never flip it.
  const merged = {
    ...current,
    sendFromUser: data.sendFromUser,
    displayName: data.displayName,
    replyTo: data.replyTo,
    connected: current.connected,
    connectedEmail: current.connectedEmail,
  };
  await db.organization.update({
    where: { id: organizationId },
    data: { gmailSettingsJson: JSON.stringify(merged) },
  });
  revalidatePath("/dashboard/settings");
  await settingsSaved(organizationId, user.id, "email sending");
  return { ok: true };
}

// Sends a real test email to the signed-in manager, through whichever transport
// is active (connected Gmail, else Resend). Confirms the whole pipeline works.
export async function sendGmailTestEmail() {
  const { organizationId, user } = await requireManager();
  const to = user.email;
  if (!to) throw new Error("Your account has no email address.");
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      logoUrl: true,
      phone: true,
      gmailSettingsJson: true,
      gmailTokensJson: true,
      billingEmail: true,
    },
  });
  if (!org) throw new Error("Organization not found.");
  const { subject, html } = renderEmail(
    buildTestEmail({ org: { id: organizationId, name: org.name, logoUrl: org.logoUrl, phone: org.phone } }),
  );
  const res = await sendOrgEmail(org, { mailClass: "transactional", to, subject, html });
  return { ok: true, via: res.via, to };
}

// Revokes the org's Gmail connection: tells Google the grant is no longer
// wanted (best effort), drops the stored tokens and flips the settings back
// to disconnected. New sends fall back to Resend + reply-to.
export async function disconnectGmail() {
  const { organizationId, user } = await requireManager();
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { gmailSettingsJson: true, gmailTokensJson: true },
  });
  const current = parseGmailSettings(org?.gmailSettingsJson);
  const tokens = openGmailTokens(org?.gmailTokensJson);
  if (tokens?.refreshToken) await revokeGmailToken(tokens.refreshToken);
  await db.organization.update({
    where: { id: organizationId },
    data: {
      gmailTokensJson: null,
      gmailSettingsJson: JSON.stringify({ ...current, connected: false, connectedEmail: "", revokedAt: "", revokedReason: "" }),
    },
  });
  revalidatePath("/dashboard/settings");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Disconnected Gmail${current.connectedEmail ? ` (${current.connectedEmail})` : ""}`, meta: { area: "email sending" } });
  return { ok: true };
}

// Org-wide default profit markup (hidden from the client). These are real
// Organization columns (not JSON) — seeded into every new proposal and applied
// by the estimators. 0% keeps current behaviour. min(0) blocks negative markup
// (which would sell below cost); the ceiling is a sanity guard, not a rule.
const proposalDefaultsSchema = z.object({
  materialMarkupPct: z.number({ invalid_type_error: "enter a number." }).finite("enter a number.").min(0, "can't be below 0.").max(1000, "1000 at most."),
  laborMarkupPct: z.number({ invalid_type_error: "enter a number." }).finite("enter a number.").min(0, "can't be below 0.").max(1000, "1000 at most."),
  // Default sales tax, stored as a FRACTION 0-1 (0.08 = 8%) to match
  // Proposal.taxRate. The settings UI collects a percent and divides by 100.
  defaultTaxRate: z.number({ invalid_type_error: "enter a number." }).finite("enter a number.").min(0, "can't be below 0.").max(1, "100% at most."),
});
const PROPOSAL_DEFAULT_LABELS = { materialMarkupPct: "Materials markup", laborMarkupPct: "Labor markup", defaultTaxRate: "Default tax rate" };

// A wrong value comes back as a refusal the form prints under its field — a
// thrown ZodError reached the page as a 500 (QA F-1f3f6da5).
export async function updateProposalDefaults(raw: unknown): Promise<ActionResult> {
  const { organizationId, user } = await requireManager();
  const parsed = proposalDefaultsSchema.safeParse(raw);
  if (!parsed.success) return refusal(parsed.error, PROPOSAL_DEFAULT_LABELS);
  const data = parsed.data;
  await db.organization.update({
    where: { id: organizationId },
    data: {
      materialMarkupPct: data.materialMarkupPct,
      laborMarkupPct: data.laborMarkupPct,
      defaultTaxRate: data.defaultTaxRate,
    },
  });
  revalidatePath("/dashboard/settings/proposals");
  await settingsSaved(organizationId, user.id, "proposal default", { materialMarkupPct: data.materialMarkupPct, laborMarkupPct: data.laborMarkupPct, defaultTaxRate: data.defaultTaxRate });
  return { ok: true };
}

const metaSchema = z.object({
  connected: z.boolean(),
  autoCreate: z.boolean(),
  autoText: z.boolean(),
  defaultPage: z.string(),
  formCategory: z.string(),
});

export async function updateMetaSettings(raw: unknown) {
  await requireManager();
  metaSchema.parse(raw);
  // Reject stale clients: a boolean must never forge or overwrite OAuth state.
  throw new Error("Use the Meta connection controls to connect or disconnect a Page.");
}
