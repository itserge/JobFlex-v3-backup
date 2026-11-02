// THE PLATFORM ADMIN'S CANCEL (2026-11-01; lib/adminCancel) through the REAL
// actions (actions/adminSubscription) against the Stripe MOCK
// (lib/sdk/stripeMock) — no Stripe call, no mail out (the dev outbox).
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/admin-cancel.check.ts
//
// Throwaway companies (isInternal), their owners and a throwaway platform
// admin on the local database, removed at the end:
//
//   A · at the period end — Stripe holds cancel_at_period_end, the mirror
//       keeps its status and gets the end date, the owner's letter is in the
//       outbox, CancellationFeedback says ["admin"] by the admin with the
//       reason, the PLAN_CHANGE activity names it; a second cancel is refused;
//   B · Undo — cleared on Stripe and in the mirror;
//   C · immediately — Stripe cancelled with no proration and no invoice, the
//       mirror CANCELED (the Free plan), the "switched to Free" letter;
//   D · a grant (provider MANUAL) — refused, Stripe untouched;
//   E · a member who is not a platform admin — refused (cancel and undo),
//       Stripe untouched; a reason under 3 characters — refused.
import { actAs, check, outcome, summary } from "../_lib/_actionHarness";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { db } from "../../../src/lib/db";
import { readMockStore, writeMockStore, type MockStore, type MockSubscription } from "../../../src/lib/sdk/stripeMock";
import { adminCancelSubscription, adminUndoCancellation } from "../../../src/actions/adminSubscription";

// The harness runs the actions as production (every key blank, network off);
// the Stripe mock and the mail outbox are development-only, so this check
// steps back to development once the harness has set itself up.
const MOCK = path.join(os.tmpdir(), `jobflex-qa-admin-cancel-${process.pid}.json`);
const OUTBOX = path.join(os.tmpdir(), `jobflex-qa-admin-cancel-outbox-${process.pid}`);
(process.env as Record<string, string>).NODE_ENV = "development";
process.env.STRIPE_MOCK_FILE = MOCK;
process.env.EMAIL_DEV_OUTBOX = OUTBOX;

const tag = `qa-acancel-${Date.now()}`;
const DAY = 86400;
const PRICE = "price_qa_acancel_pro";
const made: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

async function company(letter: string, opts: { grant?: boolean } = {}) {
  const org = await db.organization.create({ data: { name: `${tag} ${letter}`, slug: `${tag}-${letter.toLowerCase()}`, isInternal: true } });
  const owner = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}@qa.test`, name: `Owner ${letter}`, activeOrgId: org.id } });
  await db.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  made.orgs.push(org.id);
  made.users.push(owner.id);
  const subId = `sub_${tag}_${letter}`;
  const periodEnd = Math.floor(Date.now() / 1000) + 20 * DAY;
  await db.subscription.create({
    data: opts.grant
      ? { organizationId: org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "MANUAL", currentPeriodEnd: new Date(periodEnd * 1000) }
      : {
          organizationId: org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE",
          externalCustomerId: `cus_${tag}_${letter}`, externalSubId: subId, stripePriceId: PRICE, currentPeriodEnd: new Date(periodEnd * 1000),
        },
  });
  return { org, owner, subId, periodEnd };
}
type Co = Awaited<ReturnType<typeof company>>;

function seedMock(cos: Co[]) {
  const now = Math.floor(Date.now() / 1000);
  const price = { id: PRICE, unit_amount: 7900, currency: "usd", recurring: { interval: "month", interval_count: 1 }, nickname: "JobFlex professional MONTH", metadata: { planSlug: "professional" }, active: true };
  const s: MockStore = { ...readMockStore(MOCK), account: { default_currency: "usd" }, prices: { [PRICE]: price }, customers: {}, subscriptions: {}, invoices: [], calls: [] };
  for (const c of cos) {
    const cus = `cus_${tag}_${c.org.name.slice(-1)}`;
    s.customers[cus] = { id: cus, email: c.owner.email, metadata: { organizationId: c.org.id }, balance: 0 };
    s.subscriptions[c.subId] = {
      id: c.subId, customer: cus, status: "active", created: now - 10 * DAY, currency: "usd",
      current_period_start: c.periodEnd - 30 * DAY, current_period_end: c.periodEnd,
      trial_start: null, trial_end: null, cancel_at_period_end: false, canceled_at: null, ended_at: null,
      metadata: { organizationId: c.org.id, planSlug: "professional", interval: "MONTH" },
      items: { data: [{ id: `si_${c.subId}`, price, quantity: 1 }] },
      discount: null, default_payment_method: "pm_qa", pause_collection: null,
    } as MockSubscription;
  }
  writeMockStore(MOCK, s);
}
const stripeSub = (id: string) => readMockStore(MOCK).subscriptions[id];
const writes = () => readMockStore(MOCK).calls.filter((c) => /\.(update|cancel|create)$/.test(c.method));
const letters = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).map((f) => fs.readFileSync(path.join(OUTBOX, f), "utf8")) : []);
const mirror = (orgId: string) => db.subscription.findUnique({ where: { organizationId: orgId } });

async function main() {
  const admin = await db.user.create({ data: { email: `${tag}-admin@qa.test`, name: "QA Admin", isPlatformAdmin: true } });
  made.users.push(admin.id);
  const a = await company("A");
  const c = await company("C");
  const g = await company("G", { grant: true });
  seedMock([a, c]);
  const asAdmin = () => actAs({ id: admin.id, activeOrgId: null });

  /* ── E. the gate first: nobody but a platform admin ── */
  actAs({ id: a.owner.id, activeOrgId: a.org.id });
  const e1 = await outcome(() => adminCancelSubscription(a.org.id, "now", "Owner tries the admin door", true));
  check("E · the company's own owner (not a platform admin) is refused", e1.refused, e1.text);
  const e2 = await outcome(() => adminUndoCancellation(a.org.id));
  check("E · … and refused Undo too", e2.refused, e2.text);
  actAs(null);
  const e3 = await outcome(() => adminCancelSubscription(a.org.id, "now", "Signed out", true));
  check("E · signed out — refused", e3.refused, e3.text);
  check("E · Stripe untouched by the refusals", writes().length === 0, writes().map((w) => w.method));
  asAdmin();
  const short = await outcome(() => adminCancelSubscription(a.org.id, "period_end", "no", true));
  check("E · a reason under 3 characters is refused", short.refused && /reason/i.test(short.text), short.text);
  check("E · … and changes nothing on Stripe", writes().length === 0);

  /* ── A. at the end of the paid period ── */
  const before = letters().length;
  const r = await adminCancelSubscription(a.org.id, "period_end", "Asked by phone — closing the shop", true);
  check("A · applied", r.ok, r);
  check("A · Stripe: cancel_at_period_end, still active", stripeSub(a.subId)?.cancel_at_period_end === true && stripeSub(a.subId)?.status === "active", stripeSub(a.subId));
  let m = await mirror(a.org.id);
  check("A · mirror: status unchanged, end date kept, canceledAt set", m?.status === "ACTIVE" && !!m.canceledAt && m.currentPeriodEnd?.getTime() === a.periodEnd * 1000, m);
  check("A · the card's state: booked, by this admin", r.ok && r.state.cancelsAtPeriodEnd && r.state.byAdmin?.name === "QA Admin", r.ok ? r.state : r);
  const fb = await db.cancellationFeedback.findFirst({ where: { organizationId: a.org.id }, orderBy: { createdAt: "desc" } });
  check("A · CancellationFeedback: [\"admin\"], userId = the admin, the reason, the period end", fb?.reasons === '["admin"]' && fb.userId === admin.id && fb.otherText === "Asked by phone — closing the shop" && fb.periodEnd?.getTime() === a.periodEnd * 1000, fb);
  const act = await db.activityEvent.findFirst({ where: { organizationId: a.org.id, kind: "PLAN_CHANGE" }, orderBy: { createdAt: "desc" } });
  check("A · activity: set to cancel by JobFlex support, with the reason", !!act && /set to cancel on .* by JobFlex support/.test(act.summary) && JSON.parse(act.meta ?? "{}").reason === "Asked by phone — closing the shop", act?.summary);
  const sentA = letters().slice(before);
  check("A · one letter to the owner: switches to Free on the date, not \"you cancelled\"", sentA.length === 1 && sentA[0].includes(a.owner.email) && /Your plan switches to Free on/.test(sentA[0]) && !/you cancelled/i.test(sentA[0]), sentA.map((x) => x.slice(0, 160)));
  const again = await adminCancelSubscription(a.org.id, "period_end", "Second time", false);
  check("A · a second cancel at the period end is refused", !again.ok, again);

  /* ── B. Undo ── */
  const u = await adminUndoCancellation(a.org.id);
  check("B · undo applied", u.ok, u);
  check("B · Stripe: cancel_at_period_end cleared", stripeSub(a.subId)?.cancel_at_period_end === false && stripeSub(a.subId)?.status === "active");
  m = await mirror(a.org.id);
  check("B · mirror: active, canceledAt cleared", m?.status === "ACTIVE" && m.canceledAt === null, m);
  check("B · the card's state: not booked, no by-line", u.ok && !u.state.cancelsAtPeriodEnd && u.state.byAdmin === null, u.ok ? u.state : u);
  const u2 = await adminUndoCancellation(a.org.id);
  check("B · nothing left to undo — refused", !u2.ok, u2);

  /* ── C. immediately ── */
  const beforeC = letters().length;
  const callsBefore = readMockStore(MOCK).calls.length;
  const n = await adminCancelSubscription(c.org.id, "now", "Fraud review — stop at once", true);
  check("C · applied", n.ok, n);
  const cancelCall = readMockStore(MOCK).calls.slice(callsBefore).find((x) => x.method === "subscriptions.cancel");
  const cancelArgs = (cancelCall?.args?.[1] ?? {}) as { prorate?: boolean; invoice_now?: boolean };
  check("C · Stripe: cancelled with no proration and no invoice", stripeSub(c.subId)?.status === "canceled" && cancelArgs.prorate === false && cancelArgs.invoice_now === false, cancelCall);
  m = await mirror(c.org.id);
  check("C · mirror: CANCELED (the Free plan)", m?.status === "CANCELED" && !!m.canceledAt, m);
  check("C · the card's state: cancelled by this admin", n.ok && n.state.status === "CANCELED" && n.state.byAdmin?.name === "QA Admin", n.ok ? n.state : n);
  const sentC = letters().slice(beforeC);
  check("C · one letter: switched to Free", sentC.length === 1 && /Your plan has switched to Free/.test(sentC[0]), sentC.map((x) => x.slice(0, 160)));
  const undoEnded = await adminUndoCancellation(c.org.id);
  check("C · Undo after an immediate cancel — refused", !undoEnded.ok, undoEnded);

  /* ── D. a grant has no Stripe subscription to cancel ── */
  const callsD = readMockStore(MOCK).calls.length;
  const d = await adminCancelSubscription(g.org.id, "now", "Comp — try anyway", false);
  check("D · a grant (MANUAL) is refused", !d.ok, d);
  check("D · … Stripe untouched, the grant stands", readMockStore(MOCK).calls.length === callsD && (await mirror(g.org.id))?.provider === "MANUAL");
}

main()
  .catch((err) => {
    check("check ran to the end", false, err instanceof Error ? err.stack : String(err));
  })
  .finally(async () => {
    await db.organization.deleteMany({ where: { id: { in: made.orgs } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    fs.rmSync(MOCK, { force: true });
    fs.rmSync(OUTBOX, { recursive: true, force: true });
    const failed = summary();
    await db.$disconnect();
    process.exit(failed ? 1 : 0);
  });
