// GET /api/integrations/ramp/connect — the contractor sends JobFlex to Ramp to be authorized on their business
// (2026-10-29). The OAuth state rides in an encrypted cookie with the workspace and the person, the way the Meta
// connection does; the callback checks all three.
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/orgContext";
import { encryptSecret, isSecretBoxConfigured } from "@/lib/crypto/secretBox";
import { rampAuthorizeUrl, rampEnv } from "@/lib/ramp/client";
import { MINUTE, rateLimitShared } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, user } = await requireManager();
    const env = rampEnv();
    if (!env || !isSecretBoxConfigured()) return NextResponse.json({ error: "Ramp is not switched on for this platform yet." }, { status: 403 });
    if (!(await rateLimitShared(`ramp:oauth:${user.id}`, 10, 10 * MINUTE)).ok) return NextResponse.json({ error: "Please wait before connecting again." }, { status: 429 });
    const redirect = new URL(env.redirectUri);
    if (req.nextUrl.origin !== redirect.origin) return NextResponse.redirect(new URL("/api/integrations/ramp/connect", redirect.origin));
    const state = crypto.randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(rampAuthorizeUrl(env, state));
    response.cookies.set("jf_ramp_oauth", encryptSecret(JSON.stringify({ state, organizationId, actorId: user.id, expiresAt: Date.now() + 10 * MINUTE })), {
      httpOnly: true,
      sameSite: "lax",
      secure: redirect.protocol === "https:",
      path: "/api/integrations/ramp",
      maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Sign in as a workspace owner or manager to connect Ramp." }, { status: 401 });
  }
}
