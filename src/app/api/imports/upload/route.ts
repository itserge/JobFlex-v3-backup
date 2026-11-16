import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireManager, requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { privateToken, safePathname, storageMode } from "@/lib/media/privateStore";
import { uploadTicket } from "@/lib/media/signedLink";
import { MAX_REQUEST_FILE_BYTES, REQUEST_FILE_TYPES, requestFileType, requestFolder, requestPathname } from "@/lib/import/requests";

export const runtime = "nodejs";

// "DO IT FOR ME" FILES, STRAIGHT FROM THE BROWSER TO THE PRIVATE STORE (2026-11-16, CRM migration plan part 4).
// One route, two kinds of call:
//   · { name, bytes, requestId? } — where the file goes: the store (the browser then uploads with
//     @vercel/blob/client through this same route) or, in development, this machine's disk (/api/crew/upload-local);
//   · Vercel's own upload calls ({ type: "blob.…" }) — the short upload token, for the company's folder only.
// Who: the company's owner, an admin or a manager (their own folder), or a platform admin adding a file to an open
// request (that company's folder). Exported files only — CSV, Excel, Numbers, a PDF or a zip — up to 50 MB each.

/** The company folder this caller may upload into, or null. */
async function folderFor(requestId: string | null): Promise<string | null> {
  if (requestId) {
    try {
      await requirePlatformAdmin();
    } catch {
      return null;
    }
    const r = await db.importRequest.findUnique({ where: { id: requestId }, select: { organizationId: true, status: true } });
    return r && (r.status === "NEW" || r.status === "WORKING") ? r.organizationId : null;
  }
  try {
    return (await requireManager()).organizationId;
  } catch {
    return null;
  }
}

function requestIdOf(clientPayload: unknown): string | null {
  try {
    const p = JSON.parse(typeof clientPayload === "string" ? clientPayload : "null") as { requestId?: unknown } | null;
    return typeof p?.requestId === "string" ? p.requestId.slice(0, 40) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Vercel's upload protocol: the token for one file (and the store's word that it landed).
  if (typeof body.type === "string" && body.type.startsWith("blob.")) {
    const storeToken = privateToken();
    if (!storeToken) return NextResponse.json({ error: "File storage is not set up on this server." }, { status: 503 });
    const payload = (body.payload ?? {}) as { clientPayload?: unknown };
    const organizationId = await folderFor(requestIdOf(payload.clientPayload));
    if (!organizationId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    try {
      const json = await handleUpload({
        body: body as unknown as HandleUploadBody,
        request: req,
        token: storeToken,
        onBeforeGenerateToken: async (pathname) => {
          if (!pathname.startsWith(requestFolder(organizationId))) throw new Error("Wrong folder");
          return {
            allowedContentTypes: [...REQUEST_FILE_TYPES],
            maximumSizeInBytes: MAX_REQUEST_FILE_BYTES,
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
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Where this file goes.
  const requestId = typeof body.requestId === "string" ? body.requestId.slice(0, 40) : null;
  const organizationId = await folderFor(requestId);
  if (!organizationId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const name = typeof body.name === "string" ? body.name : "";
  const bytes = Number(body.bytes);
  const type = requestFileType(name);
  if (!type) return NextResponse.json({ error: `${name || "That file"}: send the CSV, Excel or Numbers file your program exported (a PDF or a zip is fine too).` }, { status: 415 });
  if (!Number.isFinite(bytes) || bytes <= 0) return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  if (bytes > MAX_REQUEST_FILE_BYTES) return NextResponse.json({ error: `${name} is over ${MAX_REQUEST_FILE_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  const pathname = safePathname(requestPathname(organizationId, name));
  const mode = storageMode();
  if (mode === "blob") return NextResponse.json({ mode, pathname, contentType: type });
  if (mode === "local") {
    const ticket = uploadTicket(pathname, type, Math.min(MAX_REQUEST_FILE_BYTES, Math.ceil(bytes * 1.01) + 1024));
    return NextResponse.json({ mode, pathname, contentType: type, uploadUrl: `/api/crew/upload-local?ticket=${encodeURIComponent(ticket)}` });
  }
  return NextResponse.json({ error: "File storage is not set up on this server yet." }, { status: 503 });
}
