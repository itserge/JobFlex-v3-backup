// THE FINISH LINE — the rules (the timeline build, 2026-11-06). Pure. One flow, no loose ends, in this order:
//
//   1. Punch list      — the small things left, each ticked with an "after" photo (the crew from the job's board,
//                        or the office).
//   2. Final inspection — the inspection marked final, passed.
//   3. Client sign-off  — who signed off and when (the office records it; the client's own page is part 5).
//   4. Final payment    — nothing owed on the project's sold proposals.
//   5. Review           — the review request went to the client (JobFlex's own review page).
//   6. Warranty         — the warranty's last day, set (12 months is the usual).
//   7. Finished         — the project is COMPLETED, then archived off the list.
//
// finishSteps reads the state the server collected (FinishRead) into the seven steps, each done, next or still
// to do, with the words the card and the Operator show. The list's flags: punchFlags, finishFlags.

export type FinishStepKey = "punch" | "inspection" | "signoff" | "payment" | "review" | "warranty" | "finish";

export type FinishRead = {
  status: string;
  stageCount: number;
  /** Every stage DONE (true with no stages, too — the jobs then say when the work is over). */
  stagesDone: boolean;
  /** Jobs still open on the project (not completed, not canceled). */
  jobsOpen: number;
  punch: { open: number; total: number; withPhoto: number };
  finalInspection: { id: string; name: string; date: string | null; result: string; resultAt: string | null; readyNote: string | null } | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
  payment: { proposals: number; billed: number; paid: number; owed: number };
  review: { askedAt: string | null; rating: number | null; completedAt: string | null; publicToken: string | null } | null;
  clientEmail: string | null;
  warrantyUntil: string | null;
  finishedAt: string | null;
};

export type FinishStep = { key: FinishStepKey; label: string; state: "done" | "next" | "todo"; detail: string };

const dayLabel = (iso: string | null | undefined, year = false) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : "");
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function finishSteps(r: FinishRead): FinishStep[] {
  const steps: Array<Omit<FinishStep, "state"> & { done: boolean }> = [];

  steps.push({
    key: "punch",
    label: "Punch list",
    done: r.punch.open === 0,
    detail: r.punch.total === 0 ? "Nothing on the list" : r.punch.open === 0 ? `${r.punch.total} done${r.punch.withPhoto ? `, ${r.punch.withPhoto} with a photo` : ""}` : `${r.punch.open} of ${r.punch.total} still open`,
  });

  const fi = r.finalInspection;
  steps.push({
    key: "inspection",
    label: "Final inspection",
    done: fi?.result === "PASSED",
    detail: !fi ? "Schedule it" : fi.result === "PASSED" ? `Passed ${dayLabel(fi.resultAt ?? fi.date)}` : fi.result === "FAILED" ? `Failed ${dayLabel(fi.resultAt ?? fi.date)} — schedule the re-inspection` : fi.date ? `${dayLabel(fi.date)}${fi.readyNote ? ` · have ready: ${fi.readyNote}` : ""}` : "No day set yet",
  });

  steps.push({
    key: "signoff",
    label: "Client sign-off",
    done: Boolean(r.signedOffAt),
    detail: r.signedOffAt ? `${r.signedOffBy ? `${r.signedOffBy}, ` : ""}${dayLabel(r.signedOffAt)}` : "Walk through with the client and record it",
  });

  const p = r.payment;
  steps.push({
    key: "payment",
    label: "Final payment",
    done: p.proposals > 0 && p.owed <= 0.5,
    detail: p.proposals === 0 ? "No sold proposal on the project" : p.owed <= 0.5 ? `Paid in full — ${money(p.paid)}` : `${money(p.owed)} still owed`,
  });

  steps.push({
    key: "review",
    label: "Review",
    done: Boolean(r.review?.askedAt),
    detail: r.review?.completedAt ? `${r.review.rating ? `${r.review.rating} star${r.review.rating === 1 ? "" : "s"}, ` : ""}left ${dayLabel(r.review.completedAt)}` : r.review?.askedAt ? `Asked ${dayLabel(r.review.askedAt)}` : r.clientEmail ? "Ask the client" : "No client email on file — the ask makes a link to send by hand",
  });

  steps.push({
    key: "warranty",
    label: "Warranty",
    done: Boolean(r.warrantyUntil),
    detail: r.warrantyUntil ? `Until ${dayLabel(r.warrantyUntil, true)}` : "Set the last day (12 months is usual)",
  });

  steps.push({
    key: "finish",
    label: r.status === "ARCHIVED" ? "Archived" : "Finished",
    done: r.status === "COMPLETED" || r.status === "ARCHIVED",
    detail: r.status === "ARCHIVED" ? `Finished ${dayLabel(r.finishedAt)} and archived` : r.status === "COMPLETED" ? `Finished ${dayLabel(r.finishedAt)} — archive it when you are done with it` : r.jobsOpen ? `${r.jobsOpen} job${r.jobsOpen === 1 ? "" : "s"} still open` : "Mark the project finished",
  });

  let nextSeen = false;
  return steps.map(({ done, ...s }) => {
    const state: FinishStep["state"] = done ? "done" : nextSeen ? "todo" : "next";
    if (!done) nextSeen = true;
    return { ...s, state };
  });
}

/** The warranty's usual last day: twelve months from the day given. */
export function warrantyDefault(fromIso: string): string {
  const d = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** True once the work itself is over and the finish line is what is left: every stage done (or no stages and no
 *  job open), the project not finished yet. */
export function atFinishLine(r: Pick<FinishRead, "status" | "stageCount" | "stagesDone" | "jobsOpen">): boolean {
  if (r.status === "COMPLETED" || r.status === "ARCHIVED") return false;
  return r.stageCount ? r.stagesDone : r.jobsOpen === 0;
}

export type FinishFlag = { kind: "punch" | "finish"; text: string };

/** The list's lines: punch items open, and the finish line's steps left once the work is over. */
export function finishFlags(r: FinishRead): FinishFlag[] {
  const out: FinishFlag[] = [];
  if (r.punch.open) out.push({ kind: "punch", text: `${r.punch.open} punch item${r.punch.open === 1 ? "" : "s"} open` });
  if (atFinishLine(r)) {
    const left = finishSteps(r).filter((s) => s.state !== "done");
    if (left.length) out.push({ kind: "finish", text: `Finish line: ${left[0].label.toLowerCase()} next${left.length > 1 ? `, ${left.length - 1} more` : ""}` });
  }
  return out;
}
