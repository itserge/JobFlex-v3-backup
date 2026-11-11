import "server-only";
// CONTRACTORS: QUOTES AND INVOICES — the database half (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"; grown 2026-11-08 by part 1 of the subcontractors plan). The company's directory of subs; a project
// sends a REQUEST for quotes on a stage's work to one or several of them (each a recipient row with its own link,
// the way a supplier gets the buy link), the sub answers on /q/<token> with a price and a document — every price a
// VERSION, the original never overwritten — the office compares the quotes against the stage's share of the
// Subcontractors budget, asks for a revision or awards one; the same link then asks for the invoice, and "paid" logs a
// Subcontractors expense on the project, which the job's cost and the margin read. The rules are ./shared; the
// documents are lib/subDocs.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import type { PrefKey } from "@/lib/notificationPrefsShared";
import type { EmailDoc } from "@/lib/email/doc";
import { localDayKey } from "@/lib/jobProgressShared";
import { mediaHref } from "@/lib/media/signedLink";
import { sendText, textOffice } from "@/lib/sms/send";
import { isoDay } from "@/lib/projectTimeline/shared";
import { FILE_KIND_LABEL, fileKindOf } from "@/lib/projectClient/shared";
import { DOC_SELECT, docRow, documentsOf, recordDocument, type DocRow } from "@/lib/subDocs/server";
export type { DocRow } from "@/lib/subDocs/server";
// Part 2 (2026-11-08): the reply address on a request's email, the AI's read on a version, the budget's pending line.
import { inboundReplyTo } from "@/lib/subInbound/config";
import { REPLY_HINT, subjectTag } from "@/lib/subInbound/shared";
import { committedOf, paidOf, parseStoredCompare, parseStoredRead, pendingOf, type StoredCompare, type StoredRead } from "@/lib/subQuotes/shared";
import {
  REQUEST_FIRST_NUMBER,
  askText,
  awardText,
  compareQuotes,
  contractorFlags,
  dollars,
  linkClosed,
  linkExpiry,
  overdue,
  quoteFlags,
  quoteStatusOf,
  requestNo,
  requestTitleFor,
  revisionText,
  stageSubsBudget,
  tradesOf,
  type QuoteLike,
} from "./shared";
import { lapsedOrgIds } from "@/lib/customPageAccess";

/** The bell's kind for a sub's move (a quote in, revised, declined, an invoice) — not in the trail-only set, so it
 *  rings; its preference row is "sub-quote". */
export const SUB_EVENT_KIND = "SUB_QUOTE";
/** Part 4: a contract signed or a change order answered — its preference row is "sub-contract". */
export const SUB_CONTRACT_KIND = "SUB_CONTRACT";

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayWords = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const ORG_SELECT = { id: true, name: true, phone: true, logoUrl: true, timezone: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, deletedAt: true } as const;

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}

// ── the directory ────────────────────────────────────────────────────────────

export type ContractorRow = {
  id: string;
  name: string;
  company: string | null;
  trade: string | null;
  trades: string[];
  phone: string | null;
  email: string | null;
  license: string | null;
  licenseStatus: string;
  licenseVerifiedAt: string | null;
  licenseSource: string | null;
  insuranceUntil: string | null;
  insuranceCarrier: string | null;
  insurancePolicy: string | null;
  bondAmount: number | null;
  bondUntil: string | null;
  w9Status: string;
  w9DocumentId: string | null;
  contactName: string | null;
  website: string | null;
  address: string | null;
  serviceAreas: string | null;
  source: string;
  textsOptOut: boolean;
  notes: string | null;
  createdAt: string;
  /** Part 3: what the state register said about this sub, and when (lib/subFinder parseRegisterNote). */
  registerJson: string | null;
  registerCheckedAt: string | null;
};

const CONTRACTOR_SELECT = {
  id: true,
  name: true,
  company: true,
  trade: true,
  tradesJson: true,
  phone: true,
  email: true,
  license: true,
  licenseStatus: true,
  licenseVerifiedAt: true,
  licenseSource: true,
  insuranceUntil: true,
  insuranceCarrier: true,
  insurancePolicy: true,
  bondAmount: true,
  bondUntil: true,
  w9Status: true,
  w9DocumentId: true,
  contactName: true,
  website: true,
  address: true,
  serviceAreas: true,
  source: true,
  textsOptOut: true,
  notes: true,
  createdAt: true,
  registerJson: true,
  registerCheckedAt: true,
} as const;

type ContractorDb = {
  id: string;
  name: string;
  company: string | null;
  trade: string | null;
  tradesJson: string | null;
  phone: string | null;
  email: string | null;
  license: string | null;
  licenseStatus: string;
  licenseVerifiedAt: Date | null;
  licenseSource: string | null;
  insuranceUntil: Date | null;
  insuranceCarrier: string | null;
  insurancePolicy: string | null;
  bondAmount: number | null;
  bondUntil: Date | null;
  w9Status: string;
  w9DocumentId: string | null;
  contactName: string | null;
  website: string | null;
  address: string | null;
  serviceAreas: string | null;
  source: string;
  textsOptOut: boolean;
  notes: string | null;
  createdAt: Date;
  registerJson: string | null;
  registerCheckedAt: Date | null;
};

const row = (c: ContractorDb): ContractorRow => ({
  registerJson: c.registerJson,
  registerCheckedAt: iso(c.registerCheckedAt),
  id: c.id,
  name: c.name,
  company: c.company,
  trade: c.trade,
  trades: tradesOf(c.trade, c.tradesJson),
  phone: c.phone,
  email: c.email,
  license: c.license,
  licenseStatus: c.licenseStatus,
  licenseVerifiedAt: iso(c.licenseVerifiedAt),
  licenseSource: c.licenseSource,
  insuranceUntil: isoDay(c.insuranceUntil),
  insuranceCarrier: c.insuranceCarrier,
  insurancePolicy: c.insurancePolicy,
  bondAmount: c.bondAmount,
  bondUntil: isoDay(c.bondUntil),
  w9Status: c.w9Status,
  w9DocumentId: c.w9DocumentId,
  contactName: c.contactName,
  website: c.website,
  address: c.address,
  serviceAreas: c.serviceAreas,
  source: c.source,
  textsOptOut: c.textsOptOut,
  notes: c.notes,
  createdAt: c.createdAt.toISOString(),
});

export async function contractorsOf(organizationId: string): Promise<ContractorRow[]> {
  const rows = await db.contractor.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: CONTRACTOR_SELECT });
  return rows.map(row);
}

export type ContractorInput = {
  name: string;
  company?: string | null;
  trade?: string | null;
  trades?: string[] | null;
  phone?: string | null;
  email?: string | null;
  license?: string | null;
  licenseStatus?: string | null;
  /** ISO day. */
  insuranceUntil?: string | null;
  insuranceCarrier?: string | null;
  insurancePolicy?: string | null;
  bondAmount?: number | null;
  bondUntil?: string | null;
  w9Status?: string | null;
  contactName?: string | null;
  website?: string | null;
  address?: string | null;
  serviceAreas?: string | null;
  source?: string | null;
  textsOptOut?: boolean | null;
  notes?: string | null;
};

const trim = (s: string | null | undefined, n: number) => s?.trim().slice(0, n) || null;

function contractorData(input: Partial<ContractorInput>, mode: "create" | "patch") {
  const has = (k: keyof ContractorInput) => mode === "create" || input[k] !== undefined;
  return {
    ...(has("name") && input.name !== undefined && { name: input.name.trim().slice(0, 120) }),
    ...(has("company") && { company: trim(input.company, 120) }),
    ...(has("trade") && { trade: trim(input.trade, 60) }),
    ...(has("trades") && { tradesJson: input.trades?.length ? JSON.stringify(input.trades.map((t) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 8)) : null }),
    ...(has("phone") && { phone: trim(input.phone, 40) }),
    ...(has("email") && { email: trim(input.email, 200) }),
    ...(has("license") && { license: trim(input.license, 80) }),
    ...(has("licenseStatus") && input.licenseStatus !== undefined && { licenseStatus: input.licenseStatus ?? "UNKNOWN", licenseVerifiedAt: input.licenseStatus && input.licenseStatus !== "UNKNOWN" ? new Date() : null, licenseSource: input.licenseStatus && input.licenseStatus !== "UNKNOWN" ? "MANUAL" : null }),
    ...(has("insuranceUntil") && { insuranceUntil: day(input.insuranceUntil ?? null) }),
    ...(has("insuranceCarrier") && { insuranceCarrier: trim(input.insuranceCarrier, 120) }),
    ...(has("insurancePolicy") && { insurancePolicy: trim(input.insurancePolicy, 80) }),
    ...(has("bondAmount") && { bondAmount: input.bondAmount != null && input.bondAmount >= 0 ? r2(input.bondAmount) : null }),
    ...(has("bondUntil") && { bondUntil: day(input.bondUntil ?? null) }),
    ...(has("w9Status") && input.w9Status !== undefined && { w9Status: input.w9Status ?? "NONE" }),
    ...(has("contactName") && { contactName: trim(input.contactName, 120) }),
    ...(has("website") && { website: trim(input.website, 200) }),
    ...(has("address") && { address: trim(input.address, 240) }),
    ...(has("serviceAreas") && { serviceAreas: trim(input.serviceAreas, 240) }),
    ...(has("source") && input.source !== undefined && input.source && { source: input.source }),
    ...(has("textsOptOut") && input.textsOptOut !== undefined && input.textsOptOut !== null && { textsOptOut: input.textsOptOut }),
    ...(has("notes") && { notes: trim(input.notes, 1000) }),
  };
}

export async function addContractor(organizationId: string, actorId: string | null, input: ContractorInput): Promise<ContractorRow> {
  const c = await db.contractor.create({ data: { organizationId, name: input.name.trim().slice(0, 120), ...contractorData(input, "create") }, select: CONTRACTOR_SELECT });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added contractor ${c.name}${c.trade ? ` (${c.trade})` : ""}`, meta: { contractorId: c.id } });
  return row(c);
}

export async function updateContractor(organizationId: string, id: string, patch: Partial<ContractorInput>): Promise<ContractorRow> {
  const c = await db.contractor.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!c) throw new Error("Contractor not found");
  const u = await db.contractor.update({ where: { id }, data: contractorData(patch, "patch"), select: CONTRACTOR_SELECT });
  return row(u);
}

/** A sub's W-9 or insurance certificate, kept on the directory. */
export async function attachContractorDocument(organizationId: string, contractorId: string, kind: "W9" | "INSURANCE", file: { url: string; name: string; contentType: string | null; bytes: number | null }, actorId: string | null): Promise<DocRow> {
  const c = await db.contractor.findFirst({ where: { id: contractorId, organizationId }, select: { id: true, name: true } });
  if (!c) throw new Error("Contractor not found");
  const doc = await recordDocument({ organizationId, projectId: null, contractorId: c.id, requestId: null, kind, name: file.name, url: file.url, contentType: file.contentType, bytes: file.bytes, uploadedVia: "OFFICE", uploadedById: actorId });
  if (kind === "W9") await db.contractor.update({ where: { id: c.id }, data: { w9Status: "ON_FILE", w9DocumentId: doc.id } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Kept ${c.name}'s ${kind === "W9" ? "W-9" : "insurance certificate"} (${doc.name})`, meta: { contractorId: c.id, documentId: doc.id } });
  return doc;
}

/** The directory's view: every sub with their flags and what they have done for the company. */
export type DirectoryRow = ContractorRow & {
  flags: ReturnType<typeof contractorFlags>;
  asked: number;
  quoted: number;
  awarded: number;
  paidTotal: number;
  lastAskedAt: string | null;
  documents: DocRow[];
  /** Part 4: executed subcontracts with this sub, and their total. */
  contracts: number;
  contractsTotal: number;
};

export async function directoryOf(organizationId: string): Promise<{ today: string; contractors: DirectoryRow[] }> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const [contractors, quotes, docs, contracts] = await Promise.all([
    contractorsOf(organizationId),
    db.projectSubQuote.findMany({ where: { organizationId }, select: { contractorId: true, status: true, invoiceAmount: true, amount: true, askedAt: true } }),
    db.subDocument.findMany({ where: { organizationId, contractorId: { not: null }, kind: { in: ["W9", "INSURANCE"] } }, orderBy: { createdAt: "desc" }, select: DOC_SELECT }),
    db.subcontract.findMany({ where: { organizationId, status: "EXECUTED" }, select: { contractorId: true, amount: true, changeOrders: { where: { status: "APPROVED" }, select: { amount: true } } } }),
  ]);
  const contractsBy = new Map<string, { n: number; total: number }>();
  for (const c of contracts) {
    const cur = contractsBy.get(c.contractorId) ?? { n: 0, total: 0 };
    contractsBy.set(c.contractorId, { n: cur.n + 1, total: cur.total + c.amount + c.changeOrders.reduce((n, x) => n + x.amount, 0) });
  }
  const by = new Map<string, typeof quotes>();
  for (const q of quotes) by.set(q.contractorId, [...(by.get(q.contractorId) ?? []), q]);
  const docsBy = new Map<string, DocRow[]>();
  for (const d of docs) if (d.contractorId) docsBy.set(d.contractorId, [...(docsBy.get(d.contractorId) ?? []), docRow(d)]);
  return {
    today,
    contractors: contractors.map((c) => {
      const mine = by.get(c.id) ?? [];
      return {
        ...c,
        flags: contractorFlags(c, today),
        asked: mine.length,
        quoted: mine.filter((q) => q.amount != null && !["ASKED", "VIEWED"].includes(q.status)).length,
        awarded: mine.filter((q) => ["AWARDED", "INVOICED", "PAID"].includes(q.status)).length,
        paidTotal: r2(mine.filter((q) => q.status === "PAID").reduce((n, q) => n + (q.invoiceAmount ?? q.amount ?? 0), 0)),
        lastAskedAt: mine.length ? mine.reduce((m, q) => (q.askedAt > m ? q.askedAt : m), mine[0].askedAt).toISOString() : null,
        documents: docsBy.get(c.id) ?? [],
        contracts: contractsBy.get(c.id)?.n ?? 0,
        contractsTotal: r2(contractsBy.get(c.id)?.total ?? 0),
      };
    }),
  };
}

// ── the request ──────────────────────────────────────────────────────────────

export type AskInput = {
  projectId: string;
  stageId: string | null;
  contractorIds: string[];
  scope: string;
  dueBy: string | null;
  title?: string | null;
  trade?: string | null;
  description?: string | null;
  materials?: string | null;
  labor?: string | null;
  /** ISO days. */
  startsAt?: string | null;
  endsAt?: string | null;
  instructions?: string | null;
  /** Project Files attached by id, and drawings uploaded for this request (SubDocuments, kind PLAN). */
  fileIds?: string[] | null;
  documentIds?: string[] | null;
};
export type SendState = "sent" | "none" | "failed";
export type AskResult = { requestId: string; requestNumber: number; asked: Array<{ quoteId: string; number: number; contractor: string; link: string; email: SendState; text: SendState }> };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function scopeHtml(scope: string): string {
  const [head, ...lines] = scope.split("\n");
  return `<p><b>${esc(head)}</b></p>${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l.replace(/^-\s*/, ""))}</li>`).join("")}</ul>` : ""}`;
}

type AskMail = { company: string; to: string; project: string; requestNo: string; scope: string; description: string | null; materials: string | null; labor: string | null; dates: string | null; replyBy: string | null; attachments: number; link: string; phone: string | null };

function askHtml(i: AskMail): string {
  const para = (label: string, text: string | null) => (text ? `<p><b>${esc(label)}:</b> ${esc(text).replace(/\n/g, "<br>")}</p>` : "");
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} would like your quote for this work on ${esc(i.project)} (${esc(i.requestNo)}):</p>${scopeHtml(i.scope)}${para("Details", i.description)}${para("Materials", i.materials)}${para("Labor", i.labor)}${i.dates ? `<p><b>When:</b> ${esc(i.dates)}</p>` : ""}${i.attachments ? `<p>${i.attachments} ${i.attachments === 1 ? "file is" : "files are"} attached to the request — the drawings and photos open from the page.</p>` : ""}${i.replyBy ? `<p>Please reply by ${esc(i.replyBy)}.</p>` : ""}<p><a href="${esc(i.link)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:4px">Open the request and send your price</a></p><p>The link opens a short page: the scope and the files, your price with your estimate attached (a PDF or a picture), a note, and later your invoice. No sign-in.</p>${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function awardHtml(i: { company: string; to: string; project: string; scope: string; amount: number | null; link: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} is going with your quote${i.amount != null ? ` (${dollars(i.amount)})` : ""} for ${esc(i.project)} — thank you.</p>${scopeHtml(i.scope)}<p>When the work is done, send your invoice here: <a href="${esc(i.link)}">${esc(i.link)}</a></p>${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function revisionHtml(i: { company: string; to: string; project: string; note: string | null; link: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} would like a revised quote for ${esc(i.project)}.</p>${i.note ? `<p>${esc(i.note).replace(/\n/g, "<br>")}</p>` : ""}<p><a href="${esc(i.link)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:4px">Open the request and send a new price</a></p><p>Your earlier price stays on file; the new one is a new version.</p>${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function declinedHtml(i: { company: string; to: string; project: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>Thank you for quoting ${esc(i.project)}. ${esc(i.company)} went another way this time — we'll be in touch on the next one.</p>${i.phone ? `<p>${esc(i.phone)}</p>` : ""}`;
}

/** The office's email: one line, one button to the project's Subcontractors (lib/email/renderEmail owns the markup). */
function officeDoc(i: { org: { name: string; logoUrl: string | null; phone: string | null }; line: string; href: string }): EmailDoc {
  return {
    subject: i.line.slice(0, 120),
    lockup: { kind: "org", name: i.org.name, logoUrl: i.org.logoUrl },
    kicker: { text: "Subcontractors" },
    headline: i.line.slice(0, 200),
    cta: { label: "Open the project's subcontractors", href: i.href },
    footer: { name: i.org.name, contact: i.org.phone ?? undefined },
  };
}

/** The office, by text (those who ticked Text), by email (everyone whose "Subcontractor quotes" is on) and in the bell
 *  (a SUB_QUOTE row with the section's link). */
export async function tellOffice(organizationId: string, projectId: string, line: string, meta: Record<string, unknown>, pathOverride?: string, opts: { kind?: string; pref?: PrefKey } = {}): Promise<void> {
  try {
    const base = await appBaseUrl();
    const path = pathOverride ?? `/dashboard/projects/${projectId}/subs?tab=quotes`;
    const href = `${base}${path}`;
    // Part 4: a contract event rings as SUB_CONTRACT under the "Subcontracts" preference; everything else as before.
    const pref: PrefKey = opts.pref ?? "sub-quote";
    await logActivity({ organizationId, actorId: null, kind: opts.kind ?? SUB_EVENT_KIND, summary: line, meta: { projectId, href: path, ...meta } });
    await textOffice(organizationId, pref, `${line} ${href}`);
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true, phone: true } });
    await sendToMembersByPref(organizationId, pref, officeDoc({ org: { name: org?.name ?? "JobFlex", logoUrl: org?.logoUrl ?? null, phone: org?.phone ?? null }, line, href }));
  } catch (err) {
    console.warn(`[projectSubs] could not tell the office: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type OrgRow = { id: string; name: string | null; phone: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; billingEmail: string | null; deletedAt: Date | null };
type SendWhat = "ask" | "award" | "revision" | "reminder";

async function sendAsk(org: OrgRow, project: { id: string; name: string; number: number | null }, c: { name: string; email: string | null; phone: string | null; textsOptOut?: boolean }, q: { scope: string; dueBy: Date | null; publicToken: string; revisionNote?: string | null; request?: { number: number; description: string | null; materials: string | null; labor: string | null; startsAt: Date | null; endsAt: Date | null; attachments: number } | null }, what: SendWhat): Promise<{ link: string; email: SendState; text: SendState }> {
  const base = await appBaseUrl();
  const link = `${base}/q/${q.publicToken}`;
  const company = org.name ?? "Our company";
  const label = `${project.name}${project.number ? ` (#${project.number})` : ""}`;
  const dates = q.request?.startsAt || q.request?.endsAt ? [q.request?.startsAt ? `starts ${dayWords(q.request.startsAt)}` : null, q.request?.endsAt ? `done by ${dayWords(q.request.endsAt)}` : null].filter(Boolean).join(", ") : null;
  let email: SendState = "none";
  let text: SendState = "none";
  // Part 2: when replies by email are on, the letter's Reply-To is the request's own address (the token in it names
  // this recipient row) and the subject carries [RFQ-n] as the fallback — the sub's answer, estimate attached, lands
  // on the quote by itself (lib/subInbound). Off, the company's own reply-to stays.
  const replyTo = inboundReplyTo(q.publicToken);
  const tag = q.request ? ` ${subjectTag(q.request.number)}` : "";
  if (c.email) {
    try {
      const ask = () => askHtml({ company, to: c.name, project: label, requestNo: q.request ? requestNo(q.request.number) : "quote request", scope: q.scope, description: q.request?.description ?? null, materials: q.request?.materials ?? null, labor: q.request?.labor ?? null, dates, replyBy: dayWords(q.dueBy), attachments: q.request?.attachments ?? 0, link, phone: org.phone });
      const hint = replyTo ? `<p>${esc(REPLY_HINT)}</p>` : "";
      const html =
        what === "ask"
          ? ask() + hint
          : what === "reminder"
            ? `<p><b>A reminder:</b> ${esc(company)} would like your quote${q.dueBy ? ` by ${esc(dayWords(q.dueBy) ?? "")}` : " soon"}.</p>` + ask() + hint
            : what === "award"
              ? awardHtml({ company, to: c.name, project: label, scope: q.scope, amount: null, link, phone: org.phone })
              : revisionHtml({ company, to: c.name, project: label, note: q.revisionNote ?? null, link, phone: org.phone }) + hint;
      await sendOrgEmail(org, { mailClass: "transactional",
        to: c.email,
        subject:
          what === "ask"
            ? `Quote request — ${company} — ${project.name}${tag}`
            : what === "reminder"
              ? `Reminder: your quote is due — ${company} — ${project.name}${tag}`
              : what === "award"
                ? `You've got the work — ${company} — ${project.name}${tag}`
                : `Revised quote, please — ${company} — ${project.name}${tag}`,
        html,
        ...(replyTo && what !== "award" ? { replyTo } : {}),
      });
      email = "sent";
    } catch (err) {
      console.warn(`[projectSubs] email to ${c.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      email = "failed";
    }
  }
  if (c.phone && !c.textsOptOut) {
    const body =
      what === "ask"
        ? askText(company, project.name, dayWords(q.dueBy), link)
        : what === "reminder"
          ? `Reminder — ${askText(company, project.name, dayWords(q.dueBy), link)}`
          : what === "award"
            ? awardText(company, project.name, link)
            : revisionText(company, project.name, q.revisionNote ?? null, link);
    const r = await sendText({ organizationId: org.id, to: c.phone, body, kind: "sub-quote" });
    text = r.ok && (r.status === "SENT" || r.status === "HELD") ? "sent" : r.ok ? "none" : "failed";
  }
  return { link, email, text };
}

/** Send a request for quotes: one SubRequest, one recipient row per contractor, each with its own link; the drawings
 *  uploaded for it are tied to it. The Operator's ask (scope + day only) comes through here too. */
export async function askQuotes(organizationId: string, actorId: string | null, input: AskInput): Promise<AskResult> {
  const project = await db.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true, name: true, number: true, clientId: true, organization: { select: ORG_SELECT } } });
  if (!project) throw new Error("Project not found");
  const stage = input.stageId ? await db.projectStage.findFirst({ where: { id: input.stageId, projectId: project.id }, select: { id: true, name: true } }) : null;
  if (input.stageId && !stage) throw new Error("Stage not found");
  const ids = [...new Set(input.contractorIds)];
  const contractors = await db.contractor.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true, email: true, phone: true, textsOptOut: true } });
  if (contractors.length !== ids.length) throw new Error("A contractor is not on your list");
  const scope = input.scope.trim().slice(0, 2000);
  const dueBy = day(input.dueBy);
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  // The project's Files attached by id — only the project's own.
  const fileIds = input.fileIds?.length ? (await db.projectFile.findMany({ where: { id: { in: input.fileIds }, projectId: project.id }, select: { id: true } })).map((f) => f.id) : [];
  const docIds = input.documentIds?.length ? (await db.subDocument.findMany({ where: { id: { in: input.documentIds }, organizationId, requestId: null }, select: { id: true } })).map((d) => d.id) : [];
  const top = await db.subRequest.aggregate({ where: { organizationId }, _max: { number: true } });
  const request = await db.subRequest.create({
    data: {
      organizationId,
      projectId: project.id,
      stageId: stage?.id ?? null,
      number: Math.max(REQUEST_FIRST_NUMBER, (top._max.number ?? REQUEST_FIRST_NUMBER - 1) + 1),
      trade: trim(input.trade, 60),
      title: requestTitleFor(trim(input.title, 120) ?? stage?.name ?? null, trim(input.trade, 60), project.name),
      scope,
      description: trim(input.description, 4000),
      materials: trim(input.materials, 2000),
      labor: trim(input.labor, 2000),
      fileIdsJson: fileIds.length ? JSON.stringify(fileIds) : null,
      startsAt: day(input.startsAt),
      endsAt: day(input.endsAt),
      dueBy,
      instructions: trim(input.instructions, 2000),
      status: "SENT",
      sentAt: now,
      createdById: actorId,
    },
    select: { id: true, number: true, description: true, materials: true, labor: true, startsAt: true, endsAt: true },
  });
  if (docIds.length) await db.subDocument.updateMany({ where: { id: { in: docIds } }, data: { requestId: request.id, projectId: project.id, kind: "PLAN" } });
  const attachments = fileIds.length + docIds.length;
  const topQ = await db.projectSubQuote.aggregate({ where: { projectId: project.id }, _max: { number: true } });
  let number = topQ._max.number ?? 0;
  const asked: AskResult["asked"] = [];
  for (const c of contractors) {
    number += 1;
    const q = await db.projectSubQuote.create({
      data: { organizationId, projectId: project.id, stageId: stage?.id ?? null, contractorId: c.id, requestId: request.id, number, scope, dueBy, sentAt: now, expiresAt: new Date(`${linkExpiry(input.dueBy, todayIso)}T23:59:59.000Z`), createdById: actorId },
      select: { id: true, number: true, scope: true, dueBy: true, publicToken: true },
    });
    const sent = await sendAsk(project.organization, project, c, { ...q, request: { ...request, attachments } }, "ask");
    asked.push({ quoteId: q.id, number: q.number, contractor: c.name, ...sent });
  }
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Sent ${requestNo(request.number)} — ${stage?.name ?? "the project"} on ${project.name} — to ${contractors.map((c) => c.name).join(", ")}`,
    clientId: project.clientId,
    meta: { projectId: project.id, stageId: stage?.id ?? null, requestId: request.id, quotes: asked.map((a) => a.quoteId) },
  });
  return { requestId: request.id, requestNumber: request.number, asked };
}

/** The request is withdrawn: the recipients still open are cancelled (they are not told automatically — the page
 *  says the request is closed). */
export async function cancelRequest(organizationId: string, requestId: string, actorId: string | null): Promise<{ projectId: string }> {
  const r = await db.subRequest.findFirst({ where: { id: requestId, organizationId }, select: { id: true, number: true, projectId: true, project: { select: { name: true, clientId: true } } } });
  if (!r) throw new Error("Request not found");
  const now = new Date();
  await db.subRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
  await db.projectSubQuote.updateMany({ where: { requestId: r.id, status: { in: ["ASKED", "VIEWED", "QUOTED", "REVISION"] } }, data: { status: "CANCELLED", declinedAt: now } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Cancelled ${requestNo(r.number)} on ${r.project.name}`, clientId: r.project.clientId, meta: { projectId: r.projectId, requestId: r.id } });
  return { projectId: r.projectId };
}

async function quoteOf(organizationId: string, quoteId: string) {
  const q = await db.projectSubQuote.findFirst({
    where: { id: quoteId, organizationId },
    select: {
      id: true,
      number: true,
      projectId: true,
      stageId: true,
      requestId: true,
      status: true,
      scope: true,
      amount: true,
      dueBy: true,
      invoiceAmount: true,
      expenseId: true,
      publicToken: true,
      currentVersionId: true,
      revisionNote: true,
      contractor: { select: { id: true, name: true, email: true, phone: true, textsOptOut: true } },
      stage: { select: { name: true } },
      project: { select: { id: true, name: true, number: true, clientId: true, organization: { select: ORG_SELECT } } },
    },
  });
  if (!q) throw new Error("Quote not found");
  return q;
}

/** The office goes with this quote: the version in hand is the approved one, the others asked on the same request
 *  (or the same stage, for the older rows) are declined and told, and the request is closed. */
export async function awardQuote(organizationId: string, quoteId: string, actorId: string | null): Promise<{ projectId: string }> {
  const q = await quoteOf(organizationId, quoteId);
  if (q.status !== "QUOTED") throw new Error(q.status === "AWARDED" ? "It is awarded already." : "Only a quote that came in can be awarded.");
  const now = new Date();
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "AWARDED", awardedAt: now, approvedVersionId: q.currentVersionId } });
  if (q.currentVersionId) await db.subQuoteVersion.updateMany({ where: { id: q.currentVersionId }, data: { approved: true } });
  const others = await db.projectSubQuote.findMany({
    where: { projectId: q.projectId, id: { not: q.id }, status: { in: ["ASKED", "VIEWED", "QUOTED", "REVISION"] }, ...(q.requestId ? { requestId: q.requestId } : { stageId: q.stageId }) },
    select: { id: true, contractor: { select: { name: true, email: true } } },
  });
  if (others.length) await db.projectSubQuote.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "DECLINED", declinedAt: now, declineReason: "The work went to another quote." } });
  if (q.requestId) await db.subRequest.updateMany({ where: { id: q.requestId }, data: { status: "CLOSED" } });
  await sendAsk(q.project.organization, q.project, q.contractor, q, "award");
  const company = q.project.organization.name ?? "Our company";
  for (const o of others) {
    if (!o.contractor.email) continue;
    try {
      await sendOrgEmail(q.project.organization, { mailClass: "transactional", to: o.contractor.email, subject: `About the quote for ${q.project.name} — ${company}`, html: declinedHtml({ company, to: o.contractor.name, project: q.project.name, phone: q.project.organization.phone }) });
    } catch (err) {
      console.warn(`[projectSubs] decline email to ${o.contractor.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Awarded ${q.stage?.name ?? "the work"} on ${q.project.name} to ${q.contractor.name}${q.amount != null ? ` (${dollars(q.amount)})` : ""}`,
    clientId: q.project.clientId,
    meta: { projectId: q.projectId, quoteId: q.id, requestId: q.requestId, versionId: q.currentVersionId, declined: others.map((o) => o.id) },
  });
  return { projectId: q.projectId };
}

export async function declineQuote(organizationId: string, quoteId: string, actorId: string | null, reason: string | null = null): Promise<{ projectId: string }> {
  const q = await quoteOf(organizationId, quoteId);
  if (!["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status)) throw new Error("Only a quote still open can be declined.");
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "DECLINED", declinedAt: new Date(), declineReason: trim(reason, 300) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Declined ${q.contractor.name}'s quote on ${q.project.name}${reason ? ` — ${reason.slice(0, 120)}` : ""}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id } });
  return { projectId: q.projectId };
}

/** The office asks for a revised price: the quote goes back to the sub with the note; their earlier version stays. */
export async function requestRevision(organizationId: string, quoteId: string, note: string | null, actorId: string | null): Promise<{ projectId: string; email: SendState; text: SendState }> {
  const q = await quoteOf(organizationId, quoteId);
  if (q.status !== "QUOTED") throw new Error("Only a quote that came in can be sent back for a revision.");
  const revisionNote = trim(note, 1000);
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "REVISION", revisionNote } });
  const r = await sendAsk(q.project.organization, q.project, q.contractor, { ...q, revisionNote }, "revision");
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Asked ${q.contractor.name} for a revised quote on ${q.project.name}${revisionNote ? ` — ${revisionNote.slice(0, 120)}` : ""}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id } });
  return { projectId: q.projectId, email: r.email, text: r.text };
}

/** The contractor is paid: a Subcontractors expense for the invoice (or the amount typed), dated today. */
export async function markQuotePaid(organizationId: string, quoteId: string, amount: number | null, actorId: string | null): Promise<{ projectId: string; expenseId: string }> {
  const q = await quoteOf(organizationId, quoteId);
  if (!["AWARDED", "INVOICED", "PAID"].includes(q.status)) throw new Error("Award the quote first.");
  // Part 5a: a quote with invoices or recorded payments is paid on its invoices (the Invoices tab) — a lump "paid"
  // here would count the money twice.
  const [invoices, payments] = await Promise.all([db.subInvoice.count({ where: { quoteId: q.id, status: { not: "VOID" } } }), db.subPayment.count({ where: { quoteId: q.id, status: "RECORDED" } })]);
  if (invoices || payments) throw new Error("This work has invoices — record the payment on them in the Invoices tab.");
  const amt = r2(Math.max(0, amount ?? q.invoiceAmount ?? q.amount ?? 0));
  if (!(amt > 0)) throw new Error("How much was paid?");
  const vendor = q.contractor.name;
  const note = `Quote ${q.number}${q.stage ? ` · ${q.stage.name}` : ""}`;
  const now = new Date();
  // The cost lands on the quote's stage's phase (part 5), so the Money card reads it per phase.
  const phaseId = q.stageId ? ((await db.projectStage.findUnique({ where: { id: q.stageId }, select: { phaseId: true } }))?.phaseId ?? null) : null;
  let expenseId = q.expenseId;
  if (expenseId && (await db.projectExpense.findFirst({ where: { id: expenseId, projectId: q.projectId }, select: { id: true } }))) {
    await db.projectExpense.update({ where: { id: expenseId }, data: { amount: amt, vendor, note, paidAt: now, phaseId } });
  } else {
    expenseId = (await db.projectExpense.create({ data: { projectId: q.projectId, category: "SUBCONTRACTORS", amount: amt, vendor, note, spentAt: now, paidAt: now, phaseId, createdById: actorId }, select: { id: true } })).id;
  }
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "PAID", paidAt: now, expenseId, invoiceAmount: q.invoiceAmount ?? amt } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Paid ${q.contractor.name} ${dollars(amt)} on ${q.project.name}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id, expenseId } });
  return { projectId: q.projectId, expenseId };
}

/** The request (or the award, or the revision ask) sent again. */
export async function resendQuote(organizationId: string, quoteId: string): Promise<{ projectId: string; email: SendState; text: SendState }> {
  const q = await quoteOf(organizationId, quoteId);
  const what: SendWhat = q.status === "AWARDED" || q.status === "INVOICED" ? "award" : q.status === "REVISION" ? "revision" : "ask";
  const request = q.requestId ? await db.subRequest.findUnique({ where: { id: q.requestId }, select: { number: true, description: true, materials: true, labor: true, startsAt: true, endsAt: true, fileIdsJson: true, documents: { where: { kind: "PLAN" }, select: { id: true } } } }) : null;
  const attachments = request ? (JSON.parse(request.fileIdsJson ?? "[]") as string[]).length + request.documents.length : 0;
  const r = await sendAsk(q.project.organization, q.project, q.contractor, { ...q, request: request ? { ...request, attachments } : null }, what);
  return { projectId: q.projectId, email: r.email, text: r.text };
}

// ── versions ─────────────────────────────────────────────────────────────────

export type VersionRow = {
  id: string;
  version: number;
  amount: number | null;
  note: string | null;
  source: string;
  submittedAt: string;
  approved: boolean;
  reviewStatus: string;
  document: DocRow | null;
  /** Part 2: the AI's read of the document (lib/subQuotes), its state in `reviewStatus`, and the last failure. */
  read: StoredRead | null;
  readError: string | null;
  readAttempts: number;
  reviewedAt: string | null;
};

const VERSION_SELECT = { id: true, version: true, amount: true, note: true, source: true, submittedAt: true, approved: true, reviewStatus: true, extractedJson: true, readError: true, readAttempts: true, reviewedAt: true, document: { select: DOC_SELECT } } as const;
const versionRow = (v: { id: string; version: number; amount: number | null; note: string | null; source: string; submittedAt: Date; approved: boolean; reviewStatus: string; extractedJson: string | null; readError: string | null; readAttempts: number; reviewedAt: Date | null; document: Parameters<typeof docRow>[0] | null }): VersionRow => ({
  id: v.id,
  version: v.version,
  amount: v.amount,
  note: v.note,
  source: v.source,
  submittedAt: v.submittedAt.toISOString(),
  approved: v.approved,
  reviewStatus: v.reviewStatus,
  document: v.document ? docRow(v.document) : null,
  read: parseStoredRead(v.extractedJson),
  readError: v.readError,
  readAttempts: v.readAttempts,
  reviewedAt: iso(v.reviewedAt),
});

type FileIn = { url: string; name: string; contentType: string | null; bytes: number | null };

/** One more version on a recipient row — the sub's price from their page, the office's upload on their behalf, or
 *  (part 2) the document out of their email — with its document; the row's own amount and note follow the newest.
 *  A document queues the AI's read (reviewStatus PENDING, run by the sweep or the webhook's after()). The document
 *  is a file kept just now, or one already in the store (a held letter's) handed over by id. */
async function addVersion(
  q: { id: string; organizationId: string; projectId: string; requestId: string | null; contractorId: string; status: string },
  input: { amount: number | null; note: string | null; file: FileIn | null; documentId?: string | null; inboundEmailId?: string | null; source: "PORTAL" | "UPLOAD" | "EMAIL"; by: string | null; via: "SUB" | "OFFICE" | "EMAIL" },
): Promise<VersionRow> {
  let documentId: string | null = null;
  if (input.documentId) {
    const existing = await db.subDocument.findFirst({ where: { id: input.documentId, organizationId: q.organizationId }, select: { id: true } });
    if (!existing) throw new Error("That document is not here.");
    await db.subDocument.update({ where: { id: existing.id }, data: { kind: "QUOTE", projectId: q.projectId, contractorId: q.contractorId, requestId: q.requestId } });
    documentId = existing.id;
  } else if (input.file) {
    const doc = await recordDocument({ organizationId: q.organizationId, projectId: q.projectId, contractorId: q.contractorId, requestId: q.requestId, kind: "QUOTE", name: input.file.name, url: input.file.url, contentType: input.file.contentType, bytes: input.file.bytes, uploadedVia: input.via, uploadedById: input.by, inboundEmailId: input.inboundEmailId ?? null });
    documentId = doc.id;
  }
  const top = await db.subQuoteVersion.aggregate({ where: { quoteId: q.id }, _max: { version: true } });
  const now = new Date();
  const v = await db.subQuoteVersion.create({
    data: { organizationId: q.organizationId, quoteId: q.id, version: (top._max.version ?? 0) + 1, amount: input.amount != null ? r2(input.amount) : null, note: trim(input.note, 1000), documentId, source: input.source, submittedAt: now, submittedById: input.by, reviewStatus: documentId ? "PENDING" : "NONE" },
    select: VERSION_SELECT,
  });
  const reopened = ["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status);
  await db.projectSubQuote.update({
    where: { id: q.id },
    data: { currentVersionId: v.id, amount: v.amount ?? undefined, note: v.note, quotedAt: now, revisionNote: null, ...(reopened ? { status: "QUOTED" } : {}) },
  });
  return versionRow(v);
}

/** The office puts a sub's estimate on the row for them (it came by hand, by text, in person). */
export async function addVersionByOffice(organizationId: string, quoteId: string, input: { amount: number | null; note: string | null; file: FileIn | null }, actorId: string | null): Promise<{ projectId: string; version: VersionRow }> {
  const q = await quoteOf(organizationId, quoteId);
  if (input.amount == null && !input.file) throw new Error("A price or the document, please.");
  if (!["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED"].includes(q.status)) throw new Error("This quote is closed.");
  const version = await addVersion({ id: q.id, organizationId, projectId: q.projectId, requestId: q.requestId, contractorId: q.contractor.id, status: q.status }, { amount: input.amount, note: input.note, file: input.file, source: "UPLOAD", by: actorId, via: "OFFICE" });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added ${q.contractor.name}'s quote V${version.version}${version.amount != null ? ` (${dollars(version.amount)})` : ""}${version.document ? ` — ${version.document.name}` : ""} on ${q.project.name}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id, versionId: version.id } });
  return { projectId: q.projectId, version };
}

/** A sub's reply by email (part 2, lib/subInbound): the letter's document becomes a version on the recipient row —
 *  a file kept just now, or a document the letter already left in the store — with the read queued. */
export async function addVersionFromEmail(quoteId: string, input: { note: string | null; file: FileIn | null; documentId: string | null; inboundEmailId: string }): Promise<{ version: VersionRow; projectId: string; organizationId: string }> {
  const q = await db.projectSubQuote.findUnique({ where: { id: quoteId }, select: { id: true, organizationId: true, projectId: true, requestId: true, contractorId: true, status: true } });
  if (!q) throw new Error("Quote not found");
  if (!["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED"].includes(q.status)) throw new Error("This quote is closed.");
  const version = await addVersion(q, { amount: null, note: input.note, file: input.file, documentId: input.documentId, inboundEmailId: input.inboundEmailId, source: "EMAIL", by: null, via: "EMAIL" });
  return { version, projectId: q.projectId, organizationId: q.organizationId };
}

/** The inbound door (part 2): the recipient row behind the token in a reply address, with what the letter's handler
 *  needs to decide — whose it is, whether it still takes a quote, and the sub's address on file. */
export type InboundDoor = { quoteId: string; organizationId: string; projectId: string; projectName: string; requestId: string | null; requestNumber: number | null; contractorId: string; contractorName: string; contractorEmail: string | null; what: string; status: string; closed: boolean };
export async function quoteByToken(token: string): Promise<InboundDoor | null> {
  const q = await db.projectSubQuote.findUnique({
    where: { publicToken: token },
    select: { id: true, organizationId: true, projectId: true, requestId: true, contractorId: true, status: true, expiresAt: true, contractor: { select: { name: true, email: true } }, stage: { select: { name: true } }, request: { select: { number: true } }, project: { select: { name: true, organization: { select: { deletedAt: true, timezone: true } } } } },
  });
  if (!q || q.project.organization.deletedAt) return null;
  const today = localDayKey(new Date(), q.project.organization.timezone || "America/New_York");
  const closed = linkClosed(q.status, isoDay(q.expiresAt), today) || !["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status);
  return { quoteId: q.id, organizationId: q.organizationId, projectId: q.projectId, projectName: q.project.name, requestId: q.requestId, requestNumber: q.request?.number ?? null, contractorId: q.contractorId, contractorName: q.contractor.name, contractorEmail: q.contractor.email, what: q.stage?.name ?? "the work", status: q.status, closed };
}

// ── the sweep (part 2, lib/subQuotes/sweep) ──────────────────────────────────

/** Links past their expiry close: a recipient still waiting (sent or viewed) becomes EXPIRED, and a request whose
 *  every recipient is out closes with them. Returns how many recipients expired. */
export async function expireRequests(now = new Date()): Promise<number> {
  const due = await db.projectSubQuote.findMany({ where: { status: { in: ["ASKED", "VIEWED"] }, expiresAt: { lt: now } }, select: { id: true, requestId: true, organizationId: true, projectId: true, contractor: { select: { name: true } }, project: { select: { name: true } } }, take: 200 });
  if (!due.length) return 0;
  await db.projectSubQuote.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: "EXPIRED" } });
  for (const d of due) await logActivity({ organizationId: d.organizationId, actorId: null, kind: TRAIL_KINDS.PROJECT, summary: `${d.contractor.name}'s request on ${d.project.name} expired without a quote`, meta: { projectId: d.projectId, quoteId: d.id, requestId: d.requestId } });
  for (const id of [...new Set(due.map((d) => d.requestId).filter((x): x is string => Boolean(x)))]) {
    const open = await db.projectSubQuote.count({ where: { requestId: id, status: { in: ["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED", "INVOICED"] } } });
    if (!open) await db.subRequest.updateMany({ where: { id, status: "SENT" }, data: { status: "CLOSED" } });
  }
  return due.length;
}

/** One reminder to each sub whose reply is due tomorrow (or today, when yesterday's sweep missed) and who has not
 *  answered; stamped so it goes once. Returns how many were reminded. */
export async function remindDue(now = new Date()): Promise<number> {
  const rows = await db.projectSubQuote.findMany({
    // No reminder goes to a sub for a company on the Free plan (owner, 2026-11-09).
    where: { status: { in: ["ASKED", "VIEWED"] }, remindedAt: null, dueBy: { not: null }, organizationId: { notIn: await lapsedOrgIds() } },
    select: { id: true, dueBy: true, scope: true, publicToken: true, contractor: { select: { name: true, email: true, phone: true, textsOptOut: true } }, request: { select: { number: true, description: true, materials: true, labor: true, startsAt: true, endsAt: true, fileIdsJson: true, documents: { where: { kind: "PLAN" }, select: { id: true } } } }, project: { select: { id: true, name: true, number: true, organization: { select: ORG_SELECT } } } },
    take: 100,
  });
  let n = 0;
  for (const q of rows) {
    if (q.project.organization.deletedAt) continue;
    const tz = q.project.organization.timezone || "America/New_York";
    const due = isoDay(q.dueBy);
    if (due !== localDayKey(new Date(now.getTime() + 86_400_000), tz) && due !== localDayKey(now, tz)) continue;
    if (!q.contractor.email && !q.contractor.phone) {
      await db.projectSubQuote.update({ where: { id: q.id }, data: { remindedAt: now } });
      continue;
    }
    let fileIds = 0;
    try {
      fileIds = (JSON.parse(q.request?.fileIdsJson ?? "[]") as string[]).length;
    } catch {
      fileIds = 0;
    }
    await sendAsk(q.project.organization, q.project, q.contractor, { ...q, request: q.request ? { ...q.request, attachments: fileIds + q.request.documents.length } : null }, "reminder");
    await db.projectSubQuote.update({ where: { id: q.id }, data: { remindedAt: now } });
    n += 1;
  }
  return n;
}

// ── the contractor's page ────────────────────────────────────────────────────

export type QuoteView = {
  company: string;
  phone: string | null;
  project: string;
  contractor: string;
  stage: string | null;
  requestNo: string | null;
  title: string | null;
  scope: string;
  description: string | null;
  materials: string | null;
  labor: string | null;
  /** ISO days. */
  startsAt: string | null;
  endsAt: string | null;
  instructions: string | null;
  attachments: Array<{ id: string; name: string; kind: string; href: string }>;
  replyBy: string | null;
  status: string;
  /** The link no longer takes a price (finished, or past its expiry). */
  closed: boolean;
  canQuote: boolean;
  canInvoice: boolean;
  revisionNote: string | null;
  amount: number | null;
  note: string | null;
  versions: Array<{ version: number; amount: number | null; note: string | null; submittedAt: string; document: { name: string; href: string } | null }>;
  invoiceAmount: number | null;
  invoiceUrl: string | null;
  paid: boolean;
  /** Part 5a: the signed subcontract's page, where invoices go once there is one. */
  contractLink: string | null;
};

/** The sub's door: the recipient row behind a token, whether it still takes a price, and whose it is. */
export async function tokenDoor(token: string): Promise<{ quoteId: string; organizationId: string; projectId: string; requestId: string | null; contractorId: string; status: string; canQuote: boolean } | null> {
  const q = await db.projectSubQuote.findUnique({ where: { publicToken: token }, select: { id: true, organizationId: true, projectId: true, requestId: true, contractorId: true, status: true, expiresAt: true, project: { select: { organization: { select: { deletedAt: true, timezone: true } } } } } });
  if (!q || q.project.organization.deletedAt) return null;
  const today = localDayKey(new Date(), q.project.organization.timezone || "America/New_York");
  const closed = linkClosed(q.status, isoDay(q.expiresAt), today);
  return { quoteId: q.id, organizationId: q.organizationId, projectId: q.projectId, requestId: q.requestId, contractorId: q.contractorId, status: q.status, canQuote: !closed && ["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status) };
}

export async function quoteView(token: string): Promise<QuoteView | null> {
  const q = await db.projectSubQuote.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      status: true,
      scope: true,
      dueBy: true,
      amount: true,
      note: true,
      viewedAt: true,
      expiresAt: true,
      revisionNote: true,
      invoiceAmount: true,
      invoiceUrl: true,
      contractor: { select: { name: true } },
      stage: { select: { name: true } },
      request: { select: { id: true, number: true, title: true, description: true, materials: true, labor: true, startsAt: true, endsAt: true, instructions: true, fileIdsJson: true, documents: { where: { kind: "PLAN" }, select: DOC_SELECT } } },
      versions: { orderBy: { version: "asc" }, select: VERSION_SELECT },
      project: { select: { id: true, name: true, number: true, organization: { select: { name: true, phone: true, deletedAt: true, timezone: true } } } },
      contracts: { where: { status: "EXECUTED" }, take: 1, select: { publicToken: true } },
    },
  });
  if (!q || q.project.organization.deletedAt) return null;
  // The first open is the "viewed" stamp — the office sees the request was read.
  if (q.status === "ASKED" && !q.viewedAt) {
    await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "VIEWED", viewedAt: new Date() } }).catch(() => null);
    q.status = "VIEWED";
  }
  const fileIds = (() => {
    try {
      const v = JSON.parse(q.request?.fileIdsJson ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();
  const files = fileIds.length ? await db.projectFile.findMany({ where: { id: { in: fileIds }, projectId: q.project.id }, select: { id: true, name: true, kind: true } }) : [];
  const today = localDayKey(new Date(), q.project.organization.timezone || "America/New_York");
  const closed = linkClosed(q.status, isoDay(q.expiresAt), today);
  const href = (id: string) => `/api/q/${token}/file/${id}`;
  return {
    company: q.project.organization.name ?? "The company",
    phone: q.project.organization.phone,
    project: `${q.project.name}${q.project.number ? ` (#${q.project.number})` : ""}`,
    contractor: q.contractor.name,
    stage: q.stage?.name ?? null,
    requestNo: q.request ? requestNo(q.request.number) : null,
    title: q.request?.title ?? null,
    scope: q.scope,
    description: q.request?.description ?? null,
    materials: q.request?.materials ?? null,
    labor: q.request?.labor ?? null,
    startsAt: isoDay(q.request?.startsAt),
    endsAt: isoDay(q.request?.endsAt),
    instructions: q.request?.instructions ?? null,
    attachments: [...files.map((f) => ({ id: f.id, name: f.name, kind: FILE_KIND_LABEL[fileKindOf(f.kind)], href: href(f.id) })), ...(q.request?.documents ?? []).map((d) => ({ id: d.id, name: d.name, kind: "Drawing", href: href(d.id) }))],
    replyBy: isoDay(q.dueBy),
    status: q.status,
    closed,
    canQuote: !closed && ["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status),
    canInvoice: q.status === "AWARDED" || q.status === "INVOICED",
    revisionNote: q.status === "REVISION" ? q.revisionNote : null,
    amount: q.amount,
    note: q.note,
    versions: q.versions.map((v) => ({ version: v.version, amount: v.amount, note: v.note, submittedAt: v.submittedAt.toISOString(), document: v.document ? { name: v.document.name, href: href(v.document.id) } : null })),
    invoiceAmount: q.invoiceAmount,
    invoiceUrl: q.invoiceUrl,
    paid: q.status === "PAID",
    contractLink: q.contracts[0] ? `/s/${q.contracts[0].publicToken}` : null,
  };
}

/** A file the sub's token may read: a project File attached to their request, a drawing uploaded for it, or a
 *  document on one of their own versions. */
export async function documentForToken(token: string, id: string): Promise<{ url: string; name: string; contentType: string | null; isLink: boolean } | null> {
  const door = await tokenDoor(token);
  if (!door) return null;
  const request = door.requestId ? await db.subRequest.findUnique({ where: { id: door.requestId }, select: { fileIdsJson: true } }) : null;
  const fileIds = (() => {
    try {
      const v = JSON.parse(request?.fileIdsJson ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();
  if (fileIds.includes(id)) {
    const f = await db.projectFile.findFirst({ where: { id, projectId: door.projectId }, select: { url: true, name: true, contentType: true, isLink: true } });
    return f ? { url: f.url, name: f.name, contentType: f.contentType, isLink: f.isLink } : null;
  }
  const d = await db.subDocument.findFirst({
    // The request's shared files are the office's drawings and photos (kind PLAN). A sub's estimate is recorded on
    // the request too (kind QUOTE) — theirs is reachable through their own versions, another sub's never.
    where: { id, organizationId: door.organizationId, OR: [...(door.requestId ? [{ requestId: door.requestId, kind: "PLAN" }] : []), { versions: { some: { quoteId: door.quoteId } } }] },
    select: { url: true, name: true, contentType: true },
  });
  return d ? { url: d.url, name: d.name, contentType: d.contentType, isLink: false } : null;
}

/** The contractor's price (or their no). Every price is a new version; the first one is announced to the office,
 *  a later one as a revision. */
export async function quoteReply(token: string, input: { amount: number | null; note: string | null; decline: boolean; reason?: string | null; file?: FileIn | null }): Promise<{ ok: true; version: number | null } | { ok: false; error: string }> {
  const q = await db.projectSubQuote.findUnique({ where: { publicToken: token }, select: { id: true, organizationId: true, projectId: true, requestId: true, contractorId: true, status: true, expiresAt: true, contractor: { select: { name: true } }, stage: { select: { name: true } }, project: { select: { name: true, organization: { select: { deletedAt: true, timezone: true } } } } } });
  if (!q || q.project.organization.deletedAt) return { ok: false, error: "This link is not valid." };
  const today = localDayKey(new Date(), q.project.organization.timezone || "America/New_York");
  if (linkClosed(q.status, isoDay(q.expiresAt), today) || !["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status)) return { ok: false, error: "This request is closed — thank you." };
  const now = new Date();
  const what = q.stage?.name ?? "the work";
  if (input.decline) {
    await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "DECLINED", declinedAt: now, note: trim(input.note, 1000), declineReason: trim(input.reason ?? input.note, 300) } });
    await tellOffice(q.organizationId, q.projectId, `${q.contractor.name} passed on ${what} on ${q.project.name}.`, { quoteId: q.id, requestId: q.requestId });
    return { ok: true, version: null };
  }
  if ((input.amount == null || !(input.amount >= 0)) && !input.file) return { ok: false, error: "Type your price, or attach your estimate." };
  const had = await db.subQuoteVersion.count({ where: { quoteId: q.id } });
  const v = await addVersion({ id: q.id, organizationId: q.organizationId, projectId: q.projectId, requestId: q.requestId, contractorId: q.contractorId, status: q.status }, { amount: input.amount, note: input.note, file: input.file ?? null, source: "PORTAL", by: null, via: "SUB" });
  const price = v.amount != null ? dollars(v.amount) : "no price yet";
  const withDoc = v.document ? ` (${v.document.name} attached)` : "";
  await tellOffice(q.organizationId, q.projectId, had ? `${q.contractor.name} revised their quote for ${what} on ${q.project.name}: ${price} (V${v.version})${withDoc}.` : `${q.contractor.name} quoted ${price} for ${what} on ${q.project.name}${withDoc}.`, { quoteId: q.id, requestId: q.requestId, versionId: v.id });
  return { ok: true, version: v.version };
}

/** The contractor's invoice, after the award: the amount and a link to the document (or none). */
export async function invoiceReply(token: string, input: { amount: number; url: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = await db.projectSubQuote.findUnique({ where: { publicToken: token }, select: { id: true, organizationId: true, status: true, project: { select: { organization: { select: { deletedAt: true } } } }, contracts: { where: { status: "EXECUTED" }, take: 1, select: { id: true } }, invoices: { where: { status: "RECEIVED", source: "PORTAL", documentId: null }, orderBy: { number: "desc" }, take: 1, select: { id: true } } } });
  if (!q || q.project.organization.deletedAt) return { ok: false, error: "This link is not valid." };
  if (q.status !== "AWARDED" && q.status !== "INVOICED") return { ok: false, error: q.status === "PAID" ? "This invoice is paid — thank you." : "The work has not been awarded yet." };
  // Part 5a: with a signed subcontract, invoices go on its page (a payment of the schedule, a PDF, the waivers).
  if (q.contracts.length) return { ok: false, error: "Send invoices from your subcontract's page — the link is in the email with your signed copy." };
  // An invoice row like any other (lib/subInvoices), so the office reviews, approves and pays it the same way; sending
  // again replaces the one not yet reviewed, as this page has always said.
  const { createInvoice, editInvoice } = await import("@/lib/subInvoices/server");
  const note = input.url ? `Invoice link: ${input.url}` : null;
  if (q.invoices[0]) await editInvoice(q.organizationId, q.invoices[0].id, { amount: r2(input.amount), note });
  else await createInvoice({ organizationId: q.organizationId, quoteId: q.id, amount: r2(input.amount), invoiceNumber: null, milestone: null, issuedAt: null, note, source: "PORTAL", file: null, actorId: null });
  await db.projectSubQuote.update({ where: { id: q.id }, data: { invoiceUrl: input.url } });
  return { ok: true };
}

// ── the card and the section ─────────────────────────────────────────────────

export type QuoteRow = QuoteLike & {
  number: number;
  stageName: string | null;
  requestId: string | null;
  requestNumber: number | null;
  contractorId: string;
  contractorCompany: string | null;
  contractorTrade: string | null;
  contractorPhone: string | null;
  contractorEmail: string | null;
  scope: string;
  askedAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  expiresAt: string | null;
  note: string | null;
  revisionNote: string | null;
  declineReason: string | null;
  quotedAt: string | null;
  awardedAt: string | null;
  invoiceAmount: number | null;
  invoiceUrl: string | null;
  invoicedAt: string | null;
  paidAt: string | null;
  expenseId: string | null;
  link: string;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  versions: VersionRow[];
  /** The stage's share of the Subcontractors budget, the line it is compared against. */
  line: number | null;
  best: boolean;
  over: boolean;
  overBy: number | null;
  overdue: boolean;
  /** Part 4: the quote's live subcontract, when one exists — its number, state, price and approved changes. */
  contract: QuoteContract | null;
  /** Part 5a: the cash recorded as paid on it (payments not voided), and its invoices not voided. */
  paidOut: number;
  invoiceCount: number;
};

export type QuoteContract = { id: string; number: number; status: string; amount: number; changes: number; pending: number };

export type RequestRow = {
  id: string;
  number: number;
  title: string;
  trade: string | null;
  stageId: string | null;
  stageName: string | null;
  scope: string;
  description: string | null;
  materials: string | null;
  labor: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dueBy: string | null;
  instructions: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  attachments: Array<{ id: string; name: string; kind: string; href: string | null }>;
  recipientIds: string[];
  /** Part 2: the AI's two sentences on the quotes, when they were written. */
  compare: StoredCompare | null;
};

export type SubsRead = {
  today: string;
  contractors: ContractorRow[];
  requests: RequestRow[];
  quotes: QuoteRow[];
  documents: DocRow[];
  /** The project's Files the office may attach to a request. */
  files: Array<{ id: string; name: string; kind: string }>;
  /** The project's Subcontractors budget, when it has one. */
  subsBudget: number | null;
  flags: ReturnType<typeof quoteFlags>;
};

const QUOTE_SELECT = {
  id: true,
  number: true,
  stageId: true,
  requestId: true,
  status: true,
  scope: true,
  dueBy: true,
  askedAt: true,
  sentAt: true,
  viewedAt: true,
  expiresAt: true,
  amount: true,
  note: true,
  revisionNote: true,
  declineReason: true,
  quotedAt: true,
  awardedAt: true,
  invoiceAmount: true,
  invoiceUrl: true,
  invoicedAt: true,
  paidAt: true,
  expenseId: true,
  publicToken: true,
  currentVersionId: true,
  approvedVersionId: true,
  contractor: { select: { id: true, name: true, company: true, trade: true, phone: true, email: true } },
  stage: { select: { name: true } },
  request: { select: { number: true } },
  versions: { orderBy: { version: "asc" as const }, select: VERSION_SELECT },
  // Part 4: the live contract (one per quote), its approved and pending change orders.
  contracts: { where: { status: { in: ["DRAFT", "SENT", "VIEWED", "EXECUTED"] as string[] } }, orderBy: { number: "desc" as const }, take: 1, select: { id: true, number: true, status: true, amount: true, changeOrders: { select: { status: true, amount: true } } } },
  // Part 5a: the payments recorded on it.
  payments: { where: { status: "RECORDED" }, select: { amount: true } },
  invoices: { where: { status: { not: "VOID" } }, select: { id: true } },
} as const;

function quoteContractOf(r: { contracts: Array<{ id: string; number: number; status: string; amount: number; changeOrders: Array<{ status: string; amount: number }> }> }): QuoteContract | null {
  const c = r.contracts[0];
  if (!c) return null;
  return { id: c.id, number: c.number, status: c.status, amount: c.amount, changes: r2(c.changeOrders.filter((x) => x.status === "APPROVED").reduce((n, x) => n + x.amount, 0)), pending: c.changeOrders.filter((x) => x.status === "PROPOSED").length };
}

export async function subsOf(organizationId: string, projectId: string): Promise<SubsRead> {
  const [tz, contractors, rows, requests, stages, subsLines, files, documents, base] = await Promise.all([
    tzOf(organizationId),
    contractorsOf(organizationId),
    db.projectSubQuote.findMany({ where: { projectId, organizationId }, orderBy: [{ stageId: "asc" }, { number: "asc" }], select: QUOTE_SELECT }),
    db.subRequest.findMany({ where: { projectId, organizationId }, orderBy: { number: "desc" }, select: { id: true, number: true, title: true, trade: true, stageId: true, scope: true, description: true, materials: true, labor: true, startsAt: true, endsAt: true, dueBy: true, instructions: true, status: true, sentAt: true, createdAt: true, fileIdsJson: true, compareJson: true, stage: { select: { name: true } }, documents: { where: { kind: "PLAN" }, select: DOC_SELECT }, recipients: { select: { id: true } } } }),
    db.projectStage.findMany({ where: { projectId }, select: { id: true, weight: true } }),
    db.projectBudgetLine.findMany({ where: { projectId, category: "SUBCONTRACTORS", label: null }, select: { amount: true } }),
    db.projectFile.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, kind: true, url: true, isLink: true } }),
    documentsOf(organizationId, projectId),
    appBaseUrl(),
  ]);
  const today = localDayKey(new Date(), tz);
  const subsBudget = subsLines.length ? subsLines.reduce((n, l) => n + Math.max(0, l.amount), 0) : null;
  const totalWeight = stages.reduce((n, s) => n + Math.max(0, s.weight), 0);
  const weightOf = new Map(stages.map((s) => [s.id, s.weight]));
  const likes: Array<QuoteLike & { row: (typeof rows)[number] }> = rows.map((r) => ({ id: r.id, status: r.status, amount: r.amount, dueBy: isoDay(r.dueBy), stageId: r.stageId, contractorName: r.contractor.name, row: r }));
  const byStage = new Map<string, typeof likes>();
  for (const l of likes) {
    const k = l.stageId ?? "";
    byStage.set(k, [...(byStage.get(k) ?? []), l]);
  }
  const compared = new Map<string, { best: boolean; over: boolean; overBy: number | null; line: number | null }>();
  for (const [stageId, group] of byStage) {
    const line = stageId && subsBudget != null ? stageSubsBudget(weightOf.get(stageId) ?? 0, totalWeight, subsBudget) : null;
    for (const c of compareQuotes(group, line)) compared.set(c.quote.id, { best: c.best, over: c.over, overBy: c.overBy, line });
  }
  const quotes: QuoteRow[] = likes.map((l) => {
    const r = l.row;
    const c = compared.get(l.id)!;
    return {
      id: l.id,
      status: quoteStatusOf(r.status),
      amount: r.amount,
      dueBy: l.dueBy,
      stageId: r.stageId,
      contractorName: r.contractor.name,
      number: r.number,
      stageName: r.stage?.name ?? null,
      requestId: r.requestId,
      requestNumber: r.request?.number ?? null,
      contractorId: r.contractor.id,
      contractorCompany: r.contractor.company,
      contractorTrade: r.contractor.trade,
      contractorPhone: r.contractor.phone,
      contractorEmail: r.contractor.email,
      scope: r.scope,
      askedAt: r.askedAt.toISOString(),
      sentAt: iso(r.sentAt),
      viewedAt: iso(r.viewedAt),
      expiresAt: iso(r.expiresAt),
      note: r.note,
      revisionNote: r.revisionNote,
      declineReason: r.declineReason,
      quotedAt: iso(r.quotedAt),
      awardedAt: iso(r.awardedAt),
      invoiceAmount: r.invoiceAmount,
      invoiceUrl: r.invoiceUrl,
      invoicedAt: iso(r.invoicedAt),
      paidAt: iso(r.paidAt),
      expenseId: r.expenseId,
      link: `${base}/q/${r.publicToken}`,
      currentVersionId: r.currentVersionId,
      approvedVersionId: r.approvedVersionId,
      versions: r.versions.map(versionRow),
      line: c.line,
      best: c.best,
      over: c.over,
      overBy: c.overBy,
      overdue: overdue(l, today),
      contract: quoteContractOf(r),
      paidOut: r2(r.payments.reduce((n, p) => n + p.amount, 0)),
      invoiceCount: r.invoices.length,
    };
  });
  const fileById = new Map(files.map((f) => [f.id, f]));
  const requestRows: RequestRow[] = requests.map((r) => {
    const fileIds = (() => {
      try {
        const v = JSON.parse(r.fileIdsJson ?? "[]");
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      } catch {
        return [];
      }
    })();
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      trade: r.trade,
      stageId: r.stageId,
      stageName: r.stage?.name ?? null,
      scope: r.scope,
      description: r.description,
      materials: r.materials,
      labor: r.labor,
      startsAt: isoDay(r.startsAt),
      endsAt: isoDay(r.endsAt),
      dueBy: isoDay(r.dueBy),
      instructions: r.instructions,
      status: r.status,
      sentAt: iso(r.sentAt),
      createdAt: r.createdAt.toISOString(),
      attachments: [
        ...fileIds.map((id) => fileById.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f)).map((f) => ({ id: f.id, name: f.name, kind: FILE_KIND_LABEL[fileKindOf(f.kind)], href: f.isLink ? f.url : mediaHref(f.url) })),
        ...r.documents.map((d) => ({ id: d.id, name: d.name, kind: "Drawing", href: `/api/subs/doc/${d.id}` })),
      ],
      recipientIds: r.recipients.map((x) => x.id),
      compare: parseStoredCompare(r.compareJson),
    };
  });
  return {
    today,
    contractors,
    requests: requestRows,
    quotes,
    documents,
    files: files.map((f) => ({ id: f.id, name: f.name, kind: FILE_KIND_LABEL[fileKindOf(f.kind)] })),
    subsBudget,
    flags: quoteFlags(likes, today),
  };
}

/** The Subcontractors section's figures over a project's quotes. */
export function sectionMetrics(read: SubsRead): { subs: number; subsActive: number; requestsOpen: number; quotesIn: number; awaitingApproval: number; awarded: number; invoicesOpen: number; committed: number; paid: number; pending: number; pendingCount: number; subsBudget: number | null; remaining: number | null; overdue: number; contractsSigned: number; contractsOut: number } {
  const q = read.quotes;
  // Part 4: an executed contract (plus approved change orders) is the commitment; the awarded amount until then.
  const committed = r2(q.reduce((n, x) => n + committedOf(x), 0));
  const paid = r2(q.reduce((n, x) => n + paidOf(x), 0));
  return {
    // Part 2: quoted but not awarded — the budget's own line, never counted as committed.
    pending: pendingOf(q),
    pendingCount: q.filter((x) => (x.status === "QUOTED" || x.status === "REVISION") && x.amount != null).length,
    subs: read.contractors.length,
    subsActive: new Set(q.filter((x) => ["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED", "INVOICED"].includes(x.status)).map((x) => x.contractorId)).size,
    requestsOpen: read.requests.filter((r) => r.status === "SENT").length,
    quotesIn: q.filter((x) => x.amount != null && !["ASKED", "VIEWED"].includes(x.status)).length,
    awaitingApproval: q.filter((x) => x.status === "QUOTED").length,
    awarded: q.filter((x) => ["AWARDED", "INVOICED", "PAID"].includes(x.status)).length,
    invoicesOpen: q.filter((x) => x.status === "INVOICED").length,
    committed,
    paid,
    subsBudget: read.subsBudget,
    remaining: read.subsBudget != null ? r2(read.subsBudget - committed - paid) : null,
    overdue: q.filter((x) => x.overdue).length,
    contractsSigned: q.filter((x) => x.contract?.status === "EXECUTED").length,
    contractsOut: q.filter((x) => x.contract && (x.contract.status === "SENT" || x.contract.status === "VIEWED")).length,
  };
}

/** The project's history of subcontractor events — the trail rows that carry a request, a quote or a contractor. */
export type HistoryRow = { id: string; kind: string; summary: string; at: string; who: string | null };
export async function subsHistory(organizationId: string, projectId: string): Promise<HistoryRow[]> {
  const rows = await db.activityEvent.findMany({
    where: {
      organizationId,
      kind: { in: [TRAIL_KINDS.PROJECT, SUB_EVENT_KIND, SUB_CONTRACT_KIND] },
      meta: { contains: `"projectId":"${projectId}"` },
      OR: [{ meta: { contains: '"quoteId"' } }, { meta: { contains: '"requestId"' } }, { meta: { contains: '"contractorId"' } }, { meta: { contains: '"quotes"' } }, { meta: { contains: '"contractId"' } }],
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { id: true, kind: true, summary: true, createdAt: true, actorId: true },
  });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.email || "Member"]));
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, at: r.createdAt.toISOString(), who: r.actorId ? (nameOf.get(r.actorId) ?? "Former member") : r.kind === SUB_EVENT_KIND || r.kind === SUB_CONTRACT_KIND ? "The sub" : null }));
}

// ── company-wide ─────────────────────────────────────────────────────────────

export type CompanyQuoteRow = {
  id: string;
  projectId: string;
  projectName: string;
  projectNumber: number | null;
  projectStatus: string;
  requestNumber: number | null;
  stageName: string | null;
  contractorId: string;
  contractorName: string;
  contractorTrade: string | null;
  status: string;
  amount: number | null;
  line: number | null;
  askedAt: string;
  quotedAt: string | null;
  dueBy: string | null;
  versions: VersionRow[];
};

/** Every quote across the company's projects, finished ones included — Quotes & Proposals. */
export async function companyQuotes(organizationId: string): Promise<{ today: string; quotes: CompanyQuoteRow[] }> {
  const [tz, rows] = await Promise.all([
    tzOf(organizationId),
    db.projectSubQuote.findMany({
      where: { organizationId },
      orderBy: { askedAt: "desc" },
      take: 1000,
      select: { id: true, projectId: true, status: true, amount: true, askedAt: true, quotedAt: true, dueBy: true, contractor: { select: { id: true, name: true, trade: true } }, stage: { select: { name: true } }, request: { select: { number: true } }, project: { select: { name: true, number: true, status: true } }, versions: { orderBy: { version: "asc" }, select: VERSION_SELECT } },
    }),
  ]);
  return {
    today: localDayKey(new Date(), tz),
    quotes: rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.project.name,
      projectNumber: r.project.number,
      projectStatus: r.project.status,
      requestNumber: r.request?.number ?? null,
      stageName: r.stage?.name ?? null,
      contractorId: r.contractor.id,
      contractorName: r.contractor.name,
      contractorTrade: r.contractor.trade,
      status: quoteStatusOf(r.status),
      amount: r.amount,
      line: null,
      askedAt: r.askedAt.toISOString(),
      quotedAt: iso(r.quotedAt),
      dueBy: isoDay(r.dueBy),
      versions: r.versions.map(versionRow),
    })),
  };
}
