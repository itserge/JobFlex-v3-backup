import "server-only";
// WHAT AN ORGANIZATION MAY OPEN, BY EDITION (2026-10-11, lib/editions): the
// facts are read off the subscription — whether the plan has lapsed, the free
// trial, the Deck Studio add-on, a complimentary grant — and off the asking
// user (hasFullAccess), and the pure rules decide. The door a browser chose is
// a cookie.
import { cookies } from "next/headers";
import { getOrgPlanContext } from "@/lib/planCatalogServer";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { deckAddonHeld } from "@/lib/deckAddonBilling";
import { hasFullAccess } from "@/lib/fullAccess";
import { customDeckPageHeld, isPageLocked } from "@/lib/customPageAccess";
import { isToolsSlug } from "@/lib/toolPlans/shared";
import { DOOR_COOKIE, canSwitch, editionLevel, hasEdition, homeFor, parseDoor, workspaceFor, type AccessFacts, type Door, type EditionLevel, type Workspace } from "@/lib/editions";

/** `userId` undefined = the session's user (lib/fullAccess); null = nobody (the organization's own plan alone). */
export async function editionFacts(organizationId: string, userId?: string | null): Promise<AccessFacts> {
  const [ctx, sub, fullAccess] = await Promise.all([
    getOrgPlanContext(organizationId),
    readAccessSubscription(organizationId),
    hasFullAccess(organizationId, userId).catch(() => false),
  ]);
  // A lapsed plan reads as FREE there whatever its name.
  const lapsed = ctx.tier === "FREE";
  // A shop on the new plans (Base + Tools): Deck Studio is a tool its plan holds or not — the page gate's answer,
  // asked of the organization alone (an admin's session is `fullAccess` above). Classic shops never get the fact.
  if (isToolsSlug(sub?.plan)) {
    const deck = !lapsed && !(await isPageLocked(organizationId, "deck-estimator", { as: null }).catch(() => true));
    return { lapsed, trialing: !lapsed && sub?.status === "TRIALING", addon: false, customDeckPage: false, granted: !lapsed && sub?.provider === "MANUAL", fullAccess, tools: { deck } };
  }
  const [addon, customDeckPage] = await Promise.all([
    // The Deck Studio add-on (lib/deckAddon): its line on the subscription the organization is on.
    sub?.externalSubId ? deckAddonHeld(organizationId, sub.externalSubId).catch(() => false) : Promise.resolve(false),
    // The Custom plan's deck page, bought: the add-on as a page (lib/editions).
    customDeckPageHeld(organizationId, sub?.plan ?? null),
  ]);
  return { lapsed, trialing: !lapsed && sub?.status === "TRIALING", addon, customDeckPage, granted: !lapsed && sub?.provider === "MANUAL", fullAccess };
}

export async function readDoor(): Promise<Door | null> {
  try {
    return parseDoor((await cookies()).get(DOOR_COOKIE)?.value);
  } catch {
    return null;
  }
}

export interface WorkspaceView {
  facts: AccessFacts;
  door: Door | null;
  /** The workspace this request works in. */
  workspace: Workspace;
  /** The deck studio is open to the account. */
  deckAccess: boolean;
  /** How far: "full", "preview" (designs, saves nothing — lib/editions editionLevel) or "none". */
  deckLevel: EditionLevel;
  /** Both workspaces are open, so the switch is drawn. */
  switchable: boolean;
  /** Where a sign-in through the chosen door lands. */
  home: string;
}

export async function workspaceOf(organizationId: string): Promise<WorkspaceView> {
  const [facts, door] = await Promise.all([editionFacts(organizationId), readDoor()]);
  return { facts, door, workspace: workspaceFor(facts, door), deckAccess: hasEdition(facts, "deck"), deckLevel: editionLevel(facts, "deck"), switchable: canSwitch(facts), home: homeFor(door) };
}
