import { LeadStatus } from "@/lib/prismaEnums";

// Sales reps may only act on leads inside their visibility slice: assigned to
// them, claimed by them, or still NEW in the shared pool. Managers see it all.
export function salesCanTouchLead(
  lead: { assignedToId: string | null; claimedById: string | null; status: string },
  userId: string,
): boolean {
  return (
    lead.assignedToId === userId || lead.claimedById === userId || lead.status === LeadStatus.NEW
  );
}
