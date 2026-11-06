import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crewActorForJob, jsonBody } from "@/lib/crewActor";
import { receiveOrder } from "@/lib/projectBuying/server";
import { touchWorkerActivity } from "@/lib/workerActivity";

export const runtime = "nodejs";

// A DELIVERY TAKEN ON SITE (the crew build, 2026-11-05): the crew on a job of the project marks an order delivered,
// line by line — what did not come goes back on the to-buy list and the office is told (lib/projectBuying).
export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const body = await jsonBody<{ token: string; orderId: string; lines: Array<{ lineId: string; receivedQty: number }> }>(req);
  const actor = await crewActorForJob(jobId, body.token ?? null);
  if (!actor) return NextResponse.json({ error: "You can only work on a job you are on." }, { status: 403 });
  if (typeof body.orderId !== "string" || !Array.isArray(body.lines)) return NextResponse.json({ error: "Which order?" }, { status: 400 });
  const job = await db.job.findFirst({ where: { id: jobId, organizationId: actor.organizationId }, select: { projectId: true } });
  const order = job?.projectId ? await db.projectOrder.findFirst({ where: { id: body.orderId, projectId: job.projectId }, select: { id: true } }) : null;
  if (!order) return NextResponse.json({ error: "That order is not on this job's project." }, { status: 404 });
  const lines = body.lines.filter((l) => l && typeof l.lineId === "string" && typeof l.receivedQty === "number" && l.receivedQty >= 0).map((l) => ({ lineId: l.lineId, receivedQty: l.receivedQty }));
  if (!lines.length) return NextResponse.json({ error: "Say what came in." }, { status: 400 });
  try {
    const r = await receiveOrder(actor.organizationId, order.id, lines, actor.userId);
    if (actor.workerId && actor.viaToken) await touchWorkerActivity(actor.workerId);
    return NextResponse.json({ ok: true, missing: r.missing });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not mark it." }, { status: 400 });
  }
}
