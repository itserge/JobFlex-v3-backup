import "server-only";
// THE SUBCONTRACTORS SECTION — the server read (2026-11-08, the subcontractors plan, part 1). One load for the desk
// page (/dashboard/projects/[id]/subs) and its handheld twin (/mobile-project-subs-v1/[id]): the project, its stages
// (the request sheet prefills from them), the subs read the card uses (directory, requests, quotes with their
// versions and documents, the project's Files), the section's figures and the project's subcontractor history.

import { db } from "@/lib/db";
import { stagesOf } from "@/lib/projectStages/server";
import { sectionMetrics, subsHistory, subsOf, type HistoryRow, type SubsRead } from "@/lib/projectSubs/server";
import type { PdStage } from "@/components/v3/project-detail-blueprint/project-detail-data";

export type SubsSectionRead = {
  project: { id: string; name: string; number: number | null; kind: string; status: string };
  stages: PdStage[];
  subs: SubsRead;
  metrics: ReturnType<typeof sectionMetrics>;
  history: HistoryRow[];
};

export async function loadSubsSection(projectId: string, organizationId: string): Promise<SubsSectionRead | null> {
  const project = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, number: true, kind: true, status: true } });
  if (!project) return null;
  const [stageRead, subs, history] = await Promise.all([stagesOf(project.id), subsOf(organizationId, project.id), subsHistory(organizationId, project.id)]);
  return { project, stages: stageRead.stages, subs, metrics: sectionMetrics(subs), history };
}
