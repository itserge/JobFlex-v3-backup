// WHETHER THE OUTSIDE SERVICES ARE ANSWERING — one report, read from the
// admin overview, refreshed nightly and on demand.
//
// WHY THIS EXISTS. lib/sdk/integrations.ts answers one question honestly and
// only one: are the env keys present. That is not health. A ReportAll
// allowance can run dry, an EagleView pack can be denied, a Regrid token
// expires every thirty days and an OPENAI_MODEL can name a model the key's
// project may not call — and every one of those looks exactly like "enabled"
// until a contractor hits it mid-estimate. This module asks the cheapest
// question that distinguishes them, and writes the answer down.
//
// THE RULE EVERY CHECK OBEYS: no check may spend money. Two of them speak to a
// network at all, and both are free endpoints — OpenAI's models.retrieve
// (metadata, no tokens) and SerpAPI's /account (plan info, not a search).
// Everything else reads state this deployment already has: the quota header
// ReportAll answers with, the entitlement rows EagleView probes wrote, the
// last status Regrid returned, the last successful send of each transport.
//
// The report lives in SyncState under HEALTH_KEY, so the overview renders the
// last known answer instantly and nothing is checked on page load.

import { db } from "@/lib/db";
import { readOverpassDay } from "@/lib/overpassStore";
import { QUOTA_KEY as PARCEL_QUOTA_KEY, QUOTA_FLOOR } from "@/lib/parcelLookup";
import { QUOTA_ALLTIME } from "@/lib/reportall";
import { isReportAllEnabled } from "@/lib/reportall";
import { isRegridEnabled } from "@/lib/parcel";
import { isEagleViewEnabled } from "@/lib/eagleview";
import { isOpenAIEnabled, getOpenAI, getOpenAIModel } from "@/lib/sdk/openai";
import { isResendEnabled, isEmailEnabled } from "@/lib/sdk/resend";
import { isSmtpEnabled } from "@/lib/sdk/smtp";
import { emailDaySummary } from "@/lib/emailLog";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { isSquareEnabled, isSquareWebhookConfigured } from "@/lib/sdk/square";
import { isGmailOAuthConfigured } from "@/lib/sdk/gmail";
import { isSecretBoxConfigured } from "@/lib/crypto/secretBox";

/** Where the report is kept, and the keys the checks read. */
export const HEALTH_KEY = "integrations:health";
const ALERT_KEY = "integrations:health-alerted";
/** Written by lib/parcel on every Regrid answer; see REGRID_STATUS_KEY there. */
export const REGRID_STATUS_KEY = "regrid:last-status";
/** Written by the mail and SMS transports on every successful send. */
export const EMAIL_SENT_KEY = "email:last-sent";
export const SMS_SENT_KEY = "sms:last-sent";

/** `off` is not a failure: the service is not configured in this environment
 *  and nothing depends on it here. It is reported, never alerted on. */
export type HealthLevel = "ok" | "degraded" | "down" | "off";

export interface ServiceHealth {
  key: string;
  name: string;
  level: HealthLevel;
  /** One line, the shortest true statement of what the check found. */
  reason: string;
  /**
   * NOT LOAD-BEARING. A service nothing waits on: its level is reported as
   * found, but it is counted apart in the verdict and never wakes anybody at
   * 04:40. Regrid is the case this exists for — since the roof measurement
   * took its lot boundary from ParcelCache/ReportAll (lib/lotRing), Regrid is
   * asked only when ReportAll says a point has no parcel at all, so an expired
   * token is a job for this week, not an outage. Calling it one would teach
   * everyone to ignore the panel.
   */
  optional?: boolean;
  /** What the tag beside the name says, when there is one. */
  note?: string;
  /** When the state behind `reason` was established (a quota header's date, a
   *  last send), when that is older than the check itself. */
  asOf?: string;
  checkedAt: string;
}

export interface HealthReport {
  ranAt: string;
  /** How long the whole sweep took, so a slow service is visible as slow. */
  tookMs: number;
  worst: HealthLevel;
  services: ServiceHealth[];
}

const RANK: Record<HealthLevel, number> = { ok: 0, off: 1, degraded: 2, down: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The allowance is stale after this long without a call refreshing it. */
const QUOTA_STALE_DAYS = 7;
/** A transport that has not sent anything in this long is worth a second look. */
const SEND_QUIET_DAYS = 30;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const ago = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
};

async function readState(key: string) {
  return db.syncState.findUnique({ where: { key } }).catch(() => null);
}

/* ── OpenAI ────────────────────────────────────────────────────────────────
   models.retrieve on the model the environment names. Free: it returns the
   model's metadata, not a completion. A 403 or 404 here is the failure that
   used to surface as a broken estimator, so it is reported with the name. */
async function checkOpenAI(now: string): Promise<ServiceHealth> {
  const base = { key: "openai", name: "OpenAI", checkedAt: now };
  if (!isOpenAIEnabled()) return { ...base, level: "off", reason: "OPENAI_API_KEY is not set" };
  const model = getOpenAIModel();
  try {
    await getOpenAI().models.retrieve(model);
    return { ...base, level: "ok", reason: `${model} available` };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const code = (err as { code?: string })?.code;
    if (status === 403 || status === 404 || code === "model_not_found") {
      return { ...base, level: "down", reason: `this project may not call ${model} (${status ?? "403"})` };
    }
    if (status === 401) return { ...base, level: "down", reason: "the key was rejected (401)" };
    return { ...base, level: "degraded", reason: `could not verify ${model}${status ? ` (${status})` : ""}` };
  }
}

/* ── SerpAPI ───────────────────────────────────────────────────────────────
   /account, which reports the plan and what is left on it. It is not a search
   and costs nothing; a search would. */
async function checkSerpApi(now: string): Promise<ServiceHealth> {
  const base = { key: "serpapi", name: "SerpAPI", checkedAt: now };
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return { ...base, level: "off", reason: "SERPAPI_API_KEY is not set" };
  try {
    const res = await fetch(`https://serpapi.com/account?api_key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { ...base, level: "down", reason: `the key was rejected (${res.status})` };
    }
    if (!res.ok) return { ...base, level: "degraded", reason: `account endpoint answered ${res.status}` };
    const acct = (await res.json()) as {
      plan_name?: string;
      total_searches_left?: number;
      plan_searches_left?: number;
      this_month_usage?: number;
    };
    const left = acct.total_searches_left ?? acct.plan_searches_left;
    if (typeof left !== "number") return { ...base, level: "degraded", reason: "account answered without a balance" };
    const plan = acct.plan_name ? `${acct.plan_name}, ` : "";
    if (left <= 0) return { ...base, level: "down", reason: `${plan}no searches left` };
    if (left < 100) return { ...base, level: "degraded", reason: `${plan}${left} searches left` };
    return { ...base, level: "ok", reason: `${plan}${left} searches left` };
  } catch (err) {
    return { ...base, level: "degraded", reason: `account endpoint unreachable: ${short(err)}` };
  }
}

/* ── ReportAll ─────────────────────────────────────────────────────────────
   Read, never asked: the allowance is ALLTIME and the only statement of it is
   the header every parcel lookup answers with, which lib/reportall writes to
   SyncState. Asking for the figure would spend one of the lookups it counts. */
async function checkReportAll(now: string): Promise<ServiceHealth> {
  const base = { key: "reportall", name: "ReportAll", checkedAt: now };
  if (!isReportAllEnabled()) return { ...base, level: "off", reason: "REPORTALL_CLIENT_KEY is not set" };
  const row = await readState(PARCEL_QUOTA_KEY);
  if (!row) return { ...base, level: "degraded", reason: "no lookup has answered on this deployment yet" };
  const left = Number(row.cursor);
  const stale = Date.now() - row.updatedAt.getTime() > QUOTA_STALE_DAYS * DAY_MS;
  const asOf = iso(row.updatedAt);
  const read = `${Number.isFinite(left) ? left : "?"} of ${QUOTA_ALLTIME} lookups left, read ${ago(row.updatedAt)}`;
  if (Number.isFinite(left) && left < QUOTA_FLOOR) {
    return { ...base, level: "down", asOf, reason: `${read} — below the ${QUOTA_FLOOR} reserve, lookups are paused` };
  }
  if (Number.isFinite(left) && left < 300) return { ...base, level: "degraded", asOf, reason: read };
  if (stale) return { ...base, level: "degraded", asOf, reason: `${read} — the figure is a memory, not a reading` };
  return { ...base, level: "ok", asOf, reason: read };
}

/* ── EagleView ─────────────────────────────────────────────────────────────
   The entitlement table is the verdict of probes that were already paid for;
   reading it costs nothing and asking again would cost a report. */
async function checkEagleView(now: string): Promise<ServiceHealth> {
  const base = { key: "eagleview", name: "EagleView", checkedAt: now };
  if (!isEagleViewEnabled()) return { ...base, level: "off", reason: "EagleView credentials are not set" };
  const rows = await db.eagleViewEntitlement.findMany().catch(() => []);
  if (!rows.length) return { ...base, level: "degraded", reason: "no pack has been probed yet" };
  const live = rows.filter((r) => r.status === "live").length;
  const denied = rows.filter((r) => r.status === "denied").length;
  const last = rows.reduce((a, r) => (r.checkedAt > a ? r.checkedAt : a), rows[0].checkedAt);
  const read = `${live} live, ${denied} denied · last verdict ${ago(last)}`;
  const asOf = iso(last);
  if (live === 0) return { ...base, level: "down", asOf, reason: `${read} — nothing is entitled` };
  if (denied > 0) return { ...base, level: "degraded", asOf, reason: read };
  return { ...base, level: "ok", asOf, reason: read };
}

/* ── Regrid ────────────────────────────────────────────────────────────────
   The last status a Regrid call came back with, written by lib/parcel. Its
   tokens are 30-day JWTs, so a working integration expires on a schedule and
   the failure looks like "this address has no parcel" unless somebody says
   otherwise. Nothing is called here. */
async function checkRegrid(now: string): Promise<ServiceHealth> {
  const base = {
    key: "regrid",
    name: "Regrid",
    checkedAt: now,
    optional: true,
    note: "optional · last-resort fallback",
  };
  if (!isRegridEnabled()) return { ...base, level: "off", reason: "REGRID_API_KEY is not set" };
  const row = await readState(REGRID_STATUS_KEY);
  if (!row) return { ...base, level: "degraded", reason: "no call has been made on this deployment yet" };
  const status = Number(row.cursor);
  const asOf = iso(row.updatedAt);
  const when = ago(row.updatedAt);
  if (status === 401 || status === 403) {
    return { ...base, level: "down", asOf, reason: `token rejected (${status}) ${when} — Regrid issues 30-day JWTs` };
  }
  if (status === 200) return { ...base, level: "ok", asOf, reason: `last answer 200, ${when}` };
  return { ...base, level: "degraded", asOf, reason: `last answer ${row.cursor}, ${when}` };
}

/* ── Overpass (OpenStreetMap) ──────────────────────────────────────────────
   House footprints and street centrelines for the fence studio. Free, public,
   and flaky by nature — so the row is the share of OUR OWN lookups that got an
   answer in the last 24 hours (lib/overpassStore writes one tally per lookup).
   Nothing is called here. Optional: without it the contractor traces the house
   by hand, and nothing is priced off it. */
async function checkOverpass(now: string): Promise<ServiceHealth> {
  const base = { key: "overpass", name: "Overpass (OSM)", checkedAt: now, optional: true, note: "optional · house outlines" };
  const day = await readOverpassDay();
  const total = day.ok + day.failed;
  if (!total) return { ...base, level: "off", reason: "no lookups in the last 24 hours" };
  const share = Math.round((day.ok / total) * 100);
  const asOf = iso(day.lastAt);
  const via = day.viaFallback ? `, ${day.viaFallback} via the second host` : "";
  const reason = `${share}% answered in 24 h — ${day.ok} of ${total}${via}`;
  if (share >= 80) return { ...base, level: "ok", asOf, reason };
  if (share >= 40) return { ...base, level: "degraded", asOf, reason };
  return { ...base, level: "down", asOf, reason };
}

/* ── Mail ──────────────────────────────────────────────────────────────────
   Which transport is configured, and when one of them last got something out.
   Nothing is sent: a health check that emails to prove email works would put a
   message in somebody's inbox every night. */
async function checkMail(now: string): Promise<ServiceHealth> {
  const base = { key: "email", name: "Email", checkedAt: now };
  const transport = isResendEnabled() ? "Resend" : isSmtpEnabled() ? "SMTP" : null;
  if (!isEmailEnabled() || !transport) {
    return { ...base, level: "off", reason: "neither RESEND_API_KEY nor the SMTP_* block is set" };
  }
  const row = await readState(EMAIL_SENT_KEY);
  if (!row) return { ...base, level: "degraded", reason: `${transport} configured — nothing sent yet` };
  const quiet = Date.now() - row.updatedAt.getTime() > SEND_QUIET_DAYS * DAY_MS;
  const asOf = iso(row.updatedAt);
  // The mail log (lib/emailLog, 2026-10-21): today against the box's daily
  // limit, and the newest failure when it came in the last day. Near the
  // limit is degraded, never down — the nightly alert is itself an email. One
  // failure (a mistyped address) is reported, not degraded; three in a day are.
  const day = await emailDaySummary();
  const today = day ? ` · ${day.sent}/${day.limit} today` : "";
  const recentFail = day?.lastFailure && Date.now() - Date.parse(day.lastFailure.at) < DAY_MS ? day.lastFailure : null;
  const failNote = recentFail ? ` · last failure ${new Date(recentFail.at).toISOString().slice(11, 16)} UTC: ${(recentFail.error ?? "unknown error").slice(0, 80)}` : "";
  const nearLimit = day ? day.sent * 100 >= 80 * day.limit : false;
  const read = `${transport} · last sent ${ago(row.updatedAt)}${today}${failNote}`;
  const level: HealthLevel = quiet || nearLimit || (day?.failed ?? 0) >= 3 ? "degraded" : "ok";
  return { ...base, level, asOf, reason: quiet ? `${read} — quiet for a month` : nearLimit ? `${read} — near the daily limit` : read };
}

/* ── Twilio ────────────────────────────────────────────────────────────────
   Same shape, same reason for not sending anything. */
async function checkTwilio(now: string): Promise<ServiceHealth> {
  const base = { key: "twilio", name: "Twilio", checkedAt: now };
  if (!await isTwilioEnabled()) return { ...base, level: "off", reason: "TWILIO_* is not set" };
  const row = await readState(SMS_SENT_KEY);
  if (!row) return { ...base, level: "degraded", reason: "configured — nothing sent yet" };
  const quiet = Date.now() - row.updatedAt.getTime() > SEND_QUIET_DAYS * DAY_MS;
  const asOf = iso(row.updatedAt);
  const read = `last sent ${ago(row.updatedAt)}`;
  return { ...base, level: quiet ? "degraded" : "ok", asOf, reason: quiet ? `${read} — quiet for a month` : read };
}

/* ── The contractor-facing joins (2026-09-20) ──────────────────────────────
   None of these is load-bearing for an estimate, so all four are optional:
   reported on the panel, never in the night's alert. Nothing is called —
   each reads the environment and the rows this deployment already has. */

/** Stripe Connect: the platform key, a client id and a Connect webhook secret,
 *  per mode. Without the client id a contractor can still paste a key (that
 *  needs only the secret box). */
async function checkStripeConnect(now: string): Promise<ServiceHealth> {
  const base = { key: "stripe-connect", name: "Stripe Connect", checkedAt: now, optional: true, note: "optional · contractor payments" };
  if (!isStripeEnabled()) return { ...base, level: "off", reason: "STRIPE_SECRET_KEY is not set" };
  const modes = (["live", "test"] as const).filter((m) =>
    m === "live" ? Boolean(process.env.STRIPE_CONNECT_CLIENT_ID) : Boolean(process.env.STRIPE_CONNECT_CLIENT_ID_TEST),
  );
  const box = isSecretBoxConfigured();
  if (modes.length === 0) {
    return {
      ...base,
      level: box ? "degraded" : "off",
      reason: box
        ? "no STRIPE_CONNECT_CLIENT_ID — OAuth joins are off; pasted keys work"
        : "STRIPE_CONNECT_CLIENT_ID and TOKEN_ENCRYPTION_KEY not set — no way to connect an account",
    };
  }
  const missingSecret = modes.filter((m) =>
    m === "live" ? !process.env.STRIPE_CONNECT_WEBHOOK_SECRET : !process.env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST,
  );
  if (missingSecret.length) {
    return {
      ...base,
      level: "degraded",
      reason: `client id set (${modes.join(", ")}) but no Connect webhook secret for ${missingSecret.join(", ")} — payments confirm only on return and by the reconcile cron`,
    };
  }
  return { ...base, level: "ok", reason: `client id + Connect webhook secret set (${modes.join(", ")})${box ? "" : " · pasted keys off: no TOKEN_ENCRYPTION_KEY"}` };
}

/** Square: the platform app for OAuth joins and its webhook signature key. A
 *  pasted access token needs only the secret box. */
async function checkSquareApp(now: string): Promise<ServiceHealth> {
  const base = { key: "square-app", name: "Square", checkedAt: now, optional: true, note: "optional · contractor payments" };
  const box = isSecretBoxConfigured();
  if (!isSquareEnabled()) {
    return {
      ...base,
      level: box ? "degraded" : "off",
      reason: box
        ? "SQUARE_APPLICATION_ID/SECRET not set — OAuth joins off; pasted tokens work"
        : "SQUARE_APPLICATION_ID/SECRET and TOKEN_ENCRYPTION_KEY not set",
    };
  }
  if (!isSquareWebhookConfigured()) {
    return { ...base, level: "degraded", reason: `app credentials set (${process.env.SQUARE_ENV === "production" ? "production" : "sandbox"}) but SQUARE_WEBHOOK_SIGNATURE_KEY is not — payments confirm only on return and by the reconcile cron` };
  }
  return { ...base, level: "ok", reason: `app credentials + webhook signature key set (${process.env.SQUARE_ENV === "production" ? "production" : "sandbox"})${box ? "" : " · pasted tokens off: no TOKEN_ENCRYPTION_KEY"}` };
}

/** Gmail OAuth: the client is configured, who may use it, and how many orgs
 *  hold a grant or lost one. */
async function checkGmailOAuth(now: string): Promise<ServiceHealth> {
  const base = { key: "gmail-oauth", name: "Gmail OAuth", checkedAt: now, optional: true, note: "optional · send from own address" };
  if (!isGmailOAuthConfigured()) return { ...base, level: "off", reason: "GMAIL_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI not set" };
  const [connected, revoked] = await Promise.all([
    db.organization.count({ where: { gmailTokensJson: { not: null } } }).catch(() => 0),
    db.organization.count({ where: { gmailTokensJson: null, gmailSettingsJson: { contains: '"revokedAt":"20' } } }).catch(() => 0),
  ]);
  const audience =
    process.env.GMAIL_OAUTH_PUBLIC === "true"
      ? "open to everyone (app verified)"
      : `Testing — ${(process.env.GMAIL_OAUTH_TEST_USERS ?? "").split(",").filter((e) => e.trim()).length} allow-listed user(s)`;
  const grants = `${connected} org(s) connected, ${revoked} revoked by Google`;
  if (!isSecretBoxConfigured()) return { ...base, level: "down", reason: `configured but TOKEN_ENCRYPTION_KEY is not set — grants cannot be stored · ${grants}` };
  return { ...base, level: revoked > 0 ? "degraded" : "ok", reason: `${audience} · ${grants}` };
}

/** Contractor processor rows that need a human: REVOKED (the provider removed
 *  the app) or RESTRICTED (charges paused). */
async function checkPaymentConnections(now: string): Promise<ServiceHealth> {
  const base = { key: "payment-connections", name: "Processor links", checkedAt: now, optional: true, note: "optional · contractor payments" };
  const rows = await db.paymentConnection.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []);
  const count = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
  const active = count("ACTIVE");
  const restricted = count("RESTRICTED");
  const revoked = count("REVOKED");
  if (active + restricted + revoked === 0) return { ...base, level: "ok", reason: "no contractor has connected a processor yet" };
  const read = `${active} active · ${restricted} restricted · ${revoked} revoked`;
  return { ...base, level: restricted + revoked > 0 ? "degraded" : "ok", reason: restricted + revoked > 0 ? `${read} — the owners were told; nothing to do platform-side` : read };
}

/**
 * Partner payouts — the two states that need a person, and only those.
 *
 *   · a request nobody has decided on for more than 7 days. The queue at
 *     /admin/payouts has no timer on it, so a request approved late is
 *     indistinguishable from one approved on time until the partner writes in.
 *   · a transfer that FAILED or was REVERSED. runApprovedPayouts writes the
 *     failure onto the row and moves on; nothing has ever read it back.
 *
 * NOT a Stripe call — both are our own rows. Optional, because neither stops an
 * estimate: this is money owed to a partner, which is this week's job, not an
 * outage, and calling it one teaches everyone to ignore the panel.
 */
const PAYOUT_STALE_DAYS = 7;

/** Exported so scripts/qa can assert it without running the whole sweep — that
 *  one does reach OpenAI and SerpAPI, and a check must never spend money. */
export async function checkInfluencerPayouts(now: string): Promise<ServiceHealth> {
  const base = {
    key: "influencer-payouts",
    name: "Influencer payouts",
    checkedAt: now,
    optional: true,
    note: "optional · partner commission",
  };
  const staleBefore = new Date(Date.now() - PAYOUT_STALE_DAYS * 86_400_000);
  // runApprovedPayouts stops retrying an unknown transfer outcome after 20 hours
  // (Stripe keeps an idempotency key for ~24), because a retry past that could
  // pay twice. From then on only a person can settle it, by looking the transfer
  // up in the Stripe dashboard — so this is the one line here that is URGENT.
  const unconfirmedBefore = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const unconfirmed = await db.payoutTransfer
    .count({ where: { status: "PENDING", stripeTransferId: null, createdAt: { lt: unconfirmedBefore } } })
    .catch(() => 0);
  // A reversed transfer that nobody has decided on (Retry payout / Write off),
  // and a partial reversal, which the code deliberately does not guess at.
  const [reversedAwaiting, partialReversals] = await Promise.all([
    db.payoutRequest.count({ where: { status: "REVERSED" } }).catch(() => 0),
    db.payoutTransfer
      .count({ where: { failureReason: { startsWith: "Partially reversed" } } })
      .catch(() => 0),
  ]);
  const [pending, stale, failedTransfers, stuck] = await Promise.all([
    db.payoutRequest.count({ where: { status: "PENDING" } }).catch(() => 0),
    db.payoutRequest.count({ where: { status: "PENDING", createdAt: { lt: staleBefore } } }).catch(() => 0),
    db.payoutTransfer.count({ where: { status: "FAILED" } }).catch(() => 0),
    // Approved but never sent: the cron could not pay it (no Connect account,
    // no cleared balance) or died mid-run and left it in PROCESSING.
    db.payoutRequest.count({ where: { status: { in: ["APPROVED", "PROCESSING"] }, createdAt: { lt: staleBefore } } }).catch(() => 0),
  ]);

  if (pending + stale + failedTransfers + stuck + unconfirmed + reversedAwaiting + partialReversals === 0) {
    return { ...base, level: "ok", reason: "nothing waiting, no failed transfers" };
  }
  const parts: string[] = [];
  // First, because it is the only one with a clock on it.
  if (unconfirmed > 0) {
    parts.push(`${unconfirmed} transfer${unconfirmed === 1 ? "" : "s"} unconfirmed with Stripe — look ${unconfirmed === 1 ? "it" : "them"} up in the dashboard before re-sending`);
  }
  if (stale > 0) parts.push(`${stale} request${stale === 1 ? "" : "s"} undecided for over ${PAYOUT_STALE_DAYS} days`);
  else if (pending > 0) parts.push(`${pending} request${pending === 1 ? "" : "s"} waiting for review`);
  if (stuck > 0) parts.push(`${stuck} approved but still unsent after ${PAYOUT_STALE_DAYS} days`);
  if (failedTransfers > 0) parts.push(`${failedTransfers} failed transfer${failedTransfers === 1 ? "" : "s"}`);
  if (reversedAwaiting > 0) {
    parts.push(`${reversedAwaiting} reversed transfer${reversedAwaiting === 1 ? "" : "s"} awaiting Retry payout or Write off`);
  }
  if (partialReversals > 0) {
    parts.push(`${partialReversals} partially reversed transfer${partialReversals === 1 ? "" : "s"} to settle by hand`);
  }
  const needsSomeone =
    unconfirmed > 0 || stale > 0 || stuck > 0 || failedTransfers > 0 || reversedAwaiting > 0 || partialReversals > 0;
  return {
    ...base,
    level: needsSomeone ? "degraded" : "ok",
    reason: needsSomeone ? `${parts.join(" · ")} — /admin/payouts` : parts.join(" · "),
  };
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 80);
}

/** SUBCONTRACTOR MAIL AND READS (2026-11-08, the subcontractors plan, part 2):
 *  the letters nobody has matched (one that fits no company is the webhook's
 *  own worry), the estimate reads that failed twice, a read queue the sweep is
 *  not draining, and a sweep that has not run. Not load-bearing: a stuck read
 *  is a job for the morning, not an outage. */
export async function checkSubsMail(now: string): Promise<ServiceHealth> {
  const { inboundCounts } = await import("@/lib/subInbound/server");
  const { readSweepStatus } = await import("@/lib/subQuotes/sweep");
  const { inboundConfig } = await import("@/lib/subInbound/config");
  const [counts, sweep] = await Promise.all([inboundCounts(), readSweepStatus()]);
  const cfg = inboundConfig();
  const base: ServiceHealth = { key: "subsMail", name: "Subcontractor mail & reads", level: "ok", reason: "", optional: true, checkedAt: now, note: cfg.enabled ? "replies by email on" : "replies by email off" };
  const problems: string[] = [];
  if (counts.unowned) problems.push(`${counts.unowned} letter${counts.unowned === 1 ? "" : "s"} fit no company`);
  if (counts.review) problems.push(`${counts.review} to match`);
  if (counts.failedReads) problems.push(`${counts.failedReads} read${counts.failedReads === 1 ? "" : "s"} failed`);
  if (counts.pendingReads > 10) problems.push(`${counts.pendingReads} reads waiting`);
  const sweepAge = sweep ? Date.now() - Date.parse(sweep.at) : null;
  if (sweep?.error) problems.push(`the sweep said: ${sweep.error}`);
  if (sweepAge != null && sweepAge > 45 * 60_000) problems.push(`the sweep last ran ${Math.round(sweepAge / 60_000)} min ago`);
  if (!problems.length) return { ...base, reason: sweep ? `sweep ${new Date(sweep.at).toISOString().slice(11, 16)}Z · ${sweep.reads.read} read, ${sweep.expired} expired, ${sweep.reminded} reminded` : "nothing waiting; the sweep has not run yet", asOf: sweep?.at };
  return { ...base, level: counts.unowned || counts.failedReads || sweep?.error ? "degraded" : "ok", reason: problems.join("; "), asOf: sweep?.at };
}

/** Runs every check, writes the report, and returns it. Never throws: a health
 *  check that can fail is one more thing to watch. */
export async function runIntegrationsHealth(): Promise<HealthReport> {
  const started = Date.now();
  const now = new Date().toISOString();
  const settled = await Promise.all(
    [
      checkOpenAI,
      checkSerpApi,
      checkReportAll,
      checkEagleView,
      checkRegrid,
      checkOverpass,
      checkMail,
      checkTwilio,
      checkStripeConnect,
      checkSquareApp,
      checkGmailOAuth,
      checkPaymentConnections,
      checkInfluencerPayouts,
      checkSubsMail,
    ].map((fn) =>
      fn(now).catch(
        (err): ServiceHealth => ({
          key: fn.name,
          name: fn.name.replace(/^check/, ""),
          level: "degraded",
          reason: `the check itself failed: ${short(err)}`,
          checkedAt: now,
        }),
      ),
    ),
  );
  // The headline is about what is load-bearing: an optional service that is
  // down must not make the whole platform read as down.
  const worst = settled
    .filter((s) => !s.optional)
    .reduce<HealthLevel>((a, s) => (RANK[s.level] > RANK[a] ? s.level : a), "ok");
  const report: HealthReport = { ranAt: now, tookMs: Date.now() - started, worst, services: settled };
  await db.syncState
    .upsert({
      where: { key: HEALTH_KEY },
      update: { cursor: JSON.stringify(report) },
      create: { key: HEALTH_KEY, cursor: JSON.stringify(report) },
    })
    .catch((err) => console.warn("[integrationsHealth] could not store the report:", err));
  return report;
}

/** The last stored report, or null when nothing has run yet. */
export async function readIntegrationsHealth(): Promise<HealthReport | null> {
  const row = await readState(HEALTH_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as HealthReport;
  } catch {
    return null;
  }
}

/**
 * One email a day, and only while something is down.
 *
 * `off` and `degraded` never wake anybody: a service nobody configured is not
 * an incident, and a low allowance is a decision to make this week, not at
 * 04:00. The stamp is written whether or not the mail got out, so a broken
 * transport cannot turn a nightly alert into a nightly loop.
 */
export async function alertIfDown(report: HealthReport): Promise<"sent" | "already-today" | "nothing-down"> {
  // Optional services are excluded on purpose — see ServiceHealth.optional.
  const down = report.services.filter((s) => s.level === "down" && !s.optional);
  if (!down.length) return "nothing-down";
  const today = report.ranAt.slice(0, 10);
  const stamp = await readState(ALERT_KEY);
  if (stamp?.cursor === today) return "already-today";

  const { sendEmail } = await import("@/lib/sdk/resend");
  const { platformAlertRecipients } = await import("@/lib/integrationsAlertRecipients");
  const to = await platformAlertRecipients();
  const rows = down
    .map((s) => `<li><b>${s.name}</b> — ${s.reason}</li>`)
    .join("");
  const others = report.services
    .filter((s) => s.level !== "down")
    .map((s) => `${s.name}: ${s.level}`)
    .join(" · ");
  try {
    if (to.length) {
      await sendEmail({
        to,
        subject: `JobFlex — ${down.length} integration${down.length === 1 ? "" : "s"} down`,
        html:
          `<p>The nightly integration check found ${down.length} service${down.length === 1 ? "" : "s"} down.</p>` +
          `<ul>${rows}</ul>` +
          `<p style="color:#555">${others}</p>` +
          `<p style="color:#555">Checked ${report.ranAt}. Admin → Overview has the full panel.</p>`,
      });
    }
  } catch (err) {
    console.warn("[integrationsHealth] alert email failed:", err);
  }
  await db.syncState
    .upsert({ where: { key: ALERT_KEY }, update: { cursor: today }, create: { key: ALERT_KEY, cursor: today } })
    .catch(() => {});
  return "sent";
}
