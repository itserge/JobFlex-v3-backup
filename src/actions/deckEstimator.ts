"use server";
// THE DECK STUDIO'S SERVER HALF (2026-10-04). The engine is pure and runs in
// the browser (lib/deck); the server keeps two things for it:
//
//   · the shop's own deck prices — a sparse book (lib/deck/rates) kept in
//     SyncState under `deckbook:<orgId>`, like the ad names on the traffic
//     page: no table of its own, so nothing has to be pushed to production
//     by hand before this ships;
//   · the proposal — the deck's priced lines written the way the fence
//     estimator writes its own (actions/fenceEstimator), and the deck itself
//     (design + frozen 3D) kept beside it as an ActivityEvent DECK_PLAN for
//     the client's page;
//   · the photo of the house (M2, 2026-10-10) — put in the private file
//     store; only its URL rides in the design.
//
// Both are for admins while the estimator is marked Coming soon (lib/deck/access),
// the same rule the page applies.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { NoOrgError, UnauthorizedError, isEstimatorRole, isSalesRole, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { clearFilingContext, readFilingContext } from "@/lib/filingContext";
import { logServerError } from "@/lib/server-events";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { friendlyAIError, isOpenAIEnabled } from "@/lib/sdk/openai";
import { parseWallRead, WALL_READ_PROMPT, type WallRead } from "@/lib/deck/photoFit";
import { keepHousePhoto, photoOf, readHouseCornerImage, readHouseImage, type DeckPhotoResult, type HouseCornerRead, type HousePhotoRead } from "@/lib/deck/housePhotoServer";
import { readHouseDepthImage, type HouseDepthResult } from "@/lib/deck/houseDepth";
import { foldersOrgMayRead, orgMayReadFolder } from "@/lib/home/files";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sanitizeDeckRateBook, type DeckRateBook } from "@/lib/deck/rates";
import { deckBookKey as bookKey } from "@/lib/deck/rateBookStore";
import { DECK_PLAN_EVENT, DECK_PLAN_VERSION, deckConvertSchema, deckUpdateSchema, firstIssue } from "@/lib/deck/convertSchema";
import { DECK_LOCK_WORDS, deckProposalLock, deckProposalSeen, readDeckWritten, type DeckProposalLock, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import { deckUpdatePayload } from "@/lib/deck/proposalUpdate";
import { clientFromDesignLink, ownDeckPhoto, writeDeckProposal } from "@/lib/deck/proposalWrite";
import { clientLinkOfDraft, markClientLinkSeen, tieClientLinkToProposal } from "@/lib/deck/clientLinksServer";
import { CLIENT_TOKEN_RE, linkTitle } from "@/lib/deck/clientDesign";
import { saveProposal } from "@/actions/proposals";
import { proposalRef } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-bridge";
import { isPrivateFileUnder, readStoredAsDataUrl } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { normalizeDeckDesign, structureWords, type DeckDesign } from "@/lib/deck/design";
import { fitGround } from "@/lib/deck/site";
import { geocode, isMapsEnabled } from "@/lib/maps";
import { appBaseUrl } from "@/lib/appUrl";
import { in3depCoverage, sample3depElevations } from "@/lib/elevation3dep";
import { deckAddonShortWords } from "@/lib/deckAddon";

type Gate = { ok: true; organizationId: string; userId: string; role: string } | { ok: false; error: string };

/** "design": the studio's preview is enough (lib/deck/access) — reading the house, the site, the drafts already
 *  there; "full" (the default): every save, send and print — the Deck Studio itself. */
async function gate(need: "full" | "design" = "full"): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level === "none") return { ok: false, error: "Deck Studio isn't open yet." };
    if (level === "preview" && need === "full") return { ok: false, error: `Saving, sending and printing are part of Deck Studio — add it to your plan (${deckAddonShortWords()}) from the Deck estimator.` };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can do this." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

/** Save the shop's deck prices. Only what differs from the examples is kept; a blank row goes back to the example. */
export async function saveDeckRateBook(raw: unknown): Promise<{ ok: true; book: DeckRateBook } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const book = sanitizeDeckRateBook(raw);
  try {
    if (Object.keys(book).length === 0) await db.syncState.deleteMany({ where: { key: bookKey(g.organizationId) } });
    else await db.syncState.upsert({ where: { key: bookKey(g.organizationId) }, create: { key: bookKey(g.organizationId), cursor: JSON.stringify(book) }, update: { cursor: JSON.stringify(book) } });
    return { ok: true, book };
  } catch (err) {
    logServerError("deck-rates", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your prices could not be saved. Try again in a moment." };
  }
}

/* ── The photo of the house (M2, 2026-10-10) ───────────────────────── */

export type { DeckPhotoResult, HouseCornerRead, HousePhotoRead } from "@/lib/deck/housePhotoServer";
export type { HouseDepthResult } from "@/lib/deck/houseDepth";

/**
 * A photo of the back of the house, kept in the PRIVATE file store under
 * the shop's own folder (`deck-photos/<orgId>/…`, lib/media/privateStore).
 * Back come the stored URL — kept in the design, and so with the proposal's
 * DECK_PLAN — and a 15-minute read link for the studio to show it with.
 */
export async function uploadDeckPhoto(form: FormData): Promise<DeckPhotoResult> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  return keepHousePhoto(form, `deck-photos/${g.organizationId}/`, { organizationId: g.organizationId });
}

export type DeckPhotoRead = { ok: true; read: WallRead } | { ok: false; error: string; configured: boolean };

/**
 * THE SMART FIT'S READ (2026-10-10): the vision model looks at the picture
 * once and says where the wall meets the ground, its eave, any jog, the
 * back door, the windows and any black bars (lib/deck/photoFit
 * WALL_READ_PROMPT). The studio does the arithmetic — scale, crop,
 * placement — in the browser from this read, so nothing is stored here but
 * what the design keeps. Owner: "the deck should find by itself where it's
 * supposed to be, that wall on the picture."
 */
export async function readDeckPhoto(form: FormData): Promise<DeckPhotoRead> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error, configured: true };
  const p = photoOf(form);
  if (!p.ok) return { ...p, configured: true };
  const file = p.file;
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the picture needs the AI key on the server — drag the outline to the wall instead.", configured: false };
  try {
    const dataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    const raw = await runVisionJson<unknown>({ systemPrompt: WALL_READ_PROMPT, userPrompt: "Read this photo of the house and answer with the JSON.", imageUrl: dataUrl, detail: "high" });
    const read = parseWallRead(raw);
    if (!read) return { ok: false, error: "The wall could not be found in that picture — drag the outline to it, or take the picture square on from the yard.", configured: true };
    return { ok: true, read };
  } catch (err) {
    logServerError("deck-photo-read", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: friendlyAIError(err, "deck-photo-read"), configured: true };
  }
}

/**
 * THE HOUSE READ OFF ITS PHOTO (2026-10-23): the vision model looks at the picture of the back wall and says the wall's
 * lines and what the 3D house needs besides (lib/deck/housePhotoServer readHouseImage — the same read the client's link
 * makes). The studio builds the house from it in the browser (lib/deck/houseFromPhoto). Owner: "the client will just
 * give the back wall picture … and it just takes the shapes and move it into our 3D shaper".
 */
export async function readHousePhoto(form: FormData): Promise<HousePhotoRead> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error, configured: true };
  return readHouseImage(form, { organizationId: g.organizationId });
}

/**
 * THE WALL'S DEPTH OFF THE PHOTO (2026-10-26): a depth map of the picture (lib/deck/houseDepth, one Depth Anything run
 * on fal) says which parts of the wall come out or step back against the main wall, and where a bay or a chimney
 * stands on it. The form carries the picture and the read in its fractions; the studio applies the verdicts
 * (lib/deck/houseDepthApply).
 */
export async function readHouseDepth(form: FormData): Promise<HouseDepthResult> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error, configured: true };
  return readHouseDepthImage(form, { organizationId: g.organizationId });
}

/**
 * ONE CORNER OF THE WALL, LOOKED AT BY ITSELF (2026-11-13, owner: "make it more smart to understand and read the
 * jogs"): where the picture shows a corner but not which side of it stands forward, a close cut round that corner is
 * read on its own (lib/deck/houseCorner; lib/deck/housePhotoServer readHouseCornerImage). The studio lays the answer
 * on the read.
 */
export async function readHouseCorner(form: FormData): Promise<HouseCornerRead> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error, configured: true };
  return readHouseCornerImage(form, { organizationId: g.organizationId });
}

export interface ClientPhoto {
  id: string;
  name: string;
  /** Who sent it — the homeowner's name on the request. */
  from: string;
  at: string;
  /** True when it came from the client this design is for. */
  mine: boolean;
}

/**
 * THE PHOTOS CLIENTS ALREADY SENT (2026-10-23): the pictures homeowners put in their job folders (lib/home/files) on
 * the requests this shop has — the newest first, the design's own client's first of all. "The client will just give
 * the back wall picture … and we just upload it" — or pick it here.
 */
export async function deckClientPhotos(input: { clientId?: string | null } = {}): Promise<{ ok: true; photos: ClientPhoto[] } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const client = input.clientId ? await db.client.findFirst({ where: { id: input.clientId, organizationId: g.organizationId, deletedAt: null }, select: { email: true, name: true } }) : null;
    // The folders this shop may read — a photo sent with the request, before any shop took it, names no shop.
    const folders = await foldersOrgMayRead(g.organizationId);
    const files = folders.length ? await db.homeFile.findMany({ where: { platformLeadId: { in: folders }, media: "photo", deletedAt: null }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, name: true, createdAt: true, platformLeadId: true, home: { select: { name: true, email: true } } } }) : [];
    const out: ClientPhoto[] = [];
    for (const f of files) {
      const mine = !!client?.email && client.email.trim().toLowerCase() === f.home.email.toLowerCase();
      out.push({ id: f.id, name: f.name.slice(0, 80), from: f.home.name.slice(0, 60), at: f.createdAt.toISOString(), mine });
    }
    out.sort((a, b) => Number(b.mine) - Number(a.mine));
    return { ok: true, photos: out.slice(0, 24) };
  } catch (err) {
    logServerError("deck-client-photos", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The clients' photos could not be read right now." };
  }
}

/** One of those photos, as its bytes (a data URL), for the studio to read like a picture just picked. */
export async function deckClientPhotoData(id: string): Promise<{ ok: true; dataUrl: string; name: string } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || !/^[a-z0-9]{10,40}$/i.test(id)) return { ok: false, error: "That photo is not there." };
  try {
    const f = await db.homeFile.findFirst({ where: { id, deletedAt: null, media: "photo" }, select: { url: true, name: true, platformLeadId: true } });
    if (!f || !(await orgMayReadFolder(g.organizationId, f.platformLeadId))) return { ok: false, error: "That photo is not there." };
    const dataUrl = await readStoredAsDataUrl(f.url, 12 * 1024 * 1024);
    if (!dataUrl) return { ok: false, error: "That photo could not be opened." };
    return { ok: true, dataUrl, name: f.name };
  } catch (err) {
    logServerError("deck-client-photo", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "That photo could not be opened right now." };
  }
}

/** A fresh read link for a photo the design already holds (the stored URL never goes to the browser as is). */
export async function deckPhotoHref(url: string): Promise<string | null> {
  const g = await gate("design");
  if (!g.ok) return null;
  if (typeof url !== "string" || !isPrivateFileUnder(url, `deck-photos/${g.organizationId}/`)) return null;
  return mediaHref(url);
}

/** The result of a convert: a failure is RETURNED, never thrown (a thrown message is redacted in production). */
export type DeckConvertResult =
  | { ok: true; id: string }
  | { ok: false; code: "PLAN_LIMIT_REACHED"; error: string; resource?: LimitKey }
  | { ok: false; code: "FORBIDDEN" | "INVALID" | "FAILED"; error: string };

export async function convertDeckEstimateToProposal(raw: unknown): Promise<DeckConvertResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, code: "FORBIDDEN", error: g.error };
  const quota = await checkPlanLimit(g.organizationId, "proposalsCreated");
  if (!quota.allowed) return { ok: false, code: "PLAN_LIMIT_REACHED", error: PLAN_LIMIT_MESSAGE, resource: quota.cappedBy ?? "proposalsCreated" };
  const parsed = deckConvertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  try {
    // Started from a project, a client or a lead, the picker recorded where this estimate files (lib/filingContext).
    const filing = await readFilingContext(g.organizationId);
    const id = await writeDeckProposal({ organizationId: g.organizationId, userId: g.userId, role: g.role }, parsed.data, filing);
    if (filing) await clearFilingContext();
    return { ok: true, id };
  } catch (err) {
    logServerError("deck-convert", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, code: "FAILED", error: "The proposal could not be saved. Try again in a moment; if it keeps failing, tell support the time it happened." };
  }
}

/* ── Drafts: save the work in progress, open it later (M3, 2026-10-10) ───── */
//
// Owner: "when building and want to finish later — save or auto save, open
// later and finish." A draft is the design and the address under a SyncState
// row `deckdraft:<orgId>:<id>` (no table of its own, like the price book):
// the studio auto-saves a few seconds after a change, lists the shop's drafts,
// reopens one by `?draft=<id>`, and can also reopen the deck a saved proposal
// carries (its DECK_PLAN).

const DRAFT_PREFIX = "deckdraft:";
const DRAFT_MAX = 60;
const draftKey = (organizationId: string, id: string) => `${DRAFT_PREFIX}${organizationId}:${id}`;

export interface DeckDraftRow {
  id: string;
  title: string;
  address: string | null;
  updatedAt: string;
  by: string | null;
  /** Opened from a proposal: the draft keeps updating that one (2026-10-12). */
  proposalId: string | null;
  /** Came back through a client's design link (2026-10-13): the token, and the client's name for the list. */
  clientToken: string | null;
  fromClient: string | null;
}
export interface DeckDraft extends DeckDraftRow {
  design: DeckDesign;
}

function readDraft(id: string, cursor: string): DeckDraft | null {
  try {
    const raw = JSON.parse(cursor) as Record<string, unknown>;
    const design = normalizeDeckDesign(raw.design);
    const proposalId = typeof raw.proposalId === "string" && /^[\w-]{1,64}$/.test(raw.proposalId) ? raw.proposalId : null;
    const clientToken = typeof raw.clientToken === "string" && CLIENT_TOKEN_RE.test(raw.clientToken) ? raw.clientToken : null;
    const by = typeof raw.by === "string" ? raw.by : null;
    // The returned draft is saved "by Jane Smith (client)" (actions/deckClientDesign).
    const fromClient = clientToken && by ? by.replace(/\s*\(client\)\s*$/i, "") || null : null;
    return { id, title: typeof raw.title === "string" ? raw.title.slice(0, 120) : structureWords(design), address: typeof raw.address === "string" ? raw.address.slice(0, 300) : null, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(), by, proposalId, clientToken, fromClient, design };
  } catch {
    return null;
  }
}

export type DraftSaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string };

/** Save (or re-save) a draft. A new draft gets an id; the caller keeps it for the next save. */
export async function saveDeckDraft(input: { id?: string | null; title?: string | null; design: unknown; address?: string | null; proposalId?: string | null; clientToken?: string | null }): Promise<DraftSaveResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const id = input.id && /^[a-f0-9-]{8,40}$/i.test(input.id) ? input.id : randomUUID();
  const design = normalizeDeckDesign(input.design);
  const updatedAt = new Date().toISOString();
  const title = (input.title?.trim() || structureWords(design)).slice(0, 120);
  const address = input.address?.trim().slice(0, 300) || null;
  const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
  const proposalId = typeof input.proposalId === "string" && /^[\w-]{1,64}$/.test(input.proposalId) ? input.proposalId : null;
  const clientToken = typeof input.clientToken === "string" && CLIENT_TOKEN_RE.test(input.clientToken) ? input.clientToken : null;
  // A returned design the contractor keeps working on stays the client's in the list ("Jane Smith (client)"), with its link.
  const prior = clientToken ? await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).then((r) => (r ? readDraft(id, r.cursor) : null)).catch(() => null) : null;
  const body = JSON.stringify({ v: 1, title, address, updatedAt, by: prior?.clientToken === clientToken && prior?.by ? prior.by : (who?.name ?? who?.email ?? null), proposalId, clientToken, design });
  try {
    // A shop keeps at most DRAFT_MAX drafts: the oldest goes when a new one arrives.
    const key = draftKey(g.organizationId, id);
    const exists = await db.syncState.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      const all = await db.syncState.findMany({ where: { key: { startsWith: `${DRAFT_PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
      if (all.length >= DRAFT_MAX) {
        const oldest = all.map((r) => ({ key: r.key, at: readDraft(r.key, r.cursor)?.updatedAt ?? "" })).sort((a, b) => a.at.localeCompare(b.at))[0];
        if (oldest) await db.syncState.delete({ where: { key: oldest.key } }).catch(() => {});
      }
    }
    await db.syncState.upsert({ where: { key }, create: { key, cursor: body }, update: { cursor: body } });
    return { ok: true, id, updatedAt };
  } catch (err) {
    logServerError("deck-draft-save", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The draft could not be saved. It is still here on this page; try again in a moment." };
  }
}

/** The shop's drafts, newest first. */
export async function listDeckDrafts(): Promise<{ ok: true; drafts: DeckDraftRow[] } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const rows = await db.syncState.findMany({ where: { key: { startsWith: `${DRAFT_PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
    const drafts = rows
      .map((r) => readDraft(r.key.slice(`${DRAFT_PREFIX}${g.organizationId}:`.length), r.cursor))
      .filter((d): d is DeckDraft => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, address, updatedAt, by, proposalId, clientToken, fromClient }) => ({ id, title, address, updatedAt, by, proposalId, clientToken, fromClient }));
    return { ok: true, drafts };
  } catch (err) {
    logServerError("deck-draft-list", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The drafts could not be read." };
  }
}

/** What the client sent with their design, shown over the returned draft (2026-10-13). */
export interface ReturnedClientDesign {
  token: string;
  name: string;
  phone: string | null;
  /** From the link, when the client gave one (a website visitor's quote always does). */
  email: string | null;
  note: string;
  unsure: string[];
  sentAt: string | null;
  sends: number;
  url: string;
  /** The job as the link named it: the contractor's title for it, and the address. */
  address: string | null;
  title: string;
}

export async function loadDeckDraft(id: string): Promise<{ ok: true; draft: DeckDraft; proposal: LinkedDeckProposal | null; client: ReturnedClientDesign | null } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "No such draft." };
  const row = await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).catch(() => null);
  const draft = row ? readDraft(id, row.cursor) : null;
  if (!draft) return { ok: false, error: "That draft is gone." };
  // A returned design: opening it is seeing it — it stops blooming — and the client's words come along. A draft
  // that came back before the token was written on it (before 2026-10-13) is found by its own id, and the token
  // written on it now, so the next open is direct.
  let client: ReturnedClientDesign | null = null;
  let token = draft.clientToken;
  if (!token) {
    const old = await clientLinkOfDraft(id, g.organizationId);
    if (old) {
      token = old.token;
      draft.clientToken = token;
      if (row) {
        try {
          const body = JSON.parse(row.cursor) as Record<string, unknown>;
          await db.syncState.update({ where: { key: draftKey(g.organizationId, id) }, data: { cursor: JSON.stringify({ ...body, clientToken: token, proposalId: body.proposalId ?? old.proposalId ?? null }) } });
        } catch {
          /* next time */
        }
      }
    }
  }
  if (token) {
    const link = await markClientLinkSeen(token, g.organizationId);
    if (link) client = { token: link.token, name: link.clientName, phone: link.clientPhone, email: link.clientEmail ?? null, note: link.note, unsure: link.unsure, sentAt: link.sentAt, sends: link.sends, url: `${(await appBaseUrl()).replace(/\/$/, "")}/deck-design/${link.token}`, address: link.address, title: linkTitle(link) };
  }
  // A draft opened from a proposal goes on updating it, while the proposal is there.
  const proposalId = draft.proposalId ?? (client ? (await db.syncState.findUnique({ where: { key: `deckclient:${client.token}` }, select: { cursor: true } }).then((r) => (r ? (JSON.parse(r.cursor) as { proposalId?: unknown }).proposalId : null)).catch(() => null)) : null);
  return { ok: true, draft, proposal: typeof proposalId === "string" && proposalId ? await linkedProposal(g, proposalId) : null, client };
}

export async function deleteDeckDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // A preview keeps its saved decks as they are (owner, 2026-10-20): deleting one is Deck Studio's.
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "No such draft." };
  await db.syncState.deleteMany({ where: { key: draftKey(g.organizationId, id) } }).catch(() => {});
  return { ok: true };
}

/** The proposal the studio works on, as the studio shows it; null when it is gone or another shop's. */
async function linkedProposal(g: { organizationId: string; userId: string; role: string }, proposalId: string): Promise<LinkedDeckProposal | null> {
  const p = await db.proposal
    .findFirst({ where: { id: proposalId, organizationId: g.organizationId }, select: { id: true, publicId: true, title: true, status: true, ownerId: true, installments: { select: { status: true, paidAmount: true } } } })
    .catch(() => null);
  if (!p) return null;
  // An estimator or a salesperson changes their own proposals only (requireProposalStaff).
  const theirs = (isSalesRole(g.role) || isEstimatorRole(g.role)) && p.ownerId !== g.userId;
  return { id: p.id, ref: proposalRef(p.publicId), title: p.title, status: p.status, lock: deckProposalLock(p.status, p.installments) ?? (theirs ? "theirs" : null), seen: deckProposalSeen(p.status) };
}

/** The deck a saved proposal carries (its DECK_PLAN), to open it again in the studio. */
export async function loadDeckFromProposal(proposalId: string): Promise<{ ok: true; design: DeckDesign; address: string | null; title: string; proposal: LinkedDeckProposal } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, organizationId: g.organizationId }, select: { id: true, title: true, address: true } }).catch(() => null);
  if (!proposal) return { ok: false, error: "No such proposal." };
  const linked = await linkedProposal(g, proposal.id);
  if (!linked) return { ok: false, error: "No such proposal." };
  try {
    const ev = await db.activityEvent.findFirst({ where: { proposalId: proposal.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    const raw = ev?.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : null;
    if (!raw) return { ok: false, error: "That proposal has no deck design saved with it." };
    const design = normalizeDeckDesign(raw.design);
    // A photo from another shop's folder never comes along.
    if (design.photo && !ownDeckPhoto(design.photo.url, g.organizationId)) design.photo = null;
    return { ok: true, design, address: proposal.address ?? (typeof raw.address === "string" ? raw.address : null), title: proposal.title, proposal: linked };
  } catch {
    return { ok: false, error: "The saved deck could not be read." };
  }
}

/* ── Editing a saved deck proposal (2026-10-12) ──────────────────────────── */
//
// Owner: "when a decking design proposal is saved, make an option to open and edit the design." The proposal's
// drawing card opens the studio on it; the studio's "Update the proposal" lands here. The update goes through the
// builder's own save (actions/proposals saveProposal) — the row read the way the builder reads it
// (draftFromProposal) and written the way the builder writes it (payloadFromDraft) — so the schedule, the open
// checkouts and invoices, the discount, the markups and the "show to client" switches behave exactly as a save from
// the builder. What changes (the rules: lib/deck/proposalEdit):
//   · the studio's own lines (the names it last wrote) are replaced by the new design's; lines added in the builder
//     stay, after them, with their store links;
//   · the title and the scope follow the design while they are still the studio's; edited by hand, they stay;
//   · a new address in another state brings that state's sales tax, as the convert does;
//   · a signed, paid or finished proposal is refused — the design goes on a new proposal.
// A new DECK_PLAN row carries the design, the 3D and what was written; every reader takes the newest.

export type DeckUpdateResult =
  | { ok: true; id: string; kept: number; titleKept: boolean; scopeKept: boolean }
  | { ok: false; code: "LOCKED"; lock: DeckProposalLock; error: string }
  | { ok: false; code: "MISSING" | "FORBIDDEN" | "INVALID" | "FAILED"; error: string };

export async function updateDeckProposal(raw: unknown): Promise<DeckUpdateResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, code: "FORBIDDEN", error: g.error };
  const parsed = deckUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const data = parsed.data;
  const missing = { ok: false as const, code: "MISSING" as const, error: "That proposal is gone. Save the design as a new proposal." };
  try {
    const linked = await linkedProposal(g, data.proposalId);
    if (!linked) return missing;
    if (linked.lock) return { ok: false, code: "LOCKED", lock: linked.lock, error: `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays as it is. Save the new design as a new proposal.` };
    const [row, org, ev] = await Promise.all([
      db.proposal.findFirst({
        where: { id: linked.id, organizationId: g.organizationId },
        include: { lineItems: { orderBy: { position: "asc" } }, installments: { orderBy: { position: "asc" } }, discounts: true },
      }),
      db.organization.findUnique({ where: { id: g.organizationId }, select: { defaultTaxRate: true, materialMarkupPct: true, laborMarkupPct: true } }),
      db.activityEvent.findFirst({ where: { proposalId: linked.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } }),
    ]);
    if (!row) return missing;
    let before: Record<string, unknown> | null = null;
    try {
      before = ev?.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : null;
    } catch {
      before = null;
    }
    const next = deckUpdatePayload(
      row,
      { written: readDeckWritten(before?.written), oldWords: before?.design ? structureWords(normalizeDeckDesign(before.design)) : null },
      data,
      org,
    );
    await saveProposal(next.payload);

    if (data.plan) {
      try {
        const plan = { v: DECK_PLAN_VERSION, design: data.plan.design, scene: data.plan.scene, address: next.payload.address || null, written: next.written };
        if (plan.design.photo && !ownDeckPhoto(plan.design.photo.url, g.organizationId)) plan.design = { ...plan.design, photo: null };
        await db.activityEvent.create({ data: { organizationId: g.organizationId, actorId: g.userId, proposalId: row.id, kind: DECK_PLAN_EVENT, summary: `Deck design changed — ${data.plan.scene.facts}`, meta: JSON.stringify(plan) } });
      } catch {
        /* the picture never blocks the price */
      }
    }
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: row.id, summary: `Re-priced the deck from its design — ${data.plan?.scene.facts ?? data.title}, $${Math.round(next.subtotal).toLocaleString("en-US")}`, meta: { trade: "deck", amount: Math.round(next.subtotal) } });
    // A proposal with no client yet, re-priced from the design a client sent through its link: it is that client's
    // job (2026-10-17 audit — the walk's proposal stayed "Unassigned" after Jane's design priced it).
    if (!row.clientId && data.clientToken) {
      const clientId = await clientFromDesignLink(g.organizationId, g.userId, data.clientToken, row.title);
      if (clientId) await db.proposal.updateMany({ where: { id: row.id, organizationId: g.organizationId, clientId: null }, data: { clientId } });
    }
    await tieClientLinkToProposal(data.clientToken, g.organizationId, row.id);
    return { ok: true, id: row.id, kept: next.kept, titleKept: next.titleKept, scopeKept: next.scopeKept };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // The builder's own refusals, said the builder's way: a paid stage, or a proposal this member may not change.
    if (/already paid|being paid/.test(message)) return { ok: false, code: "LOCKED", lock: "paid", error: `${message}. Save the new design as a new proposal.` };
    if (message === "Not found") return { ok: false, code: "LOCKED", lock: "theirs", error: `This proposal is ${DECK_LOCK_WORDS.theirs}. Save the design as a new proposal.` };
    logServerError("deck-update", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, code: "FAILED", error: "The proposal could not be updated. Try again in a moment; if it keeps failing, tell support the time it happened." };
  }
}

/* ── The site from the address: where the ground falls (M3, 2026-10-10) ──── */
//
// The address is geocoded (Google), then USGS lidar (lib/elevation3dep) is
// read on a ring of points around the house, and a plane fitted: back come
// the grade and the direction the ground falls. The studio turns that into
// inches of fall across the deck for the contractor to confirm — nobody can
// tell from an address which wall the deck is on. No Google elevation call:
// where the lidar has a gap the answer is "not read", not a guess.

export type DeckSiteResult = { ok: true; lat: number; lng: number; gradePct: number; downhillDeg: number; resM: number } | { ok: false; error: string };

export async function readDeckSite(address: string): Promise<DeckSiteResult> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  const text = (address ?? "").trim().slice(0, 300);
  if (text.length < 8) return { ok: false, error: "Type the job's street address first." };
  if (!isMapsEnabled()) return { ok: false, error: "The map key is not set on this server, so the ground cannot be read. Type the fall by hand." };
  let at: { lat: number; lng: number } | null;
  try {
    at = await geocode(text);
  } catch (err) {
    logServerError("deck-site-geocode", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The address could not be found on the map." };
  }
  if (!at) return { ok: false, error: "The address could not be found on the map." };
  if (!in3depCoverage(at)) return { ok: false, error: "No lidar coverage here — type the ground's fall by hand." };
  // A ring of eight points 30 ft out and four 60 ft out, plus the centre.
  const FT_PER_DEG_LAT = 364000;
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((at.lat * Math.PI) / 180);
  const samples: Array<{ eastFt: number; northFt: number }> = [{ eastFt: 0, northFt: 0 }];
  for (let k = 0; k < 8; k++) samples.push({ eastFt: 30 * Math.cos((k * Math.PI) / 4), northFt: 30 * Math.sin((k * Math.PI) / 4) });
  for (let k = 0; k < 4; k++) samples.push({ eastFt: 60 * Math.cos((k * Math.PI) / 2 + Math.PI / 4), northFt: 60 * Math.sin((k * Math.PI) / 2 + Math.PI / 4) });
  const points = samples.map((s) => ({ lat: at!.lat + s.northFt / FT_PER_DEG_LAT, lng: at!.lng + s.eastFt / ftPerDegLng }));
  try {
    const res = await sample3depElevations(points);
    if (!res.ok) return { ok: false, error: res.reason === "gap" ? "The lidar has a gap here — type the ground's fall by hand." : "The elevation service did not answer; try again in a moment." };
    const fit = fitGround(samples.map((s, i) => ({ ...s, heightFt: res.elevFt[i] })));
    if (!fit) return { ok: false, error: "The ground around the house could not be read." };
    return { ok: true, lat: at.lat, lng: at.lng, gradePct: fit.gradePct, downhillDeg: fit.downhillDeg, resM: res.resM };
  } catch (err) {
    logServerError("deck-site-lidar", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The elevation service did not answer; try again in a moment." };
  }
}
