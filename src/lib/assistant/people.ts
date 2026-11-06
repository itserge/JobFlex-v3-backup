import "server-only";
// PEOPLE BY VOICE OR TEXT (2026-11-05, the AI Operator's batch 1): a client
// added or changed, a lead added — through the Clients and Leads pages' own
// cores (lib/clients/core, lib/leads/create). Nothing here reaches anyone, but
// each is read back first: a misheard phone number is caught before it is on
// the record, and a person is never added twice.
import { z } from "zod";
import { db } from "@/lib/db";
import type { WriteTool } from "@/lib/assistant/tools";
import { andList, dayWords } from "@/lib/assistant/shared";
import { findClients, findLeads } from "@/lib/assistant/find";
import { phoneWords } from "@/lib/assistant/phone";
import { toE164 } from "@/lib/phone";
import { createClientAs, patchClientAs } from "@/lib/clients/core";
import { createLeadAs } from "@/lib/leads/create";
import { isPageLocked } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);
const NAME = z.string().trim().min(2).max(120);
const maybe = (max: number) => z.string().max(max).nullable();

type Contact = { phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; zip: string | null };

/** The contact fields as they will be kept: trimmed, the phone as E.164 when it reads as a US/Canada number. */
function contactOf(a: Contact): { ok: true; c: Contact } | { ok: false; say: string } {
  const email = a.email?.trim() || null;
  if (email && !z.string().email().safeParse(email).success) return { ok: false, say: `"${email}" doesn't look like an email address.` };
  const rawPhone = a.phone?.trim() || null;
  const phone = rawPhone ? (toE164(rawPhone) ?? rawPhone) : null;
  const t = (v: string | null) => v?.trim() || null;
  return { ok: true, c: { phone, email, address: t(a.address), city: t(a.city), state: t(a.state), zip: t(a.zip) } };
}

const phoneSay = (p: string | null) => (p ? (p.startsWith("+") ? phoneWords(p) : p) : null);

function contactWords(c: Contact): string {
  const place = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
  return [phoneSay(c.phone), c.email, place || null].filter(Boolean).join(", ");
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type ClientArgs = { name: string; notes: string | null } & Contact;

const addClient: WriteTool<ClientArgs, ClientArgs> = {
  kind: "write",
  name: "add_client",
  need: "clients.write",
  description:
    "Add a new client (a customer) to JobFlex: the name, and any of phone, email, street address, city, state, zip, a note. Find first: when a client with that name already exists, don't add a second one — change them with update_client, or say so.",
  params: z.object({ name: NAME, phone: maybe(40), email: maybe(200), address: maybe(200), city: maybe(80), state: maybe(40), zip: maybe(20), notes: maybe(500) }),
  payload: z.object({ name: NAME, phone: maybe(40), email: maybe(200), address: maybe(200), city: maybe(80), state: maybe(40), zip: maybe(20), notes: maybe(500) }),
  async plan({ actor }, a) {
    const got = contactOf(a);
    if (!got.ok) return got;
    const c = got.c;
    const name = a.name.trim();
    const same = (await findClients(actor.organizationId, name)).find((x) => sameName(x.name, name)) ?? null;
    const byContact =
      !same && (c.phone || c.email)
        ? await db.client.findFirst({
            where: { organizationId: actor.organizationId, deletedAt: null, OR: [...(c.phone ? [{ phone: { contains: c.phone.slice(-7) } }] : []), ...(c.email ? [{ email: c.email }] : [])] },
            select: { id: true, name: true },
          })
        : null;
    const dupe = same ?? byContact;
    if (dupe) {
      const first = dupe.name.split(/\s+/)[0];
      return { ok: false, say: `${dupe.name} is already a client${same ? "" : " with that phone or email"}. Say "change ${first}'s phone to …" to update them, or give me a different name.` };
    }
    const notes = a.notes?.trim() || null;
    const words = contactWords(c);
    return { ok: true, payload: { name, ...c, notes }, readback: `Add client ${name}${words ? ` — ${words}` : ""}${notes ? ` (note: ${notes})` : ""}.` };
  },
  async execute({ actor }, p) {
    const c = await createClientAs(
      { organizationId: actor.organizationId, userId: actor.userId },
      { name: p.name, email: p.email ?? undefined, phone: p.phone ?? undefined, address: p.address ?? undefined, city: p.city ?? undefined, state: p.state ?? undefined, zip: p.zip ?? undefined, notes: p.notes ?? undefined },
    );
    const words = contactWords(c);
    return { say: `Added ${c.name} to your clients${words ? ` (${words})` : ""}.`, result: { clientId: c.id } };
  },
};

type UpdateArgs = { clientId: string; name: string | null; notes: string | null } & Contact;

const updateClient: WriteTool<UpdateArgs, { clientId: string; name: string; changes: Record<string, string | null> }> = {
  kind: "write",
  name: "update_client",
  need: "clients.write",
  description: "Change a client's details — a new phone, email, address, name or a note. Give only what changes (null = leave as it is). Find the client first.",
  params: z.object({ clientId: ID, name: maybe(120), phone: maybe(40), email: maybe(200), address: maybe(200), city: maybe(80), state: maybe(40), zip: maybe(20), notes: maybe(500) }),
  payload: z.object({ clientId: ID, name: z.string(), changes: z.record(z.string(), z.string().nullable()) }),
  async plan({ actor }, a) {
    const cur = await db.client.findFirst({
      where: { id: a.clientId, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, zip: true },
    });
    if (!cur) return { ok: false, say: "I couldn't find that client." };
    const got = contactOf(a);
    if (!got.ok) return got;
    const next = got.c;
    const changes: Record<string, string | null> = {};
    const words: string[] = [];
    const newName = a.name?.trim() || null;
    if (newName && newName !== cur.name) {
      changes.name = newName;
      words.push(`rename them to ${newName}`);
    }
    if (next.phone && next.phone !== cur.phone) {
      changes.phone = next.phone;
      words.push(`phone ${phoneSay(next.phone)}`);
    }
    if (next.email && next.email.toLowerCase() !== (cur.email ?? "").toLowerCase()) {
      changes.email = next.email;
      words.push(`email ${next.email}`);
    }
    for (const k of ["address", "city", "state", "zip"] as const) {
      if (next[k] && next[k] !== cur[k]) {
        changes[k] = next[k];
        words.push(`${k} ${next[k]}`);
      }
    }
    const notes = a.notes?.trim() || null;
    if (notes) {
      changes.notes = notes;
      words.push(`note "${notes}"`);
    }
    if (!Object.keys(changes).length) return { ok: false, say: `${cur.name} already has that on file — nothing to change.` };
    return { ok: true, payload: { clientId: cur.id, name: cur.name, changes }, readback: `Change ${cur.name}: ${andList(words)}.` };
  },
  async execute({ actor }, p) {
    const c = await patchClientAs({ organizationId: actor.organizationId, userId: actor.userId }, p.clientId, p.changes);
    const words = contactWords(c);
    return { say: `Done — ${c.name}'s record is updated${words ? `: ${words}` : ""}.`, result: { clientId: c.id } };
  },
};

type LeadArgs = { name: string; phone: string | null; email: string | null; address: string | null; projectType: string | null; description: string | null; source: string | null };

const addLead: WriteTool<LeadArgs, LeadArgs> = {
  kind: "write",
  name: "add_lead",
  need: "leads.write",
  description:
    "Add a new lead (someone who asked about work; not a client yet): the name, and any of phone, email, address, what they want (projectType: 'Fence', 'Roof repair'…), details, and where they came from (source: 'referral', 'website', 'phone call', 'door knock'…; null = added by hand). Find first: when they are already a lead or a client, don't add a second one.",
  params: z.object({ name: NAME, phone: maybe(40), email: maybe(200), address: maybe(200), projectType: maybe(80), description: maybe(1000), source: maybe(40) }),
  payload: z.object({ name: NAME, phone: maybe(40), email: maybe(200), address: maybe(200), projectType: maybe(80), description: maybe(1000), source: maybe(40) }),
  async plan({ actor }, a) {
    if (await isPageLocked(actor.organizationId, "leads")) return { ok: false, say: "Leads aren't in your plan yet (Settings → Billing)." };
    const got = contactOf({ ...a, city: null, state: null, zip: null });
    if (!got.ok) return got;
    const c = got.c;
    const name = a.name.trim();
    const lead = (await findLeads(actor.organizationId, name)).find((l) => sameName(l.name, name));
    if (lead) return { ok: false, say: `${lead.name} is already a lead (${lead.status.toLowerCase()}, came ${dayWords(lead.createdAt, actor.timezone)}).` };
    const client = (await findClients(actor.organizationId, name)).find((x) => sameName(x.name, name));
    if (client) return { ok: false, say: `${client.name} is already a client, so there's no lead to add. Book a visit or build an estimate for them instead.` };
    const projectType = a.projectType?.trim() || null;
    const source = a.source?.trim() || null;
    const bits = [phoneSay(c.phone), c.email, c.address].filter(Boolean).join(", ");
    return {
      ok: true,
      payload: { name, phone: c.phone, email: c.email, address: c.address, projectType, description: a.description?.trim() || null, source },
      readback: `Add lead ${name}${bits ? ` — ${bits}` : ""}${projectType ? `, wants ${projectType}` : ""}${source ? ` (from ${source})` : ""}.`,
    };
  },
  async execute({ actor }, p) {
    const l = await createLeadAs({ organizationId: actor.organizationId, userId: actor.userId }, p);
    return { say: `Added ${l.name} as a new lead${p.projectType ? ` (${p.projectType})` : ""}. It's in Leads now.`, result: { leadId: l.id } };
  },
};

export const PEOPLE_TOOLS = [addClient, updateClient, addLead];
