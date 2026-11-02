// GET /api/integrations/ramp/callback — Ramp sends the contractor back with a code (2026-10-29). The code becomes
// the business's tokens, the business is read and remembered, the "JobFlex job" field and the webhook are set up,
// and the last thirty days of card spend are read onto the jobs. Then back to Integrations with a word on how it went.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireManager } from "@/lib/orgContext";
import { decryptSecret } from "@/lib/crypto/secretBox";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { RampApi, rampEnv, rampToken } from "@/lib/ramp/client";
import { writeRampConnection } from "@/lib/ramp/connection";
import { ensureRampField, ensureRampWebhook, syncRamp } from "@/lib/ramp/sync";

export const dynamic = "force-dynamic";

const safeEqual = (a: string, b: string) => a.length === b.length && a.split("").every((ch, i) => ch === b[i]);

export async function GET(req: NextRequest) {
  const env = rampEnv();
  const base = env ? new URL(env.redirectUri).origin : req.nextUrl.origin;
  const back = (status: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard/settings?tab=integrations&sub=ramp&ramp=${status}`, base));
    response.cookies.set("jf_ramp_oauth", "", { path: "/api/integrations/ramp", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  try {
    if (!env) return back("failed");
    const cookie = req.cookies.get("jf_ramp_oauth")?.value;
    const state = req.nextUrl.searchParams.get("state");
    if (!cookie || !state) return back("invalid_state");
    const saved = z.object({ state: z.string(), organizationId: z.string(), actorId: z.string(), expiresAt: z.number() }).parse(JSON.parse(decryptSecret(cookie)));
    const { organizationId, user } = await requireManager();
    if (!safeEqual(state, saved.state) || saved.expiresAt < Date.now() || saved.organizationId !== organizationId || saved.actorId !== user.id) return back("invalid_state");
    if (req.nextUrl.searchParams.has("error")) return back("denied");
    const code = req.nextUrl.searchParams.get("code");
    if (!code) return back("denied");
    const t = await rampToken(env, { grant_type: "authorization_code", code, redirect_uri: env.redirectUri });
    const api = new RampApi(env, t.access_token);
    const biz = await api.business();
    if (!biz.id) return back("failed");
    const now = Date.now();
    await writeRampConnection(organizationId, {
      businessId: biz.id,
      businessName: biz.business_name_legal || biz.business_name_on_card || "Ramp business",
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: now + (t.expires_in ?? 3600) * 1000,
      refreshExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : null,
      scope: t.scope ?? "",
      connectedAt: new Date(now).toISOString(),
      actorId: user.id,
      fieldRampId: null,
      fieldOptionsAt: null,
      webhookId: null,
      webhookSecret: null,
      webhookVerified: false,
      lastSyncAt: null,
      lastSyncCount: 0,
      lastError: null,
      askByText: true,
      requireJob: true,
      billsApproved: false,
      entityId: null,
      sourceBankAccountId: null,
    });
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Connected Ramp — ${biz.business_name_legal || biz.business_name_on_card || "the business"}: card spend lands on the jobs`, meta: { area: "ramp" } });
    // The field, the webhook and the first read: each on its own, none allowed to undo the connection.
    await ensureRampField(organizationId).catch((err) => console.warn("[ramp] field:", err instanceof Error ? err.message : err));
    await ensureRampWebhook(organizationId).catch((err) => console.warn("[ramp] webhook:", err instanceof Error ? err.message : err));
    await syncRamp(organizationId, { since: new Date(now - 30 * 86_400_000) }).catch(() => null);
    return back("connected");
  } catch {
    // No codes, tokens or Ramp responses in the log.
    return back("failed");
  }
}
