// SMARTBOOK · THE END-TO-END WALK (2026-10-31, plan Batch 5). A real browser on a LOCAL stand — its own SQLite
// database, OPENAI_BASE_URL on the fake model (qa/fixtures/smartbook-fake-openai.ts), a fake Facebook this walk runs
// itself, never production env files — signed in only as the QA Co owner qa@acme.test (CLAUDE.md "Test accounts").
// Desk 1440×900, then a phone 390×844. The owner's request from start to end: SmartBook switched on in Settings;
// Facebook leads come in by themselves (the Meta sweep, which saving SmartBook switched on, then SmartBook's job —
// called the way Vercel calls them) and get times — by text when
// the form's texts box is ticked, by email when it isn't; one books by texting "2", one asks for her own time by text,
// one suggests a time on the email's page; the office answers on the calendar (Yes on the desk, No on the phone);
// Pause, Restart and Offer times on the lead page; the tags on the leads list; SmartHelp's two SmartBook guides. Each
// line printed is one check; it exits 0 when all passed.
//
//   source <stand env> && NODE_PATH="" npx --no-install tsx --tsconfig qa/tsconfig.json qa/walks/smartbook.walk.ts
//
// Wants on the stand — the app and this walk read the same env: QA_BASE_URL, DATABASE_URL (file:, checked by
// qa/lib/db), QA_PASS_OWNER, QA_TEST_MODE=1 with QA_SECRET, OPENAI_BASE_URL on the fake model, META_GRAPH_BASE on
// this walk's Facebook (http://127.0.0.1:4596, FAKE_META_PORT) with any META_APP_ID, META_APP_SECRET,
// META_LOGIN_CONFIG_ID and META_REDIRECT_URI (the sweep runs only where Meta is set up), TOKEN_ENCRYPTION_KEY,
// CRON_SECRET, and TWILIO_AUTH_TOKEN alone: Twilio stays off (every text is a SKIPPED row showing what would go), the
// token only signs the customers' replies the way Twilio signs them.
// It writes to the stand only: QA Co's clock, texting number and Facebook Page, the walk's leads, their texts and visits.
import crypto from "node:crypto";
import http from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { prisma } from "../lib/db";
import { baseUrl } from "../lib/env";
import { authFile, credentials, signInRole } from "../lib/roles";

let bad = 0;
const check = (name: string, ok: boolean, extra: unknown = "") => {
  if (!ok) bad++;
  const more = extra === "" || extra === undefined ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : more.slice(0, 400)}`);
};

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — see the walk's header`);
  return v;
}

const BASE = baseUrl();
const NAV = { waitUntil: "domcontentloaded" as const, timeout: 180_000 };
const UP = { timeout: 180_000 };
const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** QA Co's texting number, and qa@acme.test's own mobile — the company's side of the texts. */
const NUMBER = "+15005550006";
const OFFICE = "+14255550111";
const PEOPLE = {
  maria: { name: "Maria Lopez", phone: "+14255550181", email: "maria@smartbook-walk.test" },
  tom: { name: "Tom Reyes", phone: "+14255550182", email: "tom@smartbook-walk.test" },
  ana: { name: "Ana Ruiz", phone: "+14255550183", email: null },
  bob: { name: "Bob Hand", phone: "+14255550184", email: "bob@smartbook-walk.test" },
} as const;
const WALK_PHONES: string[] = Object.values(PEOPLE).map((p) => p.phone);

/** SmartBook keeps quiet from 9 PM to 8 AM on the company's clock. QA Co gets a clock where it is midday now — Los
 *  Angeles when it is — so the first texts go at once whenever the walk runs. */
const ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Atlantic/Azores", "Europe/London", "Europe/Berlin", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Honolulu", "America/Anchorage"];
const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
const TZ = ZONES.find((z) => hourIn(z) >= 10 && hourIn(z) <= 15) ?? "America/Los_Angeles";
/** YYYY-MM-DD on QA Co's clock, `days` from today. */
const dayIn = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 86_400_000));

/** Console errors and page crashes, from every page the walk opens. The dev server's own noise is not the app's. */
const consoleErrors: string[] = [];
const NOISE = /Download the React DevTools|\[HMR\]|\[Fast Refresh\]|favicon|webpack-hmr|_next\/static\/.*\.map/i;
function watch(page: Page): Page {
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${new URL(page.url()).pathname}: ${e.message.slice(0, 200)}`));
  return page;
}

async function until<T>(get: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── The fake Facebook: one Page, one lead form with the two consent boxes, the leads people submit ─────────────

const PAGE_ID = "61550000000001";
const FORM_ID = "61550000000077";
const PAGE_TOKEN = "smartbook-walk-page-token";
type FbLead = { id: string; created_time: string; field_data: Array<{ name: string; values: string[] }>; custom_disclaimer_responses: Array<{ checkbox_key: string; is_checked: string }> };
const fb = { leads: [] as FbLead[], boxes: [] as Array<{ key: string; text: string }>, asked: [] as string[], refused: 0 };

function fakeFacebook(): Promise<http.Server> {
  const proof = crypto.createHmac("sha256", need("META_APP_SECRET")).update(PAGE_TOKEN).digest("hex");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://facebook.fake");
    const path = url.pathname.replace(/^\/v\d+\.0\//, "");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    fb.asked.push(path);
    // Graph's own rule: the Page's token, and the proof made with the app's secret.
    if (req.headers.authorization !== `Bearer ${PAGE_TOKEN}` || url.searchParams.get("appsecret_proof") !== proof) {
      fb.refused++;
      return send(400, { error: { code: 190, message: "Invalid OAuth access token." } });
    }
    if (path === `${PAGE_ID}/leadgen_forms`) return send(200, { data: [{ id: FORM_ID }] });
    if (path === FORM_ID) return send(200, { id: FORM_ID, legal_content: { custom_disclaimer: { checkboxes: fb.boxes } } });
    if (path === `${FORM_ID}/leads`) {
      const filter = JSON.parse(url.searchParams.get("filtering") ?? "[]") as Array<{ value?: number }>;
      const since = Number(filter[0]?.value ?? 0);
      return send(200, { data: fb.leads.filter((l) => Date.parse(l.created_time) / 1000 > since), paging: { cursors: {} } });
    }
    send(404, { error: { code: 803, message: `No such path: ${path}` } });
  });
  const port = Number(process.env.FAKE_META_PORT || 4596);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** Someone fills in the Facebook form. Graph writes the time as "2026-10-31T23:40:00+0000". */
function submitForm(who: { name: string; phone: string; email: string | null }, ticked: { texts: boolean; calls: boolean }) {
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, "+0000");
  fb.leads.push({
    id: `${Date.now()}${fb.leads.length}`,
    created_time: created,
    field_data: [
      { name: "full_name", values: [who.name] },
      { name: "phone_number", values: [who.phone] },
      ...(who.email ? [{ name: "email", values: [who.email] }] : []),
      { name: "street_address", values: ["18412 92nd Ave NE"] },
      { name: "service", values: ["Roof replacement"] },
    ],
    custom_disclaimer_responses: [
      { checkbox_key: "texts", is_checked: ticked.texts ? "1" : "0" },
      { checkbox_key: "calls", is_checked: ticked.calls ? "1" : "0" },
    ],
  });
}

/** The jobs as Vercel's cron calls them: the Meta sweep (lib/meta/autoImport, which hands new leads to SmartBook), then
 *  SmartBook's own (the steps that are due). */
async function cron(): Promise<{ status: number; body: string }> {
  let last = { status: 0, body: "" };
  for (const job of ["meta-leads", "smartbook"]) {
    const res = await fetch(`${BASE}/api/cron/${job}`, { headers: { "x-cron-key": need("CRON_SECRET") } });
    last = { status: res.status, body: `${job}: ${(await res.text()).slice(0, 300)}` };
    if (res.status !== 200) return last;
  }
  return last;
}

/** A customer's text to QA Co's number, signed the way Twilio signs it. */
async function customerTexts(from: string, body: string): Promise<number> {
  const params: Record<string, string> = { AccountSid: "ACsmartbookwalk", MessageSid: `SMwalk${crypto.randomBytes(12).toString("hex")}`, From: from, To: NUMBER, Body: body, NumMedia: "0" };
  const signed = `${(process.env.TWILIO_APP_URL || BASE).replace(/\/$/, "")}/api/twilio/sms`;
  const signature = crypto.createHmac("sha1", need("TWILIO_AUTH_TOKEN")).update(signed + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
  const res = await fetch(`${BASE}/api/twilio/sms`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature }, body: new URLSearchParams(params) });
  return res.status;
}

/** The texts that went to `to` since `since` (a SKIPPED row is a text that would go). */
const textsTo = (to: string, since: Date) => prisma().smsMessage.findMany({ where: { to, direction: "OUT", createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { body: true, status: true } });
const textTo = (to: string, since: Date, words: RegExp, ms = 60_000) => until(async () => (await textsTo(to, since)).find((t) => words.test(t.body)), ms);

/** The lead's SmartBook record, as the stand holds it. */
async function convOf(orgId: string, leadId: string): Promise<{ status: string; text: boolean; call: boolean; token: string; offers: string[] } | null> {
  const row = await prisma().syncState.findUnique({ where: { key: `smartbook:c:${orgId}:${leadId}` }, select: { cursor: true } });
  return row ? JSON.parse(row.cursor) : null;
}

// ── The stand: QA Co ready to text, the fake Page connected, nothing left from an earlier walk ───────────────────

async function freshStand(orgId: string, ownerId: string): Promise<string> {
  const db = prisma();
  await db.organization.update({ where: { id: orgId }, data: { timezone: TZ, smsFromNumber: NUMBER, smsClientsOn: true, tradeTypesJson: JSON.stringify(["roofing"]), bookingSettingsJson: null } });
  await db.user.update({ where: { id: ownerId }, data: { smsPhone: OFFICE, smsVerifiedAt: new Date() } });
  const old = await db.lead.findMany({ where: { organizationId: orgId, OR: [{ phone: { in: WALK_PHONES } }, { email: { endsWith: "@smartbook-walk.test" } }] }, select: { id: true } });
  const ids = old.map((l) => l.id);
  if (ids.length) {
    await db.booking.deleteMany({ where: { leadId: { in: ids } } });
    await db.appointment.deleteMany({ where: { leadId: { in: ids } } });
    await db.activityEvent.deleteMany({ where: { leadId: { in: ids } } });
    await db.aiPhoneCall.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  // SmartBook's rows for QA Co (settings back to off), the Page's checks, the day's text caps, the walk's texts.
  await db.syncState.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "smartbook:" }, OR: [{ key: { contains: orgId } }, { cursor: { contains: orgId } }] },
        { key: { startsWith: `meta:` }, OR: [{ key: { contains: orgId } }, { cursor: { contains: orgId } }] },
        { key: { startsWith: `smsok:${orgId}:` } },
        { key: { startsWith: "rl:sms:" } },
      ],
    },
  });
  await db.webhookEvent.deleteMany({ where: { provider: "META_LEADS", eventId: { startsWith: `${orgId}:` } } });
  await db.smsMessage.deleteMany({ where: { OR: [{ to: { in: [...WALK_PHONES, OFFICE] } }, { from: { in: [...WALK_PHONES, OFFICE] } }] } });
  await db.smsOptOut.deleteMany({ where: { phone: { in: WALK_PHONES } } });

  // The Page, connected as Integrations → Meta business leaves it (lib/meta/connections selectMetaPage), its token
  // sealed the way lib/crypto/secretBox seals it.
  const key = Buffer.from(need("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY is not 32 bytes");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(PAGE_TOKEN, "utf8"), cipher.final()]);
  const tokenBox = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), sealed.toString("base64url")].join(".");
  const connection = { organizationId: orgId, userId: "61550000000099", pageId: PAGE_ID, pageName: "QA Co Roofing", tokenBox, generation: crypto.randomUUID() };
  await db.syncState.create({ data: { key: `meta:page:${PAGE_ID}:${orgId}`, cursor: JSON.stringify(connection) } });
  await db.organization.update({ where: { id: orgId }, data: { metaSettingsJson: JSON.stringify({ connected: true, autoCreate: false, autoText: false, pageId: PAGE_ID, defaultPage: connection.pageName, formCategory: "auto" }) } });

  // Bob was added by hand: SmartBook leaves him alone until someone presses Offer times.
  const bob = await db.lead.create({ data: { organizationId: orgId, name: PEOPLE.bob.name, phone: PEOPLE.bob.phone, email: PEOPLE.bob.email, projectType: "roof replacement", address: "4410 Main St", city: "Bothell", state: "WA", description: "Added by hand on the walk", source: "MANUAL", status: "NEW" }, select: { id: true } });
  return bob.id;
}

// ── The browser ──────────────────────────────────────────────────────────────

async function open(browser: Browser, phone: boolean, path: string, ready: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: authFile("owner"), ...(phone ? PHONE : DESK) });
  const page = watch(await ctx.newPage());
  await page.goto(`${BASE}${path}`, NAV);
  await page.waitForSelector(ready, UP);
  // The first-estimate tour offers itself to a new company; a person would press Not now.
  const skip = page.locator("[data-tour-root]").getByRole("button", { name: /^(Not now|Skip tour)$/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(600);
  return { ctx, page };
}

/** Customer pages need no sign-in. */
async function openPublic(browser: Browser, phone: boolean, path: string, ready: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(phone ? PHONE : DESK);
  const page = watch(await ctx.newPage());
  await page.goto(`${BASE}${path}`, NAV);
  await page.waitForSelector(ready, UP);
  return { ctx, page };
}

async function noSideways(page: Page, name: string) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${name}: nothing wider than the phone`, w <= 390, w);
}

const textOf = async (page: Page, sel: string) => ((await page.textContent(sel).catch(() => null)) ?? "").trim();
const chipIs = (page: Page, label: string) =>
  page.waitForFunction((l) => document.querySelector("[data-smartbook-chip]")?.textContent?.trim() === l, label, { timeout: 90_000 }).then(() => true, () => false);

async function main() {
  console.log(`SmartBook walk on ${BASE} — QA Co's clock: ${TZ}`);
  const db = prisma();
  const email = credentials("owner")?.email ?? "qa@acme.test";
  const org = await db.organization.findFirst({ where: { slug: "qa-co" }, select: { id: true, name: true } });
  const owner = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!org || !owner) throw new Error("QA Co or its owner is not on this stand (npm run prisma:seed)");
  const bobId = await freshStand(org.id, owner.id);
  const server = await fakeFacebook();
  const browser = await chromium.launch();
  try {
    const signed = await signInRole(browser, "owner");
    if (!signed.ok) throw new Error(`sign in as the owner: ${signed.note}`);

    // 1. Settings → SmartBook: off to start; the owner turns it on and saves; the texts box words to copy.
    {
      const { ctx, page } = await open(browser, false, "/dashboard/settings?tab=smartbook", "[data-smartbook-settings]");
      check("settings: SmartBook is off until the owner turns it on", (await textOf(page, "[data-smartbook-state]")) === "Off");
      const texts = await textOf(page, "[data-smartbook-consent]");
      const calls = ((await page.locator("[data-smartbook-settings]").getByText(/may call me about my request/).first().textContent()) ?? "").trim();
      check("settings: the Facebook consent words to copy (texts and calls)", /may text me/.test(texts) && /may call me/.test(calls), { texts, calls });
      // The owner pastes them into the form's two consent boxes on Facebook.
      fb.boxes = [{ key: "texts", text: texts }, { key: "calls", text: calls }];
      await page.click("[data-smartbook-on]");
      // The one AI call too: the stand has no live desk, so the form says why it can't call yet.
      await page.check("[data-smartbook-call]");
      const blocked = await textOf(page, "[data-smartbook-call-blocked]");
      check("settings: the AI call says why it can't call yet", /^SmartBook can’t call yet: .+ Until then it follows up by text and email\./.test(blocked), blocked);
      await page.click("[data-smartbook-save]");
      const saved = await page.getByText("Saved — SmartBook is answering new leads.").waitFor({ timeout: 60_000 }).then(() => true, () => false);
      check("settings: switched on and saved", saved);
      // Facebook leads reach SmartBook through the Meta sweep: saving it on turned the sweep's switch on.
      const meta = await db.organization.findUnique({ where: { id: org.id }, select: { metaSettingsJson: true } });
      check("settings: saving turned on “New leads come in by themselves”", (JSON.parse(meta?.metaSettingsJson ?? "{}") as { autoCreate?: boolean }).autoCreate === true, meta?.metaSettingsJson);
      await ctx.close();
    }

    // 2. Facebook leads come in by themselves and each gets times the way they agreed to.
    const since = new Date();
    submitForm(PEOPLE.maria, { texts: true, calls: true });
    submitForm(PEOPLE.tom, { texts: false, calls: false });
    submitForm(PEOPLE.ana, { texts: true, calls: false });
    const run = await cron();
    check("the jobs run", run.status === 200, run);
    check("…it read the Page with its own token and proof", fb.refused === 0 && fb.asked.includes(`${PAGE_ID}/leadgen_forms`) && fb.asked.includes(`${FORM_ID}/leads`), { refused: fb.refused, asked: fb.asked });
    const leads = await db.lead.findMany({ where: { organizationId: org.id, phone: { in: [PEOPLE.maria.phone, PEOPLE.tom.phone, PEOPLE.ana.phone] } }, select: { id: true, name: true, phone: true, source: true, status: true } });
    const idOf = (phone: string) => leads.find((l) => l.phone === phone)?.id ?? "";
    const [maria, tom, ana] = [idOf(PEOPLE.maria.phone), idOf(PEOPLE.tom.phone), idOf(PEOPLE.ana.phone)];
    check("three Facebook leads came in with nobody pressing Import", leads.length === 3 && leads.every((l) => l.source === "FACEBOOK" && l.status === "NEW"), leads);
    const mariaText = await textTo(PEOPLE.maria.phone, since, /1\)/);
    check("Maria (texts box ticked) is texted her times", !!mariaText && /\/b\/[A-Za-z0-9_-]+/.test(mariaText.body) && /Reply STOP/.test(mariaText.body), mariaText?.body);
    const anaText = await textTo(PEOPLE.ana.phone, since, /1\)/);
    check("Ana (texts box ticked) is texted her times", !!anaText, anaText?.body);
    const [mc, tc, ac] = await Promise.all([convOf(org.id, maria), convOf(org.id, tom), convOf(org.id, ana)]);
    check("Tom (box not ticked) gets no text — his times go by email", (await textsTo(PEOPLE.tom.phone, since)).length === 0 && !!tc && tc.text === false && tc.status === "offered", tc);
    check("the calls box counts: Maria may get the one AI call, Ana may not", mc?.call === true && ac?.call === false, { maria: mc?.call, ana: ac?.call });
    const again = await cron();
    check("the next check brings nobody twice", again.status === 200 && (await db.lead.count({ where: { organizationId: org.id, phone: { in: WALK_PHONES } } })) === 4, again);

    // 3. Settings again: the form's boxes are seen; Send me a test.
    {
      const { ctx, page } = await open(browser, false, "/dashboard/settings?tab=smartbook", "[data-smartbook-settings]");
      check("settings: On", (await textOf(page, "[data-smartbook-state]")) === "On");
      const forms = await textOf(page, "[data-smartbook-forms]");
      check("settings: the Facebook form's texts box is seen", forms === "1 of your 1 Facebook form has the texts box.", forms);
      await page.click("[data-smartbook-test]");
      await page.waitForSelector("[data-smartbook-test-result]", { timeout: 90_000 }).catch(() => {});
      const sent = await textOf(page, "[data-smartbook-test-result]");
      check("settings: Send me a test goes to the owner's own phone", /^Sent/.test(sent) && !!(await textTo(OFFICE, since, /1\)/, 30_000)), sent);
      await ctx.close();
    }

    // 4. The leads list on the desk: the tags.
    {
      const { ctx, page } = await open(browser, false, "/dashboard/leads", "#leadTableBody tr");
      await page.waitForFunction(() => /SmartBook · /.test(document.querySelector("#leadTableBody")?.textContent ?? ""), null, { timeout: 60_000 }).catch(() => {});
      const body = await textOf(page, "#leadTableBody");
      check("leads: the three show SmartBook · Times sent", (body.match(/SmartBook · Times sent/g) ?? []).length >= 3 && /Maria Lopez/.test(body) && /Tom Reyes/.test(body) && /Ana Ruiz/.test(body), body.slice(0, 300));
      await ctx.close();
    }

    // 5. Maria texts back "2" — booked, no person needed.
    const t5 = new Date();
    check("Maria's reply is taken (signed like Twilio)", (await customerTexts(PEOPLE.maria.phone, "2")) === 200);
    const allSet = await textTo(PEOPLE.maria.phone, t5, /You're all set/);
    check("…she is booked and told so", !!allSet && (await db.appointment.count({ where: { leadId: maria } })) === 1, allSet?.body);

    // 6. Ana asks for her own time by text — "let me check", and the company is asked.
    const t6 = new Date();
    check("Ana's text is taken", (await customerTexts(PEOPLE.ana.phone, "Can you do Saturday at 10am instead?")) === 200);
    const checking = await textTo(PEOPLE.ana.phone, t6, /Let me check/);
    check("…she hears \"let me check … and get back to you\"", !!checking && /get back to you/.test(checking.body), checking?.body);
    const asked = await textTo(OFFICE, t6, /Ana/);
    check("…and the company is asked by text", !!asked, asked?.body);

    // 7. Tom opens the email's page on his phone and suggests a time.
    const pickDay = dayIn(9);
    {
      const { ctx, page } = await openPublic(browser, true, `/b/${tc?.token ?? "none"}`, "[data-pick-offer]");
      check("Tom's page: his times on offer", (await page.locator("[data-pick-offer]").count()) >= 2);
      await noSideways(page, "Tom's page");
      await page.click("[data-pick-suggest]");
      await page.waitForSelector("[data-pick-suggest-form]");
      await page.fill("[data-pick-day]", pickDay);
      await page.fill("[data-pick-time]", "10:00");
      await page.click("[data-pick-send]");
      const waiting = await page.waitForSelector("[data-pick-asked]", { timeout: 60_000 }).then(() => true, () => false);
      check("Tom's page: \"we'll check and get back to you\"", waiting && /10am/.test(await textOf(page, "[data-pick-asked]")), await textOf(page, "[data-pick-asked]"));
      await ctx.close();
    }

    // 8. The desk calendar: both requests wait; Yes books Tom.
    {
      const { ctx, page } = await open(browser, false, "/dashboard/calendar", "[data-smartbook-requests]");
      check("calendar: Ana's and Tom's requests wait", (await page.locator(`[data-smartbook-request="${ana}"], [data-smartbook-request="${tom}"]`).count()) === 2);
      await page.click(`[data-smartbook-request="${tom}"] [data-smartbook-yes]`);
      await page.waitForSelector(`[data-smartbook-request="${tom}"] [data-smartbook-done]`, { timeout: 90_000 }).catch(() => {});
      const done = await textOf(page, `[data-smartbook-request="${tom}"] [data-smartbook-done]`);
      check("calendar: Yes books Tom", /^Done — Tom Reyes is booked/.test(done) && (await db.appointment.count({ where: { leadId: tom } })) === 1, done);
      await ctx.close();
    }

    // 9. The phone calendar: No for Ana — she is offered other times.
    {
      const t9 = new Date();
      const { ctx, page } = await open(browser, true, "/dashboard/calendar", `[data-smartbook-request="${ana}"]`);
      await noSideways(page, "phone calendar");
      await page.click(`[data-smartbook-request="${ana}"] [data-smartbook-no]`);
      await page.waitForSelector(`[data-smartbook-request="${ana}"] [data-smartbook-done]`, { timeout: 90_000 }).catch(() => {});
      check("phone calendar: No offers Ana other times", /offered Ana Ruiz other times/.test(await textOf(page, `[data-smartbook-request="${ana}"]`)));
      const other = await textTo(PEOPLE.ana.phone, t9, /1\)/);
      check("…and she is texted them", !!other, other?.body);
      await ctx.close();
    }

    // 10. The lead page on the desk: the conversation, Pause, Restart; Offer times for a lead added by hand.
    {
      const { ctx, page } = await open(browser, false, `/dashboard/leads/${ana}`, "[data-lead-smartbook]");
      check("Ana's lead page: Times sent, with her texts in the conversation", (await textOf(page, "[data-smartbook-chip]")) === "Times sent" && (await page.locator("[data-smartbook-talk] [data-dir=in]").count()) >= 1);
      await page.click("[data-smartbook-pause]");
      check("…Pause → Paused", await chipIs(page, "Paused"));
      await page.click("[data-smartbook-restart]");
      check("…Restart → Times sent", await chipIs(page, "Times sent"));
      await ctx.close();
    }
    {
      const { ctx, page } = await open(browser, false, `/dashboard/leads/${bobId}`, "[data-smartbook-offer]");
      await page.click("[data-smartbook-offer]");
      check("Bob (added by hand): Offer times → Times sent, by email", (await chipIs(page, "Times sent")) && /By email/.test(await textOf(page, "[data-lead-smartbook]")));
      await ctx.close();
    }

    // 11. The phone: the leads list, a booked lead, Tom's page booked, Settings.
    {
      const { ctx, page } = await open(browser, true, "/dashboard/leads", "body");
      const tagged = await page.waitForFunction(() => (document.body.textContent?.match(/SmartBook · /g) ?? []).length >= 4, null, { timeout: 90_000 }).then(() => true, () => false);
      check("phone leads: SmartBook tags on the rows", tagged && (await page.getByText("SmartBook · Booked").count()) >= 2);
      await noSideways(page, "phone leads");
      await ctx.close();
    }
    {
      const { ctx, page } = await open(browser, true, `/dashboard/leads/${maria}`, "[data-lead-smartbook]");
      check("phone: Maria's lead is Booked", (await textOf(page, "[data-smartbook-chip]")) === "Booked");
      await noSideways(page, "phone lead page");
      await ctx.close();
    }
    {
      const { ctx, page } = await openPublic(browser, true, `/b/${tc?.token ?? "none"}`, "[data-pick-booked]");
      check("Tom's page now says he's booked", /You're booked/.test(await textOf(page, "[data-pick-booked]")));
      await ctx.close();
    }
    {
      // SmartHelp's Open lands here. Both Settings layouts keep every section mounted; until 2026-10-31 the hidden
      // Billing section's manage window moved an owner with a subscription to ?tab=billing from any Settings link
      // (components/billing/FreeSwitch.tsx, now `shown`). Checked, then SmartBook is picked from the menu as a person
      // would, so a regression costs this one check.
      const { ctx, page } = await open(browser, true, "/dashboard/settings?tab=smartbook", ".mst-swV");
      await page.waitForTimeout(2000);
      const form = page.locator("[data-smartbook-settings]");
      check("phone settings: the SmartBook link opens SmartBook", await form.isVisible(), `landed on ${page.url()}`);
      if (!(await form.isVisible())) {
        await page.locator('.mst-swBtn[aria-haspopup="listbox"]').click();
        await page.getByRole("option", { name: /SmartBook/ }).click();
        await form.waitFor({ timeout: 30_000 });
      }
      await noSideways(page, "phone settings");
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-smartbook-settings] button, [data-smartbook-settings] select, [data-smartbook-settings] textarea, [data-smartbook-settings] input[type=checkbox]"))
          .filter((el) => el.offsetParent && !el.closest("details:not([open])"))
          .map((el) => ({ t: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: Math.round((el.closest("label") ?? el).getBoundingClientRect().height) }))
          // Links inside a sentence (Notifications, Connect it…) are text, not targets.
          .filter((x) => x.h < 40 && !/Copy|Use SmartBook|Notifications|Connect it/.test(x.t)),
      );
      check("phone settings: touch targets ≥ 40px", small.length === 0, small);
      await ctx.close();
    }

    // 12. SmartHelp's two guides (desk): Open lands on Settings → SmartBook, Show me lights the switch and the words.
    {
      const { ctx, page } = await open(browser, false, "/dashboard/leads", "#leadTableBody tr");
      const panel = page.locator("aside[aria-labelledby]").filter({ has: page.getByRole("heading", { name: "SmartHelp" }) });
      await page.locator('[data-tour="smarthelp"]:visible').first().click();
      await panel.waitFor({ timeout: 30_000 });
      const guide = async (title: string) => {
        const back = panel.getByRole("button", { name: "All guides" });
        if (await back.isVisible().catch(() => false)) await back.click();
        const before = await panel.locator("article[data-entry]").count();
        await panel.getByRole("button", { name: title }).first().click();
        await until(async () => (await panel.locator("article[data-entry]").count()) > before, 30_000);
        const entry = panel.locator(`article[data-entry="${await panel.locator("article[data-entry]").last().getAttribute("data-entry")}"]`);
        await entry.locator("ol li").first().waitFor({ timeout: 30_000 });
        return entry;
      };
      const light = page.locator("[data-smarthelp-spotlight]");
      const lights = async (step: ReturnType<Page["locator"]>, target: string) => {
        await step.getByRole("button", { name: "Show me" }).click();
        return (await light.waitFor({ timeout: 15_000 }).then(() => true, () => false)) && (await light.getAttribute("data-smarthelp-spotlight")) === target;
      };
      const on = await guide("Turn on SmartBook");
      check('SmartHelp: "Turn on SmartBook" shows its six steps', (await on.locator("ol li").count()) === 6);
      await on.locator("ol li").first().getByRole("button", { name: "Open" }).click();
      const there = await page.waitForURL(/\/dashboard\/settings\?pane=smartbook/, { timeout: 60_000 }).then(() => true, () => false);
      check("…Open goes to Settings → SmartBook", there && (await page.locator("[data-smartbook-settings]").waitFor({ timeout: 60_000 }).then(() => true, () => false)), page.url());
      check("…Show me lights the switch", await lights(on.locator("ol li").first(), "smartbook:on"));
      const fbGuide = await guide("Add the texts box to your Facebook form");
      check("…Show me lights the texts box words", await lights(fbGuide.locator("ol li").nth(1), "smartbook:consent"));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  check("no console errors on any page", consoleErrors.length === 0, consoleErrors.slice(0, 8));
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  await prisma().$disconnect();
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error("walk crashed:", e);
  process.exit(2);
});
