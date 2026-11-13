import "server-only";
// AN ADDRESS HELD BUT NOT PROVEN (owner, 2026-11-12, after 813d145a). An account made by a sign-up by text takes the
// email typed on Stripe's card page — nobody has proven that inbox. Until a six-digit code sent to it is typed back on
// "Finish setting up your company" (actions/phoneSetup), the address is the account's on paper only:
//
//   · it does not sign in: the email code answers as if no account had it (lib/signupOtp), a password reset sends
//     nothing (actions/auth), Google and One Tap treat it as a new address (lib/auth, api/auth/google-onetap);
//   · it gets the bills (transactional mail goes as ever) but no marketing and no welcome — the welcome waits and is
//     sent the moment the code is right (welcomeLater below);
//   · it blocks nobody who PROVES it: an email-code or Google sign-up of the same address goes through, and the account
//     that held it unproven gives it up (releaseUnprovenEmail).
//
// HOW AN ADDRESS IS GIVEN UP WITH User.email REQUIRED AND UNIQUE: the holder's email is rewritten to a stand-in no
// person can own — `released+<userId>@unproven.jobflex.invalid` (`.invalid` is reserved, RFC 2606; the user id keeps it
// unique) — in the same transaction that frees it, the company's billing email is emptied when it was that address,
// and the company screen is owed again (lib/phoneSetup), opening with the field empty. The holder still signs in by
// text. No letter is ever sent to a stand-in (lib/sdk/resend withoutBlocked). No schema change: the mark is a SyncState
// row `emailUnproven:<userId>` = the address it was set for.
import { db } from "@/lib/db";
import { markPhoneSetupDue } from "@/lib/phoneSetup";

type Tx = Pick<typeof db, "syncState" | "user" | "organization" | "membership">;

export const emailUnprovenKey = (userId: string) => `emailUnproven:${userId}`;
const welcomeLaterKey = (userId: string) => `welcomeLater:${userId}`;
const STAND_IN_DOMAIN = "unproven.jobflex.invalid";

export const standInEmail = (userId: string) => `released+${userId}@${STAND_IN_DOMAIN}`;
export const isStandInEmail = (email: string | null | undefined): boolean => !!email && email.trim().toLowerCase().endsWith(`@${STAND_IN_DOMAIN}`);

export async function markEmailUnproven(client: Pick<typeof db, "syncState">, userId: string, email: string): Promise<void> {
  await client.syncState.upsert({ where: { key: emailUnprovenKey(userId) }, create: { key: emailUnprovenKey(userId), cursor: email }, update: { cursor: email } });
}

export async function isEmailUnproven(userId: string): Promise<boolean> {
  return Boolean(await db.syncState.findUnique({ where: { key: emailUnprovenKey(userId) }, select: { key: true } }).catch(() => null));
}

/** The account holding this address and whether it proved it. Null: nobody holds it. */
export async function addressHolder(email: string): Promise<{ userId: string; proven: boolean } | null> {
  const u = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!u) return null;
  return { userId: u.id, proven: !(await isEmailUnproven(u.id)) };
}

/** May a sign-up of this address go on? `proven`: the sign-up proved the inbox (an email code, Google). */
export async function addressTaken(email: string, proven: boolean): Promise<boolean> {
  const h = await addressHolder(email);
  return !!h && (h.proven || !proven);
}

/** Of these recipients, the ones that are a held-but-unproven address or a stand-in (marketing skips them). */
export async function unprovenAmong(recipients: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const addrs = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  for (const a of addrs) if (isStandInEmail(a)) out.add(a);
  const rest = addrs.filter((a) => !out.has(a));
  if (!rest.length) return out;
  const users = await db.user.findMany({ where: { email: { in: rest } }, select: { id: true, email: true } });
  if (!users.length) return out;
  const marks = await db.syncState.findMany({ where: { key: { in: users.map((u) => emailUnprovenKey(u.id)) } }, select: { key: true } });
  const marked = new Set(marks.map((m) => m.key));
  for (const u of users) if (marked.has(emailUnprovenKey(u.id))) out.add(u.email.toLowerCase());
  return out;
}

/**
 * Inside a transaction: the account that holds `email` unproven gives it up (see the header). Returns its user id, or
 * null when nobody holds it unproven. Never touches an account that proved its address.
 */
export async function releaseUnprovenEmail(tx: Tx, email: string, exceptUserId?: string): Promise<string | null> {
  const addr = email.trim().toLowerCase();
  const holder = await tx.user.findUnique({ where: { email: addr }, select: { id: true } });
  if (!holder || holder.id === exceptUserId) return null;
  const mark = await tx.syncState.findUnique({ where: { key: emailUnprovenKey(holder.id) }, select: { key: true } });
  if (!mark) return null;
  await tx.user.update({ where: { id: holder.id }, data: { email: standInEmail(holder.id), emailVerified: null } });
  await tx.syncState.update({ where: { key: emailUnprovenKey(holder.id) }, data: { cursor: "" } });
  const owned = await tx.membership.findMany({ where: { userId: holder.id, role: "OWNER" }, select: { organizationId: true } });
  for (const m of owned) {
    await tx.organization.updateMany({ where: { id: m.organizationId, billingEmail: addr }, data: { billingEmail: null } });
    await markPhoneSetupDue(tx, m.organizationId);
  }
  console.info(`[emailProof] an unproven address was proven by another sign-up — account ${holder.id} gave it up`);
  return holder.id;
}

/** The welcome email's facts, kept at the account's creation for the moment the address is proven. */
export type WelcomeLater = {
  name: string;
  tradeTypes: string[];
  landingIndustry: string | null;
  firstChargeAt: string;
  trialDays: number;
  cardless: boolean;
  pages: string[] | null;
};
export async function keepWelcomeLater(client: Pick<typeof db, "syncState">, userId: string, w: WelcomeLater): Promise<void> {
  await client.syncState.upsert({ where: { key: welcomeLaterKey(userId) }, create: { key: welcomeLaterKey(userId), cursor: JSON.stringify(w) }, update: { cursor: JSON.stringify(w) } });
}
/** Taken once: the kept welcome, removed as it is read. */
export async function takeWelcomeLater(userId: string): Promise<WelcomeLater | null> {
  const row = await db.syncState.findUnique({ where: { key: welcomeLaterKey(userId) } }).catch(() => null);
  if (!row) return null;
  const { count } = await db.syncState.deleteMany({ where: { key: welcomeLaterKey(userId) } });
  if (!count) return null;
  try {
    return JSON.parse(row.cursor) as WelcomeLater;
  } catch {
    return null;
  }
}

/** The code was right: the address is this account's, proven. Frees it from an account that held it unproven. */
export async function proveEmail(tx: Tx, userId: string, email: string): Promise<void> {
  const addr = email.trim().toLowerCase();
  await releaseUnprovenEmail(tx, addr, userId);
  await tx.user.update({ where: { id: userId }, data: { email: addr, emailVerified: new Date() } });
  await tx.syncState.deleteMany({ where: { key: emailUnprovenKey(userId) } });
}
