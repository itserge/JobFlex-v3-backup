// MOBILE HIRE & WORK — /mobile-hire-v1
//
// The direct-review entry point for the handheld build of Hire & Work: always
// the mobile design, at any width, so the composition can be opened on a
// desktop browser without resizing. The desktop surface at /dashboard/hire is
// untouched — this route stands beside it, per the mobile route strategy.
//
// REAL DATA, NOT A FIXTURE. This page loads exactly what the desktop hire page
// loads — `listOpenTradeJobs()` for the board, `getMyTradeJobs()` for the
// caller's own posts, `getHireViewer()` for who they are — so the preview URL
// and the live URL describe the same records and cannot drift. Every write goes
// back through the same actions in src/actions/tradeServices.ts.
//
// `?tab=work` opens on the Work side, the same deep link the interest email
// uses on the desktop twin.
//
// Auth: middleware only matches /dashboard and /admin, so this route enforces
// its own redirect-to-login like every other (mobile) design route — the same
// requireOrg / UnauthorizedError / NoOrgError shape as
// src/app/(mobile)/mobile-overhead-v1/page.tsx.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { getHireViewer, getMyHirePosts, listOpenTradeJobs } from "@/actions/tradeServices";
import { MobileHire } from "@/components/v3/mobile-hire/mobile-hire";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hire & Work · JobFlex Mobile",
  description: "Find a tradesperson on the network, or post yourself for hire.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets the shell reserves.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function MobileHireV1Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The Hire board is a size's on the new plans (Professional and up); open on every Classic plan (lib/customPlan).
  const gate = await customPageGate("hire", { handheld: true });
  if (gate) return gate;
  let seed: Awaited<ReturnType<typeof load>>;
  try {
    seed = await load();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent("/mobile-hire-v1")}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const { tab } = await searchParams;

  return (
    <MobileHire
      posts={seed.posts}
      mine={seed.mine}
      viewer={seed.viewer}
      initialTab={tab === "work" ? "work" : "hire"}
    />
  );
}

async function load() {
  // requireOrg first, so a signed-out visitor is redirected rather than being
  // handed whichever of the three actions happens to throw first.
  await requireOrg();
  const [posts, mine, viewer] = await Promise.all([
    listOpenTradeJobs(),
    getMyHirePosts(),
    getHireViewer(),
  ]);
  return { posts, mine, viewer };
}
