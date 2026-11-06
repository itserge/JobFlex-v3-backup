import { NextResponse } from "next/server";
import { crewActorForJob, jsonBody } from "@/lib/crewActor";
import { raiseFlag, resolveFlag } from "@/lib/crewField/server";
import { touchWorkerActivity } from "@/lib/workerActivity";

export const runtime = "nodejs";

// A PROBLEM FROM SITE (the crew build, 2026-11-05): POST raises one (the crew or the office); PATCH resolves one
// (the office only). The office is texted and emailed the moment a flag goes up.
export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const body = await jsonBody<{ token: string; note: string; blocking: boolean }>(req);
  const actor = await crewActorForJob(jobId, body.token ?? null);
  if (!actor) return NextResponse.json({ error: "You can only work on a job you are on." }, { status: 403 });
  try {
    const r = await raiseFlag({ organizationId: actor.organizationId, jobId, workerId: actor.workerId, raisedById: actor.userId, raisedByName: actor.name, note: typeof body.note === "string" ? body.note : "", blocking: body.blocking === true });
    if (actor.workerId && actor.viaToken) await touchWorkerActivity(actor.workerId);
    return NextResponse.json({ ok: true, id: r.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not send it." }, { status: 400 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const body = await jsonBody<{ token: string; flagId: string; resolution: string }>(req);
  const actor = await crewActorForJob(jobId, body.token ?? null);
  if (!actor) return NextResponse.json({ error: "You can only work on a job you are on." }, { status: 403 });
  if (!actor.office) return NextResponse.json({ error: "The office resolves a problem." }, { status: 403 });
  if (typeof body.flagId !== "string" || !body.flagId) return NextResponse.json({ error: "Which problem?" }, { status: 400 });
  try {
    await resolveFlag(actor.organizationId, body.flagId, typeof body.resolution === "string" ? body.resolution : null, actor.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not resolve it." }, { status: 400 });
  }
}
