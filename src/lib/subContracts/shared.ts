// SUBCONTRACTS — the pure rules (2026-11-08, the subcontractors plan, part 4). The agreement drafted from an awarded
// quote: its statuses and words, the company-wide number, the payment schedule's arithmetic, the default terms, the
// agreement read as numbered sections (the signing page and the PDF draw the same ones), the typed signature's
// schema and words, the change orders' statuses, and the file name of the signed copy. No database, no fetch — the
// checks in qa/tests/logic/sub-contracts.check.ts run these as they are. The database half is ./server.
import { z } from "zod";
import { dollars } from "@/lib/projectSubs/shared";

// ── statuses ─────────────────────────────────────────────────────────────────

export const CONTRACT_STATUSES = ["DRAFT", "SENT", "VIEWED", "EXECUTED", "CANCELLED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_LABEL: Record<ContractStatus, string> = { DRAFT: "Draft", SENT: "Sent for signature", VIEWED: "Opened by the sub", EXECUTED: "Executed", CANCELLED: "Cancelled" };
export const contractStatusOf = (s: string | null | undefined): ContractStatus => ((CONTRACT_STATUSES as readonly string[]).includes(s ?? "") ? (s as ContractStatus) : "DRAFT");
/** The statuses that make a contract the quote's live one — one such contract per quote. */
export const CONTRACT_LIVE: readonly ContractStatus[] = ["DRAFT", "SENT", "VIEWED", "EXECUTED"];
export const canEditContract = (s: string) => s === "DRAFT";
export const canSignContract = (s: string) => s === "SENT" || s === "VIEWED";
export const canCancelContract = (s: string) => s === "DRAFT" || s === "SENT" || s === "VIEWED";

export const CHANGE_STATUSES = ["PROPOSED", "APPROVED", "DECLINED", "VOID"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_LABEL: Record<ChangeStatus, string> = { PROPOSED: "Waiting for the sub", APPROVED: "Approved", DECLINED: "Declined", VOID: "Withdrawn" };
export const changeStatusOf = (s: string | null | undefined): ChangeStatus => ((CHANGE_STATUSES as readonly string[]).includes(s ?? "") ? (s as ChangeStatus) : "PROPOSED");

export const CONTRACT_FIRST_NUMBER = 1001;
export const contractNo = (n: number) => `SC-${n}`;
export const changeNo = (n: number) => `CO #${n}`;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Dollars with cents when there are any ("$18,500" · "$1,234.50"). */
export const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
/** A signed amount for a change order ("+$3,500" · "−$1,200"). */
export const signedUsd = (n: number) => (n < 0 ? "−" : "+") + usd(Math.abs(n));
const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ── the payment schedule ─────────────────────────────────────────────────────

export type Milestone = { name: string; pct: number; due: string | null };
export const MAX_MILESTONES = 8;

export function parseMilestones(json: string | null | undefined): Milestone[] {
  try {
    const v = JSON.parse(json || "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
      .map((m) => ({ name: String(m.name ?? "").slice(0, 80), pct: Number.isFinite(Number(m.pct)) ? r1(Number(m.pct)) : 0, due: typeof m.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.due) ? m.due : null }))
      .slice(0, MAX_MILESTONES);
  } catch {
    return [];
  }
}

/** The schedule a draft starts with: a deposit at signing and the rest on completion, or everything on completion. */
export function defaultMilestones(depositPct: number | null): Milestone[] {
  const d = depositPct != null && depositPct > 0 && depositPct < 100 ? r1(depositPct) : 0;
  return d ? [{ name: "Deposit, at signing", pct: d, due: null }, { name: "On completion", pct: r1(100 - d), due: null }] : [{ name: "On completion", pct: 100, due: null }];
}

/** Each payment's dollars from the price: rounded to cents, the last one taking the rounding so they add up. */
export function milestoneAmounts(amount: number, ms: readonly Milestone[]): Array<Milestone & { amount: number }> {
  if (!ms.length) return [];
  const out = ms.map((m) => ({ ...m, amount: r2((amount * m.pct) / 100) }));
  const sum = r2(out.reduce((n, m) => n + m.amount, 0));
  out[out.length - 1].amount = r2(out[out.length - 1].amount + (r2(amount) - sum));
  return out;
}

/** Why a schedule cannot be sent, or null when it can. */
export function milestonesCheck(ms: readonly Milestone[]): string | null {
  if (!ms.length) return "The payment schedule needs at least one payment.";
  if (ms.length > MAX_MILESTONES) return `The payment schedule takes up to ${MAX_MILESTONES} payments.`;
  if (ms.some((m) => !m.name.trim())) return "Every payment needs a name.";
  if (ms.some((m) => !(m.pct > 0))) return "Every payment needs a share above zero.";
  const sum = r1(ms.reduce((n, m) => n + m.pct, 0));
  if (Math.abs(sum - 100) > 0.05) return `The payment schedule adds up to ${sum}%, not 100%.`;
  return null;
}

// ── the draft from the quote ─────────────────────────────────────────────────

export type DraftSource = {
  company: string;
  sub: string;
  project: string;
  stage: string | null;
  trade: string | null;
  amount: number | null;
  scope: string;
  description: string | null;
  materials: string | null;
  labor: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type ContractDraft = { title: string; amount: number; scope: string; startsAt: string | null; endsAt: string | null; depositPct: number | null; milestones: Milestone[]; terms: string };

/** The agreement as it starts: the awarded price, the request's scope with its details folded in, the request's
 *  dates, everything due on completion, and the standard terms with the names filled in. The office edits it all. */
export function draftFromQuote(src: DraftSource): ContractDraft {
  const what = src.stage ?? src.trade ?? "Subcontract";
  const scope = [src.scope.trim(), src.description ? `Details: ${src.description.trim()}` : null, src.materials ? `Materials: ${src.materials.trim()}` : null, src.labor ? `Labor: ${src.labor.trim()}` : null].filter(Boolean).join("\n\n");
  return {
    title: `${what} — ${src.project}`,
    amount: r2(Math.max(0, src.amount ?? 0)),
    scope,
    startsAt: src.startsAt,
    endsAt: src.endsAt,
    depositPct: null,
    milestones: defaultMilestones(null),
    terms: defaultTerms({ company: src.company, sub: src.sub }),
  };
}

/** The standard terms — plain words, numbered, a starting point the office edits and their attorney reviews. */
export function defaultTerms(i: { company: string; sub: string }): string {
  const C = i.company.trim() || "the Contractor";
  const S = i.sub.trim() || "the Subcontractor";
  return [
    `1. The work. ${S} will perform the work in the Scope at the project address in a good and workmanlike manner, to code and to the plans and specifications ${C} has shared for the project. Permits and inspections for ${S}'s trade are ${S}'s to obtain unless the Scope says otherwise.`,
    `2. The price. The Price is a lump sum. It includes labor, materials, equipment, supervision, daily cleanup of ${S}'s own work and all taxes. Nothing beyond the Scope is owed unless both parties approve a written change order on JobFlex before that work begins.`,
    `3. The schedule. ${S} will start and finish on the dates in the Schedule, or on dates the parties agree in writing, and will tell ${C} at once of anything that will delay the work. ${C} will have the site ready and the prior trades done so ${S} can work.`,
    `4. Payment. ${C} pays per the Payment Schedule against ${S}'s invoices, within ten days of approving each invoice. A payment may be held back only for work not yet done, defective work, or a lien waiver not yet given. ${S} gives a lien waiver for each payment received and a final unconditional waiver with the last.`,
    `5. Change orders. A change in the Scope, the Price or the Schedule takes a change order written on JobFlex, with its price, agreed by both parties before the changed work starts. Work done without one is not paid for.`,
    `6. License, insurance and people. ${S} holds a current contractor's license for its trade in the state of the project and keeps general liability and workers' compensation insurance in force for the whole job, with certificates on request. ${S}'s crews are ${S}'s employees or ${S}'s own subcontractors, paid and insured by ${S}.`,
    `7. Safety, the site and damage. ${S} follows the site's safety rules, keeps its work area clean each day, protects finished work and makes good any damage its work causes.`,
    `8. Warranty. ${S} warrants its work and materials for one year from completion and will correct defective work at its own cost when ${C} gives notice in that year. Manufacturers' warranties pass to the owner.`,
    `9. Ending the agreement. Either party may end this agreement on seven days' written notice if the other fails to cure a breach in that time. ${C} pays ${S} for work done and accepted to that day, less the cost of finishing or correcting it.`,
    `10. Signatures. The parties agree that typing a name on JobFlex, with the box ticked, is a signature with the same force as one in ink, under the federal ESIGN Act and the state's electronic transactions law, and that this agreement with its Scope, Schedule and Payment Schedule is the whole agreement between them for this work. The law of the state of the project applies.`,
  ].join("\n\n");
}

// ── the agreement, read as sections ──────────────────────────────────────────

export type ChangeLike = { number: number; status: string; amount: number; scope: string };

export type AgreementLike = {
  number: number;
  title: string;
  company: string;
  companyPhone: string | null;
  sub: string;
  subCompany: string | null;
  subLicense: string | null;
  project: string;
  projectAddress: string | null;
  amount: number;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  milestones: readonly Milestone[];
  terms: string;
  attachments: readonly string[];
  changes: readonly ChangeLike[];
};

export type AgreementSection = { key: string; heading: string; lines: string[] };

/** The price plus the approved change orders. */
export function contractTotal(amount: number, changes: ReadonlyArray<{ status: string; amount: number }>): number {
  return r2(amount + changes.filter((c) => c.status === "APPROVED").reduce((n, c) => n + c.amount, 0));
}

/** The agreement's sections, the same on the signing page and in the PDF: the parties, the scope, the price, the
 *  schedule, the payment schedule, the terms, the attachments. Approved change orders show under the price. */
export function agreementSections(a: AgreementLike): AgreementSection[] {
  const who = `${a.sub}${a.subCompany && a.subCompany !== a.sub ? ` of ${a.subCompany}` : ""}${a.subLicense ? `, license ${a.subLicense}` : ""}`;
  const approved = a.changes.filter((c) => c.status === "APPROVED");
  const out: AgreementSection[] = [
    { key: "parties", heading: "The parties", lines: [`${a.company} (the Contractor) and ${who} (the Subcontractor) agree as follows for the project ${a.project}${a.projectAddress ? ` at ${a.projectAddress}` : ""}.`] },
    { key: "scope", heading: "1. Scope of work", lines: a.scope.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean) },
    {
      key: "price",
      heading: "2. The price",
      lines: [
        `The Subcontractor will do the work for ${usd(a.amount)}, a lump sum that includes labor, materials, equipment, supervision, cleanup and taxes unless the Scope says otherwise.`,
        ...approved.map((c) => `Approved ${changeNo(c.number)}: ${signedUsd(c.amount)} — ${c.scope.trim()}`),
        ...(approved.length ? [`The contract total is now ${usd(contractTotal(a.amount, a.changes))}.`] : []),
      ],
    },
    {
      key: "schedule",
      heading: "3. The schedule",
      lines: [a.startsAt || a.endsAt ? `Work starts ${a.startsAt ? `on ${longDay(a.startsAt)}` : "on a day the parties agree"} and is finished ${a.endsAt ? `by ${longDay(a.endsAt)}` : "within the time the parties agree"}.` : "Work starts and finishes on dates the parties agree in writing."],
    },
    { key: "payments", heading: "4. Payment schedule", lines: milestoneAmounts(a.amount, a.milestones).map((m) => `${m.name}: ${m.pct}% — ${usd(m.amount)}${m.due ? `, due ${longDay(m.due)}` : ""}`) },
    { key: "terms", heading: "5. Terms", lines: a.terms.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) },
  ];
  if (a.attachments.length) out.push({ key: "attachments", heading: "Attachments", lines: a.attachments.map((n) => n) });
  return out;
}

// ── the typed signature ──────────────────────────────────────────────────────

export const SIGN_WORDS = "I have read this subcontract and agree to it. Typing my name is my signature.";
export const AGREE_CHANGE_WORDS = "I agree to this change order. Typing my name is my signature.";

export const signInput = z.object({
  name: z.string().trim().min(2, "Type your full name.").max(120).regex(/\p{L}/u, "Type your full name."),
  agree: z.literal(true, { errorMap: () => ({ message: "Tick the box to agree." }) }),
});
export type SignInput = z.infer<typeof signInput>;

export const changeDecisionInput = z.discriminatedUnion("agree", [
  z.object({ changeId: z.string().min(1).max(64), agree: z.literal(true), name: z.string().trim().min(2, "Type your full name.").max(120).regex(/\p{L}/u, "Type your full name.") }),
  z.object({ changeId: z.string().min(1).max(64), agree: z.literal(false), reason: z.string().trim().max(500).nullable().optional() }),
]);

export type SignatureLike = { signedName: string | null; signedAt: string | null; signedIp: string | null };

/** "Signed by Ridge Framing LLC on November 8, 2026 from 203.0.113.9". */
export function signatureWords(s: SignatureLike): string | null {
  if (!s.signedName || !s.signedAt) return null;
  return `Signed by ${s.signedName} on ${longDay(s.signedAt)}${s.signedIp && s.signedIp !== "local" && s.signedIp !== "unknown" ? ` from ${s.signedIp}` : ""}`;
}

// ── words for the rows ───────────────────────────────────────────────────────

export type ContractWordsLike = { status: string; sentAt: string | null; viewedAt: string | null; signedName: string | null; signedAt: string | null; cancelledAt: string | null; cancelReason: string | null; changes: ReadonlyArray<{ status: string }> };

/** The row's state in a few words. */
export function contractWords(c: ContractWordsLike): string {
  const st = contractStatusOf(c.status);
  const pending = c.changes.filter((x) => x.status === "PROPOSED").length;
  if (st === "DRAFT") return "Draft — not sent yet";
  if (st === "SENT") return `Sent${c.sentAt ? ` ${shortDay(c.sentAt)}` : ""} · waiting for the signature`;
  if (st === "VIEWED") return `Opened${c.viewedAt ? ` ${shortDay(c.viewedAt)}` : ""} · not signed yet`;
  if (st === "EXECUTED") return `Signed${c.signedName ? ` by ${c.signedName}` : ""}${c.signedAt ? ` ${shortDay(c.signedAt)}` : ""}${pending ? ` · ${pending} change order${pending === 1 ? "" : "s"} waiting` : ""}`;
  return `Cancelled${c.cancelledAt ? ` ${shortDay(c.cancelledAt)}` : ""}${c.cancelReason ? ` — ${c.cancelReason}` : ""}`;
}

/** The signed copy's file name: "SC-1001-ridge-framing-signed.pdf". */
export function contractFileName(number: number, sub: string): string {
  const slug = sub
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${contractNo(number)}${slug ? `-${slug}` : ""}-signed.pdf`;
}

/** The office's line when a contract is signed, for the bell, the text and the email. */
export function signedLine(i: { sub: string; number: number; what: string | null; project: string; total: number }): string {
  return `${i.sub} signed Subcontract ${contractNo(i.number)}${i.what ? ` for ${i.what}` : ""} on ${i.project} (${dollars(i.total)}).`;
}

/** The office's line when a change order is answered. */
export function changeAnsweredLine(i: { sub: string; number: number; contractNumber: number; agreed: boolean; amount: number; project: string; reason: string | null }): string {
  return i.agreed ? `${i.sub} agreed to ${changeNo(i.number)} (${signedUsd(i.amount)}) on Subcontract ${contractNo(i.contractNumber)}, ${i.project}.` : `${i.sub} declined ${changeNo(i.number)} (${signedUsd(i.amount)}) on Subcontract ${contractNo(i.contractNumber)}, ${i.project}${i.reason ? ` — ${i.reason}` : ""}.`;
}
