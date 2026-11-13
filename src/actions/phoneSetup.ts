"use server";
// FINISH SETTING UP YOUR COMPANY — the save (owner, 2026-11-12; lib/phoneSetup). Only for an owner whose shop signed
// up by text and still owes the screen. Two steps since the follow-up of 813d145a: the company email is checked (an
// address, not a throwaway inbox, not one another account has PROVEN) and a six-digit code is emailed to it — the
// address from Stripe's card page too — and the screen saves only with that code (lib/signupOtp "confirm" drafts, the
// sign-up's own letter, brakes and tries). The code proves the inbox: the address becomes the account's, confirmed,
// and is taken over from any account that only held it unproven (lib/emailProof). The welcome email, kept since the
// account was made, goes out then. Every refusal is RETURNED (a production build withholds a thrown message).
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { clearPhoneSetup, phoneSetupDue } from "@/lib/phoneSetup";
import { clearOrgNameUnset } from "@/lib/orgName";
import { toE164 } from "@/lib/phone";
import { prettyUsPhone } from "@/lib/phoneLoginShared";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { addressHolder, proveEmail, takeWelcomeLater } from "@/lib/emailProof";
import { checkConfirmCode, confirmDraftOf, GONE, sendCode, startEmailConfirm } from "@/lib/signupOtp";
import { sendWelcomeFirstEstimate } from "@/lib/email/welcome";

export type PhoneSetupField = "companyName" | "email" | "officePhone" | "code";
type Refused = { ok: false; error: string; field?: PhoneSetupField; resendAt?: number };

const EMAIL_TAKEN = "That email already belongs to another JobFlex account. Use a different one.";
const TROUBLE = "Couldn't save. Try again in a minute.";

const fields = z.object({
  companyName: z.string().trim().min(1, "Type your company name.").max(120, "That name is too long."),
  email: z.string().trim().toLowerCase().min(1, "Enter your company email.").max(200, "That email is too long.").email("Enter a valid email address."),
  officePhone: z.string().trim().max(40, "That number is too long.").optional().default(""),
});
type Fields = z.infer<typeof fields>;

/** The form checked, and the owner who owes the screen. */
async function prepare(raw: unknown): Promise<{ ok: true; f: Fields; phone: string | null; ctx: Awaited<ReturnType<typeof requireOrg>> } | Refused | { ok: true; nothing: true }> {
  const parsed = fields.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message || "Check the form.", field: (issue?.path[0] as PhoneSetupField | undefined) ?? undefined };
  }
  const f = parsed.data;
  if (isDisposableEmail(f.email)) return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE, field: "email" };
  const phone = f.officePhone ? toE164(f.officePhone) : null;
  if (f.officePhone && !phone) return { ok: false, error: "Enter the office phone as a 10-digit number, or leave it empty.", field: "officePhone" };
  const ctx = await requireOrg();
  if (ctx.role !== "OWNER") return { ok: false, error: "Only the owner can finish the company setup." };
  if (!(await phoneSetupDue(ctx.organizationId))) return { ok: true, nothing: true };
  // An address another account PROVED is theirs; one it only holds unproven goes to whoever proves it.
  const holder = await addressHolder(f.email);
  if (holder && holder.userId !== ctx.user.id && holder.proven) return { ok: false, error: EMAIL_TAKEN, field: "email" };
  return { ok: true, f, phone, ctx };
}

/** Step one: the form is right — a code to the company email. */
export async function sendPhoneSetupCode(raw: unknown): Promise<{ ok: true; draft: string; email: string; resendAt: number } | { ok: true; done: true } | Refused> {
  try {
    const p = await prepare(raw);
    if (!p.ok) return p;
    if ("nothing" in p) return { ok: true, done: true };
    const me = await db.user.findUnique({ where: { id: p.ctx.user.id }, select: { name: true } });
    const sent = await startEmailConfirm(p.ctx.user.id, p.f.email, me?.name ?? "");
    if (!sent.ok) return { ok: false, error: sent.error, field: "email", resendAt: sent.resendAt };
    return { ok: true, draft: sent.draft, email: p.f.email, resendAt: sent.resendAt };
  } catch (err) {
    console.error("[phoneSetup] code send failed:", err);
    return { ok: false, error: TROUBLE };
  }
}

/** "Resend code": a new code to the same address (its old one stops working), after the same brakes. */
export async function resendPhoneSetupCode(draft: string): Promise<{ ok: true; resendAt: number } | Refused> {
  try {
    const { user } = await requireOrg();
    const d = await confirmDraftOf(draft, user.id);
    if (!d) return { ok: false, error: GONE, field: "code" };
    const sent = await sendCode(draft, d);
    return sent.ok ? { ok: true, resendAt: sent.resendAt } : { ok: false, error: sent.error, field: "code", resendAt: sent.resendAt };
  } catch (err) {
    console.error("[phoneSetup] resend failed:", err);
    return { ok: false, error: TROUBLE };
  }
}

/** Step two: the code from the email, and the form again — then the screen is saved. */
export async function confirmPhoneSetup(raw: unknown): Promise<{ ok: true } | (Refused & { burned?: boolean })> {
  try {
    const extra = z.object({ draft: z.string().min(10).max(80), code: z.string().max(12) }).safeParse(raw);
    if (!extra.success) return { ok: false, error: "Enter the 6-digit code from the email.", field: "code" };
    const p = await prepare(raw);
    if (!p.ok) return p;
    if ("nothing" in p) return { ok: true };
    const { f, phone, ctx } = p;
    const pending = await confirmDraftOf(extra.data.draft, ctx.user.id);
    if (!pending || pending.email !== f.email) return { ok: false, error: "The email changed since the code was sent. Send a new code.", field: "email" };
    const checked = await checkConfirmCode(extra.data.draft, ctx.user.id, extra.data.code);
    if (!checked.ok) return { ok: false, error: checked.error, field: "code", burned: checked.burned || checked.expired || checked.gone };
    const organizationId = ctx.organizationId;
    await db.$transaction(async (tx) => {
      await proveEmail(tx, ctx.user.id, checked.email);
      await tx.organization.update({ where: { id: organizationId }, data: { name: f.companyName, billingEmail: checked.email, phone: phone ? prettyUsPhone(phone) : null } });
      await clearPhoneSetup(tx, organizationId);
    });
    await clearOrgNameUnset(organizationId);
    await logActivity({
      organizationId,
      actorId: ctx.user.id,
      kind: TRAIL_KINDS.SETTINGS,
      summary: `Finished the company setup — ${f.companyName} (email confirmed)`,
      meta: { area: "company", fields: ["name", "billingEmail", "phone", "email"] },
    }).catch(() => {});
    // The welcome, held since the account was made, now that the address is proven.
    const userId = ctx.user.id;
    after(async () => {
      const w = await takeWelcomeLater(userId).catch(() => null);
      if (!w) return;
      await sendWelcomeFirstEstimate({ ...w, to: checked.email, firstChargeAt: new Date(w.firstChargeAt) }).catch((e) => console.warn("[phoneSetup] welcome email failed:", e));
    });
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return { ok: false, error: EMAIL_TAKEN, field: "email" };
    console.error("[phoneSetup] save failed:", err);
    return { ok: false, error: TROUBLE };
  }
}
