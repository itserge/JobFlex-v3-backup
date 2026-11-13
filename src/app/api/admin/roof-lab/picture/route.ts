// GET /api/admin/roof-lab/picture?id=<measurementId>&kind=photo|relief
//
// The picture the roof facet lab draws on (2026-11-11): Google's aerial photograph of the roof, or its height map
// shaded as a relief — both cut to the same patch of ground the drawing's own frame names (lib/roofFacets/server).
// Platform admins only: 401 without a session, 403 for anyone else. A picture of a saved roof does not change, so the
// admin's own browser may keep it for a day.

import { requirePlatformAdmin } from "@/lib/orgContext";
import { roofLabPicture } from "@/lib/roofFacets/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    const forbidden = err instanceof Error && err.message === "Platform admin only";
    return Response.json({ error: forbidden ? "Platform admins only." : "Sign in to the admin console." }, { status: forbidden ? 403 : 401, headers: NO_STORE });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") === "photo" ? "photo" : "relief";
  if (!id || id.length > 64) return Response.json({ error: "Which roof?" }, { status: 400, headers: NO_STORE });
  try {
    const r = await roofLabPicture(id, kind);
    if (!r.ok) return Response.json({ error: r.reason }, { status: 404, headers: NO_STORE });
    return new Response(new Uint8Array(r.png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    console.error("[roof-lab] picture failed:", err);
    return Response.json({ error: "The picture could not be made." }, { status: 500, headers: NO_STORE });
  }
}
