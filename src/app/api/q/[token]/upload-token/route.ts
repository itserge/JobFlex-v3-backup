import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { tokenDoor } from "@/lib/projectSubs/server";
import { docFolder } from "@/lib/subDocs/server";
import { DOC_TYPES, MAX_DOC_BYTES } from "@/lib/subDocs/shared";
import { privateToken } from "@/lib/media/privateStore";
import { publicLinkResponse } from "@/lib/publicLinks";

export const runtime = "nodejs";

// STRAIGHT FROM THE SUB'S BROWSER TO THE PRIVATE STORE (2026-11-08, part 1). A 20 MB estimate does not fit through
// a request body (Vercel caps it at 4.5 MB), so the browser asks here for a short-lived upload token, sends the file
// to the private Blob store itself, then records it (actions/projectSubs quoteSave). A token is handed out only for
// a request the sub's link still answers, under this company's folder, for a PDF or a picture up to 25 MB.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const storeToken = privateToken();
  if (!storeToken) return NextResponse.json({ error: "File storage is not set up on this server." }, { status: 503 });
  const { token } = await ctx.params;
  const paused = await publicLinkResponse("sub-quote", token);
  if (paused) return paused;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) return NextResponse.json({ error: "This link is not valid." }, { status: 403 });
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      token: storeToken,
      onBeforeGenerateToken: async (pathname) => {
        const door = await tokenDoor(token);
        if (!door || !door.canQuote) throw new Error("Not authorized");
        if (!pathname.startsWith(docFolder(door.organizationId))) throw new Error("Wrong folder");
        return {
          allowedContentTypes: [...DOC_TYPES],
          maximumSizeInBytes: MAX_DOC_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 30 * 60_000,
          tokenPayload: JSON.stringify({ quoteId: door.quoteId }),
        };
      },
      // The browser records the file the moment its upload completes; this callback (a webhook from the store) is
      // not relied on.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload refused";
    return NextResponse.json({ error: message }, { status: message === "Not authorized" ? 403 : 400 });
  }
}
