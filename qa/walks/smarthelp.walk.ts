// SMARTHELP · THE END-TO-END WALK (2026-10-30, plan Task 10). A real browser on a LOCAL stand — its own SQLite
// database, OPENAI_BASE_URL on the fake model (qa/fixtures/smarthelp-fake-openai.ts), never production env files —
// signed in only as the QA Lab's accounts in QA Co (CLAUDE.md "Test accounts"): the owner qa@acme.test, the INSTALLER
// qa-worker@ and the platform admin qa-admin@ (npm run qa:seed-roles). Desk 1440×900, then a phone 390×844.
// Each line printed is one check, in the plan's order; the exit code is the number of failures (0 = all passed).
//
//   source <stand env> && NODE_PATH="" npx --no-install tsx --tsconfig qa/tsconfig.json qa/walks/smarthelp.walk.ts
//
// Wants on the stand: QA_BASE_URL, DATABASE_URL (file:, checked by qa/lib/db), QA_PASS_OWNER / _WORKER / _ADMIN.
// It writes to the stand only: SmartHelp questions and ratings, one support ticket, the rate-limit rows of QA Co.
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { prisma } from "../lib/db";
import { baseUrl } from "../lib/env";
import { authFile, signInRole, type RoleName } from "../lib/roles";

let bad = 0;
const check = (name: string, ok: boolean, extra: unknown = "") => {
  if (!ok) bad++;
  const more = extra === "" || extra === undefined ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : more}`);
};

const BASE = baseUrl();
const NAV = { waitUntil: "domcontentloaded" as const, timeout: 120_000 };
const DESK = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

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

async function signedIn(browser: Browser, role: RoleName, phone = false): Promise<{ ctx: BrowserContext; page: Page } | null> {
  const r = await signInRole(browser, role);
  if (!r.ok) {
    check(`sign in as ${role}`, false, r.note);
    return null;
  }
  const ctx = await browser.newContext({ storageState: authFile(role), ...(phone ? PHONE : { viewport: DESK }) });
  // A fresh tab: SmartHelp's memory is per tab (sessionStorage), so each context starts closed and empty.
  return { ctx, page: watch(await ctx.newPage()) };
}

// ── The panel's parts ────────────────────────────────────────────────────────

const panelOf = (page: Page) => page.locator('aside[aria-labelledby]').filter({ has: page.getByRole("heading", { name: "SmartHelp" }) });
const barOf = (page: Page) => page.getByRole("button", { name: /Back to SmartHelp/ });
/** The SmartHelp row that is on screen (each shell draws one; hidden drawers keep theirs). */
const visibleRow = (page: Page) => page.locator('[data-tour="smarthelp"]:visible').first();
const lastKey = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("aside[aria-labelledby] article[data-entry]")].pop()?.getAttribute("data-entry") ?? null);
/** Does `act`, then the answer it adds, pinned by its own key: "the last one" moves as answers are added, and the
 *  oldest go after 20. */
async function newEntry(page: Page, act: () => Promise<void>): Promise<Locator> {
  const before = await lastKey(page);
  await act();
  await page
    .waitForFunction(
      (prev) => {
        const last = [...document.querySelectorAll("aside[aria-labelledby] article[data-entry]")].pop();
        return !!last && last.getAttribute("data-entry") !== prev;
      },
      before,
      { timeout: 30_000 },
    )
    .catch(async (e) => {
      // QA_WALK_SHOTS: a folder for a picture of the screen when an answer never came.
      if (process.env.QA_WALK_SHOTS) await page.screenshot({ path: `${process.env.QA_WALK_SHOTS}/no-answer-${Date.now()}.png` });
      throw e;
    });
  return panelOf(page).locator(`article[data-entry="${await lastKey(page)}"]`);
}

/** Goes to `path`; the first-estimate tour offers itself to a new company — a person would press Not now (or Skip tour
 *  once it runs), so does the walk; once put off on a page it doesn't come back there. */
const skipped = new WeakSet<Page>();
async function goto(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, NAV);
  if (skipped.has(page)) return;
  const skip = page.locator("[data-tour-root]").getByRole("button", { name: /^(Not now|Skip tour)$/ });
  if (await skip.waitFor({ timeout: 6_000 }).then(() => true, () => false)) {
    await skip.click();
    await page.locator("[data-tour-root]").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    skipped.add(page);
  }
}

async function closePanel(page: Page) {
  const close = panelOf(page).getByRole("button", { name: "Close SmartHelp" });
  if (await close.isVisible().catch(() => false)) await close.click();
  await panelOf(page).waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

/** Types a question and waits for its answer (or its error line) to land. */
async function ask(page: Page, question: string): Promise<Locator> {
  const box = panelOf(page).getByLabel("Ask SmartHelp a question");
  await box.fill(question);
  const entry = await newEntry(page, () => box.press("Enter"));
  await entry.getByText("Looking it up…").waitFor({ state: "hidden", timeout: 45_000 });
  return entry;
}

async function openGuide(page: Page, title: string): Promise<Locator> {
  const panel = panelOf(page);
  const back = panel.getByRole("button", { name: "All guides" });
  if (await back.isVisible().catch(() => false)) await back.click();
  const entry = await newEntry(page, () => panel.getByRole("button", { name: title, exact: false }).first().click());
  await entry.locator("ol li").first().waitFor({ timeout: 30_000 });
  return entry;
}

/** Which shell drew the row: the blueprint sidebar's scroll, the classic <aside>, or something else. */
async function rowShell(page: Page): Promise<string> {
  return visibleRow(page).evaluate((el) => (el.closest(".sb-scroll") ? "blueprint" : el.closest("aside") ? "classic" : "other"));
}

// ── The desk ─────────────────────────────────────────────────────────────────

async function desk(browser: Browser) {
  const s = await signedIn(browser, "owner");
  if (!s) return;
  const { page } = s;

  // 1. The row opens SmartHelp from both desk sidebars.
  const found: Record<string, string> = {};
  // The blueprint shell draws most pages; the classic one is the (dashboard) layout's (invoices, CRM customers …).
  for (const path of ["/dashboard", "/dashboard/financials/invoices", "/dashboard/crm/customers", "/dashboard/leads/kanban"]) {
    if (found.classic && found.blueprint) break;
    await goto(page, path);
    if (!(await visibleRow(page).waitFor({ timeout: 60_000 }).then(() => true, () => false))) continue;
    const shell = await rowShell(page);
    if (found[shell]) continue;
    found[shell] = path;
    await visibleRow(page).click();
    const open = await panelOf(page).waitFor({ timeout: 20_000 }).then(() => true, () => false);
    check(`the row opens SmartHelp from the ${shell} sidebar (${path})`, open);
    if (open && shell === "blueprint") {
      const pad = await page.evaluate(() => getComputedStyle(document.body).paddingRight);
      check("desk: the page moves over for the panel (body padded 380px), nothing covered", pad === "380px", pad);
    }
    await closePanel(page);
  }
  check("both desk sidebars were found (classic and blueprint)", !!found.classic && !!found.blueprint, found);

  // 2. The guides: to-do first with its dot; the AI desk's numbered steps.
  await goto(page, found.blueprint ?? "/dashboard");
  await visibleRow(page).click();
  const panel = panelOf(page);
  const firstSetup = panel.locator('section[aria-label="Set it up"] li').first();
  await firstSetup.waitFor({ timeout: 30_000 });
  check("a to-do guide is first, with its dot", (await firstSetup.innerText()).includes("Not set up yet"), await firstSetup.innerText());
  const desk = await openGuide(page, "Set up the AI desk");
  const stepCount = await desk.locator("ol li").count();
  check('"Set up the AI desk" shows numbered steps', stepCount >= 4 && (await desk.locator("ol li").first().innerText()).startsWith("1"), stepCount);

  // 3. Open goes to the page and the panel stays (desk).
  await desk.locator("ol li").first().getByRole("button", { name: "Open" }).click();
  const went = await page.waitForURL(/\/dashboard\/phone/, { timeout: 60_000 }).then(() => true, () => false);
  check("Open goes to the step's page", went, page.url());
  check("…and the desk panel stays open", await panel.isVisible());

  // 4. Show me lights the target; a click on it puts the light out.
  const showStep = desk.locator("ol li").filter({ has: page.getByRole("button", { name: "Show me" }) }).first();
  await showStep.getByRole("button", { name: "Show me" }).click();
  const light = page.locator("[data-smarthelp-spotlight]");
  const lit = await light.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const target = lit ? await light.getAttribute("data-smarthelp-spotlight") : null;
  check("Show me lights the target", lit, lit ? "" : await panel.locator('[role="status"]').innerText().catch(() => "no light, no miss line"));
  if (lit && target) {
    await page.locator(`[data-tour="${target}"]:visible`).first().click();
    check("a click on the lit element puts the light out", await light.waitFor({ state: "hidden", timeout: 5_000 }).then(() => true, () => false));
  }

  // 5. A typed question renders steps; the invented page has no Open, the made-up target no Show me.
  const typed = await ask(page, "how do I set up the desk so it answers calls");
  const typedSteps = await typed.locator("ol li").count();
  const typedOpens = await typed.getByRole("button", { name: "Open" }).count();
  const typedShows = await typed.getByRole("button", { name: "Show me" }).count();
  check("a typed question renders numbered steps", typedSteps === 2, typedSteps);
  check("the invented page (/dashboard/ai-desk) has no Open; its step's words stay", typedOpens === 1 && (await typed.innerText()).includes("Save the instructions"), { typedOpens });
  check("the made-up Show me target is dropped", typedShows <= 1, typedShows);

  // 6. 👍 / 👎.
  await typed.getByRole("button", { name: "Yes, this helped" }).click();
  check("👍 is taken", await typed.getByText("Thanks — glad it helped.").waitFor({ timeout: 10_000 }).then(() => true, () => false));
  await desk.getByRole("button", { name: "No, this didn't help" }).click();
  check("👎 on a guide puts Ask a person under it", await desk.getByRole("button", { name: "Ask a person" }).waitFor({ timeout: 10_000 }).then(() => true, () => false));

  // 7. Spanish in, Spanish out.
  const es = await ask(page, "¿Cómo configuro el escritorio de IA?");
  check("Spanish in → Spanish out", (await es.innerText()).includes("Así se configura"), (await es.innerText()).slice(0, 120));

  // 8. A broken model or a timeout is one plain line; the guides still work.
  for (const word of ["garbage", "timeout"]) {
    const e = await ask(page, `${word} — how do invoices work?`);
    check(`"${word}" from the model → the error line`, (await e.innerText()).includes("couldn't answer just now"), (await e.innerText()).slice(0, 160));
  }
  const after = await openGuide(page, "How the roof estimator works");
  check("…and the guides still work after it", (await after.locator("ol li").count()) >= 2);

  // 9. A person topic: no steps, Ask a person first; it opens Help pre-filled; the ticket's AI answer is held.
  const cancel = await ask(page, "how do I cancel");
  const cancelText = await cancel.innerText();
  const personBtn = cancel.getByRole("button", { name: "Ask a person" });
  check('"how do I cancel" → a person reply, no steps', cancelText.includes("a person on our team") && (await cancel.locator("ol").count()) === 0, cancelText.slice(0, 160));
  check("…with Ask a person first", (await personBtn.count()) === 1 && cancelText.indexOf("Ask a person") < cancelText.indexOf("Cancelling"), cancelText.slice(0, 80));
  await personBtn.click();
  const composer = page.locator(".jfsup-pop[role='dialog']");
  const composerUp = await composer.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const filled = composerUp ? await composer.locator("textarea").first().inputValue() : "";
  check("Ask a person opens the Help composer pre-filled with the question", composerUp && filled.includes("how do I cancel"), filled.slice(0, 120));
  if (composerUp) {
    const startedAt = new Date();
    await composer.locator(".jfsup-send").click();
    const db = prisma();
    let ticket: { id: string } | null = null;
    let origin: string | null = null;
    let outcome: string | null = null;
    for (let i = 0; i < 40 && !outcome; i++) {
      await page.waitForTimeout(1000);
      ticket ??= await db.supportTicket.findFirst({ where: { createdAt: { gte: startedAt }, user: { email: "qa@acme.test" } }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (!ticket) continue;
      origin ??= (await db.syncState.findUnique({ where: { key: `supportOrigin:${ticket.id}` } }))?.cursor ?? null;
      const rec = (await db.syncState.findUnique({ where: { key: `supportAi:${ticket.id}` } }))?.cursor;
      outcome = rec ? (JSON.parse(rec) as { outcome?: string }).outcome ?? null : null;
    }
    check("the ticket is filed and marked as SmartHelp's hand-off", !!ticket && !!origin && origin.includes("smarthelp"), { ticket: ticket?.id, origin });
    check("the support AI only drafts it — held for a person, not sent", outcome === "drafted" || outcome === "held", outcome);
    await page.keyboard.press("Escape");
    // The composer holds focus until its exit has played; a question typed before that goes nowhere.
    await composer.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  // 10. The limit: the 21st question that would reach the model in an hour is refused, saying when it reopens.
  let modelAsks = 4; // the typed question, the Spanish one, garbage, timeout (a person topic never reaches the model)
  let refused = "";
  for (let i = 0; i < 20 && !refused; i++) {
    const e = await ask(page, `how do proposals work, take ${i + 1}?`);
    const text = await e.innerText();
    modelAsks++;
    if (text.includes("20 questions an hour")) refused = text;
  }
  check("the 21st question in an hour is refused", modelAsks === 21 && !!refused, { modelAsks });
  check("…saying when it reopens", /ask again in/.test(refused), refused.slice(0, 160));
  await s.ctx.close();
}

// ── An INSTALLER: a page the role can't open is "Ask your account owner" ──────

async function installer(browser: Browser) {
  const s = await signedIn(browser, "worker");
  if (!s) return;
  const { page } = s;
  await goto(page, "/dashboard");
  const row = await visibleRow(page).waitFor({ timeout: 60_000 }).then(() => true, () => false);
  check("an INSTALLER has the SmartHelp row too", row, page.url());
  if (row) {
    await visibleRow(page).click();
    await panelOf(page).waitFor({ timeout: 20_000 });
    const g = await openGuide(page, "Set up the AI desk").catch(() => null);
    const text = g ? await g.innerText() : "";
    check('an INSTALLER sees "Ask your account owner", no Open', text.includes("Ask your account owner to open") && (await g!.getByRole("button", { name: "Open" }).count()) === 0, text.slice(0, 200));
  }
  await s.ctx.close();
}

// ── The owner's view: /admin/support → SmartHelp ─────────────────────────────

async function admin(browser: Browser) {
  const s = await signedIn(browser, "admin");
  if (!s) return;
  const { page } = s;
  await page.goto(`${BASE}/admin/support?view=smarthelp`, NAV);
  const view = page.locator("[data-smarthelp-admin]");
  const up = await view.waitFor({ timeout: 90_000 }).then(() => true, () => false);
  check("the admin SmartHelp view opens", up, page.url());
  if (up) {
    // The table's words, not what is painted: the cards fade in one after another (useReveal), and a long "Not
    // answered" list puts this one below the fold.
    await view.locator("[data-smarthelp-newest] tbody tr").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
    const newest = (await view.locator("[data-smarthelp-newest]").textContent()) ?? "";
    check("…it lists the questions, with 👍 and sent to a person", newest.includes("how do I cancel") && newest.includes("👍 Helped") && newest.includes("Sent to a person"), newest.slice(0, 200));
    const guides = await view.locator("[data-smarthelp-guides] tbody tr").filter({ hasText: "Set up the AI desk" }).innerText();
    const [opens, , down] = guides.split(/\t|\n/).slice(1).map((n) => Number(n.trim()));
    check("…and the guide counts (opens, 👎)", opens >= 1 && down >= 1, guides.replace(/\s+/g, " "));
    check('…with "Tickets | SmartHelp" tabs', (await page.locator("[data-support-views] [role='tab']").count()) === 2);
  }
  await s.ctx.close();
}

// ── The phone: the drawer, the mobile-v2 drawer, More; the sheet steps aside to the bar ──

async function phone(browser: Browser) {
  const s = await signedIn(browser, "owner", true);
  if (!s) return;
  const { page } = s;
  const sheet = panelOf(page);
  const seen = new Set<string>();
  for (const path of ["/dashboard", "/dashboard/clients", "/dashboard/financials/invoices", "/dashboard/crm/customers"]) {
    await goto(page, path);
    await page.waitForTimeout(1500);
    const menu = page.getByRole("button", { name: "Open navigation" }).first();
    const more = page.getByRole("button", { name: /^More$/ }).first();
    let how = "";
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
      how = path === "/dashboard" ? "the mobile-v2 drawer" : "the phone drawer";
    } else if (await more.isVisible().catch(() => false)) {
      await more.click();
      how = "More";
    } else continue;
    if (seen.has(how)) continue;
    seen.add(how);
    const row = visibleRow(page);
    if (!(await row.waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
      check(`the row is in ${how} (${path})`, false);
      continue;
    }
    await row.click();
    check(`the row opens SmartHelp from ${how} (${path})`, await sheet.waitFor({ timeout: 15_000 }).then(() => true, () => false));
    await closePanel(page);
  }
  check("all three phone launchers were found", seen.size === 3, [...seen]);

  // The sheet closes on Open and comes back from the bar.
  await goto(page, "/dashboard/clients");
  await page.getByRole("button", { name: "Open navigation" }).first().click().catch(() => {});
  await visibleRow(page).click();
  await sheet.waitFor({ timeout: 15_000 });
  const g = await openGuide(page, "Set up the AI desk");
  await g.locator("ol li").first().getByRole("button", { name: "Open" }).click();
  const closed = await sheet.waitFor({ state: "hidden", timeout: 10_000 }).then(() => true, () => false);
  const bar = await barOf(page).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("phone: the sheet steps aside on Open, to the Back to SmartHelp bar", closed && bar);
  await page.waitForURL(/\/dashboard\/phone/, { timeout: 60_000 }).catch(() => {});
  if (bar) {
    await barOf(page).click();
    check("…and comes back from the bar", await sheet.waitFor({ timeout: 10_000 }).then(() => true, () => false));
  }
  await s.ctx.close();
}

/** The stand's SmartHelp limits start from zero, so the 21st question is this run's 21st (an earlier run's questions
 *  still count in the hour). The server's own 60-an-hour brake lives in its memory: start the stand fresh for a rerun. */
async function freshLimits() {
  const { count } = await prisma().syncState.deleteMany({ where: { key: { startsWith: "rl:smarthelp:" } } });
  if (count) console.log(`(cleared ${count} SmartHelp limit rows left by an earlier run)`);
}

async function main() {
  console.log(`SmartHelp walk on ${BASE}`);
  await freshLimits();
  const browser = await chromium.launch();
  try {
    await desk(browser);
    await installer(browser);
    await admin(browser);
    await phone(browser);
  } finally {
    await browser.close();
  }
  check("no console errors on any page", consoleErrors.length === 0, consoleErrors.slice(0, 8));
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error("walk crashed:", e);
  process.exit(2);
});
