// Admin · Do not email (2026-11-11) — the do-not-email list (lib/mailBlock): every address that asked us to stop,
// by a link, a reply, an admin or a company's "Don't email". Search by part of an address (?q=), add one by hand,
// take one off. What a listed address still gets: sign-in codes, password resets, receipts, invoices, billing notices.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { listMailBlocks } from "@/lib/mailBlock";
import { AdminMailBlockContent, type MailBlockRow } from "@/components/v3/admin-mail-block/mail-block-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Do not email",
  description: "Addresses that get no email from JobFlex except codes, receipts and billing notices.",
};

export default async function AdminMailBlockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformAdmin();
  const q = ((await searchParams).q ?? "").trim().toLowerCase().slice(0, 120);
  const { rows, total } = await listMailBlocks({ q, take: 1000 });
  // Whose address it is: the companies it owns, and any other company that marked it "Don't email".
  const emails = rows.map((r) => r.email);
  const [owners, orgs] = await Promise.all([
    emails.length ? db.membership.findMany({ where: { role: "OWNER", user: { email: { in: emails } } }, select: { user: { select: { email: true } }, organization: { select: { name: true } } } }) : [],
    db.organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.orgId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  const ownerOf = new Map<string, string[]>();
  for (const o of owners) {
    const e = o.user?.email?.toLowerCase();
    if (e) ownerOf.set(e, [...(ownerOf.get(e) ?? []), o.organization.name]);
  }
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const list: MailBlockRow[] = rows.map((r) => ({
    email: r.email,
    reason: r.reason,
    source: r.source,
    at: r.at || null,
    by: r.by ?? null,
    company: r.orgId ? (orgName.get(r.orgId) ?? null) : null,
    owns: ownerOf.get(r.email) ?? [],
  }));
  return <AdminMailBlockContent rows={list} total={total} q={q} />;
}
