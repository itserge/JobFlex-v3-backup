// WALK — the Operator's ears on the server when the microphone's level can't be read (owner, 2026-11-13, his first
// try of the new engine on a Mac: "sent after 22.7 s" — "20 seconds or more", "need more faster reaction").
//
// On the new engine every device records and the server writes it down; a level meter on the microphone notices the
// speech and the pause after it. A Mac's microphone can hand over PURE silence until somebody speaks (a headset, the
// system's own voice processing): a second and a half of that and the meter was given up for the whole
// conversation — six-second timed takes instead, a silent one uploaded every six seconds, each of them starting the
// wait for an unfinished-sounding sentence over (so it could wait for ever), and the readout counting from the turn
// before. Walked here, with a clip for a microphone:
//   · a sentence said at once goes about 1.8 s after its last word (the pause is being written down meanwhile);
//   · three seconds of pure silence first: the meter comes back with the voice, no timed takes;
//   · words that sound unfinished wait three seconds for the rest, say so in the readout, and GO — however slowly a
//     piece is written down;
//   · a meter that reads nothing at all: timed takes, the readout says so and shows no "sent after", and unfinished
//     words still go after their wait;
//   · a meter that can't be set up after a turn it could: never the turn before's clock;
//   · a microphone the meter knows and reads as pure silence: nothing is uploaded;
//   · the phone's sheet keeps the longer line inside the screen, and a held sentence still goes when let go.
//
// Wants on the stand: QA_BASE_URL, QA_PASS_OWNER (qa@acme.test a platform admin, on the new engine), the fake model
// (qa/fixtures/assistant-fake-openai.ts) behind OPENAI_BASE_URL — its address here as QA_FAKE_OPENAI — and
// QA_VOICE_WAV, a spoken sentence as a 48 kHz mono 16-bit WAV (the walk makes the late one from it).
import fs from "node:fs";
import os from "node:os";
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
const FAKE = (process.env.QA_FAKE_OPENAI || "http://127.0.0.1:4601").replace(/\/$/, "");
const WAV = process.env.QA_VOICE_WAV || "";
const NAV = { waitUntil: "domcontentloaded" as const, timeout: 180_000 };
const SPEED = "[data-operator-speed]";
const CARD = "[data-operator-speed-card]";
const QUESTION = "How many proposals are waiting?";
const HALF = "Create a proposal for the";

const fake = async (set: Record<string, unknown>) => {
  await fetch(`${FAKE}/__fake/ears`, { method: "POST", body: JSON.stringify(set) });
};

/** The clip with this many seconds of pure silence before it. */
function late(wav: string, seconds: number): string {
  const b = fs.readFileSync(wav);
  const at = b.indexOf(Buffer.from("data"));
  if (at < 0) throw new Error("QA_VOICE_WAV has no data chunk");
  const rate = b.readUInt32LE(24);
  const align = b.readUInt16LE(32);
  const pad = Buffer.alloc(Math.round(rate * seconds) * align);
  const out = Buffer.concat([b.subarray(0, at + 8), pad, b.subarray(at + 8)]);
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(b.readUInt32LE(at + 4) + pad.length, at + 4);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jf-ears-")), "late.wav");
  fs.writeFileSync(file, out);
  return file;
}

type Meter = "" | "dead" | "none";
type Session = { browser: Browser; ctx: BrowserContext; page: Page; uploads: number[]; errors: string[] };
const NOISE = /Download the React DevTools|\[HMR\]|\[Fast Refresh\]|favicon|webpack-hmr|_next\/static\/.*\.map|Failed to load resource|WebGL|THREE\./i;

/** A browser whose microphone is the clip; `meter`: "dead" reads exactly nothing, "none" can't be set up. */
async function session(wav: string, meter: Meter, phone = false): Promise<Session> {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`] });
  const ctx = await browser.newContext({ storageState: authFile("owner"), permissions: ["microphone"], ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }) });
  await ctx.addInitScript((m) => {
    const w = window as unknown as { __meter?: string };
    w.__meter = m;
    const read = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (buf) {
      if (w.__meter === "dead") buf.fill(0);
      else read.call(this, buf);
    };
    const make = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      if (w.__meter === "none") throw new Error("no meter here");
      return make.call(this);
    };
  }, meter);
  const page = await ctx.newPage();
  const uploads: number[] = [];
  const errors: string[] = [];
  page.on("request", (q) => {
    if (q.url().includes("/api/assistant/transcribe")) uploads.push(Date.now());
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  return { browser, ctx, page, uploads, errors };
}
const setMeter = (page: Page, m: Meter) => page.evaluate((x) => void ((window as unknown as { __meter?: string }).__meter = x), m);

async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, NAV);
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await page.locator("[data-tour-root] button", { hasText: /Not now|Skip/ }).first().click({ timeout: 4000 }).catch(() => {});
}
/** The page has read that this person is on the new engine (it remembers it from then on): the ears are the server's. */
const onNewEngine = (page: Page) => page.waitForFunction(() => window.localStorage.getItem("jf-operator-fast") === "1", undefined, { timeout: 60_000 });
/** The desk panel open and listening; the moment Talk was pressed. */
async function talk(page: Page): Promise<number> {
  await goto(page, "/dashboard");
  const box = page.getByPlaceholder(/Ask or tell JobFlex|Or type here/).first();
  if (!(await box.isVisible().catch(() => false))) await page.locator("button[aria-label^='AI Operator']").first().click();
  await box.waitFor({ timeout: 60_000 });
  await onNewEngine(page);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Talk to the AI Operator/ }).click();
  return Date.now();
}
/** The readout once it shows a line `not` isn't (the line before), or "" after `ms`. */
async function line(page: Page, ms: number, sel = SPEED, not = ""): Promise<string> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = (await page.locator(sel).first().innerText({ timeout: 500 }).catch(() => "")).trim();
    if (t && core(t) !== core(not)) return t;
    await page.waitForTimeout(100);
  }
  return "";
}
/** A line without its voice part (which arrives a moment after the rest). */
const core = (t: string) => t.replace(/ · voice after .*$/, "").replace(/from your last word to (its voice|the answer)/, "").replace(/^Speed test · [\d.]+ s/, "");
const sentAfter = (t: string) => Number(/sent after (\d+\.\d) s/.exec(t)?.[1] ?? NaN);

async function main() {
  if (!WAV) throw new Error("QA_VOICE_WAV is needed: a spoken sentence as a 48 kHz mono 16-bit WAV");
  const LATE = late(WAV, 3);
  const speechSec = (fs.statSync(WAV).size - 44) / (48_000 * 2);

  // Signed in, and on the new engine (whatever an earlier walk left).
  {
    const b = await chromium.launch();
    const r = await signInRole(b, "owner");
    if (!r.ok) throw new Error(`sign in: ${r.note}`);
    const c = await b.newContext({ storageState: authFile("owner"), viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    await goto(p, "/dashboard/settings?tab=assistant");
    await p.locator(`${CARD} [data-operator-engine='new']`).click({ timeout: 90_000 });
    await p.locator(`${CARD} [data-operator-engine='new'][aria-pressed='true']`).waitFor({ timeout: 30_000 });
    await p.waitForTimeout(6000);
    await b.close();
  }

  // ── a sentence said at once ──
  {
    await fake({ reset: true, queue: [QUESTION], delayMs: 1000 });
    const s = await session(WAV, "");
    await talk(s.page);
    const t = await line(s.page, 40_000);
    const sec = sentAfter(t);
    check("said at once: it goes 1.5 to 2.3 s after the last word (the piece is written down while the pause runs)", sec >= 1.5 && sec <= 2.3, t || "no readout");
    check("…timed from the meter, with no waiting for more", /sent after \d+\.\d s \(written down in \d+\.\d s\) · answered/.test(t), t);
    check("…in one piece", s.uploads.length === 1, s.uploads.length);
    const voiced = await s.page.waitForFunction((sel) => /voice after \d+\.\d s/.test(document.querySelector(sel)?.textContent ?? ""), SPEED, { timeout: 20_000 }).then(() => true).catch(() => false);
    check("…and the reply is read out", voiced, await s.page.locator(SPEED).first().innerText().catch(() => ""));
    // The meter is known to work on this page now. From here it reads pure silence: that microphone is silent, and
    // nothing of it is uploaded (it used to be — a take every six seconds for as long as the conversation was on).
    await setMeter(s.page, "dead");
    const before = s.uploads.length;
    await s.page.waitForTimeout(15_000);
    check("a microphone the meter knows, reading as pure silence: nothing is uploaded", s.uploads.length === before, s.uploads.length - before);
    check("no console errors (said at once)", s.errors.length === 0, s.errors.slice(0, 3));
    await s.browser.close();
  }

  // ── three seconds of pure silence, then the sentence ──
  {
    await fake({ reset: true, queue: [QUESTION], delayMs: 1000 });
    const s = await session(LATE, "");
    const t0 = await talk(s.page);
    const t = await line(s.page, 40_000);
    const sec = sentAfter(t);
    check("pure silence first: the meter comes back with the voice — sent 1.5 to 2.3 s after the last word", sec >= 1.5 && sec <= 2.3, t || "no readout");
    // Timed takes would have ended the first one six seconds in, in the middle of nothing: this one ends on the pause.
    const first = (s.uploads[0] ?? 0) - t0;
    const want = (3 + speechSec + 0.7) * 1000;
    check("…the take ends on the pause after the speech, not on a timer", s.uploads.length === 1 && Math.abs(first - want) < 900, { first, want, uploads: s.uploads.length });
    await s.browser.close();
  }

  // ── the same, and the words sound unfinished and are written down slowly ──
  {
    await fake({ reset: true, queue: [HALF], delayMs: 1200 });
    const s = await session(LATE, "");
    await talk(s.page);
    const t = await line(s.page, 40_000);
    const sec = sentAfter(t);
    check("unfinished-sounding words go after three seconds of waiting for the rest (they never went, before)", sec >= 4.3 && sec <= 5.8, t || "NOT SENT in 40 s");
    check("…and the readout says what was waited for", /waited for the rest of the sentence/.test(t), t);
    await s.browser.close();
  }

  // ── a meter that reads nothing at all ──
  {
    await fake({ reset: true, queue: [QUESTION], delayMs: 1000 });
    const s = await session(WAV, "dead");
    const t0 = await talk(s.page);
    const t = await line(s.page, 40_000);
    const took = Date.now() - t0;
    check("no level to read: timed takes — the request is answered inside nine seconds", !!t && took < 9000, { took, t });
    check("…the readout says so, and shows no 'sent after'", /level could not be read, heard in timed pieces \(written down in \d+\.\d s\)/.test(t) && !/sent after|from your last word/.test(t), t);
    await s.browser.close();
  }
  {
    await fake({ reset: true, queue: [HALF], delayMs: 1200 });
    const s = await session(WAV, "dead");
    const t0 = await talk(s.page);
    const t = await line(s.page, 40_000);
    const took = Date.now() - t0;
    // 6 s take + 1.2 s written down + 3 s for the rest, and at most one more piece being written down.
    check("no level to read, unfinished words: they go after their wait — inside fourteen seconds, not never", !!t && took < 14_000, { took, t: t || "NOT SENT in 40 s" });
    await s.browser.close();
  }

  // ── a turn whose meter can't be set up, after one whose could ──
  {
    await fake({ reset: true, queue: [QUESTION, QUESTION], delayMs: 1000 });
    const s = await session(WAV, "");
    await talk(s.page);
    const one = await line(s.page, 40_000);
    check("two turns: the first is timed from the meter", /sent after \d+\.\d s/.test(one), one);
    await setMeter(s.page, "none");
    const two = await line(s.page, 40_000, SPEED, one);
    check("…the second, with no meter, never shows the first one's clock", /level could not be read/.test(two) && !/sent after/.test(two), two || "no second turn in 40 s");
    await s.browser.close();
  }

  // ── the phone's sheet ──
  {
    await fake({ reset: true, queue: [QUESTION], delayMs: 1000 });
    const s = await session(WAV, "dead", true);
    await goto(s.page, "/mobile-assistant-v1");
    const dial = s.page.locator("button.op-core");
    await dial.waitFor({ timeout: 90_000 });
    await onNewEngine(s.page);
    await s.page.waitForTimeout(1500);
    await dial.tap();
    const t = await line(s.page, 40_000, ".op-speed");
    check("phone: a tap on the dial is a live conversation, heard and answered", /Speed test/.test(t), t || "no readout");
    const wide = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const box = await s.page.locator(".op-speed").boundingBox();
    check("phone: the longer line stays inside the screen", wide <= 1 && !!box && box.x >= 0 && box.x + box.width <= 391, { wide, box });
    if (process.env.QA_WALK_SHOTS) await s.page.screenshot({ path: path.join(process.env.QA_WALK_SHOTS, "ears-phone.png") });
    await s.browser.close();
  }
  {
    // Held: the dial pressed while the sentence is said, let go after it.
    await fake({ reset: true, queue: [QUESTION], delayMs: 1000 });
    const s = await session(WAV, "", true);
    await goto(s.page, "/mobile-assistant-v1");
    const dial = s.page.locator("button.op-core");
    await dial.waitFor({ timeout: 90_000 });
    await onNewEngine(s.page);
    await s.page.waitForTimeout(1500);
    const b = await dial.boundingBox();
    if (!b) throw new Error("no dial");
    await s.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await s.page.mouse.down();
    await s.page.waitForTimeout(Math.round(speechSec * 1000) + 900);
    await s.page.mouse.up();
    const t = await line(s.page, 40_000, ".op-speed");
    check("phone, held: let go after the sentence — heard, answered, timed from the meter", /sent after \d+\.\d s \(written down in \d+\.\d s\)/.test(t) && s.uploads.length === 1, { t: t || "no readout", uploads: s.uploads.length });
    await s.browser.close();
  }

  console.log(`\n${good}/${good + bad} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
