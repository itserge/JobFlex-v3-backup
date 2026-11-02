import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isEstimatorRole, isSalesRole, isWorkerRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { longDate } from "@/lib/format";
import { toE164 } from "@/lib/phone";
import { isPageLocked } from "@/lib/customPageAccess";
import { viewerTimeZone } from "@/lib/viewerTz";
import { contactsLocked } from "@/lib/leadCenter/contacts";
import { callInProgress, leadCallBlocker, readLeadCall, type LeadCall } from "@/lib/aiDesk/leadCalls";
import { LeadDetailContent } from "@/components/v3/lead-detail-blueprint/lead-detail-content";
import type { LeadCallRow, LeadVisit, LeadVisitsProps } from "@/components/v3/lead-detail-blueprint/lead-visits";
import { contractorFolder, listFolder } from "@/lib/home/files";
import { findClientForLead } from "@/lib/leadClient";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { HANDOFF_WORDS, WEB_LEAD_SOURCE, WEB_TRADE, bandWords } from "@/lib/webEstimator";
import { readWebLead } from "@/lib/webEstimatorServer";
import { leadSmartBook } from "@/lib/smartbook/office";

// ONE LEAD (2026-09-22) — under the blueprint shell, the same design as the
// Leads list it opens from. Session-scoped, never static.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Lead",
  description: "One lead — the scope of work, the homeowner's words, and the estimators.",
};

/** "9:00–10:00 AM", "11:30 AM–12:30 PM" — a visit's hours in the company's zone. */
function hoursWords(start: Date, end: Date, timeZone: string): string {
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const a = t(start);
  const b = t(end);
  const half = (s: string) => s.slice(-2);
  return half(a) === half(b) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

/** `2026-10-31` in the company's zone — the calendar's `?date=`. */
function localDate(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const TEXTED: Record<NonNullable<LeadCall["texted"]>, string> = {
  sent: "text with how to book sent",
  held: "the text goes out in the morning",
  "not-allowed": "no text — they haven't agreed to texts",
  failed: "the text didn't go",
};

/** The desk's latest call to this lead, in words, from its state (lib/aiDesk/leadCalls). */
function deskCallWords(c: LeadCall): Pick<LeadCallRow, "label" | "tone" | "detail"> {
  const texted = c.texted ? TEXTED[c.texted] : null;
  const how = c.auto ? "automatic" : null;
  const detail = (...xs: Array<string | null>) => xs.filter(Boolean).join(" · ") || null;
  switch (c.status) {
    case "calling":
      return { label: "Calling now", tone: "info", detail: detail(how) };
    case "talking":
      return { label: "On the line now", tone: "info", detail: detail(how) };
    case "voicemail":
      return { label: "Voicemail left", tone: "warn", detail: detail(how, texted) };
    case "no-answer":
      return { label: "No answer", tone: "warn", detail: detail(how, texted) };
    case "busy":
      return { label: "Line busy", tone: "warn", detail: detail(how, texted) };
    case "failed":
      return { label: "Didn't connect", tone: "bad", detail: detail(how, c.error) };
    default:
      if (c.dnc) return { label: "Asked not to be called", tone: "bad", detail: detail(how) };
      return {
        label: c.result === "booked" ? "Booked a visit" : c.result === "message" ? "Took a message" : c.result === "transfer" ? "Put through to the office" : c.result === "talked" ? "Talked with them" : "Call ended",
        tone: c.result ? "ok" : "info",
        detail: detail(how, c.seconds ? `${Math.max(1, Math.round(c.seconds / 60))} min` : null),
      };
  }
}

/** Visits & calls on the lead page: its visits (next first), the desk's calls, who may book or have the desk call. */
async function visitsFor(input: {
  organizationId: string;
  role: string;
  userId: string;
  lead: { id: string; name: string; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; projectType: string | null; aiCategory: string | null };
}): Promise<LeadVisitsProps> {
  const { organizationId, role, userId, lead } = input;
  // The calendar's own rule (actions/appointments): owners, managers and sales reps book; estimators and crew read.
  const canAct = !isWorkerRole(role) && !isEstimatorRole(role);
  const now = new Date();
  const [org, appts, calls, deskCall, calendarLocked, crewRows] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.appointment.findMany({
      where: { organizationId, leadId: lead.id },
      orderBy: { startsAt: "desc" },
      take: 12,
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true, assignments: { select: { worker: { select: { displayName: true } } } } },
    }),
    db.aiPhoneCall.findMany({
      where: { organizationId, leadId: lead.id },
      orderBy: { startedAt: "desc" },
      take: 8,
      select: { id: true, direction: true, status: true, startedAt: true, summary: true, callSid: true },
    }),
    readLeadCall(lead.id),
    isPageLocked(organizationId, "calendar").catch(() => false),
    // A sales rep may staff only themselves (actions/appointments filterWorkerIdsForRole).
    canAct
      ? db.workerProfile.findMany({
          where: { organizationId, inviteStatus: { not: "DECLINED" }, ...(isSalesRole(role) ? { userId } : {}) },
          select: { id: true, displayName: true },
          orderBy: { displayName: "asc" },
          take: 40,
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
  ]);
  // The viewer's zone, as the calendar reads it (the `tz` cookie, else the company's) — the sheet books in it too.
  const tz = await viewerTimeZone(org?.timezone);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-US", { ...o, timeZone: tz });
  // The next visit first (soonest ahead), then the rest newest first.
  const ahead = appts.filter((a) => a.endsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = appts.filter((a) => a.endsAt <= now);
  const visits: LeadVisit[] = [...ahead, ...past].map((a) => ({
    id: a.id,
    title: a.title,
    when: `${fmt(a.startsAt, { weekday: "short", month: "short", day: "numeric" })} · ${hoursWords(a.startsAt, a.endsAt, tz)}`,
    mon: fmt(a.startsAt, { month: "short" }),
    day: fmt(a.startsAt, { day: "numeric" }),
    wkd: fmt(a.startsAt, { weekday: "short" }),
    status: a.status,
    upcoming: a.endsAt > now,
    crew: a.assignments.map((x) => x.worker.displayName),
    date: localDate(a.startsAt, tz),
  }));
  const callRows: LeadCallRow[] = calls.map((c) => {
    const when = fmt(c.startedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    if (deskCall && c.callSid === deskCall.sid) return { id: c.id, when, ...deskCallWords(deskCall) };
    if (c.direction === "INBOUND") return { id: c.id, when, label: "They called the desk", tone: "info", detail: c.summary };
    return { id: c.id, when, label: c.summary || "The desk called them", tone: c.status === "FAILED" ? "bad" : "info", detail: null };
  });
  // A call placed but not yet written as a row (or Twilio refused it): its state still says so.
  if (deskCall && !calls.some((c) => c.callSid === deskCall.sid)) {
    callRows.unshift({ id: `state:${deskCall.at}`, when: fmt(new Date(deskCall.at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), ...deskCallWords(deskCall) });
  }
  const deskShow = canAct && !!toE164(lead.phone ?? "");
  const where = [lead.address, lead.city, [lead.state, lead.zip].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(", ");
  return {
    leadId: lead.id,
    leadName: lead.name,
    tz,
    defaults: {
      title: "Estimate visit",
      notes: [`Lead: ${lead.name}${lead.phone ? ` · ${lead.phone}` : ""}`, where ? `Address: ${where}` : null, lead.projectType || lead.aiCategory ? `Project: ${lead.projectType || lead.aiCategory}` : null]
        .filter(Boolean)
        .join("\n"),
    },
    visits,
    canSchedule: canAct,
    scheduleOff: calendarLocked ? "The calendar isn't on your plan, so visits can't be booked here." : null,
    crew: crewRows.map((w) => ({ id: w.id, name: w.displayName })),
    desk: {
      show: deskShow,
      blocker: deskShow ? await leadCallBlocker(organizationId, lead.id, tz, now).catch(() => "The desk can't call right now.") : null,
      live: callInProgress(deskCall, now),
    },
    calls: callRows,
  };
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await customPageGate("leads");
  if (gate) return gate;
  const { id } = await params;
  const scopeFailed = (await searchParams)?.scope === "failed";
  let organizationId: string;
  let role: string;
  let userId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
    userId = ctx.user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(`/dashboard/leads/${id}`)}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const lead = await db.lead.findUnique({ where: { id }, include: { assignedTo: { select: { name: true, email: true } } } });
  if (!lead || lead.organizationId !== organizationId) notFound();
  // Sales reps can only open leads that are theirs (assigned/claimed) or NEW.
  if (isSalesRole(role) && lead.assignedToId !== userId && lead.claimedById !== userId && lead.status !== "NEW") {
    notFound();
  }
  // A legacy hand-routed lead the shop has not claimed: city and scope only,
  // and nothing to price yet — the estimators would carry the street with them.
  const locked = contactsLocked(lead);
  // A lead this shop paid to open: the amount, the date, and the support line.
  const paidOffer =
    lead.source === "LEAD_CENTER"
      ? await db.leadOffer.findFirst({
          where: { organizationId, unlockedAt: { not: null }, priceCents: { gt: 0 }, platformLead: { matchedLeadId: lead.id } },
          select: { priceCents: true, unlockedAt: true },
        })
      : null;
  // THE JOB FOLDER (2026-10-03, lib/home/files): a Lead Center lead carries the
  // homeowner's folder — their pictures, videos and PDFs — and the proposals
  // of this client a picture could go on.
  let folder: { leadId: string; homeownerFirstName: string; files: Awaited<ReturnType<typeof listFolder>>["files"]; requests: Awaited<ReturnType<typeof listFolder>>["requests"]; proposals: Array<{ id: string; title: string; status: string }> } | null = null;
  if (!locked) {
    const door = await contractorFolder(organizationId, lead.id).catch(() => null);
    if (door) {
      const [{ files, requests }, client] = await Promise.all([listFolder(door.pl.id, null), findClientForLead(organizationId, { email: lead.email, phone: lead.phone })]);
      const proposals = client ? await db.proposal.findMany({ where: { organizationId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, status: true } }) : [];
      folder = { leadId: lead.id, homeownerFirstName: door.home.name.trim().split(/\s+/)[0] || "the homeowner", files, requests, proposals };
    }
  }
  // A lead from the shop's website estimator (lib/webEstimator): what the homeowner saw, for the card and the hand-off.
  // …or a Lead Center lead the homeowner priced in a house estimator (2026-10-28): Accept copied the same record onto it.
  const web = lead.source === WEB_LEAD_SOURCE || lead.source === "LEAD_CENTER" ? await readWebLead(lead.id).catch(() => null) : null;
  const website = web
    ? { trade: web.trade, estimator: WEB_TRADE[web.trade].name.replace(" on your website", ""), summary: web.estimate.summary, choice: web.estimate.choice, price: bandWords(web.estimate.band), show: web.estimate.show, note: web.contact.note, handoff: HANDOFF_WORDS[web.trade], house: lead.source !== WEB_LEAD_SOURCE }
    : null;
  // VISITS & CALLS (2026-10-31): book the visit and have the AI desk call — not while the contacts are withheld.
  const visits = locked ? null : await visitsFor({ organizationId, role, userId, lead });
  // SmartBook's card (2026-10-31): for the roles that work leads, once the contacts are open.
  const smartbook = !locked && !isWorkerRole(role) && !isEstimatorRole(role) ? await leadSmartBook(organizationId, lead.id).catch(() => null) : null;
  return (
    <LeadDetailContent
      visits={visits}
      smartbook={smartbook}
      website={website}
      folder={folder}
      lead={{
        id: lead.id,
        name: lead.name,
        email: locked ? null : lead.email,
        phone: locked ? null : lead.phone,
        address: locked ? null : lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        projectType: lead.projectType,
        description: lead.description,
        scope: lead.scope,
        status: lead.status,
        source: lead.source,
        aiCategory: lead.aiCategory,
        aiConfidence: lead.aiConfidence,
        assignee: lead.assignedTo?.name ?? lead.assignedTo?.email ?? null,
        created: longDate(lead.createdAt),
      }}
      canEstimate={!locked && !isSalesRole(role) && !isWorkerRole(role)}
      contactsLocked={locked}
      paid={
        paidOffer?.priceCents && paidOffer.unlockedAt
          ? { amount: `$${(paidOffer.priceCents / 100).toFixed(2)}`, when: longDate(paidOffer.unlockedAt) }
          : null
      }
      scopeFailed={scopeFailed}
    />
  );
}
