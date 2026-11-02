// Homeowner intake — the request becomes a HomeownerRequest and a PlatformLead,
// gets its trade, pin and scope, and is routed. Moved out of
// actions/homeowner.ts on 2026-10-03 so the admin's "Create test lead" runs the
// very same path (lib/leadCenter/testLeads) without the public form's brakes;
// the action keeps the rate limits and the address check in front of it.
//
// Plain server module (NOT "use server").
import { type LeadEstimate } from "@/lib/leadCenter/estimate";
import { writeLeadEstimate } from "@/lib/leadCenter/estimateStore";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { detectTrade, routeDecision, type DetectedTrade } from "@/lib/ai/detectTrade";
import { geocodeAddress } from "@/lib/maps";
import { startCascade } from "@/lib/leadCenter/cascade";
import { getRoutingMode, MANUAL_MODE_REASON } from "@/lib/leadCenter/routingMode";
import { TEST_QUEUE_REASON } from "@/lib/leadCenter/testLeads";
import { markSandboxLead } from "@/lib/leadCenter/sandbox";
import { writeProfessionalScope } from "@/lib/leadScope";
import { adoptLeads, findOrCreateHome, homePath, mayShowHomeKey } from "@/lib/home/portal";

export interface HomeownerIntake {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  projectType?: string;
  description: string;
  referralCode?: string;
  scope?: string;
}

// Reuse a prior geocode for the SAME address instead of paying Google again.
// Public-intake addresses are almost always unique, so this only saves the
// occasional duplicate submission — but a redundant paid call is cheap to avoid.
// Best-effort: only reuses when a real street line is present (a zip-only match
// could reuse a coarse/wrong pin) and a prior lead already has coordinates; any
// miss or error falls through to a live geocode. Matched on the street line and
// the ZIP — the city and the state on a stored lead are the geocoder's, not
// what was typed, so they cannot be part of the key. Exact match — case and
// whitespace variants won't dedup (that would need a normalized column, i.e. a
// schema change, which we're not making here).
type Geo = { lat: number; lng: number; city?: string | null; state?: string | null };
async function geocodeOrReuse(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<Geo | null> {
  const street = parts.address?.trim();
  if (street) {
    try {
      const prior = await db.platformLead.findFirst({
        where: {
          address: parts.address ?? null,
          zip: parts.zip ?? null,
          lat: { not: null },
          lng: { not: null },
        },
        select: { lat: true, lng: true, city: true, state: true },
        orderBy: { createdAt: "desc" },
      });
      if (prior?.lat != null && prior?.lng != null) {
        return { lat: prior.lat, lng: prior.lng, city: prior.city, state: prior.state };
      }
    } catch {
      // Reuse lookup is best-effort — fall through to a live geocode on any error.
    }
  }
  return geocodeAddress(parts);
}

// Public intake → Lead Center. A submission becomes a platform-owned
// PlatformLead that the cascade engine routes to the best-matching org (the
// org-scoped Lead row is created only when a contractor accepts). Everything
// after the two inserts is best-effort: AI, geocoding, matching, and email can
// all fail without losing the homeowner's request — the cron sweep re-drives
// leads stuck in MATCHING.
export interface IntakeOptions {
  isTest: boolean;
  /** A test-environment lead (lib/leadCenter/sandbox): with isTest, routed automatically among internal
   *  organizations, and every email and text on its path recorded instead of sent. */
  sandbox?: boolean;
  /** Submitted from the home dashboard: its key, and the plan it fulfils (lib/home/portal). */
  homeKey?: string | null;
  planId?: string | null;
  /** The browser's zone, kept on a new home for its reminders. */
  timezone?: string | null;
  /** Where the request was started ("seo:<work>:<city>"), kept on the LeadSource row. */
  source?: string | null;
  /** The TCPA consent the request was sent with (lib/leadConsent), kept on the LeadSource row. */
  consent?: { text: string; at: Date; ip: string | null; page: string | null } | null;
  /** The range the homeowner priced in the home portal and the whole estimate under it (lib/leadCenter/estimate). */
  estimate?: LeadEstimate | null;
  /** The trade the homeowner chose themselves (the /price flow is one trade): taken as read, no model asked, so the
   *  lead routes even when the detector is off — and the pin they confirmed on the map, kept over a fresh geocode.
   *  No pin (a house page without a map, 2026-10-28): the trade still stands and the address is geocoded as usual. */
  known?: { trade: DetectedTrade; lat?: number | null; lng?: number | null } | null;
}

export async function createHomeownerLead(data: HomeownerIntake, opts: IntakeOptions) {
  const req = await db.homeownerRequest.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone,
      address: data.address,
      zip: data.zip,
      projectType: data.projectType,
      description: data.description,
    },
  });

  // The description is the ONE trade source (owner, 2026-09-04) — the wizards
  // no longer carry a specialty picker. `projectType` stays accepted in the
  // schema for older clients but is only context, never the classification.
  const [detected, geo, scope] = await Promise.all([
    opts.known ? Promise.resolve(opts.known.trade) : detectTrade(`${data.projectType ?? ""}\n${data.description}`).catch(() => null),
    opts.known?.lat != null && opts.known?.lng != null
      ? Promise.resolve({ lat: opts.known.lat, lng: opts.known.lng, city: data.city ?? null, state: data.state ?? null })
      : geocodeOrReuse({
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
        }).catch(() => null),
    // The scope the homeowner approved in the wizard, else written now from
    // the words and the answers.
    data.scope && data.scope.length >= 20
      ? Promise.resolve(data.scope)
      : writeProfessionalScope({ description: data.description, address: data.address, projectType: data.projectType }),
  ]);

  const platformLead = await db.platformLead.create({
    data: {
      homeownerRequestId: req.id,
      // A test lead (lib/leadCenter/testLeads): never cascades, internal shops only.
      isTest: opts.isTest,
      // Capability token for the status page (/request/[token]): the link in
      // the confirmation email IS the authorization — same pattern as the
      // admin cookie's HMAC. 144 bits, URL-safe.
      accessToken: randomBytes(18).toString("base64url"),
      name: data.name,
      email: data.email,
      phone: data.phone,
      address: data.address,
      // The wizard asks for a street and a ZIP; the city and the state come
      // from the geocode of those (owner, 2026-10-02). What a caller sent
      // itself wins; a failed geocode leaves them empty and the request goes.
      city: data.city?.trim() || geo?.city || null,
      state: data.state?.trim() || geo?.state || null,
      zip: data.zip,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      projectType: data.projectType,
      description: data.description,
      // The scope a contractor prices from (lib/leadScope); null when the
      // model is off or failed, and the lead carries the homeowner's words.
      scope,
      detectedTrade: detected?.trade ?? null,
      aiConfidence: detected?.confidence ?? null,
    },
  });

  // The test environment's mark goes on first, before anything below can send a letter (lib/leadCenter/sandbox).
  // Without it the run would mail for real, so a failed mark stops here, loudly.
  const sandbox = opts.isTest && opts.sandbox === true;
  if (sandbox) await markSandboxLead(platformLead.id);

  // Where it was started (the cost guides) and the consent it was sent with
  // (2026-10-26): best-effort, like the rest after the two inserts — without
  // the table the request still goes, loudly, since the consent record is lost.
  if (opts.source || opts.consent) {
    const c = opts.consent;
    await db.leadSource
      .create({
        data: {
          platformLeadId: platformLead.id,
          source: opts.source ?? null,
          consentText: c?.text ?? null,
          consentAt: c?.at ?? null,
          consentIp: c?.ip ?? null,
          consentPage: c?.page ?? null,
        },
      })
      .catch((err: unknown) => {
        console.error("[homeowner] lead source and consent not kept — the request stands:", err);
      });
  }

  // The estimate the homeowner priced (2026-10-27): kept beside the lead for the Lead Center, the offer card and the
  // contractor who buys it. Best-effort — without it the request still goes, loudly.
  if (opts.estimate) {
    await writeLeadEstimate(platformLead.id, opts.estimate).catch((err: unknown) => {
      console.error("[homeowner] the lead's estimate not kept — the request stands:", err);
    });
  }

  // THE HOME DASHBOARD (2026-10-03): the request joins the home that carries
  // this email, or makes it. Older requests with the email join too. The key
  // is handed back on screen only to a first-timer (nothing older to see) or
  // to a request made from the dashboard itself; everyone else gets it by
  // email — the intake is public and the address may not be theirs.
  let homePathOut: string | null = null;
  let homeEmailed = false;
  try {
    const { home, isNew } = await findOrCreateHome({ ...data, timezone: opts.timezone ?? null });
    // This request joins first, so the adoption counts only OLDER ones.
    await db.platformLead.update({ where: { id: platformLead.id }, data: { homeId: home.id } });
    const older = await adoptLeads(home);
    const fromDashboard = Boolean(opts.homeKey) && opts.homeKey === home.accessToken;
    if (fromDashboard && opts.planId) {
      await db.homePlan.updateMany({ where: { id: opts.planId, homeId: home.id, status: "PLANNED" }, data: { status: "SUBMITTED", platformLeadId: platformLead.id } });
    }
    if (mayShowHomeKey({ isNew, older, fromDashboard })) homePathOut = homePath(home.accessToken);
    else homeEmailed = true;
  } catch (err) {
    console.warn("[homeowner] home dashboard link failed — the request stands:", err);
  }

  // Routing. Four gates, in order (the first since 2026-10-03):
  //   0. a test lead parks as TEST_LEAD (lib/leadCenter/testLeads);
  //   1. platform MANUAL mode parks everything (lib/leadCenter/routingMode);
  //   2. an unavailable or unsure detector parks THIS lead (routeDecision) —
  //      the request is never lost and never sent to a random trade, and the
  //      homeowner still gets the ordinary "request received";
  //   3. a confident classification starts the cascade as before.
  try {
    const decision = routeDecision(detected);
    if (sandbox) {
      // 0a. a test-environment lead takes the automatic path among internal organizations, whatever the mode —
      //     unless the detector could not say the trade, as for anyone.
      if (decision.route === "MANUAL_QUEUE") {
        await db.platformLead.update({
          where: { id: platformLead.id },
          data: { status: "MANUAL_QUEUE", queueReason: `${decision.queueReason}: ${decision.note}`.slice(0, 250) },
        });
      } else {
        await startCascade(platformLead.id);
      }
    } else if (opts.isTest) {
      // 0. a test lead never reaches the cascade, whatever the mode.
      await db.platformLead.update({
        where: { id: platformLead.id },
        data: { status: "MANUAL_QUEUE", queueReason: TEST_QUEUE_REASON },
      });
    } else if ((await getRoutingMode()) === "MANUAL") {
      await db.platformLead.update({
        where: { id: platformLead.id },
        data: { status: "MANUAL_QUEUE", queueReason: MANUAL_MODE_REASON },
      });
    } else if (decision.route === "MANUAL_QUEUE") {
      await db.platformLead.update({
        where: { id: platformLead.id },
        // queueReason is a free string column; the honest cause plus the
        // model's one-liner is what the admin placing it by hand needs.
        data: {
          status: "MANUAL_QUEUE",
          queueReason: `${decision.queueReason}: ${decision.note}`.slice(0, 250),
        },
      });
    } else {
      await startCascade(platformLead.id);
    }
  } catch (err) {
    console.warn("[homeowner] cascade failed — cron will re-drive:", err);
  }

  try {
    const { notifyHomeownerRequestReceived } = await import("@/lib/notify");
    await notifyHomeownerRequestReceived(platformLead.id);
  } catch (err) {
    console.warn("[homeowner] confirmation notify failed:", err);
  }

  // The platform admin hears about every real request (2026-10-03): in manual
  // mode a person places each one, so a person must know it arrived.
  if (!opts.isTest) {
    try {
      const { notifyAdminNewLeadRequest } = await import("@/lib/notify");
      await notifyAdminNewLeadRequest(platformLead.id);
    } catch (err) {
      console.warn("[homeowner] admin notify failed:", err);
    }
  }

  // Record referral conversion if a valid ref code accompanied the submission.
  // A test lead credits nobody.
  if (data.referralCode && !opts.isTest) {
    try {
      const { recordReferralConversion } = await import("@/lib/referralConversion");
      await recordReferralConversion(data.referralCode, data.email);
    } catch (err) {
      console.warn("[homeowner] referral tracking failed:", err);
    }
  }

  return {
    ok: true as const,
    platformLeadId: platformLead.id,
    /** The homeowner's status page — the wizard's Done screen links it. */
    statusPath: `/request/${platformLead.accessToken}`,
    /** The request's own token — the wizard's photos go into its folder with it (lib/home/freshRequest). */
    requestToken: platformLead.accessToken,
    /** The home dashboard, when it may be shown on screen (see above); else it went by email. */
    homePath: homePathOut,
    homeEmailed,
  };
}

