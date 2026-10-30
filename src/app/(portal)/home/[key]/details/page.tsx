// /home/[key]/details — the home portal's Your details page (2026-10-30). The key is the login.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadHomeDashboard } from "@/lib/home/portal";
import { DetailsPage } from "@/components/v3/homeowner-portal-blueprint/details-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your details — JobFlex Home",
  description: "Your details and the documents your contractors sent.",
  robots: { index: false, follow: false },
};

export default async function HomeDetailsPageRoute({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const h = await loadHomeDashboard(key);
  if (!h) notFound();
  return <DetailsPage h={h} />;
}
