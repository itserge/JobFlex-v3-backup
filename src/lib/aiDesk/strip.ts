// THE PHONE PAGE'S DESK LINE — server only: the company's number, who answers it, the
// voice, and the month's minutes (lib/aiDesk/usage). Read by app/dashboard/phone/load-phone.
import { db } from "@/lib/db";
import { isPageLocked } from "@/lib/customPageAccess";
import { readRegistration } from "@/lib/sms/registration";
import type { PhoneDeskStrip } from "@/components/v3/phone-blueprint/phone-data";
import { numbersAssignedTo, readDeskSettings } from "./numbers";
import { readDeskUse } from "./usage";
import { deskBalanceFor } from "./minutes";
import { voiceServerConfigured } from "./voiceToken";
import { callsGo, minutesLeftWords, minutesOf, prettyPhone } from "./shared";

export async function deskStripFor(organizationId: string): Promise<PhoneDeskStrip> {
  const [org, reg, settings, locked, use, balance, assigned] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { phone: true } }),
    readRegistration(organizationId).catch(() => null),
    readDeskSettings(organizationId),
    isPageLocked(organizationId, "phone").catch(() => true),
    readDeskUse(organizationId),
    deskBalanceFor(organizationId),
    numbersAssignedTo(organizationId),
  ]);
  const companyPhone = org?.phone?.trim() || null;
  // The number it bought, else a line JobFlex assigned to it on /admin/health.
  const number = reg?.number ?? assigned[0] ?? null;
  return {
    number: number ? prettyPhone(number) : null,
    on: Boolean(reg?.number ? reg.voiceOnAt : assigned[0]),
    left: minutesLeftWords(balance),
    out: balance.out,
    low: balance.low,
    go: callsGo({ mode: settings.mode, assistantOnPlan: !locked, companyPhone }),
    mode: settings.mode,
    companyPhone,
    voice: settings.voice,
    minutes: minutesOf(use.callSeconds + use.testSeconds),
    calls: use.calls,
    tests: use.tests,
    live: voiceServerConfigured(),
    paused: settings.paused,
    // A company phone that forwards every call to the desk can't be rung for it (the call would come straight back).
    forwardsAll: settings.forwarding === "all",
  };
}
