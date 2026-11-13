import "server-only";
// FINISH SETTING UP YOUR COMPANY — FOR A SIGN-UP BY TEXT (owner, 2026-11-12). A shop that signed up with a phone
// number owes one screen before the app is its own: the company email (required — the sign-up never asked for one;
// Stripe's card page did, and it stands prefilled), the office phone (the proven number, prefilled) and the company
// name (the owner's own name for now, lib/orgName). Shown to the owner on every dashboard page until it is saved
// (components/company-setup/phone-setup-sheet, mounted by app/dashboard/layout); the save is actions/phoneSetup.
//
// The mark is a SyncState row `phoneSetup:<orgId>`, written with the account (actions/signupCheckout) — no schema
// change. Email and Google sign-ups never get one: their address was proven at sign-up.
import { db } from "@/lib/db";
import { prettyUsPhone } from "@/lib/phoneLoginShared";

export const phoneSetupKey = (orgId: string) => `phoneSetup:${orgId}`;

/** Inside the account's transaction. */
export async function markPhoneSetupDue(client: Pick<typeof db, "syncState">, orgId: string): Promise<void> {
  await client.syncState.upsert({ where: { key: phoneSetupKey(orgId) }, create: { key: phoneSetupKey(orgId), cursor: new Date().toISOString() }, update: {} });
}

export async function phoneSetupDue(orgId: string): Promise<boolean> {
  return Boolean(await db.syncState.findUnique({ where: { key: phoneSetupKey(orgId) }, select: { key: true } }));
}

export async function clearPhoneSetup(client: Pick<typeof db, "syncState">, orgId: string): Promise<void> {
  await client.syncState.deleteMany({ where: { key: phoneSetupKey(orgId) } });
}

export interface PhoneSetupView {
  companyName: string;
  /** The account's address (from Stripe's card page), else the company's billing email. */
  email: string;
  officePhone: string;
}

/** What the sheet opens with, or null when nothing is owed. Never throws: a failed read shows no sheet. */
export async function phoneSetupView(orgId: string, userId: string): Promise<PhoneSetupView | null> {
  try {
    if (!(await phoneSetupDue(orgId))) return null;
    const [org, user] = await Promise.all([
      db.organization.findUnique({ where: { id: orgId }, select: { name: true, billingEmail: true, phone: true } }),
      db.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } }),
    ]);
    if (!org) return null;
    return {
      companyName: org.name ?? "",
      email: user?.email || org.billingEmail || "",
      officePhone: org.phone || prettyUsPhone(user?.phone) || "",
    };
  } catch {
    return null;
  }
}
