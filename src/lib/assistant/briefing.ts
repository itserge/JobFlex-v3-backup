import "server-only";
// THE MORNING BRIEFING (2026-11-05, batch 3): "Good morning. 2 jobs today …
// 3 proposals waiting … $2,400 overdue … Send the reminders? Reply YES." Sent
// by the minute job (lib/assistant/runner) at each person's own time on the
// company's clock, once a day, to those who turned it on (lib/assistant/prefs):
// a line in the AI Operator, and a text to the linked phone. Every number is
// the CRM's own (lib/crm/briefServer — the Today list the dashboard shows,
// scoped by role), and the offer at the end is a read-back like any other:
// the remind_overdue tool's, waiting for the yes.
import { db } from "@/lib/db";
import { actorFor, refusal, type AssistantActor } from "@/lib/assistant/actor";
import { readCrmBrief } from "@/lib/crm/briefServer";
import type { TodayCheck } from "@/lib/crm/brief";
import { getFinancialsRollup } from "@/actions/financials";
import { linkOf } from "@/lib/assistant/phone";
import { sendAssistantText } from "@/lib/assistant/sms";
import { allPrefs } from "@/lib/assistant/prefs";
import { toolNamed } from "@/lib/assistant/tools";
import { briefingDue, confirmPrompt, dayOf, money } from "@/lib/assistant/shared";
import { readProjectsBrief, savePicks, type OrgOverviews } from "@/lib/assistant/projectsBrief";
import { fitProjects, type BriefPick } from "@/lib/projectOverview/brief";
import { ownProposalsOnly } from "@/lib/assistant/roles";
import { readWaitingFollowUps } from "@/lib/followUps/server";
import { readPromiseTracker } from "@/lib/promises/server";
import { dueWords } from "@/lib/promises/shared";
import { readPulse } from "@/lib/pulse/server";
import { pulseLine, pulseShortLine } from "@/lib/pulse/shared";

const sentKey = (organizationId: string, userId: string) => `assistant:briefed:${organizationId}:${userId}`;

function longDay(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz }).format(now);
}

function isMonday(now: Date, tz: string): boolean {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(now) === "Mon";
}

/** A check's first rows as one clause: "Johnson roof (8–12, Mike); Lee fence (9–2); +2 more". */
function rows(c: TodayCheck, n = 3): string {
  const shown = c.items.slice(0, n).map((i) => i.label);
  const rest = Math.max(0, c.items.length - n) + c.more;
  return `${shown.join("; ")}${rest > 0 ? `; +${rest} more` : ""}`;
}

export interface Briefing {
  text: string;
  /** The projects paragraph's numbered replies (Project Overview part 2): kept for the day when it goes. */
  picks: BriefPick[];
  /** The all-overdue reminder, planned and read back by its tool, for the person's yes; null when nothing is overdue. */
  offer: { tool: string; payload: unknown; readback: string } | null;
}

export async function composeBriefing(actor: AssistantActor, now = new Date(), opts: { projects?: boolean; cache?: Map<string, Promise<OrgOverviews>> } = {}): Promise<Briefing> {
  const tz = actor.timezone;
  const b = await readCrmBrief({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, now });
  const check = (key: string) => b.today.checks.find((c) => c.key === key && !c.done && c.count > 0) ?? null;
  const first = actor.userName.split(/\s+/)[0] || "there";
  const lines: string[] = [`Good morning, ${first}. ${longDay(now, tz)}.`];

  const jobs = check("schedule.jobs-today");
  const visits = check("schedule.visits-today");
  if (jobs || visits) {
    lines.push(`Today: ${[jobs ? `${jobs.count} job${jobs.count === 1 ? "" : "s"} — ${rows(jobs)}` : null, visits ? `${visits.count} visit${visits.count === 1 ? "" : "s"} — ${rows(visits)}` : null].filter(Boolean).join(". ")}.`);
  } else lines.push("Nothing on the calendar today.");
  const unstaffed = check("schedule.unstaffed");
  if (unstaffed) lines.push(`No crew on it yet: ${rows(unstaffed)}.`);
  // The projects that need them (Project Overview part 2, 2026-11-09): each project's own Overview, worst first, with
  // numbered next steps. Put in here once the rest is known, so it can give way in a text.
  const projectsAt = lines.length;
  const projects = opts.projects === false ? null : await readProjectsBrief(actor, now, opts.cache).catch(() => null);

  const waiting = [check("sales.sent-unseen"), check("sales.viewed-silent")].filter((c): c is TodayCheck => Boolean(c));
  if (waiting.length) lines.push(`Waiting on a signature: ${waiting.map((c) => `${c.title} (${rows(c, 2)})`).join("; ")}.`);
  const expiring = check("sales.expiring");
  if (expiring) lines.push(`${expiring.title}: ${rows(expiring, 2)}.`);

  const overdue = check("money.overdue");
  if (b.office) lines.push(`Owed: ${money(b.office.cash.total)}${b.office.cash.overdue > 0 ? `, ${money(b.office.cash.overdue)} overdue` : ""}${overdue ? ` — ${rows(overdue)}` : ""}.`);
  else if (overdue) lines.push(`${overdue.title}: ${rows(overdue)}.`);

  const callBack = check("sales.call-back");
  if (callBack) lines.push(`Leads to call back: ${rows(callBack)}.`);

  // The follow-up agent and the promise tracker (Smart CRM part 4, 2026-11-10): what is waiting for this person's
  // yes, and what they told a client they'd do by today. The same readers as the CRM's Today tab.
  if (!(await refusal(actor, "clients.read", false).catch(() => "no"))) {
    const viewer = { userId: actor.userId, ownOnly: ownProposalsOnly(actor.role) };
    const [held, tracker] = await Promise.all([readWaitingFollowUps(actor.organizationId, viewer, 12).catch(() => []), readPromiseTracker(actor.organizationId, viewer, now).catch(() => null)]);
    if (held.length) lines.push(`${held.length} follow-up${held.length === 1 ? "" : "s"} waiting for your OK: ${held.slice(0, 3).map((w) => w.client).join("; ")}${held.length > 3 ? `; +${held.length - 3} more` : ""}. Say "read me the follow-ups".`);
    if (tracker) {
      // Their own first: a promise is the person's who made it. The office also hears the team's late ones.
      const mine = (p: { ownerId: string | null }) => p.ownerId === actor.userId;
      const due = [...tracker.overdue, ...tracker.today].filter((p) => viewer.ownOnly || mine(p) || Boolean(b.office));
      const said = (p: (typeof due)[number]) => `${p.client} — ${p.text} (${dueWords(p.dueAt, now, tracker.tz)}${!mine(p) && p.owner ? `, ${p.owner}` : ""})`;
      if (due.length) lines.push(`Promised: ${due.slice(0, 3).map(said).join("; ")}${due.length > 3 ? `; +${due.length - 3} more` : ""}.`);
    }
  }

  // The company pulse (part 7, 2026-11-10), for the office: on Monday the whole of last week in one sentence; on
  // the other days how fast this week's leads are hearing back.
  if (b.office) {
    const monday = isMonday(now, tz);
    const pulse = await readPulse(actor.organizationId, { period: monday ? "last-week" : "week", now, tz }).catch(() => null);
    const line = pulse ? (monday ? (pulse.quiet ? null : pulseLine(pulse)) : pulseShortLine(pulse)) : null;
    if (line) lines.push(line);
  }

  if (b.office && isMonday(now, tz)) {
    const r = await getFinancialsRollup(actor.organizationId).catch(() => null);
    if (r) lines.push(`Last 30 days: collected ${money(r.revenue30d)}, expenses ${money(r.expenses30d)}, profit ${money(r.profit30d)}.`);
  }

  // The offer: every overdue payment reminded in one go — the tool's own read-back, so the words are the code's.
  let offer: Briefing["offer"] = null;
  const tool = toolNamed("remind_overdue");
  if (overdue && tool && tool.kind === "write" && !(await refusal(actor, tool.need, true))) {
    const plan = await tool.plan({ actor, now }, {}).catch(() => null);
    if (plan && plan.ok) offer = { tool: tool.name, payload: plan.payload, readback: plan.readback };
  }
  if (projects) {
    const used = lines.join("\n").length + (offer ? offer.readback.length + 40 : 0);
    lines.splice(projectsAt, 0, ...fitProjects(projects, used));
  }
  return { text: lines.join("\n"), offer, picks: projects?.picks ?? [] };
}

/** The briefing to one person: a line in the Operator (its card when there is an offer) and a text to the linked phone. */
export async function deliverBriefing(actor: AssistantActor, b: Briefing, now = new Date()): Promise<void> {
  const link = await linkOf(actor.organizationId, actor.userId).catch(() => null);
  const byText = Boolean(link?.active);
  let actionId: string | null = null;
  if (b.offer) {
    // Channel "sms" when a text goes: the runner then texts the result when the yes comes by text; in the app the
    // card carries it either way.
    const row = await db.assistantAction.create({
      data: { organizationId: actor.organizationId, userId: actor.userId, channel: byText ? "sms" : "app", tool: b.offer.tool, argsJson: JSON.stringify(b.offer.payload), readback: b.offer.readback, status: "AWAITING" },
      select: { id: true },
    });
    actionId = row.id;
  }
  const body = b.offer ? `${b.text}\n${b.offer.readback}` : b.text;
  await db.assistantMessage.create({ data: { organizationId: actor.organizationId, userId: actor.userId, channel: "app", direction: "OUT", body: body.slice(0, 4000), actionId } });
  // This morning's numbers (none: yesterday's are forgotten) — a digit reply runs one (lib/assistant/engine).
  await savePicks(actor.organizationId, actor.userId, dayOf(now, actor.timezone), b.picks).catch(() => undefined);
  if (byText && link) await sendAssistantText(link.phone, b.offer ? `${body} ${confirmPrompt("sms")}` : body, "jobflex-assistant-brief").catch(() => false);
}

/** Claim today for this person: exactly one of two minute jobs running side by side wins. */
async function claimDay(key: string, day: string): Promise<boolean> {
  const created = await db.syncState.create({ data: { key, cursor: day } }).then(() => true).catch(() => false);
  if (created) return true;
  const moved = await db.syncState.updateMany({ where: { key, cursor: { not: day } }, data: { cursor: day } });
  return moved.count === 1;
}

/** Mark today done (Settings: turned on after the time has passed — it starts tomorrow). */
export async function markBriefed(organizationId: string, userId: string, day: string): Promise<void> {
  const key = sentKey(organizationId, userId);
  await db.syncState.upsert({ where: { key }, create: { key, cursor: day }, update: { cursor: day } });
}

/** The minute job's part: everyone whose time has come today. Returns how many went. */
export async function runBriefings(now = new Date()): Promise<number> {
  const on = (await allPrefs()).filter((p) => p.prefs.briefing.on);
  if (!on.length) return 0;
  const orgs = await db.organization.findMany({ where: { id: { in: [...new Set(on.map((p) => p.organizationId))] }, deletedAt: null }, select: { id: true, timezone: true } });
  const tzOf = new Map(orgs.map((o) => [o.id, o.timezone]));
  let sent = 0;
  // Each company's projects read once for everyone briefed this minute.
  const projects = new Map<string, Promise<OrgOverviews>>();
  for (const p of on) {
    const tz = tzOf.get(p.organizationId);
    if (!tz) continue;
    const key = sentKey(p.organizationId, p.userId);
    const last = await db.syncState.findUnique({ where: { key }, select: { cursor: true } }).catch(() => null);
    if (!briefingDue(p.prefs.briefing.time, now, tz, last?.cursor ?? null)) continue;
    if (!(await claimDay(key, dayOf(now, tz)))) continue;
    try {
      const actor = await actorFor(p.organizationId, p.userId, "app");
      if (!actor || (await refusal(actor, "today", false))) continue;
      await deliverBriefing(actor, await composeBriefing(actor, now, { projects: p.prefs.briefing.projects, cache: projects }), now);
      sent += 1;
    } catch (err) {
      console.warn(`[assistant-brief] …${p.userId.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return sent;
}
