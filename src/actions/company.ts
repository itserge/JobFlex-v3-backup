"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireOrg, requireRouteAccess, roleMayOpen } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { TRADE_TYPES, parseTradeTypes } from "@/lib/tradeTypes";
import { geocodeOrgAddress } from "@/lib/leadCenter/eligibility";
import { loadTeamActivity } from "@/lib/teamActivity";
import { toActivityEntries } from "@/components/v3/company-blueprint/company-data";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { isPageLocked, requirePage } from "@/lib/customPageAccess";
import { clearOrgNameUnset } from "@/lib/orgName";
import { timezoneFixFor } from "@/lib/usTimezone";

const brandingInput = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  billingEmail: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  primaryColor: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
});

export async function updateBranding(raw: unknown) {
  const { organizationId, user } = await requireManager();
  await requirePage(organizationId, "company");
  const data = brandingInput.parse(raw);

  // Keep the Lead Center pin in sync — branding is the other surface that can
  // edit the org address (see updateLeadProfile for the same policy).
  const current =
    data.address !== undefined || data.name !== undefined || data.phone !== undefined
      ? await db.organization.findUnique({
          where: { id: organizationId },
          select: { address: true, lat: true, lng: true, name: true, phone: true, timezone: true },
        })
      : null;
  const addressChanged =
    data.address !== undefined && (data.address ?? "") !== (current?.address ?? "");
  // The time zone follows the address (or the phone's area code) while nobody has chosen one — a company still on
  // the default zone reads its reminders and its calendar in the wrong hours (2026-11-07, lib/usTimezone).
  const timezone = current ? timezoneFixFor(current.timezone, { address: data.address !== undefined ? data.address : current.address, phone: data.phone !== undefined ? data.phone : current.phone }) : null;

  await db.organization.update({
    where: { id: organizationId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.billingEmail !== undefined && { billingEmail: data.billingEmail }),
      ...(data.address !== undefined && { address: data.address }),
      ...(timezone && { timezone }),
      ...(data.website !== undefined && { website: data.website }),
      ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
      ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
    },
  });

  // A new name is the business named: the passwordless sign-up's stand-in
  // (the owner's own name, lib/orgName) is no longer asked about.
  if (data.name !== undefined && data.name.trim() !== (current?.name ?? "").trim()) await clearOrgNameUnset(organizationId);

  if (addressChanged || (data.address !== undefined && (current?.lat == null || current?.lng == null))) {
    await geocodeOrgAddress(organizationId, data.address ?? "", { gateOnFailure: false });
  }

  revalidatePath("/dashboard/company");
  revalidatePath("/dashboard/settings/company");
  const fields = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.SETTINGS,
    summary: `Updated company settings${fields.length ? ` — ${fields.join(", ")}` : ""}`,
    meta: { area: "company", fields },
  });
}

// Lead Center matching profile — address + canonical trades feed the platform
// lead matcher. Saving a changed address re-geocodes; a geocode failure still
// saves the address but nulls lat/lng (the org drops out of matching until it
// resolves, and the dashboard banner surfaces that).
const leadProfileInput = z.object({
  address: z.string().trim().max(240).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  tradeTypes: z.array(z.enum(TRADE_TYPES)).max(TRADE_TYPES.length).optional(),
  // Free text under the "Other" chip. It has its own column because
  // tradeTypesJson is validated against the closed TRADE_TYPES vocabulary and
  // drops anything else on read (same rule the register form follows).
  otherTrade: z.string().trim().max(80).nullable().optional(),
  leadOffersEnabled: z.boolean().optional(),
  // How far from the shop a lead may be (lib/leadCenter/matching, 2026-10-03).
  serviceRadiusMiles: z.number().int().min(5).max(500).optional(),
});

export async function updateLeadProfile(
  raw: unknown,
): Promise<{ geocoded: boolean; reason: string | null }> {
  const { organizationId, user } = await requireManager();
  await requirePage(organizationId, "company");
  const data = leadProfileInput.parse(raw);

  const current = await db.organization.findUnique({
    where: { id: organizationId },
    select: { address: true, lat: true, lng: true },
  });

  await db.organization.update({
    where: { id: organizationId },
    data: {
      ...(data.address !== undefined && { address: data.address }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.tradeTypes !== undefined && { tradeTypesJson: JSON.stringify(data.tradeTypes) }),
      // Dropping "Other" drops the text with it — a named trade nobody can see
      // is a value that quietly keeps matching against a chip that is off.
      ...(data.tradeTypes !== undefined &&
        !data.tradeTypes.includes("Other") && { otherTrade: null }),
      ...(data.otherTrade !== undefined && { otherTrade: data.otherTrade || null }),
      ...(data.leadOffersEnabled !== undefined && { leadOffersEnabled: data.leadOffersEnabled }),
      ...(data.serviceRadiusMiles !== undefined && { serviceRadiusMiles: data.serviceRadiusMiles }),
    },
  });

  // The pin, through the one routine the signup and the backfill also use.
  //
  // It now runs when the address CHANGED *or* when a shop that has an address
  // still has no pin. The second half is the fix for a trap this page set: the
  // geocode was gated on the string changing, so an org created without
  // coordinates could be re-saved from this very card forever and stay
  // un-routable, because the address it was re-saving was already correct.
  const addressNow = data.address !== undefined ? (data.address ?? "") : (current?.address ?? "");
  const addressChanged =
    data.address !== undefined && (data.address ?? "") !== (current?.address ?? "");
  const missingPin = current?.lat == null || current?.lng == null;

  let geocoded = !missingPin;
  let reason: string | null = null;
  if (addressChanged || missingPin) {
    // gateOnFailure: false — the owner is looking at the Accept-platform-leads
    // toggle they set themselves; the banner reports a miss instead.
    const res = await geocodeOrgAddress(organizationId, addressNow, { gateOnFailure: false });
    geocoded = res.ok;
    reason = res.reason;
  }

  revalidatePath("/dashboard/company");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leads");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.SETTINGS,
    summary: "Updated lead profile settings",
    meta: { area: "lead profile", addressChanged, leadOffersEnabled: data.leadOffersEnabled, tradeTypes: data.tradeTypes },
  });
  return { geocoded, reason };
}

/**
 * Read-only seed for the handheld Company surface (mobile-company-v2), which
 * ResponsiveDashboardShell mounts props-less. Same guard and same reads as the
 * desktop page (app/dashboard/company/page.tsx): requireOrg() for the org row,
 * loadTeamActivity for members + feed, and the SAME toActivityEntries mapper —
 * plus the ActivityEvent id per entry, which the handheld feed needs for React
 * keys and its row-actions sheet.
 */
/**
 * What is standing between this shop and a platform lead.
 *
 * The three conditions are `buildRanking`'s hard filter
 * (lib/leadCenter/matching), asked for one org so a surface can say so out
 * loud. Read-only and cheap by design: the Overview and Leads nudge mounts on
 * both viewports call it (components/dashboard/LeadProfileNudge), so it stays
 * one indexed row and no joins.
 *
 * `reason` is the recorded gate note when a geocode failed — see
 * lib/leadCenter/eligibility. Null when nothing was ever recorded.
 */
export async function leadProfileGaps(): Promise<{
  needsAddress: boolean;
  needsTrades: boolean;
  paused: boolean;
  reason: string | null;
}> {
  const { organizationId, role } = await requireOrg();
  // The nudge points at the Company page; a shop that did not buy it is not
  // sent there (lib/customPageAccess), and neither is a member whose role may
  // not open it (2026-10-23: a sales rep was told to complete a profile they
  // could not reach).
  if (!roleMayOpen(role, "/dashboard/company") || (await isPageLocked(organizationId, "company"))) return { needsAddress: false, needsTrades: false, paused: false, reason: null };
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { lat: true, lng: true, tradeTypesJson: true, leadOffersEnabled: true },
  });
  if (!org) return { needsAddress: false, needsTrades: false, paused: false, reason: null };

  const needsAddress = org.lat == null || org.lng == null;
  const needsTrades = parseTradeTypes(org.tradeTypesJson).length === 0;
  const { readLeadGate } = await import("@/lib/leadCenter/eligibility");
  return {
    needsAddress,
    needsTrades,
    paused: !org.leadOffersEnabled,
    reason: needsAddress ? await readLeadGate(organizationId) : null,
  };
}

export async function getCompanySeed() {
  // Company settings and the team's log: for whoever may open Company.
  const { organizationId } = await requireRouteAccess("/dashboard/company");
  await requirePage(organizationId, "company");
  const [org, activity] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId } }),
    loadTeamActivity(organizationId),
  ]);
  if (!org) throw new Error("Organization not found");

  const entries = toActivityEntries(activity.activities);
  return {
    org: {
      name: org.name,
      billingEmail: org.billingEmail ?? "",
      phone: org.phone ?? "",
      website: org.website ?? "",
      address: org.address ?? "",
      primaryColor: org.primaryColor ?? "",
      logoUrl: org.logoUrl,
      tradeTypes: parseTradeTypes(org.tradeTypesJson) as string[],
      leadOffersEnabled: org.leadOffersEnabled,
      serviceRadiusMiles: org.serviceRadiusMiles,
      // The matcher's third condition, so the handheld badge can report the
      // same truth the desk one does (see company-blueprint renderLeadState).
      geocoded: org.lat != null && org.lng != null,
      publicProfileEnabled: org.publicProfileEnabled,
      landingHeroTitle: org.landingHeroTitle ?? "",
      landingHeroSubtitle: org.landingHeroSubtitle ?? "",
    },
    members: activity.members,
    // toActivityEntries maps rows 1:1 and in order, so index i is row i.
    activity: entries.map((e, i) => ({ ...e, id: activity.activities[i].id })),
  };
}

const landingInput = z.object({
  publicProfileEnabled: z.boolean().optional(),
  landingHeroTitle: z.string().nullable().optional(),
  landingHeroSubtitle: z.string().nullable().optional(),
  heroImageUrl: z.string().nullable().optional(),
  services: z.array(z.string()).optional(),
});

export async function updateLanding(raw: unknown) {
  const { organizationId, user } = await requireManager();
  await requirePage(organizationId, "company");
  const data = landingInput.parse(raw);
  await db.organization.update({
    where: { id: organizationId },
    data: {
      ...(data.publicProfileEnabled !== undefined && {
        publicProfileEnabled: data.publicProfileEnabled,
      }),
      ...(data.landingHeroTitle !== undefined && { landingHeroTitle: data.landingHeroTitle }),
      ...(data.landingHeroSubtitle !== undefined && {
        landingHeroSubtitle: data.landingHeroSubtitle,
      }),
      ...(data.heroImageUrl !== undefined && { heroImageUrl: data.heroImageUrl }),
      ...(data.services !== undefined && { servicesJson: JSON.stringify(data.services) }),
    },
  });
  // No public page reads these fields — /homeowner is the one homeowner page
  // and it is the same for every company — so only the editor is revalidated.
  revalidatePath("/dashboard/company/landing");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.SETTINGS,
    summary: "Updated public landing page settings",
    meta: { area: "landing page", publicProfileEnabled: data.publicProfileEnabled },
  });
}
