// /home/[key]/calendar — the home portal's Calendar page (2026-10-30). The key is the login.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadHomeDashboard } from "@/lib/home/portal";
import { CalendarPage } from "@/components/v3/homeowner-portal-blueprint/calendar-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar — JobFlex Home",
  description: "What's coming up at your house, and the projects you plan for later.",
  robots: { index: false, follow: false },
};

export default async function HomeCalendarPageRoute({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const h = await loadHomeDashboard(key);
  if (!h) notFound();
  return <CalendarPage h={h} />;
}
