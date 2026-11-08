import "server-only";
// THE CLIENT'S STORY, FOR THE OPERATOR (Smart CRM part 1, 2026-11-08): "where does Olga stand", "what did John
// Smith ask for yesterday" — answered from the same timeline, memory and brief the client's page draws (lib/
// clientTimeline, lib/clientMemory), never from the model's own recall. And the duplicate fold: merge_clients runs
// lib/clientMerge after a read-back and a yes, like every change.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { findClients } from "@/lib/assistant/find";
import { readClientTimeline, type ClientRef } from "@/lib/clientTimeline/server";
import { readClientMemory } from "@/lib/clientMemory";
import { duplicatesOf, mergeClients } from "@/lib/clientMerge";

const dayWords = (d: Date, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
};

async function clientFor(organizationId: string, clientId: string | null, name: string | null): Promise<ClientRef | { pick: string } | null> {
  if (clientId) {
    const c = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true, organizationId: true, name: true, email: true, phone: true } });
    return c ?? null;
  }
  if (!name) return null;
  const hits = await findClients(organizationId, name);
  if (!hits.length) return null;
  if (hits.length > 1) return { pick: hits.slice(0, 3).map((h, i) => `${i + 1}. ${h.name}${h.city ? ` (${h.city})` : ""} — ${h.id}`).join("; ") };
  return { id: hits[0].id, organizationId, name: hits[0].name, email: hits[0].email, phone: hits[0].phone };
}

const clientStory: ReadTool<{ clientId: string | null; name: string | null; days: number | null }> = {
  kind: "read",
  name: "client_story",
  need: "clients.read",
  card: {
    label: "Client story",
    purpose: "Where a client stands: the saved brief, the remembered facts, open promises, and their timeline — every message, call, visit, proposal and payment, newest first.",
    when: "'Where does Olga stand', 'what did John Smith ask for yesterday', 'what did we promise the Lees': client_story(name). Answer from the lines it returns — the brief is an AI reading, so money and dates come from the timeline lines, not the summary.",
    objects: ["client", "proposal", "money"],
    effect: "read",
    group: "lookups",
    version: 1,
    since: "2026-11-08",
    samples: [
      { say: "where does Olga Holmes stand?", args: { clientId: null, name: "Olga Holmes", days: null } },
      { say: "what did John Smith ask for yesterday?", args: { clientId: null, name: "John Smith", days: 2 } },
    ],
  },
  description:
    "One client's whole story: the saved brief (an AI reading), the remembered facts with their sources, open promises, and the timeline — proposals, visits, calls, texts, emails, payments, reviews, project steps — newest first. Pass `days` to keep only the last N days of timeline. Use for: where does this client stand, what did they ask for, what did we promise them, when did they last pay.",
  params: z.object({
    clientId: z.string().max(64).nullable().describe("the client's id when known (from find); else null"),
    name: z.string().max(120).nullable().describe("the client's name as said, when no id is known"),
    days: z.number().int().min(1).max(365).nullable().describe("only the last N days of the timeline; null = the newest 30 lines whatever their age"),
  }),
  async run({ actor, now }, args) {
    const who = await clientFor(actor.organizationId, args.clientId, args.name);
    if (!who) return { notFound: `No client matches ${args.name ?? args.clientId ?? "that"}. find can search wider.` };
    if ("pick" in who) return { several: `More than one matches — which one? ${who.pick}` };
    const [timeline, memory] = await Promise.all([readClientTimeline(who, 120), readClientMemory(actor.organizationId, who.id)]);
    const since = args.days ? now.getTime() - args.days * 86_400_000 : null;
    const lines = (since ? timeline.filter((e) => e.at.getTime() >= since) : timeline).slice(0, 30);
    const tz = actor.timezone;
    return {
      client: { id: who.id, name: who.name, email: who.email, phone: who.phone },
      brief: memory.brief ? { aiReading: memory.brief.summary, next: memory.brief.nextAction } : null,
      facts: memory.facts.slice(0, 12).map((f) => `(${f.category.toLowerCase()}) ${f.fact}${f.supersededText ? ` [was: ${f.supersededText}]` : ""}`),
      openPromises: memory.promises.filter((p) => p.status === "OPEN").map((p) => `${p.direction === "THEIRS" ? "they" : "we"}: ${p.text}${p.dueAt ? ` — due ${dayWords(p.dueAt, tz)}` : ""}`),
      timeline: lines.map((e) => `${dayWords(e.at, tz)} · ${e.stamp}: ${e.title}${e.detail ? ` (${e.detail})` : ""}`),
      page: `/dashboard/client-detail?client=${who.id}`,
    };
  },
};

const mergeArgs = z.object({
  keepId: z.string().max(64).describe("the client record that STAYS (find gives ids)"),
  foldId: z.string().max(64).describe("the duplicate record that folds into it and is archived"),
});

const mergeTool: WriteTool<z.infer<typeof mergeArgs>, z.infer<typeof mergeArgs>> = {
  kind: "write",
  name: "merge_clients",
  need: "clients.write",
  card: {
    label: "Merge duplicates",
    purpose: "Fold two records of the same person into one: everything moves to the kept record, the duplicate is archived, nothing is deleted.",
    when: "'Those two Olgas are the same person', 'merge the duplicate John Smith': find both ids first, then merge_clients(keepId, foldId) — keep the record with the history. It is read back and runs on their yes.",
    objects: ["client"],
    effect: "record",
    group: "people",
    version: 1,
    since: "2026-11-08",
    samples: [{ say: "merge the two Olga Holmes records, keep the older one", args: { keepId: "c_1", foldId: "c_2" } }],
  },
  description:
    "Fold a duplicate client record into the one to keep: its proposals, jobs, projects, invoices, payments, visits, reviews, plans, equipment, memory and promises all move; blank contact fields fill from the duplicate; the duplicate is archived (never deleted) and the merge is logged. Find both ids with find first. Use when two records are the same person (a shared email or phone).",
  params: mergeArgs,
  payload: mergeArgs,
  async plan({ actor }, args) {
    const [keep, fold] = await Promise.all([
      db.client.findFirst({ where: { id: args.keepId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true } }),
      db.client.findFirst({ where: { id: args.foldId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true } }),
    ]);
    if (!keep || !fold) return { ok: false, say: "I can't find both records — find them by name first and give me the two ids." };
    if (keep.id === fold.id) return { ok: false, say: "That's the same record twice — which duplicate should fold into it?" };
    const dup = await duplicatesOf({ id: keep.id, organizationId: actor.organizationId, email: keep.email, phone: keep.phone });
    const shares = dup.find((d) => d.id === fold.id)?.via;
    return {
      ok: true,
      payload: args,
      readback: `Fold "${fold.name}" into "${keep.name}"${shares ? ` (they share ${shares})` : " — careful: they share no email or phone"}. Proposals, payments, visits, messages and memory move; the duplicate is archived. Nothing is deleted.`,
    };
  },
  async execute({ actor }, p) {
    const r = await mergeClients(actor.organizationId, p.keepId, p.foldId, actor.userId);
    if (!r.ok) return { say: `That merge didn't go through: ${r.error}` };
    const moved = Object.entries(r.moved ?? {}).map(([k, n]) => `${n} ${k}`).join(", ");
    return { say: `Merged. ${moved ? `Moved ${moved}.` : "The duplicate had nothing of its own."} The kept record's summary rebuilds the next time it opens.`, result: { moved: r.moved } };
  },
};

export const CLIENT_360_TOOLS = [clientStory, mergeTool] as const;
