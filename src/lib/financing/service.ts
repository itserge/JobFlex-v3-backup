// WISETACK FINANCING — the service: what the Settings actions, the proposal editor, the client's page, the webhook
// and the reconcile call. Wisetack answers through ./provider; the states and their rules are ./state; where it is
// kept is ./store. Spec: docs/superpowers/specs/2026-10-28-wisetack-financing-design.md

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { afterResponse } from "@/lib/server-events";
import { textOffice } from "@/lib/sms/send";
import { appBaseUrl } from "@/lib/appUrl";
import { OWNER_ROLE } from "@/lib/orgContext";
import { settleInstallmentPayment } from "@/lib/payments/settle";
import { sendText } from "@/lib/sms/send";
import { brand, clip } from "@/lib/sms/format";
import { toE164 } from "@/lib/phone";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { getProvider, type MerchantSnapshot, type ProviderEvent } from "./provider";
import { merchantPrefill, readinessFacts, type PrefillOrg, type PrefillOwner } from "./prefill";
import { contractSchedule, APPROVED_CO_SELECT } from "@/lib/contractTotal";
import { resolveSchedule } from "@/lib/paymentSchedule";
import { planEnded } from "@/lib/paidCaps";
import { coverMinor, loanEventFor, loanSideEffects, nextLoanState, offerFor, orgLetIn, readiness, reminderDue, reuseLoan, type Funding, type Loan, type LoanSnapshot, type OrgFinancing } from "./state";
import { listLoans, listOrgFinancing, orgIdForMerchantRef, proposalForLoanRef, readLoan, readLoans, readOffer, readOffers, readOrgFinancing, readSwitch, writeLoan, writeOffer, writeOrgFinancing } from "./store";
import { editorFinancing, linkLands, portalFinancingFrom, rowFinancing, type EditorFinancing, type PortalFinancing } from "./view";
import { FIN } from "./words";

export const SETTINGS_HREF = "/dashboard/settings?pane=payments&sub=financing";

/** Whether this contractor sees financing at all, and their record. */
export async function orgFinancingView(orgId: string): Promise<{ letIn: boolean; available: boolean; rec: OrgFinancing }> {
  const [sw, rec] = await Promise.all([readSwitch(), readOrgFinancing(orgId)]);
  return { letIn: orgLetIn(sw, orgId), available: getProvider() !== null, rec };
}

const ORG_SELECT = { id: true, name: true, phone: true, website: true, address: true, billingEmail: true, tradeTypesJson: true } as const;

async function orgAndOwner(orgId: string): Promise<{ org: PrefillOrg; owner: PrefillOwner } | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: ORG_SELECT });
  if (!org) return null;
  const seat = await db.membership.findFirst({ where: { organizationId: orgId, role: OWNER_ROLE }, select: { user: { select: { name: true, email: true } } } });
  return { org, owner: seat?.user ? { name: seat.user.name ?? null, email: seat.user.email ?? null } : null };
}

/** The readiness list for the Settings tab. */
export async function financingReadiness(orgId: string, rec: OrgFinancing) {
  const found = await orgAndOwner(orgId);
  if (!found) return readiness({ name: null, phone: null, email: null, address: null, website: null, trade: null, yearStarted: rec.yearStarted });
  return readiness(readinessFacts(found.org, found.owner, rec));
}

/** A text and a bell row to the office. The bell opens `href`. */
export async function notifyFinancing(orgId: string, line: string, opts: { kind: string; href: string; proposalId?: string | null; clientId?: string | null }): Promise<void> {
  await logActivity({ organizationId: orgId, actorId: null, kind: opts.kind, summary: line, proposalId: opts.proposalId ?? null, clientId: opts.clientId ?? null, meta: { href: opts.href } });
  afterResponse(async () => {
    await textOffice(orgId, "financing", line);
  });
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_OPEN = "Financing isn't open for your account yet.";
const NO_ANSWER = "Wisetack didn't answer — try again in a minute.";

export async function startApplication(orgId: string, actorId: string): Promise<Result<{ url: string }>> {
  const provider = getProvider();
  const view = await orgFinancingView(orgId);
  if (!provider || !view.letIn) return { ok: false, error: NOT_OPEN };
  if (view.rec.state === "approved") return { ok: false, error: "You're already approved." };
  // An application that is open goes back to the same Wisetack page.
  if ((view.rec.state === "started" || view.rec.state === "needs_info") && view.rec.applyUrl) return { ok: true, url: view.rec.applyUrl };
  const found = await orgAndOwner(orgId);
  if (!found) return { ok: false, error: NOT_OPEN };
  const returnUrl = `${await appBaseUrl()}${SETTINGS_HREF}&financing=back`;
  try {
    const { merchantRef, url } = await provider.startMerchant(merchantPrefill(found.org, found.owner, view.rec, returnUrl));
    const now = new Date().toISOString();
    await writeOrgFinancing(orgId, { ...view.rec, merchantRef, state: "started", appliedAt: now, decidedAt: null, needs: [], note: null, applyUrl: url, checkedAt: now });
    await logActivity({ organizationId: orgId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: "Started a Wisetack application for monthly payments" });
    return { ok: true, url };
  } catch {
    return { ok: false, error: NO_ANSWER };
  }
}

export async function linkExisting(orgId: string, email: string, actorId: string): Promise<Result<{ url: string | null; rec: OrgFinancing }>> {
  const provider = getProvider();
  const view = await orgFinancingView(orgId);
  if (!provider || !view.letIn) return { ok: false, error: NOT_OPEN };
  const clean = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean)) return { ok: false, error: "Type the email you use for Wisetack." };
  try {
    const r = await provider.linkMerchant({ email: clean, reference: orgId, returnUrl: `${await appBaseUrl()}${SETTINGS_HREF}&financing=back` });
    if ("error" in r) return { ok: false, error: "Wisetack doesn't have an account with that email. Use the email on your Wisetack account, or apply." };
    await writeOrgFinancing(orgId, { ...view.rec, merchantRef: r.merchantRef, state: "review", appliedAt: new Date().toISOString(), applyUrl: r.url });
    await logActivity({ organizationId: orgId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: "Linked the company's Wisetack account" });
    const rec = await refreshMerchant(orgId);
    return { ok: true, url: r.url, rec };
  } catch {
    return { ok: false, error: NO_ANSWER };
  }
}

/** Ask Wisetack where the application stands. */
export async function refreshMerchant(orgId: string): Promise<OrgFinancing> {
  const provider = getProvider();
  const rec = await readOrgFinancing(orgId);
  if (!provider || !rec.merchantRef) return rec;
  return applyMerchantSnapshot(orgId, await provider.merchant(rec.merchantRef));
}

const DECIDED_WORDS: Partial<Record<OrgFinancing["state"], string>> = {
  approved: "Wisetack approved your company for monthly payments — turn it on for any proposal.",
  needs_info: "Wisetack needs a little more for your financing application — finish it in Settings → Integrations / Payments → Financing.",
  declined: "Wisetack didn't approve your financing application — their email says why.",
  paused: "Wisetack paused financing on your account.",
};

export async function applyMerchantSnapshot(orgId: string, s: MerchantSnapshot): Promise<OrgFinancing> {
  const before = await readOrgFinancing(orgId);
  const now = new Date().toISOString();
  const changed = before.state !== s.state;
  const after: OrgFinancing = {
    ...before,
    state: s.state,
    needs: s.needs,
    note: s.note,
    minMinor: s.minMinor ?? before.minMinor,
    maxMinor: s.maxMinor ?? before.maxMinor,
    feeBps: s.feeBps ?? before.feeBps,
    prequalUrl: s.prequalUrl ?? before.prequalUrl,
    decidedAt: changed && (s.state === "approved" || s.state === "declined") ? now : before.decidedAt,
    checkedAt: now,
  };
  await writeOrgFinancing(orgId, after);
  const words = DECIDED_WORDS[s.state];
  if (changed && words) await notifyFinancing(orgId, words, { kind: "FINANCING_ACCOUNT", href: SETTINGS_HREF });
  return after;
}

export async function setDefault(orgId: string, on: boolean): Promise<OrgFinancing> {
  const rec = { ...(await readOrgFinancing(orgId)), offerByDefault: on };
  await writeOrgFinancing(orgId, rec);
  return rec;
}

export async function setYearStarted(orgId: string, year: number | null): Promise<OrgFinancing> {
  const ok = year !== null && Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear();
  const rec = { ...(await readOrgFinancing(orgId)), yearStarted: ok ? year : null };
  await writeOrgFinancing(orgId, rec);
  return rec;
}

export const usd = (minor: number) => `$${Math.round(minor / 100).toLocaleString("en-US")}`;

/** A proposal with what is owed on it right now (contract total with approved change orders, minus what is paid). */
export async function proposalMoney(orgId: string, proposalId: string, scope: { ownerId?: string } = {}) {
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, organizationId: orgId, ...scope },
    include: {
      installments: { orderBy: { position: "asc" } },
      changeOrders: APPROVED_CO_SELECT,
      client: { select: { id: true, name: true, email: true, phone: true } },
    },
  });
  if (!proposal) return null;
  const schedule = resolveSchedule({ ...contractSchedule(proposal.total, proposal.changeOrders), currency: proposal.currency, installments: proposal.installments });
  return { proposal, schedule, owedMinor: schedule.remainingMinor };
}

/** The editor's "Offer monthly payments" row, or null when it does not exist for this proposal. */
export async function loadEditorFinancing(orgId: string, proposalId: string, scope: { ownerId?: string } = {}): Promise<EditorFinancing | null> {
  const money = await proposalMoney(orgId, proposalId, scope);
  if (!money) return null;
  const [view, proposalOn, loan, ended] = await Promise.all([orgFinancingView(orgId), readOffer(proposalId), readLoan(proposalId), planEnded(orgId)]);
  if (!view.available) return null;
  return editorFinancing({ proposalId, letIn: view.letIn, org: view.rec, proposalOn, owedMinor: money.owedMinor, status: money.proposal.status, planEnded: ended, loan, money: usd });
}

/** The proposal's switch: true / false, or null to follow the company's default. */
export async function setProposalOffer(orgId: string, proposalId: string, on: boolean | null, scope: { ownerId?: string } = {}): Promise<EditorFinancing | null> {
  const exists = await db.proposal.findFirst({ where: { id: proposalId, organizationId: orgId, ...scope }, select: { id: true } });
  if (!exists) return null;
  await writeOffer(proposalId, on);
  return loadEditorFinancing(orgId, proposalId, scope);
}

const SIGNED = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const DEAD = new Set(["declined", "expired", "canceled", "paid", "refunded"]);
export const NOT_AVAILABLE = "Monthly payments are not available for this proposal.";

/** The client's page part (lib/payments/portalModel). Null when Wisetack is not connected on this deployment. */
export async function portalFinancing(i: { orgId: string; proposalId: string; status: string; stages: { id: string; amountMinor: number; status: string }[]; owedMinor: number }): Promise<PortalFinancing | null> {
  if (!getProvider()) return null;
  const [view, proposalOn, loan, ended] = await Promise.all([orgFinancingView(i.orgId), readOffer(i.proposalId), readLoan(i.proposalId), planEnded(i.orgId)]);
  const offer = offerFor({ letIn: view.letIn, org: view.rec, proposalOn, owedMinor: i.owedMinor, status: i.status, planEnded: ended });
  // Wisetack's own monthly wording waits for its docs: asking on every page view would slow every client's page.
  return portalFinancingFrom({ offered: offer.offered, signed: SIGNED.has(i.status), org: view.rec, loan, stages: i.stages, owedMinor: i.owedMinor, monthly: null, money: usd });
}

/** The client pressed Pay over time: the live loan, or a new one for what is owed right now. */
export async function openLoanForClient(publicId: string): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  const provider = getProvider();
  if (!provider) return { ok: false, status: 404, error: NOT_AVAILABLE };
  const row = await db.proposal.findUnique({ where: { publicId }, select: { id: true, organizationId: true, organization: { select: { deletedAt: true } } } });
  if (!row || row.organization.deletedAt) return { ok: false, status: 404, error: NOT_AVAILABLE };
  const money = await proposalMoney(row.organizationId, row.id);
  if (!money) return { ok: false, status: 404, error: NOT_AVAILABLE };
  const p = money.proposal;
  if (!SIGNED.has(p.status)) return { ok: false, status: 409, error: "Accept the proposal first — then choose Pay over time." };
  // One application at a time per proposal: a second tab waits for the first instead of opening a second loan.
  if (!(await takeLoanLock(p.id))) return { ok: false, status: 409, error: "Opening Wisetack — one moment, then press again." };
  try {
    return await openLoanLocked(publicId, p, money.owedMinor);
  } finally {
    await db.syncState.deleteMany({ where: { key: `financingLock:${p.id}` } }).catch(() => {});
  }
}

async function takeLoanLock(proposalId: string): Promise<boolean> {
  const key = `financingLock:${proposalId}`;
  try {
    await db.syncState.create({ data: { key, cursor: String(Date.now()) } });
    return true;
  } catch {
    // A lock older than 30 s is a crashed request's: take it over.
    const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
    if (row && Date.now() - Number(row.cursor) < 30_000) return false;
    await db.syncState.upsert({ where: { key }, update: { cursor: String(Date.now()) }, create: { key, cursor: String(Date.now()) } });
    return true;
  }
}

async function openLoanLocked(
  publicId: string,
  p: NonNullable<Awaited<ReturnType<typeof proposalMoney>>>["proposal"],
  owedMinor: number,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  const provider = getProvider();
  if (!provider) return { ok: false, status: 404, error: NOT_AVAILABLE };
  const money = { owedMinor };
  const [view, proposalOn, loan, ended] = await Promise.all([orgFinancingView(p.organizationId), readOffer(p.id), readLoan(p.id), planEnded(p.organizationId)]);
  const now = new Date();
  if (loan && reuseLoan(loan, money.owedMinor, now) && loan.url) return { ok: true, url: loan.url };
  const offer = offerFor({ letIn: view.letIn, org: view.rec, proposalOn, owedMinor: money.owedMinor, status: p.status, planEnded: ended });
  if (!offer.offered || !view.rec.merchantRef) return { ok: false, status: 404, error: NOT_AVAILABLE };
  // A loan for an older amount the client never accepted goes; the new one asks for today's.
  if (loan && !DEAD.has(loan.state)) await provider.cancelLoan(loan.ref).catch(() => {});
  try {
    const created = await provider.createLoan({
      merchantRef: view.rec.merchantRef,
      amountMinor: money.owedMinor,
      purpose: p.title,
      reference: p.id,
      client: { name: p.client?.name ?? "Client", phone: p.client?.phone ?? null, email: p.client?.email ?? null },
      returnUrl: `${await appBaseUrl()}/portal/q/${encodeURIComponent(publicId)}?financing=back#pay-over-time`,
    });
    const at = now.toISOString();
    const fresh: Loan = { ref: created.loanRef, state: "sent", amountMinor: money.owedMinor, approvedMinor: null, fundings: [], url: created.url, createdAt: at, expiresAt: created.expiresAt, history: [{ state: "sent", at }], nudgedAt: null };
    await writeLoan(p.id, fresh);
    await logActivity({ organizationId: p.organizationId, actorId: null, kind: TRAIL_KINDS.PAY, summary: `${p.client?.name ?? "The client"} opened monthly payments (Wisetack) on "${p.title}" — ${usd(money.owedMinor)}`, proposalId: p.id, clientId: p.clientId });
    return { ok: true, url: created.url };
  } catch {
    return { ok: false, status: 502, error: "Wisetack didn't answer — try again in a minute." };
  }
}

/** Back from Wisetack: read the loan once so the page shows where it stands (the webhook may still be on its way). */
export async function syncLoanForPublicId(publicId: string): Promise<void> {
  const provider = getProvider();
  if (!provider) return;
  const row = await db.proposal.findUnique({ where: { publicId }, select: { id: true } });
  const loan = row ? await readLoan(row.id) : null;
  if (!row || !loan) return;
  const snapshot = await provider.loan(loan.ref).catch(() => null);
  if (snapshot) await applyLoanSnapshot(row.id, snapshot);
}

/** Wisetack's word on a loan — a webhook, a read on the way back, or the reconcile: the new state written, the office
 *  told, each new payout recorded as a payment once. JobFlex's admin switch is not asked: an open loan always lands. */
export async function applyLoanSnapshot(proposalId: string, snapshot: LoanSnapshot): Promise<Loan | null> {
  const before = await readLoan(proposalId);
  if (!before) return null;
  const after = nextLoanState(before, snapshot, new Date().toISOString());
  if (JSON.stringify(after) === JSON.stringify(before)) return after;
  await writeLoan(proposalId, after);
  const effects = loanSideEffects(before, after);
  if (!effects.length) return after;
  const p = await db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, organizationId: true, title: true, clientId: true, client: { select: { name: true } } } });
  if (!p) return after;
  const who = p.client?.name ?? "The client";
  const cover = usd(coverMinor(after));
  const href = `/dashboard/proposals/${p.id}`;
  for (const fx of effects) {
    if (fx.kind === "paid" || fx.kind === "paid_part") {
      // The payment's own notice (lib/payments/settle → notifyPaymentReceived) tells the office.
      for (const f of fx.fundings) await settleFunding(p.organizationId, p.id, after.ref, f, p.clientId);
      continue;
    }
    const line =
      fx.kind === "approved"
        ? `${who} was approved for ${cover} through Wisetack on "${p.title}" — the loan terms are next.`
        : fx.kind === "accepted"
          ? `${who} accepted a ${cover} Wisetack loan on "${p.title}". Wisetack pays you when they confirm the job is done.`
          : fx.kind === "declined"
            ? `${who} wasn't approved by Wisetack on "${p.title}" — the other ways to pay stay open.`
            : `${who}'s Wisetack approval on "${p.title}" expired.`;
    await notifyFinancing(p.organizationId, line, { kind: "FINANCING_LOAN", href, proposalId: p.id, clientId: p.clientId });
  }
  return after;
}

/** One Wisetack payout → one Payment (provider WISETACK, method financing, no JobFlex fee). No stages named: settle
 *  pays what is open in order — all of it when the payout is what is owed, else stage by stage, splitting the stage
 *  it only partly pays, so what is left owed is exactly the rest. */
async function settleFunding(orgId: string, proposalId: string, ref: string, f: Funding, clientId: string | null): Promise<void> {
  const money = await proposalMoney(orgId, proposalId);
  if (!money) return;
  await settleInstallmentPayment({
    provider: "WISETACK",
    externalId: `${ref}:${f.id}`,
    externalPaymentId: null,
    organizationId: orgId,
    proposalId,
    installmentIds: [],
    amountMinor: f.amountMinor,
    feeMinor: 0,
    feeBilling: "in_payment",
    currency: money.proposal.currency,
    livemode: true,
    method: "financing",
    scheduleVersion: null,
    clientId,
    paidAt: new Date(f.at || Date.now()),
    note: "Paid through Wisetack financing (Wisetack keeps its merchant fee)",
  });
}

/** A payout on a loan the proposal no longer tracks (the client applied again, or two tabs raced): real money, so it
 *  lands — once per funding (Payment provider + externalId) — and the office is told; the current loan is untouched. */
async function settleStaleFundings(proposalId: string, ref: string, fundings: Funding[]): Promise<void> {
  const p = await db.proposal.findUnique({ where: { id: proposalId }, select: { organizationId: true, title: true, clientId: true } });
  if (!p) return;
  for (const f of fundings) {
    const seen = await db.payment.findFirst({ where: { provider: "WISETACK", externalId: `${ref}:${f.id}` }, select: { id: true } });
    if (seen) continue;
    await settleFunding(p.organizationId, proposalId, ref, f, p.clientId);
    await notifyFinancing(p.organizationId, `Wisetack paid you ${usd(f.amountMinor)} on an earlier financing application for "${p.title}" — check the proposal's payments.`, { kind: "FINANCING_LOAN", href: `/dashboard/proposals/${proposalId}`, proposalId, clientId: p.clientId });
  }
}

/** Someone pre-qualified through a contractor's general link → that contractor's lead. */
async function prequalLead(orgId: string, person: { name: string; phone: string | null; email: string | null }, amountMinor: number): Promise<void> {
  const line = `${person.name} is pre-approved for ${usd(amountMinor)} through Wisetack — they checked their rate from your link.`;
  const lead = await db.lead.create({
    data: { organizationId: orgId, name: person.name, phone: person.phone, email: person.email, description: line, source: "wisetack", status: "NEW" },
    select: { id: true },
  });
  await notifyFinancing(orgId, `New lead: ${line}`, { kind: "FINANCING_LEAD", href: `/dashboard/leads/${lead.id}` });
}

/** One verified Wisetack event (the webhook route runs each inside the dedupe envelope). */
export async function applyEvent(ev: ProviderEvent): Promise<void> {
  if (ev.kind === "merchant") {
    const orgId = await orgIdForMerchantRef(ev.merchantRef);
    if (orgId) await applyMerchantSnapshot(orgId, ev.snapshot);
    return;
  }
  if (ev.kind === "loan") {
    const proposalId = await proposalForLoanRef(ev.loanRef);
    if (!proposalId) return;
    const what = loanEventFor(await readLoan(proposalId), ev.loanRef, ev.snapshot);
    if (what === "apply") await applyLoanSnapshot(proposalId, ev.snapshot);
    else if (what === "stale_settle") await settleStaleFundings(proposalId, ev.loanRef, ev.snapshot.fundings);
    return;
  }
  const orgId = await orgIdForMerchantRef(ev.merchantRef);
  if (orgId) await prequalLead(orgId, ev.person, ev.amountMinor);
}

/** The job is done (the crew's Complete, or the office marking it): a client with an accepted loan is asked to confirm. */
export async function askClientDone(orgId: string, proposalId: string): Promise<void> {
  const provider = getProvider();
  const loan = await readLoan(proposalId);
  if (!provider || !loan || loan.state !== "accepted") return;
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId: orgId }, select: { title: true, clientId: true, client: { select: { name: true } } } });
  if (!p) return;
  const answer = await provider.askDone(loan.ref).catch(() => "unsupported" as const);
  const href = `/dashboard/proposals/${proposalId}`;
  if (answer === "asked") {
    const at = new Date().toISOString();
    const fresh = (await readLoan(proposalId)) ?? loan;
    if (fresh.state === "accepted") await writeLoan(proposalId, { ...fresh, state: "done_asked", history: [...fresh.history, { state: "done_asked", at }] });
    await notifyFinancing(orgId, `Asked ${p.client?.name ?? "the client"} to confirm with Wisetack that "${p.title}" is done — your payout follows.`, { kind: "FINANCING_LOAN", href, proposalId, clientId: p.clientId });
  } else {
    await notifyFinancing(orgId, `"${p.title}" is done — mark it complete in Wisetack so Wisetack pays you.`, { kind: "FINANCING_LOAN", href, proposalId, clientId: p.clientId });
  }
}

const FINAL = new Set(["paid", "declined", "expired", "canceled", "refunded"]);
const MERCHANT_OPEN = new Set(["started", "review", "needs_info"]);
const RECHECK_MS = 30 * 60 * 1000;

/** The 30-minute payments reconcile: applications in review, open loans, and the office's two reminders. */
export async function reconcileFinancing(now: Date): Promise<{ merchants: number; loans: number; nudges: number }> {
  const provider = getProvider();
  const tally = { merchants: 0, loans: 0, nudges: 0 };
  if (!provider) return tally;
  for (const { orgId, rec } of await listOrgFinancing()) {
    if (!rec.merchantRef || !MERCHANT_OPEN.has(rec.state)) continue;
    if (rec.checkedAt && now.getTime() - Date.parse(rec.checkedAt) < RECHECK_MS) continue;
    const snap = await provider.merchant(rec.merchantRef).catch(() => null);
    if (snap) {
      await applyMerchantSnapshot(orgId, snap);
      tally.merchants += 1;
    }
  }
  for (const { proposalId, loan } of await listLoans()) {
    if (FINAL.has(loan.state)) continue;
    const snap = await provider.loan(loan.ref).catch(() => null);
    const after = snap ? await applyLoanSnapshot(proposalId, snap) : loan;
    if (snap) tally.loans += 1;
    if (!after) continue;
    const due = reminderDue(after, now);
    if (!due) continue;
    const p = await db.proposal.findUnique({ where: { id: proposalId }, select: { organizationId: true, title: true, clientId: true, client: { select: { name: true } } } });
    if (!p) continue;
    const who = p.client?.name ?? "The client";
    const line =
      due === "accept_nudge"
        ? `${who} was approved through Wisetack on "${p.title}" but hasn't accepted the loan yet — a quick call or Remind helps.`
        : `${who}'s Wisetack approval on "${p.title}" ends ${after.expiresAt ? new Date(after.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "soon"} — finish the job and have them confirm before then.`;
    await writeLoan(proposalId, { ...after, nudgedAt: now.toISOString() });
    await notifyFinancing(p.organizationId, line, { kind: "FINANCING_LOAN", href: `/dashboard/proposals/${proposalId}`, proposalId, clientId: p.clientId });
    tally.nudges += 1;
  }
  return tally;
}

/** The proposals list (desk + phone): each row's financing line and Send button. Empty when Wisetack is not connected. */
export async function rowsFinancing(orgId: string, rows: { id: string; status: string; owed: number; canBill: boolean }[]): Promise<Map<string, { line: string | null; canSend: boolean }>> {
  const out = new Map<string, { line: string | null; canSend: boolean }>();
  if (!getProvider() || !rows.length) return out;
  const ids = rows.map((r) => r.id);
  const [view, loans, offers, ended] = await Promise.all([orgFinancingView(orgId), readLoans(ids), readOffers(ids), planEnded(orgId)]);
  for (const r of rows) {
    const owedMinor = Math.round(r.owed * 100);
    const offer = offerFor({ letIn: view.letIn, org: view.rec, proposalOn: offers.get(r.id) ?? null, owedMinor, status: r.status, planEnded: ended });
    const fin = rowFinancing({ offered: offer.offered, loan: loans.get(r.id) ?? null, canBill: r.canBill, status: r.status, hasPrequal: !!view.rec.prequalUrl, money: usd });
    if (fin) out.set(r.id, fin);
  }
  return out;
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The office sends the client the proposal opened at Pay over time — by text when the client has a phone and the
 *  company texts its clients, else by email. The loan itself is made when the client presses the button. */
export async function sendFinancingLinkFor(orgId: string, proposalId: string, via: "text" | "email" | "auto", actorId: string): Promise<{ ok: true; via: "text" | "email" } | { ok: false; error: string }> {
  const money = await proposalMoney(orgId, proposalId);
  if (!money) return { ok: false, error: "That proposal wasn't found." };
  const p = money.proposal;
  const [view, proposalOn, ended] = await Promise.all([orgFinancingView(orgId), readOffer(proposalId), planEnded(orgId)]);
  const offer = offerFor({ letIn: view.letIn, org: view.rec, proposalOn, owedMinor: money.owedMinor, status: p.status, planEnded: ended });
  if (!getProvider() || !offer.offered) return { ok: false, error: NOT_AVAILABLE };
  if (!linkLands(p.status, !!view.rec.prequalUrl)) return { ok: false, error: "Send the proposal first — the financing link opens it." };
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, smsClientsOn: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true } });
  if (!org) return { ok: false, error: NOT_AVAILABLE };
  const link = `${await appBaseUrl()}/portal/q/${encodeURIComponent(p.publicId)}#pay-over-time`;
  const phone = org.smsClientsOn ? toE164(p.client?.phone ?? null) : null;
  const email = p.client?.email?.trim() || null;
  let how: "text" | "email" = via === "auto" ? (phone ? "text" : "email") : via;
  if (how === "text") {
    if (!phone) return { ok: false, error: org.smsClientsOn ? "This client has no mobile number on file." : "Texts to clients are off in Settings." };
    const r = await sendText({ organizationId: orgId, to: phone, body: brand(org.name, `you can pay for "${clip(p.title, 50)}" over time with monthly payments through Wisetack. Check your rate (it won't affect your credit score): ${link} Reply STOP to opt out.`), kind: "client-financing" });
    const went = r.ok && r.status !== "SKIPPED";
    if (!went && !(via === "auto" && email)) return { ok: false, error: "The text didn't go — try email." };
    if (!went) how = "email";
  }
  if (how === "email") {
    if (!email) return { ok: false, error: "This client has no email on file." };
    const first = (p.client?.name ?? "").trim().split(/\s+/)[0];
    const html = `<p>${first ? `Hi ${escHtml(first)},` : "Hello,"}</p><p>You can pay for <b>${escHtml(p.title)}</b> over time with monthly payments through Wisetack. Checking your rate won't affect your credit score.</p><p><a href="${escHtml(link)}">Check your rate</a></p><p style="font-size:12px;color:#777">${escHtml(FIN.disclosure)}</p><p>${escHtml(org.name ?? "")}</p>`;
    await sendOrgEmail(org, { to: email, subject: `Monthly payments for ${p.title}`, html });
  }
  await logActivity({ organizationId: orgId, actorId, kind: TRAIL_KINDS.PAY, summary: `Sent ${p.client?.name ?? "the client"} the financing link for "${p.title}" by ${how}`, proposalId, clientId: p.clientId });
  return { ok: true, via: how };
}
