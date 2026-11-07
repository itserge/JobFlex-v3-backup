import "server-only";
// CONTRACTORS: QUOTES AND INVOICES — the database half (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"). The company's list of contractors; a project asks one or several for a quote on a stage's work
// (each gets a text or an email with their own link, the way a supplier gets the buy link), the contractor answers
// on /q/<token> with a price, the office compares the quotes against the stage's share of the Subcontractors
// budget and awards one; the same link then asks for the invoice, and "paid" logs a Subcontractors expense on the
// project, which the job's cost and the margin read. The rules are ./shared.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import type { EmailDoc } from "@/lib/email/doc";
import { sendText, textOffice } from "@/lib/sms/send";
import { isoDay } from "@/lib/projectTimeline/shared";
import { askText, awardText, compareQuotes, dollars, overdue, quoteFlags, quoteStatusOf, stageSubsBudget, type QuoteLike } from "./shared";

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayWords = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : null);

const ORG_SELECT = { id: true, name: true, phone: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, deletedAt: true } as const;

export type ContractorRow = {
  id: string;
  name: string;
  company: string | null;
  trade: string | null;
  phone: string | null;
  email: string | null;
  license: string | null;
  insuranceUntil: string | null;
  notes: string | null;
};

const CONTRACTOR_SELECT = { id: true, name: true, company: true, trade: true, phone: true, email: true, license: true, insuranceUntil: true, notes: true } as const;
const row = (c: { id: string; name: string; company: string | null; trade: string | null; phone: string | null; email: string | null; license: string | null; insuranceUntil: Date | null; notes: string | null }): ContractorRow => ({
  ...c,
  insuranceUntil: isoDay(c.insuranceUntil),
});

// ── the list ─────────────────────────────────────────────────────────────────

export async function contractorsOf(organizationId: string): Promise<ContractorRow[]> {
  const rows = await db.contractor.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: CONTRACTOR_SELECT });
  return rows.map(row);
}

export type ContractorInput = {
  name: string;
  company?: string | null;
  trade?: string | null;
  phone?: string | null;
  email?: string | null;
  license?: string | null;
  /** ISO day. */
  insuranceUntil?: string | null;
  notes?: string | null;
};

export async function addContractor(organizationId: string, actorId: string | null, input: ContractorInput): Promise<ContractorRow> {
  const c = await db.contractor.create({
    data: {
      organizationId,
      name: input.name.trim().slice(0, 120),
      company: input.company?.trim().slice(0, 120) || null,
      trade: input.trade?.trim().slice(0, 60) || null,
      phone: input.phone?.trim().slice(0, 40) || null,
      email: input.email?.trim().slice(0, 200) || null,
      license: input.license?.trim().slice(0, 80) || null,
      insuranceUntil: day(input.insuranceUntil ?? null),
      notes: input.notes?.trim().slice(0, 1000) || null,
    },
    select: CONTRACTOR_SELECT,
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added contractor ${c.name}${c.trade ? ` (${c.trade})` : ""}`, meta: { contractorId: c.id } });
  return row(c);
}

export async function updateContractor(organizationId: string, id: string, patch: Partial<ContractorInput>): Promise<void> {
  const c = await db.contractor.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!c) throw new Error("Contractor not found");
  await db.contractor.update({
    where: { id },
    data: {
      ...(patch.name !== undefined && { name: patch.name.trim().slice(0, 120) }),
      ...(patch.company !== undefined && { company: patch.company?.trim().slice(0, 120) || null }),
      ...(patch.trade !== undefined && { trade: patch.trade?.trim().slice(0, 60) || null }),
      ...(patch.phone !== undefined && { phone: patch.phone?.trim().slice(0, 40) || null }),
      ...(patch.email !== undefined && { email: patch.email?.trim().slice(0, 200) || null }),
      ...(patch.license !== undefined && { license: patch.license?.trim().slice(0, 80) || null }),
      ...(patch.insuranceUntil !== undefined && { insuranceUntil: day(patch.insuranceUntil ?? null) }),
      ...(patch.notes !== undefined && { notes: patch.notes?.trim().slice(0, 1000) || null }),
    },
  });
}

// ── asking ───────────────────────────────────────────────────────────────────

export type AskInput = { projectId: string; stageId: string | null; contractorIds: string[]; scope: string; dueBy: string | null };
export type SendState = "sent" | "none" | "failed";
export type AskResult = { asked: Array<{ quoteId: string; number: number; contractor: string; link: string; email: SendState; text: SendState }> };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function scopeHtml(scope: string): string {
  const [head, ...lines] = scope.split("\n");
  return `<p><b>${esc(head)}</b></p>${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l.replace(/^-\s*/, ""))}</li>`).join("")}</ul>` : ""}`;
}

function askHtml(i: { company: string; to: string; project: string; scope: string; replyBy: string | null; link: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} would like your quote for this work on ${esc(i.project)}:</p>${scopeHtml(i.scope)}${i.replyBy ? `<p>Please reply by ${esc(i.replyBy)}.</p>` : ""}<p><a href="${esc(i.link)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:4px">Open the request and send your price</a></p><p>The link opens a short page: your price, a note, and later your invoice. No sign-in.</p>${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function awardHtml(i: { company: string; to: string; project: string; scope: string; amount: number | null; link: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>${esc(i.company)} is going with your quote${i.amount != null ? ` (${dollars(i.amount)})` : ""} for ${esc(i.project)} — thank you.</p>${scopeHtml(i.scope)}<p>When the work is done, send your invoice here: <a href="${esc(i.link)}">${esc(i.link)}</a></p>${i.phone ? `<p>Questions: ${esc(i.phone)}</p>` : ""}`;
}

function declinedHtml(i: { company: string; to: string; project: string; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>Thank you for quoting ${esc(i.project)}. ${esc(i.company)} went another way this time — we'll be in touch on the next one.</p>${i.phone ? `<p>${esc(i.phone)}</p>` : ""}`;
}

/** The office's email: one line, one button to the project (lib/email/renderEmail owns the markup). */
function officeDoc(i: { org: { name: string; logoUrl: string | null; phone: string | null }; line: string; href: string }): EmailDoc {
  return {
    subject: i.line.slice(0, 120),
    lockup: { kind: "org", name: i.org.name, logoUrl: i.org.logoUrl },
    kicker: { text: "Project contractors" },
    headline: i.line.slice(0, 200),
    cta: { label: "Open the project", href: i.href },
    footer: { name: i.org.name, contact: i.org.phone ?? undefined },
  };
}

/** The office, by email (everyone whose pref is on) and by text (those who ticked Text) — the same key the buying
 *  and the accepted-proposal notes use. */
async function tellOffice(organizationId: string, projectId: string, line: string): Promise<void> {
  try {
    const base = await appBaseUrl();
    const href = `${base}/dashboard/projects/${projectId}`;
    await textOffice(organizationId, "proposal-accepted", `${line} ${href}`);
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true, phone: true } });
    await sendToMembersByPref(organizationId, "proposal-accepted", officeDoc({ org: { name: org?.name ?? "JobFlex", logoUrl: org?.logoUrl ?? null, phone: org?.phone ?? null }, line, href }));
  } catch (err) {
    console.warn(`[projectSubs] could not tell the office: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type OrgRow = { id: string; name: string | null; phone: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; billingEmail: string | null; deletedAt: Date | null };

async function sendAsk(org: OrgRow, project: { id: string; name: string; number: number | null }, c: { name: string; email: string | null; phone: string | null }, q: { scope: string; dueBy: Date | null; publicToken: string }, what: "ask" | "award"): Promise<{ link: string; email: SendState; text: SendState }> {
  const base = await appBaseUrl();
  const link = `${base}/q/${q.publicToken}`;
  const company = org.name ?? "Our company";
  const label = `${project.name}${project.number ? ` (#${project.number})` : ""}`;
  let email: SendState = "none";
  let text: SendState = "none";
  if (c.email) {
    try {
      await sendOrgEmail(org, {
        to: c.email,
        subject: what === "ask" ? `Quote request — ${company} — ${project.name}` : `You've got the work — ${company} — ${project.name}`,
        html: what === "ask" ? askHtml({ company, to: c.name, project: label, scope: q.scope, replyBy: dayWords(q.dueBy), link, phone: org.phone }) : awardHtml({ company, to: c.name, project: label, scope: q.scope, amount: null, link, phone: org.phone }),
      });
      email = "sent";
    } catch (err) {
      console.warn(`[projectSubs] email to ${c.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      email = "failed";
    }
  }
  if (c.phone) {
    const r = await sendText({ organizationId: org.id, to: c.phone, body: what === "ask" ? askText(company, project.name, dayWords(q.dueBy), link) : awardText(company, project.name, link), kind: "sub-quote" });
    text = r.ok && (r.status === "SENT" || r.status === "HELD") ? "sent" : r.ok ? "none" : "failed";
  }
  return { link, email, text };
}

export async function askQuotes(organizationId: string, actorId: string | null, input: AskInput): Promise<AskResult> {
  const project = await db.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true, name: true, number: true, clientId: true, organization: { select: ORG_SELECT } } });
  if (!project) throw new Error("Project not found");
  const stage = input.stageId ? await db.projectStage.findFirst({ where: { id: input.stageId, projectId: project.id }, select: { id: true, name: true } }) : null;
  if (input.stageId && !stage) throw new Error("Stage not found");
  const ids = [...new Set(input.contractorIds)];
  const contractors = await db.contractor.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true, email: true, phone: true } });
  if (contractors.length !== ids.length) throw new Error("A contractor is not on your list");
  const scope = input.scope.trim().slice(0, 2000);
  const dueBy = day(input.dueBy);
  const top = await db.projectSubQuote.aggregate({ where: { projectId: project.id }, _max: { number: true } });
  let number = top._max.number ?? 0;
  const asked: AskResult["asked"] = [];
  for (const c of contractors) {
    number += 1;
    const q = await db.projectSubQuote.create({
      data: { organizationId, projectId: project.id, stageId: stage?.id ?? null, contractorId: c.id, number, scope, dueBy, createdById: actorId },
      select: { id: true, number: true, scope: true, dueBy: true, publicToken: true },
    });
    const sent = await sendAsk(project.organization, project, c, q, "ask");
    asked.push({ quoteId: q.id, number: q.number, contractor: c.name, ...sent });
  }
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Asked ${contractors.map((c) => c.name).join(", ")} for a quote on ${project.name}${stage ? ` — ${stage.name}` : ""}`,
    clientId: project.clientId,
    meta: { projectId: project.id, stageId: stage?.id ?? null, quotes: asked.map((a) => a.quoteId) },
  });
  return { asked };
}

async function quoteOf(organizationId: string, quoteId: string) {
  const q = await db.projectSubQuote.findFirst({
    where: { id: quoteId, organizationId },
    select: {
      id: true,
      number: true,
      projectId: true,
      stageId: true,
      status: true,
      scope: true,
      amount: true,
      dueBy: true,
      invoiceAmount: true,
      expenseId: true,
      publicToken: true,
      contractor: { select: { id: true, name: true, email: true, phone: true } },
      stage: { select: { name: true } },
      project: { select: { id: true, name: true, number: true, clientId: true, organization: { select: ORG_SELECT } } },
    },
  });
  if (!q) throw new Error("Quote not found");
  return q;
}

/** The office goes with this quote: the others asked for the same stage are declined and told. */
export async function awardQuote(organizationId: string, quoteId: string, actorId: string | null): Promise<{ projectId: string }> {
  const q = await quoteOf(organizationId, quoteId);
  if (q.status !== "QUOTED") throw new Error(q.status === "AWARDED" ? "It is awarded already." : "Only a quote that came in can be awarded.");
  const now = new Date();
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "AWARDED", awardedAt: now } });
  const others = await db.projectSubQuote.findMany({
    where: { projectId: q.projectId, stageId: q.stageId, id: { not: q.id }, status: { in: ["ASKED", "QUOTED"] } },
    select: { id: true, contractor: { select: { name: true, email: true } } },
  });
  if (others.length) await db.projectSubQuote.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "DECLINED", declinedAt: now } });
  await sendAsk(q.project.organization, q.project, q.contractor, q, "award");
  const company = q.project.organization.name ?? "Our company";
  for (const o of others) {
    if (!o.contractor.email) continue;
    try {
      await sendOrgEmail(q.project.organization, { to: o.contractor.email, subject: `About the quote for ${q.project.name} — ${company}`, html: declinedHtml({ company, to: o.contractor.name, project: q.project.name, phone: q.project.organization.phone }) });
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
    meta: { projectId: q.projectId, quoteId: q.id, declined: others.map((o) => o.id) },
  });
  return { projectId: q.projectId };
}

export async function declineQuote(organizationId: string, quoteId: string, actorId: string | null): Promise<{ projectId: string }> {
  const q = await quoteOf(organizationId, quoteId);
  if (q.status !== "ASKED" && q.status !== "QUOTED") throw new Error("Only a quote still open can be declined.");
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "DECLINED", declinedAt: new Date() } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Declined ${q.contractor.name}'s quote on ${q.project.name}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id } });
  return { projectId: q.projectId };
}

/** The contractor is paid: a Subcontractors expense for the invoice (or the amount typed), dated today. */
export async function markQuotePaid(organizationId: string, quoteId: string, amount: number | null, actorId: string | null): Promise<{ projectId: string; expenseId: string }> {
  const q = await quoteOf(organizationId, quoteId);
  if (!["AWARDED", "INVOICED", "PAID"].includes(q.status)) throw new Error("Award the quote first.");
  const amt = r2(Math.max(0, amount ?? q.invoiceAmount ?? q.amount ?? 0));
  if (!(amt > 0)) throw new Error("How much was paid?");
  const vendor = q.contractor.name;
  const note = `Quote ${q.number}${q.stage ? ` · ${q.stage.name}` : ""}`;
  const now = new Date();
  let expenseId = q.expenseId;
  if (expenseId && (await db.projectExpense.findFirst({ where: { id: expenseId, projectId: q.projectId }, select: { id: true } }))) {
    await db.projectExpense.update({ where: { id: expenseId }, data: { amount: amt, vendor, note, paidAt: now } });
  } else {
    expenseId = (await db.projectExpense.create({ data: { projectId: q.projectId, category: "SUBCONTRACTORS", amount: amt, vendor, note, spentAt: now, paidAt: now, createdById: actorId }, select: { id: true } })).id;
  }
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "PAID", paidAt: now, expenseId, invoiceAmount: q.invoiceAmount ?? amt } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Paid ${q.contractor.name} ${dollars(amt)} on ${q.project.name}`, clientId: q.project.clientId, meta: { projectId: q.projectId, quoteId: q.id, expenseId } });
  return { projectId: q.projectId, expenseId };
}

/** The request (or the award) sent again. */
export async function resendQuote(organizationId: string, quoteId: string): Promise<{ projectId: string; email: SendState; text: SendState }> {
  const q = await quoteOf(organizationId, quoteId);
  const what = q.status === "AWARDED" || q.status === "INVOICED" ? "award" : "ask";
  const r = await sendAsk(q.project.organization, q.project, q.contractor, q, what);
  return { projectId: q.projectId, email: r.email, text: r.text };
}

// ── the contractor's page ────────────────────────────────────────────────────

export type QuoteView = {
  company: string;
  phone: string | null;
  project: string;
  contractor: string;
  stage: string | null;
  scope: string;
  replyBy: string | null;
  status: string;
  amount: number | null;
  note: string | null;
  invoiceAmount: number | null;
  invoiceUrl: string | null;
  paid: boolean;
};

export async function quoteView(token: string): Promise<QuoteView | null> {
  const q = await db.projectSubQuote.findUnique({
    where: { publicToken: token },
    select: {
      status: true,
      scope: true,
      dueBy: true,
      amount: true,
      note: true,
      invoiceAmount: true,
      invoiceUrl: true,
      contractor: { select: { name: true } },
      stage: { select: { name: true } },
      project: { select: { name: true, number: true, organization: { select: { name: true, phone: true, deletedAt: true } } } },
    },
  });
  if (!q || q.project.organization.deletedAt) return null;
  return {
    company: q.project.organization.name ?? "The company",
    phone: q.project.organization.phone,
    project: `${q.project.name}${q.project.number ? ` (#${q.project.number})` : ""}`,
    contractor: q.contractor.name,
    stage: q.stage?.name ?? null,
    scope: q.scope,
    replyBy: isoDay(q.dueBy),
    status: q.status,
    amount: q.amount,
    note: q.note,
    invoiceAmount: q.invoiceAmount,
    invoiceUrl: q.invoiceUrl,
    paid: q.status === "PAID",
  };
}

/** The contractor's price (or their no). Asked or already quoted: a new price replaces the old. */
export async function quoteReply(token: string, input: { amount: number | null; note: string | null; decline: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = await db.projectSubQuote.findUnique({ where: { publicToken: token }, select: { id: true, organizationId: true, projectId: true, status: true, contractor: { select: { name: true } }, stage: { select: { name: true } }, project: { select: { name: true, organization: { select: { deletedAt: true } } } } } });
  if (!q || q.project.organization.deletedAt) return { ok: false, error: "This link is not valid." };
  if (q.status !== "ASKED" && q.status !== "QUOTED") return { ok: false, error: "This request is closed — thank you." };
  const now = new Date();
  if (input.decline) {
    await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "DECLINED", declinedAt: now, note: input.note } });
    await tellOffice(q.organizationId, q.projectId, `${q.contractor.name} passed on ${q.stage?.name ?? "the work"} on ${q.project.name}.`);
    return { ok: true };
  }
  if (input.amount == null || !(input.amount >= 0)) return { ok: false, error: "Type your price." };
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "QUOTED", amount: r2(input.amount), note: input.note, quotedAt: now } });
  await tellOffice(q.organizationId, q.projectId, `${q.contractor.name} quoted ${dollars(input.amount)} for ${q.stage?.name ?? "the work"} on ${q.project.name}.`);
  return { ok: true };
}

/** The contractor's invoice, after the award: the amount and a link to the document (or none). */
export async function invoiceReply(token: string, input: { amount: number; url: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = await db.projectSubQuote.findUnique({ where: { publicToken: token }, select: { id: true, organizationId: true, projectId: true, status: true, contractor: { select: { name: true } }, stage: { select: { name: true } }, project: { select: { name: true, organization: { select: { deletedAt: true } } } } } });
  if (!q || q.project.organization.deletedAt) return { ok: false, error: "This link is not valid." };
  if (q.status !== "AWARDED" && q.status !== "INVOICED") return { ok: false, error: q.status === "PAID" ? "This invoice is paid — thank you." : "The work has not been awarded yet." };
  await db.projectSubQuote.update({ where: { id: q.id }, data: { status: "INVOICED", invoiceAmount: r2(input.amount), invoiceUrl: input.url, invoicedAt: new Date() } });
  await tellOffice(q.organizationId, q.projectId, `${q.contractor.name} sent an invoice for ${dollars(input.amount)} on ${q.project.name}${q.stage ? ` (${q.stage.name})` : ""}.`);
  return { ok: true };
}

// ── the card ─────────────────────────────────────────────────────────────────

export type QuoteRow = QuoteLike & {
  number: number;
  stageName: string | null;
  contractorId: string;
  contractorTrade: string | null;
  contractorPhone: string | null;
  contractorEmail: string | null;
  scope: string;
  askedAt: string;
  note: string | null;
  quotedAt: string | null;
  awardedAt: string | null;
  invoiceAmount: number | null;
  invoiceUrl: string | null;
  invoicedAt: string | null;
  paidAt: string | null;
  expenseId: string | null;
  link: string;
  /** The stage's share of the Subcontractors budget, the line it is compared against. */
  line: number | null;
  best: boolean;
  over: boolean;
  overBy: number | null;
  overdue: boolean;
};

export type SubsRead = {
  contractors: ContractorRow[];
  quotes: QuoteRow[];
  /** The project's Subcontractors budget, when it has one. */
  subsBudget: number | null;
  flags: ReturnType<typeof quoteFlags>;
};

export async function subsOf(organizationId: string, projectId: string): Promise<SubsRead> {
  const [contractors, rows, stages, subsLines, base] = await Promise.all([
    contractorsOf(organizationId),
    db.projectSubQuote.findMany({
      where: { projectId, organizationId },
      orderBy: [{ stageId: "asc" }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        stageId: true,
        status: true,
        scope: true,
        dueBy: true,
        askedAt: true,
        amount: true,
        note: true,
        quotedAt: true,
        awardedAt: true,
        invoiceAmount: true,
        invoiceUrl: true,
        invoicedAt: true,
        paidAt: true,
        expenseId: true,
        publicToken: true,
        contractor: { select: { id: true, name: true, trade: true, phone: true, email: true } },
        stage: { select: { name: true } },
      },
    }),
    db.projectStage.findMany({ where: { projectId }, select: { id: true, weight: true } }),
    db.projectBudgetLine.findMany({ where: { projectId, category: "SUBCONTRACTORS", label: null }, select: { amount: true } }),
    appBaseUrl(),
  ]);
  const subsBudget = subsLines.length ? subsLines.reduce((n, l) => n + Math.max(0, l.amount), 0) : null;
  const totalWeight = stages.reduce((n, s) => n + Math.max(0, s.weight), 0);
  const weightOf = new Map(stages.map((s) => [s.id, s.weight]));
  const todayIso = new Date().toISOString().slice(0, 10);
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
      contractorId: r.contractor.id,
      contractorTrade: r.contractor.trade,
      contractorPhone: r.contractor.phone,
      contractorEmail: r.contractor.email,
      scope: r.scope,
      askedAt: r.askedAt.toISOString(),
      note: r.note,
      quotedAt: r.quotedAt?.toISOString() ?? null,
      awardedAt: r.awardedAt?.toISOString() ?? null,
      invoiceAmount: r.invoiceAmount,
      invoiceUrl: r.invoiceUrl,
      invoicedAt: r.invoicedAt?.toISOString() ?? null,
      paidAt: r.paidAt?.toISOString() ?? null,
      expenseId: r.expenseId,
      link: `${base}/q/${r.publicToken}`,
      line: c.line,
      best: c.best,
      over: c.over,
      overBy: c.overBy,
      overdue: overdue(l, todayIso),
    };
  });
  return { contractors, quotes, subsBudget, flags: quoteFlags(likes, todayIso) };
}
