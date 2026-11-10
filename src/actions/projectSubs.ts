"use server";
// CONTRACTORS: QUOTES AND INVOICES — the writes (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"; grown 2026-11-08 by part 1 of the subcontractors plan). Projects are estimators' and managers'
// (actions/projects), so every office write is requireEstimatorOrManager and every row is checked against the
// caller's company; the database work is lib/projectSubs/server, the rules lib/projectSubs/shared, the documents
// lib/subDocs. The sub's own page writes through `quoteSave` and `invoiceSave` with its token alone (no session),
// rate-limited by address: a price with the estimate attached, a note, a pass, later the invoice — nothing else.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager, requireManager } from "@/lib/orgContext";
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
// Part 2 (2026-11-08): the AI's read of an estimate and its review, the comparison's words, the mail to match.
import { acceptRead, compareWords, rejectRead, requeueRead } from "@/lib/subQuotes/server";
import { attachInbound, ignoreInbound } from "@/lib/subInbound/server";
// Part 3 (2026-11-08): Find — the state register, Google Places and the JobFlex Network.
import { findSubs, saveFound, saveNetworkSettings, verifyContractor, type FindRead } from "@/lib/subFinder/server";
import type { FinderResult, NetworkSettings } from "@/lib/subFinder/shared";
// Part 4 (2026-11-08): subcontracts — the draft, the send, the signature, the change orders.
import { buildContractPdf, cancelContract, decideChangeByToken, decideChangeInOffice, draftContract, proposeChange, resendContract, sendContract, signContract, updateContract, type ChangeRow, type ContractRow } from "@/lib/subContracts/server";
import { changeDecisionInput, signInput } from "@/lib/subContracts/shared";
// Part 5a (2026-11-09): invoices and payments.
import { after } from "next/server";
import { acceptInvoiceRead, approveInvoice, attachWaiver, createInvoice, disputeInvoice, editInvoice, invoiceFromContractPage, readInvoiceAgain, recordPayment, rejectInvoiceRead, releaseRetainage, runPendingInvoiceReads, sendInvoiceToRamp, voidInvoice, voidPayment, waiverFromContractPage, type InvoiceRow, type PaymentRow } from "@/lib/subInvoices/server";
import { MANUAL_METHODS, WAIVER_KINDS, subInvoiceInput, type PayMethod } from "@/lib/subInvoices/shared";
import { requireFeatureOrThrow } from "@/lib/entitlements";
import { getOrgPlanById } from "@/lib/orgPlan";
import { withFeature } from "@/lib/customPageAccess";
import { publicLinkRefusal } from "@/lib/publicLinks";

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
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = contractorInput.parse(raw);
  const r = await addContractor(organizationId, user.id, d);
  touched(null);
  return r;
}

export async function updateProjectContractor(raw: unknown): Promise<ContractorRow> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = contractorInput.partial().extend({ id: ID }).parse(raw);
  const { id, ...patch } = d;
  const r = await updateContractor(organizationId, id, patch);
  touched(null);
  return r;
}

/** A sub's W-9 or insurance certificate, after the browser put the file in the store (lib/subDocs/client). */
export async function keepContractorDocument(raw: unknown): Promise<DocRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
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
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = askInput.parse(raw);
  const r = await askQuotes(organizationId, user.id, d);
  touched(d.projectId);
  return r;
}

/** A drawing for a request, uploaded before the request is sent: recorded now (kind PLAN, no request yet), tied to
 *  the request when it goes out. */
export async function keepRequestDrawing(raw: unknown): Promise<DocRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ projectId: ID, file: fileIn }).parse(raw);
  const r = await recordDocument({ organizationId, projectId: d.projectId, contractorId: null, requestId: null, kind: "PLAN", name: d.file.name, url: d.file.url, contentType: d.file.contentType, bytes: d.file.bytes, uploadedVia: "OFFICE", uploadedById: user.id });
  return r;
}

export async function cancelProjectRequest(requestId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await cancelRequest(organizationId, ID.parse(requestId), user.id);
  touched(r.projectId);
}

// ── the quotes ───────────────────────────────────────────────────────────────

export async function awardProjectQuote(quoteId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await awardQuote(organizationId, ID.parse(quoteId), user.id);
  touched(r.projectId);
}

export async function declineProjectQuote(quoteId: string, reason: string | null = null): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await declineQuote(organizationId, ID.parse(quoteId), user.id, z.string().max(300).nullable().parse(reason));
  touched(r.projectId);
}

/** Send a quote back for a revised price, with a word on what to change. */
export async function requestQuoteRevision(raw: unknown): Promise<{ email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ quoteId: ID, note: z.string().trim().max(1000).nullable() }).parse(raw);
  const r = await requestRevision(organizationId, d.quoteId, d.note, user.id);
  touched(r.projectId);
  return { email: r.email, text: r.text };
}

/** The office puts a sub's estimate on the row for them — the file (already in the store) and the price. */
export async function addQuoteVersion(raw: unknown): Promise<VersionRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ quoteId: ID, amount: z.number().min(0).max(100_000_000).nullable(), note: z.string().trim().max(1000).nullable(), file: fileIn.nullable() }).parse(raw);
  const r = await addVersionByOffice(organizationId, d.quoteId, d, user.id);
  touched(r.projectId);
  return r.version;
}

/** The contractor is paid: a Subcontractors expense on the project for the invoice (or the amount typed). */
export async function markProjectQuotePaid(raw: unknown): Promise<{ expenseId: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ quoteId: ID, amount: z.number().min(0).max(100_000_000).nullable() }).parse(raw);
  const r = await markQuotePaid(organizationId, d.quoteId, d.amount, user.id);
  touched(r.projectId);
  return { expenseId: r.expenseId };
}

export async function resendProjectQuote(quoteId: string): Promise<{ email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await resendQuote(organizationId, ID.parse(quoteId));
  touched(r.projectId);
  return { email: r.email, text: r.text };
}

// ── the contractor's page (no session: the token is the key) ────────────────

async function publicGate(token: string, what: string): Promise<{ ok: false; error: string } | null> {
  if (!TOKEN.test(token)) return { ok: false, error: "This link is not valid." };
  // A sub's quote or subcontract link is paused while the company is on the Free plan (lib/publicLinks).
  const paused = (await publicLinkRefusal("sub-quote", token)) ?? (await publicLinkRefusal("subcontract", token));
  if (paused) return paused;
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

// ── part 2: the read, the comparison, the mail to match ──────────────────────

/** Read a version's document again, now — a version whose read failed, or one the office doubts. */
export async function readQuoteVersionNow(versionId: string): Promise<{ ok: boolean; status: string; error: string | null }> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await requeueRead(organizationId, ID.parse(versionId));
  touched(r.projectId);
  return { ok: r.outcome.ok, status: r.outcome.status, error: r.outcome.error };
}

/** "Use these": the read's total becomes the version's price (and the quote's, when it is the current version). */
export async function acceptQuoteRead(versionId: string): Promise<{ amount: number | null }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await acceptRead(organizationId, ID.parse(versionId), user.id);
  touched(r.projectId);
  return { amount: r.amount };
}

/** The person says the read is wrong: set aside, the figures stay stored. */
export async function rejectQuoteRead(versionId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await rejectRead(organizationId, ID.parse(versionId), user.id);
  touched(r.projectId);
}

/** The two sentences on how a request's quotes differ, written now and kept on the request. */
export async function compareRequestWords(requestId: string): Promise<{ words: string; by: "model" | "rules"; at: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await compareWords(organizationId, ID.parse(requestId), user.id);
  touched(r.projectId);
  return { words: r.words.words, by: r.words.by, at: r.words.at };
}

/** A held letter matched to a quote by hand: its document becomes a version. */
export async function attachInboundEmail(raw: unknown): Promise<{ versionId: string | null }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ inboundId: ID, quoteId: ID }).parse(raw);
  const r = await attachInbound(organizationId, d.inboundId, d.quoteId, user.id);
  touched(r.projectId);
  return { versionId: r.versionId };
}

/** A held letter set aside. */
export async function ignoreInboundEmail(inboundId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  await ignoreInbound(organizationId, ID.parse(inboundId), user.id);
  touched(null);
}

// ── part 3: Find ─────────────────────────────────────────────────────────────

const finderLicense = z.object({ number: z.string().min(1).max(40), status: z.string().max(40).nullable(), kind: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED", "UNKNOWN"]), expires: z.string().max(10).nullable(), specialties: z.array(z.string().max(80)).max(4), principal: z.string().max(120).nullable(), ubi: z.string().max(20).nullable(), insurance: z.object({ license: z.string().max(40), carrier: z.string().max(120).nullable(), policy: z.string().max(60).nullable(), amount: z.number().nullable(), effective: z.string().max(10).nullable(), expires: z.string().max(10).nullable(), cancelled: z.string().max(10).nullable() }).nullable(), bond: z.object({ license: z.string().max(40), firm: z.string().max(120).nullable(), amount: z.number().nullable(), effective: z.string().max(10).nullable(), expires: z.string().max(10).nullable(), impaired: z.boolean() }).nullable() });
const finderResult = z.object({
  key: z.string().max(120),
  sources: z.array(z.enum(["register", "places", "network"])).max(3),
  name: z.string().trim().min(1).max(160),
  address: z.string().max(300).nullable(),
  city: z.string().max(80).nullable(),
  phone: z.string().max(40).nullable(),
  website: z.string().max(300).nullable(),
  email: z.string().max(200).nullable(),
  placeId: z.string().max(200).nullable(),
  rating: z.number().nullable(),
  ratingCount: z.number().nullable(),
  distanceMi: z.number().nullable(),
  license: finderLicense.nullable(),
  network: z.object({ organizationId: z.string().max(64), contact: z.object({ name: z.string().max(120).nullable(), phone: z.string().max(40).nullable(), email: z.string().max(200).nullable() }), trades: z.array(z.string().max(60)).max(20), serviceAreas: z.string().max(300).nullable() }).nullable(),
  savedId: z.string().max(64).nullable(),
});

/** One search near a project (or from the company page): sixty an hour per company. */
export async function findProjectSubs(raw: unknown): Promise<FindRead> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ projectId: ID.nullable(), trade: z.string().trim().max(60).nullable(), address: z.string().trim().max(300).nullable(), radiusMi: z.number().min(1).max(100), words: z.string().trim().max(80).nullable(), includeLapsed: z.boolean().optional() }).parse(raw);
  const gate = await rateLimitShared(`sub-find:${organizationId}`, 60, HOUR);
  if (!gate.ok) throw new Error("That is a lot of searches — try again in a few minutes.");
  return findSubs(organizationId, d.projectId, d);
}

/** A found result saved to My subs (the same place, license or name is not saved twice). */
export async function saveFoundSub(raw: unknown): Promise<{ row: ContractorRow; existed: boolean }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ result: finderResult, trade: z.string().trim().max(60).nullable() }).parse(raw);
  const r = await saveFound(organizationId, user.id, d.result as FinderResult, d.trade);
  touched(null);
  return r;
}

/** The state register's word on a saved sub, now. */
export async function verifyContractorLicenseNow(contractorId: string): Promise<{ row: ContractorRow; words: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await verifyContractor(organizationId, ID.parse(contractorId), user.id);
  touched(null);
  return r;
}

/** The company's JobFlex Network listing (owners and managers). */
export async function saveCompanyNetwork(raw: unknown): Promise<NetworkSettings> {
  const { organizationId, user } = await withFeature(requireManager(), "subcontractors");
  const d = z.object({ on: z.boolean(), trades: z.array(z.string().trim().min(1).max(60)).max(20), serviceAreas: z.string().trim().max(300), contact: z.object({ name: z.string().trim().max(120), phone: z.string().trim().max(40), email: z.string().trim().max(200) }), since: z.string().nullable().optional() }).parse(raw);
  const r = await saveNetworkSettings(organizationId, user.id, { ...d, since: d.since ?? null });
  touched(null);
  return r;
}

// ── part 4: subcontracts ─────────────────────────────────────────────────────
// The office drafts a contract from an awarded quote, edits it while a draft, signs for the company and sends it;
// the sub signs on /s/<token> (contractSign below, no session, rate-limited by address). Change orders on a signed
// contract are proposed here and answered by the sub on the same page (contractChangeAnswer) or approved in person.

const milestoneIn = z.object({ name: z.string().trim().min(1).max(80), pct: z.number().min(0.1).max(100), due: DAY.nullable() });
const contractPatch = z.object({
  contractId: ID,
  title: z.string().trim().min(1).max(160).optional(),
  amount: z.number().min(0.01).max(100_000_000).optional(),
  scope: z.string().trim().min(1).max(8000).optional(),
  startsAt: DAY.nullable().optional(),
  endsAt: DAY.nullable().optional(),
  depositPct: z.number().min(0).max(100).nullable().optional(),
  retainagePct: z.number().min(0).max(50).nullable().optional(),
  milestones: z.array(milestoneIn).min(1).max(8).optional(),
  terms: z.string().trim().min(1).max(20000).optional(),
  attachmentIds: z.array(ID).max(30).optional(),
});

export async function draftSubcontract(quoteId: string): Promise<ContractRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const row = await draftContract(organizationId, ID.parse(quoteId), user.id);
  touched(row.projectId);
  return row;
}

export async function saveSubcontract(raw: unknown): Promise<ContractRow> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const { contractId, ...patch } = contractPatch.parse(raw);
  const row = await updateContract(organizationId, contractId, patch);
  touched(row.projectId);
  return row;
}

export async function sendSubcontract(raw: unknown): Promise<{ row: ContractRow; email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ contractId: ID, signerName: z.string().trim().min(2).max(120) }).parse(raw);
  const r = await sendContract(organizationId, d.contractId, { id: user.id }, d.signerName);
  touched(r.row.projectId);
  return r;
}

export async function resendSubcontract(contractId: string): Promise<{ email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  return resendContract(organizationId, ID.parse(contractId));
}

export async function cancelSubcontract(raw: unknown): Promise<ContractRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ contractId: ID, reason: z.string().trim().max(300).nullable() }).parse(raw);
  const row = await cancelContract(organizationId, d.contractId, d.reason, user.id);
  touched(row.projectId);
  return row;
}

/** The signed PDF made again (a failed first try, a lost file). */
export async function rebuildSubcontractPdf(contractId: string): Promise<DocRow> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const doc = await buildContractPdf(organizationId, ID.parse(contractId));
  touched(doc.projectId);
  return doc;
}

export async function proposeSubcontractChange(raw: unknown): Promise<{ change: ChangeRow; email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed" }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ contractId: ID, amount: z.number().min(-100_000_000).max(100_000_000), scope: z.string().trim().min(1).max(4000), reason: z.string().trim().max(1000).nullable() }).parse(raw);
  const r = await proposeChange(organizationId, d.contractId, { amount: d.amount, scope: d.scope, reason: d.reason }, user.id);
  touched(null);
  return r;
}

export async function decideSubcontractChange(raw: unknown): Promise<ChangeRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ changeId: ID, approve: z.boolean(), name: z.string().trim().max(120).nullable(), reason: z.string().trim().max(500).nullable() }).parse(raw);
  const row = await decideChangeInOffice(organizationId, d.changeId, { approve: d.approve, name: d.name, reason: d.reason }, user.id);
  touched(null);
  return row;
}

async function userAgent(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("user-agent");
  } catch {
    return null;
  }
}

/** The sub signs on /s/<token>: a typed name and the consent box; the address and the browser are kept. */
export async function contractSign(token: string, raw: unknown): Promise<{ ok: true; already: boolean; signedAt: string; pdfHref: string | null } | { ok: false; error: string }> {
  const gate = await publicGate(token, "sign");
  if (gate) return gate;
  const d = signInput.safeParse(raw);
  if (!d.success) return { ok: false, error: d.error.issues[0]?.message ?? "Type your full name and tick the box." };
  return signContract(token, { name: d.data.name, ip: await clientIp(), userAgent: await userAgent() });
}

/** The sub agrees to (a typed name) or declines a change order on the same page. */
export async function contractChangeAnswer(token: string, raw: unknown): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const gate = await publicGate(token, "change");
  if (gate) return gate;
  const d = changeDecisionInput.safeParse(raw);
  if (!d.success) return { ok: false, error: d.error.issues[0]?.message ?? "Type your full name to agree." };
  return decideChangeByToken(token, { changeId: d.data.changeId, agree: d.data.agree, name: d.data.agree ? d.data.name : null, reason: d.data.agree ? null : (d.data.reason ?? null), ip: await clientIp(), userAgent: await userAgent() });
}

// ── part 5a: invoices and payments ───────────────────────────────────────────
// Invoices are reviewed by estimators and managers (like quotes); money moves only by an owner or manager (the plan's
// rule for paying). The sub's contract page sends an invoice and a lien waiver with its token alone, rate-limited.

const PAYDAY = DAY;
const invoicePatch = z.object({
  invoiceId: ID,
  amount: z.number().min(0).max(100_000_000).nullable().optional(),
  invoiceNumber: z.string().trim().max(60).nullable().optional(),
  milestone: z.number().int().min(0).max(20).nullable().optional(),
  issuedAt: DAY.nullable().optional(),
  dueAt: DAY.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export async function enterSubInvoice(raw: unknown): Promise<InvoiceRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ quoteId: ID, amount: z.number().min(0).max(100_000_000).nullable(), invoiceNumber: z.string().trim().max(60).nullable(), milestone: z.number().int().min(0).max(20).nullable(), issuedAt: DAY.nullable(), dueAt: DAY.nullable(), note: z.string().trim().max(1000).nullable(), file: fileIn.nullable() }).parse(raw);
  const row = await createInvoice({ organizationId, quoteId: d.quoteId, amount: d.amount, invoiceNumber: d.invoiceNumber, milestone: d.milestone, issuedAt: d.issuedAt, dueAt: d.dueAt, note: d.note, source: "OFFICE", file: d.file, actorId: user.id });
  if (d.file) after(() => runPendingInvoiceReads(2).then(() => undefined));
  touched(row.projectId);
  return row;
}

export async function editSubInvoice(raw: unknown): Promise<InvoiceRow> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const { invoiceId, ...patch } = invoicePatch.parse(raw);
  const row = await editInvoice(organizationId, invoiceId, patch);
  touched(row.projectId);
  return row;
}

export async function approveSubInvoice(invoiceId: string): Promise<InvoiceRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const row = await approveInvoice(organizationId, ID.parse(invoiceId), user.id);
  touched(row.projectId);
  return row;
}

export async function disputeSubInvoice(raw: unknown): Promise<InvoiceRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ invoiceId: ID, reason: z.string().trim().min(1).max(500) }).parse(raw);
  const row = await disputeInvoice(organizationId, d.invoiceId, d.reason, user.id);
  touched(row.projectId);
  return row;
}

export async function voidSubInvoice(raw: unknown): Promise<InvoiceRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ invoiceId: ID, reason: z.string().trim().max(300).nullable() }).parse(raw);
  const row = await voidInvoice(organizationId, d.invoiceId, d.reason, user.id);
  touched(row.projectId);
  return row;
}

export async function adoptSubInvoiceRead(invoiceId: string): Promise<InvoiceRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const row = await acceptInvoiceRead(organizationId, ID.parse(invoiceId), user.id);
  touched(row.projectId);
  return row;
}

export async function setAsideSubInvoiceRead(invoiceId: string): Promise<void> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  await rejectInvoiceRead(organizationId, ID.parse(invoiceId));
  touched(null);
}

export async function readSubInvoiceNow(invoiceId: string): Promise<{ ok: boolean; status: string; error: string | null }> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const r = await readInvoiceAgain(organizationId, ID.parse(invoiceId));
  touched(null);
  return r;
}

/** Money moves only on a plan that has Subcontractor payments (lib/entitlements — on every plan today). */
async function paymentsAllowed(organizationId: string): Promise<void> {
  requireFeatureOrThrow(await getOrgPlanById(organizationId), "sub_payments");
}

export async function recordSubPayment(raw: unknown): Promise<{ payment: PaymentRow; duplicate: boolean; email: "sent" | "none" | "failed" }> {
  const { organizationId, user } = await withFeature(requireManager(), "subcontractors");
  await paymentsAllowed(organizationId);
  const d = z
    .object({ invoiceId: ID, amount: z.number().min(0).max(100_000_000), held: z.number().min(0).max(100_000_000), method: z.enum(MANUAL_METHODS as unknown as [PayMethod, ...PayMethod[]]), reference: z.string().trim().max(60).nullable(), paidAt: PAYDAY, waiverKind: z.enum(WAIVER_KINDS).nullable(), waiverFile: fileIn.nullable(), note: z.string().trim().max(500).nullable(), key: z.string().min(8).max(80) })
    .parse(raw);
  const r = await recordPayment(organizationId, { invoiceId: d.invoiceId, amount: d.amount, held: d.held, release: false, method: d.method, reference: d.reference, paidAt: d.paidAt, waiverKind: d.waiverKind, waiverFile: d.waiverFile, note: d.note, key: `office:${organizationId}:${d.key}` }, user.id);
  touched(null);
  return r;
}

export async function voidSubPayment(raw: unknown): Promise<PaymentRow> {
  const { organizationId, user } = await withFeature(requireManager(), "subcontractors");
  const d = z.object({ paymentId: ID, reason: z.string().trim().max(300).nullable() }).parse(raw);
  const row = await voidPayment(organizationId, d.paymentId, d.reason, user.id);
  touched(null);
  return row;
}

export async function keepSubWaiver(raw: unknown): Promise<PaymentRow> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "subcontractors");
  const d = z.object({ paymentId: ID, kind: z.enum(WAIVER_KINDS), file: fileIn }).parse(raw);
  const row = await attachWaiver(organizationId, d.paymentId, d.kind, d.file, user.id);
  touched(null);
  return row;
}

export async function releaseSubRetainage(raw: unknown): Promise<{ payment: PaymentRow; duplicate: boolean }> {
  const { organizationId, user } = await withFeature(requireManager(), "subcontractors");
  await paymentsAllowed(organizationId);
  const d = z.object({ contractId: ID, amount: z.number().min(0.01).max(100_000_000).nullable(), method: z.enum(MANUAL_METHODS as unknown as [PayMethod, ...PayMethod[]]), reference: z.string().trim().max(60).nullable(), paidAt: PAYDAY, key: z.string().min(8).max(80) }).parse(raw);
  const r = await releaseRetainage(organizationId, d.contractId, { amount: d.amount, method: d.method, reference: d.reference, paidAt: d.paidAt, key: `office:${organizationId}:${d.key}` }, user.id);
  touched(null);
  return { payment: r.payment, duplicate: r.duplicate };
}

export async function sendSubInvoiceToRamp(invoiceId: string): Promise<{ ok: true; warning: string | null } | { ok: false; error: string }> {
  const { organizationId, user } = await withFeature(requireManager(), "subcontractors");
  await paymentsAllowed(organizationId);
  const r = await sendInvoiceToRamp(organizationId, ID.parse(invoiceId), { userId: user.id, name: user.name?.trim() || user.email || "JobFlex" });
  touched(null);
  return r;
}

/** The sub sends an invoice from their signed contract's page. */
export async function contractInvoiceSave(token: string, raw: unknown): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
  const gate = await publicGate(token, "invoice");
  if (gate) return gate;
  const d = subInvoiceInput.safeParse(raw);
  if (!d.success) return { ok: false, error: d.error.issues[0]?.message ?? "Check the amount — numbers only." };
  const r = await invoiceFromContractPage(token, d.data);
  if (r.ok && d.data.file) after(() => runPendingInvoiceReads(2).then(() => undefined));
  return r;
}

/** The sub sends the lien waiver for a payment from the same page. */
export async function contractWaiverSave(token: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await publicGate(token, "waiver");
  if (gate) return gate;
  const d = z.object({ paymentId: ID, kind: z.enum(WAIVER_KINDS), file: fileIn }).safeParse(raw);
  if (!d.success) return { ok: false, error: "Attach the signed waiver — a PDF or a picture." };
  return waiverFromContractPage(token, d.data.paymentId, d.data.kind, d.data.file);
}
