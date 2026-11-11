import "server-only";
// THE WORKSPACES A PLAN DOESN'T HOLD (Base + Tools — owner, 2026-11-10; lib/projectSpaces spaceOpen). On the new plans
// New Home Builder is the Home Builder tool's and Remodeler the Remodeler's. A shop without the tool keeps the
// workspace's card on the Projects page as a PREVIEW (owner, 2026-11-11: "keep those two beautiful cards"), priced
// by its tool and opening Upgrade your plan — on the desktop page (app/dashboard/projects) and on the phone
// (mobile-projects-v2, through actions/projects listClosedProjectSpaceOffers) alike; it has no switch link inside a
// workspace. The server refuses the work itself (lib/projectCore requireProjectKind). Every Classic plan holds all
// three: the page gate answers them open.

import { isPageLocked } from "@/lib/customPageAccess";
import { SPACE_IDS, spacePage, type SpaceId } from "@/lib/projectSpaces";
import { readToolCatalog } from "@/lib/toolPlans/prices";
import { TOOLS } from "@/lib/toolPlans/shared";
import type { SpaceOffer } from "@/components/v3/projects-blueprint/project-spaces";

export async function closedProjectSpaces(organizationId: string): Promise<SpaceId[]> {
  const closed: SpaceId[] = [];
  for (const id of SPACE_IDS) {
    const page = spacePage(id);
    if (page && (await isPageLocked(organizationId, page))) closed.push(id);
  }
  return closed;
}

/** Each closed workspace's tool and its price in force (Admin → Plans), for the preview card's words. */
export async function spaceOffers(closed: readonly SpaceId[]): Promise<Partial<Record<SpaceId, SpaceOffer>>> {
  if (!closed.length) return {};
  const tools = (await readToolCatalog().catch(() => null))?.tools ?? TOOLS;
  const out: Partial<Record<SpaceId, SpaceOffer>> = {};
  for (const id of closed) {
    const page = spacePage(id);
    const tool = page ? tools.find((t) => t.opens.includes(page)) : undefined;
    if (tool) out[id] = { tool: tool.id, label: tool.label, cents: tool.cents };
  }
  return out;
}
