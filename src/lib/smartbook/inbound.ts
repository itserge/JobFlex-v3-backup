// SMARTBOOK · A TEXT CAME IN ON THE COMPANY'S NUMBER (2026-10-31) — server only.
//
// The text route (api/twilio/sms) asks first whose it is, quickly — a lead SmartBook is talking with, or someone on
// the team answering a waiting request — and answers Twilio at once; the reading, the booking and the replies run
// after the response (they can take a model call or two). Anything SmartBook doesn't take goes the usual way:
// logged, on the bell, forwarded to the office.
import { toE164 } from "@/lib/phone";
import { isTeamPhone } from "@/lib/sms/consent";
import { textOfficeNow } from "@/lib/sms/send";
import { replyForwardLine } from "@/lib/sms/format";
import { convByPhone, isLiveTest, listConvs } from "./store";
import { onContractorText, onCustomerText } from "./engine";

export type Claim = "customer" | "company";

export async function smartBookClaim(organizationId: string, from: string): Promise<Claim | null> {
  const phone = toE164(from);
  if (!phone) return null;
  if (await isTeamPhone(organizationId, phone)) {
    // Someone running "Send me a test" plays the customer, and the company once their test asks for a time.
    const mine = await convByPhone(organizationId, phone);
    if (mine && isLiveTest(mine)) return mine.status === "asked" ? "company" : "customer";
    const open = (await listConvs(organizationId, 14)).some((c) => c.status === "asked" && c.request && !c.test);
    return open ? "company" : null;
  }
  const conv = await convByPhone(organizationId, phone);
  if (!conv) return null;
  return conv.status !== "closed" || conv.why === "no-reply" ? "customer" : null;
}

/** "cancel my visit" is a customer talking; only the bare carrier word ("CANCEL", "STOP") is an opt-out. */
export function isBareKeyword(body: string): boolean {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$/i.test(body);
}

export async function smartBookReply(claim: Claim, organizationId: string, from: string, body: string): Promise<void> {
  try {
    const handled = claim === "company" ? await onContractorText(organizationId, from, body) : await onCustomerText(organizationId, from, body);
    if (handled) return;
  } catch (err) {
    console.error(`[smartbook] reply failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Not taken after all (the conversation moved on, or a step failed): the office reads it, as any reply.
  if (claim === "customer") await textOfficeNow(organizationId, replyForwardLine(from, "lead", body), { excludePhones: [from], kind: "reply-forward" }).catch(() => null);
}
