import { NextResponse } from "next/server";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { uploadPlan } from "@/lib/subDocs/server";

export const runtime = "nodejs";

// WHERE THE OFFICE'S DOCUMENT GOES (2026-11-08, the subcontractors plan, part 1): an estimate uploaded on a sub's
// behalf, a drawing for a request, later an invoice or a certificate. The caller must run projects (an estimator
// or a manager); the project, when named, must be the company's; the file a PDF or a picture up to 25 MB.
export async function POST(req: Request) {
  let ctx: { organizationId: string };
  try {
    ctx = await requireEstimatorOrManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  let body: { name?: string; contentType?: string; bytes?: number; projectId?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  let projectId: string | null = null;
  if (body.projectId) {
    const p = await db.project.findFirst({ where: { id: body.projectId, organizationId: ctx.organizationId }, select: { id: true } });
    if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    projectId = p.id;
  }
  const plan = uploadPlan(ctx.organizationId, projectId, body.name, body.contentType, Number(body.bytes));
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  return NextResponse.json({ mode: plan.mode, pathname: plan.pathname, uploadUrl: plan.uploadUrl });
}
