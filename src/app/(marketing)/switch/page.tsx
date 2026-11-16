// /switch — "Switch to JobFlex": pick the program you're moving from (2026-11-16, CRM migration plan part 3). Static.
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/siteUrl";
import { SwitchIndexPage } from "@/components/v3/switch/switch-page";

export const revalidate = 86400;

const title = "Switch to JobFlex — bring your clients from Housecall Pro, Jobber, ServiceTitan and more | JobFlex";
const description = "Move your clients, unpaid invoices, upcoming jobs and job history into JobFlex — yourself in about 10 minutes, or we do it for you free within 2 business days.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/switch` },
  openGraph: { type: "website", url: `${SITE_URL}/switch`, siteName: "JobFlex", title, description },
};

export default function Page() {
  return <SwitchIndexPage />;
}
