import "server-only";
// THE WIN-BACK (owner, 2026-10-08: "free trials that already expired — do it,
// make it smart, and offer 10% off once they are five days past due").
//
// A card-less trial that ended with no card (lib/cardlessTrial, TRIAL_ENDED)
// used to hear nothing more. Now, counted from the day it ended:
//   day 1   "your work is still there" — what they built, read-only, add a card;
//   day 3   "pick up where you left off";
//   day 5   THE OFFER: 10% off for three months, applied by itself at the card
//           step (a Stripe coupon on the restart Checkout), good for 14 days;
//   day 12  "last days of your 10% off" — a week after the offer mail, so a
//           trial that ended long ago gets the offer first, then this.
// One mail per shop per run, the furthest stage that is due (a shop found
// late gets the offer, not a backlog); nothing once a card restarts the plan;
// the record is SyncState `winback:<orgId>`. The coupon is made once per
// Stripe mode (SyncState `winbackCoupon:<mode>`), or pinned by
// WINBACK_COUPON_ID. Run every afternoon by api/cron/trial-winback.
import { db } from "@/lib/db";
import { cardlessTrialState } from "@/lib/trialState";
import { trialPlanSummary } from "@/lib/cardlessTrial";
import { buildWinback, type WinbackStage } from "@/lib/email/build/winback";
import { renderEmail } from "@/lib/email/renderEmail";

export const OFFER_PCT = 10;
export const OFFER_MONTHS = 3;
export const OFFER_DAYS = 14;
const PREFIX = "winback:";
const DAY_MS = 86_400_000;
export const WINBACK_STAGES: Array<{ key: WinbackStage; afterDays: number }> = [
  { key: "d1", afterDays: 1 },
  { key: "d3", afterDays: 3 },
  { key: "offer", afterDays: 5 },
  // The last word is counted from the OFFER mail, not the trial's end (day 12
  // in the normal run): a trial that ended long before the sweep existed gets
  // the offer first and the last word a week later, never "last days of your
  // 10% off" as the first thing it hears.
  { key: "last", afterDays: 12 },
];
export const LAST_AFTER_OFFER_DAYS = 7;

const offerMailedAt = (rec: WinbackRecord): number | null => {
  const at = rec.sent.offer;
  return at && !at.startsWith("skipped:") ? Date.parse(at) : null;
};

export interface WinbackRecord {
  endedAt: string;
  /** Stage → when it was mailed, or "skipped:<iso>" when a later stage was due first. */
  sent: Partial<Record<WinbackStage, string>>;
  offerSentAt?: string | null;
  offerUntil?: string | null;
}
export interface WinbackOffer { pct: number; months: number; until: string; couponId: string }

const parse = (text: string | null | undefined): WinbackRecord | null => {
  try {
    const r = text ? (JSON.parse(text) as Partial<WinbackRecord>) : null;
    return r && typeof r.endedAt === "string" ? { endedAt: r.endedAt, sent: r.sent && typeof r.sent === "object" ? r.sent : {}, offerSentAt: r.offerSentAt ?? null, offerUntil: r.offerUntil ?? null } : null;
  } catch {
    return null;
  }
};
export async function readWinback(orgId: string): Promise<WinbackRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: PREFIX + orgId }, select: { cursor: true } }).catch(() => null);
  return parse(row?.cursor);
}
async function writeWinback(orgId: string, rec: WinbackRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({ where: { key: PREFIX + orgId }, create: { key: PREFIX + orgId, cursor }, update: { cursor } });
}
/** The win-back records of many shops at once (the Trial watch). */
export async function readWinbacks(orgIds: string[]): Promise<Map<string, WinbackRecord>> {
  const out = new Map<string, WinbackRecord>();
  if (orgIds.length === 0) return out;
  const rows = await db.syncState.findMany({ where: { key: { in: orgIds.map((id) => PREFIX + id) } }, select: { key: true, cursor: true } }).catch(() => []);
  for (const r of rows) { const rec = parse(r.cursor); if (rec) out.set(r.key.slice(PREFIX.length), rec); }
  return out;
}

/** The 10%-off coupon, made once per Stripe mode — or the one WINBACK_COUPON_ID names. */
export async function ensureWinbackCoupon(): Promise<string> {
  const pinned = process.env.WINBACK_COUPON_ID?.trim();
  if (pinned) return pinned;
  const { getStripeClient } = await import("@/lib/sdk/stripe");
  const { stripe, mode } = await getStripeClient();
  const key = `winbackCoupon:${mode}`;
  const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } }).catch(() => null);
  if (row?.cursor) {
    try {
      const { id } = JSON.parse(row.cursor) as { id: string };
      const c = await stripe.coupons.retrieve(id);
      if (c && c.valid !== false) return id;
    } catch {
      /* gone on Stripe's side: make it again */
    }
  }
  const coupon = await stripe.coupons.create({ percent_off: OFFER_PCT, duration: "repeating", duration_in_months: OFFER_MONTHS, name: `Come back — ${OFFER_PCT}% off for ${OFFER_MONTHS} months` });
  await db.syncState.upsert({ where: { key }, create: { key, cursor: JSON.stringify({ id: coupon.id }) }, update: { cursor: JSON.stringify({ id: coupon.id }) } });
  return coupon.id;
}

/** The offer a shop can take right now: sent, not yet over, the trial still ended. Null otherwise. */
export async function winbackOffer(orgId: string, now = new Date()): Promise<WinbackOffer | null> {
  const rec = await readWinback(orgId);
  if (!rec?.offerUntil || Date.parse(rec.offerUntil) < now.getTime()) return null;
  const state = await cardlessTrialState(orgId, now).catch(() => null);
  if (!state || state.kind !== "ended") return null;
  const pinned = process.env.WINBACK_COUPON_ID?.trim();
  if (pinned) return { pct: OFFER_PCT, months: OFFER_MONTHS, until: rec.offerUntil, couponId: pinned };
  try {
    const { getStripeClient } = await import("@/lib/sdk/stripe");
    const { mode } = await getStripeClient();
    const row = await db.syncState.findUnique({ where: { key: `winbackCoupon:${mode}` }, select: { cursor: true } });
    const id = row?.cursor ? (JSON.parse(row.cursor) as { id: string }).id : null;
    return id ? { pct: OFFER_PCT, months: OFFER_MONTHS, until: rec.offerUntil, couponId: id } : null;
  } catch {
    return null;
  }
}

/** THE ADMIN'S OWN OFFER to an ended card-less trial (lib/adminMail,
 *  2026-10-08): the same 10% the day-5 mail carries, made real at the moment
 *  the admin sends it — the coupon exists, the record holds the offer until
 *  OFFER_DAYS from now (or keeps a longer one already running), and the
 *  sweep counts the admin's mail as its offer: it never sends a second
 *  offer, and its last word follows LAST_AFTER_OFFER_DAYS later. Throws when
 *  the trial has not ended or Stripe cannot make the coupon — no mail may
 *  promise a discount that is not there. */
export async function grantWinbackOffer(orgId: string, now = new Date()): Promise<{ until: string; existing: boolean }> {
  const state = await cardlessTrialState(orgId, now);
  if (!state || state.kind !== "ended") throw new Error("That trial has not ended — the come-back offer is for ended trials.");
  await ensureWinbackCoupon();
  const rec = (await readWinback(orgId)) ?? { endedAt: state.endedAt.toISOString(), sent: {} };
  const running = !!rec.offerUntil && Date.parse(rec.offerUntil) > now.getTime();
  if (!running) rec.offerUntil = new Date(now.getTime() + OFFER_DAYS * DAY_MS).toISOString();
  rec.offerSentAt = now.toISOString();
  for (const st of WINBACK_STAGES) {
    if (st.key === "offer") break;
    if (!rec.sent[st.key]) rec.sent[st.key] = `skipped:${now.toISOString()}`;
  }
  rec.sent.offer = now.toISOString();
  await writeWinback(orgId, rec);
  return { until: rec.offerUntil as string, existing: running };
}

/** What the shop made during its trial — the mail names it. */
async function built(orgId: string): Promise<{ clients: number; proposals: number; jobs: number }> {
  const [clients, proposals, jobs] = await Promise.all([
    db.client.count({ where: { organizationId: orgId } }).catch(() => 0),
    db.proposal.count({ where: { organizationId: orgId } }).catch(() => 0),
    db.job.count({ where: { organizationId: orgId } }).catch(() => 0),
  ]);
  return { clients, proposals, jobs };
}

export interface WinbackSweep { scanned: number; ended: number; mailed: Record<WinbackStage, number>; skipped: number; failed: number }

export async function runTrialWinbackSweep(now = new Date()): Promise<WinbackSweep> {
  const out: WinbackSweep = { scanned: 0, ended: 0, mailed: { d1: 0, d3: 0, offer: 0, last: 0 }, skipped: 0, failed: 0 };
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "cardlessTrial:" } }, select: { key: true } });
  out.scanned = rows.length;
  const { appBaseUrl } = await import("@/lib/appUrl");
  const { sendEmail } = await import("@/lib/sdk/resend");
  const base = (await appBaseUrl()).replace(/\/$/, "");
  for (const { key } of rows) {
    const orgId = key.slice("cardlessTrial:".length);
    try {
      const state = await cardlessTrialState(orgId, now);
      if (!state || state.kind !== "ended") continue;
      out.ended++;
      const rec = (await readWinback(orgId)) ?? { endedAt: state.endedAt.toISOString(), sent: {} };
      const daysSince = Math.floor((now.getTime() - Date.parse(rec.endedAt)) / DAY_MS);
      const due = WINBACK_STAGES.filter((s) => {
        if (rec.sent[s.key]) return false;
        if (s.key !== "last") return daysSince >= s.afterDays;
        const offerAt = offerMailedAt(rec);
        return offerAt !== null && now.getTime() - offerAt >= LAST_AFTER_OFFER_DAYS * DAY_MS;
      });
      if (due.length === 0) { out.skipped++; continue; }
      const stage = due[due.length - 1];
      for (const earlier of due.slice(0, -1)) rec.sent[earlier.key] = `skipped:${now.toISOString()}`;
      // They pressed Unsubscribe on one of our emails (lib/adminMail/optout): no more win-back.
      const { readOptOut } = await import("@/lib/adminMail/optout");
      if (await readOptOut(orgId)) { out.skipped++; continue; }
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true, memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { email: true, name: true } } } } } });
      const to = org?.memberships[0]?.user;
      if (!org || !to?.email) { out.skipped++; continue; }
      // The way out in the letter itself and JobFlex's postal address (lib/email/optOutFooter, 2026-11-11): the email
      // law asks for both in an offer like this, so without the address nothing is sent (and nothing is counted).
      const { jobflexOptOut, withOptOut } = await import("@/lib/email/optOutFooter");
      const foot = jobflexOptOut(base, orgId, to.email, `You're getting this because ${org.name} tried JobFlex.`);
      if (!foot.postal) {
        out.skipped++;
        console.warn("[winback] not sent: set JOBFLEX_POSTAL_ADDRESS — the email law asks for a postal address in this letter");
        continue;
      }
      let offer: { pct: number; months: number; until: string } | null = null;
      if (stage.key === "offer" || stage.key === "last") {
        if (!rec.offerUntil) {
          await ensureWinbackCoupon(); // throws when Stripe cannot make it: no offer mail without a real discount
          rec.offerUntil = new Date(now.getTime() + OFFER_DAYS * DAY_MS).toISOString();
          rec.offerSentAt = now.toISOString();
        }
        offer = { pct: OFFER_PCT, months: OFFER_MONTHS, until: rec.offerUntil };
      }
      const plan = await trialPlanSummary(orgId, state.record).catch(() => ({ name: "your plan", cents: 0, per: "mo" }));
      const doc = withOptOut(buildWinback({
        stage: stage.key, name: to.name, business: org.name, planName: plan.name, price: plan.cents > 0 ? `$${(plan.cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}${plan.per}` : "",
        built: await built(orgId), offer, href: `${base}/dashboard/trial`,
      }), foot);
      const { subject, html, text } = renderEmail(doc);
      // The plain-text twin and the mail client's own Unsubscribe button (2026-10-08). On the do-not-email list
      // (lib/mailBlock) the letter is left out — counted as skipped, and this stage is not tried again.
      const left = await sendEmail({ to: to.email, subject, html, text, headers: foot.headers, organizationId: orgId });
      if (left.skipped && left.id.startsWith("mail-block")) {
        rec.sent[stage.key] = `skipped:${now.toISOString()}`;
        await writeWinback(orgId, rec);
        out.skipped++;
        continue;
      }
      rec.sent[stage.key] = now.toISOString();
      await writeWinback(orgId, rec);
      out.mailed[stage.key]++;
    } catch (err) {
      out.failed++;
      console.warn("[winback] not sent:", orgId, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
