// /switch/<program> — "Switch to JobFlex" for one program (2026-11-16, CRM migration plan part 3). Static: one page per
// program in lib/import/sources (housecall-pro, jobber, servicetitan, workiz, jobnimbus, quickbooks, spreadsheet).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/siteUrl";
import { sourceBySlug, SWITCH_SOURCES } from "@/lib/import/sources";
import { programName, SwitchProgramPage } from "@/components/v3/switch/switch-page";

export const dynamicParams = false;
export const revalidate = 86400;

export function generateStaticParams() {
  return SWITCH_SOURCES.map((s) => ({ program: s.slug! }));
}

export async function generateMetadata({ params }: { params: Promise<{ program: string }> }): Promise<Metadata> {
  const src = sourceBySlug((await params).program);
  if (!src) return {};
  const name = programName(src);
  const title = src.id === "OTHER" ? "Move your clients from a spreadsheet into JobFlex — free | JobFlex" : `Switch from ${src.label} to JobFlex — bring your clients free | JobFlex`;
  const description = `Move your ${src.id === "OTHER" ? "" : `${src.label} `}clients, unpaid invoices, upcoming jobs and job history from ${name} into JobFlex — yourself in about 10 minutes, or we do it for you free within 2 business days.`;
  const url = `${SITE_URL}/switch/${src.slug}`;
  return { title, description, alternates: { canonical: url }, openGraph: { type: "website", url, siteName: "JobFlex", title, description } };
}

export default async function Page({ params }: { params: Promise<{ program: string }> }) {
  const src = sourceBySlug((await params).program);
  if (!src) notFound();
  return <SwitchProgramPage src={src} />;
}
