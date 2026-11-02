// Every app page SmartHelp may link to (a guide step's `open`, or an AI answer).
// A path the model invents is not in this list and is dropped. Settings panes are
// links like /dashboard/settings?pane=payments; pathOf() strips the query for route checks.

export const HELP_PAGES: ReadonlyArray<{ path: string; name: string }> = [
  { path: "/dashboard", name: "Overview" },
  { path: "/dashboard/roof-estimator", name: "Roof estimator" },
  { path: "/dashboard/fence-estimator", name: "Fence estimator" },
  { path: "/dashboard/hvac-estimator", name: "HVAC estimator" },
  { path: "/dashboard/deck-estimator", name: "Deck Studio" },
  { path: "/dashboard/lawn-estimator", name: "Landscape estimator" },
  { path: "/dashboard/video-estimator", name: "Video estimator" },
  { path: "/dashboard/blueprint-estimator", name: "Blueprint estimator" },
  { path: "/dashboard/manual-blueprint", name: "Manual proposal" },
  { path: "/dashboard/proposals", name: "Proposals" },
  { path: "/dashboard/clients", name: "Clients" },
  { path: "/dashboard/leads", name: "Leads" },
  { path: "/dashboard/projects", name: "Projects" },
  { path: "/dashboard/crm", name: "CRM" },
  { path: "/dashboard/calendar", name: "Calendar" },
  { path: "/dashboard/booking", name: "Online booking" },
  { path: "/dashboard/jobs", name: "Jobs" },
  { path: "/dashboard/workers", name: "Workers" },
  { path: "/dashboard/company", name: "Company" },
  { path: "/dashboard/company/team", name: "Company team" },
  { path: "/dashboard/company/landing", name: "Company website" },
  { path: "/dashboard/phone", name: "AI desk" },
  { path: "/dashboard/phone?tab=settings", name: "AI desk settings" },
  { path: "/dashboard/texting", name: "Texting" },
  { path: "/dashboard/messages", name: "Messages" },
  { path: "/dashboard/reviews", name: "Reviews" },
  { path: "/dashboard/reports", name: "Reports" },
  { path: "/dashboard/financials", name: "Financials" },
  { path: "/dashboard/financials/invoices", name: "Invoices" },
  { path: "/dashboard/service-plans", name: "Service plans" },
  { path: "/dashboard/inventory", name: "Inventory" },
  { path: "/dashboard/support", name: "Support" },
  { path: "/dashboard/settings", name: "Settings" },
  { path: "/dashboard/settings?pane=account", name: "Settings: Account" },
  { path: "/dashboard/settings?pane=payments", name: "Settings: Payments" },
  { path: "/dashboard/settings?pane=billing", name: "Settings: Billing" },
  { path: "/dashboard/settings?pane=integrations", name: "Settings: Integrations" },
  { path: "/dashboard/settings?pane=notifications", name: "Settings: Notifications" },
  { path: "/dashboard/settings?pane=estimating", name: "Settings: Estimating" },
  { path: "/dashboard/settings?pane=website", name: "Settings: Website" },
  { path: "/dashboard/subscription", name: "Subscription" },
  // Added with the guides (Task 2): the AI desk opens on the step its address names (desk-overview firstTab, ?step=),
  // Smart Proposal's own page, and the Meta leads tab of Integrations (settings-content reads ?sub=).
  { path: "/dashboard/phone?tab=settings&step=numbers", name: "AI desk: Phone & forwarding" },
  { path: "/dashboard/phone?tab=settings&step=business", name: "AI desk: Your business" },
  { path: "/dashboard/phone?tab=settings&step=booking", name: "AI desk: Booking" },
  { path: "/dashboard/phone?tab=settings&step=voice", name: "AI desk: Voice & test" },
  { path: "/dashboard/advanced-ai", name: "Smart Proposal" },
  { path: "/dashboard/settings?pane=integrations&sub=meta", name: "Settings: Meta business leads" },
  // The "Get paid online" guide's first step (guides.ts): Integrations → Stripe.
  { path: "/dashboard/settings?pane=integrations&sub=stripe", name: "Settings: Stripe" },
  // SmartBook (2026-10-31): its own Settings item (settings-data RailKey "smartbook").
  { path: "/dashboard/settings?pane=smartbook", name: "Settings: SmartBook" },
];

/** The route part of an app link: drops ?query and #hash. */
export function pathOf(open: string): string {
  return open.split("#")[0].split("?")[0];
}

/** True when `open` is a page SmartHelp may link to. A link with a query must match a listed
 *  pane exactly (hash ignored), so an invented pane is refused. */
export function isHelpPage(open: string): boolean {
  const noHash = open.split("#")[0];
  return HELP_PAGES.some((p) => p.path === noHash);
}
