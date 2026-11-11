// /api/email/unsubscribe?o=<orgId>[&e=<address>]&t=<hmac> (2026-10-08; lib/adminMail/optout).
//
// GET shows a page with one button — it never unsubscribes by itself: mail
// security scanners open every link in a message, and a GET that acted
// would unsubscribe people who never asked. POST does it: from that page's
// button, or straight from the mail client's own Unsubscribe button (RFC
// 8058 one-click, body "List-Unsubscribe=One-Click"). A bad or missing
// token changes nothing.
//
// 2026-11-11: POST also puts the address on the do-not-email list (lib/mailBlock, source "link") — the address the
// link names, else the account owner's. `o` may be an account, `prospect_<id>` (lib/outreach) or `home_<id>` (a
// homeowner's dashboard reminders).
import { db } from "@/lib/db";
import { ownerEmails, verifyUnsubscribe, writeOptOut } from "@/lib/adminMail/optout";
import { writeMailBlock } from "@/lib/mailBlock";
import { normalizeEmail } from "@/lib/mailBlockShared";

export const dynamic = "force-dynamic";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · JobFlex</title></head>
<body style="margin:0;background:#f2f0eb;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<main style="max-width:480px;margin:12vh auto 0;padding:28px 24px;background:#fff;border:2px solid #0a0a0a;">
<p style="margin:0 0 6px;font:700 12px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#6a6a6a;">JobFlex</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

type Kind = "account" | "prospect" | "home";
interface Target {
  orgId: string;
  token: string;
  /** The address in the link, when it names one. */
  email: string | null;
  kind: Kind;
  business: string;
}

async function target(url: URL): Promise<Target | null> {
  const orgId = (url.searchParams.get("o") ?? "").slice(0, 64);
  const token = (url.searchParams.get("t") ?? "").slice(0, 64);
  const email = normalizeEmail(url.searchParams.get("e"));
  if (!orgId || !verifyUnsubscribe(orgId, token, email)) return null;
  // A contractor JobFlex wrote to who has no account (lib/outreach: "prospect_<id>").
  if (orgId.startsWith("prospect_")) return { orgId, token, email, kind: "prospect", business: "this address" };
  if (orgId.startsWith("home_")) return { orgId, token, email, kind: "home", business: "your home dashboard" };
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } }).catch(() => null);
  return { orgId, token, email, kind: "account", business: org?.name ?? "your account" };
}

/** The addresses this link stands for. */
async function addressesOf(t: Target): Promise<string[]> {
  if (t.email) return [t.email];
  if (t.kind === "prospect") {
    const { readProspect } = await import("@/lib/outreach/store");
    const p = await readProspect(t.orgId.slice("prospect_".length)).catch(() => null);
    return p?.email ? [p.email] : [];
  }
  if (t.kind === "home") {
    const h = await db.home.findUnique({ where: { id: t.orgId.slice("home_".length) }, select: { email: true } }).catch(() => null);
    return h?.email ? [h.email] : [];
  }
  return ownerEmails(t.orgId);
}

const BAD = () => page("This link doesn't work", `<p style="margin:0;">It may have been cut off by your mail app. Reply to any email from us with the word “unsubscribe” and we'll take you off the list.</p>`, 400);

const KEEPS = "Sign-in codes, billing notices, receipts and letters about your own jobs still arrive.";

export async function GET(req: Request) {
  const t = await target(new URL(req.url));
  if (!t) return BAD();
  const action = `/api/email/unsubscribe?o=${encodeURIComponent(t.orgId)}${t.email ? `&e=${encodeURIComponent(t.email)}` : ""}&t=${encodeURIComponent(t.token)}`;
  const who = t.email ? esc(t.email) : t.kind === "account" ? `the owner of ${esc(t.business)}` : "this address";
  return page("Unsubscribe from JobFlex emails?", `<p style="margin:0 0 18px;">We'll stop marketing emails and reminders to ${who} through JobFlex — ours and the businesses' on it. ${KEEPS}</p>
<form method="post" action="${esc(action)}"><input type="hidden" name="from" value="page"><button type="submit" style="min-height:46px;padding:0 20px;border:2px solid #0a0a0a;background:#1854a0;color:#fff;font:700 15px/1 inherit;cursor:pointer;">Unsubscribe</button></form>`);
}

export async function POST(req: Request) {
  const t = await target(new URL(req.url));
  if (!t) return BAD();
  const form = await req.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  await writeOptOut(t.orgId, oneClick ? "one-click" : "page");
  const reason = t.kind === "prospect" ? "Unsubscribe link in a JobFlex outreach email" : t.kind === "home" ? "Unsubscribe link in a home dashboard reminder" : "Unsubscribe link in a JobFlex email";
  for (const email of await addressesOf(t)) await writeMailBlock(email, { source: "link", reason: oneClick ? `${reason} (one-click)` : reason, orgId: t.kind === "account" ? t.orgId : null });
  // A contractor who stops our emails is not called by JobFlex either.
  if (t.kind === "prospect") {
    const { updateProspect } = await import("@/lib/outreach/store");
    await updateProspect(t.orgId.slice("prospect_".length), (p) => (p.dnc ? p : { ...p, dnc: { at: new Date().toISOString(), via: "email" } })).catch(() => null);
  }
  // The mail client's one-click needs only a 2xx; a person gets the page.
  return oneClick ? new Response(null, { status: 200 }) : page("You're unsubscribed", `<p style="margin:0;">We won't send ${t.email ? esc(t.email) : esc(t.business)} these emails again. ${KEEPS} If that was a mistake, just reply to any of our emails.</p>`);
}
