// A CAMPAIGN EMAIL (Smart CRM part 6, 2026-11-10): the company's words in the house layout, and under them the two
// things the law (CAN-SPAM) asks of every marketing email — the sender's mailing address and a way to stop.
import "server-only";
import type { EmailDoc } from "@/lib/email/doc";
import { renderEmail } from "@/lib/email/renderEmail";
import { campaignFine } from "./shared";

export interface CampaignCompany {
  id: string;
  name: string;
  phone: string | null;
  /** The company's mailing address. A campaign is never sent without one. */
  address: string;
}

export function campaignDoc(input: { subject: string; body: string; company: CampaignCompany; stopUrl: string }): EmailDoc {
  const prose = input.body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    subject: input.subject,
    lockup: { kind: "org", name: input.company.name, orgId: input.company.id },
    headline: input.subject,
    prose,
    fine: campaignFine(input.company),
    fineLink: { label: "Unsubscribe", href: input.stopUrl },
    footer: { name: input.company.name, contact: input.company.phone ?? undefined },
  };
}

export const campaignEmail = (input: { subject: string; body: string; company: CampaignCompany; stopUrl: string }) => renderEmail(campaignDoc(input));

/** "Acme Roofing via JobFlex <app@jobflex.app>": the client sees who is writing; the address stays the platform's
 *  verified one (a company's own domain isn't verified for sending). */
export function campaignFrom(company: string): string {
  const raw = process.env.EMAIL_FROM ?? process.env.FROM_EMAIL ?? "JobFlex <app@jobflex.app>";
  const address = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
  const name = company.replace(/["<>\r\n]/g, "").trim().slice(0, 60) || "Your contractor";
  return `${name} via JobFlex <${address}>`;
}
