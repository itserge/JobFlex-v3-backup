import { contractDocumentForToken } from "@/lib/subContracts/server";
import { streamStored } from "@/lib/subDocs/server";
import { publicLinkResponse } from "@/lib/publicLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ONE FILE ON A SUBCONTRACT (2026-11-08, the subcontractors plan, part 4): an attachment of the agreement (the
// awarded estimate, a drawing) or the signed PDF, read through the contract's token, which is checked every time —
// only the files on that contract, never another of the company's. `?download=1` gets it as an attachment.
export async function GET(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  const paused = await publicLinkResponse("subcontract", token);
  if (paused) return paused;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return text("Not found", 404);
  const doc = await contractDocumentForToken(token, id);
  if (!doc) return text("Not found", 404);
  const download = new URL(req.url).searchParams.get("download") ? doc.name : null;
  try {
    return await streamStored(doc.url, { range: req.headers.get("range"), download, contentType: doc.contentType });
  } catch (err) {
    console.warn("[s/file] could not read the file:", err instanceof Error ? err.message : err);
    return text("File storage is not reachable right now.", 503);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
