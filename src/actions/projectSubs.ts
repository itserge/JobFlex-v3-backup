"use server";
// CONTRACTORS: QUOTES AND INVOICES — the writes (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"). Projects are estimators' and managers' (actions/projects), so every office write is
// requireEstimatorOrManager and every row is checked against the caller's company; the database work is
// lib/projectSubs/server, the rules lib/projectSubs/shared. The contractor's own page writes through `quoteSave`
// and `invoiceSave` with its token alone (no session): a price and a note, later the invoice — nothing else.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import {
  addContractor,
  askQuotes,
  awardQuote,
  declineQuote,
  invoiceReply,
  markQuotePaid,
  quoteReply,
  resendQuote,
  updateContractor,
  type AskResult,
} from "@/lib/projectSubs/server";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TOKEN = /^[A-Za-z0-9_-]{10,80}$/;

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

const contractorInput = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).nullable().optional(),
  trade: z.string().trim().max(60).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  license: z.string().trim().max(80).nullable().optional(),
  insuranceUntil: DAY.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// ── the list ─────────────────────────────────────────────────────────────────

export async function addProjectContractor(raw: unknown): Promise<{ id: string; name: string; trade: string | null; phone: string | null; email: string | null }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = contractorInput.parse(raw);
  return addContractor(organizationId, user.id, d);
}

export async function updateProjectContractor(raw: unknown): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const d = contractorInput.partial().extend({ id: ID }).parse(raw);
  const { id, ...patch } = d;
  await updateContractor(organizationId, id, patch);
}

// ── the quotes ───────────────────────────────────────────────────────────────

/** Ask one or several contractors for a quote on a stage's work: each gets a text or an email with their own link. */
export async function askProjectQuotes(raw: unknown): Promise<AskResult> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z
    .object({
      projectId: ID,
      stageId: ID.nullable(),
      contractorIds: z.array(ID).min(1).max(12),
      scope: z.string().trim().min(1).max(2000),
      dueBy: DAY.nullable(),
    })
    .parse(raw);
  const r = await askQuotes(organizationId, user.id, d);
  touched(d.projectId);
  return r;
}

export async function awardProjectQuote(quoteId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await awardQuote(organizationId, ID.parse(quoteId), user.id);
  touched(r.projectId);
}

export async function declineProjectQuote(quoteId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await declineQuote(organizationId, ID.parse(quoteId), user.id);
  touched(r.projectId);
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

export async function quoteSave(token: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!TOKEN.test(token)) return { ok: false, error: "This link is not valid." };
  const d = z.object({ amount: z.number().min(0).max(100_000_000).nullable(), note: z.string().trim().max(1000).nullable(), decline: z.boolean() }).safeParse(raw);
  if (!d.success) return { ok: false, error: "Check the price — numbers only." };
  return quoteReply(token, d.data);
}

export async function invoiceSave(token: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!TOKEN.test(token)) return { ok: false, error: "This link is not valid." };
  const d = z.object({ amount: z.number().min(0).max(100_000_000), url: z.string().trim().url().max(500).nullable().or(z.literal("").transform(() => null)) }).safeParse(raw);
  if (!d.success) return { ok: false, error: "Check the amount — numbers only — and the link." };
  return invoiceReply(token, d.data);
}
