"use server";
// The investor link's two public doors (2026-10-13): a reader introduces themselves, and an investor sends an offer.
// Open to anyone holding a live link — the link is checked on every call, and each address is held to a few a
// hour. Nothing here reads the figures; the page does that once the reader is known (lib/investorVisitors).
import { investorLinkOpen, readInvestorSettings } from "@/lib/investors";
import { checkIntro, checkOffer, mayRead, statusOf } from "@/lib/investorGate";
import { introduceVisitor, recordOffer, visitorForLink, type IntroOutcome } from "@/lib/investorVisitors";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { clientIp, enforceRateLimit } from "@/lib/rateLimit";

/** A signed-in platform admin trying the page: their entries are marked as tests (2026-10-14). */
async function isAdmin(): Promise<boolean> {
  try {
    await requirePlatformAdmin();
    return true;
  } catch {
    return false;
  }
}

const HOUR = 3_600_000;
type Result = { ok: true } | { ok: false; error: string; problems?: Record<string, string> };

async function linkLive(token: unknown): Promise<string | null> {
  const t = typeof token === "string" ? token : "";
  return /^[A-Za-z0-9_-]{16,64}$/.test(t) && (await investorLinkOpen(t)) ? t : null;
}
async function limit(key: string, max: number): Promise<string | null> {
  try {
    await enforceRateLimit(`${key}:${await clientIp()}`, max, HOUR, "tries");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Too many tries. Try again later.";
  }
}

export async function introduceInvestorAction(token: unknown, raw: unknown): Promise<Result | { ok: true; outcome: IntroOutcome }> {
  const t = await linkLive(token);
  if (!t) return { ok: false, error: "This link is no longer active. Ask for a current one." };
  const slow = await limit("inv-intro", 8);
  if (slow) return { ok: false, error: slow };
  const { value, problems } = checkIntro((raw ?? {}) as Record<string, string>);
  if (Object.keys(problems).length) return { ok: false, error: "A few details are missing.", problems: problems as Record<string, string> };
  const settings = await readInvestorSettings();
  // The reader is filed under the link they came through (one of several since 2026-11-04).
  const madeAt = settings.links.find((l) => l.enabled && l.token === t)?.madeAt ?? null;
  const { outcome } = await introduceVisitor(t, madeAt, value, { admin: await isAdmin(), approveReaders: settings.approveReaders });
  return { ok: true, outcome };
}

/** The waiting page asks, every little while, whether we have said yes (2026-10-20). Reads only this browser's own
 *  request — nothing of the figures. */
export async function investorRequestStatusAction(token: unknown): Promise<{ status: "open" | "pending" | "declined" | "none" }> {
  const t = await linkLive(token);
  if (!t) return { status: "none" };
  const v = await visitorForLink(t);
  if (!v) return { status: "none" };
  const settings = await readInvestorSettings();
  if (mayRead(v, settings.approveReaders)) return { status: "open" };
  return { status: statusOf(v) === "declined" ? "declined" : "pending" };
}

export async function sendInvestorOfferAction(token: unknown, raw: unknown): Promise<Result> {
  const t = await linkLive(token);
  if (!t) return { ok: false, error: "This link is no longer active. Ask for a current one." };
  // The offer carries its own name, company and email, so it goes through with or without this browser's pass
  // (2026-10-14: a lost cookie refused the owner's own test with "introduce yourself first").
  const visitor = await visitorForLink(t);
  const slow = await limit("inv-offer", 5);
  if (slow) return { ok: false, error: slow };
  const { value, problems } = checkOffer((raw ?? {}) as Record<string, string>);
  if (Object.keys(problems).length) return { ok: false, error: "A few details are missing.", problems: problems as Record<string, string> };
  await recordOffer(visitor?.id ?? null, value, { admin: visitor?.admin || (await isAdmin()) });
  return { ok: true };
}
