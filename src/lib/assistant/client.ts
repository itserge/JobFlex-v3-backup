import "server-only";
// THE CLIENT'S PAGE FOR THE AI OPERATOR (the client build, 2026-11-06) — "Send the Bennetts the project update",
// "share the kitchen's page with Smith", "show me the permit for the Smith kitchen", "what documents are on the
// deck project". One write and one read, thin calls into lib/projectClient; the update is read back for a yes
// like every other change (lib/assistant/tools).

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { projectNamed } from "@/lib/assistant/projects";
import { filesOf, sendUpdate, shareOf } from "@/lib/projectClient/server";
import { stagesOf } from "@/lib/projectStages/server";
import { currentStage } from "@/lib/projectStages/shared";
import { progressWords } from "@/lib/projectClient/shared";

const ID = z.string().min(1).max(64);

type UpdateArgs = { projectId: string; note: string | null };
type UpdatePayload = { projectId: string; note: string | null; words: string };

const sendProjectUpdate: WriteTool<UpdateArgs, UpdatePayload> = {
  kind: "write",
  name: "send_project_update",
  need: "projects.write",
  card: {
    label: "Project update to the client",
    purpose: "Send the homeowner where their project stands, with the link to their project page.",
    when: "'Send Smith the project update', 'share the kitchen's page with the Bennetts', 'tell the client tile goes in this week': send_project_update with the project id and their words as the note (or null).",
    objects: ["project", "client"],
    effect: "message",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "send the Bennetts the kitchen update — tile goes in this week", args: { projectId: "proj_1", note: "Tile goes in this week." } }],
  },
  description:
    "Email the project's client where the project stands (% done, the stage it is on, the next days on site) with the link to their project page — progress, photos the office chose, documents, the next payment with a Pay button — and text them the link too when the company texts its clients and they agreed. Give the project id (find, kind project) and a note of the person's own, or null. Use for: send Smith the update, share the project page, tell the client about this week.",
  params: z.object({ projectId: ID, note: z.string().max(600).nullable() }),
  payload: z.object({ projectId: ID, note: z.string().nullable(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await db.project.findFirst({ where: { id: args.projectId, organizationId: actor.organizationId }, select: { id: true, name: true } });
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const [share, read] = await Promise.all([shareOf(actor.organizationId, p.id), stagesOf(p.id)]);
    if (!share.clientEmail && !share.clientPhone) return { ok: false, say: `${p.name} has no client email or phone on file — add one on the client record first.` };
    const progress = progressWords(read.done, currentStage(read.stages)?.name ?? null);
    const how = [share.clientEmail ? `by email to ${share.clientEmail}` : null, share.clientPhone && share.textsOn ? `and a text to ${share.clientPhone} if they have agreed to texts` : null].filter(Boolean).join(" ");
    const words = `Send ${share.clientName ?? "the client"} the ${p.name} update — ${progress} — ${how}`;
    return { ok: true, payload: { projectId: p.id, note: args.note?.trim() || null, words }, readback: `${words}?${args.note?.trim() ? ` With your note: "${args.note.trim()}".` : ""}${share.photosShared ? ` Their page shows ${share.photosShared} photo${share.photosShared === 1 ? "" : "s"}.` : " No photos are chosen for their page yet (Choose photos on the project)."}` };
  },
  async execute({ actor }, payload) {
    const r = await sendUpdate(actor.organizationId, payload.projectId, actor.userId, payload.note);
    return { say: `Done — ${r.words} Their page: ${r.href}`, result: r };
  },
};

const projectFiles: ReadTool<{ projectId: string | null; query: string | null; file: string | null }> = {
  kind: "read",
  name: "project_files",
  need: "projects.read",
  card: {
    label: "Project files",
    purpose: "The documents on a project — the contract, the permit, the plans — and the link to one.",
    when: "'Show me the permit for the Smith kitchen', 'what documents are on the deck project', 'where's the signed contract': project_files with the project id or words from its name, and the file asked for (or null for all).",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "show me the permit for the Smith kitchen", args: { projectId: null, query: "Smith kitchen", file: "permit" } }],
  },
  description: "The files on a project (contract, permit, plans, warranty, invoices, documents) with a link to each, and whether the client sees it. Give the project id or words from its name; `file` = the one asked for by name or kind, or null for the list. Use for: show me the permit, where's the contract, what documents are on the project.",
  params: z.object({ projectId: ID.nullable(), query: z.string().max(80).nullable(), file: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const r = await projectNamed(actor.organizationId, args);
    if ("several" in r) return { several: r.several, ask: "Which one?" };
    if (!("one" in r) || !r.one) return { error: "No project matched. Try the client's name or the project's number." };
    const files = await filesOf(r.one.id);
    const rows = files.map((f) => ({ name: f.name, kind: f.kindLabel, link: f.href, clientSees: f.clientVisible, added: f.at.slice(0, 10) }));
    if (!args.file) return { project: r.one.name, files: rows, note: rows.length ? null : "No files on this project yet — the office adds them on the Client's page card." };
    const q = args.file.toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const score = (f: (typeof rows)[number]) => terms.reduce((n, t) => n + (f.name.toLowerCase().includes(t) ? 2 : 0) + (f.kind.toLowerCase().includes(t) ? 1 : 0), 0);
    const best = [...rows].sort((a, b) => score(b) - score(a))[0];
    return best && score(best) > 0 ? { project: r.one.name, match: best, others: rows.filter((x) => x !== best).map((x) => x.name) } : { project: r.one.name, match: null, files: rows, note: `Nothing on ${r.one.name} matches "${args.file}".` };
  },
};

export const CLIENT_TOOLS = [sendProjectUpdate, projectFiles];
