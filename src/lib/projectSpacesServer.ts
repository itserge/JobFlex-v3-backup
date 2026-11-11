import "server-only";
// THE WORKSPACES A PLAN DOESN'T HOLD (Base + Tools — owner, 2026-11-10; lib/projectSpaces spaceOpen). On the new plans
// New Home Builder is the Home Builder tool's and Remodeler the Remodeler's; a shop without the tool sees no card and
// no switch link for it — on the desktop page (app/dashboard/projects) and on the phone (mobile-projects-v2, through
// actions/projects listClosedProjectSpaces) alike. The server refuses the work itself (lib/projectCore
// requireProjectKind). Every Classic plan holds all three: the page gate answers them open.

import { isPageLocked } from "@/lib/customPageAccess";
import { SPACE_IDS, spacePage, type SpaceId } from "@/lib/projectSpaces";

export async function closedProjectSpaces(organizationId: string): Promise<SpaceId[]> {
  const closed: SpaceId[] = [];
  for (const id of SPACE_IDS) {
    const page = spacePage(id);
    if (page && (await isPageLocked(organizationId, page))) closed.push(id);
  }
  return closed;
}
