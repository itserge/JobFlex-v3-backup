"use server";
// FINISH SETTING UP YOUR COMPANY — the save (owner, 2026-11-12; lib/phoneSetup). Only for an owner whose shop signed
// up by text and still owes the screen. The company email is required: checked as an address, refused when it is a
// throwaway inbox, and — because for a sign-up by text it is also the account's sign-in address — refused in words
// when another account already signs in with it. Every refusal is RETURNED (a production build withholds a thrown
// server-action message).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { clearPhoneSetup, phoneSetupDue } from "@/lib/phoneSetup";
import { clearOrgNameUnset } from "@/lib/orgName";
import { toE164 } from "@/lib/phone";
import { prettyUsPhone } from "@/lib/phoneLoginShared";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

export type PhoneSetupField = "companyName" | "email" | "officePhone";
type Result = { ok: true } | { ok: false; error: string; field?: PhoneSetupField };

const EMAIL_TAKEN = "That email already belongs to another JobFlex account. Use a different one.";

const schema = z.object({
  companyName: z.string().trim().min(1, "Type your company name.").max(120, "That name is too long."),
  email: z.string().trim().toLowerCase().min(1, "Enter your company email.").max(200, "That email is too long.").email("Enter a valid email address."),
  officePhone: z.string().trim().max(40, "That number is too long.").optional().default(""),
});

export async function finishPhoneSetup(raw: unknown): Promise<Result> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message || "Check the form.", field: (issue?.path[0] as PhoneSetupField | undefined) ?? undefined };
  }
  const { companyName, email, officePhone } = parsed.data;
  if (isDisposableEmail(email)) return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE, field: "email" };
  const phone = officePhone ? toE164(officePhone) : null;
  if (officePhone && !phone) return { ok: false, error: "Enter the office phone as a 10-digit number, or leave it empty.", field: "officePhone" };
  try {
    const { organizationId, role, user } = await requireOrg();
    if (role !== "OWNER") return { ok: false, error: "Only the owner can finish the company setup." };
    // Nothing owed (saved in another tab, or never a sign-up by text): done.
    if (!(await phoneSetupDue(organizationId))) return { ok: true };
    const me = await db.user.findUnique({ where: { id: user.id }, select: { email: true } });
    const changed = (me?.email ?? "").toLowerCase() !== email;
    if (changed && (await db.user.findUnique({ where: { email }, select: { id: true } }))) return { ok: false, error: EMAIL_TAKEN, field: "email" };
    await db.$transaction(async (tx) => {
      // The account's sign-in address too: a sign-up by text had only the one Stripe's page gave. A new address is
      // unproven until a code from it.
      if (changed) await tx.user.update({ where: { id: user.id }, data: { email, emailVerified: null } });
      await tx.organization.update({
        where: { id: organizationId },
        data: { name: companyName, billingEmail: email, phone: phone ? prettyUsPhone(phone) : null },
      });
      await clearPhoneSetup(tx, organizationId);
    });
    await clearOrgNameUnset(organizationId);
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.SETTINGS,
      summary: `Finished the company setup — ${companyName}`,
      meta: { area: "company", fields: ["name", "billingEmail", "phone", ...(changed ? ["email"] : [])] },
    }).catch(() => {});
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return { ok: false, error: EMAIL_TAKEN, field: "email" };
    console.error("[phoneSetup] save failed:", err);
    return { ok: false, error: "Couldn't save. Try again in a minute." };
  }
}
