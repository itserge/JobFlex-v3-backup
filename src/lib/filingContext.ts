// FILING CONTEXT — where the next estimate's proposal is filed (2026-09-18).
//
// "New proposal" on a project (or on a client's page) opens the estimator
// picker, and the contractor may pick ANY engine — Smart Proposal, roof, fence,
// HVAC, video. None of those engines read a client or a project from the URL,
// several are mounted with no props at all on a phone, and one is a DOM
// behaviour script; threading two ids through each of them would be five
// separate plumbing jobs that drift. So the picker records the choice in one
// short-lived cookie, a chip on the estimator page says so out loud (with an ×
// to drop it), and every convert-to-proposal action reads it here, on the
// server, when it creates the proposal — then clears it.
//
// The cookie carries ids and display names. Only the ids are trusted, and only
// after they are checked against the caller's organization: a client that is
// deleted or foreign, or a project that is archived or foreign, is ignored.
//
// A LEAD RIDES THE SAME COOKIE (owner, 2026-09-26). An estimate started from a
// lead's page (actions/leadEstimate) records the lead beside its client, for
// as long as the filing lives — the ten-minute hand-off seed is spent the
// moment the estimator opens, and a roof can take longer than that to measure.
// Every convert action then gives the proposal the lead's client (made from
// the lead now if none could be at hand-off) and keeps BOTH scopes: the one
// the estimator wrote stays the Scope of work, the lead's becomes the Overview
// (leadProposalText) — neither is ever written over the other.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { FILING_COOKIE } from "@/lib/filingCookie";
import { ensureClientForLead } from "@/lib/leadClient";
import { isEstimatorRole } from "@/lib/orgContext";

/** The lead a filing carries, as a proposal made from it needs it. */
export type FiledLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** The professional scope written for the lead (lib/leadScope), when it has one. */
  scope: string | null;
  /** The homeowner's own words. */
  description: string | null;
};

export type FilingContext = { clientId: string | null; projectId: string | null; lead: FiledLead | null };

/** The filing the picker recorded, checked against the organization; null when there is none. */
export async function readFilingContext(organizationId: string): Promise<FilingContext | null> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(FILING_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: { clientId?: unknown; projectId?: unknown; leadId?: unknown };
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  const clientId = typeof parsed.clientId === "string" && parsed.clientId ? parsed.clientId : null;
  const projectId = typeof parsed.projectId === "string" && parsed.projectId ? parsed.projectId : null;
  const leadId = typeof parsed.leadId === "string" && parsed.leadId ? parsed.leadId : null;
  return filingFromIds(organizationId, { clientId, projectId, leadId });
}

/** A filing from ids the caller found itself — the JobFlex Assistant's client or lead, looked up by name
 *  (lib/assistant/build) — checked against the organization the same way; null when none of them holds. */
export async function filingFromIds(organizationId: string, ids: { clientId?: string | null; projectId?: string | null; leadId?: string | null }): Promise<FilingContext | null> {
  const clientId = ids.clientId || null;
  const projectId = ids.projectId || null;
  const leadId = ids.leadId || null;
  if (!clientId && !projectId && !leadId) return null;

  const [client, project, lead] = await Promise.all([
    clientId
      ? db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
    projectId
      ? db.project.findFirst({ where: { id: projectId, organizationId, status: { not: "ARCHIVED" } }, select: { id: true, clientId: true } })
      : Promise.resolve(null),
    leadId
      ? db.lead.findFirst({
          where: { id: leadId, organizationId },
          select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true, scope: true, description: true },
        })
      : Promise.resolve(null),
  ]);
  // A project named without a client files under the project's own client.
  return { clientId: client?.id ?? project?.clientId ?? null, projectId: project?.id ?? null, lead: lead ?? null };
}

/**
 * The client a proposal files under when the filing names none of its own
 * but carries a lead: the record the lead already is (same email or phone),
 * or one made from the lead where this role may make clients and the plan has
 * room (lib/leadClient) — the same rule the lead page's hand-off applies.
 */
export async function filedClientId(organizationId: string, role: string, filing: FilingContext | null): Promise<string | null> {
  if (filing?.clientId) return filing.clientId;
  if (!filing?.lead) return null;
  const client = await ensureClientForLead(organizationId, filing.lead, { create: !isEstimatorRole(role) });
  return client?.id ?? null;
}

/**
 * The scope of work and the overview of a proposal made from a lead. The
 * estimator's own scope is the Scope of work; the lead's scope — else the
 * homeowner's words — is the Overview. An estimator that wrote no scope (or
 * wrote the lead's back verbatim) takes the lead's as its Scope of work and
 * leaves the Overview empty, so the same words never print twice. With no
 * lead, the estimator's scope stands alone, exactly as before.
 */
export function leadProposalText(lead: FiledLead | null, estimatorScope: string): { scopeOfWork: string; overview: string | null } {
  const own = estimatorScope.trim();
  const brief = (lead?.scope?.trim() || lead?.description?.trim() || "");
  if (!brief) return { scopeOfWork: estimatorScope, overview: null };
  if (!own || own === brief) return { scopeOfWork: brief, overview: null };
  return { scopeOfWork: estimatorScope, overview: brief };
}

/** Spent: the proposal it was for exists now. */
export async function clearFilingContext(): Promise<void> {
  try {
    (await cookies()).delete(FILING_COOKIE);
  } catch {
    /* outside a request that can write cookies — it expires on its own */
  }
}
