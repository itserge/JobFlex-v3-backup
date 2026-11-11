// Admin shell — the platform console's navigation map. ONE source of truth
// for the desktop sidebar and the handheld drawer (they are the same `.sb`
// markup; the donor's mobile layer turns it into a drawer below 860px).
//
// Plain data + pure functions, no "use client" — importable from the server
// layout as well as the client sidebar. Shaped like blueprint-shell/nav-map's
// NavSection so the sidebar markup can stay the donor's verbatim.
//
// Icons are sprite symbol ids from proposals-blueprint/sprite.tsx — the admin
// shell mounts that same sprite. Where no symbol fits the surface literally,
// the closest in meaning was taken; none are invented.

import type { NavSection } from "@/components/v3/blueprint-shell/nav-map";

export const ADMIN_HOME = "/admin";

export const ADMIN_NAV_SECTIONS: NavSection[] = [
  {
    label: "Platform",
    items: [
      { label: "Overview", icon: "i-grid", href: "/admin" },
      // The wall board for the office TV (2026-10-13) — today, live, no chrome.
      { label: "Office screen", icon: "i-chart", href: "/admin/office" },
      { label: "Traffic", icon: "i-chart", href: "/admin/traffic" },
      // Added 2026-10-12: the signups section of the traffic page, on its own page under it — the trials with a card
      // and without, in the order they end, the seven-day calendar, who started paying and how, what each trial did.
      { label: "Signups & trials", icon: "i-hourglass", href: "/admin/traffic/signups" },
      { label: "A/B testing", icon: "i-chart", href: "/admin/ab-testing" },
      // Added 2026-09-18: what each member did — proposals created and sent,
      // estimates made — counted per user, with the trail beneath.
      { label: "User activity", icon: "i-clock", href: "/admin/activity" },
      { label: "Subscribers", icon: "i-card", href: "/admin/subscribers" },
      { label: "Revenue", icon: "i-chart", href: "/admin/revenue" },
      // Added 2026-10-21: why plan charges fail and how many come back — its own page under Revenue
      // (lib/paymentFailures), read from the database, not from Stripe.
      { label: "Failed payments", icon: "i-card", href: "/admin/revenue/failed-payments" },
      // Added 2026-09-24: the trials to look at — accounts touring the product
      // to copy it, read off how they behave (lib/trialWatch).
      { label: "Trial watch", icon: "i-eye", href: "/admin/trials" },
      // Added 2026-10-22: what each company's use of the paid APIs costs us — every company, not only
      // trials — and the ones we pay more for than they pay us (lib/apiSpend, lib/apiUsageReport).
      { label: "API usage", icon: "i-chart", href: "/admin/usage" },
      // Added 2026-10-22: customer development — the four steps, hypotheses with live evidence, segments, the voice
      // of the customer (support emails, cancellation reasons, trial notes) and the interview log (lib/custDev).
      { label: "Customer development", icon: "i-target", href: "/admin/customer-development" },
      // Added 2026-10-06: the figures for investors — ad spend, trials, what
      // they are worth, and when the ads pay for themselves — with a shared
      // link and a PDF (lib/investors).
      { label: "Investors", icon: "i-building", href: "/admin/investors" },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Users & subscriptions", icon: "i-users", href: "/admin/users" },
      // Added 2026-10-20: owners on a trial asking for more days from the
      // cancel window — approve 7/14 days or deny; the badge is the open ones.
      { label: "Trial requests", icon: "i-hourglass", href: "/admin/trial-requests" },
      // Added 2026-10-20: every cancellation with the reasons the owner ticked.
      { label: "Cancellations", icon: "i-ban", href: "/admin/cancellations" },
      { label: "Plans", icon: "i-file", href: "/admin/plans" },
      { label: "Influencers", icon: "i-megaphone", href: "/admin/influencers" },
      { label: "Payouts", icon: "i-bank", href: "/admin/payouts" },
      // Added 2026-10-28: Wisetack financing — who sees it (off / pilot / everyone), who applied, the clients' loans.
      { label: "Financing", icon: "i-bank", href: "/admin/financing" },
      { label: "Referrals", icon: "i-gift", href: "/admin/referrals" },
    ],
  },
  {
    label: "Operate",
    items: [
      { label: "Lead Center", icon: "i-target", href: "/admin/lead-center" },
      { label: "Outreach calls", icon: "i-phone", href: "/admin/outreach" },
      { label: "Support", icon: "i-msg", href: "/admin/support" },
      // Added 2026-10-21: every letter the platform sent, failed or skipped (lib/emailLog).
      { label: "Sent mail", icon: "i-send", href: "/admin/mail/log" },
      // Added 2026-11-11: the do-not-email list (lib/mailBlock) — who asked us to stop, add or remove an address.
      { label: "Do not email", icon: "i-ban", href: "/admin/mail/blocked" },
      // Added 2026-10-11: the platform team's own tasks, live between admins;
      // the badge is the open tasks given to whoever is signed in.
      { label: "Tasks", icon: "i-board", href: "/admin/tasks" },
      { label: "Health", icon: "i-check", href: "/admin/health" },
      // Added 2026-11-06: the AI Operator's capability registry — every tool's state, use and failures, the kill switch.
      { label: "AI Operator", icon: "i-msg", href: "/admin/assistant" },
      { label: "Integrations", icon: "i-link", href: "/admin/integrations" },
      // Texting is the one integration set up for every contractor at once
      // (2026-09-24) — a door of its own beside Integrations.
      { label: "Texting", icon: "i-phone", href: "/admin/integrations/twilio" },
      { label: "Announcements", icon: "i-bell", href: "/admin/announcements" },
      { label: "Campaigns", icon: "i-send", href: "/admin/campaigns" },
      { label: "Specialties", icon: "i-box", href: "/admin/specialties" },
      // Added 2026-09-18: the Smart Proposal prompts — see the current text,
      // change it, preview the exact prompt a brief produces.
      { label: "Prompts", icon: "i-pen", href: "/admin/prompts" },
    ],
  },
];

/**
 * The nav item that owns `pathname`: exact match for the Overview root, longest
 * prefix match for everything else so child routes (/admin/users/[id]) keep
 * their parent lit. Null when nothing in the map claims the path.
 */
export function activeAdminHref(pathname: string): string | null {
  let best: string | null = null;
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.href === ADMIN_HOME) {
        if (pathname === ADMIN_HOME && best === null) best = item.href;
        continue;
      }
      const hit = pathname === item.href || pathname.startsWith(item.href + "/");
      if (hit && (best === null || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}
