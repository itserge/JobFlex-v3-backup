import { NextResponse } from "next/server";
import { contractDoor } from "@/lib/subInvoices/server";
import { uploadPlan } from "@/lib/subDocs/server";
import { rateLimitShared, ipFromRequest } from "@/lib/rateLimit";
import { publicLinkResponse } from "@/lib/publicLinks";

export const runtime = "nodejs";

// WHERE A SUB'S INVOICE OR LIEN WAIVER GOES (2026-11-09, the subcontractors plan, part 5a). The quote page's door
// (../../q/[token]/upload-ticket) closes at the award; a signed contract's page opens this one: the token must open an
// executed contract of a company still here, the file must be a PDF or a picture of at most 25 MB. Twenty asks an hour
// per address, shared with the quote page's.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const paused = await publicLinkResponse("subcontract", token);
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
  const door = await contractDoor(token);
  if (!door) return NextResponse.json({ error: "This link does not take files — the contract is not signed, or the link is not valid." }, { status: 403 });
  const plan = uploadPlan(door.organizationId, door.projectId, body.name, body.contentType, Number(body.bytes));
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  return NextResponse.json({ mode: plan.mode, pathname: plan.pathname, uploadUrl: plan.uploadUrl });
}
