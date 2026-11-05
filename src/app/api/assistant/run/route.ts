// POST /api/assistant/run — the build the panel just started (2026-11-05, slice 3). Pricing a job with Smart
// Proposal is a minute's AI estimate: the panel's ask answers at once ("On it…") and hands back the build left to
// run; the panel then calls here, a route with room for the minute, and reloads the conversation when it returns.
// Only the signed-in person's own queued build runs, once (lib/assistant/engine runAction claims it); the minute
// job runs any the panel never called for. It carries its own auth — the middleware does not match /api.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { actorForSession } from "@/lib/assistant/actor";
import { runAndReport } from "@/lib/assistant/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let id = "";
  try {
    const body = (await req.json()) as { id?: unknown };
    id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
  } catch {
    id = "";
  }
  if (!id) return NextResponse.json({ error: "Which one?" }, { status: 400 });
  let actor;
  try {
    actor = await actorForSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  }
  const mine = await db.assistantAction.findFirst({ where: { id, organizationId: actor.organizationId, userId: actor.userId, status: "QUEUED" }, select: { id: true } });
  if (!mine) return NextResponse.json({ ok: true, ran: false });
  const ran = await runAndReport(mine.id, new Date(), { early: true }).catch(() => false);
  return NextResponse.json({ ok: true, ran });
}
