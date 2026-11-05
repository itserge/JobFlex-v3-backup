"use server";
// THE INVESTOR PAGE'S ACTIONS (2026-10-06) — platform admin only. The
// reading itself is lib/investors (shared with the public link and the PDF);
// these are the hand-typed ad budget, the start day and the link.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { addAdSpend, addInvestorLink, deleteAdSpend, investorReport, PLATFORMS, readInvestorSettings, saveInvestorSettings, setInvestorLinkEnabled, type InvestorReport, type InvestorSettings, type SpendPlatform } from "@/lib/investors";
import { saveInvestorPitch, type InvestorPitch } from "@/lib/investorPitch";

type Result = { ok: true; report: InvestorReport } | { ok: false; error: string };

async function fresh(): Promise<Result> {
  try {
    return { ok: true, report: await investorReport() };
  } catch {
    return { ok: false, error: "The figures could not be read. Try again in a moment." };
  }
}

export async function getInvestorReport(): Promise<InvestorReport> {
  await requirePlatformAdmin();
  return investorReport({ refreshMeta: true });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A daily budget over a span of days, by hand (until Meta's API token arrives). */
export async function addAdSpendAction(input: Record<string, unknown> = {}): Promise<Result> {
  const admin = await requirePlatformAdmin();
  const from = typeof input.from === "string" && DATE.test(input.from) ? input.from : "";
  const to = typeof input.to === "string" && DATE.test(input.to) ? input.to : from;
  const perDay = Number(input.perDayDollars);
  const platform = (PLATFORMS as readonly string[]).includes(String(input.platform)) ? (input.platform as SpendPlatform) : "meta";
  if (!from) return { ok: false, error: "Give the first day." };
  if (to < from) return { ok: false, error: "The last day is before the first." };
  if (!Number.isFinite(perDay) || perDay < 0 || perDay > 100000) return { ok: false, error: "Give the spend per day in dollars." };
  try {
    await addAdSpend({ from, to, perDayCents: Math.round(perDay * 100), platform, note: typeof input.note === "string" ? input.note : undefined }, admin.email ?? null);
  } catch {
    return { ok: false, error: "The spend could not be saved. Try again." };
  }
  return fresh();
}

export async function deleteAdSpendAction(input: Record<string, unknown> = {}): Promise<Result> {
  await requirePlatformAdmin();
  const id = typeof input.id === "string" ? input.id : "";
  if (!id) return { ok: false, error: "No entry given." };
  try {
    await deleteAdSpend(id);
  } catch {
    return { ok: false, error: "The entry could not be removed. Try again." };
  }
  return fresh();
}

/** The start day, the launch day, how far the chart looks, the daily budget, the readers' approval. No share of trials that pay
 *  and no forward spend (2026-10-24): both are measured now. */
export async function saveInvestorSettingsAction(input: Record<string, unknown> = {}): Promise<Result> {
  await requirePlatformAdmin();
  const patch: Partial<InvestorSettings> = {};
  if (typeof input.horizonDays === "number") patch.horizonDays = input.horizonDays;
  if (input.dailyBudgetDollars === null) patch.dailyBudgetCents = null;
  else if (typeof input.dailyBudgetDollars === "number" && Number.isFinite(input.dailyBudgetDollars) && input.dailyBudgetDollars > 0) patch.dailyBudgetCents = Math.round(input.dailyBudgetDollars * 100);
  if (input.budgetFrom === null) patch.budgetFrom = null;
  else if (typeof input.budgetFrom === "string" && DATE.test(input.budgetFrom)) patch.budgetFrom = input.budgetFrom;
  if (typeof input.approveReaders === "boolean") patch.approveReaders = input.approveReaders;
  if (input.launchDate === null) patch.launchDate = null;
  else if (typeof input.launchDate === "string" && DATE.test(input.launchDate)) patch.launchDate = input.launchDate;
  if (input.sinceDate === null) patch.sinceDate = null;
  else if (typeof input.sinceDate === "string" && DATE.test(input.sinceDate)) patch.sinceDate = input.sinceDate;
  try {
    await saveInvestorSettings(patch);
  } catch {
    return { ok: false, error: "The settings could not be saved. Try again." };
  }
  return fresh();
}

/** Meta's own spend per day, the last 30 days, now (lib/metaAdSpend). */
export async function pullMetaSpendAction(): Promise<Result> {
  await requirePlatformAdmin();
  const { pullMetaSpend } = await import("@/lib/metaAdSpend");
  const pulled = await pullMetaSpend(30);
  if (!pulled.ok) return { ok: false, error: pulled.error ?? "Meta did not answer." };
  return fresh();
}

/** One more shared link (every other link stays live — owner, 2026-11-04), or one link closed or opened again. */
export async function investorLinkAction(input: Record<string, unknown> = {}): Promise<Result> {
  await requirePlatformAdmin();
  try {
    if (input.add === true) await addInvestorLink();
    else if (typeof input.token === "string" && typeof input.enabled === "boolean") await setInvestorLinkEnabled(input.token, input.enabled);
  } catch {
    return { ok: false, error: "The link could not be changed. Try again." };
  }
  return fresh();
}

/** An admin's yes or no on a reader of the investor link (2026-10-20): a yes opens their page and emails them their
 *  link; a no keeps the door shut (or shuts it again on someone let in before). */
export async function decideInvestorReaderAction(input: Record<string, unknown> = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requirePlatformAdmin();
  const id = typeof input.id === "string" ? input.id.slice(0, 40) : "";
  const decision = input.decision === "approve" ? "approve" : input.decision === "decline" ? "decline" : null;
  if (!id || !decision) return { ok: false, error: "Pick approve or decline." };
  const { decideVisitor, readInvestorVisitors } = await import("@/lib/investorVisitors");
  const settings = await readInvestorSettings();
  const reader = (await readInvestorVisitors()).find((v) => v.id === id);
  if (!reader) return { ok: false, error: "That request is no longer on the list." };
  // The email's open link is made on the link they asked on while it is live; closed since, on the newest live link
  // (the yes is the person's, not the link's — 2026-11-04); with no link live, no email.
  const live = settings.links.filter((l) => l.enabled);
  const token = (live.find((l) => l.madeAt === reader.linkMadeAt) ?? live[0])?.token ?? null;
  const who = ("name" in me && me.name) || ("email" in me && me.email) || "an admin";
  const done = await decideVisitor(id, decision, token, String(who));
  return done ? { ok: true } : { ok: false, error: "That request is no longer on the list." };
}

/** The pitch deck's own words (2026-10-25): the team, the raise, what is next — shown on the link's Pitch deck; an
 *  empty box keeps its slide hidden. */
export async function saveInvestorPitchAction(input: Record<string, unknown> = {}): Promise<{ ok: true; pitch: InvestorPitch } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  const words: Partial<Pick<InvestorPitch, "team" | "ask" | "roadmap">> = {};
  for (const k of ["team", "ask", "roadmap"] as const) if (typeof input[k] === "string") words[k] = input[k] as string;
  try {
    return { ok: true, pitch: await saveInvestorPitch(words, admin.email ?? null) };
  } catch {
    return { ok: false, error: "The words could not be saved. Try again." };
  }
}
