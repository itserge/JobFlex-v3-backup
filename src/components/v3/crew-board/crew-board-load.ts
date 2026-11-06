// THE CREW BOARD — the server read (stage C, 2026-09-30).
//
// Called by a page that has ALREADY decided the reader may open this job (the
// office through the job page's own check, a crew member through their
// assignment — the portal's token or the dashboard's worker branch). It reads
// the days on site (sweeping a passed open day to PENDING first), every file
// with who put it there, and the receipts, and mints the short signed links
// the browser will use — so a file link is only ever handed to someone the
// page let in, and it dies in 15 minutes.

import { db } from "@/lib/db";
import { mediaOf, fileSize, MAX_FILE_BYTES } from "@/lib/jobMediaShared";
import { mediaHref } from "@/lib/media/signedLink";
import { storageMode } from "@/lib/media/privateStore";
import { listWorkDays, tzOf } from "@/lib/workDays";
import { localDayKey } from "@/lib/jobProgressShared";
import { effectiveDayStatus } from "@/lib/workDaysShared";
import { expenseTotals } from "@/lib/expenseTotals";
import { RECEIPT_CATEGORIES, type CrewBoardData, type CrewDay, type CrewFile, type CrewReceipt } from "./crew-board-data";

export interface BoardReader {
  userId: string;
  /** The office (owner, admin, manager…): reviews, edits any file and receipt. */
  office: boolean;
  /** May work the job: the office, or crew with a live assignment. */
  canWork: boolean;
}

function fmt(d: Date, tz: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(d);
  } catch {
    return d.toISOString();
  }
}

export async function loadCrewBoard(organizationId: string, jobId: string, reader: BoardReader): Promise<CrewBoardData> {
  const tz = await tzOf(organizationId);
  const now = new Date();
  const today = localDayKey(now, tz);
  const [job, days, photos, expenses] = await Promise.all([
    db.job.findFirst({ where: { id: jobId, organizationId }, select: { status: true } }),
    listWorkDays(organizationId, jobId, now),
    db.jobPhoto.findMany({ where: { jobId }, orderBy: { createdAt: "desc" } }),
    db.jobExpense.findMany({ where: { jobId }, orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }] }),
  ]);

  // Who is who: crew by their profile name, the office by their account name.
  const ids = new Set<string>();
  for (const d of days) {
    if (d.openedById) ids.add(d.openedById);
    if (d.closedById) ids.add(d.closedById);
  }
  for (const p of photos) if (p.uploadedById) ids.add(p.uploadedById);
  for (const e of expenses) if (e.submittedById) ids.add(e.submittedById);
  // Older photos name their uploader only on the trail row (meta.photoId).
  const trail = await db.activityEvent.findMany({
    where: { organizationId, kind: "PHOTO", meta: { contains: `"jobId":"${jobId}"` } },
    select: { actorId: true, meta: true },
    take: 400,
  });
  const photoActor = new Map<string, string>();
  for (const t of trail) {
    try {
      const m = JSON.parse(t.meta ?? "{}") as { photoId?: string };
      if (m.photoId && t.actorId && !photoActor.has(m.photoId)) {
        photoActor.set(m.photoId, t.actorId);
        ids.add(t.actorId);
      }
    } catch {
      /* unreadable meta */
    }
  }
  const [profiles, users] = await Promise.all([
    db.workerProfile.findMany({ where: { userId: { in: [...ids] } }, select: { userId: true, displayName: true } }),
    db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, email: true } }),
  ]);
  const nameOf = new Map<string, string>();
  for (const u of users) nameOf.set(u.id, u.name?.trim() || u.email || "A member");
  for (const p of profiles) nameOf.set(p.userId, p.displayName);
  const who = (id: string | null | undefined) => (id ? nameOf.get(id) ?? "Former member" : null);

  const fileOf = (p: (typeof photos)[number]): CrewFile => {
    const meta = mediaOf(p);
    const uploader = p.uploadedById ?? photoActor.get(p.id) ?? null;
    const mine = uploader === reader.userId;
    const ext = meta.media === "video" ? (meta.contentType?.includes("quicktime") ? "mov" : "mp4") : "jpg";
    const name = `${p.kind.toLowerCase()}-${p.id.slice(-6)}.${ext}`;
    return {
      id: p.id,
      href: mediaHref(p.url) ?? p.url,
      downloadHref: mediaHref(p.url, { download: name }) ?? p.url,
      media: meta.media,
      contentType: meta.contentType ?? p.contentType ?? null,
      kind: p.kind.charAt(0) + p.kind.slice(1).toLowerCase(),
      caption: p.caption,
      by: who(uploader),
      at: fmt(p.createdAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      edited: p.editedAt ? `edited ${fmt(p.editedAt, tz, { month: "short", day: "numeric" })}` : null,
      canEdit: reader.office || (mine && reader.canWork),
      canDelete: reader.office || (mine && reader.canWork),
      size: typeof p.bytes === "number" ? fileSize(p.bytes) : typeof meta.bytes === "number" ? fileSize(meta.bytes) : null,
    };
  };

  const byDay = new Map<string, CrewFile[]>();
  const loose: CrewFile[] = [];
  for (const p of photos) {
    const f = fileOf(p);
    if (p.workDayId) byDay.set(p.workDayId, [...(byDay.get(p.workDayId) ?? []), f]);
    else loose.push(f);
  }

  const dayOut: CrewDay[] = days
    .map((d) => {
      const status = effectiveDayStatus(d, today);
      const closedSameDay = d.closedAt && localDayKey(d.closedAt, tz) === d.date;
      return {
        id: d.id,
        date: d.date,
        label: fmt(new Date(`${d.date}T12:00:00Z`), "UTC", { weekday: "short", month: "short", day: "numeric" }),
        dayNumber: d.dayNumber,
        status,
        openedBy: who(d.openedById),
        closedBy: who(d.closedById),
        closedAt: d.closedAt ? fmt(d.closedAt, tz, closedSameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null,
        byOffice: d.source === "office",
        note: d.note,
        weather: d.weather,
        files: byDay.get(d.id) ?? [],
      } satisfies CrewDay;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const receipts: CrewReceipt[] = expenses.map((e) => {
    const mine = e.submittedById === reader.userId;
    const status = (["SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"].includes(e.status) ? e.status : "APPROVED") as CrewReceipt["status"];
    const pdf = !!e.receiptUrl && (/\.pdf(\?|$)/i.test(e.receiptUrl) || e.receiptUrl.startsWith("data:application/pdf"));
    const spent = e.spentAt ?? e.createdAt;
    const open = status === "SUBMITTED" || status === "REJECTED";
    return {
      id: e.id,
      amount: e.amount,
      vendor: e.vendor,
      category: e.category,
      note: e.note,
      spent: fmt(spent, tz, { month: "short", day: "numeric" }),
      spentISO: localDayKey(spent, tz),
      paidBy: e.paidBy === "WORKER" ? "WORKER" : "COMPANY",
      status,
      rejectReason: e.rejectReason,
      by: who(e.submittedById),
      mine,
      edited: e.editedAt ? `edited ${fmt(e.editedAt, tz, { month: "short", day: "numeric" })}` : null,
      file: e.receiptUrl ? { href: mediaHref(e.receiptUrl) ?? e.receiptUrl, downloadHref: mediaHref(e.receiptUrl, { download: `receipt-${e.id.slice(-6)}.${pdf ? "pdf" : "jpg"}` }) ?? e.receiptUrl, pdf } : null,
      canEdit: reader.office || (mine && reader.canWork && open),
      canDelete: reader.office || (mine && reader.canWork && open),
      canReview: reader.office,
    };
  });
  const t = expenseTotals(expenses.map((e) => ({ amount: e.amount, status: e.status, paidBy: e.paidBy })));

  const jobStatus = (job?.status ?? "SCHEDULED") as CrewBoardData["jobStatus"];
  return {
    jobId,
    jobStatus,
    today,
    todayDay: dayOut.find((d) => d.date === today) ?? null,
    pending: dayOut.filter((d) => d.status === "PENDING").sort((a, b) => a.date.localeCompare(b.date)),
    days: dayOut,
    looseFiles: loose,
    receipts,
    canWork: reader.canWork && jobStatus !== "CANCELED",
    office: reader.office,
    storage: storageMode(),
    maxBytes: MAX_FILE_BYTES,
    totals: { counted: t.counted, pending: t.pending, owedToWorkers: t.owedToWorkers },
    categories: RECEIPT_CATEGORIES,
  };
}
