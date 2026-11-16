import "server-only";
// ONE WAY THROUGH AN IMPORT (2026-11-16) — the steps every import takes, whoever starts it: the contractor on
// /dashboard/clients/import (actions/dataImport — the files travel with the call) or a platform admin working a
// "Do it for me" request in Admin → Imports (actions/importRequests — the files are read from the private store).
//
//   prepareFiles — the files as tables: what each is, which column is what (the person's own setup first, then the
//                  rules, then a model for what the rules did not know);
//   buildPreview — what would come in, nothing written;
//   runPipeline  — bring it in, as the person set it.
//
// Plan limits are checked as `limitActorId`: the contractor themself, or — when a platform admin brings it in for
// them — the person who asked (an admin is exempt from limits; the company is not).

import { z } from "zod";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { rateLimitShared } from "@/lib/rateLimit";
import { applyImport, ImportFileError, loadBook, modelMap, tablesOf } from "./server";
import { FIELDS_FOR, FILE_KINDS, kindOf, mapColumns, missingFields, type FileKind, type ImportField } from "./columns";
import { sourceOfHeaders, type ImportSource } from "./sources";
import { planImport, type ImportFile, type ImportPlan, type PlanCounts, type PlanSkip } from "./plan";

export interface PreviewFile {
  /** "file:sheet" — which file, which of its sheets. */
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

/** A file that could not be read (an old Excel, a PDF) — said, not fatal, when the import is worked for a company. */
export interface UnreadFile {
  name: string;
  why: string;
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
      /** Files that could not be read (only when the caller tolerates them). */
      unread: UnreadFile[];
    }
  | { ok: false; error: string };

export type RunResult = { ok: true; importId: string; counts: PlanCounts } | { ok: false; error: string };

const SetupSchema = z
  .array(
    z.object({
      id: z.string().max(20),
      kind: z.enum(["clients", "work", "estimates"]).optional(),
      map: z.array(z.string().max(30)).max(400).optional(),
      leaveOut: z.boolean().optional(),
    }),
  )
  .max(40);
export type Setup = z.infer<typeof SetupSchema>;

/** The person's setup as the page sent it (JSON); anything malformed is no setup at all. */
export function parseSetup(raw: unknown): Setup {
  try {
    return SetupSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return [];
  }
}

/** The most rows one import reads, across its files. */
const MAX_ROWS = 60_000;

export interface PipelineInput {
  organizationId: string;
  /** Whose plan limits the import is checked against. */
  limitActorId: string;
  source: ImportSource;
  setup: Setup;
  files: File[];
  /** A model may read columns the rules did not know (the preview only; the run uses what the preview showed). */
  allowModel: boolean;
  /** The heaviest file read (the contractor's call carries 8 MB; a stored request file may be 50). */
  maxFileBytes?: number;
  /** A file that cannot be read is listed and left out instead of stopping the import (Admin → Imports). */
  tolerate?: boolean;
}

type Prepared = { files: Array<ImportFile & { id: string; guess: FileKind; detected: ImportSource | null; byModel: boolean }>; unread: UnreadFile[] };

export async function prepareFiles(input: PipelineInput): Promise<Prepared> {
  // Each file keeps its place in the list ("0:0", "1:0"…) on every read, so the person's setup stays on its file even
  // when one before it is empty or gone from the store.
  const dropped = input.files.slice(0, 12);
  if (!dropped.some((f) => f.size > 0)) throw new ImportFileError("Pick the files you exported (CSV or Excel).");
  const files: Prepared["files"] = [];
  const unread: UnreadFile[] = [];
  let total = 0;
  let modelReads = 0;
  for (const [fi, file] of dropped.entries()) {
    if (!file.size) {
      if (input.tolerate) unread.push({ name: file.name, why: "This file is empty or no longer in storage." });
      continue;
    }
    let tables: Awaited<ReturnType<typeof tablesOf>>;
    try {
      tables = await tablesOf(file, { maxBytes: input.maxFileBytes });
    } catch (err) {
      if (input.tolerate && err instanceof ImportFileError) {
        unread.push({ name: file.name.replace(/\.gz$/i, ""), why: err.message });
        continue;
      }
      throw err;
    }
    for (const [ti, { name, table }] of tables.entries()) {
      const id = `${fi}:${ti}`;
      const set = input.setup.find((s) => s.id === id);
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
      } else if (input.allowModel && missingFields(kind, map).length && modelReads < 3 && (await rateLimitShared(`import-map:${input.organizationId}`, 30, 60 * 60 * 1000)).ok) {
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
  if (!files.length && !unread.length) throw new ImportFileError("Those files have no rows to bring in.");
  return { files, unread };
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
      return `The plan has room for ${room.toLocaleString("en-US")} more ${what}${st.limit !== null ? ` (it holds ${st.limit.toLocaleString("en-US")})` : ""} — this import has ${n.toLocaleString("en-US")}. Upgrade the plan to bring them all in, or bring a smaller file.`;
    }
  }
  return null;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** PREVIEW: what the files are, which column is what, and what would come in. Nothing is written. */
export async function buildPreview(input: PipelineInput): Promise<ImportPreview> {
  const prepared = await prepareFiles(input);
  const book = await loadBook(input.organizationId);
  const plan = planImport({ source: input.source, files: prepared.files, existing: book.existing, timeZone: book.timeZone, now: new Date(), invoiceNumbers: book.invoiceNumbers, keys: book.keys });
  const nameOf = new Map(plan.clients.map((c) => [c.ref, c.data.name]));
  return {
    ok: true,
    source: input.source,
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
    blocked: await overLimit(input.organizationId, input.limitActorId, plan),
    unread: prepared.unread,
  };
}

/** RUN: bring it in, as the person set the files up. `onBehalf` = the JobFlex team brings it in for the company. */
export async function runPipeline(input: PipelineInput & { userId: string; onBehalf?: boolean }): Promise<RunResult> {
  const prepared = await prepareFiles({ ...input, allowModel: false });
  for (const f of prepared.files) {
    const missing = missingFields(f.kind, f.map);
    if (missing.length) return { ok: false, error: `${f.name}: set which column holds ${missing.join(" and ")}, or leave the file out.` };
  }
  const book = await loadBook(input.organizationId);
  const plan = planImport({ source: input.source, files: prepared.files, existing: book.existing, timeZone: book.timeZone, now: new Date(), invoiceNumbers: book.invoiceNumbers, keys: book.keys });
  const c = plan.counts;
  if (!plan.clients.length && !plan.jobs.length && !plan.invoices.length && !plan.history.length) {
    return { ok: false, error: c.again ? "Everything in those files is already in JobFlex — nothing new to bring in." : "Those files have nothing JobFlex can bring in." };
  }
  const blocked = await overLimit(input.organizationId, input.limitActorId, plan);
  if (blocked) return { ok: false, error: blocked };
  const done = await applyImport({
    organizationId: input.organizationId,
    userId: input.userId,
    source: input.source,
    plan,
    files: prepared.files.map((f) => ({ name: f.name, kind: f.kind, rows: f.table.rows.length })),
    onBehalf: input.onBehalf,
  });
  return { ok: true, importId: done.importId, counts: done.counts };
}
