// WALK — the AI Operator's new engine (owner, 2026-11-13: "understand me better and speak back faster … the best
// voice recognition and even accents").
//
// Settings → AI Operator has a "Speed test" card for platform admins: New engine / Engine before, and My words.
// On the new engine a turn is thought on OpenAI's fast model with its thinking off, the ears go through the server
// on every device and are given the company's own words, and each answer shows how long it took. Every step has a
// way back: the keywords refused → without them; the new ears refused → the ears before; the several-at-once
// refused → one at a time; the new brain refused → the brain before, and it is left alone for a while.
//
// Wants on the stand: QA_BASE_URL, QA_PASS_OWNER (qa@acme.test a platform admin), the fake model
// (qa/fixtures/assistant-fake-openai.ts) behind OPENAI_BASE_URL — its address here as QA_FAKE_OPENAI
// (http://127.0.0.1:4601 unless set) — and QA_VOICE_WAV, a spoken sentence as a 48 kHz mono WAV for the fake
// microphone (the spoken turn is skipped without it). QA_WALK_SHOTS = a folder for the pictures.
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
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
const FAKE = (process.env.QA_FAKE_OPENAI || "http://127.0.0.1:4601").replace(/\/$/, "");
const WAV = process.env.QA_VOICE_WAV || "";
const NAV = { waitUntil: "domcontentloaded" as const, timeout: 180_000 };
const SHOTS = process.env.QA_WALK_SHOTS || "";
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

type Ears = { heard: Array<{ model: string; languages: string[]; language: string | null; keywords: string[]; prompt: boolean }>; chats: Array<{ model: string; effort: string | null; parallel: boolean | null; temperature: number | null; systemStart: string }> };
const fake = async (set?: Record<string, unknown>): Promise<Ears> => {
  const res = await fetch(`${FAKE}/__fake/ears`, set ? { method: "POST", body: JSON.stringify(set) } : undefined);
  return (await res.json()) as Ears;
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
async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, NAV);
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 4000 }).catch(() => {});
}

const SPEED = "[data-operator-speed]";
const CARD = "[data-operator-speed-card]";

/** The desk panel, open, with its box. */
async function openPanel(page: Page) {
  const box = page.getByPlaceholder(/Ask or tell JobFlex|Or type here/).first();
  if (!(await box.isVisible().catch(() => false))) await page.locator("button[aria-label^='AI Operator']").first().click();
  await box.waitFor({ timeout: 60_000 });
  return box;
}
/** One typed request in the desk panel; resolves when its answer is in. */
async function typed(page: Page, text: string) {
  const box = await openPanel(page);
  const before = await page.locator("[aria-busy]").first().innerText().catch(() => "");
  await box.fill(text);
  await box.press("Enter");
  await page.waitForFunction((b) => {
    const log = document.querySelector("[aria-busy]");
    return log && log.getAttribute("aria-busy") === "false" && (log as HTMLElement).innerText !== b;
  }, before, { timeout: 90_000 });
  await page.waitForTimeout(300);
}
/** A take posted to the ears as the page would, signed in. */
async function hear(ctx: BrowserContext): Promise<{ status: number; body: { text?: string; model?: string; ms?: number; error?: string } }> {
  const res = await ctx.request.post(`${BASE}/api/assistant/transcribe`, { multipart: { audio: { name: "voice.webm", mimeType: "audio/webm", buffer: Buffer.from("not really sound, the stand's ears do not listen") }, language: "en" } });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as { text?: string; model?: string; ms?: number; error?: string } };
}

async function main() {
  await fake({ reset: true, text: "How many proposals are waiting?" });
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(WAV ? [`--use-file-for-fake-audio-capture=${WAV}%noloop`] : [])] });
  const r = await signInRole(browser, "owner");
  if (!r.ok) throw new Error(`sign in: ${r.note}`);
  const ctx = await browser.newContext({ storageState: authFile("owner"), viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  const page = watch(await ctx.newPage());

  // ── Settings → AI Operator: the card, the switch, my words ──
  await goto(page, "/dashboard/settings?tab=assistant");
  const card = page.locator(CARD);
  await card.waitFor({ timeout: 90_000 });
  check("settings: a platform admin sees the Speed test card", await card.isVisible());
  // Whatever an earlier run left: the new engine, no words.
  await card.locator("[data-operator-engine='new']").click();
  await page.locator(`${CARD} [data-operator-engine='new'][aria-pressed='true']`).waitFor({ timeout: 30_000 });
  check("settings: the new engine is the one pressed", (await card.locator("[data-operator-engine='new']").getAttribute("aria-pressed")) === "true" && (await card.locator("[data-operator-engine='classic']").getAttribute("aria-pressed")) === "false");
  check("settings: it says what the new engine does", /new engine/i.test(await card.innerText()) && /knows your company's names and streets/.test(await card.innerText()));
  const words = card.locator("#operator-my-words");
  await words.fill("Snohomish\nKowalczyk, Presidential shingles");
  await card.locator("[data-operator-words-save]").click();
  await page.waitForFunction(() => (document.querySelector("[data-operator-words-save]") as HTMLButtonElement | null)?.disabled === true, undefined, { timeout: 30_000 });
  await goto(page, "/dashboard/settings?tab=assistant");
  await page.locator(CARD).waitFor({ timeout: 90_000 });
  check("settings: my words are kept, one a line", (await page.locator("#operator-my-words").inputValue()) === "Snohomish\nKowalczyk\nPresidential shingles", await page.locator("#operator-my-words").inputValue());
  await shot(page, "1-settings-card");

  // ── a typed turn on the new engine ──
  await fake({ reset: true });
  await typed(page, "How many proposals are waiting?");
  const line = page.locator(SPEED).first();
  await line.waitFor({ timeout: 30_000 });
  const lineText = await line.innerText();
  check("desk: the answer shows how long it took, and on which model", /^Speed test · answered in \d+\.\d s \(model \d+\.\d s, \d rounds?, gpt-6-luna\)/.test(lineText), lineText);
  let f = await fake();
  const chat = f.chats[f.chats.length - 1];
  check("desk: the turn was thought on gpt-6-luna with its thinking off, several look-ups allowed, no temperature", !!chat && chat.model === "gpt-6-luna" && chat.effort === "none" && chat.parallel === true && chat.temperature === null, chat);
  check("desk: the prompt opens with what never changes (no company, no clock)", !!chat && chat.systemStart.startsWith("You are the JobFlex AI Operator for a contracting business."), chat?.systemStart);
  await shot(page, "2-typed-turn");

  // ── the ears: the new model with the company's words, and each way back ──
  let h = await hear(ctx);
  f = await fake();
  let last = f.heard[f.heard.length - 1];
  check("ears: a take is written down by gpt-transcribe", h.status === 200 && h.body.text === "How many proposals are waiting?" && h.body.model === "gpt-transcribe" && last?.model === "gpt-transcribe", { h, last });
  check("ears: the language goes as a list, with the word list", last?.languages.join() === "en" && last.language === null && last.prompt === true, last);
  check("ears: it is given my words first, then the company's own", last?.keywords[0] === "Snohomish" && last.keywords.includes("Kowalczyk") && last.keywords.includes("Presidential shingles") && last.keywords.includes("EagleView") && last.keywords.length > 6, last?.keywords.slice(0, 12));
  await fake({ refuseKeywords: true });
  h = await hear(ctx);
  f = await fake();
  check("ears: the keywords refused → the same model without them", h.status === 200 && h.body.model === "gpt-transcribe" && f.heard.slice(-2).map((x) => `${x.model}:${x.keywords.length ? "k" : "-"}`).join() === "gpt-transcribe:k,gpt-transcribe:-", f.heard.slice(-2));
  await fake({ refuseKeywords: false, refuse: ["gpt-transcribe"] });
  h = await hear(ctx);
  f = await fake();
  last = f.heard[f.heard.length - 1];
  check("ears: the new model refused → the ears before, asked as before", h.status === 200 && h.body.text === "How many proposals are waiting?" && h.body.model === "gpt-4o-mini-transcribe" && last?.language === "en" && last.keywords.length === 0, { h, last });
  await fake({ refuse: [] });

  // ── a spoken turn: the server's ears on a desktop too, the wait timed from the last word ──
  if (WAV) {
    await fake({ reset: true });
    await openPanel(page);
    await page.getByRole("button", { name: /Talk to the AI Operator/ }).click();
    const spoken = page.locator(SPEED, { hasText: "from your last word" }).first();
    await spoken.waitFor({ timeout: 60_000 }).catch(() => {});
    const st = (await spoken.count()) ? await spoken.innerText() : "";
    check("talk (desktop): the clip is heard by the server's ears and answered", /from your last word/.test(st), st || (await page.locator(SPEED).first().innerText().catch(() => "no readout")));
    check("talk: the readout has its parts — sent, written down, answered", /sent after \d+\.\d s \(written down in \d+\.\d s\) · answered in \d+\.\d s/.test(st), st);
    f = await fake();
    check("talk: that take went to gpt-transcribe with the words", f.heard.some((x) => x.model === "gpt-transcribe" && x.keywords.includes("Snohomish")), f.heard.slice(-2));
    // The reply's sound starts a moment later: the line then runs to its voice.
    const voiced = await page.waitForFunction((sel) => /voice after \d+\.\d s/.test(document.querySelector(sel)?.textContent ?? ""), SPEED, { timeout: 20_000 }).then(() => true).catch(() => false);
    check("talk: when the reply's sound starts the line runs to its voice", voiced, await page.locator(SPEED).first().innerText().catch(() => ""));
    await shot(page, "3-spoken-turn");
    await page.getByRole("button", { name: /Stop talking/ }).click().catch(() => {});
  } else console.log("skip talk (no QA_VOICE_WAV)");

  // ── the engine before ──
  await goto(page, "/dashboard/settings?tab=assistant");
  await page.locator(`${CARD} [data-operator-engine='classic']`).click();
  await page.locator(`${CARD} [data-operator-engine='classic'][aria-pressed='true']`).waitFor({ timeout: 30_000 });
  check("settings: Engine before is pressed, and the words stay", (await page.locator("#operator-my-words").inputValue()).startsWith("Snohomish"));
  await fake({ reset: true });
  await typed(page, "How many proposals are waiting?");
  f = await fake();
  const old = f.chats[f.chats.length - 1];
  check("before: the turn is thought as it always was — one call at a time, the prompt opening with the company", !!old && old.model !== "gpt-6-luna" && old.parallel === false && old.effort === null && /^You are the JobFlex AI Operator for .+, a contracting/.test(old.systemStart) && !old.systemStart.startsWith("You are the JobFlex AI Operator for a contracting"), old);
  check("before: no speed line", (await page.locator(SPEED).count()) === 0);
  // The ears read the person's switch again every few seconds (lib/assistant/speed): by now they have it.
  await page.waitForTimeout(6000);
  h = await hear(ctx);
  f = await fake();
  check("before: the ears before, no keywords", h.body.model === "gpt-4o-mini-transcribe" && f.heard[f.heard.length - 1]?.keywords.length === 0, f.heard.slice(-1));

  // ── back to the new engine; the phone ──
  await goto(page, "/dashboard/settings?tab=assistant");
  await page.locator(`${CARD} [data-operator-engine='new']`).click();
  await page.locator(`${CARD} [data-operator-engine='new'][aria-pressed='true']`).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  {
    const pctx = await browser.newContext({ storageState: authFile("owner"), viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const phone = watch(await pctx.newPage());
    await goto(phone, "/mobile-settings-v1?pane=assistant");
    const pc = phone.locator(CARD);
    const has = await pc.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    if (!has) {
      // The pane is opened from the list where the address did not open it.
      await phone.getByText("AI Operator", { exact: false }).first().click().catch(() => {});
      await pc.waitFor({ timeout: 30_000 }).catch(() => {});
    }
    check("phone: the Speed test card is in Settings → AI Operator", await pc.isVisible().catch(() => false));
    await pc.scrollIntoViewIfNeeded().catch(() => {});
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("phone: nothing pushes the page sideways", wide <= 1, wide);
    const box = await pc.locator("#operator-my-words").boundingBox();
    check("phone: the words box fits the screen and is tall enough to tap", !!box && box.x >= 0 && box.x + box.width <= 391 && box.height >= 88, box);
    await shot(phone, "4-phone-settings");
    await goto(phone, "/mobile-assistant-v1");
    await phone.getByRole("button", { name: "Type" }).first().click({ timeout: 60_000 });
    const pbox = phone.getByPlaceholder("Type it…");
    await pbox.fill("How many proposals are waiting?");
    await phone.getByRole("button", { name: "Send", exact: true }).click();
    const pl = phone.locator(".op-speed");
    await pl.waitFor({ timeout: 90_000 }).catch(() => {});
    check("phone: the Operator's sheet shows how long the answer took", /Speed test · answered in/.test(await pl.innerText().catch(() => "")), await pl.innerText().catch(() => "no line"));
    const pw = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("phone: the sheet stays inside the screen", pw <= 1, pw);
    await shot(phone, "5-phone-sheet");
    await pctx.close();
  }

  // ── the brain's ways back (last: the new brain is then left alone for a while) ──
  await fake({ reset: true, refuseParallel: true });
  await typed(page, "How many proposals are waiting?");
  f = await fake();
  check("brain: the several-at-once refused → the same model, one at a time", f.chats.slice(0, 2).map((c) => `${c.model}:${c.parallel}`).join() === "gpt-6-luna:true,gpt-6-luna:false" && /gpt-6-luna/.test(await page.locator(SPEED).first().innerText()), f.chats.slice(0, 3));
  await fake({ reset: true, refuseChat: ["gpt-6-luna"] });
  await typed(page, "How many proposals are waiting?");
  f = await fake();
  const models = f.chats.map((c) => c.model);
  check("brain: the new model refused → the turn is still answered, by the model before", models[0] === "gpt-6-luna" && models.length >= 2 && models.slice(1).every((m) => m !== "gpt-6-luna") && !/gpt-6-luna/.test(await page.locator(SPEED).first().innerText()), { models, line: await page.locator(SPEED).first().innerText().catch(() => "") });
  await fake({ reset: true });
  await typed(page, "How many proposals are waiting?");
  f = await fake();
  check("brain: …and it is left alone for a while (the next turn goes straight to the model before)", f.chats.length > 0 && f.chats.every((c) => c.model !== "gpt-6-luna"), f.chats.map((c) => c.model));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await browser.close();
  console.log(`\n${good}/${good + bad} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
