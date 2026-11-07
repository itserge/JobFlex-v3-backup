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
import { stagesOf } from "@/lib/projectStages/server";
import { currentStage, projectNo } from "@/lib/projectStages/shared";
import { dayKeyIn } from "@/lib/projectTimeline/shared";
import { sendText } from "@/lib/sms/send";
import { FILE_DATA_URL, FILE_KIND_LABEL, FILE_MAX_BYTES, clientUpdateText, fileKindOf, nextDaysWords, progressWords, safeFileLink, type FileKind } from "./shared";

const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];
const orgSelect = { id: true, name: true, phone: true, logoUrl: true, billingEmail: true, website: true, timezone: true, smsClientsOn: true, gmailSettingsJson: true, gmailTokensJson: true } as const;

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, number: true, clientId: true, publicToken: true, sharedAt: true, updateSentAt: true, client: { select: { name: true, email: true, phone: true } }, organization: { select: orgSelect } } });
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

export type ClientView = {
  company: { name: string; phone: string | null; email: string | null; logoUrl: string | null; website: string | null };
  project: { name: string; number: string; status: string; clientFirst: string | null };
  progress: { done: number | null; words: string; stages: Array<{ name: string; state: "done" | "now" | "next" }> };
  nextDays: Array<{ day: string; label: string; jobTitle: string }>;
  photos: Array<{ id: string; href: string; caption: string | null; at: string }>;
  files: Array<{ id: string; name: string; kindLabel: string; href: string; isLink: boolean }>;
  payments: Array<{ title: string; paid: number; total: number; remaining: number; next: { label: string; amount: number; href: string } | null }>;
  finished: boolean;
  warrantyUntil: string | null;
  finalInspectionPassed: boolean;
};

export async function clientView(token: string): Promise<ClientView | null> {
  const p = await db.project.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      name: true,
      number: true,
      status: true,
      warrantyUntil: true,
      client: { select: { name: true } },
      organization: { select: orgSelect },
      jobs: { where: { status: { not: "CANCELED" } }, select: { id: true, title: true } },
      proposals: { where: { status: { in: SOLD } }, orderBy: { total: "desc" }, select: { id: true, title: true, publicId: true, total: true, currency: true, installments: { orderBy: { position: "asc" } }, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } } },
      inspections: { where: { isFinal: true }, take: 1, select: { result: true } },
    },
  });
  if (!p) return null;
  const tz = p.organization.timezone || "America/New_York";
  const today = localDayKey(new Date(), tz);
  const jobIds = p.jobs.map((j) => j.id);
  const titleOf = new Map(p.jobs.map((j) => [j.id, j.title]));
  const [read, events, photos, files, base] = await Promise.all([
    stagesOf(p.id),
    jobIds.length ? db.jobEvent.findMany({ where: { jobId: { in: jobIds }, startsAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { startsAt: "asc" }, take: 40, select: { jobId: true, startsAt: true } }) : Promise.resolve([]),
    jobIds.length ? db.jobPhoto.findMany({ where: { jobId: { in: jobIds }, sharedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, url: true, caption: true, createdAt: true, analysis: true, media: true, contentType: true } }) : Promise.resolve([]),
    db.projectFile.findMany({ where: { projectId: p.id, clientVisible: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, kind: true, url: true, isLink: true } }),
    appBaseUrl(),
  ]);
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
  return {
    company: { name: p.organization.name, phone: p.organization.phone, email: p.organization.billingEmail, logoUrl: p.organization.logoUrl, website: p.organization.website },
    project: { name: p.name, number: projectNo(p.number), status: p.status, clientFirst: p.client?.name?.trim().split(/\s+/)[0] ?? null },
    progress: {
      done: read.done,
      words: progressWords(read.done, now?.name ?? null),
      stages: read.stages.map((s) => ({ name: s.name, state: s.status === "DONE" ? "done" : s.id === now?.id ? "now" : "next" })),
    },
    nextDays,
    photos: photos.filter((x) => mediaOf(x).media === "photo").slice(0, 24).map((x) => ({ id: x.id, href: mediaHref(x.url) ?? x.url, caption: x.caption, at: x.createdAt.toISOString() })),
    files: files.map((f) => ({ id: f.id, name: f.name, kindLabel: FILE_KIND_LABEL[fileKindOf(f.kind)], href: f.isLink ? f.url : (mediaHref(f.url) ?? f.url), isLink: f.isLink })),
    payments,
    finished: p.status === "COMPLETED" || p.status === "ARCHIVED",
    warrantyUntil: p.warrantyUntil ? p.warrantyUntil.toISOString().slice(0, 10) : null,
    finalInspectionPassed: p.inspections[0]?.result === "PASSED",
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
