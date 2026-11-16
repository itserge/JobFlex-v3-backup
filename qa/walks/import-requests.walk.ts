// WALK — "Switch to JobFlex" + "Do it for me" (2026-11-16, CRM migration plan parts 3–4; the owner: public pages + in
// the app; "Do it for me" free for everyone, within 2 business days, worked by the platform admins).
//
//   public  /switch, /switch/housecall-pro (its steps, the questions, the program remembered), /switch/workiz (no
//           client export → Do it for me), an unknown program 404, a phone without sideways scroll;
//   company /dashboard/clients/import?from=jobber opens on Jobber; Do it for me: three files (one an old .xls) + a
//           note → sent, due in 2 business days; a second request cancelled by the company; a third sent;
//   team    Admin → Imports: the queue, the request, the .xls marked unreadable, I'm on it, Read the files (the .xls
//           listed as not read), Bring them in for QA Co → done, files deleted; the third cancelled with a reason;
//   emails  to the team ×3, "your clients are in" ×1, "about your import" ×1 (the stand's EMAIL_DEV_OUTBOX);
//   company the request reads Done; the import is under Your imports and undone (the walk cleans up after itself).
//
// Wants on the stand: QA_BASE_URL, QA_PASS_OWNER (qa@acme.test — the QA Co owner, a platform admin on the stand),
// EMAIL_DEV_OUTBOX. QA_WALK_SHOTS = a folder for the pictures.
import { readdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { baseUrl } from "../lib/env";
import { authFile, signInRole } from "../lib/roles";

let bad = 0;
let good = 0;
const check = (name: string, ok: boolean, extra: unknown = "") => {
  if (!ok) bad++;
  else good++;
  const more = extra === "" || extra === undefined ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : more}`);
};

const BASE = baseUrl();
const NAV = { waitUntil: "domcontentloaded" as const, timeout: 120_000 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SHOTS = process.env.QA_WALK_SHOTS || "";
const OUTBOX = process.env.EMAIL_DEV_OUTBOX || "";
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

const consoleErrors: string[] = [];
const NOISE = /Download the React DevTools|\[HMR\]|\[Fast Refresh\]|favicon|webpack-hmr|_next\/static\/.*\.map|Failed to load resource/i;
function watch(page: Page): Page {
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${new URL(page.url()).pathname}: ${e.message.slice(0, 200)}`));
  return page;
}

async function open(browser: Browser, opts: { phone?: boolean; signedIn?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...(opts.signedIn === false ? {} : { storageState: authFile("owner") }), ...(opts.phone ? PHONE : { viewport: { width: 1440, height: 900 } }) });
  return { ctx, page: watch(await ctx.newPage()) };
}

async function goto(page: Page, url: string) {
  const res = await page.goto(`${BASE}${url}`, NAV);
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 2500 }).catch(() => {});
  return res;
}

/** Press until the page answers: in dev the page is drawn before React has taken it over, and a press then is lost. */
async function pressUntil(page: Page, press: string, until: string) {
  for (let i = 0; i < 40 && !(await page.locator(until).count()); i++) {
    await page.locator(press).first().click();
    await page.waitForTimeout(750);
  }
  await page.locator(until).first().waitFor({ timeout: 10_000 });
}

const outbox = () => (OUTBOX ? readdirSync(OUTBOX).filter((f) => f.endsWith(".html")) : []);

const CUSTOMERS = `Customer ID,Display name,Mobile number,Email,Street,City,State,Zip,Customer tags
3001,Request Walk One,(555) 620-1001,rw1@import.test,12 Oak St,Austin,TX,78701,VIP
3002,Request Walk Two,555-620-1002,rw2@import.test,8 Elm Rd,Austin,TX,78702,
3003,Request Walk Lake HOA,555-620-1003,board@rwlake.test,1 Lake Dr,Round Rock,TX,78664,Commercial
`;
const JOBS = `Job #,Customer ID,Customer,Customer phone,Job description,Scheduled start,Completed date,Status,Total amount,Amount paid,Outstanding balance,Due date
R-101,3001,Request Walk One,,Water heater install,10/02/2026 8:00 AM,10/02/2026,Completed,"$2,450.00","$2,450.00",$0.00,
R-102,3001,Request Walk One,,Drain repair,10/20/2026,10/21/2026,Completed,$800,$300,$500,11/05/2026
R-104,,Request Walk Pat,555-620-7777,Roof leak check,,,Needs scheduling,,,,
`;
const FILES = [
  { name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(CUSTOMERS) },
  { name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(JOBS) },
  { name: "old-invoices.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("\xD0\xCF\x11\xE0 not really an old Excel file") },
];

/** Send one request from the open "Do it for me" form; returns the new request's id. */
async function sendRequest(page: Page, files: typeof FILES, note: string): Promise<string | null> {
  const before = await page.locator("[data-request-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-request-row")));
  await page.locator("[data-dfm-input]").setInputFiles(files);
  await page.waitForFunction((n) => document.querySelectorAll('[data-dfm-file="done"]').length >= n || document.querySelector('[data-dfm-file="error"]'), files.length, { timeout: 90_000 });
  if (note) await page.locator("[data-dfm-note]").fill(note);
  await page.locator("[data-dfm-send]").click();
  await page.locator("[data-dfm-sent]").waitFor({ timeout: 60_000 });
  await page.waitForFunction((n) => document.querySelectorAll("[data-request-row]").length > n, before.length, { timeout: 30_000 });
  const after = await page.locator("[data-request-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-request-row")));
  return after.find((id) => !before.includes(id)) ?? null;
}

async function main() {
  const browser = await chromium.launch();
  const r = await signInRole(browser, "owner");
  if (!r.ok) throw new Error(`sign in: ${r.note}`);
  const mailsBefore = outbox().length;

  // ── the public pages ──
  {
    const { ctx, page } = await open(browser, { signedIn: false });
    await goto(page, "/switch");
    await page.locator("[data-switch-tile]").first().waitFor({ timeout: 90_000 });
    check("/switch: a tile per program (seven)", (await page.locator("[data-switch-tile]").count()) === 7);
    await goto(page, "/switch/housecall-pro");
    const h1 = await page.locator("h1").innerText();
    check("/switch/housecall-pro: “Moving from Housecall Pro?”", /Moving from Housecall Pro\?/.test(h1), h1);
    const body = await page.locator("main").innerText();
    check("its export steps, from Housecall Pro's own help center", /Customers \(left menu\) → Actions/.test(body) && /notifications@housecallpro\.com/.test(body));
    check("Do it for me: free, within 2 business days", /Do it for me · free/i.test(body) && /within 2 business days/.test(body));
    check("the questions: nothing sent, no password, files deleted", /Is anything sent to my clients\?/.test(body) && /Do you need my Housecall Pro password\?/.test(body) && /deleted from our storage/.test(body));
    check("no prices on the page", !/\$\d/.test(body), body.match(/\$\d[^\s]*/)?.[0]);
    check("the questions are marked up for search (FAQPage)", (await page.locator('script[type="application/ld+json"]').allInnerTexts()).some((t) => t.includes('"FAQPage"')));
    await page.waitForTimeout(500);
    const cookie = (await ctx.cookies()).find((c) => c.name === "jf_moving_from");
    check("the program is remembered for the Welcome page (30 days)", cookie?.value === "HOUSECALL_PRO", cookie);
    await shot(page, "switch-hcp");
    await goto(page, "/switch/workiz");
    check("/switch/workiz: says Workiz shows no client export, and points to Do it for me", /no export of the client list/i.test(await page.locator("main").innerText()));
    const nope = await goto(page, "/switch/nope");
    check("an unknown program is a 404", nope?.status() === 404, nope?.status());
    await ctx.close();
    const ph = await open(browser, { signedIn: false, phone: true });
    await goto(ph.page, "/switch/jobber");
    await ph.page.locator("h1").waitFor({ timeout: 90_000 });
    const wide = await ph.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("phone: /switch/jobber never scrolls sideways", wide <= 1, wide);
    await shot(ph.page, "switch-jobber-phone");
    await ph.ctx.close();
  }

  const { ctx, page } = await open(browser);
  let id1: string | null = null;
  let id3: string | null = null;

  // ── the company: Do it for me ──
  {
    await goto(page, "/dashboard/clients/import?from=jobber");
    await page.locator("[data-import-page]").waitFor({ timeout: 90_000 });
    check("?from=jobber opens on Jobber, its steps shown", (await page.locator("[data-import-source=JOBBER]").getAttribute("aria-checked")) === "true" && /Insights → Reports/.test(await page.locator("[data-import-steps]").innerText()));
    await goto(page, "/dashboard/clients/import?from=housecall-pro");
    await page.locator("[data-import-page]").waitFor({ timeout: 90_000 });
    const dfm = await page.locator("[data-dfm]").innerText();
    check("Do it for me is offered under the steps: free, within 2 business days, never the password", /within 2 business days/.test(dfm) && /never ask for your Housecall Pro password/.test(dfm));
    await pressUntil(page, "[data-dfm-open]", "[data-dfm-note]");
    id1 = await sendRequest(page, FILES, "Only active customers, please.");
    const sent = await page.locator("[data-dfm-sent]").innerText();
    check("sent: “Our team will bring them in by <day>”", /bring them in by [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/.test(sent), sent);
    check("the request is listed, waiting, with its due day", !!id1 && (await page.locator(`[data-request-row="${id1}"]`).getAttribute("data-request-status")) === "NEW" && /Waiting for our team — by/.test(await page.locator(`[data-request-row="${id1}"]`).innerText()));
    await shot(page, "dfm-sent");

    const id2 = await sendRequest(page, [FILES[0]], "");
    await page.locator(`[data-request-cancel="${id2}"]`).click();
    await page.locator("[data-request-cancel-yes]").click();
    await page.waitForFunction((id) => document.querySelector(`[data-request-row="${id}"]`)?.getAttribute("data-request-status") === "CANCELED", id2, { timeout: 30_000 });
    check("the company cancels a request that still waits", true);
    id3 = await sendRequest(page, [FILES[0]], "");
    check("a third request is sent", !!id3);
  }

  // ── the team: Admin → Imports ──
  if (id1) {
    await goto(page, "/admin/imports");
    await page.locator("[data-admin-imports]").waitFor({ timeout: 90_000 });
    check("Admin → Imports lists the request, waiting", (await page.locator(`[data-queue-row="${id1}"]`).getAttribute("data-queue-status")) === "NEW");
    check("the menu has Imports with a waiting badge", (await page.locator('a[href="/admin/imports"]').first().innerText()).match(/\d/) !== null, await page.locator('a[href="/admin/imports"]').first().innerText());
    await goto(page, `/admin/imports?request=${id1}`);
    await page.locator(`[data-detail="${id1}"]`).waitFor({ timeout: 60_000 });
    const files = page.locator("[data-detail-file]");
    check("the request's three files, each with a download link", (await files.count()) === 3 && (await files.locator("a").count()) === 3);
    check("the old .xls is marked: can't be read here — save it as CSV", /can't be read here/.test(await page.locator('[data-detail-file="old-invoices.xls"]').innerText()));
    check("the note is shown", /Only active customers/.test(await page.locator(`[data-detail="${id1}"]`).innerText()));
    await pressUntil(page, "[data-take]", `[data-detail-status="WORKING"]`);
    check("I'm on it → Working", (await page.locator(`[data-detail="${id1}"]`).getAttribute("data-detail-status")) === "WORKING");
    await pressUntil(page, "[data-read]", "[data-workbench-summary], [data-workbench-error]");
    const summary = await page.locator("[data-workbench-summary]").innerText().catch(() => "");
    check("Read the files: 4 new clients, 1 open invoice ($500 owed)", /4 new clients/.test(summary) && /1 open invoice · \$500 owed/.test(summary), summary || (await page.locator("[data-workbench-error]").innerText().catch(() => "")));
    check("the .xls is listed as not read, the rest go on", /old-invoices\.xls/.test(await page.locator("[data-unread]").innerText().catch(() => "")) && (await page.locator("[data-import-file]").count()) === 2);
    await shot(page, "admin-workbench");
    await page.locator("[data-bring]").click();
    await page.locator(`[data-detail="${id1}"][data-detail-status="DONE"]`).waitFor({ timeout: 120_000 });
    const doneText = await page.locator("[data-detail-done]").innerText();
    check("Bring them in for QA Co → done: 4 new clients", /4 new clients/.test(doneText), doneText);
    check("the files are deleted from storage, links gone", /Deleted from storage/.test(await page.locator(`[data-detail="${id1}"]`).innerText()) && (await page.locator("[data-detail-file] a").count()) === 0);
    await shot(page, "admin-done");
  }
  if (id3) {
    await goto(page, `/admin/imports?request=${id3}`);
    await page.locator(`[data-detail="${id3}"]`).waitFor({ timeout: 60_000 });
    await pressUntil(page, "[data-cancel-open]", "[data-cancel-reason]");
    await page.locator("[data-cancel-reason]").fill("The file holds only one client — please send the whole Customers export.");
    await page.locator("[data-cancel-send]").click();
    await page.locator(`[data-detail="${id3}"][data-detail-status="CANCELED"]`).waitFor({ timeout: 60_000 });
    check("the team cancels with a reason", /only one client/.test(await page.locator(`[data-detail="${id3}"]`).innerText()));
  }

  // ── the emails (the stand's outbox) ──
  if (OUTBOX) {
    await new Promise((res) => setTimeout(res, 1500));
    const fresh = outbox().slice(mailsBefore);
    const n = (re: RegExp) => fresh.filter((f) => re.test(f)).length;
    check("the team is emailed for each request (3)", n(/Import-request-QA-Co/) === 3, fresh);
    check("the company: “Your Housecall Pro clients are in JobFlex” (1)", n(/Your-Housecall-Pro-clients-are-in-JobFlex/) === 1, fresh);
    check("the company: “About your Housecall Pro import” — the reason (1)", n(/About-your-Housecall-Pro-import/) === 1, fresh);
  }

  // ── the company again: done, and undone (the walk cleans up) ──
  if (id1) {
    await goto(page, "/dashboard/clients/import");
    await page.locator("[data-import-page]").waitFor({ timeout: 90_000 });
    check("the company sees the request done", (await page.locator(`[data-request-row="${id1}"]`).getAttribute("data-request-status")) === "DONE");
    check("the cancelled one says why", /only one client/.test(await page.locator(`[data-request-row="${id3}"]`).innerText()));
    const row = page.locator("[data-import-history] [data-import-status=DONE]").first();
    await row.waitFor({ timeout: 30_000 });
    await pressUntil(page, "[data-import-history] [data-import-status=DONE] [data-import-undo]", "[data-import-undo-yes]");
    await page.locator("[data-import-undo-yes]").click();
    await page.locator("[data-import-note]").waitFor({ timeout: 60_000 });
    check("the company undoes the team's import itself: 4 clients removed", /Undone: 4 clients removed/.test(await page.locator("[data-import-note]").innerText()));
  }
  await ctx.close();

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await browser.close();
  console.log(`\n${good} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
