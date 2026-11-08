import "server-only";
// THE CLIENT'S TIMELINE — THE READS (Smart CRM part 1, 2026-11-08). Assembles one client's story from the tables
// that already hold it. Emails are matched by the client's email address, texts and calls by the last digits of the
// phone (those tables carry no clientId), leads the same way (a lead has no client link). Everything else joins by
// clientId. The pure rules live in ./shared; the page and the AI brief (lib/clientMemory) both read from here.

import { db } from "@/lib/db";
import { TRAIL_KINDS } from "@/lib/activityLog";
import { clip, digits10, mergeTimeline, samePhone, TRAIL_KINDS_COVERED, type TimelineEvent } from "./shared";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export interface ClientRef {
  id: string;
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** The whole story, newest first. `cap` bounds the merged result, not each read. */
export async function readClientTimeline(client: ClientRef, cap = 250): Promise<TimelineEvent[]> {
  const { id: clientId, organizationId } = client;
  const email = client.email?.trim().toLowerCase() || null;
  const phone = digits10(client.phone);

  const [proposals, payments, invoices, appointments, visitReports, reviews, projects, planVisits, trail, leads, emails, texts, calls] = await Promise.all([
    db.proposal.findMany({
      where: { organizationId, clientId },
      select: { id: true, title: true, status: true, total: true, sentAt: true, viewedAt: true, acceptedAt: true, declinedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    db.payment.findMany({
      where: { organizationId, clientId, status: "PAID" },
      select: { id: true, amount: true, method: true, paidAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    db.invoice.findMany({
      where: { organizationId, clientId },
      select: { id: true, number: true, amount: true, status: true, createdAt: true, paidAt: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.appointment.findMany({
      where: { organizationId, clientId },
      select: { id: true, title: true, status: true, startsAt: true },
      orderBy: { startsAt: "desc" },
      take: 80,
    }),
    db.visitReport.findMany({
      where: { organizationId, clientId },
      select: { id: true, kind: true, summary: true, techName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.reviewRequest.findMany({
      where: { organizationId, clientId },
      select: { id: true, status: true, rating: true, comment: true, sentAt: true, completedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.project.findMany({
      where: { organizationId, clientId },
      select: { id: true, name: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.servicePlanVisit.findMany({
      where: { plan: { organizationId, clientId } },
      select: { id: true, dueAt: true, status: true, plan: { select: { id: true } } },
      orderBy: { dueAt: "desc" },
      take: 30,
    }).catch(() => []),
    db.activityEvent.findMany({
      where: { organizationId, clientId },
      select: { id: true, kind: true, summary: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
    db.lead.findMany({
      where: {
        organizationId,
        // SQLite (the stand) has no case-insensitive mode: both spellings are asked for instead.
        OR: [...(email ? [{ email: { in: [email, client.email!.trim()] } }] : []), ...(phone.length >= 7 ? [{ phone: { contains: phone.slice(-7) } }] : [])],
      },
      select: { id: true, name: true, source: true, projectType: true, createdAt: true },
      take: 10,
    }),
    email
      ? db.emailLog.findMany({
          where: { organizationId, to: { in: [email, client.email!.trim()] } },
          select: { id: true, subject: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 60,
        })
      : Promise.resolve([]),
    phone.length >= 7
      ? db.smsMessage.findMany({
          where: { organizationId },
          select: { id: true, direction: true, to: true, from: true, body: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 400,
        })
      : Promise.resolve([]),
    phone.length >= 7
      ? db.aiPhoneCall.findMany({
          where: { organizationId },
          select: { id: true, direction: true, fromNumber: true, toNumber: true, durationSeconds: true, summary: true, startedAt: true },
          orderBy: { startedAt: "desc" },
          take: 150,
        })
      : Promise.resolve([]),
  ]);

  const out: TimelineEvent[][] = [];

  out.push(
    proposals.flatMap((p): TimelineEvent[] => {
      const href = `/dashboard/proposals/${p.id}`;
      const name = `${p.title} (${money(p.total)})`;
      const es: TimelineEvent[] = [];
      if (p.status === "DRAFT") es.push({ id: `PROPOSAL:${p.id}:draft`, at: p.createdAt, kind: "PROPOSAL", stamp: "Draft", tone: "ink", title: `Estimate drafted — ${name}`, href });
      if (p.sentAt) es.push({ id: `PROPOSAL:${p.id}:sent`, at: p.sentAt, kind: "PROPOSAL", stamp: "Proposal", tone: "accent", title: `Proposal sent — ${name}`, href });
      if (p.viewedAt) es.push({ id: `PROPOSAL:${p.id}:viewed`, at: p.viewedAt, kind: "PROPOSAL", stamp: "Opened", tone: "ink", title: `They opened ${p.title}`, href });
      if (p.acceptedAt) es.push({ id: `PROPOSAL:${p.id}:signed`, at: p.acceptedAt, kind: "PROPOSAL", stamp: "Signed", tone: "good", title: `Signed — ${name}`, href });
      if (p.declinedAt) es.push({ id: `PROPOSAL:${p.id}:declined`, at: p.declinedAt, kind: "PROPOSAL", stamp: "Declined", tone: "bad", title: `Declined — ${name}`, href });
      return es;
    }),
  );

  out.push(
    payments.map((p): TimelineEvent => ({
      id: `PAYMENT:${p.id}`,
      at: p.paidAt ?? p.createdAt,
      kind: "PAYMENT",
      stamp: "Payment",
      tone: "good",
      title: `Payment received — ${money(p.amount)}${p.method ? ` · ${p.method}` : ""}`,
    })),
  );

  out.push(
    invoices.map((i): TimelineEvent => ({
      id: `INVOICE:${i.id}`,
      at: i.createdAt,
      kind: "INVOICE",
      stamp: "Invoice",
      tone: i.paidAt || i.status === "PAID" ? "ink" : "warn",
      title: `Invoice ${i.number ? `#${i.number} ` : ""}— ${money(i.amount)}`,
      detail: i.paidAt ? "paid" : i.status.toLowerCase(),
    })),
  );

  out.push(
    appointments.map((a): TimelineEvent => ({
      id: `VISIT:${a.id}`,
      at: a.startsAt,
      kind: "VISIT",
      stamp: a.status === "CANCELED" ? "Canceled" : "Visit",
      tone: a.status === "CANCELED" ? "bad" : a.status === "NO_SHOW" ? "warn" : "ink",
      title: a.title,
      detail: a.status === "SCHEDULED" ? null : a.status.toLowerCase().replace("_", " "),
    })),
  );

  out.push(
    visitReports.map((v): TimelineEvent => ({
      id: `SERVICE:report:${v.id}`,
      at: v.createdAt,
      kind: "SERVICE",
      stamp: "Report",
      tone: "ink",
      title: `Visit report${v.techName ? ` — ${v.techName}` : ""}`,
      detail: clip(v.summary, 120) || null,
    })),
  );

  out.push(
    reviews.flatMap((r): TimelineEvent[] => {
      const es: TimelineEvent[] = [];
      if (r.sentAt) es.push({ id: `REVIEW:${r.id}:asked`, at: r.sentAt, kind: "REVIEW", stamp: "Review", tone: "ink", title: "Review requested" });
      if (r.completedAt) es.push({ id: `REVIEW:${r.id}:left`, at: r.completedAt, kind: "REVIEW", stamp: "Review", tone: r.rating != null && r.rating <= 3 ? "warn" : "good", title: `Review left${r.rating != null ? ` — ${r.rating}★` : ""}`, detail: clip(r.comment, 120) || null });
      return es;
    }),
  );

  out.push(
    projects.map((p): TimelineEvent => ({
      id: `PROJECT:${p.id}`,
      at: p.createdAt,
      kind: "PROJECT",
      stamp: "Project",
      tone: "accent",
      title: `Project started — ${p.name}`,
      detail: p.status ? p.status.toLowerCase().replace(/_/g, " ") : null,
      href: `/dashboard/projects/${p.id}`,
    })),
  );

  out.push(
    planVisits
      .filter((v) => v.status === "DONE")
      .map((v): TimelineEvent => ({ id: `SERVICE:plan:${v.id}`, at: v.dueAt, kind: "SERVICE", stamp: "Service", tone: "ink", title: "Service plan visit done" })),
  );

  out.push(
    trail
      .filter((t) => !TRAIL_KINDS_COVERED.has(t.kind))
      .map((t): TimelineEvent => ({
        id: `TRAIL:${t.id}`,
        at: t.createdAt,
        kind: "TRAIL",
        stamp: t.kind === TRAIL_KINDS.FOLLOW_UP ? "Follow-up" : "Note",
        tone: "ink",
        title: clip(t.summary, 140),
      })),
  );

  out.push(
    leads.map((l): TimelineEvent => ({
        id: `LEAD:${l.id}`,
        at: l.createdAt,
        kind: "LEAD",
        stamp: "Lead",
        tone: "accent",
        title: `Came in as a lead${l.projectType ? ` — ${l.projectType}` : ""}`,
        detail: l.source ? l.source.toLowerCase().replace(/_/g, " ") : null,
      href: `/dashboard/leads/${l.id}`,
    })),
  );

  out.push(
    emails.map((e): TimelineEvent => ({
      id: `EMAIL:${e.id}`,
      at: e.createdAt,
      kind: "EMAIL",
      stamp: "Email",
      tone: "ink",
      title: clip(e.subject, 110),
      detail: e.status === "sent" ? null : e.status,
    })),
  );

  out.push(
    texts
      .filter((m) => samePhone(client.phone, m.to) || samePhone(client.phone, m.from))
      .map((m): TimelineEvent => ({
        id: `TEXT:${m.id}`,
        at: m.createdAt,
        kind: "TEXT",
        stamp: m.direction === "IN" ? "Text in" : "Text",
        tone: m.direction === "IN" ? "accent" : "ink",
        title: clip(m.body, 110),
        detail: m.status === "SKIPPED" ? "not sent" : null,
      })),
  );

  out.push(
    calls
      .filter((c) => samePhone(client.phone, c.fromNumber) || samePhone(client.phone, c.toNumber))
      .map((c): TimelineEvent => ({
        id: `CALL:${c.id}`,
        at: c.startedAt,
        kind: "CALL",
        stamp: c.direction === "OUT" ? "Call out" : "Call",
        tone: "ink",
        title: `${c.direction === "OUT" ? "Call to them" : "They called"}${c.durationSeconds ? ` — ${Math.max(1, Math.round(c.durationSeconds / 60))} min` : ""}`,
        detail: clip(c.summary, 140) || null,
      })),
  );

  return mergeTimeline(out, cap);
}

/** The header's figures: paid for life, open proposals' worth, and what invoices still owe. */
export async function readClientFigures(client: ClientRef): Promise<{ lifetimePaid: number; pipeline: number; openBalance: number }> {
  const { id: clientId, organizationId } = client;
  const [paid, open, owed] = await Promise.all([
    db.payment.aggregate({ where: { organizationId, clientId, status: "PAID" }, _sum: { amount: true } }),
    db.proposal.aggregate({ where: { organizationId, clientId, status: { in: ["SENT", "VIEWED"] } }, _sum: { total: true } }),
    db.invoice.aggregate({ where: { organizationId, clientId, status: { notIn: ["PAID", "VOID", "CANCELED"] } }, _sum: { amount: true } }),
  ]);
  return { lifetimePaid: paid._sum.amount ?? 0, pipeline: open._sum.total ?? 0, openBalance: owed._sum.amount ?? 0 };
}
