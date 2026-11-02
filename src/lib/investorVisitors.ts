import "server-only";
// THE INVESTOR LINK'S READERS AND OFFERS (2026-10-13) — who introduced themselves on /investors/<token>, how often
// they came back, and the VC offers sent from the page. Kept as SyncState JSON lists (no schema change), newest
// first. A reader's pass is a cookie signed with the auth secret AND the link's token, so a new link asks again and a
// cookie cannot be made up. Every introduction and every offer is emailed to the platform admins (the support
// recipients); an offer is sent with the investor's address as reply-to, so answering is one click.
//
// THE DOOR IS FOR EVERYONE (owner, 2026-10-14: "before anyone opens the link they need to submit who they are, and
// then they see the stats"): a signed-in admin goes through it too, to see the page as a reader does. Their entry is
// marked `admin` — kept out of the reader list and the office feed, and nobody is emailed about it; a test offer
// from them is emailed, marked as a test, so the whole way through can be tried.
//
// NOTHING OPENS UNTIL WE SAY YES (owner, 2026-10-20: "don't open the link till we approve it … send SMS to us … we will
// review their info, who they are, and approve it, and they will get it"). A new reader is kept as a request
// (status "pending"): the admins are emailed and texted ("Investor link requests" on the /admin/tasks team sheet), the
// reader's page waits and opens on its own the moment an admin approves; the approval email carries a personal open
// link (signed with the link's token, so a new link ends it too) for any other device. The same email typed again in
// another browser is not let in on the strength of the address — that address is sent an open link instead. An admin
// is never kept waiting (kept so on 2026-11-02, said so on the door); the switch "Approve each reader" (lib/investors
// approveReaders) turns all of it off.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { appBaseUrl } from "@/lib/appUrl";
import { platformAlertRecipients } from "@/lib/integrationsAlertRecipients";
import { INVESTING_KINDS, statusOf, type InvestorIntroInput, type InvestorOfferInput, type InvestorVisitorView, type ReaderStatus } from "@/lib/investorGate";
import { fireAdminAlert } from "@/lib/adminAlerts";

const VISITORS_KEY = "investorVisitors";
const OFFERS_KEY = "investorOffers";
export const INVESTOR_PASS_COOKIE = "jf_inv";
const PASS_DAYS = 180;
const VISIT_GAP_MS = 30 * 60_000;

export interface InvestorVisitor extends InvestorVisitorView {
  id: string;
  at: string;
  lastSeen: string;
  visits: number;
  /** The link it was made on (its making time) — a new link starts a new list of readers. */
  linkMadeAt: string | null;
  /** When an admin let them in or turned them away, and who. */
  decidedAt?: string;
  decidedBy?: string;
}

export interface InvestorOffer extends InvestorOfferInput {
  id: string;
  at: string;
  visitorId: string | null;
  /** Sent by a signed-in admin trying the page: a test, not an offer. */
  admin?: boolean;
}

async function readList<T>(key: string): Promise<T[]> {
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (!row) return [];
  try {
    const v = JSON.parse(row.cursor) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
async function writeList<T>(key: string, list: T[], cap: number): Promise<void> {
  const cursor = JSON.stringify(list.slice(0, cap));
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

export const readInvestorVisitors = () => readList<InvestorVisitor>(VISITORS_KEY);
export const readInvestorOffers = () => readList<InvestorOffer>(OFFERS_KEY);

// ── the reader's pass ──
function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "jobflex-investor-pass";
}
function sign(id: string, exp: number, token: string): string {
  return createHmac("sha256", secret()).update(`${id}.${exp}.${token}`).digest("base64url");
}
function passFor(id: string, token: string): { value: string; maxAge: number } {
  const exp = Date.now() + PASS_DAYS * 86_400_000;
  return { value: `${id}.${exp}.${sign(id, exp, token)}`, maxAge: PASS_DAYS * 86_400 };
}
// ── the open link an approval sends (any device) ──
const OPEN_DAYS = 30;
function openSig(id: string, exp: number, token: string): string {
  return createHmac("sha256", secret()).update(`open:${id}.${exp}.${token}`).digest("base64url");
}
export function openKeyFor(id: string, token: string): string {
  const exp = Date.now() + OPEN_DAYS * 86_400_000;
  return `${id}.${exp}.${openSig(id, exp, token)}`;
}
/** The visitor an open link names, or null (forged, expired, another link's). */
export function verifyOpenKey(raw: string | null | undefined, token: string): string | null {
  if (!raw) return null;
  const [id, expS, sig] = raw.split(".");
  const exp = Number(expS);
  if (!id || !sig || !Number.isFinite(exp) || exp < Date.now()) return null;
  const want = Buffer.from(openSig(id, exp, token));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
async function setPass(id: string, token: string): Promise<void> {
  const pass = passFor(id, token);
  (await cookies()).set(INVESTOR_PASS_COOKIE, pass.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: pass.maxAge });
}
/** An open link followed: this browser gets the reader's pass — when they are let in. */
export async function openWithKey(token: string, key: string | null): Promise<"open" | "not-approved" | "bad"> {
  const id = verifyOpenKey(key, token);
  if (!id) return "bad";
  const v = (await readInvestorVisitors()).find((x) => x.id === id);
  if (!v) return "bad";
  if (statusOf(v) !== "approved") return "not-approved";
  await setPass(v.id, token);
  return "open";
}

/** The visitor id the cookie carries for this link, or null (none, forged, expired, another link's). */
export function verifyPass(raw: string | undefined | null, token: string): string | null {
  if (!raw) return null;
  const [id, expS, sig] = raw.split(".");
  const exp = Number(expS);
  if (!id || !sig || !Number.isFinite(exp) || exp < Date.now()) return null;
  const want = Buffer.from(sign(id, exp, token));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** The reader this browser introduced on this link — and a visit counted when they come back after a while. */
export async function visitorForLink(token: string, opts: { countVisit?: boolean } = {}): Promise<InvestorVisitor | null> {
  const id = verifyPass((await cookies()).get(INVESTOR_PASS_COOKIE)?.value, token);
  if (!id) return null;
  const list = await readInvestorVisitors();
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return null;
  const v = list[i];
  if (opts.countVisit && Date.now() - Date.parse(v.lastSeen) > VISIT_GAP_MS) {
    const next = { ...v, visits: v.visits + 1, lastSeen: new Date().toISOString() };
    list[i] = next;
    await writeList(VISITORS_KEY, list, 1000).catch(() => {});
    return next;
  }
  return v;
}

// ── the emails ──
async function tellAdmins(subject: string, headline: string, rows: Array<{ label: string; value: string }>, prose: string[], replyTo?: string, cta?: { label: string; href: string }): Promise<void> {
  const to = await platformAlertRecipients();
  if (!to.length) return;
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const { subject: subj, html } = renderEmail({
    subject,
    lockup: { kind: "platform" },
    kicker: { text: "Investor link", tone: "ok" },
    headline,
    prose,
    box: rows.filter((r) => r.value).map((r) => ({ type: "field" as const, label: r.label, value: r.value })),
    cta: cta ?? { label: "See who opened it", href: `${base}/admin/investors#audience` },
    footer: { name: "JobFlex" },
  });
  for (const address of to) {
    try {
      await sendEmail({ to: address, subject: subj, html, ...(replyTo ? { replyTo } : {}) });
    } catch (err) {
      console.error("[investors] admin email failed:", err instanceof Error ? err.message : err);
    }
  }
}

/** What the reader's door does next: the figures; a wait for our yes; an open link sent to the address they typed
 *  (it was let in before — elsewhere); or the polite no. */
export type IntroOutcome = "open" | "pending" | "check-email" | "declined";

const short = (t: string, n = 40) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** A reader introduces themselves. With approvals on, a new reader is a request — kept, the admins emailed and texted,
 *  this browser given its pass so the page can wait and open on its own. An admin's walk-through opens at once and is
 *  told to nobody; with approvals off, everyone does (and the admins hear as before). */
export async function introduceVisitor(token: string, linkMadeAt: string | null, input: InvestorIntroInput, opts: { admin?: boolean; approveReaders?: boolean } = {}): Promise<{ visitor: InvestorVisitor; outcome: IntroOutcome }> {
  const review = opts.approveReaders !== false && !opts.admin;
  const list = await readInvestorVisitors();
  const now = new Date().toISOString();
  // The same person on the same link (same email) is one reader who came back, not two — but an admin's walk-through and
  // a reader are never the same entry (2026-11-02): the email an admin tried the door with, typed in a browser no admin
  // is signed in to, is somebody's request and waits like one; an admin trying it never turns a reader into a test.
  const same = list.findIndex((v) => v.email === input.email && v.linkMadeAt === linkMadeAt && Boolean(v.admin) === Boolean(opts.admin));
  if (same >= 0) {
    const was = list[same];
    const st = statusOf(was);
    // Let in before, but this browser holds no pass: the address is not proof — the address gets an open link.
    if (review && st === "approved" && !was.admin) {
      await sendOpenEmail(was, token, "again").catch(() => {});
      return { visitor: was, outcome: "check-email" };
    }
    const visitor: InvestorVisitor = { ...was, name: input.name, company: input.company, kind: input.kind, phone: input.phone ?? was.phone, visits: was.visits + 1, lastSeen: now, admin: opts.admin || was.admin || undefined, ...(opts.admin || !review ? { status: st === "declined" && !opts.admin ? "declined" : "approved" } : {}) };
    list.splice(same, 1);
    await writeList(VISITORS_KEY, [visitor, ...list], 1000);
    await setPass(visitor.id, token);
    const now2 = statusOf(visitor);
    if (!visitor.admin && !review) await tellAdminsOpened(visitor, true).catch(() => {});
    return { visitor, outcome: now2 === "approved" ? "open" : now2 === "declined" ? "declined" : "pending" };
  }
  const status: ReaderStatus = review ? "pending" : "approved";
  const visitor: InvestorVisitor = { id: randomBytes(9).toString("base64url"), at: now, lastSeen: now, visits: 1, linkMadeAt, name: input.name, company: input.company, kind: input.kind, email: input.email, phone: input.phone ?? null, status, ...(opts.admin ? { admin: true } : {}) };
  await writeList(VISITORS_KEY, [visitor, ...list], 1000);
  await setPass(visitor.id, token);
  if (visitor.admin) return { visitor, outcome: "open" };
  if (!review) {
    await tellAdminsOpened(visitor, false).catch(() => {});
    return { visitor, outcome: "open" };
  }
  // A request: the admins hear by email and by text, each with the way straight to it.
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const where = `${base}/admin/investors?review=${encodeURIComponent(visitor.id)}#audience`;
  await tellAdmins(
    `Investor link request — ${visitor.name}, ${visitor.company}`,
    `${visitor.name} asks to see the investor figures`,
    [
      { label: "Name", value: visitor.name },
      { label: "Company", value: visitor.company },
      { label: "Business", value: visitor.kind },
      { label: "Email", value: visitor.email },
      { label: "Phone", value: visitor.phone ?? "" },
    ],
    [INVESTING_KINDS.has(visitor.kind) ? `An investor (${visitor.kind.toLowerCase()}) is waiting at the door.` : `They describe themselves as: ${visitor.kind.toLowerCase()}.`, "Nothing opens until you approve. Their page opens on its own the moment you do, and they get an email with their link."],
    undefined,
    { label: "Review the request", href: where },
  ).catch(() => {});
  await fireAdminAlert("investor", `JobFlex: investor link request — ${short(visitor.name, 30)}, ${short(visitor.company)} (${visitor.kind}). Approve or decline: ${where}`, `investor-request:${visitor.id}`).catch(() => 0);
  return { visitor, outcome: "pending" };
}

async function tellAdminsOpened(visitor: InvestorVisitor, again: boolean): Promise<void> {
  await tellAdmins(
    `Investor link opened — ${visitor.name}, ${visitor.company}`,
    again ? `${visitor.name} came back to the investor page` : `${visitor.name} opened the investor page`,
    [
      { label: "Name", value: visitor.name },
      { label: "Company", value: visitor.company },
      { label: "Business", value: visitor.kind },
      { label: "Email", value: visitor.email },
      { label: "Phone", value: visitor.phone ?? "" },
    ],
    [INVESTING_KINDS.has(visitor.kind) ? `An investor (${visitor.kind.toLowerCase()}) is reading the live figures now.` : `They describe themselves as: ${visitor.kind.toLowerCase()}.`],
  );
}

/** The reader's email: they are in, with their own open link (good on any device until the link is replaced). */
async function sendOpenEmail(v: InvestorVisitor, token: string, why: "approved" | "again"): Promise<void> {
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const href = `${base}/api/investors/${token}/open?k=${encodeURIComponent(openKeyFor(v.id, token))}`;
  const first = v.name.split(/\s+/)[0] || v.name;
  const { subject, html } = renderEmail({
    subject: why === "approved" ? "Your access to the JobFlex investor figures" : "Open the JobFlex investor figures on this device",
    lockup: { kind: "platform" },
    kicker: { text: "Investors", tone: "ok" },
    headline: why === "approved" ? `You're in, ${first}` : `Here is your link, ${first}`,
    prose: why === "approved"
      ? ["Thanks for introducing yourself. The live JobFlex figures — ad spend, trials, paying accounts and payback — are open to you now.", "The button opens them on any device; if the page you asked from is still open, it has opened already."]
      : ["Someone asked to open the JobFlex investor figures with this address in a new browser. If that was you, the button opens them there.", "If it wasn't you, ignore this email — nothing opens without it."],
    cta: { label: "Open the figures", href },
    footer: { name: "JobFlex" },
  });
  await sendEmail({ to: v.email, subject, html });
}

/** An admin's decision on a reader: let in (they are emailed their open link), turned away, or a door closed again. */
export async function decideVisitor(id: string, decision: "approve" | "decline", token: string | null, by: string): Promise<InvestorVisitor | null> {
  const list = await readInvestorVisitors();
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return null;
  const was = list[i];
  const status: ReaderStatus = decision === "approve" ? "approved" : "declined";
  const next: InvestorVisitor = { ...was, status, decidedAt: new Date().toISOString(), decidedBy: by };
  list[i] = next;
  await writeList(VISITORS_KEY, list, 1000);
  // Their email goes out only when the yes is news and the link they asked on is still the live one.
  if (decision === "approve" && statusOf(was) !== "approved" && token) await sendOpenEmail(next, token, "approved").catch((err) => console.error("[investors] open email failed:", err instanceof Error ? err.message : err));
  return next;
}

/** An offer from the page: kept, and emailed to the admins with the investor as reply-to. An admin's own test offer is
 *  kept marked as one and emailed as a test, so the whole way through can be tried. */
export async function recordOffer(visitorId: string | null, input: InvestorOfferInput, opts: { admin?: boolean } = {}): Promise<InvestorOffer> {
  const offer: InvestorOffer = { ...input, id: randomBytes(9).toString("base64url"), at: new Date().toISOString(), visitorId, ...(opts.admin ? { admin: true } : {}) };
  const list = await readInvestorOffers();
  await writeList(OFFERS_KEY, [offer, ...list], 300);
  const test = offer.admin ? "Test — " : "";
  await tellAdmins(
    `${test}VC offer — ${offer.company}: ${offer.amount} · ${offer.instrument}`,
    `${test}${offer.company} sent ${offer.type === "Term sheet" ? "a term sheet" : offer.type === "Intro call first" ? "a request for an intro call" : "an investment interest"}`,
    [
      { label: "From", value: `${offer.name} · ${offer.company}` },
      { label: "Email", value: offer.email },
      { label: "Phone", value: offer.phone ?? "" },
      { label: "What", value: offer.type },
      { label: "Amount", value: offer.amount },
      { label: "Instrument", value: offer.instrument },
      { label: "Valuation / cap", value: offer.valuation ?? "" },
      { label: "Timeline", value: offer.timeline },
    ],
    offer.message ? [`"${offer.message}"`, "Reply to this email to answer them directly."] : ["Reply to this email to answer them directly."],
    offer.email,
  ).catch(() => {});
  return offer;
}
