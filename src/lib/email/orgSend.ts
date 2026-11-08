// Server-only. Sends an org's outbound email the "right" way: through the org's
// connected Gmail when they've opted in, otherwise through the platform transport
// (Resend/SMTP) with the contractor set as reply-to. Centralizes the decision so
// follow-ups (and future senders) share one code path.
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/sdk/resend";
import { parseGmailSettings } from "@/lib/settings";
import { gmailErrorText, isGmailGrantDead, isGmailOAuthConfigured, openGmailTokens, sendViaGmail } from "@/lib/sdk/gmail";
import { ActivityKind } from "@/lib/prismaEnums";
import type { EmailKind } from "@/lib/emailLog";

export interface OrgEmailSender {
  /** When known, a dead Gmail grant is marked on the row by id; without it
   *  the row is found by the stored grant itself. */
  id?: string;
  name: string | null;
  gmailSettingsJson: string | null;
  gmailTokensJson: string | null;
  billingEmail: string | null;
}

/** Reply-to: the org's configured reply-to, else its billing email. */
export function orgReplyTo(org: {
  gmailSettingsJson: string | null;
  billingEmail: string | null;
}): string | undefined {
  const rt = parseGmailSettings(org.gmailSettingsJson).replyTo?.trim();
  return rt || org.billingEmail || undefined;
}

export interface OrgEmailResult {
  via: "gmail" | "resend";
  /** Set when the org meant to send from Gmail and the platform sent instead:
   *  "revoked" — Google refused the grant and it has been dropped (Settings
   *  now says so); "failed" — a passing error, the grant is kept. */
  gmailFallback?: "failed" | "revoked";
}

/** Google refused the grant for good: drop the tokens and remember why, so
 *  Settings stops saying "Connected" and offers Reconnect. */
async function markGmailRevoked(org: OrgEmailSender, reason: string): Promise<void> {
  const settings = parseGmailSettings(org.gmailSettingsJson);
  const next = { ...settings, connected: false, revokedAt: new Date().toISOString(), revokedReason: reason.slice(0, 160) };
  const where = org.id ? { id: org.id } : { gmailTokensJson: org.gmailTokensJson ?? "" };
  await db.organization
    .updateMany({ where, data: { gmailTokensJson: null, gmailSettingsJson: JSON.stringify(next) } })
    .catch((err) => console.warn("[sendOrgEmail] could not mark the Gmail grant revoked:", err instanceof Error ? err.message : err));
}

/** The two transports, replaceable by scripts/qa/gmail-fallback.check.ts. */
export interface OrgEmailTransports {
  gmail: typeof sendViaGmail;
  platform: typeof sendEmail;
}

export async function sendOrgEmail(
  org: OrgEmailSender,
  opts: {
    to: string | string[];
    subject: string;
    html: string;
    kind?: EmailKind;
    /** A Reply-To of the caller's own (2026-11-08, the subcontractors plan, part 2: a request's reply address,
     *  rfq-<token>@<inbound domain>, so the sub's answer lands in JobFlex). Default: the org's reply-to. */
    replyTo?: string;
  },
  transports: OrgEmailTransports = { gmail: sendViaGmail, platform: sendEmail },
): Promise<OrgEmailResult> {
  const settings = parseGmailSettings(org.gmailSettingsJson);
  const replyTo = opts.replyTo?.trim() || orgReplyTo(org);
  let gmailFallback: OrgEmailResult["gmailFallback"];

  // Prefer the org's own Gmail when connected + opted in + OAuth configured.
  if (settings.connected && settings.sendFromUser && isGmailOAuthConfigured() && org.gmailTokensJson) {
    try {
      const tokens = openGmailTokens(org.gmailTokensJson);
      if (tokens && tokens.refreshToken && tokens.email) {
        const to = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
        await transports.gmail(tokens, {
          to,
          subject: opts.subject,
          html: opts.html,
          fromName: settings.displayName || org.name || undefined,
          replyTo,
        });
        return { via: "gmail" };
      }
    } catch (err) {
      // Never let a Gmail hiccup drop the email — fall through to the platform.
      const text = gmailErrorText(err);
      console.warn("[sendOrgEmail] Gmail send failed, falling back to Resend:", text);
      if (isGmailGrantDead(err)) {
        await markGmailRevoked(org, text);
        gmailFallback = "revoked";
      } else {
        gmailFallback = "failed";
      }
    }
  }

  await transports.platform({ to: opts.to, subject: opts.subject, html: opts.html, replyTo, kind: opts.kind, organizationId: org.id ?? null });
  return gmailFallback ? { via: "resend", gmailFallback } : { via: "resend" };
}

/** The one line the contractor sees in the proposal's activity when the mail
 *  they meant to send from Gmail went out from the JobFlex address instead. */
export async function noteGmailFallback(
  res: OrgEmailResult,
  ctx: { organizationId: string; proposalId?: string | null; clientId?: string | null; what: string },
): Promise<void> {
  if (!res.gmailFallback) return;
  const summary =
    res.gmailFallback === "revoked"
      ? `${ctx.what} went out from the JobFlex address — Google no longer accepts your Gmail connection. Reconnect it in Settings → Integrations → Gmail.`
      : `${ctx.what} went out from the JobFlex address — the send from your Gmail failed this time.`;
  await db.activityEvent
    .create({
      data: {
        organizationId: ctx.organizationId,
        proposalId: ctx.proposalId ?? null,
        clientId: ctx.clientId ?? null,
        kind: ActivityKind.EMAIL,
        summary,
        meta: JSON.stringify({ gmailFallback: res.gmailFallback }),
      },
    })
    .catch((err) => console.warn("[sendOrgEmail] could not write the fallback note:", err instanceof Error ? err.message : err));
}
