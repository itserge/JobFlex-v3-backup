"use server";
// THE NEW PLANS' PRICES — Admin → Plans (Base + Tools, part 2, 2026-11-10; platform admin only), and the prices a
// new-plan shop's offer card reads (part 3a, any signed-in member). lib/toolPlans/prices.
//
// THE SUBSCRIPTION PAGE'S AND THE WELCOME PAGE'S BUTTONS (part 3b): try a tool, add it, remove it, people, another
// size, the main tool. The owner only (requireOwner — billing is the owner's, as actions/billing). Nothing from the
// client is trusted but the tool or size it names: every price is read on the server (Admin → Plans), every rule is
// lib/toolPlans/billing's. Each answers { ok, message } in plain words.
import { db } from "@/lib/db";
import { requireOrg, requireOwner, requirePlatformAdmin, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { addTool, changeToolsPlan, removeTool, setPeople, startToolTry, switchMainTool } from "@/lib/toolPlans/billing";
import { readToolCatalog, setToolPrices, type ToolPriceSetting } from "@/lib/toolPlans/prices";
import { isToolId, shortDay, toolById, toolPlanById, tryWords, type ToolId, type ToolPlanId } from "@/lib/toolPlans/shared";

export async function saveToolPricesAction(input: unknown): Promise<{ ok: true; setting: ToolPriceSetting } | { ok: false; problems: string[] }> {
  const admin = await requirePlatformAdmin();
  try {
    return await setToolPrices(input, admin.name || admin.email || null);
  } catch {
    return { ok: false, problems: ["The prices could not be saved. Try again."] };
  }
}

/** The tools' and sizes' monthly prices in force (Admin → Plans), for the card a new-plan shop sees at a page its
 *  plan doesn't hold (components/v3/upgrade-gate). Signed-in members only; null for anyone else. */
export async function toolGatePrices(): Promise<{ tools: Partial<Record<ToolId, number>>; plans: Partial<Record<ToolPlanId, number>> } | null> {
  try {
    await requireOrg();
  } catch {
    return null;
  }
  const cat = await readToolCatalog();
  return {
    tools: Object.fromEntries(cat.tools.map((t) => [t.id, t.cents])) as Partial<Record<ToolId, number>>,
    plans: Object.fromEntries(cat.plans.map((p) => [p.id, p.cents])) as Partial<Record<ToolPlanId, number>>,
  };
}

// ── part 3b: the shop's own buttons ──────────────────────────────────────────

export type ToolActionResult = { ok: boolean; message: string };

const PLAN_IDS: readonly ToolPlanId[] = ["basic", "professional", "advanced", "complete"];
const isPlanId = (v: unknown): v is ToolPlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);

/** The owner's organization and its time zone (dates in the answers are the shop's own days). */
async function owner(): Promise<{ ok: true; organizationId: string; tz: string | undefined } | { ok: false; message: string }> {
  try {
    const { organizationId } = await requireOwner();
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }).catch(() => null);
    return { ok: true, organizationId, tz: org?.timezone || undefined };
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, message: "Only the owner can change the plan." };
    throw err;
  }
}

const TRY_AGAIN = "Something went wrong. Try again in a minute.";

/** Start a tool's free try (one per tool per company). */
export async function tryToolAction(tool: unknown): Promise<ToolActionResult> {
  if (!isToolId(tool)) return { ok: false, message: "That tool doesn't exist." };
  const who = await owner();
  if (!who.ok) return who;
  try {
    const res = await startToolTry(who.organizationId, tool);
    if (!res.ok) return { ok: false, message: res.error };
    const cat = await readToolCatalog();
    return { ok: true, message: `${toolById(tool).label} is open. ${tryWords(tool, new Date(res.endsAt), who.tz, cat)}` };
  } catch (err) {
    console.error("[toolPlans] try:", err);
    return { ok: false, message: TRY_AGAIN };
  }
}

/** Buy a tool now (no try, or its try was used). */
export async function addToolAction(tool: unknown): Promise<ToolActionResult> {
  if (!isToolId(tool)) return { ok: false, message: "That tool doesn't exist." };
  const who = await owner();
  if (!who.ok) return who;
  try {
    const res = await addTool(who.organizationId, tool);
    if (!res.ok) return { ok: false, message: res.error };
    const label = toolById(tool).label;
    if (res.backOnTry) return { ok: true, message: `${label} is back on. It goes on your bill when its free try ends.` };
    return { ok: true, message: res.chargedNow ? `${label} is on your plan. Today's charge covers the days left this month.` : `${label} is on your plan. It's billed with your next bill.` };
  } catch (err) {
    console.error("[toolPlans] add:", err);
    return { ok: false, message: TRY_AGAIN };
  }
}

/** Remove a tool: a try won't be billed; a paid tool stays open to the end of the paid month (no refund). */
export async function removeToolAction(tool: unknown): Promise<ToolActionResult> {
  if (!isToolId(tool)) return { ok: false, message: "That tool doesn't exist." };
  const who = await owner();
  if (!who.ok) return who;
  try {
    const res = await removeTool(who.organizationId, tool);
    if (!res.ok) return { ok: false, message: res.error };
    const label = toolById(tool).label;
    const until = res.openUntil && Date.parse(res.openUntil) > Date.now() ? shortDay(res.openUntil, who.tz) : null;
    if (res.wasTry) return { ok: true, message: until ? `Removed. ${label} stays open until ${until} and won't be billed.` : `Removed. ${label} won't be billed.` };
    return { ok: true, message: until ? `Removed. ${label} stays open until ${until}, the end of the month you paid for.` : `Removed. ${label} is off your plan.` };
  } catch (err) {
    console.error("[toolPlans] remove:", err);
    return { ok: false, message: TRY_AGAIN };
  }
}

/** How many people the plan holds, the owner counted. */
export async function setPeopleAction(people: unknown): Promise<ToolActionResult> {
  const n = typeof people === "number" ? Math.floor(people) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 500) return { ok: false, message: "Pick a number of people between 1 and 500." };
  const who = await owner();
  if (!who.ok) return who;
  try {
    const res = await setPeople(who.organizationId, n);
    if (!res.ok) return { ok: false, message: res.error };
    return { ok: true, message: `Your plan holds ${n} ${n === 1 ? "person" : "people"} now.` };
  } catch (err) {
    console.error("[toolPlans] people:", err);
    return { ok: false, message: TRY_AGAIN };
  }
}

/** Move to another size. */
export async function changePlanAction(plan: unknown): Promise<ToolActionResult> {
  if (!isPlanId(plan)) return { ok: false, message: "That plan doesn't exist." };
  const who = await owner();
  if (!who.ok) return who;
  try {
    const res = await changeToolsPlan(who.organizationId, plan);
    if (!res.ok) return { ok: false, message: res.error };
    const name = toolPlanById(plan).name;
    const base = res.chargedNow ? `You're on ${name} now. Today's charge covers the rest of this month.` : `You're on ${name} now.`;
    return { ok: true, message: res.leftover ? `${base} One tool line couldn't come off the bill. Write to us from Help and we'll fix it.` : base };
  } catch (err) {
    console.error("[toolPlans] plan:", err);
    return { ok: false, message: TRY_AGAIN };
  }
}

/** Switch the main tool (the sign-up's free days only). */
export async function switchMainToolAction(tool: unknown): Promise<ToolActionResult> {
  if (!isToolId(tool)) return { ok: false, message: "That tool doesn't exist." };
  const who = await owner();
  if (!who.ok) return who;
  try {
    const res = await switchMainTool(who.organizationId, tool);
    if (!res.ok) return { ok: false, message: res.error };
    return { ok: true, message: `${toolById(tool).label} is your main tool now.` };
  } catch (err) {
    console.error("[toolPlans] switch:", err);
    return { ok: false, message: TRY_AGAIN };
  }
}
