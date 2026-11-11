// EDIT A LEAD (2026-11-10), walked on a stand: a Facebook lead that came with a phone and nothing else gets its
// email and address on the lead page (desk and phone), the client record with the same phone gets its blanks filled
// (never overwritten), the AI Operator's update_lead adds an address by words, a withheld Lead Center lead has no
// Edit, and Import leads takes the address — a CSV's columns and the one "Job address" line typed by hand.
//   set -a; source <stand.env>; set +a
//   NODE_PATH="" npx --no-install tsx --tsconfig qa/tsconfig.json qa/walks/lead-edit.walk.ts
// Wants on the stand: QA_BASE_URL, DATABASE_URL (file:), QA_PASS_OWNER; the fake model (qa/fixtures/assistant-fake-
// openai.ts) on OPENAI_BASE_URL for the Operator part. QA_WALK_SHOTS = a folder for the pictures.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { disconnect, prisma as client } from "../lib/db";
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
const DESK = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SHOTS = process.env.QA_WALK_SHOTS || "";
const shot = async (page: Page, name: string, full = false) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
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

async function open(browser: Browser, phone = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: authFile("owner"), ...(phone ? PHONE : { viewport: DESK }) });
  return { ctx, page: watch(await ctx.newPage()) };
}

/** The first-estimate tour offers itself to a fresh company; a person presses Not now. */
async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, NAV);
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 2500 }).catch(() => {});
}

const TAG = `w${Date.now().toString(36)}`;
const prisma = client();

async function main() {
  const browser = await chromium.launch();
  const r = await signInRole(browser, "owner");
  if (!r.ok) throw new Error(`sign in: ${r.note}`);
  const me = await prisma.user.findFirst({ where: { email: "qa@acme.test" }, select: { id: true } });
  const mem = await prisma.membership.findFirst({ where: { userId: me!.id }, select: { organizationId: true } });
  const org = mem!.organizationId;

  // ── the records: a Facebook lead with a phone only, the client already on file with that phone, a second lead for
  //    the Operator, a Lead Center lead not accepted yet ──
  const phone = `+1425555${String(Date.now()).slice(-4)}`;
  const dana = await prisma.lead.create({ data: { organizationId: org, name: `Dana Reed ${TAG}`, phone, source: "FACEBOOK", status: "NEW", projectType: "Deck" } });
  const danaClient = await prisma.client.create({
    data: { organizationId: org, name: `Dana Reed ${TAG}`, phone: `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`, email: `dana.${TAG}@old-mail.test` },
  });
  const owen = await prisma.lead.create({ data: { organizationId: org, name: `Owen${TAG} Castle`, phone: "+15095550168", source: "FACEBOOK", status: "NEW" } });
  const locked = await prisma.lead.create({ data: { organizationId: org, name: `Lena Locked ${TAG}`, email: "lena@x.test", phone: "+12065550100", address: "9 Hidden Way", city: "Everett", state: "WA", source: "LEAD_CENTER", status: "ROUTED" } });

  // ── 1. the desk: the hint, the sheet, a wrong email refused, the save, the client's blanks ──
  {
    const { ctx, page } = await open(browser);
    await goto(page, `/dashboard/leads/${dana.id}`);
    const addr = page.locator("[data-lead-address]");
    await addr.waitFor({ timeout: 60_000 });
    check("no street yet: the hint points at Edit details", /no street address yet.*Add it with Edit details/.test((await addr.textContent()) ?? ""), await addr.textContent());
    const btn = page.locator("[data-lead-edit]");
    check("Edit details is on the contact card", await btn.isVisible());
    await shot(page, "1-desk-before");
    await btn.click();
    const form = page.locator("[data-lead-edit-form]");
    await form.waitFor({ timeout: 10_000 });
    check("the sheet opens with what's on file", (await form.locator('input[name="name"]').inputValue()) === dana.name && (await form.locator('input[name="phone"]').inputValue()) === phone && (await form.locator('input[name="address"]').inputValue()) === "");
    // a wrong email first
    await form.locator('input[name="email"]').fill("dana at example");
    await page.locator("[data-lead-edit-save]").click();
    const err = page.locator("[data-lead-edit-error]");
    await err.waitFor({ timeout: 15_000 }).catch(() => {});
    check("a wrong email is refused in words", /doesn't look like an email/.test((await err.textContent().catch(() => "")) ?? ""), await err.textContent().catch(() => null));
    // the name can't be emptied
    await form.locator('input[name="name"]').fill("");
    await page.locator("[data-lead-edit-save]").click();
    check("the name can't be emptied", /needs a name/.test((await err.textContent().catch(() => "")) ?? ""));
    await form.locator('input[name="name"]').fill(dana.name);
    // the real details; the whole address line pasted into the street splits on leaving the field
    await form.locator('input[name="email"]').fill(`dana.${TAG}@example.com`);
    await form.locator('input[name="address"]').fill("1420 Maple St, Bothell, WA 98011");
    await form.locator('input[name="projectType"]').click();
    await page.waitForTimeout(150);
    const parts = [await form.locator('input[name="address"]').inputValue(), await form.locator('input[name="city"]').inputValue(), await form.locator('input[name="state"]').inputValue(), await form.locator('input[name="zip"]').inputValue()];
    check("a pasted line lands in street / city / state / ZIP", JSON.stringify(parts) === JSON.stringify(["1420 Maple St", "Bothell", "WA", "98011"]), parts);
    await form.locator('input[name="projectType"]').fill("Covered deck 18x14");
    await shot(page, "2-desk-sheet");
    await page.locator("[data-lead-edit-save]").click();
    const note = page.locator("[data-lead-edit-note]");
    await page.waitForFunction(() => /Saved/.test(document.querySelector("[data-lead-edit-note]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
    const said = (await note.textContent()) ?? "";
    check("saved, and it says the client record got the address", /^Saved\. Also added to Dana Reed .*client record: address\.$/.test(said), said);
    await page.waitForFunction(() => /1420 Maple St/.test(document.querySelector("[data-lead-address]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
    const shown = (await addr.textContent()) ?? "";
    check("the card shows the address, no hint", /^1420 Maple St, Bothell, WA 98011$/.test(shown.trim()), shown);
    check("the email shows", ((await page.locator("[data-lead-contact]").textContent()) ?? "").includes(`dana.${TAG}@example.com`));
    await shot(page, "3-desk-after");

    const l = await prisma.lead.findUnique({ where: { id: dana.id } });
    check("the lead row: email, street, city, state, ZIP, project; phone untouched", l?.email === `dana.${TAG}@example.com` && l?.address === "1420 Maple St" && l?.city === "Bothell" && l?.state === "WA" && l?.zip === "98011" && l?.projectType === "Covered deck 18x14" && l?.phone === phone, l);
    const c = await prisma.client.findUnique({ where: { id: danaClient.id } });
    check("the client: the address filled in, its own email kept", c?.address === "1420 Maple St" && c?.city === "Bothell" && c?.state === "WA" && c?.zip === "98011" && c?.email === `dana.${TAG}@old-mail.test`, c);
    const ev = await prisma.activityEvent.findFirst({ where: { organizationId: org, leadId: dana.id, kind: "UPDATED" }, orderBy: { createdAt: "desc" } });
    check("the trail says what changed", !!ev && /added the email, street address, city, state and ZIP; changed the project/.test(ev.summary) && ev.clientId === danaClient.id, ev?.summary);

    // nothing changed → nothing written
    const before = await prisma.activityEvent.count({ where: { leadId: dana.id } });
    await page.locator("[data-lead-edit]").click();
    await page.locator("[data-lead-edit-save]").click();
    await page.waitForFunction(() => /Nothing changed/.test(document.querySelector("[data-lead-edit-note]")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
    check("saving with no change says so and writes nothing", /Nothing changed/.test((await note.textContent()) ?? "") && (await prisma.activityEvent.count({ where: { leadId: dana.id } })) === before);

    // clearing a field
    await page.locator("[data-lead-edit]").click();
    await page.locator('[data-lead-edit-form] input[name="projectType"]').fill("");
    await page.locator("[data-lead-edit-save]").click();
    await page.waitForFunction(() => /^Saved\.$/.test((document.querySelector("[data-lead-edit-note]")?.textContent ?? "").trim()), null, { timeout: 20_000 }).catch(() => {});
    const cleared = await prisma.lead.findUnique({ where: { id: dana.id }, select: { projectType: true, address: true } });
    check("an emptied field is cleared, the rest stays", cleared?.projectType === null && cleared?.address === "1420 Maple St", cleared);

    // the withheld Lead Center lead: no Edit
    await goto(page, `/dashboard/leads/${locked.id}`);
    await page.locator("[data-lead-contact]").waitFor({ timeout: 60_000 });
    check("a Lead Center lead not accepted yet has no Edit details", (await page.locator("[data-lead-edit]").count()) === 0);
    await ctx.close();
  }

  // ── 2. the phone: the row's Edit details, the sheet as a bottom sheet ──
  {
    const { ctx, page } = await open(browser, true);
    await goto(page, `/mobile-leads-v2`);
    const row = page.getByRole("button", { name: `Actions for ${owen.name}` });
    await row.waitFor({ timeout: 60_000 }).catch(() => {});
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      const item = page.getByRole("button", { name: /Edit details/ }).or(page.locator("button", { hasText: "Edit details" })).first();
      await item.waitFor({ timeout: 10_000 }).catch(() => {});
      const txt = (await item.textContent().catch(() => "")) ?? "";
      check("the phone's row menu has Edit details, and says there's no address yet", /Edit details/.test(txt) && /No address yet/.test(txt), txt);
      await shot(page, "4-phone-menu");
      await item.click().catch(() => {});
      await page.waitForURL((u) => u.pathname === `/dashboard/leads/${owen.id}`, { timeout: 60_000 }).catch(() => {});
      check("it opens the lead's page", new URL(page.url()).pathname === `/dashboard/leads/${owen.id}`, page.url());
    } else {
      check("the phone list shows the lead's row", false, "no Actions button");
      await goto(page, `/dashboard/leads/${owen.id}?edit=1`);
    }
    const form = page.locator("[data-lead-edit-form]");
    await form.waitFor({ timeout: 60_000 }).catch(() => {});
    check("the edit sheet is up on arrival", await form.isVisible().catch(() => false));
    check("the ?edit=1 flag is dropped from the address", !page.url().includes("edit=1"), page.url());
    await shot(page, "5-phone-sheet");
    await form.locator('input[name="email"]').fill(`owen.${TAG}@example.com`);
    await page.locator("[data-lead-edit-save]").click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector("[data-lead-edit-note]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
    check("saved from the phone", (await prisma.lead.findUnique({ where: { id: owen.id }, select: { email: true } }))?.email === `owen.${TAG}@example.com`);
    await shot(page, "6-phone-after", true);
    await ctx.close();
  }

  // ── 3. the AI Operator: "add the address … to Owen's lead" → read back → Do it ──
  {
    const { ctx, page } = await open(browser, true);
    await goto(page, `/mobile-assistant-v1`);
    // The phone's Operator opens on talk; a person taps Type to write instead.
    await page.getByRole("button", { name: /^type$/i }).first().click({ timeout: 60_000 }).catch(() => {});
    const box = page.getByLabel("Ask or tell the AI Operator");
    await box.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    const ask = `add the address 88 Ridge Ave N, Seattle WA 98109 to Owen${TAG}'s lead`;
    await box.fill(ask);
    await page.getByRole("button", { name: "Send" }).click();
    // The Operator keeps the conversation; only what follows this request counts.
    const since = async () => {
      const all = (await page.locator(".jf-operator").textContent()) ?? "";
      return all.slice(all.lastIndexOf(ask) + ask.length);
    };
    const doIt = page.getByRole("button", { name: "Do it" }).last();
    await page.waitForFunction((a) => { const t = document.querySelector(".jf-operator")?.textContent ?? ""; return t.slice(t.lastIndexOf(a)).includes("Do it"); }, ask, { timeout: 60_000 }).catch(() => {});
    const body1 = await since();
    check("the Operator reads it back before doing it, once", /Change Owen\S* Castle's lead: address 88 Ridge Ave N, Seattle, WA 98109\./.test(body1) && !/things to do/.test(body1), body1);
    await shot(page, "7-operator-readback");
    await doIt.click().catch(() => {});
    await page.waitForFunction((a) => { const t = document.querySelector(".jf-operator")?.textContent ?? ""; return /lead is updated/.test(t.slice(t.lastIndexOf(a))); }, ask, { timeout: 60_000 }).catch(() => {});
    const o = await prisma.lead.findUnique({ where: { id: owen.id } });
    check("update_lead wrote the four parts", o?.address === "88 Ridge Ave N" && o?.city === "Seattle" && o?.state === "WA" && o?.zip === "98109", o);
    check("…and said so", new RegExp(`Owen${TAG} Castle's lead is updated`).test(await since()), await since());
    await shot(page, "8-operator-done");
    await ctx.close();
  }

  // ── 4. Import leads: a CSV with address columns, and the one line typed by hand ──
  {
    const { ctx, page } = await open(browser);
    await goto(page, `/dashboard/leads`);
    await page.locator('[data-tab="import"], button:has-text("Import")').first().click({ timeout: 30_000 }).catch(() => {});
    await page.locator('#iMeth [data-m="manual"]').click({ timeout: 10_000 }).catch(() => {});
    await page.locator("#mName").fill(`Mia${TAG} Park`);
    await page.locator("#mPhone").fill("(206) 555-0101");
    await page.locator("#mAddress").fill("5 Lake Way, Kirkland, WA 98033");
    await page.locator("#mAdd").click();
    await page.locator('#iMeth [data-m="file"]').click();
    const csv = path.join(SHOTS || "/tmp", `leads-${TAG}.csv`);
    fs.writeFileSync(csv, `name,email,phone,street address,city,state,zip,project\nRay${TAG} Hill,ray@example.com,(425) 555-0177,77 Elm St,Redmond,WA,98052,Fence\n`);
    await page.locator("#dropInput").setInputFiles(csv);
    await page.waitForTimeout(500);
    const staged = (await page.locator("#stagedList").textContent()) ?? "";
    check("the import list shows the addresses", staged.includes("5 Lake Way, Kirkland, WA 98033") && staged.includes("77 Elm St, Redmond, WA, 98052"), staged);
    await shot(page, "9-import-list");
    await page.locator("#importBtn").click();
    await page.waitForTimeout(4000);
    const mia = await prisma.lead.findFirst({ where: { organizationId: org, name: `Mia${TAG} Park` } });
    const ray = await prisma.lead.findFirst({ where: { organizationId: org, name: `Ray${TAG} Hill` } });
    check("by hand: the line split into its parts", mia?.address === "5 Lake Way" && mia?.city === "Kirkland" && mia?.state === "WA" && mia?.zip === "98033", mia);
    check("CSV: the address columns kept", ray?.address === "77 Elm St" && ray?.city === "Redmond" && ray?.state === "WA" && ray?.zip === "98052" && ray?.email === "ray@example.com", ray);
    await ctx.close();
  }

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 6));
  await browser.close();
  console.log(bad ? `\n${bad} FAILED, ${good} ok` : `\nall ${good} ok`);
  await disconnect();
  process.exit(bad ? 1 : 0);
}

main().catch(async (e) => {
  console.error("walk crashed:", e instanceof Error ? e.message : e);
  await disconnect().catch(() => {});
  process.exit(2);
});
