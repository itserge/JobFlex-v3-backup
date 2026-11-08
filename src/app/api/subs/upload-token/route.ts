import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { docFolder } from "@/lib/subDocs/server";
import { DOC_TYPES, MAX_DOC_BYTES } from "@/lib/subDocs/shared";
import { privateToken } from "@/lib/media/privateStore";

export const runtime = "nodejs";

// STRAIGHT FROM THE OFFICE'S BROWSER TO THE PRIVATE STORE (2026-11-08, part 1): the upload token for a sub
// document, handed out to an estimator or a manager, under their company's folder only, for a PDF or a picture up
// to 25 MB. The browser records the file after it lands (actions/projectSubs).
export async function POST(req: Request) {
  const storeToken = privateToken();
  if (!storeToken) return NextResponse.json({ error: "File storage is not set up on this server." }, { status: 503 });
  let organizationId: string;
  try {
    organizationId = (await requireEstimatorOrManager()).organizationId;
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
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
        if (!pathname.startsWith(docFolder(organizationId))) throw new Error("Wrong folder");
        return {
          allowedContentTypes: [...DOC_TYPES],
          maximumSizeInBytes: MAX_DOC_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 30 * 60_000,
          tokenPayload: JSON.stringify({ organizationId }),
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
