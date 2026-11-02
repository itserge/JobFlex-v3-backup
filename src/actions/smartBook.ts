"use server";

// SMARTBOOK · THE PAGES' ACTIONS (2026-10-31). Public, keyed by the link's token, rate-limited by address like the
// booking page's (actions/booking): the customer's page (/b/<token>) — open times, book one, ask for their own,
// turn texts on — and the company's answer page (/b/r/<token>) from the request email.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { clientIp, enforceRateLimit, MINUTE, rateLimitShared } from "@/lib/rateLimit";
import { pickAt, pickTimes, proposeAt, requestDecide, textMe, type Decision, type PickDay, type PickView } from "@/lib/smartbook/engine";

type Out = { ok: true; view: PickView } | { ok: false; error: string; view?: PickView };

async function gate(what: string, max: number): Promise<string | null> {
  const g = await rateLimitShared(`smartbook-${what}:${await clientIp()}`, max, 10 * MINUTE);
  return g.ok ? null : "Too many tries — please wait a few minutes.";
}

function touched() {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/leads");
}

export async function smartBookTimes(token: string): Promise<{ ok: true; days: PickDay[] } | { ok: false; error: string }> {
  const g = await rateLimitShared(`smartbook-times:${await clientIp()}`, 60, MINUTE);
  if (!g.ok) return { ok: false, error: "Too many requests — try again in a minute." };
  const days = await pickTimes(String(token ?? "").slice(0, 40));
  return days ? { ok: true, days } : { ok: false, error: "This link is not active." };
}

export async function smartBookPick(token: string, iso: string): Promise<Out> {
  const g = await gate("pick", 12);
  if (g) return { ok: false, error: g };
  const r = await pickAt(String(token ?? "").slice(0, 40), String(iso ?? "").slice(0, 40));
  if (r.ok) touched();
  return r;
}

const proposeInput = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  part: z.enum(["morning", "afternoon", "evening"]).nullable(),
  note: z.string().max(500).default(""),
});

export async function smartBookPropose(token: string, raw: unknown): Promise<Out> {
  const parsed = proposeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a day, and a time if you have one in mind." };
  const g = await gate("propose", 6);
  if (g) return { ok: false, error: g };
  return proposeAt(String(token ?? "").slice(0, 40), parsed.data);
}

export async function smartBookTextMe(token: string): Promise<Out> {
  const g = await gate("texts", 6);
  if (g) return { ok: false, error: g };
  return textMe(String(token ?? "").slice(0, 40));
}

const decideInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("yes") }),
  z.object({ decision: z.literal("no") }),
  z.object({ decision: z.literal("other"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), time: z.string().regex(/^\d{2}:\d{2}$/) }),
]);

/** The company's answer from the request email's page. */
export async function smartBookDecide(token: string, raw: unknown): Promise<{ ok: true; line: string } | { ok: false; error: string }> {
  const parsed = decideInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick an answer, or a day and a time." };
  await enforceRateLimit(`smartbook-decide:${await clientIp()}`, 20, 10 * MINUTE, "answers");
  const r = await requestDecide(String(token ?? "").slice(0, 40), parsed.data as Decision);
  if (r.ok) touched();
  return r;
}
