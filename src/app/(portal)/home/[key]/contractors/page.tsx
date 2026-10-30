// /home/[key]/contractors — the home portal's Your contractors page (2026-10-30). The key is the login.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadHomeDashboard } from "@/lib/home/portal";
import { ContractorsPage } from "@/components/v3/homeowner-portal-blueprint/contractors-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your contractors — JobFlex Home",
  description: "Your contractors — phone, email, the projects they did and the plans they offer.",
  robots: { index: false, follow: false },
};

export default async function HomeContractorsPageRoute({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const h = await loadHomeDashboard(key);
  if (!h) notFound();
  return <ContractorsPage h={h} />;
}
