import "server-only";
// EDIT A LEAD (owner, 2026-11-10: "leads come from Facebook with just a phone number, no address yet … after we get
// all the information, edit this lead and fill it in, so it goes through the CRM with all the information"). One core
// for the lead page's Edit (actions/leads updateLeadDetails) and the AI Operator's update_lead (lib/assistant/people):
//
//   - the fields given change, the rest stay (a key left out is left alone; null or "" clears it — never the name);
//   - the lead's trail says what changed, in words ("added the street and ZIP; changed the phone");
//   - the client record the lead already is (same email or phone, lib/leadClient) gets its BLANKS filled from the
//     lead, never overwritten — the client may have been corrected on its own page, and that one wins. It is looked
//     up by the new email/phone first, then by the old ones, so fixing a typo in the phone still finds the record.
//
// Who may edit is the caller's: both callers allow the roles that work leads (requireSalesOrManager), a sales rep
// only on their own leads or the shared pool (lib/leads/salesAccess), and nobody while a Lead Center lead's contacts
// are withheld (lib/leadCenter/contacts).
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { contactsLocked } from "@/lib/leadCenter/contacts";
import { fillClientBlanks, findClientForLead } from "@/lib/leadClient";
import { cleanLeadPatch, leadChangeWords, LEAD_EDIT_FIELDS, type LeadEditField, type LeadPatch } from "@/lib/leads/details";

const CLIENT_FIELD_WORDS: Record<string, string> = { email: "email", phone: "phone", address: "address", city: "city", state: "state", zip: "ZIP" };

export type LeadEditResult =
  | {
      ok: true;
      lead: { id: string; name: string };
      /** The fields that really changed, in form order; empty when the patch matched what was on file. */
      changed: LeadEditField[];
      /** The client record that got blanks filled, and which; null when none matched or nothing was blank. */
      client: { id: string; name: string; filled: string[] } | null;
    }
  | { ok: false; error: string };

// The stored value read the way the form's is cleaned, so a field nobody touched (a Facebook phone with a double
// space) never counts as changed.
const sameValue = (stored: string | null, next: string | null) => (stored ?? "").replace(/\s+/g, " ").trim() === (next ?? "");

export async function editLeadAs(ctx: { organizationId: string; userId: string | null }, leadId: string, raw: LeadPatch): Promise<LeadEditResult> {
  const cleaned = cleanLeadPatch(raw);
  if (!cleaned.ok) return cleaned;
  const patch = cleaned.patch;
  const lead = await db.lead.findFirst({
    where: { id: leadId, organizationId: ctx.organizationId },
    select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, zip: true, projectType: true, source: true, status: true },
  });
  if (!lead) return { ok: false, error: "That lead isn't here any more." };
  if (contactsLocked(lead)) return { ok: false, error: "Accept this lead first — its contacts open then, and it can be edited." };

  const before: Record<LeadEditField, string | null> = {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    projectType: lead.projectType,
  };
  const after = { ...before };
  const changed: LeadEditField[] = [];
  for (const k of LEAD_EDIT_FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k] ?? null;
    if (sameValue(before[k], v)) continue;
    after[k] = v;
    changed.push(k);
  }
  if (!changed.length) return { ok: true, lead: { id: lead.id, name: lead.name }, changed, client: null };

  const data = Object.fromEntries(changed.map((k) => [k, after[k]]));
  await db.lead.update({ where: { id: lead.id }, data });

  // The client the lead already is: by what it says now, else by what it said before (a corrected phone).
  let client: { id: string; name: string; filled: string[] } | null = null;
  try {
    const found =
      (await findClientForLead(ctx.organizationId, { email: after.email, phone: after.phone })) ??
      (changed.includes("email") || changed.includes("phone") ? await findClientForLead(ctx.organizationId, { email: before.email, phone: before.phone }) : null);
    if (found) {
      const filled = await fillClientBlanks(found, { email: after.email, phone: after.phone, address: after.address, city: after.city, state: after.state, zip: after.zip });
      // The city, state and ZIP ride with the street; say "address" once for the four.
      const said = filled.includes("address") ? filled.filter((f) => f === "address" || f === "email" || f === "phone") : filled;
      if (filled.length) client = { id: found.id, name: found.name, filled: said.map((f) => CLIENT_FIELD_WORDS[f] ?? f) };
    }
  } catch (err) {
    // The lead is saved; a client fill that fails must not make the edit look failed.
    console.warn("[leads] client fill after edit failed:", err instanceof Error ? err.message : err);
  }

  const words = leadChangeWords(before, after, changed);
  await logActivity({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    kind: "UPDATED",
    leadId: lead.id,
    clientId: client?.id ?? null,
    summary: `${after.name ?? lead.name} — ${words}${client ? ` (also on the client record: ${client.filled.join(", ")})` : ""}`,
    meta: { edit: changed, ...(client ? { clientFilled: client.filled } : {}) },
  });

  return { ok: true, lead: { id: lead.id, name: after.name ?? lead.name }, changed, client };
}
