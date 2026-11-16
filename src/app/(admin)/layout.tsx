// Platform admin console — route-group layout.
//
// GUARD. requirePlatformAdmin() tries the signed `jf_admin` cookie first (the
// username/password login at /admin/login), then a NextAuth session whose user
// carries isPlatformAdmin. Either failing sends the visitor to /admin/login —
// not /auth/login, because the console has its own door now.
//
// THE LOGIN PAGE LIVES UNDER THIS LAYOUT (src/app/(admin)/admin/login), so it
// must not be guarded — a guard there would redirect the login page to itself.
// The middleware sets `x-pathname` on every /admin request; for the login path
// this layout renders its children bare, no shell, no guard.
//
// SHELL. The blueprint admin chrome (components/v3/admin-shell) replaces the
// classic Tailwind header + rail. The nav badges — unread support tickets,
// pending payout requests, leads in the manual queue, (2026-10-11) the
// signed-in admin's own open tasks and (2026-10-20) open trial-extension asks — are the same
// queries the old rail received as props, handed to the sidebar through the
// shared NavRoleProvider's `badges` channel keyed by nav href.

import { redirect } from "next/navigation";
import type { Route } from "next";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { readAdminCookie } from "@/lib/adminAuth";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { unreadSupportCount } from "@/actions/support";
import { myOpenTaskCountSafe } from "@/lib/adminTasks/service";
import { openRequestCount } from "@/lib/import/requestServer";
import { NavRoleProvider } from "@/components/v3/blueprint-shell/nav-role";
import { AdminShell } from "@/components/v3/admin-shell/admin-shell";
import { ContractorMailProvider } from "@/components/v3/admin-mail/contractor-mail";
import { ADMIN_SIDEBAR_FOLD_COOKIE } from "@/components/v3/blueprint-shell/sidebar-fold";

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return <>{children}</>;
  }

  let admin: Awaited<ReturnType<typeof requirePlatformAdmin>> | null = null;
  try {
    admin = await requirePlatformAdmin();
  } catch {
    admin = null;
  }
  // redirect() throws, so it sits outside the try above.
  if (!admin) redirect("/admin/login" as Route);

  // The office screen goes on a TV (2026-10-13): guarded like every admin page, drawn without the console's chrome.
  if (pathname === "/admin/office" || pathname.startsWith("/admin/office/")) return <>{children}</>;
  // The customer development report (2026-10-22) is a document to print or save as a PDF: guarded, no chrome.
  if (pathname === "/admin/customer-development/report") return <>{children}</>;

  // Which door the admin came through decides what Sign out clears.
  const viaCookie = (await readAdminCookie()) !== null;

  const [unreadSupport, pendingPayouts, manualQueueLeads, myOpenTasks, pendingTrialAsks, openImports] = await Promise.all([
    unreadSupportCount(),
    // A reversed transfer waits on an admin's Retry payout / Write off exactly
    // as a new request waits on Approve, so both light the badge.
    db.payoutRequest.count({ where: { status: { in: ["PENDING", "REVERSED"] } } }),
    db.platformLead.count({ where: { status: "MANUAL_QUEUE", isTest: false } }),
    // Open tasks given to whoever is signed in (/admin/tasks); 0, never a
    // 500, if the task tables are not there yet.
    myOpenTaskCountSafe(admin.id),
    // Trial-extension asks waiting on a decision (2026-10-20); 0 while the
    // table is not in this database yet.
    db.trialExtensionRequest.count({ where: { status: "PENDING" } }).catch(() => 0),
    // "Do it for me" imports waiting on the team (2026-11-16); 0 while the table is not in this database yet.
    openRequestCount().catch(() => 0),
  ]);

  const badges: Record<string, number> = {
    "/admin/support": unreadSupport,
    "/admin/payouts": pendingPayouts,
    "/admin/lead-center": manualQueueLeads,
    "/admin/tasks": myOpenTasks,
    "/admin/trial-requests": pendingTrialAsks,
    "/admin/imports": openImports,
  };

  const adminName = admin.name || admin.email;
  // The sidebar's fold (owner, 2026-10-02), read here so the first paint is
  // already folded — the console's own cookie, not the dashboard's.
  const sidebarFolded = (await cookies()).get(ADMIN_SIDEBAR_FOLD_COOKIE)?.value === "1";

  return (
    <NavRoleProvider identity={{ role: null, name: adminName }} badges={badges}>
      <AdminShell adminName={adminName} signOutMode={viaCookie ? "cookie" : "nextauth"} sidebarFolded={sidebarFolded}>
        {/* One email composer for the whole console (2026-10-08): any card can open it on an account. */}
        <ContractorMailProvider>{children}</ContractorMailProvider>
      </AdminShell>
    </NavRoleProvider>
  );
}
