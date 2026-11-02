import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secretBox";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { metaId, metaPageSchema, metaGraph, metaLeadSchema, metaLeadFields } from "./graph";

// Namespaced records in the existing atomic key/value store: no schema push.
const pendingKey = (org: string) => `meta:pending:${org}`;
// One row per Page PER WORKSPACE (owner, 2026-10-30: several JobFlex accounts take leads from one company's
// Page). Before that a Page had a single owner row keyed by the Page alone; those rows are still read as the
// connection of the workspace they name, and are dropped when that workspace disconnects or reconnects.
const pageKey = (page: string, org: string) => `meta:page:${page}:${org}`;
const legacyPageKey = (page: string) => `meta:page:${page}`;
const jobKey = (org: string) => `meta:import:${org}`;
const pendingSchema = z.object({ actorId: z.string(), userId: metaId, expiresAt: z.number(), pages: z.array(metaPageSchema) });
const connectionSchema = z.object({ organizationId: z.string(), userId: metaId, pageId: metaId, pageName: z.string(), tokenBox: z.string(), generation: z.string() });
type Connection = z.infer<typeof connectionSchema>;
const jobSchema = z.object({ generation: z.string(), done: z.boolean(), forms: z.array(metaId), formAfter: z.string().optional(), leadAfter: z.string().optional(), formsLoaded: z.boolean(), imported: z.number(), skipped: z.number(), leaseUntil: z.number() });
type Job = z.infer<typeof jobSchema>;
const pagingSchema = z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() }).optional();
function nextCursor(paging: z.infer<typeof pagingSchema>) {
  if (paging?.next && !paging.cursors?.after) throw new Error("Meta returned an incomplete pagination cursor. Please retry.");
  return paging?.next ? paging.cursors?.after : undefined;
}
function pageFromSettings(value: string | null) {
  try { return metaId.safeParse(JSON.parse(value || "{}").pageId).data; } catch { return undefined; }
}
/** This workspace's own row for the Page — the per-workspace key first, then a pre-2026-10-30 row that names it. */
async function connectionRow(client: { syncState: typeof db.syncState }, pageId: string, organizationId: string) {
  for (const key of [pageKey(pageId, organizationId), legacyPageKey(pageId)]) {
    const row = await client.syncState.findUnique({ where: { key } });
    if (!row) continue;
    let parsed;
    try { parsed = connectionSchema.safeParse(JSON.parse(row.cursor)); } catch { continue; }
    if (parsed.success && parsed.data.organizationId === organizationId) return { row, connection: parsed.data };
  }
  return null;
}
export async function getMetaConnection(organizationId: string) {
  const org = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { metaSettingsJson: true } });
  const pageId = pageFromSettings(org?.metaSettingsJson || null);
  if (!pageId) return null;
  const found = await connectionRow(db, pageId, organizationId);
  return found ? { ...found.connection, stored: found.row.cursor, key: found.row.key } : null;
}
export async function saveMetaCandidates(organizationId: string, actorId: string, grant: { userId: string; pages: z.infer<typeof metaPageSchema>[] }) {
  if (await getMetaConnection(organizationId)) throw new Error("Disconnect the current Page before choosing another Page.");
  const cursor = encryptSecret(JSON.stringify({ ...grant, actorId, expiresAt: Date.now() + 15 * 60_000 }));
  await db.syncState.upsert({ where: { key: pendingKey(organizationId) }, create: { key: pendingKey(organizationId), cursor }, update: { cursor } });
}
async function getPending(organizationId: string, actorId: string) {
  const row = await db.syncState.findUnique({ where: { key: pendingKey(organizationId) } });
  if (!row) return null;
  let result;
  try { result = pendingSchema.parse(JSON.parse(decryptSecret(row.cursor))); } catch { return null; }
  if (result.expiresAt < Date.now()) {
    await db.syncState.deleteMany({ where: { key: row.key, cursor: row.cursor } });
    return null;
  }
  return result.actorId === actorId ? { ...result, stored: row.cursor } : null;
}
export async function metaConnectionView(organizationId: string, actorId: string) {
  const [connection, pending, job] = await Promise.all([getMetaConnection(organizationId), getPending(organizationId, actorId), db.syncState.findUnique({ where: { key: jobKey(organizationId) } })]);
  return {
    connected: Boolean(connection), pageName: connection?.pageName || "", pageId: connection?.pageId || "",
    pages: pending?.pages.map(p => ({ id: p.id, name: p.name })) || [],
    lastImportAt: job?.updatedAt.toISOString() || null,
    canResume: Boolean(connection && job && !jobSchema.parse(JSON.parse(job.cursor)).done),
  };
}
export async function selectMetaPage(organizationId: string, actorId: string, pageId: string) {
  metaId.parse(pageId);
  const pending = await getPending(organizationId, actorId);
  const page = pending?.pages.find(p => p.id === pageId);
  if (!pending || !page) throw new Error("Authorization expired or Page was not granted. Connect Meta again.");
  // Verify read access before showing Connected. No ads are created or changed.
  await metaGraph(`${page.id}/leadgen_forms`, page.access_token, { fields: "id", limit: "1" });
  const connection: Connection = { organizationId, userId: pending.userId, pageId, pageName: page.name, tokenBox: encryptSecret(page.access_token), generation: crypto.randomUUID() };
  await db.$transaction(async tx => {
    const org = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { metaSettingsJson: true } });
    if (!org) throw new Error("Workspace not found.");
    if (pageFromSettings(org.metaSettingsJson)) throw new Error("Disconnect the current Page first.");
    const consumed = await tx.syncState.deleteMany({ where: { key: pendingKey(organizationId), cursor: pending.stored } });
    if (!consumed.count) throw new Error("Authorization changed. Connect Meta again.");
    // Other workspaces connected to the same Page keep their own rows. A row of THIS workspace can only be a
    // leftover here (its settings name no Page — checked above), so it gives way to the new one.
    const stale = await connectionRow(tx, pageId, organizationId);
    if (stale) await tx.syncState.deleteMany({ where: { key: stale.row.key, cursor: stale.row.cursor } });
    await tx.syncState.upsert({ where: { key: pageKey(pageId, organizationId) }, create: { key: pageKey(pageId, organizationId), cursor: JSON.stringify(connection) }, update: { cursor: JSON.stringify(connection) } });
    const saved = await tx.organization.updateMany({ where: { id: organizationId, metaSettingsJson: org.metaSettingsJson }, data: { metaSettingsJson: JSON.stringify({ connected: true, autoCreate: false, autoText: false, pageId, defaultPage: page.name, formCategory: "auto" }) } });
    if (saved.count !== 1) throw new Error("Connection changed. Please try again.");
  });
}
export async function disconnectMetaPage(organizationId: string, expectedUserId?: string) {
  await db.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { metaSettingsJson: true } });
    if (!org) return;
    const pageId = pageFromSettings(org.metaSettingsJson);
    const found = pageId ? await connectionRow(tx, pageId, organizationId) : null;
    if (expectedUserId && found?.connection.userId !== expectedUserId) return;
    if (found) await tx.syncState.deleteMany({ where: { key: found.row.key, cursor: found.row.cursor } });
    await tx.syncState.deleteMany({ where: { key: { in: [pendingKey(organizationId), jobKey(organizationId)] } } });
    const changed = await tx.organization.updateMany({ where: { id: organizationId, metaSettingsJson: org.metaSettingsJson }, data: { metaSettingsJson: JSON.stringify({ connected: false, autoCreate: false, autoText: false, defaultPage: "", formCategory: "auto" }) } });
    if (!changed.count) throw new Error("Connection changed. Please try again.");
  });
}

// One bounded request imports <=10 leads. The browser repeats while active;
// persisted cursors allow resuming, and the atomic lease rejects double-clicks.
export async function importMetaBatch(organizationId: string, actorId: string, restart: boolean) {
  const connection = await getMetaConnection(organizationId);
  if (!connection) throw new Error("Connect a Facebook Page first.");
  const key = jobKey(organizationId);
  let row = await db.syncState.findUnique({ where: { key } });
  let job: Job = row ? jobSchema.parse(JSON.parse(row.cursor)) : { generation: connection.generation, done: false, forms: [], formsLoaded: false, imported: 0, skipped: 0, leaseUntil: 0 };
  if (job.leaseUntil > Date.now()) throw new Error("An import is already running. Wait a moment before retrying.");
  if (restart || job.generation !== connection.generation) job = { generation: connection.generation, done: false, forms: [], formsLoaded: false, imported: 0, skipped: 0, leaseUntil: 0 };
  if (job.done) return { done: true, imported: job.imported, skipped: job.skipped };
  const locked = JSON.stringify({ ...job, leaseUntil: Date.now() + 120_000 });
  if (row) {
    const won = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor: locked } });
    if (!won.count) throw new Error("An import is already running. Please wait.");
  } else {
    await db.syncState.create({ data: { key, cursor: locked } });
    row = { key, cursor: locked, updatedAt: new Date() };
  }
  try {
    const token = decryptSecret(connection.tokenBox);
    if (!job.forms.length && (!job.formsLoaded || job.formAfter)) {
      const batch = z.object({ data: z.array(z.object({ id: metaId })), paging: pagingSchema }).parse(await metaGraph(`${connection.pageId}/leadgen_forms`, token, { fields: "id", limit: "25", ...(job.formAfter ? { after: job.formAfter } : {}) }));
      job = { ...job, forms: batch.data.map(f => f.id), formsLoaded: true, formAfter: nextCursor(batch.paging) };
    }
    const formId = job.forms[0];
    const batch = formId ? z.object({ data: z.array(metaLeadSchema), paging: pagingSchema }).parse(await metaGraph(`${formId}/leads`, token, { fields: "id,created_time,field_data", limit: "10", ...(job.leadAfter ? { after: job.leadAfter } : {}) })) : { data: [], paging: undefined };
    const seen = await db.webhookEvent.count({ where: { provider: "META_LEADS", eventId: { in: batch.data.map(lead => `${organizationId}:${lead.id}`) } } });
    const needed = batch.data.length - seen;
    if (needed > 0) await enforcePlanLimit(organizationId, "leads", needed);
    await db.$transaction(async tx => {
      // Touch the ownership row to serialize against disconnect; the same
      // transaction that imports a batch must still own this exact grant.
      const owned = await tx.syncState.updateMany({ where: { key: connection.key, cursor: connection.stored }, data: { cursor: connection.stored } });
      const org = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true } });
      if (!owned.count || !org) throw new Error("Meta was disconnected. Import stopped.");
      for (const lead of batch.data) {
        const eventId = `${organizationId}:${lead.id}`;
        if (await tx.webhookEvent.findUnique({ where: { provider_eventId: { provider: "META_LEADS", eventId } } })) { job.skipped++; continue; }
        const id = `meta_${crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 40)}`;
        await tx.lead.create({ data: { id, organizationId, ...metaLeadFields(lead), source: "FACEBOOK", status: "NEW" } });
        await tx.webhookEvent.create({ data: { provider: "META_LEADS", eventId, type: `page:${connection.pageId}`, status: "PROCESSED", processedAt: new Date() } });
        job.imported++;
      }
      job.leadAfter = nextCursor(batch.paging);
      if (!job.leadAfter && formId) job.forms.shift();
      job.done = job.formsLoaded && !job.forms.length && !job.formAfter;
      job.leaseUntil = 0;
      const saved = await tx.syncState.updateMany({ where: { key, cursor: locked }, data: { cursor: JSON.stringify(job) } });
      if (!saved.count) throw new Error("Import session changed. Please try again.");
      if (batch.data.length) await tx.activityEvent.create({ data: { organizationId, actorId, kind: "CREATED", summary: `Meta lead import: ${job.imported} imported in this run.` } });
    }, { timeout: 20000 });
    return { done: job.done, imported: job.imported, skipped: job.skipped };
  } catch (error) {
    // Restore the pre-batch cursor so failed imports are retried, never skipped.
    await db.syncState.updateMany({ where: { key, cursor: locked }, data: { cursor: row.cursor === locked ? JSON.stringify({ generation: connection.generation, done: false, forms: [], formsLoaded: false, imported: 0, skipped: 0, leaseUntil: 0 }) : row.cursor } });
    throw error;
  }
}
