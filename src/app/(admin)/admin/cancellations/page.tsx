// Admin · Cancellations (owner, 2026-10-20; the question tree 2026-11-09) —
// every cancellation booked from the Subscription page, newest first, with
// the owner's answers (lib/cancelTree; rows from before 2026-11-09 carry the
// old reasons only — lib/cancelFeedback), and a platform admin's cancels.
// On top, the last 30 days by answer. Read-only.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getPlanNamesBySlug } from "@/lib/planCatalogServer";
import { planDisplayName } from "@/lib/planCatalog";
import { ADMIN_REASON, parseReasons } from "@/lib/cancelFeedback";
import { CANCEL_TOOLS, OTHER_REASONS, answersLines, answersSummary, parseCancelAnswers, toolsNamed, type CancelPath } from "@/lib/cancelTree";
import { AdminCancellationsContent, type CancellationDTO, type CancelDigest } from "@/components/v3/admin-cancellations/cancellations-content";
import { readCameBack } from "@/lib/cameBackRead";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Cancellations",
  description: "Why companies cancelled their plan.",
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** The start of the last 30 days. */
const since30 = () => new Date(Date.now() - 30 * DAY_MS);

/** The last 30 days by answer: each branch, the A2 tools and A3 reasons named
 *  most, the trial-day asks sent from the questions instead of a cancel, and
 *  the owners who said they would come back. */
function digest(rows: CancellationDTO[], extensions: number): CancelDigest {
  const since = since30().getTime();
  const recent = rows.filter((r) => Date.parse(r.createdAt) >= since);
  const byPath = { A1: 0, A2: 0, A3: 0, older: 0, admin: 0 };
  const tools = new Map<string, number>();
  const reasons = new Map<string, number>();
  let comeBack = 0;
  for (const r of recent) {
    if (r.byAdmin) byPath.admin += 1;
    else if (r.path) byPath[r.path] += 1;
    else byPath.older += 1;
    if (r.path === "A2") for (const t of r.tools) tools.set(t, (tools.get(t) ?? 0) + 1);
    if (r.path === "A3") for (const k of r.reasons) reasons.set(k, (reasons.get(k) ?? 0) + 1);
    if (r.again === "yes") comeBack += 1;
  }
  const top = (m: Map<string, number>, label: (k: string) => string, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ key: k, label: label(k), n: c }));
  return {
    total: recent.length,
    byPath,
    topTools: top(tools, (k) => CANCEL_TOOLS.find((t) => t.key === k)?.long ?? k, 5),
    topReasons: top(reasons, (k) => OTHER_REASONS.find((x) => x.key === k)?.label ?? k, 6),
    extensions,
    comeBack,
  };
}

export default async function AdminCancellationsPage() {
  await requirePlatformAdmin();
  // Who came back (2026-10-28): card-less trials that ran out and later paid, cancellations whose company pays
  // again — read beside the rows; a failed read leaves the card out, never the table.
  const cameBackP = readCameBack().catch(() => null);
  const [rows, names, extensions] = await Promise.all([
    db.cancellationFeedback
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { organization: { select: { name: true } }, user: { select: { email: true } } },
      })
      // The table (or the 2026-11-09 columns) is not in this database yet (prisma/sql/prod-2026-11-09-cancel-tree.sql).
      .catch(() => null),
    getPlanNamesBySlug().catch(() => ({})),
    // Asked for more trial days from the questions (screen C1) instead of cancelling.
    db.trialExtensionRequest.count({ where: { createdAt: { gte: since30() }, answersJson: { not: null } } }).catch(() => 0),
  ]);
  const dto: CancellationDTO[] | null = rows
    ? rows.map((r) => {
        const reasons = parseReasons(r.reasons);
        const answers = parseCancelAnswers(r.answersJson);
        const path = (answers?.path ?? null) as CancelPath | null;
        return {
          id: r.id,
          orgName: r.organization.name,
          email: r.user?.email ?? "—",
          planName: planDisplayName(r.plan, names),
          reasons,
          otherText: r.otherText,
          byAdmin: reasons.includes(ADMIN_REASON),
          path,
          summary: answers ? answersSummary(answers) : null,
          lines: answers ? answersLines(answers) : null,
          tools: answers?.path === "A2" ? answers.a2.tools : [],
          toolsNamed: toolsNamed(answers),
          again: answers?.path === "A2" ? (answers.a2.again ?? null) : null,
          followUpEmail: r.wantsFollowUp ? r.followUpEmail : null,
          periodEnd: r.periodEnd?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        };
      })
    : null;
  const cameBack = await cameBackP;
  return <AdminCancellationsContent rows={dto} digest={dto ? digest(dto, extensions) : null} cameBack={cameBack} />;
}
