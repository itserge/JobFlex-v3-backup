import { NextResponse } from "next/server";
import { crewActorForJob, jsonBody } from "@/lib/crewActor";
import { tickPunch } from "@/lib/projectFinish/server";
import { touchWorkerActivity } from "@/lib/workerActivity";

export const runtime = "nodejs";

// A PUNCH ITEM FROM SITE (the timeline build, 2026-11-06): POST ticks one done — with the "after" photo's id when
// the crew took one (uploaded first through /api/jobs/media, as any job photo) — or reopens it. The crew or the
// office, through the door the job page opened with.
export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const body = await jsonBody<{ token: string; itemId: string; done: boolean; photoId: string | null }>(req);
  const actor = await crewActorForJob(jobId, body.token ?? null);
  if (!actor) return NextResponse.json({ error: "You can only work on a job you are on." }, { status: 403 });
  if (typeof body.itemId !== "string" || !body.itemId) return NextResponse.json({ error: "Which item?" }, { status: 400 });
  try {
    const r = await tickPunch(actor.organizationId, body.itemId, body.done !== false, typeof body.photoId === "string" && body.photoId ? body.photoId : null, actor.userId, actor.name);
    if (actor.workerId && actor.viaToken) await touchWorkerActivity(actor.workerId);
    return NextResponse.json({ ok: true, openLeft: r.openLeft });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save it." }, { status: 400 });
  }
}
