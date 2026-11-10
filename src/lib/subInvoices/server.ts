import "server-only";
// SUB INVOICES AND PAYMENTS — the database half (2026-11-09, the subcontractors plan, part 5a). An invoice lands from
// the sub's contract page (/s/<token>), from the old quote page's invoice box, by email (lib/subInbound), or from the
// office; its document is kept (kind INVOICE), read by the model in the background, and checked by the rules (./shared)
// — the flags are written when it lands and again after the read. The office confirms the read, approves, disputes
// (the sub is told why) or voids it; a payment is RECORDED against an approved invoice (or releases the retainage held
// on a contract), writes the project's Subcontractors expense on the stage's phase, and the sub is told; a lien waiver
// rides on the payment, from the office or from the sub's page. Ramp: an approved invoice can go to Ramp's Bill Pay
// as a bill (lib/ramp/bills); when Ramp pays it, the payment is recorded here instead of a job expense.

import { zodResponseFormat } from "openai/helpers/zod";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { localDayKey } from "@/lib/jobProgressShared";
import { readStoredAsDataUrl } from "@/lib/media/privateStore";
import { getOpenAI, getVisionModel, isOpenAIEnabled, isReasoningModelName, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { noteRequestOrg } from "@/lib/trialMeter";
import { isoDay } from "@/lib/projectTimeline/shared";
import { stageSubsBudget } from "@/lib/projectSubs/shared";
import { tellOffice } from "@/lib/projectSubs/server";
import { DOC_SELECT, docRow, recordDocument, type DocRow } from "@/lib/subDocs/server";
import { committedOf, isoDayOf, paidOf } from "@/lib/subQuotes/shared";
import { documentParts } from "@/lib/subQuotes/server";
import { contractNo, contractTotal, milestoneAmounts, parseMilestones } from "@/lib/subContracts/shared";
import {
  BILLED,
  INVOICE_FIRST_NUMBER,
  INVOICE_READ_SCHEMA_NAME,
  INVOICE_READ_SYSTEM,
  InvoiceRead,
  cashOf,
  contractMoney,
  heldOf,
  invoiceChecks,
  invoiceInLine,
  invoiceNo,
  invoiceReadChecks,
  parseFlags,
  parseStoredInvoiceRead,
  paymentCheck,
  paymentSuggestion,
  paymentWords,
  settledOf,
  usd,
  waiverKindOf,
  type InvoiceFlag,
  type PayMethod,
  type PaymentLike,
  type StoredInvoiceRead,
  type SubInvoiceInput,
  type WaiverKind,
} from "./shared";

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const TOKEN = /^[A-Za-z0-9_-]{10,80}$/;
const MAX_ATTEMPTS = 2;
const ORG_SELECT = { id: true, name: true, phone: true, timezone: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, deletedAt: true } as const;

export type FileIn = { url: string; name: string; contentType: string | null; bytes: number | null };

// ── rows ─────────────────────────────────────────────────────────────────────

const PAYMENT_SELECT = { id: true, invoiceId: true, quoteId: true, contractId: true, amount: true, retainageHeld: true, retainageRelease: true, method: true, reference: true, paidAt: true, status: true, waiverKind: true, rampBillId: true, voidReason: true, note: true, waiverDocument: { select: DOC_SELECT }, invoice: { select: { number: true } }, contractor: { select: { name: true } } } as const;

const INVOICE_SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  contractorId: true,
  quoteId: true,
  contractId: true,
  number: true,
  invoiceNumber: true,
  amount: true,
  milestone: true,
  milestoneName: true,
  issuedAt: true,
  dueAt: true,
  receivedAt: true,
  source: true,
  note: true,
  extractedJson: true,
  reviewStatus: true,
  readError: true,
  flagsJson: true,
  duplicateOfId: true,
  status: true,
  approvedAt: true,
  disputedAt: true,
  disputeReason: true,
  voidedAt: true,
  voidReason: true,
  rampBillId: true,
  document: { select: DOC_SELECT },
  contractor: { select: { name: true, email: true } },
  quote: { select: { stage: { select: { name: true } } } },
  contract: { select: { number: true, retainagePct: true } },
  payments: { select: PAYMENT_SELECT, orderBy: { paidAt: "asc" as const } },
} as const;

type PaymentDb = Awaited<ReturnType<typeof db.subPayment.findMany<{ select: typeof PAYMENT_SELECT }>>>[number];
type InvoiceDb = Awaited<ReturnType<typeof db.subInvoice.findMany<{ select: typeof INVOICE_SELECT }>>>[number];

export type PaymentRow = {
  id: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  quoteId: string;
  contractId: string | null;
  contractorName: string;
  amount: number;
  retainageHeld: number;
  retainageRelease: boolean;
  method: string;
  reference: string | null;
  paidAt: string;
  status: string;
  waiver: DocRow | null;
  waiverKind: WaiverKind | null;
  rampBillId: string | null;
  note: string | null;
  voidReason: string | null;
  words: string;
};

export type InvoiceRow = {
  id: string;
  number: number;
  invoiceNumber: string | null;
  amount: number | null;
  milestone: number | null;
  milestoneName: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  receivedAt: string;
  source: string;
  note: string | null;
  status: string;
  reviewStatus: string;
  read: StoredInvoiceRead | null;
  readError: string | null;
  flags: InvoiceFlag[];
  approvedAt: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  rampBillId: string | null;
  document: DocRow | null;
  quoteId: string;
  contractId: string | null;
  contractNumber: number | null;
  retainagePct: number | null;
  contractorId: string;
  contractorName: string;
  stageName: string | null;
  projectId: string;
  paid: number;
  held: number;
  settled: number;
  /** What is left to pay on it (its amount less what was paid and held). */
  left: number | null;
  /** The payment form's start: what is left, the contract's retainage kept from it. */
  suggest: { amount: number; held: number } | null;
  payments: PaymentRow[];
};

const paymentLikeOf = (p: { amount: number; retainageHeld: number; retainageRelease: boolean; status: string; invoiceId: string | null }): PaymentLike => p;

function paymentRow(p: PaymentDb): PaymentRow {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    invoiceNo: p.invoice ? invoiceNo(p.invoice.number) : null,
    quoteId: p.quoteId,
    contractId: p.contractId,
    contractorName: p.contractor.name,
    amount: p.amount,
    retainageHeld: p.retainageHeld,
    retainageRelease: p.retainageRelease,
    method: p.method,
    reference: p.reference,
    paidAt: p.paidAt.toISOString(),
    status: p.status,
    waiver: p.waiverDocument ? docRow(p.waiverDocument) : null,
    waiverKind: waiverKindOf(p.waiverKind),
    rampBillId: p.rampBillId,
    note: p.note,
    voidReason: p.voidReason,
    words: paymentWords({ amount: p.amount, retainageHeld: p.retainageHeld, retainageRelease: p.retainageRelease, method: p.method, reference: p.reference, paidAt: p.paidAt.toISOString(), status: p.status }),
  };
}

function invoiceRow(i: InvoiceDb): InvoiceRow {
  const ps = i.payments.map(paymentLikeOf);
  const s = settledOf(i.id, ps);
  const left = i.amount != null ? r2(Math.max(0, i.amount - s.settled)) : null;
  return {
    id: i.id,
    number: i.number,
    invoiceNumber: i.invoiceNumber,
    amount: i.amount,
    milestone: i.milestone,
    milestoneName: i.milestoneName,
    issuedAt: isoDay(i.issuedAt),
    dueAt: isoDay(i.dueAt),
    receivedAt: i.receivedAt.toISOString(),
    source: i.source,
    note: i.note,
    status: i.status,
    reviewStatus: i.reviewStatus,
    read: parseStoredInvoiceRead(i.extractedJson),
    readError: i.readError,
    flags: parseFlags(i.flagsJson),
    approvedAt: iso(i.approvedAt),
    disputedAt: iso(i.disputedAt),
    disputeReason: i.disputeReason,
    voidedAt: iso(i.voidedAt),
    voidReason: i.voidReason,
    rampBillId: i.rampBillId,
    document: i.document ? docRow(i.document) : null,
    quoteId: i.quoteId,
    contractId: i.contractId,
    contractNumber: i.contract?.number ?? null,
    retainagePct: i.contract?.retainagePct ?? null,
    contractorId: i.contractorId,
    contractorName: i.contractor.name,
    stageName: i.quote.stage?.name ?? null,
    projectId: i.projectId,
    paid: s.paid,
    held: s.held,
    settled: s.settled,
    left,
    suggest: i.amount != null && i.status === "APPROVED" ? (({ amount, held }) => ({ amount, held }))(paymentSuggestion({ invoiceAmount: i.amount, settledSoFar: s.settled, retainagePct: i.contract?.retainagePct ?? null })) : null,
    payments: i.payments.map(paymentRow),
  };
}

export type ContractMoneyRow = { id: string; number: number; contractorName: string; stageName: string | null; retainagePct: number | null; money: ReturnType<typeof contractMoney>; quoteId: string };

export type InvoicesRead = { invoices: InvoiceRow[]; payments: PaymentRow[]; contracts: ContractMoneyRow[]; totals: { billed: number; approved: number; paid: number; held: number; owed: number; toReview: number; waiversMissing: number } };

/** A project's invoices (newest first), its payments, and each executed contract's money. */
export async function invoicesOf(organizationId: string, projectId: string): Promise<InvoicesRead> {
  const [rows, payments, contracts] = await Promise.all([
    db.subInvoice.findMany({ where: { organizationId, projectId }, orderBy: { number: "desc" }, select: INVOICE_SELECT }),
    db.subPayment.findMany({ where: { organizationId, projectId }, orderBy: { paidAt: "desc" }, select: PAYMENT_SELECT }),
    db.subcontract.findMany({ where: { organizationId, projectId, status: "EXECUTED" }, orderBy: { number: "asc" }, select: { id: true, number: true, amount: true, retainagePct: true, quoteId: true, contractor: { select: { name: true } }, stage: { select: { name: true } }, changeOrders: { select: { status: true, amount: true } } } }),
  ]);
  const invoices = rows.map(invoiceRow);
  const ps = payments.map(paymentLikeOf);
  const contractRows: ContractMoneyRow[] = contracts.map((c) => ({
    id: c.id,
    number: c.number,
    contractorName: c.contractor.name,
    stageName: c.stage?.name ?? null,
    retainagePct: c.retainagePct,
    quoteId: c.quoteId,
    money: contractMoney(
      contractTotal(c.amount, c.changeOrders),
      invoices.filter((x) => x.contractId === c.id).map((x) => ({ id: x.id, amount: x.amount, status: x.status })),
      payments.filter((p) => p.contractId === c.id).map(paymentLikeOf),
    ),
  }));
  const counted = invoices.filter((x) => (BILLED as readonly string[]).includes(x.status));
  return {
    invoices,
    payments: payments.map(paymentRow),
    contracts: contractRows,
    totals: {
      billed: r2(counted.reduce((n, x) => n + (x.amount ?? 0), 0)),
      approved: r2(counted.filter((x) => x.status !== "RECEIVED").reduce((n, x) => n + (x.amount ?? 0), 0)),
      paid: cashOf(ps),
      held: heldOf(ps),
      owed: r2(counted.filter((x) => x.status === "APPROVED").reduce((n, x) => n + (x.left ?? 0), 0)),
      toReview: invoices.filter((x) => x.status === "RECEIVED").length,
      waiversMissing: payments.filter((p) => p.status === "RECORDED" && p.amount > 0 && !p.waiverDocument).length,
    },
  };
}

async function invoiceDb(organizationId: string, id: string): Promise<InvoiceDb> {
  const r = await db.subInvoice.findFirst({ where: { id, organizationId }, select: INVOICE_SELECT });
  if (!r) throw new Error("Invoice not found");
  return r;
}

export async function invoiceById(organizationId: string, id: string): Promise<InvoiceRow> {
  return invoiceRow(await invoiceDb(organizationId, id));
}

// ── the checks ───────────────────────────────────────────────────────────────

/** The stage's share of the Subcontractors budget and what its other quotes have committed or been paid. */
async function stageContext(projectId: string, stageId: string | null, quoteId: string): Promise<{ name: string; line: number | null; usedElsewhere: number } | null> {
  if (!stageId) return null;
  const [stages, lines, quotes] = await Promise.all([
    db.projectStage.findMany({ where: { projectId }, select: { id: true, name: true, weight: true } }),
    db.projectBudgetLine.findMany({ where: { projectId, category: "SUBCONTRACTORS", label: null }, select: { amount: true } }),
    db.projectSubQuote.findMany({ where: { projectId, stageId, id: { not: quoteId } }, select: { status: true, amount: true, invoiceAmount: true, stageId: true, contracts: { where: { status: "EXECUTED" }, select: { amount: true, changeOrders: { where: { status: "APPROVED" }, select: { amount: true } } } }, payments: { where: { status: "RECORDED" }, select: { amount: true } } } }),
  ]);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return null;
  const subsBudget = lines.length ? lines.reduce((n, l) => n + Math.max(0, l.amount), 0) : null;
  const totalWeight = stages.reduce((n, s) => n + Math.max(0, s.weight), 0);
  const line = subsBudget != null ? stageSubsBudget(stage.weight, totalWeight, subsBudget) : null;
  const usedElsewhere = r2(
    quotes.reduce((n, q) => {
      const c = q.contracts[0];
      const like = { stageId: q.stageId, status: q.status, amount: q.amount, invoiceAmount: q.invoiceAmount, contract: c ? { status: "EXECUTED", amount: c.amount, changes: c.changeOrders.reduce((m, x) => m + x.amount, 0) } : null, paidOut: q.payments.reduce((m, p) => m + p.amount, 0) };
      return n + committedOf(like) + paidOf(like);
    }, 0),
  );
  return { name: stage.name, line, usedElsewhere };
}

/** The rules run again over one invoice: duplicates, the schedule, the balance, change orders, the stage's share. */
export async function refreshFlags(invoiceId: string): Promise<InvoiceFlag[]> {
  const inv = await db.subInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, organizationId: true, projectId: true, contractorId: true, quoteId: true, contractId: true, amount: true, invoiceNumber: true, milestone: true, receivedAt: true, status: true, extractedJson: true, document: { select: { sha256: true } }, quote: { select: { amount: true, stageId: true } } },
  });
  if (!inv) return [];
  if (inv.status === "VOID") return [];
  const [others, contract, siblings, stage] = await Promise.all([
    db.subInvoice.findMany({ where: { organizationId: inv.organizationId, contractorId: inv.contractorId, id: { not: inv.id } }, select: { id: true, number: true, invoiceNumber: true, amount: true, receivedAt: true, status: true, document: { select: { sha256: true } } } }),
    inv.contractId ? db.subcontract.findUnique({ where: { id: inv.contractId }, select: { amount: true, milestonesJson: true, changeOrders: { select: { number: true, status: true, amount: true } } } }) : Promise.resolve(null),
    db.subInvoice.findMany({ where: { quoteId: inv.quoteId, id: { not: inv.id }, status: { in: [...BILLED] } }, select: { amount: true } }),
    stageContext(inv.projectId, inv.quote.stageId, inv.quoteId),
  ]);
  const read = parseStoredInvoiceRead(inv.extractedJson);
  const flags = invoiceChecks({
    amount: inv.amount,
    invoiceNumber: inv.invoiceNumber,
    sha256: inv.document?.sha256 ?? null,
    receivedAt: inv.receivedAt.toISOString(),
    milestone: inv.milestone,
    others: others.map((o) => ({ id: o.id, number: o.number, invoiceNumber: o.invoiceNumber, amount: o.amount, sha256: o.document?.sha256 ?? null, receivedAt: o.receivedAt.toISOString(), status: o.status })),
    contract: contract ? { amount: contract.amount, total: contractTotal(contract.amount, contract.changeOrders), milestones: parseMilestones(contract.milestonesJson), pendingChanges: contract.changeOrders.filter((c) => c.status === "PROPOSED").map((c) => ({ number: c.number, amount: c.amount })) } : null,
    quoteAmount: inv.quote.amount,
    billedBefore: r2(siblings.reduce((n, x) => n + (x.amount ?? 0), 0)),
    stage,
    readAmount: read?.read.amountDue.value ?? null,
  });
  const dup = flags.find((f) => (f.kind === "duplicate" || f.kind === "same-file") && f.of);
  await db.subInvoice.update({ where: { id: inv.id }, data: { flagsJson: JSON.stringify(flags), duplicateOfId: dup?.of ?? null } });
  return flags;
}

/** The quote's invoice fields kept in step for the older screens: INVOICED once billed, the amount billed (never below
 *  the awarded price, so a part-invoice does not shrink what is committed), back to AWARDED when nothing is billed. */
async function syncQuote(quoteId: string): Promise<void> {
  const q = await db.projectSubQuote.findUnique({ where: { id: quoteId }, select: { status: true, amount: true, invoices: { where: { status: { in: [...BILLED] } }, select: { amount: true, receivedAt: true } } } });
  if (!q || (q.status !== "AWARDED" && q.status !== "INVOICED")) return;
  if (!q.invoices.length) {
    if (q.status === "INVOICED") await db.projectSubQuote.update({ where: { id: quoteId }, data: { status: "AWARDED", invoiceAmount: null, invoicedAt: null } });
    return;
  }
  const billed = r2(q.invoices.reduce((n, x) => n + (x.amount ?? 0), 0));
  const last = q.invoices.reduce((m, x) => (x.receivedAt > m ? x.receivedAt : m), q.invoices[0].receivedAt);
  await db.projectSubQuote.update({ where: { id: quoteId }, data: { status: "INVOICED", invoiceAmount: Math.max(billed, q.amount ?? 0), invoicedAt: last } });
}

// ── an invoice lands ─────────────────────────────────────────────────────────

async function nextNumber(organizationId: string): Promise<number> {
  const top = await db.subInvoice.aggregate({ where: { organizationId }, _max: { number: true } });
  return Math.max(INVOICE_FIRST_NUMBER, (top._max.number ?? INVOICE_FIRST_NUMBER - 1) + 1);
}

export type NewInvoice = {
  organizationId: string;
  quoteId: string;
  amount: number | null;
  invoiceNumber: string | null;
  milestone: number | null;
  issuedAt: string | null;
  dueAt?: string | null;
  note: string | null;
  source: "PORTAL" | "EMAIL" | "OFFICE";
  file: FileIn | null;
  /** A document already recorded (an email's attachment). */
  documentId?: string | null;
  inboundEmailId?: string | null;
  actorId: string | null;
};

/** One invoice recorded: its document kept, numbered, tied to the contract when there is one, checked, queued for the
 *  read, the quote marked invoiced, the office told (not when the office itself entered it). */
export async function createInvoice(input: NewInvoice): Promise<InvoiceRow> {
  const q = await db.projectSubQuote.findFirst({
    where: { id: input.quoteId, organizationId: input.organizationId },
    select: { id: true, status: true, projectId: true, stageId: true, contractorId: true, contractor: { select: { name: true } }, project: { select: { name: true, clientId: true } }, stage: { select: { name: true } }, contracts: { where: { status: "EXECUTED" }, orderBy: { number: "desc" }, take: 1, select: { id: true, number: true, amount: true, milestonesJson: true } } },
  });
  if (!q) throw new Error("Quote not found");
  if (q.status === "PAID") throw new Error("This work is paid in full — thank you.");
  if (q.status !== "AWARDED" && q.status !== "INVOICED") throw new Error("Invoices go on awarded work.");
  const contract = q.contracts[0] ?? null;
  let documentId = input.documentId ?? null;
  if (!documentId && input.file) {
    const doc = await recordDocument({ organizationId: input.organizationId, projectId: q.projectId, contractorId: q.contractorId, requestId: null, kind: "INVOICE", name: input.file.name, url: input.file.url, contentType: input.file.contentType, bytes: input.file.bytes, uploadedVia: input.source === "OFFICE" ? "OFFICE" : input.source === "EMAIL" ? "EMAIL" : "SUB", uploadedById: input.actorId, inboundEmailId: input.inboundEmailId ?? null });
    documentId = doc.id;
  }
  const ms = contract ? parseMilestones(contract.milestonesJson) : [];
  const milestone = input.milestone != null && input.milestone >= 0 && input.milestone < ms.length ? input.milestone : null;
  let created: { id: string; number: number } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    try {
      created = await db.subInvoice.create({
        data: {
          organizationId: input.organizationId,
          projectId: q.projectId,
          contractorId: q.contractorId,
          quoteId: q.id,
          contractId: contract?.id ?? null,
          number: await nextNumber(input.organizationId),
          invoiceNumber: input.invoiceNumber?.trim().slice(0, 60) || null,
          amount: input.amount != null ? r2(input.amount) : null,
          milestone,
          milestoneName: milestone != null ? ms[milestone].name : null,
          issuedAt: day(input.issuedAt),
          dueAt: day(input.dueAt ?? null),
          source: input.source,
          documentId,
          inboundEmailId: input.inboundEmailId ?? null,
          note: input.note?.trim().slice(0, 1000) || null,
          reviewStatus: documentId ? "PENDING" : "NONE",
          createdById: input.actorId,
        },
        select: { id: true, number: true },
      });
    } catch (err) {
      if (!(err instanceof Error && /Unique constraint/i.test(err.message)) || attempt === 2) throw err;
    }
  }
  if (!created) throw new Error("The invoice could not be numbered — try again.");
  await syncQuote(q.id);
  const flags = await refreshFlags(created.id);
  const what = milestone != null ? ms[milestone].name : (q.stage?.name ?? null);
  if (input.source === "OFFICE") {
    await logActivity({ organizationId: input.organizationId, actorId: input.actorId, kind: TRAIL_KINDS.PROJECT, summary: `Entered ${q.contractor.name}'s invoice ${invoiceNo(created.number)}${input.amount != null ? ` for ${usd(input.amount)}` : ""} on ${q.project.name}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id, contractId: contract?.id ?? null, invoiceId: created.id, contractorId: q.contractorId } });
  } else {
    await tellOffice(input.organizationId, q.projectId, invoiceInLine({ sub: q.contractor.name, number: created.number, amount: input.amount, what, project: q.project.name, flags: flags.length }), { quoteId: q.id, contractId: contract?.id ?? null, invoiceId: created.id, contractorId: q.contractorId, amount: input.amount }, `/dashboard/projects/${q.projectId}/subs?tab=invoices`);
  }
  return invoiceById(input.organizationId, created.id);
}

/** The sub's contract page: the executed contract behind a token (a deleted company, or a contract not signed, is no). */
export async function contractDoor(token: string): Promise<{ contractId: string; organizationId: string; projectId: string; quoteId: string; contractorId: string } | null> {
  if (!TOKEN.test(token)) return null;
  const c = await db.subcontract.findUnique({ where: { publicToken: token }, select: { id: true, status: true, organizationId: true, projectId: true, quoteId: true, contractorId: true, organization: { select: { deletedAt: true } } } });
  if (!c || c.organization.deletedAt || c.status !== "EXECUTED") return null;
  return { contractId: c.id, organizationId: c.organizationId, projectId: c.projectId, quoteId: c.quoteId, contractorId: c.contractorId };
}

/** An invoice from the sub's contract page. */
export async function invoiceFromContractPage(token: string, input: SubInvoiceInput): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
  const door = await contractDoor(token);
  if (!door) return { ok: false, error: "This link does not take invoices — the contract is not signed, or the link is not valid." };
  try {
    const row = await createInvoice({ organizationId: door.organizationId, quoteId: door.quoteId, amount: input.amount, invoiceNumber: input.invoiceNumber, milestone: input.milestone, issuedAt: input.issuedAt, note: input.note, source: "PORTAL", file: input.file, actorId: null });
    return { ok: true, number: invoiceNo(row.number) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That didn't go through — try again." };
  }
}

/** An invoice that came by email on an awarded quote's address (lib/subInbound): its document recorded already. */
export async function invoiceFromEmail(quoteId: string, input: { documentId: string | null; inboundEmailId: string; note: string | null }): Promise<InvoiceRow | null> {
  const q = await db.projectSubQuote.findUnique({ where: { id: quoteId }, select: { organizationId: true, status: true } });
  if (!q || (q.status !== "AWARDED" && q.status !== "INVOICED")) return null;
  return createInvoice({ organizationId: q.organizationId, quoteId, amount: null, invoiceNumber: null, milestone: null, issuedAt: null, note: input.note, source: "EMAIL", file: null, documentId: input.documentId, inboundEmailId: input.inboundEmailId, actorId: null });
}

// ── the read ─────────────────────────────────────────────────────────────────

/** The model's read of one invoice's document; stored on the invoice, the file's fingerprint kept for duplicates. */
export async function readInvoice(invoiceId: string): Promise<{ ok: boolean; status: string; error: string | null }> {
  const inv = await db.subInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, organizationId: true, readAttempts: true, document: { select: { id: true, url: true, name: true, contentType: true } } } });
  if (!inv) return { ok: false, status: "NONE", error: "Invoice not found" };
  if (!inv.document) {
    await db.subInvoice.update({ where: { id: inv.id }, data: { reviewStatus: "NONE" } });
    return { ok: false, status: "NONE", error: "No document on this invoice." };
  }
  const attempts = inv.readAttempts + 1;
  const fail = async (words: string) => {
    const status = attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
    await db.subInvoice.update({ where: { id: inv.id }, data: { readAttempts: attempts, readError: words.slice(0, 500), reviewStatus: status } });
    return { ok: false, status, error: words };
  };
  if (!isOpenAIEnabled()) {
    await db.subInvoice.update({ where: { id: inv.id }, data: { readAttempts: attempts, readError: "AI is not set up on this server.", reviewStatus: "FAILED" } });
    return { ok: false, status: "FAILED", error: "Reading an invoice needs AI, which is not set up on this server." };
  }
  try {
    await noteRequestOrg(inv.organizationId);
    const doc = await documentParts(inv.document, "invoice");
    if (!doc.ok) return await fail(doc.error);
    await db.subDocument.update({ where: { id: inv.document.id }, data: { sha256: doc.sha256 } }).catch(() => null);
    const model = doc.from === "text" ? await resolveOpenAIModel() : getVisionModel();
    const reasoning = isReasoningModelName(model);
    const res = await getOpenAI().chat.completions.create({
      model,
      ...(reasoning ? { reasoning_effort: "low" as const } : await samplingOptions(0)),
      max_completion_tokens: 4000,
      response_format: zodResponseFormat(InvoiceRead, INVOICE_READ_SCHEMA_NAME),
      messages: [
        { role: "system", content: INVOICE_READ_SYSTEM },
        { role: "user", content: doc.parts as unknown as Array<{ type: "text"; text: string }> },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return await fail("The model answered nothing.");
    const parsed = InvoiceRead.safeParse(JSON.parse(raw));
    if (!parsed.success) return await fail("The model's answer did not fit the schema.");
    const org = await db.organization.findUnique({ where: { id: inv.organizationId }, select: { timezone: true } });
    const today = localDayKey(new Date(), org?.timezone || "America/New_York");
    const read = { ...parsed.data, flags: [...parsed.data.flags, ...invoiceReadChecks(parsed.data, doc.text, today)].slice(0, 12) };
    const stored: StoredInvoiceRead = { read, model, from: doc.from, chars: doc.text?.length ?? null, pages: doc.pages, at: new Date().toISOString() };
    await db.subInvoice.update({ where: { id: inv.id }, data: { extractedJson: JSON.stringify(stored), reviewStatus: "READ", readAttempts: attempts, readError: null } });
    await refreshFlags(inv.id);
    console.log(`[invoice-read] ${inv.id} · ${doc.from} · due ${read.amountDue.value ?? "—"} · ${read.flags.length} flag(s)`);
    return { ok: true, status: "READ", error: null };
  } catch (err) {
    const words = err instanceof Error ? err.message : String(err);
    console.error(`[invoice-read] ${inv.id} failed: ${words}`);
    return await fail(words);
  }
}

/** The queued invoice reads, oldest first (the sweep, and the after() of a new invoice). */
export async function runPendingInvoiceReads(limit = 5): Promise<{ tried: number; read: number; failed: number }> {
  const rows = await db.subInvoice.findMany({ where: { reviewStatus: "PENDING", documentId: { not: null } }, orderBy: { receivedAt: "asc" }, take: limit, select: { id: true } });
  let read = 0;
  let failed = 0;
  for (const r of rows) {
    const out = await readInvoice(r.id);
    if (out.ok) read += 1;
    else if (out.status === "FAILED") failed += 1;
  }
  return { tried: rows.length, read, failed };
}

/** "Use these": the read's amount, number and days become the invoice's. */
export async function acceptInvoiceRead(organizationId: string, invoiceId: string, actorId: string | null): Promise<InvoiceRow> {
  const inv = await invoiceDb(organizationId, invoiceId);
  const read = parseStoredInvoiceRead(inv.extractedJson);
  if (!read) throw new Error("There is no read to use.");
  if (inv.status !== "RECEIVED") throw new Error("Only an invoice not yet approved takes the read's figures.");
  const amount = read.read.amountDue.value;
  await db.subInvoice.update({
    where: { id: inv.id },
    data: {
      reviewStatus: "REVIEWED",
      ...(amount != null ? { amount: r2(amount) } : {}),
      ...(read.read.invoiceNumber && !inv.invoiceNumber ? { invoiceNumber: read.read.invoiceNumber.replace(/^#/, "").slice(0, 60) } : {}),
      ...(isoDayOf(read.read.date) && !inv.issuedAt ? { issuedAt: day(isoDayOf(read.read.date)) } : {}),
      ...(isoDayOf(read.read.dueDate) && !inv.dueAt ? { dueAt: day(isoDayOf(read.read.dueDate)) } : {}),
    },
  });
  await syncQuote(inv.quoteId);
  await refreshFlags(inv.id);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Used the AI's read of ${invoiceNo(inv.number)}${amount != null ? ` — ${usd(amount)}` : ""}`, meta: { projectId: inv.projectId, quoteId: inv.quoteId, invoiceId: inv.id } });
  return invoiceById(organizationId, inv.id);
}

export async function rejectInvoiceRead(organizationId: string, invoiceId: string): Promise<void> {
  const inv = await invoiceDb(organizationId, invoiceId);
  await db.subInvoice.update({ where: { id: inv.id }, data: { reviewStatus: "REJECTED" } });
}

export async function readInvoiceAgain(organizationId: string, invoiceId: string): Promise<{ ok: boolean; status: string; error: string | null }> {
  const inv = await invoiceDb(organizationId, invoiceId);
  await db.subInvoice.update({ where: { id: inv.id }, data: { reviewStatus: "PENDING", readAttempts: 0, readError: null } });
  return readInvoice(inv.id);
}

// ── the office's decisions ───────────────────────────────────────────────────

export type InvoicePatch = { amount?: number | null; invoiceNumber?: string | null; milestone?: number | null; issuedAt?: string | null; dueAt?: string | null; note?: string | null };

/** The figures typed or corrected by the office, while it is not yet paid. */
export async function editInvoice(organizationId: string, invoiceId: string, patch: InvoicePatch): Promise<InvoiceRow> {
  const inv = await invoiceDb(organizationId, invoiceId);
  if (inv.status !== "RECEIVED" && inv.status !== "APPROVED") throw new Error("A paid, disputed or void invoice is not edited.");
  if (inv.status === "APPROVED" && patch.amount !== undefined && patch.amount !== inv.amount && inv.payments.some((p) => p.status === "RECORDED")) throw new Error("Payments are recorded on it — void them before changing the amount.");
  let milestoneName: string | null | undefined;
  if (patch.milestone !== undefined && inv.contractId) {
    const c = await db.subcontract.findUnique({ where: { id: inv.contractId }, select: { milestonesJson: true } });
    const ms = parseMilestones(c?.milestonesJson);
    milestoneName = patch.milestone != null && ms[patch.milestone] ? ms[patch.milestone].name : null;
    if (patch.milestone != null && !ms[patch.milestone]) patch.milestone = null;
  }
  await db.subInvoice.update({
    where: { id: inv.id },
    data: {
      ...(patch.amount !== undefined ? { amount: patch.amount != null ? r2(patch.amount) : null } : {}),
      ...(patch.invoiceNumber !== undefined ? { invoiceNumber: patch.invoiceNumber?.trim().slice(0, 60) || null } : {}),
      ...(patch.milestone !== undefined ? { milestone: patch.milestone, milestoneName: milestoneName ?? null } : {}),
      ...(patch.issuedAt !== undefined ? { issuedAt: day(patch.issuedAt) } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: day(patch.dueAt), dueNotifiedAt: null } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim().slice(0, 1000) || null } : {}),
    },
  });
  await syncQuote(inv.quoteId);
  await refreshFlags(inv.id);
  return invoiceById(organizationId, inv.id);
}

export async function approveInvoice(organizationId: string, invoiceId: string, actorId: string | null): Promise<InvoiceRow> {
  const inv = await invoiceDb(organizationId, invoiceId);
  if (inv.status !== "RECEIVED") throw new Error(inv.status === "APPROVED" ? "It is approved already." : "Only an invoice waiting for review is approved.");
  if (inv.amount == null || !(inv.amount > 0)) throw new Error("Confirm the amount first — use the AI's read, or type it.");
  await db.subInvoice.update({ where: { id: inv.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: actorId } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Approved ${inv.contractor.name}'s invoice ${invoiceNo(inv.number)} for ${usd(inv.amount)}${inv.milestoneName ? ` (${inv.milestoneName})` : ""}`, meta: { projectId: inv.projectId, quoteId: inv.quoteId, contractId: inv.contractId, invoiceId: inv.id, amount: inv.amount } });
  return invoiceById(organizationId, inv.id);
}

async function mailSub(organizationId: string, to: string | null, subject: string, html: string): Promise<"sent" | "none" | "failed"> {
  if (!to) return "none";
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
  if (!org) return "none";
  try {
    await sendOrgEmail(org, { to, subject, html });
    return "sent";
  } catch (err) {
    console.warn(`[subInvoices] email to ${to} failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

async function contractLink(contractId: string | null): Promise<string | null> {
  if (!contractId) return null;
  const c = await db.subcontract.findUnique({ where: { id: contractId }, select: { publicToken: true } });
  return c ? `${await appBaseUrl()}/s/${c.publicToken}` : null;
}

/** The office questions an invoice; the sub is told why. Nothing is paid on it until it is sent again. */
export async function disputeInvoice(organizationId: string, invoiceId: string, reason: string, actorId: string | null): Promise<InvoiceRow> {
  const inv = await invoiceDb(organizationId, invoiceId);
  if (inv.status !== "RECEIVED" && inv.status !== "APPROVED") throw new Error("Only an invoice not yet paid can be questioned.");
  if (inv.payments.some((p) => p.status === "RECORDED")) throw new Error("Payments are recorded on it — void them first.");
  const why = reason.trim().slice(0, 500);
  if (!why) throw new Error("Say what is wrong — the sub reads it.");
  await db.subInvoice.update({ where: { id: inv.id }, data: { status: "DISPUTED", disputedAt: new Date(), disputeReason: why } });
  await syncQuote(inv.quoteId);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, phone: true } });
  const link = await contractLink(inv.contractId);
  const company = org?.name ?? "The company";
  await mailSub(organizationId, inv.contractor.email, `About your invoice ${inv.invoiceNumber ? `#${inv.invoiceNumber}` : invoiceNo(inv.number)} — ${company}`, `<p>Hello ${esc(inv.contractor.name)},</p><p>${esc(company)} has a question about your invoice ${esc(inv.invoiceNumber ? `#${inv.invoiceNumber}` : invoiceNo(inv.number))}${inv.amount != null ? ` for ${esc(usd(inv.amount))}` : ""}:</p><p><b>${esc(why)}</b></p><p>${link ? `Send a corrected invoice from your subcontract's page: <a href="${esc(link)}">${esc(link)}</a>` : "Reply to this email with a corrected invoice."}</p>${org?.phone ? `<p>Questions: ${esc(org.phone)}</p>` : ""}`);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Questioned ${inv.contractor.name}'s invoice ${invoiceNo(inv.number)} — ${why.slice(0, 120)}`, meta: { projectId: inv.projectId, quoteId: inv.quoteId, contractId: inv.contractId, invoiceId: inv.id } });
  return invoiceById(organizationId, inv.id);
}

/** An invoice set aside (sent twice, entered by mistake). Never one with payments on it. */
export async function voidInvoice(organizationId: string, invoiceId: string, reason: string | null, actorId: string | null): Promise<InvoiceRow> {
  const inv = await invoiceDb(organizationId, invoiceId);
  if (inv.status === "VOID") throw new Error("It is void already.");
  if (inv.payments.some((p) => p.status === "RECORDED")) throw new Error("Payments are recorded on it — void them first.");
  await db.subInvoice.update({ where: { id: inv.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason?.trim().slice(0, 300) || null } });
  await syncQuote(inv.quoteId);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Voided invoice ${invoiceNo(inv.number)} from ${inv.contractor.name}${reason ? ` — ${reason.slice(0, 120)}` : ""}`, meta: { projectId: inv.projectId, quoteId: inv.quoteId, invoiceId: inv.id } });
  return invoiceById(organizationId, inv.id);
}

// ── payments ─────────────────────────────────────────────────────────────────

export type NewPayment = {
  /** The invoice paid; null for a release of retainage (then contractId). */
  invoiceId: string | null;
  contractId?: string | null;
  amount: number;
  held: number;
  release: boolean;
  method: PayMethod;
  reference: string | null;
  paidAt: string;
  waiverKind: WaiverKind | null;
  waiverFile: FileIn | null;
  note: string | null;
  /** One payment per key: a second press, or Ramp's paid bill read twice, records nothing new. */
  key: string;
  rampBillId?: string | null;
};

/** After a payment or a void: the invoice paid when settled, the quote paid when the contract (or the award) is. */
async function settle(invoiceId: string | null, quoteId: string): Promise<void> {
  if (invoiceId) {
    const inv = await db.subInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, amount: true, status: true, payments: { select: { amount: true, retainageHeld: true, retainageRelease: true, status: true, invoiceId: true } } } });
    if (inv && inv.amount != null) {
      const s = settledOf(inv.id, inv.payments);
      const paid = s.settled + 0.005 >= inv.amount;
      if (paid && inv.status === "APPROVED") await db.subInvoice.update({ where: { id: inv.id }, data: { status: "PAID" } });
      if (!paid && inv.status === "PAID") await db.subInvoice.update({ where: { id: inv.id }, data: { status: "APPROVED" } });
    }
  }
  const q = await db.projectSubQuote.findUnique({ where: { id: quoteId }, select: { status: true, amount: true, invoiceAmount: true, contracts: { where: { status: "EXECUTED" }, take: 1, select: { amount: true, changeOrders: { select: { status: true, amount: true } } } }, payments: { where: { status: "RECORDED" }, select: { amount: true } } } });
  if (!q) return;
  const cash = r2(q.payments.reduce((n, p) => n + p.amount, 0));
  const owed = q.contracts[0] ? contractTotal(q.contracts[0].amount, q.contracts[0].changeOrders) : Math.max(q.amount ?? 0, q.invoiceAmount ?? 0);
  const done = owed > 0 && cash + 0.005 >= owed;
  if (done && q.status !== "PAID") await db.projectSubQuote.update({ where: { id: quoteId }, data: { status: "PAID", paidAt: new Date() } });
  if (!done && q.status === "PAID") {
    await db.projectSubQuote.update({ where: { id: quoteId }, data: { status: "INVOICED", paidAt: null } });
    await syncQuote(quoteId);
  }
}

/** A payment recorded: checked against what is left (or the retainage held), the waiver kept, the project's
 *  Subcontractors expense written on the stage's phase, the invoice and the quote settled, the sub told. */
export async function recordPayment(organizationId: string, input: NewPayment, actorId: string | null): Promise<{ payment: PaymentRow; duplicate: boolean; email: "sent" | "none" | "failed" }> {
  const again = await db.subPayment.findUnique({ where: { idempotencyKey: input.key }, select: PAYMENT_SELECT });
  if (again) return { payment: paymentRow(again), duplicate: true, email: "none" };
  const paidAt = day(input.paidAt) ?? new Date();
  let quoteId: string;
  let contractId: string | null;
  let invoice: InvoiceDb | null = null;
  if (input.release) {
    if (!input.contractId) throw new Error("A release names its contract.");
    const c = await db.subcontract.findFirst({ where: { id: input.contractId, organizationId, status: "EXECUTED" }, select: { id: true, quoteId: true, payments: { select: { amount: true, retainageHeld: true, retainageRelease: true, status: true, invoiceId: true } } } });
    if (!c) throw new Error("Contract not found");
    const why = paymentCheck({ amount: input.amount, held: input.held, release: true, left: null, heldNow: heldOf(c.payments) });
    if (why) throw new Error(why);
    quoteId = c.quoteId;
    contractId = c.id;
  } else {
    if (!input.invoiceId) throw new Error("A payment names its invoice.");
    invoice = await invoiceDb(organizationId, input.invoiceId);
    if (invoice.status !== "APPROVED") throw new Error(invoice.status === "PAID" ? "This invoice is paid in full." : "Approve the invoice before paying it.");
    const s = settledOf(invoice.id, invoice.payments.map(paymentLikeOf));
    const why = paymentCheck({ amount: input.amount, held: input.held, release: false, left: invoice.amount != null ? r2(invoice.amount - s.settled) : null, heldNow: 0 });
    if (why) throw new Error(why);
    quoteId = invoice.quoteId;
    contractId = invoice.contractId;
  }
  const q = await db.projectSubQuote.findFirst({ where: { id: quoteId, organizationId }, select: { id: true, projectId: true, stageId: true, contractorId: true, contractor: { select: { name: true, email: true } }, project: { select: { name: true, clientId: true } }, contracts: { where: { id: contractId ?? "-" }, select: { number: true } } } });
  if (!q) throw new Error("Quote not found");
  let waiverDocumentId: string | null = null;
  if (input.waiverFile) {
    const doc = await recordDocument({ organizationId, projectId: q.projectId, contractorId: q.contractorId, requestId: null, kind: "WAIVER", name: input.waiverFile.name, url: input.waiverFile.url, contentType: input.waiverFile.contentType, bytes: input.waiverFile.bytes, uploadedVia: "OFFICE", uploadedById: actorId });
    waiverDocumentId = doc.id;
  }
  const phaseId = q.stageId ? ((await db.projectStage.findUnique({ where: { id: q.stageId }, select: { phaseId: true } }))?.phaseId ?? null) : null;
  const ref = input.reference?.trim().slice(0, 60) || null;
  const label = input.release ? `Retainage released${q.contracts[0] ? ` · ${contractNo(q.contracts[0].number)}` : ""}` : `${invoice ? invoiceNo(invoice.number) : "Payment"}${invoice?.invoiceNumber ? ` (#${invoice.invoiceNumber})` : ""}`;
  let created: PaymentDb;
  try {
    created = await db.$transaction(async (tx) => {
      const expense = input.amount > 0 ? await tx.projectExpense.create({ data: { projectId: q.projectId, category: "SUBCONTRACTORS", amount: r2(input.amount), vendor: q.contractor.name, note: `${label} · ${input.method === "RAMP" ? "Ramp Bill Pay" : input.method.toLowerCase()}${ref ? ` ${ref}` : ""}`.slice(0, 300), spentAt: paidAt, paidAt, phaseId, createdById: actorId } }) : null;
      return tx.subPayment.create({
        data: {
          organizationId,
          projectId: q.projectId,
          contractorId: q.contractorId,
          quoteId: q.id,
          contractId,
          invoiceId: invoice?.id ?? null,
          amount: r2(input.amount),
          retainageHeld: input.release ? 0 : r2(input.held),
          retainageRelease: input.release,
          method: input.method,
          reference: ref,
          paidAt,
          waiverDocumentId,
          waiverKind: waiverDocumentId ? input.waiverKind : null,
          expenseId: expense?.id ?? null,
          rampBillId: input.rampBillId ?? null,
          idempotencyKey: input.key,
          note: input.note?.trim().slice(0, 500) || null,
          createdById: actorId,
        },
        select: PAYMENT_SELECT,
      });
    });
  } catch (err) {
    // The same key at the same moment (two presses): the other one won.
    const won = await db.subPayment.findUnique({ where: { idempotencyKey: input.key }, select: PAYMENT_SELECT });
    if (won) return { payment: paymentRow(won), duplicate: true, email: "none" };
    throw err;
  }
  await settle(invoice?.id ?? null, q.id);
  const row = paymentRow(created);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `${row.words} — ${q.contractor.name}${invoice ? `, ${invoiceNo(invoice.number)}` : ""} on ${q.project.name}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id, contractId, invoiceId: invoice?.id ?? null, paymentId: created.id, contractorId: q.contractorId, amount: created.amount } });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, phone: true } });
  const link = await contractLink(contractId);
  const company = org?.name ?? "The company";
  const email = await mailSub(
    organizationId,
    q.contractor.email,
    `${input.release ? "Retainage released" : "Payment sent"} — ${company} — ${q.project.name}`,
    `<p>Hello ${esc(q.contractor.name)},</p><p>${esc(company)} recorded a payment to you on ${esc(q.project.name)}: <b>${esc(row.words)}</b>${invoice ? ` against your invoice ${esc(invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : invoiceNo(invoice.number))}` : ""}.</p>${!waiverDocumentId && created.amount > 0 ? `<p>Please send your lien waiver for this payment${link ? ` from your subcontract's page: <a href="${esc(link)}">${esc(link)}</a>` : " by replying to this email"}.</p>` : ""}${org?.phone ? `<p>Questions: ${esc(org.phone)}</p>` : ""}`,
  );
  return { payment: row, duplicate: false, email };
}

/** A payment taken back (entered by mistake, a check that bounced): its expense removed, the invoice and quote open again. */
export async function voidPayment(organizationId: string, paymentId: string, reason: string | null, actorId: string | null): Promise<PaymentRow> {
  const p = await db.subPayment.findFirst({ where: { id: paymentId, organizationId }, select: { id: true, status: true, expenseId: true, invoiceId: true, quoteId: true, projectId: true, amount: true, method: true, rampBillId: true } });
  if (!p) throw new Error("Payment not found");
  if (p.status === "VOID") throw new Error("It is void already.");
  if (p.method === "RAMP") throw new Error("Ramp paid this one — a refund goes through Ramp; it is not voided here.");
  await db.$transaction(async (tx) => {
    if (p.expenseId) await tx.projectExpense.deleteMany({ where: { id: p.expenseId, projectId: p.projectId } });
    await tx.subPayment.update({ where: { id: p.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason?.trim().slice(0, 300) || null, expenseId: null } });
  });
  await settle(p.invoiceId, p.quoteId);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Voided a ${usd(p.amount)} payment${reason ? ` — ${reason.slice(0, 120)}` : ""}`, meta: { projectId: p.projectId, quoteId: p.quoteId, invoiceId: p.invoiceId, paymentId: p.id } });
  const row = await db.subPayment.findUnique({ where: { id: p.id }, select: PAYMENT_SELECT });
  return paymentRow(row!);
}

/** The sub's lien waiver kept on a payment — from the office. */
export async function attachWaiver(organizationId: string, paymentId: string, kind: WaiverKind, file: FileIn, actorId: string | null): Promise<PaymentRow> {
  const p = await db.subPayment.findFirst({ where: { id: paymentId, organizationId }, select: { id: true, projectId: true, contractorId: true, quoteId: true } });
  if (!p) throw new Error("Payment not found");
  const doc = await recordDocument({ organizationId, projectId: p.projectId, contractorId: p.contractorId, requestId: null, kind: "WAIVER", name: file.name, url: file.url, contentType: file.contentType, bytes: file.bytes, uploadedVia: "OFFICE", uploadedById: actorId });
  await db.subPayment.update({ where: { id: p.id }, data: { waiverDocumentId: doc.id, waiverKind: kind } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Kept a lien waiver on a payment`, meta: { projectId: p.projectId, quoteId: p.quoteId, paymentId: p.id } });
  const row = await db.subPayment.findUnique({ where: { id: p.id }, select: PAYMENT_SELECT });
  return paymentRow(row!);
}

/** The sub's lien waiver from their contract page; the office is told. */
export async function waiverFromContractPage(token: string, paymentId: string, kind: WaiverKind, file: FileIn): Promise<{ ok: true } | { ok: false; error: string }> {
  const door = await contractDoor(token);
  if (!door) return { ok: false, error: "This link is not valid." };
  const p = await db.subPayment.findFirst({ where: { id: paymentId, contractId: door.contractId, status: "RECORDED" }, select: { id: true, amount: true, paidAt: true, contractor: { select: { name: true } }, project: { select: { name: true } } } });
  if (!p) return { ok: false, error: "That payment is not on this contract." };
  try {
    const doc = await recordDocument({ organizationId: door.organizationId, projectId: door.projectId, contractorId: door.contractorId, requestId: null, kind: "WAIVER", name: file.name, url: file.url, contentType: file.contentType, bytes: file.bytes, uploadedVia: "SUB", uploadedById: null });
    await db.subPayment.update({ where: { id: p.id }, data: { waiverDocumentId: doc.id, waiverKind: kind } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That didn't go through — try again." };
  }
  await tellOffice(door.organizationId, door.projectId, `${p.contractor.name} sent the lien waiver for the ${usd(p.amount)} payment on ${p.project.name}.`, { quoteId: door.quoteId, contractId: door.contractId, paymentId: p.id, contractorId: door.contractorId }, `/dashboard/projects/${door.projectId}/subs?tab=payments`);
  return { ok: true };
}

/** Release the retainage held on a contract: one payment for what is held (or part of it). */
export async function releaseRetainage(organizationId: string, contractId: string, input: { amount: number | null; method: PayMethod; reference: string | null; paidAt: string; key: string }, actorId: string | null) {
  const c = await db.subcontract.findFirst({ where: { id: contractId, organizationId }, select: { id: true, payments: { select: { amount: true, retainageHeld: true, retainageRelease: true, status: true, invoiceId: true } } } });
  if (!c) throw new Error("Contract not found");
  const held = heldOf(c.payments);
  if (!(held > 0)) throw new Error("No retainage is held on this contract.");
  return recordPayment(organizationId, { invoiceId: null, contractId: c.id, amount: input.amount ?? held, held: 0, release: true, method: input.method, reference: input.reference, paidAt: input.paidAt, waiverKind: null, waiverFile: null, note: null, key: input.key }, actorId);
}

// ── the sub's page ───────────────────────────────────────────────────────────

export type SubInvoiceView = {
  canInvoice: boolean;
  milestones: Array<{ index: number; name: string; pct: number; amount: number; billed: number; due: string | null }>;
  retainagePct: number | null;
  invoices: Array<{ id: string; number: string; invoiceNumber: string | null; amount: number | null; milestoneName: string | null; status: string; disputeReason: string | null; receivedAt: string; paid: number; held: number; document: { name: string; href: string } | null }>;
  /** `final`: a release of retainage — its waiver is the final one. */
  payments: Array<{ id: string; words: string; amount: number; final: boolean; waiverNeeded: boolean; waiver: { name: string; href: string } | null }>;
  money: { total: number; billed: number; paid: number; held: number; left: number };
};

/** What the sub's contract page shows under the agreement once it is signed: the schedule with what is billed, their
 *  invoices and payments, the waivers asked for. */
export async function contractInvoiceView(token: string): Promise<SubInvoiceView | null> {
  if (!TOKEN.test(token)) return null;
  const c = await db.subcontract.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, amount: true, milestonesJson: true, retainagePct: true, changeOrders: { select: { status: true, amount: true } }, invoices: { orderBy: { number: "asc" }, select: { id: true, number: true, invoiceNumber: true, amount: true, milestone: true, milestoneName: true, status: true, disputeReason: true, receivedAt: true, document: { select: { id: true, name: true } } } }, payments: { orderBy: { paidAt: "asc" }, select: { id: true, amount: true, retainageHeld: true, retainageRelease: true, method: true, reference: true, paidAt: true, status: true, invoiceId: true, waiverDocument: { select: { id: true, name: true } } } } },
  });
  if (!c || c.status !== "EXECUTED") return null;
  const ms = parseMilestones(c.milestonesJson);
  const billedBy = new Map<number, number>();
  for (const i of c.invoices) if (i.milestone != null && (BILLED as readonly string[]).includes(i.status)) billedBy.set(i.milestone, (billedBy.get(i.milestone) ?? 0) + (i.amount ?? 0));
  const ps = c.payments.map(paymentLikeOf);
  const money = contractMoney(contractTotal(c.amount, c.changeOrders), c.invoices.map((i) => ({ id: i.id, amount: i.amount, status: i.status })), ps);
  return {
    canInvoice: true,
    milestones: milestoneAmounts(c.amount, ms).map((m, index) => ({ index, name: m.name, pct: m.pct, amount: m.amount, billed: r2(billedBy.get(index) ?? 0), due: m.due })),
    retainagePct: c.retainagePct,
    invoices: c.invoices
      .filter((i) => i.status !== "VOID")
      .map((i) => {
        const s = settledOf(i.id, ps);
        return { id: i.id, number: invoiceNo(i.number), invoiceNumber: i.invoiceNumber, amount: i.amount, milestoneName: i.milestoneName, status: i.status, disputeReason: i.disputeReason, receivedAt: i.receivedAt.toISOString(), paid: s.paid, held: s.held, document: i.document ? { name: i.document.name, href: `/api/s/${token}/file/${i.document.id}` } : null };
      }),
    payments: c.payments
      .filter((p) => p.status === "RECORDED")
      .map((p) => ({ id: p.id, amount: p.amount, final: p.retainageRelease, words: paymentWords({ amount: p.amount, retainageHeld: p.retainageHeld, retainageRelease: p.retainageRelease, method: p.method, reference: p.reference, paidAt: p.paidAt.toISOString(), status: p.status }), waiverNeeded: !p.waiverDocument && p.amount > 0, waiver: p.waiverDocument ? { name: p.waiverDocument.name, href: `/api/s/${token}/file/${p.waiverDocument.id}` } : null })),
    money: { total: money.total, billed: money.billed, paid: money.paid, held: money.held, left: money.left },
  };
}

/** The documents a contract's token may open beyond the agreement's own: the sub's invoices and waivers on it. */
export async function contractMoneyDocumentIds(contractId: string): Promise<string[]> {
  const [inv, pay] = await Promise.all([
    db.subInvoice.findMany({ where: { contractId, documentId: { not: null } }, select: { documentId: true } }),
    db.subPayment.findMany({ where: { contractId, waiverDocumentId: { not: null } }, select: { waiverDocumentId: true } }),
  ]);
  return [...inv.map((x) => x.documentId!), ...pay.map((x) => x.waiverDocumentId!)];
}

// ── company-wide ─────────────────────────────────────────────────────────────

/** Every invoice still open across the company's projects — to review, or approved and not paid in full — oldest
 *  due first (the AI Operator's "which sub invoices are unpaid"). */
export async function openInvoices(organizationId: string): Promise<Array<InvoiceRow & { projectName: string }>> {
  const rows = await db.subInvoice.findMany({ where: { organizationId, status: { in: ["RECEIVED", "APPROVED"] } }, orderBy: [{ dueAt: "asc" }, { receivedAt: "asc" }], take: 60, select: { ...INVOICE_SELECT, project: { select: { name: true } } } });
  return rows.map((r) => ({ ...invoiceRow(r), projectName: r.project.name }));
}

// ── the sweep ────────────────────────────────────────────────────────────────

/** Approved invoices due by tomorrow and not paid: the office is told once. */
export async function invoicesDue(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + 36 * 3_600_000);
  const rows = await db.subInvoice.findMany({ where: { status: "APPROVED", dueAt: { lte: soon }, dueNotifiedAt: null }, take: 50, select: { id: true, organizationId: true, projectId: true, quoteId: true, contractId: true, number: true, amount: true, dueAt: true, contractor: { select: { name: true } }, project: { select: { name: true } } } });
  for (const r of rows) {
    await db.subInvoice.update({ where: { id: r.id }, data: { dueNotifiedAt: now } });
    await tellOffice(r.organizationId, r.projectId, `${r.contractor.name}'s invoice ${invoiceNo(r.number)}${r.amount != null ? ` (${usd(r.amount)})` : ""} is due ${isoDay(r.dueAt)} on ${r.project.name} — not paid yet.`, { quoteId: r.quoteId, contractId: r.contractId, invoiceId: r.id }, `/dashboard/projects/${r.projectId}/subs?tab=invoices`);
  }
  return rows.length;
}

// ── Ramp ─────────────────────────────────────────────────────────────────────

/** An approved invoice sent to Ramp's Bill Pay as a bill for what is left on it (less the retainage kept); Ramp pays the
 *  sub, and when it does the payment is recorded here (recordRampPayment). */
export async function sendInvoiceToRamp(organizationId: string, invoiceId: string, by: { userId: string | null; name: string }): Promise<{ ok: true; warning: string | null } | { ok: false; error: string }> {
  const inv = await invoiceDb(organizationId, invoiceId);
  if (inv.status !== "APPROVED") return { ok: false, error: "Approve the invoice before sending it to Ramp." };
  if (inv.rampBillId) return { ok: false, error: "It is in Ramp already." };
  if (inv.amount == null) return { ok: false, error: "Confirm the amount first." };
  const s = settledOf(inv.id, inv.payments.map(paymentLikeOf));
  const sug = paymentSuggestion({ invoiceAmount: inv.amount, settledSoFar: s.settled, retainagePct: inv.contract?.retainagePct ?? null });
  if (!(sug.amount > 0)) return { ok: false, error: "Nothing is left to pay on it." };
  let invoiceFile: { dataUrl: string; filename: string } | null = null;
  if (inv.document) {
    const dataUrl = await readStoredAsDataUrl(inv.document.url, 10 * 1024 * 1024).catch(() => null);
    if (dataUrl) invoiceFile = { dataUrl, filename: inv.document.name };
  }
  const today = localDayKey(new Date(), "UTC");
  const { createRampBill } = await import("@/lib/ramp/bills");
  const r = await createRampBill(
    organizationId,
    {
      vendorId: null,
      vendorName: inv.contractor.name,
      vendorEmail: inv.contractor.email,
      invoiceNumber: inv.invoiceNumber || invoiceNo(inv.number),
      amount: sug.amount,
      issuedAt: isoDay(inv.issuedAt) ?? today,
      dueAt: isoDay(inv.dueAt) ?? today,
      memo: `${invoiceNo(inv.number)}${inv.milestoneName ? ` · ${inv.milestoneName}` : ""}${sug.held > 0 ? ` · ${usd(sug.held)} retainage held` : ""}`,
      category: "Subcontractors",
      to: { kind: "none" },
      invoice: invoiceFile,
      sub: { invoiceId: inv.id, held: sug.held },
    },
    by,
  );
  if (!r.ok) return r;
  await db.subInvoice.update({ where: { id: inv.id }, data: { rampBillId: r.bill.billId } });
  await logActivity({ organizationId, actorId: by.userId, kind: TRAIL_KINDS.PROJECT, summary: `Sent ${invoiceNo(inv.number)} to Ramp — ${usd(sug.amount)} to ${inv.contractor.name}${sug.held > 0 ? `, ${usd(sug.held)} retainage held` : ""}`, meta: { projectId: inv.projectId, quoteId: inv.quoteId, contractId: inv.contractId, invoiceId: inv.id, rampBillId: r.bill.billId } });
  return { ok: true, warning: r.warning };
}

/** Ramp paid a sub's bill (lib/ramp/bills, once per bill): the payment recorded here; its expense id goes back to the
 *  bill's record so Ramp's own booking writes no second expense. */
export async function recordRampPayment(organizationId: string, bill: { billId: string; amount: number; paidAt: string | null; invoiceNumber: string; sub: { invoiceId: string; held: number } }): Promise<{ expenseId: string | null } | null> {
  const inv = await db.subInvoice.findFirst({ where: { id: bill.sub.invoiceId, organizationId }, select: { id: true, status: true } });
  if (!inv) return null;
  if (inv.status === "RECEIVED") await db.subInvoice.update({ where: { id: inv.id }, data: { status: "APPROVED", approvedAt: new Date() } });
  const r = await recordPayment(
    organizationId,
    { invoiceId: inv.id, amount: bill.amount, held: bill.sub.held, release: false, method: "RAMP", reference: bill.invoiceNumber, paidAt: (bill.paidAt ?? new Date().toISOString()).slice(0, 10), waiverKind: null, waiverFile: null, note: `Ramp bill ${bill.billId}`, key: `ramp:${bill.billId}`, rampBillId: bill.billId },
    null,
  ).catch((err) => {
    console.warn(`[subInvoices] Ramp paid ${bill.billId} but the payment could not be recorded: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (!r) return null;
  const p = await db.subPayment.findUnique({ where: { id: r.payment.id }, select: { expenseId: true } });
  return { expenseId: p?.expenseId ?? null };
}
