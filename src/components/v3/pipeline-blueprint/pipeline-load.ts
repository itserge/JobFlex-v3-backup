// THE PIPELINE — THE SERVER READ (Smart CRM part 3, 2026-11-08). The board's cards and the header's figures, or
// the source report, with every date formatted here once (dates travel as strings — the client-detail rule).

import { db } from "@/lib/db";
import { readPipeline, readSourceReport, type SourceRow } from "@/lib/pipeline/server";
import { STAGES, type Stage } from "@/lib/pipeline/shared";
import { ownProposalsOnly } from "@/lib/assistant/roles";
import { isLimitedRole } from "@/lib/orgContext";

export type CardView = {
  key: string;
  kind: "lead" | "proposal";
  name: string;
  title: string;
  value: number | null;
  stage: Stage;
  byHand: boolean;
  source: { label: string; short: string; tone: string };
  owner: string | null;
  mine: boolean;
  href: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  next: string | null;
  close: string | null;
  closeIso: string | null;
  lostReason: string | null;
  build: string | null;
  paid: string | null;
  touched: string | null;
};

export type PipelineView = {
  view: "board" | "sources";
  /** The source report is the office's (company money by source); a limited role sees only the board. */
  canSources: boolean;
  mineOnly: boolean;
  columns: Array<{ key: Stage; label: string; short: string; count: number; value: number; cards: CardView[] }>;
  figures: { openValue: number; wonMonth: number; atRisk: number; cycleDays: number | null };
  sources: SourceRow[];
  days: number;
};

export async function loadPipeline(organizationId: string, userId: string, role: string, q: { view?: string; mine?: string; days?: string }): Promise<PipelineView> {
  const canSources = !isLimitedRole(role);
  const view = q.view === "sources" && canSources ? "sources" : "board";
  const mineOnly = q.mine === "1";
  const days = [30, 90, 365].includes(Number(q.days)) ? Number(q.days) : 90;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = org?.timezone || "America/New_York";
  const now = new Date();
  const fmt = (d: Date | null, withTime = false) => {
    if (!d) return null;
    try {
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: tz }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };

  const [cards, sources] = await Promise.all([readPipeline(organizationId, { now, tz, onlyProposalsOf: ownProposalsOnly(role) ? userId : null }), view === "sources" ? readSourceReport(organizationId, days, now) : Promise.resolve([])]);
  const shown = mineOnly ? cards.filter((c) => c.ownerId === userId) : cards;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const won = cards.filter((c) => c.stage === "WON");
  const cycles = won.filter((c) => c.closedAt).map((c) => (c.closedAt!.getTime() - c.createdAt.getTime()) / 86_400_000);
  const open = cards.filter((c) => c.stage !== "WON" && c.stage !== "LOST");

  const columns = STAGES.map((s) => {
    const inCol = shown.filter((c) => c.stage === s.key);
    return {
      key: s.key,
      label: s.label,
      short: s.short,
      count: inCol.length,
      value: inCol.reduce((a, c) => a + (c.value ?? 0), 0),
      cards: inCol.map((c) => ({
        key: c.key,
        kind: c.kind,
        name: c.name,
        title: c.title,
        value: c.value,
        stage: c.stage,
        byHand: c.byHand,
        source: { label: c.source.label, short: c.source.short, tone: c.source.tone },
        owner: c.ownerName,
        mine: c.ownerId === userId,
        href: c.href,
        risk: c.risk.level,
        reasons: c.risk.reasons,
        next: c.next,
        close: fmt(c.expectedClose),
        closeIso: c.expectedClose ? c.expectedClose.toISOString().slice(0, 10) : null,
        lostReason: c.lostReason,
        build: c.build,
        paid: c.paid,
        touched: fmt(c.lastTouch),
      })),
    };
  });

  return {
    view,
    canSources,
    mineOnly,
    columns,
    figures: {
      openValue: open.reduce((a, c) => a + (c.value ?? 0), 0),
      wonMonth: won.filter((c) => c.closedAt && c.closedAt >= monthStart).reduce((a, c) => a + (c.value ?? 0), 0),
      atRisk: open.filter((c) => c.risk.level === "HIGH").reduce((a, c) => a + (c.value ?? 0), 0),
      cycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    },
    sources,
    days,
  };
}
