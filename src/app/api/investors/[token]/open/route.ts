import { NextResponse } from "next/server";
import { investorLinkOpen } from "@/lib/investors";
import { openWithKey } from "@/lib/investorVisitors";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";

export const runtime = "nodejs";

// THE OPEN LINK an approval emails (2026-10-20): the key names one reader of one shared link and is signed with that
// link's token, so it opens this browser for them (their pass is set) and nothing else; a new link ends it. Anything
// wrong — forged or cut short, not let in — lands on the page's door with a word, never on the figures. No clock on
// it (owner, 2026-11-03): it opens as long as the link lives.
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const gate = await rateLimitShared(`investors-open:${ipFromRequest(req)}`, 30, HOUR);
  if (!gate.ok) return new Response("Too many requests", { status: 429 });
  const page = new URL(`/investors/${token}`, req.url);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !(await investorLinkOpen(token))) return NextResponse.redirect(page);
  const result = await openWithKey(token, new URL(req.url).searchParams.get("k"));
  if (result !== "open") page.searchParams.set("open", result === "not-approved" ? "closed" : "bad");
  return NextResponse.redirect(page);
}
