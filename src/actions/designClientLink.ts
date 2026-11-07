"use server";

// THE CLIENT'S LINK TO THEIR ROOM — server side (Home Design Studio, 2026-10-19). lib/design/clientLink holds the
// link's shape and rules; here it is made (gated like the studio), listed and applied for the contractor, and chosen
// in and approved by the client from the link — the public actions, keyed by the token alone, rate-limited, writing
// nothing but the client's picks, note and approval (the page itself notes it was opened). Approving rings the
// contractor's bell and emails them.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { canUseDesignStudio } from "@/lib/design/access";
import { normalizeDesign } from "@/lib/design/normalize";
import { locationIndex } from "@/lib/estimate/location-index";
import { sanitizeProducts } from "@/lib/design/inventory";
import { DEFAULT_OPTIONS, type EstimateOptions } from "@/lib/design/estimate";
import { roomsOf } from "@/lib/design/geometry";
import { approvedEmailDoc, chosenWords, cleanOptions, cleanPicks, DESIGN_CLIENT_APPROVED, indexKey, LINK_DAYS, LINK_MAX, LINK_TOKEN_RE, linkKey, linkMessage, linkRow, linkTotal, money, NOTE_MAX, parseLink, type LinkRow, type RoomClientLink } from "@/lib/design/clientLink";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { clientIp, enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { logServerError } from "@/lib/server-events";

type Gate = { ok: true; organizationId: string; userId: string } | { ok: false; error: string };
async function gate(): Promise<Gate> {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) return { ok: false, error: "The design studio isn't open to this role." };
    if (!(await canUseDesignStudio(ctx.user))) return { ok: false, error: "The design studio is in preview for admins." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id };
  } catch {
    return { ok: false, error: "Sign in again to use the design studio." };
  }
}

const linkUrl = async (token: string) => `${(await appBaseUrl()).replace(/\/$/, "")}/room-design/${token}`;

async function readLink(token: string): Promise<RoomClientLink | null> {
  if (!LINK_TOKEN_RE.test(String(token))) return null;
  const row = await db.syncState.findUnique({ where: { key: linkKey(token) }, select: { cursor: true } }).catch(() => null);
  const l = parseLink(row?.cursor);
  return l && l.token === token ? l : null;
}
async function writeLink(l: RoomClientLink) {
  const cursor = JSON.stringify(l);
  await db.syncState.upsert({ where: { key: linkKey(l.token) }, create: { key: linkKey(l.token), cursor }, update: { cursor } });
}
async function readIndex(org: string): Promise<string[]> {
  const row = await db.syncState.findUnique({ where: { key: indexKey(org) }, select: { cursor: true } }).catch(() => null);
  try {
    const v = JSON.parse(row?.cursor ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

const makeSchema = z.object({
  designId: z.string().max(64).nullable(),
  doc: z.unknown(),
  room: z.string().min(1).max(64),
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  clientPhone: z.string().trim().max(40).optional(),
  clientId: z.string().max(64).nullable().optional(),
  options: z.unknown(),
  showPrice: z.boolean(),
  address: z.string().trim().max(300).optional(),
  title: z.string().trim().max(120).optional(),
});

/** A link for the client to their room: the design as it is, the options offered, what prices them. */
export async function createRoomClientLink(raw: unknown): Promise<{ ok: true; token: string; url: string; message: string; row: LinkRow & { url: string } } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const p = makeSchema.safeParse(raw);
  if (!p.success) {
    const f = p.error.issues[0]?.path[0];
    return { ok: false, error: f === "clientName" ? "Type the client's name — the page greets them by it." : f === "clientEmail" ? "That email address doesn't look right." : "The link couldn't be made from that." };
  }
  const i = p.data;
  try {
    await enforceRateLimit(`design-client:${g.organizationId}`, 60, HOUR, "client links");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many links — try again later." };
  }
  // The design as the client sees it: walls, openings, rooms, what's placed and the finishes — not the plan's lines.
  const full = normalizeDesign(i.doc);
  const doc = { ...full, marks: [], engineering: undefined };
  const room = roomsOf(doc).find((r) => r.labelId === i.room);
  if (!room) return { ok: false, error: "Pick the room to send first." };
  const options = cleanOptions(i.options, doc, i.room);
  try {
    const [org, who, bookRow, invRow] = await Promise.all([
      db.organization.findUnique({ where: { id: g.organizationId }, select: { name: true, address: true } }),
      db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null),
      db.syncState.findUnique({ where: { key: `designbook:${g.organizationId}` }, select: { cursor: true } }).catch(() => null),
      db.syncState.findUnique({ where: { key: `designinv:${g.organizationId}` }, select: { cursor: true } }).catch(() => null),
    ]);
    const clientId = i.clientId ? ((await db.client.findFirst({ where: { id: i.clientId, organizationId: g.organizationId }, select: { id: true } }))?.id ?? null) : null;
    const address = i.address?.trim() || doc.estimate?.address?.trim() || null;
    const idx = locationIndex(address || org?.address || null);
    let book: Record<string, number> = {};
    try {
      const b = JSON.parse(bookRow?.cursor ?? "{}") as Record<string, unknown>;
      for (const [k, v] of Object.entries(b)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) book[k] = v;
    } catch {
      book = {};
    }
    let products: ReturnType<typeof sanitizeProducts> = [];
    try {
      products = sanitizeProducts((JSON.parse(invRow?.cursor ?? "{}") as { products?: unknown }).products);
    } catch {
      products = [];
    }
    const opts: EstimateOptions = { ...DEFAULT_OPTIONS, ...(doc.estimate ?? {}) };
    const now = new Date();
    const token = randomBytes(18).toString("base64url");
    // The room by its own label: a kitchen open to the living room is still "Kitchen" to the client.
    const roomName = doc.labels.find((l) => l.id === i.room)?.name?.trim() || room.name;
    const link: RoomClientLink = {
      v: 1,
      token,
      orgId: g.organizationId,
      createdBy: g.userId,
      byName: who?.name?.trim() || who?.email || null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LINK_DAYS * 24 * 3600 * 1000).toISOString(),
      clientName: i.clientName,
      clientEmail: i.clientEmail || null,
      clientPhone: i.clientPhone?.trim() || null,
      clientId,
      designId: i.designId,
      room: i.room,
      roomName,
      title: i.title?.trim() || `${roomName} design`,
      address,
      doc,
      options,
      showPrice: i.showPrice,
      pricing: { factor: idx.factor, place: idx.place, opts: { scope: opts.scope, roughIn: opts.roughIn, permits: opts.permits, appliances: opts.appliances }, book, products },
      picks: {},
      picksAt: null,
      openedAt: null,
      note: "",
      status: "open",
      approvedAt: null,
      approvedName: null,
      approvedTotal: null,
      appliedAt: null,
    };
    if (JSON.stringify(link).length > 900_000) return { ok: false, error: "The design is too large to send — clear the rooms you're not designing first." };
    await writeLink(link);
    const index = [token, ...(await readIndex(g.organizationId)).filter((t) => t !== token)];
    const dropped = index.slice(LINK_MAX);
    await db.syncState.upsert({ where: { key: indexKey(g.organizationId) }, create: { key: indexKey(g.organizationId), cursor: JSON.stringify(index.slice(0, LINK_MAX)) }, update: { cursor: JSON.stringify(index.slice(0, LINK_MAX)) } });
    if (dropped.length) await db.syncState.deleteMany({ where: { key: { in: dropped.map(linkKey) } } }).catch(() => {});
    const url = await linkUrl(token);
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, clientId, summary: `Made a design link for ${i.clientName} — ${roomName}` });
    return { ok: true, token, url, message: linkMessage({ org: org?.name ?? "", clientName: i.clientName, roomName, link: url }), row: { ...linkRow(link, now.getTime()), url } };
  } catch (err) {
    logServerError("design-client-link", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The link could not be made. Try again in a moment." };
  }
}

/** This design's links (or the shop's, without an id), newest first. */
export async function listRoomClientLinks(designId: string | null): Promise<{ ok: true; links: Array<LinkRow & { url: string }> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const tokens = await readIndex(g.organizationId);
  const rows = tokens.length ? await db.syncState.findMany({ where: { key: { in: tokens.map(linkKey) } }, select: { cursor: true } }).catch(() => []) : [];
  const now = Date.now();
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const links = rows
    .map((r) => parseLink(r.cursor))
    .filter((l): l is RoomClientLink => !!l && l.orgId === g.organizationId && (!designId || l.designId === designId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((l) => ({ ...linkRow(l, now), url: `${base}/room-design/${l.token}` }));
  return { ok: true, links };
}

/** The studio applied the client's picks to its design: noted on the link. */
export async function markRoomClientApplied(token: string): Promise<{ ok: boolean }> {
  const g = await gate();
  if (!g.ok) return { ok: false };
  const l = await readLink(token);
  if (!l || l.orgId !== g.organizationId) return { ok: false };
  await writeLink({ ...l, appliedAt: new Date().toISOString() });
  return { ok: true };
}

/* ── The client's side (public: the token is the key) ──────────────────────────────────────────────────────────── */

type Door = { ok: true } | { ok: false; error: string };
async function door(token: string, what: string): Promise<{ ok: true; link: RoomClientLink } | { ok: false; error: string }> {
  try {
    await enforceRateLimit(`design-client-door:${await clientIp()}`, 240, HOUR, what);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many tries — wait a moment." };
  }
  const link = await readLink(token);
  if (!link) return { ok: false, error: "This link isn't valid." };
  if (Date.parse(link.expiresAt) < Date.now()) return { ok: false, error: "This link has closed — ask for a new one." };
  return { ok: true, link };
}

/** What the client picked so far, kept as they go. */
export async function saveRoomClientPicks(token: string, raw: unknown, note?: string): Promise<Door> {
  const d = await door(token, "changes");
  if (!d.ok) return d;
  if (d.link.status === "approved") return { ok: false, error: "This design is approved — ask for a new link to change it." };
  const picks = cleanPicks(raw, d.link.options);
  await writeLink({ ...d.link, picks, picksAt: new Date().toISOString(), openedAt: d.link.openedAt ?? new Date().toISOString(), note: typeof note === "string" ? note.slice(0, NOTE_MAX) : d.link.note });
  return { ok: true };
}

/** The client approves the design with their picks: the contractor hears at once. */
export async function approveRoomClientDesign(token: string, input: { name: string; picks: unknown; note?: string }): Promise<{ ok: true; total: number | null; at: string } | { ok: false; error: string }> {
  const d = await door(token, "approvals");
  if (!d.ok) return d;
  const l = d.link;
  if (l.status === "approved") return { ok: true, total: l.approvedTotal, at: l.approvedAt ?? new Date().toISOString() };
  const name = String(input?.name ?? "").trim().slice(0, 80) || l.clientName;
  const picks = cleanPicks(input?.picks, l.options);
  const note = typeof input?.note === "string" ? input.note.trim().slice(0, NOTE_MAX) : l.note;
  // The server prices it again — what the client saw is what the contractor is told.
  const total = linkTotal(l, picks);
  const at = new Date().toISOString();
  const next: RoomClientLink = { ...l, picks, picksAt: at, note, status: "approved", approvedAt: at, approvedName: name, approvedTotal: total, openedAt: l.openedAt ?? at };
  await writeLink(next);
  const chosen = chosenWords(l.options, picks);
  const href = l.designId ? `/dashboard/design-studio?design=${encodeURIComponent(l.designId)}` : "/dashboard/design-studio";
  await logActivity({ organizationId: l.orgId, actorId: null, kind: DESIGN_CLIENT_APPROVED, clientId: l.clientId, summary: `${name} approved the ${l.roomName.toLowerCase()} design${total != null ? ` — ${money(total)} before tax` : ""}`, meta: { href, token } }).catch(() => {});
  // Whoever made the link hears by email too (the owner, or the shop's billing address, when they can't be found).
  try {
    const org = await db.organization.findUnique({ where: { id: l.orgId }, select: { name: true, logoUrl: true, phone: true, billingEmail: true } });
    const maker = l.createdBy ? await db.user.findUnique({ where: { id: l.createdBy }, select: { email: true } }).catch(() => null) : null;
    const owner = maker?.email ? null : await db.membership.findFirst({ where: { organizationId: l.orgId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } }).catch(() => null);
    const to = maker?.email ?? owner?.user.email ?? org?.billingEmail;
    if (org && to) {
      const doc = approvedEmailDoc({ org: { id: l.orgId, name: org.name, logoUrl: org.logoUrl ?? null, phone: org.phone ?? null }, name, roomName: l.roomName, total, chosen, note, href: `${(await appBaseUrl()).replace(/\/$/, "")}${href}` });
      const { subject, html, text } = renderEmail(doc);
      await sendEmail({ to, subject, html, text });
    }
  } catch (err) {
    logServerError("design-client-approve-email", err, { kind: "action", organizationId: l.orgId });
  }
  return { ok: true, total, at };
}
