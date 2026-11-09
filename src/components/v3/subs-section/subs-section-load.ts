import "server-only";
// THE SUBCONTRACTORS SECTION — the server read (2026-11-08, the subcontractors plan, part 1). One load for the desk
// page (/dashboard/projects/[id]/subs) and its handheld twin (/mobile-project-subs-v1/[id]): the project, its stages
// (the request sheet prefills from them), the subs read the card uses (directory, requests, quotes with their
// versions and documents, the project's Files), the section's figures and the project's subcontractor history.

import { db } from "@/lib/db";
import { stagesOf } from "@/lib/projectStages/server";
import { sectionMetrics, subsHistory, subsOf, type HistoryRow, type SubsRead } from "@/lib/projectSubs/server";
import { projectSiteAddress } from "@/lib/subFinder/server";
import { contractsOf, type ContractRow } from "@/lib/subContracts/server";
import { invoicesOf, type InvoicesRead } from "@/lib/subInvoices/server";
import { readRampConnection } from "@/lib/ramp/connection";
import type { PdStage } from "@/components/v3/project-detail-blueprint/project-detail-data";

export type SubsSectionRead = {
  project: { id: string; name: string; number: number | null; kind: string; status: string };
  stages: PdStage[];
  subs: SubsRead;
  metrics: ReturnType<typeof sectionMetrics>;
  history: HistoryRow[];
  /** Part 3: the site address Find starts from — the Lot card's parcel, else the client's, else the company's. */
  siteAddress: string | null;
  /** Part 4: the project's subcontracts, the live ones first. */
  contracts: ContractRow[];
  /** Part 5a: the project's sub invoices, payments and each signed contract's money; whether Ramp's Bill Pay is there. */
  invoices: InvoicesRead;
  ramp: boolean;
};

export async function loadSubsSection(projectId: string, organizationId: string): Promise<SubsSectionRead | null> {
  const project = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, number: true, kind: true, status: true } });
  if (!project) return null;
  const [stageRead, subs, history, siteAddress, contracts, invoices, ramp] = await Promise.all([stagesOf(project.id), subsOf(organizationId, project.id), subsHistory(organizationId, project.id), projectSiteAddress(organizationId, project.id), contractsOf(organizationId, project.id), invoicesOf(organizationId, project.id), readRampConnection(organizationId).then((c) => c !== null).catch(() => false)]);
  return { project, stages: stageRead.stages, subs, metrics: sectionMetrics(subs), history, siteAddress, contracts, invoices, ramp };
}
