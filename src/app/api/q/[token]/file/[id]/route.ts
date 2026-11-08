import { documentForToken } from "@/lib/projectSubs/server";
import { streamStored } from "@/lib/subDocs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ONE FILE FOR THE SUB (2026-11-08, part 1): a drawing the office attached to the request, or an estimate the sub
// sent on this request — read through the sub's token, which is checked every time; nothing here is a permanent
// link. A file the office linked (a Drive link) is a redirect to where it lives. `?download=1` gets the file as an
// attachment; otherwise it streams inline for the page's viewer.
export async function GET(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return text("Not found", 404);
  const doc = await documentForToken(token, id);
  if (!doc) return text("Not found", 404);
  if (doc.isLink) return new Response(null, { status: 302, headers: { Location: doc.url, "Cache-Control": "private, no-store" } });
  const url = new URL(req.url);
  const download = url.searchParams.get("download") ? doc.name : null;
  try {
    return await streamStored(doc.url, { range: req.headers.get("range"), download, contentType: doc.contentType });
  } catch (err) {
    console.warn("[q/file] could not read the file:", err instanceof Error ? err.message : err);
    return text("File storage is not reachable right now.", 503);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
