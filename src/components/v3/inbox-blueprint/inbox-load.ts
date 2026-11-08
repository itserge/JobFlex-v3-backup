// THE INBOX — THE SERVER READ (Smart CRM part 2, 2026-11-08). The thread list for the chosen filter, the counts on
// the filter chips, and the open thread: every message merged across channels, the AI read of the newest inbound
// one, and the client's memory beside it. Dates travel as strings, formatted here once (the client-detail rule:
// a Date formatted in both environments is a hydration mismatch waiting for a clock that disagrees).

import { db } from "@/lib/db";
import { inboxCounts, readThreadMessages, readThreads, threadSeen } from "@/lib/inbox/server";
import { INBOX_FILTERS, type InboxFilter, type MessageRead } from "@/lib/inbox/shared";
import { inboundConfig } from "@/lib/subInbound/config";

export type InboxThreadRow = {
  id: string;
  name: string;
  preview: string;
  when: string;
  status: string;
  urgent: boolean;
  unread: number;
  channel: string | null;
  mine: boolean;
};

export type InboxMessageRow = {
  id: string;
  direction: "IN" | "OUT";
  channel: string;
  subject: string | null;
  body: string;
  when: string;
  detail: string | null;
  attachments: Array<{ name: string; url: string }>;
};

export type InboxOpen = {
  id: string;
  name: string;
  clientId: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  urgent: boolean;
  mine: boolean;
  messages: InboxMessageRow[];
  read: (MessageRead & { when: string; channel: string }) | null;
  facts: Array<{ category: string; fact: string }>;
  canEmail: boolean;
  canText: boolean;
};

export type InboxView = {
  filter: InboxFilter;
  counts: Record<InboxFilter, number>;
  threads: InboxThreadRow[];
  open: InboxOpen | null;
  /** The receiving domain is set: client replies to JobFlex email land here. */
  receiving: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function when(d: Date, tz: string, now = new Date()): string {
  try {
    const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d) === new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
    if (sameDay) return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(d);
  } catch {
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
}

function stamp(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function parseFilter(raw: string | undefined): InboxFilter {
  return (INBOX_FILTERS.find((f) => f.key === raw)?.key ?? "all") as InboxFilter;
}

export async function loadInbox(organizationId: string, userId: string, filterRaw: string | undefined, threadId: string | undefined): Promise<InboxView> {
  const filter = parseFilter(filterRaw);
  const [org, counts, list] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, smsFromNumber: true } }),
    inboxCounts(organizationId, userId),
    readThreads(organizationId, filter, userId),
  ]);
  const tz = org?.timezone || "America/New_York";
  const threads: InboxThreadRow[] = list.map((t) => ({
    id: t.id,
    name: t.name,
    preview: t.lastPreview ?? "",
    when: when(t.lastAt, tz),
    status: t.status,
    urgent: t.urgent,
    unread: t.unread,
    channel: t.lastChannel,
    mine: t.assignedToId === userId,
  }));

  // The open thread: the one asked for, else the newest in the list.
  const pick = threadId ?? list[0]?.id ?? null;
  let open: InboxOpen | null = null;
  if (pick) {
    const t = await db.clientThread.findUnique({ where: { id: pick }, include: { client: { select: { id: true, email: true, phone: true } } } });
    if (t && t.organizationId === organizationId) {
      const email = t.client?.email ?? t.email ?? null;
      const phone = t.client?.phone ?? t.phone ?? null;
      const [messages, facts] = await Promise.all([
        readThreadMessages({ id: t.id, organizationId, email, phone }),
        t.clientId ? db.clientFact.findMany({ where: { organizationId, clientId: t.clientId, status: "CURRENT" }, orderBy: { createdAt: "desc" }, take: 8, select: { category: true, fact: true } }) : Promise.resolve([]),
      ]);
      if (t.unread > 0) await threadSeen(t.id, organizationId);
      let read: InboxOpen["read"] = null;
      if (t.aiReadJson) {
        try {
          const r = JSON.parse(t.aiReadJson) as MessageRead & { at?: string; channel?: string };
          read = { ...r, when: r.at ? stamp(new Date(r.at), tz) : "", channel: r.channel ?? "" };
        } catch {
          read = null;
        }
      }
      open = {
        id: t.id,
        name: t.name,
        clientId: t.clientId,
        email,
        phone,
        status: t.status,
        urgent: t.urgent,
        mine: t.assignedToId === userId,
        messages: messages.map((m) => ({ id: m.id, direction: m.direction, channel: m.channel, subject: m.subject, body: m.body, when: stamp(m.at, tz), detail: m.detail, attachments: m.attachments })),
        read,
        facts,
        canEmail: !!email,
        canText: !!phone && !!org?.smsFromNumber,
      };
    }
  }
  return { filter, counts, threads, open, receiving: inboundConfig().enabled };
}
