"use server";
// BRING YOUR CLIENTS (2026-11-16 — the owner: "move contractors' CRM base with clients to JobFlex from other platforms
// like Housecall Pro"; parts 1–2 of the plan: clients, then their invoices, schedule and history). The page
// /dashboard/clients/import calls these: PREVIEW the dropped files (what each is, which column is what, what would
// come in), RUN the import as the person set it, UNDO one, LIST them. The owner, an admin or a manager imports (a
// whole book changes hands).
//
// The files travel with every call (a server action holds 8 MB): the preview keeps nothing, and the run reads them
// again with the kinds and columns the person confirmed.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isLimitedRole, requireManager, requireOrg } from "@/lib/orgContext";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { rateLimitShared } from "@/lib/rateLimit";
import { applyImport, ImportFileError, listImports as listFor, loadBook, modelMap, tablesOf, undoImport as undoFor, type ImportRecord, type UndoResult } from "@/lib/import/server";
import { FIELDS_FOR, FILE_KINDS, kindOf, mapColumns, missingFields, type FileKind, type ImportField } from "@/lib/import/columns";
import { isImportSource, sourceOfHeaders, type ImportSource } from "@/lib/import/sources";
import { planImport, type ImportFile, type ImportPlan, type PlanCounts, type PlanSkip } from "@/lib/import/plan";

export interface PreviewFile {
  /** "file:sheet" — which dropped file, which of its sheets. */
  id: string;
  name: string;
  kind: FileKind;
  /** What the rules took it for. */
  guess: FileKind;
  /** The program its columns give away. */
  detected: ImportSource | null;
  headers: string[];
  map: ImportField[];
  /** Its first rows, for the person to see their columns' contents. */
  samples: string[][];
  rows: number;
  /** What it lacks to be brought in ("a client name, email or phone"). */
  missing: string[];
  /** A model read the columns the rules did not know. */
  byModel: boolean;
  /** The file holds more rows than one import reads (lib/import/table MAX_TABLE_ROWS): only the first were read. */
  cut: boolean;
}

export type ImportPreview =
  | {
      ok: true;
      source: ImportSource;
      files: PreviewFile[];
      counts: PlanCounts;
      skipped: PlanSkip[];
      examples: { clients: string[]; joined: string[]; invoices: string[]; jobs: string[]; history: string[] };
      /** Why it cannot be brought in as it is (a plan's limit), or null. */
      blocked: string | null;
    }
  | { ok: false; error: string };

const Setup = z
  .array(
    z.object({
      id: z.string().max(20),
      kind: z.enum(["clients", "work", "estimates"]).optional(),
      map: z.array(z.string().max(30)).max(400).optional(),
      leaveOut: z.boolean().optional(),
    }),
  )
  .max(40);

/** The most rows one import reads, across its files. */
const MAX_ROWS = 60_000;

type Prepared = { source: ImportSource; files: Array<ImportFile & { id: string; guess: FileKind; detected: ImportSource | null; byModel: boolean }> };

async function prepare(form: FormData, organizationId: string, allowModel: boolean): Promise<Prepared> {
  const raw = String(form.get("source") ?? "OTHER");
  const source: ImportSource = isImportSource(raw) ? raw : "OTHER";
  let setup: z.infer<typeof Setup> = [];
  try {
    setup = Setup.parse(JSON.parse(String(form.get("setup") ?? "[]")));
  } catch {
    setup = [];
  }
  const dropped = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 12);
  if (!dropped.length) throw new ImportFileError("Pick the files you exported (CSV or Excel).");
  const files: Prepared["files"] = [];
  let total = 0;
  let modelReads = 0;
  for (const [fi, file] of dropped.entries()) {
    const tables = await tablesOf(file);
    for (const [ti, { name, table }] of tables.entries()) {
      const id = `${fi}:${ti}`;
      const set = setup.find((s) => s.id === id);
      if (set?.leaveOut || !table.headers.length || !table.rows.length) continue;
      total += table.rows.length;
      if (total > MAX_ROWS) throw new ImportFileError(`That is over ${MAX_ROWS.toLocaleString("en-US")} rows in one go. Bring the clients first, then the jobs a few years at a time.`);
      const guess = kindOf(name, table.headers);
      const kind = set?.kind && FILE_KINDS.includes(set.kind) ? set.kind : guess;
      const allowed = FIELDS_FOR[kind] as readonly string[];
      let map: ImportField[] = mapColumns(table.headers, kind);
      let byModel = false;
      if (set?.map && set.map.length === table.headers.length) {
        map = set.map.map((f) => (allowed.includes(f) ? (f as ImportField) : "skip"));
      } else if (allowModel && missingFields(kind, map).length && modelReads < 3 && (await rateLimitShared(`import-map:${organizationId}`, 30, 60 * 60 * 1000)).ok) {
        // The rules could not read what this file needs: a model reads its columns; the rules' own reading stays where it had one.
        modelReads++;
        const read = await modelMap(table.headers, table.rows.slice(0, 3), kind);
        if (read) {
          map = map.map((f, i) => (f === "skip" && read[i] !== "skip" ? read[i] : f));
          byModel = true;
        }
      }
      files.push({ id, name, kind, guess, detected: sourceOfHeaders(table.headers), map, table, byModel });
    }
  }
  if (!files.length) throw new ImportFileError("Those files have no rows to bring in.");
  return { source, files };
}

/** Whether the company's plan holds what the import adds: a sentence when it does not. */
async function overLimit(organizationId: string, actorId: string, plan: ImportPlan): Promise<string | null> {
  const asks: Array<[Parameters<typeof checkPlanLimit>[1], number, string]> = [
    ["clients", plan.counts.newClients, "new clients"],
    ["jobs", plan.jobs.length, "upcoming jobs"],
    ["calendarEvents", plan.jobs.filter((j) => j.startsAt).length, "jobs on the calendar"],
  ];
  for (const [key, n, what] of asks) {
    if (n <= 0) continue;
    const st = await checkPlanLimit(organizationId, key, n, { actorId });
    if (!st.allowed) {
      const room = st.remaining ?? 0;
      return `Your plan has room for ${room.toLocaleString("en-US")} more ${what}${st.limit !== null ? ` (it holds ${st.limit.toLocaleString("en-US")})` : ""} — this import has ${n.toLocaleString("en-US")}. Upgrade your plan to bring them all in, or bring a smaller file.`;
    }
  }
  return null;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ImportFileError) return { ok: false, error: err.message };
  const msg = err instanceof Error ? err.message : "";
  if (/plan limit|upgrade/i.test(msg)) return { ok: false, error: msg };
  console.error("[import]", msg || err);
  return { ok: false, error: "Something went wrong reading those files. Nothing was brought in. Try again." };
}

/** PREVIEW: what the dropped files are, which column is what, and what would come in. Nothing is written. */
export async function previewImport(form: FormData): Promise<ImportPreview> {
  try {
    const { organizationId, user } = await requireManager();
    const prepared = await prepare(form, organizationId, true);
    const book = await loadBook(organizationId);
    const plan = planImport({ source: prepared.source, files: prepared.files, existing: book.existing, timeZone: book.timeZone, now: new Date(), invoiceNumbers: book.invoiceNumbers, keys: book.keys });
    const nameOf = new Map(plan.clients.map((c) => [c.ref, c.data.name]));
    return {
      ok: true,
      source: prepared.source,
      files: prepared.files.map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        guess: f.guess,
        detected: f.detected,
        headers: f.table.headers,
        map: f.map,
        samples: f.table.rows.slice(0, 3),
        rows: f.table.rows.length,
        missing: missingFields(f.kind, f.map),
        byModel: f.byModel,
        cut: !!f.table.more,
      })),
      counts: plan.counts,
      skipped: plan.skipped.slice(0, 30),
      examples: {
        clients: plan.clients.filter((c) => !c.existingId).slice(0, 6).map((c) => [c.data.name, c.data.phone ?? c.data.email, c.data.city].filter(Boolean).join(" · ")),
        joined: plan.clients.filter((c) => c.existingId).slice(0, 4).map((c) => c.data.name),
        invoices: plan.invoices.slice(0, 4).map((v) => `${nameOf.get(v.client) ?? ""} · ${v.number} · ${money(v.amount)} owed`),
        jobs: plan.jobs.slice(0, 4).map((j) => `${nameOf.get(j.client) ?? ""} · ${j.title}${j.startsAt ? ` · ${j.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: book.timeZone })}` : " · not scheduled yet"}`),
        history: plan.history.slice(0, 4).map((h) => `${nameOf.get(h.client) ?? ""} · ${h.title}${h.amount !== null ? ` · ${money(h.amount)}` : ""}${h.status ? ` · ${h.status}` : ""}`),
      },
      blocked: await overLimit(organizationId, user.id, plan),
    };
  } catch (err) {
    return fail(err);
  }
}

/** RUN: bring them in, as the person set the files up. */
export async function runImport(form: FormData): Promise<{ ok: true; importId: string; counts: PlanCounts } | { ok: false; error: string }> {
  try {
    const { organizationId, user } = await requireManager();
    const prepared = await prepare(form, organizationId, false);
    for (const f of prepared.files) {
      const missing = missingFields(f.kind, f.map);
      if (missing.length) return { ok: false, error: `${f.name}: set which column holds ${missing.join(" and ")}, or leave the file out.` };
    }
    const book = await loadBook(organizationId);
    const plan = planImport({ source: prepared.source, files: prepared.files, existing: book.existing, timeZone: book.timeZone, now: new Date(), invoiceNumbers: book.invoiceNumbers, keys: book.keys });
    const c = plan.counts;
    if (!plan.clients.length && !plan.jobs.length && !plan.invoices.length && !plan.history.length) {
      return { ok: false, error: c.again ? "Everything in those files is already in JobFlex — nothing new to bring in." : "Those files have nothing JobFlex can bring in." };
    }
    const blocked = await overLimit(organizationId, user.id, plan);
    if (blocked) return { ok: false, error: blocked };
    const done = await applyImport({ organizationId, userId: user.id, source: prepared.source, plan, files: prepared.files.map((f) => ({ name: f.name, kind: f.kind, rows: f.table.rows.length })) });
    for (const p of ["/dashboard/clients", "/dashboard/calendar", "/dashboard/financials", "/dashboard/crm", "/dashboard/jobs"]) {
      try {
        revalidatePath(p);
      } catch {
        /* a page that is not cached has nothing to drop */
      }
    }
    return { ok: true, importId: done.importId, counts: done.counts };
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
    for (const p of ["/dashboard/clients", "/dashboard/calendar", "/dashboard/financials", "/dashboard/crm", "/dashboard/jobs"]) {
      try {
        revalidatePath(p);
      } catch {
        /* nothing cached */
      }
    }
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
