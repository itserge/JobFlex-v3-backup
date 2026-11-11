// THE WAY OUT AT THE FOOT OF A REPEAT LETTER (2026-11-11) — server only. What the email law (CAN-SPAM) and the
// mail apps ask of every letter that is not a receipt or a code: the sender's postal address, an Unsubscribe link in
// the letter itself, and the List-Unsubscribe + List-Unsubscribe-Post headers that put the mail app's own one-click
// button beside the sender. Two senders:
//   · JobFlex's own letters (win-back, the lead set-up reminder, the homeowner's plan reminders) — the link is
//     /api/email/unsubscribe (lib/adminMail/optout), the address JOBFLEX_POSTAL_ADDRESS;
//   · a company's letters to its client (follow-ups, review requests, SmartBook) — the link is /api/email/stop
//     (lib/winback/optout), the address the company's own (its Company page), else JobFlex's.
import "server-only";
import type { EmailDoc } from "@/lib/email/doc";
import { unsubscribeHeaders, unsubscribeUrl } from "@/lib/adminMail/optout";
import { addressStopUrl, stopHeaders } from "@/lib/winback/optout";

export interface OptOutFooter {
  fine: string;
  fineLink: { label: string; href: string };
  headers: Record<string, string>;
  url: string;
  /** The postal address the fine print carries; null when there is none to give. */
  postal: string | null;
}

const oneLine = (a: string) => a.replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ").trim();

/** JobFlex's postal address (JOBFLEX_POSTAL_ADDRESS), or null. */
export const jobflexPostal = (): string | null => {
  const v = process.env.JOBFLEX_POSTAL_ADDRESS?.trim();
  return v ? oneLine(v) : null;
};

/** For JobFlex's own letter to `email`, on behalf of `account` (an organization id, `home_<id>` or `prospect_<id>`). */
export function jobflexOptOut(base: string, account: string, email: string, why: string): OptOutFooter {
  const url = unsubscribeUrl(base, account, email);
  const postal = jobflexPostal();
  return { fine: `${why}${postal ? ` JobFlex · ${postal}.` : ""}`, fineLink: { label: "Unsubscribe", href: url }, headers: unsubscribeHeaders(url), url, postal };
}

/** For a company's letter to its client at `email`. */
export function companyOptOut(base: string, org: { id: string; name: string | null; address?: string | null }, email: string): OptOutFooter {
  const url = addressStopUrl(base, org.id, email);
  const name = org.name?.trim() || "This company";
  const own = org.address?.trim() ? oneLine(org.address) : null;
  const platform = jobflexPostal();
  const postal = own ?? platform;
  const where = own ? ` ${name} · ${own}.` : platform ? ` Sent through JobFlex · ${platform}.` : "";
  return { fine: `You're getting this because you've been in touch with ${name}.${where}`, fineLink: { label: "Unsubscribe", href: url }, headers: stopHeaders(url), url, postal };
}

/** The doc with the footer's fine print and link at its foot (after any fine print it already had). */
export function withOptOut(doc: EmailDoc, f: OptOutFooter): EmailDoc {
  return { ...doc, fine: doc.fine ? `${doc.fine} ${f.fine}` : f.fine, fineLink: f.fineLink };
}
