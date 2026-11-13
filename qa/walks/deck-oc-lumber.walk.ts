// WALK — OC composite framing in Deck Studio (owner, 2026-11-12: "add that OC into the framing build, like it's a wood,
// or it's a OC composite framing, so make it smart").
//
// The Frame step: a Wood / OC composite switch above the lumber. OC picks Owens Corning OC Lumber: the species list
// gives way to a note with the maker's three documents, the posts read "3-ply 2x6 OC", the frame strip says Owens
// Corning's tables pick it, the checks cite them, the material list buys OC boards in 12/16/20 ft with stainless
// screws, the price goes up, and Wood brings the treated frame back. The Owens Corning boards are on the board list.
// Desk 1440 and phone 390.
//
// Wants on the stand: QA_BASE_URL, QA_PASS_OWNER (qa@acme.test a platform admin — the studio's full edition).
// QA_WALK_SHOTS = a folder for the pictures.
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
const NAV = { waitUntil: "domcontentloaded" as const, timeout: 180_000 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SHOTS = process.env.QA_WALK_SHOTS || "";
const shot = async (page: Page, name: string, full = false) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
};

const consoleErrors: string[] = [];
const NOISE = /Download the React DevTools|\[HMR\]|\[Fast Refresh\]|favicon|webpack-hmr|_next\/static\/.*\.map|Failed to load resource|WebGL|THREE\./i;
function watch(page: Page): Page {
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${new URL(page.url()).pathname}: ${e.message.slice(0, 200)}`));
  return page;
}

async function open(browser: Browser, phone = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: authFile("owner"), ...(phone ? PHONE : { viewport: { width: 1440, height: 900 } }) });
  return { ctx, page: watch(await ctx.newPage()) };
}

async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, NAV);
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 2500 }).catch(() => {});
}

/** The Framing switch's two buttons. */
const framingSeg = (page: Page) => page.getByRole("radiogroup", { name: "Framing" }).or(page.locator("[aria-label='Framing']")).first();

async function toFrame(page: Page) {
  // The studio may open on its kind picker: a plain deck.
  await page.getByRole("button", { name: /^Deck\b/ }).first().click({ timeout: 4000 }).catch(() => {});
  const seg = framingSeg(page);
  for (let i = 0; i < 12 && !(await seg.isVisible().catch(() => false)); i++) {
    // Step forward until the Frame step's switch shows.
    const next = page.getByRole("button", { name: /^(Next|Continue)\b/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click();
    else await page.getByRole("button", { name: /Boards|Frame|Surface/ }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await seg.scrollIntoViewIfNeeded();
}

async function walk(page: Page, tag: string) {
  await goto(page, "/dashboard/deck-estimator");
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  // A fresh company's first-estimate tour comes up after the page settles: Not now.
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 10_000 }).catch(() => {});
  await page.locator("[data-tour-root] [aria-hidden='true']").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await toFrame(page);
  const seg = framingSeg(page);
  check(`${tag}: the Frame step has a Framing switch`, await seg.isVisible());
  await shot(page, `${tag}-1-wood`);
  check(`${tag}: it starts on Wood, with the lumber list`, (await page.locator("[data-deck-pick='species']").count()) === 1 && (await page.locator("[data-deck-oc-frame]").count()) === 0);
  const priceBefore = await page.locator("body").innerText();
  await seg.getByText("OC composite", { exact: true }).click();
  await page.locator("[data-deck-oc-frame]").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await shot(page, `${tag}-2-oc`);
  const note = await page.locator("[data-deck-oc-frame]").innerText();
  check(`${tag}: OC shows Owens Corning's note instead of the lumber list`, /Owens Corning OC Lumber/.test(note) && (await page.locator("[data-deck-pick='species']").count()) === 0, note.slice(0, 120));
  check(`${tag}: the note links the span tables, the listing and the install guide`, (await page.locator("[data-deck-oc-frame] a").count()) === 3);
  const body = await page.locator("body").innerText();
  check(`${tag}: the frame strip says Owens Corning's tables pick it`, /Owens Corning.s tables pick it/i.test(body));
  check(`${tag}: the posts read 3-ply 2x6 OC`, /3-ply 2x6 OC/.test(body));
  check(`${tag}: the page changed (the price and the frame follow)`, body !== priceBefore);
  // The material list and the checks, wherever the studio prints them.
  const mats = await page.locator("body").innerText();
  check(`${tag}: somewhere on the page OC Lumber is named in the materials or the checks`, /OC Lumber/.test(mats));
  // Back to wood.
  await seg.getByText("Wood", { exact: true }).click();
  await page.locator("[data-deck-pick='species']").waitFor({ timeout: 20_000 });
  check(`${tag}: Wood brings the lumber list back`, (await page.locator("[data-deck-oc-frame]").count()) === 0);
  const sel = await page.locator("[data-deck-pick='species']").inputValue();
  check(`${tag}: …on the region's treated lumber, never OC`, sel !== "oc-lumber" && sel.length > 0, sel);
  const noOc = (await page.locator("[data-deck-pick='species'] option").allInnerTexts()).every((t) => !/OC Lumber/.test(t));
  check(`${tag}: the wood list does not offer OC Lumber`, noOc);
  const boards = await page.locator("select option").allInnerTexts();
  check(`${tag}: the board list has the Owens Corning Marine Grade boards`, boards.filter((t) => /Owens Corning Marine Grade/.test(t)).length >= 2);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${tag}: nothing pushes the page sideways`, wide <= 1, wide);
}

async function main() {
  const browser = await chromium.launch();
  const r = await signInRole(browser, "owner");
  if (!r.ok) throw new Error(`sign in: ${r.note}`);
  {
    const { ctx, page } = await open(browser);
    await walk(page, "desk");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, true);
    await walk(page, "phone");
    await ctx.close();
  }
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await browser.close();
  console.log(`\n${good}/${good + bad} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
