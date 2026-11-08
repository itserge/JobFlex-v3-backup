import "server-only";
// THE CLIENT'S PROJECT PAGE AND FILES — the database half (the client build, 2026-11-06). The rules are ./shared.ts.
//
//   · ensureShare / shareOf — the homeowner's link (/p/<token>), made the first time the office shares the project;
//                             what the office's card shows: the link, when it was shared, the last update, the files.
//   · clientView            — what the homeowner sees from their link, and nothing else: the company, the project,
//                             % done with the stages ticked, the next days on site, the photos the office chose, the
//                             documents marked for them, what is paid and the next payment with its Pay link.
//   · sendUpdate            — the update to the client: an email with the page's link (and a text when the company
//                             texts its clients and the client agreed), stamped on the project.
//   · projectPhotos / setPhotosShared — the project's jobs' photos for the office to choose from.
//   · addFile / setFileVisible / removeFile / filesOf — the contract, the permit, the plans… uploaded into the
//                             private store or linked; the client sees the ones marked; the crew sees them all.
//   · part 7 (2026-11-08, the plan "Projects: Remodel and New construction"): the homeowner's page gains a new
//                             build's phases with what closes each, the choices to make with the day each is needed
//                             by (clientChoose — their one write, from the page), the loan's draws and the photos under
//                             their phase; cost-plus is the one contract that shows costs. ensureLenderShare /
//                             lenderView: the lender's read-only page (/l/<token>) — the draws with their bundles,
//                             the inspections, the photos; never the budget, the margin or a note.

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { contractSchedule } from "@/lib/contractTotal";
import type { EmailDoc } from "@/lib/email/doc";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import { mediaOf } from "@/lib/jobMediaShared";
import { localDayKey } from "@/lib/jobProgressShared";
import { deleteStored, putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { toE164 } from "@/lib/phone";
import { safeFilename } from "@/lib/safeHref";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { drawsOf } from "@/lib/projectDraws/server";
import { parseAnswers } from "@/lib/projectKind";
import { phasesOf, type PhasesRead } from "@/lib/projectPhases/server";
import { selectionsOf } from "@/lib/projectSelections/server";
import { stagesOf, type StageRow } from "@/lib/projectStages/server";
import { currentStage, projectNo } from "@/lib/projectStages/shared";
import { dayKeyIn } from "@/lib/projectTimeline/shared";
import { sendText, textOffice } from "@/lib/sms/send";
import { FILE_DATA_URL, FILE_KIND_LABEL, FILE_MAX_BYTES, clientDueWords, clientGateWords, clientUpdateText, costPlusWords, fileKindOf, lenderDrawWords, nextDaysWords, photosByPhase, progressWords, safeFileLink, type FileKind } from "./shared";

const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];
const orgSelect = { id: true, name: true, phone: true, logoUrl: true, billingEmail: true, website: true, timezone: true, smsClientsOn: true, gmailSettingsJson: true, gmailTokensJson: true, deletedAt: true } as const;

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, number: true, clientId: true, publicToken: true, sharedAt: true, updateSentAt: true, lenderToken: true, lenderSharedAt: true, client: { select: { name: true, email: true, phone: true } }, organization: { select: orgSelect } } });
  if (!p) throw new Error("Project not found");
  return p;
}

// ── the link ─────────────────────────────────────────────────────────────────

export async function ensureShare(organizationId: string, projectId: string, actorId: string | null): Promise<{ token: string; href: string }> {
  const p = await projectOf(organizationId, projectId);
  let token = p.publicToken;
  if (!token) {
    token = randomUUID();
    await db.project.update({ where: { id: p.id }, data: { publicToken: token, sharedAt: new Date() } });
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Made the client's page for ${p.name}`, clientId: p.clientId, meta: { projectId } });
  }
  return { token, href: `${await appBaseUrl()}/p/${token}` };
}

export type FileRow = { id: string; name: string; kind: FileKind; kindLabel: string; href: string; isLink: boolean; bytes: number | null; clientVisible: boolean; at: string };
export type ShareRead = {
  token: string | null;
  href: string | null;
  sharedAt: string | null;
  updateSentAt: string | null;
  photosShared: number;
  files: FileRow[];
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  textsOn: boolean;
};

export async function filesOf(projectId: string): Promise<FileRow[]> {
  const rows = await db.projectFile.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, kind: true, url: true, isLink: true, bytes: true, clientVisible: true, createdAt: true } });
  return rows.map((f) => {
    const kind = fileKindOf(f.kind);
    return { id: f.id, name: f.name, kind, kindLabel: FILE_KIND_LABEL[kind], href: f.isLink ? f.url : (mediaHref(f.url, { download: null }) ?? f.url), isLink: f.isLink, bytes: f.bytes, clientVisible: f.clientVisible, at: f.createdAt.toISOString() };
  });
}

export async function shareOf(organizationId: string, projectId: string): Promise<ShareRead> {
  const p = await projectOf(organizationId, projectId);
  const [photosShared, files] = await Promise.all([db.jobPhoto.count({ where: { job: { projectId }, sharedAt: { not: null } } }), filesOf(projectId)]);
  return {
    token: p.publicToken,
    href: p.publicToken ? `${await appBaseUrl()}/p/${p.publicToken}` : null,
    sharedAt: p.sharedAt ? p.sharedAt.toISOString() : null,
    updateSentAt: p.updateSentAt ? p.updateSentAt.toISOString() : null,
    photosShared,
    files,
    clientName: p.client?.name ?? null,
    clientEmail: p.client?.email?.trim() || null,
    clientPhone: p.client?.phone?.trim() || null,
    textsOn: p.organization.smsClientsOn,
  };
}

// ── photos ───────────────────────────────────────────────────────────────────

export type PhotoRow = { id: string; href: string; kind: string; caption: string | null; jobTitle: string; at: string; shared: boolean };

/** The project's jobs' photos (not videos), newest first, for the office to choose from. */
export async function projectPhotos(organizationId: string, projectId: string): Promise<PhotoRow[]> {
  const rows = await db.jobPhoto.findMany({
    where: { job: { projectId, organizationId } },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { id: true, url: true, kind: true, caption: true, createdAt: true, sharedAt: true, analysis: true, media: true, contentType: true, job: { select: { title: true } } },
  });
  return rows
    .filter((p) => mediaOf(p).media === "photo")
    .slice(0, 80)
    .map((p) => ({ id: p.id, href: mediaHref(p.url) ?? p.url, kind: p.kind, caption: p.caption, jobTitle: p.job.title, at: p.createdAt.toISOString(), shared: Boolean(p.sharedAt) }));
}

export async function setPhotosShared(organizationId: string, photoIds: string[], shared: boolean): Promise<{ changed: number }> {
  if (!photoIds.length) return { changed: 0 };
  const r = await db.jobPhoto.updateMany({ where: { id: { in: photoIds }, job: { organizationId } }, data: { sharedAt: shared ? new Date() : null } });
  return { changed: r.count };
}

// ── files ────────────────────────────────────────────────────────────────────

export type FileInput = { name: string; kind: string; dataUrl?: string | null; link?: string | null; clientVisible: boolean };

export async function addFile(organizationId: string, projectId: string, input: FileInput, actorId: string | null): Promise<{ id: string }> {
  const p = await projectOf(organizationId, projectId);
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name the file");
  const kind = fileKindOf(input.kind);
  let url: string;
  let contentType: string | null = null;
  let bytes: number | null = null;
  let isLink = false;
  if (input.link) {
    const link = safeFileLink(input.link);
    if (!link) throw new Error("That link does not look right — it needs to start with https://");
    url = link;
    isLink = true;
  } else if (input.dataUrl) {
    const m = input.dataUrl.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i);
    if (!m || !FILE_DATA_URL.test(input.dataUrl)) throw new Error("A photo or a PDF, please");
    const buf = Buffer.from(m[2], "base64");
    if (buf.byteLength > FILE_MAX_BYTES) throw new Error("That file is over 8 MB — paste a link to it instead");
    contentType = m[1].toLowerCase();
    bytes = buf.byteLength;
    const ext = contentType === "application/pdf" ? "pdf" : contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const base = safeFilename(name, "file").replace(/\.[a-z0-9]+$/i, "");
    url = (await putPrivate(`projects/${p.id}/${Date.now()}-${base}.${ext}`, buf, contentType)).url;
  } else {
    throw new Error("Pick a file or paste a link");
  }
  const row = await db.projectFile.create({ data: { organizationId, projectId: p.id, name, kind, url, contentType, bytes, isLink, clientVisible: input.clientVisible, uploadedById: actorId }, select: { id: true } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added ${FILE_KIND_LABEL[kind].toLowerCase()} "${name}" to ${p.name}${input.clientVisible ? " — on the client's page" : ""}`, clientId: p.clientId, meta: { projectId, fileId: row.id } });
  return row;
}

export async function setFileVisible(organizationId: string, fileId: string, visible: boolean): Promise<{ projectId: string }> {
  const f = await db.projectFile.findFirst({ where: { id: fileId, organizationId }, select: { id: true, projectId: true } });
  if (!f) throw new Error("File not found");
  await db.projectFile.update({ where: { id: f.id }, data: { clientVisible: visible } });
  return { projectId: f.projectId };
}

export async function removeFile(organizationId: string, fileId: string): Promise<{ projectId: string }> {
  const f = await db.projectFile.findFirst({ where: { id: fileId, organizationId }, select: { id: true, projectId: true, url: true, isLink: true } });
  if (!f) throw new Error("File not found");
  await db.projectFile.delete({ where: { id: f.id } });
  if (!f.isLink) await deleteStored(f.url).catch(() => null);
  return { projectId: f.projectId };
}

// ── the homeowner's page ─────────────────────────────────────────────────────

export type ClientPhase = { id: string; name: string; state: "done" | "now" | "next"; stagesDone: number; stageCount: number; gate: string; stages: Array<{ name: string; state: "done" | "now" | "next" }> };
export type ClientPhoto = { id: string; href: string; caption: string | null; at: string };
export type ClientSelection = { id: string; name: string; dueWords: string; allowance: number | null; chosen: string | null; chosenAt: string | null; canChoose: boolean };
export type ClientDraws = { funded: number; total: number; held: number; rows: Array<{ number: number; name: string; amount: number; state: string; words: string }> };

export type ClientView = {
  company: { name: string; phone: string | null; email: string | null; logoUrl: string | null; website: string | null };
  project: { name: string; number: string; status: string; clientFirst: string | null; kind: "REMODEL" | "NEW_BUILD" };
  progress: { done: number | null; words: string; stages: Array<{ name: string; state: "done" | "now" | "next" }> };
  /** A new build's phases (part 7): where each stands and what closes it, in the homeowner's words; the current one
   *  carries its stages. Empty on a remodel. */
  phases: ClientPhase[];
  /** What the client has to choose (part 7), each with the day it is needed by; a chosen one with what they picked.
   *  Never the office's note or the suggested allowance. */
  selections: ClientSelection[];
  nextDays: Array<{ day: string; label: string; jobTitle: string }>;
  photos: ClientPhoto[];
  /** The photos under their phase on a new build (part 7); one group with no name otherwise. */
  photoGroups: Array<{ phase: string | null; photos: ClientPhoto[] }>;
  files: Array<{ id: string; name: string; kindLabel: string; href: string; isLink: boolean }>;
  payments: Array<{ title: string; paid: number; total: number; remaining: number; next: { label: string; amount: number; href: string } | null }>;
  /** The construction loan's draws on a build with a lender (part 7), in the borrower's words; null otherwise. */
  draws: ClientDraws | null;
  /** Cost-plus only (part 7): the costs so far by phase and the fee's words — the one contract where the client sees
   *  costs; null on every other. */
  costs: { words: string; total: number; rows: Array<{ phase: string; spent: number }> } | null;
  finished: boolean;
  warrantyUntil: string | null;
  finalInspectionPassed: boolean;
};

/** The phases as the homeowner and the lender read them: done · now · next, the stages done, what closes each (in
 *  their words), and the current one's stages. */
function phaseRows(phases: PhasesRead, stages: readonly StageRow[]): ClientPhase[] {
  const now = currentStage(stages);
  return phases.phases.map((ph) => {
    const mine = stages.filter((s) => s.phaseId === ph.id);
    const state: ClientPhase["state"] = ph.status === "DONE" ? "done" : ph.id === phases.current?.id ? "now" : "next";
    // The current phase lists its stages — unless it has just the one, named as the phase is (nothing to add).
    const listStages = state === "now" && !(mine.length === 1 && mine[0].name === ph.name);
    return {
      id: ph.id,
      name: ph.name,
      state,
      stagesDone: ph.stagesDone,
      stageCount: ph.stageCount,
      gate: clientGateWords(ph),
      stages: listStages ? mine.map((s) => ({ name: s.name, state: s.status === "DONE" ? ("done" as const) : s.id === now?.id ? ("now" as const) : ("next" as const) })) : [],
    };
  });
}

function photoGroupsOf(photos: ClientPhoto[], stages: readonly StageRow[], phases: PhasesRead, tz: string): Array<{ phase: string | null; photos: ClientPhoto[] }> {
  if (!phases.phases.length) return photos.length ? [{ phase: null, photos }] : [];
  return photosByPhase(
    photos,
    stages.map((s) => ({ phaseId: s.phaseId ?? null, lane: s.lane ?? null, startsAt: s.startsAt, endsAt: s.endsAt, doneAt: s.doneAt, position: s.position })),
    phases.phases.map((p) => ({ id: p.id, name: p.name, position: p.position })),
    (iso) => dayKeyIn(new Date(iso), tz),
  );
}

export async function clientView(token: string): Promise<ClientView | null> {
  const p = await db.project.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      organizationId: true,
      name: true,
      number: true,
      status: true,
      kind: true,
      answersJson: true,
      moneyMode: true,
      marginPct: true,
      feeAmount: true,
      warrantyUntil: true,
      client: { select: { name: true } },
      organization: { select: orgSelect },
      jobs: { where: { status: { not: "CANCELED" } }, select: { id: true, title: true } },
      proposals: { where: { status: { in: SOLD } }, orderBy: { total: "desc" }, select: { id: true, title: true, publicId: true, total: true, currency: true, installments: { orderBy: { position: "asc" } }, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } } },
      inspections: { where: { isFinal: true }, take: 1, select: { result: true } },
    },
  });
  if (!p || p.organization.deletedAt) return null;
  const tz = p.organization.timezone || "America/New_York";
  const today = localDayKey(new Date(), tz);
  const jobIds = p.jobs.map((j) => j.id);
  const titleOf = new Map(p.jobs.map((j) => [j.id, j.title]));
  const kind: ClientView["project"]["kind"] = p.kind === "NEW_BUILD" ? "NEW_BUILD" : "REMODEL";
  const lender = kind === "NEW_BUILD" && parseAnswers(p.answersJson).build?.lender === true;
  const [read, phases, selections, drawsRead, events, photos, files, base] = await Promise.all([
    stagesOf(p.id),
    phasesOf(p.id),
    selectionsOf(p.organizationId, p.id),
    lender ? drawsOf(p.organizationId, p.id) : Promise.resolve(null),
    jobIds.length ? db.jobEvent.findMany({ where: { jobId: { in: jobIds }, startsAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { startsAt: "asc" }, take: 40, select: { jobId: true, startsAt: true } }) : Promise.resolve([]),
    jobIds.length ? db.jobPhoto.findMany({ where: { jobId: { in: jobIds }, sharedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, url: true, caption: true, createdAt: true, analysis: true, media: true, contentType: true } }) : Promise.resolve([]),
    db.projectFile.findMany({ where: { projectId: p.id, clientVisible: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, kind: true, url: true, isLink: true } }),
    appBaseUrl(),
  ]);
  // Cost-plus is the one contract where the client sees the costs: what was spent, by phase.
  const costRows = p.moneyMode === "COST_PLUS" ? await db.projectExpense.groupBy({ by: ["phaseId"], where: { projectId: p.id }, _sum: { amount: true } }) : [];
  const phasePos = new Map(phases.phases.map((ph) => [ph.id, { name: ph.name, position: ph.position }]));
  const costs: ClientView["costs"] =
    p.moneyMode === "COST_PLUS"
      ? {
          words: costPlusWords({ feeAmount: p.feeAmount, marginPct: p.marginPct }),
          total: costRows.reduce((n, r) => n + (r._sum.amount ?? 0), 0),
          rows: costRows
            .map((r) => ({ phase: r.phaseId ? (phasePos.get(r.phaseId)?.name ?? "Other") : "Not on a phase", position: r.phaseId ? (phasePos.get(r.phaseId)?.position ?? 1e9) : 1e9 + 1, spent: r._sum.amount ?? 0 }))
            .filter((r) => r.spent > 0)
            .sort((a, b) => a.position - b.position)
            .map((r) => ({ phase: r.phase, spent: r.spent })),
        }
      : null;
  const now = currentStage(read.stages);
  const seenDay = new Set<string>();
  const nextDays: ClientView["nextDays"] = [];
  for (const e of events) {
    const day = dayKeyIn(e.startsAt, tz);
    if (day < today || seenDay.has(day)) continue;
    seenDay.add(day);
    nextDays.push({ day, label: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }), jobTitle: (e.jobId && titleOf.get(e.jobId)) || "" });
    if (nextDays.length >= 5) break;
  }
  const payments: ClientView["payments"] = p.proposals.map((pr) => {
    const sch = resolveSchedule({ ...contractSchedule(pr.total, pr.changeOrders), currency: pr.currency, installments: pr.installments });
    const next = sch.stages.find((st) => st.payable && (st.status === "UNPAID" || st.status === "PENDING")) ?? null;
    const balanceDue = !next && sch.hasBalanceRow && sch.nextPayableId === null && sch.balanceMinor > 0;
    const pay = next
      ? { label: next.label, amount: fromMinor(next.amountMinor), href: `${base}/portal/q/${pr.publicId}?pay=${encodeURIComponent(next.id)}&method=any` }
      : balanceDue
        ? { label: "Balance", amount: fromMinor(sch.balanceMinor), href: `${base}/portal/q/${pr.publicId}?method=any` }
        : null;
    return { title: pr.title, paid: fromMinor(sch.paidMinor), total: fromMinor(sch.totalMinor), remaining: fromMinor(sch.remainingMinor), next: pay };
  });
  const photoRows: ClientPhoto[] = photos.filter((x) => mediaOf(x).media === "photo").slice(0, 24).map((x) => ({ id: x.id, href: mediaHref(x.url) ?? x.url, caption: x.caption, at: x.createdAt.toISOString() }));
  return {
    company: { name: p.organization.name, phone: p.organization.phone, email: p.organization.billingEmail, logoUrl: p.organization.logoUrl, website: p.organization.website },
    project: { name: p.name, number: projectNo(p.number), status: p.status, clientFirst: p.client?.name?.trim().split(/\s+/)[0] ?? null, kind },
    progress: {
      done: read.done,
      words: progressWords(read.done, now?.name ?? null),
      stages: read.stages.map((s) => ({ name: s.name, state: s.status === "DONE" ? "done" : s.id === now?.id ? "now" : "next" })),
    },
    phases: phaseRows(phases, read.stages),
    selections: selections.selections
      .filter((s) => s.state === "chosen" || !s.stageDone)
      .map((s) => ({ id: s.id, name: s.name, dueWords: s.state === "chosen" ? "" : clientDueWords(s.due, selections.today), allowance: s.allowance, chosen: s.state === "chosen" ? s.chosen : null, chosenAt: s.state === "chosen" ? s.chosenAt : null, canChoose: !s.stageDone })),
    nextDays,
    photos: photoRows,
    photoGroups: photoGroupsOf(photoRows, read.stages, phases, tz),
    files: files.map((f) => ({ id: f.id, name: f.name, kindLabel: FILE_KIND_LABEL[fileKindOf(f.kind)], href: f.isLink ? f.url : (mediaHref(f.url) ?? f.url), isLink: f.isLink })),
    payments,
    draws: drawsRead && drawsRead.draws.length ? { funded: drawsRead.funded, total: drawsRead.total, held: drawsRead.held, rows: drawsRead.draws.map((d) => ({ number: d.number, name: d.name, amount: d.amount, state: d.state, words: lenderDrawWords(d) })) } : null,
    costs,
    finished: p.status === "COMPLETED" || p.status === "ARCHIVED",
    warrantyUntil: p.warrantyUntil ? p.warrantyUntil.toISOString().slice(0, 10) : null,
    finalInspectionPassed: p.inspections[0]?.result === "PASSED",
  };
}

/** The homeowner's one write, from their page: what they chose for a selection on the token's project. The vendor
 *  and the price the office entered stay; the choice is stamped with no actor (the client's), logged, and the office
 *  is told. Refused once the stage is done. */
export async function clientChoose(token: string, selectionId: string, chosenRaw: string): Promise<{ ok: true; words: string } | { ok: false; error: string }> {
  const p = await db.project.findUnique({ where: { publicToken: token }, select: { id: true, name: true, organizationId: true, clientId: true, organization: { select: { deletedAt: true, name: true, logoUrl: true, phone: true } } } });
  if (!p || p.organization.deletedAt) return { ok: false, error: "This link is not valid." };
  const sel = await db.projectSelection.findFirst({ where: { id: selectionId, projectId: p.id }, select: { id: true, name: true, allowance: true, stage: { select: { name: true, status: true } } } });
  if (!sel) return { ok: false, error: "That choice is not on your list any more — refresh the page." };
  if (sel.stage?.status === "DONE") return { ok: false, error: `${sel.stage.name} is done — call the office about ${sel.name}.` };
  const chosen = chosenRaw.trim().slice(0, 500);
  if (!chosen) return { ok: false, error: "Say what you chose." };
  await db.projectSelection.update({ where: { id: sel.id }, data: { chosen, chosenAt: new Date(), chosenById: null } });
  const words = `${sel.name}: ${chosen}`;
  const short = chosen.length > 160 ? `${chosen.slice(0, 157)}…` : chosen;
  await logActivity({ organizationId: p.organizationId, actorId: null, kind: TRAIL_KINDS.PROJECT, summary: `The client chose ${words} on ${p.name} — from their page`, clientId: p.clientId, meta: { projectId: p.id, selectionId: sel.id, byClient: true } });
  await tellOffice(p.organizationId, p.id, `${p.name}: the client chose ${sel.name}: ${short}${sel.allowance != null ? ` (allowance $${Math.round(sel.allowance).toLocaleString("en-US")})` : ""}.`, p.organization);
  return { ok: true, words };
}

/** The office, by text (those who ticked Text) and by email (everyone whose pref is on) — the same key the buying,
 *  the contractors' and the accepted-proposal notes use. */
async function tellOffice(organizationId: string, projectId: string, line: string, org: { name: string; logoUrl: string | null; phone: string | null }): Promise<void> {
  try {
    const href = `${await appBaseUrl()}/dashboard/projects/${projectId}`;
    await textOffice(organizationId, "proposal-accepted", `${line} ${href}`);
    const doc: EmailDoc = {
      subject: line.slice(0, 120),
      lockup: { kind: "org", name: org.name, logoUrl: org.logoUrl },
      kicker: { text: "The client's page" },
      headline: line.slice(0, 200),
      cta: { label: "Open the project", href },
      footer: { name: org.name, contact: org.phone ?? undefined },
    };
    await sendToMembersByPref(organizationId, "proposal-accepted", doc);
  } catch (err) {
    console.warn(`[projectClient] could not tell the office: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── the lender's page ────────────────────────────────────────────────────────

/** The lender's read-only link (/l/<token>), made the first time the office asks for it. */
export async function ensureLenderShare(organizationId: string, projectId: string, actorId: string | null): Promise<{ token: string; href: string }> {
  const p = await projectOf(organizationId, projectId);
  let token = p.lenderToken;
  if (!token) {
    token = randomUUID();
    await db.project.update({ where: { id: p.id }, data: { lenderToken: token, lenderSharedAt: new Date() } });
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Made the lender's page for ${p.name}`, clientId: p.clientId, meta: { projectId } });
  }
  return { token, href: `${await appBaseUrl()}/l/${token}` };
}

export type LenderDraw = { number: number; name: string; amount: number; retainagePct: number; state: string; words: string; bundle: string | null; requestedAt: string | null; fundedAt: string | null; fundedAmount: number | null; released: number; held: number };
export type LenderView = {
  company: ClientView["company"];
  project: { name: string; number: string; borrower: string | null; kind: "REMODEL" | "NEW_BUILD" };
  progress: { done: number | null; words: string };
  phases: ClientPhase[];
  /** The schedule as the lender reads it: each draw's dollars, state and the bundle the office took when it asked. */
  draws: { funded: number; requested: number; held: number; total: number; rows: LenderDraw[] };
  /** Every inspection with a result or a day, oldest first. */
  inspections: Array<{ name: string; result: string; date: string | null; stage: string | null }>;
  photoGroups: ClientView["photoGroups"];
  asOf: string;
};

/** What the lender sees from their link, and nothing else: the house's progress, the phases, the draws with their
 *  bundles, the inspections and the photos the office chose. Never the budget, the margin, a basis or a note. */
export async function lenderView(token: string): Promise<LenderView | null> {
  const p = await db.project.findUnique({
    where: { lenderToken: token },
    select: { id: true, organizationId: true, name: true, number: true, kind: true, client: { select: { name: true } }, organization: { select: orgSelect }, jobs: { where: { status: { not: "CANCELED" } }, select: { id: true } } },
  });
  if (!p || p.organization.deletedAt) return null;
  const tz = p.organization.timezone || "America/New_York";
  const jobIds = p.jobs.map((j) => j.id);
  const [read, phases, draws, inspections, photos] = await Promise.all([
    stagesOf(p.id),
    phasesOf(p.id),
    drawsOf(p.organizationId, p.id),
    db.projectInspection.findMany({ where: { projectId: p.id, OR: [{ result: { not: "PENDING" } }, { date: { not: null } }] }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 60, select: { name: true, result: true, date: true, stage: { select: { name: true } } } }),
    jobIds.length ? db.jobPhoto.findMany({ where: { jobId: { in: jobIds }, sharedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, url: true, caption: true, createdAt: true, analysis: true, media: true, contentType: true } }) : Promise.resolve([]),
  ]);
  const now = currentStage(read.stages);
  const photoRows: ClientPhoto[] = photos.filter((x) => mediaOf(x).media === "photo").slice(0, 24).map((x) => ({ id: x.id, href: mediaHref(x.url) ?? x.url, caption: x.caption, at: x.createdAt.toISOString() }));
  return {
    company: { name: p.organization.name, phone: p.organization.phone, email: p.organization.billingEmail, logoUrl: p.organization.logoUrl, website: p.organization.website },
    project: { name: p.name, number: projectNo(p.number), borrower: p.client?.name?.trim() || null, kind: p.kind === "NEW_BUILD" ? "NEW_BUILD" : "REMODEL" },
    progress: { done: read.done, words: progressWords(read.done, now?.name ?? null) },
    phases: phaseRows(phases, read.stages),
    draws: {
      funded: draws.funded,
      requested: draws.requested,
      held: draws.held,
      total: draws.total,
      rows: draws.draws.map((d) => ({ number: d.number, name: d.name, amount: d.amount, retainagePct: d.retainagePct, state: d.state, words: lenderDrawWords(d), bundle: d.snapshot?.words ?? null, requestedAt: d.requestedAt, fundedAt: d.fundedAt, fundedAmount: d.fundedAmount, released: d.payout.released, held: d.payout.held })),
    },
    inspections: inspections.map((i) => ({ name: i.name, result: i.result, date: i.date ? i.date.toISOString().slice(0, 10) : null, stage: i.stage?.name ?? null })),
    photoGroups: photoGroupsOf(photoRows, read.stages, phases, tz),
    asOf: new Date().toISOString(),
  };
}

// ── the update ───────────────────────────────────────────────────────────────

export type UpdateResult = { href: string; email: "sent" | "no-email" | "failed"; text: "sent" | "no-phone" | "off" | "skipped" | "failed"; words: string };

/** The page's link to the client, with where the project stands — by email, and by text when the company texts its
 *  clients (the text itself asks the client's consent, lib/sms). Stamped on the project. */
export async function sendUpdate(organizationId: string, projectId: string, actorId: string | null, note: string | null): Promise<UpdateResult> {
  const p = await projectOf(organizationId, projectId);
  const { href } = await ensureShare(organizationId, projectId, actorId);
  const view = await clientView((await db.project.findUniqueOrThrow({ where: { id: p.id }, select: { publicToken: true } })).publicToken!);
  if (!view) throw new Error("Project not found");
  const next = nextDaysWords(view.nextDays.map((d) => d.day));
  const first = p.client?.name?.trim().split(/\s+/)[0] ?? null;
  const org = p.organization;
  const cleanNote = note?.trim().slice(0, 600) || null;
  const headline = view.progress.done != null && view.progress.done < 100 ? `${view.progress.done}% done${currentWords(view)}` : view.progress.words;

  let email: UpdateResult["email"] = "no-email";
  const to = p.client?.email?.trim();
  if (to) {
    const doc: EmailDoc = {
      subject: `${p.name} — ${view.progress.words}`,
      lockup: { kind: "org", name: org.name, logoUrl: org.logoUrl ?? null },
      kicker: { text: "Project update" },
      headline,
      prose: [`Hi${first ? ` ${first}` : ""} — here's where ${p.name} stands.`, ...(cleanNote ? [cleanNote] : []), ...(next ? [`Next on site: ${next}.`] : []), ...(view.photos.length ? [`${view.photos.length} photo${view.photos.length === 1 ? "" : "s"} ${view.photos.length === 1 ? "is" : "are"} on your page.`] : []), ...(view.payments.some((x) => x.next) ? [`The next payment is on your page too, with a Pay button.`] : [])],
      cta: { label: "See your project page", href },
      after: ["Reply to this email with any questions — it comes straight to us."],
      footer: { name: org.name, contact: org.phone ?? undefined },
    };
    try {
      const r = renderEmail(doc);
      await sendOrgEmail(org, { to, subject: r.subject, html: r.html });
      email = "sent";
    } catch (err) {
      console.warn(`[projectClient] update email failed: ${err instanceof Error ? err.message : String(err)}`);
      email = "failed";
    }
  }

  let text: UpdateResult["text"] = "no-phone";
  const phone = p.client?.phone ? toE164(p.client.phone) : null;
  if (phone) {
    if (!org.smsClientsOn) text = "off";
    else {
      const r = await sendText({ organizationId, to: phone, body: clientUpdateText({ company: org.name, project: p.name, progress: view.progress.words, next, note: cleanNote, link: href }), kind: "project-update" }).catch(() => null);
      text = !r || !r.ok ? "failed" : r.status === "SKIPPED" ? "skipped" : "sent";
    }
  }
  await db.project.update({ where: { id: p.id }, data: { updateSentAt: new Date() } });
  const words = `${email === "sent" ? "Emailed" : email === "failed" ? "The email failed" : "No client email on file"}${text === "sent" ? " and texted" : text === "skipped" ? " (no text — the client has not agreed to texts)" : text === "off" ? " (texts to clients are off)" : ""}.`;
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Sent ${first ?? "the client"} the ${p.name} update — ${view.progress.words}. ${words}`, clientId: p.clientId, meta: { projectId, email, text } });
  return { href, email, text, words };
}

function currentWords(view: ClientView): string {
  const now = view.progress.stages.find((s) => s.state === "now");
  return now ? ` — on ${now.name}` : "";
}

/** The crew's read of the files, every one, read-only. */
export async function filesForCrew(projectId: string): Promise<Array<{ id: string; name: string; kindLabel: string; href: string }>> {
  const rows = await filesOf(projectId);
  return rows.map((f) => ({ id: f.id, name: f.name, kindLabel: f.kindLabel, href: f.href }));
}
