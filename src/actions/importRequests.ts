"use server";
// "DO IT FOR ME" (2026-11-16, CRM migration plan part 4 — the owner: free for everyone, within 2 business days, worked
// by the platform admins). The guards; the work is lib/import/requestServer and lib/import/pipeline.
//   · askForImport / myImportRequests / cancelImportRequest — requireManager: the company's owner, an admin or a
//     manager (the ones who may import themselves).
//   · adminReadRequest / adminBringIn / adminTakeRequest / adminCancelRequest / adminAddRequestFile —
//     requirePlatformAdmin (Admin → Imports).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requirePlatformAdmin } from "@/lib/orgContext";
import { isImportSource } from "@/lib/import/sources";
import { MAX_REQUEST_FILE_BYTES, MAX_REQUEST_FILES, NOTE_MAX, REASON_MAX } from "@/lib/import/requests";
import { addTeamFile, cancelByTeam, cancelOwn, claimForRun, completeRequest, createRequest, releaseRun, requestFiles, requestsFor, takeRequest, type RequestView } from "@/lib/import/requestServer";
import { buildPreview, parseSetup, runPipeline, type ImportPreview, type RunResult } from "@/lib/import/pipeline";
import { ImportFileError } from "@/lib/import/server";

type Done = { ok: true } | { ok: false; error: string };

const FileIn = z.object({ url: z.string().min(1).max(600), name: z.string().min(1).max(200), bytes: z.number().int().positive().max(MAX_REQUEST_FILE_BYTES) });
const AskIn = z.object({
  source: z.string().refine(isImportSource, "Pick the program you're moving from."),
  note: z.string().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`).optional().nullable(),
  files: z.array(FileIn).min(1, "Add the files your old program exported.").max(MAX_REQUEST_FILES, `Up to ${MAX_REQUEST_FILES} files in one request.`),
});

function refreshCompany() {
  for (const p of ["/dashboard/clients", "/dashboard/clients/import", "/dashboard/calendar", "/dashboard/financials", "/dashboard/crm", "/dashboard/jobs"]) {
    try {
      revalidatePath(p);
    } catch {
      /* not cached */
    }
  }
}
function refreshAdmin() {
  try {
    revalidatePath("/admin/imports");
    revalidatePath("/admin", "layout");
  } catch {
    /* not cached */
  }
}

// ── the company ────────────────────────────────────────────────────────────────

export async function askForImport(raw: unknown): Promise<{ ok: true; request: RequestView } | { ok: false; error: string }> {
  let ctx: Awaited<ReturnType<typeof requireManager>>;
  try {
    ctx = await requireManager();
  } catch {
    return { ok: false, error: "Only the owner, an admin or a manager can send the files." };
  }
  const parsed = AskIn.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  if (!isImportSource(d.source)) return { ok: false, error: "Pick the program you're moving from." };
  const res = await createRequest({ organizationId: ctx.organizationId, userId: ctx.user.id, source: d.source, note: d.note ?? null, files: d.files });
  if (res.ok) {
    refreshCompany();
    refreshAdmin();
  }
  return res;
}

export async function myImportRequests(): Promise<RequestView[]> {
  const { organizationId } = await requireManager();
  return requestsFor(organizationId);
}

export async function cancelImportRequest(id: string): Promise<Done> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireManager());
  } catch {
    return { ok: false, error: "Only the owner, an admin or a manager can do that." };
  }
  const res = await cancelOwn(organizationId, String(id).slice(0, 40));
  if (res.ok) {
    refreshCompany();
    refreshAdmin();
  }
  return res;
}

// ── the team (Admin → Imports) ─────────────────────────────────────────────────

function failWords(err: unknown): { ok: false; error: string } {
  if (err instanceof ImportFileError) return { ok: false, error: err.message };
  console.error("[import-request]", err instanceof Error ? err.message : err);
  return { ok: false, error: "Something went wrong reading those files. Nothing was brought in." };
}

/** Read the request's files: what each is, which column is what, what would come in. Nothing is written. */
export async function adminReadRequest(id: string, setupJson: string): Promise<ImportPreview> {
  try {
    await requirePlatformAdmin();
    const r = await requestFiles(String(id).slice(0, 40));
    if (!r) return { ok: false, error: "No such request." };
    if (r.status === "DONE" || r.status === "CANCELED") return { ok: false, error: "That request is closed." };
    if (!r.files.length) return { ok: false, error: "The files were deleted from storage." };
    // Limits as the company: the person who asked, never the admin (who is exempt).
    return await buildPreview({ organizationId: r.organizationId, limitActorId: r.byUserId ?? "", source: r.source, setup: parseSetup(setupJson), files: r.files, allowModel: true, maxFileBytes: MAX_REQUEST_FILE_BYTES, tolerate: true });
  } catch (err) {
    return failWords(err);
  }
}

/** Bring it in for the company, as the admin set the files up; the request is then done and its files deleted. */
export async function adminBringIn(id: string, setupJson: string): Promise<RunResult> {
  let admin: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    admin = await requirePlatformAdmin();
  } catch {
    return { ok: false, error: "Platform admin only." };
  }
  const requestId = String(id).slice(0, 40);
  if (!(await claimForRun(requestId, admin.id))) return { ok: false, error: "That request is closed, or someone is bringing it in right now." };
  try {
    const r = await requestFiles(requestId);
    if (!r || !r.files.length) {
      await releaseRun(requestId);
      return { ok: false, error: "The files were deleted from storage." };
    }
    const res = await runPipeline({
      organizationId: r.organizationId,
      limitActorId: r.byUserId ?? "",
      userId: admin.id,
      onBehalf: true,
      source: r.source,
      setup: parseSetup(setupJson),
      files: r.files,
      allowModel: false,
      maxFileBytes: MAX_REQUEST_FILE_BYTES,
      tolerate: true,
    });
    if (!res.ok) {
      await releaseRun(requestId);
      return res;
    }
    await completeRequest(requestId, admin.id, res.importId, res.counts);
    refreshCompany();
    refreshAdmin();
    return res;
  } catch (err) {
    await releaseRun(requestId);
    return failWords(err);
  }
}

export async function adminTakeRequest(id: string): Promise<Done> {
  const admin = await requirePlatformAdmin();
  const res = await takeRequest(String(id).slice(0, 40), admin.id);
  if (res.ok) refreshAdmin();
  return res;
}

export async function adminCancelRequest(id: string, reason: string): Promise<Done> {
  const admin = await requirePlatformAdmin();
  const res = await cancelByTeam(String(id).slice(0, 40), admin.id, String(reason ?? "").slice(0, REASON_MAX));
  if (res.ok) {
    refreshAdmin();
    refreshCompany();
  }
  return res;
}

/** A file the team adds to a request (after /api/imports/upload put it in the company's folder). */
export async function adminAddRequestFile(id: string, file: unknown): Promise<Done> {
  await requirePlatformAdmin();
  const f = FileIn.safeParse(file);
  if (!f.success) return { ok: false, error: "That file didn't upload — try again." };
  const res = await addTeamFile(String(id).slice(0, 40), f.data);
  if (res.ok) refreshAdmin();
  return res;
}
