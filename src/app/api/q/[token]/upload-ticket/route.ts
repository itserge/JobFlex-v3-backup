import { NextResponse } from "next/server";
import { tokenDoor } from "@/lib/projectSubs/server";
import { uploadPlan } from "@/lib/subDocs/server";
import { rateLimitShared, ipFromRequest } from "@/lib/rateLimit";
import { publicLinkResponse } from "@/lib/publicLinks";

export const runtime = "nodejs";

// WHERE A SUB'S DOCUMENT GOES (2026-11-08, the subcontractors plan, part 1, lib/subDocs). The sub's page asks before
// anything moves: the token must open a request that still takes a price, the file must be a PDF or a picture of
// at most 25 MB. The answer names the path and the way — the private Blob store, or this machine's disk in
// development. Twenty asks an hour per address.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const paused = await publicLinkResponse("sub-quote", token);
  if (paused) return paused;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) return NextResponse.json({ error: "This link is not valid." }, { status: 403 });
  const rl = await rateLimitShared(`sub-upload:${ipFromRequest(req)}`, 20, 60 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many uploads at once — try again in a few minutes." }, { status: 429 });
  let body: { name?: string; contentType?: string; bytes?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const door = await tokenDoor(token);
  if (!door || !door.canQuote) return NextResponse.json({ error: door ? "This request is closed — thank you." : "This link is not valid." }, { status: 403 });
  const plan = uploadPlan(door.organizationId, door.projectId, body.name, body.contentType, Number(body.bytes));
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  return NextResponse.json({ mode: plan.mode, pathname: plan.pathname, uploadUrl: plan.uploadUrl });
}
