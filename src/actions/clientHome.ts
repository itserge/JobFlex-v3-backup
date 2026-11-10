"use server";
// THE CLIENT'S PAGE — the office's actions (2026-11-10, Smart CRM part 5). The link is the office's and sales' to
// hand out (the same seats that message a client); replacing it is a manager's. Sending it goes through the
// client page's own Message path (actions/clientMessage messageClient), so a text and an email land on the client's
// thread like any other.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireSalesOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { clientHomeLink, replaceHomeLink } from "@/lib/clientHome/server";
import { pageInvite } from "@/lib/clientHome/shared";
import { messageClient } from "@/actions/clientMessage";
import { withFeature } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);

export async function getClientHomeLink(clientId: string): Promise<{ href: string; opened: string; canText: boolean; canEmail: boolean }> {
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  const r = await clientHomeLink(organizationId, ID.parse(clientId));
  return { href: r.href, opened: r.opened, canText: !!r.phone, canEmail: !!r.email };
}

export async function replaceClientHomeLink(clientId: string): Promise<{ href: string }> {
  const { organizationId, user } = await withFeature(requireManager(), "smart-crm");
  const r = await replaceHomeLink(organizationId, user.id, ID.parse(clientId));
  revalidatePath("/dashboard/client-detail");
  return r;
}

/** Text or email the client their page. */
export async function sendClientHomeLink(clientId: string, channel: "sms" | "email"): Promise<{ to: string; delivered: boolean } | { error: string }> {
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  const id = ID.parse(clientId);
  const link = await clientHomeLink(organizationId, id);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const body = pageInvite(org?.name ?? "Your contractor", link.href);
  const r = await messageClient({ clientId: id, channel: z.enum(["sms", "email"]).parse(channel), subject: `Your job with ${org?.name ?? "us"} — everything in one place`, body });
  if ("to" in r) return { to: r.to, delivered: r.delivered };
  return { error: "Your plan's message limit is reached." };
}
