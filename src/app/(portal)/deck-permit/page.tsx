// THE PERMIT SET (Deck Studio M3, 2026-10-10; the 11 × 17 submittal set
// 2026-10-20) — two sheets for a deck, three with a roof: the site plan and
// the project's data (A1), the floor framing, section and lateral (S1), the
// roof (S2). See components/v3/deck-permit. Opened from the studio
// in a new tab with the design in the address (`?d=`), or from a saved draft
// (`?draft=`) or proposal (`?proposal=`). Behind the same gate as the studio.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { deckStudioAccess } from "@/lib/deck/access";
import { NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { normalizeDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { loadDeckDraft, loadDeckFromProposal } from "@/actions/deckEstimator";
import { DeckPermitSheet } from "@/components/v3/deck-permit/deck-permit";
import { readSitePlan } from "@/lib/deck/sitePlanStore";
import { BASE_SITE_PLAN } from "@/lib/deck/sitePlan";
import { readPlanEdits } from "@/lib/deck/planEditsStore";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Deck permit set", description: "The site plan, the framing and the details for the building office." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DeckPermitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let organizationId: string;
  let editable = false;
  const params = await searchParams;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    // The whole studio prints anything; its preview prints a deck already saved (a draft or a proposal — owner,
    // 2026-10-20: saved decks stay to look at and print), never a design carried in the address.
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    const saved = !one(params.d) && !!(one(params.draft) || one(params.proposal));
    if (level !== "full" && !(level === "preview" && saved)) redirect("/dashboard/deck-estimator");
    editable = level === "full";
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-estimator");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  let design: DeckDesign | null = null;
  let address: string | null = null;
  let title = "Deck";
  const packed = one(params.d);
  const draftId = one(params.draft);
  const proposalId = one(params.proposal);
  if (packed) {
    try {
      const raw = JSON.parse(decodeURIComponent(escape(Buffer.from(packed, "base64").toString("binary")))) as { design?: unknown; address?: unknown };
      design = normalizeDeckDesign(raw.design);
      address = typeof raw.address === "string" ? raw.address.slice(0, 300) : null;
    } catch {
      design = null;
    }
  } else if (draftId) {
    const res = await loadDeckDraft(draftId);
    if (res.ok) {
      design = res.draft.design;
      address = res.draft.address;
      title = res.draft.title;
    }
  } else if (proposalId) {
    const res = await loadDeckFromProposal(proposalId);
    if (res.ok) {
      design = res.design;
      address = res.address;
      title = res.title;
    }
  }
  // The contractor's edits to the sets (lib/deck/planEditsStore), kept by the property like the site plan; a deck
  // without an address keeps them by its draft or proposal.
  const editsRef = { address, draftId: packed ? null : draftId ?? null, proposalId: packed ? null : proposalId ?? null };
  const [org, sitePlan, edits] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, address: true, phone: true } }).catch(() => null),
    // The site plan is kept by the property (lib/deck/sitePlanStore): the draft, the proposal and an unsaved design at this address share it.
    readSitePlan(organizationId, address, BASE_SITE_PLAN),
    readPlanEdits(organizationId, editsRef),
  ]);
  return <DeckPermitSheet design={design} address={address} title={title} shop={{ name: org?.name ?? "", address: org?.address ?? null, phone: org?.phone ?? null, email: null }} initialPlan={sitePlan} editable={editable} initialEdits={edits} editsRef={editsRef} />;
}
