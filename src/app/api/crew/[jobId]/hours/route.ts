import { NextResponse } from "next/server";
import { crewActorForJob, jsonBody } from "@/lib/crewActor";
import { logHours } from "@/lib/crewField/server";
import { touchWorkerActivity } from "@/lib/workerActivity";

export const runtime = "nodejs";

// HOURS ON A JOB, FROM EITHER DOOR (the crew build, 2026-11-05): the crew types their own (today's, or a past
// day's by its date); the office may type anyone's with `workerId`.
export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const body = await jsonBody<{ token: string; hours: number | string; date: string; note: string; workerId: string }>(req);
  const actor = await crewActorForJob(jobId, body.token ?? null);
  if (!actor) return NextResponse.json({ error: "You can only work on a job you are on." }, { status: 403 });
  const workerId = actor.office && typeof body.workerId === "string" && body.workerId ? body.workerId : actor.workerId;
  if (!workerId) return NextResponse.json({ error: "Whose hours? Pick a crew member." }, { status: 400 });
  try {
    const r = await logHours({
      organizationId: actor.organizationId,
      jobId,
      workerId,
      date: typeof body.date === "string" ? body.date : null,
      hours: body.hours ?? 0,
      note: typeof body.note === "string" ? body.note : null,
      actorId: actor.userId,
    });
    if (actor.workerId && actor.viaToken) await touchWorkerActivity(actor.workerId);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save the hours." }, { status: 400 });
  }
}
