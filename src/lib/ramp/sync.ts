import "server-only";
// RAMP CARD SPEND ONTO THE JOBS (2026-10-29) — server. The work behind the integration:
//   · the "JobFlex job" field in the contractor's Ramp, its options the open jobs (and "Stock / warehouse"), kept
//     current on every sync, required on every swipe when the contractor wants Ramp itself to ask the tech;
//   · the transactions read (a webhook the moment one clears, the hourly cron as the safety net, "Sync now" by
//     hand): one tagged to a job becomes that job's expense with the receipt pulled across; one with no job is asked
//     of the cardholder by text from the company's line and listed under "Needs a job" in Financials;
//   · the tech's reply, or the office's pick, books it and writes a memo back to Ramp so both sides agree.
// Every transaction is remembered in SyncState `rampTx:<org>:<id>` — once booked, never twice.
// Round 2 (same day): a swipe SPLIT in Ramp (line items, each with its own job) books one expense per line; the
// office can split one from Financials and the split is written back to Ramp; bills and card orders ride the sync.
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { ExpensePaidBy, ExpenseStatus } from "@/lib/prismaEnums";
import { putPrivate } from "@/lib/media/privateStore";
import { toE164 } from "@/lib/phone";
import { sendText, textWorker } from "@/lib/sms/send";
import { appBaseUrl } from "@/lib/appUrl";
import { patchRampConnection, rampApiFor, type RampConnection } from "./connection";
import type { RampApi } from "./client";
import { refreshOpenRampBills } from "./bills";
import { resumeRampCardOrders } from "./cards";
import {
  ASK_MAX_OPTIONS,
  ASK_TTL_MS,
  RAMP_FIELD_ID,
  RAMP_FIELD_NAME,
  RAMP_STOCK_OPTION_ID,
  RAMP_STOCK_OPTION_VALUE,
  askText,
  confirmText,
  jobOptionValue,
  money,
  parseJobReply,
  rampAmount,
  rampCardholderName,
  rampCategory,
  rampExpenseNote,
  rampJobTag,
  rampLineParts,
  rampMerchant,
  rampSpentAt,
  rampTxState,
  splitPlanError,
  toCents,
  type JobOption,
  type RampTransaction,
  type SplitPart,
} from "./shared";

const txKey = (org: string, id: string) => `rampTx:${org}:${id}`;
const askKey = (phone: string) => `rampAsk:${phone}`;
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
export const RAMP_WEBHOOK_EVENTS = [
  "transactions.cleared", "transactions.ready_for_review", "transactions.receipt_added", "transactions.body_coding_updated",
  "bills.created", "bills.approved", "bills.paid", "bills.rejected", "bills.archived", "bills.updated",
  "users.invite_accepted",
];

/** What JobFlex remembers of one Ramp transaction. */
export interface RampTxRecord {
  txId: string;
  state: string;
  amount: number;
  merchant: string;
  who: string;
  cardholderUserId: string | null;
  at: string | null;
  category: string;
  /** Booked: the expense, and the job (null = the warehouse). */
  expenseId: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stock: boolean;
  /** Not booked yet: nobody has named a job. */
  needsJob: boolean;
  askedAt: string | null;
  askedPhone: string | null;
  receiptDone: boolean;
  receiptIds: string[];
  seenAt: string;
  /** A split: one expense per part. `expenseId` is then the first part's; `remainder` the money no part names yet. */
  parts?: RampTxPart[];
  remainder?: number;
}
export interface RampTxPart {
  expenseId: string;
  amount: number;
  jobId: string | null;
  jobTitle: string | null;
  stock: boolean;
}
type Dest = { kind: "job"; jobId: string } | { kind: "stock" };

async function readTx(org: string, id: string): Promise<RampTxRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: txKey(org, id) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as RampTxRecord;
  } catch {
    return null;
  }
}
async function writeTx(org: string, rec: RampTxRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({ where: { key: txKey(org, rec.txId) }, create: { key: txKey(org, rec.txId), cursor }, update: { cursor } });
}

/** The open jobs, newest first — the field's options and the text's list. */
export async function openJobOptions(organizationId: string, max = 200): Promise<JobOption[]> {
  const jobs = await db.job.findMany({
    where: { organizationId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take: max,
    select: { id: true, title: true, client: { select: { name: true } } },
  });
  return jobs.map((j) => ({ jobId: j.id, title: j.title, value: jobOptionValue({ title: j.title, clientName: j.client?.name ?? null }) }));
}

/* ── the field in Ramp ──────────────────────────────────────────────────── */

/** The "JobFlex job" field made (or found) in the contractor's Ramp, its options the open jobs and the warehouse. */
export async function ensureRampField(organizationId: string): Promise<{ fieldRampId: string; uploaded: number; hidden: number } | null> {
  const got = await rampApiFor(organizationId);
  if (!got) return null;
  const { api, conn } = got;
  let fieldRampId = conn.fieldRampId;
  const required = conn.requireJob ? ["TRANSACTION"] : [];
  if (!fieldRampId) {
    const f = await api.createField({ id: RAMP_FIELD_ID, name: RAMP_FIELD_NAME, input_type: "SINGLE_CHOICE", is_required_for: required, is_splittable: true });
    fieldRampId = f.ramp_id ?? f.id ?? null;
    if (!fieldRampId) throw new Error("Ramp made the field but returned no id.");
  } else {
    await api.updateField(fieldRampId, { is_required_for: required, is_splittable: true }).catch(() => null);
  }
  const [options, jobs] = await Promise.all([api.fieldOptions(fieldRampId), openJobOptions(organizationId)]);
  const byId = new Map(options.map((o) => [o.id ?? "", o]));
  const want = new Map<string, string>([[RAMP_STOCK_OPTION_ID, RAMP_STOCK_OPTION_VALUE], ...jobs.map((j) => [j.jobId, j.value] as [string, string])]);
  const missing = [...want.entries()].filter(([id]) => !byId.has(id)).map(([id, value]) => ({ id, value }));
  let uploaded = 0;
  for (let i = 0; i < missing.length; i += 500) {
    const batch = missing.slice(i, i + 500);
    await api.uploadFieldOptions(fieldRampId, batch);
    uploaded += batch.length;
  }
  let hidden = 0;
  for (const o of options) {
    const id = o.id ?? "";
    const rampId = o.ramp_id;
    if (!id || !rampId) continue;
    const wanted = want.get(id);
    const visible = o.visibility !== "HIDDEN" && o.is_active !== false;
    if (wanted && !visible) await api.updateFieldOption(rampId, { visibility: "VISIBLE", reactivate: true }).catch(() => null);
    else if (wanted && o.value !== wanted) await api.updateFieldOption(rampId, { value: wanted }).catch(() => null);
    else if (!wanted && visible) {
      await api.updateFieldOption(rampId, { visibility: "HIDDEN" }).catch(() => null);
      hidden += 1;
    }
  }
  await patchRampConnection(organizationId, { fieldRampId, fieldOptionsAt: new Date().toISOString() });
  return { fieldRampId, uploaded, hidden };
}

/* ── the webhook in Ramp ────────────────────────────────────────────────── */

/** The webhook subscription for this business, pointed at JobFlex; Ramp verifies it with a challenge (api/webhooks/ramp). */
export async function ensureRampWebhook(organizationId: string): Promise<{ id: string; status: string } | null> {
  const got = await rampApiFor(organizationId);
  if (!got) return null;
  const { api, conn } = got;
  if (conn.webhookId) return { id: conn.webhookId, status: conn.webhookVerified ? "active" : "pending_verification" };
  const url = `${process.env.RAMP_WEBHOOK_URL?.trim() || (await appBaseUrl())}/api/webhooks/ramp`;
  const hook = await api.createWebhook(url, RAMP_WEBHOOK_EVENTS);
  await patchRampConnection(organizationId, { webhookId: hook.id, webhookSecret: hook.secret, webhookVerified: hook.status === "active" });
  return { id: hook.id, status: hook.status ?? "pending_verification" };
}

/* ── booking a transaction ──────────────────────────────────────────────── */

/** The cardholder in JobFlex: a crew member (texted through textWorker) or a member of the company, by Ramp's email or phone. */
async function cardholderInJobFlex(api: RampApi, organizationId: string, rampUserId: string | null): Promise<{ userId: string | null; name: string; worker: { id: string; phone: string | null; smsOptIn: boolean; organizationId: string; user: { notificationPrefsJson: string | null } | null } | null; phone: string | null }> {
  if (!rampUserId) return { userId: null, name: "", worker: null, phone: null };
  const u = await api.user(rampUserId).catch(() => null);
  const email = u?.email?.trim().toLowerCase() ?? "";
  const phone = toE164(u?.phone ?? null);
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ");
  const member = email ? await db.membership.findFirst({ where: { organizationId, user: { email } }, select: { userId: true, user: { select: { smsPhone: true, name: true } } } }).catch(() => null) : null;
  const worker = await db.workerProfile
    .findFirst({
      where: { organizationId, OR: [...(member ? [{ userId: member.userId }] : []), ...(phone ? [{ phone }] : []), ...(email ? [{ user: { email } }] : [])] },
      select: { id: true, phone: true, smsOptIn: true, organizationId: true, userId: true, user: { select: { notificationPrefsJson: true } } },
    })
    .catch(() => null);
  return {
    userId: member?.userId ?? worker?.userId ?? null,
    name: member?.user?.name?.trim() || name,
    worker: worker ? { id: worker.id, phone: worker.phone, smsOptIn: worker.smsOptIn, organizationId: worker.organizationId, user: worker.user } : null,
    phone: toE164(worker?.phone ?? member?.user?.smsPhone ?? phone),
  };
}

/** The receipt pulled across into the job's own folder; null when there is none, it is too big, or the store refused. */
async function pullReceipt(api: RampApi, tx: RampTransaction, jobId: string): Promise<string | null> {
  const id = tx.receipts?.[0];
  if (!id) return null;
  try {
    const r = await api.receipt(id);
    if (!r.receipt_url) return null;
    const res = await fetch(r.receipt_url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > RECEIPT_MAX_BYTES) return null;
    const ext = type === "application/pdf" ? "pdf" : type.split("/")[1].replace("jpeg", "jpg");
    const put = await putPrivate(`receipts/${jobId}/ramp-${tx.id}-${id}.${ext}`, buf, type);
    return put.url;
  } catch {
    return null;
  }
}

/** One expense written on a job (or the warehouse) for all or part of a swipe, and its trail line. */
async function bookPart(organizationId: string, conn: RampConnection, api: RampApi, tx: RampTransaction, to: Dest, by: { userId: string | null; name: string }, amount: number, partWords: string | null): Promise<RampTxPart & { receiptUrl: string | null }> {
  const category = rampCategory(tx);
  const who = rampCardholderName(tx) || by.name;
  const job = to.kind === "job" ? await db.job.findFirst({ where: { id: to.jobId, organizationId }, select: { id: true, title: true, proposalId: true, clientId: true } }) : null;
  if (to.kind === "job" && !job) throw new Error("That job is not in this company.");
  const receiptUrl = job ? await pullReceipt(api, tx, job.id) : null;
  const now = new Date();
  const actorId = by.userId ?? conn.actorId;
  const row = await db.jobExpense.create({
    data: {
      jobId: job?.id ?? null,
      organizationId,
      submittedById: actorId || null,
      category,
      amount: Math.max(-1_000_000, Math.min(amount, 1_000_000)),
      note: `${rampExpenseNote(tx)}${partWords ? ` · ${partWords}` : ""}`,
      receiptUrl,
      vendor: rampMerchant(tx),
      spentAt: rampSpentAt(tx) ?? now,
      paidBy: ExpensePaidBy.COMPANY,
      status: ExpenseStatus.APPROVED,
      reviewedById: actorId || null,
      reviewedAt: now,
    },
  });
  const where = job ? job.title : "stock";
  await logActivity({
    organizationId,
    actorId: actorId || null,
    kind: TRAIL_KINDS.EXPENSE,
    summary: `Ramp card: ${money(amount)}${amount < 0 ? " back" : ""} at ${rampMerchant(tx)} on ${where}${partWords ? ` (${partWords})` : ""}${who ? ` — ${who}` : ""}${receiptUrl ? " (receipt attached)" : ""}`,
    proposalId: job?.proposalId ?? null,
    clientId: job?.clientId ?? null,
    meta: { jobId: job?.id ?? null, expenseId: row.id, amount, category, source: "ramp", rampTransactionId: tx.id, split: !!partWords },
  });
  return { expenseId: row.id, amount, jobId: job?.id ?? null, jobTitle: job?.title ?? null, stock: to.kind === "stock", receiptUrl };
}

function freshRecord(tx: RampTransaction, who: string): RampTxRecord {
  return {
    txId: tx.id,
    state: rampTxState(tx),
    amount: rampAmount(tx),
    merchant: rampMerchant(tx),
    who,
    cardholderUserId: tx.card_holder?.user_id ?? null,
    at: rampSpentAt(tx)?.toISOString() ?? null,
    category: rampCategory(tx),
    expenseId: null,
    jobId: null,
    jobTitle: null,
    stock: false,
    needsJob: true,
    askedAt: null,
    askedPhone: null,
    receiptDone: false,
    receiptIds: tx.receipts ?? [],
    seenAt: new Date().toISOString(),
  };
}

/** The whole swipe on one job (or the warehouse). */
async function bookTransaction(organizationId: string, conn: RampConnection, api: RampApi, tx: RampTransaction, to: Dest, by: { userId: string | null; name: string }): Promise<RampTxRecord> {
  const part = await bookPart(organizationId, conn, api, tx, to, by, rampAmount(tx), null);
  const rec: RampTxRecord = { ...freshRecord(tx, rampCardholderName(tx) || by.name), expenseId: part.expenseId, jobId: part.jobId, jobTitle: part.jobTitle, stock: part.stock, needsJob: false, receiptDone: !!part.receiptUrl };
  await writeTx(organizationId, rec);
  return rec;
}

/**
 * A swipe in parts: each part that names a job (or stock) becomes its own expense; what no part names is the
 * remainder, left waiting for a job. Parts already booked on the record stay; a tagged line equal to one of them
 * (same place, same money) is not booked twice.
 */
async function bookSplit(organizationId: string, conn: RampConnection, api: RampApi, tx: RampTransaction, lines: Array<{ amount: number; tag: Dest | null }>, by: { userId: string | null; name: string }, existing: RampTxRecord | null): Promise<RampTxRecord> {
  const parts: RampTxPart[] = [...(existing?.parts ?? [])];
  const taken = new Set(parts.map((p) => `${p.stock ? "stock" : p.jobId}|${p.amount.toFixed(2)}`));
  const n = lines.length;
  let i = 0;
  for (const line of lines) {
    i += 1;
    if (!line.tag) continue;
    const key = `${line.tag.kind === "stock" ? "stock" : line.tag.jobId}|${line.amount.toFixed(2)}`;
    if (taken.has(key)) continue;
    try {
      const part = await bookPart(organizationId, conn, api, tx, line.tag, by, line.amount, `split ${i} of ${n}`);
      parts.push({ expenseId: part.expenseId, amount: part.amount, jobId: part.jobId, jobTitle: part.jobTitle, stock: part.stock });
      taken.add(key);
    } catch {
      /* a job that is not this company's: that part stays in the remainder */
    }
  }
  const total = rampAmount(tx);
  const booked = Math.round(parts.reduce((a, p) => a + p.amount, 0) * 100) / 100;
  const remainder = Math.round((total - booked) * 100) / 100;
  const first = parts[0] ?? null;
  const rec: RampTxRecord = {
    ...(existing ?? freshRecord(tx, rampCardholderName(tx) || by.name)),
    state: rampTxState(tx),
    amount: total,
    receiptIds: tx.receipts ?? [],
    expenseId: first?.expenseId ?? null,
    jobId: first?.jobId ?? null,
    jobTitle: parts.length > 1 ? `split · ${parts.length} parts` : (first?.jobTitle ?? null),
    stock: parts.length === 1 && !!first?.stock,
    parts,
    remainder: Math.abs(remainder) >= 0.01 ? remainder : 0,
    needsJob: Math.abs(remainder) >= 0.01,
    receiptDone: parts.length > 0,
  };
  await writeTx(organizationId, rec);
  return rec;
}

/** Ask the cardholder which job, once, from the company's line; the question waits under `rampAsk:<phone>`. */
async function askCardholder(organizationId: string, api: RampApi, tx: RampTransaction, rec: RampTxRecord): Promise<RampTxRecord> {
  const holder = await cardholderInJobFlex(api, organizationId, tx.card_holder?.user_id ?? null);
  if (!holder.phone) return rec;
  const [org, options] = await Promise.all([db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }), openJobOptions(organizationId, ASK_MAX_OPTIONS)]);
  if (!options.length) return rec;
  const body = askText(org?.name ?? "JobFlex", tx, options);
  const sent = holder.worker ? await textWorker(holder.worker, body, "ramp-which-job") : await sendText({ organizationId, to: holder.phone, body, kind: "ramp-which-job" });
  // A text the line could not send (no Twilio here, a trial without a card) is not an ask: the next sync tries again.
  if (!sent || !sent.ok || sent.status === "SKIPPED") return rec;
  const ask = { organizationId, txId: tx.id, options, askedAt: new Date().toISOString() };
  await db.syncState.upsert({ where: { key: askKey(holder.phone) }, create: { key: askKey(holder.phone), cursor: JSON.stringify(ask) }, update: { cursor: JSON.stringify(ask) } });
  return { ...rec, askedAt: ask.askedAt, askedPhone: holder.phone };
}

/** One transaction read: booked when it names a job, remembered and asked when it does not, updated when it clears or a receipt lands. */
export async function processRampTransaction(organizationId: string, conn: RampConnection, api: RampApi, tx: RampTransaction): Promise<"booked" | "needs-job" | "updated" | "skipped"> {
  if (!tx.id || rampTxState(tx) === "declined") return "skipped";
  const existing = await readTx(organizationId, tx.id);
  if (existing?.expenseId && existing.parts?.length && existing.needsJob) {
    // A split with money still unplaced: a line tagged since (in Ramp, or by the tech) books now.
    const lines = rampLineParts(tx, conn.fieldRampId);
    if (lines.some((l) => l.tag)) {
      const before = existing.parts.length;
      const rec = await bookSplit(organizationId, conn, api, tx, lines, { userId: null, name: existing.who }, existing);
      if (rec.parts && rec.parts.length > before) return rec.needsJob ? "updated" : "booked";
    }
  }
  if (existing?.expenseId) {
    let changed = false;
    const amount = rampAmount(tx);
    if (Math.abs(amount - existing.amount) >= 0.01 && !existing.parts?.length) {
      await db.jobExpense.update({ where: { id: existing.expenseId }, data: { amount } }).catch(() => null);
      existing.amount = amount;
      changed = true;
    }
    if (!existing.receiptDone && existing.jobId && tx.receipts?.length) {
      const url = await pullReceipt(api, tx, existing.jobId);
      if (url) {
        await db.jobExpense.update({ where: { id: existing.expenseId }, data: { receiptUrl: url } }).catch(() => null);
        existing.receiptDone = true;
        existing.receiptIds = tx.receipts;
        changed = true;
      }
    }
    const state = rampTxState(tx);
    if (state !== existing.state) {
      existing.state = state;
      changed = true;
    }
    if (changed) await writeTx(organizationId, existing);
    return changed ? "updated" : "skipped";
  }
  // Split in Ramp: each line with a job books on its own; the rest waits.
  const lines = rampLineParts(tx, conn.fieldRampId);
  if (lines.length) {
    const holder = await cardholderInJobFlex(api, organizationId, tx.card_holder?.user_id ?? null);
    const rec = await bookSplit(organizationId, conn, api, tx, lines, { userId: holder.userId, name: holder.name }, existing);
    if (!rec.needsJob) return "booked";
    if (!rec.askedAt && conn.askByText) {
      const asked = await askCardholder(organizationId, api, { ...tx, entity_amount: { value: rec.remainder ?? rampAmount(tx) }, amount: rec.remainder ?? rampAmount(tx) }, rec);
      await writeTx(organizationId, asked);
    }
    return rec.parts?.length ? "updated" : "needs-job";
  }
  const tag = rampJobTag(tx, conn.fieldRampId);
  if (tag) {
    const holder = await cardholderInJobFlex(api, organizationId, tx.card_holder?.user_id ?? null);
    try {
      await bookTransaction(organizationId, conn, api, tx, tag, { userId: holder.userId, name: holder.name });
      return "booked";
    } catch {
      /* a job that is not this company's: fall through to "needs a job" */
    }
  }
  let rec: RampTxRecord = existing ?? freshRecord(tx, rampCardholderName(tx));
  rec = { ...rec, state: rampTxState(tx), amount: rampAmount(tx), receiptIds: tx.receipts ?? [], needsJob: true };
  if (!rec.askedAt && conn.askByText) rec = await askCardholder(organizationId, api, tx, rec);
  await writeTx(organizationId, rec);
  return "needs-job";
}

/** Every transaction since the last sync (three days back for safety), the field's options refreshed first. */
export async function syncRamp(organizationId: string, opts: { since?: Date | null; full?: boolean } = {}): Promise<{ ok: true; booked: number; needsJob: number; updated: number; read: number; billsPaid: number } | { ok: false; error: string }> {
  const got = await rampApiFor(organizationId);
  if (!got) return { ok: false, error: "Ramp is not connected." };
  const { api, conn } = got;
  try {
    await ensureRampField(organizationId).catch((err) => console.warn("[ramp] field sync:", err instanceof Error ? err.message : err));
    const since = opts.full ? null : (opts.since ?? (conn.lastSyncAt ? new Date(Date.parse(conn.lastSyncAt) - 3 * 86_400_000) : new Date(Date.now() - 30 * 86_400_000)));
    const txs = await api.transactions(since);
    const fresh = (await rampApiFor(organizationId))?.conn ?? conn;
    let booked = 0, needsJob = 0, updated = 0;
    for (const tx of txs) {
      const r = await processRampTransaction(organizationId, fresh, api, tx).catch((err) => {
        console.warn("[ramp] transaction", tx.id, err instanceof Error ? err.message : err);
        return "skipped" as const;
      });
      if (r === "booked") booked += 1;
      else if (r === "needs-job") needsJob += 1;
      else if (r === "updated") updated += 1;
    }
    const billsPaid = await refreshOpenRampBills(organizationId).catch(() => 0);
    await resumeRampCardOrders(organizationId).catch(() => 0);
    await patchRampConnection(organizationId, { lastSyncAt: new Date().toISOString(), lastSyncCount: txs.length, lastError: null });
    return { ok: true, booked, needsJob, updated, read: txs.length, billsPaid };
  } catch (err) {
    const error = err instanceof Error ? err.message : "The sync failed.";
    await patchRampConnection(organizationId, { lastError: error });
    return { ok: false, error };
  }
}

/** The office (or the tech's text) names the job: booked, the memo written back to Ramp, the question closed. */
export async function assignRampTransaction(organizationId: string, txId: string, to: { kind: "job"; jobId: string } | { kind: "stock" } | { kind: "none" }, by: { userId: string | null; name: string }): Promise<{ ok: true; where: string } | { ok: false; error: string }> {
  const got = await rampApiFor(organizationId);
  if (!got) return { ok: false, error: "Ramp is not connected." };
  const { api, conn } = got;
  const rec = await readTx(organizationId, txId);
  if (rec?.expenseId && !(rec.parts?.length && rec.needsJob)) return { ok: true, where: rec.jobTitle ?? "stock" };
  if (to.kind === "none") {
    if (rec) await writeTx(organizationId, { ...rec, needsJob: false, askedAt: rec.askedAt ?? new Date().toISOString() });
    if (rec?.askedPhone) await db.syncState.deleteMany({ where: { key: askKey(rec.askedPhone) } }).catch(() => null);
    return { ok: true, where: "nowhere — left off the jobs" };
  }
  const tx = await api.transaction(txId).catch(() => null);
  if (!tx) return { ok: false, error: "Ramp did not return that transaction." };
  try {
    if (rec?.parts?.length && rec.needsJob) {
      // The rest of a split goes to one place; Ramp's own lines stay as they are, the memo says where the rest went.
      const remainder = rec.remainder ?? Math.round((rampAmount(tx) - rec.parts.reduce((a, p) => a + p.amount, 0)) * 100) / 100;
      const part = await bookPart(organizationId, conn, api, tx, to, by, remainder, `split ${rec.parts.length + 1} of ${rec.parts.length + 1}`);
      const parts = [...rec.parts, { expenseId: part.expenseId, amount: part.amount, jobId: part.jobId, jobTitle: part.jobTitle, stock: part.stock }];
      await writeTx(organizationId, { ...rec, parts, remainder: 0, needsJob: false, jobTitle: `split · ${parts.length} parts`, stock: false });
      await api.memo(txId, `JobFlex: split — ${parts.map((p) => `${p.stock ? "stock" : p.jobTitle} ${money(p.amount)}`).join(" · ")}`).catch(() => null);
      if (rec.askedPhone) await db.syncState.deleteMany({ where: { key: askKey(rec.askedPhone) } }).catch(() => null);
      return { ok: true, where: part.jobTitle ?? "stock" };
    }
    const booked = await bookTransaction(organizationId, conn, api, tx, to, by);
    await api.memo(txId, `JobFlex: ${to.kind === "job" ? `${booked.jobTitle ?? to.jobId} (${to.jobId})` : "stock"}`).catch(() => null);
    if (rec?.askedPhone) await db.syncState.deleteMany({ where: { key: askKey(rec.askedPhone) } }).catch(() => null);
    return { ok: true, where: booked.jobTitle ?? "stock" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not book it." };
  }
}

/**
 * The office splits a swipe across jobs: one expense per part here, and the split written back to Ramp as line items
 * coded with the JobFlex job field (cents; Ramp wants the parts to sum to the swipe). A swipe Ramp already split
 * is placed, not re-split.
 */
export async function splitRampTransaction(organizationId: string, txId: string, parts: SplitPart[], by: { userId: string | null; name: string }): Promise<{ ok: true; where: string; rampTook: boolean } | { ok: false; error: string }> {
  const got = await rampApiFor(organizationId);
  if (!got) return { ok: false, error: "Ramp is not connected." };
  const { api, conn } = got;
  const rec = await readTx(organizationId, txId);
  if (rec?.expenseId) return { ok: false, error: rec.parts?.length ? "Ramp already split this one — place the rest on one job." : "This swipe is already on a job." };
  const tx = await api.transaction(txId).catch(() => null);
  if (!tx) return { ok: false, error: "Ramp did not return that transaction." };
  const total = rampAmount(tx);
  const bad = splitPlanError(total, parts);
  if (bad) return { ok: false, error: bad };
  const booked: RampTxPart[] = [];
  let i = 0;
  for (const p of parts) {
    i += 1;
    try {
      const part = await bookPart(organizationId, conn, api, tx, p.to, by, p.amount, `split ${i} of ${parts.length}`);
      booked.push({ expenseId: part.expenseId, amount: part.amount, jobId: part.jobId, jobTitle: part.jobTitle, stock: part.stock });
    } catch (err) {
      // Undo what was written, so a bad job in the list leaves nothing half-booked.
      await db.jobExpense.deleteMany({ where: { id: { in: booked.map((b) => b.expenseId) } } }).catch(() => null);
      return { ok: false, error: err instanceof Error ? err.message : "Could not book a part." };
    }
  }
  const first = booked[0];
  await writeTx(organizationId, { ...(rec ?? freshRecord(tx, rampCardholderName(tx) || by.name)), state: rampTxState(tx), amount: total, expenseId: first.expenseId, jobId: first.jobId, jobTitle: `split · ${booked.length} parts`, stock: false, parts: booked, remainder: 0, needsJob: false, receiptDone: true, receiptIds: tx.receipts ?? [] });
  if (rec?.askedPhone) await db.syncState.deleteMany({ where: { key: askKey(rec.askedPhone) } }).catch(() => null);
  // Ramp's side: the same split as line items on the transaction, each coded to its job; the memo as a plain-words copy.
  const cents = parts.map((p) => toCents(p.amount));
  const drift = toCents(total) - cents.reduce((a, b) => a + b, 0);
  cents[cents.length - 1] += drift;
  const lines = parts.map((p, k) => ({
    amount: cents[k],
    memo: `JobFlex: ${p.to.kind === "job" ? (booked[k].jobTitle ?? p.to.jobId) : "stock"}`,
    accounting_field_selections: conn.fieldRampId ? [{ field_id: conn.fieldRampId, field_option_external_id: p.to.kind === "job" ? p.to.jobId : RAMP_STOCK_OPTION_ID }] : [],
  }));
  const rampTook = !!(await api.splitTransaction(txId, lines).catch(() => null));
  await api.memo(txId, `JobFlex: split — ${booked.map((p) => `${p.stock ? "stock" : p.jobTitle} ${money(p.amount)}`).join(" · ")}`).catch(() => null);
  return { ok: true, where: booked.map((p) => `${p.stock ? "stock" : p.jobTitle} ${money(p.amount)}`).join(" · "), rampTook };
}

/** What Financials and the Integrations card list: the swipes with no job first, then the latest booked. */
export async function rampCardSpend(organizationId: string, max = 60): Promise<{ needsJob: RampTxRecord[]; recent: RampTxRecord[] }> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: `rampTx:${organizationId}:` } }, select: { cursor: true }, orderBy: { updatedAt: "desc" }, take: 500 }).catch(() => []);
  const recs: RampTxRecord[] = [];
  for (const r of rows) {
    try {
      recs.push(JSON.parse(r.cursor) as RampTxRecord);
    } catch {
      /* skip */
    }
  }
  const byTime = (a: RampTxRecord, b: RampTxRecord) => (b.at ?? b.seenAt).localeCompare(a.at ?? a.seenAt);
  return { needsJob: recs.filter((r) => r.needsJob && (!r.expenseId || (r.remainder ?? 0) !== 0)).sort(byTime).slice(0, max), recent: recs.filter((r) => !!r.expenseId).sort(byTime).slice(0, max) };
}

/* ── the tech's text back ───────────────────────────────────────────────── */

export type RampReplyPlan = { handled: false } | { handled: true; organizationId: string; phone: string; reply: string };

/** A text from a number we asked "which job?": the answer booked, the words to send back. */
export async function planRampReply(fromRaw: string, body: string): Promise<RampReplyPlan> {
  const phone = toE164(fromRaw);
  if (!phone) return { handled: false };
  const row = await db.syncState.findUnique({ where: { key: askKey(phone) }, select: { cursor: true } }).catch(() => null);
  if (!row) return { handled: false };
  let ask: { organizationId: string; txId: string; options: JobOption[]; askedAt: string };
  try {
    ask = JSON.parse(row.cursor);
  } catch {
    return { handled: false };
  }
  if (Date.now() - Date.parse(ask.askedAt) > ASK_TTL_MS) {
    await db.syncState.deleteMany({ where: { key: askKey(phone) } }).catch(() => null);
    return { handled: false };
  }
  const answer = parseJobReply(body, ask.options);
  if (!answer) return { handled: true, organizationId: ask.organizationId, phone, reply: `Which job? Reply a number 1–${Math.min(ask.options.length, ASK_MAX_OPTIONS)}, S for stock, or the job's name.` };
  const rec = await readTx(ask.organizationId, ask.txId);
  const who = rec ? { userId: null, name: rec.who } : { userId: null, name: "" };
  const result = await assignRampTransaction(ask.organizationId, ask.txId, answer, who);
  if (!result.ok) return { handled: true, organizationId: ask.organizationId, phone, reply: `Couldn't book it: ${result.error}` };
  const tx = rec ? { amount: rec.amount, merchant_name: rec.merchant } : { amount: 0, merchant_name: "" };
  return { handled: true, organizationId: ask.organizationId, phone, reply: answer.kind === "none" ? "Left off the jobs. The office can place it later." : confirmText(tx, result.where) };
}

export async function deliverRampReply(plan: Extract<RampReplyPlan, { handled: true }>): Promise<void> {
  await sendText({ organizationId: plan.organizationId, to: plan.phone, body: plan.reply, kind: "ramp-which-job-reply" });
}
