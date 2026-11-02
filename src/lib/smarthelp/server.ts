import "server-only";
// SmartHelp · THE SERVER — the person's context and their account's setup, the model call, and the records (the
// question log, the guide counters). What is asked when, and the limits, are the actions' (src/actions/smartHelp.ts);
// the pure parts are ./log.
//
// THE CONTEXT is read fresh, all at once, and only as far as it is needed. A panel open and a question for the model
// read it all (helpContextFor): eight setup facts — each one that can't be read counts as "not done", so its guide
// stays on top (the safe side) — the plan, the pages it locks, and the two features still opening (online booking,
// website estimators). A guide reads only what the person may open (viewerAccess); a reply given without the model
// reads only the plan, for its log row. No client, lead or money data.
//
// THE MODEL IS THE PLATFORM'S COST: lib/support/unmeteredOpenAI, never getOpenAI() or anything that meters the
// organization's trial budget (lib/trialMeter).
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { readDeskSettings } from "@/lib/aiDesk/numbers";
import { parseBookingSettings } from "@/lib/booking";
import { getBlockedCustomPages } from "@/lib/customPageAccess";
import { canSeeEarlyAccess } from "@/lib/earlyAccess";
import { FREE_PLAN_NAME, onFreePlan } from "@/lib/freePlan";
import { leadSetupNeed } from "@/lib/leadSetup";
import { isOrgNameUnset } from "@/lib/orgName";
import { getPaymentConnectionStatus } from "@/lib/payments/connections";
import { getPlanDisplayName } from "@/lib/planCatalogServer";
import { resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { readRegistration } from "@/lib/sms/registration";
import { unmeteredOpenAI } from "@/lib/support/unmeteredOpenAI";
import { readWebSettings, webEstimatorOpen } from "@/lib/webEstimatorServer";
import { HISTORY_TURNS, cleanAnswer, helpTargets, smartHelpAnswerSchema, smartHelpSystemPrompt, smartHelpUserPrompt, type SmartHelpReply } from "./answer";
import { GUIDES } from "./guides";
import {
  GUIDE_PREFIX,
  LOG_KEEP_DAYS,
  LOG_PREFIX,
  bumpGuideCount,
  cleanPage,
  guideKey,
  isLogId,
  logIdOf,
  logKey,
  parseGuideCounts,
  parseQuestionLog,
  questionLog,
  withOutcome,
  type GuideCounts,
  type QuestionLog,
  type Turn,
} from "./log";
import type { HelpContext, SetupState } from "./types";

/** Who is asking — requireOrg()'s answer (lib/orgContext), never ids from the panel. */
export type Asker = { organizationId: string; role: string | null; user: { id: string; email?: string | null; name?: string | null } };

// ── The person's context ─────────────────────────────────────────────────────

/** One setup fact; a read that fails is "not done". */
async function fact(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
  }
}

/** What this company has set up, the eight facts read in parallel. */
export async function readSetupState(orgId: string): Promise<SetupState> {
  const now = new Date();
  const [profile, aiDesk, texting, payments, booking, website, team, proposalSent] = await Promise.all([
    // Leads can find the shop — an address and its trades (lib/leadSetup) — and the business has its own name.
    fact(async () => {
      const [need, nameUnset] = await Promise.all([leadSetupNeed(orgId), isOrgNameUnset(orgId)]);
      return need !== null && !need.needs && !nameUnset;
    }),
    // The desk's profile is written ("Describe your business").
    fact(async () => (await readDeskSettings(orgId)).profile !== null),
    // The texting number is registered and approved.
    fact(async () => (await readRegistration(orgId)).stage === "approved"),
    fact(async () => {
      const s = await getPaymentConnectionStatus(orgId);
      return [s.stripe.state, s.square.state, s.stax.state].some((state) => state === "connected");
    }),
    // Saved booking settings that leave the page on: with none saved the defaults read "on" though nothing is set up,
    // and the page's switch can be turned off.
    fact(async () => {
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { bookingSettingsJson: true } });
      const json = org?.bookingSettingsJson ?? null;
      return json !== null && parseBookingSettings(json, []).enabled;
    }),
    fact(async () => Object.values((await readWebSettings(orgId)).trades).some((t) => t.on)),
    // Somebody else has a seat (a worker invite writes the seat at once), or an invite is still open.
    fact(async () => {
      const [seats, invite] = await Promise.all([
        db.membership.count({ where: { organizationId: orgId } }),
        db.invite.findFirst({ where: { organizationId: orgId, acceptedAt: null, expiresAt: { gt: now } }, select: { id: true } }),
      ]);
      return seats > 1 || invite !== null;
    }),
    fact(async () => (await db.proposal.findFirst({ where: { organizationId: orgId, sentAt: { not: null } }, select: { id: true } })) !== null),
  ]);
  return { profile, aiDesk, texting, payments, booking, website, team, proposalSent };
}

/** The plan by the name the sidebar shows (app/(dashboard)/layout): an ended subscription is the Free plan. Null when
 *  there is none, or it can't be read. */
export async function planNameOf(orgId: string): Promise<string | null> {
  try {
    const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { plan: true, status: true } });
    if (onFreePlan(sub)) return FREE_PLAN_NAME;
    return sub?.plan ? await getPlanDisplayName(sub.plan) : null;
  } catch {
    return null;
  }
}

type Viewer = { organizationId: string; role: string | null; user: { email?: string | null } };

/** What the person may open: their role (requireOrg's), the pages their plan locks and the features still opening —
 *  all a guide's steps need (stepView), so a guide tap reads no setup facts. */
export async function viewerAccess(who: Viewer): Promise<Pick<HelpContext, "role" | "lockedHrefs" | "features">> {
  const [locked, website] = await Promise.all([
    getBlockedCustomPages(who.organizationId).catch(() => null),
    fact(() => webEstimatorOpen()),
  ]);
  return {
    role: who.role,
    lockedHrefs: locked ?? [],
    // Online booking is early access (the page itself redirects everyone else); website estimators open with the
    // owner's one switch.
    features: { booking: canSeeEarlyAccess(who.user.email), website },
  };
}

/** Everything SmartHelp knows about the person: role, plan, locked pages, setup, open features, and the page they
 *  are on (`page` is the panel's word — context only, see cleanPage). */
export async function helpContextFor(ctx: Viewer, page: string): Promise<HelpContext> {
  const [setup, plan, access] = await Promise.all([readSetupState(ctx.organizationId), planNameOf(ctx.organizationId), viewerAccess(ctx)]);
  return { ...access, plan, setup, page: cleanPage(page) };
}

// ── The model ────────────────────────────────────────────────────────────────

/** The model's answer to a question, as the panel may show it (cleanAnswer). Throws when the call fails or the answer
 *  isn't a JSON object — the action shows its one plain line instead. */
export async function modelReply(input: { question: string; history: Turn[]; ctx: HelpContext }): Promise<SmartHelpReply> {
  const model = await resolveOpenAIModel();
  const completion = await unmeteredOpenAI().chat.completions.create(
    {
      model,
      ...(await samplingOptions(0.2)),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: smartHelpSystemPrompt() },
        { role: "user", content: smartHelpUserPrompt({ question: input.question, history: input.history.slice(-HISTORY_TURNS), ctx: input.ctx }) },
      ],
    },
    // Someone is waiting in the panel: one try of at most 30 seconds, then the plain line (the client's own 120 s and
    // retry are for the support AI, which answers after the response).
    { timeout: 30_000, maxRetries: 0 },
  );
  const answer = smartHelpAnswerSchema.parse(JSON.parse(completion.choices[0]?.message?.content ?? ""));
  return cleanAnswer(answer, input.ctx, helpTargets());
}

// ── The question log ─────────────────────────────────────────────────────────

const SWEEP_EVERY_MS = 3_600_000;
let sweptAt = 0;

/** Questions untouched for LOG_KEEP_DAYS go — looked for at most once an hour on each server instance. Its own
 *  failure is its own log line: the question it follows was written. */
async function sweepOldQuestions(now: number): Promise<void> {
  if (now - sweptAt < SWEEP_EVERY_MS) return;
  sweptAt = now;
  try {
    await db.syncState.deleteMany({
      where: { key: { startsWith: LOG_PREFIX }, updatedAt: { lt: new Date(now - LOG_KEEP_DAYS * 86_400_000) } },
    });
  } catch (err) {
    console.warn("[smarthelp] the 90-day sweep of old questions failed:", err instanceof Error ? err.message : err);
  }
}

/** The parts of the person's context a question's row keeps. */
export type LogView = Pick<HelpContext, "role" | "plan" | "page">;

/** Keeps one typed question (questionLog: a secret in it is not kept) and returns its id — the panel rates the entry
 *  by it and "Ask a person" carries it. The action awaits it, so the row exists before the id is used. Best-effort: a
 *  failed write is a log line, never a lost answer. */
export async function logQuestion(who: Asker, view: LogView, question: string, reply: SmartHelpReply): Promise<string> {
  const at = new Date();
  const rand = randomBytes(4).toString("hex");
  const id = logIdOf(at, rand);
  try {
    const org = await db.organization.findUnique({ where: { id: who.organizationId }, select: { name: true } });
    const rec = questionLog({
      at,
      rand,
      orgId: who.organizationId,
      orgName: org?.name ?? "",
      userId: who.user.id,
      userName: who.user.name ?? null,
      role: view.role,
      plan: view.plan,
      page: view.page,
      question,
      reply,
    });
    await db.syncState.create({ data: { key: logKey(at, rand), cursor: JSON.stringify(rec) } });
  } catch (err) {
    console.warn("[smarthelp] the question log was not written:", err instanceof Error ? err.message : err);
    return id;
  }
  await sweepOldQuestions(at.getTime());
  return id;
}

/** Compare-and-swap rounds before a write gives up (a row two requests change at once). */
const CAS_ATTEMPTS = 4;

/** A 👍 / 👎 — or "Ask a person" — on one log entry, by the person who asked it and nobody else. A compare-and-swap on
 *  the row, re-read when another write got there first, so a 👍 racing the "Ask a person" mark can't write over it
 *  (withOutcome keeps "person"). "busy": still racing after CAS_ATTEMPTS rounds — nothing was written. */
export async function setQuestionOutcome(
  logId: string,
  userId: string,
  outcome: Exclude<QuestionLog["outcome"], "none">,
): Promise<"ok" | "gone" | "not-yours" | "busy"> {
  if (!isLogId(logId)) return "gone";
  const key = `${LOG_PREFIX}${logId}`;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    const rec = row ? parseQuestionLog(row.cursor) : null;
    if (!row || !rec) return "gone";
    if (rec.userId !== userId) return "not-yours";
    const next = withOutcome(rec, outcome);
    if (next.outcome === rec.outcome) return "ok";
    const { count } = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor: JSON.stringify(next) } });
    if (count === 1) return "ok";
  }
  return "busy";
}

// ── Guide counters ───────────────────────────────────────────────────────────

/** One more open, 👍 or 👎 on a guide (`id`: a GUIDES id). Compare-and-swap like lib/rateLimit, so two at once both
 *  count. Best-effort: a counter never stands in a guide's way. */
export async function countGuide(id: string, field: keyof GuideCounts): Promise<void> {
  const key = guideKey(id);
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
      const cursor = JSON.stringify(bumpGuideCount(parseGuideCounts(row?.cursor), field));
      if (!row) {
        try {
          await db.syncState.create({ data: { key, cursor } });
          return;
        } catch {
          continue; // created by another request first — read it again
        }
      }
      const { count } = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor } });
      if (count === 1) return;
    }
  } catch (err) {
    console.warn(`[smarthelp] guide ${id} was not counted:`, err instanceof Error ? err.message : err);
  }
}

// ── What the owner sees ──────────────────────────────────────────────────────

/** The SmartHelp tab of /admin/support: the newest questions (a log key starts with its time, so newest by key) and
 *  every guide's counters, a guide no one has opened at 0. Platform admins only — the page asks
 *  requirePlatformAdmin() before it reads this. */
export async function listSmartHelp(opts?: { limit?: number }): Promise<{
  questions: QuestionLog[];
  guides: Array<{ id: string; title: string; opens: number; up: number; down: number }>;
}> {
  const limit = Math.min(Math.max(Math.trunc(opts?.limit ?? 200), 1), 500);
  const [rows, counters] = await Promise.all([
    db.syncState.findMany({ where: { key: { startsWith: LOG_PREFIX } }, orderBy: { key: "desc" }, take: limit, select: { cursor: true } }),
    db.syncState.findMany({ where: { key: { startsWith: GUIDE_PREFIX } }, select: { key: true, cursor: true } }),
  ]);
  const questions = rows.map((r) => parseQuestionLog(r.cursor)).filter((q): q is QuestionLog => q !== null);
  const countsOf = new Map(counters.map((c) => [c.key, parseGuideCounts(c.cursor)]));
  const guides = GUIDES.map((g) => ({ id: g.id, title: g.title, ...(countsOf.get(guideKey(g.id)) ?? parseGuideCounts(null)) }));
  return { questions, guides };
}
