"use server";
// CONTRACTORS: QUOTES AND INVOICES — the writes (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"; grown 2026-11-08 by part 1 of the subcontractors plan). Projects are estimators' and managers'
// (actions/projects), so every office write is requireEstimatorOrManager and every row is checked against the
// caller's company; the database work is lib/projectSubs/server, the rules lib/projectSubs/shared, the documents
// lib/subDocs. The sub's own page writes through `quoteSave` and `invoiceSave` with its token alone (no session),
// rate-limited by address: a price with the estimate attached, a note, a pass, later the invoice — nothing else.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { clientIp, rateLimitShared } from "@/lib/rateLimit";
import {
  addContractor,
  addVersionByOffice,
  askQuotes,
  attachContractorDocument,
  awardQuote,
  cancelRequest,
  declineQuote,
  invoiceReply,
  markQuotePaid,
  quoteReply,
  requestRevision,
  resendQuote,
  updateContractor,
  type AskResult,
  type ContractorRow,
  type DocRow,
  type VersionRow,
} from "@/lib/projectSubs/server";
import { recordDocument } from "@/lib/subDocs/server";
import { LICENSE_STATUSES, W9_STATUSES } from "@/lib/projectSubs/shared";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TOKEN = /^[A-Za-z0-9_-]{10,80}$/;
const HOUR = 60 * 60 * 1000;

const fileIn = z.object({ url: z.string().min(1).max(2000), name: z.string().trim().min(1).max(200), contentType: z.string().max(100).nullable(), bytes: z.number().int().min(0).max(1_000_000_000).nullable() });

function touched(projectId: string | null) {
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard/subcontractors");
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath(`/dashboard/projects/${projectId}/subs`);
    revalidatePath(`/mobile-project-detail-v2/${projectId}`);
    revalidatePath(`/mobile-project-subs-v1/${projectId}`);
  }
}

const contractorInput = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).nullable().optional(),
  trade: z.string().trim().max(60).nullable().optional(),
  trades: z.array(z.string().trim().max(60)).max(8).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  license: z.string().trim().max(80).nullable().optional(),
  licenseStatus: z.enum(LICENSE_STATUSES).nullable().optional(),
  insuranceUntil: DAY.nullable().optional().or(z.literal("").transform(() => null)),
  insuranceCarrier: z.string().trim().max(120).nullable().optional(),
  insurancePolicy: z.string().trim().max(80).nullable().optional(),
  bondAmount: z.number().min(0).max(100_000_000).nullable().optional(),
  bondUntil: DAY.nullable().optional().or(z.literal("").transform(() => null)),
  w9Status: z.enum(W9_STATUSES).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  serviceAreas: z.string().trim().max(240).nullable().optional(),
  textsOptOut: z.boolean().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// ── the directory ────────────────────────────────────────────────────────────

export async function addProjectContractor(raw: unknown): Promise<ContractorRow> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = contractorInput.parse(raw);
  const r = await addContractor(organizationId, user.id, d);
  touched(null);
  return r;
}

export async function updateProjectContractor(raw: unknown): Promise<ContractorRow> {
  const { organizationId } = await requireEstimatorOrManager();
  const d = contractorInput.partial().extend({ id: ID }).parse(raw);
  const { id, ...patch } = d;
  const r = await updateContractor(organizationId, id, patch);
  touched(null);
  return r;
}

/** A sub's W-9 or insurance certificate, after the browser put the file in the store (lib/subDocs/client). */
export async function keepContractorDocument(raw: unknown): Promise<DocRow> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z.object({ contractorId: ID, kind: z.enum(["W9", "INSURANCE"]), file: fileIn }).parse(raw);
  const r = await attachContractorDocument(organizationId, d.contractorId, d.kind, d.file, user.id);
  touched(null);
  return r;
}

// ── the request ──────────────────────────────────────────────────────────────

const askInput = z.object({
  projectId: ID,
  stageId: ID.nullable(),
  contractorIds: z.array(ID).min(1).max(12),
  scope: z.string().trim().min(1).max(2000),
  dueBy: DAY.nullable(),
  title: z.string().trim().max(120).nullable().optional(),
  trade: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  materials: z.string().trim().max(2000).nullable().optional(),
  labor: z.string().trim().max(2000).nullable().optional(),
  startsAt: DAY.nullable().optional(),
  endsAt: DAY.nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
  fileIds: z.array(ID).max(20).nullable().optional(),
  documentIds: z.array(ID).max(20).nullable().optional(),
});

/** Send a request for quotes to one or several contractors: each gets an email (and a text where allowed) with
 *  their own link; the drawings uploaded for it ride along. */
export async function askProjectQuotes(raw: unknown): Promise<AskResult> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = askInput.parse(raw);
  const r = await askQuotes(organizationId, user.id, d);
  touched(d.projectId);
  return r;
}

/** A drawing for a request, uploaded before the request is sent: recorded now (kind PLAN, no request yet), tied to
 *  the request when it goes out. */
export async function keepRequestDrawing(raw: unknown): Promise<DocRow> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z.object({ projectId: ID, file: fileIn }).parse(raw);
  const r = await recordDocument({ organizationId, projectId: d.projectId, contractorId: null, requestId: null, kind: "PLAN", name: d.file.name, url: d.file.url, contentType: d.file.contentType, bytes: d.file.bytes, uploadedVia: "OFFICE", uploadedById: user.id });
  return r;
}

export async function cancelProjectRequest(requestId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await cancelRequest(organizationId, ID.parse(requestId), user.id);
  touched(r.projectId);
}

// ── the quotes ───────────────────────────────────────────────────────────────

export async function awardProjectQuote(quoteId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await awardQuote(organizationId, ID.parse(quoteId), user.id);
  touched(r.projectId);
}

export async function declineProjectQuote(quoteId: string, reason: string | null = null): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await declineQuote(organizationId, ID.parse(quoteId), user.id, z.string().max(300).nullable().parse(reason));
  touched(r.projectId);
}

/** Send a quote back for a revised price, with a word on what to change. */
export async function requestQuoteRevision(raw: unknown): Promise<{ email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z.object({ quoteId: ID, note: z.string().trim().max(1000).nullable() }).parse(raw);
  const r = await requestRevision(organizationId, d.quoteId, d.note, user.id);
  touched(r.projectId);
  return { email: r.email, text: r.text };
}

/** The office puts a sub's estimate on the row for them — the file (already in the store) and the price. */
export async function addQuoteVersion(raw: unknown): Promise<VersionRow> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z.object({ quoteId: ID, amount: z.number().min(0).max(100_000_000).nullable(), note: z.string().trim().max(1000).nullable(), file: fileIn.nullable() }).parse(raw);
  const r = await addVersionByOffice(organizationId, d.quoteId, d, user.id);
  touched(r.projectId);
  return r.version;
}

/** The contractor is paid: a Subcontractors expense on the project for the invoice (or the amount typed). */
export async function markProjectQuotePaid(raw: unknown): Promise<{ expenseId: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z.object({ quoteId: ID, amount: z.number().min(0).max(100_000_000).nullable() }).parse(raw);
  const r = await markQuotePaid(organizationId, d.quoteId, d.amount, user.id);
  touched(r.projectId);
  return { expenseId: r.expenseId };
}

export async function resendProjectQuote(quoteId: string): Promise<{ email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId } = await requireEstimatorOrManager();
  const r = await resendQuote(organizationId, ID.parse(quoteId));
  touched(r.projectId);
  return { email: r.email, text: r.text };
}

// ── the contractor's page (no session: the token is the key) ────────────────

async function publicGate(token: string, what: string): Promise<{ ok: false; error: string } | null> {
  if (!TOKEN.test(token)) return { ok: false, error: "This link is not valid." };
  const rl = await rateLimitShared(`sub-${what}:${await clientIp()}`, 30, HOUR);
  if (!rl.ok) return { ok: false, error: "Too many tries at once — wait a few minutes and try again." };
  return null;
}

export async function quoteSave(token: string, raw: unknown): Promise<{ ok: true; version: number | null } | { ok: false; error: string }> {
  const gate = await publicGate(token, "quote");
  if (gate) return gate;
  const d = z
    .object({ amount: z.number().min(0).max(100_000_000).nullable(), note: z.string().trim().max(1000).nullable(), decline: z.boolean(), reason: z.string().trim().max(300).nullable().optional(), file: fileIn.nullable().optional() })
    .safeParse(raw);
  if (!d.success) return { ok: false, error: "Check the price — numbers only." };
  return quoteReply(token, { amount: d.data.amount, note: d.data.note, decline: d.data.decline, reason: d.data.reason ?? null, file: d.data.file ?? null });
}

export async function invoiceSave(token: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await publicGate(token, "invoice");
  if (gate) return gate;
  const d = z.object({ amount: z.number().min(0).max(100_000_000), url: z.string().trim().url().max(500).nullable().or(z.literal("").transform(() => null)) }).safeParse(raw);
  if (!d.success) return { ok: false, error: "Check the amount — numbers only — and the link." };
  if (d.data.url && !/^https?:\/\//i.test(d.data.url)) return { ok: false, error: "The link needs to start with https://" };
  return invoiceReply(token, d.data);
}
