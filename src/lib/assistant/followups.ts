import "server-only";
// THE FOLLOW-UP AGENT AND THE PROMISE TRACKER, FOR THE OPERATOR (Smart CRM part 4, 2026-11-10):
//
//   follow_ups       "what follow-ups are waiting for me" — the drafts the agent prepared and is holding for a yes,
//                    and the plain reminders. With a name: the words themselves.
//   send_follow_up   "send Olga's follow-up" / "skip it" — read back word for word, sent only on a yes.
//   promises         "what did we promise this week", "what's overdue", "what is Olga waiting for".
//   add_promise      "I told Olga I'd send the revised quote Friday".
//   settle_promise   "kept my promise to Olga" / "cancel it" / "move it to Monday".
//
// The same readers and cores as the CRM's Today tab (lib/followUps/server, lib/promises/server), so the Operator
// and the page can never disagree. SALES / ESTIMATOR see and act on their own, as on the page.

import { z } from "zod";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import type { AssistantActor } from "@/lib/assistant/actor";
import { findClients } from "@/lib/assistant/find";
import { ownProposalsOnly } from "@/lib/assistant/roles";
import { money } from "@/lib/crm/brief";
import { waitingLine, type WaitingFollowUp } from "@/lib/followUps/agent";
import { dispatchOne, prepareDraft } from "@/lib/followUps/engine";
import { readWaitingFollowUps, skipFollowUpAs } from "@/lib/followUps/server";
import { dayKey, dueInstant, dueWords, promiseLine, type TrackedPromise } from "@/lib/promises/shared";
import { addPromise, movePromise, readPromiseTracker, settlePromise } from "@/lib/promises/server";

const viewerOf = (actor: AssistantActor) => ({ userId: actor.userId, ownOnly: ownProposalsOnly(actor.role) });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Rows whose client answers to the name as said: every word of it appears in the client's name. */
function byName<T extends { client: string }>(rows: T[], name: string): T[] {
  const words = norm(name).split(" ").filter(Boolean);
  if (!words.length) return [];
  return rows.filter((r) => {
    const n = ` ${norm(r.client)} `;
    return words.every((w) => n.includes(` ${w}`));
  });
}

const draftWords = (w: WaitingFollowUp) => (w.draftBody ? `${w.channel === "EMAIL" && w.draftSubject ? `Subject: ${w.draftSubject} — ` : ""}${w.draftBody}` : null);

// ── follow-ups ───────────────────────────────────────────────────────────────

const followUps: ReadTool<{ name: string | null }> = {
  kind: "read",
  name: "follow_ups",
  need: "clients.read",
  card: {
    label: "Follow-ups waiting",
    purpose: "The follow-ups the agent prepared and is holding for a yes, and the reminders to follow up — with the words, for one client.",
    when: "'What follow-ups are waiting for me', 'what does the follow-up to Olga say': follow_ups(name). Without a name: the list. With a name: that client's waiting follow-up and its words.",
    objects: ["client", "proposal"],
    effect: "read",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "what follow-ups are waiting for my OK?", args: { name: null } },
      { say: "read me the follow-up to Olga", args: { name: "Olga" } },
    ],
  },
  description:
    "Follow-ups waiting for a person: messages the follow-up agent prepared but did not send because the rule says 'ask me first', and reminders to follow up yourself. Without a name: who, which proposal, how much, and whether an email or text is ready. With a name: the prepared words exactly as they would go. Nothing here has been sent.",
  params: z.object({ name: z.string().max(120).nullable().describe("one client's name to read their follow-up's words; null for the list") }),
  async run({ actor }, args) {
    const all = await readWaitingFollowUps(actor.organizationId, viewerOf(actor));
    if (args.name) {
      const hits = byName(all, args.name);
      if (!hits.length) return { none: `No follow-up is waiting for ${args.name}.`, waitingInAll: all.length };
      return {
        count: hits.length,
        followUps: hits.map((w) => ({
          client: w.client,
          proposal: `${w.title} (${money(w.total)})`,
          rule: w.rule,
          by: w.draftBody ? (w.channel === "TEXT" ? "text" : "email") : "reminder — nothing written yet",
          words: draftWords(w),
          writtenBy: w.draftBody ? (w.draftBy === "ai" ? "AI, from the client's history" : w.draftBy === "person" ? "edited by a person" : "the standard words") : null,
        })),
        page: "/dashboard/crm",
      };
    }
    return { count: all.length, followUps: all.slice(0, 12).map((w) => waitingLine(w, money)), page: "/dashboard/crm" };
  },
};

const sendArgs = z.object({
  name: z.string().min(1).max(120).describe("the client's name"),
  action: z.enum(["send", "skip"]).describe("send = send the prepared follow-up; skip = close it without sending"),
});
type SendArgs = z.infer<typeof sendArgs>;
const sendPayload = z.object({ followUpId: z.string(), client: z.string(), title: z.string(), action: z.enum(["send", "skip"]), channel: z.enum(["EMAIL", "TEXT"]) });

const sendFollowUp: WriteTool<SendArgs, z.infer<typeof sendPayload>> = {
  kind: "write",
  name: "send_follow_up",
  need: "clients.write",
  card: {
    label: "Send or skip a follow-up",
    purpose: "Send a follow-up that is waiting for a yes — read back word for word first — or skip it.",
    when: "'Send Olga's follow-up', 'skip the follow-up to John': send_follow_up(name, action). Only for follow-ups that are waiting (follow_ups lists them). To change the words, the person edits them on the CRM's Today tab.",
    objects: ["client", "proposal"],
    effect: "message",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "send Olga's follow-up", args: { name: "Olga", action: "send" } },
      { say: "skip the follow-up to John Lee", args: { name: "John Lee", action: "skip" } },
    ],
  },
  description:
    "Act on a follow-up that is waiting for a person. send: the prepared email or text is read back word for word and goes to the client only on a yes (a reminder with nothing written gets its words first). skip: closed without sending. If the client has accepted, declined or paid since, nothing is sent and the follow-up closes.",
  params: sendArgs,
  payload: sendPayload,
  async plan({ actor }, args) {
    const all = await readWaitingFollowUps(actor.organizationId, viewerOf(actor));
    const hits = byName(all, args.name);
    if (!hits.length) return { ok: false, say: all.length ? `No follow-up is waiting for ${args.name}. Waiting now: ${all.slice(0, 4).map((w) => w.client).join(", ")}.` : "No follow-ups are waiting for a yes right now." };
    const clients = [...new Set(hits.map((h) => h.clientId ?? h.client))];
    if (clients.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 3).map((h, i) => `${i + 1}. ${h.client} — ${h.title}`).join(" ")}` };
    // Several for one client: the one that has waited longest (the list is oldest first).
    let w = hits[0];
    if (args.action === "skip") {
      return { ok: true, payload: { followUpId: w.id, client: w.client, title: w.title, action: "skip", channel: w.channel }, readback: `Skip the follow-up to ${w.client} on ${w.title} — nothing is sent.` };
    }
    if (!w.draftBody) {
      // A reminder: the words are written now, so the yes is to words the person has heard.
      const ok = await prepareDraft(w.id).catch(() => false);
      const again = ok ? (await readWaitingFollowUps(actor.organizationId, viewerOf(actor))).find((x) => x.id === w.id) : null;
      if (!again?.draftBody) return { ok: false, say: `${w.client} has no email or phone on file — there is nowhere to send a follow-up. Call them, then tell me to skip it.` };
      w = again;
    }
    const how = w.channel === "TEXT" ? "Text" : "Email";
    const said = w.channel === "EMAIL" && w.draftSubject ? `subject "${w.draftSubject}": "${w.draftBody}"` : `"${w.draftBody}"`;
    return { ok: true, payload: { followUpId: w.id, client: w.client, title: w.title, action: "send", channel: w.channel }, readback: `${how} ${w.client} about ${w.title} — ${said}` };
  },
  async execute({ actor }, p) {
    if (p.action === "skip") {
      const r = await skipFollowUpAs(actor.organizationId, p.followUpId, { userId: actor.userId, name: actor.userName ?? null });
      return { say: r === "skipped" ? `Skipped — nothing went to ${p.client}.` : "That follow-up was already sent or closed." };
    }
    // Still waiting? Someone may have sent or skipped it on the page since the read-back.
    const still = (await readWaitingFollowUps(actor.organizationId, viewerOf(actor), 120)).some((w) => w.id === p.followUpId);
    if (!still) return { say: "That follow-up was already sent or closed — nothing new went out." };
    const sent = await dispatchOne(p.followUpId, actor.userId);
    if (!sent) return { say: `Not sent — the proposal for ${p.client} has moved on since (accepted, declined or paid). The follow-up is closed.` };
    return { say: `${p.channel === "TEXT" ? "Texted" : "Emailed"} ${p.client} the follow-up on ${p.title}.` };
  },
};

// ── promises ─────────────────────────────────────────────────────────────────

const promises: ReadTool<{ which: "due" | "open" | "waiting" | "kept" | "all"; name: string | null }> = {
  kind: "read",
  name: "promises",
  need: "clients.read",
  card: {
    label: "Promises",
    purpose: "What was promised to clients and by them, and whether it happened: overdue, due today, open, waiting on the client, kept.",
    when: "'What did we promise this week', 'what's overdue', 'what is Olga waiting on us for', 'what did the Lees say they'd do': promises(which, name). due = overdue + due today.",
    objects: ["client"],
    effect: "read",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "what promises are due today?", args: { which: "due", name: null } },
      { say: "what did we promise Olga?", args: { which: "all", name: "Olga" } },
    ],
  },
  description:
    "The promise tracker. Promises are caught from the messages people write to clients ('I'll send the revised quote Friday'), from what clients write, or added by hand. due = ours that are overdue or due today; open = ours not yet due; waiting = what clients said they would do; kept = closed in the last 7 days, with what proved it; all = everything open. Each line: client — the promise (when, whose).",
  params: z.object({
    which: z.enum(["due", "open", "waiting", "kept", "all"]).describe("due = overdue + due today; open = ours, later; waiting = the clients' promises; kept = recently kept; all = everything open"),
    name: z.string().max(120).nullable().describe("one client's name; null for everyone"),
  }),
  async run({ actor, now }, args) {
    const t = await readPromiseTracker(actor.organizationId, viewerOf(actor), now);
    const pick = (rows: TrackedPromise[]) => (args.name ? byName(rows, args.name) : rows);
    const line = (p: TrackedPromise) => promiseLine(p, now, t.tz);
    const overdue = pick(t.overdue);
    const today = pick(t.today);
    const open = pick(t.open);
    const waiting = pick(t.waiting);
    const kept = pick(t.kept);
    const counts = { overdue: overdue.length, dueToday: today.length, open: open.length, waitingOnClient: waiting.length, keptLast7Days: kept.length };
    const cut = (rows: TrackedPromise[]) => rows.slice(0, 10).map(line);
    if (args.which === "due") return { counts, overdue: cut(overdue), dueToday: cut(today), page: "/dashboard/crm" };
    if (args.which === "open") return { counts, open: cut(open), page: "/dashboard/crm" };
    if (args.which === "waiting") return { counts, waitingOnClient: cut(waiting), page: "/dashboard/crm" };
    if (args.which === "kept") return { counts, kept: cut(kept), page: "/dashboard/crm" };
    return { counts, overdue: cut(overdue), dueToday: cut(today), open: cut(open), waitingOnClient: cut(waiting), page: "/dashboard/crm" };
  },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const addArgs = z.object({
  name: z.string().min(1).max(120).describe("the client's name"),
  text: z.string().min(3).max(240).describe("what was promised, short, starting with the verb: 'send the revised quote'"),
  whose: z.enum(["ours", "theirs"]).describe("ours = we promised the client; theirs = the client promised us"),
  due: z.string().regex(DAY).nullable().describe("the day it is due, YYYY-MM-DD, or null when no day was said"),
});
type AddArgs = z.infer<typeof addArgs>;
const addPayload = addArgs.extend({ clientId: z.string(), client: z.string() });

const addPromiseTool: WriteTool<AddArgs, z.infer<typeof addPayload>> = {
  kind: "write",
  name: "add_promise",
  need: "clients.write",
  card: {
    label: "Track a promise",
    purpose: "Put a promise on the tracker: what we told a client we'd do (and by when), or what they told us.",
    when: "'I told Olga I'd send the revised quote Friday', 'the Lees said they'd decide by Monday': add_promise(name, text, whose, due). Work the day out from today's date; null when none was said.",
    objects: ["client"],
    effect: "record",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [{ say: "I promised Olga the revised quote by Friday", args: { name: "Olga", text: "send the revised quote", whose: "ours", due: "2026-11-13" } }],
  },
  description:
    "Add a promise to the tracker for a client. ours = the person speaking promised it (they get a reminder the day it is due, and once more if it goes late); theirs = the client said they would do it (it shows under 'waiting on client'). Many promises close on their own: a proposal sent, an invoice made, a visit booked, a payment, a signature.",
  params: addArgs,
  payload: addPayload,
  async plan({ actor, now }, args) {
    const hits = await findClients(actor.organizationId, args.name);
    if (!hits.length) return { ok: false, say: `I can't find a client named ${args.name}.` };
    if (hits.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 3).map((h, i) => `${i + 1}. ${h.name}${h.city ? ` (${h.city})` : ""}`).join(" ")}` };
    const c = hits[0];
    if (args.due && args.due < dayKey(now, actor.timezone)) return { ok: false, say: `${args.due} has already passed — which day is it due?` };
    const when = args.due ? dueWords(dueInstant(args.due).getTime(), now, actor.timezone) : "no day set";
    const readback = args.whose === "ours" ? `Track your promise to ${c.name}: "${args.text}" — ${when}.` : `Track what ${c.name} said they'd do: "${args.text}" — ${when}.`;
    return { ok: true, payload: { ...args, clientId: c.id, client: c.name }, readback };
  },
  async execute({ actor }, p) {
    await addPromise({
      organizationId: actor.organizationId,
      clientId: p.clientId,
      text: p.text,
      direction: p.whose === "ours" ? "OURS" : "THEIRS",
      dueAt: p.due ? dueInstant(p.due) : null,
      userId: actor.userId,
      sourceKind: "OPERATOR",
    });
    return { say: p.whose === "ours" ? `On the tracker${p.due ? " — I'll remind you the day it's due" : ""}.` : `On the tracker, under "waiting on client".` };
  },
};

const settleArgs = z.object({
  name: z.string().min(1).max(120).describe("the client's name"),
  about: z.string().max(160).nullable().describe("a few words of the promise when the client has more than one open; null otherwise"),
  outcome: z.enum(["kept", "canceled", "moved"]).describe("kept = it was done; canceled = it is not happening; moved = a new day"),
  day: z.string().regex(DAY).nullable().describe("the new day, YYYY-MM-DD — only with outcome moved"),
});
type SettleArgs = z.infer<typeof settleArgs>;
const settlePayload = z.object({ promiseId: z.string(), client: z.string(), text: z.string(), outcome: z.enum(["kept", "canceled", "moved"]), day: z.string().nullable() });

const settlePromiseTool: WriteTool<SettleArgs, z.infer<typeof settlePayload>> = {
  kind: "write",
  name: "settle_promise",
  need: "clients.write",
  card: {
    label: "Close or move a promise",
    purpose: "Mark a tracked promise kept, cancel it, or give it a new day.",
    when: "'Kept my promise to Olga', 'cancel the promise to the Lees', 'move Olga's quote to Monday': settle_promise(name, about, outcome, day). Use `about` only when that client has several open.",
    objects: ["client"],
    effect: "record",
    group: "people",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "kept my promise to Olga", args: { name: "Olga", about: null, outcome: "kept", day: null } },
      { say: "move the quote I promised John to Monday", args: { name: "John", about: "quote", outcome: "moved", day: "2026-11-16" } },
    ],
  },
  description:
    "Close or move one open promise on the tracker: kept (done), canceled (not happening), or moved to a new day (the reminder starts over). If the client has several open promises and `about` does not single one out, the choices are listed.",
  params: settleArgs,
  payload: settlePayload,
  async plan({ actor, now }, args) {
    const t = await readPromiseTracker(actor.organizationId, viewerOf(actor), now);
    const open = [...t.overdue, ...t.today, ...t.open, ...t.waiting];
    let hits = byName(open, args.name);
    if (!hits.length) return { ok: false, say: `There's no open promise with ${args.name} on the tracker.` };
    if (hits.length > 1 && args.about) {
      const words = norm(args.about).split(" ").filter((w) => w.length > 2);
      const scored = hits.map((h) => ({ h, n: words.filter((w) => norm(h.text).includes(w)).length })).sort((a, b) => b.n - a.n);
      if (scored[0].n > 0 && scored[0].n > (scored[1]?.n ?? 0)) hits = [scored[0].h];
    }
    // "Kept my promise to Olga" with one of ours and one of theirs open: it is ours they mean.
    if (hits.length > 1 && args.outcome === "kept") {
      const ours = hits.filter((h) => h.direction === "OURS");
      if (ours.length === 1) hits = ours;
    }
    if (hits.length > 1) return { ok: false, say: `Which one? ${hits.slice(0, 4).map((h, i) => `${i + 1}. ${h.client} — "${h.text}" (${dueWords(h.dueAt, now, t.tz)})`).join(" ")}` };
    const p = hits[0];
    if (args.outcome === "moved") {
      if (!args.day) return { ok: false, say: "Which day should it move to?" };
      if (args.day < dayKey(now, t.tz)) return { ok: false, say: `${args.day} has already passed — which day?` };
    }
    const readback =
      args.outcome === "kept"
        ? `Mark kept — ${p.client}: "${p.text}".`
        : args.outcome === "canceled"
          ? `Take off the tracker — ${p.client}: "${p.text}". It won't count as kept.`
          : `Move to ${dueWords(dueInstant(args.day as string).getTime(), now, t.tz).replace(/^due /, "")} — ${p.client}: "${p.text}".`;
    return { ok: true, payload: { promiseId: p.id, client: p.client, text: p.text, outcome: args.outcome, day: args.outcome === "moved" ? args.day : null }, readback };
  },
  async execute({ actor }, p) {
    const ok =
      p.outcome === "moved" ? (p.day ? await movePromise(actor.organizationId, p.promiseId, dueInstant(p.day)) : false) : await settlePromise(actor.organizationId, p.promiseId, p.outcome === "kept" ? "KEPT" : "CANCELED");
    if (!ok) return { say: "That promise was already closed." };
    return { say: p.outcome === "kept" ? `Marked kept — ${p.client}.` : p.outcome === "canceled" ? "Taken off the tracker." : "Moved. I'll remind you on the new day." };
  },
};

export const FOLLOW_UP_TOOLS = [followUps, sendFollowUp, promises, addPromiseTool, settlePromiseTool] as const;
