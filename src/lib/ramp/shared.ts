// RAMP CARDS ON JOBFLEX — the pure part (owner, 2026-10-29: "build it for JobFlex, make it smart, same as
// ServiceTitan"). Every swipe on a contractor's Ramp card lands on the job it was for, with the receipt, the
// moment it happens: the tech is asked the job (Ramp's own prompt through our "JobFlex job" field, or a text from
// the company's line), the expense is written on the job's ledger, and the office sees margin while the job runs.
//
// No I/O here: what a Ramp transaction says, which JobFlex job it names, the category it maps to, the text that asks
// the tech, the reply that answers it. qa/tests/logic/ramp.check.ts proves every rule.

/** The custom accounting field JobFlex keeps in the contractor's Ramp: its own id, so the same field is found again. */
export const RAMP_FIELD_ID = "jobflex_job";
export const RAMP_FIELD_NAME = "JobFlex job";
/** Options for a job that is neither a job nor nothing: the warehouse. */
export const RAMP_STOCK_OPTION_ID = "jobflex_stock";
export const RAMP_STOCK_OPTION_VALUE = "Stock / warehouse (no job)";
/** How long a "which job?" text waits for its answer. */
export const ASK_TTL_MS = 48 * 60 * 60_000;
/** Jobs offered in a text: the newest open ones. */
export const ASK_MAX_OPTIONS = 6;

/** A Ramp transaction, the fields JobFlex reads (the API's names). */
export interface RampTransaction {
  id: string;
  state?: string | null;
  amount?: number | null;
  entity_amount?: { value: number; currency?: string } | null;
  currency_code?: string | null;
  merchant_name?: string | null;
  merchant_descriptor?: string | null;
  merchant_category_code_description?: string | null;
  sk_category_name?: string | null;
  sk_category_id?: string | null;
  user_transaction_time?: string | null;
  settlement_date?: string | null;
  memo?: string | null;
  receipts?: string[] | null;
  card_holder?: { user_id?: string; first_name?: string; last_name?: string } | null;
  card_id?: string | null;
  accounting_field_selections?: Array<{
    id?: string;
    external_id?: string;
    name?: string;
    display_name?: string | null;
    type?: string;
    category_info?: { id?: string; external_id?: string; name?: string; type?: string };
  }> | null;
  synced_at?: string | null;
  /** A split: each line with its own amount (minor units with a conversion rate, else dollars) and coding. */
  line_items?: Array<{
    id?: string;
    memo?: string | null;
    amount?: { amount?: number; currency_code?: string; minor_unit_conversion_rate?: number | null } | number | null;
    converted_amount?: { amount?: number; currency_code?: string; minor_unit_conversion_rate?: number | null } | null;
    accounting_field_selections?: RampTransaction["accounting_field_selections"];
  }> | null;
}

export type RampTxState = "cleared" | "pending" | "declined" | "other";
export function rampTxState(tx: Pick<RampTransaction, "state">): RampTxState {
  const s = (tx.state ?? "").toUpperCase();
  if (s === "CLEARED") return "cleared";
  if (s === "PENDING") return "pending";
  if (s === "DECLINED") return "declined";
  return s ? "other" : "pending";
}

/** The dollars, signed (a refund is negative): the settlement amount, else the deprecated one. */
export function rampAmount(tx: Pick<RampTransaction, "amount" | "entity_amount">): number {
  const v = tx.entity_amount && typeof tx.entity_amount.value === "number" ? tx.entity_amount.value : typeof tx.amount === "number" ? tx.amount : 0;
  return Math.round(v * 100) / 100;
}

export function rampMerchant(tx: Pick<RampTransaction, "merchant_name" | "merchant_descriptor">): string {
  return (tx.merchant_name || tx.merchant_descriptor || "a merchant").trim().slice(0, 120);
}

export function rampCardholderName(tx: Pick<RampTransaction, "card_holder">): string {
  const h = tx.card_holder;
  return [h?.first_name, h?.last_name].filter(Boolean).join(" ").trim();
}

export function rampSpentAt(tx: Pick<RampTransaction, "user_transaction_time" | "settlement_date">): Date | null {
  const t = Date.parse(tx.user_transaction_time ?? tx.settlement_date ?? "");
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The JobFlex job a transaction is tagged with: the option of our field (its external id is the job's id), or
 * "stock" for the warehouse option, or null. A memo "JobFlex: <id>" written by us counts too.
 */
export function rampJobTag(tx: Pick<RampTransaction, "accounting_field_selections" | "memo">, fieldRampId: string | null): { kind: "job"; jobId: string } | { kind: "stock" } | null {
  for (const s of tx.accounting_field_selections ?? []) {
    const ours = (fieldRampId && s.category_info?.id === fieldRampId) || s.category_info?.external_id === RAMP_FIELD_ID || s.category_info?.name === RAMP_FIELD_NAME;
    if (!ours) continue;
    const ext = (s.external_id ?? "").trim();
    if (ext === RAMP_STOCK_OPTION_ID) return { kind: "stock" };
    if (ext) return { kind: "job", jobId: ext };
  }
  const m = /JobFlex:\s*(stock|[A-Za-z0-9_-]{8,40})\b/i.exec(tx.memo ?? "");
  if (m) return m[1].toLowerCase() === "stock" ? { kind: "stock" } : { kind: "job", jobId: m[1] };
  return null;
}

/** The expense category JobFlex books, from Ramp's category and the merchant. */
export function rampCategory(tx: Pick<RampTransaction, "sk_category_name" | "merchant_category_code_description" | "merchant_name">): string {
  const words = `${tx.sk_category_name ?? ""} ${tx.merchant_category_code_description ?? ""} ${tx.merchant_name ?? ""}`.toLowerCase();
  if (/gas|fuel|petrol|chevron|shell|exxon|arco|76\b|mobil/.test(words)) return "Fuel";
  if (/rental|rent-a|sunbelt|united rentals|herc/.test(words)) return "Equipment rental";
  if (/permit|government|county|city of|municipal|inspection/.test(words)) return "Permits";
  if (/restaurant|food|meal|coffee|cafe|dining|fast food/.test(words)) return "Meals";
  if (/dump|disposal|waste|landfill|transfer station/.test(words)) return "Disposal";
  if (/tool|harbor freight|milwaukee|dewalt|makita/.test(words)) return "Tools";
  if (/hardware|home improvement|lumber|building|supply|depot|lowe|menards|ferguson|abc supply|srs|beacon|electrical|plumbing|roofing|concrete|paint/.test(words)) return "Materials";
  if (/parking|toll/.test(words)) return "Travel";
  return "Materials";
}

/** One line for the expense: where, who, and that it came off the card. */
export function rampExpenseNote(tx: Pick<RampTransaction, "merchant_name" | "merchant_descriptor" | "card_holder" | "sk_category_name">): string {
  const who = rampCardholderName(tx);
  return `Ramp card · ${rampMerchant(tx)}${who ? ` · ${who}` : ""}${tx.sk_category_name ? ` · ${tx.sk_category_name}` : ""}`.slice(0, 2000);
}

export interface JobOption {
  jobId: string;
  title: string;
  /** "Smith roof · 12 Oak St", what Ramp's field and the text show. */
  value: string;
}

/** The option's words: the job's title, the client's name or the street — within Ramp's field limits. */
export function jobOptionValue(job: { title: string; clientName?: string | null; address?: string | null }): string {
  const parts = [job.title.trim()];
  const extra = (job.clientName ?? job.address ?? "").trim();
  if (extra && !job.title.toLowerCase().includes(extra.toLowerCase())) parts.push(extra);
  return parts.join(" · ").slice(0, 80);
}

export const money = (n: number): string => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The text that asks the tech which job a swipe was for. */
export function askText(company: string, tx: Pick<RampTransaction, "amount" | "entity_amount" | "merchant_name" | "merchant_descriptor">, options: readonly JobOption[]): string {
  const lines = options.slice(0, ASK_MAX_OPTIONS).map((o, i) => `${i + 1} ${o.title.slice(0, 40)}`);
  return `${company}: ${money(rampAmount(tx))} at ${rampMerchant(tx)} on the Ramp card — which job? Reply ${lines.join(" · ")} · S stock. Or the job's name.`.slice(0, 480);
}

export type JobReply = { kind: "job"; jobId: string } | { kind: "stock" } | { kind: "none" } | null;
const REPLY_STOP_WORDS = new Set(["the", "job", "for", "one", "that", "this", "was", "its", "it's", "and", "our", "yes", "please", "thanks"]);

/** The tech's answer: a number from the list, S/stock for the warehouse, "none" to leave it, or enough of a job's name. */
export function parseJobReply(body: string, options: readonly JobOption[]): JobReply {
  const t = body.trim().toLowerCase().replace(/[.!]+$/, "");
  if (!t) return null;
  if (/^(s|stock|warehouse|shop|inventory)$/.test(t)) return { kind: "stock" };
  if (/^(none|no|skip|n\/a|later)$/.test(t)) return { kind: "none" };
  const n = /^#?(\d{1,2})$/.exec(t);
  if (n) {
    const o = options[Number(n[1]) - 1];
    return o ? { kind: "job", jobId: o.jobId } : null;
  }
  const hits = options.filter((o) => o.value.toLowerCase().includes(t) || o.title.toLowerCase().includes(t) || t.includes(o.title.toLowerCase()));
  if (hits.length === 1) return { kind: "job", jobId: hits[0].jobId };
  // Every telling word of the reply inside one option's words, and only one.
  const words = t.split(/\s+/).filter((w) => w.length > 2 && !REPLY_STOP_WORDS.has(w));
  if (words.length) {
    const byWords = options.filter((o) => words.every((w) => o.value.toLowerCase().includes(w)));
    if (byWords.length === 1) return { kind: "job", jobId: byWords[0].jobId };
  }
  return null;
}

/** What the tech reads back. */
export function confirmText(tx: Pick<RampTransaction, "amount" | "entity_amount" | "merchant_name" | "merchant_descriptor">, where: string): string {
  return `Got it — ${money(rampAmount(tx))} at ${rampMerchant(tx)} is on ${where}. Snap the receipt to Ramp if you haven't.`;
}

/** The webhook's signature: HMAC-SHA256 of the raw body with the subscription's secret, hex or base64. */
export function rampSignatureMatches(raw: string, secret: string, header: string | null, hmacHex: (secret: string, raw: string) => string, hmacB64: (secret: string, raw: string) => string): boolean {
  if (!header || !secret) return false;
  const given = header.trim().replace(/^(sha256=|v1=)/i, "");
  const hex = hmacHex(secret, raw);
  const b64 = hmacB64(secret, raw);
  return timingSafeEqualStr(given, hex) || timingSafeEqualStr(given, b64) || timingSafeEqualStr(given.toLowerCase(), hex);
}
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** The event's transaction id, wherever the payload keeps it. */
export function rampEventTransactionId(payload: unknown): string | null {
  const p = payload as { object?: { id?: string; transaction_id?: string; resource_id?: string } | null; data?: { id?: string } } | null;
  const o = p?.object;
  return o?.transaction_id ?? o?.id ?? o?.resource_id ?? p?.data?.id ?? null;
}

/* ── splits ─────────────────────────────────────────────────────────────── */

export interface RampLinePart {
  amount: number;
  tag: { kind: "job"; jobId: string } | { kind: "stock" } | null;
  memo: string;
}

/** The dollars of one line's amount object: minor units over the rate when a rate is given, else as written. */
function lineDollars(a: { amount?: number; minor_unit_conversion_rate?: number | null } | number | null | undefined): number | null {
  if (typeof a === "number") return Math.round(a * 100) / 100;
  if (!a || typeof a.amount !== "number") return null;
  const rate = typeof a.minor_unit_conversion_rate === "number" && a.minor_unit_conversion_rate > 0 ? a.minor_unit_conversion_rate : null;
  return Math.round((rate ? a.amount / rate : a.amount) * 100) / 100;
}

/**
 * A transaction split in Ramp into two or more lines: each line's dollars and job tag. Lines come back in dollars
 * or in cents (minor units with a rate, or none at all); whichever reading sums to the transaction's amount wins.
 * One line, or lines that fit neither way, is no split.
 */
export function rampLineParts(tx: RampTransaction, fieldRampId: string | null): RampLinePart[] {
  const lines = tx.line_items ?? [];
  if (lines.length < 2) return [];
  const total = rampAmount(tx);
  const asRead = lines.map((l) => lineDollars(l.amount ?? l.converted_amount ?? null));
  if (asRead.some((v) => v === null)) return [];
  const read = asRead as number[];
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.02 * Math.max(1, lines.length / 2);
  const amounts = close(sum(read), total) ? read : close(sum(read.map((v) => v / 100)), total) ? read.map((v) => Math.round(v) / 100) : null;
  if (!amounts) return [];
  return lines.map((l, i) => ({ amount: amounts[i], tag: rampJobTag({ accounting_field_selections: l.accounting_field_selections ?? [], memo: l.memo ?? null }, fieldRampId), memo: (l.memo ?? "").trim().slice(0, 120) }));
}

export interface SplitPart {
  to: { kind: "job"; jobId: string } | { kind: "stock" };
  amount: number;
}
/** A split the office typed: two or more parts, each over zero, summing to the swipe within a cent. */
export function splitPlanError(total: number, parts: readonly SplitPart[]): string | null {
  if (parts.length < 2) return "A split needs at least two parts.";
  if (parts.some((p) => !Number.isFinite(p.amount) || Math.abs(p.amount) < 0.01)) return "Every part needs an amount.";
  if (parts.some((p) => Math.sign(p.amount) !== Math.sign(total))) return "Every part must go the same way as the swipe.";
  const sum = Math.round(parts.reduce((a, p) => a + p.amount, 0) * 100) / 100;
  if (Math.abs(sum - Math.round(total * 100) / 100) > 0.011) return `The parts add up to ${money(sum)}, not the swipe's ${money(total)}.`;
  const seen = new Set<string>();
  for (const p of parts) {
    const key = p.to.kind === "job" ? p.to.jobId : "stock";
    if (seen.has(key)) return "The same job twice — merge the two amounts.";
    seen.add(key);
  }
  return null;
}
export const toCents = (dollars: number): number => Math.round(dollars * 100);

/* ── addresses (a card ships somewhere; a check goes somewhere) ──────────── */

export interface PostalAddress {
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}
/** "100 Main St, Kirkland, WA 98033" → its parts; null when the line does not read as a US address. */
export function parseAddressLine(line: string | null | undefined): PostalAddress | null {
  const t = (line ?? "").replace(/\s+/g, " ").trim().replace(/,?\s*(USA|United States|US)$/i, "");
  const m = /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/.exec(t);
  if (!m) return null;
  const streetParts = m[1].split(",").map((x) => x.trim()).filter(Boolean);
  return { address1: streetParts[0], address2: streetParts.slice(1).join(", ") || null, city: m[2].trim(), state: m[3].toUpperCase(), postal_code: m[4], country: "US" };
}

/* ── bills ──────────────────────────────────────────────────────────────── */

export type RampBillState = "paid" | "scheduled" | "approved" | "pending" | "needs-details" | "rejected" | "archived" | "draft" | "error";
/** Where a bill stands, from the bill object: paid, waiting for approval, scheduled, missing the vendor's bank details… */
export function rampBillState(bill: Record<string, unknown> | null | undefined): RampBillState {
  if (!bill) return "pending";
  const b = bill as { archived_at?: string | null; approval_status?: string | null; status?: string | null; status_summary?: string | null; paid_at?: string | null; draft?: boolean };
  if (b.draft) return "draft";
  if (b.archived_at) return "archived";
  const sum = (b.status_summary ?? "").toUpperCase();
  if (b.paid_at || (b.status ?? "").toUpperCase() === "PAID" || sum === "PAYMENT_COMPLETED") return "paid";
  if (sum === "APPROVAL_REJECTED" || (b.approval_status ?? "").toUpperCase() === "REJECTED" || (b.approval_status ?? "").toUpperCase() === "TERMINATED") return "rejected";
  if (sum === "ARCHIVED") return "archived";
  if (sum === "PAYMENT_ERROR" || sum === "BLOCKED") return "error";
  if (sum === "PAYMENT_DETAILS_MISSING" || sum === "WAITING_FOR_VENDOR" || sum === "PENDING_VENDOR_APPROVAL") return "needs-details";
  if (sum === "PAYMENT_SCHEDULED" || sum === "PAYMENT_PROCESSING" || sum === "AWAITING_RELEASE" || sum === "PAYMENT_READY") return "scheduled";
  if (sum === "APPROVAL_PENDING" || (b.approval_status ?? "").toUpperCase() === "PENDING" || (b.approval_status ?? "").toUpperCase() === "INITIALIZED") return "pending";
  if ((b.approval_status ?? "").toUpperCase() === "APPROVED") return "approved";
  return "pending";
}
export const BILL_STATE_WORDS: Record<RampBillState, string> = {
  paid: "Paid",
  scheduled: "Payment scheduled",
  approved: "Approved · waiting to pay",
  pending: "Waiting for approval in Ramp",
  "needs-details": "Ramp needs the vendor's payment details",
  rejected: "Rejected in Ramp",
  archived: "Archived",
  draft: "Draft in Ramp's inbox",
  error: "Payment problem — open it in Ramp",
};
/** Dollars from a Ramp amount object (minor units over the rate; cents when no rate is given). */
export function rampMoneyObject(a: { amount?: number | null; minor_unit_conversion_rate?: number | null } | null | undefined): number {
  if (!a || typeof a.amount !== "number") return 0;
  const rate = typeof a.minor_unit_conversion_rate === "number" && a.minor_unit_conversion_rate > 0 ? a.minor_unit_conversion_rate : 100;
  return Math.round((a.amount / rate) * 100) / 100;
}
/** What the office typed for a bill, checked: a vendor, an invoice number, a positive amount, dates in order. */
export function billInputError(b: { vendorId?: string | null; vendorName?: string | null; vendorEmail?: string | null; invoiceNumber: string; amount: number; issuedAt: string; dueAt: string }): string | null {
  if (!b.vendorId && !(b.vendorName ?? "").trim()) return "Name the vendor.";
  if (!b.vendorId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((b.vendorEmail ?? "").trim())) return "A new vendor needs an email — Ramp asks them for their bank details there.";
  if (!b.invoiceNumber.trim()) return "Type the invoice number.";
  if (!Number.isFinite(b.amount) || b.amount < 0.01) return "Type the amount.";
  if (b.amount > 1_000_000) return "That amount is over the $1,000,000 ceiling.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.issuedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueAt)) return "Pick the invoice date and the due date.";
  if (b.dueAt < b.issuedAt) return "The due date is before the invoice date.";
  return null;
}
/** A monthly card limit the office typed: whole dollars, $50 to $100,000. */
export function cardLimitError(monthly: number, perPurchase: number | null): string | null {
  if (!Number.isFinite(monthly) || monthly < 50) return "A monthly limit of at least $50.";
  if (monthly > 100_000) return "A monthly limit of at most $100,000.";
  if (perPurchase !== null && (!Number.isFinite(perPurchase) || perPurchase < 1)) return "A per-purchase limit of at least $1, or leave it empty.";
  if (perPurchase !== null && perPurchase > monthly) return "The per-purchase limit is over the monthly limit.";
  return null;
}
