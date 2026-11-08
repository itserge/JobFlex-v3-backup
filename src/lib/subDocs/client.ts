"use client";
// A SUBCONTRACTOR DOCUMENT LEAVES THE BROWSER (2026-11-08, part 1) — the same three ways the crew's and the
// homeowner's files go (lib/media/uploadJobMedia, lib/home/uploadClient): straight to the private Blob store with
// a token from the door's upload-token route, to this machine's disk in development, or refused where the store
// does not exist (a document cannot travel inline). The door is the sub's token (/api/q/<token>/…) or the office's
// session (/api/subs/…). The caller records the file after it lands (actions/projectSubs).
import { upload } from "@vercel/blob/client";
import { MAX_DOC_BYTES, docSize, docTypeOf } from "./shared";

export type UploadDoor = { kind: "token"; token: string } | { kind: "office"; projectId: string | null };
export type UploadedFile = { url: string; name: string; contentType: string; bytes: number };

export class DocUploadError extends Error {}

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
  if (/network|failed to fetch|load failed|offline|timeout/i.test(m)) return "The connection dropped — check the signal and try again.";
  if (/too large|file too large|maximumSizeInBytes/i.test(m)) return `That file is over the ${docSize(MAX_DOC_BYTES)} limit.`;
  if (/content ?type/i.test(m)) return "A PDF or a picture of the pages, please.";
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
          reject(new DocUploadError("The file went up but the answer was unreadable."));
        }
      } else {
        let msg = xhr.status === 413 ? `That file is over the ${docSize(MAX_DOC_BYTES)} limit.` : "The upload failed.";
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          /* keep */
        }
        reject(new DocUploadError(msg));
      }
    };
    xhr.onerror = () => reject(new DocUploadError("The connection dropped — check the signal and try again."));
    xhr.send(body);
  });
}

const base = (door: UploadDoor) => (door.kind === "token" ? `/api/q/${encodeURIComponent(door.token)}` : "/api/subs");

/** One document into the store through its door. Throws DocUploadError in plain words. */
export async function uploadSubDocument(door: UploadDoor, file: File, onProgress?: (pct: number) => void): Promise<UploadedFile> {
  const type = docTypeOf(file.type, file.name);
  if (!type) throw new DocUploadError(`${file.name} is not a PDF or a picture.`);
  if (file.size > MAX_DOC_BYTES) throw new DocUploadError(`${file.name} is larger than ${docSize(MAX_DOC_BYTES)} (${docSize(file.size)}).`);
  onProgress?.(1);
  let ticket: Response;
  try {
    ticket = await fetch(`${base(door)}/upload-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, contentType: type, bytes: file.size, projectId: door.kind === "office" ? door.projectId : undefined }),
    });
  } catch (err) {
    throw new DocUploadError(netWords(err));
  }
  if (!ticket.ok) throw new DocUploadError(await wordsOf(ticket, "The upload was refused."));
  const t = (await ticket.json()) as { mode: "blob" | "local"; pathname: string; uploadUrl?: string };
  if (t.mode === "blob") {
    try {
      const put = await upload(t.pathname, file, {
        access: "private",
        handleUploadUrl: `${base(door)}/upload-token`,
        contentType: type,
        multipart: file.size > 8 * 1024 * 1024,
        clientPayload: JSON.stringify({ projectId: door.kind === "office" ? door.projectId : null }),
        onUploadProgress: (p) => onProgress?.(Math.max(1, Math.min(99, Math.round(p.percentage)))),
      });
      return { url: put.url, name: file.name, contentType: type, bytes: file.size };
    } catch (err) {
      throw new DocUploadError(netWords(err));
    }
  }
  if (t.mode === "local" && t.uploadUrl) {
    const r = await putWithProgress(t.uploadUrl, file, type, onProgress);
    return { url: r.url, name: file.name, contentType: type, bytes: r.bytes };
  }
  throw new DocUploadError("File storage is not set up on this server yet.");
}
