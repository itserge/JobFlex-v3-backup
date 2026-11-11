// THE JOB FOLDER (2026-10-03) — server only. One folder per request: the
// pictures, videos and documents the homeowner adds from their dashboard (at
// any time, or when the contractor asks), kept in the private file store
// (lib/media/privateStore — the Blob store when the server has it, this
// machine's disk in development, a data URL on Vercel before the store
// exists) and read two ways: by the homeowner through their key, by the shop
// that has the lead through its session. A file never travels as a permanent
// link: /api/home-file/[id] checks the reader every time.
//
// Owner: "the client can upload pictures or videos if the contractor asks,
// or at any time; it goes to the contractor's proposal folder, and he can
// place it into the estimator if needed — each proposal for each client has
// a folder for the documents, pictures and videos of that job."
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { orgReplyTo } from "@/lib/email/orgSend";
import { buildHomeFilesAdded, buildHomeFilesRequest } from "@/lib/email/build/platform";
import { IMAGE_TYPES, VIDEO_TYPES, isImageType, isVideoType } from "@/lib/jobMediaShared";
import { safePathname } from "@/lib/media/privateStore";
import { homeUrl } from "./portal";
import { FRESH_REQUEST_KEY, FRESH_REQUEST_MAX_FILES, FRESH_REQUEST_MS } from "./freshRequest";

export const DOCUMENT_TYPES: readonly string[] = ["application/pdf"];
export const FOLDER_TYPES: readonly string[] = [...IMAGE_TYPES, ...VIDEO_TYPES, ...DOCUMENT_TYPES];
/** Files per request — plenty for a job, a ceiling for a mistake. */
export const FOLDER_MAX_FILES = 60;

export type FolderMedia = "photo" | "video" | "document";

export function mediaOfType(contentType: string): FolderMedia {
  if (isVideoType(contentType)) return "video";
  if (isImageType(contentType)) return "photo";
  return "document";
}

/** Where a request's files live in the store: home/<homeId>/<leadId>/<stamp>-<name>. */
export function folderPathname(homeId: string, leadId: string, name: string | null | undefined, contentType: string): string {
  const fallback = isVideoType(contentType) ? "video.mp4" : contentType === "application/pdf" ? "document.pdf" : "photo.jpg";
  const base = (name ?? "").trim() || fallback;
  return safePathname(`home/${homeId}/${leadId}/${Date.now()}-${base}`);
}

/** The homeowner's door: their key, and a request on their dashboard. */
export async function homeownerFolder(key: string, token: string) {
  const home = await db.home.findUnique({ where: { accessToken: key } });
  if (!home) return null;
  const lead = await db.platformLead.findFirst({ where: { accessToken: token, homeId: home.id } });
  if (!lead) return null;
  return { home, lead };
}

/** The wizard's door (2026-10-23, lib/home/freshRequest): the request's own token, for a little while after it was
 *  sent, on a request that has joined its home. Adding files only — deleting needs the key. */
export async function freshRequestFolder(token: string) {
  const lead = await db.platformLead.findFirst({ where: { accessToken: token, homeId: { not: null }, createdAt: { gte: new Date(Date.now() - FRESH_REQUEST_MS) } } });
  if (!lead?.homeId) return null;
  const home = await db.home.findUnique({ where: { id: lead.homeId } });
  if (!home) return null;
  return { home, lead };
}

/** The door an upload comes through: the home's key and a request on it, or the request just sent. */
export async function folderDoor(key: string, token: string) {
  return key === FRESH_REQUEST_KEY ? freshRequestFolder(token) : homeownerFolder(key, token);
}

/** How many files may be in the folder after an upload through this door. */
export const folderCap = (key: string) => (key === FRESH_REQUEST_KEY ? FRESH_REQUEST_MAX_FILES : FOLDER_MAX_FILES);

/** The folder is full, said for the door the file came through. */
export const folderFullWords = (cap: number) => `This project's folder holds ${cap} files${cap < FOLDER_MAX_FILES ? " for now — add more from your home dashboard" : " — remove one first"}.`;

/** The shop's door: a lead of theirs that came from the Lead Center. Null when
 *  the lead is theirs but carries no homeowner folder (an older lead, or one
 *  that came another way). */
export async function contractorFolder(organizationId: string, leadId: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId }, select: { id: true, name: true, email: true, phone: true } });
  if (!lead) return null;
  const pl = await db.platformLead.findFirst({ where: { matchedLeadId: leadId }, include: { home: { select: { id: true, name: true, email: true, accessToken: true } } } });
  if (!pl || !pl.home) return null;
  return { lead, pl, home: pl.home };
}

/** May this shop read this request's folder? The one it is matched with, or
 *  one that had it (an offer accepted, then the homeowner moved on). */
export async function orgMayReadFolder(organizationId: string, platformLeadId: string): Promise<boolean> {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId }, select: { matchedOrgId: true } });
  if (!pl) return false;
  if (pl.matchedOrgId === organizationId) return true;
  const had = await db.leadOffer.findFirst({ where: { platformLeadId, organizationId, status: { in: FOLDER_OFFER_STATES } }, select: { id: true } });
  return Boolean(had);
}

const FOLDER_OFFER_STATES = ["ACCEPTED", "REJECTED_BY_CLIENT"];

/** Every request whose folder this shop may read (the same rule as orgMayReadFolder), the newest first — so a file
 *  the homeowner sent BEFORE the shop took the project is the shop's to see too (its row names no shop). */
export async function foldersOrgMayRead(organizationId: string, take = 200): Promise<string[]> {
  const rows = await db.platformLead.findMany({
    where: { OR: [{ matchedOrgId: organizationId }, { offers: { some: { organizationId, status: { in: FOLDER_OFFER_STATES } } } }] },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export interface FolderFileView {
  id: string;
  name: string;
  media: FolderMedia;
  contentType: string;
  bytes: number;
  note: string | null;
  uploadedBy: string;
  at: string;
  /** /api/home-file/<id> — the reader is checked there. */
  href: string;
}

export interface FolderRequestView {
  id: string;
  orgName: string;
  note: string | null;
  at: string;
  fulfilledAt: string | null;
}

export async function listFolder(platformLeadId: string, keyForHref: string | null): Promise<{ files: FolderFileView[]; requests: FolderRequestView[] }> {
  const [rows, asks] = await Promise.all([
    db.homeFile.findMany({ where: { platformLeadId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
    db.homeFileRequest.findMany({ where: { platformLeadId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const orgIds = [...new Set(asks.map((a) => a.organizationId))];
  const orgs = orgIds.length ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(orgs.map((o) => [o.id, o.name]));
  const q = keyForHref ? `?key=${encodeURIComponent(keyForHref)}` : "";
  return {
    files: rows.map((f) => ({
      id: f.id,
      name: f.name,
      media: (f.media as FolderMedia) || mediaOfType(f.contentType),
      contentType: f.contentType,
      bytes: f.bytes,
      note: f.note,
      uploadedBy: f.uploadedBy,
      at: f.createdAt.toISOString(),
      href: `/api/home-file/${encodeURIComponent(f.id)}${q}`,
    })),
    requests: asks.map((a) => ({ id: a.id, orgName: nameOf.get(a.organizationId) ?? "Your contractor", note: a.note, at: a.createdAt.toISOString(), fulfilledAt: a.fulfilledAt?.toISOString() ?? null })),
  };
}

/** The shop hears that files arrived: an email, and a line on its lead. Best effort. */
export async function tellShopFilesAdded(pl: { id: string; matchedOrgId: string | null; matchedLeadId: string | null; detectedTrade: string | null; projectType: string | null; city: string | null; state: string | null; zip: string | null }, home: { name: string; email: string }, count: number, media: FolderMedia, note: string | null): Promise<void> {
  if (!pl.matchedOrgId) return;
  try {
    const org = await db.organization.findUnique({ where: { id: pl.matchedOrgId }, select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true } });
    if (!org) return;
    const appUrl = await appBaseUrl();
    const project = `${pl.detectedTrade ?? pl.projectType ?? "project"} in ${[pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || "your area"}`;
    const what = count === 1 ? (media === "video" ? "a video" : media === "document" ? "a document" : "a photo") : `${count} ${media === "video" ? "videos" : media === "document" ? "documents" : "photos"}`;
    const to = orgReplyTo(org);
    if (to) {
      const { subject, html } = renderEmail(
        buildHomeFilesAdded({ homeownerName: home.name, what, project, note, leadUrl: pl.matchedLeadId ? `${appUrl}/dashboard/leads/${pl.matchedLeadId}#folder` : `${appUrl}/dashboard/leads` }),
      );
      await sendEmail({ mailClass: "transactional", to, subject, html, replyTo: home.email });
    }
    if (pl.matchedLeadId) {
      await db.activityEvent.create({ data: { organizationId: org.id, leadId: pl.matchedLeadId, kind: "NOTE", summary: `${home.name} added ${what} to the job folder${note ? `: “${note.slice(0, 140)}”` : ""}` } }).catch(() => null);
    }
  } catch (err) {
    console.warn("[home/files] shop notify failed:", err instanceof Error ? err.message : err);
  }
}

/** The homeowner hears that the shop asked for pictures. Best effort. */
export async function tellHomeownerFilesAsked(home: { name: string; email: string; accessToken: string }, orgName: string, project: string, note: string | null, token: string): Promise<void> {
  try {
    const url = await homeUrl(home.accessToken);
    const { subject, html } = renderEmail(buildHomeFilesRequest({ name: home.name, orgName, project, note, href: `${url}#folder-${encodeURIComponent(token)}` }));
    await sendEmail({ mailClass: "transactional", to: home.email, subject, html });
  } catch (err) {
    console.warn("[home/files] homeowner notify failed:", err instanceof Error ? err.message : err);
  }
}

export const FOLDER_ACCEPT = FOLDER_TYPES.join(",");
export { IMAGE_TYPES, VIDEO_TYPES };
