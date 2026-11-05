// Admin · Twilio — /admin/integrations/twilio (2026-09-24).
//
// Owner: "add in admin a new integration to set up Twilio for every user."
// JobFlex owns the Twilio account; this page is where the platform admin
// puts the account in once, for every contractor: the Account SID, the Auth
// Token (stored encrypted, never shown back), the Messaging Service or the
// sending number, a switch. A real check against Twilio, a test text, the
// webhook URLs to paste into the Twilio console, and the last texts with
// their delivery status. The env keys stay the fallback when this is empty.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { canStoreIntegrations, getTwilioIntegration, twilioIntegrationMeta } from "@/lib/platformIntegrations";
import { twilioSettings } from "@/lib/sdk/twilio";
import { AdminTwilioContent, type TwilioPageData } from "@/components/v3/admin-integrations/twilio-setup";
import { assistantNumberSources } from "@/lib/assistant/phone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Twilio",
  description: "The platform's texting account — set up once for every contractor.",
};

export default async function AdminTwilioPage() {
  await requirePlatformAdmin();
  const [stored, meta, live, base, assistant] = await Promise.all([getTwilioIntegration().catch(() => null), twilioIntegrationMeta().catch(() => null), twilioSettings(), process.env.TWILIO_APP_URL ?? appBaseUrl(), assistantNumberSources().catch(() => ({ stored: null, env: null }))]);
  const now = new Date();
  const monthStart = new Date(now.getTime());
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date(now.getTime() - 86_400_000);
  const [recent, today, month, failed, optOuts, ownNumbers] = await Promise.all([
    db.smsMessage.findMany({ where: { direction: "OUT" }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, to: true, kind: true, status: true, error: true, createdAt: true, organizationId: true } }),
    db.smsMessage.count({ where: { direction: "OUT", createdAt: { gte: dayStart }, status: { notIn: ["SKIPPED", "MERGED"] } } }),
    db.smsMessage.count({ where: { direction: "OUT", createdAt: { gte: monthStart }, status: { notIn: ["SKIPPED", "MERGED"] } } }),
    db.smsMessage.count({ where: { direction: "OUT", createdAt: { gte: monthStart }, status: { in: ["FAILED", "UNDELIVERED"] } } }),
    db.smsOptOut.count(),
    db.organization.count({ where: { smsFromNumber: { not: null } } }),
  ]).catch(() => [[], 0, 0, 0, 0, 0] as const);
  const data: TwilioPageData = {
    canStore: canStoreIntegrations(),
    stored: stored
      ? { accountSid: stored.accountSid, tokenTail: stored.authToken.slice(-4), messagingServiceSid: stored.messagingServiceSid ?? "", fromNumber: stored.fromNumber ?? "", enabled: stored.enabled }
      : null,
    savedAt: meta?.updatedAt.toISOString() ?? null,
    running: live ? { source: live.source, accountSid: live.accountSid, messagingServiceSid: live.messagingServiceSid, fromNumber: live.fromNumber } : null,
    envPresent: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    webhooks: { inbound: `${base}/api/twilio/sms`, status: `${base}/api/twilio/sms/status`, voice: `${base}/api/twilio/voice` },
    counts: { today, month, failed, optOuts, ownNumbers },
    recent: recent.map((r) => ({ id: r.id, to: `…${r.to.slice(-4)}`, kind: r.kind ?? "", status: r.status, error: r.error, at: r.createdAt.toISOString(), org: r.organizationId ? r.organizationId.slice(-6) : "platform" })),
    assistant,
  };
  return <AdminTwilioContent data={data} />;
}
