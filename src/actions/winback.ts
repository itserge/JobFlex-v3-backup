"use server";

// BRING CLIENTS BACK — the page's actions (Smart CRM part 6, 2026-11-10; lib/winback). Managers only: a campaign
// writes to the company's whole book in the company's name. Part of Smart CRM, so the same paid gate as the rest.
// Every refusal a person should read comes back as a value ({ ok: false, error }).

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireManager, UnauthorizedError, NoOrgError } from "@/lib/orgContext";
import { pageLockedResult } from "@/lib/customPageAccess";
import { enforceRateLimit, RateLimitError } from "@/lib/rateLimit";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { appBaseUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/sdk/resend";
import { campaignEmail, campaignFrom } from "@/lib/winback/email";
import { housesToFill, lookUpHouses, setHouseByHand, type HouseRow, type HouseRun } from "@/lib/winback/house";
import { deleteCampaign, deleteList, previewList, readWinBack, saveCampaign, saveList, sendBatch, sendingProblem, startCampaign, stopCampaign, type ListPreview, type StartResult, type WinBack } from "@/lib/winback/server";
import { readWords, writeCampaign } from "@/lib/winback/understand";
import { campaignText, fillWords, isEmptyFilter, looksLikeEmail, tidyFilter } from "@/lib/winback/shared";

type No = { ok: false; error: string };
type Yes<T = object> = { ok: true } & T;
const HOUR = 3_600_000;

interface Ctx {
  organizationId: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
}

/** Manager + Smart CRM, as a value. A rate limit, when given, is spent here. */
async function gate(limit?: { key: string; max: number; what: string }): Promise<Yes<Ctx> | No> {
  let ctx: Awaited<ReturnType<typeof requireManager>>;
  try {
    ctx = await requireManager();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an owner or manager can write to the whole client list." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to a company first." };
    throw err;
  }
  const paused = await pageLockedResult(ctx.organizationId, "smart-crm");
  if (paused) return { ok: false, error: paused.error };
  if (limit) {
    try {
      await enforceRateLimit(`winback:${limit.key}:${ctx.organizationId}`, limit.max, HOUR, limit.what);
    } catch (err) {
      if (err instanceof RateLimitError) return { ok: false, error: err.message };
      throw err;
    }
  }
  return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name ?? null, userEmail: ctx.user.email ?? null };
}

const touch = () => {
  try {
    revalidatePath("/dashboard/crm");
  } catch {
    /* no request scope: the page re-reads through getWinBack anyway */
  }
};

export type WinBackData = WinBack & { housesToFill: HouseRow[] };

export async function getWinBack(): Promise<Yes<{ data: WinBackData }> | No> {
  const g = await gate();
  if (!g.ok) return g;
  const [data, rows] = await Promise.all([readWinBack(g.organizationId), housesToFill(g.organizationId)]);
  return { ok: true, data: { ...data, housesToFill: rows } };
}

/** "deck clients we haven't heard from in two years" → who that is. */
export async function findClients(words: string): Promise<Yes<{ preview: ListPreview; by: "ai" | "rules"; understood: boolean }> | No> {
  const asked = typeof words === "string" ? words.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  if (asked.length < 3) return { ok: false, error: "Say who you're looking for, in your own words." };
  const g = await gate({ key: "find", max: 60, what: "searches" });
  if (!g.ok) return g;
  const read = await readWords(g.organizationId, asked);
  if (isEmptyFilter(read.filter)) return { ok: true, preview: await previewList(g.organizationId, read.filter), by: read.by, understood: false };
  return { ok: true, preview: await previewList(g.organizationId, read.filter), by: read.by, understood: true };
}

/** Who a filter names today (a ready list, a saved list, or the chips after one was removed). */
export async function previewClients(filter: unknown): Promise<Yes<{ preview: ListPreview }> | No> {
  const g = await gate();
  if (!g.ok) return g;
  return { ok: true, preview: await previewList(g.organizationId, filter) };
}

const listInput = z.object({ name: z.string().trim().min(1, "Give the list a name.").max(80), filter: z.unknown(), words: z.string().max(400).nullish() });

export async function saveClientList(raw: unknown): Promise<Yes<{ id: string }> | No> {
  const parsed = listInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Give the list a name." };
  if (isEmptyFilter(tidyFilter(parsed.data.filter))) return { ok: false, error: "This list has no rules yet, so it would be every client." };
  const g = await gate({ key: "save", max: 60, what: "saves" });
  if (!g.ok) return g;
  const row = await saveList(g.organizationId, g.userId, { name: parsed.data.name, filter: parsed.data.filter, words: parsed.data.words ?? null });
  touch();
  return { ok: true, id: row.id };
}

export async function deleteClientList(id: string): Promise<Yes | No> {
  const g = await gate();
  if (!g.ok) return g;
  await deleteList(g.organizationId, String(id));
  touch();
  return { ok: true };
}

/** A first draft for a list. Nothing is saved or sent. */
export async function draftCampaign(raw: unknown): Promise<Yes<{ subject: string; body: string; by: "ai" | "rules" }> | No> {
  const parsed = z.object({ filter: z.unknown(), listName: z.string().max(80).nullish(), about: z.string().max(300).nullish() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Couldn't read that. Try again." };
  const g = await gate({ key: "draft", max: 30, what: "drafts" });
  if (!g.ok) return g;
  const d = await writeCampaign(g.organizationId, { filter: tidyFilter(parsed.data.filter), listName: parsed.data.listName ?? null, about: parsed.data.about ?? null });
  return { ok: true, ...d };
}

const campaignInput = z.object({
  id: z.string().nullish(),
  name: z.string().max(80).nullish(),
  filter: z.unknown(),
  listId: z.string().nullish(),
  subject: z.string(),
  body: z.string(),
  writtenBy: z.enum(["ai", "rules", "person"]).optional(),
});

export async function saveCampaignDraft(raw: unknown): Promise<Yes<{ id: string }> | No> {
  const parsed = campaignInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Check the email's subject and words." };
  if (isEmptyFilter(tidyFilter(parsed.data.filter))) return { ok: false, error: "Pick who it goes to first." };
  const g = await gate({ key: "save", max: 60, what: "saves" });
  if (!g.ok) return g;
  const res = await saveCampaign(g.organizationId, g.userId, { ...parsed.data, filter: parsed.data.filter }, parsed.data.id ?? null);
  if (res.ok) touch();
  return res;
}

export async function deleteCampaignDraft(id: string): Promise<Yes | No> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await deleteCampaign(g.organizationId, String(id));
  if (res.ok) touch();
  return res;
}

/** The email as one client would get it, sent to the person at the desk. Nothing is recorded as a campaign. */
export async function sendCampaignTest(raw: unknown): Promise<Yes<{ to: string }> | No> {
  const text = campaignText.safeParse(raw);
  if (!text.success) return { ok: false, error: text.error.issues[0]?.message ?? "Check the email's words." };
  const g = await gate({ key: "test", max: 12, what: "test emails" });
  if (!g.ok) return g;
  const to = (g.userEmail ?? "").trim().toLowerCase();
  if (!looksLikeEmail(to)) return { ok: false, error: "Your own account has no email address to send the test to." };
  const problem = await sendingProblem(g.organizationId);
  if (problem) return { ok: false, error: problem };
  const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { id: true, name: true, phone: true, address: true } });
  if (!org?.address) return { ok: false, error: "Add your company's mailing address first." };
  const who = { name: g.userName?.trim() || "Alex Sample", company: org.name, lastJob: "your project" };
  const subject = fillWords(text.data.subject, who).replace(/\s+/g, " ").trim();
  const base = await appBaseUrl();
  const mail = campaignEmail({ subject, body: fillWords(text.data.body, who), company: { id: org.id, name: org.name, phone: org.phone, address: org.address.trim() }, stopUrl: `${base.replace(/\/$/, "")}/api/email/stop?r=test&t=test` });
  try {
    const left = await sendEmail({ mailClass: "transactional", to, subject: `[Test] ${subject}`, html: mail.html, text: mail.text, from: campaignFrom(org.name), kind: "campaign", organizationId: g.organizationId });
    if (left.skipped && left.id === "disabled") return { ok: false, error: "Email sending isn't set up, so the test didn't go out." };
  } catch (err) {
    return { ok: false, error: `The test didn't go out: ${err instanceof Error ? err.message : "the mail service refused it"}` };
  }
  return { ok: true, to };
}

/** SEND. The list is counted again right now; the first batch leaves; the rest follow hour by hour. */
export async function sendCampaign(id: string): Promise<Yes<StartResult> | No> {
  const g = await gate({ key: "send", max: 6, what: "campaigns" });
  if (!g.ok) return g;
  const base = await appBaseUrl();
  const res = await startCampaign(g.organizationId, g.userId, String(id));
  if (!res.ok) return res;
  // The first emails leave once this answer is back with the page; the rest follow hour by hour.
  if (!res.waits) {
    const org = g.organizationId;
    after(() =>
      sendBatch(org, String(id), base)
        .then(() => undefined)
        .catch((err) => console.warn("[winback] first batch failed:", err instanceof Error ? err.message : err)),
    );
  }
  await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.CLIENT, summary: `Sent a campaign to ${res.queued} client${res.queued === 1 ? "" : "s"}`, meta: { campaignId: String(id), queued: res.queued } });
  touch();
  return res;
}

export async function stopCampaignNow(id: string): Promise<Yes<{ stopped: number }> | No> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await stopCampaign(g.organizationId, String(id));
  if (res.ok) touch();
  return res;
}

/** Look up the next few houses in the free public records. */
export async function lookUpClientHouses(): Promise<Yes<HouseRun> | No> {
  const g = await gate({ key: "houses", max: 12, what: "house lookups" });
  if (!g.ok) return g;
  const run = await lookUpHouses(g.organizationId);
  touch();
  return { ok: true, ...run };
}

export async function saveClientHouse(clientId: string, facts: unknown): Promise<Yes | No> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await setHouseByHand(g.organizationId, String(clientId), facts);
  if (res.ok) touch();
  return res;
}
