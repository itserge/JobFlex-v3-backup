// "STOP THESE EMAILS" for a company's campaigns (Smart CRM part 6, 2026-11-10). Every campaign email carries a link
// and the one-click List-Unsubscribe header (RFC 8058): a reader who can leave in one click doesn't press "Report
// spam", and spam reports are what sink a sending domain. The link names ONE email that went out (the recipient row)
// plus an HMAC of it, so nobody can unsubscribe somebody else by guessing. The answer is kept per company and
// address (ClientEmailOptOut): it stops that company's campaigns only — proposals, invoices and replies still go.
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { emailKey } from "./shared";

const secret = (): string | null => process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? null;

export function stopToken(recipientId: string): string | null {
  const s = secret();
  return s ? createHmac("sha256", s).update(`campaignStop:${recipientId}`).digest("hex").slice(0, 32) : null;
}

export function verifyStop(recipientId: string, token: string): boolean {
  const want = stopToken(recipientId);
  if (!want || typeof token !== "string" || token.length !== want.length) return false;
  try {
    return timingSafeEqual(Buffer.from(want), Buffer.from(token));
  } catch {
    return false;
  }
}

export const stopUrl = (base: string, recipientId: string): string => `${base.replace(/\/$/, "")}/api/email/stop?r=${encodeURIComponent(recipientId)}&t=${stopToken(recipientId) ?? ""}`;

/** The headers that put the mail app's own Unsubscribe button beside the sender. */
export const stopHeaders = (url: string): Record<string, string> => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

export interface StopTarget {
  recipientId: string;
  organizationId: string;
  campaignId: string;
  email: string;
  company: string;
  already: boolean;
}

/** Who a stop link is for; null when the link is cut off, forged, or the email never went out. */
export async function stopTarget(recipientId: string, token: string): Promise<StopTarget | null> {
  if (!recipientId || !verifyStop(recipientId, token)) return null;
  const row = await db.clientCampaignRecipient.findUnique({ where: { id: recipientId }, select: { id: true, organizationId: true, campaignId: true, email: true, optedOutAt: true } }).catch(() => null);
  const email = emailKey(row?.email);
  if (!row || !email) return null;
  const org = await db.organization.findUnique({ where: { id: row.organizationId }, select: { name: true } }).catch(() => null);
  return { recipientId: row.id, organizationId: row.organizationId, campaignId: row.campaignId, email, company: org?.name ?? "this company", already: !!row.optedOutAt };
}

/** Take the address off this company's campaigns: no more are sent, and what is still queued for it is left out. */
export async function writeStop(t: Pick<StopTarget, "organizationId" | "email"> & { recipientId?: string | null; campaignId?: string | null }, via: "one-click" | "page" | "office"): Promise<void> {
  const email = emailKey(t.email);
  if (!email) return;
  await db.clientEmailOptOut.upsert({
    where: { organizationId_email: { organizationId: t.organizationId, email } },
    create: { organizationId: t.organizationId, email, via, campaignId: t.campaignId ?? null },
    update: {},
  });
  if (t.recipientId) await db.clientCampaignRecipient.updateMany({ where: { id: t.recipientId, optedOutAt: null }, data: { optedOutAt: new Date() } });
  await db.clientCampaignRecipient.updateMany({ where: { organizationId: t.organizationId, email, status: "QUEUED" }, data: { status: "SKIPPED", reason: "opted-out" } });
}
