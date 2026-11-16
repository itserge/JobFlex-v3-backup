"use server";
// BRING YOUR CLIENTS (2026-11-16 — the owner: "move contractors' CRM base with clients to JobFlex from other platforms
// like Housecall Pro"; parts 1–2 of the plan: clients, then their invoices, schedule and history). The page
// /dashboard/clients/import calls these: PREVIEW the dropped files (what each is, which column is what, what would
// come in), RUN the import as the person set it, UNDO one, LIST them. The owner, an admin or a manager imports (a
// whole book changes hands). The steps themselves are lib/import/pipeline — the same ones Admin → Imports runs.
//
// The files travel with every call (a server action holds 8 MB; the page packs a big CSV): the preview keeps
// nothing, and the run reads them again with the kinds and columns the person confirmed.

import { revalidatePath } from "next/cache";
import { isLimitedRole, requireManager, requireOrg } from "@/lib/orgContext";
import { ImportFileError, listImports as listFor, undoImport as undoFor, type ImportRecord, type UndoResult } from "@/lib/import/server";
import { buildPreview, parseSetup, runPipeline, type ImportPreview, type RunResult } from "@/lib/import/pipeline";
import { isImportSource, type ImportSource } from "@/lib/import/sources";

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ImportFileError) return { ok: false, error: err.message };
  const msg = err instanceof Error ? err.message : "";
  if (/plan limit|upgrade/i.test(msg)) return { ok: false, error: msg };
  console.error("[import]", msg || err);
  return { ok: false, error: "Something went wrong reading those files. Nothing was brought in. Try again." };
}

/** The call's files, program and setup. */
function readForm(form: FormData): { source: ImportSource; files: File[]; setup: ReturnType<typeof parseSetup> } {
  const raw = String(form.get("source") ?? "OTHER");
  return {
    source: isImportSource(raw) ? raw : "OTHER",
    files: form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 12),
    setup: parseSetup(String(form.get("setup") ?? "[]")),
  };
}

const TOUCHED = ["/dashboard/clients", "/dashboard/calendar", "/dashboard/financials", "/dashboard/crm", "/dashboard/jobs"];
function refresh() {
  for (const p of TOUCHED) {
    try {
      revalidatePath(p);
    } catch {
      /* a page that is not cached has nothing to drop */
    }
  }
}

/** PREVIEW: what the dropped files are, which column is what, and what would come in. Nothing is written. */
export async function previewImport(form: FormData): Promise<ImportPreview> {
  try {
    const { organizationId, user } = await requireManager();
    const { source, files, setup } = readForm(form);
    return await buildPreview({ organizationId, limitActorId: user.id, source, setup, files, allowModel: true });
  } catch (err) {
    return fail(err);
  }
}

/** RUN: bring them in, as the person set the files up. */
export async function runImport(form: FormData): Promise<RunResult> {
  try {
    const { organizationId, user } = await requireManager();
    const { source, files, setup } = readForm(form);
    const res = await runPipeline({ organizationId, limitActorId: user.id, userId: user.id, source, setup, files, allowModel: false });
    if (res.ok) refresh();
    return res;
  } catch (err) {
    return fail(err);
  }
}

/** UNDO one import. */
export async function undoImport(importId: string): Promise<{ ok: true; result: UndoResult } | { ok: false; error: string }> {
  try {
    const { organizationId, user } = await requireManager();
    const result = await undoFor(organizationId, String(importId).slice(0, 40), user.id);
    if (!result) return { ok: false, error: "That import is already undone, or isn't this company's." };
    refresh();
    return { ok: true, result };
  } catch (err) {
    return fail(err);
  }
}

/** Whether this person may bring a book over (the phone's Clients page asks before it shows its Import button). */
export async function canImportClients(): Promise<boolean> {
  try {
    const { role } = await requireOrg();
    return !isLimitedRole(role);
  } catch {
    return false;
  }
}

/** The company's imports, newest first. */
export async function listImports(): Promise<ImportRecord[]> {
  const { organizationId } = await requireManager();
  return listFor(organizationId);
}
