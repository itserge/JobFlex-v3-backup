// GOOGLE ONE TAP, VERIFIED HERE (landing-e pass A, 2026-09-11).
//
// The browser posts the ID token Google's prompt handed it. The token is
// verified against our OAuth client (signature, audience, expiry) with
// google-auth-library; only a Google-verified email counts. Then, exactly
// the two outcomes the Google button already has (lib/auth signIn callback):
//   · an address JobFlex knows → a one-time sign-in ticket, redeemed by the
//     `signup-ticket` provider in the browser (same as the pay-first signup);
//   · a new address → the identity is parked (lib/googleSignup) and the
//     visitor is sent to /auth/register?gsu=… at step 2, with the trade and
//     the campaign the landing's cookies remember.
// No account is ever created here (owner's rule, 2026-09-03).
import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/db";
import { mintSigninTicket } from "@/lib/signinTicket";
import { googleSignupReturnUrl, stashGoogleSignup } from "@/lib/googleSignup";
import { clientIp, enforceRateLimit, MINUTE } from "@/lib/rateLimit";
import { isDisposableEmail } from "@/lib/disposableEmail";
import { isEmailUnproven } from "@/lib/emailProof";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503 });
  try {
    await enforceRateLimit(`google-onetap:ip:${await clientIp()}`, 20, MINUTE);
  } catch {
    return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { credential?: unknown } | null;
  const credential = typeof body?.credential === "string" ? body.credential : "";
  if (!credential || credential.length > 4096) return NextResponse.json({ error: "Missing credential." }, { status: 400 });

  let email = "";
  let name: string | null = null;
  let image: string | null = null;
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.email || p.email_verified !== true) throw new Error("unverified");
    email = p.email.toLowerCase();
    name = p.name ?? null;
    image = p.picture ?? null;
  } catch {
    return NextResponse.json({ error: "Google could not verify that sign-in." }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  // An address held unproven (lib/emailProof) signs nothing in: its Google owner signs up and takes it over.
  if (user && !(await isEmailUnproven(user.id))) return NextResponse.json({ ticket: await mintSigninTicket(user.id) });
  // A throwaway-mail domain is not parked; the register page says why.
  if (isDisposableEmail(email)) return NextResponse.json({ redirect: "/auth/register?gerr=disposable" });
  const handle = await stashGoogleSignup({ email, name, image });
  return NextResponse.json({ redirect: await googleSignupReturnUrl(handle) });
}
