import "server-only";
// ALERTS THE AI OPERATOR SENDS ON ITS OWN (2026-11-05, batch 3), to the people
// who turned them on (lib/assistant/prefs): a client opened a proposal (the
// first look — the portal page says so, once), and a new lead came in (not one
// the office typed in). A line in the Operator always; a text to the linked
// phone except between 9 PM and 7 AM on the company's clock, and at most a
// dozen an hour. Every word is the code's: these never ask the model anything.
import { db } from "@/lib/db";
import { actorFor } from "@/lib/assistant/actor";
import { isPageLocked } from "@/lib/customPageAccess";
import { ownProposalsOnly } from "@/lib/assistant/roles";
import { allPrefs } from "@/lib/assistant/prefs";
import { linkOf } from "@/lib/assistant/phone";
import { sendAssistantText } from "@/lib/assistant/sms";
import { money, quietHours } from "@/lib/assistant/shared";
import { rateLimitShared } from "@/lib/rateLimit";
import { leadSourceOf } from "@/lib/leads/sources";

const PER_HOUR = 12;
const HOUR = 60 * 60_000;

async function tell(organizationId: string, userId: string, text: string, kind: string, now: Date, tz: string): Promise<boolean> {
  const limit = await rateLimitShared(`assistant:alert:${userId}`, PER_HOUR, HOUR).catch(() => ({ ok: false }));
  if (!limit.ok) return false;
  await db.assistantMessage.create({ data: { organizationId, userId, channel: "app", direction: "OUT", body: text.slice(0, 4000) } });
  if (quietHours(now, tz)) return true;
  const link = await linkOf(organizationId, userId).catch(() => null);
  if (link?.active) await sendAssistantText(link.phone, text, kind).catch(() => false);
  return true;
}

/** The client's first look at a proposal — the portal page calls this once, after the response. */
export async function alertProposalOpened(proposalId: string, now = new Date()): Promise<number> {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { organizationId: true, ownerId: true, title: true, total: true, currency: true, client: { select: { name: true } }, organization: { select: { timezone: true, deletedAt: true } } },
  });
  if (!p || p.organization.deletedAt) return 0;
  // Paused on the Free plan (owner, 2026-11-09): no alert, nothing texted — the company's plan decides.
  if (await isPageLocked(p.organizationId, "operator", { as: null })) return 0;
  const people = (await allPrefs(p.organizationId)).filter((x) => x.prefs.alerts.proposalOpened);
  if (!people.length) return 0;
  const who = p.client?.name ?? "The client";
  const text = `${who} just opened "${p.title}" (${money(p.total, p.currency)}) — their first look. Ask me any time whether it's signed.`;
  let n = 0;
  for (const person of people) {
    const actor = await actorFor(p.organizationId, person.userId, "app").catch(() => null);
    if (!actor) continue;
    // Sales and estimators hear about their own proposals only, as on the Proposals page.
    if (ownProposalsOnly(actor.role) && p.ownerId !== person.userId) continue;
    if (await tell(p.organizationId, person.userId, text, "jobflex-assistant-alert", now, actor.timezone)) n += 1;
  }
  return n;
}

/** A lead that came in from outside — the website, Lead Center, a call, Meta; never one typed in by hand. */
export async function alertNewLead(leadId: string, now = new Date()): Promise<number> {
  const l = await db.lead.findUnique({
    where: { id: leadId },
    select: { organizationId: true, name: true, projectType: true, source: true, phone: true, city: true, state: true, assignedToId: true, organization: { select: { deletedAt: true } } },
  });
  if (!l || l.organization.deletedAt) return 0;
  if (await isPageLocked(l.organizationId, "operator", { as: null })) return 0;
  if (!l.source || ["MANUAL", "IMPORT"].includes(l.source)) return 0;
  const people = (await allPrefs(l.organizationId)).filter((x) => x.prefs.alerts.newLead);
  if (!people.length) return 0;
  const place = [l.city, l.state].filter(Boolean).join(", ");
  const first = l.name.trim().split(/\s+/)[0] || "them";
  const text = `New lead: ${l.name} — ${l.projectType ?? "an inquiry"}${place ? `, ${place}` : ""} (${leadSourceOf(l.source).label}). Say "book a visit with ${first}" when you've reached them.`;
  let n = 0;
  for (const person of people) {
    const actor = await actorFor(l.organizationId, person.userId, "app").catch(() => null);
    if (!actor) continue;
    // A rep hears about leads assigned to them; the office hears about every one.
    if (ownProposalsOnly(actor.role) && l.assignedToId !== person.userId) continue;
    if (await tell(l.organizationId, person.userId, text, "jobflex-assistant-alert", now, actor.timezone)) n += 1;
  }
  return n;
}
