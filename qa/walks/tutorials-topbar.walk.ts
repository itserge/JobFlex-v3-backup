// WALK — Tutorials in the top bar (owner, 2026-11-11: "move tutorial button … on the tab when I marked with the
// pencil … different color, to attract, to watch").
//
// The desk: an orange "Watch tutorials" button between the search and New Estimate; the sidebar's Learn row gone; a dot
// on the button until this browser has played a tutorial; pressed in on the Tutorials page. Narrower bars: "Tutorials",
// then the glyph alone. The phone's own nav keeps Tutorials in its drawer; the ⌘K palette still finds it.
//
// Wants on the stand: QA_BASE_URL, QA_PASS_OWNER. QA_WALK_SHOTS = a folder for the pictures.
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
const shot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...(clip ? { clip } : {}) });
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

async function open(browser: Browser, opts: { width?: number; phone?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: authFile("owner"), ...(opts.phone ? PHONE : { viewport: { width: opts.width ?? 1440, height: 900 } }) });
  return { ctx, page: watch(await ctx.newPage()) };
}

/** The first-estimate tour offers itself to a fresh company; a person presses Not now. */
async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, NAV);
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 2500 }).catch(() => {});
}

const CTA = "header.topbar [data-tut-cta]";

async function main() {
  const browser = await chromium.launch();
  const r = await signInRole(browser, "owner");
  if (!r.ok) throw new Error(`sign in: ${r.note}`);

  // ── the desk, 1440 wide, a browser that has never played a tutorial ──
  {
    const { ctx, page } = await open(browser);
    await goto(page, "/dashboard");
    const cta = page.locator(CTA);
    await cta.waitFor({ timeout: 90_000 });
    check("desk: the top bar has the tutorials button", (await cta.count()) === 1);
    check("desk: it says Watch tutorials", (await cta.innerText()).trim().toLowerCase() === "watch tutorials", await cta.innerText());
    check("desk: it is named for a screen reader", (await cta.getAttribute("aria-label")) === "Watch tutorials");
    const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    check("desk: it is orange", bg === "rgb(242, 107, 29)", bg);
    const box = await cta.boundingBox();
    const search = await page.locator("header.topbar .search").boundingBox();
    const right = await page.locator("header.topbar .topbar-right").boundingBox();
    const mid = box && search && right ? box.x + box.width / 2 : 0;
    const gapMid = search && right ? (search.x + search.width + right.x) / 2 : 0;
    check("desk: it sits between the search and New Estimate", !!(box && search && right && box.x > search.x + search.width && box.x + box.width < right.x), { box, search, right });
    check("desk: roughly in the middle of that room", Math.abs(mid - gapMid) < 40, { mid, gapMid });
    check("desk: the sidebar has no Tutorials row", (await page.locator(".sb a[href='/dashboard/tutorials']").count()) === 0);
    check("desk: the sidebar has no Learn heading", (await page.locator(".sb").getByText(/^Learn$/).count()) === 0);
    // The dot comes after hydration (the server draws none, so it never flashes on someone who has watched).
    const dot = page.locator(`${CTA} [data-tut-new]`);
    check("desk: a dot until a tutorial is played", await dot.waitFor({ timeout: 30_000 }).then(() => true, () => false));
    await page.waitForTimeout(600);
    await shot(page, "1-desk-bar", { x: 0, y: 0, width: 1440, height: 160 });
    await shot(page, "1b-desk-full");
    await cta.hover();
    await page.waitForTimeout(250);
    const hoverBg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    check("desk: darker orange on hover", hoverBg === "rgb(219, 90, 16)", hoverBg);
    await shot(page, "2-desk-hover", { x: 0, y: 0, width: 1440, height: 100 });

    // Clicking opens the Tutorials page; the button shows pressed in and its dot goes.
    await cta.click();
    await page.waitForURL(/\/dashboard\/tutorials/, { timeout: 90_000 });
    await page.locator(CTA).waitFor();
    check("click: the Tutorials page opens", new URL(page.url()).pathname === "/dashboard/tutorials");
    check("click: the button is marked as the page you're on", (await page.locator(CTA).getAttribute("aria-current")) === "page");
    check("click: no dot on the Tutorials page", (await page.locator(`${CTA} [data-tut-new]`).count()) === 0);
    await page.waitForTimeout(800);
    check("click: no sidebar row lit", (await page.locator(".sb .sb-link.active").count()) === 0);
    const plate = await page.locator("#sbIndicator").evaluate((el) => getComputedStyle(el).visibility);
    check("click: the sidebar's highlight is not left on Overview", plate === "hidden", plate);
    await shot(page, "3-desk-on-tutorials", { x: 0, y: 0, width: 1440, height: 420 });

    // Back to a row: it lights, and the highlight comes back on it.
    await page.locator(".sb a[href='/dashboard/leads']").click();
    await page.waitForURL(/\/dashboard\/leads/, { timeout: 90_000 });
    await page.waitForTimeout(900);
    const back = await page.locator("#sbIndicator").evaluate((el) => ({ v: getComputedStyle(el).visibility, h: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top }));
    const leadsRow = await page.locator(".sb a[href='/dashboard/leads']").boundingBox();
    check("back: the highlight shows on Leads", back.v === "visible" && back.h > 20 && !!leadsRow && Math.abs(back.top - leadsRow.y) < 6, { back, leadsRow });

    // Once a film has been played (the page's own mark), the dot stays away everywhere.
    await page.evaluate(() => {
      window.localStorage.setItem("jf_tutorials", JSON.stringify({ "deck-studio": { t: 12 } }));
      window.dispatchEvent(new Event("jf-tutorials-changed"));
    });
    await goto(page, "/dashboard/leads");
    await page.locator(CTA).waitFor({ timeout: 90_000 });
    await page.waitForTimeout(500);
    check("watched: no dot after a tutorial was played", (await page.locator(`${CTA} [data-tut-new]`).count()) === 0);
    check("watched: the button stays", (await page.locator(CTA).count()) === 1);

    // ⌘K still finds Tutorials.
    await page.locator("header.topbar .search").click();
    const input = page.locator(".cmdk input").first();
    await input.waitFor({ timeout: 10_000 });
    await input.fill("tutor");
    await page.waitForTimeout(300);
    check("palette: search still finds Tutorials", (await page.locator(".cmdk [role=option]", { hasText: /Tutorials/ }).count()) > 0);
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  // ── narrower desks ──
  for (const width of [960, 820]) {
    const { ctx, page } = await open(browser, { width });
    await goto(page, "/dashboard");
    const cta = page.locator(CTA);
    await cta.waitFor({ timeout: 90_000 });
    check(`${width}: it says Tutorials`, (await cta.innerText()).trim().toLowerCase() === "tutorials", await cta.innerText());
    const sb = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(`${width}: no sideways scroll`, sb);
    const box = await cta.boundingBox();
    const est = await page.locator("header.topbar .topbar-right .btn-primary").boundingBox();
    check(`${width}: same height as New Estimate`, !!(box && est && Math.abs(box.height - est.height) <= 1), { box, est });
    await shot(page, `4-desk-${width}`, { x: 0, y: 0, width, height: 90 });
    if (width === 820) {
      await page.locator("#navBurger").click();
      await page.waitForTimeout(400);
      check("820: the slide-out sidebar has no Tutorials row", (await page.locator(".sb a[href='/dashboard/tutorials']").count()) === 0);
    }
    await ctx.close();
  }

  // ── the phone's own nav (at or under 768px every page draws the phone shell, not the desk bar): Tutorials stays in its drawer ──
  {
    const { ctx, page } = await open(browser, { phone: true });
    await goto(page, "/dashboard");
    await page.getByRole("button", { name: "Open navigation" }).first().click({ timeout: 90_000 });
    await page.waitForTimeout(500);
    const row = page.locator("[aria-label='Main navigation'] a[href='/dashboard/tutorials']");
    check("phone: the drawer still lists Tutorials", (await row.count()) > 0);
    await shot(page, "6-phone-drawer");
    await ctx.close();
  }

  await browser.close();
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  console.log(`\n${good}/${good + bad} passed`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
