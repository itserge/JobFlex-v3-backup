import "server-only";
// SUBCONTRACTORS FOR THE AI OPERATOR (2026-11-09, the subcontractors plan, part 6) — "find electricians near the Lee
// house", "who hasn't replied on the framing?", "remind them", "compare the framing quotes", "how's the subs budget on
// the Lee house?", "which sub invoices are unpaid?", "open Ridge's invoice", "approve Ridge's invoice", "pay Ridge's
// invoice by check 1043". Six reads and three writes, each a thin call into what the project's Subcontractors section
// runs (lib/subFinder, lib/projectSubs, lib/subQuotes, lib/subInvoices): the Operator never prices or pays anything
// itself. The writes read back for a yes, built here from the stored rows; recording a payment also asks for the PIN.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { projectNamed } from "@/lib/assistant/projects";
import { andList, dayOf } from "@/lib/assistant/shared";
import { hasPin } from "@/lib/assistant/pin";
import { requireFeatureOrThrow } from "@/lib/entitlements";
import { getOrgPlanById } from "@/lib/orgPlan";
import { findSubs } from "@/lib/subFinder/server";
import { LICENSE_KIND_LABEL } from "@/lib/subFinder/shared";
import { resendQuote, sectionMetrics, subsOf } from "@/lib/projectSubs/server";
import { QUOTE_LABEL, dollars, quoteStatusOf, requestNo } from "@/lib/projectSubs/shared";
import { compareRequest } from "@/lib/subQuotes/server";
import { budgetRows } from "@/lib/subQuotes/shared";
import { approveInvoice, invoiceById, invoicesOf, openInvoices, recordPayment, type InvoiceRow } from "@/lib/subInvoices/server";
import { INVOICE_LABEL, MANUAL_METHODS, METHOD_WORD, invoiceNo, invoiceStatusOf, paymentCheck, paymentSuggestion, usd, type PayMethod } from "@/lib/subInvoices/shared";

const ID = z.string().min(1).max(64);
const NO_PIN = "That needs your 4-digit PIN as well as a yes. Set it in Settings → AI Operator → PIN for money, then ask me again.";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** A stage's words match a stage's name: any longer word of one inside the other. */
const stageMatches = (stageName: string | null, words: string | null) => {
  if (!words?.trim()) return true;
  if (!stageName) return false;
  const a = norm(stageName);
  const w = norm(words);
  return a.includes(w) || w.split(" ").some((x) => x.length > 3 && a.includes(x));
};
/** A sub's name as said ("Ridge", "Ridge Framing's") against the name or company on file. */
const subMatches = (name: string, company: string | null, said: string) => {
  const w = norm(said.replace(/'s\b/gi, ""));
  if (!w) return false;
  return norm(name).includes(w) || w.includes(norm(name)) || (company ? norm(company).includes(w) : false);
};

async function oneProject(organizationId: string, projectId: string) {
  const p = await projectNamed(organizationId, { projectId, query: null });
  return "one" in p && p.one ? p.one : null;
}

// ── find ─────────────────────────────────────────────────────────────────────

type FindArgs = { projectId: string | null; trade: string; near: string | null; name: string | null };
const findSubsTool: ReadTool<FindArgs> = {
  kind: "read",
  name: "find_subs",
  need: "projects.read",
  card: {
    label: "Find subs",
    purpose: "Subcontractors the company does not have yet, near a project: the state's contractor register, Google and the JobFlex Network.",
    when: "'Find electricians near the Lee house', 'any licensed roofers in Kirkland?': find_subs with the trade, the project's id (find it first) or the place they said.",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "find electricians near the Lee house", args: { projectId: "proj_1", trade: "Electrical", near: null, name: null } }],
  },
  description:
    "Look for subcontractors of a trade near a project (its address) or a place: Washington's contractor register (license, insurance, bond), Google's ratings and the JobFlex Network, as one list, licensed ones first. projectId from find (kind project) or null with near = a city or address. trade: the trade's name (Electrical, Plumbing, Carpentry, Roofing…). name: part of a company's name, or null. Read only — saving one or asking for a quote is the person's step in the app.",
  params: z.object({ projectId: ID.nullable(), trade: z.string().min(2).max(60), near: z.string().max(200).nullable(), name: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    if (!args.projectId && !args.near) return { note: "Name the project or a place to look near." };
    const r = await findSubs(actor.organizationId, args.projectId, { trade: args.trade, address: args.near, radiusMi: 25, words: args.name, includeLapsed: false });
    return {
      near: r.address,
      results: r.results.slice(0, 8).map((x) => ({
        name: x.name,
        license: x.license ? `${LICENSE_KIND_LABEL[x.license.kind]} ${x.license.number}` : "not in the state register",
        rating: x.rating != null ? `${x.rating} (${x.ratingCount ?? 0})` : null,
        miles: x.distanceMi,
        phone: x.phone,
        website: x.website,
        onJobFlex: Boolean(x.network),
        alreadySaved: Boolean(x.savedId),
      })),
      notes: r.notes,
      more: r.results.length > 8 ? r.results.length - 8 : 0,
    };
  },
};

// ── requests and who has not replied ─────────────────────────────────────────

type ProjectStageArgs = { projectId: string; stage: string | null };
const WAITING = ["ASKED", "VIEWED", "REVISION"];

const subRequestsTool: ReadTool<ProjectStageArgs> = {
  kind: "read",
  name: "sub_requests",
  need: "projects.read",
  card: {
    label: "Quote requests",
    purpose: "A project's requests for quotes: who was asked, who answered, who has not replied, what is overdue.",
    when: "'Who hasn't replied on the framing?', 'what requests are out on the Lee house?': sub_requests with the project's id and the stage's words or null.",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "who hasn't replied on the Lee house framing?", args: { projectId: "proj_1", stage: "framing" } }],
  },
  description: "A project's requests for quotes (RFQ numbers) with every sub asked and where each stands — quoted (with the price), viewed, not opened, passed, overdue — and the list of who has not replied. stage: the stage's words, or null for all.",
  params: z.object({ projectId: ID, stage: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const p = await oneProject(actor.organizationId, args.projectId);
    if (!p) return { note: "I couldn't find that project." };
    const r = await subsOf(actor.organizationId, p.id);
    const requests = r.requests.filter((q) => stageMatches(q.stageName ?? q.title, args.stage));
    const byId = new Map(r.quotes.map((q) => [q.id, q]));
    const rows = requests.map((q) => {
      const recips = q.recipientIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      return {
        request: requestNo(q.number),
        title: q.title,
        status: q.status === "SENT" ? "open" : q.status.toLowerCase(),
        replyBy: q.dueBy,
        subs: recips.map((x) => ({ name: x.contractorName, where: x.status === "QUOTED" && x.amount != null ? `quoted ${dollars(x.amount)}` : QUOTE_LABEL[quoteStatusOf(x.status)], overdue: x.overdue })),
        notReplied: recips.filter((x) => WAITING.includes(x.status)).map((x) => `${x.contractorName}${x.overdue ? " (overdue)" : ""}`),
      };
    });
    return { project: p.name, requests: rows, note: rows.length ? null : `No requests${args.stage ? ` for ${args.stage}` : ""} on ${p.name} yet.` };
  },
};

// ── compare ──────────────────────────────────────────────────────────────────

const compareQuotesTool: ReadTool<ProjectStageArgs> = {
  kind: "read",
  name: "compare_quotes",
  need: "projects.read",
  card: {
    label: "Compare quotes",
    purpose: "One request's quotes side by side — price, labor, materials, deposit, schedule, exclusions, timeline — against the stage's share of the budget.",
    when: "'Compare the framing quotes on the Lee house', 'which electrical quote is better?': compare_quotes with the project's id and the stage's words.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "compare the framing quotes on the Lee house", args: { projectId: "proj_1", stage: "framing" } }],
  },
  description: "The quotes on one request side by side from the AI's reads of the estimates (only figures a person could check): the price, labor, materials, deposit, payment schedule, exclusions, timeline, warranty, the lowest marked, how far over the stage's budget share each is, and the comparison's words when they were written. stage: the stage's words; null = the newest open request.",
  params: z.object({ projectId: ID, stage: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const p = await oneProject(actor.organizationId, args.projectId);
    if (!p) return { note: "I couldn't find that project." };
    const r = await subsOf(actor.organizationId, p.id);
    const pool = r.requests.filter((q) => stageMatches(q.stageName ?? q.title, args.stage));
    // "Compare the quotes" means quotes with prices: the newest request that has one, else the newest open request.
    const priced = new Set(r.quotes.filter((q) => q.amount != null && q.requestId).map((q) => q.requestId!));
    const pick = pool.find((q) => priced.has(q.id)) ?? pool.find((q) => q.status === "SENT") ?? pool[0];
    if (!pick) return { note: `No request${args.stage ? ` for ${args.stage}` : ""} on ${p.name} to compare.` };
    const c = await compareRequest(actor.organizationId, pick.id);
    if (!c) return { note: "That request could not be read." };
    return {
      request: `${requestNo(c.request.number)} · ${c.request.title}`,
      budgetShare: c.line,
      quotes: c.rows.map((x) => ({
        sub: x.contractorName,
        status: QUOTE_LABEL[quoteStatusOf(x.status)],
        price: x.amount,
        lowest: x.lowest,
        overShareBy: x.over ? x.overBy : null,
        labor: x.read?.labor.value ?? null,
        materials: x.read?.materials.value ?? null,
        deposit: x.read?.deposit.value ?? null,
        schedule: x.read?.paymentSchedule ?? null,
        exclusions: x.read?.exclusions ?? [],
        timeline: x.read?.duration ?? null,
        warranty: x.read?.warranty ?? null,
      })),
      words: c.words?.words ?? null,
      note: c.rows.some((x) => x.amount != null) ? null : "No prices are in yet.",
    };
  },
};

// ── the money on a project ───────────────────────────────────────────────────

const subsBudgetTool: ReadTool<{ projectId: string }> = {
  kind: "read",
  name: "subs_budget",
  need: "projects.read",
  card: {
    label: "Subs budget",
    purpose: "A project's Subcontractors money: the budget line, what is committed (signed contracts and awards), pending quotes, paid, retainage held, what is left, by stage.",
    when: "'How's the subs budget on the Lee house?', 'what have we committed to subs?', 'are we over on framing?': subs_budget with the project's id.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "how's the subs budget on the Lee house?", args: { projectId: "proj_1" } }],
  },
  description: "A project's Subcontractors money: the budget line; committed (a signed contract with its approved change orders, else the awarded amount, less what is paid); pending (quoted, not awarded — never counted); paid; retainage held; what is left; and each stage's share with any stage over it.",
  params: z.object({ projectId: ID }),
  async run({ actor }, args) {
    const p = await oneProject(actor.organizationId, args.projectId);
    if (!p) return { note: "I couldn't find that project." };
    const [r, inv] = await Promise.all([subsOf(actor.organizationId, p.id), invoicesOf(actor.organizationId, p.id)]);
    const m = sectionMetrics(r);
    const stageNames = new Map(r.quotes.filter((q) => q.stageId).map((q) => [q.stageId!, q.stageName ?? "Stage"]));
    const rows = budgetRows([...stageNames].map(([id, name]) => ({ id, name })), r.quotes);
    return {
      project: p.name,
      subsBudget: m.subsBudget,
      committed: m.committed,
      pending: m.pending,
      paid: m.paid,
      retainageHeld: inv.totals.held,
      left: m.remaining,
      contractsSigned: m.contractsSigned,
      invoicesToReview: inv.totals.toReview,
      owedNow: inv.totals.owed,
      stages: rows.map((x) => ({ stage: x.stageName, share: x.line, committed: x.committed, pending: x.pending, paid: x.paid, left: x.left, over: x.over })),
      note: m.subsBudget == null ? "The project has no Subcontractors line in its budget." : null,
    };
  },
};

// ── invoices ─────────────────────────────────────────────────────────────────

type InvoicesArgs = { projectId: string | null; which: "unpaid" | "to_review" | "all" };
const invoiceLine = (x: InvoiceRow & { projectName?: string }) => ({
  invoice: invoiceNo(x.number),
  theirNumber: x.invoiceNumber,
  sub: x.contractorName,
  project: x.projectName ?? null,
  bills: x.milestoneName ?? x.stageName,
  amount: x.amount,
  status: INVOICE_LABEL[invoiceStatusOf(x.status)],
  leftToPay: x.status === "APPROVED" ? x.left : null,
  due: x.dueAt,
  toCheck: x.flags.map((f) => f.text),
});

const subInvoicesTool: ReadTool<InvoicesArgs> = {
  kind: "read",
  name: "sub_invoices",
  need: "projects.read",
  card: {
    label: "Sub invoices",
    purpose: "The subs' invoices: what is waiting for review, approved and not paid, or everything on a project.",
    when: "'Which sub invoices are unpaid?', 'any invoices to review on the Lee house?': sub_invoices with the project's id or null for every project, and which.",
    objects: ["invoice", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "which sub invoices are unpaid?", args: { projectId: null, which: "unpaid" } }],
  },
  description: "Subcontractors' invoices (SI numbers) with the sub, the project, what each bills, the amount, its state, what is left to pay, the due day and anything the rules flagged. projectId null = every project (only open ones). which: 'unpaid' = to review or approved and not paid; 'to_review' = waiting for a person; 'all' = a project's every invoice.",
  params: z.object({ projectId: ID.nullable(), which: z.enum(["unpaid", "to_review", "all"]) }),
  async run({ actor }, args) {
    const keep = (x: InvoiceRow) => (args.which === "all" ? x.status !== "VOID" : args.which === "to_review" ? x.status === "RECEIVED" : x.status === "RECEIVED" || x.status === "APPROVED");
    if (args.projectId) {
      const p = await oneProject(actor.organizationId, args.projectId);
      if (!p) return { note: "I couldn't find that project." };
      const r = await invoicesOf(actor.organizationId, p.id);
      const xs = r.invoices.filter(keep);
      return { project: p.name, invoices: xs.map(invoiceLine), owedNow: r.totals.owed, retainageHeld: r.totals.held, note: xs.length ? null : `No ${args.which === "all" ? "" : "open "}invoices on ${p.name}.` };
    }
    const xs = (await openInvoices(actor.organizationId)).filter(keep);
    return { invoices: xs.map(invoiceLine), owedNow: xs.filter((x) => x.status === "APPROVED").reduce((n, x) => n + (x.left ?? 0), 0), note: xs.length ? null : "No open sub invoices." };
  },
};

// ── a sub's document ─────────────────────────────────────────────────────────

type DocArgs = { projectId: string; sub: string; what: "estimate" | "invoice" | "contract" | "waiver" };
const KIND: Record<DocArgs["what"], string> = { estimate: "QUOTE", invoice: "INVOICE", contract: "CONTRACT", waiver: "WAIVER" };

const subDocumentTool: ReadTool<DocArgs> = {
  kind: "read",
  name: "sub_document",
  need: "projects.read",
  card: {
    label: "A sub's document",
    purpose: "A link to a sub's latest estimate, invoice, signed contract or lien waiver on a project.",
    when: "'Open Ridge's estimate on the Lee house', 'send me the signed framing contract': sub_document with the project's id, the sub's name and what.",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "open Ridge's invoice on the Lee house", args: { projectId: "proj_1", sub: "Ridge", what: "invoice" } }],
  },
  description: "The newest document of a kind a sub has on a project — their estimate, invoice, the signed subcontract or a lien waiver — with a link that opens it (the person signs in to JobFlex to see it). sub: the name as said.",
  params: z.object({ projectId: ID, sub: z.string().min(1).max(120), what: z.enum(["estimate", "invoice", "contract", "waiver"]) }),
  async run({ actor }, args) {
    const p = await oneProject(actor.organizationId, args.projectId);
    if (!p) return { note: "I couldn't find that project." };
    const docs = await db.subDocument.findMany({ where: { organizationId: actor.organizationId, projectId: p.id, kind: KIND[args.what] }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, name: true, createdAt: true, contractor: { select: { name: true, company: true } } } });
    const mine = docs.filter((d) => d.contractor && subMatches(d.contractor.name, d.contractor.company, args.sub));
    const d = mine[0];
    if (!d) return { note: `No ${args.what} from ${args.sub} on ${p.name}.` };
    return { name: d.name, sub: d.contractor!.name, kept: d.createdAt.toISOString().slice(0, 10), link: `${await appBaseUrl()}/api/subs/doc/${d.id}`, more: mine.length - 1 };
  },
};

// ── remind ───────────────────────────────────────────────────────────────────

type RemindPayload = { quoteIds: string[]; words: string };
const remindSubsTool: WriteTool<ProjectStageArgs, RemindPayload> = {
  kind: "write",
  name: "remind_subs",
  need: "projects.write",
  card: {
    label: "Remind subs",
    purpose: "Send the request again to the subs who have not replied on a project, by email and text where allowed.",
    when: "'Remind the framers about the quote', 'nudge whoever hasn't answered on the Lee house': remind_subs with the project's id and the stage's words or null.",
    objects: ["project"],
    effect: "message",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "remind the subs who haven't replied on the Lee house", args: { projectId: "proj_1", stage: null } }],
  },
  description: "Send the request for a quote again to every sub on it who has not replied (asked, opened, or asked for a revision) — their own link by email, and by text where they agreed. stage: the stage's words, or null for every open request. Read back for a yes.",
  params: z.object({ projectId: ID, stage: z.string().max(80).nullable() }),
  payload: z.object({ quoteIds: z.array(ID).min(1).max(20), words: z.string() }),
  async plan({ actor }, args) {
    const p = await oneProject(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const r = await subsOf(actor.organizationId, p.id);
    const waiting = r.quotes.filter((q) => WAITING.includes(q.status) && stageMatches(q.stageName, args.stage));
    if (!waiting.length) return { ok: false, say: `Everyone has answered${args.stage ? ` on ${args.stage}` : ""} on ${p.name} — nobody to remind.` };
    const reachable = waiting.filter((q) => q.contractorPhone || q.contractorEmail);
    const skipped = waiting.filter((q) => !q.contractorPhone && !q.contractorEmail);
    if (!reachable.length) return { ok: false, say: `${andList(skipped.map((q) => q.contractorName))} ${skipped.length === 1 ? "has" : "have"} no phone or email on file — copy their link from the project.` };
    const stages = [...new Set(reachable.map((q) => q.stageName ?? "the work"))];
    const words = `Remind ${andList(reachable.map((q) => q.contractorName))} about the quote on ${andList(stages)} (${p.name})`;
    return { ok: true, payload: { quoteIds: reachable.map((q) => q.id), words }, readback: `${words}${skipped.length ? `; ${andList(skipped.map((q) => q.contractorName))} ${skipped.length === 1 ? "has" : "have"} no phone or email, so copy their link` : ""}?` };
  },
  async execute({ actor }, payload) {
    const out: string[] = [];
    for (const id of payload.quoteIds) {
      const r = await resendQuote(actor.organizationId, id);
      const q = await db.projectSubQuote.findUnique({ where: { id }, select: { contractor: { select: { name: true } } } });
      const how = [r.email === "sent" ? "email" : null, r.text === "sent" ? "text" : null].filter(Boolean).join(" and ");
      out.push(`${q?.contractor.name ?? "A sub"} (${how || "not sent — copy the link"})`);
    }
    return { say: `${payload.words} — done: ${out.join(", ")}.`, result: { quoteIds: payload.quoteIds } };
  },
};

// ── approve an invoice ───────────────────────────────────────────────────────

type InvoiceArgs = { projectId: string | null; sub: string; invoice: string | null };
/** The sub's invoices of these states, matched by the sub's name and an invoice word (SI-1006, #R-207, 1006). */
async function invoicesFor(organizationId: string, args: InvoiceArgs, states: string[]) {
  const rows = await db.subInvoice.findMany({ where: { organizationId, status: { in: states }, ...(args.projectId ? { projectId: args.projectId } : {}) }, orderBy: { number: "desc" }, take: 60, select: { id: true, number: true, invoiceNumber: true, contractor: { select: { name: true, company: true } } } });
  const bySub = rows.filter((r) => subMatches(r.contractor.name, r.contractor.company, args.sub));
  if (!args.invoice?.trim()) return bySub;
  const w = norm(args.invoice).replace(/^si /, "").replace(/\s/g, "");
  return bySub.filter((r) => String(r.number) === w.replace(/^si-?/, "") || norm(r.invoiceNumber ?? "").replace(/\s/g, "") === w.replace(/^#/, "") || `si${r.number}` === w);
}

type ApprovePayload = { invoiceId: string; words: string };
const approveInvoiceTool: WriteTool<InvoiceArgs, ApprovePayload> = {
  kind: "write",
  name: "approve_sub_invoice",
  need: "projects.write",
  card: {
    label: "Approve a sub's invoice",
    purpose: "Approve a subcontractor's invoice that is waiting for review, so it can be paid.",
    when: "'Approve Ridge's invoice', 'OK the framing invoice on the Lee house': approve_sub_invoice with the sub's name, the project's id or null, and the invoice number if they said one.",
    objects: ["invoice", "money"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "approve Ridge's invoice on the Lee house", args: { projectId: "proj_1", sub: "Ridge", invoice: null } }],
  },
  description: "Approve a subcontractor's invoice waiting for review (its amount must be confirmed). The read-back says anything the rules flagged — a duplicate, above the payment of the schedule or the contract's balance — so the person decides with it in front of them. invoice: SI-1006, their number, or null for their only one waiting. Read back for a yes.",
  params: z.object({ projectId: ID.nullable(), sub: z.string().min(1).max(120), invoice: z.string().max(40).nullable() }),
  payload: z.object({ invoiceId: ID, words: z.string() }),
  async plan({ actor }, args) {
    const hits = await invoicesFor(actor.organizationId, args, ["RECEIVED"]);
    if (!hits.length) return { ok: false, say: `No invoice from ${args.sub} is waiting for review${args.invoice ? ` as ${args.invoice}` : ""}.` };
    if (hits.length > 1) return { ok: false, say: `${args.sub} has ${hits.length} invoices waiting: ${hits.map((h) => `${invoiceNo(h.number)}${h.invoiceNumber ? ` (#${h.invoiceNumber})` : ""}`).join(", ")}. Which one?` };
    const x = await invoiceById(actor.organizationId, hits[0].id);
    if (x.amount == null) return { ok: false, say: `${invoiceNo(x.number)} has no amount yet — open it in the Invoices tab and confirm the AI's read first.` };
    const project = await db.project.findUnique({ where: { id: x.projectId }, select: { name: true } });
    const words = `Approve ${invoiceNo(x.number)}${x.invoiceNumber ? ` (#${x.invoiceNumber})` : ""} from ${x.contractorName} for ${usd(x.amount)}${x.milestoneName ? `, ${x.milestoneName}` : ""} on ${project?.name ?? "the project"}`;
    return { ok: true, payload: { invoiceId: x.id, words }, readback: `${words}${x.flags.length ? ` — flagged: ${x.flags.map((f) => f.text.replace(/\.$/, "")).join("; ")}` : ""}?` };
  },
  async execute({ actor }, payload) {
    const x = await approveInvoice(actor.organizationId, payload.invoiceId, actor.userId);
    return { say: `${payload.words} — done. It is ready to pay${x.retainagePct ? `; ${x.retainagePct}% retainage is kept from the payment` : ""}.`, result: { invoiceId: x.id } };
  },
};

// ── pay an invoice (money: a yes and the PIN) ────────────────────────────────

type PayArgs = { projectId: string | null; sub: string; invoice: string | null; method: PayMethod; reference: string | null; amount: number | null };
type PayPayload = { invoiceId: string; amount: number; held: number; method: PayMethod; reference: string | null; key: string; words: string };
const PAY_ENUM = z.enum(MANUAL_METHODS as unknown as [PayMethod, ...PayMethod[]]);

const payInvoiceTool: WriteTool<PayArgs, PayPayload> = {
  kind: "write",
  name: "pay_sub_invoice",
  need: "subs.pay",
  card: {
    label: "Record a sub's payment",
    purpose: "Record a payment made to a subcontractor on an approved invoice — by check, ACH, wire, Zelle, cash or card — with the contract's retainage kept back.",
    when: "'Pay Ridge's invoice by check 1043', 'we sent ABC $5,000 by Zelle on their invoice': pay_sub_invoice with the sub's name, the method, the check number or reference, and the amount only if they said one. Asks the person for their PIN with the yes.",
    objects: ["invoice", "payment", "money"],
    effect: "money",
    group: "money",
    version: 1,
    since: "2026-11-09",
    samples: [{ say: "pay Ridge's invoice by check 1043", args: { projectId: null, sub: "Ridge", invoice: null, method: "CHECK", reference: "1043", amount: null } }],
  },
  description:
    "Record that the company paid a subcontractor's approved invoice outside JobFlex (CHECK, ACH, WIRE, ZELLE, CASH, CARD, OTHER), with the check number or reference. amount null = what is left on the invoice, less the retainage the contract keeps back. It writes the project's Subcontractors cost and emails the sub. Nothing is sent from a bank. Asks the person for their PIN with the yes.",
  params: z.object({ projectId: ID.nullable(), sub: z.string().min(1).max(120), invoice: z.string().max(40).nullable(), method: PAY_ENUM, reference: z.string().max(60).nullable(), amount: z.number().min(0.01).max(100_000_000).nullable() }),
  payload: z.object({ invoiceId: ID, amount: z.number(), held: z.number(), method: PAY_ENUM, reference: z.string().nullable(), key: z.string(), words: z.string() }),
  async plan({ actor }, args) {
    const org = actor.organizationId;
    if (!(await hasPin(org, actor.userId))) return { ok: false, say: NO_PIN };
    try {
      requireFeatureOrThrow(await getOrgPlanById(org), "sub_payments");
    } catch (err) {
      return { ok: false, say: err instanceof Error ? err.message : "Your plan doesn't record payments to subs." };
    }
    const approved = await invoicesFor(org, args, ["APPROVED"]);
    if (!approved.length) {
      const waiting = await invoicesFor(org, args, ["RECEIVED"]);
      return { ok: false, say: waiting.length ? `${invoiceNo(waiting[0].number)} from ${args.sub} isn't approved yet — approve it first.` : `No approved invoice from ${args.sub} to pay${args.invoice ? ` as ${args.invoice}` : ""}.` };
    }
    if (approved.length > 1) return { ok: false, say: `${args.sub} has ${approved.length} approved invoices: ${approved.map((h) => `${invoiceNo(h.number)}${h.invoiceNumber ? ` (#${h.invoiceNumber})` : ""}`).join(", ")}. Which one?` };
    const x = await invoiceById(org, approved[0].id);
    if (x.amount == null || x.left == null || !(x.left > 0)) return { ok: false, say: `${invoiceNo(x.number)} is paid in full.` };
    const sug = paymentSuggestion({ invoiceAmount: x.amount, settledSoFar: x.settled, retainagePct: x.retainagePct });
    const amount = args.amount ?? sug.amount;
    const held = args.amount != null ? Math.min(sug.held, Math.max(0, Math.round((x.left - amount) * 100) / 100)) : sug.held;
    const why = paymentCheck({ amount, held, release: false, left: x.left, heldNow: 0 });
    if (why) return { ok: false, say: why };
    const project = await db.project.findUnique({ where: { id: x.projectId }, select: { name: true } });
    const ref = args.reference?.trim() || null;
    const words = `Record ${usd(amount)} paid to ${x.contractorName} by ${METHOD_WORD[args.method]}${ref ? ` ${/^\d/.test(ref) ? "#" : ""}${ref}` : ""} on ${invoiceNo(x.number)}${x.invoiceNumber ? ` (#${x.invoiceNumber})` : ""}, ${project?.name ?? "the project"}${held > 0 ? `, ${usd(held)} retainage kept` : ""}`;
    return { ok: true, payload: { invoiceId: x.id, amount, held, method: args.method, reference: ref, key: `operator:${org}:${randomUUID()}`, words }, readback: `${words}.` };
  },
  async execute({ actor, now }, payload) {
    const r = await recordPayment(actor.organizationId, { invoiceId: payload.invoiceId, amount: payload.amount, held: payload.held, release: false, method: payload.method, reference: payload.reference, paidAt: dayOf(now, actor.timezone), waiverKind: null, waiverFile: null, note: "Recorded by the AI Operator", key: payload.key }, actor.userId);
    return { say: r.duplicate ? "That payment was recorded already." : `${r.payment.words} — recorded${r.email === "sent" ? "; the sub was emailed and asked for the lien waiver" : ""}.`, result: { paymentId: r.payment.id } };
  },
};

export const SUB_TOOLS = [findSubsTool, subRequestsTool, compareQuotesTool, subsBudgetTool, subInvoicesTool, subDocumentTool, remindSubsTool, approveInvoiceTool, payInvoiceTool];
