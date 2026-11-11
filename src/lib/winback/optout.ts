// "STOP THESE EMAILS" for a company's campaigns (Smart CRM part 6, 2026-11-10). Every campaign email carries a link
// and the one-click List-Unsubscribe header (RFC 8058): a reader who can leave in one click doesn't press "Report
// spam", and spam reports are what sink a sending domain. The link names ONE email that went out (the recipient row)
// plus an HMAC of it, so nobody can unsubscribe somebody else by guessing. The answer is kept per company and
// address (ClientEmailOptOut).
//
// 2026-11-11: the company's other repeat letters to a client — follow-ups, review requests, SmartBook's — carry the
// same link, naming the company and the address instead of a campaign row (`r` = "a." + base64url(orgId|address)).
// Every stop (the link, the one-click button, the office's "Don't email") also puts the address on the
// do-not-email list (lib/mailBlock), which every sender honours.
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { writeMailBlock } from "@/lib/mailBlock";
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

/** The `r` of a letter that is not a campaign's: the company and the address. */
export const addressRef = (organizationId: string, email: string): string => `a.${Buffer.from(`${organizationId}|${emailKey(email)}`).toString("base64url")}`;

function readAddressRef(r: string): { organizationId: string; email: string } | null {
  if (!r.startsWith("a.")) return null;
  try {
    const [organizationId, email] = Buffer.from(r.slice(2), "base64url").toString("utf8").split("|");
    return organizationId && email && email.includes("@") ? { organizationId, email } : null;
  } catch {
    return null;
  }
}

/** The stop link for a company's letter to one address (a follow-up, a review request, SmartBook). */
export const addressStopUrl = (base: string, organizationId: string, email: string): string => stopUrl(base, addressRef(organizationId, email));

/** The headers that put the mail app's own Unsubscribe button beside the sender. */
export const stopHeaders = (url: string): Record<string, string> => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

/** Has this address asked this company for no more of its repeat letters? (A read that fails says no.) */
export async function companyOptedOut(organizationId: string, email: string | null | undefined): Promise<boolean> {
  const key = emailKey(email);
  if (!key) return false;
  const row = await db.clientEmailOptOut.findUnique({ where: { organizationId_email: { organizationId, email: key } }, select: { id: true } }).catch(() => null);
  return !!row;
}

export interface StopTarget {
  /** The campaign recipient row, or null for a letter that names the company and the address. */
  recipientId: string | null;
  /** The `r` the link carried, for the page's own form. */
  ref: string;
  organizationId: string;
  campaignId: string | null;
  email: string;
  company: string;
  already: boolean;
}

/** Who a stop link is for; null when the link is cut off, forged, or the email never went out. */
export async function stopTarget(ref: string, token: string): Promise<StopTarget | null> {
  if (!ref || !verifyStop(ref, token)) return null;
  const byAddress = readAddressRef(ref);
  if (byAddress) {
    const email = emailKey(byAddress.email);
    const org = await db.organization.findUnique({ where: { id: byAddress.organizationId }, select: { name: true } }).catch(() => null);
    if (!org) return null;
    return { recipientId: null, ref, organizationId: byAddress.organizationId, campaignId: null, email, company: org.name ?? "this company", already: await companyOptedOut(byAddress.organizationId, email) };
  }
  const row = await db.clientCampaignRecipient.findUnique({ where: { id: ref }, select: { id: true, organizationId: true, campaignId: true, email: true, optedOutAt: true } }).catch(() => null);
  const email = emailKey(row?.email);
  if (!row || !email) return null;
  const org = await db.organization.findUnique({ where: { id: row.organizationId }, select: { name: true } }).catch(() => null);
  return { recipientId: row.id, ref, organizationId: row.organizationId, campaignId: row.campaignId, email, company: org?.name ?? "this company", already: !!row.optedOutAt };
}

/** Take the address off this company's letters: no more are sent, and what is still queued for it is left out. */
export async function writeStop(
  t: Pick<StopTarget, "organizationId" | "email"> & { recipientId?: string | null; campaignId?: string | null; company?: string | null; by?: string | null },
  via: "one-click" | "page" | "office",
): Promise<void> {
  const email = emailKey(t.email);
  if (!email) return;
  await db.clientEmailOptOut.upsert({
    where: { organizationId_email: { organizationId: t.organizationId, email } },
    create: { organizationId: t.organizationId, email, via, campaignId: t.campaignId ?? null },
    update: {},
  });
  if (t.recipientId) await db.clientCampaignRecipient.updateMany({ where: { id: t.recipientId, optedOutAt: null }, data: { optedOutAt: new Date() } });
  await db.clientCampaignRecipient.updateMany({ where: { organizationId: t.organizationId, email, status: "QUEUED" }, data: { status: "SKIPPED", reason: "opted-out" } });
  const from = t.company ? ` from ${t.company}` : "";
  await writeMailBlock(email, {
    source: via === "office" ? "office" : "link",
    reason: via === "office" ? `Marked “Don't email”${from ? ` by ${t.company}` : ""}` : `Unsubscribe link in an email${from}${via === "one-click" ? " (one-click)" : ""}`,
    orgId: t.organizationId,
    by: t.by ?? null,
  });
}

/** The office takes its own "Don't email" back: the company's opt-out goes, and the do-not-email row when it was the
 *  company's own. A person's own unsubscribe stays. */
export async function clearOfficeStop(organizationId: string, emailRaw: string): Promise<"cleared" | "theirs" | "absent"> {
  const email = emailKey(emailRaw);
  if (!email) return "absent";
  const { removeMailBlock, readMailBlock } = await import("@/lib/mailBlock");
  const block = await readMailBlock(email);
  if (block && !(block.source === "office" && block.orgId === organizationId)) return "theirs";
  const opt = await db.clientEmailOptOut.findUnique({ where: { organizationId_email: { organizationId, email } }, select: { via: true } });
  if (opt && opt.via !== "office") return "theirs";
  if (!block && !opt) return "absent";
  if (opt) await db.clientEmailOptOut.delete({ where: { organizationId_email: { organizationId, email } } });
  if (block) await removeMailBlock(email, { asCompany: organizationId });
  return "cleared";
}
