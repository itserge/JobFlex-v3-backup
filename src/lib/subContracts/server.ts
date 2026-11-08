import "server-only";
// SUBCONTRACTS — the database half (2026-11-08, the subcontractors plan, part 4). A contract is drafted from an
// awarded quote (the price, the request's scope and dates, the standard terms, the estimate and the drawings
// attached), edited while a draft, then signed for the company and sent: the sub reads it on /s/<token> and signs
// with a typed name and the consent box — the time, the address and the browser are kept, the contract is executed
// at that moment and the signed PDF (lib/pdf/SubcontractPdf) goes to the private store as a SubDocument. Change
// orders are proposed by the office, agreed or declined by the sub on the same page (or approved in person), and
// approved ones move the commitment. The rules are ./shared; the office's bell, text and email go through
// projectSubs' tellOffice under the "sub-contract" preference.
import { createElement } from "react";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { putPrivate } from "@/lib/media/privateStore";
import { pdfLogoSrc } from "@/lib/orgLogoServer";
import { sendText } from "@/lib/sms/send";
import { isoDay } from "@/lib/projectTimeline/shared";
import { dollars } from "@/lib/projectSubs/shared";
import { SUB_CONTRACT_KIND, tellOffice, type SendState } from "@/lib/projectSubs/server";
import { DOC_SELECT, docRow, recordDocument, type DocRow } from "@/lib/subDocs/server";
import { docPathname } from "@/lib/subDocs/shared";
import { projectSiteAddress } from "@/lib/subFinder/server";
import {
  CONTRACT_FIRST_NUMBER,
  CONTRACT_LIVE,
  agreementSections,
  canCancelContract,
  canEditContract,
  canSignContract,
  changeAnsweredLine,
  changeNo,
  contractFileName,
  contractNo,
  contractTotal,
  contractWords,
  draftFromQuote,
  milestonesCheck,
  parseMilestones,
  signedLine,
  signedUsd,
  usd,
  type AgreementSection,
  type Milestone,
} from "./shared";

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const TOKEN = /^[A-Za-z0-9_-]{10,80}$/;

const ORG_SELECT = { id: true, name: true, phone: true, logoUrl: true, timezone: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, deletedAt: true } as const;

const CHANGE_SELECT = { id: true, number: true, status: true, amount: true, scope: true, reason: true, proposedAt: true, decidedAt: true, decidedName: true, decidedVia: true, declineReason: true } as const;

const CONTRACT_SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  stageId: true,
  contractorId: true,
  quoteId: true,
  versionId: true,
  number: true,
  status: true,
  title: true,
  amount: true,
  scope: true,
  startsAt: true,
  endsAt: true,
  depositPct: true,
  milestonesJson: true,
  terms: true,
  attachmentIdsJson: true,
  publicToken: true,
  sentAt: true,
  viewedAt: true,
  companySignedName: true,
  companySignedAt: true,
  signedName: true,
  signedAt: true,
  signedIp: true,
  signedUserAgent: true,
  executedAt: true,
  cancelledAt: true,
  cancelReason: true,
  pdfDocumentId: true,
  createdAt: true,
  contractor: { select: { id: true, name: true, company: true, email: true, phone: true, license: true, textsOptOut: true } },
  stage: { select: { name: true } },
  project: { select: { id: true, name: true, number: true, clientId: true } },
  pdfDocument: { select: DOC_SELECT },
  changeOrders: { orderBy: { number: "asc" as const }, select: CHANGE_SELECT },
} as const;

type ContractDb = Awaited<ReturnType<typeof contractDb>>;
async function contractDb(organizationId: string, id: string) {
  const c = await db.subcontract.findFirst({ where: { id, organizationId }, select: CONTRACT_SELECT });
  if (!c) throw new Error("Contract not found");
  return c;
}

export type ChangeRow = { id: string; number: number; status: string; amount: number; scope: string; reason: string | null; proposedAt: string; decidedAt: string | null; decidedName: string | null; decidedVia: string | null; declineReason: string | null };

export type ContractRow = {
  id: string;
  number: number;
  status: string;
  title: string;
  amount: number;
  /** The price plus the approved change orders. */
  total: number;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  depositPct: number | null;
  milestones: Milestone[];
  terms: string;
  attachmentIds: string[];
  attachments: DocRow[];
  link: string;
  sentAt: string | null;
  viewedAt: string | null;
  companySignedName: string | null;
  companySignedAt: string | null;
  signedName: string | null;
  signedAt: string | null;
  signedIp: string | null;
  executedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  pdf: DocRow | null;
  quoteId: string;
  versionId: string | null;
  contractorId: string;
  contractorName: string;
  contractorCompany: string | null;
  contractorEmail: string | null;
  contractorPhone: string | null;
  contractorLicense: string | null;
  stageId: string | null;
  stageName: string | null;
  projectId: string;
  projectName: string;
  changes: ChangeRow[];
  words: string;
  createdAt: string;
};

function parseIds(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x)) : [];
  } catch {
    return [];
  }
}

const changeRow = (c: ContractDb["changeOrders"][number]): ChangeRow => ({ id: c.id, number: c.number, status: c.status, amount: c.amount, scope: c.scope, reason: c.reason, proposedAt: c.proposedAt.toISOString(), decidedAt: iso(c.decidedAt), decidedName: c.decidedName, decidedVia: c.decidedVia, declineReason: c.declineReason });

function rowOf(c: ContractDb, base: string, attachments: DocRow[]): ContractRow {
  const changes = c.changeOrders.map(changeRow);
  return {
    id: c.id,
    number: c.number,
    status: c.status,
    title: c.title,
    amount: c.amount,
    total: contractTotal(c.amount, changes),
    scope: c.scope,
    startsAt: isoDay(c.startsAt),
    endsAt: isoDay(c.endsAt),
    depositPct: c.depositPct,
    milestones: parseMilestones(c.milestonesJson),
    terms: c.terms,
    attachmentIds: parseIds(c.attachmentIdsJson),
    attachments,
    link: `${base}/s/${c.publicToken}`,
    sentAt: iso(c.sentAt),
    viewedAt: iso(c.viewedAt),
    companySignedName: c.companySignedName,
    companySignedAt: iso(c.companySignedAt),
    signedName: c.signedName,
    signedAt: iso(c.signedAt),
    signedIp: c.signedIp,
    executedAt: iso(c.executedAt),
    cancelledAt: iso(c.cancelledAt),
    cancelReason: c.cancelReason,
    pdf: c.pdfDocument ? docRow(c.pdfDocument) : null,
    quoteId: c.quoteId,
    versionId: c.versionId,
    contractorId: c.contractor.id,
    contractorName: c.contractor.name,
    contractorCompany: c.contractor.company,
    contractorEmail: c.contractor.email,
    contractorPhone: c.contractor.phone,
    contractorLicense: c.contractor.license,
    stageId: c.stageId,
    stageName: c.stage?.name ?? null,
    projectId: c.projectId,
    projectName: c.project.name,
    changes,
    words: contractWords({ status: c.status, sentAt: iso(c.sentAt), viewedAt: iso(c.viewedAt), signedName: c.signedName, signedAt: iso(c.signedAt), cancelledAt: iso(c.cancelledAt), cancelReason: c.cancelReason, changes }),
    createdAt: c.createdAt.toISOString(),
  };
}

/** The attachments of several contracts in one read, each checked against the company. */
async function attachmentsFor(organizationId: string, rows: ContractDb[]): Promise<Map<string, DocRow[]>> {
  const ids = [...new Set(rows.flatMap((c) => parseIds(c.attachmentIdsJson)))];
  const docs = ids.length ? await db.subDocument.findMany({ where: { id: { in: ids }, organizationId }, select: DOC_SELECT }) : [];
  const byId = new Map(docs.map((d) => [d.id, docRow(d)]));
  return new Map(rows.map((c) => [c.id, parseIds(c.attachmentIdsJson).map((id) => byId.get(id)).filter((d): d is DocRow => Boolean(d))]));
}

async function rowsOf(organizationId: string, rows: ContractDb[]): Promise<ContractRow[]> {
  const [base, att] = await Promise.all([appBaseUrl(), attachmentsFor(organizationId, rows)]);
  return rows.map((c) => rowOf(c, base, att.get(c.id) ?? []));
}

/** A project's contracts, the live ones first (newest number first), cancelled last. */
export async function contractsOf(organizationId: string, projectId: string): Promise<ContractRow[]> {
  const rows = await db.subcontract.findMany({ where: { organizationId, projectId }, orderBy: { number: "desc" }, select: CONTRACT_SELECT });
  const out = await rowsOf(organizationId, rows);
  return [...out.filter((c) => c.status !== "CANCELLED"), ...out.filter((c) => c.status === "CANCELLED")];
}

export async function contractById(organizationId: string, id: string): Promise<ContractRow> {
  const c = await contractDb(organizationId, id);
  return (await rowsOf(organizationId, [c]))[0];
}

/** The directory's profile: a sub's contracts across the company's projects. */
export type ContractorContractRow = { id: string; number: number; status: string; total: number; projectId: string; projectName: string; stageName: string | null; signedAt: string | null; words: string };
export async function contractsByContractor(organizationId: string, contractorId: string): Promise<ContractorContractRow[]> {
  const rows = await db.subcontract.findMany({ where: { organizationId, contractorId }, orderBy: { number: "desc" }, select: { id: true, number: true, status: true, amount: true, projectId: true, sentAt: true, viewedAt: true, signedName: true, signedAt: true, cancelledAt: true, cancelReason: true, project: { select: { name: true } }, stage: { select: { name: true } }, changeOrders: { select: { status: true, amount: true } } } });
  return rows.map((c) => ({
    id: c.id,
    number: c.number,
    status: c.status,
    total: contractTotal(c.amount, c.changeOrders),
    projectId: c.projectId,
    projectName: c.project.name,
    stageName: c.stage?.name ?? null,
    signedAt: iso(c.signedAt),
    words: contractWords({ status: c.status, sentAt: iso(c.sentAt), viewedAt: iso(c.viewedAt), signedName: c.signedName, signedAt: iso(c.signedAt), cancelledAt: iso(c.cancelledAt), cancelReason: c.cancelReason, changes: c.changeOrders }),
  }));
}

// ── the draft ────────────────────────────────────────────────────────────────

/** A draft from an awarded quote: the price, the request's scope and dates, the standard terms, the awarded estimate
 *  and the request's drawings attached; the next company-wide number. One live contract per quote. */
export async function draftContract(organizationId: string, quoteId: string, actorId: string | null): Promise<ContractRow> {
  const q = await db.projectSubQuote.findFirst({
    where: { id: quoteId, organizationId },
    select: {
      id: true,
      status: true,
      amount: true,
      scope: true,
      stageId: true,
      contractorId: true,
      requestId: true,
      projectId: true,
      approvedVersionId: true,
      currentVersionId: true,
      project: { select: { id: true, name: true, clientId: true } },
      stage: { select: { name: true } },
      contractor: { select: { name: true, trade: true } },
      request: { select: { description: true, materials: true, labor: true, startsAt: true, endsAt: true, trade: true } },
      versions: { select: { id: true, documentId: true } },
      contracts: { where: { status: { in: [...CONTRACT_LIVE] } }, select: { id: true } },
    },
  });
  if (!q) throw new Error("Quote not found");
  if (q.status !== "AWARDED" && q.status !== "INVOICED") throw new Error("Only an awarded quote gets a contract.");
  if (q.contracts.length) throw new Error("This quote has a contract already — open it from the Contracts tab.");
  if (q.amount == null) throw new Error("Confirm the price first — open the estimate and use the AI's read, or type it with Their estimate…");
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const draft = draftFromQuote({
    company: org?.name ?? "Our company",
    sub: q.contractor.name,
    project: q.project.name,
    stage: q.stage?.name ?? null,
    trade: q.request?.trade ?? q.contractor.trade,
    amount: q.amount,
    scope: q.scope,
    description: q.request?.description ?? null,
    materials: q.request?.materials ?? null,
    labor: q.request?.labor ?? null,
    startsAt: isoDay(q.request?.startsAt),
    endsAt: isoDay(q.request?.endsAt),
  });
  const versionId = q.approvedVersionId ?? q.currentVersionId;
  const estimateDoc = q.versions.find((v) => v.id === versionId)?.documentId ?? null;
  const plans = q.requestId ? await db.subDocument.findMany({ where: { requestId: q.requestId, kind: "PLAN", organizationId }, orderBy: { createdAt: "asc" }, select: { id: true } }) : [];
  const attachmentIds = [estimateDoc, ...plans.map((p) => p.id)].filter((x): x is string => Boolean(x));
  const top = await db.subcontract.aggregate({ where: { organizationId }, _max: { number: true } });
  const row = await db.subcontract.create({
    data: {
      organizationId,
      projectId: q.projectId,
      stageId: q.stageId,
      contractorId: q.contractorId,
      quoteId: q.id,
      versionId,
      number: Math.max(CONTRACT_FIRST_NUMBER, (top._max.number ?? CONTRACT_FIRST_NUMBER - 1) + 1),
      title: draft.title,
      amount: draft.amount,
      scope: draft.scope,
      startsAt: day(draft.startsAt),
      endsAt: day(draft.endsAt),
      depositPct: draft.depositPct,
      milestonesJson: JSON.stringify(draft.milestones),
      terms: draft.terms,
      attachmentIdsJson: JSON.stringify(attachmentIds),
      createdById: actorId,
    },
    select: CONTRACT_SELECT,
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Drafted Subcontract ${contractNo(row.number)} for ${q.contractor.name} on ${q.project.name} (${dollars(draft.amount)})`, clientId: q.project.clientId, meta: { projectId: q.projectId, contractId: row.id, quoteId: q.id, contractorId: q.contractorId } });
  return (await rowsOf(organizationId, [row]))[0];
}

export type ContractPatch = {
  title?: string;
  amount?: number;
  scope?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  depositPct?: number | null;
  milestones?: Milestone[];
  terms?: string;
  attachmentIds?: string[];
};

/** A draft's fields — nothing changes once it is sent. */
export async function updateContract(organizationId: string, id: string, patch: ContractPatch): Promise<ContractRow> {
  const c = await contractDb(organizationId, id);
  if (!canEditContract(c.status)) throw new Error("Only a draft can be edited — cancel it and draft again to change a sent contract.");
  if (patch.milestones) {
    const why = milestonesCheck(patch.milestones);
    if (why) throw new Error(why);
  }
  if (patch.amount != null && !(patch.amount > 0)) throw new Error("The price has to be above zero.");
  if (patch.scope != null && !patch.scope.trim()) throw new Error("The scope cannot be empty.");
  if (patch.terms != null && !patch.terms.trim()) throw new Error("The terms cannot be empty.");
  let attachmentIds: string[] | undefined;
  if (patch.attachmentIds) {
    const ids = [...new Set(patch.attachmentIds)];
    const ok = ids.length ? await db.subDocument.findMany({ where: { id: { in: ids }, organizationId, OR: [{ projectId: c.projectId }, { contractorId: c.contractorId }] }, select: { id: true } }) : [];
    attachmentIds = ids.filter((x) => ok.some((o) => o.id === x));
  }
  const row = await db.subcontract.update({
    where: { id: c.id },
    data: {
      ...(patch.title != null ? { title: patch.title.trim().slice(0, 160) || c.title } : {}),
      ...(patch.amount != null ? { amount: r2(patch.amount) } : {}),
      ...(patch.scope != null ? { scope: patch.scope.trim().slice(0, 8000) } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: day(patch.startsAt) } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: day(patch.endsAt) } : {}),
      ...(patch.depositPct !== undefined ? { depositPct: patch.depositPct } : {}),
      ...(patch.milestones ? { milestonesJson: JSON.stringify(patch.milestones) } : {}),
      ...(patch.terms != null ? { terms: patch.terms.trim().slice(0, 20000) } : {}),
      ...(attachmentIds ? { attachmentIdsJson: JSON.stringify(attachmentIds) } : {}),
    },
    select: CONTRACT_SELECT,
  });
  return (await rowsOf(organizationId, [row]))[0];
}

// ── letters ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
const button = (href: string, label: string) => `<p><a href="${esc(href)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:4px">${esc(label)}</a></p>`;

function contractHtml(i: { company: string; to: string; project: string; number: number; title: string; amount: number; link: string; phone: string | null; again: boolean }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${i.again ? "A reminder: " : ""}${esc(i.company)} has prepared your subcontract <b>${esc(contractNo(i.number))}</b> — ${esc(i.title)} — for ${esc(i.project)}, ${esc(usd(i.amount))}.</p><p>Please read it and sign it on the page below. Typing your name there, with the box ticked, is your signature; the page then gives you the signed copy as a PDF.</p>${button(i.link, "Read and sign the subcontract")}<p>Questions about the terms go to ${esc(i.company)} before you sign.${i.phone ? ` Phone: ${esc(i.phone)}` : ""}</p>`;
}

function signedHtml(i: { company: string; to: string; project: string; number: number; total: number; link: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>Thank you — Subcontract <b>${esc(contractNo(i.number))}</b> for ${esc(i.project)} (${esc(usd(i.total))}) is signed by both parties.</p><p>Your copy, with the signed PDF to download, stays at this link:</p>${button(i.link, "Open your signed subcontract")}${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function changeHtml(i: { company: string; to: string; project: string; contractNumber: number; number: number; amount: number; scope: string; reason: string | null; link: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} proposes a change order on your Subcontract ${esc(contractNo(i.contractNumber))} for ${esc(i.project)}:</p><p><b>${esc(changeNo(i.number))} · ${esc(signedUsd(i.amount))}</b><br>${esc(i.scope).replace(/\n/g, "<br>")}</p>${i.reason ? `<p><b>Why:</b> ${esc(i.reason)}</p>` : ""}<p>Agree to it or decline it on your subcontract's page:</p>${button(i.link, "Open the change order")}${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function withdrawnHtml(i: { company: string; to: string; project: string; number: number; reason: string | null; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} has withdrawn Subcontract ${esc(contractNo(i.number))} for ${esc(i.project)}${i.reason ? ` — ${esc(i.reason)}` : ""}. The signing link no longer works.</p>${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

type OrgRow = { id: string; name: string | null; phone: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; billingEmail: string | null; deletedAt: Date | null };

async function orgOf(organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
  if (!org) throw new Error("Company not found");
  return org;
}

async function mailSub(org: OrgRow, to: string | null, subject: string, html: string): Promise<SendState> {
  if (!to) return "none";
  try {
    await sendOrgEmail(org, { to, subject, html });
    return "sent";
  } catch (err) {
    console.warn(`[subContracts] email to ${to} failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

async function textSub(organizationId: string, c: { phone: string | null; textsOptOut: boolean | null }, body: string): Promise<SendState> {
  if (!c.phone || c.textsOptOut) return "none";
  const r = await sendText({ organizationId, to: c.phone, body, kind: "sub-contract" });
  return r.ok && (r.status === "SENT" || r.status === "HELD") ? "sent" : r.ok ? "none" : "failed";
}

// ── send, resend, cancel ─────────────────────────────────────────────────────

/** The company signs (the sender's typed name) and the sub is sent the link, by email and — under the texting rules —
 *  by text. The draft becomes SENT; nothing on it changes after this. */
export async function sendContract(organizationId: string, id: string, actor: { id: string | null }, signerName: string): Promise<{ row: ContractRow; email: SendState; text: SendState }> {
  const c = await contractDb(organizationId, id);
  if (c.status !== "DRAFT") throw new Error(c.status === "CANCELLED" ? "This contract was cancelled." : "It was sent already — Resend sends the link again.");
  const name = signerName.trim();
  if (name.length < 2 || !/\p{L}/u.test(name)) throw new Error("Type your name to sign for the company.");
  if (!(c.amount > 0)) throw new Error("The price has to be above zero.");
  if (!c.scope.trim()) throw new Error("The scope cannot be empty.");
  const why = milestonesCheck(parseMilestones(c.milestonesJson));
  if (why) throw new Error(why);
  const org = await orgOf(organizationId);
  const now = new Date();
  const row = await db.subcontract.update({ where: { id: c.id }, data: { status: "SENT", sentAt: now, companySignedName: name.slice(0, 120), companySignedAt: now, companySignedById: actor.id }, select: CONTRACT_SELECT });
  const [out] = await rowsOf(organizationId, [row]);
  const company = org.name ?? "Our company";
  const email = await mailSub(org, row.contractor.email, `Subcontract ${contractNo(row.number)} to sign — ${company} — ${row.project.name}`, contractHtml({ company, to: row.contractor.name, project: row.project.name, number: row.number, title: row.title, amount: row.amount, link: out.link, phone: org.phone, again: false }));
  const text = await textSub(organizationId, row.contractor, `${company}: your subcontract ${contractNo(row.number)} for ${row.project.name} is ready to read and sign — ${out.link}`);
  await logActivity({ organizationId, actorId: actor.id, kind: TRAIL_KINDS.PROJECT, summary: `Sent Subcontract ${contractNo(row.number)} to ${row.contractor.name} for signature (${dollars(row.amount)})`, clientId: row.project.clientId, meta: { projectId: row.projectId, contractId: row.id, quoteId: row.quoteId, contractorId: row.contractorId, email, text } });
  return { row: out, email, text };
}

export async function resendContract(organizationId: string, id: string): Promise<{ email: SendState; text: SendState }> {
  const c = await contractDb(organizationId, id);
  if (!canSignContract(c.status)) throw new Error(c.status === "EXECUTED" ? "It is signed already." : "Only a sent contract can be sent again.");
  const org = await orgOf(organizationId);
  const [out] = await rowsOf(organizationId, [c]);
  const company = org.name ?? "Our company";
  const email = await mailSub(org, c.contractor.email, `Reminder: Subcontract ${contractNo(c.number)} to sign — ${company} — ${c.project.name}`, contractHtml({ company, to: c.contractor.name, project: c.project.name, number: c.number, title: c.title, amount: c.amount, link: out.link, phone: org.phone, again: true }));
  const text = await textSub(organizationId, c.contractor, `Reminder — ${company}: your subcontract ${contractNo(c.number)} for ${c.project.name} is waiting for your signature — ${out.link}`);
  return { email, text };
}

/** A draft or a sent contract withdrawn; the sub is told when they had the link. An executed contract stays — a
 *  change order moves its figure. */
export async function cancelContract(organizationId: string, id: string, reason: string | null, actorId: string | null): Promise<ContractRow> {
  const c = await contractDb(organizationId, id);
  if (!canCancelContract(c.status)) throw new Error(c.status === "EXECUTED" ? "A signed contract cannot be cancelled here — propose a change order instead." : "It is cancelled already.");
  const why = reason?.trim().slice(0, 300) || null;
  const row = await db.subcontract.update({ where: { id: c.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: why }, select: CONTRACT_SELECT });
  if (c.status !== "DRAFT") {
    const org = await orgOf(organizationId);
    const company = org.name ?? "Our company";
    await mailSub(org, c.contractor.email, `Subcontract ${contractNo(c.number)} withdrawn — ${company} — ${c.project.name}`, withdrawnHtml({ company, to: c.contractor.name, project: c.project.name, number: c.number, reason: why, phone: org.phone }));
  }
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Cancelled Subcontract ${contractNo(c.number)} with ${c.contractor.name}${why ? ` — ${why}` : ""}`, clientId: c.project.clientId, meta: { projectId: c.projectId, contractId: c.id, quoteId: c.quoteId, contractorId: c.contractorId } });
  return (await rowsOf(organizationId, [row]))[0];
}

// ── the signing page ─────────────────────────────────────────────────────────

export type ContractView = {
  number: number;
  title: string;
  company: string;
  companyPhone: string | null;
  sub: string;
  project: string;
  status: string;
  /** Cancelled: the page says so and takes nothing. */
  closed: boolean;
  canSign: boolean;
  total: number;
  sections: AgreementSection[];
  attachments: Array<{ id: string; name: string; kind: string; href: string }>;
  companySigned: { name: string; at: string } | null;
  signed: { name: string; at: string; ip: string | null } | null;
  pdfHref: string | null;
  changes: ChangeRow[];
};

async function byToken(token: string) {
  if (!TOKEN.test(token)) return null;
  const c = await db.subcontract.findUnique({ where: { publicToken: token }, select: { ...CONTRACT_SELECT, organization: { select: ORG_SELECT } } });
  if (!c || c.organization.deletedAt) return null;
  return c;
}

/** The agreement as the sub reads it; opening a sent contract stamps it VIEWED. */
export async function contractView(token: string): Promise<ContractView | null> {
  const c = await byToken(token);
  if (!c) return null;
  if (c.status === "SENT") await db.subcontract.updateMany({ where: { id: c.id, status: "SENT" }, data: { status: "VIEWED", viewedAt: new Date() } });
  const [att, address] = await Promise.all([attachmentsFor(c.organizationId, [c]), projectSiteAddress(c.organizationId, c.projectId)]);
  const attachments = (att.get(c.id) ?? []).map((d) => ({ id: d.id, name: d.name, kind: d.kind === "PLAN" ? "Drawing" : d.kind === "QUOTE" ? "Your estimate" : d.kind.toLowerCase(), href: `/api/s/${token}/file/${d.id}` }));
  const changes = c.changeOrders.map(changeRow);
  return {
    number: c.number,
    title: c.title,
    company: c.organization.name ?? "The company",
    companyPhone: c.organization.phone,
    sub: c.contractor.name,
    project: c.project.name,
    status: c.status === "SENT" ? "VIEWED" : c.status,
    closed: c.status === "CANCELLED",
    canSign: canSignContract(c.status),
    total: contractTotal(c.amount, changes),
    sections: agreementSections({
      number: c.number,
      title: c.title,
      company: c.organization.name ?? "The company",
      companyPhone: c.organization.phone,
      sub: c.contractor.name,
      subCompany: c.contractor.company,
      subLicense: c.contractor.license,
      project: c.project.name,
      projectAddress: address,
      amount: c.amount,
      scope: c.scope,
      startsAt: isoDay(c.startsAt),
      endsAt: isoDay(c.endsAt),
      milestones: parseMilestones(c.milestonesJson),
      terms: c.terms,
      attachments: attachments.map((a) => a.name),
      changes,
    }),
    attachments,
    companySigned: c.companySignedName && c.companySignedAt ? { name: c.companySignedName, at: c.companySignedAt.toISOString() } : null,
    signed: c.signedName && c.signedAt ? { name: c.signedName, at: c.signedAt.toISOString(), ip: c.signedIp } : null,
    pdfHref: c.pdfDocument ? `/api/s/${token}/file/${c.pdfDocument.id}?download=1` : null,
    changes,
  };
}

/** A file the sub may open through the contract's token: an attachment, or the signed PDF. */
export async function contractDocumentForToken(token: string, documentId: string): Promise<{ url: string; name: string; contentType: string | null } | null> {
  const c = await byToken(token);
  if (!c) return null;
  const allowed = new Set([...parseIds(c.attachmentIdsJson), ...(c.pdfDocumentId ? [c.pdfDocumentId] : [])]);
  if (!allowed.has(documentId)) return null;
  const d = await db.subDocument.findFirst({ where: { id: documentId, organizationId: c.organizationId }, select: { url: true, name: true, contentType: true } });
  return d;
}

/** The sub signs: a typed name and the consent, with the time, the address and the browser kept. The contract is
 *  executed at once (one conditional write, so two taps make one signature), the signed PDF is made and kept, the
 *  office is told, and the sub gets the copy's link. */
export async function signContract(token: string, input: { name: string; ip: string; userAgent: string | null }): Promise<{ ok: true; already: boolean; signedAt: string; pdfHref: string | null } | { ok: false; error: string }> {
  const c = await byToken(token);
  if (!c) return { ok: false, error: "This link is not valid." };
  if (c.status === "CANCELLED") return { ok: false, error: "This contract was withdrawn — thank you." };
  const pdfHrefOf = (id: string | null) => (id ? `/api/s/${token}/file/${id}?download=1` : null);
  if (c.status === "EXECUTED") return { ok: true, already: true, signedAt: (c.signedAt ?? new Date()).toISOString(), pdfHref: pdfHrefOf(c.pdfDocumentId) };
  if (c.status === "DRAFT") return { ok: false, error: "This contract is not ready to sign yet." };
  const now = new Date();
  const r = await db.subcontract.updateMany({ where: { id: c.id, status: { in: ["SENT", "VIEWED"] } }, data: { status: "EXECUTED", signedName: input.name.trim().slice(0, 120), signedAt: now, signedIp: input.ip.slice(0, 64), signedUserAgent: input.userAgent?.slice(0, 300) ?? null, executedAt: now } });
  if (r.count === 0) {
    const again = await db.subcontract.findUnique({ where: { id: c.id }, select: { status: true, signedAt: true, pdfDocumentId: true } });
    return again?.status === "EXECUTED" ? { ok: true, already: true, signedAt: (again.signedAt ?? now).toISOString(), pdfHref: pdfHrefOf(again.pdfDocumentId) } : { ok: false, error: "This contract can no longer be signed." };
  }
  let pdfId: string | null = null;
  try {
    pdfId = (await buildContractPdf(c.organizationId, c.id)).id;
  } catch (err) {
    console.warn(`[subContracts] the signed PDF could not be made: ${err instanceof Error ? err.message : String(err)}`);
  }
  const total = contractTotal(c.amount, c.changeOrders);
  await tellOffice(c.organizationId, c.projectId, signedLine({ sub: c.contractor.name, number: c.number, what: c.stage?.name ?? null, project: c.project.name, total }), { contractId: c.id, quoteId: c.quoteId, contractorId: c.contractorId, amount: total }, `/dashboard/projects/${c.projectId}/subs?tab=contracts`, { kind: SUB_CONTRACT_KIND, pref: "sub-contract" });
  const base = await appBaseUrl();
  const company = c.organization.name ?? "Our company";
  await mailSub(c.organization, c.contractor.email, `Signed: Subcontract ${contractNo(c.number)} — ${company} — ${c.project.name}`, signedHtml({ company, to: c.contractor.name, project: c.project.name, number: c.number, total, link: `${base}/s/${c.publicToken}`, phone: c.organization.phone }));
  return { ok: true, already: false, signedAt: now.toISOString(), pdfHref: pdfHrefOf(pdfId) };
}

// ── the signed PDF ───────────────────────────────────────────────────────────

/** The agreement with both signatures as a PDF in the private store, recorded as a CONTRACT document on the project
 *  and the sub; the contract keeps its id. Built when the sub signs; the office can build it again. */
export async function buildContractPdf(organizationId: string, id: string): Promise<DocRow> {
  const c = await contractDb(organizationId, id);
  if (c.status !== "EXECUTED") throw new Error("The PDF is made once the contract is signed.");
  const [org, att, address] = await Promise.all([db.organization.findUnique({ where: { id: organizationId }, select: { name: true, phone: true, logoUrl: true, timezone: true } }), attachmentsFor(organizationId, [c]), projectSiteAddress(organizationId, c.projectId)]);
  const tz = org?.timezone || "America/New_York";
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const changes = c.changeOrders.map(changeRow);
  const company = org?.name ?? "The company";
  const sections = agreementSections({
    number: c.number,
    title: c.title,
    company,
    companyPhone: org?.phone ?? null,
    sub: c.contractor.name,
    subCompany: c.contractor.company,
    subLicense: c.contractor.license,
    project: c.project.name,
    projectAddress: address,
    amount: c.amount,
    scope: c.scope,
    startsAt: isoDay(c.startsAt),
    endsAt: isoDay(c.endsAt),
    milestones: parseMilestones(c.milestonesJson),
    terms: c.terms,
    attachments: (att.get(c.id) ?? []).map((d) => d.name),
    changes,
  });
  const [{ renderToBuffer }, { SubcontractPdfDocument }, logoSrc] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/pdf/SubcontractPdf"), pdfLogoSrc(org?.logoUrl)]);
  const data = {
    number: contractNo(c.number),
    title: c.title,
    company: { name: company, phone: org?.phone ?? null, logoSrc },
    sub: { name: c.contractor.name, company: c.contractor.company, license: c.contractor.license },
    project: { name: c.project.name, address },
    sections,
    signatures: {
      company: c.companySignedName && c.companySignedAt ? { name: c.companySignedName, at: when(c.companySignedAt) } : null,
      sub: c.signedName && c.signedAt ? { name: c.signedName, at: when(c.signedAt), ip: c.signedIp, userAgent: c.signedUserAgent } : null,
    },
    stamp: c.executedAt ? `Executed on JobFlex, ${when(c.executedAt)} · ${contractNo(c.number)}` : null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-pdf's element type is its own
  const buf = Buffer.from(await renderToBuffer(createElement(SubcontractPdfDocument, { data }) as any));
  const name = contractFileName(c.number, c.contractor.name);
  const { url } = await putPrivate(docPathname(organizationId, c.projectId, name), buf, "application/pdf");
  const doc = await recordDocument({ organizationId, projectId: c.projectId, contractorId: c.contractorId, requestId: null, kind: "CONTRACT", name, url, contentType: "application/pdf", bytes: buf.byteLength, uploadedVia: "SYSTEM", uploadedById: null });
  await db.subcontract.update({ where: { id: c.id }, data: { pdfDocumentId: doc.id } });
  return doc;
}

// ── change orders ────────────────────────────────────────────────────────────

/** The office proposes a change (plus or minus) on an executed contract; the sub is sent the page to agree on. */
export async function proposeChange(organizationId: string, contractId: string, input: { amount: number; scope: string; reason: string | null }, actorId: string | null): Promise<{ change: ChangeRow; email: SendState; text: SendState }> {
  const c = await contractDb(organizationId, contractId);
  if (c.status !== "EXECUTED") throw new Error("Change orders go on a signed contract.");
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("Type the change's amount — plus or minus, not zero.");
  if (!input.scope.trim()) throw new Error("Say what changes.");
  const number = (c.changeOrders.reduce((m, x) => Math.max(m, x.number), 0) || 0) + 1;
  const ch = await db.subcontractChangeOrder.create({ data: { organizationId, contractId: c.id, number, amount: r2(input.amount), scope: input.scope.trim().slice(0, 4000), reason: input.reason?.trim().slice(0, 1000) || null, proposedById: actorId }, select: CHANGE_SELECT });
  const org = await orgOf(organizationId);
  const [out] = await rowsOf(organizationId, [c]);
  const company = org.name ?? "Our company";
  const email = await mailSub(org, c.contractor.email, `Change order ${changeNo(number)} on Subcontract ${contractNo(c.number)} — ${company} — ${c.project.name}`, changeHtml({ company, to: c.contractor.name, project: c.project.name, contractNumber: c.number, number, amount: ch.amount, scope: ch.scope, reason: ch.reason, link: out.link, phone: org.phone }));
  const text = await textSub(organizationId, c.contractor, `${company}: a change order (${signedUsd(ch.amount)}) on your subcontract ${contractNo(c.number)} for ${c.project.name} is waiting for your answer — ${out.link}`);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Proposed ${changeNo(number)} (${signedUsd(ch.amount)}) on Subcontract ${contractNo(c.number)} to ${c.contractor.name}${ch.reason ? ` — ${ch.reason.slice(0, 120)}` : ""}`, clientId: c.project.clientId, meta: { projectId: c.projectId, contractId: c.id, changeId: ch.id, quoteId: c.quoteId, contractorId: c.contractorId, amount: ch.amount } });
  return { change: changeRow(ch), email, text };
}

/** The sub agrees (a typed name) or declines on the signing page. */
export async function decideChangeByToken(token: string, input: { changeId: string; agree: boolean; name: string | null; reason: string | null; ip: string; userAgent: string | null }): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const c = await byToken(token);
  if (!c) return { ok: false, error: "This link is not valid." };
  if (c.status !== "EXECUTED") return { ok: false, error: "The contract is not signed yet." };
  const ch = c.changeOrders.find((x) => x.id === input.changeId);
  if (!ch) return { ok: false, error: "That change order is not on this contract." };
  if (ch.status !== "PROPOSED") return ch.status === "APPROVED" || ch.status === "DECLINED" ? { ok: true, already: true } : { ok: false, error: "That change order was withdrawn." };
  const name = input.name?.trim() ?? "";
  if (input.agree && (name.length < 2 || !/\p{L}/u.test(name))) return { ok: false, error: "Type your full name to agree." };
  const now = new Date();
  const r = await db.subcontractChangeOrder.updateMany({
    where: { id: ch.id, status: "PROPOSED" },
    data: { status: input.agree ? "APPROVED" : "DECLINED", decidedAt: now, decidedName: input.agree ? name.slice(0, 120) : null, decidedIp: input.ip.slice(0, 64), decidedUserAgent: input.userAgent?.slice(0, 300) ?? null, decidedVia: "SUB", declineReason: input.agree ? null : input.reason?.trim().slice(0, 500) || null },
  });
  if (r.count === 0) return { ok: true, already: true };
  await tellOffice(c.organizationId, c.projectId, changeAnsweredLine({ sub: c.contractor.name, number: ch.number, contractNumber: c.number, agreed: input.agree, amount: ch.amount, project: c.project.name, reason: input.agree ? null : input.reason?.trim().slice(0, 120) || null }), { contractId: c.id, changeId: ch.id, quoteId: c.quoteId, contractorId: c.contractorId, amount: ch.amount }, `/dashboard/projects/${c.projectId}/subs?tab=contracts`, { kind: SUB_CONTRACT_KIND, pref: "sub-contract" });
  return { ok: true, already: false };
}

/** The office approves a change in person (the sub's name typed by the office) or withdraws it. */
export async function decideChangeInOffice(organizationId: string, changeId: string, input: { approve: boolean; name: string | null; reason: string | null }, actorId: string | null): Promise<ChangeRow> {
  const ch = await db.subcontractChangeOrder.findFirst({ where: { id: changeId, organizationId }, select: { ...CHANGE_SELECT, contract: { select: { id: true, number: true, projectId: true, quoteId: true, contractorId: true, contractor: { select: { name: true } }, project: { select: { name: true, clientId: true } } } } } });
  if (!ch) throw new Error("Change order not found");
  if (ch.status !== "PROPOSED") throw new Error("That change order was answered already.");
  const name = input.name?.trim() ?? "";
  if (input.approve && (name.length < 2 || !/\p{L}/u.test(name))) throw new Error("Type the sub's name as they gave it to you.");
  const row = await db.subcontractChangeOrder.update({ where: { id: ch.id }, data: { status: input.approve ? "APPROVED" : "VOID", decidedAt: new Date(), decidedName: input.approve ? name.slice(0, 120) : null, decidedVia: "OFFICE", declineReason: input.approve ? null : input.reason?.trim().slice(0, 500) || null }, select: CHANGE_SELECT });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: input.approve ? `Approved ${changeNo(ch.number)} (${signedUsd(ch.amount)}) on Subcontract ${contractNo(ch.contract.number)} in person — ${name}` : `Withdrew ${changeNo(ch.number)} (${signedUsd(ch.amount)}) on Subcontract ${contractNo(ch.contract.number)}${input.reason ? ` — ${input.reason.slice(0, 120)}` : ""}`, clientId: ch.contract.project.clientId, meta: { projectId: ch.contract.projectId, contractId: ch.contract.id, changeId: ch.id, quoteId: ch.contract.quoteId, contractorId: ch.contract.contractorId, amount: ch.amount } });
  return changeRow(row);
}
