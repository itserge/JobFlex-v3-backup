import "server-only";
// RAMP BILL PAY FROM JOBFLEX (2026-10-29, round 2) — server. The office pays a vendor's invoice without leaving the
// job: the bill is made in the contractor's Ramp, coded to the job through the "JobFlex job" field, the invoice PDF
// attached, and Ramp pays it (ACH to the vendor's bank, or a check) on the due date. Two doors, the contractor's
// choice: a DRAFT that lands in Ramp's inbox for a person to approve there (the default — nothing moves on a typo),
// or an APPROVED bill Ramp pays on its own (the `billsApproved` switch). Either way the bill is remembered in
// SyncState `rampBill:<org>:<id>`; when Ramp says it is paid (webhook bills.paid, or the hourly look), the money
// becomes the job's expense with the invoice as its receipt — once, never twice.
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { ExpensePaidBy, ExpenseStatus } from "@/lib/prismaEnums";
import { putPrivate } from "@/lib/media/privateStore";
import { patchRampConnection, rampApiFor, type RampConnection } from "./connection";
import type { RampApi, RampBill, RampVendor } from "./client";
import { BILL_STATE_WORDS, RAMP_FIELD_ID, RAMP_STOCK_OPTION_ID, billInputError, money, parseAddressLine, rampBillState, rampMoneyObject, toCents, type RampBillState } from "./shared";

const billKey = (org: string, id: string) => `rampBill:${org}:${id}`;
const INVOICE_MAX_BYTES = 10 * 1024 * 1024;

/** What JobFlex remembers of one bill it sent to Ramp. */
export interface RampBillRecord {
  billId: string;
  /** The draft's id when the bill began as a draft (it keeps that id until Ramp makes the bill). */
  draftId: string | null;
  vendorId: string;
  vendorName: string;
  invoiceNumber: string;
  amount: number;
  issuedAt: string;
  dueAt: string;
  memo: string;
  jobId: string | null;
  jobTitle: string | null;
  stock: boolean;
  category: string;
  /** "ACH" | "CHECK" | "DEFAULT" — how Ramp was asked to pay; "APPROVAL" when it went in as a draft. */
  payBy: string;
  state: RampBillState;
  stateWords: string;
  invoiceUrl: string | null;
  invoiceAttached: boolean;
  deepLink: string | null;
  createdAt: string;
  createdBy: string;
  expenseId: string | null;
  paidAt: string | null;
  lastCheckedAt: string | null;
  note: string | null;
}

async function readBill(org: string, id: string): Promise<RampBillRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: billKey(org, id) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as RampBillRecord;
  } catch {
    return null;
  }
}
async function writeBill(org: string, rec: RampBillRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({ where: { key: billKey(org, rec.billId) }, create: { key: billKey(org, rec.billId), cursor }, update: { cursor } });
}

/* ── what the form needs ───────────────────────────────────────────────── */

export interface RampBillPaySetup {
  ready: boolean;
  /** Why bills cannot be paid yet (no entity with a bill-pay bank account). */
  why: string | null;
  entityName: string;
  billsApproved: boolean;
  vendors: Array<{ id: string; name: string; hasAddress: boolean }>;
}

/** The paying entity and its bill-pay bank account, found once and remembered on the connection. */
async function billPayEntity(organizationId: string, api: RampApi, conn: RampConnection): Promise<{ entityId: string; sourceBankAccountId: string | null; entityName: string } | null> {
  if (conn.entityId) return { entityId: conn.entityId, sourceBankAccountId: conn.sourceBankAccountId, entityName: "" };
  const entities = await api.entities().catch(() => []);
  if (!entities.length) return null;
  const pick = entities.find((e) => e.is_primary) ?? entities.find((e) => e.default_bill_pay_payment_account_id || e.payment_accounts?.length) ?? entities[0];
  const sourceBankAccountId = pick.default_bill_pay_payment_account_id ?? pick.payment_accounts?.[0]?.id ?? pick.accounts?.find((a) => a.usage_type === "BILL_PAY_BANK_ACCOUNT")?.bank_account_id ?? null;
  await patchRampConnection(organizationId, { entityId: pick.id, sourceBankAccountId });
  return { entityId: pick.id, sourceBankAccountId, entityName: pick.entity_name ?? "" };
}

export async function rampBillPaySetup(organizationId: string): Promise<RampBillPaySetup> {
  const got = await rampApiFor(organizationId);
  if (!got) return { ready: false, why: "Ramp is not connected.", entityName: "", billsApproved: false, vendors: [] };
  const { api, conn } = got;
  const [entity, vendors] = await Promise.all([billPayEntity(organizationId, api, conn).catch(() => null), api.vendors().catch(() => [] as RampVendor[])]);
  const list = vendors
    .filter((v) => v.is_active !== false)
    .map((v) => ({ id: v.id, name: (v.display_name || v.name || "").trim() || "Vendor", hasAddress: !!(v.address || v.addresses?.length) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entity) return { ready: false, why: "Ramp returned no business entity to pay from — finish Bill Pay setup in Ramp (a bank account under Bill Pay), then try again.", entityName: "", billsApproved: conn.billsApproved, vendors: list };
  if (conn.billsApproved && !entity.sourceBankAccountId) return { ready: false, why: "Ramp has no bill-pay bank account on this business yet — add one under Bill Pay in Ramp, or switch bills to Ramp's inbox for approval.", entityName: entity.entityName, billsApproved: true, vendors: list };
  return { ready: true, why: null, entityName: entity.entityName, billsApproved: conn.billsApproved, vendors: list };
}

/* ── making the bill ───────────────────────────────────────────────────── */

export interface RampBillInput {
  vendorId: string | null;
  vendorName: string | null;
  vendorEmail: string | null;
  invoiceNumber: string;
  amount: number;
  /** YYYY-MM-DD. */
  issuedAt: string;
  dueAt: string;
  memo: string;
  category: string;
  to: { kind: "job"; jobId: string } | { kind: "stock" } | { kind: "none" };
  /** The invoice file as a data URL (PDF reaches Ramp; a picture stays in JobFlex). */
  invoice: { dataUrl: string; filename: string } | null;
}

function decodeDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim());
  if (!m) return null;
  const contentType = (m[1] || "application/octet-stream").toLowerCase();
  const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  if (!bytes.byteLength || bytes.byteLength > INVOICE_MAX_BYTES) return null;
  return { bytes, contentType };
}

/** The vendor: the one picked, or a new one Ramp makes and asks for its bank details by email. */
async function vendorFor(api: RampApi, input: RampBillInput, entityId: string, orgName: string): Promise<{ id: string; name: string; hasAddress: boolean }> {
  if (input.vendorId) {
    const v = (await api.vendors().catch(() => [] as RampVendor[])).find((x) => x.id === input.vendorId);
    if (!v) throw new Error("That vendor is not in your Ramp any more.");
    return { id: v.id, name: (v.display_name || v.name || "Vendor").trim(), hasAddress: !!(v.address || v.addresses?.length) };
  }
  const name = (input.vendorName ?? "").trim().slice(0, 120);
  const email = (input.vendorEmail ?? "").trim().toLowerCase();
  const made = await api.createVendor({ name, business_vendor_contacts: { email }, request_payment_details: true, default_entity_id: entityId, country: "US", external_vendor_id: `jobflex-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Date.now().toString(36)}` });
  return { id: made.id, name: (made.display_name || made.name || name).trim(), hasAddress: !!(made.address || made.addresses?.length) };
}

/** How Ramp should pay: ACH when the vendor has a bank account on file, a check when it has an address, else Ramp's default (it asks the vendor). */
async function paymentFor(api: RampApi, vendor: { id: string; hasAddress: boolean }, sourceBankAccountId: string | null, dueAt: string): Promise<{ payBy: "ACH" | "CHECK" | "DEFAULT"; fields: Record<string, unknown> }> {
  const accounts = await api.vendorAccounts(vendor.id).catch(() => []);
  const ach = accounts.find((a) => a.is_default && (a.payment_method ?? "ACH") === "ACH") ?? accounts.find((a) => (a.payment_method ?? "ACH") === "ACH") ?? null;
  if (ach && sourceBankAccountId) return { payBy: "ACH", fields: { payment_method: "ACH", payment_details: { payment_arrival_date: dueAt, source_bank_account_id: sourceBankAccountId, vendor_account_id: ach.id } } };
  if (vendor.hasAddress && sourceBankAccountId) return { payBy: "CHECK", fields: { payment_method: "CHECK", payment_details: { payment_arrival_date: dueAt, source_bank_account_id: sourceBankAccountId } } };
  return { payBy: "DEFAULT", fields: { use_default_payment_method: true } };
}

/** The bill made in Ramp — a draft for approval there, or an approved bill Ramp pays — coded to the job, the invoice attached, remembered here. */
export async function createRampBill(organizationId: string, input: RampBillInput, by: { userId: string | null; name: string }): Promise<{ ok: true; bill: RampBillRecord; warning: string | null } | { ok: false; error: string }> {
  const bad = billInputError(input);
  if (bad) return { ok: false, error: bad };
  const got = await rampApiFor(organizationId);
  if (!got) return { ok: false, error: "Ramp is not connected." };
  const { api, conn } = got;
  const [org, job] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    input.to.kind === "job" ? db.job.findFirst({ where: { id: input.to.jobId, organizationId }, select: { id: true, title: true, proposalId: true, clientId: true } }) : Promise.resolve(null),
  ]);
  if (input.to.kind === "job" && !job) return { ok: false, error: "That job is not in this company." };
  const entity = await billPayEntity(organizationId, api, conn).catch(() => null);
  if (!entity) return { ok: false, error: "Ramp returned no business entity to pay from — finish Bill Pay setup in Ramp first." };
  const amount = Math.round(input.amount * 100) / 100;
  const memo = input.memo.trim().slice(0, 300);
  const invoiceNumber = input.invoiceNumber.trim().slice(0, 60);
  const warnings: string[] = [];

  let vendor: { id: string; name: string; hasAddress: boolean };
  try {
    vendor = await vendorFor(api, input, entity.entityId, org?.name ?? "jobflex");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ramp did not make the vendor." };
  }

  // The invoice: kept in JobFlex either way (the expense's receipt later); sent to Ramp when it is a PDF.
  let invoiceUrl: string | null = null;
  let invoiceFile: { bytes: Buffer; filename: string; contentType: string } | null = null;
  if (input.invoice) {
    const dec = decodeDataUrl(input.invoice.dataUrl);
    if (!dec) warnings.push("The invoice file could not be read (10 MB at most) — the bill went without it.");
    else {
      const isPdf = dec.contentType === "application/pdf";
      const isImage = /^image\/(jpeg|png|webp|heic|heif)$/.test(dec.contentType);
      if (!isPdf && !isImage) warnings.push("Only a PDF or a picture can be the invoice — the bill went without the file.");
      else {
        const ext = isPdf ? "pdf" : dec.contentType.split("/")[1].replace("jpeg", "jpg");
        const folder = job ? job.id : "company";
        const put = await putPrivate(`receipts/${folder}/ramp-bill-${Date.now().toString(36)}.${ext}`, dec.bytes, dec.contentType).catch(() => null);
        invoiceUrl = put?.url ?? null;
        if (isPdf) invoiceFile = { bytes: dec.bytes, filename: input.invoice.filename.replace(/[^\w.-]+/g, "_").slice(0, 80) || "invoice.pdf", contentType: dec.contentType };
        else warnings.push("Ramp takes invoices as PDF only — the picture is kept on the job's expense in JobFlex, not in Ramp.");
      }
    }
  }

  const coding = conn.fieldRampId && input.to.kind !== "none" ? [{ field_external_id: RAMP_FIELD_ID, field_option_external_id: input.to.kind === "job" ? input.to.jobId : RAMP_STOCK_OPTION_ID }] : [];
  const lineMemo = job ? `JobFlex: ${job.title} (${job.id})` : input.to.kind === "stock" ? "JobFlex: stock" : "JobFlex";
  const base: Record<string, unknown> = {
    entity_id: entity.entityId,
    vendor_id: vendor.id,
    invoice_number: invoiceNumber,
    issued_at: input.issuedAt,
    due_at: input.dueAt,
    invoice_currency: "USD",
    memo: memo || lineMemo,
    accounting_field_selections: coding,
    line_items: [{ amount: toCents(amount), memo: lineMemo, accounting_field_selections: coding }],
    remote_id: `jobflex-${organizationId.slice(-8)}-${Date.now().toString(36)}`,
  };

  let bill: RampBill | null = null;
  let draftId: string | null = null;
  let payBy = "APPROVAL";
  let state: RampBillState = "draft";
  try {
    if (conn.billsApproved && entity.sourceBankAccountId) {
      const pay = await paymentFor(api, vendor, entity.sourceBankAccountId, input.dueAt);
      payBy = pay.payBy;
      if (pay.payBy === "DEFAULT") warnings.push("The vendor has no bank account or address in Ramp yet — Ramp will ask them and pay by its default method once it has the details.");
      bill = await api.createBill({ ...base, ...pay.fields });
      state = rampBillState(bill as unknown as Record<string, unknown>);
    } else {
      const draft = await api.createDraftBill({ ...base, use_default_payment_method: true });
      draftId = draft.id;
      // Submitted, the draft is in the approval queue; a submit Ramp refuses leaves it in the inbox as a plain draft.
      bill = await api.submitDraftBill(draft.id).catch(() => null);
      state = bill ? rampBillState(bill as unknown as Record<string, unknown>) : "draft";
      if (!bill) warnings.push("The bill is in Ramp's inbox as a draft — someone finishes and approves it there.");
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ramp did not make the bill." };
  }
  const billId = bill?.id ?? draftId ?? "";
  if (!billId) return { ok: false, error: "Ramp returned no bill id." };

  // The read-back is the check on the units: a bill Ramp read as 100× the money is corrected before anything pays.
  const readBack = bill?.amount ? rampMoneyObject(bill.amount) : null;
  if (readBack !== null && Math.abs(readBack - amount) > 0.011) warnings.push(`Ramp shows the bill as ${money(readBack)} — open it in Ramp before it pays.`);

  let invoiceAttached = false;
  if (invoiceFile) {
    const target = bill ? bill.id : draftId!;
    invoiceAttached = !!(await api.uploadBillAttachment(target, invoiceFile, "INVOICE", !bill).catch(() => null));
    if (!invoiceAttached) warnings.push("Ramp did not take the invoice PDF — attach it there; it is on the job in JobFlex.");
  }

  const rec: RampBillRecord = {
    billId,
    draftId,
    vendorId: vendor.id,
    vendorName: vendor.name,
    invoiceNumber,
    amount,
    issuedAt: input.issuedAt,
    dueAt: input.dueAt,
    memo,
    jobId: job?.id ?? null,
    jobTitle: job?.title ?? null,
    stock: input.to.kind === "stock",
    category: input.category.trim().slice(0, 40) || "Materials",
    payBy,
    state,
    stateWords: BILL_STATE_WORDS[state],
    invoiceUrl,
    invoiceAttached,
    deepLink: bill?.deep_link_url ?? null,
    createdAt: new Date().toISOString(),
    createdBy: by.name,
    expenseId: null,
    paidAt: null,
    lastCheckedAt: new Date().toISOString(),
    note: warnings[0] ?? null,
  };
  await writeBill(organizationId, rec);
  await logActivity({
    organizationId,
    actorId: by.userId,
    kind: TRAIL_KINDS.EXPENSE,
    summary: `Ramp bill: ${money(amount)} to ${vendor.name} (#${invoiceNumber}) ${job ? `on ${job.title}` : rec.stock ? "for stock" : ""} — ${payBy === "APPROVAL" ? "sent to Ramp for approval" : `Ramp pays by ${payBy === "DEFAULT" ? "its default method" : payBy}`}${rec.dueAt ? `, due ${rec.dueAt}` : ""}`,
    proposalId: job?.proposalId ?? null,
    clientId: job?.clientId ?? null,
    meta: { jobId: job?.id ?? null, amount, source: "ramp-bill", rampBillId: billId, vendor: vendor.name, payBy },
  });
  if (state === "paid") await bookPaidBill(organizationId, conn, rec, bill);
  return { ok: true, bill: (await readBill(organizationId, billId)) ?? rec, warning: warnings.length ? warnings.join(" ") : null };
}

/* ── when Ramp pays ────────────────────────────────────────────────────── */

/** The paid bill written as the job's expense, with the invoice as its receipt; the trail says so. Once. */
async function bookPaidBill(organizationId: string, conn: RampConnection, rec: RampBillRecord, bill: RampBill | null): Promise<RampBillRecord> {
  if (rec.expenseId) return rec;
  const now = new Date();
  const paidAt = bill?.paid_at ? new Date(bill.paid_at) : now;
  const payWords = bill?.payment?.payment_method ?? rec.payBy;
  const job = rec.jobId ? await db.job.findFirst({ where: { id: rec.jobId, organizationId }, select: { id: true, title: true, proposalId: true, clientId: true } }) : null;
  const row = await db.jobExpense.create({
    data: {
      jobId: job?.id ?? null,
      organizationId,
      submittedById: conn.actorId || null,
      category: rec.category,
      amount: rec.amount,
      note: `Ramp bill · ${rec.vendorName} · #${rec.invoiceNumber}${payWords && payWords !== "APPROVAL" ? ` · paid by ${payWords}` : " · paid"}`,
      receiptUrl: rec.invoiceUrl,
      vendor: rec.vendorName,
      spentAt: paidAt,
      paidBy: ExpensePaidBy.COMPANY,
      status: ExpenseStatus.APPROVED,
      reviewedById: conn.actorId || null,
      reviewedAt: now,
    },
  });
  await logActivity({
    organizationId,
    actorId: conn.actorId || null,
    kind: TRAIL_KINDS.EXPENSE,
    summary: `Ramp paid ${money(rec.amount)} to ${rec.vendorName} (#${rec.invoiceNumber})${job ? ` — on ${job.title}` : rec.stock ? " — stock" : ""}${rec.invoiceUrl ? " (invoice attached)" : ""}`,
    proposalId: job?.proposalId ?? null,
    clientId: job?.clientId ?? null,
    meta: { jobId: job?.id ?? null, expenseId: row.id, amount: rec.amount, source: "ramp-bill", rampBillId: rec.billId },
  });
  const next: RampBillRecord = { ...rec, expenseId: row.id, paidAt: paidAt.toISOString(), state: "paid", stateWords: BILL_STATE_WORDS.paid };
  await writeBill(organizationId, next);
  return next;
}

/** One bill read again from Ramp: its state refreshed; booked the moment it is paid. */
export async function refreshRampBill(organizationId: string, billId: string): Promise<RampBillRecord | null> {
  const rec = await readBill(organizationId, billId);
  if (!rec) return null;
  const got = await rampApiFor(organizationId);
  if (!got) return rec;
  const { api, conn } = got;
  let bill: RampBill | null = await api.bill(rec.billId).catch(() => null);
  let state: RampBillState;
  if (!bill && rec.draftId) {
    // Still a draft in Ramp's inbox, or a bill by now? The draft says when it became one.
    const draft = await api.draftBill(rec.draftId).catch(() => null);
    const madeId = draft && typeof draft.bill_id === "string" ? draft.bill_id : null;
    if (madeId) {
      bill = await api.bill(madeId).catch(() => null);
      if (bill) {
        await db.syncState.deleteMany({ where: { key: billKey(organizationId, rec.billId) } }).catch(() => null);
        rec.billId = madeId;
      }
    }
    state = bill ? rampBillState(bill as unknown as Record<string, unknown>) : draft ? "draft" : rec.state;
  } else state = bill ? rampBillState(bill as unknown as Record<string, unknown>) : rec.state;
  let next: RampBillRecord = { ...rec, state, stateWords: BILL_STATE_WORDS[state], deepLink: bill?.deep_link_url ?? rec.deepLink, lastCheckedAt: new Date().toISOString(), invoiceAttached: rec.invoiceAttached || !!bill?.attachments?.some((a) => a.attachment_type === "INVOICE") };
  if (bill?.amount) {
    const shown = rampMoneyObject(bill.amount);
    if (Math.abs(shown - rec.amount) > 0.011 && !rec.expenseId) next = { ...next, amount: shown, note: `Ramp changed the amount to ${money(shown)}.` };
  }
  await writeBill(organizationId, next);
  if (state === "paid" && !next.expenseId) next = await bookPaidBill(organizationId, conn, next, bill);
  return next;
}

/** Every bill not yet settled, looked at again (the hourly sync and "Sync now"). */
export async function refreshOpenRampBills(organizationId: string, max = 60): Promise<number> {
  const all = await rampBills(organizationId, 400);
  const open = all.filter((b) => !b.expenseId && !["paid", "rejected", "archived"].includes(b.state)).slice(0, max);
  let paid = 0;
  for (const b of open) {
    const r = await refreshRampBill(organizationId, b.billId).catch(() => null);
    if (r?.state === "paid") paid += 1;
  }
  return paid;
}

/** The bills JobFlex sent, newest first. */
export async function rampBills(organizationId: string, max = 80): Promise<RampBillRecord[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: `rampBill:${organizationId}:` } }, select: { cursor: true }, orderBy: { updatedAt: "desc" }, take: max }).catch(() => []);
  const out: RampBillRecord[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.cursor) as RampBillRecord);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The company's own address, for a vendor made with a check address or a card shipped to the shop. */
export async function companyAddress(organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true, name: true } }).catch(() => null);
  return { name: org?.name ?? "", parsed: parseAddressLine(org?.address ?? null), raw: org?.address ?? "" };
}
