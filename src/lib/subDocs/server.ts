import "server-only";
// SUBCONTRACTOR DOCUMENTS — the database half (2026-11-08, the subcontractors plan, part 1). The rules are ./shared.
//
//   · uploadPlan     — where a file goes before it moves: the store's mode and the path (and the local PUT link in
//                      development), after the type and the size are checked. Both doors use it: the sub's page
//                      (/api/q/<token>/upload-ticket) and the office (/api/subs/upload-ticket).
//   · recordDocument — the row for a file that landed in the store, checked to be under this company's folder.
//   · documentFor    — one document of the company's, for the office's viewer and download.
//   · streamStored   — the bytes of a stored file as a Response (private blob fetched through a presigned link, the
//                      local fallback by range, a data URL decoded), inline for the viewer or as an attachment.

import { db } from "@/lib/db";
import { isPrivateFileUnder, kindOfUrl, presignedGet, readLocal, safePathname, storageMode } from "@/lib/media/privateStore";
import { uploadTicket } from "@/lib/media/signedLink";
import { MAX_DOC_BYTES, docKindOf, docPathname, docSize, docTypeOf, safeDocName, type DocKind } from "./shared";

export type DocRow = {
  id: string;
  kind: DocKind;
  name: string;
  url: string;
  contentType: string | null;
  bytes: number | null;
  uploadedVia: string;
  createdAt: string;
  projectId: string | null;
  contractorId: string | null;
  requestId: string | null;
};

export const DOC_SELECT = { id: true, kind: true, name: true, url: true, contentType: true, bytes: true, uploadedVia: true, createdAt: true, projectId: true, contractorId: true, requestId: true } as const;

export function docRow(d: { id: string; kind: string; name: string; url: string; contentType: string | null; bytes: number | null; uploadedVia: string; createdAt: Date; projectId: string | null; contractorId: string | null; requestId: string | null }): DocRow {
  return { id: d.id, kind: docKindOf(d.kind), name: d.name, url: d.url, contentType: d.contentType, bytes: d.bytes, uploadedVia: d.uploadedVia, createdAt: d.createdAt.toISOString(), projectId: d.projectId, contractorId: d.contractorId, requestId: d.requestId };
}

// ── before the upload ────────────────────────────────────────────────────────

export type UploadPlan = { ok: true; mode: "blob" | "local"; pathname: string; contentType: string; uploadUrl?: string } | { ok: false; error: string; status: number };

/** Where a document goes: a PDF or a picture up to 25 MB, under subs/<company>/<project>/. "inline" (production
 *  before the store exists) cannot take a document at all. */
export function uploadPlan(organizationId: string, projectId: string | null, name: string | null | undefined, contentType: string | null | undefined, bytes: number): UploadPlan {
  const type = docTypeOf(contentType, name);
  if (!type) return { ok: false, error: "A PDF or a picture of the pages, please.", status: 415 };
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, error: "The file is empty.", status: 400 };
  if (bytes > MAX_DOC_BYTES) return { ok: false, error: `That file is larger than ${docSize(MAX_DOC_BYTES)} — a smaller PDF, please.`, status: 413 };
  const mode = storageMode();
  const pathname = safePathname(docPathname(organizationId, projectId, safeDocName(name, type === "application/pdf" ? "document.pdf" : "page.jpg")));
  if (mode === "blob") return { ok: true, mode, pathname, contentType: type };
  if (mode === "local") {
    const ticket = uploadTicket(pathname, type, Math.min(MAX_DOC_BYTES, Math.ceil(bytes * 1.01) + 1024));
    return { ok: true, mode, pathname, contentType: type, uploadUrl: `/api/crew/upload-local?ticket=${encodeURIComponent(ticket)}` };
  }
  return { ok: false, error: "File storage is not set up on this server yet — a document cannot be kept.", status: 503 };
}

/** The folder the uploads of a company land in; a record is refused for a file outside it. */
export const docFolder = (organizationId: string) => `subs/${organizationId}/`;

// ── the record ───────────────────────────────────────────────────────────────

export type RecordInput = {
  organizationId: string;
  projectId: string | null;
  contractorId: string | null;
  requestId: string | null;
  kind: DocKind;
  name: string;
  url: string;
  contentType: string | null;
  bytes: number | null;
  uploadedVia: "OFFICE" | "SUB" | "EMAIL" | "SYSTEM";
  uploadedById: string | null;
  /** The email it arrived in (part 2), when it came by email. */
  inboundEmailId?: string | null;
};

/** The row for a file that landed: the URL must be a stored file under this company's folder (a data URL is taken
 *  as it is — production before the store, pictures only). */
export async function recordDocument(input: RecordInput): Promise<DocRow> {
  const kind = kindOfUrl(input.url);
  const under = (kind === "private-blob" || kind === "local") && isPrivateFileUnder(input.url, docFolder(input.organizationId));
  if (!under && kind !== "data") throw new Error("That file is not in this company's folder.");
  const type = docTypeOf(input.contentType, input.name);
  const row = await db.subDocument.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      contractorId: input.contractorId,
      requestId: input.requestId,
      kind: input.kind,
      name: safeDocName(input.name, type === "application/pdf" ? "document.pdf" : "document"),
      url: input.url,
      contentType: type ?? input.contentType,
      bytes: input.bytes != null && input.bytes > 0 ? Math.round(input.bytes) : null,
      uploadedVia: input.uploadedVia,
      uploadedById: input.uploadedById,
      inboundEmailId: input.inboundEmailId ?? null,
    },
    select: DOC_SELECT,
  });
  return docRow(row);
}

export async function documentFor(organizationId: string, documentId: string): Promise<DocRow | null> {
  const d = await db.subDocument.findFirst({ where: { id: documentId, organizationId }, select: DOC_SELECT });
  return d ? docRow(d) : null;
}

/** The company's documents on a project, newest first. */
export async function documentsOf(organizationId: string, projectId: string): Promise<DocRow[]> {
  const rows = await db.subDocument.findMany({ where: { organizationId, projectId }, orderBy: { createdAt: "desc" }, take: 200, select: DOC_SELECT });
  return rows.map(docRow);
}

// ── the bytes ────────────────────────────────────────────────────────────────

const dispositionOf = (download: string | null) => (download ? `attachment; filename="${download.replace(/[^A-Za-z0-9._-]/g, "-")}"` : "inline");

/** A stored file as a Response — the viewer fetches it inline, Download gets it as an attachment. A PDF served
 *  inline carries a sandbox policy so a script inside it runs nowhere even when the file is opened directly. */
export async function streamStored(url: string, opts: { range: string | null; download: string | null; contentType: string | null }): Promise<Response> {
  const kind = kindOfUrl(url);
  const baseHeaders: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": dispositionOf(opts.download),
  };
  const withPolicy = (type: string | null, h: Record<string, string>) => (type === "application/pdf" && !opts.download ? { ...h, "Content-Security-Policy": "sandbox" } : h);
  if (kind === "private-blob" || kind === "public-blob") {
    const to = kind === "private-blob" ? await presignedGet(url, 15 * 60_000, Boolean(opts.download)) : url;
    const r = await fetch(to, { headers: opts.range ? { range: opts.range } : {} });
    if (!r.ok && r.status !== 206) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    const type = opts.contentType ?? r.headers.get("content-type") ?? "application/octet-stream";
    const headers: Record<string, string> = { ...withPolicy(type, baseHeaders), "Content-Type": type, "Accept-Ranges": "bytes" };
    for (const h of ["content-length", "content-range"]) {
      const v = r.headers.get(h);
      if (v) headers[h === "content-length" ? "Content-Length" : "Content-Range"] = v;
    }
    return new Response(r.body, { status: r.status, headers });
  }
  if (kind === "local") {
    const r = await readLocal(url, opts.range, opts.download);
    if (!r) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    const type = opts.contentType ?? r.headers["Content-Type"] ?? r.headers["content-type"] ?? "application/octet-stream";
    return new Response(r.body, { status: r.status, headers: { ...r.headers, ...withPolicy(type, baseHeaders), "Content-Type": type } });
  }
  if (kind === "data") {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (!m) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    const bytes = Buffer.from(m[2], "base64");
    return new Response(bytes, { status: 200, headers: { ...withPolicy(m[1], baseHeaders), "Content-Type": m[1], "Content-Length": String(bytes.byteLength) } });
  }
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
}
