import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runCardlessTrialSweep } from "@/lib/cardlessTrial";
import { runCardTrialReminders } from "@/lib/trialEndingMail";
import { billEndedTries, sendTryReminders } from "@/lib/toolPlans/billing";

export const runtime = "nodejs";

// Hourly: the card-less trial's reminder emails (two days out, the last day)
// and the "ended" stamp — lib/cardlessTrial runCardlessTrialSweep. Idempotent:
// each email is sent once per trial, recorded on the trial's own row.
// And a trial that took a card: "two days left", once (lib/trialEndingMail, 2026-10-16).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runCardlessTrialSweep();
  const cardTrials = await runCardTrialReminders().catch((err) => {
    console.warn("[cron/trials] card-trial reminders failed:", err instanceof Error ? err.message : err);
    return { scanned: 0, sent: 0, failed: true };
  });
  // The new plans' free tries (lib/toolPlans/billing, 2026-11-10): a try that ended and wasn't removed goes on the
  // bill. Nobody is on the new plans until the Plans switch on Trial watch is on, so this finds nothing until then.
  // …and a day before one ends, "free until tomorrow" to the owner, once per try (email + the bell; part 3b).
  const toolReminders = await sendTryReminders().catch((err) => {
    console.warn("[cron/trials] tool try reminders failed:", err instanceof Error ? err.message : err);
    return { failed: true };
  });
  const toolTries = await billEndedTries().catch((err) => {
    console.warn("[cron/trials] tool tries failed:", err instanceof Error ? err.message : err);
    return { failed: true };
  });
  return NextResponse.json({ ok: true, ...res, cardTrials, toolReminders, toolTries });
}
