import "server-only";
// "DO IT FOR ME" — THE DATABASE SIDE (2026-11-16, CRM migration plan part 4; the rules are lib/import/requests).
//
// A contractor's request: kept with its files (already in the private store, under imports/<org>/), the platform
// admins emailed (SUPPORT_NOTIFY_EMAIL, else every platform admin — the trial requests' path). In Admin → Imports a
// platform admin takes it, reads the files from the store through the same steps as the contractor's own import
// (lib/import/pipeline), and brings it in for the company; the request is then DONE, the files are deleted from the
// store, and the person who asked is emailed. A cancel (by the company while it waits, or by the team with a reason)
// deletes the files too.

import { db } from "@/lib/db";
import { deleteStored, isPrivateFileUnder, kindOfUrl, readStoredBytes } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { platformAlertRecipients } from "@/lib/integrationsAlertRecipients";
import { sourceInfo, type ImportSource } from "./sources";
import type { PlanCounts } from "./plan";
import {
  checkRequest,
  countLines,
  dueBy,
  dueWords,
  isLate,
  MAX_REQUEST_FILE_BYTES,
  parseFiles,
  REASON_MAX,
  requestFileType,
  requestFolder,
  statusWords,
  type RequestFile,
} from "./requests";

async function mail(to: string | string[], doc: Parameters<typeof import("@/lib/email/renderEmail").renderEmail>[0]) {
  const [{ renderEmail }, { sendEmail }] = await Promise.all([import("@/lib/email/renderEmail"), import("@/lib/sdk/resend")]);
  const { subject, html } = renderEmail(doc);
  for (const address of Array.isArray(to) ? to : [to]) await sendEmail({ mailClass: "transactional", to: address, subject, html });
}

async function base() {
  const { appBaseUrl } = await import("@/lib/appUrl");
  return (await appBaseUrl()).replace(/\/$/, "");
}

/** A file this company's request may name: a stored private file under its own folder. */
export const inCompanyFolder = (organizationId: string) => (url: string) => {
  const kind = kindOfUrl(url);
  return (kind === "private-blob" || kind === "local") && isPrivateFileUnder(url, requestFolder(organizationId));
};

/** Who gets the company's emails about it: the person who asked, else the owner. An address that cannot receive
 *  mail (a sign-up by text whose email is not proven yet) is skipped. */
async function contactOf(organizationId: string, userId: string | null): Promise<{ email: string | null; name: string | null }> {
  const asker = userId ? await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }).catch(() => null) : null;
  const owner = asker?.email
    ? null
    : await db.membership.findFirst({ where: { organizationId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true, name: true } } } }).catch(() => null);
  const email = asker?.email ?? owner?.user.email ?? null;
  return { email: email && !/\.invalid$/i.test(email) ? email : null, name: asker?.name ?? owner?.user.name ?? null };
}

// ── the company's side ─────────────────────────────────────────────────────────

export interface RequestView {
  id: string;
  source: ImportSource;
  sourceLabel: string;
  status: string;
  statusWords: string;
  note: string | null;
  createdAt: string;
  dueAt: string;
  due: string;
  late: boolean;
  files: Array<{ name: string; bytes: number }>;
  importId: string | null;
  reason: string | null;
  doneAt: string | null;
}

type Row = { id: string; source: string; status: string; note: string | null; createdAt: Date; dueAt: Date; filesJson: string; importId: string | null; reason: string | null; doneAt: Date | null; filesDeletedAt: Date | null };

function viewOf(r: Row, now = new Date()): RequestView {
  const source = r.source as ImportSource;
  return {
    id: r.id,
    source,
    sourceLabel: sourceInfo(source).label,
    status: r.status,
    statusWords: statusWords(r.status),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    due: dueWords(r.dueAt),
    late: isLate(r.status, r.dueAt, now),
    files: parseFiles(r.filesJson).map((f) => ({ name: f.name, bytes: f.bytes })),
    importId: r.importId,
    reason: r.reason,
    doneAt: r.doneAt?.toISOString() ?? null,
  };
}

export async function createRequest(input: {
  organizationId: string;
  userId: string;
  source: ImportSource;
  note: string | null;
  files: Array<{ url: string; name: string; bytes: number }>;
}): Promise<{ ok: true; request: RequestView } | { ok: false; error: string }> {
  const checked = checkRequest(input, inCompanyFolder(input.organizationId));
  if (!checked.ok) return checked;
  const files: RequestFile[] = input.files.map((f) => ({ url: f.url, name: f.name.slice(0, 120), bytes: f.bytes, contentType: requestFileType(f.name)!, addedBy: "company" }));
  const now = new Date();
  const row = await db.importRequest.create({
    data: { organizationId: input.organizationId, byUserId: input.userId, source: input.source, note: input.note?.trim() || null, filesJson: JSON.stringify(files), dueAt: dueBy(now) },
  });
  // The team hears about it; a failed email never loses the request (it is in Admin → Imports).
  try {
    const [org, asker, to, root] = await Promise.all([
      db.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } }),
      db.user.findUnique({ where: { id: input.userId }, select: { email: true, name: true } }),
      platformAlertRecipients(),
      base(),
    ]);
    if (to.length) {
      const { buildImportAsked } = await import("@/lib/email/build/importRequest");
      await mail(
        to,
        buildImportAsked({
          orgName: org?.name ?? "A company",
          askedBy: [asker?.name, asker?.email].filter(Boolean).join(" · ") || "—",
          sourceLabel: sourceInfo(input.source).label,
          files: files.map((f) => ({ name: f.name, bytes: f.bytes })),
          note: row.note,
          due: dueWords(row.dueAt),
          href: `${root}/admin/imports?request=${row.id}`,
        }),
      );
    } else {
      console.warn(`[import-request] ${row.id} kept with nobody to email — set SUPPORT_NOTIFY_EMAIL or flag a platform admin.`);
    }
  } catch (err) {
    console.warn("[import-request] the admins' email failed:", err instanceof Error ? err.message : err);
  }
  return { ok: true, request: viewOf(row) };
}

export async function requestsFor(organizationId: string): Promise<RequestView[]> {
  const rows = await db.importRequest.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map((r) => viewOf(r));
}

async function dropFiles(id: string, filesJson: string) {
  for (const f of parseFiles(filesJson)) await deleteStored(f.url);
  await db.importRequest.update({ where: { id }, data: { filesDeletedAt: new Date() } });
}

/** The company takes back a request that is still waiting. */
export async function cancelOwn(organizationId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db.importRequest.findFirst({ where: { id, organizationId } });
  if (!r) return { ok: false, error: "That request isn't this company's." };
  // Only while it waits: once the team has it, a cancel could cross an import being written.
  const n = await db.importRequest.updateMany({ where: { id, organizationId, status: "NEW" }, data: { status: "CANCELED", reason: "Cancelled by the company." } });
  if (!n.count) return { ok: false, error: r.status === "WORKING" || r.status === "RUNNING" ? "Our team is already on it — reply to our email or ask SmartHelp to stop it." : "That request is already closed." };
  await dropFiles(id, r.filesJson);
  return { ok: true };
}

// ── the team's side (Admin → Imports; the caller checked requirePlatformAdmin) ───────────────────────────────────

export interface AdminRequestRow extends RequestView {
  organizationId: string;
  orgName: string;
  askedBy: string;
  worker: string | null;
}

export interface AdminRequestDetail extends AdminRequestRow {
  /** Each file with a 15-minute download link (null once deleted). */
  fileLinks: Array<{ name: string; bytes: number; href: string | null; addedBy: "company" | "admin"; readable: boolean }>;
  filesDeleted: boolean;
  counts: PlanCounts | null;
  countLines: string[];
}

const adminInclude = { organization: { select: { name: true } } } as const;

async function people(ids: Array<string | null>): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: want } }, select: { id: true, email: true, name: true } });
  return new Map(users.map((u) => [u.id, [u.name, u.email].filter(Boolean).join(" · ")]));
}

export async function adminRequests(): Promise<AdminRequestRow[]> {
  const rows = await db.importRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: adminInclude });
  const who = await people(rows.flatMap((r) => [r.byUserId, r.workerId]));
  return rows.map((r) => ({ ...viewOf(r), organizationId: r.organizationId, orgName: r.organization.name, askedBy: (r.byUserId && who.get(r.byUserId)) || "—", worker: (r.workerId && who.get(r.workerId)) || null }));
}

export async function adminRequest(id: string): Promise<AdminRequestDetail | null> {
  const r = await db.importRequest.findUnique({ where: { id }, include: adminInclude });
  if (!r) return null;
  const who = await people([r.byUserId, r.workerId]);
  const imp = r.importId ? await db.dataImport.findUnique({ where: { id: r.importId }, select: { countsJson: true } }).catch(() => null) : null;
  let counts: PlanCounts | null = null;
  try {
    counts = imp?.countsJson ? (JSON.parse(imp.countsJson) as PlanCounts) : null;
  } catch {
    counts = null;
  }
  const deleted = !!r.filesDeletedAt;
  return {
    ...viewOf(r),
    organizationId: r.organizationId,
    orgName: r.organization.name,
    askedBy: (r.byUserId && who.get(r.byUserId)) || "—",
    worker: (r.workerId && who.get(r.workerId)) || null,
    fileLinks: parseFiles(r.filesJson).map((f) => ({
      name: f.name,
      bytes: f.bytes,
      href: deleted ? null : mediaHref(f.url, { download: f.name }),
      addedBy: f.addedBy,
      readable: /\.(csv|tsv|txt|xlsx|xlsm)$/i.test(f.name),
    })),
    filesDeleted: deleted,
    counts,
    countLines: counts ? countLines(counts) : [],
  };
}

/** The request's files read back from the store, as files the import steps read (order kept: the ids "0:0", "1:0"…
 *  are the same on every read). */
export async function requestFiles(id: string): Promise<{ organizationId: string; byUserId: string | null; source: ImportSource; status: string; files: File[] } | null> {
  const r = await db.importRequest.findUnique({ where: { id } });
  if (!r) return null;
  if (r.filesDeletedAt) return { organizationId: r.organizationId, byUserId: r.byUserId, source: r.source as ImportSource, status: r.status, files: [] };
  const files: File[] = [];
  for (const f of parseFiles(r.filesJson)) {
    const buf = await readStoredBytes(f.url, MAX_REQUEST_FILE_BYTES);
    // A file gone from the store is said by the steps as unreadable; an empty stand-in keeps the others' ids.
    files.push(new File([new Uint8Array(buf ?? Buffer.alloc(0))], f.name, { type: f.contentType }));
  }
  return { organizationId: r.organizationId, byUserId: r.byUserId, source: r.source as ImportSource, status: r.status, files };
}

export async function takeRequest(id: string, adminId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const n = await db.importRequest.updateMany({ where: { id, status: { in: ["NEW", "WORKING"] } }, data: { status: "WORKING", workerId: adminId } });
  return n.count ? { ok: true } : { ok: false, error: "That request is already closed, or someone is bringing it in right now." };
}

/** One "Bring them in" at a time: the request is claimed (RUNNING) before the import is written. */
export async function claimForRun(id: string, adminId: string): Promise<boolean> {
  const n = await db.importRequest.updateMany({ where: { id, status: { in: ["NEW", "WORKING"] } }, data: { status: "RUNNING", workerId: adminId } });
  return n.count === 1;
}

/** The run did not finish: the request waits again. */
export async function releaseRun(id: string): Promise<void> {
  await db.importRequest.updateMany({ where: { id, status: "RUNNING" }, data: { status: "WORKING" } });
}

/** A file the team adds (the company's old Excel saved again as CSV). */
export async function addTeamFile(id: string, file: { url: string; name: string; bytes: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db.importRequest.findUnique({ where: { id } });
  if (!r) return { ok: false, error: "No such request." };
  if (r.status !== "NEW" && r.status !== "WORKING") return { ok: false, error: "That request is already closed, or someone is bringing it in right now." };
  const files = parseFiles(r.filesJson);
  const checked = checkRequest({ files: [...files, file] }, (u) => u === file.url ? inCompanyFolder(r.organizationId)(u) : true);
  if (!checked.ok) return checked;
  files.push({ url: file.url, name: file.name.slice(0, 120), bytes: file.bytes, contentType: requestFileType(file.name)!, addedBy: "admin" });
  await db.importRequest.update({ where: { id }, data: { filesJson: JSON.stringify(files) } });
  return { ok: true };
}

/** The team closes it without an import: the files go, the company is told why. */
export async function cancelByTeam(id: string, adminId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const why = reason.trim().slice(0, REASON_MAX);
  if (!why) return { ok: false, error: "Say why, in a sentence — the company reads it." };
  const r = await db.importRequest.findUnique({ where: { id } });
  if (!r) return { ok: false, error: "No such request." };
  const n = await db.importRequest.updateMany({ where: { id, status: { in: ["NEW", "WORKING"] } }, data: { status: "CANCELED", reason: why, workerId: adminId, doneAt: new Date() } });
  if (!n.count) return { ok: false, error: "That request is already closed, or someone is bringing it in right now." };
  await dropFiles(id, r.filesJson);
  try {
    const [who, root] = await Promise.all([contactOf(r.organizationId, r.byUserId), base()]);
    if (who.email) {
      const { buildImportCanceled } = await import("@/lib/email/build/importRequest");
      await mail(who.email, buildImportCanceled({ name: who.name, sourceLabel: sourceInfo(r.source as ImportSource).label, reason: why, href: `${root}/dashboard/clients/import` }));
    }
  } catch (err) {
    console.warn("[import-request] the cancel email failed:", err instanceof Error ? err.message : err);
  }
  return { ok: true };
}

/** The import is in: the request is done, the files go, the person who asked is emailed. */
export async function completeRequest(id: string, adminId: string, importId: string, counts: PlanCounts): Promise<void> {
  const r = await db.importRequest.findUnique({ where: { id } });
  if (!r) return;
  await db.importRequest.update({ where: { id }, data: { status: "DONE", importId, workerId: adminId, doneAt: new Date() } });
  await dropFiles(id, r.filesJson);
  try {
    const [who, root] = await Promise.all([contactOf(r.organizationId, r.byUserId), base()]);
    if (who.email) {
      const { buildImportDone } = await import("@/lib/email/build/importRequest");
      await mail(who.email, buildImportDone({ name: who.name, sourceLabel: sourceInfo(r.source as ImportSource).label, lines: countLines(counts), clientsHref: `${root}/dashboard/clients`, importsHref: `${root}/dashboard/clients/import` }));
    }
  } catch (err) {
    console.warn("[import-request] the done email failed:", err instanceof Error ? err.message : err);
  }
}

/** Waiting on the team: the admin menu's badge. */
export const openRequestCount = () => db.importRequest.count({ where: { status: { in: ["NEW", "WORKING", "RUNNING"] } } });
