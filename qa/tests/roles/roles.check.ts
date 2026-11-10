// What each role can call directly (security audit 2026-10-12, section 2).
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/roles.check.ts
//
// One throwaway organisation on the local dev database with an OWNER, a
// MANAGER and one member of each limited role (INSTALLER, SALES, ESTIMATOR).
// Every call goes to the real server action as that member (./_actionHarness)
// — what the UI hides does not matter here, only what the server allows.
//
// The rule (fixed 2026-10-12): an action is open to a role exactly when a
// page that calls it is — the route allow-lists in lib/roleRoutes that the
// middleware and the (dashboard) / (mobile) layouts apply, and that the role
// cards in lib/roleAccess describe. The eight reads the audit caught are
// checked for every role, both ways: refused where the page is closed to the
// role, answered where it is open.
import { actAs, check, outcome, setHeaders, summary } from "../_lib/_actionHarness";
import { randomBytes } from "node:crypto";
import { db } from "../../../src/lib/db";
import { ROLE_ROUTE_GATES, isPathAllowed } from "../../../src/lib/roleRoutes";
import { loadFinancials } from "../../../src/actions/financialsMobile";
import { loadFinancialsWho } from "../../../src/app/(mobile)/mobile-financials-v2/who-action";
import { getCrmSnapshot } from "../../../src/app/(mobile)/mobile-crm-v2/crm-snapshot";
import { loadClientBook } from "../../../src/app/(mobile)/mobile-clients-v2/client-book";
import { loadJobsBoard } from "../../../src/app/(mobile)/mobile-jobs-v2/jobs-board";
import { loadMobileLeads } from "../../../src/app/(mobile)/mobile-leads-v2/leads-source";
import { loadRoster } from "../../../src/app/(mobile)/mobile-workers-v2/workers-roster";
import { getCalendarSeed } from "../../../src/app/dashboard/calendar/calendar-actions";
import { getHireSeed } from "../../../src/actions/applicants";
import { getCompanySeed } from "../../../src/actions/company";
import { getDashboardData } from "../../../src/app/dashboard/dashboard-actions";
import { listProjects, listProjectClients } from "../../../src/actions/projects";
import { clientProjectOptions } from "../../../src/actions/projectLinks";
import { attachHomeFileToProposal, requestHomeFiles } from "../../../src/actions/homeFiles";
import { sendTestNotification } from "../../../src/actions/notifications";
import { getHireViewer } from "../../../src/actions/tradeServices";
import { markBookingDone } from "../../../src/actions/booking";
import { proposalPickList } from "../../../src/actions/inventoryLink";
import { loadJobMaterials } from "../../../src/actions/inventory";
import { startPhoneVerification } from "../../../src/actions/sms";
import * as clients from "../../../src/actions/clients";
import * as proposals from "../../../src/actions/proposals";
import * as jobs from "../../../src/actions/jobs";
import * as jobMedia from "../../../src/actions/jobMedia";
import * as installments from "../../../src/actions/installments";
import * as team from "../../../src/actions/team";
import * as payConn from "../../../src/actions/paymentConnections";
import * as adminUsers from "../../../src/actions/adminUsers";
import * as adminTasks from "../../../src/actions/adminTasks";
import * as deck from "../../../src/actions/deckEstimator";
import * as tasksChanges from "../../../src/app/api/admin/tasks/changes/route";
import * as pipeline from "../../../src/actions/pipeline";

// The handheld group's layout, by require so the harness's stand-ins (and its
// stylesheet stub) are in place when it loads.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MobileLayout = require("../../../src/app/(mobile)/layout").default as (p: { children: unknown }) => Promise<unknown>;

const tag = `qa-roles-${Date.now()}`;
const rid = () => randomBytes(9).toString("hex");
const ROLES = ["OWNER", "MANAGER", "INSTALLER", "SALES", "ESTIMATOR"] as const;
type Role = (typeof ROLES)[number];
const mayOpen = (role: Role, route: string) => {
  const gate = ROLE_ROUTE_GATES[role];
  return !gate || isPathAllowed(gate, route);
};

async function main() {
  const org = await db.organization.create({ data: { name: `${tag}`, slug: tag, isInternal: true } });
  const mk = async (role: Role) => {
    const u = await db.user.create({ data: { email: `${tag}-${role.toLowerCase()}@qa.test`, name: role, activeOrgId: org.id } });
    const m = await db.membership.create({ data: { userId: u.id, organizationId: org.id, role } });
    const w = await db.workerProfile.create({ data: { userId: u.id, organizationId: org.id, displayName: role, token: rid() } });
    return { u, m, w };
  };
  const people = {} as Record<Role, Awaited<ReturnType<typeof mk>>>;
  for (const r of ROLES) people[r] = await mk(r);
  const { OWNER: owner, MANAGER: manager, INSTALLER: installer, SALES: sales, ESTIMATOR: estimator } = people;
  const client = await db.client.create({ data: { organizationId: org.id, name: `Client ${tag}`, email: "c@qa.test", phone: "555-0100" } });
  const proposal = await db.proposal.create({ data: { organizationId: org.id, publicId: rid(), title: `Owner's proposal ${tag}`, clientId: client.id, status: "DRAFT", total: 9000, ownerId: owner.u.id } });
  const inst = await db.installment.create({ data: { proposalId: proposal.id, label: "Deposit", amount: 4500, position: 0 } });
  const job = await db.job.create({ data: { organizationId: org.id, title: `Unassigned job ${tag}`, clientId: client.id, proposalId: proposal.id } });
  await db.applicant.create({ data: { organizationId: org.id, fullName: "Applicant Person", email: "applicant@qa.test", phone: "555-0199", role: "Installer" } }).catch(() => null);
  await db.jobExpense.create({ data: { organizationId: org.id, jobId: job.id, category: "Materials", amount: 1234, status: "APPROVED" } });
  const booking = await db.booking.create({ data: { organizationId: org.id, serviceKey: "tune-up", serviceLabel: "Tune-up", minutes: 60, name: "Booked Person", startsAt: new Date(Date.now() + 864e5), endsAt: new Date(Date.now() + 900e5) } });
  const home = await db.home.create({ data: { email: `${tag}-home@qa.test`, name: "QA Home", accessToken: rid() + rid() } });
  const pl = await db.platformLead.create({ data: { name: "QA Home", email: `${tag}-home@qa.test`, matchedOrgId: org.id } });
  const file = await db.homeFile.create({ data: { homeId: home.id, platformLeadId: pl.id, organizationId: org.id, url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", name: "y.png", contentType: "image/png", bytes: 70, media: "photo" } });

  const as = (p: { u: { id: string } }) => actAs({ id: p.u.id, activeOrgId: org.id });
  const expectRefused = async (who: string, p: typeof owner, name: string, fn: () => Promise<unknown>, leakWhen?: (v: unknown) => boolean) => {
    as(p);
    const r = await outcome(fn);
    const leaked = !r.refused && (leakWhen ? leakWhen(r.value) : true);
    check(`${who}: ${name} is refused`, !leaked, `answered: ${r.text}`);
  };
  const expectAllowed = async (who: string, p: typeof owner, name: string, fn: () => Promise<unknown>) => {
    as(p);
    const r = await outcome(fn);
    check(`control ${who}: ${name} works`, !r.refused, r.text);
  };
  const has = (needle: string) => (v: unknown) => JSON.stringify(v ?? null).includes(needle);

  try {
    // ── the eight reads × every role: open exactly where the page is ──
    const EIGHT: Array<[string, string, () => Promise<unknown>]> = [
      ["loadFinancials (company money)", "/dashboard/financials", () => loadFinancials()],
      ["loadFinancialsWho", "/dashboard/financials", () => loadFinancialsWho()],
      ["getHireSeed (applicants' names, emails, phones)", "/dashboard/hire", () => getHireSeed()],
      ["getCompanySeed (company settings + team log)", "/dashboard/company", () => getCompanySeed()],
      ["getCrmSnapshot (leads, clients, conversations)", "/dashboard/crm", () => getCrmSnapshot()],
      ["loadClientBook (every client)", "/dashboard/clients", () => loadClientBook()],
      ["listProjectClients", "/dashboard/projects", () => listProjectClients()],
      ["listProjects", "/dashboard/projects", () => listProjects()],
      ["getDashboardData (Overview KPIs and money)", "/dashboard", () => getDashboardData()],
    ];
    for (const [name, route, fn] of EIGHT) {
      for (const role of ROLES) {
        if (mayOpen(role, route)) await expectAllowed(role, people[role], `${name} [${route} is open to it]`, fn);
        else await expectRefused(role, people[role], `${name} [${route} is closed to it]`, fn);
      }
    }
    // What the audit saw leak is not in a refused answer either.
    await expectRefused("INSTALLER", installer, "loadFinancials leaks no expense", () => loadFinancials(), has("1234"));
    await expectRefused("INSTALLER", installer, "getDashboardData leaks no pipeline money", () => getDashboardData(), has("9000"));

    // ── the rest of the sweep: a sample per page ──
    await expectAllowed("INSTALLER", installer, "loadJobsBoard (its jobs page)", () => loadJobsBoard());
    await expectRefused("SALES", sales, "loadJobsBoard (no jobs page)", () => loadJobsBoard());
    await expectRefused("ESTIMATOR", estimator, "loadJobsBoard (no jobs page)", () => loadJobsBoard());
    await expectRefused("SALES", sales, "loadJobMaterials (no jobs page)", () => loadJobMaterials(job.id));
    await expectAllowed("SALES", sales, "loadMobileLeads", () => loadMobileLeads());
    await expectRefused("ESTIMATOR", estimator, "loadMobileLeads (no leads page)", () => loadMobileLeads());
    await expectRefused("INSTALLER", installer, "loadMobileLeads (no leads page)", () => loadMobileLeads());
    await expectRefused("SALES", sales, "loadRoster (no workers page)", () => loadRoster());
    await expectAllowed("INSTALLER", installer, "getCalendarSeed (its schedule)", () => getCalendarSeed());
    await expectRefused("ESTIMATOR", estimator, "getCalendarSeed (no calendar page)", () => getCalendarSeed());
    await expectRefused("INSTALLER", installer, "sendTestNotification (Settings)", () => sendTestNotification());
    await expectRefused("INSTALLER", installer, "startPhoneVerification (Settings)", () => startPhoneVerification("2065550100"));
    await expectRefused("SALES", sales, "getHireViewer (Hire)", () => getHireViewer());
    await expectRefused("ESTIMATOR", estimator, "markBookingDone (Booking)", () => markBookingDone(booking.id));
    await expectRefused("ESTIMATOR", estimator, "clientProjectOptions (no clients page)", () => clientProjectOptions(client.id));
    await expectRefused("INSTALLER", installer, "proposalPickList (no proposals)", () => proposalPickList(proposal.id));
    await expectRefused("SALES", sales, "proposalPickList on the owner's proposal", () => proposalPickList(proposal.id));

    // ── the handheld Settings and Plans pages: closed like their desktop twins ──
    for (const route of ["/mobile-settings-v1", "/mobile-upgrade-v1"]) {
      for (const role of ROLES) {
        as(people[role]);
        setHeaders({ "x-pathname": route });
        let went: string;
        try {
          const r = await MobileLayout({ children: "PAGE" });
          went = r === "PAGE" ? "bare" : "page";
        } catch (err) {
          went = String((err as { digest?: string }).digest ?? (err as Error).message).includes("NEXT_REDIRECT") ? "redirect" : `error: ${(err as Error).message}`;
        }
        const open = role === "OWNER" || role === "MANAGER";
        check(`${role}: ${route} ${open ? "opens" : "sends it home"}`, open ? went === "page" : went === "redirect", went);
      }
    }
    setHeaders({});

    // ── the home folder: never the crew; a rep only onto their own proposal ──
    await expectRefused("INSTALLER", installer, "attachHomeFileToProposal", () => attachHomeFileToProposal({ fileId: file.id, proposalId: proposal.id }));
    await expectRefused("ESTIMATOR", estimator, "attachHomeFileToProposal (no leads page)", () => attachHomeFileToProposal({ fileId: file.id, proposalId: proposal.id }));
    await expectRefused("SALES", sales, "attachHomeFileToProposal onto the owner's proposal", () => attachHomeFileToProposal({ fileId: file.id, proposalId: proposal.id }));
    await expectRefused("INSTALLER", installer, "requestHomeFiles", () => requestHomeFiles({ leadId: "x" }));
    await expectAllowed("MANAGER", manager, "attachHomeFileToProposal", () => attachHomeFileToProposal({ fileId: file.id, proposalId: proposal.id }));

    // ── writes the installer must not make ──
    await expectRefused("INSTALLER", installer, "updateClient", () => clients.updateClient(client.id, { name: "x" }));
    await expectRefused("INSTALLER", installer, "updateProposalStatus", () => proposals.updateProposalStatus(proposal.id, "ACCEPTED" as never));
    await expectRefused("INSTALLER", installer, "markInstallmentPaid", () => installments.markInstallmentPaid({ installmentId: inst.id, method: "CASH" }));
    await expectRefused("INSTALLER", installer, "setJobProgress on a job not assigned to them", () => jobs.setJobProgress(job.id, "COMPLETED"));
    await expectRefused("INSTALLER", installer, "createJobPhoto on a job not assigned to them", () => jobMedia.createJobPhoto(job.id, { url: "https://example.com/x.jpg" }));
    await expectRefused("SALES", sales, "updateProposalStatus on the owner's proposal", () => proposals.updateProposalStatus(proposal.id, "ACCEPTED" as never));
    await expectRefused("ESTIMATOR", estimator, "duplicateProposal of the owner's proposal", () => proposals.duplicateProposal(proposal.id));

    // ── the pipeline (Smart CRM part 3, 2026-11-08): a rep moves only their own cards; the spend is the office's ──
    const repProposal = await db.proposal.create({ data: { organizationId: org.id, publicId: rid(), title: `Rep's proposal ${tag}`, clientId: client.id, status: "DRAFT", total: 4000, ownerId: sales.u.id } });
    const ownerCard = { key: `proposal:${proposal.id}`, stage: "NEGOTIATION" };
    await expectRefused("SALES", sales, "moveDealCard on the owner's proposal", () => pipeline.moveDealCard(ownerCard));
    await expectRefused("SALES", sales, "setDealCardDetails on the owner's proposal", () => pipeline.setDealCardDetails({ key: ownerCard.key, expectedClose: "2026-12-01" }));
    await expectRefused("ESTIMATOR", estimator, "moveDealCard (no pipeline page)", () => pipeline.moveDealCard(ownerCard));
    await expectRefused("INSTALLER", installer, "moveDealCard", () => pipeline.moveDealCard(ownerCard));
    await expectRefused("SALES", sales, "setSourceSpend (the office's report)", () => pipeline.setSourceSpend("facebook", 100));
    await expectAllowed("SALES", sales, "moveDealCard on their own proposal", () => pipeline.moveDealCard({ key: `proposal:${repProposal.id}`, stage: "NEGOTIATION" }));
    await expectAllowed("MANAGER", manager, "moveDealCard on the owner's proposal", () => pipeline.moveDealCard(ownerCard));
    await expectAllowed("OWNER", owner, "setSourceSpend", () => pipeline.setSourceSpend("facebook", null));
    check("SALES: the pipeline and inbox pages are open to a rep", mayOpen("SALES", "/dashboard/pipeline") && mayOpen("SALES", "/dashboard/inbox"));
    check("ESTIMATOR: the pipeline page is closed", !mayOpen("ESTIMATOR", "/dashboard/pipeline"));

    // ── manager vs owner ──
    await expectRefused("MANAGER", manager, "updateMembershipRole(self → OWNER)", () => team.updateMembershipRole(manager.m.id, "OWNER"));
    await expectRefused("MANAGER", manager, "updateMembershipRole(owner → INSTALLER)", () => team.updateMembershipRole(owner.m.id, "INSTALLER"));
    await expectRefused("MANAGER", manager, "removeMember(owner)", () => team.removeMember(owner.m.id));
    await expectRefused("MANAGER", manager, "createInvite(role OWNER)", () => team.createInvite({ email: `x-${tag}@qa.test`, role: "OWNER" }));
    await expectRefused("MANAGER", manager, "disconnectStripeConnect (owner-only money)", () => payConn.disconnectStripeConnect());
    await expectRefused("MANAGER", manager, "setStripeAchEnabled (owner-only money)", () => payConn.setStripeAchEnabled({ enabled: true }));

    // ── platform admin: an org OWNER is not one ──
    await expectRefused("OWNER (not platform admin)", owner, "setPlatformAdmin(self, true)", () => adminUsers.setPlatformAdmin(owner.u.id, true));
    check("OWNER's isPlatformAdmin flag is still off", !(await db.user.findUnique({ where: { id: owner.u.id } }))?.isPlatformAdmin);
    await expectRefused("OWNER (not platform admin)", owner, "getAdminUsersData", () => adminUsers.getAdminUsersData());
    await expectRefused("OWNER (not platform admin)", owner, "createAdminTask", () => adminTasks.createAdminTask({ title: "x" } as never));
    await expectRefused("OWNER (not platform admin)", owner, "getAdminTask", () => adminTasks.getAdminTask("x"));
    as(owner);
    const ch = await tasksChanges.GET(new Request(`http://local/api/admin/tasks/changes?since=${encodeURIComponent(new Date().toISOString())}`));
    check("OWNER (not platform admin): GET /api/admin/tasks/changes is 403", ch.status === 403, ch.status);
    actAs(null);
    const ch2 = await tasksChanges.GET(new Request(`http://local/api/admin/tasks/changes?since=${encodeURIComponent(new Date().toISOString())}`));
    check("signed out: GET /api/admin/tasks/changes is 401", ch2.status === 401, ch2.status);

    // ── Deck Studio: an ordinary org owner (no Deck plan, not admin) is turned away ──
    await expectRefused("OWNER (no Deck plan)", owner, "saveDeckDraft", () => deck.saveDeckDraft({ design: {} }));
    await expectRefused("OWNER (no Deck plan)", owner, "listDeckDrafts", () => deck.listDeckDrafts());
    await expectRefused("OWNER (no Deck plan)", owner, "updateDeckProposal", () => deck.updateDeckProposal({ proposalId: "x" }));
    await db.user.update({ where: { id: owner.u.id }, data: { isPlatformAdmin: true } });
    await expectAllowed("platform admin", owner, "listDeckDrafts", () => deck.listDeckDrafts());
    await db.user.update({ where: { id: owner.u.id }, data: { isPlatformAdmin: false } });

    // ── an influencer's session is not a user's ──
    (globalThis as { __auditSession?: unknown }).__auditSession = { user: { id: owner.u.id, principal: "INFLUENCER", influencerId: "x", activeOrgId: org.id } };
    const inf = await outcome(() => loadFinancials());
    check("INFLUENCER session: contractor actions refused", inf.refused, inf.text);
  } finally {
    const del = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* next */ } };
    await del(() => db.homeFile.deleteMany({ where: { homeId: home.id } }));
    await del(() => db.platformLead.delete({ where: { id: pl.id } }));
    await del(() => db.home.delete({ where: { id: home.id } }));
    await del(() => db.booking.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.activityEvent.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.jobExpense.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.job.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.installment.deleteMany({ where: { proposal: { organizationId: org.id } } }));
    await del(() => db.proposal.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.applicant.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.client.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.invite.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.workerProfile.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.membership.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.phoneVerification.deleteMany({ where: { userId: { in: ROLES.map((r) => people[r].u.id) } } }));
    await del(() => db.user.deleteMany({ where: { id: { in: ROLES.map((r) => people[r].u.id) } } }));
    await del(() => db.syncState.deleteMany({ where: { key: `crm:spend:${org.id}` } }));
    await del(() => db.organization.delete({ where: { id: org.id } }));
    await db.$disconnect();
  }
  process.exit(summary() ? 1 : 0);
}

void main();
