// THE DECK ESTIMATOR (2026-10-04) — Blueprint edition. Owner: "draw the deck size,
// select what it is built with, it follows the code, it starts building in
// 3D, and it gives you the material package and the price."
//
// The engine is pure (src/lib/deck) and runs in the browser, so every change
// re-frames, re-counts and re-prices the deck at once; the server keeps only
// the shop's own deck prices and writes the proposal (actions/deckEstimator).
//
// Coming soon (owner, 2026-10-04): every account sees the sidebar row with its
// Coming soon mark and, here, a page that says what is coming; admins (the
// platform-admin flag, the admin console's sign-in, the owner's own account —
// lib/deck/access) get the working estimator to test.
//
// 2026-10-18: the owner chose Variant 1 of the Deck Lab ("One decision at a
// time", components/v3/deck-variant-1) and it is this page's studio now. The
// gates and the loaders below are unchanged; only the component was swapped.
// The old studio (deck-estimator-blueprint/deck-studio.tsx) is kept, unmounted.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readFilingContext } from "@/lib/filingContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { editionFacts } from "@/lib/editionAccess";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { hasEdition, type EditionLevel } from "@/lib/editions";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import type { AddonInterval } from "@/lib/deckAddon";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import { parseStateZip } from "@/lib/fence/market";
import { DeckV1Studio } from "@/components/v3/deck-variant-1/deck-v1-studio";
import { DeckComingSoon } from "@/components/v3/deck-estimator-blueprint/deck-coming-soon";
import { loadDeckDraft, loadDeckFromProposal, type ReturnedClientDesign } from "@/actions/deckEstimator";
import type { DeckDesign } from "@/lib/deck/design";
import type { LinkedDeckProposal } from "@/lib/deck/proposalEdit";

export const dynamic = "force-dynamic";
// The house read off a photo (actions readHousePhoto) asks a reasoning model and then looks again: as the other
// estimators' pages, five minutes rather than the platform's default for the calls made from here.
export const maxDuration = 300;
export const metadata: Metadata = {
  title: "JobFlex · Deck Studio",
  description: "Deck estimator — size the deck, frame it to the code tables, watch it build in 3D, and price the material package.",
};

export default async function DeckEstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // On the new plans Deck Studio is a tool: a shop without it sees the tool's card (lib/customPlan). A Classic shop is
  // never gated here — its preview / trial / add-on rules below are lib/editions'.
  const gate = await customPageGate("deck-estimator");
  if (gate) return gate;
  let organizationId: string;
  let level: EditionLevel = "none";
  let viaEdition = false;
  let trialEndsAt: string | null = null;
  let addonInterval: AddonInterval = "MONTH";
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    // Full, a preview (no trial, add-on, grant or admin: designs, saves nothing — owner-locked 2026-10-20), or closed.
    level = await deckStudioAccess(ctx.user, ctx.organizationId);
    const [facts, sub] = await Promise.all([editionFacts(ctx.organizationId, ctx.user.id).catch(() => null), readAccessSubscription(ctx.organizationId).catch(() => null)]);
    // Held by the account itself, not by an admin's own access: no admin notice.
    viaEdition = !!facts && hasEdition({ ...facts, fullAccess: false }, "deck");
    // Held by the free trial alone: the studio says, once, what the studio is after the trial.
    if (facts?.trialing && !hasEdition({ ...facts, trialing: false }, "deck")) trialEndsAt = sub?.trialEndsAt?.toISOString() ?? "";
    // The add-on follows the plan's term ($790 a year on a yearly plan — lib/deckAddon).
    if (sub?.stripePriceId) {
      const price = await db.planPrice.findUnique({ where: { stripePriceId: sub.stripePriceId }, select: { interval: true } }).catch(() => null);
      if (price?.interval === "YEAR") addonInterval = "YEAR";
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-estimator");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (level === "none") return <DeckComingSoon />;
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Opened from a client's record (`?client=`): the client's address is in the field. Read from this org only.
  let initialAddress: string | undefined;
  let clientId: string | undefined;
  let clientContact: { name: string; phone: string | null; email: string | null } | null = null;
  const asked = one(params.client);
  // The client the page is for: `?client=`, else the one a lead's hand-off filed (lib/filingContext) — Send to
  // client starts with their name, phone and email (owner, 2026-10-28).
  const filed = asked ? null : await readFilingContext(organizationId).catch(() => null);
  const wantId = asked ?? filed?.clientId ?? null;
  if (wantId) {
    const client = await db.client.findFirst({ where: { id: wantId, organizationId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true } });
    if (client) {
      clientId = client.id;
      clientContact = { name: client.name, phone: client.phone ?? null, email: client.email ?? null };
      if (asked && client.address) initialAddress = [client.address, client.city, [client.state, client.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    }
  }
  const [book, org] = await Promise.all([readDeckRateBook(organizationId), db.organization.findUnique({ where: { id: organizationId }, select: { address: true } })]);
  // The shop's own state picks the lumber a new deck starts with, until a job address says otherwise.
  const homeState = parseStateZip(org?.address).state;
  // Opened again (M3): a saved draft (`?draft=`) or the deck a proposal carries (`?proposal=`).
  // Either way the proposal it is on comes along: the studio updates that one in place (2026-10-12).
  let opened: { design: DeckDesign; address: string | null; title: string; draftId: string | null; from: "draft" | "proposal"; proposal: LinkedDeckProposal | null; client: ReturnedClientDesign | null } | null = null;
  const draftId = one(params.draft);
  const proposalId = one(params.proposal);
  if (draftId) {
    const res = await loadDeckDraft(draftId);
    if (res.ok) opened = { design: res.draft.design, address: res.draft.address, title: res.draft.title, draftId: res.draft.id, from: "draft", proposal: res.proposal, client: res.client };
  } else if (proposalId) {
    const res = await loadDeckFromProposal(proposalId);
    if (res.ok) opened = { design: res.design, address: res.address, title: res.title, draftId: null, from: "proposal", proposal: res.proposal, client: null };
  }
  // Keyed by what was opened: a client-side push to another draft or proposal (the studio's own Open links) mounts a
  // fresh studio on it, as the old studio's full page loads did.
  return <DeckV1Studio key={opened ? `${opened.from}:${opened.draftId ?? proposalId}` : `new:${clientId ?? ""}`} initialBook={book} homeState={homeState} initialAddress={opened?.address ?? initialAddress} clientId={clientId} clientContact={clientContact} adminPreview={level === "full" && !viaEdition} opened={opened} preview={level === "preview"} trialEndsAt={trialEndsAt} addonInterval={addonInterval} />;
}
