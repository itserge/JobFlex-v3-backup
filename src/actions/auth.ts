"use server";
import { after } from "next/server";
import { alertSignup } from "@/lib/adminAlerts";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ensureDefaultFollowUpRules } from "@/lib/followUps/defaults";
import { appBaseUrl } from "@/lib/appUrl";
import { slugify, uniqueOrgSlug } from "@/lib/orgSlug";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import { enforceRateLimit, clientIp, rateLimitShared, HOUR, MINUTE } from "@/lib/rateLimit";
import { requireOwner } from "@/lib/orgContext";
import { isPlaceholderOrgName } from "@/lib/orgSetup";
import { trackActivation } from "@/lib/activation-events";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { timezoneFor } from "@/lib/usTimezone";

// Public, unauthenticated auth actions: self-serve registration and the
// forgot/reset-password flow. These run BEFORE the caller has a session, so they
// authenticate only by what's in the request (email + password, or a reset
// token) — never by session/role.
//
// Security posture mirrors the hardened worker-invite flow:
//   • reset tokens are stored HASHED (sha256) — a DB leak yields no usable links
//   • tokens are single-use and expire after 1 hour
//   • requestPasswordReset never reveals whether an email exists (anti-enumeration)
//   • resetPassword returns ONE generic message for missing/expired/unknown so a
//     token can't be probed for its state

const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ── Register ─────────────────────────────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  businessName: z.string().trim().min(1, "Enter your business name").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    // Reserved for the platform-admin principal row (src/actions/adminAuth.ts).
    .refine((e) => !e.endsWith("@platform.jobflex.local"), "Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  // Lead Center matching profile — optional at signup (the dashboard banner
  // nags incomplete orgs); validated against the canonical trade taxonomy.
  companyAddress: z.string().trim().max(240).optional(),
  companyPhone: z.string().trim().max(40).optional(),
  tradeTypes: z.array(z.enum(TRADE_TYPES)).max(TRADE_TYPES.length).optional(),
  // The trade the closed taxonomy has no word for, typed under the "Other"
  // chip. Free text by definition, so it is length-capped and kept OUT of
  // tradeTypesJson — the matcher validates that column against TRADE_TYPES and
  // would drop anything it does not recognise.
  otherTrade: z.string().trim().max(80).optional(),
  // Captured promo/referral code from the signup pill. A claim, not proof —
  // bindAttributionToOrg re-validates it against the DB before linking anything.
  attribution: z
    .object({ kind: z.enum(["promo", "ref"]), code: z.string().trim().min(3).max(40) })
    .nullish(),
});

/**
 * Create a brand-new workspace: Organization + owner User (hashed password) +
 * OWNER Membership, atomically. Does NOT sign the user in — the client calls
 * next-auth's signIn afterward so redirect/error handling stays on the client.
 */
export async function registerAccount(raw: unknown): Promise<{ ok: true }> {
  // NO SUBSCRIPTION, NO ACCOUNT (owner's rule, actions/signupCheckout). This
  // action predates the paywall: it creates a workspace with no plan and no
  // checkout, and until 2026-09-11 the retired handheld register still called
  // it — one real contractor got a free account that way. The live register
  // goes through startPendingSignup → Stripe → completePendingSignup and never
  // calls this. It stays callable only when ALLOW_FREE_SIGNUP=true (local
  // dev / seeding); in production it refuses before touching anything.
  if (process.env.ALLOW_FREE_SIGNUP !== "true") {
    throw new Error("Accounts are created after a plan is chosen — please sign up at /auth/register.");
  }
  const data = registerSchema.parse(raw);
  await enforceRateLimit(`register:${await clientIp()}`, 5, HOUR, "sign-ups");
  if (isDisposableEmail(data.email)) throw new Error(DISPOSABLE_EMAIL_MESSAGE);

  // Registration legitimately can't hide that an email is taken (you can't make a
  // duplicate), so steer them to sign in rather than fail opaquely.
  const existing = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) {
    throw new Error("That email is already registered. Try signing in instead.");
  }

  const slug = await uniqueOrgSlug(slugify(data.businessName));
  const hashedPassword = await bcrypt.hash(data.password, 10);

  let userId: string;
  let orgId: string;
  try {
    const created = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: data.businessName,
          slug,
          billingEmail: data.email,
          address: data.companyAddress || null,
          phone: data.companyPhone || null,
          // The zone the address or the phone says (lib/usTimezone, 2026-11-07); the default otherwise.
          timezone: timezoneFor({ address: data.companyAddress, phone: data.companyPhone }) ?? undefined,
          tradeTypesJson: JSON.stringify(data.tradeTypes ?? []),
          // Only meaningful alongside the "Other" chip; ignored otherwise so a
          // label cannot outlive the selection that justified it.
          otherTrade:
            data.otherTrade && data.tradeTypes?.includes("Other") ? data.otherTrade : null,
        },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: {
          email: data.email,
          name: data.name,
          hashedPassword,
          activeOrgId: org.id,
        },
        select: { id: true },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: org.id, role: "OWNER" },
      });
      return { orgId: org.id, userId: user.id };
    });
    orgId = created.orgId;
    userId = created.userId;
  } catch (e: unknown) {
    // Unique-constraint race (e.g. the email was taken between the check above
    // and the insert). Map the email collision to the friendly message.
    const code = (e as { code?: string })?.code;
    const target = String((e as { meta?: { target?: unknown } })?.meta?.target ?? "");
    if (code === "P2002" && (target.includes("email") || target.toLowerCase().includes("user"))) {
      throw new Error("That email is already registered. Try signing in instead.");
    }
    if (code === "P2002") {
      throw new Error("Couldn't create your workspace — please try again.");
    }
    throw e;
  }

  // Follow-ups work from the first proposal sent (lib/followUps/defaults).
  // Never in the way of the account: /dashboard/crm writes them on the
  // first visit if this fails.
  await ensureDefaultFollowUpRules(orgId).catch((err) => console.warn("[register] follow-up defaults:", err));

  trackActivation("organization_created", orgId, { flow: "password" });
  // The team's "Sign-ups" alert texts (lib/adminAlerts) — after the response, never in the signup's way.
  after(async () => {
    await alertSignup({ orgName: data.businessName, flow: "password" }).catch((err) => console.warn("[adminAlerts] signup text:", err));
  });

  // Best-effort attribution bind — permanently links the new org to a captured
  // ?promo/?ref code (explicit pill value first, 30-day capture cookie as
  // fallback). A bad or missing code binds nothing; never blocks registration.
  try {
    const { bindAttributionToOrg, readAttributionCookie } = await import("@/lib/attribution");
    const attr =
      data.attribution ??
      (await readAttributionCookie().then((c) => (c ? { kind: c.k, code: c.c } : null)));
    if (attr) await bindAttributionToOrg(orgId, data.email, attr.kind, attr.code);
  } catch {
    /* non-fatal */
  }

  // Best-effort activity stamp — never block account creation on the feed.
  try {
    await db.activityEvent.create({
      data: {
        organizationId: orgId,
        actorId: userId,
        kind: "CREATED",
        summary: `${data.name} created the ${data.businessName} workspace`,
      },
    });
  } catch {
    /* non-fatal */
  }

  // Best-effort geocode so the org is eligible for Lead Center offers from day
  // one. Failure (or no GOOGLE_MAPS_SERVER_KEY) just leaves lat/lng null — the
  // company profile save re-geocodes later.
  if (data.companyAddress) {
    try {
      const { geocodeAddress } = await import("@/lib/maps");
      const geo = await geocodeAddress({ address: data.companyAddress });
      if (geo) {
        await db.organization.update({
          where: { id: orgId },
          data: { lat: geo.lat, lng: geo.lng, geocodedAt: new Date() },
        });
      }
    } catch {
      /* non-fatal */
    }
  }

  return { ok: true };
}

/**
 * Is this email free to register? Answered BEFORE the signup form's second step
 * so a duplicate address is reported while the user is still looking at the
 * field that caused it, instead of after they have filled in their company and
 * pressed Create account — which is what happened until 2026-08-18.
 *
 * ENUMERATION. This does disclose whether an address has an account, and that is
 * deliberate here: `registerAccount` already discloses exactly the same fact one
 * step later (a duplicate simply cannot be created), so this moves a disclosure
 * that already exists rather than opening a new one. The RESET flow is the one
 * that must stay silent, and it still is — see requestPasswordReset below.
 */
export async function checkEmailAvailable(
  raw: unknown,
): Promise<{ available: boolean; message?: string }> {
  const parsed = registerSchema.shape.email.safeParse(raw);
  const gate = await rateLimitShared(`email-check:${await clientIp()}`, 30, MINUTE);
  if (!gate.ok) return { available: false, message: "Too many checks — try again in a minute." };
  if (!parsed.success) {
    return { available: false, message: "Enter a valid email address." };
  }
  // A throwaway inbox is refused here, on step 1, before anything else is
  // asked (lib/disposableEmail; startPendingSignup refuses it again).
  if (isDisposableEmail(parsed.data)) return { available: false, message: DISPOSABLE_EMAIL_MESSAGE };
  const existing = await db.user.findUnique({
    where: { email: parsed.data },
    select: { id: true, hashedPassword: true },
  });
  if (!existing) return { available: true };
  // A row with no password hash was provisioned by a first Google sign-in (see
  // the `signIn` callback in src/lib/auth.ts), not by anyone filling in this
  // form. Telling those people to "sign in instead" sends them to a password
  // field they have never set — so name the door they actually came through.
  return existing.hashedPassword
    ? { available: false, message: "That email is already registered. Try signing in instead." }
    : {
        available: false,
        message: "That email already signs in with Google. Use Continue with Google below.",
      };
}

// ── Forgot password (request a reset link) ───────────────────────────────────
const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/**
 * Mint a single-use reset token and email it. ALWAYS resolves the same way
 * whether or not the email maps to an account, so this endpoint can't be used to
 * enumerate which emails are registered.
 */
export async function requestPasswordReset(raw: unknown): Promise<{ ok: true }> {
  const parsed = forgotSchema.safeParse(raw);
  if (!parsed.success) return { ok: true }; // bad input → same generic success
  const email = parsed.data.email;
  // Per-email cooldown + per-IP cap. Both answer the same generic success as
  // a miss would, so the limiter is not itself an enumeration oracle.
  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([
    rateLimitShared(`reset:ip:${ip}`, 10, HOUR),
    rateLimitShared(`reset:email:${email}`, 3, HOUR),
  ]);
  if (!byIp.ok || !byEmail.ok) return { ok: true };

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (user) {
    // Invalidate any prior links for this email, then mint one fresh token.
    // Only the sha256 hash is stored; the raw token lives only in the email.
    await db.verificationToken.deleteMany({ where: { identifier: email } });
    const rawToken = randomBytes(32).toString("hex");
    await db.verificationToken.create({
      data: {
        identifier: email,
        token: sha256(rawToken),
        expires: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    try {
      const { sendEmail } = await import("@/lib/sdk/resend");
      const { renderEmail } = await import("@/lib/email/renderEmail");
      const { buildPasswordReset } = await import("@/lib/email/build/platform");
      const link = `${await appBaseUrl()}/auth/reset?token=${rawToken}`;
      const { subject, html } = renderEmail(buildPasswordReset({ name: user.name, href: link }));
      // sendEmail retries transient provider failures internally (emailRetry.ts).
      await sendEmail({ to: email, subject, html });
    } catch (err) {
      // SECURITY: never leak send failures to the caller — the response stays the
      // same generic { ok: true } whether or not the account exists, so this can't
      // be used to enumerate registered emails. Log at error level so an operator
      // can see a reset link that failed to send even after retries.
      console.error("[requestPasswordReset] reset email failed after retries:", err);
    }
  }

  return { ok: true };
}

// ── Reset password (consume the token) ───────────────────────────────────────
const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const INVALID_LINK = "This reset link is invalid or has expired. Request a new one.";

/**
 * Validate a reset token and set a new password. One generic error for every
 * failure mode (missing / expired / no matching user) so a token can't be probed.
 * The token is single-use: it and any siblings for the email are deleted on use.
 */
export async function resetPassword(raw: unknown): Promise<{ ok: true }> {
  const data = resetSchema.parse(raw);
  await enforceRateLimit(`reset-submit:${await clientIp()}`, 10, HOUR, "attempts");
  const tokenHash = sha256(data.token);
  // Hash the new password BEFORE the transaction so the bcrypt cost (slow, CPU)
  // never holds the DB transaction open.
  const hashedPassword = await bcrypt.hash(data.password, 10);

  // Validate the token, write the new password, and burn the token atomically so
  // a concurrent reset/request can't interleave (no partial state, no replay).
  const actor = await db.$transaction(async (tx) => {
    const record = await tx.verificationToken.findUnique({ where: { token: tokenHash } });
    if (!record || record.expires < new Date()) throw new Error(INVALID_LINK);

    const user = await tx.user.findUnique({
      where: { email: record.identifier },
      select: { id: true, activeOrgId: true },
    });
    if (!user) throw new Error(INVALID_LINK);

    // Resolve activeOrgId so the next sign-in builds a valid session. Workers
    // created via invite may have activeOrgId = null if they never completed the
    // accept flow — look up their membership as a fallback so the JWT callback
    // always has an org to attach to.
    let resolvedOrgId = user.activeOrgId;
    if (!resolvedOrgId) {
      const m = await tx.membership.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: { organizationId: true },
      });
      resolvedOrgId = m?.organizationId ?? null;
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        hashedPassword,
        // Bump the credential epoch so any session issued before this reset is
        // rejected on its next guarded request — evicts a stolen/stale session.
        credentialVersion: { increment: 1 },
        ...(resolvedOrgId ? { activeOrgId: resolvedOrgId } : {}),
      },
    });
    // Single-use: burn this token and any other live links for the same email.
    await tx.verificationToken.deleteMany({ where: { identifier: record.identifier } });
    return { userId: user.id, activeOrgId: resolvedOrgId };
  });

  // Best-effort audit trail so a password reset is never silent (org-scoped).
  if (actor.activeOrgId) {
    try {
      await db.activityEvent.create({
        data: {
          organizationId: actor.activeOrgId,
          actorId: actor.userId,
          kind: "PASSWORD_RESET",
          summary: "Password was reset via email link",
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  return { ok: true };
}


/* ───────────────────── Google signup — the company step ───────────────────── */

const companySetupSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required.").max(160),
  companyAddress: z.string().trim().min(1, "Company address is required.").max(300),
  companyPhone: z.string().trim().max(40).optional(),
  /** The signed-in person's own phone (Google gives us none). */
  phone: z.string().trim().max(40).optional(),
  tradeTypes: z.array(z.enum(TRADE_TYPES)).min(1, "Pick at least one trade."),
  otherTrade: z.string().trim().max(80).optional(),
});

/**
 * Step 2 for a Google signup. The auth callback provisioned a placeholder
 * org ("Jamie's workspace") so the person was never org-less; this fills in
 * what registerAccount would have written on a password signup — name,
 * address, phone, trades — on that same org. Owner-only, and idempotent: a
 * second submit just updates.
 */
export async function completeCompanySetup(raw: unknown): Promise<{ ok: true }> {
  const ctx = await requireOwner();
  const data = companySetupSchema.parse(raw);
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) throw new Error("Not found");

  const renamed = data.businessName !== org.name;
  const slug =
    renamed && isPlaceholderOrgName(org.name)
      ? await uniqueOrgSlug(slugify(data.businessName))
      : org.slug;

  await db.organization.update({
    where: { id: org.id },
    data: {
      name: data.businessName,
      slug,
      address: data.companyAddress,
      phone: data.companyPhone || null,
      tradeTypesJson: JSON.stringify(data.tradeTypes),
      otherTrade: data.otherTrade && data.tradeTypes.includes("Other") ? data.otherTrade : null,
    },
  });
  if (data.phone !== undefined) {
    await db.user.update({ where: { id: ctx.user.id }, data: { phone: data.phone || null } });
  }

  try {
    await db.activityEvent.create({
      data: {
        organizationId: org.id,
        actorId: ctx.user.id,
        kind: "CREATED",
        summary: `${ctx.user.name ?? ctx.user.email ?? "Owner"} set up the ${data.businessName} workspace`,
      },
    });
  } catch {
    /* non-fatal */
  }
  try {
    const { geocodeAddress } = await import("@/lib/maps");
    const geo = await geocodeAddress({ address: data.companyAddress });
    if (geo) {
      await db.organization.update({
        where: { id: org.id },
        data: { lat: geo.lat, lng: geo.lng, geocodedAt: new Date() },
      });
    }
  } catch {
    /* non-fatal */
  }
  return { ok: true };
}
