import "server-only";
// THE INBOX, FOR THE OPERATOR (Smart CRM part 2, 2026-11-08): "who's waiting for an answer", "what did Olga
// write" — read from the same threads the Inbox page draws (lib/inbox); and "tell Olga we'll switch to composite"
// — reply_client, read back word for word and sent only on a yes, by email or text through the same cores.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { findClients } from "@/lib/assistant/find";
import { ensureThread, readThreadMessages, replyByEmail, replyByText } from "@/lib/inbox/server";

const dayWords = (d: Date, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
};

const inbox: ReadTool<{ which: "waiting" | "urgent" | "all"; name: string | null }> = {
  kind: "read",
  name: "inbox",
  need: "clients.read",
  card: {
    label: "Inbox",
    purpose: "Client conversations: who is waiting for an answer, what is urgent, and one client's latest messages with the AI's reading of them.",
    when: "'Who's waiting for an answer', 'any urgent messages', 'what did Olga write': inbox(which, name). With a name, it returns that client's last messages and what the AI read in them; without, the threads that need us.",
    objects: ["client"],
    effect: "read",
    group: "people",
    version: 1,
    since: "2026-11-08",
    samples: [
      { say: "who's waiting for an answer?", args: { which: "waiting", name: null } },
      { say: "what did Olga write?", args: { which: "all", name: "Olga" } },
    ],
  },
  description:
    "The client inbox. Without a name: the threads that need an answer (waiting), the urgent ones, or every open one, newest first, each with its last line. With a name: that client's last messages (texts, emails, calls) oldest first, and the AI's reading of their newest message (intent, changes, deadlines, promises) — an AI reading, not a record.",
  params: z.object({
    which: z.enum(["waiting", "urgent", "all"]).describe("waiting = needs our answer; urgent = flagged urgent; all = every open thread"),
    name: z.string().max(120).nullable().describe("one client's name to read their thread; null for the list"),
  }),
  async run({ actor }, args) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    if (args.name) {
      let hits = await findClients(org, args.name);
      if (!hits.length) return { notFound: `No client matches ${args.name}.` };
      // Several by that name: the one we're actually talking with, when exactly one has a conversation.
      if (hits.length > 1) {
        const talking = await db.clientThread.findMany({ where: { organizationId: org, clientId: { in: hits.map((h) => h.id) } }, select: { clientId: true } });
        const ids = new Set(talking.map((t) => t.clientId));
        const withThread = hits.filter((h) => ids.has(h.id));
        if (withThread.length === 1) hits = withThread;
      }
      if (hits.length > 1) return { several: hits.slice(0, 3).map((h) => `${h.name}${h.city ? ` (${h.city})` : ""}`).join("; ") };
      const c = hits[0];
      const t = await ensureThread(org, { clientId: c.id, name: c.name, email: c.email, phone: c.phone });
      const msgs = await readThreadMessages({ id: t.id, organizationId: org, email: c.email, phone: c.phone }, 8);
      const read = t.aiReadJson ? (JSON.parse(t.aiReadJson) as Record<string, unknown>) : null;
      return {
        client: c.name,
        status: t.status === "NEEDS_REPLY" ? "waiting for our answer" : t.status === "WAITING" ? "we're waiting on them" : t.status.toLowerCase(),
        messages: msgs.map((m) => `${dayWords(m.at, tz)} · ${m.direction === "IN" ? "they" : "we"} (${m.channel.toLowerCase()}): ${m.body.slice(0, 240)}`),
        aiReading: read ? { intent: read.intent, summary: read.summary, changes: read.changes, deadlines: read.deadlines, promises: read.promises, suggested: read.suggested } : null,
      };
    }
    const where =
      args.which === "urgent" ? { organizationId: org, urgent: true, status: { not: "CLOSED" } } : args.which === "waiting" ? { organizationId: org, status: "NEEDS_REPLY" } : { organizationId: org, status: { not: "CLOSED" } };
    const rows = await db.clientThread.findMany({ where, orderBy: { lastAt: "desc" }, take: 12, select: { name: true, lastAt: true, lastPreview: true, lastChannel: true, urgent: true, status: true } });
    return {
      count: rows.length,
      threads: rows.map((r) => `${r.name}${r.urgent ? " [URGENT]" : ""} — ${dayWords(r.lastAt, tz)} by ${(r.lastChannel ?? "message").toLowerCase()}: ${r.lastPreview ?? ""}`),
      page: "/dashboard/inbox",
    };
  },
};

const replyArgs = z.object({
  name: z.string().min(1).max(120).describe("the client's name"),
  channel: z.enum(["email", "text"]).describe("email or text"),
  message: z.string().min(2).max(1200).describe("the words to send, exactly as they should read"),
});
type ReplyArgs = z.infer<typeof replyArgs>;
const replyPayload = replyArgs.extend({ clientId: z.string(), threadId: z.string() });

const replyClient: WriteTool<ReplyArgs, z.infer<typeof replyPayload>> = {
  kind: "write",
  name: "reply_client",
  need: "clients.write",
  card: {
    label: "Reply to a client",
    purpose: "Answer a client by email or text from the inbox — read back word for word, sent on a yes, filed on their thread.",
    when: "'Tell Olga we'll switch to composite', 'text John the visit is at 9': reply_client(name, channel, message). Write the message as it will read, in first person; never promise a price or a date the conversation didn't give.",
    objects: ["client"],
    effect: "message",
    group: "people",
    version: 1,
    since: "2026-11-08",
    samples: [{ say: "email Olga that we'll switch the deck to composite and send the new price today", args: { name: "Olga", channel: "email", message: "Hi Olga — we'll switch the deck to composite and send you the updated price today." } }],
  },
  description:
    "Send a client a message by email or text, from the company, on their inbox thread. The message is read back word for word and goes only on a yes. Email goes with the thread's reply address so their answer lands back in the inbox; a text goes from the company's number (consent and quiet hours apply).",
  params: replyArgs,
  payload: replyPayload,
  async plan({ actor }, args) {
    const hits = await findClients(actor.organizationId, args.name);
    if (!hits.length) return { ok: false, say: `I can't find a client named ${args.name}.` };
    if (hits.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 3).map((h, i) => `${i + 1}. ${h.name}${h.city ? ` (${h.city})` : ""}`).join(" ")}` };
    const c = hits[0];
    if (args.channel === "email" && !c.email) return { ok: false, say: `${c.name} has no email on file — text them, or add one first.` };
    if (args.channel === "text" && !c.phone) return { ok: false, say: `${c.name} has no phone on file — email them, or add one first.` };
    const t = await ensureThread(actor.organizationId, { clientId: c.id, name: c.name, email: c.email, phone: c.phone });
    return { ok: true, payload: { ...args, clientId: c.id, threadId: t.id }, readback: `${args.channel === "email" ? "Email" : "Text"} ${c.name}: "${args.message}"` };
  },
  async execute({ actor }, p) {
    if (p.channel === "email") {
      const r = await replyByEmail(p.threadId, actor.organizationId, actor.userId, { body: p.message });
      return { say: r.ok ? `Emailed ${p.name}. It's on their thread in the Inbox.` : `That email didn't go: ${r.error}` };
    }
    const r = await replyByText(p.threadId, actor.organizationId, { body: p.message, userId: actor.userId });
    if (!r.ok) return { say: `That text didn't go (${r.reason}).` };
    if (r.status === "SKIPPED") return { say: r.why === "no-number" ? "Your company has no texting number yet — I can email instead." : "Texts can't go out from here right now." };
    return { say: r.status === "HELD" ? `Held for the morning (quiet hours) — it texts ${p.name} on its own.` : `Texted ${p.name}.` };
  },
};

export const INBOX_TOOLS = [inbox, replyClient] as const;
