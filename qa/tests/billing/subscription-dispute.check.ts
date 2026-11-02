// A company disputes its JobFlex subscription charge with its bank (owner, 2026-10-29: "I am talking about the
// subscription dispute"): the team's "Disputes" text names the company and its plan — found from the disputed charge's
// customer through the subscription mirror — and says so again when it closes. A slow or failing Stripe still texts.
//   DATABASE_URL=file:<a local db> npx tsx --tsconfig tsconfig.json qa/tests/billing/subscription-dispute.check.ts
// Writes to the local dev database and puts everything back.
import "../_lib/_server-only";
import type Stripe from "stripe";
import { db } from "../../../src/lib/db";
import { alertDisputeClosed, alertDisputeOpened } from "../../../src/lib/adminAlertsPayments";
import { getPlanDisplayName } from "../../../src/lib/planCatalogServer";

let failures = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
};

const TEAM = "adminTeam:members:v1";

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/^file:|localhost|127\.0\.0\.1/.test(dbUrl)) throw new Error("Refusing: DATABASE_URL is not a local dev database.");
  const tag = `qa-subdispute-${Date.now()}`;
  const customer = `cus_${tag}`;
  const savedTeam = await db.syncState.findUnique({ where: { key: TEAM } });
  let orgId: string | null = null;
  try {
    await db.syncState.upsert({
      where: { key: TEAM },
      create: { key: TEAM, cursor: JSON.stringify([{ id: "m_qa", name: "QA", phone: "+15555550177", on: true, hours: null, addedAt: new Date().toISOString(), alerts: ["dispute"] }]) },
      update: { cursor: JSON.stringify([{ id: "m_qa", name: "QA", phone: "+15555550177", on: true, hours: null, addedAt: new Date().toISOString(), alerts: ["dispute"] }]) },
    });
    const org = await db.organization.create({ data: { name: `Summit Ridge Roofing ${tag}`, slug: tag } });
    orgId = org.id;
    await db.subscription.create({ data: { organizationId: org.id, plan: "PROFESSIONAL", status: "ACTIVE", externalCustomerId: customer } });
    const planName = await getPlanDisplayName("PROFESSIONAL");

    const dispute = (id: string, status: string, fee = 0) =>
      ({ id, object: "dispute", amount: 9500, currency: "usd", charge: `ch_${id}`, reason: "subscription_canceled", status, livemode: true, evidence_details: { due_by: Date.UTC(2026, 10, 8, 20) / 1000 }, balance_transactions: fee ? [{ fee }] : [] }) as unknown as Stripe.Dispute;
    const stripeWith = (retrieve: (id: string) => Promise<unknown>) => ({ charges: { retrieve } }) as unknown as Stripe;
    const ours = stripeWith(async (id) => ({ id, customer, billing_details: { name: null, email: null }, receipt_email: null }));
    const texts = async (id: string) => (await db.smsMessage.findMany({ where: { kind: "jobflex-admin-alert", body: { contains: id } }, orderBy: { createdAt: "asc" }, select: { to: true, body: true } }));

    const d1 = `dp_${tag}_1`;
    await alertDisputeOpened(dispute(d1, "needs_response"), true, ours);
    let t = await texts(d1);
    check("the chargeback text names the company and its plan", t.length === 1 && t[0].body.includes(org.name.slice(0, 40)) && t[0].body.includes(`(${planName})`) && t[0].body.includes("$95.00") && /CHARGEBACK/.test(t[0].body), t);
    check("…in plain words, with the deadline and the Stripe page", t[0]?.body.includes("says the plan was canceled") && t[0]?.body.includes("Nov 8") && t[0]?.body.includes(`https://dashboard.stripe.com/disputes/${d1}`), t[0]?.body);
    await alertDisputeOpened(dispute(d1, "needs_response"), true, ours);
    check("Stripe re-sending it (or funds_withdrawn after created): no second text", (await texts(d1)).length === 1);

    await alertDisputeClosed(dispute(d1, "lost", 1500), true, ours);
    t = await texts(d1);
    check("closed lost: the company, the amount, Stripe's fee", t.length === 2 && /LOST/.test(t[1].body) && t[1].body.includes(org.name.slice(0, 40)) && t[1].body.includes("$15.00"), t[1]);

    const d2 = `dp_${tag}_2`;
    await alertDisputeOpened(dispute(d2, "needs_response"), true, stripeWith(async () => { throw new Error("stripe down"); }));
    check("Stripe failing: the text still goes, as 'A customer'", (await texts(d2))[0]?.body.includes("A customer") === true, await texts(d2));

    const d3 = `dp_${tag}_3`;
    const started = Date.now();
    await alertDisputeOpened(dispute(d3, "needs_response"), true, stripeWith(() => new Promise(() => {})));
    const took = Date.now() - started;
    check("Stripe hanging: the text goes after the 3-second wait", (await texts(d3)).length === 1 && took < 6000, { took });
  } finally {
    await db.smsMessage.deleteMany({ where: { body: { contains: tag } } });
    await db.syncState.deleteMany({ where: { key: { contains: tag } } });
    if (orgId) {
      await db.subscription.deleteMany({ where: { organizationId: orgId } });
      await db.organization.deleteMany({ where: { id: orgId } });
    }
    if (savedTeam) await db.syncState.update({ where: { key: TEAM }, data: { cursor: savedTeam.cursor } });
    else await db.syncState.deleteMany({ where: { key: TEAM } });
    await db.$disconnect();
  }
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

void main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
