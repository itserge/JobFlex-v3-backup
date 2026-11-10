import "server-only";
// THE CLIENT'S HOME PAGE, ON THE SERVER (2026-11-10, Smart CRM part 5).
//
//   clientHomeLink   — the office's: the client's lasting link (made on first use) and when they last opened it.
//   replaceHomeLink  — a new link; the old one stops working (a link forwarded to the wrong person).
//   clientHomeView   — the page: everything the client may see, read through the links each piece already has
//                      (a proposal's /portal/q, a change order's /co, a project's /p, a plan's /plan, a visit report's
//                      /report, a review's /review), so the rules of what a client sees stay where they are.
//   postHomeMessage  — the client writes from their page: on their thread in the Inbox (PORTAL), read like any
//                      message, the office told (bell + email + text by each member's own switches).
//
// What the client NEVER sees here: a draft or archived proposal, the company's costs, crew pay, internal notes.

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { contractSchedule, contractTotal } from "@/lib/contractTotal";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { parseBookingSettings } from "@/lib/booking";
import { dayWords, clockWords } from "@/lib/assistant/shared";
import { fileInboundPortal } from "@/lib/inbox/server";
import { textOffice } from "@/lib/sms/send";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { buildClientPageMessage } from "@/lib/email/build/operator";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { cleanMessage, isHomeToken, MESSAGES_PER_HOUR, openedWords, proposalWords } from "@/lib/clientHome/shared";

const newToken = () => randomBytes(18).toString("base64url"); // 24 URL-safe characters

async function base(): Promise<string> {
  return (await appBaseUrl()).replace(/\/$/, "");
}

/** The client's link, made the first time it is asked for. Office only (the caller checks). */
export async function clientHomeLink(organizationId: string, clientId: string): Promise<{ href: string; opened: string; phone: string | null; email: string | null; name: string }> {
  const c = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true, name: true, phone: true, email: true, homeToken: true, homeViewedAt: true } });
  if (!c) throw new Error("Not found");
  let token = c.homeToken;
  if (!isHomeToken(token)) {
    token = newToken();
    await db.client.update({ where: { id: c.id }, data: { homeToken: token } });
  }
  return { href: `${await base()}/c/${token}`, opened: openedWords(c.homeViewedAt), phone: c.phone, email: c.email, name: c.name };
}

/** A new link; the old one stops. */
export async function replaceHomeLink(organizationId: string, actorId: string, clientId: string): Promise<{ href: string }> {
  const c = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true, name: true } });
  if (!c) throw new Error("Not found");
  const token = newToken();
  await db.client.update({ where: { id: c.id }, data: { homeToken: token, homeViewedAt: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.CLIENT, clientId: c.id, summary: `Replaced ${c.name}'s page link — the old one no longer opens` });
  return { href: `${await base()}/c/${token}` };
}

export type HomeProposal = { id: string; title: string; label: string; tone: "wait" | "ok" | "done" | "off"; contract: number; paid: number; left: number; late: boolean; href: string; payHref: string | null; payAmount: number; pdfHref: string; when: string };
export type HomeItem = { title: string; when: string; href: string | null; note?: string | null };
export type HomeMessage = { id: string; mine: boolean; body: string; when: string; via: string };

export type ClientHomeView = {
  token: string;
  org: { name: string; logoUrl: string | null; phone: string | null; email: string | null; bookHref: string | null };
  client: { name: string };
  money: { contract: number; paid: number; left: number };
  proposals: HomeProposal[];
  waiting: HomeItem[];
  projects: HomeItem[];
  upcoming: HomeItem[];
  plans: HomeItem[];
  documents: HomeItem[];
  review: string | null;
  messages: HomeMessage[];
  canWrite: boolean;
};

/** The page. `stamp` marks it opened (not when the office previews it). Null when the token is not a live link. */
export async function clientHomeView(token: string, opts: { stamp: boolean; now?: Date } = { stamp: true }): Promise<ClientHomeView | null> {
  if (!isHomeToken(token)) return null;
  const now = opts.now ?? new Date();
  const c = await db.client.findFirst({
    where: { homeToken: token, deletedAt: null },
    select: { id: true, name: true, organizationId: true, organization: { select: { name: true, logoUrl: true, phone: true, billingEmail: true, slug: true, timezone: true, bookingSettingsJson: true } } },
  });
  if (!c) return null;
  if (opts.stamp) await db.client.update({ where: { id: c.id }, data: { homeViewedAt: now } }).catch(() => undefined);
  const org = c.organization;
  const tz = org.timezone || "America/New_York";
  const b = await base();
  const when = (d: Date) => `${dayWords(d, tz)} at ${clockWords(d, tz)}`;
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(d);
  const where = { organizationId: c.organizationId, clientId: c.id };

  const [proposals, waitingCos, projects, visits, days, plans, reports, reviews, thread] = await Promise.all([
    db.proposal.findMany({
      where: { ...where, status: { notIn: ["DRAFT", "ARCHIVED"] } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, title: true, status: true, publicId: true, total: true, currency: true, canceledAt: true, sentAt: true, acceptedAt: true, createdAt: true, installments: { orderBy: { position: "asc" } }, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
    }),
    db.changeOrder.findMany({ where: { organizationId: c.organizationId, status: "SENT", proposal: { clientId: c.id } }, orderBy: { sentAt: "desc" }, take: 10, select: { title: true, number: true, total: true, amount: true, publicToken: true, sentAt: true } }),
    db.project.findMany({ where: { ...where, status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, take: 10, select: { name: true, status: true, publicToken: true, sharedAt: true } }),
    db.appointment.findMany({ where: { ...where, startsAt: { gte: now }, status: { notIn: ["CANCELED", "NO_SHOW"] } }, orderBy: { startsAt: "asc" }, take: 6, select: { title: true, startsAt: true } }),
    db.jobEvent.findMany({ where: { organizationId: c.organizationId, startsAt: { gte: now }, job: { clientId: c.id, status: { not: "CANCELED" } } }, orderBy: { startsAt: "asc" }, take: 6, select: { title: true, startsAt: true, job: { select: { title: true } } } }),
    db.servicePlan.findMany({ where: { ...where, status: { in: ["SENT", "ACTIVE"] } }, orderBy: { createdAt: "desc" }, take: 5, select: { name: true, status: true, acceptToken: true, visits: { where: { status: "SCHEDULED", dueAt: { gte: now } }, orderBy: { dueAt: "asc" }, take: 1, select: { label: true, dueAt: true } } } }),
    db.visitReport.findMany({ where: { ...where, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: 10, select: { publicToken: true, sentAt: true } }),
    db.reviewRequest.findMany({ where: { ...where, status: "SENT", hiddenAt: null }, orderBy: { sentAt: "desc" }, take: 1, select: { publicToken: true } }),
    db.clientThread.findUnique({ where: { organizationId_clientId: { organizationId: c.organizationId, clientId: c.id } }, select: { id: true } }),
  ]);

  let contract = 0;
  let paid = 0;
  let left = 0;
  const props: HomeProposal[] = [];
  for (const p of proposals) {
    const words = p.canceledAt ? { label: "Cancelled", tone: "off" as const } : proposalWords(p.status);
    if (!words) continue;
    const sold = ["ACCEPTED", "COMPLETED", "PAID"].includes(p.status) && !p.canceledAt;
    const s = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
    const pPaid = p.status === "PAID" ? contractTotal(p.total, p.changeOrders) : fromMinor(s.paidMinor);
    const pLeft = sold && p.status !== "PAID" ? fromMinor(s.remainingMinor) : 0;
    const next = s.nextPayableId ? p.installments.find((i) => i.id === s.nextPayableId) : undefined;
    const late = !!next?.dueDate && next.dueDate.getTime() < now.getTime();
    if (sold) {
      contract += contractTotal(p.total, p.changeOrders);
      paid += pPaid;
      left += pLeft;
    }
    props.push({
      id: p.id,
      title: p.title,
      label: words.label,
      tone: words.tone,
      contract: contractTotal(p.total, p.changeOrders),
      paid: Math.round(pPaid * 100) / 100,
      left: Math.round(pLeft * 100) / 100,
      late: sold && pLeft > 0 && late,
      href: `${b}/portal/q/${p.publicId}`,
      payHref: sold && pLeft > 0 && (p.status === "ACCEPTED" || p.status === "COMPLETED") ? `${b}/portal/q/${p.publicId}${s.nextPayableId ? `?pay=${s.nextPayableId}` : ""}` : null,
      // The button pays the NEXT payment (the link opens on it), so it says that payment's amount, not the balance.
      payAmount: (() => {
        const st = s.nextPayableId ? s.stages.find((x) => x.id === s.nextPayableId) : null;
        return st ? fromMinor(st.amountMinor) : Math.round(pLeft * 100) / 100;
      })(),
      pdfHref: `${b}/api/public-quote/${p.publicId}/pdf`,
      when: day(p.acceptedAt ?? p.sentAt ?? p.createdAt),
    });
  }

  const upcoming: Array<HomeItem & { at: number }> = [
    ...visits.map((v) => ({ title: v.title || "Visit", when: when(v.startsAt), href: null, at: v.startsAt.getTime() })),
    ...days.map((e) => ({ title: e.job?.title ?? e.title, when: when(e.startsAt), href: null, at: e.startsAt.getTime() })),
  ].sort((a, b2) => a.at - b2.at);

  const messages = thread
    ? (
        await db.clientMessage.findMany({ where: { threadId: thread.id, channel: { in: ["EMAIL", "PORTAL"] }, status: { not: "FAILED" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, direction: true, channel: true, body: true, createdAt: true } })
      )
        .reverse()
        .map((m) => ({ id: m.id, mine: m.direction === "IN", body: m.body.slice(0, 4000), when: when(m.createdAt), via: m.channel === "PORTAL" ? "here" : "email" }))
    : [];

  const booking = parseBookingSettings(org.bookingSettingsJson, []);
  return {
    token,
    org: { name: org.name, logoUrl: org.logoUrl, phone: org.phone, email: org.billingEmail, bookHref: booking.enabled && org.slug ? `${b}/book/${org.slug}` : null },
    client: { name: c.name },
    money: { contract: Math.round(contract * 100) / 100, paid: Math.round(paid * 100) / 100, left: Math.round(left * 100) / 100 },
    proposals: props,
    waiting: waitingCos.map((co) => ({ title: `Change order${co.number ? ` #${co.number}` : ""} — ${co.title}`, when: co.sentAt ? day(co.sentAt) : "", href: `${b}/co/${co.publicToken}`, note: `$${Math.round(co.total ?? co.amount).toLocaleString("en-US")}` })),
    projects: projects.map((p) => ({ title: p.name, when: p.status === "COMPLETED" ? "done" : p.status === "ON_HOLD" ? "on hold" : "in progress", href: p.publicToken && p.sharedAt ? `${b}/p/${p.publicToken}` : null })),
    upcoming: upcoming.slice(0, 6).map(({ title, when: w, href }) => ({ title, when: w, href })),
    plans: plans.map((pl) => ({
      title: pl.name,
      when: pl.visits[0] ? `next: ${pl.visits[0].label}, ${day(pl.visits[0].dueAt)}` : pl.status === "SENT" ? "waiting for your signature" : "active",
      href: pl.status === "SENT" ? `${b}/plan/${pl.acceptToken}` : null,
    })),
    documents: [
      ...props.filter((p) => p.tone !== "off").map((p) => ({ title: `${p.title} — proposal (PDF)`, when: p.when, href: p.pdfHref })),
      ...reports.map((r) => ({ title: "Visit report", when: r.sentAt ? day(r.sentAt) : "", href: `${b}/report/${r.publicToken}` })),
    ],
    review: reviews[0] ? `${b}/review/${reviews[0].publicToken}` : null,
    messages,
    canWrite: true,
  };
}

export type PostResult = { ok: true } | { ok: false; error: string };

/** The client writes from their page. */
export async function postHomeMessage(token: string, raw: string): Promise<PostResult> {
  if (!isHomeToken(token)) return { ok: false, error: "This link isn't active." };
  const body = cleanMessage(raw);
  if (!body) return { ok: false, error: "Write a few words first." };
  const c = await db.client.findFirst({ where: { homeToken: token, deletedAt: null }, select: { id: true, name: true, email: true, phone: true, organizationId: true, organization: { select: { id: true, name: true, logoUrl: true, phone: true } } } });
  if (!c) return { ok: false, error: "This link isn't active." };
  const since = new Date(Date.now() - 3_600_000);
  const recent = await db.clientMessage.count({ where: { organizationId: c.organizationId, channel: "PORTAL", direction: "IN", createdAt: { gte: since }, thread: { clientId: c.id } } });
  if (recent >= MESSAGES_PER_HOUR) return { ok: false, error: "That's a lot of messages in an hour — the team will answer what you sent. Call them if it's urgent." };
  await fileInboundPortal(c.organizationId, { id: c.id, name: c.name, email: c.email, phone: c.phone }, body);
  // The client's own rep hears it too (the owner of their latest proposal).
  const rep = await db.proposal.findFirst({ where: { organizationId: c.organizationId, clientId: c.id, ownerId: { not: null } }, orderBy: { createdAt: "desc" }, select: { ownerId: true } });
  const b = await base();
  await logActivity({ organizationId: c.organizationId, actorId: null, kind: TRAIL_KINDS.CLIENT, clientId: c.id, summary: `${c.name} wrote on their page: "${body.slice(0, 160)}${body.length > 160 ? "…" : ""}"` });
  await Promise.all([
    textOffice(c.organizationId, "client-message", `${c.name} wrote on their page: "${body.slice(0, 120)}${body.length > 120 ? "…" : ""}" — ${b}/dashboard/inbox`, { alsoUserIds: [rep?.ownerId] }).catch(() => undefined),
    sendToMembersByPref(c.organizationId, "client-message", buildClientPageMessage({ org: { id: c.organization.id, name: c.organization.name, logoUrl: c.organization.logoUrl, phone: c.organization.phone }, clientName: c.name, body, href: `${b}/dashboard/inbox` })).catch(() => undefined),
  ]);
  return { ok: true };
}
