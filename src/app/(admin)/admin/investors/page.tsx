// INVESTORS — /admin/investors (2026-10-06). Owner: "statistics for
// investors: how much we spend on ads, how many users we get on free trial,
// what is projected if all pay and what is realistic, and the main thing —
// how soon we cover the ad spend. A separate page, with a live link or a
// PDF to send them." The figures are lib/investorModel on the rows
// lib/investors gathers; this page adds the owner's controls.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { investorReport } from "@/lib/investors";
import { AdminInvestorsContent } from "@/components/v3/admin-investors/admin-investors-content";
import { InvestorAudience } from "@/components/v3/admin-investors/investor-audience";
import { readInvestorOffers, readInvestorVisitors } from "@/lib/investorVisitors";
import { readInvestorPitch } from "@/lib/investorPitch";
import { readersOf } from "@/lib/investorGate";
import { PitchWordsPanel } from "@/components/v3/admin-investors/pitch-words-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex Admin · Investors" };

export default async function AdminInvestorsPage({ searchParams }: { searchParams: Promise<{ review?: string; adjust?: string }> }) {
  // ?review=<id>: a request a text or an email pointed to (2026-10-20) — brought into view.
  // ?adjust=1: the hand controls for the spend and the counting (2026-10-25) — otherwise the page keeps them out of sight.
  const { review, adjust } = await searchParams;
  await requirePlatformAdmin();
  const report = await investorReport({ refreshMeta: true });
  // The shared link is printed with this deployment's own host.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.jobflex.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // Who opened the shared link and the offers sent from it (2026-10-13).
  // …and the pitch deck's own words (2026-10-25).
  const [visitors, offers, pitch] = await Promise.all([readInvestorVisitors(), readInvestorOffers(), readInvestorPitch()]);
  const a = report.settings;
  const linkBase = a.linkToken && a.linkEnabled ? `${proto}://${host}/investors/${a.linkToken}` : null;
  // How many readers came through each link (several links since 2026-11-04), the admins' own tries left out.
  const readersByLink: Record<string, number> = {};
  for (const v of readersOf(visitors)) if (v.linkMadeAt) readersByLink[v.linkMadeAt] = (readersByLink[v.linkMadeAt] ?? 0) + 1;
  return (
    <AdminInvestorsContent
      initial={report}
      origin={`${proto}://${host}`}
      readersByLink={readersByLink}
      adjust={adjust === "1"}
      pitch={<PitchWordsPanel initial={pitch} linkBase={linkBase} />}
      audience={<InvestorAudience visitors={visitors} offers={offers} liveLinks={report.settings.links.filter((l) => l.enabled).map((l) => l.madeAt)} approveReaders={report.settings.approveReaders} review={typeof review === "string" ? review.slice(0, 40) : undefined} />}
    />
  );
}
