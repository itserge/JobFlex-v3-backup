import "server-only";
// THE ESTIMATE READ AND THE COMPARISON — the database half (2026-11-08, the subcontractors plan, part 2). The rules are
// ./shared; the PDF's words come from ./pdfText; the sweep (./sweep) runs the queued reads.
//
//   · readVersion      — one version's document read by the model: a PDF's text layer when it has one, the PDF itself
//                        (the vision model) when it is a scan, a picture as a picture. The figures land on the version
//                        as "needs review" (READ); two failures mark it FAILED. Nothing else changes.
//   · runPendingReads  — the queue, for the sweep and the webhook's after().
//   · acceptRead       — "Use these": the read's total becomes the version's (and the current quote's) price.
//   · rejectRead       — the person says the read is wrong; the figures stay stored, set aside.
//   · requeueRead      — read it again.
//   · compareRequest   — the request's quotes side by side, from the reads.
//   · compareWords     — the model's two sentences on the difference, from the fields only; cached on the request.

import { zodResponseFormat } from "openai/helpers/zod";
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { localDayKey } from "@/lib/jobProgressShared";
import { readStoredAsDataUrl } from "@/lib/media/privateStore";
import { getOpenAI, getVisionModel, isOpenAIEnabled, isReasoningModelName, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { noteRequestOrg } from "@/lib/trialMeter";
import { dollars, stageSubsBudget } from "@/lib/projectSubs/shared";
import { pdfTextOf } from "./pdfText";
import {
  COMPARE_SCHEMA_NAME,
  COMPARE_SYSTEM,
  CompareWords,
  QuoteRead,
  READ_SCHEMA_NAME,
  READ_SYSTEM,
  compareFallbackWords,
  compareTable,
  compareWordsInput,
  figureChecks,
  parseStoredCompare,
  parseStoredRead,
  type CompareIn,
  type CompareRow,
  type StoredCompare,
  type StoredRead,
} from "./shared";

const MAX_READ_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const MAX_ATTEMPTS = 2;

export type ReadOutcome = { ok: boolean; status: string; read: StoredRead | null; error: string | null };

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}

/** A HEIC picture as a JPEG data URL through sharp when this server's sharp can decode it; null otherwise. */
async function heicToJpeg(buf: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(buf).rotate().jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The model's read of one version's document; the result stored on the version. */
export async function readVersion(versionId: string): Promise<ReadOutcome> {
  const v = await db.subQuoteVersion.findUnique({
    where: { id: versionId },
    select: { id: true, organizationId: true, readAttempts: true, reviewStatus: true, document: { select: { id: true, url: true, name: true, contentType: true } }, quote: { select: { projectId: true } } },
  });
  if (!v) return { ok: false, status: "NONE", read: null, error: "Version not found" };
  if (!v.document) {
    await db.subQuoteVersion.update({ where: { id: v.id }, data: { reviewStatus: "NONE" } });
    return { ok: false, status: "NONE", read: null, error: "No document on this version." };
  }
  const attempts = v.readAttempts + 1;
  const fail = async (words: string): Promise<ReadOutcome> => {
    const status = attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
    await db.subQuoteVersion.update({ where: { id: v.id }, data: { readAttempts: attempts, readError: words.slice(0, 500), reviewStatus: status } });
    return { ok: false, status, read: null, error: words };
  };
  if (!isOpenAIEnabled()) {
    await db.subQuoteVersion.update({ where: { id: v.id }, data: { readAttempts: attempts, readError: "AI is not set up on this server.", reviewStatus: "FAILED" } });
    return { ok: false, status: "FAILED", read: null, error: "Reading an estimate needs AI, which is not set up on this server." };
  }
  try {
    await noteRequestOrg(v.organizationId);
    const dataUrl = await readStoredAsDataUrl(v.document.url, MAX_READ_BYTES);
    if (!dataUrl) return await fail("The file could not be opened — missing, or larger than 20 MB.");
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) return await fail("The file could not be decoded.");
    const type = (v.document.contentType ?? m[1]).toLowerCase();
    const isPdf = type === "application/pdf" || /\.pdf$/i.test(v.document.name);
    const buf = Buffer.from(m[2], "base64");

    let from: StoredRead["from"] = "text";
    let text: string | null = null;
    let pages: number | null = null;
    let parts: Array<Record<string, unknown>>;
    if (isPdf) {
      const words = await pdfTextOf(new Uint8Array(buf)).catch(() => null);
      if (!words) return await fail("The PDF could not be opened.");
      pages = words.pages;
      if (!words.sparse) {
        text = words.text.slice(0, MAX_TEXT_CHARS);
        parts = [{ type: "text", text: `The estimate's words, extracted from the PDF (${words.pages} page${words.pages === 1 ? "" : "s"}):\n\n${text}` }];
      } else {
        from = "pdf";
        parts = [
          { type: "text", text: `The estimate is this PDF — a scan with no text layer (${words.pages} page${words.pages === 1 ? "" : "s"}); read the pages.` },
          { type: "file", file: { filename: v.document.name.replace(/[^A-Za-z0-9._-]/g, "-"), file_data: `data:application/pdf;base64,${m[2]}` } },
        ];
      }
    } else if (/^image\/(jpeg|png|webp)$/.test(type)) {
      from = "picture";
      parts = [
        { type: "text", text: "The estimate is this picture of the page." },
        { type: "image_url", image_url: { url: `data:${type};base64,${m[2]}`, detail: "high" } },
      ];
    } else if (/^image\/hei[cf]$/.test(type)) {
      const jpeg = await heicToJpeg(buf);
      if (!jpeg) return await fail("A HEIC picture — open it to read the figures, or ask for a PDF or a JPEG.");
      from = "picture";
      parts = [
        { type: "text", text: "The estimate is this picture of the page." },
        { type: "image_url", image_url: { url: jpeg, detail: "high" } },
      ];
    } else {
      return await fail(`Not a document the reader knows (${type}).`);
    }

    const client = getOpenAI();
    const model = from === "text" ? await resolveOpenAIModel() : getVisionModel();
    const reasoning = isReasoningModelName(model);
    const res = await client.chat.completions.create({
      model,
      ...(reasoning ? { reasoning_effort: "low" as const } : await samplingOptions(0)),
      max_completion_tokens: 6000,
      response_format: zodResponseFormat(QuoteRead, READ_SCHEMA_NAME),
      // The parts are built above as plain data; the SDK's union is satisfied at run time (text, file, image_url).
      messages: [
        { role: "system", content: READ_SYSTEM },
        { role: "user", content: parts as unknown as Array<{ type: "text"; text: string }> },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return await fail("The model answered nothing.");
    const parsed = QuoteRead.safeParse(JSON.parse(raw));
    if (!parsed.success) return await fail("The model's answer did not fit the schema.");
    const today = localDayKey(new Date(), await tzOf(v.organizationId));
    const read = { ...parsed.data, flags: [...parsed.data.flags, ...figureChecks(parsed.data, text, today)].slice(0, 12) };
    const stored: StoredRead = { read, model, from, chars: text?.length ?? null, pages, at: new Date().toISOString() };
    await db.subQuoteVersion.update({ where: { id: v.id }, data: { extractedJson: JSON.stringify(stored), extractedAt: new Date(), reviewStatus: "READ", readAttempts: attempts, readError: null } });
    console.log(`[quote-read] version ${v.id} · ${from}${pages ? ` · ${pages} p` : ""}${text ? ` · ${text.length} chars` : ""} · total ${read.total.value ?? "—"} · ${read.flags.length} flag(s)`);
    return { ok: true, status: "READ", read: stored, error: null };
  } catch (err) {
    const words = err instanceof Error ? err.message : String(err);
    console.error(`[quote-read] version ${v.id} failed: ${words}`);
    return await fail(words);
  }
}

/** The queued reads, oldest first. */
export async function runPendingReads(limit = 5): Promise<{ tried: number; read: number; failed: number }> {
  const rows = await db.subQuoteVersion.findMany({ where: { reviewStatus: "PENDING", documentId: { not: null } }, orderBy: { submittedAt: "asc" }, take: limit, select: { id: true } });
  let read = 0;
  let failed = 0;
  for (const r of rows) {
    const out = await readVersion(r.id);
    if (out.ok) read += 1;
    else failed += 1;
  }
  return { tried: rows.length, read, failed };
}

async function versionOf(organizationId: string, versionId: string) {
  const v = await db.subQuoteVersion.findFirst({
    where: { id: versionId, organizationId },
    select: { id: true, version: true, amount: true, extractedJson: true, reviewStatus: true, quote: { select: { id: true, projectId: true, currentVersionId: true, contractor: { select: { name: true } }, project: { select: { name: true, clientId: true } } } } },
  });
  if (!v) throw new Error("Version not found");
  return v;
}

/** "Use these": the read's total becomes the version's price — and the quote's, when this is its current version. */
export async function acceptRead(organizationId: string, versionId: string, actorId: string | null): Promise<{ projectId: string; quoteId: string; amount: number | null }> {
  const v = await versionOf(organizationId, versionId);
  const stored = parseStoredRead(v.extractedJson);
  if (!stored) throw new Error("There is no read to use yet.");
  const total = stored.read.total.value != null && stored.read.total.value >= 0 ? Math.round(stored.read.total.value * 100) / 100 : null;
  const amount = total ?? v.amount;
  const now = new Date();
  await db.subQuoteVersion.update({ where: { id: v.id }, data: { amount, reviewStatus: "REVIEWED", reviewedById: actorId, reviewedAt: now } });
  if (v.quote.currentVersionId === v.id && amount != null) await db.projectSubQuote.update({ where: { id: v.quote.id }, data: { amount } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Used the AI's read of ${v.quote.contractor.name}'s quote V${v.version} on ${v.quote.project.name}${total != null ? `: ${dollars(total)}` : ""}`, clientId: v.quote.project.clientId, meta: { projectId: v.quote.projectId, quoteId: v.quote.id, versionId: v.id } });
  return { projectId: v.quote.projectId, quoteId: v.quote.id, amount };
}

export async function rejectRead(organizationId: string, versionId: string, actorId: string | null): Promise<{ projectId: string }> {
  const v = await versionOf(organizationId, versionId);
  await db.subQuoteVersion.update({ where: { id: v.id }, data: { reviewStatus: "REJECTED", reviewedById: actorId, reviewedAt: new Date() } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Set aside the AI's read of ${v.quote.contractor.name}'s quote V${v.version} on ${v.quote.project.name}`, clientId: v.quote.project.clientId, meta: { projectId: v.quote.projectId, quoteId: v.quote.id, versionId: v.id } });
  return { projectId: v.quote.projectId };
}

/** Read it again, now. */
export async function requeueRead(organizationId: string, versionId: string): Promise<{ projectId: string; outcome: ReadOutcome }> {
  const v = await versionOf(organizationId, versionId);
  await db.subQuoteVersion.update({ where: { id: v.id }, data: { reviewStatus: "PENDING", readAttempts: 0, readError: null } });
  const outcome = await readVersion(v.id);
  return { projectId: v.quote.projectId, outcome };
}

// ── the comparison ───────────────────────────────────────────────────────────

export type CompareRead = {
  request: { id: string; number: number; title: string; stageName: string | null; projectId: string; status: string };
  line: number | null;
  rows: CompareRow[];
  words: StoredCompare | null;
};

/** The stage's share of the project's Subcontractors budget — the line the request's quotes are measured against. */
async function lineOf(projectId: string, stageId: string | null): Promise<number | null> {
  if (!stageId) return null;
  const [stages, lines] = await Promise.all([db.projectStage.findMany({ where: { projectId }, select: { id: true, weight: true } }), db.projectBudgetLine.findMany({ where: { projectId, category: "SUBCONTRACTORS", label: null }, select: { amount: true } })]);
  if (!lines.length) return null;
  const subsBudget = lines.reduce((n, l) => n + Math.max(0, l.amount), 0);
  const totalWeight = stages.reduce((n, s) => n + Math.max(0, s.weight), 0);
  return stageSubsBudget(stages.find((s) => s.id === stageId)?.weight ?? 0, totalWeight, subsBudget);
}

export async function compareRequest(organizationId: string, requestId: string): Promise<CompareRead | null> {
  const r = await db.subRequest.findFirst({
    where: { id: requestId, organizationId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      projectId: true,
      stageId: true,
      compareJson: true,
      stage: { select: { name: true } },
      recipients: { orderBy: { number: "asc" }, select: { id: true, status: true, amount: true, currentVersionId: true, contractor: { select: { name: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, extractedJson: true, reviewStatus: true, document: { select: { name: true } } } } } },
    },
  });
  if (!r) return null;
  const line = await lineOf(r.projectId, r.stageId);
  const rows: CompareIn[] = r.recipients.map((q) => {
    const v = q.versions[0] ?? null;
    return { quoteId: q.id, contractorName: q.contractor.name, status: q.status, amount: q.amount, read: v ? (parseStoredRead(v.extractedJson)?.read ?? null) : null, reviewStatus: v?.reviewStatus ?? "NONE", versionId: v?.id ?? null, version: v?.version ?? null, documentName: v?.document?.name ?? null };
  });
  return { request: { id: r.id, number: r.number, title: r.title, stageName: r.stage?.name ?? null, projectId: r.projectId, status: r.status }, line, rows: compareTable(rows, line), words: parseStoredCompare(r.compareJson) };
}

/** The two sentences on the difference, from the fields alone; the rules' own words when the model is off or fails.
 *  Cached on the request with the versions it compared. */
export async function compareWords(organizationId: string, requestId: string, actorId: string | null): Promise<{ projectId: string; words: StoredCompare }> {
  const c = await compareRequest(organizationId, requestId);
  if (!c) throw new Error("Request not found");
  const priced = c.rows.filter((r) => r.amount != null);
  let words: string | null = null;
  let by: StoredCompare["by"] = "rules";
  if (priced.length >= 2 && isOpenAIEnabled()) {
    try {
      await noteRequestOrg(organizationId);
      const client = getOpenAI();
      const model = await resolveOpenAIModel();
      const res = await client.chat.completions.create({
        model,
        ...(isReasoningModelName(model) ? { reasoning_effort: "low" as const } : await samplingOptions(0)),
        max_completion_tokens: 600,
        response_format: zodResponseFormat(CompareWords, COMPARE_SCHEMA_NAME),
        messages: [
          { role: "system", content: COMPARE_SYSTEM },
          { role: "user", content: `The quotes on request ${c.request.number} (${c.request.title}), as fields:\n${JSON.stringify(compareWordsInput(c.rows, c.line), null, 1)}` },
        ],
      });
      const raw = res.choices[0]?.message?.content;
      const parsed = raw ? CompareWords.safeParse(JSON.parse(raw)) : null;
      if (parsed?.success && parsed.data.words.trim()) {
        words = parsed.data.words.trim().slice(0, 700);
        by = "model";
      }
    } catch (err) {
      console.warn(`[quote-compare] the model's words failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const stored: StoredCompare = { words: words ?? compareFallbackWords(c.rows, c.line), at: new Date().toISOString(), versionIds: c.rows.map((r) => r.versionId).filter((x): x is string => Boolean(x)), by };
  await db.subRequest.update({ where: { id: c.request.id }, data: { compareJson: JSON.stringify(stored), comparedAt: new Date() } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Compared the quotes on RFQ-${c.request.number}${by === "model" ? "" : " (the rules' words)"}`, meta: { projectId: c.request.projectId, requestId: c.request.id } });
  return { projectId: c.request.projectId, words: stored };
}
