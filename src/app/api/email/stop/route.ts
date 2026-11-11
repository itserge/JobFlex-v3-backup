// /api/email/stop?r=<recipient | a.<company+address>>&t=<hmac> — the Unsubscribe link at the bottom of a company's
// campaign email (Smart CRM part 6, 2026-11-10) and, since 2026-11-11, of its follow-ups, review requests and
// SmartBook letters (lib/winback/optout).
//
// GET shows a page with one button and never unsubscribes by itself: mail security scanners open every link in a
// message, and a GET that acted would unsubscribe people who never asked. POST does it — from that page's button,
// or straight from the mail app's own Unsubscribe button (RFC 8058 one-click, body "List-Unsubscribe=One-Click").
// A bad or missing token changes nothing. It stops that company's letters (ClientEmailOptOut) and puts the address on
// the do-not-email list (lib/mailBlock); receipts, invoices and sign-in links still go.
import { stopTarget, writeStop } from "@/lib/winback/optout";

export const dynamic = "force-dynamic";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f2f0eb;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<main style="max-width:480px;margin:12vh auto 0;padding:28px 24px;background:#fff;border:2px solid #0a0a0a;">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

const tokenOf = (url: URL) => (url.searchParams.get("t") ?? "").slice(0, 64);

async function target(url: URL) {
  const r = (url.searchParams.get("r") ?? "").slice(0, 400);
  const t = tokenOf(url);
  return r && t ? stopTarget(r, t) : null;
}

const BAD = () => page("This link doesn't work", `<p style="margin:0;">It may have been cut off by your mail app. Reply to the email and ask to be taken off the list.</p>`, 400);

const KEEPS = "Invoices, receipts and sign-in links still arrive.";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const t = await target(url);
  if (!t) return BAD();
  if (t.already) return page("You're already off the list", `<p style="margin:0;">${esc(t.company)} won't send ${esc(t.email)} these emails.</p>`);
  const action = `/api/email/stop?r=${encodeURIComponent(t.ref)}&t=${encodeURIComponent(tokenOf(url))}`;
  return page(
    `Stop emails from ${t.company}?`,
    `<p style="margin:0 0 18px;">${esc(t.company)} won't email ${esc(t.email)} any more — no news, offers, reminders or follow-ups — and no other business on JobFlex will either. ${KEEPS}</p>
<form method="post" action="${esc(action)}"><input type="hidden" name="from" value="page"><button type="submit" style="min-height:46px;padding:0 20px;border:2px solid #0a0a0a;background:#1854a0;color:#fff;font:700 15px/1 inherit;cursor:pointer;">Unsubscribe</button></form>`,
  );
}

export async function POST(req: Request) {
  const t = await target(new URL(req.url));
  if (!t) return BAD();
  const form = await req.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  await writeStop({ ...t, company: t.company }, oneClick ? "one-click" : "page");
  // The mail app's one-click needs only a 2xx; a person gets the page.
  return oneClick ? new Response(null, { status: 200 }) : page("You're unsubscribed", `<p style="margin:0;">${esc(t.email)} won't get these emails again. ${KEEPS} If that was a mistake, reply to any of ${esc(t.company)}'s emails.</p>`);
}
