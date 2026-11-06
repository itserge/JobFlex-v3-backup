import { NextResponse } from "next/server";
import { crewActorForJob, jsonBody } from "@/lib/crewActor";
import { crewTickTask } from "@/lib/crewField/server";
import { touchWorkerActivity } from "@/lib/workerActivity";

export const runtime = "nodejs";

// A TASK TICKED FROM SITE (the crew build, 2026-11-05): a task of the job's project, by the crew on the job or the
// office. The last tick of a stage marks it done (lib/projectStages markTask).
export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const body = await jsonBody<{ token: string; taskId: string; done: boolean }>(req);
  const actor = await crewActorForJob(jobId, body.token ?? null);
  if (!actor) return NextResponse.json({ error: "You can only work on a job you are on." }, { status: 403 });
  if (typeof body.taskId !== "string" || !body.taskId) return NextResponse.json({ error: "Which task?" }, { status: 400 });
  try {
    await crewTickTask(actor.organizationId, jobId, body.taskId, body.done !== false, actor.userId);
    if (actor.workerId && actor.viaToken) await touchWorkerActivity(actor.workerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not tick it." }, { status: 400 });
  }
}
