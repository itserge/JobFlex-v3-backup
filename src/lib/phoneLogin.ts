import "server-only";
// ONE NUMBER, ONE ACCOUNT (owner, 2026-11-12). A sign-up by text proves a US mobile (lib/signupOtp, channel "sms");
// the account it makes is found by that number afterwards — the sign-in by text, and step 1 offering sign-in instead
// of a second account. No schema change (owner's choice): the index is a SyncState row `phone-login:<E.164>` =
// { userId, at }, and its key being unique is what makes it one account per number. The number is also written on
// the person (User.phone) and as the office phone (Organization.phone), both free to change; the row is not.
//
// A row whose user is gone (the account deleted) answers "no account" and is cleared the next time the number signs
// up, so deleting an account frees its number the same way it frees its email.
import { db } from "@/lib/db";

export const phoneLoginKey = (e164: string) => `phone-login:${e164}`;

type Row = { userId: string; at: string };

function parse(cursor: string | null | undefined): Row | null {
  try {
    const r = JSON.parse(cursor ?? "") as Row;
    return typeof r?.userId === "string" && r.userId ? r : null;
  } catch {
    return null;
  }
}

/** The account this number signs in to, or null. A row left by a deleted account is no account. */
export async function phoneAccountOf(e164: string | null | undefined): Promise<string | null> {
  if (!e164) return null;
  const row = await db.syncState.findUnique({ where: { key: phoneLoginKey(e164) }, select: { cursor: true } });
  const r = parse(row?.cursor);
  if (!r) return null;
  const user = await db.user.findUnique({ where: { id: r.userId }, select: { id: true } });
  return user ? user.id : null;
}

/** Before a new account takes the number: a row whose user is gone is removed. */
export async function releaseStalePhoneLogin(e164: string): Promise<void> {
  if (await phoneAccountOf(e164)) return;
  await db.syncState.deleteMany({ where: { key: phoneLoginKey(e164) } });
}

/** Inside the account's transaction: the number is this user's now. Throws P2002 when another account holds it. */
export async function linkPhoneLogin(client: Pick<typeof db, "syncState">, userId: string, e164: string): Promise<void> {
  await client.syncState.create({ data: { key: phoneLoginKey(e164), cursor: JSON.stringify({ userId, at: new Date().toISOString() } satisfies Row) } });
}
