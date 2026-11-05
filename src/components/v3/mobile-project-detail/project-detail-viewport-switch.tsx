"use client";

// VIEWPORT SWITCH for /dashboard/projects/[id].
//
// The desktop blueprint page above 768px, the handheld rebuild at or below it,
// from ONE URL — the same contract the other 24 promoted routes get from
// responsive-shell/responsive-dashboard-shell.tsx, and written to the same
// rules:
//
//   · the switch is a MEDIA QUERY, never the user agent. CLAUDE.md's
//     mobile-first rule forbids UA detection, and a query is also the only
//     thing that makes DevTools' device toolbar work: drag the viewport under
//     768px and the surface swaps live, no reload and no second URL.
//   · EXACTLY ONE TREE IS MOUNTED, NEVER BOTH. The handheld shell is
//     `position: fixed; inset: 0` and its mount effect locks body scrolling;
//     rendering it over a live desktop shell would strand the desktop page's
//     scroll and leave the sidebar's twenty-odd links in the tab order
//     underneath an opaque overlay.
//   · `dynamic(…, { ssr: false, loading: MobileHold })`, so a desktop visitor
//     never downloads the handheld bundle and the one chunk fetch that happens
//     when the viewport first crosses 768px is covered by a paper-coloured
//     full-bleed hold instead of blinking through to blank.
//
// ── WHY THIS ROUTE SWITCHES HERE AND NOT IN THE SHELL ──────────────────────
// HANDHELD_SURFACES in responsive-dashboard-shell.tsx is `Record<pathname,
// ComponentType>`: keyed by an EXACT pathname, rendering a component that takes
// no props. Neither half fits this route. It is dynamic — /dashboard/projects/
// cmomfzw8m001fyb33mz3lis5d — so no literal key can match it; and its handheld
// build needs the project, its jobs and the attachable-proposal candidates,
// which are read in the page's server component and cannot reach a props-less
// component mounted by the layout. Fetching them again from the client would
// mean a new API route or a new server action, and the data layer is out of
// scope.
//
// So the PAGE owns the switch and the shell steps out of the way: the one entry
// added to that file is a guard that, at ≤768px on this route, renders the page
// bare instead of wrapping it in BlueprintShell. Both sides read the same
// `(max-width: 768px)` query, so they flip in the same commit — the desktop
// content is never left standing without its shell, and the handheld tree is
// never mounted inside one.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { ProjectDetailContent } from "@/components/v3/project-detail-blueprint/project-detail-content";
import { ChunkRecoveryBoundary } from "@/components/v3/shared/chunk-recovery-boundary";
import type {
  PdAvailProposal,
  PdBudget,
  PdJob,
  PdLooseProposal,
  PdOpens,
  PdPayments,
  PdProject,
  PdWorker,
  PdProposal,
} from "@/components/v3/project-detail-blueprint/project-detail-data";

/** CLAUDE.md's handheld target: ≤768px. The same literal the shell uses. */
const HANDHELD = "(max-width: 768px)";

// Paper-coloured full-bleed hold, character-identical to the shell's own (it is
// not exported from that module, and importing the shell here would pull the
// desktop chrome into this chunk). Inline styles on purpose: this has to paint
// before the handheld stylesheet has been fetched, which is also why the
// #f2f0eb drafting cream is written out rather than read from --paper.
const MobileHold = () => (
  <div style={{ position: "fixed", inset: 0, zIndex: 20, background: "#f2f0eb" }} />
);

// Imported out of its own module rather than copied, so /mobile-project-detail-v2
// and /dashboard/projects/[id] cannot drift: one implementation, two entries.
const MobileProjectDetail = dynamic(
  () => import("./mobile-project-detail").then((m) => m.MobileProjectDetail),
  { ssr: false, loading: MobileHold },
);

// Module scope so the identities are stable across renders — a fresh
// `subscribe` on every render makes useSyncExternalStore re-subscribe each
// time, which on a resize-driven store means tearing down the listener in the
// middle of the resize that triggered the render.
function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
// The server cannot know the viewport, so it renders desktop and the client
// corrects during hydration — the same trade the shell makes, and the same
// reason: rendering nothing until mounted flashes blank for every visitor.
const getServerSnapshot = () => false;

export function ProjectDetailViewportSwitch(props: {
  project: PdProject;
  jobs: PdJob[];
  proposals: PdProposal[];
  availableProposals: PdAvailProposal[];
  looseProposals: PdLooseProposal[];
  budget: PdBudget;
  /** Owner or manager — change orders are theirs (actions/changeOrders requireManager). */
  canManage?: boolean;
  /** The pages this role may open from here (lib/roleRoutes). */
  opens?: PdOpens;
  payments?: PdPayments;
  roster?: PdWorker[];
}) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // The handheld half is a lazy chunk, so it inherits the deploy-skew failure
  // the shell's surfaces have: a build that lands while this tab is open turns
  // the import into a 404 and the 404 into "a client-side exception has
  // occurred". The boundary spends one reload on it. See the boundary's header.
  if (isHandheld) {
    return (
      <ChunkRecoveryBoundary>
        <MobileProjectDetail {...props} />
      </ChunkRecoveryBoundary>
    );
  }
  return <ProjectDetailContent {...props} />;
}
