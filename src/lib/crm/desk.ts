// THE CRM DESK (Smart CRM part 4, 2026-11-10) — what the Today tab shows above the checks: the follow-ups the
// agent handed to a person, and the promise tracker. The shape only; the reader is lib/crm/deskServer.
//
// PURE — imported by the band (desk and phone), the action and the page.

import type { WaitingFollowUp } from "@/lib/followUps/agent";
import type { PromiseTracker } from "@/lib/promises/shared";

export interface CrmDesk {
  /** Follow-ups waiting for a yes (a prepared draft) or for the person to follow up themselves. */
  waiting: WaitingFollowUp[];
  promises: PromiseTracker;
  /** The company's time zone: a promise's day is a day on the company's calendar. */
  tz: string;
  /** The server's clock at the read, so "2 days late" renders the same on both sides. */
  now: number;
  /** The signed-in person, so their own promises read "yours". */
  me: string;
  /** SALES / ESTIMATOR see their own; the office sees everyone's. */
  ownOnly: boolean;
}

/** How many things on the desk need a person today. */
export function deskOpen(d: CrmDesk | null | undefined): number {
  if (!d) return 0;
  return d.waiting.length + d.promises.overdue.length + d.promises.today.length;
}
