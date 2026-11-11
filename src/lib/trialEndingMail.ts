// "TWO DAYS LEFT" FOR A TRIAL THAT TOOK A CARD (owner, 2026-10-16). A card trial turns into the paid plan by itself
// when it ends; ~48 hours before, the owner hears it once (lib/email/build/trial buildTrialEndingSoon) — what the shop
// set up in its first week, the day, the price, and the two ways out. Card-less trials have their own two letters
// (lib/cardlessTrial runCardlessTrialSweep); one that has since taken a card is a card trial, and is ours.
// Run hourly from /api/cron/trials. Each trial is written to once — the SyncState row is taken before the send.
import { db } from "@/lib/db";
import { readCardlessRecord } from "@/lib/trialState";
import { isQaEmail } from "@/lib/qaEmail";

const HOUR_MS = 60 * 60 * 1000;
export const TRIAL_ENDING_WINDOW_MS = 48 * HOUR_MS;
export const trialEndingKey = (subId: string, endsAt: Date) => `trialEndingMail:${subId}:${endsAt.toISOString()}`;

export type TrialReminderRow = {
  status: string;
  provider: string;
  externalSubId: string | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
};

/** Is this subscription a card trial ending within two days, still set to carry on? (Pure.) */
export function cardTrialReminderDue(row: TrialReminderRow, now: Date, cardlessWithoutCard: boolean): boolean {
  if (row.status !== "TRIALING" || row.provider !== "STRIPE" || !row.externalSubId || !row.trialEndsAt) return false;
  if (row.canceledAt) return false; // the switch to Free is booked: the trial won't carry on
  if (cardlessWithoutCard) return false; // the card-less trial's own letters
  const left = row.trialEndsAt.getTime() - now.getTime();
  return left > 0 && left <= TRIAL_ENDING_WINDOW_MS;
}

/** "$95/month" from the subscription's own Stripe price, else the catalog. */
async function priceWords(stripePriceId: string | null, planSlug: string): Promise<string> {
  const price = stripePriceId ? await db.planPrice.findUnique({ where: { stripePriceId }, select: { unitAmountCents: true, interval: true } }).catch(() => null) : null;
  let cents = price?.unitAmountCents ?? null;
  const per = price?.interval === "YEAR" ? "year" : "month";
  if (cents == null) {
    const { getPlanCatalog } = await import("@/lib/planCatalogServer");
    cents = (await getPlanCatalog({ includeInactive: true })).find((p) => p.slug === planSlug.toLowerCase())?.priceCents ?? 0;
  }
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}/${per}`;
}

export async function runCardTrialReminders(now = new Date()): Promise<{ scanned: number; sent: number }> {
  const rows = await db.subscription.findMany({
    where: { status: "TRIALING", provider: "STRIPE", canceledAt: null, trialEndsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_ENDING_WINDOW_MS) } },
    select: { organizationId: true, status: true, provider: true, externalSubId: true, trialEndsAt: true, canceledAt: true, plan: true, stripePriceId: true },
  });
  const out = { scanned: rows.length, sent: 0 };
  if (!rows.length) return out;
  const [{ appBaseUrl }, { renderEmail }, { sendEmail }, { buildTrialEndingSoon }, { ownerContact, shopOnJobflex, planTools }, { getPlanDisplayName }] = await Promise.all([
    import("@/lib/appUrl"),
    import("@/lib/email/renderEmail"),
    import("@/lib/sdk/resend"),
    import("@/lib/email/build/trial"),
    import("@/lib/cardUpdate"),
    import("@/lib/planCatalogServer"),
  ]);
  const base = (await appBaseUrl()).replace(/\/$/, "");
  for (const row of rows) {
    try {
      const cardless = await readCardlessRecord(row.organizationId).catch(() => null);
      if (!cardTrialReminderDue(row, now, Boolean(cardless && !cardless.cardAt))) continue;
      const to = await ownerContact(row.organizationId);
      if (!to || isQaEmail(to.email)) continue;
      try {
        await db.syncState.create({ data: { key: trialEndingKey(row.externalSubId!, row.trialEndsAt!), cursor: now.toISOString() } });
      } catch {
        continue; // already written to
      }
      const [planName, price, shop, tools] = await Promise.all([
        getPlanDisplayName(row.plan).catch(() => row.plan),
        priceWords(row.stripePriceId, row.plan),
        shopOnJobflex(row.organizationId, now),
        planTools(row.plan),
      ]);
      const { subject, html } = renderEmail(
        buildTrialEndingSoon({ name: to.name, planName, price, endsAt: row.trialEndsAt!, href: `${base}/dashboard/subscription`, shop, tools }),
      );
      await sendEmail({ mailClass: "transactional", to: to.email, subject, html, kind: "dunning" });
      out.sent++;
    } catch (err) {
      console.warn(`[trial-ending] ${row.organizationId}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
