import "server-only";
// A CONTRACTOR'S BOOK BROUGHT OVER — THE DATABASE SIDE (2026-11-16; the pure rules are lib/import/plan, columns,
// values, table). Reading the dropped files, what the book already holds, writing an import, and taking it back.
//
// WRITING. One DataImport row first (RUNNING), then in batches: the new clients (tagged "From Housecall Pro"), the
// empty fields of the clients already in JobFlex, the email opt-outs, the upcoming jobs with their calendar events,
// the open invoices, the history — every row carrying the import's id. Any failure takes back what was written and
// marks the import FAILED. Nothing here sends a text, an email or a reminder, and none of it is anything the
// reminder ladders read (they work from proposals and their schedules; an imported invoice is a row of the invoice
// book, PENDING until the money is recorded).
//
// UNDO. Everything the import made goes, except what has been worked on since: a job someone was put on (crew,
// photos, receipts, hours, messages), an invoice that took a payment, a client with a proposal, a job, a project, an
// appointment or a message of its own since — those stay, and the answer says how many. Clients go the way the app
// deletes a client (deletedAt). Fields it filled on clients already in JobFlex are emptied again where they still
// hold what it brought. (The email opt-outs it carried over stay: they are the clients' own wishes.)

import { gunzipSync } from "node:zlib";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { db } from "@/lib/db";
import { OfficeFileError, xlsxSheets } from "@/lib/officeText";
import { getOpenAI, isOpenAIEnabled, isReasoningModelName, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { MAX_TABLE_ROWS, parseDelimited, tableOf, type Table } from "./table";
import { FIELDS_FOR, type FileKind, type ImportField } from "./columns";
import { sourceInfo, type ImportSource } from "./sources";
import type { ClientFields, ExistingClient, ImportPlan, PlanCounts } from "./plan";

export class ImportFileError extends Error {}

/** The most one import brings in, file by file (8 MB is the upload's own ceiling). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const BATCH = 400;

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 24);
const idOf = () => `c${newId()}`;

/** A text file's words, whatever it was saved as: UTF-8 (with or without its mark) or Excel's "Unicode text" (UTF-16). */
function textOf(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buf.toString("utf8");
}

/** The most a packed text file may open up to: ten years of jobs is a few tens of MB; past that it is no export. */
const MAX_UNPACKED_BYTES = 48 * 1024 * 1024;

/** A dropped file's tables: a CSV is one; a workbook one per sheet with something on it. */
export async function tablesOf(file: File): Promise<Array<{ name: string; table: Table }>> {
  if (file.size > MAX_FILE_BYTES) throw new ImportFileError(`${file.name} is over 8 MB. Export it in parts (a year at a time), or as CSV, which is smaller.`);
  let name = file.name;
  let buf = Buffer.from(await file.arrayBuffer());
  // The page packs a big CSV (gzip) before it sends it — an upload holds a few MB, and a CSV packs to a tenth.
  if (/\.gz$/i.test(name)) {
    name = name.replace(/\.gz$/i, "");
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_UNPACKED_BYTES });
    } catch (err) {
      const big = err instanceof RangeError || /maxOutputLength|buffer/i.test(err instanceof Error ? err.message : "");
      throw new ImportFileError(big ? `${name} is over ${MAX_UNPACKED_BYTES / 1024 / 1024} MB. Export it in parts (a year at a time).` : `${name} couldn't be opened. Try again.`);
    }
  }
  const lower = name.toLowerCase();
  if (/\.(csv|tsv|txt|text)$/.test(lower) || (!/\.[a-z0-9]+$/.test(lower) && !buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])))) {
    return [{ name, table: parseDelimited(textOf(buf)) }];
  }
  if (/\.(xlsx|xlsm)$/.test(lower)) {
    try {
      // A few rows past the ceiling, so tableOf can tell a sheet that holds more (Table.more) from one that ends there.
      const sheets = xlsxSheets(buf, 10, MAX_TABLE_ROWS + 100).filter((s) => s.rows.length > 1);
      return sheets.map((s) => ({ name: sheets.length > 1 ? `${name} · ${s.name}` : name, table: tableOf(s.rows) }));
    } catch (err) {
      throw new ImportFileError(err instanceof OfficeFileError ? `${name}: ${err.message}` : `${name} couldn't be opened. Save it as CSV and try again.`);
    }
  }
  if (/\.xls$/.test(lower)) throw new ImportFileError(`${name} is the old Excel format. Open it and save it as .xlsx or CSV.`);
  if (/\.numbers$/.test(lower)) throw new ImportFileError(`${name} is a Numbers file. In Numbers: File → Export To → CSV.`);
  throw new ImportFileError(`${name}: JobFlex reads CSV and Excel (.xlsx) files.`);
}

/** What the book already holds that an import is matched against. */
export async function loadBook(organizationId: string): Promise<{ existing: ExistingClient[]; invoiceNumbers: Set<string>; keys: Set<string>; timeZone: string }> {
  const [existing, invoices, jobKeys, invoiceKeys, historyKeys, org] = await Promise.all([
    db.client.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true, notes: true, importKey: true } }),
    db.invoice.findMany({ where: { organizationId }, select: { number: true } }),
    db.job.findMany({ where: { organizationId, importKey: { not: null } }, select: { importKey: true } }),
    db.invoice.findMany({ where: { organizationId, importKey: { not: null } }, select: { importKey: true } }),
    db.clientHistory.findMany({ where: { organizationId, importKey: { not: null } }, select: { importKey: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  const keys = new Set<string>([...jobKeys, ...invoiceKeys, ...historyKeys].map((r) => r.importKey!).filter(Boolean));
  return { existing, invoiceNumbers: new Set(invoices.map((i) => i.number)), keys, timeZone: org?.timezone || "America/New_York" };
}

/**
 * A MODEL READS THE COLUMNS THE RULES COULD NOT (a program JobFlex has no names for, a spreadsheet of the contractor's
 * own): the headers and three rows in, a field for each column out — only among the fields that kind of file takes.
 * Null when there is no model here or it answered nothing usable; the rules' reading then stands, and the person
 * still sets any column by hand.
 */
export async function modelMap(headers: readonly string[], samples: readonly string[][], kind: FileKind): Promise<ImportField[] | null> {
  if (!isOpenAIEnabled()) return null;
  const allowed = FIELDS_FOR[kind];
  const Shape = z.object({ columns: z.array(z.object({ index: z.number().int(), field: z.string() })) });
  try {
    const client = getOpenAI();
    const model = await resolveOpenAIModel();
    const res = await client.chat.completions.create({
      model,
      ...(isReasoningModelName(model) ? { reasoning_effort: "low" as const } : await samplingOptions(0)),
      max_completion_tokens: 1500,
      response_format: zodResponseFormat(Shape, "column_map"),
      messages: [
        {
          role: "system",
          content: `A contractor is moving their client book into JobFlex from another program. For each column of their exported file, pick the JobFlex field it holds, or "skip". Fields: ${allowed.join(", ")}. "name" is the client's whole name; "clientId" is the other program's number for the client; "due" is money still owed; "date" is when the work was scheduled. Use each field once, except phoneOther, notes, tags and email. Answer for every column index.`,
        },
        { role: "user", content: JSON.stringify({ kind, columns: headers.map((h, i) => ({ index: i, header: h, examples: samples.map((r) => r[i] ?? "").filter(Boolean).slice(0, 3) })) }) },
      ],
    });
    const parsed = Shape.safeParse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    if (!parsed.success) return null;
    const out: ImportField[] = headers.map(() => "skip");
    for (const c of parsed.data.columns) if (c.index >= 0 && c.index < headers.length && (allowed as readonly string[]).includes(c.field)) out[c.index] = c.field as ImportField;
    return out;
  } catch (err) {
    console.warn("[import] model map", err instanceof Error ? err.message : err);
    return null;
  }
}

const chunks = <T>(list: readonly T[], n = BATCH) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export interface ImportDone {
  importId: string;
  counts: PlanCounts;
}

/** Write a plan. On any failure what was written is taken back, the import is marked FAILED, and the error goes on. */
export async function applyImport(input: { organizationId: string; userId: string; source: ImportSource; plan: ImportPlan; files: Array<{ name: string; kind: FileKind; rows: number }> }): Promise<ImportDone> {
  const { organizationId, userId, source, plan } = input;
  const info = sourceInfo(source);
  const imp = await db.dataImport.create({ data: { organizationId, byUserId: userId, source, status: "RUNNING", filesJson: JSON.stringify(input.files) }, select: { id: true } });
  const importId = imp.id;
  // (Kept outside the try: a failure part way takes back the fields already filled too.)
  const filled: Array<{ id: string; fields: Partial<ClientFields> }> = [];
  try {
    // The clients' ids: the ones already in JobFlex keep theirs; the new ones get theirs here, so the work rows can name them.
    const ids = new Map<string, string>();
    for (const c of plan.clients) ids.set(c.ref, c.existingId ?? idOf());
    const fresh = plan.clients.filter((c) => !c.existingId);
    for (const part of chunks(fresh)) {
      await db.client.createMany({ data: part.map((c) => ({ id: ids.get(c.ref)!, organizationId, ...c.data, importId, importKey: c.importKey })) });
    }
    // Tags: where they came from, their own tags, "Do not contact".
    const tagIds = new Map<string, string>();
    const tagId = async (label: string) => {
      const key = label.toLowerCase();
      if (tagIds.has(key)) return tagIds.get(key)!;
      const tag = await db.tag.upsert({ where: { organizationId_label: { organizationId, label } }, update: {}, create: { organizationId, label, color: "#1854a0" } });
      tagIds.set(key, tag.id);
      return tag.id;
    };
    const fromLabel = source === "OTHER" ? "Imported" : `From ${info.label}`;
    const links: Array<{ clientId: string; tagId: string }> = [];
    for (const c of fresh) {
      const labels = [fromLabel, ...c.tags, ...(c.doNotContact ? ["Do not contact"] : [])];
      const seen = new Set<string>();
      for (const label of labels) {
        const id = await tagId(label);
        if (seen.has(id)) continue;
        seen.add(id);
        links.push({ clientId: ids.get(c.ref)!, tagId: id });
      }
    }
    for (const part of chunks(links, 1000)) await db.clientTag.createMany({ data: part });
    // The empty fields of clients already in JobFlex.
    for (const c of plan.clients) {
      if (!c.existingId || !Object.keys(c.fill).length) continue;
      await db.client.update({ where: { id: c.existingId }, data: { ...c.fill, ...(c.importKey ? { importKey: c.importKey } : {}) } });
      filled.push({ id: c.existingId, fields: c.fill });
    }
    // Unsubscribed from email: this company's own opt-out list (a text needs the client's consent anyway).
    const optOuts = [...new Set(plan.clients.filter((c) => c.emailOptOut).map((c) => (c.data.email ?? c.fill.email ?? "").toLowerCase()).filter(Boolean))];
    if (optOuts.length) {
      const have = new Set((await db.clientEmailOptOut.findMany({ where: { organizationId, email: { in: optOuts } }, select: { email: true } })).map((o) => o.email));
      const add = optOuts.filter((e) => !have.has(e));
      for (const part of chunks(add)) await db.clientEmailOptOut.createMany({ data: part.map((email) => ({ organizationId, email, via: "office" })) });
    }
    // Upcoming jobs, each dated one on the calendar.
    const jobs = plan.jobs.map((j) => ({ ...j, id: idOf() }));
    for (const part of chunks(jobs)) {
      await db.job.createMany({ data: part.map((j) => ({ id: j.id, organizationId, clientId: ids.get(j.client) ?? null, title: j.title, status: "SCHEDULED", notes: j.notes, startsAt: j.startsAt, endsAt: j.endsAt, importId, importKey: j.importKey })) });
      const dated = part.filter((j) => j.startsAt);
      if (dated.length) await db.jobEvent.createMany({ data: dated.map((j) => ({ organizationId, jobId: j.id, createdById: userId, title: j.title, startsAt: j.startsAt!, endsAt: j.endsAt ?? new Date(j.startsAt!.getTime() + 2 * 3600_000), notes: j.notes })) });
    }
    // Money still owed: open invoices under the other program's numbers.
    for (const part of chunks(plan.invoices)) {
      await db.invoice.createMany({ data: part.map((v) => ({ organizationId, clientId: ids.get(v.client) ?? null, number: v.number, amount: v.amount, billedAmount: v.billed ?? v.amount, status: "PENDING", provider: "MANUAL", dueDate: v.dueDate, ...(v.issuedAt ? { createdAt: v.issuedAt } : {}), importId, importKey: v.importKey })) });
    }
    // The history.
    for (const part of chunks(plan.history)) {
      await db.clientHistory.createMany({
        data: part.map((h) => ({ organizationId, clientId: ids.get(h.client)!, importId, importKey: h.importKey, kind: h.kind, number: h.number, title: h.title, status: h.status, amount: h.amount, paid: h.paid, due: h.due, date: h.date, by: h.by, notes: h.notes, source })),
      });
    }
    await db.dataImport.update({ where: { id: importId }, data: { status: "DONE", countsJson: JSON.stringify(plan.counts), filledJson: filled.length ? JSON.stringify(filled) : null } });
    const n = plan.counts;
    await logActivity({
      organizationId,
      actorId: userId,
      kind: TRAIL_KINDS.CLIENT,
      summary: `Brought in from ${info.label}: ${n.newClients} new client${n.newClients === 1 ? "" : "s"}${n.joined ? `, ${n.joined} joined to clients already here` : ""}${n.invoices ? `, ${n.invoices} open invoice${n.invoices === 1 ? "" : "s"} ($${n.owed.toLocaleString("en-US")})` : ""}${n.upcoming + n.unscheduled ? `, ${n.upcoming + n.unscheduled} upcoming job${n.upcoming + n.unscheduled === 1 ? "" : "s"}` : ""}${n.history ? `, ${n.history} past record${n.history === 1 ? "" : "s"}` : ""}`,
      meta: { importId, source },
    });
    return { importId, counts: plan.counts };
  } catch (err) {
    console.error("[import] failed", err instanceof Error ? err.message : err);
    await takeBack(organizationId, importId, filled.length ? JSON.stringify(filled) : null).catch((e) => console.error("[import] take back", e instanceof Error ? e.message : e));
    await db.dataImport.update({ where: { id: importId }, data: { status: "FAILED" } }).catch(() => {});
    throw err;
  }
}

export interface UndoResult {
  removed: { clients: number; jobs: number; invoices: number; history: number; fields: number };
  kept: { clients: number; jobs: number; invoices: number };
}

/** Take back what an import made (see the head of this file for what stays). */
async function takeBack(organizationId: string, importId: string, filledJson: string | null): Promise<UndoResult> {
  // Jobs: the ones nobody has worked on since.
  const jobs = await db.job.findMany({
    where: { organizationId, importId },
    select: { id: true, _count: { select: { assignments: true, photos: true, expenses: true, workDays: true, messages: true, changeOrders: true, reviewRequests: true, crewHours: true, punchItems: true } } },
  });
  const worked = (c: Record<string, number>) => Object.values(c).some((n) => n > 0);
  const dropJobs = jobs.filter((j) => !worked(j._count)).map((j) => j.id);
  for (const part of chunks(dropJobs, 500)) {
    await db.jobEvent.deleteMany({ where: { organizationId, jobId: { in: part } } });
    await db.job.deleteMany({ where: { organizationId, id: { in: part } } });
  }
  // Invoices: the ones still open with no payment recorded on them.
  const invoices = await db.invoice.findMany({ where: { organizationId, importId }, select: { id: true, status: true, clientId: true, _count: { select: { payments: true } } } });
  const dropInvoices = invoices.filter((v) => v.status === "PENDING" && v._count.payments === 0).map((v) => v.id);
  for (const part of chunks(dropInvoices, 500)) await db.invoice.deleteMany({ where: { organizationId, id: { in: part } } });
  const history = await db.clientHistory.deleteMany({ where: { organizationId, importId } });
  // Clients it made: the ones with nothing of their own since.
  const keptInvoiceClients = new Set(invoices.filter((v) => !dropInvoices.includes(v.id)).map((v) => v.clientId).filter(Boolean) as string[]);
  const clients = await db.client.findMany({
    where: { organizationId, importId, deletedAt: null },
    select: { id: true, _count: { select: { proposals: true, jobs: true, projects: true, appointments: true, payments: true, threads: true, bookings: true, servicePlans: true, reviewRequests: true } } },
  });
  const dropClients = clients.filter((c) => !worked(c._count) && !keptInvoiceClients.has(c.id)).map((c) => c.id);
  const now = new Date();
  for (const part of chunks(dropClients, 500)) await db.client.updateMany({ where: { organizationId, id: { in: part } }, data: { deletedAt: now } });
  // Fields it filled on clients already here, where they still hold what it brought.
  let fields = 0;
  if (filledJson) {
    let filled: Array<{ id: string; fields: Record<string, string> }> = [];
    try {
      filled = JSON.parse(filledJson);
    } catch {
      filled = [];
    }
    for (const f of filled) {
      const now = await db.client.findFirst({ where: { id: f.id, organizationId }, select: { email: true, phone: true, address: true, city: true, state: true, zip: true, notes: true } });
      if (!now) continue;
      const back: Record<string, null> = {};
      for (const [k, v] of Object.entries(f.fields)) if ((now as Record<string, string | null>)[k] === v) back[k] = null;
      if (Object.keys(back).length) {
        await db.client.update({ where: { id: f.id }, data: back });
        fields += Object.keys(back).length;
      }
    }
  }
  return {
    removed: { clients: dropClients.length, jobs: dropJobs.length, invoices: dropInvoices.length, history: history.count, fields },
    kept: { clients: clients.length - dropClients.length, jobs: jobs.length - dropJobs.length, invoices: invoices.length - dropInvoices.length },
  };
}

/** UNDO THIS IMPORT. */
export async function undoImport(organizationId: string, importId: string, userId: string): Promise<UndoResult | null> {
  const imp = await db.dataImport.findFirst({ where: { id: importId, organizationId, status: "DONE" }, select: { id: true, source: true, filledJson: true } });
  if (!imp) return null;
  const res = await takeBack(organizationId, importId, imp.filledJson);
  await db.dataImport.update({ where: { id: importId }, data: { status: "UNDONE", undoneAt: new Date() } });
  await logActivity({
    organizationId,
    actorId: userId,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Undid the import from ${sourceInfo(imp.source as ImportSource).label}: ${res.removed.clients} client${res.removed.clients === 1 ? "" : "s"} removed${res.kept.clients ? `, ${res.kept.clients} kept (worked on since)` : ""}`,
    meta: { importId },
  });
  return res;
}

export interface ImportRecord {
  id: string;
  source: ImportSource;
  label: string;
  status: string;
  createdAt: string;
  undoneAt: string | null;
  files: Array<{ name: string; kind: FileKind; rows: number }>;
  counts: PlanCounts | null;
}

/** The company's imports, newest first. */
export async function listImports(organizationId: string): Promise<ImportRecord[]> {
  const rows = await db.dataImport.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 });
  const json = <T>(s: string | null, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  return rows.map((r) => ({
    id: r.id,
    source: r.source as ImportSource,
    label: sourceInfo(r.source as ImportSource).label,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    undoneAt: r.undoneAt ? r.undoneAt.toISOString() : null,
    files: json(r.filesJson, []),
    counts: json<PlanCounts | null>(r.countsJson, null),
  }));
}
