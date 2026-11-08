import { requireOrg } from "@/lib/orgContext";
import { documentFor, streamStored } from "@/lib/subDocs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ONE SUB DOCUMENT FOR THE OFFICE (2026-11-08, part 1): the bytes of an estimate (later an invoice, a contract, a
// certificate) for the in-app viewer and for Download — the reader's session is checked every time and the file
// must be the company's. `?download=1` gets it as an attachment; otherwise it streams inline for pdf.js.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return text("Not found", 404);
  let organizationId: string;
  try {
    organizationId = (await requireOrg()).organizationId;
  } catch {
    return text("Not found", 404);
  }
  const doc = await documentFor(organizationId, id);
  if (!doc) return text("Not found", 404);
  const url = new URL(req.url);
  const download = url.searchParams.get("download") ? doc.name : null;
  try {
    return await streamStored(doc.url, { range: req.headers.get("range"), download, contentType: doc.contentType });
  } catch (err) {
    console.warn("[subs/doc] could not read the file:", err instanceof Error ? err.message : err);
    return text("File storage is not reachable right now.", 503);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
