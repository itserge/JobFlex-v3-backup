// SMARTBOOK · WHERE A LEAD STANDS, IN A WORD (2026-10-31). Pure — the leads list (desk and phone), the lead page and
// the calendar's Requests read it.
//
// The spec's list: Times sent · Needs you · Booked · No reply · Not interested · Handed to you — plus Paused (a person
// took over), Texts stopped (STOP) and Canceled (the customer canceled the visit SmartBook booked).
import type { CloseWhy, ConvStatus } from "./store";

export type SmartChipKey = "sent" | "needs" | "booked" | "no-reply" | "not-interested" | "handed" | "paused" | "stopped" | "canceled";

/** `tone` is a status colour: blue waiting on the customer, amber waiting on the company, green done, grey stopped. */
export interface SmartChip {
  key: SmartChipKey;
  label: string;
  tone: "accent" | "amber" | "emerald" | "muted";
}

const CHIPS: Record<SmartChipKey, SmartChip> = {
  sent: { key: "sent", label: "Times sent", tone: "accent" },
  needs: { key: "needs", label: "Needs you", tone: "amber" },
  booked: { key: "booked", label: "Booked", tone: "emerald" },
  "no-reply": { key: "no-reply", label: "No reply", tone: "muted" },
  "not-interested": { key: "not-interested", label: "Not interested", tone: "muted" },
  handed: { key: "handed", label: "Handed to you", tone: "amber" },
  paused: { key: "paused", label: "Paused", tone: "muted" },
  stopped: { key: "stopped", label: "Texts stopped", tone: "muted" },
  canceled: { key: "canceled", label: "Canceled", tone: "muted" },
};

export function smartChip(c: { status: ConvStatus; why: CloseWhy | null }): SmartChip {
  if (c.status === "offered" || c.status === "countered") return CHIPS.sent;
  if (c.status === "asked") return CHIPS.needs;
  if (c.status === "booked") return CHIPS.booked;
  switch (c.why) {
    case "no-reply":
      return CHIPS["no-reply"];
    case "not-interested":
      return CHIPS["not-interested"];
    case "handed":
      return CHIPS.handed;
    case "stopped":
      return CHIPS.stopped;
    case "canceled":
      return CHIPS.canceled;
    default:
      return CHIPS.paused;
  }
}
