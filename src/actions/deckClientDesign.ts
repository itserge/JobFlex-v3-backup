"use server";
// THE CLIENT'S DECK LINK, THE SERVER HALF (2026-10-11) — lib/deck/clientDesign.
//
// Two doors. The contractor's, behind the studio's own gate (an estimator, a
// manager or the owner; while the studio is Coming soon, an admin): make a
// link, list the shop's links, take one back. The client's, public, where the
// token in the address is the only key: say the page was opened, save the
// work as it goes, send it back. Each public door carries its own brake, and
// what comes back is laid over the contractor's design (mergeClientDesign) —
// the client's words never reach the lumber, the footings or the house.
//
// Sent back, the design lands in the studio as a draft (the same SyncState
// row the studio's drafts use), the bell rings (DECK_DESIGN_RETURNED, which
// opens that draft), and the member who made the link gets an email.

import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { appBaseUrl } from "@/lib/appUrl";
import { logServerError } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { clientIp, enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { normalizeDeckDesign, structureWords } from "@/lib/deck/design";
import {
  CLIENT_LINK_DAYS,
  CLIENT_LINK_MAX,
  CLIENT_NOTE_MAX,
  CLIENT_TOKEN_RE,
  DECK_DESIGN_RETURNED,
  DECK_DRAFT_MAX,
  blankFor,
  changesFrom,
  clientCopyOf,
  clientIndexKey,
  clientLinkKey,
  clientLinkMessage,
  clientLinkRow,
  clientPhotoFolder,
  deckDraftKey,
  mergeClientDesign,
  parseClientLink,
  returnedEmailDoc,
  returnedTitle,
  type ClientDesignLink,
  type ClientLinkRow,
  type ClientStart,
  type ClientUnsure,
  linkTitle,
} from "@/lib/deck/clientDesign";
import { markClientLinkSeen, unseenClientReturns, withProposals } from "@/lib/deck/clientLinksServer";
import { keepHousePhoto, readHouseImage, type DeckPhotoResult, type HousePhotoRead } from "@/lib/deck/housePhotoServer";
import { readHouseDepthImage, type HouseDepthResult } from "@/lib/deck/houseDepth";
import { isPrivateFileUnder } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { deckAddonShortWords } from "@/lib/deckAddon";

type Gate = { ok: true; organizationId: string; userId: string } | { ok: false; error: string };

/** "design": the studio's preview is enough (the links already there); "full" (the default): a new client link. */
async function gate(need: "full" | "design" = "full"): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level === "none") return { ok: false, error: "Deck Studio isn't open yet." };
    if (level === "preview" && need === "full") return { ok: false, error: `Saving, sending and printing are part of Deck Studio — add it to your plan (${deckAddonShortWords()}) from the Deck estimator.` };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can do this." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

/** One brake; its refusal is the message the client reads. */
async function brake(key: string, max: number, what: string): Promise<string | null> {
  try {
    await enforceRateLimit(key, max, HOUR, what);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return err.message;
    throw err;
  }
}

const linkUrl = async (token: string) => `${(await appBaseUrl()).replace(/\/$/, "")}/deck-design/${token}`;

async function readLink(token: string): Promise<ClientDesignLink | null> {
  if (typeof token !== "string" || !CLIENT_TOKEN_RE.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: clientLinkKey(token) }, select: { cursor: true } }).catch(() => null);
  const link = row ? parseClientLink(row.cursor) : null;
  return link && link.token === token ? link : null;
}

const writeLink = (link: ClientDesignLink) =>
  db.syncState.upsert({ where: { key: clientLinkKey(link.token) }, create: { key: clientLinkKey(link.token), cursor: JSON.stringify(link) }, update: { cursor: JSON.stringify(link) } });

async function readIndex(organizationId: string): Promise<string[]> {
  const row = await db.syncState.findUnique({ where: { key: clientIndexKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  try {
    const list = row ? (JSON.parse(row.cursor) as unknown) : [];
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string" && CLIENT_TOKEN_RE.test(t)) : [];
  } catch {
    return [];
  }
}

const writeIndex = (organizationId: string, tokens: string[]) =>
  db.syncState.upsert({ where: { key: clientIndexKey(organizationId) }, create: { key: clientIndexKey(organizationId), cursor: JSON.stringify(tokens) }, update: { cursor: JSON.stringify(tokens) } });

/* ── the contractor's door ─────────────────────────────────────────── */

export type ClientLinkMade = { ok: true; token: string; url: string; message: string; link: ClientLinkRow & { url: string } } | { ok: false; error: string };

/**
 * A link for the client to design the deck: from the design on the studio's
 * screen ("mine") or from a blank deck on the same site, house and lumber.
 */
export async function createDeckClientLink(input: {
  clientName: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
  clientId?: string | null;
  start: ClientStart;
  design: unknown;
  address?: string | null;
  title?: string | null;
  /** The proposal the studio was on (2026-10-13): the link belongs to it, and what comes back updates it. */
  proposalId?: string | null;
}): Promise<ClientLinkMade> {
  const g = await gate();
  if (!g.ok) return g;
  const clientName = (input.clientName ?? "").trim().slice(0, 80);
  if (!clientName) return { ok: false, error: "Type the client's name — the page greets them by it." };
  const clientEmail = (input.clientEmail ?? "").trim().slice(0, 200) || null;
  if (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) return { ok: false, error: "That email address doesn't look right." };
  const clientPhone = (input.clientPhone ?? "").trim().slice(0, 40) || null;
  const start: ClientStart = input.start === "blank" ? "blank" : "mine";
  const theirs = clientCopyOf(normalizeDeckDesign(input.design));
  const base = start === "blank" ? blankFor(theirs) : theirs;
  try {
    // A client id from the browser must belong to this shop.
    const clientId = input.clientId ? ((await db.client.findFirst({ where: { id: input.clientId, organizationId: g.organizationId }, select: { id: true } }))?.id ?? null) : null;
    // Likewise the proposal: this shop's, or none.
    const proposalId = input.proposalId ? ((await db.proposal.findFirst({ where: { id: input.proposalId, organizationId: g.organizationId }, select: { id: true } }))?.id ?? null) : null;
    const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
    const now = new Date();
    const token = randomBytes(18).toString("base64url");
    const link: ClientDesignLink = {
      v: 1,
      token,
      orgId: g.organizationId,
      createdBy: g.userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CLIENT_LINK_DAYS * 24 * 3600 * 1000).toISOString(),
      clientName,
      clientPhone,
      clientEmail,
      clientId,
      address: (input.address ?? "").trim().slice(0, 300) || null,
      title: ((input.title ?? "").trim() || structureWords(theirs)).slice(0, 120),
      titleAuto: !(input.title ?? "").trim(),
      start,
      base,
      work: null,
      workAt: null,
      openedAt: null,
      note: "",
      unsure: [],
      status: "open",
      sentAt: null,
      sends: 0,
      draftId: null,
      proposalId,
      byName: who?.name?.trim() || who?.email || null,
      seenAt: null,
      pricedAt: null,
    };
    await writeLink(link);
    // The shop's list, newest first; past the cap the oldest link closes.
    const index = [token, ...(await readIndex(g.organizationId)).filter((t) => t !== token)];
    const dropped = index.slice(CLIENT_LINK_MAX);
    await writeIndex(g.organizationId, index.slice(0, CLIENT_LINK_MAX));
    if (dropped.length) await db.syncState.deleteMany({ where: { key: { in: dropped.map(clientLinkKey) } } }).catch(() => {});
    const url = await linkUrl(token);
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { name: true } }).catch(() => null);
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, clientId, summary: `Made a deck design link for ${clientName} — ${start === "mine" ? link.title : "a blank deck"}` });
    return { ok: true, token, url, message: clientLinkMessage({ org: org?.name ?? "", clientName, link: url, start }), link: { ...clientLinkRow(link, now.getTime()), url } };
  } catch (err) {
    logServerError("deck-client-link", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The link could not be made. Try again in a moment." };
  }
}

/** The shop's links, newest first. */
export async function listDeckClientLinks(): Promise<{ ok: true; links: Array<ClientLinkRow & { url: string; message: string }> } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return g;
  try {
    const tokens = await readIndex(g.organizationId);
    if (!tokens.length) return { ok: true, links: [] };
    const rows = await db.syncState.findMany({ where: { key: { in: tokens.map(clientLinkKey) } }, select: { cursor: true } });
    const byToken = new Map<string, ClientDesignLink>();
    for (const r of rows) {
      const l = parseClientLink(r.cursor);
      if (l && l.orgId === g.organizationId) byToken.set(l.token, l);
    }
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { name: true } }).catch(() => null);
    const base = (await appBaseUrl()).replace(/\/$/, "");
    const now = Date.now();
    const linkRows = await withProposals(tokens.map((t) => byToken.get(t)).filter((l): l is ClientDesignLink => !!l).map((l) => clientLinkRow(l, now)), g.organizationId);
    const links = linkRows.map((r) => {
      const url = `${base}/deck-design/${r.token}`;
      return { ...r, url, message: clientLinkMessage({ org: org?.name ?? "", clientName: r.clientName, link: url, start: r.start }) };
    });
    return { ok: true, links };
  } catch (err) {
    logServerError("deck-client-links", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The links could not be read." };
  }
}

/** Designs sent back that nobody has opened yet (2026-10-13): the studio polls this and blooms. */
export async function deckClientInbox(): Promise<{ ok: true; unseen: Array<ClientLinkRow & { url: string }>; count: number } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return g;
  try {
    const base = (await appBaseUrl()).replace(/\/$/, "");
    const unseen = (await withProposals(await unseenClientReturns(g.organizationId), g.organizationId)).map((l) => ({ ...l, url: `${base}/deck-design/${l.token}` }));
    return { ok: true, unseen, count: unseen.length };
  } catch (err) {
    logServerError("deck-client-inbox", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The inbox could not be read." };
  }
}

/** The contractor looked at what came back: it stops blooming everywhere. */
export async function markDeckClientSeen(token: string): Promise<{ ok: boolean }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false };
  return { ok: !!(await markClientLinkSeen(token, g.organizationId)) };
}

/** Take a link back: the page stops opening. A design already sent stays in the drafts. */
export async function deleteDeckClientLink(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return g;
  const link = await readLink(token);
  if (!link || link.orgId !== g.organizationId) return { ok: false, error: "No such link." };
  try {
    await db.syncState.deleteMany({ where: { key: clientLinkKey(token) } });
    await writeIndex(g.organizationId, (await readIndex(g.organizationId)).filter((t) => t !== token));
    return { ok: true };
  } catch (err) {
    logServerError("deck-client-link-delete", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The link could not be removed. Try again in a moment." };
  }
}

/* ── the client's door (public: the token is the key) ──────────────── */

export type ClientDoorResult = { ok: true; at: string } | { ok: false; error: string };

const CLOSED = "This link is closed. Ask your contractor for a new one.";
const live = (link: ClientDesignLink | null): link is ClientDesignLink => !!link && Date.parse(link.expiresAt) > Date.now();
/** A design from the browser, refused past this size (a deck is a few kilobytes). */
const DESIGN_MAX_CHARS = 200_000;
const tooBig = (design: unknown) => {
  try {
    return JSON.stringify(design ?? null).length > DESIGN_MAX_CHARS;
  } catch {
    return true;
  }
};

/** The client opened the page — said from the browser, so a link preview in a text thread does not count. */
export async function markDeckClientOpened(token: string): Promise<ClientDoorResult> {
  const link = await readLink(token);
  if (!live(link)) return { ok: false, error: CLOSED };
  if (link.openedAt) return { ok: true, at: link.openedAt };
  const braked = await brake(`deckclient-open:${token}`, 30, "visits");
  if (braked) return { ok: false, error: braked };
  const at = new Date().toISOString();
  try {
    await writeLink({ ...link, openedAt: at });
  } catch {
    /* the visit is not worth an error on the client's screen */
  }
  return { ok: true, at };
}

/** The client's work so far, saved a moment after each change. */
export async function saveDeckClientWork(token: string, design: unknown): Promise<ClientDoorResult> {
  const link = await readLink(token);
  if (!live(link)) return { ok: false, error: CLOSED };
  if (tooBig(design)) return { ok: false, error: "That design could not be saved." };
  const braked = await brake(`deckclient-save:${token}`, 600, "saves");
  if (braked) return { ok: false, error: braked };
  const at = new Date().toISOString();
  try {
    await writeLink({ ...link, work: mergeClientDesign(link.base, design, { settle: false, photoOk: ownPhoto(link) }), workAt: at, openedAt: link.openedAt ?? at });
    return { ok: true, at };
  } catch (err) {
    logServerError("deck-client-save", err, { kind: "action", organizationId: link.orgId });
    return { ok: false, error: "Not saved — it will try again." };
  }
}

/** Back to the contractor: the design lands in the studio's drafts, the bell rings, the link's maker gets an email. */
export async function sendDeckClientDesign(
  token: string,
  input: { design: unknown; note?: string | null; name?: string | null; phone?: string | null; unsure?: unknown },
): Promise<ClientDoorResult> {
  const link = await readLink(token);
  if (!live(link)) return { ok: false, error: CLOSED };
  if (tooBig(input.design)) return { ok: false, error: "That design could not be sent." };
  const braked = (await brake(`deckclient-send:${token}`, 12, "sends")) ?? (await brake(`deckclient-send-ip:${await clientIp()}`, 40, "sends"));
  if (braked) return { ok: false, error: braked };

  const name = (input.name ?? "").trim().slice(0, 80) || link.clientName;
  const phone = (input.phone ?? "").trim().slice(0, 40) || link.clientPhone;
  const note = (input.note ?? "").trim().slice(0, CLIENT_NOTE_MAX);
  const unsure: ClientUnsure[] = Array.isArray(input.unsure) && input.unsure.includes("height") ? ["height"] : [];
  const work = mergeClientDesign(link.base, input.design, { settle: false, photoOk: ownPhoto(link) });
  const settled = mergeClientDesign(link.base, input.design, { photoOk: ownPhoto(link) });
  const at = new Date().toISOString();
  const draftId = link.draftId ?? randomUUID();
  try {
    // The studio's draft row (actions/deckEstimator's format), so it opens like any draft.
    const key = deckDraftKey(link.orgId, draftId);
    const exists = await db.syncState.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      const all = await db.syncState.findMany({ where: { key: { startsWith: `deckdraft:${link.orgId}:` } }, select: { key: true, cursor: true } });
      if (all.length >= DECK_DRAFT_MAX) {
        const updated = (c: string) => {
          try {
            const at2 = (JSON.parse(c) as { updatedAt?: unknown }).updatedAt;
            return typeof at2 === "string" ? at2 : "";
          } catch {
            return "";
          }
        };
        const oldest = all.map((r) => ({ key: r.key, at: updated(r.cursor) })).sort((a, b) => a.at.localeCompare(b.at))[0];
        if (oldest) await db.syncState.delete({ where: { key: oldest.key } }).catch(() => {});
      }
    }
    // The draft remembers the proposal it belongs to (the studio then updates that one) and the link it came through.
    // The title says what came back (2026-10-17 audit: a client who made the 16 × 12 an 18 × 14 came back titled
    // "16 ft × 12 ft deck"). A title the contractor typed on the link stays theirs; the automatic one — the words of
    // the design the link started from — is redrawn from the client's design.
    const body = JSON.stringify({ v: 1, title: returnedTitle({ clientName: name, title: linkTitle({ ...link, work: settled }) }), address: link.address, updatedAt: at, by: `${name} (client)`, proposalId: link.proposalId, clientToken: link.token, design: settled });
    await db.syncState.upsert({ where: { key }, create: { key, cursor: body }, update: { cursor: body } });
    const sent: ClientDesignLink = { ...link, clientName: name, clientPhone: phone, work, workAt: at, openedAt: link.openedAt ?? at, note, unsure, status: "sent", sentAt: at, sends: link.sends + 1, draftId };
    await writeLink(sent);
  } catch (err) {
    logServerError("deck-client-send", err, { kind: "action", organizationId: link.orgId });
    return { ok: false, error: "It could not be sent just now. Your design is kept — try Send again in a moment." };
  }

  const changes = link.start === "mine" ? changesFrom(link.base, work) : [];
  const href = `/dashboard/deck-estimator?draft=${draftId}`;
  const again = link.sends > 0;
  await logActivity({
    organizationId: link.orgId,
    actorId: null,
    kind: DECK_DESIGN_RETURNED,
    clientId: link.clientId,
    proposalId: link.proposalId,
    // The title already says the size; the rest of what changed follows it.
    summary: `${name} ${again ? "sent their deck design again" : "sent back their deck design"} — ${structureWords(settled)}${changes.filter((c) => !c.startsWith("size ")).length ? ` (${changes.filter((c) => !c.startsWith("size ")).join(", ")})` : ""}`,
    meta: { href, token, draftId },
  });
  // A website visitor's send (link.web) is told by the lead alert instead (actions/webEstimator webDeckSend).
  if (!link.web) {
    await emailTheMaker(link, { name, phone, note, unsure, settledWords: structureWords(settled), changes, href, again }).catch((err) => {
      console.warn("[deck-client] email not sent:", err instanceof Error ? err.message : err);
    });
  }
  return { ok: true, at };
}

/** THE WEBSITE'S LINK JOINS THE SHOP'S LIST once it is sent with a lead (actions/webEstimator): the folder of client
 *  designs shows it like any other, named by the visitor. */
export async function fileWebClientLink(token: string, patch: { leadId: string; clientEmail: string | null; clientId?: string | null }): Promise<void> {
  const link = await readLink(token);
  if (!link || !link.web) return;
  await writeLink({ ...link, clientEmail: patch.clientEmail ?? link.clientEmail, clientId: patch.clientId ?? link.clientId, web: { ...link.web, leadId: patch.leadId } });
  const index = [token, ...(await readIndex(link.orgId)).filter((t) => t !== token)];
  const dropped = index.slice(CLIENT_LINK_MAX);
  await writeIndex(link.orgId, index.slice(0, CLIENT_LINK_MAX));
  if (dropped.length) await db.syncState.deleteMany({ where: { key: { in: dropped.map(clientLinkKey) } } }).catch(() => {});
}

/** The website's new link (actions/webEstimator webDeckStart): written, not yet in the shop's list. */
export async function writeWebClientLink(link: ClientDesignLink): Promise<void> {
  await writeLink(link);
}

/** The website's read of its own link: the token is the key, the link must be the website's. */
export async function readWebClientLink(token: string): Promise<ClientDesignLink | null> {
  const link = await readLink(token);
  return link && link.web && live(link) ? link : null;
}

/* ── the photo of the house (2026-10-23) ───────────────────────────── */

/** The client's photos live in the shop's private folder, under this link's own. */
const photoFolder = (link: ClientDesignLink) => clientPhotoFolder(link.orgId, link.token);
/** A photo in the client's design is kept only when it came through this link. */
const ownPhoto = (link: ClientDesignLink) => (url: string) => isPrivateFileUnder(url, photoFolder(link));

/** The client's photo of the back of the house, kept (only with a file store: their design is saved as it goes, and a
 *  picture as a data URL would not fit it — then the house is built and the picture not kept). */
export async function uploadClientHousePhoto(token: string, form: FormData): Promise<DeckPhotoResult> {
  const link = await readLink(token);
  if (!live(link)) return { ok: false, error: CLOSED };
  const braked = (await brake(`deckclient-photo:${token}`, 10, "photos")) ?? (await brake(`deckclient-photo-ip:${await clientIp()}`, 30, "photos"));
  if (braked) return { ok: false, error: braked };
  return keepHousePhoto(form, photoFolder(link), { organizationId: link.orgId }, { inline: false });
}

/** The same read the studio makes (two looks: the whole picture, then the wall cut out) — each look one call. */
export async function readClientHousePhoto(token: string, form: FormData): Promise<HousePhotoRead> {
  const link = await readLink(token);
  if (!live(link)) return { ok: false, error: CLOSED, configured: true };
  const braked = (await brake(`deckclient-read:${token}`, 16, "photo reads")) ?? (await brake(`deckclient-read-ip:${await clientIp()}`, 40, "photo reads"));
  if (braked) return { ok: false, error: braked, configured: true };
  return readHouseImage(form, { organizationId: link.orgId });
}

/** The same depth map the studio reads (lib/deck/houseDepth) — one call a photo, on its own brake. */
export async function readClientHouseDepth(token: string, form: FormData): Promise<HouseDepthResult> {
  const link = await readLink(token);
  if (!live(link)) return { ok: false, error: CLOSED, configured: true };
  const braked = (await brake(`deckclient-depth:${token}`, 12, "depth reads")) ?? (await brake(`deckclient-depth-ip:${await clientIp()}`, 30, "depth reads"));
  if (braked) return { ok: false, error: braked, configured: true };
  return readHouseDepthImage(form, { organizationId: link.orgId });
}

/** A fresh read link for the client's own photo (never the contractor's — that is the shop's private file). */
export async function clientHousePhotoHref(token: string, url: string): Promise<string | null> {
  const link = await readLink(token);
  if (!live(link) || typeof url !== "string" || !ownPhoto(link)(url)) return null;
  return mediaHref(url);
}

async function emailTheMaker(
  link: ClientDesignLink,
  i: { name: string; phone: string | null; note: string; unsure: ClientUnsure[]; settledWords: string; changes: string[]; href: string; again: boolean },
): Promise<void> {
  if (!isEmailEnabled()) return;
  const org = await db.organization.findUnique({ where: { id: link.orgId }, select: { name: true, logoUrl: true, phone: true, billingEmail: true } });
  if (!org) return;
  const maker = link.createdBy ? await db.user.findUnique({ where: { id: link.createdBy }, select: { email: true } }).catch(() => null) : null;
  const owner = maker?.email
    ? null
    : await db.membership.findFirst({ where: { organizationId: link.orgId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } }).catch(() => null);
  const to = maker?.email ?? owner?.user.email ?? org.billingEmail;
  if (!to) return;
  const doc = returnedEmailDoc({
    org: { id: link.orgId, name: org.name, logoUrl: org.logoUrl ?? null, phone: org.phone ?? null },
    name: i.name,
    phone: i.phone,
    note: i.note,
    unsure: i.unsure,
    words: i.settledWords,
    changes: i.changes,
    href: `${(await appBaseUrl()).replace(/\/$/, "")}${i.href}`,
    again: i.again,
  });
  const { subject, html, text } = renderEmail(doc);
  await sendEmail({ to, subject, html, text });
}
