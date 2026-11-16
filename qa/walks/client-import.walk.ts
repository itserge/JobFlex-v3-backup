// WALK — Bring your clients (owner, 2026-11-16: "move contractors' CRM base with clients to JobFlex from other
// platforms like Housecall Pro"; parts 1–2). Clients → Bring your clients → Housecall Pro → drop a customers file and a
// jobs file → each file read (what it is, its columns) → what comes in → Bring them in → the clients on the list, the
// client's history on their page → the same files again: nothing new → Undo → the phone width.
//
// Wants on the stand: QA_BASE_URL, QA_PASS_OWNER (qa@acme.test). The walk's clients are named "Walk Tester…" and are
// taken back by its own Undo. QA_WALK_SHOTS = a folder for the pictures.
import { randomBytes } from "node:crypto";
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

async function open(browser: Browser, opts: { phone?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: authFile("owner"), ...(opts.phone ? PHONE : { viewport: { width: 1440, height: 900 } }) });
  return { ctx, page: watch(await ctx.newPage()) };
}

async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, NAV);
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 2500 }).catch(() => {});
}

// ── the files a Housecall Pro owner exports (their own column names) ──
const CUSTOMERS = `Customer ID,Display name,First name,Last name,Company,Mobile number,Home number,Email,Street,City,State,Zip,Customer tags,Lead source,Notes
2001,Walk Tester One,Walk,Tester One,,(555) 610-1001,555-610-0001,walk1@import.test,12 Oak St,Austin,TX,78701,"VIP, Repeat",Google,Dog in yard
2002,Walk Tester Two,Walk,Tester Two,,555-610-1002,,walk2@import.test,8 Elm Rd,Austin,TX,78702,,Referral,
2003,Walk Tester Lake HOA,,,Lake Walk HOA,555-610-1003,,board@lakewalk.test,1 Lake Dr,Round Rock,TX,78664,Commercial,,Gate code 4411
2004,,,,,,,,,,,,,,orphan note
`;
// Upcoming = a year out, so the walk keeps working whatever day it runs.
const next = new Date().getFullYear() + 1;
const JOBS = `Job #,Customer ID,Customer,Customer phone,Job description,Scheduled start,Scheduled end,Completed date,Status,Assigned employees,Total amount,Amount paid,Outstanding balance,Due date
W-101,2001,Walk Tester One,,Water heater install,10/02/2026 8:00 AM,,10/02/2026,Completed,Mike,"$2,450.00","$2,450.00",$0.00,
W-102,2001,Walk Tester One,,Drain repair,10/20/2026,,10/21/2026,Completed,"Mike, Ana",$800,$300,$500,11/05/2026
W-103,2002,Walk Tester Two,,Annual tune-up,03/03/${next} 9:00 AM,03/03/${next} 11:30 AM,,Scheduled,Ana,$189,,,
W-104,,Walk Tester Pat,555-610-7777,Roof leak check,,,,Needs scheduling,,,,,
W-105,2003,Walk Tester Lake HOA,,Gutter clean,09/01/2026,,,Canceled,,$300,,,
`;
const FILES = [
  { name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(CUSTOMERS) },
  { name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(JOBS) },
];

/** Press until the page answers: in dev the page is drawn before React has taken it over, and a press then is lost. */
async function pressUntil(page: Page, press: string, until: string) {
  for (let i = 0; i < 40 && !(await page.locator(until).count()); i++) {
    await page.locator(press).first().click();
    await page.waitForTimeout(750);
  }
  await page.locator(until).first().waitFor({ timeout: 10_000 });
}

async function dropFiles(page: Page) {
  await pressUntil(page, "[data-import-source=HOUSECALL_PRO]", "[data-import-steps]");
  await page.locator("[data-import-input]").setInputFiles(FILES);
  await page.locator("[data-import-summary], [data-import-error]").first().waitFor({ timeout: 90_000 });
}

async function main() {
  const browser = await chromium.launch();
  const r = await signInRole(browser, "owner");
  if (!r.ok) throw new Error(`sign in: ${r.note}`);

  // ── the desk ──
  {
    const { ctx, page } = await open(browser);
    await goto(page, "/dashboard/clients");
    const btn = page.locator("[data-clients-import]");
    await btn.waitFor({ timeout: 90_000 });
    check("Clients: the owner sees Bring your clients", /^bring your clients$/i.test((await btn.innerText()).trim()), await btn.innerText());
    await btn.click();
    await page.waitForURL(/\/dashboard\/clients\/import/, { timeout: 60_000 });
    await page.locator("[data-import-page]").waitFor({ timeout: 60_000 });
    check("it opens the import page", /bring your clients/i.test(await page.locator("h1").innerText()));
    check("eight programs to pick from", (await page.locator("[data-import-source]").count()) === 8);

    // A clean start: an import an earlier run left is undone first, so this one brings the walk's clients in anew.
    for (let i = 0; i < 5 && (await page.locator("[data-import-history] [data-import-status=DONE]").count()); i++) {
      await pressUntil(page, "[data-import-history] [data-import-status=DONE] [data-import-undo]", "[data-import-undo-yes]");
      await page.locator("[data-import-undo-yes]").click();
      await page.locator("[data-import-note]").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
    }

    await pressUntil(page, "[data-import-source=HOUSECALL_PRO]", "[data-import-steps]");
    const steps = page.locator("[data-import-steps] ol li");
    await steps.first().waitFor({ timeout: 10_000 });
    check("Housecall Pro: its export steps are shown", (await steps.count()) >= 3, await steps.count());

    await dropFiles(page);
    const err = page.locator("[data-import-error]");
    check("the files are read, no error", (await err.count()) === 0, (await err.count()) ? await err.innerText() : "");
    const cards = page.locator("[data-import-file]");
    check("one card per file", (await cards.count()) === 2, await cards.count());
    const kinds = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-import-kind")).sort());
    check("customers.csv is clients, jobs.csv jobs and invoices", JSON.stringify(kinds) === JSON.stringify(["clients", "work"]), kinds);
    const custCard = page.locator("[data-import-file]", { hasText: "customers.csv" });
    await custCard.locator("summary").click();
    const firstField = custCard.locator("[data-import-field]").nth(1);
    check("the column table shows what each column is (Display name → Name)", (await firstField.inputValue()) === "name", await firstField.inputValue());
    const summary = page.locator("[data-import-summary]");
    const text = await summary.innerText();
    check("what comes in: 4 new clients (three customers + the job's own Pat)", /4 new clients/.test(text), text);
    check("what comes in: one open invoice, $500 owed", /1 open invoice · \$500 owed/.test(text), text);
    check("what comes in: one upcoming job on the calendar", /1 upcoming job on the calendar/.test(text), text);
    check("what comes in: one job not scheduled yet", /1 job not scheduled yet/.test(text), text);
    check("what comes in: the past jobs in the clients' history", /in the clients' history/.test(text), text);
    check("the row with no name, phone or email is left out, with why", /left out — see why/.test(text), text);
    check("it says nothing is sent", /Nothing is sent to anyone/.test(text));
    await shot(page, "import-preview");

    // A column changed by hand: the preview reads again with it.
    const notesSel = custCard.locator("[data-import-field]").nth(14);
    await notesSel.selectOption("skip");
    await page.waitForTimeout(900);
    await summary.waitFor({ timeout: 60_000 });
    check("a column set to Leave out stays left out after the preview reads again", (await custCard.locator("[data-import-field]").nth(14).inputValue()) === "skip");
    await notesSel.selectOption("notes");
    await page.waitForTimeout(900);
    await summary.waitFor({ timeout: 60_000 });

    const run = page.locator("[data-import-run]");
    check("Bring them in is ready", await run.isEnabled());
    await run.click();
    const done = page.locator("[data-import-done]");
    await done.waitFor({ timeout: 120_000 });
    const doneText = await done.innerText();
    check("brought in: 4 new clients", /4 new clients/.test(doneText), doneText);
    check("brought in: links to the clients and the calendar", (await done.locator("a", { hasText: "See your clients" }).count()) === 1 && (await done.locator("a", { hasText: "Open the calendar" }).count()) === 1);
    const listed = await page.locator("[data-import-history] [data-import-status=DONE]").first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
    check("the import is listed with Undo", listed);
    await shot(page, "import-done");

    // The clients on the list.
    await goto(page, "/dashboard/clients");
    await page.locator("[data-clients-import]").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const list = await page.locator(".content").innerText();
    check("the clients list has the imported clients", /Walk Tester One/.test(list) && /Walk Tester Pat/.test(list), "");

    // A client's own page: the past jobs in the timeline, what they paid and what they still owe.
    await pressUntil(page, "text=Walk Tester One", "[data-rv-cell]");
    await page.waitForURL(/client-detail\?client=/, { timeout: 60_000 });
    const kpis = page.locator("[data-rv-cell]");
    await kpis.first().waitFor({ timeout: 60_000 });
    const kpiText = (await kpis.allInnerTexts()).join(" | ");
    check("client page: Lifetime value counts what they paid before ($2,450 + $300)", /lifetime value\s*\|?\s*\$2,750/i.test(kpiText.replace(/\n/g, " ")), kpiText);
    check("client page: Outstanding balance is the open invoice ($500)", /outstanding balance\s*\$500/i.test(kpiText.replace(/\n/g, " ")), kpiText);
    const timeline = page.locator("main, .content").first();
    await page.locator("text=Water heater install").first().waitFor({ timeout: 60_000 }).catch(() => {});
    const tl = await timeline.innerText();
    check("client page: the timeline has the past jobs from Housecall Pro", /Water heater install/.test(tl) && /Drain repair/.test(tl) && /Housecall Pro/i.test(tl), tl.slice(0, 300));
    await shot(page, "import-client-page");

    // The same files again: nothing new.
    await goto(page, "/dashboard/clients/import");
    await page.locator("[data-import-page]").waitFor({ timeout: 60_000 });
    await dropFiles(page);
    const again = await page.locator("[data-import-summary]").innerText();
    check("the same files again: rows already in JobFlex are left as they are", /already in JobFlex — left as they are/.test(again), again);
    check("the same files again: no new clients", !/new client/.test(again), again);

    // Undo.
    await page.reload(NAV);
    const row = page.locator("[data-import-history] [data-import-status=DONE]").first();
    await row.waitFor({ timeout: 60_000 });
    await pressUntil(page, "[data-import-history] [data-import-status=DONE] [data-import-undo]", "[data-import-undo-yes]");
    await page.locator("[data-import-undo-yes]").click();
    const note = page.locator("[data-import-note]");
    await note.waitFor({ timeout: 60_000 });
    const noteText = await note.innerText();
    check("Undo takes back the 4 clients", /Undone: 4 clients removed/.test(noteText), noteText);
    await page.waitForTimeout(500);
    check("the import reads undone", (await page.locator("[data-import-history] [data-import-status=UNDONE]").count()) >= 1);
    await goto(page, "/dashboard/clients");
    await page.locator("[data-clients-import]").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    check("the clients are gone from the list", !/Walk Tester/.test(await page.locator(".content").innerText()));
    await ctx.close();
  }

  // ── big files: a big CSV is packed by the browser and opened by the server; one too big for a call is told so ──
  {
    const { ctx, page } = await open(browser);
    await goto(page, "/dashboard/clients/import");
    await page.locator("[data-import-page]").waitFor({ timeout: 90_000 });
    await pressUntil(page, "[data-import-source=OTHER]", "[data-import-steps]");
    const rows = Array.from({ length: 3000 }, (_, i) => `Walk Big ${i + 1},walkbig${i + 1}@import.test,555-7${String(i).padStart(2, "0").slice(-2)}-${String(1000 + i)},${i + 1} Long Meadow Road,Springfield,IL,62704,Imported from the old book in one long note so the line is a real customer line`);
    const big = `Name,Email,Phone,Street,City,State,Zip,Notes\n${rows.join("\n")}\n`;
    check("big: the test file is over 100 KB, so the page packs it", big.length > 100_000, big.length);
    await page.locator("[data-import-input]").setInputFiles([{ name: "all-customers.csv", mimeType: "text/csv", buffer: Buffer.from(big) }]);
    await page.locator("[data-import-summary], [data-import-error]").first().waitFor({ timeout: 120_000 });
    const sum = await page.locator("[data-import-summary]").innerText().catch(() => "");
    check("big: 3,000 clients read from the packed file", /3,000 new clients/.test(sum), sum.slice(0, 200) || (await page.locator("[data-import-error]").innerText().catch(() => "")));
    check("big: the file keeps its own name (not .gz)", (await page.locator("[data-import-file]").first().innerText()).includes("all-customers.csv"));

    // More rows than one import reads: the first are read, and the file's card says so (never cut silently).
    await page.locator(".imp-files button").first().click().catch(() => {});
    const many = `Name,Phone\n${Array.from({ length: 25_010 }, (_, i) => `Walk Many ${i},555-3${String(i).padStart(5, "0").slice(0, 2)}-${String(i).padStart(5, "0").slice(-4)}`).join("\n")}\n`;
    await page.locator("[data-import-input]").setInputFiles([{ name: "long.csv", mimeType: "text/csv", buffer: Buffer.from(many) }]);
    const cut = page.locator("[data-import-cut]");
    const told = await cut.waitFor({ timeout: 180_000 }).then(() => true, () => false);
    check("too many rows: the card says only the first 25,000 are read", told && /only the first 25,000 are read/.test(await cut.innerText()), told ? await cut.innerText() : await page.locator("[data-import-error]").innerText().catch(() => "no card, no error"));

    // Random bytes do not pack: six and a half MB of them is more than one call carries.
    const noise = `Name,Notes\n${Array.from({ length: 52_000 }, (_, i) => `N${i},${randomBytes(90).toString("base64")}`).join("\n")}\n`;
    await page.locator(".imp-files button").first().click().catch(() => {});
    await page.locator("[data-import-input]").setInputFiles([{ name: "huge.csv", mimeType: "text/csv", buffer: Buffer.from(noise) }]);
    const err = page.locator("[data-import-error]");
    await err.waitFor({ timeout: 120_000 });
    const errText = await err.innerText();
    check("too big: told in words what to do, nothing sent", /too big to bring in/.test(errText), errText);
    await ctx.close();
  }

  // ── the phone ──
  {
    const { ctx, page } = await open(browser, { phone: true });
    await goto(page, "/dashboard/clients");
    const imp = page.locator("[data-clients-import]");
    const shown = await imp.first().waitFor({ timeout: 90_000 }).then(() => true, () => false);
    check("phone: the Clients page has an Import button for the owner", shown && /import/i.test(await imp.first().innerText()));
    if (shown) {
      await imp.first().click();
      await page.waitForURL(/\/dashboard\/clients\/import/, { timeout: 60_000 }).catch(() => {});
      check("phone: it opens the import page", /\/dashboard\/clients\/import/.test(page.url()), page.url());
    }
    await goto(page, "/dashboard/clients/import");
    await page.locator("[data-import-page]").waitFor({ timeout: 90_000 });
    await dropFiles(page);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("phone: the page never scrolls sideways", wide <= 1, wide);
    const tiles = await page.locator("[data-import-source]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    check("phone: the programs sit two to a row", tiles.length === 8 && tiles[0] > 120 && tiles[0] < 200, tiles);
    await shot(page, "import-phone");
    await ctx.close();
  }

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await browser.close();
  console.log(`\n${good} ok, ${bad} failed`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
