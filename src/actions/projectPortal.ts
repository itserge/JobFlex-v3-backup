"use server";
// THE HOMEOWNER'S ONE WRITE (2026-11-08, the plan "Projects: Remodel and New construction", part 7): a choice made
// from their page, /p/<token>, with no sign-in — the token is the only key, as the contractor's /q/<token> reply
// (actions/projectSubs quoteSave). The database work is lib/projectClient/server clientChoose, which checks the
// selection belongs to the token's project and tells the office. Rate-limited by address.

import { z } from "zod";
import { clientChoose } from "@/lib/projectClient/server";
import { clientIp, rateLimitShared } from "@/lib/rateLimit";

const TOKEN = /^[A-Za-z0-9_-]{10,80}$/;
const HOUR = 60 * 60 * 1000;

export async function portalChoose(token: string, raw: unknown): Promise<{ ok: true; words: string } | { ok: false; error: string }> {
  if (!TOKEN.test(token)) return { ok: false, error: "This link is not valid." };
  const d = z.object({ selectionId: z.string().min(1).max(64), chosen: z.string().trim().min(1).max(500) }).safeParse(raw);
  if (!d.success) return { ok: false, error: "Say what you chose — a few words." };
  const ip = await clientIp();
  const rl = await rateLimitShared(`portal-choose:${ip}`, 30, HOUR);
  if (!rl.ok) return { ok: false, error: "Too many changes at once — try again in a few minutes." };
  return clientChoose(token, d.data.selectionId, d.data.chosen);
}
