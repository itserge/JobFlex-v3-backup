// GET /api/assistant/drawing/<proposalId> (2026-11-05, batch 4) — the deck's own plan as lines, for the phone's
// sheet to draw in the real build order: the DECK_PLAN the Deck Studio filed with the proposal (lib/deck/convertSchema),
// through the studio's isometric projection (lib/deck/iso) with the shading left out. One company's own proposals
// only, as the Proposals page scopes them. It carries its own auth — the middleware does not match /api.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { actorForSession, proposalScope } from "@/lib/assistant/actor";
import { DECK_PLAN_EVENT } from "@/lib/deck/convertSchema";
import { isoDrawing } from "@/lib/deck/iso";
import type { DeckScene } from "@/lib/deck/scene";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await ctx.params;
  let actor;
  try {
    actor = await actorForSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  }
  const p = await db.proposal.findFirst({ where: { id: proposalId.slice(0, 64), organizationId: actor.organizationId, ...proposalScope(actor) }, select: { id: true } });
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const ev = await db.activityEvent.findFirst({ where: { proposalId: p.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
  let scene: DeckScene | null = null;
  try {
    const raw = ev?.meta ? (JSON.parse(ev.meta) as { scene?: unknown }) : null;
    scene = raw?.scene && typeof raw.scene === "object" ? (raw.scene as DeckScene) : null;
  } catch {
    scene = null;
  }
  if (!scene) return NextResponse.json({ error: "No drawing for this proposal." }, { status: 404 });
  try {
    const d = isoDrawing(scene, { detail: "quick", maxSolids: 700 });
    const faces = d.faces.filter((f) => f.layer !== "shadow" && f.layer !== "ground").map((f) => ({ d: f.d, rank: f.rank, layer: f.layer }));
    return NextResponse.json({ viewBox: d.viewBox, faces }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "The drawing couldn't be made." }, { status: 500 });
  }
}
