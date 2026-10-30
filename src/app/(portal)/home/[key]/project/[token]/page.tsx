// /home/[key]/project/[token] — one project inside the home portal (2026-10-30).
// Only a project on THIS home opens here: the key is the login, the token
// picks the project from the home's own list.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadHomeDashboard } from "@/lib/home/portal";
import { ProjectPage } from "@/components/v3/homeowner-portal-blueprint/project-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your project — JobFlex Home",
  description: "Where your project stands, the quote, your contractor, photos and what happens next.",
  robots: { index: false, follow: false },
};

export default async function HomeProjectPage({ params }: { params: Promise<{ key: string; token: string }> }) {
  const { key, token } = await params;
  const h = await loadHomeDashboard(key);
  const p = h?.projects.find((x) => x.token === token);
  if (!h || !p) notFound();
  return <ProjectPage h={h} p={p} />;
}
