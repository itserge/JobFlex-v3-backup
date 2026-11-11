"use server";
// "DO NOT EMAIL" AND "DON'T TEXT" BY HAND (2026-11-11).
//
// The admin's side: the do-not-email list (lib/mailBlock) — read one address, put it on ("Unsubscribe from emails"
// on the user's card, or an address typed on /admin/mail/blocked), take it off. Putting an account owner on also
// stops JobFlex's own letters to that account (mailOptOut, lib/adminMail/optout), the way their own link would.
//
// The company's side, on a client's card and in the Inbox: "Don't email" puts the client's address on the list and
// on the company's own opt-outs (ClientEmailOptOut, via "office" — lib/winback/optout writeStop); "Don't text" puts
// the phone in SmsOptOut, which every text asks (lib/sms/send). Either can be taken back only when the company set
// it — a person's own unsubscribe or STOP stays theirs (they text START, or press nothing at all).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePlatformAdmin, requireSalesOrManager } from "@/lib/orgContext";
import { listMailBlocks, readMailBlock, removeMailBlock, writeMailBlock } from "@/lib/mailBlock";
import { normalizeEmail, type MailBlock } from "@/lib/mailBlockShared";
import { writeOptOut } from "@/lib/adminMail/optout";
import { clearOfficeStop, writeStop } from "@/lib/winback/optout";
import { toE164 } from "@/lib/phone";

type Ok<T = object> = { ok: true } & T;
type No = { ok: false; error: string };

// ── the admin ────────────────────────────────────────────────────────────────

export async function adminMailBlockState(email: string): Promise<{ block: MailBlock | null }> {
  await requirePlatformAdmin();
  return { block: await readMailBlock(email) };
}

/** Put an address on the list (and stop JobFlex's letters to every account it owns). */
export async function adminBlockEmail(input: { email: string; reason?: string | null }): Promise<Ok<{ block: MailBlock }> | No> {
  const admin = await requirePlatformAdmin();
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "That isn't an email address." };
  await writeMailBlock(email, { source: "admin", reason: input.reason?.trim() || "Unsubscribed by a JobFlex admin", by: admin.email });
  const owned = await db.membership.findMany({ where: { role: "OWNER", user: { email } }, select: { organizationId: true } });
  for (const m of owned) await writeOptOut(m.organizationId, "admin");
  revalidatePath("/admin/mail/blocked");
  return { ok: true, block: (await readMailBlock(email))! };
}

export async function adminUnblockEmail(email: string): Promise<Ok | No> {
  await requirePlatformAdmin();
  const r = await removeMailBlock(email);
  if (r === "absent") return { ok: false, error: "That address isn't on the list." };
  revalidatePath("/admin/mail/blocked");
  return { ok: true };
}

export async function adminListMailBlocks(q?: string): Promise<{ rows: MailBlock[]; total: number }> {
  await requirePlatformAdmin();
  return listMailBlocks({ q: q ?? "" });
}

/** An account's owners, for the list's "whose" column: address → company names. */
export async function ownersOf(emails: string[]): Promise<Record<string, string[]>> {
  await requirePlatformAdmin();
  const rows = await db.membership.findMany({ where: { role: "OWNER", user: { email: { in: emails.slice(0, 500) } } }, select: { user: { select: { email: true } }, organization: { select: { name: true } } } });
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const e = r.user?.email?.toLowerCase();
    if (e) (out[e] ??= []).push(r.organization.name);
  }
  return out;
}

// ── the company ──────────────────────────────────────────────────────────────

export interface ClientContactStops {
  email: string | null;
  phone: string | null;
  /** "Don't email": on, and who set it — "office" (this company, may be taken back) or "them". */
  noEmail: { on: boolean; by: "office" | "them" | null; at: string | null };
  noText: { on: boolean; by: "office" | "them" | null; at: string | null };
}

async function clientOf(clientId: string) {
  const ctx = await requireSalesOrManager();
  const client = await db.client.findUnique({ where: { id: String(clientId) }, select: { id: true, organizationId: true, deletedAt: true, email: true, phone: true, name: true } });
  if (!client || client.organizationId !== ctx.organizationId || client.deletedAt) throw new Error("Client not found");
  return { ctx, client };
}

const officeSms = (orgId: string) => `office:${orgId}`;

async function stopsOf(organizationId: string, emailRaw: string | null, phoneRaw: string | null): Promise<ClientContactStops> {
  const email = normalizeEmail(emailRaw);
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  const [block, opt, sms] = await Promise.all([
    email ? readMailBlock(email) : null,
    email ? db.clientEmailOptOut.findUnique({ where: { organizationId_email: { organizationId, email } }, select: { via: true, createdAt: true } }) : null,
    phone ? db.smsOptOut.findUnique({ where: { phone }, select: { body: true, stoppedAt: true } }) : null,
  ]);
  const emailOn = !!block || !!opt;
  const emailByOffice = emailOn && (!block || (block.source === "office" && block.orgId === organizationId)) && (!opt || opt.via === "office");
  return {
    email,
    phone,
    noEmail: { on: emailOn, by: emailOn ? (emailByOffice ? "office" : "them") : null, at: block?.at ?? opt?.createdAt.toISOString() ?? null },
    noText: { on: !!sms, by: sms ? (sms.body === officeSms(organizationId) ? "office" : "them") : null, at: sms?.stoppedAt.toISOString() ?? null },
  };
}

export async function clientContactStops(clientId: string): Promise<ClientContactStops> {
  const { ctx, client } = await clientOf(clientId);
  return stopsOf(ctx.organizationId, client.email, client.phone);
}

/** "Don't email" on (true) or off (false) for this client. */
export async function setClientDoNotEmail(clientId: string, on: boolean): Promise<Ok<{ stops: ClientContactStops }> | No> {
  const { ctx, client } = await clientOf(clientId);
  const email = normalizeEmail(client.email);
  if (!email) return { ok: false, error: "This client has no email address." };
  const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } });
  if (on) {
    await writeStop({ organizationId: ctx.organizationId, email, company: org?.name ?? null, by: ctx.user.email ?? null }, "office");
  } else {
    const r = await clearOfficeStop(ctx.organizationId, email);
    if (r === "theirs") return { ok: false, error: "They unsubscribed themselves — only they can undo that, from a link in an email." };
  }
  await db.activityEvent
    .create({ data: { organizationId: ctx.organizationId, clientId: client.id, actorId: ctx.user.id, kind: "CLIENT", summary: on ? `Marked “Don't email” — ${email} gets no more emails except invoices and receipts` : `“Don't email” taken off — ${email} gets emails again` } })
    .catch(() => null);
  revalidatePath(`/dashboard/clients/${client.id}`);
  return { ok: true, stops: await stopsOf(ctx.organizationId, client.email, client.phone) };
}

/** "Don't text" on (true) or off (false) for this client. */
export async function setClientDoNotText(clientId: string, on: boolean): Promise<Ok<{ stops: ClientContactStops }> | No> {
  const { ctx, client } = await clientOf(clientId);
  const phone = client.phone ? toE164(client.phone) : null;
  if (!phone) return { ok: false, error: "This client has no mobile number." };
  const row = await db.smsOptOut.findUnique({ where: { phone }, select: { body: true } });
  if (on) {
    if (!row) await db.smsOptOut.create({ data: { phone, body: officeSms(ctx.organizationId) } });
  } else if (row) {
    if (row.body !== officeSms(ctx.organizationId)) return { ok: false, error: "They replied STOP themselves — only they can undo that, by texting START." };
    await db.smsOptOut.delete({ where: { phone } });
  }
  await db.activityEvent
    .create({ data: { organizationId: ctx.organizationId, clientId: client.id, actorId: ctx.user.id, kind: "CLIENT", summary: on ? `Marked “Don't text” — no more texts to …${phone.slice(-4)}` : `“Don't text” taken off — texts to …${phone.slice(-4)} can go again` } })
    .catch(() => null);
  revalidatePath(`/dashboard/clients/${client.id}`);
  return { ok: true, stops: await stopsOf(ctx.organizationId, client.email, client.phone) };
}
