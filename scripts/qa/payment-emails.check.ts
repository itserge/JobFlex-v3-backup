// THE PAYMENT LETTERS (owner, 2026-10-16: "doesn't look like we're just chasing their money — they need JobFlex more
// than we need their money"): lib/email/build/billing buildPaymentFailed leads with the shop's own work, says the
// amount once in passing, and is plain about what happens next.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/payment-emails.check.ts
//   With --db: the hourly "two days left" sweep on a COPY of a local database, mail into EMAIL_DEV_OUTBOX:
//   DATABASE_URL=file:<copy> EMAIL_DEV_OUTBOX=<dir> NODE_PATH=<stub with server-only> npx … payment-emails.check.ts --db
import { buildPaymentFailed, type ShopOnJobflex } from "../../src/lib/email/build/billing";
import { buildTrialEndingSoon } from "../../src/lib/email/build/trial";
import { firstChargeFailed, firstPeriodAfterTrial, mirrorPeriodEnd } from "../../src/lib/stripeStatus";
import { planLapsed } from "../../src/lib/planStatus";
import { cardTrialReminderDue } from "../../src/lib/trialEndingMail";
import type Stripe from "stripe";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const shop: ShopOnJobflex = { proposalsSent: 6, quotedCents: 1840000, clients: 14, jobsOpen: 3, leadsOffered: 0 };
const tools = ["Smart proposal generation", "Roof estimator", "Fence estimator"];
const base = { name: "Jordan Rivera", planName: "Professional", amountCents: 9500, href: "https://jobflex.app/dashboard/subscription" };
const all = (d: ReturnType<typeof buildPaymentFailed>) => [d.subject, d.headline, ...(d.prose ?? []), ...(d.after ?? [])].join(" ");
const boxText = (d: ReturnType<typeof buildPaymentFailed>) => (d.box ?? []).map((r) => ("label" in r ? `${r.label}: ${"value" in r ? r.value : "chip" in r ? r.chip : ""}` : "")).join(" | ");

const first = buildPaymentFailed({ ...base, nextAttemptAt: new Date("2026-10-25T17:00:00Z"), final: false, shop, tools });
check("first letter: the subject and headline are about the shop, not the money", !/\$/.test(first.subject) && /shop/i.test(first.subject) && first.headline === "Keep your shop running" && first.cta?.label === "Keep my shop running", first.subject);
check("…the amount is said once, in passing", (all(first).match(/\$95/g) ?? []).length === 1);
check("…nothing locked, nothing lost; the shop's own numbers lead", /Nothing is locked and nothing is lost/.test(all(first)) && /6 · \$18,400 quoted/.test(boxText(first)) && /Clients: 14/.test(boxText(first)) && /Jobs on the schedule: 3/.test(boxText(first)));
check("…a zero is never shown (no leads row)", !/Homeowner leads/.test(boxText(first)));
check("…the shop is open, and the next try is dated", /Open — nothing paused/.test(boxText(first)) && /Oct 25, 2026/.test(all(first)));
check("…no 'final', 'Free' or pressure words", !/Free|final|immediately|urgent|suspend|overdue/i.test(all(first)));

const fresh = buildPaymentFailed({ ...base, nextAttemptAt: new Date("2026-10-25T17:00:00Z"), final: false, shop: { proposalsSent: 0, quotedCents: 0, clients: 0, jobsOpen: 0, leadsOffered: 0 }, tools });
check("a brand-new shop (no numbers): the plan's own tools stand in", /In Professional: Smart proposal generation, Roof estimator and Fence estimator/.test(boxText(fresh)) && /right where you left them/.test(all(fresh)));

const last = buildPaymentFailed({ ...base, nextAttemptAt: null, final: true, shop, tools });
check("last letter: 'Everything you built is still here', Professional paused, on Free for now", last.headline === "Everything you built is still here" && /paused Professional and your shop is on the Free plan for now/.test(all(last)) && !/\$/.test(last.subject));
check("…nothing deleted, clients can still open and sign what was sent", /Nothing is deleted, and your clients can still open and sign/.test(all(last)));
check("…what's paused, short in the box and named in the text", /Paused for now: 3 Professional tools/.test(boxText(last)) && /Smart proposal generation, Roof estimator and Fence estimator come straight back/.test(all(last)));
check("…the way back, and a smaller plan offered", last.cta?.label === "Turn Professional back on" && /Need something smaller/.test(all(last)));

// The first charge after a trial (owner, 2026-10-16: a short grace, not instantly).
const pf = buildPaymentFailed({ ...base, nextAttemptAt: new Date("2026-10-24T17:00:00Z"), final: false, shop, tools, pausesAt: new Date("2026-10-25T17:00:00Z") });
check("first charge after the trial: 'Fully open until Oct 25', and what happens then — nothing deleted", /Your shop: Fully open until Oct 25/.test(boxText(pf)) && /Your shop stays fully open until Oct 25\. If the card hasn't gone through by then, the Professional tools pause until it does — nothing is deleted/.test(all(pf)));
check("…says the free week is over and it's the first month; the amount still once", /your free week is over, and your bank didn't approve the first month of Professional \(\$95\)/.test(all(pf)) && (all(pf).match(/\$95/g) ?? []).length === 1);
check("…a renewal says no pause date", !/until Oct/.test(all(first)) && /Open — nothing paused/.test(boxText(first)));

const T = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const fake = (o: Record<string, unknown>) => ({ items: { data: [] }, ...o }) as unknown as Stripe.Subscription;
const trialEnd = T("2026-10-22T17:00:00Z");
const firstFail = fake({ status: "past_due", trial_end: trialEnd, current_period_start: trialEnd + 60, current_period_end: T("2026-11-22T17:00:00Z") });
const renewalFail = fake({ status: "past_due", trial_end: trialEnd, current_period_start: T("2026-11-22T17:00:00Z"), current_period_end: T("2026-12-22T17:00:00Z") });
const firstPaid = fake({ status: "active", trial_end: trialEnd, current_period_start: trialEnd, current_period_end: T("2026-11-22T17:00:00Z") });
check("the first period after the trial is told from a renewal", firstPeriodAfterTrial(firstFail) && !firstPeriodAfterTrial(renewalFail) && firstChargeFailed(firstFail) && !firstChargeFailed(renewalFail) && !firstChargeFailed(firstPaid));
check("…a failed first charge mirrors the trial's end as the period end; a renewal and a paid one keep Stripe's", mirrorPeriodEnd(firstFail)?.toISOString() === "2026-10-22T17:00:00.000Z" && mirrorPeriodEnd(renewalFail)?.toISOString() === "2026-12-22T17:00:00.000Z" && mirrorPeriodEnd(firstPaid)?.toISOString() === "2026-11-22T17:00:00.000Z");
const row = (sub: Stripe.Subscription) => ({ status: "PAST_DUE", currentPeriodEnd: mirrorPeriodEnd(sub), trialEndsAt: new Date(trialEnd * 1000) });
check("…the never-paid shop keeps the plan 3 days, then the tools pause", !planLapsed(row(firstFail), new Date("2026-10-25T16:00:00Z")) && planLapsed(row(firstFail), new Date("2026-10-25T18:00:00Z")));
check("…a paying shop whose renewal failed keeps its paid month", !planLapsed(row(renewalFail), new Date("2026-12-01T00:00:00Z")));

// Two days left (owner, 2026-10-16).
const soon = buildTrialEndingSoon({ name: "Jordan Rivera", planName: "Professional", price: "$95/month", endsAt: new Date("2026-10-22T17:00:00Z"), href: "https://jobflex.app/dashboard/subscription", shop, tools });
check("two days left: their first week leads, then the day and the price", soon.headline === "Here's your first week" && /6 · \$18,400 quoted/.test(boxText(soon)) && /From Oct 22: Professional · \$95\/month/.test(boxText(soon)) && !/\$/.test(soon.subject) && /continues Oct 22/.test(soon.subject));
check("…nothing to do if it fits; another plan or cancel before the day and nothing is charged", /Nothing to do if Professional fits/.test(all(soon)) && /Cancel on the Subscription page before Oct 22 and nothing is charged/.test(all(soon)) && soon.cta?.label === "Review my plan");
const soonNew = buildTrialEndingSoon({ name: "Jordan", planName: "Professional", price: "$95/month", endsAt: new Date("2026-10-22T17:00:00Z"), href: "x", shop: { proposalsSent: 0, quotedCents: 0, clients: 0, jobsOpen: 0, leadsOffered: 0 }, tools });
check("…nothing set up yet: the tools are ready whenever they are", soonNew.headline === "Professional continues on Oct 22" && /are ready whenever you are/.test(all(soonNew)));
const now = new Date("2026-10-20T17:30:00Z");
const r = (o: Partial<Parameters<typeof cardTrialReminderDue>[0]>) => ({ status: "TRIALING", provider: "STRIPE", externalSubId: "sub_1", trialEndsAt: new Date("2026-10-22T17:00:00Z"), canceledAt: null, ...o });
check("who gets it: a card trial within 48 hours, still carrying on", cardTrialReminderDue(r({}), now, false));
check("…not 3 days out, not past, not cancelled, not a card-less trial, not a manual plan", !cardTrialReminderDue(r({ trialEndsAt: new Date("2026-10-23T18:00:00Z") }), now, false) && !cardTrialReminderDue(r({ trialEndsAt: new Date("2026-10-20T17:00:00Z") }), now, false) && !cardTrialReminderDue(r({ canceledAt: new Date() }), now, false) && !cardTrialReminderDue(r({}), now, true) && !cardTrialReminderDue(r({ provider: "MANUAL" }), now, false) && !cardTrialReminderDue(r({ status: "ACTIVE" }), now, false));

async function dbPart() {
  const url = process.env.DATABASE_URL ?? "";
  const outbox = process.env.EMAIL_DEV_OUTBOX ?? "";
  if (!/^file:/.test(url) || !outbox) throw new Error("Refusing: --db needs a local SQLite copy and EMAIL_DEV_OUTBOX.");
  const { readdirSync, readFileSync } = await import("node:fs");
  const { db } = await import("../../src/lib/db");
  const { runCardTrialReminders } = await import("../../src/lib/trialEndingMail");
  const now = new Date();
  const stamp = Date.now();
  const made: Array<{ org: string; user: string }> = [];
  const shopWith = async (tag: string, email: string, sub: { trialEndsAt: Date; canceledAt?: Date | null }) => {
    const u = await db.user.create({ data: { email, name: `Pat ${tag}` } });
    const o = await db.organization.create({ data: { name: `QA trial ${tag}`, slug: `qa-trial-${tag}-${stamp}` } });
    await db.membership.create({ data: { userId: u.id, organizationId: o.id, role: "OWNER" } });
    await db.subscription.create({ data: { organizationId: o.id, plan: "PROFESSIONAL", status: "TRIALING", provider: "STRIPE", externalSubId: `sub_qa_${tag}_${stamp}`, trialEndsAt: sub.trialEndsAt, canceledAt: sub.canceledAt ?? null } });
    made.push({ org: o.id, user: u.id });
    return o.id;
  };
  try {
    await shopWith("due", `pat-due-${stamp}@example.com`, { trialEndsAt: new Date(now.getTime() + 30 * 3600_000) });
    await shopWith("far", `pat-far-${stamp}@example.com`, { trialEndsAt: new Date(now.getTime() + 60 * 3600_000) });
    await shopWith("cancelled", `pat-cancel-${stamp}@example.com`, { trialEndsAt: new Date(now.getTime() + 30 * 3600_000), canceledAt: new Date() });
    await shopWith("qa", `pat-${stamp}@qa.jobflex.test`, { trialEndsAt: new Date(now.getTime() + 30 * 3600_000) });
    const before = readdirSync(outbox).length;
    const r1 = await runCardTrialReminders(now);
    const files = readdirSync(outbox).slice(before);
    const mail = files.map((f) => readFileSync(`${outbox}/${f}`, "utf8")).join("\n");
    // The copy may hold other trials of its own; only these four shops are judged.
    const to = (who: string) => mail.includes(`pat-${who}-${stamp}@example.com`);
    check("the hourly sweep: the trial ending in ~30 h gets its letter; not 60 h, not a cancelled one, not a QA address", r1.sent >= 1 && to("due") && !to("far") && !to("cancel") && !mail.includes(`pat-${stamp}@qa.jobflex.test`), JSON.stringify(r1));
    check("…the letter is 'two days left' with the plan and the price", /Professional continues on|Here&#x27;s your first week|Here's your first week/.test(mail) && /Cancel in Settings/.test(mail));
    const r2 = await runCardTrialReminders(new Date(now.getTime() + 3600_000));
    check("…and once only: the next hour writes nothing", r2.sent === 0, JSON.stringify(r2));
  } finally {
    for (const m of made) {
      await db.syncState.deleteMany({ where: { key: { startsWith: "trialEndingMail:sub_qa_" } } });
      await db.subscription.deleteMany({ where: { organizationId: m.org } });
      await db.membership.deleteMany({ where: { organizationId: m.org } });
      await db.organization.delete({ where: { id: m.org } });
      await db.user.delete({ where: { id: m.user } });
    }
    await db.$disconnect();
  }
}

(async () => {
  if (process.argv.includes("--db")) await dbPart();
  if (bad) {
    console.log(`\n${bad} FAILED`);
    process.exit(1);
  }
  console.log("\nall passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
