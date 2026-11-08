import { requireOrg } from "@/lib/orgContext";
import { inboundRawFor } from "@/lib/subInbound/server";
import { streamStored } from "@/lib/subDocs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE RAW MESSAGE OF AN INBOUND EMAIL (2026-11-08, the subcontractors plan, part 2): the .eml a held letter arrived
// as, for the office to download and open in their mail app when the excerpt is not enough. The reader's session is
// checked every time and the letter must be the company's; always an attachment.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return text("Not found", 404);
  let organizationId: string;
  try {
    organizationId = (await requireOrg()).organizationId;
  } catch {
    return text("Not found", 404);
  }
  const raw = await inboundRawFor(organizationId, id);
  if (!raw) return text("Not found", 404);
  try {
    return await streamStored(raw.url, { range: null, download: raw.name, contentType: "message/rfc822" });
  } catch (err) {
    console.warn("[subs/inbound/raw] could not read the file:", err instanceof Error ? err.message : err);
    return text("File storage is not reachable right now.", 503);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
