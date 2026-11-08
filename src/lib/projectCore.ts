import "server-only";
// MAKING A PROJECT, session-free (2026-11-07): the New project dialogs (actions/projects) and the AI Operator's
// start_project (lib/assistant/projects) make one the same way — numbered per company, its kind and the question
// asked at the start kept, the trail written. The caller has checked the role and the plan limit.
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { numbered } from "@/lib/projectStages/server";
import { serializeAnswers, type ProjectKind } from "@/lib/projectKind";
import type { BuildAnswers } from "@/lib/projectPhases/shared";
import { parseMoneySettings, type ForWhom, type MoneyMode } from "@/lib/projectMoneyPlan/shared";

/** The money settings a new project is made with: as said, else a client build with no mode. */
function moneyFields(data: Pick<NewProject, "forWhom" | "moneyMode" | "marginPct" | "feeAmount" | "salePrice">) {
  const s = parseMoneySettings({ forWhom: data.forWhom, moneyMode: data.moneyMode, marginPct: data.marginPct, feeAmount: data.feeAmount, salePrice: data.salePrice });
  return { forWhom: s.forWhom, moneyMode: s.moneyMode, marginPct: s.marginPct, feeAmount: s.feeAmount, salePrice: s.salePrice };
}

export type NewProject = {
  name: string;
  description?: string | null;
  /** ACTIVE | ON_HOLD | COMPLETED | ARCHIVED; active unless said. */
  status?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  /** The cost budget, one figure (split into kinds later). */
  budget?: number;
  /** Checked to be the company's by the caller. */
  clientId: string | null;
  kind: ProjectKind;
  /** A remodel's client lives there during the work. */
  occupied?: boolean;
  /** A new build's start questions (lib/projectPhases); the phases are shaped from them. */
  build?: BuildAnswers;
  /** Who it is for and how the money is made (part 5, lib/projectMoneyPlan); a client build with no mode unless said. */
  forWhom?: ForWhom;
  moneyMode?: MoneyMode;
  marginPct?: number | null;
  feeAmount?: number | null;
  salePrice?: number | null;
};

export async function createProjectAs(who: { organizationId: string; actorId: string | null }, data: NewProject): Promise<{ id: string; number: number | null; name: string }> {
  const { organizationId } = who;
  const answersJson = serializeAnswers(data.kind === "REMODEL" ? (data.occupied ? { occupied: true } : {}) : data.build && Object.keys(data.build).length ? { build: data.build } : {});
  // Numbered per company from 1001 (2026-11-05).
  const p = await numbered(organizationId, (number) =>
    db.project.create({
      data: {
        organizationId,
        clientId: data.clientId,
        number,
        name: data.name.trim().slice(0, 200),
        description: data.description ?? null,
        status: data.status ?? "ACTIVE",
        startsAt: data.startsAt ?? null,
        endsAt: data.endsAt ?? null,
        budget: data.budget ?? 0,
        kind: data.kind,
        answersJson,
        ...moneyFields(data),
      },
      select: { id: true, number: true, name: true },
    }),
  );
  await logActivity({
    organizationId,
    actorId: who.actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Created project ${p.name}`,
    clientId: data.clientId,
    meta: { projectId: p.id, budget: data.budget ?? 0, kind: data.kind },
  });
  return p;
}
