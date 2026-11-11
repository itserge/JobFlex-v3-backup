// Route allow-lists for the limited membership roles. Shared by the middleware
// (JWT-based UX gate, fail-open) and the (dashboard) layout (DB-role gate,
// fail-closed) so the two boundaries can never drift apart. Keep this module
// dependency-free — the middleware runs on the edge runtime.
//
// A path is allowed when it equals a prefix or lives under it ("/x" or "/x/…").
// Anything else redirects to the role's home surface.

export interface RoleRouteGate {
  allowed: string[];
  home: string;
}

// ── THE BLUEPRINT REDESIGN MOVED THREE SURFACES OUT FROM UNDER THIS LIST ────
// Reconnected 2026-08-18, owner-approved. This list is written in PATH
// prefixes, so a redesign that re-homes a page silently revokes it: the gate
// keeps allowing a URL nobody serves any more and the role loses the surface
// with no error anywhere. Three of those had accumulated:
//
//   · /dashboard/advanced-ai/roof  → /dashboard/roof-estimator
//     /dashboard/advanced-ai/fence → /dashboard/fence-estimator
//     Both sat under ESTIMATOR's "/dashboard/advanced-ai" prefix in the old
//     design. The blueprint ports gave them top-level routes, which the prefix
//     no longer covers, so the estimator role lost the two engines its job is
//     named after. nav-map.ts already listed them and had them dropped by this
//     gate — that TODO is what is being paid off here.
//   · /dashboard/clients/<id>      → /dashboard/client-detail?client=<id>
//     SALES is allowed "/dashboard/clients", and the client RECORD used to live
//     under it. The blueprint record is a separate top-level route, so a sales
//     rep could open the client LIST and not a single client on it.
//   · /dashboard/proposals/create  → /dashboard/manual-blueprint
//     The manual builder. It lived under "/dashboard/proposals", which SALES
//     and ESTIMATOR both hold, so both had it; the blueprint builder is
//     top-level and both lost it. SALES lost its create path entirely — every
//     engine in the picker was out of reach, so the topbar (which asks
//     ACTIVE_ENGINE_HREFS whether the role can reach ANY engine) stopped
//     drawing New Estimate at all.
//
// The additions are exactly those four prefixes and nothing else: no role gains
// a surface it did not hold in the old design, and each new entry replaces a
// path that role could already reach before the redesign moved it.
//
// ONE LATER ADDITION, owner 2026-10-17: "/dashboard/support" for all three. A
// support ticket is one conversation, and every role files tickets (the Help
// widget), so every role must be able to open its own and write in it. The
// page lists only the viewer's own tickets — never a colleague's.
const SUPPORT = "/dashboard/support";
// AND ONE MORE, owner 2026-11-11: "/dashboard/tutorials" for all three — the how-to videos, nothing of the company's.
const TUTORIALS = "/dashboard/tutorials";
export const ROLE_ROUTE_GATES: Record<string, RoleRouteGate> = {
  // Field workers: read-only jobs + own schedule + messages.
  INSTALLER: {
    allowed: ["/dashboard/jobs", "/dashboard/calendar", "/dashboard/messages", SUPPORT, TUTORIALS],
    home: "/dashboard/jobs",
  },
  // Sales reps: the pipeline slice.
  SALES: {
    allowed: [
      "/dashboard/leads",
      "/dashboard/clients",
      // The blueprint client record — the old design's /dashboard/clients/<id>.
      "/dashboard/client-detail",
      "/dashboard/proposals",
      // The blueprint manual builder — the old design's
      // /dashboard/proposals/create.
      "/dashboard/manual-blueprint",
      "/dashboard/crm",
      // The Smart CRM's own pages (2026-11-08), opened from the CRM tabs a rep already holds: the client Inbox
      // (the conversations side of /dashboard/messages) and the Pipeline (the leads board's successor). Both
      // scope to the rep — their own proposals, their own or unclaimed leads — and the source report stays the office's.
      "/dashboard/inbox",
      "/dashboard/pipeline",
      "/dashboard/calendar",
      "/dashboard/phone",
      "/dashboard/messages",
      SUPPORT,
      TUTORIALS,
    ],
    home: "/dashboard/leads",
  },
  // Estimators: proposals + the estimating engines + projects. No client access.
  ESTIMATOR: {
    allowed: [
      "/dashboard/proposals",
      // The blueprint manual builder — the old design's
      // /dashboard/proposals/create.
      "/dashboard/manual-blueprint",
      "/dashboard/projects",
      // The subcontractors plan, part 1 (2026-11-08): the directory and the quotes across projects go with Projects.
      "/dashboard/subcontractors",
      "/dashboard/quotes",
      "/dashboard/advanced-ai",
      // The blueprint estimator: Smart Proposal's plan set as its own tool (2026-10-13).
      "/dashboard/blueprint-estimator",
      // The old shared inventory address: it forwards to a trade's own
      // inventory under its estimator (2026-10-10), which the estimator
      // prefixes below already allow.
      "/dashboard/inventory",
      // The blueprint homes of the old /dashboard/advanced-ai/roof and
      // /dashboard/advanced-ai/fence.
      "/dashboard/roof-estimator",
      "/dashboard/fence-estimator",
      "/dashboard/hvac-estimator",
      "/dashboard/deck-estimator",
      "/dashboard/messages",
      SUPPORT,
      TUTORIALS,
    ],
    home: "/dashboard/proposals",
  },
};

/** True when `pathname` sits inside one of the gate's allowed prefixes. */
export function isPathAllowed(gate: RoleRouteGate, pathname: string): boolean {
  return gate.allowed.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
