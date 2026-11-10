// THE FREE PLAN OPENS NOTHING A CANCELLED COMPANY COULD NOT OPEN (owner,
// 2026-10-13; lib/freePlan).
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/free-plan.check.ts
//
// Real code on the local dev database (./_actionHarness: network OFF, every
// key blank), throwaway companies removed at the end:
//
//   · a company reaches the Free plan the real way — the owner's
//     cancelSubscription() books it, the webhook's markSubscriptionCanceled()
//     ends it — and EVERY door answers it exactly as it answers a company
//     cancelled the way it was before this change: the page gate, requirePage
//     for each add-on, the feature tier, the limits (the "free" catalog row),
//     planEnded / planOpen / texting, the own-number gate, the trial lock, the
//     estimators (EagleView, Cool Calc, Smart Proposal), recognition, the
//     parcel tiles and the phone codes. A paying company (and one with the
//     switch only booked) is the control: the same doors are open for it;
//   · a card-less trial that was cancelled ends on Free, not in the trial
//     lock, and gets no "add a card" mail;
//   · webhooks delivered again or out of order do not move a company from
//     Free back to its paid plan, nor from a new paid plan back to Free;
//   · a complimentary plan that runs out onto "free" (status FREE) and a
//     card-less trial that runs out with no card (TRIAL_ENDED) are the Free
//     plan too (owner, 2026-10-14): the same 16 answers as a cancelled
//     company; a grant still running keeps its doors open;
//   · the webhook writes what Stripe holds now, never the event's copy: when
//     Stripe cannot be read the event is not applied and answers 500, so
//     Stripe delivers it again (owner, 2026-10-14);
//   · the plate "Your plan switches to Free on <date>" + "Keep <plan>", in a
//     production build (./_prod-server; QA_FREE_URL to use a running server)
//     as qa@acme.test in QA Co — whose subscription row is lent for the run
//     and put back: on Settings → Billing, Subscription, Plans & upgrade and
//     the card-less trial's ribbon, at 1440 and 390, the text and the button
//     lie wholly inside the plate, their centres within 1px of its own, the
//     button 16px in from the right and 16px shorter than the plate; on a
//     phone the button sits under the text across the plate.
import { actAs, check, outcome, summary } from "../_lib/_actionHarness";
import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { db } from "../../../src/lib/db";
import { cancelSubscription } from "../../../src/actions/billing";
import { markSubscriptionCanceled, syncSubscriptionFromStripe } from "../../../src/lib/stripeSync";
import { mirrorStatusFor } from "../../../src/lib/stripeStatus";
import { getBlockedCustomPages, requirePage } from "../../../src/lib/customPageAccess";
import { CUSTOM_PAGES, type CustomPageId } from "../../../src/lib/customPlan";
import { getOrgPlanById } from "../../../src/lib/orgPlan";
import { getOrgPlanContext } from "../../../src/lib/planCatalogServer";
import { getOrgLimitUsage } from "../../../src/lib/limitsEngine";
import { planEnded, planOpen, orgMayText } from "../../../src/lib/paidCaps";
import { companyIsPaying } from "../../../src/lib/sms/registration";
import { cardlessTrialState, isTrialWriteLocked } from "../../../src/lib/trialState";
import { onFreePlan, freeSwitchBooked } from "../../../src/lib/freePlan";
import { endPlanGrant, writePlanGrant, type PlanGrant } from "../../../src/lib/planGrant";
import { trialCapScope } from "../../../src/lib/trialMeter";
import { measureRoofInstant } from "../../../src/actions/roofMeasurement";
import { requestHvacPermitReport, readHvacNameplate } from "../../../src/actions/hvacEstimator";
import { startPhoneVerification } from "../../../src/actions/sms";
import { analyzeJobPhoto } from "../../../src/actions/photoAnalysis";
import * as tiles from "../../../src/app/api/parcel-tiles/[z]/[x]/[y]/route";
import * as stripeWebhook from "../../../src/app/api/webhooks/stripe/route";
import StripeSdk from "stripe";
import type { ChildProcess } from "node:child_process";
import { ensureBuild, playwright, startServer, stopServer } from "../_lib/_prod-server";

const tag = `qa-free-${Date.now()}`;
const rid = () => randomBytes(6).toString("hex");
const DAY = 864e5;
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const made: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

async function company(letter: string) {
  const org = await db.organization.create({ data: { name: `${tag} ${letter}`, slug: `${tag}-${letter.toLowerCase()}`, isInternal: true } });
  const owner = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}@qa.test`, name: `Owner ${letter}`, activeOrgId: org.id } });
  await db.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  made.orgs.push(org.id);
  made.users.push(owner.id);
  return { org, owner };
}
type Co = Awaited<ReturnType<typeof company>>;
const as = (c: Co) => actAs({ id: c.owner.id, activeOrgId: c.org.id });

/** A Stripe subscription as the webhook hands it over — the fields the mirror reads. */
function stripeSub(id: string, orgId: string, over: Partial<Stripe.Subscription> & { periodEnd: number }): Stripe.Subscription {
  const { periodEnd, ...rest } = over;
  return {
    id,
    object: "subscription",
    customer: `cus_${tag}`,
    status: "active",
    metadata: { organizationId: orgId },
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    trial_end: null,
    created: Math.floor((Date.now() - 40 * DAY) / 1000),
    default_payment_method: null,
    discounts: [],
    items: { object: "list", data: [{ price: { id: `price_${tag}`, recurring: { interval: "month" } }, quantity: 1, current_period_end: periodEnd, current_period_start: periodEnd - 30 * 86400 }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}

/** Every door, as it answers this company now. */
async function doors(c: Co, est: string, photoId: string) {
  const org = c.org.id;
  as(c);
  const pages: Record<string, string> = {};
  for (const p of CUSTOM_PAGES) {
    const r = await outcome(() => requirePage(org, p.id as CustomPageId));
    pages[p.id] = r.refused ? (/ended/.test(r.text) ? "closed:ended" : "closed:not-included") : "open";
  }
  const limits = Object.fromEntries((await getOrgLimitUsage(org, { actorId: null })).map((u) => [u.resource, u.limit]));
  const roof = await outcome(() => measureRoofInstant({ address: `${rid()} Free St`, city: "Springfield", state: "IL", zip: "62701" }));
  const hvac = await outcome(() => requestHvacPermitReport({ estimateId: est }));
  const nameplate = await outcome(() => readHvacNameplate({ dataUrl: TINY_PNG, hint: "outdoor" }));
  const photo = await outcome(() => analyzeJobPhoto(photoId));
  const phone = await outcome(() => startPhoneVerification("(206) 555-0142"));
  const tile = (await tiles.GET(new Request("http://local/api/parcel-tiles/18/1/1"), { params: Promise.resolve({ z: "18", x: "1", y: "1" }) })).status;
  const closedByPlan = (o: { refused: boolean; text: string }) => (o.refused && /plan has ended|needs an active plan|isn't in your plan|active plan/i.test(o.text) ? "closed" : "open");
  return {
    blocked: JSON.stringify(await getBlockedCustomPages(org)),
    pages: JSON.stringify(pages),
    tier: await getOrgPlanById(org),
    contextTier: (await getOrgPlanContext(org)).tier,
    limits: JSON.stringify(limits),
    planEnded: await planEnded(org),
    planOpen: await planOpen(org, c.owner.id),
    texts: await orgMayText(org),
    ownNumber: await companyIsPaying(org),
    trialLock: await isTrialWriteLocked(org),
    roof: closedByPlan(roof),
    coolcalc: closedByPlan(hvac),
    nameplate: closedByPlan(nameplate),
    photoAi: closedByPlan(photo),
    phoneCode: closedByPlan(phone),
    parcelTiles: tile === 402 ? "closed" : "open",
  };
}
type Doors = Awaited<ReturnType<typeof doors>>;

async function setup(c: Co) {
  const est = await db.hvacEstimate.create({ data: { organizationId: c.org.id, createdById: c.owner.id, address: `${rid()} Plan St, Springfield, IL 62701`, siteFactsJson: "{}", modelJson: "{}", engineJson: "{}", draftJson: "{}" } });
  const job = await db.job.create({ data: { organizationId: c.org.id, title: `Job ${tag}` } });
  const photo = await db.jobPhoto.create({ data: { jobId: job.id, url: TINY_PNG, kind: "BEFORE" } });
  return { est: est.id, photo: photo.id };
}

/* ── THE PLATE, IN A BROWSER ─────────────────────────────────────────────── */
const PLATE_PORT = Number(process.env.QA_FREE_PORT || 3317);
const PLATE_GIVEN = process.env.QA_FREE_URL?.replace(/\/$/, "");
const PLATE_BASE = PLATE_GIVEN || `http://localhost:${PLATE_PORT}`;

/** The plate and its two children, in CSS pixels of the plate itself (the desk shell scales its page). */
const MEASURE = `(() => {
  const el = [...document.querySelectorAll("[data-free-switch]")].find((e) => e.getClientRects().length && getComputedStyle(e).display !== "none");
  if (!el) return null;
  const r = el.getBoundingClientRect(), k = r.width / el.offsetWidth || 1;
  const bl = el.clientLeft, bt = el.clientTop;
  const box = (n) => { if (!n) return null; const q = n.getBoundingClientRect(); return { l: (q.left - r.left) / k - bl, t: (q.top - r.top) / k - bt, w: q.width / k, h: q.height / k }; };
  const p = el.querySelector(".jffs-t"), b = el.querySelector(".jffs-keep");
  const range = document.createRange(); range.selectNodeContents(p);
  const cs = getComputedStyle(el);
  // A 2px frame drawn beside it, for what 2px computes to here (the desk shell zooms its page,
  // and a border is snapped to whole device pixels).
  const probe = document.createElement("div"); probe.style.border = "2px solid"; el.parentElement.appendChild(probe);
  const ref2 = getComputedStyle(probe).borderTopWidth; probe.remove();
  return { ref2, btnBg: b ? getComputedStyle(b).backgroundColor : null, inW: el.clientWidth, inH: el.clientHeight, text: box(p), textLines: new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size, button: box(b),
    bold: p && p.querySelector("b") ? p.querySelector("b").textContent : null, label: b ? b.textContent : null, border: cs.borderTopWidth + " " + cs.borderTopColor, zoom: el.currentCSSZoom || 1, shadow: cs.boxShadow };
})()`;

/** check(), answering whether it held. */
const held = (name: string, ok: boolean, detail?: unknown) => { check(name, ok, detail); return ok; };

type Box = { l: number; t: number; w: number; h: number };
type Plate = { inW: number; inH: number; text: Box; textLines: number; button: Box | null; bold: string | null; label: string | null; border: string; shadow: string; zoom: number; ref2: string; btnBg: string | null };

function judgePlate(where: string, m: Plate | null, phone: boolean) {
  if (!held(`${where}: the plate is there`, !!m, "no [data-free-switch]")) return;
  const p = m!, t = p.text, b = p.button;
  const inside = (x: Box) => x.l >= -0.5 && x.t >= -0.5 && x.l + x.w <= p.inW + 0.5 && x.t + x.h <= p.inH + 0.5;
  check(`${where}: a 2px ink frame and a hard 3px shadow`, p.border.startsWith(p.ref2 + " ") && /rgb\(10, 10, 10\)$/.test(p.border) && /3px 3px 0px/.test(p.shadow), `${p.border} (2px here: ${p.ref2}, zoom ${p.zoom}) | ${p.shadow}`);
  check(`${where}: the button is the dashboard's blue button (filled)`, !!p.btnBg && !/rgba\(0, 0, 0, 0\)|transparent/.test(p.btnBg), p.btnBg);
  check(`${where}: the date is bold`, !!p.bold && /\d{4}/.test(p.bold), p.bold);
  if (!held(`${where}: the text and the button lie wholly inside the plate`, !!b && inside(t) && inside(b!), JSON.stringify(p))) return;
  const mid = p.inH / 2;
  if (!phone) {
    check(`${where}: text and button centred on the plate's height (±1px)`, Math.abs(t.t + t.h / 2 - mid) <= 1 && Math.abs(b!.t + b!.h / 2 - mid) <= 1, JSON.stringify({ mid, text: t.t + t.h / 2, button: b!.t + b!.h / 2 }));
    check(`${where}: the button is the plate's height less 16px, its right edge 16px in`, Math.abs(b!.h - (p.inH - 16)) <= 1 && Math.abs(p.inW - (b!.l + b!.w) - 16) <= 1, JSON.stringify({ inH: p.inH, bh: b!.h, right: p.inW - (b!.l + b!.w) }));
    check(`${where}: the text on one line`, p.textLines === 1, String(p.textLines));
  } else {
    check(`${where}: the button under the text, across the plate (16px in at the right, flush with the text at the left)`, b!.t >= t.t + t.h - 0.5 && Math.abs(p.inW - (b!.l + b!.w) - 16) <= 1 && Math.abs(b!.l - t.l) <= 1, JSON.stringify(p));
  }
}

async function plate() {
  const org = await db.organization.findUnique({ where: { slug: "qa-co" }, select: { id: true } });
  if (!held("plate: QA Co is there", !!org)) return;
  const orgId = org!.id;
  const lent = await db.subscription.findUnique({ where: { organizationId: orgId } });
  const recKey = `cardlessTrial:${orgId}`;
  const lentRec = await db.syncState.findUnique({ where: { key: recKey } });
  const subQ = `sub_${tag}_qa`;
  const ends = new Date(Date.now() + 20 * DAY);
  const put = (data: Record<string, unknown>) => db.subscription.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data } as never, update: data as never });
  const trialRec = () => JSON.stringify({ subId: subQ, customerId: "cus_qa", planSlug: "professional", interval: "MONTH", customPages: [], mode: "test", trialDays: 7, startedAt: new Date().toISOString(), endsAt: ends.toISOString() });
  let server: ChildProcess | null = null;
  process.env.QA_BASE_URL = PLATE_BASE; // ./_qa reads it once, on load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const qa = require("../_lib/_qa");
  playwright(); // resolvable by name for ./_qa
  try {
    if (!PLATE_GIVEN) {
      ensureBuild((n: string, e?: string) => console.log(`note ${n}${e ? " — " + e : ""}`));
      server = await startServer(PLATE_PORT, {}, "QA_FREE_PORT");
    }
    // Booked on a paid plan: the plate on Settings → Billing, Subscription and Plans & upgrade.
    await put({ plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: null, externalCustomerId: null, stripePriceId: null, trialEndsAt: null, currentPeriodEnd: ends, canceledAt: new Date() });
    const chrome = await qa.launch({ channel: "chrome" }).catch(() => qa.launch());
    const signer = await chrome.newContext();
    await qa.signIn(await signer.newPage());
    const cookies = await signer.cookies();
    const at = async (w: number, h: number, run: (page: { goto: (u: string, o: object) => Promise<unknown>; waitForTimeout: (ms: number) => Promise<void>; evaluate: (s: string) => Promise<unknown>; locator: (s: string) => { innerText: () => Promise<string> } }) => Promise<void>) => {
      const phone = w <= 768;
      const ctx = await chrome.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
      await ctx.addCookies(cookies);
      await qa.forbidControls(ctx);
      try { await run(await ctx.newPage()); } finally { await ctx.close(); }
    };
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await at(w, h, async (page) => {
        for (const path of ["/dashboard/settings?tab=billing", "/dashboard/subscription", "/dashboard/upgrade"]) {
          await page.goto(PLATE_BASE + path, { waitUntil: "load", timeout: 180000 });
          await page.waitForTimeout(3500);
          judgePlate(`plate ${path} @${w}`, (await page.evaluate(MEASURE)) as Plate | null, w <= 768);
        }
      });
    }
    // Cancelled during a card-less trial: the plate takes the trial ribbon's place (desk; the phone keeps its dock).
    await put({ plan: "PROFESSIONAL", status: "TRIALING", provider: "STRIPE", externalSubId: subQ, externalCustomerId: null, stripePriceId: null, trialEndsAt: ends, currentPeriodEnd: ends, canceledAt: new Date() });
    await db.syncState.upsert({ where: { key: recKey }, create: { key: recKey, cursor: trialRec() }, update: { cursor: trialRec() } });
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await at(w, h, async (page) => {
        await page.goto(PLATE_BASE + "/dashboard/clients", { waitUntil: "load", timeout: 180000 });
        await page.waitForTimeout(3500);
        if (w > 768) judgePlate(`plate on the trial ribbon @${w}`, (await page.evaluate(MEASURE)) as Plate | null, false);
        else check(`trial ribbon @${w}: the phone keeps the dock, which says when it switches`, /Switches to Free on/.test(await page.locator("body").innerText()));
      });
    }
    await chrome.close();
  } catch (err) {
    check("plate: the browser part ran", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (lent) await db.subscription.update({ where: { organizationId: orgId }, data: { plan: lent.plan, status: lent.status, provider: lent.provider, externalSubId: lent.externalSubId, externalCustomerId: lent.externalCustomerId, stripePriceId: lent.stripePriceId, trialEndsAt: lent.trialEndsAt, currentPeriodEnd: lent.currentPeriodEnd, canceledAt: lent.canceledAt } }).catch(() => {});
    else await db.subscription.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    if (lentRec) await db.syncState.update({ where: { key: recKey }, data: { cursor: lentRec.cursor } }).catch(() => {});
    else await db.syncState.deleteMany({ where: { key: recKey } }).catch(() => {});
    stopServer(server);
  }
}

async function main() {
  for (const k of ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID"]) process.env[k] = "qa-dummy";
  try {
    const now = Math.floor(Date.now() / 1000);

    // ── A: Free, the real way: booked by the owner, ended by the webhook ──
    const A = await company("A");
    const subA = `sub_${tag}_a`;
    const endA = now + 20 * 86400;
    await db.subscription.create({ data: { organizationId: A.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: subA, externalCustomerId: `cus_${tag}`, currentPeriodEnd: new Date(endA * 1000) } });
    const kitA = await setup(A);
    as(A);
    const booked = await cancelSubscription({ path: "A3", a3: { reasons: ["just_testing"] } });
    const rowBooked = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("the owner books the switch to Free: the row is still ACTIVE, the date is the end of the paid cycle", booked.ok && rowBooked?.status === "ACTIVE" && freeSwitchBooked(rowBooked) && rowBooked.currentPeriodEnd?.getTime() === endA * 1000, booked);
    const doorsBooked = await doors(A, kitA.est, kitA.photo);

    // The paid cycle runs out; Stripe ends the subscription (cancel_at_period_end).
    const endedPayload = stripeSub(subA, A.org.id, { status: "canceled", cancel_at_period_end: true, canceled_at: now - 5 * 86400, ended_at: now - 3600, metadata: { organizationId: A.org.id, jf_to_free: "1" }, periodEnd: now - 3600 });
    await db.subscription.update({ where: { organizationId: A.org.id }, data: { currentPeriodEnd: new Date((now - 3600) * 1000) } });
    await markSubscriptionCanceled(endedPayload);
    const rowFree = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("after the end the company is on the Free plan; the plan it had and its dates are kept", onFreePlan(rowFree) && rowFree?.plan === "PROFESSIONAL" && rowFree.canceledAt?.getTime() === (now - 5 * 86400) * 1000 && rowFree.currentPeriodEnd?.getTime() === (now - 3600) * 1000, rowFree);
    const doorsFree = await doors(A, kitA.est, kitA.photo);

    // ── B: cancelled the way it was before this change (the baseline) ──
    const B = await company("B");
    await db.subscription.create({ data: { organizationId: B.org.id, plan: "PROFESSIONAL", status: "CANCELED", provider: "STRIPE", externalSubId: `sub_${tag}_b`, canceledAt: new Date(), currentPeriodEnd: new Date(Date.now() - 2 * DAY) } });
    const kitB = await setup(B);
    const doorsCanceled = await doors(B, kitB.est, kitB.photo);

    // ── C: paying (the control) ──
    const C = await company("C");
    await db.subscription.create({ data: { organizationId: C.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: `sub_${tag}_c`, currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
    const kitC = await setup(C);
    const doorsPaying = await doors(C, kitC.est, kitC.photo);

    const keys = Object.keys(doorsFree) as Array<keyof Doors>;
    const table = keys.map((k) => `${k.padEnd(12)} Free ${String(doorsFree[k]).slice(0, 60).padEnd(62)} cancelled ${String(doorsCanceled[k]).slice(0, 60).padEnd(62)} paying ${String(doorsPaying[k]).slice(0, 60)}`);
    console.log("── the doors ──\n" + table.join("\n"));
    for (const k of keys) {
      check(`door "${k}": Free answers exactly as a cancelled company`, JSON.stringify(doorsFree[k]) === JSON.stringify(doorsCanceled[k]), { free: doorsFree[k], canceled: doorsCanceled[k] });
    }
    const sensitive = keys.filter((k) => JSON.stringify(doorsPaying[k]) !== JSON.stringify(doorsFree[k]));
    check("control: a paying company finds these doors open (the doors are real)", ["roof", "coolcalc", "photoAi", "phoneCode", "parcelTiles", "planOpen", "texts", "ownNumber", "tier", "pages", "blocked"].every((k) => sensitive.includes(k as keyof Doors)), sensitive);
    check("control: with the switch only booked, every door is still open as for a paying company", keys.every((k) => JSON.stringify(doorsBooked[k]) === JSON.stringify(doorsPaying[k])), keys.filter((k) => JSON.stringify(doorsBooked[k]) !== JSON.stringify(doorsPaying[k])));
    const freeRow = await db.pricingPlan.findFirst({ where: { slug: "free" }, select: { limitsJson: true } });
    if (freeRow?.limitsJson) {
      const want = JSON.parse(freeRow.limitsJson) as Record<string, number>;
      const got = JSON.parse(doorsFree.limits) as Record<string, number | null>;
      check("Free's limits are the \"free\" catalog row's", Object.entries(want).every(([k, v]) => got[k] === v), { want, got });
    }

    // ── webhooks: again, and out of order ──
    await markSubscriptionCanceled(endedPayload);
    const again = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("the deletion delivered again writes the same row (same dates, still Free)", onFreePlan(again) && again?.canceledAt?.getTime() === rowFree?.canceledAt?.getTime() && again?.currentPeriodEnd?.getTime() === rowFree?.currentPeriodEnd?.getTime());
    const stale = stripeSub(subA, A.org.id, { status: "active", cancel_at_period_end: true, canceled_at: now - 5 * 86400, metadata: { organizationId: A.org.id, jf_to_free: "1" }, periodEnd: now - 3600 });
    await syncSubscriptionFromStripe(stale, null);
    const afterStale = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("an older \"updated: active\" arriving after the deletion does not put Free back on Professional", onFreePlan(afterStale), afterStale?.status);

    // Back from Free: a new paid subscription; the old one's events arrive late.
    const subA2 = `sub_${tag}_a2`;
    await db.subscription.update({ where: { organizationId: A.org.id }, data: { status: "ACTIVE", externalSubId: subA2, canceledAt: null, currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
    await markSubscriptionCanceled(endedPayload);
    await syncSubscriptionFromStripe(stripeSub(subA, A.org.id, { status: "canceled", cancel_at_period_end: true, canceled_at: now - 5 * 86400, ended_at: now - 3600, created: now - 60 * 86400, periodEnd: now - 3600 }), null);
    const back = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("back on a paid plan, the old subscription's late deletion and update do not send the company to Free", back?.status === "ACTIVE" && back.externalSubId === subA2, back);

    // ── a card-less trial, cancelled: Free at the trial's end, not the lock ──
    const T = await company("T");
    const subT = `sub_${tag}_t`;
    const trialEnd = now + 3 * 86400;
    await db.subscription.create({ data: { organizationId: T.org.id, plan: "PROFESSIONAL", status: "TRIALING", provider: "STRIPE", externalSubId: subT, externalCustomerId: `cus_${tag}`, trialEndsAt: new Date(trialEnd * 1000), currentPeriodEnd: new Date(trialEnd * 1000) } });
    await db.syncState.create({ data: { key: `cardlessTrial:${T.org.id}`, cursor: JSON.stringify({ subId: subT, customerId: `cus_${tag}`, planSlug: "professional", interval: "MONTH", customPages: [], mode: "test", trialDays: 7, startedAt: new Date(Date.now() - 4 * DAY).toISOString(), endsAt: new Date(trialEnd * 1000).toISOString() }) } });
    as(T);
    const tb = await cancelSubscription({ path: "A3", a3: { reasons: ["just_testing"] } });
    const tState = await cardlessTrialState(T.org.id);
    check("a card-less trial cancelled: booked, still trialing, no \"add a card\" reminders (toFree)", tb.ok && tState?.kind === "trialing" && tState.toFree === true, tState);
    const lapse = stripeSub(subT, T.org.id, { status: "canceled", cancel_at_period_end: true, canceled_at: now - 86400, ended_at: trialEnd, trial_end: trialEnd, metadata: { organizationId: T.org.id, jf_cardless: "1", jf_to_free: "1" }, periodEnd: trialEnd });
    const plainLapse = stripeSub(subT, T.org.id, { status: "canceled", ended_at: trialEnd, trial_end: trialEnd, metadata: { organizationId: T.org.id, jf_cardless: "1" }, periodEnd: trialEnd });
    check("its end reads CANCELED (Free), while a card-less trial that simply ran out still reads TRIAL_ENDED", mirrorStatusFor(lapse) === "CANCELED" && mirrorStatusFor(plainLapse) === "TRIAL_ENDED");
    await markSubscriptionCanceled(lapse);
    const rowT = await db.subscription.findUnique({ where: { organizationId: T.org.id } });
    check("the cancelled card-less trial is on Free and not write-locked", onFreePlan(rowT) && !(await isTrialWriteLocked(T.org.id)), rowT?.status);

    // ── a complimentary plan runs out onto "free": status FREE is the Free plan ──
    const grantOf = (endsAt: string | null): PlanGrant => ({ plan: "PROFESSIONAL", grantedAt: new Date(Date.now() - 30 * DAY).toISOString(), endsAt, fallback: "free", reason: "qa", actorId: "qa", actorEmail: "qa@qa.test", replaced: null });
    const G = await company("G");
    await db.subscription.create({ data: { organizationId: G.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "MANUAL", currentPeriodEnd: new Date(Date.now() - 3600e3) } });
    const gGrant = grantOf(new Date(Date.now() - 3600e3).toISOString());
    await writePlanGrant(G.org.id, gGrant);
    await endPlanGrant(G.org.id, gGrant, "PROFESSIONAL", "expired", null);
    const rowG = await db.subscription.findUnique({ where: { organizationId: G.org.id } });
    check("a grant that ran out onto \"free\" leaves the company on the Free plan (status FREE)", rowG?.status === "FREE" && onFreePlan(rowG), rowG?.status);
    const kitG = await setup(G);
    const doorsGrantFree = await doors(G, kitG.est, kitG.photo);

    // ── a grant still running: its doors stay open ──
    const H = await company("H");
    await db.subscription.create({ data: { organizationId: H.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "MANUAL", currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
    await writePlanGrant(H.org.id, grantOf(new Date(Date.now() + 30 * DAY).toISOString()));
    const kitH = await setup(H);
    const doorsGrant = await doors(H, kitH.est, kitH.photo);

    // ── a card-less trial runs out with no card: TRIAL_ENDED is the Free plan ──
    const E = await company("E");
    const subE = `sub_${tag}_e`;
    const endE = now - 3600;
    await db.subscription.create({ data: { organizationId: E.org.id, plan: "PROFESSIONAL", status: "TRIALING", provider: "STRIPE", externalSubId: subE, externalCustomerId: `cus_${tag}`, trialEndsAt: new Date(endE * 1000), currentPeriodEnd: new Date(endE * 1000) } });
    await db.syncState.create({ data: { key: `cardlessTrial:${E.org.id}`, cursor: JSON.stringify({ subId: subE, customerId: `cus_${tag}`, planSlug: "professional", interval: "MONTH", customPages: [], mode: "test", trialDays: 7, startedAt: new Date((endE - 7 * 86400) * 1000).toISOString(), endsAt: new Date(endE * 1000).toISOString() }) } });
    await markSubscriptionCanceled(stripeSub(subE, E.org.id, { status: "canceled", ended_at: endE, canceled_at: endE, trial_end: endE, metadata: { organizationId: E.org.id, jf_cardless: "1" }, periodEnd: endE }));
    const rowE = await db.subscription.findUnique({ where: { organizationId: E.org.id } });
    check("a card-less trial that ran out with no card is TRIAL_ENDED — the Free plan", rowE?.status === "TRIAL_ENDED" && onFreePlan(rowE), rowE?.status);
    check("…not read-only: no write lock, and the trial's own ceilings give way to Free's limits", !(await isTrialWriteLocked(E.org.id)) && (await trialCapScope(E.org.id)) === "none");
    const kitE = await setup(E);
    const doorsTrialEnded = await doors(E, kitE.est, kitE.photo);

    console.log("── the doors, Free in its three shapes ──\n" + keys.map((k) => `${k.padEnd(12)} grant→free ${String(doorsGrantFree[k]).slice(0, 40).padEnd(42)} trial ended ${String(doorsTrialEnded[k]).slice(0, 40).padEnd(42)} grant running ${String(doorsGrant[k]).slice(0, 40)}`).join("\n"));
    for (const k of keys) {
      check(`door "${k}": status FREE (a grant ran out) answers exactly as a cancelled company`, JSON.stringify(doorsGrantFree[k]) === JSON.stringify(doorsCanceled[k]), { free: doorsGrantFree[k], canceled: doorsCanceled[k] });
      check(`door "${k}": a card-less trial that ran out answers exactly as a cancelled company`, JSON.stringify(doorsTrialEnded[k]) === JSON.stringify(doorsCanceled[k]), { ended: doorsTrialEnded[k], canceled: doorsCanceled[k] });
    }
    const grantOpen = (["roof", "coolcalc", "photoAi", "phoneCode", "parcelTiles", "planOpen", "texts"] as const).filter((k) => doorsGrant[k] !== doorsPaying[k]);
    check("a grant still running keeps its paid doors open, as a paying company", grantOpen.length === 0 && doorsGrant.planEnded === false && doorsGrant.pages === doorsPaying.pages, grantOpen);
    // ── the webhook: the event is a signal, Stripe is the state ──
    const W = await company("W");
    const subW = `sub_${tag}_w`;
    await db.subscription.create({ data: { organizationId: W.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: subW, externalCustomerId: `cus_${tag}`, currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
    process.env.STRIPE_SECRET_KEY = "sk_test_qa_not_a_key";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_qa_free_plan";
    const evtId = `evt_${tag}_w`;
    const body = JSON.stringify({ id: evtId, object: "event", type: "customer.subscription.updated", created: now, livemode: false, data: { object: stripeSub(subW, W.org.id, { status: "trialing", trial_end: now + 86400, periodEnd: now + 86400 }) } });
    const sig = new StripeSdk("sk_test_qa_not_a_key").webhooks.generateTestHeaderString({ payload: body, secret: "whsec_qa_free_plan" });
    const res = await stripeWebhook.POST(new Request("http://local/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body }));
    const rowW = await db.subscription.findUnique({ where: { organizationId: W.org.id } });
    const evtRow = await db.webhookEvent.findFirst({ where: { eventId: evtId } });
    check("webhook: Stripe cannot be read → the old \"trialing\" copy is not written, 500 so Stripe retries, the event stays unprocessed", res.status === 500 && rowW?.status === "ACTIVE" && evtRow?.status === "FAILED", `${res.status} ${rowW?.status} ${evtRow?.status}`);
    await db.webhookEvent.deleteMany({ where: { eventId: evtId } });
    process.env.STRIPE_SECRET_KEY = "";
    process.env.STRIPE_WEBHOOK_SECRET = "";
    await plate();
  } finally {
    for (const k of ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID"]) process.env[k] = "";
    const del = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* next */ } };
    for (const orgId of made.orgs) {
      await del(() => db.activityEvent.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.jobPhoto.deleteMany({ where: { job: { organizationId: orgId } } }));
      await del(() => db.job.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.hvacEstimate.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.instantOrder.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.roofMeasurement.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.subscription.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.membership.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.syncState.deleteMany({ where: { key: { contains: orgId } } }));
      await del(() => db.organization.delete({ where: { id: orgId } }));
    }
    await del(() => db.syncState.deleteMany({ where: { key: { contains: tag } } }));
    await del(() => db.phoneVerification.deleteMany({ where: { userId: { in: made.users } } }));
    await del(() => db.user.deleteMany({ where: { id: { in: made.users } } }));
    await db.$disconnect();
  }
  process.exit(summary() ? 1 : 0);
}

void main();
