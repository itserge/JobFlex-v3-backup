import "server-only";
// BRING CLIENTS BACK, FOR THE OPERATOR (Smart CRM part 6, 2026-11-10):
//
//   client_list       "who haven't we heard from in a year", "how many deck clients do we have" — a list in plain
//                     words (or one of the ready ones), counted, with who would get an email.
//   campaigns         "how did the spring campaign do" — what was sent and what came of it.
//   draft_campaign    "write an email to clients who got a quote and never bought" — the words, saved as a draft.
//   send_campaign     "send it" — read back with the count and the words, sent only on a yes.
//   stop_campaign     "stop the campaign" — nobody else gets it.
//   set_house_facts   "Olga's house was built in 1987, 2,400 square feet".
//
// The same cores as the CRM's Bring back tab (lib/winback), so the Operator and the page can never disagree: the
// list is counted again at Send, nobody is emailed twice, people who unsubscribed are left out, and the caps hold.
// Owners and managers only — a campaign writes to the company's whole book in the company's name.

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import type { AssistantActor } from "@/lib/assistant/actor";
import { isPageLocked } from "@/lib/customPageAccess";
import { enforceRateLimit, RateLimitError } from "@/lib/rateLimit";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { appBaseUrl } from "@/lib/appUrl";
import { setHouseByHand } from "@/lib/winback/house";
import { previewList, readCampaigns, readWinBack, saveCampaign, sendBatch, sendingProblem, startCampaign, stopCampaign, type CampaignRow } from "@/lib/winback/server";
import { readWords, writeCampaign } from "@/lib/winback/understand";
import { BATCH, READY_LISTS, houseWords, isEmptyFilter, listFilter, outcomeWords, paceWords, parseFilter, readyList, type ListFilter } from "@/lib/winback/shared";

const PAGE = "/dashboard/crm";
const LOCKED = "Bringing clients back is part of Smart CRM, which isn't in your plan yet (Settings → Billing).";
const locked = (actor: AssistantActor) => isPageLocked(actor.organizationId, "smart-crm", { as: actor.userId });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);
const READY_KEYS = READY_LISTS.map((r) => r.key) as [string, ...string[]];

const who = {
  words: z.string().max(300).nullable().describe("who should be on the list, in the person's own words: 'deck clients quiet for two years', 'got a quote and never bought'; or the name of a saved list; null with `ready`"),
  ready: z
    .enum(READY_KEYS)
    .nullable()
    .describe(`one of the ready lists, when the person names it or asks for exactly that: ${READY_LISTS.map((r) => `${r.key} = ${r.name}`).join("; ")}; null otherwise`),
};
type Who = { words: string | null; ready: string | null };

/** The list a person means: a ready one, a saved one by its name, or their words read into a filter. */
async function listOf(actor: AssistantActor, args: Who, now: Date): Promise<{ ok: true; filter: ListFilter; name: string | null } | { ok: false; say: string }> {
  if (args.ready) {
    const r = readyList(args.ready);
    if (r) return { ok: true, filter: r.filter, name: r.name };
  }
  const words = (args.words ?? "").trim();
  if (!words) return { ok: false, say: "Who should be on the list? For example: 'clients who bought a deck and have been quiet for a year'." };
  const saved = await db.clientList.findMany({ where: { organizationId: actor.organizationId }, select: { name: true, filterJson: true }, take: 100 });
  const hit = saved.find((l) => norm(l.name) === norm(words));
  if (hit) return { ok: true, filter: parseFilter(hit.filterJson), name: hit.name };
  const read = await readWords(actor.organizationId, words, now);
  if (isEmptyFilter(read.filter)) return { ok: false, say: `I couldn't tell which clients "${clip(words, 80)}" means. Try it like: 'bought from us and quiet for a year', 'got a quote and never bought', 'paid over $10,000'.` };
  return { ok: true, filter: read.filter, name: null };
}

// ── client_list ──────────────────────────────────────────────────────────────

const clientList: ReadTool<Who> = {
  kind: "read",
  name: "client_list",
  need: "clients.campaign",
  card: {
    label: "A list of clients",
    purpose: "Count the clients who fit a description in plain words — who bought, who went quiet, who never bought, by job, town, tag, money paid or house — and who of them could get an email.",
    when: "'Who haven't we heard from in a year', 'how many clients got a quote and never bought', 'which deck clients are in Tacoma', 'who should I bring back': client_list(words, ready). Both null = the ready lists with their counts.",
    objects: ["client"],
    effect: "read",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "who haven't we heard from in over a year?", args: { words: "bought from us and quiet for a year", ready: null } },
      { say: "who should I bring back?", args: { words: null, ready: null } },
    ],
  },
  description:
    "A list of past clients from a description in plain words, counted today: how many fit, how many of them would get an email (people with no email, who unsubscribed, or who got a campaign in the last 30 days are left out, with the reason), and the first names on it, best clients first. With nothing given: the ready lists (quiet for a year, job finished a year ago, quoted and never bought, happy clients, biggest clients, service plan ended, older homes) with their counts. Never guess a count — it comes from here.",
  params: z.object(who),
  async run({ actor, now }, args) {
    if (await locked(actor)) return { say: LOCKED };
    if (!args.ready && !(args.words ?? "").trim()) {
      const w = await readWinBack(actor.organizationId, now);
      return {
        clients: w.clients,
        withEmail: w.withEmail,
        unsubscribed: w.optedOut,
        readyLists: w.ready.map((r) => `${r.name}: ${r.count}`),
        savedLists: w.saved.map((s) => `${s.name}: ${s.count}`),
        page: PAGE,
      };
    }
    const list = await listOf(actor, args, now);
    if (!list.ok) return { say: list.say };
    const p = await previewList(actor.organizationId, list.filter, now);
    return {
      list: list.name ? `${list.name} — ${p.words}` : p.words,
      clients: p.total,
      wouldGetAnEmail: p.willSend,
      leftOut: p.leftOut,
      first: p.people.slice(0, 8).map((x) => `${x.name}${x.lastJob ? ` — ${x.lastJob}` : ""}${x.city ? ` (${x.city})` : ""}`),
      ...(p.houseUnknown ? { note: `${plural(p.houseUnknown, "client")} can't be on it yet: nothing is known about their house (CRM → Bring back → House facts).` } : {}),
      page: PAGE,
    };
  },
};

// ── campaigns ────────────────────────────────────────────────────────────────

const STATUS_WORDS: Record<CampaignRow["status"], string> = { DRAFT: "draft, not sent", SENDING: "going out now", SENT: "sent", CANCELED: "stopped" };

/** Campaigns that answer to the name as said: every word of it is in the campaign's name or subject. */
function byName<T extends { name: string; subject: string }>(rows: T[], name: string | null): T[] {
  const words = norm(name ?? "").split(" ").filter((w) => w.length > 1 && !["the", "campaign", "email", "draft", "it", "one"].includes(w));
  if (!words.length) return rows;
  return rows.filter((r) => {
    const n = ` ${norm(`${r.name} ${r.subject}`)} `;
    return words.every((w) => n.includes(` ${w}`));
  });
}

const campaigns: ReadTool<{ name: string | null }> = {
  kind: "read",
  name: "campaigns",
  need: "clients.campaign",
  card: {
    label: "Campaigns",
    purpose: "The emails sent to lists of past clients and what came of each: sent, wrote back, came back, bought, unsubscribed.",
    when: "'How did the campaign do', 'did anyone come back from the spring email', 'is there a draft campaign', 'what campaigns went out': campaigns(name). null = the latest ones.",
    objects: ["client"],
    effect: "read",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "how did the last campaign do?", args: { name: null } },
      { say: "did anyone come back from the deck check-up email?", args: { name: "deck check-up" } },
    ],
  },
  description:
    "The company's campaigns to past clients, newest first: who each went to, whether it is a draft, going out, sent or stopped, and what came of it — sent, still to go, wrote back, came back (a new quote or job within 60 days of the email), bought with the amount, unsubscribed. With a name: that campaign's words too.",
  params: z.object({ name: z.string().max(120).nullable().describe("a few words of the campaign's name or subject; null for the latest ones") }),
  async run({ actor, now }, args) {
    if (await locked(actor)) return { say: LOCKED };
    const all = await readCampaigns(actor.organizationId, now, 20);
    if (!all.length) return { campaigns: [], say: "No campaign has been written yet.", page: PAGE };
    const rows = byName(all, args.name);
    if (!rows.length) return { say: `No campaign answers to "${args.name}".`, campaigns: all.slice(0, 6).map((c) => c.name), page: PAGE };
    const line = (c: CampaignRow) => `${c.name} — ${STATUS_WORDS[c.status]}${c.status === "DRAFT" ? "" : ` — ${outcomeWords(c.counts)}`}`;
    if (args.name && rows.length === 1) {
      const c = rows[0];
      return { campaign: line(c), to: c.audience, subject: c.subject, words: clip(c.body, 900), leftOut: c.leftOut, page: PAGE };
    }
    return { campaigns: rows.slice(0, 8).map(line), page: PAGE };
  },
};

// ── draft_campaign ───────────────────────────────────────────────────────────

const draftArgs = z.object({ ...who, about: z.string().max(300).nullable().describe("what the email should say or offer, when the person said: 'a free deck check-up before summer'; null to let it be a friendly hello") });
type DraftArgs = z.infer<typeof draftArgs>;
const draftPayload = z.object({ filter: listFilter, name: z.string(), subject: z.string(), body: z.string(), by: z.enum(["ai", "rules"]), willSend: z.number() });

const draftCampaign: WriteTool<DraftArgs, z.infer<typeof draftPayload>> = {
  kind: "write",
  name: "draft_campaign",
  need: "clients.campaign",
  card: {
    label: "Write a campaign",
    purpose: "Write one email to a list of past clients and save it as a draft. Nothing is sent.",
    when: "'Write an email to clients who got a quote and never bought', 'draft a campaign for deck clients quiet two years offering a check-up': draft_campaign(words, ready, about). Sending is a separate step (send_campaign).",
    objects: ["client"],
    effect: "draft",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "write an email to everyone who got a quote and never bought", args: { words: null, ready: "lost-quotes", about: null } },
      { say: "draft a campaign for deck clients we haven't heard from in two years, offer a free check-up", args: { words: "deck clients quiet for two years", ready: null, about: "a free deck check-up" } },
    ],
  },
  description:
    "Write one short email for a list of past clients (the list from plain words or a ready list, as in client_list) and save it as a DRAFT campaign. It is read back word for word first. Saving sends nothing — after it is saved the person is offered to send it. The words may use {first name}, {company} and {last job}, filled in for each client.",
  params: draftArgs,
  payload: draftPayload,
  async plan({ actor, now }, args) {
    if (await locked(actor)) return { ok: false, say: LOCKED };
    const list = await listOf(actor, args, now);
    if (!list.ok) return { ok: false, say: list.say };
    const p = await previewList(actor.organizationId, list.filter, now);
    if (!p.total) return { ok: false, say: `Nobody fits that right now (${p.words})` };
    if (!p.willSend) return { ok: false, say: `${plural(p.total, "client fits", "clients fit")}, but none can get an email: ${p.leftOut.join(" · ")}.` };
    const draft = await writeCampaign(actor.organizationId, { filter: p.filter, listName: list.name, about: args.about });
    const name = clip(list.name ?? draft.subject, 80);
    return {
      ok: true,
      payload: { filter: p.filter, name, subject: draft.subject, body: draft.body, by: draft.by, willSend: p.willSend },
      readback: `Save this as a draft for ${plural(p.willSend, "client")} — ${p.words} Subject: "${draft.subject}". It reads: "${clip(draft.body, 900)}" Nothing is sent yet.`,
    };
  },
  async execute({ actor }, p) {
    const saved = await saveCampaign(actor.organizationId, actor.userId, { name: p.name, filter: p.filter, subject: p.subject, body: p.body, writtenBy: p.by });
    if (!saved.ok) return { say: `I couldn't save it: ${saved.error}` };
    return { say: `Draft saved: "${p.subject}". You can change the words on CRM → Bring back.`, result: { campaignId: saved.id, page: PAGE }, offer: { tool: "send_campaign", args: { name: p.name } } };
  },
};

// ── send_campaign ────────────────────────────────────────────────────────────

const nameArgs = z.object({ name: z.string().max(120).nullable().describe("a few words of the campaign's name or subject; null when there is only one it can be") });
type NameArgs = z.infer<typeof nameArgs>;
const sendPayload = z.object({ campaignId: z.string(), subject: z.string() });

const HOUR = 3_600_000;

/** The first batch leaves once the answer is back; without a request to outlive (a script), the hourly sweep sends it. */
function later(job: () => Promise<unknown>): void {
  try {
    after(() => job().catch((err) => console.warn("[winback] first batch failed:", err instanceof Error ? err.message : err)));
  } catch {
    /* the follow-ups cron drains it within the hour */
  }
}

const sendCampaign: WriteTool<NameArgs, z.infer<typeof sendPayload>> = {
  kind: "write",
  name: "send_campaign",
  need: "clients.campaign",
  card: {
    label: "Send a campaign",
    purpose: "Send a draft campaign to its list of past clients by email — read back with the count and the words first.",
    when: "'Send it', 'send the deck check-up campaign', 'email them': send_campaign(name). Only a draft can be sent; write one with draft_campaign first.",
    objects: ["client"],
    effect: "message",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "send the deck check-up campaign", args: { name: "deck check-up" } },
      { say: "send the campaign", args: { name: null } },
    ],
  },
  description:
    "Send a DRAFT campaign. The list is counted again at that moment; people with no email, who unsubscribed, or who got a campaign in the last 30 days are left out; nobody gets it twice. 40 emails leave an hour between 8 AM and 8 PM company time, up to 200 a day. Every email carries the company's mailing address and an unsubscribe link. Replies land in the inbox.",
  params: nameArgs,
  payload: sendPayload,
  async plan({ actor, now }, args) {
    const org = actor.organizationId;
    if (await locked(actor)) return { ok: false, say: LOCKED };
    const drafts = await db.clientCampaign.findMany({ where: { organizationId: org, status: "DRAFT" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, subject: true, body: true, filterJson: true } });
    if (!drafts.length) return { ok: false, say: "There's no draft campaign to send. Tell me who to write to and I'll draft one." };
    const hits = byName(drafts, args.name);
    if (!hits.length) return { ok: false, say: `No draft answers to "${args.name}". The drafts: ${drafts.slice(0, 4).map((d, i) => `${i + 1}. ${d.name}`).join(" ")}` };
    if (hits.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 4).map((d, i) => `${i + 1}. ${d.name}`).join(" ")}` };
    const c = hits[0];
    const problem = await sendingProblem(org);
    if (problem) return { ok: false, say: problem };
    const p = await previewList(org, parseFilter(c.filterJson), now);
    if (!p.willSend) return { ok: false, say: p.total ? `Nobody on this list can get the email: ${p.leftOut.join(" · ")}.` : "Nobody is on this list right now." };
    const left = p.leftOut.length ? ` Left out: ${p.leftOut.join(" · ")}.` : "";
    return {
      ok: true,
      payload: { campaignId: c.id, subject: c.subject },
      readback: `Email ${plural(p.willSend, "client")} — ${p.words} Subject: "${c.subject}". It reads: "${clip(c.body, 700)}"${left} ${paceWords(p.willSend)} Each email has your address and an unsubscribe link.`,
    };
  },
  async execute({ actor }, p) {
    const org = actor.organizationId;
    if (await locked(actor)) return { say: LOCKED };
    try {
      await enforceRateLimit(`winback:send:${org}`, 6, HOUR, "campaigns");
    } catch (err) {
      if (err instanceof RateLimitError) return { say: err.message };
      throw err;
    }
    const res = await startCampaign(org, actor.userId, p.campaignId);
    if (!res.ok) return { say: `It didn't go: ${res.error}` };
    if (!res.waits) {
      const base = await appBaseUrl();
      later(() => sendBatch(org, p.campaignId, base));
    }
    await logActivity({ organizationId: org, actorId: actor.userId, kind: TRAIL_KINDS.CLIENT, summary: `Sent a campaign to ${plural(res.queued, "client")} (AI Operator)`, meta: { campaignId: p.campaignId, queued: res.queued } });
    const first = res.waits ? "It's outside sending hours (8 AM–8 PM), so the first leave in the morning" : res.queued <= BATCH ? "They're leaving now" : `The first ${BATCH} are leaving now, the rest hour by hour`;
    return { say: `Sending "${p.subject}" to ${plural(res.queued, "client")}. ${first}. Say "stop the campaign" to stop it; "how did the campaign do" for what came of it.`, result: { campaignId: p.campaignId, queued: res.queued, page: PAGE } };
  },
};

// ── stop_campaign ────────────────────────────────────────────────────────────

const stopPayload = z.object({ campaignId: z.string(), name: z.string() });

const stopCampaignTool: WriteTool<NameArgs, z.infer<typeof stopPayload>> = {
  kind: "write",
  name: "stop_campaign",
  need: "clients.campaign",
  card: {
    label: "Stop a campaign",
    purpose: "Stop a campaign that is still going out: nobody else gets it.",
    when: "'Stop the campaign', 'stop sending the deck email': stop_campaign(name).",
    objects: ["client"],
    effect: "record",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [{ say: "stop the campaign", args: { name: null } }],
  },
  description: "Stop a campaign that is still going out. The emails that haven't left yet never leave; the ones already sent stay on record with what came of them. A stopped campaign can't be started again — write a new one.",
  params: nameArgs,
  payload: stopPayload,
  async plan({ actor }, args) {
    const going = await db.clientCampaign.findMany({ where: { organizationId: actor.organizationId, status: "SENDING" }, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, name: true, subject: true } });
    if (!going.length) return { ok: false, say: "No campaign is going out right now." };
    const hits = byName(going, args.name);
    if (!hits.length) return { ok: false, say: `No campaign going out answers to "${args.name}". Going out now: ${going.slice(0, 4).map((d, i) => `${i + 1}. ${d.name}`).join(" ")}` };
    if (hits.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 4).map((d, i) => `${i + 1}. ${d.name}`).join(" ")}` };
    const c = hits[0];
    const [waiting, sent] = await Promise.all([
      db.clientCampaignRecipient.count({ where: { campaignId: c.id, status: "QUEUED" } }),
      db.clientCampaignRecipient.count({ where: { campaignId: c.id, status: "SENT" } }),
    ]);
    return { ok: true, payload: { campaignId: c.id, name: c.name }, readback: `Stop "${c.name}": ${plural(waiting, "email")} that ${waiting === 1 ? "hasn't" : "haven't"} left yet won't go. ${sent.toLocaleString("en-US")} already went.` };
  },
  async execute({ actor }, p) {
    const res = await stopCampaign(actor.organizationId, p.campaignId);
    if (!res.ok) return { say: res.error };
    return { say: `Stopped "${p.name}" — ${plural(res.stopped, "email")} won't go.` };
  },
};

// ── set_house_facts ──────────────────────────────────────────────────────────

const houseArgs = z.object({
  clientId: z.string().min(1).max(64).describe("the client's id, from find"),
  yearBuilt: z.number().int().min(1700).max(2100).nullable().describe("the year the house was built; null when not said"),
  livingSqft: z.number().int().min(100).max(100_000).nullable().describe("the house's living area in square feet; null when not said"),
});
type HouseArgs = z.infer<typeof houseArgs>;
const housePayload = houseArgs.extend({ name: z.string() });

const setHouseFacts: WriteTool<HouseArgs, z.infer<typeof housePayload>> = {
  kind: "write",
  name: "set_house_facts",
  need: "clients.campaign",
  card: {
    label: "Note a client's house",
    purpose: "Write down the year a client's house was built and its size, so lists like 'homes built before 1995' can find them.",
    when: "'Olga's house was built in 1987', 'the Lees' place is 2,400 square feet': set_house_facts(clientId from find, yearBuilt, livingSqft).",
    objects: ["client", "property"],
    effect: "record",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [{ say: "Olga Petrova's house was built in 1987, about 2,400 square feet", args: { clientId: "c_1", yearBuilt: 1987, livingSqft: 2400 } }],
  },
  description: "Write down what is known about a client's house: the year built, the living area in square feet, or both. What a person says wins over the public records and is never overwritten by a lookup. A fact not said is kept as it was.",
  params: houseArgs,
  payload: housePayload,
  async plan({ actor }, args) {
    if (await locked(actor)) return { ok: false, say: LOCKED };
    if (args.yearBuilt === null && args.livingSqft === null) return { ok: false, say: "Tell me the year it was built, the size in square feet, or both." };
    const c = await db.client.findFirst({ where: { id: args.clientId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true } });
    if (!c) return { ok: false, say: "I couldn't find that client." };
    const had = await db.clientHouse.findUnique({ where: { clientId: c.id }, select: { yearBuilt: true, livingSqft: true } });
    const yearBuilt = args.yearBuilt ?? had?.yearBuilt ?? null;
    const livingSqft = args.livingSqft ?? had?.livingSqft ?? null;
    return { ok: true, payload: { clientId: c.id, yearBuilt, livingSqft, name: c.name }, readback: `Note ${c.name}'s house: ${houseWords({ yearBuilt, sqft: livingSqft }) ?? "nothing"}.` };
  },
  async execute({ actor }, p) {
    const res = await setHouseByHand(actor.organizationId, p.clientId, { yearBuilt: p.yearBuilt, livingSqft: p.livingSqft });
    return { say: res.ok ? `Noted for ${p.name}.` : res.error };
  },
};

export const WIN_BACK_TOOLS = [clientList, campaigns, draftCampaign, sendCampaign, stopCampaignTool, setHouseFacts] as const;
