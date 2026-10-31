// THE HOME PORTAL — /home/[key] (2026-10-03; Blueprint since 2026-10-30).
// The homeowner's own page, made by their first request and reached through
// the key the emails carry. No account, no password (lib/home/portal says who
// may see what).
//
// Since 2026-10-31 it is one page again: Projects · Contractors · Calendar
// (with the plans) · Details are its sections and the sticky tabs are anchors
// (the old /contractors, /calendar, /details routes redirect to them); /project/[token] and /new stay pages.
// The pieces live in components/v3/homeowner-portal-blueprint; every page
// re-reads itself while open (LiveRefresh in the frame).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadHomeDashboard } from "@/lib/home/portal";
import { HomeOverview } from "@/components/v3/homeowner-portal-blueprint/home-overview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your home — JobFlex Home",
  description: "Every project on your house, the quotes, your contractors and the jobs you're planning — in one place.",
  robots: { index: false, follow: false },
};

export default async function HomePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const h = await loadHomeDashboard(key);
  if (!h) notFound();
  return <HomeOverview h={h} />;
}
