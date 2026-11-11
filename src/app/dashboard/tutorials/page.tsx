// Tutorials (owner, 2026-11-11: "add tutorials in a sidebar on the bottom"). Every role, every workspace: the
// videos that walk through each tool. Nothing of the company's is read — the page itself (components/v3/tutorials)
// asks the sidebar's own rule which tools this person has, and puts those first. The films are in the private store;
// only here, after the sign-in check, are their links made (lib/tutorials/links).
//
// ?v=<slug> opens a tutorial; &t=<seconds> starts it there (a link to one chapter).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { tutorialLinks } from "@/lib/tutorials/links";
import { TutorialsPage } from "@/components/v3/tutorials/tutorials-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Tutorials", description: "Short videos that walk through each JobFlex tool, screen by screen." };

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  try {
    await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Ftutorials");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const sp = await searchParams;
  const t = Number(typeof sp.t === "string" ? sp.t : NaN);
  // A store that cannot be reached leaves the page up, saying the videos cannot be played right now.
  const links = await tutorialLinks().catch((err) => {
    console.error("[tutorials] links", err instanceof Error ? err.message : err);
    return null;
  });
  return <TutorialsPage links={links} startAt={Number.isFinite(t) && t > 0 ? t : null} />;
}
