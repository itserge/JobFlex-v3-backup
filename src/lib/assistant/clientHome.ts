import "server-only";
// THE CLIENT'S PAGE FOR THE OPERATOR (2026-11-10, Smart CRM part 5): "send Lee their page", "text the Smiths their
// link". The client's one lasting page (lib/clientHome) — read back word for word, sent on a yes by text or email
// through the inbox's own senders, so it lands on the client's thread.

import { z } from "zod";
import { db } from "@/lib/db";
import type { WriteTool } from "@/lib/assistant/tools";
import { clientHomeLink } from "@/lib/clientHome/server";
import { pageInvite } from "@/lib/clientHome/shared";
import { ensureThread, replyByEmail, replyByText } from "@/lib/inbox/server";

const ID = z.string().min(1).max(64);
type Args = { clientId: string; channel: "sms" | "email" };
type Payload = { clientId: string; channel: "sms" | "email"; name: string; message: string };

const sendClientPage: WriteTool<Args, Payload> = {
  kind: "write",
  name: "send_client_page",
  need: "clients.write",
  card: {
    label: "Send a client their page",
    purpose: "Text or email a client their one lasting page — proposals, payments, schedule, documents and messages in one link.",
    when: "'Send Lee their page', 'text the Smiths their link to everything', 'email Olga her page': send_client_page(clientId from find, channel). Read back the message as it will go.",
    objects: ["client"],
    effect: "message",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "send Lee Walk his page", args: { clientId: "c_1", channel: "sms" } },
      { say: "email Olga her link to everything", args: { clientId: "c_2", channel: "email" } },
    ],
  },
  description: "Send a client their own page (one lasting link: their proposals with what is paid and left, what waits for their OK, the schedule, documents, and messages — they can write back). channel sms or email; the client needs a phone or an email on file.",
  params: z.object({ clientId: ID, channel: z.enum(["sms", "email"]) }),
  payload: z.object({ clientId: ID, channel: z.enum(["sms", "email"]), name: z.string(), message: z.string() }),
  async plan({ actor }, args) {
    const org = actor.organizationId;
    const c = await db.client.findFirst({ where: { id: args.clientId, organizationId: org, deletedAt: null }, select: { id: true, name: true, phone: true, email: true } });
    if (!c) return { ok: false, say: "I couldn't find that client." };
    if (args.channel === "sms" && !c.phone) return { ok: false, say: `${c.name} has no phone on file — I can email it instead.` };
    if (args.channel === "email" && !c.email) return { ok: false, say: `${c.name} has no email on file — I can text it instead.` };
    const link = await clientHomeLink(org, c.id);
    const message = pageInvite(actor.orgName || "Your contractor", link.href);
    return {
      ok: true,
      payload: { clientId: c.id, channel: args.channel, name: c.name, message },
      readback: `${args.channel === "sms" ? `Text ${c.name} at ${c.phone}` : `Email ${c.name} at ${c.email}`}: "${message}" (${link.opened}).`,
    };
  },
  async execute({ actor }, p) {
    const c = await db.client.findFirst({ where: { id: p.clientId, organizationId: actor.organizationId }, select: { id: true, name: true, email: true, phone: true } });
    if (!c) return { say: "That client isn't on file any more." };
    const t = await ensureThread(actor.organizationId, { clientId: c.id, name: c.name, email: c.email, phone: c.phone });
    if (p.channel === "email") {
      const r = await replyByEmail(t.id, actor.organizationId, actor.userId, { body: p.message, subject: `Your job with ${actor.orgName || "us"} — everything in one place` });
      return { say: r.ok ? `Emailed ${p.name} their page.` : `That email didn't go: ${r.error}` };
    }
    const r = await replyByText(t.id, actor.organizationId, { body: p.message });
    if (!r.ok) return { say: `That text didn't go (${r.reason}).` };
    if (r.status === "SKIPPED") return { say: r.why === "no-number" ? "Your company has no texting number yet — I can email it instead." : "Texts can't go out from here right now." };
    return { say: r.status === "HELD" ? `Held for the morning (quiet hours) — it texts ${p.name} on its own.` : `Texted ${p.name} their page.` };
  },
};

export const CLIENT_HOME_TOOLS = [sendClientPage] as const;
