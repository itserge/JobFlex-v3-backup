// WHAT EACH ROLE MAY ASK THE ASSISTANT (2026-11-04) — pure, so the checks pin it
// (qa/tests/logic/assistant.check.ts). The same lines the dashboard's guards
// draw (lib/orgContext): field workers have their crew portal, not this; SALES
// and ESTIMATOR see and send their own proposals; the calendar's, the crew's
// and the payments' actions are managers'; money is the Financials page's; pricing a
// job is the estimators' and the managers' (requireEstimatorOrManager), never SALES.
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";

/** Every capability a tool can ask for — a value, so the registry check can see that a tool's `need` is one of them. */
export const CAPABILITIES = [
  "today", // the CRM brief: every office and pipeline role (it scopes itself)
  "proposals.read",
  "proposals.send",
  "schedule.read",
  "schedule.write",
  "crew.read",
  "crew.text",
  "money.read",
  "payments.remind",
  "estimates.build", // price a job into a draft proposal (requireEstimatorOrManager: never SALES)
  // Batches 1–2 (2026-11-05): the Clients, Leads and calendar pages' writes (requireSalesOrManager: never ESTIMATOR),
  // a reminder to oneself (anyone with the Operator), and money — invoices and financing links — managers only.
  "clients.write",
  "clients.read", // the client's story and page (Smart CRM part 1, 2026-11-08): whoever may open /dashboard/clients
  "leads.write",
  "visits.write",
  "reminders",
  "invoices.send",
  "financing.send",
  // The stages build (2026-11-05): projects are estimators' and managers' (requireEstimatorOrManager), never SALES'.
  "projects.read",
  "projects.write",
  // The subcontractors plan, part 6 (2026-11-09): recording a payment to a sub — owners and managers (requireManager),
  // like the Invoices tab's Record the payment.
  "subs.pay",
  // Smart CRM part 6 (2026-11-10): lists of past clients and campaigns to them — owners and managers (requireManager),
  // like the CRM's Bring back tab: a campaign writes to the company's whole book in the company's name.
  "clients.campaign",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const LIMITED = new Set(["INSTALLER", "SALES", "ESTIMATOR"]);

/** May this role open one of these pages (lib/roleRoutes)? Full office roles have no gate. */
function mayOpen(role: string, route: string): boolean {
  const gate = ROLE_ROUTE_GATES[role];
  return !gate || isPathAllowed(gate, route);
}

export function roleAllows(role: string, need: Capability): boolean {
  if (role === "INSTALLER") return false;
  const manager = !LIMITED.has(role);
  switch (need) {
    case "today":
    case "proposals.read":
    case "proposals.send":
      return true;
    case "schedule.read":
      return mayOpen(role, "/dashboard/calendar");
    case "crew.read":
      return manager || mayOpen(role, "/dashboard/workers");
    case "schedule.write":
    case "crew.text":
    case "payments.remind":
      return manager;
    case "money.read":
      return manager && mayOpen(role, "/dashboard/financials");
    case "estimates.build":
      return role !== "SALES";
    case "clients.write":
      return role !== "ESTIMATOR";
    case "clients.read":
      return mayOpen(role, "/dashboard/clients");
    case "leads.write":
      return role !== "ESTIMATOR" && mayOpen(role, "/dashboard/leads");
    case "visits.write":
      return role !== "ESTIMATOR" && mayOpen(role, "/dashboard/calendar");
    case "reminders":
      return true;
    case "invoices.send":
    case "financing.send":
      return manager;
    case "projects.read":
      return mayOpen(role, "/dashboard/projects");
    case "projects.write":
      return role !== "SALES" && mayOpen(role, "/dashboard/projects");
    case "subs.pay":
      return manager && mayOpen(role, "/dashboard/projects");
    case "clients.campaign":
      return manager && mayOpen(role, "/dashboard/crm");
  }
}

/** SALES and ESTIMATOR see and send only their own proposals (requireProposalStaff). */
export function ownProposalsOnly(role: string): boolean {
  return role === "SALES" || role === "ESTIMATOR";
}
