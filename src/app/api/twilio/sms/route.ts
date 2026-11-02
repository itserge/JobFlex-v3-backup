// POST /api/twilio/sms — a text came in on the platform's number (2026-09-24).
//
// STOP and START are mirrored into SmsOptOut (Twilio blocks on its side too;
// this is what the app checks and shows). Anything else is a reply from
// the field or a client: logged, matched to whoever we texted at that
// number recently, put on that company's bell, and forwarded to the office
// numbers right away — a "can't make it tomorrow" at 11 PM is exactly the
// text the office wants. The signature is verified like the voice webhook.
//
// Before that, JobFlex's own team (2026-10-15): someone on /admin/tasks' team
// list answering a task text — OK, DONE, NO, or a note — is answered by
// lib/adminTasks/textReply and texted back what it did.
//
// SmartBook (2026-10-31, lib/smartbook): on a company's own number, a lead answering the times SmartBook offered, or
// someone on the team answering a request (YES / NO / another time), is SmartBook's — answered after the response.

import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { verifyTwilioSignature } from "@/lib/sdk/twilioVoice";
import { clip, companyHelpText, helpText, isHelpWord, isStartWord, isStopWord, replyForwardLine } from "@/lib/sms/format";
import { sendText, textOfficeNow } from "@/lib/sms/send";
import { planTaskReply } from "@/lib/adminTasks/textReply";
import { deliverTaskReply } from "@/lib/adminTasks/team";
import { deliverRampReply, planRampReply } from "@/lib/ramp/sync";
import { isBareKeyword, smartBookClaim, smartBookReply, type Claim } from "@/lib/smartbook/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// SmartBook reads a reply and answers it after the response: a model call, the booking, the texts back.
export const maxDuration = 60;

const twiml = () => new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  const url = `${process.env.TWILIO_APP_URL ?? (await appBaseUrl())}/api/twilio/sms`;
  if (!(await verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature")))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  const from = (params.From ?? "").trim();
  const to = (params.To ?? "").trim();
  const body = (params.Body ?? "").trim();
  const sid = params.MessageSid || null;
  if (!from) return twiml();

  // SmartBook's, on the company's own number. Ahead of STOP for "cancel my visit" (only the bare carrier word opts
  // out), ahead of START so a "yes" is an answer — and lifts an opt-out, as START would. HELP goes on below.
  const smartOrg = to && !isHelpWord(body) && (!isStopWord(body) || !isBareKeyword(body)) ? await db.organization.findFirst({ where: { smsFromNumber: to }, select: { id: true } }) : null;
  const claim: Claim | null = smartOrg ? await smartBookClaim(smartOrg.id, from).catch(() => null) : null;
  if (smartOrg && claim) {
    await db.smsMessage.create({ data: { organizationId: smartOrg.id, direction: "IN", to, from, body, kind: "smartbook-reply", status: "RECEIVED", sid } }).catch(() => null);
    if (isStartWord(body)) await db.smsOptOut.deleteMany({ where: { phone: from } }).catch(() => null);
    const orgId = smartOrg.id;
    after(() => smartBookReply(claim, orgId, from, body));
    return twiml();
  }

  if (isStopWord(body)) {
    await db.smsOptOut.upsert({ where: { phone: from }, create: { phone: from, body: clip(body, 60) }, update: { stoppedAt: new Date(), body: clip(body, 60) } });
    await db.smsMessage.create({ data: { direction: "IN", to, from, body, kind: "stop", status: "RECEIVED", sid } }).catch(() => null);
    return twiml();
  }
  // JobFlex's team answering a task text, on JobFlex's number (not a company's own). Ahead of START so a plain
  // "yes" counts as OK; HELP and the other START words go on below.
  if (!isHelpWord(body) && (!isStartWord(body) || /^\s*yes\b/i.test(body))) {
    const company = to ? await db.organization.findFirst({ where: { smsFromNumber: to }, select: { id: true } }) : null;
    const plan = company ? null : await planTaskReply(from, body).catch((err) => {
      console.error("[sms] task reply failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (plan?.handled) {
      await db.smsMessage.create({ data: { direction: "IN", to, from, body, kind: "jobflex-admin-task-reply", status: "RECEIVED", sid } }).catch(() => null);
      // "Yes" is a re-subscribe word to Twilio too: mirror it, as START would.
      if (isStartWord(body)) await db.smsOptOut.deleteMany({ where: { phone: from } }).catch(() => null);
      const base = await appBaseUrl();
      after(() => deliverTaskReply(plan, base));
      return twiml();
    }
  }
  // A tech answering "which job was that swipe for?" (lib/ramp/sync, 2026-10-29): booked, and answered.
  if (!isHelpWord(body) && !isStartWord(body)) {
    const ramp = await planRampReply(from, body).catch((err) => {
      console.error("[sms] ramp reply failed:", err instanceof Error ? err.message : err);
      return { handled: false as const };
    });
    if (ramp.handled) {
      await db.smsMessage.create({ data: { organizationId: ramp.organizationId, direction: "IN", to, from, body, kind: "ramp-which-job-reply", status: "RECEIVED", sid } }).catch(() => null);
      after(() => deliverRampReply(ramp));
      return twiml();
    }
  }
  if (isStartWord(body)) {
    await db.smsOptOut.deleteMany({ where: { phone: from } });
    await db.smsMessage.create({ data: { direction: "IN", to, from, body, kind: "start", status: "RECEIVED", sid } }).catch(() => null);
    return twiml();
  }
  if (isHelpWord(body)) {
    // HELP always gets an answer (the carriers require it). On a company's own
    // number the company answers, from that number (2026-10-02).
    const company = to ? await db.organization.findFirst({ where: { smsFromNumber: to }, select: { id: true, name: true, phone: true } }) : null;
    await sendText(company
      ? { organizationId: company.id, to: from, body: companyHelpText(company.name, company.phone), kind: "help" }
      : { organizationId: null, to: from, body: helpText(), kind: "jobflex-help" });
    return twiml();
  }

  // Whose reply is this? A company's own number says so outright; on the
  // shared number, the company that texted this phone most recently.
  const owner = to ? await db.organization.findFirst({ where: { smsFromNumber: to }, select: { id: true } }) : null;
  const since = new Date(Date.now() - 60 * 86_400_000);
  const recent = owner ? [] : await db.smsMessage.findMany({ where: { to: from, direction: "OUT", createdAt: { gte: since }, organizationId: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, select: { organizationId: true } });
  const orgIds = [...new Set(recent.map((r) => r.organizationId!).filter(Boolean))];
  const organizationId = owner?.id ?? orgIds[0] ?? null;
  await db.smsMessage.create({ data: { organizationId, direction: "IN", to, from, body, kind: "reply", status: "RECEIVED", sid } }).catch(() => null);
  if (!organizationId) return twiml();

  const [worker, member, client, extra] = await Promise.all([
    db.workerProfile.findFirst({ where: { organizationId, phone: { not: null } }, select: { id: true, displayName: true, phone: true } }).then((w) => (w && sameNumber(w.phone, from) ? w : null)),
    db.membership.findFirst({ where: { organizationId, user: { smsPhone: from } }, select: { user: { select: { name: true, email: true } } } }),
    db.client.findFirst({ where: { organizationId, phone: { not: null } }, select: { id: true, name: true, phone: true } }).then((c) => (c && sameNumber(c.phone, from) ? c : null)),
    db.notificationPhone.findFirst({ where: { organizationId, phone: from }, select: { name: true } }),
  ]);
  // The lookups above take the first phone-bearing row and compare; the
  // exact matches below cover the rest of the roster.
  const workerExact = worker ?? (await db.workerProfile.findFirst({ where: { organizationId, phone: { in: variants(from) } }, select: { id: true, displayName: true, phone: true } }));
  const clientExact = client ?? (await db.client.findFirst({ where: { organizationId, phone: { in: variants(from) } }, select: { id: true, name: true, phone: true } }));

  const who = workerExact ? { name: workerExact.displayName, what: "crew", href: "/dashboard/workers" }
    : member ? { name: member.user?.name ?? member.user?.email ?? "A teammate", what: "office", href: "/dashboard/settings" }
    : extra ? { name: extra.name, what: "office", href: "/dashboard/settings" }
    : clientExact ? { name: clientExact.name, what: "client", href: `/dashboard/clients/${clientExact.id}` }
    : { name: from, what: "", href: "/dashboard/settings" };

  await db.activityEvent.create({
    data: {
      organizationId,
      clientId: clientExact?.id ?? null,
      kind: "SMS_REPLY",
      summary: `${who.name} texted: "${clip(body, 140)}"`,
      meta: JSON.stringify({ href: who.href, from, sid }),
    },
  }).catch(() => null);
  // The office hears it now; the sender is not texted their own words back.
  if (who.what !== "office") await textOfficeNow(organizationId, replyForwardLine(who.name, who.what, body), { excludePhones: [from], kind: "reply-forward" });
  return twiml();
}

function digits(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
}
function sameNumber(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && digits(a) === digits(b);
}
/** The ways a US number is typed: +12065550100, 2065550100, (206) 555-0100, 206-555-0100. */
function variants(e164: string): string[] {
  const d = digits(e164);
  if (d.length !== 10) return [e164];
  return [e164, d, `1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`, `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`];
}
