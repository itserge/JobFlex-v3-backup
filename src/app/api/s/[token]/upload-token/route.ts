import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { contractDoor } from "@/lib/subInvoices/server";
import { docFolder } from "@/lib/subDocs/server";
import { DOC_TYPES, MAX_DOC_BYTES } from "@/lib/subDocs/shared";
import { privateToken } from "@/lib/media/privateStore";

export const runtime = "nodejs";

// STRAIGHT FROM THE SUB'S BROWSER TO THE PRIVATE STORE, from a signed contract's page (2026-11-09, part 5a): the same
// short-lived upload token as the quote page's (../../q/[token]/upload-token), handed out only while the token opens an
// executed contract, under this company's folder, for a PDF or a picture up to 25 MB. The browser records the file
// after it lands (actions/projectSubs contractInvoiceSave, contractWaiverSave).
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const storeToken = privateToken();
  if (!storeToken) return NextResponse.json({ error: "File storage is not set up on this server." }, { status: 503 });
  const { token } = await ctx.params;
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
        const door = await contractDoor(token);
        if (!door) throw new Error("Not authorized");
        if (!pathname.startsWith(docFolder(door.organizationId))) throw new Error("Wrong folder");
        return {
          allowedContentTypes: [...DOC_TYPES],
          maximumSizeInBytes: MAX_DOC_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 30 * 60_000,
          tokenPayload: JSON.stringify({ contractId: door.contractId }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload refused";
    return NextResponse.json({ error: message }, { status: message === "Not authorized" ? 403 : 400 });
  }
}
