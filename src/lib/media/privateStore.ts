// THE CREW'S FILES, PRIVATE (stage B, 2026-09-30) — server only.
//
// Photos and videos of the work and the receipts are pictures of clients'
// houses and of money: they live in a PRIVATE Vercel Blob store and are never
// handed out as a permanent link. A file is read through /api/media/f, which
// takes a short signed ticket (15 minutes, lib/media/signedLink) that a page
// only mints after it has checked who is reading; the route then redirects to
// a presigned Blob URL (also short-lived) or, in local development, streams
// the file itself with byte ranges so a video can seek.
//
// Where the bytes go, by what the server has:
//   blob   — BLOB_PRIVATE_READ_WRITE_TOKEN is set: the private store (the
//            owner creates it; the public store's BLOB_READ_WRITE_TOKEN keeps
//            serving the older public files — proposals, reviews — untouched).
//   local  — no private token and not on Vercel: files on this machine's disk
//            under .cache/private-blob, so every flow runs end to end in dev.
//   inline — no private token on Vercel: the stopgap until the store exists;
//            a photo or a receipt image rides as a data URL (4 MB), a video
//            is refused. Exactly what production did before this stage.
//
// A stored file is named by a URL the rest of the app keeps in its row:
//   https://<store>.private.blob.vercel-storage.com/<folder>/<jobId>/<name>
//   local:<folder>/<jobId>/<name>
//   data:image/…            (inline)
//   https://<store>.public.blob.vercel-storage.com/…   (older public rows)

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export type StorageMode = "blob" | "local" | "inline";

export const LOCAL_PREFIX = "local:";
const PRIVATE_HOST = /\.private\.blob\.vercel-storage\.com$/i;
const PUBLIC_HOST = /\.public\.blob\.vercel-storage\.com$/i;

export function privateToken(): string | null {
  return process.env.BLOB_PRIVATE_READ_WRITE_TOKEN || null;
}

export function storageMode(): StorageMode {
  if (privateToken()) return "blob";
  if (!process.env.VERCEL) return "local";
  return "inline";
}

/** The root the local fallback writes under. */
export function localRoot(): string {
  return path.join(process.cwd(), ".cache", "private-blob");
}

/** A pathname made safe for the store and for the disk: folders from us, the
 *  name from the phone, nothing that climbs out. */
export function safePathname(p: string): string {
  const parts = p.split("/").filter((x) => x && x !== "." && x !== "..");
  return parts.map((x) => x.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120)).join("/");
}

export type StoredKind = "private-blob" | "local" | "public-blob" | "data" | "other";

export function kindOfUrl(url: string | null | undefined): StoredKind {
  if (!url) return "other";
  if (url.startsWith(LOCAL_PREFIX)) return "local";
  if (url.startsWith("data:")) return "data";
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && PRIVATE_HOST.test(u.hostname)) return "private-blob";
    if (u.protocol === "https:" && PUBLIC_HOST.test(u.hostname)) return "public-blob";
  } catch {
    /* not a URL */
  }
  return "other";
}

/** The pathname inside the store (or on disk) a stored URL names. */
export function pathnameOf(url: string): string | null {
  const k = kindOfUrl(url);
  if (k === "local") return safePathname(url.slice(LOCAL_PREFIX.length));
  if (k === "private-blob" || k === "public-blob") {
    try {
      return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
    } catch {
      return null;
    }
  }
  return null;
}

/** True when the URL is a private file (blob or local) whose path BEGINS with
 *  `prefix` — a folder that belongs to one company (`jobs/<jobId>/`,
 *  `deck-photos/<orgId>/`). The start of the path, never "contains": a query
 *  or a nested folder cannot smuggle another company's file past it, and a
 *  path that is not already safe (`..`, an encoded slash) is refused outright
 *  (security audit 1.1/1.2, 2026-10-12). */
export function isPrivateFileUnder(url: string, prefix: string): boolean {
  if (typeof url !== "string" || !prefix.endsWith("/")) return false;
  const k = kindOfUrl(url);
  if (k !== "private-blob" && k !== "local") return false;
  if (k === "local" && url.slice(LOCAL_PREFIX.length) !== safePathname(url.slice(LOCAL_PREFIX.length))) return false;
  const p = pathnameOf(url);
  return !!p && p === safePathname(p) && p.startsWith(prefix);
}

/** True when the URL is a private file (blob or local) under `<folder>/<jobId>/`. */
export function isPrivateJobFile(url: string, folder: "jobs" | "receipts", jobId: string): boolean {
  return isPrivateFileUnder(url, `${folder}/${jobId}/`);
}

function localFile(pathname: string): string {
  const safe = safePathname(pathname);
  const full = path.join(localRoot(), safe);
  if (!full.startsWith(localRoot())) throw new Error("Bad path");
  return full;
}

/** A file written by the server itself (the older inline door, a receipt the
 *  office scans). Returns the URL the row keeps. */
export async function putPrivate(pathname: string, body: Buffer, contentType: string): Promise<{ url: string; mode: StorageMode }> {
  const mode = storageMode();
  const safe = safePathname(pathname);
  if (mode === "blob") {
    const { put } = await import("@vercel/blob");
    const res = await put(safe, body, { access: "private", token: privateToken()!, contentType, addRandomSuffix: true });
    return { url: res.url, mode };
  }
  if (mode === "local") {
    const full = localFile(safe);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await fs.writeFile(`${full}.meta.json`, JSON.stringify({ contentType, bytes: body.byteLength }));
    return { url: `${LOCAL_PREFIX}${safe}`, mode };
  }
  return { url: `data:${contentType};base64,${body.toString("base64")}`, mode };
}

/** Write a local file from a request body stream, never past `maxBytes`. */
export async function writeLocalStream(pathname: string, body: ReadableStream<Uint8Array>, contentType: string, maxBytes: number): Promise<{ url: string; bytes: number }> {
  const safe = safePathname(pathname);
  const full = localFile(safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const handle = await fs.open(full, "w");
  let bytes = 0;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("too-large");
      await handle.write(value);
    }
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.unlink(full).catch(() => {});
    throw err;
  }
  await handle.close();
  await fs.writeFile(`${full}.meta.json`, JSON.stringify({ contentType, bytes }));
  return { url: `${LOCAL_PREFIX}${safe}`, bytes };
}

/** Delete a stored file, wherever it lives. A missing file is not an error; a
 *  data URL has nothing to delete. Never throws — a failed delete is logged. */
export async function deleteStored(url: string | null | undefined): Promise<{ deleted: boolean; kind: StoredKind }> {
  const kind = kindOfUrl(url);
  try {
    if (kind === "private-blob") {
      const token = privateToken();
      if (!token) return { deleted: false, kind };
      const { del } = await import("@vercel/blob");
      await del(url!, { token });
      return { deleted: true, kind };
    }
    if (kind === "public-blob") {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) return { deleted: false, kind };
      const { del } = await import("@vercel/blob");
      await del(url!, { token });
      return { deleted: true, kind };
    }
    if (kind === "local") {
      const full = localFile(pathnameOf(url!)!);
      await fs.unlink(full).catch(() => {});
      await fs.unlink(`${full}.meta.json`).catch(() => {});
      return { deleted: true, kind };
    }
  } catch (err) {
    console.warn("[privateStore] delete failed:", err instanceof Error ? err.message : err);
  }
  return { deleted: false, kind };
}

/** Is the stored file still there? (the QA and the orphan scan) */
export async function storedExists(url: string): Promise<boolean> {
  const kind = kindOfUrl(url);
  if (kind === "local") {
    try {
      await fs.access(localFile(pathnameOf(url)!));
      return true;
    } catch {
      return false;
    }
  }
  if (kind === "private-blob" && privateToken()) {
    const { head } = await import("@vercel/blob");
    try {
      await head(url, { token: privateToken()! });
      return true;
    } catch {
      return false;
    }
  }
  return kind === "data";
}

// ── reading ────────────────────────────────────────────────────────────────

let signing: { token: { delegationToken: string; clientSigningToken: string }; validUntil: number } | null = null;

/** A presigned GET URL for a private blob, valid `ttlMs` (the signing token is
 *  issued once an hour per server instance and reused). */
export async function presignedGet(url: string, ttlMs: number, download = false): Promise<string> {
  const token = privateToken();
  if (!token) throw new Error("No private store");
  const pathname = pathnameOf(url);
  if (!pathname) throw new Error("Not a private blob");
  const now = Date.now();
  if (!signing || signing.validUntil - now < 10 * 60_000) {
    const { issueSignedToken } = await import("@vercel/blob");
    const t = await issueSignedToken({ token, pathname: "*", operations: ["get", "head"], validUntil: now + 60 * 60_000 });
    signing = { token: { delegationToken: t.delegationToken, clientSigningToken: t.clientSigningToken }, validUntil: t.validUntil };
  }
  const { presignUrl } = await import("@vercel/blob");
  const { presignedUrl } = await presignUrl(signing.token, { operation: "get", pathname, access: "private", validUntil: Math.min(now + ttlMs, signing.validUntil) });
  // The store's own download switch (the public `downloadUrl` form); not part of
  // the signature, so it rides along.
  return download ? `${presignedUrl}${presignedUrl.includes("?") ? "&" : "?"}download=1` : presignedUrl;
}

export interface LocalRead {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

/** A local file, whole or by one byte range (a video seeking). */
export async function readLocal(url: string, rangeHeader: string | null, download: string | null): Promise<LocalRead | null> {
  const pathname = pathnameOf(url);
  if (!pathname) return null;
  const full = localFile(pathname);
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(full);
  } catch {
    return null;
  }
  let contentType = "application/octet-stream";
  try {
    contentType = (JSON.parse(await fs.readFile(`${full}.meta.json`, "utf8")) as { contentType?: string }).contentType || contentType;
  } catch {
    /* no meta */
  }
  const size = stat.size;
  const base: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) base["Content-Disposition"] = `attachment; filename="${download.replace(/[^A-Za-z0-9._-]/g, "-")}"`;
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (m) {
    let start = m[1] === "" ? NaN : Number(m[1]);
    let end = m[2] === "" ? NaN : Number(m[2]);
    if (Number.isNaN(start)) {
      // suffix range: the last N bytes
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end));
      end = size - 1;
    } else if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      return { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` }, body: null };
    }
    const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream<Uint8Array>;
    return { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) }, body: stream };
  }
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>;
  return { status: 200, headers: { ...base, "Content-Length": String(size) }, body: stream };
}

/** A stored file's bytes, for a server-side reader (a "Do it for me" import read
 *  in Admin → Imports, 2026-11-16). Null when it is gone, not private, or past `maxBytes`. */
export async function readStoredBytes(url: string, maxBytes: number): Promise<Buffer | null> {
  const kind = kindOfUrl(url);
  if (kind === "local") {
    const full = localFile(pathnameOf(url)!);
    const st = await fs.stat(full).catch(() => null);
    if (!st || st.size > maxBytes) return null;
    return fs.readFile(full).catch(() => null);
  }
  if (kind === "private-blob" && privateToken()) {
    const { get } = await import("@vercel/blob");
    const r = await get(url, { access: "private", token: privateToken()! });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    if ((r.blob.size ?? 0) > maxBytes) return null;
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  return null;
}

/** A stored file's bytes as a data URL, for a server-side reader that cannot
 *  follow a signed link (the photo vision call). Null past `maxBytes`. */
export async function readStoredAsDataUrl(url: string, maxBytes = 8 * 1024 * 1024): Promise<string | null> {
  const kind = kindOfUrl(url);
  if (kind === "data") return url;
  if (kind === "local") {
    const full = localFile(pathnameOf(url)!);
    const buf = await fs.readFile(full).catch(() => null);
    if (!buf || buf.byteLength > maxBytes) return null;
    let type = "image/jpeg";
    try {
      type = (JSON.parse(await fs.readFile(`${full}.meta.json`, "utf8")) as { contentType?: string }).contentType || type;
    } catch {
      /* no meta */
    }
    return `data:${type};base64,${buf.toString("base64")}`;
  }
  if (kind === "private-blob" && privateToken()) {
    const { get } = await import("@vercel/blob");
    const r = await get(url, { access: "private", token: privateToken()! });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    if ((r.blob.size ?? 0) > maxBytes) return null;
    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    return `data:${r.blob.contentType || "image/jpeg"};base64,${buf.toString("base64")}`;
  }
  return null;
}
