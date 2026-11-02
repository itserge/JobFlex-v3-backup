// A COMPANY'S OWN TEXTING NUMBER, REGISTERED IN ITS NAME (2026-10-02) — server only.
//
// Owner: "we need to set the Twilio number in JobFlex admin and contractors
// can use it for their own SMS … JobFlex will pay it". Twilio verifies a
// toll-free number for ONE business (errors 30474, 30478), so each company
// gets its own: JobFlex buys a toll-free number on the platform's Twilio
// account (admin → Texting), adds it to the platform's Messaging Service and
// asks Twilio to verify it with the company's business details (JobFlex's
// account is an approved ISV reseller). The number stays OFF the company
// (Organization.smsFromNumber empty) until Twilio approves; then it becomes
// the company's sending number and send.ts routes the company's texts through
// it. Paid plans only: the number is a monthly cost JobFlex carries.
//
// State lives in SyncState `smsreg:<orgId>` (no schema change); the trail in
// ActivityEvent. The words and the field list are registrationShared.ts.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { getOrgPlanById } from "@/lib/orgPlan";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { twilioClient, twilioSettings, type TwilioSettings } from "@/lib/sdk/twilio";
import { notePaidCall } from "@/lib/trialMeter";
import { attachVoiceToNumber, forgetVoiceNumber, indexVoiceNumber, numbersAssignedTo } from "@/lib/aiDesk/numbers";
import { jobflexSender } from "./jobflexSender";
import { clientProposalText, clientReminderText } from "./clients";
import { companyHelpText, crewAssignedText } from "./format";
import { settingsOf } from "@/lib/bookingBook";
import { parseTradeTypes } from "@/lib/tradeTypes";
import {
  isTollFree,
  parseRegistration,
  registrationProblems,
  sampleJobsFor,
  stageFor,
  tidyDetails,
  verificationFields,
  type SmsRegistrationDetails,
  type SmsRegistrationState,
} from "./registrationShared";

const KEY_PREFIX = "smsreg:";
const keyOf = (organizationId: string) => `${KEY_PREFIX}${organizationId}`;
/** A pending registration is asked about at most this often (the settings page, the hourly tick). */
const RECHECK_MS = 10 * 60_000;

export type RegistrationResult = { ok: true; state: SmsRegistrationState } | { ok: false; error: string };

export async function readRegistration(organizationId: string): Promise<SmsRegistrationState> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId) }, select: { cursor: true } }).catch(() => null);
  return parseRegistration(row?.cursor);
}

async function save(organizationId: string, state: SmsRegistrationState): Promise<void> {
  const cursor = JSON.stringify(state);
  await db.syncState.upsert({ where: { key: keyOf(organizationId) }, create: { key: keyOf(organizationId), cursor }, update: { cursor } });
}

/** A paying company: an active (or past-due) subscription on a paid plan. */
export async function companyIsPaying(organizationId: string): Promise<boolean> {
  const sub = await db.subscription.findUnique({ where: { organizationId }, select: { status: true } });
  if (sub?.status !== "ACTIVE" && sub?.status !== "PAST_DUE") return false;
  return (await getOrgPlanById(organizationId)) !== "FREE";
}

/** The company's own three texts, made by the templates the app sends them with, about its own trade. */
export function samplesFor(name: string, timezone: string | null, trades: readonly string[] = []): string[] {
  const tz = timezone || "America/Los_Angeles";
  const jobs = sampleJobsFor(trades);
  const visit = { title: jobs.visit, startsAt: new Date("2026-10-08T16:00:00Z"), endsAt: new Date("2026-10-08T17:00:00Z"), address: "4567 Rainier Ave S, Seattle, WA" };
  return [
    clientProposalText(name, jobs.job, 11306.52, "https://www.jobflex.app/portal/q/abc123"),
    clientReminderText(name, visit, tz),
    crewAssignedText(name, { title: jobs.job, startsAt: new Date("2026-10-07T15:00:00Z"), endsAt: new Date("2026-10-07T23:00:00Z"), address: visit.address }, "https://www.jobflex.app/w/xyz", tz),
  ];
}

function pretty(e164: string | null | undefined): string {
  const d = (e164 ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : (e164 ?? "");
}

function twilioMessage(err: unknown): string {
  const e = err as { message?: string; code?: number };
  return `Twilio answered: ${(e.message ?? String(err)).slice(0, 200)}${e.code ? ` (${e.code})` : ""}`;
}

/**
 * Buy the company's number (once; a resubmission keeps it) and send its
 * business details to Twilio — a new verification, or the correction of a
 * rejected one while Twilio still allows edits.
 */
export async function submitRegistration(organizationId: string, actorId: string | null, raw: SmsRegistrationDetails): Promise<RegistrationResult> {
  const details = tidyDetails(raw);
  const problems = Object.values(registrationProblems(details));
  if (problems.length) return { ok: false, error: problems[0]! };
  if (!(await companyIsPaying(organizationId))) return { ok: false, error: "Your own texting number comes with a paid plan." };
  const settings = await twilioSettings();
  if (!settings) return { ok: false, error: "Texting is not set up on this platform yet." };
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true, slug: true, smsFromNumber: true, phone: true, tradeTypesJson: true, bookingSettingsJson: true } });
  if (!org) return { ok: false, error: "Not found." };
  // The booking page is the opt-in Twilio is shown; with booking off it says "booking is off" and the review fails.
  if (!settingsOf(org).enabled) return { ok: false, error: "Turn on online booking first (Settings → Online booking) — it is where clients agree to your texts, and Twilio looks at it." };

  let state = await readRegistration(organizationId);
  if (state.stage === "approved") return { ok: true, state };
  // A number from the old instant button is still on the company: it goes first, or JobFlex pays for two.
  if (state.stage === "none" && org.smsFromNumber) return { ok: false, error: "Release your current number first — it was bought before registration and cannot text clients." };
  if (state.stage === "pending") return { ok: false, error: "Twilio is already checking your business — nothing to send until it answers." };

  const client = await twilioClient(settings);
  // 1. The number. A toll-free line JobFlex lent the company for calls (/admin/health) that is
  // not JobFlex's own sender is registered as it is — no second number (owner, 2026-10-14:
  // "if the contractor already has the number, show it … unless they want another one").
  if (!state.numberSid) {
    try {
      const base = process.env.TWILIO_APP_URL ?? (await appBaseUrl());
      const [lent, jobflexOwn] = await Promise.all([numbersAssignedTo(organizationId).catch(() => [] as string[]), jobflexSender().catch(() => null)]);
      const reuse = lent.find((n) => isTollFree(n) && n !== jobflexOwn) ?? null;
      const owned = reuse ? (await client.incomingPhoneNumbers.list({ phoneNumber: reuse, limit: 1 }))[0] : undefined;
      if (owned) {
        await client.incomingPhoneNumbers(owned.sid).update({ smsUrl: `${base}/api/twilio/sms`, smsMethod: "POST", voiceUrl: `${base}/api/twilio/voice`, voiceMethod: "POST" });
        state = { ...state, number: owned.phoneNumber, numberSid: owned.sid, voiceOnAt: new Date().toISOString(), error: null };
        await save(organizationId, state);
        if (settings.messagingServiceSid) {
          await client.messaging.v1.services(settings.messagingServiceSid).phoneNumbers.create({ phoneNumberSid: owned.sid }).catch((err: unknown) => {
            console.warn(`[sms/registration] could not add ${owned.phoneNumber} to the Messaging Service: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }
    } catch (err) {
      console.warn(`[sms/registration] could not take the lent line: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!state.numberSid) {
    try {
      const found = await client.availablePhoneNumbers("US").tollFree.list({ smsEnabled: true, limit: 1 });
      const pick = found[0]?.phoneNumber;
      if (!pick) return { ok: false, error: "No toll-free number is available right now — try again in a minute." };
      const base = process.env.TWILIO_APP_URL ?? (await appBaseUrl());
      const bought = await client.incomingPhoneNumbers.create({
        phoneNumber: pick,
        friendlyName: `JobFlex · ${org.name}`.slice(0, 64),
        smsUrl: `${base}/api/twilio/sms`,
        smsMethod: "POST",
        // Calls need no approval: the number answers them from now (lib/aiDesk/calls).
        voiceUrl: `${base}/api/twilio/voice`,
        voiceMethod: "POST",
      });
      state = { ...state, number: bought.phoneNumber, numberSid: bought.sid, voiceOnAt: new Date().toISOString(), error: null };
      // Kept at once: whatever fails next, the number is not bought twice.
      await save(organizationId, state);
      await indexVoiceNumber(organizationId, bought.phoneNumber);
      await notePaidCall("twilio", "number", { orgId: organizationId });
      if (settings.messagingServiceSid) {
        await client.messaging.v1.services(settings.messagingServiceSid).phoneNumbers.create({ phoneNumberSid: bought.sid }).catch((err: unknown) => {
          console.warn(`[sms/registration] could not add ${pick} to the Messaging Service: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch (err) {
      await save(organizationId, { ...state, stage: "failed", error: twilioMessage(err), details });
      return { ok: false, error: twilioMessage(err) };
    }
  }

  // 2. The registration.
  const name = details.dba || org.name;
  const fields = verificationFields({
    details,
    companyName: org.name,
    samples: samplesFor(name, org.timezone, parseTradeTypes(org.tradeTypesJson)),
    bookingUrl: `https://www.jobflex.app/book/${org.slug}`,
    slug: org.slug,
    helpText: companyHelpText(name, org.phone),
  });
  try {
    const editable = state.stage === "rejected" && state.verificationSid && state.editAllowed !== false && (!state.editUntil || Date.parse(state.editUntil) > Date.now());
    let v;
    if (editable && state.verificationSid) {
      v = await client.messaging.v1.tollfreeVerifications(state.verificationSid).update({ ...fields, editReason: "Business details corrected" });
    } else {
      // A closed or failed submission is replaced: one verification per number.
      if (state.verificationSid) await client.messaging.v1.tollfreeVerifications(state.verificationSid).remove().catch(() => null);
      // Letters, digits and dashes only, like JobFlex's own "jobflex-platform-tollfree": Twilio refused "org:org_…" (22207).
      v = await client.messaging.v1.tollfreeVerifications.create({ ...fields, tollfreePhoneNumberSid: state.numberSid!, externalReferenceId: `org-${organizationId.replace(/[^A-Za-z0-9-]/g, "-")}` });
    }
    const now = new Date().toISOString();
    state = { ...state, stage: stageFor(v.status), verificationSid: v.sid, submittedAt: now, checkedAt: now, reasons: [], editAllowed: undefined, editUntil: null, error: null, details };
    await save(organizationId, state);
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: `Asked Twilio to register ${pretty(state.number)} for ${details.legalName}'s texts` });
    return { ok: true, state };
  } catch (err) {
    state = { ...state, stage: state.stage === "rejected" ? "rejected" : "failed", error: twilioMessage(err), details };
    await save(organizationId, state);
    return { ok: false, error: twilioMessage(err) };
  }
}

/** Ask Twilio how the registration stands; approval puts the number on the company. */
export async function refreshRegistration(organizationId: string, force = false): Promise<SmsRegistrationState> {
  const state = await ensureVoice(organizationId, await readRegistration(organizationId));
  if (state.stage !== "pending" || !state.verificationSid) return state;
  if (!force && state.checkedAt && Date.now() - Date.parse(state.checkedAt) < RECHECK_MS) return state;
  const settings = await twilioSettings();
  if (!settings) return state;
  try {
    const client = await twilioClient(settings);
    const v = await client.messaging.v1.tollfreeVerifications(state.verificationSid).fetch();
    const stage = stageFor(v.status);
    const now = new Date().toISOString();
    const next: SmsRegistrationState = { ...state, stage: stage === "failed" ? "pending" : stage, checkedAt: now };
    if (stage === "approved") {
      next.approvedAt = now;
      await db.organization.update({ where: { id: organizationId }, data: { smsFromNumber: state.number ?? null, smsNumberSid: state.numberSid ?? null } });
      await logActivity({ organizationId, actorId: null, kind: TRAIL_KINDS.SETTINGS, summary: `Twilio approved ${pretty(state.number)} — texts to clients and crew go out from it now` });
    }
    if (stage === "rejected") {
      const reasons = Array.isArray(v.rejectionReasons) && v.rejectionReasons.length
        ? v.rejectionReasons.map((r: { code?: number; reason?: string }) => ({ code: typeof r?.code === "number" ? r.code : null, reason: String(r?.reason ?? "") }))
        : [{ code: v.errorCode ?? null, reason: v.rejectionReason ?? "Rejected" }];
      next.reasons = reasons.filter((r: { reason: string }) => r.reason);
      next.editAllowed = v.editAllowed ?? false;
      next.editUntil = v.editExpiration ? new Date(v.editExpiration).toISOString() : null;
      await logActivity({ organizationId, actorId: null, kind: TRAIL_KINDS.SETTINGS, summary: `Twilio sent back the texting registration: ${next.reasons.map((r) => r.reason).join("; ").slice(0, 300)}` });
    }
    await save(organizationId, next);
    return next;
  } catch (err) {
    console.warn(`[sms/registration] status check for ${organizationId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return state;
  }
}

/** A number bought before calls were wired (no voiceOnAt): point it at the voice webhook and index it, once. */
async function ensureVoice(organizationId: string, state: SmsRegistrationState): Promise<SmsRegistrationState> {
  if (!state.number || !state.numberSid || state.voiceOnAt) return state;
  const settings = await twilioSettings();
  if (!settings) return state;
  try {
    const client = await twilioClient(settings);
    await attachVoiceToNumber(client, state.numberSid, process.env.TWILIO_APP_URL ?? (await appBaseUrl()));
    await indexVoiceNumber(organizationId, state.number);
    const next = { ...state, voiceOnAt: new Date().toISOString() };
    await save(organizationId, next);
    return next;
  } catch (err) {
    console.warn(`[sms/registration] could not wire calls for ${state.number}: ${err instanceof Error ? err.message : String(err)}`);
    return state;
  }
}

/** The hourly tick: every registration still waiting on Twilio. */
export async function refreshPendingRegistrations(): Promise<number> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: KEY_PREFIX } }, select: { key: true, cursor: true }, take: 500 });
  let changed = 0;
  for (const r of rows) {
    if (parseRegistration(r.cursor).stage !== "pending") continue;
    const next = await refreshRegistration(r.key.slice(KEY_PREFIX.length));
    if (next.stage !== "pending") changed++;
  }
  return changed;
}

/** Give the number back to Twilio and forget the registration. Texts go back to JobFlex's rules. */
export async function releaseRegistration(organizationId: string, actorId: string | null): Promise<RegistrationResult> {
  const state = await readRegistration(organizationId);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { smsFromNumber: true, smsNumberSid: true } });
  const numberSid = state.numberSid ?? org?.smsNumberSid ?? null;
  const number = state.number ?? org?.smsFromNumber ?? null;
  if (!numberSid && !state.verificationSid) return { ok: false, error: "There is no number to release." };
  const settings = await twilioSettings();
  if (settings) {
    try {
      await removeFromTwilio(settings, state.verificationSid ?? null, numberSid);
    } catch (err) {
      console.warn(`[sms/registration] release of ${number} on Twilio failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await forgetVoiceNumber(number);
  await db.organization.update({ where: { id: organizationId }, data: { smsFromNumber: null, smsNumberSid: null } });
  await db.syncState.delete({ where: { key: keyOf(organizationId) } }).catch(() => null);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: `Released the texting number ${pretty(number)}` });
  return { ok: true, state: { stage: "none" } };
}

/** The verification, the Messaging Service seat, then the number itself. Only the
 *  number's own removal throws; a number Twilio no longer has counts as released. */
async function removeFromTwilio(settings: TwilioSettings, verificationSid: string | null, numberSid: string | null): Promise<void> {
  const client = await twilioClient(settings);
  if (verificationSid) await client.messaging.v1.tollfreeVerifications(verificationSid).remove().catch(() => null);
  if (!numberSid) return;
  if (settings.messagingServiceSid) await client.messaging.v1.services(settings.messagingServiceSid).phoneNumbers(numberSid).remove().catch(() => null);
  try {
    await client.incomingPhoneNumbers(numberSid).remove();
  } catch (err) {
    if ((err as { status?: number } | null)?.status !== 404) throw err;
  }
}

export type PurgedNumbers = {
  /** The company's own numbers given back to Twilio. */
  released: string[];
  /** Its own numbers Twilio would not let go of — still paid for until someone releases them. */
  failed: Array<{ number: string | null; numberSid: string | null; error: string }>;
  /** JobFlex's own lines that were routed to it (/admin/health) — unassigned, not released. */
  unassigned: string[];
};

/**
 * The purge's half (api/cron/purge-deleted-orgs, 30 days after a company was
 * deleted — never at the soft delete, which can still be undone): the
 * company's own number released on Twilio, and every index row that routed
 * calls or texts to the company dropped. A JobFlex line assigned to it is
 * JobFlex's, so it only goes back unassigned. Never throws: a number that
 * could not be released comes back in `failed` for the caller to report.
 */
export async function releaseNumbersForPurge(organizationId: string): Promise<PurgedNumbers> {
  const out: PurgedNumbers = { released: [], failed: [], unassigned: [] };
  const state = await readRegistration(organizationId);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { smsFromNumber: true, smsNumberSid: true } });
  const numberSid = state.numberSid ?? org?.smsNumberSid ?? null;
  const number = state.number ?? org?.smsFromNumber ?? null;
  if (numberSid || state.verificationSid) {
    const settings = await twilioSettings();
    if (!settings) {
      if (numberSid) out.failed.push({ number, numberSid, error: "Twilio is not configured" });
    } else {
      try {
        await removeFromTwilio(settings, state.verificationSid ?? null, numberSid);
        if (numberSid) out.released.push(number ?? numberSid);
      } catch (err) {
        out.failed.push({ number, numberSid, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await forgetVoiceNumber(number);
  for (const assigned of await numbersAssignedTo(organizationId)) {
    await forgetVoiceNumber(assigned);
    if (assigned !== number) out.unassigned.push(assigned);
  }
  await db.syncState.delete({ where: { key: keyOf(organizationId) } }).catch(() => null);
  return out;
}
