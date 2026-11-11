// GOOGLE ON THE SIGNUP PAGE — identity only, never an account.
//
// Until 2026-09-03 a Google sign-in for an address JobFlex had never seen
// provisioned an organization on the spot and dropped the visitor on the
// dashboard with no plan — the one thing the pay-first signup exists to
// prevent (owner's report). Google now proves WHO the visitor is and nothing
// more: the verified identity is parked here for a few minutes and the
// visitor is sent back into the signup at step 2 (company), then step 3 (the
// plan), and the account is created only when checkout returns — exactly as
// a password signup is. The pending intent records that the account is
// Google-backed (no password), and the finished User signs in with Google.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

const TTL_MS = 20 * 60 * 1000;

export interface GoogleSignupIdentity {
  email: string;
  name: string | null;
  image: string | null;
}

function key(raw: string): string {
  return `google-signup:${hashToken(raw)}`;
}

/** Park a Google-verified identity; returns the handle the register page carries. */
export async function stashGoogleSignup(identity: GoogleSignupIdentity): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  await db.syncState.create({
    data: { key: key(raw), cursor: JSON.stringify({ ...identity, at: Date.now() }) },
  });
  return raw;
}

/** Where a NEW Google address is sent after consent: the register form at
 *  step 2, with the trade hero and the utm_* the landing remembered in its
 *  cookies (the Google button writes them synchronously before leaving).
 *  Runs inside the auth callback's request, so `cookies()` is the visitor's
 *  jar; any read failure falls back to the bare handle (CRO stage 1). */
export async function googleSignupReturnUrl(handle: string): Promise<string> {
  const q = new URLSearchParams({ gsu: handle });
  try {
    const { cookies } = await import("next/headers");
    const { FBCLID_COOKIE, INDUSTRY_COOKIE, UTM_COOKIE, UTM_KEYS, parseUtmCookie, pickFbclid, resolveLandingVariant } =
      await import("@/components/v3/landing-e/landing-variants");
    const jar = await cookies();
    const industry = resolveLandingVariant(jar.get(INDUSTRY_COOKIE)?.value);
    if (industry) q.set("industry", industry);
    // The tool the ad sold, remembered beside the trade (lib/planSpotlight) — a new plans' key too (keptAdTool), which
    // every Classic surface reads as no tool.
    const { SPOTLIGHT_COOKIE, keptAdTool } = await import("@/lib/planSpotlight");
    const tool = keptAdTool(jar.get(SPOTLIGHT_COOKIE)?.value);
    if (tool) q.set("tool", tool);
    const utm = parseUtmCookie(jar.get(UTM_COOKIE)?.value);
    for (const key of UTM_KEYS) if (utm[key]) q.set(key, utm[key] as string);
    // The ad's click id, left by the landing's Google button (FBCLID_COOKIE).
    const fbclid = pickFbclid({ fbclid: jar.get(FBCLID_COOKIE)?.value });
    if (fbclid) q.set("fbclid", fbclid);
  } catch {
    /* no request cookies here — the register page reads the same cookies itself */
  }
  return `/auth/register?${q.toString()}`;
}

/** Read a parked identity (not consumed — the same handle serves the whole
 *  signup until the intent is created). Null when missing or stale. */
export async function readGoogleSignup(raw: string): Promise<GoogleSignupIdentity | null> {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 80) return null;
  const row = await db.syncState.findUnique({ where: { key: key(raw) } }).catch(() => null);
  if (!row) return null;
  try {
    const rec = JSON.parse(row.cursor) as GoogleSignupIdentity & { at?: number };
    if (!rec?.email || Date.now() - (rec.at ?? 0) > TTL_MS) return null;
    return { email: rec.email.toLowerCase(), name: rec.name ?? null, image: rec.image ?? null };
  } catch {
    return null;
  }
}

export async function consumeGoogleSignup(raw: string): Promise<void> {
  await db.syncState.delete({ where: { key: key(raw) } }).catch(() => {});
}
