"use server";
// THE TRIAL CARD SWITCH (2026-10-07) — platform admin only; lib/trialPolicyServer.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { resetTrialPolicy, setSignupPlan, setSignupSteps, setSignupView, setTrialRequiresCard, signupTrialState, type SignupFlow, type SignupPlanSetting, type SignupTrialState, type SignupViewSetting } from "@/lib/trialPolicyServer";
import { isSignupViewMode } from "@/lib/signupView";
import { isPricingModel, setPricingModel, TOOLS_PLANS_READY, type PricingModelSetting } from "@/lib/toolPlans/server";

type Result = { ok: true; policy: SignupTrialState } | { ok: false; error: string };

export async function setTrialCardPolicyAction(input: Record<string, unknown> = {}): Promise<Result> {
  const admin = await requirePlatformAdmin();
  if (typeof input.requiresCard !== "boolean") return { ok: false, error: "Say whether a card is required." };
  try {
    return { ok: true, policy: await setTrialRequiresCard(input.requiresCard, admin.name || admin.email || null) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

/** Reset to default (env): the row goes and TRIAL_REQUIRES_CARD decides again. */
export async function resetTrialCardPolicyAction(): Promise<Result> {
  await requirePlatformAdmin();
  try {
    return { ok: true, policy: await resetTrialPolicy() };
  } catch {
    return { ok: false, error: "The reset could not be saved. Try again." };
  }
}

/** The sign-up's steps, 2 or 3, or the passwordless sign-up (lib/trialPolicyServer). */
export async function setSignupStepsAction(input: Record<string, unknown> = {}): Promise<{ ok: true; signup: SignupFlow } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  if (input.steps !== 2 && input.steps !== 3) return { ok: false, error: "Pick 2 or 3 steps." };
  try {
    return { ok: true, signup: await setSignupSteps(input.steps, admin.name || admin.email || null, input.passwordless === true) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

/** The plan at sign-up: the plan cards, or straight to Professional (lib/signupAutoPlan). */
export async function setSignupPlanAction(input: Record<string, unknown> = {}): Promise<{ ok: true; plan: SignupPlanSetting } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  if (input.mode !== "auto" && input.mode !== "pick") return { ok: false, error: "Pick how the plan is chosen." };
  try {
    return { ok: true, plan: await setSignupPlan(input.mode, admin.name || admin.email || null) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

/** The sign-up screen: the page, inside the app, or half and half (lib/signupView). */
export async function setSignupViewAction(input: Record<string, unknown> = {}): Promise<{ ok: true; view: SignupViewSetting } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  if (!isSignupViewMode(input.mode)) return { ok: false, error: "Pick the sign-up screen." };
  try {
    return { ok: true, view: await setSignupView(input.mode, admin.name || admin.email || null) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

/** The plans for new sign-ups: Classic (today) or Base + Tools (lib/toolPlans/server). Refused until the build is done. */
export async function setPricingModelAction(input: Record<string, unknown> = {}): Promise<{ ok: true; pricing: PricingModelSetting } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  if (!isPricingModel(input.mode)) return { ok: false, error: "Pick which plans new sign-ups get." };
  if (input.mode === "tools" && !TOOLS_PLANS_READY) return { ok: false, error: "The new plans aren't finished yet. This switch opens when the last part is built." };
  try {
    return { ok: true, pricing: await setPricingModel(input.mode, admin.name || admin.email || null) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

export async function readTrialCardPolicyAction(): Promise<SignupTrialState> {
  await requirePlatformAdmin();
  return signupTrialState({ fresh: true });
}
