"use client";
// A "DO IT FOR ME" FILE LEAVES THE BROWSER (2026-11-16, CRM migration plan part 4) — the way the subcontractors'
// documents go (lib/subDocs/client): /api/imports/upload says where, then the file goes straight to the private store
// (@vercel/blob/client, through the same route) or, in development, to this machine's disk. Nothing passes through a
// server action, so a 40 MB jobs workbook travels as easily as a small CSV. The caller records the files after they
// land (actions/importRequests).
import { upload } from "@vercel/blob/client";
import { MAX_REQUEST_FILE_BYTES, requestFileType } from "./requests";

export type UploadedImportFile = { url: string; name: string; bytes: number };
export class ImportUploadError extends Error {}

const ROUTE = "/api/imports/upload";
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;

async function wordsOf(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* plain text */
  }
  return text && text.length < 200 ? text : fallback;
}

function netWords(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/network|failed to fetch|load failed|offline|timeout/i.test(m)) return "The connection dropped — check it and try again.";
  if (/too large|maximumSizeInBytes/i.test(m)) return `That file is over ${mb(MAX_REQUEST_FILE_BYTES)}.`;
  if (/content ?type/i.test(m)) return "Send the CSV, Excel or Numbers file your program exported.";
  return m || "The upload failed.";
}

function putWithProgress(url: string, body: Blob, type: string, onProgress?: (pct: number) => void): Promise<{ url: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.max(1, Math.min(99, Math.round((e.loaded / e.total) * 100))));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { url: string; bytes: number });
        } catch {
          reject(new ImportUploadError("The file went up but the answer was unreadable."));
        }
      } else {
        let msg = "The upload failed.";
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          /* keep */
        }
        reject(new ImportUploadError(msg));
      }
    };
    xhr.onerror = () => reject(new ImportUploadError("The connection dropped — check it and try again."));
    xhr.send(body);
  });
}

/** One exported file into the store. `requestId` = a platform admin adding a file to that request. Throws
 *  ImportUploadError in plain words. */
export async function uploadImportFile(file: File, opts: { requestId?: string; onProgress?: (pct: number) => void } = {}): Promise<UploadedImportFile> {
  const type = requestFileType(file.name);
  if (!type) throw new ImportUploadError(`${file.name}: send the CSV, Excel or Numbers file your program exported (a PDF or a zip is fine too).`);
  if (file.size > MAX_REQUEST_FILE_BYTES) throw new ImportUploadError(`${file.name} is over ${mb(MAX_REQUEST_FILE_BYTES)} (${mb(file.size)}).`);
  if (!file.size) throw new ImportUploadError(`${file.name} is empty.`);
  opts.onProgress?.(1);
  let ticket: Response;
  try {
    ticket = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, bytes: file.size, requestId: opts.requestId }) });
  } catch (err) {
    throw new ImportUploadError(netWords(err));
  }
  if (!ticket.ok) throw new ImportUploadError(await wordsOf(ticket, "The upload was refused."));
  const t = (await ticket.json()) as { mode: "blob" | "local"; pathname: string; contentType: string; uploadUrl?: string };
  if (t.mode === "blob") {
    try {
      const put = await upload(t.pathname, file, {
        access: "private",
        handleUploadUrl: ROUTE,
        contentType: t.contentType,
        multipart: file.size > 8 * 1024 * 1024,
        clientPayload: JSON.stringify({ requestId: opts.requestId ?? null }),
        onUploadProgress: (p) => opts.onProgress?.(Math.max(1, Math.min(99, Math.round(p.percentage)))),
      });
      return { url: put.url, name: file.name, bytes: file.size };
    } catch (err) {
      throw new ImportUploadError(netWords(err));
    }
  }
  if (t.mode === "local" && t.uploadUrl) {
    const r = await putWithProgress(t.uploadUrl, file, t.contentType, opts.onProgress);
    return { url: r.url, name: file.name, bytes: r.bytes };
  }
  throw new ImportUploadError("File storage is not set up on this server yet.");
}
