"use server";
// THE ACCOUNT'S OWN PASSWORD (owner, 2026-10-10). A passwordless or Google
// account adds one; an account that has one changes it with the current one.
// Only ever the signed-in user's own row — no id is taken from the browser.
// The account's address is told by email (reply-to support). Signing in with
// a code or with Google is not touched. Refusals are returned as words.
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/orgContext";
import { MINUTE, rateLimitShared, retryInWords } from "@/lib/rateLimit";
import { appBaseUrl } from "@/lib/appUrl";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildPasswordSet } from "@/lib/email/build/accountPassword";
import { sendEmail } from "@/lib/sdk/resend";

const input = z.object({
  current: z.string().max(200).optional(),
  password: z.string().min(8, "Use at least 8 characters.").max(200, "That password is too long."),
  confirm: z.string().max(200),
});

export async function setMyPassword(raw: unknown): Promise<{ ok: true; added: boolean } | { ok: false; error: string; field?: "current" | "password" | "confirm" }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the password.", field: "password" };
  const { current, password, confirm } = parsed.data;
  if (password !== confirm) return { ok: false, error: "The two passwords don't match.", field: "confirm" };
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return { ok: false, error: "Sign in again to change your password." };
  }
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true, hashedPassword: true } });
    if (!user) return { ok: false, error: "Sign in again to change your password." };
    const added = !user.hashedPassword;
    if (!added) {
      // The current password is a guess worth braking: eight tries in fifteen minutes.
      const gate = await rateLimitShared(`pw-change:${userId}`, 8, 15 * MINUTE);
      if (!gate.ok) return { ok: false, error: `Too many tries. Try again in ${retryInWords(gate.retryAfterMs)}.`, field: "current" };
      if (!current || !(await bcrypt.compare(current, user.hashedPassword!))) {
        return { ok: false, error: "Your current password isn't right.", field: "current" };
      }
    }
    await db.user.update({ where: { id: userId }, data: { hashedPassword: await bcrypt.hash(password, 10) } });
    try {
      const base = (await appBaseUrl()).replace(/\/$/, "");
      const { subject, html, text } = renderEmail(buildPasswordSet({ name: user.name, email: user.email, added, at: new Date(), forgotHref: `${base}/auth/forgot` }));
      await sendEmail({ mailClass: "transactional", to: user.email, subject, html, text, replyTo: "support@jobflex.app", kind: "password-reset" });
    } catch (err) {
      console.warn("[account] password notice not sent:", err instanceof Error ? err.message : err);
    }
    return { ok: true, added };
  } catch (err) {
    console.error("[account] password not saved:", err);
    return { ok: false, error: "Couldn't save the password. Try again." };
  }
}
